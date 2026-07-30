import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import { empiricalStrictJsonDigest, safeInteger, strictSnapshot } from "./canonical.js";
import {
	type ClosedTaskProfileHostRunInputV1,
	runClosedTaskProfileHost,
} from "./closed-task-profile-host.js";
import {
	createEmpiricalCampaignScorecard,
	createEmpiricalTrialBlockObservation,
	type EmpiricalCampaignScorecardV2,
	type EmpiricalSmokeCostLedgerV1,
	type EmpiricalTrialBlockObservationV2,
} from "./empirical-smoke-evidence.js";
import {
	B112_MATCHED_BLOCK_MEMORY_REVISION,
	prepareB112MatchedBlockReflection,
} from "./matched-block-memory.js";
import {
	EMPIRICAL_MODEL_EXECUTION_SCHEMAS,
	type EmpiricalModelTurnEvidenceRefV1,
	type EmpiricalModelTurnOutcomeV1,
	type EmpiricalModelTurnPortV1,
	type EmpiricalModelTurnRequestV1,
	executeEmpiricalProtection,
	validateEmpiricalModelTurnRequest,
} from "./model-execution.js";
import {
	createOpenRouterResponsesEmpiricalBinding,
	OPENROUTER_RESPONSES_ISSUE_CODES,
	type OpenRouterResponsesByteTransportV1,
	type OpenRouterResponsesCredentialCapabilityV1,
	type OpenRouterResponsesMonotonicMeasurementV1,
	type OpenRouterResponsesTransportAdmissionV1,
} from "./openrouter-responses-model-turn.js";
import {
	calculateOpenRouterCostMicrousd,
	OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_FIRST_SMOKE_REQUEST_MODEL,
	OPENROUTER_FIRST_SMOKE_STANDARD_PRICING_MAX_INPUT_TOKENS,
	OPENROUTER_OFFICIAL_PRICING_REVISION,
	OPENROUTER_OFFICIAL_PRICING_SOURCE,
	OPENROUTER_PROVIDER_USAGE_REVISION,
	type OpenRouterRouteQualificationV1,
} from "./openrouter-route-qualification.js";
import {
	type PersistedPrivateSmokeGenerationV2,
	persistPrivateSmokeGeneration,
} from "./private-smoke-persistence.js";

export const OPENROUTER_API_KEY_ENVIRONMENT_NAME = "OPENROUTER_API_KEY";
export const B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION =
	"b112-first-task-smoke-single-observation.v1";
export const B112_SMOKE_BUDGET_ISSUE_CODE = "smoke-budget-exhausted";
export const B112_SMOKE_ADMISSION_REJECTION_SCHEMA = "b112-smoke-admission-rejection.v1";
export const B112_SMOKE_ADMISSION_REJECTION_REASONS = Object.freeze({
	pendingReservation: "pending-reservation",
	requestLimit: "request-limit",
	stepLimit: "step-limit",
	canonicalRequestBytes: "canonical-request-bytes",
	inputTokenReservation: "input-token-reservation",
	outputTokenReservation: "output-token-reservation",
	costReservation: "cost-reservation",
} as const);

type B112SmokeAdmissionRejectionReason =
	(typeof B112_SMOKE_ADMISSION_REJECTION_REASONS)[keyof typeof B112_SMOKE_ADMISSION_REJECTION_REASONS];

export interface B112SmokeAdmissionRejectionV1 {
	readonly schemaVersion: typeof B112_SMOKE_ADMISSION_REJECTION_SCHEMA;
	readonly requestRef: string;
	readonly reasons: readonly B112SmokeAdmissionRejectionReason[];
	readonly requests: number;
	readonly maxRequests: number;
	readonly maxStepsPerRun: number;
	readonly wireRequestBytes: number;
	readonly maxCanonicalRequestBytes: number;
	readonly reservedInputTokens: number;
	readonly prospectiveInputTokens: number;
	readonly maxInputTokens: number;
	readonly reservedOutputTokens: number;
	readonly prospectiveOutputTokens: number;
	readonly maxOutputTokens: number;
	readonly reservedCostMicrousd: number;
	readonly prospectiveCostMicrousd: number;
	readonly maxSmokeSpendMicrousd: number;
}

