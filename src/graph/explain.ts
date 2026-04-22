/**
 * Causal walkback over a {@link Graph.describe} snapshot (roadmap §9.2).
 *
 * `explainPath` finds the shortest dep-chain from `from` to `to` and returns a
 * step-by-step {@link CausalChain} enriched with each node's current value,
 * status, last-mutation actor, and any `graph.trace()` reasoning annotation.
 *
 * Pure function over the snapshot — peer to {@link reachable}. The
 * {@link Graph.explain} instance method auto-passes `describe({detail:"standard"})`
 * plus runtime annotations and `lastMutation` so callers get rich output by
 * default.
 *
 * @module
 */
import type { Actor } from "../core/actor.js";
import type { DescribeNodeOutput } from "../core/meta.js";
import type { GraphDescribeOutput } from "./graph.js";

/** One node along the causal chain returned by {@link explainPath}. */
export interface CausalStep {
	/** Qualified node path. */
	path: string;
	/** Node kind (`state` / `derived` / `producer` / etc.). */
	type: DescribeNodeOutput["type"];
	/** Status as of the source snapshot. */
	status?: DescribeNodeOutput["status"];
	/** Cached value at snapshot time (omitted when describe didn't include it). */
	value?: unknown;
	/** Hop distance from `from` (0 = `from`, N = `to`). */
	hop: number;
	/** Annotation set via `graph.trace(path, annotation)` or `graph.add(path, node, { annotation })`, when present. */
	annotation?: string;
	/** Most recent guarded mutation, when known. */
	lastMutation?: Readonly<{ actor: Actor; timestamp_ns: number }>;
	/** V0/V1 versioning info, when present. */
	v?: DescribeNodeOutput["v"];
	/** Index of this step in the next step's `deps` (i.e. which dep slot fed forward). */
	dep_index?: number;
	/**
	 * All dep slots when the same dep appears multiple times in the next
	 * step's `deps`. Present only for multi-edge connections; `dep_index`
	 * always equals `dep_indices[0]` when set.
	 */
	dep_indices?: number[];
}

/** Outcome of an {@link explainPath} call. */
export interface CausalChain {
	from: string;
	to: string;
	/** True when a path was found. */
	found: boolean;
	/** Why the chain may be empty/incomplete. `"ok"` when `found` is true. */
	reason: "ok" | "no-such-from" | "no-such-to" | "no-path" | "max-depth-exceeded";
	/** Ordered steps — first element is `from`, last is `to`. Empty when `!found`. */
	steps: readonly CausalStep[];
	/** Pretty multi-line rendering. Always present, even on failure (one-line message). */
	text: string;
	/** JSON-serializable form (drops `text` to keep payloads compact). */
	toJSON(): {
		from: string;
		to: string;
		found: boolean;
		reason: CausalChain["reason"];
		steps: readonly CausalStep[];
	};
}

/** Options for {@link explainPath}. */
export interface ExplainPathOptions {
	/** Maximum hop distance to search. Omit for unbounded. */
	maxDepth?: number;
	/** Per-path reasoning annotations (typically `graph.trace()` output map). */
	annotations?: ReadonlyMap<string, string>;
	/** Per-path `lastMutation` map (overrides describe-derived values). */
	lastMutations?: ReadonlyMap<string, Readonly<{ actor: Actor; timestamp_ns: number }>>;
	/**
	 * When `true` and `from === to`, search for a non-trivial cycle (path
	 * back to `from` through ≥1 other node) instead of returning the trivial
	 * single-step. Use when debugging feedback loops (COMPOSITION-GUIDE §7).
	 * If no real cycle exists, falls back to the trivial single-step. Default
	 * `false` — backward-compatible.
	 */
	findCycle?: boolean;
}

/**
 * Walks backward from `to` through `deps` to find the shortest path to `from`,
 * then assembles an ordered, enriched {@link CausalChain}.
 *
 * @param described - `graph.describe()` output (any detail level; richer detail → richer steps).
 * @param from - Path of the upstream node (the cause).
 * @param to - Path of the downstream node (the effect).
 * @param opts - Optional `maxDepth` and per-path annotation overlays.
 * @returns A {@link CausalChain} — `found:false` with a `reason` when no path exists.
 *
 * @example
 * ```ts
 * import { explainPath } from "@graphrefly/graphrefly-ts";
 * const chain = explainPath(graph.describe({ detail: "standard" }), "input", "result");
 * console.log(chain.text);
 * ```
 */
