/**
 * Fresh-graph checkpoint restore (D94/D95).
 *
 * Restore consumes an already-loaded strict-JSON checkpoint. It validates the whole tree,
 * constructs graph-registered topology through explicit descriptors, then performs one
 * internal runtime-state commit. No storage I/O, observe replay, public hook, or protocol
 * wave participates in this path.
 */

import type { Dispatcher } from "../dispatcher/index.js";
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
import { map, operatorNodeFn, take } from "./operators.js";
import { timer } from "./sources.js";

export interface GraphRestoreDefinition<S = never, T = unknown> {
	readonly kind: "definition";
	readonly ref: string;
	readonly fn: (v: S) => T;
}

export type GraphRestoreEntry = GraphRestoreDescriptor | GraphRestoreDefinition;

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
	resolveDefinition<S = unknown, T = unknown>(ref: string): GraphRestoreDefinition<S, T>;
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
	| ReadonlyMap<string, GraphRestoreEntry>
	| Readonly<Record<string, GraphRestoreEntry>>;

export interface RestoreGraphOptions {
	registry: GraphRestoreRegistry;
	dispatcher?: Dispatcher;
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

type TakeConfig = { n: number };
type TimerConfig = { ms: number };
type MapConfig = { fn: string };

function objectConfig(
	config: GraphCheckpointJson | undefined,
	ref: string,
): Record<string, GraphCheckpointJson> {
	if (
		config === undefined ||
		config === null ||
		Array.isArray(config) ||
		typeof config !== "object"
	) {
		throw new Error(`restoreGraph: '${ref}' descriptor requires object config`);
	}
	return config as Record<string, GraphCheckpointJson>;
}

function finiteNumber(value: GraphCheckpointJson | undefined, ref: string, key: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`restoreGraph: '${ref}' config.${key} must be a finite number`);
	}
	return value;
}

export const takeRestoreDescriptor: GraphRestoreDescriptor<TakeConfig> = {
	ref: "take",
	validateConfig(config, configVersion) {
		if (configVersion !== undefined) {
			throw new Error("restoreGraph: built-in take descriptor does not accept configVersion");
		}
		return { n: finiteNumber(objectConfig(config, "take").n, "take", "n") };
	},
	create(ctx) {
		if (ctx.deps.length !== 1) {
			throw new Error(`restoreGraph: take node '${ctx.checkpoint.id}' requires exactly one dep`);
		}
		const op = take(ctx.config.n);
		return ctx.registerNode("take", ctx.deps, operatorNodeFn(op), {
			name: ctx.name,
			meta: ctx.checkpoint.meta,
			restore: op.restore,
		});
	},
};

export const mapRestoreDescriptor: GraphRestoreDescriptor<MapConfig> = {
	ref: "map",
	validateConfig(config, configVersion) {
		if (configVersion !== undefined) {
			throw new Error("restoreGraph: built-in map descriptor does not accept configVersion");
		}
		const obj = objectConfig(config, "map");
		if (typeof obj.fn !== "string") {
			throw new Error("restoreGraph: 'map' config.fn must be a string definition ref");
		}
		return { fn: obj.fn };
	},
	create(ctx) {
		if (ctx.deps.length !== 1) {
			throw new Error(`restoreGraph: map node '${ctx.checkpoint.id}' requires exactly one dep`);
		}
		const definition = ctx.resolveDefinition(ctx.config.fn);
		const op = map(definition);
		return ctx.registerNode("map", ctx.deps, operatorNodeFn(op), {
			name: ctx.name,
			meta: ctx.checkpoint.meta,
			restore: op.restore,
		});
	},
};

