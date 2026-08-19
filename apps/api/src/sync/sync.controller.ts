import type { Db } from "@crm/db";
import {
	Controller,
	ForbiddenException,
	Get,
	Headers,
	Logger,
	Post,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { InjectDatabase } from "../database/database.constants";
import { forEachActiveOrganization } from "../tenancy/organizations";
import { MailboxSyncService, type TickSummary } from "./mailbox-sync.service";

type CronTick = TickSummary & {
	organizations: number;
	failedOrganizations: string[];
};

@Controller("internal/sync")
export class SyncController {
	private readonly logger = new Logger(SyncController.name);
	private readonly secret: string | undefined;

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly sync: MailboxSyncService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get("mailboxes")
	@AllowAnonymous()
	async mailboxesViaGet(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Post("mailboxes")
	@AllowAnonymous()
	async mailboxesViaPost(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Get("google")
	@AllowAnonymous()
	async googleViaGet(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Post("google")
	@AllowAnonymous()
	async googleViaPost(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	private async run(authorization?: string) {
		if (!this.secret) {
			this.logger.error({
				message: "CRON_SECRET is not set — refusing to run the sync route.",
			});
			throw new ServiceUnavailableException("Sync is not configured.");
		}

		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}

		// Cron: platform-level loop, one scoped tick per active organization.
		const outcomes = await forEachActiveOrganization(
			this.db,
			() => this.sync.runDue(),
			this.logger,
		);

		const tick: CronTick = {
			attempted: 0,
			synced: 0,
			skipped: 0,
			rateLimited: 0,
			failed: 0,
			durationMs: 0,
			organizations: outcomes.length,
			failedOrganizations: [],
		};

		for (const outcome of outcomes) {
			if (!outcome.ok) {
				tick.failedOrganizations.push(outcome.org.slug);
				continue;
			}
			tick.attempted += outcome.result.attempted;
			tick.synced += outcome.result.synced;
			tick.skipped += outcome.result.skipped;
			tick.rateLimited += outcome.result.rateLimited;
			tick.failed += outcome.result.failed;
			tick.durationMs += outcome.result.durationMs;
		}

		return tick;
	}
}

function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}

	return mismatch === 0;
}
