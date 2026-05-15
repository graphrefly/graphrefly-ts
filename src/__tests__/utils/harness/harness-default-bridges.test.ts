/**
 * Unit tests for the default LLM bridge work fns introduced in Tier 6.5 C2
 * and the cancel-on-teardown contract on `actuatorExecutor`. Coverage
 * targets the bridge-layer producer paths that don't go through `harnessLoop`
 * end-to-end (those are exercised in harness.test.ts).
 *
 * Failure-mode taxonomy under test:
 *   1. Synchronous `adapter.invoke` throw → failure payload.
 *   2. Adapter returns a Node that emits ERROR → failure payload.
 *   3. Adapter returns malformed JSON → parse-error failure.
 *   4. Adapter returns non-object JSON (`null` / number / array) → parse-error failure.
 *   5. Adapter returns a Node that COMPLETEs without emitting DATA → failure payload (qa F1 regression).
 *   6. AbortSignal threading: pump teardown fires `ac.abort()`; downstream
 *      sees `signal.aborted === true` (qa F2 regression for actuator-executor).
 */

import { COMPLETE, DATA, ERROR, type Messages, type Node, node } from "@graphrefly/pure-ts/core";
import { fromAny } from "@graphrefly/pure-ts/extra";
import { describe, expect, it } from "vitest";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
} from "../../../utils/ai/index.js";
import {
	actuatorExecutor,
	defaultLlmExecutor,
	defaultLlmVerifier,
	type HarnessJobPayload,
	type TriagedItem,
} from "../../../utils/harness/index.js";
import type { JobEnvelope } from "../../../utils/job-queue/index.js";

const ITEM: TriagedItem = {
	source: "eval",
	summary: "test item",
	evidence: "fixture",
	affectsAreas: ["core"],
	rootCause: "missing-fn",
	intervention: "catalog-fn",
	route: "auto-fix",
	priority: 50,
};

let _id = 0;
function jobFor<A>(payload: HarnessJobPayload<A>): JobEnvelope<HarnessJobPayload<A>> {
	_id += 1;
	return {
		id: `j-${_id}`,
		payload,
		attempts: 0,
		metadata: Object.freeze({}),
		state: "inflight",
	};
}

