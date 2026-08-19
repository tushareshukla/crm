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
import type { AuthedTrpcContext, BaseTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { acceptInvitationInput, orgSlugInput } from "./orgs.contracts";
import { OrgsService } from "./orgs.service";

function headersOf(ctx: BaseTrpcContext): Headers {
	return fromNodeHeaders(ctx.req?.headers ?? {});
}

/** Tenant-free: these run before (or while choosing) an organization. */
@Router({ alias: "orgs" })
@UseMiddlewares(AuthMiddleware)
export class OrgsRouter {
	constructor(@Inject(OrgsService) private readonly orgs: OrgsService) {}

	@Query()
	async mine(@Ctx() ctx: AuthedTrpcContext) {
		return this.orgs.mine(ctx.user.id);
	}

	@Query({ input: orgSlugInput })
	async get(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof orgSlugInput>,
	) {
		return this.orgs.get(input.slug, ctx.user);
	}

	@Mutation({ input: orgSlugInput })
	async switchTo(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof orgSlugInput>,
	) {
		return this.orgs.switchTo(input.slug, ctx.user, headersOf(ctx));
	}

	@Mutation({ input: acceptInvitationInput })
	async acceptInvitation(
		@Ctx() ctx: AuthedTrpcContext,
		@Input() input: z.infer<typeof acceptInvitationInput>,
	) {
		return this.orgs.acceptInvitation(
			input.invitationId,
			ctx.user,
			headersOf(ctx),
		);
	}
}
