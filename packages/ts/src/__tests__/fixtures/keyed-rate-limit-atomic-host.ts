import type { KeyedRateLimitAuthority } from "../../adapters/index.js";
import { strictJsonCodec } from "../../json/codec.js";
import {
	assertFixedWindowRateLimitPolicy,
	assertFixedWindowRateLimitState,
	assertKeyedRateLimitOutcome,
	assertKeyedRateLimitReferencePolicy,
	assertKeyedRateLimitReferenceState,
	assertKeyedRateLimitRequest,
	assertSlidingWindowRateLimitPolicy,
	assertSlidingWindowRateLimitState,
	assertTokenBucketRateLimitPolicy,
	assertTokenBucketRateLimitState,
	createFixedWindowRateLimitTransitionInput,
	createKeyedRateLimitOutcome,
	createSlidingWindowRateLimitTransitionInput,
	createTokenBucketRateLimitTransitionInput,
	evaluateFixedWindowRateLimitTransition,
	evaluateSlidingWindowRateLimitTransition,
	evaluateTokenBucketRateLimitTransition,
	type KeyedRateLimitCoordinate,
	type KeyedRateLimitOutcome,
	type KeyedRateLimitReferencePolicy,
	type KeyedRateLimitReferenceScope,
	type KeyedRateLimitReferenceState,
	type KeyedRateLimitRequest,
	keyedRateLimitRequestIdentity,
} from "../../rate-limit/index.js";

export const TEST_ATOMIC_HOST_FORMAT = "graphrefly.test.keyedRateLimitAtomicHost" as const;
const TEST_ATOMIC_HOST_VERSION = 1 as const;

export interface TestAtomicHostCounters {
	readonly receiptLookups: number;
	readonly policyResolutions: number;
	readonly stateLoads: number;
	readonly clockReads: number;
	readonly evaluations: number;
	readonly commits: number;
}

export interface TestAtomicHostImage {
	readonly format: typeof TEST_ATOMIC_HOST_FORMAT;
	readonly version: typeof TEST_ATOMIC_HOST_VERSION;
	readonly receipts: readonly TestAtomicHostReceipt[];
	readonly states: readonly KeyedRateLimitReferenceState[];
}

interface TestAtomicHostReceipt {
	readonly outcome: KeyedRateLimitOutcome;
	readonly stateRevision: string;
}

interface PendingConsume {
	readonly request: KeyedRateLimitRequest;
	readonly complete: (outcome: KeyedRateLimitOutcome) => void;
	cancelled: boolean;
}

/**
 * Test-only D650/D651 atomic host model.
 *
 * One `drainNext()` is one indivisible authoritative transaction: strict identity → receipt lookup
 * → exact replay/conflict → policy → exact state → clock → evaluator → one immutable state+receipt
 * image replacement. It models that contract across Graph restart and deterministic multi-instance
 * serial orders; it is not a public persistence API or evidence of database fsync/crash isolation.
 */
export class TestAtomicRateLimitAuthority implements KeyedRateLimitAuthority {
	readonly pending: PendingConsume[] = [];
	private readonly policies: readonly KeyedRateLimitReferencePolicy[];
	private readonly observedTimes: readonly number[];
	private observedTimeIndex = 0;
	private image: TestAtomicHostImage;
	private mutableCounters = {
		receiptLookups: 0,
		policyResolutions: 0,
		stateLoads: 0,
		clockReads: 0,
		evaluations: 0,
		commits: 0,
	};

	constructor(
		policies: readonly KeyedRateLimitReferencePolicy[],
		observedTimes: readonly number[],
		image: unknown = emptyImage(),
	) {
		this.policies = Object.freeze(
			policies.map(assertKeyedRateLimitReferencePolicy).sort(compareResolvablePolicy),
		);
		assertCanonicalPolicies(this.policies);
		this.observedTimes = Object.freeze(
			observedTimes.map((value) => {
				if (!Number.isSafeInteger(value) || value < 0) {
					throw new TypeError("test atomic host time must be a non-negative safe integer");
				}
				return value;
			}),
		);
		this.image = assertTestAtomicHostImage(image);
	}

