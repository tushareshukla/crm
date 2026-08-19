import { workspaceUrl } from "@/lib/workspace-url";

export const ADMIN_PATH = "/admin";

export const WELCOME_PATH = "/welcome";

export const SIGN_IN_PATH = "/sign-in";

/** What the app knows about a signed-in rep before an organization is chosen. */
export type Home = {
	platformAdmin: boolean;
	/** Most recently used first, as `orgs.mine` orders them. */
	organizations: readonly { slug: string; status?: string }[];
};

/**
 * Where `/` sends a signed-in rep: their last-used organization, the
 * platform console when they administer the platform and belong to no
 * organization, and otherwise the invite-only welcome page. A suspended
 * organization is skipped — there is nothing to do there.
 */
export function homePath({ platformAdmin, organizations }: Home): string {
	const open = organizations.find((org) => org.status !== "SUSPENDED");

	if (open) return workspaceUrl(open.slug);
	if (platformAdmin) return ADMIN_PATH;

	// Only suspended organizations: their page says so, which beats a welcome
	// page that pretends they belong nowhere.
	const [first] = organizations;

	return first ? workspaceUrl(first.slug) : WELCOME_PATH;
}

/** The organization a link from before the slug was in the URL belongs in. */
export function lastUsedSlug(
	organizations: Home["organizations"],
): string | null {
	const open = organizations.find((org) => org.status !== "SUSPENDED");

	return (open ?? organizations[0])?.slug ?? null;
}

/**
 * A `?next=` value the sign-in page may send the rep back to: a path on this
 * app, nothing that could leave it. `//evil.example` and `https://…` are not
 * paths here.
 */
export function safeNextPath(value: string | null | undefined): string | null {
	if (!value) return null;

	const trimmed = value.trim();

	if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
	if (/^\/[\\\s]/.test(trimmed)) return null;
	if (trimmed === "/" || trimmed.startsWith(`${SIGN_IN_PATH}`)) return null;

	return trimmed;
}

/** The sign-in page, remembering where to go afterwards when that is worth keeping. */
export function signInPath(next?: string | null): string {
	const safe = safeNextPath(next);

	return safe
		? `${SIGN_IN_PATH}?next=${encodeURIComponent(safe)}`
		: SIGN_IN_PATH;
}
