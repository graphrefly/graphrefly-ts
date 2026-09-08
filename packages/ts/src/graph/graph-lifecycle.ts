import type { NodeFn } from "../ctx/types.js";
import type { Node } from "../node/node.js";
import type { NodeAcquisition } from "../node/owned-acquisition.js";
import type { OwnedConstruction } from "./construction-scope.js";
import type { DescribeSnapshot } from "./describe.js";
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
	readIncoming(nodes: ReadonlySet<Node<unknown>>): Pick<DescribeSnapshot, "edges">;
	releaseNodes(nodes: readonly Node<unknown>[], opts?: { reason?: string }): void;
	assertAvailableName(name: string): void;
	createOwned<T>(
		deps: readonly Node<unknown>[],
		fn: NodeFn | null,
		opts: SugarOpts<T>,
		acquired: NodeAcquisition,
	): Node<T>;
	readonly constructions: Map<string, OwnedConstruction>;
}

export const lifecycleRegistrars = new WeakMap<Graph, GraphLifecycleRegistrar>();
