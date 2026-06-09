/**
 * Graph-visible wire bridge envelope helpers (D134).
 *
 * This first slice is transport-free: commands become outbound envelope facts,
 * remote receipts enter only through the inbound fact node, and retry/ack timeout
 * state is surfaced through graph-visible attempts/status/errors nodes.
 */

import { type Ctx, depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import {
	nextRetryDelayMs,
	type RetryPolicy,
	retryPolicy,
	shouldRetry,
} from "../graph/resilience.js";
import type { Node } from "../node/node.js";
import { errorPayload, type Wave } from "../protocol/messages.js";

export type WireBridgeEnvelopeType =
	| "start"
	| "data"
	| "ack"
	| "nack"
	| "status"
	| "error"
	| "close";

export interface WireBridgeMetadata {
	/** Monotonic envelope sequence within the bridge session. */
	readonly seq: number;
	/** Monotonic accepted inbound cursor observed by the sending side. */
	readonly cursor: number;
	/** D151: correlation/idempotency metadata, not an authoritative duplicate lookup key. */
	readonly idempotencyKey: string;
	readonly attempt: number;
	readonly maxAttempts: number;
	readonly timestampMs?: number;
	/** D151 ack/nack correlation target; receipt duplicate recognition still uses seq/cursor. */
	readonly ackForSeq?: number;
	readonly requestId?: string;
}

export type WireBridgePayload<TData = unknown> =
	| { readonly kind: "data"; readonly value: TData }
	| { readonly kind: "error"; readonly error: unknown }
	| { readonly kind: "status"; readonly status: unknown }
	| { readonly kind: "close"; readonly reason?: unknown };

export interface WireBridgeEnvelope<TData = unknown> {
	readonly sessionId: string;
	readonly type: WireBridgeEnvelopeType;
	readonly payload?: WireBridgePayload<TData>;
	readonly metadata: WireBridgeMetadata;
}

export type WireBridgeCommand<TData = unknown> =
	| { readonly kind: "start"; readonly idempotencyKey?: string; readonly requestId?: string }
	| {
			readonly kind: "send";
			readonly payload: TData;
			readonly idempotencyKey?: string;
			readonly requestId?: string;
	  }
	| {
			readonly kind: "ack";
			readonly ackForSeq: number;
			readonly idempotencyKey?: string;
			readonly requestId?: string;
	  }
	| {
			readonly kind: "nack";
			readonly ackForSeq: number;
			readonly error: unknown;
			readonly idempotencyKey?: string;
			readonly requestId?: string;
	  }
	| { readonly kind: "close"; readonly reason?: unknown; readonly idempotencyKey?: string };

export type WireBridgeEvent<TOutbound = unknown, TInbound = unknown> =
	| {
			readonly kind: "outbound";
			readonly envelope: WireBridgeEnvelope<TOutbound>;
	  }
	| {
			readonly kind: "inbound";
			readonly envelope: WireBridgeEnvelope<TInbound>;
	  }
	| {
			readonly kind: "ack";
			readonly ackForSeq: number;
			readonly envelope: WireBridgeEnvelope<TInbound>;
			readonly outbound: WireBridgeEnvelope<TOutbound>;
	  }
	| {
			readonly kind: "nack";
			readonly ackForSeq: number;
			readonly envelope: WireBridgeEnvelope<TInbound>;
			readonly outbound: WireBridgeEnvelope<TOutbound>;
			readonly error: unknown;
	  }
	| { readonly kind: "timeout"; readonly seq: number; readonly attempt: number }
	| {
			readonly kind: "retry";
			readonly seq: number;
			readonly attempt: number;
			readonly delayMs: number;
			readonly error: unknown;
	  }
	| {
			readonly kind: "exhausted";
			readonly seq: number;
			readonly attempt: number;
			readonly error: unknown;
	  }
	| { readonly kind: "cursor"; readonly cursor: number }
	| { readonly kind: "duplicate"; readonly seq: number; readonly cursor: number }
	| { readonly kind: "out-of-order"; readonly seq: number; readonly expected: number }
	| { readonly kind: "session-mismatch"; readonly expected: string; readonly actual: string }
	| { readonly kind: "late-receipt"; readonly receipt: "ack" | "nack"; readonly ackForSeq: number }
	| { readonly kind: "invalid"; readonly error: string };

export interface WireBridgeAck {
	readonly ackForSeq: number;
	readonly envelope: WireBridgeEnvelope;
}

export interface WireBridgeNack {
	readonly ackForSeq: number;
	readonly envelope: WireBridgeEnvelope;
	readonly error: unknown;
}

export interface WireBridgeAttempt {
	readonly seq: number;
	readonly attempt: number;
	readonly maxAttempts: number;
}

export interface WireBridgeStatus {
	readonly sessionId: string;
	readonly state: "idle" | "started" | "open" | "waiting" | "closed" | "errored" | "exhausted";
	readonly cursor: number;
	readonly nextSeq: number;
	readonly pending: number;
	readonly attempts: number;
	readonly acked: number;
	readonly nacked: number;
	readonly errors: number;
	readonly lastSeq?: number;
	readonly lastDelayMs?: number;
}

export interface WireBridgeOptions {
	readonly name?: string;
	readonly sessionId: string;
	readonly retry?: RetryPolicy;
	/** Finite D134 ack timeout. Defaults to 30s so pending ack tracking is bounded. */
	readonly ackTimeoutMs?: number;
	readonly now?: () => number;
}

export interface WireBridgeBundle<TOutbound = unknown, TInbound = unknown> {
	readonly command: Node<WireBridgeCommand<TOutbound>>;
	readonly outbound: Node<WireBridgeEnvelope<TOutbound>>;
	readonly inbound: Node<WireBridgeEnvelope<TInbound>>;
	readonly events: Node<WireBridgeEvent<TOutbound, TInbound>>;
	readonly acks: Node<WireBridgeAck>;
	readonly nacks: Node<WireBridgeNack>;
	readonly status: Node<WireBridgeStatus>;
	readonly errors: Node<unknown>;
	readonly cursor: Node<number>;
	readonly attempts: Node<WireBridgeAttempt>;
	start(): void;
	send(payload: TOutbound, opts?: { idempotencyKey?: string; requestId?: string }): void;
	ack(ackForSeq: number, opts?: { idempotencyKey?: string; requestId?: string }): void;
	nack(
		ackForSeq: number,
		error: unknown,
		opts?: { idempotencyKey?: string; requestId?: string },
	): void;
	close(reason?: unknown, opts?: { idempotencyKey?: string }): void;
}

interface PendingEnvelope<TData> {
	envelope: WireBridgeEnvelope<TData>;
	timer?: ReturnType<typeof setTimeout>;
}

interface BridgeState<TData> {
	active: boolean;
	cleanupInstalled: boolean;
	nextSeq: number;
	cursor: number;
	remoteCursor: number;
	terminalReported: boolean;
	pending: Map<number, PendingEnvelope<TData>>;
}

interface WireBridgeInvalidIngress {
	readonly __wireBridgeInvalidIngress: true;
	readonly error: string;
}

const envelopeTypes = new Set<WireBridgeEnvelopeType>([
	"start",
	"data",
	"ack",
	"nack",
	"status",
	"error",
	"close",
]);

const defaultAckTimeoutMs = 30_000;

/** Stable D134 idempotency key helper scoped to one bridge session and sequence. */
export function wireBridgeIdempotencyKey(sessionId: string, seq: number): string {
	return `${sessionId}:${seq}`;
}

/** Create a D134 wire bridge envelope with ordered metadata. */
export function wireBridgeEnvelope<TData = unknown>(input: {
	readonly sessionId: string;
	readonly type: WireBridgeEnvelopeType;
	readonly seq: number;
	readonly cursor?: number;
	readonly payload?: WireBridgePayload<TData>;
	readonly idempotencyKey?: string;
	readonly attempt?: number;
	readonly maxAttempts?: number;
	readonly timestampMs?: number;
	readonly ackForSeq?: number;
	readonly requestId?: string;
}): WireBridgeEnvelope<TData> {
	if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
		throw new RangeError("wireBridgeEnvelope: sessionId must be a non-empty string");
	}
	if (!envelopeTypes.has(input.type)) {
		throw new RangeError("wireBridgeEnvelope: type is not recognized");
	}
	if (!isSafePositiveInteger(input.seq)) {
		throw new RangeError("wireBridgeEnvelope: seq must be a positive integer");
	}
	const cursor = input.cursor ?? 0;
	if (!isSafeNonNegativeInteger(cursor)) {
		throw new RangeError("wireBridgeEnvelope: cursor must be a non-negative integer");
	}
	const attempt = input.attempt ?? 1;
	if (!isSafePositiveInteger(attempt)) {
		throw new RangeError("wireBridgeEnvelope: attempt must be a positive integer");
	}
	const maxAttempts = input.maxAttempts ?? attempt;
	if (!isSafePositiveInteger(maxAttempts) || maxAttempts < attempt) {
		throw new RangeError("wireBridgeEnvelope: maxAttempts must be >= attempt");
	}
	if (input.ackForSeq !== undefined && !isSafePositiveInteger(input.ackForSeq)) {
		throw new RangeError("wireBridgeEnvelope: ackForSeq must be a positive integer");
	}
	if ((input.type === "ack" || input.type === "nack") && input.ackForSeq === undefined) {
		throw new RangeError(`wireBridgeEnvelope: ${input.type} envelope requires ackForSeq`);
	}
	if (input.idempotencyKey !== undefined && input.idempotencyKey.length === 0) {
		throw new RangeError("wireBridgeEnvelope: idempotencyKey must be a non-empty string");
	}
	const payloadError = validatePayloadForType(input.type, input.payload, "wireBridgeEnvelope");
	if (payloadError !== undefined) {
		throw new RangeError(payloadError);
	}
	return {
		sessionId: input.sessionId,
		type: input.type,
		payload: input.payload,
		metadata: {
			seq: input.seq,
			cursor,
			idempotencyKey: input.idempotencyKey ?? wireBridgeIdempotencyKey(input.sessionId, input.seq),
			attempt,
			maxAttempts,
			timestampMs: input.timestampMs,
			ackForSeq: input.ackForSeq,
			requestId: input.requestId,
		},
	};
}

