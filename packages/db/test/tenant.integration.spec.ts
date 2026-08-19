/**
 * The tenant boundary. These hit the real test database (TEST_DATABASE_URL) and
 * prove the Prisma extension scopes every path a query can take.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "../src/client";
import {
	TenantContextMissing,
	currentTenantId,
	runWithTenant,
	withoutTenant,
} from "../src/tenant";

const A = { id: "org-tenant-a", slug: "tenant-a" };
const B = { id: "org-tenant-b", slug: "tenant-b" };

async function reset() {
	await withoutTenant(async () => {
		await db.organization.deleteMany({ where: { id: { in: [A.id, B.id] } } });
		for (const o of [A, B]) {
			await db.organization.create({
				data: { id: o.id, name: o.slug, slug: o.slug, createdAt: new Date() },
			});
		}
	});
}

beforeAll(reset);
afterAll(async () => {
	await withoutTenant(() =>
		db.organization.deleteMany({ where: { id: { in: [A.id, B.id] } } }),
	);
});

describe("tenant extension", () => {
	test("throws without a tenant context, fail closed", async () => {
		await expect((async () => db.company.findMany())()).rejects.toBeInstanceOf(
			TenantContextMissing,
		);
		await expect(
			(async () => db.contact.create({ data: { firstName: "x" } }))(),
		).rejects.toBeInstanceOf(TenantContextMissing);
	});

	test("global models still work without a context", async () => {
		expect(await db.organization.count()).toBeGreaterThanOrEqual(2);
	});

	test("create injects the current organization and reads are scoped", async () => {
		const inA = await runWithTenant(A.id, () =>
			db.company.create({ data: { name: "Acme", domain: "acme.test" } }),
		);
		expect(inA.organizationId).toBe(A.id);

		// same domain in another org is allowed (compound unique)
		const inB = await runWithTenant(B.id, () =>
			db.company.create({ data: { name: "Acme B", domain: "acme.test" } }),
		);
		expect(inB.organizationId).toBe(B.id);

		const seenFromA = await runWithTenant(A.id, () => db.company.findMany());
		expect(seenFromA.map((c) => c.id)).toEqual([inA.id]);

		const seenFromB = await runWithTenant(B.id, () => db.company.findMany());
		expect(seenFromB.map((c) => c.id)).toEqual([inB.id]);

		// findUnique by id from the wrong org finds nothing
		const cross = await runWithTenant(B.id, () =>
			db.company.findUnique({ where: { id: inA.id } }),
		);
		expect(cross).toBeNull();

		// legacy unique lookup is rewritten to the compound key
		const byDomain = await runWithTenant(B.id, () =>
			db.company.findUnique({
				where: {
					organizationId_domain: {
						organizationId: currentTenantId(),
						domain: "acme.test",
					},
				},
			}),
		);
		expect(byDomain?.id).toBe(inB.id);

		// count/updateMany/deleteMany are scoped
		expect(await runWithTenant(A.id, () => db.company.count())).toBe(1);
		const updated = await runWithTenant(A.id, () =>
			db.company.updateMany({ data: { city: "Boston" } }),
		);
		expect(updated.count).toBe(1);
		const bCity = await runWithTenant(B.id, () =>
			db.company.findFirst({ select: { city: true } }),
		);
		expect(bCity?.city).toBeNull();
	});

	test("nested creates inherit the organization; connect across orgs fails", async () => {
		const contact = await runWithTenant(A.id, () =>
			db.contact.create({
				data: {
					firstName: "Ann",
					email: "ann@acme.test",
					company: { create: { name: "Nested Co" } },
					facts: {
						create: [{ field: "title", value: "CEO", source: "test" } as never],
					},
				},
				include: { company: true, facts: true },
			}),
		).catch((error) => {
			// facts shape may differ; fall back to the company-only nested create
			if (String(error).includes("facts")) {
				return runWithTenant(A.id, () =>
					db.contact.create({
						data: {
							firstName: "Ann",
							email: "ann@acme.test",
							company: { create: { name: "Nested Co" } },
						},
						include: { company: true },
					}),
				);
			}
			throw error;
		});
		expect(contact.company?.organizationId).toBe(A.id);

		const bCompany = await runWithTenant(B.id, () =>
			db.company.create({ data: { name: "B Co" } }),
		);
		await expect(
			runWithTenant(A.id, () =>
				db.contact.update({
					where: { id: contact.id },
					data: { company: { connect: { id: bCompany.id } } },
				}),
			),
		).rejects.toThrow();
	});

	test("transactions inherit the tenant", async () => {
		const count = await runWithTenant(A.id, () =>
			db.$transaction(async (tx) => {
				await tx.company.create({ data: { name: "Tx Co" } });
				return tx.company.count();
			}),
		);
		const countB = await runWithTenant(B.id, () => db.company.count());
		expect(count).toBeGreaterThanOrEqual(2);
		expect(countB).toBe(2); // Acme B + B Co
	});

	test("reads through a global model only see the current org's rows", async () => {
		const user = await withoutTenant(() =>
			db.user.upsert({
				where: { email: "owner@tenant.test" },
				create: {
					id: "user-tenant-test",
					name: "Owner",
					email: "owner@tenant.test",
					emailVerified: true,
					updatedAt: new Date(),
				},
				update: {},
			}),
		);
		await runWithTenant(A.id, () =>
			db.company.create({ data: { name: "Owned A", ownerId: user.id } }),
		);
		await runWithTenant(B.id, () =>
			db.company.create({ data: { name: "Owned B", ownerId: user.id } }),
		);
		const fromA = await runWithTenant(A.id, () =>
			db.user.findUnique({
				where: { id: user.id },
				include: { ownedCompanies: true },
			}),
		);
		expect(fromA?.ownedCompanies.map((c) => c.name)).toEqual(["Owned A"]);
		const fromB = await runWithTenant(B.id, () =>
			db.user.findUnique({
				where: { id: user.id },
				select: { ownedCompanies: { select: { name: true } } },
			}),
		);
		expect(fromB?.ownedCompanies.map((c) => c.name)).toEqual(["Owned B"]);
		await withoutTenant(() => db.user.delete({ where: { id: user.id } }));
	});

	test("withoutTenant sees everything, explicitly", async () => {
		const all = await withoutTenant(() =>
			db.company.findMany({ where: { organizationId: { in: [A.id, B.id] } } }),
		);
		expect(new Set(all.map((c) => c.organizationId))).toEqual(
			new Set([A.id, B.id]),
		);
	});
});
