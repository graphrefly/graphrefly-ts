import type { Actor } from "../core/actor.js";
import { isBatching } from "../core/batch.js";
import { GuardDenied } from "../core/guard.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	type Messages,
	RESOLVED,
	TEARDOWN,
} from "../core/messages.js";
import { type DescribeNodeOutput, describeNode } from "../core/meta.js";
import {
	type Node,
	NodeImpl,
	type NodeInspectorHookEvent,
	type NodeSink,
	type NodeTransportOptions,
} from "../core/node.js";
import { state as stateNode } from "../core/sugar.js";

/** The separator used for qualified paths in {@link Graph.resolve} et al. */
const PATH_SEP = "::";

/**
 * Reserved segment for meta companion paths: `nodeName::__meta__::metaKey` (GRAPHREFLY-SPEC §3.6).
 * Forbidden as a local node or mount name.
 */
export const GRAPH_META_SEGMENT = "__meta__";

/** Options for {@link Graph} (reserved for future hooks). */
export type GraphOptions = Record<string, unknown>;

/** Filter for {@link Graph.describe} — object-style partial match or predicate. */
export type DescribeFilter =
	| Partial<Pick<DescribeNodeOutput, "type" | "status">>
	| {
			type?: DescribeNodeOutput["type"];
			status?: DescribeNodeOutput["status"];
			/** Keep nodes whose `deps` includes this qualified path. */
			depsIncludes?: string;
			/** Snake-case alias for `depsIncludes` (Python parity). */
			deps_includes?: string;
			/** Keep nodes whose `meta` contains this key. */
			metaHas?: string;
			/** Snake-case alias for `metaHas` (Python parity). */
			meta_has?: string;
	  }
	| ((node: DescribeNodeOutput) => boolean)
	| ((nodePath: string, node: DescribeNodeOutput) => boolean);

/** Options for {@link Graph.signal} and {@link Graph.set} (actor context, internal lifecycle). */
export type GraphActorOptions = {
	actor?: Actor;
	/**
	 * When `true`, skips node guards (graph lifecycle TEARDOWN, unmount teardown, etc.).
	 */
	internal?: boolean;
};

/** JSON snapshot from {@link Graph.describe} (GRAPHREFLY-SPEC §3.6, Appendix B). */
export type GraphDescribeOutput = {
	name: string;
	nodes: Record<string, DescribeNodeOutput>;
	edges: ReadonlyArray<{ from: string; to: string }>;
	subgraphs: string[];
};

/**
 * Persisted graph snapshot: {@link GraphDescribeOutput} plus optional format version
 * ({@link Graph.snapshot}, {@link Graph.restore}, {@link Graph.fromSnapshot}, {@link Graph.toJSON},
 * {@link Graph.toJSONString} — §3.8).
 */
export type GraphPersistSnapshot = GraphDescribeOutput & {
	version?: number;
};

/** Snapshot format version (§3.8). */
const SNAPSHOT_VERSION = 1;

/**
 * Validate the snapshot envelope: version, required keys, types. Aligned with
 * Python `_parse_snapshot_envelope`. Throws on invalid data.
 */
function parseSnapshotEnvelope(data: GraphPersistSnapshot): void {
	if (data.version !== SNAPSHOT_VERSION) {
		throw new Error(
			`unsupported snapshot version ${String(data.version)} (expected ${SNAPSHOT_VERSION})`,
		);
	}
	for (const key of ["name", "nodes", "edges", "subgraphs"] as const) {
		if (!(key in data)) {
			throw new Error(`snapshot missing required key "${key}"`);
		}
	}
	if (typeof data.name !== "string") {
		throw new TypeError(`snapshot 'name' must be a string`);
	}
	if (typeof data.nodes !== "object" || data.nodes === null || Array.isArray(data.nodes)) {
		throw new TypeError(`snapshot 'nodes' must be an object`);
	}
	if (!Array.isArray(data.edges)) {
		throw new TypeError(`snapshot 'edges' must be an array`);
	}
	if (!Array.isArray(data.subgraphs)) {
		throw new TypeError(`snapshot 'subgraphs' must be an array`);
	}
}

