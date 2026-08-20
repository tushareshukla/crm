import { db } from "@crm/db";

/**
 * Ownership guard for the agent bridge (`/eve/v1/*`).
 *
 * The caller runs it inside the requesting organization's tenant scope, so
 * every lookup is already fenced to that organization; what this adds is
 * ownership, and the default is refusal. A request that names a session is
 * let through only when a conversation for that session exists in this
 * organization AND belongs to the requesting user — a session from another
 * organization is simply not found, and not found means refused, never
 * allowed through. Only `POST /eve/v1/session` (no session named yet) starts
 * fresh without a conversation row.
 */
export type BridgeConversations = {
	/** The conversation owning a session, in the current organization. */
	bySession(sessionId: string): Promise<{ userId: string } | null>;
	/** The user's builder conversation, in the current organization. */
	builder(
		id: string,
		userId: string,
	): Promise<{ sessionId: string | null } | null>;
};

export const bridgeConversations: BridgeConversations = {
	bySession: (sessionId) =>
		db.agentConversation.findUnique({
			where: { sessionId },
			select: { userId: true },
		}),
	builder: (id, userId) =>
		db.agentConversation.findFirst({
			where: { id, userId, kind: "BUILDER" },
			select: { sessionId: true },
		}),
};

export async function bridgeRefused(
	request: {
		userId: string;
		requestedSession: string | null;
		builderConversationId: string | null;
	},
	conversations: BridgeConversations = bridgeConversations,
): Promise<boolean> {
	const { userId, requestedSession, builderConversationId } = request;

	if (requestedSession) {
		const conversation = await conversations.bySession(requestedSession);
		if (!conversation || conversation.userId !== userId) return true;
	}

	if (builderConversationId) {
		const conversation = await conversations.builder(
			builderConversationId,
			userId,
		);
		if (
			!conversation ||
			(requestedSession && conversation.sessionId !== requestedSession)
		) {
			return true;
		}
	}

	return false;
}

/** The session id a bridge request names in its path, if any. */
export function sessionFromPath(pathname: string): string | null {
	const match = pathname.match(/\/eve\/v1\/session\/([^/]+)/);
	return match?.[1] ? decodeURIComponent(match[1]) : null;
}
