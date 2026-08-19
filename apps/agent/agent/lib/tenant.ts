import { db, runWithTenant, tenantIdOrNull, withoutTenant } from "@crm/db";
import { z } from "zod";

/**
 * The agent's side of the tenant boundary.
 *
 * Every session the agent runs carries the organization it works for as the
 * `organizationId` auth attribute: the app signs it into the bridge token, and
 * dispatch stamps it onto the auth of every task, builder chat and deployed run
 * it starts. Tools, hooks and channel events read it back from `ctx.session.auth`
 * and run inside `runWithTenant`, so every query they make is scoped. A session
 * that names no organization runs unscoped, and any query it makes on a tenant
 * model fails closed.
 *
 * Dispatch loops are platform code: they list candidate work across every
 * organization with `acrossTenants` and run each unit inside the unit's own
 * organization.
 */

export const ORGANIZATION_ATTRIBUTE = "organizationId";

type SessionAttributes = Readonly<Record<string, string | readonly string[]>>;

type Principal = { readonly attributes: SessionAttributes } | null;

export type TenantContext = {
	readonly session: {
		readonly auth: {
			readonly current: Principal;
			readonly initiator: Principal;
		};
	};
};

const attributeText = z.string().trim().min(1).nullable().catch(null);

/**
 * The organization a session belongs to: the one it was started in. A later
 * caller who presents another organization is refused rather than silently
 * moved, so a session's history can never be read from the wrong tenant.
 */
export function sessionOrganizationId(ctx: TenantContext): string | null {
	const initiator = attributeText.parse(
		ctx.session.auth.initiator?.attributes[ORGANIZATION_ATTRIBUTE],
	);
	const current = attributeText.parse(
		ctx.session.auth.current?.attributes[ORGANIZATION_ATTRIBUTE],
	);

	if (initiator && current && initiator !== current) {
		throw new Error("This session belongs to another organization.");
	}

	return initiator ?? current;
}

export function requireSessionOrganizationId(ctx: TenantContext): string {
	const organizationId = sessionOrganizationId(ctx);
	if (!organizationId) {
		throw new Error("This session is not attached to an organization.");
	}
	return organizationId;
}

/**
 * Run `fn` inside the session's organization. A session that names none runs
 * `fn` unscoped: anything it then asks of a tenant model throws
 * `TenantContextMissing`, which is the boundary failing closed.
 */
export function inSessionTenant<T>(ctx: TenantContext, fn: () => T): T {
	const organizationId = sessionOrganizationId(ctx);
	return organizationId ? runWithTenant(organizationId, fn) : fn();
}

/**
 * Select candidate work across every organization. Platform loops (dispatch,
 * reconciliation, backfills) run outside any tenant and see everything; the
 * same code called inside a tenant — a test, or a per-org run — stays inside
 * it. Every unit of work selected this way is then executed under
 * `runWithTenant(row.organizationId, …)`.
 */
export function acrossTenants<T>(fn: () => T): T {
	return tenantIdOrNull() ? fn() : withoutTenant(fn);
}

/** Stamp the organization onto the auth a session is started with. */
export function withOrganization<
	T extends {
		attributes: Readonly<Record<string, string | readonly string[]>>;
	},
>(auth: T, organizationId: string): T {
	return {
		...auth,
		attributes: {
			...auth.attributes,
			[ORGANIZATION_ATTRIBUTE]: organizationId,
		},
	};
}

export const ORGANIZATION_ID_HEADER = "x-organization-id";
export const ORGANIZATION_SLUG_HEADER = "x-org-slug";

const bodyOrganization = z
	.object({ organizationId: attributeText })
	.catch({ organizationId: null });

/**
 * The organization an internal bridge request (`/internal/crm/*`, authorised
 * by the shared bridge secret) is about: the `x-organization-id` header, the
 * `x-org-slug` header, or `organizationId` in the JSON body — whichever the
 * caller sent, resolved against the Organization table.
 */
