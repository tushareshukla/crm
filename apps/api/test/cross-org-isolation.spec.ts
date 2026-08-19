/**
 * Tenant isolation over HTTP: two organizations hold the same contact and
 * company; a request scoped to one never reads, finds or links rows of the
 * other — even when the same person belongs to both.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, withoutTenant } from "@crm/db";
import type { INestApplication } from "@nestjs/common";
import {
	dataOf,
	deleteUsersAt,
	errorOf,
	mutate,
	query,
	signUp,
	startApp,
	type TestUser,
	useSignInEnv,
} from "./http";
import {
	createTestOrganization,
	deleteTestOrganization,
	inTenant,
	memberOf,
	type TestOrganization,
} from "./tenant";

const suffix = "xorg-spec";
const DOMAIN = `${suffix}.example.test`;
const emailOf = (label: string) => `${label}@${DOMAIN}`;

const SLUGS = { a: `${suffix}-a`, b: `${suffix}-b` } as const;

const SHARED_DOMAIN = `globex-${suffix}.test`;
const SHARED_EMAIL = `shared@${SHARED_DOMAIN}`;

type Fixture = { companyId: string; contactId: string };

let app: INestApplication;
let restoreEnv: () => void;

let orgA: TestOrganization;
let orgB: TestOrganization;
let inA: Fixture;
let inB: Fixture;

/** Member of both organizations. */
let rep: TestUser;
/** Member of A only. */
let onlyA: TestUser;

async function seed(
	org: TestOrganization,
	who: { firstName: string; company: string },
): Promise<Fixture> {
	return inTenant(org.id, async () => {
		const company = await db.company.create({
			data: { name: who.company, domain: SHARED_DOMAIN },
			select: { id: true },
		});
		const contact = await db.contact.create({
			data: {
				firstName: who.firstName,
				lastName: "Shared",
				email: SHARED_EMAIL,
				companyId: company.id,
			},
			select: { id: true },
		});
		return { companyId: company.id, contactId: contact.id };
	});
}

const listIds = async (path: string, as: TestUser, org: string) => {
	const result = dataOf<{ rows: { id: string }[]; total: number }>(
		await query(app, path, { pageSize: 100 }, { as, org }),
	);
	return { ids: result.rows.map((row) => row.id), total: result.total };
};

const contactsWithSharedEmail = () =>
	withoutTenant(() =>
		db.contact.findMany({
			where: { email: SHARED_EMAIL },
			select: { organizationId: true, companyId: true },
			orderBy: { organizationId: "asc" },
		}),
	);

async function clean() {
	for (const slug of Object.values(SLUGS)) {
		await deleteTestOrganization({ id: `org-${slug}` });
	}
	await deleteUsersAt(DOMAIN);
}

beforeAll(async () => {
	restoreEnv = useSignInEnv({ allowedSignIn: [DOMAIN] });
	await clean();

	app = await startApp();

	orgA = await createTestOrganization(SLUGS.a, { name: "Org A" });
	orgB = await createTestOrganization(SLUGS.b, { name: "Org B" });

	rep = await signUp(emailOf("rep"), "Rep");
	onlyA = await signUp(emailOf("only-a"), "Only A");
	await memberOf(rep.id, orgA.id, "owner");
	await memberOf(rep.id, orgB.id, "owner");
	await memberOf(onlyA.id, orgA.id, "member");

	inA = await seed(orgA, { firstName: "Ada", company: "Globex (A)" });
	inB = await seed(orgB, { firstName: "Bea", company: "Globex (B)" });
});

afterAll(async () => {
	await clean();
	restoreEnv();
	await app.close();
});

