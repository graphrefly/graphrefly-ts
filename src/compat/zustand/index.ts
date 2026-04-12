import { DATA } from "../../core/messages.js";
import { state as stateNode } from "../../core/sugar.js";
import { Graph } from "../../graph/graph.js";

// Zustand fires listeners on every setState, regardless of reference
// equality. Configure the state node with a permissive equals so every
// emit produces DATA (not RESOLVED). Diamond coordination still works
// because `n.emit` routes through the framed pipeline which auto-
// prefixes `[DIRTY]`.
const alwaysDiffer = () => false;

/** Zustand-compatible Store API. */
export interface StoreApi<T> {
	getState: () => T;
	setState: (partial: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: boolean) => void;
	getInitialState: () => T;
	subscribe: (listener: (state: T, prevState: T) => void) => () => void;
	destroy: () => void;
}

/** Function type for initializing the store. */
export type StateCreator<T> = (
	set: StoreApi<T>["setState"],
	get: StoreApi<T>["getState"],
	api: StoreApi<T>,
) => T;

/**
 * Creates a Zustand-compatible store backed by a GraphReFly state node.
 * returns an object that is both a Graph and a StoreApi.
 *
 * @example
 * ```ts
 * const store = create((set) => ({
 *   count: 0,
 *   inc: () => set((s) => ({ count: s.count + 1 }))
 * }));
 * store.getState().inc();
 * ```
 *
 * @category compat
 */
export function create<T extends object>(initializer: StateCreator<T>): Graph & StoreApi<T> {
	const g = new Graph("zustand");
	const s = stateNode<T>(undefined as unknown as T, {
		name: "state",
		equals: alwaysDiffer,
	});
	g.add("state", s);

	const getState = () => s.cache as T;
	const setState = (partial: any, replace?: boolean): void => {
		const prev = getState();
		const next = typeof partial === "function" ? partial(prev) : partial;
		const nextState = replace ? next : { ...prev, ...next };
		// `n.emit` goes through `_actionEmit` → `bundle()`, which auto-
		// prefixes `[DIRTY]` so diamond legs coordinate under downstream
		// composition. The `alwaysDiffer` equals keeps zustand's "fire
		// on every setState" semantics — the framing is what matters
		// here, not the equality folding.
		s.emit(nextState);
	};

	const api: StoreApi<T> = {
		getState,
		setState,
		getInitialState: () => initialValue,
		subscribe: (listener) => {
			let prev = getState();
			// Skip the initial push-on-subscribe DATA — zustand subscribe fires on changes only.
			let initial = true;
			return s.subscribe((msgs) => {
				for (const [t, v] of msgs) {
					if (t === DATA) {
						if (initial) {
							initial = false;
							continue;
						}
						listener(v as T, prev);
						prev = v as T;
					}
				}
			});
		},
		destroy: g.destroy.bind(g),
	};

	const initialValue = initializer(setState, getState, api);
	s.emit(initialValue);

	return Object.assign(g, api);
}
