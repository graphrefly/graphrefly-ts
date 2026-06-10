/**
 * Fresh-graph checkpoint restore (D94/D95).
 *
 * Restore consumes an already-loaded strict-JSON checkpoint. It validates the whole tree,
 * constructs graph-registered topology through explicit descriptors, then performs one
 * internal runtime-state commit. No storage I/O, observe replay, public hook, or protocol
 * wave participates in this path.
 */

import type { Dispatcher } from "../dispatcher/index.js";
import { strictCanonicalJsonBytes } from "../json/codec.js";
import type { Node } from "../node/node.js";
import { restoreStateOfNode, type Status } from "../node/node.js";
import {
	type NodeVersioningPolicy,
	type NodeVersionJson,
	validateNodeVersionJson,
} from "../node/versioning.js";
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
import type { IndexRow, ReactiveIndex } from "./data-structures/reactive-index.js";
import { restoreReactiveIndexFromBackendState } from "./data-structures/reactive-index.js";
import { type ReactiveList, reactiveList } from "./data-structures/reactive-list.js";
import { type ReactiveLog, reactiveLog } from "./data-structures/reactive-log.js";
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
	versioning?: NodeVersioningPolicy;
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
type LogConfig = { maxSize?: number };

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

type RestoredCollection =
	| { kind: "reactiveList"; collection: ReactiveList<unknown> }
	| { kind: "reactiveIndex"; collection: ReactiveIndex<unknown, unknown> }
	| { kind: "reactiveLog"; collection: ReactiveLog<unknown> };

const restoredCollections = new WeakMap<Graph, Map<string, RestoredCollection>>();

function restoredCollectionMap(graph: Graph): Map<string, RestoredCollection> {
	let map = restoredCollections.get(graph);
	if (map === undefined) {
		map = new Map();
		restoredCollections.set(graph, map);
	}
	return map;
}

function clearRestoredCollectionMap(graph: Graph): void {
	restoredCollections.delete(graph);
}

function collectionBaseId(id: string, suffix: ".delta" | ".snapshot", ref: string): string {
	if (!id.endsWith(suffix)) {
		throw new Error(`restoreGraph: '${ref}' node '${id}' must end with '${suffix}'`);
	}
	const base = id.slice(0, -suffix.length);
	if (base.length === 0) {
		throw new Error(`restoreGraph: '${ref}' node '${id}' has no collection name`);
	}
	return base;
}

function noCollectionConfig(
	config: GraphCheckpointJson | undefined,
	configVersion: GraphCheckpointJson | undefined,
	ref: string,
): undefined {
	if (config !== undefined || configVersion !== undefined) {
		throw new Error(`restoreGraph: '${ref}' descriptor does not accept config`);
	}
	return undefined;
}

function backendArray(
	checkpoint: GraphCheckpointNode,
	ref: string,
): readonly GraphCheckpointJson[] {
	const state = checkpoint.backendState;
	if (!Array.isArray(state)) {
		throw new Error(`restoreGraph: '${ref}' node '${checkpoint.id}' requires array backendState`);
	}
	return state;
}

function checkpointJsonEquals(a: unknown, b: unknown): boolean {
	const aBytes = strictCanonicalJsonBytes(a);
	const bBytes = strictCanonicalJsonBytes(b);
	if (aBytes.byteLength !== bBytes.byteLength) return false;
	for (let i = 0; i < aBytes.byteLength; i += 1) {
		if (aBytes[i] !== bBytes[i]) return false;
	}
	return true;
}

function primitiveJsonKey(
	value: GraphCheckpointJson,
	path: string,
): string | number | boolean | null {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	throw new Error(`restoreGraph: ${path} must be a JSON primitive primary key`);
}

