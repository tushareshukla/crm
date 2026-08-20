import { auth } from "@crm/auth";
import { listUserOrganizations, touchMembership } from "@crm/auth/organization";
import { db, runWithTenant, withoutTenant } from "@crm/db";
import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";

/**
 * better-auth's own routes run without a tenant — auth models are global. The
 * exceptions are the OAuth *link* flows (Slack today) whose hooks write
 * tenant rows (SlackInstallation / SlackWorkspaceGrant / SlackMemberMatch):
 * those need the organization the rep is connecting for. When the link flow
 * starts, the app names it with `x-org-slug`; that choice is remembered per
 * session for a few minutes so the provider's redirect back to us (which
 * carries no header) lands in the organization the rep actually chose — not
 * whichever one they used last. Fallbacks: the session's active organization,
 * then the most recently used membership.
 */
const LINK_START_PATHS = [
	/^\/api\/auth\/oauth2\/link\b/,
	/^\/api\/auth\/sign-in\/oauth2\b/,
	/^\/api\/auth\/link-social\b/,
];

const LINK_CALLBACK_PATHS = [
	/^\/api\/auth\/oauth2\/callback\//,
	/^\/api\/auth\/callback\//,
];

/** A link-start choice is only honoured on the callback for this long. */
export const LINK_START_TTL_MS = 10 * 60_000;

const linkStarts = new Map<
	string,
	{ organizationId: string; expiresAt: number }
>();

export function needsTenant(path: string): boolean {
	return (
		LINK_START_PATHS.some((pattern) => pattern.test(path)) ||
		LINK_CALLBACK_PATHS.some((pattern) => pattern.test(path))
	);
}

/** Remember which organization a session started an OAuth link flow for. */
export function recordLinkStart(
	sessionId: string,
	organizationId: string,
	now = Date.now(),
): void {
	prune(now);
	linkStarts.set(sessionId, {
		organizationId,
		expiresAt: now + LINK_START_TTL_MS,
	});
}

/** The organization a session's link flow started for, if still fresh. */
export function linkStartOrganization(
	sessionId: string,
	now = Date.now(),
): string | null {
	prune(now);
	return linkStarts.get(sessionId)?.organizationId ?? null;
}

function prune(now: number): void {
	for (const [sessionId, entry] of linkStarts) {
		if (entry.expiresAt <= now) linkStarts.delete(sessionId);
	}
}

type Membership = { id: string; slug: string; status: string };

/**
 * Pick the organization an auth route should run in, and keep the link-start
 * memory: a link start records the choice, a callback prefers it.
 */
export function chooseAuthOrganization(options: {
	path: string;
	sessionId: string;
	slugHeader: string | null;
	activeOrganizationId: string | null;
	memberships: Membership[];
	now?: number;
}): Membership | undefined {
	const now = options.now ?? Date.now();
	const { memberships } = options;

	const bySlug = options.slugHeader
		? memberships.find((m) => m.slug === options.slugHeader)
		: undefined;
	const recorded = LINK_CALLBACK_PATHS.some((p) => p.test(options.path))
		? linkStartOrganization(options.sessionId, now)
		: null;
	const byRecord = recorded
		? memberships.find((m) => m.id === recorded)
		: undefined;
	const active = options.activeOrganizationId
		? memberships.find((m) => m.id === options.activeOrganizationId)
		: undefined;

	// On the callback the recorded link-start organization wins: the provider
	// redirect carries no slug header, and "last used" may have moved on.
	const chosen = byRecord ?? bySlug ?? active ?? memberships[0];

	if (chosen && LINK_START_PATHS.some((p) => p.test(options.path))) {
		recordLinkStart(options.sessionId, chosen.id, now);
	}

	return chosen;
}

export async function resolveAuthRouteTenant(
	request: Request,
	path: string,
): Promise<string | null> {
	const session = await auth.api
		.getSession({ headers: fromNodeHeaders(request.headers) })
		.catch(() => null);
	const userId = session?.user?.id;
	if (!userId) return null;

	const activeOrganizationId =
		(session.session as { activeOrganizationId?: string | null })
			.activeOrganizationId ?? null;
	const slugHeader = request.header("x-org-slug")?.trim().toLowerCase();
	const memberships = await withoutTenant(() => listUserOrganizations(userId));

	const chosen = chooseAuthOrganization({
		path,
		sessionId: session.session.id,
		slugHeader: slugHeader ?? null,
		activeOrganizationId,
		memberships,
	});
	if (chosen?.status !== "ACTIVE") return null;

	if (activeOrganizationId !== chosen.id) {
		await withoutTenant(async () => {
			await db.session
				.update({
					where: { id: session.session.id },
					data: { activeOrganizationId: chosen.id },
				})
				.catch(() => undefined);
			await touchMembership(userId, chosen.id).catch(() => undefined);
		});
	}
	return chosen.id;
}

export function authRouteTenant(
	request: Request,
	_response: Response,
	next: NextFunction,
): void {
	const path = request.originalUrl.split("?")[0] ?? "";
	if (!needsTenant(path)) {
		next();
		return;
	}
	resolveAuthRouteTenant(request, path)
		.then((organizationId) => {
			if (organizationId) runWithTenant(organizationId, () => next());
			else next();
		})
		.catch(() => next());
}
