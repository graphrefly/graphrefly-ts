import { describe, expect, it } from "vitest";
import type { Message, Wave } from "../index.js";
import { assertDirtyPrecedesTerminalData, node } from "../index.js";

describe("testing assertions", () => {
	it("accepts a normal DIRTY then DATA wave (R-dirty-before-data)", () => {
		const messages: Wave[] = [[["DIRTY"], ["DATA", 1]]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).not.toThrow();
	});

	it("accepts multiple DATA occurrences covered by one DIRTY in the same wave (D49)", () => {
		const messages: Wave[] = [[["DIRTY"], ["DATA", 1], ["DATA", 1]]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).not.toThrow();
	});

	it("accepts START handshake DATA/replay without a preceding DIRTY", () => {
		const s = node<number>([], null, { initial: 5 });
		const flat: Message[] = [];
		const unsubscribe = s.subscribe((msg) => flat.push(msg));
		unsubscribe();

		expect(flat).toEqual([["START"], ["DATA", 5]]);
		const messages: Wave[] = [flat];
		expect(() => assertDirtyPrecedesTerminalData(messages)).not.toThrow();
	});

	it("rejects RESOLVED in a START handshake wave", () => {
		const messages: Wave[] = [[["START"], ["RESOLVED"]]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).toThrow(/wave 0, index 1/);
	});

	it("rejects DATA without a preceding DIRTY outside the START handshake", () => {
		const messages: Wave[] = [[["DATA", 1]]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).toThrow(/R-dirty-before-data/);
	});

	it("rejects a later wave DATA even when the previous wave had DIRTY", () => {
		const messages: Wave[] = [[["DIRTY"], ["DATA", 1]], [["DATA", 2]]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).toThrow(/wave 1, index 0/);
	});

	it("rejects RESOLVED without a preceding DIRTY outside the START handshake", () => {
		const messages: Wave[] = [[["DIRTY"], ["DATA", 1], ["COMPLETE"], ["RESOLVED"]]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).toThrow(/index 3/);
	});

	it("reports the wave for diagnostics", () => {
		const messages: Wave[] = [[["DIRTY"], ["DATA", 1], ["COMPLETE"], ["DATA", 2]]];
		try {
			assertDirtyPrecedesTerminalData(messages);
			expect.fail("expected assertion to throw");
		} catch (error) {
			expect((error as Error).message).toMatch(/Wave:/);
			expect((error as Error).message).toMatch(/-> \[DATA\]/);
		}
	});
});
