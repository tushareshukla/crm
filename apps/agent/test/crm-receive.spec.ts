/**
 * The crm channel's `receive` is where dispatch hands in builder chats and
 * deployed runs from outside any tenant: it must be told which organization
 * the work belongs to.
 */
import { describe, expect, it } from "bun:test";
import crm from "../agent/channels/crm";
import { APP_AUTH } from "../agent/lib/app-auth";

const receive = crm.receive as NonNullable<typeof crm.receive>;

const never = (async () => {
	throw new Error("send should not have been called");
}) as never;

describe("crm.receive", () => {
	it("refuses a builder chat that names no organization", async () => {
		await expect(
			receive(
				{
					message: "",
					target: { builderSubmissionId: "sub_1" },
					auth: APP_AUTH,
				},
				{ send: never },
			),
		).rejects.toThrow(/names no organization/);
	});

	it("refuses a deployed run that names no organization", async () => {
		await expect(
			receive(
				{ message: "", target: { runId: "run_1" }, auth: APP_AUTH },
				{ send: never },
			),
		).rejects.toThrow(/names no organization/);
	});

	it("still refuses internal dispatch from anyone but the app, before looking at the organization", async () => {
		await expect(
			receive(
				{
					message: "",
					target: { runId: "run_1", organizationId: "org_a" },
					auth: { ...APP_AUTH, principalId: "somebody" },
				},
				{ send: never },
			),
		).rejects.toThrow(/Eve app authentication/);
	});
});
