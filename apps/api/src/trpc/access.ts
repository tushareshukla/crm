import { isWorkspaceAdmin } from "@crm/auth";
import { TRPCError } from "@trpc/server";
import type { TenantTrpcContext } from "./context.types";

/** Owner or admin of the current organization — or a platform admin in support mode. */
export function canAdministerOrg(ctx: TenantTrpcContext): boolean {
	return ctx.supportMode || isWorkspaceAdmin(ctx.role);
}

export function assertOrgAdmin(
	ctx: TenantTrpcContext,
	message = "Only an owner or an admin can do that.",
): void {
	if (!canAdministerOrg(ctx)) {
		throw new TRPCError({ code: "FORBIDDEN", message });
	}
}
