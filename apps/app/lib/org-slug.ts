/**
 * The URL decides the organization: `/<slug>/…` is an organization page, and
 * every call the app makes from it names that organization with an
 * `x-org-slug` header. These first segments are the app's own routes and can
 * never be an organization.
 */
export const ORG_SLUG_HEADER = "x-org-slug";

export const RESERVED_ROUTES: readonly string[] = [
	"_next",
	"admin",
	"api",
	"eve",
	"grant-access",
	"invite",
	"onboarding",
	"sign-in",
	"t",
	"welcome",
];

/**
 * Section paths from before the slug was in the URL (`/companies`,
 * `/settings/members`). They are reserved organization slugs on the API too,
 * so a request for one is sent to the same page in the rep's last-used org.
 */
export const SECTION_ROUTES: readonly string[] = [
	"agents",
	"chat",
	"companies",
	"contacts",
	"deals",
	"settings",
];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isReservedRoute(segment: string): boolean {
	return RESERVED_ROUTES.includes(segment) || SECTION_ROUTES.includes(segment);
}

/** The organization slug a pathname is under, or null for the app's own routes. */
export function orgSlugFromPathname(pathname: string): string | null {
	const [first = ""] = pathname.replace(/^\/+/, "").split("/");
	const slug = first.toLowerCase();

	if (!slug || isReservedRoute(slug) || !SLUG.test(slug)) return null;

	return slug;
}

/** Request headers naming the organization the page at `pathname` belongs to. */
export function orgSlugHeaders(pathname: string): Record<string, string> {
	const slug = orgSlugFromPathname(pathname);

	return slug ? { [ORG_SLUG_HEADER]: slug } : {};
}
