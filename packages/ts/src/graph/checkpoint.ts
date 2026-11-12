/**
 * Graph checkpoint data shape (R-checkpoint@1, graphrefly:D802; TS layout graphrefly-ts:D178).
 *
 * A checkpoint is strict JSON, taken only at a wave boundary. It saves the topology in creation
 * order, each computed node's recipe and policies, and each node's last-array values, terminal,
 * private state and what it received from each dependency. It holds no revision or version
 * evidence. No storage I/O.
 */

import { type StrictJsonValue, strictJsonCodec } from "../json/codec.js";
import type { Node } from "../node/node.js";
import { nodeBackendContributor, setNodeBackendContributor } from "../node/runtime-accessors.js";

export const GRAPH_CHECKPOINT_FORMAT = "graphrefly-ts/checkpoint@1" as const;

export type GraphCheckpointFormat = typeof GRAPH_CHECKPOINT_FORMAT;

export type GraphCheckpointJson = StrictJsonValue;

export type GraphCheckpointTerminal =
	| { kind: "none" }
	| { kind: "COMPLETE" }
	| { kind: "ERROR"; error: GraphCheckpointJson };

/** R-node / R-checkpoint: a registered factory reference and its JSON configuration. */
export interface GraphCheckpointRecipe {
	ref: string;
	config?: GraphCheckpointJson;
}

/** The policies a computed node is restored with (R-checkpoint). */
export interface GraphCheckpointPolicies {
	complete: "auto" | "manual";
	error: "auto" | "manual";
	invalidate: "auto" | "manual";
	quiet: boolean;
	dynamic: boolean;
	pool: "sync" | "async";
}

/** What a node received from one dependency: that dependency's last-array values and terminal. */
export interface GraphCheckpointReceived {
	values: GraphCheckpointJson[];
	terminal: GraphCheckpointTerminal;
}

/** A computed node's lifetime at capture: its private state and what it received. */
export interface GraphCheckpointLifetime {
	/** Private state; absent when the lifetime has none. */
	state?: GraphCheckpointJson;
	/** One record per dependency of the lifetime, in dependency order. */
	received: GraphCheckpointReceived[];
	/** The lifetime's dependencies, when a ctx.rewire changed them from the declared ones. */
	deps?: string[];
}

export interface GraphCheckpointNode {
	id: string;
	name?: string;
	/** The factory name describe shows. */
	factory: string;
	kind: "state" | "computed";
	/** Declared dependencies. */
	deps: string[];
	/** Computed nodes: the current instance's recipe; absent makes the node local-only. */
	recipe?: GraphCheckpointRecipe;
	/** Computed nodes: the policies. */
	policies?: GraphCheckpointPolicies;
	/** The values of the node's last array. */
	values: GraphCheckpointJson[];
	terminal: GraphCheckpointTerminal;
	/** Computed nodes with a lifetime (or a restored seed not yet activated). */
	lifetime?: GraphCheckpointLifetime;
	/** TS package extension: a collection's backend, rebuilt by its restore extension. */
	backendState?: GraphCheckpointJson;
	meta?: { [key: string]: GraphCheckpointJson };
}

export interface GraphCheckpointMount {
	at: string;
	checkpoint: GraphCheckpoint;
}

export interface GraphCheckpoint {
	format: GraphCheckpointFormat;
	name?: string;
	nodes: GraphCheckpointNode[];
	mounts?: GraphCheckpointMount[];
}

export function toCheckpointJson(value: unknown, path = "$"): GraphCheckpointJson {
	try {
		return strictJsonCodec.decode(strictJsonCodec.encode(value)) as GraphCheckpointJson;
	} catch (cause) {
		throw new TypeError(`checkpoint: value at ${path} is not strict JSON compatible`, {
			cause,
		});
	}
}

export function checkpointTerminal(value: unknown, path: string): GraphCheckpointTerminal {
	if (value === undefined) return { kind: "none" };
	if (value === true) return { kind: "COMPLETE" };
	return { kind: "ERROR", error: toCheckpointJson(value, path) };
}

type BackendStateContributor = () => unknown;

/** @internal TS extension (graphrefly-ts:D178): a collection's backend contributor. */
export function registerBackendStateContributor(
	node: Node<unknown>,
	contributor: BackendStateContributor,
): void {
	setNodeBackendContributor(node, contributor);
}

/** @internal D160: capture a node's collection backend state when it has a contributor. */
export function checkpointBackendStateOfNode(
	node: Node<unknown>,
	path: string,
): GraphCheckpointJson | undefined {
	const contributor = nodeBackendContributor(node);
	if (contributor === undefined) return undefined;
	return toCheckpointJson(contributor(), path);
}
