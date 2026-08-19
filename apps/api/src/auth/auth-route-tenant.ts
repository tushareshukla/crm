import { auth } from "@crm/auth";
import { listUserOrganizations, touchMembership } from "@crm/auth/organization";
import { db, runWithTenant, withoutTenant } from "@crm/db";
import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";

/**
 * better-auth's own routes run without a tenant — auth models are global. The
 * exceptions are the OAuth *link* flows (Slack today) whose hooks write
 * tenant rows (SlackInstallation / SlackWorkspaceGrant / SlackMemberMatch):
 * those need the organization the rep is connecting for. Resolve it from the
 * `x-org-slug` header the app sends, else the session's active organization,
 * else the rep's most recently used organization (the provider's redirect
 * back to us carries no header), and run the handler inside that tenant.
 */
const TENANT_AUTH_PATHS = [
	/^\/api\/auth\/oauth2\/link\b/,
	/^\/api\/auth\/sign-in\/oauth2\b/,
	/^\/api\/auth\/oauth2\/callback\//,
	/^\/api\/auth\/link-social\b/,
	/^\/api\/auth\/callback\//,
];

export function needsTenant(path: string): boolean {
	return TENANT_AUTH_PATHS.some((pattern) => pattern.test(path));
}

export async function resolveAuthRouteTenant(
	request: Request,
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

	const bySlug = slugHeader
		? memberships.find((m) => m.slug === slugHeader)
		: undefined;
	const active = activeOrganizationId
		? memberships.find((m) => m.id === activeOrganizationId)
		: undefined;
	const chosen = bySlug ?? active ?? memberships[0];
	if (!chosen || chosen.status !== "ACTIVE") return null;

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
	if (!needsTenant(request.originalUrl.split("?")[0] ?? "")) {
		next();
		return;
	}
	resolveAuthRouteTenant(request)
		.then((organizationId) => {
			if (organizationId) runWithTenant(organizationId, () => next());
			else next();
		})
		.catch(() => next());
}
