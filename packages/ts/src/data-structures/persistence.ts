import type {
	IndexRow,
	ReactiveIndex,
	ReactiveIndexOptions,
} from "../graph/data-structures/reactive-index.js";
import { restoreReactiveIndexFromBackendState } from "../graph/data-structures/reactive-index.js";
import type { ReactiveListOptions } from "../graph/data-structures/reactive-list.js";
import { type ReactiveList, reactiveList } from "../graph/data-structures/reactive-list.js";
import type { ReactiveLogOptions } from "../graph/data-structures/reactive-log.js";
import { type ReactiveLog, reactiveLog } from "../graph/data-structures/reactive-log.js";
import type { ReactiveMap, ReactiveMapOptions } from "../graph/data-structures/reactive-map.js";
import { restoreReactiveMapFromBackendState } from "../graph/data-structures/reactive-map.js";
import type {
	ReactiveIndexRestoreState,
	ReactiveListRestoreState,
	ReactiveLogRestoreState,
	ReactiveMapRestoreState,
} from "../storage/index.js";

function isListRestoreState<T>(
	state: ReactiveListRestoreState<T> | readonly T[],
): state is ReactiveListRestoreState<T> {
	return !Array.isArray(state);
}

function restoreListValues<T>(state: ReactiveListRestoreState<T> | readonly T[]): readonly T[] {
	if (!isListRestoreState(state)) return state;
	if (state.kind !== "reactiveList") throw new TypeError("restore state kind must be reactiveList");
	return state.state;
}

function isLogRestoreState<T>(
	state: ReactiveLogRestoreState<T> | readonly T[],
): state is ReactiveLogRestoreState<T> {
	return !Array.isArray(state);
}

function restoreLogValues<T>(state: ReactiveLogRestoreState<T> | readonly T[]): readonly T[] {
	if (!isLogRestoreState(state)) return state;
	if (state.kind !== "reactiveLog") throw new TypeError("restore state kind must be reactiveLog");
	return state.state;
}

function isMapRestoreState<K, V>(
	state: ReactiveMapRestoreState<K, V> | readonly (readonly [K, V])[],
): state is ReactiveMapRestoreState<K, V> {
	return !Array.isArray(state);
}

function restoreMapEntries<K, V>(
	state: ReactiveMapRestoreState<K, V> | readonly (readonly [K, V])[],
): readonly (readonly [K, V])[] {
	if (!isMapRestoreState(state)) return state;
	if (state.kind !== "reactiveMap") throw new TypeError("restore state kind must be reactiveMap");
	return state.state;
}

function isIndexRestoreState<K, V>(
	state: ReactiveIndexRestoreState<K, V> | readonly IndexRow<K, V>[],
): state is ReactiveIndexRestoreState<K, V> {
	return !Array.isArray(state);
}

function restoreIndexRows<K, V>(
	state: ReactiveIndexRestoreState<K, V> | readonly IndexRow<K, V>[],
): readonly IndexRow<K, V>[] {
	if (!isIndexRestoreState(state)) return state;
	if (state.kind !== "reactiveIndex") {
		throw new TypeError("restore state kind must be reactiveIndex");
	}
	return state.state;
}

/** D161 synchronous collection-owned restore. This helper never reads storage.
 * @param state - state value used by the helper.
 * @param options - Options that configure the helper.
 * @returns A `ReactiveList<T>` value.
 * @category data-structures
 * @example
 * ```ts
 * import { restoreReactiveList } from "@graphrefly/ts/data-structures";
 * ```
 */
export function restoreReactiveList<T = unknown>(
	state: ReactiveListRestoreState<T> | readonly T[],
	options: ReactiveListOptions = {},
): ReactiveList<T> {
	const values = restoreListValues(state);
	return reactiveList<T>(values, options);
}

/** D161 synchronous collection-owned restore. This helper never reads storage.
 * @param state - state value used by the helper.
 * @param options - Options that configure the helper.
 * @returns A `ReactiveLog<T>` value.
 * @category data-structures
 * @example
 * ```ts
 * import { restoreReactiveLog } from "@graphrefly/ts/data-structures";
 * ```
 */
export function restoreReactiveLog<T = unknown>(
	state: ReactiveLogRestoreState<T> | readonly T[],
	options: ReactiveLogOptions = {},
): ReactiveLog<T> {
	const values = restoreLogValues(state);
	return reactiveLog<T>(values, options);
}

/** D161 synchronous collection-owned restore for map entries; policy config still comes from options.
 * @param state - state value used by the helper.
 * @param options - Options that configure the helper.
 * @returns A `ReactiveMap<K, V>` value.
 * @category data-structures
 * @example
 * ```ts
 * import { restoreReactiveMap } from "@graphrefly/ts/data-structures";
 * ```
 */
export function restoreReactiveMap<K = unknown, V = unknown>(
	state: ReactiveMapRestoreState<K, V> | readonly (readonly [K, V])[],
	options: ReactiveMapOptions<K, V> = {},
): ReactiveMap<K, V> {
	const entries = restoreMapEntries(state);
	return restoreReactiveMapFromBackendState<K, V>(entries, options);
}

/** D161 synchronous collection-owned restore for sorted index rows; key-codec I/O stays outside.
 * @param state - state value used by the helper.
 * @param options - Options that configure the helper.
 * @returns A `ReactiveIndex<K, V>` value.
 * @category data-structures
 * @example
 * ```ts
 * import { restoreReactiveIndex } from "@graphrefly/ts/data-structures";
 * ```
 */
export function restoreReactiveIndex<K = unknown, V = unknown>(
	state: ReactiveIndexRestoreState<K, V> | readonly IndexRow<K, V>[],
	options: ReactiveIndexOptions = {},
): ReactiveIndex<K, V> {
	const rows = restoreIndexRows(state);
	return restoreReactiveIndexFromBackendState<K, V>(rows, options);
}