/** Recursively sort object keys for deterministic JSON (git-diffable). */
function sortJsonValue(value: unknown): unknown {
	if (value === null || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(sortJsonValue);
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const out: Record<string, unknown> = {};
	for (const k of keys) {
		out[k] = sortJsonValue(obj[k]);
	}
	return out;
}

function stableJsonStringify(value: unknown): string {
	return `${JSON.stringify(sortJsonValue(value))}\n`;
}

/** {@link Graph.observe} on a single node or meta path — sink receives plain message batches. */
export type GraphObserveOne = {
	subscribe(sink: NodeSink): () => void;
};

/**
 * {@link Graph.observe} on the whole graph — sink receives each batch with the qualified source path.
 * Subscription order follows `localeCompare` on paths (mounts-first walk, then sorted locals/meta).
 */
export type GraphObserveAll = {
	subscribe(sink: (nodePath: string, messages: Messages) => void): () => void;
};

/** Options for structured observation modes on {@link Graph.observe}. */
export type ObserveOptions = {
	actor?: Actor;
	/** Return an {@link ObserveResult} accumulator instead of a raw stream. */
	structured?: boolean;
	/** Include causal trace info (which dep triggered each recomputation). */
	causal?: boolean;
	/** Include timestamps and batch context on each event. */
	timeline?: boolean;
	/** Include per-evaluation dep snapshots for compute/derived nodes. */
	derived?: boolean;
};

/** Accumulated observation result (structured mode). */
export type ObserveResult<T = unknown> = {
	/** Latest DATA value by observed path. */
	readonly values: Record<string, T>;
	/** Number of DIRTY messages received. */
	readonly dirtyCount: number;
	/** Number of RESOLVED messages received. */
	readonly resolvedCount: number;
	/** All events in order. */
	readonly events: ObserveEvent[];
	/** True if COMPLETE received without prior ERROR. */
	readonly completedCleanly: boolean;
	/** True if ERROR received. */
	readonly errored: boolean;
	/** Stop observing. */
	dispose(): void;
};

/** A single event in the structured observation log. */
export type ObserveEvent = {
	type: "data" | "dirty" | "resolved" | "complete" | "error" | "derived";
	path?: string;
	data?: unknown;
	timestamp_ns?: number;
	in_batch?: boolean;
	trigger_dep_index?: number;
	trigger_dep_name?: string;
	dep_values?: unknown[];
};

function assertLocalName(name: string, graphName: string, label: string): void {
	if (name === "") {
		throw new Error(`Graph "${graphName}": ${label} name must be non-empty`);
	}
}

function assertNoPathSep(name: string, graphName: string, label: string): void {
	if (name.includes(PATH_SEP)) {
		throw new Error(
			`Graph "${graphName}": ${label} "${name}" must not contain '${PATH_SEP}' (path separator)`,
		);
	}
}

function assertNotReservedMetaSegment(name: string, graphName: string, label: string): void {
	if (name === GRAPH_META_SEGMENT) {
		throw new Error(
			`Graph "${graphName}": ${label} name "${GRAPH_META_SEGMENT}" is reserved for meta companion paths`,
		);
	}
}

/** `connect` / `disconnect` endpoints must be registered graph nodes, not meta paths (graphrefly-py parity). */
function assertConnectPathNotMeta(path: string, graphName: string): void {
	if (path.split(PATH_SEP).includes(GRAPH_META_SEGMENT)) {
		throw new Error(
			`Graph "${graphName}": connect/disconnect endpoints must be registered graph nodes, not meta paths (got "${path}")`,
		);
	}
}

function splitPath(path: string, graphName: string): string[] {
	if (path === "") {
		throw new Error(`Graph "${graphName}": resolve path must be non-empty`);
	}
	const segments = path.split(PATH_SEP);
	for (const s of segments) {
		if (s === "") {
			throw new Error(`Graph "${graphName}": resolve path has empty segment`);
		}
	}
	return segments;
}

/** Canonical string key for an edge pair (deterministic, splittable). */
function edgeKey(from: string, to: string): string {
	return `${from}\t${to}`;
}

function parseEdgeKey(key: string): [string, string] {
	const i = key.indexOf("\t");
	return [key.slice(0, i), key.slice(i + 1)];
}

/**
 * Lifecycle-destructive message types that meta companion nodes ignore
 * during graph-wide signal propagation (spec §2.3 Companion lifecycle).
 * TEARDOWN: parent already cascades explicitly.
 * INVALIDATE/COMPLETE/ERROR: meta stores outlive these lifecycle events.
 * To target a meta node directly, call `meta.down(...)` on it.
 */
const META_FILTERED_TYPES = new Set([TEARDOWN, INVALIDATE, COMPLETE, ERROR]);

/** Strip lifecycle-destructive messages; returns empty array when nothing remains. */
function filterMetaMessages(messages: Messages): Messages {
	const kept = messages.filter((m) => !META_FILTERED_TYPES.has(m[0]));
	return kept as unknown as Messages;
}

/** TEARDOWN every node in a mounted graph tree (depth-first into mounts). */
function teardownMountedGraph(root: Graph): void {
	for (const child of root._mounts.values()) {
		teardownMountedGraph(child);
	}
	for (const n of root._nodes.values()) {
		n.down([[TEARDOWN]] satisfies Messages, { internal: true });
	}
}

/**
 * Named container for nodes and explicit edges (GRAPHREFLY-SPEC §3.1–§3.7).
 *
 * Qualified paths use `::` as the segment separator (for example `parent::child::node`).
 *
 * Edges are pure wires: `connect` only validates wiring — the target must already list the source in
 * its dependency array; no transforms run on the edge.
 *
 * @example
 * ```ts
 * import { Graph, state } from "@graphrefly/graphrefly-ts";
 *
 * const g = new Graph("app");
 * g.add("counter", state(0));
 * ```
 *
 * @category graph
 */
export class Graph {
	readonly name: string;
	readonly opts: Readonly<GraphOptions>;
	/** @internal — exposed for {@link teardownMountedGraph} and cross-graph helpers. */
	readonly _nodes = new Map<string, Node>();
	private readonly _edges = new Set<string>();
	/** @internal — exposed for {@link teardownMountedGraph}. */
	readonly _mounts = new Map<string, Graph>();

	/**
	 * @param name - Non-empty graph id (must not contain `::`).
	 * @param opts - Reserved for future hooks; currently unused.
	 */
	constructor(name: string, opts?: GraphOptions) {
		if (name === "") {
			throw new Error("Graph name must be non-empty");
		}
		if (name.includes(PATH_SEP)) {
			throw new Error(`Graph name must not contain '${PATH_SEP}' (got "${name}")`);
		}
		this.name = name;
		this.opts = opts ?? {};
	}

	/**
	 * Graphs reachable from this instance via nested {@link Graph.mount} (includes `this`).
	 */
	private _graphsReachableViaMounts(seen = new Set<Graph>()): Set<Graph> {
		if (seen.has(this)) return seen;
		seen.add(this);
		for (const child of this._mounts.values()) {
			child._graphsReachableViaMounts(seen);
		}
		return seen;
	}

	/**
	 * Resolve an endpoint: returns `[owningGraph, localName, node]`.
	 * Accepts both local names and `::` qualified paths.
	 */
	private _resolveEndpoint(path: string): [Graph, string, Node] {
		if (!path.includes(PATH_SEP)) {
			const n = this._nodes.get(path);
			if (!n) {
				throw new Error(`Graph "${this.name}": unknown node "${path}"`);
			}
			return [this, path, n];
		}
		const segments = splitPath(path, this.name);
		return this._resolveEndpointFromSegments(segments, path);
	}

	private _resolveEndpointFromSegments(
		segments: readonly string[],
		fullPath: string,
	): [Graph, string, Node] {
		const head = segments[0] as string;
		const rest = segments.slice(1);

		if (rest.length === 0) {
			const n = this._nodes.get(head);
			if (n) return [this, head, n];
			throw new Error(`Graph "${this.name}": unknown node "${head}" (from path "${fullPath}")`);
		}

		const localN = this._nodes.get(head);
		if (localN && rest.length > 0 && rest[0] === GRAPH_META_SEGMENT) {
			return this._resolveMetaEndpointKeys(localN, head, rest, fullPath);
		}

		const child = this._mounts.get(head);
		if (!child) {
			if (this._nodes.has(head)) {
				throw new Error(
					`Graph "${this.name}": "${head}" is a node; trailing path "${rest.join(PATH_SEP)}" is invalid`,
				);
			}
			throw new Error(`Graph "${this.name}": unknown mount or node "${head}"`);
		}
		return child._resolveEndpointFromSegments(rest, fullPath);
	}

	// ——————————————————————————————————————————————————————————————
	//  Node registry
	// ——————————————————————————————————————————————————————————————

	/**
	 * Registers a node under a local name. Fails if the name is already used,
	 * reserved by a mount, or the same node instance is already registered.
	 *
	 * @param name - Local key (no `::`).
	 * @param node - Node instance to own.
	 */
	add(name: string, node: Node): void {
		assertLocalName(name, this.name, "add");
		assertNoPathSep(name, this.name, "add");
		assertNotReservedMetaSegment(name, this.name, "node");
		if (this._mounts.has(name)) {
			throw new Error(`Graph "${this.name}": name "${name}" is already a mount point`);
		}
		if (this._nodes.has(name)) {
			throw new Error(`Graph "${this.name}": node "${name}" already exists`);
		}
		for (const [existingName, existing] of this._nodes) {
			if (existing === node) {
				throw new Error(
					`Graph "${this.name}": node instance already registered as "${existingName}"`,
				);
			}
		}
		this._nodes.set(name, node);
		if (node instanceof NodeImpl) {
			node._assignRegistryName(name);
		}
	}

	/**
	 * Unregisters a node or unmounts a subgraph, drops incident edges, and sends
	 * `[[TEARDOWN]]` to the removed node or recursively through the mounted subtree (§3.2).
	 *
	 * @param name - Local mount or node name.
	 */
	remove(name: string): void {
		assertLocalName(name, this.name, "remove");
		assertNoPathSep(name, this.name, "remove");

		// Case 1: unmount a subgraph
		const child = this._mounts.get(name);
		if (child) {
			this._mounts.delete(name);
			// Drop edges touching this mount name or qualified paths under it.
			const prefix = `${name}${PATH_SEP}`;
			for (const key of [...this._edges]) {
				const [from, to] = parseEdgeKey(key);
				if (from === name || to === name || from.startsWith(prefix) || to.startsWith(prefix)) {
					this._edges.delete(key);
				}
			}
			teardownMountedGraph(child);
			return;
		}

		// Case 2: remove a local node
		const node = this._nodes.get(name);
		if (!node) {
			throw new Error(`Graph "${this.name}": unknown node or mount "${name}"`);
		}
		this._nodes.delete(name);
		for (const key of [...this._edges]) {
			const [from, to] = parseEdgeKey(key);
			if (from === name || to === name) this._edges.delete(key);
		}
		node.down([[TEARDOWN]] satisfies Messages, { internal: true });
	}

	/**
	 * Returns a node by local name or `::` qualified path.
	 * Local names are looked up directly; paths with `::` delegate to {@link resolve}.
	 *
	 * @param name - Local name or qualified path.
	 */
	node(name: string): Node {
		if (name === "") {
			throw new Error(`Graph "${this.name}": node name must be non-empty`);
		}
		if (name.includes(PATH_SEP)) {
			return this.resolve(name);
		}
		const n = this._nodes.get(name);
		if (!n) {
			throw new Error(`Graph "${this.name}": unknown node "${name}"`);
		}
		return n;
	}

	/**
	 * Reads `graph.node(name).get()` — accepts `::` qualified paths (§3.2).
	 *
	 * @param name - Local name or qualified path.
	 * @returns Cached value or `undefined`.
	 */
	get(name: string): unknown {
		return this.node(name).get();
	}

	/**
	 * Shorthand for `graph.node(name).down([[DATA, value]], { actor })` — accepts `::` qualified paths (§3.2).
	 *
	 * @param name - Local name or qualified path.
	 * @param value - Next `DATA` payload.
	 * @param options - Optional `actor` and `internal` guard bypass.
	 */
	set(name: string, value: unknown, options?: GraphActorOptions): void {
		const internal = options?.internal === true;
		this.node(name).down([[DATA, value]] satisfies Messages, {
			actor: options?.actor,
			internal,
			delivery: "write",
		});
	}

	// ——————————————————————————————————————————————————————————————
	//  Edges
	// ——————————————————————————————————————————————————————————————

	/**
	 * Record a wire from `fromPath` → `toPath` (§3.3). Accepts local names or
	 * `::` qualified paths. The target must be a {@link NodeImpl} whose `_deps`
	 * includes the source node (same reference). Idempotent.
	 *
	 * Same-owner edges are stored on the owning child graph; cross-subgraph edges
	 * are stored on this (parent) graph's registry.
	 *
	 * @param fromPath - Source endpoint (local or qualified).
	 * @param toPath - Target endpoint whose deps already include the source node.
	 */
	connect(fromPath: string, toPath: string): void {
		if (!fromPath || !toPath) {
			throw new Error(`Graph "${this.name}": connect paths must be non-empty`);
		}
		assertConnectPathNotMeta(fromPath, this.name);
		assertConnectPathNotMeta(toPath, this.name);

		const [fromGraph, fromLocal, fromNode] = this._resolveEndpoint(fromPath);
		const [toGraph, toLocal, toNode] = this._resolveEndpoint(toPath);

		if (fromNode === toNode) {
			throw new Error(`Graph "${this.name}": cannot connect a node to itself`);
		}

		if (!(toNode instanceof NodeImpl)) {
			throw new Error(
				`Graph "${this.name}": connect(${fromPath}, ${toPath}) requires the target to be a graphrefly NodeImpl so deps can be validated`,
			);
		}
		if (!toNode._deps.includes(fromNode)) {
			throw new Error(
				`Graph "${this.name}": connect(${fromPath}, ${toPath}) — target must include source in its constructor deps (same node reference)`,
			);
		}

		if (fromGraph === toGraph) {
			// Same-owner: store on the child graph
			const key = edgeKey(fromLocal, toLocal);
			fromGraph._edges.add(key);
		} else {
			// Cross-subgraph: store on this (parent) graph
			const key = edgeKey(fromPath, toPath);
			this._edges.add(key);
		}
	}

	/**
	 * Remove a registered edge (§3.3). Accepts local names or `::` qualified paths.
	 * Does **not** change constructor-time deps; drops the registry record only.
	 *
	 * @param fromPath - Registered edge tail.
	 * @param toPath - Registered edge head.
	 */
	disconnect(fromPath: string, toPath: string): void {
		if (!fromPath || !toPath) {
			throw new Error(`Graph "${this.name}": disconnect paths must be non-empty`);
		}
		assertConnectPathNotMeta(fromPath, this.name);
		assertConnectPathNotMeta(toPath, this.name);

		const [fromGraph, fromLocal] = this._resolveEndpoint(fromPath);
		const [toGraph, toLocal] = this._resolveEndpoint(toPath);

		if (fromGraph === toGraph) {
			const key = edgeKey(fromLocal, toLocal);
			if (!fromGraph._edges.delete(key)) {
				throw new Error(`Graph "${this.name}": no registered edge ${fromPath} → ${toPath}`);
			}
		} else {
			const key = edgeKey(fromPath, toPath);
			if (!this._edges.delete(key)) {
				throw new Error(`Graph "${this.name}": no registered edge ${fromPath} → ${toPath}`);
			}
		}
	}

	/**
	 * Returns registered `[from, to]` edge pairs (read-only snapshot).
	 *
	 * @returns Edge pairs recorded on this graph instance’s local `_edges` set.
	 */
	edges(): ReadonlyArray<[string, string]> {
		const result: [string, string][] = [];
		for (const key of this._edges) {
			result.push(parseEdgeKey(key));
		}
		return result;
	}

	// ——————————————————————————————————————————————————————————————
	//  Composition
	// ——————————————————————————————————————————————————————————————

	/**
	 * Embed a child graph at a local mount name (§3.4). Child nodes are reachable via
	 * {@link Graph.resolve} using `::` delimited paths (§3.5). Lifecycle
	 * {@link Graph.signal} visits mounted subgraphs recursively.
	 *
	 * Rejects: same name as existing node or mount, self-mount, mount cycles,
	 * and the same child graph instance mounted twice on one parent.
	 *
	 * @param name - Local mount point.
	 * @param child - Nested `Graph` instance.
	 */
	mount(name: string, child: Graph): void {
		assertLocalName(name, this.name, "mount");
		assertNoPathSep(name, this.name, "mount");
		assertNotReservedMetaSegment(name, this.name, "mount");
		if (this._nodes.has(name)) {
			throw new Error(
				`Graph "${this.name}": cannot mount at "${name}" — node with that name exists`,
			);
		}
		if (this._mounts.has(name)) {
			throw new Error(`Graph "${this.name}": mount "${name}" already exists`);
		}
		if (child === this) {
			throw new Error(`Graph "${this.name}": cannot mount a graph into itself`);
		}
		// Reject same child instance mounted twice on this parent.
		for (const existing of this._mounts.values()) {
			if (existing === child) {
				throw new Error(`Graph "${this.name}": this child graph is already mounted on this graph`);
			}
		}
		if (child._graphsReachableViaMounts().has(this)) {
			throw new Error(`Graph "${this.name}": mount("${name}", …) would create a mount cycle`);
		}
		this._mounts.set(name, child);
	}

	/**
	 * Look up a node by qualified path (§3.5). Segments are separated by `::`.
	 *
	 * If the first segment equals this graph's {@link Graph.name}, it is stripped
	 * (so `root.resolve("app::a")` works when `root.name === "app"`).
	 *
	 * @param path - Qualified `::` path or local name.
	 * @returns The resolved `Node`.
	 */
	resolve(path: string): Node {
		let segments = splitPath(path, this.name);
		if (segments[0] === this.name) {
			segments = segments.slice(1);
			if (segments.length === 0) {
				throw new Error(`Graph "${this.name}": resolve path ends at graph name only`);
			}
		}
		return this._resolveFromSegments(segments);
	}

	private _resolveFromSegments(segments: readonly string[]): Node {
		const head = segments[0] as string;
		const rest = segments.slice(1);

		if (rest.length === 0) {
			const n = this._nodes.get(head);
			if (n) return n;
			if (this._mounts.has(head)) {
				throw new Error(
					`Graph "${this.name}": path ends at subgraph "${head}" — not a node (GRAPHREFLY-SPEC §3.5)`,
				);
			}
			throw new Error(`Graph "${this.name}": unknown name "${head}"`);
		}

		const localN = this._nodes.get(head);
		if (localN && rest.length > 0 && rest[0] === GRAPH_META_SEGMENT) {
			return this._resolveMetaChainFromNode(localN, rest, segments.join(PATH_SEP));
		}

		const child = this._mounts.get(head);
		if (!child) {
			if (this._nodes.has(head)) {
				throw new Error(
					`Graph "${this.name}": "${head}" is a node; trailing path "${rest.join(PATH_SEP)}" is invalid`,
				);
			}
			throw new Error(`Graph "${this.name}": unknown mount or node "${head}"`);
		}

		return child.resolve(rest.join(PATH_SEP));
	}

	/**
	 * Resolve `::__meta__::key` segments from a registered primary node (possibly chained).
	 */
	private _resolveMetaChainFromNode(n: Node, parts: readonly string[], fullPath: string): Node {
		let current = n;
		let i = 0;
		const p = [...parts];
		while (i < p.length) {
			if (p[i] !== GRAPH_META_SEGMENT) {
				throw new Error(
					`Graph "${this.name}": expected ${GRAPH_META_SEGMENT} segment in meta path "${fullPath}"`,
				);
			}
			if (i + 1 >= p.length) {
				throw new Error(
					`Graph "${this.name}": meta path requires a key after ${GRAPH_META_SEGMENT} in "${fullPath}"`,
				);
			}
			const key = p[i + 1] as string;
			const next = current.meta[key];
			if (!next) {
				throw new Error(`Graph "${this.name}": unknown meta "${key}" in path "${fullPath}"`);
			}
			current = next;
			i += 2;
		}
		return current;
	}

	private _resolveMetaEndpointKeys(
		baseNode: Node,
		baseLocalKey: string,
		parts: readonly string[],
		fullPath: string,
	): [Graph, string, Node] {
		let current = baseNode;
		let localKey = baseLocalKey;
		let i = 0;
		const p = [...parts];
		while (i < p.length) {
			if (p[i] !== GRAPH_META_SEGMENT) {
				throw new Error(
					`Graph "${this.name}": expected ${GRAPH_META_SEGMENT} segment in meta path "${fullPath}"`,
				);
			}
			if (i + 1 >= p.length) {
				throw new Error(
					`Graph "${this.name}": meta path requires a key after ${GRAPH_META_SEGMENT} in "${fullPath}"`,
				);
			}
			const metaKey = p[i + 1] as string;
			const next = current.meta[metaKey];
			if (!next) {
				throw new Error(
					`Graph "${this.name}": unknown meta "${metaKey}" on node (in "${fullPath}")`,
				);
			}
			localKey = `${localKey}${PATH_SEP}${GRAPH_META_SEGMENT}${PATH_SEP}${metaKey}`;
			current = next;
			i += 2;
		}
		return [this, localKey, current];
	}

	/**
	 * Deliver a message batch to every registered node in this graph and, recursively,
	 * in mounted child graphs (§3.7). Recurses into mounts first, then delivers to
	 * local nodes (sorted by name). Each {@link Node} receives at most one delivery
	 * per call (deduped by reference).
	 *
	 * Companion `meta` nodes receive the same batch for control-plane types (e.g.
	 * PAUSE) that the primary does not forward. **TEARDOWN-only** batches skip the
	 * extra meta pass — the primary’s `down()` already cascades TEARDOWN to meta.
	 *
	 * @param messages - Batch to deliver to every registered node (and mounts, recursively).
	 * @param options - Optional `actor` / `internal` for transport.
	 */
	signal(messages: Messages, options?: GraphActorOptions): void {
		this._signalDeliver(messages, options ?? {}, new Set());
	}

	private _signalDeliver(messages: Messages, opts: GraphActorOptions, vis: Set<Node>): void {
		for (const sub of this._mounts.values()) {
			sub._signalDeliver(messages, opts, vis);
		}
		const internal = opts.internal === true;
		const downOpts: NodeTransportOptions = internal
			? { internal: true }
			: { actor: opts.actor, delivery: "signal" };
		const metaMessages = filterMetaMessages(messages);
		for (const localName of [...this._nodes.keys()].sort()) {
			const n = this._nodes.get(localName)!;
			if (vis.has(n)) continue;
			vis.add(n);
			n.down(messages, downOpts);
			if (metaMessages.length === 0) continue;
			this._signalMetaSubtree(n, metaMessages, vis, downOpts);
		}
	}

	private _signalMetaSubtree(
		root: Node,
		messages: Messages,
		vis: Set<Node>,
		downOpts: NodeTransportOptions,
	): void {
		for (const mk of Object.keys(root.meta).sort()) {
			const mnode = root.meta[mk];
			if (vis.has(mnode)) continue;
			vis.add(mnode);
			mnode.down(messages, downOpts);
			this._signalMetaSubtree(mnode, messages, vis, downOpts);
		}
	}

	/**
	 * Static structure snapshot: qualified node keys, edges, mount names (GRAPHREFLY-SPEC §3.6, Appendix B).
	 *
	 * @param options - Optional `actor` for guard-scoped visibility and/or `filter` for selective output.
	 * @returns JSON-shaped describe payload for this graph tree.
	 *
	 * @example
	 * ```ts
	 * graph.describe()                                         // full snapshot
	 * graph.describe({ actor: llm })                           // guard-scoped
	 * graph.describe({ filter: { status: "errored" } })        // only errored nodes
	 * graph.describe({ filter: (n) => n.type === "state" })    // predicate filter
	 * ```
	 */
	describe(options?: { actor?: Actor; filter?: DescribeFilter }): GraphDescribeOutput {
		const actor = options?.actor;
		const filter = options?.filter;
		const targets: [string, Node][] = [];
		this._collectObserveTargets("", targets);
		const nodeToPath = new Map<Node, string>();
		for (const [p, n] of targets) {
			nodeToPath.set(n, p);
		}
		const nodes: Record<string, DescribeNodeOutput> = {};
		for (const [p, n] of targets) {
			if (actor != null && !n.allowsObserve(actor)) continue;
			const raw = describeNode(n);
			const deps =
				n instanceof NodeImpl ? n._deps.map((d) => nodeToPath.get(d) ?? d.name ?? "") : [];
			const { name: _name, ...rest } = raw;
			const entry: DescribeNodeOutput = { ...rest, deps };
			if (filter != null) {
				if (typeof filter === "function") {
					const fn = filter as
						| ((nodePath: string, node: DescribeNodeOutput) => boolean)
						| ((node: DescribeNodeOutput) => boolean);
					const pass =
						fn.length >= 2
							? (fn as (nodePath: string, node: DescribeNodeOutput) => boolean)(p, entry)
							: (fn as (node: DescribeNodeOutput) => boolean)(entry);
					if (!pass) continue;
				} else {
					let match = true;
					for (const [fk, fv] of Object.entries(filter)) {
						const normalizedKey =
							fk === "deps_includes" ? "depsIncludes" : fk === "meta_has" ? "metaHas" : fk;
						if (normalizedKey === "depsIncludes") {
							if (!entry.deps.includes(String(fv))) {
								match = false;
								break;
							}
							continue;
						}
						if (normalizedKey === "metaHas") {
							if (!Object.hasOwn(entry.meta, String(fv))) {
								match = false;
								break;
							}
							continue;
						}
						if ((entry as Record<string, unknown>)[normalizedKey] !== fv) {
							match = false;
							break;
						}
					}
					if (!match) continue;
				}
			}
			nodes[p] = entry;
		}
		const nodeKeys = new Set(Object.keys(nodes));
		let edges = this._collectAllEdges("");
		if (actor != null || filter != null) {
			edges = edges.filter((e) => nodeKeys.has(e.from) && nodeKeys.has(e.to));
		}
		edges.sort((a, b) => {
			const c = a.from.localeCompare(b.from);
			return c !== 0 ? c : a.to.localeCompare(b.to);
		});
		const allSubgraphs = this._collectSubgraphs("");
		const subgraphs =
			actor != null || filter != null
				? allSubgraphs.filter((sg) => {
						const prefix = `${sg}${PATH_SEP}`;
						return [...nodeKeys].some((k) => k === sg || k.startsWith(prefix));
					})
				: allSubgraphs;
		return {
			name: this.name,
			nodes,
			edges,
			subgraphs,
		};
	}

	private _collectSubgraphs(prefix: string): string[] {
		const out: string[] = [];
		for (const m of [...this._mounts.keys()].sort()) {
			const q = prefix === "" ? m : `${prefix}${m}`;
			out.push(q);
			out.push(...this._mounts.get(m)!._collectSubgraphs(`${q}${PATH_SEP}`));
		}
		return out;
	}

	private _collectAllEdges(prefix: string): { from: string; to: string }[] {
		const out: { from: string; to: string }[] = [];
		for (const m of [...this._mounts.keys()].sort()) {
			const p2 = prefix === "" ? m : `${prefix}${PATH_SEP}${m}`;
			out.push(...this._mounts.get(m)!._collectAllEdges(p2));
		}
		for (const [f, t] of this.edges()) {
			out.push({
				from: this._qualifyEdgeEndpoint(f, prefix),
				to: this._qualifyEdgeEndpoint(t, prefix),
			});
		}
		return out;
	}

	private _qualifyEdgeEndpoint(part: string, prefix: string): string {
		if (part.includes(PATH_SEP)) return part;
		return prefix === "" ? part : `${prefix}${PATH_SEP}${part}`;
	}

	private _collectObserveTargets(prefix: string, out: [string, Node][]): void {
		for (const m of [...this._mounts.keys()].sort()) {
			const p2 = prefix === "" ? m : `${prefix}${PATH_SEP}${m}`;
			this._mounts.get(m)!._collectObserveTargets(p2, out);
		}
		for (const loc of [...this._nodes.keys()].sort()) {
			const n = this._nodes.get(loc)!;
			const p = prefix === "" ? loc : `${prefix}${PATH_SEP}${loc}`;
			out.push([p, n]);
			this._appendMetaObserveTargets(p, n, out);
		}
	}

	private _appendMetaObserveTargets(basePath: string, n: Node, out: [string, Node][]): void {
		for (const mk of Object.keys(n.meta).sort()) {
			const m = n.meta[mk];
			const mp = `${basePath}${PATH_SEP}${GRAPH_META_SEGMENT}${PATH_SEP}${mk}`;
			out.push([mp, m]);
			this._appendMetaObserveTargets(mp, m, out);
		}
	}

	/**
	 * Live message stream from one node (or meta path), or from the whole graph (§3.6).
	 *
	 * Overloads: `(path, options?)` for one node; `(options?)` for all nodes. Whole-graph mode
	 * subscribes in **sorted path order** (`localeCompare`). With structured options
	 * (`structured`, `timeline`, `causal`, `derived`), returns an {@link ObserveResult}.
	 * Inspector-gated extras (`causal` / `derived`) require {@link Graph.inspectorEnabled}.
	 *
	 * @param pathOrOpts - Qualified `path` string, or omit and pass only `options` for graph-wide observation.
	 * @param options - Optional `actor`, `structured`, `causal`, `timeline` (inspector-gated).
	 * @returns `GraphObserveOne`, `GraphObserveAll`, or `ObserveResult` depending on overload/options.
	 */
	observe(
		path: string,
		options?: ObserveOptions & {
			structured?: true;
			timeline?: true;
			causal?: true;
			derived?: true;
		},
	): ObserveResult;
	observe(path: string, options?: ObserveOptions): GraphObserveOne;
	observe(
		options: ObserveOptions & { structured?: true; timeline?: true; causal?: true; derived?: true },
	): ObserveResult;
	observe(options?: ObserveOptions): GraphObserveAll;
	observe(
		pathOrOpts?: string | ObserveOptions,
		options?: ObserveOptions,
	): GraphObserveOne | GraphObserveAll | ObserveResult {
		if (typeof pathOrOpts === "string") {
			const path = pathOrOpts;
			const actor = options?.actor;
			const target = this.resolve(path);
			if (actor != null && !target.allowsObserve(actor)) {
				throw new GuardDenied({ actor, action: "observe", nodeName: path });
			}
			const wantsStructured =
				options?.structured === true ||
				options?.timeline === true ||
				options?.causal === true ||
				options?.derived === true;
			if (wantsStructured && Graph.inspectorEnabled) {
				return this._createObserveResult(path, target, options);
			}
			return {
				subscribe(sink: NodeSink) {
					return target.subscribe(sink);
				},
			};
		}
		const opts = pathOrOpts as ObserveOptions | undefined;
		const actor = opts?.actor;
		const wantsStructured =
			opts?.structured === true ||
			opts?.timeline === true ||
			opts?.causal === true ||
			opts?.derived === true;
		if (wantsStructured && Graph.inspectorEnabled) {
			return this._createObserveResultForAll(opts ?? {});
		}
		return {
			subscribe: (sink: (nodePath: string, messages: Messages) => void) => {
				const targets: [string, Node][] = [];
				this._collectObserveTargets("", targets);
				targets.sort((a, b) => a[0].localeCompare(b[0]));
				const picked =
					actor == null ? targets : targets.filter(([, nd]) => nd.allowsObserve(actor));
				const unsubs = picked.map(([p, nd]) =>
					nd.subscribe((msgs) => {
						sink(p, msgs);
					}),
				);
				return () => {
					for (const u of unsubs) u();
				};
			},
		};
	}

	private _createObserveResult<T>(
		path: string,
		target: Node<T>,
		options: ObserveOptions,
	): ObserveResult<T> {
		const timeline = options.timeline === true;
		const causal = options.causal === true;
		const derived = options.derived === true;
		const result: {
			values: Record<string, T>;
			dirtyCount: number;
			resolvedCount: number;
			events: ObserveEvent[];
			completedCleanly: boolean;
			errored: boolean;
		} = {
			values: {},
			dirtyCount: 0,
			resolvedCount: 0,
			events: [],
			completedCleanly: false,
			errored: false,
		};

		let lastTriggerDepIndex: number | undefined;
		let lastRunDepValues: unknown[] | undefined;
		let detachInspectorHook: (() => void) | undefined;
		if ((causal || derived) && target instanceof NodeImpl) {
			detachInspectorHook = target._setInspectorHook((event: NodeInspectorHookEvent) => {
				if (event.kind === "dep_message") {
					lastTriggerDepIndex = event.depIndex;
					return;
				}
				lastRunDepValues = [...event.depValues];
				if (derived) {
					result.events.push({
						type: "derived",
						path,
						dep_values: [...event.depValues],
						...(timeline ? { timestamp_ns: Date.now() * 1_000_000, in_batch: isBatching() } : {}),
					});
				}
			});
		}

		const unsub = target.subscribe((msgs) => {
			for (const m of msgs) {
				const t = m[0];
				const base = timeline
					? { timestamp_ns: Date.now() * 1_000_000, in_batch: isBatching() }
					: {};
				const withCausal =
					causal && lastRunDepValues != null
						? {
								trigger_dep_index: lastTriggerDepIndex,
								trigger_dep_name:
									lastTriggerDepIndex != null &&
									lastTriggerDepIndex >= 0 &&
									target instanceof NodeImpl
										? target._deps[lastTriggerDepIndex]?.name
										: undefined,
								dep_values: [...lastRunDepValues],
							}
						: {};
				if (t === DATA) {
					result.values[path] = m[1] as T;
					result.events.push({ type: "data", path, data: m[1], ...base, ...withCausal });
				} else if (t === DIRTY) {
					result.dirtyCount++;
					result.events.push({ type: "dirty", path, ...base });
				} else if (t === RESOLVED) {
					result.resolvedCount++;
					result.events.push({ type: "resolved", path, ...base, ...withCausal });
				} else if (t === COMPLETE) {
					if (!result.errored) result.completedCleanly = true;
					result.events.push({ type: "complete", path, ...base });
				} else if (t === ERROR) {
					result.errored = true;
					result.events.push({ type: "error", path, data: m[1], ...base });
				}
			}
		});

		return {
			get values() {
				return result.values;
			},
			get dirtyCount() {
				return result.dirtyCount;
			},
			get resolvedCount() {
				return result.resolvedCount;
			},
			get events() {
				return result.events;
			},
			get completedCleanly() {
				return result.completedCleanly;
			},
			get errored() {
				return result.errored;
			},
			dispose() {
				unsub();
				detachInspectorHook?.();
			},
		};
	}

	private _createObserveResultForAll(options: ObserveOptions): ObserveResult {
		const timeline = options.timeline === true;
		const result: {
			values: Record<string, unknown>;
			dirtyCount: number;
			resolvedCount: number;
			events: ObserveEvent[];
			completedCleanly: boolean;
			errored: boolean;
		} = {
			values: {},
			dirtyCount: 0,
			resolvedCount: 0,
			events: [],
			completedCleanly: false,
			errored: false,
		};
		const actor = options.actor;
		const targets: [string, Node][] = [];
		this._collectObserveTargets("", targets);
		targets.sort((a, b) => a[0].localeCompare(b[0]));
		const picked = actor == null ? targets : targets.filter(([, nd]) => nd.allowsObserve(actor));
		const unsubs = picked.map(([path, nd]) =>
			nd.subscribe((msgs) => {
				for (const m of msgs) {
					const t = m[0];
					const base = timeline
						? { timestamp_ns: Date.now() * 1_000_000, in_batch: isBatching() }
						: {};
					if (t === DATA) {
						result.values[path] = m[1];
						result.events.push({ type: "data", path, data: m[1], ...base });
					} else if (t === DIRTY) {
						result.dirtyCount++;
						result.events.push({ type: "dirty", path, ...base });
					} else if (t === RESOLVED) {
						result.resolvedCount++;
						result.events.push({ type: "resolved", path, ...base });
					} else if (t === COMPLETE) {
						if (!result.errored) result.completedCleanly = true;
						result.events.push({ type: "complete", path, ...base });
					} else if (t === ERROR) {
						result.errored = true;
						result.events.push({ type: "error", path, data: m[1], ...base });
					}
				}
			}),
		);
		return {
			get values() {
				return result.values;
			},
			get dirtyCount() {
				return result.dirtyCount;
			},
			get resolvedCount() {
				return result.resolvedCount;
			},
			get events() {
				return result.events;
			},
			get completedCleanly() {
				return result.completedCleanly;
			},
			get errored() {
				return result.errored;
			},
			dispose() {
				for (const u of unsubs) u();
			},
		};
	}

	// ——————————————————————————————————————————————————————————————
	//  Lifecycle & persistence (§3.7–§3.8)
	// ——————————————————————————————————————————————————————————————

	/**
	 * Sends `[[TEARDOWN]]` to all nodes, then clears registries on this graph and every
	 * mounted subgraph (§3.7). The instance is left empty and may be reused with {@link Graph.add}.
	 */
	destroy(): void {
		this.signal([[TEARDOWN]] satisfies Messages, { internal: true });
		for (const child of [...this._mounts.values()]) {
			child._destroyClearOnly();
		}
		this._mounts.clear();
		this._nodes.clear();
		this._edges.clear();
	}

	/** Clear structure after parent already signaled TEARDOWN through this subtree. */
	private _destroyClearOnly(): void {
		for (const child of [...this._mounts.values()]) {
			child._destroyClearOnly();
		}
		this._mounts.clear();
		this._nodes.clear();
		this._edges.clear();
	}

	/**
	 * Serializes structure and current values to JSON-shaped data (§3.8). Same information
	 * as {@link Graph.describe} plus a `version` field for format evolution.
	 *
	 * @returns Persistable snapshot with sorted keys.
	 */
	snapshot(): GraphPersistSnapshot {
		const d = this.describe();
		// Explicit key sorting for deterministic output — don't rely on
		// describe() iteration order (audit batch-3, §3.8).
		const sortedNodes: Record<string, DescribeNodeOutput> = {};
		for (const key of Object.keys(d.nodes).sort()) {
			sortedNodes[key] = d.nodes[key]!;
		}
		const sortedSubgraphs = [...d.subgraphs].sort();
		return { ...d, version: 1, nodes: sortedNodes, subgraphs: sortedSubgraphs };
	}

	/**
	 * Apply persisted values onto an existing graph whose topology matches the snapshot
	 * (§3.8). Only {@link DescribeNodeOutput.type} `state` and `producer` entries with a
	 * `value` field are written; `derived` / `operator` / `effect` are skipped so deps
	 * drive recomputation. Unknown paths are ignored.
	 *
	 * @param data - Snapshot envelope with matching `name` and node slices.
	 * @throws If `data.name` does not equal {@link Graph.name}.
	 */
	restore(data: GraphPersistSnapshot): void {
		parseSnapshotEnvelope(data);
		if (data.name !== this.name) {
			throw new Error(
				`Graph "${this.name}": restore snapshot name "${data.name}" does not match this graph`,
			);
		}
		for (const path of Object.keys(data.nodes).sort()) {
			const slice = data.nodes[path];
			if (slice === undefined || slice.value === undefined) continue;
			if (slice.type === "derived" || slice.type === "operator" || slice.type === "effect") {
				continue;
			}
			try {
				this.set(path, slice.value);
			} catch {
				/* missing path or set not applicable */
			}
		}
	}

	/**
	 * Creates a graph named from the snapshot, optionally runs `build` to register nodes
	 * and mounts, then {@link Graph.restore} values (§3.8).
	 *
	 * @param data - Snapshot envelope (`version` checked).
	 * @param build - Optional callback to construct topology before values are applied.
	 * @returns Hydrated `Graph` instance.
	 */
	static fromSnapshot(data: GraphPersistSnapshot, build?: (g: Graph) => void): Graph {
		parseSnapshotEnvelope(data);
		const g = new Graph(data.name);
		if (build) {
			build(g);
			g.restore(data);
			return g;
		}
		// Without build: reject edges and non-state nodes (aligned with Python).
		if (data.edges.length > 0) {
			throw new Error(
				"Graph.fromSnapshot does not support non-empty edges without a build callback; " +
					"node functions cannot be reconstructed from JSON. Build the graph in code and " +
					"use graph.restore(snapshot) to apply values, or pass a build callback.",
			);
		}
		for (const path of Object.keys(data.nodes).sort()) {
			const slice = data.nodes[path];
			if (!slice || path.includes(`${PATH_SEP}${GRAPH_META_SEGMENT}${PATH_SEP}`)) continue;
			if (slice.type !== "state") {
				throw new Error(
					`Graph.fromSnapshot only supports state nodes without a build callback ` +
						`(got type "${slice.type}" at "${path}")`,
				);
			}
		}
		// Auto-create mount hierarchy from subgraphs.
		for (const mount of [...data.subgraphs].sort((a, b) => {
			const da = a.split(PATH_SEP).length;
			const db = b.split(PATH_SEP).length;
			return da - db || a.localeCompare(b);
		})) {
			const parts = mount.split(PATH_SEP);
			let target: Graph = g;
			for (const seg of parts) {
				if (!target._mounts.has(seg)) {
					target.mount(seg, new Graph(seg));
				}
				target = target._mounts.get(seg)!;
			}
		}
		// Register state nodes and meta.
		for (const path of Object.keys(data.nodes).sort()) {
			const slice = data.nodes[path];
			if (!slice) continue;
			if (path.includes(`${PATH_SEP}${GRAPH_META_SEGMENT}${PATH_SEP}`)) continue;
			const meta: Record<string, unknown> = {};
			if (slice.meta) {
				for (const [k, v] of Object.entries(slice.meta)) {
					meta[k] = v;
				}
			}
			// Find owner graph and local name.
			const segments = path.split(PATH_SEP);
			const localName = segments.pop()!;
			let owner: Graph = g;
			for (const seg of segments) {
				owner = owner._mounts.get(seg)!;
			}
			owner.add(localName, stateNode(slice.value, { meta }));
		}
		return g;
	}

	/**
	 * Plain snapshot with **recursively sorted object keys** for deterministic serialization (§3.8).
	 *
	 * @remarks
	 * ECMAScript `JSON.stringify(graph)` invokes this method; it must return a plain object, not an
	 * already-stringified JSON string (otherwise the graph would be double-encoded).
	 * For a single UTF-8 string with a trailing newline (convenient for git), use {@link Graph.toJSONString}.
	 *
	 * @returns Same object as {@link Graph.snapshot}.
	 */
	toJSON(): GraphPersistSnapshot {
		return this.snapshot();
	}

	/**
	 * Deterministic JSON **text**: `JSON.stringify` of {@link Graph.toJSON} plus a trailing newline (§3.8).
	 *
	 * @returns Stable string suitable for diffs.
	 */
	toJSONString(): string {
		return stableJsonStringify(this.snapshot());
	}

	// ——————————————————————————————————————————————————————————————
	//  Inspector (§3.3) — reasoning trace, overhead gating
	// ——————————————————————————————————————————————————————————————

	/**
	 * When `false`, structured observation options (`causal`, `timeline`),
	 * `annotate()`, and `traceLog()` are no-ops. Raw `observe()` always works.
	 *
	 * Default: `true` outside production (`process.env.NODE_ENV !== "production"`).
	 */
	static inspectorEnabled = !(
		typeof process !== "undefined" && process.env?.NODE_ENV === "production"
	);

	private _annotations = new Map<string, string>();
	private _traceRingBuffer: TraceEntry[] = [];
	private _traceMaxSize = 256;

	/**
	 * Attaches a reasoning annotation to a node — captures *why* an AI agent set a value.
	 *
	 * No-op when {@link Graph.inspectorEnabled} is `false`.
	 *
	 * @param path - Qualified node path.
	 * @param reason - Free-text note stored in the trace ring buffer.
	 */
	annotate(path: string, reason: string): void {
		if (!Graph.inspectorEnabled) return;
		this.resolve(path); // validate path exists
		this._annotations.set(path, reason);
		const entry: TraceEntry = { node: path, reason, timestamp: Date.now() };
		this._traceRingBuffer.push(entry);
		if (this._traceRingBuffer.length > this._traceMaxSize) {
			this._traceRingBuffer.shift();
		}
	}

	/**
	 * Returns a chronological log of all reasoning annotations (ring buffer).
	 *
	 * @returns `[]` when {@link Graph.inspectorEnabled} is `false`.
	 */
	traceLog(): readonly TraceEntry[] {
		if (!Graph.inspectorEnabled) return [];
		return [...this._traceRingBuffer];
	}

	/**
	 * Computes structural + value diff between two {@link Graph.describe} snapshots.
	 *
	 * @param a - Earlier describe output.
	 * @param b - Later describe output.
	 * @returns Added/removed nodes, changed fields, and edge deltas.
	 */
	static diff(a: GraphDescribeOutput, b: GraphDescribeOutput): GraphDiffResult {
		const aKeys = new Set(Object.keys(a.nodes));
		const bKeys = new Set(Object.keys(b.nodes));

		const nodesAdded = [...bKeys].filter((k) => !aKeys.has(k)).sort();
		const nodesRemoved = [...aKeys].filter((k) => !bKeys.has(k)).sort();
		const nodesChanged: GraphDiffChange[] = [];

		for (const key of aKeys) {
			if (!bKeys.has(key)) continue;
			const na = a.nodes[key];
			const nb = b.nodes[key];
			for (const field of ["type", "status", "value"] as const) {
				const va = (na as Record<string, unknown>)[field];
				const vb = (nb as Record<string, unknown>)[field];
				if (!Object.is(va, vb) && JSON.stringify(va) !== JSON.stringify(vb)) {
					nodesChanged.push({ path: key, field, from: va, to: vb });
				}
			}
		}

		const edgeKey = (e: { from: string; to: string }) => `${e.from}\t${e.to}`;
		const aEdges = new Set(a.edges.map(edgeKey));
		const bEdges = new Set(b.edges.map(edgeKey));

		const edgesAdded = b.edges.filter((e) => !aEdges.has(edgeKey(e)));
		const edgesRemoved = a.edges.filter((e) => !bEdges.has(edgeKey(e)));

		return { nodesAdded, nodesRemoved, nodesChanged, edgesAdded, edgesRemoved };
	}
}

/** Entry in the reasoning trace ring buffer (§3.3). */
export type TraceEntry = {
	node: string;
	reason: string;
	timestamp: number;
};

/** Result of {@link Graph.diff}. */
export type GraphDiffResult = {
	nodesAdded: string[];
	nodesRemoved: string[];
	nodesChanged: GraphDiffChange[];
	edgesAdded: Array<{ from: string; to: string }>;
	edgesRemoved: Array<{ from: string; to: string }>;
};

/** A single field change within a diff. */
export type GraphDiffChange = {
	path: string;
	field: string;
	from: unknown;
	to: unknown;
};
