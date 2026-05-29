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
