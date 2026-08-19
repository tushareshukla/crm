const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;

export const E2E = {
	dispatch: {
		agentPrefix: "E2E Dispatch Agent",
		companyPrefix: "E2E Co",
		domainPrefix: "e2e-",
		domainSuffix: ".test",
	},

	load: {
		agentPrefix: "E2E Load Agent",
		companyPrefix: "Load Co",
		domainPrefix: "load-",
		domainSuffix: ".test",
		defaultCount: 300,
		drainPassSlack: 5,
	},

	retry: {
		companyPrefix: "E2E Retry Co",
		kind: "e2e-retry",
		reason: "e2e.retry",
		priority: 900,
		claimLimit: 1,
		leaseMs: 5 * MINUTE_MS,
		expiredLeaseMs: MINUTE_MS,
		holdBackMs: 30 * SECOND_MS,
	},

	slackJoin: {
		bogusChannelId: "C00NOTREAL99",
		bogusChannelName: "missing",
	},

	liveRun: {
		agentPrefix: "E2E Live Agent",
		agentUrl: "http://localhost:3010",
		pollMs: 5 * SECOND_MS,
		giveUpMs: 5 * MINUTE_MS,
	},
} as const;

/**
 * The e2e scripts work inside one organization, named by `E2E_ORGANIZATION_ID`
 * (or its slug in `E2E_ORG_SLUG`): every record they seed and every task they
 * dispatch belongs to it, the way the agent itself runs each unit of work.
 */
export async function inE2eOrganization<T>(main: () => Promise<T>): Promise<T> {
	const { db, runWithTenant } = await import("@crm/db");

	const id = process.env.E2E_ORGANIZATION_ID?.trim();
	const slug = process.env.E2E_ORG_SLUG?.trim();
	const organizationId =
		id ||
		(slug
			? (
					await db.organization.findFirst({
						where: { slug },
						select: { id: true },
					})
				)?.id
			: undefined);

	if (!organizationId) {
		console.error(
			"Set E2E_ORGANIZATION_ID (or E2E_ORG_SLUG) to the organization this script should work inside.",
		);
		process.exit(1);
	}

	return runWithTenant(organizationId, main);
}