export function explainPath(
	described: GraphDescribeOutput,
	from: string,
	to: string,
	opts: ExplainPathOptions = {},
): CausalChain {
	const fromExists = from in described.nodes;
	const toExists = to in described.nodes;
	if (!fromExists) return makeFailure(from, to, "no-such-from");
	if (!toExists) return makeFailure(from, to, "no-such-to");

	const maxDepth = opts.maxDepth;
	if (maxDepth != null && (!Number.isInteger(maxDepth) || maxDepth < 0)) {
		throw new Error(`explainPath: maxDepth must be an integer >= 0`);
	}

	if (from === to) {
		// findCycle: search for shortest non-trivial cycle (a path of ≥2 hops
		// back to `from` through other nodes). Falls back to trivial single
		// step if no real cycle exists.
		if (opts.findCycle === true) {
			const cycle = findShortestCycle(described, from, opts);
			if (cycle != null) return cycle;
		}
		const step = buildStep(from, described.nodes[from]!, 0, opts);
		return makeSuccess(from, to, [step]);
	}

	if (maxDepth === 0) return makeFailure(from, to, "no-path");

	const result = bfsShortestPath(described, from, to, maxDepth);
	if (!result.found) {
		return makeFailure(from, to, result.truncated ? "max-depth-exceeded" : "no-path");
	}
	return makeSuccess(from, to, materializeSteps(described, result.pathOrder, opts));
}

// ── BFS helpers ──────────────────────────────────────────────────────────

type StepPlan = { path: string; depIndices?: number[] };

interface BfsResult {
	found: boolean;
	pathOrder: StepPlan[];
	truncated: boolean;
}

/**
 * Backward BFS from `to` to `from`. Returns the ordered chain `from → … → to`
 * with `depIndices` annotating each non-final step (which slot(s) in the next
 * step's `deps` list connect us — typically a single index, but multi-edges
 * preserve every matching slot).
 */
function bfsShortestPath(
	described: GraphDescribeOutput,
	from: string,
	to: string,
	maxDepth: number | undefined,
): BfsResult {
	type Pred = { from: string; depIndices: number[] };
	const pred = new Map<string, Pred>();
	const queue: Array<{ path: string; depth: number }> = [{ path: to, depth: 0 }];
	const visited = new Set<string>([to]);
	let head = 0;
	let truncated = false;

	while (head < queue.length) {
		const cur = queue[head++]!;
		if (cur.path === from) break;
		if (maxDepth != null && cur.depth >= maxDepth) {
			const node = described.nodes[cur.path];
			if (node?.deps && node.deps.length > 0) truncated = true;
			continue;
		}
		const node = described.nodes[cur.path];
		if (node == null) continue;
		const deps = node.deps ?? [];
		// Aggregate all dep-slot indices for each unique dep — preserves
		// multi-edge information when the same dep appears twice.
		const slots = new Map<string, number[]>();
		for (let i = 0; i < deps.length; i++) {
			const dep = deps[i]!;
			if (!dep) continue;
			let arr = slots.get(dep);
			if (arr == null) {
				arr = [];
				slots.set(dep, arr);
			}
			arr.push(i);
		}
		for (const [dep, indices] of slots) {
			if (visited.has(dep)) continue;
			visited.add(dep);
			pred.set(dep, { from: cur.path, depIndices: indices });
			queue.push({ path: dep, depth: cur.depth + 1 });
		}
	}

	if (!pred.has(from)) {
		return { found: false, pathOrder: [], truncated };
	}

	// Reconstruct: walk pred from `from` forward to `to`.
	const pathOrder: StepPlan[] = [{ path: from }];
	let cursor = from;
	while (cursor !== to) {
		const p = pred.get(cursor);
		if (p == null) return { found: false, pathOrder: [], truncated: false };
		// Attach depIndices to the step we just came from (cursor) — dep_index
		// names "which slot in the NEXT step's deps am I".
		pathOrder[pathOrder.length - 1]!.depIndices = p.depIndices;
		pathOrder.push({ path: p.from });
		cursor = p.from;
	}
	return { found: true, pathOrder, truncated: false };
}

/**
 * Find the shortest cycle starting and ending at `start`, excluding the
 * trivial 0-hop "self-step" case. Returns a {@link CausalChain} success when
 * a cycle of length ≥2 exists, otherwise `null`. Handles direct self-loops
 * (`start ∈ deps(start)`) and multi-hop cycles uniformly.
 */
