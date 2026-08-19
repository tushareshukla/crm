import { describe, expect, it } from "bun:test";
import { apiUrl } from "../src/env";
import {
	canConfigureSso,
	ssoCallbackBase,
	ssoCallbackURL,
	ssoProviderName,
} from "../src/sso";

// `apiUrl` is fixed when src/env is first evaluated, and other specs in this
// run load it (through src/auth) before this file does — so the expectations
// are pinned to the resolved API origin rather than to a value set here.
const origin = new URL(apiUrl).origin;

describe("canConfigureSso", () => {
	it("is the same answer as renaming the workspace", () => {
		expect(canConfigureSso("owner")).toBe(true);
		expect(canConfigureSso("admin")).toBe(true);
		expect(canConfigureSso("member")).toBe(false);
		expect(canConfigureSso(null)).toBe(false);
	});
});

describe("ssoCallbackURL", () => {
	it("is the API origin plus the path better-auth mounts the callback on", () => {
		expect(ssoCallbackURL("okta")).toBe(`${origin}/api/auth/sso/callback/okta`);
	});

	it("hangs off the base the settings page shows", () => {
		expect(ssoCallbackBase()).toBe(`${origin}/api/auth/sso/callback`);
		expect(ssoCallbackURL("okta").startsWith(`${ssoCallbackBase()}/`)).toBe(
			true,
		);
	});
});

describe("ssoProviderName", () => {
	it("reads as a button on the sign-in page", () => {
		expect(ssoProviderName("okta")).toBe("Okta");
		expect(ssoProviderName("entra-id")).toBe("Entra Id");
		expect(ssoProviderName("jump_cloud")).toBe("Jump Cloud");
	});

	it("leaves an acronym alone", () => {
		expect(ssoProviderName("ADFS")).toBe("ADFS");
	});
});
