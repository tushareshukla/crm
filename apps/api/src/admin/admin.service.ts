import { randomUUID } from "node:crypto";
import { type Db, OrgStatus, Prisma, withoutTenant } from "@crm/db";
import { RESERVED_SLUGS, workspaceSlug } from "@crm/db/workspace";
import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { InjectDatabase } from "../database/database.constants";
import { InvitesService } from "../invites/invites.service";
import {
	EMPTY_LIMITS,
	type OrgLimits,
	readOrgLimits,
} from "../orgs/org-limits";
import type {
	CreateOrganizationInput,
	UpdateOrganizationInput,
} from "./admin.contracts";

export interface AdminOrganization {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	website: string | null;
	status: OrgStatus;
	createdAt: string;
	suspendedAt: string | null;
	memberCount: number;
	pendingInvites: number;
	limits: OrgLimits;
}

export interface PlatformAdmin {
	id: string;
	email: string;
	headers: Headers;
}

/** The fields an update actually changed — what the audit log records. */
type OrganizationChanges = {
	name?: string;
	slug?: string;
	logo?: string | null;
	limits?: OrgLimits;
};

/** Pending-invite count only counts unexpired ones; the cut-off moves, so the select is built per call. */
function orgSelect() {
	return {
		id: true,
		name: true,
		slug: true,
		logo: true,
		website: true,
		status: true,
		createdAt: true,
		suspendedAt: true,
		limits: true,
		_count: {
			select: {
				members: true,
				invitations: {
					where: { status: "pending", expiresAt: { gt: new Date() } },
				},
			},
		},
	} satisfies Prisma.OrganizationSelect;
}

type OrgRow = Prisma.OrganizationGetPayload<{
	select: ReturnType<typeof orgSelect>;
}>;

/**
 * Platform console. Everything here is platform-level and runs outside tenant
 * scope on purpose: it is how organizations come to exist. Only reachable
 * behind PlatformAdminMiddleware.
 */
@Injectable()
export class AdminService {
	private readonly logger = new Logger(AdminService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly audit: AuditService,
		private readonly invites: InvitesService,
	) {}

	async listOrganizations(): Promise<AdminOrganization[]> {
		const rows = await withoutTenant(() =>
			this.db.organization.findMany({
				select: orgSelect(),
				orderBy: { createdAt: "asc" },
			}),
		);

		return rows.map(toAdminOrganization);
	}

	async createOrganization(
		input: CreateOrganizationInput,
		admin: PlatformAdmin,
	): Promise<{ organization: AdminOrganization; inviteUrl: string | null }> {
		const slug = validSlug(input.slug);
		const now = new Date();
		const id = randomUUID();

		try {
			await withoutTenant(() =>
				this.db.$transaction(async (tx) => {
					await tx.organization.create({
						data: {
							id,
							name: input.name,
							slug,
							createdAt: now,
							status: OrgStatus.ACTIVE,
							limits: EMPTY_LIMITS,
						},
					});
					await tx.member.create({
						data: {
							id: randomUUID(),
							organizationId: id,
							userId: admin.id,
							role: "owner",
							createdAt: now,
						},
					});
				}),
			);
		} catch (error) {
			throw slugTaken(error) ?? error;
		}

		await this.audit.recordFor(id, {
			type: "org.created",
			actorId: admin.id,
			subject: id,
			data: { name: input.name, slug, ownerEmail: input.ownerEmail },
		});

		this.logger.log({
			message: "Organization created",
			organizationId: id,
			slug,
			userId: admin.id,
		});

		// The admin is already the owner; no point inviting them to their own org.
		const inviteUrl =
			input.ownerEmail === admin.email.trim().toLowerCase()
				? null
				: (
						await this.invites.create(
							id,
							{ email: input.ownerEmail, role: "owner" },
							{
								id: admin.id,
								email: admin.email,
								role: "owner",
								headers: admin.headers,
							},
						)
					).url;

		return { organization: await this.read(id), inviteUrl };
	}

