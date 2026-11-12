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

		t.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});

		expect(onError).toHaveBeenCalledOnce();
		expect(onError).toHaveBeenCalledWith(err);
		expect(msgs).toContainEqual(["ERROR", err]);
		expect(msgs.at(-1)).toEqual(["ERROR", err]);
		expect(t.status.output).toBe("errored");
	});
});

describe("observe terminal egress (Worker C)", () => {
	it("observe() sees terminal events at whole-graph scope", () => {
		const g = graph();
		const err = new Error("whole graph boom");
		g.initNode(fromIter([1]), [], { name: "done" });
		g.initNode(throwError(err), [], { name: "failed" });
		const events: ObserveEvent[] = [];

		g.observe(
			g.describe().map((n) => n.id),
			(e) => events.push(e),
		);

		const msgs = (id: string) => events.filter((e) => e.id === id).flatMap((e) => e.msgs);
		expect(msgs("done")).toContainEqual(["COMPLETE"]);
		expect(msgs("failed")).toContainEqual(["ERROR", err]);
		expect(new Set(events.map((e) => e.id))).toEqual(new Set(["done", "failed"]));
	});
});
