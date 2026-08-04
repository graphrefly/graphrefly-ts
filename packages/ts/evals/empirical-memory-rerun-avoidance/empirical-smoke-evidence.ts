import {
	array,
	coordinate,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	CLOSED_TASK_PROFILE_HOST_MAX_ACTION_TRACE_ENTRIES,
	type ClosedTaskProfileHostRunOutcomeV3,
} from "./closed-task-profile-host.js";
import type { EmpiricalWarmBranchKind, FrozenEmpiricalCampaignManifestV1 } from "./contracts.js";
import type { QualifiedOpenRouterRouteV1 } from "./openrouter-route-qualification.js";

export const EMPIRICAL_TRIAL_BLOCK_OBSERVATION_SCHEMA =
	"graphrefly.private-solution-eval.empirical-trial-block-observation.v3";
export const EMPIRICAL_CAMPAIGN_SCORECARD_SCHEMA =
	"graphrefly.private-solution-eval.empirical-campaign-scorecard.v3";
export const B112_SMOKE_NO_EFFICACY_CLAIM = "smoke-integration-no-efficacy-claim";
export const EMPIRICAL_CALIBRATION_TRIAL_BLOCK_OBSERVATION_SCHEMA =
	"graphrefly.private-solution-eval.empirical-trial-block-observation.v4";
export const B112_CALIBRATION_EXPLORATORY_NO_EFFICACY_CLAIM =
	"calibration-exploratory-no-efficacy-claim";

export type EmpiricalSmokeEvidenceClassV1 =
	| "simulated-contract"
	| "live-approved-no-provider-evidence"
	| "live-provider";

export interface EmpiricalSmokeCostLedgerV1 {
	readonly costBasis: "simulated-contract" | "provider-usage" | "conservative-reservation";
	readonly reservedInputTokens: number;
	readonly reservedOutputTokens: number;
	readonly costMicrousd: number;
}

export type EmpiricalSmokeRunClassificationV1 = "complete" | "incomplete" | "non-evaluable";
export type EmpiricalSmokeVerifierStatusV1 = "passed" | "failed" | "unverifiable" | "not-run";

export interface EmpiricalSmokeRunObservationV3 {
	readonly runRef: string;
	readonly trialStage: "cold" | "warm";
	readonly branchKind: EmpiricalWarmBranchKind | null;
	readonly classification: EmpiricalSmokeRunClassificationV1;
	readonly verifierStatus: EmpiricalSmokeVerifierStatusV1;
	readonly requests: number;
	readonly steps: number;
	readonly attempts: number;
	readonly retryWaitMs: number;
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly totalTokens: number | null;
	readonly hostInputBytes: number;
	readonly hostOutputBytes: number;
	readonly latencyMs: number;
	readonly costMicrousd: number;
	readonly costBasis: "simulated-contract" | "provider-usage" | "conservative-reservation";
	readonly reservedInputTokens: number;
	readonly reservedOutputTokens: number;
	readonly hostOutcomeDigest: string;
	readonly initialRequestDigest: string | null;
	readonly memoryContextRecordDigest: string | null;
	readonly turnRequestDigests: readonly string[];
	readonly attemptTrace: readonly {
		readonly stepIndex: number;
		readonly attemptOrdinal: number;
		readonly requestDigest: string;
		readonly status: "completed" | "non-evaluable";
		readonly requests: 0 | 1;
		readonly latencyMs: number;
		readonly issueCodes: readonly string[];
		readonly protectionReceiptDigest: string;
	}[];
	readonly retryWaitTrace: readonly {
		readonly stepIndex: number;
		readonly afterAttemptOrdinal: number;
		readonly scheduledDelayMs: number;
		readonly elapsedMs: number;
	}[];
	readonly toolResultBindings: readonly {
		readonly toolCallRefDigest: string;
		readonly toolRef: string;
		readonly resultDigest: string;
	}[];
	readonly workspaceBaselineDigest: string | null;
	readonly workspaceStateDigest: string | null;
	readonly workspaceChangeDigest: string | null;
	readonly workspaceChanged: boolean | null;
	readonly actionTraceDigest: string;
	readonly actionTrace: ClosedTaskProfileHostRunOutcomeV3["actionTrace"];
	readonly routeEvidenceDigests: readonly string[];
	readonly verifierEvidenceDigests: readonly string[];
	readonly protectionReceiptDigests: readonly string[];
	readonly issueCodes: readonly string[];
}

export interface EmpiricalWarmBranchLifecycleV2 {
	readonly branchKind: EmpiricalWarmBranchKind;
	readonly selectedRecordDigest: string;
	readonly proposalState: "emitted" | "not-emitted";
	readonly admissionState: "admitted" | "rejected" | "not-run";
	readonly applicationState: "applied" | "not-applied" | "not-run";
	readonly retrievalState: "retrieved" | "not-retrieved";
	readonly plannerRoute: "baseline" | "memory-guided";
	readonly traceMemoryDisposition: "delivered" | "rejected-irrelevant" | "rejected-scope" | "none";
	readonly mapperExplicitCandidates: 0;
	readonly proposalRecordDigests: readonly string[];
	readonly admissionRecordDigests: readonly string[];
	readonly applicationRecordDigests: readonly string[];
	readonly retrievalRecordDigests: readonly string[];
	readonly topologyDigest: string;
	readonly stagePredicates: {
		readonly cold_run_failed: boolean;
		readonly memory_record_proposed: boolean;
		readonly memory_record_admitted: boolean;
		readonly memory_record_applied: boolean;
		readonly memory_record_retrieved: boolean;
		readonly warm_run_passed: boolean;
		readonly warm_decision_trace_includes_memory: boolean;
		readonly warm_action_trace_bound_to_memory_context: boolean;
		readonly same_work_item_input: boolean;
		readonly prior_failure_route_avoided: boolean;
	};
	readonly caseConforms: boolean;
	readonly issueCodes: readonly string[];
}

export interface EmpiricalWarmBranchObservationV3 {
	readonly branchKind: EmpiricalWarmBranchKind;
	readonly attempted: boolean;
	readonly lifecycle: EmpiricalWarmBranchLifecycleV2 | null;
	readonly run: EmpiricalSmokeRunObservationV3 | null;
	readonly issueCodes: readonly string[];
}

export interface EmpiricalTrialBlockObservationV3 {
	readonly schemaVersion: typeof EMPIRICAL_TRIAL_BLOCK_OBSERVATION_SCHEMA;
	readonly executionClass: EmpiricalSmokeEvidenceClassV1;
	readonly empiricalLiveEvidence: boolean;
	readonly claimBoundary: typeof B112_SMOKE_NO_EFFICACY_CLAIM;
	readonly campaignRef: string;
	readonly manifestDigest: string;
	readonly profile: "smoke";
	readonly taskRef: string;
	readonly taskDigest: string;
	readonly trialBlockRef: string;
	readonly trialBlockDigest: string;
	readonly route: {
		readonly qualificationRef: string;
		readonly qualificationRevision: string;
		readonly qualificationDigest: string;
		readonly configurationRef: string;
		readonly configurationDigest: string;
		readonly model: string;
		readonly modelIdentityKind: "exact-snapshot" | "alias-disclosed";
		readonly providerFamily: "openrouter";
		readonly downstreamProviderSlug: string;
		readonly downstreamProviderName: string;
		readonly endpoint: string;
		readonly endpointRevision: string;
		readonly adapterRevision: string;
		readonly bindingRevision: string;
		readonly capabilitiesDigest: string;
		readonly settingsDigest: string;
		readonly usageSource: string;
		readonly usageRevision: string;
		readonly routeEvidenceSchemaRevision: string;
		readonly pricingSourceUrl: string;
		readonly pricingRevision: string;
		readonly inputMicrousdPerMillionTokens: number;
		readonly outputMicrousdPerMillionTokens: number;
		readonly budgetApprovalRef: string;
		readonly budgetApprovalRevision: string;
		readonly maxSmokeSpendMicrousd: number;
		readonly maxRequests: number;
		readonly maxStepsPerRun: number;
		readonly maxCanonicalRequestBytes: number;
		readonly maxInputTokens: number;
		readonly maxOutputTokens: number;
		readonly maxLatencyMs: number;
		readonly reservationRevision: string;
	};
	readonly result: {
		readonly classification: "complete" | "incomplete" | "non-evaluable";
		readonly verifierStatus: "passed" | "failed" | "unverifiable" | "not-run";
		readonly coldRunsAttempted: 1;
		readonly warmRunsAttempted: number;
		readonly requests: number;
		readonly steps: number;
		readonly attempts: number;
		readonly inputTokens: number | null;
		readonly outputTokens: number | null;
		readonly totalTokens: number | null;
		readonly hostInputBytes: number;
		readonly hostOutputBytes: number;
		readonly latencyMs: number;
		readonly costMicrousd: number;
		readonly costBasis: "simulated-contract" | "provider-usage" | "conservative-reservation";
		readonly reservedInputTokens: number;
		readonly reservedOutputTokens: number;
	};
	readonly hostOutcomeDigest: string;
	readonly routeEvidenceDigests: readonly string[];
	readonly verifierEvidenceDigests: readonly string[];
	readonly protectionReceiptDigests: readonly string[];
	readonly cold: EmpiricalSmokeRunObservationV3;
	readonly rerunEligible: boolean;
	readonly reflection: {
		readonly evidenceDigest: string | null;
		readonly candidateRecordDigests: readonly string[];
		readonly issueCodes: readonly string[];
	};
	readonly warmBranches: readonly EmpiricalWarmBranchObservationV3[];
	readonly familyPassed: boolean | null;
	readonly issueCodes: readonly string[];
}

export type EmpiricalCalibrationTrialBlockObservationV4 = Omit<
	EmpiricalTrialBlockObservationV3,
	"schemaVersion" | "claimBoundary" | "profile"
> & {
	readonly schemaVersion: typeof EMPIRICAL_CALIBRATION_TRIAL_BLOCK_OBSERVATION_SCHEMA;
	readonly claimBoundary: typeof B112_CALIBRATION_EXPLORATORY_NO_EFFICACY_CLAIM;
	readonly profile: "calibration";
	readonly blockIndex: 1 | 2 | 3;
};

export interface EmpiricalCampaignScorecardV3 {
	readonly schemaVersion: typeof EMPIRICAL_CAMPAIGN_SCORECARD_SCHEMA;
	readonly campaignRef: string;
	readonly manifestDigest: string;
	readonly profile: "smoke";
	readonly evidenceClass: EmpiricalSmokeEvidenceClassV1;
	readonly empiricalLiveEvidence: boolean;
	readonly efficacyClaim: "none";
	readonly claimBoundary: typeof B112_SMOKE_NO_EFFICACY_CLAIM;
	readonly aggregationRevision: string;
	readonly observationDigests: readonly [string];
	readonly attemptedBlocks: 1;
	readonly completeBlocks: 0 | 1;
	readonly incompleteBlocks: 0 | 1;
	readonly nonEvaluableBlocks: 0 | 1;
	readonly verifierPassedBlocks: 0 | 1;
	readonly eligibleColdFailures: 0 | 1;
	readonly warmRunsAttempted: number;
	readonly warmRunsEvaluable: number;
	readonly armResults: readonly {
		readonly branchKind: EmpiricalWarmBranchKind;
		readonly attempted: boolean;
		readonly evaluable: boolean;
		readonly verifierPassed: boolean | null;
		readonly caseConforms: boolean | null;
	}[];
	readonly primaryComparison: {
		readonly relevantAppliedPass: 0 | 1 | null;
		readonly proposalOnlyPass: 0 | 1 | null;
		readonly riskDifference: -1 | 0 | 1 | null;
		readonly discordance:
			| "relevant-only"
			| "proposal-only"
			| "concordant-pass"
			| "concordant-fail"
			| "not-evaluable";
	};
	readonly secondaryComparisons: readonly {
		readonly controlBranchKind: "admission-rejected" | "irrelevant-applied" | "wrong-scope-applied";
		readonly relevantAppliedPass: 0 | 1 | null;
		readonly controlPass: 0 | 1 | null;
		readonly riskDifference: -1 | 0 | 1 | null;
		readonly discordance:
			| "relevant-only"
			| "control-only"
			| "concordant-pass"
			| "concordant-fail"
			| "not-evaluable";
	}[];
	readonly familyPassed: boolean | null;
	readonly requests: number;
	readonly steps: number;
	readonly attempts: number;
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly totalTokens: number | null;
	readonly hostInputBytes: number;
	readonly hostOutputBytes: number;
	readonly latencyMs: number;
	readonly costMicrousd: number;
	readonly costBasis: "simulated-contract" | "provider-usage" | "conservative-reservation";
	readonly reservedInputTokens: number;
	readonly reservedOutputTokens: number;
	readonly status: "smoke-complete-no-efficacy-claim" | "incomplete" | "non-evaluable";
	readonly issueCodes: readonly string[];
}

function sortedUniqueCoordinates(values: readonly string[], path: string): readonly string[] {
	if (values.length > 128) throw new TypeError(`${path} exceeds its bounded item count`);
	return Object.freeze(
		[...new Set(values.map((value, index) => coordinate(value, `${path}[${index}]`)))].sort(),
	);
}

function summedProviderUsage(
	outcome: ClosedTaskProfileHostRunOutcomeV3,
	field: "inputTokens" | "outputTokens" | "totalTokens",
): number | null {
	let total = 0;
	let observedProviderRequest = false;
	for (const turn of outcome.turnEvidence) {
		if (turn.requests === 0) continue;
		observedProviderRequest = true;
		const value = turn[field];
		if (value === null) return null;
		total += value;
		if (!Number.isSafeInteger(total)) throw new TypeError(`smoke ${field} total overflow`);
	}
	return observedProviderRequest ? total : null;
}

export interface EmpiricalTrialBlockObservationCreationInputV3 {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly route: QualifiedOpenRouterRouteV1;
	readonly cold: {
		readonly runRef: string;
		readonly hostOutcome: ClosedTaskProfileHostRunOutcomeV3;
		readonly costLedger: EmpiricalSmokeCostLedgerV1;
	};
	readonly reflection?: {
		readonly evidenceDigest: string;
		readonly candidateRecordDigests: readonly string[];
		readonly issueCodes: readonly string[];
	};
	readonly warmBranches?: readonly {
		readonly branchKind: EmpiricalWarmBranchKind;
		readonly lifecycle: EmpiricalWarmBranchLifecycleV2 | null;
		readonly run: {
			readonly runRef: string;
			readonly hostOutcome: ClosedTaskProfileHostRunOutcomeV3;
			readonly costLedger: EmpiricalSmokeCostLedgerV1;
		} | null;
		readonly issueCodes: readonly string[];
	}[];
	readonly executionClass: "simulated-contract" | "live-provider";
	readonly trialBlockRef: string;
	readonly trialBlockDigest: string;
}

