import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type {
	CurrentGraphProviderAdmittedEffectV1,
	CurrentGraphProviderBudgetLimitsV1,
	CurrentGraphProviderEffectResultInputV1,
	CurrentGraphProviderRouteProfileV1,
	CurrentGraphProviderTaskProfileV1,
	CurrentGraphRuntimeToolArgumentsV1,
} from "./d6-current-provider-authority.js";
import {
	admitD9ProviderEffectResult,
	createD9ProviderRejectionAuthority,
	type D9ProviderAdmissionOutcomeV1,
	type D9ProviderRejectionAuthorityV1,
	type D9ProviderRejectionEvidenceV1,
	snapshotD9ProviderRejectionEvidence,
	takeD9ProviderEffect,
	validateD9ProviderRejectionEvidence,
} from "./d9-current-provider-rejection-authority.js";
import { validateD23LiveBundle } from "./d23-current-efficacy-live.js";

export const D25_DECISION_REF = "graphrefly-ts:D25" as const;
export const D25_AUTHORITY_REVISION = "graphrefly-ts.d25.phase-specific-tool-admission.v1" as const;
export const D25_DIRECTIVE_SCHEMA = "graphrefly-ts.d25.phase-specific-tool-directive.v1" as const;
export const D25_FACT_SCHEMA = "graphrefly-ts.d25.phase-specific-tool-fact.v1" as const;
export const D25_EVIDENCE_SCHEMA = "graphrefly-ts.d25.phase-specific-tool-evidence.v1" as const;
export const D25_D24_ARTIFACT_DIGEST =
	"sha256:196800bc3ee6ee12d35e0c531c6d20a73652b0b676b23b834f8ecc6df4300a0e" as const;
export const D25_D24_BUNDLE_DIGEST =
	"sha256:93aa497b3583d73d5b958094fb6b1528ffe583e2310365cb36c45429c19771a1" as const;
export const D25_D24_GRAPH_EVIDENCE_DIGEST =
	"sha256:ba9c3facb68e648c03f04a551a71e5af4482a15a3a97dfbbd184b14e1edcff0a" as const;
export const D25_D24_GATE_DIGEST =
	"sha256:77d0a1eb5f7035c40ab7d523db3ce07507f0a632e3d21d4b252d77207fce7b55" as const;

const PROVIDER_RESULT_KEYS = Object.freeze([
	"effectKind",
	"evidenceDigest",
	"failureCode",
	"retryProposal",
	"status",
	"toolCalls",
	"usage",
] as const);
const TOOL_REFS = Object.freeze([
	"read-file",
	"replace-exact",
	"workspace-diff",
	"focused-validation",
] as const);

export type D25NamedToolRef = "read-file" | "replace-exact";
export type D25PhaseDisposition =
	| "accepted-inspection"
	| "accepted-mutation"
	| "provider-failed"
	| "provider-result-rejected"
	| "phase-tool-mismatch"
	| "mutation-proposal-cardinality";

export interface D25D24BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d25.d24-baseline-admission.v1";
}

export interface D25PhaseDirectiveV1 {
	readonly schemaVersion: typeof D25_DIRECTIVE_SCHEMA;
	readonly requestDigest: string;
	readonly runSequence: number;
	readonly phaseBefore: string;
	readonly namedToolRef: D25NamedToolRef;
	readonly maxAcceptedProposals: number;
	readonly deterministicSuccessors: readonly ("workspace-diff" | "focused-validation")[];
	readonly directiveDigest: string;
}

export interface D25AdmittedEffectV1 {
	readonly effect: CurrentGraphProviderAdmittedEffectV1;
	readonly phaseDirective: D25PhaseDirectiveV1 | null;
	readonly admittedEffectDigest: string;
}

