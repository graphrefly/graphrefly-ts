import { assertLocalName } from "./naming.js";
/**
 * The node handle (R-node-thin): the package's object for one kernel record (node/kernel.ts).
 * Naming, find and describe are the graph layer's. Canonical authority:
 * ~/src/graphrefly/spec/rules.jsonl (R-node, R-subscription, R-lifetime, R-request-order).
 */

import type { NodeFn, Sink } from "../ctx/types.js";
import { defaultDispatcher, type Handle } from "../dispatcher/index.js";
import { EnvironmentDrivers } from "../graph/environment.js";
import {
	bindKNode,
	copyData,
	hostInput,
	hostSet,
	type Kernel,
	type KNode,
	kOf,
	makeKNode,
	replace,
	status,
	subscribe,
	terminalValue,
} from "./kernel.js";
import {
	constructionAcquisitions,
	failNodeAcquisition,
	type NodeAcquisition,
} from "./owned-acquisition.js";
import {
	issueNodeRegistration,
	runningGraph,
	takeConstructingDispatcher,
	takeConstructingEnvironmentDrivers,
	takeConstructingNodeCore,
	withEnvironmentDrivers,
	withNodeCore,
} from "./runtime-accessors.js";
import type { NodeDefinition, NodeOptions, ReplaceOptions, Status } from "./types.js";

export {
	checkpointStateOfNode,
	getNodeOwner,
	isNodeActiveForRelease,
	isNodeRuntimeQuiescentForRelease,
	isNodeRuntimeReleased,
	releaseRuntimeOfNode,
	restoreStateOfNode,
	setGraphNodeIdResolver,
	setNodeOwner,
	setNodeTopologyDepsChangedObserver,
	subscriberCountOfNode,
	withEnvironmentDrivers,
	withNodeCore,
} from "./runtime-accessors.js";
export type { NodeCheckpointState, NodeOptions, NodeSeed, Status } from "./types.js";

/** @internal A node's place in creation order in its graph (R-graph-surface@2). */
export function nodeCreationIndex(node: Node<unknown>): number {
	return kOf(node).created;
}

/**
 * Reactive substrate node: a handle for one kernel record, which owns its dependencies, wave
 * state, lifetime and subscribers.
 *
 * @example
 * ```ts
 * import { graph } from "@graphrefly/ts/graph";
 *
 * const source = graph().state<number>(0);
 * source.subscribe((msgs) => console.log(msgs));
 * source.set(1);
 * ```
 * @remarks **Built by a graph:** every node belongs to one graph's domain (R-graph-domain@3); build
 *   it with `graph().node`, `graph().state` or `graph().derived`. There is no standalone node.
 * @category core
 */
