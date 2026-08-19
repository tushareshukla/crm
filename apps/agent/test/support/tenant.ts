/**
 * Tenant scope for the agent's integration tests.
 *
 * Every tenant model needs an organization in context, so a test that touches
 * the database runs inside one. Import `it` and the hooks from here instead of
 * `bun:test`: they run their bodies inside `TEST_ORGANIZATION`, which is
 * created on first use. `describe` and `expect` stay on `bun:test`.
 */
import {
	afterAll as baseAfterAll,
	afterEach as baseAfterEach,
	beforeAll as baseBeforeAll,
	beforeEach as baseBeforeEach,
	it as baseIt,
} from "bun:test";
import { db, runWithTenant, withoutTenant } from "@crm/db";

export const TEST_ORGANIZATION = {
	id: "org_agent_tests",
	slug: "agent-tests",
	name: "Agent tests",
} as const;

/** A second organization, for proving nothing leaks across the boundary. */
export const OTHER_ORGANIZATION = {
	id: "org_agent_tests_other",
	slug: "agent-tests-other",
	name: "Agent tests (other)",
} as const;

type Organization = { id: string; slug: string; name: string };

/** Create the organization if it is not there; leave its settings alone otherwise. */
export async function ensureOrganization(
	organization: Organization = TEST_ORGANIZATION,
): Promise<string> {
	await withoutTenant(() =>
		db.organization.upsert({
			where: { id: organization.id },
			create: {
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				createdAt: new Date(),
			},
			update: { status: "ACTIVE" },
		}),
	);
	return organization.id;
}

let ready: Promise<string> | null = null;

function ensureTestOrganization(): Promise<string> {
	ready ??= ensureOrganization().catch((error) => {
		ready = null;
		throw error;
	});
	return ready;
}

/** Make a user a member of an organization (Member is a global table). */
export async function ensureMember(
	userId: string,
	organizationId: string = TEST_ORGANIZATION.id,
	role = "member",
): Promise<void> {
	await ensureOrganization(
		organizationId === OTHER_ORGANIZATION.id
			? OTHER_ORGANIZATION
			: TEST_ORGANIZATION,
	);
	await db.member.upsert({
		where: { organizationId_userId: { organizationId, userId } },
		create: {
			id: `member_${organizationId}_${userId}`,
			organizationId,
			userId,
			role,
			createdAt: new Date(),
		},
		update: { role },
	});
}

/** Run `fn` inside an organization — the test one unless another is named. */
export function inOrganization<T>(
	fn: () => T,
	organizationId: string = TEST_ORGANIZATION.id,
): T {
	return runWithTenant(organizationId, fn);
}

type Body = () => unknown;

function scoped(fn: Body): () => Promise<unknown> {
	return async () => {
		await ensureTestOrganization();
		return runWithTenant(TEST_ORGANIZATION.id, fn);
	};
}

export function it(name: string, fn: Body, timeout?: number): void {
	baseIt(name, scoped(fn), timeout);
}

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
