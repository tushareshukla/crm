import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import type { AuthedTrpcContext } from "../context.types";

/**
 * Platform console: the caller's email must be on PLATFORM_ADMINS. Runs after
 * `AuthMiddleware`. Procedures behind it are platform-level and read across
 * organizations with `withoutTenant` — audit every use.
 */
@Injectable()
export class PlatformAdminMiddleware implements TRPCMiddleware {
	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as AuthedTrpcContext;

		if (!ctx.platformAdmin) {
			throw new TRPCError({ code: "FORBIDDEN", message: "not-platform-admin" });
		}

		return opts.next({ ctx });
	}
}
