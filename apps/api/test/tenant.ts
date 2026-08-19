/**
 * Tenant helpers for the API test suite. Organizations and memberships are
 * global models, so they are written `withoutTenant`; everything that touches
 * tenant data runs inside `inTenant(orgId, …)` / `runWithTenant`.
 *
 * Tests that hit the database import `it` / `test` and the hooks from here
 * instead of `bun:test`: their bodies run inside `TEST_ORG` (created by the
 * preload in ./setup.ts, and on first use as a fallback). `describe` and
 * `expect` stay on `bun:test`.
 */
import {
	afterAll as baseAfterAll,
	afterEach as baseAfterEach,
	beforeAll as baseBeforeAll,
	beforeEach as baseBeforeEach,
	it as baseIt,
} from "bun:test";
import { randomUUID } from "node:crypto";
import type { WorkspaceRole } from "@crm/auth";
import { db, OrgStatus, runWithTenant, withoutTenant } from "@crm/db";
import type { Test as SupertestRequest } from "supertest";

export { runWithTenant, withoutTenant };

/** The header the app sends to name the organization; see TrpcContext. */
export const ORG_SLUG_HEADER = "x-org-slug";

export type TestOrganization = { id: string; slug: string };

/** The organization every database-backed test runs in unless it names another. */
export const TEST_ORG = {
	id: "org-test",
	slug: "test",
	name: "Test organization",
} as const;

/**
 * Upsert an organization by slug (idempotent across runs). The id is derived
 * from the slug so fixtures can refer to it without reading it back.
 */
export async function createTestOrganization(
	slug = `test-org-${randomUUID().slice(0, 8)}`,
	options: { name?: string; status?: OrgStatus } = {},
): Promise<TestOrganization> {
	const id = `org-${slug}`;
	const name = options.name ?? slug;
	const status = options.status ?? OrgStatus.ACTIVE;

	await withoutTenant(() =>
		db.organization.upsert({
			where: { slug },
			create: { id, slug, name, status, createdAt: new Date() },
			update: { name, status },
			select: { id: true },
		}),
	);

	return { id, slug };
}

let ready: Promise<TestOrganization> | null = null;

/** Create `TEST_ORG` once per process (the preload does this up front; this is the fallback). */
export function ensureTestOrganization(): Promise<TestOrganization> {
	ready ??= createTestOrganization(TEST_ORG.slug, {
		name: TEST_ORG.name,
	}).catch((error) => {
		ready = null;
		throw error;
	});
	return ready;
}

/** Delete an organization; every tenant row cascades. */
export async function deleteTestOrganization(
	org: Pick<TestOrganization, "id">,
): Promise<void> {
	await withoutTenant(() =>
		db.organization.deleteMany({ where: { id: org.id } }),
	);
}

/** Make `userId` a member of `orgId` with `role` (upsert). */
export async function memberOf(
	userId: string,
	orgId: string = TEST_ORG.id,
	role: WorkspaceRole = "member",
): Promise<{ id: string }> {
	return withoutTenant(() =>
		db.member.upsert({
			where: { organizationId_userId: { organizationId: orgId, userId } },
			create: {
				id: randomUUID(),
				organizationId: orgId,
				userId,
				role,
				createdAt: new Date(),
			},
			update: { role },
			select: { id: true },
		}),
	);
}

/** Remove `userId`'s membership of `orgId` (no-op when there is none). */
export async function notMemberOf(
	userId: string,
	orgId: string = TEST_ORG.id,
): Promise<void> {
	await withoutTenant(() =>
		db.member.deleteMany({ where: { organizationId: orgId, userId } }),
	);
}

/** Run a test body inside an organization's tenant scope. */
export function inTenant<T>(orgId: string, fn: () => T): T {
	return runWithTenant(orgId, fn);
}

type Body = () => unknown;

function scoped(fn: Body): () => Promise<unknown> {
	return async () => {
		await ensureTestOrganization();
		return runWithTenant(TEST_ORG.id, fn);
	};
}

/** `it` whose body runs inside `TEST_ORG`. */
export function it(name: string, fn: Body, timeout?: number): void {
	baseIt(name, scoped(fn), timeout);
}

export const test = it;

export function beforeAll(fn: Body): void {
	baseBeforeAll(scoped(fn));
}

export function beforeEach(fn: Body): void {
	baseBeforeEach(scoped(fn));
}

export function afterAll(fn: Body): void {
	baseAfterAll(scoped(fn));
}

export function afterEach(fn: Body): void {
	baseAfterEach(scoped(fn));
}

/** Headers that name the organization for a tRPC / REST request. */
export function orgHeaders(
	slug: string = TEST_ORG.slug,
): Record<string, string> {
	return { [ORG_SLUG_HEADER]: slug };
}

/** Attach `x-org-slug` to a supertest request: `withOrg(request(app).get(url), "acme")`. */
export function withOrg<T extends SupertestRequest>(
	request: T,
	slug: string = TEST_ORG.slug,
): T {
	return request.set(ORG_SLUG_HEADER, slug) as T;
}