export const timerRestoreDescriptor: GraphRestoreDescriptor<TimerConfig> = {
	ref: "timer",
	validateConfig(config, configVersion) {
		if (configVersion !== undefined) {
			throw new Error("restoreGraph: built-in timer descriptor does not accept configVersion");
		}
		return { ms: finiteNumber(objectConfig(config, "timer").ms, "timer", "ms") };
	},
	create(ctx) {
		if (ctx.deps.length !== 0) {
			throw new Error(`restoreGraph: timer node '${ctx.checkpoint.id}' cannot restore deps`);
		}
		const op = timer(ctx.config.ms);
		return ctx.registerNode("timer", ctx.deps, operatorNodeFn(op), {
			name: ctx.name,
			meta: ctx.checkpoint.meta,
			restore: op.restore,
			...op.opts,
		});
	},
};

export const defaultRestoreRegistry: Readonly<Record<string, GraphRestoreDescriptor>> = {
	state: stateRestoreDescriptor,
	map: mapRestoreDescriptor,
	take: takeRestoreDescriptor,
	timer: timerRestoreDescriptor,
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

function registryGet(registry: GraphRestoreRegistry, ref: string): GraphRestoreEntry | undefined {
	return registry instanceof Map
		? registry.get(ref)
		: (registry as Readonly<Record<string, GraphRestoreEntry>>)[ref];
}

function isRestoreDescriptor(
	entry: GraphRestoreEntry | undefined,
): entry is GraphRestoreDescriptor {
	return entry !== undefined && "create" in entry;
}

function isRestoreDefinition(
	entry: GraphRestoreEntry | undefined,
): entry is GraphRestoreDefinition {
	return entry !== undefined && "kind" in entry && entry.kind === "definition";
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
	const entry = registryGet(registry, ref);
	if (!isRestoreDescriptor(entry)) {
		throw new Error(`restoreGraph: missing registry descriptor for '${ref}' (node '${id}')`);
	}
	const descriptor = entry;
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

function resolveDefinition<S, T>(
	registry: GraphRestoreRegistry,
	ref: string,
	nodeId: string,
): GraphRestoreDefinition<S, T> {
	const entry = registryGet(registry, ref);
	if (!isRestoreDefinition(entry)) {
		throw new Error(`restoreGraph: missing function definition for '${ref}' (node '${nodeId}')`);
	}
	return entry as GraphRestoreDefinition<S, T>;
}

function prepareCheckpoint(
	checkpoint: GraphCheckpoint,
	registry: GraphRestoreRegistry,
	path = "checkpoint",
	mountAt?: string,
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
		if (mountAt !== undefined && node.id.startsWith(`${mountAt}::`)) {
			throw new Error(
				`restoreGraph: mounted checkpoint at '${mountAt}' must use child-local node id '${node.id.slice(`${mountAt}::`.length)}', not '${node.id}'`,
			);
		}
		const id = node.id;
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
			prepared: prepareCheckpoint(mount.checkpoint, registry, `${path}.mounts.${at}`, at),
		});
	}
	return { checkpoint, nodes, mounts };
}

function constructPrepared(
	prepared: PreparedCheckpoint,
	registry: GraphRestoreRegistry,
	dispatcher?: Dispatcher,
): Graph {
	const out = graph({ name: prepared.checkpoint.name, dispatcher });
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
			resolveDefinition: (ref) => resolveDefinition(registry, ref, item.checkpoint.id),
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
		out.mount(constructPrepared(mount.prepared, registry, dispatcher), {
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
	if (options == null || options.registry === undefined) {
		throw new Error("restoreGraph: registry is required");
	}
	if (
		!(options.registry instanceof Map) &&
		(typeof options.registry !== "object" || options.registry === null)
	) {
		throw new Error("restoreGraph: registry must be a Map or object");
	}
	for (const key of Object.keys(options)) {
		if (key !== "registry" && key !== "dispatcher") {
			throw new Error(`restoreGraph: unknown option '${key}'`);
		}
	}
	const prepared = prepareCheckpoint(checkpoint, options.registry);
	return constructPrepared(prepared, options.registry, options.dispatcher);
}
