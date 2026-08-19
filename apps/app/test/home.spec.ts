import { describe, expect, it } from "bun:test";
import {
	ADMIN_PATH,
	homePath,
	lastUsedSlug,
	safeNextPath,
	signInPath,
	WELCOME_PATH,
} from "../lib/home";

describe("homePath", () => {
	it("opens the most recently used organization", () => {
		expect(
			homePath({
				platformAdmin: false,
				organizations: [{ slug: "globex" }, { slug: "acme" }],
			}),
		).toBe("/globex");
	});

	it("skips a suspended organization when an open one exists", () => {
		expect(
			homePath({
				platformAdmin: false,
				organizations: [
					{ slug: "globex", status: "SUSPENDED" },
					{ slug: "acme", status: "ACTIVE" },
				],
			}),
		).toBe("/acme");
	});

	it("sends a platform admin with no organization to the console", () => {
		expect(homePath({ platformAdmin: true, organizations: [] })).toBe(
			ADMIN_PATH,
		);
	});

	it("prefers an organization over the console for a platform admin who has one", () => {
		expect(
			homePath({ platformAdmin: true, organizations: [{ slug: "acme" }] }),
		).toBe("/acme");
	});

	it("welcomes everyone else who belongs nowhere", () => {
		expect(homePath({ platformAdmin: false, organizations: [] })).toBe(
			WELCOME_PATH,
		);
	});

	it("shows the suspended organization when that is all there is", () => {
		expect(
			homePath({
				platformAdmin: false,
				organizations: [{ slug: "acme", status: "SUSPENDED" }],
			}),
		).toBe("/acme");
		expect(
			homePath({
				platformAdmin: true,
				organizations: [{ slug: "acme", status: "SUSPENDED" }],
			}),
		).toBe(ADMIN_PATH);
	});
});

describe("lastUsedSlug", () => {
	it("is the first open organization, else the first at all, else nothing", () => {
		expect(lastUsedSlug([{ slug: "a" }, { slug: "b" }])).toBe("a");
		expect(
			lastUsedSlug([{ slug: "a", status: "SUSPENDED" }, { slug: "b" }]),
		).toBe("b");
		expect(lastUsedSlug([{ slug: "a", status: "SUSPENDED" }])).toBe("a");
		expect(lastUsedSlug([])).toBeNull();
	});
});

describe("safeNextPath", () => {
	it("keeps a path on this app", () => {
		expect(safeNextPath("/invite/inv_1")).toBe("/invite/inv_1");
		expect(safeNextPath("/acme/deals?stage=won")).toBe("/acme/deals?stage=won");
	});

	it("refuses anything that could leave the app", () => {
		expect(safeNextPath("https://evil.example/")).toBeNull();
		expect(safeNextPath("//evil.example")).toBeNull();
		expect(safeNextPath("/\\evil.example")).toBeNull();
		expect(safeNextPath("javascript:alert(1)")).toBeNull();
		expect(safeNextPath("acme")).toBeNull();
	});

	it("drops the defaults, which need no remembering", () => {
		expect(safeNextPath("/")).toBeNull();
		expect(safeNextPath("/sign-in")).toBeNull();
		expect(safeNextPath("/sign-in?next=%2Fx")).toBeNull();
		expect(safeNextPath("")).toBeNull();
		expect(safeNextPath(null)).toBeNull();
		expect(safeNextPath(undefined)).toBeNull();
	});
});

describe("signInPath", () => {
	it("remembers where to come back to", () => {
		expect(signInPath("/invite/inv_1")).toBe("/sign-in?next=%2Finvite%2Finv_1");
	});

	it("is plain when there is nothing worth remembering", () => {
		expect(signInPath()).toBe("/sign-in");
		expect(signInPath("/")).toBe("/sign-in");
		expect(signInPath("https://evil.example")).toBe("/sign-in");
	});
});
