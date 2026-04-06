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
import { bridge, DEFAULT_DOWN } from "../core/bridge.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	type Message,
	PAUSE,
	RESOLVED,
	RESUME,
	TEARDOWN,
} from "../core/messages.js";
import {
	type Node,
	type NodeActions,
	type NodeOptions,
	node,
	type OnMessageHandler,
} from "../core/node.js";
import { derived, state } from "../core/sugar.js";
import { merge } from "../extra/operators.js";
import { GRAPH_META_SEGMENT, Graph, type GraphOptions } from "../graph/graph.js";

// ---------------------------------------------------------------------------
// Shared helpers (same pattern as orchestration.ts)
// ---------------------------------------------------------------------------

export type StepRef = string | Node<unknown>;

function resolveDep(graph: Graph, dep: StepRef): { node: Node<unknown>; path?: string } {
	if (typeof dep === "string") {
		return { node: graph.resolve(dep), path: dep };
	}
	const path = findRegisteredNodePath(graph, dep);
	if (!path) {
		throw new Error(
			"reduction dep node must already be registered in the graph so explicit edges can be recorded; pass a string path or register the node first",
		);
	}
	return { node: dep, path };
}

function findRegisteredNodePath(graph: Graph, target: Node<unknown>): string | undefined {
	const described = graph.describe();
	const metaSegment = `::${GRAPH_META_SEGMENT}::`;
	for (const path of Object.keys(described.nodes).sort()) {
		if (path.includes(metaSegment)) continue;
		try {
			if (graph.resolve(path) === target) return path;
		} catch {
			/* ignore stale path while scanning */
		}
	}
	return undefined;
}

function registerStep(
	graph: Graph,
	name: string,
	step: Node<unknown>,
	depPaths: ReadonlyArray<string>,
): void {
	graph.add(name, step);
	for (const path of depPaths) {
		graph.connect(path, name);
	}
}

function baseMeta(kind: string, meta?: Record<string, unknown>): Record<string, unknown> {
	return {
		reduction: true,
		reduction_type: kind,
		...(meta ?? {}),
	};
}

