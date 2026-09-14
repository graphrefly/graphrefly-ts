/** D171 independent passive proof verifier. No candidate computation, coordination or material helpers. */
import { createHash } from "node:crypto";
import type {
	Evaluation,
	SpendingBinding,
	VerificationReceipt,
} from "../../examples/spending-alerts/causal-inputs.js";
import type {
	CausalEffectAdmission,
	CausalEffectOutcome,
	CausalEffectProposal,
	CausalSourceRef,
} from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import { referenceFixed, referenceNumbers } from "./spending-numeric-oracle.js";

/** Independent schema encoding: sorted own enumerable data keys, finite JSON, no accessors. */
export function proofCanonical(input: unknown): string {
	const active = new Set<object>();
	function encode(value: unknown, depth: number): string {
		if (depth > 64) throw new TypeError("proof nesting limit");
		if (value === null || typeof value === "boolean") return String(value);
		if (typeof value === "number") {
			if (!Number.isFinite(value)) throw new TypeError("proof nonfinite number");
			return JSON.stringify(value);
		}
		if (typeof value === "string") {
			if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))
				throw new TypeError("proof unpaired surrogate");
			return JSON.stringify(value);
		}
		if (typeof value !== "object" || active.has(value)) throw new TypeError("proof non-data value");
		const array = Array.isArray(value);
		const proto = Object.getPrototypeOf(value);
		if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
			throw new TypeError("proof non-data prototype");
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const keys = Reflect.ownKeys(descriptors);
		if (keys.some((key) => typeof key !== "string")) throw new TypeError("proof symbol");
		const names = (keys as string[]).filter((key) => !array || key !== "length");
		if (array && (names.length !== value.length || names.some((key, i) => key !== String(i))))
			throw new TypeError("proof sparse or extended array");
		active.add(value);
		const parts = (array ? names : names.sort()).map((key) => {
			const descriptor = descriptors[key];
			if (!("value" in descriptor) || !descriptor.enumerable) throw new TypeError("proof accessor");
			const item = encode(descriptor.value, depth + 1);
			return array ? item : `${encode(key, depth + 1)}:${item}`;
		});
		active.delete(value);
		return array ? `[${parts.join(",")}]` : `{${parts.join(",")}}`;
	}
	const text = encode(input, 0);
	if (Buffer.byteLength(text) > 4 * 1048576) throw new TypeError("proof byte limit");
	return text;
}
export function proofHash(bytes: string | Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
export function proofFreeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) proofFreeze(child);
		Object.freeze(value);
	}
	return value;
}
const same = (a: unknown, b: unknown) => proofCanonical(a) === proofCanonical(b);

