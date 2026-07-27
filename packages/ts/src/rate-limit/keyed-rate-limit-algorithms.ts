/** D650 strict deterministic host-side reference transitions, owned by the D651 focused surface. */
import { assertStrictJsonObject } from "../json/codec.js";
import {
	assertKeyedRateLimitRequest,
	type KeyedRateLimitCoordinate,
	type KeyedRateLimitPolicyCoordinate,
	type KeyedRateLimitRequest,
} from "./keyed-rate-limit.js";

export const KEYED_RATE_LIMIT_REFERENCE_VERSION = 1 as const;
export const KEYED_RATE_LIMIT_TRANSITION_FORMAT = "graphrefly.keyedRateLimitTransition" as const;

export const FIXED_WINDOW_RATE_LIMIT_ALGORITHM = "fixed-window-v1" as const;
export const SLIDING_WINDOW_RATE_LIMIT_ALGORITHM = "sliding-window-v1" as const;
export const TOKEN_BUCKET_RATE_LIMIT_ALGORITHM = "token-bucket-v1" as const;

export const FIXED_WINDOW_RATE_LIMIT_POLICY_FORMAT =
	"graphrefly.fixedWindowRateLimitPolicy" as const;
export const SLIDING_WINDOW_RATE_LIMIT_POLICY_FORMAT =
	"graphrefly.slidingWindowRateLimitPolicy" as const;
export const TOKEN_BUCKET_RATE_LIMIT_POLICY_FORMAT =
	"graphrefly.tokenBucketRateLimitPolicy" as const;

export const FIXED_WINDOW_RATE_LIMIT_STATE_FORMAT = "graphrefly.fixedWindowRateLimitState" as const;
export const SLIDING_WINDOW_RATE_LIMIT_STATE_FORMAT =
	"graphrefly.slidingWindowRateLimitState" as const;
export const TOKEN_BUCKET_RATE_LIMIT_STATE_FORMAT = "graphrefly.tokenBucketRateLimitState" as const;

export const FIXED_WINDOW_RATE_LIMIT_INPUT_FORMAT =
	"graphrefly.fixedWindowRateLimitTransitionInput" as const;
export const SLIDING_WINDOW_RATE_LIMIT_INPUT_FORMAT =
	"graphrefly.slidingWindowRateLimitTransitionInput" as const;
export const TOKEN_BUCKET_RATE_LIMIT_INPUT_FORMAT =
	"graphrefly.tokenBucketRateLimitTransitionInput" as const;

export const SLIDING_WINDOW_RATE_LIMIT_MAX_ENTRIES_V1 = 4_096 as const;

const MAX_TEXT_CHARS = 256;

export interface KeyedRateLimitReferenceScope {
	readonly key: KeyedRateLimitCoordinate;
	readonly policy: KeyedRateLimitPolicyCoordinate;
	readonly authority: KeyedRateLimitCoordinate;
	readonly stateRevision: string;
}

export interface FixedWindowRateLimitPolicy {
	readonly format: typeof FIXED_WINDOW_RATE_LIMIT_POLICY_FORMAT;
	readonly version: typeof KEYED_RATE_LIMIT_REFERENCE_VERSION;
	readonly algorithm: typeof FIXED_WINDOW_RATE_LIMIT_ALGORITHM;
	readonly scope: KeyedRateLimitReferenceScope;
	readonly capacityUnits: number;
	readonly windowMs: number;
}

export interface SlidingWindowRateLimitPolicy {
	readonly format: typeof SLIDING_WINDOW_RATE_LIMIT_POLICY_FORMAT;
	readonly version: typeof KEYED_RATE_LIMIT_REFERENCE_VERSION;
	readonly algorithm: typeof SLIDING_WINDOW_RATE_LIMIT_ALGORITHM;
	readonly scope: KeyedRateLimitReferenceScope;
	readonly capacityUnits: number;
	readonly windowMs: number;
	readonly maxEntries: number;
}

export interface TokenBucketRateLimitPolicy {
	readonly format: typeof TOKEN_BUCKET_RATE_LIMIT_POLICY_FORMAT;
	readonly version: typeof KEYED_RATE_LIMIT_REFERENCE_VERSION;
	readonly algorithm: typeof TOKEN_BUCKET_RATE_LIMIT_ALGORITHM;
	readonly scope: KeyedRateLimitReferenceScope;
	readonly capacityUnits: number;
	readonly refillUnits: number;
	readonly refillPeriodMs: number;
	readonly initialUnits: number;
}

export type KeyedRateLimitReferencePolicy =
	| FixedWindowRateLimitPolicy
	| SlidingWindowRateLimitPolicy
	| TokenBucketRateLimitPolicy;

export interface FixedWindowRateLimitState {
	readonly format: typeof FIXED_WINDOW_RATE_LIMIT_STATE_FORMAT;
	readonly version: typeof KEYED_RATE_LIMIT_REFERENCE_VERSION;
	readonly algorithm: typeof FIXED_WINDOW_RATE_LIMIT_ALGORITHM;
	readonly scope: KeyedRateLimitReferenceScope;
	readonly windowStartMs: number;
	readonly usedUnits: number;
	readonly lastObservedAtMs: number;
}

export interface SlidingWindowRateLimitEntry {
	readonly atMs: number;
	readonly units: number;
}

export interface SlidingWindowRateLimitState {
	readonly format: typeof SLIDING_WINDOW_RATE_LIMIT_STATE_FORMAT;
	readonly version: typeof KEYED_RATE_LIMIT_REFERENCE_VERSION;
	readonly algorithm: typeof SLIDING_WINDOW_RATE_LIMIT_ALGORITHM;
	readonly scope: KeyedRateLimitReferenceScope;
	readonly entries: readonly SlidingWindowRateLimitEntry[];
	readonly usedUnits: number;
	readonly lastObservedAtMs: number;
}

export interface TokenBucketRateLimitState {
	readonly format: typeof TOKEN_BUCKET_RATE_LIMIT_STATE_FORMAT;
	readonly version: typeof KEYED_RATE_LIMIT_REFERENCE_VERSION;
	readonly algorithm: typeof TOKEN_BUCKET_RATE_LIMIT_ALGORITHM;
	readonly scope: KeyedRateLimitReferenceScope;
	readonly availableUnits: number;
	readonly refillRemainder: number;
	readonly lastObservedAtMs: number;
}

export type KeyedRateLimitReferenceState =
	| FixedWindowRateLimitState
	| SlidingWindowRateLimitState
	| TokenBucketRateLimitState;

