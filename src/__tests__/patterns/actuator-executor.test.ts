/**
 * Unit tests for `actuatorExecutor` — the side-effecting EXECUTE work fn
 * primitive (Tier 6.5 C2 shape). Covers:
 *   - happy path (Promise apply → success payload with artifact)
 *   - skip path (shouldApply=false → failure payload)
 *   - synchronous throw + Promise reject mapping via onError
 *   - one-DATA-per-claim rule (later inner DATAs ignored by the producer)
 *   - end-to-end pairing with `evalVerifier` through `harnessLoop`
 */

import { describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";

import { fromAny } from "../../extra/sources.js";
import {
	actuatorExecutor,
	dispatchActuator,
	evalVerifier,
	type HarnessJobPayload,
	harnessLoop,
	type TriagedItem,
	type VerifyResult,
} from "../../patterns/harness/index.js";
import type {
	DatasetItem,
	EvalResult,
	Evaluator,
} from "../../patterns/harness/presets/refine-loop.js";
import type { JobEnvelope } from "../../patterns/job-queue/index.js";
import { mockLLM } from "../helpers/mock-llm.js";

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

let _jobCounter = 0;
function makeJob<R>(item: TriagedItem): JobEnvelope<HarnessJobPayload<R>> {
	_jobCounter += 1;
	return {
		id: `test-job-${_jobCounter}`,
		payload: { item },
		attempts: 0,
		metadata: Object.freeze({}),
		state: "inflight",
	};
}

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
	it("emits success payload with artifact when apply resolves", async () => {
		const applied: TriagedItem[] = [];
		const exec = actuatorExecutor<{ wrote: string }>({
			async apply(item) {
				applied.push(item);
				return { wrote: item.intervention };
			},
		});
		const out = fromAny(exec(makeJob<{ wrote: string }>(SAMPLE_ITEM)));
		const payload = await awaitFirstData(out);
		expect(applied).toHaveLength(1);
		expect(payload.execution?.outcome).toBe("success");
		expect(payload.execution?.artifact).toEqual({ wrote: "catalog-fn" });
		expect(payload.execution?.detail).toContain("catalog-fn");
		expect(payload.item).toEqual(SAMPLE_ITEM);
	});

	it("custom toOutput shapes the execution payload", async () => {
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
		const payload = await awaitFirstData(fromAny(exec(makeJob<number>(SAMPLE_ITEM))));
		expect(payload.execution?.outcome).toBe("partial");
		expect(payload.execution?.detail).toBe("wrote=42");
		expect(payload.execution?.artifact).toBe(42);
	});
});

describe("actuatorExecutor — failure modes", () => {
	it("synchronous throw maps to failure payload via onError", async () => {
		const exec = actuatorExecutor<unknown>({
			apply() {
				throw new Error("sync boom");
			},
		});
		const payload = await awaitFirstData(fromAny(exec(makeJob<unknown>(SAMPLE_ITEM))));
		expect(payload.execution?.outcome).toBe("failure");
		expect(payload.execution?.detail).toContain("sync boom");
		expect(payload.execution?.artifact).toBeUndefined();
	});

	it("Promise reject maps to failure payload via onError", async () => {
		const exec = actuatorExecutor<unknown>({
			async apply() {
				throw new Error("async boom");
			},
		});
		const payload = await awaitFirstData(fromAny(exec(makeJob<unknown>(SAMPLE_ITEM))));
		expect(payload.execution?.outcome).toBe("failure");
		expect(payload.execution?.detail).toContain("async boom");
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
		const payload = await awaitFirstData(fromAny(exec(makeJob<unknown>(SAMPLE_ITEM))));
		expect(payload.execution?.detail).toBe("tagged: classify me");
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
		const payload = await awaitFirstData(fromAny(exec(makeJob<unknown>(SAMPLE_ITEM))));
		expect(applyCalls).toBe(0);
		expect(payload.execution?.outcome).toBe("failure");
		expect(payload.execution?.detail).toBe("skipped catalog-fn");
	});
});

describe("actuatorExecutor — contract guarantees", () => {
	it("ignores later inner DATAs after the first one is captured (rule 1)", async () => {
		// An apply that returns a Node emitting MULTIPLE DATAs must collapse
		// into exactly one execution payload.
		const exec = actuatorExecutor<string>({
			apply() {
				return node<string>(
					[],
					(_data, actions) => {
						actions.down([[DATA, "first"], [DATA, "second"], [DATA, "third"], [COMPLETE]]);
						return () => {};
					},
					{ describeKind: "producer" },
				);
			},
		});
		const seen: HarnessJobPayload<string>[] = [];
		const out = fromAny(exec(makeJob<string>(SAMPLE_ITEM)));
		out.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA && m[1] != null) seen.push(m[1] as HarnessJobPayload<string>);
			}
		});
		// Allow microtasks for fromAny + producer settle.
		await Promise.resolve();
		await Promise.resolve();
		expect(seen).toHaveLength(1);
		expect(seen[0]?.execution?.artifact).toBe("first");
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
		const payload = await awaitFirstData(fromAny(exec(makeJob<string>(CATALOG_ITEM))));
		expect(payload.execution?.outcome).toBe("success");
		expect(payload.execution?.artifact).toBe("catalog-result");
		expect(catalogCalls).toEqual(["catalog-fn"]);
	});

	it("routes 'template' to its apply callback independently", async () => {
		const exec = dispatchActuator<string>({
			routes: {
				"catalog-fn": () => Promise.resolve("catalog-result"),
				template: () => Promise.resolve("template-result"),
			},
		});
		const payload = await awaitFirstData(fromAny(exec(makeJob<string>(TEMPLATE_ITEM))));
		expect(payload.execution?.outcome).toBe("success");
		expect(payload.execution?.artifact).toBe("template-result");
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
		const payload = await awaitFirstData(fromAny(exec(makeJob<string>(UNKNOWN_ITEM))));
		expect(payload.execution?.outcome).toBe("success");
		expect(payload.execution?.artifact).toBe("default-result");
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
		const payload = await awaitFirstData(fromAny(exec(makeJob<string>(UNKNOWN_ITEM))));
		expect(payload.execution?.outcome).toBe("failure");
		expect(payload.execution?.detail).toContain("no route for intervention 'investigate'");
	});
});

// ---------------------------------------------------------------------------
// End-to-end: actuatorExecutor + evalVerifier through harnessLoop
// ---------------------------------------------------------------------------

const REQUIRED = ["a", "b", "c"] as const;
const DATASET: readonly DatasetItem[] = REQUIRED.map((kw) => ({ id: kw }));

const presenceEvaluator: Evaluator<string> = (candidates, dataset) => {
	const out = node<readonly EvalResult[]>([], { initial: [] });
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
// dispatchActuator regressions
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
		const payload = await awaitFirstData(fromAny(exec(makeJob<string>(item))));
		expect(payload.execution?.outcome).toBe("failure");
		expect(payload.execution?.detail).toContain("no route for intervention 'toString'");
		expect(apply).not.toHaveBeenCalled();
	});
});

describe("dispatchActuator — empty routes no default", () => {
	it("emits skip-failure for any item when routes is empty and no default", async () => {
		const exec = dispatchActuator<string>({ routes: {} });
		const payload = await awaitFirstData(fromAny(exec(makeJob<string>(CATALOG_ITEM))));
		expect(payload.execution?.outcome).toBe("failure");
		expect(payload.execution?.detail).toContain("no route for intervention");
	});
});
