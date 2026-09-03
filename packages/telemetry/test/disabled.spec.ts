import { describe, expect, it } from "bun:test";
import {
	DISABLE_VARIABLES,
	ENABLE_VARIABLE,
	telemetryDisabled,
} from "../src/disabled";

describe("telemetryDisabled", () => {
	it("is on by default in this fork, so a bare deploy sends nothing", () => {
		expect(telemetryDisabled({})).toBe(true);
	});

	it("sends nothing from a test run, whatever else is set", () => {
		expect(telemetryDisabled({ NODE_ENV: "test" })).toBe(true);
		expect(
			telemetryDisabled({ NODE_ENV: "test", [ENABLE_VARIABLE]: "1" }),
		).toBe(true);
	});

	it("lets an explicit opt-in turn it back on", () => {
		expect(telemetryDisabled({ [ENABLE_VARIABLE]: "1" })).toBe(false);
	});

	it("honours CRM_TELEMETRY_DISABLED even against the opt-in", () => {
		expect(telemetryDisabled({ CRM_TELEMETRY_DISABLED: "1" })).toBe(true);
		expect(
			telemetryDisabled({
				[ENABLE_VARIABLE]: "1",
				CRM_TELEMETRY_DISABLED: "1",
			}),
		).toBe(true);
	});

	it("honours DO_NOT_TRACK even against the opt-in", () => {
		expect(telemetryDisabled({ DO_NOT_TRACK: "1" })).toBe(true);
		expect(
			telemetryDisabled({ [ENABLE_VARIABLE]: "1", DO_NOT_TRACK: "1" }),
		).toBe(true);
	});

	it("takes any of the obvious ways to say yes", () => {
		for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
			expect(telemetryDisabled({ DO_NOT_TRACK: value })).toBe(true);
			expect(telemetryDisabled({ [ENABLE_VARIABLE]: value })).toBe(false);
		}
	});

	it("does not read an empty or negative value as a yes", () => {
		for (const value of ["", " ", "0", "false", "no"]) {
			expect(
				telemetryDisabled({
					[ENABLE_VARIABLE]: "1",
					CRM_TELEMETRY_DISABLED: value,
				}),
			).toBe(false);
			expect(telemetryDisabled({ [ENABLE_VARIABLE]: value })).toBe(true);
		}
	});

	it("names every variable so the docs and the code cannot drift", () => {
		expect(DISABLE_VARIABLES).toEqual([
			"CRM_TELEMETRY_DISABLED",
			"DO_NOT_TRACK",
		]);
		expect(ENABLE_VARIABLE).toBe("CRM_TELEMETRY_ENABLED");
	});
});
