/**
 * Fresh-graph checkpoint restore (D94/D95).
 *
 * Restore consumes an already-loaded strict-JSON checkpoint. It validates the whole tree,
 * constructs graph-registered topology through explicit descriptors, then performs one
 * internal runtime-state commit. No storage I/O, observe replay, public hook, or protocol
 * wave participates in this path.
 */

import type { Node } from "../node/node.js";
import { restoreStateOfNode, type Status } from "../node/node.js";
import { SENTINEL } from "../protocol/messages.js";
import {
	GRAPH_CHECKPOINT_VERSION,
	type GraphCheckpoint,
	type GraphCheckpointFactory,
	type GraphCheckpointJson,
	type GraphCheckpointNode,
	type GraphCheckpointTerminal,
	type GraphCheckpointValue,
	toCheckpointJson,
} from "./checkpoint.js";
import {
	type Graph,
	graph,
	restoreNodeInGraph,
	restoreStateNodeInGraph,
	type SugarOpts,
} from "./graph.js";

export interface GraphRestoreDescriptorContext<
	C extends GraphCheckpointJson | undefined = GraphCheckpointJson | undefined,
> {
	readonly graph: Graph;
	readonly id: string;
	readonly name?: string;
	readonly deps: readonly Node<unknown>[];
	readonly config: C;
	readonly configVersion?: GraphCheckpointJson;
	readonly checkpoint: GraphCheckpointNode;
	registerState<T = unknown>(opts?: SugarOpts<T>): Node<unknown>;
	registerNode<T = unknown>(
		factory: string,
		deps: readonly Node<unknown>[],
		fn: import("../ctx/types.js").NodeFn | null,
		opts?: SugarOpts<T>,
	): Node<unknown>;
}

export interface GraphRestoreDescriptor<
	C extends GraphCheckpointJson | undefined = GraphCheckpointJson | undefined,
> {
	readonly ref: string;
	validateConfig?(
		config: GraphCheckpointJson | undefined,
		configVersion: GraphCheckpointJson | undefined,
		checkpoint: GraphCheckpointNode,
	): C;
	create(ctx: GraphRestoreDescriptorContext<C>): Node<unknown>;
}

export type GraphRestoreRegistry =
	| ReadonlyMap<string, GraphRestoreDescriptor>
	| Readonly<Record<string, GraphRestoreDescriptor>>;

export interface RestoreGraphOptions {
	registry: GraphRestoreRegistry;
	graph?: Graph;
}

export const stateRestoreDescriptor: GraphRestoreDescriptor<undefined> = {
	ref: "state",
	validateConfig(config, configVersion) {
		if (config !== undefined || configVersion !== undefined) {
			throw new Error("restoreGraph: built-in state descriptor does not accept config");
		}
		return undefined;
	},
	create(ctx) {
		if (ctx.deps.length !== 0) {
			throw new Error(`restoreGraph: state node '${ctx.checkpoint.id}' cannot restore deps`);
		}
		return ctx.registerState({
			name: ctx.name,
			meta: ctx.checkpoint.meta,
		});
	},
};

export const defaultRestoreRegistry: Readonly<Record<string, GraphRestoreDescriptor>> = {
	state: stateRestoreDescriptor,
};

type PreparedNode = {
	checkpoint: GraphCheckpointNode;
	localId: string;
	descriptor: GraphRestoreDescriptor;
	config: GraphCheckpointJson | undefined;
	deps: string[];
	runtime: PreparedRuntime;
};

type PreparedCheckpoint = {
	checkpoint: GraphCheckpoint;
	nodes: Map<string, PreparedNode>;
	mounts: Array<{ at: string; prepared: PreparedCheckpoint }>;
};

type PreparedRuntime = {
	cache: unknown;
	hasData: boolean;
	status: Status;
	terminal: true | unknown | undefined;
	hasCalledFnOnce: boolean;
	ctxState: { value: unknown; persist: boolean };
};

function registryGet(
	registry: GraphRestoreRegistry,
	ref: string,
): GraphRestoreDescriptor | undefined {
	return registry instanceof Map
		? registry.get(ref)
		: (registry as Readonly<Record<string, GraphRestoreDescriptor>>)[ref];
}

function assertString(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`restoreGraph: ${label} must be a string`);
	return value;
}

function assertStatus(value: string, id: string): Status {
	if (
		value !== "sentinel" &&
		value !== "pending" &&
		value !== "dirty" &&
		value !== "settled" &&
		value !== "resolved" &&
		value !== "completed" &&
		value !== "errored"
	) {
		throw new Error(`restoreGraph: node '${id}' has invalid status '${value}'`);
	}
	return value;
}

function localId(id: string, stripPrefix: string): string {
	if (stripPrefix !== "") {
		if (!id.startsWith(stripPrefix)) {
			throw new Error(`restoreGraph: mounted node id '${id}' is missing prefix '${stripPrefix}'`);
		}
		return id.slice(stripPrefix.length);
	}
	return id;
}

