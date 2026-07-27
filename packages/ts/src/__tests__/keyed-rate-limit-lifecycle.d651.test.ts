import { describe, expect, it } from "vitest";

import { attachKeyedRateLimitAuthority, type KeyedRateLimitAuthority } from "../adapters/index.js";
import { graph, type ObserveEvent } from "../graph/index.js";
import { canonicalTupleKey } from "../identity.js";
import { strictJsonCodec } from "../json/codec.js";
import type { Node } from "../node/node.js";
import {
	assertKeyedRateLimitRequest,
	createFixedWindowRateLimitPolicy,
	createKeyedRateLimitOutcome,
	createSlidingWindowRateLimitPolicy,
	createTokenBucketRateLimitPolicy,
	type KeyedRateLimitOutcome,
	type KeyedRateLimitReferencePolicy,
	type KeyedRateLimitRequest,
	keyedRateLimitRequestIdentity,
} from "../rate-limit/index.js";
import {
	TEST_ATOMIC_HOST_FORMAT,
	TestAtomicRateLimitAuthority,
} from "./fixtures/keyed-rate-limit-atomic-host.js";

type AlgorithmKind = "fixed-window" | "sliding-window" | "token-bucket";

function request(
	algorithm: AlgorithmKind | "host-custom",
	requestId: string,
	units = 1,
	operationId = `operation-${requestId}`,
): KeyedRateLimitRequest {
	return assertKeyedRateLimitRequest({
		format: "graphrefly.keyedRateLimitRequest",
		version: 1,
		requestId,
		key: { kind: "network-key", id: `shared-${algorithm}`, revision: "key-v1" },
		policy: {
			id: `${algorithm}-policy`,
			revision: "policy-v1",
			algorithm: { kind: algorithm, revision: "algorithm-v1" },
		},
		authority: { kind: "quota-store", id: "primary", revision: "schema-v1" },
		operation: { kind: "write", id: operationId, revision: "intent-v1" },
		units,
	});
}

function capture<T>(node: Node<T>) {
	const values: T[] = [];
	const release = node.subscribe((msg) => {
		if (msg[0] === "DATA") values.push(msg[1] as T);
	});
	return { values, release };
}

function buildInstance(
	authority: KeyedRateLimitAuthority,
	name: string,
	options: { profile?: boolean } = {},
) {
	const g = graph({ name, profile: options.profile });
	const requests = g.node<KeyedRateLimitRequest>([], null, { name: "requests" });
	const adapter = attachKeyedRateLimitAuthority(g, requests, authority, { name: "authority" });
	const outcomes = capture(adapter.outcomes);
	const admissions = capture(adapter.admission.admissions);
	const denials = capture(adapter.admission.denials);
	const issues = capture(adapter.admission.issues);
	let protectedEffects = 0;
	const protectedEffect = g.effect(
		[adapter.admission.admissions],
		() => {
			protectedEffects += 1;
		},
		{ name: "protected-effect" },
	);
	const effectRelease = protectedEffect.subscribe(() => {});
	return {
		g,
		requests,
		adapter,
		outcomes,
		admissions,
		denials,
		issues,
		protectedEffects: () => protectedEffects,
		release() {
			effectRelease();
			for (const captured of [outcomes, admissions, denials, issues]) captured.release();
		},
	};
}

function strictRoundtrip<T>(value: T): T {
	return strictJsonCodec.decode(strictJsonCodec.encode(value)) as T;
}

function encoded(value: unknown): readonly number[] {
	return [...strictJsonCodec.encode(value)];
}

function fixedPolicy(seed: KeyedRateLimitRequest, capacityUnits = 3) {
	return createFixedWindowRateLimitPolicy(seed, {
		stateRevision: "state-v1",
		capacityUnits,
		windowMs: 1_000,
	});
}