export class Node<T = unknown> {
	constructor(
		deps: Node<unknown>[],
		handleOrFn: Handle | NodeFn | null,
		opts: NodeOptions<T> = {},
	) {
		assertLocalName(opts.name);
		// R-node: a node with dependencies is a computed node and has a function; a node without
		// one is a state and has no dependencies.
		if (handleOrFn === null && deps.length > 0)
			throw new TypeError("node: a node with dependencies needs a function (R-node)");
		const suppliedAcquisition = constructionAcquisitions.get(opts);
		const acquisition: NodeAcquisition = suppliedAcquisition ?? { name: "bare node" };
		constructionAcquisitions.delete(opts);
		const staged = takeConstructingNodeCore();
		const stagedDispatcher = takeConstructingDispatcher();
		const stagedEnvironment = takeConstructingEnvironmentDrivers();
		const running = staged === undefined ? runningGraph() : undefined;
		const kernel = staged ?? running?.core;
		const dispatcher =
			opts.dispatcher ?? stagedDispatcher ?? running?.dispatcher ?? defaultDispatcher;
		const environment = stagedEnvironment ?? running?.environment ?? EnvironmentDrivers.empty();
		try {
			// R-graph-domain@3: a node belongs to one graph's domain; there is no standalone node.
			if (kernel === undefined)
				throw new Error("node: a node is built by a graph (graph.node, graph.state, ...)");
			for (const d of deps)
				if (kOf(d).kernel !== kernel)
					throw new Error(
						"node: dependencies belong to different graphs; cross-graph deps require a wire bridge (R-graph-domain)",
					);
			let handle: Handle | null;
			if (handleOrFn === null) handle = null;
			else if (typeof handleOrFn === "function") handle = dispatcher.register(handleOrFn);
			else handle = handleOrFn;
			if (handle !== null && typeof handleOrFn === "function") {
				acquisition.dispatcher = dispatcher;
				acquisition.handle = handle;
			}
			const record = makeKNode(kernel, {
				node: this as Node<unknown>,
				kind: handleOrFn === null ? "state" : "node",
				deps: deps.map(kOf),
				fn: typeof handleOrFn === "function" ? handleOrFn : null,
				id: opts.id ?? opts.name,
				complete: opts.complete,
				error: opts.error,
				invalidate: opts.invalidate,
				quiet: opts.quiet,
				setup: opts.setup,
				recipe: opts.recipe,
				initial: opts.initial === null ? null : opts.initial,
				seed: opts.seed,
				handle,
				dispatcher,
				environment,
				name: opts.name,
				factory: opts.factory,
			});
			bindKNode(this as Node<unknown>, record);
			acquisition.core = kernel;
			issueNodeRegistration(this as Node<unknown>);
			acquisition.node = this as Node<unknown>;
		} catch (cause) {
			if (suppliedAcquisition !== undefined) throw cause; // D161 owner retains this journal.
			failNodeAcquisition(acquisition, cause);
		}
	}

	get cache(): T | undefined {
		return kOf(this as Node<unknown>).cache as T | undefined;
	}

	/** R-node@4: derived from what the node holds; reading it changes nothing. */
	get status(): Status {
		return status(kOf(this as Node<unknown>));
	}

	get name(): string | undefined {
		return kOf(this as Node<unknown>).name;
	}

	/** D51: real factory name for a node built outside the graph's index. */
	get factory(): string | undefined {
		return kOf(this as Node<unknown>).factory;
	}

	/** The node's current dependencies (a ctx.rewire's included); inspection only. */
	get deps(): readonly Node<unknown>[] {
		return kOf(this as Node<unknown>).deps.map((d) => d.node);
	}

	/** The function's handle in the dispatcher's table, or null for a state (phase 1b removes it). */
	get handle(): Handle | null {
		return kOf(this as Node<unknown>).handle;
	}

	/**
	 * R-subscription@5: a new sink first receives one array, START followed by the node's snapshot;
	 * after that every array the node sends, each with the kernel's PENDING first. A request: during
	 * a wave it waits for the wave to end. Returns the unsubscribe.
	 */
	subscribe(sink: Sink): () => void {
		return subscribe(kOf(this as Node<unknown>), sink);
	}
}

/** @internal The kernel record of this node, terminal as the package's shape. */
export function terminalOfNode(node: Node<unknown>): unknown {
	return terminalValue(kOf(node).ended);
}

/**
 * Internal: a node with no dependencies and no function is a state node, the only node with host
 * inputs (R-node, graphrefly-ts:D175).
 */
export function makeNode<T>(
	deps: Node<unknown>[],
	handleOrFn: Handle | NodeFn | null,
	opts: NodeOptions<T>,
): Node<T> {
	return deps.length === 0 && handleOrFn === null
		? new StateNode<T>(deps, null, opts)
		: new Node<T>(deps, handleOrFn, opts);
}

/**
 * Internal: build nodes in the graph of `beside` (R-graph-domain@3), for helpers that take a node
 * and open helper nodes of their own (a timer beside its source). One node per call.
 */
export function buildBeside<N extends Node<unknown>>(beside: Node<unknown>, create: () => N): N {
	const n = kOf(beside);
	return withEnvironmentDrivers(n.environment, () => withNodeCore(n.kernel, create, n.dispatcher));
}

