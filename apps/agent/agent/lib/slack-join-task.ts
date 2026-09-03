import type { Prisma } from "@crm/db";
import { parse, schemas } from "@crm/validation";
import { joinSlackChannel } from "./slack-membership";

export async function runSlackChannelJoin(
	value: Prisma.JsonValue,
): Promise<string> {
	const { channelId, channelName } = parse(
		schemas.slack.joinPayload,
		value,
		"A slack-channel-join task carries an unreadable payload",
	);
	const outcome = await joinSlackChannel(channelId);

	if (outcome.joined) {
		return outcome.already
			? `ribeu was already in #${channelName}.`
			: `ribeu joined #${channelName}.`;
	}

	return `ribeu could not join #${channelName}. ${outcome.reason}`;
}
