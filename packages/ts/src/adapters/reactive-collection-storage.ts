import type { DeliveryMeta } from "../ctx/types.js";
import {
	type ReactiveIndex,
	type ReactiveIndexOptions,
	type ReactiveList,
	type ReactiveListOptions,
	type ReactiveLog,
	type ReactiveLogOptions,
	type ReactiveMap,
	type ReactiveMapOptions,
	restoreReactiveIndex,
	restoreReactiveList,
	restoreReactiveLog,
	restoreReactiveMap,
} from "../data-structures/index.js";
import type {
	IndexChange,
	ListChange,
	LogChange,
	MapChange,
} from "../graph/data-structures/change.js";
import type { IndexRow } from "../graph/data-structures/reactive-index.js";
import { assertGraphLocalNode, type Graph, type StateNode } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { Message } from "../protocol/messages.js";
import type {
	AppendLogEntry,
	AppendLogStorageTier,
	KvStorageTier,
	LoadReactiveCollectionStateOptions,
	ReactiveCollectionChangeFrame,
	ReactiveCollectionSnapshotFrame,
	ReactiveIndexRestoreState,
	ReactiveListRestoreState,
	ReactiveLogRestoreState,
	ReactiveMapRestoreState,
} from "../storage/index.js";
import {
	assertReactiveCollectionChangeFrame,
	assertReactiveCollectionSnapshotFrame,
	collectionSnapshotKey,
	loadReactiveIndexState,
	loadReactiveListState,
	loadReactiveLogState,
	loadReactiveMapState,
	reactiveCollectionChangeFrame,
	reactiveCollectionSnapshotFrame,
} from "../storage/index.js";

type PersistableKind = "reactiveList" | "reactiveLog" | "reactiveMap" | "reactiveIndex";
type PersistableChange<T, K extends PersistableKind> = K extends "reactiveList"
	? ListChange<T>
	: K extends "reactiveLog"
		? LogChange<T>
		: K extends "reactiveMap"
			? MapChange<unknown, T>
			: IndexChange<unknown, T>;
type PersistableCollection<T, K extends PersistableKind> = K extends "reactiveList"
	? ReactiveList<T>
	: K extends "reactiveLog"
		? ReactiveLog<T>
		: K extends "reactiveMap"
			? ReactiveMap<unknown, T>
			: ReactiveIndex<unknown, T>;

/** D161 adapter write-progress cursor; this is not a domain replay or wire-bridge cursor. */
export interface ReactiveCollectionPersistenceCursor {
	readonly kind: "persistence.cursor";
	readonly collection: PersistableKind;
	readonly changeSeq: number;
	readonly snapshotWrites: number;
	readonly changeWrites: number;
}

/** D161 graph-visible persistence sidecar status fact. */
export interface ReactiveCollectionPersistenceStatus {
	readonly state: "starting" | "ready" | "flushing" | "errored" | "disposed";
	readonly pending: number;
	readonly writes: number;
	readonly errors: number;
	readonly cursor: ReactiveCollectionPersistenceCursor;
}

/** D161 graph-visible persistence sidecar error fact. */
export interface ReactiveCollectionPersistenceError {
	readonly phase: "snapshot" | "change";
	readonly message: string;
	readonly cursor: ReactiveCollectionPersistenceCursor;
}

/** Options for the D161 graph-bound persistence sidecar over a reactive collection. */
export interface PersistReactiveCollectionOptions<K extends PersistableKind = PersistableKind> {
	readonly kind: K;
	readonly name?: string;
	readonly snapshotStore: KvStorageTier<unknown>;
	readonly snapshotKey?: string;
	readonly storagePrefix?: string;
	readonly changeLog?: AppendLogStorageTier<unknown>;
	/** Adapter write cursor seed for wrappers that already folded a change log. */
	readonly initialChangeCursor?: number;
	/** Default true: write one durable baseline when the adapter attaches. */
	readonly snapshotOnAttach?: boolean;
	/** Optional snapshot cadence. Manual snapshots remain available via handle.snapshot(). */
	readonly snapshotEveryChanges?: number;
}

