import "@crm/env/load";

import { db, tenantIdOrNull } from "@crm/db";
import { readContextDevKey } from "@crm/db/settings";
import { platformSetting, resolveOrgSetting } from "./tenant";

export const CONTEXT_DEV = "CONTEXT_DEV";

export const CONTEXT_DEV_PEOPLE = "CONTEXT_DEV_PEOPLE";

export const CONTEXT_DEV_SOURCE = "Context.dev key (Settings → General)";

export type Capability = {
	readonly id: string;
	readonly label: string;
	readonly gives: string;
	readonly enabled: boolean;
	readonly from: string;
};

/**
 * The Context.dev key for the current organization: what its members entered
 * in Settings → General, else the override a platform admin set on the
 * organization, else the platform's own `CONTEXT_DEV_API_KEY`. Outside a
 * tenant only the platform key applies.
 */
export async function contextDevKey(): Promise<string | null> {
	if (tenantIdOrNull()) {
		try {
			const own = await readContextDevKey(db);
			if (own) return own;
		} catch (error) {
			console.error(
				`[agent] could not read the Context.dev key from the database: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	return resolveOrgSetting("contextDevApiKey");
}

/** The Perplexity key: the organization's override, else the platform's `PERPLEXITY_API_KEY`. */
export function perplexityKey(): Promise<string | null> {
	return resolveOrgSetting("perplexityApiKey");
}

/** The organization's capabilities (inside a tenant), or the platform's (outside one). */
export async function capabilities(): Promise<readonly Capability[]> {
	const [contextDev, perplexity] = await Promise.all([
		contextDevKey(),
		perplexityKey(),
	]);
	return capabilitiesFrom(contextDev, perplexity);
}

export function capabilitiesFrom(
	contextDev: string | null,
	perplexity: string | null = platformSetting("perplexityApiKey"),
): readonly Capability[] {
	const fromEnv = (id: string) => ({
		id,
		from: id,
		enabled: Boolean(process.env[id]?.trim()),
	});

	return [
		{
			id: "PERPLEXITY_API_KEY",
			from: "PERPLEXITY_API_KEY",
			enabled: perplexity !== null,
			label: "Web research",
			gives:
				"open-web context with citations, and the search that finds a LinkedIn slug in the first place",
		},
		{
			id: CONTEXT_DEV,
			from: "Settings → General",
			label: "Company brand data",
			gives: "a company's logo, industry, location and socials from its domain",
			enabled: contextDev !== null,
		},
		{
			id: CONTEXT_DEV_PEOPLE,
			from: "Settings → General",
			label: "LinkedIn",
			gives:
				"a person read back from a LinkedIn URL you already hold — their real name, bio, current title and employer, every earlier role with its dates, their education and their other public profiles, all self-reported and so authoritative on identity",
			enabled: contextDev !== null,
		},
		{
			...fromEnv("BLOB_READ_WRITE_TOKEN"),
			label: "Picture storage",
			gives:
				"somewhere to keep a logo or a profile photo. Without it a record has no picture at all, because the URLs these sources hand back expire and are never stored as they are",
		},
	];
}

export async function enabled(id: string): Promise<boolean> {
	return (await capabilities()).some(
		(capability) => capability.id === id && capability.enabled,
	);
}

export type UnavailableCapability = {
	ok: false;
	configured: false;
	reason: string;
};

export function unavailable(env: string): UnavailableCapability {
	return {
		ok: false,
		configured: false,
		reason:
			`This install has no ${env}, so that source is unavailable. This is not a failure and retrying will not help — ` +
			"use what the CRM already knows, and say in your write-up what you could not check.",
	};
}

/**
 * What the platform itself provides, from the environment alone. Startup has
 * no organization to read settings for; each organization's own capabilities
 * are logged when one of its sessions starts (see `logCapabilities`).
 */
export function logPlatformCapabilities(): void {
	const all = capabilitiesFrom(
		platformSetting("contextDevApiKey"),
		platformSetting("perplexityApiKey"),
	);
	for (const capability of all) {
		console.log(
			`[agent] platform ${capability.enabled ? "on " : "off"}  ${capability.label} (${capability.from})`,
		);
	}
}

const loggedOrganizations = new Set<string>();

/** Log the current organization's capabilities once per process. */
export async function logCapabilities(): Promise<void> {
	const organizationId = tenantIdOrNull();
	if (!organizationId || loggedOrganizations.has(organizationId)) return;
	loggedOrganizations.add(organizationId);

	for (const capability of await capabilities()) {
		console.log(
			`[agent] ${organizationId} ${capability.enabled ? "on " : "off"}  ${capability.label} (${capability.from})`,
		);
	}
}

export async function capabilitiesMarkdown(): Promise<string> {
	return markdownFor(await capabilities());
}

export function markdownFor(all: readonly Capability[]): string {
	const on = all.filter((capability) => capability.enabled);
	const off = all.filter((capability) => !capability.enabled);

	const lines = ["## What you can use here", ""];

	if (on.length === 0) {
		lines.push(
			"No outside sources are configured on this install. Everything you can",
			"learn is already in the CRM — email threads, meetings, signature",
			"blocks — and `read_crm_history` reads all of it for free. That is",
			"often enough to settle who somebody is. Record what it shows, and",
			"leave the rest empty.",
		);
		return lines.join("\n");
	}

	lines.push("Available:");
	for (const capability of on) {
		lines.push(`- **${capability.label}** — ${capability.gives}.`);
	}

	if (off.length > 0) {
		lines.push("", "Not configured here, so do not plan around them:");
		for (const capability of off) {
			lines.push(`- ${capability.label}`);
		}
		lines.push(
			"",
			"Their tools will tell you the same thing if you call them. Note what",
			"you could not check rather than guessing at it.",
		);
	}

	return lines.join("\n");
}
