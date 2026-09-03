import { describe, expect, it } from "bun:test";
import { ANALYTICS_HOSTS, analyticsAllowed } from "../lib/analytics";

describe("analyticsAllowed", () => {
	it("allows nothing, because this fork ships browser analytics off", () => {
		expect(ANALYTICS_HOSTS).toEqual([]);
	});

	it("refuses every host, so posthog-js is never loaded", () => {
		for (const host of [
			"trycrm.ai",
			"www.trycrm.ai",
			" TryCRM.ai ",
			"crm.acme.com",
			"localhost",
			"crm-git-lewis-telemetry.vercel.app",
		]) {
			expect(analyticsAllowed(host)).toBe(false);
		}
	});

	it("still refuses a look-alike host if somebody re-enables one", () => {
		expect(analyticsAllowed("evil-trycrm.ai")).toBe(false);
		expect(analyticsAllowed("trycrm.ai.attacker.com")).toBe(false);
	});
});