function slidingPolicy(seed: KeyedRateLimitRequest, capacityUnits = 3) {
	return createSlidingWindowRateLimitPolicy(seed, {
		stateRevision: "state-v1",
		capacityUnits,
		windowMs: 100,
		maxEntries: 8,
	});
}

function tokenPolicy(seed: KeyedRateLimitRequest, capacityUnits = 3, initialUnits = 0) {
	return createTokenBucketRateLimitPolicy(seed, {
		stateRevision: "state-v1",
		capacityUnits,
		refillUnits: 1,
		refillPeriodMs: 3,
		initialUnits,
	});
}

describe("B111.6 deterministic restart evidence", () => {
	it("rehydrates fixed-window state and receipt without replay clock/evaluator access", () => {
		const firstRequest = request("fixed-window", "fixed-first", 2);
		const policy = fixedPolicy(firstRequest);
		const firstHost = new TestAtomicRateLimitAuthority([policy], [100]);
		const firstGraph = buildInstance(firstHost, "fixed-before-restart");
		firstGraph.requests.down([["DATA", firstRequest]]);
		const storedOutcome = firstHost.drainNext();
		expect(storedOutcome?.result).toBe("allowed");
		const durableImage = strictRoundtrip(firstHost.snapshot());
		expect(encoded(firstHost.snapshot())).toEqual(encoded(durableImage));
		firstGraph.release();

		const restartedHost = new TestAtomicRateLimitAuthority([policy], [100, 1_000], durableImage);
		expect(encoded(restartedHost.snapshot())).toEqual(encoded(durableImage));
		const restartedGraph = buildInstance(restartedHost, "fixed-after-restart");
		restartedGraph.requests.down([["DATA", firstRequest]]);
		expect(restartedHost.drainNext()).toEqual(storedOutcome);
		expect(restartedGraph.outcomes.values.at(-1)).toEqual(storedOutcome);
		expect(restartedGraph.admissions.values).toHaveLength(1);
		expect(restartedGraph.protectedEffects()).toBeGreaterThan(0);
		const effectsAfterReplay = restartedGraph.protectedEffects();
		expect(restartedHost.counters()).toEqual({
			receiptLookups: 1,
			policyResolutions: 0,
			stateLoads: 0,
			clockReads: 0,
			evaluations: 0,
			commits: 0,
		});

		const denied = request("fixed-window", "fixed-denied", 2);
		restartedGraph.requests.down([["DATA", denied]]);
		expect(restartedHost.drainNext()?.result).toBe("denied");
		expect(restartedGraph.outcomes.values.at(-1)?.result).toBe("denied");
		expect(restartedGraph.denials.values).toHaveLength(1);
		const nextWindow = request("fixed-window", "fixed-next-window", 2);
		restartedGraph.requests.down([["DATA", nextWindow]]);
		expect(restartedHost.drainNext()?.result).toBe("allowed");
		expect(restartedGraph.admissions.values).toHaveLength(2);
		expect(restartedGraph.protectedEffects()).toBeGreaterThan(effectsAfterReplay);
		expect(restartedHost.snapshot().states).toMatchObject([
			{ algorithm: "fixed-window-v1", usedUnits: 2, windowStartMs: 1_000 },
		]);
		restartedGraph.release();
	});

	it("rehydrates the exact sliding ledger ordering across denial and cutoff expiry", () => {
		const firstRequest = request("sliding-window", "sliding-first");
		const secondRequest = request("sliding-window", "sliding-second");
		const policy = slidingPolicy(firstRequest);
		const firstHost = new TestAtomicRateLimitAuthority([policy], [10, 20]);
		const firstGraph = buildInstance(firstHost, "sliding-before-restart");
		firstGraph.requests.down([["DATA", firstRequest]]);
		expect(firstHost.drainNext()?.result).toBe("allowed");
		firstGraph.requests.down([["DATA", secondRequest]]);
		const storedOutcome = firstHost.drainNext();
		expect(storedOutcome?.result).toBe("allowed");
		expect(firstHost.snapshot().states).toMatchObject([
			{
				algorithm: "sliding-window-v1",
				usedUnits: 2,
				entries: [
					{ atMs: 10, units: 1 },
					{ atMs: 20, units: 1 },
				],
			},
		]);
		const durableImage = strictRoundtrip(firstHost.snapshot());
		firstGraph.release();

		const restartedHost = new TestAtomicRateLimitAuthority([policy], [30, 110], durableImage);
		const restartedGraph = buildInstance(restartedHost, "sliding-after-restart");
		restartedGraph.requests.down([["DATA", secondRequest]]);
		expect(restartedHost.drainNext()).toEqual(storedOutcome);
		expect(restartedGraph.outcomes.values.at(-1)).toEqual(storedOutcome);
		expect(restartedGraph.admissions.values).toHaveLength(1);
		expect(restartedGraph.protectedEffects()).toBeGreaterThan(0);
		const effectsAfterReplay = restartedGraph.protectedEffects();
		const denied = request("sliding-window", "sliding-denied", 2);
		restartedGraph.requests.down([["DATA", denied]]);
		expect(restartedHost.drainNext()?.result).toBe("denied");
		expect(restartedGraph.denials.values).toHaveLength(1);
		const afterCutoff = request("sliding-window", "sliding-after-cutoff", 2);
		restartedGraph.requests.down([["DATA", afterCutoff]]);
		expect(restartedHost.drainNext()?.result).toBe("allowed");
		expect(restartedGraph.admissions.values).toHaveLength(2);
		expect(restartedGraph.protectedEffects()).toBeGreaterThan(effectsAfterReplay);
		expect(restartedHost.snapshot().states).toMatchObject([
			{
				algorithm: "sliding-window-v1",
				usedUnits: 3,
				entries: [
					{ atMs: 20, units: 1 },
					{ atMs: 110, units: 2 },
				],
			},
		]);
		restartedGraph.release();
	});

	it("rehydrates token-bucket remainder and advances a valid denied state exactly", () => {
		const firstRequest = request("token-bucket", "token-first-denied");
		const remainderRequest = request("token-bucket", "token-remainder-denied");
		const policy = tokenPolicy(firstRequest);
		const firstHost = new TestAtomicRateLimitAuthority([policy], [0, 2]);
		const firstGraph = buildInstance(firstHost, "token-before-restart");
		firstGraph.requests.down([["DATA", firstRequest]]);
		expect(firstHost.drainNext()).toMatchObject({ result: "denied", retryAfterMs: 3 });
		firstGraph.requests.down([["DATA", remainderRequest]]);
		const storedDenial = firstHost.drainNext();
		expect(storedDenial).toMatchObject({ result: "denied", retryAfterMs: 1 });
		expect(firstHost.snapshot().states).toMatchObject([
			{ algorithm: "token-bucket-v1", availableUnits: 0, refillRemainder: 2 },
		]);
		const durableImage = strictRoundtrip(firstHost.snapshot());
		firstGraph.release();

		const restartedHost = new TestAtomicRateLimitAuthority([policy], [3], durableImage);
		const restartedGraph = buildInstance(restartedHost, "token-after-restart");
		restartedGraph.requests.down([["DATA", remainderRequest]]);
		expect(restartedHost.drainNext()).toEqual(storedDenial);
		expect(restartedGraph.outcomes.values.at(-1)).toEqual(storedDenial);
		expect(restartedGraph.denials.values).toHaveLength(1);
		expect(restartedHost.counters().clockReads).toBe(0);
		const eligible = request("token-bucket", "token-eligible");
		restartedGraph.requests.down([["DATA", eligible]]);
		expect(restartedHost.drainNext()?.result).toBe("allowed");
		expect(restartedGraph.admissions.values).toHaveLength(1);
		expect(restartedGraph.protectedEffects()).toBe(1);
		expect(restartedHost.snapshot().states).toMatchObject([
			{ algorithm: "token-bucket-v1", availableUnits: 0, refillRemainder: 0 },
		]);
		restartedGraph.release();
	});

	it("rejects non-strict, duplicate, or non-canonical durable images rather than repairing them", () => {
		const fixedSeed = request("fixed-window", "z-image-seed");
		const tokenSeed = request("token-bucket", "a-image-seed");
		const fixed = fixedPolicy(fixedSeed);
		const token = tokenPolicy(tokenSeed);
		const host = new TestAtomicRateLimitAuthority([fixed, token], [0, 0]);
		const instance = buildInstance(host, "image-source");
		instance.requests.down([
			["DATA", fixedSeed],
			["DATA", tokenSeed],
		]);
		host.drainNext();
		host.drainNext();
		const image = host.snapshot();
		expect(Object.isFrozen(image)).toBe(true);
		expect(Object.isFrozen(image.receipts)).toBe(true);
		expect(
			() =>
				new TestAtomicRateLimitAuthority([fixed, token], [], {
					...image,
					unknown: true,
				}),
		).toThrow("unknown or missing fields");
		expect(
			() =>
				new TestAtomicRateLimitAuthority([fixed, token], [], {
					...image,
					receipts: [...image.receipts, image.receipts.at(-1)!],
				}),
		).toThrow("duplicate receipt");
		expect(
			() =>
				new TestAtomicRateLimitAuthority([fixed, token], [], {
					...image,
					states: [...image.states, image.states.at(-1)!],
				}),
		).toThrow("duplicate state");
		expect(
			() =>
				new TestAtomicRateLimitAuthority([fixed, token], [], {
					...image,
					receipts: [...image.receipts].reverse(),
				}),
		).toThrow("non-canonical receipt ordering");
		expect(
			() =>
				new TestAtomicRateLimitAuthority([fixed, token], [], {
					...image,
					states: [...image.states].reverse(),
				}),
		).toThrow("non-canonical state ordering");
		expect(
			() =>
				new TestAtomicRateLimitAuthority([fixed, token], [], {
					...image,
					states: image.states.slice(1),
				}),
		).toThrow("receipt lacks one exact scoped state");
		const nonTransitionOutcome = createKeyedRateLimitOutcome(fixedSeed, {
			outcomeId: "non-transition-receipt",
			result: "conflict",
			provenance: [fixedSeed.authority],
		});
		expect(
			() =>
				new TestAtomicRateLimitAuthority([fixed, token], [], {
					...image,
					receipts: image.receipts.map((receipt) =>
						receipt.outcome.requestId === fixedSeed.requestId
							? { ...receipt, outcome: nonTransitionOutcome }
							: receipt,
					),
				}),
		).toThrow("valid transition outcome");
		expect(
			() =>
				new TestAtomicRateLimitAuthority([fixed, token], [], {
					...image,
					receipts: [() => undefined],
				}),
		).toThrow();
		instance.release();
	});

	it("fails closed on policy, algorithm, or state revision changes without implicit reset", () => {
		const originalRequest = request("fixed-window", "revision-original", 2);
		const originalPolicy = fixedPolicy(originalRequest);
		const originalHost = new TestAtomicRateLimitAuthority([originalPolicy], [0]);
		const originalGraph = buildInstance(originalHost, "revision-original");
		originalGraph.requests.down([["DATA", originalRequest]]);
		originalHost.drainNext();
		const durableImage = originalHost.snapshot();
		originalGraph.release();

		const policyChanged = assertKeyedRateLimitRequest({
			...request("fixed-window", "revision-policy"),
			policy: { ...originalRequest.policy, revision: "policy-v2" },
		});
		const algorithmChanged = assertKeyedRateLimitRequest({
			...request("fixed-window", "revision-algorithm"),
			policy: {
				...originalRequest.policy,
				algorithm: { ...originalRequest.policy.algorithm, revision: "algorithm-v2" },
			},
		});
		const cases = [
			{
				name: "policy",
				nextRequest: policyChanged,
				nextPolicy: fixedPolicy(policyChanged),
			},
			{
				name: "algorithm",
				nextRequest: algorithmChanged,
				nextPolicy: fixedPolicy(algorithmChanged),
			},
			{
				name: "state",
				nextRequest: request("fixed-window", "revision-state"),
				nextPolicy: createFixedWindowRateLimitPolicy(request("fixed-window", "revision-state"), {
					stateRevision: "state-v2",
					capacityUnits: 3,
					windowMs: 1_000,
				}),
			},
		] as const;
		for (const testCase of cases) {
			const host = new TestAtomicRateLimitAuthority(
				[testCase.nextPolicy],
				[Number.MAX_SAFE_INTEGER],
				durableImage,
			);
			const instance = buildInstance(host, `revision-${testCase.name}`);
			instance.requests.down([["DATA", testCase.nextRequest]]);
			expect(() => host.drainNext()).toThrow("refuses implicit state reset or migration");
			expect(host.counters()).toEqual({
				receiptLookups: 1,
				policyResolutions: 1,
				stateLoads: 1,
				clockReads: 0,
				evaluations: 0,
				commits: 0,
			});
			instance.release();
		}
		const changedStateRevision = createFixedWindowRateLimitPolicy(originalRequest, {
			stateRevision: "state-v2",
			capacityUnits: 3,
			windowMs: 1_000,
		});
		expect(
			() => new TestAtomicRateLimitAuthority([originalPolicy, changedStateRevision], []),
		).toThrow("duplicate request-resolvable policy");
	});

	it("returns ready outcomes for maximum-length request ids without derived-id overflow", () => {
		const requestId = "r".repeat(256);
		const firstRequest = request("fixed-window", requestId, 1, "bounded-operation");
		const changedMaterial = request("fixed-window", requestId, 2, "bounded-operation");
		const policy = fixedPolicy(firstRequest, 5);
		const host = new TestAtomicRateLimitAuthority([policy], [0]);
		const outcomes: KeyedRateLimitOutcome[] = [];
		host.consume(firstRequest, (outcome) => outcomes.push(outcome));
		expect(host.drainNext()).toMatchObject({ outcomeId: requestId, result: "allowed" });
		host.consume(changedMaterial, (outcome) => outcomes.push(outcome));
		expect(host.drainNext()).toMatchObject({ outcomeId: requestId, result: "conflict" });
		expect(outcomes.map((outcome) => outcome.result)).toEqual(["allowed", "conflict"]);
		expect(host.counters()).toMatchObject({ clockReads: 1, evaluations: 1, commits: 1 });
	});

	it("removes cancelled work instead of leaving stale pending drain slots", () => {
		const limitedRequest = request("fixed-window", "cancelled");
		const policy = fixedPolicy(limitedRequest);
		const host = new TestAtomicRateLimitAuthority([policy], [0]);
		const cancelled = buildInstance(host, "cancelled-graph");
		cancelled.requests.down([["DATA", limitedRequest]]);
		expect(host.pending).toHaveLength(1);
		cancelled.release();
		expect(host.pending).toEqual([]);
		const live = buildInstance(host, "live-after-cancel");
		live.requests.down([["DATA", request("fixed-window", "live-after-cancel")]]);
		expect(host.drainNext()?.result).toBe("allowed");
		live.release();
	});
});

