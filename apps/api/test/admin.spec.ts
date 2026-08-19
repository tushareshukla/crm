/**
 * The platform console (`admin` router): who may use it, how organizations
 * come to exist, and what suspending and deleting one does.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, withoutTenant } from "@crm/db";
import type { INestApplication } from "@nestjs/common";
import {
	dataOf,
	deleteUsersAt,
	errorOf,
	mutate,
	query,
	signUp,
	startApp,
	type TestUser,
	useSignInEnv,
} from "./http";
import {
	createTestOrganization,
	deleteTestOrganization,
	inTenant,
	memberOf,
	type TestOrganization,
} from "./tenant";

const suffix = "admin-spec";
const DOMAIN = `${suffix}.example.test`;
const emailOf = (label: string) => `${label}@${DOMAIN}`;

const SLUGS = {
	acme: `${suffix}-acme`,
	created: `${suffix}-created`,
	selfOwned: `${suffix}-self-owned`,
	renamed: `${suffix}-renamed`,
	doomed: `${suffix}-doomed`,
} as const;

type AdminOrganization = {
	id: string;
	name: string;
	slug: string;
	status: string;
	suspendedAt: string | null;
	memberCount: number;
	pendingInvites: number;
	limits: {
		maxMembers: number | null;
		maxContacts: number | null;
		agentTasksPerDay: number | null;
	};
};

type AuditPage = {
	rows: {
		id: string;
		type: string;
		subject: string | null;
		data: unknown;
		actor: { id: string; email: string } | null;
	}[];
	nextCursor: string | null;
};

let app: INestApplication;
let restoreEnv: () => void;

let acme: TestOrganization;
let root: TestUser;
let owner: TestUser;

/** Organizations created through the console, deleted in afterAll. */
const createdIds = new Set<string>();

const adminQuery = (as: TestUser, path: string, input?: unknown) =>
	query(app, `admin.${path}`, input, { as });

const adminMutate = (as: TestUser, path: string, input?: unknown) =>
	mutate(app, `admin.${path}`, input, { as });

const organizationRow = (id: string) =>
	withoutTenant(() =>
		db.organization.findUnique({
			where: { id },
			select: { status: true, suspendedAt: true, slug: true, name: true },
		}),
	);

const auditOf = (organizationId: string, type: string) =>
	withoutTenant(() =>
		db.auditEvent.findMany({
			where: { organizationId, type },
			orderBy: { createdAt: "asc" },
			select: { actorId: true, subject: true, data: true },
		}),
	);

async function clean() {
	for (const slug of Object.values(SLUGS)) {
		await withoutTenant(() => db.organization.deleteMany({ where: { slug } }));
		await deleteTestOrganization({ id: `org-${slug}` });
	}
	for (const id of createdIds) await deleteTestOrganization({ id });
	await deleteUsersAt(DOMAIN);
}

beforeAll(async () => {
	restoreEnv = useSignInEnv({
		allowedSignIn: [DOMAIN],
		platformAdmins: [emailOf("root")],
	});
	await clean();

	app = await startApp();

	acme = await createTestOrganization(SLUGS.acme, { name: "Acme" });
	root = await signUp(emailOf("root"), "Root");
	owner = await signUp(emailOf("owner"), "Owner");
	await memberOf(owner.id, acme.id, "owner");
});

afterAll(async () => {
	await clean();
	restoreEnv();
	await app.close();
});

