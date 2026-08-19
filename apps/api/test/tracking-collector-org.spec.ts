/**
 * The tracking collector is anonymous and shared: the site id in a beacon (or
 * a config request) names the organization, and everything that follows runs
 * in that organization's scope. A suspended organization's site goes quiet.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, OrgStatus, withoutTenant } from "@crm/db";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { startApp } from "./http";
import {
	createTestOrganization,
	deleteTestOrganization,
	inTenant,
	type TestOrganization,
} from "./tenant";

const suffix = "collector-spec";

const SLUGS = {
	a: `${suffix}-a`,
	b: `${suffix}-b`,
	frozen: `${suffix}-frozen`,
} as const;

/** Site ids are `cmp_` + 8 hex characters. */
const SITES = {
	a: "cmp_c011ec7a",
	b: "cmp_c011ec7b",
	frozen: "cmp_c011ec7f",
	unknown: "cmp_00000000",
} as const;

const HOSTS = {
	a: `a-${suffix}.test`,
	b: `b-${suffix}.test`,
	frozen: `frozen-${suffix}.test`,
} as const;

let app: INestApplication;
let orgA: TestOrganization;
let orgB: TestOrganization;
let frozen: TestOrganization;

let visitor = 0;

function visitorId(): string {
	visitor += 1;

	return `collector${visitor}`.padEnd(10, "0");
}

async function installSite(
	org: TestOrganization,
	siteId: string,
	host: string,
) {
	await inTenant(org.id, async () => {
		await db.appSetting.create({
			data: { id: org.id, trackingSiteId: siteId },
		});
		await db.trackedDomain.create({
			data: { host, scope: "SITE_AND_SUBDOMAINS" },
		});
	});
}

function beacon(siteId: string, host: string, paths: string[]) {
	return request(app.getHttpServer())
		.post("/api/t/e")
		.set("origin", `https://${host}`)
		.set("content-type", "text/plain")
		.send(
			JSON.stringify({
				siteId,
				visitorId: visitorId(),
				events: paths.map((path, index) => ({
					type: "page_view",
					host,
					path,
					at: Date.now() - index,
				})),
			}),
		);
}

const eventsOf = (organizationId: string) =>
	withoutTenant(() =>
		db.trackedEvent.findMany({
			where: { organizationId },
			select: { host: true, path: true },
			orderBy: { path: "asc" },
		}),
	);

const pageViewsOf = (organizationId: string, host: string) =>
	withoutTenant(() =>
		db.trackedDomain.findUnique({
			where: { organizationId_host: { organizationId, host } },
			select: { pageViews: true },
		}),
	);

async function clean() {
	for (const slug of Object.values(SLUGS)) {
		await deleteTestOrganization({ id: `org-${slug}` });
	}
}

beforeAll(async () => {
	await clean();
	app = await startApp();

	orgA = await createTestOrganization(SLUGS.a, { name: "Site A" });
	orgB = await createTestOrganization(SLUGS.b, { name: "Site B" });
	frozen = await createTestOrganization(SLUGS.frozen, {
		name: "Frozen",
		status: OrgStatus.SUSPENDED,
	});

	await installSite(orgA, SITES.a, HOSTS.a);
	await installSite(orgB, SITES.b, HOSTS.b);
	await installSite(frozen, SITES.frozen, HOSTS.frozen);
});

afterAll(async () => {
	await clean();
	await app.close();
});

describe("GET /api/t/config/:siteId", () => {
	it("answers with the organization the site id belongs to", async () => {
		const a = await request(app.getHttpServer())
			.get(`/api/t/config/${SITES.a}`)
			.expect(200);
		expect(a.body.config).toMatchObject({
			siteId: SITES.a,
			hosts: [{ host: HOSTS.a, scope: "SITE_AND_SUBDOMAINS" }],
		});
		expect(a.body.hash).toEqual(expect.any(String));

		const b = await request(app.getHttpServer())
			.get(`/api/t/config/${SITES.b}`)
			.expect(200);
		expect(b.body.config).toMatchObject({
			siteId: SITES.b,
			hosts: [{ host: HOSTS.b, scope: "SITE_AND_SUBDOMAINS" }],
		});
	});

	it("answers with nothing for a site id nobody owns, a malformed one, or a suspended organization's", async () => {
		for (const siteId of [SITES.unknown, "not-a-site", SITES.frozen]) {
			const response = await request(app.getHttpServer())
				.get(`/api/t/config/${siteId}`)
				.expect(200);
			expect(response.body).toEqual({ config: null });
		}
	});
});

describe("POST /api/t/e", () => {
	it("files a beacon under the organization its site id names", async () => {
		await beacon(SITES.a, HOSTS.a, ["/pricing", "/docs"]).expect(204);

		expect(await eventsOf(orgA.id)).toEqual([
			{ host: HOSTS.a, path: "/docs" },
			{ host: HOSTS.a, path: "/pricing" },
		]);
		expect(await eventsOf(orgB.id)).toEqual([]);
		expect((await pageViewsOf(orgA.id, HOSTS.a))?.pageViews).toBe(2);
		expect((await pageViewsOf(orgB.id, HOSTS.b))?.pageViews).toBe(0);
	});

	it("judges the beacon against that organization's own configuration", async () => {
		// B's site id with A's host: B does not track A's domain, so nothing is kept anywhere.
		await beacon(SITES.b, HOSTS.a, ["/crossed"]).expect(204);

		expect(await eventsOf(orgB.id)).toEqual([]);
		expect(
			(await eventsOf(orgA.id)).some((event) => event.path === "/crossed"),
		).toBe(false);

		await beacon(SITES.b, HOSTS.b, ["/home"]).expect(204);
		expect(await eventsOf(orgB.id)).toEqual([{ host: HOSTS.b, path: "/home" }]);
	});

	it("keeps the rate-limit window per organization", async () => {
		const counters = await withoutTenant(() =>
			db.trackingCounter.findMany({
				where: {
					organizationId: { in: [orgA.id, orgB.id] },
					key: { startsWith: "rate:" },
				},
				select: { organizationId: true, value: true },
			}),
		);

		const byOrg = new Map(
			counters.map((row) => [row.organizationId, row.value] as const),
		);
		expect(byOrg.get(orgA.id)).toBe(2);
		expect(byOrg.get(orgB.id)).toBe(1);
	});

	it("drops a beacon for a suspended organization's site", async () => {
		await beacon(SITES.frozen, HOSTS.frozen, ["/quiet"]).expect(204);

		expect(await eventsOf(frozen.id)).toEqual([]);
	});

	it("drops a beacon for a site id nobody owns", async () => {
		const before = await withoutTenant(() => db.trackedEvent.count());

		await beacon(SITES.unknown, HOSTS.a, ["/nowhere"]).expect(204);

		expect(await withoutTenant(() => db.trackedEvent.count())).toBe(before);
	});
});
