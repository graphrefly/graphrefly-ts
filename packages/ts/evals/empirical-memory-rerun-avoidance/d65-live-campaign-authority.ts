import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import { D65_D64_BASELINE_PROJECTION } from "./d65-d64-baseline-fixture.js";
import {
	consumeD65LiveCampaignCapability,
	type D65LiveCampaignCapabilityV1,
} from "./d65-live-campaign-claim.js";
import {
	admitD65PartialReplicateResult,
	admitD65ReplicateResult,
	createD65GraphCampaignAuthority,
	D65_D64_ARTIFACT_DIGEST,
	D65_D64_BUNDLE_DIGEST,
	type D65AdmittedReplicateV1,
	type D65CampaignEvidenceV1,
	type D65GraphCampaignAuthorityV1,
	type D65PartialCampaignEvidenceV1,
	type D65ReplicateExecutionV1,
	snapshotD65CampaignEvidence,
	snapshotD65PartialCampaignEvidence,
	startD65ReplicateExecution,
	takeD65AdmittedReplicate,
	validateD65CampaignEvidenceWithBaseline,
	validateD65PartialCampaignEvidenceWithBaseline,
} from "./d65-replicated-campaign-authority.js";
import {
	consumeD67LiveCampaignCapability,
	D67_LIVE_CLAIM_SCHEMA,
	type D67LiveCampaignCapabilityV1,
} from "./d67-live-campaign-claim.js";

export const D65_LIVE_AUTHORITY_REVISION = "graphrefly-ts.d65.live-campaign-authority.v1" as const;
export const D65_LIVE_FACT_SCHEMA = "graphrefly-ts.d65.live-campaign-fact.v1" as const;
export const D65_LIVE_EVIDENCE_SCHEMA = "graphrefly-ts.d65.live-campaign-evidence.v1" as const;
export const D65_LIVE_PARTIAL_EVIDENCE_SCHEMA =
	"graphrefly-ts.d65.live-partial-campaign-evidence.v1" as const;

export interface D65LiveCampaignBindingV1 {
	readonly liveClaimDigest: string;
	readonly preclaimDigest: string;
	readonly currentKeyAdmissionDigest: string;
	readonly campaignBindingDigest: string;
}

type D65LiveCampaignFactV1 =
	| Readonly<{
			schemaVersion: typeof D65_LIVE_FACT_SCHEMA;
			sequence: 1;
			factKind: "live-campaign-bound";
			binding: D65LiveCampaignBindingV1;
			factDigest: string;
	  }>
	| Readonly<{
			schemaVersion: typeof D65_LIVE_FACT_SCHEMA;
			sequence: 2;
			factKind: "core-campaign-reconciled";
			disposition: "success" | "partial-failure";
			coreEvidenceDigest: string;
			factDigest: string;
	  }>;

export interface D65LiveCampaignEvidenceV1 {
	readonly schemaVersion: typeof D65_LIVE_EVIDENCE_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D65";
	readonly authorityRevision: typeof D65_LIVE_AUTHORITY_REVISION;
	readonly binding: D65LiveCampaignBindingV1;
	readonly facts: readonly D65LiveCampaignFactV1[];
	readonly campaignEvidence: D65CampaignEvidenceV1;
	readonly exactFiveReplicatesCompleted: true;
	readonly exactThirtyArmsEvaluable: boolean;
	readonly relevantPassCount: number;
	readonly controlPassCounts: D65CampaignEvidenceV1["controlPassCounts"];
	readonly frozenGatePassed: boolean;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none" | "replicated-frozen-task-positive-differential";
	readonly evidenceDigest: string;
}

