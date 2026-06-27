/**
 * Slice X4 (2026-05-08) — D2 fix parity surface.
 *
 * Covers the no-regression contract for the per-emit sink snapshot
 * refactor: when a wave emits multiple values to the same node and the
 * subscriber set is stable, the X4 revision-tracked `PendingBatch`
 * implementation collapses everything into a single batch with no
 * behavior change versus pre-X4 — both impls must observe the same
 * `[Dirty, Data(h1), Data(h2), Data(h3)]` sequence.
 *
 * **The canonical D2 case — multi-emit + late-subscribe in the same
 * wave — is NOT covered here.** The bug is structurally Rust-only: the
 * pure-TS dispatcher snapshots subscribers AT DELIVERY TIME PER EMIT
 * (synchronous per-emit dispatch), not at the per-wave flush time, so
 * the late-subscriber gap is unreachable in pure-TS. Reaching it
 * requires expressing `emit + subscribe + emit` inside a single Core
 * wave, which the current `Impl` interface does not expose
 * (`Impl.batch(closure)` was considered and deferred — Rust's
 * `core.batch(|| {...})` is sync and JS closures can't naturally span
 * the `parking_lot::ReentrantMutex` thread-affinity contract that
 * `BatchGuard` holds across napi `spawn_blocking` calls).
 *
 * The full D2 test coverage lives in the cargo regression file
 * `crates/graphrefly-core/tests/sink_snapshot.rs` (4 tests). See the
 * Slice X4 closing entry in `migration-status.md` for the full
 * scenario list.
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("Slice X4 sink snapshot parity — $name", (impl) => {
	test("multi-emit with stable subscriber set delivers all Data values in arrival order", async () => {
		const n = await impl.node<number>([], { initial: 0, name: "x4_stable" });

		const data: number[] = [];
		const unsubscribe = await n.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === impl.DATA) data.push(m[1] as number);
			}
		});
		try {
			// Three emits in close succession — pre-X4 they shared one
			// PendingPerNode entry; post-X4 they share one PendingBatch
			// (subscribers_revision unchanged across the wave). Either way,
			// the subscriber observes all three in arrival order.
			await n.down([
				[impl.DATA, 1],
				[impl.DATA, 2],
				[impl.DATA, 3],
			]);

			// Initial value 0 from handshake + 3 wave emits.
			expect(data).toEqual([0, 1, 2, 3]);
		} finally {
			await unsubscribe();
		}
	});
});