/** Force-activate a lazy node so it receives messages immediately. */
function keepalive(n: Node<unknown>): () => void {
	return n.subscribe(() => {});
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

	g.add("source", source as Node<unknown>);
	const rulesNode = state<ReadonlyArray<StratifyRule<T>>>(rules, {
		meta: baseMeta("stratify_rules"),
	});
	g.add("rules", rulesNode as Node<unknown>);

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

	// Filter node: passes DATA through only when classify returns true.
	// Reads current rules reactively to support runtime rule rewriting.
	//
	// Protocol: DIRTY is buffered until DATA arrives. If the classifier matches,
	// emit [DIRTY, DATA]. If not, emit [DIRTY, RESOLVED] so downstream exits
	// dirty status cleanly (spec §1.3.1). Source RESOLVED forwards as RESOLVED.
	let pendingDirty = false;
	const filterNode = node<T>([source as Node, rulesNode as Node], () => undefined, {
		describeKind: "operator",
		meta: baseMeta("stratify_branch", { branch: rule.name }),
		onMessage(msg: Message, depIndex: number, actions: NodeActions): boolean {
			// Only intercept source messages (dep 0), let rules changes through default
			if (depIndex !== 0) return false;

			const t = msg[0];
			if (t === DATA) {
				const value = msg[1] as T;
				const currentRules = rulesNode.get() as ReadonlyArray<StratifyRule<T>>;
				const currentRule = currentRules.find((r) => r.name === rule.name);
				if (currentRule && currentRule.classify(value)) {
					// Match: emit DATA (actions.emit handles DIRTY+DATA wrapping)
					pendingDirty = false;
					actions.emit(value);
				} else {
					// No match: emit DIRTY + RESOLVED so downstream exits dirty
					if (pendingDirty) {
						pendingDirty = false;
						actions.down([[DIRTY], [RESOLVED]]);
					}
				}
				return true;
			}
			if (t === DIRTY) {
				pendingDirty = true;
				return true;
			}
			if (t === RESOLVED) {
				// Source unchanged — forward RESOLVED (with buffered DIRTY if any)
				if (pendingDirty) {
					pendingDirty = false;
					actions.down([[DIRTY], [RESOLVED]]);
				} else {
					actions.down([[RESOLVED]]);
				}
				return true;
			}
			// Forward terminal and unknown types
			if (t === COMPLETE || t === ERROR) {
				pendingDirty = false;
				actions.down([msg]);
				return true;
			}
			return false;
		},
	});

	graph.add(branchName, filterNode as Node<unknown>);
	graph.connect("source", branchName);

	// If the rule has an ops chain, apply it and connect the edge
	if (rule.ops) {
		const transformed = rule.ops(filterNode);
		const transformedName = `branch/${rule.name}/out`;
		graph.add(transformedName, transformed as Node<unknown>);
		graph.connect(branchName, transformedName);
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
	g.add("merged", merged as Node<unknown>);

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

		// Graph-visible bridge: forwards all standard types except TEARDOWN
		// from the previous output to the next stage's input. TEARDOWN excluded
		// because stage lifecycle is managed by the parent graph, not the
		// upstream stage. Participates in two-phase push and shows up in describe().
		const prevNode = g.resolve(prevOutputPath);
		const stageInputPath = `${stage.name}::input`;
		const stageInput = g.resolve(stageInputPath);
		const bridgeName = `__bridge_${prevOutputPath}→${stage.name}_input`;
		const br = bridge(prevNode, stageInput, {
			name: bridgeName,
			down: DEFAULT_DOWN.filter((t) => t !== TEARDOWN),
		});
		g.add(bridgeName, br as Node<unknown>);
		g.connect(prevOutputPath, bridgeName);
		keepalive(br);

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
	graph.add(counterName, counter as Node<unknown>);

	// Resolve the condition and reentry nodes
	const condNode = graph.resolve(condition);
	const reentryNode = graph.resolve(reentry);

	// Graph-visible feedback effect: intercepts condition DATA, routes back to
	// reentry with iteration counting. Registered in the graph so it shows up
	// in describe() and cleans up on graph.destroy().
	const feedbackEffectName = `__feedback_effect_${condition}`;
	const feedbackEffect = node([condNode], undefined, {
		name: feedbackEffectName,
		describeKind: "effect",
		meta: baseMeta("feedback_effect", {
			feedbackFrom: condition,
			feedbackTo: reentry,
		}),
		onMessage(msg: Message, _depIndex: number, _actions: NodeActions): boolean {
			const t = msg[0];
			if (t === DATA) {
				const currentCount = counter.get() as number;
				if (currentCount >= maxIter) return true;
				const condValue = msg[1];
				if (condValue == null) return true;
				// Batch counter + reentry so both arrive atomically — no
				// downstream listener sees the counter incremented while reentry
				// still holds the old value (or vice versa).
				batch(() => {
					counter.down([[DATA, currentCount + 1]]);
					reentryNode.down([[DATA, condValue]]);
				});
				return true;
			}
			if (t === COMPLETE || t === ERROR) {
				// Terminal on condition — finalize the feedback cycle.
				// Forward terminal to counter so observers know the cycle is done.
				const terminal: Message = t === ERROR && msg.length > 1 ? [ERROR, msg[1]] : [t];
				counter.down([terminal]);
				return true;
			}
			return false;
		},
	});
	graph.add(feedbackEffectName, feedbackEffect as Node<unknown>);
	graph.connect(condition, feedbackEffectName);
	keepalive(feedbackEffect);

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
export type BudgetGateOptions = Omit<NodeOptions, "describeKind" | "name" | "meta"> & {
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

	function checkBudget(): boolean {
		return constraints.every((c) => c.check(c.node.get()));
	}

	function flushBuffer(actions: NodeActions): void {
		while (buffer.length > 0 && checkBudget()) {
			const item = buffer.shift()!;
			actions.emit(item);
		}
		// Drain deferred RESOLVED once buffer is empty
		if (buffer.length === 0 && pendingResolved) {
			pendingResolved = false;
			actions.down([[RESOLVED]]);
		}
	}

	return node<T>(allDeps, () => undefined, {
		...opts,
		describeKind: "operator",
		meta: baseMeta("budget_gate", opts?.meta),
		onMessage(msg: Message, depIndex: number, actions: NodeActions): boolean {
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

			// Constraint node messages (dep 1+): re-check budget
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
		},
	});
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
export type ScorerOptions = Omit<NodeOptions, "describeKind" | "name" | "meta"> & {
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
			...opts,
			describeKind: "derived",
			meta: baseMeta("scorer", opts?.meta),
		},
	);
}
