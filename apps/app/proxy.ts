import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { isMarketing } from "@/lib/env";
import {
	ADMIN_PATH,
	homePath,
	lastUsedSlug,
	SIGN_IN_PATH,
	signInPath,
	WELCOME_PATH,
} from "@/lib/home";
import {
	type Gate,
	readHome,
	readResearchGate,
	readWorkspaceGate,
	type WorkspaceGate,
} from "@/lib/onboarding";
import {
	ORG_SLUG_HEADER,
	orgSlugFromPathname,
	SECTION_ROUTES,
} from "@/lib/org-slug";
import {
	ONBOARDING_SECTION,
	onboardingPath,
	RESEARCH_SECTION,
	researchPath,
} from "@/lib/setup-paths";
import { workspaceUrl } from "@/lib/workspace-url";

const LANDING_PATH = "/";

const INVITE_PATH = "/invite";

/** Signed-in pages that belong to no organization: the org gates do not apply. */
const UNGATED = [
	"/grant-access",
	"/eve",
	ADMIN_PATH,
	WELCOME_PATH,
	INVITE_PATH,
];

const ANONYMOUS = ["/t"];

/** Section paths from before the slug was in the URL. */
const SECTIONS = SECTION_ROUTES.map((section) => `/${section}`);

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	if (pathname === SIGN_IN_PATH) return NextResponse.next();

	if (isAnonymous(pathname)) return NextResponse.next();

	if (
		getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX }) === null
	) {
		return isPublic(pathname)
			? NextResponse.next()
			: NextResponse.redirect(new URL(signInFor(request), request.nextUrl));
	}

	if (isUngated(pathname)) return passThrough(request);

	const slug = orgSlugFromPathname(pathname);

	if (!slug) return await sendHome(pathname, request);

	// Both answers, every time, and concurrently — so the gate costs one round
	// trip rather than two, and neither answer can be stale. Asked with the slug
	// from the URL, so they are about the organization the page is for.
	const [workspace, research] = await Promise.all([
		readWorkspaceGate(request, slug),
		readResearchGate(request, slug),
	]);

	const target = setupPath(pathname, slug, workspace, research);

	return target === pathname
		? withOrgSlug(request, slug)
		: sendTo(target, request);
}

/**
 * Where a request under `/<slug>` belongs: a setup page while setup is
 * outstanding, the workspace once it is settled, and the page itself
 * otherwise (including while the API cannot say, which fails open).
 */
function setupPath(
	pathname: string,
	slug: string,
	workspace: WorkspaceGate,
	research: Gate,
): string {
	if (workspace.supportMode) {
		return isSetup(pathname, slug) ? workspaceUrl(slug) : pathname;
	}

	if (workspace.gate === "required") return onboardingPath(slug);
	if (research === "required") return researchPath(slug);

	const settled = workspace.gate === "settled" && research === "settled";

	if (settled && isSetup(pathname, slug)) return workspaceUrl(slug);

	return pathname;
}

/**
 * Paths that name no organization: the landing page and links from before
 * the slug was in the URL. Both go to the rep's last-used organization — or
 * the console / welcome page when they have none.
 */
async function sendHome(
	pathname: string,
	request: NextRequest,
): Promise<NextResponse> {
	const legacy = SECTIONS.some((section) => isUnder(pathname, section));

	if (pathname !== LANDING_PATH && !legacy) return passThrough(request);

	const home = await readHome(request);

	if (!home) return passThrough(request);

	if (pathname === LANDING_PATH) return sendTo(homePath(home), request);

	const slug = lastUsedSlug(home.organizations);

	return slug
		? sendTo(workspaceUrl(slug, pathname), request)
		: passThrough(request);
}

/**
 * A page that belongs to no organization: whatever organization header the
 * browser sent is dropped, so nothing downstream can be talked into one.
 */
function passThrough(request: NextRequest): NextResponse {
	if (!request.headers.has(ORG_SLUG_HEADER)) return NextResponse.next();

	const headers = new Headers(request.headers);
	headers.delete(ORG_SLUG_HEADER);

	return NextResponse.next({ request: { headers } });
}

/**
 * Server components cannot see the URL they render under; the request header
 * is how they learn which organization the page is for. Set from the
 * pathname — never from what the browser sent.
 */
function withOrgSlug(request: NextRequest, slug: string): NextResponse {
	const headers = new Headers(request.headers);
	headers.set(ORG_SLUG_HEADER, slug);

	return NextResponse.next({ request: { headers } });
}

/** A stranger's invitation link survives the trip through sign-in. */
function signInFor(request: NextRequest): string {
	const { pathname, search } = request.nextUrl;

	return isUnder(pathname, INVITE_PATH)
		? signInPath(`${pathname}${search}`)
		: SIGN_IN_PATH;
}

function isUnder(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isPublic(pathname: string): boolean {
	return pathname === LANDING_PATH && isMarketing();
}

function isUngated(pathname: string): boolean {
	return UNGATED.some((prefix) => isUnder(pathname, prefix));
}

function isAnonymous(pathname: string): boolean {
	return ANONYMOUS.some((prefix) => isUnder(pathname, prefix));
}

function isSetup(pathname: string, slug: string): boolean {
	return (
		pathname === workspaceUrl(slug, ONBOARDING_SECTION) ||
		pathname === workspaceUrl(slug, RESEARCH_SECTION)
	);
}

function sendTo(path: string, request: NextRequest): NextResponse {
	if (request.nextUrl.pathname === path) return NextResponse.next();

	const url = new URL(path, request.nextUrl);
	url.search = request.nextUrl.search;

	return NextResponse.redirect(url);
}

export const config = {
	matcher: [
		"/((?!api|_next/static|_next/image|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest)$).*)",
	],
};
