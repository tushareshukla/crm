import { describe, expect, it } from "bun:test";
import {
	auditActorLabel,
	auditEventDetail,
	auditEventLabel,
} from "../lib/audit-event";

const jane = { name: "Jane Doe", email: "jane@acme.com" };

describe("audit events", () => {
	it("labels every type the API writes, and falls back to the raw type", () => {
		expect(auditEventLabel("invite.created")).toBe("Invitation sent");
		expect(auditEventLabel("admin.entered")).toBe("Platform admin entered");
		expect(auditEventLabel("something.new")).toBe("something.new");
	});

	it("names the actor, or the platform when nobody did it", () => {
		expect(auditActorLabel(jane)).toBe("Jane Doe");
		expect(auditActorLabel({ name: "  ", email: "jane@acme.com" })).toBe(
			"jane@acme.com",
		);
		expect(auditActorLabel(null)).toBe("Platform");
	});

	it("summarises the data without trusting its shape", () => {
		expect(
			auditEventDetail({
				type: "invite.created",
				subject: "inv_1",
				data: { email: "bob@acme.com", role: "admin" },
				actor: jane,
			}),
		).toBe("bob@acme.com as admin");

		expect(
			auditEventDetail({
				type: "org.updated",
				subject: "org_1",
				data: { name: "Acme", slug: "acme" },
				actor: jane,
			}),
		).toBe("name: Acme, slug: acme");

		expect(
			auditEventDetail({
				type: "member.role_changed",
				subject: "user_2",
				data: { role: "owner" },
				actor: jane,
			}),
		).toBe("now owner");

		expect(
			auditEventDetail({
				type: "org.suspended",
				subject: "org_1",
				data: null,
				actor: null,
			}),
		).toBe("org_1");

		expect(
			auditEventDetail({
				type: "invite.accepted",
				subject: "inv_1",
				data: "not an object",
				actor: jane,
			}),
		).toBeNull();
	});
});