	async updateOrganization(
		input: UpdateOrganizationInput,
		admin: PlatformAdmin,
	): Promise<AdminOrganization> {
		const before = await this.read(input.id);
		const data: Prisma.OrganizationUpdateInput = {};
		const changed: OrganizationChanges = {};

		if (input.name !== undefined && input.name !== before.name) {
			data.name = input.name;
			changed.name = input.name;
		}
		if (input.slug !== undefined && input.slug !== before.slug) {
			data.slug = validSlug(input.slug);
			changed.slug = data.slug;
		}
		if (input.logo !== undefined && input.logo !== before.logo) {
			data.logo = input.logo;
			changed.logo = input.logo;
		}
		if (input.limits !== undefined) {
			const limits: OrgLimits = { ...before.limits, ...input.limits };
			data.limits = limits;
			changed.limits = limits;
		}

		if (Object.keys(changed).length === 0) return before;

		try {
			await withoutTenant(() =>
				this.db.organization.update({ where: { id: input.id }, data }),
			);
		} catch (error) {
			throw slugTaken(error) ?? error;
		}

		await this.audit.recordFor(input.id, {
			type: "org.updated",
			actorId: admin.id,
			subject: input.id,
			data: changed,
		});

		this.logger.log({
			message: "Organization updated",
			organizationId: input.id,
			fields: Object.keys(changed),
			userId: admin.id,
		});

		return this.read(input.id);
	}

	async suspend(id: string, admin: PlatformAdmin): Promise<AdminOrganization> {
		return this.setStatus(id, OrgStatus.SUSPENDED, admin);
	}

	async unsuspend(
		id: string,
		admin: PlatformAdmin,
	): Promise<AdminOrganization> {
		return this.setStatus(id, OrgStatus.ACTIVE, admin);
	}

	/**
	 * Hard delete. Every tenant table cascades from Organization, as do
	 * better-auth's member and invitation rows; sessions that pointed at the
	 * organization fall back to "no active organization".
	 */
	async deleteOrganization(
		id: string,
		admin: PlatformAdmin,
	): Promise<{ id: string; slug: string }> {
		const before = await this.read(id);

		await withoutTenant(() =>
			this.db.$transaction(async (tx) => {
				await tx.invitation.deleteMany({ where: { organizationId: id } });
				await tx.member.deleteMany({ where: { organizationId: id } });
				await tx.session.updateMany({
					where: { activeOrganizationId: id },
					data: { activeOrganizationId: null },
				});
				await tx.organization.delete({ where: { id } });
			}),
		);

		this.logger.warn({
			message: "Organization deleted",
			organizationId: id,
			slug: before.slug,
			userId: admin.id,
		});

		return { id, slug: before.slug };
	}

	private async setStatus(
		id: string,
		status: OrgStatus,
		admin: PlatformAdmin,
	): Promise<AdminOrganization> {
		const before = await this.read(id);
		if (before.status === status) return before;

		await withoutTenant(() =>
			this.db.organization.update({
				where: { id },
				data: {
					status,
					suspendedAt: status === OrgStatus.SUSPENDED ? new Date() : null,
				},
			}),
		);

		await this.audit.recordFor(id, {
			type:
				status === OrgStatus.SUSPENDED ? "org.suspended" : "org.unsuspended",
			actorId: admin.id,
			subject: id,
		});

		this.logger.warn({
			message:
				status === OrgStatus.SUSPENDED
					? "Organization suspended"
					: "Organization unsuspended",
			organizationId: id,
			userId: admin.id,
		});

		return this.read(id);
	}

	private async read(id: string): Promise<AdminOrganization> {
		const row = await withoutTenant(() =>
			this.db.organization.findUnique({
				where: { id },
				select: orgSelect(),
			}),
		);

		if (!row) throw new NotFoundException(`No organization with id ${id}.`);

		return toAdminOrganization(row);
	}
}

function toAdminOrganization(row: OrgRow): AdminOrganization {
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		logo: row.logo,
		website: row.website,
		status: row.status,
		createdAt: row.createdAt.toISOString(),
		suspendedAt: row.suspendedAt?.toISOString() ?? null,
		memberCount: row._count.members,
		pendingInvites: row._count.invitations,
		limits: readOrgLimits(row.limits),
	};
}

/**
 * The app's own top-level routes sit beside `/[slug]`, so an organization can
 * never take one of their names (see apps/app/lib/org-slug.ts RESERVED_ROUTES).
 * `RESERVED_SLUGS` covers the section routes; these are the rest.
 */

/** Same rules the workspace slug helper applies, plus "it must not need rewriting". */
function validSlug(slug: string): string {
	if (RESERVED_SLUGS.includes(slug)) {
		throw new BadRequestException(
			`"${slug}" is reserved. Pick another address.`,
		);
	}
	if (workspaceSlug(slug) !== slug) {
		throw new BadRequestException(
			"Use lowercase letters, digits and single dashes, like acme-sales.",
		);
	}
	return slug;
}

function slugTaken(cause: unknown): ConflictException | null {
	if (
		cause instanceof Prisma.PrismaClientKnownRequestError &&
		cause.code === "P2002"
	) {
		return new ConflictException(
			"That address is taken by another organization.",
		);
	}
	return null;
}