type EmpiricalTrialBlockObservationCommonV3 = Omit<
	EmpiricalTrialBlockObservationV3,
	"schemaVersion" | "claimBoundary" | "profile"
>;

function createEmpiricalTrialBlockObservationCommon(
	input: EmpiricalTrialBlockObservationCreationInputV3,
	taskRef: string,
): EmpiricalTrialBlockObservationCommonV3 {
	const manifest = input.frozen.manifest;
	const task = manifest.catalog.tasks.find((candidate) => candidate.taskRef === taskRef);
	if (
		task === undefined ||
		!manifest.trialPlan.activeTaskRefs.includes(taskRef) ||
		input.cold.hostOutcome.taskRef !== taskRef ||
		input.cold.hostOutcome.taskDigest !== empiricalStrictJsonDigest(task)
	) {
		throw new TypeError("B112 observation is not for its exact frozen active task");
	}
	const route = input.route.qualification;
	if ((input.executionClass === "live-provider") !== (route.dispatchMode === "live-approved")) {
		throw new TypeError("smoke execution class does not match route dispatch approval");
	}
	const cold = createRunObservation({
		runRef: input.cold.runRef,
		trialStage: "cold",
		branchKind: null,
		hostOutcome: input.cold.hostOutcome,
		costLedger: input.cold.costLedger,
		executionClass: input.executionClass,
	});
	const rerunEligible = cold.classification === "incomplete" && cold.verifierStatus === "failed";
	const expectedBranches = manifest.trialPlan.branchOrder;
	const suppliedBranches = input.warmBranches ?? [];
	if (
		suppliedBranches.length > expectedBranches.length ||
		suppliedBranches.some((branch, index) => branch.branchKind !== expectedBranches[index])
	) {
		throw new TypeError("B112 smoke warm branches do not match the frozen order");
	}
	const warmBranches: EmpiricalWarmBranchObservationV3[] = expectedBranches.map(
		(branchKind, index) => {
			const supplied = suppliedBranches[index];
			if (supplied === undefined) {
				return strictSnapshot({
					branchKind,
					attempted: false,
					lifecycle: null,
					run: null,
					issueCodes: rerunEligible ? ["warm-branch-not-attempted"] : [],
				});
			}
			if (supplied.lifecycle === null || supplied.run === null) {
				return strictSnapshot({
					branchKind,
					attempted: false,
					lifecycle: supplied.lifecycle,
					run: null,
					issueCodes: sortedUniqueCoordinates(
						supplied.issueCodes,
						`smoke.warmBranches[${index}].issueCodes`,
					),
				});
			}
			const run = createRunObservation({
				runRef: supplied.run.runRef,
				trialStage: "warm",
				branchKind,
				hostOutcome: supplied.run.hostOutcome,
				costLedger: supplied.run.costLedger,
				executionClass: input.executionClass,
			});
			const actionTraceBoundToMemory = actionTraceBoundToDeliveredMemory(
				run,
				supplied.lifecycle.selectedRecordDigest,
			);
			const lifecycle = strictSnapshot({
				...supplied.lifecycle,
				stagePredicates: {
					...supplied.lifecycle.stagePredicates,
					cold_run_failed: rerunEligible,
					warm_run_passed: run.verifierStatus === "passed",
					warm_decision_trace_includes_memory: false,
					warm_action_trace_bound_to_memory_context: actionTraceBoundToMemory,
					prior_failure_route_avoided:
						actionTraceBoundToMemory && priorFailureRouteAvoided(cold, run),
				},
			});
			const lifecycleWithOutcome = strictSnapshot({
				...lifecycle,
				caseConforms: lifecycleConforms(lifecycle, branchKind),
			});
			return strictSnapshot({
				branchKind,
				attempted: true,
				lifecycle: validateWarmBranchLifecycle(lifecycleWithOutcome, branchKind),
				run,
				issueCodes: sortedUniqueCoordinates(
					[...supplied.issueCodes, ...run.issueCodes, ...lifecycleWithOutcome.issueCodes],
					`smoke.warmBranches[${index}].issueCodes`,
				),
			});
		},
	);
	const attemptedWarm = warmBranches.filter((branch) => branch.attempted);
	const evaluableWarm = attemptedWarm.filter(
		(branch) => branch.run?.classification !== "non-evaluable",
	);
	const allRequiredWarmComplete =
		rerunEligible &&
		attemptedWarm.length === expectedBranches.length &&
		evaluableWarm.length === expectedBranches.length;
	const classification: EmpiricalTrialBlockObservationV3["result"]["classification"] =
		cold.classification === "non-evaluable"
			? "non-evaluable"
			: rerunEligible
				? allRequiredWarmComplete
					? "complete"
					: "incomplete"
				: "complete";
	const verifierStatus = cold.verifierStatus;
	const familyPassed =
		allRequiredWarmComplete && warmBranches.every((branch) => branch.lifecycle !== null)
			? warmBranches.every((branch) => branch.lifecycle?.caseConforms)
			: null;
	const issueCodes = sortedUniqueCoordinates(
		[
			...cold.issueCodes,
			...warmBranches.flatMap((branch) => branch.issueCodes),
			...(rerunEligible && attemptedWarm.length < expectedBranches.length
				? ["smoke-cold-failed-warm-arms-incomplete"]
				: []),
		],
		"smoke.issueCodes",
	);
	const runs = [
		cold,
		...attemptedWarm.flatMap((branch) => (branch.run === null ? [] : [branch.run])),
	];
	const summed = (
		field:
			| "requests"
			| "steps"
			| "attempts"
			| "hostInputBytes"
			| "hostOutputBytes"
			| "latencyMs"
			| "costMicrousd"
			| "reservedInputTokens"
			| "reservedOutputTokens",
	) =>
		runs.reduce((total, run) => checkedSum(total, run[field], `smoke ${field} total overflow`), 0);
	const summedNullable = (field: "inputTokens" | "outputTokens" | "totalTokens") =>
		runs.some((run) => run[field] === null)
			? null
			: runs.reduce(
					(total, run) => checkedSum(total, run[field] as number, `smoke ${field} total overflow`),
					0,
				);
	const hasLiveProviderAttempt = summed("requests") > 0;
	const executionClass: EmpiricalSmokeEvidenceClassV1 =
		input.executionClass === "live-provider" && !hasLiveProviderAttempt
			? "live-approved-no-provider-evidence"
			: input.executionClass;
	const costBases = new Set(runs.map((run) => run.costBasis));
	const costBasis =
		input.executionClass === "simulated-contract"
			? ("simulated-contract" as const)
			: costBases.size === 1 && costBases.has("provider-usage")
				? ("provider-usage" as const)
				: ("conservative-reservation" as const);
	const routeEvidenceDigests = sortedUniqueCoordinates(
		runs.flatMap((run) => run.routeEvidenceDigests),
		"smoke.routeEvidenceDigests",
	);
	const verifierEvidenceDigests = sortedUniqueCoordinates(
		runs.flatMap((run) => run.verifierEvidenceDigests),
		"smoke.verifierEvidenceDigests",
	);
	const protectionReceiptDigests = sortedUniqueCoordinates(
		runs.flatMap((run) => run.protectionReceiptDigests),
		"smoke.protectionReceiptDigests",
	);
	const observation = strictSnapshot({
		executionClass,
		empiricalLiveEvidence: executionClass === "live-provider",
		campaignRef: manifest.campaignRef,
		manifestDigest: input.frozen.manifestDigest,
		taskRef,
		taskDigest: input.cold.hostOutcome.taskDigest,
		trialBlockRef: coordinate(input.trialBlockRef, "smoke.trialBlockRef"),
		trialBlockDigest: digest(input.trialBlockDigest, "smoke.trialBlockDigest"),
		route: {
			qualificationRef: route.qualificationRef,
			qualificationRevision: route.qualificationRevision,
			qualificationDigest: input.route.qualificationDigest,
			configurationRef: route.configurationRef,
			configurationDigest: route.configurationDigest,
			model: route.requestModel,
			modelIdentityKind: route.modelIdentityKind,
			providerFamily: "openrouter" as const,
			downstreamProviderSlug: route.downstreamProviderSlug,
			downstreamProviderName: route.downstreamProviderName,
			endpoint: route.endpoint,
			endpointRevision: route.endpointRevision,
			adapterRevision: route.adapterRevision,
			bindingRevision: route.bindingRevision,
			capabilitiesDigest: route.capabilitiesDigest,
			settingsDigest: route.settingsDigest,
			usageSource: route.usageSource,
			usageRevision: route.usageRevision,
			routeEvidenceSchemaRevision: route.routeEvidenceSchemaRevision,
			pricingSourceUrl: route.pricing.sourceUrl,
			pricingRevision: route.pricing.pricingRevision,
			inputMicrousdPerMillionTokens: route.pricing.inputMicrousdPerMillionTokens,
			outputMicrousdPerMillionTokens: route.pricing.outputMicrousdPerMillionTokens,
			budgetApprovalRef: route.budget.approvalRef,
			budgetApprovalRevision: route.budget.approvalRevision,
			maxSmokeSpendMicrousd: route.budget.maxSmokeSpendMicrousd,
			maxRequests: route.budget.maxRequests,
			maxStepsPerRun: route.budget.maxStepsPerRun,
			maxCanonicalRequestBytes: route.budget.maxCanonicalRequestBytes,
			maxInputTokens: route.budget.maxInputTokens,
			maxOutputTokens: route.budget.maxOutputTokens,
			maxLatencyMs: route.budget.maxLatencyMs,
			reservationRevision: route.budget.reservationRevision,
		},
		result: {
			classification,
			verifierStatus,
			coldRunsAttempted: 1 as const,
			warmRunsAttempted: attemptedWarm.length,
			requests: summed("requests"),
			steps: summed("steps"),
			attempts: summed("attempts"),
			inputTokens: summedNullable("inputTokens"),
			outputTokens: summedNullable("outputTokens"),
			totalTokens: summedNullable("totalTokens"),
			hostInputBytes: summed("hostInputBytes"),
			hostOutputBytes: summed("hostOutputBytes"),
			latencyMs: summed("latencyMs"),
			costMicrousd: summed("costMicrousd"),
			costBasis,
			reservedInputTokens: summed("reservedInputTokens"),
			reservedOutputTokens: summed("reservedOutputTokens"),
		},
		hostOutcomeDigest: cold.hostOutcomeDigest,
		routeEvidenceDigests,
		verifierEvidenceDigests,
		protectionReceiptDigests,
		cold,
		rerunEligible,
		reflection:
			input.reflection === undefined
				? {
						evidenceDigest: null,
						candidateRecordDigests: [],
						issueCodes: [],
					}
				: {
						evidenceDigest: digest(
							input.reflection.evidenceDigest,
							"smoke.reflection.evidenceDigest",
						),
						candidateRecordDigests: validateDigestList(
							input.reflection.candidateRecordDigests,
							"smoke.reflection.candidateRecordDigests",
						),
						issueCodes: sortedUniqueCoordinates(
							input.reflection.issueCodes,
							"smoke.reflection.issueCodes",
						),
					},
		warmBranches,
		familyPassed,
		issueCodes,
	});
	return observation;
}

export function createEmpiricalTrialBlockObservation(
	input: EmpiricalTrialBlockObservationCreationInputV3,
): EmpiricalTrialBlockObservationV3 {
	if (input.frozen.manifest.trialPlan.profile !== "smoke") {
		throw new TypeError("B112 smoke observation requires the smoke trial plan");
	}
	const taskRef = input.frozen.manifest.trialPlan.activeTaskRefs[0];
	if (taskRef === undefined) {
		throw new TypeError("B112 smoke observation requires the preregistered first task");
	}
	return validateEmpiricalTrialBlockObservation({
		schemaVersion: EMPIRICAL_TRIAL_BLOCK_OBSERVATION_SCHEMA,
		claimBoundary: B112_SMOKE_NO_EFFICACY_CLAIM,
		profile: "smoke",
		...createEmpiricalTrialBlockObservationCommon(input, taskRef),
	});
}

export function createEmpiricalCalibrationTrialBlockObservation(
	input: EmpiricalTrialBlockObservationCreationInputV3 & {
		readonly taskRef: string;
		readonly blockIndex: 1 | 2 | 3;
	},
): EmpiricalCalibrationTrialBlockObservationV4 {
	if (input.frozen.manifest.trialPlan.profile !== "calibration") {
		throw new TypeError("B112 calibration observation requires the calibration trial plan");
	}
	return validateEmpiricalCalibrationTrialBlockObservation({
		schemaVersion: EMPIRICAL_CALIBRATION_TRIAL_BLOCK_OBSERVATION_SCHEMA,
		claimBoundary: B112_CALIBRATION_EXPLORATORY_NO_EFFICACY_CLAIM,
		profile: "calibration",
		blockIndex: safeInteger(input.blockIndex, "calibration.blockIndex", {
			min: 1,
			max: 3,
		}) as 1 | 2 | 3,
		...createEmpiricalTrialBlockObservationCommon(input, input.taskRef),
	});
}

function checkedSum(total: number, value: number, message: string): number {
	const next = total + value;
	if (!Number.isSafeInteger(next)) throw new TypeError(message);
	return next;
}

