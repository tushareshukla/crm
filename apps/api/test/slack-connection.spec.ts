import { describe, expect } from "bun:test";
import type { WorkspaceRole } from "@crm/auth";
import { type Db, db, type Prisma } from "@crm/db";
import type { AgentAccessService } from "../src/agent/agent-access.service";
import type { AgentTriggerService } from "../src/agent/agent-trigger.service";
import type { SlackChannelsService } from "../src/slack/slack-channels.service";
import { SlackConnectionService } from "../src/slack/slack-connection.service";
import {
	afterAll,
	beforeAll,
	createTestOrganization,
	deleteTestOrganization,
	it,
	memberOf,
	runWithTenant,
	TEST_ORG,
	type TestOrganization,
	withoutTenant,
} from "./tenant";

const userId = "crm-1";

function serviceFor(input: {
	accountUpdatedAt?: Date;
	matches?: Array<{ slackUserId: string | null; updatedAt: Date }>;
	members?: Array<{
		user: {
			id: string;
			name: string;
			email: string;
			slackMemberMatch: Array<{
				slackUserId: string | null;
				slackHandle: string | null;
				slackEmail: string | null;
			}>;
		};
	}>;
	memberCount?: number;
	agents?: unknown[];
	syncingTask?: {
		createdAt: Date;
		startedAt: Date | null;
		leasedUntil: Date | null;
	};
	grant?: boolean;
	installation?: boolean;
	role?: WorkspaceRole;
}) {
	const requested: Array<{ reason: string; required: boolean | undefined }> =
		[];
	const deleted: string[] = [];
	const memberQueries: Prisma.MemberFindManyArgs[] = [];
	const accountQueries: Prisma.AccountFindFirstArgs[] = [];
	const tx = {
		account: {
			findMany: async () => [],
			delete: async () => {
				deleted.push("account");
				return { id: "account-1" };
			},
		},
		slackChannel: {
			deleteMany: async () => {
				deleted.push("slackChannel");
				return { count: 0 };
			},
		},
		slackMemberMatch: {
			deleteMany: async () => {
				deleted.push("slackMemberMatch");
				return { count: 0 };
			},
		},
		slackWorkspaceGrant: {
			deleteMany: async () => {
				deleted.push("slackWorkspaceGrant");
				return { count: input.grant ? 1 : 0 };
			},
		},
		slackInstallation: {
			deleteMany: async () => {
				deleted.push("slackInstallation");
				return { count: input.installation ? 1 : 0 };
			},
		},
	};
	const db = {
		$transaction: async <T>(run: (client: typeof tx) => Promise<T>) => run(tx),
		account: {
			findFirst: async (args: Prisma.AccountFindFirstArgs) => {
				accountQueries.push(args);
				return input.accountUpdatedAt
					? {
							id: "account-1",
							accountId: "slack-user",
							updatedAt: input.accountUpdatedAt,
						}
					: null;
			},
		},
		agentDefinition: { findMany: async () => input.agents ?? [] },
		slackMemberMatch: { findMany: async () => input.matches ?? [] },
		slackWorkspaceGrant: {
			findFirst: async () =>
				input.grant ? { id: "grant-1", teamName: "Spec Team" } : null,
		},
		slackInstallation: {
			findFirst: async () => (input.installation ? { id: "install-1" } : null),
		},
		member: {
			count: async () => input.memberCount ?? 0,
			findMany: async (args: Prisma.MemberFindManyArgs) => {
				memberQueries.push(args);
				return input.members ?? [];
			},
		},
		agentTask: {
			findFirst: async () => input.syncingTask ?? null,
		},
	} as unknown as Db;
	const agent = {
		slackPeopleRequested: async (reason: string, required?: boolean) => {
			requested.push({ reason, required });
		},
	} as AgentTriggerService;
	const channels = {} as SlackChannelsService;
	const access = {
		assertMember: async () => input.role ?? "member",
	} as unknown as AgentAccessService;

	return {
		service: new SlackConnectionService(db, agent, channels, access),
		requested,
		deleted,
		memberQueries,
		accountQueries,
	};
}

