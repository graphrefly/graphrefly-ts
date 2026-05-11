/**
 * M4.F Tier 3 parity scenarios — graph storage integration (attach + restore).
 *
 * Attach snapshot storage to a graph, emit changes, restore from WAL.
 * These are the highest-level storage parity tests — they exercise
 * the full attach → emit → flush → restore → verify pipeline.
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

/** Yield a microtask tick so sync-through flush chains settle. */
async function tick(): Promise<void> {
	await new Promise((r) => setTimeout(r, 0));
}

describe.each(impls)("M4.F Tier 3 — graph storage integration — $name", (impl) => {
	const hasStorage = () => impl.storage != null;

	describe("graphSnapshot", () => {
		test.runIf(hasStorage())("returns a snapshot with graph name and nodes", async () => {
			const s = impl.storage!;
			const g = new impl.Graph("snap-g");
			try {
				await g.state("a", 1);
				await g.state("b", 2);
				const snap = (await s.graphSnapshot(g)) as any;
				expect(snap.name).toBe("snap-g");
				expect(snap.nodes).toBeDefined();
			} finally {
				await g.destroy();
			}
		});
	});

	describe("attach + restore cycle", () => {
		test.runIf(hasStorage())("attaching storage produces a disposable handle", async () => {
			const s = impl.storage!;
			const g = new impl.Graph("attach-g");
			try {
				await g.state("a", 1);
				const backend = s.memoryBackend();
				const snapTier = s.checkpointSnapshotTier(backend, { name: "cp" });
				const walTier = s.walKvTier(backend, { name: "wal" });
				const handle = await s.attachSnapshotStorage(g, snapTier, walTier);

				// Emit some data to trigger WAL writes
				await g.set("a", 10);
				await tick();

				await handle.dispose();
			} finally {
				await g.destroy();
			}
		});

		test.runIf(hasStorage())("restore replays state from WAL frames", async () => {
			const s = impl.storage!;

			// Author graph — write state changes
			const author = new impl.Graph("rg");
			let replayer: InstanceType<typeof impl.Graph> | undefined;
			try {
				await author.state("a", 0);
				const backend = s.memoryBackend();
				const snapTier = s.checkpointSnapshotTier(backend, { name: "rg" });
				const walTier = s.walKvTier(backend, { name: "rg-wal" });
				const handle = await s.attachSnapshotStorage(author, snapTier, walTier);
				await tick();

				await author.set("a", 21);
				await tick();
				await author.set("a", 42);
				await tick();
				await handle.dispose();

				// Replayer graph — restore from tiers
				replayer = new impl.Graph("rg");
				await replayer.state("a", 0);
				const result = await s.restoreSnapshot(replayer, snapTier, walTier);

				expect(result.replayedFrames).toBeGreaterThan(0);
				expect(result.finalSeq).toBeGreaterThan(0);
				expect(result.phases.length).toBeGreaterThan(0);

				// The restored value should match the last emitted value
				const node = replayer.tryResolve("a");
				expect(node).toBeDefined();
				expect(node!.cache).toBe(42);
			} finally {
				if (replayer) await replayer.destroy();
				await author.destroy();
			}
		});

		test.runIf(hasStorage())("restoreResult.phases contain lifecycle labels", async () => {
			const s = impl.storage!;
			const author = new impl.Graph("pg");
			let replayer: InstanceType<typeof impl.Graph> | undefined;
			try {
				await author.state("a", 0);
				const backend = s.memoryBackend();
				const snapTier = s.checkpointSnapshotTier(backend, { name: "pg" });
				const walTier = s.walKvTier(backend, { name: "pg-wal" });
				const handle = await s.attachSnapshotStorage(author, snapTier, walTier);
				await tick();
				await author.set("a", 1);
				await tick();
				await handle.dispose();

				replayer = new impl.Graph("pg");
				await replayer.state("a", 0);
				const result = await s.restoreSnapshot(replayer, snapTier, walTier);

				// Each phase should have a lifecycle label in the replay order
				const validLifecycles = new Set(s.walReplayOrder());
				for (const phase of result.phases) {
					expect(validLifecycles.has(phase.lifecycle)).toBe(true);
					expect(phase.frames).toBeGreaterThanOrEqual(0);
				}
			} finally {
				if (replayer) await replayer.destroy();
				await author.destroy();
			}
		});
	});
});