export function wireBridge<TOutbound = unknown, TInbound = unknown>(
	graph: Graph,
	opts: WireBridgeOptions,
): WireBridgeBundle<TOutbound, TInbound> {
	const name = opts.name ?? "wireBridge";
	const policy = opts.retry ?? retryPolicy();
	const command = graph.node<WireBridgeCommand<TOutbound>>([], null, {
		name: `${name}/command`,
		factory: "wireBridgeCommand",
	});
	const inboundCore = graph.node<WireBridgeEnvelope<TInbound> | WireBridgeInvalidIngress>(
		[],
		null,
		{
			name: `${name}/inbound`,
			factory: "wireBridgeInbound",
		},
	);
	const inbound = guardedInboundNode(inboundCore, opts.sessionId);
	const events = wireBridgeEventsNode<TOutbound, TInbound>(
		graph,
		command,
		inboundCore,
		name,
		opts,
		policy,
	);
	const outbound = projectOutbound(graph, events, name);
	const acks = projectAcks(graph, events, name);
	const nacks = projectNacks(graph, events, name);
	const status = projectStatus(graph, events, name, opts.sessionId);
	const errors = projectErrors(graph, events, name);
	const cursor = projectCursor(graph, events, name);
	const attempts = projectAttempts(graph, events, name);
	return {
		command,
		outbound,
		inbound,
		events,
		acks,
		nacks,
		status,
		errors,
		cursor,
		attempts,
		start: () => command.down([["DATA", { kind: "start" }]]),
		send: (payload, sendOpts) =>
			command.down([
				[
					"DATA",
					{
						kind: "send",
						payload,
						idempotencyKey: sendOpts?.idempotencyKey,
						requestId: sendOpts?.requestId,
					},
				],
			]),
		ack: (ackForSeq, ackOpts) =>
			command.down([
				[
					"DATA",
					{
						kind: "ack",
						ackForSeq,
						idempotencyKey: ackOpts?.idempotencyKey,
						requestId: ackOpts?.requestId,
					},
				],
			]),
		nack: (ackForSeq, error, nackOpts) =>
			command.down([
				[
					"DATA",
					{
						kind: "nack",
						ackForSeq,
						error,
						idempotencyKey: nackOpts?.idempotencyKey,
						requestId: nackOpts?.requestId,
					},
				],
			]),
		close: (reason, closeOpts) =>
			command.down([
				["DATA", { kind: "close", reason, idempotencyKey: closeOpts?.idempotencyKey }],
			]),
	};
}