describe("Slack connection", () => {
	it("requests one inventory refresh when the connected account is newer", async () => {
		const connectedAt = new Date("2026-08-10T10:00:00.000Z");
		const { service, requested } = serviceFor({
			accountUpdatedAt: connectedAt,
			grant: true,
			memberCount: 2,
			matches: [
				{
					slackUserId: "U1",
					updatedAt: new Date("2026-08-10T09:00:00.000Z"),
				},
			],
		});

		const status = await service.status(userId);

		expect(status.connected).toBe(true);
		expect(status.people).toEqual({ matched: 1, reviewed: 1 });
		expect(requested).toEqual([
			{
				reason: "Match workspace members to Slack accounts by exact email",
				required: undefined,
			},
		]);
	});

	it("does not refresh a complete inventory that was read after connecting", async () => {
		const connectedAt = new Date("2026-08-10T10:00:00.000Z");
		const reviewedAt = new Date("2026-08-10T10:00:01.000Z");
		const { service, requested } = serviceFor({
			accountUpdatedAt: connectedAt,
			grant: true,
			memberCount: 2,
			matches: [
				{ slackUserId: "U1", updatedAt: reviewedAt },
				{ slackUserId: null, updatedAt: reviewedAt },
			],
		});

		const status = await service.status(userId);

		expect(status.people).toEqual({ matched: 1, reviewed: 2 });
		expect(requested).toEqual([]);
	});

	it("returns only real CRM members and their stored exact-email matches", async () => {
		const { service, memberQueries } = serviceFor({
			members: [
				{
					user: {
						id: "crm-1",
						name: "Grim",
						email: "grim@example.test",
						slackMemberMatch: [
							{
								slackUserId: "U1",
								slackHandle: "@grim",
								slackEmail: "grim@example.test",
							},
						],
					},
				},
				{
					user: {
						id: "crm-2",
						name: "Unmatched",
						email: "unmatched@example.test",
						slackMemberMatch: [],
					},
				},
			],
			syncingTask: {
				createdAt: new Date(),
				startedAt: null,
				leasedUntil: null,
			},
		});

		expect(await service.matches(userId)).toEqual({
			rows: [
				{
					crmUserId: "crm-1",
					name: "Grim",
					email: "grim@example.test",
					match: {
						slackUserId: "U1",
						slackHandle: "@grim",
						slackEmail: "grim@example.test",
					},
				},
				{
					crmUserId: "crm-2",
					name: "Unmatched",
					email: "unmatched@example.test",
					match: null,
				},
			],
			sync: "syncing",
		});

		// Members and their matches are this organization's only: a user who is
		// in several organizations has one match row per organization.
		expect(memberQueries).toHaveLength(1);
		expect(memberQueries[0]).toMatchObject({
			where: { organizationId: TEST_ORG.id },
			select: {
				user: {
					select: {
						slackMemberMatch: { where: { organizationId: TEST_ORG.id } },
					},
				},
			},
		});
	});

	it("reports a stalled sync when nothing picks the task up", async () => {
		const { service } = serviceFor({
			syncingTask: {
				createdAt: new Date(Date.now() - 10 * 60_000),
				startedAt: null,
				leasedUntil: null,
			},
		});

		expect((await service.matches(userId)).sync).toBe("stalled");
	});

	it("reports a running sync while the agent holds the lease", async () => {
		const { service } = serviceFor({
			syncingTask: {
				createdAt: new Date(Date.now() - 10 * 60_000),
				startedAt: null,
				leasedUntil: new Date(Date.now() + 60_000),
			},
		});

		expect((await service.matches(userId)).sync).toBe("syncing");
	});

	it("reports an idle sync when no task waits", async () => {
		const { service } = serviceFor({});

		expect((await service.matches(userId)).sync).toBe("idle");
	});

	it("refuses to disconnect the workspace for a member", async () => {
		const { service, deleted } = serviceFor({
			accountUpdatedAt: new Date("2026-08-10T10:00:00.000Z"),
			role: "member",
		});

		await expect(service.disconnect(userId)).rejects.toThrow(
			"Only an owner or an admin can disconnect Slack.",
		);
		expect(deleted).toEqual([]);
	});

	it("tells a member that they cannot disconnect", async () => {
		const { service } = serviceFor({
			accountUpdatedAt: new Date("2026-08-10T10:00:00.000Z"),
			role: "member",
		});

		expect((await service.status(userId)).canManage).toBe(false);
	});

	it("disconnects the workspace for an admin", async () => {
		const { service, deleted } = serviceFor({
			accountUpdatedAt: new Date("2026-08-10T10:00:00.000Z"),
			grant: true,
			role: "admin",
		});

		expect(await service.disconnect(userId)).toEqual({ disconnected: true });
		expect(deleted).toEqual([
			"slackWorkspaceGrant",
			"slackInstallation",
			"slackChannel",
			"slackMemberMatch",
		]);
	});

	it("does not report another organization's connection as this one's", async () => {
		// A member's global Slack account exists, but this organization has no
		// grant or installation of its own: not connected here.
		const { service, requested, accountQueries } = serviceFor({
			accountUpdatedAt: new Date("2026-08-10T10:00:00.000Z"),
			memberCount: 1,
		});

		const status = await service.status(userId);

		expect(status.connected).toBe(false);
		expect(status.workspace).toBeNull();
		expect(status.lastConnectedAt).toBeNull();
		expect(status.scopes).toEqual([]);
		expect(requested).toEqual([]);

		// And the account read itself never leaves this organization's members.
		expect(accountQueries).toHaveLength(1);
		expect(accountQueries[0]).toMatchObject({
			where: {
				providerId: "slack",
				user: { members: { some: { organizationId: TEST_ORG.id } } },
			},
		});
	});

	it("refuses a people refresh when this organization is not connected", async () => {
		const { service, requested, accountQueries } = serviceFor({
			accountUpdatedAt: new Date("2026-08-10T10:00:00.000Z"),
		});

		await expect(service.refreshPeople(userId)).rejects.toThrow(
			"Slack is not connected.",
		);
		expect(requested).toEqual([]);
		expect(accountQueries[0]).toMatchObject({
			where: {
				providerId: "slack",
				user: { members: { some: { organizationId: TEST_ORG.id } } },
			},
		});
	});
});