export interface D25PhaseFactV1 {
	readonly schemaVersion: typeof D25_FACT_SCHEMA;
	readonly sequence: number;
	readonly arm: CurrentGraphProviderAdmittedEffectV1["request"]["arm"];
	readonly runSequence: number;
	readonly requestDigest: string;
	readonly admissionDigest: string;
	readonly directiveDigest: string;
	readonly phaseBefore: string;
	readonly namedToolRef: D25NamedToolRef;
	readonly proposalToolRefs: readonly string[];
	readonly proposalToolCallCount: number;
	readonly providerResultEvidenceDigest: string;
	readonly proposalDigest: string;
	readonly disposition: D25PhaseDisposition;
	readonly deterministicSuccessors: readonly ("workspace-diff" | "focused-validation")[];
	readonly providerFactDigest: string;
	readonly rejectionFactDigest: string | null;
	readonly reconciliationDigest: string;
	readonly factDigest: string;
}

export interface D25PhaseEvidenceV1 {
	readonly schemaVersion: typeof D25_EVIDENCE_SCHEMA;
	readonly decisionRef: typeof D25_DECISION_REF;
	readonly authorityRevision: typeof D25_AUTHORITY_REVISION;
	readonly d24ArtifactDigest: typeof D25_D24_ARTIFACT_DIGEST;
	readonly d24BundleDigest: typeof D25_D24_BUNDLE_DIGEST;
	readonly d24GraphEvidenceDigest: typeof D25_D24_GRAPH_EVIDENCE_DIGEST;
	readonly d24GateDigest: typeof D25_D24_GATE_DIGEST;
	readonly topology: Readonly<{
		runtimeFactNode: "current/d25/phase-tool-admission/runtime-facts";
		canonicalProjectionNode: "current/d25/phase-tool-admission/canonical-projection";
		topologyDigest: string;
	}>;
	readonly workflowEvidence: D9ProviderRejectionEvidenceV1;
	readonly phaseFacts: readonly D25PhaseFactV1[];
	readonly phaseFactCount: number;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D25PhaseAuthorityV1 {
	readonly revision: typeof D25_AUTHORITY_REVISION;
}

interface ActiveEffect {
	readonly admitted: D25AdmittedEffectV1;
	readonly effect: CurrentGraphProviderAdmittedEffectV1;
}

interface D25State {
	readonly owner: ReturnType<typeof graph>;
	readonly factNode: ReturnType<typeof createFactNode>;
	readonly workflow: D9ProviderRejectionAuthorityV1;
	readonly facts: D25PhaseFactV1[];
	active: ActiveEffect | null;
	nextSequence: number;
}

const states = new WeakMap<object, D25State>();
const admittedEffects = new WeakMap<
	object,
	Readonly<{ authority: object; requestDigest: string }>
>();
const baselines = new WeakMap<object, "consumed-d24-artifact" | "injected-test">();

function createFactNode(owner: ReturnType<typeof graph>) {
	return owner.node<D25PhaseFactV1>([], null, {
		name: "current/d25/phase-tool-admission/runtime-facts",
	});
}

function topology() {
	const material = strictSnapshot({
		runtimeFactNode: "current/d25/phase-tool-admission/runtime-facts" as const,
		canonicalProjectionNode: "current/d25/phase-tool-admission/canonical-projection" as const,
	});
	return Object.freeze({ ...material, topologyDigest: empiricalStrictJsonDigest(material) });
}

function stateFor(value: unknown): D25State {
	if (value === null || typeof value !== "object")
		throw new TypeError("D25 phase authority is invalid");
	const state = states.get(value);
	if (state === undefined) throw new TypeError("D25 phase authority is forged");
	return state;
}

function baselineCapability(basis: "consumed-d24-artifact" | "injected-test") {
	const capability = Object.freeze({
		revision: "graphrefly-ts.d25.d24-baseline-admission.v1" as const,
	});
	baselines.set(capability, basis);
	return capability;
}

export function admitD25D24Baseline(bytesValue: Uint8Array): D25D24BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D25 D24 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D25_D24_ARTIFACT_DIGEST)
		throw new TypeError("D25 D24 baseline artifact drifted");
	const bundle = validateD23LiveBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.disposition !== "success" ||
		bundle.bundleDigest !== D25_D24_BUNDLE_DIGEST ||
		bundle.graphEvidence?.evidenceDigest !== D25_D24_GRAPH_EVIDENCE_DIGEST ||
		bundle.gate.gateDigest !== D25_D24_GATE_DIGEST ||
		bundle.gate.passed !== false ||
		bundle.efficacyClaim !== "none"
	)
		throw new TypeError("D25 D24 baseline coordinates drifted");
	return baselineCapability("consumed-d24-artifact");
}

