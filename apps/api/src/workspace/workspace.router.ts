import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import type { TenantTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { TenantMiddleware } from "../trpc/middlewares/tenant.middleware";
import {
	memberListInput,
	setMemberRoleInput,
	updateWorkspaceInput,
} from "./workspace.contracts";
import { WorkspaceService } from "./workspace.service";

@Router({ alias: "workspace" })
@UseMiddlewares(AuthMiddleware, TenantMiddleware)
export class WorkspaceRouter {
	constructor(
		@Inject(WorkspaceService) private readonly workspace: WorkspaceService,
	) {}

	/** The current organization — the one named by `x-org-slug`. */
	@Query()
	async get(@Ctx() ctx: TenantTrpcContext) {
		return this.workspace.get(ctx.user.id, ctx.supportMode);
	}

	@Query({ input: memberListInput })
	async members(
		@Ctx() ctx: TenantTrpcContext,
		@Input() input: z.infer<typeof memberListInput>,
	) {
		return this.workspace.members(ctx.user.id, input);
	}

	@Mutation({ input: updateWorkspaceInput })
	async update(
		@Ctx() ctx: TenantTrpcContext,
		@Input() input: z.infer<typeof updateWorkspaceInput>,
	) {
		return this.workspace.update(ctx.user.id, input, ctx.supportMode);
	}

	@Mutation({ input: setMemberRoleInput })
	async setMemberRole(
		@Ctx() ctx: TenantTrpcContext,
		@Input() input: z.infer<typeof setMemberRoleInput>,
	) {
		return this.workspace.setMemberRole(ctx.user.id, input, ctx.supportMode);
	}
}