describe("who may use the console", () => {
	it("refuses an organization owner who is not a platform admin: FORBIDDEN not-platform-admin", async () => {
		for (const response of [
			await adminQuery(owner, "listOrganizations"),
			await adminMutate(owner, "createOrganization", {
				name: "Nope",
				slug: `${suffix}-nope`,
				ownerEmail: emailOf("nobody"),
			}),
			await adminMutate(owner, "suspend", { id: acme.id }),
			await adminMutate(owner, "deleteOrganization", { id: acme.id }),
			await adminQuery(owner, "auditLog", { organizationId: acme.id }),
		]) {
			expect(errorOf(response)).toMatchObject({
				code: "FORBIDDEN",
				message: "not-platform-admin",
			});
		}

		expect(await organizationRow(acme.id)).toMatchObject({ status: "ACTIVE" });
	});

	it("refuses an anonymous caller", async () => {
		const response = await query(app, "admin.listOrganizations");

		expect(errorOf(response).code).toBe("UNAUTHORIZED");
	});

	it("lists every organization to a platform admin", async () => {
		const orgs = dataOf<AdminOrganization[]>(
			await adminQuery(root, "listOrganizations"),
		);

		const row = orgs.find((org) => org.id === acme.id);
		expect(row).toMatchObject({
			slug: acme.slug,
			name: "Acme",
			status: "ACTIVE",
			memberCount: 1,
			pendingInvites: 0,
		});
	});
});

describe("creating an organization", () => {
	it("creates it with the admin as owner and returns the first owner's invite link", async () => {
		const result = dataOf<{
			organization: AdminOrganization;
			inviteUrl: string | null;
		}>(
			await adminMutate(root, "createOrganization", {
				name: "Created Co",
				slug: SLUGS.created,
				ownerEmail: emailOf("first-owner"),
			}),
		);
		createdIds.add(result.organization.id);

		expect(result.organization).toMatchObject({
			name: "Created Co",
			slug: SLUGS.created,
			status: "ACTIVE",
			suspendedAt: null,
			memberCount: 1,
			pendingInvites: 1,
			limits: { maxMembers: null, maxContacts: null, agentTasksPerDay: null },
		});
		expect(result.inviteUrl).toMatch(/\/invite\/[^/]+$/);

		const invitation = await withoutTenant(() =>
			db.invitation.findFirst({
				where: { organizationId: result.organization.id },
				select: { email: true, role: true, status: true, id: true },
			}),
		);
		expect(invitation).toMatchObject({
			email: emailOf("first-owner"),
			role: "owner",
			status: "pending",
		});
		expect(result.inviteUrl?.endsWith(`/invite/${invitation?.id}`)).toBe(true);

		const membership = await withoutTenant(() =>
			db.member.findFirst({
				where: { organizationId: result.organization.id },
				select: { userId: true, role: true },
			}),
		);
		expect(membership).toEqual({ userId: root.id, role: "owner" });

		expect(await auditOf(result.organization.id, "org.created")).toEqual([
			{
				actorId: root.id,
				subject: result.organization.id,
				data: {
					name: "Created Co",
					slug: SLUGS.created,
					ownerEmail: emailOf("first-owner"),
				},
			},
		]);
		expect(
			await auditOf(result.organization.id, "invite.created"),
		).toHaveLength(1);
	});

	it("returns no invite link when the admin names themselves as owner", async () => {
		const result = dataOf<{
			organization: AdminOrganization;
			inviteUrl: string | null;
		}>(
			await adminMutate(root, "createOrganization", {
				name: "Self Owned",
				slug: SLUGS.selfOwned,
				ownerEmail: root.email.toUpperCase(),
			}),
		);
		createdIds.add(result.organization.id);

		expect(result.inviteUrl).toBeNull();
		expect(result.organization.pendingInvites).toBe(0);
		expect(result.organization.memberCount).toBe(1);
	});

	it("refuses a slug that is taken: CONFLICT", async () => {
		const response = await adminMutate(root, "createOrganization", {
			name: "Acme again",
			slug: acme.slug,
			ownerEmail: emailOf("someone"),
		});

		expect(errorOf(response).code).toBe("CONFLICT");
	});

	it("refuses a reserved or malformed slug: BAD_REQUEST", async () => {
		// "api" / "settings" are section routes; "admin", "invite", "t" and
		// "welcome" are the app's own top-level pages beside /[slug].
		for (const slug of [
			"api",
			"settings",
			"admin",
			"invite",
			"t",
			"welcome",
			"Bad Slug",
			"double--dash",
			"-leading",
		]) {
			const response = await adminMutate(root, "createOrganization", {
				name: "Bad",
				slug,
				ownerEmail: emailOf("someone"),
			});
			expect(errorOf(response).code).toBe("BAD_REQUEST");
		}
	});
});