function wireBridgeEventsNode<TOutbound, TInbound>(
	graph: Graph,
	command: Node<WireBridgeCommand<TOutbound>>,
	inbound: Node<WireBridgeEnvelope<TInbound> | WireBridgeInvalidIngress>,
	name: string,
	opts: WireBridgeOptions,
	policy: RetryPolicy,
): Node<WireBridgeEvent<TOutbound, TInbound>> {
	const now = opts.now ?? Date.now;
	return graph.node<WireBridgeEvent<TOutbound, TInbound>>(
		[command, inbound],
		(ctx) => {
			const state = initBridgeState<TOutbound>(ctx);

			const emitOutbound = (
				type: WireBridgeEnvelopeType,
				payload: WireBridgePayload<TOutbound> | undefined,
				commandOpts: { idempotencyKey?: string; requestId?: string; ackForSeq?: number } = {},
				beforeEmit?: () => void,
			) => {
				if (!isSafePositiveInteger(state.nextSeq)) {
					ctx.down([
						[
							"DATA",
							{
								kind: "invalid",
								error: `${opts.sessionId}: next outbound seq exceeded Number.MAX_SAFE_INTEGER`,
							},
						],
					]);
					return;
				}
				const seq = state.nextSeq;
				let envelope: WireBridgeEnvelope<TOutbound>;
				try {
					envelope = wireBridgeEnvelope<TOutbound>({
						sessionId: opts.sessionId,
						type,
						seq,
						cursor: state.cursor,
						payload,
						idempotencyKey: commandOpts.idempotencyKey,
						attempt: 1,
						maxAttempts: policy.maxAttempts,
						timestampMs: now(),
						ackForSeq: commandOpts.ackForSeq,
						requestId: commandOpts.requestId,
					});
				} catch (error) {
					ctx.down([
						[
							"DATA",
							{
								kind: "invalid",
								error: error instanceof Error ? error.message : String(error),
							},
						],
					]);
					return;
				}
				state.nextSeq++;
				beforeEmit?.();
				ctx.down([["DATA", { kind: "outbound", envelope }]]);
				if (shouldTrackAck(type)) armAckTimeout(ctx, state, envelope, opts, policy, now);
			};

			for (const raw of depBatch(ctx, 1) ?? []) {
				processInbound(ctx, state, raw, opts.sessionId);
			}
			const inboundTerminal = ctx.terminal[1];
			if (inboundTerminal !== false && inboundTerminal !== undefined && !state.terminalReported) {
				state.terminalReported = true;
				const error =
					inboundTerminal === true
						? `${opts.sessionId}: inbound protocol COMPLETE is local misuse; remote completion must arrive as a DATA envelope fact`
						: `${opts.sessionId}: inbound protocol ERROR ${String(
								errorPayload(inboundTerminal),
							)} is local misuse; remote errors must arrive as DATA envelope facts`;
				ctx.down([["DATA", { kind: "invalid", error }]]);
			}
			for (const raw of depBatch(ctx, 0) ?? []) {
				const invalid = validateCommand(raw);
				if (invalid !== undefined) {
					ctx.down([["DATA", { kind: "invalid", error: invalid }]]);
					continue;
				}
				const commandValue = raw as WireBridgeCommand<TOutbound>;
				switch (commandValue.kind) {
					case "start":
						emitOutbound("start", undefined, commandValue);
						break;
					case "send":
						emitOutbound("data", { kind: "data", value: commandValue.payload }, commandValue);
						break;
					case "ack":
						emitOutbound("ack", undefined, {
							idempotencyKey: commandValue.idempotencyKey,
							requestId: commandValue.requestId,
							ackForSeq: commandValue.ackForSeq,
						});
						break;
					case "nack":
						emitOutbound(
							"nack",
							{ kind: "error", error: errorPayload(commandValue.error) },
							{
								idempotencyKey: commandValue.idempotencyKey,
								requestId: commandValue.requestId,
								ackForSeq: commandValue.ackForSeq,
							},
						);
						break;
					case "close":
						emitOutbound(
							"close",
							{ kind: "close", reason: commandValue.reason },
							commandValue,
							() => {
								for (const pending of state.pending.values()) {
									if (pending.timer !== undefined) clearTimeout(pending.timer);
								}
								state.pending.clear();
							},
						);
						break;
				}
			}
		},
		{
			name: `${name}/events`,
			factory: "wireBridgeEvents",
			partial: true,
			errorWhenDepsError: false,
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		},
	);
}

