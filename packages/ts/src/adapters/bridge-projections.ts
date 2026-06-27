/**
 * Graph-visible wire bridge envelope helpers (D134).
 *
 * This first slice is transport-free: commands become outbound envelope facts,
 * remote receipts enter only through the inbound fact node, and retry/ack timeout
 * state is surfaced through graph-visible attempts/status/errors nodes.
 */

import { depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import { errorPayload, type Wave } from "../protocol/messages.js";
import type {
	WireBridgeAck,
	WireBridgeAttempt,
	WireBridgeEnvelope,
	WireBridgeEvent,
	WireBridgeInvalidIngress,
	WireBridgeNack,
	WireBridgeStatus,
} from "./bridge-types.js";
import { bridgePayloadError, shouldTrackAck } from "./bridge-validation.js";

export function projectOutbound<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
): Node<WireBridgeEnvelope<TOutbound>> {
	return graph.node<WireBridgeEnvelope<TOutbound>>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "outbound") ctx.down([["DATA", event.envelope]]);
			}
		},
		{ name: `${name}/outbound`, factory: "wireBridgeOutbound" },
	);
}

export function projectAcks<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
): Node<WireBridgeAck> {
	return graph.node<WireBridgeAck>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "ack") {
					ctx.down([["DATA", { ackForSeq: event.ackForSeq, envelope: event.envelope }]]);
				}
			}
		},
		{ name: `${name}/acks`, factory: "wireBridgeAcks" },
	);
}

export function projectNacks<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
): Node<WireBridgeNack> {
	return graph.node<WireBridgeNack>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "nack") {
					ctx.down([
						["DATA", { ackForSeq: event.ackForSeq, envelope: event.envelope, error: event.error }],
					]);
				}
			}
		},
		{ name: `${name}/nacks`, factory: "wireBridgeNacks" },
	);
}

export function projectStatus<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
	sessionId: string,
): Node<WireBridgeStatus> {
	return graph.node<WireBridgeStatus>(
		[events],
		(ctx) => {
			let next =
				ctx.state.get<WireBridgeStatus>() ??
				({
					sessionId,
					state: "idle",
					cursor: 0,
					nextSeq: 1,
					pending: 0,
					attempts: 0,
					acked: 0,
					nacked: 0,
					errors: 0,
				} satisfies WireBridgeStatus);
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "outbound") {
					const { seq, attempt } = event.envelope.metadata;
					const trackAck = shouldTrackAck(event.envelope.type);
					next = {
						...next,
						state:
							event.envelope.type === "start"
								? "started"
								: event.envelope.type === "close"
									? "closed"
									: "open",
						nextSeq: Math.max(next.nextSeq, seq + 1),
						pending:
							event.envelope.type === "close"
								? 1
								: trackAck && attempt === 1
									? next.pending + 1
									: next.pending,
						attempts: trackAck ? next.attempts + 1 : next.attempts,
						lastSeq: seq,
					};
				} else if (event.kind === "ack") {
					next = {
						...next,
						state: event.outbound.type === "close" ? "closed" : "open",
						pending: Math.max(0, next.pending - 1),
						acked: next.acked + 1,
						lastSeq: event.envelope.metadata.seq,
					};
				} else if (event.kind === "nack") {
					next = {
						...next,
						state: "errored",
						pending: Math.max(0, next.pending - 1),
						nacked: next.nacked + 1,
						errors: next.errors + 1,
						lastSeq: event.envelope.metadata.seq,
					};
				} else if (event.kind === "retry") {
					next = {
						...next,
						state: "waiting",
						lastSeq: event.seq,
						lastDelayMs: event.delayMs,
					};
				} else if (event.kind === "exhausted") {
					next = {
						...next,
						state: "exhausted",
						pending: Math.max(0, next.pending - 1),
						errors: next.errors + 1,
						lastSeq: event.seq,
					};
				} else if (event.kind === "cursor") {
					next = { ...next, cursor: event.cursor };
				} else if (event.kind === "out-of-order") {
					next = { ...next, state: "errored", errors: next.errors + 1, lastSeq: event.seq };
				} else if (event.kind === "session-mismatch") {
					next = { ...next, state: "errored", errors: next.errors + 1 };
				} else if (event.kind === "late-receipt" || event.kind === "invalid") {
					next = { ...next, state: "errored", errors: next.errors + 1 };
				} else if (event.kind === "inbound" && event.envelope.type === "error") {
					next = {
						...next,
						state: "errored",
						errors: next.errors + 1,
						lastSeq: event.envelope.metadata.seq,
					};
				} else if (event.kind === "inbound" && event.envelope.type === "close") {
					next = { ...next, state: "closed", lastSeq: event.envelope.metadata.seq };
				}
			}
			ctx.state.set(next);
			ctx.down([["DATA", next]]);
		},
		{ name: `${name}/status`, factory: "wireBridgeStatus" },
	);
}

