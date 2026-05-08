/**
 * Phase D bench harness — operators-via-TSFN throughput.
 *
 * Three-bench shape per D049 (~/src/graphrefly-rs/docs/porting-deferred.md
 * "Phase D — three-bench shape (D049) deferred"):
 *
 *   (1) bench_builtin_fn      — pure FFI baseline. core.registerDerived([s], "Identity").
 *                                No TSFN, no JS callback. Rust dispatcher resolves
 *                                Identity in pure Rust.
 *   (2) bench_tsfn_identity   — TSFN scheduling overhead. operators.registerMap(s, h => h).
 *                                JS callback fires per emit but does no work; returns
 *                                input handle unchanged.
 *   (3) bench_tsfn_addone_js  — End-to-end Rust-via-TSFN-into-JS. JS callback does
 *                                work + 2× sync FFI (deref_int + intern_int).
 *
 * Subtraction interpretation:
 *   (2) − (1) = per-emit TSFN scheduling cost (libuv hop + JS cb invocation).
 *   (3) − (2) = JS-side compute + 2 sync FFI calls (deref_int + intern_int).
 *   (3)       = headline "operator with JS callback" throughput.
 *
 * **Important — `await` semantics.** All three benches `await` `emit_int` so the
 * measurement covers full end-to-end wave drain (libuv hop → tokio
 * spawn_blocking → wave_owner acquire → wave engine → TSFN trip if applicable →
 * wave drain → libuv pump → Promise resolve). The legacy
 * [ffi-cost.bench.ts](./ffi-cost.bench.ts) fires-and-forgets `emit_int` —
 * pre-D070 era when emit was sync. For Phase D the await is correct because
 * the headline metric is per-emit end-to-end cost.
 *
 * **Setup uses top-level await, not `beforeAll`.** Per the convention noted in
 * [graphrefly.bench.ts](./graphrefly.bench.ts:5): vitest benchmark mode does
 * NOT run `beforeAll` before Tinybench. All setup happens at file load (top-
 * level await is supported in Node ESM); each bench fn closes over the
 * resolved fixtures.
 *
 * **TSFN wire signature (resolved in Slice Y).** The napi binding now
 * uses `callee_handled::<false>()` so JS receives `(value)` directly,
 * matching the typed `Function<u32, u32>` declaration. JS callbacks
 * here take `(h: number) => number` natively — no err-first defensive
 * picker needed.
 *
 * Run:
 *   pnpm --filter @graphrefly/legacy-pure-ts bench src/__bench__/operators-via-tsfn.bench.ts
 *
 * Prerequisite: build the napi binding first (with `operators` feature).
 *   cd ~/src/graphrefly-rs && cargo build -p graphrefly-bindings-js --release --features standard
 *   cp ~/src/graphrefly-rs/target/release/libgraphrefly_bindings_js.dylib \
 *      ~/src/graphrefly-rs/target/release/graphrefly_bindings_js.node
 */

import { createRequire } from "node:module";
import { bench, describe } from "vitest";

const require = createRequire(import.meta.url);
// biome-ignore lint/suspicious/noExplicitAny: native binding is loaded via absolute path; no shipped .d.ts at this path.
const binding: any = require(
	"/Users/davidchenallio/src/graphrefly-rs/target/release/graphrefly_bindings_js.node",
);

// ---------------------------------------------------------------------------
// (1) Pure-FFI baseline — no TSFN, no JS callback.
// ---------------------------------------------------------------------------
const core1 = new binding.BenchCore();
const s1: number = await core1.registerStateInt(0);
const mapped1: number = await core1.registerDerived([s1], "Identity");
await core1.subscribeNoop(mapped1);
let i1 = 0;

// ---------------------------------------------------------------------------
// (2) TSFN identity — JS callback fires per emit, does no JS work.
// ---------------------------------------------------------------------------
const core2 = new binding.BenchCore();
const operators2 = binding.BenchOperators.fromCore(core2);
const s2: number = await core2.registerStateInt(0);
const mapped2: number = await operators2.registerMap(s2, (h: number) => h);
await core2.subscribeNoop(mapped2);
let i2 = 0;

// ---------------------------------------------------------------------------
// (3) TSFN add-one — JS callback does work + 2× sync FFI.
// ---------------------------------------------------------------------------
const core3 = new binding.BenchCore();
const operators3 = binding.BenchOperators.fromCore(core3);
const s3: number = await core3.registerStateInt(0);
const mapped3: number = await operators3.registerMap(s3, (h: number) => {
	const v = core3.derefInt(h);
	return core3.internInt(v + 1);
});
await core3.subscribeNoop(mapped3);
let i3 = 0;

// ---------------------------------------------------------------------------
// Benches
// ---------------------------------------------------------------------------

describe("operators_via_tsfn/builtin_fn", () => {
	bench("emit_int — chain depth 1, builtin Identity", async () => {
		await core1.emitInt(s1, ++i1);
	});
});

describe("operators_via_tsfn/tsfn_identity", () => {
	bench("emit_int — JS callback (h) => h", async () => {
		await core2.emitInt(s2, ++i2);
	});
});

describe("operators_via_tsfn/tsfn_addone_js", () => {
	bench("emit_int — JS callback (h) => intern(deref(h)+1)", async () => {
		await core3.emitInt(s3, ++i3);
	});
});
