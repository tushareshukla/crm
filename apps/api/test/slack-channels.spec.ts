import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SlackChannelsService } from "../src/slack/slack-channels.service";
import { inTenant, TEST_ORG } from "./tenant";

/** The service names the organization on every call, so it runs in tenant scope. */
const service = {
	create: (name: string, isPrivate: boolean) =>
		inTenant(TEST_ORG.id, () =>
			new SlackChannelsService().create(name, isPrivate),
		),
};
const realFetch = globalThis.fetch;
const realSecret = process.env.AGENT_BRIDGE_SECRET;

let lastRequest: { url: string; init?: RequestInit } | null = null;

function agentAnswers(status: number, body: string | null) {
	globalThis.fetch = (async (
		url: string | URL | Request,
		init?: RequestInit,
	) => {
		lastRequest = { url: String(url), init };

		return new Response(body, {
			status,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
}

beforeEach(() => {
	lastRequest = null;
	process.env.AGENT_BRIDGE_SECRET = "slack-channel-test";
});

afterEach(() => {
	globalThis.fetch = realFetch;
	if (realSecret === undefined) {
		delete process.env.AGENT_BRIDGE_SECRET;
	} else {
		process.env.AGENT_BRIDGE_SECRET = realSecret;
	}
});

describe("creating a Slack channel", () => {
	it("returns the channel the agent created", async () => {
		agentAnswers(200, JSON.stringify({ channel: { id: "C1", name: "deals" } }));

		expect(await service.create("deals", false)).toEqual({
			channel: { id: "C1", name: "deals" },
		});
	});

	it("names the organization on the call to the agent", async () => {
		agentAnswers(200, JSON.stringify({ channel: { id: "C1", name: "deals" } }));

		await service.create("deals", false);

		const headers = new Headers(lastRequest?.init?.headers);
		expect(headers.get("x-organization-id")).toBe(TEST_ORG.id);
		expect(JSON.parse(String(lastRequest?.init?.body))).toMatchObject({
			organizationId: TEST_ORG.id,
			channelName: "deals",
		});
	});

	it("reports an agent outage as an outage, not as a bad request", async () => {
		agentAnswers(502, "<html>Bad Gateway</html>");

		await expect(service.create("deals", false)).rejects.toThrow(
			"The agent failed, so the channel was not created.",
		);
	});

	it("reports an unreadable answer as an outage", async () => {
		agentAnswers(200, "not json at all");

		await expect(service.create("deals", false)).rejects.toThrow(
			"The agent answered with something unreadable, so the channel was not created.",
		);
	});

	it("tells the caller what Slack refused", async () => {
		agentAnswers(422, JSON.stringify({ error: "That name is taken." }));

		await expect(service.create("deals", false)).rejects.toThrow(
			"That name is taken.",
		);
	});

	it("says nothing can reach Slack without a bridge secret", async () => {
		delete process.env.AGENT_BRIDGE_SECRET;

		await expect(service.create("deals", false)).rejects.toThrow(
			"This install has no AGENT_BRIDGE_SECRET, so nothing can reach Slack.",
		);
	});
});
