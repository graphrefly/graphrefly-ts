/**
 * Checkpoint restore (R-checkpoint@1, graphrefly:D802; TS layout graphrefly-ts:D178).
 *
 * Restore builds a new graph from a strict-JSON checkpoint: no subscribers, each node after its
 * declared dependencies and otherwise in checkpoint order, and no recipe function runs. A state
 * gets its saved values as one array and then its terminal; a computed node gets its values,
 * terminal, private state, lifetime dependencies and the record of what it received as a
 * construction seed (R-subscription). Its first activation runs its setup, and runs its function
 * once only if a dependency no longer holds what it had received. No storage I/O.
 */

import type { NodeFn } from "../ctx/types.js";
import type { Dispatcher } from "../dispatcher/index.js";
import { strictCanonicalJsonBytes } from "../json/codec.js";
import type { Node } from "../node/node.js";
import { nodeRuntimeHost } from "../node/node-runtime-host.js";
import { restoreStateOfNode } from "../node/runtime-accessors.js";
import type { NodeOptions, NodeReceived } from "../node/types.js";
import type { NodeVersioningPolicy } from "../node/versioning.js";
import { SENTINEL } from "../protocol/messages.js";
import {
	GRAPH_CHECKPOINT_FORMAT,
	type GraphCheckpoint,
	type GraphCheckpointJson,
	type GraphCheckpointNode,
	type GraphCheckpointPolicies,
	type GraphCheckpointRecipe,
	type GraphCheckpointTerminal,
	toCheckpointJson,
} from "./checkpoint.js";
import type { IndexRow, ReactiveIndex } from "./data-structures/reactive-index.js";
import { restoreReactiveIndexFromBackendState } from "./data-structures/reactive-index.js";
import { type ReactiveList, reactiveList } from "./data-structures/reactive-list.js";
import { type ReactiveLog, reactiveLog } from "./data-structures/reactive-log.js";
import {
	type ReactiveMap,
	restoreReactiveMapFromBackendState,
} from "./data-structures/reactive-map.js";
import { type Graph, graph, restoreNodeInGraph, restoreStateNodeInGraph } from "./graph.js";
import { map, operatorNodeFn, take } from "./operators.js";
import { timer } from "./sources.js";

/** A registered named function, for a recipe whose configuration names one (TS: map). */
export interface GraphRestoreDefinition<S = never, T = unknown> {
	readonly kind: "definition";
	readonly ref: string;
	readonly fn: (v: S) => T;
}

/** What a recipe factory gives: the instance's function and any setup (R-checkpoint). */
export interface GraphRecipeBuild {
	readonly fn: NodeFn;
	readonly setup?: NodeOptions["setup"];
}

/** What a recipe factory is given besides its configuration (R-checkpoint). */
export interface GraphRecipeContext {
	/** The graph being restored. */
	readonly graph: Graph;
	/** The node's id. */
	readonly id: string;
	/** Build another registered recipe, for a recipe that takes another by reference. */
	make(recipe: GraphCheckpointRecipe): GraphRecipeBuild;
	/** A registered named function. */
	definition<S = unknown, T = unknown>(ref: string): GraphRestoreDefinition<S, T>;
}

/** A registered recipe factory: given its configuration, it gives the function and setup. */
export interface GraphRecipeFactory<C = GraphCheckpointJson | undefined> {
	readonly ref: string;
	validateConfig?(config: GraphCheckpointJson | undefined): C;
	build(config: C, ctx: GraphRecipeContext): GraphRecipeBuild;
}

/** What a restore extension is given (graphrefly-ts:D178). */
export interface GraphRestoreExtensionContext<C = GraphCheckpointJson | undefined> {
	readonly graph: Graph;
	readonly id: string;
	readonly name?: string;
	readonly deps: readonly Node<unknown>[];
	readonly config: C;
	readonly checkpoint: GraphCheckpointNode;
}

