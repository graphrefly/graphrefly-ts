import type { NodeFn } from "../ctx/types.js";
import type { Node } from "../node/node.js";
import type { Graph, StateNode } from "./graph.js";
import type { SugarOpts } from "./graph-types.js";

export interface GraphRestoreRegistrar {
	stateNode<T>(id: string, opts?: SugarOpts<T>): StateNode<T>;
	node<T>(
		id: string,
		factory: string,
		deps: readonly Node<unknown>[],
		fn: NodeFn | null,
		opts?: SugarOpts<T>,
	): Node<T>;
}

export const restoreRegistrars = new WeakMap<Graph, GraphRestoreRegistrar>();

export interface GraphLifecycleRegistrar {
	assertRegisteredNode(node: Node<unknown>, label: string): void;
	releaseNodes(nodes: readonly Node<unknown>[], opts?: { reason?: string }): void;
}

export const lifecycleRegistrars = new WeakMap<Graph, GraphLifecycleRegistrar>();
