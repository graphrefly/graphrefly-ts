import type { EnvironmentDrivers } from "../graph/environment.js";
import type { NodeCore } from "./core.js";
import type { Node } from "./node.js";
import { nodeRestoreState } from "./node-checkpoint-runtime.js";
import { type NodeRuntimeHost, nodeRuntimeHost } from "./node-runtime-host.js";
import type { RuntimeReleaseFailure } from "./owned-acquisition.js";
import type { NodeCheckpointState, NodeRestoreState } from "./types.js";
import { cloneNodeVersion } from "./versioning.js";

type TopologyDepsChangedObserver = (
	node: Node<unknown>,
	prevDeps: readonly Node<unknown>[],
	deps: readonly Node<unknown>[],
) => void;

let constructingCore: NodeCore | undefined;
let constructingEnvironment: EnvironmentDrivers | undefined;
// D167: exact issued identity, runtime access and optional attachments share one owner record.
type NodeRegistration =
	| {
			kind: "live";
			host: NodeRuntimeHost;
			graphAttachment?: { owner: unknown; observer?: TopologyDepsChangedObserver };
			backendContributor?: () => unknown;
	  }
	| { kind: "retired"; failures?: readonly RuntimeReleaseFailure[] };
const registrations = new WeakMap<Node<unknown>, NodeRegistration>();

/** Only called by the completed Node constructor; never exported through a public barrel. */
export function issueNodeRegistration(node: Node<unknown>): void {
	registrations.set(node, { kind: "live", host: nodeRuntimeHost(node) });
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
	return liveRegistration(n)?.graphAttachment?.owner;
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
	const self = liveRegistration(n)?.host;
	if (self === undefined) throw new Error("checkpoint: unknown node state");
	return {
		cache: self._value.cache,
		hasData: self._value.hasData,
		terminal: self._value.terminal,
		activated: self._lifecycle.activated,
		hasCalledFnOnce: self._wave.hasCalledFnOnce,
		ctxState: { value: self._privateState.value, persist: self._privateState.persist },
		version: cloneNodeVersion(self._version.value),
		handle: self._slot.handle,
	};
}

/** @internal D94 restore commit: install runtime state without a protocol wave or subscription. */
export function restoreStateOfNode(n: Node<unknown>, state: NodeRestoreState): void {
	const self = liveRegistration(n)?.host;
	if (self === undefined) throw new Error("restoreGraph: unknown node state");
	nodeRestoreState(self, state);
}

/** @internal D122 graph-owned ephemeral lifecycle release. */
export function releaseRuntimeOfNode(n: Node<unknown>): void {
	liveRegistration(n)?.host._releaseRuntime();
}

/** @internal D124 guard for graph-owned ephemeral lifecycle release. */
export function isNodeRuntimeQuiescentForRelease(n: Node<unknown>): boolean {
	return liveRegistration(n)?.host._isRuntimeQuiescentForRelease() ?? false;
}

/** @internal D124 graph-owned release subscriber accounting. */
export function subscriberCountOfNode(n: Node<unknown>): number {
	return liveRegistration(n)?.host._subscriberCount() ?? 0;
}

/** @internal D124 graph-owned release internal-subscriber accounting. */
export function isNodeActiveForRelease(n: Node<unknown>): boolean {
	return liveRegistration(n)?.host._lifecycle.activated ?? false;
}

/** @internal D122 guard for graph-owned ephemeral lifecycle release. */
export function isNodeRuntimeReleased(n: Node<unknown>): boolean {
	const record = registrations.get(n);
	return record?.kind === "retired" || (record?.kind === "live" && record.host._released);
}