function initBridgeState<TPayload>(ctx: Ctx): BridgeState<TPayload> {
	let state = ctx.state.get<BridgeState<TPayload>>();
	if (state === undefined) {
		state = {
			active: true,
			cleanupInstalled: false,
			nextSeq: 1,
			cursor: 0,
			remoteCursor: 0,
			terminalReported: false,
			pending: new Map(),
		};
		ctx.state.set(state);
	}
	state.active = true;
	if (!state.cleanupInstalled) {
		state.cleanupInstalled = true;
		ctx.onDeactivation(() => {
			state.active = false;
			state.cleanupInstalled = false;
			for (const pending of state.pending.values()) {
				if (pending.timer !== undefined) clearTimeout(pending.timer);
			}
			state.pending.clear();
		});
	}
	return state;
}

function armAckTimeout<TPayload>(
	ctx: Ctx,
	state: BridgeState<TPayload>,
	envelope: WireBridgeEnvelope<TPayload>,
	opts: WireBridgeOptions,
	policy: RetryPolicy,
	now: () => number,
): void {
	const timeoutMs = opts.ackTimeoutMs ?? defaultAckTimeoutMs;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
		throw new RangeError("wireBridge: ackTimeoutMs must be a non-negative finite number");
	}
	const pending: PendingEnvelope<TPayload> = { envelope };
	const schedule = (current: WireBridgeEnvelope<TPayload>) => {
		pending.timer = setTimeout(() => {
			pending.timer = undefined;
			if (!state.active || !state.pending.has(current.metadata.seq)) return;
			ctx.down([
				[
					"DATA",
					{
						kind: "timeout",
						seq: current.metadata.seq,
						attempt: current.metadata.attempt,
					} satisfies WireBridgeEvent<TPayload, unknown>,
				],
			]);
			if (!shouldRetry(policy, current.metadata.attempt)) {
				const error = `${opts.sessionId}: ack timeout for seq ${current.metadata.seq}`;
				state.pending.delete(current.metadata.seq);
				ctx.down([
					[
						"DATA",
						{
							kind: "exhausted",
							seq: current.metadata.seq,
							attempt: current.metadata.attempt,
							error,
						} satisfies WireBridgeEvent<TPayload, unknown>,
					],
				]);
				return;
			}
			const attempt = current.metadata.attempt + 1;
			const delayMs = nextRetryDelayMs(policy, attempt) ?? 0;
			ctx.down([
				[
					"DATA",
					{
						kind: "retry",
						seq: current.metadata.seq,
						attempt,
						delayMs,
						error: `${opts.sessionId}: ack timeout for seq ${current.metadata.seq}`,
					} satisfies WireBridgeEvent<TPayload, unknown>,
				],
			]);
			const retry = wireBridgeEnvelope<TPayload>({
				sessionId: current.sessionId,
				type: current.type,
				seq: current.metadata.seq,
				cursor: state.cursor,
				payload: current.payload,
				idempotencyKey: current.metadata.idempotencyKey,
				attempt,
				maxAttempts: policy.maxAttempts,
				timestampMs: now(),
				requestId: current.metadata.requestId,
			});
			pending.timer = setTimeout(() => {
				pending.timer = undefined;
				if (!state.active || !state.pending.has(current.metadata.seq)) return;
				pending.envelope = retry;
				ctx.down([["DATA", { kind: "outbound", envelope: retry }]]);
				schedule(retry);
			}, delayMs);
		}, timeoutMs);
	};
	state.pending.set(envelope.metadata.seq, pending);
	schedule(envelope);
}

