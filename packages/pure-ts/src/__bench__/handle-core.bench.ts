/**
 * Handle-core TS prototype benchmarks — pairs with
 * `~/src/graphrefly-rs/crates/graphrefly-core/benches/dispatcher.rs` for
 * the Phase 13.7 Rust-vs-TS comparison.
 *
 * Same workload patterns, same scenario names. Run both with:
 *   cd ~/src/graphrefly-rs && cargo bench -p graphrefly-core --bench dispatcher
 *   pnpm vitest bench src/__bench__/handle-core.bench.ts
 *
 * Side-by-side numbers answer "is the Rust dispatcher fundamentally faster?"
 * (FFI overhead measured separately in a follow-up.)
 */

import { bench, describe } from "vitest";
import { HandleRuntime } from "../__experiments__/handle-core/bindings.js";

// ---------------------------------------------------------------------------
// state_emit_identity_dedup — emit same value repeatedly; identity equals
// substitutes to RESOLVED on the wire (zero-FFI hot path in handle protocol).
// ---------------------------------------------------------------------------
describe("state_emit_identity_dedup", () => {
	const rt = new HandleRuntime();
	const s = rt.state(1);
	rt.subscribe(s, () => undefined);
	bench("emit_same_handle", () => {
		s.set(1); // same primitive value → same handle (interned)
	});
});

// ---------------------------------------------------------------------------
// state_emit_changing_value — fresh value each time; full DATA dispatch.
// ---------------------------------------------------------------------------
describe("state_emit_changing_value", () => {
	const rt = new HandleRuntime();
	const s = rt.state(0);
	rt.subscribe(s, () => undefined);
	let i = 0;
	bench("emit_fresh_handle_each", () => {
		s.set(++i); // fresh primitive → fresh handle
	});
});

// ---------------------------------------------------------------------------
// chain_propagation/N — N-deep derived chain; one update at root → wave
// propagates through all N nodes' fns.
// ---------------------------------------------------------------------------
function buildChain(rt: HandleRuntime, length: number) {
	const s = rt.state(0);
	let prev: { _id: unknown; current: () => unknown } = s as unknown as {
		_id: unknown;
		current: () => unknown;
	};
	for (let i = 0; i < length; i++) {
		// Each derived passes through with no transformation — measures pure
		// dispatch cost, not user-fn cost.
		prev = rt.derived([prev as any], (v: unknown) => v as number);
	}
	rt.subscribe(prev as never, () => undefined);
	return s;
}

for (const N of [1, 4, 16, 64]) {
	describe(`chain_propagation/${N}`, () => {
		const rt = new HandleRuntime();
		const s = buildChain(rt, N);
		let i = 0;
		bench(`chain_${N}`, () => {
			s.set(++i);
		});
	});
}

// ---------------------------------------------------------------------------
// diamond_fanout/N — s → {d1..dN} → sink; sink has all dN as deps.
// One update at s should fire sink ONCE despite N inner derived.
// ---------------------------------------------------------------------------
for (const N of [2, 8, 32]) {
	describe(`diamond_fanout/${N}`, () => {
		const rt = new HandleRuntime();
		const s = rt.state(0);
		const inner = Array.from({ length: N }, () => rt.derived([s], (v: number) => v));
		const sink = rt.derived(inner as any, (...vs: number[]) => vs.reduce((a, b) => a + b, 0));
		rt.subscribe(sink, () => undefined);
		let i = 0;
		bench(`diamond_${N}`, () => {
			s.set(++i);
		});
	});
}

// ---------------------------------------------------------------------------
// large_fanout/N — s → {leaf1..leafN}, no further reduction.
// Pure dispatch / propagation cost; each leaf re-runs its (trivial) fn.
// ---------------------------------------------------------------------------
for (const N of [10, 100, 1000]) {
	describe(`large_fanout/${N}`, () => {
		const rt = new HandleRuntime();
		const s = rt.state(0);
		for (let i = 0; i < N; i++) {
			const leaf = rt.derived([s], (v: number) => v);
			rt.subscribe(leaf, () => undefined);
		}
		let j = 0;
		bench(`fanout_${N}`, () => {
			s.set(++j);
		});
	});
}
