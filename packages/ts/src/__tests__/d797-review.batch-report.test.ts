/**
 * REVIEW-D797-migration-fable 2.19 (R-failure@3, R-request-order@2): a batch whose commit is a
 * queued request (the body ran during a wave) reports a failing commit to the graph's host reporter;
 * nothing of the batch commits.
 */

import { describe, expect, it } from "vitest";
import { graph, type Message } from "../index.js";

const values = (msgs: readonly Message[]) => msgs.filter((m) => m[0] === "DATA").map((m) => m[1]);

describe("queued batch commit failure (D797 review)", () => {
	it("goes to the host reporter and commits nothing", () => {
		const reports: { source: string; error: unknown }[] = [];
		const g = graph({ report: (f) => reports.push(f) });
		const t = g.state(0, { name: "t" });
		const a = g.state(0, { name: "a" });
		const b = g.state(0, { name: "b" });
		const seen: unknown[] = [];
		a.subscribe((msgs) => seen.push(...values(msgs)));
		seen.length = 0;
		t.subscribe((msgs) => {
			if (!values(msgs).includes(1)) return;
			// During t's wave: the body runs now and its commit is a queued request.
			g.batch(() => {
				a.set(5);
				b.set(() => {
					throw new Error("write fn failed");
				});
			});
		});
		expect(() => t.set(1)).not.toThrow();
		expect(reports.map((r) => String(r.error))).toEqual(["Error: write fn failed"]);
		expect(a.cache).toBe(0);
		expect(seen).toEqual([]);
	});
});
