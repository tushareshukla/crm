/** Mirrors `MAX_SLUG` in `@crm/db/workspace`; the API enforces it. */
export const MAX_SLUG = 48;

/**
 * An organization address derived from its name, the way the API derives
 * one: lowercase letters, digits and single dashes. The API has the final
 * word (reserved words, uniqueness) — this only previews it as the rep types.
 *
 * Kept in the app rather than imported from `@crm/db/workspace` because that
 * module pulls in the tenant context (`node:async_hooks`), which a client
 * bundle cannot carry.
 */
export function slugify(name: string): string {
	return name
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, MAX_SLUG)
		.replace(/^-+|-+$/g, "");
}

/** What the slug field shows while it is being typed: lowercase, dashes, no trailing trim yet. */
export function slugDraft(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+/, "")
		.slice(0, MAX_SLUG);
}
