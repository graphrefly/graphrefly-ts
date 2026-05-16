/**
 * Slice X3 / Phase E /qa F17 — regression test for
 * `BenchCore::setReleaseCallback` re-install semantics.
 *
 * The napi binding's `set_release_callback` does
 * `*release_callback.lock() = Some(Arc::new(tsfn))` — the previous
 * Arc-wrapped TSFN drops on assignment, releasing the napi reference.
 * This test asserts:
 *
 * 1. After a re-install, only the NEW callback receives release
 *    notifications.
 * 2. The OLD callback does NOT continue firing (no double-delivery).
 *
 * Rust-only — `pure-ts` doesn't have TSFN-backed release
 * callbacks; this is a Rust binding regression test, not a
 * cross-impl parity test. Gated `test.runIf(impl.name === "rust-via-napi")`.
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("F17 release_callback re-install — $name", (impl) => {
	test.runIf(impl.name === "rust-via-napi")(
		"second setReleaseCallback overrides first; old TSFN no longer fires",
		async () => {
			// This Rust-only regression test pokes the raw napi `BenchCore`
			// directly to control the release-callback lifecycle. Since the
			// Option C slice (D206/D207) added an `exports` map — bare
			// `@graphrefly/native` now resolves to the hand-written async
			// wrapper — the raw napi classes live at the `/napi` subpath.
			const native = require("@graphrefly/native/napi") as typeof import("@graphrefly/native/napi");
			const core = new native.BenchCore();

			const aReleases: number[] = [];
			const bReleases: number[] = [];

			// Install callback A.
			core.setReleaseCallback((h: number) => {
				aReleases.push(h);
			});

			// Allocate two JS handles and use them; the second emit releases
			// the first → fires the currently-installed release callback.
			const h1 = core.allocExternalHandle();
			const s = await core.registerStateWithHandle(h1);

			// Re-install: callback B replaces A. The first install's TSFN
			// should drop on assignment.
			core.setReleaseCallback((h: number) => {
				bReleases.push(h);
			});

			// Trigger h1's release by emitting a different handle on the
			// state node. The old handle's refcount drops to 0 → release
			// callback fires (NonBlocking; libuv pump).
			const h2 = core.allocExternalHandle();
			await core.emitHandle(s, h2);

			// Slice X3 /qa Group 2 #4: poll for TSFN delivery instead of a
			// fixed `setTimeout(50)` — flake-prone on slow CI runners.
			// `setImmediate` cycles are ~1ms each; 500ms total budget covers
			// any realistic libuv pump latency.
			const pollDeadline = Date.now() + 500;
			while (bReleases.length === 0 && Date.now() < pollDeadline) {
				await new Promise((r) => setImmediate(r));
			}

			// Callback B should have received h1's release.
			expect(bReleases).toContain(h1);
			// Callback A should have received NOTHING after re-install.
			expect(aReleases.length).toBe(0);

			await core.dispose();
		},
	);
});
