/**
 * Eval→intake bridge (roadmap §9.0).
 *
 * Effect node that parses eval results into IntakeItem[] and publishes
 * to an intake TopicGraph. Produces per-criterion findings, not per-task scores.
 *
 * @module
 */

import type { Node } from "../../core/node.js";
import { effect } from "../../core/sugar.js";
import type { TopicGraph } from "../messaging.js";

import type { IntakeItem, Severity } from "./types.js";

// ---------------------------------------------------------------------------
// Generic intake bridge
// ---------------------------------------------------------------------------

/** Options for {@link createIntakeBridge}. */
export interface IntakeBridgeOptions {
	/** Name for the effect node (default "intake-bridge"). */
	name?: string;
}

/**
 * Generic source→intake bridge factory.
 *
 * Watches a source node for new values, passes each through a user-supplied
 * `parser` that produces zero or more `IntakeItem`s, and publishes them to
 * the given intake topic.
 *
 * This is the generalized pattern behind {@link evalIntakeBridge}. Use it for
 * CI results, test failures, Slack messages, monitoring alerts, or any domain
 * where structured results should flow into a harness loop.
 *
 * @param source - Reactive node emitting domain-specific data.
 * @param intakeTopic - TopicGraph to publish IntakeItem entries to.
 * @param parser - Converts source data into IntakeItem[]. Return empty array to skip.
 * @param opts - Optional configuration.
 * @returns The effect node (for lifecycle management).
 */
export function createIntakeBridge<T>(
	source: Node<T>,
	intakeTopic: TopicGraph<IntakeItem>,
	parser: (value: T) => IntakeItem[],
	opts?: IntakeBridgeOptions,
): Node<unknown> {
	return effect(
		[source as Node<unknown>],
		([value]) => {
			if (value == null) return;
			const items = parser(value as T);
			for (const item of items) {
				intakeTopic.publish(item);
			}
		},
		{ name: opts?.name ?? "intake-bridge" },
	);
}

// ---------------------------------------------------------------------------
// Generic eval result shape
// ---------------------------------------------------------------------------

/**
 * Minimal eval result shape accepted by the bridge.
 *
 * TS eval runner uses `EvalRun` from `evals/lib/types.ts` which is a superset
 * of this shape. The bridge only reads what it needs.
 */
export interface EvalResult {
	run_id: string;
	model: string;
	tasks: EvalTaskResult[];
}

export interface EvalTaskResult {
	task_id: string;
	valid: boolean;
	judge_scores?: EvalJudgeScore[];
}

export interface EvalJudgeScore {
	claim: string;
	pass: boolean;
	reasoning: string;
}

// ---------------------------------------------------------------------------
// Bridge factory
// ---------------------------------------------------------------------------

export interface EvalIntakeBridgeOptions {
	/** Name for the effect node (default "eval-intake-bridge"). */
	name?: string;
	/** Minimum severity for eval-sourced items (default "medium"). */
	defaultSeverity?: Severity;
}

/**
 * Create an effect node that watches an eval results source and publishes
 * per-criterion findings to an intake topic.
 *
 * Each failing judge criterion produces a separate IntakeItem — not one
 * item per task. This gives the triage stage granular findings to classify.
 *
 * @param evalSource - Node emitting EvalResult (or EvalResult[]).
 * @param intakeTopic - TopicGraph to publish IntakeItem entries to.
 * @param opts - Optional configuration.
 * @returns The effect node (for lifecycle management).
 */
export function evalIntakeBridge(
	evalSource: Node<EvalResult | EvalResult[]>,
	intakeTopic: TopicGraph<IntakeItem>,
	opts?: EvalIntakeBridgeOptions,
): Node<unknown> {
	const defaultSeverity = opts?.defaultSeverity ?? "medium";

	return effect(
		[evalSource],
		([results]) => {
			if (results == null) return;
			const runs = Array.isArray(results) ? (results as EvalResult[]) : [results as EvalResult];

			for (const run of runs) {
				for (const task of run.tasks) {
					// Only process tasks with failures
					if (task.valid && task.judge_scores?.every((s) => s.pass)) continue;

					// Task-level validity failure (no judge scores or overall invalid)
					if (!task.valid && (!task.judge_scores || task.judge_scores.length === 0)) {
						intakeTopic.publish({
							source: "eval",
							summary: `Task ${task.task_id} invalid (model: ${run.model})`,
							evidence: `Run ${run.run_id}: task produced invalid output`,
							affectsAreas: ["graphspec"],
							affectsEvalTasks: [task.task_id],
							severity: defaultSeverity,
						});
						continue;
					}

					// Per-criterion findings
					if (task.judge_scores) {
						for (const score of task.judge_scores) {
							if (score.pass) continue;
							intakeTopic.publish({
								source: "eval",
								summary: `${task.task_id}: ${score.claim} (model: ${run.model})`,
								evidence: score.reasoning,
								affectsAreas: ["graphspec"],
								affectsEvalTasks: [task.task_id],
								severity: defaultSeverity,
							});
						}
					}
				}
			}
		},
		{ name: opts?.name ?? "eval-intake-bridge" },
	);
}
