import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import { digest, empiricalStrictJsonDigest, record, strictSnapshot } from "./canonical.js";
import {
	createCurrentProfilePolicyAuthority,
	readCurrentProfilePolicyResolution,
} from "./current-profile-policy-authority.js";
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
	createExactModelHarnessProfileInput,
	D45_ASSIGNMENT,
	D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
	D45_TASK_ENVELOPE_DIGEST,
} from "./graph-tool-qualification.js";
import {
	createHarnessCampaignPolicy,
	HARNESS_ARMS,
	type HarnessArm,
} from "./harness-campaign-policy.js";

export const D65_AUTHORITY_REVISION = "graphrefly-ts.replicated-campaign-authority.d74.v2" as const;
export const D65_EFFECT_SCHEMA = "graphrefly-ts.d65.replicate-effect.v1" as const;
export const D65_EXECUTION_SCHEMA = "graphrefly-ts.d65.replicate-execution.v1" as const;
export const D65_FACT_SCHEMA = "graphrefly-ts.replicated-campaign-fact.d74.v2" as const;
export const D65_EVIDENCE_SCHEMA = "graphrefly-ts.replicated-campaign-evidence.d74.v2" as const;
export const D65_PARTIAL_EVIDENCE_SCHEMA =
	"graphrefly-ts.partial-replicated-campaign-evidence.d74.v2" as const;
export const EXECUTION_SHAPE_TRANSITION_SCHEMA =
	"graphrefly-ts.execution-shape-transition.d74.v1" as const;
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
		readonly arm: HarnessArm;
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
	readonly profileResolutionDigest: string;
	readonly campaignDigest: string;
	readonly admissionDigest: string;
}

export interface D65ReplicateExecutionV1 {
	readonly schemaVersion: typeof D65_EXECUTION_SCHEMA;
	readonly replicateAdmission: D65AdmittedReplicateV1;
	readonly executionDigest: string;
}

export interface ExecutionShapeTransition {
	readonly schemaVersion: typeof EXECUTION_SHAPE_TRANSITION_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D74";
	readonly fromExecutionShapeDigest: string;
	readonly toExecutionShapeDigest: string;
	readonly targetDigest: string;
	readonly profileDigest: string;
	readonly bindingDigest: string;
	readonly qualificationDigest: string;
	readonly eligibilityDigest: string;
	readonly profileResolutionDigest: string;
	readonly providerSemanticsDigest: string;
	readonly transitionDigest: string;
}

export type D65CampaignModeV1 = Readonly<{
	executionClass: "qualification";
	liveClaimDigest: null;
}>;

