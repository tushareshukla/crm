/**
 * The agent's side of the tenant boundary: dispatch lists work across every
 * organization, runs each unit inside its own, and holds each organization to
 * its daily cap.
 */
import { describe, expect } from "bun:test";
import {
	currentTenantId,
	db,
	EnrichmentStatus,
	Prisma,
	runWithTenant,
	withoutTenant,
} from "@crm/db";
import { DIRECT_KINDS } from "@crm/db/agent-tasks";
import { runDirect, taskAuth } from "../agent/lib/dispatch";
import { reconcileStaleTasks } from "../agent/lib/stale-tasks";
import {
	claimDue,
	dailyQuota,
	type LeasedTask,
	retireExhausted,
} from "../agent/lib/tasks";
import {
	DEFAULT_AGENT_TASKS_PER_DAY,
	forgetOrganizationSettings,
	resolveOrgSetting,
} from "../agent/lib/tenant";
import {
	afterEach,
	beforeEach,
	ensureOrganization,
	it,
	OTHER_ORGANIZATION,
	TEST_ORGANIZATION,
} from "./support/tenant";

const kind = "tenant-dispatch-probe";
const RESEARCH = { except: DIRECT_KINDS } as const;

const organizations = [TEST_ORGANIZATION.id, OTHER_ORGANIZATION.id];

async function clear() {
	await ensureOrganization(OTHER_ORGANIZATION);
	await withoutTenant(async () => {
		await db.agentTask.deleteMany({
			where: { organizationId: { in: organizations }, kind },
		});
		await db.contact.deleteMany({
			where: {
				organizationId: { in: organizations },
				email: { startsWith: "tenant-dispatch-" },
			},
		});
		await db.organization.updateMany({
			where: { id: { in: organizations } },
			data: {
				status: "ACTIVE",
				limits: Prisma.DbNull,
				settings: Prisma.DbNull,
			},
		});
	});
	forgetOrganizationSettings();
}

beforeEach(clear);
afterEach(clear);

function queue(
	organizationId: string,
	overrides: {
		dueAt?: Date;
		startedAt?: Date;
		finishedAt?: Date;
		attempts?: number;
	} = {},
) {
	return runWithTenant(organizationId, () =>
		db.agentTask.create({
			data: {
				kind,
				reason: "tenant dispatch probe",
				dueAt: overrides.dueAt ?? new Date(Date.now() - 1000),
				startedAt: overrides.startedAt,
				finishedAt: overrides.finishedAt,
				attempts: overrides.attempts ?? 0,
				budget: 4,
			},
			select: { id: true },
		}),
	);
}

async function limitOrganization(
	organizationId: string,
	agentTasksPerDay: number,
) {
	await db.organization.update({
		where: { id: organizationId },
		data: { limits: { agentTasksPerDay } },
	});
}

describe("claiming across organizations", () => {
	it("outside a tenant, claims every organization's due work and says whose each row is", async () => {
		const ours = await queue(TEST_ORGANIZATION.id);
		const theirs = await queue(OTHER_ORGANIZATION.id);

		const claimed = await withoutTenant(() => claimDue(10, RESEARCH));
		const byId = new Map(claimed.map((task) => [task.id, task]));

		expect(byId.get(ours.id)?.organizationId).toBe(TEST_ORGANIZATION.id);
		expect(byId.get(theirs.id)?.organizationId).toBe(OTHER_ORGANIZATION.id);
	});

	it("inside a tenant, claims only that organization's work", async () => {
		const ours = await queue(TEST_ORGANIZATION.id);
		const theirs = await queue(OTHER_ORGANIZATION.id);

		const claimed = await claimDue(10, RESEARCH);
		const ids = claimed.map((task) => task.id);

		expect(ids).toContain(ours.id);
		expect(ids).not.toContain(theirs.id);
		expect(
			claimed.every((task) => task.organizationId === TEST_ORGANIZATION.id),
		).toBe(true);
	});

	it("retires exhausted rows with their organization attached", async () => {
		const spent = await queue(OTHER_ORGANIZATION.id, { attempts: 3 });

		const retired = await withoutTenant(() => retireExhausted());

		expect(retired.find((task) => task.id === spent.id)?.organizationId).toBe(
			OTHER_ORGANIZATION.id,
		);
	});
});

