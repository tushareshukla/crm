import type { Session, SessionUser, WorkspaceRole } from "@crm/auth";
import type { OrgStatus } from "@crm/db";
import type { Request } from "express";

/** The organization a request addresses (header `x-org-slug`, else the session's active org). */
export type OrgContext = {
	id: string;
	slug: string;
	name: string;
	status: OrgStatus;
};

export type BaseTrpcContext = {
	req?: Request;
	session: Session | null;
	/** Resolved organization, or null when the request names none / an unknown slug. */
	org: OrgContext | null;
	/** The caller's membership role in `org`; null when not a member (or no org). */
	role: WorkspaceRole | null;
	/** The caller's email is on PLATFORM_ADMINS. */
	platformAdmin: boolean;
};

export type AuthedTrpcContext = BaseTrpcContext & {
	user: SessionUser;
};

/**
 * Context inside a tenant-scoped procedure: the organization is known, the
 * caller is a member of it (or a platform admin in support mode), and the
 * procedure body runs inside `runWithTenant(org.id)`.
 */
export type TenantTrpcContext = AuthedTrpcContext & {
	org: OrgContext;
	/** True when a platform admin who is not a member entered the organization. */
	supportMode: boolean;
};