export interface OpenRouterFirstTaskSmokeResultV2 {
	readonly observation: EmpiricalTrialBlockObservationV2;
	readonly scorecard: EmpiricalCampaignScorecardV2;
	readonly persistence: PersistedPrivateSmokeGenerationV2;
	/**
	 * Bounded operator diagnostic only. It is intentionally excluded from the
	 * observation, scorecard, and private persisted generation.
	 */
	readonly admissionRejection: B112SmokeAdmissionRejectionV1 | null;
}

function assertFirstSmokeRoute(route: OpenRouterRouteQualificationV1): void {
	if (
		route.requestModel !== OPENROUTER_FIRST_SMOKE_REQUEST_MODEL ||
		route.downstreamProviderSlug !== OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_SLUG ||
		route.downstreamProviderName !== OPENROUTER_FIRST_SMOKE_DOWNSTREAM_PROVIDER_NAME ||
		route.pricing.sourceUrl !== OPENROUTER_OFFICIAL_PRICING_SOURCE ||
		route.pricing.pricingRevision !== OPENROUTER_OFFICIAL_PRICING_REVISION ||
		route.usageRevision !== OPENROUTER_PROVIDER_USAGE_REVISION ||
		route.pricing.inputMicrousdPerMillionTokens !== 6_250_000 ||
		route.pricing.outputMicrousdPerMillionTokens !== 30_000_000 ||
		route.budget.maxCanonicalRequestBytes * route.budget.inputTokensPerCanonicalByteUpperBound +
			route.budget.fixedInputTokenOverheadPerRequest >
			OPENROUTER_FIRST_SMOKE_STANDARD_PRICING_MAX_INPUT_TOKENS
	) {
		throw new TypeError("B112 first smoke route does not match its frozen exact route and pricing");
	}
	if (route.dispatchMode === "live-approved") {
		const liveCoordinates = [
			route.qualificationRef,
			route.qualificationRevision,
			route.budget.approvalRef,
			route.budget.approvalRevision,
			route.keySpendLimit.qualificationRef,
			route.keySpendLimit.qualificationRevision,
			route.sharedCapacityQualification.qualificationRef,
			route.sharedCapacityQualification.qualificationRevision,
			route.sharedCapacityQualification.workspaceRef,
			route.sharedCapacityQualification.workspaceRevision,
		];
		if (liveCoordinates.some((value) => /pending|placeholder|simulated/i.test(value))) {
			throw new TypeError("live B112 route still contains unapproved qualification coordinates");
		}
	}
}

/**
 * Outermost operator-only loader. The caller supplies an environment snapshot;
 * neither the model-turn binding nor transport can discover ambient state.
 */
export function createOpenRouterCredentialCapabilityFromOperatorEnvironment(
	environment: Readonly<Record<string, string | undefined>>,
	routeQualification: OpenRouterRouteQualificationV1,
): OpenRouterResponsesCredentialCapabilityV1 {
	if (routeQualification.dispatchMode !== "live-approved") {
		throw new TypeError("OpenRouter credential construction requires a live-approved route");
	}
	const bearerToken = environment[OPENROUTER_API_KEY_ENVIRONMENT_NAME];
	if (typeof bearerToken !== "string" || bearerToken.length < 16 || bearerToken.length > 4_096) {
		throw new TypeError(`operator environment must provide ${OPENROUTER_API_KEY_ENVIRONMENT_NAME}`);
	}
	return Object.freeze({
		credentialBindingRef: routeQualification.sharedCapacityQualification.credentialBindingRef,
		credentialBindingRevision:
			routeQualification.sharedCapacityQualification.credentialBindingRevision,
		bearerToken,
	});
}

