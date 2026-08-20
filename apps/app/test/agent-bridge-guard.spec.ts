import { describe, expect, it } from "bun:test";
import {
	type BridgeConversations,
	bridgeRefused,
	sessionFromPath,
} from "../lib/agent-bridge-guard";

const USER = "user_owner";
const STRANGER = "user_stranger";
const SESSION = "ses_own";

/**
 * The store the guard sees is already tenant-scoped: it only ever surfaces
 * conversations of the requesting organization. A foreign organization's
 * session therefore looks exactly like a missing one — `null`.
 */
function store(rows: {
	sessions?: Record<string, { userId: string }>;
	builders?: Record<string, { userId: string; sessionId: string | null }>;
}): BridgeConversations {
	return {
		bySession: async (sessionId) => rows.sessions?.[sessionId] ?? null,
		builder: async (id, userId) => {
			const row = rows.builders?.[id];
			return row && row.userId === userId ? { sessionId: row.sessionId } : null;
		},
	};
}

const ownSession = store({ sessions: { [SESSION]: { userId: USER } } });

describe("bridgeRefused", () => {
	it("refuses a session id with no conversation in the organization — a foreign org's session is not found, not permitted", async () => {
		expect(
			await bridgeRefused(
				{
					userId: USER,
					requestedSession: "ses_other_org",
					builderConversationId: null,
				},
				ownSession,
			),
		).toBe(true);
	});

	it("refuses a session whose conversation belongs to another user", async () => {
		expect(
			await bridgeRefused(
				{
					userId: STRANGER,
					requestedSession: SESSION,
					builderConversationId: null,
				},
				ownSession,
			),
		).toBe(true);
	});

	it("lets the owner through to their own session", async () => {
		expect(
			await bridgeRefused(
				{
					userId: USER,
					requestedSession: SESSION,
					builderConversationId: null,
				},
				ownSession,
			),
		).toBe(false);
	});

	it("lets a request that names no session through (new sessions start without one)", async () => {
		expect(
			await bridgeRefused(
				{ userId: USER, requestedSession: null, builderConversationId: null },
				store({}),
			),
		).toBe(false);
	});

	it("refuses a builder conversation the user does not own", async () => {
		expect(
			await bridgeRefused(
				{
					userId: STRANGER,
					requestedSession: null,
					builderConversationId: "conv_1",
				},
				store({ builders: { conv_1: { userId: USER, sessionId: null } } }),
			),
		).toBe(true);
	});

	it("refuses a builder conversation paired with someone else's session id", async () => {
		expect(
			await bridgeRefused(
				{
					userId: USER,
					requestedSession: SESSION,
					builderConversationId: "conv_1",
				},
				store({
					sessions: { [SESSION]: { userId: USER } },
					builders: { conv_1: { userId: USER, sessionId: "ses_different" } },
				}),
			),
		).toBe(true);
	});

	it("lets a builder conversation through with its own session", async () => {
		expect(
			await bridgeRefused(
				{
					userId: USER,
					requestedSession: SESSION,
					builderConversationId: "conv_1",
				},
				store({
					sessions: { [SESSION]: { userId: USER } },
					builders: { conv_1: { userId: USER, sessionId: SESSION } },
				}),
			),
		).toBe(false);
	});
});

describe("sessionFromPath", () => {
	it("extracts the session id a bridge path names", () => {
		expect(sessionFromPath("/eve/v1/session/ses_1/stream")).toBe("ses_1");
		expect(sessionFromPath("/eve/v1/session/ses%201")).toBe("ses 1");
	});

	it("names none for the create route and other paths", () => {
		expect(sessionFromPath("/eve/v1/session")).toBeNull();
		expect(sessionFromPath("/eve/v1/info")).toBeNull();
	});
});
