import { currentTenantId, type Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

@Injectable()
export class TrackingRollupService {
	constructor(@InjectDatabase() private readonly db: Db) {}

	/** Raw SQL bypasses the tenant extension, so the organization is pinned by hand. Runs inside tenant scope. */
	async run(before: Date): Promise<number> {
		const organizationId = currentTenantId();

		const rolled = await this.db.$executeRaw`
			INSERT INTO "trackedPageDaily" ("organizationId", "day", "host", "path", "views", "visitors")
			SELECT
				${organizationId},
				date_trunc('day', "occurredAt") AS "day",
				"host",
				"path",
				count(*)::int AS "views",
				count(DISTINCT "visitorId")::int AS "visitors"
			FROM "trackedEvent"
			WHERE "organizationId" = ${organizationId}
				AND "occurredAt" < ${before} AND "type" = 'page_view'
			GROUP BY 2, 3, 4
			ON CONFLICT ("day", "host", "path") DO UPDATE
			SET "views" = GREATEST("trackedPageDaily"."views", EXCLUDED."views"),
				"visitors" = GREATEST("trackedPageDaily"."visitors", EXCLUDED."visitors");
		`;

		return rolled;
	}
}