function awaitFirstData<T>(node: Node<T | null>, timeoutMs = 1000): Promise<T> {
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

/** Build a minimal LLMAdapter that returns whatever the test scripts. */
function adapterReturning(
	build: (msgs: readonly ChatMessage[], opts?: LLMInvokeOptions) => unknown,
): LLMAdapter {
	return {
		provider: "test",
		invoke: build as LLMAdapter["invoke"],
		stream: async function* () {
			yield { type: "finish" as const, reason: "stop" };
		},
	};
}

// ---------------------------------------------------------------------------
// defaultLlmExecutor — failure-mode coverage
// ---------------------------------------------------------------------------

describe("defaultLlmExecutor — bridge-layer failure modes", () => {
	it("synchronous adapter throw maps to failure payload", async () => {
		const adapter = adapterReturning(() => {
			throw new Error("sync boom");
		});
		const exec = defaultLlmExecutor(adapter);
		const payload = await awaitFirstData(fromAny(exec(jobFor({ item: ITEM }))));
		expect(payload.execution?.outcome).toBe("failure");
		expect(payload.execution?.detail).toContain("sync boom");
	});

	it("adapter Promise reject maps to failure payload via ERROR arm", async () => {
		const adapter = adapterReturning(() => Promise.reject(new Error("async boom")));
		const exec = defaultLlmExecutor(adapter);
		const payload = await awaitFirstData(fromAny(exec(jobFor({ item: ITEM }))));
		expect(payload.execution?.outcome).toBe("failure");
		expect(payload.execution?.detail).toContain("async boom");
	});

	it("malformed JSON in response.content surfaces as parse error", async () => {
		const adapter = adapterReturning(() =>
			Promise.resolve({
				content: "not json {",
				usage: { input: { regular: 0 }, output: { regular: 0 } },
			}),
		);
		const exec = defaultLlmExecutor(adapter);
		const payload = await awaitFirstData(fromAny(exec(jobFor({ item: ITEM }))));
		expect(payload.execution?.outcome).toBe("failure");
		expect(payload.execution?.detail).toContain("execute parse error");
	});

	it("non-object JSON (literal null) surfaces as parse error", async () => {
		const adapter = adapterReturning(() =>
			Promise.resolve({
				content: "null",
				usage: { input: { regular: 0 }, output: { regular: 0 } },
			}),
		);
		const exec = defaultLlmExecutor(adapter);
		const payload = await awaitFirstData(fromAny(exec(jobFor({ item: ITEM }))));
		expect(payload.execution?.outcome).toBe("failure");
		expect(payload.execution?.detail).toContain("non-object response");
	});

	it("non-object JSON (array) surfaces as parse error", async () => {
		const adapter = adapterReturning(() =>
			Promise.resolve({
				content: "[1,2,3]",
				usage: { input: { regular: 0 }, output: { regular: 0 } },
			}),
		);
		const exec = defaultLlmExecutor(adapter);
		const payload = await awaitFirstData(fromAny(exec(jobFor({ item: ITEM }))));
		expect(payload.execution?.outcome).toBe("failure");
		expect(payload.execution?.detail).toContain("non-object response");
	});

	it("Node-shaped invokeResult that COMPLETEs without DATA surfaces as failure (qa F1 regression)", async () => {
		const adapter = adapterReturning(() =>
			node<LLMResponse>(
				[],
				(_data, actions) => {
					actions.down([[COMPLETE]] satisfies Messages);
					return () => {};
				},
				{ describeKind: "producer" },
			),
		);
		const exec = defaultLlmExecutor(adapter);
		const payload = await awaitFirstData(fromAny(exec(jobFor({ item: ITEM }))));
		expect(payload.execution?.outcome).toBe("failure");
		expect(payload.execution?.detail).toContain("adapter completed without emitting DATA");
	});

	it("Node-shaped invokeResult that emits ERROR surfaces as failure", async () => {
		const adapter = adapterReturning(() =>
			node<LLMResponse>(
				[],
				(_data, actions) => {
					actions.down([[ERROR, new Error("upstream node error")]] satisfies Messages);
					return () => {};
				},
				{ describeKind: "producer" },
			),
		);
		const exec = defaultLlmExecutor(adapter);
		const payload = await awaitFirstData(fromAny(exec(jobFor({ item: ITEM }))));
		expect(payload.execution?.outcome).toBe("failure");
		expect(payload.execution?.detail).toContain("upstream node error");
	});

	it("threads `signal` into adapter.invoke (qa F2 regression)", async () => {
		let receivedSignal: AbortSignal | undefined;
		const adapter = adapterReturning((_msgs, opts) => {
			receivedSignal = opts?.signal;
			return Promise.resolve({
				content: JSON.stringify({ outcome: "success", detail: "ok" }),
				usage: { input: { regular: 0 }, output: { regular: 0 } },
			});
		});
		const exec = defaultLlmExecutor(adapter);
		await awaitFirstData(fromAny(exec(jobFor({ item: ITEM }))));
		expect(receivedSignal).toBeInstanceOf(AbortSignal);
	});
});

// ---------------------------------------------------------------------------
// defaultLlmVerifier — bridge-layer failure modes
// ---------------------------------------------------------------------------

describe("defaultLlmVerifier — bridge-layer failure modes", () => {
	const baseExec = {
		item: ITEM,
		execution: {
			item: ITEM,
			outcome: "success" as const,
			detail: "executed",
		},
	};

	it("missing prior execution → STRUCTURAL defensive guard", async () => {
		// This is the only structural-classified path in defaultLlmVerifier:
		// indicates a topology bug, not a bridge-layer flake.
		const adapter = adapterReturning(() =>
			Promise.resolve({
				content: "{}",
				usage: { input: { regular: 0 }, output: { regular: 0 } },
			}),
		);
		const verifier = defaultLlmVerifier(adapter);
		const payload = await awaitFirstData(fromAny(verifier(jobFor<unknown>({ item: ITEM }))));
		expect(payload.verify?.verified).toBe(false);
		expect(payload.verify?.errorClass).toBe("structural");
		expect(payload.verify?.findings.join(" ")).toContain("no execution");
	});

	it("synchronous adapter throw → SELF-CORRECTABLE failure (qa F3)", async () => {
		const adapter = adapterReturning(() => {
			throw new Error("sync boom");
		});
		const verifier = defaultLlmVerifier(adapter);
		const payload = await awaitFirstData(fromAny(verifier(jobFor(baseExec))));
		expect(payload.verify?.verified).toBe(false);
		expect(payload.verify?.errorClass).toBe("self-correctable");
		expect(payload.verify?.findings.join(" ")).toContain("sync boom");
	});

	it("malformed JSON → SELF-CORRECTABLE parse-error failure", async () => {
		const adapter = adapterReturning(() =>
			Promise.resolve({
				content: "not json {",
				usage: { input: { regular: 0 }, output: { regular: 0 } },
			}),
		);
		const verifier = defaultLlmVerifier(adapter);
		const payload = await awaitFirstData(fromAny(verifier(jobFor(baseExec))));
		expect(payload.verify?.verified).toBe(false);
		expect(payload.verify?.errorClass).toBe("self-correctable");
		expect(payload.verify?.findings.join(" ")).toContain("verify parse error");
	});

	it("non-object JSON → SELF-CORRECTABLE parse-error failure", async () => {
		const adapter = adapterReturning(() =>
			Promise.resolve({
				content: "42",
				usage: { input: { regular: 0 }, output: { regular: 0 } },
			}),
		);
		const verifier = defaultLlmVerifier(adapter);
		const payload = await awaitFirstData(fromAny(verifier(jobFor(baseExec))));
		expect(payload.verify?.verified).toBe(false);
		expect(payload.verify?.errorClass).toBe("self-correctable");
		expect(payload.verify?.findings.join(" ")).toContain("non-object response");
	});

	it("Node-shaped invokeResult COMPLETEs without DATA → SELF-CORRECTABLE failure (qa F1)", async () => {
		const adapter = adapterReturning(() =>
			node<LLMResponse>(
				[],
				(_data, actions) => {
					actions.down([[COMPLETE]] satisfies Messages);
					return () => {};
				},
				{ describeKind: "producer" },
			),
		);
		const verifier = defaultLlmVerifier(adapter);
		const payload = await awaitFirstData(fromAny(verifier(jobFor(baseExec))));
		expect(payload.verify?.verified).toBe(false);
		expect(payload.verify?.errorClass).toBe("self-correctable");
		expect(payload.verify?.findings.join(" ")).toContain(
			"verifier completed without emitting DATA",
		);
	});

	it("threads `signal` into adapter.invoke (qa F2)", async () => {
		let receivedSignal: AbortSignal | undefined;
		const adapter = adapterReturning((_msgs, opts) => {
			receivedSignal = opts?.signal;
			return Promise.resolve({
				content: JSON.stringify({ verified: true, findings: ["ok"] }),
				usage: { input: { regular: 0 }, output: { regular: 0 } },
			});
		});
		const verifier = defaultLlmVerifier(adapter);
		await awaitFirstData(fromAny(verifier(jobFor(baseExec))));
		expect(receivedSignal).toBeInstanceOf(AbortSignal);
	});
});

// ---------------------------------------------------------------------------
// evalVerifier — §9a batch-coalescing for synchronous-emit-during-subscribe
// evaluators (qa D5 regression)
// ---------------------------------------------------------------------------

describe("evalVerifier — async-evaluator §9a coverage", () => {
	it("captures the FINAL settled scores when the evaluator emits across microtask boundaries", async () => {
		// Async-evaluator regression: evaluator's `subscribe`-time recompute
		// fires through `Promise.resolve().then(...)`, so the first emission
		// happens AFTER the synchronous wave ends. The §9a `batch()` wrap
		// inside evalVerifier was specifically aimed at sync-emit
		// coalescing; async emits skip the §9a hazard entirely (no nested
		// emit during subscribe), so the JobFlow pump should still see the
		// final settled scores via the standard first-DATA capture path.
		const { evalVerifier } = await import("../../../utils/harness/eval-verifier.js");
		type Row = { id: string };
		type Score = { taskId: string; score: number };
		const evaluator = (cands: Node<readonly string[]>, ds: Node<readonly Row[]>) => {
			// SENTINEL initial value (no cached DATA) so the JobFlow pump's
			// first-DATA capture waits for the actual computed scores. This
			// is the canonical async-evaluator pattern — emit only AFTER
			// both deps have arrived. Seeding with `[]` would fire an empty
			// scores DATA on subscribe, giving the pump a stale "0/0
			// verified" payload before the real recompute completes.
			const out = node<readonly Score[]>([]);
			let lastCands: readonly string[] | null = null;
			let lastDs: readonly Row[] | null = null;
			let scheduled = false;
			const recomputeAsync = (): void => {
				if (scheduled) return;
				if (lastCands == null || lastDs == null) return;
				scheduled = true;
				Promise.resolve().then(() => {
					scheduled = false;
					if (lastCands == null || lastDs == null) return;
					const best = (lastCands[0] ?? "").toLowerCase();
					out.emit(
						lastDs.map((row) => ({
							taskId: row.id,
							score: best.includes(row.id.toLowerCase()) ? 1 : 0,
						})),
					);
				});
			};
			cands.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA && m[1] != null) {
						lastCands = m[1] as readonly string[];
						recomputeAsync();
					}
				}
			});
			ds.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA && m[1] != null) {
						lastDs = m[1] as readonly Row[];
						recomputeAsync();
					}
				}
			});
			return out;
		};
		const verifier = evalVerifier<string>({
			evaluator,
			datasetFor: () => [{ id: "a" }, { id: "b" }, { id: "c" }],
			threshold: 1.0,
		});
		const job = jobFor<string>({
			item: ITEM,
			execution: { item: ITEM, outcome: "success", detail: "ok", artifact: "a b c" },
		});
		const payload = await awaitFirstData(fromAny(verifier(job)), 2000);
		// Async-evaluator coalesce: scheduling guard + microtask boundary
		// means recompute fires once with both deps captured. JobFlow pump
		// captures that single final emit as the verify result.
		expect(payload.verify?.verified).toBe(true);
		expect(payload.verify?.findings.join(" ")).toContain("3/3");
	});
});

