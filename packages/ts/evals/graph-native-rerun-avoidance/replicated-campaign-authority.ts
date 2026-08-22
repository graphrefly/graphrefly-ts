import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import { digest, empiricalStrictJsonDigest, record, strictSnapshot } from "./canonical.js";
import { D65_D64_BASELINE_PROJECTION } from "./frozen-baseline-fixture.js";
import type { D43TaskOutcome } from "./graph-harness-authority.js";
import {
	type D45CanonicalEvidenceV1,
	type D45FactV1,
	type D45PartialCanonicalEvidenceV1,
	validateD45CanonicalEvidence,
	validateD45PartialCanonicalEvidence,
} from "./graph-tool-authority.js";
import {
	D45_ASSIGNMENT,
	D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
	D45_TASK_ENVELOPE_DIGEST,
} from "./graph-tool-qualification.js";
import {
	createD43ModelHarnessPolicy,
	D43_ARMS,
	D43_ENHANCEMENT_RECIPES,
	type D43Arm,
} from "./model-harness-policy.js";

export const D65_AUTHORITY_REVISION = "graphrefly-ts.d65.replicated-campaign-authority.v1" as const;
export const D65_EFFECT_SCHEMA = "graphrefly-ts.d65.replicate-effect.v1" as const;
export const D65_EXECUTION_SCHEMA = "graphrefly-ts.d65.replicate-execution.v1" as const;
export const D65_FACT_SCHEMA = "graphrefly-ts.d65.campaign-fact.v1" as const;
export const D65_EVIDENCE_SCHEMA = "graphrefly-ts.d65.campaign-evidence.v1" as const;
export const D65_REPLICATE_COUNT = 5 as const;
export const D65_CONTINUATION_HARD_CAP_MICROUSD = 6_000_000 as const;
export const D65_D64_ARTIFACT_DIGEST =
	"sha256:dfc62744098575a040dad4f3e102c173d428f0a20c48ce980a8b8e79b10b1a8a" as const;
export const D65_D64_BUNDLE_DIGEST =
	"sha256:9845e85a9e0302208bde616c79a9c24ed5950d4c4a957e9bdb67042e72af6b65" as const;
export const D65_D64_EVIDENCE_DIGEST =
	"sha256:e334d13e1908f2e7ddc97e247de9081ad5eee5e85b81f7ee5ff5d718ff43cf89" as const;

export interface D65ReplicateProjectionV1 {
	readonly replicateIndex: number;
	readonly source: "d64-preincluded" | "d65-continuation";
	readonly evidenceDigest: string;
	readonly executionShapeDigest: string;
	readonly arms: readonly Readonly<{
		readonly arm: D43Arm;
		readonly completed: boolean;
		readonly cleanupCompleted: boolean;
		readonly evaluable: boolean;
		readonly taskOutcome: D43TaskOutcome;
	}>[];
	readonly providerAttempts: number;
	readonly confirmedCostMicrousd: number;
	readonly confirmedElapsedMs: number;
	readonly projectionDigest: string;
}

export interface D65AdmittedReplicateV1 {
	readonly schemaVersion: typeof D65_EFFECT_SCHEMA;
	readonly replicateIndex: 2 | 3 | 4 | 5;
	readonly remainingContinuationCostMicrousd: number;
	readonly priorReplicatesDigest: string;
	readonly runBindingDigest: string;
	readonly assignmentRef: string;
	readonly campaignRef: string;
	readonly policyDigest: string;
	readonly admissionDigest: string;
}

export interface D65ReplicateExecutionV1 {
	readonly schemaVersion: typeof D65_EXECUTION_SCHEMA;
	readonly replicateAdmission: D65AdmittedReplicateV1;
	readonly executionDigest: string;
}

export type D65CampaignModeV1 = Readonly<{
	executionClass: "qualification";
	liveClaimDigest: null;
}>;

type D65CampaignFactV1 =
	| Readonly<{
			schemaVersion: typeof D65_FACT_SCHEMA;
			sequence: number;
			factKind: "baseline-admitted";
			artifactDigest: string;
			bundleDigest: string;
			replicate: D65ReplicateProjectionV1;
			factDigest: string;
	  }>
	| Readonly<{
			schemaVersion: typeof D65_FACT_SCHEMA;
			sequence: number;
			factKind: "replicate-execution-started";
			execution: D65ReplicateExecutionV1;
			factDigest: string;
	  }>
	| Readonly<{
			schemaVersion: typeof D65_FACT_SCHEMA;
			sequence: number;
			factKind: "replicate-admitted";
			effect: D65AdmittedReplicateV1;
			factDigest: string;
	  }>
	| Readonly<{
			schemaVersion: typeof D65_FACT_SCHEMA;
			sequence: number;
			factKind: "replicate-result";
			admissionDigest: string;
			executionDigest: string;
			retryWaitElapsedMs: number;
			replicate: D65ReplicateProjectionV1;
			evidence: D45CanonicalEvidenceV1;
			factDigest: string;
	  }>
	| Readonly<{
			schemaVersion: typeof D65_FACT_SCHEMA;
			sequence: number;
			factKind: "replicate-partial-result";
			admissionDigest: string;
			executionDigest: string;
			retryWaitElapsedMs: number;
			partialEvidence: D45PartialCanonicalEvidenceV1;
			factDigest: string;
	  }>
	| Readonly<{
			schemaVersion: typeof D65_FACT_SCHEMA;
			sequence: number;
			factKind: "campaign-terminal";
			causeCode: "aggregate-budget-exhausted";
			continuationConfirmedCostMicrousd: number;
			factDigest: string;
	  }>;

