/**
 * The tenant-free `orgs` router: what a signed-in user sees of their
 * organizations, switching between them, and accepting an invitation.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, withoutTenant } from "@crm/db";
import type { INestApplication } from "@nestjs/common";
import type { OrgSummary } from "../src/orgs/orgs.service";
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
	memberOf,
	type TestOrganization,
} from "./tenant";

const suffix = "orgs-spec";
const DOMAIN = `${suffix}.example.test`;
/** Not on the allow-list: only an invitation lets these addresses sign up. */
const GUEST_DOMAIN = `${suffix}-guests.example.test`;
const emailOf = (label: string) => `${label}@${DOMAIN}`;

const SLUGS = {
	alpha: `${suffix}-alpha`,
	beta: `${suffix}-beta`,
	gamma: `${suffix}-gamma`,
	other: `${suffix}-other`,
} as const;

type UserOrganization = {
	id: string;
	slug: string;
	role: string;
	status: string;
	lastActiveAt: string | null;
};

let app: INestApplication;
let restoreEnv: () => void;

let alpha: TestOrganization;
let beta: TestOrganization;
let gamma: TestOrganization;
let other: TestOrganization;

let rep: TestUser;
let owner: TestUser;

const lastActive = (userId: string, organizationId: string, at: Date | null) =>
	withoutTenant(() =>
		db.member.updateMany({
			where: { userId, organizationId },
			data: { lastActiveAt: at },
		}),
	);

const mine = async (as: TestUser) =>
	dataOf<UserOrganization[]>(await query(app, "orgs.mine", undefined, { as }));

const latestSession = (userId: string) =>
	withoutTenant(() =>
		db.session.findFirst({
			where: { userId },
			orderBy: { createdAt: "desc" },
			select: { activeOrganizationId: true },
		}),
	);

type Invite = { id: string; url: string; email: string; role: string };

async function inviteToAlpha(email: string, role = "member"): Promise<Invite> {
	return dataOf<Invite>(
		await mutate(
			app,
			"invites.create",
			{ email, role },
			{ as: owner, org: alpha.slug },
		),
	);
}

async function clean() {
	for (const slug of Object.values(SLUGS)) {
		await deleteTestOrganization({ id: `org-${slug}` });
	}
	await deleteUsersAt(DOMAIN);
	await deleteUsersAt(GUEST_DOMAIN);
}

beforeAll(async () => {
	restoreEnv = useSignInEnv({ allowedSignIn: [DOMAIN] });
	await clean();

	app = await startApp();

	alpha = await createTestOrganization(SLUGS.alpha, { name: "Alpha" });
	beta = await createTestOrganization(SLUGS.beta, { name: "Beta" });
	gamma = await createTestOrganization(SLUGS.gamma, { name: "Gamma" });
	other = await createTestOrganization(SLUGS.other, { name: "Other" });

	rep = await signUp(emailOf("rep"), "Rep");
	owner = await signUp(emailOf("owner"), "Owner");

	await memberOf(rep.id, alpha.id, "owner");
	await memberOf(rep.id, beta.id, "member");
	await memberOf(rep.id, gamma.id, "admin");
	await memberOf(owner.id, alpha.id, "owner");

	await lastActive(rep.id, alpha.id, new Date("2025-01-01T00:00:00Z"));
	await lastActive(rep.id, beta.id, new Date("2025-06-01T00:00:00Z"));
	await lastActive(rep.id, gamma.id, null);
});

afterAll(async () => {
	await clean();
	restoreEnv();
	await app.close();
});

describe("orgs.mine", () => {
	it("lists the caller's organizations, most recently used first, never-used last", async () => {
		const orgs = await mine(rep);

		expect(orgs.map((org) => org.slug)).toEqual([
			beta.slug,
			alpha.slug,
			gamma.slug,
		]);
		expect(orgs.map((org) => org.role)).toEqual(["member", "owner", "admin"]);
		expect(orgs.every((org) => org.status === "ACTIVE")).toBe(true);
		expect(orgs[2]?.lastActiveAt).toBeNull();
	});

	it("does not list organizations the caller is not a member of", async () => {
		const orgs = await mine(owner);

		expect(orgs.map((org) => org.slug)).toEqual([alpha.slug]);
	});

	it("needs a session", async () => {
		const response = await query(app, "orgs.mine");

		expect(errorOf(response).code).toBe("UNAUTHORIZED");
	});
});

describe("orgs.get", () => {
	it("describes an organization to one of its members", async () => {
		const org = dataOf<OrgSummary>(
			await query(app, "orgs.get", { slug: beta.slug }, { as: rep }),
		);

		expect(org).toMatchObject({
			id: beta.id,
			slug: beta.slug,
			name: "Beta",
			status: "ACTIVE",
			role: "member",
			supportMode: false,
			canRename: false,
			canChangeRoles: false,
			limits: { maxMembers: null, maxContacts: null, agentTasksPerDay: null },
		});
	});

	it("lets an owner rename and change roles", async () => {
		const org = dataOf<{ canRename: boolean; canChangeRoles: boolean }>(
			await query(app, "orgs.get", { slug: alpha.slug }, { as: rep }),
		);

		expect(org.canRename).toBe(true);
		expect(org.canChangeRoles).toBe(true);
	});

	it("is NOT_FOUND for someone who is not a member — the organization's existence is not revealed", async () => {
		const response = await query(
			app,
			"orgs.get",
			{ slug: other.slug },
			{ as: rep },
		);

		expect(errorOf(response)).toMatchObject({ code: "NOT_FOUND", status: 404 });
	});

	it("is NOT_FOUND for a slug that does not exist", async () => {
		const response = await query(
			app,
			"orgs.get",
			{ slug: `${suffix}-nowhere` },
			{ as: rep },
		);

		expect(errorOf(response).code).toBe("NOT_FOUND");
	});
});

