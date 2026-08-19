const ISSUER = "crm-app";
const AUDIENCE = "crm-agent";

const TTL_SECONDS = 120;

export const AGENT_URL = process.env.AGENT_URL ?? "http://127.0.0.1:2000";

export function bridgeConfigured(): boolean {
	return Boolean(process.env.AGENT_BRIDGE_SECRET);
}

type BridgeClaims = {
	iss: string;
	aud: string;
	sub: string;
	email: string;
	name: string;
	/** The organization the rep is working in; the agent scopes the whole session to it. */
	organizationId: string;
	contactId?: string;
	companyId?: string;
	dealId?: string;
	iat: number;
	nbf: number;
	exp: number;
};

export type BridgeScope = {
	/** Required: a token that names no organization would run the agent unscoped. */
	organizationId: string;
	contactId?: string;
	companyId?: string;
	dealId?: string;
};

export async function mintBridgeToken(
	user: {
		id: string;
		email: string;
		name: string;
	},
	scope: BridgeScope,
): Promise<string> {
	const secret = process.env.AGENT_BRIDGE_SECRET;
	if (!secret) throw new Error("AGENT_BRIDGE_SECRET is not set.");

	const organizationId = scope.organizationId?.trim();
	if (!organizationId) {
		throw new Error("A bridge token must name the organization it is for.");
	}

	const now = Math.floor(Date.now() / 1000);

	const header = { alg: "HS256", typ: "JWT" };
	const payload: BridgeClaims = {
		iss: ISSUER,
		aud: AUDIENCE,
		sub: user.id,
		email: user.email,
		name: user.name,
		organizationId,
		iat: now,
		nbf: now - 5,
		exp: now + TTL_SECONDS,
	};

	if (scope.contactId) payload.contactId = scope.contactId;
	if (scope.companyId) payload.companyId = scope.companyId;
	if (scope.dealId) payload.dealId = scope.dealId;

	const signingInput = `${base64url(encode(JSON.stringify(header)))}.${base64url(
		encode(JSON.stringify(payload)),
	)}`;

	const key = await crypto.subtle.importKey(
		"raw",
		encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const signature = await crypto.subtle.sign("HMAC", key, encode(signingInput));

	return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

function encode(input: string) {
	return new TextEncoder().encode(input);
}

function base64url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}
