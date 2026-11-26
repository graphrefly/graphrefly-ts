import type { NodeFn } from "../ctx/types.js";
import { idle, kOf, seedKNode, status, subscriberCount, terminalValue } from "./kernel.js";
import type { Node } from "./node.js";
import type { RuntimeReleaseFailure } from "./owned-acquisition.js";

import type { NodeCheckpointState, NodeSeed } from "./types.js";

type TopologyDepsChangedObserver = (
	node: Node<unknown>,
	prevDeps: readonly Node<unknown>[],
	deps: readonly Node<unknown>[],
) => void;

// D167: exact issued identity, runtime access and optional attachments share one owner record.
type NodeRegistration =
	| {
			kind: "live";
			graphAttachment?: { owner: unknown; observer?: TopologyDepsChangedObserver };
			backendContributor?: () => unknown;
	  }
	| { kind: "retired"; failures?: readonly RuntimeReleaseFailure[] };
const registrations = new WeakMap<Node<unknown>, NodeRegistration>();

/** Only called by the completed Node constructor; never exported through a public barrel. */
export function issueNodeRegistration(node: Node<unknown>): void {
	registrations.set(node, { kind: "live" });
}
function liveRegistration(node: Node<unknown>) {
	const record = registrations.get(node);
	return record?.kind === "live" ? record : undefined;
}
export function closeNodeRegistration(node: Node<unknown>): void {
	registrations.set(node, { kind: "retired" });
}
export function setRuntimeReleaseFailures(
	node: Node<unknown>,
	failures: readonly RuntimeReleaseFailure[],
): void {
	const record = registrations.get(node);
	if (record?.kind !== "retired") throw new Error("release: node access is not closed");
	record.failures = failures;
}
export function runtimeReleaseFailuresOfNode(
	node: Node<unknown>,
): readonly RuntimeReleaseFailure[] | undefined {
	const record = registrations.get(node);
	return record?.kind === "retired" ? record.failures : undefined;
}
export function setNodeBackendContributor(node: Node<unknown>, contributor: () => unknown): void {
	const record = liveRegistration(node);
	if (record === undefined) throw new Error("checkpoint: unknown node state");
	record.backendContributor = contributor;
}
export function nodeBackendContributor(node: Node<unknown>): (() => unknown) | undefined {
	return liveRegistration(node)?.backendContributor;
}

/** @internal Graph-domain ownership token for D22 intra-graph guards. */
export function getNodeOwner(n: Node<unknown>): unknown {
	return liveRegistration(n)?.graphAttachment?.owner;
}

/**
 * @internal D167: read release state and owner from one exact-identity lookup.
 * No user callback may run between these reads; never retain this result across checks.
 * Unissued objects retain the existing unowned result, not runtime access authority.
 */
export function nodeOwnerForGraphUse(n: Node<unknown>, label: string): unknown {
	const record = registrations.get(n);
	if (record?.kind === "retired") {
		throw new Error(`${label} has been released from its graph lifecycle (D122)`);
	}
	return record?.kind === "live" ? record.graphAttachment?.owner : undefined;
}

/** @internal Assign graph-domain ownership after graph registration. */
export function setNodeOwner(n: Node<unknown>, owner: unknown): void {
	const record = liveRegistration(n);
	if (record === undefined) throw new Error("graph: unknown node state");
	record.graphAttachment = { owner };
}

/** @internal Graph-layer D145 topology egress hook. */
export function setNodeTopologyDepsChangedObserver(
	n: Node<unknown>,
	observer: TopologyDepsChangedObserver,
): void {
	const attachment = liveRegistration(n)?.graphAttachment;
	if (attachment === undefined) throw new Error("graph: unknown node owner");
	attachment.observer = observer;
	bindTopologyHook(n);
}

export function notifyTopologyDepsChanged(
	node: Node<unknown>,
	prevDeps: readonly Node<unknown>[],
	deps: readonly Node<unknown>[],
): void {
	liveRegistration(node)?.graphAttachment?.observer?.(node, prevDeps, deps);
}