describe("B111.6 deterministic multi-instance evidence", () => {
	const cases: readonly {
		readonly name: AlgorithmKind;
		readonly createPolicy: (seed: KeyedRateLimitRequest) => KeyedRateLimitReferencePolicy;
	}[] = [
		{
			name: "fixed-window",
			createPolicy: (seed) => fixedPolicy(seed, 2),
		},
		{
			name: "sliding-window",
			createPolicy: (seed) => slidingPolicy(seed, 2),
		},
		{
			name: "token-bucket",
			createPolicy: (seed) => tokenPolicy(seed, 2, 2),
		},
	];

	for (const testCase of cases) {
		for (const order of ["first-second", "second-first"] as const) {
			it(`${testCase.name} preserves capacity under ${order} atomic ordering`, () => {
				const firstRequest = request(testCase.name, `${testCase.name}-instance-a`, 2);
				const secondRequest = request(testCase.name, `${testCase.name}-instance-b`, 2);
				const policy = testCase.createPolicy(firstRequest);
				const host = new TestAtomicRateLimitAuthority([policy], [0, 0]);
				const first = buildInstance(host, `${testCase.name}-graph-a`);
				const second = buildInstance(host, `${testCase.name}-graph-b`);
				first.requests.down([["DATA", firstRequest]]);
				second.requests.down([["DATA", secondRequest]]);
				expect(host.pending).toHaveLength(2);
				if (order === "first-second") {
					host.drainNext(0);
					host.drainNext(0);
				} else {
					host.drainNext(1);
					host.drainNext(0);
				}
				const outcomes = [...first.outcomes.values, ...second.outcomes.values];
				expect(outcomes.filter((outcome) => outcome.result === "allowed")).toHaveLength(1);
				expect(outcomes.filter((outcome) => outcome.result === "denied")).toHaveLength(1);
				expect(host.counters()).toMatchObject({
					receiptLookups: 2,
					clockReads: 2,
					evaluations: 2,
					commits: 2,
				});
				expect(host.snapshot().states).toHaveLength(1);
				first.release();
				second.release();
			});
		}
	}

	it("coalesces equal-millisecond sliding consumption shared by two instances", () => {
		const firstRequest = request("sliding-window", "sliding-coalesce-a");
		const secondRequest = request("sliding-window", "sliding-coalesce-b");
		const policy = slidingPolicy(firstRequest, 4);
		const host = new TestAtomicRateLimitAuthority([policy], [50, 50, 50]);
		const first = buildInstance(host, "sliding-coalesce-graph-a");
		const second = buildInstance(host, "sliding-coalesce-graph-b");
		first.requests.down([["DATA", firstRequest]]);
		second.requests.down([["DATA", secondRequest]]);
		host.drainNext(1);
		host.drainNext(0);
		expect(first.outcomes.values.at(-1)?.result).toBe("allowed");
		expect(second.outcomes.values.at(-1)?.result).toBe("allowed");
		expect(host.snapshot().states).toMatchObject([
			{
				algorithm: "sliding-window-v1",
				usedUnits: 2,
				entries: [{ atMs: 50, units: 2 }],
			},
		]);
		const denied = request("sliding-window", "sliding-coalesce-denied", 3);
		first.requests.down([["DATA", denied]]);
		expect(host.drainNext()?.result).toBe("denied");
		expect(host.snapshot().states).toMatchObject([
			{
				usedUnits: 2,
				entries: [{ atMs: 50, units: 2 }],
			},
		]);
		first.release();
		second.release();
	});

	it("conflicts changed material before policy, state, clock, or evaluator access", () => {
		const firstRequest = request("fixed-window", "cross-instance-conflict", 1, "operation-a");
		const changedMaterial = request("fixed-window", "cross-instance-conflict", 2, "operation-b");
		const policy = fixedPolicy(firstRequest, 5);
		const host = new TestAtomicRateLimitAuthority([policy], [0]);
		const first = buildInstance(host, "conflict-graph-a");
		const second = buildInstance(host, "conflict-graph-b");
		first.requests.down([["DATA", firstRequest]]);
		second.requests.down([["DATA", changedMaterial]]);
		host.drainNext(0);
		host.drainNext(0);
		expect(first.outcomes.values.at(-1)?.result).toBe("allowed");
		expect(second.outcomes.values.at(-1)?.result).toBe("conflict");
		expect(host.counters()).toEqual({
			receiptLookups: 2,
			policyResolutions: 1,
			stateLoads: 1,
			clockReads: 1,
			evaluations: 1,
			commits: 1,
		});
		first.release();
		second.release();
	});

	it("keeps quota replay idempotent without claiming protected-effect exactly-once", () => {
		const replayedRequest = request("fixed-window", "cross-instance-replay");
		const policy = fixedPolicy(replayedRequest, 1);
		const host = new TestAtomicRateLimitAuthority([policy], [0]);
		const first = buildInstance(host, "replay-graph-a");
		const second = buildInstance(host, "replay-graph-b");
		first.requests.down([["DATA", replayedRequest]]);
		second.requests.down([["DATA", replayedRequest]]);
		host.drainNext(0);
		host.drainNext(0);
		expect(host.counters()).toMatchObject({
			receiptLookups: 2,
			clockReads: 1,
			evaluations: 1,
			commits: 1,
		});
		expect(first.admissions.values).toHaveLength(1);
		expect(second.admissions.values).toHaveLength(1);
		expect(first.protectedEffects()).toBe(1);
		expect(second.protectedEffects()).toBe(1);
		first.release();
		second.release();
	});
});