function checkpointDataValue(
	value: GraphCheckpointValue,
	id: string,
): {
	cache: unknown;
	hasData: boolean;
} {
	if (value.kind === "SENTINEL") return { cache: SENTINEL, hasData: false };
	if (value.kind === "DATA") return { cache: value.data, hasData: true };
	throw new Error(`restoreGraph: node '${id}' has invalid checkpoint value`);
}

function checkpointTerminal(
	value: GraphCheckpointTerminal,
	id: string,
): true | unknown | undefined {
	if (value.kind === "none") return undefined;
	if (value.kind === "COMPLETE") return true;
	if (value.kind === "ERROR") return value.error;
	throw new Error(`restoreGraph: node '${id}' has invalid terminal state`);
}

function prepareRuntime(node: GraphCheckpointNode): PreparedRuntime {
	const value = checkpointDataValue(node.value, node.id);
	const terminal = checkpointTerminal(node.terminal, node.id);
	const status = assertStatus(node.status, node.id);
	if (terminal === true && status !== "completed") {
		throw new Error(`restoreGraph: node '${node.id}' COMPLETE terminal requires completed status`);
	}
	if (terminal !== undefined && terminal !== true && status !== "errored") {
		throw new Error(`restoreGraph: node '${node.id}' ERROR terminal requires errored status`);
	}
	if (terminal === undefined && (status === "completed" || status === "errored")) {
		throw new Error(`restoreGraph: node '${node.id}' terminal status requires terminal state`);
	}
	if (typeof node.lifecycle.activated !== "boolean") {
		throw new Error(`restoreGraph: node '${node.id}' lifecycle.activated must be boolean`);
	}
	if (typeof node.lifecycle.hasCalledFnOnce !== "boolean") {
		throw new Error(`restoreGraph: node '${node.id}' lifecycle.hasCalledFnOnce must be boolean`);
	}
	if (typeof node.ctxState.persist !== "boolean") {
		throw new Error(`restoreGraph: node '${node.id}' ctxState.persist must be boolean`);
	}
	const ctxState = checkpointDataValue(node.ctxState.value, `${node.id}.ctxState`);
	return {
		cache: value.cache,
		hasData: value.hasData,
		status,
		terminal,
		hasCalledFnOnce: node.lifecycle.hasCalledFnOnce,
		ctxState: { value: ctxState.cache, persist: node.ctxState.persist },
	};
}

function validateFactory(
	factory: GraphCheckpointFactory,
	registry: GraphRestoreRegistry,
	id: string,
): GraphRestoreDescriptor {
	if (factory.kind === "local-only") {
		throw new Error(
			`restoreGraph: node '${id}' uses local-only factory '${factory.name}' (${factory.reason})`,
		);
	}
	const ref = assertString(factory.ref, `factory ref for node '${id}'`);
	const descriptor = registryGet(registry, ref);
	if (descriptor === undefined) {
		throw new Error(`restoreGraph: missing registry descriptor for '${ref}' (node '${id}')`);
	}
	if (descriptor.ref !== ref) {
		throw new Error(
			`restoreGraph: registry descriptor for '${ref}' reports ref '${descriptor.ref}'`,
		);
	}
	if (factory.config !== undefined) toCheckpointJson(factory.config, `${id}.factory.config`);
	if (factory.configVersion !== undefined)
		toCheckpointJson(factory.configVersion, `${id}.factory.configVersion`);
	return descriptor;
}

