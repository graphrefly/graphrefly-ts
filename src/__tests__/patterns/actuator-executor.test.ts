/**
 * Unit tests for `actuatorExecutor` — the side-effecting EXECUTE slot
 * primitive. Covers:
 *   - happy path (Promise apply → success ExecuteOutput with artifact)
 *   - skip path (shouldApply=false → failure ExecuteOutput)
 *   - synchronous throw + Promise reject mapping via onError
 *   - one-DATA-per-item rule (later inner DATAs ignored)
 *   - cancellation: switchMap supersede aborts the in-flight signal
 *   - end-to-end pairing with `evalVerifier` through `harnessLoop`
 */

import { describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { producer, state } from "../../core/sugar.js";
import {
	actuatorExecutor,
	dispatchActuator,
	type ExecuteOutput,
	evalVerifier,
	harnessLoop,
	type TriagedItem,
	type VerifyResult,
} from "../../patterns/harness/index.js";
import type { DatasetItem, EvalResult, Evaluator } from "../../patterns/refine-loop/index.js";
import { mockLLM } from "../helpers/mock-llm.js";

function makeTriagedInput(item: TriagedItem | null): Node<TriagedItem | null> {
	return state<TriagedItem | null>(item);
}

const SAMPLE_ITEM: TriagedItem = {
	source: "eval",
	summary: "missing fn",
	evidence: "fixture",
	affectsAreas: ["catalog"],
	rootCause: "missing-fn",
	intervention: "catalog-fn",
	route: "auto-fix",
	priority: 80,
};

function awaitFirstData<T>(node: Node<T | null>, timeoutMs = 1500): Promise<T> {
	return new Promise((resolve, reject) => {
		let unsub: () => void = () => {};
		const timer = setTimeout(() => {
			unsub();
			reject(new Error(`no DATA within ${timeoutMs}ms`));
		}, timeoutMs);
		unsub = node.subscribe((msgs) => {
			for (const [type, value] of msgs) {
				if (type === DATA && value != null) {
					clearTimeout(timer);
					unsub();
					resolve(value as T);
					return;
				}
			}
		});
	});
}

describe("actuatorExecutor — happy path", () => {
	it("emits success ExecuteOutput with artifact when apply resolves", async () => {
		const applied: TriagedItem[] = [];
		const exec = actuatorExecutor<{ wrote: string }>({
			async apply(item) {
				applied.push(item);
				return { wrote: item.intervention };
			},
		});
		const out = exec(makeTriagedInput(SAMPLE_ITEM));
		const value = await awaitFirstData(out);
		expect(applied).toHaveLength(1);
		expect(value.outcome).toBe("success");
		expect(value.artifact).toEqual({ wrote: "catalog-fn" });
		expect(value.detail).toContain("catalog-fn");
	});

	it("custom toOutput shapes the ExecuteOutput", async () => {
		const exec = actuatorExecutor<number>({
			async apply() {
				return 42;
			},
			toOutput: (record) => ({
				outcome: "partial",
				detail: `wrote=${record}`,
				artifact: record,
			}),
		});
		const value = await awaitFirstData(exec(makeTriagedInput(SAMPLE_ITEM)));
		expect(value.outcome).toBe("partial");
		expect(value.detail).toBe("wrote=42");
		expect(value.artifact).toBe(42);
	});
});

describe("actuatorExecutor — failure modes", () => {
	it("synchronous throw maps to failure ExecuteOutput via onError", async () => {
		const exec = actuatorExecutor<unknown>({
			apply() {
				throw new Error("sync boom");
			},
		});
		const value = await awaitFirstData(exec(makeTriagedInput(SAMPLE_ITEM)));
		expect(value.outcome).toBe("failure");
		expect(value.detail).toContain("sync boom");
		expect(value.artifact).toBeUndefined();
	});

	it("Promise reject maps to failure ExecuteOutput via onError", async () => {
		const exec = actuatorExecutor<unknown>({
			async apply() {
				throw new Error("async boom");
			},
		});
		const value = await awaitFirstData(exec(makeTriagedInput(SAMPLE_ITEM)));
		expect(value.outcome).toBe("failure");
		expect(value.detail).toContain("async boom");
	});

	it("custom onError shapes the failure output", async () => {
		const exec = actuatorExecutor<unknown>({
			async apply() {
				throw new Error("classify me");
			},
			onError: (err) => ({
				outcome: "failure",
				detail: `tagged: ${(err as Error).message}`,
			}),
		});
		const value = await awaitFirstData(exec(makeTriagedInput(SAMPLE_ITEM)));
		expect(value.detail).toBe("tagged: classify me");
	});

	it("shouldApply=false skips apply and emits failure with skipDetail", async () => {
		let applyCalls = 0;
		const exec = actuatorExecutor<unknown>({
			apply() {
				applyCalls++;
				throw new Error("should not run");
			},
			shouldApply: () => false,
			skipDetail: (item) => `skipped ${item.intervention}`,
		});
		const value = await awaitFirstData(exec(makeTriagedInput(SAMPLE_ITEM)));
		expect(applyCalls).toBe(0);
		expect(value.outcome).toBe("failure");
		expect(value.detail).toBe("skipped catalog-fn");
	});
});

describe("actuatorExecutor — contract guarantees", () => {
	it("ignores later inner DATAs after the first one is captured (rule 1)", async () => {
		// An apply that returns a Node emitting MULTIPLE DATAs must collapse
		// into exactly one ExecuteOutput.
		const exec = actuatorExecutor<string>({
			apply() {
				return producer<string>((actions) => {
					actions.down([[DATA, "first"], [DATA, "second"], [DATA, "third"], [COMPLETE]]);
					return () => {};
				});
			},
		});
		const seen: ExecuteOutput<string>[] = [];
		const out = exec(makeTriagedInput(SAMPLE_ITEM));
		out.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA && m[1] != null) seen.push(m[1] as ExecuteOutput<string>);
			}
		});
		// Allow microtasks for fromAny + producer settle.
		await Promise.resolve();
		await Promise.resolve();
		expect(seen).toHaveLength(1);
		expect(seen[0].artifact).toBe("first");
	});

	it("supersede triggers AbortController and applies new item", async () => {
		const seenSignals: AbortSignal[] = [];
		const seenItems: string[] = [];
		const exec = actuatorExecutor<string>({
			apply(item, { signal }) {
				seenSignals.push(signal);
				seenItems.push(item.intervention);
				// Long-tail Promise that resolves only after signal aborts.
				return new Promise<string>((resolve, reject) => {
					if (signal.aborted) {
						reject(new DOMException("aborted", "AbortError"));
						return;
					}
					signal.addEventListener("abort", () => {
						reject(new DOMException("aborted", "AbortError"));
					});
					// Won't resolve naturally inside test window; supersede forces resolution.
					setTimeout(() => resolve(item.intervention), 5_000);
				});
			},
		});
		const input = state<TriagedItem | null>(null);
		const out = exec(input);
		// Subscribe early so switchMap activates.
		out.subscribe(() => {});
		input.emit(SAMPLE_ITEM);
		await Promise.resolve();
		expect(seenSignals).toHaveLength(1);
		expect(seenSignals[0].aborted).toBe(false);

		// Supersede with a new item — switchMap unmounts the prior producer,
		// which fires ac.abort() on the prior signal.
		const NEXT_ITEM: TriagedItem = { ...SAMPLE_ITEM, intervention: "template" };
		input.emit(NEXT_ITEM);
		await Promise.resolve();
		await Promise.resolve();
		expect(seenSignals[0].aborted).toBe(true);
		expect(seenItems).toEqual(["catalog-fn", "template"]);
	});
});

