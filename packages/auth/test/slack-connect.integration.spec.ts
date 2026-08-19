/**
 * The Slack connect guard under multi-tenancy. Slack is connected per org, so
 * the guard reads the *current tenant's* membership: every request it judges
 * runs inside runWithTenant(orgId, …), which is what the API's tenant
 * middleware does for a real request.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { db, runWithTenant } from "@crm/db";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { applySetCookies } from "better-auth/cookies";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import * as z from "zod";
import type { WorkspaceRole } from "../src/organization";
import { GOOGLE_PROVIDER_ID, SLACK_PROVIDER_ID } from "../src/scopes";
import { slackConnectGuard } from "../src/slack-connect";

const suffix = process.env.TEST_RUN_ID ?? "slack-connect-spec";

const EMAIL_SUFFIX = `.slack-connect.${suffix}@example.test`;
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const BASE_URL = "http://localhost:3001";
const JSON_HEADERS = { "content-type": "application/json" };

const idOf = (label: string) => `slack-connect-${suffix}-${label}`;

/** The org whose Slack is being connected … */
const ORG = { id: idOf("org"), slug: `slack-connect-${suffix}` };
/** … and a bystander org, to prove roles do not leak across tenants. */
const OTHER = { id: idOf("other-org"), slug: `slack-connect-${suffix}-other` };

const reached = { reached: true };

const probe = {
	id: "slack-connect-probe",
	endpoints: {
		link: createAuthEndpoint("/oauth2/link", { method: "POST" }, async (ctx) =>
			ctx.json(reached),
		),
		signIn: createAuthEndpoint(
			"/sign-in/oauth2",
			{ method: "POST" },
			async (ctx) => ctx.json(reached),
		),
		callback: createAuthEndpoint(
			"/oauth2/callback/:providerId",
			{ method: "GET" },
			async (ctx) => ctx.json(reached),
		),
	},
} satisfies BetterAuthPlugin;

const guarded = betterAuth({
	baseURL: BASE_URL,
	secret: "slack-connect-spec-secret",
	database: prismaAdapter(db, { provider: "postgresql" }),
	emailAndPassword: { enabled: false },
	hooks: { before: slackConnectGuard },
	plugins: [probe],
});

const arrival = z.object({ reached: z.literal(true) });
const refusal = z.object({ message: z.string() });

