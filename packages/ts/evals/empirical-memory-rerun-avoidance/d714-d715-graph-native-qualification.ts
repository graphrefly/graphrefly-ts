import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import type { Node } from "../../src/node/node.js";
import type { AgentRequestIssued, EffectRunResult } from "../../src/orchestration/agent-runtime.js";
import { workItemExecutionRecipe } from "../../src/solutions/work-item/execution.js";
import type {
	WorkItemEffectPlanProposed,
	WorkItemProjection,
} from "../../src/solutions/work-item/scheduling.js";
import {
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	strictSnapshot,
} from "./canonical.js";
import {
	commitD696PrivateStagingDirectory,
	failD696PrivateStagingGeneration,
} from "./d696-continuation-assisted-live.js";
import { syncDirectory, writePrivateFile } from "./private-smoke-persistence.js";

export const D714_D715_QUALIFICATION_SCHEMA =
	"graphrefly.b112.graph-native-progress-recovery-qualification.v1" as const;
export const D714_D715_SCORECARD_SCHEMA =
	"graphrefly.b112.graph-native-progress-recovery-scorecard.v1" as const;
export const D714_D715_GENERATION_SCHEMA =
	"graphrefly.b112.graph-native-progress-recovery-generation.v1" as const;
export const D714_D715_CLAIM_BOUNDARY =
	"package-private-offline-graph-native-progress-and-recovery" as const;
export const D714_D713_SOURCE_OBSERVATION_DIGEST =
	"sha256:b974b651f14ea5a89a1c2b4b4f81d7635189a7e252a072afaad4bad30470d7c2" as const;
export const D714_D715_QUALIFIED_EVIDENCE_DIGEST =
	"sha256:56d5ec277761d635b9036a2dd0a2c84db6bcd8731d3f148f020744b17297b644" as const;
export const D714_D715_QUALIFIED_SCORECARD_DIGEST =
	"sha256:46d422c8178b6d18d584dbb3b589c80cd7893c369f20500c561e687777a9e67f" as const;
export const D714_D715_QUALIFIED_GENERATION_DIGEST =
	"sha256:1d1c1b72e81fd6b4aa6ed3e1a0c8f5e1da960a067abb1b9cbd86cacfa4e48588" as const;
export const D714_D715_ARM_ORDER = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

type D714Arm = (typeof D714_D715_ARM_ORDER)[number];
type D714Phase =
	| "none"
	| "inspection"
	| "exact-mutation"
	| "workspace-diff"
	| "focused-validation-attempted"
	| "focused-validation-passed"
	| "hidden-verifier-attempted"
	| "hidden-verifier-passed";
type D715NextPhase =
	| "exact-mutation"
	| "workspace-diff"
	| "focused-validation"
	| "finalization"
	| "correction-first";

interface D714InfrastructureAdmission {
	readonly admitted: boolean;
	readonly evidenceDigest: string;
}

interface D714ArmDefinition {
	readonly arm: D714Arm;
	readonly workItemId: string;
	readonly executionInputRevision: number;
}

interface D714ArmAdmission extends D714ArmDefinition {
	readonly admission: "admitted";
	readonly infrastructureEvidenceDigest: string;
}

export interface D714ArmExecutionFact {
	readonly arm: D714Arm;
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly infrastructureEvidenceDigest: string;
	readonly traceComplete: boolean;
	readonly inspectionObserved: boolean;
	readonly contentChangingMutationObserved: boolean;
	readonly nonEmptyDiffAfterLatestMutation: boolean;
	readonly focusedValidationAttempted: boolean;
	readonly focusedValidationPassed: boolean;
	readonly hiddenVerifierAttempted: boolean;
	readonly hiddenVerifierPassed: boolean;
	readonly requests: number;
	readonly costMicrousd: number;
	readonly elapsedMs: number;
}

export interface D714ArmProgressProjection {
	readonly arm: D714Arm;
	readonly workItemId: string;
	readonly phase: D714Phase;
	readonly evaluable: boolean;
	readonly fullTaskCompleted: boolean;
	readonly requests: number;
	readonly costMicrousd: number;
	readonly elapsedMs: number;
	readonly provenanceDigest: string;
}

export interface D715RecoveryInput {
	readonly caseId: string;
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly workspaceStateDigest: string;
	readonly rejectionWorkspaceStateDigest: string;
	readonly rejectionReceiptDigest: string;
	readonly rejectedBatchActionCount: 0;
	readonly rejectedBatchContainsLaterReplaceExact: boolean;
	readonly mutationObserved: boolean;
	readonly diffAfterLatestMutationObserved: boolean;
	readonly focusedValidationAttempted: boolean;
	readonly focusedValidationPassed: boolean;
	readonly focusedValidationFailed: boolean;
	readonly remainingRequests: number;
	readonly remainingCostMicrousd: number;
}