	consume(
		requestValue: KeyedRateLimitRequest,
		complete: (outcome: KeyedRateLimitOutcome) => void,
	): () => void {
		const pending: PendingConsume = {
			request: assertKeyedRateLimitRequest(requestValue),
			complete,
			cancelled: false,
		};
		this.pending.push(pending);
		return () => {
			if (pending.cancelled) return;
			pending.cancelled = true;
			const index = this.pending.indexOf(pending);
			if (index >= 0) this.pending.splice(index, 1);
		};
	}

	drainNext(index = 0): KeyedRateLimitOutcome | null {
		if (!Number.isSafeInteger(index) || index < 0 || index >= this.pending.length) {
			throw new RangeError("test atomic host pending index is out of range");
		}
		const [pending] = this.pending.splice(index, 1);
		if (pending.cancelled) return null;
		const outcome = this.atomicConsume(pending.request);
		pending.complete(outcome);
		return outcome;
	}

	snapshot(): TestAtomicHostImage {
		return assertTestAtomicHostImage(strictRoundtrip(this.image));
	}

	counters(): TestAtomicHostCounters {
		return Object.freeze({ ...this.mutableCounters });
	}

	private atomicConsume(request: KeyedRateLimitRequest): KeyedRateLimitOutcome {
		this.mutableCounters.receiptLookups += 1;
		const identity = keyedRateLimitRequestIdentity(request);
		const receipt = this.image.receipts.find(
			(candidate) =>
				candidate.outcome.requestId === request.requestId &&
				sameCoordinate(candidate.outcome.authority, request.authority),
		);
		if (receipt !== undefined) {
			if (receipt.outcome.requestIdentity.key === identity.key) return receipt.outcome;
			return createKeyedRateLimitOutcome(request, {
				outcomeId: request.requestId,
				result: "conflict",
				provenance: [request.authority],
			});
		}

		this.mutableCounters.policyResolutions += 1;
		const policy = this.policies.find((candidate) => requestMatchesScope(request, candidate.scope));
		if (policy === undefined) throw new Error("test atomic host could not resolve an exact policy");

		this.mutableCounters.stateLoads += 1;
		const state =
			this.image.states.find((candidate) => sameScope(candidate.scope, policy.scope)) ?? null;
		if (
			state === null &&
			this.image.states.some((candidate) => sameScopeLineage(candidate.scope, policy.scope))
		) {
			throw new Error("test atomic host refuses implicit state reset or migration");
		}
		const observedAtMs = this.readClock();
		this.mutableCounters.evaluations += 1;
		const transition = evaluate(request, policy, state, observedAtMs);
		const outcome = createKeyedRateLimitOutcome(request, {
			outcomeId: request.requestId,
			result: transition.result,
			remainingUnits: transition.remainingUnits,
			resetAtMs: transition.resetAtMs,
			retryAfterMs: transition.retryAfterMs,
			provenance: [
				request.authority,
				{ kind: "test-transaction", id: "atomic-consume", revision: "fixture-v1" },
			],
		});

		const states = this.image.states.filter(
			(candidate) => !sameScope(candidate.scope, transition.nextState.scope),
		);
		this.image = assertTestAtomicHostImage({
			format: TEST_ATOMIC_HOST_FORMAT,
			version: TEST_ATOMIC_HOST_VERSION,
			receipts: [
				...this.image.receipts,
				{ outcome, stateRevision: policy.scope.stateRevision },
			].sort(compareReceipt),
			states: [...states, transition.nextState].sort(compareState),
		});
		this.mutableCounters.commits += 1;
		return outcome;
	}

	private readClock(): number {
		const value = this.observedTimes[this.observedTimeIndex];
		if (value === undefined) throw new Error("test atomic host clock is exhausted");
		this.observedTimeIndex += 1;
		this.mutableCounters.clockReads += 1;
		return value;
	}
}

