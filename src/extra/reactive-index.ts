/**
 * Dual-key sorted index (roadmap §3.2) — unique primary key, rows ordered by `(secondary, primary)`.
 */
import { batch } from "../core/batch.js";
import { DATA, DIRTY } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { derived, state } from "../core/sugar.js";
import { bumpVersion, snapshotEqualsVersion, type Versioned } from "./reactive-base.js";

export type IndexRow<K, V = unknown> = {
	readonly primary: K;
	readonly secondary: unknown;
	readonly value: V;
};

export type ReactiveIndexSnapshot<K, V = unknown> = Versioned<{ rows: readonly IndexRow<K, V>[] }>;

export type ReactiveIndexOptions = {
	name?: string;
};

export type ReactiveIndexBundle<K, V = unknown> = {
	/** Rows sorted by `(secondary, primary)`; versioned snapshots. */
	readonly ordered: Node<ReactiveIndexSnapshot<K, V>>;
	/** Map from primary key to stored value. */
	readonly byPrimary: Node<ReadonlyMap<K, V>>;
	upsert: (primary: K, secondary: unknown, value: V) => void;
	delete: (primary: K) => void;
	clear: () => void;
};

function emptySnapshot<K, V>(): ReactiveIndexSnapshot<K, V> {
	return { version: 0, value: { rows: [] } };
}

function rowKey<K, V>(row: IndexRow<K, V>): [unknown, K] {
	return [row.secondary, row.primary];
}

/** Lexicographic ordering for index keys (mirrors Python tuple compare for typical primitives). */
function cmpOrd(a: unknown, b: unknown): number {
	if (a === b) return 0;
	const ta = typeof a;
	const tb = typeof b;
	if (ta === tb && (ta === "number" || ta === "string" || ta === "boolean" || ta === "bigint")) {
		const ax = a as number | string | boolean | bigint;
		const bx = b as number | string | boolean | bigint;
		if (ax < bx) return -1;
		if (ax > bx) return 1;
		return 0;
	}
	return String(a).localeCompare(String(b));
}

function compareKeys<K>(a: [unknown, K], b: [unknown, K]): number {
	let c = cmpOrd(a[0], b[0]);
	if (c !== 0) return c;
	c = cmpOrd(a[1], b[1]);
	return c;
}

function bisectLeft<K, V>(rows: readonly IndexRow<K, V>[], row: IndexRow<K, V>): number {
	const k = rowKey(row);
	let lo = 0;
	let hi = rows.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (compareKeys(k, rowKey(rows[mid]!)) > 0) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

function byPrimaryMap<K, V>(rows: readonly IndexRow<K, V>[]): Map<K, V> {
	const m = new Map<K, V>();
	for (const r of rows) m.set(r.primary, r.value);
	return m;
}

function keepaliveDerived(n: Node<unknown>): void {
	void n.subscribe(() => {});
}

/**
 * Creates a reactive index: unique primary key per row, rows sorted by `(secondary, primary)` for ordered scans.
 *
 * @param options - Optional `name` for `describe()` / debugging.
 * @returns Bundle with `ordered` (versioned rows), `byPrimary` (map), and imperative `upsert` / `delete` / `clear`.
 *
 * @remarks
 * **Ordering:** `secondary` and `primary` are compared via a small total order: same primitive `typeof` uses
 * numeric/string/boolean/bigint comparison; mixed or object keys fall back to `String(a).localeCompare(String(b))`
 * (not identical to Python’s rich comparison for exotic types).
 *
 * @example
 * ```ts
 * import { reactiveIndex } from "@graphrefly/graphrefly-ts";
 *
 * const idx = reactiveIndex<string, string>();
 * idx.upsert("id1", 10, "row-a");
 * idx.upsert("id2", 5, "row-b");
 * ```
 *
 * @category extra
 */
export function reactiveIndex<K, V = unknown>(
	options: ReactiveIndexOptions = {},
): ReactiveIndexBundle<K, V> {
	const { name } = options;
	const buf: IndexRow<K, V>[] = [];
	let current = emptySnapshot<K, V>();

	const ordered = state<ReactiveIndexSnapshot<K, V>>(current, {
		name,
		describeKind: "state",
		equals: snapshotEqualsVersion,
	});

	const byPrimary = derived(
		[ordered],
		([s]) => {
			const rows = (s as ReactiveIndexSnapshot<K, V>).value.rows;
			return byPrimaryMap(rows);
		},
		{ initial: new Map<K, V>(), describeKind: "derived" },
	);
	keepaliveDerived(byPrimary);

	function pushSnapshot(): void {
		current = bumpVersion(current, { rows: [...buf] });
		batch(() => {
			ordered.down([[DIRTY]]);
			ordered.down([[DATA, current]]);
		});
	}

	return {
		ordered,
		byPrimary,

		upsert(primary: K, secondary: unknown, value: V): void {
			const next = buf.filter((r) => r.primary !== primary);
			const row: IndexRow<K, V> = { primary, secondary, value };
			const pos = bisectLeft(next, row);
			next.splice(pos, 0, row);
			buf.length = 0;
			buf.push(...next);
			pushSnapshot();
		},

		delete(primary: K): void {
			const next = buf.filter((r) => r.primary !== primary);
			if (next.length === buf.length) return;
			buf.length = 0;
			buf.push(...next);
			pushSnapshot();
		},

		clear(): void {
			if (buf.length === 0) return;
			buf.length = 0;
			pushSnapshot();
		},
	};
}
