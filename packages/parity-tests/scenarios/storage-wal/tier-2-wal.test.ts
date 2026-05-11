/**
 * M4.F Tier 2 parity scenarios — WAL format + utilities.
 *
 * walFrameKey lexicographic ordering, walFrameChecksum stability,
 * verifyWalFrameChecksum, replayOrder constant. These are pure-function
 * tests that validate the WAL frame format across both impls.
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("M4.F Tier 2 — WAL utilities — $name", (impl) => {
	const hasStorage = () => impl.storage != null;

	// ── walFrameKey ─────────────────────────────────────────────────────

	describe("walFrameKey", () => {
		test.runIf(hasStorage())("produces prefix/zero-padded-seq format", () => {
			const s = impl.storage!;
			expect(s.walFrameKey("p", 1)).toBe("p/00000000000000000001");
			expect(s.walFrameKey("p", 42)).toBe("p/00000000000000000042");
		});

		test.runIf(hasStorage())("lex sort = numeric sort", () => {
			const s = impl.storage!;
			const keys = [s.walFrameKey("p", 10), s.walFrameKey("p", 2), s.walFrameKey("p", 1)];
			const sorted = [...keys].sort();
			expect(sorted).toEqual([
				s.walFrameKey("p", 1),
				s.walFrameKey("p", 2),
				s.walFrameKey("p", 10),
			]);
		});
	});

	// ── walFrameChecksum ────────────────────────────────────────────────

	describe("walFrameChecksum", () => {
		test.runIf(hasStorage())("returns a stable 64-char hex string", async () => {
			const s = impl.storage!;
			const body = {
				t: "c",
				lifecycle: "data",
				path: "n",
				change: {
					structure: "graph.value",
					version: 1,
					t_ns: 1,
					lifecycle: "data",
					change: { kind: "node.set", path: "n", value: 1 },
				},
				frame_seq: 1,
				frame_t_ns: 1,
			};
			const checksum = await s.walFrameChecksum(body);
			expect(checksum).toMatch(/^[0-9a-f]{64}$/);
			// Stable across calls
			expect(await s.walFrameChecksum(body)).toBe(checksum);
		});
	});

	// ── verifyWalFrameChecksum ──────────────────────────────────────────

	describe("verifyWalFrameChecksum", () => {
		test.runIf(hasStorage())("verifies a correct checksum", async () => {
			const s = impl.storage!;
			const body = {
				t: "c",
				lifecycle: "data",
				path: "n",
				change: {
					structure: "graph.value",
					version: 1,
					t_ns: 1,
					lifecycle: "data",
					change: { kind: "node.set", path: "n", value: 1 },
				},
				frame_seq: 1,
				frame_t_ns: 1,
			};
			const checksum = await s.walFrameChecksum(body);
			const frame = { ...body, checksum };
			expect(await s.verifyWalFrameChecksum(frame)).toBe(true);
		});

		test.runIf(hasStorage())("rejects a tampered frame", async () => {
			const s = impl.storage!;
			const body = {
				t: "c",
				lifecycle: "data",
				path: "n",
				change: {
					structure: "graph.value",
					version: 1,
					t_ns: 1,
					lifecycle: "data",
					change: { kind: "node.set", path: "n", value: 1 },
				},
				frame_seq: 1,
				frame_t_ns: 1,
			};
			const checksum = await s.walFrameChecksum(body);
			const tampered = { ...body, checksum, frame_seq: 999 };
			expect(await s.verifyWalFrameChecksum(tampered)).toBe(false);
		});
	});

	// ── walReplayOrder ──────────────────────────────────────────────────

	describe("walReplayOrder", () => {
		test.runIf(hasStorage())("locked at spec → data → ownership", () => {
			const s = impl.storage!;
			expect(s.walReplayOrder()).toEqual(["spec", "data", "ownership"]);
		});
	});

	// ── Checkpoint + WAL KV tiers ───────────────────────────────────────

	describe("checkpoint + WAL KV tiers", () => {
		test.runIf(hasStorage())("checkpoint save + flush + load round-trips", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.checkpointSnapshotTier(backend, { name: "cp" });
			const record = {
				name: "g",
				seq: 1,
				timestamp_ns: 100,
				format_version: 1,
				mode: "full",
				snapshot: { name: "g", nodes: [], edges: [], subgraphs: [] },
			};
			tier.save(record);
			tier.flush();
			const loaded = tier.load();
			expect(loaded).toEqual(record);
		});

		test.runIf(hasStorage())("WAL KV save + flush + load round-trips a frame", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.walKvTier(backend, { name: "wal" });
			const frame = {
				t: "c",
				lifecycle: "data",
				path: "n",
				change: {
					structure: "graph.value",
					version: 1,
					t_ns: 1,
					lifecycle: "data",
					change: { kind: "node.set", path: "n", value: 42 },
				},
				frame_seq: 1,
				frame_t_ns: 1,
				checksum: "abc",
			};
			const key = s.walFrameKey("wal", 1);
			tier.save(key, frame);
			tier.flush();
			expect(tier.load(key)).toEqual(frame);
		});

		test.runIf(hasStorage())("WAL KV list + delete", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.walKvTier(backend, { name: "wal" });
			const k1 = s.walFrameKey("wal", 1);
			const k2 = s.walFrameKey("wal", 2);
			tier.save(k1, {
				t: "c",
				lifecycle: "data",
				path: "a",
				change: {},
				frame_seq: 1,
				frame_t_ns: 1,
				checksum: "x",
			});
			tier.save(k2, {
				t: "c",
				lifecycle: "data",
				path: "b",
				change: {},
				frame_seq: 2,
				frame_t_ns: 2,
				checksum: "y",
			});
			tier.flush();
			expect(tier.list("wal/").sort()).toEqual([k1, k2].sort());

			tier.delete(k1);
			tier.flush();
			expect(tier.list("wal/")).toEqual([k2]);
		});
	});
});
