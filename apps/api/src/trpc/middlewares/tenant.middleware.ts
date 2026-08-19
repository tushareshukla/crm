import { OrgStatus, runWithTenant } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import { AuditService } from "../../audit/audit.service";
import { touchMembership } from "../../auth/platform";
import { setRequestOrganizationId } from "../../logging/request-context";
import type { AuthedTrpcContext, TenantTrpcContext } from "../context.types";

/** How often a member's `lastActiveAt` is refreshed by ordinary traffic. */
const TOUCH_EVERY_MS = 60_000;

/**
 * Establishes the tenant for a procedure. Runs after `AuthMiddleware`:
 * the request must name an organization (header `x-org-slug`, else the
 * session's active organization), the caller must be a member of it — or a
 * platform admin entering in support mode, which is written to the
 * organization's audit log — and the organization must not be suspended.
 * The procedure body then runs inside `runWithTenant(org.id)`, so every query
 * on a tenant model is scoped to that organization.
 */
@Injectable()
export class TenantMiddleware implements TRPCMiddleware {
	private readonly logger = new Logger(TenantMiddleware.name);

	/** `${userId}:${organizationId}` → last time lastActiveAt was written. */
	private readonly touched = new Map<string, number>();

	constructor(private readonly audit: AuditService) {}

	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as AuthedTrpcContext;
		const { org, user } = ctx;

		if (!org) {
			throw new TRPCError({ code: "FORBIDDEN", message: "no-organization" });
		}

		const member = ctx.role !== null;

		if (!member && !ctx.platformAdmin) {
			throw new TRPCError({ code: "FORBIDDEN", message: "not-a-member" });
		}

		if (org.status === OrgStatus.SUSPENDED) {
			throw new TRPCError({ code: "FORBIDDEN", message: "suspended" });
		}

		setRequestOrganizationId(org.id);

		if (member) this.touch(user.id, org.id);

		const nextCtx: TenantTrpcContext = { ...ctx, org, supportMode: !member };

		return await runWithTenant(org.id, async () => {
			if (!member) {
				await this.audit.adminEntered({
					organizationId: org.id,
					actorId: user.id,
					sessionId: ctx.session?.session.id ?? "unknown",
					email: user.email,
				});
			}

			return await opts.next({ ctx: nextCtx });
		});
	}

	/** Fire-and-forget; at most once a minute per member so traffic does not turn into writes. */
	private touch(userId: string, organizationId: string): void {
		const key = `${userId}:${organizationId}`;
		const now = Date.now();
		const last = this.touched.get(key);
		if (last !== undefined && now - last < TOUCH_EVERY_MS) return;

		this.touched.set(key, now);
		if (this.touched.size > 10_000) this.touched.clear();

		void touchMembership(userId, organizationId).catch((error: unknown) => {
			this.touched.delete(key);
			this.logger.warn({
				message: "Could not record member activity",
				userId,
				organizationId,
				reason: error instanceof Error ? error.message : String(error),
			});
		});
	}
}
