import { expect, it } from "vitest";
import {
	proofEvaluation,
	proofScenarios,
} from "../../../../scripts/fixtures/spending-proof-scenarios.js";
import {
	expectedAdmission,
	expectedBusiness,
	expectedRequest,
	type ProofExpectation,
	type ProofTrace,
	proofCanonical,
	proofFacts,
	proofHash,
	verifyCandidate,
	verifyProofTrace,
} from "../../../../scripts/fixtures/spending-proof-verifier.js";

const binding = {
	packRef: { kind: "proof-pack", id: "finite" },
	sourceDigest: proofHash("candidate source"),
	runtimeDigest: proofHash("candidate runtime"),
	destinationRef: { kind: "proof-destination", id: "offline" },
	compositionEpoch: 1,
	hostEpoch: 1,
	runRef: "proof-test",
	evidenceMode: "fixture-observations" as const,
};
function example(outcome: "succeeded" | "unknown" | "pending" = "succeeded") {
	const e = proofEvaluation();
	const request = expectedRequest(e, binding)!;
	const facts = proofFacts(e, binding);
	const admission = expectedAdmission(
		e,
		binding,
		facts.verification.receipts[0].receiptRef,
		facts.local.grants[0].grantRef,
	);
	const { state: _state, ...identity } = admission;
	const result =
		outcome === "succeeded"
			? { kind: "ok" as const, value: { io: false } }
			: {
					kind: "error" as const,
					error: { kind: "issue" as const, code: "short", message: "partial write" },
				};
	const trace: ProofTrace = {
		candidates: [{ evaluationRef: e.evaluationRef, business: expectedBusiness(e), request }],
		attemptedPayloads: [`${request.body.payloadText}\n`],
		records: [
			{
				request,
				admission,
				...(outcome === "pending" ? {} : { outcome: { ...identity, state: outcome, result } }),
			},
		],
		normalEndReady: outcome === "succeeded",
	};
	const expected: ProofExpectation = {
		business: "match",
		attempts: [
			{
				evaluationRef: e.evaluationRef,
				outcome,
				readback: outcome === "succeeded" ? "full" : outcome === "unknown" ? 1 : 0,
			},
		],
		normalEndReady: outcome === "succeeded",
	};
	const bytes = Buffer.from(trace.attemptedPayloads[0]);
	return {
		e,
		request,
		trace,
		expected,
		readback: {
			before: Buffer.alloc(0),
			after:
				outcome === "succeeded"
					? bytes
					: outcome === "unknown"
						? bytes.subarray(0, 1)
						: Buffer.alloc(0),
		},
	};
}

it("D171 independent S1 oracle distinguishes actual sample and population consequences", () => {
	const e = proofEvaluation({ threshold: 1.1 });
	const correct = expectedBusiness(e);
	expect(correct.score.zScore).toBe(1);
	expect(correct.flagged).toBe(false);
	expect(expectedRequest(e, binding)).toBeUndefined();
	expect(verifyCandidate(e, binding, { business: correct, request: null }).passed).toBe(true);
	const population = {
		...correct,
		score: { ...correct.score, zScore: Math.sqrt(1.5) },
		flagged: true,
	};
	expect(verifyCandidate(e, binding, { business: population, request: null }).passed).toBe(false);
});

it("D171 independently reconstructs exact business formatting and canonical payload", () => {
	const e = proofEvaluation();
	const result = expectedBusiness(e);
	expect(result.message).toBe(
		"Transaction proof-coffee-1:tx2 flagged — severity: low.\nVendor: coffee  Amount: $3.00  Category: coffee\nReasoning:\n  • Amount is 1.00σ above this vendor's historical mean.",
	);
	const material = expectedRequest(e, binding)!;
	expect(material.body.payloadText).toBe(
		'{"message":"Transaction proof-coffee-1:tx2 flagged — severity: low.\\nVendor: coffee  Amount: $3.00  Category: coffee\\nReasoning:\\n  • Amount is 1.00σ above this vendor\'s historical mean.","severity":"low","transactionId":"proof-coffee-1:tx2","vendor":"coffee"}',
	);
	expect(material.requestRef.kind).toBe("spending-alerts/request-material/v1");
	expect(verifyCandidate(e, binding, { business: result, request: material }).passed).toBe(true);
	const altered = {
		...material,
		body: { ...material.body, payloadText: `${material.body.payloadText} ` },
	};
	expect(verifyCandidate(e, binding, { business: result, request: altered }).passed).toBe(false);
	expect(
		verifyCandidate(e, { ...binding, hostEpoch: 2 }, { business: result, request: material })
			.passed,
	).toBe(false);
});

