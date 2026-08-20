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
	CurrentGraphProviderEffectResultInputV1,
	CurrentGraphProviderRouteProfileV1,
	CurrentGraphProviderTaskProfileV1,
	CurrentGraphProviderUsageV1,
} from "./d6-current-provider-authority.js";
import {
	admitD25EffectResult,
	createD25PhaseAuthority,
	type D25AdmittedEffectV1,
	type D25PhaseAuthorityV1,
	type D25PhaseEvidenceV1,
	snapshotD25PhaseEvidence,
	takeD25AdmittedEffect,
	validateD25PhaseEvidence,
} from "./d25-phase-specific-tool-admission.js";

export const D34_DECISION_REF = "graphrefly-ts:D34" as const;
export const D34_AUTHORITY_REVISION =
	"graphrefly-ts.d34.retained-span-mutation-authority.v1" as const;
export const D34_DIRECTIVE_SCHEMA =
	"graphrefly-ts.d34.retained-span-mutation-directive.v1" as const;
export const D34_FACT_SCHEMA = "graphrefly-ts.d34.retained-span-mutation-fact.v1" as const;
export const D34_EVIDENCE_SCHEMA = "graphrefly-ts.d34.retained-span-mutation-evidence.v1" as const;
export const D34_MAX_TEXT_BYTES = 131_072 as const;

export interface D34RetainedSpanDirectiveV1 {
	readonly schemaVersion: typeof D34_DIRECTIVE_SCHEMA;
	readonly requestDigest: string;
	readonly admissionDigest: string;
	readonly arm: string;
	readonly runSequence: number;
	readonly workspaceStateDigest: string;
	readonly spanFactDigest: string;
	readonly spanDigest: string;
	readonly spanBytes: number;
	readonly namedToolName: "propose_replacement_text";
	readonly maxProposalCount: 1;
	readonly maxNewTextBytes: typeof D34_MAX_TEXT_BYTES;
	readonly directiveDigest: string;
}

export interface D34AdmittedEffectV1 {
	readonly effect: D25AdmittedEffectV1;
	readonly retainedSpanDirective: D34RetainedSpanDirectiveV1 | null;
	readonly admittedEffectDigest: string;
}

export interface D34NewTextProposalResultV1 {
	readonly effectKind: "provider-request";
	readonly status: "completed";
	readonly newTextProposals: readonly string[];
	readonly usage: CurrentGraphProviderUsageV1;
	readonly evidenceDigest: string;
}

export interface D34RetainedSpanFactV1 {
	readonly schemaVersion: typeof D34_FACT_SCHEMA;
	readonly sequence: number;
	readonly kind: "retained-span" | "new-text-proposal";
	readonly arm: string;
	readonly runSequence: number;
	readonly requestDigest: string;
	readonly admissionDigest: string;
	readonly workspaceStateDigest: string;
	readonly sourceFactDigest: string;
	readonly spanFactDigest: string | null;
	readonly spanDigest: string;
	readonly spanBytes: number;
	readonly proposalCount: number;
	readonly proposalDigest: string | null;
	readonly proposalBytes: number;
	readonly disposition: "retained" | "accepted" | "cardinality-rejected" | "content-rejected";
	readonly factDigest: string;
}

