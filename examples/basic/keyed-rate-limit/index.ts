/**
 * B111.7 keyed externally authoritative rate-limit example.
 *
 * Run:
 *   pnpm --filter @graphrefly-examples/keyed-rate-limit start
 */
import {
	attachKeyedRateLimitAuthority,
	type KeyedRateLimitAuthority,
} from "@graphrefly/ts/adapters";
import { graph } from "@graphrefly/ts/graph";
import {
	assertKeyedRateLimitRequest,
	createFixedWindowRateLimitPolicy,
	createFixedWindowRateLimitTransitionInput,
	createKeyedRateLimitOutcome,
	createSlidingWindowRateLimitPolicy,
	createSlidingWindowRateLimitTransitionInput,
	createTokenBucketRateLimitPolicy,
	createTokenBucketRateLimitTransitionInput,
	evaluateFixedWindowRateLimitTransition,
	evaluateSlidingWindowRateLimitTransition,
	evaluateTokenBucketRateLimitTransition,
	type KeyedRateLimitAdmission,
	type KeyedRateLimitCoordinate,
	type KeyedRateLimitDenial,
	type KeyedRateLimitOutcome,
	type KeyedRateLimitPolicyCoordinate,
	type KeyedRateLimitReferencePolicy,
	type KeyedRateLimitReferenceState,
	type KeyedRateLimitRequest,
	type KeyedRateLimitTransition,
	keyedRateLimitRequestIdentity,
} from "@graphrefly/ts/rate-limit";
import { ExampleCustomAuthority } from "./custom-authority.js";

function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`keyed-rate-limit example failed: ${message}`);
}

type AlgorithmKind = "fixed-window" | "sliding-window" | "token-bucket";

function request(
	algorithm: AlgorithmKind | "custom",
	requestId: string,
	units = 1,
	authorityId = "authority-a",
): KeyedRateLimitRequest {
	return assertKeyedRateLimitRequest({
		format: "graphrefly.keyedRateLimitRequest",
		version: 1,
		requestId,
		key: { kind: "scope", id: "scope-a", revision: "r1" },
		policy: {
			id: `policy-${algorithm}`,
			revision: "r1",
			algorithm: { kind: algorithm, revision: "r1" },
		},
		authority: { kind: "authority", id: authorityId, revision: "r1" },
		operation: { kind: "operation", id: `operation-${requestId}`, revision: "r1" },
		units,
	});
}

function evaluateReferenceTransition(
	requestValue: KeyedRateLimitRequest,
	policy: KeyedRateLimitReferencePolicy,
	state: KeyedRateLimitReferenceState | null,
	observedAtMs: number,
): KeyedRateLimitTransition {
	switch (policy.algorithm) {
		case "fixed-window-v1":
			return evaluateFixedWindowRateLimitTransition(
				createFixedWindowRateLimitTransitionInput(requestValue, policy, state, observedAtMs),
			);
		case "sliding-window-v1":
			return evaluateSlidingWindowRateLimitTransition(
				createSlidingWindowRateLimitTransitionInput(requestValue, policy, state, observedAtMs),
			);
		case "token-bucket-v1":
			return evaluateTokenBucketRateLimitTransition(
				createTokenBucketRateLimitTransitionInput(requestValue, policy, state, observedAtMs),
			);
	}
}

interface Receipt {
	readonly authority: KeyedRateLimitCoordinate;
	readonly requestId: string;
	readonly requestIdentityKey: string;
	readonly outcome: KeyedRateLimitOutcome;
}

interface AtomicImage {
	readonly state: KeyedRateLimitReferenceState | null;
	readonly receipts: readonly Receipt[];
}

function sameCoordinate(left: KeyedRateLimitCoordinate, right: KeyedRateLimitCoordinate): boolean {
	return left.kind === right.kind && left.id === right.id && left.revision === right.revision;
}

function samePolicyCoordinate(
	left: KeyedRateLimitPolicyCoordinate,
	right: KeyedRateLimitPolicyCoordinate,
): boolean {
	return (
		left.id === right.id &&
		left.revision === right.revision &&
		left.algorithm.kind === right.algorithm.kind &&
		left.algorithm.revision === right.algorithm.revision
	);
}

