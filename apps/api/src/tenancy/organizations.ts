import { type Db, OrgStatus, runWithTenant, withoutTenant } from "@crm/db";
import { Logger } from "@nestjs/common";

export type OrganizationRef = { id: string; slug: string };

export type PerOrganizationOutcome<T> = { org: OrganizationRef } & (
	| { ok: true; result: T }
	| { ok: false; error: unknown }
);

/**
 * Every organization a platform loop should visit: active ones, oldest first.
 * Platform code — runs outside tenant scope on a global model.
 */
export async function activeOrganizations(db: Db): Promise<OrganizationRef[]> {
	return withoutTenant(() =>
		db.organization.findMany({
			where: { status: OrgStatus.ACTIVE },
			select: { id: true, slug: true },
			orderBy: { createdAt: "asc" },
		}),
	);
}

/**
 * Run `work` once per active organization, each inside that organization's
 * tenant scope. One organization failing never stops the others; the failure
 * is logged and returned so callers can report it.
 */
export async function forEachActiveOrganization<T>(
	db: Db,
	work: (org: OrganizationRef) => Promise<T>,
	logger: Logger = new Logger("Tenancy"),
): Promise<PerOrganizationOutcome<T>[]> {
	const outcomes: PerOrganizationOutcome<T>[] = [];

	for (const org of await activeOrganizations(db)) {
		try {
			const result = await runWithTenant(org.id, () => work(org));
			outcomes.push({ org, ok: true, result });
		} catch (error) {
			logger.error(
				{ message: "Per-organization work failed", organizationId: org.id },
				error instanceof Error ? error.stack : String(error),
			);
			outcomes.push({ org, ok: false, error });
		}
	}

	return outcomes;
}
