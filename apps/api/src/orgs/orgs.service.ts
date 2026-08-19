import {
	auth,
	canChangeRole,
	canRenameWorkspace,
	type WorkspaceRole,
} from "@crm/auth";
import {
	isPlatformAdmin,
	listUserOrganizations,
	touchMembership,
	type UserOrganization,
} from "@crm/auth/organization";
import { type Db, type OrgStatus, withoutTenant } from "@crm/db";
import {
	HttpException,
	Injectable,
	InternalServerErrorException,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { APIError } from "better-auth/api";
import { AuditService } from "../audit/audit.service";
import { InjectDatabase } from "../database/database.constants";
import { type OrgLimits, readOrgLimits } from "./org-limits";

export interface OrgSummary {
	id: string;
	slug: string;
	name: string;
	logo: string | null;
	website: string | null;
	status: OrgStatus;
	/** The viewer's role; null for a platform admin who is not a member. */
	role: WorkspaceRole | null;
	/** Platform admin entering an organization they do not belong to. */
	supportMode: boolean;
	canRename: boolean;
	canChangeRoles: boolean;
	limits: OrgLimits;
}

const ORG_SELECT = {
	id: true,
	slug: true,
	name: true,
	logo: true,
	website: true,
	status: true,
	limits: true,
} as const;

const STATUS_BY_CODE = new Map<string, number>([
	["BAD_REQUEST", 400],
	["UNAUTHORIZED", 401],
	["FORBIDDEN", 403],
	["NOT_FOUND", 404],
	["CONFLICT", 409],
	["UNPROCESSABLE_ENTITY", 400],
]);

/** Translate a better-auth failure into an HTTP exception the tRPC layer maps onto a code. */
export function fromAuthError(error: unknown, fallback: string): never {
	if (error instanceof APIError) {
		const status =
			STATUS_BY_CODE.get(error.body?.code ?? "") ?? error.statusCode;
		throw new HttpException(error.body?.message ?? fallback, status);
	}
	if (error instanceof HttpException) throw error;
	throw new InternalServerErrorException(fallback);
}

/**
 * Organizations as seen by a signed-in user. Organization and Member are
 * global models, so this service reads outside tenant scope on purpose — it
 * is what the app calls before a tenant is chosen.
 */
@Injectable()
export class OrgsService {
	private readonly logger = new Logger(OrgsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly audit: AuditService,
	) {}

	async mine(userId: string): Promise<UserOrganization[]> {
		return withoutTenant(() => listUserOrganizations(userId, this.db));
	}

	async get(
		slug: string,
		viewer: { id: string; email: string },
	): Promise<OrgSummary> {
		const row = await withoutTenant(() =>
			this.db.organization.findUnique({
				where: { slug },
				select: {
					...ORG_SELECT,
					members: {
						where: { userId: viewer.id },
						select: { role: true },
						take: 1,
					},
				},
			}),
		);

		const role = row?.members[0]?.role;
		const platformAdmin = isPlatformAdmin(viewer.email);

		if (!row || (!role && !platformAdmin)) {
			throw new NotFoundException("No organization with that address.");
		}

		const viewerRole = role ? toRole(role) : null;
		const supportMode = viewerRole === null;

		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			logo: row.logo,
			website: row.website,
			status: row.status,
			role: viewerRole,
			supportMode,
			canRename: supportMode || canRenameWorkspace(viewerRole),
			canChangeRoles: supportMode || canChangeRole(viewerRole),
			limits: readOrgLimits(row.limits),
		};
	}

	/** Remember the org as last used and make it the session's active organization. */
	async switchTo(
		slug: string,
		viewer: { id: string; email: string },
		headers: Headers,
	): Promise<{ id: string; slug: string }> {
		const org = await this.get(slug, viewer);

		if (org.role !== null) {
			await withoutTenant(() => touchMembership(viewer.id, org.id, this.db));

			try {
				await auth.api.setActiveOrganization({
					headers,
					body: { organizationId: org.id },
				});
			} catch (error) {
				// The URL decides the active org; the session field is only a fallback.
				this.logger.debug({
					message: "Could not set the session's active organization",
					organizationId: org.id,
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return { id: org.id, slug: org.slug };
	}

	async acceptInvitation(
		invitationId: string,
		viewer: { id: string; email: string },
		headers: Headers,
	): Promise<{ organization: { id: string; slug: string; name: string } }> {
		let organizationId: string;

		try {
			const accepted = await auth.api.acceptInvitation({
				headers,
				body: { invitationId },
			});
			organizationId = accepted.invitation.organizationId;
		} catch (error) {
			fromAuthError(error, "That invitation could not be accepted.");
		}

		const organization = await withoutTenant(() =>
			this.db.organization.findUnique({
				where: { id: organizationId },
				select: { id: true, slug: true, name: true },
			}),
		);

		if (!organization) {
			throw new NotFoundException("That organization no longer exists.");
		}

		await withoutTenant(() =>
			touchMembership(viewer.id, organization.id, this.db),
		);

		await this.audit.recordFor(organization.id, {
			type: "invite.accepted",
			actorId: viewer.id,
			subject: invitationId,
			data: { email: viewer.email },
		});

		this.logger.log({
			message: "Invitation accepted",
			userId: viewer.id,
			organizationId: organization.id,
		});

		return { organization };
	}
}

function toRole(value: string): WorkspaceRole {
	return value === "owner" || value === "admin" ? value : "member";
}