function policyMatchesRequest(
	policy: KeyedRateLimitReferencePolicy,
	requestValue: KeyedRateLimitRequest,
): boolean {
	return (
		sameCoordinate(policy.scope.key, requestValue.key) &&
		sameCoordinate(policy.scope.authority, requestValue.authority) &&
		samePolicyCoordinate(policy.scope.policy, requestValue.policy)
	);
}

/**
 * Controlled in-memory contract model for the host-owned atomic boundary.
 *
 * It is not a public persistence API and does not certify a database, fsync, process-crash
 * recovery, or real parallel isolation.
 */
class ExampleAtomicAuthority implements KeyedRateLimitAuthority {
	readonly #policies: readonly KeyedRateLimitReferencePolicy[];
	readonly #observations: readonly number[];
	#image: AtomicImage = Object.freeze({ state: null, receipts: Object.freeze([]) });
	#nextObservation = 0;
	#outcomeSequence = 0;
	readonly trace: string[] = [];
	clockReads = 0;
	evaluations = 0;
	commits = 0;

	constructor(policy: KeyedRateLimitReferencePolicy, observations: readonly number[]) {
		this.#policies = Object.freeze([policy]);
		this.#observations = observations;
	}

	consume(
		requestValue: KeyedRateLimitRequest,
		complete: (outcome: KeyedRateLimitOutcome) => void,
	): undefined {
		const requestIdentityKey = keyedRateLimitRequestIdentity(requestValue).key;
		this.trace.push(`receipt:${requestValue.requestId}`);
		const receipt = this.#image.receipts.find(
			(candidate) =>
				candidate.requestId === requestValue.requestId &&
				sameCoordinate(candidate.authority, requestValue.authority),
		);
		if (receipt !== undefined) {
			if (receipt.requestIdentityKey === requestIdentityKey) {
				this.trace.push("replay");
				complete(receipt.outcome);
			} else {
				this.trace.push("conflict");
				complete(
					createKeyedRateLimitOutcome(requestValue, {
						outcomeId: `conflict-${requestValue.requestId}`,
						result: "conflict",
					}),
				);
			}
			return undefined;
		}

		this.trace.push("policy");
		const policy = this.#policies.find((candidate) =>
			policyMatchesRequest(candidate, requestValue),
		);
		if (policy === undefined) {
			this.trace.push("policy-miss");
			complete(
				createKeyedRateLimitOutcome(requestValue, {
					outcomeId: `unavailable-${requestValue.requestId}`,
					result: "unavailable",
				}),
			);
			return undefined;
		}
		this.trace.push("state");
		const state = this.#image.state;
		this.trace.push("clock");
		const observedAtMs = this.#observations[this.#nextObservation];
		check(observedAtMs !== undefined, "the example authority needs another observation");
		this.#nextObservation += 1;
		this.clockReads += 1;
		this.trace.push("evaluate");
		const transition = evaluateReferenceTransition(requestValue, policy, state, observedAtMs);
		this.evaluations += 1;
		const outcome = createKeyedRateLimitOutcome(requestValue, {
			outcomeId: `outcome-${++this.#outcomeSequence}`,
			result: transition.result,
			remainingUnits: transition.remainingUnits,
			resetAtMs: transition.resetAtMs,
			retryAfterMs: transition.retryAfterMs,
		});

		this.trace.push("commit");
		const receipts = Object.freeze([
			...this.#image.receipts,
			{
				authority: requestValue.authority,
				requestId: requestValue.requestId,
				requestIdentityKey,
				outcome,
			},
		]);
		this.#image = Object.freeze({ state: transition.nextState, receipts });
		this.commits += 1;
		complete(outcome);
		return undefined;
	}
}

