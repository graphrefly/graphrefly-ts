/**
 * Reactive positional list (roadmap §3.2) — emits `readonly T[]` snapshots directly.
 *
 * Internal version counter drives efficient equality without leaking `Versioned`
 * into the public API (spec §5.12).
 */
import { batch } from "../core/batch.js";
import { DATA, DIRTY } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { state } from "../core/sugar.js";

export type ReactiveListOptions = {
	name?: string;
};

export type ReactiveListBundle<T> = {
	/** Emits `readonly T[]` on each structural change (two-phase). */
	readonly items: Node<readonly T[]>;
	append: (value: T) => void;
	insert: (index: number, value: T) => void;
	pop: (index?: number) => T;
	clear: () => void;
};

/**
 * Creates a reactive list with immutable array snapshots.
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

	const items = state<readonly T[]>(buf.length > 0 ? [...buf] : [], {
		name,
		describeKind: "state",
		equals: (a, b) => a === b,
	});

	function pushSnapshot(): void {
		const snapshot: readonly T[] = [...buf];
		batch(() => {
			items.down([[DIRTY]]);
			items.down([[DATA, snapshot]]);
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
