/**
 * D268 + D269 cross-arm parity — `appendLogTier` durability, rollback
 * epoch, mode ("append" | "overwrite"), and windowed `loadEntriesPaged`.
 *
 * Cross-track-ledger §2 (closed 2026-05-21):
 * - D268 memo:Re P0 — rollback epoch + write-fault restore-path correctness.
 * - D269 memo:Re P1 — `mode: "append" | "overwrite"` accessor + behavior.
 * - D269 (pagination part) — `loadEntriesPaged({cursor, pageSize})` + bare
 *   `loadEntries()` back-compat.
 *
 * Substrate: `packages/pure-ts/src/extra/storage/tiers.ts` `appendLogStorage`;
 * `~/src/graphrefly-rs/crates/graphrefly-storage/src/tier.rs` `AppendLogStorage`.
 *
 * Not covered cross-arm (Rust-internal correctness; covered by cargo tests):
 * - Concurrent rollback-during-flush epoch abort (D268 P0(a)) — requires a
 *   fault-injecting backend; lives in `crates/graphrefly-storage/tests/tier.rs`.
 * - Write-fault retry restore-path no-duplicate (D268 /qa-fix) — same.
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("D268/D269 appendLogTier — mode + rollback + pagination — $name", (impl) => {
	const hasStorage = () => impl.storage != null;

	// ── D269 — mode accessor + overwrite behavior ───────────────────────

	describe("mode accessor", () => {
		test.runIf(hasStorage())("default (no opts) reports 'append'", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.appendLogTier(backend, { name: "log" });
			expect(tier.mode).toBe("append");
		});

		test.runIf(hasStorage())("mode:'append' reports 'append'", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.appendLogTier(backend, { name: "log", mode: "append" });
			expect(tier.mode).toBe("append");
		});

		test.runIf(hasStorage())("mode:'overwrite' reports 'overwrite'", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.appendLogTier(backend, { name: "log", mode: "overwrite" });
			expect(tier.mode).toBe("overwrite");
		});
	});

	describe("mode behavior per flush", () => {
		test.runIf(hasStorage())("overwrite mode: each flush wins; no read-merge", async () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.appendLogTier(backend, { name: "log", mode: "overwrite" });
			await tier.appendEntries([{ a: 1 }, { a: 2 }]);
			await tier.flush();
			expect(await tier.loadEntries()).toEqual([{ a: 1 }, { a: 2 }]);

			// Second flush in overwrite mode REPLACES the bucket — pre-D269
			// (append mode) would accumulate.
			await tier.appendEntries([{ a: 3 }]);
			await tier.flush();
			expect(await tier.loadEntries()).toEqual([{ a: 3 }]);
		});

		test.runIf(hasStorage())(
			"append mode: accumulates across flushes (baseline regression guard)",
			async () => {
				const s = impl.storage!;
				const backend = s.memoryBackend();
				const tier = s.appendLogTier(backend, { name: "log", mode: "append" });
				await tier.appendEntries([{ a: 1 }]);
				await tier.flush();
				await tier.appendEntries([{ a: 2 }]);
				await tier.flush();
				expect(await tier.loadEntries()).toEqual([{ a: 1 }, { a: 2 }]);
			},
		);
	});

	// ── D268 — rollback epoch semantics ─────────────────────────────────

	describe("rollback semantics (D268 epoch)", () => {
		test.runIf(hasStorage())("rollback clears pending before flush", async () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.appendLogTier(backend, { name: "log", debounceMs: 999 });
			await tier.appendEntries([{ a: 1 }]);
			await tier.flush();
			await tier.appendEntries([{ a: 2 }]);
			await tier.appendEntries([{ a: 3 }]);
			tier.rollback();
			await tier.flush();
			// The two pending appends were discarded — only the pre-rollback
			// flush survives.
			expect(await tier.loadEntries()).toEqual([{ a: 1 }]);
		});

		test.runIf(hasStorage())(
			"rollback after flush is a no-op (durable writes survive)",
			async () => {
				const s = impl.storage!;
				const backend = s.memoryBackend();
				const tier = s.appendLogTier(backend, { name: "log" });
				await tier.appendEntries([{ a: 1 }, { a: 2 }]);
				await tier.flush();
				tier.rollback();
				expect(await tier.loadEntries()).toEqual([{ a: 1 }, { a: 2 }]);
			},
		);

		test.runIf(hasStorage())(
			"appendEntries-after-rollback land on the next flush (epoch advanced)",
			async () => {
				const s = impl.storage!;
				const backend = s.memoryBackend();
				const tier = s.appendLogTier(backend, { name: "log", debounceMs: 999 });
				await tier.appendEntries([{ stale: true }]);
				tier.rollback();
				// New entries written AFTER rollback are under the new epoch and
				// must flush durably.
				await tier.appendEntries([{ fresh: true }]);
				await tier.flush();
				expect(await tier.loadEntries()).toEqual([{ fresh: true }]);
			},
		);
	});

	// ── D269 — windowed cursor pagination ───────────────────────────────

	describe("loadEntriesPaged (D269 windowed cursor)", () => {
		test.runIf(hasStorage())("bare loadEntries() returns the whole log (back-compat)", async () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.appendLogTier(backend, { name: "log" });
			await tier.appendEntries([1, 2, 3, 4, 5]);
			await tier.flush();
			const all = await tier.loadEntries();
			expect(all).toEqual([1, 2, 3, 4, 5]);
		});

		test.runIf(hasStorage())(
			"loadEntriesPaged({ pageSize }) returns first page + cursor",
			async () => {
				const s = impl.storage!;
				const backend = s.memoryBackend();
				const tier = s.appendLogTier(backend, { name: "log" });
				expect(tier.loadEntriesPaged).toBeDefined();
				await tier.appendEntries([10, 20, 30, 40, 50]);
				await tier.flush();
				const page = await tier.loadEntriesPaged!({ pageSize: 2 });
				expect(page.entries).toEqual([10, 20]);
				expect(page.cursor).toBeDefined();
				expect(page.cursor!.position).toBe(2);
			},
		);

		test.runIf(hasStorage())(
			"cursor-walk visits every entry exactly once with strict forward progress",
			async () => {
				const s = impl.storage!;
				const backend = s.memoryBackend();
				const tier = s.appendLogTier(backend, { name: "log" });
				expect(tier.loadEntriesPaged).toBeDefined();
				await tier.appendEntries([1, 2, 3, 4, 5, 6, 7]);
				await tier.flush();

				// Walk the log in pages of 3 over a 7-entry log → expected
				// page sequence: [1,2,3] cursor@3 → [4,5,6] cursor@6 → [7]
				// cursor=undefined. Assert per-page entries (pageSize is
				// respected per page) AND per-iter cursor positions (strict
				// monotonic advance — catches a stuck/rewound cursor).
				const pages: { entries: unknown[]; position: number | undefined }[] = [];
				let cursor: { position: number } | undefined;
				let safety = 10;
				do {
					const page = await tier.loadEntriesPaged!({ pageSize: 3, cursor });
					pages.push({
						entries: page.entries,
						position: page.cursor ? page.cursor.position : undefined,
					});
					cursor = page.cursor;
					safety--;
				} while (cursor !== undefined && safety > 0);

				// Loop terminated by cursor===undefined, NOT by safety
				// exhaustion (would mask a stuck-cursor regression).
				expect(safety).toBeGreaterThan(0);

				// Per-page entry shape (each page respects the pageSize bound;
				// final partial page is allowed).
				expect(pages.map((p) => p.entries)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);

				// Per-iter cursor positions strictly advance; final page
				// signals termination via undefined.
				expect(pages.map((p) => p.position)).toEqual([3, 6, undefined]);
			},
		);

		test.runIf(hasStorage())(
			"pageSize larger than log returns all entries + cursor undefined",
			async () => {
				const s = impl.storage!;
				const backend = s.memoryBackend();
				const tier = s.appendLogTier(backend, { name: "log" });
				expect(tier.loadEntriesPaged).toBeDefined();
				await tier.appendEntries([1, 2, 3]);
				await tier.flush();
				const page = await tier.loadEntriesPaged!({ pageSize: 100 });
				expect(page.entries).toEqual([1, 2, 3]);
				expect(page.cursor).toBeUndefined();
			},
		);

		test.runIf(hasStorage())("cursor past end yields empty page + cursor undefined", async () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.appendLogTier(backend, { name: "log" });
			expect(tier.loadEntriesPaged).toBeDefined();
			await tier.appendEntries([1, 2, 3]);
			await tier.flush();
			const past = await tier.loadEntriesPaged!({
				pageSize: 5,
				cursor: { position: 10 },
			});
			expect(past.entries).toEqual([]);
			expect(past.cursor).toBeUndefined();
		});

		test.runIf(hasStorage())(
			"empty log + pagination returns empty page + cursor undefined",
			async () => {
				const s = impl.storage!;
				const backend = s.memoryBackend();
				const tier = s.appendLogTier(backend, { name: "log" });
				expect(tier.loadEntriesPaged).toBeDefined();
				const page = await tier.loadEntriesPaged!({ pageSize: 5 });
				expect(page.entries).toEqual([]);
				expect(page.cursor).toBeUndefined();
			},
		);
	});
});