export interface D715RecoveryDecision {
	readonly caseId: string;
	readonly workItemId: string;
	readonly admitted: boolean;
	readonly nextRequiredPhase: D715NextPhase | null;
	readonly issueCode: "stale-workspace-provenance" | "recovery-budget-exhausted" | null;
	readonly rejectedBatchExecutedActionCount: 0;
	readonly sourceReceiptDigest: string;
	readonly workspaceStateDigest: string;
}

interface D714D715RequestInput {
	readonly authority: "D714" | "D715";
	readonly armOrCase: string;
	readonly requiredPhase: "measure-arm" | D715NextPhase;
	readonly sourceDigest: string;
}

export interface D714D715QualificationV1 {
	readonly schemaVersion: typeof D714_D715_QUALIFICATION_SCHEMA;
	readonly authority: readonly ["D714", "D715"];
	readonly claimBoundary: typeof D714_D715_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly measurement: {
		readonly sourceObservationDigest: typeof D714_D713_SOURCE_OBSERVATION_DIGEST;
		readonly armOrder: readonly D714Arm[];
		readonly admittedArms: readonly D714Arm[];
		readonly issuedRequestCount: number;
		readonly coldPhase: D714Phase;
		readonly coldEvaluable: boolean;
		readonly warmArmsIndependentOfCold: boolean;
		readonly progress: readonly D714ArmProgressProjection[];
		readonly topologyDigest: string;
		readonly topology: readonly {
			readonly id: string;
			readonly factory: string;
			readonly deps: readonly string[];
		}[];
	};
	readonly recovery: {
		readonly caseCount: number;
		readonly genericCaseCount: number;
		readonly decisions: readonly D715RecoveryDecision[];
		readonly issuedRequestCount: number;
		readonly duplicateEffectRunSuppressionPassed: boolean;
		readonly d713NextRequiredPhase: D715NextPhase;
		readonly rejectedBatchZeroSideEffects: boolean;
		readonly topologyDigest: string;
		readonly topology: readonly {
			readonly id: string;
			readonly factory: string;
			readonly deps: readonly string[];
		}[];
	};
	readonly gates: {
		readonly exactSixArmTopologyPassed: boolean;
		readonly d713PartialProgressPreserved: boolean;
		readonly twoGenericFixturesPassed: boolean;
		readonly workItemRecipeUsed: boolean;
		readonly staleProvenanceRejected: boolean;
		readonly budgetExhaustionRejected: boolean;
		readonly accessorRejectedBeforeRead: boolean;
		readonly noNetwork: true;
		readonly providerCallCount: 0;
		readonly chargedCostMicrousd: 0;
	};
	readonly evidenceDigest: string;
}

export interface D714D715ScorecardV1 {
	readonly schemaVersion: typeof D714_D715_SCORECARD_SCHEMA;
	readonly claimBoundary: typeof D714_D715_CLAIM_BOUNDARY;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly qualificationDigest: string;
	readonly qualified: boolean;
	readonly admittedArmCount: number;
	readonly evaluableArmCount: number;
	readonly recoveryCaseCount: number;
	readonly scorecardDigest: string;
}

const constructedQualifications = new WeakSet<object>();
const constructedScorecards = new WeakSet<object>();

function collectData<T>(node: Node<T>): T[] {
	const values: T[] = [];
	node.subscribe((message) => {
		if (message[0] === "DATA") values.push(message[1] as T);
	});
	return values;
}

function topologyEvidence(owner: ReturnType<typeof graph>): {
	readonly digest: string;
	readonly factories: readonly string[];
	readonly nodes: readonly {
		readonly id: string;
		readonly factory: string;
		readonly deps: readonly string[];
	}[];
} {
	const topology = owner.topology();
	const material = strictSnapshot({
		nodes: topology.nodes.map((node) => ({
			id: node.id,
			factory: node.factory,
			deps: Object.freeze([...node.deps]),
		})),
		edges: topology.edges,
	});
	return Object.freeze({
		digest: empiricalStrictJsonDigest(material),
		factories: Object.freeze(topology.nodes.map((node) => node.factory).sort()),
		nodes: material.nodes,
	});
}