export function expectedBusiness(raw: Evaluation) {
	const e = JSON.parse(proofCanonical(raw)) as Evaluation;
	if (
		!e.prefix.length ||
		e.prefix.length > 64 ||
		e.prefix.some((t) => !Number.isFinite(t.amount) || t.amount < 0 || t.amount > 1e9) ||
		!Number.isFinite(e.profile.dailyAverage) ||
		e.profile.dailyAverage < 0 ||
		e.profile.dailyAverage > 1e9
	)
		throw new TypeError("outside frozen numeric domain");
	const numeric = referenceNumbers(
		e.prefix.map((t) => t.amount),
		e.profile.dailyAverage,
	);
	const txn = e.prefix[e.prefix.length - 1];
	const known = e.profile.typicalCategories.includes(txn.category);
	const factors: string[] = [];
	if (numeric.zScore > e.policy.zThreshold)
		factors.push(
			`Amount is ${referenceFixed(numeric.zScore, 2)}σ above this vendor's historical mean.`,
		);
	if (numeric.dailyRatio > e.policy.dailyRatioThreshold)
		factors.push(`Amount is ${referenceFixed(numeric.dailyRatio, 1)}× the user's daily average.`);
	if (!known) factors.push("Category is outside the user's typical spend profile.");
	const flagged = factors.length !== 0;
	const severity = factors.length >= 3 ? "high" : factors.length === 2 ? "medium" : "low";
	const message = flagged
		? `Transaction ${txn.id} flagged — severity: ${severity}.\nVendor: ${txn.vendor}  Amount: $${referenceFixed(txn.amount, 2)}  Category: ${txn.category}\nReasoning:\n${factors.map((f) => `  • ${f}`).join("\n")}`
		: `Transaction ${txn.id} ($${referenceFixed(txn.amount, 2)} at ${txn.vendor}) — normal.`;
	return proofFreeze({
		score: {
			zScore: numeric.zScore,
			dailyRatio: numeric.dailyRatio,
			categoryFamiliarity: known ? "known" : "unknown",
			txn,
		},
		flagged,
		reason: { factors, severity, txn },
		message,
	});
}
export function expectedRequest(e: Evaluation, b: SpendingBinding) {
	const result = expectedBusiness(e);
	if (!result.flagged) return undefined;
	const payloadText = proofCanonical({
		transactionId: result.score.txn.id,
		vendor: result.score.txn.vendor,
		severity: result.reason.severity,
		message: result.message,
	});
	if (Buffer.byteLength(payloadText) + 1 > 4096) throw new TypeError("proof payload capacity");
	const body = {
		schema: "spending-alerts/request-material/v1" as const,
		occurrence: e.occurrence,
		effectId: `alert:${e.evaluationRef}`,
		inputDigest: e.inputDigest,
		policyDigest: e.policyDigest,
		payloadText,
		payloadDigest: proofHash(payloadText),
		sourceDigest: b.sourceDigest,
		runtimeDigest: b.runtimeDigest,
		destinationRef: b.destinationRef,
		compositionEpoch: b.compositionEpoch,
		hostEpoch: b.hostEpoch,
	};
	const requestRef = { kind: body.schema, id: proofHash(proofCanonical(body)) };
	return proofFreeze({
		body,
		requestRef,
		proposalDigest: proofHash(
			proofCanonical({
				schema: "spending-alerts/effect-proposal/v1",
				occurrence: e.occurrence,
				effectId: body.effectId,
				requestRef,
			}),
		),
	});
}
export type ProofRequest = NonNullable<ReturnType<typeof expectedRequest>>;
export type ProofBusiness = ReturnType<typeof expectedBusiness>;
export function expectedAdmission(
	e: Evaluation,
	b: SpendingBinding,
	receiptRef: CausalSourceRef,
	grantRef: CausalSourceRef,
): CausalEffectAdmission {
	const request = expectedRequest(e, b);
	if (!request) throw new TypeError("no admission for normal evaluation");
	const proposal = {
		occurrence: e.occurrence,
		effectId: request.body.effectId,
		requestRef: request.requestRef,
		proposalDigest: request.proposalDigest,
	};
	return proofFreeze({
		...proposal,
		state: "admitted",
		admissionRef: {
			kind: "spending-admission",
			id: proofHash(proofCanonical({ proposal, receiptRef, grantRef, binding: b })),
		},
	});
}

