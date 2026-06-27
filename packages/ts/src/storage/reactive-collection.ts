import type {
	IndexChange,
	ListChange,
	LogChange,
	MapChange,
} from "../graph/data-structures/change.js";
import type { IndexRow } from "../graph/data-structures/reactive-index.js";
import { strictCanonicalJsonBytes, strictJsonCodecFor } from "../json/codec.js";
import type { AppendLogStorageTier } from "./append-log.js";
import type { Codec } from "./codec.js";
import type { KvStorageTier } from "./kv.js";

/** D161 strict-JSON snapshot frame format tag for reactive collection persistence. */
export const REACTIVE_COLLECTION_SNAPSHOT_FORMAT =
	"graphrefly.reactive-collection.snapshot.v1" as const;
/** D161 strict-JSON change frame format tag for reactive collection persistence. */
export const REACTIVE_COLLECTION_CHANGE_FORMAT =
	"graphrefly.reactive-collection.change.v1" as const;
/** D161 v1 frame version for reactive collection snapshot/change storage. */
export const REACTIVE_COLLECTION_FRAME_VERSION = 1 as const;

/** D161 collection kinds recognized by the unified persistence frame envelope. */
export type ReactiveCollectionStorageKind =
	| "reactiveList"
	| "reactiveLog"
	| "reactiveMap"
	| "reactiveIndex";

/** D161 durable baseline frame; storage is passive and does not own graph restore. */
export interface ReactiveCollectionSnapshotFrame<
	K extends ReactiveCollectionStorageKind = ReactiveCollectionStorageKind,
	S = unknown,
> {
	readonly format: typeof REACTIVE_COLLECTION_SNAPSHOT_FORMAT;
	readonly version: typeof REACTIVE_COLLECTION_FRAME_VERSION;
	readonly kind: K;
	/** Last append-log seq reflected by this snapshot; -1 means no change-log entry. */
	readonly changeCursor: number;
	readonly snapshot: S;
}

/** D161 append-log change frame; change-log replay is collection-state folding, not graph restore. */
export interface ReactiveCollectionChangeFrame<
	K extends ReactiveCollectionStorageKind = ReactiveCollectionStorageKind,
	C = unknown,
> {
	readonly format: typeof REACTIVE_COLLECTION_CHANGE_FORMAT;
	readonly version: typeof REACTIVE_COLLECTION_FRAME_VERSION;
	readonly kind: K;
	readonly change: C;
}

/** D161 passive load/fold result consumed by synchronous restoreReactive* helpers. */
export interface ReactiveCollectionRestoreState<
	K extends ReactiveCollectionStorageKind = ReactiveCollectionStorageKind,
	S = unknown,
> {
	readonly kind: K;
	readonly state: S;
	readonly source: "empty" | "changes" | "snapshot" | "snapshot+changes";
	readonly snapshot: { readonly found: boolean; readonly changeCursor: number };
	readonly changes: { readonly applied: number; readonly cursor: number };
}

/** D161 restore state for a reactiveList materialized as a strict-JSON array snapshot. */
export type ReactiveListRestoreState<T = unknown> = ReactiveCollectionRestoreState<
	"reactiveList",
	readonly T[]
>;

/** D161 restore state for a reactiveLog materialized as a strict-JSON array snapshot. */
export type ReactiveLogRestoreState<T = unknown> = ReactiveCollectionRestoreState<
	"reactiveLog",
	readonly T[]
>;

/** D161 passive restore-state shape for reactiveMap; policy-aware restore remains deferred. */
export type ReactiveMapRestoreState<K = unknown, V = unknown> = ReactiveCollectionRestoreState<
	"reactiveMap",
	readonly (readonly [K, V])[]
>;

/** D161 passive restore-state shape for reactiveIndex; key-codec restore remains deferred. */
export type ReactiveIndexRestoreState<K = unknown, V = unknown> = ReactiveCollectionRestoreState<
	"reactiveIndex",
	readonly IndexRow<K, V>[]
>;