function createRunObservation(input: {
	readonly runRef: string;
	readonly trialStage: "cold" | "warm";
	readonly branchKind: EmpiricalWarmBranchKind | null;
	readonly hostOutcome: ClosedTaskProfileHostRunOutcomeV3;
	readonly costLedger: EmpiricalSmokeCostLedgerV1;
	readonly executionClass: "simulated-contract" | "live-provider";
}): EmpiricalSmokeRunObservationV3 {
	const costLedger = validateCostLedger(input.costLedger, input.executionClass);
	const verifierStatus =
		input.hostOutcome.verifierVerdict === null
			? ("not-run" as const)
			: input.hostOutcome.verifierVerdict;
	const classification =
		input.hostOutcome.status === "non-evaluable"
			? ("non-evaluable" as const)
			: verifierStatus === "passed"
				? ("complete" as const)
				: ("incomplete" as const);
	const latencyMs = input.hostOutcome.turnEvidence.reduce(
		(total, turn) => checkedSum(total, turn.latencyMs, "smoke run latency total overflow"),
		input.hostOutcome.retryWaitMs,
	);
	const turnRequestDigests = Array.from(
		{ length: input.hostOutcome.logicalStepCount },
		(_, stepIndex) => {
			const attempts = input.hostOutcome.turnEvidence.filter(
				(turn) => turn.stepIndex === stepIndex,
			);
			const requestDigest = attempts[0]?.requestDigest;
			if (
				requestDigest === undefined ||
				attempts.some((attempt) => attempt.requestDigest !== requestDigest)
			) {
				throw new TypeError("smoke retry attempts must bind one exact logical-turn request");
			}
			return requestDigest;
		},
	);
	return strictSnapshot({
		runRef: coordinate(input.runRef, "smoke.runRef"),
		trialStage: input.trialStage,
		branchKind: input.branchKind,
		classification,
		verifierStatus,
		requests: input.hostOutcome.remoteRequests,
		steps: input.hostOutcome.logicalStepCount,
		attempts: input.hostOutcome.attemptCount,
		retryWaitMs: input.hostOutcome.retryWaitMs,
		inputTokens: summedProviderUsage(input.hostOutcome, "inputTokens"),
		outputTokens: summedProviderUsage(input.hostOutcome, "outputTokens"),
		totalTokens: summedProviderUsage(input.hostOutcome, "totalTokens"),
		hostInputBytes: input.hostOutcome.hostInputBytes,
		hostOutputBytes: input.hostOutcome.hostOutputBytes,
		latencyMs,
		costMicrousd: costLedger.costMicrousd,
		costBasis: costLedger.costBasis,
		reservedInputTokens: costLedger.reservedInputTokens,
		reservedOutputTokens: costLedger.reservedOutputTokens,
		hostOutcomeDigest: empiricalStrictJsonDigest(input.hostOutcome),
		initialRequestDigest: input.hostOutcome.initialRequestDigest,
		memoryContextRecordDigest: input.hostOutcome.initialMemoryContextRecordDigest,
		turnRequestDigests,
		attemptTrace: input.hostOutcome.turnEvidence.map((turn) => ({
			stepIndex: turn.stepIndex,
			attemptOrdinal: turn.attemptOrdinal,
			requestDigest: turn.requestDigest,
			status: turn.status,
			requests: turn.requests,
			latencyMs: turn.latencyMs,
			issueCodes: sortedUniqueCoordinates(turn.issueCodes, "smoke.run.attemptTrace.issueCodes"),
			protectionReceiptDigest: turn.protectionReceipt.receiptDigest,
		})),
		retryWaitTrace: input.hostOutcome.retryWaitEvidence,
		toolResultBindings: input.hostOutcome.toolEvidence.map((tool) => ({
			toolCallRefDigest: tool.toolCallRefDigest,
			toolRef: tool.toolRef,
			resultDigest: tool.resultDigest,
		})),
		workspaceBaselineDigest: input.hostOutcome.workspaceBaselineDigest,
		workspaceStateDigest: input.hostOutcome.workspaceStateDigest,
		workspaceChangeDigest: input.hostOutcome.workspaceChangeDigest,
		workspaceChanged: input.hostOutcome.workspaceChanged,
		actionTraceDigest: empiricalStrictJsonDigest(input.hostOutcome.actionTrace),
		actionTrace: input.hostOutcome.actionTrace,
		routeEvidenceDigests: sortedUniqueCoordinates(
			input.hostOutcome.turnEvidence.flatMap((turn) =>
				turn.evidenceRefs.map((evidence) => evidence.digest),
			),
			"smoke.run.routeEvidenceDigests",
		),
		verifierEvidenceDigests: sortedUniqueCoordinates(
			input.hostOutcome.verifierEvidenceRefs.map((evidence) => evidence.digest),
			"smoke.run.verifierEvidenceDigests",
		),
		protectionReceiptDigests: sortedUniqueCoordinates(
			input.hostOutcome.turnEvidence.map((turn) => turn.protectionReceipt.receiptDigest),
			"smoke.run.protectionReceiptDigests",
		),
		issueCodes: sortedUniqueCoordinates(input.hostOutcome.issueCodes, "smoke.run.issueCodes"),
	});
}

function actionTraceBoundToDeliveredMemory(
	run: EmpiricalSmokeRunObservationV3,
	selectedRecordDigest: string,
): boolean {
	// This predicate proves only that a completed action belongs to the exact
	// request lineage carrying the selected memory record. It does not infer
	// hidden model cognition or causal use from context delivery.
	return (
		run.initialRequestDigest !== null &&
		run.memoryContextRecordDigest === selectedRecordDigest &&
		run.actionTrace.length > 0 &&
		run.actionTrace.every(
			(entry) =>
				entry.initialRequestDigest === run.initialRequestDigest &&
				entry.memoryContextRecordDigest === selectedRecordDigest &&
				run.turnRequestDigests[entry.stepIndex] === entry.requestDigest &&
				run.toolResultBindings[entry.actionIndex]?.toolCallRefDigest === entry.toolCallRefDigest &&
				run.toolResultBindings[entry.actionIndex]?.toolRef === entry.toolRef &&
				run.toolResultBindings[entry.actionIndex]?.resultDigest === entry.resultDigest,
		)
	);
}

function actionRouteDigest(run: EmpiricalSmokeRunObservationV3): string {
	return empiricalStrictJsonDigest(
		run.actionTrace.map((entry) => ({
			toolRef: entry.toolRef,
			intentDigest: entry.intentDigest,
		})),
	);
}

function priorFailureRouteAvoided(
	cold: EmpiricalSmokeRunObservationV3,
	warm: EmpiricalSmokeRunObservationV3,
): boolean {
	return (
		warm.actionTrace.length > 0 &&
		cold.workspaceBaselineDigest !== null &&
		cold.workspaceBaselineDigest === warm.workspaceBaselineDigest &&
		actionRouteDigest(warm) !== actionRouteDigest(cold) &&
		cold.workspaceStateDigest !== null &&
		warm.workspaceChangeDigest !== null &&
		cold.workspaceChangeDigest !== null &&
		cold.workspaceChangeDigest !== warm.workspaceChangeDigest &&
		warm.workspaceChanged === true
	);
}

function validateCostLedger(
	value: EmpiricalSmokeCostLedgerV1,
	executionClass: EmpiricalTrialBlockObservationV3["executionClass"],
): EmpiricalSmokeCostLedgerV1 {
	const ledger = record(value, "smoke.costLedger");
	exactKeys(
		ledger,
		["costBasis", "costMicrousd", "reservedInputTokens", "reservedOutputTokens"],
		"smoke.costLedger",
	);
	const costBasis = oneOf(
		ledger.costBasis,
		["simulated-contract", "provider-usage", "conservative-reservation"],
		"smoke.costLedger.costBasis",
	);
	if (
		(executionClass === "simulated-contract") !== (costBasis === "simulated-contract") ||
		(costBasis === "simulated-contract" && ledger.costMicrousd !== 0)
	) {
		throw new TypeError("simulated smoke cost must remain contract-only and zero");
	}
	return strictSnapshot({
		costBasis,
		reservedInputTokens: safeInteger(
			ledger.reservedInputTokens,
			"smoke.costLedger.reservedInputTokens",
			{ min: 0 },
		),
		reservedOutputTokens: safeInteger(
			ledger.reservedOutputTokens,
			"smoke.costLedger.reservedOutputTokens",
			{ min: 0 },
		),
		costMicrousd: safeInteger(ledger.costMicrousd, "smoke.costLedger.costMicrousd", {
			min: 0,
		}),
	});
}

