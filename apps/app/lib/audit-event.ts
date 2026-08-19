/**
 * One line per audit event — what the organization's log shows. The API
 * writes `type`, a `subject` (the thing acted on) and a small `data` object;
 * this turns them into a sentence without trusting either to be well-formed.
 */
export type AuditEventLike = {
	type: string;
	subject: string | null;
	data: unknown;
	actor: { name: string; email: string } | null;
};

const LABELS: Record<string, string> = {
	"org.created": "Organization created",
	"org.updated": "Organization updated",
	"org.suspended": "Organization suspended",
	"org.unsuspended": "Organization reinstated",
	"invite.created": "Invitation sent",
	"invite.revoked": "Invitation revoked",
	"invite.accepted": "Invitation accepted",
	"member.role_changed": "Role changed",
	"admin.entered": "Platform admin entered",
};

export function auditEventLabel(type: string): string {
	return LABELS[type] ?? type;
}

/** Who did it: a name, else an email, else the platform. */
export function auditActorLabel(actor: AuditEventLike["actor"]): string {
	if (!actor) return "Platform";
	return actor.name.trim() || actor.email;
}

/** The detail worth a line under the label, or null when there is none. */
export function auditEventDetail(event: AuditEventLike): string | null {
	const data = record(event.data);

	switch (event.type) {
		case "invite.created":
			return [text(data.email), text(data.role) && `as ${text(data.role)}`]
				.filter(Boolean)
				.join(" ");
		case "invite.revoked":
		case "invite.accepted":
			return text(data.email) ?? null;
		case "member.role_changed":
			return text(data.role) ? `now ${text(data.role)}` : null;
		case "org.updated": {
			const changes = Object.entries(data)
				.filter(([, value]) => typeof value === "string")
				.map(([key, value]) => `${key}: ${String(value)}`);
			return changes.length ? changes.join(", ") : null;
		}
		case "admin.entered":
			return text(data.email) ?? null;
		case "org.created":
			return [text(data.slug) && `/${text(data.slug)}`, text(data.ownerEmail)]
				.filter(Boolean)
				.join(" · ");
		default:
			return event.subject;
	}
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
