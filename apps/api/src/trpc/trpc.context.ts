import {
	auth,
	type Session,
	toWorkspaceRole,
	type WorkspaceRole,
} from "@crm/auth";
import { isPlatformAdmin } from "@crm/auth/organization";
import { type Db, withoutTenant } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { ContextOptions, TRPCContext } from "nestjs-trpc";
import { InjectDatabase } from "../database/database.constants";
import type { BaseTrpcContext, OrgContext } from "./context.types";

export const ORG_SLUG_HEADER = "x-org-slug";

@Injectable()
export class TrpcContext implements TRPCContext {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async create(opts: ContextOptions): Promise<BaseTrpcContext> {
		const req = "req" in opts ? opts.req : undefined;
		const session = req
			? await auth.api
					.getSession({ headers: fromNodeHeaders(req.headers) })
					.catch(() => null)
			: null;

		const base: BaseTrpcContext = {
			req,
			session,
			org: null,
			role: null,
			platformAdmin: false,
		};

		if (!session) return base;

		const platformAdmin = isPlatformAdmin(session.user.email);
		const org = await this.resolveOrg(
			headerSlug(req?.headers[ORG_SLUG_HEADER]),
			activeOrganizationId(session),
		);

		if (!org) return { ...base, platformAdmin };

		const role = await this.roleOf(session.user.id, org.id);

		return { ...base, org, role, platformAdmin };
	}

	/**
	 * Organization and membership are global models, read outside tenant scope —
	 * this is the lookup that establishes the scope.
	 */
	private async resolveOrg(
		slug: string | null,
		activeOrganizationId: string | null,
	): Promise<OrgContext | null> {
		const select = { id: true, slug: true, name: true, status: true } as const;

		return withoutTenant(() => {
			if (slug) {
				return this.db.organization.findUnique({ where: { slug }, select });
			}
			if (activeOrganizationId) {
				return this.db.organization.findUnique({
					where: { id: activeOrganizationId },
					select,
				});
			}
			return Promise.resolve(null);
		});
	}

	private async roleOf(
		userId: string,
		organizationId: string,
	): Promise<WorkspaceRole | null> {
		const member = await withoutTenant(() =>
			this.db.member.findUnique({
				where: { organizationId_userId: { organizationId, userId } },
				select: { role: true },
			}),
		);

		return member ? toWorkspaceRole(member.role) : null;
	}
}

/** Set by the organization plugin's session hook; not part of the inferred Session type. */
function activeOrganizationId(session: Session): string | null {
	const value = (session.session as { activeOrganizationId?: string | null })
		.activeOrganizationId;

	return value ? value : null;
}

function headerSlug(value: string | string[] | undefined): string | null {
	const raw = Array.isArray(value) ? value[0] : value;
	const slug = raw?.trim().toLowerCase();

	return slug ? slug : null;
}
