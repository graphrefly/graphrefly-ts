/**
 * Unit tests for the dogfood `catalogAwareEvaluator` composer:
 *   - reads the live `catalog` from `overlay.effective` per scoring wave
 *   - re-runs when candidates / dataset / catalog settles
 *   - cancels in-flight scoring when a new wave supersedes
 *   - surfaces `runEvalSuite` rejects as ERROR
 */

import { describe, expect, it } from "vitest";
import { catalogAwareEvaluator } from "../../../../../evals/lib/catalog-aware-evaluator.js";
import { catalogOverlay } from "../../../../../evals/lib/catalog-overlay.js";
import { portableCatalog, portableFns } from "../../../../../evals/lib/portable-catalog.js";
import { DATA, ERROR } from "../../core/messages.js";
import { node } from "../../core/node.js";

import type { CatalogFnEntry } from "../../patterns/graphspec/index.js";
import type { DatasetItem, EvalResult } from "../../patterns/harness/presets/refine-loop.js";

const sentinelEntry: CatalogFnEntry = {
	factory: () =>
		({ subscribe: () => () => {} }) as unknown as ReturnType<CatalogFnEntry["factory"]>,
	description: "sentinel",
	tags: ["test"],
};

describe("catalogAwareEvaluator — happy path", () => {
	it("invokes runEvalSuite with overlay catalog + candidates + dataset", async () => {
		const overlay = catalogOverlay({ base: portableCatalog });
		const calls: {
			catalogSize: number;
			candidates: readonly string[];
			dataset: readonly DatasetItem[];
		}[] = [];
		const evaluator = catalogAwareEvaluator<string>({
			overlay,
			async runEvalSuite({ catalog, candidates, dataset }) {
				calls.push({
					catalogSize: Object.keys(catalog.fns ?? {}).length,
					candidates,
					dataset,
				});
				return dataset.map((d) => ({ taskId: d.id, score: 1 }));
			},
		});
		const candidates = node<readonly string[]>([], { initial: ["c1"] });
		const dataset = node<readonly DatasetItem[]>([], { initial: [{ id: "t1" }] });
		const evalNode = evaluator(candidates, dataset);
		const seen: readonly EvalResult[][] = [];
		evalNode.subscribe((batch) => {
			for (const m of batch) {
				if (m[0] === DATA && m[1] != null) (seen as EvalResult[][]).push(m[1] as EvalResult[]);
			}
		});
		// Microtasks for the producer + Promise resolution.
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(calls).toHaveLength(1);
		expect(calls[0].catalogSize).toBe(Object.keys(portableFns).length);
		expect(calls[0].candidates).toEqual(["c1"]);
		expect(calls[0].dataset).toEqual([{ id: "t1" }]);
		expect(seen[0]).toEqual([{ taskId: "t1", score: 1 }]);
	});

	it("snapshots overlay per candidates/dataset wave (no feedback loop on overlay change)", async () => {
		// The evaluator reads `overlay.effective.cache` at scoring time
		// rather than subscribing to it — this prevents the autoSolidify
		// feedback cycle (verifier writes to overlay → overlay settles →
		// reactive evaluator re-fires → autoSolidify writes again …).
		const overlay = catalogOverlay({ base: portableCatalog });
		const sizes: number[] = [];
		const evaluator = catalogAwareEvaluator<string>({
			overlay,
			async runEvalSuite({ catalog }) {
				sizes.push(Object.keys(catalog.fns ?? {}).length);
				return [];
			},
		});
		const candidates = node<readonly string[]>([], { initial: ["c"] });
		const dataset = node<readonly DatasetItem[]>([], { initial: [{ id: "t1" }] });
		const evalNode = evaluator(candidates, dataset);
		evalNode.subscribe(() => {});
		await Promise.resolve();
		await Promise.resolve();
		const baselineCount = sizes.length;
		// Mutate overlay — must NOT trigger an evaluator recompute on its own.
		overlay.upsertFn("brandNewFn", sentinelEntry);
		await Promise.resolve();
		await Promise.resolve();
		expect(sizes.length).toBe(baselineCount);
		// New candidates wave — picks up the post-mutation overlay snapshot.
		candidates.emit(["c2"]);
		await Promise.resolve();
		await Promise.resolve();
		expect(sizes.length).toBe(baselineCount + 1);
		expect(sizes[sizes.length - 1]).toBe(Object.keys(portableFns).length + 1);
		overlay.dispose();
	});
});

describe("catalogAwareEvaluator — failure surfacing", () => {
	it("surfaces runEvalSuite reject as ERROR", async () => {
		const overlay = catalogOverlay({ base: portableCatalog });
		const evaluator = catalogAwareEvaluator<string>({
			overlay,
			async runEvalSuite() {
				throw new Error("eval boom");
			},
		});
		const candidates = node<readonly string[]>([], { initial: ["c"] });
		const dataset = node<readonly DatasetItem[]>([], { initial: [{ id: "t1" }] });
		const evalNode = evaluator(candidates, dataset);
		const errors: unknown[] = [];
		evalNode.subscribe((batch) => {
			for (const m of batch) {
				if (m[0] === ERROR) errors.push(m[1]);
			}
		});
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("eval boom");
	});
});

describe("catalogAwareEvaluator — supersede cancellation", () => {
	it("aborts in-flight scoring when a new candidates wave fires", async () => {
		const overlay = catalogOverlay({ base: portableCatalog });
		const seenSignals: AbortSignal[] = [];
		const evaluator = catalogAwareEvaluator<string>({
			overlay,
			async runEvalSuite({ signal }) {
				seenSignals.push(signal);
				return new Promise<readonly EvalResult[]>((_resolve, reject) => {
					if (signal.aborted) {
						reject(new DOMException("aborted", "AbortError"));
						return;
					}
					signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
				});
			},
		});
		const candidates = node<readonly string[]>([], { initial: ["c1"] });
		const dataset = node<readonly DatasetItem[]>([], { initial: [{ id: "t1" }] });
		const evalNode = evaluator(candidates, dataset);
		evalNode.subscribe(() => {});
		await Promise.resolve();
		await Promise.resolve();
		expect(seenSignals).toHaveLength(1);
		expect(seenSignals[0].aborted).toBe(false);
		// New candidates wave — triggers a new recompute → prior signal aborts.
		candidates.emit(["c2"]);
		await Promise.resolve();
		await Promise.resolve();
		expect(seenSignals[0].aborted).toBe(true);
		expect(seenSignals.length).toBeGreaterThanOrEqual(2);
		overlay.dispose();
	});
});
