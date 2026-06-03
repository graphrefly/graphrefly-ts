import { describe, expect, it, vi } from "vitest";
import type { Message, ObserveEvent } from "../index.js";
import { fromIter, graph, tap, throwError } from "../index.js";

describe("tap observer terminal edges (Worker C)", () => {
	it("tap({ error }) observes an upstream ERROR and forwards the ERROR unchanged", () => {
		const g = graph();
		const err = new Error("boom");
		const src = g.initNode(throwError(err), [], { name: "src" });
		const onError = vi.fn();
		const t = g.initNode(tap<never>({ error: onError }), [src], { name: "tap" });
		const msgs: Message[] = [];

		t.subscribe((m) => msgs.push(m));

		expect(onError).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(err);
		expect(msgs).toContainEqual(["ERROR", err]);
		expect(msgs.at(-1)).toEqual(["ERROR", err]);
		expect(t.status).toBe("errored");
	});
});

describe("observe terminal egress (Worker C)", () => {
	it("observe() sees terminal events at whole-graph scope", () => {
		const g = graph();
		const err = new Error("whole graph boom");
		g.initNode(fromIter([1]), [], { name: "done" });
		g.initNode(throwError(err), [], { name: "failed" });
		const events: ObserveEvent[] = [];

		g.observe().subscribe((e) => events.push(e));

		expect(events).toContainEqual(
			expect.objectContaining({ path: "done", msg: ["COMPLETE"], tier: 5 }),
		);
		expect(events).toContainEqual(
			expect.objectContaining({ path: "failed", msg: ["ERROR", err], tier: 5 }),
		);
		expect(new Set(events.map((e) => e.path))).toEqual(new Set(["done", "failed"]));
	});
});
