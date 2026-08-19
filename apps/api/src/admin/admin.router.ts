import { runWithTenant } from "@crm/db";
import { Inject } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import { adminAuditLogInput } from "../audit/audit.contracts";
import { AuditService } from "../audit/audit.service";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { PlatformAdminMiddleware } from "../trpc/middlewares/platform-admin.middleware";
import {
	createOrganizationInput,
	orgIdInput,
	updateOrganizationInput,
} from "./admin.contracts";
import { AdminService, type PlatformAdmin } from "./admin.service";

function adminOf(ctx: AuthedTrpcContext): PlatformAdmin {
	return {
		id: ctx.user.id,
		email: ctx.user.email,
		headers: fromNodeHeaders(ctx.req?.headers ?? {}),
	};
}

/** Platform console: platform admins only, reads across organizations. */
@Router({ alias: "admin" })
@UseMiddlewares(AuthMiddleware, PlatformAdminMiddleware)
export class AdminRouter {
	constructor(
		@Inject(AdminService) private readonly admin: AdminService,
		@Inject(AuditService) private readonly audit: AuditService,
	) {}

	@Query()
	async listOrganizations() {
		return this.admin.listOrganizations();
	}

	@Mutation({ input: createOrganizationInput })
	async createOrganization(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof createOrganizationInput>,
	) {
		return this.admin.createOrganization(input, adminOf(ctx));
	}

	@Mutation({ input: updateOrganizationInput })
	async updateOrganization(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof updateOrganizationInput>,
	) {
		return this.admin.updateOrganization(input, adminOf(ctx));
	}

	@Mutation({ input: orgIdInput })
	async suspend(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof orgIdInput>,
	) {
		return this.admin.suspend(input.id, adminOf(ctx));
	}

	@Mutation({ input: orgIdInput })
	async unsuspend(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof orgIdInput>,
	) {
		return this.admin.unsuspend(input.id, adminOf(ctx));
	}

	@Mutation({ input: orgIdInput })
	async deleteOrganization(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof orgIdInput>,
	) {
		return this.admin.deleteOrganization(input.id, adminOf(ctx));
	}

	@Query({ input: adminAuditLogInput })
	async auditLog(@Input() input: z.infer<typeof adminAuditLogInput>) {
		const { organizationId, ...page } = input;
		return runWithTenant(organizationId, () => this.audit.list(page));
	}
}
