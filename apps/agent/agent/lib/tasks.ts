import { db, type Prisma, tenantIdOrNull } from "@crm/db";
import { MAX_ATTEMPTS, RETIRED_OUTCOME } from "@crm/db/agent-tasks";
import { DISPATCH } from "./dispatch-config";
import { acrossTenants, agentTasksPerDay } from "./tenant";

export type LeasedTask = {
	id: string;
	organizationId: string;
	contactId: string | null;
	companyId: string | null;
	dealId: string | null;
	kind: string;
	reason: string;
	payload: Prisma.JsonValue | null;
	budget: number;
	attempts: number;
	priority: number;
	dueAt: Date;
};

export type TaskSubject = {
	id: string;
	organizationId: string;
	contactId: string | null;
	companyId: string | null;
	dealId: string | null;
	kind: string;
};

const LEASE_MS = DISPATCH.task.leaseMs;

export { DIRECT_KINDS, MAX_ATTEMPTS } from "@crm/db/agent-tasks";

/**
 * How much of its daily cap each organization has left — for the organizations
 * that could run out inside this claim — and which organizations get nothing
 * at all. A task counts against the day it was first started, once, however
 * many times it is leased again; so a retry never costs cap, only fresh work
 * does. A suspended organization runs nothing.
 */
export type DailyQuota = {
	dayStart: Date;
	organizationIds: string[];
	remaining: number[];
	suspended: string[];
};

const cappedToday = new Map<string, string>();

export async function dailyQuota(
	now: Date,
	batch: number,
	scope: string | null = tenantIdOrNull(),
): Promise<DailyQuota> {
	const dayStart = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);

	const [organizations, usage] = await Promise.all([
		db.organization.findMany({
			where: scope ? { id: scope } : undefined,
			select: { id: true, status: true, limits: true },
		}),
		acrossTenants(() =>
			db.agentTask.groupBy({
				by: ["organizationId"],
				where: { startedAt: { gte: dayStart } },
				_count: { _all: true },
			}),
		),
	]);

	const used = new Map(
		usage.map((row) => [row.organizationId, row._count._all] as const),
	);

	const quota: DailyQuota = {
		dayStart,
		organizationIds: [],
		remaining: [],
		suspended: [],
	};
	const day = dayStart.toISOString();

	for (const organization of organizations) {
		if (organization.status !== "ACTIVE") {
			quota.suspended.push(organization.id);
			continue;
		}

		const cap = agentTasksPerDay(organization.limits);
		const started = used.get(organization.id) ?? 0;
		const remaining = Math.max(0, cap - started);
		if (remaining >= batch) continue;

		quota.organizationIds.push(organization.id);
		quota.remaining.push(remaining);

		if (remaining === 0 && cappedToday.get(organization.id) !== day) {
			cappedToday.set(organization.id, day);
			console.warn(
				`[agent] organization ${organization.id} has started ${started} agent tasks today and is at its daily cap of ${cap}; its fresh work waits for tomorrow.`,
			);
		}
	}

	return quota;
}

/**
 * Claim due work and lease it. Platform code: outside a tenant this claims
 * across every organization, and hands each row back with its organization so
 * the caller can run it inside `runWithTenant(task.organizationId, …)`. Inside
 * a tenant it claims only that organization's work. Each organization gets at
 * most its remaining daily cap, and a suspended organization gets nothing.
 */
export async function claimDue(
	limit: number,
	kinds: { only: readonly string[] } | { except: readonly string[] },
	leaseMs = LEASE_MS,
): Promise<LeasedTask[]> {
	const now = new Date();
	const until = new Date(now.getTime() + leaseMs);

	const list = "only" in kinds ? [...kinds.only] : [...kinds.except];
	if ("only" in kinds && list.length === 0) return [];

	const onlyMode = "only" in kinds;
	const scope = tenantIdOrNull();
	const quota = await dailyQuota(now, limit, scope);

	// The set of rows to lease is chosen and locked exactly once (a materialized
	// CTE), then leased: a join that re-ran the LIMIT could lock more than asked.
	const claimed = await db.$queryRaw<LeasedTask[]>`
		WITH due AS MATERIALIZED (
			SELECT t3.id
			FROM "agentTask" AS t3
			JOIN (
				SELECT t2.id, t2."organizationId", t2."priority", t2."dueAt",
					(t2."startedAt" >= ${quota.dayStart}) AS counted,
					-- Fresh work is ranked per organization against what it has left today.
					ROW_NUMBER() OVER (
						PARTITION BY t2."organizationId", (t2."startedAt" >= ${quota.dayStart})
						ORDER BY t2."priority" DESC, t2."dueAt" ASC
					) AS rank
				FROM "agentTask" AS t2
				WHERE t2."finishedAt" IS NULL
					AND t2."dueAt" <= ${now}
					AND (t2."leasedUntil" IS NULL OR t2."leasedUntil" < ${now})
					AND t2."attempts" < ${MAX_ATTEMPTS}
					AND (${scope}::text IS NULL OR t2."organizationId" = ${scope}::text)
					AND t2."organizationId" <> ALL(${quota.suspended}::text[])
					AND CASE
						WHEN ${onlyMode}::boolean THEN t2.kind = ANY(${list}::text[])
						ELSE t2.kind <> ALL(${list}::text[])
					END
			) AS ranked ON ranked.id = t3.id
			LEFT JOIN UNNEST(${quota.organizationIds}::text[], ${quota.remaining}::int[])
				AS quota("organizationId", remaining)
				ON quota."organizationId" = ranked."organizationId"
			WHERE (
					COALESCE(ranked.counted, false)
					OR ranked.rank <= COALESCE(quota.remaining, 2147483647)
				)
				-- Repeated on the locked row itself, so a row another dispatcher
				-- leased after this snapshot fails the re-check and is skipped.
				AND t3."finishedAt" IS NULL
				AND (t3."leasedUntil" IS NULL OR t3."leasedUntil" < ${now})
				AND t3."attempts" < ${MAX_ATTEMPTS}
			ORDER BY ranked."priority" DESC, ranked."dueAt" ASC
			LIMIT ${limit}
			FOR UPDATE OF t3 SKIP LOCKED
		)
		UPDATE "agentTask" AS t
		SET "leasedUntil" = ${until},
			"startedAt" = COALESCE(t."startedAt", ${now}),
			"attempts" = t."attempts" + 1
		FROM due
		WHERE t.id = due.id
		RETURNING t.id, t."organizationId", t."contactId", t."companyId", t."dealId", t.kind, t.reason, t.payload,
			t.budget, t.attempts, t.priority, t."dueAt";
	`;

	return claimed.sort(
		(a, b) => b.priority - a.priority || a.dueAt.getTime() - b.dueAt.getTime(),
	);
}