export function createD25InjectedBaselineForTest(): D25D24BaselineAdmissionV1 {
	return baselineCapability("injected-test");
}

export function consumeD25Baseline(
	value: unknown,
	expected: "consumed-d24-artifact" | "injected-test",
): void {
	if (value === null || typeof value !== "object") throw new TypeError("D25 baseline is invalid");
	const basis = baselines.get(value);
	baselines.delete(value);
	if (basis !== expected) throw new TypeError("D25 baseline is forged, replayed, or drifted");
}

function directiveFor(effect: CurrentGraphProviderAdmittedEffectV1): D25PhaseDirectiveV1 | null {
	if (effect.request.effectKind !== "provider-request") return null;
	const envelope = effect.runtime.modelEnvelope;
	if (envelope === null) throw new TypeError("D25 provider effect has no model envelope");
	const namedToolRef: D25NamedToolRef =
		envelope.phaseBefore === "none" ? "read-file" : "replace-exact";
	const base = strictSnapshot({
		schemaVersion: D25_DIRECTIVE_SCHEMA,
		requestDigest: effect.request.requestDigest,
		runSequence: effect.request.runSequence,
		phaseBefore: envelope.phaseBefore,
		namedToolRef,
		maxAcceptedProposals: namedToolRef === "replace-exact" ? 1 : 4,
		deterministicSuccessors:
			namedToolRef === "replace-exact"
				? (["workspace-diff", "focused-validation"] as const)
				: ([] as const),
	});
	return Object.freeze({ ...base, directiveDigest: empiricalStrictJsonDigest(base) });
}

export function createD25PhaseAuthority(input: {
	readonly limits: CurrentGraphProviderBudgetLimitsV1;
	readonly routeProfile: CurrentGraphProviderRouteProfileV1;
	readonly taskProfile: CurrentGraphProviderTaskProfileV1;
}): D25PhaseAuthorityV1 {
	const owner = graph({ name: "current/d25/phase-tool-admission" });
	const factNode = createFactNode(owner);
	const projectionNode = owner.node<D25PhaseFactV1>(
		[factNode],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) ctx.down([["DATA", fact]]);
		},
		{
			name: "current/d25/phase-tool-admission/canonical-projection",
			factory: "d25PhaseToolAdmissionProjection",
		},
	);
	const capability = Object.freeze({ revision: D25_AUTHORITY_REVISION });
	const state: D25State = {
		owner,
		factNode,
		workflow: createD9ProviderRejectionAuthority(input),
		facts: [],
		active: null,
		nextSequence: 1,
	};
	projectionNode.subscribe((message) => {
		if (message[0] === "DATA") state.facts.push(message[1] as D25PhaseFactV1);
	});
	states.set(capability, state);
	return capability;
}

export function takeD25AdmittedEffect(authority: D25PhaseAuthorityV1): D25AdmittedEffectV1 | null {
	const state = stateFor(authority);
	if (state.active !== null) throw new TypeError("D25 active effect has not been reconciled");
	const effect = takeD9ProviderEffect(state.workflow);
	if (effect === null) return null;
	const phaseDirective = directiveFor(effect);
	const material = strictSnapshot({
		requestDigest: effect.request.requestDigest,
		admissionDigest: effect.admission.decisionDigest,
		directiveDigest: phaseDirective?.directiveDigest ?? null,
	});
	const admitted = Object.freeze({
		effect,
		phaseDirective,
		admittedEffectDigest: empiricalStrictJsonDigest(material),
	});
	state.active = { admitted, effect };
	admittedEffects.set(admitted, {
		authority: authority as object,
		requestDigest: effect.request.requestDigest,
	});
	return admitted;
}

