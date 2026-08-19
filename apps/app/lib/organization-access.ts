import "server-only";
import { isPlatformAdmin } from "@crm/auth/organization";
import { db, type OrgStatus } from "@crm/db";
import { ORG_SLUG_HEADER, orgSlugFromPathname } from "@/lib/org-slug";

export type OrganizationAccess = {
	id: string;
	slug: string;
	status: OrgStatus;
	/** False for a platform admin looking in (support mode). */
	member: boolean;
};

/**
 * May this rep act inside the organization at `slug`? Members may; platform
 * admins may look in. Organization and Member are global models, so this is
 * the lookup that establishes a tenant rather than one made inside it.
 */
export async function organizationAccess(
	user: { id: string; email: string },
	slug: string,
): Promise<OrganizationAccess | null> {
	const organization = await db.organization.findUnique({
		where: { slug },
		select: {
			id: true,
			slug: true,
			status: true,
			members: { where: { userId: user.id }, select: { id: true }, take: 1 },
		},
	});

	if (!organization) return null;

	const member = organization.members.length > 0;

	if (!member && !isPlatformAdmin(user.email)) return null;

	return {
		id: organization.id,
		slug: organization.slug,
		status: organization.status,
		member,
	};
}

/**
 * The organization a browser request is for: the `x-org-slug` header the app
 * sends, else the page it was sent from (`referer`), which is always an
 * organization page for the agent bridge.
 */
export function requestedOrgSlug(request: Request): string | null {
	const header = request.headers.get(ORG_SLUG_HEADER)?.trim().toLowerCase();
	if (header) return orgSlugFromPathname(`/${header}`);

	const referer = request.headers.get("referer");
	if (!referer) return null;

	try {
		return orgSlugFromPathname(new URL(referer).pathname);
	} catch {
		return null;
	}
}
