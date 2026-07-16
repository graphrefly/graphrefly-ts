/** Focused ClickHouse trusted-query production-evaluation contracts and runtime glue (D628). */
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../identity.js";
import type { Node } from "../node/node.js";
import type {
	AgentRequestStatusChanged,
	AgentRuntimeAuditRecord,
	ExecutorOutcome,
	SourceRef,
	ToolProviderAdapterInput,
	ToolProviderAdapterRunRequested,
	ToolProviderAdapterRunStatus,
	ToolProviderExecutionPolicy,
} from "../orchestration/index.js";
import type {
	ProductionCandidatePins,
	ProductionEvaluationCampaignRevision,
	ProductionEvaluationRef,
	ProductionEvaluationScenarioPin,
	ProductionEvaluationScope,
	ProductionScenarioResult,
} from "./production-evaluation-contracts.js";
import {
	productionEvaluationCanonical,
	productionEvaluationSnapshot,
	validateProductionEvaluationValue,
} from "./production-evaluation-contracts.js";

export const CLICKHOUSE_TRUSTED_QUERY_EVALUATION_CONTRACT_VERSION = "1" as const;
export const CLICKHOUSE_TRUSTED_QUERY_ADAPTER_ID = "clickhouse-trusted-query-adapter" as const;
export const CLICKHOUSE_TRUSTED_QUERY_PROFILE_KIND =
	"clickhouse-trusted-query-evaluation-profile" as const;
export const CLICKHOUSE_TRUSTED_QUERY_PROVIDER_ID = "clickhouse-trusted-query" as const;
export const CLICKHOUSE_TRUSTED_QUERY_TOOL_NAME = "clickhouse.trusted-query.evaluate" as const;
export const CLICKHOUSE_TRUSTED_QUERY_OPERATION = "evaluate-pinned-scenario" as const;

export interface ClickHouseTrustedQueryEvaluationProfile {
	readonly kind: typeof CLICKHOUSE_TRUSTED_QUERY_PROFILE_KIND;
	readonly contractVersion: typeof CLICKHOUSE_TRUSTED_QUERY_EVALUATION_CONTRACT_VERSION;
	readonly scope: ProductionEvaluationScope;
	readonly campaign: ProductionEvaluationRef;
	readonly previousCampaignRevision: string | null;
	readonly candidate: ProductionCandidatePins;
	readonly scenarioPack: ProductionEvaluationRef;
	readonly criteria: ProductionEvaluationRef;
	readonly scenarios: readonly ProductionEvaluationScenarioPin[];
	readonly environmentRefs: readonly ProductionEvaluationRef[];
	readonly dataRefs: readonly ProductionEvaluationRef[];
	readonly sourceRefs: readonly ProductionEvaluationRef[];
	readonly schemaRefs: readonly ProductionEvaluationRef[];
	readonly policyRefs: readonly ProductionEvaluationRef[];
	readonly queryPlanRefs: readonly ProductionEvaluationRef[];
	readonly createdBy: string;
	readonly createdAtMs: number;
}

export interface ClickHouseTrustedQueryScenarioResultInput {
	readonly kind: "clickhouse-trusted-query-scenario-result-input";
	readonly profile: ClickHouseTrustedQueryEvaluationProfile;
	readonly scenario: ProductionEvaluationRef;
	readonly resultId: string;
	readonly requestId: string;
	readonly admissionId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly outcomeId: string;
	readonly evidenceId: string;
	readonly evidenceHighWater: number;
	readonly outcome: ProductionScenarioResult["outcome"];
	readonly measurements: Readonly<Record<string, number>>;
	readonly evidenceRefs: readonly ProductionEvaluationRef[];
	readonly recordedAtMs: number;
}

/** Coordinate-only arguments. The host resolves SQL, clients, credentials, and raw results. */
export interface ClickHouseTrustedQueryExecutionArguments {
	readonly contractVersion: typeof CLICKHOUSE_TRUSTED_QUERY_EVALUATION_CONTRACT_VERSION;
	readonly profile: ClickHouseTrustedQueryEvaluationProfile;
	readonly scenario: ProductionEvaluationRef;
	readonly queryPlan: ProductionEvaluationRef;
	readonly source: ProductionEvaluationRef;
	readonly schema: ProductionEvaluationRef;
	readonly policy: ProductionEvaluationRef;
}

export interface ClickHouseTrustedQueryAdapterInputCoordinates {
	readonly requestId: string;
	readonly operationId: string;
	readonly effectRunId: string;
	readonly routeId: string;
	readonly executorId: string;
	readonly profileId: string;
	readonly arguments: ClickHouseTrustedQueryExecutionArguments;
	readonly approval: {
		readonly policyId: string;
		readonly mode: "auto" | "require" | "never";
	};
}

export interface ClickHouseTrustedQueryHostExecutionRequest {
	readonly profile: Readonly<ClickHouseTrustedQueryEvaluationProfile>;
	readonly scenario: ProductionEvaluationRef;
	readonly queryPlan: ProductionEvaluationRef;
	readonly source: ProductionEvaluationRef;
	readonly schema: ProductionEvaluationRef;
	readonly policy: ProductionEvaluationRef;
	readonly requestId: string;
	readonly admissionId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly signal: AbortSignal;
}

export interface ClickHouseTrustedQueryHostSettlement {
	readonly kind: "clickhouse-trusted-query-host-settlement";
	readonly measurements: Readonly<Record<string, number>>;
	readonly evidenceId: string;
	readonly evidenceHighWater: number;
	readonly evidenceRefs: readonly ProductionEvaluationRef[];
	readonly recordedAtMs: number;
}

export interface ClickHouseTrustedQueryHostCapability {
	execute(
		request: ClickHouseTrustedQueryHostExecutionRequest,
	): ClickHouseTrustedQueryHostSettlement | PromiseLike<ClickHouseTrustedQueryHostSettlement>;
}

export type ClickHouseTrustedQueryFailureKind =
	| "capability-unavailable"
	| "authentication"
	| "authorization"
	| "connectivity"
	| "schema-drift"
	| "incompatible-plan"
	| "resource-limit"
	| "malformed-settlement";

export interface ClickHouseTrustedQueryHostError extends Error {
	readonly kind?: ClickHouseTrustedQueryFailureKind;
}

export interface ClickHouseTrustedQueryCancellationRequested {
	readonly kind: "clickhouse-trusted-query-cancellation-requested";
	readonly cancellationId: string;
	readonly admissionId: string;
	readonly runId: string;
	readonly adapterInputId: string;
	readonly requestId: string;
	readonly operationId: string;
	readonly attempt: number;
	readonly sourceRefs?: readonly SourceRef[];
}

export interface ClickHouseTrustedQueryCancellationProposal
	extends Omit<ClickHouseTrustedQueryCancellationRequested, "kind"> {
	readonly kind: "clickhouse-trusted-query-cancellation-proposal";
	readonly proposalId: string;
}

export interface ClickHouseTrustedQueryCancellationDecision {
	readonly kind: "clickhouse-trusted-query-cancellation-decision";
	readonly decisionId: string;
	readonly proposalId: string;
	readonly outcome: "admit" | "block";
	readonly sourceRefs?: readonly SourceRef[];
}

export interface ClickHouseTrustedQueryCancellationAdmission {
	readonly kind: "clickhouse-trusted-query-cancellation-admission";
	readonly admissionId: string;
	readonly proposalId: string;
	readonly decisionId: string;
	readonly cancellationId: string;
	readonly runId: string;
	readonly state: "admitted" | "blocked";
	readonly sourceRefs?: readonly SourceRef[];
}

export interface ClickHouseTrustedQueryRuntimeOptions {
	readonly name?: string;
	readonly inputs: Node<ToolProviderAdapterInput<ClickHouseTrustedQueryExecutionArguments>>;
	/** Must be the approved output of the ordinary D419 admission projector. */
	readonly admittedRunRequests: readonly Node<ToolProviderAdapterRunRequested>[];
	readonly cancellationRequests?: readonly Node<ClickHouseTrustedQueryCancellationRequested>[];
	readonly cancellationDecisions?: readonly Node<ClickHouseTrustedQueryCancellationDecision>[];
	readonly capability: ClickHouseTrustedQueryHostCapability;
	readonly timeoutMs?: number;
	readonly now?: () => number;
}

