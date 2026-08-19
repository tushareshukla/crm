import { z } from "zod";

export const auditListInput = z.object({
	cursor: z.string().min(1).optional(),
	limit: z.number().int().min(1).max(200).default(50),
});

export type AuditListInput = z.infer<typeof auditListInput>;

export const adminAuditLogInput = auditListInput.extend({
	organizationId: z.string().min(1),
});

export type AdminAuditLogInput = z.infer<typeof adminAuditLogInput>;
