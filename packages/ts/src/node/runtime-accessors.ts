import type { NodeFn } from "../ctx/types.js";
import type { Dispatcher } from "../dispatcher/index.js";
import type { EnvironmentDrivers } from "../graph/environment.js";
import type { NodeCore } from "./core.js";
import type { Node } from "./node.js";
import { nodeRestoreState } from "./node-checkpoint-runtime.js";
import {
	LIFECYCLE,
	PRIVATE_STATE,
	RELEASED,
	SEED_NOTE,
	SLOT,
	SYNC_CTX,
	VALUE,
} from "./node-keys.js";
import {
	nodeIsRuntimeQuiescentForRelease,
	nodeReleaseRuntime,
	nodeSubscriberCount,
} from "./node-lifecycle-runtime.js";
import type { RuntimeReleaseFailure } from "./owned-acquisition.js";
import type { NodeCheckpointState, NodeSeed } from "./types.js";

type TopologyDepsChangedObserver = (
	node: Node<unknown>,
	prevDeps: readonly Node<unknown>[],
	deps: readonly Node<unknown>[],
) => void;

let constructingCore: NodeCore | undefined;
/** The dispatcher a node built in a staged or running graph takes when its options name none. */
let constructingDispatcher: Dispatcher | undefined;
let constructingEnvironment: EnvironmentDrivers | undefined;
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

/** @internal Run a Node/StateNode constructor against a graph-local core without widening the public constructor. */
export function withNodeCore<TNode extends Node<unknown>>(
	core: NodeCore,
	create: () => TNode,
	dispatcher?: Dispatcher,
): TNode {
	const prev = constructingCore;
	const prevDispatcher = constructingDispatcher;
	constructingCore = core;
	constructingDispatcher = dispatcher;
	try {
		return create();
	} finally {
		constructingCore = prev;
		constructingDispatcher = prevDispatcher;
	}
}

/** @internal Consume the dispatcher staged with the core by withNodeCore. */
export function takeConstructingDispatcher(): Dispatcher | undefined {
	const dispatcher = constructingDispatcher;
	constructingDispatcher = undefined;
	return dispatcher;
}

/** @internal Consume the graph-local NodeCore staged by withNodeCore. */
export function takeConstructingNodeCore(): NodeCore | undefined {
	const core = constructingCore;
	constructingCore = undefined;
	return core;
}

/**
 * R-graph-domain@3 (graphrefly-ts:D179): the graph of the node whose function or setup is running.
 * A node built during a run, with no graph staged for it, belongs to that run's graph (an inner of
 * a *Map, a timer an operator opens). Nested runs (a write to another graph that runs at once)
 * set and restore it.
 */
let runningCore: NodeCore | undefined;
let runningEnvironment: EnvironmentDrivers | undefined;
let runningDispatcher: Dispatcher | undefined;

/** @internal Run a node's function or setup with its graph as the running graph. */
export function withRunningGraph<R>(
	core: NodeCore,
	environment: EnvironmentDrivers,
	dispatcher: Dispatcher,
	run: () => R,
): R {
	const prevCore = runningCore;
	const prevEnvironment = runningEnvironment;
	const prevDispatcher = runningDispatcher;
	runningCore = core;
	runningEnvironment = environment;
	runningDispatcher = dispatcher;
	try {
		return run();
	} finally {
		runningCore = prevCore;
		runningEnvironment = prevEnvironment;
		runningDispatcher = prevDispatcher;
	}
}

/** @internal The running graph's core and drivers, for a node built during a run. */
export function runningGraph():
	| {
			readonly core: NodeCore;
			readonly environment: EnvironmentDrivers | undefined;
			readonly dispatcher: Dispatcher | undefined;
	  }
	| undefined {
	return runningCore === undefined
		? undefined
		: { core: runningCore, environment: runningEnvironment, dispatcher: runningDispatcher };
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
	return liveRegistration(n)?.graphAttachment?.owner;
}