interface MutableSmokeBudget {
	requests: number;
	currentRunRequests: number;
	reservedInputTokens: number;
	reservedOutputTokens: number;
	reservedCostMicrousd: number;
	pendingReservedInputTokens: number;
	pendingReservedOutputTokens: number;
	pendingReservedCostMicrousd: number;
	unknownProviderUsageRequests: number;
	providerCostMicrousd: number;
	latencyMs: number;
	exhausted: boolean;
	admissionRejection: B112SmokeAdmissionRejectionV1 | null;
}

function budgetExhaustedOutcome(
	request: EmpiricalModelTurnRequestV1,
	protectionExecutor: ClosedTaskProfileHostRunInputV1["protectionExecutor"],
	usage: EmpiricalModelTurnOutcomeV1["usage"] = {
		source: request.usageSource,
		inputTokens: null,
		outputTokens: null,
		totalTokens: null,
		providerCostMicrousd: null,
		requests: 0,
		hostInputBytes: 0,
		hostOutputBytes: 0,
	},
	latencyMs = 0,
	evidenceRefs: readonly EmpiricalModelTurnEvidenceRefV1[] = [],
): EmpiricalModelTurnOutcomeV1 {
	const issueCodes = [B112_SMOKE_BUDGET_ISSUE_CODE];
	const protectedSubject = strictJsonCodec.decode(
		strictJsonCodec.encode({
			evidenceRefs,
			issueCodes,
			structuredOutput: null,
			toolIntents: [],
		}),
	) as StrictJsonValue;
	const protectionReceipt = executeEmpiricalProtection(protectionExecutor, {
		policyRef: request.protectionPolicyRef,
		policyRevision: request.protectionPolicyRevision,
		stage: "model-egress",
		subject: protectedSubject,
	}).receipt;
	return strictSnapshot({
		schemaVersion: EMPIRICAL_MODEL_EXECUTION_SCHEMAS.outcome,
		requestRef: request.requestRef,
		requestDigest: empiricalStrictJsonDigest(request),
		configurationRef: request.configurationRef,
		configurationDigest: request.configurationDigest,
		role: request.role,
		status: "non-evaluable" as const,
		finishReason: null,
		outputSchemaDigest: request.outputSchema.schemaDigest,
		structuredOutput: null,
		structuredOutputDigest: null,
		toolIntents: [],
		usage,
		latencyMs,
		issueCodes,
		evidenceRefs,
		protectionReceipt,
	});
}

function createBudgetedModelTurnPort(
	delegate: EmpiricalModelTurnPortV1,
	route: OpenRouterRouteQualificationV1,
	protectionExecutor: ClosedTaskProfileHostRunInputV1["protectionExecutor"],
	ledger: MutableSmokeBudget,
): EmpiricalModelTurnPortV1 {
	return Object.freeze({
		async invoke(request: EmpiricalModelTurnRequestV1, signal: AbortSignal) {
			const outcome = await delegate.invoke(request, signal);
			if (
				ledger.exhausted &&
				outcome.issueCodes.includes(OPENROUTER_RESPONSES_ISSUE_CODES.transportAdmissionRejected)
			) {
				return budgetExhaustedOutcome(request, protectionExecutor);
			}
			const hasPendingReservation =
				ledger.pendingReservedInputTokens > 0 || ledger.pendingReservedOutputTokens > 0;
			if (
				hasPendingReservation &&
				outcome.usage.inputTokens !== null &&
				outcome.usage.outputTokens !== null &&
				outcome.usage.providerCostMicrousd !== null
			) {
				ledger.reservedInputTokens =
					ledger.reservedInputTokens -
					ledger.pendingReservedInputTokens +
					outcome.usage.inputTokens;
				ledger.reservedOutputTokens =
					ledger.reservedOutputTokens -
					ledger.pendingReservedOutputTokens +
					outcome.usage.outputTokens;
				ledger.reservedCostMicrousd =
					ledger.reservedCostMicrousd -
					ledger.pendingReservedCostMicrousd +
					outcome.usage.providerCostMicrousd;
				ledger.providerCostMicrousd += outcome.usage.providerCostMicrousd;
			} else if (hasPendingReservation) {
				ledger.unknownProviderUsageRequests += 1;
			}
			ledger.pendingReservedInputTokens = 0;
			ledger.pendingReservedOutputTokens = 0;
			ledger.pendingReservedCostMicrousd = 0;
			ledger.latencyMs += outcome.latencyMs;
			if (
				ledger.latencyMs > route.budget.maxLatencyMs ||
				ledger.reservedInputTokens > route.budget.maxInputTokens ||
				ledger.reservedOutputTokens > route.budget.maxOutputTokens ||
				ledger.reservedCostMicrousd > route.budget.maxSmokeSpendMicrousd
			) {
				ledger.exhausted = true;
				return budgetExhaustedOutcome(
					request,
					protectionExecutor,
					outcome.usage,
					outcome.latencyMs,
					outcome.evidenceRefs,
				);
			}
			return outcome;
		},
	});
}

