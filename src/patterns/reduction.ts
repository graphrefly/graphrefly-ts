/**
 * Reduction primitives (roadmap §8.1).
 *
 * Composable building blocks for taking heterogeneous massive inputs and producing
 * prioritized, auditable, human-actionable output. Each primitive is either a Graph
 * factory or a Node factory, built on top of core + extra primitives.
 *
 * @module
 */

import { batch } from "../core/batch.js";
import type { NodeActions } from "../core/config.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	type Message,
	PAUSE,
	RESOLVED,
	RESUME,
	TEARDOWN,
} from "../core/messages.js";
import { type Node, type NodeOptions, node } from "../core/node.js";
import { derived, effect, state } from "../core/sugar.js";
import { merge } from "../extra/operators.js";
import { reactiveMap } from "../extra/reactive-map.js";
import { Graph, type GraphOptions } from "../graph/graph.js";

// ---------------------------------------------------------------------------
// Shared helpers (same pattern as orchestration.ts)
// ---------------------------------------------------------------------------

export type StepRef = string | Node<unknown>;

import { domainMeta, keepalive, tryIncrementBounded } from "./_internal.js";

function baseMeta(kind: string, meta?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("reduction", kind, meta);
}

// ---------------------------------------------------------------------------
// stratify
// ---------------------------------------------------------------------------

/** A single routing rule for {@link stratify}. */
export type StratifyRule<T> = {
	/** Branch name (used as node name under `branch/<name>`). */
	name: string;
	/** Classifier: returns `true` if the value belongs to this branch. */
	classify: (value: T) => boolean;
	/** Optional operator chain applied to the branch after classification. */
	ops?: (n: Node<T>) => Node;
};

/** Options for {@link stratify}. */
export type StratifyOptions = GraphOptions & {
	meta?: Record<string, unknown>;
};

/**
 * Route input to different reduction branches based on classifier functions.
 *
 * Each branch gets an independent operator chain. Rules are reactive — update
 * the `"rules"` state node to rewrite classification at runtime. Rule updates
 * affect **future items only** (streaming classification, not retroactive).
 *
 * Branch nodes are structural — created at construction time and persist for
 * the graph's lifetime. If a rule name is removed from the rules array, the
 * corresponding branch silently drops items (classifier not found). To tear
 * down a dead branch, call `graph.remove("branch/<name>")`.
 *
 * @param name - Graph name.
 * @param source - Input node (registered externally or will be added as `"source"`).
 * @param rules - Initial routing rules.
 * @param opts - Optional graph/meta options.
 * @returns Graph with `"source"`, `"rules"`, and `"branch/<name>"` nodes.
 *
 * @category patterns
 */
export function stratify<T>(
	name: string,
	source: Node<T>,
	rules: ReadonlyArray<StratifyRule<T>>,
	opts?: StratifyOptions,
): Graph {
	const g = new Graph(name, opts);

	g.add(source as Node<unknown>, { name: "source" });
	const rulesNode = state<ReadonlyArray<StratifyRule<T>>>(rules, {
		meta: baseMeta("stratify_rules"),
	});
	g.add(rulesNode as Node<unknown>, { name: "rules" });

	for (const rule of rules) {
		_addBranch(g, source, rulesNode, rule);
	}

	return g;
}