export function projectErrors<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
): Node<unknown> {
	return graph.node<unknown>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "nack") ctx.down([["DATA", event.error]]);
				else if (event.kind === "exhausted") ctx.down([["DATA", event.error]]);
				else if (event.kind === "out-of-order") {
					ctx.down([
						[
							"DATA",
							`${name}: inbound seq ${event.seq} arrived before expected seq ${event.expected}`,
						],
					]);
				} else if (event.kind === "inbound" && event.envelope.type === "error") {
					ctx.down([["DATA", bridgePayloadError(event.envelope.payload, "remote error envelope")]]);
				} else if (event.kind === "session-mismatch") {
					ctx.down([
						[
							"DATA",
							`${name}: inbound session ${event.actual} did not match expected ${event.expected}`,
						],
					]);
				} else if (event.kind === "late-receipt") {
					ctx.down([
						[
							"DATA",
							`${name}: late ${event.receipt} for unknown or completed ackForSeq ${event.ackForSeq}`,
						],
					]);
				} else if (event.kind === "invalid") {
					ctx.down([["DATA", event.error]]);
				}
			}
		},
		{ name: `${name}/errors`, factory: "wireBridgeErrors" },
	);
}

export function projectCursor<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
): Node<number> {
	return graph.node<number>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "cursor") ctx.down([["DATA", event.cursor]]);
			}
		},
		{ name: `${name}/cursor`, factory: "wireBridgeCursor" },
	);
}

export function projectAttempts<TOutbound, TInbound>(
	graph: Graph,
	events: Node<WireBridgeEvent<TOutbound, TInbound>>,
	name: string,
): Node<WireBridgeAttempt> {
	return graph.node<WireBridgeAttempt>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const event = raw as WireBridgeEvent<TOutbound, TInbound>;
				if (event.kind === "outbound" && shouldTrackAck(event.envelope.type)) {
					ctx.down([
						[
							"DATA",
							{
								seq: event.envelope.metadata.seq,
								attempt: event.envelope.metadata.attempt,
								maxAttempts: event.envelope.metadata.maxAttempts,
							},
						],
					]);
				}
			}
		},
		{ name: `${name}/attempts`, factory: "wireBridgeAttempts" },
	);
}

export function guardedInboundNode<TInbound>(
	node: Node<WireBridgeEnvelope<TInbound> | WireBridgeInvalidIngress>,
	sessionId: string,
): Node<WireBridgeEnvelope<TInbound>> {
	return new Proxy(node, {
		get(target, property) {
			if (property === "down") {
				return (msgs: Wave) => target.down(guardInboundWave(msgs, sessionId));
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as Node<WireBridgeEnvelope<TInbound>>;
}

export function guardInboundWave(msgs: Wave, sessionId: string): Wave {
	return msgs.map((msg) => {
		if (msg[0] === "DATA") return msg;
		if (msg[0] === "ERROR") {
			return [
				"DATA",
				invalidIngress(
					`${sessionId}: inbound protocol ERROR ${String(
						errorPayload(msg[1]),
					)} is local misuse; remote errors must arrive as DATA envelope facts`,
				),
			];
		}
		if (msg[0] === "COMPLETE") {
			return [
				"DATA",
				invalidIngress(
					`${sessionId}: inbound protocol COMPLETE is local misuse; remote completion must arrive as a DATA envelope fact`,
				),
			];
		}
		return [
			"DATA",
			invalidIngress(
				`${sessionId}: inbound port accepts DATA envelope facts only; ${msg[0]} is local protocol traffic`,
			),
		];
	});
}

export function invalidIngress(error: string): WireBridgeInvalidIngress {
	return { __wireBridgeInvalidIngress: true, error };
}

export function isInvalidIngress(value: unknown): value is WireBridgeInvalidIngress {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as WireBridgeInvalidIngress).__wireBridgeInvalidIngress === true &&
		typeof (value as WireBridgeInvalidIngress).error === "string"
	);
}