const EMPIRICAL_WARM_BRANCHES = Object.freeze([
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

function nullableBoolean(value: unknown, path: string): boolean | null {
	if (value === null || typeof value === "boolean") return value;
	throw new TypeError(`${path} must be boolean or null`);
}

function nullableTokens(value: unknown, path: string): number | null {
	return value === null ? null : safeInteger(value, path, { min: 0 });
}

function validateActionTrace(
	value: unknown,
	path: string,
): ClosedTaskProfileHostRunOutcomeV3["actionTrace"] {
	const values = array(value, path);
	if (values.length > CLOSED_TASK_PROFILE_HOST_MAX_ACTION_TRACE_ENTRIES) {
		throw new TypeError(`${path} exceeds its bounded item count`);
	}
	return Object.freeze(
		values.map((value, index) => {
			const entryPath = `${path}[${index}]`;
			const entry = record(value, entryPath);
			exactKeys(
				entry,
				[
					"actionIndex",
					"initialRequestDigest",
					"intentDigest",
					"requestDigest",
					"resultDigest",
					"stepIndex",
					"toolCallRefDigest",
					"toolRef",
					"memoryContextRecordDigest",
				],
				entryPath,
			);
			const actionIndex = safeInteger(entry.actionIndex, `${entryPath}.actionIndex`, {
				min: 0,
				max: CLOSED_TASK_PROFILE_HOST_MAX_ACTION_TRACE_ENTRIES - 1,
			});
			if (actionIndex !== index) {
				throw new TypeError(`${entryPath}.actionIndex must equal its canonical ordinal`);
			}
			return strictSnapshot({
				stepIndex: safeInteger(entry.stepIndex, `${entryPath}.stepIndex`, {
					min: 0,
					max: CLOSED_TASK_PROFILE_HOST_MAX_ACTION_TRACE_ENTRIES - 1,
				}),
				actionIndex,
				initialRequestDigest: digest(
					entry.initialRequestDigest,
					`${entryPath}.initialRequestDigest`,
				),
				requestDigest: digest(entry.requestDigest, `${entryPath}.requestDigest`),
				toolCallRefDigest: digest(entry.toolCallRefDigest, `${entryPath}.toolCallRefDigest`),
				toolRef: coordinate(entry.toolRef, `${entryPath}.toolRef`),
				intentDigest: digest(entry.intentDigest, `${entryPath}.intentDigest`),
				resultDigest: digest(entry.resultDigest, `${entryPath}.resultDigest`),
				memoryContextRecordDigest:
					entry.memoryContextRecordDigest === null
						? null
						: digest(entry.memoryContextRecordDigest, `${entryPath}.memoryContextRecordDigest`),
			});
		}),
	);
}

function validateSmokeRunObservation(value: unknown, path: string): EmpiricalSmokeRunObservationV3 {
	const run = record(value, path);
	exactKeys(
		run,
		[
			"actionTrace",
			"actionTraceDigest",
			"attemptTrace",
			"attempts",
			"retryWaitMs",
			"retryWaitTrace",
			"branchKind",
			"classification",
			"costBasis",
			"costMicrousd",
			"hostInputBytes",
			"hostOutcomeDigest",
			"hostOutputBytes",
			"initialRequestDigest",
			"inputTokens",
			"issueCodes",
			"latencyMs",
			"memoryContextRecordDigest",
			"outputTokens",
			"protectionReceiptDigests",
			"requests",
			"reservedInputTokens",
			"reservedOutputTokens",
			"routeEvidenceDigests",
			"runRef",
			"steps",
			"totalTokens",
			"toolResultBindings",
			"trialStage",
			"turnRequestDigests",
			"verifierEvidenceDigests",
			"verifierStatus",
			"workspaceBaselineDigest",
			"workspaceChangeDigest",
			"workspaceChanged",
			"workspaceStateDigest",
		],
		path,
	);
	const trialStage = oneOf(run.trialStage, ["cold", "warm"], `${path}.trialStage`);
	const branchKind =
		run.branchKind === null
			? null
			: oneOf(run.branchKind, EMPIRICAL_WARM_BRANCHES, `${path}.branchKind`);
	if ((trialStage === "cold") !== (branchKind === null)) {
		throw new TypeError(`${path} stage does not match its branch kind`);
	}
	const classification = oneOf(
		run.classification,
		["complete", "incomplete", "non-evaluable"],
		`${path}.classification`,
	);
	const verifierStatus = oneOf(
		run.verifierStatus,
		["passed", "failed", "unverifiable", "not-run"],
		`${path}.verifierStatus`,
	);
	if (
		(classification === "complete" && verifierStatus !== "passed") ||
		(classification === "incomplete" && verifierStatus !== "failed") ||
		(classification === "non-evaluable" &&
			verifierStatus !== "not-run" &&
			verifierStatus !== "unverifiable")
	) {
		throw new TypeError(`${path} classification does not match verifier status`);
	}
	const protectionReceiptDigests = validateDigestList(
		run.protectionReceiptDigests,
		`${path}.protectionReceiptDigests`,
	);
	const runIssueCodes = validateCoordinateList(run.issueCodes, `${path}.issueCodes`);
	const steps = safeInteger(run.steps, `${path}.steps`, { min: 0, max: 64 });
	const attempts = safeInteger(run.attempts, `${path}.attempts`, { min: 0, max: 64 });
	const attemptValues = array(run.attemptTrace, `${path}.attemptTrace`);
	if (attemptValues.length > 64) {
		throw new TypeError(`${path}.attemptTrace exceeds its bounded item count`);
	}
	const attemptTrace = Object.freeze(
		attemptValues.map((value, index) => {
			const attemptPath = `${path}.attemptTrace[${index}]`;
			const attempt = record(value, attemptPath);
			exactKeys(
				attempt,
				[
					"attemptOrdinal",
					"issueCodes",
					"latencyMs",
					"protectionReceiptDigest",
					"requestDigest",
					"requests",
					"status",
					"stepIndex",
				],
				attemptPath,
			);
			return strictSnapshot({
				stepIndex: safeInteger(attempt.stepIndex, `${attemptPath}.stepIndex`, {
					min: 0,
					max: 63,
				}),
				attemptOrdinal: safeInteger(attempt.attemptOrdinal, `${attemptPath}.attemptOrdinal`, {
					min: 1,
					max: 3,
				}),
				requestDigest: digest(attempt.requestDigest, `${attemptPath}.requestDigest`),
				status: oneOf(attempt.status, ["completed", "non-evaluable"], `${attemptPath}.status`),
				requests: safeInteger(attempt.requests, `${attemptPath}.requests`, {
					min: 0,
					max: 1,
				}) as 0 | 1,
				latencyMs: safeInteger(attempt.latencyMs, `${attemptPath}.latencyMs`, {
					min: 0,
					max: 86_400_000,
				}),
				issueCodes: validateCoordinateList(attempt.issueCodes, `${attemptPath}.issueCodes`),
				protectionReceiptDigest: digest(
					attempt.protectionReceiptDigest,
					`${attemptPath}.protectionReceiptDigest`,
				),
			});
		}),
	);
	if (attemptTrace.length !== attempts) {
		throw new TypeError(`${path}.attemptTrace must bind every exact attempt`);
	}
	const retryWaitValues = array(run.retryWaitTrace, `${path}.retryWaitTrace`);
	if (retryWaitValues.length > attempts) {
		throw new TypeError(`${path}.retryWaitTrace exceeds its bounded attempt count`);
	}
	const retryWaitTrace = Object.freeze(
		retryWaitValues.map((value, index) => {
			const waitPath = `${path}.retryWaitTrace[${index}]`;
			const wait = record(value, waitPath);
			exactKeys(
				wait,
				["afterAttemptOrdinal", "elapsedMs", "scheduledDelayMs", "stepIndex"],
				waitPath,
			);
			return strictSnapshot({
				stepIndex: safeInteger(wait.stepIndex, `${waitPath}.stepIndex`, {
					min: 0,
					max: 63,
				}),
				afterAttemptOrdinal: safeInteger(
					wait.afterAttemptOrdinal,
					`${waitPath}.afterAttemptOrdinal`,
					{ min: 1, max: 2 },
				),
				scheduledDelayMs: safeInteger(wait.scheduledDelayMs, `${waitPath}.scheduledDelayMs`, {
					min: 1,
					max: 600_000,
				}),
				elapsedMs: safeInteger(wait.elapsedMs, `${waitPath}.elapsedMs`, {
					min: 1,
					max: 86_400_000,
				}),
			});
		}),
	);
	const actionTrace = validateActionTrace(run.actionTrace, `${path}.actionTrace`);
	if (actionTrace.some((entry) => entry.stepIndex >= steps)) {
		throw new TypeError(`${path}.actionTrace contains an action outside the bounded steps`);
	}
	for (let index = 1; index < actionTrace.length; index += 1) {
		if (
			(actionTrace[index] as (typeof actionTrace)[number]).stepIndex <
			(actionTrace[index - 1] as (typeof actionTrace)[number]).stepIndex
		) {
			throw new TypeError(`${path}.actionTrace step indexes must be nondecreasing`);
		}
	}
	const actionTraceDigest = digest(run.actionTraceDigest, `${path}.actionTraceDigest`);
	if (actionTraceDigest !== empiricalStrictJsonDigest(actionTrace)) {
		throw new TypeError(`${path}.actionTraceDigest does not bind the canonical action trace`);
	}
	const initialRequestDigest =
		run.initialRequestDigest === null
			? null
			: digest(run.initialRequestDigest, `${path}.initialRequestDigest`);
	const memoryContextRecordDigest =
		run.memoryContextRecordDigest === null
			? null
			: digest(run.memoryContextRecordDigest, `${path}.memoryContextRecordDigest`);
	const turnRequestDigests = validateOrderedDigestList(
		run.turnRequestDigests,
		`${path}.turnRequestDigests`,
	);
	if (turnRequestDigests.length !== steps) {
		throw new TypeError(`${path}.turnRequestDigests must bind every exact turn`);
	}
	if (
		steps > 0 &&
		(initialRequestDigest === null || turnRequestDigests[0] !== initialRequestDigest)
	) {
		throw new TypeError(`${path}.turnRequestDigests[0] must equal the initial request digest`);
	}
	for (let index = 0; index < attemptTrace.length; index += 1) {
		const attempt = attemptTrace[index] as (typeof attemptTrace)[number];
		const previous = attemptTrace[index - 1];
		if (
			attempt.stepIndex >= steps ||
			turnRequestDigests[attempt.stepIndex] !== attempt.requestDigest
		) {
			throw new TypeError(`${path}.attemptTrace is not bound to its exact logical turn`);
		}
		if (previous === undefined) {
			if (attempt.stepIndex !== 0 || attempt.attemptOrdinal !== 1) {
				throw new TypeError(`${path}.attemptTrace must begin at step zero attempt one`);
			}
			continue;
		}
		if (attempt.stepIndex === previous.stepIndex) {
			if (
				previous.status !== "non-evaluable" ||
				attempt.attemptOrdinal !== previous.attemptOrdinal + 1
			) {
				throw new TypeError(`${path}.attemptTrace retry order is not canonical`);
			}
			continue;
		}
		if (
			previous.status !== "completed" ||
			attempt.stepIndex !== previous.stepIndex + 1 ||
			attempt.attemptOrdinal !== 1
		) {
			throw new TypeError(`${path}.attemptTrace logical-step order is not canonical`);
		}
	}
	if (
		(steps === 0 && attemptTrace.length !== 0) ||
		(steps > 0 &&
			(attemptTrace.length === 0 ||
				(attemptTrace.at(-1) as (typeof attemptTrace)[number]).stepIndex !== steps - 1))
	) {
		throw new TypeError(`${path}.attemptTrace must include every logical turn`);
	}
	const expectedRetryWaitForAttempt = (attempt: (typeof attemptTrace)[number], index: number) => {
		const requestSocketIssueCodes = [
			"openrouter-transport-cause:und-err-socket",
			"openrouter-transport-phase:request",
			"openrouter-unavailable-transport",
		] as const;
		const retryableRequestSocket =
			attempt.status === "non-evaluable" &&
			attempt.attemptOrdinal === 1 &&
			attempt.issueCodes.length === requestSocketIssueCodes.length &&
			requestSocketIssueCodes.every((issueCode) => attempt.issueCodes.includes(issueCode));
		const retryable429 =
			attempt.status === "non-evaluable" &&
			attempt.issueCodes.includes("openrouter-http-status:429") &&
			attempt.issueCodes.includes("openrouter-error-type:rate_limit_exceeded");
		const retryable503 =
			attempt.status === "non-evaluable" &&
			attempt.issueCodes.includes("openrouter-http-status:503") &&
			attempt.issueCodes.includes("openrouter-error-type:provider_overloaded");
		if (!retryableRequestSocket && !retryable429 && !retryable503) {
			throw new TypeError(`${path}.attemptTrace retries a non-allowlisted outcome`);
		}
		const retryAfterPrefix = "openrouter-retry-after-ms:";
		const encodedRetryAfter = attempt.issueCodes.find((issueCode) =>
			issueCode.startsWith(retryAfterPrefix),
		);
		const retryAfterMs =
			encodedRetryAfter === undefined
				? 0
				: safeInteger(
						Number(encodedRetryAfter.slice(retryAfterPrefix.length)),
						`${path}.attemptTrace[${index}].retryAfterMs`,
						{ min: 1, max: 600_000 },
					);
		const fallbackMs = attempt.attemptOrdinal === 1 ? 5_000 : 10_000;
		return {
			stepIndex: attempt.stepIndex,
			afterAttemptOrdinal: attempt.attemptOrdinal,
			scheduledDelayMs: Math.max(fallbackMs, retryAfterMs),
		};
	};
	const expectedRetryWaits = attemptTrace.flatMap((attempt, index) => {
		const next = attemptTrace[index + 1];
		if (next === undefined || next.stepIndex !== attempt.stepIndex) return [];
		return [expectedRetryWaitForAttempt(attempt, index)];
	});
	if (
		retryWaitTrace.length === expectedRetryWaits.length + 1 &&
		runIssueCodes.includes("model-turn-retry-elapsed-budget-exhausted")
	) {
		const terminalAttempt = attemptTrace.at(-1);
		if (terminalAttempt === undefined || terminalAttempt.status !== "non-evaluable") {
			throw new TypeError(`${path}.retryWaitTrace has no terminal retryable attempt`);
		}
		expectedRetryWaits.push(expectedRetryWaitForAttempt(terminalAttempt, attemptTrace.length - 1));
	}
	if (
		retryWaitTrace.length !== expectedRetryWaits.length ||
		retryWaitTrace.some((wait, index) => {
			const expected = expectedRetryWaits[index];
			return (
				expected === undefined ||
				wait.stepIndex !== expected.stepIndex ||
				wait.afterAttemptOrdinal !== expected.afterAttemptOrdinal ||
				wait.scheduledDelayMs !== expected.scheduledDelayMs ||
				wait.elapsedMs < wait.scheduledDelayMs
			);
		})
	) {
		throw new TypeError(`${path}.retryWaitTrace is not the exact canonical retry sequence`);
	}
	const toolResultBindings = Object.freeze(
		array(run.toolResultBindings, `${path}.toolResultBindings`).map((value, index) => {
			const bindingPath = `${path}.toolResultBindings[${index}]`;
			const binding = record(value, bindingPath);
			exactKeys(binding, ["resultDigest", "toolCallRefDigest", "toolRef"], bindingPath);
			return strictSnapshot({
				toolCallRefDigest: digest(binding.toolCallRefDigest, `${bindingPath}.toolCallRefDigest`),
				toolRef: coordinate(binding.toolRef, `${bindingPath}.toolRef`),
				resultDigest: digest(binding.resultDigest, `${bindingPath}.resultDigest`),
			});
		}),
	);
	if (toolResultBindings.length > CLOSED_TASK_PROFILE_HOST_MAX_ACTION_TRACE_ENTRIES) {
		throw new TypeError(`${path}.toolResultBindings exceeds its bounded item count`);
	}
	if (
		new Set(toolResultBindings.map((binding) => binding.toolCallRefDigest)).size !==
		toolResultBindings.length
	) {
		throw new TypeError(`${path}.toolResultBindings must have unique tool-call digests`);
	}
	if (
		actionTrace.some((entry) => entry.initialRequestDigest !== initialRequestDigest) ||
		actionTrace.some(
			(entry) =>
				turnRequestDigests[entry.stepIndex] !== entry.requestDigest ||
				entry.memoryContextRecordDigest !== memoryContextRecordDigest ||
				toolResultBindings[entry.actionIndex]?.toolCallRefDigest !== entry.toolCallRefDigest ||
				toolResultBindings[entry.actionIndex]?.toolRef !== entry.toolRef ||
				toolResultBindings[entry.actionIndex]?.resultDigest !== entry.resultDigest,
		) ||
		(actionTrace.length > 0 && initialRequestDigest === null) ||
		toolResultBindings.length !== actionTrace.length
	) {
		throw new TypeError(`${path}.actionTrace is not bound to its exact request and tool result`);
	}
	const workspaceBaselineDigest =
		run.workspaceBaselineDigest === null
			? null
			: digest(run.workspaceBaselineDigest, `${path}.workspaceBaselineDigest`);
	const workspaceStateDigest =
		run.workspaceStateDigest === null
			? null
			: digest(run.workspaceStateDigest, `${path}.workspaceStateDigest`);
	const workspaceChangeDigest =
		run.workspaceChangeDigest === null
			? null
			: digest(run.workspaceChangeDigest, `${path}.workspaceChangeDigest`);
	const workspaceChanged = nullableBoolean(run.workspaceChanged, `${path}.workspaceChanged`);
	if (
		(workspaceBaselineDigest === null ||
			workspaceStateDigest === null ||
			workspaceChangeDigest === null) !==
			(workspaceChanged === null) ||
		(workspaceChanged !== null &&
			(workspaceChanged !== (workspaceBaselineDigest !== workspaceStateDigest) ||
				workspaceChanged !== (workspaceChangeDigest !== empiricalStrictJsonDigest([]))))
	) {
		throw new TypeError(`${path} workspace state classification is inconsistent`);
	}
	const requests = safeInteger(run.requests, `${path}.requests`, { min: 0, max: 64 });
	const latencyMs = safeInteger(run.latencyMs, `${path}.latencyMs`, {
		min: 0,
		max: 86_400_000,
	});
	const retryWaitMs = safeInteger(run.retryWaitMs, `${path}.retryWaitMs`, {
		min: 0,
		max: 86_400_000,
	});
	const expectedProtectionReceiptDigests = [
		...new Set(attemptTrace.map((attempt) => attempt.protectionReceiptDigest)),
	].sort();
	if (
		attemptTrace.reduce((total, attempt) => total + attempt.requests, 0) !== requests ||
		attemptTrace.reduce((total, attempt) => total + attempt.latencyMs, retryWaitMs) !== latencyMs ||
		retryWaitTrace.reduce((total, wait) => total + wait.elapsedMs, 0) !== retryWaitMs ||
		expectedProtectionReceiptDigests.length !== protectionReceiptDigests.length ||
		expectedProtectionReceiptDigests.some(
			(receiptDigest, index) => protectionReceiptDigests[index] !== receiptDigest,
		)
	) {
		throw new TypeError(`${path}.attemptTrace totals or protection receipts do not match`);
	}
	return strictSnapshot({
		runRef: coordinate(run.runRef, `${path}.runRef`),
		trialStage,
		branchKind,
		classification,
		verifierStatus,
		requests,
		steps,
		attempts,
		retryWaitMs,
		inputTokens: nullableTokens(run.inputTokens, `${path}.inputTokens`),
		outputTokens: nullableTokens(run.outputTokens, `${path}.outputTokens`),
		totalTokens: nullableTokens(run.totalTokens, `${path}.totalTokens`),
		hostInputBytes: safeInteger(run.hostInputBytes, `${path}.hostInputBytes`, { min: 0 }),
		hostOutputBytes: safeInteger(run.hostOutputBytes, `${path}.hostOutputBytes`, { min: 0 }),
		latencyMs,
		costMicrousd: safeInteger(run.costMicrousd, `${path}.costMicrousd`, { min: 0 }),
		costBasis: oneOf(
			run.costBasis,
			["simulated-contract", "provider-usage", "conservative-reservation"],
			`${path}.costBasis`,
		),
		reservedInputTokens: safeInteger(run.reservedInputTokens, `${path}.reservedInputTokens`, {
			min: 0,
		}),
		reservedOutputTokens: safeInteger(run.reservedOutputTokens, `${path}.reservedOutputTokens`, {
			min: 0,
		}),
		hostOutcomeDigest: digest(run.hostOutcomeDigest, `${path}.hostOutcomeDigest`),
		initialRequestDigest,
		memoryContextRecordDigest,
		turnRequestDigests,
		attemptTrace,
		retryWaitTrace,
		toolResultBindings,
		workspaceBaselineDigest,
		workspaceStateDigest,
		workspaceChangeDigest,
		workspaceChanged,
		actionTraceDigest,
		actionTrace,
		routeEvidenceDigests: validateDigestList(
			run.routeEvidenceDigests,
			`${path}.routeEvidenceDigests`,
		),
		verifierEvidenceDigests: validateDigestList(
			run.verifierEvidenceDigests,
			`${path}.verifierEvidenceDigests`,
		),
		protectionReceiptDigests,
		issueCodes: runIssueCodes,
	});
}

function validateStagePredicates(
	value: unknown,
	path: string,
): EmpiricalWarmBranchLifecycleV2["stagePredicates"] {
	const predicates = record(value, path);
	const keys = [
		"cold_run_failed",
		"memory_record_admitted",
		"memory_record_applied",
		"memory_record_proposed",
		"memory_record_retrieved",
		"prior_failure_route_avoided",
		"same_work_item_input",
		"warm_action_trace_bound_to_memory_context",
		"warm_decision_trace_includes_memory",
		"warm_run_passed",
	] as const;
	exactKeys(predicates, keys, path);
	const validated = Object.fromEntries(
		keys.map((key) => {
			if (typeof predicates[key] !== "boolean")
				throw new TypeError(`${path}.${key} must be boolean`);
			return [key, predicates[key]];
		}),
	) as unknown as EmpiricalWarmBranchLifecycleV2["stagePredicates"];
	return strictSnapshot(validated);
}

function expectedLifecycle(branchKind: EmpiricalWarmBranchKind) {
	if (branchKind === "relevant-applied") {
		return {
			proposalState: "emitted",
			admissionState: "admitted",
			applicationState: "applied",
			retrievalState: "retrieved",
			plannerRoute: "memory-guided",
			traceMemoryDisposition: "delivered",
			warmRunPassed: true,
		} as const;
	}
	if (branchKind === "proposal-only") {
		return {
			proposalState: "emitted",
			admissionState: "not-run",
			applicationState: "not-run",
			retrievalState: "not-retrieved",
			plannerRoute: "baseline",
			traceMemoryDisposition: "none",
			warmRunPassed: false,
		} as const;
	}
	if (branchKind === "admission-rejected") {
		return {
			proposalState: "emitted",
			admissionState: "rejected",
			applicationState: "not-applied",
			retrievalState: "not-retrieved",
			plannerRoute: "baseline",
			traceMemoryDisposition: "none",
			warmRunPassed: false,
		} as const;
	}
	return {
		proposalState: "emitted",
		admissionState: "admitted",
		applicationState: "applied",
		retrievalState: "retrieved",
		plannerRoute: "baseline",
		traceMemoryDisposition:
			branchKind === "irrelevant-applied" ? "rejected-irrelevant" : "rejected-scope",
		warmRunPassed: false,
	} as const;
}

function lifecycleConforms(
	lifecycle: Omit<EmpiricalWarmBranchLifecycleV2, "caseConforms"> | EmpiricalWarmBranchLifecycleV2,
	branchKind: EmpiricalWarmBranchKind,
): boolean {
	const expected = expectedLifecycle(branchKind);
	const selected = lifecycle.selectedRecordDigest;
	const proposed = expected.proposalState === "emitted";
	const admitted = expected.admissionState === "admitted";
	const applied = expected.applicationState === "applied";
	const retrieved = expected.retrievalState === "retrieved";
	const memoryDelivered = expected.traceMemoryDisposition === "delivered";
	const exactSelectedDigestList = (values: readonly string[], present: boolean) =>
		present ? values.length === 1 && values[0] === selected : values.length === 0;
	return (
		lifecycle.proposalState === expected.proposalState &&
		lifecycle.admissionState === expected.admissionState &&
		lifecycle.applicationState === expected.applicationState &&
		lifecycle.retrievalState === expected.retrievalState &&
		lifecycle.plannerRoute === expected.plannerRoute &&
		lifecycle.traceMemoryDisposition === expected.traceMemoryDisposition &&
		lifecycle.stagePredicates.memory_record_proposed === proposed &&
		lifecycle.stagePredicates.memory_record_admitted === admitted &&
		lifecycle.stagePredicates.memory_record_applied === applied &&
		lifecycle.stagePredicates.memory_record_retrieved === retrieved &&
		lifecycle.stagePredicates.warm_run_passed === expected.warmRunPassed &&
		lifecycle.stagePredicates.warm_decision_trace_includes_memory === memoryDelivered &&
		lifecycle.stagePredicates.warm_action_trace_bound_to_memory_context === memoryDelivered &&
		lifecycle.stagePredicates.cold_run_failed &&
		lifecycle.stagePredicates.same_work_item_input &&
		exactSelectedDigestList(lifecycle.proposalRecordDigests, proposed) &&
		exactSelectedDigestList(lifecycle.admissionRecordDigests, admitted) &&
		exactSelectedDigestList(lifecycle.applicationRecordDigests, applied) &&
		exactSelectedDigestList(lifecycle.retrievalRecordDigests, retrieved) &&
		lifecycle.issueCodes.length === 0
	);
}

function validateWarmBranchLifecycle(
	value: unknown,
	branchKind: EmpiricalWarmBranchKind,
): EmpiricalWarmBranchLifecycleV2 {
	const path = `smoke.lifecycle.${branchKind}`;
	const lifecycle = record(value, path);
	exactKeys(
		lifecycle,
		[
			"admissionRecordDigests",
			"admissionState",
			"applicationRecordDigests",
			"applicationState",
			"branchKind",
			"caseConforms",
			"issueCodes",
			"mapperExplicitCandidates",
			"plannerRoute",
			"proposalRecordDigests",
			"proposalState",
			"retrievalRecordDigests",
			"retrievalState",
			"selectedRecordDigest",
			"stagePredicates",
			"topologyDigest",
			"traceMemoryDisposition",
		],
		path,
	);
	literal(lifecycle.branchKind, branchKind, `${path}.branchKind`);
	literal(lifecycle.mapperExplicitCandidates, 0, `${path}.mapperExplicitCandidates`);
	if (typeof lifecycle.caseConforms !== "boolean") {
		throw new TypeError(`${path}.caseConforms must be boolean`);
	}
	const stagePredicates = validateStagePredicates(
		lifecycle.stagePredicates,
		`${path}.stagePredicates`,
	);
	const normalized = strictSnapshot({
		branchKind,
		selectedRecordDigest: digest(lifecycle.selectedRecordDigest, `${path}.selectedRecordDigest`),
		proposalState: oneOf(
			lifecycle.proposalState,
			["emitted", "not-emitted"],
			`${path}.proposalState`,
		),
		admissionState: oneOf(
			lifecycle.admissionState,
			["admitted", "rejected", "not-run"],
			`${path}.admissionState`,
		),
		applicationState: oneOf(
			lifecycle.applicationState,
			["applied", "not-applied", "not-run"],
			`${path}.applicationState`,
		),
		retrievalState: oneOf(
			lifecycle.retrievalState,
			["retrieved", "not-retrieved"],
			`${path}.retrievalState`,
		),
		plannerRoute: oneOf(
			lifecycle.plannerRoute,
			["baseline", "memory-guided"],
			`${path}.plannerRoute`,
		),
		traceMemoryDisposition: oneOf(
			lifecycle.traceMemoryDisposition,
			["delivered", "rejected-irrelevant", "rejected-scope", "none"],
			`${path}.traceMemoryDisposition`,
		),
		mapperExplicitCandidates: 0 as const,
		proposalRecordDigests: validateDigestList(
			lifecycle.proposalRecordDigests,
			`${path}.proposalRecordDigests`,
		),
		admissionRecordDigests: validateDigestList(
			lifecycle.admissionRecordDigests,
			`${path}.admissionRecordDigests`,
		),
		applicationRecordDigests: validateDigestList(
			lifecycle.applicationRecordDigests,
			`${path}.applicationRecordDigests`,
		),
		retrievalRecordDigests: validateDigestList(
			lifecycle.retrievalRecordDigests,
			`${path}.retrievalRecordDigests`,
		),
		topologyDigest: digest(lifecycle.topologyDigest, `${path}.topologyDigest`),
		stagePredicates,
		caseConforms: lifecycle.caseConforms,
		issueCodes: validateCoordinateList(lifecycle.issueCodes, `${path}.issueCodes`),
	});
	const caseConforms = lifecycleConforms(normalized, branchKind);
	if (normalized.caseConforms !== caseConforms) {
		throw new TypeError(`${path}.caseConforms does not match the frozen D627 expectation`);
	}
	return normalized;
}

export function validateEmpiricalTrialBlockObservation(
	value: unknown,
): EmpiricalTrialBlockObservationV3 {
	const observation = record(value, "trialBlockObservation");
	exactKeys(
		observation,
		[
			"campaignRef",
			"claimBoundary",
			"cold",
			"empiricalLiveEvidence",
			"executionClass",
			"familyPassed",
			"hostOutcomeDigest",
			"issueCodes",
			"manifestDigest",
			"profile",
			"protectionReceiptDigests",
			"reflection",
			"rerunEligible",
			"result",
			"route",
			"routeEvidenceDigests",
			"schemaVersion",
			"taskDigest",
			"taskRef",
			"trialBlockDigest",
			"trialBlockRef",
			"verifierEvidenceDigests",
			"warmBranches",
		],
		"trialBlockObservation",
	);
	literal(
		observation.schemaVersion,
		EMPIRICAL_TRIAL_BLOCK_OBSERVATION_SCHEMA,
		"trialBlockObservation.schemaVersion",
	);
	const executionClass = oneOf(
		observation.executionClass,
		["simulated-contract", "live-approved-no-provider-evidence", "live-provider"],
		"trialBlockObservation.executionClass",
	);
	literal(
		observation.empiricalLiveEvidence,
		executionClass === "live-provider",
		"trialBlockObservation.empiricalLiveEvidence",
	);
	literal(
		observation.claimBoundary,
		B112_SMOKE_NO_EFFICACY_CLAIM,
		"trialBlockObservation.claimBoundary",
	);
	literal(observation.profile, "smoke", "trialBlockObservation.profile");
	const route = validateObservationRoute(observation.route);
	const result = validateObservationResult(observation.result);
	const routeEvidenceDigests = validateDigestList(
		observation.routeEvidenceDigests,
		"trialBlockObservation.routeEvidenceDigests",
	);
	const verifierEvidenceDigests = validateDigestList(
		observation.verifierEvidenceDigests,
		"trialBlockObservation.verifierEvidenceDigests",
	);
	const protectionReceiptDigests = validateDigestList(
		observation.protectionReceiptDigests,
		"trialBlockObservation.protectionReceiptDigests",
	);
	const cold = validateSmokeRunObservation(observation.cold, "trialBlockObservation.cold");
	if (
		cold.trialStage !== "cold" ||
		cold.branchKind !== null ||
		cold.memoryContextRecordDigest !== null
	) {
		throw new TypeError("trial observation cold run has invalid coordinates");
	}
	const rerunEligible = cold.classification === "incomplete" && cold.verifierStatus === "failed";
	literal(observation.rerunEligible, rerunEligible, "trialBlockObservation.rerunEligible");
	const reflectionValue = record(observation.reflection, "trialBlockObservation.reflection");
	exactKeys(
		reflectionValue,
		["candidateRecordDigests", "evidenceDigest", "issueCodes"],
		"trialBlockObservation.reflection",
	);
	const reflection = strictSnapshot({
		evidenceDigest:
			reflectionValue.evidenceDigest === null
				? null
				: digest(reflectionValue.evidenceDigest, "trialBlockObservation.reflection.evidenceDigest"),
		candidateRecordDigests: validateDigestList(
			reflectionValue.candidateRecordDigests,
			"trialBlockObservation.reflection.candidateRecordDigests",
		),
		issueCodes: validateCoordinateList(
			reflectionValue.issueCodes,
			"trialBlockObservation.reflection.issueCodes",
		),
	});
	const warmValues = array(observation.warmBranches, "trialBlockObservation.warmBranches");
	if (warmValues.length !== EMPIRICAL_WARM_BRANCHES.length) {
		throw new TypeError("trial observation requires the exact five warm branches");
	}
	const warmBranches = warmValues.map((value, index): EmpiricalWarmBranchObservationV3 => {
		const path = `trialBlockObservation.warmBranches[${index}]`;
		const branch = record(value, path);
		exactKeys(branch, ["attempted", "branchKind", "issueCodes", "lifecycle", "run"], path);
		const branchKind = EMPIRICAL_WARM_BRANCHES[index] as EmpiricalWarmBranchKind;
		literal(branch.branchKind, branchKind, `${path}.branchKind`);
		if (typeof branch.attempted !== "boolean") {
			throw new TypeError(`${path}.attempted must be boolean`);
		}
		const lifecycle =
			branch.lifecycle === null ? null : validateWarmBranchLifecycle(branch.lifecycle, branchKind);
		const run = branch.run === null ? null : validateSmokeRunObservation(branch.run, `${path}.run`);
		if (
			branch.attempted !== (run !== null) ||
			(run !== null && (run.trialStage !== "warm" || run.branchKind !== branchKind)) ||
			(run !== null && lifecycle === null)
		) {
			throw new TypeError(`${path} attempt, lifecycle, and run coordinates disagree`);
		}
		return strictSnapshot({
			branchKind,
			attempted: branch.attempted,
			lifecycle,
			run,
			issueCodes: validateCoordinateList(branch.issueCodes, `${path}.issueCodes`),
		});
	});
	if (
		warmBranches.some(
			(branch) =>
				branch.lifecycle !== null &&
				!reflection.candidateRecordDigests.includes(branch.lifecycle.selectedRecordDigest),
		)
	) {
		throw new TypeError("trial observation warm lifecycle is not bound to reflected candidates");
	}
	for (const branch of warmBranches) {
		if (branch.lifecycle === null || branch.run === null) continue;
		const actionTraceBoundToMemory = actionTraceBoundToDeliveredMemory(
			branch.run,
			branch.lifecycle.selectedRecordDigest,
		);
		const routeAvoided = actionTraceBoundToMemory && priorFailureRouteAvoided(cold, branch.run);
		const expectsMemory =
			branch.lifecycle.traceMemoryDisposition === "delivered"
				? branch.lifecycle.selectedRecordDigest
				: null;
		if (
			branch.run.memoryContextRecordDigest !== expectsMemory ||
			branch.lifecycle.stagePredicates.warm_decision_trace_includes_memory ||
			branch.lifecycle.stagePredicates.warm_action_trace_bound_to_memory_context !==
				actionTraceBoundToMemory ||
			branch.lifecycle.stagePredicates.prior_failure_route_avoided !== routeAvoided
		) {
			throw new TypeError(
				`trial observation ${branch.branchKind} lifecycle is not derived from its bound action trace`,
			);
		}
	}
	const issueCodes = validateCoordinateList(
		observation.issueCodes,
		"trialBlockObservation.issueCodes",
	);
	const attemptedWarm = warmBranches.filter(
		(
			branch,
		): branch is EmpiricalWarmBranchObservationV3 & {
			readonly attempted: true;
			readonly run: EmpiricalSmokeRunObservationV3;
		} => branch.attempted && branch.run !== null,
	);
	const runs = [cold, ...attemptedWarm.map((branch) => branch.run)];
	const sum = (
		field:
			| "requests"
			| "steps"
			| "attempts"
			| "hostInputBytes"
			| "hostOutputBytes"
			| "latencyMs"
			| "costMicrousd"
			| "reservedInputTokens"
			| "reservedOutputTokens",
	) => runs.reduce((total, run) => checkedSum(total, run[field], `${field} total overflow`), 0);
	const sumNullable = (field: "inputTokens" | "outputTokens" | "totalTokens") =>
		runs.some((run) => run[field] === null)
			? null
			: runs.reduce(
					(total, run) => checkedSum(total, run[field] as number, `${field} total overflow`),
					0,
				);
	const allWarmEvaluable =
		rerunEligible &&
		attemptedWarm.length === EMPIRICAL_WARM_BRANCHES.length &&
		attemptedWarm.every((branch) => branch.run.classification !== "non-evaluable");
	const expectedClassification =
		cold.classification === "non-evaluable"
			? "non-evaluable"
			: rerunEligible
				? allWarmEvaluable
					? "complete"
					: "incomplete"
				: "complete";
	const expectedCostBasis =
		executionClass === "simulated-contract"
			? "simulated-contract"
			: runs.every((run) => run.costBasis === "provider-usage")
				? "provider-usage"
				: "conservative-reservation";
	const aggregateDigests = (
		field: "routeEvidenceDigests" | "verifierEvidenceDigests" | "protectionReceiptDigests",
	) => [...new Set(runs.flatMap((run) => run[field]))].sort();
	if (
		result.classification !== expectedClassification ||
		result.costBasis !== expectedCostBasis ||
		result.requests !== sum("requests") ||
		result.steps !== sum("steps") ||
		result.attempts !== sum("attempts") ||
		result.inputTokens !== sumNullable("inputTokens") ||
		result.outputTokens !== sumNullable("outputTokens") ||
		result.totalTokens !== sumNullable("totalTokens") ||
		result.hostInputBytes !== sum("hostInputBytes") ||
		result.hostOutputBytes !== sum("hostOutputBytes") ||
		result.latencyMs !== sum("latencyMs") ||
		result.costMicrousd !== sum("costMicrousd") ||
		result.reservedInputTokens !== sum("reservedInputTokens") ||
		result.reservedOutputTokens !== sum("reservedOutputTokens")
	) {
		throw new TypeError("trial observation aggregate does not match its frozen runs");
	}
	if (
		routeEvidenceDigests.join() !== aggregateDigests("routeEvidenceDigests").join() ||
		verifierEvidenceDigests.join() !== aggregateDigests("verifierEvidenceDigests").join() ||
		protectionReceiptDigests.join() !== aggregateDigests("protectionReceiptDigests").join()
	) {
		throw new TypeError("trial observation evidence digests do not match its frozen runs");
	}
	literal(
		observation.hostOutcomeDigest,
		cold.hostOutcomeDigest,
		"trialBlockObservation.hostOutcomeDigest",
	);
	const hasBudgetExhaustion =
		(result.classification === "non-evaluable" || result.classification === "incomplete") &&
		(issueCodes.includes("smoke-budget-exhausted") ||
			issueCodes.includes("model-turn-retry-elapsed-budget-exhausted"));
	const postAttemptBudgetExceeded =
		(result.inputTokens !== null && result.inputTokens > route.maxInputTokens) ||
		(result.outputTokens !== null && result.outputTokens > route.maxOutputTokens) ||
		(result.costBasis === "conservative-reservation" &&
			(result.reservedInputTokens > route.maxInputTokens ||
				result.reservedOutputTokens > route.maxOutputTokens)) ||
		result.latencyMs > route.maxLatencyMs ||
		result.costMicrousd > route.maxSmokeSpendMicrousd;
	const providerUsageKnown = result.inputTokens !== null && result.outputTokens !== null;
	if (
		(executionClass === "simulated-contract") !== (result.costBasis === "simulated-contract") ||
		(executionClass === "simulated-contract" && result.costMicrousd !== 0) ||
		(executionClass === "live-approved-no-provider-evidence" &&
			(result.requests !== 0 ||
				result.costBasis !== "conservative-reservation" ||
				result.inputTokens !== null ||
				result.outputTokens !== null ||
				result.totalTokens !== null)) ||
		(executionClass === "live-provider" && result.requests === 0) ||
		result.requests > route.maxRequests ||
		result.steps > route.maxStepsPerRun * 6 ||
		(postAttemptBudgetExceeded && !hasBudgetExhaustion)
	) {
		throw new TypeError("trial observation result exceeds or mismatches its frozen route budget");
	}
	if (
		(executionClass !== "simulated-contract" &&
			providerUsageKnown !== (result.costBasis === "provider-usage")) ||
		(result.costBasis === "provider-usage" &&
			(!providerUsageKnown ||
				result.reservedInputTokens !== result.inputTokens ||
				result.reservedOutputTokens !== result.outputTokens ||
				result.costMicrousd <= 0)) ||
		(result.costBasis === "conservative-reservation" &&
			(result.reservedInputTokens > 0 || result.reservedOutputTokens > 0) &&
			result.costMicrousd <= 0)
	) {
		throw new TypeError("trial observation cost does not match its frozen pricing and token basis");
	}
	literal(
		result.verifierStatus,
		cold.verifierStatus,
		"trialBlockObservation.result.verifierStatus",
	);
	literal(
		result.warmRunsAttempted,
		warmBranches.filter((branch) => branch.attempted).length,
		"trialBlockObservation.result.warmRunsAttempted",
	);
	if (
		(executionClass === "live-approved-no-provider-evidence" &&
			routeEvidenceDigests.length !== 0) ||
		(hasBudgetExhaustion &&
			result.inputTokens !== null &&
			result.outputTokens !== null &&
			routeEvidenceDigests.length !== result.requests) ||
		(result.classification === "complete" &&
			result.steps > 0 &&
			routeEvidenceDigests.length !== result.steps)
	) {
		throw new TypeError("trial observation lacks required frozen evidence");
	}
	const expectedFamilyPassed =
		rerunEligible &&
		warmBranches.every(
			(branch) =>
				branch.attempted &&
				branch.run?.classification !== "non-evaluable" &&
				branch.lifecycle !== null,
		)
			? warmBranches.every((branch) => branch.lifecycle?.caseConforms)
			: null;
	const familyPassed = nullableBoolean(
		observation.familyPassed,
		"trialBlockObservation.familyPassed",
	);
	if (familyPassed !== expectedFamilyPassed) {
		throw new TypeError("trial observation familyPassed does not match its five arms");
	}
	return strictSnapshot({
		schemaVersion: EMPIRICAL_TRIAL_BLOCK_OBSERVATION_SCHEMA,
		executionClass,
		empiricalLiveEvidence: executionClass === "live-provider",
		claimBoundary: B112_SMOKE_NO_EFFICACY_CLAIM,
		campaignRef: coordinate(observation.campaignRef, "trialBlockObservation.campaignRef"),
		manifestDigest: digest(observation.manifestDigest, "trialBlockObservation.manifestDigest"),
		profile: "smoke" as const,
		taskRef: coordinate(observation.taskRef, "trialBlockObservation.taskRef"),
		taskDigest: digest(observation.taskDigest, "trialBlockObservation.taskDigest"),
		trialBlockRef: coordinate(observation.trialBlockRef, "trialBlockObservation.trialBlockRef"),
		trialBlockDigest: digest(
			observation.trialBlockDigest,
			"trialBlockObservation.trialBlockDigest",
		),
		route,
		result,
		hostOutcomeDigest: digest(
			observation.hostOutcomeDigest,
			"trialBlockObservation.hostOutcomeDigest",
		),
		routeEvidenceDigests,
		verifierEvidenceDigests,
		protectionReceiptDigests,
		cold,
		rerunEligible,
		reflection,
		warmBranches,
		familyPassed,
		issueCodes,
	});
}

export function validateEmpiricalCalibrationTrialBlockObservation(
	value: unknown,
): EmpiricalCalibrationTrialBlockObservationV4 {
	const observation = record(
		calibrationStrictOwnJsonSnapshot(value, "calibrationTrialBlockObservation"),
		"calibrationTrialBlockObservation",
	);
	exactKeys(
		observation,
		[
			"blockIndex",
			"campaignRef",
			"claimBoundary",
			"cold",
			"empiricalLiveEvidence",
			"executionClass",
			"familyPassed",
			"hostOutcomeDigest",
			"issueCodes",
			"manifestDigest",
			"profile",
			"protectionReceiptDigests",
			"reflection",
			"rerunEligible",
			"result",
			"route",
			"routeEvidenceDigests",
			"schemaVersion",
			"taskDigest",
			"taskRef",
			"trialBlockDigest",
			"trialBlockRef",
			"verifierEvidenceDigests",
			"warmBranches",
		],
		"calibrationTrialBlockObservation",
	);
	literal(
		observation.schemaVersion,
		EMPIRICAL_CALIBRATION_TRIAL_BLOCK_OBSERVATION_SCHEMA,
		"calibrationTrialBlockObservation.schemaVersion",
	);
	literal(
		observation.claimBoundary,
		B112_CALIBRATION_EXPLORATORY_NO_EFFICACY_CLAIM,
		"calibrationTrialBlockObservation.claimBoundary",
	);
	literal(observation.profile, "calibration", "calibrationTrialBlockObservation.profile");
	const blockIndex = safeInteger(
		observation.blockIndex,
		"calibrationTrialBlockObservation.blockIndex",
		{ min: 1, max: 3 },
	) as 1 | 2 | 3;
	const {
		blockIndex: _blockIndex,
		claimBoundary: _claimBoundary,
		profile: _profile,
		schemaVersion: _schemaVersion,
		...common
	} = observation;
	const validated = validateEmpiricalTrialBlockObservation({
		...common,
		schemaVersion: EMPIRICAL_TRIAL_BLOCK_OBSERVATION_SCHEMA,
		claimBoundary: B112_SMOKE_NO_EFFICACY_CLAIM,
		profile: "smoke",
	});
	for (const [index, branch] of validated.warmBranches.entries()) {
		const nestedIssues = [
			...(branch.run?.issueCodes ?? []),
			...(branch.lifecycle?.issueCodes ?? []),
		];
		if (nestedIssues.some((issueCode) => !branch.issueCodes.includes(issueCode))) {
			throw new TypeError(
				`B112 empirical campaign calibrationTrialBlockObservation.warmBranches[${index}].issueCodes: missing nested authoritative issue`,
			);
		}
	}
	const expectedIssueCodes = [
		...new Set([
			...validated.cold.issueCodes,
			...validated.warmBranches.flatMap((branch) => branch.issueCodes),
			...(validated.rerunEligible &&
			validated.warmBranches.filter((branch) => branch.attempted).length <
				validated.warmBranches.length
				? ["smoke-cold-failed-warm-arms-incomplete"]
				: []),
		]),
	].sort();
	if (
		validated.issueCodes.length !== expectedIssueCodes.length ||
		validated.issueCodes.some((issueCode, index) => issueCode !== expectedIssueCodes[index])
	) {
		throw new TypeError(
			"B112 empirical campaign calibrationTrialBlockObservation.issueCodes: must equal the canonical nested issue union",
		);
	}
	return strictSnapshot({
		...validated,
		schemaVersion: EMPIRICAL_CALIBRATION_TRIAL_BLOCK_OBSERVATION_SCHEMA,
		claimBoundary: B112_CALIBRATION_EXPLORATORY_NO_EFFICACY_CLAIM,
		profile: "calibration" as const,
		blockIndex,
	});
}

const MAX_CALIBRATION_OBSERVATION_JSON_NODES = 50_000;
const MAX_CALIBRATION_OBSERVATION_JSON_DEPTH = 64;

/**
 * V4-only descriptor-safe copy. Historical v1-v3 validation remains byte and
 * behavior stable, while calibration evidence cannot substitute array methods,
 * iterators, accessors, sparse entries, or custom prototypes during validation.
 */
function calibrationStrictOwnJsonSnapshot(
	value: unknown,
	path: string,
	state: { nodes: number } = { nodes: 0 },
	depth = 0,
): unknown {
	state.nodes += 1;
	if (state.nodes > MAX_CALIBRATION_OBSERVATION_JSON_NODES) {
		throw new TypeError(`B112 empirical campaign ${path}: strict JSON node bound exceeded`);
	}
	if (depth > MAX_CALIBRATION_OBSERVATION_JSON_DEPTH) {
		throw new TypeError(`B112 empirical campaign ${path}: strict JSON depth bound exceeded`);
	}
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new TypeError(`B112 empirical campaign ${path}: expected finite JSON number`);
		}
		return value;
	}
	if (Array.isArray(value)) {
		if (Object.getPrototypeOf(value) !== Array.prototype) {
			throw new TypeError(`B112 empirical campaign ${path}: expected canonical array prototype`);
		}
		if (Object.getOwnPropertySymbols(value).length > 0) {
			throw new TypeError(
				`B112 empirical campaign ${path}: symbol-keyed array properties forbidden`,
			);
		}
		const copy: unknown[] = [];
		for (let index = 0; index < value.length; index += 1) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
				throw new TypeError(
					`B112 empirical campaign ${path}[${index}]: expected dense own data entry`,
				);
			}
			copy.push(
				calibrationStrictOwnJsonSnapshot(descriptor.value, `${path}[${index}]`, state, depth + 1),
			);
		}
		if (Object.getOwnPropertyNames(value).length !== value.length + 1) {
			throw new TypeError(`B112 empirical campaign ${path}: unexpected array properties`);
		}
		return Object.freeze(copy);
	}
	if (typeof value === "object") {
		const source = record(value, path);
		const copy = Object.create(null) as Record<string, unknown>;
		for (const key of Object.keys(source)) {
			const descriptor = Object.getOwnPropertyDescriptor(source, key);
			if (descriptor === undefined || !("value" in descriptor)) {
				throw new TypeError(`B112 empirical campaign ${path}.${key}: expected own data property`);
			}
			copy[key] = calibrationStrictOwnJsonSnapshot(
				descriptor.value,
				`${path}.${key}`,
				state,
				depth + 1,
			);
		}
		return Object.freeze(copy);
	}
	throw new TypeError(`B112 empirical campaign ${path}: expected strict JSON value`);
}