export interface D34RetainedSpanEvidenceV1 {
	readonly schemaVersion: typeof D34_EVIDENCE_SCHEMA;
	readonly decisionRef: typeof D34_DECISION_REF;
	readonly authorityRevision: typeof D34_AUTHORITY_REVISION;
	readonly d33BundleDigest: "sha256:75ef3be6ea1e65e1af625ec07900344e8cc1f5036fbcd65f74f128abbf155376";
	readonly d33GraphEvidenceDigest: "sha256:afb7fb091c81fabec58a9f29fe04e492bcc92eafa433437acfa298d015c8d70e";
	readonly phaseEvidence: D25PhaseEvidenceV1;
	readonly facts: readonly D34RetainedSpanFactV1[];
	readonly factCount: number;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D34RetainedSpanAuthorityV1 {
	readonly revision: typeof D34_AUTHORITY_REVISION;
}

interface RetainedSpan {
	readonly arm: string;
	readonly runSequence: number;
	readonly workspaceStateDigest: string;
	readonly path: string;
	readonly oldText: string;
	readonly spanDigest: string;
	readonly spanBytes: number;
	readonly spanFactDigest: string;
}

interface D34State {
	readonly inner: D25PhaseAuthorityV1;
	readonly facts: D34RetainedSpanFactV1[];
	active: D34AdmittedEffectV1 | null;
	retainedSpan: RetainedSpan | null;
	nextSequence: number;
}

const states = new WeakMap<object, D34State>();
const activeOwners = new WeakMap<object, object>();

function stateFor(authority: D34RetainedSpanAuthorityV1): D34State {
	const state = states.get(authority as object);
	if (state === undefined) throw new TypeError("D34 retained-span authority is forged");
	return state;
}

function utf8Bytes(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function emitFact(
	state: D34State,
	input: Omit<D34RetainedSpanFactV1, "schemaVersion" | "sequence" | "factDigest">,
): D34RetainedSpanFactV1 {
	const material = strictSnapshot({
		schemaVersion: D34_FACT_SCHEMA,
		sequence: state.nextSequence++,
		...input,
	});
	const fact = Object.freeze({ ...material, factDigest: empiricalStrictJsonDigest(material) });
	state.facts.push(fact);
	return fact;
}

function retainedDirective(
	admitted: D25AdmittedEffectV1,
	span: RetainedSpan | null,
): D34RetainedSpanDirectiveV1 | null {
	const request = admitted.effect.request;
	const envelope = admitted.effect.runtime.modelEnvelope;
	if (
		request.effectKind !== "provider-request" ||
		envelope === null ||
		(envelope.correctionStage !== "fresh-mutation" &&
			envelope.correctionStage !== "retained-span-mutation")
	)
		return null;
	if (
		span === null ||
		span.arm !== request.arm ||
		span.runSequence !== request.runSequence ||
		span.workspaceStateDigest !== request.workspaceStateDigest
	)
		throw new TypeError("D34 retained span is missing or stale");
	const material = strictSnapshot({
		schemaVersion: D34_DIRECTIVE_SCHEMA,
		requestDigest: request.requestDigest,
		admissionDigest: admitted.effect.admission.decisionDigest,
		arm: request.arm,
		runSequence: request.runSequence,
		workspaceStateDigest: span.workspaceStateDigest,
		spanFactDigest: span.spanFactDigest,
		spanDigest: span.spanDigest,
		spanBytes: span.spanBytes,
		namedToolName: "propose_replacement_text" as const,
		maxProposalCount: 1 as const,
		maxNewTextBytes: D34_MAX_TEXT_BYTES,
	});
	return Object.freeze({ ...material, directiveDigest: empiricalStrictJsonDigest(material) });
}

export function createD34RetainedSpanAuthority(input: {
	readonly limits: CurrentGraphProviderBudgetLimitsV1;
	readonly routeProfile: CurrentGraphProviderRouteProfileV1;
	readonly taskProfile: CurrentGraphProviderTaskProfileV1;
}): D34RetainedSpanAuthorityV1 {
	const capability = Object.freeze({ revision: D34_AUTHORITY_REVISION });
	states.set(capability, {
		inner: createD25PhaseAuthority(input),
		facts: [],
		active: null,
		retainedSpan: null,
		nextSequence: 1,
	});
	return capability;
}

export function takeD34AdmittedEffect(
	authority: D34RetainedSpanAuthorityV1,
): D34AdmittedEffectV1 | null {
	const state = stateFor(authority);
	if (state.active !== null) throw new TypeError("D34 active effect has not been reconciled");
	const effect = takeD25AdmittedEffect(state.inner);
	if (effect === null) return null;
	const directive = retainedDirective(effect, state.retainedSpan);
	const material = strictSnapshot({
		innerAdmittedEffectDigest: effect.admittedEffectDigest,
		retainedSpanDirectiveDigest: directive?.directiveDigest ?? null,
	});
	const admitted = Object.freeze({
		effect,
		retainedSpanDirective: directive,
		admittedEffectDigest: empiricalStrictJsonDigest(material),
	});
	state.active = admitted;
	activeOwners.set(admitted, authority as object);
	return admitted;
}

function validateProposalResult(value: unknown): D34NewTextProposalResultV1 {
	const candidate = record(value, "D34 newText proposal result");
	exactKeys(
		candidate,
		["effectKind", "evidenceDigest", "newTextProposals", "status", "usage"],
		"D34 newText proposal result",
	);
	if (candidate.effectKind !== "provider-request" || candidate.status !== "completed")
		throw new TypeError("D34 newText proposal result kind drifted");
	digest(candidate.evidenceDigest, "D34 newText proposal evidence digest");
	const proposals = array(candidate.newTextProposals, "D34 newText proposals");
	if (proposals.length > 4) throw new TypeError("D34 newText proposal count exceeded its bound");
	for (const [index, proposal] of proposals.entries()) {
		if (typeof proposal !== "string" || utf8Bytes(proposal) > D34_MAX_TEXT_BYTES)
			throw new TypeError(`D34 newText proposal[${index}] exceeded its bound`);
	}
	return strictSnapshot(candidate) as unknown as D34NewTextProposalResultV1;
}

function normalizeProposal(
	state: D34State,
	active: D34AdmittedEffectV1,
	value: unknown,
): Readonly<{
	result: CurrentGraphProviderEffectResultInputV1;
	proposal: Readonly<{
		span: RetainedSpan;
		proposalCount: number;
		proposalDigest: string | null;
		proposalBytes: number;
		disposition: "accepted" | "cardinality-rejected" | "content-rejected";
	}> | null;
}> {
	const directive = active.retainedSpanDirective;
	if (directive === null)
		return Object.freeze({
			result: value as CurrentGraphProviderEffectResultInputV1,
			proposal: null,
		});
	const proposal = validateProposalResult(value);
	const span = state.retainedSpan;
	if (
		span === null ||
		span.spanFactDigest !== directive.spanFactDigest ||
		span.workspaceStateDigest !== directive.workspaceStateDigest
	)
		throw new TypeError("D34 retained span changed before proposal admission");
	const newText = proposal.newTextProposals[0];
	const proposalCount = proposal.newTextProposals.length;
	const proposalDigest =
		newText === undefined
			? null
			: empiricalStrictJsonDigest({ newText, spanDigest: span.spanDigest });
	const proposalBytes = newText === undefined ? 0 : utf8Bytes(newText);
	if (proposalCount !== 1)
		return Object.freeze({
			result: Object.freeze({
				effectKind: "provider-request" as const,
				status: "failed" as const,
				toolCalls: [] as const,
				failureCode: "mutation-proposal-cardinality" as const,
				retryProposal: null,
				usage: proposal.usage,
				evidenceDigest: empiricalStrictJsonDigest({
					directiveDigest: directive.directiveDigest,
					proposalEvidenceDigest: proposal.evidenceDigest,
					proposalCount,
				}),
			}),
			proposal: Object.freeze({
				span,
				proposalCount,
				proposalDigest,
				proposalBytes,
				disposition: "cardinality-rejected" as const,
			}),
		});
	if (newText === undefined) throw new TypeError("D34 accepted newText proposal is missing");
	if (newText.length === 0 || newText === span.oldText)
		return Object.freeze({
			result: Object.freeze({
				effectKind: "provider-request" as const,
				status: "failed" as const,
				toolCalls: [] as const,
				failureCode: "mutation-proposal-content" as const,
				retryProposal: null,
				usage: proposal.usage,
				evidenceDigest: empiricalStrictJsonDigest({
					directiveDigest: directive.directiveDigest,
					proposalEvidenceDigest: proposal.evidenceDigest,
					proposalDigest,
					contentRejected: true,
				}),
			}),
			proposal: Object.freeze({
				span,
				proposalCount,
				proposalDigest,
				proposalBytes,
				disposition: "content-rejected" as const,
			}),
		});
	return Object.freeze({
		result: Object.freeze({
			effectKind: "provider-request" as const,
			status: "completed" as const,
			toolCalls: Object.freeze([
				Object.freeze({
					toolRef: "replace-exact" as const,
					path: span.path,
					oldText: span.oldText,
					newText,
				}),
			]),
			failureCode: null,
			retryProposal: null,
			usage: proposal.usage,
			evidenceDigest: empiricalStrictJsonDigest({
				directiveDigest: directive.directiveDigest,
				proposalEvidenceDigest: proposal.evidenceDigest,
				proposalDigest,
			}),
		}),
		proposal: Object.freeze({
			span,
			proposalCount,
			proposalDigest,
			proposalBytes,
			disposition: "accepted" as const,
		}),
	});
}

export function admitD34EffectResult(
	authority: D34RetainedSpanAuthorityV1,
	admitted: D34AdmittedEffectV1,
	resultValue: unknown,
) {
	const state = stateFor(authority);
	const active = state.active;
	const owner = activeOwners.get(admitted as object);
	activeOwners.delete(admitted as object);
	if (active !== admitted || owner !== (authority as object))
		throw new TypeError("D34 admitted effect is forged or replayed");
	const normalized = normalizeProposal(state, admitted, resultValue);
	state.active = null;
	const args = admitted.effect.effect.runtime.toolArguments;
	const toolResult =
		normalized.result.effectKind === "tool-action" && normalized.result.toolRef === "replace-exact"
			? normalized.result
			: null;
	const outcome = admitD25EffectResult(state.inner, admitted.effect, normalized.result);
	if (normalized.result.effectKind === "cleanup") state.retainedSpan = null;
	if (normalized.proposal !== null) {
		const proposal = normalized.proposal;
		emitFact(state, {
			kind: "new-text-proposal",
			arm: proposal.span.arm,
			runSequence: proposal.span.runSequence,
			requestDigest: admitted.effect.effect.request.requestDigest,
			admissionDigest: admitted.effect.effect.admission.decisionDigest,
			workspaceStateDigest: proposal.span.workspaceStateDigest,
			sourceFactDigest: outcome.providerFact.factDigest,
			spanFactDigest: proposal.span.spanFactDigest,
			spanDigest: proposal.span.spanDigest,
			spanBytes: proposal.span.spanBytes,
			proposalCount: proposal.proposalCount,
			proposalDigest: proposal.proposalDigest,
			proposalBytes: proposal.proposalBytes,
			disposition: proposal.disposition,
		});
	}
	if (
		args?.toolRef === "replace-exact" &&
		toolResult?.status === "failed" &&
		toolResult.causeCode === "exact-replacement-unchanged" &&
		args.oldText === args.newText &&
		toolResult.workspaceStateBeforeDigest === toolResult.workspaceStateAfterDigest
	) {
		const spanBytes = utf8Bytes(args.oldText);
		if (spanBytes === 0 || spanBytes > D34_MAX_TEXT_BYTES)
			throw new TypeError("D34 retained span exceeded its bound");
		const spanDigest = empiricalStrictJsonDigest({ path: args.path, oldText: args.oldText });
		const fact = emitFact(state, {
			kind: "retained-span",
			arm: admitted.effect.effect.request.arm,
			runSequence: admitted.effect.effect.request.runSequence,
			requestDigest: admitted.effect.effect.request.requestDigest,
			admissionDigest: admitted.effect.effect.admission.decisionDigest,
			workspaceStateDigest: toolResult.workspaceStateAfterDigest,
			sourceFactDigest: outcome.providerFact.factDigest,
			spanFactDigest: null,
			spanDigest,
			spanBytes,
			proposalCount: 0,
			proposalDigest: null,
			proposalBytes: 0,
			disposition: "retained",
		});
		state.retainedSpan = Object.freeze({
			arm: fact.arm,
			runSequence: fact.runSequence,
			workspaceStateDigest: fact.workspaceStateDigest,
			path: args.path,
			oldText: args.oldText,
			spanDigest,
			spanBytes,
			spanFactDigest: fact.factDigest,
		});
	} else if (
		admitted.retainedSpanDirective !== null &&
		normalized.result.effectKind === "provider-request" &&
		normalized.result.status === "completed"
	) {
		state.retainedSpan = null;
	}
	return outcome;
}

function evidenceMaterial(
	phaseEvidence: D25PhaseEvidenceV1,
	facts: readonly D34RetainedSpanFactV1[],
) {
	return strictSnapshot({
		schemaVersion: D34_EVIDENCE_SCHEMA,
		decisionRef: D34_DECISION_REF,
		authorityRevision: D34_AUTHORITY_REVISION,
		d33BundleDigest:
			"sha256:75ef3be6ea1e65e1af625ec07900344e8cc1f5036fbcd65f74f128abbf155376" as const,
		d33GraphEvidenceDigest:
			"sha256:afb7fb091c81fabec58a9f29fe04e492bcc92eafa433437acfa298d015c8d70e" as const,
		phaseEvidence,
		facts,
		factCount: facts.length,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
}

export function snapshotD34RetainedSpanEvidence(
	authority: D34RetainedSpanAuthorityV1,
): D34RetainedSpanEvidenceV1 {
	const state = stateFor(authority);
	if (state.active !== null) throw new TypeError("D34 cannot snapshot an active effect");
	const material = evidenceMaterial(snapshotD25PhaseEvidence(state.inner), state.facts);
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

function validateFact(value: unknown, index: number): D34RetainedSpanFactV1 {
	const path = `D34 evidence.facts[${index}]`;
	const candidate = record(value, path);
	exactKeys(
		candidate,
		[
			"admissionDigest",
			"arm",
			"disposition",
			"factDigest",
			"kind",
			"proposalBytes",
			"proposalCount",
			"proposalDigest",
			"requestDigest",
			"runSequence",
			"schemaVersion",
			"sequence",
			"sourceFactDigest",
			"spanBytes",
			"spanDigest",
			"spanFactDigest",
			"workspaceStateDigest",
		],
		path,
	);
	if (candidate.schemaVersion !== D34_FACT_SCHEMA) throw new TypeError(`${path} schema drifted`);
	if (candidate.kind !== "retained-span" && candidate.kind !== "new-text-proposal")
		throw new TypeError(`${path}.kind drifted`);
	if (
		candidate.disposition !== "retained" &&
		candidate.disposition !== "accepted" &&
		candidate.disposition !== "cardinality-rejected" &&
		candidate.disposition !== "content-rejected"
	)
		throw new TypeError(`${path}.disposition drifted`);
	for (const key of [
		"admissionDigest",
		"factDigest",
		"requestDigest",
		"sourceFactDigest",
		"spanDigest",
		"workspaceStateDigest",
	] as const)
		digest(candidate[key], `${path}.${key}`);
	if (candidate.spanFactDigest !== null) digest(candidate.spanFactDigest, `${path}.spanFactDigest`);
	if (candidate.proposalDigest !== null) digest(candidate.proposalDigest, `${path}.proposalDigest`);
	safeInteger(candidate.sequence, `${path}.sequence`, { min: 1, max: 64 });
	safeInteger(candidate.runSequence, `${path}.runSequence`, { min: 0, max: 11 });
	safeInteger(candidate.spanBytes, `${path}.spanBytes`, { min: 1, max: D34_MAX_TEXT_BYTES });
	safeInteger(candidate.proposalCount, `${path}.proposalCount`, { min: 0, max: 4 });
	safeInteger(candidate.proposalBytes, `${path}.proposalBytes`, {
		min: 0,
		max: D34_MAX_TEXT_BYTES,
	});
	if (
		(candidate.kind === "retained-span" &&
			(candidate.disposition !== "retained" ||
				candidate.spanFactDigest !== null ||
				candidate.proposalCount !== 0 ||
				candidate.proposalDigest !== null ||
				candidate.proposalBytes !== 0)) ||
		(candidate.kind === "new-text-proposal" &&
			(candidate.disposition === "retained" || candidate.spanFactDigest === null)) ||
		(candidate.disposition === "accepted" && candidate.proposalCount !== 1) ||
		(candidate.disposition === "content-rejected" && candidate.proposalCount !== 1) ||
		(candidate.disposition === "cardinality-rejected" && candidate.proposalCount === 1)
	)
		throw new TypeError(`${path} cardinality semantics drifted`);
	const { factDigest: _factDigest, ...base } = candidate;
	if (candidate.factDigest !== empiricalStrictJsonDigest(base))
		throw new TypeError(`${path} digest drifted`);
	return strictSnapshot(candidate) as unknown as D34RetainedSpanFactV1;
}

export function validateD34RetainedSpanEvidence(value: unknown): D34RetainedSpanEvidenceV1 {
	const candidate = record(value, "D34 evidence");
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
		"D34 evidence",
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
		candidate.efficacyClaim !== "none"
	)
		throw new TypeError("D34 evidence coordinates drifted");
	const phaseEvidence = validateD25PhaseEvidence(candidate.phaseEvidence);
	const rawFacts = array(candidate.facts, "D34 evidence.facts");
	if (rawFacts.length === 0 || rawFacts.length > 64)
		throw new TypeError("D34 evidence fact bound drifted");
	const facts = rawFacts.map(validateFact);
	if (candidate.factCount !== facts.length) throw new TypeError("D34 evidence fact count drifted");
	if (facts.some((fact, index) => fact.sequence !== index + 1))
		throw new TypeError("D34 evidence fact sequence drifted");
	const providerFacts = phaseEvidence.workflowEvidence.providerEvidence.facts;
	const providerByDigest = new Map(providerFacts.map((fact) => [fact.factDigest, fact] as const));
	const retained = new Map<string, D34RetainedSpanFactV1>();
	for (const fact of facts) {
		const source = providerByDigest.get(fact.sourceFactDigest);
		if (
			source === undefined ||
			source.request.requestDigest !== fact.requestDigest ||
			source.admission.decisionDigest !== fact.admissionDigest ||
			source.arm !== fact.arm ||
			source.runSequence !== fact.runSequence
		)
			throw new TypeError("D34 fact lost its Graph provider admission binding");
		if (fact.kind === "retained-span") {
			if (
				source.result.effectKind !== "tool-action" ||
				source.result.toolRef !== "replace-exact" ||
				source.result.status !== "failed" ||
				source.result.causeCode !== "exact-replacement-unchanged" ||
				source.result.workspaceStateBeforeDigest !== fact.workspaceStateDigest ||
				source.result.workspaceStateAfterDigest !== fact.workspaceStateDigest
			)
				throw new TypeError("D34 retained span lost its zero-side-effect rejection binding");
			retained.set(fact.factDigest, fact);
		} else {
			const spanSource =
				fact.spanFactDigest === null ? undefined : retained.get(fact.spanFactDigest);
			if (
				spanSource === undefined ||
				spanSource.arm !== fact.arm ||
				spanSource.runSequence !== fact.runSequence ||
				spanSource.workspaceStateDigest !== fact.workspaceStateDigest ||
				spanSource.spanDigest !== fact.spanDigest ||
				spanSource.spanBytes !== fact.spanBytes ||
				source.result.effectKind !== "provider-request" ||
				(fact.disposition === "accepted" && source.result.status !== "completed") ||
				(fact.disposition === "cardinality-rejected" &&
					(source.result.status !== "failed" ||
						source.result.failureCode !== "mutation-proposal-cardinality")) ||
				(fact.disposition === "content-rejected" &&
					(source.result.status !== "failed" ||
						source.result.failureCode !== "mutation-proposal-content"))
			)
				throw new TypeError("D34 proposal fact lost its retained-span binding");
		}
	}
	const material = evidenceMaterial(phaseEvidence, facts);
	const rebuilt = Object.freeze({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	});
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(rebuilt))
		throw new TypeError("D34 evidence canonical replay drifted");
	return rebuilt;
}