function findShortestCycle(
	described: GraphDescribeOutput,
	start: string,
	opts: ExplainPathOptions,
): CausalChain | null {
	const startNode = described.nodes[start];
	if (startNode == null) return null;
	const startDeps = startNode.deps ?? [];

	// Direct self-loop: start ∈ deps(start). Return [start, start] with
	// dep_index pointing at the matching slot(s).
	const selfSlots: number[] = [];
	for (let i = 0; i < startDeps.length; i++) if (startDeps[i] === start) selfSlots.push(i);
	if (selfSlots.length > 0) {
		const step0 = buildStep(start, startNode, 0, opts);
		step0.dep_index = selfSlots[0]!;
		const step1 = buildStep(start, startNode, 1, opts);
		return makeSuccess(start, start, [step0, step1]);
	}

	// Multi-hop cycle: BFS from each direct dep of start back to start.
	let best: BfsResult | null = null;
	for (let i = 0; i < startDeps.length; i++) {
		const dep = startDeps[i]!;
		if (!dep || dep === start) continue;
		const sub = bfsShortestPath(described, dep, start, opts.maxDepth);
		if (!sub.found) continue;
		if (best == null || sub.pathOrder.length < best.pathOrder.length) {
			best = sub;
			// Prepend `start` so the cycle reads: start → dep → … → start.
			// The slot index from start to its first dep needs preserving.
			best = {
				found: true,
				pathOrder: [{ path: start, depIndices: [i] }, ...sub.pathOrder],
				truncated: false,
			};
		}
	}
	if (best == null) return null;
	return makeSuccess(start, start, materializeSteps(described, best.pathOrder, opts));
}

function materializeSteps(
	described: GraphDescribeOutput,
	pathOrder: readonly StepPlan[],
	opts: ExplainPathOptions,
): CausalStep[] {
	return pathOrder.map((entry, i) => {
		const node = described.nodes[entry.path]!;
		const step = buildStep(entry.path, node, i, opts);
		if (entry.depIndices != null && entry.depIndices.length > 0) {
			step.dep_index = entry.depIndices[0]!;
			if (entry.depIndices.length > 1) step.dep_indices = [...entry.depIndices];
		}
		return step;
	});
}

function buildStep(
	path: string,
	node: DescribeNodeOutput,
	hop: number,
	opts: ExplainPathOptions,
): CausalStep {
	const step: CausalStep = {
		path,
		type: node.type,
		hop,
	};
	if (node.status !== undefined) step.status = node.status;
	if ("value" in node) step.value = node.value;
	if (node.v != null) step.v = node.v;
	const annotation = opts.annotations?.get(path) ?? node.annotation;
	if (annotation != null) step.annotation = annotation;
	const lastMutation = opts.lastMutations?.get(path) ?? node.lastMutation;
	if (lastMutation != null) step.lastMutation = lastMutation;
	return step;
}

function makeSuccess(from: string, to: string, steps: readonly CausalStep[]): CausalChain {
	return finalize(from, to, true, "ok", steps);
}

function makeFailure(from: string, to: string, reason: CausalChain["reason"]): CausalChain {
	return finalize(from, to, false, reason, []);
}

function finalize(
	from: string,
	to: string,
	found: boolean,
	reason: CausalChain["reason"],
	steps: readonly CausalStep[],
): CausalChain {
	const text = renderChain(from, to, found, reason, steps);
	return {
		from,
		to,
		found,
		reason,
		steps,
		text,
		toJSON() {
			return { from, to, found, reason, steps };
		},
	};
}

function renderChain(
	from: string,
	to: string,
	found: boolean,
	reason: CausalChain["reason"],
	steps: readonly CausalStep[],
): string {
	if (!found) {
		switch (reason) {
			case "no-such-from":
				return `explainPath: no node named "${from}"`;
			case "no-such-to":
				return `explainPath: no node named "${to}"`;
			case "max-depth-exceeded":
				return `explainPath: no path from "${from}" to "${to}" within maxDepth`;
			default:
				return `explainPath: no path from "${from}" to "${to}"`;
		}
	}
	const lines: string[] = [`Causal path: ${from} → ${to} (${steps.length} step(s))`];
	for (const step of steps) {
		const arrow = step.hop === 0 ? "·" : "↓";
		const head = `  ${arrow} ${step.path} (${step.type}${step.status ? `/${step.status}` : ""})`;
		lines.push(head);
		if ("value" in step) {
			lines.push(`      value: ${formatValue(step.value)}`);
		}
		if (step.annotation != null) {
			lines.push(`      annotation: ${step.annotation}`);
		}
		if (step.lastMutation != null) {
			const a = step.lastMutation.actor;
			lines.push(`      actor: ${a.type}${a.id ? `:${a.id}` : ""}`);
		}
	}
	return lines.join("\n");
}

function formatValue(v: unknown): string {
	if (v === undefined) return "<sentinel>";
	if (v === null) return "null";
	if (typeof v === "string") return JSON.stringify(v);
	if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
	try {
		const s = JSON.stringify(v);
		return s.length > 80 ? `${s.slice(0, 77)}...` : s;
	} catch {
		return String(v);
	}
}