/**
 * TS package extension (graphrefly-ts:D178): rebuilds a collection's nodes from the collection's
 * saved backend (`backendState`), registering them itself. The checkpoint rule leaves a
 * collection's backend to the package.
 */
export interface GraphRestoreExtension<C = GraphCheckpointJson | undefined> {
	readonly ref: string;
	validateConfig?(config: GraphCheckpointJson | undefined, checkpoint: GraphCheckpointNode): C;
	create(ctx: GraphRestoreExtensionContext<C>): Node<unknown>;
}

export type GraphRestoreEntry =
	| GraphRecipeFactory<any>
	| GraphRestoreExtension<any>
	| GraphRestoreDefinition<any, any>;

export type GraphRestoreRegistry =
	| ReadonlyMap<string, GraphRestoreEntry>
	| Readonly<Record<string, GraphRestoreEntry>>;

export interface RestoreGraphOptions {
	registry: GraphRestoreRegistry;
	dispatcher?: Dispatcher;
	versioning?: NodeVersioningPolicy;
}

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
		throw new Error(`restoreGraph: '${ref}' recipe requires an object config`);
	}
	return config as Record<string, GraphCheckpointJson>;
}

function finiteNumber(value: GraphCheckpointJson | undefined, ref: string, key: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`restoreGraph: '${ref}' config.${key} must be a finite number`);
	}
	return value;
}

export const takeRestoreDescriptor: GraphRecipeFactory<TakeConfig> = {
	ref: "take",
	validateConfig(config) {
		return { n: finiteNumber(objectConfig(config, "take").n, "take", "n") };
	},
	build(config) {
		return { fn: operatorNodeFn(take(config.n)) };
	},
};

export const mapRestoreDescriptor: GraphRecipeFactory<MapConfig> = {
	ref: "map",
	validateConfig(config) {
		const obj = objectConfig(config, "map");
		if (typeof obj.fn !== "string") {
			throw new Error("restoreGraph: 'map' config.fn must be a string definition ref");
		}
		return { fn: obj.fn };
	},
	build(config, ctx) {
		return { fn: operatorNodeFn(map(ctx.definition(config.fn))) };
	},
};

export const timerRestoreDescriptor: GraphRecipeFactory<TimerConfig> = {
	ref: "timer",
	validateConfig(config) {
		return { ms: finiteNumber(objectConfig(config, "timer").ms, "timer", "ms") };
	},
	build(config) {
		// The timer is opened by the setup, which runs at the restored node's first activation.
		const op = timer(config.ms);
		return { fn: operatorNodeFn(op), setup: op.opts?.setup };
	},
};

type RestoredCollection =
	| { kind: "reactiveList"; collection: ReactiveList<unknown> }
	| { kind: "reactiveIndex"; collection: ReactiveIndex<unknown, unknown> }
	| { kind: "reactiveLog"; collection: ReactiveLog<unknown> }
	| { kind: "reactiveMap"; collection: ReactiveMap<unknown, unknown> };

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

function collectionBaseId(
	id: string,
	suffix: ".intent" | ".apply" | ".snapshotPrep" | ".delta" | ".snapshot" | ".request",
	ref: string,
): string {
	if (!id.endsWith(suffix)) {
		throw new Error(`restoreGraph: '${ref}' node '${id}' must end with '${suffix}'`);
	}
	const base = id.slice(0, -suffix.length);
	if (base.length === 0) {
		throw new Error(`restoreGraph: '${ref}' node '${id}' has no collection name`);
	}
	return base;
}