function _addBranch<T>(
	graph: Graph,
	source: Node<T>,
	rulesNode: Node<ReadonlyArray<StratifyRule<T>>>,
	rule: StratifyRule<T>,
): void {
	const branchName = `branch/${rule.name}`;

	// Two-dep gating: intercepts messages from BOTH source (dep 0) and rules
	// (dep 1).  Classification is deferred until all dirty deps have settled,
	// eliminating the stale-rules race when both are updated in the same batch().
	//
	// Protocol: DIRTY is buffered until DATA arrives. If the classifier matches,
	// emit [DIRTY, DATA]. If not, emit [DIRTY, RESOLVED] so downstream exits
	// dirty status cleanly (spec §1.3.1). Source RESOLVED forwards as RESOLVED.
	// Rules-only changes produce no downstream emission ("future items only").
	//
	// Producer pattern with `[]` deps: the framework does NOT auto-propagate
	// DIRTY/RESOLVED/COMPLETE from source or rules. We forward source terminals
	// explicitly below, and we silently absorb rules signals — preserving the
	// "future items only" semantic (rules changes are invisible downstream).
	const _noValue: unique symbol = Symbol("noValue");
	let sourceDirty = false;
	let rulesDirty = false;
	let sourcePhase2 = false; // source delivered DATA or RESOLVED this cycle
	let sourceValue: T | typeof _noValue = _noValue; // DATA payload, or _noValue for RESOLVED
	let pendingDirty = false; // owe downstream a DIRTY
	// Latest rules DATA, seeded at factory time (wiring-time external read —
	// allowed per foundation-redesign §3.6). Updated by the rules subscribe
	// handler so `resolve()` never reads `rulesNode.cache` from a reactive context.
	let latestRules: ReadonlyArray<StratifyRule<T>> = rulesNode.cache ?? [];

	function resolve(actions: NodeActions): void {
		if (sourcePhase2) {
			sourcePhase2 = false;
			const value = sourceValue;
			sourceValue = _noValue;
			if (value !== _noValue) {
				// Source emitted DATA — classify with settled rules
				const currentRule = latestRules.find((r) => r.name === rule.name);
				let matches = false;
				try {
					matches = currentRule?.classify(value) ?? false;
				} catch {
					matches = false;
				}
				if (matches) {
					pendingDirty = false;
					actions.emit(value);
				} else {
					if (pendingDirty) {
						pendingDirty = false;
						actions.down([[DIRTY], [RESOLVED]]);
					}
				}
			} else {
				// Source RESOLVED (unchanged)
				if (pendingDirty) {
					pendingDirty = false;
					actions.down([[DIRTY], [RESOLVED]]);
				} else {
					actions.down([[RESOLVED]]);
				}
			}
		}
		// else: rules-only change — no reclassification ("future items only")
	}

	// Producer pattern: manually subscribe to source and rules for per-message
	// interception (onMessage removed in v5)
	const filterNode = node<T>(
		[],
		(_data, filterActions) => {
			const srcUnsub = (source as Node).subscribe((msgs) => {
				for (const msg of msgs) {
					_handleStratifyMessage(msg, 0, filterActions);
				}
			});
			const rulesUnsub = (rulesNode as Node).subscribe((msgs) => {
				for (const msg of msgs) {
					_handleStratifyMessage(msg, 1, filterActions);
				}
			});
			return () => {
				srcUnsub();
				rulesUnsub();
			};
		},
		{
			describeKind: "derived",
			meta: baseMeta("stratify_branch", { branch: rule.name }),
			completeWhenDepsComplete: false,
		},
	);

	function _handleStratifyMessage(msg: Message, depIndex: number, actions: NodeActions): boolean {
		const t = msg[0];

		// --- DIRTY (phase 1) ---
		if (t === DIRTY) {
			if (depIndex === 0) {
				sourceDirty = true;
				pendingDirty = true;
			} else {
				rulesDirty = true;
			}
			return true;
		}

		// --- Phase 2 (DATA / RESOLVED) ---
		if (t === DATA || t === RESOLVED) {
			if (depIndex === 0) {
				sourceDirty = false;
				sourcePhase2 = true;
				sourceValue = t === DATA ? (msg[1] as T) : _noValue;
			} else {
				// Rules dep: capture DATA payload into closure before settling.
				if (t === DATA) {
					latestRules = msg[1] as ReadonlyArray<StratifyRule<T>>;
				}
				rulesDirty = false;
			}

			// Wait for all dirty deps to settle
			if (sourceDirty || rulesDirty) return true;

			resolve(actions);
			return true;
		}

		// --- Terminal ---
		if (t === COMPLETE || t === ERROR || t === TEARDOWN) {
			sourceDirty = false;
			rulesDirty = false;
			sourcePhase2 = false;
			sourceValue = _noValue;
			pendingDirty = false;
			if (depIndex === 0) {
				actions.down([msg]);
			}
			// Rules terminal: swallow (branch stays alive)
			return true;
		}

		// Swallow PAUSE/RESUME/INVALIDATE from rules dep (internal impl detail)
		if (depIndex === 1) return true;

		return false;
	}

	graph.add(filterNode as Node<unknown>, { name: branchName });

	// If the rule has an ops chain, apply it and connect the edge
	if (rule.ops) {
		const transformed = rule.ops(filterNode);
		const transformedName = `branch/${rule.name}/out`;
		graph.add(transformed as Node<unknown>, { name: transformedName });
	}
}

// ---------------------------------------------------------------------------
// funnel
// ---------------------------------------------------------------------------

/** A named stage for {@link funnel}. */
export type FunnelStage = {
	/** Stage name (mounted as subgraph). */
	name: string;
	/** Builder: receives a sub-graph, should add an `"input"` and `"output"` node. */
	build: (sub: Graph) => void;
};

