/**
 * The bridge's `x-org-slug` fallback: honoured only for a rep who belongs to
 * that organization.
 */
import { describe, expect } from "bun:test";
import { db } from "@crm/db";
import { resolveOrganization } from "../agent/channels/eve";
import {
	afterAll,
	beforeAll,
	ensureMember,
	ensureOrganization,
	it,
	OTHER_ORGANIZATION,
	TEST_ORGANIZATION,
} from "./support/tenant";

const USER_ID = "channel-org-spec-user";
const STRANGER_ID = "channel-org-spec-stranger";

beforeAll(async () => {
	await ensureOrganization(OTHER_ORGANIZATION);
	for (const id of [USER_ID, STRANGER_ID]) {
		await db.user.upsert({
			where: { id },
			create: { id, name: id, email: `${id}@example.test` },
			update: {},
		});
	}
	await ensureMember(USER_ID, TEST_ORGANIZATION.id);
});

afterAll(async () => {
	await db.member.deleteMany({
		where: { userId: { in: [USER_ID, STRANGER_ID] } },
	});
	await db.user.deleteMany({ where: { id: { in: [USER_ID, STRANGER_ID] } } });
});

describe("resolveOrganization", () => {
	it("resolves the slug for a member and stamps the organization onto the session", async () => {
		const attributes = await resolveOrganization(
			USER_ID,
			{ email: "rep@example.test" },
			TEST_ORGANIZATION.slug,
		);

		expect(attributes).toMatchObject({
			email: "rep@example.test",
			organizationId: TEST_ORGANIZATION.id,
		});
	});

	it("refuses a slug the rep is not a member of", async () => {
		expect(
			await resolveOrganization(USER_ID, {}, OTHER_ORGANIZATION.slug),
		).toBeNull();
		expect(
			await resolveOrganization(STRANGER_ID, {}, TEST_ORGANIZATION.slug),
		).toBeNull();
	});

	it("refuses a slug that names no organization", async () => {
		expect(await resolveOrganization(USER_ID, {}, "no-such-org")).toBeNull();
	});

	it("trusts the signed claim over the header", async () => {
		const attributes = await resolveOrganization(
			STRANGER_ID,
			{ organizationId: OTHER_ORGANIZATION.id },
			TEST_ORGANIZATION.slug,
		);

		expect(attributes).toMatchObject({ organizationId: OTHER_ORGANIZATION.id });
	});
});