describe("evalVerifier — synchronous-emit-during-subscribe evaluator coalescing", () => {
	it("coalesces evaluator's intra-construction emits via batch() so first DATA is the settled value", async () => {
		// Import inside the test to avoid pulling refine-loop types into the
		// top-level deps when not needed elsewhere.
		const { evalVerifier } = await import("../../../utils/harness/eval-verifier.js");
		// A "presenceEvaluator"-shaped evaluator: subscribes to candidates AND
		// dataset; each subscribe-callback fires synchronously with the cached
		// value, calls recompute() which emits to `out`. Without the §9a
		// `batch()` wrap inside evalVerifier, the first recompute (after
		// candidates.subscribe but BEFORE dataset.subscribe) emits an empty
		// scores array — and the JobFlow pump's first-DATA capture would see
		// that intermediate empty value as the verify result. With the batch,
		// both emits coalesce and the derived sees only the LAST value.
		type Row = { id: string };
		type Score = { taskId: string; score: number };
		const evaluator = (cands: Node<readonly string[]>, ds: Node<readonly Row[]>) => {
			const out = node<readonly Score[]>([], { initial: [] });
			let lastCands: readonly string[] = [];
			let lastDs: readonly Row[] = [];
			const recompute = (): void => {
				const best = (lastCands[0] ?? "").toLowerCase();
				out.emit(
					lastDs.map((row) => ({
						taskId: row.id,
						score: best.includes(row.id.toLowerCase()) ? 1 : 0,
					})),
				);
			};
			cands.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA && m[1] != null) {
						lastCands = m[1] as readonly string[];
						recompute();
					}
				}
			});
			ds.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA && m[1] != null) {
						lastDs = m[1] as readonly Row[];
						recompute();
					}
				}
			});
			return out;
		};
		const verifier = evalVerifier<string>({
			evaluator,
			datasetFor: () => [{ id: "a" }, { id: "b" }, { id: "c" }],
			threshold: 1.0,
		});
		const job = jobFor<string>({
			item: ITEM,
			execution: { item: ITEM, outcome: "success", detail: "ok", artifact: "a b c" },
		});
		const payload = await awaitFirstData(fromAny(verifier(job)));
		// First DATA captured by the pump must be the FINAL settled scores
		// (3/3 verified), NOT the intermediate empty-scores emit.
		expect(payload.verify?.verified).toBe(true);
		expect(payload.verify?.findings.join(" ")).toContain("3/3");
	});
});

