/**
 * Workspace (organization) naming and onboarding rules — pure, client-safe.
 * Server code imports these through ./workspace which re-exports them.
 */
import { type JsonObject, type JsonValue, jsonObject, jsonText } from "./json";

export const DEFAULT_WORKSPACE_SLUG = "workspace";

export const MAX_SLUG = 48;

export const RESERVED_SLUGS: readonly string[] = [
	"_next",
	"admin",
	"api",
	"agent",
	"agents",
	"chat",
	"companies",
	"contacts",
	"deals",
	"eve",
	"grant-access",
	"onboarding",
	"invite",
	"settings",
	"sign-in",
	"t",
	"welcome",
];

export function workspaceSlug(name: string): string {
	const base = name
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, MAX_SLUG)
		.replace(/^-+|-+$/g, "");

	if (!base) return DEFAULT_WORKSPACE_SLUG;

	return RESERVED_SLUGS.includes(base) ? `${base}-crm` : base;
}

export const MAX_NARRATIVE = 320;

export const MAX_LINE = 140;

export function isOnboarded(metadata: string | null): boolean {
	return jsonText(readMetadata(metadata).onboardedAt) !== undefined;
}

export function markOnboarded(metadata: string | null, at: Date): string {
	const current = readMetadata(metadata);

	return JSON.stringify(
		jsonText(current.onboardedAt) === undefined
			? { ...current, onboardedAt: at.toISOString() }
			: current,
	);
}

function readMetadata(metadata: string | null): JsonObject {
	if (!metadata) return {};

	try {
		const parsed: JsonValue = JSON.parse(metadata);

		return jsonObject(parsed);
	} catch {
		return {};
	}
}
