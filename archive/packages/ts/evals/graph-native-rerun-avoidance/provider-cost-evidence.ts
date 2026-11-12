import { empiricalStrictJsonDigest, exactKeys, strictSnapshot } from "./canonical.js";

/** D154: policy evidence is neither response-reported usage nor a settled account bill. */
export const ROOT_EVAL_NONBILLABLE_POLICY =
	"openrouter.zero-completion-insurance/http-429-no-output/2026-09-02.v1" as const;

export interface EvalNonbillableCostEvidence {
	readonly policyRef: typeof ROOT_EVAL_NONBILLABLE_POLICY;
	readonly admissionId: string;
	readonly admissionReceiptDigest: string;
	readonly requestDigest: string;
	readonly responseDigest: string;
	readonly evidenceDigest: string;
}

export function nonbillableCostEvidence(
	input: Omit<EvalNonbillableCostEvidence, "evidenceDigest">,
) {
	return Object.freeze({ ...input, evidenceDigest: empiricalStrictJsonDigest(input) });
}

export function nonbillableHttpResultDigest(responseDigest: string): string {
	return empiricalStrictJsonDigest({
		kind: "root-eval-provider-http-result",
		status: 429,
		bodyDigest: responseDigest,
	});
}

export function validateNonbillableCostEvidence(
	value: unknown,
	admission: { readonly admissionId: string; readonly receiptDigest: string },
	resultDigest: string,
): EvalNonbillableCostEvidence {
	const proof = strictSnapshot(value) as EvalNonbillableCostEvidence;
	exactKeys(
		proof as unknown as Record<string, unknown>,
		[
			"policyRef",
			"admissionId",
			"admissionReceiptDigest",
			"requestDigest",
			"responseDigest",
			"evidenceDigest",
		],
		"nonbillable cost evidence",
	);
	const { evidenceDigest, ...body } = proof;
	if (
		proof.policyRef !== ROOT_EVAL_NONBILLABLE_POLICY ||
		proof.admissionId !== admission.admissionId ||
		proof.admissionReceiptDigest !== admission.receiptDigest ||
		![
			proof.admissionReceiptDigest,
			proof.requestDigest,
			proof.responseDigest,
			evidenceDigest,
		].every((digest) => typeof digest === "string" && /^sha256:[0-9a-f]{64}$/u.test(digest)) ||
		evidenceDigest !== empiricalStrictJsonDigest(body) ||
		resultDigest !== nonbillableHttpResultDigest(proof.responseDigest)
	)
		throw new TypeError("nonbillable cost evidence lost its exact admission binding");
	return proof;
}