describe("B111.6 inspection and injected-authority evidence", () => {
	it("keeps evaluator, receipt image, store, and clock outside describe/observe/profile", () => {
		const limitedRequest = request("fixed-window", "inspection");
		const policy = fixedPolicy(limitedRequest);
		const host = new TestAtomicRateLimitAuthority([policy], [0]);
		const instance = buildInstance(host, "inspection-graph", { profile: true });
		const before = instance.g.describe();
		const observedEvents: ObserveEvent[] = [];
		const stopObserving = instance.g.observe().subscribe((event) => {
			observedEvents.push(event);
		});
		instance.requests.down([["DATA", limitedRequest]]);
		host.drainNext();
		const after = instance.g.describe();
		const topology = (snapshot: typeof after) => ({
			nodes: snapshot.nodes.map(({ id, factory, deps }) => ({ id, factory, deps })),
			edges: snapshot.edges,
		});
		expect(topology(after)).toEqual(topology(before));
		const edge = (from: string, to: string) =>
			after.edges.some((candidate) => candidate.from === from && candidate.to === to);
		expect(edge("requests", "authority/events")).toBe(true);
		expect(edge("authority/correlation-facts", "authority/admission/runtime")).toBe(true);
		expect(edge("authority/admission/admissions", "protected-effect")).toBe(true);
		expect(edge("requests", "authority/admission/runtime")).toBe(false);
		expect(edge("requests", "protected-effect")).toBe(false);

		const nodeIds = new Set(after.nodes.map((node) => node.id));
		expect([...nodeIds].sort()).toEqual(
			[
				"authority/admission/admissions",
				"authority/admission/audit",
				"authority/admission/cursor",
				"authority/admission/denials",
				"authority/admission/issues",
				"authority/admission/runtime",
				"authority/admission/status",
				"authority/authority-requests",
				"authority/correlation-facts",
				"authority/cursor",
				"authority/errors",
				"authority/events",
				"authority/outcomes",
				"authority/status",
				"protected-effect",
				"requests",
			].sort(),
		);
		expect(observedEvents.length).toBeGreaterThan(0);
		expect(observedEvents.every((event) => nodeIds.has(event.path))).toBe(true);
		const observedMaterial = JSON.stringify(observedEvents);
		expect(observedMaterial).toContain("graphrefly.keyedRateLimitRequest");
		expect(observedMaterial).toContain("graphrefly.keyedRateLimitOutcome");
		expect(observedMaterial).not.toContain(TEST_ATOMIC_HOST_FORMAT);
		expect(observedMaterial).not.toContain('"receipts"');
		expect(observedMaterial).not.toContain('"states"');
		const profile = instance.g.profile();
		expect(Object.keys(profile.nodes).every((path) => nodeIds.has(path))).toBe(true);
		const inspectionKeys = JSON.stringify({
			nodes: after.nodes.map(({ id, factory }) => ({ id, factory })),
			profile: Object.keys(profile.nodes),
		});
		for (const forbidden of [
			"evaluateFixedWindowRateLimitTransition",
			"TestAtomicRateLimitAuthority",
			"receipt-image",
			"clock",
			"store-client",
		]) {
			expect(inspectionKeys).not.toContain(forbidden);
		}
		expect(host.counters()).toMatchObject({ clockReads: 1, evaluations: 1, commits: 1 });
		stopObserving();
		instance.release();
	});

	it("accepts a custom host algorithm without a reference evaluator or registry", () => {
		const receipts = new Map<string, KeyedRateLimitOutcome>();
		const availableByAuthority = new Map<string, number>();
		let mutations = 0;
		const customAuthority: KeyedRateLimitAuthority = {
			consume(req, complete) {
				const authorityKey = canonicalTupleKey([
					req.authority.kind,
					req.authority.id,
					req.authority.revision,
				]);
				const receiptKey = canonicalTupleKey([authorityKey, req.requestId]);
				const prior = receipts.get(receiptKey);
				if (prior !== undefined) {
					if (prior.requestIdentity.key === keyedRateLimitRequestIdentity(req).key) complete(prior);
					else {
						complete(
							createKeyedRateLimitOutcome(req, {
								outcomeId: "custom-conflict",
								result: "conflict",
								provenance: [req.authority],
							}),
						);
					}
					return;
				}
				let available = availableByAuthority.get(authorityKey) ?? 1;
				const allowed = req.units <= available;
				if (allowed) available -= req.units;
				availableByAuthority.set(authorityKey, available);
				mutations += 1;
				const outcome = createKeyedRateLimitOutcome(req, {
					outcomeId: `custom-outcome-${mutations}`,
					result: allowed ? "allowed" : "denied",
					remainingUnits: available,
					resetAtMs: null,
					retryAfterMs: allowed ? null : 1,
					provenance: [req.authority],
				});
				receipts.set(receiptKey, outcome);
				complete(outcome);
			},
		};
		const allowed = request("host-custom", "custom-allowed");
		const secondaryAllowed = assertKeyedRateLimitRequest({
			...allowed,
			authority: { ...allowed.authority, id: "secondary" },
		});
		const denied = request("host-custom", "custom-denied");
		const conflict = request("host-custom", "custom-allowed", 2, "changed-operation");
		const primary = buildInstance(customAuthority, "custom-authority-primary");
		const secondary = buildInstance(customAuthority, "custom-authority-secondary");
		primary.requests.down([
			["DATA", allowed],
			["DATA", allowed],
			["DATA", denied],
			["DATA", conflict],
		]);
		secondary.requests.down([["DATA", secondaryAllowed]]);
		expect(primary.outcomes.values.map((outcome) => outcome.result)).toEqual([
			"allowed",
			"allowed",
			"denied",
			"conflict",
		]);
		expect(secondary.outcomes.values.map((outcome) => outcome.result)).toEqual(["allowed"]);
		expect(primary.admissions.values).toHaveLength(1);
		expect(secondary.admissions.values).toHaveLength(1);
		expect(primary.denials.values).toHaveLength(1);
		expect(mutations).toBe(3);
		const topology = primary.g.describe();
		expect(topology.nodes.find((node) => node.id === "authority/events")?.factory).toBe(
			"attachKeyedRateLimitAuthority",
		);
		expect(topology.nodes.find((node) => node.id === "authority/admission/runtime")?.factory).toBe(
			"keyedRateLimitAdmission",
		);
		expect(
			secondary.g.describe().nodes.map(({ id, factory, deps }) => ({ id, factory, deps })),
		).toEqual(topology.nodes.map(({ id, factory, deps }) => ({ id, factory, deps })));
		primary.release();
		secondary.release();
	});
});
