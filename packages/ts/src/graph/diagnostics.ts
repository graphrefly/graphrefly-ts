/**
 * Pure graph diagnostics over {@link DescribeSnapshot} (D39/R-describe).
 *
 * These helpers re-derive the useful frozen pure-ts inspection utilities without restoring
 * graph methods, path facades, actors, soft edges, or storage coupling. They operate only on the
 * public JSON-serializable describe shape; the live topology truth remains R-edges-derived.
 */

import type { DescribeNode, DescribeSnapshot } from "./describe.js";

export type ReachableDirection = "upstream" | "downstream";

export interface ReachableOptions {
	/** Maximum hop distance to walk. Omit for unbounded. */
	maxDepth?: number;
	/** Walk both upstream and downstream, ignoring `direction`. */
	both?: boolean;
	/** Return depths/truncation metadata instead of only sorted paths. */
	withDetail?: boolean;
}

export interface ReachableResult {
	/** Reachable node ids, excluding the start id, sorted deterministically. */
	paths: readonly string[];
	/** Hop depth by reachable node id. */
	depths: Readonly<Record<string, number>>;
	/** True when `maxDepth` cut off at least one still-expandable frontier node. */
	truncated: boolean;
}

export type ExplainPathReason =
	| "ok"
	| "no-such-from"
	| "no-such-to"
	| "no-path"
	| "max-depth-exceeded";

export interface ExplainPathOptions {
	/** Maximum hop distance to search. Omit for unbounded. */
	maxDepth?: number;
	/** When `from === to`, search for a non-trivial cycle before returning the trivial step. */
	findCycle?: boolean;
}

export interface CausalStep {
	/** Mount-aware describe node id. */
	id: string;
	/** Operator/verb factory name from describe. */
	factory: string;
	/** Status as of the source snapshot. */
	status: DescribeNode["status"];
	/** Cached value when present; absence still means SENTINEL. */
	value?: unknown;
	/** Hop distance from the `from` node. */
	hop: number;
	/** First dep slot in the next step that points at this step, when the edge is dep-derived. */
	depIndex?: number;
	/** All matching dep slots when the next step depends on this step more than once. */
	depIndices?: readonly number[];
}

export interface CausalChain {
	from: string;
	to: string;
	found: boolean;
	reason: ExplainPathReason;
	steps: readonly CausalStep[];
	text: string;
	toJSON(): {
		from: string;
		to: string;
		found: boolean;
		reason: ExplainPathReason;
		steps: readonly CausalStep[];
	};
}

export interface IslandReport {
	/** Node id from the flattened snapshot. */
	id: string;
	/** Factory/kind for quick triage. */
	factory: string;
}

export interface ValidateNoIslandsResult {
	ok: boolean;
	/** Nodes with zero deps and zero dependents, sorted by id. */
	orphans: readonly IslandReport[];
	summary(): string;
}

interface SnapshotIndex {
	nodes: Map<string, DescribeNode>;
	outgoing: Map<string, Set<string>>;
	incoming: Map<string, Set<string>>;
}

function compareCodeUnit(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function assertMaxDepth(caller: string, maxDepth: number | undefined): void {
	if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 0)) {
		throw new Error(`${caller}: maxDepth must be an integer >= 0`);
	}
}

function addEdge(map: Map<string, Set<string>>, from: string, to: string): void {
	let set = map.get(from);
	if (set === undefined) {
		set = new Set();
		map.set(from, set);
	}
	set.add(to);
}

function flattenSnapshots(snapshot: DescribeSnapshot): DescribeSnapshot[] {
	const out: DescribeSnapshot[] = [];
	const stack = [snapshot];
	while (stack.length > 0) {
		const cur = stack.pop() as DescribeSnapshot;
		out.push(cur);
		if (cur.subgraphs) {
			for (let i = cur.subgraphs.length - 1; i >= 0; i -= 1) stack.push(cur.subgraphs[i]);
		}
	}
	return out;
}