/** D161 passive storage inputs for collection load/fold helpers. */
export interface LoadReactiveCollectionStateOptions {
	readonly snapshotStore: KvStorageTier<unknown>;
	readonly snapshotKey?: string;
	readonly storagePrefix?: string;
	readonly changeLog?: AppendLogStorageTier<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownKeys(value: Record<string, unknown>): readonly string[] {
	return Object.keys(value).sort();
}

function assertKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	label: string,
): void {
	const actual = ownKeys(value);
	const want = [...expected].sort();
	if (actual.length !== want.length || actual.some((key, i) => key !== want[i])) {
		throw new TypeError(`${label}: unexpected frame fields ${actual.join(",")}`);
	}
}

function assertSafeInteger(value: unknown, label: string, min = 0): number {
	if (!Number.isSafeInteger(value) || (value as number) < min) {
		throw new TypeError(`${label} must be a safe integer >= ${min}`);
	}
	return value as number;
}

function assertKind<K extends ReactiveCollectionStorageKind>(
	value: unknown,
	expected: K,
	label: string,
): K {
	if (value !== expected) throw new TypeError(`${label}: kind must be ${expected}`);
	return expected;
}

function assertArray<T = unknown>(value: unknown, label: string): readonly T[] {
	if (!Array.isArray(value)) throw new TypeError(`${label}: snapshot must be an array`);
	return value as readonly T[];
}

function strictJsonIdentity(value: unknown): string {
	return Array.from(strictCanonicalJsonBytes(value)).join(",");
}

function assertEntryArray<K = unknown, V = unknown>(
	value: unknown,
	label: string,
): readonly (readonly [K, V])[] {
	const entries = assertArray<unknown>(value, label);
	const seen = new Set<string>();
	for (const [i, entry] of entries.entries()) {
		if (!Array.isArray(entry) || entry.length !== 2) {
			throw new TypeError(`${label}: entry ${i} must be [key,value]`);
		}
		const key = strictJsonIdentity(entry[0]);
		if (seen.has(key)) throw new TypeError(`${label}: entry ${i} duplicates an earlier key`);
		seen.add(key);
	}
	return entries as readonly (readonly [K, V])[];
}

function assertIndexRows<K = unknown, V = unknown>(
	value: unknown,
	label: string,
): readonly IndexRow<K, V>[] {
	const rows = assertArray<unknown>(value, label);
	const seen = new Set<string>();
	for (const [i, row] of rows.entries()) {
		if (!isRecord(row)) throw new TypeError(`${label}: row ${i} must be an object`);
		assertKeys(row, ["primary", "secondary", "value"], `${label} row`);
		const primary = strictJsonIdentity(row.primary);
		if (seen.has(primary)) {
			throw new TypeError(`${label}: row ${i} duplicates an earlier primary`);
		}
		seen.add(primary);
	}
	return rows as readonly IndexRow<K, V>[];
}

/** Build the default D161 snapshot key for a storage prefix. */
export function collectionSnapshotKey(storagePrefix = "reactive-collection"): string {
	if (storagePrefix.length === 0) throw new TypeError("storagePrefix must be non-empty");
	return `${storagePrefix}/snapshot`;
}

/** Build a D161 strict-JSON snapshot frame before validation/encoding. */
export function reactiveCollectionSnapshotFrame<K extends ReactiveCollectionStorageKind, S>(
	kind: K,
	snapshot: S,
	opts: { readonly changeCursor?: number } = {},
): ReactiveCollectionSnapshotFrame<K, S> {
	const changeCursor = opts.changeCursor ?? -1;
	if (!Number.isSafeInteger(changeCursor) || changeCursor < -1) {
		throw new RangeError("reactive collection snapshot changeCursor must be a safe integer >= -1");
	}
	return {
		format: REACTIVE_COLLECTION_SNAPSHOT_FORMAT,
		version: REACTIVE_COLLECTION_FRAME_VERSION,
		kind,
		changeCursor,
		snapshot,
	};
}