function noCollectionConfig(config: GraphCheckpointJson | undefined, ref: string): undefined {
	if (config !== undefined) {
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

function stableJsonKey(value: GraphCheckpointJson): string {
	return Array.from(strictCanonicalJsonBytes(value)).join(",");
}

function mapEntries(
	checkpoint: GraphCheckpointNode,
	ref: string,
): readonly (readonly [unknown, unknown])[] {
	const entries: Array<readonly [unknown, unknown]> = [];
	const seen = new Set<string>();
	for (const [i, entry] of backendArray(checkpoint, ref).entries()) {
		const path = `${checkpoint.id}.backendState[${i}]`;
		if (!Array.isArray(entry) || entry.length !== 2) {
			throw new Error(`restoreGraph: ${path} must be a [key, value] map entry`);
		}
		const key = entry[0] as GraphCheckpointJson;
		const stableKey = stableJsonKey(key);
		if (seen.has(stableKey)) {
			throw new Error(`restoreGraph: ${path}[0] duplicates an earlier map key`);
		}
		seen.add(stableKey);
		entries.push([key, entry[1]] as const);
	}
	return entries;
}

function restoredList(ctx: GraphRestoreExtensionContext, ref: string): ReactiveList<unknown> {
	const base = collectionBaseId(ctx.id, ".delta", ref);
	if (ctx.deps.length !== 0) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' cannot restore deps`);
	}
	const collection = reactiveList(ctx.graph, backendArray(ctx.checkpoint, ref), { name: base });
	restoredCollectionMap(ctx.graph).set(base, { kind: "reactiveList", collection });
	return collection;
}

function restoredIndex(ctx: GraphRestoreExtensionContext, ref: string): ReactiveIndex<unknown> {
	const base = collectionBaseId(ctx.id, ".delta", ref);
	if (ctx.deps.length !== 0) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' cannot restore deps`);
	}
	const rows = indexRows(ctx.checkpoint, ref);
	const collection = restoreReactiveIndexFromBackendState(ctx.graph, rows, { name: base });
	restoredCollectionMap(ctx.graph).set(base, { kind: "reactiveIndex", collection });
	return collection;
}

function restoredLog(
	ctx: GraphRestoreExtensionContext<LogConfig>,
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
	const collection = reactiveLog(ctx.graph, state, {
		name: base,
		...(ctx.config.maxSize !== undefined ? { maxSize: ctx.config.maxSize } : {}),
	});
	restoredCollectionMap(ctx.graph).set(base, { kind: "reactiveLog", collection });
	return collection;
}

function restoredMapNode(ctx: GraphRestoreExtensionContext, ref: string): Node<unknown> {
	const base = collectionBaseId(ctx.id, ".intent", ref);
	if (ctx.deps.length !== 0) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' cannot restore deps`);
	}
	const entries = mapEntries(ctx.checkpoint, ref);
	const collection = restoreReactiveMapFromBackendState(ctx.graph, entries, { name: base });
	restoredCollectionMap(ctx.graph).set(base, { kind: "reactiveMap", collection });
	const node = ctx.graph.find(ctx.id);
	if (node === undefined) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' was not restored`);
	}
	return node;
}

function existingMapNode(
	ctx: GraphRestoreExtensionContext,
	ref: string,
	suffix: ".apply" | ".snapshotPrep" | ".delta" | ".snapshot" | ".request",
): Node<unknown> {
	const base = collectionBaseId(ctx.id, suffix, ref);
	const item = restoredCollectionMap(ctx.graph).get(base);
	if (item === undefined || item.kind !== "reactiveMap") {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' is missing restored '${base}.intent'`);
	}
	const node = ctx.graph.find(ctx.id);
	if (node === undefined) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' was not restored`);
	}
	return node;
}

function existingCollection(
	ctx: GraphRestoreExtensionContext,
	ref: string,
	kind: RestoredCollection["kind"],
): RestoredCollection {
	const base = collectionBaseId(ctx.id, ".snapshot", ref);
	// The snapshot declares the delta and the request state (graphrefly-ts:D172).
	if (ctx.deps.length !== 2) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' requires exactly two deps`);
	}
	const item = restoredCollectionMap(ctx.graph).get(base);
	if (item === undefined || item.kind !== kind) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' is missing restored '${base}.delta'`);
	}
	return item;
}

