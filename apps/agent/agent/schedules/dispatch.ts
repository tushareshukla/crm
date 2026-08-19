import { defineSchedule } from "eve/schedules";
import crm from "../channels/crm";
import { sweepBlankFacts } from "../lib/blank-facts";
import {
	pendingAgentRunIds,
	pendingBuilderSubmissionIds,
	queueDueAgentRuns,
} from "../lib/custom-agent-dispatch";
import { brief, drainAll, taskAuth } from "../lib/dispatch";
import { reconcileStaleTasks } from "../lib/stale-tasks";

/**
 * The dispatch tick is platform code: it runs outside any tenant, lists due
 * work across every organization, and starts each unit inside the
 * organization it belongs to — research tasks through `drainAll`, builder
 * chats and deployed runs through the crm channel's `receive`, which reads
 * the organization off the target. The sessions it starts carry the
 * organization as an auth attribute.
 */
export default defineSchedule({
	cron: "* * * * *",
	async run({ receive, waitUntil, appAuth }) {
		waitUntil(
			Promise.all([
				sweepBlankFacts(),

				(async () => {
					await reconcileStaleTasks();
					await drainAll((task) =>
						receive(crm, {
							message: brief(task),
							target: { taskId: task.id, organizationId: task.organizationId },
							auth: taskAuth(task, appAuth),
						}),
					);
					await queueDueAgentRuns();
					const [builders, runs] = await Promise.all([
						pendingBuilderSubmissionIds(),
						pendingAgentRunIds(),
					]);

					await Promise.all([
						...builders.map(({ id, organizationId }) =>
							receive(crm, {
								message: "Continue a queued private agent-builder chat.",
								target: { builderSubmissionId: id, organizationId },
								auth: appAuth,
							}),
						),
						...runs.map(({ id, organizationId }) =>
							receive(crm, {
								message: "Execute a queued deployed agent run.",
								target: { runId: id, organizationId },
								auth: appAuth,
							}),
						),
					]);
				})(),
			]),
		);
	},
});
