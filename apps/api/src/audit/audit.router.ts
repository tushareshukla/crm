import { Inject } from "@nestjs/common";
import { Ctx, Input, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { assertOrgAdmin } from "../trpc/access";
import type { TenantTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { TenantMiddleware } from "../trpc/middlewares/tenant.middleware";
import { auditListInput } from "./audit.contracts";
import { AuditService } from "./audit.service";

@Router({ alias: "audit" })
@UseMiddlewares(AuthMiddleware, TenantMiddleware)
export class AuditRouter {
	constructor(@Inject(AuditService) private readonly audit: AuditService) {}

	@Query({ input: auditListInput })
	async list(
		@Ctx() ctx: TenantTrpcContext,
		@Input() input: z.infer<typeof auditListInput>,
	) {
		assertOrgAdmin(ctx, "Only an owner or an admin can read the audit log.");
		return this.audit.list(input);
	}
}