function existingCollectionRequest(
	ctx: GraphRestoreExtensionContext,
	ref: string,
	kind: RestoredCollection["kind"],
): Node<unknown> {
	const base = collectionBaseId(ctx.id, ".request", ref);
	if (ctx.deps.length !== 0) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' cannot restore deps`);
	}
	const item = restoredCollectionMap(ctx.graph).get(base);
	if (item === undefined || item.kind !== kind) {
		throw new Error(`restoreGraph: '${ref}' node '${ctx.id}' is missing restored '${base}.delta'`);
	}
	return item.collection.request as Node<unknown>;
}

function validateLogConfig(config: GraphCheckpointJson | undefined, ref: string): LogConfig {
	if (config === undefined) return {};
	const obj = objectConfig(config, ref);
	if (obj.maxSize === undefined) return {};
	const maxSize = finiteNumber(obj.maxSize, ref, "maxSize");
	if (!Number.isInteger(maxSize) || maxSize < 1) {
		throw new Error(`restoreGraph: '${ref}' config.maxSize must be a positive integer`);
	}
	return { maxSize };
}

export const reactiveListDeltaRestoreDescriptor: GraphRestoreExtension<undefined> = {
	ref: "reactiveList.delta",
	validateConfig(config) {
		return noCollectionConfig(config, "reactiveList.delta");
	},
	create(ctx) {
		return restoredList(ctx, "reactiveList.delta").delta as Node<unknown>;
	},
};

export const reactiveListRequestRestoreDescriptor: GraphRestoreExtension<undefined> = {
	ref: "reactiveList.request",
	validateConfig(config) {
		return noCollectionConfig(config, "reactiveList.request");
	},
	create(ctx) {
		return existingCollectionRequest(ctx, "reactiveList.request", "reactiveList");
	},
};

export const reactiveListSnapshotRestoreDescriptor: GraphRestoreExtension<undefined> = {
	ref: "reactiveList.snapshot",
	validateConfig(config) {
		return noCollectionConfig(config, "reactiveList.snapshot");
	},
	create(ctx) {
		return existingCollection(ctx, "reactiveList.snapshot", "reactiveList").collection
			.snapshot as Node<unknown>;
	},
};

export const reactiveIndexDeltaRestoreDescriptor: GraphRestoreExtension<undefined> = {
	ref: "reactiveIndex.delta",
	validateConfig(config) {
		return noCollectionConfig(config, "reactiveIndex.delta");
	},
	create(ctx) {
		return restoredIndex(ctx, "reactiveIndex.delta").delta as Node<unknown>;
	},
};

export const reactiveIndexRequestRestoreDescriptor: GraphRestoreExtension<undefined> = {
	ref: "reactiveIndex.request",
	validateConfig(config) {
		return noCollectionConfig(config, "reactiveIndex.request");
	},
	create(ctx) {
		return existingCollectionRequest(ctx, "reactiveIndex.request", "reactiveIndex");
	},
};

export const reactiveIndexSnapshotRestoreDescriptor: GraphRestoreExtension<undefined> = {
	ref: "reactiveIndex.snapshot",
	validateConfig(config) {
		return noCollectionConfig(config, "reactiveIndex.snapshot");
	},
	create(ctx) {
		return existingCollection(ctx, "reactiveIndex.snapshot", "reactiveIndex").collection
			.snapshot as Node<unknown>;
	},
};

export const reactiveLogDeltaRestoreDescriptor: GraphRestoreExtension<LogConfig> = {
	ref: "reactiveLog.delta",
	validateConfig(config) {
		return validateLogConfig(config, "reactiveLog.delta");
	},
	create(ctx) {
		return restoredLog(ctx, "reactiveLog.delta").delta as Node<unknown>;
	},
};

export const reactiveLogRequestRestoreDescriptor: GraphRestoreExtension<LogConfig> = {
	ref: "reactiveLog.request",
	validateConfig(config) {
		return validateLogConfig(config, "reactiveLog.request");
	},
	create(ctx) {
		return existingCollectionRequest(ctx, "reactiveLog.request", "reactiveLog");
	},
};