/** Actual candidate business and material are required, not a candidate's pass label. */
export function verifyCandidate(
	e: Evaluation,
	b: SpendingBinding,
	observed: { business: unknown; request: unknown },
) {
	const errors: string[] = [];
	try {
		const actual = JSON.parse(proofCanonical(observed.business)) as ProofBusiness;
		const expected = expectedBusiness(e);
		const close = (a: number, target: number) =>
			typeof a === "number" &&
			Number.isFinite(a) &&
			Math.abs(a - target) <= 1e-10 * Math.max(1, Math.abs(target));
		if (
			!close(actual.score.zScore, expected.score.zScore) ||
			!close(actual.score.dailyRatio, expected.score.dailyRatio)
		)
			errors.push("numeric mismatch");
		if (
			actual.flagged !== expected.flagged ||
			actual.score.zScore > e.policy.zThreshold !== expected.score.zScore > e.policy.zThreshold ||
			actual.score.dailyRatio > e.policy.dailyRatioThreshold !==
				expected.score.dailyRatio > e.policy.dailyRatioThreshold ||
			actual.score.categoryFamiliarity !== expected.score.categoryFamiliarity ||
			!same(actual.score.txn, expected.score.txn) ||
			!same(actual.reason.txn, expected.reason.txn) ||
			!same(actual.reason.factors, expected.reason.factors) ||
			actual.reason.severity !== expected.reason.severity ||
			actual.message !== expected.message
		)
			errors.push("business consequence mismatch");
		if (!same(observed.request ?? null, expectedRequest(e, b) ?? null))
			errors.push("request bytes or binding mismatch");
	} catch (error) {
		errors.push(`invalid candidate observation: ${String(error)}`);
	}
	return proofFreeze({ passed: errors.length === 0, errors });
}

/** Nominal frozen facts; the runner must replace pass with the actual pre-grant candidate verdict. */
export function proofFacts(e: Evaluation, binding: SpendingBinding) {
	const request = expectedRequest(e, binding);
	const requestDigest =
		request?.body.payloadDigest ??
		proofHash(proofCanonical({ kind: "no-publish", evaluationRef: e.evaluationRef }));
	const artifactDigest = proofHash(
		proofCanonical({
			verifier: "independent-proof-v1",
			evaluation: e,
			binding,
			business: expectedBusiness(e),
		}),
	);
	const receipt: VerificationReceipt = {
		receiptRef: { kind: "proof-verification", id: artifactDigest },
		issuerRef: { kind: "proof-verifier", id: "independent-proof-v1" },
		verifierRevision: "spending-oracle-v2",
		occurrence: e.occurrence,
		inputDigest: e.inputDigest,
		policyDigest: e.policyDigest,
		sourceDigest: binding.sourceDigest,
		runtimeDigest: binding.runtimeDigest,
		requestDigest,
		numericDomainRef: "spending-finite-v1",
		verdict: "pass",
		artifactRef: { kind: "proof-artifact", id: artifactDigest },
		artifactDigest,
	};
	return proofFreeze({
		current: {
			binding,
			current: [
				{
					revisionDomain: e.occurrence.revisionDomain,
					occurrence: e.occurrence,
					policyRef: e.policyRef,
					policyDigest: e.policyDigest,
					watermark: e.occurrence.revision,
				},
			],
		},
		verification: { binding, receipts: [receipt] },
		local: {
			binding,
			tick: 1,
			stop: false,
			grants: [
				{
					grantRef: { kind: "proof-grant", id: e.evaluationRef },
					ownerRef: { kind: "proof-owner", id: "frozen-local-owner" },
					operation: "append-alert" as const,
					occurrence: e.occurrence,
					requestDigest,
					destinationRef: binding.destinationRef,
					hostEpoch: binding.hostEpoch,
					validFrom: 0,
					validThrough: 100,
					maxWrites: 64,
					replayScope: { compositionEpoch: binding.compositionEpoch, hostEpoch: binding.hostEpoch },
					revoked: false,
				},
			],
		},
	});
}