function validateObservationRoute(value: unknown): EmpiricalTrialBlockObservationV3["route"] {
	const route = record(value, "trialBlockObservation.route");
	const keys = [
		"adapterRevision",
		"bindingRevision",
		"budgetApprovalRef",
		"budgetApprovalRevision",
		"capabilitiesDigest",
		"configurationDigest",
		"configurationRef",
		"downstreamProviderName",
		"downstreamProviderSlug",
		"endpoint",
		"endpointRevision",
		"inputMicrousdPerMillionTokens",
		"maxCanonicalRequestBytes",
		"maxInputTokens",
		"maxLatencyMs",
		"maxOutputTokens",
		"maxRequests",
		"maxSmokeSpendMicrousd",
		"maxStepsPerRun",
		"model",
		"modelIdentityKind",
		"outputMicrousdPerMillionTokens",
		"pricingRevision",
		"pricingSourceUrl",
		"providerFamily",
		"qualificationDigest",
		"qualificationRef",
		"qualificationRevision",
		"routeEvidenceSchemaRevision",
		"reservationRevision",
		"settingsDigest",
		"usageRevision",
		"usageSource",
	] as const;
	exactKeys(route, keys, "trialBlockObservation.route");
	literal(route.providerFamily, "openrouter", "trialBlockObservation.route.providerFamily");
	return strictSnapshot({
		qualificationRef: coordinate(
			route.qualificationRef,
			"trialBlockObservation.route.qualificationRef",
		),
		qualificationRevision: coordinate(
			route.qualificationRevision,
			"trialBlockObservation.route.qualificationRevision",
		),
		qualificationDigest: digest(
			route.qualificationDigest,
			"trialBlockObservation.route.qualificationDigest",
		),
		configurationRef: coordinate(
			route.configurationRef,
			"trialBlockObservation.route.configurationRef",
		),
		configurationDigest: digest(
			route.configurationDigest,
			"trialBlockObservation.route.configurationDigest",
		),
		model: coordinate(route.model, "trialBlockObservation.route.model"),
		modelIdentityKind: oneOf(
			route.modelIdentityKind,
			["exact-snapshot", "alias-disclosed"],
			"trialBlockObservation.route.modelIdentityKind",
		),
		providerFamily: "openrouter" as const,
		downstreamProviderSlug: coordinate(
			route.downstreamProviderSlug,
			"trialBlockObservation.route.downstreamProviderSlug",
		),
		downstreamProviderName: coordinate(
			route.downstreamProviderName,
			"trialBlockObservation.route.downstreamProviderName",
		),
		endpoint: coordinate(route.endpoint, "trialBlockObservation.route.endpoint"),
		endpointRevision: coordinate(
			route.endpointRevision,
			"trialBlockObservation.route.endpointRevision",
		),
		adapterRevision: coordinate(
			route.adapterRevision,
			"trialBlockObservation.route.adapterRevision",
		),
		bindingRevision: coordinate(
			route.bindingRevision,
			"trialBlockObservation.route.bindingRevision",
		),
		capabilitiesDigest: digest(
			route.capabilitiesDigest,
			"trialBlockObservation.route.capabilitiesDigest",
		),
		settingsDigest: digest(route.settingsDigest, "trialBlockObservation.route.settingsDigest"),
		usageSource: coordinate(route.usageSource, "trialBlockObservation.route.usageSource"),
		usageRevision: coordinate(route.usageRevision, "trialBlockObservation.route.usageRevision"),
		routeEvidenceSchemaRevision: coordinate(
			route.routeEvidenceSchemaRevision,
			"trialBlockObservation.route.routeEvidenceSchemaRevision",
		),
		pricingSourceUrl: coordinate(
			route.pricingSourceUrl,
			"trialBlockObservation.route.pricingSourceUrl",
		),
		pricingRevision: coordinate(
			route.pricingRevision,
			"trialBlockObservation.route.pricingRevision",
		),
		inputMicrousdPerMillionTokens: safeInteger(
			route.inputMicrousdPerMillionTokens,
			"trialBlockObservation.route.inputMicrousdPerMillionTokens",
			{ min: 1 },
		),
		outputMicrousdPerMillionTokens: safeInteger(
			route.outputMicrousdPerMillionTokens,
			"trialBlockObservation.route.outputMicrousdPerMillionTokens",
			{ min: 1 },
		),
		budgetApprovalRef: coordinate(
			route.budgetApprovalRef,
			"trialBlockObservation.route.budgetApprovalRef",
		),
		budgetApprovalRevision: coordinate(
			route.budgetApprovalRevision,
			"trialBlockObservation.route.budgetApprovalRevision",
		),
		maxSmokeSpendMicrousd: safeInteger(
			route.maxSmokeSpendMicrousd,
			"trialBlockObservation.route.maxSmokeSpendMicrousd",
			{ min: 1 },
		),
		maxRequests: safeInteger(route.maxRequests, "trialBlockObservation.route.maxRequests", {
			min: 1,
			max: 192,
		}),
		maxStepsPerRun: safeInteger(
			route.maxStepsPerRun,
			"trialBlockObservation.route.maxStepsPerRun",
			{ min: 1, max: 64 },
		),
		maxCanonicalRequestBytes: safeInteger(
			route.maxCanonicalRequestBytes,
			"trialBlockObservation.route.maxCanonicalRequestBytes",
			{ min: 1, max: 262_144 },
		),
		maxInputTokens: safeInteger(
			route.maxInputTokens,
			"trialBlockObservation.route.maxInputTokens",
			{ min: 1 },
		),
		maxOutputTokens: safeInteger(
			route.maxOutputTokens,
			"trialBlockObservation.route.maxOutputTokens",
			{ min: 1 },
		),
		maxLatencyMs: safeInteger(route.maxLatencyMs, "trialBlockObservation.route.maxLatencyMs", {
			min: 1,
			max: 86_400_000,
		}),
		reservationRevision: coordinate(
			route.reservationRevision,
			"trialBlockObservation.route.reservationRevision",
		),
	});
}

