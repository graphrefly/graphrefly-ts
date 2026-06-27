import type { EnvironmentDrivers } from "../graph/environment.js";
import type { NodeCore } from "./core.js";
import type { Node } from "./node.js";
import type { NodeCheckpointState, NodeRestoreState } from "./types.js";

type TopologyDepsChangedObserver = (
	node: Node<unknown>,
	prevDeps: readonly Node<unknown>[],
	deps: readonly Node<unknown>[],
) => void;

let constructingCore: NodeCore | undefined;
let constructingEnvironment: EnvironmentDrivers | undefined;
export const ownerTokens = new WeakMap<Node<unknown>, unknown>();
export const topologyDepsChangedObservers = new WeakMap<
	Node<unknown>,
	TopologyDepsChangedObserver
>();
export const checkpointReaders = new WeakMap<Node<unknown>, () => NodeCheckpointState>();
export const restoreWriters = new WeakMap<Node<unknown>, (state: NodeRestoreState) => void>();
export const runtimeReleasers = new WeakMap<Node<unknown>, () => void>();
export const runtimeQuiescenceReaders = new WeakMap<Node<unknown>, () => boolean>();
export const subscriberCountReaders = new WeakMap<Node<unknown>, () => number>();
export const activationReaders = new WeakMap<Node<unknown>, () => boolean>();
export const releasedNodes = new WeakSet<Node<unknown>>();

/** @internal Run a Node/StateNode constructor against a graph-local core without widening the public constructor. */
export function withNodeCore<TNode extends Node<unknown>>(
	core: NodeCore,
	create: () => TNode,
): TNode {
	const prev = constructingCore;
	constructingCore = core;
	try {
		return create();
	} finally {
		constructingCore = prev;
	}
}

/** @internal Consume the graph-local NodeCore staged by withNodeCore. */
export function takeConstructingNodeCore(): NodeCore | undefined {
	const core = constructingCore;
	constructingCore = undefined;
	return core;
}

/** @internal Run a Node/StateNode constructor with graph-owned environment drivers (D130/D131). */
export function withEnvironmentDrivers<TNode extends Node<unknown>>(
	environment: EnvironmentDrivers,
	create: () => TNode,
): TNode {
	const prev = constructingEnvironment;
	constructingEnvironment = environment;
	try {
		return create();
	} finally {
		constructingEnvironment = prev;
	}
}

/** @internal Consume graph-owned environment drivers staged by withEnvironmentDrivers. */
export function takeConstructingEnvironmentDrivers(): EnvironmentDrivers | undefined {
	const environment = constructingEnvironment;
	constructingEnvironment = undefined;
	return environment;
}

/** @internal Graph-domain ownership token for D22 intra-graph guards. */
export function getNodeOwner(n: Node<unknown>): unknown {
	return ownerTokens.get(n);
}

/** @internal Assign graph-domain ownership after graph registration. */
export function setNodeOwner(n: Node<unknown>, owner: unknown): void {
	ownerTokens.set(n, owner);
}

/** @internal Graph-layer D145 topology egress hook. */
export function setNodeTopologyDepsChangedObserver(
	n: Node<unknown>,
	observer: TopologyDepsChangedObserver,
): void {
	topologyDepsChangedObservers.set(n, observer);
}

export function notifyTopologyDepsChanged(
	node: Node<unknown>,
	prevDeps: readonly Node<unknown>[],
	deps: readonly Node<unknown>[],
): void {
	topologyDepsChangedObservers.get(node)?.(node, prevDeps, deps);
}

/** @internal Graph checkpoint inspection, kept as a module helper so Node stays method-thin. */
export function checkpointStateOfNode(n: Node<unknown>): NodeCheckpointState {
	const read = checkpointReaders.get(n);
	if (read === undefined) throw new Error("checkpoint: unknown node state");
	return read();
}

/** @internal D94 restore commit: install runtime state without a protocol wave or subscription. */
export function restoreStateOfNode(n: Node<unknown>, state: NodeRestoreState): void {
	const write = restoreWriters.get(n);
	if (write === undefined) throw new Error("restoreGraph: unknown node state");
	write(state);
}

/** @internal D122 graph-owned ephemeral lifecycle release. */
export function releaseRuntimeOfNode(n: Node<unknown>): void {
	runtimeReleasers.get(n)?.();
}

/** @internal D124 guard for graph-owned ephemeral lifecycle release. */
export function isNodeRuntimeQuiescentForRelease(n: Node<unknown>): boolean {
	return runtimeQuiescenceReaders.get(n)?.() ?? false;
}

/** @internal D124 graph-owned release subscriber accounting. */
export function subscriberCountOfNode(n: Node<unknown>): number {
	return subscriberCountReaders.get(n)?.() ?? 0;
}

/** @internal D124 graph-owned release internal-subscriber accounting. */
export function isNodeActiveForRelease(n: Node<unknown>): boolean {
	return activationReaders.get(n)?.() ?? false;
}

/** @internal D122 guard for graph-owned ephemeral lifecycle release. */
export function isNodeRuntimeReleased(n: Node<unknown>): boolean {
	return releasedNodes.has(n);
}