export interface FixedWindowRateLimitTransitionInput {
	readonly format: typeof FIXED_WINDOW_RATE_LIMIT_INPUT_FORMAT;
	readonly version: typeof KEYED_RATE_LIMIT_REFERENCE_VERSION;
	readonly algorithm: typeof FIXED_WINDOW_RATE_LIMIT_ALGORITHM;
	readonly request: KeyedRateLimitRequest;
	readonly policy: FixedWindowRateLimitPolicy;
	readonly state: FixedWindowRateLimitState | null;
	readonly observedAtMs: number;
}

export interface SlidingWindowRateLimitTransitionInput {
	readonly format: typeof SLIDING_WINDOW_RATE_LIMIT_INPUT_FORMAT;
	readonly version: typeof KEYED_RATE_LIMIT_REFERENCE_VERSION;
	readonly algorithm: typeof SLIDING_WINDOW_RATE_LIMIT_ALGORITHM;
	readonly request: KeyedRateLimitRequest;
	readonly policy: SlidingWindowRateLimitPolicy;
	readonly state: SlidingWindowRateLimitState | null;
	readonly observedAtMs: number;
}

export interface TokenBucketRateLimitTransitionInput {
	readonly format: typeof TOKEN_BUCKET_RATE_LIMIT_INPUT_FORMAT;
	readonly version: typeof KEYED_RATE_LIMIT_REFERENCE_VERSION;
	readonly algorithm: typeof TOKEN_BUCKET_RATE_LIMIT_ALGORITHM;
	readonly request: KeyedRateLimitRequest;
	readonly policy: TokenBucketRateLimitPolicy;
	readonly state: TokenBucketRateLimitState | null;
	readonly observedAtMs: number;
}

export type KeyedRateLimitReferenceTransitionInput =
	| FixedWindowRateLimitTransitionInput
	| SlidingWindowRateLimitTransitionInput
	| TokenBucketRateLimitTransitionInput;

export type KeyedRateLimitTransitionResult = "allowed" | "denied";

export interface KeyedRateLimitReferenceTransition<
	State extends KeyedRateLimitReferenceState,
	Algorithm extends
		| typeof FIXED_WINDOW_RATE_LIMIT_ALGORITHM
		| typeof SLIDING_WINDOW_RATE_LIMIT_ALGORITHM
		| typeof TOKEN_BUCKET_RATE_LIMIT_ALGORITHM,
> {
	readonly format: typeof KEYED_RATE_LIMIT_TRANSITION_FORMAT;
	readonly version: typeof KEYED_RATE_LIMIT_REFERENCE_VERSION;
	readonly algorithm: Algorithm;
	readonly status: "ready";
	readonly result: KeyedRateLimitTransitionResult;
	readonly nextState: State;
	readonly remainingUnits: number;
	readonly resetAtMs: number | null;
	readonly retryAfterMs: number | null;
}

export type FixedWindowRateLimitTransition = KeyedRateLimitReferenceTransition<
	FixedWindowRateLimitState,
	typeof FIXED_WINDOW_RATE_LIMIT_ALGORITHM
>;
export type SlidingWindowRateLimitTransition = KeyedRateLimitReferenceTransition<
	SlidingWindowRateLimitState,
	typeof SLIDING_WINDOW_RATE_LIMIT_ALGORITHM
>;
export type TokenBucketRateLimitTransition = KeyedRateLimitReferenceTransition<
	TokenBucketRateLimitState,
	typeof TOKEN_BUCKET_RATE_LIMIT_ALGORITHM
>;
export type KeyedRateLimitTransition =
	| FixedWindowRateLimitTransition
	| SlidingWindowRateLimitTransition
	| TokenBucketRateLimitTransition;

export type KeyedRateLimitTransitionErrorCode =
	| "malformed-request"
	| "malformed-policy"
	| "malformed-state"
	| "malformed-input"
	| "malformed-transition"
	| "scope-mismatch"
	| "revision-mismatch"
	| "time-regression"
	| "arithmetic-overflow"
	| "state-bound-overflow";

/** Sanitized fail-closed error from a D650 reference transition evaluator. */
export class KeyedRateLimitTransitionError extends Error {
	readonly code: KeyedRateLimitTransitionErrorCode;

	constructor(code: KeyedRateLimitTransitionErrorCode) {
		super(`keyed rate-limit reference transition failed: ${code}`);
		this.name = "KeyedRateLimitTransitionError";
		this.code = code;
	}
}

export interface CreateFixedWindowRateLimitPolicyOptions {
	readonly stateRevision: string;
	readonly capacityUnits: number;
	readonly windowMs: number;
}

export interface CreateSlidingWindowRateLimitPolicyOptions {
	readonly stateRevision: string;
	readonly capacityUnits: number;
	readonly windowMs: number;
	readonly maxEntries: number;
}

export interface CreateTokenBucketRateLimitPolicyOptions {
	readonly stateRevision: string;
	readonly capacityUnits: number;
	readonly refillUnits: number;
	readonly refillPeriodMs: number;
	readonly initialUnits: number;
}

/** Create one exact scoped fixed-window-v1 policy from an already-identifiable request. */
export function createFixedWindowRateLimitPolicy(
	requestValue: unknown,
	opts: CreateFixedWindowRateLimitPolicyOptions,
): FixedWindowRateLimitPolicy {
	const request = sanitizedRequest(requestValue);
	if (request.policy.algorithm.kind !== "fixed-window") fail("revision-mismatch");
	const options = policyOptions(opts, ["capacityUnits", "stateRevision", "windowMs"]);
	return assertFixedWindowRateLimitPolicy({
		format: FIXED_WINDOW_RATE_LIMIT_POLICY_FORMAT,
		version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
		algorithm: FIXED_WINDOW_RATE_LIMIT_ALGORITHM,
		scope: scopeFromRequest(request, options.stateRevision),
		capacityUnits: options.capacityUnits,
		windowMs: options.windowMs,
	});
}

/** Create one exact scoped sliding-window-v1 policy from an already-identifiable request. */
export function createSlidingWindowRateLimitPolicy(
	requestValue: unknown,
	opts: CreateSlidingWindowRateLimitPolicyOptions,
): SlidingWindowRateLimitPolicy {
	const request = sanitizedRequest(requestValue);
	if (request.policy.algorithm.kind !== "sliding-window") fail("revision-mismatch");
	const options = policyOptions(opts, ["capacityUnits", "maxEntries", "stateRevision", "windowMs"]);
	return assertSlidingWindowRateLimitPolicy({
		format: SLIDING_WINDOW_RATE_LIMIT_POLICY_FORMAT,
		version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
		algorithm: SLIDING_WINDOW_RATE_LIMIT_ALGORITHM,
		scope: scopeFromRequest(request, options.stateRevision),
		capacityUnits: options.capacityUnits,
		windowMs: options.windowMs,
		maxEntries: options.maxEntries,
	});
}