function indexSnapshot(snapshot: DescribeSnapshot): SnapshotIndex {
	const nodes = new Map<string, DescribeNode>();
	const outgoing = new Map<string, Set<string>>();
	const incoming = new Map<string, Set<string>>();
	for (const snap of flattenSnapshots(snapshot)) {
		for (const n of snap.nodes) {
			nodes.set(n.id, n);
			if (!outgoing.has(n.id)) outgoing.set(n.id, new Set());
			if (!incoming.has(n.id)) incoming.set(n.id, new Set());
		}
	}
	for (const n of nodes.values()) {
		for (const dep of n.deps) {
			if (!dep || !nodes.has(dep)) continue;
			addEdge(outgoing, dep, n.id);
			addEdge(incoming, n.id, dep);
		}
	}
	for (const snap of flattenSnapshots(snapshot)) {
		for (const edge of snap.edges) {
			if (!edge.from || !edge.to) continue;
			if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
			addEdge(outgoing, edge.from, edge.to);
			addEdge(incoming, edge.to, edge.from);
		}
	}
	return { nodes, outgoing, incoming };
}

function adjacent(
	idx: SnapshotIndex,
	id: string,
	direction: ReachableDirection,
	both: boolean | undefined,
): Set<string> {
	return both === true
		? new Set([...(idx.incoming.get(id) ?? []), ...(idx.outgoing.get(id) ?? [])])
		: direction === "upstream"
			? (idx.incoming.get(id) ?? new Set<string>())
			: (idx.outgoing.get(id) ?? new Set<string>());
}

/**
 * Return node ids reachable from `from` through describe deps/edges.
 *
 * `upstream` follows dep edges toward causes; `downstream` follows reverse deps toward effects.
 * The helper is intentionally pure over `DescribeSnapshot` (D39/D51): it never reads Nodes.
 *
 * @param snapshot - Describe snapshot to traverse.
 * @param from - Starting node id.
 * @param direction - Direction to follow when `both` is not set.
 * @param options - Optional depth and detail controls.
 * @returns Reachable node ids, or a detailed result when `withDetail` is true.
 * @example
 * ```ts
 * reachable(snapshot, "root", "downstream");
 * ```
 * @category graph
 */
export function reachable(
	snapshot: DescribeSnapshot,
	from: string,
	direction: ReachableDirection,
	options?: ReachableOptions & { withDetail: true },
): ReachableResult;
export function reachable(
	snapshot: DescribeSnapshot,
	from: string,
	direction: ReachableDirection,
	options?: ReachableOptions,
): readonly string[];
/**
 * Traverse reachable nodes in a describe snapshot.
 *
 * @param snapshot - Describe snapshot to traverse.
 * @param from - Starting node id.
 * @param direction - Direction to follow when `both` is not set.
 * @param options - Optional depth and detail controls.
 * @returns Reachable node ids, or a detailed result when `withDetail` is true.
 * @example
 * ```ts
 * reachable(snapshot, "root", "downstream");
 * ```
 * @category graph
 */
export function reachable(
	snapshot: DescribeSnapshot,
	from: string,
	direction: ReachableDirection,
	options: ReachableOptions = {},
): readonly string[] | ReachableResult {
	if (!options.both && direction !== "upstream" && direction !== "downstream") {
		throw new Error(`reachable: direction must be "upstream" or "downstream"`);
	}
	assertMaxDepth("reachable", options.maxDepth);
	const empty: ReachableResult = { paths: [], depths: {}, truncated: false };
	if (from === "") return options.withDetail ? empty : empty.paths;

	const idx = indexSnapshot(snapshot);
	if (!idx.nodes.has(from)) return options.withDetail ? empty : empty.paths;
	if (options.maxDepth === 0) {
		const truncated = adjacent(idx, from, direction, options.both).size > 0;
		return options.withDetail ? { ...empty, truncated } : empty.paths;
	}
	const depths = new Map<string, number>();
	const seen = new Set<string>([from]);
	const queue: Array<{ id: string; depth: number }> = [{ id: from, depth: 0 }];
	let truncated = false;
	for (let head = 0; head < queue.length; head += 1) {
		const cur = queue[head] as { id: string; depth: number };
		const next = adjacent(idx, cur.id, direction, options.both);
		if (options.maxDepth !== undefined && cur.depth >= options.maxDepth) {
			if (next.size > 0) truncated = true;
			continue;
		}
		for (const id of next) {
			if (seen.has(id)) continue;
			seen.add(id);
			const depth = cur.depth + 1;
			depths.set(id, depth);
			queue.push({ id, depth });
		}
	}
	const paths = [...depths.keys()].sort(compareCodeUnit);
	if (!options.withDetail) return paths;
	return {
		paths,
		depths: Object.fromEntries([...depths.entries()].sort(([a], [b]) => compareCodeUnit(a, b))),
		truncated,
	};
}

