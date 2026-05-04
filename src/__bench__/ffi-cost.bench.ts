/**
 * FFI cost bench — measures the cost of crossing the napi-rs boundary from
 * JS into the Rust core, then compares end-to-end emit throughput against
 * the pure-TS handle-core prototype.
 *
 * Phase 13.7 follow-up: with Pass-2 dispatcher numbers showing Rust 2.3-3.4×
 * faster, this bench answers whether FFI overhead eats the win on small graphs.
 *
 * Run:
 *   pnpm vitest bench src/__bench__/ffi-cost.bench.ts
 *
 * Companion: `~/src/graphrefly-rs/target/release/graphrefly_bindings_js.node`
 * (built via `cargo build -p graphrefly-bindings-js --release` in graphrefly-rs).
 */

import { createRequire } from "node:module";
import { bench, describe } from "vitest";
import { HandleRuntime } from "../__experiments__/handle-core/bindings.js";

const require = createRequire(import.meta.url);
// biome-ignore lint/suspicious/noExplicitAny: native binding has no .d.ts in v0
const binding: any = require(
	"/Users/davidchenallio/src/graphrefly-rs/target/release/graphrefly_bindings_js.node",
);

// ---------------------------------------------------------------------------
// 1. Pure napi-rs FFI overhead (no Rust dispatcher work).
// ---------------------------------------------------------------------------
describe("ffi_overhead/noop_call", () => {
	bench("noop_call (no return)", () => {
		binding.noopCall();
	});
});

describe("ffi_overhead/noop_returning_int", () => {
	bench("noop returning i32", () => {
		binding.noopCallReturningInt();
	});
});

// ---------------------------------------------------------------------------
// 2. End-to-end emit through FFI: one JS-side emit per iteration.
//    Compares against TS-only emit on the equivalent state node.
// ---------------------------------------------------------------------------
describe("end_to_end_emit/rust_via_ffi", () => {
	const core = new binding.BenchCore();
	const s = core.registerStateInt(0);
	core.subscribeNoop(s);
	let i = 0;
	bench("emit_int via FFI", () => {
		core.emitInt(s, ++i);
	});
});

describe("end_to_end_emit/ts_only", () => {
	const rt = new HandleRuntime();
	const s = rt.state(0);
	rt.subscribe(s, () => undefined);
	let i = 0;
	bench("emit_int pure TS", () => {
		s.set(++i);
	});
});

// ---------------------------------------------------------------------------
// 3. Amortized Rust dispatcher cost with N emits in a single FFI call.
//    Subtracting (FFI / N) from end-to-end gives the per-emit Rust cost.
//
//    NOTE: We use vitest bench's per-iteration mode but each call does N
//    internal emits; throughput numbers should be divided by the inner N.
// ---------------------------------------------------------------------------
const RUST_LOOP_INNER_N = 1000;
describe(`rust_emit_loop/inner_${RUST_LOOP_INNER_N}`, () => {
	const core = new binding.BenchCore();
	const s = core.registerStateInt(0);
	core.subscribeNoop(s);
	bench(`${RUST_LOOP_INNER_N} emits per FFI call`, () => {
		core.rustEmitLoop(s, RUST_LOOP_INNER_N);
	});
});

// ---------------------------------------------------------------------------
// 4. End-to-end with derived chain through FFI vs TS.
//    Measures the realistic case: a state + chain of derived passthroughs,
//    where each emit triggers a wave through the Rust core (or TS core).
// ---------------------------------------------------------------------------
const CHAIN_N = 16;

describe(`chain_${CHAIN_N}/rust_via_ffi`, () => {
	const core = new binding.BenchCore();
	const s = core.registerStateInt(0);
	let prev = s;
	for (let i = 0; i < CHAIN_N; i++) {
		prev = core.registerDerived([prev], "Identity");
	}
	core.subscribeNoop(prev);
	let i = 0;
	bench(`emit at root, chain depth ${CHAIN_N}`, () => {
		core.emitInt(s, ++i);
	});
});

describe(`chain_${CHAIN_N}/ts_only`, () => {
	const rt = new HandleRuntime();
	const s = rt.state(0);
	let prev: { _id: unknown; current: () => unknown } = s as unknown as {
		_id: unknown;
		current: () => unknown;
	};
	for (let i = 0; i < CHAIN_N; i++) {
		// biome-ignore lint/suspicious/noExplicitAny: bench scaffold
		prev = rt.derived([prev as any], (v: unknown) => v as number);
	}
	rt.subscribe(prev as never, () => undefined);
	let j = 0;
	bench(`emit at root, chain depth ${CHAIN_N}`, () => {
		s.set(++j);
	});
});

// ---------------------------------------------------------------------------
// 5. End-to-end large fanout — 100 leaves under one state. The case where
//    Rust dispatcher won 3.01× in pure microbench. Does FFI eat that?
// ---------------------------------------------------------------------------
const FANOUT_N = 100;

describe(`fanout_${FANOUT_N}/rust_via_ffi`, () => {
	const core = new binding.BenchCore();
	const s = core.registerStateInt(0);
	for (let i = 0; i < FANOUT_N; i++) {
		const leaf = core.registerDerived([s], "Identity");
		core.subscribeNoop(leaf);
	}
	let i = 0;
	bench(`emit at root, ${FANOUT_N} leaves`, () => {
		core.emitInt(s, ++i);
	});
});

describe(`fanout_${FANOUT_N}/ts_only`, () => {
	const rt = new HandleRuntime();
	const s = rt.state(0);
	for (let i = 0; i < FANOUT_N; i++) {
		const leaf = rt.derived([s], (v: number) => v);
		rt.subscribe(leaf, () => undefined);
	}
	let j = 0;
	bench(`emit at root, ${FANOUT_N} leaves`, () => {
		s.set(++j);
	});
});