function phaseFor(fact: D714ArmExecutionFact): D714Phase {
	if (
		(fact.hiddenVerifierPassed && !fact.hiddenVerifierAttempted) ||
		(fact.hiddenVerifierAttempted && !fact.focusedValidationPassed) ||
		(fact.focusedValidationPassed && !fact.focusedValidationAttempted) ||
		(fact.focusedValidationAttempted && !fact.nonEmptyDiffAfterLatestMutation) ||
		(fact.nonEmptyDiffAfterLatestMutation && !fact.contentChangingMutationObserved) ||
		(fact.contentChangingMutationObserved && !fact.inspectionObserved)
	) {
		return "none";
	}
	if (fact.hiddenVerifierPassed) return "hidden-verifier-passed";
	if (fact.hiddenVerifierAttempted) return "hidden-verifier-attempted";
	if (fact.focusedValidationPassed) return "focused-validation-passed";
	if (fact.focusedValidationAttempted) return "focused-validation-attempted";
	if (fact.nonEmptyDiffAfterLatestMutation) return "workspace-diff";
	if (fact.contentChangingMutationObserved) return "exact-mutation";
	if (fact.inspectionObserved) return "inspection";
	return "none";
}

function validDigest(value: unknown, path: string): string {
	if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
		throw new TypeError(`${path} must be a sha256 digest`);
	}
	return value;
}

function validateRecoveryInput(value: unknown): D715RecoveryInput {
	const candidate = record(value, "d715.recoveryInput");
	exactKeys(
		candidate,
		[
			"caseId",
			"diffAfterLatestMutationObserved",
			"executionInputRevision",
			"focusedValidationAttempted",
			"focusedValidationFailed",
			"focusedValidationPassed",
			"mutationObserved",
			"rejectedBatchActionCount",
			"rejectedBatchContainsLaterReplaceExact",
			"rejectionReceiptDigest",
			"rejectionWorkspaceStateDigest",
			"remainingCostMicrousd",
			"remainingRequests",
			"workItemId",
			"workspaceStateDigest",
		],
		"d715.recoveryInput",
	);
	strictSnapshot(candidate);
	if (
		typeof candidate.caseId !== "string" ||
		candidate.caseId.length === 0 ||
		candidate.caseId.length > 128 ||
		typeof candidate.workItemId !== "string" ||
		candidate.workItemId.length === 0 ||
		candidate.workItemId.length > 128
	) {
		throw new TypeError("D715 recovery coordinates are invalid");
	}
	for (const field of [
		"mutationObserved",
		"diffAfterLatestMutationObserved",
		"focusedValidationAttempted",
		"focusedValidationPassed",
		"focusedValidationFailed",
		"rejectedBatchContainsLaterReplaceExact",
	] as const) {
		if (typeof candidate[field] !== "boolean") throw new TypeError(`D715 ${field} is invalid`);
	}
	for (const field of [
		"executionInputRevision",
		"remainingRequests",
		"remainingCostMicrousd",
	] as const) {
		if (!Number.isSafeInteger(candidate[field]) || (candidate[field] as number) < 0) {
			throw new TypeError(`D715 ${field} is invalid`);
		}
	}
	literal(candidate.rejectedBatchActionCount, 0, "d715.rejectedBatchActionCount");
	validDigest(candidate.workspaceStateDigest, "d715.workspaceStateDigest");
	validDigest(candidate.rejectionWorkspaceStateDigest, "d715.rejectionWorkspaceStateDigest");
	validDigest(candidate.rejectionReceiptDigest, "d715.rejectionReceiptDigest");
	return strictSnapshot(candidate) as unknown as D715RecoveryInput;
}

function nextRecovery(input: D715RecoveryInput): D715RecoveryDecision {
	if (input.workspaceStateDigest !== input.rejectionWorkspaceStateDigest) {
		return Object.freeze({
			caseId: input.caseId,
			workItemId: input.workItemId,
			admitted: false,
			nextRequiredPhase: null,
			issueCode: "stale-workspace-provenance",
			rejectedBatchExecutedActionCount: 0,
			sourceReceiptDigest: input.rejectionReceiptDigest,
			workspaceStateDigest: input.workspaceStateDigest,
		});
	}
	if (input.remainingRequests < 1 || input.remainingCostMicrousd < 1) {
		return Object.freeze({
			caseId: input.caseId,
			workItemId: input.workItemId,
			admitted: false,
			nextRequiredPhase: null,
			issueCode: "recovery-budget-exhausted",
			rejectedBatchExecutedActionCount: 0,
			sourceReceiptDigest: input.rejectionReceiptDigest,
			workspaceStateDigest: input.workspaceStateDigest,
		});
	}
	const nextRequiredPhase: D715NextPhase = input.focusedValidationPassed
		? "finalization"
		: input.rejectedBatchContainsLaterReplaceExact && input.diffAfterLatestMutationObserved
			? "correction-first"
			: !input.mutationObserved
				? "exact-mutation"
				: !input.diffAfterLatestMutationObserved
					? "workspace-diff"
					: input.focusedValidationFailed
						? "correction-first"
						: !input.focusedValidationAttempted
							? "focused-validation"
							: "finalization";
	return Object.freeze({
		caseId: input.caseId,
		workItemId: input.workItemId,
		admitted: true,
		nextRequiredPhase,
		issueCode: null,
		rejectedBatchExecutedActionCount: 0,
		sourceReceiptDigest: input.rejectionReceiptDigest,
		workspaceStateDigest: input.workspaceStateDigest,
	});
}