/** Build a D161 strict-JSON change frame before validation/encoding. */
export function reactiveCollectionChangeFrame<K extends ReactiveCollectionStorageKind, C>(
	kind: K,
	change: C,
): ReactiveCollectionChangeFrame<K, C> {
	return {
		format: REACTIVE_COLLECTION_CHANGE_FORMAT,
		version: REACTIVE_COLLECTION_FRAME_VERSION,
		kind,
		change,
	};
}

/** Validate a D161 snapshot frame and reject non-strict-JSON payloads honestly. */
export function assertReactiveCollectionSnapshotFrame<
	K extends ReactiveCollectionStorageKind,
	S = unknown,
>(value: unknown, expectedKind: K): ReactiveCollectionSnapshotFrame<K, S> {
	if (!isRecord(value)) throw new TypeError("reactive collection snapshot frame must be an object");
	assertKeys(value, ["changeCursor", "format", "kind", "snapshot", "version"], "snapshot frame");
	if (value.format !== REACTIVE_COLLECTION_SNAPSHOT_FORMAT) {
		throw new TypeError("snapshot frame: invalid format");
	}
	if (value.version !== REACTIVE_COLLECTION_FRAME_VERSION) {
		throw new TypeError("snapshot frame: invalid version");
	}
	assertKind(value.kind, expectedKind, "snapshot frame");
	assertSafeInteger(value.changeCursor, "snapshot frame changeCursor", -1);
	strictJsonCodecFor<unknown>().encode(value);
	return value as unknown as ReactiveCollectionSnapshotFrame<K, S>;
}

/** Validate a D161 change frame and reject non-strict-JSON payloads honestly. */
export function assertReactiveCollectionChangeFrame<
	K extends ReactiveCollectionStorageKind,
	C = unknown,
>(value: unknown, expectedKind: K): ReactiveCollectionChangeFrame<K, C> {
	if (!isRecord(value)) throw new TypeError("reactive collection change frame must be an object");
	assertKeys(value, ["change", "format", "kind", "version"], "change frame");
	if (value.format !== REACTIVE_COLLECTION_CHANGE_FORMAT) {
		throw new TypeError("change frame: invalid format");
	}
	if (value.version !== REACTIVE_COLLECTION_FRAME_VERSION) {
		throw new TypeError("change frame: invalid version");
	}
	assertKind(value.kind, expectedKind, "change frame");
	if (!Object.hasOwn(value, "change")) throw new TypeError("change frame: change is required");
	strictJsonCodecFor<unknown>().encode(value);
	return value as unknown as ReactiveCollectionChangeFrame<K, C>;
}

/** Codec for D161 snapshot frames with strict JSON validation on both encode and decode. */
export function reactiveCollectionSnapshotFrameCodec<
	K extends ReactiveCollectionStorageKind,
	S = unknown,
>(kind: K): Codec<ReactiveCollectionSnapshotFrame<K, S>> {
	const codec = strictJsonCodecFor<unknown>();
	return {
		encode(value) {
			return codec.encode(assertReactiveCollectionSnapshotFrame<K, S>(value, kind));
		},
		decode(bytes) {
			return assertReactiveCollectionSnapshotFrame<K, S>(codec.decode(bytes), kind);
		},
	};
}

/** Codec for D161 change frames with strict JSON validation on both encode and decode. */
export function reactiveCollectionChangeFrameCodec<
	K extends ReactiveCollectionStorageKind,
	C = unknown,
>(kind: K): Codec<ReactiveCollectionChangeFrame<K, C>> {
	const codec = strictJsonCodecFor<unknown>();
	return {
		encode(value) {
			return codec.encode(assertReactiveCollectionChangeFrame<K, C>(value, kind));
		},
		decode(bytes) {
			return assertReactiveCollectionChangeFrame<K, C>(codec.decode(bytes), kind);
		},
	};
}

