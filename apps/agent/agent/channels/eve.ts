import { db, withoutTenant } from "@crm/db";
import type { RouteDefinition } from "eve/channels";
import {
	type AuthFn,
	extractBearerToken,
	localDev,
	routeAuth,
	vercelOidc,
	verifyJwtHmac,
	withAuthChallenges,
} from "eve/channels/auth";
import { type EveChannel, eveChannel } from "eve/channels/eve";
import {
	isMemberOf,
	ORGANIZATION_ATTRIBUTE,
	ORGANIZATION_SLUG_HEADER,
	organizationAttribute,
	organizationIdBySlug,
} from "../lib/tenant";

export const BRIDGE_ISSUER = "crm-app";
export const BRIDGE_AUDIENCE = "crm-agent";

type Attributes = Readonly<Record<string, string | readonly string[]>>;

/**
 * Which organization a rep's request is for. The app signs it into the bridge
 * token as the `organizationId` claim, which is trusted outright: the app has
 * already checked the rep is a member. A request with no such claim may name
 * the organization with an `x-org-slug` header instead, which is honoured only
 * once the rep's membership of that organization is confirmed here. Either
 * way it lands in the session's auth attributes, where every tool, hook and
 * event reads its tenant from.
 */
export async function resolveOrganization(
	userId: string,
	attributes: Attributes,
	slugHeader: string | null,
): Promise<Attributes | null> {
	const claimed = organizationAttribute(attributes);
	if (claimed) return { ...attributes, [ORGANIZATION_ATTRIBUTE]: claimed };

	const slug = slugHeader?.trim();
	if (!slug) return attributes;

	const organizationId = await organizationIdBySlug(slug);
	if (!organizationId || !(await isMemberOf(userId, organizationId))) {
		return null;
	}

	return { ...attributes, [ORGANIZATION_ATTRIBUTE]: organizationId };
}

export function repFromCrm(secret: string): AuthFn<Request> {
	return withAuthChallenges(
		async (request: Request) => {
			const result = await verifyJwtHmac(
				extractBearerToken(request.headers.get("authorization")),
				{
					algorithm: "HS256",
					audiences: [BRIDGE_AUDIENCE],
					issuer: BRIDGE_ISSUER,
					secret,
				},
			);

			if (!result.ok) return null;

			const claims = result.sessionAuth;
			const userId = claims.subject;
			if (!userId) return null;

			const attributes = await resolveOrganization(
				userId,
				claims.attributes ?? {},
				request.headers.get(ORGANIZATION_SLUG_HEADER),
			);
			if (!attributes) return null;

			return {
				attributes,
				authenticator: "crm-app",
				principalId: userId,
				principalType: "user" as const,
			};
		},
		[{ scheme: "Bearer" }],
	);
}

/** The session id a `/eve/v1/session/:sessionId*` path names, if any. */
export function sessionIdFromPath(pathname: string): string | null {
	const match = pathname.match(/\/eve\/v1\/session\/([^/]+)/);
	return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * The agent's own fence around session routes: it does not lean on the app
 * proxy alone. A request that names a session id is served only when the
 * session's conversation belongs to the organization the caller verified as
 * — the bridge token's `organizationId` claim, or the membership-checked
 * `x-org-slug` header. Any other organization's session — or an org-less
 * caller asking for an organization's session — is "not found" here, never
 * streamed. A session with no conversation row yet (brand new) has no
 * transcript to protect and passes through; its own queries still run inside
 * its own tenant.
 *
 * Returns the refusal (or auth failure) to send, or null to let the route
 * proceed.
 */
export async function foreignSessionRefusal(
	request: Request,
	auth: AuthFn<Request> | readonly AuthFn<Request>[],
): Promise<Response | null> {
	const sessionId = sessionIdFromPath(new URL(request.url).pathname);
	if (!sessionId) return null;

	const caller = await routeAuth(request, auth);
	if (caller instanceof Response) return caller;

	// Platform-level read: the caller's organization is exactly what is being
	// verified, so the conversation is looked up across tenants by its
	// globally-unique session id, and only its organizationId is read.
	const conversation = await withoutTenant(() =>
		db.agentConversation.findUnique({
			where: { sessionId },
			select: { organizationId: true },
		}),
	);
	if (!conversation) return null;

	if (
		organizationAttribute(caller.attributes) !== conversation.organizationId
	) {
		return Response.json({ error: "Conversation not found." }, { status: 404 });
	}

	return null;
}

/** The eve channel with {@link foreignSessionRefusal} in front of every HTTP route. */
export function fencedEveChannel(auth: readonly AuthFn<Request>[]): EveChannel {
	const channel = eveChannel({ auth });

	return {
		...channel,
		routes: channel.routes.map(
			(route): RouteDefinition =>
				route.method === "WEBSOCKET"
					? route
					: {
							...route,
							handler: async (request, args) =>
								(await foreignSessionRefusal(request, auth)) ??
								route.handler(request, args),
						},
		),
	};
}

const secret = process.env.AGENT_BRIDGE_SECRET;

export default fencedEveChannel([
	...(secret ? [repFromCrm(secret)] : []),
	vercelOidc(),
	localDev(),
]);