function indexRows(
	checkpoint: GraphCheckpointNode,
	ref: string,
): readonly IndexRow<unknown, unknown>[] {
	const rows: IndexRow<unknown, unknown>[] = [];
	const seen = new Set<string>();
	for (const [i, row] of backendArray(checkpoint, ref).entries()) {
		const path = `${checkpoint.id}.backendState[${i}]`;
		if (row === null || Array.isArray(row) || typeof row !== "object") {
			throw new Error(`restoreGraph: ${path} must be an index row object`);
		}
		if (
			!Object.hasOwn(row, "primary") ||
			!Object.hasOwn(row, "secondary") ||
			!Object.hasOwn(row, "value")
		) {
			throw new Error(`restoreGraph: ${path} must contain primary, secondary, and value`);
		}
		const obj = row as Record<string, GraphCheckpointJson>;
		const primary = primitiveJsonKey(obj.primary as GraphCheckpointJson, `${path}.primary`);
		const stablePrimary = JSON.stringify(primary);
		if (seen.has(stablePrimary)) {
			throw new Error(`restoreGraph: ${path}.primary duplicates an earlier index row`);
		}
		seen.add(stablePrimary);
		rows.push({
			primary,
			secondary: obj.secondary,
			value: obj.value,
		});
	}
	return rows;
}

function restoredList(ctx: GraphRestoreDescriptorContext, ref: string): ReactiveList<unknown> {
	const base = collectionBaseId(ctx.id, ".delta", ref);
	if (ctx.deps.length !== 0) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' cannot restore deps`);
	}
	const collection = reactiveList(backendArray(ctx.checkpoint, ref), {
		graph: ctx.graph,
		name: base,
	});
	restoredCollectionMap(ctx.graph).set(base, { kind: "reactiveList", collection });
	return collection;
}

function restoredIndex(ctx: GraphRestoreDescriptorContext, ref: string): ReactiveIndex<unknown> {
	const base = collectionBaseId(ctx.id, ".delta", ref);
	if (ctx.deps.length !== 0) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' cannot restore deps`);
	}
	const rows = indexRows(ctx.checkpoint, ref);
	const collection = restoreReactiveIndexFromBackendState(rows, {
		graph: ctx.graph,
		name: base,
	});
	restoredCollectionMap(ctx.graph).set(base, { kind: "reactiveIndex", collection });
	return collection;
}

function restoredLog(
	ctx: GraphRestoreDescriptorContext<LogConfig>,
	ref: string,
): ReactiveLog<unknown> {
	const base = collectionBaseId(ctx.id, ".delta", ref);
	if (ctx.deps.length !== 0) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' cannot restore deps`);
	}
	const state = backendArray(ctx.checkpoint, ref);
	if (ctx.config.maxSize !== undefined && state.length > ctx.config.maxSize) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' backendState exceeds config.maxSize`);
	}
	const collection = reactiveLog(state, {
		graph: ctx.graph,
		name: base,
		...(ctx.config.maxSize !== undefined ? { maxSize: ctx.config.maxSize } : {}),
	});
	restoredCollectionMap(ctx.graph).set(base, { kind: "reactiveLog", collection });
	return collection;
}

function existingCollection(
	ctx: GraphRestoreDescriptorContext,
	ref: string,
	kind: RestoredCollection["kind"],
): RestoredCollection {
	const base = collectionBaseId(ctx.id, ".snapshot", ref);
	if (ctx.deps.length !== 1) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' requires exactly one dep`);
	}
	const item = restoredCollectionMap(ctx.graph).get(base);
	if (item === undefined || item.kind !== kind) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' is missing restored '${base}.delta'`);
	}
	return item;
}

function validateLogConfig(
	config: GraphCheckpointJson | undefined,
	configVersion: GraphCheckpointJson | undefined,
	ref: string,
): LogConfig {
	if (configVersion !== undefined) {
		throw new Error(`restoreGraph: '${ref}' descriptor does not accept configVersion`);
	}
	if (config === undefined) return {};
	const obj = objectConfig(config, ref);
	if (obj.maxSize === undefined) return {};
	const maxSize = finiteNumber(obj.maxSize, ref, "maxSize");
	if (!Number.isInteger(maxSize) || maxSize < 1) {
		throw new Error(`restoreGraph: '${ref}' config.maxSize must be a positive integer`);
	}
	return { maxSize };
}

