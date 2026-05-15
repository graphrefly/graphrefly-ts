/**
 * WAL substrate tests (Phase 14.6 — DS-14-storage). Covers `WALFrame`
 * checksums, `BaseStorageTier.listByPrefix` lazy iteration,
 * `attachSnapshotStorage` paired-tier WAL emission, and
 * `Graph.restoreSnapshot({ mode: "diff" })` replay (lifecycle ordering,
 * torn-write tail drop / mid-stream abort, INVALIDATE persistence).
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";

import { node } from "../../core/node.js";
import { kvStorage, memoryBackend, memorySnapshot } from "../../extra/storage/tiers.js";
import {
	graphWalPrefix,
	REPLAY_ORDER,
	RestoreError,
	StorageError,
	verifyWalFrameChecksum,
	type WALFrame,
	walFrameChecksum,
	walFrameKey,
} from "../../extra/storage/wal.js";
import { Graph } from "../../graph/graph.js";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Wait until `tier.savePending`-style async chains drain. */
async function settle(): Promise<void> {
	await new Promise((r) => setTimeout(r, 20));
}

// ── walFrameChecksum / verifyWalFrameChecksum ─────────────────────────────

describe("walFrameChecksum", () => {
	it("returns 64 hex chars (SHA-256)", async () => {
		const frame: Omit<WALFrame, "checksum"> = {
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
		const sum = await walFrameChecksum(frame);
		expect(sum).toMatch(/^[0-9a-f]{64}$/);
	});

	it("is stable across runs for identical input", async () => {
		const frame: Omit<WALFrame, "checksum"> = {
			t: "c",
			lifecycle: "spec",
			path: "x",
			change: {
				structure: "graph.spec",
				version: 1,
				t_ns: 42,
				lifecycle: "spec",
				change: { kind: "graph.add", nodeId: "x" },
			},
			frame_seq: 5,
			frame_t_ns: 100,
		};
		const a = await walFrameChecksum(frame);
		const b = await walFrameChecksum(frame);
		expect(a).toBe(b);
	});

	it("verifyWalFrameChecksum returns true on a fresh frame and false on tamper", async () => {
		const body: Omit<WALFrame, "checksum"> = {
			t: "c",
			lifecycle: "data",
			path: "n",
			change: {
				structure: "graph.value",
				version: 1,
				t_ns: 7,
				lifecycle: "data",
				change: { kind: "node.set", path: "n", value: 99 },
			},
			frame_seq: 1,
			frame_t_ns: 7,
		};
		const checksum = await walFrameChecksum(body);
		const frame: WALFrame = { ...body, checksum };
		expect(await verifyWalFrameChecksum(frame)).toBe(true);

		// Tamper: bump frame_seq without re-checksumming → must reject.
		const torn: WALFrame = { ...frame, frame_seq: 999 };
		expect(await verifyWalFrameChecksum(torn)).toBe(false);
	});
});

// ── kvStorage.listByPrefix ────────────────────────────────────────────────

describe("kvStorage.listByPrefix (Phase 14.6 / DS-14-storage Q5)", () => {
	it("yields entries in lex-ASC key order", async () => {
		const tier = kvStorage<{ n: number }>(memoryBackend());
		await tier.save("p/00000000000000000003", { n: 3 });
		await tier.save("p/00000000000000000001", { n: 1 });
		await tier.save("p/00000000000000000002", { n: 2 });
		await tier.flush?.();

		const collected: string[] = [];
		for await (const entry of tier.listByPrefix?.<{ n: number }>("p/") ?? []) {
			collected.push(entry.key);
		}
		expect(collected).toEqual([
			"p/00000000000000000001",
			"p/00000000000000000002",
			"p/00000000000000000003",
		]);
	});

	it("filters strictly by literal byte-prefix (no glob)", async () => {
		const tier = kvStorage<{ n: number }>(memoryBackend());
		await tier.save("a/1", { n: 1 });
		await tier.save("ab/2", { n: 2 });
		await tier.save("b/3", { n: 3 });
		await tier.flush?.();

		const aKeys: string[] = [];
		for await (const e of tier.listByPrefix?.("a/") ?? []) aKeys.push(e.key);
		expect(aKeys).toEqual(["a/1"]);
	});

	it('throws StorageError("backend-no-list-support") when backend.list is missing', async () => {
		const noList = {
			name: "no-list",
			read() {
				return undefined;
			},
			write() {},
		};
		const tier = kvStorage<{ n: number }>(noList);
		await expect(async () => {
			for await (const _ of tier.listByPrefix?.("p/") ?? []) {
				/* drain */
			}
		}).rejects.toBeInstanceOf(StorageError);
	});
});

// ── walFrameKey ───────────────────────────────────────────────────────────

describe("walFrameKey", () => {
	it("zero-pads to 20 digits for lex-ASC = numeric ASC", () => {
		expect(walFrameKey("g/wal", 1)).toBe("g/wal/00000000000000000001");
		expect(walFrameKey("g/wal", 12345)).toBe("g/wal/00000000000000012345");
	});

	it("rejects negative or non-integer frame_seq", () => {
		expect(() => walFrameKey("p", -1)).toThrow(RangeError);
		expect(() => walFrameKey("p", 1.5)).toThrow(RangeError);
	});
});

// ── attachSnapshotStorage paired tier shape ───────────────────────────────

describe("attachSnapshotStorage paired tier shape (Q3 lock B)", () => {
	it('emits a mode:"full" baseline on first write', async () => {
		const g = new Graph("g");
		g.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const snapTier = memorySnapshot({ name: "g", compactEvery: 10 });
		const walBackend = memoryBackend();
		const walTier = kvStorage(walBackend, { name: "g-wal" });
		const h = g.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
		await settle();
		g.set("a", 1);
		await settle();
		const baseline = (await snapTier.load?.()) as { mode: string; seq: number } | undefined;
		expect(baseline?.mode).toBe("full");
		expect(baseline?.seq).toBeGreaterThan(0);
		h.dispose();
	});

	it("emits WAL frames to walTier between baselines", async () => {
		const g = new Graph("g");
		g.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const snapTier = memorySnapshot({ name: "g", compactEvery: 10 });
		const walBackend = memoryBackend();
		const walTier = kvStorage(walBackend, { name: "g-wal" });
		const h = g.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
		await settle();

		// First flush emits a baseline (isFirst=true). Subsequent flushes
		// should emit WAL frames until compactEvery hits.
		g.set("a", 1);
		await settle();
		g.set("a", 2);
		await settle();
		g.set("a", 3);
		await settle();

		const walKeys: string[] = [];
		for await (const e of walTier.listByPrefix?.(`${graphWalPrefix("g")}/`) ?? []) {
			walKeys.push(e.key);
		}
		expect(walKeys.length).toBeGreaterThan(0);
		// All frames must lex-sort to numeric ASC.
		const sorted = [...walKeys].sort();
		expect(walKeys).toEqual(sorted);
		h.dispose();
	});

	it("when wal is omitted, every flush writes a full baseline (no diff loss)", async () => {
		const g = new Graph("g");
		g.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const saves: unknown[] = [];
		const snapTier = {
			name: "test",
			save(record: unknown) {
				saves.push(record);
			},
			compactEvery: 10,
		};
		const h = g.attachSnapshotStorage([{ snapshot: snapTier }]);
		await settle();
		g.set("a", 1);
		await settle();
		g.set("a", 2);
		await settle();
		// Every save is mode:"full" because no walTier captured intermediate state.
		for (const r of saves) {
			expect((r as { mode: string }).mode).toBe("full");
		}
		expect(saves.length).toBeGreaterThan(0);
		h.dispose();
	});
});

// ── Group-3 Edge #3: destroyAsync awaits in-flight storage saves ──────────

describe("Graph.destroyAsync awaits storage disposers (Group-3 Edge #3)", () => {
	function gatedSlowTier() {
		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		let saveCompleted = false;
		const tier = {
			name: "slow",
			compactEvery: 10,
			async save(_record: unknown) {
				await gate;
				saveCompleted = true;
			},
			load() {
				return undefined;
			},
		};
		return { tier, release, isDone: () => saveCompleted };
	}

	it("destroyAsync() blocks on an in-flight save until it completes", async () => {
		const { tier, release, isDone } = gatedSlowTier();
		const g = new Graph("g");
		g.add(node([], { initial: 0, name: "a" }), { name: "a" });
		g.attachSnapshotStorage([{ snapshot: tier }]);
		await settle();
		g.set("a", 1); // triggers a baseline flush → save() in-flight (gated)

		const destroyP = g.destroyAsync();
		// destroyAsync must NOT resolve while the save is gated.
		const raced = await Promise.race([
			destroyP.then(() => "destroyed" as const),
			new Promise<"pending">((r) => setTimeout(() => r("pending"), 30)),
		]);
		expect(raced).toBe("pending");
		expect(isDone()).toBe(false);

		release(); // let the save complete
		await destroyP;
		expect(isDone()).toBe(true); // destroyAsync awaited it
		expect(g.destroyed).toBe(true);
	});

	it("sync destroy() does NOT await the save (fire-and-forget — the bug destroyAsync fixes)", async () => {
		const { tier, release, isDone } = gatedSlowTier();
		const g = new Graph("g");
		g.add(node([], { initial: 0, name: "a" }), { name: "a" });
		g.attachSnapshotStorage([{ snapshot: tier }]);
		await settle();
		g.set("a", 1);

		g.destroy(); // sync — returns immediately, save still gated
		expect(isDone()).toBe(false);
		expect(g.destroyed).toBe(true);

		// The abandoned save still runs once released, but destroy() never
		// waited for it — exactly the durability gap destroyAsync closes.
		release();
		await settle();
		expect(isDone()).toBe(true);
	});
});

// ── Graph.restoreSnapshot({ mode: "diff" }) replay ────────────────────────

describe('Graph.restoreSnapshot({ mode: "diff" }) (Q9 lock)', () => {
	it("replays node.set frames onto a fresh graph", async () => {
		// Author: produce a baseline + WAL frames.
		const author = new Graph("g");
		author.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const snapTier = memorySnapshot({ name: "g", compactEvery: 100 });
		const walBackend = memoryBackend();
		const walTier = kvStorage(walBackend, { name: "g-wal" });
		const h = author.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
		await settle();
		author.set("a", 7);
		await settle();
		author.set("a", 11);
		await settle();
		h.dispose();

		// Replayer: reconstruct from baseline + WAL.
		const replayer = new Graph("g");
		replayer.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const result = await replayer.restoreSnapshot({
			mode: "diff",
			source: { tier: snapTier, walTier },
		});

		expect(replayer.node("a").cache).toBe(11);
		expect(result.replayedFrames).toBeGreaterThan(0);
		expect(result.skippedFrames).toBe(0);
		expect(result.finalSeq).toBeGreaterThan(0);
		// Cross-scope phases all present (frames=0 for spec/ownership when
		// diff is value-only; that's still a phase entry).
		const phaseLifecycles = result.phases.map((p) => p.lifecycle);
		expect(phaseLifecycles).toEqual([...REPLAY_ORDER]);
	});

	it("lifecycle filter scopes replay to a single scope", async () => {
		const author = new Graph("g");
		author.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const snapTier = memorySnapshot({ name: "g", compactEvery: 100 });
		const walTier = kvStorage(memoryBackend(), { name: "g-wal" });
		const h = author.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
		await settle();
		author.set("a", 42);
		await settle();
		h.dispose();

		const replayer = new Graph("g");
		replayer.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const specOnly = await replayer.restoreSnapshot({
			mode: "diff",
			source: { tier: snapTier, walTier },
			lifecycle: ["spec"],
		});
		// Spec-only: data frames are dropped → cache stays at the baseline value (0).
		expect(replayer.node("a").cache).toBe(0);
		expect(specOnly.phases.find((p) => p.lifecycle === "data")?.frames).toBe(0);
	});

	it("targetSeq scopes replay up to a specific frame_seq", async () => {
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

		// Find the second frame's seq.
		const seqs: number[] = [];
		for await (const e of walTier.listByPrefix?.<WALFrame>(`${graphWalPrefix("g")}/`) ?? []) {
			seqs.push(e.value.frame_seq);
		}
		seqs.sort((a, b) => a - b);
		expect(seqs.length).toBeGreaterThanOrEqual(2);

		const replayer = new Graph("g");
		replayer.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const result = await replayer.restoreSnapshot({
			mode: "diff",
			source: { tier: snapTier, walTier },
			targetSeq: seqs[1],
		});
		// Replayed only first two value changes → cache should be 2.
		expect(replayer.node("a").cache).toBe(2);
		// Strengthened assertion: exactly two frames applied, all in the
		// data lifecycle (since the diffs were value-only `node.set` frames).
		expect(result.replayedFrames).toBe(2);
		expect(result.skippedFrames).toBe(0);
		expect(result.phases.find((p) => p.lifecycle === "data")?.frames).toBe(2);
		expect(result.phases.find((p) => p.lifecycle === "spec")?.frames).toBe(0);
	});

	it("torn write at WAL tail is dropped by default policy", async () => {
		const author = new Graph("g");
		author.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const snapTier = memorySnapshot({ name: "g", compactEvery: 100 });
		const walBackend = memoryBackend();
		const walTier = kvStorage<WALFrame>(walBackend, { name: "g-wal" });
		const h = author.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
		await settle();
		author.set("a", 5);
		await settle();
		author.set("a", 6);
		await settle();
		h.dispose();

		// Tamper the LAST WAL key (tail): set a frame whose checksum is
		// stale. We do this by reading, mutating, and re-writing with a
		// drift in `path` (checksum no longer matches body).
		const walKeys: string[] = [];
		for await (const e of walTier.listByPrefix?.<WALFrame>(`${graphWalPrefix("g")}/`) ?? []) {
			walKeys.push(e.key);
		}
		const tailKey = walKeys[walKeys.length - 1] as string;
		const tailRaw = await walTier.load(tailKey);
		expect(tailRaw).toBeDefined();
		const torn = { ...(tailRaw as WALFrame), path: "tampered" };
		await walTier.save(tailKey, torn);
		await walTier.flush?.();

		const replayer = new Graph("g");
		replayer.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const result = await replayer.restoreSnapshot({
			mode: "diff",
			source: { tier: snapTier, walTier },
		});
		expect(result.skippedFrames).toBeGreaterThanOrEqual(1);
		// Earlier frames still applied → cache reflects pre-torn state.
		expect(replayer.node("a").cache).toBe(5);
	});

	it('torn write mid-stream aborts with RestoreError("torn-write-mid-stream")', async () => {
		const author = new Graph("g");
		author.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const snapTier = memorySnapshot({ name: "g", compactEvery: 100 });
		const walTier = kvStorage<WALFrame>(memoryBackend(), { name: "g-wal" });
		const h = author.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
		await settle();
		author.set("a", 1);
		await settle();
		author.set("a", 2);
		await settle();
		author.set("a", 3);
		await settle();
		h.dispose();

		// Tamper a mid-stream frame.
		const walKeys: string[] = [];
		for await (const e of walTier.listByPrefix?.<WALFrame>(`${graphWalPrefix("g")}/`) ?? []) {
			walKeys.push(e.key);
		}
		expect(walKeys.length).toBeGreaterThanOrEqual(2);
		const midKey = walKeys[Math.floor(walKeys.length / 2)] as string;
		const midRaw = await walTier.load(midKey);
		const torn = { ...(midRaw as WALFrame), path: "tampered-mid" };
		await walTier.save(midKey, torn);
		await walTier.flush?.();

		const replayer = new Graph("g");
		replayer.add(node([], { initial: 0, name: "a" }), { name: "a" });
		await expect(
			replayer.restoreSnapshot({
				mode: "diff",
				source: { tier: snapTier, walTier },
			}),
		).rejects.toBeInstanceOf(RestoreError);
	});

	it("INVALIDATE persists as node.invalidate and replays via graph.invalidate", async () => {
		const author = new Graph("g");
		author.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const snapTier = memorySnapshot({ name: "g", compactEvery: 100 });
		const walTier = kvStorage<WALFrame>(memoryBackend(), { name: "g-wal" });
		const h = author.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
		await settle();
		author.set("a", 7);
		await settle();
		author.invalidate("a");
		await settle();
		h.dispose();

		// Inspect the WAL for an invalidate frame.
		const kinds: string[] = [];
		for await (const e of walTier.listByPrefix?.<WALFrame>(`${graphWalPrefix("g")}/`) ?? []) {
			const inner = (e.value.change as { change: { kind: string } }).change;
			kinds.push(inner.kind);
		}
		expect(kinds).toContain("node.invalidate");

		const replayer = new Graph("g");
		replayer.add(node([], { initial: 7, name: "a" }), { name: "a" });
		await replayer.restoreSnapshot({
			mode: "diff",
			source: { tier: snapTier, walTier },
		});
		// Post-replay, cache should be SENTINEL (undefined) on the replayer.
		expect(replayer.node("a").cache).toBeUndefined();
	});

	it("baseline-missing throws when no full baseline is available", async () => {
		const snapTier = memorySnapshot({ name: "g", compactEvery: 100 });
		const walTier = kvStorage<WALFrame>(memoryBackend(), { name: "g-wal" });
		const replayer = new Graph("g");
		await expect(
			replayer.restoreSnapshot({
				mode: "diff",
				source: { tier: snapTier, walTier },
			}),
		).rejects.toBeInstanceOf(RestoreError);
	});

	it("accepts pre-collected AsyncIterable<WALFrame> source", async () => {
		const author = new Graph("g");
		author.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const snapTier = memorySnapshot({ name: "g", compactEvery: 100 });
		const walTier = kvStorage<WALFrame>(memoryBackend(), { name: "g-wal" });
		const h = author.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
		await settle();
		author.set("a", 3);
		await settle();
		author.set("a", 4);
		await settle();
		h.dispose();

		const collected: WALFrame[] = [];
		for await (const e of walTier.listByPrefix?.<WALFrame>(`${graphWalPrefix("g")}/`) ?? []) {
			collected.push(e.value);
		}

		// Apply pre-collected stream to a graph already at baseline state.
		const replayer = new Graph("g");
		replayer.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const result = await replayer.restoreSnapshot({
			mode: "diff",
			source: (async function* () {
				for (const f of collected) yield f;
			})(),
		});
		expect(replayer.node("a").cache).toBe(4);
		expect(result.replayedFrames).toBeGreaterThan(0);
	});

	it("onTornWrite callback overrides default tail/mid policies", async () => {
		const author = new Graph("g");
		author.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const snapTier = memorySnapshot({ name: "g", compactEvery: 100 });
		const walTier = kvStorage<WALFrame>(memoryBackend(), { name: "g-wal" });
		const h = author.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
		await settle();
		author.set("a", 1);
		await settle();
		author.set("a", 2);
		await settle();
		author.set("a", 3);
		await settle();
		h.dispose();

		const walKeys: string[] = [];
		for await (const e of walTier.listByPrefix?.<WALFrame>(`${graphWalPrefix("g")}/`) ?? []) {
			walKeys.push(e.key);
		}
		const midKey = walKeys[Math.floor(walKeys.length / 2)] as string;
		const midRaw = await walTier.load(midKey);
		const torn = { ...(midRaw as WALFrame), path: "tampered" };
		await walTier.save(midKey, torn);
		await walTier.flush?.();

		const onTornWrite = vi.fn().mockReturnValue("skip" as const);
		const replayer = new Graph("g");
		replayer.add(node([], { initial: 0, name: "a" }), { name: "a" });
		// With override → "skip" mid-stream too.
		const result = await replayer.restoreSnapshot({
			mode: "diff",
			source: { tier: snapTier, walTier },
			onTornWrite,
		});
		expect(onTornWrite).toHaveBeenCalled();
		expect(result.skippedFrames).toBeGreaterThanOrEqual(1);
	});

	it("rejects empty lifecycle filter [] (Phase 14.6 fix J)", async () => {
		const snapTier = memorySnapshot({ name: "g", compactEvery: 100 });
		const walTier = kvStorage<WALFrame>(memoryBackend(), { name: "g-wal" });
		const replayer = new Graph("g");
		await expect(
			replayer.restoreSnapshot({
				mode: "diff",
				source: { tier: snapTier, walTier },
				lifecycle: [],
			}),
		).rejects.toBeInstanceOf(RestoreError);
	});

	it("rejects targetSeq below baseline.seq (Phase 14.6 fix D)", async () => {
		const author = new Graph("g");
		author.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const snapTier = memorySnapshot({ name: "g", compactEvery: 100 });
		const walTier = kvStorage<WALFrame>(memoryBackend(), { name: "g-wal" });
		const h = author.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
		await settle();
		author.set("a", 1);
		await settle();
		h.dispose();

		const baseline = (await snapTier.load?.()) as { seq: number };
		expect(baseline.seq).toBeGreaterThan(0);

		const replayer = new Graph("g");
		replayer.add(node([], { initial: 0, name: "a" }), { name: "a" });
		await expect(
			replayer.restoreSnapshot({
				mode: "diff",
				source: { tier: snapTier, walTier },
				targetSeq: baseline.seq - 1,
			}),
		).rejects.toBeInstanceOf(RestoreError);
	});
});

// ── Phase 14.6 fix B1 — walTier required for tier-handle source ───────────

describe("restoreSnapshot tier-handle source (Phase 14.6 fix B1)", () => {
	it("throws RestoreError when walTier is omitted", async () => {
		const snapTier = memorySnapshot({ name: "g" });
		const replayer = new Graph("g");
		await expect(
			replayer.restoreSnapshot({
				mode: "diff",
				// walTier intentionally omitted — pre-fix code defaulted to
				// `handle.tier` (a SnapshotStorageTier), surfacing as a
				// "wal-tier-required" lazily during list iteration. Now it
				// fails fast.
				source: { tier: snapTier } as unknown as Parameters<
					typeof replayer.restoreSnapshot
				>[0]["source"],
			}),
		).rejects.toBeInstanceOf(RestoreError);
	});
});

// ── Phase 14.6 fix C — walTier validation at attach time ──────────────────

describe("attachSnapshotStorage WAL tier validation (Phase 14.6 fix C)", () => {
	it("throws TypeError synchronously when wal tier lacks save(key, value)", () => {
		const g = new Graph("g");
		g.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const snapTier = memorySnapshot({ name: "g" });
		const noSaveWal = {
			name: "no-save-wal",
			// Intentionally missing `save` — should fail fast at attach.
			async *listByPrefix() {
				/* empty */
			},
		} as unknown as Parameters<typeof g.attachSnapshotStorage>[0][number]["wal"];
		expect(() => g.attachSnapshotStorage([{ snapshot: snapTier, wal: noSaveWal }])).toThrow(
			TypeError,
		);
	});
});

// ── Phase 14.6 fix A — runFlush concurrency serialization ─────────────────

describe("attachSnapshotStorage runFlush concurrency (Phase 14.6 fix A)", () => {
	it("serializes back-to-back flushes — no frame_seq collision", async () => {
		const g = new Graph("g");
		g.add(node([], { initial: 0, name: "a" }), { name: "a" });
		const snapTier = memorySnapshot({ name: "g", compactEvery: 100 });
		const walTier = kvStorage<WALFrame>(memoryBackend(), { name: "g-wal" });
		const h = g.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
		await settle();
		// Fire many sets back-to-back — synchronously, with no settle in
		// between — so multiple `runFlush` invocations queue concurrently.
		for (let i = 1; i <= 10; i++) g.set("a", i);
		await settle();
		await settle();
		h.dispose();

		const seqs: number[] = [];
		for await (const e of walTier.listByPrefix?.<WALFrame>(`${graphWalPrefix("g")}/`) ?? []) {
			seqs.push(e.value.frame_seq);
		}
		// All frame_seq values must be unique and strictly monotonic.
		const unique = new Set(seqs);
		expect(unique.size).toBe(seqs.length);
		const sorted = [...seqs].sort((a, b) => a - b);
		expect(seqs).toEqual(sorted);
	});

	it("re-attach to populated WAL bootstraps frame_seq above prior tail", async () => {
		const sharedBackend = memoryBackend();
		const snapBackend = memoryBackend();

		// Session 1: write some frames + dispose.
		{
			const g = new Graph("g");
			g.add(node([], { initial: 0, name: "a" }), { name: "a" });
			const snapTier = (await import("../../extra/storage/tiers.js")).snapshotStorage<
				import("../../graph/graph.js").GraphCheckpointRecord
			>(snapBackend, { name: "g", compactEvery: 100 });
			const walTier = kvStorage<WALFrame>(sharedBackend, { name: "g-wal" });
			const h = g.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
			await settle();
			g.set("a", 1);
			await settle();
			g.set("a", 2);
			await settle();
			h.dispose();
		}

		// Read the highest frame_seq written by session 1.
		const walTier1 = kvStorage<WALFrame>(sharedBackend, { name: "g-wal" });
		const session1Seqs: number[] = [];
		for await (const e of walTier1.listByPrefix?.<WALFrame>(`${graphWalPrefix("g")}/`) ?? []) {
			session1Seqs.push(e.value.frame_seq);
		}
		const session1Tail = Math.max(...session1Seqs);
		expect(session1Tail).toBeGreaterThan(0);

		// Session 2: re-attach to the SAME backends, write more frames.
		// Pre-fix the next baseline would land at seq=1 because bootstrap
		// hadn't completed before the first flush; post-fix the bootstrap
		// completes first and seq picks up after `session1Tail`.
		{
			const g = new Graph("g");
			g.add(node([], { initial: 0, name: "a" }), { name: "a" });
			const snapTier = (await import("../../extra/storage/tiers.js")).snapshotStorage<
				import("../../graph/graph.js").GraphCheckpointRecord
			>(snapBackend, { name: "g", compactEvery: 100 });
			const walTier = kvStorage<WALFrame>(sharedBackend, { name: "g-wal" });
			const h = g.attachSnapshotStorage([{ snapshot: snapTier, wal: walTier }]);
			await settle();
			g.set("a", 3);
			await settle();
			h.dispose();
		}

		// Inspect: every new baseline + frame_seq must exceed session1Tail.
		const walTier2 = kvStorage<WALFrame>(sharedBackend, { name: "g-wal" });
		const allSeqs: number[] = [];
		for await (const e of walTier2.listByPrefix?.<WALFrame>(`${graphWalPrefix("g")}/`) ?? []) {
			allSeqs.push(e.value.frame_seq);
		}
		// Session 2 frames must have frame_seq > session1Tail.
		const session2Seqs = allSeqs.filter((s) => s > session1Tail);
		expect(session2Seqs.length).toBeGreaterThan(0);
		const baselineSnap = (await (
			await import("../../extra/storage/tiers.js")
		)
			.snapshotStorage<import("../../graph/graph.js").GraphCheckpointRecord>(snapBackend, {
				name: "g",
			})
			.load?.()) as { seq: number };
		expect(baselineSnap.seq).toBeGreaterThan(session1Tail);
	});
});