function depIndices(next: DescribeNode | undefined, prevId: string): readonly number[] | undefined {
	if (next === undefined) return undefined;
	const indices: number[] = [];
	for (let i = 0; i < next.deps.length; i += 1) {
		if (next.deps[i] === prevId) indices.push(i);
	}
	return indices.length > 0 ? indices : undefined;
}

function stepFor(
	node: DescribeNode,
	hop: number,
	edgeToNext?: { next: DescribeNode; prevId: string },
): CausalStep {
	const indices = edgeToNext ? depIndices(edgeToNext.next, edgeToNext.prevId) : undefined;
	const out: CausalStep = {
		id: node.id,
		factory: node.factory,
		status: node.status,
		hop,
	};
	if ("value" in node) out.value = node.value;
	if (indices !== undefined) {
		out.depIndex = indices[0];
		if (indices.length > 1) out.depIndices = indices;
	}
	return out;
}

function makeChain(
	from: string,
	to: string,
	reason: ExplainPathReason,
	steps: readonly CausalStep[],
): CausalChain {
	const found = reason === "ok";
	const text = found
		? steps.map((s) => s.id).join(" -> ")
		: `explainPath: ${reason} from '${from}' to '${to}'`;
	return {
		from,
		to,
		found,
		reason,
		steps,
		text,
		toJSON: () => ({ from, to, found, reason, steps }),
	};
}

function shortestPath(
	idx: SnapshotIndex,
	from: string,
	to: string,
	maxDepth: number | undefined,
): { path: string[]; truncated: boolean } | undefined {
	const pred = new Map<string, string>();
	const seen = new Set<string>([from]);
	const queue: Array<{ id: string; depth: number }> = [{ id: from, depth: 0 }];
	let truncated = false;
	for (let head = 0; head < queue.length; head += 1) {
		const cur = queue[head] as { id: string; depth: number };
		const next = idx.outgoing.get(cur.id) ?? new Set<string>();
		if (maxDepth !== undefined && cur.depth >= maxDepth) {
			if (next.size > 0) truncated = true;
			continue;
		}
		for (const id of next) {
			if (seen.has(id)) continue;
			seen.add(id);
			pred.set(id, cur.id);
			if (id === to) {
				const path = [to];
				let p = to;
				while (p !== from) {
					p = pred.get(p) as string;
					path.push(p);
				}
				path.reverse();
				return { path, truncated };
			}
			queue.push({ id, depth: cur.depth + 1 });
		}
	}
	return truncated ? { path: [], truncated: true } : undefined;
}

function shortestCycle(
	idx: SnapshotIndex,
	from: string,
	maxDepth: number | undefined,
): { path: string[]; truncated: boolean } | undefined {
	const first = idx.outgoing.get(from) ?? new Set<string>();
	if (maxDepth === 0) return first.size > 0 ? { path: [], truncated: true } : undefined;
	const queue: Array<{ id: string; depth: number; path: string[] }> = [];
	const seen = new Set<string>();
	for (const id of first) {
		if (id === from) return { path: [from, from], truncated: false };
		seen.add(id);
		queue.push({ id, depth: 1, path: [from, id] });
	}
	let truncated = false;
	for (let head = 0; head < queue.length; head += 1) {
		const cur = queue[head] as { id: string; depth: number; path: string[] };
		const next = idx.outgoing.get(cur.id) ?? new Set<string>();
		if (maxDepth !== undefined && cur.depth >= maxDepth) {
			if (next.size > 0) truncated = true;
			continue;
		}
		for (const id of next) {
			if (id === from) return { path: [...cur.path, from], truncated: false };
			if (seen.has(id)) continue;
			seen.add(id);
			queue.push({ id, depth: cur.depth + 1, path: [...cur.path, id] });
		}
	}
	return truncated ? { path: [], truncated: true } : undefined;
}

