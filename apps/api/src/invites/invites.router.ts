import { currentTenantId } from "@crm/db";
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
import { assertOrgAdmin } from "../trpc/access";
import type { TenantTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { TenantMiddleware } from "../trpc/middlewares/tenant.middleware";
import { createInviteInput, inviteIdInput } from "./invites.contracts";
import {
	assertMayInviteRole,
	type Inviter,
	InvitesService,
} from "./invites.service";

const ONLY_ADMINS = "Only an owner or an admin can manage invitations.";

function inviterOf(ctx: TenantTrpcContext): Inviter {
	return {
		id: ctx.user.id,
		email: ctx.user.email,
		role: ctx.supportMode ? null : ctx.role,
		headers: fromNodeHeaders(ctx.req?.headers ?? {}),
	};
}

@Router({ alias: "invites" })
@UseMiddlewares(AuthMiddleware, TenantMiddleware)
export class InvitesRouter {
	constructor(
		@Inject(InvitesService) private readonly invites: InvitesService,
	) {}

	@Mutation({ input: createInviteInput })
	async create(
		@Ctx() ctx: TenantTrpcContext,
		@Input() input: z.infer<typeof createInviteInput>,
	) {
		assertOrgAdmin(ctx, ONLY_ADMINS);
		const inviter = inviterOf(ctx);
		assertMayInviteRole(input.role, inviter);
		return this.invites.create(currentTenantId(), input, inviter);
	}

	@Query()
	async list(@Ctx() ctx: TenantTrpcContext) {
		assertOrgAdmin(ctx, ONLY_ADMINS);
		return this.invites.list(currentTenantId());
	}

	@Mutation({ input: inviteIdInput })
	async revoke(
		@Ctx() ctx: TenantTrpcContext,
		@Input() input: z.infer<typeof inviteIdInput>,
	) {
		assertOrgAdmin(ctx, ONLY_ADMINS);
		return this.invites.revoke(currentTenantId(), input.id, inviterOf(ctx));
	}
}
