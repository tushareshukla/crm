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
import { ConversionService } from "./conversion.service";
import { type RateRefresh, RatesService } from "./rates.service";

type OrgRefresh = RateRefresh & {
	slug: string;
	converted: number;
	missing: string[];
};

@Controller("internal/sync")
export class RatesController {
	private readonly logger = new Logger(RatesController.name);
	private readonly secret: string | undefined;

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly rates: RatesService,
		private readonly conversion: ConversionService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get("rates")
	@AllowAnonymous()
	async ratesViaGet(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Post("rates")
	@AllowAnonymous()
	async ratesViaPost(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	private async run(authorization?: string) {
		if (!this.secret) {
			this.logger.error({
				message: "CRON_SECRET is not set — refusing to run the rates route.",
			});
			throw new ServiceUnavailableException("Rate refresh is not configured.");
		}

		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}

		// Cron: each organization has its own reporting currency and deals;
		// quotes are shared, so the service memoises the feed per base currency.
		const outcomes = await forEachActiveOrganization(
			this.db,
			async (org): Promise<OrgRefresh> => {
				const refresh = await this.rates.refresh();
				if (!refresh.ok) {
					return { ...refresh, slug: org.slug, converted: 0, missing: [] };
				}
				const filled = await this.conversion.fillMissing();
				return {
					...refresh,
					slug: org.slug,
					converted: filled.converted,
					missing: filled.missing,
				};
			},
			this.logger,
		);

		const organizations = outcomes.flatMap((outcome) =>
			outcome.ok ? [outcome.result] : [],
		);

		return {
			ok: outcomes.every((outcome) => outcome.ok && outcome.result.ok),
			organizations,
			failedOrganizations: outcomes.flatMap((outcome) =>
				outcome.ok ? [] : [outcome.org.slug],
			),
		};
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
