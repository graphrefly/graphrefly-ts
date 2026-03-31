import { DATA } from "../../core/messages.js";
import { state as stateNode } from "../../core/sugar.js";
import { Graph } from "../../graph/graph.js";

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
	const s = stateNode<T>(undefined as unknown as T, { name: "state" });
	g.add("state", s);

	const getState = () => s.get() as T;
	const setState = (partial: any, replace?: boolean): void => {
		const prev = getState();
		const next = typeof partial === "function" ? partial(prev) : partial;
		const nextState = replace ? next : { ...prev, ...next };
		s.down([[DATA, nextState]]);
	};

	const api: StoreApi<T> = {
		getState,
		setState,
		getInitialState: () => initialValue,
		subscribe: (listener) => {
			let prev = getState();
			return s.subscribe((msgs) => {
				for (const [t, v] of msgs) {
					if (t === DATA) {
						listener(v as T, prev);
						prev = v as T;
					}
				}
			});
		},
		destroy: g.destroy.bind(g),
	};

	const initialValue = initializer(setState, getState, api);
	s.down([[DATA, initialValue]]);

	return Object.assign(g, api);
}
