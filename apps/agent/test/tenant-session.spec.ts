/**
 * How a session finds its tenant: the `organizationId` auth attribute, read
 * by every tool, hook and event through `inSessionTenant`.
 */
import { describe, expect, it } from "bun:test";
import { currentTenantId, tenantIdOrNull } from "@crm/db";
import { z } from "zod";
import {
	inSessionTenant,
	requireSessionOrganizationId,
	sessionOrganizationId,
	withOrganization,
} from "../agent/lib/tenant";
import { defineTool } from "../agent/lib/tenant-tool";

type Attributes = Readonly<Record<string, string | readonly string[]>>;

function ctx(
	current: Attributes | null,
	initiator: Attributes | null = current,
) {
	return {
		session: {
			id: "session_1",
			auth: {
				current: current ? { attributes: current } : null,
				initiator: initiator ? { attributes: initiator } : null,
			},
		},
	};
}

describe("sessionOrganizationId", () => {
	it("reads the organization the session was started in", () => {
		expect(sessionOrganizationId(ctx({ organizationId: "org_a" }))).toBe(
			"org_a",
		);
	});

	it("falls back to the current caller's organization when the initiator named none", () => {
		expect(sessionOrganizationId(ctx({ organizationId: "org_a" }, {}))).toBe(
			"org_a",
		);
	});

	it("is null for a session that names no organization at all", () => {
		expect(sessionOrganizationId(ctx({}, null))).toBeNull();
		expect(sessionOrganizationId(ctx(null, null))).toBeNull();
	});

	it("refuses a caller from another organization rather than moving the session", () => {
		expect(() =>
			sessionOrganizationId(
				ctx({ organizationId: "org_b" }, { organizationId: "org_a" }),
			),
		).toThrow(/another organization/);
	});

	it("requireSessionOrganizationId insists on one", () => {
		expect(() => requireSessionOrganizationId(ctx({}, null))).toThrow(
			/not attached to an organization/,
		);
	});
});

describe("inSessionTenant", () => {
	it("runs the body inside the session's organization", async () => {
		expect(
			await inSessionTenant(ctx({ organizationId: "org_a" }), async () =>
				currentTenantId(),
			),
		).toBe("org_a");
	});

	it("runs a session with no organization unscoped, so tenant queries fail closed", () => {
		expect(inSessionTenant(ctx({}, null), () => tenantIdOrNull())).toBeNull();
	});
});

describe("the tenant-scoped defineTool", () => {
	const tool = defineTool({
		description: "probe",
		inputSchema: z.object({ echo: z.string() }),
		async execute({ echo }) {
			return { echo, tenant: tenantIdOrNull() };
		},
	});

	it("executes inside the session's organization", async () => {
		const result = await tool.execute(
			{ echo: "hi" },
			ctx({ organizationId: "org_a" }) as never,
		);

		expect(result).toEqual({ echo: "hi", tenant: "org_a" });
	});

	it("executes unscoped when the session names none", async () => {
		const result = await tool.execute({ echo: "hi" }, ctx({}, null) as never);

		expect(result).toEqual({ echo: "hi", tenant: null });
	});
});

describe("withOrganization", () => {
	it("stamps the organization onto an auth principal without losing the rest", () => {
		const auth = withOrganization(
			{ authenticator: "app", attributes: { purpose: "research" } },
			"org_a",
		);

		expect(auth).toEqual({
			authenticator: "app",
			attributes: { purpose: "research", organizationId: "org_a" },
		});
	});
});