export const reactiveListDeltaRestoreDescriptor: GraphRestoreDescriptor<undefined> = {
	ref: "reactiveList.delta",
	validateConfig(config, configVersion) {
		return noCollectionConfig(config, configVersion, "reactiveList.delta");
	},
	create(ctx) {
		return restoredList(ctx, "reactiveList.delta").delta as Node<unknown>;
	},
};

export const reactiveListSnapshotRestoreDescriptor: GraphRestoreDescriptor<undefined> = {
	ref: "reactiveList.snapshot",
	validateConfig(config, configVersion) {
		return noCollectionConfig(config, configVersion, "reactiveList.snapshot");
	},
	create(ctx) {
		return existingCollection(ctx, "reactiveList.snapshot", "reactiveList").collection
			.snapshot as Node<unknown>;
	},
};

export const reactiveIndexDeltaRestoreDescriptor: GraphRestoreDescriptor<undefined> = {
	ref: "reactiveIndex.delta",
	validateConfig(config, configVersion) {
		return noCollectionConfig(config, configVersion, "reactiveIndex.delta");
	},
	create(ctx) {
		return restoredIndex(ctx, "reactiveIndex.delta").delta as Node<unknown>;
	},
};

export const reactiveIndexSnapshotRestoreDescriptor: GraphRestoreDescriptor<undefined> = {
	ref: "reactiveIndex.snapshot",
	validateConfig(config, configVersion) {
		return noCollectionConfig(config, configVersion, "reactiveIndex.snapshot");
	},
	create(ctx) {
		return existingCollection(ctx, "reactiveIndex.snapshot", "reactiveIndex").collection
			.snapshot as Node<unknown>;
	},
};

export const reactiveLogDeltaRestoreDescriptor: GraphRestoreDescriptor<LogConfig> = {
	ref: "reactiveLog.delta",
	validateConfig(config, configVersion) {
		return validateLogConfig(config, configVersion, "reactiveLog.delta");
	},
	create(ctx) {
		return restoredLog(ctx, "reactiveLog.delta").delta as Node<unknown>;
	},
};

export const reactiveLogSnapshotRestoreDescriptor: GraphRestoreDescriptor<LogConfig> = {
	ref: "reactiveLog.snapshot",
	validateConfig(config, configVersion) {
		return validateLogConfig(config, configVersion, "reactiveLog.snapshot");
	},
	create(ctx) {
		return existingCollection(ctx, "reactiveLog.snapshot", "reactiveLog").collection
			.snapshot as Node<unknown>;
	},
};