export interface ProofExpectation {
	readonly business: "match" | "mismatch" | "unavailable";
	readonly attempts: readonly {
		readonly evaluationRef: string;
		readonly outcome: "succeeded" | "unknown" | "cancelled" | "pending";
		readonly readback: "full" | number;
	}[];
	readonly normalEndReady: boolean;
	readonly checkpoints?: readonly { readonly label: string; readonly attemptedCalls: number }[];
	readonly authority?: readonly {
		readonly evaluationRef: string;
		readonly outcome: "absent" | "pending" | "rejected" | "succeeded" | "unknown";
		readonly lifecycle: boolean;
	}[];
}
export interface ProofTrace {
	readonly candidates: readonly {
		readonly evaluationRef: string;
		readonly business: unknown;
		readonly request: unknown;
	}[];
	/** Captured at transport invocation, independently of the candidate's reported writes count. */
	readonly attemptedPayloads: readonly string[];
	readonly records: readonly {
		readonly request: unknown;
		readonly admission: CausalEffectAdmission;
		readonly outcome?: CausalEffectOutcome;
	}[];
	readonly normalEndReady: boolean;
	readonly checkpoints?: readonly { readonly label: string; readonly attemptedCalls: number }[];
	readonly effects?: readonly {
		readonly proposal: CausalEffectProposal;
		readonly admission?: CausalEffectAdmission | null;
		readonly outcome?: CausalEffectOutcome | null;
	}[];
	readonly obligations?: readonly {
		readonly revisionDomain: string;
		readonly evaluatedThroughRevision: number;
		readonly lifecycle: boolean;
		readonly retainedEvidence: boolean;
	}[];
}
/** Readback is a separate verifier input, never taken from a host journal or success flag. */
export function verifyProofTrace(
	evaluations: readonly Evaluation[],
	binding: SpendingBinding,
	expected: ProofExpectation,
	trace: ProofTrace,
	readback: { before: Uint8Array; after: Uint8Array },
) {
	const errors: string[] = [];
	const candidates = new Map(trace.candidates.map((c) => [c.evaluationRef, c]));
	if (
		candidates.size !== trace.candidates.length ||
		(expected.business === "unavailable"
			? candidates.size !== 0
			: candidates.size !== evaluations.length)
	)
		errors.push("missing or duplicate business observations");
	const verdicts = evaluations.map((e) => {
		const candidate = candidates.get(e.evaluationRef);
		if (!candidate && expected.business !== "unavailable")
			errors.push(`missing observation: ${e.evaluationRef}`);
		return candidate
			? verifyCandidate(e, binding, candidate)
			: { passed: false, errors: ["missing observation"] };
	});
	const candidateQualified = verdicts.every((v) => v.passed);
	if (candidateQualified !== (expected.business === "match"))
		errors.push("unexpected candidate business verdict");
	if (trace.records.length !== expected.attempts.length)
		errors.push("unexpected retained host record count");
	const payloads: string[] = [];
	const chunks: Buffer[] = [];
	for (const attempt of expected.attempts) {
		const e = evaluations.find((item) => item.evaluationRef === attempt.evaluationRef);
		if (!e) throw new TypeError("expectation references missing evaluation");
		const request = expectedRequest(e, binding);
		if (!request) throw new TypeError("expectation submits a normal evaluation");
		const payload = `${request.body.payloadText}\n`;
		payloads.push(payload);
		const bytes = Buffer.from(payload);
		if (
			attempt.readback !== "full" &&
			(!Number.isSafeInteger(attempt.readback) ||
				attempt.readback < 0 ||
				attempt.readback > bytes.length)
		)
			throw new TypeError("invalid frozen readback length");
		chunks.push(attempt.readback === "full" ? bytes : bytes.subarray(0, attempt.readback));
		const facts = proofFacts(e, binding);
		const admission = expectedAdmission(
			e,
			binding,
			facts.verification.receipts[0].receiptRef,
			facts.local.grants[0].grantRef,
		);
		const records = trace.records.filter((r) => same(r.request, request));
		if (records.length !== 1 || !same(records[0].admission, admission)) {
			errors.push(`missing/extraneous admission: ${e.evaluationRef}`);
			continue;
		}
		const outcome = records[0].outcome;
		if (attempt.outcome === "pending") {
			if (outcome !== undefined) errors.push(`pending result fabricated: ${e.evaluationRef}`);
		} else if (
			!outcome ||
			outcome.state !== attempt.outcome ||
			!same(
				{
					occurrence: outcome.occurrence,
					effectId: outcome.effectId,
					requestRef: outcome.requestRef,
					proposalDigest: outcome.proposalDigest,
					admissionRef: outcome.admissionRef,
				},
				{
					occurrence: admission.occurrence,
					effectId: admission.effectId,
					requestRef: admission.requestRef,
					proposalDigest: admission.proposalDigest,
					admissionRef: admission.admissionRef,
				},
			) ||
			(outcome.state === "succeeded"
				? outcome.result.kind !== "ok" || !Object.hasOwn(outcome.result, "value")
				: outcome.result.kind !== "error" ||
					outcome.result.error.kind !== "issue" ||
					typeof outcome.result.error.code !== "string" ||
					!outcome.result.error.code ||
					typeof outcome.result.error.message !== "string" ||
					!outcome.result.error.message)
		)
			errors.push(`outcome mismatch: ${e.evaluationRef}`);
	}
	if (!same(trace.attemptedPayloads, payloads))
		errors.push("transport attempt bytes/count mismatch");
	const before = Buffer.from(readback.before);
	const after = Buffer.from(readback.after);
	if (before.length !== 0) errors.push("proof destination was not initially empty");
	if (!after.equals(Buffer.concat([before, ...chunks])))
		errors.push("independent readback mismatch");
	if (trace.normalEndReady !== expected.normalEndReady)
		errors.push("normal-end readiness mismatch");
	if (expected.checkpoints && !same(trace.checkpoints ?? null, expected.checkpoints))
		errors.push("checkpoint ordering or transport-call count mismatch");
	if (expected.authority) {
		if (!trace.effects || !trace.obligations) errors.push("missing authority observations");
		const expectedEffects = expected.authority.filter((item) => item.outcome !== "absent");
		if (trace.effects?.length !== expectedEffects.length)
			errors.push("unexpected authority effect count");
		for (const state of expected.authority) {
			const e = evaluations.find((item) => item.evaluationRef === state.evaluationRef);
			if (!e) throw new TypeError("authority expectation references missing evaluation");
			const obligations =
				trace.obligations?.filter((item) => item.revisionDomain === e.occurrence.revisionDomain) ??
				[];
			if (
				obligations.length !== 1 ||
				obligations[0].evaluatedThroughRevision < e.occurrence.revision ||
				obligations[0].lifecycle !== state.lifecycle
			)
				errors.push(`authority lifecycle mismatch: ${e.evaluationRef}`);
			const effects =
				trace.effects?.filter((item) => same(item.proposal.occurrence, e.occurrence)) ?? [];
			if (state.outcome === "absent") {
				if (effects.length) errors.push(`unexpected authority proposal: ${e.evaluationRef}`);
				continue;
			}
			const facts = proofFacts(e, binding);
			const admission = expectedAdmission(
				e,
				binding,
				facts.verification.receipts[0].receiptRef,
				facts.local.grants[0].grantRef,
			);
			const { state: _state, admissionRef: _ref, ...proposal } = admission;
			if (
				effects.length !== 1 ||
				!same(effects[0].proposal, proposal) ||
				!same(effects[0].admission ?? null, {
					...admission,
					state: state.outcome === "rejected" ? "rejected" : "admitted",
				})
			) {
				errors.push(`authority proposal/admission mismatch: ${e.evaluationRef}`);
				continue;
			}
			const outcome = effects[0].outcome;
			if (state.outcome === "pending" || state.outcome === "rejected") {
				if (outcome != null)
					errors.push(`authority accepted unexpected outcome: ${e.evaluationRef}`);
			} else {
				const host = trace.records.find((item) => same(item.admission, admission));
				if (!outcome || outcome.state !== state.outcome || !same(outcome, host?.outcome ?? null))
					errors.push(`authority/host outcome mismatch: ${e.evaluationRef}`);
			}
		}
	}
	return proofFreeze({
		passed: errors.length === 0,
		candidateQualified,
		errors,
		candidateVerdicts: verdicts,
		beforeDigest: proofHash(before),
		afterDigest: proofHash(after),
		bytesAdded: after.length - before.length,
		realInboxQualified: false,
	});
}
