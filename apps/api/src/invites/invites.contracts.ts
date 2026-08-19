import { WORKSPACE_ROLES } from "@crm/auth";
import { z } from "zod";

export const createInviteInput = z.object({
	email: z.string().trim().toLowerCase().email().max(254),
	role: z.enum(WORKSPACE_ROLES).default("member"),
});

export const inviteIdInput = z.object({ id: z.string().trim().min(1) });

export type CreateInviteInput = z.infer<typeof createInviteInput>;
export type InviteIdInput = z.infer<typeof inviteIdInput>;
