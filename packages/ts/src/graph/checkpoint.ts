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

/** The value-level sugar a recipe's node was built with, rebuilt the same way at restore. */
export type GraphCheckpointSugar = "derived" | "effect" | "producer";

/** R-node / R-checkpoint: a registered factory reference and its JSON configuration. */
export interface GraphCheckpointRecipe {
	ref: string;
	config?: GraphCheckpointJson;
	/**
	 * TS layout (graphrefly-ts:D178): set when the node was built with `g.derived`, `g.effect` or
	 * `g.producer`. Restore then takes only the value-level callback from the registry and builds
	 * the node with the same sugar and gate.
	 */
	sugar?: GraphCheckpointSugar;
}

/** The policies a computed node is restored with (R-checkpoint). */
export interface GraphCheckpointPolicies {
	complete: "auto" | "manual";
	error: "auto" | "manual";
	invalidate: "auto" | "manual";
	quiet: boolean;
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

/**
 * R-checkpoint@1: the one form of a node-level refusal, the same in every package:
 * `not restorable: <node id>: <reason>`.
 */
export function notRestorable(id: string, reason: string, cause?: unknown): Error {
	const message = `not restorable: ${id}: ${reason}`;
	return cause === undefined ? new Error(message) : new Error(message, { cause });
}

/** The reasons a capture refuses a node (R-checkpoint@1: refused at capture, not at restore). */
export const CHECKPOINT_REFUSAL = {
	privateState: "its private state is not JSON",
	recipeConfig: "its recipe config is not JSON",
	values: "its retained values are not JSON",
	errorPayload: "its ERROR payload is not JSON",
	/** TS package extension: describe metadata saved beside the node. */
	meta: "its meta is not JSON",
	/** Restore: a computed node whose instance carries no recipe. */
	localOnly: "local-only, built or replaced without a recipe",
} as const;

/** Convert a value a capture saves for node `id`, refusing it for `reason` when it is not JSON. */
export function checkpointJsonOf(id: string, reason: string, value: unknown): GraphCheckpointJson {
	try {
		return strictJsonCodec.decode(strictJsonCodec.encode(value)) as GraphCheckpointJson;
	} catch (cause) {
		throw notRestorable(id, reason, cause);
	}
}

/** A node's terminal as a checkpoint saves it; a non-JSON ERROR payload refuses node `id`. */
export function checkpointTerminal(value: unknown, id: string): GraphCheckpointTerminal {
	if (value === undefined) return { kind: "none" };
	if (value === true) return { kind: "COMPLETE" };
	return { kind: "ERROR", error: checkpointJsonOf(id, CHECKPOINT_REFUSAL.errorPayload, value) };
}

type BackendStateContributor = () => unknown;

/** @internal TS extension (graphrefly-ts:D178): a collection's backend contributor. */
export function registerBackendStateContributor(
	node: Node<unknown>,
	contributor: BackendStateContributor,
): void {
	setNodeBackendContributor(node, contributor);
}

/**
 * @internal D160: capture a node's collection backend state when it has a contributor. The
 * backend is what the collection retains, so a non-JSON one refuses node `id` for its values.
 */
export function checkpointBackendStateOfNode(
	node: Node<unknown>,
	id: string,
): GraphCheckpointJson | undefined {
	const contributor = nodeBackendContributor(node);
	if (contributor === undefined) return undefined;
	return checkpointJsonOf(id, CHECKPOINT_REFUSAL.values, contributor());
}