export async function organizationFromRequest(
	request: Request,
	body?: unknown,
): Promise<string | null> {
	const id =
		attributeText.parse(request.headers.get(ORGANIZATION_ID_HEADER)) ??
		bodyOrganization.parse(body).organizationId;
	if (id) {
		const row = await db.organization.findUnique({
			where: { id },
			select: { id: true },
		});
		return row?.id ?? null;
	}

	const slug = attributeText.parse(
		request.headers.get(ORGANIZATION_SLUG_HEADER),
	);
	return slug ? organizationIdBySlug(slug) : null;
}

export async function organizationIdBySlug(
	slug: string,
): Promise<string | null> {
	const row = await db.organization.findFirst({
		where: { slug },
		select: { id: true },
	});
	return row?.id ?? null;
}

/** Whether the user belongs to the organization (Member is a global table: no tenant needed). */
export async function isMemberOf(
	userId: string,
	organizationId: string,
): Promise<boolean> {
	const count = await db.member.count({ where: { userId, organizationId } });
	return count > 0;
}

/* ---------------------------------------------------------------------------
 * Per-organization settings and limits (Organization.settings / Organization.limits)
 * ------------------------------------------------------------------------- */

export const DEFAULT_AGENT_TASKS_PER_DAY = 200;

const limitsShape = z
	.object({
		agentTasksPerDay: z.number().int().min(0).nullable().catch(null),
	})
	.catch({ agentTasksPerDay: null });

/** The organization's daily agent task cap (`limits.agentTasksPerDay`), or the platform default. */
export function agentTasksPerDay(limits: unknown): number {
	return (
		limitsShape.parse(limits ?? {}).agentTasksPerDay ??
		DEFAULT_AGENT_TASKS_PER_DAY
	);
}

export type OrgSettingKey =
	| "contextDevApiKey"
	| "perplexityApiKey"
	| "agentModelId"
	| "agentModelContextWindow";

const ENV_FOR: Readonly<Record<OrgSettingKey, string | null>> = {
	contextDevApiKey: "CONTEXT_DEV_API_KEY",
	perplexityApiKey: "PERPLEXITY_API_KEY",
	agentModelId: null,
	agentModelContextWindow: null,
};

const settingText = z
	.union([z.string(), z.number()])
	.transform((value) => String(value).trim())
	.refine((value) => value.length > 0)
	.nullable()
	.catch(null);

const settingsShape = z.record(z.string(), z.unknown()).catch({});

const SETTINGS_TTL_MS = 15_000;

const settingsCache = new Map<
	string,
	{ at: number; settings: Record<string, unknown> }
>();

async function organizationSettings(
	organizationId: string,
): Promise<Record<string, unknown>> {
	const cached = settingsCache.get(organizationId);
	if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) {
		return cached.settings;
	}

	const row = await db.organization.findUnique({
		where: { id: organizationId },
		select: { settings: true },
	});
	const settings = settingsShape.parse(row?.settings ?? {});
	settingsCache.set(organizationId, { at: Date.now(), settings });
	return settings;
}

/** Drop the cached Organization.settings (tests, or after an admin edit the agent is told about). */
export function forgetOrganizationSettings(organizationId?: string): void {
	if (organizationId) settingsCache.delete(organizationId);
	else settingsCache.clear();
}

/** The platform-level value for a key: the environment, or nothing. */
export function platformSetting(key: OrgSettingKey): string | null {
	const env = ENV_FOR[key];
	return env ? process.env[env]?.trim() || null : null;
}

/**
 * Resolve a key for the current organization: the organization's own override
 * (`Organization.settings`, set by a platform admin) wins over the platform
 * value from the environment. Outside a tenant only the environment applies.
 * The organization's *member-facing* setting (AppSetting, Settings → General)
 * is read by the callers first; this is the fallback chain beneath it.
 */
export async function resolveOrgSetting(
	key: OrgSettingKey,
): Promise<string | null> {
	const organizationId = tenantIdOrNull();

	if (organizationId) {
		try {
			const override = settingText.parse(
				(await organizationSettings(organizationId))[key],
			);
			if (override) return override;
		} catch (error) {
			console.error(
				`[agent] could not read organization settings for ${organizationId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	return platformSetting(key);
}