describe("updating an organization", () => {
	it("renames, re-slugs and caps it, and records what changed", async () => {
		const updated = dataOf<AdminOrganization>(
			await adminMutate(root, "updateOrganization", {
				id: acme.id,
				name: "Acme Renamed",
				slug: SLUGS.renamed,
				limits: { maxContacts: 500 },
			}),
		);

		expect(updated).toMatchObject({
			id: acme.id,
			name: "Acme Renamed",
			slug: SLUGS.renamed,
			limits: { maxMembers: null, maxContacts: 500, agentTasksPerDay: null },
		});

		expect(await auditOf(acme.id, "org.updated")).toEqual([
			{
				actorId: root.id,
				subject: acme.id,
				data: {
					name: "Acme Renamed",
					slug: SLUGS.renamed,
					limits: {
						maxMembers: null,
						maxContacts: 500,
						agentTasksPerDay: null,
					},
				},
			},
		]);

		// The member follows the organization to its new address.
		const seen = dataOf<{ slug: string; limits: { maxContacts: number } }>(
			await query(app, "orgs.get", { slug: SLUGS.renamed }, { as: owner }),
		);
		expect(seen.limits.maxContacts).toBe(500);

		// Put the slug back for the tests below.
		dataOf(
			await adminMutate(root, "updateOrganization", {
				id: acme.id,
				slug: acme.slug,
			}),
		);
	});

	it("refuses to move an organization onto a slug another one uses: CONFLICT", async () => {
		const response = await adminMutate(root, "updateOrganization", {
			id: acme.id,
			slug: SLUGS.created,
		});

		expect(errorOf(response).code).toBe("CONFLICT");
		expect((await organizationRow(acme.id))?.slug).toBe(acme.slug);
	});
});

describe("suspending an organization", () => {
	it("locks its members out until it is unsuspended", async () => {
		const suspended = dataOf<AdminOrganization>(
			await adminMutate(root, "suspend", { id: acme.id }),
		);
		expect(suspended.status).toBe("SUSPENDED");
		expect(suspended.suspendedAt).not.toBeNull();

		const blocked = await query(
			app,
			"contacts.list",
			{},
			{ as: owner, org: acme.slug },
		);
		expect(errorOf(blocked)).toMatchObject({
			code: "FORBIDDEN",
			message: "suspended",
		});

		const mine = dataOf<{ slug: string; status: string }[]>(
			await query(app, "orgs.mine", undefined, { as: owner }),
		);
		expect(mine.find((org) => org.slug === acme.slug)?.status).toBe(
			"SUSPENDED",
		);

		// Suspending twice changes nothing and writes nothing more.
		dataOf(await adminMutate(root, "suspend", { id: acme.id }));
		expect(await auditOf(acme.id, "org.suspended")).toHaveLength(1);

		const restored = dataOf<AdminOrganization>(
			await adminMutate(root, "unsuspend", { id: acme.id }),
		);
		expect(restored.status).toBe("ACTIVE");
		expect(restored.suspendedAt).toBeNull();

		const allowed = await query(
			app,
			"contacts.list",
			{},
			{ as: owner, org: acme.slug },
		);
		expect(allowed.status).toBe(200);

		expect(await auditOf(acme.id, "org.unsuspended")).toEqual([
			{ actorId: root.id, subject: acme.id, data: null },
		]);
	});

	it("is NOT_FOUND for an organization that does not exist", async () => {
		const response = await adminMutate(root, "suspend", {
			id: `${suffix}-missing`,
		});

		expect(errorOf(response).code).toBe("NOT_FOUND");
	});
});