function workItemFor(
	workItemId: string,
	executionInputRevision: number,
	sourceDigest: string,
): WorkItemProjection<D714D715RequestInput> {
	return Object.freeze({
		workItemId,
		summary: "Graph-native empirical arm or recovery",
		authoringRevision: 1,
		executionInputRevision,
		lastEventId: `event:${workItemId}:${executionInputRevision}`,
		revisionSourceRefs: Object.freeze([{ kind: "graph-native-evidence", id: sourceDigest }]),
	});
}

function proposalFor(input: {
	readonly authority: "D714" | "D715";
	readonly workItemId: string;
	readonly executionInputRevision: number;
	readonly armOrCase: string;
	readonly requiredPhase: "measure-arm" | D715NextPhase;
	readonly sourceDigest: string;
}): WorkItemEffectPlanProposed<D714D715RequestInput> {
	const requestInput = Object.freeze({
		authority: input.authority,
		armOrCase: input.armOrCase,
		requiredPhase: input.requiredPhase,
		sourceDigest: input.sourceDigest,
	} satisfies D714D715RequestInput);
	return Object.freeze({
		kind: "work-item-effect-plan-proposed",
		planId: `plan:${input.authority}:${input.armOrCase}`,
		workItemId: input.workItemId,
		executionInputRevision: input.executionInputRevision,
		joinPolicy: "all-required",
		sourceRefs: Object.freeze([{ kind: "graph-native-evidence", id: input.sourceDigest }]),
		members: Object.freeze([
			Object.freeze({
				memberId: `member:${input.requiredPhase}`,
				effectKind: "graph-native-agent-turn",
				required: true,
				goal: Object.freeze({
					kind: "graph-native-agent-turn",
					input: Object.freeze({
						inputId: `input:${input.authority}:${input.armOrCase}`,
						inputKind: "graph-native-agent-turn",
						dataMode: "inline" as const,
						value: requestInput,
					}),
				}),
				limits: Object.freeze({ maxSteps: 1, maxRequests: 1 }),
				sourceRefs: Object.freeze([{ kind: "graph-native-evidence", id: input.sourceDigest }]),
			}),
		]),
	});
}

