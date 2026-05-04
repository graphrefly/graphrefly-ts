/**
 * Tests for `src/testing/assertions.ts` — Lock 3.B helper.
 */

import { describe, expect, it } from "vitest";
import type { Messages } from "../../core/messages.js";
import { COMPLETE, DATA, DIRTY, ERROR, RESOLVED, START } from "../../core/messages.js";
import { assertDirtyPrecedesTerminalData } from "../../testing/index.js";

describe("assertDirtyPrecedesTerminalData (Lock 3.B)", () => {
	it("accepts a typical wave: DIRTY then DATA", () => {
		const messages: Messages = [[DIRTY], [DATA, 1]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).not.toThrow();
	});

	it("accepts the P.25 carve-out: leading [RESOLVED] without DIRTY", () => {
		const messages: Messages = [[RESOLVED], [DIRTY], [DATA, 1]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).not.toThrow();
	});

	it("rejects DATA without a preceding DIRTY", () => {
		const messages: Messages = [[DATA, 1]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).toThrow(/P\.25/);
	});

	it("rejects RESOLVED that is not at the head", () => {
		const messages: Messages = [
			[DIRTY],
			[DATA, 1],
			// Mid-stream RESOLVED without a preceding DIRTY → violation.
			[RESOLVED],
		];
		expect(() => assertDirtyPrecedesTerminalData(messages)).toThrow(/P\.25/);
	});

	it("counts DIRTY/settlement balance correctly across multi-wave streams", () => {
		const messages: Messages = [[DIRTY], [DATA, 1], [DIRTY], [DATA, 2], [DIRTY], [RESOLVED]];
		expect(() => assertDirtyPrecedesTerminalData(messages)).not.toThrow();
	});

	it("rejects more settlements than DIRTYs", () => {
		const messages: Messages = [
			[DIRTY],
			[DATA, 1],
			[DATA, 2], // second DATA without a second DIRTY
		];
		expect(() => assertDirtyPrecedesTerminalData(messages)).toThrow(/P\.25/);
	});

	it("ignores ERROR / COMPLETE / START in the balance check", () => {
		const messages: Messages = [
			[START],
			[DIRTY],
			[DATA, 1],
			[ERROR, new Error("boom")],
			[COMPLETE],
		];
		expect(() => assertDirtyPrecedesTerminalData(messages)).not.toThrow();
	});

	it("error message includes a window of surrounding messages for diagnostics", () => {
		const messages: Messages = [[DIRTY], [DATA, 1], [DATA, 2], [DIRTY], [DATA, 3]];
		try {
			assertDirtyPrecedesTerminalData(messages);
			expect.fail("expected to throw");
		} catch (err) {
			expect((err as Error).message).toMatch(/Window:/);
			expect((err as Error).message).toMatch(/index 2/);
		}
	});
});
