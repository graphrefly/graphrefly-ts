import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { graph } from "../graph/index.js";
import { strictJsonCodec } from "../json/codec.js";
import {
	assertFixedWindowRateLimitPolicy,
	assertFixedWindowRateLimitState,
	assertFixedWindowRateLimitTransition,
	assertFixedWindowRateLimitTransitionInput,
	assertKeyedRateLimitReferencePolicy,
	assertKeyedRateLimitReferenceState,
	assertKeyedRateLimitReferenceTransitionInput,
	assertKeyedRateLimitRequest,
	assertKeyedRateLimitTransition,
	assertSlidingWindowRateLimitPolicy,
	assertSlidingWindowRateLimitState,
	assertSlidingWindowRateLimitTransition,
	assertSlidingWindowRateLimitTransitionInput,
	assertTokenBucketRateLimitPolicy,
	assertTokenBucketRateLimitState,
	assertTokenBucketRateLimitTransition,
	assertTokenBucketRateLimitTransitionInput,
	createFixedWindowRateLimitPolicy,
	createFixedWindowRateLimitTransitionInput,
	createSlidingWindowRateLimitPolicy,
	createSlidingWindowRateLimitTransitionInput,
	createTokenBucketRateLimitPolicy,
	createTokenBucketRateLimitTransitionInput,
	evaluateFixedWindowRateLimitTransition,
	evaluateSlidingWindowRateLimitTransition,
	evaluateTokenBucketRateLimitTransition,
	type FixedWindowRateLimitState,
	type KeyedRateLimitRequest,
	KeyedRateLimitTransitionError,
	type SlidingWindowRateLimitState,
	type TokenBucketRateLimitState,
} from "../rate-limit/index.js";

function request(
	algorithmKind: "fixed-window" | "sliding-window" | "token-bucket",
	requestId: string,
	units = 1,
): KeyedRateLimitRequest {
	return assertKeyedRateLimitRequest({
		format: "graphrefly.keyedRateLimitRequest",
		version: 1,
		requestId,
		key: { kind: "network-key", id: `opaque-${algorithmKind}`, revision: "key-v1" },
		policy: {
			id: `${algorithmKind}-policy`,
			revision: "policy-v3",
			algorithm: { kind: algorithmKind, revision: "algorithm-v1" },
		},
		authority: { kind: "quota-store", id: "primary", revision: "schema-v2" },
		operation: { kind: "write", id: `operation-${requestId}`, revision: "intent-v1" },
		units,
	});
}

function withUnits(value: KeyedRateLimitRequest, units: number): KeyedRateLimitRequest {
	return assertKeyedRateLimitRequest({ ...value, requestId: `${value.requestId}-${units}`, units });
}

function mutableClone<T>(value: T): T {
	return strictJsonCodec.decode(strictJsonCodec.encode(value)) as T;
}

function expectErrorCode(fn: () => unknown, code: string): KeyedRateLimitTransitionError {
	let caught: unknown;
	try {
		fn();
	} catch (error) {
		caught = error;
	}
	expect(caught).toBeInstanceOf(KeyedRateLimitTransitionError);
	expect((caught as KeyedRateLimitTransitionError).code).toBe(code);
	return caught as KeyedRateLimitTransitionError;
}

function fixedSetup(units = 1) {
	const req = request("fixed-window", "fixed", units);
	const policy = createFixedWindowRateLimitPolicy(req, {
		stateRevision: "state-v1",
		capacityUnits: 5,
		windowMs: 1_000,
	});
	return { req, policy };
}

function slidingSetup(units = 1, maxEntries = 3) {
	const req = request("sliding-window", "sliding", units);
	const policy = createSlidingWindowRateLimitPolicy(req, {
		stateRevision: "state-v1",
		capacityUnits: 5,
		windowMs: 100,
		maxEntries,
	});
	return { req, policy };
}

function tokenSetup(units = 1, initialUnits = 0) {
	const req = request("token-bucket", "token", units);
	const policy = createTokenBucketRateLimitPolicy(req, {
		stateRevision: "state-v1",
		capacityUnits: 10,
		refillUnits: 3,
		refillPeriodMs: 1_000,
		initialUnits,
	});
	return { req, policy };
}

