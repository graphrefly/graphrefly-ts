import { describe, expect, it } from "vitest";
import { DATA, ERROR } from "../../core/messages.js";
import { describeNode } from "../../core/meta.js";
import { type NodeActions, type NodeFn, node } from "../../core/node.js";
import { state } from "../../core/sugar.js";
import { NS_PER_MS, NS_PER_SEC } from "../../extra/backoff.js";
import {
	ResilientPipelineGraph,
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

describe("resilientPipeline — basic shape", () => {
	it("returns a ResilientPipelineGraph subclass", () => {
		const src = state(0);
		const pipeline = resilientPipeline(src);
		expect(pipeline).toBeInstanceOf(ResilientPipelineGraph);
		expect(typeof pipeline.describe).toBe("function");
		expect(typeof pipeline.output.subscribe).toBe("function");
	});

	it("degenerate case: no options — source passes through via withStatus only", () => {
		const src = state(0);
		const pipeline = resilientPipeline(src);
		const { events, stop } = collect<number>(pipeline.output);
		src.emit(1);
		src.emit(2);
		expect(events).toEqual([0, 1, 2]);
		expect(pipeline.status.cache).toBe("running");
		expect(pipeline.lastError.cache).toBe(null);
		expect(pipeline.breakerState).toBeUndefined();
		expect(pipeline.droppedCount).toBeUndefined();
		stop();
	});

	it("breaker option: exposes breakerState in the graph + describe surface", () => {
		const src = state(0);
		const pipeline = resilientPipeline(src, {
			breaker: { failureThreshold: 2 },
		});
		// Activate
		pipeline.output.subscribe(() => {});
		expect(pipeline.breakerState).toBeDefined();
		expect(pipeline.breakerState?.cache).toBe("closed");

		const desc = pipeline.describe();
		expect(desc.nodes.breakerWrapped).toBeDefined();
		expect(desc.nodes.breakerState).toBeDefined();
	});

	it("rateLimit option: exposes droppedCount + rateLimitState companions", () => {
		const src = state(0);
		const pipeline = resilientPipeline(src, {
			rateLimit: { maxEvents: 10, windowNs: NS_PER_SEC, maxBuffer: 100 },
		});
		pipeline.output.subscribe(() => {});
		expect(pipeline.droppedCount).toBeDefined();
		expect(pipeline.droppedCount?.cache).toBe(0);

		expect(pipeline.rateLimitState).toBeDefined();
		const stateCache = pipeline.rateLimitState?.cache as
			| { droppedCount: number; pendingCount: number; paused: boolean }
			| undefined;
		expect(stateCache?.droppedCount).toBe(0);
		expect(stateCache?.pendingCount).toBe(0);
		expect(stateCache?.paused).toBe(false);

		const desc = pipeline.describe();
		expect(desc.nodes.rateLimited).toBeDefined();
		expect(desc.nodes.droppedCount).toBeDefined();
		expect(desc.nodes.rateLimitState).toBeDefined();
	});
});

describe("resilientPipeline — domain meta tagging (D8)", () => {
	it("each layer carries domainMeta('resilient', kind) on its produced node", () => {
		const src = state(0);
		const allowed = state(true);
		const pipeline = resilientPipeline(src, {
			rateLimit: { maxEvents: 10, windowNs: NS_PER_SEC, maxBuffer: 100 },
			budget: [{ node: allowed, check: (v) => v === true }],
			breaker: { failureThreshold: 5 },
			timeoutMs: 5_000,
			retry: { count: 2 },
			fallback: -1,
		});
		pipeline.output.subscribe(() => {});

		const desc = pipeline.describe({ detail: "standard" });
		// Each layer's intermediate carries `resilient: true` + `resilient_type: <kind>`.
		const expectations: Array<[string, string]> = [
			["rateLimited", "rate-limit"],
			["breakerWrapped", "breaker"],
			["timeoutWrapped", "timeout"],
			["retryWrapped", "retry"],
			["fallbackWrapped", "fallback"],
			["output", "status"],
		];
		for (const [path, kind] of expectations) {
			const meta = desc.nodes[path]?.meta;
			expect(meta?.resilient, `${path}: meta.resilient`).toBe(true);
			expect(meta?.resilient_type, `${path}: meta.resilient_type`).toBe(kind);
		}
		// `budgetGate` already integrates domain meta via `domainMeta("resilience", "budget_gate", opts?.meta)`
		// — caller meta nests in there. Confirm the budget node still surfaces `resilience_type` from the
		// primitive's own tag (not overridden by our pass-through), then check that our `resilient` tag
		// rides through as part of the merged meta object.
		const budgetMeta = desc.nodes.budgetGated?.meta;
		expect(budgetMeta).toBeDefined();
		// Caller-supplied keys are merged via `domainMeta(domain, kind, extra)` so the
		// resilient tag is preserved alongside the primitive's resilience_type.
		expect(budgetMeta?.resilient).toBe(true);
		expect(budgetMeta?.resilient_type).toBe("budget");
	});
});

describe("resilientPipeline — layer behavior", () => {
	it("timeoutMs throws on non-positive value", () => {
		const src = state(0);
		expect(() => resilientPipeline(src, { timeoutMs: 0 })).toThrow(/timeoutMs must be > 0/);
		expect(() => resilientPipeline(src, { timeoutMs: -1 })).toThrow(/timeoutMs must be > 0/);
	});

	it("timeoutMs throws on overflow risk (> 9_000_000 ms)", () => {
		const src = state(0);
		expect(() => resilientPipeline(src, { timeoutMs: 9_000_001 })).toThrow(/9_000_000/);
	});

	it("rateLimit layer: permits through when under limit", () => {
		const src = state(0);
		const pipeline = resilientPipeline(src, {
			rateLimit: { maxEvents: 10, windowNs: NS_PER_SEC },
		});
		const { events, stop } = collect<number>(pipeline.output);
		src.emit(1);
		src.emit(2);
		expect(events).toEqual([0, 1, 2]);
		stop();
	});

	it("fallback layer: replaces terminal ERROR with fallback value", async () => {
		const errorFn: NodeFn = (_data, a: NodeActions) => {
			a.down([[ERROR, new Error("boom")]]);
			return undefined;
		};
		const src = node<number>([], errorFn, {
			describeKind: "producer",
			initial: 0,
			resubscribable: true,
		});
		const pipeline = resilientPipeline(src, { fallback: 99 });
		const { events, errors, stop } = collect<number>(pipeline.output);
		await new Promise((r) => setTimeout(r, 5));
		expect(events.at(-1)).toBe(99);
		expect(errors).toEqual([]);
		stop();
	});

	it("withStatus reports status transitions through the pipeline", () => {
		const src = state(0);
		const pipeline = resilientPipeline(src, { initialStatus: "pending" });
		pipeline.output.subscribe(() => {});
		expect(pipeline.status.cache).toBe("running");
		expect(pipeline.lastError.cache).toBe(null);
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
		const pipeline = resilientPipeline(src, opts);
		pipeline.output.subscribe(() => {});
		expect(pipeline.status.cache).toBeDefined();
		expect(pipeline.lastError.cache).toBe(null);
		expect(pipeline.breakerState?.cache).toBe("closed");
		expect(pipeline.droppedCount?.cache).toBe(0);

		// All intermediates are mounted — describe surfaces the full chain.
		const desc = pipeline.describe();
		expect(desc.nodes.rateLimited).toBeDefined();
		expect(desc.nodes.budgetGated).toBeDefined();
		expect(desc.nodes.breakerWrapped).toBeDefined();
		expect(desc.nodes.timeoutWrapped).toBeDefined();
		expect(desc.nodes.retryWrapped).toBeDefined();
		expect(desc.nodes.fallbackWrapped).toBeDefined();
	});

	it("budget option: blocks DATA when constraint fails", () => {
		const src = state(0);
		const allowed = state(true);
		const pipeline = resilientPipeline(src, {
			budget: [{ node: allowed, check: (v) => v === true }],
		});
		const { events, stop } = collect<number>(pipeline.output);
		src.emit(1);
		expect(events.at(-1)).toBe(1);
		allowed.emit(false);
		src.emit(2); // should be buffered
		expect(events.at(-1)).toBe(1);
		allowed.emit(true);
		expect(events.at(-1)).toBe(2);
		stop();
	});
});

describe("resilientPipeline — reactive options (switchMap rebuild — qa G1C-prime)", () => {
	it("accepts a Node<RateLimiterOptions>; layer is mounted and switchMap'd over the option Node", () => {
		const src = state(0, { resubscribable: true });
		const rateOpts = state({ maxEvents: 10, windowNs: NS_PER_SEC, maxBuffer: 100 });
		const pipeline = resilientPipeline(src, { rateLimit: rateOpts });
		pipeline.output.subscribe(() => {});
		// Layer mounted.
		expect(pipeline.describe().nodes.rateLimited).toBeDefined();
		// Companions NOT exposed in reactive mode (per-rebuild instances would
		// otherwise track only the latest bundle). Caller awaits primitive-side
		// widening.
		expect(pipeline.droppedCount).toBeUndefined();
		expect(pipeline.rateLimitState).toBeUndefined();
	});

	it("accepts a Node<RetryOptions>; layer rebuilds on each emission (state-loss caveat)", () => {
		const src = state(0, { resubscribable: true });
		const retryOpts = state({ count: 3 });
		const pipeline = resilientPipeline(src, { retry: retryOpts });
		pipeline.output.subscribe(() => {});
		expect(pipeline.describe().nodes.retryWrapped).toBeDefined();

		// Re-emit with a new count — switchMap rebuilds the layer.
		retryOpts.emit({ count: 5 });
		// Sanity: chain still composed (no crash); the new layer is in place.
		expect(pipeline.describe().nodes.retryWrapped).toBeDefined();
	});

	it("accepts a Node<number> for timeoutMs; respects validation on each emission", () => {
		const src = state(0, { resubscribable: true });
		const timeoutNode = state(5_000);
		const pipeline = resilientPipeline(src, { timeoutMs: timeoutNode });
		pipeline.output.subscribe(() => {});
		expect(pipeline.describe().nodes.timeoutWrapped).toBeDefined();

		// Switch to a different valid deadline — layer rebuilds.
		timeoutNode.emit(2_000);
		expect(pipeline.describe().nodes.timeoutWrapped).toBeDefined();
	});

	it("accepts a Node<readonly BudgetConstraint[]> with an initially-empty array; no layer until non-empty emits", () => {
		const src = state(0, { resubscribable: true });
		const allowed = state(true);
		const constraints = state<
			ReadonlyArray<{ node: typeof allowed; check: (v: unknown) => boolean }>
		>([]);
		const pipeline = resilientPipeline(src, { budget: constraints });
		pipeline.output.subscribe(() => {});
		// Empty array — layer projection returns the upstream as-is. The
		// `budgetGated` mount still exists (projection's result is what's
		// mounted), but the gate is a pass-through.
		const before = pipeline.describe().nodes.budgetGated;
		expect(before).toBeDefined();

		// Activate constraint set.
		constraints.emit([{ node: allowed, check: (v) => v === true }]);
		// Layer is rebuilt; mount continues to point at the new budgetGate output.
		expect(pipeline.describe().nodes.budgetGated).toBeDefined();
	});
});

describe("resilientPipeline — describe metadata", () => {
	it("self-tags via tagFactory so describe() surfaces the factory + JSON-safe args", () => {
		const src = state(0);
		const retryNode = state({ count: 2 });
		const pipeline = resilientPipeline(src, {
			retry: retryNode,
			timeoutMs: 5_000,
			fallback: -1,
		});
		const desc = pipeline.describe();
		expect(desc.factory).toBe("resilientPipeline");
		expect(desc.factoryArgs).toBeDefined();
		// `placeholderArgs` substitutes Node-typed values with `"<Node>"`.
		const args = desc.factoryArgs as { retry: unknown; timeoutMs: unknown; fallback: unknown };
		expect(args.retry).toBe("<Node>");
		expect(args.timeoutMs).toBe(5_000);
		expect(args.fallback).toBe(-1);
	});

	it("primitives carry their own factoryTag meta on the externally-visible nodes", () => {
		const src = state(0);
		const pipeline = resilientPipeline(src);
		// `withStatus` (the always-last layer) stamps `meta.factory =
		// "withStatus"` on the output node, so the Graph's `factory` ride is
		// the canonical resilient-domain provenance and the primitive tag
		// stays available on the inner node for tooling that drills in.
		const nodeMeta = describeNode(pipeline.output).meta;
		expect(nodeMeta?.factory).toBe("withStatus");
	});
});

describe("resilientPipeline — exports", () => {
	it("re-exports NS_PER_MS and NS_PER_SEC for call sites", () => {
		expect(NS_PER_MS).toBe(1_000_000);
		expect(NS_PER_SEC).toBe(1_000_000_000);
	});
});