describe("the daily cap", () => {
	it("defaults to the platform figure when an organization sets none", async () => {
		const quota = await dailyQuota(new Date(), DEFAULT_AGENT_TASKS_PER_DAY + 1);
		const index = quota.organizationIds.indexOf(TEST_ORGANIZATION.id);

		expect(index).toBeGreaterThanOrEqual(0);
		expect(quota.remaining[index]).toBe(DEFAULT_AGENT_TASKS_PER_DAY);
	});

	it("hands an organization no more than it has left today, and the rest waits", async () => {
		await limitOrganization(TEST_ORGANIZATION.id, 2);
		// One task already ran today: it counts, whether or not it finished.
		await queue(TEST_ORGANIZATION.id, {
			startedAt: new Date(),
			finishedAt: new Date(),
		});
		await Promise.all([
			queue(TEST_ORGANIZATION.id),
			queue(TEST_ORGANIZATION.id),
			queue(TEST_ORGANIZATION.id),
		]);
		const theirs = await queue(OTHER_ORGANIZATION.id);

		const claimed = await withoutTenant(() => claimDue(10, RESEARCH));
		const ours = claimed.filter(
			(task) => task.organizationId === TEST_ORGANIZATION.id,
		);

		expect(ours).toHaveLength(1);
		expect(claimed.map((task) => task.id)).toContain(theirs.id);

		expect(await claimDue(10, RESEARCH)).toHaveLength(0);
	});

	it("lets a task that already counts today retry at the cap, but admits no fresh work", async () => {
		await limitOrganization(TEST_ORGANIZATION.id, 1);
		const task = await queue(TEST_ORGANIZATION.id);

		expect((await claimDue(10, RESEARCH)).map((t) => t.id)).toEqual([task.id]);
		await db.agentTask.update({
			where: { id: task.id },
			data: { leasedUntil: new Date(Date.now() - 1000) },
		});
		await queue(TEST_ORGANIZATION.id);

		expect((await claimDue(10, RESEARCH)).map((t) => t.id)).toEqual([task.id]);
	});

	it("gives a suspended organization nothing", async () => {
		await queue(TEST_ORGANIZATION.id);
		await db.organization.update({
			where: { id: TEST_ORGANIZATION.id },
			data: { status: "SUSPENDED" },
		});

		expect(await claimDue(10, RESEARCH)).toHaveLength(0);
	});
});

describe("running work inside its organization", () => {
	function leased(organizationId: string, id: string): LeasedTask {
		return {
			id,
			organizationId,
			contactId: null,
			companyId: null,
			dealId: null,
			kind: "brand",
			reason: "probe",
			payload: null,
			budget: 0,
			attempts: 1,
			priority: 900,
			dueAt: new Date(),
		};
	}

	it("runs a direct task inside the task's organization, whatever the caller's scope", async () => {
		const seen: string[] = [];
		const handle = async () => {
			seen.push(currentTenantId());
		};

		await withoutTenant(() =>
			runDirect(leased(OTHER_ORGANIZATION.id, "probe-1"), handle),
		);
		await runDirect(leased(OTHER_ORGANIZATION.id, "probe-2"), handle);

		expect(seen).toEqual([OTHER_ORGANIZATION.id, OTHER_ORGANIZATION.id]);
	});

	it("starts the session with the organization in its auth", () => {
		expect(
			taskAuth(leased(OTHER_ORGANIZATION.id, "probe")).attributes,
		).toMatchObject({
			organizationId: OTHER_ORGANIZATION.id,
		});
	});

	it("settles a retired task's record in the organization the task belongs to", async () => {
		const contact = await runWithTenant(OTHER_ORGANIZATION.id, () =>
			db.contact.create({
				data: {
					firstName: "Tenant",
					email: `tenant-dispatch-${crypto.randomUUID()}@example.test`,
					enrichmentStatus: EnrichmentStatus.RUNNING,
				},
				select: { id: true },
			}),
		);
		await runWithTenant(OTHER_ORGANIZATION.id, () =>
			db.agentTask.create({
				data: {
					kind,
					reason: "tenant dispatch probe",
					dueAt: new Date(Date.now() - 60_000),
					attempts: 3,
					startedAt: new Date(Date.now() - 60_000),
					contactId: contact.id,
					budget: 4,
				},
			}),
		);

		const sweep = await withoutTenant(() => reconcileStaleTasks());
		expect(sweep.error).toBeNull();

		const settled = await runWithTenant(OTHER_ORGANIZATION.id, () =>
			db.contact.findUnique({
				where: { id: contact.id },
				select: { enrichmentStatus: true },
			}),
		);
		expect(settled?.enrichmentStatus).toBe(EnrichmentStatus.FAILED);
	});
});

describe("per-organization settings", () => {
	const saved = process.env.PERPLEXITY_API_KEY;

	afterEach(() => {
		if (saved === undefined) delete process.env.PERPLEXITY_API_KEY;
		else process.env.PERPLEXITY_API_KEY = saved;
	});

	it("prefers the organization's override to the platform key, and falls back to it", async () => {
		process.env.PERPLEXITY_API_KEY = "pplx-platform";
		expect(await resolveOrgSetting("perplexityApiKey")).toBe("pplx-platform");

		await db.organization.update({
			where: { id: TEST_ORGANIZATION.id },
			data: { settings: { perplexityApiKey: "pplx-org" } },
		});
		forgetOrganizationSettings(TEST_ORGANIZATION.id);
		expect(await resolveOrgSetting("perplexityApiKey")).toBe("pplx-org");

		delete process.env.PERPLEXITY_API_KEY;
		expect(
			await runWithTenant(OTHER_ORGANIZATION.id, () =>
				resolveOrgSetting("perplexityApiKey"),
			),
		).toBeNull();
	});

	it("reads only the platform key outside a tenant", async () => {
		process.env.PERPLEXITY_API_KEY = "pplx-platform";
		expect(
			await withoutTenant(() => resolveOrgSetting("perplexityApiKey")),
		).toBe("pplx-platform");
	});
});