function runMeasurementGraph(): D714D715QualificationV1["measurement"] & {
	readonly factories: readonly string[];
} {
	const owner = graph({ name: "d714/graph-native-measurement" });
	const infrastructure = owner.node<D714InfrastructureAdmission>([], null, {
		name: "d714/infrastructureAdmission",
	});
	const armDefinitions = owner.node<D714ArmDefinition>([], null, { name: "d714/armDefinitions" });
	const executionFacts = owner.node<D714ArmExecutionFact>([], null, {
		name: "d714/executionFacts",
	});
	const results = owner.node<EffectRunResult>([], null, { name: "d714/effectRunResults" });
	const armAdmissions = owner.node<D714ArmAdmission>(
		[infrastructure, armDefinitions],
		(ctx) => {
			let admission = ctx.state.get<D714InfrastructureAdmission>();
			for (const item of depBatch(ctx, 0) ?? []) admission = item as D714InfrastructureAdmission;
			for (const item of depBatch(ctx, 1) ?? []) {
				const arm = item as D714ArmDefinition;
				if (admission?.admitted) {
					ctx.down([
						[
							"DATA",
							Object.freeze({
								...arm,
								admission: "admitted" as const,
								infrastructureEvidenceDigest: admission.evidenceDigest,
							}),
						],
					]);
				}
			}
			if (admission !== undefined) ctx.state.set(admission);
		},
		{ name: "d714/armAdmissions", factory: "d714IndependentArmAdmission" },
	);
	const workItems = owner.node<WorkItemProjection<D714D715RequestInput>>(
		[armAdmissions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const arm = raw as D714ArmAdmission;
				ctx.down([
					[
						"DATA",
						workItemFor(
							arm.workItemId,
							arm.executionInputRevision,
							arm.infrastructureEvidenceDigest,
						),
					],
				]);
			}
		},
		{ name: "d714/workItems", factory: "d714ArmWorkItems" },
	);
	const proposals = owner.node<WorkItemEffectPlanProposed<D714D715RequestInput>>(
		[armAdmissions],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const arm = raw as D714ArmAdmission;
				ctx.down([
					[
						"DATA",
						proposalFor({
							authority: "D714",
							workItemId: arm.workItemId,
							executionInputRevision: arm.executionInputRevision,
							armOrCase: arm.arm,
							requiredPhase: "measure-arm",
							sourceDigest: arm.infrastructureEvidenceDigest,
						}),
					],
				]);
			}
		},
		{ name: "d714/effectPlanProposals", factory: "d714ArmEffectPlanProjector" },
	);
	const progress = owner.node<D714ArmProgressProjection>(
		[executionFacts],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as D714ArmExecutionFact;
				const phase = phaseFor(fact);
				ctx.down([
					[
						"DATA",
						Object.freeze({
							arm: fact.arm,
							workItemId: fact.workItemId,
							phase,
							evaluable: fact.traceComplete && phase !== "none",
							fullTaskCompleted: fact.hiddenVerifierPassed,
							requests: fact.requests,
							costMicrousd: fact.costMicrousd,
							elapsedMs: fact.elapsedMs,
							provenanceDigest: empiricalStrictJsonDigest(fact),
						}),
					],
				]);
			}
		},
		{ name: "d714/progressProjection", factory: "d714OrderedPhaseProjection" },
	);
	const recipe = workItemExecutionRecipe(owner, {
		name: "d714/workItemExecution",
		workItems,
		effectPlanProposals: proposals,
		effectRunResults: results,
		policy: { allowedEffectKinds: ["graph-native-agent-turn"] },
		now: () => 0,
	});
	const admissions = collectData(armAdmissions);
	const issued = collectData(recipe.requests);
	const projected = collectData(progress);
	const infrastructureEvidenceDigest = empiricalStrictJsonDigest({
		kind: "offline-infrastructure-admission",
		revision: "D714",
		sourceObservationDigest: D714_D713_SOURCE_OBSERVATION_DIGEST,
	});
	infrastructure.down([
		["DATA", Object.freeze({ admitted: true, evidenceDigest: infrastructureEvidenceDigest })],
	]);
	for (const [index, arm] of D714_D715_ARM_ORDER.entries()) {
		armDefinitions.down([
			[
				"DATA",
				Object.freeze({
					arm,
					workItemId: `d714-arm-${arm}`,
					executionInputRevision: index + 1,
				}),
			],
		]);
	}
	for (const [index, arm] of D714_D715_ARM_ORDER.entries()) {
		const isCold = arm === "cold";
		executionFacts.down([
			[
				"DATA",
				Object.freeze({
					arm,
					workItemId: `d714-arm-${arm}`,
					executionInputRevision: index + 1,
					infrastructureEvidenceDigest,
					traceComplete: true,
					inspectionObserved: true,
					contentChangingMutationObserved: isCold,
					nonEmptyDiffAfterLatestMutation: isCold,
					focusedValidationAttempted: false,
					focusedValidationPassed: false,
					hiddenVerifierAttempted: false,
					hiddenVerifierPassed: false,
					requests: isCold ? 8 : 2,
					costMicrousd: isCold ? 28_034 : 0,
					elapsedMs: isCold ? 1_125_669 : 1,
				} satisfies D714ArmExecutionFact),
			],
		]);
	}
	const topology = topologyEvidence(owner);
	return Object.freeze({
		sourceObservationDigest: D714_D713_SOURCE_OBSERVATION_DIGEST,
		armOrder: D714_D715_ARM_ORDER,
		admittedArms: Object.freeze(admissions.map((item) => item.arm)),
		issuedRequestCount: issued.length,
		coldPhase: projected.find((item) => item.arm === "cold")?.phase ?? "none",
		coldEvaluable: projected.find((item) => item.arm === "cold")?.evaluable ?? false,
		warmArmsIndependentOfCold:
			admissions.length === 6 && admissions.filter((item) => item.arm !== "cold").length === 5,
		progress: Object.freeze(projected),
		topologyDigest: topology.digest,
		topology: topology.nodes,
		factories: topology.factories,
	});
}