function assertListChange<T>(value: unknown): ListChange<T> {
	if (!isRecord(value) || typeof value.kind !== "string") {
		throw new TypeError("reactiveList change must be an object with kind");
	}
	switch (value.kind) {
		case "append":
			if (!Object.hasOwn(value, "value")) throw new TypeError("reactiveList append.value required");
			assertKeys(value, ["kind", "value"], "reactiveList append");
			return value as unknown as ListChange<T>;
		case "appendMany":
			assertKeys(value, ["kind", "values"], "reactiveList appendMany");
			assertArray<T>(value.values, "reactiveList appendMany.values");
			return value as unknown as ListChange<T>;
		case "insert":
			assertKeys(value, ["index", "kind", "value"], "reactiveList insert");
			assertSafeInteger(value.index, "reactiveList insert.index", 0);
			return value as unknown as ListChange<T>;
		case "insertMany":
			assertKeys(value, ["index", "kind", "values"], "reactiveList insertMany");
			assertSafeInteger(value.index, "reactiveList insertMany.index", 0);
			assertArray<T>(value.values, "reactiveList insertMany.values");
			return value as unknown as ListChange<T>;
		case "pop":
			assertKeys(value, ["index", "kind", "value"], "reactiveList pop");
			assertSafeInteger(value.index, "reactiveList pop.index", 0);
			return value as unknown as ListChange<T>;
		case "trimHead":
			assertKeys(value, ["kind", "n"], "reactiveList trimHead");
			assertSafeInteger(value.n, "reactiveList trimHead.n", 0);
			return value as unknown as ListChange<T>;
		case "clear":
			assertKeys(value, ["count", "kind"], "reactiveList clear");
			assertSafeInteger(value.count, "reactiveList clear.count", 0);
			return value as unknown as ListChange<T>;
		default:
			throw new TypeError(`unsupported reactiveList change kind ${value.kind}`);
	}
}

function assertLogChange<T>(value: unknown): LogChange<T> {
	if (!isRecord(value) || typeof value.kind !== "string") {
		throw new TypeError("reactiveLog change must be an object with kind");
	}
	switch (value.kind) {
		case "append":
			if (!Object.hasOwn(value, "value")) throw new TypeError("reactiveLog append.value required");
			assertKeys(value, ["kind", "value"], "reactiveLog append");
			return value as unknown as LogChange<T>;
		case "appendMany":
			assertKeys(value, ["kind", "values"], "reactiveLog appendMany");
			assertArray<T>(value.values, "reactiveLog appendMany.values");
			return value as unknown as LogChange<T>;
		case "trimHead":
			assertKeys(value, ["kind", "n"], "reactiveLog trimHead");
			assertSafeInteger(value.n, "reactiveLog trimHead.n", 0);
			return value as unknown as LogChange<T>;
		case "clear":
			assertKeys(value, ["count", "kind"], "reactiveLog clear");
			assertSafeInteger(value.count, "reactiveLog clear.count", 0);
			return value as unknown as LogChange<T>;
		default:
			throw new TypeError(`unsupported reactiveLog change kind ${value.kind}`);
	}
}

function assertMapChange<K, V>(value: unknown): MapChange<K, V> {
	if (!isRecord(value) || typeof value.kind !== "string") {
		throw new TypeError("reactiveMap change must be an object with kind");
	}
	switch (value.kind) {
		case "set":
			if (!Object.hasOwn(value, "key")) throw new TypeError("reactiveMap set.key required");
			if (!Object.hasOwn(value, "value")) throw new TypeError("reactiveMap set.value required");
			assertKeys(value, ["key", "kind", "value"], "reactiveMap set");
			return value as unknown as MapChange<K, V>;
		case "delete":
			if (!Object.hasOwn(value, "key")) throw new TypeError("reactiveMap delete.key required");
			if (!Object.hasOwn(value, "previous")) {
				throw new TypeError("reactiveMap delete.previous required");
			}
			assertKeys(value, ["key", "kind", "previous", "reason"], "reactiveMap delete");
			if (
				value.reason !== "expired" &&
				value.reason !== "lru-evict" &&
				value.reason !== "archived" &&
				value.reason !== "explicit"
			) {
				throw new TypeError("reactiveMap delete.reason is invalid");
			}
			return value as unknown as MapChange<K, V>;
		case "clear":
			assertKeys(value, ["count", "kind"], "reactiveMap clear");
			assertSafeInteger(value.count, "reactiveMap clear.count", 0);
			return value as unknown as MapChange<K, V>;
		default:
			throw new TypeError(`unsupported reactiveMap change kind ${value.kind}`);
	}
}