function createSmokeTransportAdmission(
	route: OpenRouterRouteQualificationV1,
	ledger: MutableSmokeBudget,
): OpenRouterResponsesTransportAdmissionV1 {
	return Object.freeze({
		admit(input: Parameters<OpenRouterResponsesTransportAdmissionV1["admit"]>[0]) {
			const wireRequestBytes = safeInteger(input.wireRequestBytes, "smoke.wireRequestBytes", {
				min: 1,
			});
			const maxOutputTokens = safeInteger(input.maxOutputTokens, "smoke.maxOutputTokens", {
				min: 1,
			});
			const reservedInputTokens =
				wireRequestBytes * route.budget.inputTokensPerCanonicalByteUpperBound +
				route.budget.fixedInputTokenOverheadPerRequest;
			const prospectiveInputTokens = ledger.reservedInputTokens + reservedInputTokens;
			const prospectiveOutputTokens = ledger.reservedOutputTokens + maxOutputTokens;
			const reservedCostMicrousd = calculateOpenRouterCostMicrousd(
				reservedInputTokens,
				maxOutputTokens,
				route.pricing,
			);
			const prospectiveCost = ledger.reservedCostMicrousd + reservedCostMicrousd;
			const reasons: B112SmokeAdmissionRejectionReason[] = [];
			if (ledger.pendingReservedInputTokens > 0 || ledger.pendingReservedOutputTokens > 0) {
				reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.pendingReservation);
			}
			if (ledger.requests >= route.budget.maxRequests) {
				reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.requestLimit);
			}
			if (ledger.currentRunRequests >= route.budget.maxStepsPerRun) {
				reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.stepLimit);
			}
			if (wireRequestBytes > route.budget.maxCanonicalRequestBytes) {
				reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.canonicalRequestBytes);
			}
			if (prospectiveInputTokens > route.budget.maxInputTokens) {
				reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.inputTokenReservation);
			}
			if (prospectiveOutputTokens > route.budget.maxOutputTokens) {
				reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.outputTokenReservation);
			}
			if (prospectiveCost > route.budget.maxSmokeSpendMicrousd) {
				reasons.push(B112_SMOKE_ADMISSION_REJECTION_REASONS.costReservation);
			}
			if (reasons.length > 0) {
				ledger.exhausted = true;
				ledger.admissionRejection = strictSnapshot({
					schemaVersion: B112_SMOKE_ADMISSION_REJECTION_SCHEMA,
					requestRef: input.requestRef,
					reasons,
					requests: ledger.requests,
					maxRequests: route.budget.maxRequests,
					maxStepsPerRun: route.budget.maxStepsPerRun,
					wireRequestBytes,
					maxCanonicalRequestBytes: route.budget.maxCanonicalRequestBytes,
					reservedInputTokens: ledger.reservedInputTokens,
					prospectiveInputTokens,
					maxInputTokens: route.budget.maxInputTokens,
					reservedOutputTokens: ledger.reservedOutputTokens,
					prospectiveOutputTokens,
					maxOutputTokens: route.budget.maxOutputTokens,
					reservedCostMicrousd: ledger.reservedCostMicrousd,
					prospectiveCostMicrousd: prospectiveCost,
					maxSmokeSpendMicrousd: route.budget.maxSmokeSpendMicrousd,
				});
				return false;
			}
			ledger.requests += 1;
			ledger.currentRunRequests += 1;
			ledger.reservedInputTokens = prospectiveInputTokens;
			ledger.reservedOutputTokens = prospectiveOutputTokens;
			ledger.reservedCostMicrousd = prospectiveCost;
			ledger.pendingReservedInputTokens = reservedInputTokens;
			ledger.pendingReservedOutputTokens = maxOutputTokens;
			ledger.pendingReservedCostMicrousd = reservedCostMicrousd;
			return true;
		},
	});
}