/** Create one exact scoped token-bucket-v1 policy from an already-identifiable request. */
export function createTokenBucketRateLimitPolicy(
	requestValue: unknown,
	opts: CreateTokenBucketRateLimitPolicyOptions,
): TokenBucketRateLimitPolicy {
	const request = sanitizedRequest(requestValue);
	if (request.policy.algorithm.kind !== "token-bucket") fail("revision-mismatch");
	const options = policyOptions(opts, [
		"capacityUnits",
		"initialUnits",
		"refillPeriodMs",
		"refillUnits",
		"stateRevision",
	]);
	return assertTokenBucketRateLimitPolicy({
		format: TOKEN_BUCKET_RATE_LIMIT_POLICY_FORMAT,
		version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
		algorithm: TOKEN_BUCKET_RATE_LIMIT_ALGORITHM,
		scope: scopeFromRequest(request, options.stateRevision),
		capacityUnits: options.capacityUnits,
		refillUnits: options.refillUnits,
		refillPeriodMs: options.refillPeriodMs,
		initialUnits: options.initialUnits,
	});
}

/** Create and strictly normalize one fixed-window-v1 evaluator input. */
export function createFixedWindowRateLimitTransitionInput(
	request: unknown,
	policy: unknown,
	state: unknown,
	observedAtMs: unknown,
): FixedWindowRateLimitTransitionInput {
	return assertFixedWindowRateLimitTransitionInput({
		format: FIXED_WINDOW_RATE_LIMIT_INPUT_FORMAT,
		version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
		algorithm: FIXED_WINDOW_RATE_LIMIT_ALGORITHM,
		request,
		policy,
		state,
		observedAtMs,
	});
}

/** Create and strictly normalize one sliding-window-v1 evaluator input. */
export function createSlidingWindowRateLimitTransitionInput(
	request: unknown,
	policy: unknown,
	state: unknown,
	observedAtMs: unknown,
): SlidingWindowRateLimitTransitionInput {
	return assertSlidingWindowRateLimitTransitionInput({
		format: SLIDING_WINDOW_RATE_LIMIT_INPUT_FORMAT,
		version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
		algorithm: SLIDING_WINDOW_RATE_LIMIT_ALGORITHM,
		request,
		policy,
		state,
		observedAtMs,
	});
}

/** Create and strictly normalize one token-bucket-v1 evaluator input. */
export function createTokenBucketRateLimitTransitionInput(
	request: unknown,
	policy: unknown,
	state: unknown,
	observedAtMs: unknown,
): TokenBucketRateLimitTransitionInput {
	return assertTokenBucketRateLimitTransitionInput({
		format: TOKEN_BUCKET_RATE_LIMIT_INPUT_FORMAT,
		version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
		algorithm: TOKEN_BUCKET_RATE_LIMIT_ALGORITHM,
		request,
		policy,
		state,
		observedAtMs,
	});
}

export function assertFixedWindowRateLimitPolicy(value: unknown): FixedWindowRateLimitPolicy {
	return sanitized("malformed-policy", () => {
		const object = strictObject(value, "fixed-window policy");
		exactFields(
			object,
			["algorithm", "capacityUnits", "format", "scope", "version", "windowMs"],
			"fixed-window policy",
		);
		exactLiteral(object.format, FIXED_WINDOW_RATE_LIMIT_POLICY_FORMAT);
		exactLiteral(object.version, KEYED_RATE_LIMIT_REFERENCE_VERSION);
		exactLiteral(object.algorithm, FIXED_WINDOW_RATE_LIMIT_ALGORITHM);
		const scope = referenceScope(object.scope);
		if (scope.policy.algorithm.kind !== "fixed-window") fail("revision-mismatch");
		return Object.freeze({
			format: FIXED_WINDOW_RATE_LIMIT_POLICY_FORMAT,
			version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
			algorithm: FIXED_WINDOW_RATE_LIMIT_ALGORITHM,
			scope,
			capacityUnits: positiveSafeInteger(object.capacityUnits, "capacityUnits"),
			windowMs: positiveSafeInteger(object.windowMs, "windowMs"),
		});
	});
}

export function assertSlidingWindowRateLimitPolicy(value: unknown): SlidingWindowRateLimitPolicy {
	return sanitized("malformed-policy", () => {
		const object = strictObject(value, "sliding-window policy");
		exactFields(
			object,
			["algorithm", "capacityUnits", "format", "maxEntries", "scope", "version", "windowMs"],
			"sliding-window policy",
		);
		exactLiteral(object.format, SLIDING_WINDOW_RATE_LIMIT_POLICY_FORMAT);
		exactLiteral(object.version, KEYED_RATE_LIMIT_REFERENCE_VERSION);
		exactLiteral(object.algorithm, SLIDING_WINDOW_RATE_LIMIT_ALGORITHM);
		const scope = referenceScope(object.scope);
		if (scope.policy.algorithm.kind !== "sliding-window") fail("revision-mismatch");
		const maxEntries = positiveSafeInteger(object.maxEntries, "maxEntries");
		if (maxEntries > SLIDING_WINDOW_RATE_LIMIT_MAX_ENTRIES_V1) fail("state-bound-overflow");
		return Object.freeze({
			format: SLIDING_WINDOW_RATE_LIMIT_POLICY_FORMAT,
			version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
			algorithm: SLIDING_WINDOW_RATE_LIMIT_ALGORITHM,
			scope,
			capacityUnits: positiveSafeInteger(object.capacityUnits, "capacityUnits"),
			windowMs: positiveSafeInteger(object.windowMs, "windowMs"),
			maxEntries,
		});
	});
}

export function assertTokenBucketRateLimitPolicy(value: unknown): TokenBucketRateLimitPolicy {
	return sanitized("malformed-policy", () => {
		const object = strictObject(value, "token-bucket policy");
		exactFields(
			object,
			[
				"algorithm",
				"capacityUnits",
				"format",
				"initialUnits",
				"refillPeriodMs",
				"refillUnits",
				"scope",
				"version",
			],
			"token-bucket policy",
		);
		exactLiteral(object.format, TOKEN_BUCKET_RATE_LIMIT_POLICY_FORMAT);
		exactLiteral(object.version, KEYED_RATE_LIMIT_REFERENCE_VERSION);
		exactLiteral(object.algorithm, TOKEN_BUCKET_RATE_LIMIT_ALGORITHM);
		const scope = referenceScope(object.scope);
		if (scope.policy.algorithm.kind !== "token-bucket") fail("revision-mismatch");
		const capacityUnits = positiveSafeInteger(object.capacityUnits, "capacityUnits");
		const initialUnits = nonNegativeSafeInteger(object.initialUnits, "initialUnits");
		if (initialUnits > capacityUnits) throw new TypeError("initialUnits is out of range");
		return Object.freeze({
			format: TOKEN_BUCKET_RATE_LIMIT_POLICY_FORMAT,
			version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
			algorithm: TOKEN_BUCKET_RATE_LIMIT_ALGORITHM,
			scope,
			capacityUnits,
			refillUnits: positiveSafeInteger(object.refillUnits, "refillUnits"),
			refillPeriodMs: positiveSafeInteger(object.refillPeriodMs, "refillPeriodMs"),
			initialUnits,
		});
	});
}