/** Options for {@link funnel}. */
export type FunnelOptions = GraphOptions & {
	meta?: Record<string, unknown>;
};

/**
 * Multi-source merge with sequential reduction stages.
 *
 * Sources are merged into a single stream. Each stage is a named subgraph
 * (mounted via `graph.mount()`). Stages connect linearly:
 * `merged → stage[0].input → stage[0].output → stage[1].input → ...`
 *
 * @param name - Graph name.
 * @param sources - Input nodes to merge.
 * @param stages - Sequential reduction stages.
 * @param opts - Optional graph/meta options.
 * @returns Graph with `"merged"` and mounted stage subgraphs.
 *
 * @category patterns
 */
export function funnel<T>(
	name: string,
	sources: ReadonlyArray<Node<T>>,
	stages: ReadonlyArray<FunnelStage>,
	opts?: FunnelOptions,
): Graph {
	if (sources.length === 0) throw new RangeError("funnel requires at least one source");
	if (stages.length === 0) throw new RangeError("funnel requires at least one stage");

	const g = new Graph(name, opts);

	// Merge all sources
	const merged = sources.length === 1 ? sources[0] : merge(...(sources as unknown as Node<T>[]));
	g.add(merged as Node<unknown>, { name: "merged" });

	// Build and mount each stage linearly.
	// Stage inputs are standalone state nodes, so we bridge via subscribe
	// (connect() requires constructor deps). Bridge effects forward DATA
	// from the previous output to the next stage's input.
	let prevOutputPath = "merged";
	for (let i = 0; i < stages.length; i++) {
		const stage = stages[i];
		const sub = new Graph(stage.name);
		stage.build(sub);

		// Validate that the stage has input and output nodes
		try {
			sub.resolve("input");
		} catch {
			throw new Error(`funnel stage "${stage.name}" must define an "input" node`);
		}
		try {
			sub.resolve("output");
		} catch {
			throw new Error(`funnel stage "${stage.name}" must define an "output" node`);
		}

		g.mount(stage.name, sub);

		// Bridge replacement: effect that forwards DATA from previous output
		// to the next stage's input. TEARDOWN excluded because stage lifecycle
		// is managed by the parent graph. Shows up in describe().
		const prevNode = g.resolve(prevOutputPath);
		const stageInputPath = `${stage.name}::input`;
		const stageInput = g.resolve(stageInputPath);
		const bridgeName = `__bridge_${prevOutputPath}→${stage.name}_input`;
		const br = effect(
			[prevNode],
			([data]) => {
				stageInput.down([[DATA, data]]);
			},
			{ name: bridgeName },
		);
		g.add(br as Node<unknown>, { name: bridgeName });
		g.addDisposer(keepalive(br));

		prevOutputPath = `${stage.name}::output`;
	}

	return g;
}

// ---------------------------------------------------------------------------
// feedback
// ---------------------------------------------------------------------------

/** Options for {@link feedback}. */
export type FeedbackOptions = {
	/** Maximum feedback iterations before stopping (default: 10). */
	maxIterations?: number;
	/** Optional budget gate node path for cost-bounded iteration. */
	budgetNode?: StepRef;
	meta?: Record<string, unknown>;
};

/**
 * Introduce a bounded reactive cycle into an existing graph.
 *
 * When `condition` emits a non-null DATA value, the feedback effect routes it
 * back to the `reentry` state node — creating a cycle. Bounded by
 * `maxIterations` (default 10). The counter node (`__feedback_<condition>`)
 * is the source of truth — reset it to 0 to allow more iterations.
 *
 * To remove the feedback cycle, call `graph.remove("__feedback_<condition>")`.
 *
 * @param graph - Existing graph to augment with a feedback cycle.
 * @param condition - Path to a node whose DATA triggers feedback.
 * @param reentry - Path to a state node that receives the feedback value.
 * @param opts - Iteration bounds and metadata.
 * @returns The same graph (mutated with feedback nodes added).
 *
 * @category patterns
 */
