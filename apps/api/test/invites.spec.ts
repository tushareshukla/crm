/**
 * Copy-link invitations: creating, listing and revoking them, who may do so,
 * and the audit trail they leave.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { db, withoutTenant } from "@crm/db";
import type { INestApplication } from "@nestjs/common";
import {
	dataOf,
	deleteUsersAt,
	errorOf,
	mutate,
	type ProcedureInput,
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

const suffix = "invites-spec";
const DOMAIN = `${suffix}.example.test`;
const emailOf = (label: string) => `${label}@${DOMAIN}`;

const SLUGS = {
	acme: `${suffix}-acme`,
	rival: `${suffix}-rival`,
} as const;

const DAY_MS = 24 * 60 * 60_000;

type Invite = {
	id: string;
	email: string;
	role: string;
	url: string;
	expiresAt: string;
	createdAt: string;
	inviter: { id: string; name: string; email: string } | null;
};

let app: INestApplication;
let restoreEnv: () => void;

let acme: TestOrganization;
let rival: TestOrganization;

let owner: TestUser;
let admin: TestUser;
let member: TestUser;
let rivalOwner: TestUser;
let root: TestUser;

const create = (as: TestUser, input: ProcedureInput, org = acme.slug) =>
	mutate(app, "invites.create", input, { as, org });

const list = async (as: TestUser, org = acme.slug) =>
	dataOf<Invite[]>(await query(app, "invites.list", undefined, { as, org }));

const revoke = (as: TestUser, id: string, org = acme.slug) =>
	mutate(app, "invites.revoke", { id }, { as, org });

const invitationRow = (id: string) =>
	withoutTenant(() =>
		db.invitation.findUnique({
			where: { id },
			select: {
				organizationId: true,
				email: true,
				role: true,
				status: true,
				inviterId: true,
			},
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
	rival = await createTestOrganization(SLUGS.rival, { name: "Rival" });

	owner = await signUp(emailOf("owner"), "Owner");
	admin = await signUp(emailOf("admin"), "Admin");
	member = await signUp(emailOf("member"), "Member");
	rivalOwner = await signUp(emailOf("rival-owner"), "Rival Owner");
	root = await signUp(emailOf("root"), "Root");

	await memberOf(owner.id, acme.id, "owner");
	await memberOf(admin.id, acme.id, "admin");
	await memberOf(member.id, acme.id, "member");
	await memberOf(rivalOwner.id, rival.id, "owner");
});

afterAll(async () => {
	await clean();
	restoreEnv();
	await app.close();
});

describe("creating an invitation", () => {
	it("returns the copy-link and writes the pending invitation", async () => {
		const before = Date.now();
		const invite = dataOf<Invite>(
			await create(owner, { email: `New.Hire@${DOMAIN}`, role: "member" }),
		);

		expect(invite.id).toBeTruthy();
		expect(invite.email).toBe(`new.hire@${DOMAIN}`);
		expect(invite.role).toBe("member");
		expect(invite.url).toMatch(/^https?:\/\//);
		expect(
			invite.url.endsWith(`/invite/${encodeURIComponent(invite.id)}`),
		).toBe(true);
		expect(invite.inviter).toEqual({
			id: owner.id,
			name: "Owner",
			email: owner.email,
		});

		const expiresIn = new Date(invite.expiresAt).getTime() - before;
		expect(expiresIn).toBeGreaterThan(6 * DAY_MS);
		expect(expiresIn).toBeLessThanOrEqual(7 * DAY_MS + 60_000);

		expect(await invitationRow(invite.id)).toEqual({
			organizationId: acme.id,
			email: `new.hire@${DOMAIN}`,
			role: "member",
			status: "pending",
			inviterId: owner.id,
		});

		expect(await auditOf(acme.id, "invite.created")).toContainEqual({
			actorId: owner.id,
			subject: invite.id,
			data: { email: `new.hire@${DOMAIN}`, role: "member" },
		});
	});

	it("defaults the role to member", async () => {
		const invite = dataOf<Invite>(
			await create(owner, { email: emailOf("defaulted") }),
		);

		expect(invite.role).toBe("member");
	});

	it("requires an email address", async () => {
		expect(errorOf(await create(owner, { role: "member" })).code).toBe(
			"BAD_REQUEST",
		);
		expect(errorOf(await create(owner, { email: "not-an-address" })).code).toBe(
			"BAD_REQUEST",
		);
	});

	it("is refused to a member: only owners and admins manage invitations", async () => {
		const response = await create(member, { email: emailOf("friend") });

		expect(errorOf(response)).toMatchObject({
			code: "FORBIDDEN",
			message: "Only an owner or an admin can manage invitations.",
		});
		expect(
			await withoutTenant(() =>
				db.invitation.count({
					where: { organizationId: acme.id, email: emailOf("friend") },
				}),
			),
		).toBe(0);
	});

	it("lets an admin invite a member but not an owner", async () => {
		const asMember = dataOf<Invite>(
			await create(admin, { email: emailOf("by-admin"), role: "member" }),
		);
		expect(asMember.inviter?.id).toBe(admin.id);

		const asOwner = await create(admin, {
			email: emailOf("would-be-owner"),
			role: "owner",
		});
		expect(errorOf(asOwner)).toMatchObject({
			code: "FORBIDDEN",
			message: "Only an owner can invite another owner.",
		});
	});

	it("lets an owner invite another owner", async () => {
		const invite = dataOf<Invite>(
			await create(owner, { email: emailOf("co-owner"), role: "owner" }),
		);

		expect(invite.role).toBe("owner");
	});

	it("refuses to invite someone who is already a member", async () => {
		const response = await create(owner, { email: member.email });

		expect(errorOf(response).code).toBe("BAD_REQUEST");
	});

	it("lets a platform admin in support mode invite, naming them as the inviter", async () => {
		const invite = dataOf<Invite>(
			await create(root, { email: emailOf("invited-by-root"), role: "admin" }),
		);

		expect(invite.inviter?.id).toBe(root.id);
		expect(await invitationRow(invite.id)).toMatchObject({
			organizationId: acme.id,
			role: "admin",
			status: "pending",
			inviterId: root.id,
		});

		// Inviting the same address again refreshes the pending invitation rather than adding one.
		const again = dataOf<Invite>(
			await create(root, { email: emailOf("invited-by-root"), role: "member" }),
		);
		expect(again.id).toBe(invite.id);
		expect(again.role).toBe("member");
	});
});

describe("listing invitations", () => {
	it("shows the organization's pending, unexpired invitations, newest first", async () => {
		const expiredId = randomUUID();
		await withoutTenant(() =>
			db.invitation.create({
				data: {
					id: expiredId,
					organizationId: acme.id,
					email: emailOf("expired"),
					role: "member",
					status: "pending",
					expiresAt: new Date(Date.now() - DAY_MS),
					inviterId: owner.id,
				},
			}),
		);

		const invites = await list(owner);
		const ids = invites.map((invite) => invite.id);

		expect(ids).not.toContain(expiredId);
		expect(invites.every((invite) => invite.url.includes("/invite/"))).toBe(
			true,
		);
		const stamps = invites.map((invite) =>
			new Date(invite.createdAt).getTime(),
		);
		expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
	});

	it("never shows another organization's invitations", async () => {
		const theirs = dataOf<Invite>(
			await create(rivalOwner, { email: emailOf("their-hire") }, rival.slug),
		);

		const ours = await list(owner);
		expect(ours.map((invite) => invite.id)).not.toContain(theirs.id);

		const rivals = await list(rivalOwner, rival.slug);
		expect(rivals.map((invite) => invite.id)).toEqual([theirs.id]);
	});

	it("is refused to a member", async () => {
		const response = await query(app, "invites.list", undefined, {
			as: member,
			org: acme.slug,
		});

		expect(errorOf(response).code).toBe("FORBIDDEN");
	});
});

describe("revoking an invitation", () => {
	it("cancels it, drops it from the list and records who did it", async () => {
		const invite = dataOf<Invite>(
			await create(owner, { email: emailOf("revoke-me") }),
		);

		const revoked = dataOf<{ id: string }>(await revoke(owner, invite.id));
		expect(revoked).toEqual({ id: invite.id });

		expect((await invitationRow(invite.id))?.status).toBe("canceled");
		expect((await list(owner)).map((row) => row.id)).not.toContain(invite.id);
		expect(await auditOf(acme.id, "invite.revoked")).toContainEqual({
			actorId: owner.id,
			subject: invite.id,
			data: { email: emailOf("revoke-me") },
		});
	});

	it("lets a platform admin in support mode revoke", async () => {
		const invite = dataOf<Invite>(
			await create(owner, { email: emailOf("root-revokes") }),
		);

		dataOf(await revoke(root, invite.id));

		expect((await invitationRow(invite.id))?.status).toBe("canceled");
	});

	it("is NOT_FOUND for an invitation of another organization", async () => {
		const theirs = dataOf<Invite>(
			await create(rivalOwner, { email: emailOf("protected") }, rival.slug),
		);

		const response = await revoke(owner, theirs.id);

		expect(errorOf(response).code).toBe("NOT_FOUND");
		expect((await invitationRow(theirs.id))?.status).toBe("pending");
	});

	it("is NOT_FOUND for an id that does not exist", async () => {
		const response = await revoke(owner, `${suffix}-missing`);

		expect(errorOf(response).code).toBe("NOT_FOUND");
	});

	it("is refused to a member", async () => {
		const invite = dataOf<Invite>(
			await create(owner, { email: emailOf("member-cannot-revoke") }),
		);

		const response = await revoke(member, invite.id);

		expect(errorOf(response).code).toBe("FORBIDDEN");
		expect((await invitationRow(invite.id))?.status).toBe("pending");
	});
});
