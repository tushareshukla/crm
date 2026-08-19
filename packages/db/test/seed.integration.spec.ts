/**
 * The demo seed is tenant code: `bun prisma/seed.ts` with SEED_ORG_SLUG lands
 * every row in that one organization and nothing anywhere else. Runs the real
 * script as a child process against TEST_DATABASE_URL (NODE_ENV=test).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { db } from "../src/client";
import { runWithTenant, withoutTenant } from "../src/tenant";

const SLUG = "seed-test";
const ORG_ID = `org-${SLUG}`;
const PACKAGE_ROOT = resolve(import.meta.dir, "..");

/** Placeholder reps the seed creates only when the database has no users. */
const PLACEHOLDER_USER_IDS = [
	"seed-ada-okafor",
	"seed-marcus-lindqvist",
	"seed-priya-raman",
];

/** A few of the seed's fixed identifiers, to prove they exist nowhere but in the org. */
const SEED_DOMAINS = ["stripe.com", "linear.app", "attio.com"];
const SEED_DEAL_PREFIX = "seed-deal-";
const COMPANY_COUNT = 15;

let seed: { exitCode: number; stdout: string; stderr: string };

const clear = async () => {
	await withoutTenant(async () => {
		// The org cascades to every tenant row the seed wrote.
		await db.organization.deleteMany({ where: { id: ORG_ID } });
		await db.user.deleteMany({ where: { id: { in: PLACEHOLDER_USER_IDS } } });
		await db.exchangeRate.deleteMany({ where: { provider: "seed" } });
	});
};

const runSeed = async () => {
	const proc = Bun.spawn(["bun", "prisma/seed.ts"], {
		cwd: PACKAGE_ROOT,
		env: { ...process.env, NODE_ENV: "test", SEED_ORG_SLUG: SLUG },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { exitCode, stdout, stderr };
};

beforeAll(async () => {
	await clear();
	seed = await runSeed();
}, 240_000);

afterAll(clear);

describe("prisma/seed.ts under SEED_ORG_SLUG", () => {
	test("exits cleanly and reports the org it seeded into", () => {
		expect(seed.exitCode).toBe(0);
		expect(seed.stdout).toContain(
			`Seeding into organization "${SLUG}" (${ORG_ID})`,
		);
		expect(seed.stdout).toMatch(
			/Seeded \d+ companies, \d+ contacts, \d+ deals/,
		);
	});

	test("creates the organization with that slug", async () => {
		const org = await db.organization.findUnique({
			where: { slug: SLUG },
			select: { id: true, status: true },
		});
		expect(org?.id).toBe(ORG_ID);
		expect(org?.status).toBe("ACTIVE");
	});

	test("the whole demo pipeline is visible from inside the org", async () => {
		const counts = await runWithTenant(ORG_ID, () =>
			db.$transaction([
				db.company.count(),
				db.contact.count(),
				db.deal.count(),
				db.dealContact.count(),
				db.activity.count(),
				db.appSetting.count(),
			]),
		);
		const [companies, contacts, deals, dealContacts, activities, settings] =
			counts;
		expect(companies).toBe(COMPANY_COUNT);
		expect(contacts).toBeGreaterThan(0);
		expect(deals).toBeGreaterThan(0);
		expect(dealContacts).toBeGreaterThan(0);
		expect(activities).toBeGreaterThan(0);
		expect(settings).toBe(1);

		// AppSetting.id is the org id
		const setting = await runWithTenant(ORG_ID, () =>
			db.appSetting.findUnique({ where: { id: ORG_ID } }),
		);
		expect(setting?.organizationId).toBe(ORG_ID);
	});

	test("every tenant row the seed wrote carries the org id", async () => {
		const strays = await withoutTenant(() =>
			db.$transaction([
				db.company.count({
					where: {
						domain: { in: SEED_DOMAINS },
						organizationId: { not: ORG_ID },
					},
				}),
				db.deal.count({
					where: {
						id: { startsWith: SEED_DEAL_PREFIX },
						organizationId: { not: ORG_ID },
					},
				}),
				db.dealContact.count({
					where: {
						dealId: { startsWith: SEED_DEAL_PREFIX },
						organizationId: { not: ORG_ID },
					},
				}),
				db.activity.count({
					where: {
						dealId: { startsWith: SEED_DEAL_PREFIX },
						organizationId: { not: ORG_ID },
					},
				}),
				db.contact.count({
					where: {
						company: { domain: { in: SEED_DOMAINS } },
						organizationId: { not: ORG_ID },
					},
				}),
				db.appSetting.count({
					where: { id: ORG_ID, organizationId: { not: ORG_ID } },
				}),
			]),
		);
		expect(strays).toEqual([0, 0, 0, 0, 0, 0]);

		// and the rows that *are* there hang together inside the org
		const linked = await withoutTenant(() =>
			db.company.findMany({
				where: { organizationId: ORG_ID, domain: { in: SEED_DOMAINS } },
				select: {
					organizationId: true,
					contacts: { select: { organizationId: true } },
					deals: {
						select: {
							organizationId: true,
							contacts: { select: { organizationId: true } },
							activities: { select: { organizationId: true } },
						},
					},
				},
			}),
		);
		expect(linked).toHaveLength(SEED_DOMAINS.length);
		for (const company of linked) {
			expect(company.organizationId).toBe(ORG_ID);
			expect(company.contacts.length).toBeGreaterThan(0);
			expect(company.deals.length).toBeGreaterThan(0);
			for (const contact of company.contacts)
				expect(contact.organizationId).toBe(ORG_ID);
			for (const deal of company.deals) {
				expect(deal.organizationId).toBe(ORG_ID);
				for (const row of [...deal.contacts, ...deal.activities])
					expect(row.organizationId).toBe(ORG_ID);
			}
		}
	});

	test("nothing of it leaks into another org", async () => {
		const other = {
			id: "org-seed-test-bystander",
			slug: "seed-test-bystander",
		};
		await withoutTenant(async () => {
			await db.organization.deleteMany({ where: { id: other.id } });
			await db.organization.create({
				data: {
					id: other.id,
					name: other.slug,
					slug: other.slug,
					createdAt: new Date(),
				},
			});
		});
		try {
			const seen = await runWithTenant(other.id, () =>
				db.$transaction([
					db.company.count(),
					db.contact.count(),
					db.deal.count(),
					db.activity.count(),
					db.appSetting.count(),
				]),
			);
			expect(seen).toEqual([0, 0, 0, 0, 0]);
		} finally {
			await withoutTenant(() =>
				db.organization.deleteMany({ where: { id: other.id } }),
			);
		}
	});

	test("is idempotent: a second run changes nothing", async () => {
		const before = await runWithTenant(ORG_ID, () =>
			db.$transaction([
				db.company.count(),
				db.contact.count(),
				db.deal.count(),
				db.activity.count(),
			]),
		);

		const again = await runSeed();
		expect(again.exitCode).toBe(0);

		const after = await runWithTenant(ORG_ID, () =>
			db.$transaction([
				db.company.count(),
				db.contact.count(),
				db.deal.count(),
				db.activity.count(),
			]),
		);
		expect(after).toEqual(before);
		expect(await db.organization.count({ where: { slug: SLUG } })).toBe(1);
	}, 240_000);
});
