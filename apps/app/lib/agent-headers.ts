"use client";

import { orgSlugHeaders } from "@/lib/org-slug";

/**
 * Headers for a call to the agent bridge (`/eve/v1/*`): the organization the
 * page is for, plus whatever the caller adds (the record being discussed, the
 * builder conversation). The bridge refuses a call that names no
 * organization, so every call goes through here.
 */
export function agentHeaders(extra: Record<string, string> = {}) {
	return { ...orgSlugHeaders(window.location.pathname), ...extra };
}
