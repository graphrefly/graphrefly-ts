/**
 * harnessLoop() factory (roadmap §9.0).
 *
 * Wires the static 7-stage topology: INTAKE → TRIAGE → QUEUE → GATE →
 * EXECUTE → VERIFY → REFLECT. Static topology, flowing data — the Kafka
 * insight applied to human+LLM collaboration.
 *
 * @module
 */

import type { Node } from "../../core/node.js";
import { effect } from "../../core/sugar.js";
import { merge, withLatestFrom } from "../../extra/operators.js";
import { Graph } from "../../graph/graph.js";
import type { LLMAdapter } from "../ai.js";
import { promptNode } from "../ai.js";
import { TopicGraph } from "../messaging.js";
import { type GateController, gate } from "../orchestration.js";

import { type StrategyModelBundle, type StrategySnapshot, strategyModel } from "./strategy.js";
import {
	DEFAULT_QUEUE_CONFIGS,
	defaultErrorClassifier,
	type ErrorClass,
	type ErrorClassifier,
	type ExecuteOutput,
	type ExecutionResult,
	type HarnessLoopOptions,
	type IntakeItem,
	type QueueConfig,
	type QueueRoute,
	type TriagedItem,
	type VerifyResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip `[RETRY N/M] ` prefix to get the stable item identity key. */
function baseSummary(summary: string): string {
	return summary.replace(/^\[RETRY \d+\/\d+\]\s*/, "");
}

// ---------------------------------------------------------------------------
// Default prompts
// ---------------------------------------------------------------------------

const DEFAULT_TRIAGE_PROMPT = `You are a triage classifier for a reactive collaboration harness.

Given an intake item, classify it and output JSON:
{
  "rootCause": "composition" | "missing-fn" | "bad-docs" | "schema-gap" | "regression" | "unknown",
  "intervention": "template" | "catalog-fn" | "docs" | "wrapper" | "schema-change" | "investigate",
  "route": "auto-fix" | "needs-decision" | "investigation" | "backlog",
  "priority": <number 0-100>,
  "triageReasoning": "<one sentence>"
}

Strategy model (past effectiveness):
{{strategy}}

Intake item:
{{item}}`;

const DEFAULT_EXECUTE_PROMPT = `You are an implementation agent.

Given a triaged issue with root cause and intervention type, produce a fix.

Issue:
{{item}}

Output JSON:
{
  "outcome": "success" | "failure" | "partial",
  "detail": "<description of what was done or what failed>"
}`;

const DEFAULT_VERIFY_PROMPT = `You are a QA reviewer.

Given an execution result, verify whether the fix is correct.

Execution:
{{execution}}

Original issue:
{{item}}

Output JSON:
{
  "verified": true/false,
  "findings": ["<finding1>", ...],
  "errorClass": "self-correctable" | "structural"  // only if verified=false
}`;

// ---------------------------------------------------------------------------
// Queue names
// ---------------------------------------------------------------------------

const QUEUE_NAMES: readonly QueueRoute[] = [
	"auto-fix",
	"needs-decision",
	"investigation",
	"backlog",
];

// ---------------------------------------------------------------------------
// HarnessGraph
// ---------------------------------------------------------------------------

/** The graph returned by {@link harnessLoop}. */
export class HarnessGraph extends Graph {
	/** Intake topic — publish items here to enter the loop. */
	readonly intake: TopicGraph<IntakeItem>;

	/** Per-route queue topics. */
	readonly queues: ReadonlyMap<QueueRoute, TopicGraph<TriagedItem>>;

	/** Per-route gate controllers (only for gated queues). */
	readonly gates: ReadonlyMap<QueueRoute, GateController<TriagedItem>>;

	/** Strategy model bundle — record outcomes, lookup effectiveness. */
	readonly strategy: StrategyModelBundle;

	/** Verify results topic — subscribe to see verification outcomes. */
	readonly verifyResults: TopicGraph<VerifyResult>;

	/** Per-item fast-retry counts (keyed by base summary). */
	readonly retryTracker: ReadonlyMap<string, number>;

	/** Per-item reingestion counts (keyed by base summary). */
	readonly reingestionTracker: ReadonlyMap<string, number>;

	constructor(
		name: string,
		intake: TopicGraph<IntakeItem>,
		queues: Map<QueueRoute, TopicGraph<TriagedItem>>,
		gates: Map<QueueRoute, GateController<TriagedItem>>,
		strategy: StrategyModelBundle,
		verifyResults: TopicGraph<VerifyResult>,
		retryTracker: Map<string, number>,
		reingestionTracker: Map<string, number>,
	) {
		super(name);
		this.intake = intake;
		this.queues = queues;
		this.gates = gates;
		this.strategy = strategy;
		this.verifyResults = verifyResults;
		this.retryTracker = retryTracker;
		this.reingestionTracker = reingestionTracker;
	}
}

// ---------------------------------------------------------------------------
// harnessLoop factory
// ---------------------------------------------------------------------------

/**
 * Wire the reactive collaboration loop as a static-topology graph.
 *
 * The loop has 7 stages:
 * 1. **INTAKE** — items arrive from multiple sources via `intake.publish()`
 * 2. **TRIAGE** — promptNode classifies, routes, and prioritizes
 * 3. **QUEUE** — 4 priority-ordered TopicGraphs (auto-fix, needs-decision, investigation, backlog)
 * 4. **GATE** — human approval on configurable queues
 * 5. **EXECUTE** — promptNode or human implements the fix
 * 6. **VERIFY** — promptNode reviews + optional fast-retry
 * 7. **REFLECT** — strategy model records outcomes
 *
 * @param name - Graph name.
 * @param opts - Configuration.
 * @returns HarnessGraph with controller accessors.
 */
export function harnessLoop(name: string, opts: HarnessLoopOptions): HarnessGraph {
	const adapter = opts.adapter as LLMAdapter;
	const maxRetries = opts.maxRetries ?? 2;
	const retainedLimit = opts.retainedLimit ?? 1000;
	const errorClassifier: ErrorClassifier = opts.errorClassifier ?? defaultErrorClassifier;

	// Merge queue configs with defaults
	const queueConfigs = new Map<QueueRoute, QueueConfig>();
	for (const route of QUEUE_NAMES) {
		queueConfigs.set(route, {
			...DEFAULT_QUEUE_CONFIGS[route],
			...opts.queues?.[route],
		});
	}

	// --- Stage 1: INTAKE ---
	const intake = new TopicGraph<IntakeItem>("intake", { retainedLimit });

	// --- Strategy model (used by triage + reflect) ---
	const strategy = strategyModel();

	// --- Stage 2: TRIAGE ---
	// Strategy context uses withLatestFrom: intake.latest is the reactive trigger,
	// strategy.node is sampled without being a trigger. This breaks the feedback
	// cycle (verify → strategy.record() → strategy.node) reactively — strategy
	// changes don't re-fire triage, only new intake items do.
	const triageInput = withLatestFrom(
		intake.latest as Node<unknown>,
		strategy.node as Node<unknown>,
	);

	const triageNode = promptNode<TriagedItem>(
		adapter,
		[triageInput as Node<unknown>],
		opts.triagePrompt ??
			((pair: unknown) => {
				const [item, strat] = pair as [unknown, StrategySnapshot];
				// Empty text → promptNode's SENTINEL gate skips the LLM call.
				if (!item) return "";
				return DEFAULT_TRIAGE_PROMPT.replace(
					"{{strategy}}",
					JSON.stringify(Array.from(strat.entries())),
				).replace("{{item}}", JSON.stringify(item));
			}),
		{
			name: "triage",
			format: "json",
			retries: 1,
		},
	);

	// --- Stage 3: QUEUE ---
	const queueTopics = new Map<QueueRoute, TopicGraph<TriagedItem>>();
	for (const route of QUEUE_NAMES) {
		queueTopics.set(route, new TopicGraph<TriagedItem>(`queue/${route}`, { retainedLimit }));
	}

	// Router effect: watches triage output and publishes to the correct queue.
	// Keepalive subscription activates the lazy computation chain (COMPOSITION-GUIDE §1).
	const router = effect([triageNode as Node<unknown>], ([triaged]) => {
		const item = triaged as TriagedItem | null;
		if (!item || !item.route) return;
		const topic = queueTopics.get(item.route);
		if (topic) topic.publish(item);
	});
	router.subscribe(() => {});

	// --- Stage 4: GATE ---
	// Create a container graph for gates (gate() requires a Graph to register nodes in)
	const gateGraph = new Graph("gates");
	const gateControllers = new Map<QueueRoute, GateController<TriagedItem>>();

	for (const route of QUEUE_NAMES) {
		const config = queueConfigs.get(route)!;
		const topic = queueTopics.get(route)!;

		if (config.gated) {
			// Register the topic's latest node in the gate graph so gate() can resolve it
			gateGraph.add(`${route}/source`, topic.latest as Node<unknown>);
			const ctrl = gate<TriagedItem>(gateGraph, `${route}/gate`, `${route}/source`, {
				maxPending: config.maxPending,
				startOpen: config.startOpen,
			});
			gateControllers.set(route, ctrl);
		}
	}

	// --- Stage 5: EXECUTE ---
	// Merge all gate outputs + ungated queue latests + retry feedback into a
	// single execute input using the merge() operator (no imperative .down()).
	const retryTopic = new TopicGraph<TriagedItem>("retry-input", { retainedLimit });

	const queueOutputs: Node<TriagedItem | null>[] = [];
	for (const route of QUEUE_NAMES) {
		const config = queueConfigs.get(route)!;
		if (config.gated && gateControllers.has(route)) {
			queueOutputs.push(gateControllers.get(route)!.node as Node<TriagedItem | null>);
		} else {
			queueOutputs.push(queueTopics.get(route)!.latest as Node<TriagedItem | null>);
		}
	}
	queueOutputs.push(retryTopic.latest as Node<TriagedItem | null>);

	const executeInput = merge<TriagedItem | null>(...queueOutputs);

	const executeNode = promptNode<ExecuteOutput>(
		adapter,
		[executeInput as Node<unknown>],
		opts.executePrompt ??
			((item: unknown) => DEFAULT_EXECUTE_PROMPT.replace("{{item}}", JSON.stringify(item))),
		{
			name: "execute",
			format: "json",
			retries: 1,
		},
	);

	// --- Stage 6: VERIFY ---
	const verifyResults = new TopicGraph<VerifyResult>("verify-results", { retainedLimit });

	// The LLM returns only {verified, findings, errorClass?}. We type the promptNode
	// output as the partial shape and assemble the full VerifyResult downstream.
	type VerifyOutput = { verified: boolean; findings: string[]; errorClass?: ErrorClass };

	const verifyNode = promptNode<VerifyOutput>(
		adapter,
		[executeNode as Node<unknown>, executeInput as Node<unknown>],
		opts.verifyPrompt ??
			((execution: unknown, item: unknown) =>
				DEFAULT_VERIFY_PROMPT.replace("{{execution}}", JSON.stringify(execution)).replace(
					"{{item}}",
					JSON.stringify(item),
				)),
		{
			name: "verify",
			format: "json",
			retries: 1,
		},
	);

	// --- Fast-retry path ---
	// Assemble full VerifyResult from verify output + execution context.
	//
	// F2 fix: use nested withLatestFrom so the effect fires ONLY when verifyNode
	// settles, sampling executeNode + executeInput at that moment. This prevents
	// mismatched values when a new item arrives before the previous finishes.
	const verifyWithExec = withLatestFrom(verifyNode as Node<unknown>, executeNode as Node<unknown>);
	const verifyContext = withLatestFrom(
		verifyWithExec as Node<unknown>,
		executeInput as Node<unknown>,
	);

	const maxReingestions = opts.maxReingestions ?? 1;
	const retryTracker = new Map<string, number>();
	const reingestionTracker = new Map<string, number>();

	const fastRetry = effect([verifyContext as Node<unknown>], ([ctx]) => {
		const [[vo, execRaw], item] = ctx as [
			[VerifyOutput | null, ExecuteOutput | null],
			TriagedItem | null,
		];
		if (!vo || !item) return;

		// Assemble full ExecutionResult + VerifyResult from LLM outputs + context
		const exec: ExecutionResult = {
			item,
			outcome: execRaw?.outcome ?? "failure",
			detail: execRaw?.detail ?? "unknown",
		};
		const vr: VerifyResult = {
			item,
			execution: exec,
			verified: vo.verified,
			findings: vo.findings ?? [],
			errorClass: vo.errorClass,
		};

		if (vr.verified) {
			strategy.record(item.rootCause, item.intervention, true);
			verifyResults.publish(vr);
			return;
		}

		// Failed verification
		const errClass =
			vr.errorClass ??
			errorClassifier({
				item,
				outcome: "failure",
				detail: vr.findings.join("; "),
			});

		const key = baseSummary(item.summary);
		const retryCount = retryTracker.get(key) ?? 0;

		if (errClass === "self-correctable" && retryCount < maxRetries) {
			retryTracker.set(key, retryCount + 1);
			const retryItem: TriagedItem = {
				...item,
				summary: `[RETRY ${retryCount + 1}/${maxRetries}] ${baseSummary(item.summary)} — Previous attempt failed: ${vr.findings.join("; ")}`,
			};
			retryTopic.publish(retryItem);
		} else {
			// Structural failure or max retries exceeded → full loop via INTAKE
			strategy.record(item.rootCause, item.intervention, false);
			verifyResults.publish(vr);

			// Per-item + global reingestion cap
			const itemReingestions = reingestionTracker.get(key) ?? 0;
			if (itemReingestions < maxReingestions) {
				reingestionTracker.set(key, itemReingestions + 1);
				intake.publish({
					source: "eval",
					summary: `Verification failed for: ${baseSummary(item.summary)}`,
					evidence: vr.findings.join("\n"),
					affectsAreas: item.affectsAreas,
					affectsEvalTasks: item.affectsEvalTasks,
					severity: "high",
					relatedTo: [baseSummary(item.summary)],
				});
			}
		}
	});

	fastRetry.subscribe(() => {}); // keepalive (COMPOSITION-GUIDE §1)

	// --- Stage 7: REFLECT ---
	// Strategy model is already updated in the fast-retry/verify effect above.
	// Hypothesis generation and memory distillation are pluggable extensions
	// wired externally via verifyResults topic subscription — not hardcoded here.

	// --- Assemble HarnessGraph ---
	const harness = new HarnessGraph(
		name,
		intake,
		queueTopics,
		gateControllers,
		strategy,
		verifyResults,
		retryTracker,
		reingestionTracker,
	);

	// Mount subgraphs
	harness.mount("intake", intake);
	for (const [route, topic] of queueTopics) {
		harness.mount(`queue/${route}`, topic);
	}
	harness.mount("gates", gateGraph);
	harness.mount("retry-input", retryTopic);
	harness.mount("verify-results", verifyResults);

	return harness;
}