export interface ClickHouseTrustedQueryRuntimeBundle {
	readonly outcomes: Node<ExecutorOutcome<ClickHouseTrustedQueryHostSettlement>>;
	readonly runStatus: Node<ToolProviderAdapterRunStatus>;
	readonly status: Node<AgentRequestStatusChanged>;
	readonly issues: Node<DataIssue>;
	readonly audit: Node<AgentRuntimeAuditRecord>;
	readonly cancellationProposals: Node<ClickHouseTrustedQueryCancellationProposal>;
	readonly cancellationAdmissions: Node<ClickHouseTrustedQueryCancellationAdmission>;
	dispose(): Promise<void>;
}

export interface ClickHouseTrustedQueryScenarioResultFromOutcomeInput {
	readonly arguments: ClickHouseTrustedQueryExecutionArguments;
	readonly resultId: string;
	readonly outcome: ExecutorOutcome<ClickHouseTrustedQueryHostSettlement>;
}
const PRIVATE_MATERIAL =
	/\b(password|secret|bearer|private[-_]?key|access[-_]?key|connection[-_]?string|dsn)\b|=/i;
const RAW_SQL_MATERIAL =
	/\b(select|with|insert|update|delete|alter|drop|create|truncate|optimize|explain)\b[\s\S]*\b(from|into|table|view|database|where|join|values|set)\b/i;
const SQL_STATEMENT_MATERIAL =
	/(^|[\s;])(select|with|insert|update|delete|alter|drop|create|truncate|optimize|explain|show|describe|desc|system|use|grant|revoke|attach|detach|rename|exchange|kill|watch|check|backup|restore|set)\b/i;
const CURSOR_MATERIAL = /cursor/i;
const PROFILE_KEYS = [
	"kind",
	"contractVersion",
	"scope",
	"campaign",
	"previousCampaignRevision",
	"candidate",
	"scenarioPack",
	"criteria",
	"scenarios",
	"environmentRefs",
	"dataRefs",
	"sourceRefs",
	"schemaRefs",
	"policyRefs",
	"queryPlanRefs",
	"createdBy",
	"createdAtMs",
] as const;
const RESULT_INPUT_KEYS = [
	"kind",
	"profile",
	"scenario",
	"resultId",
	"requestId",
	"admissionId",
	"runId",
	"attempt",
	"outcomeId",
	"evidenceId",
	"evidenceHighWater",
	"outcome",
	"measurements",
	"evidenceRefs",
	"recordedAtMs",
] as const;
const RESULT_PUBLIC_TOKEN_KEYS = [
	"resultId",
	"requestId",
	"admissionId",
	"runId",
	"outcomeId",
	"evidenceId",
] as const;
const REF_KEYS = ["id", "revision"] as const;
const SCOPE_KEYS = ["tenantId", "workspaceId"] as const;
const CANDIDATE_KEYS = ["adapter", "configurationFingerprint", "runtime"] as const;
const SCENARIO_KEYS = ["dependencyIds", "revision", "scenarioId"] as const;

function onlyKeys(value: object, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function publicToken(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 512 &&
		value.trim() === value &&
		!value.includes("://") &&
		!PRIVATE_MATERIAL.test(value) &&
		!RAW_SQL_MATERIAL.test(value) &&
		!SQL_STATEMENT_MATERIAL.test(value) &&
		![...value].some((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 32 || code === 127;
		})
	);
}

function publicRef(value: unknown): value is ProductionEvaluationRef {
	return (
		!!value &&
		typeof value === "object" &&
		onlyKeys(value, REF_KEYS) &&
		publicToken((value as ProductionEvaluationRef).id) &&
		publicToken((value as ProductionEvaluationRef).revision)
	);
}

function denseArray(value: unknown): value is readonly unknown[] {
	if (!Array.isArray(value)) return false;
	for (let index = 0; index < value.length; index++) {
		if (!Object.hasOwn(value, index)) return false;
	}
	return true;
}

function publicRefs(value: unknown): value is readonly ProductionEvaluationRef[] {
	return denseArray(value) && value.length > 0 && value.every(publicRef);
}

function publicScope(value: unknown): value is ProductionEvaluationScope {
	return (
		!!value &&
		typeof value === "object" &&
		onlyKeys(value, SCOPE_KEYS) &&
		publicToken((value as ProductionEvaluationScope).tenantId) &&
		publicToken((value as ProductionEvaluationScope).workspaceId)
	);
}

function publicCandidate(value: unknown): value is ProductionCandidatePins {
	return (
		!!value &&
		typeof value === "object" &&
		onlyKeys(value, CANDIDATE_KEYS) &&
		publicRef((value as ProductionCandidatePins).adapter) &&
		(value as ProductionCandidatePins).adapter.id === CLICKHOUSE_TRUSTED_QUERY_ADAPTER_ID &&
		publicRef((value as ProductionCandidatePins).runtime) &&
		publicToken((value as ProductionCandidatePins).configurationFingerprint)
	);
}

function publicScenarioPins(value: unknown): value is readonly ProductionEvaluationScenarioPin[] {
	if (!denseArray(value) || value.length === 0 || value.length > 64) return false;
	const ids = new Set(
		value.map((scenario) => (scenario as Partial<ProductionEvaluationScenarioPin>)?.scenarioId),
	);
	if (ids.size !== value.length) return false;
	const scenarios = value as readonly ProductionEvaluationScenarioPin[];
	const validPins = scenarios.every(
		(scenario) =>
			scenario &&
			typeof scenario === "object" &&
			onlyKeys(scenario, SCENARIO_KEYS) &&
			publicToken((scenario as ProductionEvaluationScenarioPin).scenarioId) &&
			publicToken((scenario as ProductionEvaluationScenarioPin).revision) &&
			denseArray((scenario as ProductionEvaluationScenarioPin).dependencyIds) &&
			new Set((scenario as ProductionEvaluationScenarioPin).dependencyIds).size ===
				(scenario as ProductionEvaluationScenarioPin).dependencyIds.length &&
			(scenario as ProductionEvaluationScenarioPin).dependencyIds.every(
				(id) =>
					publicToken(id) &&
					ids.has(id) &&
					id !== (scenario as ProductionEvaluationScenarioPin).scenarioId,
			),
	);
	if (!validPins) return false;
	const byId = new Map(scenarios.map((scenario) => [scenario.scenarioId, scenario]));
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const hasCycle = (scenarioId: string): boolean => {
		if (visiting.has(scenarioId)) return true;
		if (visited.has(scenarioId)) return false;
		visiting.add(scenarioId);
		for (const dependencyId of byId.get(scenarioId)?.dependencyIds ?? []) {
			if (hasCycle(dependencyId)) return true;
		}
		visiting.delete(scenarioId);
		visited.add(scenarioId);
		return false;
	};
	return scenarios.every((scenario) => !hasCycle(scenario.scenarioId));
}
function publicMeasurements(value: unknown): value is Readonly<Record<string, number>> {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.entries(value).every(
			([key, entry]) =>
				publicToken(key) &&
				!CURSOR_MATERIAL.test(key) &&
				typeof entry === "number" &&
				Number.isFinite(entry),
		)
	);
}

export function isClickHouseTrustedQueryCandidate(
	value: unknown,
): value is ProductionCandidatePins {
	try {
		return publicCandidate(productionEvaluationSnapshot(value));
	} catch {
		return false;
	}
}

export function validateClickHouseTrustedQueryEvaluationProfile(
	value: ClickHouseTrustedQueryEvaluationProfile,
): Readonly<ClickHouseTrustedQueryEvaluationProfile> {
	const profile = productionEvaluationSnapshot(value);
	if (
		!profile ||
		typeof profile !== "object" ||
		!onlyKeys(profile, PROFILE_KEYS) ||
		profile.kind !== CLICKHOUSE_TRUSTED_QUERY_PROFILE_KIND ||
		profile.contractVersion !== CLICKHOUSE_TRUSTED_QUERY_EVALUATION_CONTRACT_VERSION ||
		!publicScope(profile.scope) ||
		!publicRef(profile.campaign) ||
		(profile.previousCampaignRevision !== null && !publicToken(profile.previousCampaignRevision)) ||
		!publicCandidate(profile.candidate) ||
		!publicRef(profile.scenarioPack) ||
		!publicRef(profile.criteria) ||
		!publicScenarioPins(profile.scenarios) ||
		!publicRefs(profile.environmentRefs) ||
		!publicRefs(profile.dataRefs) ||
		!publicRefs(profile.sourceRefs) ||
		!publicRefs(profile.schemaRefs) ||
		!publicRefs(profile.policyRefs) ||
		!publicRefs(profile.queryPlanRefs) ||
		!publicToken(profile.createdBy) ||
		!Number.isSafeInteger(profile.createdAtMs) ||
		profile.createdAtMs < 0
	)
		throw new TypeError("clickhouse-trusted-query-profile-invalid-or-private-material");
	return profile;
}