function toolRef(value: unknown, path: string): string {
	const call = record(value, path);
	const descriptor = Object.getOwnPropertyDescriptor(call, "toolRef");
	if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "string")
		throw new TypeError(`${path}.toolRef is invalid`);
	if (!TOOL_REFS.includes(descriptor.value as (typeof TOOL_REFS)[number]))
		throw new TypeError(`${path}.toolRef is unknown`);
	return descriptor.value;
}

function proposalProjection(value: unknown): Readonly<{
	toolRefs: readonly string[];
	toolCallCount: number;
	providerEvidenceDigest: string;
	proposalDigest: string;
	status: "completed" | "failed";
}> {
	const candidate = record(value, "D25 provider result");
	exactKeys(candidate, PROVIDER_RESULT_KEYS, "D25 provider result");
	if (candidate.effectKind !== "provider-request")
		throw new TypeError("D25 provider result kind drifted");
	if (candidate.status !== "completed" && candidate.status !== "failed")
		throw new TypeError("D25 provider result status drifted");
	digest(candidate.evidenceDigest, "D25 provider result evidence digest");
	const calls = array(candidate.toolCalls, "D25 provider result tool calls");
	if (calls.length > 32)
		return Object.freeze({
			toolRefs: [],
			toolCallCount: calls.length,
			providerEvidenceDigest: candidate.evidenceDigest as string,
			proposalDigest: empiricalStrictJsonDigest({
				evidenceDigest: candidate.evidenceDigest,
				toolRefs: [],
				toolCallCount: calls.length,
			}),
			status: candidate.status,
		});
	const refs = calls.map((call, index) => toolRef(call, `D25 provider result.toolCalls[${index}]`));
	return Object.freeze({
		toolRefs: Object.freeze(refs),
		toolCallCount: refs.length,
		providerEvidenceDigest: candidate.evidenceDigest as string,
		proposalDigest: empiricalStrictJsonDigest({
			evidenceDigest: candidate.evidenceDigest,
			toolRefs: refs,
			toolCallCount: refs.length,
		}),
		status: candidate.status,
	});
}

function projectedResult(
	resultValue: unknown,
	directive: D25PhaseDirectiveV1,
	proposal: ReturnType<typeof proposalProjection>,
): Readonly<{ result: unknown; disposition: D25PhaseDisposition }> {
	if (proposal.status === "failed")
		return Object.freeze({ result: resultValue, disposition: "provider-failed" as const });
	if (proposal.toolCallCount > 32)
		return Object.freeze({
			result: resultValue,
			disposition: "mutation-proposal-cardinality" as const,
		});
	if (directive.namedToolRef === "read-file") {
		if (
			proposal.toolRefs.length < 1 ||
			proposal.toolRefs.length > directive.maxAcceptedProposals ||
			proposal.toolRefs.some((ref) => ref !== "read-file")
		)
			return Object.freeze({
				result: failedPhaseResult(resultValue, directive, "phase-tool-mismatch"),
				disposition: "phase-tool-mismatch" as const,
			});
		return Object.freeze({ result: resultValue, disposition: "accepted-inspection" as const });
	}
	if (proposal.toolRefs.length !== 1)
		return Object.freeze({
			result: failedPhaseResult(resultValue, directive, "mutation-proposal-cardinality"),
			disposition: "mutation-proposal-cardinality" as const,
		});
	if (proposal.toolRefs[0] !== "replace-exact")
		return Object.freeze({
			result: failedPhaseResult(resultValue, directive, "phase-tool-mismatch"),
			disposition: "phase-tool-mismatch" as const,
		});
	const candidate = record(resultValue, "D25 accepted mutation result");
	const calls = array(candidate.toolCalls, "D25 accepted mutation tool calls");
	const mutation = strictSnapshot(calls[0]) as unknown as CurrentGraphRuntimeToolArgumentsV1;
	const result = strictSnapshot({
		...candidate,
		toolCalls: [
			mutation,
			{ toolRef: "workspace-diff" as const },
			{ toolRef: "focused-validation" as const },
		],
	});
	return Object.freeze({ result, disposition: "accepted-mutation" as const });
}