export interface D65LivePartialCampaignEvidenceV1 {
	readonly schemaVersion: typeof D65_LIVE_PARTIAL_EVIDENCE_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D65";
	readonly authorityRevision: typeof D65_LIVE_AUTHORITY_REVISION;
	readonly binding: D65LiveCampaignBindingV1;
	readonly facts: readonly D65LiveCampaignFactV1[];
	readonly partialCampaignEvidence: D65PartialCampaignEvidenceV1;
	readonly exactFiveReplicatesCompleted: false;
	readonly frozenGatePassed: false;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D65LiveGraphCampaignAuthorityV1 {
	readonly revision: typeof D65_LIVE_AUTHORITY_REVISION;
}

interface LiveState {
	readonly owner: ReturnType<typeof graph>;
	readonly factNode: ReturnType<typeof createFactNode>;
	readonly core: D65GraphCampaignAuthorityV1;
	readonly binding: D65LiveCampaignBindingV1;
	readonly facts: D65LiveCampaignFactV1[];
	disposition: "success" | "partial-failure" | null;
}

const states = new WeakMap<object, LiveState>();

function isD67LiveCapability(
	value: D65LiveCampaignCapabilityV1 | D67LiveCampaignCapabilityV1,
): value is D67LiveCampaignCapabilityV1 {
	return value.claim.schemaVersion === D67_LIVE_CLAIM_SCHEMA;
}

function createFactNode(owner: ReturnType<typeof graph>) {
	return owner.node<D65LiveCampaignFactV1>([], null, { name: "d65/live-canonical-facts" });
}

function liveState(authority: D65LiveGraphCampaignAuthorityV1): LiveState {
	const state = states.get(authority as object);
	if (state === undefined) throw new TypeError("D65 live campaign authority is forged");
	return state;
}

function liveFact<T extends Omit<D65LiveCampaignFactV1, "factDigest">>(value: T) {
	const material = strictSnapshot(value);
	return Object.freeze({
		...material,
		factDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D65LiveCampaignFactV1;
}

function applyFact(state: LiveState, fact: D65LiveCampaignFactV1): void {
	if (fact.sequence !== state.facts.length + 1)
		throw new TypeError("D65 live campaign fact sequence drifted");
	if (state.facts.some((item) => item.factDigest === fact.factDigest))
		throw new TypeError("D65 live campaign fact replay was rejected");
	if (fact.factKind === "live-campaign-bound") {
		if (
			state.facts.length !== 0 ||
			empiricalStrictJsonDigest(fact.binding) !== empiricalStrictJsonDigest(state.binding)
		)
			throw new TypeError("D65 live claim binding drifted");
	} else {
		if (state.facts.length !== 1 || state.disposition !== null)
			throw new TypeError("D65 live campaign reconciliation was duplicated");
		state.disposition = fact.disposition;
	}
	state.facts.push(fact);
}

function emit(state: LiveState, fact: D65LiveCampaignFactV1): void {
	state.factNode.down([["DATA", fact]]);
}

export function createD65LiveGraphCampaignAuthority(input: {
	readonly liveCampaignCapability: D65LiveCampaignCapabilityV1 | D67LiveCampaignCapabilityV1;
}): D65LiveGraphCampaignAuthorityV1 {
	const capability = isD67LiveCapability(input.liveCampaignCapability)
		? consumeD67LiveCampaignCapability(input.liveCampaignCapability)
		: consumeD65LiveCampaignCapability(input.liveCampaignCapability);
	const binding = strictSnapshot({
		liveClaimDigest: capability.claim.claimDigest,
		preclaimDigest: capability.claim.preclaimDigest,
		currentKeyAdmissionDigest: capability.currentKeyAdmission.admissionDigest,
		campaignBindingDigest: capability.campaignBindingDigest,
	});
	const core = createD65GraphCampaignAuthority({
		baselineArtifactDigest: D65_D64_ARTIFACT_DIGEST,
		baselineBundleDigest: D65_D64_BUNDLE_DIGEST,
		baselineProjection: D65_D64_BASELINE_PROJECTION,
		campaignMode: { executionClass: "qualification", liveClaimDigest: null },
	});
	const owner = graph({ name: "d65/live-replicated-efficacy-campaign" });
	const factNode = createFactNode(owner);
	let state!: LiveState;
	const projectionNode = owner.node<D65LiveCampaignFactV1>(
		[factNode],
		(ctx) => {
			for (const item of (depBatch(ctx, 0) ?? []) as readonly D65LiveCampaignFactV1[]) {
				applyFact(state, item);
				ctx.down([["DATA", item]]);
			}
		},
		{ name: "d65/live-canonical-projection", factory: "d65LiveCampaignProjection" },
	);
	const authority = Object.freeze({ revision: D65_LIVE_AUTHORITY_REVISION });
	state = { owner, factNode, core, binding, facts: [], disposition: null };
	projectionNode.subscribe(() => undefined);
	states.set(authority, state);
	emit(
		state,
		liveFact({
			schemaVersion: D65_LIVE_FACT_SCHEMA,
			sequence: 1 as const,
			factKind: "live-campaign-bound",
			binding,
		}),
	);
	return authority;
}

export function takeD65LiveAdmittedReplicate(
	authority: D65LiveGraphCampaignAuthorityV1,
): D65AdmittedReplicateV1 | null {
	const state = liveState(authority);
	if (state.disposition !== null) return null;
	return takeD65AdmittedReplicate(state.core);
}

export function startD65LiveReplicateExecution(
	authority: D65LiveGraphCampaignAuthorityV1,
	effect: D65AdmittedReplicateV1,
): D65ReplicateExecutionV1 {
	const state = liveState(authority);
	if (state.disposition !== null) throw new TypeError("D65 live campaign is terminal");
	return startD65ReplicateExecution(state.core, effect);
}

export function admitD65LiveReplicateResult(
	authority: D65LiveGraphCampaignAuthorityV1,
	execution: D65ReplicateExecutionV1,
	evidence: unknown,
	retryWaitElapsedMs: number,
): void {
	const state = liveState(authority);
	if (state.disposition !== null) throw new TypeError("D65 live campaign is terminal");
	admitD65ReplicateResult(state.core, execution, evidence, retryWaitElapsedMs);
}

export function admitD65LivePartialReplicateResult(
	authority: D65LiveGraphCampaignAuthorityV1,
	execution: D65ReplicateExecutionV1,
	evidence: unknown,
	retryWaitElapsedMs: number,
): void {
	const state = liveState(authority);
	if (state.disposition !== null) throw new TypeError("D65 live campaign is terminal");
	admitD65PartialReplicateResult(state.core, execution, evidence, retryWaitElapsedMs);
}

function reconcile(
	state: LiveState,
	disposition: "success" | "partial-failure",
	digestValue: string,
) {
	if (state.disposition === null)
		emit(
			state,
			liveFact({
				schemaVersion: D65_LIVE_FACT_SCHEMA,
				sequence: 2 as const,
				factKind: "core-campaign-reconciled",
				disposition,
				coreEvidenceDigest: digest(digestValue, "D65 live core evidence"),
			}),
		);
	if (state.disposition !== disposition)
		throw new TypeError("D65 live campaign disposition replay drifted");
}

export function snapshotD65LiveCampaignEvidence(
	authority: D65LiveGraphCampaignAuthorityV1,
): D65LiveCampaignEvidenceV1 {
	const state = liveState(authority);
	const campaignEvidence = validateD65CampaignEvidenceWithBaseline({
		evidence: snapshotD65CampaignEvidence(state.core),
		baselineProjection: D65_D64_BASELINE_PROJECTION,
	});
	reconcile(state, "success", campaignEvidence.evidenceDigest);
	const efficacyClaim = campaignEvidence.frozenGatePassed
		? ("replicated-frozen-task-positive-differential" as const)
		: ("none" as const);
	const material = strictSnapshot({
		schemaVersion: D65_LIVE_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D65" as const,
		authorityRevision: D65_LIVE_AUTHORITY_REVISION,
		binding: state.binding,
		facts: state.facts,
		campaignEvidence,
		exactFiveReplicatesCompleted: true as const,
		exactThirtyArmsEvaluable: campaignEvidence.exactThirtyArmsEvaluable,
		relevantPassCount: campaignEvidence.relevantPassCount,
		controlPassCounts: campaignEvidence.controlPassCounts,
		frozenGatePassed: campaignEvidence.frozenGatePassed,
		causalAttribution: "undetermined" as const,
		efficacyClaim,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

export function snapshotD65LivePartialCampaignEvidence(
	authority: D65LiveGraphCampaignAuthorityV1,
): D65LivePartialCampaignEvidenceV1 {
	const state = liveState(authority);
	const partialCampaignEvidence = validateD65PartialCampaignEvidenceWithBaseline({
		evidence: snapshotD65PartialCampaignEvidence(state.core),
		baselineProjection: D65_D64_BASELINE_PROJECTION,
	});
	reconcile(state, "partial-failure", partialCampaignEvidence.evidenceDigest);
	const material = strictSnapshot({
		schemaVersion: D65_LIVE_PARTIAL_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D65" as const,
		authorityRevision: D65_LIVE_AUTHORITY_REVISION,
		binding: state.binding,
		facts: state.facts,
		partialCampaignEvidence,
		exactFiveReplicatesCompleted: false as const,
		frozenGatePassed: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

function validateLiveFacts(
	value: unknown,
	binding: D65LiveCampaignBindingV1,
	disposition: "success" | "partial-failure",
	coreEvidenceDigest: string,
): readonly D65LiveCampaignFactV1[] {
	if (
		binding.campaignBindingDigest !==
		empiricalStrictJsonDigest({
			claimDigest: binding.liveClaimDigest,
			currentKeyAdmissionDigest: binding.currentKeyAdmissionDigest,
		})
	)
		throw new TypeError("D65 live campaign binding digest drifted");
	if (!Array.isArray(value) || value.length !== 2)
		throw new TypeError("D65 live evidence omitted its exact two Graph facts");
	const expected = [
		liveFact({
			schemaVersion: D65_LIVE_FACT_SCHEMA,
			sequence: 1 as const,
			factKind: "live-campaign-bound",
			binding,
		}),
		liveFact({
			schemaVersion: D65_LIVE_FACT_SCHEMA,
			sequence: 2 as const,
			factKind: "core-campaign-reconciled",
			disposition,
			coreEvidenceDigest,
		}),
	];
	if (empiricalStrictJsonDigest(value) !== empiricalStrictJsonDigest(expected))
		throw new TypeError("D65 live Graph fact replay drifted");
	return Object.freeze(expected);
}

export function validateD65LiveCampaignEvidence(value: unknown): D65LiveCampaignEvidenceV1 {
	const candidate = record(value, "D65 live campaign evidence");
	exactKeys(
		candidate,
		[
			"schemaVersion",
			"decisionRef",
			"authorityRevision",
			"binding",
			"facts",
			"campaignEvidence",
			"exactFiveReplicatesCompleted",
			"exactThirtyArmsEvaluable",
			"relevantPassCount",
			"controlPassCounts",
			"frozenGatePassed",
			"causalAttribution",
			"efficacyClaim",
			"evidenceDigest",
		],
		"D65 live campaign evidence",
	);
	const suppliedDigest = digest(candidate.evidenceDigest, "D65 live evidence");
	const { evidenceDigest: _evidenceDigest, ...material } = candidate;
	if (
		candidate.schemaVersion !== D65_LIVE_EVIDENCE_SCHEMA ||
		empiricalStrictJsonDigest(material) !== suppliedDigest
	)
		throw new TypeError("D65 live campaign evidence identity drifted");
	const campaignEvidence = validateD65CampaignEvidenceWithBaseline({
		evidence: candidate.campaignEvidence,
		baselineProjection: D65_D64_BASELINE_PROJECTION,
	});
	const binding = strictSnapshot(candidate.binding) as D65LiveCampaignBindingV1;
	const facts = validateLiveFacts(
		candidate.facts,
		binding,
		"success",
		campaignEvidence.evidenceDigest,
	);
	const efficacyClaim = campaignEvidence.frozenGatePassed
		? ("replicated-frozen-task-positive-differential" as const)
		: ("none" as const);
	const replayMaterial = strictSnapshot({
		schemaVersion: D65_LIVE_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D65" as const,
		authorityRevision: D65_LIVE_AUTHORITY_REVISION,
		binding,
		facts,
		campaignEvidence,
		exactFiveReplicatesCompleted: true as const,
		exactThirtyArmsEvaluable: campaignEvidence.exactThirtyArmsEvaluable,
		relevantPassCount: campaignEvidence.relevantPassCount,
		controlPassCounts: campaignEvidence.controlPassCounts,
		frozenGatePassed: campaignEvidence.frozenGatePassed,
		causalAttribution: "undetermined" as const,
		efficacyClaim,
	});
	const replayed = Object.freeze({
		...replayMaterial,
		evidenceDigest: empiricalStrictJsonDigest(replayMaterial),
	});
	if (empiricalStrictJsonDigest(replayed) !== empiricalStrictJsonDigest(candidate))
		throw new TypeError("D65 live canonical replay drifted");
	return replayed;
}

export function validateD65LivePartialCampaignEvidence(
	value: unknown,
): D65LivePartialCampaignEvidenceV1 {
	const candidate = record(value, "D65 live partial campaign evidence");
	exactKeys(
		candidate,
		[
			"schemaVersion",
			"decisionRef",
			"authorityRevision",
			"binding",
			"facts",
			"partialCampaignEvidence",
			"exactFiveReplicatesCompleted",
			"frozenGatePassed",
			"causalAttribution",
			"efficacyClaim",
			"evidenceDigest",
		],
		"D65 live partial campaign evidence",
	);
	const suppliedDigest = digest(candidate.evidenceDigest, "D65 live partial evidence");
	const { evidenceDigest: _evidenceDigest, ...material } = candidate;
	if (
		candidate.schemaVersion !== D65_LIVE_PARTIAL_EVIDENCE_SCHEMA ||
		empiricalStrictJsonDigest(material) !== suppliedDigest
	)
		throw new TypeError("D65 live partial campaign evidence identity drifted");
	const partialCampaignEvidence = validateD65PartialCampaignEvidenceWithBaseline({
		evidence: candidate.partialCampaignEvidence,
		baselineProjection: D65_D64_BASELINE_PROJECTION,
	});
	const binding = strictSnapshot(candidate.binding) as D65LiveCampaignBindingV1;
	const facts = validateLiveFacts(
		candidate.facts,
		binding,
		"partial-failure",
		partialCampaignEvidence.evidenceDigest,
	);
	const replayMaterial = strictSnapshot({
		schemaVersion: D65_LIVE_PARTIAL_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D65" as const,
		authorityRevision: D65_LIVE_AUTHORITY_REVISION,
		binding,
		facts,
		partialCampaignEvidence,
		exactFiveReplicatesCompleted: false as const,
		frozenGatePassed: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const replayed = Object.freeze({
		...replayMaterial,
		evidenceDigest: empiricalStrictJsonDigest(replayMaterial),
	});
	if (empiricalStrictJsonDigest(replayed) !== empiricalStrictJsonDigest(candidate))
		throw new TypeError("D65 live partial canonical replay drifted");
	return replayed;
}
