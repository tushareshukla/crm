import { plainToInstance, Type } from "class-transformer";
import {
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	IsUrl,
	Max,
	Min,
	MinLength,
	validateSync,
} from "class-validator";

export enum NodeEnv {
	Development = "development",
	Production = "production",
	Test = "test",
}

export class EnvironmentVariables {
	@IsEnum(NodeEnv)
	NODE_ENV: NodeEnv = NodeEnv.Development;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(65535)
	PORT = 3001;

	@IsString()
	@MinLength(1, {
		message:
			"DATABASE_URL is required. `docker compose up -d` starts one, or set it to any Postgres connection string.",
	})
	DATABASE_URL!: string;

	@IsString()
	@MinLength(32, {
		message:
			"BETTER_AUTH_SECRET must be at least 32 characters. Generate one with: openssl rand -base64 32",
	})
	BETTER_AUTH_SECRET!: string;

	// Invite-only tenancy: accounts are created by platform admins or through
	// invitations. ALLOWED_SIGN_IN is an optional escape hatch (domain/address
	// allow-list). At least one of PLATFORM_ADMINS / ALLOWED_SIGN_IN must be set
	// or nobody can ever get in — checked in validateEnv below.
	@IsOptional()
	@IsString()
	ALLOWED_SIGN_IN?: string;

	@IsOptional()
	@IsString()
	GOOGLE_CLIENT_ID?: string;

	@IsOptional()
	@IsString()
	GOOGLE_CLIENT_SECRET?: string;

	@IsOptional()
	@IsString()
	MICROSOFT_CLIENT_ID?: string;

	@IsOptional()
	@IsString()
	MICROSOFT_CLIENT_SECRET?: string;

	@IsOptional()
	@IsString()
	MICROSOFT_TENANT_ID?: string;

	@IsOptional()
	@IsString()
	SLACK_CLIENT_ID?: string;

	@IsOptional()
	@IsString()
	SLACK_CLIENT_SECRET?: string;

	@IsOptional()
	@IsUrl({ require_tld: false })
	API_URL?: string;

	@IsOptional()
	@IsString()
	APP_URL?: string;

	@IsOptional()
	@IsString()
	AUTH_COOKIE_DOMAIN?: string;

	@IsOptional()
	@IsString()
	REDIS_URL?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	CACHE_TTL_MS?: number;

	@IsOptional()
	@IsString()
	@MinLength(16, {
		message: "CRON_SECRET must be at least 16 characters.",
	})
	CRON_SECRET?: string;

	@IsOptional()
	@IsString()
	BLOB_READ_WRITE_TOKEN?: string;

	@IsOptional()
	@IsUrl(
		{ require_tld: false, require_protocol: true },
		{
			message:
				"AGENT_URL must be a full URL with a scheme, like http://127.0.0.1:2000.",
		},
	)
	AGENT_URL?: string;

	@IsOptional()
	@IsString()
	AGENT_BRIDGE_SECRET?: string;

	@IsOptional()
	@IsString()
	CRM_TELEMETRY_DISABLED?: string;

	@IsOptional()
	@IsString()
	CRM_TELEMETRY_ENABLED?: string;

	@IsOptional()
	@IsString()
	POSTHOG_KEY?: string;

	/** Comma-separated emails allowed into /admin and into any organization (support mode). */
	@IsOptional()
	@IsString()
	PLATFORM_ADMINS?: string;
}

export type RawEnvironment = Record<string, string | undefined>;

export function validateEnv(config: RawEnvironment): EnvironmentVariables {
	const validated = plainToInstance(EnvironmentVariables, config, {
		enableImplicitConversion: true,
		exposeDefaultValues: true,
	});

	const errors = validateSync(validated, {
		skipMissingProperties: false,
		whitelist: false,
	});

	const hasAdmins = Boolean(validated.PLATFORM_ADMINS?.trim());
	const hasAllowList = Boolean(validated.ALLOWED_SIGN_IN?.trim());
	if (!hasAdmins && !hasAllowList) {
		throw new Error(
			"Invalid environment configuration:\n  - Set PLATFORM_ADMINS (comma-separated emails of the people who create organizations) — or ALLOWED_SIGN_IN as an allow-list — otherwise nobody can sign in.\n\nSee .env.example at the root of the repo.",
		);
	}

	if (errors.length > 0) {
		const details = errors
			.map((error) => Object.values(error.constraints ?? {}).join(", "))
			.join("\n  - ");

		throw new Error(
			`Invalid environment configuration:\n  - ${details}\n\nSee .env.example at the root of the repo.`,
		);
	}

	return validated;
}
