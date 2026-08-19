import { MAX_SLUG } from "@crm/db/workspace";
import { z } from "zod";

export const orgSlug = z
	.string()
	.trim()
	.min(1)
	.max(MAX_SLUG)
	.regex(
		/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
		"Use lowercase letters, digits and dashes.",
	);

export const orgSlugInput = z.object({ slug: orgSlug });

export const acceptInvitationInput = z.object({
	invitationId: z.string().trim().min(1),
});

export type OrgSlugInput = z.infer<typeof orgSlugInput>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInput>;