/**
 * @internal D167: read release state and owner from one exact-identity lookup.
 * No user callback may run between these reads; never retain this result across checks.
 * Unissued objects retain the existing unowned result, not runtime access authority.
 */
export function nodeOwnerForGraphUse(n: Node<unknown>, label: string): unknown {
	const record = registrations.get(n);
	if (record?.kind === "retired" || (record?.kind === "live" && n[RELEASED])) {
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
}

export function notifyTopologyDepsChanged(
	node: Node<unknown>,
	prevDeps: readonly Node<unknown>[],
	deps: readonly Node<unknown>[],
): void {
	liveRegistration(node)?.graphAttachment?.observer?.(node, prevDeps, deps);
}

/** @internal Graph checkpoint inspection, kept as a module helper so Node stays method-thin. */
export function checkpointStateOfNode(n: Node<unknown>): NodeCheckpointState {
	if (liveRegistration(n) === undefined) throw new Error("checkpoint: unknown node state");
	return {
		values: [...n[VALUE].lastArray],
		cache: n[VALUE].cache,
		hasData: n[VALUE].hasData,
		terminal: n[VALUE].terminal,
		activated: n[LIFECYCLE].activated,
		privateState: n[PRIVATE_STATE].value,
		seedNote: n[SEED_NOTE],
		handle: n[SLOT].handle,
	};
}

/** @internal R-checkpoint restore commit: install a seed without a protocol wave or subscription. */
export function restoreStateOfNode(n: Node<unknown>, seed: NodeSeed): void {
	if (liveRegistration(n) === undefined) throw new Error("restoreGraph: unknown node state");
	nodeRestoreState(n, seed);
}

/**
 * @internal R-checkpoint@1: give a node `wrap` of its function in place of it, keeping the instance,
 * its values and lifetime (a restore wraps a restored node's function).
 */
export function wrapFnOfNode(n: Node<unknown>, wrap: (fn: NodeFn) => NodeFn): void {
	if (liveRegistration(n) === undefined) throw new Error("restoreGraph: unknown node state");
	const fn = n[SLOT].fn;
	if (fn === null) return;
	const wrapped = wrap(fn);
	const old = n[SLOT].handle;
	n[SLOT].handle = n[SLOT].dispatcher.register(wrapped);
	if (old !== null) n[SLOT].dispatcher.unregister(old);
	n[SLOT].fn = wrapped;
	n[SYNC_CTX].value = null;
}

/** @internal D122 graph-owned ephemeral lifecycle release. */
export function releaseRuntimeOfNode(n: Node<unknown>): void {
	if (liveRegistration(n) !== undefined) nodeReleaseRuntime(n);
}

/** @internal D124 guard for graph-owned ephemeral lifecycle release. */
export function isNodeRuntimeQuiescentForRelease(n: Node<unknown>): boolean {
	return liveRegistration(n) !== undefined && nodeIsRuntimeQuiescentForRelease(n);
}

/** @internal D124 graph-owned release subscriber accounting. */
export function subscriberCountOfNode(n: Node<unknown>): number {
	return liveRegistration(n) === undefined ? 0 : nodeSubscriberCount(n);
}

/** @internal D124 graph-owned release internal-subscriber accounting. */
export function isNodeActiveForRelease(n: Node<unknown>): boolean {
	return liveRegistration(n) !== undefined && n[LIFECYCLE].activated;
}

/** @internal D122 guard for graph-owned ephemeral lifecycle release. */
export function isNodeRuntimeReleased(n: Node<unknown>): boolean {
	const record = registrations.get(n);
	return record?.kind === "retired" || (record?.kind === "live" && n[RELEASED]);
}

/** The graph layer's id for a node, registered by the graph module (R-invocation@2 ctx.deps[i].id). */
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
		(owner === undefined ? undefined : graphNodeIdResolver?.(owner, node)) ??
		node.name ??
		node.factory ??
		"node"
	);
}
