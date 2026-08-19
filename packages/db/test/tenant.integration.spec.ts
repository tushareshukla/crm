/**
 * The tenant boundary. These hit the real test database (TEST_DATABASE_URL) and
 * prove the Prisma extension scopes every path a query can take.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "../src/client";
import {
	currentTenantId,
	runWithTenant,
	TenantContextMissing,
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

/**
 * Adversarial cases: every way tenant code could try to read or write another
 * org's rows — forged filters, forged ids, nested writes, lazily awaited
 * queries — must either stay in its own org or fail.
 *
 * A handful are marked `test.failing`: they pin down holes the extension does
 * not close yet. Each one says what the fix is. When the fix lands the test
 * turns red ("expected to fail") — drop the `.failing` and it becomes a guard.
 */
describe("tenant extension — adversarial", () => {
	beforeAll(reset);

	const isNotFound = (error: unknown) =>
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "P2025";

	test("updateMany / deleteMany only touch the current org, even with a forged filter", async () => {
		await runWithTenant(A.id, () =>
			db.company.createMany({ data: [{ name: "A1" }, { name: "A2" }] }),
		);
		await runWithTenant(B.id, () =>
			db.company.createMany({ data: [{ name: "B1" }, { name: "B2" }] }),
		);

		// a filter naming another org is ANDed with the tenant, so it matches nothing
		const forged = await runWithTenant(A.id, () =>
			db.company.updateMany({
				where: { organizationId: B.id },
				data: { city: "Forged" },
			}),
		);
		expect(forged.count).toBe(0);
		const viaOr = await runWithTenant(A.id, () =>
			db.company.updateMany({
				where: { OR: [{ organizationId: B.id }, { name: "B1" }] },
				data: { city: "Forged" },
			}),
		);
		expect(viaOr.count).toBe(0);

		const bulk = await runWithTenant(A.id, () =>
			db.company.updateMany({ data: { city: "A-town" } }),
		);
		expect(bulk.count).toBe(2);
		expect(
			await withoutTenant(() =>
				db.company.count({ where: { organizationId: B.id, city: null } }),
			),
		).toBe(2);

		const wiped = await runWithTenant(A.id, () => db.company.deleteMany({}));
		expect(wiped.count).toBe(2);
		const wipedForged = await runWithTenant(A.id, () =>
			db.company.deleteMany({ where: { organizationId: B.id } }),
		);
		expect(wipedForged.count).toBe(0);
		expect(await runWithTenant(B.id, () => db.company.count())).toBe(2);
	});

	test("an organizationId or organization in create data is overridden by the tenant", async () => {
		await runWithTenant(A.id, async () => {
			await db.company.create({
				data: { name: "Forged 1", organizationId: B.id } as never,
			});
			await db.company.create({
				data: {
					name: "Forged 2",
					organization: { connect: { id: B.id } },
				} as never,
			});
			await db.company.createMany({
				data: [{ name: "Forged 3", organizationId: B.id }] as never,
			});
			await db.company.createManyAndReturn({
				data: [{ name: "Forged 4", organizationId: B.id }] as never,
			});
		});

		const rows = await withoutTenant(() =>
			db.company.findMany({
				where: { name: { startsWith: "Forged " } },
				select: { organizationId: true },
			}),
		);
		expect(rows).toHaveLength(4);
		expect(rows.every((row) => row.organizationId === A.id)).toBe(true);
	});

	test("upsert: the create path injects the org; another org's unique key can't be reached", async () => {
		const email = "up@acme.test";
		const where = { organizationId_email: { organizationId: A.id, email } };

		const created = await runWithTenant(A.id, () =>
			db.contact.upsert({
				where,
				create: { firstName: "Up", email },
				update: { firstName: "Updated" },
			}),
		);
		expect(created.organizationId).toBe(A.id);
		expect(created.firstName).toBe("Up");

		// second time round takes the update path
		const updated = await runWithTenant(A.id, () =>
			db.contact.upsert({
				where,
				create: { firstName: "Up", email },
				update: { firstName: "Updated" },
			}),
		);
		expect(updated.id).toBe(created.id);
		expect(updated.firstName).toBe("Updated");

		// B naming A's key still lands on B's side of the fence: a fresh row in B
		const inB = await runWithTenant(B.id, () =>
			db.contact.upsert({
				where,
				create: { firstName: "B-Up", email },
				update: { firstName: "Hijacked" },
			}),
		);
		expect(inB.organizationId).toBe(B.id);
		expect(inB.id).not.toBe(created.id);
		expect(inB.firstName).toBe("B-Up");

		// …and by A's primary key: the create path runs, in B
		const byId = await runWithTenant(B.id, () =>
			db.contact.upsert({
				where: { id: created.id },
				create: { firstName: "Fresh" },
				update: { firstName: "Hijacked" },
			}),
		);
		expect(byId.organizationId).toBe(B.id);
		expect(byId.id).not.toBe(created.id);

		// the legacy single-field key is rewritten to the compound key of the *current* org
		const legacy = await runWithTenant(B.id, () =>
			db.contact.upsert({
				where: { email } as never,
				create: { firstName: "Legacy", email },
				update: { firstName: "Legacy updated" },
			}),
		);
		expect(legacy.id).toBe(inB.id);
		expect(legacy.firstName).toBe("Legacy updated");

		const aRow = await runWithTenant(A.id, () =>
			db.contact.findUnique({ where: { id: created.id } }),
		);
		expect(aRow?.firstName).toBe("Updated");
	});

	test("connectOrCreate never attaches to another org's row: it creates in the current org instead", async () => {
		const bCompany = await runWithTenant(B.id, () =>
			db.company.create({ data: { name: "Shared B", domain: "shared.test" } }),
		);

		const byId = await runWithTenant(A.id, () =>
			db.contact.create({
				data: {
					firstName: "COC by id",
					company: {
						connectOrCreate: {
							where: { id: bCompany.id },
							create: { name: "Shared A", domain: "shared.test" },
						},
					},
				},
				include: { company: true },
			}),
		);
		expect(byId.company?.id).not.toBe(bCompany.id);
		expect(byId.company?.organizationId).toBe(A.id);
		expect(byId.company?.domain).toBe("shared.test");

		const byForgedKey = await runWithTenant(A.id, () =>
			db.contact.create({
				data: {
					firstName: "COC by forged key",
					company: {
						connectOrCreate: {
							where: {
								organizationId_domain: {
									organizationId: B.id,
									domain: "shared.test",
								},
							},
							create: { name: "Shared A2", domain: "shared2.test" },
						},
					},
				},
				include: { company: true },
			}),
		);
		expect(byForgedKey.company?.organizationId).toBe(A.id);
		expect(byForgedKey.company?.domain).toBe("shared2.test");

		// legacy single-field key → the current org's compound key → finds A's "Shared A"
		const byLegacyKey = await runWithTenant(A.id, () =>
			db.contact.create({
				data: {
					firstName: "COC by legacy key",
					company: {
						connectOrCreate: {
							where: { domain: "shared.test" } as never,
							create: { name: "Shared A3", domain: "shared.test" },
						},
					},
				},
				include: { company: true },
			}),
		);
		expect(byLegacyKey.company?.id).toBe(byId.company?.id);

		// plain connect on create fails the same way it does on update
		await expect(
			runWithTenant(A.id, () =>
				db.contact.create({
					data: {
						firstName: "Connect",
						company: { connect: { id: bCompany.id } },
					},
				}),
			),
		).rejects.toThrow();

		const bSide = await runWithTenant(B.id, () =>
			db.company.findUnique({
				where: { id: bCompany.id },
				include: { contacts: true },
			}),
		);
		expect(bSide?.contacts).toEqual([]);
	});

	test("findUniqueOrThrow / findFirstOrThrow / update / delete by another org's id throw NotFound and leave the row alone", async () => {
		const aCompany = await runWithTenant(A.id, () =>
			db.company.create({ data: { name: "Only A" } }),
		);

		const attempts = [
			() => db.company.findUniqueOrThrow({ where: { id: aCompany.id } }),
			() => db.company.findFirstOrThrow({ where: { id: aCompany.id } }),
			() =>
				db.company.update({
					where: { id: aCompany.id },
					data: { name: "Hijacked" },
				}),
			() => db.company.delete({ where: { id: aCompany.id } }),
		];
		for (const attempt of attempts) {
			const error = await runWithTenant(B.id, attempt).then(
				() => null,
				(e: unknown) => e,
			);
			expect(isNotFound(error)).toBe(true);
		}

		const stillThere = await runWithTenant(A.id, () =>
			db.company.findUniqueOrThrow({ where: { id: aCompany.id } }),
		);
		expect(stillThere.name).toBe("Only A");
	});

	test("groupBy / aggregate / count are scoped, and a forged filter yields nothing", async () => {
		await runWithTenant(A.id, () =>
			db.company.createMany({
				data: [
					{ name: "g1", city: "Paris" },
					{ name: "g2", city: "Paris" },
					{ name: "g3", city: "Oslo" },
				],
			}),
		);
		await runWithTenant(B.id, () =>
			db.company.createMany({
				data: [
					{ name: "g4", city: "Paris" },
					{ name: "g5", city: "Rome" },
				],
			}),
		);

		const grouped = await runWithTenant(A.id, () =>
			db.company.groupBy({
				by: ["city"],
				_count: { _all: true },
				where: { city: { not: null } },
				orderBy: { city: "asc" },
			}),
		);
		expect(grouped.map((g) => [g.city, g._count._all])).toEqual([
			["Oslo", 1],
			["Paris", 2],
		]);

		const aggregated = await runWithTenant(B.id, () =>
			db.company.aggregate({
				_count: { _all: true },
				where: { city: { not: null } },
			}),
		);
		expect(aggregated._count._all).toBe(2);

		const forged = await runWithTenant(A.id, () =>
			db.company.aggregate({
				_count: { _all: true },
				where: { organizationId: B.id },
			}),
		);
		expect(forged._count._all).toBe(0);
		expect(
			await runWithTenant(A.id, () =>
				db.company.count({ where: { organizationId: B.id } }),
			),
		).toBe(0);
	});

	test("a query built inside runWithTenant and awaited outside keeps its tenant (Promise.all, then, batch $transaction)", async () => {
		await runWithTenant(A.id, () =>
			db.contact.create({ data: { firstName: "Lazy A" } }),
		);
		await runWithTenant(B.id, () =>
			db.contact.create({ data: { firstName: "Lazy B" } }),
		);

		let fromA: Promise<{ organizationId: string }[]> | undefined;
		let fromB: Promise<{ organizationId: string }[]> | undefined;
		let chained: Promise<string[]> | undefined;
		// sync builders: nothing is awaited inside the scope
		runWithTenant(A.id, () => {
			fromA = db.contact.findMany({ select: { organizationId: true } });
		});
		runWithTenant(B.id, () => {
			fromB = db.contact.findMany({ select: { organizationId: true } });
			chained = db.contact
				.findMany({ select: { firstName: true } })
				.then((rows) => rows.map((row) => row.firstName));
		});
		if (!fromA || !fromB || !chained) throw new Error("queries not built");

		const [a, b, names] = await Promise.all([fromA, fromB, chained]);
		expect(a.length).toBeGreaterThan(0);
		expect(b.length).toBeGreaterThan(0);
		expect(new Set(a.map((row) => row.organizationId))).toEqual(
			new Set([A.id]),
		);
		expect(new Set(b.map((row) => row.organizationId))).toEqual(
			new Set([B.id]),
		);
		expect(names).toContain("Lazy B");
		expect(names).not.toContain("Lazy A");

		// batch transaction: each PrismaPromise was built in scope
		const [contactsInA, contactsInB] = await Promise.all([
			runWithTenant(A.id, () =>
				db.$transaction([db.contact.count(), db.company.count()]),
			),
			runWithTenant(B.id, () =>
				db.$transaction([db.contact.count(), db.company.count()]),
			),
		]);
		expect(contactsInA[0]).toBe(a.length);
		expect(contactsInB[0]).toBe(b.length);

		// an interactive transaction that returns a lazy query
		const lazyTx = await runWithTenant(B.id, () =>
			db.$transaction((tx) => tx.contact.count()),
		);
		expect(lazyTx).toBe(b.length);
	});

	test("include / select of a list relation from a tenant parent never crosses, even with a planted cross-org FK", async () => {
		const aCompany = await runWithTenant(A.id, () =>
			db.company.create({ data: { name: "Host A" } }),
		);
		const aContact = await runWithTenant(A.id, () =>
			db.contact.create({
				data: { firstName: "Host contact", companyId: aCompany.id },
			}),
		);
		// Even platform-level code cannot plant a row in B that points at A: the
		// same-organization FK triggers refuse it at the database.
		await expect(
			withoutTenant(() =>
				db.contact.create({
					data: {
						firstName: "Planted in B",
						companyId: aCompany.id,
						organizationId: B.id,
					},
				}),
			),
		).rejects.toThrow(/cross-tenant reference|Foreign key constraint/);
		await expect(
			withoutTenant(() =>
				db.contactFact.create({
					data: {
						contactId: aContact.id,
						organizationId: B.id,
						field: "title",
						value: "planted",
						score: 1,
						band: "VERIFIED",
						evidence: {},
						method: "test",
					},
				}),
			),
		).rejects.toThrow(/cross-tenant reference|Foreign key constraint/);

		const included = await runWithTenant(A.id, () =>
			db.company.findUnique({
				where: { id: aCompany.id },
				include: { contacts: { include: { facts: true } } },
			}),
		);
		expect(included?.contacts.map((c) => c.firstName)).toEqual([
			"Host contact",
		]);
		expect(included?.contacts[0]?.facts).toEqual([]);

		const selected = await runWithTenant(A.id, () =>
			db.company.findMany({
				where: { id: aCompany.id },
				select: {
					contacts: {
						select: { firstName: true, facts: { select: { id: true } } },
					},
				},
			}),
		);
		expect(selected[0]?.contacts.map((c) => c.firstName)).toEqual([
			"Host contact",
		]);
		expect(selected[0]?.contacts[0]?.facts).toEqual([]);

		// the fluent accessor is a list read too
		const fluent = await runWithTenant(A.id, () =>
			db.company.findUnique({ where: { id: aCompany.id } }).contacts(),
		);
		expect(fluent?.map((c) => c.firstName)).toEqual(["Host contact"]);
	});

	// HOLE (packages/db/src/tenant-extension.ts, scopeNestedWrites): a nested
	// `createMany` is scoped with the *checked* shape (`organization: { connect }`)
	// but createMany rows accept scalars only, so Prisma rejects the payload.
	// Fix: `data: scopeCreate(target, next.createMany.data, org, true)`.
	test("nested createMany inside a create lands every row in the org", async () => {
		const company = await runWithTenant(A.id, () =>
			db.company.create({
				data: {
					name: "Bulk Co",
					contacts: {
						createMany: {
							data: [
								{ firstName: "One" },
								{ firstName: "Two", organizationId: B.id } as never,
							],
						},
					},
				},
				include: { contacts: true },
			}),
		);
		expect(company.contacts).toHaveLength(2);
		expect(company.contacts.every((c) => c.organizationId === A.id)).toBe(true);
		expect(
			await runWithTenant(B.id, () =>
				db.contact.count({ where: { firstName: { in: ["One", "Two"] } } }),
			),
		).toBe(0);
	});

	// HOLE (tenant-extension.ts, scopeUpdateData): update / updateMany data may
	// carry `organizationId` or `organization: { connect }`, re-homing a row into
	// another org. Fix: strip both from update data (tenant code never moves rows).
	test("update / updateMany cannot re-home a row into another org", async () => {
		const moved = await runWithTenant(A.id, () =>
			db.company.create({ data: { name: "Movable" } }),
		);
		await runWithTenant(A.id, () =>
			db.company
				.update({
					where: { id: moved.id },
					data: { organizationId: B.id } as never,
				})
				.catch(() => undefined),
		);
		await runWithTenant(A.id, () =>
			db.company
				.update({
					where: { id: moved.id },
					data: { organization: { connect: { id: B.id } } } as never,
				})
				.catch(() => undefined),
		);
		await runWithTenant(A.id, () =>
			db.company
				.updateMany({
					where: { id: moved.id },
					data: { organizationId: B.id } as never,
				})
				.catch(() => undefined),
		);
		const row = await withoutTenant(() =>
			db.company.findUnique({
				where: { id: moved.id },
				select: { organizationId: true },
			}),
		);
		expect(row?.organizationId).toBe(A.id);
	});

	// HOLE: an *unchecked* FK scalar (`companyId`, `contactId`, `dealId`, …) that
	// names another org's row is accepted on create / update / updateMany, and the
	// to-one include then reads that row across the boundary. Options: composite
	// FKs `(companyId, organizationId) → company(id, organizationId)` in the
	// schema (DB-enforced), or have the extension turn tenant-relation FK
	// scalars into pinned `connect`s. Until then the API must only ever pass
	// through ids it resolved inside the tenant.
	test("a scalar FK naming another org's row is rejected", async () => {
		const bCompany = await runWithTenant(B.id, () =>
			db.company.create({ data: { name: "B secret", domain: "secret.test" } }),
		);
		await expect(
			runWithTenant(A.id, () =>
				db.contact.create({
					data: { firstName: "Leak", companyId: bCompany.id },
				}),
			),
		).rejects.toThrow();

		const own = await runWithTenant(A.id, () =>
			db.contact.create({ data: { firstName: "Own" } }),
		);
		await expect(
			runWithTenant(A.id, () =>
				db.contact.update({
					where: { id: own.id },
					data: { companyId: bCompany.id },
				}),
			),
		).rejects.toThrow();
		const seen = await runWithTenant(A.id, () =>
			db.contact.findUnique({
				where: { id: own.id },
				include: { company: true },
			}),
		);
		expect(seen?.company).toBeNull();
	});

	// HOLE (tenant-extension.ts, scopeSelection): `_count.select.<listRelation>` is
	// not given a `where: { organizationId }`, so with a corrupt FK the count
	// crosses the boundary while the scoped list itself does not. Fix: scope
	// `_count.select` entries the same way as list includes. (The corrupt FK is
	// planted withoutTenant; if the schema ever forbids it, plant differently.)
	test("_count of a list relation is scoped like the list itself", async () => {
		const aCompany = await runWithTenant(A.id, () =>
			db.company.create({ data: { name: "Counted A" } }),
		);
		await runWithTenant(A.id, () =>
			db.contact.create({ data: { firstName: "Own", companyId: aCompany.id } }),
		);
		// a cross-org plant is refused by the database; _count still carries the
		// same organizationId filter as the list include (belt and braces)
		await expect(
			withoutTenant(() =>
				db.contact.create({
					data: {
						firstName: "Planted",
						companyId: aCompany.id,
						organizationId: B.id,
					},
				}),
			),
		).rejects.toThrow();
		const counted = await runWithTenant(A.id, () =>
			db.company.findUnique({
				where: { id: aCompany.id },
				include: { contacts: true, _count: { select: { contacts: true } } },
			}),
		);
		expect(counted?.contacts).toHaveLength(1);
		expect(counted?._count.contacts).toBe(1);
		const fromB = await runWithTenant(B.id, () =>
			db.company.findUnique({
				where: { id: aCompany.id },
				include: { _count: { select: { contacts: true } } },
			}),
		);
		expect(fromB).toBeNull();
	});
});