function prepareCheckpoint(
	checkpoint: GraphCheckpoint,
	registry: GraphRestoreRegistry,
	stripPrefix = "",
	path = "checkpoint",
): PreparedCheckpoint {
	if (checkpoint.version !== GRAPH_CHECKPOINT_VERSION) {
		throw new Error(`restoreGraph: unsupported checkpoint version at ${path}`);
	}
	toCheckpointJson(checkpoint, path);
	const nodes = new Map<string, PreparedNode>();
	const localIds = new Set<string>();
	for (const node of checkpoint.nodes) {
		assertString(node.id, `${path}.nodes[].id`);
		if (nodes.has(node.id)) throw new Error(`restoreGraph: duplicate node id '${node.id}'`);
		const id = localId(node.id, stripPrefix);
		if (localIds.has(id)) {
			throw new Error(`restoreGraph: duplicate restored local node id '${id}'`);
		}
		localIds.add(id);
		const factory = node.factory;
		const descriptor = validateFactory(factory, registry, node.id);
		const rawConfig = factory.kind === "registry-ref" ? factory.config : undefined;
		const configVersion = factory.kind === "registry-ref" ? factory.configVersion : undefined;
		const config = descriptor.validateConfig
			? descriptor.validateConfig(rawConfig, configVersion, node)
			: rawConfig;
		assertStatus(node.status, node.id);
		nodes.set(node.id, {
			checkpoint: node,
			localId: id,
			descriptor,
			config,
			runtime: prepareRuntime(node),
			deps: node.deps.map((dep, i) => assertString(dep, `${node.id}.deps[${i}]`)),
		});
	}
	for (const prepared of nodes.values()) {
		for (const dep of prepared.deps) {
			if (!nodes.has(dep)) {
				throw new Error(`restoreGraph: node '${prepared.checkpoint.id}' has missing dep '${dep}'`);
			}
		}
	}
	for (const edge of checkpoint.edges) {
		if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
			throw new Error(
				`restoreGraph: edge '${edge.from}' -> '${edge.to}' references a missing node`,
			);
		}
		const target = nodes.get(edge.to) as PreparedNode;
		if (!target.deps.includes(edge.from)) {
			throw new Error(
				`restoreGraph: edge '${edge.from}' -> '${edge.to}' is not present in target deps`,
			);
		}
	}
	const edgeKeys = new Set(checkpoint.edges.map((edge) => `${edge.from}\u0000${edge.to}`));
	for (const prepared of nodes.values()) {
		for (const dep of prepared.deps) {
			if (!edgeKeys.has(`${dep}\u0000${prepared.checkpoint.id}`)) {
				throw new Error(
					`restoreGraph: node '${prepared.checkpoint.id}' dep '${dep}' is missing its edge`,
				);
			}
		}
	}
	const mountPaths = new Set<string>();
	const mounts: PreparedCheckpoint["mounts"] = [];
	for (const mount of checkpoint.mounts ?? []) {
		const at = assertString(mount.at, `${path}.mounts[].at`);
		if (mountPaths.has(at)) throw new Error(`restoreGraph: duplicate mount path '${at}'`);
		mountPaths.add(at);
		mounts.push({
			at,
			prepared: prepareCheckpoint(
				mount.checkpoint,
				registry,
				`${stripPrefix}${at}::`,
				`${path}.mounts.${at}`,
			),
		});
	}
	return { checkpoint, nodes, mounts };
}

function constructPrepared(
	prepared: PreparedCheckpoint,
	registry: GraphRestoreRegistry,
	stripPrefix = "",
): Graph {
	const out = graph({ name: prepared.checkpoint.name });
	const built = new Map<string, Node<unknown>>();
	const visiting = new Set<string>();

	const buildNode = (id: string): Node<unknown> => {
		const existing = built.get(id);
		if (existing) return existing;
		const item = prepared.nodes.get(id);
		if (item === undefined) throw new Error(`restoreGraph: missing prepared node '${id}'`);
		if (visiting.has(id)) throw new Error(`restoreGraph: dependency cycle at '${id}'`);
		visiting.add(id);
		const deps = item.deps.map(buildNode);
		const node = item.descriptor.create({
			graph: out,
			id: item.localId,
			name: item.checkpoint.name,
			deps,
			config: item.config,
			configVersion:
				item.checkpoint.factory.kind === "registry-ref"
					? item.checkpoint.factory.configVersion
					: undefined,
			checkpoint: item.checkpoint,
			registerState: (opts) => restoreStateNodeInGraph(out, item.localId, opts),
			registerNode: (factory, nodeDeps, fn, opts) =>
				restoreNodeInGraph(out, item.localId, factory, nodeDeps, fn, opts),
		});
		if (out.find(item.localId) !== node) {
			throw new Error(
				`restoreGraph: descriptor '${item.descriptor.ref}' did not register node '${item.localId}'`,
			);
		}
		if (node.deps.length !== deps.length || node.deps.some((dep, i) => dep !== deps[i])) {
			throw new Error(
				`restoreGraph: descriptor '${item.descriptor.ref}' registered node '${item.localId}' with deps that do not match the checkpoint`,
			);
		}
		built.set(id, node);
		visiting.delete(id);
		return node;
	};

	for (const id of prepared.nodes.keys()) buildNode(id);

	for (const mount of prepared.mounts) {
		out.mount(constructPrepared(mount.prepared, registry, `${stripPrefix}${mount.at}::`), {
			at: mount.at,
		});
	}

	for (const [id, node] of built) {
		const runtime = (prepared.nodes.get(id) as PreparedNode).runtime;
		restoreStateOfNode(node, {
			cache: runtime.cache,
			hasData: runtime.hasData,
			status: runtime.status,
			terminal: runtime.terminal,
			hasCalledFnOnce: runtime.hasCalledFnOnce,
			ctxState: runtime.ctxState,
		});
	}

	return out;
}

export function restoreGraph(checkpoint: GraphCheckpoint, options: RestoreGraphOptions): Graph {
	if (options.graph !== undefined) {
		throw new Error(
			"restoreGraph: live graph restore is deferred; pass no graph option for fresh restore",
		);
	}
	const prepared = prepareCheckpoint(checkpoint, options.registry);
	return constructPrepared(prepared, options.registry);
}