function evaluate(
	request: KeyedRateLimitRequest,
	policy: KeyedRateLimitReferencePolicy,
	state: KeyedRateLimitReferenceState | null,
	observedAtMs: number,
) {
	if (policy.algorithm === "fixed-window-v1") {
		const fixedState = state === null ? null : assertFixedWindowRateLimitState(state);
		return evaluateFixedWindowRateLimitTransition(
			createFixedWindowRateLimitTransitionInput(
				request,
				assertFixedWindowRateLimitPolicy(policy),
				fixedState,
				observedAtMs,
			),
		);
	}
	if (policy.algorithm === "sliding-window-v1") {
		const slidingState = state === null ? null : assertSlidingWindowRateLimitState(state);
		return evaluateSlidingWindowRateLimitTransition(
			createSlidingWindowRateLimitTransitionInput(
				request,
				assertSlidingWindowRateLimitPolicy(policy),
				slidingState,
				observedAtMs,
			),
		);
	}
	const tokenState = state === null ? null : assertTokenBucketRateLimitState(state);
	return evaluateTokenBucketRateLimitTransition(
		createTokenBucketRateLimitTransitionInput(
			request,
			assertTokenBucketRateLimitPolicy(policy),
			tokenState,
			observedAtMs,
		),
	);
}

function emptyImage(): TestAtomicHostImage {
	return Object.freeze({
		format: TEST_ATOMIC_HOST_FORMAT,
		version: TEST_ATOMIC_HOST_VERSION,
		receipts: Object.freeze([]),
		states: Object.freeze([]),
	});
}

function assertTestAtomicHostImage(value: unknown): TestAtomicHostImage {
	const object = strictRoundtrip(value);
	if (object === null || typeof object !== "object" || Array.isArray(object)) {
		throw new TypeError("test atomic host image must be an object");
	}
	const record = object as Record<string, unknown>;
	assertExactFields(record, ["format", "receipts", "states", "version"]);
	if (
		record.format !== TEST_ATOMIC_HOST_FORMAT ||
		record.version !== TEST_ATOMIC_HOST_VERSION ||
		!Array.isArray(record.receipts) ||
		!Array.isArray(record.states)
	) {
		throw new TypeError("test atomic host image is malformed");
	}
	const states = record.states.map(assertKeyedRateLimitReferenceState);
	const receipts = record.receipts.map(assertTestAtomicHostReceipt);
	assertCanonicalOrder(receipts, compareReceipt, "receipt");
	assertCanonicalOrder(states, compareState, "state");
	for (const receipt of receipts) assertReceiptStateCoherence(receipt, states);
	return Object.freeze({
		format: TEST_ATOMIC_HOST_FORMAT,
		version: TEST_ATOMIC_HOST_VERSION,
		receipts: Object.freeze(receipts),
		states: Object.freeze(states),
	});
}

function assertCanonicalPolicies(policies: readonly KeyedRateLimitReferencePolicy[]): void {
	assertCanonicalOrder(policies, compareResolvablePolicy, "request-resolvable policy");
}

function assertExactFields(record: Record<string, unknown>, expected: readonly string[]): void {
	const actual = Object.keys(record).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new TypeError("test atomic host image has unknown or missing fields");
	}
}

function assertCanonicalOrder<T>(
	values: readonly T[],
	compare: (left: T, right: T) => number,
	label: string,
): void {
	for (let index = 1; index < values.length; index += 1) {
		const order = compare(values[index - 1], values[index]);
		if (order === 0) {
			throw new TypeError(`test atomic host image contains a duplicate ${label}`);
		}
		if (order > 0)
			throw new TypeError(`test atomic host image has non-canonical ${label} ordering`);
	}
}

function compareResolvablePolicy(
	left: KeyedRateLimitReferencePolicy,
	right: KeyedRateLimitReferencePolicy,
): number {
	return compareResolvableScope(left.scope, right.scope);
}

function assertTestAtomicHostReceipt(value: unknown): TestAtomicHostReceipt {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new TypeError("test atomic host receipt must be an object");
	}
	const record = value as Record<string, unknown>;
	assertExactFields(record, ["outcome", "stateRevision"]);
	if (typeof record.stateRevision !== "string" || record.stateRevision.length === 0) {
		throw new TypeError("test atomic host receipt stateRevision is malformed");
	}
	const outcome = assertKeyedRateLimitOutcome(record.outcome);
	if (outcome.result !== "allowed" && outcome.result !== "denied") {
		throw new TypeError("test atomic host receipt must contain a valid transition outcome");
	}
	return Object.freeze({
		outcome,
		stateRevision: record.stateRevision,
	});
}

