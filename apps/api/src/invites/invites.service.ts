import { randomUUID } from "node:crypto";
import { appUrl, auth, toWorkspaceRole, type WorkspaceRole } from "@crm/auth";
import { type Db, withoutTenant } from "@crm/db";
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { InjectDatabase } from "../database/database.constants";
import { fromAuthError } from "../orgs/orgs.service";

/** Mirrors better-auth's `invitationExpiresIn` (see packages/auth/src/auth.ts). */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;

export interface Invite {
	id: string;
	email: string;
	role: WorkspaceRole;
	url: string;
	expiresAt: string;
	createdAt: string;
	inviter: { id: string; name: string; email: string } | null;
}

export interface Inviter {
	id: string;
	email: string;
	/** Member role in the organization; null for a platform admin in support mode. */
	role: WorkspaceRole | null;
	/** Session headers — better-auth resolves the caller from them. */
	headers: Headers;
}

const INVITE_SELECT = {
	id: true,
	email: true,
	role: true,
	expiresAt: true,
	createdAt: true,
	user: { select: { id: true, name: true, email: true } },
} as const;

export function inviteUrl(id: string): string {
	return `${appUrl.replace(/\/+$/, "")}/invite/${encodeURIComponent(id)}`;
}

/**
 * Copy-link invitations, backed by better-auth's organization invitations so
 * accepting one (and the invite-only sign-up gate) stays in one place.
 * Invitation is a global model: every read here names the organization.
 */
@Injectable()
export class InvitesService {
	private readonly logger = new Logger(InvitesService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly audit: AuditService,
	) {}

	async create(
		organizationId: string,
		input: { email: string; role: WorkspaceRole },
		inviter: Inviter,
	): Promise<Invite> {
		const id =
			inviter.role !== null
				? await this.createAsMember(organizationId, input, inviter)
				: await this.createAsPlatformAdmin(organizationId, input, inviter);

		const row = await this.read(organizationId, id);
		if (!row) {
			throw new NotFoundException("The invitation could not be read back.");
		}

		await this.audit.recordFor(organizationId, {
			type: "invite.created",
			actorId: inviter.id,
			subject: id,
			data: { email: input.email, role: input.role },
		});

		this.logger.log({
			message: "Invitation created",
			organizationId,
			role: input.role,
			userId: inviter.id,
		});

		return toInvite(row);
	}

	/** Pending, unexpired invitations of the organization, newest first. */
	async list(organizationId: string): Promise<Invite[]> {
		const rows = await withoutTenant(() =>
			this.db.invitation.findMany({
				where: {
					organizationId,
					status: "pending",
					expiresAt: { gt: new Date() },
				},
				orderBy: { createdAt: "desc" },
				select: INVITE_SELECT,
			}),
		);

		return rows.map(toInvite);
	}

	async revoke(
		organizationId: string,
		id: string,
		inviter: Inviter,
	): Promise<{ id: string }> {
		const row = await this.read(organizationId, id);
		if (!row) {
			throw new NotFoundException("No such invitation in this organization.");
		}

		if (inviter.role !== null) {
			try {
				await auth.api.cancelInvitation({
					headers: inviter.headers,
					body: { invitationId: id },
				});
			} catch (error) {
				fromAuthError(error, "The invitation could not be revoked.");
			}
		} else {
			await withoutTenant(() =>
				this.db.invitation.updateMany({
					where: { id, organizationId },
					data: { status: "canceled" },
				}),
			);
		}

		await this.audit.recordFor(organizationId, {
			type: "invite.revoked",
			actorId: inviter.id,
			subject: id,
			data: { email: row.email },
		});

		this.logger.log({
			message: "Invitation revoked",
			organizationId,
			userId: inviter.id,
		});

		return { id };
	}

	private async createAsMember(
		organizationId: string,
		input: { email: string; role: WorkspaceRole },
		inviter: Inviter,
	): Promise<string> {
		try {
			const created = await auth.api.createInvitation({
				headers: inviter.headers,
				body: {
					email: input.email,
					role: input.role,
					organizationId,
					resend: true,
				},
			});
			return created.id;
		} catch (error) {
			fromAuthError(error, "The invitation could not be created.");
		}
	}

	/**
	 * Support mode: the platform admin is not a member, so better-auth would
	 * refuse. Write the same row better-auth would, after the same checks.
	 */
	private async createAsPlatformAdmin(
		organizationId: string,
		input: { email: string; role: WorkspaceRole },
		inviter: Inviter,
	): Promise<string> {
		return withoutTenant(async () => {
			const existing = await this.db.member.findFirst({
				where: {
					organizationId,
					user: { email: { equals: input.email, mode: "insensitive" } },
				},
				select: { id: true },
			});
			if (existing) {
				throw new BadRequestException(
					"That person is already a member of this organization.",
				);
			}

			const now = new Date();
			const pending = await this.db.invitation.findFirst({
				where: {
					organizationId,
					email: { equals: input.email, mode: "insensitive" },
					status: "pending",
					expiresAt: { gt: now },
				},
				select: { id: true },
			});

			const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

			if (pending) {
				await this.db.invitation.update({
					where: { id: pending.id },
					data: { role: input.role, expiresAt, inviterId: inviter.id },
				});
				return pending.id;
			}

			const created = await this.db.invitation.create({
				data: {
					id: randomUUID(),
					organizationId,
					email: input.email,
					role: input.role,
					status: "pending",
					expiresAt,
					inviterId: inviter.id,
				},
				select: { id: true },
			});
			return created.id;
		});
	}

	private read(organizationId: string, id: string) {
		return withoutTenant(() =>
			this.db.invitation.findFirst({
				where: { id, organizationId },
				select: INVITE_SELECT,
			}),
		);
	}
}

type InviteRow = {
	id: string;
	email: string;
	role: string | null;
	expiresAt: Date;
	createdAt: Date;
	user: { id: string; name: string; email: string } | null;
};

function toInvite(row: InviteRow): Invite {
	return {
		id: row.id,
		email: row.email,
		role: toWorkspaceRole(row.role ?? "member"),
		url: inviteUrl(row.id),
		expiresAt: row.expiresAt.toISOString(),
		createdAt: row.createdAt.toISOString(),
		inviter: row.user,
	};
}

export function assertMayInviteRole(
	role: WorkspaceRole,
	inviter: { role: WorkspaceRole | null },
): void {
	if (role === "owner" && inviter.role !== null && inviter.role !== "owner") {
		throw new ForbiddenException("Only an owner can invite another owner.");
	}
}