function processInbound<TOutbound, TInbound>(
	ctx: Ctx,
	state: BridgeState<TOutbound>,
	input: unknown,
	sessionId: string,
): void {
	if (isInvalidIngress(input)) {
		ctx.down([["DATA", { kind: "invalid", error: input.error }]]);
		return;
	}
	const invalid = validateInboundEnvelope(input);
	if (invalid !== undefined) {
		ctx.down([["DATA", { kind: "invalid", error: invalid }]]);
		return;
	}
	const envelope = input as WireBridgeEnvelope<TInbound>;
	if (envelope.sessionId !== sessionId) {
		ctx.down([
			[
				"DATA",
				{
					kind: "session-mismatch",
					expected: sessionId,
					actual: envelope.sessionId,
				} satisfies WireBridgeEvent<TOutbound, TInbound>,
			],
		]);
		return;
	}
	const seq = envelope.metadata.seq;
	const expected = state.cursor + 1;
	if (seq <= state.cursor) {
		ctx.down([["DATA", { kind: "duplicate", seq, cursor: state.cursor }]]);
		return;
	}
	if (seq > expected) {
		ctx.down([["DATA", { kind: "out-of-order", seq, expected }]]);
		return;
	}
	if (envelope.metadata.cursor < state.remoteCursor) {
		ctx.down([
			[
				"DATA",
				{
					kind: "invalid",
					error: `${sessionId}: inbound cursor ${envelope.metadata.cursor} regressed below ${state.remoteCursor}`,
				},
			],
		]);
		return;
	}
	state.remoteCursor = envelope.metadata.cursor;
	state.cursor = seq;
	ctx.down([["DATA", { kind: "cursor", cursor: state.cursor }]]);
	ctx.down([["DATA", { kind: "inbound", envelope }]]);
	if (envelope.type === "ack" && envelope.metadata.ackForSeq !== undefined) {
		const pending = state.pending.get(envelope.metadata.ackForSeq);
		if (pending === undefined) {
			ctx.down([
				["DATA", { kind: "late-receipt", receipt: "ack", ackForSeq: envelope.metadata.ackForSeq }],
			]);
			return;
		}
		if (pending?.timer !== undefined) clearTimeout(pending.timer);
		state.pending.delete(envelope.metadata.ackForSeq);
		ctx.down([
			[
				"DATA",
				{
					kind: "ack",
					ackForSeq: envelope.metadata.ackForSeq,
					envelope,
					outbound: pending.envelope,
				} satisfies WireBridgeEvent<TOutbound, TInbound>,
			],
		]);
	} else if (envelope.type === "nack" && envelope.metadata.ackForSeq !== undefined) {
		const pending = state.pending.get(envelope.metadata.ackForSeq);
		if (pending === undefined) {
			ctx.down([
				["DATA", { kind: "late-receipt", receipt: "nack", ackForSeq: envelope.metadata.ackForSeq }],
			]);
			return;
		}
		if (pending?.timer !== undefined) clearTimeout(pending.timer);
		state.pending.delete(envelope.metadata.ackForSeq);
		ctx.down([
			[
				"DATA",
				{
					kind: "nack",
					ackForSeq: envelope.metadata.ackForSeq,
					envelope,
					outbound: pending.envelope,
					error: bridgePayloadError(envelope.payload, "remote nack"),
				} satisfies WireBridgeEvent<TOutbound, TInbound>,
			],
		]);
	}
}

