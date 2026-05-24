/**
 * Rust-via-napi impl arm — consumes the **shipped** `@graphrefly/native`
 * async public surface (Option C / D206 / D207).
 *
 * # What changed (Option C slice, 2026-05-15)
 *
 * The ~1800-LOC private `RustNode`/`RustGraph`/storage/structures
 * adapter that used to live in this file was **factored out** into the
 * shipped wrapper module (`@graphrefly/native` →
 * `crates/graphrefly-bindings-js/wrapper.js`). The parity harness now
 * imports `createNativeImpl()` from there instead of carrying its own
 * copy. This reverses the prior private-adapter ownership and kills the
 * parity-vs-real divergence the N1 follow-up flagged: what parity tests
 * is now *exactly* what a direct `@graphrefly/native` consumer gets.
 *
 * The shipped surface satisfies the full `Impl` contract — including
 * the 5 N1 substrate-infra symbols (`RingBuffer`, `ResettableTimer`,
 * `describeNode`, `sha256Hex`, `sourceOpts`) — so the cast is the
 * tight `as Impl` again (was widened to `as unknown as Impl` while the
 * rust arm was structurally incomplete by design).
 *
 * **N1 IS 5, NOT 6.** `wrapSubscribeHook` was deleted from the
 * substrate (Group-3 Edge #2 fix, commit c196981 — `replay`/`cached`/
 * `shareReplay` migrated to the built-in `replayBuffer` NodeOption);
 * `types.ts` is authoritative.
 *
 * # Per-test isolation
 *
 * `createNativeImpl()` builds a fresh BenchCore + JSValueRegistry per
 * call. The parity harness needs a fresh Core per test (vitest isolates
 * across files, not within a file). We lazily (re)create the underlying
 * native impl on first use after each reset and dispose it in
 * `afterEach` (the wrapper exposes an internal `_dispose` hook that
 * runs the prior BenchCore's subscription drop on a tokio blocking
 * thread, mirroring the D080 dispose discipline).
 *
 * # Failure mode: native binding not built
 *
 * If `@graphrefly/native`'s `.node` artifact isn't built, the wrapper
 * `require` of the napi loader throws lazily from `createNativeImpl()`.
 * We detect that at module load and export `rustImpl: null` so the
 * registry filters it out and scenarios run against legacy only.
 */

import { afterEach } from "vitest";
import type { Impl, ImplGraph } from "./types.js";

// ---------------------------------------------------------------------------
// Shipped native surface load (graceful fallback if not built).
//
// With the `exports` map added in the Option C slice, `@graphrefly/
// native` resolves to the hand-written wrapper (`wrapper.js`); the raw
// napi `Bench*` classes live at `@graphrefly/native/napi`.
// ---------------------------------------------------------------------------

type NativeWrapper = typeof import("@graphrefly/native");

let wrapper: NativeWrapper | null = null;
try {
	wrapper = require("@graphrefly/native") as NativeWrapper;
} catch (e) {
	if (process.env.GRAPHREFLY_PARITY_VERBOSE) {
		console.warn(`[parity-tests] @graphrefly/native not loaded; rustImpl arm disabled. ${e}`);
	}
}

// ---------------------------------------------------------------------------
// Lazy per-test native impl. `createNativeImpl()` builds a fresh Core;
// we (re)create on first use after each `afterEach` reset.
// ---------------------------------------------------------------------------

type NativeImplInstance = ReturnType<NativeWrapper["createNativeImpl"]>;

let cached: NativeImplInstance | null = null;

function instance(): NativeImplInstance {
	if (!wrapper) {
		throw new Error("[parity-tests rust] @graphrefly/native not loaded");
	}
	if (cached === null) {
		cached = wrapper.createNativeImpl();
	}
	return cached;
}

// Dispose the prior BenchCore between tests. The wrapper's `_dispose`
// runs the subscription drop on a tokio blocking thread (mirrors the
// D080 dispose discipline) and swallows shutdown-teardown races.
afterEach(async () => {
	if (cached) {
		const prior = cached;
		cached = null;
		await prior._dispose?.().catch(() => {});
	}
});