// ---------------------------------------------------------------------------
// dispatchActuator
// ---------------------------------------------------------------------------

const CATALOG_ITEM: TriagedItem = { ...SAMPLE_ITEM, intervention: "catalog-fn" };
const TEMPLATE_ITEM: TriagedItem = { ...SAMPLE_ITEM, intervention: "template" };
const UNKNOWN_ITEM: TriagedItem = {
	...SAMPLE_ITEM,
	intervention: "investigate" as TriagedItem["intervention"],
};

describe("dispatchActuator — routes match", () => {
	it("routes 'catalog-fn' to the correct apply callback", async () => {
		const catalogCalls: string[] = [];
		const exec = dispatchActuator<string>({
			routes: {
				"catalog-fn": (item) => {
					catalogCalls.push(item.intervention);
					return Promise.resolve("catalog-result");
				},
				template: () => Promise.resolve("template-result"),
			},
		});
		const value = await awaitFirstData(exec(makeTriagedInput(CATALOG_ITEM)));
		expect(value.outcome).toBe("success");
		expect(value.artifact).toBe("catalog-result");
		expect(catalogCalls).toEqual(["catalog-fn"]);
	});

	it("routes 'template' to its apply callback independently", async () => {
		const exec = dispatchActuator<string>({
			routes: {
				"catalog-fn": () => Promise.resolve("catalog-result"),
				template: () => Promise.resolve("template-result"),
			},
		});
		const value = await awaitFirstData(exec(makeTriagedInput(TEMPLATE_ITEM)));
		expect(value.outcome).toBe("success");
		expect(value.artifact).toBe("template-result");
	});
});