function assertIndexChange<K, V>(value: unknown): IndexChange<K, V> {
	if (!isRecord(value) || typeof value.kind !== "string") {
		throw new TypeError("reactiveIndex change must be an object with kind");
	}
	switch (value.kind) {
		case "upsert":
			if (!Object.hasOwn(value, "primary")) {
				throw new TypeError("reactiveIndex upsert.primary required");
			}
			if (!Object.hasOwn(value, "secondary")) {
				throw new TypeError("reactiveIndex upsert.secondary required");
			}
			if (!Object.hasOwn(value, "value"))
				throw new TypeError("reactiveIndex upsert.value required");
			assertKeys(value, ["kind", "primary", "secondary", "value"], "reactiveIndex upsert");
			return value as unknown as IndexChange<K, V>;
		case "delete":
			if (!Object.hasOwn(value, "primary")) {
				throw new TypeError("reactiveIndex delete.primary required");
			}
			assertKeys(value, ["kind", "primary"], "reactiveIndex delete");
			return value as unknown as IndexChange<K, V>;
		case "deleteMany":
			assertKeys(value, ["kind", "primaries"], "reactiveIndex deleteMany");
			assertArray<K>(value.primaries, "reactiveIndex deleteMany.primaries");
			return value as unknown as IndexChange<K, V>;
		case "clear":
			assertKeys(value, ["count", "kind"], "reactiveIndex clear");
			assertSafeInteger(value.count, "reactiveIndex clear.count", 0);
			return value as unknown as IndexChange<K, V>;
		default:
			throw new TypeError(`unsupported reactiveIndex change kind ${value.kind}`);
	}
}

function applyListChange<T>(state: T[], change: ListChange<T>): void {
	switch (change.kind) {
		case "append":
			state.push(change.value);
			return;
		case "appendMany":
			state.push(...change.values);
			return;
		case "insert":
			if (change.index > state.length)
				throw new Error("reactiveList insert change is out of range");
			state.splice(change.index, 0, change.value);
			return;
		case "insertMany":
			if (change.index > state.length) {
				throw new Error("reactiveList insertMany change is out of range");
			}
			state.splice(change.index, 0, ...change.values);
			return;
		case "pop":
			if (change.index >= state.length) throw new Error("reactiveList pop change is out of range");
			if (!strictJsonEquals(state[change.index], change.value)) {
				throw new Error("reactiveList pop change value does not match current state");
			}
			state.splice(change.index, 1);
			return;
		case "trimHead":
			if (change.n > state.length) throw new Error("reactiveList trimHead change is out of range");
			state.splice(0, change.n);
			return;
		case "clear":
			if (change.count !== state.length) {
				throw new Error("reactiveList clear change count does not match current state");
			}
			state.length = 0;
			return;
	}
}

function strictJsonEquals(a: unknown, b: unknown): boolean {
	const left = strictCanonicalJsonBytes(a);
	const right = strictCanonicalJsonBytes(b);
	if (left.byteLength !== right.byteLength) return false;
	for (let i = 0; i < left.byteLength; i += 1) if (left[i] !== right[i]) return false;
	return true;
}

function findJsonIndex<T>(
	values: readonly T[],
	match: (value: T) => unknown,
	key: unknown,
	label: string,
): number {
	let found = -1;
	for (let i = 0; i < values.length; i += 1) {
		if (strictJsonEquals(match(values[i] as T), key)) {
			if (found !== -1) throw new Error(`${label} duplicate JSON key in restore state`);
			found = i;
		}
	}
	return found;
}