// ---------------------------------------------------------------------------
// The Impl arm.
//
// The shipped `NativeImpl` is structurally the parity `Impl` (same
// method shapes, same async-everywhere contract). We proxy each member
// through to the lazily-(re)created underlying instance so per-test
// Core isolation works without the harness owning adapter internals.
//
// Per-test Core isolation requires a `Proxy` over a placeholder target
// that re-reads the lazily-(re)created instance on every access. A
// `Proxy(Record<string, unknown>, …)` cannot carry `Impl`'s structural
// type, so `as unknown as Impl` is mandatory here — this cast does NOT
// structurally enforce member presence. Rust-arm conformance to the
// parity contract is enforced upstream by the shipped `@graphrefly/
// native` wrapper's own typing (`createNativeImpl(): NativeImpl`,
// structurally the `Impl`) plus the `pure-ts` reference arm; a wrapper
// regression fails at the wrapper's type boundary, not at this Proxy.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ImplGraph-level method-not-yet-on-native traps.
//
// Centralized registry so future port-coverage widenings add ONE entry
// here instead of N scattered Proxy traps (E-iv.4 design-review Phase 2
// cross-cutting synthesis, 2026-05-23). Mirrors the D282 `batch` trap
// discipline at `Impl`-level but operates on `ImplGraph` returns.
//
// `wrapNativeGraph` Proxy-wraps every `ImplGraph` returned by the
// rust adapter (`Graph` constructor + `mount()` return) so a call to
// any method named here surfaces a LOUD error citing the ledger row
// instead of silently passing through (the underlying `NativeGraph`
// has no such methods → `undefined` would silently `await` to
// `undefined`, false-passing a scenario that forgot its runIf gate).
// ---------------------------------------------------------------------------

const NOT_ON_NATIVE_GRAPH_METHODS: Record<string, string> = {
	// D287 (2026-05-24): `tagFactory` + `resourceProfile` LANDED on the
	// native arm via the paired D285 substrate + D286 napi `/porting-to-rs`
	// slice. Registry intentionally kept (empty) so future port-coverage
	// widenings can add one entry here instead of N scattered Proxy traps
	// (E-iv.4 design-review Phase 2 cross-cutting synthesis).
};

