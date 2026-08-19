import { agentError, modelError } from "@crm/telemetry";
import { defineHook } from "eve/hooks";
import { z } from "zod";
import { resolvedModel } from "../lib/model";
import {
	inSessionTenant,
	sessionOrganizationId,
	type TenantContext,
} from "../lib/tenant";

type SessionPrincipal = {
	readonly attributes?: Readonly<Record<string, string | readonly string[]>>;
} | null;

const attributeText = z.string().trim().min(1).nullable().catch(null);

/** The model each organization runs on, remembered per organization (the platform default when a session names none). */
const modelIds = new Map<string, string>();

async function configuredModel(ctx: TenantContext): Promise<string | null> {
	const organizationId = sessionOrganizationId(ctx) ?? "";
	const known = modelIds.get(organizationId);
	if (known) return known;

	try {
		const id = (await inSessionTenant(ctx, resolvedModel)).id;
		modelIds.set(organizationId, id);
		return id;
	} catch {
		return null;
	}
}

const MODEL_CODES = [
	"model",
	"gateway",
	"provider",
	"rate_limit",
	"context_length",
	"overloaded",
	"unauthorized",
];

function taskKind(auth: SessionPrincipal): string | null {
	return attributeText.parse(auth?.attributes?.taskKind);
}

function looksLikeModel(code: string): boolean {
	const lowered = code.toLowerCase();
	return MODEL_CODES.some((marker) => lowered.includes(marker));
}

export default defineHook({
	events: {
		"action.result"(event, ctx) {
			const { error, result, status } = event.data;
			if (status === "completed") return;

			agentError({
				error: error ?? status,
				tool: "toolName" in result ? result.toolName : null,
				taskKind: taskKind(ctx.session.auth.current ?? null),
				source: "tool",
			});
		},

		"turn.failed"(event, ctx) {
			agentError({
				error: event.data.code,
				taskKind: taskKind(ctx.session.auth.current ?? null),
				source: "turn",
			});
		},

		"session.failed"(event, ctx) {
			agentError({
				error: event.data.code,
				taskKind: taskKind(ctx.session.auth.current ?? null),
				source: "session",
			});
		},

		async "step.failed"(event, ctx) {
			if (!looksLikeModel(event.data.code)) return;

			modelError({
				error: event.data.code,
				modelId: await configuredModel(ctx),
			});
		},
	},
});
