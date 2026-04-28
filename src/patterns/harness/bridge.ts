/**
 * Harness bridge factories (roadmap §9.0).
 *
 * Intake bridges, eval source wrapper, before/after comparison,
 * affected-task filter, code-change bridge, and notification effect.
 * All are compositions of existing primitives — no new abstractions.
 *
 * @module
 */

import type { Node } from "../../core/node.js";
import { derived, effect, state } from "../../core/sugar.js";
import { switchMap } from "../../extra/operators.js";
import { fromAny } from "../../extra/sources.js";
import type { TopicGraph } from "../messaging/index.js";

import type { IntakeItem, Severity, TriagedItem } from "./types.js";

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
export interface EvalRunResult {
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
 * @param evalSource - Node emitting EvalRunResult (or EvalRunResult[]).
 * @param intakeTopic - TopicGraph to publish IntakeItem entries to.
 * @param opts - Optional configuration.
 * @returns The effect node (for lifecycle management).
 */
export function evalIntakeBridge(
	evalSource: Node<EvalRunResult | EvalRunResult[]>,
	intakeTopic: TopicGraph<IntakeItem>,
	opts?: EvalIntakeBridgeOptions,
): Node<unknown> {
	const defaultSeverity = opts?.defaultSeverity ?? "medium";

	return effect(
		[evalSource],
		([results]) => {
			if (results == null) return;
			const runs = Array.isArray(results)
				? (results as EvalRunResult[])
				: [results as EvalRunResult];

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

// ---------------------------------------------------------------------------
// Composition A: Eval-driven improvement loop
// ---------------------------------------------------------------------------

/**
 * Wrap any eval runner as a reactive producer node.
 *
 * When `trigger` emits, calls `runner()` and emits the result downstream.
 * Uses `switchMap` + `fromAny` — the async boundary stays in the source
 * layer (spec §5.10). A new trigger cancels any in-flight run.
 *
 * ```ts
 * const trigger = state(0);         // bump to trigger a new run
 * const results = evalSource(trigger, () => runEvals(config));
 * results.subscribe(msgs => { ... });
 * trigger.emit(1);                   // fires the runner
 * ```
 *
 * @param trigger - Any node; each new DATA emission fires the runner.
 * @param runner  - Returns an EvalRunResult (or promise of one).
 */
export function evalSource<T extends EvalRunResult>(
	trigger: Node<unknown>,
	runner: () => T | Promise<T>,
): Node<T> {
	return switchMap(trigger, () => fromAny(runner()) as Node<T>);
}

// ---------------------------------------------------------------------------

/** Per-task delta produced by {@link beforeAfterCompare}. */
export interface EvalTaskDelta {
	taskId: string;
	before: boolean;
	after: boolean;
	/** Score-level diff (after − before), undefined if no scores present. */
	scoreDiff?: number;
}

/** Output of {@link beforeAfterCompare}. */
export interface EvalDelta {
	/** Task IDs that newly fail in `after` (were passing in `before`). */
	newFailures: string[];
	/** Task IDs that now pass in `after` (were failing in `before`). */
	resolved: string[];
	/** Full per-task breakdown. */
	taskDeltas: EvalTaskDelta[];
	/** True when net resolutions > net failures. */
	overallImproved: boolean;
}

/**
 * Derived node that computes before/after eval deltas.
 *
 * Pure computation: no LLM, no async. Compares per-task validity and
 * pass counts between two `EvalRunResult` snapshots.
 *
 * @param before - Node holding the baseline eval result.
 * @param after  - Node holding the new eval result.
 */
export function beforeAfterCompare(
	before: Node<EvalRunResult>,
	after: Node<EvalRunResult>,
): Node<EvalDelta> {
	return derived<EvalDelta>(
		[before as Node<unknown>, after as Node<unknown>],
		([b, a]) => {
			const bRes = b as EvalRunResult;
			const aRes = a as EvalRunResult;

			const beforeMap = new Map<string, EvalTaskResult>(bRes.tasks.map((t) => [t.task_id, t]));
			const afterMap = new Map<string, EvalTaskResult>(aRes.tasks.map((t) => [t.task_id, t]));

			const allIds = new Set([...beforeMap.keys(), ...afterMap.keys()]);
			const taskDeltas: EvalTaskDelta[] = [];
			const newFailures: string[] = [];
			const resolved: string[] = [];

			for (const id of allIds) {
				const bt = beforeMap.get(id);
				const at = afterMap.get(id);
				const beforeValid = bt?.valid ?? false;
				const afterValid = at?.valid ?? false;

				const beforeScore = bt?.judge_scores
					? bt.judge_scores.filter((s) => s.pass).length
					: undefined;
				const afterScore = at?.judge_scores
					? at.judge_scores.filter((s) => s.pass).length
					: undefined;
				const scoreDiff =
					beforeScore !== undefined && afterScore !== undefined
						? afterScore - beforeScore
						: undefined;

				taskDeltas.push({ taskId: id, before: beforeValid, after: afterValid, scoreDiff });
				if (beforeValid && !afterValid) newFailures.push(id);
				if (!beforeValid && afterValid) resolved.push(id);
			}

			return {
				newFailures,
				resolved,
				taskDeltas,
				overallImproved: resolved.length > newFailures.length,
			};
		},
		{ name: "eval-delta" },
	);
}

// ---------------------------------------------------------------------------

/**
 * Derived node that selects which eval task IDs to re-run.
 *
 * Collects `affectsEvalTasks` from all triaged items, deduplicates, then
 * optionally intersects with `fullTaskSet`. Returns a sorted array of IDs.
 *
 * Use this to avoid re-running the full eval suite after each fix: only the
 * tasks that the triaged items claim to affect are returned.
 *
 * @param issues      - Node holding the current list of triaged items.
 * @param fullTaskSet - Optional node (or plain array) of all known task IDs.
 *                      When provided, output is the intersection.
 */
export function affectedTaskFilter(
	issues: Node<readonly TriagedItem[]>,
	fullTaskSet?: Node<readonly string[]> | readonly string[],
): Node<string[]> {
	const taskSetNode: Node<unknown> | null =
		fullTaskSet == null
			? null
			: Array.isArray(fullTaskSet)
				? (state(fullTaskSet as readonly string[]) as Node<unknown>)
				: (fullTaskSet as Node<unknown>);

	const deps: Node<unknown>[] = [issues as Node<unknown>];
	if (taskSetNode) deps.push(taskSetNode);

	return derived<string[]>(
		deps,
		(values) => {
			const items = values[0] as readonly TriagedItem[];
			const all = taskSetNode ? new Set(values[1] as readonly string[]) : null;

			const affected = new Set<string>();
			for (const item of items) {
				for (const id of item.affectsEvalTasks ?? []) {
					if (all == null || all.has(id)) affected.add(id);
				}
			}
			return [...affected].sort();
		},
		{ name: "affected-task-filter" },
	);
}

// ---------------------------------------------------------------------------
// Composition D: Quality gate (CI/CD)
// ---------------------------------------------------------------------------

/** A single lint error emitted by a CI tool. */
export interface LintError {
	file: string;
	line: number;
	col: number;
	rule: string;
	message: string;
}

/** A single test failure emitted by a test runner. */
export interface TestFailure {
	testId: string;
	file: string;
	message: string;
}

/** Structured code-change / CI event. */
export interface CodeChange {
	/** Files touched by the change. */
	files: string[];
	lintErrors?: LintError[];
	testFailures?: TestFailure[];
}

/** Options for {@link codeChangeBridge}. */
export interface CodeChangeBridgeOptions {
	/** Name for the effect node (default "code-change-bridge"). */
	name?: string;
	/** Default severity for generated IntakeItems (default "high"). */
	defaultSeverity?: Severity;
}

/**
 * Intake bridge for code-change / CI events.
 *
 * Watches a source node for `CodeChange` events and publishes one
 * `IntakeItem` per lint error and per test failure to the intake topic.
 * Pass a custom `parser` to override the default mapping.
 *
 * @param source      - Node emitting CodeChange events.
 * @param intakeTopic - TopicGraph to publish IntakeItem entries to.
 * @param parser      - Optional custom parser (overrides default).
 * @param opts        - Optional configuration.
 */
export function codeChangeBridge(
	source: Node<CodeChange>,
	intakeTopic: TopicGraph<IntakeItem>,
	parser?: (change: CodeChange) => IntakeItem[],
	opts?: CodeChangeBridgeOptions,
): Node<unknown> {
	const defaultSeverity = opts?.defaultSeverity ?? "high";

	function defaultParser(change: CodeChange): IntakeItem[] {
		const items: IntakeItem[] = [];
		for (const err of change.lintErrors ?? []) {
			items.push({
				source: "code-change",
				summary: `Lint: ${err.rule} in ${err.file}:${err.line}`,
				evidence: err.message,
				affectsAreas: [err.file],
				severity: defaultSeverity,
			});
		}
		for (const fail of change.testFailures ?? []) {
			items.push({
				source: "test",
				summary: `Test failure: ${fail.testId}`,
				evidence: fail.message,
				affectsAreas: [fail.file],
				affectsEvalTasks: [fail.testId],
				severity: defaultSeverity,
			});
		}
		return items;
	}

	const resolve = parser ?? defaultParser;

	return effect(
		[source as Node<unknown>],
		([change]) => {
			if (change == null) return;
			for (const item of resolve(change as CodeChange)) {
				intakeTopic.publish(item);
			}
		},
		{ name: opts?.name ?? "code-change-bridge" },
	);
}

// ---------------------------------------------------------------------------

/** Transport function for {@link notifyEffect}. Sync or async. */
export type NotifyTransport<T> = (item: T) => void | Promise<void>;

/** Options for {@link notifyEffect}. */
export interface NotifyEffectOptions {
	/** Name for the effect node (default "notify-effect"). */
	name?: string;
}

/**
 * Effect node that sends each new topic entry to an external channel.
 *
 * The `transport` function is called for every item published to `topic`.
 * Async transports are bridged via `fromAny` (spec §5.10 compliant).
 *
 * Typical use: Slack webhook, GitHub PR comment, email notification, etc.
 * The factory provides reactive wiring; the transport supplies domain logic.
 *
 * ```ts
 * notifyEffect(alertQueue, async (item) => {
 *   await fetch(SLACK_WEBHOOK, { method: 'POST', body: JSON.stringify({ text: item.summary }) });
 * });
 * ```
 *
 * @param topic     - TopicGraph whose latest entry triggers the notification.
 * @param transport - Called with each new item. May return a Promise.
 * @param opts      - Optional configuration.
 */
export function notifyEffect<T>(
	topic: TopicGraph<T>,
	transport: NotifyTransport<T>,
	opts?: NotifyEffectOptions,
): Node<unknown> {
	return effect(
		[topic.latest as Node<unknown>],
		([item]) => {
			if (item == null) return;
			// transport is a side effect (webhook, Slack, email). Async transports
			// are fire-and-forget — the Promise result does not feed back into the
			// graph. Suppress unhandled-rejection noise by voiding the return.
			void transport(item as T);
		},
		{ name: opts?.name ?? "notify-effect" },
	);
}
