import type { Prisma } from "@crm/db";
import { z } from "zod";

/** Per-organization caps, stored on `Organization.limits`. Null = platform default / unlimited. */
export const orgLimits = z.object({
	maxMembers: z.number().int().min(1).nullable().default(null),
	maxContacts: z.number().int().min(1).nullable().default(null),
	agentTasksPerDay: z.number().int().min(0).nullable().default(null),
});

export type OrgLimits = z.infer<typeof orgLimits>;

export const EMPTY_LIMITS: OrgLimits = {
	maxMembers: null,
	maxContacts: null,
	agentTasksPerDay: null,
};

export function readOrgLimits(value: Prisma.JsonValue | null): OrgLimits {
	const parsed = orgLimits.safeParse(value ?? {});
	return parsed.success ? parsed.data : EMPTY_LIMITS;
}
