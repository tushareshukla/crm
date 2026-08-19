import { db, tenantIdOrNull } from "@crm/db";
import {
	type AgentModelSetting,
	DEFAULT_AGENT_MODEL,
	readAgentModel,
} from "@crm/db/settings";
import { resolveOrgSetting } from "./tenant";

export interface ModelSelection {
	model: string;
	modelContextWindowTokens: number;
}

/**
 * The model an organization's sessions run on: what its members chose in
 * Settings → General (AppSetting), else what a platform admin set on the
 * organization (`Organization.settings.agentModelId`), else the platform
 * default. Outside any tenant there is only the platform default.
 */
export async function resolvedModel(): Promise<AgentModelSetting> {
	if (!tenantIdOrNull()) return { ...DEFAULT_AGENT_MODEL, isDefault: true };

	const setting = await readAgentModel(db);
	if (!setting.isDefault) return setting;

	const override = await resolveOrgSetting("agentModelId");
	if (!override) return setting;

	const window = Number(await resolveOrgSetting("agentModelContextWindow"));
	return {
		id: override,
		contextWindowTokens:
			Number.isFinite(window) && window > 0
				? window
				: DEFAULT_AGENT_MODEL.contextWindowTokens,
		isDefault: false,
	};
}

/** The dynamic model for a session, or `null` to let eve use its fallback. */
export async function selectedModel(): Promise<ModelSelection | null> {
	try {
		const setting = await resolvedModel();

		if (setting.isDefault) return null;

		return {
			model: setting.id,
			modelContextWindowTokens: setting.contextWindowTokens,
		};
	} catch (error) {
		console.error(
			`[agent] could not read the configured model, falling back: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return null;
	}
}
