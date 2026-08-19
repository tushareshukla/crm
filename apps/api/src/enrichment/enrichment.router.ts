import { enrichmentQueueInput } from "@crm/validation/enrichment-queue";
import { Inject } from "@nestjs/common";
import { Input, Query, Router, UseMiddlewares } from "nestjs-trpc";
import type { z } from "zod";
import { AuthMiddleware } from "../trpc/middlewares/auth.middleware";
import { TenantMiddleware } from "../trpc/middlewares/tenant.middleware";
import { EnrichmentService } from "./enrichment.service";

@Router({ alias: "enrichment" })
@UseMiddlewares(AuthMiddleware, TenantMiddleware)
export class EnrichmentRouter {
	constructor(
		@Inject(EnrichmentService) private readonly enrichment: EnrichmentService,
	) {}

	@Query({ input: enrichmentQueueInput })
	async queue(@Input() input: z.infer<typeof enrichmentQueueInput>) {
		return this.enrichment.queue(input.limit);
	}
}