type D65CampaignFactV1 =
	| Readonly<{
			schemaVersion: typeof D65_FACT_SCHEMA;
			sequence: number;
			factKind: "execution-shape-transition-admitted";
			transition: ExecutionShapeTransition;
			factDigest: string;
	  }>
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
	readonly executionShapeTransitionDigest: string;
	readonly campaignMode: D65CampaignModeV1;
	readonly facts: readonly D65CampaignFactV1[];
	readonly replicates: readonly D65ReplicateProjectionV1[];
	readonly continuationProviderAttempts: number;
	readonly continuationConfirmedCostMicrousd: number;
	readonly continuationConfirmedElapsedMs: number;
	readonly exactFiveReplicatesCompleted: true;
	readonly exactThirtyArmsEvaluable: boolean;
	readonly relevantPassCount: number;
	readonly controlPassCounts: Readonly<Record<Exclude<HarnessArm, "relevant-applied">, number>>;
	readonly optionalStoppingAllowed: false;
	readonly selectiveDiscardAllowed: false;
	readonly maxActiveReplicatesObserved: 1;
	readonly frozenGatePassed: boolean;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D65PartialCampaignEvidenceV1 {
	readonly schemaVersion: typeof D65_PARTIAL_EVIDENCE_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D65";
	readonly authorityRevision: typeof D65_AUTHORITY_REVISION;
	readonly baselineArtifactDigest: string;
	readonly baselineBundleDigest: string;
	readonly executionShapeDigest: string;
	readonly executionShapeTransitionDigest: string | null;
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
	executionShapeDigest: string;
	executionShapeTransitionDigest: string | null;
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

export function createD65ReplicateCampaign(admission: D65ReplicateBinding) {
	const maxCostMicrousd = admission.remainingContinuationCostMicrousd;
	if (
		!Number.isSafeInteger(maxCostMicrousd) ||
		maxCostMicrousd < 100_000 ||
		maxCostMicrousd > D65_CONTINUATION_HARD_CAP_MICROUSD
	)
		throw new TypeError("D65 replicate cost headroom is outside its admitted range");
	return createHarnessCampaignPolicy({
		campaignRef: d65ReplicateCampaignRef(admission),
		arms: HARNESS_ARMS,
		maxProviderAttempts: 96,
		maxCostMicrousd,
		maxElapsedMs: 7_200_000,
		localEffectReservationMs: 10_000,
		providerReservationMicrousd: 100_000,
		providerDeadlineMs: 600_000,
		publicSemanticScenarioSetDigest: D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
		taskEnvelopeDigest: D45_TASK_ENVELOPE_DIGEST,
		maxSameLogicalRequestRetries: 1,
		retryClasses: ["D671", "D675", "D710"],
		allowFallback: false,
		allowProviderSwitch: false,
		allowParallelEffects: false,
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
		evidence.lifecycle.arms.length !== HARNESS_ARMS.length ||
		evidence.lifecycle.arms.some(
			(arm, index) => arm.arm !== HARNESS_ARMS[index] || !arm.completed || !arm.cleanupCompleted,
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
			evidence.lifecycle.campaign.maxCostMicrousd !==
				expectedAdmission.remainingContinuationCostMicrousd ||
			evidence.lifecycle.profileResolution.resolutionDigest !==
				expectedAdmission.profileResolutionDigest ||
			evidence.lifecycle.campaign.campaignDigest !== expectedAdmission.campaignDigest ||
			evidence.lifecycle.campaign.campaignRef !== expectedAdmission.campaignRef ||
			evidence.lifecycle.plan.campaignRef !== expectedAdmission.campaignRef ||
			evidence.lifecycle.plan.assignmentRef !== expectedAdmission.assignmentRef
		)
			throw new TypeError("D65 continuation policy was not bound to its exact Graph admission");
	}
	const {
		maxCostMicrousd: _maxCostMicrousd,
		campaignRef: _campaignRef,
		campaignDigest: _campaignDigest,
		...campaign
	} = evidence.lifecycle.campaign;
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
		responseContractRevision: providerAdmissions[0]!.effect.responseContractRevision,
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
					responseContractRevision: fact.effect.responseContractRevision,
					reasoningEffort: fact.effect.reasoningEffort,
					requireParameters: fact.effect.requireParameters,
					taskEnvelopeDigest: fact.effect.taskEnvelopeDigest,
				}) !== empiricalStrictJsonDigest(providerAdmissionProfile),
		)
	)
		throw new TypeError("D65 provider route-profile coordinates changed within a replicate");
	const executionShapeDigest = empiricalStrictJsonDigest({
		modelTarget: evidence.lifecycle.modelTarget,
		enhancementProfile: evidence.lifecycle.enhancementProfile,
		providerBinding: evidence.lifecycle.providerBinding,
		campaign,
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

function executionShapeTransition(
	fromExecutionShapeDigest: string,
	toExecutionShapeDigest: string,
	evidence: D45CanonicalEvidenceV1,
): ExecutionShapeTransition {
	if (fromExecutionShapeDigest !== D65_D64_BASELINE_PROJECTION.executionShapeDigest)
		throw new TypeError("D74 execution-shape transition source is not immutable D64");
	const {
		maxCostMicrousd: _maxCost,
		campaignRef: _campaignRef,
		campaignDigest: _digest,
		...campaign
	} = evidence.lifecycle.campaign;
	const material = strictSnapshot({
		schemaVersion: EXECUTION_SHAPE_TRANSITION_SCHEMA,
		decisionRef: "graphrefly-ts:D74" as const,
		fromExecutionShapeDigest,
		toExecutionShapeDigest,
		targetDigest: evidence.lifecycle.modelTarget.targetDigest,
		profileDigest: evidence.lifecycle.enhancementProfile.profileDigest,
		bindingDigest: evidence.lifecycle.providerBinding.bindingDigest,
		qualificationDigest: evidence.lifecycle.profileQualification.qualificationDigest,
		eligibilityDigest: evidence.lifecycle.currentProfileEligibility.eligibilityDigest,
		profileResolutionDigest: evidence.lifecycle.profileResolution.resolutionDigest,
		providerSemanticsDigest: empiricalStrictJsonDigest({
			providerModelRef: evidence.lifecycle.providerBinding.providerModelRef,
			providerRef: evidence.lifecycle.providerBinding.providerRef,
			endpointProtocol: evidence.lifecycle.providerBinding.endpointProtocol,
			namedToolChoiceEncoding: evidence.lifecycle.providerBinding.namedToolChoiceEncoding,
			responseContractRevision: evidence.lifecycle.providerBinding.responseContractRevision,
			enhancementRecipes: evidence.lifecycle.enhancementProfile.enhancementRecipes,
			campaign,
		}),
	});
	return Object.freeze({ ...material, transitionDigest: empiricalStrictJsonDigest(material) });
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
	} else if (fact.factKind === "execution-shape-transition-admitted") {
		if (
			state.replicates.length !== 1 ||
			state.active?.replicateIndex !== 2 ||
			state.execution === null ||
			state.executionShapeTransitionDigest !== null ||
			fact.transition.fromExecutionShapeDigest !== state.executionShapeDigest ||
			fact.transition.toExecutionShapeDigest === state.executionShapeDigest
		)
			throw new TypeError("D74 execution-shape transition admission drifted");
		const { transitionDigest, ...transitionMaterial } = fact.transition;
		if (transitionDigest !== empiricalStrictJsonDigest(transitionMaterial))
			throw new TypeError("D74 execution-shape transition digest drifted");
		state.executionShapeDigest = fact.transition.toExecutionShapeDigest;
		state.executionShapeTransitionDigest = transitionDigest;
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
		executionShapeTransitionDigest: null,
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
	const campaign = createD65ReplicateCampaign(binding);
	const profileResolution = readCurrentProfilePolicyResolution(
		createCurrentProfilePolicyAuthority(createExactModelHarnessProfileInput()),
	);
	if (profileResolution.resolution.status !== "eligible")
		throw new TypeError("D65 exact profile is not currently eligible");
	const material = strictSnapshot({
		schemaVersion: D65_EFFECT_SCHEMA,
		replicateIndex: binding.replicateIndex,
		remainingContinuationCostMicrousd,
		priorReplicatesDigest,
		runBindingDigest,
		assignmentRef: d65ReplicateAssignmentRef(binding),
		campaignRef: d65ReplicateCampaignRef(binding),
		profileResolutionDigest: profileResolution.resolution.resolutionDigest,
		campaignDigest: campaign.campaignDigest,
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
	if (state.replicates.length === 1) {
		const transition = executionShapeTransition(
			state.executionShapeDigest,
			reconciledProjection.executionShapeDigest,
			replicate.evidence,
		);
		emit(
			state,
			campaignFact({
				schemaVersion: D65_FACT_SCHEMA,
				sequence: state.nextFactSequence++,
				factKind: "execution-shape-transition-admitted",
				transition,
			}),
		);
	} else if (reconciledProjection.executionShapeDigest !== state.executionShapeDigest) {
		throw new TypeError("D65 continuation execution shape drifted from D72-native shape");
	}
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

const CONTROL_ARMS = HARNESS_ARMS.filter(
	(arm): arm is Exclude<HarnessArm, "relevant-applied"> => arm !== "relevant-applied",
);

export function deriveD65ReplicatedGate(
	replicates: readonly D65ReplicateProjectionV1[],
	executionShapeTransitionAdmitted: boolean,
) {
	const baselineExecutionShapeDigest = replicates[0]?.executionShapeDigest;
	const currentExecutionShapeDigest = replicates[1]?.executionShapeDigest;
	const exactThirtyArmsEvaluable =
		executionShapeTransitionAdmitted &&
		replicates.length === D65_REPLICATE_COUNT &&
		baselineExecutionShapeDigest === D65_D64_BASELINE_PROJECTION.executionShapeDigest &&
		currentExecutionShapeDigest !== undefined &&
		currentExecutionShapeDigest !== baselineExecutionShapeDigest &&
		replicates.every(
			(replicate, index) =>
				replicate.replicateIndex === index + 1 &&
				replicate.source === (index === 0 ? "d64-preincluded" : "d65-continuation") &&
				replicate.executionShapeDigest ===
					(index === 0 ? baselineExecutionShapeDigest : currentExecutionShapeDigest) &&
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
				replicate.arms.length === HARNESS_ARMS.length &&
				replicate.arms.every(
					(arm, armIndex) =>
						arm.arm === HARNESS_ARMS[armIndex] &&
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
		) as Record<Exclude<HarnessArm, "relevant-applied">, number>,
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
	if (state.executionShapeTransitionDigest === null)
		throw new TypeError("D65 campaign omitted the D74 execution-shape transition");
	const gate = deriveD65ReplicatedGate(state.replicates, true);
	const material = strictSnapshot({
		schemaVersion: D65_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D65" as const,
		authorityRevision: D65_AUTHORITY_REVISION,
		baselineArtifactDigest: state.baselineArtifactDigest,
		baselineBundleDigest: state.baselineBundleDigest,
		executionShapeDigest: state.executionShapeDigest,
		executionShapeTransitionDigest: state.executionShapeTransitionDigest,
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
				fact.effect.profileResolutionDigest !== effect.profileResolutionDigest ||
				fact.effect.modelRef !== D45_ASSIGNMENT.modelRef ||
				fact.effect.providerRef !== D45_ASSIGNMENT.providerRef ||
				fact.effect.responseContractRevision !== "bounded-chat-response.v1" ||
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
		schemaVersion: D65_PARTIAL_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D65" as const,
		authorityRevision: D65_AUTHORITY_REVISION,
		baselineArtifactDigest: state.baselineArtifactDigest,
		baselineBundleDigest: state.baselineBundleDigest,
		executionShapeDigest: state.executionShapeDigest,
		executionShapeTransitionDigest: state.executionShapeTransitionDigest,
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
	if (!Array.isArray(facts) || facts.length !== 14)
		throw new TypeError(
			"D65 evidence must contain one baseline, one D74 transition and four replicate triples",
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
	for (let index = 1, continuationIndex = 0; index < facts.length; continuationIndex += 1) {
		const admitted = facts[index] as D65CampaignFactV1;
		const started = facts[index + 1] as D65CampaignFactV1;
		const transition = continuationIndex === 0 ? (facts[index + 2] as D65CampaignFactV1) : null;
		const result = facts[index + (transition === null ? 2 : 3)] as D65CampaignFactV1;
		if (
			admitted.factKind !== "replicate-admitted" ||
			started.factKind !== "replicate-execution-started" ||
			(transition !== null && transition.factKind !== "execution-shape-transition-admitted") ||
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
		index += transition === null ? 3 : 4;
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
		let resultIndex = index + 2;
		const possibleTransition = facts[resultIndex] as D65CampaignFactV1 | undefined;
		if (possibleTransition?.factKind === "execution-shape-transition-admitted") resultIndex += 1;
		const result = facts[resultIndex] as D65CampaignFactV1 | undefined;
		if (result?.factKind === "replicate-result") {
			admitD65ReplicateResult(authority, execution, result.evidence, result.retryWaitElapsedMs);
			index = resultIndex + 1;
			continue;
		}
		if (result?.factKind === "replicate-partial-result") {
			admitD65PartialReplicateResult(
				authority,
				execution,
				result.partialEvidence,
				result.retryWaitElapsedMs,
			);
			index = resultIndex + 1;
			continue;
		}
		throw new TypeError("D65 partial evidence result order drifted");
	}
	const replayed = snapshotD65PartialCampaignEvidence(authority);
	if (empiricalStrictJsonDigest(replayed) !== empiricalStrictJsonDigest(candidate))
		throw new TypeError("D65 canonical partial campaign replay drifted");
	return replayed;
}
