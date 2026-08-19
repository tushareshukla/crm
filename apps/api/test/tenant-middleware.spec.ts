/**
 * TenantMiddleware over HTTP: who may enter an organization, and what the
 * platform writes down when a platform admin does.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, OrgStatus, withoutTenant } from "@crm/db";
import type { INestApplication } from "@nestjs/common";
import {
	dataOf,
	deleteUsersAt,
	errorOf,
	query,
	signIn,
	signUp,
	startApp,
	type TestUser,
	useSignInEnv,
} from "./http";
import {
	createTestOrganization,
	deleteTestOrganization,
	memberOf,
	type TestOrganization,
} from "./tenant";

const suffix = "tenant-mw";
const DOMAIN = `${suffix}.example.test`;
const emailOf = (label: string) => `${label}@${DOMAIN}`;

const SLUGS = {
	acme: `${suffix}-acme`,
	frozen: `${suffix}-frozen`,
	home: `${suffix}-home`,
} as const;

let app: INestApplication;
let restoreEnv: () => void;

let acme: TestOrganization;
let frozen: TestOrganization;
let home: TestOrganization;

let rep: TestUser;
let stranger: TestUser;
let root: TestUser;

const listContacts = (as: TestUser | null, org: string | null) =>
	query(app, "contacts.list", {}, { as, org });

async function adminEntries(organizationId: string) {
	return withoutTenant(() =>
		db.auditEvent.findMany({
			where: { organizationId, type: "admin.entered" },
			select: { actorId: true, subject: true, data: true },
		}),
	);
}

async function clean() {
	for (const slug of Object.values(SLUGS)) {
		await deleteTestOrganization({ id: `org-${slug}` });
	}
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
	frozen = await createTestOrganization(SLUGS.frozen, {
		name: "Frozen",
		status: OrgStatus.SUSPENDED,
	});
	home = await createTestOrganization(SLUGS.home, { name: "Home" });

	// Sign up first, then enrol: these sessions start with no active organization.
	rep = await signUp(emailOf("rep"), "Rep");
	stranger = await signUp(emailOf("stranger"), "Stranger");
	root = await signUp(emailOf("root"), "Root");

	await memberOf(rep.id, acme.id, "member");
	await memberOf(rep.id, frozen.id, "owner");
	await memberOf(root.id, home.id, "owner");
});

afterAll(async () => {
	await clean();
	restoreEnv();
	await app.close();
});

describe("entering an organization", () => {
	it("turns away a request with no session", async () => {
		const response = await listContacts(null, acme.slug);

		expect(response.status).toBe(401);
		expect(errorOf(response).code).toBe("UNAUTHORIZED");
	});

	it("lets a member in", async () => {
		const response = await listContacts(rep, acme.slug);

		expect(response.status).toBe(200);
		expect(dataOf<{ rows: unknown[] }>(response).rows).toEqual([]);
	});

	it("reads the slug header case-insensitively", async () => {
		const response = await listContacts(rep, acme.slug.toUpperCase());

		expect(response.status).toBe(200);
	});

	it("refuses someone who is not a member: FORBIDDEN not-a-member", async () => {
		const response = await listContacts(stranger, acme.slug);

		expect(errorOf(response)).toMatchObject({
			code: "FORBIDDEN",
			message: "not-a-member",
			status: 403,
		});
	});

	it("refuses a member of a suspended organization: FORBIDDEN suspended", async () => {
		const response = await listContacts(rep, frozen.slug);

		expect(errorOf(response)).toMatchObject({
			code: "FORBIDDEN",
			message: "suspended",
		});
	});

	it("refuses a request that names no organization: FORBIDDEN no-organization", async () => {
		const response = await listContacts(rep, null);

		expect(errorOf(response)).toMatchObject({
			code: "FORBIDDEN",
			message: "no-organization",
		});
	});

	it("treats an unknown slug as no organization", async () => {
		const response = await listContacts(rep, `${suffix}-nowhere`);

		expect(errorOf(response)).toMatchObject({
			code: "FORBIDDEN",
			message: "no-organization",
		});
	});

	it("falls back to the session's active organization when there is no header", async () => {
		// A fresh sign-in starts in the most recently used membership.
		await withoutTenant(() =>
			db.member.updateMany({
				where: { userId: rep.id, organizationId: acme.id },
				data: { lastActiveAt: new Date() },
			}),
		);
		const again = await signIn(rep.email);

		const session = await withoutTenant(() =>
			db.session.findFirst({
				where: { userId: rep.id },
				orderBy: { createdAt: "desc" },
				select: { activeOrganizationId: true },
			}),
		);
		expect(session?.activeOrganizationId).toBe(acme.id);

		const response = await listContacts(again, null);
		expect(response.status).toBe(200);
	});

	it("stamps the member's lastActiveAt as a side effect of traffic", async () => {
		await withoutTenant(() =>
			db.member.updateMany({
				where: { userId: rep.id, organizationId: acme.id },
				data: { lastActiveAt: null },
			}),
		);

		// A new app instance has not touched this member yet.
		const fresh = await startApp();
		try {
			await query(fresh, "contacts.list", {}, { as: rep, org: acme.slug });

			// The touch is fire-and-forget; give it a moment.
			let lastActiveAt: Date | null = null;
			for (let attempt = 0; attempt < 20 && !lastActiveAt; attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				const member = await withoutTenant(() =>
					db.member.findUnique({
						where: {
							organizationId_userId: {
								organizationId: acme.id,
								userId: rep.id,
							},
						},
						select: { lastActiveAt: true },
					}),
				);
				lastActiveAt = member?.lastActiveAt ?? null;
			}

			expect(lastActiveAt).not.toBeNull();
		} finally {
			await fresh.close();
		}
	});
});

describe("a platform admin", () => {
	it("is flagged on users.me; members are not", async () => {
		const me = dataOf<{ platformAdmin: boolean; email: string }>(
			await query(app, "users.me", undefined, { as: root }),
		);
		const them = dataOf<{ platformAdmin: boolean }>(
			await query(app, "users.me", undefined, { as: rep }),
		);

		expect(me.platformAdmin).toBe(true);
		expect(me.email).toBe(root.email);
		expect(them.platformAdmin).toBe(false);
	});

	it("enters an organization they do not belong to, and the entry is written once per hour", async () => {
		expect(await adminEntries(acme.id)).toEqual([]);

		const first = await listContacts(root, acme.slug);
		expect(first.status).toBe(200);

		const second = await listContacts(root, acme.slug);
		expect(second.status).toBe(200);

		const session = await withoutTenant(() =>
			db.session.findFirst({
				where: { userId: root.id },
				orderBy: { createdAt: "desc" },
				select: { id: true },
			}),
		);

		const entries = await adminEntries(acme.id);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			actorId: root.id,
			subject: session?.id,
			data: { email: root.email },
		});

		// Another API instance consults the log before writing again.
		const fresh = await startApp();
		try {
			await query(fresh, "contacts.list", {}, { as: root, org: acme.slug });
		} finally {
			await fresh.close();
		}
		expect(await adminEntries(acme.id)).toHaveLength(1);
	});

	it("is shown the organization in support mode", async () => {
		const org = dataOf<{
			id: string;
			role: string | null;
			supportMode: boolean;
			canRename: boolean;
		}>(await query(app, "orgs.get", { slug: acme.slug }, { as: root }));

		expect(org).toMatchObject({
			id: acme.id,
			role: null,
			supportMode: true,
			canRename: true,
		});
	});

	it("gets the workspace in support mode, while a member gets their role", async () => {
		type Workspace = {
			id: string;
			slug: string;
			viewerRole: string | null;
			supportMode: boolean;
			canRename: boolean;
		};

		const asRoot = dataOf<Workspace>(
			await query(app, "workspace.get", undefined, {
				as: root,
				org: acme.slug,
			}),
		);
		expect(asRoot).toMatchObject({
			id: acme.id,
			slug: acme.slug,
			viewerRole: null,
			supportMode: true,
			canRename: true,
		});

		const asRep = dataOf<Workspace>(
			await query(app, "workspace.get", undefined, { as: rep, org: acme.slug }),
		);
		expect(asRep).toMatchObject({
			id: acme.id,
			viewerRole: "member",
			supportMode: false,
			canRename: false,
		});
	});

	it("writes nothing when entering an organization they belong to", async () => {
		const response = await listContacts(root, home.slug);

		expect(response.status).toBe(200);
		expect(await adminEntries(home.id)).toEqual([]);
	});

	it("is still kept out of a suspended organization", async () => {
		const response = await listContacts(root, frozen.slug);

		expect(errorOf(response)).toMatchObject({
			code: "FORBIDDEN",
			message: "suspended",
		});
		expect(await adminEntries(frozen.id)).toEqual([]);
	});
});
