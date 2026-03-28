import { DATA, type Messages, TEARDOWN } from "../core/messages.js";
import { type Node, NodeImpl } from "../core/node.js";

/** The separator used for qualified paths in {@link Graph.resolve} et al. */
const PATH_SEP = "::";

/** Options for {@link Graph} (reserved for future hooks). */
export type GraphOptions = Record<string, unknown>;

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

/** TEARDOWN every node in a mounted graph tree (depth-first into mounts). */
function teardownMountedGraph(root: Graph): void {
	for (const child of root._mounts.values()) {
		teardownMountedGraph(child);
	}
	for (const n of root._nodes.values()) {
		n.down([[TEARDOWN]] satisfies Messages);
	}
}

/**
 * Named container for nodes and explicit edges (GRAPHREFLY-SPEC §3.1–§3.7).
 *
 * Qualified paths use `::` as the segment separator (e.g. `"parent::child::node"`).
 *
 * Edges are **pure wires**: {@link Graph.connect} does not apply transforms; it
 * validates that the target node already depends on the source (same object
 * reference in {@link NodeImpl._deps}).
 */
export class Graph {
	readonly name: string;
	readonly opts: Readonly<GraphOptions>;
	/** @internal — exposed for {@link teardownMountedGraph} and cross-graph helpers. */
	readonly _nodes = new Map<string, Node>();
	private readonly _edges = new Set<string>();
	/** @internal — exposed for {@link teardownMountedGraph}. */
	readonly _mounts = new Map<string, Graph>();

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
	 * Register a node under a local name. Fails if the name is already used,
	 * reserved by a mount, or the same node instance is already registered.
	 */
	add(name: string, node: Node): void {
		assertLocalName(name, this.name, "add");
		assertNoPathSep(name, this.name, "add");
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
	}

	/**
	 * Unregister a node or unmount a subgraph, drop incident edges, and send
	 * `[[TEARDOWN]]` to the removed node or recursively through the mounted subtree (§3.2).
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
		node.down([[TEARDOWN]] satisfies Messages);
	}

	/**
	 * Return a node by local name or `::` qualified path.
	 * Local names are looked up directly; paths with `::` delegate to {@link resolve}.
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

	/** Current value: `graph.node(name).get()` — accepts `::` qualified paths (§3.2). */
	get(name: string): unknown {
		return this.node(name).get();
	}

	/** Shorthand for `graph.node(name).down([[DATA, value]])` — accepts `::` qualified paths (§3.2). */
	set(name: string, value: unknown): void {
		this.node(name).down([[DATA, value]] satisfies Messages);
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
	 */
	connect(fromPath: string, toPath: string): void {
		if (!fromPath || !toPath) {
			throw new Error(`Graph "${this.name}": connect paths must be non-empty`);
		}

		const [fromGraph, fromLocal, fromNode] = this._resolveEndpoint(fromPath);
		const [toGraph, toLocal, toNode] = this._resolveEndpoint(toPath);

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
	 */
	disconnect(fromPath: string, toPath: string): void {
		if (!fromPath || !toPath) {
			throw new Error(`Graph "${this.name}": disconnect paths must be non-empty`);
		}

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
	 * Registered `[from, to]` edge pairs (read-only snapshot).
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
	 */
	mount(name: string, child: Graph): void {
		assertLocalName(name, this.name, "mount");
		assertNoPathSep(name, this.name, "mount");
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
	 * Deliver a message batch to every registered node in this graph and, recursively,
	 * in mounted child graphs (§3.7). Recurses into mounts first, then delivers to
	 * local nodes (matches Python visit order). Each {@link Node} receives at most one
	 * delivery per call (deduped by reference).
	 */
	signal(messages: Messages, visited?: Set<Node>): void {
		const vis = visited ?? new Set<Node>();
		// Mounts first (depth-first), then local nodes — matches graphrefly-py.
		for (const sub of this._mounts.values()) {
			sub.signal(messages, vis);
		}
		for (const n of this._nodes.values()) {
			if (vis.has(n)) continue;
			vis.add(n);
			n.down(messages);
		}
	}
}