describe("the audit log", () => {
	it("is readable per organization, newest first, with a cursor", async () => {
		const page = dataOf<AuditPage>(
			await adminQuery(root, "auditLog", { organizationId: acme.id, limit: 2 }),
		);

		expect(page.rows).toHaveLength(2);
		expect(page.rows[0]?.type).toBe("org.unsuspended");
		expect(page.rows[1]?.type).toBe("org.suspended");
		expect(page.rows[0]?.actor).toMatchObject({
			id: root.id,
			email: root.email,
		});
		expect(page.nextCursor).toBe(page.rows[1]?.id ?? null);

		const next = dataOf<AuditPage>(
			await adminQuery(root, "auditLog", {
				organizationId: acme.id,
				limit: 2,
				cursor: page.nextCursor,
			}),
		);
		expect(next.rows.map((row) => row.type)).toEqual([
			"org.updated",
			"org.updated",
		]);
	});

	it("is also readable by the organization's own owner, but not by a member", async () => {
		const member = await signUp(emailOf("member"), "Member");
		await memberOf(member.id, acme.id, "member");

		const own = dataOf<AuditPage>(
			await query(
				app,
				"audit.list",
				{ limit: 1 },
				{ as: owner, org: acme.slug },
			),
		);
		expect(own.rows[0]?.type).toBe("org.unsuspended");

		const refused = await query(
			app,
			"audit.list",
			{ limit: 1 },
			{ as: member, org: acme.slug },
		);
		expect(errorOf(refused).code).toBe("FORBIDDEN");
	});
});

describe("deleting an organization", () => {
	it("removes it with every tenant row, membership, invitation and audit event", async () => {
		const doomed = await createTestOrganization(SLUGS.doomed, {
			name: "Doomed",
		});
		const victim = await signUp(emailOf("victim"), "Victim");
		await memberOf(victim.id, doomed.id, "owner");

		// The victim's session points at the organization.
		dataOf(
			await mutate(app, "orgs.switchTo", { slug: doomed.slug }, { as: victim }),
		);

		await inTenant(doomed.id, async () => {
			const company = await db.company.create({
				data: { name: "Doomed Co", domain: `doomed-${suffix}.test` },
				select: { id: true },
			});
			await db.contact.create({
				data: {
					firstName: "Gone",
					email: `gone@doomed-${suffix}.test`,
					companyId: company.id,
				},
			});
			await db.auditEvent.create({
				data: { type: "org.created", actorId: victim.id, subject: doomed.id },
			});
		});
		dataOf(
			await mutate(
				app,
				"invites.create",
				{ email: emailOf("never-joins") },
				{ as: victim, org: doomed.slug },
			),
		);

		const counts = () =>
			withoutTenant(async () => ({
				organizations: await db.organization.count({
					where: { id: doomed.id },
				}),
				companies: await db.company.count({
					where: { organizationId: doomed.id },
				}),
				contacts: await db.contact.count({
					where: { organizationId: doomed.id },
				}),
				audit: await db.auditEvent.count({
					where: { organizationId: doomed.id },
				}),
				members: await db.member.count({
					where: { organizationId: doomed.id },
				}),
				invitations: await db.invitation.count({
					where: { organizationId: doomed.id },
				}),
				sessions: await db.session.count({
					where: { activeOrganizationId: doomed.id },
				}),
			}));

		expect(await counts()).toMatchObject({
			organizations: 1,
			companies: 1,
			contacts: 1,
			members: 1,
			invitations: 1,
			sessions: 1,
		});
		expect((await counts()).audit).toBeGreaterThanOrEqual(2);

		const result = dataOf<{ id: string; slug: string }>(
			await adminMutate(root, "deleteOrganization", { id: doomed.id }),
		);
		expect(result).toEqual({ id: doomed.id, slug: doomed.slug });

		expect(await counts()).toEqual({
			organizations: 0,
			companies: 0,
			contacts: 0,
			audit: 0,
			members: 0,
			invitations: 0,
			sessions: 0,
		});

		// The user account survives; only the membership went.
		expect(
			await withoutTenant(() => db.user.count({ where: { id: victim.id } })),
		).toBe(1);

		const gone = await query(
			app,
			"orgs.get",
			{ slug: doomed.slug },
			{ as: victim },
		);
		expect(errorOf(gone).code).toBe("NOT_FOUND");

		const again = await adminMutate(root, "deleteOrganization", {
			id: doomed.id,
		});
		expect(errorOf(again).code).toBe("NOT_FOUND");
	});
});