export function feedback(
	graph: Graph,
	condition: string,
	reentry: string,
	opts?: FeedbackOptions,
): Graph {
	const maxIter = opts?.maxIterations ?? 10;

	// Internal counter node — source of truth for iteration bound.
	// Reset to 0 to allow more iterations.
	const counterName = `__feedback_${condition}`;
	const counter = state<number>(0, {
		meta: baseMeta("feedback_counter", {
			maxIterations: maxIter,
			feedbackFrom: condition,
			feedbackTo: reentry,
		}),
	});
	graph.add(counter as Node<unknown>, { name: counterName });

	// Resolve the condition and reentry nodes
	const condNode = graph.resolve(condition);
	const reentryNode = graph.resolve(reentry);

	// Graph-visible feedback effect: intercepts condition DATA, routes back to
	// reentry with iteration counting. Registered in the graph so it shows up
	// in describe() and cleans up on graph.destroy().
	// Feedback effect: subscribe to condition node for per-message interception
	// (onMessage removed in v5 — use producer+subscribe instead)
	const feedbackEffectName = `__feedback_effect_${condition}`;
	const feedbackEffect = node(
		[],
		(_data, _feedbackActions) => {
			const unsub = condNode.subscribe((msgs) => {
				for (const msg of msgs) {
					const t = msg[0];
					if (t === DATA) {
						const condValue = msg[1];
						if (condValue == null) return;
						batch(() => {
							if (tryIncrementBounded(counter, maxIter)) {
								reentryNode.down([[DATA, condValue]]);
							}
						});
					} else if (t === COMPLETE || t === ERROR) {
						const terminal: Message = t === ERROR && msg.length > 1 ? [ERROR, msg[1]] : [t];
						counter.down([terminal]);
					}
				}
			});
			return () => unsub();
		},
		{
			name: feedbackEffectName,
			describeKind: "effect",
			meta: {
				...baseMeta("feedback_effect", {
					feedbackFrom: condition,
					feedbackTo: reentry,
				}),
				_internal: true,
			},
		},
	);
	graph.add(feedbackEffect as Node<unknown>, { name: feedbackEffectName });
	graph.addDisposer(keepalive(feedbackEffect));

	return graph;
}

// ---------------------------------------------------------------------------
// budgetGate
// ---------------------------------------------------------------------------

/** A reactive constraint for {@link budgetGate}. */
export type BudgetConstraint<T = unknown> = {
	/** Constraint node whose value is checked. */
	node: Node<T>;
	/** Returns `true` when the constraint is satisfied (budget available). */
	check: (value: T) => boolean;
};

/** Options for {@link budgetGate}. */
export type BudgetGateOptions = Omit<NodeOptions<unknown>, "describeKind" | "name" | "meta"> & {
	meta?: Record<string, unknown>;
};

/**
 * Pass-through that respects reactive constraint nodes.
 *
 * DATA flows through when all constraints are satisfied. When any constraint
 * is exceeded, PAUSE is sent upstream and DATA is buffered. When constraints
 * relax, RESUME is sent and buffered DATA flushes.
 *
 * @param source - Input node.
 * @param constraints - Reactive constraint checks.
 * @param opts - Optional node options.
 * @returns Gated node.
 *
 * @category patterns
 */
