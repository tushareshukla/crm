/**
 * Platform loops (cron routes) visit every active organization, each inside
 * its own tenant scope, and a suspended one is skipped.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { currentTenantId, db, OrgStatus, withoutTenant } from "@crm/db";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
	activeOrganizations,
	forEachActiveOrganization,
} from "../src/tenancy/organizations";
import { startApp } from "./http";
import {
	createTestOrganization,
	deleteTestOrganization,
	type TestOrganization,
} from "./tenant";

const suffix = "cron-spec";
const CRON_SECRET = `${suffix}-secret`;

const SLUGS = {
	first: `${suffix}-first`,
	second: `${suffix}-second`,
	frozen: `${suffix}-frozen`,
} as const;

let app: INestApplication;
let first: TestOrganization;
let second: TestOrganization;
let frozen: TestOrganization;

const previousSecret = process.env.CRON_SECRET;

async function clean() {
	for (const slug of Object.values(SLUGS)) {
		await deleteTestOrganization({ id: `org-${slug}` });
	}
}

beforeAll(async () => {
	await clean();
	// ConfigService reads CRON_SECRET from process.env when the app boots.
	process.env.CRON_SECRET = CRON_SECRET;
	app = await startApp();

	first = await createTestOrganization(SLUGS.first, { name: "First" });
	second = await createTestOrganization(SLUGS.second, { name: "Second" });
	frozen = await createTestOrganization(SLUGS.frozen, {
		name: "Frozen",
		status: OrgStatus.SUSPENDED,
	});
});

afterAll(async () => {
	await clean();
	if (previousSecret === undefined) delete process.env.CRON_SECRET;
	else process.env.CRON_SECRET = previousSecret;
	await app.close();
});

describe("forEachActiveOrganization", () => {
	it("runs the work once per active organization, inside that organization's scope", async () => {
		const visited: string[] = [];

		const outcomes = await forEachActiveOrganization(db, async (org) => {
			const tenant = currentTenantId();
			expect(tenant).toBe(org.id);
			visited.push(tenant);

			// A write made here lands in this organization and nowhere else.
			if (tenant === first.id || tenant === second.id) {
				await db.suppressedDomain.create({
					data: { domain: `${suffix}-${org.slug}.test` },
				});
			}
			return tenant;
		});

		expect(visited).toContain(first.id);
		expect(visited).toContain(second.id);
		expect(visited).not.toContain(frozen.id);
		expect(new Set(visited).size).toBe(visited.length);
		expect(outcomes.every((outcome) => outcome.ok)).toBe(true);

		const rows = await withoutTenant(() =>
			db.suppressedDomain.findMany({
				where: { domain: { startsWith: `${suffix}-` } },
				select: { organizationId: true, domain: true },
			}),
		);
		expect(rows).toContainEqual({
			organizationId: first.id,
			domain: `${suffix}-${first.slug}.test`,
		});
		expect(rows).toContainEqual({
			organizationId: second.id,
			domain: `${suffix}-${second.slug}.test`,
		});
		expect(rows.some((row) => row.organizationId === frozen.id)).toBe(false);
	});

	it("visits organizations oldest first and matches activeOrganizations", async () => {
		const active = await activeOrganizations(db);
		const ids = active.map((org) => org.id);

		expect(ids).toContain(first.id);
		expect(ids).not.toContain(frozen.id);
		expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));

		const visited = (await forEachActiveOrganization(db, async (org) => org.id))
			.filter((outcome) => outcome.ok)
			.map((outcome) => outcome.org.id);
		expect(visited).toEqual(ids);
	});

	it("reports a failing organization and carries on with the rest", async () => {
		const outcomes = await forEachActiveOrganization(db, async (org) => {
			if (org.id === first.id) throw new Error(`${suffix}: boom`);
			return "fine";
		});

		const failed = outcomes.filter((outcome) => !outcome.ok);
		expect(failed.map((outcome) => outcome.org.id)).toEqual([first.id]);
		expect(
			failed[0] && !failed[0].ok && failed[0].error instanceof Error
				? failed[0].error.message
				: null,
		).toBe(`${suffix}: boom`);

		const fine = outcomes.find((outcome) => outcome.org.id === second.id);
		expect(fine).toMatchObject({ ok: true, result: "fine" });
	});

	it("leaves no tenant scope behind", async () => {
		await forEachActiveOrganization(db, async () => undefined);

		expect(() => currentTenantId()).toThrow();
	});
});

describe("the cron routes", () => {
	const expectedOrganizations = async () =>
		(await activeOrganizations(db)).length;

	it("refuse a caller without the cron secret", async () => {
		await request(app.getHttpServer())
			.get("/internal/sync/mailboxes")
			.expect(403);
		await request(app.getHttpServer())
			.post("/internal/sync/mailboxes")
			.set("authorization", "Bearer wrong")
			.expect(403);
		await request(app.getHttpServer())
			.get("/internal/tracking/retention")
			.expect(403);
	});

	it("the mailbox sync tick runs once per active organization", async () => {
		const response = await request(app.getHttpServer())
			.get("/internal/sync/mailboxes")
			.set("authorization", `Bearer ${CRON_SECRET}`)
			.expect(200);

		expect(response.body).toMatchObject({
			organizations: await expectedOrganizations(),
			failedOrganizations: [],
			attempted: 0,
			synced: 0,
			failed: 0,
		});
	});

	it("a suspended organization is not visited; unsuspending it is", async () => {
		const before = (
			await request(app.getHttpServer())
				.post("/internal/sync/mailboxes")
				.set("authorization", `Bearer ${CRON_SECRET}`)
				.expect(201)
		).body.organizations as number;

		await withoutTenant(() =>
			db.organization.update({
				where: { id: frozen.id },
				data: { status: OrgStatus.ACTIVE },
			}),
		);

		try {
			const after = (
				await request(app.getHttpServer())
					.post("/internal/sync/mailboxes")
					.set("authorization", `Bearer ${CRON_SECRET}`)
					.expect(201)
			).body.organizations as number;

			expect(after).toBe(before + 1);
		} finally {
			await withoutTenant(() =>
				db.organization.update({
					where: { id: frozen.id },
					data: { status: OrgStatus.SUSPENDED },
				}),
			);
		}
	});

	it("tracking retention rolls up per organization and sweeps globally", async () => {
		const response = await request(app.getHttpServer())
			.get("/internal/tracking/retention")
			.set("authorization", `Bearer ${CRON_SECRET}`)
			.expect(200);

		expect(response.body).toMatchObject({
			rolled: expect.any(Number),
			removed: expect.any(Number),
			complete: true,
			visitors: expect.any(Number),
			counters: expect.any(Number),
		});
	});
});
