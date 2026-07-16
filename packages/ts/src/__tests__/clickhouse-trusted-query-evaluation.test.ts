import { describe, expect, it } from "vitest";
import {
	CLICKHOUSE_TRUSTED_QUERY_ADAPTER_ID,
	CLICKHOUSE_TRUSTED_QUERY_EVALUATION_CONTRACT_VERSION,
	CLICKHOUSE_TRUSTED_QUERY_PROFILE_KIND,
	type ClickHouseTrustedQueryEvaluationProfile,
	createClickHouseTrustedQueryCampaignRevision,
	createClickHouseTrustedQueryScenarioResult,
	isClickHouseTrustedQueryCandidate,
} from "../solutions/clickhouse-trusted-query-evaluation.js";
import type { ProductionCandidatePins } from "../solutions/production-evaluation-authority.js";

const ref = (id: string, revision = "r1") => ({ id, revision });
const scope = { tenantId: "tenant-1", workspaceId: "workspace-1" };
const candidate: ProductionCandidatePins = {
	adapter: ref(CLICKHOUSE_TRUSTED_QUERY_ADAPTER_ID, "adapter-r1"),
	runtime: ref("clickhouse-runtime-profile", "runtime-r1"),
	configurationFingerprint: "clickhouse-config-fingerprint-r1",
};
const profile = (at = 100): ClickHouseTrustedQueryEvaluationProfile => ({
	kind: CLICKHOUSE_TRUSTED_QUERY_PROFILE_KIND,
	contractVersion: CLICKHOUSE_TRUSTED_QUERY_EVALUATION_CONTRACT_VERSION,
	scope,
	campaign: ref("clickhouse-campaign", "campaign-r1"),
	previousCampaignRevision: null,
	candidate,
	scenarioPack: ref("trusted-query-scenarios", "pack-r1"),
	criteria: ref("trusted-query-criteria", "criteria-r1"),
	scenarios: [
		{ scenarioId: "latency-and-correctness", revision: "scenario-r1", dependencyIds: [] },
	],
	environmentRefs: [ref("environment-profile")],
	dataRefs: [ref("dataset-snapshot")],
	sourceRefs: [ref("source-catalog")],
	schemaRefs: [ref("schema-fingerprint")],
	policyRefs: [ref("query-policy")],
	queryPlanRefs: [ref("query-plan-fingerprint")],
	createdBy: "actor",
	createdAtMs: at,
});
const resultInput = (at = 110) => ({
	kind: "clickhouse-trusted-query-scenario-result-input" as const,
	profile: profile(100),
	scenario: ref("latency-and-correctness", "scenario-r1"),
	resultId: "result-1",
	requestId: "request-1",
	admissionId: "admission-1",
	runId: "run-1",
	attempt: 1,
	outcomeId: "outcome-1",
	evidenceId: "evidence-1",
	evidenceHighWater: 8,
	outcome: "succeeded" as const,
	measurements: { correctness: 1, latencyMs: 42 },
	evidenceRefs: [ref("evidence-1"), ref("source-catalog"), ref("query-plan-fingerprint")],
	recordedAtMs: at,
});
describe("ClickHouse trusted-query evaluation contracts (D628)", () => {
	it("creates a focused ClickHouse candidate and D610 campaign without generic registry fields", () => {
		expect(isClickHouseTrustedQueryCandidate(candidate)).toBe(true);
		expect(
			isClickHouseTrustedQueryCandidate({
				...candidate,
				adapter: ref("generic-database-provider", "adapter-r1"),
			}),
		).toBe(false);
		const campaign = createClickHouseTrustedQueryCampaignRevision(profile());
		expect(campaign).toMatchObject({
			kind: "production-evaluation-campaign-revision",
			campaignId: "clickhouse-campaign",
			revision: "campaign-r1",
			candidate,
			scenarioPack: ref("trusted-query-scenarios", "pack-r1"),
			criteria: ref("trusted-query-criteria", "criteria-r1"),
			sourceRefs: [ref("source-catalog"), ref("query-plan-fingerprint")],
		});
		expect(Object.isFrozen(campaign)).toBe(true);
		expect(campaign).not.toHaveProperty("queryText");
		expect(campaign).not.toHaveProperty("client");
		expect(campaign).not.toHaveProperty("providerRegistry");
	});

	it("maps a pinned scenario execution into D419/D610 result coordinates", () => {
		const result = createClickHouseTrustedQueryScenarioResult(resultInput());
		expect(result).toMatchObject({
			kind: "production-scenario-result",
			scope,
			campaignId: "clickhouse-campaign",
			campaignRevision: "campaign-r1",
			scenarioId: "latency-and-correctness",
			scenarioRevision: "scenario-r1",
			requestId: "request-1",
			admissionId: "admission-1",
			runId: "run-1",
			attempt: 1,
			outcomeId: "outcome-1",
			evidenceId: "evidence-1",
			candidate,
		});
		expect(Object.isFrozen(result.evidenceRefs)).toBe(true);
	});

	it("rejects private material, raw SQL, URLs, cursors, and unpinned scenarios", () => {
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				sourceRefs: [ref("https://clickhouse.example.internal")],
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				queryPlanRefs: [ref("select count from private_table")],
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				queryPlanRefs: [ref("explain select count from events")],
			}),
		).toThrow("private-material");
		for (const rawSql of [
			"show tables",
			"describe table users",
			"system flush logs",
			"use analytics",
		]) {
			expect(() =>
				createClickHouseTrustedQueryCampaignRevision({
					...profile(),
					queryPlanRefs: [ref(rawSql)],
				}),
			).toThrow("private-material");
		}
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				requestId: "request=password",
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				evidenceId: "secret-evidence-id",
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				measurements: { "cursor=private": 1 },
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				measurements: { cursor: 1 },
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				measurements: { pageCursor: 1 },
			}),
		).toThrow("private-material");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				scenario: ref("not-pinned", "scenario-r1"),
			}),
		).toThrow("scenario-not-pinned");
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				scenarios: [
					{
						scenarioId: "latency-and-correctness",
						revision: "scenario-r1",
						dependencyIds: ["schema-change", "schema-change"],
					},
					{ scenarioId: "schema-change", revision: "scenario-r1", dependencyIds: [] },
				],
			}),
		).toThrow("profile-invalid");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				profile: {
					...profile(),
					scenarios: [
						{
							scenarioId: "latency-and-correctness",
							revision: "scenario-r1",
							dependencyIds: ["schema-change"],
						},
						{
							scenarioId: "schema-change",
							revision: "scenario-r1",
							dependencyIds: ["latency-and-correctness"],
						},
					],
				},
			}),
		).toThrow("profile-invalid");
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				environmentRefs: Array(
					1,
				) as unknown as ClickHouseTrustedQueryEvaluationProfile["environmentRefs"],
			}),
		).toThrow("profile-invalid");
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				scenarios: Array(1) as unknown as ClickHouseTrustedQueryEvaluationProfile["scenarios"],
			}),
		).toThrow("profile-invalid");
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision({
				...profile(),
				scenarios: [
					{
						scenarioId: "latency-and-correctness",
						revision: "scenario-r1",
						dependencyIds: Array(1) as unknown as string[],
					},
				],
			}),
		).toThrow("profile-invalid");
		expect(() =>
			createClickHouseTrustedQueryScenarioResult({
				...resultInput(),
				evidenceRefs: Array(1) as unknown as ReturnType<typeof resultInput>["evidenceRefs"],
			}),
		).toThrow("result-invalid");
	});

	it("rejects accessor-bearing runtime/client shaped material before reading it", () => {
		let reads = 0;
		const malicious = {
			...profile(),
			get queryPlanRefs() {
				reads++;
				return [ref("query-plan-fingerprint")];
			},
		};
		expect(() =>
			createClickHouseTrustedQueryCampaignRevision(
				malicious as unknown as ClickHouseTrustedQueryEvaluationProfile,
			),
		).toThrow("accessor");
		expect(reads).toBe(0);
		const accessorCandidate = {
			configurationFingerprint: candidate.configurationFingerprint,
			runtime: candidate.runtime,
		};
		Object.defineProperty(accessorCandidate, "adapter", {
			enumerable: true,
			get() {
				reads++;
				return candidate.adapter;
			},
		});
		expect(isClickHouseTrustedQueryCandidate(accessorCandidate)).toBe(false);
		expect(reads).toBe(0);
	});
});