/**
 * Internal: a derived node built in its dependencies' graph (R-graph-domain@3), for views a
 * structure creates on first use. Every dependency must belong to the same graph.
 */
export function makeNodeBeside<T>(
	deps: Node<unknown>[],
	fn: NodeFn,
	opts: NodeOptions<T>,
): Node<T> {
	const first = deps[0];
	if (first === undefined) throw new Error("node: a derived view needs a dependency");
	const n = kOf(first);
	for (const d of deps)
		if (kOf(d).kernel !== n.kernel)
			throw new Error("node: dependencies belong to different graphs; use a wire bridge");
	return withEnvironmentDrivers(n.environment, () =>
		withNodeCore(n.kernel, () => new Node<T>(deps, fn, opts), n.dispatcher),
	);
}

/**
 * @internal R-node@4: a node's current definition, its declared dependencies, its current
 * instance's function, setup and recipe (a copy, graphrefly:D823), and its policies.
 */
export function nodeDefinition(node: Node<unknown>): NodeDefinition {
	const n = kOf(node);
	return {
		deps: n.declaredDeps.map((d) => d.node),
		fn: n.fn,
		setup: n.setup ?? undefined,
		recipe: copyData(n.recipe),
		complete: n.policy.complete,
		error: n.policy.error,
		invalidate: n.invalidate,
		quiet: n.quiet,
	};
}

/**
 * @internal R-request-order@7: give a computed node a new instance with these dependencies,
 * function and, in opts, setup and recipe. A request: during a wave it waits for it.
 */
export function nodeReplace(
	node: Node<unknown>,
	deps: readonly Node<unknown>[],
	fn: NodeFn,
	opts: ReplaceOptions = {},
): void {
	const n = kOf(node);
	for (const d of deps)
		if (kOf(d).kernel !== n.kernel)
			throw new Error(
				"replace: dep belongs to a different graph; cross-graph deps require a wire bridge (R-graph-domain)",
			);
	const handle = n.dispatcher.register(fn);
	try {
		replace(n, deps.map(kOf), {
			fn,
			handle,
			...(opts.setup === undefined ? {} : { setup: opts.setup }),
			recipe: opts.recipe,
		});
	} catch (e) {
		n.dispatcher.unregister(handle);
		throw e;
	}
}

/** @internal The kernel of a node's graph. */
export function kernelOfNode(node: Node<unknown>): Kernel {
	return kOf(node).kernel;
}

/** @internal The kernel record of a node. */
export function recordOfNode(node: Node<unknown>): KNode {
	return kOf(node);
}

/**
 * A state node (R-node): a node with no dependencies and no function. Its host inputs are
 * `set`, `invalidate`, `complete` and `error` (graphrefly-ts:D175); a plain Node has none.
 *
 * @example
 * ```ts
 * import { graph } from "@graphrefly/ts/graph";
 *
 * const count = graph().state(0);
 * count.set(1);
 * ```
 * @category graph
 */
export class StateNode<T> extends Node<T> {
	/**
	 * Host input (R-request-order): write a value; one write is one wave (in a batch, one array).
	 * Given a function, computes the value from the current one when the write runs in request
	 * order, and a function that returns its argument (Object.is) writes nothing. To write a
	 * function as a value, wrap it: `set(() => fn)`.
	 */
	set(v: T | ((prev: T | undefined) => T)): void {
		hostSet(kOf(this as Node<unknown>), v);
	}

	/** Host input (R-invalidation): drop the retained value; effective only while one is held. */
	invalidate(): void {
		hostInput(kOf(this as Node<unknown>), ["INVALIDATE"], "invalidate");
	}

	/** Host input (R-terminals): end this state with COMPLETE. */
	complete(): void {
		hostInput(kOf(this as Node<unknown>), ["COMPLETE"], "complete");
	}

	/** Host input (R-terminals): end this state with ERROR carrying `error`. */
	error(error: unknown): void {
		hostInput(kOf(this as Node<unknown>), ["ERROR", error], "error");
	}
}