function recoveryFixture(caseId: string, overrides: Partial<D715RecoveryInput>): D715RecoveryInput {
	const state = empiricalStrictJsonDigest({ caseId, state: 1 });
	return Object.freeze({
		caseId,
		workItemId: `d715-${caseId}`,
		executionInputRevision: 1,
		workspaceStateDigest: state,
		rejectionWorkspaceStateDigest: state,
		rejectionReceiptDigest: empiricalStrictJsonDigest({ caseId, receipt: 1 }),
		rejectedBatchActionCount: 0,
		rejectedBatchContainsLaterReplaceExact: false,
		mutationObserved: false,
		diffAfterLatestMutationObserved: false,
		focusedValidationAttempted: false,
		focusedValidationPassed: false,
		focusedValidationFailed: false,
		remainingRequests: 4,
		remainingCostMicrousd: 100_000,
		...overrides,
	});
}

function runRecoveryGraph(): D714D715QualificationV1["recovery"] & {
	readonly factories: readonly string[];
} {
	const owner = graph({ name: "d715/graph-native-recovery" });
	const recoveryInputs = owner.node<D715RecoveryInput>([], null, { name: "d715/recoveryInputs" });
	const results = owner.node<EffectRunResult>([], null, { name: "d715/effectRunResults" });
	const decisions = owner.node<D715RecoveryDecision>(
		[recoveryInputs],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([["DATA", nextRecovery(raw as D715RecoveryInput)]]);
		},
		{ name: "d715/recoveryDecisions", factory: "d715PhaseDirectedRecoveryPlanner" },
	);
	const workItems = owner.node<WorkItemProjection<D714D715RequestInput>>(
		[recoveryInputs, decisions],
		(ctx) => {
			const inputs = new Map<string, D715RecoveryInput>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const input = raw as D715RecoveryInput;
				inputs.set(input.caseId, input);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const decision = raw as D715RecoveryDecision;
				const input = inputs.get(decision.caseId);
				if (decision.admitted && input !== undefined) {
					ctx.down([
						[
							"DATA",
							workItemFor(
								input.workItemId,
								input.executionInputRevision,
								input.rejectionReceiptDigest,
							),
						],
					]);
				}
			}
		},
		{ name: "d715/workItems", factory: "d715RecoveryWorkItems" },
	);
	const proposals = owner.node<WorkItemEffectPlanProposed<D714D715RequestInput>>(
		[recoveryInputs, decisions],
		(ctx) => {
			const inputs = new Map<string, D715RecoveryInput>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const input = raw as D715RecoveryInput;
				inputs.set(input.caseId, input);
			}
			for (const raw of depBatch(ctx, 1) ?? []) {
				const decision = raw as D715RecoveryDecision;
				const input = inputs.get(decision.caseId);
				if (decision.admitted && decision.nextRequiredPhase !== null && input !== undefined) {
					ctx.down([
						[
							"DATA",
							proposalFor({
								authority: "D715",
								workItemId: input.workItemId,
								executionInputRevision: input.executionInputRevision,
								armOrCase: input.caseId,
								requiredPhase: decision.nextRequiredPhase,
								sourceDigest: input.rejectionReceiptDigest,
							}),
						],
					]);
				}
			}
		},
		{ name: "d715/effectPlanProposals", factory: "d715RecoveryEffectPlanProjector" },
	);
	const recipe = workItemExecutionRecipe(owner, {
		name: "d715/workItemExecution",
		workItems,
		effectPlanProposals: proposals,
		effectRunResults: results,
		policy: { allowedEffectKinds: ["graph-native-agent-turn"] },
		now: () => 0,
	});
	const projected = collectData(decisions);
	const requests = collectData<AgentRequestIssued<D714D715RequestInput>>(recipe.requests);
	const fixtures = Object.freeze([
		recoveryFixture("d713-sanitized-trace", {
			mutationObserved: true,
			diffAfterLatestMutationObserved: true,
			rejectedBatchContainsLaterReplaceExact: true,
		}),
		recoveryFixture("generic-mutation-missing", {}),
		recoveryFixture("generic-diff-missing", { mutationObserved: true }),
	]);
	for (const fixture of fixtures) recoveryInputs.down([["DATA", validateRecoveryInput(fixture)]]);
	// The duplicate is load-bearing: the recipe must not issue a second EffectRun/request.
	recoveryInputs.down([["DATA", validateRecoveryInput(fixtures[1])]]);
	const stale = recoveryFixture("stale-provenance", {
		rejectionWorkspaceStateDigest: empiricalStrictJsonDigest({ stale: true }),
	});
	const exhausted = recoveryFixture("budget-exhausted", {
		remainingRequests: 0,
		remainingCostMicrousd: 0,
	});
	recoveryInputs.down([["DATA", validateRecoveryInput(stale)]]);
	recoveryInputs.down([["DATA", validateRecoveryInput(exhausted)]]);
	const topology = topologyEvidence(owner);
	const d713Decision = projected.find((item) => item.caseId === "d713-sanitized-trace");
	return Object.freeze({
		caseCount: fixtures.length,
		genericCaseCount: 2,
		decisions: Object.freeze(projected),
		issuedRequestCount: requests.length,
		duplicateEffectRunSuppressionPassed: requests.length === fixtures.length,
		d713NextRequiredPhase: d713Decision?.nextRequiredPhase ?? "finalization",
		rejectedBatchZeroSideEffects: projected.every(
			(item) => item.rejectedBatchExecutedActionCount === 0,
		),
		topologyDigest: topology.digest,
		topology: topology.nodes,
		factories: topology.factories,
	});
}

