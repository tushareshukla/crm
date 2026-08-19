/**
 * One line per audit event — what the organization's log shows. The API
 * writes `type`, a `subject` (the thing acted on) and a small `data` object;
 * this turns them into a sentence without trusting either to be well-formed.
 */
import { z } from "zod";

export type AuditEventLike = {
	type: string;
	subject: string | null;
	data: unknown;
	actor: { name: string; email: string } | null;
};

/** Every type the API writes (apps/api/src/audit/audit.service.ts, AUDIT_EVENT_TYPES). */
type AuditEventType =
	| "org.created"
	| "org.updated"
	| "org.suspended"
	| "org.unsuspended"
	| "invite.created"
	| "invite.revoked"
	| "invite.accepted"
	| "member.role_changed"
	| "admin.entered";

const LABELS = {
	"org.created": "Organization created",
	"org.updated": "Organization updated",
	"org.suspended": "Organization suspended",
	"org.unsuspended": "Organization reinstated",
	"invite.created": "Invitation sent",
	"invite.revoked": "Invitation revoked",
	"invite.accepted": "Invitation accepted",
	"member.role_changed": "Role changed",
	"admin.entered": "Platform admin entered",
} satisfies Record<AuditEventType, string>;

function isAuditEventType(type: string): type is AuditEventType {
	return Object.hasOwn(LABELS, type);
}

export function auditEventLabel(type: string): string {
	return isAuditEventType(type) ? LABELS[type] : type;
}

/** Who did it: a name, else an email, else the platform. */
export function auditActorLabel(actor: AuditEventLike["actor"]): string {
	if (!actor) return "Platform";
	return actor.name.trim() || actor.email;
}

/** A detail worth showing: non-blank text, trimmed. Anything else is nothing. */
const detailText = z.string().trim().min(1).optional().catch(undefined);

/** The details the API puts in `data`, read leniently: a missing or odd field is just absent. */
const auditDetails = z
	.object({
		email: detailText,
		role: detailText,
		slug: detailText,
		ownerEmail: detailText,
	})
	.catch({});

/** `org.updated` data: the changed fields; only the textual ones are shown. */
const changedFields = z
	.record(z.string(), z.string().optional().catch(undefined))
	.catch({});

/** The detail worth a line under the label, or null when there is none. */
export function auditEventDetail(event: AuditEventLike): string | null {
	const data = auditDetails.parse(event.data);

	switch (event.type) {
		case "invite.created":
			return [data.email, data.role && `as ${data.role}`]
				.filter(Boolean)
				.join(" ");
		case "invite.revoked":
		case "invite.accepted":
			return data.email ?? null;
		case "member.role_changed":
			return data.role ? `now ${data.role}` : null;
		case "org.updated": {
			const changes = Object.entries(changedFields.parse(event.data)).flatMap(
				([key, value]) => (value === undefined ? [] : [`${key}: ${value}`]),
			);
			return changes.length ? changes.join(", ") : null;
		}
		case "admin.entered":
			return data.email ?? null;
		case "org.created":
			return [data.slug && `/${data.slug}`, data.ownerEmail]
				.filter(Boolean)
				.join(" · ");
		default:
			return event.subject;
	}
}
