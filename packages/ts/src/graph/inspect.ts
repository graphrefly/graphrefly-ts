/**
 * observe / topology-event / profile shapes.
 *
 * observe is R-graph-surface@1's: an ordinary subscriber handing on one event per array.
 * Topology events (D145) and profile, an opt-in accumulated-counter snapshot backed by the
 * dispatcher recorder, are this package's own.
 */

import type { Status } from "../node/node.js";
import type { Wave } from "../protocol/messages.js";

/** One event of observe() (R-graph-surface@1): one array a node delivered. */
export interface ObserveEvent {
	/** The id of the node that delivered it, as given to observe(). */
	id: string;
	/** The array, as the node delivered it. */
	msgs: Wave;
}

export type TopologyEventKind =
	| "node-registered"
	| "deps-changed"
	| "node-released"
	| "mount-changed";

export interface TopologyEvent {
	/** D145 graph inspection/lifecycle event kind. Not a protocol message. */
	readonly kind: TopologyEventKind;
	/** Mount-aware `::` path of the affected registered node. */
	readonly path: string;
	/** Current dep ids after the event, matching describe().nodes[].deps. */
	readonly deps: readonly string[];
	/** Previous dep ids for deps-changed events. */
	readonly prevDeps?: readonly string[];
	/** Factory name for node-registered and node-released events. */
	readonly factory?: string;
	/** Graph-local monotonic sequence of topology events. */
	readonly seq: number;
}

/** A read-only topology egress stream. It does not activate nodes or emit DATA. */
export interface TopologyStream {
	subscribe(sink: (e: TopologyEvent) => void): () => void;
}

/** Per-node profile counters (D39). invokes/duration are dispatcher-backed (R-profile). */
export interface NodeProfile {
	invokes: number;
	totalDurationNs: number;
	lastDurationNs: number;
	status: Status;
}

/** profile() snapshot. Shares the mount-aware `::` path key with inspect(). */
export interface Profile {
	totalInvokes: number;
	nodes: Record<string, NodeProfile>;
}