function accessorGate(): boolean {
	let hits = 0;
	const candidate = Object.defineProperty({}, "caseId", {
		enumerable: true,
		get() {
			hits += 1;
			return "forged";
		},
	});
	try {
		validateRecoveryInput(candidate);
	} catch {
		return hits === 0;
	}
	return false;
}

export function runD714D715GraphNativeQualification(): D714D715QualificationV1 {
	const measurement = runMeasurementGraph();
	const recovery = runRecoveryGraph();
	const stale = recovery.decisions.find((item) => item.caseId === "stale-provenance");
	const exhausted = recovery.decisions.find((item) => item.caseId === "budget-exhausted");
	const workItemRecipeUsed = [...measurement.factories, ...recovery.factories].includes(
		"workItemExecutionRequestFacts",
	);
	const material = strictSnapshot({
		schemaVersion: D714_D715_QUALIFICATION_SCHEMA,
		authority: ["D714", "D715"] as const,
		claimBoundary: D714_D715_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		measurement: {
			sourceObservationDigest: measurement.sourceObservationDigest,
			armOrder: measurement.armOrder,
			admittedArms: measurement.admittedArms,
			issuedRequestCount: measurement.issuedRequestCount,
			coldPhase: measurement.coldPhase,
			coldEvaluable: measurement.coldEvaluable,
			warmArmsIndependentOfCold: measurement.warmArmsIndependentOfCold,
			progress: measurement.progress,
			topologyDigest: measurement.topologyDigest,
			topology: measurement.topology,
		},
		recovery: {
			caseCount: recovery.caseCount,
			genericCaseCount: recovery.genericCaseCount,
			decisions: recovery.decisions,
			issuedRequestCount: recovery.issuedRequestCount,
			duplicateEffectRunSuppressionPassed: recovery.duplicateEffectRunSuppressionPassed,
			d713NextRequiredPhase: recovery.d713NextRequiredPhase,
			rejectedBatchZeroSideEffects: recovery.rejectedBatchZeroSideEffects,
			topologyDigest: recovery.topologyDigest,
			topology: recovery.topology,
		},
		gates: {
			exactSixArmTopologyPassed:
				measurement.admittedArms.join("|") === D714_D715_ARM_ORDER.join("|") &&
				measurement.issuedRequestCount === 6,
			d713PartialProgressPreserved:
				measurement.coldPhase === "workspace-diff" && measurement.coldEvaluable,
			twoGenericFixturesPassed:
				recovery.genericCaseCount === 2 &&
				recovery.decisions.some(
					(item) =>
						item.caseId === "generic-mutation-missing" &&
						item.nextRequiredPhase === "exact-mutation",
				) &&
				recovery.decisions.some(
					(item) =>
						item.caseId === "generic-diff-missing" && item.nextRequiredPhase === "workspace-diff",
				),
			workItemRecipeUsed,
			staleProvenanceRejected: stale?.issueCode === "stale-workspace-provenance",
			budgetExhaustionRejected: exhausted?.issueCode === "recovery-budget-exhausted",
			accessorRejectedBeforeRead: accessorGate(),
			noNetwork: true as const,
			providerCallCount: 0 as const,
			chargedCostMicrousd: 0 as const,
		},
	});
	const qualification = strictSnapshot({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	});
	constructedQualifications.add(qualification);
	return qualification;
}

