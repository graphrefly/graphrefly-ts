import { describe, expect, it } from "vitest";
import { DATA, ERROR } from "../../core/messages.js";
import { type NodeActions, type NodeFn, node } from "../../core/node.js";
import { state } from "../../core/sugar.js";
import { NS_PER_MS, NS_PER_SEC } from "../../extra/backoff.js";
import {
	type ResilientPipelineOptions,
	resilientPipeline,
} from "../../patterns/resilient-pipeline/index.js";

function collect<T>(n: { subscribe: (fn: (msgs: unknown[][]) => void) => () => void }): {
	events: T[];
	errors: unknown[];
	stop: () => void;
} {
	const events: T[] = [];
	const errors: unknown[] = [];
	const off = n.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] === DATA) events.push(m[1] as T);
			else if (m[0] === ERROR) errors.push(m[1]);
		}
	});
	return { events, errors, stop: off };
}

describe("resilientPipeline", () => {
	it("degenerate case: no options — source passes through via withStatus only", () => {
		const src = state(0);
		const bundle = resilientPipeline(src);
		const { events, stop } = collect<number>(bundle.node);
		src.emit(1);
		src.emit(2);
		expect(events).toEqual([0, 1, 2]);
		expect(bundle.status.cache).toBe("active");
		expect(bundle.error.cache).toBe(null);
		expect(bundle.breakerState).toBeUndefined();
		stop();
	});

	it("breaker option: exposes breakerState in the bundle", () => {
		const src = state(0);
		const bundle = resilientPipeline(src, {
			breaker: { failureThreshold: 2 },
		});
		// Activate
		bundle.node.subscribe(() => {});
		expect(bundle.breakerState).toBeDefined();
		expect(bundle.breakerState?.cache).toBe("closed");
	});

	it("timeoutMs throws on non-positive value", () => {
		const src = state(0);
		expect(() => resilientPipeline(src, { timeoutMs: 0 })).toThrow(/timeoutMs must be > 0/);
		expect(() => resilientPipeline(src, { timeoutMs: -1 })).toThrow(/timeoutMs must be > 0/);
	});

	it("rateLimit layer: permits through when under limit", () => {
		const src = state(0);
		const bundle = resilientPipeline(src, {
			rateLimit: { maxEvents: 10, windowNs: NS_PER_SEC },
		});
		const { events, stop } = collect<number>(bundle.node);
		src.emit(1);
		src.emit(2);
		expect(events).toEqual([0, 1, 2]);
		stop();
	});

	it("fallback layer: replaces terminal ERROR with fallback value", async () => {
		// A source that immediately errors on subscribe
		const errorFn: NodeFn = (_data, a: NodeActions) => {
			a.down([[ERROR, new Error("boom")]]);
			return undefined;
		};
		const src = node<number>([], errorFn, {
			describeKind: "producer",
			initial: 0,
			resubscribable: true,
		});
		const bundle = resilientPipeline(src, { fallback: 99 });
		const { events, errors, stop } = collect<number>(bundle.node);
		// Wait a microtask for the subscription + fallback to resolve
		await new Promise((r) => setTimeout(r, 5));
		expect(events.at(-1)).toBe(99);
		expect(errors).toEqual([]);
		stop();
	});

	it("withStatus reports status transitions through the pipeline", () => {
		const src = state(0);
		const bundle = resilientPipeline(src, { initialStatus: "pending" });
		bundle.node.subscribe(() => {});
		// initial push-on-subscribe delivers 0 as DATA → status = "active"
		expect(bundle.status.cache).toBe("active");
		expect(bundle.error.cache).toBe(null);
	});

	it("composition order preserved: all layers chain without type errors", () => {
		const src = state(0);
		const maxBudget = state(100);
		const opts: ResilientPipelineOptions<number> = {
			rateLimit: { maxEvents: 10, windowNs: NS_PER_SEC },
			budget: [{ node: maxBudget, check: (v) => (v as number) > 0 }],
			breaker: { failureThreshold: 5 },
			retry: { count: 2 },
			timeoutMs: 5_000,
			fallback: -1,
		};
		const bundle = resilientPipeline(src, opts);
		bundle.node.subscribe(() => {});
		// Basic sanity: the layer exposes all companions.
		expect(bundle.status.cache).toBeDefined();
		expect(bundle.error.cache).toBe(null);
		expect(bundle.breakerState?.cache).toBe("closed");
	});

	it("budget option: blocks DATA when constraint fails", () => {
		const src = state(0);
		const allowed = state(true);
		const bundle = resilientPipeline(src, {
			budget: [{ node: allowed, check: (v) => v === true }],
		});
		const { events, stop } = collect<number>(bundle.node);
		src.emit(1);
		expect(events.at(-1)).toBe(1);
		allowed.emit(false);
		src.emit(2); // should be buffered
		expect(events.at(-1)).toBe(1);
		allowed.emit(true);
		// Buffered value flushes
		expect(events.at(-1)).toBe(2);
		stop();
	});

	it("re-exports NS_PER_MS and NS_PER_SEC for call sites", () => {
		expect(NS_PER_MS).toBe(1_000_000);
		expect(NS_PER_SEC).toBe(1_000_000_000);
	});
});
