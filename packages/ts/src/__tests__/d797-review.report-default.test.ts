/**
 * The user's Q9 (graphrefly-ts:D181, R-failure@3): a failure with no caller goes to the graph's
 * host reporter only; with no reporter it goes to console.error. Nothing is re-thrown to an
 * unrelated caller.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { graph, type Message } from "../index.js";

const values = (msgs: readonly Message[]) => msgs.filter((m) => m[0] === "DATA").map((m) => m[1]);

function failingQueuedRequest(report?: (f: { source: string; error: unknown }) => void) {
	const g = graph(report === undefined ? {} : { report });
	const t = g.state(0, { name: "t" });
	const s = g.state(0, { name: "s" });
	t.subscribe((msgs) => {
		if (values(msgs).includes(1))
			s.set(() => {
				throw new Error("queued write failed");
			});
	});
	t.subscribe(() => {
		throw new Error("sink failed");
	});
	return { t };
}

describe("failure reporting default (Q9)", () => {
	afterEach(() => vi.restoreAllMocks());

	it("with no reporter, failures go to console.error and nothing is re-thrown", () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const { t } = failingQueuedRequest();
		errors.mockClear();
		expect(() => t.set(1)).not.toThrow();
		const text = errors.mock.calls.map((c) => c.map(String).join(" "));
		expect(
			text.some((l) => l.includes("queued request") && l.includes("queued write failed")),
		).toBe(true);
		expect(text.some((l) => l.includes("sink of") && l.includes("sink failed"))).toBe(true);
	});

	it("with a reporter, failures go only to the reporter", () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const reports: { source: string; error: unknown }[] = [];
		const { t } = failingQueuedRequest((f) => reports.push(f));
		reports.length = 0;
		t.set(1);
		expect(reports.map((r) => r.source.replace(/^sink of .*/, "sink")).sort()).toEqual([
			"queued request",
			"sink",
		]);
		expect(errors).not.toHaveBeenCalled();
	});
});