export const reactiveLogSnapshotRestoreDescriptor: GraphRestoreExtension<LogConfig> = {
	ref: "reactiveLog.snapshot",
	validateConfig(config) {
		return validateLogConfig(config, "reactiveLog.snapshot");
	},
	create(ctx) {
		return existingCollection(ctx, "reactiveLog.snapshot", "reactiveLog").collection
			.snapshot as Node<unknown>;
	},
};

export const reactiveMapIntentRestoreDescriptor: GraphRestoreExtension<undefined> = {
	ref: "reactiveMap.intent",
	validateConfig(config) {
		return noCollectionConfig(config, "reactiveMap.intent");
	},
	create(ctx) {
		return restoredMapNode(ctx, "reactiveMap.intent");
	},
};

export const reactiveMapApplyRestoreDescriptor: GraphRestoreExtension<undefined> = {
	ref: "reactiveMap.apply",
	validateConfig(config) {
		return noCollectionConfig(config, "reactiveMap.apply");
	},
	create(ctx) {
		return existingMapNode(ctx, "reactiveMap.apply", ".apply");
	},
};

export const reactiveMapRequestRestoreDescriptor: GraphRestoreExtension<undefined> = {
	ref: "reactiveMap.request",
	validateConfig(config) {
		return noCollectionConfig(config, "reactiveMap.request");
	},
	create(ctx) {
		return existingMapNode(ctx, "reactiveMap.request", ".request");
	},
};

export const reactiveMapSnapshotPrepRestoreDescriptor: GraphRestoreExtension<undefined> = {
	ref: "reactiveMap.snapshotPrep",
	validateConfig(config) {
		return noCollectionConfig(config, "reactiveMap.snapshotPrep");
	},
	create(ctx) {
		return existingMapNode(ctx, "reactiveMap.snapshotPrep", ".snapshotPrep");
	},
};

export const reactiveMapDeltaRestoreDescriptor: GraphRestoreExtension<undefined> = {
	ref: "reactiveMap.delta",
	validateConfig(config) {
		return noCollectionConfig(config, "reactiveMap.delta");
	},
	create(ctx) {
		return existingMapNode(ctx, "reactiveMap.delta", ".delta");
	},
};

export const reactiveMapSnapshotRestoreDescriptor: GraphRestoreExtension<undefined> = {
	ref: "reactiveMap.snapshot",
	validateConfig(config) {
		return noCollectionConfig(config, "reactiveMap.snapshot");
	},
	create(ctx) {
		return existingMapNode(ctx, "reactiveMap.snapshot", ".snapshot");
	},
};

export const defaultRestoreRegistry: Readonly<Record<string, GraphRestoreEntry>> = {
	map: mapRestoreDescriptor,
	take: takeRestoreDescriptor,
	timer: timerRestoreDescriptor,
	"reactiveList.delta": reactiveListDeltaRestoreDescriptor,
	"reactiveList.request": reactiveListRequestRestoreDescriptor,
	"reactiveList.snapshot": reactiveListSnapshotRestoreDescriptor,
	"reactiveIndex.delta": reactiveIndexDeltaRestoreDescriptor,
	"reactiveIndex.request": reactiveIndexRequestRestoreDescriptor,
	"reactiveIndex.snapshot": reactiveIndexSnapshotRestoreDescriptor,
	"reactiveLog.delta": reactiveLogDeltaRestoreDescriptor,
	"reactiveLog.request": reactiveLogRequestRestoreDescriptor,
	"reactiveLog.snapshot": reactiveLogSnapshotRestoreDescriptor,
	"reactiveMap.intent": reactiveMapIntentRestoreDescriptor,
	"reactiveMap.apply": reactiveMapApplyRestoreDescriptor,
	"reactiveMap.request": reactiveMapRequestRestoreDescriptor,
	"reactiveMap.snapshotPrep": reactiveMapSnapshotPrepRestoreDescriptor,
	"reactiveMap.delta": reactiveMapDeltaRestoreDescriptor,
	"reactiveMap.snapshot": reactiveMapSnapshotRestoreDescriptor,
};