export interface D65CampaignEvidenceV1 {
	readonly schemaVersion: typeof D65_EVIDENCE_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D65";
	readonly authorityRevision: typeof D65_AUTHORITY_REVISION;
	readonly baselineArtifactDigest: string;
	readonly baselineBundleDigest: string;
	readonly executionShapeDigest: string;
	readonly campaignMode: D65CampaignModeV1;
	readonly facts: readonly D65CampaignFactV1[];
	readonly replicates: readonly D65ReplicateProjectionV1[];
	readonly continuationProviderAttempts: number;
	readonly continuationConfirmedCostMicrousd: number;
	readonly continuationConfirmedElapsedMs: number;
	readonly exactFiveReplicatesCompleted: true;
	readonly exactThirtyArmsEvaluable: boolean;
	readonly relevantPassCount: number;
	readonly controlPassCounts: Readonly<Record<Exclude<D43Arm, "relevant-applied">, number>>;
	readonly optionalStoppingAllowed: false;
	readonly selectiveDiscardAllowed: false;
	readonly maxActiveReplicatesObserved: 1;
	readonly frozenGatePassed: boolean;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D65PartialCampaignEvidenceV1 {
	readonly schemaVersion: "graphrefly-ts.d65.partial-campaign-evidence.v1";
	readonly decisionRef: "graphrefly-ts:D65";
	readonly authorityRevision: typeof D65_AUTHORITY_REVISION;
	readonly baselineArtifactDigest: string;
	readonly baselineBundleDigest: string;
	readonly executionShapeDigest: string;
	readonly campaignMode: D65CampaignModeV1;
	readonly facts: readonly D65CampaignFactV1[];
	readonly completedReplicates: readonly D65ReplicateProjectionV1[];
	readonly terminalCauseCode: "replicate-partial-failure" | "aggregate-budget-exhausted";
	readonly activeReplicate: D65AdmittedReplicateV1 | null;
	readonly partialReplicateEvidence: D45PartialCanonicalEvidenceV1 | null;
	readonly continuationConfirmedCostMicrousd: number;
	readonly continuationConfirmedElapsedMs: number;
	readonly exactFiveReplicatesCompleted: false;
	readonly frozenGatePassed: false;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D65GraphCampaignAuthorityV1 {
	readonly revision: typeof D65_AUTHORITY_REVISION;
}

interface AuthorityState {
	readonly owner: ReturnType<typeof graph>;
	readonly factNode: ReturnType<typeof createFactNode>;
	readonly baselineArtifactDigest: string;
	readonly baselineBundleDigest: string;
	readonly executionShapeDigest: string;
	readonly campaignMode: D65CampaignModeV1;
	readonly facts: D65CampaignFactV1[];
	readonly replicates: D65ReplicateProjectionV1[];
	nextFactSequence: number;
	active: D65AdmittedReplicateV1 | null;
	execution: D65ReplicateExecutionV1 | null;
	terminalCauseCode: D65PartialCampaignEvidenceV1["terminalCauseCode"] | null;
	partialReplicateEvidence: D45PartialCanonicalEvidenceV1 | null;
	partialRetryWaitElapsedMs: number;
}

const states = new WeakMap<object, AuthorityState>();
const effectOwners = new WeakMap<object, object>();
const executionOwners = new WeakMap<object, object>();
const consumedExecutions = new WeakSet<object>();

function createFactNode(owner: ReturnType<typeof graph>) {
	return owner.node<D65CampaignFactV1>([], null, { name: "d65/canonical-facts" });
}

function campaignState(authority: D65GraphCampaignAuthorityV1): AuthorityState {
	const state = states.get(authority as object);
	if (state === undefined) throw new TypeError("D65 campaign authority is forged");
	return state;
}

function campaignFact<T extends Omit<D65CampaignFactV1, "factDigest">>(value: T) {
	const material = strictSnapshot(value);
	return Object.freeze({
		...material,
		factDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D65CampaignFactV1;
}

type D65ReplicateBinding = Pick<
	D65AdmittedReplicateV1,
	"replicateIndex" | "runBindingDigest" | "remainingContinuationCostMicrousd"
>;

export function d65ReplicateCampaignRef(effect: D65ReplicateBinding): string {
	return `campaign.memory-rerun-avoidance.six-arm.d65-r${effect.replicateIndex}-${effect.runBindingDigest.slice(7, 23)}`;
}

export function d65ReplicateAssignmentRef(effect: D65ReplicateBinding): string {
	return `assignment.deepseek-deepinfra-fp8.d65-r${effect.replicateIndex}-${effect.runBindingDigest.slice(7, 23)}`;
}

export function createD65ReplicatePolicy(admission: D65ReplicateBinding) {
	const maxCostMicrousd = admission.remainingContinuationCostMicrousd;
	if (
		!Number.isSafeInteger(maxCostMicrousd) ||
		maxCostMicrousd < 100_000 ||
		maxCostMicrousd > D65_CONTINUATION_HARD_CAP_MICROUSD
	)
		throw new TypeError("D65 replicate cost headroom is outside its admitted range");
	return createD43ModelHarnessPolicy({
		policyRef: `model-policy.deepseek-v4-flash-0731.deepinfra-fp8.d65-r${admission.replicateIndex}-${admission.runBindingDigest.slice(7, 23)}`,
		model: {
			profileRef: "model-profile.deepseek-v4-flash-0731.d45-v1",
			modelRef: D45_ASSIGNMENT.modelRef,
			supportsNamedToolChoice: true,
			supportsParallelToolCalls: false,
			inspectionMaxOutputTokens: 65_536,
			mutationMaxOutputTokens: 16_384,
		},
		provider: {
			bindingRef: "provider-binding.deepinfra-fp8-chat.d45-v1",
			providerRef: D45_ASSIGNMENT.providerRef,
			endpointProtocol: "chat-completions",
			namedToolChoiceEncoding: "function-object",
			allowFallback: false,
			allowProviderSwitch: false,
			allowParallelEffects: false,
			providerDeadlineMs: 600_000,
		},
		campaign: {
			campaignRef: d65ReplicateCampaignRef(admission),
			arms: D43_ARMS,
			maxProviderAttempts: 96,
			maxCostMicrousd,
			maxElapsedMs: 7_200_000,
			localEffectReservationMs: 10_000,
			providerReservationMicrousd: 100_000,
			publicSemanticScenarioSetDigest: D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
			taskEnvelopeDigest: D45_TASK_ENVELOPE_DIGEST,
			maxSameLogicalRequestRetries: 1,
			retryClasses: ["D671", "D675", "D710"],
		},
		enhancementRecipes: D43_ENHANCEMENT_RECIPES,
	});
}

function projectReplicate(
	evidenceValue: unknown,
	replicateIndex: number,
	source: D65ReplicateProjectionV1["source"],
	expectedAdmission: D65AdmittedReplicateV1 | null,
): Readonly<{ evidence: D45CanonicalEvidenceV1; projection: D65ReplicateProjectionV1 }> {
	const evidence = validateD45CanonicalEvidence(evidenceValue);
	if (
		!evidence.exactSixArmsCompleted ||
		evidence.lifecycle.arms.length !== D43_ARMS.length ||
		evidence.lifecycle.arms.some(
			(arm, index) => arm.arm !== D43_ARMS[index] || !arm.completed || !arm.cleanupCompleted,
		)
	)
		throw new TypeError("D65 replicate is not an exact complete cleaned six-arm measurement");
	if (source === "d64-preincluded") {
		if (expectedAdmission !== null || evidence.evidenceDigest !== D65_D64_EVIDENCE_DIGEST)
			throw new TypeError("D65 baseline evidence drifted from immutable D64");
	} else {
		if (expectedAdmission === null || expectedAdmission.replicateIndex !== replicateIndex)
			throw new TypeError("D65 continuation lost its exact replicate admission");
		if (
			evidence.lifecycle.policy.campaign.maxCostMicrousd !==
				expectedAdmission.remainingContinuationCostMicrousd ||
			evidence.lifecycle.policy.policyDigest !== expectedAdmission.policyDigest ||
			evidence.lifecycle.policy.campaign.campaignRef !== expectedAdmission.campaignRef ||
			evidence.lifecycle.plan.campaignRef !== expectedAdmission.campaignRef ||
			evidence.lifecycle.plan.assignmentRef !== expectedAdmission.assignmentRef
		)
			throw new TypeError("D65 continuation policy was not bound to its exact Graph admission");
	}
	const policy = evidence.lifecycle.policy;
	const {
		maxCostMicrousd: _maxCostMicrousd,
		campaignRef: _campaignRef,
		campaignDigest: _campaignDigest,
		...campaign
	} = policy.campaign;
	const providerAdmissions = evidence.facts.filter(
		(fact): fact is Extract<D45FactV1, { factKind: "effect-admitted" }> =>
			fact.factKind === "effect-admitted" && fact.effect.effectKind === "provider-proposal",
	);
	if (providerAdmissions.length < 1)
		throw new TypeError("D65 replicate omitted provider route-profile admissions");
	const providerAdmissionProfile = strictSnapshot({
		modelRef: providerAdmissions[0]!.effect.modelRef,
		providerRef: providerAdmissions[0]!.effect.providerRef,
		endpointProtocol: providerAdmissions[0]!.effect.endpointProtocol,
		namedToolChoiceEncoding: providerAdmissions[0]!.effect.namedToolChoiceEncoding,
		reasoningEffort: providerAdmissions[0]!.effect.reasoningEffort,
		requireParameters: providerAdmissions[0]!.effect.requireParameters,
		taskEnvelopeDigest: providerAdmissions[0]!.effect.taskEnvelopeDigest,
	});
	if (
		providerAdmissions.some(
			(fact) =>
				empiricalStrictJsonDigest({
					modelRef: fact.effect.modelRef,
					providerRef: fact.effect.providerRef,
					endpointProtocol: fact.effect.endpointProtocol,
					namedToolChoiceEncoding: fact.effect.namedToolChoiceEncoding,
					reasoningEffort: fact.effect.reasoningEffort,
					requireParameters: fact.effect.requireParameters,
					taskEnvelopeDigest: fact.effect.taskEnvelopeDigest,
				}) !== empiricalStrictJsonDigest(providerAdmissionProfile),
		)
	)
		throw new TypeError("D65 provider route-profile coordinates changed within a replicate");
	const executionShapeDigest = empiricalStrictJsonDigest({
		model: policy.model,
		provider: policy.provider,
		campaign,
		enhancementRecipes: policy.enhancementRecipes,
		providerAdmissionProfile,
		plan: {
			modelRef: evidence.lifecycle.plan.modelRef,
			providerRef: evidence.lifecycle.plan.providerRef,
		},
	});
	const arms = Object.freeze(
		evidence.lifecycle.arms.map((arm) =>
			Object.freeze({
				arm: arm.arm,
				completed: arm.completed,
				cleanupCompleted: arm.cleanupCompleted,
				evaluable: arm.evaluable,
				taskOutcome: arm.taskOutcome,
			}),
		),
	);
	const material = strictSnapshot({
		replicateIndex,
		source,
		evidenceDigest: evidence.evidenceDigest,
		executionShapeDigest,
		arms,
		providerAttempts: evidence.budget.providerAttempts,
		confirmedCostMicrousd: evidence.budget.confirmedCostMicrousd,
		confirmedElapsedMs: evidence.budget.confirmedElapsedMs,
	});
	return Object.freeze({
		evidence,
		projection: Object.freeze({
			...material,
			projectionDigest: empiricalStrictJsonDigest(material),
		}),
	});
}

function exactBaselineProjection(value: unknown): D65ReplicateProjectionV1 {
	const candidate = strictSnapshot(value) as unknown as D65ReplicateProjectionV1;
	if (
		empiricalStrictJsonDigest(candidate) !==
			empiricalStrictJsonDigest(D65_D64_BASELINE_PROJECTION) ||
		candidate.projectionDigest !== D65_D64_BASELINE_PROJECTION.projectionDigest ||
		candidate.evidenceDigest !== D65_D64_EVIDENCE_DIGEST
	)
		throw new TypeError("D65 tracked material-free D64 projection drifted");
	return D65_D64_BASELINE_PROJECTION;
}

function applyFact(state: AuthorityState, fact: D65CampaignFactV1): void {
	if (fact.sequence !== state.facts.length + 1)
		throw new TypeError("D65 campaign fact sequence drifted");
	if (state.facts.some((item) => item.factDigest === fact.factDigest))
		throw new TypeError("D65 campaign fact replay was rejected");
	if (fact.factKind === "baseline-admitted") {
		if (state.facts.length !== 0 || fact.replicate.replicateIndex !== 1)
			throw new TypeError("D65 baseline admission order drifted");
		state.replicates.push(fact.replicate);
	} else if (fact.factKind === "replicate-admitted") {
		if (
			state.terminalCauseCode !== null ||
			state.active !== null ||
			fact.effect.replicateIndex !== state.replicates.length + 1 ||
			fact.effect.replicateIndex > D65_REPLICATE_COUNT
		)
			throw new TypeError("D65 admitted overlapping or out-of-order replicate");
		state.active = fact.effect;
	} else if (fact.factKind === "replicate-execution-started") {
		if (
			state.terminalCauseCode !== null ||
			state.active === null ||
			state.execution !== null ||
			fact.execution.replicateAdmission.admissionDigest !== state.active.admissionDigest
		)
			throw new TypeError("D65 replicate execution lost its exact Graph admission");
		state.execution = fact.execution;
	} else if (fact.factKind === "replicate-result") {
		if (
			state.terminalCauseCode !== null ||
			state.active === null ||
			state.execution === null ||
			fact.admissionDigest !== state.active.admissionDigest ||
			fact.executionDigest !== state.execution.executionDigest ||
			fact.replicate.replicateIndex !== state.active.replicateIndex ||
			fact.replicate.executionShapeDigest !== state.executionShapeDigest
		)
			throw new TypeError("D65 replicate result lost its exact Graph admission");
		state.replicates.push(fact.replicate);
		state.active = null;
		state.execution = null;
	} else if (fact.factKind === "replicate-partial-result") {
		if (
			state.terminalCauseCode !== null ||
			state.active === null ||
			state.execution === null ||
			fact.admissionDigest !== state.active.admissionDigest ||
			fact.executionDigest !== state.execution.executionDigest
		)
			throw new TypeError("D65 partial result lost its exact Graph admission");
		state.partialReplicateEvidence = fact.partialEvidence;
		state.partialRetryWaitElapsedMs = fact.retryWaitElapsedMs;
		state.terminalCauseCode = "replicate-partial-failure";
		state.active = null;
		state.execution = null;
	} else {
		if (
			state.terminalCauseCode !== null ||
			state.active !== null ||
			state.execution !== null ||
			fact.continuationConfirmedCostMicrousd !== continuationCost(state) ||
			D65_CONTINUATION_HARD_CAP_MICROUSD - fact.continuationConfirmedCostMicrousd >= 100_000
		)
			throw new TypeError("D65 aggregate terminal overlapped active campaign state");
		state.terminalCauseCode = fact.causeCode;
	}
	state.facts.push(fact);
}

function emit(state: AuthorityState, value: D65CampaignFactV1): void {
	state.factNode.down([["DATA", value]]);
}

export function createD65GraphCampaignAuthority(input: {
	readonly baselineArtifactDigest: string;
	readonly baselineBundleDigest: string;
	readonly baselineProjection: unknown;
	readonly campaignMode: D65CampaignModeV1;
}): D65GraphCampaignAuthorityV1 {
	const baselineArtifactDigest = digest(input.baselineArtifactDigest, "D65 baseline artifact");
	const baselineBundleDigest = digest(input.baselineBundleDigest, "D65 baseline bundle");
	if (
		baselineArtifactDigest !== D65_D64_ARTIFACT_DIGEST ||
		baselineBundleDigest !== D65_D64_BUNDLE_DIGEST
	)
		throw new TypeError("D65 baseline artifact coordinates drifted from immutable D64");
	const baseline = exactBaselineProjection(input.baselineProjection);
	const campaignMode = strictSnapshot(input.campaignMode) as D65CampaignModeV1;
	if (campaignMode.executionClass !== "qualification" || campaignMode.liveClaimDigest !== null)
		throw new TypeError("D65 campaign execution class lost its exact live-claim coordinate");
	const owner = graph({ name: "d65/replicated-efficacy-campaign" });
	const factNode = createFactNode(owner);
	let state!: AuthorityState;
	const projectionNode = owner.node<D65CampaignFactV1>(
		[factNode],
		(ctx) => {
			for (const item of (depBatch(ctx, 0) ?? []) as readonly D65CampaignFactV1[]) {
				applyFact(state, item);
				ctx.down([["DATA", item]]);
			}
		},
		{ name: "d65/canonical-projection", factory: "d65ReplicatedCampaignProjection" },
	);
	const authority = Object.freeze({ revision: D65_AUTHORITY_REVISION });
	state = {
		owner,
		factNode,
		baselineArtifactDigest,
		baselineBundleDigest,
		executionShapeDigest: baseline.executionShapeDigest,
		campaignMode,
		facts: [],
		replicates: [],
		nextFactSequence: 1,
		active: null,
		execution: null,
		terminalCauseCode: null,
		partialReplicateEvidence: null,
		partialRetryWaitElapsedMs: 0,
	};
	projectionNode.subscribe(() => undefined);
	states.set(authority, state);
	emit(
		state,
		campaignFact({
			schemaVersion: D65_FACT_SCHEMA,
			sequence: state.nextFactSequence++,
			factKind: "baseline-admitted",
			artifactDigest: baselineArtifactDigest,
			bundleDigest: baselineBundleDigest,
			replicate: baseline,
		}),
	);
	return authority;
}

function continuationCost(state: AuthorityState): number {
	return state.replicates
		.filter((replicate) => replicate.source === "d65-continuation")
		.reduce((total, replicate) => total + replicate.confirmedCostMicrousd, 0);
}

export function takeD65AdmittedReplicate(
	authority: D65GraphCampaignAuthorityV1,
): D65AdmittedReplicateV1 | null {
	const state = campaignState(authority);
	if (state.active !== null) throw new TypeError("D65 active replicate has not been reconciled");
	if (state.terminalCauseCode !== null) return null;
	if (state.replicates.length === D65_REPLICATE_COUNT) return null;
	const replicateIndex = state.replicates.length + 1;
	if (replicateIndex < 2 || replicateIndex > 5)
		throw new TypeError("D65 next replicate index escaped its frozen range");
	const remainingContinuationCostMicrousd =
		D65_CONTINUATION_HARD_CAP_MICROUSD - continuationCost(state);
	if (remainingContinuationCostMicrousd < 100_000) {
		emit(
			state,
			campaignFact({
				schemaVersion: D65_FACT_SCHEMA,
				sequence: state.nextFactSequence++,
				factKind: "campaign-terminal",
				causeCode: "aggregate-budget-exhausted",
				continuationConfirmedCostMicrousd: continuationCost(state),
			}),
		);
		return null;
	}
	const priorReplicatesDigest = empiricalStrictJsonDigest(state.replicates);
	const runBindingDigest = empiricalStrictJsonDigest({
		replicateIndex,
		remainingContinuationCostMicrousd,
		priorReplicatesDigest,
		campaignMode: state.campaignMode,
	});
	const binding = Object.freeze({
		replicateIndex: replicateIndex as 2 | 3 | 4 | 5,
		remainingContinuationCostMicrousd,
		runBindingDigest,
	});
	const policy = createD65ReplicatePolicy(binding);
	const material = strictSnapshot({
		schemaVersion: D65_EFFECT_SCHEMA,
		replicateIndex: binding.replicateIndex,
		remainingContinuationCostMicrousd,
		priorReplicatesDigest,
		runBindingDigest,
		assignmentRef: d65ReplicateAssignmentRef(binding),
		campaignRef: d65ReplicateCampaignRef(binding),
		policyDigest: policy.policyDigest,
	});
	const effect = Object.freeze({
		...material,
		admissionDigest: empiricalStrictJsonDigest(material),
	});
	emit(
		state,
		campaignFact({
			schemaVersion: D65_FACT_SCHEMA,
			sequence: state.nextFactSequence++,
			factKind: "replicate-admitted",
			effect,
		}),
	);
	const admitted = campaignState(authority).active;
	if (admitted === null || admitted.admissionDigest !== effect.admissionDigest)
		throw new TypeError("D65 Graph did not project the admitted replicate");
	effectOwners.set(admitted, authority);
	return admitted;
}

export function startD65ReplicateExecution(
	authority: D65GraphCampaignAuthorityV1,
	effect: D65AdmittedReplicateV1,
): D65ReplicateExecutionV1 {
	const state = campaignState(authority);
	if (
		state.active !== effect ||
		effectOwners.get(effect) !== authority ||
		state.execution !== null ||
		state.terminalCauseCode !== null
	)
		throw new TypeError(
			"D65 replicate execution capability is forged, substituted, stale, or spent",
		);
	const material = strictSnapshot({
		schemaVersion: D65_EXECUTION_SCHEMA,
		replicateAdmission: effect,
	});
	const execution = Object.freeze({
		...material,
		executionDigest: empiricalStrictJsonDigest(material),
	});
	emit(
		state,
		campaignFact({
			schemaVersion: D65_FACT_SCHEMA,
			sequence: state.nextFactSequence++,
			factKind: "replicate-execution-started",
			execution,
		}),
	);
	const admitted = campaignState(authority).execution;
	if (admitted === null || admitted.executionDigest !== execution.executionDigest)
		throw new TypeError("D65 Graph did not project the replicate execution start");
	executionOwners.set(admitted, authority);
	return admitted;
}

export function consumeD65ReplicateExecution(
	execution: D65ReplicateExecutionV1,
): D65AdmittedReplicateV1 {
	const authority = executionOwners.get(execution) as D65GraphCampaignAuthorityV1 | undefined;
	if (authority === undefined || consumedExecutions.has(execution))
		throw new TypeError("D65 replicate execution capability is forged or already consumed");
	const state = campaignState(authority);
	if (
		state.execution !== execution ||
		state.active?.admissionDigest !== execution.replicateAdmission.admissionDigest
	)
		throw new TypeError("D65 replicate execution capability is stale");
	consumedExecutions.add(execution);
	return execution.replicateAdmission;
}

export function admitD65ReplicateResult(
	authority: D65GraphCampaignAuthorityV1,
	execution: D65ReplicateExecutionV1,
	evidenceValue: unknown,
	retryWaitElapsedMs: number,
): void {
	const state = campaignState(authority);
	if (
		state.execution !== execution ||
		executionOwners.get(execution) !== authority ||
		!consumedExecutions.has(execution)
	)
		throw new TypeError("D65 replicate result capability is forged, substituted, or stale");
	if (!Number.isSafeInteger(retryWaitElapsedMs) || retryWaitElapsedMs < 0)
		throw new TypeError("D65 retry-wait reconciliation is invalid");
	const effect = execution.replicateAdmission;
	const replicate = projectReplicate(
		evidenceValue,
		effect.replicateIndex,
		"d65-continuation",
		effect,
	);
	const confirmedElapsedMs = replicate.projection.confirmedElapsedMs + retryWaitElapsedMs;
	if (confirmedElapsedMs > 7_200_000)
		throw new TypeError("D65 replicate exceeded its Graph-admitted elapsed bound");
	const { projectionDigest: _projectionDigest, ...baseProjection } = replicate.projection;
	const cleanProjectionMaterial = strictSnapshot({ ...baseProjection, confirmedElapsedMs });
	const reconciledProjection = Object.freeze({
		...cleanProjectionMaterial,
		projectionDigest: empiricalStrictJsonDigest(cleanProjectionMaterial),
	}) as D65ReplicateProjectionV1;
	if (reconciledProjection.executionShapeDigest !== state.executionShapeDigest)
		throw new TypeError("D65 replicate execution shape drifted from D64");
	if (reconciledProjection.confirmedCostMicrousd > effect.remainingContinuationCostMicrousd)
		throw new TypeError("D65 replicate exceeded its Graph-admitted aggregate cost headroom");
	if (state.replicates.some((item) => item.evidenceDigest === reconciledProjection.evidenceDigest))
		throw new TypeError("D65 continuation evidence identity was replayed across replicates");
	emit(
		state,
		campaignFact({
			schemaVersion: D65_FACT_SCHEMA,
			sequence: state.nextFactSequence++,
			factKind: "replicate-result",
			admissionDigest: effect.admissionDigest,
			executionDigest: execution.executionDigest,
			retryWaitElapsedMs,
			replicate: reconciledProjection,
			evidence: replicate.evidence,
		}),
	);
}

const CONTROL_ARMS = D43_ARMS.filter(
	(arm): arm is Exclude<D43Arm, "relevant-applied"> => arm !== "relevant-applied",
);

export function deriveD65ReplicatedGate(replicates: readonly D65ReplicateProjectionV1[]) {
	const expectedExecutionShapeDigest = replicates[0]?.executionShapeDigest;
	const exactThirtyArmsEvaluable =
		replicates.length === D65_REPLICATE_COUNT &&
		replicates.every(
			(replicate, index) =>
				replicate.replicateIndex === index + 1 &&
				replicate.source === (index === 0 ? "d64-preincluded" : "d65-continuation") &&
				replicate.executionShapeDigest === expectedExecutionShapeDigest &&
				replicate.projectionDigest ===
					empiricalStrictJsonDigest(
						strictSnapshot({
							replicateIndex: replicate.replicateIndex,
							source: replicate.source,
							evidenceDigest: replicate.evidenceDigest,
							executionShapeDigest: replicate.executionShapeDigest,
							arms: replicate.arms,
							providerAttempts: replicate.providerAttempts,
							confirmedCostMicrousd: replicate.confirmedCostMicrousd,
							confirmedElapsedMs: replicate.confirmedElapsedMs,
						}),
					) &&
				replicate.arms.length === D43_ARMS.length &&
				replicate.arms.every(
					(arm, armIndex) =>
						arm.arm === D43_ARMS[armIndex] &&
						arm.completed &&
						arm.cleanupCompleted &&
						arm.evaluable &&
						arm.taskOutcome !== "non-evaluable",
				),
		);
	const relevantPassCount = replicates.filter(
		(replicate) =>
			replicate.arms.find((arm) => arm.arm === "relevant-applied")?.taskOutcome === "passed",
	).length;
	const controlPassCounts = Object.freeze(
		Object.fromEntries(
			CONTROL_ARMS.map((control) => [
				control,
				replicates.filter(
					(replicate) =>
						replicate.arms.find((arm) => arm.arm === control)?.taskOutcome === "passed",
				).length,
			]),
		) as Record<Exclude<D43Arm, "relevant-applied">, number>,
	);
	const frozenGatePassed =
		exactThirtyArmsEvaluable &&
		relevantPassCount === D65_REPLICATE_COUNT &&
		CONTROL_ARMS.every((control) => controlPassCounts[control] <= 1);
	return Object.freeze({
		exactThirtyArmsEvaluable,
		relevantPassCount,
		controlPassCounts,
		frozenGatePassed,
	});
}

export function snapshotD65CampaignEvidence(
	authority: D65GraphCampaignAuthorityV1,
): D65CampaignEvidenceV1 {
	const state = campaignState(authority);
	if (
		state.active !== null ||
		state.execution !== null ||
		state.terminalCauseCode !== null ||
		state.replicates.length !== D65_REPLICATE_COUNT
	)
		throw new TypeError("D65 campaign evidence is unfinished");
	const continuation = state.replicates.filter(
		(replicate) => replicate.source === "d65-continuation",
	);
	const gate = deriveD65ReplicatedGate(state.replicates);
	const material = strictSnapshot({
		schemaVersion: D65_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D65" as const,
		authorityRevision: D65_AUTHORITY_REVISION,
		baselineArtifactDigest: state.baselineArtifactDigest,
		baselineBundleDigest: state.baselineBundleDigest,
		executionShapeDigest: state.executionShapeDigest,
		campaignMode: state.campaignMode,
		facts: state.facts,
		replicates: state.replicates,
		continuationProviderAttempts: continuation.reduce(
			(total, replicate) => total + replicate.providerAttempts,
			0,
		),
		continuationConfirmedCostMicrousd: continuationCost(state),
		continuationConfirmedElapsedMs: continuation.reduce(
			(total, replicate) => total + replicate.confirmedElapsedMs,
			0,
		),
		exactFiveReplicatesCompleted: true as const,
		...gate,
		optionalStoppingAllowed: false as const,
		selectiveDiscardAllowed: false as const,
		maxActiveReplicatesObserved: 1 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

export function admitD65PartialReplicateResult(
	authority: D65GraphCampaignAuthorityV1,
	execution: D65ReplicateExecutionV1,
	partialEvidenceValue: unknown,
	retryWaitElapsedMs: number,
): void {
	const state = campaignState(authority);
	if (
		state.execution !== execution ||
		executionOwners.get(execution) !== authority ||
		!consumedExecutions.has(execution)
	)
		throw new TypeError("D65 partial result capability is forged, substituted, or stale");
	if (!Number.isSafeInteger(retryWaitElapsedMs) || retryWaitElapsedMs < 0)
		throw new TypeError("D65 partial retry-wait reconciliation is invalid");
	const effect = execution.replicateAdmission;
	const partialEvidence = validateD45PartialCanonicalEvidence(partialEvidenceValue);
	const admittedEffects = partialEvidence.facts.filter(
		(fact) => fact.factKind === "effect-admitted",
	);
	if (
		admittedEffects.length < 1 ||
		admittedEffects.some(
			(fact) =>
				fact.effect.policyDigest !== effect.policyDigest ||
				fact.effect.modelRef !== D45_ASSIGNMENT.modelRef ||
				fact.effect.providerRef !== D45_ASSIGNMENT.providerRef ||
				fact.effect.reasoningEffort !== "high" ||
				fact.effect.requireParameters !== true,
		) ||
		partialEvidence.budget.confirmedCostMicrousd > effect.remainingContinuationCostMicrousd ||
		partialEvidence.budget.confirmedElapsedMs + retryWaitElapsedMs > 7_200_000
	)
		throw new TypeError("D65 partial result drifted from its exact lowered replicate policy");
	emit(
		state,
		campaignFact({
			schemaVersion: D65_FACT_SCHEMA,
			sequence: state.nextFactSequence++,
			factKind: "replicate-partial-result",
			admissionDigest: effect.admissionDigest,
			executionDigest: execution.executionDigest,
			retryWaitElapsedMs,
			partialEvidence,
		}),
	);
}

export function snapshotD65PartialCampaignEvidence(
	authority: D65GraphCampaignAuthorityV1,
): D65PartialCampaignEvidenceV1 {
	const state = campaignState(authority);
	if (state.terminalCauseCode === null || state.active !== null || state.execution !== null)
		throw new TypeError("D65 partial campaign has no Graph-admitted terminal fact");
	const continuationConfirmedCostMicrousd =
		continuationCost(state) + (state.partialReplicateEvidence?.budget.confirmedCostMicrousd ?? 0);
	if (continuationConfirmedCostMicrousd > D65_CONTINUATION_HARD_CAP_MICROUSD)
		throw new TypeError("D65 partial campaign exceeded its frozen aggregate hard cap");
	const continuationConfirmedElapsedMs =
		state.replicates
			.filter((replicate) => replicate.source === "d65-continuation")
			.reduce((total, replicate) => total + replicate.confirmedElapsedMs, 0) +
		(state.partialReplicateEvidence?.budget.confirmedElapsedMs ?? 0) +
		state.partialRetryWaitElapsedMs;
	const material = strictSnapshot({
		schemaVersion: "graphrefly-ts.d65.partial-campaign-evidence.v1" as const,
		decisionRef: "graphrefly-ts:D65" as const,
		authorityRevision: D65_AUTHORITY_REVISION,
		baselineArtifactDigest: state.baselineArtifactDigest,
		baselineBundleDigest: state.baselineBundleDigest,
		executionShapeDigest: state.executionShapeDigest,
		campaignMode: state.campaignMode,
		facts: state.facts,
		completedReplicates: state.replicates,
		terminalCauseCode: state.terminalCauseCode,
		activeReplicate: null,
		partialReplicateEvidence: state.partialReplicateEvidence,
		continuationConfirmedCostMicrousd,
		continuationConfirmedElapsedMs,
		exactFiveReplicatesCompleted: false as const,
		frozenGatePassed: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

export function validateD65CampaignEvidenceWithBaseline(input: {
	readonly evidence: unknown;
	readonly baselineProjection: unknown;
}): D65CampaignEvidenceV1 {
	const candidate = record(input.evidence, "D65 campaign evidence");
	const suppliedDigest = digest(candidate.evidenceDigest, "D65 evidence digest");
	const { evidenceDigest: _evidenceDigest, ...material } = candidate;
	if (empiricalStrictJsonDigest(material) !== suppliedDigest)
		throw new TypeError("D65 evidence digest drifted");
	const facts = candidate.facts;
	if (!Array.isArray(facts) || facts.length !== 13)
		throw new TypeError(
			"D65 evidence must contain one baseline plus four admission/start/result triples",
		);
	const baseline = facts[0] as D65CampaignFactV1;
	if (baseline.factKind !== "baseline-admitted")
		throw new TypeError("D65 evidence baseline order drifted");
	const authority = createD65GraphCampaignAuthority({
		baselineArtifactDigest: baseline.artifactDigest,
		baselineBundleDigest: baseline.bundleDigest,
		baselineProjection: input.baselineProjection,
		campaignMode: candidate.campaignMode as D65CampaignModeV1,
	});
	for (let index = 1; index < facts.length; index += 3) {
		const admitted = facts[index] as D65CampaignFactV1;
		const started = facts[index + 1] as D65CampaignFactV1;
		const result = facts[index + 2] as D65CampaignFactV1;
		if (
			admitted.factKind !== "replicate-admitted" ||
			started.factKind !== "replicate-execution-started" ||
			result.factKind !== "replicate-result"
		)
			throw new TypeError("D65 evidence fact order drifted");
		const effect = takeD65AdmittedReplicate(authority);
		if (
			effect === null ||
			effect.admissionDigest !== admitted.effect.admissionDigest ||
			result.admissionDigest !== effect.admissionDigest
		)
			throw new TypeError("D65 evidence admission replay drifted");
		const execution = startD65ReplicateExecution(authority, effect);
		if (execution.executionDigest !== started.execution.executionDigest)
			throw new TypeError("D65 evidence execution replay drifted");
		consumeD65ReplicateExecution(execution);
		admitD65ReplicateResult(authority, execution, result.evidence, result.retryWaitElapsedMs);
	}
	const replayed = snapshotD65CampaignEvidence(authority);
	if (empiricalStrictJsonDigest(replayed) !== empiricalStrictJsonDigest(candidate))
		throw new TypeError("D65 canonical campaign replay drifted");
	return replayed;
}

export function validateD65PartialCampaignEvidenceWithBaseline(input: {
	readonly evidence: unknown;
	readonly baselineProjection: unknown;
}): D65PartialCampaignEvidenceV1 {
	const candidate = record(input.evidence, "D65 partial campaign evidence");
	const suppliedDigest = digest(candidate.evidenceDigest, "D65 partial evidence digest");
	const { evidenceDigest: _evidenceDigest, ...material } = candidate;
	if (empiricalStrictJsonDigest(material) !== suppliedDigest)
		throw new TypeError("D65 partial evidence digest drifted");
	const facts = candidate.facts;
	if (!Array.isArray(facts) || facts.length < 2)
		throw new TypeError("D65 partial evidence omitted canonical Graph facts");
	const baseline = facts[0] as D65CampaignFactV1;
	if (baseline.factKind !== "baseline-admitted")
		throw new TypeError("D65 partial evidence baseline order drifted");
	const authority = createD65GraphCampaignAuthority({
		baselineArtifactDigest: baseline.artifactDigest,
		baselineBundleDigest: baseline.bundleDigest,
		baselineProjection: input.baselineProjection,
		campaignMode: candidate.campaignMode as D65CampaignModeV1,
	});
	for (let index = 1; index < facts.length; ) {
		const fact = facts[index] as D65CampaignFactV1;
		if (fact.factKind === "campaign-terminal") {
			if (index !== facts.length - 1 || takeD65AdmittedReplicate(authority) !== null)
				throw new TypeError("D65 partial aggregate terminal replay drifted");
			index += 1;
			continue;
		}
		if (fact.factKind !== "replicate-admitted")
			throw new TypeError("D65 partial evidence admission order drifted");
		const effect = takeD65AdmittedReplicate(authority);
		if (effect === null || effect.admissionDigest !== fact.effect.admissionDigest)
			throw new TypeError("D65 partial evidence admission replay drifted");
		const started = facts[index + 1] as D65CampaignFactV1 | undefined;
		if (started?.factKind !== "replicate-execution-started")
			throw new TypeError("D65 partial evidence execution order drifted");
		const execution = startD65ReplicateExecution(authority, effect);
		if (execution.executionDigest !== started.execution.executionDigest)
			throw new TypeError("D65 partial evidence execution replay drifted");
		consumeD65ReplicateExecution(execution);
		const result = facts[index + 2] as D65CampaignFactV1 | undefined;
		if (result?.factKind === "replicate-result") {
			admitD65ReplicateResult(authority, execution, result.evidence, result.retryWaitElapsedMs);
			index += 3;
			continue;
		}
		if (result?.factKind === "replicate-partial-result") {
			admitD65PartialReplicateResult(
				authority,
				execution,
				result.partialEvidence,
				result.retryWaitElapsedMs,
			);
			index += 3;
			continue;
		}
		throw new TypeError("D65 partial evidence result order drifted");
	}
	const replayed = snapshotD65PartialCampaignEvidence(authority);
	if (empiricalStrictJsonDigest(replayed) !== empiricalStrictJsonDigest(candidate))
		throw new TypeError("D65 canonical partial campaign replay drifted");
	return replayed;
}