export function assertKeyedRateLimitReferencePolicy(value: unknown): KeyedRateLimitReferencePolicy {
	const object = sanitized("malformed-policy", () => strictObject(value, "reference policy"));
	if (object.format === FIXED_WINDOW_RATE_LIMIT_POLICY_FORMAT) {
		return assertFixedWindowRateLimitPolicy(object);
	}
	if (object.format === SLIDING_WINDOW_RATE_LIMIT_POLICY_FORMAT) {
		return assertSlidingWindowRateLimitPolicy(object);
	}
	if (object.format === TOKEN_BUCKET_RATE_LIMIT_POLICY_FORMAT) {
		return assertTokenBucketRateLimitPolicy(object);
	}
	fail("malformed-policy");
}

export function assertFixedWindowRateLimitState(value: unknown): FixedWindowRateLimitState {
	return sanitized("malformed-state", () => {
		const object = strictObject(value, "fixed-window state");
		exactFields(
			object,
			["algorithm", "format", "lastObservedAtMs", "scope", "usedUnits", "version", "windowStartMs"],
			"fixed-window state",
		);
		exactLiteral(object.format, FIXED_WINDOW_RATE_LIMIT_STATE_FORMAT);
		exactLiteral(object.version, KEYED_RATE_LIMIT_REFERENCE_VERSION);
		exactLiteral(object.algorithm, FIXED_WINDOW_RATE_LIMIT_ALGORITHM);
		return Object.freeze({
			format: FIXED_WINDOW_RATE_LIMIT_STATE_FORMAT,
			version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
			algorithm: FIXED_WINDOW_RATE_LIMIT_ALGORITHM,
			scope: referenceScope(object.scope),
			windowStartMs: nonNegativeSafeInteger(object.windowStartMs, "windowStartMs"),
			usedUnits: nonNegativeSafeInteger(object.usedUnits, "usedUnits"),
			lastObservedAtMs: nonNegativeSafeInteger(object.lastObservedAtMs, "lastObservedAtMs"),
		});
	});
}

export function assertSlidingWindowRateLimitState(value: unknown): SlidingWindowRateLimitState {
	return sanitized("malformed-state", () => {
		const object = strictObject(value, "sliding-window state");
		exactFields(
			object,
			["algorithm", "entries", "format", "lastObservedAtMs", "scope", "usedUnits", "version"],
			"sliding-window state",
		);
		exactLiteral(object.format, SLIDING_WINDOW_RATE_LIMIT_STATE_FORMAT);
		exactLiteral(object.version, KEYED_RATE_LIMIT_REFERENCE_VERSION);
		exactLiteral(object.algorithm, SLIDING_WINDOW_RATE_LIMIT_ALGORITHM);
		if (!Array.isArray(object.entries)) throw new TypeError("entries must be an array");
		if (object.entries.length > SLIDING_WINDOW_RATE_LIMIT_MAX_ENTRIES_V1) {
			fail("state-bound-overflow");
		}
		let previousAtMs = -1;
		let usedUnits = 0;
		const entries = object.entries.map((rawEntry) => {
			const entry = strictObject(rawEntry, "sliding-window entry");
			exactFields(entry, ["atMs", "units"], "sliding-window entry");
			const atMs = nonNegativeSafeInteger(entry.atMs, "entry atMs");
			const units = positiveSafeInteger(entry.units, "entry units");
			if (atMs <= previousAtMs) throw new TypeError("entries are not canonically ordered");
			previousAtMs = atMs;
			usedUnits = checkedAdd(usedUnits, units);
			return Object.freeze({ atMs, units });
		});
		const declaredUsedUnits = nonNegativeSafeInteger(object.usedUnits, "usedUnits");
		if (declaredUsedUnits !== usedUnits) throw new TypeError("usedUnits does not match entries");
		const lastObservedAtMs = nonNegativeSafeInteger(object.lastObservedAtMs, "lastObservedAtMs");
		if (entries.some((entry) => entry.atMs > lastObservedAtMs)) {
			throw new TypeError("entry occurs after lastObservedAtMs");
		}
		return Object.freeze({
			format: SLIDING_WINDOW_RATE_LIMIT_STATE_FORMAT,
			version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
			algorithm: SLIDING_WINDOW_RATE_LIMIT_ALGORITHM,
			scope: referenceScope(object.scope),
			entries: Object.freeze(entries),
			usedUnits,
			lastObservedAtMs,
		});
	});
}

export function assertTokenBucketRateLimitState(value: unknown): TokenBucketRateLimitState {
	return sanitized("malformed-state", () => {
		const object = strictObject(value, "token-bucket state");
		exactFields(
			object,
			[
				"algorithm",
				"availableUnits",
				"format",
				"lastObservedAtMs",
				"refillRemainder",
				"scope",
				"version",
			],
			"token-bucket state",
		);
		exactLiteral(object.format, TOKEN_BUCKET_RATE_LIMIT_STATE_FORMAT);
		exactLiteral(object.version, KEYED_RATE_LIMIT_REFERENCE_VERSION);
		exactLiteral(object.algorithm, TOKEN_BUCKET_RATE_LIMIT_ALGORITHM);
		return Object.freeze({
			format: TOKEN_BUCKET_RATE_LIMIT_STATE_FORMAT,
			version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
			algorithm: TOKEN_BUCKET_RATE_LIMIT_ALGORITHM,
			scope: referenceScope(object.scope),
			availableUnits: nonNegativeSafeInteger(object.availableUnits, "availableUnits"),
			refillRemainder: nonNegativeSafeInteger(object.refillRemainder, "refillRemainder"),
			lastObservedAtMs: nonNegativeSafeInteger(object.lastObservedAtMs, "lastObservedAtMs"),
		});
	});
}

