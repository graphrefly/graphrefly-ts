import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type {
	CurrentGraphProviderBudgetLimitsV1,
	CurrentGraphProviderFactV1,
	CurrentGraphProviderRouteProfileV1,
	CurrentGraphProviderTaskProfileV1,
} from "./d6-current-provider-authority.js";
import {
	D25_AUTHORITY_REVISION,
	D25_DECISION_REF,
	D25_EVIDENCE_SCHEMA,
	validateD25PhaseEvidence,
} from "./d25-phase-specific-tool-admission.js";
import {
	admitD34EffectResult,
	createD34RetainedSpanAuthority,
	D34_AUTHORITY_REVISION,
	D34_DECISION_REF,
	D34_EVIDENCE_SCHEMA,
	type D34AdmittedEffectV1,
	type D34RetainedSpanAuthorityV1,
	type D34RetainedSpanEvidenceV1,
	snapshotD34RetainedSpanEvidence,
	takeD34AdmittedEffect,
	validateD34RetainedSpanEvidence,
} from "./d34-retained-span-mutation-authority.js";

export const D41_DECISION_REF = "graphrefly-ts:D41" as const;
export const D41_AUTHORITY_REVISION =
	"graphrefly-ts.d41.phase-specific-inference-authority.v1" as const;
export const D41_DIRECTIVE_SCHEMA =
	"graphrefly-ts.d41.phase-specific-inference-directive.v1" as const;
export const D41_FACT_SCHEMA = "graphrefly-ts.d41.phase-specific-inference-fact.v1" as const;
export const D41_EVIDENCE_SCHEMA =
	"graphrefly-ts.d41.phase-specific-inference-evidence.v1" as const;
export const D41_INSPECTION_MAX_OUTPUT_TOKENS = 65_536 as const;
export const D41_MUTATION_MAX_OUTPUT_TOKENS = 8_192 as const;
/** Equal to the frozen D6 provider-attempt ceiling; valid bounded retries must remain representable. */
export const D41_MAX_INFERENCE_FACTS = 120 as const;

export type D41InferencePhase = "inspection" | "mutation";

export interface D41InferenceDirectiveV1 {
	readonly schemaVersion: typeof D41_DIRECTIVE_SCHEMA;
	readonly requestDigest: string;
	readonly admissionDigest: string;
	readonly logicalRequestDigest: string;
	readonly phaseDirectiveDigest: string;
	readonly phase: D41InferencePhase;
	readonly namedToolRef: "read-file" | "replace-exact";
	readonly maxOutputTokens: 8_192 | 65_536;
	readonly directiveDigest: string;
}

export interface D41AdmittedEffectV1 {
	readonly effect: D34AdmittedEffectV1;
	readonly inferenceDirective: D41InferenceDirectiveV1 | null;
	readonly admittedEffectDigest: string;
}

export interface D41InferenceWireReceiptV1 {
	readonly schemaVersion: "graphrefly-ts.d41.phase-specific-inference-wire-receipt.v1";
	readonly requestDigest: string;
	readonly admissionDigest: string;
	readonly logicalRequestDigest: string;
	readonly inferenceDirectiveDigest: string;
	readonly maxOutputTokens: 8_192 | 65_536;
	readonly originalBodyDigest: string;
	readonly loweredBodyDigest: string;
	readonly receiptDigest: string;
}

export interface D41InferenceFactV1 {
	readonly schemaVersion: typeof D41_FACT_SCHEMA;
	readonly sequence: number;
	readonly arm: string;
	readonly runSequence: number;
	readonly requestDigest: string;
	readonly admissionDigest: string;
	readonly logicalRequestDigest: string;
	readonly phaseDirectiveDigest: string;
	readonly inferenceDirectiveDigest: string;
	readonly phase: D41InferencePhase;
	readonly namedToolRef: "read-file" | "replace-exact";
	readonly maxOutputTokens: 8_192 | 65_536;
	readonly providerResultEvidenceDigest: string;
	readonly reconciliationDigest: string;
	readonly providerFactDigest: string;
	readonly originalBodyDigest: string;
	readonly loweredBodyDigest: string;
	readonly wireReceiptDigest: string;
	readonly factDigest: string;
}

