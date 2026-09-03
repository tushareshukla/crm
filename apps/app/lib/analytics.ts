// Empty in this fork: no hostname is allowed, so posthog-js is never loaded
// and never initialised on the landing page. Add a hostname here to turn
// browser analytics back on for that domain only.
export const ANALYTICS_HOSTS: readonly string[] = [];

export function analyticsAllowed(hostname: string): boolean {
	return ANALYTICS_HOSTS.includes(hostname.trim().toLowerCase());
}
