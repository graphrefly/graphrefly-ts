import type { Node } from "../../node/node.js";

/**
 * Public policy vocabulary (D80): shared option shapes only.
 *
 * Runtime policy mechanics stay structure-owned: each reactive collection still owns
 * backend mutation, victim application, delta emission, and graph-bound node-as-opt wiring.
 */
export type ReactiveOpt<T> = T | Node<T>;

/** Capacity vocabulary shared by structures that bound retained entries. */
export interface CapacityPolicy<Order extends string = never> {
	readonly maxSize: ReactiveOpt<number>;
	readonly order?: Order;
}

/** Capacity policy variant for structures whose eviction order must be explicit. */
export type OrderedCapacityPolicy<Order extends string> = CapacityPolicy<Order> & {
	readonly order: Order;
};

/** Score-based retention vocabulary; higher scores are retained. */
export interface RetentionPolicy<Entry> {
	readonly maxSize?: ReactiveOpt<number>;
	score(entry: Entry): number;
}

/**
 * Static view-cache vocabulary for memoized helper nodes.
 *
 * This is intentionally not a release/keepalive API: eviction may drop the structure's
 * memo reference, but externally held Node views remain valid.
 */
export interface ViewCachePolicy {
	readonly maxEntries?: number;
}