function cmpOrd(a: unknown, b: unknown): number {
	if (a === b) return 0;
	const ta = typeof a;
	if (
		ta === typeof b &&
		(ta === "number" || ta === "string" || ta === "boolean" || ta === "bigint")
	) {
		const ax = a as number | string | bigint | boolean;
		const bx = b as number | string | bigint | boolean;
		return ax < bx ? -1 : ax > bx ? 1 : 0;
	}
	return String(a).localeCompare(String(b));
}

function applyLogChange<T>(state: T[], change: LogChange<T>): void {
	switch (change.kind) {
		case "append":
			state.push(change.value);
			return;
		case "appendMany":
			state.push(...change.values);
			return;
		case "trimHead":
			if (change.n > state.length) throw new Error("reactiveLog trimHead change is out of range");
			state.splice(0, change.n);
			return;
		case "clear":
			if (change.count !== state.length) {
				throw new Error("reactiveLog clear change count does not match current state");
			}
			state.length = 0;
			return;
	}
}

function applyMapChange<K, V>(state: Array<readonly [K, V]>, change: MapChange<K, V>): void {
	switch (change.kind) {
		case "set": {
			const index = findJsonIndex(state, ([key]) => key, change.key, "reactiveMap");
			if (index === -1) state.push([change.key, change.value] as const);
			else state[index] = [change.key, change.value] as const;
			return;
		}
		case "delete": {
			const index = findJsonIndex(state, ([key]) => key, change.key, "reactiveMap");
			if (index === -1) throw new Error("reactiveMap delete change key is missing");
			if (!strictJsonEquals(state[index]?.[1], change.previous)) {
				throw new Error("reactiveMap delete change previous value does not match current state");
			}
			state.splice(index, 1);
			return;
		}
		case "clear":
			if (change.count !== state.length) {
				throw new Error("reactiveMap clear change count does not match current state");
			}
			state.length = 0;
			return;
	}
}

function sortIndexRows<K, V>(state: Array<IndexRow<K, V>>): void {
	state.sort((a, b) => {
		const bySecondary = cmpOrd(a.secondary, b.secondary);
		return bySecondary === 0 ? cmpOrd(a.primary, b.primary) : bySecondary;
	});
}

function applyIndexChange<K, V>(state: Array<IndexRow<K, V>>, change: IndexChange<K, V>): void {
	switch (change.kind) {
		case "upsert": {
			const index = findJsonIndex(state, (row) => row.primary, change.primary, "reactiveIndex");
			const row: IndexRow<K, V> = {
				primary: change.primary,
				secondary: change.secondary,
				value: change.value,
			};
			if (index === -1) state.push(row);
			else state[index] = row;
			sortIndexRows(state);
			return;
		}
		case "delete": {
			const index = findJsonIndex(state, (row) => row.primary, change.primary, "reactiveIndex");
			if (index === -1) throw new Error("reactiveIndex delete change primary is missing");
			state.splice(index, 1);
			return;
		}
		case "deleteMany": {
			for (const primary of change.primaries) {
				const index = findJsonIndex(state, (row) => row.primary, primary, "reactiveIndex");
				if (index === -1) {
					throw new Error("reactiveIndex deleteMany change primary is missing");
				}
				state.splice(index, 1);
			}
			return;
		}
		case "clear":
			if (change.count !== state.length) {
				throw new Error("reactiveIndex clear change count does not match current state");
			}
			state.length = 0;
			return;
	}
}

function finishState<K extends ReactiveCollectionStorageKind, T>(
	kind: K,
	state: T[],
	snapshotFound: boolean,
	snapshotCursor: number,
	applied: number,
	cursor: number,
): ReactiveCollectionRestoreState<K, readonly T[]> {
	return {
		kind,
		state,
		source: snapshotFound
			? applied > 0
				? "snapshot+changes"
				: "snapshot"
			: applied > 0
				? "changes"
				: "empty",
		snapshot: { found: snapshotFound, changeCursor: snapshotCursor },
		changes: { applied, cursor },
	};
}