export function createClickHouseTrustedQueryCampaignRevision(
	value: ClickHouseTrustedQueryEvaluationProfile,
): Readonly<ProductionEvaluationCampaignRevision> {
	const profile = validateClickHouseTrustedQueryEvaluationProfile(value);
	return validateProductionEvaluationValue(
		{
			kind: "production-evaluation-campaign-revision",
			campaignId: profile.campaign.id,
			revision: profile.campaign.revision,
			previousRevision: profile.previousCampaignRevision,
			scope: profile.scope,
			candidate: profile.candidate,
			scenarioPack: profile.scenarioPack,
			criteria: profile.criteria,
			scenarios: profile.scenarios,
			environmentRefs: profile.environmentRefs,
			dataRefs: profile.dataRefs,
			sourceRefs: [...profile.sourceRefs, ...profile.queryPlanRefs],
			schemaRefs: profile.schemaRefs,
			policyRefs: profile.policyRefs,
			createdBy: profile.createdBy,
			createdAtMs: profile.createdAtMs,
		} satisfies ProductionEvaluationCampaignRevision,
		"production-evaluation-campaign-revision",
	);
}

export function createClickHouseTrustedQueryScenarioResult(
	value: ClickHouseTrustedQueryScenarioResultInput,
): Readonly<ProductionScenarioResult> {
	const input = productionEvaluationSnapshot(value);
	if (
		!input ||
		typeof input !== "object" ||
		!onlyKeys(input, RESULT_INPUT_KEYS) ||
		input.kind !== "clickhouse-trusted-query-scenario-result-input" ||
		!publicRef(input.scenario) ||
		!RESULT_PUBLIC_TOKEN_KEYS.every((key) => publicToken(input[key])) ||
		!publicMeasurements(input.measurements) ||
		!publicRefs(input.evidenceRefs)
	)
		throw new TypeError("clickhouse-trusted-query-result-invalid-or-private-material");
	const profile = validateClickHouseTrustedQueryEvaluationProfile(input.profile);
	const knownScenario = profile.scenarios.find(
		(scenario) =>
			scenario.scenarioId === input.scenario.id && scenario.revision === input.scenario.revision,
	);
	if (!knownScenario)
		throw new TypeError("clickhouse-trusted-query-scenario-not-pinned-by-campaign");
	return validateProductionEvaluationValue(
		{
			kind: "production-scenario-result",
			scope: profile.scope,
			campaignId: profile.campaign.id,
			campaignRevision: profile.campaign.revision,
			scenarioId: input.scenario.id,
			scenarioRevision: input.scenario.revision,
			resultId: input.resultId,
			candidate: profile.candidate,
			requestId: input.requestId,
			admissionId: input.admissionId,
			runId: input.runId,
			attempt: input.attempt,
			outcomeId: input.outcomeId,
			evidenceId: input.evidenceId,
			evidenceHighWater: input.evidenceHighWater,
			outcome: input.outcome,
			measurements: input.measurements,
			evidenceRefs: input.evidenceRefs,
			recordedAtMs: input.recordedAtMs,
		} satisfies ProductionScenarioResult,
		"production-scenario-result",
	);
}

/** Builds the exact, coordinate-only D419 adapter input for a pinned scenario. */
export function createClickHouseTrustedQueryAdapterInput(
	value: ClickHouseTrustedQueryAdapterInputCoordinates,
): Readonly<ToolProviderAdapterInput<ClickHouseTrustedQueryExecutionArguments>> {
	const input = productionEvaluationSnapshot(value);
	if (
		!input ||
		typeof input !== "object" ||
		![
			input.requestId,
			input.operationId,
			input.effectRunId,
			input.routeId,
			input.executorId,
			input.profileId,
		].every(publicToken)
	)
		throw new TypeError("clickhouse-trusted-query-adapter-input-invalid-or-private-material");
	const args = validateExecutionArguments(input.arguments);
	const executionFingerprint = clickHouseExecutionFingerprint(args);
	if (
		!input.approval ||
		typeof input.approval !== "object" ||
		!onlyKeys(input.approval, ["policyId", "mode"]) ||
		!publicToken(input.approval.policyId) ||
		!(["auto", "require", "never"] as const).includes(input.approval.mode)
	)
		throw new TypeError("clickhouse-trusted-query-adapter-input-invalid-approval");
	const approvalPolicy = Object.freeze({
		kind: "tool-provider-execution-policy",
		policyId: input.approval.policyId,
		providerId: CLICKHOUSE_TRUSTED_QUERY_PROVIDER_ID,
		profileIds: Object.freeze([input.profileId]),
		toolNames: Object.freeze([CLICKHOUSE_TRUSTED_QUERY_TOOL_NAME]),
		operations: Object.freeze([CLICKHOUSE_TRUSTED_QUERY_OPERATION]),
		approval: Object.freeze({
			mode: input.approval.mode,
			sourceRefs: toSourceRefs("clickhouse-policy", [args.policy]),
		}),
		sourceRefs: toSourceRefs("clickhouse-policy", [args.policy]),
	}) satisfies ToolProviderExecutionPolicy;
	return productionEvaluationSnapshot({
		kind: "tool-provider-adapter-input",
		adapterInputId: compoundTupleKey("clickhouse-trusted-query-adapter-input", [
			input.requestId,
			input.operationId,
			input.effectRunId,
			executionFingerprint,
		]),
		status: "ready",
		requestId: input.requestId,
		operationId: input.operationId,
		effectRunId: input.effectRunId,
		routeId: input.routeId,
		providerId: CLICKHOUSE_TRUSTED_QUERY_PROVIDER_ID,
		executorId: input.executorId,
		profileId: input.profileId,
		toolName: CLICKHOUSE_TRUSTED_QUERY_TOOL_NAME,
		operation: CLICKHOUSE_TRUSTED_QUERY_OPERATION,
		toolCall: {
			kind: "tool-call",
			toolName: CLICKHOUSE_TRUSTED_QUERY_TOOL_NAME,
			operation: CLICKHOUSE_TRUSTED_QUERY_OPERATION,
			arguments: args,
			expectedOutput: { resultKind: "clickhouse-trusted-query-host-settlement" },
			idempotency: {
				key: canonicalTupleKey([input.effectRunId, executionFingerprint]),
				safeToRetry: false,
			},
		},
		policies: Object.freeze([approvalPolicy]),
		policyRefs: Object.freeze([
			{ kind: "tool-provider-execution-policy", id: approvalPolicy.policyId },
		]),
		sourceRefs: Object.freeze([
			...toSourceRefs("clickhouse-campaign", [args.profile.campaign]),
			...toSourceRefs("clickhouse-scenario", [args.scenario]),
			...toSourceRefs("clickhouse-query-plan", [args.queryPlan]),
			...toSourceRefs("clickhouse-source", [args.source]),
			...toSourceRefs("clickhouse-schema", [args.schema]),
			...toSourceRefs("clickhouse-policy", [args.policy]),
		]),
		metadata: {
			campaignId: args.profile.campaign.id,
			campaignRevision: args.profile.campaign.revision,
			scenarioId: args.scenario.id,
			scenarioRevision: args.scenario.revision,
			configurationFingerprint: args.profile.candidate.configurationFingerprint,
			executionFingerprint,
		},
	}) as Readonly<ToolProviderAdapterInput<ClickHouseTrustedQueryExecutionArguments>>;
}