function failedPhaseResult(
	resultValue: unknown,
	directive: D25PhaseDirectiveV1,
	cause: "phase-tool-mismatch" | "mutation-proposal-cardinality",
): CurrentGraphProviderEffectResultInputV1 {
	const candidate = record(resultValue, "D25 rejected phase result");
	const usage = strictSnapshot(candidate.usage);
	return Object.freeze({
		effectKind: "provider-request" as const,
		status: "failed" as const,
		toolCalls: [] as const,
		failureCode: "provider-failed" as const,
		retryProposal: null,
		usage,
		evidenceDigest: empiricalStrictJsonDigest({
			requestDigest: directive.requestDigest,
			directiveDigest: directive.directiveDigest,
			cause,
			providerEvidenceDigest: candidate.evidenceDigest,
		}),
	}) as CurrentGraphProviderEffectResultInputV1;
}

function emitFact(
	state: D25State,
	effect: CurrentGraphProviderAdmittedEffectV1,
	directive: D25PhaseDirectiveV1,
	proposal: ReturnType<typeof proposalProjection>,
	disposition: D25PhaseDisposition,
	outcome: D9ProviderAdmissionOutcomeV1,
): D25PhaseFactV1 {
	const material = strictSnapshot({
		schemaVersion: D25_FACT_SCHEMA,
		sequence: state.nextSequence++,
		arm: effect.request.arm,
		runSequence: effect.request.runSequence,
		requestDigest: effect.request.requestDigest,
		admissionDigest: effect.admission.decisionDigest,
		directiveDigest: directive.directiveDigest,
		phaseBefore: directive.phaseBefore,
		namedToolRef: directive.namedToolRef,
		proposalToolRefs: proposal.toolRefs,
		proposalToolCallCount: proposal.toolCallCount,
		providerResultEvidenceDigest: proposal.providerEvidenceDigest,
		proposalDigest: proposal.proposalDigest,
		disposition:
			outcome.rejectionFact === null ? disposition : ("provider-result-rejected" as const),
		deterministicSuccessors:
			disposition === "accepted-mutation" ? directive.deterministicSuccessors : ([] as const),
		providerFactDigest: outcome.providerFact.factDigest,
		rejectionFactDigest: outcome.rejectionFact?.factDigest ?? null,
		reconciliationDigest: outcome.providerFact.reconciliation.reconciliationDigest,
	});
	const fact = Object.freeze({ ...material, factDigest: empiricalStrictJsonDigest(material) });
	state.factNode.down([["DATA", fact]]);
	return fact;
}

export function admitD25EffectResult(
	authority: D25PhaseAuthorityV1,
	admitted: D25AdmittedEffectV1,
	resultValue: unknown,
): D9ProviderAdmissionOutcomeV1 {
	const state = stateFor(authority);
	const active = state.active;
	const capability = admittedEffects.get(admitted as object);
	admittedEffects.delete(admitted as object);
	state.active = null;
	if (
		active === null ||
		active.admitted !== admitted ||
		capability?.authority !== (authority as object) ||
		capability.requestDigest !== active.effect.request.requestDigest
	)
		throw new TypeError("D25 admitted effect is forged or replayed");
	if (active.effect.request.effectKind !== "provider-request")
		return admitD9ProviderEffectResult(
			state.workflow,
			active.effect.request.requestDigest,
			resultValue,
		);
	const directive = active.admitted.phaseDirective;
	if (directive === null) throw new TypeError("D25 provider directive is missing");
	const proposal = proposalProjection(resultValue);
	const projection = projectedResult(resultValue, directive, proposal);
	const outcome = admitD9ProviderEffectResult(
		state.workflow,
		active.effect.request.requestDigest,
		projection.result,
	);
	emitFact(state, active.effect, directive, proposal, projection.disposition, outcome);
	return outcome;
}

