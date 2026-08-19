import "@crm/env/load";

import { DEFAULT_AGENT_MODEL } from "@crm/db/settings";
import { onTelemetryProblem, syncVersion } from "@crm/telemetry";
import { defineAgent, defineDynamic } from "eve";
import { logPlatformCapabilities } from "./lib/capabilities";
import { selectedModel } from "./lib/model";
import { inSessionTenant } from "./lib/tenant";

// Startup is platform-level: no organization yet, so only the environment is read.
logPlatformCapabilities();

onTelemetryProblem((message) => console.debug(`[telemetry] ${message}`));

void syncVersion();

export default defineAgent({
	model: defineDynamic({
		fallback: DEFAULT_AGENT_MODEL.id,
		events: {
			// The model is an organization's setting: read it inside the session's tenant.
			"session.started": (_event, ctx) => inSessionTenant(ctx, selectedModel),
		},
	}),
	limits: {
		maxInputTokensPerSession: 500_000,
		maxOutputTokensPerSession: 50_000,
		sessionTimeoutMs: 30 * 24 * 60 * 60 * 1000,
	},
});