/** Maps one real executor outcome into the existing D610 scenario-result contract. */
export function createClickHouseTrustedQueryScenarioResultFromOutcome(
	value: ClickHouseTrustedQueryScenarioResultFromOutcomeInput,
): Readonly<ProductionScenarioResult> {
	const input = productionEvaluationSnapshot(value);
	const args = validateExecutionArguments(input.arguments);
	const outcome = input.outcome;
	if (!outcome || typeof outcome !== "object")
		throw new TypeError("clickhouse-trusted-query-outcome-invalid");
	if (outcome.kind === "blocked")
		throw new TypeError("clickhouse-trusted-query-outcome-blocked-is-not-execution");
	if (!validClickHouseTerminalOutcomeShape(outcome))
		throw new TypeError("clickhouse-trusted-query-outcome-terminal-shape-invalid");
	const metadata = outcome.metadata;
	if (
		outcome.inputKind !== "tool-call" ||
		metadata?.providerId !== CLICKHOUSE_TRUSTED_QUERY_PROVIDER_ID ||
		metadata.toolName !== CLICKHOUSE_TRUSTED_QUERY_TOOL_NAME ||
		metadata.operation !== CLICKHOUSE_TRUSTED_QUERY_OPERATION
	)
		throw new TypeError("clickhouse-trusted-query-outcome-provider-correlation-mismatch");
	const admissionId = metadata?.admissionId;
	const runId = metadata?.runId;
	const evidenceId = metadata?.evidenceId;
	const evidenceHighWater = metadata?.evidenceHighWater;
	const evidenceRefs = metadata?.productionEvidenceRefs;
	const recordedAtMs = metadata?.recordedAtMs ?? outcome.occurredAtMs;
	const expectedCorrelation = clickHouseExecutionCorrelation(args);
	const actualCorrelation = metadata?.executionCorrelation;
	if (
		productionEvaluationCanonical(actualCorrelation) !==
		productionEvaluationCanonical(expectedCorrelation)
	)
		throw new TypeError("clickhouse-trusted-query-outcome-execution-correlation-mismatch");
	if (
		![admissionId, runId, evidenceId].every(publicToken) ||
		!Number.isSafeInteger(evidenceHighWater) ||
		(evidenceHighWater as number) < 0 ||
		!publicRefs(evidenceRefs) ||
		!Number.isSafeInteger(recordedAtMs) ||
		(recordedAtMs as number) < 0
	)
		throw new TypeError("clickhouse-trusted-query-outcome-correlation-invalid");
	const settlement =
		outcome.kind === "result" &&
		outcome.result.kind === "clickhouse-trusted-query-host-settlement" &&
		outcome.result.value !== undefined
			? validateHostSettlement(outcome.result.value, args)
			: undefined;
	if (outcome.kind === "result" && settlement === undefined)
		throw new TypeError("clickhouse-trusted-query-outcome-result-kind-invalid");
	if (
		settlement !== undefined &&
		(evidenceId !== settlement.evidenceId ||
			evidenceHighWater !== settlement.evidenceHighWater ||
			recordedAtMs !== settlement.recordedAtMs ||
			productionEvaluationCanonical(evidenceRefs) !==
				productionEvaluationCanonical(settlement.evidenceRefs))
	)
		throw new TypeError("clickhouse-trusted-query-outcome-settlement-metadata-mismatch");
	if (
		outcome.evidenceRefs === undefined ||
		productionEvaluationCanonical(outcome.evidenceRefs) !==
			productionEvaluationCanonical(toSourceRefs("clickhouse-evidence", evidenceRefs))
	)
		throw new TypeError("clickhouse-trusted-query-outcome-evidence-projection-mismatch");
	if (
		settlement === undefined &&
		(evidenceId !== outcome.outcomeId ||
			!publicRefs(evidenceRefs) ||
			!includesRef(evidenceRefs, {
				id: outcome.outcomeId,
				revision: "executor-outcome-v1",
			}) ||
			!defaultProductionEvidenceRefs(args).every((required) => includesRef(evidenceRefs, required)))
	)
		throw new TypeError("clickhouse-trusted-query-outcome-terminal-evidence-mismatch");
	const measurements = settlement?.measurements ?? Object.freeze({});
	if (!publicMeasurements(measurements))
		throw new TypeError("clickhouse-trusted-query-outcome-correlation-invalid");
	return createClickHouseTrustedQueryScenarioResult({
		kind: "clickhouse-trusted-query-scenario-result-input",
		profile: args.profile,
		scenario: args.scenario,
		resultId: input.resultId,
		requestId: outcome.requestId,
		admissionId: admissionId as string,
		runId: runId as string,
		attempt: outcome.attempt,
		outcomeId: outcome.outcomeId,
		evidenceId: evidenceId as string,
		evidenceHighWater: evidenceHighWater as number,
		outcome:
			outcome.kind === "result"
				? "succeeded"
				: outcome.kind === "canceled"
					? "cancelled"
					: outcome.kind === "timeout"
						? "timed-out"
						: "failed",
		measurements: measurements as Readonly<Record<string, number>>,
		evidenceRefs: evidenceRefs as readonly ProductionEvaluationRef[],
		recordedAtMs: recordedAtMs as number,
	});
}

function validClickHouseTerminalOutcomeShape(
	outcome: ExecutorOutcome<ClickHouseTrustedQueryHostSettlement>,
): boolean {
	const raw = outcome as unknown as Readonly<Record<string, unknown>>;
	const has = (key: string): boolean => Object.hasOwn(raw, key);
	if (outcome.kind === "result")
		return has("result") && !has("error") && !has("reason") && !has("timeoutMs") && !has("needs");
	if (outcome.kind === "failure")
		return (
			has("error") &&
			outcome.error !== null &&
			typeof outcome.error === "object" &&
			outcome.error.kind === "issue" &&
			publicToken(outcome.error.code) &&
			publicToken(outcome.error.message) &&
			outcome.retryable === false &&
			!has("result") &&
			!has("reason") &&
			!has("timeoutMs") &&
			!has("needs")
		);
	if (outcome.kind === "canceled")
		return (
			outcome.reason === "admitted-user-cancellation" &&
			!has("result") &&
			!has("error") &&
			!has("timeoutMs") &&
			!has("needs")
		);
	if (outcome.kind === "timeout")
		return (
			Number.isSafeInteger(outcome.timeoutMs) &&
			(outcome.timeoutMs ?? 0) > 0 &&
			outcome.retryable === false &&
			!has("result") &&
			!has("error") &&
			!has("reason") &&
			!has("needs")
		);
	return false;
}