function loadState<K extends ReactiveCollectionStorageKind, T, C>(
	kind: K,
	opts: LoadReactiveCollectionStateOptions,
	assertSnapshot: (value: unknown) => readonly T[],
	assertChange: (value: unknown) => C,
	applyChange: (state: T[], change: C) => void,
): Promise<ReactiveCollectionRestoreState<K, readonly T[]>> {
	const key = opts.snapshotKey ?? collectionSnapshotKey(opts.storagePrefix);
	return opts.snapshotStore.get(key).then((snapshotValue) => {
		let snapshotFound = false;
		let snapshotCursor = -1;
		let state: T[] = [];

		if (snapshotValue !== undefined) {
			const frame = assertReactiveCollectionSnapshotFrame<K, readonly T[]>(snapshotValue, kind);
			state = [...assertSnapshot(frame.snapshot)];
			snapshotFound = true;
			snapshotCursor = frame.changeCursor;
		}

		if (opts.changeLog === undefined) {
			return finishState(kind, state, snapshotFound, snapshotCursor, 0, snapshotCursor);
		}

		return opts.changeLog.read({ after: snapshotCursor }).then((entries) => {
			let applied = 0;
			let cursor = snapshotCursor;
			for (const entry of entries) {
				const expectedSeq = cursor + 1;
				if (!Number.isSafeInteger(entry.seq) || entry.seq !== expectedSeq) {
					throw new Error(
						`reactive collection change log is non-contiguous: expected seq ${expectedSeq}, got ${entry.seq}`,
					);
				}
				const frame = assertReactiveCollectionChangeFrame<K, C>(entry.value, kind);
				const change = assertChange(frame.change);
				applyChange(state, change);
				applied += 1;
				cursor = entry.seq;
			}
			return finishState(kind, state, snapshotFound, snapshotCursor, applied, cursor);
		});
	});
}

/** D161 passive load/fold for reactiveList; reads storage but never mutates graph topology. */
export function loadReactiveListState<T = unknown>(
	opts: LoadReactiveCollectionStateOptions,
): Promise<ReactiveListRestoreState<T>> {
	return loadState<"reactiveList", T, ListChange<T>>(
		"reactiveList",
		opts,
		(value) => assertArray<T>(value, "reactiveList snapshot"),
		assertListChange,
		applyListChange,
	);
}

/** D161 passive load/fold for reactiveLog; reads storage but never mutates graph topology. */
export function loadReactiveLogState<T = unknown>(
	opts: LoadReactiveCollectionStateOptions,
): Promise<ReactiveLogRestoreState<T>> {
	return loadState<"reactiveLog", T, LogChange<T>>(
		"reactiveLog",
		opts,
		(value) => assertArray<T>(value, "reactiveLog snapshot"),
		assertLogChange,
		applyLogChange,
	);
}

/** D161 passive load/fold scaffold for reactiveMap; synchronous policy restore is deferred. */
export function loadReactiveMapState<K = unknown, V = unknown>(
	opts: LoadReactiveCollectionStateOptions,
): Promise<ReactiveMapRestoreState<K, V>> {
	return loadState<"reactiveMap", readonly [K, V], MapChange<K, V>>(
		"reactiveMap",
		opts,
		(value) => assertEntryArray<K, V>(value, "reactiveMap snapshot"),
		assertMapChange,
		applyMapChange,
	);
}

/** D161 passive load/fold scaffold for reactiveIndex; key-codec restore is deferred. */
export function loadReactiveIndexState<K = unknown, V = unknown>(
	opts: LoadReactiveCollectionStateOptions,
): Promise<ReactiveIndexRestoreState<K, V>> {
	return loadState<"reactiveIndex", IndexRow<K, V>, IndexChange<K, V>>(
		"reactiveIndex",
		opts,
		(value) => assertIndexRows<K, V>(value, "reactiveIndex snapshot"),
		assertIndexChange,
		applyIndexChange,
	);
}
