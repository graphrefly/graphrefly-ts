/**
 * graphrefly-ts Q15 (the user's decision): node activation, pending marking, wave delivery and
 * teardown run on explicit work stacks, not JS recursion, so a chain far deeper than the JS stack
 * works. Each case builds a 5,000-node chain; the order each case checks is the ordinary order
 * R-wave@2, R-subscription@3 and R-lifetime@2 give a short chain.
 */

import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { Wave } from "../protocol/messages.js";

const DEPTH = 5000;

/** A sink that records every array it receives. */
function arrays(): { log: Wave[]; sink: (msgs: Wave) => void } {
	const log: Wave[] = [];
	return { log, sink: (msgs) => log.push(msgs) };
}

/** Each case must stay well under a second. */
function timed(run: () => void): number {
	const started = performance.now();
	run();
	return performance.now() - started;
}

describe("Q15: a chain deeper than the JS stack", () => {
	it("(a) 5,000 derived nodes: activate, write, deactivate", () => {
		const elapsed = timed(() => {
			const g = graph();
			const s = g.state(0);
			const chain: Node<number>[] = [];
			let prev: Node<number> = s;
			for (let i = 0; i < DEPTH; i++) {
				prev = g.derived([prev], (v) => (v as number) + 1);
				chain.push(prev);
			}
			const last = prev;
			const out = arrays();
			const stop = last.subscribe(out.sink);
			expect(out.log).toEqual([[["START"], ["DATA", DEPTH]]]);
			expect(chain.every((n) => n.status.lifecycle === "active")).toBe(true);
			s.set(1);
			s.set(2);
			expect(last.cache).toBe(DEPTH + 2);
			// R-wave@2: each write is exactly one array at the end, the kernel's PENDING first.
			expect(out.log).toEqual([
				[["START"], ["DATA", DEPTH]],
				[["PENDING"], ["DATA", DEPTH + 1]],
				[["PENDING"], ["DATA", DEPTH + 2]],
			]);
			expect(chain.every((n) => n.status.cache === "ready")).toBe(true);
			stop();
			// R-lifetime@2: the last subscriber leaving releases the whole chain.
			expect(chain.every((n) => n.status.lifecycle === "inactive")).toBe(true);
			expect(chain.every((n) => n.status.cache === "empty")).toBe(true);
			// Reactivating runs the whole chain again from the source's value.
			const again = arrays();
			last.subscribe(again.sink);
			expect(again.log).toEqual([[["START"], ["DATA", DEPTH + 2]]]);
		});
		expect(elapsed).toBeLessThan(1000);
	});

	it("(b) 5,000 kernel g.node functions", () => {
		const elapsed = timed(() => {
			const g = graph();
			const s = g.node<number>([], null, { initial: 0 });
			const chain: Node<number>[] = [];
			let prev: Node<number> = s;
			for (let i = 0; i < DEPTH; i++) {
				prev = g.node<number>([prev], (ctx) => {
					ctx.down([["DATA", (ctx.deps[0].value as number) + 1]]);
				});
				chain.push(prev);
			}
			const last = prev;
			const out = arrays();
			const stop = last.subscribe(out.sink);
			s.set(5);
			expect(last.cache).toBe(DEPTH + 5);
			expect(out.log).toEqual([
				[["START"], ["DATA", DEPTH]],
				[["PENDING"], ["DATA", DEPTH + 5]],
			]);
			stop();
			expect(chain.every((n) => n.status.lifecycle === "inactive")).toBe(true);
		});
		expect(elapsed).toBeLessThan(1000);
	});

	it("(c) COMPLETE propagates through all 5,000 nodes", () => {
		const elapsed = timed(() => {
			const g = graph();
			const s = g.state(0);
			const chain: Node<number>[] = [];
			let prev: Node<number> = s;
			for (let i = 0; i < DEPTH; i++) {
				prev = g.derived([prev], (v) => (v as number) + 1);
				chain.push(prev);
			}
			const last = prev;
			const out = arrays();
			last.subscribe(out.sink);
			s.set(1);
			s.complete();
			// graphrefly:D806 (1), R-terminals@1: under auto COMPLETE each function runs once more on
			// its dependency's terminal, so the last node sends its value and then COMPLETE, in one
			// delivery of two arrays, as a three-node chain does.
			expect(out.log).toEqual([
				[["START"], ["DATA", DEPTH]],
				[["PENDING"], ["DATA", DEPTH + 1]],
				[["PENDING"], ["DATA", DEPTH + 1]],
				[["PENDING"], ["COMPLETE"]],
			]);
			// R-terminals / R-lifetime: every node ended and keeps its value.
			expect(chain.every((n) => n.status.output === "completed")).toBe(true);
			expect(last.cache).toBe(DEPTH + 1);
			// A new subscriber receives START, the last value and the terminal.
			const late = arrays();
			last.subscribe(late.sink);
			expect(late.log).toEqual([[["START"], ["DATA", DEPTH + 1], ["COMPLETE"]]]);
		});
		expect(elapsed).toBeLessThan(1000);
	});

	it("(d) a diamond inside the chain: the fan-in runs once per wave", () => {
		const elapsed = timed(() => {
			const g = graph();
			const s = g.state(0);
			let prev: Node<number> = s;
			for (let i = 0; i < DEPTH / 2; i++) prev = g.derived([prev], (v) => (v as number) + 1);
			const middle = prev;
			// A short branch beside the long one, rejoining further down.
			const branch = g.derived([middle], (v) => (v as number) * 10);
			for (let i = 0; i < 3; i++) prev = g.derived([prev], (v) => (v as number) + 1);
			let joinRuns = 0;
			const join = g.derived([prev, branch], (a, b) => {
				joinRuns++;
				return (a as number) + (b as number);
			});
			prev = join;
			for (let i = 0; i < DEPTH / 2; i++) prev = g.derived([prev], (v) => (v as number) + 1);
			const last = prev;
			const out = arrays();
			const stop = last.subscribe(out.sink);
			// middle = 2500, long arm = 2503, branch = 25000, join = 27503, last = join + 2500.
			const expected = (v: number): number => {
				const m = v + DEPTH / 2;
				return m + 3 + m * 10 + DEPTH / 2;
			};
			expect(out.log).toEqual([[["START"], ["DATA", expected(0)]]]);
			expect(joinRuns).toBe(1);
			s.set(1);
			s.set(2);
			expect(joinRuns).toBe(3);
			expect(last.cache).toBe(expected(2));
			expect(out.log).toEqual([
				[["START"], ["DATA", expected(0)]],
				[["PENDING"], ["DATA", expected(1)]],
				[["PENDING"], ["DATA", expected(2)]],
			]);
			stop();
			expect(join.status.lifecycle).toBe("inactive");
			expect(middle.status.lifecycle).toBe("inactive");
		});
		expect(elapsed).toBeLessThan(1000);
	});
});