/** Executes only exact ordinary-D419 admissions through a host-private capability. */
export function clickHouseTrustedQueryRuntime(
	graph: Graph,
	opts: ClickHouseTrustedQueryRuntimeOptions,
): ClickHouseTrustedQueryRuntimeBundle {
	if (opts.admittedRunRequests.length === 0)
		throw new TypeError("clickhouse runtime requires explicit admitted run requests");
	const name = opts.name ?? "clickhouseTrustedQueryEvaluationRuntime";
	if (!publicToken(name))
		throw new TypeError("clickhouse-trusted-query-runtime-name-invalid-or-private-material");
	const timeoutMs = positiveInteger(opts.timeoutMs, 30_000);
	const topology = graph.topologyGroup({ name });
	const outcomes = topology.node<ExecutorOutcome<ClickHouseTrustedQueryHostSettlement>>([], null, {
		name: `${name}/outcomes`,
	});
	const runStatus = topology.node<ToolProviderAdapterRunStatus>([], null, {
		name: `${name}/runStatus`,
	});
	const status = topology.node<AgentRequestStatusChanged>([], null, { name: `${name}/status` });
	const issues = topology.node<DataIssue>([], null, { name: `${name}/issues` });
	const audit = topology.node<AgentRuntimeAuditRecord>([], null, { name: `${name}/audit` });
	const cancellationProposals = topology.node<ClickHouseTrustedQueryCancellationProposal>(
		[],
		null,
		{ name: `${name}/cancellationProposals` },
	);
	const cancellationAdmissions = topology.node<ClickHouseTrustedQueryCancellationAdmission>(
		[],
		null,
		{ name: `${name}/cancellationAdmissions` },
	);
	const inputs = new Map<
		string,
		Readonly<ToolProviderAdapterInput<ClickHouseTrustedQueryExecutionArguments>>
	>();
	const inputFingerprints = new Map<string, string>();
	const runFingerprints = new Map<string, string>();
	const active = new Map<string, ClickHouseActiveRun>();
	const proposals = new Map<string, ClickHouseTrustedQueryCancellationProposal>();
	const pending = new Set<Promise<void>>();
	let auditSequence = 0;
	let disposed = false;
	let shutdown: Promise<void> | undefined;
	let topologyReleased = false;

	const publishIssue = (next: DataIssue): void => issues.down([["DATA", next]]);
	const publishAudit = (
		kind: string,
		subjectId: string,
		metadata?: Record<string, unknown>,
	): void => {
		auditSequence += 1;
		audit.down([
			[
				"DATA",
				Object.freeze({
					id: compoundTupleKey("clickhouse-trusted-query-runtime-audit", [
						name,
						String(auditSequence),
					]),
					kind,
					subjectId,
					...(metadata === undefined ? {} : { metadata: Object.freeze(metadata) }),
				}) satisfies AgentRuntimeAuditRecord,
			],
		]);
	};
	const publishRunStatus = (
		request: ToolProviderAdapterRunRequested,
		next: ToolProviderAdapterRunStatus["status"],
		outcomeId?: string,
		nextIssues?: readonly DataIssue[],
	): void => {
		runStatus.down([
			[
				"DATA",
				Object.freeze({
					kind: "tool-provider-adapter-run-status",
					runId: request.runId,
					adapterInputId: request.adapterInputId,
					requestId: request.requestId,
					operationId: request.operationId,
					status: next,
					attempt: request.attempt,
					...(outcomeId === undefined ? {} : { outcomeId }),
					...(nextIssues === undefined ? {} : { issues: nextIssues }),
					sourceRefs: request.sourceRefs,
					metadata: Object.freeze({ providerId: CLICKHOUSE_TRUSTED_QUERY_PROVIDER_ID }),
				}) satisfies ToolProviderAdapterRunStatus,
			],
		]);
	};

	function publishOutcome(
		run: ClickHouseActiveRun,
		outcome: ExecutorOutcome<ClickHouseTrustedQueryHostSettlement>,
	): void {
		outcomes.down([["DATA", outcome]]);
		publishRunStatus(run.request, outcome.kind, outcome.outcomeId, outcome.issues);
		status.down([
			[
				"DATA",
				Object.freeze({
					kind: "status",
					requestId: run.request.requestId,
					operationId: run.request.operationId,
					effectRunId: run.input.effectRunId ?? run.request.runId,
					status:
						outcome.kind === "result"
							? "completed"
							: outcome.kind === "failure"
								? "failed"
								: outcome.kind,
					sourceRefs: outcome.evidenceRefs,
					metadata: Object.freeze({ runId: run.request.runId }),
				}) satisfies AgentRequestStatusChanged,
			],
		]);
		publishAudit("clickhouse-trusted-query-runtime-finished", run.request.requestId, {
			runId: run.request.runId,
			attempt: run.request.attempt,
			outcome: outcome.kind,
		});
	}

	function execute(raw: ToolProviderAdapterRunRequested): void {
		if (disposed) return;
		const request = snapshotRunRequest(raw);
		if (request === undefined) {
			publishIssue(
				runtimeIssue(
					"clickhouse-trusted-query-run-invalid",
					"ClickHouse trusted-query admitted run is not bounded inert data.",
				),
			);
			return;
		}
		if (request.providerId !== CLICKHOUSE_TRUSTED_QUERY_PROVIDER_ID) return;
		const input = inputs.get(request.adapterInputId);
		if (input === undefined) {
			const missing = runtimeIssue(
				"clickhouse-trusted-query-run-missing-input",
				"ClickHouse trusted-query run has no matching adapter input.",
			);
			publishIssue(missing);
			publishRunStatus(request, "missing-input", undefined, [missing]);
			return;
		}
		const fingerprint = clickHouseRunFingerprint(request);
		const prior = runFingerprints.get(request.runId);
		if (prior !== undefined) {
			if (prior !== fingerprint) {
				const conflict = runtimeIssue(
					"clickhouse-trusted-query-run-coordinate-conflict",
					"ClickHouse trusted-query run id was reused with different coordinates.",
				);
				publishIssue(conflict);
				publishRunStatus(request, "mismatched-request", undefined, [conflict]);
			}
			return;
		}
		runFingerprints.set(request.runId, fingerprint);
		publishRunStatus(request, "requested");
		const admissionId = exactAdmissionId(request, input);
		const args = validateRuntimeInput(request, input);
		if (admissionId === undefined || args === undefined) {
			const mismatch = runtimeIssue(
				"clickhouse-trusted-query-run-input-mismatch",
				"ClickHouse trusted-query run does not exactly match a ready D419-admitted input.",
			);
			publishIssue(mismatch);
			publishRunStatus(request, "mismatched-request", undefined, [mismatch]);
			return;
		}
		const run: ClickHouseActiveRun = {
			request,
			input,
			args,
			admissionId,
			controller: new AbortController(),
			cancelKind: undefined,
		};
		active.set(request.runId, run);
		publishRunStatus(request, "started");
		publishAudit("clickhouse-trusted-query-runtime-started", request.requestId, {
			runId: request.runId,
			attempt: request.attempt,
			admissionId,
		});
		const task = runClickHouseCapability(run, opts, timeoutMs)
			.then((outcome) => {
				if (!disposed || run.cancelKind !== "dispose") publishOutcome(run, outcome);
			})
			.finally(() => {
				active.delete(request.runId);
				pending.delete(task);
			});
		pending.add(task);
	}

	function requestCancellation(raw: ClickHouseTrustedQueryCancellationRequested): void {
		if (disposed) return;
		const request = snapshotCancellationRequest(raw);
		const run = request === undefined ? undefined : active.get(request.runId);
		if (request === undefined || run === undefined || !cancellationMatchesRun(request, run)) {
			publishIssue(
				runtimeIssue(
					"clickhouse-trusted-query-cancellation-coordinate-mismatch",
					"Cancellation does not exactly match an active ClickHouse trusted-query run.",
				),
			);
			return;
		}
		const proposal = Object.freeze({
			...request,
			kind: "clickhouse-trusted-query-cancellation-proposal" as const,
			proposalId: compoundTupleKey("clickhouse-trusted-query-cancellation-proposal", [
				request.cancellationId,
				request.runId,
			]),
		});
		proposals.set(proposal.proposalId, proposal);
		cancellationProposals.down([["DATA", proposal]]);
	}

	function decideCancellation(raw: ClickHouseTrustedQueryCancellationDecision): void {
		if (disposed) return;
		const decision = snapshotCancellationDecision(raw);
		const proposal = decision === undefined ? undefined : proposals.get(decision.proposalId);
		if (decision === undefined || proposal === undefined) {
			publishIssue(
				runtimeIssue(
					"clickhouse-trusted-query-cancellation-decision-invalid",
					"Cancellation decision has no exact bounded proposal.",
				),
			);
			return;
		}
		proposals.delete(proposal.proposalId);
		const run = active.get(proposal.runId);
		const admitted =
			decision.outcome === "admit" &&
			run !== undefined &&
			run.cancelKind === undefined &&
			cancellationMatchesRun(proposal, run);
		const admission = Object.freeze({
			kind: "clickhouse-trusted-query-cancellation-admission" as const,
			admissionId: compoundTupleKey("clickhouse-trusted-query-cancellation-admission", [
				decision.decisionId,
			]),
			proposalId: proposal.proposalId,
			decisionId: decision.decisionId,
			cancellationId: proposal.cancellationId,
			runId: proposal.runId,
			state: admitted ? ("admitted" as const) : ("blocked" as const),
			sourceRefs: decision.sourceRefs,
		});
		cancellationAdmissions.down([["DATA", admission]]);
		if (admitted && run !== undefined) {
			run.cancelKind = "user";
			run.controller.abort();
		}
	}

	const unsubscribers = [
		opts.inputs.subscribe((message) => {
			if (message[0] !== "DATA") return;
			const input = snapshotClickHouseInput(
				message[1] as ToolProviderAdapterInput<ClickHouseTrustedQueryExecutionArguments>,
			);
			if (input === undefined) return;
			const fingerprint = productionEvaluationCanonical(input);
			const prior = inputFingerprints.get(input.adapterInputId);
			if (prior !== undefined && prior !== fingerprint) {
				publishIssue(
					runtimeIssue(
						"clickhouse-trusted-query-adapter-input-coordinate-conflict",
						"ClickHouse adapter input id was reused with different immutable coordinates.",
					),
				);
				return;
			}
			if (prior === undefined) {
				inputFingerprints.set(input.adapterInputId, fingerprint);
				inputs.set(input.adapterInputId, input);
			}
		}),
		...opts.admittedRunRequests.map((node) =>
			node.subscribe((message) => {
				if (message[0] === "DATA") execute(message[1] as ToolProviderAdapterRunRequested);
			}),
		),
		...(opts.cancellationRequests ?? []).map((node) =>
			node.subscribe((message) => {
				if (message[0] === "DATA")
					requestCancellation(message[1] as ClickHouseTrustedQueryCancellationRequested);
			}),
		),
		...(opts.cancellationDecisions ?? []).map((node) =>
			node.subscribe((message) => {
				if (message[0] === "DATA")
					decideCancellation(message[1] as ClickHouseTrustedQueryCancellationDecision);
			}),
		),
	];

	return Object.freeze({
		outcomes,
		runStatus,
		status,
		issues,
		audit,
		cancellationProposals,
		cancellationAdmissions,
		dispose() {
			if (shutdown === undefined) {
				disposed = true;
				for (const unsubscribe of unsubscribers) unsubscribe();
				for (const run of active.values()) {
					if (run.cancelKind === undefined) {
						run.cancelKind = "dispose";
						run.controller.abort();
					}
				}
				shutdown = Promise.allSettled([...pending]).then(() => {
					active.clear();
					inputs.clear();
					inputFingerprints.clear();
					proposals.clear();
					runFingerprints.clear();
				});
			}
			const releaseTopology = (): void => {
				if (topologyReleased) return;
				try {
					topology.release({ reason: `${name}:dispose` });
					topologyReleased = true;
				} catch {
					// Caller-owned subscribers may intentionally keep disposed output views inspectable.
				}
			};
			return shutdown.then(releaseTopology, (error: unknown) => {
				releaseTopology();
				throw error;
			});
		},
	} satisfies ClickHouseTrustedQueryRuntimeBundle);
}