describe("disconnecting is scoped to the organization", () => {
	const suffix = process.env.TEST_RUN_ID ?? "slack-disc";
	const soloId = `slack-solo-${suffix}`;
	const sharedId = `slack-shared-${suffix}`;

	let orgA: TestOrganization;
	let orgB: TestOrganization;

	const service = new SlackConnectionService(
		db,
		{
			slackPeopleRequested: async () => undefined,
		} as unknown as AgentTriggerService,
		{} as SlackChannelsService,
		{ assertMember: async () => "admin" } as unknown as AgentAccessService,
	);

	async function clean() {
		await deleteTestOrganization({ id: `org-slack-a-${suffix}` });
		await deleteTestOrganization({ id: `org-slack-b-${suffix}` });
		await withoutTenant(() =>
			db.user.deleteMany({ where: { id: { in: [soloId, sharedId] } } }),
		);
	}

	beforeAll(async () => {
		await clean();
		orgA = await createTestOrganization(`slack-a-${suffix}`);
		orgB = await createTestOrganization(`slack-b-${suffix}`);

		await db.user.createMany({
			data: [
				{ id: soloId, name: "Solo", email: `solo@slack-${suffix}.test` },
				{ id: sharedId, name: "Shared", email: `shared@slack-${suffix}.test` },
			],
		});
		// Solo works in organization A only; Shared works in both, and carries
		// organization B's Slack connection.
		await memberOf(soloId, orgA.id);
		await memberOf(sharedId, orgA.id);
		await memberOf(sharedId, orgB.id);

		await db.account.createMany({
			data: [
				{
					id: `acc-solo-${suffix}`,
					accountId: "U-SOLO",
					providerId: "slack",
					userId: soloId,
					accessToken: "xoxb-solo",
				},
				{
					id: `acc-shared-${suffix}`,
					accountId: "U-SHARED",
					providerId: "slack",
					userId: sharedId,
					accessToken: "xoxb-shared",
				},
			],
		});

		await runWithTenant(orgA.id, async () => {
			await db.slackWorkspaceGrant.create({
				data: { teamId: "T-A", userToken: "xoxp-a", userScopes: "" },
			});
			await db.slackChannel.create({ data: { id: "C-A", name: "general" } });
			await db.slackMemberMatch.create({
				data: { crmUserId: soloId, slackUserId: "U-SOLO" },
			});
		});
		await runWithTenant(orgB.id, async () => {
			await db.slackWorkspaceGrant.create({
				data: { teamId: "T-B", userToken: "xoxp-b", userScopes: "" },
			});
			await db.slackChannel.create({ data: { id: "C-B", name: "general" } });
			await db.slackMemberMatch.create({
				data: { crmUserId: sharedId, slackUserId: "U-SHARED" },
			});
		});
	});

	afterAll(clean);

	it("removes only this organization's rows and spares accounts other organizations depend on", async () => {
		expect(
			await runWithTenant(orgA.id, () => service.disconnect(soloId)),
		).toEqual({ disconnected: true });

		// Organization A's Slack state is gone…
		await runWithTenant(orgA.id, async () => {
			expect(await db.slackWorkspaceGrant.count()).toBe(0);
			expect(await db.slackChannel.count()).toBe(0);
			expect(await db.slackMemberMatch.count()).toBe(0);
		});

		// …organization B's is untouched.
		await runWithTenant(orgB.id, async () => {
			expect(await db.slackWorkspaceGrant.count()).toBe(1);
			expect(await db.slackChannel.count()).toBe(1);
			expect(await db.slackMemberMatch.count()).toBe(1);
		});

		// Solo's account served only organization A: deleted. Shared's account
		// still serves organization B's connection: kept.
		const accounts = await withoutTenant(() =>
			db.account.findMany({
				where: { providerId: "slack", userId: { in: [soloId, sharedId] } },
				select: { userId: true },
			}),
		);
		expect(accounts.map((account) => account.userId)).toEqual([sharedId]);
	});

	it("deletes the shared account once no other organization needs it", async () => {
		expect(
			await runWithTenant(orgB.id, () => service.disconnect(sharedId)),
		).toEqual({ disconnected: true });

		expect(
			await withoutTenant(() =>
				db.account.count({
					where: { providerId: "slack", userId: { in: [soloId, sharedId] } },
				}),
			),
		).toBe(0);
	});

	it("says so when there is nothing to disconnect", async () => {
		await expect(
			runWithTenant(orgA.id, () => service.disconnect(soloId)),
		).rejects.toThrow("Slack is not connected.");
	});
});
