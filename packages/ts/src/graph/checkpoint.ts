/**
 * Graph checkpoint public data shape (D83/D86/D90/D116).
 *
 * Checkpoint is a graph lifecycle snapshot: strict-JSON-compatible data, no storage I/O,
 * no observe-log replay, and no restore runtime in this first TS slice.
 */

import { strictJsonCodec } from "../json/codec.js";
import type { Node } from "../node/node.js";
import type { NodeVersionJson } from "../node/versioning.js";
import { SENTINEL } from "../protocol/messages.js";

export const GRAPH_CHECKPOINT_VERSION = "graphrefly.checkpoint.v1" as const;

export type GraphCheckpointVersion = typeof GRAPH_CHECKPOINT_VERSION;

export type GraphCheckpointJson =
	| null
	| boolean
	| number
	| string
	| GraphCheckpointJson[]
	| { [key: string]: GraphCheckpointJson };

export type GraphCheckpointValue =
	| { kind: "SENTINEL" }
	| { kind: "DATA"; data: GraphCheckpointJson };

export type GraphCheckpointTerminal =
	| { kind: "none" }
	| { kind: "COMPLETE" }
	| { kind: "ERROR"; error: GraphCheckpointJson };

export type GraphCheckpointFactory =
	| {
			kind: "registry-ref";
			ref: string;
			config?: GraphCheckpointJson;
			configVersion?: GraphCheckpointJson;
	  }
	| { kind: "local-only"; name: string; reason: string };

export interface GraphCheckpointNode {
	id: string;
	name?: string;
	factory: GraphCheckpointFactory;
	status: string;
	deps: string[];
	value: GraphCheckpointValue;
	backendState?: GraphCheckpointJson;
	version?: NodeVersionJson;
	terminal: GraphCheckpointTerminal;
	lifecycle: { activated: boolean; hasCalledFnOnce: boolean };
	ctxState: { persist: boolean; value: GraphCheckpointValue };
	meta?: { [key: string]: GraphCheckpointJson };
}

export interface GraphCheckpointEdge {
	from: string;
	to: string;
}

export interface GraphCheckpointMount {
	at: string;
	checkpoint: GraphCheckpoint;
}

export interface GraphCheckpoint {
	version: GraphCheckpointVersion;
	name?: string;
	nodes: GraphCheckpointNode[];
	edges: GraphCheckpointEdge[];
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

export function checkpointValue(
	value: unknown,
	hasData: boolean,
	path: string,
): GraphCheckpointValue {
	if (!hasData || value === SENTINEL) return { kind: "SENTINEL" };
	return { kind: "DATA", data: toCheckpointJson(value, path) };
}

export function checkpointTerminal(value: unknown, path: string): GraphCheckpointTerminal {
	if (value === undefined) return { kind: "none" };
	if (value === true) return { kind: "COMPLETE" };
	return { kind: "ERROR", error: toCheckpointJson(value, path) };
}

type BackendStateContributor = () => unknown;

const backendStateContributors = new WeakMap<Node<unknown>, BackendStateContributor>();

/** @internal D160: collection-owned backend checkpoint contributor for graph checkpoint. */
export function registerBackendStateContributor(
	node: Node<unknown>,
	contributor: BackendStateContributor,
): void {
	backendStateContributors.set(node, contributor);
}

/** @internal D160: capture a node's collection backend state when it has a contributor. */
export function checkpointBackendStateOfNode(
	node: Node<unknown>,
	path: string,
): GraphCheckpointJson | undefined {
	const contributor = backendStateContributors.get(node);
	if (contributor === undefined) return undefined;
	return toCheckpointJson(contributor(), path);
}