describe("orgs.switchTo", () => {
	it("remembers the organization as last used and makes it the session's active one", async () => {
		const result = dataOf<{ id: string; slug: string }>(
			await mutate(app, "orgs.switchTo", { slug: gamma.slug }, { as: rep }),
		);

		expect(result).toEqual({ id: gamma.id, slug: gamma.slug });
		expect((await mine(rep))[0]?.slug).toBe(gamma.slug);
		expect((await latestSession(rep.id))?.activeOrganizationId).toBe(gamma.id);
	});

	it("refuses an organization the caller does not belong to", async () => {
		const response = await mutate(
			app,
			"orgs.switchTo",
			{ slug: other.slug },
			{ as: rep },
		);

		expect(errorOf(response).code).toBe("NOT_FOUND");
		expect((await latestSession(rep.id))?.activeOrganizationId).toBe(gamma.id);
	});
});

describe("orgs.acceptInvitation", () => {
	it("lets the invited address sign up, join, and land in the organization", async () => {
		const guestEmail = `guest@${GUEST_DOMAIN}`;
		const invite = await inviteToAlpha(guestEmail, "admin");

		// The pending invitation is what gets this address past the invite-only gate.
		const guest = await signUp(guestEmail, "Guest");
		expect((await latestSession(guest.id))?.activeOrganizationId).toBeNull();

		const accepted = dataOf<{
			organization: { id: string; slug: string; name: string };
		}>(
			await mutate(
				app,
				"orgs.acceptInvitation",
				{ invitationId: invite.id },
				{ as: guest },
			),
		);

		expect(accepted.organization).toEqual({
			id: alpha.id,
			slug: alpha.slug,
			name: "Alpha",
		});

		const member = await withoutTenant(() =>
			db.member.findUnique({
				where: {
					organizationId_userId: { organizationId: alpha.id, userId: guest.id },
				},
				select: { role: true, lastActiveAt: true },
			}),
		);
		expect(member?.role).toBe("admin");
		expect(member?.lastActiveAt).not.toBeNull();

		const invitation = await withoutTenant(() =>
			db.invitation.findUnique({
				where: { id: invite.id },
				select: { status: true },
			}),
		);
		expect(invitation?.status).toBe("accepted");

		expect((await mine(guest)).map((org) => org.slug)).toEqual([alpha.slug]);
		expect((await latestSession(guest.id))?.activeOrganizationId).toBe(
			alpha.id,
		);

		const audit = await withoutTenant(() =>
			db.auditEvent.findMany({
				where: { organizationId: alpha.id, type: "invite.accepted" },
				select: { actorId: true, subject: true, data: true },
			}),
		);
		expect(audit).toEqual([
			{
				actorId: guest.id,
				subject: invite.id,
				data: { email: guestEmail },
			},
		]);
	});

	it("refuses an invitation addressed to somebody else", async () => {
		const invite = await inviteToAlpha(`intended@${GUEST_DOMAIN}`);
		const impostor = await signUp(emailOf("impostor"), "Impostor");

		const response = await mutate(
			app,
			"orgs.acceptInvitation",
			{ invitationId: invite.id },
			{ as: impostor },
		);

		expect(errorOf(response).code).toBe("FORBIDDEN");
		expect(
			await withoutTenant(() =>
				db.member.count({
					where: { organizationId: alpha.id, userId: impostor.id },
				}),
			),
		).toBe(0);

		const invitation = await withoutTenant(() =>
			db.invitation.findUnique({
				where: { id: invite.id },
				select: { status: true },
			}),
		);
		expect(invitation?.status).toBe("pending");
	});

	it("refuses an invitation that does not exist", async () => {
		const response = await mutate(
			app,
			"orgs.acceptInvitation",
			{ invitationId: `${suffix}-no-such-invitation` },
			{ as: rep },
		);

		expect(errorOf(response).code).toBe("BAD_REQUEST");
	});

	it("refuses an invitation that has been revoked", async () => {
		const revokedEmail = `late@${GUEST_DOMAIN}`;
		const invite = await inviteToAlpha(revokedEmail);
		const late = await signUp(revokedEmail, "Late");

		dataOf(
			await mutate(
				app,
				"invites.revoke",
				{ id: invite.id },
				{ as: owner, org: alpha.slug },
			),
		);

		const response = await mutate(
			app,
			"orgs.acceptInvitation",
			{ invitationId: invite.id },
			{ as: late },
		);

		expect(errorOf(response).code).toBe("BAD_REQUEST");
		expect(
			await withoutTenant(() =>
				db.member.count({
					where: { organizationId: alpha.id, userId: late.id },
				}),
			),
		).toBe(0);
	});
});