type Prepared = {
	checkpoint: GraphCheckpointNode;
	entry: GraphRecipeFactory | GraphRestoreExtension | undefined;
	config: GraphCheckpointJson | undefined;
	terminal: true | unknown | undefined;
};

type PreparedCheckpoint = {
	checkpoint: GraphCheckpoint;
	nodes: Map<string, Prepared>;
	mounts: Array<{ at: string; prepared: PreparedCheckpoint }>;
};

function registryGet(registry: GraphRestoreRegistry, ref: string): GraphRestoreEntry | undefined {
	return registry instanceof Map
		? registry.get(ref)
		: (registry as Readonly<Record<string, GraphRestoreEntry>>)[ref];
}

function isFactory(entry: GraphRestoreEntry | undefined): entry is GraphRecipeFactory {
	return entry !== undefined && "build" in entry;
}

function isExtension(entry: GraphRestoreEntry | undefined): entry is GraphRestoreExtension {
	return entry !== undefined && "create" in entry;
}

function isDefinition(
	entry: GraphRestoreEntry | undefined,
): entry is GraphRestoreDefinition<any, any> {
	return entry !== undefined && "kind" in entry && entry.kind === "definition";
}

function assertString(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`restoreGraph: ${label} must be a string`);
	return value;
}

function assertArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`restoreGraph: ${label} must be an array`);
	return value;
}

function restoredTerminal(
	value: GraphCheckpointTerminal,
	label: string,
): true | unknown | undefined {
	if (value?.kind === "none") return undefined;
	if (value?.kind === "COMPLETE") return true;
	if (value?.kind === "ERROR") return value.error;
	throw new Error(`restoreGraph: ${label} has an invalid terminal`);
}

function entryFor(
	registry: GraphRestoreRegistry,
	ref: string,
	id: string,
): GraphRecipeFactory | GraphRestoreExtension {
	const entry = registryGet(registry, ref);
	if (!isFactory(entry) && !isExtension(entry))
		throw new Error(`restoreGraph: missing recipe '${ref}' in the registry (node '${id}')`);
	if (entry.ref !== ref)
		throw new Error(`restoreGraph: registry entry for '${ref}' reports ref '${entry.ref}'`);
	return entry;
}

function prepareNode(node: GraphCheckpointNode, registry: GraphRestoreRegistry): Prepared {
	const id = node.id;
	if (node.kind !== "state" && node.kind !== "computed")
		throw new Error(`restoreGraph: node '${id}' has an invalid kind`);
	assertString(node.factory, `node '${id}' factory`);
	assertArray(node.deps, `node '${id}' deps`).forEach((d, i) => {
		assertString(d, `${id}.deps[${i}]`);
	});
	assertArray(node.values, `node '${id}' values`);
	const terminal = restoredTerminal(node.terminal, `node '${id}'`);
	if (node.kind === "state" && node.deps.length !== 0)
		throw new Error(`restoreGraph: state node '${id}' cannot have dependencies`);
	if (node.lifetime !== undefined) {
		if (node.kind !== "computed")
			throw new Error(`restoreGraph: state node '${id}' cannot have a lifetime`);
		const lifetimeDeps = node.lifetime.deps ?? node.deps;
		assertArray(node.lifetime.deps ?? [], `node '${id}' lifetime.deps`);
		const received = assertArray(node.lifetime.received, `node '${id}' lifetime.received`);
		if (received.length !== lifetimeDeps.length)
			throw new Error(
				`restoreGraph: node '${id}' records what it received from ${received.length} dependencies, not ${lifetimeDeps.length}`,
			);
		received.forEach((r, i) => {
			const rec = r as { values?: unknown; terminal?: GraphCheckpointTerminal };
			assertArray(rec.values, `${id}.lifetime.received[${i}].values`);
			restoredTerminal(rec.terminal as GraphCheckpointTerminal, `${id}.lifetime.received[${i}]`);
		});
		if (typeof node.lifetime.ran !== "boolean")
			throw new Error(`restoreGraph: node '${id}' lifetime.ran must be a boolean`);
	}
	if (node.kind === "computed" && node.policies === undefined)
		throw new Error(`restoreGraph: computed node '${id}' has no policies`);
	if (node.recipe === undefined) {
		if (node.kind === "computed")
			throw new Error(
				`restoreGraph: node '${id}' is local-only: its instance carries no recipe (R-checkpoint)`,
			);
		return { checkpoint: node, entry: undefined, config: undefined, terminal };
	}
	const ref = assertString(node.recipe.ref, `node '${id}' recipe.ref`);
	const entry = entryFor(registry, ref, id);
	if (node.kind === "state" && !isExtension(entry))
		throw new Error(`restoreGraph: state node '${id}' recipe '${ref}' is not a restore extension`);
	const raw = node.recipe.config;
	if (raw !== undefined) toCheckpointJson(raw, `${id}.recipe.config`);
	const config = isExtension(entry)
		? entry.validateConfig
			? entry.validateConfig(raw, node)
			: raw
		: entry.validateConfig
			? entry.validateConfig(raw)
			: raw;
	return { checkpoint: node, entry, config, terminal };
}

