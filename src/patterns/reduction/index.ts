/**
 * Reduction primitives (roadmap §8.1).
 *
 * Composable building blocks for taking heterogeneous massive inputs and producing
 * prioritized, auditable, human-actionable output. Each primitive is either a Graph
 * factory or a Node factory, built on top of core + extra primitives.
 *
 * @module
 */

import { batch } from "../../core/batch.js";
import { COMPLETE, DATA, ERROR, type Message } from "../../core/messages.js";
import { type Node, type NodeOptions, node } from "../../core/node.js";
import { derived, effect, state } from "../../core/sugar.js";
import { merge } from "../../extra/operators.js";
import { Graph, type GraphOptions } from "../../graph/graph.js";

// ---------------------------------------------------------------------------
// Shared helpers (same pattern as orchestration.ts)
// ---------------------------------------------------------------------------

export type StepRef = string | Node<unknown>;

import { domainMeta } from "../../extra/meta.js";
import { tryIncrementBounded } from "../../extra/mutation/index.js";
import { keepalive } from "../../extra/sources.js";

function baseMeta(kind: string, meta?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("reduction", kind, meta);
}

// stratify moved to `src/extra/stratify.ts` (protocol-level primitive).

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
				stageInput.emit(data);
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
								reentryNode.emit(condValue);
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

// `budgetGate` was promoted to `extra/resilience/budget-gate.ts` per Tier 2.2.
// Import from `@graphrefly/graphrefly/extra` (or `../../extra/resilience/budget-gate.js`
// internally) instead. See the resilience family for sibling primitives:
// `retry`, `circuitBreaker`, `rateLimiter`, `tokenBucket`, `fallback`, `withStatus`.

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

// `effectivenessTracker` was demoted to a harness preset per Tier 2.3 (the
// only consumer was the harness strategy model). Import from
// `@graphrefly/graphrefly/patterns/harness` instead.