const sessionCookie = async (userId: string): Promise<string> => {
	const context = await guarded.$context;
	const token = idOf(`${userId}-token`);

	await db.session.create({
		data: {
			id: idOf(`${userId}-session`),
			token,
			userId,
			expiresAt: new Date(Date.now() + SESSION_MS),
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	});

	const cookie = context.authCookies.sessionToken;
	const serialize = createAuthMiddleware(async (ctx) =>
		ctx.setSignedCookie(cookie.name, token, context.secret, cookie.attributes),
	);

	const headers = new Headers();
	applySetCookies(headers, [await serialize({ headers: new Headers() })]);

	return headers.get("cookie") ?? "";
};

/** A signed-in user holding `role` in `org` (or in no org at all when `role` is null). */
const seat = async (
	label: string,
	role: WorkspaceRole | null,
	org: { id: string } = ORG,
): Promise<string> => {
	const now = new Date();

	const user = await db.user.create({
		data: {
			id: idOf(label),
			name: label,
			email: `${label}${EMAIL_SUFFIX}`,
			createdAt: now,
			updatedAt: now,
		},
		select: { id: true },
	});

	if (role) {
		await db.member.create({
			data: {
				id: idOf(`${label}-member`),
				organizationId: org.id,
				userId: user.id,
				role,
				createdAt: now,
			},
		});
	}

	return sessionCookie(user.id);
};

/** Every request the guard judges is made *as the org being connected*, like the API's tenant middleware does. */
const asOrg = <T>(fn: () => Promise<T>): Promise<T> =>
	runWithTenant(ORG.id, fn);

const startConnect = (
	path: string,
	cookie?: string,
	providerId: string = SLACK_PROVIDER_ID,
) =>
	asOrg(() =>
		guarded.handler(
			new Request(`${BASE_URL}/api/auth${path}`, {
				method: "POST",
				headers: cookie ? { ...JSON_HEADERS, cookie } : JSON_HEADERS,
				body: JSON.stringify({ providerId, callbackURL: "/" }),
			}),
		),
	);

const linkSlack = (cookie?: string) => startConnect("/oauth2/link", cookie);

const callbackRequest = (cookie?: string, providerId = SLACK_PROVIDER_ID) =>
	new Request(
		`${BASE_URL}/api/auth/oauth2/callback/${providerId}?code=test-code&state=test-state`,
		{ headers: cookie ? { cookie } : undefined },
	);

const completeConnect = (
	cookie?: string,
	providerId: string = SLACK_PROVIDER_ID,
) => asOrg(() => guarded.handler(callbackRequest(cookie, providerId)));

const messageOf = async (response: Response): Promise<string> =>
	refusal.parse(await response.json()).message;

const arrived = async (response: Response): Promise<boolean> => {
	const text = await response.text();
	try {
		return arrival.safeParse(JSON.parse(text)).success;
	} catch {
		return false;
	}
};

const clear = async () => {
	// Orgs cascade to their members; users cascade to their sessions.
	await db.organization.deleteMany({
		where: { id: { in: [ORG.id, OTHER.id] } },
	});
	await db.user.deleteMany({ where: { email: { endsWith: EMAIL_SUFFIX } } });
};

beforeAll(clear);

beforeEach(async () => {
	await clear();

	for (const org of [ORG, OTHER]) {
		await db.organization.create({
			data: {
				id: org.id,
				name: org.slug,
				slug: org.slug,
				createdAt: new Date(),
			},
		});
	}
});

afterAll(clear);

describe("the Slack callback that writes the connection", () => {
	it("turns away a browser with no session", async () => {
		const response = await completeConnect();

		expect(response.status).toBe(401);
		expect(await messageOf(response)).toContain("Sign in to the CRM");
	});

	it("turns away a member", async () => {
		await seat("owner", "owner");
		const response = await completeConnect(await seat("rep", "member"));

		expect(response.status).toBe(403);
		expect(await messageOf(response)).toContain("Only an owner or an admin");
	});

	it("turns away someone signed in who is not in this workspace", async () => {
		await seat("owner", "owner");
		const response = await completeConnect(await seat("stranger", null));

		expect(response.status).toBe(403);
		expect(await messageOf(response)).toContain("member of this workspace");
	});

	it("turns away an owner of a different org: roles do not cross tenants", async () => {
		await seat("owner", "owner");
		const response = await completeConnect(
			await seat("other-owner", "owner", OTHER),
		);

		expect(response.status).toBe(403);
		expect(await messageOf(response)).toContain("member of this workspace");
	});

	it("lets an admin finish", async () => {
		const response = await completeConnect(await seat("lead", "admin"));

		expect(response.status).toBe(200);
		expect(await arrived(response)).toBe(true);
	});

	it("lets an owner finish", async () => {
		const response = await completeConnect(await seat("founder", "owner"));

		expect(response.status).toBe(200);
		expect(await arrived(response)).toBe(true);
	});

	it("lets a member finish when the workspace has no owner and no admin", async () => {
		const cookie = await seat("rep", "member");
		await seat("other", "member");

		const response = await completeConnect(cookie);

		expect(response.status).toBe(200);
		expect(await arrived(response)).toBe(true);
	});

	it("does not count another org's owner when deciding whether this org has a manager", async () => {
		// ORG has only members; OTHER has an owner. The member may still connect.
		await seat("other-owner", "owner", OTHER);
		const response = await completeConnect(await seat("rep", "member"));

		expect(response.status).toBe(200);
		expect(await arrived(response)).toBe(true);
	});

	it("fails closed when no tenant is resolved for the request, even for an owner", async () => {
		const cookie = await seat("founder", "owner");

		// Same request, but nobody said which org it is for.
		const response = await guarded.handler(callbackRequest(cookie));

		expect(response.status).toBe(400);
		expect(await messageOf(response)).toContain("Open the workspace");
	});

	it("fails closed when no tenant is resolved for the link request", async () => {
		const cookie = await seat("founder", "owner");

		const response = await guarded.handler(
			new Request(`${BASE_URL}/api/auth/oauth2/link`, {
				method: "POST",
				headers: { ...JSON_HEADERS, cookie },
				body: JSON.stringify({
					providerId: SLACK_PROVIDER_ID,
					callbackURL: "/",
				}),
			}),
		);

		expect(response.status).toBe(400);
		expect(await arrived(response)).toBe(false);
	});
});

describe("the two paths that start a Slack connection", () => {
	it("turns away a member who asks to link Slack", async () => {
		await seat("owner", "owner");
		const response = await linkSlack(await seat("rep", "member"));

		expect(response.status).toBe(403);
	});

	it("turns away a member who asks to sign in with Slack", async () => {
		await seat("owner", "owner");
		const response = await startConnect(
			"/sign-in/oauth2",
			await seat("rep", "member"),
		);

		expect(response.status).toBe(403);
	});

	it("turns away a browser with no session", async () => {
		await seat("owner", "owner");
		const response = await linkSlack();

		expect(response.status).toBe(401);
	});

	it("turns away an admin of a different org", async () => {
		await seat("owner", "owner");
		const response = await linkSlack(await seat("other-lead", "admin", OTHER));

		expect(response.status).toBe(403);
	});

	it("lets an admin ask to link Slack", async () => {
		const response = await linkSlack(await seat("lead", "admin"));

		expect(response.status).toBe(200);
		expect(await arrived(response)).toBe(true);
	});
});

describe("every provider that is not Slack", () => {
	it("lets a member link Google", async () => {
		await seat("owner", "owner");
		const response = await startConnect(
			"/oauth2/link",
			await seat("rep", "member"),
			GOOGLE_PROVIDER_ID,
		);

		expect(response.status).toBe(200);
		expect(await arrived(response)).toBe(true);
	});

	it("lets the Google callback through with no session at all", async () => {
		const response = await completeConnect(undefined, GOOGLE_PROVIDER_ID);

		expect(response.status).toBe(200);
		expect(await arrived(response)).toBe(true);
	});

	it("does not need a tenant for a provider it does not guard", async () => {
		const response = await guarded.handler(
			callbackRequest(undefined, GOOGLE_PROVIDER_ID),
		);

		expect(response.status).toBe(200);
		expect(await arrived(response)).toBe(true);
	});
});

describe("the paths the guard has to know about", () => {
	it("is every path the generic OAuth plugin mounts", () => {
		const paths = Object.values(genericOAuth({ config: [] }).endpoints)
			.map((endpoint) => endpoint.path)
			.sort();

		expect(paths).toEqual([
			"/oauth2/callback/:providerId",
			"/oauth2/link",
			"/sign-in/oauth2",
		]);
	});
});