function assertReceiptStateCoherence(
	receipt: TestAtomicHostReceipt,
	states: readonly KeyedRateLimitReferenceState[],
): void {
	const request = assertKeyedRateLimitRequest(
		strictJsonCodec.decode(new TextEncoder().encode(receipt.outcome.requestIdentity.key)),
	);
	if (
		request.requestId !== receipt.outcome.requestId ||
		!sameCoordinate(request.authority, receipt.outcome.authority)
	) {
		throw new TypeError("test atomic host receipt coordinates are inconsistent");
	}
	const matches = states.filter(
		(state) =>
			requestMatchesScope(request, state.scope) &&
			state.scope.stateRevision === receipt.stateRevision,
	);
	if (matches.length !== 1) {
		throw new TypeError("test atomic host receipt lacks one exact scoped state");
	}
}

function compareReceipt(left: TestAtomicHostReceipt, right: TestAtomicHostReceipt): number {
	return (
		compareCoordinate(left.outcome.authority, right.outcome.authority) ||
		compareText(left.outcome.requestId, right.outcome.requestId)
	);
}

function compareState(
	left: KeyedRateLimitReferenceState,
	right: KeyedRateLimitReferenceState,
): number {
	return compareScope(left.scope, right.scope);
}

function compareScope(
	left: KeyedRateLimitReferenceScope,
	right: KeyedRateLimitReferenceScope,
): number {
	return (
		compareCoordinate(left.authority, right.authority) ||
		compareCoordinate(left.key, right.key) ||
		compareText(left.policy.id, right.policy.id) ||
		compareText(left.policy.revision, right.policy.revision) ||
		compareText(left.policy.algorithm.kind, right.policy.algorithm.kind) ||
		compareText(left.policy.algorithm.revision, right.policy.algorithm.revision) ||
		compareText(left.stateRevision, right.stateRevision)
	);
}

function compareResolvableScope(
	left: KeyedRateLimitReferenceScope,
	right: KeyedRateLimitReferenceScope,
): number {
	return (
		compareCoordinate(left.authority, right.authority) ||
		compareCoordinate(left.key, right.key) ||
		compareText(left.policy.id, right.policy.id) ||
		compareText(left.policy.revision, right.policy.revision) ||
		compareText(left.policy.algorithm.kind, right.policy.algorithm.kind) ||
		compareText(left.policy.algorithm.revision, right.policy.algorithm.revision)
	);
}

function requestMatchesScope(
	request: KeyedRateLimitRequest,
	scope: KeyedRateLimitReferenceScope,
): boolean {
	return (
		sameCoordinate(request.key, scope.key) &&
		sameCoordinate(request.authority, scope.authority) &&
		request.policy.id === scope.policy.id &&
		request.policy.revision === scope.policy.revision &&
		request.policy.algorithm.kind === scope.policy.algorithm.kind &&
		request.policy.algorithm.revision === scope.policy.algorithm.revision
	);
}

function sameScope(
	left: KeyedRateLimitReferenceScope,
	right: KeyedRateLimitReferenceScope,
): boolean {
	return compareScope(left, right) === 0;
}

function sameScopeLineage(
	left: KeyedRateLimitReferenceScope,
	right: KeyedRateLimitReferenceScope,
): boolean {
	return (
		sameCoordinateIdentity(left.authority, right.authority) &&
		sameCoordinateIdentity(left.key, right.key) &&
		left.policy.id === right.policy.id
	);
}

function compareCoordinate(
	left: KeyedRateLimitCoordinate,
	right: KeyedRateLimitCoordinate,
): number {
	return (
		compareText(left.kind, right.kind) ||
		compareText(left.id, right.id) ||
		compareText(left.revision, right.revision)
	);
}

function sameCoordinate(left: KeyedRateLimitCoordinate, right: KeyedRateLimitCoordinate): boolean {
	return compareCoordinate(left, right) === 0;
}

function sameCoordinateIdentity(
	left: KeyedRateLimitCoordinate,
	right: KeyedRateLimitCoordinate,
): boolean {
	return left.kind === right.kind && left.id === right.id;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function strictRoundtrip(value: unknown): unknown {
	return strictJsonCodec.decode(strictJsonCodec.encode(value));
}