describe("reading", () => {
	it("lists only the organization's own contacts and companies", async () => {
		const contactsB = await listIds("contacts.list", rep, orgB.slug);
		expect(contactsB).toEqual({ ids: [inB.contactId], total: 1 });

		const contactsA = await listIds("contacts.list", rep, orgA.slug);
		expect(contactsA).toEqual({ ids: [inA.contactId], total: 1 });

		const companiesB = await listIds("companies.list", rep, orgB.slug);
		expect(companiesB).toEqual({ ids: [inB.companyId], total: 1 });
	});

	it("the header decides the organization, not the session's active one", async () => {
		dataOf(
			await mutate(app, "orgs.switchTo", { slug: orgA.slug }, { as: rep }),
		);

		const seen = await listIds("contacts.list", rep, orgB.slug);
		expect(seen.ids).toEqual([inB.contactId]);
	});

	it("does not find another organization's contact by id", async () => {
		const foreign = await query(
			app,
			"contacts.byId",
			{ id: inA.contactId },
			{ as: rep, org: orgB.slug },
		);
		expect(errorOf(foreign).code).toBe("NOT_FOUND");

		const own = dataOf<{ id: string; firstName: string }>(
			await query(
				app,
				"contacts.byId",
				{ id: inB.contactId },
				{ as: rep, org: orgB.slug },
			),
		);
		expect(own).toMatchObject({ id: inB.contactId, firstName: "Bea" });
	});

	it("does not find another organization's company by id", async () => {
		const foreign = await query(
			app,
			"companies.byId",
			{ id: inA.companyId },
			{ as: rep, org: orgB.slug },
		);
		expect(errorOf(foreign).code).toBe("NOT_FOUND");
	});

	it("searches only inside the organization", async () => {
		const hitsOf = async (q: string, org: string) =>
			dataOf<{ hits: { kind: string; id: string }[] }>(
				await query(app, "search.quick", { q }, { as: rep, org }),
			).hits;

		const byEmail = await hitsOf("shared@", orgB.slug);
		expect(byEmail.filter((hit) => hit.kind === "contact")).toEqual(
			[{ kind: "contact", id: inB.contactId }].map((hit) =>
				expect.objectContaining(hit),
			),
		);
		expect(byEmail.map((hit) => hit.id)).not.toContain(inA.contactId);

		const byName = await hitsOf("Globex (A)", orgB.slug);
		expect(byName).toEqual([]);

		const ownName = await hitsOf("Globex (A)", orgA.slug);
		expect(ownName.map((hit) => hit.id)).toEqual([inA.companyId]);
	});

	it("lists only the organization's members", async () => {
		const inBIds = dataOf<{ id: string }[]>(
			await query(app, "users.list", undefined, { as: rep, org: orgB.slug }),
		).map((user) => user.id);
		const inAIds = dataOf<{ id: string }[]>(
			await query(app, "users.list", undefined, { as: rep, org: orgA.slug }),
		).map((user) => user.id);

		expect(inBIds).toEqual([rep.id]);
		expect(inAIds.sort()).toEqual([onlyA.id, rep.id].sort());
	});
});

describe("writing", () => {
	it("the same email may exist in both organizations, and each sees its own", async () => {
		const rows = await contactsWithSharedEmail();

		expect(rows.map((row) => row.organizationId)).toEqual([orgA.id, orgB.id]);
	});

	it("refuses to create a contact under another organization's company", async () => {
		const response = await mutate(
			app,
			"contacts.create",
			{
				firstName: "Intruder",
				email: `intruder@${SHARED_DOMAIN}`,
				companyId: inA.companyId,
			},
			{ as: rep, org: orgB.slug },
		);

		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(errorOf(response).code).not.toBe("UNKNOWN");
		expect(
			await withoutTenant(() =>
				db.contact.count({ where: { email: `intruder@${SHARED_DOMAIN}` } }),
			),
		).toBe(0);
	});

	it("refuses to move a contact onto another organization's company", async () => {
		const response = await mutate(
			app,
			"contacts.update",
			{ id: inB.contactId, data: { companyId: inA.companyId } },
			{ as: rep, org: orgB.slug },
		);

		expect(response.status).toBeGreaterThanOrEqual(400);

		const rows = await contactsWithSharedEmail();
		expect(rows.find((row) => row.organizationId === orgB.id)?.companyId).toBe(
			inB.companyId,
		);
	});

	it("refuses a bulk move onto another organization's company: NOT_FOUND", async () => {
		const response = await mutate(
			app,
			"contacts.bulkSetCompany",
			{ ids: [inB.contactId], companyId: inA.companyId },
			{ as: rep, org: orgB.slug },
		);

		expect(errorOf(response).code).toBe("NOT_FOUND");
	});

	it("refuses a deal on another organization's company: BAD_REQUEST", async () => {
		const response = await mutate(
			app,
			"deals.create",
			{
				name: "Cross-tenant deal",
				companyId: inA.companyId,
				ownerId: rep.id,
				amountCents: 1000,
			},
			{ as: rep, org: orgB.slug },
		);

		expect(errorOf(response).code).toBe("BAD_REQUEST");
		expect(
			await withoutTenant(() =>
				db.deal.count({ where: { name: "Cross-tenant deal" } }),
			),
		).toBe(0);
	});

	it("cannot update or delete another organization's contact", async () => {
		const update = await mutate(
			app,
			"contacts.update",
			{ id: inA.contactId, data: { firstName: "Hijacked" } },
			{ as: rep, org: orgB.slug },
		);
		expect(errorOf(update).code).toBe("NOT_FOUND");

		const remove = await mutate(
			app,
			"contacts.delete",
			{ id: inA.contactId },
			{ as: rep, org: orgB.slug },
		);
		expect(errorOf(remove).code).toBe("NOT_FOUND");

		const survivor = await withoutTenant(() =>
			db.contact.findFirst({
				where: { id: inA.contactId },
				select: { firstName: true, organizationId: true },
			}),
		);
		expect(survivor).toEqual({ firstName: "Ada", organizationId: orgA.id });
	});

	it("a bulk delete naming foreign ids deletes nothing of theirs", async () => {
		dataOf(
			await mutate(
				app,
				"contacts.bulkDelete",
				{ ids: [inA.contactId] },
				{ as: rep, org: orgB.slug },
			),
		);

		expect(
			await withoutTenant(() =>
				db.contact.count({ where: { id: inA.contactId } }),
			),
		).toBe(1);
	});
});
