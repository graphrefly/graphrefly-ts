import { depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import {
	assertKeyedRateLimitOutcome,
	assertKeyedRateLimitRequest,
	createKeyedRateLimitOutcome,
	KEYED_RATE_LIMIT_VERSION,
	type KeyedRateLimitAdmissionBundle,
	type KeyedRateLimitCorrelationFact,
	type KeyedRateLimitOutcome,
	type KeyedRateLimitRequest,
	keyedRateLimitAdmissionBundle,
	keyedRateLimitRequestIdentity,
} from "../rate-limit/keyed-rate-limit.js";

const DEFAULT_MAX_IN_FLIGHT = 128;
const DEFAULT_MAX_COMPLETED = 256;
const MAX_BOUND = 4_096;
const NO_COMPLETION_ERROR = Symbol("no-keyed-rate-limit-completion-error");

export type KeyedRateLimitAuthorityCancel = () => void;

/**
 * Narrow host-private D648 authority capability.
 *
 * The host owns its client, transaction, clock, algorithm, and durable idempotency. Exact request
 * replay must return the same outcome without consuming again; request-id reuse with different
 * material must settle as `conflict`. `complete` must be called at most once. Handles and callbacks
 * never enter Graph DATA.
 *
 * Inside one host-owned atomic consume operation, validate and identify the request; look up the
 * receipt by authority/request id; return the stored outcome for identical material without policy,
 * state, clock, evaluator, or commit access; return conflict for different material; otherwise
 * resolve exact policy, load exact scoped state, acquire authoritative time, evaluate, and atomically
 * persist next state with the outcome receipt. Durable protected-effect receipts are a separate
 * application/executor boundary.
 */
export interface KeyedRateLimitAuthority {
	consume(
		request: KeyedRateLimitRequest,
		complete: (outcome: KeyedRateLimitOutcome) => void,
	): KeyedRateLimitAuthorityCancel | undefined;
}

export type KeyedRateLimitAuthorityAdapterState = "requested" | "settled" | "failed";

export interface KeyedRateLimitAuthorityAdapterStatus {
	readonly kind: "keyed-rate-limit-authority-status";
	readonly version: typeof KEYED_RATE_LIMIT_VERSION;
	readonly state: KeyedRateLimitAuthorityAdapterState;
	readonly requestId?: string;
	readonly outcomeId?: string;
	readonly requested: number;
	readonly settled: number;
	readonly failed: number;
	readonly inFlight: number;
	readonly overflowed: number;
}

export type KeyedRateLimitAuthorityAdapterErrorCode =
	| "malformed-request"
	| "malformed-outcome"
	| "outcome-mismatch"
	| "request-overflow"
	| "authority-threw";

export interface KeyedRateLimitAuthorityAdapterError {
	readonly kind: "keyed-rate-limit-authority-error";
	readonly version: typeof KEYED_RATE_LIMIT_VERSION;
	readonly code: KeyedRateLimitAuthorityAdapterErrorCode;
	readonly message: string;
	readonly requestId?: string;
}

export interface KeyedRateLimitAuthorityAdapterCursor {
	readonly kind: "keyed-rate-limit-authority-cursor";
	readonly version: typeof KEYED_RATE_LIMIT_VERSION;
	readonly requested: number;
	readonly settled: number;
	readonly failed: number;
	readonly inFlight: number;
	readonly overflowed: number;
}

export interface KeyedRateLimitAuthorityAdapterOptions {
	readonly name?: string;
	readonly maxInFlight?: number;
	readonly maxCompleted?: number;
}

export interface KeyedRateLimitAuthorityAdapterBundle {
	readonly authorityRequests: Node<KeyedRateLimitRequest>;
	readonly outcomes: Node<KeyedRateLimitOutcome>;
	readonly status: Node<KeyedRateLimitAuthorityAdapterStatus>;
	readonly errors: Node<KeyedRateLimitAuthorityAdapterError>;
	readonly cursor: Node<KeyedRateLimitAuthorityAdapterCursor>;
	readonly admission: KeyedRateLimitAdmissionBundle;
}

type KeyedRateLimitAuthorityAdapterFact =
	| KeyedRateLimitRequest
	| KeyedRateLimitOutcome
	| KeyedRateLimitAuthorityAdapterStatus
	| KeyedRateLimitAuthorityAdapterError
	| KeyedRateLimitAuthorityAdapterCursor;

interface KeyedRateLimitAuthorityAdapterRuntimeState {
	active: boolean;
	requested: number;
	settled: number;
	failed: number;
	overflowed: number;
	nextAttempt: number;
	readonly inFlight: Set<number>;
	readonly cancels: Map<number, KeyedRateLimitAuthorityCancel>;
}

/**
 * Attach a graph-visible request node to one host-private D648 atomic authority.
 *
 * The returned nodes form the D649 raw-request -> bounded authority-request -> authority-outcome
 * -> exact-admission topology. Governed consumers use `admission.admissions`; they do not wire raw
 * requests to a second correlation gate or protected effect. This adapter supplies no timer, retry
 * loop, store, clock, fingerprint, or application effect executor.
 *
 * @param graph - Graph that owns the adapter and composed admission nodes.
 * @param requests - Strict raw requests entering the bounded adapter.
 * @param authority - Host-private atomic consume capability.
 * @param opts - Positive in-flight and retained-completion bounds plus an optional node name.
 * @returns The graph-visible authority projections and composed admission gate.
 * @category adapters
 * @example
 * ```ts
 * import { attachKeyedRateLimitAuthority } from "@graphrefly/ts/adapters";
 * ```
 */
export function attachKeyedRateLimitAuthority(
	graph: Graph,
	requests: Node<KeyedRateLimitRequest>,
	authority: KeyedRateLimitAuthority,
	opts: KeyedRateLimitAuthorityAdapterOptions = {},
): KeyedRateLimitAuthorityAdapterBundle {
	const name = opts.name ?? "keyedRateLimitAuthority";
	const maxInFlight = boundedAdapterOption(opts.maxInFlight, DEFAULT_MAX_IN_FLIGHT, "maxInFlight");
	const maxCompleted = boundedAdapterOption(
		opts.maxCompleted,
		DEFAULT_MAX_COMPLETED,
		"maxCompleted",
	);
	const events = graph.node<KeyedRateLimitAuthorityAdapterFact>(
		[requests],
		(ctx) => {
			const state =
				ctx.state.get<KeyedRateLimitAuthorityAdapterRuntimeState>() ??
				({
					active: true,
					requested: 0,
					settled: 0,
					failed: 0,
					overflowed: 0,
					nextAttempt: 0,
					inFlight: new Set(),
					cancels: new Map(),
				} satisfies KeyedRateLimitAuthorityAdapterRuntimeState);
			state.active = true;
			ctx.state.set(state);
			ctx.onDeactivation(() => {
				state.active = false;
				for (const cancel of state.cancels.values()) runCancel(cancel);
				state.cancels.clear();
				state.inFlight.clear();
			});
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (!state.active) break;
				let request: KeyedRateLimitRequest;
				try {
					request = assertKeyedRateLimitRequest(raw);
				} catch {
					state.failed += 1;
					ctx.down([
						["DATA", adapterError("malformed-request")],
						["DATA", adapterStatus(state, "failed")],
						["DATA", adapterCursor(state)],
					]);
					continue;
				}
				if (state.inFlight.size >= maxInFlight) {
					state.failed += 1;
					state.overflowed += 1;
					ctx.down([
						["DATA", adapterError("request-overflow", request.requestId)],
						["DATA", adapterStatus(state, "failed", request.requestId)],
						["DATA", adapterCursor(state)],
					]);
					continue;
				}
				state.requested += 1;
				state.nextAttempt += 1;
				const attempt = state.nextAttempt;
				let settled = false;
				let completionDeliveryError: unknown = NO_COMPLETION_ERROR;
				state.inFlight.add(attempt);
				try {
					ctx.down([
						["DATA", request],
						["DATA", adapterStatus(state, "requested", request.requestId)],
						["DATA", adapterCursor(state)],
					]);
				} catch (error) {
					state.inFlight.delete(attempt);
					throw error;
				}
				if (!state.active) {
					state.inFlight.delete(attempt);
					break;
				}
				const complete = (rawOutcome: KeyedRateLimitOutcome): void => {
					if (settled || !state.active) return;
					settled = true;
					state.cancels.delete(attempt);
					const deliverCompletion = (
						facts: readonly KeyedRateLimitAuthorityAdapterFact[],
					): void => {
						try {
							ctx.down(facts.map((fact) => ["DATA", fact] as const));
						} catch (error) {
							completionDeliveryError = error;
							throw error;
						}
					};
					let outcome: KeyedRateLimitOutcome;
					try {
						outcome = assertKeyedRateLimitOutcome(rawOutcome);
					} catch {
						state.inFlight.delete(attempt);
						state.failed += 1;
						const unavailable = unavailableOutcome(request, "malformed-outcome");
						deliverCompletion([
							adapterError("malformed-outcome", request.requestId),
							unavailable,
							adapterStatus(state, "failed", request.requestId, unavailable.outcomeId),
							adapterCursor(state),
						]);
						return;
					}
					if (!outcomeMatchesRequest(outcome, request)) {
						state.inFlight.delete(attempt);
						state.failed += 1;
						const unavailable = unavailableOutcome(request, "outcome-mismatch");
						deliverCompletion([
							adapterError("outcome-mismatch", request.requestId),
							unavailable,
							adapterStatus(state, "failed", request.requestId, unavailable.outcomeId),
							adapterCursor(state),
						]);
						return;
					}
					state.inFlight.delete(attempt);
					state.settled += 1;
					deliverCompletion([
						outcome,
						adapterStatus(state, "settled", request.requestId, outcome.outcomeId),
						adapterCursor(state),
					]);
				};
				try {
					const cancel = authority.consume(request, complete);
					if (completionDeliveryError !== NO_COMPLETION_ERROR) {
						if (typeof cancel === "function") runCancel(cancel);
						throw completionDeliveryError;
					}
					if (!settled && state.active && typeof cancel === "function") {
						state.cancels.set(attempt, cancel);
					} else if (!state.active && typeof cancel === "function") {
						runCancel(cancel);
					}
				} catch (error) {
					if (completionDeliveryError !== NO_COMPLETION_ERROR) {
						throw completionDeliveryError;
					}
					if (settled) throw error;
					settled = true;
					state.inFlight.delete(attempt);
					state.failed += 1;
					const unavailable = unavailableOutcome(request, "authority-threw");
					ctx.down([
						["DATA", adapterError("authority-threw", request.requestId)],
						["DATA", unavailable],
						["DATA", adapterStatus(state, "failed", request.requestId, unavailable.outcomeId)],
						["DATA", adapterCursor(state)],
					]);
				}
			}
		},
		{
			name: `${name}/events`,
			factory: "attachKeyedRateLimitAuthority",
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	const correlationFacts = adapterProjection(
		graph,
		events,
		`${name}/correlation-facts`,
		"keyedRateLimitAuthorityCorrelationFacts",
		(fact): fact is KeyedRateLimitCorrelationFact =>
			"format" in fact &&
			(fact.format === "graphrefly.keyedRateLimitRequest" ||
				fact.format === "graphrefly.keyedRateLimitOutcome"),
	);
	const authorityRequests = adapterProjection(
		graph,
		events,
		`${name}/authority-requests`,
		"keyedRateLimitAuthorityRequests",
		(fact): fact is KeyedRateLimitRequest =>
			"format" in fact && fact.format === "graphrefly.keyedRateLimitRequest",
	);
	const outcomes = adapterProjection(
		graph,
		events,
		`${name}/outcomes`,
		"keyedRateLimitAuthorityOutcomes",
		(fact): fact is KeyedRateLimitOutcome =>
			"format" in fact && fact.format === "graphrefly.keyedRateLimitOutcome",
	);
	const status = adapterProjection(
		graph,
		events,
		`${name}/status`,
		"keyedRateLimitAuthorityStatus",
		(fact): fact is KeyedRateLimitAuthorityAdapterStatus =>
			"kind" in fact && fact.kind === "keyed-rate-limit-authority-status",
	);
	const errors = adapterProjection(
		graph,
		events,
		`${name}/errors`,
		"keyedRateLimitAuthorityErrors",
		(fact): fact is KeyedRateLimitAuthorityAdapterError =>
			"kind" in fact && fact.kind === "keyed-rate-limit-authority-error",
	);
	const cursor = adapterProjection(
		graph,
		events,
		`${name}/cursor`,
		"keyedRateLimitAuthorityCursor",
		(fact): fact is KeyedRateLimitAuthorityAdapterCursor =>
			"kind" in fact && fact.kind === "keyed-rate-limit-authority-cursor",
	);
	return {
		authorityRequests,
		outcomes,
		status,
		errors,
		cursor,
		admission: keyedRateLimitAdmissionBundle(graph, {
			name: `${name}/admission`,
			correlationFacts,
			maxPending: maxInFlight,
			maxCompleted,
		}),
	};
}

function adapterStatus(
	state: KeyedRateLimitAuthorityAdapterRuntimeState,
	next: KeyedRateLimitAuthorityAdapterState,
	requestId?: string,
	outcomeId?: string,
): KeyedRateLimitAuthorityAdapterStatus {
	return Object.freeze({
		kind: "keyed-rate-limit-authority-status",
		version: KEYED_RATE_LIMIT_VERSION,
		state: next,
		...(requestId === undefined ? {} : { requestId }),
		...(outcomeId === undefined ? {} : { outcomeId }),
		requested: state.requested,
		settled: state.settled,
		failed: state.failed,
		inFlight: state.inFlight.size,
		overflowed: state.overflowed,
	});
}

function adapterCursor(
	state: KeyedRateLimitAuthorityAdapterRuntimeState,
): KeyedRateLimitAuthorityAdapterCursor {
	return Object.freeze({
		kind: "keyed-rate-limit-authority-cursor",
		version: KEYED_RATE_LIMIT_VERSION,
		requested: state.requested,
		settled: state.settled,
		failed: state.failed,
		inFlight: state.inFlight.size,
		overflowed: state.overflowed,
	});
}

function adapterError(
	code: KeyedRateLimitAuthorityAdapterErrorCode,
	requestId?: string,
): KeyedRateLimitAuthorityAdapterError {
	const messages: Record<KeyedRateLimitAuthorityAdapterErrorCode, string> = {
		"malformed-request": "The authority adapter rejected a malformed request.",
		"malformed-outcome": "The authority adapter rejected a malformed authority outcome.",
		"outcome-mismatch": "The authority adapter rejected a mismatched authority outcome.",
		"request-overflow": "The bounded authority-request capacity was exhausted.",
		"authority-threw": "The external rate-limit authority was unavailable.",
	};
	return Object.freeze({
		kind: "keyed-rate-limit-authority-error",
		version: KEYED_RATE_LIMIT_VERSION,
		code,
		message: messages[code],
		...(requestId === undefined ? {} : { requestId }),
	});
}

function unavailableOutcome(
	request: KeyedRateLimitRequest,
	reason: "malformed-outcome" | "outcome-mismatch" | "authority-threw",
): KeyedRateLimitOutcome {
	return createKeyedRateLimitOutcome(request, {
		outcomeId: compoundTupleKey("keyed-rate-limit-adapter-outcome", [request.requestId, reason]),
		result: "unavailable",
		provenance: [request.authority],
	});
}

function outcomeMatchesRequest(
	outcome: KeyedRateLimitOutcome,
	request: KeyedRateLimitRequest,
): boolean {
	return (
		outcome.requestId === request.requestId &&
		outcome.requestIdentity.key === keyedRateLimitRequestIdentity(request).key &&
		outcome.authority.kind === request.authority.kind &&
		outcome.authority.id === request.authority.id &&
		outcome.authority.revision === request.authority.revision
	);
}

function adapterProjection<TFact extends KeyedRateLimitAuthorityAdapterFact>(
	graph: Graph,
	events: Node<KeyedRateLimitAuthorityAdapterFact>,
	name: string,
	factory: string,
	predicate: (fact: KeyedRateLimitAuthorityAdapterFact) => fact is TFact,
): Node<TFact> {
	return graph.node<TFact>(
		[events],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as KeyedRateLimitAuthorityAdapterFact;
				if (predicate(fact)) ctx.down([["DATA", fact]]);
			}
		},
		{
			name,
			factory,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
}

function runCancel(cancel: KeyedRateLimitAuthorityCancel): void {
	try {
		cancel();
	} catch {
		// Host-private cleanup failure cannot re-enter Graph DATA during deactivation.
	}
}

function boundedAdapterOption(value: number | undefined, fallback: number, label: string): number {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_BOUND) {
		throw new RangeError(`${label} must be a safe integer between 1 and ${MAX_BOUND}`);
	}
	return resolved;
}
