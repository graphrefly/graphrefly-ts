/**
 * R8 unified handle-table model — dispatch-overhead microbench.
 *
 * Validates the core R8 claim: a LocalSync pool's invoke is "O(1) pointer
 * indirection inside the same wave tick (no microtask, no Promise alloc) —
 * externally indistinguishable from direct fn call."
 *
 * R6 target #1: LocalSync indirection overhead vs direct fn call must be < 50ns
 * per call. If the gap is larger, the uniform handle-table model loses its
 * "no perf penalty for inline fns" claim.
 *
 * Workloads:
 *   - direct: literal fn() call in a tight loop (baseline)
 *   - via_map: Map<HandleId, Fn> lookup then call
 *   - via_array: Fn[] indexed lookup then call (the Rust `Vec<Box<dyn Fn>>`
 *     analogue, which is what a real dispatcher would use)
 *   - via_closure_table: object property dispatch (alternative impl shape)
 *   - via_async_resolved: Promise.resolve wrap (LocalAsync pool simulation)
 *
 * The four sync variants should be within tens of nanoseconds of each other.
 * The async variant should be measurably slower (microtask hop).
 */

import { bench, describe } from "vitest";

const ITERS = 1000;

// ---------------------------------------------------------------------------
// Direct fn call — the baseline. No indirection.
// ---------------------------------------------------------------------------
describe("dispatch_overhead/direct", () => {
	const fn = (x: number): number => x + 1;
	bench("direct_call_x1000", () => {
		let acc = 0;
		for (let i = 0; i < ITERS; i++) {
			acc = fn(acc);
		}
		if (acc < 0) throw new Error("unreachable");
	});
});

// ---------------------------------------------------------------------------
// Via Map<HandleId, Fn> — naive handle-table impl. JS Map is hash-based.
// ---------------------------------------------------------------------------
describe("dispatch_overhead/via_map", () => {
	const table = new Map<number, (x: number) => number>();
	table.set(1, (x) => x + 1);
	bench("map_lookup_call_x1000", () => {
		let acc = 0;
		for (let i = 0; i < ITERS; i++) {
			const f = table.get(1);
			if (f !== undefined) acc = f(acc);
		}
		if (acc < 0) throw new Error("unreachable");
	});
});

// ---------------------------------------------------------------------------
// Via Fn[] — Vec<Box<dyn Fn>> analogue. The shape a real Rust dispatcher
// would use. Indexed lookup is ~1 cycle in Rust, JS arrays should be close.
// ---------------------------------------------------------------------------
describe("dispatch_overhead/via_array", () => {
	const table: Array<(x: number) => number> = [];
	const handle = table.length;
	table.push((x) => x + 1);
	bench("array_index_call_x1000", () => {
		let acc = 0;
		for (let i = 0; i < ITERS; i++) {
			acc = table[handle](acc);
		}
		if (acc < 0) throw new Error("unreachable");
	});
});

// ---------------------------------------------------------------------------
// Via object property — an alternative dispatch-table shape. Lets V8 inline
// the call site via hidden classes if the shape is stable.
// ---------------------------------------------------------------------------
describe("dispatch_overhead/via_object", () => {
	const dispatcher = { fn1: (x: number) => x + 1 };
	bench("object_prop_call_x1000", () => {
		let acc = 0;
		for (let i = 0; i < ITERS; i++) {
			acc = dispatcher.fn1(acc);
		}
		if (acc < 0) throw new Error("unreachable");
	});
});

// ---------------------------------------------------------------------------
// Via async wrap — Promise.resolve().then(). Simulates a LocalAsync pool
// where work is local but the protocol is async. Should be MUCH slower than
// the sync variants — quantifying that gap is the point.
// ---------------------------------------------------------------------------
describe("dispatch_overhead/via_async_resolved", () => {
	const fn = (x: number): number => x + 1;
	bench("async_resolve_call_x1000", async () => {
		let acc = 0;
		for (let i = 0; i < ITERS; i++) {
			acc = await Promise.resolve(fn(acc));
		}
		if (acc < 0) throw new Error("unreachable");
	});
});

// ---------------------------------------------------------------------------
// Via queueMicrotask — the cheapest async hop. Quantifies the microtask
// floor cost.
// ---------------------------------------------------------------------------
describe("dispatch_overhead/via_microtask", () => {
	const fn = (x: number): number => x + 1;
	bench("microtask_call_x1000", async () => {
		let acc = 0;
		for (let i = 0; i < ITERS; i++) {
			acc = await new Promise<number>((resolve) => {
				queueMicrotask(() => resolve(fn(acc)));
			});
		}
		if (acc < 0) throw new Error("unreachable");
	});
});