function attachGovernedConsumer(
	name: string,
	authority: KeyedRateLimitAuthority,
	initialRequest: KeyedRateLimitRequest,
) {
	const g = graph({ name });
	const requests = g.state(initialRequest, { name: `${name}/requests` });
	const adapter = attachKeyedRateLimitAuthority(g, requests, authority, {
		name: `${name}/authority`,
		maxInFlight: 4,
		maxCompleted: 8,
	});
	const admissionFacts: KeyedRateLimitAdmission[] = [];
	const protectedExecutions: string[] = [];
	const applicationEffectReceipts = new Set<string>();
	const denials: KeyedRateLimitDenial[] = [];
	const protectedEffect = g.effect(
		[adapter.admission.admissions],
		(admission) => {
			// This placeholder effect reads only admissions. The local Set demonstrates the separate
			// application-owned effect-receipt boundary; it makes no durability claim.
			if (applicationEffectReceipts.has(admission.admissionId)) return;
			applicationEffectReceipts.add(admission.admissionId);
			protectedExecutions.push(admission.admissionId);
		},
		{ name: `${name}/protected-effect` },
	);
	const stopEffect = protectedEffect.subscribe(() => undefined);
	const stopAdmissions = adapter.admission.admissions.subscribe((message) => {
		if (message[0] === "DATA") admissionFacts.push(message[1] as KeyedRateLimitAdmission);
	});
	const stopDenials = adapter.admission.denials.subscribe((message) => {
		if (message[0] === "DATA") denials.push(message[1] as KeyedRateLimitDenial);
	});
	return {
		graph: g,
		requests,
		admissionFacts,
		protectedExecutions,
		denials,
		stop: () => {
			stopDenials();
			stopAdmissions();
			stopEffect();
		},
	};
}

function assertGovernedTopology(consumer: ReturnType<typeof attachGovernedConsumer>): void {
	const snapshot = consumer.graph.describe();
	const id = (name: string): string => {
		const nodeId = snapshot.nodes.find((node) => node.name === name)?.id;
		check(nodeId !== undefined, `missing topology node ${name}`);
		return nodeId;
	};
	const hasEdge = (from: string, to: string): boolean =>
		snapshot.edges.some((edge) => edge.from === from && edge.to === to);
	const prefix = snapshot.name;
	check(prefix !== undefined, "consumer graph needs a name");
	const requests = id(`${prefix}/requests`);
	const events = id(`${prefix}/authority/events`);
	const correlation = id(`${prefix}/authority/correlation-facts`);
	const runtime = id(`${prefix}/authority/admission/runtime`);
	const admissions = id(`${prefix}/authority/admission/admissions`);
	const effect = id(`${prefix}/protected-effect`);

	check(hasEdge(requests, events), "raw requests must enter the bounded authority adapter");
	check(hasEdge(events, correlation), "adapter outcomes must enter the correlation lane");
	check(hasEdge(correlation, runtime), "the gate must read only correlated authority facts");
	check(hasEdge(runtime, admissions), "valid allowed outcomes must project admissions");
	check(hasEdge(admissions, effect), "the protected effect must read only admissions");
	check(!hasEdge(requests, runtime), "raw requests must not bypass the bounded adapter");
	check(!hasEdge(requests, effect), "raw requests must not bypass admission");
}