export function budgetGate<T>(
	source: Node<T>,
	constraints: ReadonlyArray<BudgetConstraint>,
	opts?: BudgetGateOptions,
): Node<T> {
	if (constraints.length === 0) throw new RangeError("budgetGate requires at least one constraint");

	const constraintNodes = constraints.map((c) => c.node);
	const allDeps = [source as Node, ...constraintNodes] as Node[];

	let buffer: T[] = [];
	let paused = false;
	let pendingResolved = false;
	const lockId = Symbol("budget-gate");

	// Latest DATA from each constraint. Seeded at **activation time** (inside the
	// producer fn below) — a wiring-time boundary read, not a reactive-callback
	// read — so concurrent constraint updates between factory-time and
	// activation-time are reflected before `checkBudget()` first runs. The
	// subscribe handler updates this array on each constraint DATA message, so
	// `checkBudget` never reads `.cache` from inside a reactive callback.
	const latestValues: unknown[] = new Array(constraints.length);

	function checkBudget(): boolean {
		return constraints.every((c, i) => c.check(latestValues[i]));
	}

	function flushBuffer(actions: NodeActions): void {
		while (buffer.length > 0 && checkBudget()) {
			const item = buffer[0]!;
			buffer = buffer.slice(1);
			actions.emit(item);
		}
		// Drain deferred RESOLVED once buffer is empty
		if (buffer.length === 0 && pendingResolved) {
			pendingResolved = false;
			actions.down([[RESOLVED]]);
		}
	}

	// Producer pattern: manually subscribe to all deps for per-message interception
	// (onMessage removed in v5 — use producer+subscribe instead)
	return node<T>(
		[],
		(_data, gateActions) => {
			// Seed `latestValues` at activation (not factory time) so any constraint
			// updates between factory return and first subscribe are captured before
			// source's push-on-subscribe fires `checkBudget()`.
			for (let i = 0; i < constraints.length; i++) {
				latestValues[i] = constraints[i]!.node.cache;
			}
			const unsubs: Array<() => void> = [];
			for (let depIdx = 0; depIdx < allDeps.length; depIdx++) {
				const dep = allDeps[depIdx];
				unsubs.push(
					dep.subscribe((msgs) => {
						for (const msg of msgs) {
							_handleBudgetMessage(msg, depIdx, gateActions);
						}
					}),
				);
			}
			return () => {
				for (const u of unsubs) u();
			};
		},
		{
			...opts,
			describeKind: "derived",
			meta: baseMeta("budget_gate", opts?.meta),
		} as NodeOptions<T>,
	);

	function _handleBudgetMessage(msg: Message, depIndex: number, actions: NodeActions): boolean {
		const t = msg[0];

		// Source messages (dep 0)
		if (depIndex === 0) {
			if (t === DATA) {
				if (checkBudget() && buffer.length === 0) {
					actions.emit(msg[1] as T);
				} else {
					buffer.push(msg[1] as T);
					if (!paused) {
						paused = true;
						actions.up([[PAUSE, lockId]]);
					}
				}
				return true;
			}
			if (t === DIRTY) {
				actions.down([[DIRTY]]);
				return true;
			}
			if (t === RESOLVED) {
				if (buffer.length === 0) {
					actions.down([[RESOLVED]]);
				} else {
					// Buffer non-empty: defer RESOLVED until buffer drains
					pendingResolved = true;
				}
				return true;
			}
			if (t === COMPLETE || t === ERROR) {
				// Force-flush all buffered items regardless of budget (terminal = done)
				for (const item of buffer) {
					actions.emit(item);
				}
				buffer = [];
				pendingResolved = false;
				// Release PAUSE lock before forwarding terminal
				if (paused) {
					paused = false;
					actions.up([[RESUME, lockId]]);
				}
				actions.down([msg]);
				return true;
			}
			return false;
		}

		// Constraint node messages (dep 1+): capture DATA then re-check budget
		if (t === DATA) {
			latestValues[depIndex - 1] = msg[1];
		}
		if (t === DATA || t === RESOLVED) {
			if (checkBudget() && buffer.length > 0) {
				flushBuffer(actions);
				if (buffer.length === 0 && paused) {
					paused = false;
					actions.up([[RESUME, lockId]]);
				}
			} else if (!checkBudget() && !paused && buffer.length > 0) {
				paused = true;
				actions.up([[PAUSE, lockId]]);
			}
			return true;
		}
		if (t === DIRTY) {
			// Don't propagate constraint DIRTY downstream
			return true;
		}
		if (t === ERROR) {
			// Constraint error → forward downstream
			actions.down([msg]);
			return true;
		}
		if (t === COMPLETE) {
			// Constraint completed — locked at last value, no-op
			return true;
		}
		// Unknown constraint types → default forwarding
		return false;
	}
}

// ---------------------------------------------------------------------------
// scorer
// ---------------------------------------------------------------------------

/** A scored item with full breakdown. */
export type ScoredItem<T = unknown> = {
	/** Original value. */
	value: T;
	/** Final weighted score. */
	score: number;
	/** Per-signal breakdown: signal index → weighted contribution. */
	breakdown: number[];
};

/** Options for {@link scorer}. */
export type ScorerOptions = Omit<NodeOptions<unknown>, "describeKind" | "name" | "meta"> & {
	meta?: Record<string, unknown>;
	/** Custom scoring function per signal. Default: identity (signal value IS the score). */
	scoreFns?: ReadonlyArray<(value: unknown) => number>;
};

/**
 * Reactive multi-signal scoring with live weights.
 *
 * Each source emits items to score. Weights are reactive state nodes that
 * LLM or human can adjust live. Output is sorted scored items with full
 * breakdown.
 *
 * @param sources - Signal nodes (each emits a numeric score dimension).
 * @param weights - Reactive weight nodes (one per source).
 * @param opts - Optional node/meta options.
 * @returns Node emitting scored output.
 *
 * @category patterns
 */