it("numeric tolerance cannot excuse crossing a strict business threshold", () => {
	const e = proofEvaluation({ threshold: 1 });
	const business = expectedBusiness(e);
	expect(business.flagged).toBe(false);
	const inconsistent = { ...business, score: { ...business.score, zScore: 1 + 5e-11 } };
	expect(verifyCandidate(e, binding, { business: inconsistent, request: null }).passed).toBe(false);
});

it("proof encoding rejects getters, cycles, sparse arrays and non-finite values", () => {
	let reads = 0;
	const getter = {
		get hidden() {
			reads++;
			return 1;
		},
	};
	expect(() => proofCanonical(getter)).toThrow();
	expect(reads).toBe(0);
	const cycle: { self?: unknown } = {};
	cycle.self = cycle;
	for (const value of [cycle, [Number.NaN], new Array(2), { x: undefined }])
		expect(() => proofCanonical(value)).toThrow();
	expect(proofCanonical({ z: 1, a: [true, "中文", null] })).toBe('{"a":[true,"中文",null],"z":1}');
});

it("success labels and journals cannot substitute for independently supplied readback or transport bytes", () => {
	const f = example();
	expect(verifyProofTrace([f.e], binding, f.expected, f.trace, f.readback).passed).toBe(true);
	expect(
		verifyProofTrace([f.e], binding, f.expected, f.trace, {
			before: Buffer.alloc(0),
			after: Buffer.alloc(0),
		}).passed,
	).toBe(false);
	expect(
		verifyProofTrace([f.e], binding, f.expected, { ...f.trace, attemptedPayloads: [] }, f.readback)
			.passed,
	).toBe(false);
	expect(
		verifyProofTrace(
			[f.e],
			binding,
			f.expected,
			{
				...f.trace,
				attemptedPayloads: [...f.trace.attemptedPayloads, ...f.trace.attemptedPayloads],
			},
			f.readback,
		).passed,
	).toBe(false);
	expect(
		verifyProofTrace([f.e], binding, f.expected, f.trace, {
			before: Buffer.from("preexisting"),
			after: f.readback.after,
		}).passed,
	).toBe(false);
	expect(
		verifyProofTrace([f.e], binding, f.expected, f.trace, {
			before: Buffer.from("preexisting"),
			after: Buffer.concat([Buffer.from("preexisting"), f.readback.after]),
		}).passed,
	).toBe(false);
});

it("an exact request cannot accept an outcome from another admission or a duplicated host record", () => {
	const f = example();
	const wrong = {
		...f.trace.records[0],
		outcome: {
			...f.trace.records[0].outcome!,
			admissionRef: { kind: "spending-admission", id: proofHash("other-admission") },
		},
	};
	expect(
		verifyProofTrace([f.e], binding, f.expected, { ...f.trace, records: [wrong] }, f.readback)
			.passed,
	).toBe(false);
	expect(
		verifyProofTrace(
			[f.e],
			binding,
			f.expected,
			{ ...f.trace, records: [...f.trace.records, ...f.trace.records] },
			f.readback,
		).passed,
	).toBe(false);
});

for (const state of ["unknown", "pending"] as const)
	it(`${state} remains distinct from success despite retained evidence`, () => {
		const f = example(state);
		expect(verifyProofTrace([f.e], binding, f.expected, f.trace, f.readback).passed).toBe(true);
		expect(
			verifyProofTrace([f.e], binding, f.expected, { ...f.trace, normalEndReady: true }, f.readback)
				.passed,
		).toBe(false);
		expect(
			verifyProofTrace(
				[f.e],
				binding,
				{ ...f.expected, attempts: [{ ...f.expected.attempts[0], outcome: "succeeded" }] },
				f.trace,
				f.readback,
			).passed,
		).toBe(false);
	});