function runHostIntegration(): void {
	const first = request("fixed-window", "request-a");
	const policy = createFixedWindowRateLimitPolicy(first, {
		stateRevision: "state-r1",
		capacityUnits: 1,
		windowMs: 1_000,
	});
	const authority = new ExampleAtomicAuthority(policy, [100, 100]);
	const firstConsumer = attachGovernedConsumer("consumer-a", authority, first);
	check(
		authority.trace.join(",") === "receipt:request-a,policy,state,clock,evaluate,commit",
		"first consume must follow receipt-first host ordering",
	);
	check(firstConsumer.admissionFacts.length === 1, "an allowed outcome must admit once");
	check(firstConsumer.protectedExecutions.length === 1, "the protected effect must execute once");
	assertGovernedTopology(firstConsumer);

	const beforeFreshReplay = authority.trace.length;
	const secondConsumer = attachGovernedConsumer("consumer-b", authority, first);
	check(
		authority.trace.slice(beforeFreshReplay).join(",") === "receipt:request-a,replay",
		"identical replay must skip policy, state, clock, evaluator, and commit",
	);
	check(
		authority.clockReads === 1 && authority.evaluations === 1 && authority.commits === 1,
		"identical replay must not advance authoritative material",
	);
	check(
		secondConsumer.admissionFacts.length === 1,
		"a fresh live gate may admit a stored quota outcome independently",
	);
	check(
		secondConsumer.protectedExecutions.length === 1,
		"a fresh consumer has an independent application effect-receipt boundary",
	);

	const beforeLiveReplay = authority.trace.length;
	firstConsumer.requests.set(first);
	check(
		authority.trace.slice(beforeLiveReplay).join(",") === "receipt:request-a,replay",
		"same-live-gate replay must still be receipt-first",
	);
	check(
		firstConsumer.admissionFacts.length === 1,
		"the retained live gate must suppress a second admission occurrence",
	);
	check(
		firstConsumer.protectedExecutions.length === 1,
		"the retained live gate must prevent repeat protected execution",
	);

	const beforeConflict = authority.trace.length;
	firstConsumer.requests.set(request("fixed-window", "request-a", 2));
	check(
		authority.trace.slice(beforeConflict).join(",") === "receipt:request-a,conflict",
		"different material under one request id must conflict before all other host work",
	);
	check(
		authority.clockReads === 1 && authority.evaluations === 1 && authority.commits === 1,
		"conflict must not advance authoritative material",
	);

	firstConsumer.requests.set(request("fixed-window", "request-b"));
	check(
		firstConsumer.denials.length === 1,
		"a valid exhausted quota outcome must be a ready denial",
	);
	check(
		firstConsumer.protectedExecutions.length === 1,
		"the protected effect must not run for a denial",
	);

	const beforeMissingPolicy = authority.trace.length;
	const missingPolicyConsumer = attachGovernedConsumer(
		"consumer-missing-policy",
		authority,
		request("fixed-window", "request-missing-policy", 1, "authority-b"),
	);
	check(
		authority.trace.slice(beforeMissingPolicy).join(",") ===
			"receipt:request-missing-policy,policy,policy-miss",
		"an absent exact policy must fail closed before state, clock, or evaluation",
	);
	check(
		`${authority.clockReads},${authority.evaluations},${authority.commits}` === "2,2,2",
		"a missing exact policy must not advance authoritative material",
	);

	missingPolicyConsumer.stop();
	firstConsumer.stop();
	secondConsumer.stop();
}