interface SmokeBudgetSnapshot {
	readonly requests: number;
	readonly reservedInputTokens: number;
	readonly reservedOutputTokens: number;
	readonly reservedCostMicrousd: number;
	readonly providerCostMicrousd: number;
	readonly unknownProviderUsageRequests: number;
	readonly latencyMs: number;
}

function smokeBudgetSnapshot(ledger: MutableSmokeBudget): SmokeBudgetSnapshot {
	return Object.freeze({
		requests: ledger.requests,
		reservedInputTokens: ledger.reservedInputTokens,
		reservedOutputTokens: ledger.reservedOutputTokens,
		reservedCostMicrousd: ledger.reservedCostMicrousd,
		providerCostMicrousd: ledger.providerCostMicrousd,
		unknownProviderUsageRequests: ledger.unknownProviderUsageRequests,
		latencyMs: ledger.latencyMs,
	});
}

function runCostLedger(
	before: SmokeBudgetSnapshot,
	after: SmokeBudgetSnapshot,
	executionClass: "simulated-contract" | "live-provider",
): EmpiricalSmokeCostLedgerV1 {
	const requests = after.requests - before.requests;
	const reservedInputTokens = after.reservedInputTokens - before.reservedInputTokens;
	const reservedOutputTokens = after.reservedOutputTokens - before.reservedOutputTokens;
	const providerCostMicrousd = after.providerCostMicrousd - before.providerCostMicrousd;
	const reservedCostMicrousd = after.reservedCostMicrousd - before.reservedCostMicrousd;
	const providerUsageKnown =
		requests > 0 && after.unknownProviderUsageRequests === before.unknownProviderUsageRequests;
	return Object.freeze({
		costBasis:
			executionClass === "simulated-contract"
				? "simulated-contract"
				: providerUsageKnown
					? "provider-usage"
					: "conservative-reservation",
		reservedInputTokens,
		reservedOutputTokens,
		costMicrousd:
			executionClass === "simulated-contract"
				? 0
				: providerUsageKnown
					? providerCostMicrousd
					: reservedCostMicrousd,
	});
}

function createPerRunSignal(signal: AbortSignal, maxElapsedMs: number): AbortSignal {
	return AbortSignal.any([signal, AbortSignal.timeout(maxElapsedMs)]);
}