export const defaultRestoreRegistry: Readonly<Record<string, GraphRestoreDescriptor>> = {
	state: stateRestoreDescriptor,
	map: mapRestoreDescriptor,
	take: takeRestoreDescriptor,
	timer: timerRestoreDescriptor,
	"reactiveList.delta": reactiveListDeltaRestoreDescriptor,
	"reactiveList.snapshot": reactiveListSnapshotRestoreDescriptor,
	"reactiveIndex.delta": reactiveIndexDeltaRestoreDescriptor,
	"reactiveIndex.snapshot": reactiveIndexSnapshotRestoreDescriptor,
	"reactiveLog.delta": reactiveLogDeltaRestoreDescriptor,
	"reactiveLog.snapshot": reactiveLogSnapshotRestoreDescriptor,
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
	version: NodeVersionJson | false;
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
	if (value === "pending" || value === "dirty") {
		throw new Error(
			`restoreGraph: node '${id}' has non-quiescent status '${value}' that cannot be checkpoint-restored yet`,
		);
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
	const version =
		node.version === undefined
			? false
			: validateNodeVersionJson(node.version, `${node.id}.version`);
	return {
		cache: value.cache,
		hasData: value.hasData,
		status,
		terminal,
		hasCalledFnOnce: node.lifecycle.hasCalledFnOnce,
		ctxState: { value: ctxState.cache, persist: node.ctxState.persist },
		version,
	};
}

function collectionDeltaRefForSnapshotRef(ref: string): string | undefined {
	if (ref === "reactiveList.snapshot") return "reactiveList.delta";
	if (ref === "reactiveIndex.snapshot") return "reactiveIndex.delta";
	if (ref === "reactiveLog.snapshot") return "reactiveLog.delta";
	return undefined;
}

function isCollectionSnapshotPort(node: GraphCheckpointNode): string | undefined {
	if (node.factory.kind !== "registry-ref") return undefined;
	return collectionDeltaRefForSnapshotRef(node.factory.ref);
}

function validateCollectionSnapshotCaches(nodes: ReadonlyMap<string, PreparedNode>): void {
	for (const item of nodes.values()) {
		const deltaRef = isCollectionSnapshotPort(item.checkpoint);
		if (deltaRef === undefined || item.checkpoint.value.kind !== "DATA") continue;
		if (item.deps.length !== 1) {
			throw new Error(
				`restoreGraph: '${item.descriptor.ref}' node '${item.checkpoint.id}' requires exactly one dep`,
			);
		}
		const delta = nodes.get(item.deps[0]);
		if (delta === undefined || delta.checkpoint.factory.kind !== "registry-ref") continue;
		if (delta.checkpoint.factory.ref !== deltaRef) {
			throw new Error(
				`restoreGraph: '${item.descriptor.ref}' node '${item.checkpoint.id}' dep must be '${deltaRef}'`,
			);
		}
		const backendState = backendArray(delta.checkpoint, deltaRef);
		if (!checkpointJsonEquals(item.checkpoint.value.data, backendState)) {
			throw new Error(
				`restoreGraph: collection snapshot '${item.checkpoint.id}' cache conflicts with '${delta.checkpoint.id}.backendState' (D160)`,
			);
		}
	}
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
	const edgeKeys = new Set<string>();
	for (const edge of checkpoint.edges) {
		const edgeKey = `${edge.from}\u0000${edge.to}`;
		if (edgeKeys.has(edgeKey)) {
			throw new Error(`restoreGraph: duplicate edge '${edge.from}' -> '${edge.to}'`);
		}
		edgeKeys.add(edgeKey);
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
	for (const prepared of nodes.values()) {
		for (const dep of prepared.deps) {
			if (!edgeKeys.has(`${dep}\u0000${prepared.checkpoint.id}`)) {
				throw new Error(
					`restoreGraph: node '${prepared.checkpoint.id}' dep '${dep}' is missing its edge`,
				);
			}
		}
	}
	validateCollectionSnapshotCaches(nodes);
	const mountPaths = new Set<string>();
	const mounts: PreparedCheckpoint["mounts"] = [];
	for (const mount of checkpoint.mounts ?? []) {
		const at = assertString(mount.at, `${path}.mounts[].at`);
		if (at.length === 0) throw new Error("restoreGraph: mount path must not be empty");
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
	versioning?: NodeVersioningPolicy,
): Graph {
	const out = graph({ name: prepared.checkpoint.name, dispatcher, versioning });
	try {
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
			out.mount(constructPrepared(mount.prepared, registry, dispatcher, versioning), {
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
				version: runtime.version,
			});
		}
	} finally {
		clearRestoredCollectionMap(out);
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
		if (key !== "registry" && key !== "dispatcher" && key !== "versioning") {
			throw new Error(`restoreGraph: unknown option '${key}'`);
		}
	}
	const prepared = prepareCheckpoint(checkpoint, options.registry);
	return constructPrepared(prepared, options.registry, options.dispatcher, options.versioning);
}
