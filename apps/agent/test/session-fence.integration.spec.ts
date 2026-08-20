/**
 * The agent's own fence around `/eve/v1/session/:sessionId*`: a caller from
 * one organization can never read a session whose conversation lives in
 * another, even though the app proxy in front makes the same refusal. The
 * agent verifies the caller's organization itself and looks the session's
 * conversation up across tenants, so a stolen or replayed session id from a
 * foreign organization is "not found" here — never streamed.
 */
import { describe, expect } from "bun:test";
import { db } from "@crm/db";
import {
	BRIDGE_AUDIENCE,
	BRIDGE_ISSUER,
	fencedEveChannel,
	foreignSessionRefusal,
	repFromCrm,
	sessionIdFromPath,
} from "../agent/channels/eve";
import {
	afterAll,
	beforeAll,
	it,
	OTHER_ORGANIZATION,
	TEST_ORGANIZATION,
} from "./support/tenant";

const SECRET = "test-secret-at-least-long-enough-to-be-a-secret";
const auth = [repFromCrm(SECRET)];

const suffix = crypto.randomUUID();
const USER_ID = `session-fence-user-${suffix}`;
const SESSION_ID = `session-fence-session-${suffix}`;

async function mint(organizationId: string, secret = SECRET): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const encode = (value: Record<string, string | number>) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	const signingInput = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
		iss: BRIDGE_ISSUER,
		aud: BRIDGE_AUDIENCE,
		sub: USER_ID,
		email: `${USER_ID}@example.test`,
		name: "Session Fence",
		organizationId,
		iat: now,
		nbf: now - 5,
		exp: now + 120,
	})}`;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(signingInput),
	);
	return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

function streamRequest(token: string | null, sessionId = SESSION_ID): Request {
	return new Request(
		`https://agent.example.com/eve/v1/session/${sessionId}/stream`,
		{ headers: token ? { authorization: `Bearer ${token}` } : {} },
	);
}

beforeAll(async () => {
	await db.user.upsert({
		where: { id: USER_ID },
		create: {
			id: USER_ID,
			name: "Session Fence",
			email: `${USER_ID}@example.test`,
		},
		update: {},
	});
	// The conversation — and with it the session's transcript — lives in the
	// test organization (org A).
	await db.agentConversation.create({
		data: { userId: USER_ID, sessionId: SESSION_ID },
	});
});

afterAll(async () => {
	await db.agentConversation.deleteMany({ where: { sessionId: SESSION_ID } });
	await db.user.deleteMany({ where: { id: USER_ID } });
});

describe("foreignSessionRefusal", () => {
	it("refuses org B's token a session whose conversation lives in org A", async () => {
		const refusal = await foreignSessionRefusal(
			streamRequest(await mint(OTHER_ORGANIZATION.id)),
			auth,
		);

		expect(refusal?.status).toBe(404);
	});

	it("serves org A's own session to org A's token", async () => {
		expect(
			await foreignSessionRefusal(
				streamRequest(await mint(TEST_ORGANIZATION.id)),
				auth,
			),
		).toBeNull();
	});

	it("lets a brand-new session (no conversation row yet) start for its own org", async () => {
		expect(
			await foreignSessionRefusal(
				streamRequest(await mint(OTHER_ORGANIZATION.id), `brand-new-${suffix}`),
				auth,
			),
		).toBeNull();
	});

	it("refuses an org-less caller a session an organization owns", async () => {
		const token = await mint("");
		const refusal = await foreignSessionRefusal(streamRequest(token), auth);

		expect(refusal?.status).toBe(404);
	});

	it("turns away an unauthenticated request before touching the database", async () => {
		const refusal = await foreignSessionRefusal(streamRequest(null), auth);

		expect(refusal?.status).toBe(401);
	});

	it("ignores requests that name no session", async () => {
		expect(
			await foreignSessionRefusal(
				new Request("https://agent.example.com/eve/v1/session", {
					method: "POST",
				}),
				auth,
			),
		).toBeNull();
	});
});

describe("the served channel", () => {
	it("wires the fence into every HTTP route, before the route's own handler", async () => {
		// The same constructor the default export is built with, on the test
		// bridge secret. Any touch of the handler args means the inner route
		// ran; the fence must answer first.
		const channel = fencedEveChannel(auth);
		const untouchable = new Proxy(
			{},
			{
				get() {
					throw new Error("The route handler ran past the fence.");
				},
			},
		);

		const routes = channel.routes.filter(
			(route) => route.method !== "WEBSOCKET",
		);
		expect(routes.length).toBeGreaterThan(0);

		for (const route of routes) {
			const response = await route.handler(
				streamRequest(await mint(OTHER_ORGANIZATION.id)),
				untouchable as never,
			);
			expect(response.status).toBe(404);
		}
	});
});

describe("sessionIdFromPath", () => {
	it("extracts the session id a path names, and nothing from the create route", () => {
		expect(sessionIdFromPath("/eve/v1/session/ses_1/stream")).toBe("ses_1");
		expect(sessionIdFromPath("/eve/v1/session/ses%201")).toBe("ses 1");
		expect(sessionIdFromPath("/eve/v1/session")).toBeNull();
		expect(sessionIdFromPath("/eve/v1/info")).toBeNull();
	});
});
