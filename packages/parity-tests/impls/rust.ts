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
import type { Impl } from "./types.js";

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

function build(): Impl {
	// Per-call delegation: every access reads the *current* lazily
	// (re)created instance so `afterEach`-reset works transparently.
	const target = {
		name: "rust-via-napi",
	} as Record<string, unknown>;

	return new Proxy(target, {
		get(_t, prop: string | symbol) {
			if (prop === "name") return "rust-via-napi";
			const inst = instance() as unknown as Record<string | symbol, unknown>;
			const value = inst[prop];
			if (typeof value === "function") {
				return (value as (...args: unknown[]) => unknown).bind(inst);
			}
			return value;
		},
		has(_t, prop) {
			const inst = instance() as unknown as Record<string | symbol, unknown>;
			return prop in inst;
		},
	}) as unknown as Impl;
}

export const rustImpl: Impl | null = wrapper ? (build() as Impl) : null;
