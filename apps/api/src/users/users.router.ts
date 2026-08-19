import { Inject } from "@nestjs/common";
import { Ctx, Query, Router, UseMiddlewares } from "nestjs-trpc";
import { AuthService } from "../auth/auth.service";
import type { AuthedTrpcContext } from "../trpc/context.types";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { TenantMiddleware } from "../trpc/middlewares/tenant.middleware";
import { UsersService } from "./users.service";

@Router({ alias: "users" })
@UseMiddlewares(AuthMiddleware)
export class UsersRouter {
	constructor(
		@Inject(UsersService) private readonly users: UsersService,
		@Inject(AuthService) private readonly auth: AuthService,
	) {}

	/** Tenant-free: only reads the signed-in user. */
	@Query()
	async me(@Ctx() ctx: AuthedTrpcContext) {
		const profile = await this.auth.getProfile(ctx.user.id);
		return { ...profile, platformAdmin: ctx.platformAdmin };
	}

	/** Members of the current organization (owner pickers, mentions). */
	@Query()
	@UseMiddlewares(TenantMiddleware)
	async list() {
		return this.users.list();
	}
}
