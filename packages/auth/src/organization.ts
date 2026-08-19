import { type Db, db } from "@crm/db";
import { workspaceId } from "@crm/db/workspace";

export { workspaceId };

export const DEFAULT_WORKSPACE_NAME = "CRM";

export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export function isWorkspaceRole(value: string): value is WorkspaceRole {
	return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function isWorkspaceAdmin(role: WorkspaceRole | null): boolean {
	return role === "owner" || role === "admin";
}

export function canRenameWorkspace(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canChangeRole(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canManageCurrency(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canManageConnections(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

export function canManageTracking(role: WorkspaceRole | null): boolean {
	return isWorkspaceAdmin(role);
}

/** Platform admins: comma-separated emails in PLATFORM_ADMINS. */
export function platformAdmins(): readonly string[] {
	return (process.env.PLATFORM_ADMINS ?? "")
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
	const value = email?.trim().toLowerCase();
	return Boolean(value) && platformAdmins().includes(value as string);
}

/** A pending, unexpired better-auth invitation for this address lets them sign up (invite-only tenancy). */
export async function hasPendingInvitation(
	email: string,
	client: Pick<Db, "invitation"> = db,
): Promise<boolean> {
	const count = await client.invitation.count({
		where: {
			email: { equals: email.trim(), mode: "insensitive" },
			status: "pending",
			expiresAt: { gt: new Date() },
		},
	});
	return count > 0;
}

export type UserOrganization = {
	id: string;
	name: string;
	slug: string;
	logo: string | null;
	role: WorkspaceRole;
	status: "ACTIVE" | "SUSPENDED";
	lastActiveAt: Date | null;
};

/** Every organization the user belongs to, most recently used first. Platform code: runs outside tenant scope. */
export async function listUserOrganizations(
	userId: string,
	client: Pick<Db, "member"> = db,
): Promise<UserOrganization[]> {
	const rows = await client.member.findMany({
		where: { userId },
		select: {
			role: true,
			lastActiveAt: true,
			createdAt: true,
			organization: {
				select: { id: true, name: true, slug: true, logo: true, status: true },
			},
		},
		orderBy: [
			{ lastActiveAt: { sort: "desc", nulls: "last" } },
			{ createdAt: "asc" },
		],
	});

	return rows.map((row) => ({
		id: row.organization.id,
		name: row.organization.name,
		slug: row.organization.slug,
		logo: row.organization.logo,
		role: toWorkspaceRole(row.role),
		status: row.organization.status,
		lastActiveAt: row.lastActiveAt,
	}));
}

/**
 * Session hook: pick the organization a fresh session starts in — the most
 * recently used membership. A user with no membership (invited but not yet
 * accepted, or a platform admin with no org) gets none; the app sends them to
 * /welcome or /admin.
 */
export async function ensureWorkspaceMembership(
	userId: string,
): Promise<string | undefined> {
	try {
		const [first] = await listUserOrganizations(userId);
		return first?.id;
	} catch (error) {
		console.error(
			`[auth] could not read memberships for user ${userId}; the next sign-in will retry`,
			error,
		);
		return undefined;
	}
}

/** Remember which org the user worked in last (drives the post-sign-in redirect). */
export async function touchMembership(
	userId: string,
	organizationId: string,
	client: Pick<Db, "member"> = db,
): Promise<void> {
	await client.member.updateMany({
		where: { userId, organizationId },
		data: { lastActiveAt: new Date() },
	});
}

export function toWorkspaceRole(value: string): WorkspaceRole {
	return isWorkspaceRole(value) ? value : "member";
}

export type WorkspaceMemberReader = Pick<Db, "member">;

export async function workspaceRoleOf(
	userId: string,
	client: WorkspaceMemberReader = db,
	organizationId: string = workspaceId(),
): Promise<WorkspaceRole | null> {
	const member = await client.member.findUnique({
		where: { organizationId_userId: { organizationId, userId } },
		select: { role: true },
	});

	return member ? toWorkspaceRole(member.role) : null;
}