interface ClickHouseActiveRun {
	readonly request: ToolProviderAdapterRunRequested;
	readonly input: Readonly<ToolProviderAdapterInput<ClickHouseTrustedQueryExecutionArguments>>;
	readonly args: Readonly<ClickHouseTrustedQueryExecutionArguments>;
	readonly admissionId: string;
	readonly controller: AbortController;
	cancelKind: "user" | "timeout" | "dispose" | undefined;
}

const CLICKHOUSE_HOST_ABORTED = Symbol("clickhouse-host-aborted");

async function runClickHouseCapability(
	run: ClickHouseActiveRun,
	opts: ClickHouseTrustedQueryRuntimeOptions,
	timeoutMs: number,
): Promise<ExecutorOutcome<ClickHouseTrustedQueryHostSettlement>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let abortListener: (() => void) | undefined;
	try {
		timer = setTimeout(() => {
			if (run.cancelKind === undefined) {
				run.cancelKind = "timeout";
				run.controller.abort();
			}
		}, timeoutMs);
		const hostResult = opts.capability.execute({
			profile: run.args.profile,
			scenario: run.args.scenario,
			queryPlan: run.args.queryPlan,
			source: run.args.source,
			schema: run.args.schema,
			policy: run.args.policy,
			requestId: run.request.requestId,
			admissionId: run.admissionId,
			runId: run.request.runId,
			attempt: run.request.attempt,
			signal: run.controller.signal,
		});
		const aborted = new Promise<typeof CLICKHOUSE_HOST_ABORTED>((resolve) => {
			abortListener = () => resolve(CLICKHOUSE_HOST_ABORTED);
			if (run.controller.signal.aborted) abortListener();
			else run.controller.signal.addEventListener("abort", abortListener, { once: true });
		});
		const settlement = await Promise.race([hostResult, aborted]);
		if (settlement === CLICKHOUSE_HOST_ABORTED)
			return canceledOrTimedOutOutcome(run, opts, timeoutMs);
		const checked = validateHostSettlement(settlement, run.args);
		return Object.freeze({
			...clickHouseOutcomeBase(run, opts, checked),
			kind: "result",
			result: Object.freeze({
				kind: "clickhouse-trusted-query-host-settlement",
				value: checked,
				refs: toSourceRefs("clickhouse-evidence", checked.evidenceRefs),
			}),
		});
	} catch (error: unknown) {
		if (run.controller.signal.aborted) return canceledOrTimedOutOutcome(run, opts, timeoutMs);
		const classified = classifyHostError(error);
		const issue = runtimeIssue(
			`clickhouse-trusted-query-${classified.kind}`,
			classified.message,
			classified.retryable,
		);
		return Object.freeze({
			...clickHouseOutcomeBase(run, opts),
			kind: "failure",
			error: issue,
			retryable: classified.retryable,
			issues: Object.freeze([issue]),
		});
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		if (abortListener !== undefined)
			run.controller.signal.removeEventListener("abort", abortListener);
	}
}

function canceledOrTimedOutOutcome(
	run: ClickHouseActiveRun,
	opts: ClickHouseTrustedQueryRuntimeOptions,
	timeoutMs: number,
): ExecutorOutcome<ClickHouseTrustedQueryHostSettlement> {
	return run.cancelKind === "timeout"
		? Object.freeze({
				...clickHouseOutcomeBase(run, opts),
				kind: "timeout",
				timeoutMs,
				retryable: false,
			})
		: Object.freeze({
				...clickHouseOutcomeBase(run, opts),
				kind: "canceled",
				reason: run.cancelKind === "user" ? "admitted-user-cancellation" : "runtime-disposed",
			});
}

function clickHouseOutcomeBase(
	run: ClickHouseActiveRun,
	opts: ClickHouseTrustedQueryRuntimeOptions,
	settlement?: ClickHouseTrustedQueryHostSettlement,
) {
	const recordedAtMs = settlement?.recordedAtMs ?? opts.now?.() ?? 0;
	const outcomeId = compoundTupleKey("clickhouse-trusted-query-executor-outcome", [
		run.request.runId,
		String(run.request.attempt),
	]);
	const evidenceId = settlement?.evidenceId ?? outcomeId;
	const evidenceRefs =
		settlement?.evidenceRefs ??
		Object.freeze([
			{ id: outcomeId, revision: "executor-outcome-v1" },
			...defaultProductionEvidenceRefs(run.args),
		]);
	return {
		outcomeId,
		requestId: run.request.requestId,
		operationId: run.request.operationId,
		routeId: run.request.routeId!,
		executorId: run.request.executorId!,
		profileId: run.request.profileId!,
		attempt: run.request.attempt,
		inputId: run.request.adapterInputId,
		inputKind: "tool-call",
		occurredAtMs: recordedAtMs,
		evidenceRefs: toSourceRefs("clickhouse-evidence", evidenceRefs),
		metadata: Object.freeze({
			runId: run.request.runId,
			admissionId: run.admissionId,
			providerId: CLICKHOUSE_TRUSTED_QUERY_PROVIDER_ID,
			toolName: CLICKHOUSE_TRUSTED_QUERY_TOOL_NAME,
			operation: CLICKHOUSE_TRUSTED_QUERY_OPERATION,
			executionCorrelation: clickHouseExecutionCorrelation(run.args),
			evidenceId,
			evidenceHighWater: settlement?.evidenceHighWater ?? 0,
			productionEvidenceRefs: evidenceRefs,
			recordedAtMs,
		}),
	} as const;
}

function validateExecutionArguments(
	value: ClickHouseTrustedQueryExecutionArguments,
): Readonly<ClickHouseTrustedQueryExecutionArguments> {
	const args = productionEvaluationSnapshot(value);
	if (
		!args ||
		typeof args !== "object" ||
		!onlyKeys(args, [
			"contractVersion",
			"profile",
			"scenario",
			"queryPlan",
			"source",
			"schema",
			"policy",
		]) ||
		args.contractVersion !== CLICKHOUSE_TRUSTED_QUERY_EVALUATION_CONTRACT_VERSION ||
		!publicRef(args.scenario) ||
		!publicRef(args.queryPlan) ||
		!publicRef(args.source) ||
		!publicRef(args.schema) ||
		!publicRef(args.policy)
	)
		throw new TypeError("clickhouse-trusted-query-execution-arguments-invalid-or-private-material");
	const profile = validateClickHouseTrustedQueryEvaluationProfile(args.profile);
	if (
		!profile.scenarios.some(
			(scenario) =>
				scenario.scenarioId === args.scenario.id && scenario.revision === args.scenario.revision,
		) ||
		!includesRef(profile.queryPlanRefs, args.queryPlan) ||
		!includesRef(profile.sourceRefs, args.source) ||
		!includesRef(profile.schemaRefs, args.schema) ||
		!includesRef(profile.policyRefs, args.policy)
	)
		throw new TypeError("clickhouse-trusted-query-execution-arguments-not-pinned");
	return Object.freeze({ ...args, profile });
}

