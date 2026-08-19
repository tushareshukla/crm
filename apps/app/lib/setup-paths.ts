import { workspaceUrl } from "@/lib/workspace-url";

/**
 * Setup lives under the organization it sets up: `/<slug>/onboarding` names
 * the company, `/<slug>/onboarding/research` saves its research key. The slug
 * in the URL is what every call from those pages carries, so the right
 * organization is the one that gets named.
 */
export const ONBOARDING_SECTION = "/onboarding";

export const RESEARCH_SECTION = "/onboarding/research";

export function onboardingPath(slug: string): string {
	return workspaceUrl(slug, ONBOARDING_SECTION);
}

export function researchPath(slug: string): string {
	return workspaceUrl(slug, RESEARCH_SECTION);
}
