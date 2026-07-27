/** D651 focused keyed rate-limit contracts and graph-visible admission correlation. */
import { depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import { compoundTupleKey } from "../identity.js";
import { strictCanonicalJsonBytes, strictJsonCodec } from "../json/codec.js";
import type { Node } from "../node/node.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export const KEYED_RATE_LIMIT_VERSION = 1 as const;
export const KEYED_RATE_LIMIT_REQUEST_FORMAT = "graphrefly.keyedRateLimitRequest" as const;
export const KEYED_RATE_LIMIT_REQUEST_IDENTITY_FORMAT =
	"graphrefly.keyedRateLimitRequestIdentity" as const;
export const KEYED_RATE_LIMIT_OUTCOME_FORMAT = "graphrefly.keyedRateLimitOutcome" as const;

const DEFAULT_MAX_PENDING = 128;
const DEFAULT_MAX_COMPLETED = 256;
const MAX_BOUND = 4_096;
const MAX_COORDINATES = 32;
const MAX_TEXT_CHARS = 256;
const MAX_IDENTITY_CHARS = 4_096;

export interface KeyedRateLimitCoordinate {
	readonly kind: string;
	readonly id: string;
	readonly revision: string;
}

export interface KeyedRateLimitAlgorithmCoordinate {
	readonly kind: string;
	readonly revision: string;
}

export interface KeyedRateLimitPolicyCoordinate {
	readonly id: string;
	readonly revision: string;
	readonly algorithm: KeyedRateLimitAlgorithmCoordinate;
}

export interface KeyedRateLimitRequest {
	readonly format: typeof KEYED_RATE_LIMIT_REQUEST_FORMAT;
	readonly version: typeof KEYED_RATE_LIMIT_VERSION;
	readonly requestId: string;
	readonly key: KeyedRateLimitCoordinate;
	readonly policy: KeyedRateLimitPolicyCoordinate;
	readonly authority: KeyedRateLimitCoordinate;
	readonly operation: KeyedRateLimitCoordinate;
	readonly units: number;
}

export interface KeyedRateLimitRequestIdentity {
	readonly format: typeof KEYED_RATE_LIMIT_REQUEST_IDENTITY_FORMAT;
	readonly version: typeof KEYED_RATE_LIMIT_VERSION;
	readonly key: string;
}

export type KeyedRateLimitOutcomeResult = "allowed" | "denied" | "unavailable" | "conflict";

export type KeyedRateLimitOutcomeReason =
	| "within-limit"
	| "quota-exhausted"
	| "authority-unavailable"
	| "request-conflict";

export interface KeyedRateLimitOutcome {
	readonly format: typeof KEYED_RATE_LIMIT_OUTCOME_FORMAT;
	readonly version: typeof KEYED_RATE_LIMIT_VERSION;
	readonly outcomeId: string;
	readonly requestId: string;
	readonly requestIdentity: KeyedRateLimitRequestIdentity;
	readonly authority: KeyedRateLimitCoordinate;
	readonly result: KeyedRateLimitOutcomeResult;
	readonly reason: KeyedRateLimitOutcomeReason;
	readonly remainingUnits: number | null;
	readonly resetAtMs: number | null;
	readonly retryAfterMs: number | null;
	readonly provenance: readonly KeyedRateLimitCoordinate[];
}

export interface CreateKeyedRateLimitOutcomeOptions {
	readonly outcomeId: string;
	readonly result: KeyedRateLimitOutcomeResult;
	readonly remainingUnits?: number | null;
	readonly resetAtMs?: number | null;
	readonly retryAfterMs?: number | null;
	readonly provenance?: readonly KeyedRateLimitCoordinate[];
}

export interface KeyedRateLimitAdmission {
	readonly kind: "keyed-rate-limit-admission";
	readonly version: typeof KEYED_RATE_LIMIT_VERSION;
	readonly admissionId: string;
	readonly requestId: string;
	readonly outcomeId: string;
	readonly policy: KeyedRateLimitPolicyCoordinate;
	readonly authority: KeyedRateLimitCoordinate;
	readonly operation: KeyedRateLimitCoordinate;
	readonly units: number;
	readonly remainingUnits: number;
	readonly resetAtMs: number | null;
	readonly provenance: readonly KeyedRateLimitCoordinate[];
}

export interface KeyedRateLimitDenial {
	readonly kind: "keyed-rate-limit-denial";
	readonly version: typeof KEYED_RATE_LIMIT_VERSION;
	readonly denialId: string;
	readonly requestId: string;
	readonly outcomeId: string;
	readonly policy: KeyedRateLimitPolicyCoordinate;
	readonly authority: KeyedRateLimitCoordinate;
	readonly operation: KeyedRateLimitCoordinate;
	readonly units: number;
	readonly reason: "quota-exhausted";
	readonly remainingUnits: number;
	readonly resetAtMs: number | null;
	readonly retryAfterMs: number | null;
	readonly provenance: readonly KeyedRateLimitCoordinate[];
}

export type KeyedRateLimitStatusState = "pending" | "ready" | "failed";

export type KeyedRateLimitStatusReason =
	| "awaiting-authority"
	| KeyedRateLimitOutcomeReason
	| "malformed-request"
	| "malformed-outcome"
	| "request-overflow"
	| "orphan-outcome"
	| "outcome-mismatch"
	| "outcome-conflict";

export interface KeyedRateLimitStatus {
	readonly kind: "keyed-rate-limit-status";
	readonly version: typeof KEYED_RATE_LIMIT_VERSION;
	readonly requestId?: string;
	readonly outcomeId?: string;
	readonly state: KeyedRateLimitStatusState;
	readonly result: "allowed" | "denied" | null;
	readonly reason: KeyedRateLimitStatusReason;
}

export type KeyedRateLimitIssueCode =
	| "keyed-rate-limit-malformed-request"
	| "keyed-rate-limit-malformed-outcome"
	| "keyed-rate-limit-request-conflict"
	| "keyed-rate-limit-request-overflow"
	| "keyed-rate-limit-orphan-outcome"
	| "keyed-rate-limit-outcome-mismatch"
	| "keyed-rate-limit-outcome-conflict"
	| "keyed-rate-limit-authority-unavailable";

export interface KeyedRateLimitIssue {
	readonly kind: "keyed-rate-limit-issue";
	readonly version: typeof KEYED_RATE_LIMIT_VERSION;
	readonly code: KeyedRateLimitIssueCode;
	readonly message: string;
	readonly requestId?: string;
}

export type KeyedRateLimitAuditEvent =
	| "request-pending"
	| "request-replayed"
	| "request-rejected"
	| "outcome-allowed"
	| "outcome-denied"
	| "outcome-failed"
	| "outcome-replayed"
	| "outcome-rejected"
	| "completed-evicted";

export interface KeyedRateLimitAuditEntry {
	readonly kind: "keyed-rate-limit-audit";
	readonly version: typeof KEYED_RATE_LIMIT_VERSION;
	readonly auditId: string;
	readonly sequence: number;
	readonly event: KeyedRateLimitAuditEvent;
	readonly requestId?: string;
	readonly result?: KeyedRateLimitOutcomeResult;
	readonly issueCode?: KeyedRateLimitIssueCode;
}

export interface KeyedRateLimitCursor {
	readonly kind: "keyed-rate-limit-cursor";
	readonly version: typeof KEYED_RATE_LIMIT_VERSION;
	readonly receivedRequests: number;
	readonly validRequests: number;
	readonly invalidRequests: number;
	readonly receivedOutcomes: number;
	readonly validOutcomes: number;
	readonly invalidOutcomes: number;
	readonly pending: number;
	readonly completedRetained: number;
	readonly completedEvicted: number;
	readonly allowed: number;
	readonly denied: number;
	readonly unavailable: number;
	readonly conflicts: number;
	readonly replays: number;
	readonly orphaned: number;
	readonly mismatched: number;
	readonly overflowed: number;
}

export type KeyedRateLimitCorrelationFact = KeyedRateLimitRequest | KeyedRateLimitOutcome;

interface KeyedRateLimitAdmissionBundleBaseOptions {
	readonly name?: string;
	readonly maxPending?: number;
	readonly maxCompleted?: number;
}

export type KeyedRateLimitAdmissionBundleOptions = KeyedRateLimitAdmissionBundleBaseOptions &
	(
		| {
				readonly requests: Node<KeyedRateLimitRequest>;
				readonly outcomes: Node<KeyedRateLimitOutcome>;
				readonly correlationFacts?: never;
		  }
		| {
				readonly correlationFacts: Node<KeyedRateLimitCorrelationFact>;
				readonly requests?: never;
				readonly outcomes?: never;
		  }
	);

export type KeyedRateLimitAdmissionBundleInput =
	| {
			readonly requests: Node<KeyedRateLimitRequest>;
			readonly outcomes: Node<KeyedRateLimitOutcome>;
			readonly correlationFacts?: never;
	  }
	| {
			readonly correlationFacts: Node<KeyedRateLimitCorrelationFact>;
			readonly requests?: never;
			readonly outcomes?: never;
	  };

export interface KeyedRateLimitAdmissionBundle {
	readonly input: KeyedRateLimitAdmissionBundleInput;
	readonly admissions: Node<KeyedRateLimitAdmission>;
	readonly denials: Node<KeyedRateLimitDenial>;
	readonly status: Node<KeyedRateLimitStatus>;
	readonly issues: Node<KeyedRateLimitIssue>;
	readonly audit: Node<KeyedRateLimitAuditEntry>;
	readonly cursor: Node<KeyedRateLimitCursor>;
}

type KeyedRateLimitRuntimeFact =
	| KeyedRateLimitAdmission
	| KeyedRateLimitDenial
	| KeyedRateLimitStatus
	| KeyedRateLimitIssue
	| KeyedRateLimitAuditEntry
	| KeyedRateLimitCursor;

interface KeyedRateLimitEntry {
	readonly request: KeyedRateLimitRequest;
	readonly requestIdentity: KeyedRateLimitRequestIdentity;
	readonly requestIdentityKey: string;
	readonly sequence: number;
	outcome?: KeyedRateLimitOutcome;
	outcomeMaterial?: string;
}

interface MutableKeyedRateLimitCursor {
	receivedRequests: number;
	validRequests: number;
	invalidRequests: number;
	receivedOutcomes: number;
	validOutcomes: number;
	invalidOutcomes: number;
	pending: number;
	completedRetained: number;
	completedEvicted: number;
	allowed: number;
	denied: number;
	unavailable: number;
	conflicts: number;
	replays: number;
	orphaned: number;
	mismatched: number;
	overflowed: number;
}

interface KeyedRateLimitRuntimeState {
	readonly entries: Map<string, KeyedRateLimitEntry>;
	readonly completedOrder: string[];
	readonly cursor: MutableKeyedRateLimitCursor;
	nextEntrySequence: number;
	nextAuditSequence: number;
}

/**
 * Assert and deeply normalize one strict D648 keyed rate-limit request.
 *
 * Unknown fields, accessors, functions, BigInt, non-plain objects, unsafe numbers, and other
 * non-strict-JSON material fail instead of being ignored.
 *
 * @param value - Candidate complete request material.
 * @returns The immutable normalized strict request.
 * @category rate-limit
 * @example
 * ```ts
 * import { assertKeyedRateLimitRequest } from "@graphrefly/ts/rate-limit";
 * ```
 */
export function assertKeyedRateLimitRequest(value: unknown): KeyedRateLimitRequest {
	assertStrictJson(value);
	assertDataObject(value, "keyed rate-limit request");
	assertExactFields(
		value,
		["authority", "format", "key", "operation", "policy", "requestId", "units", "version"],
		"keyed rate-limit request",
	);
	if (value.format !== KEYED_RATE_LIMIT_REQUEST_FORMAT) {
		throw new TypeError("keyed rate-limit request has an invalid format");
	}
	if (value.version !== KEYED_RATE_LIMIT_VERSION) {
		throw new TypeError("keyed rate-limit request has an invalid version");
	}
	const requestId = nonEmptyString(value.requestId, "keyed rate-limit requestId");
	const units = positiveSafeInteger(value.units, "keyed rate-limit units");
	const request = Object.freeze({
		format: KEYED_RATE_LIMIT_REQUEST_FORMAT,
		version: KEYED_RATE_LIMIT_VERSION,
		requestId,
		key: canonicalCoordinate(value.key, "keyed rate-limit key"),
		policy: canonicalPolicy(value.policy),
		authority: canonicalCoordinate(value.authority, "keyed rate-limit authority"),
		operation: canonicalCoordinate(value.operation, "keyed rate-limit operation"),
		units,
	});
	assertStrictJson(request);
	boundedIdentityString(strictJsonText(request), "keyed rate-limit request canonical identity");
	return request;
}

/**
 * Return the strict-canonical identity of the complete D648 request frame.
 *
 * @param value - Candidate complete strict request material.
 * @returns The immutable canonical request identity.
 * @category rate-limit
 * @example
 * ```ts
 * import { keyedRateLimitRequestIdentity } from "@graphrefly/ts/rate-limit";
 * ```
 */
export function keyedRateLimitRequestIdentity(value: unknown): KeyedRateLimitRequestIdentity {
	const request = assertKeyedRateLimitRequest(value);
	return Object.freeze({
		format: KEYED_RATE_LIMIT_REQUEST_IDENTITY_FORMAT,
		version: KEYED_RATE_LIMIT_VERSION,
		key: strictJsonText(request),
	});
}

/**
 * Assert that an identity encodes one complete canonical D648 request.
 *
 * @param value - Candidate canonical identity material.
 * @returns The immutable validated request identity.
 * @category rate-limit
 * @example
 * ```ts
 * import { assertKeyedRateLimitRequestIdentity } from "@graphrefly/ts/rate-limit";
 * ```
 */
export function assertKeyedRateLimitRequestIdentity(value: unknown): KeyedRateLimitRequestIdentity {
	assertStrictJson(value);
	assertDataObject(value, "keyed rate-limit request identity");
	assertExactFields(value, ["format", "key", "version"], "keyed rate-limit request identity");
	if (value.format !== KEYED_RATE_LIMIT_REQUEST_IDENTITY_FORMAT) {
		throw new TypeError("keyed rate-limit request identity has an invalid format");
	}
	if (value.version !== KEYED_RATE_LIMIT_VERSION) {
		throw new TypeError("keyed rate-limit request identity has an invalid version");
	}
	const key = boundedIdentityString(value.key, "keyed rate-limit request identity key");
	let decoded: unknown;
	try {
		decoded = strictJsonCodec.decode(textEncoder.encode(key));
	} catch {
		throw new TypeError("keyed rate-limit request identity key is not strict canonical JSON");
	}
	const expected = keyedRateLimitRequestIdentity(decoded);
	if (expected.key !== key) {
		throw new TypeError("keyed rate-limit request identity key is not canonical");
	}
	return Object.freeze({
		format: KEYED_RATE_LIMIT_REQUEST_IDENTITY_FORMAT,
		version: KEYED_RATE_LIMIT_VERSION,
		key,
	});
}

/**
 * Create one externally authoritative outcome without handwritten canonical encoding.
 *
 * The host assigns the outcome id after a valid authority decision. This helper owns no durable
 * receipt, transaction, clock, evaluator, or admission.
 *
 * @param requestValue - The complete strict request decided by the host authority.
 * @param opts - The authoritative result, outcome id, quota material, and provenance.
 * @returns The immutable strict outcome for adapter delivery.
 * @category rate-limit
 * @example
 * ```ts
 * import { createKeyedRateLimitOutcome } from "@graphrefly/ts/rate-limit";
 * ```
 */
export function createKeyedRateLimitOutcome(
	requestValue: unknown,
	opts: CreateKeyedRateLimitOutcomeOptions,
): KeyedRateLimitOutcome {
	const request = assertKeyedRateLimitRequest(requestValue);
	const result = opts.result;
	const reason = expectedOutcomeReason(result);
	const remainingUnits =
		result === "allowed" || result === "denied"
			? nonNegativeSafeInteger(opts.remainingUnits, "keyed rate-limit outcome remainingUnits")
			: null;
	const outcome: KeyedRateLimitOutcome = {
		format: KEYED_RATE_LIMIT_OUTCOME_FORMAT,
		version: KEYED_RATE_LIMIT_VERSION,
		outcomeId: nonEmptyString(opts.outcomeId, "keyed rate-limit outcomeId"),
		requestId: request.requestId,
		requestIdentity: keyedRateLimitRequestIdentity(request),
		authority: request.authority,
		result,
		reason,
		remainingUnits,
		resetAtMs:
			result === "allowed" || result === "denied"
				? nullableNonNegativeSafeInteger(opts.resetAtMs, "keyed rate-limit outcome resetAtMs")
				: null,
		retryAfterMs:
			result === "allowed" || result === "denied"
				? nullableNonNegativeSafeInteger(opts.retryAfterMs, "keyed rate-limit outcome retryAfterMs")
				: null,
		provenance: canonicalCoordinates(
			opts.provenance ?? [request.authority],
			"keyed rate-limit outcome provenance",
		),
	};
	return assertKeyedRateLimitOutcome(outcome);
}

/**
 * Assert and deeply normalize one strict externally authoritative D648 outcome.
 *
 * @param value - Candidate externally authoritative outcome material.
 * @returns The immutable normalized strict outcome.
 * @category rate-limit
 * @example
 * ```ts
 * import { assertKeyedRateLimitOutcome } from "@graphrefly/ts/rate-limit";
 * ```
 */
export function assertKeyedRateLimitOutcome(value: unknown): KeyedRateLimitOutcome {
	assertStrictJson(value);
	assertDataObject(value, "keyed rate-limit outcome");
	assertExactFields(
		value,
		[
			"authority",
			"format",
			"outcomeId",
			"provenance",
			"reason",
			"remainingUnits",
			"requestId",
			"requestIdentity",
			"resetAtMs",
			"result",
			"retryAfterMs",
			"version",
		],
		"keyed rate-limit outcome",
	);
	if (value.format !== KEYED_RATE_LIMIT_OUTCOME_FORMAT) {
		throw new TypeError("keyed rate-limit outcome has an invalid format");
	}
	if (value.version !== KEYED_RATE_LIMIT_VERSION) {
		throw new TypeError("keyed rate-limit outcome has an invalid version");
	}
	const result = outcomeResult(value.result);
	const reason = expectedOutcomeReason(result);
	if (value.reason !== reason) {
		throw new TypeError("keyed rate-limit outcome reason does not match its result");
	}
	const remainingUnits =
		result === "allowed" || result === "denied"
			? nonNegativeSafeInteger(value.remainingUnits, "keyed rate-limit outcome remainingUnits")
			: nullOnly(value.remainingUnits, "keyed rate-limit outcome remainingUnits");
	const resetAtMs =
		result === "allowed" || result === "denied"
			? nullableNonNegativeSafeInteger(value.resetAtMs, "keyed rate-limit outcome resetAtMs")
			: nullOnly(value.resetAtMs, "keyed rate-limit outcome resetAtMs");
	const retryAfterMs =
		result === "allowed" || result === "denied"
			? nullableNonNegativeSafeInteger(value.retryAfterMs, "keyed rate-limit outcome retryAfterMs")
			: nullOnly(value.retryAfterMs, "keyed rate-limit outcome retryAfterMs");
	const outcome = Object.freeze({
		format: KEYED_RATE_LIMIT_OUTCOME_FORMAT,
		version: KEYED_RATE_LIMIT_VERSION,
		outcomeId: nonEmptyString(value.outcomeId, "keyed rate-limit outcomeId"),
		requestId: nonEmptyString(value.requestId, "keyed rate-limit outcome requestId"),
		requestIdentity: assertKeyedRateLimitRequestIdentity(value.requestIdentity),
		authority: canonicalCoordinate(value.authority, "keyed rate-limit outcome authority"),
		result,
		reason,
		remainingUnits,
		resetAtMs,
		retryAfterMs,
		provenance: canonicalCoordinates(value.provenance, "keyed rate-limit outcome provenance"),
	});
	assertStrictJson(outcome);
	return outcome;
}

/**
 * Build the D648/D649 bounded fact-stream admission gate.
 *
 * `opts.requests` contains authority-admitted requests, not arbitrary raw requests. When using
 * {@link attachKeyedRateLimitAuthority}, use its `authorityRequests` projection or composed
 * `admission` bundle. The graph validates correlation and currentness only. The host authority
 * owns durable quota, clocks, algorithms, and atomic consume. Replay suppression is exact while a
 * completed correlation remains retained; cross-restart business-effect idempotency remains
 * executor/application-owned.
 *
 * @param graph - Graph that owns the declared correlation and projection nodes.
 * @param opts - One bounded authority-admitted correlation lane and retention bounds.
 * @returns Graph-visible admissions, denials, status, issues, audit, and cursor projections.
 * @category rate-limit
 * @example
 * ```ts
 * import { keyedRateLimitAdmissionBundle } from "@graphrefly/ts/rate-limit";
 * ```
 */
export function keyedRateLimitAdmissionBundle(
	graph: Graph,
	opts: KeyedRateLimitAdmissionBundleOptions,
): KeyedRateLimitAdmissionBundle {
	const name = opts.name ?? "keyedRateLimit";
	const maxPending = boundedOption(opts.maxPending, DEFAULT_MAX_PENDING, "maxPending");
	const maxCompleted = boundedOption(opts.maxCompleted, DEFAULT_MAX_COMPLETED, "maxCompleted");
	const correlationFacts = opts.correlationFacts;
	const correlated = correlationFacts !== undefined;
	const deps: Node<unknown>[] = correlated
		? [correlationFacts as Node<unknown>]
		: [opts.requests as Node<unknown>, opts.outcomes as Node<unknown>];
	const runtime = graph.node<KeyedRateLimitRuntimeFact>(
		deps,
		(ctx) => {
			const state = ctx.state.get<KeyedRateLimitRuntimeState>() ?? initialRuntimeState();
			ctx.state.set(state);
			ctx.state.persist(true);
			const facts: KeyedRateLimitRuntimeFact[] = [];
			if (correlated) {
				for (const raw of depBatch(ctx, 0) ?? []) {
					processCorrelationFact(state, raw, maxPending, maxCompleted, facts);
				}
			} else {
				for (const raw of depBatch(ctx, 0) ?? []) {
					processRequest(state, raw, maxPending, facts);
				}
				for (const raw of depBatch(ctx, 1) ?? []) {
					processOutcome(state, raw, maxCompleted, facts);
				}
			}
			if (facts.length === 0) return;
			facts.push(cursorFact(state));
			ctx.down(facts.map((fact) => ["DATA", fact] as const));
		},
		{
			name: `${name}/runtime`,
			factory: "keyedRateLimitAdmission",
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
		},
	);
	return {
		input:
			correlationFacts !== undefined
				? { correlationFacts }
				: {
						requests: opts.requests as Node<KeyedRateLimitRequest>,
						outcomes: opts.outcomes as Node<KeyedRateLimitOutcome>,
					},
		admissions: runtimeProjection(
			graph,
			runtime,
			`${name}/admissions`,
			"keyedRateLimitAdmissions",
			(fact): fact is KeyedRateLimitAdmission => fact.kind === "keyed-rate-limit-admission",
		),
		denials: runtimeProjection(
			graph,
			runtime,
			`${name}/denials`,
			"keyedRateLimitDenials",
			(fact): fact is KeyedRateLimitDenial => fact.kind === "keyed-rate-limit-denial",
		),
		status: runtimeProjection(
			graph,
			runtime,
			`${name}/status`,
			"keyedRateLimitStatus",
			(fact): fact is KeyedRateLimitStatus => fact.kind === "keyed-rate-limit-status",
		),
		issues: runtimeProjection(
			graph,
			runtime,
			`${name}/issues`,
			"keyedRateLimitIssues",
			(fact): fact is KeyedRateLimitIssue => fact.kind === "keyed-rate-limit-issue",
		),
		audit: runtimeProjection(
			graph,
			runtime,
			`${name}/audit`,
			"keyedRateLimitAudit",
			(fact): fact is KeyedRateLimitAuditEntry => fact.kind === "keyed-rate-limit-audit",
		),
		cursor: runtimeProjection(
			graph,
			runtime,
			`${name}/cursor`,
			"keyedRateLimitCursor",
			(fact): fact is KeyedRateLimitCursor => fact.kind === "keyed-rate-limit-cursor",
		),
	};
}

function processCorrelationFact(
	state: KeyedRateLimitRuntimeState,
	raw: unknown,
	maxPending: number,
	maxCompleted: number,
	facts: KeyedRateLimitRuntimeFact[],
): void {
	try {
		processRequest(state, assertKeyedRateLimitRequest(raw), maxPending, facts);
		return;
	} catch {
		// The single correlation lane is a closed request-or-outcome sum.
	}
	processOutcome(state, raw, maxCompleted, facts);
}

function processRequest(
	state: KeyedRateLimitRuntimeState,
	raw: unknown,
	maxPending: number,
	facts: KeyedRateLimitRuntimeFact[],
): void {
	state.cursor.receivedRequests += 1;
	let request: KeyedRateLimitRequest;
	try {
		request = assertKeyedRateLimitRequest(raw);
		state.cursor.validRequests += 1;
	} catch {
		state.cursor.invalidRequests += 1;
		facts.push(
			issue("keyed-rate-limit-malformed-request"),
			status("failed", "malformed-request"),
			audit(state, "request-rejected", undefined, undefined, "keyed-rate-limit-malformed-request"),
		);
		return;
	}
	const identity = keyedRateLimitRequestIdentity(request);
	const existing = state.entries.get(request.requestId);
	if (existing !== undefined) {
		if (existing.requestIdentityKey === identity.key) {
			state.cursor.replays += 1;
			facts.push(statusForEntry(existing), audit(state, "request-replayed", request.requestId));
			return;
		}
		state.cursor.conflicts += 1;
		facts.push(
			issue("keyed-rate-limit-request-conflict", request.requestId),
			status("failed", "request-conflict", request.requestId),
			audit(
				state,
				"request-rejected",
				request.requestId,
				undefined,
				"keyed-rate-limit-request-conflict",
			),
		);
		return;
	}
	if (state.cursor.pending >= maxPending) {
		state.cursor.overflowed += 1;
		facts.push(
			issue("keyed-rate-limit-request-overflow", request.requestId),
			status("failed", "request-overflow", request.requestId),
			audit(
				state,
				"request-rejected",
				request.requestId,
				undefined,
				"keyed-rate-limit-request-overflow",
			),
		);
		return;
	}
	state.nextEntrySequence += 1;
	state.entries.set(request.requestId, {
		request,
		requestIdentity: identity,
		requestIdentityKey: identity.key,
		sequence: state.nextEntrySequence,
	});
	state.cursor.pending += 1;
	facts.push(
		status("pending", "awaiting-authority", request.requestId),
		audit(state, "request-pending", request.requestId),
	);
}

function processOutcome(
	state: KeyedRateLimitRuntimeState,
	raw: unknown,
	maxCompleted: number,
	facts: KeyedRateLimitRuntimeFact[],
): void {
	state.cursor.receivedOutcomes += 1;
	let outcome: KeyedRateLimitOutcome;
	try {
		outcome = assertKeyedRateLimitOutcome(raw);
		state.cursor.validOutcomes += 1;
	} catch {
		state.cursor.invalidOutcomes += 1;
		facts.push(
			issue("keyed-rate-limit-malformed-outcome"),
			status("failed", "malformed-outcome"),
			audit(state, "outcome-rejected", undefined, undefined, "keyed-rate-limit-malformed-outcome"),
		);
		return;
	}
	const entry = state.entries.get(outcome.requestId);
	if (entry === undefined) {
		state.cursor.orphaned += 1;
		facts.push(
			issue("keyed-rate-limit-orphan-outcome", outcome.requestId),
			status("failed", "orphan-outcome", outcome.requestId, outcome.outcomeId),
			audit(
				state,
				"outcome-rejected",
				outcome.requestId,
				outcome.result,
				"keyed-rate-limit-orphan-outcome",
			),
		);
		return;
	}
	if (
		entry.requestIdentityKey !== outcome.requestIdentity.key ||
		!sameCoordinate(entry.request.authority, outcome.authority)
	) {
		state.cursor.mismatched += 1;
		facts.push(
			issue("keyed-rate-limit-outcome-mismatch", outcome.requestId),
			status("failed", "outcome-mismatch", outcome.requestId, outcome.outcomeId),
			audit(
				state,
				"outcome-rejected",
				outcome.requestId,
				outcome.result,
				"keyed-rate-limit-outcome-mismatch",
			),
		);
		return;
	}
	const material = strictJsonText(outcome);
	if (entry.outcome !== undefined) {
		if (entry.outcomeMaterial === material) {
			state.cursor.replays += 1;
			facts.push(
				statusForEntry(entry),
				audit(state, "outcome-replayed", outcome.requestId, outcome.result),
			);
			return;
		}
		state.cursor.conflicts += 1;
		facts.push(
			issue("keyed-rate-limit-outcome-conflict", outcome.requestId),
			status("failed", "outcome-conflict", outcome.requestId, outcome.outcomeId),
			audit(
				state,
				"outcome-rejected",
				outcome.requestId,
				outcome.result,
				"keyed-rate-limit-outcome-conflict",
			),
		);
		return;
	}
	entry.outcome = outcome;
	entry.outcomeMaterial = material;
	state.cursor.pending -= 1;
	state.cursor.completedRetained += 1;
	state.completedOrder.push(outcome.requestId);
	if (outcome.result === "allowed") {
		state.cursor.allowed += 1;
		facts.push(
			admission(entry, outcome),
			statusForEntry(entry),
			audit(state, "outcome-allowed", outcome.requestId, "allowed"),
		);
	} else if (outcome.result === "denied") {
		state.cursor.denied += 1;
		facts.push(
			denial(entry, outcome),
			statusForEntry(entry),
			audit(state, "outcome-denied", outcome.requestId, "denied"),
		);
	} else {
		if (outcome.result === "unavailable") state.cursor.unavailable += 1;
		else state.cursor.conflicts += 1;
		const issueCode =
			outcome.result === "unavailable"
				? "keyed-rate-limit-authority-unavailable"
				: "keyed-rate-limit-request-conflict";
		facts.push(
			issue(issueCode, outcome.requestId),
			statusForEntry(entry),
			audit(state, "outcome-failed", outcome.requestId, outcome.result, issueCode),
		);
	}
	evictCompleted(state, maxCompleted, facts);
}

function admission(
	entry: KeyedRateLimitEntry,
	outcome: KeyedRateLimitOutcome,
): KeyedRateLimitAdmission {
	if (outcome.result !== "allowed" || outcome.remainingUnits === null) {
		throw new Error("keyed rate-limit internal admission invariant");
	}
	return Object.freeze({
		kind: "keyed-rate-limit-admission",
		version: KEYED_RATE_LIMIT_VERSION,
		admissionId: compoundTupleKey("keyed-rate-limit-admission", [
			entry.request.requestId,
			outcome.outcomeId,
		]),
		requestId: entry.request.requestId,
		outcomeId: outcome.outcomeId,
		policy: entry.request.policy,
		authority: entry.request.authority,
		operation: entry.request.operation,
		units: entry.request.units,
		remainingUnits: outcome.remainingUnits,
		resetAtMs: outcome.resetAtMs,
		provenance: outcome.provenance,
	});
}

function denial(entry: KeyedRateLimitEntry, outcome: KeyedRateLimitOutcome): KeyedRateLimitDenial {
	if (outcome.result !== "denied" || outcome.remainingUnits === null) {
		throw new Error("keyed rate-limit internal denial invariant");
	}
	return Object.freeze({
		kind: "keyed-rate-limit-denial",
		version: KEYED_RATE_LIMIT_VERSION,
		denialId: compoundTupleKey("keyed-rate-limit-denial", [
			entry.request.requestId,
			outcome.outcomeId,
		]),
		requestId: entry.request.requestId,
		outcomeId: outcome.outcomeId,
		policy: entry.request.policy,
		authority: entry.request.authority,
		operation: entry.request.operation,
		units: entry.request.units,
		reason: "quota-exhausted",
		remainingUnits: outcome.remainingUnits,
		resetAtMs: outcome.resetAtMs,
		retryAfterMs: outcome.retryAfterMs,
		provenance: outcome.provenance,
	});
}

function statusForEntry(entry: KeyedRateLimitEntry): KeyedRateLimitStatus {
	const outcome = entry.outcome;
	if (outcome === undefined)
		return status("pending", "awaiting-authority", entry.request.requestId);
	if (outcome.result === "allowed" || outcome.result === "denied") {
		return status(
			"ready",
			outcome.reason,
			entry.request.requestId,
			outcome.outcomeId,
			outcome.result,
		);
	}
	return status("failed", outcome.reason, entry.request.requestId, outcome.outcomeId);
}

function status(
	state: KeyedRateLimitStatusState,
	reason: KeyedRateLimitStatusReason,
	requestId?: string,
	outcomeId?: string,
	result: "allowed" | "denied" | null = null,
): KeyedRateLimitStatus {
	return Object.freeze({
		kind: "keyed-rate-limit-status",
		version: KEYED_RATE_LIMIT_VERSION,
		...(requestId === undefined ? {} : { requestId }),
		...(outcomeId === undefined ? {} : { outcomeId }),
		state,
		result,
		reason,
	});
}

function issue(code: KeyedRateLimitIssueCode, requestId?: string): KeyedRateLimitIssue {
	const messages: Record<KeyedRateLimitIssueCode, string> = {
		"keyed-rate-limit-malformed-request": "A rate-limit request was malformed and failed closed.",
		"keyed-rate-limit-malformed-outcome": "A rate-limit outcome was malformed and failed closed.",
		"keyed-rate-limit-request-conflict":
			"A request identifier was reused with different material and failed closed.",
		"keyed-rate-limit-request-overflow":
			"The bounded pending-request capacity was exhausted and the request failed closed.",
		"keyed-rate-limit-orphan-outcome":
			"An authority outcome had no retained matching request and failed closed.",
		"keyed-rate-limit-outcome-mismatch":
			"An authority outcome did not exactly match the retained request and failed closed.",
		"keyed-rate-limit-outcome-conflict":
			"Conflicting outcomes were supplied for one request and failed closed.",
		"keyed-rate-limit-authority-unavailable":
			"The external rate-limit authority was unavailable and the request failed closed.",
	};
	return Object.freeze({
		kind: "keyed-rate-limit-issue",
		version: KEYED_RATE_LIMIT_VERSION,
		code,
		message: messages[code],
		...(requestId === undefined ? {} : { requestId }),
	});
}

function audit(
	state: KeyedRateLimitRuntimeState,
	event: KeyedRateLimitAuditEvent,
	requestId?: string,
	result?: KeyedRateLimitOutcomeResult,
	issueCode?: KeyedRateLimitIssueCode,
): KeyedRateLimitAuditEntry {
	state.nextAuditSequence += 1;
	return Object.freeze({
		kind: "keyed-rate-limit-audit",
		version: KEYED_RATE_LIMIT_VERSION,
		auditId: compoundTupleKey("keyed-rate-limit-audit", [
			String(state.nextAuditSequence),
			event,
			requestId ?? "",
		]),
		sequence: state.nextAuditSequence,
		event,
		...(requestId === undefined ? {} : { requestId }),
		...(result === undefined ? {} : { result }),
		...(issueCode === undefined ? {} : { issueCode }),
	});
}

function cursorFact(state: KeyedRateLimitRuntimeState): KeyedRateLimitCursor {
	return Object.freeze({
		kind: "keyed-rate-limit-cursor",
		version: KEYED_RATE_LIMIT_VERSION,
		...state.cursor,
	});
}

function evictCompleted(
	state: KeyedRateLimitRuntimeState,
	maxCompleted: number,
	facts: KeyedRateLimitRuntimeFact[],
): void {
	while (state.completedOrder.length > maxCompleted) {
		const requestId = state.completedOrder.shift();
		if (requestId === undefined) break;
		const entry = state.entries.get(requestId);
		if (entry?.outcome === undefined) continue;
		state.entries.delete(requestId);
		state.cursor.completedRetained -= 1;
		state.cursor.completedEvicted += 1;
		facts.push(audit(state, "completed-evicted", requestId));
	}
}

function runtimeProjection<TFact extends KeyedRateLimitRuntimeFact>(
	graph: Graph,
	runtime: Node<KeyedRateLimitRuntimeFact>,
	name: string,
	factory: string,
	predicate: (fact: KeyedRateLimitRuntimeFact) => fact is TFact,
): Node<TFact> {
	return graph.node<TFact>(
		[runtime],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as KeyedRateLimitRuntimeFact;
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

function initialRuntimeState(): KeyedRateLimitRuntimeState {
	return {
		entries: new Map(),
		completedOrder: [],
		cursor: {
			receivedRequests: 0,
			validRequests: 0,
			invalidRequests: 0,
			receivedOutcomes: 0,
			validOutcomes: 0,
			invalidOutcomes: 0,
			pending: 0,
			completedRetained: 0,
			completedEvicted: 0,
			allowed: 0,
			denied: 0,
			unavailable: 0,
			conflicts: 0,
			replays: 0,
			orphaned: 0,
			mismatched: 0,
			overflowed: 0,
		},
		nextEntrySequence: 0,
		nextAuditSequence: 0,
	};
}

function canonicalCoordinate(value: unknown, label: string): KeyedRateLimitCoordinate {
	assertDataObject(value, label);
	assertExactFields(value, ["id", "kind", "revision"], label);
	return Object.freeze({
		kind: nonEmptyString(value.kind, `${label} kind`),
		id: nonEmptyString(value.id, `${label} id`),
		revision: nonEmptyString(value.revision, `${label} revision`),
	});
}

function canonicalPolicy(value: unknown): KeyedRateLimitPolicyCoordinate {
	assertDataObject(value, "keyed rate-limit policy");
	assertExactFields(value, ["algorithm", "id", "revision"], "keyed rate-limit policy");
	assertDataObject(value.algorithm, "keyed rate-limit algorithm");
	assertExactFields(value.algorithm, ["kind", "revision"], "keyed rate-limit algorithm");
	return Object.freeze({
		id: nonEmptyString(value.id, "keyed rate-limit policy id"),
		revision: nonEmptyString(value.revision, "keyed rate-limit policy revision"),
		algorithm: Object.freeze({
			kind: nonEmptyString(value.algorithm.kind, "keyed rate-limit algorithm kind"),
			revision: nonEmptyString(value.algorithm.revision, "keyed rate-limit algorithm revision"),
		}),
	});
}

function canonicalCoordinates(value: unknown, label: string): readonly KeyedRateLimitCoordinate[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
	if (value.length > MAX_COORDINATES) {
		throw new RangeError(`${label} must contain at most ${MAX_COORDINATES} coordinates`);
	}
	const coordinates = value.map((item, index) => canonicalCoordinate(item, `${label}[${index}]`));
	coordinates.sort(compareCoordinate);
	for (let i = 1; i < coordinates.length; i += 1) {
		if (sameCoordinate(coordinates[i - 1], coordinates[i])) {
			throw new TypeError(`${label} must not contain duplicate coordinates`);
		}
	}
	return Object.freeze(coordinates);
}

function compareCoordinate(a: KeyedRateLimitCoordinate, b: KeyedRateLimitCoordinate): number {
	return (
		compareString(a.kind, b.kind) ||
		compareString(a.id, b.id) ||
		compareString(a.revision, b.revision)
	);
}

function compareString(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function sameCoordinate(a: KeyedRateLimitCoordinate, b: KeyedRateLimitCoordinate): boolean {
	return a.kind === b.kind && a.id === b.id && a.revision === b.revision;
}

function expectedOutcomeReason(result: KeyedRateLimitOutcomeResult): KeyedRateLimitOutcomeReason {
	if (result === "allowed") return "within-limit";
	if (result === "denied") return "quota-exhausted";
	if (result === "unavailable") return "authority-unavailable";
	return "request-conflict";
}

function outcomeResult(value: unknown): KeyedRateLimitOutcomeResult {
	if (
		value === "allowed" ||
		value === "denied" ||
		value === "unavailable" ||
		value === "conflict"
	) {
		return value;
	}
	throw new TypeError("keyed rate-limit outcome result is invalid");
}

function boundedOption(value: number | undefined, fallback: number, label: string): number {
	const normalized = value ?? fallback;
	if (!Number.isSafeInteger(normalized) || normalized <= 0 || normalized > MAX_BOUND) {
		throw new RangeError(`keyedRateLimitAdmissionBundle: ${label} must be 1..${MAX_BOUND}`);
	}
	return normalized;
}

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > MAX_TEXT_CHARS) {
		throw new TypeError(`${label} must be a non-empty string of at most ${MAX_TEXT_CHARS} chars`);
	}
	return value;
}

function boundedIdentityString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > MAX_IDENTITY_CHARS) {
		throw new TypeError(
			`${label} must be a non-empty string of at most ${MAX_IDENTITY_CHARS} chars`,
		);
	}
	return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new TypeError(`${label} must be a positive safe integer`);
	}
	return value as number;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new TypeError(`${label} must be a non-negative safe integer`);
	}
	return value as number;
}

function nullableNonNegativeSafeInteger(value: unknown, label: string): number | null {
	return value === undefined || value === null ? null : nonNegativeSafeInteger(value, label);
}

function nullOnly(value: unknown, label: string): null {
	if (value !== null) throw new TypeError(`${label} must be null for this outcome result`);
	return null;
}

function assertStrictJson(value: unknown): void {
	strictCanonicalJsonBytes(value);
}

function assertDataObject(value: unknown, label: string): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new TypeError(`${label} must be an object`);
	}
}

function assertExactFields(
	value: Record<string, unknown>,
	expected: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new TypeError(`${label} has unknown or missing fields`);
	}
}

function strictJsonText(value: unknown): string {
	return textDecoder.decode(strictCanonicalJsonBytes(value));
}