function runEvaluatorExamples(): void {
	const fixedRequest = request("fixed-window", "fixed-a", 2);
	const fixedPolicy = createFixedWindowRateLimitPolicy(fixedRequest, {
		stateRevision: "state-r1",
		capacityUnits: 2,
		windowMs: 1_000,
	});
	const fixedAtEndMinusOne = evaluateFixedWindowRateLimitTransition(
		createFixedWindowRateLimitTransitionInput(fixedRequest, fixedPolicy, null, 999),
	);
	const fixedAtEnd = evaluateFixedWindowRateLimitTransition(
		createFixedWindowRateLimitTransitionInput(
			request("fixed-window", "fixed-b"),
			fixedPolicy,
			fixedAtEndMinusOne.nextState,
			1_000,
		),
	);
	const fixedPermanent = evaluateFixedWindowRateLimitTransition(
		createFixedWindowRateLimitTransitionInput(
			request("fixed-window", "fixed-c", 3),
			fixedPolicy,
			fixedAtEnd.nextState,
			1_000,
		),
	);
	check(fixedAtEnd.result === "allowed", "the half-open end must start the next epoch window");
	check(
		fixedPermanent.result === "denied" && fixedPermanent.retryAfterMs === null,
		"units above fixed-window capacity must be a permanent valid denial",
	);

	const slidingRequest = request("sliding-window", "sliding-a");
	const slidingPolicy = createSlidingWindowRateLimitPolicy(slidingRequest, {
		stateRevision: "state-r1",
		capacityUnits: 3,
		windowMs: 1_000,
		maxEntries: 4,
	});
	const slidingFirst = evaluateSlidingWindowRateLimitTransition(
		createSlidingWindowRateLimitTransitionInput(slidingRequest, slidingPolicy, null, 1_000),
	);
	const slidingCoalesced = evaluateSlidingWindowRateLimitTransition(
		createSlidingWindowRateLimitTransitionInput(
			request("sliding-window", "sliding-b"),
			slidingPolicy,
			slidingFirst.nextState,
			1_000,
		),
	);
	const slidingAtCutoff = evaluateSlidingWindowRateLimitTransition(
		createSlidingWindowRateLimitTransitionInput(
			request("sliding-window", "sliding-c"),
			slidingPolicy,
			slidingCoalesced.nextState,
			2_000,
		),
	);
	check(
		slidingCoalesced.nextState.entries.length === 1 &&
			slidingCoalesced.nextState.entries[0]?.units === 2,
		"equal-millisecond successful sliding consumption must coalesce",
	);
	check(
		slidingAtCutoff.nextState.entries.length === 1 &&
			slidingAtCutoff.nextState.entries[0]?.atMs === 2_000,
		"sliding entries at the exact cutoff must expire",
	);

	const tokenRequest = request("token-bucket", "token-a");
	const tokenPolicy = createTokenBucketRateLimitPolicy(tokenRequest, {
		stateRevision: "state-r1",
		capacityUnits: 5,
		refillUnits: 2,
		refillPeriodMs: 3,
		initialUnits: 0,
	});
	const tokenDenied = evaluateTokenBucketRateLimitTransition(
		createTokenBucketRateLimitTransitionInput(tokenRequest, tokenPolicy, null, 0),
	);
	const tokenWithRemainder = evaluateTokenBucketRateLimitTransition(
		createTokenBucketRateLimitTransitionInput(
			request("token-bucket", "token-b"),
			tokenPolicy,
			tokenDenied.nextState,
			2,
		),
	);
	const tokenSaturated = evaluateTokenBucketRateLimitTransition(
		createTokenBucketRateLimitTransitionInput(
			request("token-bucket", "token-c"),
			tokenPolicy,
			tokenWithRemainder.nextState,
			20,
		),
	);
	check(
		tokenDenied.result === "denied" && tokenDenied.nextState.lastObservedAtMs === 0,
		"a valid token-bucket denial must still return advanced state",
	);
	check(
		tokenWithRemainder.nextState.refillRemainder === 1,
		"token-bucket rational refill must persist its remainder",
	);
	check(
		tokenSaturated.nextState.availableUnits === 4 && tokenSaturated.nextState.refillRemainder === 0,
		"token-bucket saturation must discard excess credit and remainder before consumption",
	);
}

function runCustomAuthorityExample(): void {
	const custom = request("custom", "custom-a");
	const authority = new ExampleCustomAuthority();
	const consumer = attachGovernedConsumer("custom-consumer", authority, custom);
	// The admission-only effect activates the lazy topology first. Emit a second request after the
	// denial projection is subscribed so the runnable example can inspect its ready denial.
	consumer.requests.set(request("custom", "custom-b"));
	check(consumer.denials.length === 1, "a custom authority may supply a valid denial");
	check(
		consumer.protectedExecutions.length === 0,
		"custom denial must not reach the protected effect",
	);
	const otherAuthority = attachGovernedConsumer(
		"custom-other-authority",
		authority,
		request("custom", "custom-seed-b", 1, "authority-b"),
	);
	otherAuthority.requests.set(request("custom", "custom-a", 1, "authority-b"));
	check(
		otherAuthority.denials.length === 1,
		"one request id under a different authority coordinate must use an independent receipt namespace",
	);
	otherAuthority.stop();
	consumer.stop();
}

runHostIntegration();
runEvaluatorExamples();
runCustomAuthorityExample();
console.log("keyed-rate-limit example: all deterministic checks passed");
