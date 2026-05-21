/**
 * D270 cross-arm parity — `ReactiveLog.attach(upstream, { skipCachedReplay })`.
 *
 * Cross-track-ledger §2 (closed 2026-05-21, memo:Re P2 native side):
 * `skipCachedReplay: true` drops the FIRST DATA-bearing batch the attach
 * sink receives, gated on `upstream.cache !== undefined`. Live emissions
 * after the first DATA batch still land. The flag has no effect when the
 * upstream's cache is sentinel (cold upstream's first live emit MUST
 * still reach the log).
 *
 * Substrate:
 *  - pure-ts: `packages/pure-ts/src/extra/data-structures/reactive-log.ts`
 *    `attach` (1st-DATA-batch suppression via cache-gated flag, robust to
 *    batch-deferred replay).
 *  - rust:    `~/src/graphrefly-rs/crates/graphrefly-structures/src/reactive.rs`
 *    `ReactiveLog::attach_with_options(AttachOptions { skip_cached_replay })`.
 *
 * Not covered cross-arm (deferred per `porting-deferred.md` D266-D270 head):
 *  - (b) `replayBuffer:N` interaction — Rust substrate has no `replayBuffer`
 *    shape; replay buffer is a pure-ts construct. Covered pure-ts-only in
 *    `packages/pure-ts/src/extra/data-structures/__tests__/reactive-log.test.ts`.
 *  - (d) `attach` invoked inside `batch()` — requires substrate wave-end
 *    defer support for in-wave attach; not on the cross-impl contract today.
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("D270 ReactiveLog.attach skipCachedReplay — $name", (impl) => {
	const hasStructures = () => impl.structures != null;

	test.runIf(hasStructures())(
		"default attach (no opts) replays cached upstream into the log",
		async () => {
			const s = impl.structures!;
			const log = s.reactiveLog<number>();
			const upstream = await impl.node<number>([], { name: "up", initial: 42 });
			const off = await log.attach(upstream);
			try {
				// Push-on-subscribe handshake delivers the cached DATA (42)
				// through the attach sink → log records it.
				expect(log.size).toBe(1);
				expect(log.at(0)).toBe(42);
			} finally {
				await off();
			}
		},
	);

	test.runIf(hasStructures())(
		"skipCachedReplay:true drops ONLY the cached handshake (next live emit lands)",
		async () => {
			const s = impl.structures!;
			const log = s.reactiveLog<number>();
			const upstream = await impl.node<number>([], { name: "up", initial: 42 });
			const off = await log.attach(upstream, { skipCachedReplay: true });
			try {
				// Cached-value handshake suppressed — log remains empty.
				expect(log.size).toBe(0);
				// First-batch-only boundary: an immediate follow-up live emit
				// MUST land. A regression where `skipCachedReplay` dropped
				// every DATA batch (not just the first) would fail here. Keeps
				// the "first batch only" invariant testable in a single
				// self-contained scenario rather than relying on a sibling
				// test as the backstop.
				await upstream.down([[impl.DATA, 99]]);
				expect(log.size).toBe(1);
				expect(log.at(0)).toBe(99);
			} finally {
				await off();
			}
		},
	);

	test.runIf(hasStructures())(
		"skipCachedReplay:true on a cached upstream still lets subsequent live emits land",
		async () => {
			const s = impl.structures!;
			const log = s.reactiveLog<number>();
			const upstream = await impl.node<number>([], { name: "up", initial: 42 });
			const off = await log.attach(upstream, { skipCachedReplay: true });
			try {
				expect(log.size).toBe(0);
				await upstream.down([[impl.DATA, 7]]);
				expect(log.size).toBe(1);
				expect(log.at(0)).toBe(7);
				await upstream.down([[impl.DATA, 9]]);
				expect(log.size).toBe(2);
				expect(log.at(1)).toBe(9);
			} finally {
				await off();
			}
		},
	);

	test.runIf(hasStructures())(
		"skipCachedReplay:true is a no-op on a cold upstream (first live emit still lands)",
		async () => {
			const s = impl.structures!;
			const log = s.reactiveLog<number>();
			// No `initial:` — upstream cache is SENTINEL; the suppression must
			// gate on cache-present and NOT swallow the first live emit.
			const upstream = await impl.node<number>([], { name: "up" });
			const off = await log.attach(upstream, { skipCachedReplay: true });
			try {
				expect(log.size).toBe(0);
				await upstream.down([[impl.DATA, 100]]);
				expect(log.size).toBe(1);
				expect(log.at(0)).toBe(100);
			} finally {
				await off();
			}
		},
	);

	test.runIf(hasStructures())(
		"skipCachedReplay:false (explicit) replays cached value (parity with default)",
		async () => {
			const s = impl.structures!;
			const log = s.reactiveLog<number>();
			const upstream = await impl.node<number>([], { name: "up", initial: 5 });
			const off = await log.attach(upstream, { skipCachedReplay: false });
			try {
				expect(log.size).toBe(1);
				expect(log.at(0)).toBe(5);
			} finally {
				await off();
			}
		},
	);
});