export interface D41InferenceEvidenceV1 {
	readonly schemaVersion: typeof D41_EVIDENCE_SCHEMA;
	readonly decisionRef: typeof D41_DECISION_REF;
	readonly authorityRevision: typeof D41_AUTHORITY_REVISION;
	readonly retainedSpanEvidence: D34RetainedSpanEvidenceV1;
	readonly facts: readonly D41InferenceFactV1[];
	readonly factCount: number;
	readonly inspectionMaxOutputTokens: 65_536;
	readonly mutationMaxOutputTokens: 8_192;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D41InferenceAuthorityV1 {
	readonly revision: typeof D41_AUTHORITY_REVISION;
}

interface D41State {
	readonly inner: D34RetainedSpanAuthorityV1;
	readonly facts: D41InferenceFactV1[];
	active: D41AdmittedEffectV1 | null;
	nextSequence: number;
}

const states = new WeakMap<object, D41State>();
const owners = new WeakMap<object, object>();

function stateFor(authority: D41InferenceAuthorityV1): D41State {
	const state = states.get(authority as object);
	if (state === undefined) throw new TypeError("D41 inference authority is forged");
	return state;
}

function directiveFor(admitted: D34AdmittedEffectV1): D41InferenceDirectiveV1 | null {
	const request = admitted.effect.effect.request;
	if (request.effectKind !== "provider-request") return null;
	const phaseDirective = admitted.effect.phaseDirective;
	if (
		phaseDirective === null ||
		phaseDirective.requestDigest !== request.requestDigest ||
		request.logicalRequestDigest === null
	)
		throw new TypeError("D41 provider effect lost its Graph phase admission");
	const phase: D41InferencePhase =
		phaseDirective.namedToolRef === "read-file" ? "inspection" : "mutation";
	const maxOutputTokens =
		phase === "inspection" ? D41_INSPECTION_MAX_OUTPUT_TOKENS : D41_MUTATION_MAX_OUTPUT_TOKENS;
	const material = strictSnapshot({
		schemaVersion: D41_DIRECTIVE_SCHEMA,
		requestDigest: request.requestDigest,
		admissionDigest: admitted.effect.effect.admission.decisionDigest,
		logicalRequestDigest: request.logicalRequestDigest,
		phaseDirectiveDigest: phaseDirective.directiveDigest,
		phase,
		namedToolRef: phaseDirective.namedToolRef,
		maxOutputTokens,
	});
	return Object.freeze({ ...material, directiveDigest: empiricalStrictJsonDigest(material) });
}

export function createD41InferenceAuthority(input: {
	readonly limits: CurrentGraphProviderBudgetLimitsV1;
	readonly routeProfile: CurrentGraphProviderRouteProfileV1;
	readonly taskProfile: CurrentGraphProviderTaskProfileV1;
}): D41InferenceAuthorityV1 {
	const authority = Object.freeze({ revision: D41_AUTHORITY_REVISION });
	states.set(authority, {
		inner: createD34RetainedSpanAuthority(input),
		facts: [],
		active: null,
		nextSequence: 1,
	});
	return authority;
}

export function takeD41AdmittedEffect(
	authority: D41InferenceAuthorityV1,
): D41AdmittedEffectV1 | null {
	const state = stateFor(authority);
	if (state.active !== null) throw new TypeError("D41 active effect has not been reconciled");
	const effect = takeD34AdmittedEffect(state.inner);
	if (effect === null) return null;
	const inferenceDirective = directiveFor(effect);
	const material = strictSnapshot({
		innerAdmittedEffectDigest: effect.admittedEffectDigest,
		inferenceDirectiveDigest: inferenceDirective?.directiveDigest ?? null,
	});
	const admitted = Object.freeze({
		effect,
		inferenceDirective,
		admittedEffectDigest: empiricalStrictJsonDigest(material),
	});
	state.active = admitted;
	owners.set(admitted, authority as object);
	return admitted;
}

export function admitD41EffectResult(
	authority: D41InferenceAuthorityV1,
	admitted: D41AdmittedEffectV1,
	result: unknown,
	wireReceiptValue: D41InferenceWireReceiptV1 | null,
) {
	const state = stateFor(authority);
	const owner = owners.get(admitted as object);
	owners.delete(admitted as object);
	if (state.active !== admitted || owner !== (authority as object))
		throw new TypeError("D41 admitted effect is forged or replayed");
	state.active = null;
	const directive = admitted.inferenceDirective;
	let validatedWireReceipt: D41InferenceWireReceiptV1 | null = null;
	if (directive !== null) {
		const wireReceipt = validateWireReceipt(wireReceiptValue);
		if (
			wireReceipt.requestDigest !== directive.requestDigest ||
			wireReceipt.admissionDigest !== directive.admissionDigest ||
			wireReceipt.logicalRequestDigest !== directive.logicalRequestDigest ||
			wireReceipt.inferenceDirectiveDigest !== directive.directiveDigest ||
			wireReceipt.maxOutputTokens !== directive.maxOutputTokens
		)
			throw new TypeError("D41 inference wire receipt lost its Graph directive binding");
		if (state.facts.length >= D41_MAX_INFERENCE_FACTS)
			throw new TypeError("D41 inference fact bound exceeded");
		validatedWireReceipt = wireReceipt;
	} else if (wireReceiptValue !== null) {
		throw new TypeError("D41 non-provider effect supplied a wire receipt");
	}
	const outcome = admitD34EffectResult(state.inner, admitted.effect, result);
	if (directive !== null) {
		const wireReceipt = validatedWireReceipt!;
		const providerFact = outcome.providerFact as CurrentGraphProviderFactV1;
		const material = strictSnapshot({
			schemaVersion: D41_FACT_SCHEMA,
			sequence: state.nextSequence++,
			arm: providerFact.arm,
			runSequence: providerFact.runSequence,
			requestDigest: directive.requestDigest,
			admissionDigest: directive.admissionDigest,
			logicalRequestDigest: directive.logicalRequestDigest,
			phaseDirectiveDigest: directive.phaseDirectiveDigest,
			inferenceDirectiveDigest: directive.directiveDigest,
			phase: directive.phase,
			namedToolRef: directive.namedToolRef,
			maxOutputTokens: directive.maxOutputTokens,
			providerResultEvidenceDigest: providerFact.result.evidenceDigest,
			reconciliationDigest: providerFact.reconciliation.reconciliationDigest,
			providerFactDigest: providerFact.factDigest,
			originalBodyDigest: wireReceipt.originalBodyDigest,
			loweredBodyDigest: wireReceipt.loweredBodyDigest,
			wireReceiptDigest: wireReceipt.receiptDigest,
		});
		state.facts.push(
			Object.freeze({ ...material, factDigest: empiricalStrictJsonDigest(material) }),
		);
	}
	return outcome;
}

function validateWireReceipt(value: unknown): D41InferenceWireReceiptV1 {
	const candidate = record(value, "D41 inference wire receipt");
	exactKeys(
		candidate,
		[
			"admissionDigest",
			"inferenceDirectiveDigest",
			"logicalRequestDigest",
			"loweredBodyDigest",
			"maxOutputTokens",
			"originalBodyDigest",
			"receiptDigest",
			"requestDigest",
			"schemaVersion",
		],
		"D41 inference wire receipt",
	);
	if (
		candidate.schemaVersion !== "graphrefly-ts.d41.phase-specific-inference-wire-receipt.v1" ||
		(candidate.maxOutputTokens !== D41_INSPECTION_MAX_OUTPUT_TOKENS &&
			candidate.maxOutputTokens !== D41_MUTATION_MAX_OUTPUT_TOKENS)
	)
		throw new TypeError("D41 inference wire receipt coordinates drifted");
	for (const key of [
		"admissionDigest",
		"inferenceDirectiveDigest",
		"logicalRequestDigest",
		"loweredBodyDigest",
		"originalBodyDigest",
		"receiptDigest",
		"requestDigest",
	] as const)
		digest(candidate[key], `D41 inference wire receipt.${key}`);
	const { receiptDigest: suppliedDigest, ...material } = candidate;
	if (suppliedDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D41 inference wire receipt digest drifted");
	return strictSnapshot(candidate) as unknown as D41InferenceWireReceiptV1;
}

function validateZeroRetainedSpanEvidence(value: unknown): D34RetainedSpanEvidenceV1 {
	const candidate = record(value, "D41 zero-retained D34 evidence");
	exactKeys(
		candidate,
		[
			"authorityRevision",
			"causalAttribution",
			"d33BundleDigest",
			"d33GraphEvidenceDigest",
			"decisionRef",
			"efficacyClaim",
			"evidenceDigest",
			"factCount",
			"facts",
			"phaseEvidence",
			"schemaVersion",
		],
		"D41 zero-retained D34 evidence",
	);
	if (
		candidate.schemaVersion !== D34_EVIDENCE_SCHEMA ||
		candidate.decisionRef !== D34_DECISION_REF ||
		candidate.authorityRevision !== D34_AUTHORITY_REVISION ||
		candidate.d33BundleDigest !==
			"sha256:75ef3be6ea1e65e1af625ec07900344e8cc1f5036fbcd65f74f128abbf155376" ||
		candidate.d33GraphEvidenceDigest !==
			"sha256:afb7fb091c81fabec58a9f29fe04e492bcc92eafa433437acfa298d015c8d70e" ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none" ||
		candidate.factCount !== 0 ||
		array(candidate.facts, "D41 zero-retained facts").length !== 0
	)
		throw new TypeError("D41 zero-retained D34 evidence coordinates drifted");
	const phaseEvidence = validateD25PhaseEvidence(candidate.phaseEvidence);
	if (
		phaseEvidence.schemaVersion !== D25_EVIDENCE_SCHEMA ||
		phaseEvidence.decisionRef !== D25_DECISION_REF ||
		phaseEvidence.authorityRevision !== D25_AUTHORITY_REVISION
	)
		throw new TypeError("D41 zero-retained phase evidence drifted");
	const { evidenceDigest: suppliedDigest, ...material } = candidate;
	if (
		digest(suppliedDigest, "D41 zero-retained evidence digest") !==
		empiricalStrictJsonDigest(material)
	)
		throw new TypeError("D41 zero-retained D34 evidence digest drifted");
	return strictSnapshot(candidate) as unknown as D34RetainedSpanEvidenceV1;
}

export function validateD41RetainedSpanEvidence(value: unknown): D34RetainedSpanEvidenceV1 {
	const candidate = record(value, "D41 retained-span evidence");
	const facts = array(candidate.facts, "D41 retained-span facts");
	return facts.length === 0
		? validateZeroRetainedSpanEvidence(candidate)
		: validateD34RetainedSpanEvidence(candidate);
}

function evidenceMaterial(
	retainedSpanEvidence: D34RetainedSpanEvidenceV1,
	facts: readonly D41InferenceFactV1[],
) {
	return strictSnapshot({
		schemaVersion: D41_EVIDENCE_SCHEMA,
		decisionRef: D41_DECISION_REF,
		authorityRevision: D41_AUTHORITY_REVISION,
		retainedSpanEvidence,
		facts,
		factCount: facts.length,
		inspectionMaxOutputTokens: D41_INSPECTION_MAX_OUTPUT_TOKENS,
		mutationMaxOutputTokens: D41_MUTATION_MAX_OUTPUT_TOKENS,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
}

export function snapshotD41InferenceEvidence(
	authority: D41InferenceAuthorityV1,
): D41InferenceEvidenceV1 {
	const state = stateFor(authority);
	if (state.active !== null) throw new TypeError("D41 cannot snapshot an active effect");
	const retainedSpanEvidence = validateD41RetainedSpanEvidence(
		snapshotD34RetainedSpanEvidence(state.inner),
	);
	const material = evidenceMaterial(retainedSpanEvidence, state.facts);
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

function validateFact(value: unknown, index: number): D41InferenceFactV1 {
	const path = `D41 inference facts[${index}]`;
	const candidate = record(value, path);
	exactKeys(
		candidate,
		[
			"admissionDigest",
			"arm",
			"factDigest",
			"inferenceDirectiveDigest",
			"logicalRequestDigest",
			"maxOutputTokens",
			"namedToolRef",
			"loweredBodyDigest",
			"originalBodyDigest",
			"phase",
			"phaseDirectiveDigest",
			"providerFactDigest",
			"providerResultEvidenceDigest",
			"reconciliationDigest",
			"requestDigest",
			"runSequence",
			"schemaVersion",
			"sequence",
			"wireReceiptDigest",
		],
		path,
	);
	if (candidate.schemaVersion !== D41_FACT_SCHEMA) throw new TypeError(`${path} schema drifted`);
	if (
		(candidate.phase !== "inspection" && candidate.phase !== "mutation") ||
		(candidate.namedToolRef !== "read-file" && candidate.namedToolRef !== "replace-exact") ||
		(candidate.phase === "inspection" &&
			(candidate.namedToolRef !== "read-file" ||
				candidate.maxOutputTokens !== D41_INSPECTION_MAX_OUTPUT_TOKENS)) ||
		(candidate.phase === "mutation" &&
			(candidate.namedToolRef !== "replace-exact" ||
				candidate.maxOutputTokens !== D41_MUTATION_MAX_OUTPUT_TOKENS))
	)
		throw new TypeError(`${path} phase ceiling drifted`);
	for (const key of [
		"admissionDigest",
		"factDigest",
		"inferenceDirectiveDigest",
		"logicalRequestDigest",
		"loweredBodyDigest",
		"originalBodyDigest",
		"phaseDirectiveDigest",
		"providerFactDigest",
		"providerResultEvidenceDigest",
		"reconciliationDigest",
		"requestDigest",
		"wireReceiptDigest",
	] as const)
		digest(candidate[key], `${path}.${key}`);
	safeInteger(candidate.sequence, `${path}.sequence`, { min: 1, max: D41_MAX_INFERENCE_FACTS });
	safeInteger(candidate.runSequence, `${path}.runSequence`, { min: 0, max: 11 });
	const { factDigest: suppliedDigest, ...material } = candidate;
	if (suppliedDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError(`${path} digest drifted`);
	return strictSnapshot(candidate) as unknown as D41InferenceFactV1;
}

export function validateD41InferenceEvidence(value: unknown): D41InferenceEvidenceV1 {
	const candidate = record(value, "D41 inference evidence");
	exactKeys(
		candidate,
		[
			"authorityRevision",
			"causalAttribution",
			"decisionRef",
			"efficacyClaim",
			"evidenceDigest",
			"factCount",
			"facts",
			"inspectionMaxOutputTokens",
			"mutationMaxOutputTokens",
			"retainedSpanEvidence",
			"schemaVersion",
		],
		"D41 inference evidence",
	);
	if (
		candidate.schemaVersion !== D41_EVIDENCE_SCHEMA ||
		candidate.decisionRef !== D41_DECISION_REF ||
		candidate.authorityRevision !== D41_AUTHORITY_REVISION ||
		candidate.inspectionMaxOutputTokens !== D41_INSPECTION_MAX_OUTPUT_TOKENS ||
		candidate.mutationMaxOutputTokens !== D41_MUTATION_MAX_OUTPUT_TOKENS ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none"
	)
		throw new TypeError("D41 inference evidence coordinates drifted");
	const retainedSpanEvidence = validateD41RetainedSpanEvidence(candidate.retainedSpanEvidence);
	const rawFacts = array(candidate.facts, "D41 inference evidence facts");
	if (rawFacts.length > D41_MAX_INFERENCE_FACTS)
		throw new TypeError("D41 inference evidence fact bound exceeded");
	const facts = rawFacts.map(validateFact);
	if (
		candidate.factCount !== facts.length ||
		facts.some((fact, index) => fact.sequence !== index + 1)
	)
		throw new TypeError("D41 inference fact count or sequence drifted");
	const providerFacts = retainedSpanEvidence.phaseEvidence.workflowEvidence.providerEvidence.facts;
	const providerRequests = providerFacts.filter(
		(fact) => fact.request.effectKind === "provider-request",
	);
	if (facts.length !== providerRequests.length)
		throw new TypeError("D41 inference facts lost provider-request reverse coverage");
	const byDigest = new Map(providerRequests.map((fact) => [fact.factDigest, fact] as const));
	const seen = new Set<string>();
	for (const fact of facts) {
		const provider = byDigest.get(fact.providerFactDigest);
		if (
			provider === undefined ||
			seen.has(fact.providerFactDigest) ||
			provider.arm !== fact.arm ||
			provider.runSequence !== fact.runSequence ||
			provider.request.requestDigest !== fact.requestDigest ||
			provider.request.logicalRequestDigest !== fact.logicalRequestDigest ||
			provider.admission.decisionDigest !== fact.admissionDigest ||
			provider.result.evidenceDigest !== fact.providerResultEvidenceDigest ||
			provider.reconciliation.reconciliationDigest !== fact.reconciliationDigest
		)
			throw new TypeError("D41 inference fact lost exact Graph provider binding");
		seen.add(fact.providerFactDigest);
	}
	const material = evidenceMaterial(retainedSpanEvidence, facts);
	if (candidate.evidenceDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D41 inference evidence digest drifted");
	return Object.freeze({ ...material, evidenceDigest: candidate.evidenceDigest });
}