function validateHostSettlement(
	value: ClickHouseTrustedQueryHostSettlement,
	args: ClickHouseTrustedQueryExecutionArguments,
): Readonly<ClickHouseTrustedQueryHostSettlement> {
	const settlement = productionEvaluationSnapshot(value);
	if (
		!settlement ||
		typeof settlement !== "object" ||
		!onlyKeys(settlement, [
			"kind",
			"measurements",
			"evidenceId",
			"evidenceHighWater",
			"evidenceRefs",
			"recordedAtMs",
		]) ||
		settlement.kind !== "clickhouse-trusted-query-host-settlement" ||
		!publicMeasurements(settlement.measurements) ||
		!publicToken(settlement.evidenceId) ||
		!Number.isSafeInteger(settlement.evidenceHighWater) ||
		settlement.evidenceHighWater < 0 ||
		!publicRefs(settlement.evidenceRefs) ||
		!Number.isSafeInteger(settlement.recordedAtMs) ||
		settlement.recordedAtMs < 0
	)
		throw new TypeError("clickhouse-trusted-query-host-settlement-invalid-or-private-material");
	if (
		!settlement.evidenceRefs.some((ref) => ref.id === settlement.evidenceId) ||
		!defaultProductionEvidenceRefs(args).every((required) =>
			includesRef(settlement.evidenceRefs, required),
		)
	)
		throw new TypeError("clickhouse-trusted-query-host-settlement-evidence-correlation-mismatch");
	return settlement;
}

function snapshotClickHouseInput(
	value: ToolProviderAdapterInput<ClickHouseTrustedQueryExecutionArguments>,
): Readonly<ToolProviderAdapterInput<ClickHouseTrustedQueryExecutionArguments>> | undefined {
	try {
		const input = productionEvaluationSnapshot(value);
		const policy = input.policies?.[0];
		const approvalMode = policy?.approval?.mode;
		if (
			input.providerId !== CLICKHOUSE_TRUSTED_QUERY_PROVIDER_ID ||
			input.toolName !== CLICKHOUSE_TRUSTED_QUERY_TOOL_NAME ||
			input.operation !== CLICKHOUSE_TRUSTED_QUERY_OPERATION ||
			input.toolCall?.toolName !== CLICKHOUSE_TRUSTED_QUERY_TOOL_NAME ||
			input.toolCall.operation !== CLICKHOUSE_TRUSTED_QUERY_OPERATION ||
			!publicToken(input.effectRunId) ||
			!publicToken(input.routeId) ||
			!publicToken(input.executorId) ||
			!publicToken(input.profileId) ||
			input.policies?.length !== 1 ||
			!publicToken(policy?.policyId) ||
			(approvalMode !== "auto" && approvalMode !== "require" && approvalMode !== "never")
		)
			return undefined;
		const exactApprovalMode = approvalMode as "auto" | "require" | "never";
		const expected = createClickHouseTrustedQueryAdapterInput({
			requestId: input.requestId,
			operationId: input.operationId,
			effectRunId: input.effectRunId,
			routeId: input.routeId,
			executorId: input.executorId,
			profileId: input.profileId,
			arguments: validateExecutionArguments(input.toolCall.arguments!),
			approval: { policyId: policy!.policyId, mode: exactApprovalMode },
		});
		return productionEvaluationCanonical(input) === productionEvaluationCanonical(expected)
			? expected
			: undefined;
	} catch {
		return undefined;
	}
}

function validateRuntimeInput(
	request: ToolProviderAdapterRunRequested,
	input: Readonly<ToolProviderAdapterInput<ClickHouseTrustedQueryExecutionArguments>>,
): Readonly<ClickHouseTrustedQueryExecutionArguments> | undefined {
	if (
		input.status !== "ready" ||
		request.adapterInputId !== input.adapterInputId ||
		request.requestId !== input.requestId ||
		request.operationId !== input.operationId ||
		request.routeId === undefined ||
		request.routeId !== input.routeId ||
		request.providerId !== input.providerId ||
		request.executorId === undefined ||
		request.executorId !== input.executorId ||
		request.profileId === undefined ||
		request.profileId !== input.profileId
	)
		return undefined;
	try {
		return validateExecutionArguments(input.toolCall!.arguments!);
	} catch {
		return undefined;
	}
}

function projectorAdmissionShape(request: ToolProviderAdapterRunRequested):
	| Readonly<{
			admissionId: string;
			proposalId: string;
			approvedFromRunId: string;
			decisionId?: string;
	  }>
	| undefined {
	const metadata = request.metadata;
	const admissionId = metadata?.admissionId;
	const proposalId = metadata?.proposalId;
	const approvedFromRunId = metadata?.approvedFromRunId;
	const decisionId = metadata?.decisionId;
	if (
		!publicToken(admissionId) ||
		!publicToken(proposalId) ||
		!publicToken(approvedFromRunId) ||
		(decisionId !== undefined && !publicToken(decisionId)) ||
		metadata?.approval !== "granted" ||
		metadata.approvalGranted !== true ||
		proposalId !==
			compoundTupleKey("tool-provider-run-admission-proposal", [approvedFromRunId as string])
	)
		return undefined;
	const refs = request.sourceRefs ?? [];
	const exactlyOne = (kind: string, id: string): boolean =>
		refs.filter((ref) => ref.kind === kind && ref.id === id).length === 1;
	if (
		!exactlyOne("tool-provider-run-admission", admissionId) ||
		!exactlyOne("tool-provider-run-admission-proposal", proposalId) ||
		!exactlyOne("tool-provider-adapter-run", approvedFromRunId) ||
		(decisionId !== undefined && !exactlyOne("tool-provider-run-admission-decision", decisionId))
	)
		return undefined;
	return Object.freeze({
		admissionId,
		proposalId,
		approvedFromRunId,
		...(decisionId === undefined ? {} : { decisionId }),
	});
}

function exactAdmissionId(
	request: ToolProviderAdapterRunRequested,
	input: ToolProviderAdapterInput<ClickHouseTrustedQueryExecutionArguments>,
): string | undefined {
	const shape = projectorAdmissionShape(request);
	if (shape === undefined) return undefined;
	const approvalMode = input.policies?.find(
		(policy) =>
			policy.providerId === CLICKHOUSE_TRUSTED_QUERY_PROVIDER_ID &&
			(policy.profileIds === undefined || policy.profileIds.includes(input.profileId!)) &&
			(policy.toolNames === undefined ||
				policy.toolNames.includes(CLICKHOUSE_TRUSTED_QUERY_TOOL_NAME)) &&
			(policy.operations === undefined ||
				policy.operations.includes(CLICKHOUSE_TRUSTED_QUERY_OPERATION)),
	)?.approval?.mode;
	if (approvalMode === "never" || approvalMode === undefined) return undefined;
	if (approvalMode === "require" || approvalMode === "custom")
		return shape.decisionId === undefined ? undefined : shape.admissionId;
	if (approvalMode !== "auto" || shape.decisionId !== undefined) return undefined;
	const expectedAdmissionId = compoundTupleKey("tool-provider-run-admission", [shape.proposalId]);
	const expectedRunId = compoundTupleKey("tool-provider-run-admitted", [shape.approvedFromRunId]);
	return shape.admissionId === expectedAdmissionId && request.runId === expectedRunId
		? shape.admissionId
		: undefined;
}