describe("D650 keyed rate-limit reference transitions — common strict boundary", () => {
	it("strictly roundtrips policy, state, input, and transition for all three algorithms", () => {
		const fixed = fixedSetup(2);
		const fixedInput = createFixedWindowRateLimitTransitionInput(
			fixed.req,
			fixed.policy,
			null,
			1_500,
		);
		const fixedTransition = evaluateFixedWindowRateLimitTransition(fixedInput);

		const sliding = slidingSetup(2);
		const slidingInput = createSlidingWindowRateLimitTransitionInput(
			sliding.req,
			sliding.policy,
			null,
			100,
		);
		const slidingTransition = evaluateSlidingWindowRateLimitTransition(slidingInput);

		const token = tokenSetup(1, 1);
		const tokenInput = createTokenBucketRateLimitTransitionInput(token.req, token.policy, null, 0);
		const tokenTransition = evaluateTokenBucketRateLimitTransition(tokenInput);

		const fixtures = [
			[fixed.policy, assertFixedWindowRateLimitPolicy, assertKeyedRateLimitReferencePolicy],
			[sliding.policy, assertSlidingWindowRateLimitPolicy, assertKeyedRateLimitReferencePolicy],
			[token.policy, assertTokenBucketRateLimitPolicy, assertKeyedRateLimitReferencePolicy],
			[
				fixedTransition.nextState,
				assertFixedWindowRateLimitState,
				assertKeyedRateLimitReferenceState,
			],
			[
				slidingTransition.nextState,
				assertSlidingWindowRateLimitState,
				assertKeyedRateLimitReferenceState,
			],
			[
				tokenTransition.nextState,
				assertTokenBucketRateLimitState,
				assertKeyedRateLimitReferenceState,
			],
			[
				fixedInput,
				assertFixedWindowRateLimitTransitionInput,
				assertKeyedRateLimitReferenceTransitionInput,
			],
			[
				slidingInput,
				assertSlidingWindowRateLimitTransitionInput,
				assertKeyedRateLimitReferenceTransitionInput,
			],
			[
				tokenInput,
				assertTokenBucketRateLimitTransitionInput,
				assertKeyedRateLimitReferenceTransitionInput,
			],
			[fixedTransition, assertFixedWindowRateLimitTransition, assertKeyedRateLimitTransition],
			[slidingTransition, assertSlidingWindowRateLimitTransition, assertKeyedRateLimitTransition],
			[tokenTransition, assertTokenBucketRateLimitTransition, assertKeyedRateLimitTransition],
		] as const;

		for (const [fixture, focusedAssert, unionAssert] of fixtures) {
			const bytes = strictJsonCodec.encode(fixture);
			const decoded = strictJsonCodec.decode(bytes);
			expect(focusedAssert(decoded as never)).toEqual(fixture);
			expect(unionAssert(decoded as never)).toEqual(fixture);
		}
	});

	it("is deterministic, deeply immutable, and does not mutate input objects", () => {
		const fixed = fixedSetup(2);
		const rawFixed = mutableClone(
			createFixedWindowRateLimitTransitionInput(fixed.req, fixed.policy, null, 200),
		);
		const fixedBefore = strictJsonCodec.encode(rawFixed);
		const fixedTransition = evaluateFixedWindowRateLimitTransition(rawFixed);
		expect(strictJsonCodec.encode(rawFixed)).toEqual(fixedBefore);
		expect(Object.isFrozen(fixedTransition)).toBe(true);
		expect(Object.isFrozen(fixedTransition.nextState)).toBe(true);
		expect(Object.isFrozen(fixedTransition.nextState.scope)).toBe(true);

		const { req, policy } = slidingSetup(2);
		const rawInput = mutableClone(
			createSlidingWindowRateLimitTransitionInput(req, policy, null, 200),
		);
		const before = strictJsonCodec.encode(rawInput);
		const first = evaluateSlidingWindowRateLimitTransition(rawInput);
		const second = evaluateSlidingWindowRateLimitTransition(rawInput);

		expect(strictJsonCodec.encode(first)).toEqual(strictJsonCodec.encode(second));
		expect(strictJsonCodec.encode(rawInput)).toEqual(before);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.nextState)).toBe(true);
		expect(Object.isFrozen(first.nextState.scope)).toBe(true);
		expect(Object.isFrozen(first.nextState.scope.key)).toBe(true);
		expect(Object.isFrozen(first.nextState.entries)).toBe(true);
		expect(Object.isFrozen(first.nextState.entries[0])).toBe(true);

		const token = tokenSetup(1, 1);
		const rawToken = mutableClone(
			createTokenBucketRateLimitTransitionInput(token.req, token.policy, null, 200),
		);
		const tokenBefore = strictJsonCodec.encode(rawToken);
		const tokenTransition = evaluateTokenBucketRateLimitTransition(rawToken);
		expect(strictJsonCodec.encode(rawToken)).toEqual(tokenBefore);
		expect(Object.isFrozen(tokenTransition)).toBe(true);
		expect(Object.isFrozen(tokenTransition.nextState)).toBe(true);
		expect(Object.isFrozen(tokenTransition.nextState.scope)).toBe(true);
	});

	it("produces byte-identical canonical state across repeated transition sequences", () => {
		function fixedRun(): Uint8Array {
			const { req, policy } = fixedSetup(1);
			let state: FixedWindowRateLimitState | null = null;
			for (const observedAtMs of [0, 0, 999, 1_000, 6_500]) {
				state = evaluateFixedWindowRateLimitTransition(
					createFixedWindowRateLimitTransitionInput(req, policy, state, observedAtMs),
				).nextState;
			}
			return strictJsonCodec.encode(state);
		}

		function slidingRun(): Uint8Array {
			const { req, policy } = slidingSetup(1);
			let state: SlidingWindowRateLimitState | null = null;
			for (const observedAtMs of [0, 0, 50, 100, 101]) {
				state = evaluateSlidingWindowRateLimitTransition(
					createSlidingWindowRateLimitTransitionInput(req, policy, state, observedAtMs),
				).nextState;
			}
			return strictJsonCodec.encode(state);
		}

		function tokenRun(): Uint8Array {
			const { req, policy } = tokenSetup(1, 0);
			let state: TokenBucketRateLimitState | null = null;
			for (const observedAtMs of [0, 333, 334, 667, 1_000]) {
				state = evaluateTokenBucketRateLimitTransition(
					createTokenBucketRateLimitTransitionInput(req, policy, state, observedAtMs),
				).nextState;
			}
			return strictJsonCodec.encode(state);
		}

		expect(fixedRun()).toEqual(fixedRun());
		expect(slidingRun()).toEqual(slidingRun());
		expect(tokenRun()).toEqual(tokenRun());
	});

	it.each([
		["function", () => ({ surprise: () => undefined })],
		["BigInt", () => ({ surprise: 1n })],
		["Date", () => ({ surprise: new Date(0) })],
		["Map", () => ({ surprise: new Map() })],
		["Set", () => ({ surprise: new Set() })],
		["Promise", () => ({ surprise: Promise.resolve() })],
		["runtime handle", () => ({ surprise: { consume() {} } })],
	])("rejects %s and unknown material before evaluation", (_label, extra) => {
		const { req, policy } = fixedSetup();
		const valid = mutableClone(createFixedWindowRateLimitTransitionInput(req, policy, null, 0));
		expectErrorCode(
			() => evaluateFixedWindowRateLimitTransition({ ...valid, ...extra() }),
			"malformed-input",
		);
	});

	it("rejects malformed request, policy, state, and model-shaped admission hints", () => {
		const { req, policy } = fixedSetup();
		const valid = mutableClone(createFixedWindowRateLimitTransitionInput(req, policy, null, 0));
		expectErrorCode(
			() =>
				evaluateFixedWindowRateLimitTransition({
					...valid,
					request: { ...valid.request, units: 0 },
				}),
			"malformed-request",
		);
		expectErrorCode(
			() =>
				evaluateFixedWindowRateLimitTransition({
					...valid,
					policy: { ...valid.policy, confidence: 1 },
				}),
			"malformed-policy",
		);
		const first = evaluateFixedWindowRateLimitTransition(valid);
		expectErrorCode(
			() =>
				evaluateFixedWindowRateLimitTransition({
					...valid,
					state: { ...first.nextState, ranking: ["allow"] },
				}),
			"malformed-state",
		);
		for (const field of ["similarity", "confidence", "ranking", "priority", "modelOutput"]) {
			expectErrorCode(
				() => evaluateFixedWindowRateLimitTransition({ ...valid, [field]: 1 }),
				"malformed-input",
			);
		}
	});

	it("validates creation options without executing accessors", () => {
		const { req } = fixedSetup();
		let getterRuns = 0;
		const options = {
			stateRevision: "state-v1",
			capacityUnits: 5,
			get windowMs() {
				getterRuns += 1;
				return 1_000;
			},
		};
		expectErrorCode(
			() =>
				createFixedWindowRateLimitPolicy(
					req,
					options as unknown as Parameters<typeof createFixedWindowRateLimitPolicy>[1],
				),
			"malformed-policy",
		);
		expect(getterRuns).toBe(0);
	});

	it("fails closed for wrong key, policy/algorithm revision, authority, and state revision", () => {
		const { req, policy } = fixedSetup();
		const first = evaluateFixedWindowRateLimitTransition(
			createFixedWindowRateLimitTransitionInput(req, policy, null, 0),
		);
		const keyPolicy = mutableClone(policy);
		keyPolicy.scope.key.id = "other-key";
		expectErrorCode(
			() =>
				evaluateFixedWindowRateLimitTransition(
					createFixedWindowRateLimitTransitionInput(req, keyPolicy, null, 1),
				),
			"scope-mismatch",
		);
		const authorityPolicy = mutableClone(policy);
		authorityPolicy.scope.authority.revision = "other-authority";
		expectErrorCode(
			() =>
				evaluateFixedWindowRateLimitTransition(
					createFixedWindowRateLimitTransitionInput(req, authorityPolicy, null, 1),
				),
			"scope-mismatch",
		);
		const revisionPolicy = mutableClone(policy);
		revisionPolicy.scope.policy.revision = "policy-v4";
		expectErrorCode(
			() =>
				evaluateFixedWindowRateLimitTransition(
					createFixedWindowRateLimitTransitionInput(req, revisionPolicy, null, 1),
				),
			"revision-mismatch",
		);
		const algorithmPolicy = mutableClone(policy);
		algorithmPolicy.scope.policy.algorithm.revision = "algorithm-v2";
		expectErrorCode(
			() =>
				evaluateFixedWindowRateLimitTransition(
					createFixedWindowRateLimitTransitionInput(req, algorithmPolicy, null, 1),
				),
			"revision-mismatch",
		);
		const staleState = mutableClone(first.nextState);
		staleState.scope.stateRevision = "state-v0";
		expectErrorCode(
			() =>
				evaluateFixedWindowRateLimitTransition(
					createFixedWindowRateLimitTransitionInput(req, policy, staleState, 1),
				),
			"revision-mismatch",
		);
	});

	it("returns ready denial only for valid quota decisions and sanitizes all failures", () => {
		const secret = "DO-NOT-LEAK-OPAQUE-KEY";
		const req = request("fixed-window", secret, 6);
		const policy = createFixedWindowRateLimitPolicy(req, {
			stateRevision: "state-v1",
			capacityUnits: 5,
			windowMs: 1_000,
		});
		const permanent = evaluateFixedWindowRateLimitTransition(
			createFixedWindowRateLimitTransitionInput(req, policy, null, 0),
		);
		expect(permanent).toMatchObject({
			status: "ready",
			result: "denied",
			remainingUnits: 5,
			resetAtMs: null,
			retryAfterMs: null,
		});

		const wrong = mutableClone(policy);
		wrong.scope.key.id = "different";
		const error = expectErrorCode(
			() =>
				evaluateFixedWindowRateLimitTransition(
					createFixedWindowRateLimitTransitionInput(req, wrong, null, 0),
				),
			"scope-mismatch",
		);
		expect(error.message).not.toContain(secret);
		expect(error.message).not.toContain(req.operation.id);
		expect(error.message).not.toContain(JSON.stringify(policy));
	});

	it("rejects impossible ready denial with zero retry delay", () => {
		const { req, policy } = fixedSetup(6);
		const permanent = evaluateFixedWindowRateLimitTransition(
			createFixedWindowRateLimitTransitionInput(req, policy, null, 0),
		);
		expectErrorCode(
			() =>
				assertFixedWindowRateLimitTransition({
					...permanent,
					retryAfterMs: 0,
				}),
			"malformed-transition",
		);
	});

	it("keeps graph topology unchanged and imports no graph, clock, timer, async, store, or client path", () => {
		const g = graph();
		g.state(1, { name: "source" });
		const before = g.describe();
		const { req, policy } = tokenSetup(1, 1);
		evaluateTokenBucketRateLimitTransition(
			createTokenBucketRateLimitTransitionInput(req, policy, null, 0),
		);
		expect(g.describe()).toEqual(before);

		const source = readFileSync(
			new URL("../rate-limit/keyed-rate-limit-algorithms.ts", import.meta.url),
			"utf8",
		);
		// B111.7 adds generated-doc examples with the required focused public import. Strip JSDoc so
		// these assertions continue to inspect evaluator implementation ownership rather than prose.
		const implementationSource = source.replace(/\/\*\*[\s\S]*?\*\//g, "");
		expect(implementationSource).not.toMatch(
			/\bDate\.now\b|\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b|\brequestAnimationFrame\b|\bqueueMicrotask\b/,
		);
		expect(implementationSource).not.toMatch(/\basync\b|\bPromise\b/);
		expect(implementationSource).not.toMatch(
			/from\s+["'][^"']*(graph|node|adapter|store|client)[^"']*["']/,
		);
		expect(implementationSource).not.toMatch(
			/from\s+["']node:(fs|net|http|https|dns|dgram|tls|child_process)["']|\bfetch\s*\(/,
		);
	});
});

describe("D650 fixed-window-v1 exact transition semantics", () => {
	it("covers first, within-capacity, exact-capacity, denial, same timestamp, and boundary reset", () => {
		const setup = fixedSetup(2);
		const first = evaluateFixedWindowRateLimitTransition(
			createFixedWindowRateLimitTransitionInput(setup.req, setup.policy, null, 1_500),
		);
		expect(first).toMatchObject({
			result: "allowed",
			remainingUnits: 3,
			resetAtMs: 2_000,
			retryAfterMs: null,
		});
		expect(first.nextState).toMatchObject({ windowStartMs: 1_000, usedUnits: 2 });

		const exactRequest = withUnits(setup.req, 3);
		const exact = evaluateFixedWindowRateLimitTransition(
			createFixedWindowRateLimitTransitionInput(exactRequest, setup.policy, first.nextState, 1_500),
		);
		expect(exact).toMatchObject({ result: "allowed", remainingUnits: 0, resetAtMs: 2_000 });

		const denied = evaluateFixedWindowRateLimitTransition(
			createFixedWindowRateLimitTransitionInput(
				withUnits(setup.req, 1),
				setup.policy,
				exact.nextState,
				1_500,
			),
		);
		expect(denied).toMatchObject({
			status: "ready",
			result: "denied",
			remainingUnits: 0,
			resetAtMs: 2_000,
			retryAfterMs: 500,
		});

		const boundary = evaluateFixedWindowRateLimitTransition(
			createFixedWindowRateLimitTransitionInput(
				withUnits(setup.req, 1),
				setup.policy,
				denied.nextState,
				2_000,
			),
		);
		expect(boundary).toMatchObject({ result: "allowed", remainingUnits: 4, resetAtMs: 3_000 });
		expect(boundary.nextState.windowStartMs).toBe(2_000);
	});

	it("jumps across skipped windows in O(1), supports multi-unit requests, and rejects regression", () => {
		const { req, policy } = fixedSetup(2);
		const first = evaluateFixedWindowRateLimitTransition(
			createFixedWindowRateLimitTransitionInput(req, policy, null, 500),
		);
		const skipped = evaluateFixedWindowRateLimitTransition(
			createFixedWindowRateLimitTransitionInput(req, policy, first.nextState, 6_500),
		);
		expect(skipped.nextState).toMatchObject({
			windowStartMs: 6_000,
			usedUnits: 2,
			lastObservedAtMs: 6_500,
		});
		expectErrorCode(
			() =>
				evaluateFixedWindowRateLimitTransition(
					createFixedWindowRateLimitTransitionInput(req, policy, skipped.nextState, 6_499),
				),
			"time-regression",
		);
	});

	it("fails closed on unsafe time, end overflow, and state-bound overflow", () => {
		const { req, policy } = fixedSetup();
		expectErrorCode(
			() =>
				createFixedWindowRateLimitTransitionInput(req, policy, null, Number.MAX_SAFE_INTEGER + 1),
			"malformed-input",
		);
		const overflowPolicy = createFixedWindowRateLimitPolicy(req, {
			stateRevision: "state-v1",
			capacityUnits: 5,
			windowMs: 2,
		});
		expectErrorCode(
			() =>
				evaluateFixedWindowRateLimitTransition(
					createFixedWindowRateLimitTransitionInput(
						req,
						overflowPolicy,
						null,
						Number.MAX_SAFE_INTEGER - 1,
					),
				),
			"arithmetic-overflow",
		);
		const invalidState: FixedWindowRateLimitState = {
			format: "graphrefly.fixedWindowRateLimitState",
			version: 1,
			algorithm: "fixed-window-v1",
			scope: policy.scope,
			windowStartMs: 0,
			usedUnits: 6,
			lastObservedAtMs: 0,
		};
		expectErrorCode(
			() =>
				evaluateFixedWindowRateLimitTransition(
					createFixedWindowRateLimitTransitionInput(req, policy, invalidState, 0),
				),
			"state-bound-overflow",
		);
	});
});

describe("D650 sliding-window-v1 exact ledger semantics", () => {
	it("handles partial expiry, exact-cutoff expiry, multi-unit retry, and full reset time", () => {
		const { req, policy } = slidingSetup(2);
		const state = assertSlidingWindowRateLimitState({
			format: "graphrefly.slidingWindowRateLimitState",
			version: 1,
			algorithm: "sliding-window-v1",
			scope: policy.scope,
			entries: [
				{ atMs: 100, units: 2 },
				{ atMs: 150, units: 2 },
			],
			usedUnits: 4,
			lastObservedAtMs: 150,
		});
		const denied = evaluateSlidingWindowRateLimitTransition(
			createSlidingWindowRateLimitTransitionInput(req, policy, state, 199),
		);
		expect(denied).toMatchObject({
			status: "ready",
			result: "denied",
			remainingUnits: 1,
			retryAfterMs: 1,
			resetAtMs: 250,
		});

		const exactCutoff = evaluateSlidingWindowRateLimitTransition(
			createSlidingWindowRateLimitTransitionInput(withUnits(req, 3), policy, denied.nextState, 200),
		);
		expect(exactCutoff).toMatchObject({
			result: "allowed",
			remainingUnits: 0,
			resetAtMs: 300,
		});
		expect(exactCutoff.nextState.entries).toEqual([
			{ atMs: 150, units: 2 },
			{ atMs: 200, units: 3 },
		]);
	});

	it("coalesces equal milliseconds and rejects non-canonical ordering or duplicates", () => {
		const { req, policy } = slidingSetup(1);
		const first = evaluateSlidingWindowRateLimitTransition(
			createSlidingWindowRateLimitTransitionInput(req, policy, null, 30),
		);
		const sameMs = evaluateSlidingWindowRateLimitTransition(
			createSlidingWindowRateLimitTransitionInput(req, policy, first.nextState, 30),
		);
		expect(sameMs.nextState.entries).toEqual([{ atMs: 30, units: 2 }]);

		for (const entries of [
			[
				{ atMs: 30, units: 1 },
				{ atMs: 30, units: 1 },
			],
			[
				{ atMs: 31, units: 1 },
				{ atMs: 30, units: 1 },
			],
		]) {
			expectErrorCode(
				() =>
					assertSlidingWindowRateLimitState({
						...mutableClone(sameMs.nextState),
						entries,
						usedUnits: 2,
					}),
				"malformed-state",
			);
		}
	});

	it("prunes before the exact bound and fails pressure without approximation or eviction", () => {
		const { req, policy } = slidingSetup(1, 3);
		const atBound = assertSlidingWindowRateLimitState({
			format: "graphrefly.slidingWindowRateLimitState",
			version: 1,
			algorithm: "sliding-window-v1",
			scope: policy.scope,
			entries: [
				{ atMs: 10, units: 1 },
				{ atMs: 20, units: 1 },
				{ atMs: 30, units: 1 },
			],
			usedUnits: 3,
			lastObservedAtMs: 30,
		});
		const afterPrune = evaluateSlidingWindowRateLimitTransition(
			createSlidingWindowRateLimitTransitionInput(req, policy, atBound, 110),
		);
		expect(afterPrune.nextState.entries).toEqual([
			{ atMs: 20, units: 1 },
			{ atMs: 30, units: 1 },
			{ atMs: 110, units: 1 },
		]);

		const pressurePolicy = createSlidingWindowRateLimitPolicy(req, {
			stateRevision: "state-v1",
			capacityUnits: 10,
			windowMs: 100,
			maxEntries: 3,
		});
		const pressure = assertSlidingWindowRateLimitState({
			...mutableClone(atBound),
			scope: pressurePolicy.scope,
			entries: [
				{ atMs: 11, units: 1 },
				{ atMs: 20, units: 1 },
				{ atMs: 30, units: 1 },
			],
		});
		expectErrorCode(
			() =>
				evaluateSlidingWindowRateLimitTransition(
					createSlidingWindowRateLimitTransitionInput(req, pressurePolicy, pressure, 31),
				),
			"state-bound-overflow",
		);
		expect(pressure.entries).toHaveLength(3);
	});

	it("keeps permanent denial valid, rejects expired/non-canonical state, and checks expiry overflow", () => {
		const setup = slidingSetup(6);
		const permanent = evaluateSlidingWindowRateLimitTransition(
			createSlidingWindowRateLimitTransitionInput(setup.req, setup.policy, null, 0),
		);
		expect(permanent).toMatchObject({
			status: "ready",
			result: "denied",
			remainingUnits: 5,
			resetAtMs: null,
			retryAfterMs: null,
		});

		const staleEntry: SlidingWindowRateLimitState = {
			format: "graphrefly.slidingWindowRateLimitState",
			version: 1,
			algorithm: "sliding-window-v1",
			scope: setup.policy.scope,
			entries: [{ atMs: 0, units: 1 }],
			usedUnits: 1,
			lastObservedAtMs: 100,
		};
		expectErrorCode(
			() =>
				evaluateSlidingWindowRateLimitTransition(
					createSlidingWindowRateLimitTransitionInput(
						withUnits(setup.req, 1),
						setup.policy,
						staleEntry,
						100,
					),
				),
			"malformed-state",
		);

		const overflowPolicy = createSlidingWindowRateLimitPolicy(
			request("sliding-window", "overflow", 1),
			{ stateRevision: "state-v1", capacityUnits: 5, windowMs: 2, maxEntries: 3 },
		);
		const overflowState = assertSlidingWindowRateLimitState({
			format: "graphrefly.slidingWindowRateLimitState",
			version: 1,
			algorithm: "sliding-window-v1",
			scope: overflowPolicy.scope,
			entries: [{ atMs: Number.MAX_SAFE_INTEGER - 1, units: 1 }],
			usedUnits: 1,
			lastObservedAtMs: Number.MAX_SAFE_INTEGER - 1,
		});
		const overflowRequest = request("sliding-window", "overflow", 1);
		expectErrorCode(
			() =>
				evaluateSlidingWindowRateLimitTransition(
					createSlidingWindowRateLimitTransitionInput(
						overflowRequest,
						overflowPolicy,
						overflowState,
						Number.MAX_SAFE_INTEGER - 1,
					),
				),
			"arithmetic-overflow",
		);

		const first = evaluateSlidingWindowRateLimitTransition(
			createSlidingWindowRateLimitTransitionInput(withUnits(setup.req, 1), setup.policy, null, 10),
		);
		expectErrorCode(
			() =>
				evaluateSlidingWindowRateLimitTransition(
					createSlidingWindowRateLimitTransitionInput(
						withUnits(setup.req, 1),
						setup.policy,
						first.nextState,
						9,
					),
				),
			"time-regression",
		);
	});
});

describe("D650 token-bucket-v1 integer rational semantics", () => {
	it("uses explicit initial fill, exact remainder, same timestamp, and precise ceil eligibility", () => {
		const { req, policy } = tokenSetup(1, 0);
		const at333 = evaluateTokenBucketRateLimitTransition(
			createTokenBucketRateLimitTransitionInput(req, policy, null, 333),
		);
		expect(at333).toMatchObject({
			status: "ready",
			result: "denied",
			remainingUnits: 0,
			retryAfterMs: 334,
		});
		expect(at333.nextState).toMatchObject({ availableUnits: 0, refillRemainder: 0 });

		const at666 = evaluateTokenBucketRateLimitTransition(
			createTokenBucketRateLimitTransitionInput(req, policy, at333.nextState, 666),
		);
		expect(at666).toMatchObject({ result: "denied", remainingUnits: 0, retryAfterMs: 1 });
		expect(at666.nextState).toMatchObject({ availableUnits: 0, refillRemainder: 999 });

		const at667 = evaluateTokenBucketRateLimitTransition(
			createTokenBucketRateLimitTransitionInput(req, policy, at666.nextState, 667),
		);
		expect(at667).toMatchObject({ result: "allowed", remainingUnits: 0, retryAfterMs: null });
		expect(at667.nextState).toMatchObject({ availableUnits: 0, refillRemainder: 2 });

		const sameTimestamp = evaluateTokenBucketRateLimitTransition(
			createTokenBucketRateLimitTransitionInput(withUnits(req, 1), policy, at667.nextState, 667),
		);
		expect(sameTimestamp.nextState.refillRemainder).toBe(2);
	});

	it("advances denial state, hits the exact boundary, and computes resetAt", () => {
		const { req, policy } = tokenSetup(2, 0);
		const at500 = evaluateTokenBucketRateLimitTransition(
			createTokenBucketRateLimitTransitionInput(req, policy, null, 500),
		);
		expect(at500).toMatchObject({
			status: "ready",
			result: "denied",
			remainingUnits: 0,
			retryAfterMs: 667,
			resetAtMs: 3_834,
		});
		const at1000 = evaluateTokenBucketRateLimitTransition(
			createTokenBucketRateLimitTransitionInput(req, policy, at500.nextState, 1_000),
		);
		expect(at1000.nextState).toMatchObject({ availableUnits: 1, refillRemainder: 500 });
		expect(at1000).toMatchObject({ result: "denied", retryAfterMs: 167 });
		const at1167 = evaluateTokenBucketRateLimitTransition(
			createTokenBucketRateLimitTransitionInput(req, policy, at1000.nextState, 1_167),
		);
		expect(at1167.result).toBe("allowed");
	});

	it("discards excess and remainder on saturation, including long idle", () => {
		const { req, policy } = tokenSetup(1, 0);
		const state = assertTokenBucketRateLimitState({
			format: "graphrefly.tokenBucketRateLimitState",
			version: 1,
			algorithm: "token-bucket-v1",
			scope: policy.scope,
			availableUnits: 9,
			refillRemainder: 900,
			lastObservedAtMs: 0,
		});
		const saturatedThenConsumed = evaluateTokenBucketRateLimitTransition(
			createTokenBucketRateLimitTransitionInput(req, policy, state, 34),
		);
		expect(saturatedThenConsumed.nextState).toMatchObject({
			availableUnits: 9,
			refillRemainder: 0,
		});

		const longIdleReq = request("token-bucket", "long-idle", 11);
		const longIdlePolicy = createTokenBucketRateLimitPolicy(longIdleReq, {
			stateRevision: "state-v1",
			capacityUnits: 10,
			refillUnits: 1,
			refillPeriodMs: 1_000,
			initialUnits: 0,
		});
		const initialized = evaluateTokenBucketRateLimitTransition(
			createTokenBucketRateLimitTransitionInput(longIdleReq, longIdlePolicy, null, 0),
		);
		const longIdle = evaluateTokenBucketRateLimitTransition(
			createTokenBucketRateLimitTransitionInput(
				longIdleReq,
				longIdlePolicy,
				initialized.nextState,
				Number.MAX_SAFE_INTEGER,
			),
		);
		expect(longIdle).toMatchObject({ result: "denied", resetAtMs: null, retryAfterMs: null });
		expect(longIdle.nextState).toMatchObject({ availableUnits: 10, refillRemainder: 0 });
	});

	it("returns full-bucket resetAt null and permanent denial without widening admission", () => {
		const full = tokenSetup(11, 10);
		const permanent = evaluateTokenBucketRateLimitTransition(
			createTokenBucketRateLimitTransitionInput(full.req, full.policy, null, 0),
		);
		expect(permanent).toMatchObject({
			status: "ready",
			result: "denied",
			remainingUnits: 10,
			resetAtMs: null,
			retryAfterMs: null,
		});
	});

	it("rejects time regression, non-canonical saturation state, and reset arithmetic overflow", () => {
		const { req, policy } = tokenSetup(1, 1);
		const first = evaluateTokenBucketRateLimitTransition(
			createTokenBucketRateLimitTransitionInput(req, policy, null, 10),
		);
		expectErrorCode(
			() =>
				evaluateTokenBucketRateLimitTransition(
					createTokenBucketRateLimitTransitionInput(req, policy, first.nextState, 9),
				),
			"time-regression",
		);
		expectErrorCode(
			() =>
				evaluateTokenBucketRateLimitTransition(
					createTokenBucketRateLimitTransitionInput(
						req,
						policy,
						{ ...first.nextState, availableUnits: 10, refillRemainder: 1 },
						10,
					),
				),
			"malformed-state",
		);

		const overflowReq = request("token-bucket", "overflow", 1);
		const overflowPolicy = createTokenBucketRateLimitPolicy(overflowReq, {
			stateRevision: "state-v1",
			capacityUnits: Number.MAX_SAFE_INTEGER,
			refillUnits: 1,
			refillPeriodMs: Number.MAX_SAFE_INTEGER,
			initialUnits: 0,
		});
		expectErrorCode(
			() =>
				evaluateTokenBucketRateLimitTransition(
					createTokenBucketRateLimitTransitionInput(overflowReq, overflowPolicy, null, 0),
				),
			"arithmetic-overflow",
		);
	});
});

describe("D650 durable replay boundary fixture", () => {
	it("returns identical receipts and conflicts before state, clock, or evaluator access", () => {
		const { req, policy } = fixedSetup(1);
		const receipts = new Map<
			string,
			{ readonly material: string; readonly transition: FixedWindowRateLimitState }
		>();
		let policyResolutions = 0;
		let stateLoads = 0;
		let clockReads = 0;
		let evaluations = 0;

		function consume(
			nextRequest: KeyedRateLimitRequest,
			material: string,
			observedAtMs: number,
		): FixedWindowRateLimitState {
			const strictRequest = assertKeyedRateLimitRequest(nextRequest);
			const existing = receipts.get(strictRequest.requestId);
			if (existing !== undefined) {
				if (existing.material !== material) throw new Error("request-conflict");
				return existing.transition;
			}
			policyResolutions += 1;
			const exactPolicy = assertFixedWindowRateLimitPolicy(policy);
			stateLoads += 1;
			const state = null;
			clockReads += 1;
			const authoritativeObservedAtMs = observedAtMs;
			evaluations += 1;
			const transition = evaluateFixedWindowRateLimitTransition(
				createFixedWindowRateLimitTransitionInput(
					strictRequest,
					exactPolicy,
					state,
					authoritativeObservedAtMs,
				),
			);
			receipts.set(strictRequest.requestId, { material, transition: transition.nextState });
			return transition.nextState;
		}

		const first = consume(req, "material-a", 100);
		expect(consume(req, "material-a", Number.MAX_SAFE_INTEGER)).toBe(first);
		expect(() => consume(req, "material-b", Number.MAX_SAFE_INTEGER)).toThrow("request-conflict");
		expect({ policyResolutions, stateLoads, clockReads, evaluations }).toEqual({
			policyResolutions: 1,
			stateLoads: 1,
			clockReads: 1,
			evaluations: 1,
		});
	});
});