function validateInboundEnvelope(envelope: unknown): string | undefined {
	if (typeof envelope !== "object" || envelope === null) {
		return "wireBridge: inbound envelope must be an object";
	}
	const candidate = envelope as Partial<WireBridgeEnvelope<unknown>>;
	if (typeof candidate.sessionId !== "string" || candidate.sessionId.length === 0) {
		return "wireBridge: inbound envelope sessionId must be a non-empty string";
	}
	if (
		typeof candidate.type !== "string" ||
		!envelopeTypes.has(candidate.type as WireBridgeEnvelopeType)
	) {
		return "wireBridge: inbound envelope type is not recognized";
	}
	const metadata = candidate.metadata as Partial<WireBridgeMetadata> | undefined;
	if (typeof metadata !== "object" || metadata === null) {
		return "wireBridge: inbound envelope metadata must be an object";
	}
	if (!isSafePositiveInteger(metadata.seq)) {
		return "wireBridge: inbound envelope seq must be a positive integer";
	}
	if (!isSafeNonNegativeInteger(metadata.cursor)) {
		return "wireBridge: inbound envelope cursor must be a non-negative integer";
	}
	if (
		typeof metadata.idempotencyKey !== "string" ||
		(metadata.idempotencyKey as string).length === 0
	) {
		return "wireBridge: inbound envelope idempotencyKey must be a non-empty string";
	}
	if (!isSafePositiveInteger(metadata.attempt)) {
		return "wireBridge: inbound envelope attempt must be a positive integer";
	}
	if (
		!isSafePositiveInteger(metadata.maxAttempts) ||
		(metadata.maxAttempts as number) < (metadata.attempt as number)
	) {
		return "wireBridge: inbound envelope maxAttempts must be >= attempt";
	}
	if (metadata.ackForSeq !== undefined && !isSafePositiveInteger(metadata.ackForSeq)) {
		return "wireBridge: inbound envelope ackForSeq must be a positive integer";
	}
	if ((candidate.type === "ack" || candidate.type === "nack") && metadata.ackForSeq === undefined) {
		return `wireBridge: inbound ${candidate.type} envelope requires ackForSeq`;
	}
	const payloadError = validatePayloadForType(
		candidate.type as WireBridgeEnvelopeType,
		candidate.payload,
		"wireBridge: inbound envelope",
	);
	if (payloadError !== undefined) return payloadError;
	return undefined;
}