export function assertKeyedRateLimitReferenceState(value: unknown): KeyedRateLimitReferenceState {
	const object = sanitized("malformed-state", () => strictObject(value, "reference state"));
	if (object.format === FIXED_WINDOW_RATE_LIMIT_STATE_FORMAT) {
		return assertFixedWindowRateLimitState(object);
	}
	if (object.format === SLIDING_WINDOW_RATE_LIMIT_STATE_FORMAT) {
		return assertSlidingWindowRateLimitState(object);
	}
	if (object.format === TOKEN_BUCKET_RATE_LIMIT_STATE_FORMAT) {
		return assertTokenBucketRateLimitState(object);
	}
	fail("malformed-state");
}

export function assertFixedWindowRateLimitTransitionInput(
	value: unknown,
): FixedWindowRateLimitTransitionInput {
	return sanitized("malformed-input", () => {
		const object = transitionInputObject(value, FIXED_WINDOW_RATE_LIMIT_INPUT_FORMAT);
		exactLiteral(object.algorithm, FIXED_WINDOW_RATE_LIMIT_ALGORITHM);
		return Object.freeze({
			format: FIXED_WINDOW_RATE_LIMIT_INPUT_FORMAT,
			version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
			algorithm: FIXED_WINDOW_RATE_LIMIT_ALGORITHM,
			request: sanitizedRequest(object.request),
			policy: assertFixedWindowRateLimitPolicy(object.policy),
			state: object.state === null ? null : assertFixedWindowRateLimitState(object.state),
			observedAtMs: nonNegativeSafeInteger(object.observedAtMs, "observedAtMs"),
		});
	});
}

export function assertSlidingWindowRateLimitTransitionInput(
	value: unknown,
): SlidingWindowRateLimitTransitionInput {
	return sanitized("malformed-input", () => {
		const object = transitionInputObject(value, SLIDING_WINDOW_RATE_LIMIT_INPUT_FORMAT);
		exactLiteral(object.algorithm, SLIDING_WINDOW_RATE_LIMIT_ALGORITHM);
		return Object.freeze({
			format: SLIDING_WINDOW_RATE_LIMIT_INPUT_FORMAT,
			version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
			algorithm: SLIDING_WINDOW_RATE_LIMIT_ALGORITHM,
			request: sanitizedRequest(object.request),
			policy: assertSlidingWindowRateLimitPolicy(object.policy),
			state: object.state === null ? null : assertSlidingWindowRateLimitState(object.state),
			observedAtMs: nonNegativeSafeInteger(object.observedAtMs, "observedAtMs"),
		});
	});
}

export function assertTokenBucketRateLimitTransitionInput(
	value: unknown,
): TokenBucketRateLimitTransitionInput {
	return sanitized("malformed-input", () => {
		const object = transitionInputObject(value, TOKEN_BUCKET_RATE_LIMIT_INPUT_FORMAT);
		exactLiteral(object.algorithm, TOKEN_BUCKET_RATE_LIMIT_ALGORITHM);
		return Object.freeze({
			format: TOKEN_BUCKET_RATE_LIMIT_INPUT_FORMAT,
			version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
			algorithm: TOKEN_BUCKET_RATE_LIMIT_ALGORITHM,
			request: sanitizedRequest(object.request),
			policy: assertTokenBucketRateLimitPolicy(object.policy),
			state: object.state === null ? null : assertTokenBucketRateLimitState(object.state),
			observedAtMs: nonNegativeSafeInteger(object.observedAtMs, "observedAtMs"),
		});
	});
}

export function assertKeyedRateLimitReferenceTransitionInput(
	value: unknown,
): KeyedRateLimitReferenceTransitionInput {
	const object = sanitized("malformed-input", () => strictObject(value, "reference input"));
	if (object.format === FIXED_WINDOW_RATE_LIMIT_INPUT_FORMAT) {
		return assertFixedWindowRateLimitTransitionInput(object);
	}
	if (object.format === SLIDING_WINDOW_RATE_LIMIT_INPUT_FORMAT) {
		return assertSlidingWindowRateLimitTransitionInput(object);
	}
	if (object.format === TOKEN_BUCKET_RATE_LIMIT_INPUT_FORMAT) {
		return assertTokenBucketRateLimitTransitionInput(object);
	}
	fail("malformed-input");
}

/**
 * Evaluate one D650 fixed-window-v1 transition.
 *
 * This synchronous pure calculator owns no clock, store, transaction, receipt, outcome id, effect,
 * Graph node, I/O, timer, polling, retry, or scheduler. A `null` state means the host has already
 * confirmed first initialization inside its atomic authority boundary.
 *
 * Durable hosts must order work as: strict request and identity; receipt lookup; identical material
 * returns the stored outcome without reading time or evaluating; different material conflicts;
 * resolve the exact policy; load exact scoped state; acquire authoritative `observedAtMs`; evaluate;
 * atomically persist `nextState` and the outcome receipt.
 */
export function evaluateFixedWindowRateLimitTransition(
	value: unknown,
): FixedWindowRateLimitTransition {
	const input = assertFixedWindowRateLimitTransitionInput(value);
	assertRequestScope(input.request, input.policy.scope);
	const { policy, observedAtMs } = input;
	let usedUnits = 0;
	const windowStartMs = currentWindowStart(observedAtMs, policy.windowMs);
	const windowEndMs = checkedAdd(windowStartMs, policy.windowMs);

	if (input.state !== null) {
		assertStateScope(input.state.scope, policy.scope);
		assertFixedStateCurrentness(input.state, policy);
		if (observedAtMs < input.state.lastObservedAtMs) fail("time-regression");
		if (windowStartMs === input.state.windowStartMs) {
			usedUnits = input.state.usedUnits;
		} else if (windowStartMs < input.state.windowStartMs) {
			fail("time-regression");
		}
	}

	const permanent = input.request.units > policy.capacityUnits;
	const allowed = !permanent && input.request.units <= policy.capacityUnits - usedUnits;
	if (allowed) usedUnits = checkedAdd(usedUnits, input.request.units);
	const remainingUnits = policy.capacityUnits - usedUnits;
	const nextState = assertFixedWindowRateLimitState({
		format: FIXED_WINDOW_RATE_LIMIT_STATE_FORMAT,
		version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
		algorithm: FIXED_WINDOW_RATE_LIMIT_ALGORITHM,
		scope: policy.scope,
		windowStartMs,
		usedUnits,
		lastObservedAtMs: observedAtMs,
	});
	const transition = Object.freeze({
		format: KEYED_RATE_LIMIT_TRANSITION_FORMAT,
		version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
		algorithm: FIXED_WINDOW_RATE_LIMIT_ALGORITHM,
		status: "ready" as const,
		result: allowed ? ("allowed" as const) : ("denied" as const),
		nextState,
		remainingUnits,
		resetAtMs: usedUnits === 0 ? null : windowEndMs,
		retryAfterMs: allowed || permanent ? null : windowEndMs - observedAtMs,
	});
	return assertFixedWindowRateLimitTransition(transition);
}

