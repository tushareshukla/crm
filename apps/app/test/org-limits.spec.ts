import { describe, expect, it } from "bun:test";
import { parseLimit } from "../lib/org-limits";

describe("parseLimit", () => {
	it("reads blank as the platform default", () => {
		expect(parseLimit("", 1)).toEqual({ ok: true, value: null });
		expect(parseLimit("   ", 0)).toEqual({ ok: true, value: null });
	});

	it("accepts whole numbers at or above the floor", () => {
		expect(parseLimit("25", 1)).toEqual({ ok: true, value: 25 });
		expect(parseLimit(" 0 ", 0)).toEqual({ ok: true, value: 0 });
	});

	it("refuses everything else", () => {
		expect(parseLimit("0", 1)).toEqual({ ok: false });
		expect(parseLimit("-3", 0)).toEqual({ ok: false });
		expect(parseLimit("2.5", 0)).toEqual({ ok: false });
		expect(parseLimit("many", 0)).toEqual({ ok: false });
	});
});