/** D161 sidecar controls; flush waits for queued storage promises to settle, not fsync. */
export interface ReactiveCollectionPersistenceHandle {
	readonly ready: StateNode<boolean>;
	readonly status: StateNode<ReactiveCollectionPersistenceStatus>;
	readonly error: StateNode<ReactiveCollectionPersistenceError | null>;
	readonly cursor: StateNode<ReactiveCollectionPersistenceCursor>;
	flush(done?: (status: ReactiveCollectionPersistenceStatus) => void): void;
	snapshot(done?: (status: ReactiveCollectionPersistenceStatus) => void): void;
	dispose(done?: (status: ReactiveCollectionPersistenceStatus) => void): void;
}

interface QueueItem {
	readonly phase: "snapshot" | "change" | "flush" | "dispose";
	readonly done?: (status: ReactiveCollectionPersistenceStatus) => void;
	run(): void | PromiseLike<void>;
}

function emptyCursor(collection: PersistableKind): ReactiveCollectionPersistenceCursor {
	return {
		kind: "persistence.cursor",
		collection,
		changeSeq: -1,
		snapshotWrites: 0,
		changeWrites: 0,
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function validateSnapshotEveryChanges(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError("snapshotEveryChanges must be a positive safe integer");
	}
	return value;
}

function validateInitialChangeCursor(value: number | undefined): number {
	if (value === undefined) return -1;
	if (!Number.isSafeInteger(value) || value < -1) {
		throw new RangeError("initialChangeCursor must be a safe integer >= -1");
	}
	return value;
}

function statusOf(
	state: ReactiveCollectionPersistenceStatus["state"],
	pending: number,
	writes: number,
	errors: number,
	cursor: ReactiveCollectionPersistenceCursor,
): ReactiveCollectionPersistenceStatus {
	return { state, pending, writes, errors, cursor };
}

function dataOf<C>(msg: Message): C | undefined {
	return msg[0] === "DATA" ? (msg[1] as C) : undefined;
}

/**
 * D161 graph-bound sidecar over an existing collection. It writes passive storage frames and
 * exposes adapter progress as graph-visible DATA facts; it never restores or mutates the collection.
 */
export function persistReactiveCollection<T, K extends PersistableKind>(
	graph: Graph,
	collection: PersistableCollection<T, K>,
	opts: PersistReactiveCollectionOptions<K>,
): ReactiveCollectionPersistenceHandle {
	const kind = opts.kind;
	const name = opts.name ?? `${kind}.persistence`;
	const snapshotKey = opts.snapshotKey ?? collectionSnapshotKey(opts.storagePrefix ?? name);
	const snapshotEveryChanges = validateSnapshotEveryChanges(opts.snapshotEveryChanges);
	assertGraphLocalNode(graph, collection.delta as Node<unknown>, `${name}.collection.delta`);
	assertGraphLocalNode(graph, collection.snapshot as Node<unknown>, `${name}.collection.snapshot`);

	let cursorValue = {
		...emptyCursor(kind),
		changeSeq: validateInitialChangeCursor(opts.initialChangeCursor),
	};
	let statusValue = statusOf("starting", 0, 0, 0, cursorValue);
	let errorCount = 0;
	let writes = 0;
	let observedChangesSinceSnapshot = 0;
	let running = false;
	let disposed = false;
	let disposeRequested = false;
	let subscribing = true;
	let stop: (() => void) | undefined;
	const queue: QueueItem[] = [];

	const ready = graph.state(false, { name: `${name}/ready` });
	const status = graph.state<ReactiveCollectionPersistenceStatus>(statusValue, {
		name: `${name}/status`,
	});
	const error = graph.state<ReactiveCollectionPersistenceError | null>(null, {
		name: `${name}/error`,
	});
	const cursor = graph.state<ReactiveCollectionPersistenceCursor>(cursorValue, {
		name: `${name}/cursor`,
	});

	function publish(state: ReactiveCollectionPersistenceStatus["state"]): void {
		const nextState = statusValue.state === "errored" && state !== "disposed" ? "errored" : state;
		statusValue = statusOf(
			nextState,
			queue.length + (running ? 1 : 0),
			writes,
			errorCount,
			cursorValue,
		);
		cursor.set(cursorValue);
		status.set(statusValue);
		if (nextState === "ready") ready.set(true);
		if (nextState === "errored" || nextState === "disposed") ready.set(false);
	}

	function report(phase: "snapshot" | "change", caught: unknown): void {
		errorCount += 1;
		const fact = { phase, message: errorMessage(caught), cursor: cursorValue };
		error.set(fact);
	}

	function callDone(done: QueueItem["done"]): void {
		try {
			done?.(statusValue);
		} catch {
			// Done callbacks are advisory barriers; user code must not wedge the adapter queue.
		}
	}

	function finish(item: QueueItem): void {
		if (item.phase === "dispose") {
			disposed = true;
			running = false;
			publish("disposed");
		} else if (statusValue.state !== "errored") {
			running = false;
			publish("ready");
		} else {
			running = false;
			publish("errored");
		}
		callDone(item.done);
		drain();
	}

	function fail(item: QueueItem, caught: unknown): void {
		if (item.phase === "snapshot" || item.phase === "change") report(item.phase, caught);
		running = false;
		if (item.phase === "snapshot" || item.phase === "change") publish("errored");
		callDone(item.done);
		drain();
	}

	function chainThenable(item: QueueItem, value: unknown): boolean {
		if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
		let then: unknown;
		try {
			then = (value as { then?: unknown }).then;
		} catch (caught) {
			fail(item, caught);
			return true;
		}
		if (typeof then !== "function") return false;
		let settled = false;
		const settle = (next: () => void) => {
			if (settled) return;
			settled = true;
			next();
		};
		try {
			(then as (onFulfilled: () => void, onRejected: (error: unknown) => void) => unknown).call(
				value,
				() => settle(() => finish(item)),
				(caught) => settle(() => fail(item, caught)),
			);
		} catch (caught) {
			settle(() => fail(item, caught));
		}
		return true;
	}

	function enqueue(item: QueueItem): void {
		if (disposed || (disposeRequested && item.phase !== "dispose" && item.phase !== "flush")) {
			callDone(item.done);
			return;
		}
		queue.push(item);
		drain();
	}

	function drain(): void {
		if (running) return;
		const item = queue.shift();
		if (item === undefined) return;
		running = true;
		publish(
			item.phase === "flush" ? "flushing" : statusValue.state === "starting" ? "starting" : "ready",
		);
		let result: void | PromiseLike<void>;
		try {
			result = item.run();
		} catch (caught) {
			fail(item, caught);
			return;
		}
		if (chainThenable(item, result)) return;
		finish(item);
	}

	function enqueueSnapshot(done?: (status: ReactiveCollectionPersistenceStatus) => void): void {
		const snapshot = collectionSnapshot(collection, kind);
		observedChangesSinceSnapshot = 0;
		enqueue({
			phase: "snapshot",
			done,
			run() {
				const frame: ReactiveCollectionSnapshotFrame<K, readonly unknown[]> =
					reactiveCollectionSnapshotFrame(kind, snapshot, {
						changeCursor: cursorValue.changeSeq,
					});
				assertReactiveCollectionSnapshotFrame(frame, kind);
				return opts.snapshotStore.set(snapshotKey, frame).then(() => {
					cursorValue = {
						...cursorValue,
						snapshotWrites: cursorValue.snapshotWrites + 1,
					};
					writes += 1;
					publish("ready");
				});
			},
		});
	}

	function enqueueChange(change: PersistableChange<T, K>): void {
		const changeLog = opts.changeLog;
		if (changeLog === undefined) return;
		enqueue({
			phase: "change",
			run() {
				const frame: ReactiveCollectionChangeFrame<
					PersistableKind,
					PersistableChange<T, K>
				> = reactiveCollectionChangeFrame(kind, change);
				assertReactiveCollectionChangeFrame(frame, kind);
				return changeLog.append(frame).then((written) => {
					const entry = written as AppendLogEntry<
						ReactiveCollectionChangeFrame<PersistableKind, PersistableChange<T, K>>
					>;
					cursorValue = {
						...cursorValue,
						changeSeq: entry.seq,
						changeWrites: cursorValue.changeWrites + 1,
					};
					writes += 1;
					publish("ready");
				});
			},
		});
	}

	function cancelQueuedForDispose(): void {
		const pending = queue.splice(0);
		for (const item of pending) callDone(item.done);
	}

	stop = (collection.delta as Node<PersistableChange<T, K>>).subscribe(
		(msg: Message, delivery?: DeliveryMeta) => {
			if (disposeRequested) return;
			const change = dataOf<PersistableChange<T, K>>(msg);
			if (change === undefined) return;
			if (subscribing && delivery === undefined) return;
			observedChangesSinceSnapshot += 1;
			enqueueChange(change);
			if (
				snapshotEveryChanges !== undefined &&
				observedChangesSinceSnapshot >= snapshotEveryChanges
			) {
				enqueueSnapshot();
			}
		},
	);
	subscribing = false;

	if (opts.snapshotOnAttach !== false) enqueueSnapshot();
	else publish("ready");

	return {
		ready,
		status,
		error,
		cursor,
		flush(done?: (status: ReactiveCollectionPersistenceStatus) => void): void {
			if (disposed) {
				callDone(done);
				return;
			}
			enqueue({ phase: "flush", done, run: () => undefined });
		},
		snapshot(done?: (status: ReactiveCollectionPersistenceStatus) => void): void {
			if (disposed || disposeRequested) {
				callDone(done);
				return;
			}
			enqueueSnapshot(done);
		},
		dispose(done?: (status: ReactiveCollectionPersistenceStatus) => void): void {
			if (disposed) {
				callDone(done);
				return;
			}
			disposeRequested = true;
			stop?.();
			cancelQueuedForDispose();
			enqueue({ phase: "dispose", done, run: () => undefined });
		},
	};
}

function collectionSnapshot<T, K extends PersistableKind>(
	collection: PersistableCollection<T, K>,
	kind: K,
): readonly unknown[] {
	if (kind === "reactiveMap") {
		return [...(collection as ReactiveMap<unknown, unknown>).toMap()];
	}
	if (kind === "reactiveIndex") {
		return (collection as ReactiveIndex<unknown, unknown>).toArray();
	}
	return (collection as ReactiveList<T> | ReactiveLog<T>).toArray();
}

type CollectionOptionsWithoutGraphName<T> = Omit<T, "graph" | "name">;

/** Options for D161 load -> restore -> persist composition for reactiveList. */
export interface OpenPersistentReactiveListOptions<T>
	extends LoadReactiveCollectionStateOptions,
		Omit<
			PersistReactiveCollectionOptions<"reactiveList">,
			"kind" | "snapshotStore" | "changeLog" | "initialChangeCursor"
		> {
	readonly graph: Graph;
	readonly name?: string;
	readonly initial?: readonly T[];
	readonly collection?: CollectionOptionsWithoutGraphName<ReactiveListOptions>;
}

/** Options for D161 load -> restore -> persist composition for reactiveLog. */
export interface OpenPersistentReactiveLogOptions<T>
	extends LoadReactiveCollectionStateOptions,
		Omit<
			PersistReactiveCollectionOptions<"reactiveLog">,
			"kind" | "snapshotStore" | "changeLog" | "initialChangeCursor"
		> {
	readonly graph: Graph;
	readonly name?: string;
	readonly initial?: readonly T[];
	readonly collection?: CollectionOptionsWithoutGraphName<ReactiveLogOptions>;
}

/** Options for D161 load -> restore -> persist composition for reactiveMap. */
export interface OpenPersistentReactiveMapOptions<K, V>
	extends LoadReactiveCollectionStateOptions,
		Omit<
			PersistReactiveCollectionOptions<"reactiveMap">,
			"kind" | "snapshotStore" | "changeLog" | "initialChangeCursor"
		> {
	readonly graph: Graph;
	readonly name?: string;
	readonly initial?: readonly (readonly [K, V])[];
	readonly collection?: CollectionOptionsWithoutGraphName<ReactiveMapOptions<K, V>>;
}

/** Options for D161 load -> restore -> persist composition for reactiveIndex. */
export interface OpenPersistentReactiveIndexOptions<K, V>
	extends LoadReactiveCollectionStateOptions,
		Omit<
			PersistReactiveCollectionOptions<"reactiveIndex">,
			"kind" | "snapshotStore" | "changeLog" | "initialChangeCursor"
		> {
	readonly graph: Graph;
	readonly name?: string;
	readonly initial?: readonly IndexRow<K, V>[];
	readonly collection?: CollectionOptionsWithoutGraphName<ReactiveIndexOptions>;
}

/** Return value for D161 persistent reactiveList composition. */
export interface PersistentReactiveList<T> {
	readonly collection: ReactiveList<T>;
	readonly persistence: ReactiveCollectionPersistenceHandle;
	readonly loaded: ReactiveListRestoreState<T>;
}

/** Return value for D161 persistent reactiveLog composition. */
export interface PersistentReactiveLog<T> {
	readonly collection: ReactiveLog<T>;
	readonly persistence: ReactiveCollectionPersistenceHandle;
	readonly loaded: ReactiveLogRestoreState<T>;
}

/** Return value for D161 persistent reactiveMap composition. */
export interface PersistentReactiveMap<K, V> {
	readonly collection: ReactiveMap<K, V>;
	readonly persistence: ReactiveCollectionPersistenceHandle;
	readonly loaded: ReactiveMapRestoreState<K, V>;
}

/** Return value for D161 persistent reactiveIndex composition. */
export interface PersistentReactiveIndex<K, V> {
	readonly collection: ReactiveIndex<K, V>;
	readonly persistence: ReactiveCollectionPersistenceHandle;
	readonly loaded: ReactiveIndexRestoreState<K, V>;
}

/** D161 convenience wrapper: passive load, sync restoreReactiveList, then sidecar persist. */
export function openPersistentReactiveList<T = unknown>(
	opts: OpenPersistentReactiveListOptions<T>,
): Promise<PersistentReactiveList<T>> {
	const storagePrefix = opts.storagePrefix ?? opts.name ?? "reactive-collection";
	const snapshotKey = opts.snapshotKey ?? collectionSnapshotKey(storagePrefix);
	const loadOpts = { ...opts, snapshotKey, storagePrefix };
	return loadReactiveListState<T>(loadOpts).then((loaded) => {
		const state =
			loaded.source === "empty" && opts.initial !== undefined
				? { ...loaded, state: opts.initial }
				: loaded;
		const collection = restoreReactiveList<T>(state, {
			...(opts.collection ?? {}),
			graph: opts.graph,
			name: opts.name,
		});
		const persistence = persistReactiveCollection<T, "reactiveList">(opts.graph, collection, {
			...opts,
			kind: "reactiveList",
			name: opts.name ? `${opts.name}/persistence` : undefined,
			snapshotKey,
			storagePrefix,
			initialChangeCursor: loaded.changes.cursor,
		});
		return { collection, persistence, loaded };
	});
}

/** D161 convenience wrapper: passive load, sync restoreReactiveLog, then sidecar persist. */
export function openPersistentReactiveLog<T = unknown>(
	opts: OpenPersistentReactiveLogOptions<T>,
): Promise<PersistentReactiveLog<T>> {
	const storagePrefix = opts.storagePrefix ?? opts.name ?? "reactive-collection";
	const snapshotKey = opts.snapshotKey ?? collectionSnapshotKey(storagePrefix);
	const loadOpts = { ...opts, snapshotKey, storagePrefix };
	return loadReactiveLogState<T>(loadOpts).then((loaded) => {
		const state =
			loaded.source === "empty" && opts.initial !== undefined
				? { ...loaded, state: opts.initial }
				: loaded;
		const collection = restoreReactiveLog<T>(state, {
			...(opts.collection ?? {}),
			graph: opts.graph,
			name: opts.name,
		});
		const persistence = persistReactiveCollection<T, "reactiveLog">(opts.graph, collection, {
			...opts,
			kind: "reactiveLog",
			name: opts.name ? `${opts.name}/persistence` : undefined,
			snapshotKey,
			storagePrefix,
			initialChangeCursor: loaded.changes.cursor,
		});
		return { collection, persistence, loaded };
	});
}

/** D161 convenience wrapper: passive load, sync restoreReactiveMap, then sidecar persist. */
export function openPersistentReactiveMap<K = unknown, V = unknown>(
	opts: OpenPersistentReactiveMapOptions<K, V>,
): Promise<PersistentReactiveMap<K, V>> {
	const storagePrefix = opts.storagePrefix ?? opts.name ?? "reactive-collection";
	const snapshotKey = opts.snapshotKey ?? collectionSnapshotKey(storagePrefix);
	const loadOpts = { ...opts, snapshotKey, storagePrefix };
	return loadReactiveMapState<K, V>(loadOpts).then((loaded) => {
		const state =
			loaded.source === "empty" && opts.initial !== undefined
				? { ...loaded, state: opts.initial }
				: loaded;
		const collection = restoreReactiveMap<K, V>(state, {
			...(opts.collection ?? {}),
			graph: opts.graph,
			name: opts.name,
		});
		const persistence = persistReactiveCollection<V, "reactiveMap">(opts.graph, collection, {
			...opts,
			kind: "reactiveMap",
			name: opts.name ? `${opts.name}/persistence` : undefined,
			snapshotKey,
			storagePrefix,
			initialChangeCursor: loaded.changes.cursor,
		});
		return { collection, persistence, loaded };
	});
}

/** D161 convenience wrapper: passive load, sync restoreReactiveIndex, then sidecar persist. */
export function openPersistentReactiveIndex<K = unknown, V = unknown>(
	opts: OpenPersistentReactiveIndexOptions<K, V>,
): Promise<PersistentReactiveIndex<K, V>> {
	const storagePrefix = opts.storagePrefix ?? opts.name ?? "reactive-collection";
	const snapshotKey = opts.snapshotKey ?? collectionSnapshotKey(storagePrefix);
	const loadOpts = { ...opts, snapshotKey, storagePrefix };
	return loadReactiveIndexState<K, V>(loadOpts).then((loaded) => {
		const state =
			loaded.source === "empty" && opts.initial !== undefined
				? { ...loaded, state: opts.initial }
				: loaded;
		const collection = restoreReactiveIndex<K, V>(state, {
			...(opts.collection ?? {}),
			graph: opts.graph,
			name: opts.name,
		});
		const persistence = persistReactiveCollection<V, "reactiveIndex">(opts.graph, collection, {
			...opts,
			kind: "reactiveIndex",
			name: opts.name ? `${opts.name}/persistence` : undefined,
			snapshotKey,
			storagePrefix,
			initialChangeCursor: loaded.changes.cursor,
		});
		return { collection, persistence, loaded };
	});
}