function validateObservationResult(value: unknown): EmpiricalTrialBlockObservationV3["result"] {
	const result = record(value, "trialBlockObservation.result");
	exactKeys(
		result,
		[
			"classification",
			"coldRunsAttempted",
			"costBasis",
			"costMicrousd",
			"attempts",
			"hostInputBytes",
			"hostOutputBytes",
			"inputTokens",
			"latencyMs",
			"outputTokens",
			"requests",
			"reservedInputTokens",
			"reservedOutputTokens",
			"steps",
			"totalTokens",
			"verifierStatus",
			"warmRunsAttempted",
		],
		"trialBlockObservation.result",
	);
	const nullableTokens = (item: unknown, path: string): number | null =>
		item === null ? null : safeInteger(item, path, { min: 0 });
	return strictSnapshot({
		classification: oneOf(
			result.classification,
			["complete", "incomplete", "non-evaluable"],
			"trialBlockObservation.result.classification",
		),
		verifierStatus: oneOf(
			result.verifierStatus,
			["passed", "failed", "unverifiable", "not-run"],
			"trialBlockObservation.result.verifierStatus",
		),
		coldRunsAttempted: literal(
			result.coldRunsAttempted,
			1,
			"trialBlockObservation.result.coldRunsAttempted",
		),
		warmRunsAttempted: safeInteger(
			result.warmRunsAttempted,
			"trialBlockObservation.result.warmRunsAttempted",
			{ min: 0, max: 5 },
		),
		requests: safeInteger(result.requests, "trialBlockObservation.result.requests", {
			min: 0,
			max: 192,
		}),
		steps: safeInteger(result.steps, "trialBlockObservation.result.steps", {
			min: 0,
			max: 384,
		}),
		attempts: safeInteger(result.attempts, "trialBlockObservation.result.attempts", {
			min: 0,
			max: 192,
		}),
		inputTokens: nullableTokens(result.inputTokens, "trialBlockObservation.result.inputTokens"),
		outputTokens: nullableTokens(result.outputTokens, "trialBlockObservation.result.outputTokens"),
		totalTokens: nullableTokens(result.totalTokens, "trialBlockObservation.result.totalTokens"),
		hostInputBytes: safeInteger(
			result.hostInputBytes,
			"trialBlockObservation.result.hostInputBytes",
			{ min: 0 },
		),
		hostOutputBytes: safeInteger(
			result.hostOutputBytes,
			"trialBlockObservation.result.hostOutputBytes",
			{ min: 0 },
		),
		latencyMs: safeInteger(result.latencyMs, "trialBlockObservation.result.latencyMs", {
			min: 0,
			max: 86_400_000,
		}),
		costMicrousd: safeInteger(result.costMicrousd, "trialBlockObservation.result.costMicrousd", {
			min: 0,
		}),
		costBasis: oneOf(
			result.costBasis,
			["simulated-contract", "provider-usage", "conservative-reservation"],
			"trialBlockObservation.result.costBasis",
		),
		reservedInputTokens: safeInteger(
			result.reservedInputTokens,
			"trialBlockObservation.result.reservedInputTokens",
			{ min: 0 },
		),
		reservedOutputTokens: safeInteger(
			result.reservedOutputTokens,
			"trialBlockObservation.result.reservedOutputTokens",
			{ min: 0 },
		),
	});
}

