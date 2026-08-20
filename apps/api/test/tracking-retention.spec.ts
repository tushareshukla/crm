/**
 * Tracking rollups pin the organization all the way into the daily table, and
 * the retention sweep never destroys events the rollup has not counted yet.
 */
import { describe, expect } from "bun:test";
import { currentTenantId, db } from "@crm/db";
import type { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../src/config/env.validation";
import { TrackingRetentionController } from "../src/tracking/tracking.controller";
import type { TrackingCounterService } from "../src/tracking/tracking-counter.service";
import { TrackingRollupService } from "../src/tracking/tracking-rollup.service";
import {
	afterAll,
	beforeAll,
	createTestOrganization,
	deleteTestOrganization,
	it,
	runWithTenant,
	type TestOrganization,
	withoutTenant,
} from "./tenant";

const suffix = process.env.TEST_RUN_ID ?? "retention-spec";
const SECRET = `${suffix}-secret`;
const host = `rollup-${suffix}.test`;

/** Comfortably past any retention window. */
const OLD = new Date("2020-01-06T10:00:00.000Z");
const CUTOFF = new Date("2020-02-01T00:00:00.000Z");

let steady: TestOrganization;
let broken: TestOrganization;

const rollups = new TrackingRollupService(db);

async function pageView(path: string, visitorId: string, at = OLD) {
	await db.trackedEvent.create({
		data: {
			visitorId,
			type: "page_view",
			host,
			path,
			occurredAt: at,
		},
	});
}

async function clean() {
	await deleteTestOrganization({ id: `org-steady-${suffix}` });
	await deleteTestOrganization({ id: `org-broken-${suffix}` });
}

beforeAll(async () => {
	await clean();
	steady = await createTestOrganization(`steady-${suffix}`);
	broken = await createTestOrganization(`broken-${suffix}`);
});

afterAll(clean);

describe("the daily rollup", () => {
	it("pins the organization and lands on the per-organization key, twice over", async () => {
		await runWithTenant(steady.id, async () => {
			await pageView("/", "v-1");
			await pageView("/", "v-2");
			await pageView("/pricing", "v-1");
		});
		// The same day, host and path in another organization: the arbiter must
		// include the organization or these two rollups collide.
		await runWithTenant(broken.id, () => pageView("/", "v-9"));

		expect(await runWithTenant(steady.id, () => rollups.run(CUTOFF))).toBe(2);
		expect(await runWithTenant(broken.id, () => rollups.run(CUTOFF))).toBe(1);

		// Running again upserts on the compound key instead of erroring out.
		expect(await runWithTenant(steady.id, () => rollups.run(CUTOFF))).toBe(2);

		const rows = await withoutTenant(() =>
			db.trackedPageDaily.findMany({
				where: { host },
				select: { organizationId: true, path: true, views: true },
			}),
		);
		const byKey = (a: { organizationId: string; path: string }) =>
			`${a.organizationId} ${a.path}`;
		expect([...rows].sort((a, b) => byKey(a).localeCompare(byKey(b)))).toEqual(
			[
				{ organizationId: broken.id, path: "/", views: 1 },
				{ organizationId: steady.id, path: "/", views: 2 },
				{ organizationId: steady.id, path: "/pricing", views: 1 },
			].sort((a, b) => byKey(a).localeCompare(byKey(b))),
		);
	});
});

describe("the retention sweep", () => {
	it("spares an organization whose rollup failed, and says so", async () => {
		const failing = {
			run: async () => {
				if (currentTenantId() === broken.id) {
					throw new Error(`${suffix}: rollup exploded`);
				}
				return 0;
			},
		} as unknown as TrackingRollupService;
		const counters = {
			sweep: async () => 0,
		} as unknown as TrackingCounterService;
		const config = {
			get: () => SECRET,
		} as unknown as ConfigService<EnvironmentVariables, true>;

		const controller = new TrackingRetentionController(
			db,
			failing,
			counters,
			config,
		);

		const result = await controller.viaGet(`Bearer ${SECRET}`);

		expect(result.failedOrganizations).toEqual([broken.slug]);

		// The healthy organization's expired events were swept…
		expect(await runWithTenant(steady.id, () => db.trackedEvent.count())).toBe(
			0,
		);
		// …the failing organization keeps its events for a later rollup.
		expect(await runWithTenant(broken.id, () => db.trackedEvent.count())).toBe(
			1,
		);
	});
});
