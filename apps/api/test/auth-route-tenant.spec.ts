/**
 * The OAuth link flows: the organization the rep chose when the link flow
 * started must be the one the provider's callback lands in — not whichever
 * organization the session used last.
 */
import { describe, expect, it } from "bun:test";
import {
	chooseAuthOrganization,
	LINK_START_TTL_MS,
	linkStartOrganization,
	needsTenant,
	recordLinkStart,
} from "../src/auth/auth-route-tenant";

const orgA = { id: "org-a", slug: "acme", status: "ACTIVE" };
const orgB = { id: "org-b", slug: "burro", status: "ACTIVE" };
const memberships = [orgA, orgB];

const LINK_START = "/api/auth/oauth2/link";
const CALLBACK = "/api/auth/oauth2/callback/slack";

let counter = 0;
function freshSession(): string {
	counter += 1;
	return `session-${counter}`;
}

describe("auth routes that need a tenant", () => {
	it("cover the link starts and the provider callbacks", () => {
		expect(needsTenant(LINK_START)).toBe(true);
		expect(needsTenant("/api/auth/sign-in/oauth2")).toBe(true);
		expect(needsTenant("/api/auth/link-social")).toBe(true);
		expect(needsTenant(CALLBACK)).toBe(true);
		expect(needsTenant("/api/auth/callback/slack")).toBe(true);
		expect(needsTenant("/api/auth/sign-in/email")).toBe(false);
	});
});

describe("choosing the organization for an auth route", () => {
	it("prefers the link-start organization on the callback over the last-used one", () => {
		const sessionId = freshSession();
		const now = Date.now();

		// The link starts for acme (the slug header the app sends)…
		const started = chooseAuthOrganization({
			path: LINK_START,
			sessionId,
			slugHeader: orgA.slug,
			activeOrganizationId: orgB.id,
			memberships,
			now,
		});
		expect(started).toEqual(orgA);

		// …and the provider's redirect (no header, session says burro) still
		// lands in acme.
		const callback = chooseAuthOrganization({
			path: CALLBACK,
			sessionId,
			slugHeader: null,
			activeOrganizationId: orgB.id,
			memberships,
			now: now + 5_000,
		});
		expect(callback).toEqual(orgA);
	});

	it("forgets the link-start choice after its time is up", () => {
		const sessionId = freshSession();
		const now = Date.now();
		recordLinkStart(sessionId, orgA.id, now);

		expect(linkStartOrganization(sessionId, now + LINK_START_TTL_MS - 1)).toBe(
			orgA.id,
		);
		expect(
			linkStartOrganization(sessionId, now + LINK_START_TTL_MS),
		).toBeNull();

		const callback = chooseAuthOrganization({
			path: CALLBACK,
			sessionId,
			slugHeader: null,
			activeOrganizationId: orgB.id,
			memberships,
			now: now + LINK_START_TTL_MS,
		});
		expect(callback).toEqual(orgB);
	});

	it("keeps sessions apart: another session's link start changes nothing", () => {
		const linking = freshSession();
		const bystander = freshSession();
		const now = Date.now();
		recordLinkStart(linking, orgA.id, now);

		const callback = chooseAuthOrganization({
			path: CALLBACK,
			sessionId: bystander,
			slugHeader: null,
			activeOrganizationId: orgB.id,
			memberships,
			now,
		});
		expect(callback).toEqual(orgB);
	});

	it("falls back to the active, then the most recent membership", () => {
		const sessionId = freshSession();

		expect(
			chooseAuthOrganization({
				path: CALLBACK,
				sessionId,
				slugHeader: null,
				activeOrganizationId: orgB.id,
				memberships,
			}),
		).toEqual(orgB);

		expect(
			chooseAuthOrganization({
				path: CALLBACK,
				sessionId,
				slugHeader: null,
				activeOrganizationId: null,
				memberships,
			}),
		).toEqual(orgA);
	});
});
