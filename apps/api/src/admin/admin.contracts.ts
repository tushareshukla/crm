import { z } from "zod";
import { orgLimits } from "../orgs/org-limits";
import { orgSlug } from "../orgs/orgs.contracts";

export const orgName = z.string().trim().min(1).max(120);

export const orgIdInput = z.object({ id: z.string().trim().min(1) });

export const createOrganizationInput = z.object({
	name: orgName,
	slug: orgSlug,
	ownerEmail: z.string().trim().toLowerCase().email().max(254),
});

export const updateOrganizationInput = z.object({
	id: z.string().trim().min(1),
	name: orgName.optional(),
	slug: orgSlug.optional(),
	logo: z.string().trim().url().max(2048).nullable().optional(),
	limits: orgLimits.partial().optional(),
});

export type OrgIdInput = z.infer<typeof orgIdInput>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationInput>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationInput>;
