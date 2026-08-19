import { beforeAll, describe, expect, it } from "bun:test";
import { verifyJwtHmac } from "eve/channels/auth";
import { z } from "zod";

const SECRET = "test-secret-at-least-long-enough-to-be-a-secret";

const CONFIG = {
	algorithm: "HS256",
	audiences: ["crm-agent"],
	issuer: "crm-app",
	secret: SECRET,
} as const;

let mintBridgeToken: typeof import("../lib/agent-bridge").mintBridgeToken;

beforeAll(async () => {
	process.env.AGENT_BRIDGE_SECRET = SECRET;
	({ mintBridgeToken } = await import("../lib/agent-bridge"));
});

const rep = {
	id: "user_123",
	email: "lewis@trycomp.ai",
	name: "Lewis Carhart",
};

const scope = { organizationId: "org_acme" };

/** The claims a bridge token carries (see BridgeClaims in lib/agent-bridge). */
const bridgeClaims = z.object({
	sub: z.string(),
	organizationId: z.string(),
	contactId: z.string().optional(),
	companyId: z.string().optional(),
	dealId: z.string().optional(),
	iat: z.number(),
	exp: z.number(),
});

function claimsOf(token: string) {
	const [, payload] = token.split(".");
	return bridgeClaims.parse(
		JSON.parse(Buffer.from(payload as string, "base64url").toString()),
	);
}

describe("mintBridgeToken", () => {
	it("mints a token eve accepts", async () => {
		const token = await mintBridgeToken(rep, scope);
		const result = await verifyJwtHmac(token, CONFIG);

		expect(result.ok).toBe(true);
	});

	it("names the rep, so the agent knows a person is driving", async () => {
		const token = await mintBridgeToken(rep, scope);
		const result = await verifyJwtHmac(token, CONFIG);

		expect(result.ok && result.sessionAuth.subject).toBe(rep.id);
		expect(result.ok && result.sessionAuth.attributes?.email).toBe(rep.email);
	});

	it("names the organization as the claim the agent scopes the session by", async () => {
		const token = await mintBridgeToken(rep, scope);

		expect(claimsOf(token).organizationId).toBe("org_acme");
	});

	it("carries the record being discussed, and nothing when there is none", async () => {
		const bare = claimsOf(await mintBridgeToken(rep, scope));
		expect(bare).not.toHaveProperty("contactId");
		expect(bare).not.toHaveProperty("companyId");
		expect(bare).not.toHaveProperty("dealId");

		const scoped = claimsOf(
			await mintBridgeToken(rep, { ...scope, dealId: "deal_1" }),
		);
		expect(scoped.dealId).toBe("deal_1");
		expect(scoped.organizationId).toBe("org_acme");
	});

	it("refuses to mint a token that names no organization", async () => {
		expect(mintBridgeToken(rep, { organizationId: "" })).rejects.toThrow(
			/organization/,
		);
		expect(mintBridgeToken(rep, { organizationId: "   " })).rejects.toThrow(
			/organization/,
		);
	});

	it("is rejected by a different secret", async () => {
		const token = await mintBridgeToken(rep, scope);
		const result = await verifyJwtHmac(token, {
			...CONFIG,
			secret: "a-different-secret-entirely",
		});

		expect(result.ok).toBe(false);
	});

	it("is rejected by an agent expecting another audience", async () => {
		const token = await mintBridgeToken(rep, scope);
		const result = await verifyJwtHmac(token, {
			...CONFIG,
			audiences: ["someone-elses-agent"],
		});

		expect(result.ok).toBe(false);
	});

	it("expires, so a token left in a tab stops working", async () => {
		const token = await mintBridgeToken(rep, scope);
		const claims = claimsOf(token);

		const lifetime = claims.exp - claims.iat;
		expect(lifetime).toBeLessThanOrEqual(300);
		expect(lifetime).toBeGreaterThan(30);
	});

	it("refuses to mint without a secret", async () => {
		const secret = process.env.AGENT_BRIDGE_SECRET;
		process.env.AGENT_BRIDGE_SECRET = "";

		expect(mintBridgeToken(rep, scope)).rejects.toThrow();

		process.env.AGENT_BRIDGE_SECRET = secret;
	});
});