function rebuildEvidence(
	workflowEvidence: D9ProviderRejectionEvidenceV1,
	facts: readonly D25PhaseFactV1[],
): D25PhaseEvidenceV1 {
	const material = strictSnapshot({
		schemaVersion: D25_EVIDENCE_SCHEMA,
		decisionRef: D25_DECISION_REF,
		authorityRevision: D25_AUTHORITY_REVISION,
		d24ArtifactDigest: D25_D24_ARTIFACT_DIGEST,
		d24BundleDigest: D25_D24_BUNDLE_DIGEST,
		d24GraphEvidenceDigest: D25_D24_GRAPH_EVIDENCE_DIGEST,
		d24GateDigest: D25_D24_GATE_DIGEST,
		topology: topology(),
		workflowEvidence,
		phaseFacts: facts,
		phaseFactCount: facts.length,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

export function snapshotD25PhaseEvidence(authority: D25PhaseAuthorityV1): D25PhaseEvidenceV1 {
	const state = stateFor(authority);
	if (state.active !== null) throw new TypeError("D25 cannot snapshot an active effect");
	return rebuildEvidence(
		validateD9ProviderRejectionEvidence(snapshotD9ProviderRejectionEvidence(state.workflow)),
		state.facts,
	);
}

function validateFact(value: unknown, path: string): D25PhaseFactV1 {
	const candidate = record(value, path);
	exactKeys(
		candidate,
		[
			"admissionDigest",
			"arm",
			"deterministicSuccessors",
			"directiveDigest",
			"disposition",
			"factDigest",
			"namedToolRef",
			"phaseBefore",
			"proposalDigest",
			"proposalToolCallCount",
			"proposalToolRefs",
			"providerFactDigest",
			"providerResultEvidenceDigest",
			"reconciliationDigest",
			"rejectionFactDigest",
			"requestDigest",
			"runSequence",
			"schemaVersion",
			"sequence",
		],
		path,
	);
	if (candidate.schemaVersion !== D25_FACT_SCHEMA) throw new TypeError(`${path} schema drifted`);
	for (const key of [
		"admissionDigest",
		"directiveDigest",
		"factDigest",
		"proposalDigest",
		"providerFactDigest",
		"providerResultEvidenceDigest",
		"reconciliationDigest",
		"requestDigest",
	] as const)
		digest(candidate[key], `${path}.${key}`);
	if (candidate.rejectionFactDigest !== null)
		digest(candidate.rejectionFactDigest, `${path}.rejectionFactDigest`);
	safeInteger(candidate.sequence, `${path}.sequence`, { min: 1, max: 256 });
	safeInteger(candidate.runSequence, `${path}.runSequence`, { min: 0, max: 11 });
	const refs = array(candidate.proposalToolRefs, `${path}.proposalToolRefs`);
	safeInteger(candidate.proposalToolCallCount, `${path}.proposalToolCallCount`, {
		min: 0,
		max: 4_096,
	});
	if (refs.length > 32 || refs.some((ref) => typeof ref !== "string" || ref.length > 64))
		throw new TypeError(`${path} proposal refs exceeded their bound`);
	const successors = array(candidate.deterministicSuccessors, `${path}.deterministicSuccessors`);
	if (
		successors.length > 2 ||
		successors.some((ref) => ref !== "workspace-diff" && ref !== "focused-validation")
	)
		throw new TypeError(`${path} deterministic successors drifted`);
	const { factDigest: _factDigest, ...base } = candidate;
	if (empiricalStrictJsonDigest(base) !== candidate.factDigest)
		throw new TypeError(`${path} digest drifted`);
	return strictSnapshot(candidate) as unknown as D25PhaseFactV1;
}

export function validateD25PhaseEvidence(value: unknown): D25PhaseEvidenceV1 {
	const candidate = record(value, "D25 evidence");
	exactKeys(
		candidate,
		[
			"authorityRevision",
			"causalAttribution",
			"d24ArtifactDigest",
			"d24BundleDigest",
			"d24GateDigest",
			"d24GraphEvidenceDigest",
			"decisionRef",
			"efficacyClaim",
			"evidenceDigest",
			"phaseFactCount",
			"phaseFacts",
			"schemaVersion",
			"topology",
			"workflowEvidence",
		],
		"D25 evidence",
	);
	if (
		candidate.schemaVersion !== D25_EVIDENCE_SCHEMA ||
		candidate.decisionRef !== D25_DECISION_REF ||
		candidate.authorityRevision !== D25_AUTHORITY_REVISION ||
		candidate.d24ArtifactDigest !== D25_D24_ARTIFACT_DIGEST ||
		candidate.d24BundleDigest !== D25_D24_BUNDLE_DIGEST ||
		candidate.d24GraphEvidenceDigest !== D25_D24_GRAPH_EVIDENCE_DIGEST ||
		candidate.d24GateDigest !== D25_D24_GATE_DIGEST ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none"
	)
		throw new TypeError("D25 evidence coordinates drifted");
	const workflow = validateD9ProviderRejectionEvidence(candidate.workflowEvidence);
	const rawFacts = array(candidate.phaseFacts, "D25 evidence.phaseFacts");
	if (rawFacts.length === 0 || rawFacts.length > 128)
		throw new TypeError("D25 phase fact bound drifted");
	const facts = rawFacts.map((fact, index) =>
		validateFact(fact, `D25 evidence.phaseFacts[${index}]`),
	);
	if (candidate.phaseFactCount !== facts.length)
		throw new TypeError("D25 phase fact count drifted");
	const providerFacts = workflow.providerEvidence.facts.filter(
		(fact) => fact.request.effectKind === "provider-request",
	);
	if (providerFacts.length !== facts.length)
		throw new TypeError("D25 provider/phase fact bijection drifted");
	const seen = new Set<string>();
	const workflowFacts = workflow.providerEvidence.workflowEvidence.facts;
	const rejectionByDigest = new Map(
		workflow.rejectionFacts.map((fact) => [fact.factDigest, fact] as const),
	);
	const allProviderFacts = workflow.providerEvidence.facts;
	for (const [index, fact] of facts.entries()) {
		const provider = providerFacts[index];
		const workflowFact =
			provider === undefined
				? undefined
				: workflowFacts.find(
						(candidate) =>
							candidate.request.requestDigest === provider.request.sourceWorkflowRequestDigest,
					);
		if (
			provider === undefined ||
			workflowFact === undefined ||
			seen.has(fact.requestDigest) ||
			fact.arm !== provider.arm ||
			fact.runSequence !== provider.runSequence ||
			fact.requestDigest !== provider.request.requestDigest ||
			fact.admissionDigest !== provider.admission.decisionDigest ||
			fact.providerFactDigest !== provider.factDigest ||
			fact.reconciliationDigest !== provider.reconciliation.reconciliationDigest
		)
			throw new TypeError("D25 phase fact lost its Graph admission binding");
		seen.add(fact.requestDigest);
		const expectedNamedTool =
			workflowFact.request.phaseBefore === "none"
				? ("read-file" as const)
				: ("replace-exact" as const);
		const expectedDirectiveBase = strictSnapshot({
			schemaVersion: D25_DIRECTIVE_SCHEMA,
			requestDigest: provider.request.requestDigest,
			runSequence: provider.runSequence,
			phaseBefore: workflowFact.request.phaseBefore,
			namedToolRef: expectedNamedTool,
			maxAcceptedProposals: expectedNamedTool === "replace-exact" ? 1 : 4,
			deterministicSuccessors:
				expectedNamedTool === "replace-exact"
					? (["workspace-diff", "focused-validation"] as const)
					: ([] as const),
		});
		if (
			fact.phaseBefore !== workflowFact.request.phaseBefore ||
			fact.namedToolRef !== expectedNamedTool ||
			fact.directiveDigest !== empiricalStrictJsonDigest(expectedDirectiveBase)
		)
			throw new TypeError("D25 phase directive drifted");
		const expectedProposalDigest = empiricalStrictJsonDigest({
			evidenceDigest: fact.providerResultEvidenceDigest,
			toolRefs: fact.proposalToolRefs,
			toolCallCount: fact.proposalToolCallCount,
		});
		if (fact.proposalDigest !== expectedProposalDigest)
			throw new TypeError("D25 provider proposal projection drifted");
		const rejection =
			fact.rejectionFactDigest === null
				? null
				: (rejectionByDigest.get(fact.rejectionFactDigest) ?? undefined);
		if (
			(fact.disposition === "provider-result-rejected") !==
				(rejection !== null && rejection !== undefined) ||
			(rejection !== null &&
				rejection !== undefined &&
				(rejection.request.requestDigest !== fact.requestDigest ||
					rejection.providerFactDigest !== fact.providerFactDigest))
		)
			throw new TypeError("D25 provider rejection reverse binding drifted");
		if (fact.disposition === "accepted-mutation") {
			if (
				fact.namedToolRef !== "replace-exact" ||
				fact.proposalToolRefs.length !== 1 ||
				fact.proposalToolRefs[0] !== "replace-exact" ||
				fact.deterministicSuccessors.join(",") !== "workspace-diff,focused-validation"
			)
				throw new TypeError("D25 accepted mutation lifecycle drifted");
			const position = allProviderFacts.findIndex(
				(candidate) => candidate.factDigest === provider.factDigest,
			);
			const mutation = allProviderFacts[position + 1];
			if (
				mutation?.arm !== fact.arm ||
				mutation.runSequence !== fact.runSequence ||
				mutation.request.effectKind !== "tool-action" ||
				mutation.request.toolRef !== "replace-exact" ||
				mutation.result.effectKind !== "tool-action"
			)
				throw new TypeError("D25 mutation proposal lost its Graph tool admission");
			if (mutation.result.status === "succeeded") {
				const diff = allProviderFacts[position + 2];
				if (
					diff?.arm !== fact.arm ||
					diff.runSequence !== fact.runSequence ||
					diff.request.effectKind !== "tool-action" ||
					diff.request.toolRef !== "workspace-diff" ||
					diff.result.effectKind !== "tool-action"
				)
					throw new TypeError("D25 deterministic mutation lifecycle lost serial Graph admission");
				if (diff.result.status === "succeeded") {
					const focused = allProviderFacts[position + 3];
					if (
						focused?.arm !== fact.arm ||
						focused.runSequence !== fact.runSequence ||
						focused.request.effectKind !== "tool-action" ||
						focused.request.toolRef !== "focused-validation" ||
						focused.result.effectKind !== "tool-action"
					)
						throw new TypeError("D25 deterministic mutation lifecycle lost serial Graph admission");
				}
			} else if (
				mutation.result.causeCode !== "exact-replacement-not-applicable" ||
				mutation.result.workspaceStateBeforeDigest !== mutation.result.workspaceStateAfterDigest
			) {
				throw new TypeError("D25 failed mutation lifecycle drifted");
			}
		} else if (fact.disposition === "accepted-inspection") {
			if (
				fact.proposalToolCallCount !== fact.proposalToolRefs.length ||
				fact.proposalToolRefs.some((ref) => ref !== "read-file")
			)
				throw new TypeError("D25 accepted inspection lifecycle drifted");
		} else if (fact.deterministicSuccessors.length !== 0)
			throw new TypeError("D25 non-mutation fact scheduled deterministic successors");
	}
	const retryGroups = new Map<string, D25PhaseFactV1[]>();
	for (const fact of facts) {
		const provider = providerFacts.find(
			(candidate) => candidate.factDigest === fact.providerFactDigest,
		);
		const logical = provider?.request.logicalRequestDigest;
		if (logical === null || logical === undefined) continue;
		const group = retryGroups.get(logical) ?? [];
		group.push(fact);
		retryGroups.set(logical, group);
	}
	for (const group of retryGroups.values()) {
		if (group.length < 2) continue;
		const first = group[0]!;
		if (
			group.some(
				(fact) =>
					fact.phaseBefore !== first.phaseBefore || fact.namedToolRef !== first.namedToolRef,
			)
		)
			throw new TypeError("D25 retry phase directive identity drifted");
	}
	const rebuilt = rebuildEvidence(workflow, facts);
	if (empiricalStrictJsonDigest(candidate) !== empiricalStrictJsonDigest(rebuilt))
		throw new TypeError("D25 evidence canonical replay drifted");
	return rebuilt;
}
