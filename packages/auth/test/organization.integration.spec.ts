/**
 * Membership and sign-up under invite-only multi-tenancy. Hits the real test
 * database (TEST_DATABASE_URL) and the real better-auth instance, so the
 * databaseHooks in src/auth.ts are exercised end to end.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { db } from "@crm/db";
import { APIError } from "better-auth/api";
import { auth } from "../src/auth";
import {
	ensureWorkspaceMembership,
	hasPendingInvitation,
	isPlatformAdmin,
	listUserOrganizations,
	platformAdmins,
	touchMembership,
} from "../src/organization";

const suffix = process.env.TEST_RUN_ID ?? "organization-spec";

const EMAIL_DOMAIN = `${suffix}.example.test`;
const emailOf = (label: string) => `${label}@${EMAIL_DOMAIN}`;
const idOf = (label: string) => `${suffix}-${label}`;

const ORGS = {
	alpha: { id: idOf("org-alpha"), slug: `${suffix}-alpha` },
	beta: { id: idOf("org-beta"), slug: `${suffix}-beta` },
	gamma: { id: idOf("org-gamma"), slug: `${suffix}-gamma` },
} as const;

const PASSWORD = "correct-horse-battery-staple";

const DAY_MS = 24 * 60 * 60 * 1000;

let firstId: string;
let secondId: string;

const seedUser = async (label: string, createdAt: Date): Promise<string> => {
	const user = await db.user.create({
		data: {
			id: idOf(label),
			name: label,
			email: emailOf(label),
			createdAt,
			updatedAt: createdAt,
		},
		select: { id: true },
	});

	return user.id;
};

const seedOrg = async (org: { id: string; slug: string }, createdAt: Date) => {
	await db.organization.create({
		data: { id: org.id, name: org.slug, slug: org.slug, createdAt },
	});
};

const enrol = async (
	userId: string,
	organizationId: string,
	role: string,
	createdAt: Date,
	lastActiveAt: Date | null = null,
) => {
	await db.member.create({
		data: {
			id: idOf(`member-${userId}-${organizationId}`),
			organizationId,
			userId,
			role,
			createdAt,
			lastActiveAt,
		},
	});
};

const invite = async (
	email: string,
	organizationId: string,
	inviterId: string,
	overrides: { status?: string; expiresAt?: Date } = {},
) => {
	await db.invitation.create({
		data: {
			id: idOf(
				`invite-${email}-${organizationId}-${overrides.status ?? "pending"}`,
			),
			organizationId,
			email,
			role: "member",
			status: overrides.status ?? "pending",
			expiresAt: overrides.expiresAt ?? new Date(Date.now() + DAY_MS),
			inviterId,
		},
	});
};

const signUp = (label: string, email = emailOf(label)) =>
	auth.api.signUpEmail({
		body: { email, password: PASSWORD, name: label },
	});

const signIn = (label: string) =>
	auth.api.signInEmail({
		body: { email: emailOf(label), password: PASSWORD },
	});

const latestSession = (userId: string) =>
	db.session.findFirst({
		where: { userId },
		orderBy: { createdAt: "desc" },
		select: { activeOrganizationId: true },
	});

const clear = async () => {
	// Orgs cascade to members + invitations; users cascade to sessions + accounts.
	await db.organization.deleteMany({
		where: { id: { in: Object.values(ORGS).map((org) => org.id) } },
	});
	await db.user.deleteMany({
		where: { email: { endsWith: `@${EMAIL_DOMAIN}`, mode: "insensitive" } },
	});
};

const originalEnv = {
	PLATFORM_ADMINS: process.env.PLATFORM_ADMINS,
	ALLOWED_SIGN_IN: process.env.ALLOWED_SIGN_IN,
};

beforeEach(async () => {
	process.env.PLATFORM_ADMINS = "";
	process.env.ALLOWED_SIGN_IN = "";

	await clear();

	firstId = await seedUser("first", new Date("2020-01-01T00:00:00Z"));
	secondId = await seedUser("second", new Date("2021-01-01T00:00:00Z"));
});

afterAll(async () => {
	await clear();
	process.env.PLATFORM_ADMINS = originalEnv.PLATFORM_ADMINS;
	process.env.ALLOWED_SIGN_IN = originalEnv.ALLOWED_SIGN_IN;
});

describe("ensureWorkspaceMembership", () => {
	it("does not invent a workspace: a user with no membership gets none", async () => {
		const before = await db.organization.count();

		expect(await ensureWorkspaceMembership(firstId)).toBeUndefined();

		expect(await db.organization.count()).toBe(before);
		expect(await db.member.count({ where: { userId: firstId } })).toBe(0);
	});

	it("returns the one org the user belongs to", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await enrol(
			firstId,
			ORGS.alpha.id,
			"owner",
			new Date("2024-01-01T00:00:00Z"),
		);

		expect(await ensureWorkspaceMembership(firstId)).toBe(ORGS.alpha.id);
	});

	it("is read-only: signing in again neither enrols nor re-roles", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await enrol(
			secondId,
			ORGS.alpha.id,
			"admin",
			new Date("2024-01-01T00:00:00Z"),
		);

		await ensureWorkspaceMembership(secondId);
		await ensureWorkspaceMembership(secondId);
		await ensureWorkspaceMembership(firstId);

		const rows = await db.member.findMany({
			where: { organizationId: ORGS.alpha.id },
		});

		expect(rows).toHaveLength(1);
		expect(rows[0]?.userId).toBe(secondId);
		expect(rows[0]?.role).toBe("admin");
	});

	it("picks the most recently used membership, not the oldest", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await seedOrg(ORGS.beta, new Date("2024-02-01T00:00:00Z"));
		await enrol(
			firstId,
			ORGS.alpha.id,
			"owner",
			new Date("2024-01-01T00:00:00Z"),
			new Date("2025-01-01T00:00:00Z"),
		);
		await enrol(
			firstId,
			ORGS.beta.id,
			"member",
			new Date("2024-02-01T00:00:00Z"),
			new Date("2025-06-01T00:00:00Z"),
		);

		expect(await ensureWorkspaceMembership(firstId)).toBe(ORGS.beta.id);
	});

	it("does not see another user's memberships", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await enrol(
			firstId,
			ORGS.alpha.id,
			"owner",
			new Date("2024-01-01T00:00:00Z"),
		);

		expect(await ensureWorkspaceMembership(secondId)).toBeUndefined();
	});
});

describe("listUserOrganizations", () => {
	it("orders by last use (newest first), then by when the membership was created; never-used last", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await seedOrg(ORGS.beta, new Date("2024-02-01T00:00:00Z"));
		await seedOrg(ORGS.gamma, new Date("2024-03-01T00:00:00Z"));

		// never used, joined first
		await enrol(
			firstId,
			ORGS.alpha.id,
			"owner",
			new Date("2024-01-01T00:00:00Z"),
		);
		// used most recently
		await enrol(
			firstId,
			ORGS.beta.id,
			"member",
			new Date("2024-02-01T00:00:00Z"),
			new Date("2025-06-01T00:00:00Z"),
		);
		// used, but earlier
		await enrol(
			firstId,
			ORGS.gamma.id,
			"admin",
			new Date("2024-03-01T00:00:00Z"),
			new Date("2025-01-01T00:00:00Z"),
		);

		const orgs = await listUserOrganizations(firstId);

		expect(orgs.map((org) => org.id)).toEqual([
			ORGS.beta.id,
			ORGS.gamma.id,
			ORGS.alpha.id,
		]);
		expect(orgs.map((org) => org.role)).toEqual(["member", "admin", "owner"]);
		expect(orgs.map((org) => org.slug)).toEqual([
			ORGS.beta.slug,
			ORGS.gamma.slug,
			ORGS.alpha.slug,
		]);
		expect(orgs.every((org) => org.status === "ACTIVE")).toBe(true);
		expect(orgs[2]?.lastActiveAt).toBeNull();
	});

	it("breaks a tie between never-used memberships by join order", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await seedOrg(ORGS.beta, new Date("2024-02-01T00:00:00Z"));
		await enrol(
			firstId,
			ORGS.beta.id,
			"member",
			new Date("2024-02-01T00:00:00Z"),
		);
		await enrol(
			firstId,
			ORGS.alpha.id,
			"member",
			new Date("2024-03-01T00:00:00Z"),
		);

		const orgs = await listUserOrganizations(firstId);

		expect(orgs.map((org) => org.id)).toEqual([ORGS.beta.id, ORGS.alpha.id]);
	});

	it("lists only the user's own memberships and surfaces a suspended org as such", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await seedOrg(ORGS.beta, new Date("2024-02-01T00:00:00Z"));
		await db.organization.update({
			where: { id: ORGS.beta.id },
			data: { status: "SUSPENDED", suspendedAt: new Date() },
		});
		await enrol(
			firstId,
			ORGS.alpha.id,
			"owner",
			new Date("2024-01-01T00:00:00Z"),
		);
		await enrol(
			secondId,
			ORGS.beta.id,
			"owner",
			new Date("2024-02-01T00:00:00Z"),
		);

		const first = await listUserOrganizations(firstId);
		const second = await listUserOrganizations(secondId);

		expect(first.map((org) => org.id)).toEqual([ORGS.alpha.id]);
		expect(second.map((org) => org.id)).toEqual([ORGS.beta.id]);
		expect(second[0]?.status).toBe("SUSPENDED");
	});

	it("maps an unknown role down to member", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await enrol(
			firstId,
			ORGS.alpha.id,
			"wizard",
			new Date("2024-01-01T00:00:00Z"),
		);

		const [org] = await listUserOrganizations(firstId);

		expect(org?.role).toBe("member");
	});

	it("is empty for a user with no memberships", async () => {
		expect(await listUserOrganizations(firstId)).toEqual([]);
	});
});

describe("touchMembership", () => {
	it("stamps only that user's membership in that org", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await seedOrg(ORGS.beta, new Date("2024-02-01T00:00:00Z"));
		await enrol(
			firstId,
			ORGS.alpha.id,
			"owner",
			new Date("2024-01-01T00:00:00Z"),
		);
		await enrol(
			firstId,
			ORGS.beta.id,
			"member",
			new Date("2024-02-01T00:00:00Z"),
		);
		await enrol(
			secondId,
			ORGS.alpha.id,
			"member",
			new Date("2024-01-02T00:00:00Z"),
		);

		const before = Date.now();
		await touchMembership(firstId, ORGS.alpha.id);

		const rows = await db.member.findMany({
			where: { organizationId: { in: [ORGS.alpha.id, ORGS.beta.id] } },
			select: { userId: true, organizationId: true, lastActiveAt: true },
		});

		const touched = rows.find(
			(row) => row.userId === firstId && row.organizationId === ORGS.alpha.id,
		);
		if (!touched?.lastActiveAt) throw new Error("membership was not stamped");
		expect(touched.lastActiveAt.getTime()).toBeGreaterThanOrEqual(
			before - 1000,
		);

		for (const row of rows) {
			if (row === touched) continue;
			expect(row.lastActiveAt).toBeNull();
		}
	});

	it("moves the touched org to the front of the list, so the next sign-in lands there", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await seedOrg(ORGS.beta, new Date("2024-02-01T00:00:00Z"));
		await enrol(
			firstId,
			ORGS.alpha.id,
			"owner",
			new Date("2024-01-01T00:00:00Z"),
			new Date("2025-01-01T00:00:00Z"),
		);
		await enrol(
			firstId,
			ORGS.beta.id,
			"member",
			new Date("2024-02-01T00:00:00Z"),
		);

		expect(await ensureWorkspaceMembership(firstId)).toBe(ORGS.alpha.id);

		await touchMembership(firstId, ORGS.beta.id);

		expect(await ensureWorkspaceMembership(firstId)).toBe(ORGS.beta.id);
		expect((await listUserOrganizations(firstId)).map((org) => org.id)).toEqual(
			[ORGS.beta.id, ORGS.alpha.id],
		);
	});

	it("is a no-op for someone who is not a member — it never creates a membership", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));

		await touchMembership(firstId, ORGS.alpha.id);

		expect(await db.member.count({ where: { userId: firstId } })).toBe(0);
	});
});

describe("isPlatformAdmin", () => {
	it("reads PLATFORM_ADMINS as a comma-separated list, trimmed and case-insensitive", () => {
		process.env.PLATFORM_ADMINS = " Root@Example.test ,ops@example.test,, ";

		expect(platformAdmins()).toEqual(["root@example.test", "ops@example.test"]);
		expect(isPlatformAdmin("root@example.test")).toBe(true);
		expect(isPlatformAdmin("ROOT@EXAMPLE.TEST")).toBe(true);
		expect(isPlatformAdmin("  ops@example.test ")).toBe(true);
		expect(isPlatformAdmin("rep@example.test")).toBe(false);
	});

	it("is nobody when the variable is unset or empty", () => {
		process.env.PLATFORM_ADMINS = "";
		expect(isPlatformAdmin("root@example.test")).toBe(false);

		delete process.env.PLATFORM_ADMINS;
		expect(platformAdmins()).toEqual([]);
		expect(isPlatformAdmin("root@example.test")).toBe(false);
	});

	it("never matches a missing address", () => {
		process.env.PLATFORM_ADMINS = "root@example.test";

		expect(isPlatformAdmin(null)).toBe(false);
		expect(isPlatformAdmin(undefined)).toBe(false);
		expect(isPlatformAdmin("")).toBe(false);
		expect(isPlatformAdmin("   ")).toBe(false);
	});
});

describe("hasPendingInvitation", () => {
	it("is true for a pending, unexpired invitation, whatever the case or padding of the address", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await invite(emailOf("guest"), ORGS.alpha.id, firstId);

		expect(await hasPendingInvitation(emailOf("guest"))).toBe(true);
		expect(await hasPendingInvitation(emailOf("guest").toUpperCase())).toBe(
			true,
		);
		expect(await hasPendingInvitation(`  ${emailOf("guest")}  `)).toBe(true);
	});

	it("is false for an expired invitation", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await invite(emailOf("late"), ORGS.alpha.id, firstId, {
			expiresAt: new Date(Date.now() - DAY_MS),
		});

		expect(await hasPendingInvitation(emailOf("late"))).toBe(false);
	});

	it("is false once the invitation is accepted, rejected or canceled", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		for (const status of ["accepted", "rejected", "canceled"]) {
			await invite(emailOf(status), ORGS.alpha.id, firstId, { status });
			expect(await hasPendingInvitation(emailOf(status))).toBe(false);
		}
	});

	it("is false for an address nobody invited", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await invite(emailOf("guest"), ORGS.alpha.id, firstId);

		expect(await hasPendingInvitation(emailOf("stranger"))).toBe(false);
	});
});

describe("the user.create hook (invite-only sign-up)", () => {
	it("turns away an address with no invitation, no allow-list match and no admin flag", async () => {
		const attempt = signUp("nobody");

		await expect(attempt).rejects.toBeInstanceOf(APIError);
		await expect(attempt).rejects.toMatchObject({ status: "FORBIDDEN" });
		await expect(attempt).rejects.toThrow(/invite-only/);

		expect(await db.user.count({ where: { email: emailOf("nobody") } })).toBe(
			0,
		);
	});

	it("lets a platform admin in, and starts them with no active org", async () => {
		process.env.PLATFORM_ADMINS = `Root@${EMAIL_DOMAIN.toUpperCase()}`;

		const { user } = await signUp("root");

		expect(user.email).toBe(emailOf("root"));
		expect(await db.user.count({ where: { id: user.id } })).toBe(1);
		expect((await latestSession(user.id))?.activeOrganizationId).toBeNull();
	});

	it("lets an invited address in, even when the invitation used a different case", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await invite(emailOf("guest").toUpperCase(), ORGS.alpha.id, firstId);

		const { user } = await signUp("guest");

		expect(await db.user.count({ where: { id: user.id } })).toBe(1);
	});

	it("turns away someone whose only invitation has expired", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await invite(emailOf("late"), ORGS.alpha.id, firstId, {
			expiresAt: new Date(Date.now() - DAY_MS),
		});

		await expect(signUp("late")).rejects.toMatchObject({
			status: "FORBIDDEN",
		});
		expect(await db.user.count({ where: { email: emailOf("late") } })).toBe(0);
	});

	it("turns away someone whose invitation was already used", async () => {
		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await invite(emailOf("used"), ORGS.alpha.id, firstId, {
			status: "accepted",
		});

		await expect(signUp("used")).rejects.toMatchObject({
			status: "FORBIDDEN",
		});
	});

	it("lets an ALLOWED_SIGN_IN match in as the escape hatch", async () => {
		process.env.ALLOWED_SIGN_IN = EMAIL_DOMAIN;

		const { user } = await signUp("listed");

		expect(await db.user.count({ where: { id: user.id } })).toBe(1);
	});

	it("an allow-list for another domain does not open the door", async () => {
		process.env.ALLOWED_SIGN_IN = "somewhere-else.test";

		await expect(signUp("outsider")).rejects.toMatchObject({
			status: "FORBIDDEN",
		});
	});
});

describe("the session.create hook", () => {
	it("starts a fresh session in the most recently used org once the user has one", async () => {
		process.env.PLATFORM_ADMINS = emailOf("root");
		const { user } = await signUp("root");
		expect((await latestSession(user.id))?.activeOrganizationId).toBeNull();

		await seedOrg(ORGS.alpha, new Date("2024-01-01T00:00:00Z"));
		await seedOrg(ORGS.beta, new Date("2024-02-01T00:00:00Z"));
		await enrol(
			user.id,
			ORGS.alpha.id,
			"owner",
			new Date("2024-01-01T00:00:00Z"),
		);
		await enrol(
			user.id,
			ORGS.beta.id,
			"owner",
			new Date("2024-02-01T00:00:00Z"),
		);
		await touchMembership(user.id, ORGS.beta.id);

		await signIn("root");

		expect((await latestSession(user.id))?.activeOrganizationId).toBe(
			ORGS.beta.id,
		);
	});
});
