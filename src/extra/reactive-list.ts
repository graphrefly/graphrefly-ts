/**
 * Reactive positional list (roadmap §3.2) — tuple snapshot with append / insert / pop / clear.
 */
import { batch } from "../core/batch.js";
import { DATA, DIRTY } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { state } from "../core/sugar.js";
import { bumpVersion, snapshotEqualsVersion, type Versioned } from "./reactive-base.js";

export type ReactiveListSnapshot<T> = Versioned<{ items: readonly T[] }>;

export type ReactiveListOptions = {
	name?: string;
};

export type ReactiveListBundle<T> = {
	/** Emits {@link ReactiveListSnapshot} on each structural change (two-phase). */
	readonly items: Node<ReactiveListSnapshot<T>>;
	append: (value: T) => void;
	insert: (index: number, value: T) => void;
	pop: (index?: number) => T;
	clear: () => void;
};

function emptySnapshot<T>(): ReactiveListSnapshot<T> {
	return { version: 0, value: { items: [] } };
}

/**
 * Creates a reactive list with versioned immutable array snapshots.
 *
 * @param initial - Optional initial items (copied).
 * @param options - Optional `name` for `describe()` / debugging.
 * @returns Bundle with `items` (state node) and `append` / `insert` / `pop` / `clear`.
 *
 * @example
 * ```ts
 * import { reactiveList } from "@graphrefly/graphrefly-ts";
 *
 * const list = reactiveList<string>(["a"], { name: "queue" });
 * list.append("b");
 * ```
 *
 * @category extra
 */
export function reactiveList<T>(
	initial?: readonly T[],
	options: ReactiveListOptions = {},
): ReactiveListBundle<T> {
	const { name } = options;
	const buf: T[] = initial ? [...initial] : [];
	let current: ReactiveListSnapshot<T> =
		buf.length > 0 ? { version: 1, value: { items: [...buf] } } : emptySnapshot();

	const items = state<ReactiveListSnapshot<T>>(current, {
		name,
		describeKind: "state",
		equals: snapshotEqualsVersion,
	});

	function pushSnapshot(): void {
		const iv = items.v;
		current = bumpVersion(
			current,
			{ items: [...buf] },
			iv ? { id: iv.id, version: iv.version } : undefined,
		);
		batch(() => {
			items.down([[DIRTY]]);
			items.down([[DATA, current]]);
		});
	}

	return {
		items,

		append(value: T): void {
			buf.push(value);
			pushSnapshot();
		},

		insert(index: number, value: T): void {
			if (index < 0 || index > buf.length) {
				throw new RangeError("index out of range");
			}
			buf.splice(index, 0, value);
			pushSnapshot();
		},

		pop(index = -1): T {
			if (buf.length === 0) {
				throw new RangeError("pop from empty list");
			}
			const i = index >= 0 ? index : buf.length + index;
			if (i < 0 || i >= buf.length) {
				throw new RangeError("index out of range");
			}
			const [v] = buf.splice(i, 1);
			pushSnapshot();
			return v as T;
		},

		clear(): void {
			if (buf.length === 0) return;
			buf.length = 0;
			pushSnapshot();
		},
	};
}