function snapshotRunRequest(
	value: ToolProviderAdapterRunRequested,
): Readonly<ToolProviderAdapterRunRequested> | undefined {
	try {
		const sourceRefs = snapshotSourceRefs(value.sourceRefs);
		if (
			value.kind !== "tool-provider-adapter-run-requested" ||
			![
				value.runId,
				value.adapterInputId,
				value.requestId,
				value.operationId,
				value.routeId,
				value.providerId,
				value.executorId,
				value.profileId,
			].every(publicToken) ||
			!Number.isSafeInteger(value.attempt) ||
			value.attempt < 1 ||
			!publicToken(value.reason) ||
			(value.sourceRefs !== undefined && sourceRefs === undefined) ||
			projectorAdmissionShape(value) === undefined
		)
			return undefined;
		return Object.freeze({
			kind: value.kind,
			runId: value.runId,
			adapterInputId: value.adapterInputId,
			requestId: value.requestId,
			operationId: value.operationId,
			routeId: value.routeId,
			providerId: value.providerId,
			executorId: value.executorId,
			profileId: value.profileId,
			attempt: value.attempt,
			reason: value.reason,
			sourceRefs,
			metadata: Object.freeze({
				approval: "granted",
				approvalGranted: true,
				admissionId: value.metadata!.admissionId,
				proposalId: value.metadata!.proposalId,
				approvedFromRunId: value.metadata!.approvedFromRunId,
				...(value.metadata!.decisionId === undefined
					? {}
					: { decisionId: value.metadata!.decisionId }),
			}),
		});
	} catch {
		return undefined;
	}
}

function snapshotCancellationRequest(
	value: ClickHouseTrustedQueryCancellationRequested,
): Readonly<ClickHouseTrustedQueryCancellationRequested> | undefined {
	try {
		const request = productionEvaluationSnapshot(value);
		const sourceRefs = snapshotSourceRefs(request.sourceRefs);
		if (
			request.kind !== "clickhouse-trusted-query-cancellation-requested" ||
			!Object.keys(request).every((key) =>
				[
					"kind",
					"cancellationId",
					"admissionId",
					"runId",
					"adapterInputId",
					"requestId",
					"operationId",
					"attempt",
					"sourceRefs",
				].includes(key),
			) ||
			![
				request.cancellationId,
				request.admissionId,
				request.runId,
				request.adapterInputId,
				request.requestId,
				request.operationId,
			].every(publicToken) ||
			!Number.isSafeInteger(request.attempt) ||
			request.attempt < 1 ||
			(request.sourceRefs !== undefined && sourceRefs === undefined)
		)
			return undefined;
		return Object.freeze({
			kind: request.kind,
			cancellationId: request.cancellationId,
			admissionId: request.admissionId,
			runId: request.runId,
			adapterInputId: request.adapterInputId,
			requestId: request.requestId,
			operationId: request.operationId,
			attempt: request.attempt,
			...(sourceRefs === undefined ? {} : { sourceRefs }),
		});
	} catch {
		return undefined;
	}
}

function snapshotCancellationDecision(
	value: ClickHouseTrustedQueryCancellationDecision,
): Readonly<ClickHouseTrustedQueryCancellationDecision> | undefined {
	try {
		const decision = productionEvaluationSnapshot(value);
		const sourceRefs = snapshotSourceRefs(decision.sourceRefs);
		if (
			decision.kind !== "clickhouse-trusted-query-cancellation-decision" ||
			!Object.keys(decision).every((key) =>
				["kind", "decisionId", "proposalId", "outcome", "sourceRefs"].includes(key),
			) ||
			![decision.decisionId, decision.proposalId].every(publicToken) ||
			(decision.outcome !== "admit" && decision.outcome !== "block") ||
			(decision.sourceRefs !== undefined && sourceRefs === undefined)
		)
			return undefined;
		return Object.freeze({
			kind: decision.kind,
			decisionId: decision.decisionId,
			proposalId: decision.proposalId,
			outcome: decision.outcome,
			...(sourceRefs === undefined ? {} : { sourceRefs }),
		});
	} catch {
		return undefined;
	}
}

function cancellationMatchesRun(
	request: Omit<ClickHouseTrustedQueryCancellationRequested, "kind">,
	run: ClickHouseActiveRun,
): boolean {
	return (
		request.admissionId === run.admissionId &&
		request.runId === run.request.runId &&
		request.adapterInputId === run.request.adapterInputId &&
		request.requestId === run.request.requestId &&
		request.operationId === run.request.operationId &&
		request.attempt === run.request.attempt
	);
}

function clickHouseRunFingerprint(request: ToolProviderAdapterRunRequested): string {
	return canonicalTupleKey([
		request.runId,
		request.adapterInputId,
		request.requestId,
		request.operationId,
		request.routeId ?? "",
		request.providerId ?? "",
		request.executorId ?? "",
		request.profileId ?? "",
		String(request.attempt),
		request.reason,
		(request.metadata?.admissionId as string | undefined) ?? "missing-admission",
	]);
}

function classifyHostError(error: unknown): {
	readonly kind: ClickHouseTrustedQueryFailureKind;
	readonly message: string;
	readonly retryable: boolean;
} {
	const kinds: readonly ClickHouseTrustedQueryFailureKind[] = [
		"capability-unavailable",
		"authentication",
		"authorization",
		"connectivity",
		"schema-drift",
		"incompatible-plan",
		"resource-limit",
		"malformed-settlement",
	];
	let candidateKind: unknown;
	let candidateMessage: unknown;
	try {
		if (error !== null && typeof error === "object") {
			const descriptors = Object.getOwnPropertyDescriptors(error);
			candidateKind = descriptors.kind?.value;
			candidateMessage = descriptors.message?.value;
		}
	} catch {
		// Host error objects are untrusted; classification remains total and fail-closed.
	}
	const kind = kinds.includes(candidateKind as ClickHouseTrustedQueryFailureKind)
		? (candidateKind as ClickHouseTrustedQueryFailureKind)
		: typeof candidateMessage === "string" && candidateMessage.includes("host-settlement-")
			? "malformed-settlement"
			: "capability-unavailable";
	return {
		kind,
		message: `ClickHouse trusted-query host capability failed: ${kind}.`,
		retryable: false,
	};
}

function runtimeIssue(code: string, message: string, retryable = false): DataIssue {
	return Object.freeze({ kind: "issue", code, message, severity: "error", retryable });
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : fallback;
}

function includesRef(
	refs: readonly ProductionEvaluationRef[],
	value: ProductionEvaluationRef,
): boolean {
	return refs.some((ref) => ref.id === value.id && ref.revision === value.revision);
}

function clickHouseExecutionFingerprint(args: ClickHouseTrustedQueryExecutionArguments): string {
	const bytes = new TextEncoder().encode(productionEvaluationCanonical(args));
	let hash = 0xcbf29ce484222325n;
	for (const byte of bytes) {
		hash ^= BigInt(byte);
		hash = BigInt.asUintN(64, hash * 0x100000001b3n);
	}
	return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function clickHouseExecutionCorrelation(
	args: ClickHouseTrustedQueryExecutionArguments,
): Readonly<Record<string, unknown>> {
	return Object.freeze({
		contractVersion: args.contractVersion,
		scope: args.profile.scope,
		campaign: args.profile.campaign,
		candidate: args.profile.candidate,
		scenario: args.scenario,
		queryPlan: args.queryPlan,
		source: args.source,
		schema: args.schema,
		policy: args.policy,
		executionFingerprint: clickHouseExecutionFingerprint(args),
	});
}

function defaultProductionEvidenceRefs(
	args: ClickHouseTrustedQueryExecutionArguments,
): readonly ProductionEvaluationRef[] {
	return Object.freeze([args.scenario, args.queryPlan, args.source, args.schema, args.policy]);
}

function toSourceRefs(
	kind: string,
	refs: readonly ProductionEvaluationRef[],
): readonly SourceRef[] {
	return Object.freeze(
		refs.map((ref) =>
			Object.freeze({
				kind,
				id: compoundTupleKey("production-evaluation-ref", [ref.id, ref.revision]),
				metadata: Object.freeze({ id: ref.id, revision: ref.revision }),
			}),
		),
	);
}

function snapshotSourceRefs(
	value: readonly SourceRef[] | undefined,
): readonly SourceRef[] | undefined {
	if (value === undefined) return undefined;
	try {
		const refs = productionEvaluationSnapshot(value);
		if (
			!denseArray(refs) ||
			!refs.every(
				(ref) =>
					ref !== null &&
					typeof ref === "object" &&
					publicToken((ref as SourceRef).kind) &&
					publicToken((ref as SourceRef).id),
			)
		)
			return undefined;
		return Object.freeze(
			(refs as readonly SourceRef[]).map((ref) => Object.freeze({ kind: ref.kind, id: ref.id })),
		);
	} catch {
		return undefined;
	}
}