// ---------------------------------------------------------------------------
// actuatorExecutor — cancel-on-teardown contract (qa F2 regression)
// ---------------------------------------------------------------------------

describe("actuatorExecutor — cancel-on-teardown", () => {
	it("aborts the AbortSignal when the result Node is unsubscribed before settling", async () => {
		let capturedSignal: AbortSignal | undefined;
		const exec = actuatorExecutor<string>({
			apply(_item, { signal }) {
				capturedSignal = signal;
				// Long-tail Promise that never resolves naturally.
				return new Promise<string>((resolve, reject) => {
					if (signal.aborted) {
						reject(new DOMException("aborted", "AbortError"));
						return;
					}
					signal.addEventListener("abort", () => {
						reject(new DOMException("aborted", "AbortError"));
					});
					setTimeout(() => resolve("never"), 30_000);
				});
			},
		});
		const out = fromAny(exec(jobFor<string>({ item: ITEM })));
		// Subscribe to activate the producer (apply runs), then immediately
		// unsubscribe — mirrors what the JobFlow pump does after capturing
		// first DATA, or what graph teardown does mid-flight.
		const unsub = out.subscribe(() => {});
		// Yield a microtask so the producer's apply runs and captures the signal.
		await Promise.resolve();
		expect(capturedSignal).toBeInstanceOf(AbortSignal);
		expect(capturedSignal?.aborted).toBe(false);
		unsub();
		// Producer cleanup → ac.abort() fires synchronously.
		expect(capturedSignal?.aborted).toBe(true);
	});
});