/** The kernel calls a node's topology hook through its registration. */
function bindTopologyHook(node: Node<unknown>): void {
	kOf(node).onDepsChanged = (prev, next) =>
		notifyTopologyDepsChanged(
			node,
			prev.map((d) => d.node),
			next.map((d) => d.node),
		);
}

/** @internal Graph checkpoint inspection, kept as a module helper so Node stays method-thin. */
export function checkpointStateOfNode(n: Node<unknown>): NodeCheckpointState {
	if (liveRegistration(n) === undefined) throw new Error("checkpoint: unknown node state");
	const k = kOf(n);
	return {
		values: [...k.values],
		cache: k.cache,
		hasData: k.has,
		terminal: terminalValue(k.ended),
		activated: k.active,
		privateState: k.privateState,
		seedNote: k.seedNote,
	};
}

/** @internal R-checkpoint restore commit: install a seed without a protocol wave or subscription. */
export function restoreStateOfNode(n: Node<unknown>, seed: NodeSeed): void {
	if (liveRegistration(n) === undefined) throw new Error("restoreGraph: unknown node state");
	seedKNode(kOf(n), seed);
}

/**
 * @internal R-checkpoint@1: give a node `wrap` of its function in place of it, keeping the instance,
 * its values and lifetime (a restore wraps a restored node's function).
 */
export function wrapFnOfNode(n: Node<unknown>, wrap: (fn: NodeFn) => NodeFn): void {
	if (liveRegistration(n) === undefined) throw new Error("restoreGraph: unknown node state");
	const k = kOf(n);
	if (k.fn === null) return;
	k.fn = wrap(k.fn);
}

/**
 * @internal D122 graph-owned ephemeral lifecycle release (graphrefly-ts:D193 (1), until phase 3):
 * the node's registration closes, so every later use through the graph layer and the node's handle
 * is refused. The kernel holds no release state (D193 (6)); a released node is one nothing holds.
 */
export function releaseRuntimeOfNode(n: Node<unknown>): void {
	if (liveRegistration(n) === undefined) return;
	closeNodeRegistration(n);
}

/** @internal The handle's guard: a released node takes no request (D122). */
export function assertNodeNotReleased(n: Node<unknown>, label: string): void {
	if (registrations.get(n)?.kind === "retired")
		throw new Error(`${label} has been released from its graph lifecycle (D122)`);
}

/** @internal D124 guard for graph-owned ephemeral lifecycle release, from the kernel's reads. */
export function isNodeRuntimeQuiescentForRelease(n: Node<unknown>): boolean {
	if (liveRegistration(n) === undefined) return false;
	const k = kOf(n);
	return idle(k.kernel) && status(k).lifecycle !== "closing";
}

/** @internal D124 graph-owned release subscriber accounting (the kernel's transitional read). */
export function subscriberCountOfNode(n: Node<unknown>): number {
	return liveRegistration(n) === undefined ? 0 : subscriberCount(kOf(n));
}

/** @internal D124 graph-owned release internal-subscriber accounting. */
export function isNodeActiveForRelease(n: Node<unknown>): boolean {
	return liveRegistration(n) !== undefined && status(kOf(n)).lifecycle !== "inactive";
}

/** @internal D122 guard for graph-owned ephemeral lifecycle release. */
export function isNodeRuntimeReleased(n: Node<unknown>): boolean {
	return registrations.get(n)?.kind === "retired";
}

/** The graph layer's id for a node, registered by the graph module (R-invocation@3 ctx.deps[i].id). */
let graphNodeIdResolver: ((owner: unknown, node: Node<unknown>) => string | undefined) | undefined;

/** @internal The graph module registers how a node's id is read from its owning graph. */
export function setGraphNodeIdResolver(
	resolver: (owner: unknown, node: Node<unknown>) => string | undefined,
): void {
	graphNodeIdResolver = resolver;
}

/** @internal A node's id in its graph: its registered id, or the synthetic id describe() gives. */
export function graphNodeIdOf(node: Node<unknown>): string {
	const owner = liveRegistration(node)?.graphAttachment?.owner;
	return (
		graphNodeIdResolver?.(owner ?? kOf(node).kernel, node) ?? node.name ?? node.factory ?? "node"
	);
}
