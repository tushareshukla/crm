import {
	canManageConnections,
	isSlackConfigured,
	workspaceId,
} from "@crm/auth";
import type { Db, Prisma } from "@crm/db";
import { currentTenantId, withoutTenant } from "@crm/db";
import { schemas } from "@crm/validation";
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { AgentAccessService } from "../agent/agent-access.service";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { InjectDatabase } from "../database/database.constants";
import type {
	SlackChannelsInput,
	SlackCreateChannelInput,
	SlackJoinChannelInput,
} from "./slack.contracts";
import { SlackChannelsService } from "./slack-channels.service";
import { SLACK, type SlackSyncState } from "./slack-config";

const SLACK_WORKSPACE_RESOURCE_ID =
	schemas.agents.CAPABILITY_RESOURCE_IDS.slack;

@Injectable()
export class SlackConnectionService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agent: AgentTriggerService,
		private readonly slackChannels: SlackChannelsService,
		private readonly access: AgentAccessService,
	) {}

	async status(userId: string) {
		const role = await this.access.assertMember(userId);
		const [account, agents, matches, memberCount, grant, installation] =
			await Promise.all([
				this.db.account.findFirst({
					// Account is a global better-auth row: only a connection made by
					// a member of this organization counts here.
					where: {
						providerId: "slack",
						accessToken: { not: null },
						user: { members: { some: { organizationId: workspaceId() } } },
					},
					orderBy: { updatedAt: "desc" },
					select: { accountId: true, updatedAt: true, scope: true },
				}),
				this.db.agentDefinition.findMany({
					where: {
						status: { in: ["LIVE", "PAUSED"] },
						deletedAt: null,
						currentVersionId: { not: null },
						currentVersion: {
							manifest: {
								path: ["dataScope", "resources"],
								array_contains: [{ id: SLACK_WORKSPACE_RESOURCE_ID }],
							},
						},
					},
					orderBy: { updatedAt: "desc" },
					take: 30,
					select: { id: true, name: true, description: true, status: true },
				}),
				this.db.slackMemberMatch.findMany({
					where: {
						crmUser: { members: { some: { organizationId: workspaceId() } } },
					},
					select: { slackUserId: true, updatedAt: true },
				}),
				this.db.member.count({ where: { organizationId: workspaceId() } }),
				this.db.slackWorkspaceGrant.findFirst({
					select: { id: true, teamName: true },
				}),
				this.db.slackInstallation.findFirst({ select: { id: true } }),
			]);

		// Connected means connected *for this organization*: a member's Slack
		// account plus this organization's own grant (or in-flight installation).
		// A member's account alone is another organization's connection.
		const connected = Boolean(account && (grant || installation));

		const matched = matches.filter((match) => match.slackUserId).length;
		const reviewed = matches.length;
		const inventoryFresh =
			connected &&
			account &&
			reviewed === memberCount &&
			matches.every((match) => match.updatedAt >= account.updatedAt);
		if (connected && account && !inventoryFresh) {
			await this.agent.slackPeopleRequested(
				"Match workspace members to Slack accounts by exact email",
			);
		}

		return {
			configured: isSlackConfigured(),
			connected,
			workspace: connected ? (grant?.teamName ?? null) : null,
			lastConnectedAt:
				connected && account ? account.updatedAt.toISOString() : null,
			scopes: (connected ? (account?.scope ?? "") : "")
				.split(",")
				.map((scope) => scope.trim())
				.filter(Boolean),
			canInviteItself: Boolean(grant),
			canManage: canManageConnections(role),
			agents,
			people: { matched, reviewed },
		};
	}

	async matches(userId: string) {
		await this.access.assertMember(userId);
		const [members, syncing] = await Promise.all([
			this.db.member.findMany({
				where: { organizationId: workspaceId() },
				orderBy: { user: { name: "asc" } },
				select: {
					user: {
						select: {
							id: true,
							name: true,
							email: true,
							// One match per (organization, user); a user in several
							// organizations has one row each, so name this one.
							slackMemberMatch: {
								where: { organizationId: workspaceId() },
								take: 1,
								select: {
									slackUserId: true,
									slackHandle: true,
									slackEmail: true,
								},
							},
						},
					},
				},
			}),
			this.peopleSyncState(),
		]);

		return {
			rows: members.map(({ user }) => ({
				crmUserId: user.id,
				name: user.name,
				email: user.email,
				match: user.slackMemberMatch[0] ?? null,
			})),
			sync: syncing,
		};
	}

	private async peopleSyncState(): Promise<SlackSyncState> {
		const pending = await this.db.agentTask.findFirst({
			where: { kind: "slack-people-match", finishedAt: null },
			orderBy: { createdAt: "desc" },
			select: { createdAt: true, startedAt: true, leasedUntil: true },
		});
		if (!pending) return "idle";

		const now = Date.now();
		const leaseHeld = pending.leasedUntil
			? pending.leasedUntil.getTime() > now
			: false;
		if (leaseHeld || pending.startedAt) return "syncing";

		return now - pending.createdAt.getTime() < SLACK.sync.stalledAfterMs
			? "syncing"
			: "stalled";
	}

	async refreshPeople(userId: string) {
		await this.access.assertMember(userId);
		const [account, grant, installation] = await Promise.all([
			this.db.account.findFirst({
				// Account is a global better-auth row: only a connection made by a
				// member of this organization counts here.
				where: {
					providerId: "slack",
					accessToken: { not: null },
					user: { members: { some: { organizationId: workspaceId() } } },
				},
				orderBy: { updatedAt: "desc" },
				select: { id: true },
			}),
			this.db.slackWorkspaceGrant.findFirst({ select: { id: true } }),
			this.db.slackInstallation.findFirst({ select: { id: true } }),
		]);
		if (!account || !(grant || installation)) {
			throw new NotFoundException("Slack is not connected.");
		}

		await this.agent.slackPeopleRequested(
			"Refresh Slack people and channels from the connection page",
			true,
		);

		return { requested: true };
	}

	async channels(input: SlackChannelsInput, userId: string) {
		await this.access.assertMember(userId);

		const take = input.limit ?? SLACK.channels.pageSize;
		const needle = input.query?.trim() ?? "";

		const where: Prisma.SlackChannelWhereInput = { available: true };
		if (needle) where.name = { contains: needle, mode: "insensitive" };

		const [rows, grant, sync] = await Promise.all([
			this.db.slackChannel.findMany({
				where,
				orderBy: [{ isMember: "desc" }, { name: "asc" }, { id: "asc" }],
				take: take + 1,
				cursor: input.cursor
					? {
							organizationId_id: {
								organizationId: currentTenantId(),
								id: input.cursor,
							},
						}
					: undefined,
				skip: input.cursor ? 1 : undefined,
				select: {
					id: true,
					name: true,
					memberCount: true,
					isPrivate: true,
					isMember: true,
					classifiedAt: true,
					inviteRequestedAt: true,
				},
			}),
			this.db.slackWorkspaceGrant.findFirst({ select: { id: true } }),
			this.peopleSyncState(),
		]);

		const page = rows.slice(0, take);

		return {
			canInviteItself: Boolean(grant),
			sync,
			nextCursor: rows.length > take ? (page.at(-1)?.id ?? null) : null,
			rows: page.map(({ classifiedAt, ...row }) => ({
				...row,
				classified: classifiedAt !== null,
				inviteRequestedAt: row.inviteRequestedAt?.toISOString() ?? null,
			})),
		};
	}

	async joinChannel(input: SlackJoinChannelInput, userId: string) {
		await this.access.assertMember(userId);
		const channel = await this.db.slackChannel.findUnique({
			where: {
				organizationId_id: {
					organizationId: currentTenantId(),
					id: input.channelId,
				},
			},
			select: { id: true, name: true, isMember: true, isPrivate: true },
		});
		if (!channel) throw new NotFoundException("No such Slack channel.");
		if (channel.isMember) return { queued: false, alreadyJoined: true };

		const grant = await this.db.slackWorkspaceGrant.findFirst({
			select: { id: true },
		});
		if (channel.isPrivate && !grant) {
			await this.db.slackChannel.update({
				where: {
					organizationId_id: {
						organizationId: currentTenantId(),
						id: channel.id,
					},
				},
				data: { inviteRequestedAt: new Date() },
			});
			return { queued: false, alreadyJoined: false };
		}

		await this.agent.slackChannelJoinRequested(channel.id, channel.name);
		return { queued: true, alreadyJoined: false };
	}

	async createChannel(input: SlackCreateChannelInput, userId: string) {
		await this.access.assertMember(userId);
		const existing = await this.db.slackChannel.findFirst({
			where: { name: input.name },
			select: { id: true },
		});
		if (existing) {
			throw new BadRequestException("A channel with that name already exists.");
		}

		return this.slackChannels.create(input.name, input.isPrivate);
	}

	async disconnect(userId: string) {
		const role = await this.access.assertMember(userId);

		if (!canManageConnections(role)) {
			throw new ForbiddenException(
				"Only an owner or an admin can disconnect Slack.",
			);
		}

		const organizationId = currentTenantId();

		const removed = await this.db.$transaction(async (tx) => {
			// This organization's Slack state only — tenant models, so the
			// extension scopes every one of these to the current organization.
			const [grants, installations] = await Promise.all([
				tx.slackWorkspaceGrant.deleteMany({}),
				tx.slackInstallation.deleteMany({}),
			]);
			await tx.slackChannel.deleteMany({});
			await tx.slackMemberMatch.deleteMany({});

			// Account is a global better-auth row, one per user: a member of this
			// organization may also carry another organization's Slack connection.
			const candidates = await tx.account.findMany({
				where: {
					providerId: "slack",
					user: { members: { some: { organizationId } } },
				},
				select: { id: true, userId: true },
			});

			let accounts = 0;
			for (const candidate of candidates) {
				// Platform-level existence check: does any OTHER organization this
				// user belongs to still have a Slack connection (grant, or an
				// in-flight installation) that depends on their account? Those are
				// other organizations' tenant rows, hence withoutTenant — reading
				// them is exactly the point, and nothing is written across tenants.
				const dependedOn = await withoutTenant(async () => {
					const elsewhere = {
						organizationId: { not: organizationId },
						organization: { members: { some: { userId: candidate.userId } } },
					};
					const grant = await tx.slackWorkspaceGrant.findFirst({
						where: elsewhere,
						select: { id: true },
					});
					if (grant) return true;
					const installation = await tx.slackInstallation.findFirst({
						where: elsewhere,
						select: { id: true },
					});
					return Boolean(installation);
				});
				if (dependedOn) continue;

				await tx.account.delete({ where: { id: candidate.id } });
				accounts += 1;
			}

			return grants.count + installations.count + accounts;
		});

		if (removed === 0) throw new NotFoundException("Slack is not connected.");

		return { disconnected: true };
	}
}
