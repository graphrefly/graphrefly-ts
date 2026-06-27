/**
 * M1 dispatcher parity — PAUSE / RESUME lock semantics (spec §2.6).
 *
 * D5 (post-rustImpl-activation parity cleanup). Authoring a green
 * cross-arm scenario surfaced a genuine §2.6 gap: what does a
 * **self-paused, default-`pausable: true` leaf source's own
 * `down([[DATA, v]])`** do? The dep-wave fn-suppression model that
 * governs default mode (suppress fn → coalesce → fire once on RESUME)
 * has nothing to apply to a source with no deps pushing its own value.
 *
 * **Resolved 2026-05-17 (spec call — Option A, user-pinned).** §2.6
 * R2.6.0: **default `pausable: true`** gating is dep-wave-scoped only —
 * a leaf source (no deps) has no dep wave to coalesce, so its own
 * direct external `down([[DATA, v]])` is **delivered immediately** in
 * default mode (cache advances, RESUME replays 0, no PAUSE tier
 * synthesized). This file pins exactly that **default-mode** contract
 * cross-impl. (`"resumeAll"` is NOT equivalent — it explicitly buffers
 * & replays the leaf source's direct push; that boundary is
 * raw-API-pinned in `packages/pure-ts/src/__tests__/core/protocol.test.ts`
 * "R2.6.0 boundary", NOT here: `pausable` is not on the `Impl` parity
 * contract and widening it is an out-of-scope cross-track public-API
 * decision.) Default mode is the single rule with no source carve-out,
 * consistent with the `pausable: false` row's "production-gating is
 * opt-in" reasoning.
 *
 * Both arms run the same test body. The **cross-impl pin** is the pair
 * of invariants asserted on BOTH arms: (1) DATA=42 observed before
 * RESUME, and (2) the DATA=42 count is unchanged across RESUME +
 * `cache === 42` (a phantom replay would bump the count). The explicit
 * `res.replayed === 0` check is a **rust-arm-only strengthening** — the
 * pure-ts `Impl` adapter's `resume()` returns `null` by legacy-API
 * design (`impls/pure-ts.ts`: `down([[RESUME]])` surfaces no report),
 * so the `if (res != null)` guard makes that line a no-op on pure-ts.
 * That is intentional and sufficient: invariant (2) catches a pure-ts
 * phantom-replay regression without the report. pure-ts is
 * pre-conformant by construction (`_pauseBuffer` allocated only for
 * `"resumeAll"`; the default-mode gate lives in the dep-wave path a
 * leaf source never traverses — `core/node.ts`). `@graphrefly/native`
 * converged 2026-05-17 (graphrefly-rs `ab133d7`: Core
 * `PausableMode::Default` no longer buffers a state node's direct
 * self-emit — was the `ResumeAll` contract mis-applied to Default;
 * local commit, napi rebuilt into the linked parity arm; see
 * `docs/cross-track-ledger.md` §2).
 *
 * Rust port reference: Core PAUSE/RESUME lock-set + Default-mode
 * leaf-source self-emit pass-through (Slice M1; converged
 * graphrefly-rs ab133d7).
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("M1 PAUSE/RESUME self-pause parity — $name", (impl) => {
	test("default-pausable leaf source: self-emitted DATA delivers immediately, NOT deferred behind the pause (spec §2.6 Option A)", async () => {
		const src = await impl.node<number>([], { initial: 1, name: "src" });

		const seen: Array<readonly [symbol, unknown]> = [];
		const unsub = await src.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
		});
		try {
			expect(src.cache).toBe(1);

			const lockId = await src.allocLockId();
			await src.pause(lockId);

			// A self-paused, default-`pausable: true` leaf source's own
			// `down([[DATA, v]])` is NOT deferred: default mode only gates
			// dep-wave fn re-execution, and a source has no dep wave. The
			// settle slice flows through `_emit` to the sink at `down()`
			// time — before RESUME.
			//
			// "Before RESUME" is proven by reading `seen` after `down()`
			// resolves but before `resume()` is called. This relies on the
			// `Impl` adapter contract (true for both arms by design): an
			// awaited `down()` resolves only AFTER the wave drained and all
			// sinks fired (pure-ts `down()` is sync-inline; the native
			// wrapper awaits the sink dispatch across the napi boundary —
			// `impls/types.ts` `down` doc). If that contract regressed,
			// `dataIdxBeforeResume` would be -1 and this test fails loudly.
			seen.length = 0;
			await src.down([[impl.DATA, 42]]);

			const dataIdxBeforeResume = seen.findIndex(([t, v]) => t === impl.DATA && v === 42);
			expect(dataIdxBeforeResume).toBeGreaterThanOrEqual(0); // delivered NOW, not on resume
			expect(src.cache).toBe(42); // state advanced immediately

			// RESUME is a no-op for the already-delivered self-emit: default
			// mode never buffered it, so resume replays nothing (no phantom
			// re-delivery, no second DATA).
			const dataCountBeforeResume = seen.filter(([t, v]) => t === impl.DATA && v === 42).length;
			const res = await src.resume(lockId);
			const dataCountAfterResume = seen.filter(([t, v]) => t === impl.DATA && v === 42).length;

			expect(dataCountAfterResume).toBe(dataCountBeforeResume); // no replay (cross-arm invariant)
			expect(src.cache).toBe(42); // (cross-arm invariant)
			// Rust-arm-only strengthening: native surfaces a resume report;
			// the pure-ts adapter returns `null` by legacy-API design, so
			// this line is a no-op on pure-ts (the cross-arm guarantee is
			// the count+cache invariants above — see file header).
			if (res != null) {
				expect(res.replayed).toBe(0);
			}
		} finally {
			await unsub();
		}
	});
});