function validateCommand(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) {
		return "wireBridge: command fact must be an object";
	}
	const kind = (value as { readonly kind?: unknown }).kind;
	if (
		kind !== "start" &&
		kind !== "send" &&
		kind !== "ack" &&
		kind !== "nack" &&
		kind !== "close"
	) {
		return "wireBridge: command kind is not recognized";
	}
	if (
		(kind === "ack" || kind === "nack") &&
		!isSafePositiveInteger((value as { readonly ackForSeq?: unknown }).ackForSeq)
	) {
		return `wireBridge: ${kind} command ackForSeq must be a positive integer`;
	}
	return undefined;
}

function projectOutbound<TOutbound, TInbound>(
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

function projectAcks<TOutbound, TInbound>(
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

function projectNacks<TOutbound, TInbound>(
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

function projectStatus<TOutbound, TInbound>(
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

function projectErrors<TOutbound, TInbound>(
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

function projectCursor<TOutbound, TInbound>(
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

function projectAttempts<TOutbound, TInbound>(
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

function guardedInboundNode<TInbound>(
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

function guardInboundWave(msgs: Wave, sessionId: string): Wave {
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

function invalidIngress(error: string): WireBridgeInvalidIngress {
	return { __wireBridgeInvalidIngress: true, error };
}

function isInvalidIngress(value: unknown): value is WireBridgeInvalidIngress {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as WireBridgeInvalidIngress).__wireBridgeInvalidIngress === true &&
		typeof (value as WireBridgeInvalidIngress).error === "string"
	);
}

function shouldTrackAck(type: WireBridgeEnvelopeType): boolean {
	return type === "start" || type === "data" || type === "close";
}

function isSafePositiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validatePayloadForType(
	type: WireBridgeEnvelopeType,
	payload: unknown,
	prefix: string,
): string | undefined {
	const kind =
		typeof payload === "object" && payload !== null
			? (payload as { readonly kind?: unknown }).kind
			: undefined;
	switch (type) {
		case "data":
			return kind === "data" && (payload as { readonly value?: unknown }).value !== undefined
				? undefined
				: `${prefix}: data envelope requires data payload`;
		case "nack":
		case "error":
			return kind === "error" && (payload as { readonly error?: unknown }).error !== undefined
				? undefined
				: `${prefix}: ${type} envelope requires error payload`;
		case "status":
			return kind === "status" && (payload as { readonly status?: unknown }).status !== undefined
				? undefined
				: `${prefix}: status envelope requires status payload`;
		case "close":
			return kind === "close" ? undefined : `${prefix}: close envelope requires close payload`;
		case "start":
		case "ack":
			return payload === undefined
				? undefined
				: `${prefix}: ${type} envelope must not carry a payload`;
	}
}

function bridgePayloadError(payload: unknown, fallback: unknown): unknown {
	if (
		typeof payload === "object" &&
		payload !== null &&
		(payload as { readonly kind?: unknown }).kind === "error"
	) {
		return (payload as { readonly error?: unknown }).error;
	}
	return fallback;
}