function prepareCheckpoint(
	checkpoint: GraphCheckpoint,
	registry: GraphRestoreRegistry,
	path = "checkpoint",
	mountAt?: string,
): PreparedCheckpoint {
	// R-checkpoint: a checkpoint lacking what the rule saves, such as one written to an earlier
	// format, is refused rather than completed.
	if (checkpoint?.format !== GRAPH_CHECKPOINT_FORMAT)
		throw new Error(
			`restoreGraph: ${path} is not a ${GRAPH_CHECKPOINT_FORMAT} checkpoint (an earlier format lacks what R-checkpoint saves)`,
		);
	toCheckpointJson(checkpoint, path);
	const nodes = new Map<string, Prepared>();
	for (const node of assertArray(checkpoint.nodes, `${path}.nodes`) as GraphCheckpointNode[]) {
		const id = assertString(node.id, `${path}.nodes[].id`);
		if (nodes.has(id)) throw new Error(`restoreGraph: duplicate node id '${id}'`);
		if (mountAt !== undefined && id.startsWith(`${mountAt}::`))
			throw new Error(
				`restoreGraph: mounted checkpoint at '${mountAt}' must use child-local node id '${id.slice(`${mountAt}::`.length)}', not '${id}'`,
			);
		nodes.set(id, prepareNode(node, registry));
	}
	for (const { checkpoint: node } of nodes.values()) {
		for (const dep of [...node.deps, ...(node.lifetime?.deps ?? [])])
			if (!nodes.has(dep))
				throw new Error(`restoreGraph: node '${node.id}' has missing dep '${dep}'`);
	}
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

function recipeContext(registry: GraphRestoreRegistry, out: Graph, id: string): GraphRecipeContext {
	const ctx: GraphRecipeContext = {
		graph: out,
		id,
		make(recipe) {
			const entry = registryGet(registry, recipe.ref);
			if (!isFactory(entry))
				throw new Error(
					`restoreGraph: missing recipe '${recipe.ref}' in the registry (node '${id}')`,
				);
			const config = entry.validateConfig ? entry.validateConfig(recipe.config) : recipe.config;
			return entry.build(config, ctx);
		},
		definition<S, T>(ref: string) {
			const entry = registryGet(registry, ref);
			if (!isDefinition(entry))
				throw new Error(`restoreGraph: missing function definition for '${ref}' (node '${id}')`);
			return entry as unknown as GraphRestoreDefinition<S, T>;
		},
	};
	return ctx;
}

function policyOptions(p: GraphCheckpointPolicies): Partial<NodeOptions<unknown>> {
	return {
		complete: p.complete,
		error: p.error,
		invalidate: p.invalidate,
		partial: p.partial,
		quiet: p.quiet,
		dynamic: p.dynamic,
		pool: p.pool,
	};
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
		// R-checkpoint: each node is built after its declared dependencies, otherwise in checkpoint
		// order; no recipe function runs.
		const buildNode = (id: string): Node<unknown> => {
			const existing = built.get(id);
			if (existing) return existing;
			const item = prepared.nodes.get(id) as Prepared;
			if (visiting.has(id)) throw new Error(`restoreGraph: dependency cycle at '${id}'`);
			visiting.add(id);
			const node = item.checkpoint;
			const deps = node.deps.map(buildNode);
			const common = {
				name: node.name,
				meta: node.meta,
				...(node.recipe === undefined ? {} : { recipe: node.recipe }),
			};
			let made: Node<unknown>;
			if (item.entry === undefined) {
				made = restoreStateNodeInGraph(out, id, common) as Node<unknown>;
			} else if (isExtension(item.entry)) {
				made = item.entry.create({
					graph: out,
					id,
					name: node.name,
					deps,
					config: item.config,
					checkpoint: node,
				});
				if (out.find(id) !== made)
					throw new Error(
						`restoreGraph: restore extension '${item.entry.ref}' did not register node '${id}'`,
					);
			} else {
				const build = item.entry.build(item.config, recipeContext(registry, out, id));
				made = restoreNodeInGraph(out, id, node.factory, deps, build.fn, {
					...common,
					...policyOptions(node.policies as GraphCheckpointPolicies),
					...(build.setup === undefined ? {} : { setup: build.setup }),
				});
			}
			if (made.deps.length !== deps.length || made.deps.some((dep, i) => dep !== deps[i]))
				throw new Error(
					`restoreGraph: node '${id}' was built with dependencies that do not match the checkpoint`,
				);
			built.set(id, made);
			visiting.delete(id);
			return made;
		};
		for (const id of prepared.nodes.keys()) buildNode(id);

		for (const mount of prepared.mounts) {
			out.mount(constructPrepared(mount.prepared, registry, dispatcher, versioning), {
				at: mount.at,
			});
		}

		for (const [id, made] of built) {
			const item = prepared.nodes.get(id) as Prepared;
			const node = item.checkpoint;
			const lifetime = node.lifetime;
			// A ctx.rewire's lifetime dependencies; the declared ones come back when it closes.
			if (lifetime?.deps !== undefined)
				nodeRuntimeHost(made)._rewire(
					lifetime.deps.map((dep) => built.get(dep) as Node<unknown>),
					undefined,
					{ declare: false },
				);
			const received: NodeReceived[] | undefined = lifetime?.received.map((r) => ({
				values: r.values,
				terminal: restoredTerminal(r.terminal, `node '${id}' received`),
			}));
			restoreStateOfNode(made, {
				values: node.values,
				terminal: item.terminal,
				privateState: lifetime?.state ?? SENTINEL,
				seed:
					lifetime === undefined || received === undefined
						? undefined
						: { received, ran: lifetime.ran },
			});
		}
	} finally {
		clearRestoredCollectionMap(out);
	}
	return out;
}

/**
 * Restore a new graph from a checkpoint and a registry of recipes (R-checkpoint).
 *
 * @param checkpoint - A `graphrefly-ts/checkpoint@1` checkpoint.
 * @param options - The registry of recipe factories, restore extensions and named definitions,
 *   and optional dispatcher and versioning overrides.
 * @returns A new graph with no subscribers; no recipe function has run.
 * @example
 * ```ts
 * import { defaultRestoreRegistry, graph, restoreGraph } from "@graphrefly/ts/graph";
 *
 * const original = graph();
 * const restored = restoreGraph(original.checkpoint(), { registry: defaultRestoreRegistry });
 * ```
 * @category graph
 */
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
