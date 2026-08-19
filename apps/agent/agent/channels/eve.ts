import {
	type AuthFn,
	extractBearerToken,
	localDev,
	vercelOidc,
	verifyJwtHmac,
	withAuthChallenges,
} from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
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

const secret = process.env.AGENT_BRIDGE_SECRET;

export default eveChannel({
	auth: [...(secret ? [repFromCrm(secret)] : []), vercelOidc(), localDev()],
});