export function scorer(
	sources: ReadonlyArray<Node<number>>,
	weights: ReadonlyArray<Node<number>>,
	opts?: ScorerOptions,
): Node<ScoredItem<number[]>> {
	if (sources.length === 0) throw new RangeError("scorer requires at least one source");
	if (sources.length !== weights.length) {
		throw new RangeError("scorer requires the same number of sources and weights");
	}

	const allDeps = [...(sources as unknown as Node[]), ...(weights as unknown as Node[])];
	const n = sources.length;
	const scoreFns = opts?.scoreFns;

	return derived<ScoredItem<number[]>>(
		allDeps,
		(vals) => {
			const signals = vals.slice(0, n) as number[];
			const weightValues = vals.slice(n) as number[];

			const breakdown: number[] = [];
			let totalScore = 0;

			for (let i = 0; i < n; i++) {
				const sig = signals[i] ?? 0;
				const wt = weightValues[i] ?? 0;
				const rawScore = scoreFns?.[i] ? scoreFns[i](sig) : sig;
				const weighted = (rawScore as number) * wt;
				breakdown.push(weighted);
				totalScore += weighted;
			}

			return {
				value: signals,
				score: totalScore,
				breakdown,
			};
		},
		{
			...(opts
				? {
						equals: opts.equals,
						resubscribable: opts.resubscribable,
						resetOnTeardown: opts.resetOnTeardown,
					}
				: {}),
			describeKind: "derived",
			meta: baseMeta("scorer", opts?.meta),
		},
	);
}

// ---------------------------------------------------------------------------
// effectivenessTracker
// ---------------------------------------------------------------------------

/** A single effectiveness record for an action×context pair. */
export type EffectivenessEntry = {
	readonly key: string;
	readonly attempts: number;
	readonly successes: number;
	readonly successRate: number;
};

/** Snapshot shape for the effectiveness tracker node. */
export type EffectivenessSnapshot = ReadonlyMap<string, EffectivenessEntry>;

/** Bundle returned by {@link effectivenessTracker}. */
export interface EffectivenessTrackerBundle {
	/** Reactive node — current effectiveness map snapshot. */
	readonly node: Node<EffectivenessSnapshot>;

	/** Record a completed action (success or failure). */
	record(key: string, success: boolean): void;

	/** Look up effectiveness for a specific key. */
	lookup(key: string): EffectivenessEntry | undefined;

	/** Tear down internal keepalive subscriptions. */
	dispose(): void;
}

/** Options for {@link effectivenessTracker}. */
export type EffectivenessTrackerOptions = {
	/** Name for the reactive map (default "effectiveness-entries"). */
	name?: string;
};

/**
 * Generic action×context → success rate tracker.
 *
 * Generalized from the harness `strategyModel` pattern. Tracks attempts and
 * successes per string key, exposes a reactive snapshot node, and provides
 * `record()` / `lookup()` methods.
 *
 * Use cases: A/B testing, routing optimization, cache policy tuning, retry
 * strategy selection — any domain that tracks effectiveness per action.
 *
 * @param opts - Optional configuration.
 * @returns Bundle with reactive node, record(), lookup(), dispose().
 */
export function effectivenessTracker(
	opts?: EffectivenessTrackerOptions,
): EffectivenessTrackerBundle {
	const _map = reactiveMap<string, EffectivenessEntry>({
		name: opts?.name ?? "effectiveness-entries",
	});

	const snapshot = derived<EffectivenessSnapshot>(
		[_map.entries],
		([mapSnap]) => {
			return new Map(mapSnap as ReadonlyMap<string, EffectivenessEntry>);
		},
		{
			name: `${opts?.name ?? "effectiveness"}-snapshot`,
			equals: (a, b) => {
				const am = a as EffectivenessSnapshot;
				const bm = b as EffectivenessSnapshot;
				if (am.size !== bm.size) return false;
				for (const [k, v] of am) {
					const bv = bm.get(k);
					if (!bv || v.attempts !== bv.attempts || v.successes !== bv.successes) return false;
				}
				return true;
			},
		},
	);

	function record(key: string, success: boolean): void {
		const existing = _map.get(key);
		const attempts = (existing?.attempts ?? 0) + 1;
		const successes = (existing?.successes ?? 0) + (success ? 1 : 0);
		_map.set(key, {
			key,
			attempts,
			successes,
			successRate: successes / attempts,
		});
	}

	function lookup(key: string): EffectivenessEntry | undefined {
		return _map.get(key);
	}

	const _unsub = keepalive(snapshot);

	return {
		node: snapshot,
		record,
		lookup,
		dispose: () => _unsub(),
	};
}