describe("dispatchActuator — default fallback", () => {
	it("invokes default apply for unrouted interventions", async () => {
		const defaultCalls: string[] = [];
		const exec = dispatchActuator<string>({
			routes: {
				"catalog-fn": () => Promise.resolve("catalog-result"),
			},
			default: (item) => {
				defaultCalls.push(item.intervention);
				return Promise.resolve("default-result");
			},
		});
		const value = await awaitFirstData(exec(makeTriagedInput(UNKNOWN_ITEM)));
		expect(value.outcome).toBe("success");
		expect(value.artifact).toBe("default-result");
		expect(defaultCalls).toEqual(["investigate"]);
	});
});

describe("dispatchActuator — no route no default", () => {
	it("emits failure with 'no route for intervention' detail", async () => {
		const exec = dispatchActuator<string>({
			routes: {
				"catalog-fn": () => Promise.resolve("catalog-result"),
			},
		});
		const value = await awaitFirstData(exec(makeTriagedInput(UNKNOWN_ITEM)));
		expect(value.outcome).toBe("failure");
		expect(value.detail).toContain("no route for intervention 'investigate'");
	});
});

async function waitForCondition(check: () => boolean, timeoutMs = 1000): Promise<void> {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > timeoutMs) throw new Error("waitForCondition timeout");
		await new Promise((r) => setTimeout(r, 5));
	}
}

describe("dispatchActuator — multiple interventions in sequence", () => {
	it("routes two items with different interventions to their respective callbacks", async () => {
		const seen: string[] = [];
		const exec = dispatchActuator<string>({
			routes: {
				"catalog-fn": (item) => {
					seen.push(`catalog:${item.intervention}`);
					return Promise.resolve("c");
				},
				template: (item) => {
					seen.push(`template:${item.intervention}`);
					return Promise.resolve("t");
				},
			},
		});

		const input = state<TriagedItem | null>(null);
		const out = exec(input);

		// Collect two results in order.
		const results: ExecuteOutput<string>[] = [];
		const donePromise = new Promise<void>((resolve) => {
			let unsub: () => void = () => {};
			unsub = out.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA && m[1] != null) {
						results.push(m[1] as ExecuteOutput<string>);
						if (results.length === 2) {
							unsub();
							resolve();
						}
					}
				}
			});
		});

		input.emit(CATALOG_ITEM);
		// Wait reactively for catalog-fn to complete before emitting next item.
		await waitForCondition(() => results.length === 1);
		input.emit(TEMPLATE_ITEM);

		await donePromise;

		expect(results[0]!.artifact).toBe("c");
		expect(results[1]!.artifact).toBe("t");
		expect(seen).toContain("catalog:catalog-fn");
		expect(seen).toContain("template:template");
	});
});

// ---------------------------------------------------------------------------
// End-to-end: actuatorExecutor + evalVerifier through harnessLoop
// ---------------------------------------------------------------------------

const REQUIRED = ["a", "b", "c"] as const;
const DATASET: readonly DatasetItem[] = REQUIRED.map((kw) => ({ id: kw }));

