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

export interface GraphLifecycleRegistrar extends GraphRestoreRegistrar {
	assertRegisteredNode(node: Node<unknown>, label: string): void;
	/** R-graph-domain@3: this graph is between waves and has no open batch body. */
	atWaveBoundary(): boolean;
	/** Run `run`, observing the failures this graph reports meanwhile (graphrefly-ts:D181). */
	observeFailures<R>(observer: (source: string, error: unknown) => void, run: () => R): R;
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
	readonly existingConstructions: Map<string, OwnedConstruction> | undefined;
}

export const graphRegistrations = new WeakMap<Graph, GraphLifecycleRegistrar>();