function validateDigestList(value: unknown, path: string): readonly string[] {
	const values = array(value, path);
	if (values.length > 128) throw new TypeError(`${path} exceeds its bounded item count`);
	const validated = values.map((item, index) => digest(item, `${path}[${index}]`));
	if (
		new Set(validated).size !== validated.length ||
		[...validated].sort().join() !== validated.join()
	) {
		throw new TypeError(`${path} must be unique and canonical-sort ordered`);
	}
	return Object.freeze(validated);
}

function validateOrderedDigestList(value: unknown, path: string): readonly string[] {
	const values = array(value, path);
	if (values.length > 64) throw new TypeError(`${path} exceeds its bounded item count`);
	return Object.freeze(values.map((item, index) => digest(item, `${path}[${index}]`)));
}

function validateCoordinateList(value: unknown, path: string): readonly string[] {
	const values = array(value, path);
	if (values.length > 128) throw new TypeError(`${path} exceeds its bounded item count`);
	const validated = values.map((item, index) => coordinate(item, `${path}[${index}]`));
	if (
		new Set(validated).size !== validated.length ||
		[...validated].sort().join() !== validated.join()
	) {
		throw new TypeError(`${path} must be unique and canonical-sort ordered`);
	}
	return Object.freeze(validated);
}

export function createEmpiricalCampaignScorecard(
	observationValue: EmpiricalTrialBlockObservationV3,
	aggregationRevision: string,
): EmpiricalCampaignScorecardV3 {
	const observation = validateEmpiricalTrialBlockObservation(observationValue);
	const complete = observation.result.classification === "complete" ? 1 : 0;
	const incomplete = observation.result.classification === "incomplete" ? 1 : 0;
	const nonEvaluable = observation.result.classification === "non-evaluable" ? 1 : 0;
	const armResults = observation.warmBranches.map((branch) => ({
		branchKind: branch.branchKind,
		attempted: branch.attempted,
		evaluable: branch.run !== null && branch.run.classification !== "non-evaluable",
		verifierPassed:
			branch.run === null || branch.run.classification === "non-evaluable"
				? null
				: branch.run.verifierStatus === "passed",
		caseConforms: branch.lifecycle?.caseConforms ?? null,
	}));
	const relevant = armResults[0];
	const proposalOnly = armResults[1];
	const relevantPass = relevant?.evaluable === true ? (relevant.verifierPassed ? 1 : 0) : null;
	const proposalOnlyPass =
		proposalOnly?.evaluable === true ? (proposalOnly.verifierPassed ? 1 : 0) : null;
	const riskDifference =
		relevantPass === null || proposalOnlyPass === null
			? null
			: ((relevantPass - proposalOnlyPass) as -1 | 0 | 1);
	const discordance =
		relevantPass === null || proposalOnlyPass === null
			? ("not-evaluable" as const)
			: relevantPass === 1 && proposalOnlyPass === 0
				? ("relevant-only" as const)
				: relevantPass === 0 && proposalOnlyPass === 1
					? ("proposal-only" as const)
					: relevantPass === 1
						? ("concordant-pass" as const)
						: ("concordant-fail" as const);
	const secondaryComparisons = (
		[
			["admission-rejected", armResults[2]],
			["irrelevant-applied", armResults[3]],
			["wrong-scope-applied", armResults[4]],
		] as const
	).map(([controlBranchKind, control]) => {
		const controlPass = control?.evaluable === true ? (control.verifierPassed ? 1 : 0) : null;
		return {
			controlBranchKind,
			relevantAppliedPass: relevantPass,
			controlPass,
			riskDifference:
				relevantPass === null || controlPass === null
					? null
					: ((relevantPass - controlPass) as -1 | 0 | 1),
			discordance:
				relevantPass === null || controlPass === null
					? ("not-evaluable" as const)
					: relevantPass === 1 && controlPass === 0
						? ("relevant-only" as const)
						: relevantPass === 0 && controlPass === 1
							? ("control-only" as const)
							: relevantPass === 1
								? ("concordant-pass" as const)
								: ("concordant-fail" as const),
		};
	});
	return validateEmpiricalCampaignScorecard({
		schemaVersion: EMPIRICAL_CAMPAIGN_SCORECARD_SCHEMA,
		campaignRef: observation.campaignRef,
		manifestDigest: observation.manifestDigest,
		profile: "smoke" as const,
		evidenceClass: observation.executionClass,
		empiricalLiveEvidence: observation.empiricalLiveEvidence,
		efficacyClaim: "none" as const,
		claimBoundary: B112_SMOKE_NO_EFFICACY_CLAIM,
		aggregationRevision: coordinate(aggregationRevision, "scorecard.aggregationRevision"),
		observationDigests: [empiricalStrictJsonDigest(observation)] as const,
		attemptedBlocks: 1 as const,
		completeBlocks: complete as 0 | 1,
		incompleteBlocks: incomplete as 0 | 1,
		nonEvaluableBlocks: nonEvaluable as 0 | 1,
		verifierPassedBlocks: (observation.cold.verifierStatus === "passed" ? 1 : 0) as 0 | 1,
		eligibleColdFailures: (observation.rerunEligible ? 1 : 0) as 0 | 1,
		warmRunsAttempted: observation.result.warmRunsAttempted,
		warmRunsEvaluable: armResults.filter((arm) => arm.evaluable).length,
		armResults,
		primaryComparison: {
			relevantAppliedPass: relevantPass,
			proposalOnlyPass,
			riskDifference,
			discordance,
		},
		secondaryComparisons,
		familyPassed: observation.familyPassed,
		requests: observation.result.requests,
		steps: observation.result.steps,
		attempts: observation.result.attempts,
		inputTokens: observation.result.inputTokens,
		outputTokens: observation.result.outputTokens,
		totalTokens: observation.result.totalTokens,
		hostInputBytes: observation.result.hostInputBytes,
		hostOutputBytes: observation.result.hostOutputBytes,
		latencyMs: observation.result.latencyMs,
		costMicrousd: observation.result.costMicrousd,
		costBasis: observation.result.costBasis,
		reservedInputTokens: observation.result.reservedInputTokens,
		reservedOutputTokens: observation.result.reservedOutputTokens,
		status:
			complete === 1
				? ("smoke-complete-no-efficacy-claim" as const)
				: incomplete === 1
					? ("incomplete" as const)
					: ("non-evaluable" as const),
		issueCodes: observation.issueCodes,
	});
}

