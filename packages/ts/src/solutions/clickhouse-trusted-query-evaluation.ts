/** Focused ClickHouse trusted-query production-evaluation contracts (D628). */
import type {
	ProductionCandidatePins,
	ProductionEvaluationCampaignRevision,
	ProductionEvaluationRef,
	ProductionEvaluationScenarioPin,
	ProductionEvaluationScope,
	ProductionScenarioResult,
} from "./production-evaluation-contracts.js";
import {
	productionEvaluationSnapshot,
	validateProductionEvaluationValue,
} from "./production-evaluation-contracts.js";

export const CLICKHOUSE_TRUSTED_QUERY_EVALUATION_CONTRACT_VERSION = "1" as const;
export const CLICKHOUSE_TRUSTED_QUERY_ADAPTER_ID = "clickhouse-trusted-query-adapter" as const;
export const CLICKHOUSE_TRUSTED_QUERY_PROFILE_KIND =
	"clickhouse-trusted-query-evaluation-profile" as const;

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