/**
 * Close rows that spent every attempt without reporting back. Platform code
 * like `claimDue`: every organization outside a tenant, one inside it.
 */
export async function retireExhausted(
	limit: number = DISPATCH.reconcile.retire,
): Promise<TaskSubject[]> {
	const now = new Date();
	const scope = tenantIdOrNull();

	return db.$queryRaw<TaskSubject[]>`
		WITH spent AS MATERIALIZED (
			SELECT c.id
			FROM "agentTask" AS c
			WHERE c."finishedAt" IS NULL
				AND c."attempts" >= ${MAX_ATTEMPTS}
				AND (c."leasedUntil" IS NULL OR c."leasedUntil" < ${now})
				AND (${scope}::text IS NULL OR c."organizationId" = ${scope}::text)
			ORDER BY c."dueAt" ASC, c.id ASC
			LIMIT ${limit}
			FOR UPDATE SKIP LOCKED
		)
		UPDATE "agentTask" AS t
		SET "finishedAt" = ${now},
			"outcome" = ${RETIRED_OUTCOME}
		FROM spent
		WHERE t.id = spent.id
		RETURNING t.id, t."organizationId", t."contactId", t."companyId", t."dealId", t.kind;
	`;
}

const SUBJECT_SELECT = {
	id: true,
	organizationId: true,
	contactId: true,
	companyId: true,
	dealId: true,
	kind: true,
} as const;

export async function completeTask(
	taskId: string,
	outcome: string,
	sessionId?: string,
): Promise<TaskSubject | null> {
	const { count } = await db.agentTask.updateMany({
		where: { id: taskId, finishedAt: null },
		data: {
			finishedAt: new Date(),
			outcome: outcome.slice(0, 500),
			sessionId: sessionId || undefined,
		},
	});

	if (count === 0) return null;

	return db.agentTask.findUnique({
		where: { id: taskId },
		select: SUBJECT_SELECT,
	});
}

export async function taskSubject(taskId: string): Promise<TaskSubject | null> {
	return db.agentTask.findUnique({
		where: { id: taskId },
		select: SUBJECT_SELECT,
	});
}

export async function noteSession(
	taskId: string,
	sessionId: string,
): Promise<void> {
	await db.agentTask.updateMany({
		where: { id: taskId, finishedAt: null },
		data: { sessionId },
	});
}

export async function scheduleTask(input: {
	contactId?: string | null;
	companyId?: string | null;
	dealId?: string | null;
	kind: string;
	reason: string;
	payload?: Prisma.InputJsonValue | null;
	dueAt: Date;
	priority?: number;
	budget?: number;
}): Promise<{ id: string }> {
	const existing = await db.agentTask.findFirst({
		where: {
			kind: input.kind,
			finishedAt: null,
			contactId: input.contactId ?? undefined,
			companyId: input.companyId ?? undefined,
			dealId: input.dealId ?? undefined,
		},
		select: { id: true },
	});

	if (existing) {
		await db.agentTask.update({
			where: { id: existing.id },
			data: { dueAt: input.dueAt, reason: input.reason },
		});
		return existing;
	}

	return db.agentTask.create({
		data: {
			contactId: input.contactId ?? null,
			companyId: input.companyId ?? null,
			dealId: input.dealId ?? null,
			kind: input.kind,
			reason: input.reason,
			payload: input.payload ?? undefined,
			dueAt: input.dueAt,
			priority: input.priority ?? 0,
			budget: input.budget ?? 4,
		},
		select: { id: true },
	});
}

export async function lastDecision(contactId: string) {
	return db.agentTask.findFirst({
		where: { contactId },
		orderBy: { createdAt: "desc" },
		select: {
			kind: true,
			reason: true,
			dueAt: true,
			finishedAt: true,
			outcome: true,
		},
	});
}

export type { Prisma };
