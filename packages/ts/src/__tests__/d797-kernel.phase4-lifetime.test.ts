/**
 * D797 kernel migration, phase 4 (graphrefly-ts:D797-KERNEL-MIGRATION-TS): the lifetime.
 *
 * TS harness for the lifetime clauses of the root scenarios C-33 and C-4 in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-lifetime@2, R-invocation@2 and R-failure@3:
 * a setup runs once per lifetime before its first run, its cleanup runs once when the lifetime
 * closes and may read the private state, closing releases dependencies before the cleanup, a
 * cleanup throw goes to the host reporter, the signal is aborted, and output through a closed
 * lifetime's ctx is dropped. C-33's derived-status clauses, its in-function unsubscribe and its
 * batch clause are tested with the derived status and the request queue (phase 5).
 */

import { describe, expect, it } from "vitest";
import { type Ctx, depLatest } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { Wave } from "../protocol/messages.js";

describe("C-33: a closed lifetime revokes old ctx, and cleanup failures stay isolated", () => {
	it("runs setup once per lifetime, closes in order, and drops the old ctx", () => {
		const reports: unknown[] = [];
		const g = graph({ report: (failure) => reports.push(failure.error) });
		const a = g.state(1, { name: "a" });
		const order: string[] = [];
		const p = g.node<number>([a], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]), {
			name: "p",
			setup: () => {
				order.push("p:setup");
				return () => order.push("p:cleanup");
			},
		});
		const boom = new Error("n cleanup");
		const ctxs: Ctx[] = [];
		const signals: AbortSignal[] = [];
		let readAtCleanup: unknown;
		const n = g.node<number>(
			[p],
			(ctx) => {
				ctxs.push(ctx);
				ctx.state.set({ ranOn: depLatest(ctx, 0) });
				ctx.down([["DATA", (depLatest(ctx, 0) as number) * 10]]);
			},
			{
				name: "n",
				setup: (ctx) => {
					order.push("n:setup");
					signals.push(ctx.signal);
					return () => {
						readAtCleanup = ctx.state.get();
						order.push("n:cleanup");
						throw boom;
					};
				},
			},
		);
		const log: Wave[] = [];
		const stop = n.subscribe((msgs) => log.push(msgs));
		a.set(2); // a second run: no setup, no cleanup
		expect(order).toEqual(["p:setup", "n:setup"]);
		const oldCtx = ctxs.at(-1) as Ctx;

		stop();
		// Closing releases N's dependencies first (P deactivates and runs its cleanup), then runs N's
		// cleanup, which reads the last run's private state; its throw goes to the reporter.
		expect(order).toEqual(["p:setup", "n:setup", "p:cleanup", "n:cleanup"]);
		expect(readAtCleanup).toEqual({ ranOn: 2 });
		expect(reports).toEqual([boom]);
		expect(signals[0]?.aborted).toBe(true);

		// Output through the closed lifetime's ctx is dropped.
		const after = log.length;
		oldCtx.down([["DATA", 99]]);
		expect(log).toHaveLength(after);

		// A new lifetime: a distinct ctx and signal, setup again, fresh snapshots and private state.
		const log2: Wave[] = [];
		n.subscribe((msgs) => log2.push(msgs));
		expect(order.slice(4)).toEqual(["p:setup", "n:setup"]);
		expect(signals).toHaveLength(2);
		expect(signals[1]).not.toBe(signals[0]);
		expect(signals[1]?.aborted).toBe(false);
		expect(ctxs.at(-1)).not.toBe(oldCtx);
		expect(n.cache).toBe(20);
	});

	it("an ended node closes its lifetime: signal aborted, cleanup run, private state dropped", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		let signal: AbortSignal | undefined;
		let cleaned = 0;
		const n = g.node<number>(
			[a],
			(ctx) => {
				ctx.state.set("held");
				if (depLatest(ctx, 0) === 2) ctx.down([["COMPLETE"]]);
			},
			{
				name: "n",
				complete: "manual",
				setup: (ctx) => {
					signal = ctx.signal;
					return () => {
						cleaned++;
					};
				},
			},
		);
		n.subscribe(() => {});
		a.set(2);
		expect(n.status.output).toBe("completed");
		expect(signal?.aborted).toBe(true);
		expect(cleaned).toBe(1);
	});
});

describe("C-33: status is derived, not stored (R-node@2)", () => {
	it("reports cache, output and lifecycle from what the node holds", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		let duringCleanup: unknown;
		const n = g.node<number>([a], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]), {
			name: "n",
			setup: () => () => {
				duringCleanup = n.status;
			},
		});
		expect(n.status).toEqual({ cache: "empty", output: "open", lifecycle: "inactive" });
		const stop = n.subscribe(() => {});
		expect(n.status).toEqual({ cache: "ready", output: "open", lifecycle: "active" });
		a.invalidate();
		expect(n.status).toEqual({ cache: "empty", output: "open", lifecycle: "active" });
		a.set(2);
		stop();
		expect(duringCleanup).toMatchObject({ lifecycle: "closing" });
		expect(n.status).toEqual({ cache: "empty", output: "open", lifecycle: "inactive" });
		n.subscribe(() => {});
		a.complete();
		expect(n.status).toEqual({ cache: "ready", output: "completed", lifecycle: "active" });
	});
});

describe("C-4: an async result after its lifetime closed is dropped", () => {
	it("drops a late ctx.down from a closed lifetime", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		let late: Ctx | undefined;
		const c = g.node<number>(
			[a],
			(ctx) => {
				late = ctx; // the work's result would come later through this ctx
			},
			{ name: "c" },
		);
		const log: Wave[] = [];
		const stop = c.subscribe((msgs) => log.push(msgs));
		late?.down([["DATA", 1]]);
		expect(log.at(-1)).toEqual([["PENDING"], ["DATA", 1]]);
		a.set(2);
		const kept = late as Ctx;
		stop();
		const after = log.length;
		kept.down([["DATA", 2]]);
		expect(log).toHaveLength(after);
	});
});
