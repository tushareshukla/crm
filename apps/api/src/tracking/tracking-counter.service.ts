import { currentTenantId, type Db } from "@crm/db";
import { windowExpiry } from "@crm/db/tracking";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";

/**
 * Counters are per organization. The table's key is global, so the stored key
 * is `${window}:${organizationId}` — `windowExpiry` still reads the window from
 * the first two segments. Raw SQL bypasses the tenant extension; the
 * organization is written by hand. Runs inside tenant scope.
 */
export function scopedCounterKey(key: string): string {
	return `${key}:${currentTenantId()}`;
}

@Injectable()
export class TrackingCounterService {
	private readonly logger = new Logger(TrackingCounterService.name);

	constructor(@InjectDatabase() private readonly db: Db) {}

	async take(key: string, limit: number, amount = 1): Promise<boolean> {
		if (amount <= 0) return true;
		if (amount > limit) return false;

		const organizationId = currentTenantId();
		const scoped = scopedCounterKey(key);

		try {
			const charged = await this.db.$queryRaw<{ value: number }[]>`
				INSERT INTO "trackingCounter" ("key", "value", "expiresAt", "organizationId")
				VALUES (${scoped}, ${amount}, ${windowExpiry(key)}, ${organizationId})
				ON CONFLICT ("key") DO UPDATE
					SET "value" = "trackingCounter"."value" + ${amount}
					WHERE "trackingCounter"."value" + ${amount} <= ${limit}
				RETURNING "value";
			`;

			return charged.length > 0;
		} catch (error) {
			this.logger.error(
				{ message: "Tracking counter could not be read — refusing the write" },
				error instanceof Error ? error.stack : String(error),
			);

			return false;
		}
	}

	async release(key: string, amount = 1): Promise<void> {
		const organizationId = currentTenantId();
		const scoped = scopedCounterKey(key);

		try {
			await this.db.$executeRaw`
				UPDATE "trackingCounter"
				SET "value" = GREATEST("value" - ${amount}, 0)
				WHERE "key" = ${scoped} AND "organizationId" = ${organizationId};
			`;
		} catch (error) {
			this.logger.error(
				{ message: "Tracking counter could not be released" },
				error instanceof Error ? error.stack : String(error),
			);
		}
	}

	/** Expired windows of every organization — callers run it `withoutTenant`. */
	async sweep(): Promise<number> {
		const removed = await this.db.trackingCounter.deleteMany({
			where: { expiresAt: { lt: new Date() } },
		});

		return removed.count;
	}
}