const presenceEvaluator: Evaluator<string> = (candidates, dataset) => {
	const out = state<readonly EvalResult[]>([]);
	let lastCands: readonly string[] = [];
	let lastDs: readonly DatasetItem[] = [];
	const recompute = (): void => {
		const best = (lastCands[0] ?? "").toLowerCase();
		out.emit(
			lastDs.map((row) => ({
				taskId: row.id,
				score: best.includes(row.id.toLowerCase()) ? 1 : 0,
			})),
		);
	};
	candidates.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] === DATA && m[1] != null) {
				lastCands = m[1] as readonly string[];
				recompute();
			}
		}
	});
	dataset.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] === DATA && m[1] != null) {
				lastDs = m[1] as readonly DatasetItem[];
				recompute();
			}
		}
	});
	return out;
};

function awaitFirstVerify(
	latest: Node<VerifyResult | null>,
	timeoutMs = 3000,
): Promise<VerifyResult> {
	return new Promise((resolve, reject) => {
		let unsub: () => void = () => {};
		const timer = setTimeout(() => {
			unsub();
			reject(new Error(`no VerifyResult within ${timeoutMs}ms`));
		}, timeoutMs);
		unsub = latest.subscribe((msgs) => {
			for (const [type, value] of msgs) {
				if (type === DATA && value != null) {
					clearTimeout(timer);
					unsub();
					resolve(value as VerifyResult);
				}
			}
		});
	});
}

describe("actuatorExecutor + evalVerifier (end-to-end)", () => {
	it("actuator writes artifact, verifier re-runs evaluator and passes", async () => {
		const adapter = mockLLM({
			fallback: {
				rootCause: "missing-fn",
				intervention: "catalog-fn",
				route: "auto-fix",
				priority: 80,
				triageReasoning: "needs the abc string",
			},
		});

		const harness = harnessLoop<string>("actuator-e2e", {
			adapter,
			executor: actuatorExecutor<string>({
				// "Actuator" returns the artifact — a candidate string carrying
				// every required keyword. Evaluator scores it 3/3 → verified.
				async apply() {
					return "a b c";
				},
			}),
			verifier: evalVerifier<string>({
				datasetFor: () => DATASET,
				evaluator: presenceEvaluator,
				threshold: 1.0,
			}),
		});

		const verifyPromise = awaitFirstVerify(
			harness.verifyResults.latest as Node<VerifyResult | null>,
		);
		harness.intake.publish({
			source: "eval",
			summary: "needs abc",
			evidence: "fixture",
			affectsAreas: ["catalog"],
			affectsEvalTasks: [...REQUIRED],
			severity: "high",
		});

		const verify = await verifyPromise;
		expect(verify.verified).toBe(true);
		expect(verify.execution.outcome).toBe("success");
		expect(verify.execution.artifact).toBe("a b c");
		expect(verify.findings[0]).toContain("3/3");

		harness.destroy();
	});
});

// ---------------------------------------------------------------------------
// P10b — dispatchActuator prototype-key intervention (regression for P2)
// ---------------------------------------------------------------------------

describe("dispatchActuator — prototype-key intervention (P2 regression)", () => {
	it("treats prototype-key interventions as no-route (skip-failure)", async () => {
		const apply = vi.fn(() => Promise.resolve("c"));
		const exec = dispatchActuator<string>({
			routes: { "catalog-fn": apply },
		});
		// Simulate a malformed/hallucinated triage output whose intervention
		// matches a prototype key — `Object.hasOwn` must reject it.
		const item: TriagedItem = {
			...CATALOG_ITEM,
			intervention: "toString" as TriagedItem["intervention"],
		};
		const value = await awaitFirstData(exec(makeTriagedInput(item)));
		expect(value.outcome).toBe("failure");
		expect(value.detail).toContain("no route for intervention 'toString'");
		expect(apply).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// P10c — dispatchActuator with empty routes object
// ---------------------------------------------------------------------------

describe("dispatchActuator — empty routes no default", () => {
	it("emits skip-failure for any item when routes is empty and no default", async () => {
		const exec = dispatchActuator<string>({ routes: {} });
		const value = await awaitFirstData(exec(makeTriagedInput(CATALOG_ITEM)));
		expect(value.outcome).toBe("failure");
		expect(value.detail).toContain("no route for intervention");
	});
});