/**
 * Evaluate one exact D650 sliding-window-v1 successful-consumption ledger transition.
 *
 * See {@link evaluateFixedWindowRateLimitTransition} for the mandatory receipt-first durable host
 * ordering. This calculator is synchronous, pure, host-side, and never approximates or evicts an
 * active ledger entry to admit work.
 */
export function evaluateSlidingWindowRateLimitTransition(
	value: unknown,
): SlidingWindowRateLimitTransition {
	const input = assertSlidingWindowRateLimitTransitionInput(value);
	assertRequestScope(input.request, input.policy.scope);
	const { policy, observedAtMs } = input;
	let entries: SlidingWindowRateLimitEntry[] = [];
	let usedUnits = 0;

	if (input.state !== null) {
		assertStateScope(input.state.scope, policy.scope);
		assertSlidingStateCurrentness(input.state, policy);
		if (observedAtMs < input.state.lastObservedAtMs) fail("time-regression");
		const cutoff = observedAtMs - policy.windowMs;
		let firstActive = 0;
		while (
			firstActive < input.state.entries.length &&
			input.state.entries[firstActive].atMs <= cutoff
		) {
			firstActive += 1;
		}
		entries = input.state.entries.slice(firstActive);
		for (const entry of entries) usedUnits = checkedAdd(usedUnits, entry.units);
	}

	const permanent = input.request.units > policy.capacityUnits;
	const allowed = !permanent && input.request.units <= policy.capacityUnits - usedUnits;
	if (allowed) {
		const last = entries.at(-1);
		if (last?.atMs === observedAtMs) {
			const coalesced = Object.freeze({
				atMs: observedAtMs,
				units: checkedAdd(last.units, input.request.units),
			});
			entries = [...entries.slice(0, -1), coalesced];
		} else {
			if (entries.length >= policy.maxEntries) fail("state-bound-overflow");
			entries = [...entries, Object.freeze({ atMs: observedAtMs, units: input.request.units })];
		}
		usedUnits = checkedAdd(usedUnits, input.request.units);
	}
	if (entries.length > policy.maxEntries) fail("state-bound-overflow");

	const remainingUnits = policy.capacityUnits - usedUnits;
	const resetAtMs =
		entries.length === 0 ? null : checkedAdd(entries[entries.length - 1].atMs, policy.windowMs);
	let retryAfterMs: number | null = null;
	if (!allowed && !permanent) {
		const needed = input.request.units - remainingUnits;
		let released = 0;
		let eligibleAtMs: number | null = null;
		for (const entry of entries) {
			released = checkedAdd(released, entry.units);
			if (released >= needed) {
				eligibleAtMs = checkedAdd(entry.atMs, policy.windowMs);
				break;
			}
		}
		if (eligibleAtMs === null) fail("malformed-state");
		retryAfterMs = eligibleAtMs - observedAtMs;
	}

	const nextState = assertSlidingWindowRateLimitState({
		format: SLIDING_WINDOW_RATE_LIMIT_STATE_FORMAT,
		version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
		algorithm: SLIDING_WINDOW_RATE_LIMIT_ALGORITHM,
		scope: policy.scope,
		entries,
		usedUnits,
		lastObservedAtMs: observedAtMs,
	});
	const transition = Object.freeze({
		format: KEYED_RATE_LIMIT_TRANSITION_FORMAT,
		version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
		algorithm: SLIDING_WINDOW_RATE_LIMIT_ALGORITHM,
		status: "ready" as const,
		result: allowed ? ("allowed" as const) : ("denied" as const),
		nextState,
		remainingUnits,
		resetAtMs,
		retryAfterMs,
	});
	return assertSlidingWindowRateLimitTransition(transition);
}

/**
 * Evaluate one D650 token-bucket-v1 transition with integer rational refill.
 *
 * See {@link evaluateFixedWindowRateLimitTransition} for the mandatory receipt-first durable host
 * ordering. No IEEE floating-point token accumulation is used; saturation discards excess credit
 * and remainder, and a valid denial still advances the returned refill state.
 */
export function evaluateTokenBucketRateLimitTransition(
	value: unknown,
): TokenBucketRateLimitTransition {
	const input = assertTokenBucketRateLimitTransitionInput(value);
	assertRequestScope(input.request, input.policy.scope);
	const { policy, observedAtMs } = input;
	let availableUnits = policy.initialUnits;
	let refillRemainder = 0;
	let lastObservedAtMs = observedAtMs;

	if (input.state !== null) {
		assertStateScope(input.state.scope, policy.scope);
		assertTokenStateCurrentness(input.state, policy);
		if (observedAtMs < input.state.lastObservedAtMs) fail("time-regression");
		availableUnits = input.state.availableUnits;
		refillRemainder = input.state.refillRemainder;
		lastObservedAtMs = input.state.lastObservedAtMs;
	}

	const elapsed = observedAtMs - lastObservedAtMs;
	if (elapsed > 0) {
		const numerator = BigInt(elapsed) * BigInt(policy.refillUnits) + BigInt(refillRemainder);
		const period = BigInt(policy.refillPeriodMs);
		const refill = numerator / period;
		const remainder = numerator % period;
		const deficit = policy.capacityUnits - availableUnits;
		if (refill >= BigInt(deficit)) {
			availableUnits = policy.capacityUnits;
			refillRemainder = 0;
		} else {
			availableUnits = checkedAdd(availableUnits, checkedBigIntNumber(refill));
			refillRemainder = checkedBigIntNumber(remainder);
		}
	}

	const permanent = input.request.units > policy.capacityUnits;
	const allowed = !permanent && input.request.units <= availableUnits;
	if (allowed) availableUnits -= input.request.units;
	const remainingUnits = availableUnits;
	const retryAfterMs =
		!allowed && !permanent
			? tokenDelayMs(
					input.request.units - availableUnits,
					refillRemainder,
					policy.refillUnits,
					policy.refillPeriodMs,
				)
			: null;
	const resetDelayMs =
		availableUnits === policy.capacityUnits
			? null
			: tokenDelayMs(
					policy.capacityUnits - availableUnits,
					refillRemainder,
					policy.refillUnits,
					policy.refillPeriodMs,
				);
	const resetAtMs = resetDelayMs === null ? null : checkedAdd(observedAtMs, resetDelayMs);

	const nextState = assertTokenBucketRateLimitState({
		format: TOKEN_BUCKET_RATE_LIMIT_STATE_FORMAT,
		version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
		algorithm: TOKEN_BUCKET_RATE_LIMIT_ALGORITHM,
		scope: policy.scope,
		availableUnits,
		refillRemainder,
		lastObservedAtMs: observedAtMs,
	});
	const transition = Object.freeze({
		format: KEYED_RATE_LIMIT_TRANSITION_FORMAT,
		version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
		algorithm: TOKEN_BUCKET_RATE_LIMIT_ALGORITHM,
		status: "ready" as const,
		result: allowed ? ("allowed" as const) : ("denied" as const),
		nextState,
		remainingUnits,
		resetAtMs,
		retryAfterMs,
	});
	return assertTokenBucketRateLimitTransition(transition);
}

