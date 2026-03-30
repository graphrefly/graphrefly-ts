/**
 * Reactive append-only log (roadmap §3.2) — versioned snapshots and derived tail / slice views.
 */
import { batch } from "../core/batch.js";
import { DATA, DIRTY } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { derived, state } from "../core/sugar.js";
import { bumpVersion, snapshotEqualsVersion, type Versioned } from "./reactive-base.js";

export type ReactiveLogSnapshot<T> = Versioned<{ entries: readonly T[] }>;

export type ReactiveLogOptions = {
	name?: string;
	maxSize?: number;
};

export type ReactiveLogBundle<T> = {
	/** Emits {@link ReactiveLogSnapshot} on each append/clear (two-phase). */
	readonly entries: Node<ReactiveLogSnapshot<T>>;
	append: (value: T) => void;
	/** Push all values, trim once, emit one snapshot. */
	appendMany: (values: readonly T[]) => void;
	clear: () => void;
	/** Remove the first `n` entries; emits snapshot. */
	trimHead: (n: number) => void;
	/** Last `n` entries (or fewer); updates when the log changes. */
	tail: (n: number) => Node<readonly T[]>;
};

function emptySnapshot<T>(): ReactiveLogSnapshot<T> {
	return { version: 0, value: { entries: [] } };
}

function keepaliveDerived(n: Node<unknown>): void {
	void n.subscribe(() => {
		/* keep dep wiring alive for get() without a user sink (parity with graphrefly-py) */
	});
}

/**
 * Creates an append-only reactive log with versioned tuple snapshots.
 *
 * @param initial - Optional seed entries (copied).
 * @param options - Optional `name` for `describe()` / debugging.
 * @returns Bundle with `entries` (state node), `append`, `clear`, and {@link ReactiveLogBundle.tail}.
 *
 * @remarks
 * **Derived views:** {@link tail} and {@link logSlice} install an internal noop subscription so
 * `get()` stays wired without an external sink; creating very many disposable derived nodes can
 * retain subscriptions until the log bundle is unreachable.
 *
 * @example
 * ```ts
 * import { reactiveLog } from "@graphrefly/graphrefly-ts";
 *
 * const lg = reactiveLog<number>([1, 2], { name: "audit" });
 * lg.append(3);
 * lg.entries.subscribe((msgs) => console.log(msgs));
 * ```
 *
 * @category extra
 */
export function reactiveLog<T>(
	initial?: readonly T[],
	options: ReactiveLogOptions = {},
): ReactiveLogBundle<T> {
	const { name, maxSize } = options;
	if (maxSize !== undefined && maxSize < 1) {
		throw new RangeError("maxSize must be >= 1");
	}
	const buf: T[] = initial ? [...initial] : [];
	if (maxSize !== undefined && buf.length > maxSize) {
		buf.splice(0, buf.length - maxSize);
	}
	let current: ReactiveLogSnapshot<T> =
		buf.length > 0 ? { version: 1, value: { entries: [...buf] } } : emptySnapshot();

	const entries = state<ReactiveLogSnapshot<T>>(current, {
		name,
		describeKind: "state",
		equals: snapshotEqualsVersion,
	});

	function pushSnapshot(): void {
		current = bumpVersion(current, { entries: [...buf] });
		batch(() => {
			entries.down([[DIRTY]]);
			entries.down([[DATA, current]]);
		});
	}

	function trimBuf(): void {
		if (maxSize !== undefined && buf.length > maxSize) {
			buf.splice(0, buf.length - maxSize);
		}
	}

	const bundle: ReactiveLogBundle<T> = {
		entries,

		append(value: T): void {
			buf.push(value);
			trimBuf();
			pushSnapshot();
		},

		appendMany(values: readonly T[]): void {
			if (values.length === 0) return;
			buf.push(...values);
			trimBuf();
			pushSnapshot();
		},

		clear(): void {
			if (buf.length === 0) return;
			buf.length = 0;
			pushSnapshot();
		},

		trimHead(n: number): void {
			if (n < 0) {
				throw new RangeError("n must be >= 0");
			}
			if (n === 0) return;
			if (n >= buf.length) {
				if (buf.length === 0) return;
				buf.length = 0;
			} else {
				buf.splice(0, n);
			}
			pushSnapshot();
		},

		tail(n: number): Node<readonly T[]> {
			if (n < 0) {
				throw new RangeError("n must be >= 0");
			}
			const snap = entries.get() as ReactiveLogSnapshot<T>;
			const e = snap.value.entries;
			const init = n === 0 ? [] : e.slice(Math.max(0, e.length - n));
			const out = derived(
				[entries],
				([s]) => {
					const list = (s as ReactiveLogSnapshot<T>).value.entries;
					return n === 0 ? [] : list.slice(Math.max(0, list.length - n));
				},
				{ initial: init, describeKind: "derived" },
			);
			keepaliveDerived(out);
			return out;
		},
	};

	return bundle;
}

/**
 * Builds a derived node for `entries.slice(start, stop)` (same semantics as `Array.prototype.slice`; `stop` exclusive).
 *
 * @param log - Log from {@link reactiveLog}.
 * @param start - Start index (must be `>= 0`).
 * @param stop - End index (exclusive); omit to slice to the end.
 * @returns Derived node emitting the sliced readonly array.
 *
 * @category extra
 */
export function logSlice<T>(
	log: ReactiveLogBundle<T>,
	start: number,
	stop?: number,
): Node<readonly T[]> {
	if (start < 0) {
		throw new RangeError("start must be >= 0");
	}
	const snap = log.entries.get() as ReactiveLogSnapshot<T>;
	const e = snap.value.entries;
	const init = stop === undefined ? e.slice(start) : e.slice(start, stop);
	const out = derived(
		[log.entries],
		([s]) => {
			const list = (s as ReactiveLogSnapshot<T>).value.entries;
			return stop === undefined ? list.slice(start) : list.slice(start, stop);
		},
		{ initial: init, describeKind: "derived" },
	);
	keepaliveDerived(out);
	return out;
}