export function validateEmpiricalCampaignScorecard(value: unknown): EmpiricalCampaignScorecardV3 {
	const scorecard = record(value, "campaignScorecard");
	exactKeys(
		scorecard,
		[
			"aggregationRevision",
			"armResults",
			"attempts",
			"attemptedBlocks",
			"campaignRef",
			"claimBoundary",
			"completeBlocks",
			"costBasis",
			"costMicrousd",
			"efficacyClaim",
			"empiricalLiveEvidence",
			"eligibleColdFailures",
			"evidenceClass",
			"familyPassed",
			"hostInputBytes",
			"hostOutputBytes",
			"incompleteBlocks",
			"inputTokens",
			"issueCodes",
			"latencyMs",
			"manifestDigest",
			"nonEvaluableBlocks",
			"observationDigests",
			"outputTokens",
			"primaryComparison",
			"profile",
			"requests",
			"reservedInputTokens",
			"reservedOutputTokens",
			"schemaVersion",
			"secondaryComparisons",
			"status",
			"steps",
			"totalTokens",
			"verifierPassedBlocks",
			"warmRunsAttempted",
			"warmRunsEvaluable",
		],
		"campaignScorecard",
	);
	literal(
		scorecard.schemaVersion,
		EMPIRICAL_CAMPAIGN_SCORECARD_SCHEMA,
		"campaignScorecard.schemaVersion",
	);
	const evidenceClass = oneOf(
		scorecard.evidenceClass,
		["simulated-contract", "live-approved-no-provider-evidence", "live-provider"],
		"campaignScorecard.evidenceClass",
	);
	literal(
		scorecard.empiricalLiveEvidence,
		evidenceClass === "live-provider",
		"campaignScorecard.empiricalLiveEvidence",
	);
	literal(scorecard.profile, "smoke", "campaignScorecard.profile");
	literal(scorecard.efficacyClaim, "none", "campaignScorecard.efficacyClaim");
	literal(scorecard.claimBoundary, B112_SMOKE_NO_EFFICACY_CLAIM, "campaignScorecard.claimBoundary");
	literal(scorecard.attemptedBlocks, 1, "campaignScorecard.attemptedBlocks");
	const completeBlocks = zeroOrOne(scorecard.completeBlocks, "campaignScorecard.completeBlocks");
	const incompleteBlocks = zeroOrOne(
		scorecard.incompleteBlocks,
		"campaignScorecard.incompleteBlocks",
	);
	const nonEvaluableBlocks = zeroOrOne(
		scorecard.nonEvaluableBlocks,
		"campaignScorecard.nonEvaluableBlocks",
	);
	if (completeBlocks + incompleteBlocks + nonEvaluableBlocks !== 1) {
		throw new TypeError("campaign scorecard must classify its one attempted block exactly once");
	}
	const status = oneOf(
		scorecard.status,
		["smoke-complete-no-efficacy-claim", "incomplete", "non-evaluable"],
		"campaignScorecard.status",
	);
	if (
		(status === "smoke-complete-no-efficacy-claim") !== (completeBlocks === 1) ||
		(status === "incomplete") !== (incompleteBlocks === 1) ||
		(status === "non-evaluable") !== (nonEvaluableBlocks === 1)
	) {
		throw new TypeError("campaign scorecard status does not match block classification");
	}
	const observationDigests = validateDigestList(
		scorecard.observationDigests,
		"campaignScorecard.observationDigests",
	);
	if (observationDigests.length !== 1) {
		throw new TypeError("smoke scorecard requires exactly one frozen observation digest");
	}
	const verifierPassedBlocks = zeroOrOne(
		scorecard.verifierPassedBlocks,
		"campaignScorecard.verifierPassedBlocks",
	);
	const eligibleColdFailures = zeroOrOne(
		scorecard.eligibleColdFailures,
		"campaignScorecard.eligibleColdFailures",
	);
	const warmRunsAttempted = safeInteger(
		scorecard.warmRunsAttempted,
		"campaignScorecard.warmRunsAttempted",
		{ min: 0, max: 5 },
	);
	const warmRunsEvaluable = safeInteger(
		scorecard.warmRunsEvaluable,
		"campaignScorecard.warmRunsEvaluable",
		{ min: 0, max: warmRunsAttempted },
	);
	const armValues = array(scorecard.armResults, "campaignScorecard.armResults");
	if (armValues.length !== EMPIRICAL_WARM_BRANCHES.length) {
		throw new TypeError("campaign scorecard requires the exact five arm results");
	}
	const armResults = armValues.map((value, index) => {
		const path = `campaignScorecard.armResults[${index}]`;
		const arm = record(value, path);
		exactKeys(
			arm,
			["attempted", "branchKind", "caseConforms", "evaluable", "verifierPassed"],
			path,
		);
		const branchKind = EMPIRICAL_WARM_BRANCHES[index] as EmpiricalWarmBranchKind;
		literal(arm.branchKind, branchKind, `${path}.branchKind`);
		if (
			typeof arm.attempted !== "boolean" ||
			typeof arm.evaluable !== "boolean" ||
			(arm.verifierPassed !== null && typeof arm.verifierPassed !== "boolean") ||
			(arm.caseConforms !== null && typeof arm.caseConforms !== "boolean") ||
			(arm.evaluable && !arm.attempted) ||
			(!arm.evaluable && arm.verifierPassed !== null)
		) {
			throw new TypeError(`${path} has inconsistent arm result coordinates`);
		}
		return strictSnapshot({
			branchKind,
			attempted: arm.attempted,
			evaluable: arm.evaluable,
			verifierPassed: arm.verifierPassed,
			caseConforms: arm.caseConforms,
		});
	});
	if (
		armResults.filter((arm) => arm.attempted).length !== warmRunsAttempted ||
		armResults.filter((arm) => arm.evaluable).length !== warmRunsEvaluable
	) {
		throw new TypeError("campaign scorecard arm counts do not match their summaries");
	}
	const comparisonValue = record(
		scorecard.primaryComparison,
		"campaignScorecard.primaryComparison",
	);
	exactKeys(
		comparisonValue,
		["discordance", "proposalOnlyPass", "relevantAppliedPass", "riskDifference"],
		"campaignScorecard.primaryComparison",
	);
	const nullableZeroOrOne = (value: unknown, path: string): 0 | 1 | null =>
		value === null ? null : zeroOrOne(value, path);
	const relevantAppliedPass = nullableZeroOrOne(
		comparisonValue.relevantAppliedPass,
		"campaignScorecard.primaryComparison.relevantAppliedPass",
	);
	const proposalOnlyPass = nullableZeroOrOne(
		comparisonValue.proposalOnlyPass,
		"campaignScorecard.primaryComparison.proposalOnlyPass",
	);
	const riskDifference =
		comparisonValue.riskDifference === null
			? null
			: (safeInteger(
					comparisonValue.riskDifference,
					"campaignScorecard.primaryComparison.riskDifference",
					{ min: -1, max: 1 },
				) as -1 | 0 | 1);
	const expectedRiskDifference =
		relevantAppliedPass === null || proposalOnlyPass === null
			? null
			: ((relevantAppliedPass - proposalOnlyPass) as -1 | 0 | 1);
	const expectedRelevantPass =
		armResults[0]?.evaluable === true ? (armResults[0].verifierPassed ? 1 : 0) : null;
	const expectedProposalOnlyPass =
		armResults[1]?.evaluable === true ? (armResults[1].verifierPassed ? 1 : 0) : null;
	const expectedDiscordance =
		relevantAppliedPass === null || proposalOnlyPass === null
			? "not-evaluable"
			: relevantAppliedPass === 1 && proposalOnlyPass === 0
				? "relevant-only"
				: relevantAppliedPass === 0 && proposalOnlyPass === 1
					? "proposal-only"
					: relevantAppliedPass === 1
						? "concordant-pass"
						: "concordant-fail";
	const discordance = oneOf(
		comparisonValue.discordance,
		["relevant-only", "proposal-only", "concordant-pass", "concordant-fail", "not-evaluable"],
		"campaignScorecard.primaryComparison.discordance",
	);
	if (
		relevantAppliedPass !== expectedRelevantPass ||
		proposalOnlyPass !== expectedProposalOnlyPass ||
		riskDifference !== expectedRiskDifference ||
		discordance !== expectedDiscordance
	) {
		throw new TypeError("campaign scorecard primary comparison is not deterministic");
	}
	const secondaryValues = array(
		scorecard.secondaryComparisons,
		"campaignScorecard.secondaryComparisons",
	);
	const secondaryKinds = [
		"admission-rejected",
		"irrelevant-applied",
		"wrong-scope-applied",
	] as const;
	if (secondaryValues.length !== secondaryKinds.length) {
		throw new TypeError("campaign scorecard requires the exact three secondary comparisons");
	}
	const secondaryComparisons = secondaryValues.map((value, index) => {
		const path = `campaignScorecard.secondaryComparisons[${index}]`;
		const comparison = record(value, path);
		exactKeys(
			comparison,
			["controlBranchKind", "controlPass", "discordance", "relevantAppliedPass", "riskDifference"],
			path,
		);
		const controlBranchKind = secondaryKinds[index];
		if (controlBranchKind === undefined) {
			throw new TypeError(`${path}.controlBranchKind is outside the frozen comparison set`);
		}
		literal(comparison.controlBranchKind, controlBranchKind, `${path}.controlBranchKind`);
		const comparedRelevantPass = nullableZeroOrOne(
			comparison.relevantAppliedPass,
			`${path}.relevantAppliedPass`,
		);
		const controlPass = nullableZeroOrOne(comparison.controlPass, `${path}.controlPass`);
		const comparedRiskDifference =
			comparison.riskDifference === null
				? null
				: (safeInteger(comparison.riskDifference, `${path}.riskDifference`, {
						min: -1,
						max: 1,
					}) as -1 | 0 | 1);
		const controlArm = armResults[index + 2];
		const expectedControlPass =
			controlArm?.evaluable === true ? (controlArm.verifierPassed ? 1 : 0) : null;
		const expectedComparedRiskDifference =
			comparedRelevantPass === null || controlPass === null
				? null
				: ((comparedRelevantPass - controlPass) as -1 | 0 | 1);
		const expectedComparedDiscordance =
			comparedRelevantPass === null || controlPass === null
				? "not-evaluable"
				: comparedRelevantPass === 1 && controlPass === 0
					? "relevant-only"
					: comparedRelevantPass === 0 && controlPass === 1
						? "control-only"
						: comparedRelevantPass === 1
							? "concordant-pass"
							: "concordant-fail";
		const comparedDiscordance = oneOf(
			comparison.discordance,
			["relevant-only", "control-only", "concordant-pass", "concordant-fail", "not-evaluable"],
			`${path}.discordance`,
		);
		if (
			comparedRelevantPass !== expectedRelevantPass ||
			controlPass !== expectedControlPass ||
			comparedRiskDifference !== expectedComparedRiskDifference ||
			comparedDiscordance !== expectedComparedDiscordance
		) {
			throw new TypeError(`${path} is not deterministic`);
		}
		return strictSnapshot({
			controlBranchKind,
			relevantAppliedPass: comparedRelevantPass,
			controlPass,
			riskDifference: comparedRiskDifference,
			discordance: comparedDiscordance,
		});
	});
	const familyPassed = nullableBoolean(scorecard.familyPassed, "campaignScorecard.familyPassed");
	const expectedFamilyPassed =
		eligibleColdFailures === 1 &&
		warmRunsAttempted === EMPIRICAL_WARM_BRANCHES.length &&
		warmRunsEvaluable === EMPIRICAL_WARM_BRANCHES.length
			? armResults.every((arm) => arm.caseConforms === true)
			: null;
	if (familyPassed !== expectedFamilyPassed) {
		throw new TypeError("campaign scorecard family result does not match its frozen arms");
	}
	const nullableTokens = (item: unknown, path: string): number | null =>
		item === null ? null : safeInteger(item, path, { min: 0 });
	const requests = safeInteger(scorecard.requests, "campaignScorecard.requests", {
		min: 0,
		max: 192,
	});
	const costBasis = oneOf(
		scorecard.costBasis,
		["simulated-contract", "provider-usage", "conservative-reservation"],
		"campaignScorecard.costBasis",
	);
	if (
		(evidenceClass === "simulated-contract") !== (costBasis === "simulated-contract") ||
		(evidenceClass === "live-approved-no-provider-evidence" &&
			(requests !== 0 ||
				costBasis !== "conservative-reservation" ||
				scorecard.inputTokens !== null ||
				scorecard.outputTokens !== null ||
				scorecard.totalTokens !== null)) ||
		(evidenceClass === "live-provider" && requests === 0)
	) {
		throw new TypeError("campaign scorecard evidence and cost provenance do not match");
	}
	return strictSnapshot({
		schemaVersion: EMPIRICAL_CAMPAIGN_SCORECARD_SCHEMA,
		campaignRef: coordinate(scorecard.campaignRef, "campaignScorecard.campaignRef"),
		manifestDigest: digest(scorecard.manifestDigest, "campaignScorecard.manifestDigest"),
		profile: "smoke" as const,
		evidenceClass,
		empiricalLiveEvidence: evidenceClass === "live-provider",
		efficacyClaim: "none" as const,
		claimBoundary: B112_SMOKE_NO_EFFICACY_CLAIM,
		aggregationRevision: coordinate(
			scorecard.aggregationRevision,
			"campaignScorecard.aggregationRevision",
		),
		observationDigests: observationDigests as readonly [string],
		attemptedBlocks: 1 as const,
		completeBlocks,
		incompleteBlocks,
		nonEvaluableBlocks,
		verifierPassedBlocks,
		eligibleColdFailures,
		warmRunsAttempted,
		warmRunsEvaluable,
		armResults,
		primaryComparison: {
			relevantAppliedPass,
			proposalOnlyPass,
			riskDifference,
			discordance,
		},
		secondaryComparisons,
		familyPassed,
		requests,
		steps: safeInteger(scorecard.steps, "campaignScorecard.steps", { min: 0, max: 384 }),
		attempts: safeInteger(scorecard.attempts, "campaignScorecard.attempts", {
			min: 0,
			max: 192,
		}),
		inputTokens: nullableTokens(scorecard.inputTokens, "campaignScorecard.inputTokens"),
		outputTokens: nullableTokens(scorecard.outputTokens, "campaignScorecard.outputTokens"),
		totalTokens: nullableTokens(scorecard.totalTokens, "campaignScorecard.totalTokens"),
		hostInputBytes: safeInteger(scorecard.hostInputBytes, "campaignScorecard.hostInputBytes", {
			min: 0,
		}),
		hostOutputBytes: safeInteger(scorecard.hostOutputBytes, "campaignScorecard.hostOutputBytes", {
			min: 0,
		}),
		latencyMs: safeInteger(scorecard.latencyMs, "campaignScorecard.latencyMs", {
			min: 0,
			max: 86_400_000,
		}),
		costMicrousd: safeInteger(scorecard.costMicrousd, "campaignScorecard.costMicrousd", {
			min: 0,
		}),
		costBasis,
		reservedInputTokens: safeInteger(
			scorecard.reservedInputTokens,
			"campaignScorecard.reservedInputTokens",
			{ min: 0 },
		),
		reservedOutputTokens: safeInteger(
			scorecard.reservedOutputTokens,
			"campaignScorecard.reservedOutputTokens",
			{ min: 0 },
		),
		status,
		issueCodes: validateCoordinateList(scorecard.issueCodes, "campaignScorecard.issueCodes"),
	});
}

function zeroOrOne(value: unknown, path: string): 0 | 1 {
	const validated = safeInteger(value, path, { min: 0, max: 1 });
	return validated as 0 | 1;
}