export function assertFixedWindowRateLimitTransition(
	value: unknown,
): FixedWindowRateLimitTransition {
	return sanitized("malformed-transition", () => {
		const object = transitionObject(value, FIXED_WINDOW_RATE_LIMIT_ALGORITHM);
		const nextState = assertFixedWindowRateLimitState(object.nextState);
		return normalizedTransition(object, FIXED_WINDOW_RATE_LIMIT_ALGORITHM, nextState);
	});
}

export function assertSlidingWindowRateLimitTransition(
	value: unknown,
): SlidingWindowRateLimitTransition {
	return sanitized("malformed-transition", () => {
		const object = transitionObject(value, SLIDING_WINDOW_RATE_LIMIT_ALGORITHM);
		const nextState = assertSlidingWindowRateLimitState(object.nextState);
		return normalizedTransition(object, SLIDING_WINDOW_RATE_LIMIT_ALGORITHM, nextState);
	});
}

export function assertTokenBucketRateLimitTransition(
	value: unknown,
): TokenBucketRateLimitTransition {
	return sanitized("malformed-transition", () => {
		const object = transitionObject(value, TOKEN_BUCKET_RATE_LIMIT_ALGORITHM);
		const nextState = assertTokenBucketRateLimitState(object.nextState);
		return normalizedTransition(object, TOKEN_BUCKET_RATE_LIMIT_ALGORITHM, nextState);
	});
}

export function assertKeyedRateLimitTransition(value: unknown): KeyedRateLimitTransition {
	const object = sanitized("malformed-transition", () => strictObject(value, "transition"));
	if (object.algorithm === FIXED_WINDOW_RATE_LIMIT_ALGORITHM) {
		return assertFixedWindowRateLimitTransition(object);
	}
	if (object.algorithm === SLIDING_WINDOW_RATE_LIMIT_ALGORITHM) {
		return assertSlidingWindowRateLimitTransition(object);
	}
	if (object.algorithm === TOKEN_BUCKET_RATE_LIMIT_ALGORITHM) {
		return assertTokenBucketRateLimitTransition(object);
	}
	fail("malformed-transition");
}

function sanitizedRequest(value: unknown): KeyedRateLimitRequest {
	return sanitized("malformed-request", () => assertKeyedRateLimitRequest(value));
}

function sanitized<T>(code: KeyedRateLimitTransitionErrorCode, fn: () => T): T {
	try {
		return fn();
	} catch (error) {
		if (error instanceof KeyedRateLimitTransitionError) throw error;
		fail(code);
	}
}

function fail(code: KeyedRateLimitTransitionErrorCode): never {
	throw new KeyedRateLimitTransitionError(code);
}

function strictObject(value: unknown, label: string): Record<string, unknown> {
	return assertStrictJsonObject(value, label);
}

function policyOptions(value: unknown, fields: readonly string[]): Record<string, unknown> {
	return sanitized("malformed-policy", () => {
		const object = strictObject(value, "policy creation options");
		exactFields(object, fields, "policy creation options");
		return object;
	});
}

function exactFields(
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

function exactLiteral<T extends string | number>(value: unknown, expected: T): asserts value is T {
	if (value !== expected) throw new TypeError("value has an invalid literal");
}

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > MAX_TEXT_CHARS) {
		throw new TypeError(`${label} must be a bounded non-empty string`);
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

function checkedAdd(a: number, b: number): number {
	const result = a + b;
	if (!Number.isSafeInteger(result) || result < 0) fail("arithmetic-overflow");
	return result;
}

function checkedBigIntNumber(value: bigint): number {
	if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) fail("arithmetic-overflow");
	return Number(value);
}

function coordinate(value: unknown, label: string): KeyedRateLimitCoordinate {
	const object = strictObject(value, label);
	exactFields(object, ["id", "kind", "revision"], label);
	return Object.freeze({
		kind: nonEmptyString(object.kind, `${label} kind`),
		id: nonEmptyString(object.id, `${label} id`),
		revision: nonEmptyString(object.revision, `${label} revision`),
	});
}

function policyCoordinate(value: unknown): KeyedRateLimitPolicyCoordinate {
	const object = strictObject(value, "policy coordinate");
	exactFields(object, ["algorithm", "id", "revision"], "policy coordinate");
	const algorithm = strictObject(object.algorithm, "algorithm coordinate");
	exactFields(algorithm, ["kind", "revision"], "algorithm coordinate");
	return Object.freeze({
		id: nonEmptyString(object.id, "policy id"),
		revision: nonEmptyString(object.revision, "policy revision"),
		algorithm: Object.freeze({
			kind: nonEmptyString(algorithm.kind, "algorithm kind"),
			revision: nonEmptyString(algorithm.revision, "algorithm revision"),
		}),
	});
}

function referenceScope(value: unknown): KeyedRateLimitReferenceScope {
	const object = strictObject(value, "reference scope");
	exactFields(object, ["authority", "key", "policy", "stateRevision"], "reference scope");
	return Object.freeze({
		key: coordinate(object.key, "scope key"),
		policy: policyCoordinate(object.policy),
		authority: coordinate(object.authority, "scope authority"),
		stateRevision: nonEmptyString(object.stateRevision, "stateRevision"),
	});
}

function scopeFromRequest(
	request: KeyedRateLimitRequest,
	stateRevisionValue: unknown,
): KeyedRateLimitReferenceScope {
	return Object.freeze({
		key: request.key,
		policy: request.policy,
		authority: request.authority,
		stateRevision: nonEmptyString(stateRevisionValue, "stateRevision"),
	});
}

function sameCoordinate(a: KeyedRateLimitCoordinate, b: KeyedRateLimitCoordinate): boolean {
	return a.kind === b.kind && a.id === b.id && a.revision === b.revision;
}