it("final success cannot conceal an early transport call before the verifier checkpoint", () => {
	const f = example();
	const checkpoints = [{ label: "before-receipt", attemptedCalls: 0 }];
	const expected = { ...f.expected, checkpoints };
	expect(
		verifyProofTrace([f.e], binding, expected, { ...f.trace, checkpoints }, f.readback).passed,
	).toBe(true);
	expect(
		verifyProofTrace(
			[f.e],
			binding,
			expected,
			{ ...f.trace, checkpoints: [{ label: "before-receipt", attemptedCalls: 1 }] },
			f.readback,
		).passed,
	).toBe(false);
	expect(verifyProofTrace([f.e], binding, expected, f.trace, f.readback).passed).toBe(false);
});

it("host success and readback cannot settle a recipient that rejected a wrong admission outcome", () => {
	const f = example();
	const { state: _state, admissionRef: _ref, ...proposal } = f.trace.records[0].admission;
	const expected: ProofExpectation = {
		...f.expected,
		normalEndReady: false,
		authority: [{ evaluationRef: f.e.evaluationRef, outcome: "pending", lifecycle: false }],
	};
	const trace: ProofTrace = {
		...f.trace,
		normalEndReady: false,
		effects: [{ proposal, admission: f.trace.records[0].admission }],
		obligations: [
			{
				revisionDomain: f.e.occurrence.revisionDomain,
				evaluatedThroughRevision: 1,
				lifecycle: false,
				retainedEvidence: false,
			},
		],
	};
	expect(verifyProofTrace([f.e], binding, expected, trace, f.readback).passed).toBe(true);
	expect(
		verifyProofTrace(
			[f.e],
			binding,
			expected,
			{ ...trace, effects: [{ ...trace.effects![0], outcome: f.trace.records[0].outcome }] },
			f.readback,
		).passed,
	).toBe(false);
});

it("missing terminal keeps lifecycle pending even when actual business and effect succeeded", () => {
	const f = example();
	const { state: _state, admissionRef: _ref, ...proposal } = f.trace.records[0].admission;
	const expected: ProofExpectation = {
		...f.expected,
		normalEndReady: false,
		authority: [{ evaluationRef: f.e.evaluationRef, outcome: "succeeded", lifecycle: false }],
	};
	const trace: ProofTrace = {
		...f.trace,
		normalEndReady: false,
		effects: [
			{ proposal, admission: f.trace.records[0].admission, outcome: f.trace.records[0].outcome },
		],
		obligations: [
			{
				revisionDomain: f.e.occurrence.revisionDomain,
				evaluatedThroughRevision: 1,
				lifecycle: false,
				retainedEvidence: false,
			},
		],
	};
	expect(verifyProofTrace([f.e], binding, expected, trace, f.readback).passed).toBe(true);
	expect(
		verifyProofTrace(
			[f.e],
			binding,
			expected,
			{ ...trace, obligations: [{ ...trace.obligations![0], lifecycle: true }] },
			f.readback,
		).passed,
	).toBe(false);
});

it("a missing candidate observation cannot masquerade as a killed semantic mutant", () => {
	const f = example();
	const expected: ProofExpectation = { business: "mismatch", attempts: [], normalEndReady: false };
	expect(
		verifyProofTrace(
			[f.e],
			binding,
			expected,
			{ candidates: [], records: [], attemptedPayloads: [], normalEndReady: false },
			{ before: Buffer.alloc(0), after: Buffer.alloc(0) },
		).passed,
	).toBe(false);
});

it("frozen scenario families include no-mutation controls and passive schedules without live authority", () => {
	const scenarios = proofScenarios(binding);
	expect(new Set(scenarios.map((s) => s.family))).toEqual(
		new Set(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]),
	);
	expect(scenarios.find((s) => s.id === "S1-baseline")?.mutation).toBe("none");
	expect(scenarios.find((s) => s.id === "S2-baseline")?.expected.attempts).toHaveLength(1);
	expect(Object.isFrozen(scenarios)).toBe(true);
	expect(Object.isFrozen(scenarios[0].steps)).toBe(true);
	expect(Object.isFrozen(scenarios[0].evaluations[0].prefix)).toBe(true);
	expect(proofCanonical(scenarios)).toContain("S6-unreturned");
});
