/**
 * observe / profile inspection shapes (R-observe, R-profile / D39).
 *
 * observe = a read-only enveloped EGRESS (not a graph node). profile = an opt-in
 * accumulated-counter snapshot backed by the dispatcher recorder (counters never live on
 * the thin node, R-node-thin). Per-language (D24, never in parity).
 */

import type { Status } from "../node/node.js";
import type { Message } from "../protocol/messages.js";

/** One item of an observe() stream. The envelope carries node identity + ordering. */
export interface ObserveEvent {
	/** Mount-aware `::` path of the emitting node (shared key with describe/profile). */
	path: string;
	/** The protocol message observed at that node. */
	msg: Message;
	/** messageTier(msg[0]). */
	tier: number;
	/** Graph-local monotonic sequence (D26) — orders events across nodes. */
	seq: number;
}

/** A read-only egress: subscribe to the live ObserveEvent stream; call the returned fn to stop. */
export interface ObserveStream {
	subscribe(sink: (e: ObserveEvent) => void): () => void;
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
	/** Graph-local monotonic sequence shared with observe() ordering. */
	readonly seq: number;
}

/** A read-only topology egress stream. It does not activate nodes or emit DATA. */
export interface TopologyStream {
	subscribe(sink: (e: TopologyEvent) => void): () => void;
}

/** Predicate used by filterObserve(). */
export type ObservePredicate = (event: ObserveEvent) => boolean;

/** Equality used by coalesceObserve() for adjacent observe-event suppression. */
export type ObserveEventEquals = (prev: ObserveEvent, next: ObserveEvent) => boolean;

/**
 * Filter a read-only observe egress stream without turning it into a graph node.
 *
 * The source stream owns ordering and lifecycle; this helper only decides whether to forward each
 * ObserveEvent and returns the source unsubscribe unchanged.
 * @param stream - stream value used by the helper.
 * @param predicate - predicate value used by the helper.
 * @returns A `ObserveStream` value.
 * @category graph
 * @example
 * ```ts
 * import { filterObserve } from "@graphrefly/ts/graph";
 * ```
 */
export function filterObserve(stream: ObserveStream, predicate: ObservePredicate): ObserveStream {
	return {
		subscribe(sink) {
			return stream.subscribe((event) => {
				if (predicate(event)) {
					sink(event);
				}
			});
		},
	};
}

function sameObserveEvent(prev: ObserveEvent, next: ObserveEvent): boolean {
	return (
		prev.path === next.path &&
		prev.tier === next.tier &&
		prev.msg[0] === next.msg[0] &&
		Object.is(messagePayload(prev.msg), messagePayload(next.msg))
	);
}

function messagePayload(msg: Message): unknown {
	return msg.length > 1 ? msg[1] : undefined;
}

/**
 * Suppress adjacent duplicate ObserveEvents while preserving the source stream order.
 *
 * This is egress-side coalescing only: it does not batch, delay, reorder, alter seq values, or add
 * topology to describe(). Pass a custom equality when the caller wants a narrower or wider
 * definition of "duplicate".
 * @param stream - stream value used by the helper.
 * @param equals - equals value used by the helper.
 * @returns A `ObserveStream` value.
 * @category graph
 * @example
 * ```ts
 * import { coalesceObserve } from "@graphrefly/ts/graph";
 * ```
 */
export function coalesceObserve(
	stream: ObserveStream,
	equals: ObserveEventEquals = sameObserveEvent,
): ObserveStream {
	return {
		subscribe(sink) {
			let previous: ObserveEvent | undefined;
			return stream.subscribe((event) => {
				if (previous && equals(previous, event)) {
					return;
				}
				previous = event;
				sink(event);
			});
		},
	};
}

/** Per-node profile counters (D39). invokes/duration are dispatcher-backed (R-profile). */
export interface NodeProfile {
	invokes: number;
	totalDurationNs: number;
	lastDurationNs: number;
	status: Status;
}

/** profile() snapshot. Shares the mount-aware `::` path key with describe/observe. */
export interface Profile {
	totalInvokes: number;
	nodes: Record<string, NodeProfile>;
}