export function createD714D715Scorecard(
	qualification: D714D715QualificationV1,
): D714D715ScorecardV1 {
	if (!constructedQualifications.has(qualification as object)) {
		throw new TypeError("D714/D715 scorecard requires a same-process qualification");
	}
	const qualified = Object.values(qualification.gates).every(
		(value) => value === true || value === 0,
	);
	const material = strictSnapshot({
		schemaVersion: D714_D715_SCORECARD_SCHEMA,
		claimBoundary: D714_D715_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualificationDigest: qualification.evidenceDigest,
		qualified,
		admittedArmCount: qualification.measurement.admittedArms.length,
		evaluableArmCount: qualification.measurement.progress.filter((item) => item.evaluable).length,
		recoveryCaseCount: qualification.recovery.caseCount,
	});
	const scorecard = strictSnapshot({
		...material,
		scorecardDigest: empiricalStrictJsonDigest(material),
	});
	constructedScorecards.add(scorecard);
	return scorecard;
}

export async function persistD714D715PrivateGeneration(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly qualification: D714D715QualificationV1;
	readonly scorecard: D714D715ScorecardV1;
}): Promise<{
	readonly generationPath: string;
	readonly qualificationDigest: string;
	readonly scorecardDigest: string;
	readonly generationDigest: string;
}> {
	const candidate = record(input, "d714d715.persistence");
	exactKeys(
		candidate,
		["generationRef", "privateRoot", "qualification", "scorecard"],
		"d714d715.persistence",
	);
	if (
		!constructedQualifications.has(candidate.qualification as object) ||
		!constructedScorecards.has(candidate.scorecard as object)
	) {
		throw new TypeError("D714/D715 persistence requires same-process evidence");
	}
	const privateRoot = candidate.privateRoot;
	const generationRef = candidate.generationRef;
	if (
		typeof privateRoot !== "string" ||
		typeof generationRef !== "string" ||
		!/^[a-z0-9][a-z0-9.-]{0,127}$/.test(generationRef)
	) {
		throw new TypeError("D714/D715 persistence coordinates are invalid");
	}
	await mkdir(privateRoot, { recursive: true, mode: 0o700 });
	const rootStatus = await lstat(privateRoot);
	if (
		!rootStatus.isDirectory() ||
		rootStatus.isSymbolicLink() ||
		(rootStatus.mode & 0o777) !== 0o700
	) {
		throw new TypeError("D714/D715 private root must be an exact 0700 directory");
	}
	const finalPath = join(privateRoot, generationRef);
	try {
		await lstat(finalPath);
		throw new TypeError("D714/D715 generation already exists");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const qualification = candidate.qualification as D714D715QualificationV1;
	const scorecard = candidate.scorecard as D714D715ScorecardV1;
	const generationMaterial = strictSnapshot({
		schemaVersion: D714_D715_GENERATION_SCHEMA,
		generationRef,
		claimBoundary: D714_D715_CLAIM_BOUNDARY,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualification: {
			file: "qualification.v1.json",
			digest: qualification.evidenceDigest,
		},
		scorecard: { file: "scorecard.v1.json", digest: scorecard.scorecardDigest },
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const files = Object.freeze([
		{ file: "qualification.v1.json", bytes: strictJsonCodec.encode(qualification) },
		{ file: "scorecard.v1.json", bytes: strictJsonCodec.encode(scorecard) },
		{ file: "generation.v1.json", bytes: strictJsonCodec.encode(generation) },
	]);
	const stagingPath = join(privateRoot, `.d714-d715-staging-${randomUUID()}`);
	try {
		await mkdir(stagingPath, { mode: 0o700 });
		for (const file of files) await writePrivateFile(join(stagingPath, file.file), file.bytes);
		await syncDirectory(stagingPath);
		for (const file of files) {
			const readback = new Uint8Array(await readFile(join(stagingPath, file.file)));
			if (!Buffer.from(readback).equals(file.bytes)) {
				throw new TypeError(`D714/D715 staging readback failed for ${file.file}`);
			}
		}
		await commitD696PrivateStagingDirectory({ stagingPath, finalPath, privateRoot });
		constructedQualifications.delete(qualification as object);
		constructedScorecards.delete(scorecard as object);
		return Object.freeze({
			generationPath: finalPath,
			qualificationDigest: qualification.evidenceDigest,
			scorecardDigest: scorecard.scorecardDigest,
			generationDigest: generation.generationDigest,
		});
	} catch (error) {
		return failD696PrivateStagingGeneration(stagingPath, error);
	}
}
