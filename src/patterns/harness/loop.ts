/**
 * harnessLoop() factory (roadmap §9.0).
 *
 * Wires the static 7-stage topology: INTAKE → TRIAGE → QUEUE → GATE →
 * EXECUTE → VERIFY → REFLECT. Static topology, flowing data — the Kafka
 * insight applied to human+LLM collaboration.
 *
 * @module
 */

import { DATA } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { derived, effect, state } from "../../core/sugar.js";
import { merge } from "../../extra/operators.js";
import { Graph } from "../../graph/graph.js";
import type { LLMAdapter } from "../ai.js";
import { promptNode } from "../ai.js";
import { TopicGraph } from "../messaging.js";
import { type GateController, gate } from "../orchestration.js";

import { type StrategyModelBundle, type StrategySnapshot, strategyModel } from "./strategy.js";
import {
	DEFAULT_QUEUE_CONFIGS,
	defaultErrorClassifier,
	type ErrorClassifier,
	type ExecutionResult,
	type HarnessLoopOptions,
	type IntakeItem,
	type QueueConfig,
	type QueueRoute,
	type TriagedItem,
	type VerifyResult,
} from "./types.js";

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

	constructor(
		name: string,
		intake: TopicGraph<IntakeItem>,
		queues: Map<QueueRoute, TopicGraph<TriagedItem>>,
		gates: Map<QueueRoute, GateController<TriagedItem>>,
		strategy: StrategyModelBundle,
		verifyResults: TopicGraph<VerifyResult>,
	) {
		super(name);
		this.intake = intake;
		this.queues = queues;
		this.gates = gates;
		this.strategy = strategy;
		this.verifyResults = verifyResults;
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
	const triageNode = promptNode<TriagedItem>(
		adapter,
		[intake.latest as Node<unknown>, strategy.node as Node<unknown>],
		opts.triagePrompt ??
			((item: unknown, strat: unknown) => {
				return DEFAULT_TRIAGE_PROMPT.replace("{{strategy}}", JSON.stringify(strat)).replace(
					"{{item}}",
					JSON.stringify(item),
				);
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

	// Router effect: watches triage output and publishes to the correct queue
	const _router = effect([triageNode as Node<unknown>], ([triaged]) => {
		const item = triaged as TriagedItem | null;
		if (!item || !item.route) return;
		const topic = queueTopics.get(item.route);
		if (topic) topic.publish(item);
	});

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

	const executeNode = promptNode<ExecutionResult>(
		adapter,
		[executeInput as Node<unknown>],
		opts.executePrompt ??
			((item: unknown) => {
				return DEFAULT_EXECUTE_PROMPT.replace("{{item}}", JSON.stringify(item));
			}),
		{
			name: "execute",
			format: "json",
			retries: 1,
		},
	);

	// --- Stage 6: VERIFY ---
	const verifyResults = new TopicGraph<VerifyResult>("verify-results", { retainedLimit });

	const verifyNode = promptNode<VerifyResult>(
		adapter,
		[executeNode as Node<unknown>, executeInput as Node<unknown>],
		opts.verifyPrompt ??
			((execution: unknown, item: unknown) => {
				return DEFAULT_VERIFY_PROMPT.replace("{{execution}}", JSON.stringify(execution)).replace(
					"{{item}}",
					JSON.stringify(item),
				);
			}),
		{
			name: "verify",
			format: "json",
			retries: 1,
		},
	);

	// --- Fast-retry path ---
	const maxReingestions = opts.maxReingestions ?? 1;
	let reingestionCount = 0;

	const _fastRetry = effect([verifyNode as Node<unknown>], ([result]) => {
		const vr = result as VerifyResult | null;
		if (!vr) return;

		if (vr.verified) {
			// Success → record in strategy model + publish result
			strategy.record(vr.item.rootCause, vr.item.intervention, true);
			verifyResults.publish(vr);
			return;
		}

		// Failed verification
		const errClass =
			vr.errorClass ??
			errorClassifier({
				item: vr.item,
				outcome: "failure",
				detail: vr.findings.join("; "),
				retryCount: 0,
			});

		// Determine retry count from the execution result
		const exec = (vr as { execution?: ExecutionResult }).execution;
		const retryCount = exec?.retryCount ?? 0;

		if (errClass === "self-correctable" && retryCount < maxRetries) {
			// Fast-retry: publish to retry topic (reactive, not imperative .down())
			const retryItem: TriagedItem = {
				...vr.item,
				summary: `[RETRY ${retryCount + 1}/${maxRetries}] ${vr.item.summary} — Previous attempt failed: ${vr.findings.join("; ")}`,
			};
			retryTopic.publish(retryItem);
		} else {
			// Structural failure or max retries exceeded → full loop via INTAKE
			strategy.record(vr.item.rootCause, vr.item.intervention, false);
			verifyResults.publish(vr);

			// Re-ingest only if under reingestion cap
			if (reingestionCount < maxReingestions) {
				reingestionCount++;
				intake.publish({
					source: "eval",
					summary: `Verification failed for: ${vr.item.summary}`,
					evidence: vr.findings.join("\n"),
					affectsAreas: vr.item.affectsAreas,
					affectsEvalTasks: vr.item.affectsEvalTasks,
					severity: "high",
					relatedTo: [vr.item.summary],
				});
			}
		}
	});

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
