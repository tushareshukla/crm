import { describe, expect, it } from "bun:test";
import {
	isReservedRoute,
	ORG_SLUG_HEADER,
	orgSlugFromPathname,
	orgSlugHeaders,
	RESERVED_ROUTES,
} from "../lib/org-slug";

describe("orgSlugFromPathname", () => {
	it("takes the first segment as the organization", () => {
		expect(orgSlugFromPathname("/acme")).toBe("acme");
		expect(orgSlugFromPathname("/acme/")).toBe("acme");
		expect(orgSlugFromPathname("/acme/settings/members")).toBe("acme");
		expect(orgSlugFromPathname("/shopify-abm/contacts/c_1")).toBe(
			"shopify-abm",
		);
	});

	it("knows the app's own routes can never be an organization", () => {
		for (const route of [
			"sign-in",
			"admin",
			"invite",
			"welcome",
			"onboarding",
			"api",
			"t",
			"eve",
			"grant-access",
			"_next",
		]) {
			expect(RESERVED_ROUTES).toContain(route);
			expect(isReservedRoute(route)).toBe(true);
			expect(orgSlugFromPathname(`/${route}`)).toBeNull();
			expect(orgSlugFromPathname(`/${route}/anything`)).toBeNull();
		}
	});

	it("treats the section paths from before the slug as reserved too", () => {
		expect(orgSlugFromPathname("/companies")).toBeNull();
		expect(orgSlugFromPathname("/settings/members")).toBeNull();
		expect(orgSlugFromPathname("/chat")).toBeNull();
	});

	it("is null for the root and for anything that is not a slug", () => {
		expect(orgSlugFromPathname("/")).toBeNull();
		expect(orgSlugFromPathname("")).toBeNull();
		expect(orgSlugFromPathname("/Acme%20Inc")).toBeNull();
		expect(orgSlugFromPathname("/-acme")).toBeNull();
		expect(orgSlugFromPathname("/acme--inc")).toBeNull();
		expect(orgSlugFromPathname("/acme_inc")).toBeNull();
	});

	it("lowercases, since the API compares slugs lowercase", () => {
		expect(orgSlugFromPathname("/Acme")).toBe("acme");
		expect(orgSlugFromPathname("/ADMIN")).toBeNull();
	});
});

describe("orgSlugHeaders", () => {
	it("names the organization on organization pages", () => {
		expect(orgSlugHeaders("/acme/deals")).toEqual({
			[ORG_SLUG_HEADER]: "acme",
		});
		expect(ORG_SLUG_HEADER).toBe("x-org-slug");
	});

	it("sends nothing from the app's own routes, so the API falls back to the session", () => {
		expect(orgSlugHeaders("/admin")).toEqual({});
		expect(orgSlugHeaders("/invite/inv_1")).toEqual({});
		expect(orgSlugHeaders("/sign-in")).toEqual({});
		expect(orgSlugHeaders("/")).toEqual({});
	});
});
