/**
 * Reactive append-only log (roadmap §3.2) — emits `readonly T[]` snapshots directly.
 *
 * Internal version counter drives efficient equality without leaking `Versioned`
 * into the public API (spec §5.12).
 */
import { batch } from "../core/batch.js";
import { DATA, DIRTY } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { derived, state } from "../core/sugar.js";

export type ReactiveLogOptions = {
	name?: string;
	maxSize?: number;
};

export type ReactiveLogBundle<T> = {
	/** Emits `readonly T[]` on each append/clear (two-phase). */
	readonly entries: Node<readonly T[]>;
	append: (value: T) => void;
	/** Push all values, trim once, emit one snapshot. */
	appendMany: (values: readonly T[]) => void;
	clear: () => void;
	/** Remove the first `n` entries; emits snapshot. */
	trimHead: (n: number) => void;
	/** Last `n` entries (or fewer); updates when the log changes. */
	tail: (n: number) => Node<readonly T[]>;
};

/**
 * Keep a derived node's dep wiring alive for `get()` without a user sink.
 * Returns the unsubscribe handle so callers can clean up.
 *
 * @remarks Derived views (`tail`, `logSlice`) install this so `get()` stays
 * wired without an external sink. The returned disposer is currently not
 * exposed on the bundle — subscriptions are released when the log bundle
 * becomes unreachable and the GC collects the closure.
 */
function keepaliveDerived(n: Node<unknown>): () => void {
	return n.subscribe(() => {});
}

/**
 * Creates an append-only reactive log with immutable array snapshots.
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

	const entries = state<readonly T[]>(buf.length > 0 ? [...buf] : [], {
		name,
		describeKind: "state",
		equals: (a, b) => a === b,
	});

	function pushSnapshot(): void {
		const snapshot: readonly T[] = [...buf];
		batch(() => {
			entries.down([[DIRTY]]);
			entries.down([[DATA, snapshot]]);
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
			const e = entries.get() as readonly T[];
			const init = n === 0 ? [] : e.slice(Math.max(0, e.length - n));
			const out = derived(
				[entries],
				([s]) => {
					const list = s as readonly T[];
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
 * @example
 * ```ts
 * import { reactiveLog, logSlice } from "@graphrefly/graphrefly-ts";
 *
 * const lg = reactiveLog<number>([10, 20, 30, 40, 50]);
 * const slice$ = logSlice(lg, 1, 4); // reactive view of [20, 30, 40]
 * slice$.subscribe((msgs) => console.log(msgs));
 *
 * lg.append(60); // slice$ now reflects [20, 30, 40] (indices 1–3 of updated log)
 * ```
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
	const e = log.entries.get() as readonly T[];
	const init = stop === undefined ? e.slice(start) : e.slice(start, stop);
	const out = derived(
		[log.entries],
		([s]) => {
			const list = s as readonly T[];
			return stop === undefined ? list.slice(start) : list.slice(start, stop);
		},
		{ initial: init, describeKind: "derived" },
	);
	keepaliveDerived(out);
	return out;
}
