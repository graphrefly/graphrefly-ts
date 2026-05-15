/**
 * Harness bridge factories (roadmap §9.0).
 *
 * Intake bridges, eval source wrapper, before/after comparison,
 * affected-task filter, code-change bridge, and notification effect.
 * All are compositions of existing primitives — no new abstractions.
 *
 * @module
 */

import { type Node, node } from "@graphrefly/pure-ts/core/node.js";
import { fromAny, switchMap } from "@graphrefly/pure-ts/extra";
import type { Graph } from "@graphrefly/pure-ts/graph/graph.js";
import type { TopicGraph } from "../messaging/index.js";

import type { IntakeItem, Severity, TriagedItem } from "./types.js";

// ---------------------------------------------------------------------------
// Generic intake bridge
// ---------------------------------------------------------------------------

/** Options for {@link createIntakeBridge}. */
export interface CreateIntakeBridgeOptions<T> {
	/** Graph to register the effect node on (B.1 narrow-waist visibility). */
	graph: Graph;
	/** Reactive node emitting domain-specific data. */
	source: Node<T>;
	/** TopicGraph to publish IntakeItem entries to. */
	intakeTopic: TopicGraph<IntakeItem>;
	/** Converts source data into IntakeItem[]. Return empty array to skip. */
	parser: (value: T) => IntakeItem[];
	/** Effect-node name (default `"intake-bridge"`). */
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
 * The effect node is registered on the supplied `graph` so it appears in
 * `describe()` and is owned by the graph's lifecycle.
 *
 * @returns The effect node (for lifecycle management).
 */
export function createIntakeBridge<T>(opts: CreateIntakeBridgeOptions<T>): Node<unknown> {
	const { graph, source, intakeTopic, parser, name = "intake-bridge" } = opts;
	const eff = node(
		[source as Node<unknown>],
		(batchData, _actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const value = data[0];
			if (value === undefined) return;
			const items = parser(value as T);
			for (const item of items) {
				intakeTopic.publish(item);
			}
		},
		{ describeKind: "effect" },
	);
	graph.add(eff, { name });
	return eff;
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
	/** Graph to register the effect node on (B.1 narrow-waist visibility). */
	graph: Graph;
	/** Node emitting EvalRunResult (or EvalRunResult[]). */
	source: Node<EvalRunResult | EvalRunResult[]>;
	/** TopicGraph to publish IntakeItem entries to. */
	intakeTopic: TopicGraph<IntakeItem>;
	/** Effect-node name (default `"eval-intake-bridge"`). */
	name?: string;
	/** Minimum severity for eval-sourced items (default `"medium"`). */
	defaultSeverity?: Severity;
}

/**
 * Create an effect node that watches an eval results source and publishes
 * per-criterion findings to an intake topic.
 *
 * Each failing judge criterion produces a separate IntakeItem — not one
 * item per task. This gives the triage stage granular findings to classify.
 *
 * The effect node is registered on the supplied `graph` so it appears in
 * `describe()` and is owned by the graph's lifecycle.
 *
 * @returns The effect node (for lifecycle management).
 */
export function evalIntakeBridge(opts: EvalIntakeBridgeOptions): Node<unknown> {
	const {
		graph,
		source,
		intakeTopic,
		name = "eval-intake-bridge",
		defaultSeverity = "medium",
	} = opts;

	const eff = node(
		[source as Node<unknown>],
		(batchData, _actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const results = data[0];
			if (results === undefined) return;
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
		{ describeKind: "effect" },
	);
	graph.add(eff, { name });
	return eff;
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
 * Pure transform via operator composition — does not construct an
 * effect/derived node, so no `graph` parameter is needed.
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

/** Options for {@link beforeAfterCompare}. */
export interface BeforeAfterCompareOptions {
	/** Graph to register the derived node on (B.1 narrow-waist visibility). */
	graph: Graph;
	/** Node holding the baseline eval result. */
	before: Node<EvalRunResult>;
	/** Node holding the new eval result. */
	after: Node<EvalRunResult>;
	/** Derived-node name (default `"eval-delta"`). */
	name?: string;
}

/**
 * Derived node that computes before/after eval deltas.
 *
 * Pure computation: no LLM, no async. Compares per-task validity and
 * pass counts between two `EvalRunResult` snapshots.
 *
 * The derived node is registered on the supplied `graph` so it appears in
 * `describe()` and is owned by the graph's lifecycle.
 */
export function beforeAfterCompare(opts: BeforeAfterCompareOptions): Node<EvalDelta> {
	const { graph, before, after, name = "eval-delta" } = opts;
	const der = node<EvalDelta>(
		[before as Node<unknown>, after as Node<unknown>],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const bRes = data[0] as EvalRunResult;
			const aRes = data[1] as EvalRunResult;

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

			actions.emit({
				newFailures,
				resolved,
				taskDeltas,
				overallImproved: resolved.length > newFailures.length,
			});
		},
		{ describeKind: "derived" },
	);
	graph.add(der as Node<unknown>, { name });
	return der;
}

// ---------------------------------------------------------------------------

/** Options for {@link affectedTaskFilter}. */
export interface AffectedTaskFilterOptions {
	/** Graph to register the derived node on (B.1 narrow-waist visibility). */
	graph: Graph;
	/** Node holding the current list of triaged items. */
	issues: Node<readonly TriagedItem[]>;
	/**
	 * Optional node (or plain array) of all known task IDs.
	 * When provided, output is the intersection.
	 */
	fullTaskSet?: Node<readonly string[]> | readonly string[];
	/** Derived-node name (default `"affected-task-filter"`). */
	name?: string;
}

/**
 * Derived node that selects which eval task IDs to re-run.
 *
 * Collects `affectsEvalTasks` from all triaged items, deduplicates, then
 * optionally intersects with `fullTaskSet`. Returns a sorted array of IDs.
 *
 * Use this to avoid re-running the full eval suite after each fix: only the
 * tasks that the triaged items claim to affect are returned.
 *
 * The derived node is registered on the supplied `graph` so it appears in
 * `describe()` and is owned by the graph's lifecycle.
 */
export function affectedTaskFilter(opts: AffectedTaskFilterOptions): Node<string[]> {
	const { graph, issues, fullTaskSet, name = "affected-task-filter" } = opts;

	let taskSetNode: Node<unknown> | null = null;
	if (fullTaskSet != null) {
		if (Array.isArray(fullTaskSet)) {
			// Static-array form: register the inline state node so it appears
			// in `describe()`/`explain()` walks (EC8 — qa 2026-04-30).
			const inlineSet = node([], { initial: fullTaskSet as readonly string[] });
			graph.add(inlineSet, { name: `${name}/fullTaskSet` });
			taskSetNode = inlineSet as Node<unknown>;
		} else {
			// User-supplied Node — owned by the caller's graph; don't re-add.
			taskSetNode = fullTaskSet as Node<unknown>;
		}
	}

	const deps: Node<unknown>[] = [issues as Node<unknown>];
	if (taskSetNode) deps.push(taskSetNode);

	const der = node<string[]>(
		deps,
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const items = data[0] as readonly TriagedItem[];
			const all = taskSetNode ? new Set(data[1] as readonly string[]) : null;

			const affected = new Set<string>();
			for (const item of items) {
				for (const id of item.affectsEvalTasks ?? []) {
					if (all == null || all.has(id)) affected.add(id);
				}
			}
			actions.emit([...affected].sort());
		},
		{ describeKind: "derived" },
	);
	graph.add(der as Node<unknown>, { name });
	return der;
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
	/** Graph to register the effect node on (B.1 narrow-waist visibility). */
	graph: Graph;
	/** Node emitting CodeChange events. */
	source: Node<CodeChange>;
	/** TopicGraph to publish IntakeItem entries to. */
	intakeTopic: TopicGraph<IntakeItem>;
	/** Optional custom parser (overrides default). */
	parser?: (change: CodeChange) => IntakeItem[];
	/** Effect-node name (default `"code-change-bridge"`). */
	name?: string;
	/** Default severity for generated IntakeItems (default `"high"`). */
	defaultSeverity?: Severity;
}

/**
 * Intake bridge for code-change / CI events.
 *
 * Watches a source node for `CodeChange` events and publishes one
 * `IntakeItem` per lint error and per test failure to the intake topic.
 * Pass a custom `parser` to override the default mapping.
 *
 * The effect node is registered on the supplied `graph` so it appears in
 * `describe()` and is owned by the graph's lifecycle.
 */
export function codeChangeBridge(opts: CodeChangeBridgeOptions): Node<unknown> {
	const {
		graph,
		source,
		intakeTopic,
		parser,
		name = "code-change-bridge",
		defaultSeverity = "high",
	} = opts;

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

	const eff = node(
		[source as Node<unknown>],
		(batchData, _actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const change = data[0];
			if (change === undefined) return;
			for (const item of resolve(change as CodeChange)) {
				intakeTopic.publish(item);
			}
		},
		{ describeKind: "effect" },
	);
	graph.add(eff, { name });
	return eff;
}

// ---------------------------------------------------------------------------

/** Transport function for {@link notifyEffect}. Sync or async. */
export type NotifyTransport<T> = (item: T) => void | Promise<void>;

/** Options for {@link notifyEffect}. */
export interface NotifyEffectOptions<T> {
	/** Graph to register the effect node on (B.1 narrow-waist visibility). */
	graph: Graph;
	/** TopicGraph whose latest entry triggers the notification. */
	topic: TopicGraph<T>;
	/** Called with each new item. May return a Promise. */
	transport: NotifyTransport<T>;
	/** Effect-node name (default `"notify-effect"`). */
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
 * The effect node is registered on the supplied `graph` so it appears in
 * `describe()` and is owned by the graph's lifecycle.
 *
 * ```ts
 * notifyEffect({ graph, topic: alertQueue, transport: async (item) => {
 *   await fetch(SLACK_WEBHOOK, { method: 'POST', body: JSON.stringify({ text: item.summary }) });
 * }});
 * ```
 */
export function notifyEffect<T>(opts: NotifyEffectOptions<T>): Node<unknown> {
	const { graph, topic, transport, name = "notify-effect" } = opts;
	// SENTINEL contract on `topic.latest` (COMPOSITION-GUIDE §1a + spec §5.12):
	// - `topic.publish(undefined)` is rejected at the publish boundary, so
	//   `undefined` is exclusively the protocol SENTINEL on the read side.
	// - `topic.latest` stays SENTINEL on empty (no eager DATA emission), so
	//   the partial-false first-run gate holds this fn until the first publish.
	// - Legit `null` DATA (when `T` includes `null`) reaches `transport`;
	//   user transports must handle `null` themselves per v5.
	// The `=== undefined` guard below is defense-in-depth for any future
	// empty-batch wave where `prevData[0]` is still SENTINEL — in normal flow
	// the first-run gate has already filtered the empty case.
	const eff = node(
		[topic.latest as Node<unknown>],
		(batchData, _actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const item = data[0];
			if (item === undefined) return;
			// transport is a side effect (webhook, Slack, email). Async transports
			// are fire-and-forget — the Promise result does not feed back into the
			// graph. Suppress unhandled-rejection noise by voiding the return.
			void transport(item as T);
		},
		{ describeKind: "effect" },
	);
	graph.add(eff, { name });
	return eff;
}
