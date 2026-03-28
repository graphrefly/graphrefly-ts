import { DATA, type Messages, TEARDOWN } from "../core/messages.js";
import { type Node, NodeImpl } from "../core/node.js";

/** Options for {@link Graph} (reserved for future hooks). */
export type GraphOptions = Record<string, unknown>;

function assertLocalName(name: string, graphName: string, label: string): void {
	if (name === "") {
		throw new Error(`Graph "${graphName}": ${label} name must be non-empty`);
	}
}

function edgeKey(from: string, to: string): string {
	return JSON.stringify([from, to]);
}

/**
 * Named container for nodes and explicit edges (GRAPHREFLY-SPEC §3.1–§3.3).
 *
 * Edges are **pure wires**: {@link Graph.connect} does not apply transforms; it
 * validates that the target node already depends on the source (same object
 * reference in {@link NodeImpl._deps}).
 */
export class Graph {
	readonly name: string;
	readonly opts: Readonly<GraphOptions>;
	private readonly _nodes = new Map<string, Node>();
	private readonly _edges = new Set<string>();

	constructor(name: string, opts?: GraphOptions) {
		if (name === "") {
			throw new Error("Graph name must be non-empty");
		}
		this.name = name;
		this.opts = opts ?? {};
	}

	/**
	 * Register a node under a local name. Fails if the name is already used.
	 */
	add(name: string, node: Node): void {
		assertLocalName(name, this.name, "add");
		if (this._nodes.has(name)) {
			throw new Error(`Graph "${this.name}": node "${name}" already exists`);
		}
		this._nodes.set(name, node);
	}

	/**
	 * Unregister a node, drop incident edges, and send `[[TEARDOWN]]` (spec §3.2).
	 */
	remove(name: string): void {
		assertLocalName(name, this.name, "remove");
		const node = this._nodes.get(name);
		if (!node) {
			throw new Error(`Graph "${this.name}": unknown node "${name}"`);
		}
		this._nodes.delete(name);
		for (const key of [...this._edges]) {
			const [from, to] = JSON.parse(key) as [string, string];
			if (from === name || to === name) this._edges.delete(key);
		}
		node.down([[TEARDOWN]] satisfies Messages);
	}

	/** Current value: `graph.node(name).get()` (§3.2). */
	get(name: string): unknown {
		return this.node(name).get();
	}

	/** Shorthand for `graph.node(name).down([[DATA, value]])` (§3.2). */
	set(name: string, value: unknown): void {
		this.node(name).down([[DATA, value]] satisfies Messages);
	}

	/** Resolve a registered node by local name (§3.2). */
	node(name: string): Node {
		assertLocalName(name, this.name, "node");
		const n = this._nodes.get(name);
		if (!n) {
			throw new Error(`Graph "${this.name}": unknown node "${name}"`);
		}
		return n;
	}

	/**
	 * Record a wire from `fromName` → `toName` and validate it matches node deps (§3.3).
	 *
	 * The target must be a {@link NodeImpl} whose `_deps` includes the source node
	 * instance registered as `fromName`. No transforms on edges.
	 */
	connect(fromName: string, toName: string): void {
		assertLocalName(fromName, this.name, "connect(from)");
		assertLocalName(toName, this.name, "connect(to)");
		const fromNode = this.node(fromName);
		const toNode = this.node(toName);
		const key = edgeKey(fromName, toName);
		if (this._edges.has(key)) return;

		if (!(toNode instanceof NodeImpl)) {
			throw new Error(
				`Graph "${this.name}": connect(${fromName}, ${toName}) requires the target to be a graphrefly NodeImpl so deps can be validated`,
			);
		}
		if (!toNode._deps.includes(fromNode)) {
			throw new Error(
				`Graph "${this.name}": connect(${fromName}, ${toName}) — "${toName}" must include "${fromName}" in its constructor deps (same node reference)`,
			);
		}
		this._edges.add(key);
	}

	/**
	 * Remove a registered edge. Does **not** change constructor-time deps on {@link Node};
	 * it drops the graph's record of this wire (for registry / future describe).
	 */
	disconnect(fromName: string, toName: string): void {
		assertLocalName(fromName, this.name, "disconnect(from)");
		assertLocalName(toName, this.name, "disconnect(to)");
		const key = edgeKey(fromName, toName);
		if (!this._edges.delete(key)) {
			throw new Error(`Graph "${this.name}": no registered edge ${fromName} → ${toName}`);
		}
	}
}