function createWarmInitialRequest(input: {
	readonly cold: EmpiricalModelTurnRequestV1;
	readonly runIndex: number;
	readonly branchKind: NonNullable<
		ReturnType<typeof prepareB112MatchedBlockReflection>["branches"][number]
	>["branchKind"];
	readonly actorMemoryContext: {
		readonly recordDigest: string;
		readonly text: string;
	} | null;
	readonly protectionExecutor: ClosedTaskProfileHostRunInputV1["protectionExecutor"];
	readonly host: Omit<
		ClosedTaskProfileHostRunInputV1,
		"modelTurnPort" | "protectionExecutor" | "signal"
	>;
}): EmpiricalModelTurnRequestV1 {
	const baseInput = input.cold.structuredInput;
	if (baseInput === null || typeof baseInput !== "object" || Array.isArray(baseInput)) {
		throw new TypeError("B112 matched warm input requires the frozen structured object input");
	}
	const structuredInput = strictSnapshot({
		...baseInput,
		...(input.actorMemoryContext === null
			? {}
			: {
					memoryContext: {
						kind: "agentic-memory-context",
						revision: B112_MATCHED_BLOCK_MEMORY_REVISION,
						recordDigest: input.actorMemoryContext.recordDigest,
						text: input.actorMemoryContext.text,
					},
				}),
	});
	const inputProtectionReceipt = executeEmpiricalProtection(input.protectionExecutor, {
		policyRef: input.cold.protectionPolicyRef,
		policyRevision: input.cold.protectionPolicyRevision,
		stage: "source-ingress",
		subject: structuredInput,
	}).receipt;
	return validateEmpiricalModelTurnRequest(
		{
			...input.cold,
			requestRef: `b112-first-task-live-smoke-run-${input.runIndex}-request-1`,
			trialStage: input.branchKind,
			stepIndex: 0,
			structuredInput,
			structuredInputDigest: empiricalStrictJsonDigest(structuredInput),
			inputProtectionReceipt,
			priorToolResults: [],
		},
		input.host.frozen,
		input.host.qualificationReport,
	);
}

export interface OpenRouterFirstTaskWarmHostFactoryInputV1 {
	readonly initialRequest: EmpiricalModelTurnRequestV1;
	readonly signal: AbortSignal;
}

export type OpenRouterFirstTaskWarmHostFactoryV1 = (
	input: OpenRouterFirstTaskWarmHostFactoryInputV1,
) => Promise<ClosedTaskProfileHostRunInputV1["materialization"]>;

/**
 * Executes exactly the preregistered first task as one cold attempted smoke
 * block. When a fresh-host factory is supplied, a verified cold failure fans
 * into D639's exact five serial warm branches under one monotonic block ledger.
 * It emits no efficacy claim and never auto-runs calibration work.
 */