function samePolicy(a: KeyedRateLimitPolicyCoordinate, b: KeyedRateLimitPolicyCoordinate): boolean {
	return (
		a.id === b.id &&
		a.revision === b.revision &&
		a.algorithm.kind === b.algorithm.kind &&
		a.algorithm.revision === b.algorithm.revision
	);
}

function assertRequestScope(
	request: KeyedRateLimitRequest,
	scope: KeyedRateLimitReferenceScope,
): void {
	if (
		!sameCoordinate(request.key, scope.key) ||
		!sameCoordinate(request.authority, scope.authority)
	) {
		fail("scope-mismatch");
	}
	if (!samePolicy(request.policy, scope.policy)) fail("revision-mismatch");
}

function assertStateScope(
	state: KeyedRateLimitReferenceScope,
	policy: KeyedRateLimitReferenceScope,
): void {
	if (
		!sameCoordinate(state.key, policy.key) ||
		!sameCoordinate(state.authority, policy.authority)
	) {
		fail("scope-mismatch");
	}
	if (!samePolicy(state.policy, policy.policy) || state.stateRevision !== policy.stateRevision) {
		fail("revision-mismatch");
	}
}

function transitionInputObject(
	value: unknown,
	format:
		| typeof FIXED_WINDOW_RATE_LIMIT_INPUT_FORMAT
		| typeof SLIDING_WINDOW_RATE_LIMIT_INPUT_FORMAT
		| typeof TOKEN_BUCKET_RATE_LIMIT_INPUT_FORMAT,
): Record<string, unknown> {
	const object = strictObject(value, "transition input");
	exactFields(
		object,
		["algorithm", "format", "observedAtMs", "policy", "request", "state", "version"],
		"transition input",
	);
	exactLiteral(object.format, format);
	exactLiteral(object.version, KEYED_RATE_LIMIT_REFERENCE_VERSION);
	return object;
}

function currentWindowStart(observedAtMs: number, windowMs: number): number {
	return Math.floor(observedAtMs / windowMs) * windowMs;
}

function assertFixedStateCurrentness(
	state: FixedWindowRateLimitState,
	policy: FixedWindowRateLimitPolicy,
): void {
	if (state.usedUnits > policy.capacityUnits) fail("state-bound-overflow");
	if (state.windowStartMs % policy.windowMs !== 0) fail("malformed-state");
	const end = checkedAdd(state.windowStartMs, policy.windowMs);
	if (state.lastObservedAtMs < state.windowStartMs || state.lastObservedAtMs >= end) {
		fail("malformed-state");
	}
}

function assertSlidingStateCurrentness(
	state: SlidingWindowRateLimitState,
	policy: SlidingWindowRateLimitPolicy,
): void {
	if (state.entries.length > policy.maxEntries || state.usedUnits > policy.capacityUnits) {
		fail("state-bound-overflow");
	}
	const cutoff = state.lastObservedAtMs - policy.windowMs;
	if (state.entries.some((entry) => entry.atMs <= cutoff)) fail("malformed-state");
	for (const entry of state.entries) checkedAdd(entry.atMs, policy.windowMs);
}

function assertTokenStateCurrentness(
	state: TokenBucketRateLimitState,
	policy: TokenBucketRateLimitPolicy,
): void {
	if (
		state.availableUnits > policy.capacityUnits ||
		state.refillRemainder >= policy.refillPeriodMs
	) {
		fail("state-bound-overflow");
	}
	if (state.availableUnits === policy.capacityUnits && state.refillRemainder !== 0) {
		fail("malformed-state");
	}
}

function tokenDelayMs(
	neededUnits: number,
	remainder: number,
	refillUnits: number,
	refillPeriodMs: number,
): number {
	const numerator = BigInt(neededUnits) * BigInt(refillPeriodMs) - BigInt(remainder);
	if (numerator <= 0n) return 0;
	const divisor = BigInt(refillUnits);
	return checkedBigIntNumber((numerator - 1n) / divisor + 1n);
}

function transitionObject(
	value: unknown,
	algorithm:
		| typeof FIXED_WINDOW_RATE_LIMIT_ALGORITHM
		| typeof SLIDING_WINDOW_RATE_LIMIT_ALGORITHM
		| typeof TOKEN_BUCKET_RATE_LIMIT_ALGORITHM,
): Record<string, unknown> {
	const object = strictObject(value, "transition");
	exactFields(
		object,
		[
			"algorithm",
			"format",
			"nextState",
			"remainingUnits",
			"resetAtMs",
			"result",
			"retryAfterMs",
			"status",
			"version",
		],
		"transition",
	);
	exactLiteral(object.format, KEYED_RATE_LIMIT_TRANSITION_FORMAT);
	exactLiteral(object.version, KEYED_RATE_LIMIT_REFERENCE_VERSION);
	exactLiteral(object.algorithm, algorithm);
	exactLiteral(object.status, "ready");
	if (object.result !== "allowed" && object.result !== "denied") {
		throw new TypeError("transition result is invalid");
	}
	return object;
}

function normalizedTransition<
	State extends KeyedRateLimitReferenceState,
	Algorithm extends
		| typeof FIXED_WINDOW_RATE_LIMIT_ALGORITHM
		| typeof SLIDING_WINDOW_RATE_LIMIT_ALGORITHM
		| typeof TOKEN_BUCKET_RATE_LIMIT_ALGORITHM,
>(
	object: Record<string, unknown>,
	algorithm: Algorithm,
	nextState: State,
): KeyedRateLimitReferenceTransition<State, Algorithm> {
	const result = object.result as KeyedRateLimitTransitionResult;
	const retryAfterMs = nullableNonNegativeSafeInteger(object.retryAfterMs, "retryAfterMs");
	if (result === "allowed" && retryAfterMs !== null) {
		throw new TypeError("allowed transition retryAfterMs must be null");
	}
	if (result === "denied" && retryAfterMs === 0) {
		throw new TypeError("denied transition retryAfterMs must be positive or null");
	}
	return Object.freeze({
		format: KEYED_RATE_LIMIT_TRANSITION_FORMAT,
		version: KEYED_RATE_LIMIT_REFERENCE_VERSION,
		algorithm,
		status: "ready",
		result,
		nextState,
		remainingUnits: nonNegativeSafeInteger(object.remainingUnits, "remainingUnits"),
		resetAtMs: nullableNonNegativeSafeInteger(object.resetAtMs, "resetAtMs"),
		retryAfterMs,
	});
}

function nullableNonNegativeSafeInteger(value: unknown, label: string): number | null {
	return value === null ? null : nonNegativeSafeInteger(value, label);
}
