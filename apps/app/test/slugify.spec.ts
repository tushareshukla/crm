import { describe, expect, it } from "bun:test";
import { workspaceSlug } from "@crm/db/workspace";
import { MAX_SLUG, slugDraft, slugify } from "../lib/slugify";

describe("slugify", () => {
	it("derives the address the API would, for a name that is not reserved", () => {
		for (const name of [
			"Acme Inc.",
			"Shopify ABM",
			"  Globex  Corporation ",
			"Café Müller",
			"a".repeat(60),
			"Deals & Co",
		]) {
			expect(slugify(name)).toBe(workspaceSlug(name));
		}
	});

	it("never exceeds the API's length", () => {
		expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(MAX_SLUG);
	});

	it("is empty for a name with nothing usable, so the form can say so", () => {
		expect(slugify("!!!")).toBe("");
		expect(slugify("")).toBe("");
	});
});

describe("slugDraft", () => {
	it("lets the rep keep typing a dash without it vanishing", () => {
		expect(slugDraft("acme-")).toBe("acme-");
		expect(slugDraft("Acme Inc")).toBe("acme-inc");
		expect(slugDraft("--acme")).toBe("acme");
		expect(slugDraft("acme---inc")).toBe("acme-inc");
	});
});
