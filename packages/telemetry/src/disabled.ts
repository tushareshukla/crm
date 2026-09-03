const TRUTHY = new Set(["1", "true", "yes", "on"]);

export const DISABLE_VARIABLES = ["CRM_TELEMETRY_DISABLED", "DO_NOT_TRACK"];

// This fork ships with telemetry off. Nothing is sent unless somebody sets
// this deliberately, so a deploy that forgets the disable variable still
// stays quiet. Set it to "1" to get the upstream behaviour back.
export const ENABLE_VARIABLE = "CRM_TELEMETRY_ENABLED";

export function telemetryDisabled(
	env: Record<string, string | undefined> = process.env,
): boolean {
	if (env.NODE_ENV === "test") return true;

	if (DISABLE_VARIABLES.some((name) => isTruthy(env[name]))) return true;

	return !isTruthy(env[ENABLE_VARIABLE]);
}

function isTruthy(value: string | undefined): boolean {
	return TRUTHY.has((value ?? "").trim().toLowerCase());
}