function materializePath(idx: SnapshotIndex, path: readonly string[]): readonly CausalStep[] {
	return path.map((id, i) => {
		const node = idx.nodes.get(id) as DescribeNode;
		const next = path[i + 1] ? idx.nodes.get(path[i + 1]) : undefined;
		return stepFor(node, i, next ? { next, prevId: id } : undefined);
	});
}

/**
 * Explain the shortest describe-edge path from `from` to `to`.
 *
 * This is the rich companion to `Graph.describe({ explain })`: it reports found/no-path
 * status and per-hop metadata, but remains a pure helper over the snapshot.
 * @param snapshot - snapshot value used by the helper.
 * @param from - from value used by the helper.
 * @param to - to value used by the helper.
 * @param options - Options that configure the helper.
 * @returns A `CausalChain` value.
 * @category graph
 * @example
 * ```ts
 * import { explainPath } from "@graphrefly/ts/graph";
 * ```
 */
export function explainPath(
	snapshot: DescribeSnapshot,
	from: string,
	to: string,
	options: ExplainPathOptions = {},
): CausalChain {
	assertMaxDepth("explainPath", options.maxDepth);
	const idx = indexSnapshot(snapshot);
	if (!idx.nodes.has(from)) return makeChain(from, to, "no-such-from", []);
	if (!idx.nodes.has(to)) return makeChain(from, to, "no-such-to", []);
	if (options.maxDepth === 0 && from !== to) return makeChain(from, to, "no-path", []);

	if (from === to && options.findCycle !== true) {
		return makeChain(from, to, "ok", [stepFor(idx.nodes.get(from) as DescribeNode, 0)]);
	}
	if (from === to && options.findCycle === true) {
		const cycle = shortestCycle(idx, from, options.maxDepth);
		if (cycle !== undefined && cycle.path.length > 0) {
			return makeChain(from, to, "ok", materializePath(idx, cycle.path));
		}
		if (cycle?.truncated) return makeChain(from, to, "max-depth-exceeded", []);
		return makeChain(from, to, "ok", [stepFor(idx.nodes.get(from) as DescribeNode, 0)]);
	}
	const found = shortestPath(idx, from, to, options.maxDepth);
	if (found !== undefined && found.path.length > 0) {
		return makeChain(from, to, "ok", materializePath(idx, found.path));
	}
	return makeChain(from, to, found?.truncated ? "max-depth-exceeded" : "no-path", []);
}

/** Detect nodes with zero deps and zero dependents in a describe snapshot.
 * @param snapshot - snapshot value used by the helper.
 * @returns Validation diagnostics or the validated projection.
 * @category graph
 * @example
 * ```ts
 * import { validateNoIslands } from "@graphrefly/ts/graph";
 * ```
 */
export function validateNoIslands(snapshot: DescribeSnapshot): ValidateNoIslandsResult {
	const idx = indexSnapshot(snapshot);
	const orphans: IslandReport[] = [];
	for (const node of idx.nodes.values()) {
		const hasDeps = node.deps.length > 0 || (idx.incoming.get(node.id)?.size ?? 0) > 0;
		const hasDependents = (idx.outgoing.get(node.id)?.size ?? 0) > 0;
		if (!hasDeps && !hasDependents && !node.id.startsWith("__internal__/")) {
			orphans.push({ id: node.id, factory: node.factory });
		}
	}
	orphans.sort((a, b) => compareCodeUnit(a.id, b.id));
	return {
		ok: orphans.length === 0,
		orphans,
		summary(): string {
			if (orphans.length === 0) return "validateNoIslands: ok (no islands)";
			const head = orphans
				.slice(0, 3)
				.map((o) => `${o.id} (${o.factory})`)
				.join(", ");
			return `validateNoIslands: ${orphans.length} island node(s) - ${head}${orphans.length > 3 ? ", ..." : ""}`;
		},
	};
}