export async function runOpenRouterFirstTaskSmoke(input: {
	readonly host: Omit<
		ClosedTaskProfileHostRunInputV1,
		"modelTurnPort" | "protectionExecutor" | "signal"
	>;
	readonly routeQualification: OpenRouterRouteQualificationV1;
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly monotonicMeasurement: OpenRouterResponsesMonotonicMeasurementV1;
	readonly executionClass: "simulated-contract" | "live-provider";
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly signal: AbortSignal;
	readonly prepareWarmHost?: OpenRouterFirstTaskWarmHostFactoryV1;
}): Promise<OpenRouterFirstTaskSmokeResultV2> {
	const trialPlan = input.host.frozen.manifest.trialPlan;
	if (
		trialPlan.profile !== "smoke" ||
		input.host.initialRequest.taskRef !== trialPlan.activeTaskRefs[0] ||
		input.host.initialRequest.trialStage !== "cold"
	) {
		throw new TypeError("OpenRouter smoke runner accepts only the preregistered first cold task");
	}
	if (
		(input.executionClass === "live-provider") !==
		(input.routeQualification.dispatchMode === "live-approved")
	) {
		throw new TypeError("OpenRouter smoke execution class does not match route dispatch approval");
	}
	assertFirstSmokeRoute(input.routeQualification);
	if (
		input.routeQualification.campaignRef !== input.host.frozen.manifest.campaignRef ||
		input.routeQualification.manifestDigest !== input.host.frozen.manifestDigest ||
		input.routeQualification.trialBlockRef !== input.host.initialRequest.trialBlockRef ||
		input.routeQualification.trialBlockDigest !== input.host.initialRequest.trialBlockDigest
	) {
		throw new TypeError("OpenRouter smoke route does not qualify this frozen trial block");
	}
	const manifestBudgets = input.host.frozen.manifest.budgets;
	if (
		input.routeQualification.budget.maxRequests >
			Math.min(manifestBudgets.campaign.maxRequests, manifestBudgets.taskModel.maxRequests) ||
		input.routeQualification.budget.maxStepsPerRun >
			Math.min(manifestBudgets.agentRun.maxSteps, manifestBudgets.agentRun.maxRequests) ||
		input.routeQualification.budget.maxSmokeSpendMicrousd >
			Math.min(
				manifestBudgets.campaign.maxCostMicrousd,
				manifestBudgets.taskModel.maxCostMicrousd,
			) ||
		input.routeQualification.budget.maxLatencyMs > manifestBudgets.campaign.maxElapsedMs
	) {
		throw new TypeError("OpenRouter route budget exceeds the frozen D652 host budget");
	}
	safeInteger(input.routeQualification.budget.maxLatencyMs, "smoke.maxLatencyMs", {
		min: 1,
	});
	const ledger: MutableSmokeBudget = {
		requests: 0,
		currentRunRequests: 0,
		reservedInputTokens: 0,
		reservedOutputTokens: 0,
		reservedCostMicrousd: 0,
		pendingReservedInputTokens: 0,
		pendingReservedOutputTokens: 0,
		pendingReservedCostMicrousd: 0,
		unknownProviderUsageRequests: 0,
		providerCostMicrousd: 0,
		latencyMs: 0,
		exhausted: false,
		admissionRejection: null,
	};
	const binding = createOpenRouterResponsesEmpiricalBinding({
		frozen: input.host.frozen,
		qualificationReport: input.host.qualificationReport,
		configurationRef: input.host.initialRequest.configurationRef,
		routeQualification: input.routeQualification,
		credential: input.credential,
		transport: input.transport,
		transportAdmission: createSmokeTransportAdmission(input.routeQualification, ledger),
		monotonicMeasurement: input.monotonicMeasurement,
	});
	const route = Object.freeze({
		qualification: input.routeQualification,
		qualificationDigest: binding.routeQualificationDigest,
	});
	const warmBranches: {
		readonly branchKind: (typeof input.host.frozen.manifest.trialPlan.branchOrder)[number];
		readonly lifecycle: NonNullable<typeof reflection>["branches"][number]["lifecycle"] | null;
		readonly run: {
			readonly runRef: string;
			readonly hostOutcome: Awaited<ReturnType<typeof runClosedTaskProfileHost>>;
			readonly costLedger: EmpiricalSmokeCostLedgerV1;
		} | null;
		readonly issueCodes: readonly string[];
	}[] = [];
	ledger.currentRunRequests = 0;
	const coldBudgetBefore = smokeBudgetSnapshot(ledger);
	const outcome = await runClosedTaskProfileHost({
		...input.host,
		modelTurnPort: createBudgetedModelTurnPort(
			binding.modelTurnPort,
			input.routeQualification,
			binding.protectionExecutor,
			ledger,
		),
		protectionExecutor: binding.protectionExecutor,
		signal: createPerRunSignal(input.signal, manifestBudgets.agentRun.maxElapsedMs),
	});
	const coldBudgetAfter = smokeBudgetSnapshot(ledger);
	const coldCostLedger = runCostLedger(coldBudgetBefore, coldBudgetAfter, input.executionClass);
	const rerunEligible = outcome.status === "completed" && outcome.verifierVerdict === "failed";
	const reflection =
		rerunEligible && input.prepareWarmHost !== undefined
			? prepareB112MatchedBlockReflection({
					coldRequest: input.host.initialRequest,
					coldOutcome: outcome,
				})
			: null;
	const createObservation = () =>
		createEmpiricalTrialBlockObservation({
			frozen: input.host.frozen,
			route,
			cold: {
				runRef: "cold",
				hostOutcome: outcome,
				costLedger: coldCostLedger,
			},
			...(reflection === null
				? {}
				: {
						reflection: {
							evidenceDigest: reflection.evidenceDigest,
							candidateRecordDigests: reflection.candidateRecordDigests,
							issueCodes: reflection.issueCodes,
						},
						warmBranches,
					}),
			executionClass: input.executionClass,
			trialBlockRef: input.host.initialRequest.trialBlockRef,
			trialBlockDigest: input.host.initialRequest.trialBlockDigest,
		});
	let warmPreparationFailed = false;
	if (reflection !== null && input.prepareWarmHost !== undefined) {
		for (let index = 0; index < reflection.branches.length; index += 1) {
			const branch = reflection.branches[index];
			if (branch === undefined) throw new TypeError("B112 warm branch order is incomplete");
			if (input.signal.aborted) {
				throw new DOMException("B112 matched block cancelled between serial arms", "AbortError");
			}
			if (ledger.exhausted) {
				warmBranches.push({
					branchKind: branch.branchKind,
					lifecycle: null,
					run: null,
					issueCodes: [B112_SMOKE_BUDGET_ISSUE_CODE, "warm-branch-not-attempted"].sort(),
				});
				continue;
			}
			if (warmPreparationFailed) {
				warmBranches.push({
					branchKind: branch.branchKind,
					lifecycle: null,
					run: null,
					issueCodes: ["warm-branch-not-attempted", "warm-host-preparation-failed"].sort(),
				});
				continue;
			}
			const warmSignal = createPerRunSignal(input.signal, manifestBudgets.agentRun.maxElapsedMs);
			const initialRequest = createWarmInitialRequest({
				cold: input.host.initialRequest,
				runIndex: index + 2,
				branchKind: branch.branchKind,
				actorMemoryContext: branch.actorMemoryContext,
				protectionExecutor: binding.protectionExecutor,
				host: input.host,
			});
			let warmMaterialization: Awaited<ReturnType<OpenRouterFirstTaskWarmHostFactoryV1>>;
			try {
				warmMaterialization = await input.prepareWarmHost({ initialRequest, signal: warmSignal });
			} catch {
				if (input.signal.aborted || warmSignal.aborted) {
					throw new DOMException(
						"B112 matched block cancelled during warm preparation",
						"AbortError",
					);
				}
				warmPreparationFailed = true;
				warmBranches.push({
					branchKind: branch.branchKind,
					lifecycle: null,
					run: null,
					issueCodes: ["warm-branch-not-attempted", "warm-host-preparation-failed"].sort(),
				});
				continue;
			}
			ledger.currentRunRequests = 0;
			const budgetBefore = smokeBudgetSnapshot(ledger);
			const warmOutcome = await runClosedTaskProfileHost({
				...input.host,
				initialRequest,
				materialization: warmMaterialization,
				modelTurnPort: createBudgetedModelTurnPort(
					binding.modelTurnPort,
					input.routeQualification,
					binding.protectionExecutor,
					ledger,
				),
				protectionExecutor: binding.protectionExecutor,
				signal: warmSignal,
			});
			const budgetAfter = smokeBudgetSnapshot(ledger);
			warmBranches.push({
				branchKind: branch.branchKind,
				lifecycle: branch.lifecycle,
				run: {
					runRef: `warm-${index + 1}`,
					hostOutcome: warmOutcome,
					costLedger: runCostLedger(budgetBefore, budgetAfter, input.executionClass),
				},
				issueCodes: [],
			});
		}
	}
	const observation = createObservation();
	const scorecard = createEmpiricalCampaignScorecard(
		observation,
		B112_FIRST_TASK_SMOKE_AGGREGATION_REVISION,
	);
	const persistence = await persistPrivateSmokeGeneration({
		privateRoot: input.privateRoot,
		generationRef: input.generationRef,
		observation,
		scorecard,
		protectionExecutor: binding.protectionExecutor,
	});
	return Object.freeze({
		observation,
		scorecard,
		persistence,
		admissionRejection: ledger.admissionRejection,
	});
}