function wrapNativeGraph(g: ImplGraph): ImplGraph {
	return new Proxy(g, {
		get(target, prop, receiver) {
			const ledgerRef = typeof prop === "string" ? NOT_ON_NATIVE_GRAPH_METHODS[prop] : undefined;
			if (ledgerRef !== undefined) {
				return async (..._args: unknown[]): Promise<never> => {
					throw new Error(
						`${String(prop)}: not yet exposed on @graphrefly/native (${ledgerRef}; ` +
							'gate with test.runIf(impl.name === "pure-ts") until the napi binding ships)',
					);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			// `mount(name, child?)` returns a child `ImplGraph` — wrap
			// transitively so a `.tagFactory` on the child also throws.
			// QA-A5: `.apply(receiver, args)` (not `target`) preserves Proxy
			// semantics for the rare case where a future ImplGraph method
			// internally re-routes through `this` — the inner call stays in
			// the Proxy so the trap registry still fires for the re-entry.
			// String-match is mount-only today; QA-F3 notes the brittleness
			// if a future ImplGraph method also returns a child graph.
			if (prop === "mount" && typeof value === "function") {
				return async (...args: unknown[]): Promise<ImplGraph> => {
					const child = await (value as (...a: unknown[]) => Promise<ImplGraph>).apply(
						receiver,
						args,
					);
					return wrapNativeGraph(child);
				};
			}
			// QA-A5: bind to `receiver` (the Proxy) instead of `target` (the
			// raw NativeGraph) so methods that internally call other
			// methods on `this` re-enter the Proxy and route through the
			// trap registry. With `bind(target)`, such re-entry would
			// bypass traps — no registry method does this today, but
			// `bind(receiver)` is the principled Proxy-conformant shape.
			if (typeof value === "function") {
				return (value as (...a: unknown[]) => unknown).bind(receiver);
			}
			return value;
		},
		has(target, prop) {
			// QA-D1: returns `false` for registry methods to match the D282
			// top-level Impl `has` trap precedent at `rust.ts:160`. Feature-
			// detection callers (`"tagFactory" in g`) cleanly see
			// "not available" rather than being misled into calling the
			// throwing stub. The `get` trap remains the loud safety net
			// for callers that do invoke without runIf-gating.
			if (typeof prop === "string" && prop in NOT_ON_NATIVE_GRAPH_METHODS) return false;
			return Reflect.has(target, prop);
		},
	});
}

function build(): Impl {
	// Per-call delegation: every access reads the *current* lazily
	// (re)created instance so `afterEach`-reset works transparently.
	const target = {
		name: "rust-via-napi",
	} as Record<string, unknown>;

	return new Proxy(target, {
		get(_t, prop: string | symbol) {
			if (prop === "name") return "rust-via-napi";
			// D282 (cross-track-ledger §1, 2026-05-23): the parity `Impl`
			// contract was widened with `batch(fn): Promise<void>` so the
			// TS-arm convergence to Rust's `discard_wave_cleanup` shape can
			// be asserted cross-arm. The native wrapper does NOT yet
			// expose a user-level `batch(fn)` napi (Rust substrate uses
			// implicit `BatchGuard` per-wave; the user `batch(fn)` shape
			// requires a separate napi binding). Until that ships, every
			// rollback-asserting scenario in
			// `scenarios/core/batch-throw-rollback.test.ts` gates with
			// `test.runIf(impl.name === "pure-ts")`. Throw here so an
			// accidental cross-arm invocation surfaces loudly instead of
			// silently passing through to a no-op.
			if (prop === "batch") {
				return async (_fn: () => void): Promise<void> => {
					throw new Error(
						'batch: not yet exposed on @graphrefly/native (cross-track-ledger §1 D282; gate with `test.runIf(impl.name === "pure-ts")` until the napi binding ships)',
					);
				};
			}
			const inst = instance() as unknown as Record<string | symbol, unknown>;
			// E-iv.4 (D283) — wrap the Graph constructor so every
			// returned ImplGraph routes through `wrapNativeGraph`. Without
			// this, calling `.tagFactory()` on a NativeGraph instance
			// resolves to `undefined` (the underlying class has no such
			// method) and `await undefined` silently passes — false-
			// passing any scenario that forgets its runIf gate.
			if (prop === "Graph") {
				const NativeGraphCtor = inst.Graph as new (name: string) => ImplGraph;
				/**
				 * QA-A6 caveat — `instanceof WrappedNativeGraph` is FALSE for
				 * any value produced by `new WrappedNativeGraph(name)`. The
				 * constructor-return idiom replaces the instance with the
				 * Proxy-wrapped underlying `NativeGraph`, so the prototype
				 * chain is the Proxy's target (NativeGraph), not
				 * WrappedNativeGraph. No parity scenario uses `instanceof`
				 * checks; if one ever needs to, dispatch on `impl.name`
				 * instead.
				 */
				return class WrappedNativeGraph {
					constructor(name: string) {
						// `new impl.Graph(name)` is the parity-scenario
						// constructor pattern; we MUST return the Proxy-
						// wrapped instance so `.tagFactory()` /
						// `.resourceProfile()` throw loudly instead of
						// silently resolving to `undefined`. Constructor-
						// return is the only way to intercept `new` without
						// rewriting every scenario to a factory call.
						// biome-ignore lint/correctness/noConstructorReturn: load-bearing Proxy wrap for E-iv.4 (D283) — see comment above
						return wrapNativeGraph(new NativeGraphCtor(name));
					}
				};
			}
			const value = inst[prop];
			if (typeof value === "function") {
				return (value as (...args: unknown[]) => unknown).bind(inst);
			}
			return value;
		},
		has(_t, prop) {
			// D282 /qa F11: return `false` from `has` for `batch` so
			// feature-detection callers (`"batch" in impl`) cleanly report
			// "not available" instead of being misled into calling the
			// throwing stub. The `get` trap still returns the throwing
			// async-fn stub above for callers that DO invoke `impl.batch`
			// directly without runIf-gating — those surface the
			// "not yet exposed on @graphrefly/native" error loudly.
			if (prop === "batch") return false;
			const inst = instance() as unknown as Record<string | symbol, unknown>;
			return prop in inst;
		},
	}) as unknown as Impl;
}

export const rustImpl: Impl | null = wrapper ? (build() as Impl) : null;
