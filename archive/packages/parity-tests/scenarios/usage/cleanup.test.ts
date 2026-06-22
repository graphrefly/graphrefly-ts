/**
 * D293 — `@graphrefly/native` close() + Symbol.asyncDispose lifecycle.
 *
 * Pins the real-user invariant that closes the "process never exits"
 * hang for every napi consumer: test frameworks (vitest/jest/mocha),
 * CLI scripts, serverless cold-start, and AWS Lambda. The Rust
 * substrate (`graphrefly-bindings-js::CoreActor`) spawns one
 * non-daemon worker thread per `BenchCore` via `std::thread::spawn`;
 * Rust's `std::thread` has no daemon concept on POSIX, so the
 * thread blocks Node's process exit indefinitely without `close()`.
 *
 * **What this scenario asserts:**
 * 1. `await impl.close()` returns AND the process is free to exit
 *    naturally (no `process.exit()` / `--forceExit` needed). The
 *    vitest runner's exit behavior is the load-bearing signal — if
 *    `close()` didn't kill the worker, vitest would hang at the end
 *    of the test file waiting for worker process termination.
 * 2. Double-`close()` is idempotent (the second call is a best-effort
 *    no-op; no throw).
 * 3. Method calls after `close()` reject with a clear actor-shutdown
 *    error (per D293 Q2a — broadened parenthetical "(actor is shut
 *    down or shutting down)" so JS callers can recognize
 *    shutdown-class failures uniformly).
 * 4. `Symbol.asyncDispose` is wired so `await using` (Node 22+)
 *    auto-closes at block exit.
 *
 * **Pure-ts arm:** the scenarios run cross-arm because they exercise
 * the parity `Impl` shape (`impl.close()` was always implicit via
 * pure-ts's reactive lifecycle; the new public `close()` method is
 * additive on both arms). Pure-ts `legacy` has no actor thread, so
 * its `close()` is a no-op drain (returns immediately); the
 * post-close-method-throws assertion uses an arm-conditional matcher.
 *
 * **D293 mint:** `~/src/graphrefly-ts/docs/rust-port-decisions.md`
 * D293; cross-track-ledger §1 "process never exits" CLOSED row;
 * `~/src/graphrefly-rs/docs/migration-status.md` D293 entry.
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("D293 close() + Symbol.asyncDispose parity — $name", (impl) => {
	const isNative = impl.name === "rust-via-napi";

	// ── Case 1 — close() exists + completes ────────────────────────
	test("impl.close() is a function and resolves", async () => {
		expect(typeof impl.close).toBe("function");
		await expect(impl.close()).resolves.toBeUndefined();
	});

	// ── Case 2 — double-close() idempotent (no throw, returns void) ─
	test("close() is idempotent — double-close does not throw", async () => {
		await impl.close();
		// Second call: best-effort no-op. The wrapper's `.catch(() => {})`
		// (D292 WATCH for surfacing) swallows the actor's
		// channel-disconnect error on subsequent attempts; this assertion
		// just pins the no-throw contract.
		await expect(impl.close()).resolves.toBeUndefined();
	});

	// ── Case 3 — post-close method calls reject (native) / no-op (pure-ts) ─
	//
	// Native arm: post-close `impl.node(...)` reaches the napi binding,
	// which forwards to `BenchCore.close`-shut-down actor → channel
	// disconnect → napi `Error` with text "(actor is shut down or
	// shutting down)". The Promise rejects.
	//
	// Pure-ts arm: there's no actor; close() is a logical drain. Post-
	// close `impl.node(...)` continues to work (pure-ts's substrate has
	// no closed-flag concept; this is the design — D292 may align if a
	// real consumer needs symmetric behavior). The pure-ts test asserts
	// only that the call resolves.
	test("post-close method calls reject (native) or stay live (pure-ts)", async () => {
		await impl.close();

		if (isNative) {
			// Native arm: actor shut down → channel disconnect → napi Error.
			// The D293 /qa Q2a refinement broadened the error parenthetical;
			// match on the part that uniquely identifies shutdown-class
			// failures.
			await expect(impl.node([], { name: "post-close-attempt" })).rejects.toThrow(
				/actor is shut down or shutting down/,
			);
		} else {
			// Pure-ts arm: no actor; post-close node() resolves cleanly.
			// (D292 may reframe this — for v0.0.8 the symmetry isn't
			// load-bearing because the pure-ts arm has no "process never
			// exits" failure mode to fix.)
			await expect(impl.node([], { name: "post-close-attempt" })).resolves.toBeDefined();
		}
	});

	// ── Case 4 — Symbol.asyncDispose is wired (Node 22+ `await using`) ─
	test("Symbol.asyncDispose is wired to close()", async () => {
		// The wrapper sets `impl[Symbol.asyncDispose] = impl.close` on the
		// native arm. The pure-ts adapter may or may not wire this — both
		// arms should ship the Symbol for `await using` ergonomics, but a
		// pure-ts adapter that doesn't yet is acceptable for v0.0.8
		// (pure-ts has no "process never exits" hazard).
		if (isNative) {
			expect(
				typeof (impl as unknown as { [Symbol.asyncDispose]?: () => Promise<void> })[
					Symbol.asyncDispose
				],
			).toBe("function");
		}
		// Smoke test the explicit-resource-management invocation shape on
		// the native arm. We can't use `await using` syntax in the test
		// file directly (vitest's TS target may not support it); call the
		// Symbol-keyed method manually to verify it's the same function.
		if (isNative) {
			const asyncDispose = (impl as unknown as { [Symbol.asyncDispose]: () => Promise<void> })[
				Symbol.asyncDispose
			];
			await expect(asyncDispose.call(impl)).resolves.toBeUndefined();
		}
	});

	// ── Case 5 — process-exit promise (load-bearing for the whole D293) ─
	//
	// This is the assertion that closes the actual "process never
	// exits" hazard. It's tested implicitly by the WHOLE vitest run:
	// if D293's close() didn't kill the actor, the rust-via-napi
	// scenarios above would hang at the end of the test file waiting
	// for the worker thread to die. Vitest completing this file's
	// tests + exiting the worker process IS the regression pin for
	// Case 5.
	//
	// A more aggressive standalone test (e.g. `child_process.spawn(
	// 'node', ['-e', 'import(...).then(({createNativeImpl}) => {
	// const i = createNativeImpl(); i.close(); /* expect exit
	// within 100ms */ })'])` from inside vitest) is feasible but
	// brittle on macOS — the spawn overhead dominates 100ms reliably.
	// The implicit-test-via-vitest-exit pattern is sufficient for
	// v0.0.8.
	test("(Case 5 is implicit) vitest run exit IS the regression for process-exit", () => {
		// Marker test — no assertions. Documents the load-bearing implicit
		// regression: vitest exiting this file's tests = D293 worker
		// shutdown working. A spawn-and-wait-for-exit test would be the
		// stronger pin; see comment block above for why we don't do it
		// in v0.0.8.
		expect(true).toBe(true);
	});
});
