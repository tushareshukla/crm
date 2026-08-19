import { type Db, type Prisma, runWithTenant } from "@crm/db";
import { Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import type { AuditListInput } from "./audit.contracts";

/** Everything the platform writes into an organization's audit log. */
export const AUDIT_EVENT_TYPES = [
	"org.created",
	"org.updated",
	"org.suspended",
	"org.unsuspended",
	"invite.created",
	"invite.revoked",
	"invite.accepted",
	"member.role_changed",
	"admin.entered",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export interface AuditEventInput {
	type: AuditEventType;
	actorId?: string | null;
	subject?: string | null;
	data?: Prisma.InputJsonObject;
}

export interface AuditEventRow {
	id: string;
	type: string;
	subject: string | null;
	data: Prisma.JsonValue | null;
	createdAt: string;
	actor: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	} | null;
}

export interface AuditPage {
	rows: AuditEventRow[];
	nextCursor: string | null;
}

const ADMIN_ENTRY_WINDOW_MS = 60 * 60_000;

const AUDIT_SELECT = {
	id: true,
	type: true,
	subject: true,
	data: true,
	createdAt: true,
	actor: { select: { id: true, name: true, email: true, image: true } },
} as const;

@Injectable()
export class AuditService {
	private readonly logger = new Logger(AuditService.name);

	/** `${sessionId}:${organizationId}` → when the admin entry was last written. */
	private readonly adminEntries = new Map<string, number>();

	constructor(@InjectDatabase() private readonly db: Db) {}

	/** Append to the current tenant's log (the extension stamps the organization). */
	async record(input: AuditEventInput): Promise<void> {
		await this.db.auditEvent.create({
			data: {
				type: input.type,
				actorId: input.actorId ?? null,
				subject: input.subject ?? null,
				data: input.data ?? undefined,
			},
		});
	}

	/** Append to a named organization's log — for platform code outside tenant scope. */
	async recordFor(
		organizationId: string,
		input: AuditEventInput,
	): Promise<void> {
		await runWithTenant(organizationId, () => this.record(input));
	}

	/** Like `record`, but a failure is logged rather than thrown — for paths that must not fail on bookkeeping. */
	async tryRecord(input: AuditEventInput): Promise<void> {
		try {
			await this.record(input);
		} catch (error) {
			this.logger.error(
				{ message: "Audit event was not written", type: input.type },
				error instanceof Error ? error.stack : String(error),
			);
		}
	}

	/**
	 * A platform admin who is not a member entered the organization. Written
	 * once per session and organization per hour; checked in memory first, then
	 * against the log so several API instances agree. Runs inside tenant scope.
	 */
	async adminEntered(input: {
		organizationId: string;
		actorId: string;
		sessionId: string;
		email: string;
	}): Promise<void> {
		const key = `${input.sessionId}:${input.organizationId}`;
		const now = Date.now();
		const last = this.adminEntries.get(key);
		if (last !== undefined && now - last < ADMIN_ENTRY_WINDOW_MS) return;

		const since = new Date(now - ADMIN_ENTRY_WINDOW_MS);
		const recent = await this.db.auditEvent.findFirst({
			where: {
				type: "admin.entered",
				actorId: input.actorId,
				subject: input.sessionId,
				createdAt: { gte: since },
			},
			select: { id: true, createdAt: true },
		});

		if (recent) {
			this.adminEntries.set(key, recent.createdAt.getTime());
			return;
		}

		await this.record({
			type: "admin.entered",
			actorId: input.actorId,
			subject: input.sessionId,
			data: { email: input.email },
		});
		this.adminEntries.set(key, now);
		this.prune(now);

		this.logger.log({
			message: "Platform admin entered organization",
			organizationId: input.organizationId,
			userId: input.actorId,
		});
	}

	/** Newest first, cursor = the id of the last row of the previous page. Runs inside tenant scope. */
	async list(input: AuditListInput): Promise<AuditPage> {
		const take = input.limit;
		const rows = await this.db.auditEvent.findMany({
			take: take + 1,
			cursor: input.cursor ? { id: input.cursor } : undefined,
			skip: input.cursor ? 1 : undefined,
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			select: AUDIT_SELECT,
		});

		const page = rows.slice(0, take);
		const nextCursor = rows.length > take ? (page.at(-1)?.id ?? null) : null;

		return {
			rows: page.map((row) => ({
				id: row.id,
				type: row.type,
				subject: row.subject,
				data: row.data,
				createdAt: row.createdAt.toISOString(),
				actor: row.actor,
			})),
			nextCursor,
		};
	}

	private prune(now: number): void {
		if (this.adminEntries.size < 1_000) return;
		for (const [key, at] of this.adminEntries) {
			if (now - at >= ADMIN_ENTRY_WINDOW_MS) this.adminEntries.delete(key);
		}
	}
}
