/**
 * A per-organization cap as typed into the console: blank means "platform
 * default" (null); anything else must be a whole number no lower than `min`.
 */
export function parseLimit(
	value: string,
	min: number,
): { ok: true; value: number | null } | { ok: false } {
	const trimmed = value.trim();
	if (trimmed === "") return { ok: true, value: null };
	if (!/^\d+$/.test(trimmed)) return { ok: false };
	const parsed = Number(trimmed);
	return parsed >= min ? { ok: true, value: parsed } : { ok: false };
}
