import { describe, expect, it } from "vitest";
import type { Message, Wave } from "../index.js";
import { assertPendingPrecedesTerminalData, node } from "../index.js";

describe("testing assertions", () => {
	it("accepts a normal PENDING then DATA wave (R-dirty-before-data)", () => {
		const messages: Wave[] = [[["PENDING"], ["DATA", 1]]];
		expect(() => assertPendingPrecedesTerminalData(messages)).not.toThrow();
	});

	it("accepts multiple DATA occurrences covered by one PENDING in the same wave (D49)", () => {
		const messages: Wave[] = [[["PENDING"], ["DATA", 1], ["DATA", 1]]];
		expect(() => assertPendingPrecedesTerminalData(messages)).not.toThrow();
	});

	it("accepts START handshake DATA/replay without a preceding PENDING", () => {
		const s = node<number>([], null, { initial: 5 });
		const flat: Message[] = [];
		const unsubscribe = s.subscribe((incoming) => {
			for (const msg of incoming) {
				flat.push(msg);
			}
		});
		unsubscribe();

		expect(flat).toEqual([["START"], ["DATA", 5]]);
		const messages: Wave[] = [flat];
		expect(() => assertPendingPrecedesTerminalData(messages)).not.toThrow();
	});

	it("rejects RESOLVED in a START handshake wave", () => {
		const messages: Wave[] = [[["START"], ["RESOLVED"]]];
		expect(() => assertPendingPrecedesTerminalData(messages)).toThrow(/wave 0, index 1/);
	});

	it("rejects DATA without a preceding PENDING outside the START handshake", () => {
		const messages: Wave[] = [[["DATA", 1]]];
		expect(() => assertPendingPrecedesTerminalData(messages)).toThrow(/R-dirty-before-data/);
	});

	it("rejects a later wave DATA even when the previous wave had PENDING", () => {
		const messages: Wave[] = [[["PENDING"], ["DATA", 1]], [["DATA", 2]]];
		expect(() => assertPendingPrecedesTerminalData(messages)).toThrow(/wave 1, index 0/);
	});

	it("rejects RESOLVED without a preceding PENDING outside the START handshake", () => {
		const messages: Wave[] = [[["PENDING"], ["DATA", 1], ["COMPLETE"], ["RESOLVED"]]];
		expect(() => assertPendingPrecedesTerminalData(messages)).toThrow(/index 3/);
	});

	it("reports the wave for diagnostics", () => {
		const messages: Wave[] = [[["PENDING"], ["DATA", 1], ["COMPLETE"], ["DATA", 2]]];
		try {
			assertPendingPrecedesTerminalData(messages);
			expect.fail("expected assertion to throw");
		} catch (error) {
			expect((error as Error).message).toMatch(/Wave:/);
			expect((error as Error).message).toMatch(/-> \[DATA\]/);
		}
	});
});
