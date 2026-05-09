/**
 * Phase 14.6 / DS-14-storage parity scenarios — frame format + replay
 * ordering invariants that both impls must honor byte-for-byte.
 *
 * **Pure-TS-only at first.** When `@graphrefly/native` exposes
 * `attachSnapshotStorage` + `restoreSnapshot`, lift these onto the
 * cross-impl `Impl` interface and convert to `describe.each(impls)`. See
 * [README.md](./README.md) for the activation schedule.
 *
 * @module
 */

import {
	Graph,
	graphWalPrefix,
	kvStorage,
	memoryBackend,
	memorySnapshot,
	node,
	REPLAY_ORDER,
	verifyWalFrameChecksum,
	type WALFrame,
	walFrameChecksum,
	walFrameKey,
} from "@graphrefly/pure-ts";
import { describe, expect, it } from "vitest";

async function settle(): Promise<void> {
	await new Promise((r) => setTimeout(r, 20));
}

describe("storage-wal parity (pure-ts arm)", () => {
	describe("WALFrame format", () => {
		it("checksum is a stable 64-char hex string", async () => {
			const body: Omit<WALFrame, "checksum"> = {
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
			const checksum = await walFrameChecksum(body);
			expect(checksum).toMatch(/^[0-9a-f]{64}$/);
			// Stable across calls
			expect(await walFrameChecksum(body)).toBe(checksum);
		});

		it("verifies fresh frames and rejects tamper", async () => {
			const body: Omit<WALFrame, "checksum"> = {
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
			const frame: WALFrame = { ...body, checksum: await walFrameChecksum(body) };
			expect(await verifyWalFrameChecksum(frame)).toBe(true);
			expect(await verifyWalFrameChecksum({ ...frame, frame_seq: 999 })).toBe(false);
		});

		it("walFrameKey gives lex-ASC = numeric ASC", () => {
			expect(walFrameKey("p", 1)).toBe("p/00000000000000000001");
			const keys = [walFrameKey("p", 2), walFrameKey("p", 1), walFrameKey("p", 10)];
			const sorted = [...keys].sort();
			expect(sorted).toEqual([
				"p/00000000000000000001",
				"p/00000000000000000002",
				"p/00000000000000000010",
			]);
		});
	});

	describe("Replay ordering invariants", () => {
		it("REPLAY_ORDER is locked at spec → data → ownership", () => {
			expect([...REPLAY_ORDER]).toEqual(["spec", "data", "ownership"]);
		});

		it("frame_seq > baseline.seq filter recovers post-baseline state", async () => {
			const author = new Graph("g");
			author.add(node([], { initial: 0, name: "a" }), { name: "a" });
			const snapTier = memorySnapshot({ name: "g", compactEvery: 100 });
			const walTier = kvStorage(memoryBackend(), { name: "g-wal" });
			const h = author.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
			await settle();
			author.set("a", 21);
			await settle();
			author.set("a", 42);
			await settle();
			h.dispose();

			const replayer = new Graph("g");
			replayer.add(node([], { initial: 0, name: "a" }), { name: "a" });
			const result = await replayer.restoreSnapshot({
				mode: "diff",
				source: { tier: snapTier, walTier },
			});
			expect(replayer.node("a").cache).toBe(42);
			expect(result.replayedFrames).toBeGreaterThan(0);
		});

		it("listByPrefix yields entries in frame_seq ASC", async () => {
			const author = new Graph("g");
			author.add(node([], { initial: 0, name: "a" }), { name: "a" });
			const snapTier = memorySnapshot({ name: "g", compactEvery: 100 });
			const walTier = kvStorage(memoryBackend(), { name: "g-wal" });
			const h = author.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
			await settle();
			author.set("a", 1);
			await settle();
			author.set("a", 2);
			await settle();
			author.set("a", 3);
			await settle();
			h.dispose();

			const seqs: number[] = [];
			for await (const e of walTier.listByPrefix?.<WALFrame>(`${graphWalPrefix("g")}/`) ?? []) {
				seqs.push(e.value.frame_seq);
			}
			const sorted = [...seqs].sort((a, b) => a - b);
			expect(seqs).toEqual(sorted);
		});
	});
});
