import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import type {
	EmpiricalCampaignManifestV1,
	EmpiricalCampaignTaskV1,
	EmpiricalTaskQualificationObservationV1,
	FrozenEmpiricalCampaignManifestV1,
} from "../../evals/empirical-memory-rerun-avoidance/contracts.js";
import {
	B112_CALIBRATION_CAMPAIGN_SCORECARD_SCHEMA,
	B112_CALIBRATION_SIMULATION_BLOCK_SCHEMA,
	B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION,
	createB112CalibrationCampaignScorecard,
	createB112CalibrationEmpiricalBlockResult,
	createB112CalibrationTrialBlockIdentity,
	exhaustiveTaskClusterInterval95,
	runB112CalibrationSimulation,
	runB112EmpiricalCalibration,
	validateB112CalibrationTerminalSlots,
} from "../../evals/empirical-memory-rerun-avoidance/empirical-calibration.js";
import {
	B112_CALIBRATION_EXPLORATORY_NO_EFFICACY_CLAIM,
	EMPIRICAL_CALIBRATION_TRIAL_BLOCK_OBSERVATION_SCHEMA,
	type EmpiricalCalibrationTrialBlockObservationV4,
	validateEmpiricalCalibrationTrialBlockObservation,
} from "../../evals/empirical-memory-rerun-avoidance/empirical-smoke-evidence.js";
import {
	createEmpiricalExactPrivateNeedleProtectionExecutor,
	MAX_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS,
} from "../../evals/empirical-memory-rerun-avoidance/exact-private-needle-protection.js";
import {
	validateEmpiricalCampaignManifest,
	validateEmpiricalCampaignManifestBytes,
} from "../../evals/empirical-memory-rerun-avoidance/manifest.js";
import { readAndConsumeD688FreshRouteAttestation } from "../../evals/empirical-memory-rerun-avoidance/openrouter-developer-guidance-calibration-runner.js";
import {
	classifyOpenRouterCalibrationBudgetExhaustionScope,
	createOpenRouterCalibrationEmpiricalRunner,
} from "../../evals/empirical-memory-rerun-avoidance/openrouter-first-task-smoke.js";
import {
	assertPrivateArtifactProtection,
	persistPrivateCalibrationGeneration,
} from "../../evals/empirical-memory-rerun-avoidance/private-smoke-persistence.js";
import {
	createEmpiricalTaskQualificationReport,
	freezeEmpiricalCampaignManifest,
	validateEmpiricalTaskQualificationReport,
	validateEmpiricalTaskQualificationReportBytes,
	validateFrozenEmpiricalCampaignManifest,
} from "../../evals/empirical-memory-rerun-avoidance/qualification.js";
import { validateEmpiricalOutputSchemaCatalogEntry } from "../../evals/empirical-memory-rerun-avoidance/strict-json-shape.js";
import { strictJsonCodec } from "../json/codec.js";
import {
	buildEmpiricalCampaignFixture,
	buildEmpiricalCampaignManifestFixture,
	buildEmpiricalQualificationObservationFixture,
	empiricalFixtureDigest,
} from "./eval-support/empirical-memory-rerun-avoidance/fixtures.js";

const PACKAGE_ROOT_URL = new URL("../../", import.meta.url);
const GITIGNORE_URL = new URL("../../../../.gitignore", import.meta.url);
const PACKAGE_JSON_URL = new URL("../../package.json", import.meta.url);
const TSUP_CONFIG_URL = new URL("../../tsup.config.ts", import.meta.url);
const PUBLIC_BARREL_URLS = [
	new URL("../index.ts", import.meta.url),
	new URL("../solutions/index.ts", import.meta.url),
	new URL("../testing/index.ts", import.meta.url),
	new URL("../orchestration/index.ts", import.meta.url),
	new URL("../adapters/index.ts", import.meta.url),
];
const EMPIRICAL_SOURCE_URL = new URL(
	"../../evals/empirical-memory-rerun-avoidance/",
	import.meta.url,
);

function withWorkspace(
	observation: EmpiricalTaskQualificationObservationV1,
	workspace: Partial<EmpiricalTaskQualificationObservationV1["workspace"]>,
): EmpiricalTaskQualificationObservationV1 {
	return {
		...observation,
		workspace: { ...observation.workspace, ...workspace },
	};
}

function withCalibration(
	observation: EmpiricalTaskQualificationObservationV1,
	verifierCalibration: Partial<EmpiricalTaskQualificationObservationV1["verifierCalibration"]>,
): EmpiricalTaskQualificationObservationV1 {
	return {
		...observation,
		verifierCalibration: {
			...observation.verifierCalibration,
			...verifierCalibration,
		},
	};
}

function sourceFiles(directory: string): readonly string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory)) {
		const path = join(directory, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) files.push(...sourceFiles(path));
		else if (path.endsWith(".ts")) files.push(path);
	}
	return files;
}

describe("B112.6.1 private empirical campaign qualification", () => {
	it("freezes one canonical manifest only after all five tasks qualify", () => {
		const fixture = buildEmpiricalCampaignFixture();
		expect(fixture.catalog.tasks.map((task) => task.sourceStratum)).toEqual([
			"historical-pre-fix",
			"historical-pre-fix",
			"historical-pre-fix",
			"held-out-overlay",
			"held-out-overlay",
		]);
		expect(fixture.report).toMatchObject({
			qualified: true,
			issueCodes: [],
			observations: expect.any(Array),
		});
		expect(fixture.report.observations).toHaveLength(5);
		expect(
			createEmpiricalTaskQualificationReport(fixture.catalog, [...fixture.observations].reverse()),
		).toEqual(fixture.report);

		const frozen = freezeEmpiricalCampaignManifest(fixture.manifest, fixture.report);
		const second = freezeEmpiricalCampaignManifest(fixture.manifest, fixture.report);
		expect(frozen).toEqual(second);
		expect(frozen.manifestDigest).toBe(empiricalSha256(new Uint8Array(frozen.canonicalBytes)));
		expect(frozen.taskCatalogDigest).toBe(empiricalStrictJsonDigest(frozen.manifest.catalog));
		expect(frozen.manifest.qualification.reportDigest).toBe(
			empiricalSha256(strictJsonCodec.encode(fixture.report)),
		);
		expect(validateFrozenEmpiricalCampaignManifest(frozen, fixture.report)).toEqual(frozen);
		expect(validateEmpiricalCampaignManifestBytes(new Uint8Array(frozen.canonicalBytes))).toEqual(
			frozen.manifest,
		);
		expect(Object.isFrozen(frozen.manifest.catalog.tasks[0])).toBe(true);
		expect(Object.isFrozen(frozen.canonicalBytes)).toBe(true);
	});

	it("fails closed on catalog, report, canonical-byte, or schema substitution", () => {
		const fixture = buildEmpiricalCampaignFixture();
		const frozen = freezeEmpiricalCampaignManifest(fixture.manifest, fixture.report);
		const changedTask = {
			...fixture.catalog.tasks[0],
			acceptanceDigest: empiricalFixtureDigest("changed-acceptance"),
		};
		const changedCatalogManifest = {
			...fixture.manifest,
			catalog: {
				...fixture.catalog,
				tasks: [changedTask, ...fixture.catalog.tasks.slice(1)],
			},
		};
		expect(() => validateEmpiricalCampaignManifest(changedCatalogManifest)).toThrow(
			/taskCatalogDigest.*does not match/,
		);
		expect(() =>
			freezeEmpiricalCampaignManifest(
				{
					...fixture.manifest,
					qualification: {
						...fixture.manifest.qualification,
						reportDigest: empiricalFixtureDigest("replacement-report"),
					},
				},
				fixture.report,
			),
		).toThrow(/reportDigest.*does not match/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				fallback: "not-authorized",
			}),
		).toThrow(/manifest.*unexpected keys/);
		expect(() =>
			validateEmpiricalCampaignManifestBytes(
				new TextEncoder().encode(
					`${new TextDecoder().decode(new Uint8Array(frozen.canonicalBytes))}\n`,
				),
			),
		).toThrow(/not canonical/);
		expect(() =>
			validateFrozenEmpiricalCampaignManifest(
				{
					...frozen,
					manifestDigest: empiricalFixtureDigest("changed-manifest"),
				},
				fixture.report,
			),
		).toThrow(/manifestDigest.*does not match/);
	});

	it("reserves null as the no-output sentinel while retaining nested null shapes", () => {
		const outputEntry = (schema: unknown) => ({
			schemaRef: "output-schema-placeholder",
			role: "actor",
			schemaRevision: "output-schema-placeholder.v1",
			schema,
			schemaDigest: empiricalStrictJsonDigest(schema),
		});
		expect(() =>
			validateEmpiricalOutputSchemaCatalogEntry(
				outputEntry({ kind: "null" }),
				"manifest.schemaCatalog.outputs[0]",
			),
		).toThrow(/output schema root must not accept null/);
		const nullableRoot = {
			kind: "one-of",
			variants: [{ kind: "null" }, { kind: "string", minLength: 0, maxLength: 16, enum: null }],
		};
		expect(() =>
			validateEmpiricalOutputSchemaCatalogEntry(
				outputEntry(nullableRoot),
				"manifest.schemaCatalog.outputs[0]",
			),
		).toThrow(/output schema root must not accept null/);
		const nestedNull = {
			kind: "object",
			properties: [{ name: "detail", required: true, shape: { kind: "null" } }],
			additionalProperties: false,
		};
		expect(
			validateEmpiricalOutputSchemaCatalogEntry(
				outputEntry(nestedNull),
				"manifest.schemaCatalog.outputs[0]",
			).schema,
		).toEqual(nestedNull);
	});

	it("locks graphrefly-ts task identity and rejects aliased or invalid baseline material", () => {
		const fixture = buildEmpiricalCampaignFixture();
		const first = fixture.catalog.tasks[0];
		const heldOut = fixture.catalog.tasks[3];
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				catalog: {
					...fixture.catalog,
					tasks: [
						{ ...first, repositoryRef: "other-repository" },
						...fixture.catalog.tasks.slice(1),
					],
				},
			}),
		).toThrow(/repositoryRef/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				catalog: {
					...fixture.catalog,
					tasks: [
						first,
						{
							...first,
							taskRef: "qualification-placeholder-task-alias",
							verifierProfileRef: "verifier-profile-alias",
						},
						...fixture.catalog.tasks.slice(2),
					],
				},
			}),
		).toThrow(/semantic task identity must be unique/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				catalog: {
					...fixture.catalog,
					tasks: [
						{
							...first,
							actorTreeDigest: empiricalFixtureDigest("historical-actor-tree-mismatch"),
						},
						...fixture.catalog.tasks.slice(1),
					],
				},
			}),
		).toThrow(/historical task actor tree/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				catalog: {
					...fixture.catalog,
					tasks: [
						...fixture.catalog.tasks.slice(0, 3),
						{ ...heldOut, actorTreeDigest: heldOut?.originalTreeDigest },
						fixture.catalog.tasks[4],
					],
				},
			}),
		).toThrow(/held-out overlay must produce a distinct actor tree/);
	});

	it("rejects answer-leaking or state-sharing actor workspaces", () => {
		const fixture = buildEmpiricalCampaignFixture();
		const first = fixture.observations[0] as EmpiricalTaskQualificationObservationV1;
		const unsafeCases: readonly [
			Partial<EmpiricalTaskQualificationObservationV1["workspace"]>,
			string,
		][] = [
			[{ remotes: 1 }, "workspace-remotes-visible"],
			[{ descendantHistoryVisible: true }, "workspace-descendant-history-visible"],
			[{ uncommittedChanges: true }, "workspace-uncommitted-changes"],
			[{ overlayVisibleAsDiff: true }, "workspace-overlay-visible-as-diff"],
			[{ hiddenVerifierMaterialVisible: true }, "workspace-hidden-verifier-material-visible"],
			[{ expectedPatchVisible: true }, "workspace-expected-patch-visible"],
			[{ repositoryState: "other" }, "workspace-not-clean-single-baseline"],
			[{ freshMaterializationVerified: false }, "fresh-materialization-not-verified"],
			[{ sharedCacheMode: "mutable" }, "mutable-shared-cache"],
			[
				{ cleanupFailureClassifiedNonEvaluable: false },
				"cleanup-failure-not-classified-non-evaluable",
			],
		];
		for (const [workspace, issue] of unsafeCases) {
			const report = createEmpiricalTaskQualificationReport(fixture.catalog, [
				withWorkspace(first, workspace),
				...fixture.observations.slice(1),
			]);
			expect(report.qualified).toBe(false);
			expect(report.issueCodes.some((code) => code.endsWith(issue))).toBe(true);
			expect(() => freezeEmpiricalCampaignManifest(fixture.manifest, report)).toThrow(
				/catalog is not qualified|reportDigest/,
			);
		}
	});

	it("requires harness-evidenced verifier calibration and bounded non-evaluable behavior", () => {
		const fixture = buildEmpiricalCampaignFixture();
		const first = fixture.observations[0] as EmpiricalTaskQualificationObservationV1;
		const invalidCases: readonly [
			Partial<EmpiricalTaskQualificationObservationV1["verifierCalibration"]>,
			string,
		][] = [
			[{ executable: false }, "verifier-not-executable"],
			[{ targetDefectVerdict: "passed" }, "target-defect-not-rejected"],
			[{ knownGoodVerdict: "failed" }, "known-good-not-accepted"],
			[{ plausibleWrongVerdict: "passed" }, "plausible-wrong-not-rejected"],
			[{ actorClaimsCanSatisfy: true }, "actor-claim-can-satisfy-verifier"],
			[{ verifierTamperingRejected: false }, "verifier-tampering-not-rejected"],
			[{ testTamperingRejected: false }, "test-tampering-not-rejected"],
			[{ outOfPolicyDiffRejected: false }, "out-of-policy-diff-not-rejected"],
			[{ evidenceComplete: false }, "verifier-evidence-incomplete"],
			[
				{ missingEvidenceClassifiedNonEvaluable: false },
				"missing-evidence-not-classified-non-evaluable",
			],
			[
				{ unreliableEvidenceClassifiedNonEvaluable: false },
				"unreliable-evidence-not-classified-non-evaluable",
			],
			[
				{ nonExecutableEvidenceClassifiedNonEvaluable: false },
				"non-executable-evidence-not-classified-non-evaluable",
			],
		];
		for (const [calibration, issue] of invalidCases) {
			const report = createEmpiricalTaskQualificationReport(fixture.catalog, [
				withCalibration(first, calibration),
				...fixture.observations.slice(1),
			]);
			expect(report.qualified).toBe(false);
			expect(report.issueCodes.some((code) => code.endsWith(issue))).toBe(true);
		}

		const missing = createEmpiricalTaskQualificationReport(
			fixture.catalog,
			fixture.observations.slice(1),
		);
		expect(missing.issueCodes).toContain(`${first.taskRef}:qualification-observation-missing`);
		const duplicate = createEmpiricalTaskQualificationReport(fixture.catalog, [
			...fixture.observations,
			first,
		]);
		expect(duplicate.issueCodes).toContain(`${first.taskRef}:qualification-observation-duplicate`);
		expect(() =>
			createEmpiricalTaskQualificationReport(fixture.catalog, [
				withCalibration(first, {
					evidenceRefs: first.verifierCalibration.evidenceRefs.slice(1),
				}),
				...fixture.observations.slice(1),
			]),
		).toThrow(/complete closed qualification evidence set/);
		const conflictingEvidence = first.verifierCalibration.evidenceRefs.map((ref, index) =>
			index === 1
				? {
						...first.verifierCalibration.evidenceRefs[0],
						digest: empiricalFixtureDigest("conflicting-evidence"),
					}
				: ref,
		);
		expect(() =>
			createEmpiricalTaskQualificationReport(fixture.catalog, [
				withCalibration(first, { evidenceRefs: conflictingEvidence }),
				...fixture.observations.slice(1),
			]),
		).toThrow(/unique evidence identities/);
		const second = fixture.observations[1] as EmpiricalTaskQualificationObservationV1;
		const firstTaskEvidence = first.verifierCalibration.evidenceRefs.find(
			(ref) => ref.kind === "target-defect-verifier",
		);
		const reusedEvidence = second.verifierCalibration.evidenceRefs.map((ref) =>
			ref.kind === "target-defect-verifier"
				? {
						...ref,
						id: firstTaskEvidence?.id as string,
						digest: firstTaskEvidence?.digest as string,
					}
				: ref,
		);
		expect(() =>
			createEmpiricalTaskQualificationReport(fixture.catalog, [
				first,
				withCalibration(second, { evidenceRefs: reusedEvidence }),
				...fixture.observations.slice(2),
			]),
		).toThrow(/cannot be reused across different subjects/);
		const crossKindReusedEvidence = second.verifierCalibration.evidenceRefs.map((ref) =>
			ref.kind === "command-policy"
				? {
						...ref,
						digest: firstTaskEvidence?.digest as string,
					}
				: ref,
		);
		expect(() =>
			createEmpiricalTaskQualificationReport(fixture.catalog, [
				first,
				withCalibration(second, { evidenceRefs: crossKindReusedEvidence }),
				...fixture.observations.slice(2),
			]),
		).toThrow(/cannot be reused across different subjects/);
	});

	it("keeps provider coordinates explicit, focused, and capability-compatible", () => {
		const fixture = buildEmpiricalCampaignFixture();
		const actor = fixture.manifest.modelConfigurations[0];
		expect(actor).toMatchObject({
			role: "actor",
			providerFamily: "provider-family-placeholder",
			modelIdentityKind: "exact-snapshot",
			usageSource: "provider-reported",
			credentialPolicyRef: expect.any(String),
			credentialPolicyRevision: expect.any(String),
		});
		expect(fixture.manifest.policies).toMatchObject({
			rawArtifactPersistence: "disabled",
			repositoryEvidenceInclusion: "not-approved",
			auxiliaryJudge: { enabled: false },
			semanticRedactor: { enabled: false },
		});
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				modelConfigurations: [
					{
						...actor,
						capabilities: { ...actor?.capabilities, toolCalling: false },
					},
				],
			}),
		).toThrow(/toolCalling.*tools are required/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				modelConfigurations: [
					{
						...actor,
						endpoint: "https://credential@example.invalid/v1/model?mutable=1",
					},
				],
			}),
		).toThrow(/credential-free HTTPS endpoint/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				modelConfigurations: [{ ...actor, fallback: "not-authorized" }],
			}),
		).toThrow(/modelConfigurations.*unexpected keys/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				modelConfigurations: [{ ...actor, credentialValue: "not-authorized" }],
			}),
		).toThrow(/unexpected keys/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				schemaCatalog: {
					...fixture.manifest.schemaCatalog,
					outputs: [
						...fixture.manifest.schemaCatalog.outputs,
						{
							...fixture.manifest.schemaCatalog.outputs[0],
							schemaRef: "judge-output-placeholder",
							role: "auxiliary-judge",
						},
					],
				},
				modelConfigurations: [
					actor,
					{
						...actor,
						configurationRef: "judge-placeholder",
						role: "auxiliary-judge",
						settings: {
							...actor?.settings,
							output: {
								...actor?.settings.output,
								schemaRef: "judge-output-placeholder",
							},
						},
					},
				],
			}),
		).toThrow(/disabled auxiliary-judge role has a configuration/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				policies: { ...fixture.manifest.policies, rawArtifactPersistence: "enabled" },
			}),
		).toThrow(/rawArtifactPersistence/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				modelConfigurations: [
					actor,
					{
						...actor,
						configurationRef: "actor-model-alias",
					},
				],
			}),
		).toThrow(/model coordinates must be unique/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				modelConfigurations: [
					actor,
					{
						...actor,
						configurationRef: "actor-model-other-binding",
						bindingRevision: "other-binding-placeholder.v1",
					},
				],
			}),
		).toThrow(/exactly one provider/);
		const enabledJudgePolicy = {
			enabled: true,
			configurationRef: "judge-placeholder",
			policyRef: "judge-policy-placeholder",
			policyRevision: "judge-policy-placeholder.v1",
			credentialBindingRef: "judge-credential-binding-placeholder",
			credentialBindingRevision: "judge-credential-binding-placeholder.v1",
			tracePolicyRef: "judge-trace-policy-placeholder",
			tracePolicyRevision: "judge-trace-policy-placeholder.v1",
			inputAuthorityRef: "judge-input-authority-placeholder",
			inputAuthorityRevision: "judge-input-authority-placeholder.v1",
		} as const;
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				schemaCatalog: {
					...fixture.manifest.schemaCatalog,
					outputs: [
						...fixture.manifest.schemaCatalog.outputs,
						{
							...fixture.manifest.schemaCatalog.outputs[0],
							schemaRef: "judge-output-placeholder",
							role: "auxiliary-judge",
						},
					],
				},
				modelConfigurations: [
					actor,
					{
						...actor,
						configurationRef: "judge-placeholder",
						role: "auxiliary-judge",
						settings: {
							...actor?.settings,
							output: {
								...actor?.settings.output,
								schemaRef: "judge-output-placeholder",
							},
						},
					},
				],
				policies: {
					...fixture.manifest.policies,
					auxiliaryJudge: enabledJudgePolicy,
				},
			}),
		).toThrow(/credential policy must be isolated/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				policies: {
					...fixture.manifest.policies,
					auxiliaryJudge: {
						...fixture.manifest.policies.auxiliaryJudge,
						tracePolicyRef: "disabled-role-coordinate",
					},
				},
			}),
		).toThrow(/disabled role coordinates must be null/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				modelConfigurations: [
					{
						...actor,
						settings: {
							...actor?.settings,
							reasoning: { mode: "none", effort: "high" },
						},
						capabilities: { ...actor?.capabilities, reasoningControl: true },
					},
				],
			}),
		).toThrow(/reasoning.*effort/);
	});

	it("locks smoke/calibration shape, warm branches, and hierarchical budgets", () => {
		const fixture = buildEmpiricalCampaignFixture();
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				trialPlan: {
					...fixture.manifest.trialPlan,
					attemptedColdBlocksPerTask: 2,
				},
			}),
		).toThrow(/attemptedColdBlocksPerTask/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				trialPlan: {
					...fixture.manifest.trialPlan,
					branchOrder: [
						"relevant-applied",
						"proposal-only",
						"admission-rejected",
						"irrelevant-applied",
						"irrelevant-applied",
					],
				},
			}),
		).toThrow(/branchOrder.*unique/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				budgets: {
					...fixture.manifest.budgets,
					taskModel: { ...fixture.manifest.budgets.taskModel, maxRequests: 23 },
				},
			}),
		).toThrow(/cold plus five warm arms/);

		const calibration: EmpiricalCampaignManifestV1 = {
			...fixture.manifest,
			trialPlan: {
				profile: "calibration",
				activeTaskRefs: fixture.catalog.tasks.map((task) => task.taskRef),
				attemptedColdBlocksPerTask: 3,
				branchOrderMode: "explicit",
				branchOrder: fixture.manifest.trialPlan.branchOrder,
			},
			budgets: {
				...fixture.manifest.budgets,
				campaign: {
					...fixture.manifest.budgets.campaign,
					maxRequests: 360,
					maxCostMicrousd: 5_000_000,
				},
				taskModel: {
					...fixture.manifest.budgets.taskModel,
					maxAttemptedColdBlocks: 3,
					maxRequests: 72,
				},
			},
		};
		expect(validateEmpiricalCampaignManifest(calibration).trialPlan.profile).toBe("calibration");
		expect(() =>
			validateEmpiricalCampaignManifest({
				...calibration,
				trialPlan: {
					...calibration.trialPlan,
					activeTaskRefs: calibration.trialPlan.activeTaskRefs.slice(0, 4),
				},
			}),
		).toThrow(/activeTaskRefs/);
		expect(() =>
			validateEmpiricalCampaignManifest({
				...fixture.manifest,
				modelConfigurations: [
					{
						...fixture.manifest.modelConfigurations[0],
						settings: {
							...fixture.manifest.modelConfigurations[0]?.settings,
							tools: {
								...fixture.manifest.modelConfigurations[0]?.settings.tools,
								maxSteps: 9,
							},
						},
					},
				],
			}),
		).toThrow(/maxSteps.*agent-run/);
	});

	it("validates qualification report canonical bytes and derived verdict", () => {
		const fixture = buildEmpiricalCampaignFixture();
		const bytes = strictJsonCodec.encode(fixture.report);
		expect(validateEmpiricalTaskQualificationReportBytes(bytes, fixture.catalog)).toEqual(
			fixture.report,
		);
		expect(() =>
			validateEmpiricalTaskQualificationReport(
				{
					...fixture.report,
					qualified: false,
				},
				fixture.catalog,
			),
		).toThrow(/qualified.*issueCodes/);
		expect(() =>
			validateEmpiricalTaskQualificationReport(
				{
					...fixture.report,
					observations: [],
					qualified: true,
					issueCodes: [],
				},
				fixture.catalog,
			),
		).toThrow(/does not match the supplied catalog/);
		expect(() =>
			validateEmpiricalTaskQualificationReportBytes(
				new TextEncoder().encode(`${new TextDecoder().decode(bytes)}\n`),
				fixture.catalog,
			),
		).toThrow(/not canonical/);
	});

	it("keeps B112 empirical contracts private and outside runtime/build entries", () => {
		const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_URL, "utf8")) as {
			exports?: Record<string, unknown>;
			files?: readonly string[];
		};
		const forbidden = /empirical-memory-rerun-avoidance|empirical-campaign/i;
		expect(forbidden.test(JSON.stringify(packageJson.exports ?? {}))).toBe(false);
		expect(forbidden.test(JSON.stringify(packageJson.files ?? []))).toBe(false);
		expect(forbidden.test(readFileSync(TSUP_CONFIG_URL, "utf8"))).toBe(false);
		expect(readFileSync(GITIGNORE_URL, "utf8")).toContain(
			"packages/ts/evals/.private/empirical-memory-rerun-avoidance/",
		);
		for (const barrelUrl of PUBLIC_BARREL_URLS) {
			expect(forbidden.test(readFileSync(barrelUrl, "utf8"))).toBe(false);
		}

		const packageRoot = PACKAGE_ROOT_URL.pathname;
		for (const file of sourceFiles(join(packageRoot, "src")).filter(
			(path) => !path.includes(`${join("src", "__tests__")}`),
		)) {
			expect(readFileSync(file, "utf8")).not.toMatch(/evals\/empirical-memory-rerun-avoidance/);
		}
		for (const file of sourceFiles(EMPIRICAL_SOURCE_URL.pathname)) {
			const source = readFileSync(file, "utf8");
			const allowsOneTurnPromise =
				file.endsWith("model-execution.ts") ||
				file.endsWith("openai-responses-model-turn.ts") ||
				file.endsWith("openrouter-responses-model-turn.ts") ||
				file.endsWith("openrouter-first-task-capability-probe.ts");
			const allowsFocusedTransportAsync =
				file.endsWith("openai-responses-model-turn.ts") ||
				file.endsWith("openrouter-responses-model-turn.ts") ||
				file.endsWith("openrouter-first-task-capability-probe.ts");
			const allowsRepositoryNodeDriver = file.endsWith("single-baseline-repository-node.ts");
			const allowsClosedHostNodeDriver = file.endsWith("closed-task-profile-host.ts");
			const allowsClosedVerifierCalibration = file.endsWith(
				"closed-task-profile-verifier-calibration.ts",
			);
			const allowsD690SealedOfflineOperator = file.endsWith(
				"d690-historical-pair-qualification.ts",
			);
			const allowsOfflineQualification = file.endsWith("exact-five-task-offline-qualification.ts");
			const allowsD691HistoricalTransferOperator = file.endsWith(
				"d691-historical-transfer-live.ts",
			);
			const allowsD692OfflineForensicOperator = file.endsWith(
				"d692-historical-transfer-forensic.ts",
			);
			const allowsD693OfflineQualificationOperator = file.endsWith(
				"d693-assisted-progress-qualification.ts",
			);
			const allowsD694AssistedTransferOperator = file.endsWith("d694-assisted-progress-live.ts");
			const allowsD695OfflineQualificationOperator = file.endsWith(
				"d695-no-progress-continuation-qualification.ts",
			);
			const allowsD696ContinuationAssistedOperator = file.endsWith(
				"d696-continuation-assisted-live.ts",
			);
			const allowsPreliveOperatorDriver =
				file.endsWith("empirical-calibration.ts") ||
				allowsD691HistoricalTransferOperator ||
				allowsD692OfflineForensicOperator ||
				allowsD693OfflineQualificationOperator ||
				allowsD694AssistedTransferOperator ||
				allowsD695OfflineQualificationOperator ||
				allowsD696ContinuationAssistedOperator ||
				file.endsWith("openrouter-first-task-smoke.ts") ||
				file.endsWith("private-smoke-persistence.ts");
			const allowsOneRequestFetchTransport =
				file.endsWith("openrouter-responses-byte-transport.ts") ||
				file.endsWith("openrouter-current-key-spend-admission.ts");
			const allowsOutermostLiveOperator =
				file.endsWith("openrouter-first-task-smoke-operator.ts") ||
				file.endsWith("openrouter-first-task-capability-probe-operator.ts") ||
				file.endsWith("openrouter-calibration-operator.ts") ||
				file.endsWith("openrouter-d682-mechanical-qualification-operator.ts") ||
				file.endsWith("openrouter-developer-guidance-calibration-operator.ts") ||
				file.endsWith("openrouter-developer-guidance-calibration-runner.ts");
			const allowsDeveloperGuidanceRunner = file.endsWith(
				"openrouter-developer-guidance-calibration-runner.ts",
			);
			const allowsRetryTimerOperator = file.endsWith("openrouter-first-task-smoke-operator.ts");
			const allowsMatchedBlockMemory = file.endsWith("matched-block-memory.ts");
			const allowsD682MechanicalRecipe = file.endsWith("execution-qualified-mechanical-recipe.ts");
			const allowsD683ComparativeEvidence = file.endsWith("orchestration-comparative-evidence.ts");
			const allowsD683SourceAudit = file.endsWith("orchestration-comparative-source-audit.ts");
			const matchedBlockMemoryImports = new Set([
				"../../src/graph/graph.js",
				"../../src/node/node.js",
				"../../src/orchestration/work-item-runtime.js",
				"../../src/protocol/messages.js",
				"../../src/solutions/agentic-memory/index.js",
				"../../src/solutions/agentic-work-item-memory/index.js",
				"../../src/solutions/agentic-work-item-memory-application/index.js",
				"../../src/solutions/work-item/index.js",
			]);
			const d682MechanicalRecipeImports = new Set([
				"../../src/ctx/types.js",
				"../../src/data/index.js",
				"../../src/graph/graph.js",
				"../../src/json/codec.js",
				"../../src/node/node.js",
				"../../src/orchestration/agent-runtime.js",
				"../../src/orchestration/work-item-runtime.js",
				"../../src/solutions/work-item/scheduling.js",
			]);
			const d683ComparativeEvidenceImports = new Set([
				"../../src/data/index.js",
				"../../src/graph/graph.js",
				"../../src/node/node.js",
				"../../src/orchestration/agent-runtime.js",
				"../../src/orchestration/work-item-runtime.js",
				"../../src/solutions/work-item/scheduling.js",
			]);
			expect(source).not.toMatch(
				allowsD690SealedOfflineOperator
					? /\b(?:Date\.now|fetch\s*\(|WebSocket|setTimeout|setInterval|setImmediate|queueMicrotask)\b/
					: allowsOutermostLiveOperator
						? /\b(?:WebSocket|setInterval|setImmediate|queueMicrotask)\b|node:(?:http|https|net|tls|child_process)|(?:from|import)\s+["'](?:http|https|net|tls|child_process|undici|ws)["']/
						: allowsRepositoryNodeDriver ||
								allowsClosedHostNodeDriver ||
								allowsClosedVerifierCalibration ||
								allowsOfflineQualification ||
								allowsPreliveOperatorDriver
							? /\b(?:Date\.now|fetch|WebSocket|setTimeout|setInterval|setImmediate|queueMicrotask)\b|\b(?:require|import)\s*\(|node:(?:http|https|net|tls)|(?:from|import)\s+["'](?:http|https|net|tls|undici|ws)["']/
							: allowsOneRequestFetchTransport
								? /\b(?:Date\.now|WebSocket|setTimeout|setInterval|setImmediate|queueMicrotask)\b|\b(?:require|import)\s*\(|node:(?:http|https|net|tls|child_process)|(?:from|import)\s+["'](?:http|https|net|tls|child_process|undici|ws)["']/
								: allowsFocusedTransportAsync
									? /\b(?:Date\.now|fetch|WebSocket|setTimeout|setInterval|setImmediate|queueMicrotask)\b|\b(?:require|import)\s*\(|node:(?:http|https|net|tls|child_process)|(?:from|import)\s+["'](?:http|https|net|tls|child_process|undici|ws)["']/
									: allowsOneTurnPromise
										? /\b(?:async|Date\.now|fetch|WebSocket|setTimeout|setInterval|setImmediate|queueMicrotask)\b|\b(?:require|import)\s*\(|node:(?:http|https|net|tls|child_process)|(?:from|import)\s+["'](?:http|https|net|tls|child_process|undici|ws)["']/
										: /\b(?:async|Promise|Date\.now|fetch|WebSocket|setTimeout|setInterval|setImmediate|queueMicrotask)\b|\b(?:require|import)\s*\(|node:(?:http|https|net|tls|child_process)|(?:from|import)\s+["'](?:http|https|net|tls|child_process|undici|ws)["']/,
			);
			if (allowsRetryTimerOperator) {
				expect(source.match(/\bsetTimeout\b/g)).toHaveLength(1);
				expect(source.match(/\bclearTimeout\b/g)).toHaveLength(1);
			}
			if (allowsRepositoryNodeDriver || allowsClosedHostNodeDriver) {
				expect(source).not.toMatch(/(?:^|[^.A-Za-z0-9_$])(?:exec|execFile|fork)\s*\(/m);
			}
			if (allowsRepositoryNodeDriver) {
				expect(source).toContain('spawn(\n\t\t\t"git"');
			}
			if (allowsClosedHostNodeDriver) {
				expect(source).toContain("spawn(executable");
				expect(source).toContain("shell: false");
			}
			const imports = [
				...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g),
				...source.matchAll(/require\s*\(\s*["']([^"']+)["']\s*\)/g),
			].map((match) => match[1] as string);
			expect(
				imports.every(
					(specifier) =>
						specifier === "node:crypto" ||
						(allowsDeveloperGuidanceRunner &&
							(specifier === "node:fs" ||
								specifier === "node:readline/promises" ||
								specifier === "node:url")) ||
						((allowsRepositoryNodeDriver ||
							allowsClosedHostNodeDriver ||
							allowsD690SealedOfflineOperator) &&
							specifier === "node:child_process") ||
						((allowsRepositoryNodeDriver ||
							allowsClosedHostNodeDriver ||
							allowsD690SealedOfflineOperator ||
							allowsPreliveOperatorDriver ||
							allowsOutermostLiveOperator) &&
							(specifier === "node:fs/promises" || specifier === "node:path")) ||
						(allowsD690SealedOfflineOperator &&
							(specifier === "node:fs" || specifier === "node:os")) ||
						((allowsD691HistoricalTransferOperator || allowsOutermostLiveOperator) &&
							specifier === "node:url") ||
						specifier === "../../src/json/codec.js" ||
						(allowsMatchedBlockMemory && matchedBlockMemoryImports.has(specifier)) ||
						(allowsD682MechanicalRecipe && d682MechanicalRecipeImports.has(specifier)) ||
						(allowsD683ComparativeEvidence && d683ComparativeEvidenceImports.has(specifier)) ||
						(allowsD683SourceAudit && specifier === "typescript") ||
						specifier.startsWith("./"),
				),
			).toBe(true);
		}
	});

	it("consumes one exact 0600 bounded D688 attestation and rejects unsafe files", async () => {
		const root = mkdtempSync(join(tmpdir(), "graphrefly-d688-attestation-"));
		try {
			const validPath = join(root, "valid.json");
			writeFileSync(validPath, '{"qualified":true}', { mode: 0o600 });
			chmodSync(validPath, 0o600);
			await expect(
				readAndConsumeD688FreshRouteAttestation({
					path: validPath,
					signal: new AbortController().signal,
				}),
			).resolves.toEqual({ qualified: true });
			expect(existsSync(validPath)).toBe(false);
			await expect(
				readAndConsumeD688FreshRouteAttestation({
					path: validPath,
					signal: new AbortController().signal,
				}),
			).rejects.toThrow();

			const permissivePath = join(root, "permissive.json");
			writeFileSync(permissivePath, '{"qualified":true}', { mode: 0o640 });
			chmodSync(permissivePath, 0o640);
			await expect(
				readAndConsumeD688FreshRouteAttestation({
					path: permissivePath,
					signal: new AbortController().signal,
				}),
			).rejects.toThrow(/0600/);
			expect(existsSync(permissivePath)).toBe(false);

			const oversizedPath = join(root, "oversized.json");
			writeFileSync(oversizedPath, "x".repeat(262_145), { mode: 0o600 });
			chmodSync(oversizedPath, 0o600);
			await expect(
				readAndConsumeD688FreshRouteAttestation({
					path: oversizedPath,
					signal: new AbortController().signal,
				}),
			).rejects.toThrow(/bounded/);
			expect(existsSync(oversizedPath)).toBe(false);

			const targetPath = join(root, "target.json");
			const symlinkPath = join(root, "symlink.json");
			writeFileSync(targetPath, '{"secret":"must-not-read"}', { mode: 0o600 });
			symlinkSync(targetPath, symlinkPath);
			await expect(
				readAndConsumeD688FreshRouteAttestation({
					path: symlinkPath,
					signal: new AbortController().signal,
				}),
			).rejects.toThrow();
			expect(existsSync(symlinkPath)).toBe(false);
			expect(readFileSync(targetPath, "utf8")).toContain("must-not-read");

			const abortedPath = join(root, "aborted.json");
			writeFileSync(abortedPath, '{"qualified":true}', { mode: 0o600 });
			const aborted = new AbortController();
			aborted.abort();
			await expect(
				readAndConsumeD688FreshRouteAttestation({
					path: abortedPath,
					signal: aborted.signal,
				}),
			).rejects.toMatchObject({ name: "AbortError" });
			expect(existsSync(abortedPath)).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps calibration fixtures synthetic rather than freezing the real five-task catalog", () => {
		const fixture = buildEmpiricalCampaignFixture();
		expect(fixture.catalog.taskCatalogRevision).toBe("qualification-catalog-placeholder.v1");
		expect(fixture.manifest.campaignRef).toBe("campaign-placeholder");
		expect(fixture.manifest.modelConfigurations[0]?.endpoint).toBe(
			"https://provider.invalid/v1/model",
		);
		expect(
			fixture.catalog.tasks.every(
				(task) => task.taskRef.includes("placeholder") && task.repositoryRef === "graphrefly-ts",
			),
		).toBe(true);
		expect(fixture.catalog.tasks.map((task) => task.originalCommitSha)).toEqual([
			"1".repeat(40),
			"2".repeat(40),
			"3".repeat(40),
			"4".repeat(40),
			"5".repeat(40),
		]);
		const incompleteReport = createEmpiricalTaskQualificationReport(fixture.catalog, [
			buildEmpiricalQualificationObservationFixture(fixture.catalog.tasks[0]),
		]);
		const incompleteManifest = buildEmpiricalCampaignManifestFixture(
			fixture.catalog,
			incompleteReport,
		);
		expect(() => freezeEmpiricalCampaignManifest(incompleteManifest, incompleteReport)).toThrow(
			/catalog is not qualified/,
		);
	});
});

function buildCalibrationFixture(): ReturnType<typeof buildEmpiricalCampaignFixture> & {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
} {
	const fixture = buildEmpiricalCampaignFixture();
	const manifest: EmpiricalCampaignManifestV1 = {
		...fixture.manifest,
		trialPlan: {
			profile: "calibration",
			activeTaskRefs: fixture.catalog.tasks.map((task) => task.taskRef),
			attemptedColdBlocksPerTask: 3,
			branchOrderMode: "explicit",
			branchOrder: fixture.manifest.trialPlan.branchOrder,
		},
		budgets: {
			...fixture.manifest.budgets,
			campaign: {
				maxRequests: 360,
				maxCostMicrousd: 5_000_000,
				maxElapsedMs: 600_000,
			},
			taskModel: {
				maxAttemptedColdBlocks: 3,
				maxRequests: 72,
				maxCostMicrousd: 1_000_000,
			},
		},
		aggregation: {
			...fixture.manifest.aggregation,
			intervalRevision: B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION,
		},
	};
	return Object.freeze({
		...fixture,
		manifest,
		frozen: freezeEmpiricalCampaignManifest(manifest, fixture.report),
	});
}

function calibrationSimulationBlock(input: {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly task: EmpiricalCampaignTaskV1;
	readonly blockIndex: 1 | 2 | 3;
	readonly coldPassed?: boolean;
}) {
	const coldPassed = input.coldPassed ?? false;
	const actorConfiguration = input.frozen.manifest.modelConfigurations.find(
		(configuration) => configuration.role === "actor",
	);
	if (actorConfiguration === undefined) throw new TypeError("missing actor configuration fixture");
	const warmArms = input.frozen.manifest.trialPlan.branchOrder.map((branchKind) => ({
		branchKind,
		outcome: coldPassed
			? ("not-attempted" as const)
			: branchKind === "relevant-applied"
				? ("passed" as const)
				: ("failed" as const),
		simulatedRequests: coldPassed ? 0 : 1,
		issueCodes: [],
	}));
	return {
		schemaVersion: B112_CALIBRATION_SIMULATION_BLOCK_SCHEMA,
		evidenceClass: "simulated-contract",
		empiricalEvidence: false,
		campaignRef: input.frozen.manifest.campaignRef,
		manifestDigest: input.frozen.manifestDigest,
		configurationRef: actorConfiguration.configurationRef,
		configurationDigest: empiricalStrictJsonDigest(actorConfiguration),
		taskRef: input.task.taskRef,
		taskDigest: empiricalStrictJsonDigest(input.task),
		blockIndex: input.blockIndex,
		coldOutcome: coldPassed ? "passed" : "verified-failure",
		coldSimulatedRequests: 1,
		warmArms,
		issueCodes: [],
	};
}

function calibrationEmpiricalObservation(input: {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly task: EmpiricalCampaignTaskV1;
	readonly blockIndex: 1 | 2 | 3;
	readonly aggregateLatencyMs?: number;
	readonly qualificationRevision?: string;
}): EmpiricalCalibrationTrialBlockObservationV4 {
	const actor = input.frozen.manifest.modelConfigurations.find(
		(configuration) => configuration.role === "actor",
	);
	if (actor === undefined) throw new TypeError("missing actor configuration fixture");
	const valueDigest = (value: string) => empiricalStrictJsonDigest({ value });
	const emptyDigest = empiricalStrictJsonDigest([]);
	const selectedRecordDigest = valueDigest(
		`${input.task.taskRef}:${input.blockIndex}:selected-memory`,
	);
	const route = {
		qualificationRef: `qualification.${input.task.taskRef}.${input.blockIndex}`,
		qualificationRevision: input.qualificationRevision ?? "qualification.calibration.v4.rev1",
		qualificationDigest: valueDigest(
			`qualification.calibration.v4:${input.task.taskRef}:${input.blockIndex}`,
		),
		configurationRef: actor.configurationRef,
		configurationDigest: empiricalStrictJsonDigest(actor),
		model: actor.model,
		modelIdentityKind: actor.modelIdentityKind,
		providerFamily: "openrouter" as const,
		downstreamProviderSlug: "fixture-provider",
		downstreamProviderName: "fixture-provider",
		endpoint: "https://provider.invalid/v1/model",
		endpointRevision: "fixture-endpoint.v1",
		adapterRevision: "fixture-adapter.v1",
		bindingRevision: "fixture-binding.v1",
		capabilitiesDigest: valueDigest("fixture-capabilities"),
		settingsDigest: valueDigest("fixture-settings"),
		usageSource: "fixture-usage",
		usageRevision: "fixture-usage.v1",
		routeEvidenceSchemaRevision: "fixture-route-evidence.v1",
		pricingSourceUrl: "https://provider.invalid/pricing",
		pricingRevision: "fixture-pricing.v1",
		inputMicrousdPerMillionTokens: 1,
		outputMicrousdPerMillionTokens: 1,
		budgetApprovalRef: "fixture-budget",
		budgetApprovalRevision: "fixture-budget.v1",
		maxSmokeSpendMicrousd: 1_000_000,
		maxRequests: 64,
		maxStepsPerRun: 8,
		maxCanonicalRequestBytes: 262_144,
		maxInputTokens: 1_000_000,
		maxOutputTokens: 65_536,
		maxLatencyMs: 600_000,
		reservationRevision: "fixture-reservation.v1",
	};
	const run = (
		runRef: string,
		trialStage: "cold" | "warm",
		branchKind:
			| EmpiricalCalibrationTrialBlockObservationV4["warmBranches"][number]["branchKind"]
			| null,
		verifierStatus: "passed" | "failed",
		memoryContextRecordDigest: string | null,
	) => {
		const syntheticAttempt = runRef === "cold" && input.aggregateLatencyMs !== undefined;
		const requestDigest = valueDigest(
			`${input.task.taskRef}:${input.blockIndex}:${runRef}:request`,
		);
		const protectionReceiptDigest = valueDigest(
			`${input.task.taskRef}:${input.blockIndex}:${runRef}:protection`,
		);
		const routeEvidenceDigest = valueDigest(
			`${input.task.taskRef}:${input.blockIndex}:${runRef}:route`,
		);
		return {
			runRef,
			trialStage,
			branchKind,
			classification: verifierStatus === "passed" ? ("complete" as const) : ("incomplete" as const),
			verifierStatus,
			requests: syntheticAttempt ? 1 : 0,
			steps: syntheticAttempt ? 1 : 0,
			attempts: syntheticAttempt ? 1 : 0,
			retryWaitMs: 0,
			inputTokens: null,
			outputTokens: null,
			totalTokens: null,
			hostInputBytes: 0,
			hostOutputBytes: 0,
			latencyMs: runRef === "cold" ? (input.aggregateLatencyMs ?? 0) : 0,
			costMicrousd: 0,
			costBasis: "simulated-contract" as const,
			reservedInputTokens: 0,
			reservedOutputTokens: 0,
			hostOutcomeDigest: valueDigest(`${input.task.taskRef}:${input.blockIndex}:${runRef}`),
			initialRequestDigest: syntheticAttempt ? requestDigest : null,
			memoryContextRecordDigest,
			turnRequestDigests: syntheticAttempt ? [requestDigest] : [],
			attemptTrace: syntheticAttempt
				? [
						{
							stepIndex: 0,
							attemptOrdinal: 1,
							requestDigest,
							status: "completed" as const,
							requests: 1 as const,
							latencyMs: input.aggregateLatencyMs ?? 0,
							issueCodes: [],
							protectionReceiptDigest,
						},
					]
				: [],
			retryWaitTrace: [],
			toolResultBindings: [],
			workspaceBaselineDigest: null,
			workspaceStateDigest: null,
			workspaceChangeDigest: null,
			workspaceChanged: null,
			actionTraceDigest: emptyDigest,
			actionTrace: [],
			routeEvidenceDigests: syntheticAttempt ? [routeEvidenceDigest] : [],
			verifierEvidenceDigests: [],
			protectionReceiptDigests: syntheticAttempt ? [protectionReceiptDigest] : [],
			issueCodes: [],
		};
	};
	const cold = run("cold", "cold", null, "failed", null);
	const warmBranches = input.frozen.manifest.trialPlan.branchOrder.map((branchKind, index) => {
		const relevant = branchKind === "relevant-applied";
		const proposalOnly = branchKind === "proposal-only";
		const admissionRejected = branchKind === "admission-rejected";
		const irrelevant = branchKind === "irrelevant-applied";
		const admitted = relevant || irrelevant || branchKind === "wrong-scope-applied";
		const retrieved = admitted;
		const warmRun = run(
			`warm-${index + 1}`,
			"warm",
			branchKind,
			relevant ? "passed" : "failed",
			relevant ? selectedRecordDigest : null,
		);
		return {
			branchKind,
			attempted: true,
			lifecycle: {
				branchKind,
				selectedRecordDigest,
				proposalState: "emitted" as const,
				admissionState: admissionRejected
					? ("rejected" as const)
					: proposalOnly
						? ("not-run" as const)
						: ("admitted" as const),
				applicationState: proposalOnly
					? ("not-run" as const)
					: admitted
						? ("applied" as const)
						: ("not-applied" as const),
				retrievalState: retrieved ? ("retrieved" as const) : ("not-retrieved" as const),
				plannerRoute: relevant ? ("memory-guided" as const) : ("baseline" as const),
				traceMemoryDisposition: relevant
					? ("delivered" as const)
					: irrelevant
						? ("rejected-irrelevant" as const)
						: branchKind === "wrong-scope-applied"
							? ("rejected-scope" as const)
							: ("none" as const),
				mapperExplicitCandidates: 0 as const,
				proposalRecordDigests: [selectedRecordDigest],
				admissionRecordDigests: admitted ? [selectedRecordDigest] : [],
				applicationRecordDigests: admitted ? [selectedRecordDigest] : [],
				retrievalRecordDigests: retrieved ? [selectedRecordDigest] : [],
				topologyDigest: valueDigest(`${branchKind}:topology`),
				stagePredicates: {
					cold_run_failed: true,
					memory_record_proposed: true,
					memory_record_admitted: admitted,
					memory_record_applied: admitted,
					memory_record_retrieved: retrieved,
					warm_run_passed: relevant,
					warm_decision_trace_includes_memory: false,
					warm_action_trace_bound_to_memory_context: false,
					same_work_item_input: true,
					prior_failure_route_avoided: false,
				},
				caseConforms: !relevant,
				issueCodes: [],
			},
			run: warmRun,
			issueCodes: [],
		};
	});
	const trialBlock = createB112CalibrationTrialBlockIdentity(
		input.frozen,
		input.task.taskRef,
		input.blockIndex,
	);
	const attemptedRuns = [
		cold,
		...warmBranches.flatMap((branch) => (branch.run === null ? [] : [branch.run])),
	];
	const syntheticRunCount = input.aggregateLatencyMs === undefined ? 0 : 1;
	return validateEmpiricalCalibrationTrialBlockObservation({
		schemaVersion: EMPIRICAL_CALIBRATION_TRIAL_BLOCK_OBSERVATION_SCHEMA,
		executionClass: "simulated-contract",
		empiricalLiveEvidence: false,
		claimBoundary: B112_CALIBRATION_EXPLORATORY_NO_EFFICACY_CLAIM,
		campaignRef: input.frozen.manifest.campaignRef,
		manifestDigest: input.frozen.manifestDigest,
		profile: "calibration",
		taskRef: input.task.taskRef,
		taskDigest: empiricalStrictJsonDigest(input.task),
		blockIndex: input.blockIndex,
		...trialBlock,
		route,
		result: {
			classification: "complete",
			verifierStatus: "failed",
			coldRunsAttempted: 1,
			warmRunsAttempted: 5,
			requests: syntheticRunCount,
			steps: syntheticRunCount,
			attempts: syntheticRunCount,
			inputTokens: null,
			outputTokens: null,
			totalTokens: null,
			hostInputBytes: 0,
			hostOutputBytes: 0,
			latencyMs: input.aggregateLatencyMs ?? 0,
			costMicrousd: 0,
			costBasis: "simulated-contract",
			reservedInputTokens: 0,
			reservedOutputTokens: 0,
		},
		hostOutcomeDigest: cold.hostOutcomeDigest,
		routeEvidenceDigests: attemptedRuns.flatMap((run) => run.routeEvidenceDigests).sort(),
		verifierEvidenceDigests: [],
		protectionReceiptDigests: attemptedRuns.flatMap((run) => run.protectionReceiptDigests).sort(),
		cold,
		rerunEligible: true,
		reflection: {
			evidenceDigest: valueDigest(`${input.task.taskRef}:${input.blockIndex}:reflection`),
			candidateRecordDigests: [selectedRecordDigest],
			issueCodes: [],
		},
		warmBranches,
		familyPassed: false,
		issueCodes: [],
	});
}

function incompleteCalibrationObservation(
	observation: EmpiricalCalibrationTrialBlockObservationV4,
): EmpiricalCalibrationTrialBlockObservationV4 {
	const warmBranches = observation.warmBranches.map((branch, index) =>
		index === observation.warmBranches.length - 1
			? {
					...branch,
					attempted: false as const,
					lifecycle: null,
					run: null,
					issueCodes: ["warm-branch-not-attempted"],
				}
			: branch,
	);
	return validateEmpiricalCalibrationTrialBlockObservation({
		...observation,
		result: {
			...observation.result,
			classification: "incomplete",
			warmRunsAttempted: observation.result.warmRunsAttempted - 1,
		},
		warmBranches,
		familyPassed: null,
		issueCodes: ["smoke-cold-failed-warm-arms-incomplete", "warm-branch-not-attempted"].sort(),
	});
}

function budgetExhaustedCalibrationObservation(
	observation: EmpiricalCalibrationTrialBlockObservationV4,
	issueCode = "agent-step-budget-exhausted",
): EmpiricalCalibrationTrialBlockObservationV4 {
	const incomplete = incompleteCalibrationObservation(observation);
	const warmBranches = incomplete.warmBranches.map((branch, index) =>
		index === incomplete.warmBranches.length - 1
			? { ...branch, issueCodes: [...branch.issueCodes, issueCode].sort() }
			: branch,
	);
	return validateEmpiricalCalibrationTrialBlockObservation({
		...incomplete,
		warmBranches,
		issueCodes: [...incomplete.issueCodes, issueCode].sort(),
	});
}

function calibrationEmpiricalBlockResult(
	observation: EmpiricalCalibrationTrialBlockObservationV4,
	budgetExhaustionScope: "none" | "block" | "task" | "campaign" = "none",
	costAdmissionRejection: Parameters<
		typeof createB112CalibrationEmpiricalBlockResult
	>[0]["costAdmissionRejection"] = null,
) {
	return createB112CalibrationEmpiricalBlockResult({
		observation,
		budgetExhaustionScope,
		costAdmissionRejection,
	});
}

function calibrationCostAdmissionRejection(limitMicrousd: number) {
	return {
		schemaVersion: "b112-smoke-admission-rejection.v1" as const,
		requestRef: "calibration-cost-admission",
		reasons: ["cost-reservation"],
		requests: 0,
		maxRequests: 64,
		maxStepsPerRun: 8,
		wireRequestBytes: 1,
		maxCanonicalRequestBytes: 262_144,
		reservedInputTokens: 0,
		prospectiveInputTokens: 1,
		maxInputTokens: 1_000_000,
		reservedOutputTokens: 0,
		prospectiveOutputTokens: 1,
		maxOutputTokens: 65_536,
		reservedCostMicrousd: 0,
		prospectiveCostMicrousd: limitMicrousd + 1,
		maxSmokeSpendMicrousd: limitMicrousd,
	};
}

describe("B112 D676 no-network calibration core", () => {
	it("runs the frozen five tasks by three blocks serially and aggregates task clusters", async () => {
		const fixture = buildCalibrationFixture();
		const schedule: string[] = [];
		let active = 0;
		let maxActive = 0;
		const execute = () =>
			runB112CalibrationSimulation({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				signal: new AbortController().signal,
				runScriptedBlock: async ({ task, blockIndex, blockOrdinal }) => {
					active += 1;
					maxActive = Math.max(maxActive, active);
					schedule.push(`${blockOrdinal}:${task.taskRef}:${blockIndex}`);
					await Promise.resolve();
					active -= 1;
					return calibrationSimulationBlock({ frozen: fixture.frozen, task, blockIndex });
				},
			});

		const first = await execute();
		const second = await execute();
		expect(maxActive).toBe(1);
		expect(schedule.slice(0, 15)).toEqual(
			fixture.catalog.tasks.flatMap((task, taskIndex) =>
				([1, 2, 3] as const).map(
					(blockIndex) => `${taskIndex * 3 + blockIndex}:${task.taskRef}:${blockIndex}`,
				),
			),
		);
		expect(first.blocks).toHaveLength(15);
		expect(first.summary).toMatchObject({
			evidenceClass: "simulated-contract",
			empiricalEvidence: false,
			profile: "calibration",
			efficacyClaim: "none",
			status: "simulation-complete",
			plannedBlocks: 15,
			attemptedBlocks: 15,
			eligibleColdFailures: 15,
			warmRunsAttempted: 75,
			warmRunsEvaluable: 75,
			primaryComparison: {
				evaluableTaskClusters: 5,
				evaluablePairs: 15,
				relevantOnly: 15,
				controlOnly: 0,
				pointEstimate: 1,
				interval95: {
					lower: 1,
					upper: 1,
					resampleCount: 3_125,
				},
			},
		});
		expect(first.summary.secondaryComparisons).toHaveLength(3);
		expect(first.summary.taskResults.map((task) => task.primaryEffect)).toEqual([1, 1, 1, 1, 1]);
		expect(empiricalStrictJsonDigest(first.summary)).toBe(
			empiricalStrictJsonDigest(second.summary),
		);
	});

	it("keeps cold passes out of warm execution and reports task-first effects", async () => {
		const fixture = buildCalibrationFixture();
		const firstTaskRef = fixture.catalog.tasks[0]?.taskRef;
		const result = await runB112CalibrationSimulation({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			signal: new AbortController().signal,
			runScriptedBlock: async ({ task, blockIndex }) =>
				calibrationSimulationBlock({
					frozen: fixture.frozen,
					task,
					blockIndex,
					coldPassed: task.taskRef === firstTaskRef && blockIndex === 1,
				}),
		});
		expect(result.blocks[0]).toMatchObject({
			coldOutcome: "passed",
		});
		expect(result.blocks[0]?.warmArms.every((arm) => arm.outcome === "not-attempted")).toBe(true);
		expect(result.summary.warmRunsAttempted).toBe(70);
		expect(result.summary.taskResults[0]).toMatchObject({
			attemptedBlocks: 3,
			eligibleColdFailures: 2,
			evaluablePrimaryPairs: 2,
			primaryEffect: 1,
		});
	});

	it("fails closed when a scripted run crosses frozen request bounds or substitutes identity", async () => {
		const fixture = buildCalibrationFixture();
		await expect(
			runB112CalibrationSimulation({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				signal: new AbortController().signal,
				runScriptedBlock: async ({ task, blockIndex }) => {
					const block = calibrationSimulationBlock({ frozen: fixture.frozen, task, blockIndex });
					return {
						...block,
						warmArms: block.warmArms.map((arm) =>
							arm.branchKind === "relevant-applied" ? { ...arm, simulatedRequests: 5 } : arm,
						),
					};
				},
			}),
		).rejects.toThrow(/expected safe integer/);

		const task = fixture.catalog.tasks[0] as EmpiricalCampaignTaskV1;
		const baseBlock = calibrationSimulationBlock({ frozen: fixture.frozen, task, blockIndex: 1 });
		await expect(
			runB112CalibrationSimulation({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				signal: new AbortController().signal,
				runScriptedBlock: async ({ task: scheduledTask, blockIndex }) => ({
					...calibrationSimulationBlock({
						frozen: fixture.frozen,
						task: scheduledTask,
						blockIndex,
					}),
					coldSimulatedRequests: 0,
				}),
			}),
		).rejects.toThrow(/completed simulated cold run requires at least one request/);
		const noWarmResult = await runB112CalibrationSimulation({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			signal: new AbortController().signal,
			runScriptedBlock: async ({ task: scheduledTask, blockIndex }) => {
				const block = calibrationSimulationBlock({
					frozen: fixture.frozen,
					task: scheduledTask,
					blockIndex,
				});
				if (scheduledTask.taskRef !== task.taskRef || blockIndex !== 1) return block;
				return {
					...baseBlock,
					warmArms: baseBlock.warmArms.map((arm) => ({
						...arm,
						outcome: "not-attempted" as const,
						simulatedRequests: 0,
					})),
					issueCodes: ["budget-exhausted-after-cold"],
				};
			},
		});
		expect(noWarmResult.summary).toMatchObject({
			status: "incomplete",
			incompleteBlocks: 1,
			warmRunsAttempted: 70,
		});
		await expect(
			runB112CalibrationSimulation({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				signal: new AbortController().signal,
				runScriptedBlock: async ({ task: scheduledTask, blockIndex }) => ({
					...calibrationSimulationBlock({
						frozen: fixture.frozen,
						task: scheduledTask,
						blockIndex,
					}),
					taskRef: fixture.catalog.tasks[1]?.taskRef,
				}),
			}),
		).rejects.toThrow(/scheduled frozen task block/);
		await expect(
			runB112CalibrationSimulation({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				signal: new AbortController().signal,
				runScriptedBlock: async ({ task: scheduledTask, blockIndex }) => ({
					...calibrationSimulationBlock({
						frozen: fixture.frozen,
						task: scheduledTask,
						blockIndex,
					}),
					issueCodes: ["simulation-request-budget-exhausted"],
				}),
			}),
		).rejects.toThrow(/reserved for the scheduler/);
		await expect(
			runB112CalibrationSimulation({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				signal: new AbortController().signal,
				runScriptedBlock: async ({ task: scheduledTask, blockIndex }) => {
					const block = calibrationSimulationBlock({
						frozen: fixture.frozen,
						task: scheduledTask,
						blockIndex,
					});
					return {
						...block,
						warmArms: block.warmArms.map((arm) =>
							arm.branchKind === "wrong-scope-applied"
								? { ...arm, outcome: "not-attempted" as const, simulatedRequests: 0 }
								: arm,
						),
					};
				},
			}),
		).rejects.toThrow(/incomplete cold path requires an issue/);
		expect(exhaustiveTaskClusterInterval95([1])).toBeNull();
		expect(() => exhaustiveTaskClusterInterval95([Number.NaN])).toThrow(/finite number/);
		expect(() =>
			exhaustiveTaskClusterInterval95(["not-a-number"] as unknown as readonly number[]),
		).toThrow(/finite number/);
		expect(exhaustiveTaskClusterInterval95([1, 0, -1])).toMatchObject({
			lower: -1,
			upper: 1,
			resampleCount: 27,
		});
	});

	it("uses the frozen branch permutation and rejects custom array iteration", async () => {
		const source = buildCalibrationFixture();
		const branchOrder = [...source.manifest.trialPlan.branchOrder].reverse();
		const manifest: EmpiricalCampaignManifestV1 = {
			...source.manifest,
			trialPlan: { ...source.manifest.trialPlan, branchOrder },
		};
		const frozen = freezeEmpiricalCampaignManifest(manifest, source.report);
		const result = await runB112CalibrationSimulation({
			frozen,
			qualificationReport: source.report,
			signal: new AbortController().signal,
			runScriptedBlock: async ({ task, blockIndex }) =>
				calibrationSimulationBlock({ frozen, task, blockIndex }),
		});
		expect(result.blocks[0]?.warmArms.map((arm) => arm.branchKind)).toEqual(branchOrder);
		expect(result.summary.primaryComparison.pointEstimate).toBe(1);

		const hostile = Object.setPrototypeOf([1, 0], {
			[Symbol.iterator](): Iterator<number> {
				throw new Error("caller iterator must not run");
			},
		});
		expect(exhaustiveTaskClusterInterval95(hostile)).toMatchObject({ resampleCount: 4 });
	});

	it("fails closed instead of under-scheduling multiple actor configurations", async () => {
		const source = buildCalibrationFixture();
		const primary = source.manifest.modelConfigurations[0];
		if (primary === undefined) throw new TypeError("missing primary actor configuration");
		const manifest: EmpiricalCampaignManifestV1 = {
			...source.manifest,
			modelConfigurations: [
				primary,
				{
					...primary,
					configurationRef: "actor-model-secondary",
					model: "model-secondary-snapshot",
				},
			],
			budgets: {
				...source.manifest.budgets,
				campaign: {
					...source.manifest.budgets.campaign,
					maxRequests: 720,
					maxCostMicrousd: 10_000_000,
				},
			},
		};
		const frozen = freezeEmpiricalCampaignManifest(manifest, source.report);
		await expect(
			runB112CalibrationSimulation({
				frozen,
				qualificationReport: source.report,
				signal: new AbortController().signal,
				runScriptedBlock: async ({ task, blockIndex }) =>
					calibrationSimulationBlock({ frozen, task, blockIndex }),
			}),
		).rejects.toThrow(/exactly one frozen actor configuration/);
	});

	it("keeps simulated non-evaluable arms out of the D676 denominator", async () => {
		const fixture = buildCalibrationFixture();
		const firstTaskRef = fixture.catalog.tasks[0]?.taskRef;
		const result = await runB112CalibrationSimulation({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			signal: new AbortController().signal,
			runScriptedBlock: async ({ task, blockIndex }) => {
				const block = calibrationSimulationBlock({ frozen: fixture.frozen, task, blockIndex });
				if (task.taskRef !== firstTaskRef || blockIndex !== 1) return block;
				return {
					...block,
					warmArms: block.warmArms.map((arm) =>
						arm.branchKind === "relevant-applied"
							? {
									...arm,
									outcome: "non-evaluable" as const,
									issueCodes: ["provider-unavailable"],
								}
							: arm,
					),
				};
			},
		});
		expect(result.summary).toMatchObject({
			empiricalEvidence: false,
			efficacyClaim: "none",
			status: "incomplete",
			nonEvaluableBlocks: 1,
			primaryComparison: { evaluablePairs: 14 },
		});
		expect(result.summary.taskResults[0]).toMatchObject({
			evaluablePrimaryPairs: 2,
			nonEvaluableBlocks: 1,
		});
	});

	it("weights task clusters equally instead of pooling their block counts", async () => {
		const fixture = buildCalibrationFixture();
		const positiveTaskRef = fixture.catalog.tasks[0]?.taskRef;
		const negativeTaskRef = fixture.catalog.tasks[1]?.taskRef;
		const result = await runB112CalibrationSimulation({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			signal: new AbortController().signal,
			runScriptedBlock: async ({ task, blockIndex }) => {
				const block = calibrationSimulationBlock({ frozen: fixture.frozen, task, blockIndex });
				return {
					...block,
					warmArms: block.warmArms.map((arm) => {
						if (task.taskRef === positiveTaskRef && blockIndex === 1) return arm;
						if (task.taskRef === negativeTaskRef) {
							if (arm.branchKind === "relevant-applied") {
								return { ...arm, outcome: "failed" as const };
							}
							if (arm.branchKind === "proposal-only") {
								return { ...arm, outcome: "passed" as const };
							}
							return arm;
						}
						if (arm.branchKind === "relevant-applied") {
							return {
								...arm,
								outcome: "non-evaluable" as const,
								issueCodes: ["provider-unavailable"],
							};
						}
						return arm;
					}),
				};
			},
		});
		expect(result.summary.primaryComparison).toMatchObject({
			evaluableTaskClusters: 2,
			evaluablePairs: 4,
			pointEstimate: 0,
			interval95: { lower: -1, upper: 1, resampleCount: 4 },
		});
		expect(result.summary.taskResults.map((task) => task.primaryEffect)).toEqual([
			1,
			-1,
			null,
			null,
			null,
		]);
	});

	it("rejects cancellation raised during the final scripted block", async () => {
		const fixture = buildCalibrationFixture();
		const controller = new AbortController();
		await expect(
			runB112CalibrationSimulation({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				signal: controller.signal,
				runScriptedBlock: async ({ task, blockIndex, blockOrdinal }) => {
					if (blockOrdinal === 15) controller.abort();
					return calibrationSimulationBlock({ frozen: fixture.frozen, task, blockIndex });
				},
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	});
});

describe("B112 D677 authoritative calibration evidence", () => {
	it("accounts for all fifteen serial slots before one task-first scorecard", async () => {
		const fixture = buildCalibrationFixture();
		const schedule: string[] = [];
		let active = 0;
		let maxActive = 0;
		const result = await runB112EmpiricalCalibration({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			signal: new AbortController().signal,
			runEmpiricalBlock: async ({
				task,
				blockIndex,
				blockOrdinal,
				trialBlockRef,
				trialBlockDigest,
			}) => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				schedule.push(`${blockOrdinal}:${task.taskRef}:${blockIndex}`);
				expect({ trialBlockRef, trialBlockDigest }).toEqual(
					createB112CalibrationTrialBlockIdentity(fixture.frozen, task.taskRef, blockIndex),
				);
				await Promise.resolve();
				active -= 1;
				return calibrationEmpiricalBlockResult(
					calibrationEmpiricalObservation({
						frozen: fixture.frozen,
						task,
						blockIndex,
						qualificationRevision: `qualification.calibration.v4.block-${blockOrdinal}`,
					}),
				);
			},
		});
		expect(maxActive).toBe(1);
		expect(schedule).toEqual(
			fixture.catalog.tasks.flatMap((task, taskIndex) =>
				([1, 2, 3] as const).map(
					(blockIndex) => `${taskIndex * 3 + blockIndex}:${task.taskRef}:${blockIndex}`,
				),
			),
		);
		expect(result.terminalSlots).toHaveLength(15);
		expect(result.terminalSlots.every((slot) => slot.status === "observed")).toBe(true);
		expect(result.scorecard).toMatchObject({
			schemaVersion: B112_CALIBRATION_CAMPAIGN_SCORECARD_SCHEMA,
			profile: "calibration",
			evidenceClass: "simulated-contract",
			empiricalLiveEvidence: false,
			efficacyClaim: "none",
			plannedBlocks: 15,
			attemptedBlocks: 15,
			completeBlocks: 15,
			incompleteBlocks: 0,
			nonEvaluableBlocks: 0,
			eligibleColdFailures: 15,
			warmRunsAttempted: 75,
			warmRunsEvaluable: 75,
			status: "calibration-complete-exploratory-no-efficacy-claim",
			primaryComparison: {
				evaluableTaskClusters: 5,
				evaluablePairs: 15,
				pointEstimate: 1,
				interval95: { lower: 1, upper: 1, resampleCount: 3_125 },
			},
		});
		expect(result.scorecard.terminalSlotDigests).toHaveLength(15);
		expect(result.scorecard.observationDigests).toHaveLength(15);
		expect(new Set(result.scorecard.routeQualificationDigests).size).toBe(15);
		expect(
			empiricalStrictJsonDigest(
				createB112CalibrationCampaignScorecard(
					fixture.frozen,
					fixture.report,
					result.terminalSlots,
				),
			),
		).toBe(empiricalStrictJsonDigest(result.scorecard));
		for (const issueCode of [
			"calibration-task-budget-exhausted",
			"calibration-campaign-budget-exhausted",
		] as const) {
			const impossibleSuffix = result.terminalSlots.map((slot, index) =>
				index === 0 ? { ...slot, issueCodes: [...slot.issueCodes, issueCode].sort() } : slot,
			);
			expect(() =>
				validateB112CalibrationTerminalSlots(fixture.frozen, fixture.report, impossibleSuffix),
			).toThrow(/non-canonical|aggregate stop/i);
		}
	}, 20_000);

	it("marks incomplete evidence without losing the fifteen-slot accounting ledger", async () => {
		const fixture = buildCalibrationFixture();
		const result = await runB112EmpiricalCalibration({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			signal: new AbortController().signal,
			runEmpiricalBlock: async ({ task, blockIndex, blockOrdinal }) => {
				const observation = calibrationEmpiricalObservation({
					frozen: fixture.frozen,
					task,
					blockIndex,
				});
				return calibrationEmpiricalBlockResult(
					blockOrdinal === 1 ? incompleteCalibrationObservation(observation) : observation,
				);
			},
		});
		expect(result.terminalSlots).toHaveLength(15);
		expect(result.scorecard).toMatchObject({
			attemptedBlocks: 15,
			completeBlocks: 14,
			incompleteBlocks: 1,
			status: "incomplete",
		});
	}, 20_000);

	it("continues all preregistered blocks after block-local host budget exhaustion", async () => {
		const fixture = buildCalibrationFixture();
		let runnerCalls = 0;
		const result = await runB112EmpiricalCalibration({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			signal: new AbortController().signal,
			runEmpiricalBlock: async ({ task, blockIndex }) => {
				runnerCalls += 1;
				return calibrationEmpiricalBlockResult(
					budgetExhaustedCalibrationObservation(
						calibrationEmpiricalObservation({ frozen: fixture.frozen, task, blockIndex }),
					),
					"block",
				);
			},
		});
		expect(runnerCalls).toBe(15);
		expect(result.terminalSlots).toHaveLength(15);
		expect(result.terminalSlots.every((slot) => slot.status === "observed")).toBe(true);
		expect(result.scorecard).toMatchObject({
			attemptedBlocks: 15,
			incompleteBlocks: 15,
			status: "incomplete",
		});
		expect(result.scorecard.issueCodes).toContain("agent-step-budget-exhausted");
	}, 20_000);

	it("scopes task aggregate exhaustion to the current task", async () => {
		const fixture = buildCalibrationFixture();
		const frozen = fixture.frozen;
		let runnerCalls = 0;
		const result = await runB112EmpiricalCalibration({
			frozen,
			qualificationReport: fixture.report,
			signal: new AbortController().signal,
			runEmpiricalBlock: async ({ task, blockIndex, blockOrdinal }) => {
				runnerCalls += 1;
				const observation = calibrationEmpiricalObservation({
					frozen,
					task,
					blockIndex,
				});
				return blockOrdinal === 1
					? calibrationEmpiricalBlockResult(
							budgetExhaustedCalibrationObservation(observation),
							"task",
							calibrationCostAdmissionRejection(frozen.manifest.budgets.taskModel.maxCostMicrousd),
						)
					: calibrationEmpiricalBlockResult(observation);
			},
		});
		expect(runnerCalls).toBe(13);
		expect(result.terminalSlots.slice(1, 3)).toMatchObject([
			{
				status: "not-attempted-budget-exhausted",
				issueCodes: ["calibration-task-budget-exhausted"],
			},
			{
				status: "not-attempted-budget-exhausted",
				issueCodes: ["calibration-task-budget-exhausted"],
			},
		]);
		expect(result.terminalSlots[3]).toMatchObject({ status: "observed", attempted: true });
		expect(result.scorecard).toMatchObject({ attemptedBlocks: 13, status: "incomplete" });
		const forgedStringAuthority = result.terminalSlots.map((slot, index) =>
			index === 0 ? { ...slot, aggregateStopAuthority: null } : slot,
		);
		expect(() =>
			validateB112CalibrationTerminalSlots(frozen, fixture.report, forgedStringAuthority),
		).toThrow(/non-canonical|aggregate stop/i);
	}, 20_000);

	it("terminalizes all later slots after campaign aggregate exhaustion", async () => {
		const fixture = buildCalibrationFixture();
		const frozen = fixture.frozen;
		const firstTask = fixture.catalog.tasks[0] as EmpiricalCampaignTaskV1;
		const postAttemptObservation = budgetExhaustedCalibrationObservation(
			calibrationEmpiricalObservation({
				frozen,
				task: firstTask,
				blockIndex: 1,
				aggregateLatencyMs: frozen.manifest.budgets.campaign.maxElapsedMs,
			}),
		);
		expect(
			classifyOpenRouterCalibrationBudgetExhaustionScope({
				observation: postAttemptObservation,
				admissionRejection: null,
				remainingBudget: {
					campaignRequests: frozen.manifest.budgets.campaign.maxRequests,
					campaignCostMicrousd: frozen.manifest.budgets.campaign.maxCostMicrousd,
					campaignElapsedMs: frozen.manifest.budgets.campaign.maxElapsedMs,
					taskRequests: frozen.manifest.budgets.taskModel.maxRequests,
					taskCostMicrousd: frozen.manifest.budgets.taskModel.maxCostMicrousd,
				},
				blockBudget: {
					maxRequests: postAttemptObservation.route.maxRequests,
					maxSmokeSpendMicrousd: postAttemptObservation.route.maxSmokeSpendMicrousd,
					maxLatencyMs: postAttemptObservation.route.maxLatencyMs,
				},
			}),
		).toBe("campaign");
		let runnerCalls = 0;
		const result = await runB112EmpiricalCalibration({
			frozen,
			qualificationReport: fixture.report,
			signal: new AbortController().signal,
			runEmpiricalBlock: async ({ task, blockIndex }) => {
				runnerCalls += 1;
				return calibrationEmpiricalBlockResult(
					budgetExhaustedCalibrationObservation(
						calibrationEmpiricalObservation({
							frozen,
							task,
							blockIndex,
							aggregateLatencyMs: frozen.manifest.budgets.campaign.maxElapsedMs,
						}),
					),
					"campaign",
				);
			},
		});
		expect(runnerCalls).toBe(1);
		expect(
			result.terminalSlots
				.slice(1)
				.every(
					(slot) =>
						slot.status === "not-attempted-budget-exhausted" &&
						slot.issueCodes[0] === "calibration-campaign-budget-exhausted",
				),
		).toBe(true);
	}, 20_000);

	it("records a bounded setup failure and does not invoke later block factories", async () => {
		const fixture = buildCalibrationFixture();
		let factoryCalls = 0;
		const runEmpiricalBlock = createOpenRouterCalibrationEmpiricalRunner(async () => {
			factoryCalls += 1;
			throw new TypeError("private setup material must not enter evidence");
		});
		const result = await runB112EmpiricalCalibration({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			signal: new AbortController().signal,
			runEmpiricalBlock,
		});
		expect(factoryCalls).toBe(1);
		expect(result.terminalSlots).toHaveLength(15);
		expect(
			result.terminalSlots.every(
				(slot) => slot.status === "not-attempted-preparation-failed" && slot.attempted === false,
			),
		).toBe(true);
		expect(result.scorecard).toMatchObject({
			attemptedBlocks: 0,
			incompleteBlocks: 15,
			evidenceClass: "not-attempted",
			routeProfileDigest: null,
			pricingSourceUrl: null,
			pricingRevision: null,
			status: "incomplete",
		});
		expect(result.scorecard.issueCodes).toEqual(["calibration-block-preparation-failed"]);
		expect(JSON.stringify(result)).not.toContain("private setup material");
	}, 20_000);

	it("rejects hostile calibration arrays and stripped nested issue accounting", () => {
		const fixture = buildCalibrationFixture();
		const task = fixture.catalog.tasks[0] as EmpiricalCampaignTaskV1;
		const observation = incompleteCalibrationObservation(
			calibrationEmpiricalObservation({ frozen: fixture.frozen, task, blockIndex: 1 }),
		);
		expect(() =>
			validateEmpiricalCalibrationTrialBlockObservation({ ...observation, issueCodes: [] }),
		).toThrow(/canonical nested issue union/);
		const forgedScopedObservation = budgetExhaustedCalibrationObservation(
			calibrationEmpiricalObservation({ frozen: fixture.frozen, task, blockIndex: 1 }),
			"calibration-task-budget-exhausted",
		);
		expect(() =>
			createB112CalibrationEmpiricalBlockResult({
				observation: forgedScopedObservation,
				budgetExhaustionScope: "task",
				costAdmissionRejection: null,
			}),
		).toThrow(/scheduler-owned aggregate scope/);

		const hostileWarmBranches = [...observation.warmBranches];
		Object.setPrototypeOf(hostileWarmBranches, {
			map: () => [],
			[Symbol.iterator]: () => [][Symbol.iterator](),
		});
		expect(() =>
			validateEmpiricalCalibrationTrialBlockObservation({
				...observation,
				warmBranches: hostileWarmBranches,
			}),
		).toThrow(/canonical array prototype/);
	});

	it("rejects missing slots and frozen configuration substitution", async () => {
		const fixture = buildCalibrationFixture();
		const result = await runB112EmpiricalCalibration({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			signal: new AbortController().signal,
			runEmpiricalBlock: async ({ task, blockIndex }) =>
				calibrationEmpiricalBlockResult(
					calibrationEmpiricalObservation({ frozen: fixture.frozen, task, blockIndex }),
				),
		});
		expect(() =>
			createB112CalibrationCampaignScorecard(
				fixture.frozen,
				fixture.report,
				result.terminalSlots.slice(0, 14),
			),
		).toThrow(/fifteen planned terminal slots/);
		const substituted = {
			...(result.terminalSlots[0]?.observation as EmpiricalCalibrationTrialBlockObservationV4),
			route: {
				...(result.terminalSlots[0]?.observation as EmpiricalCalibrationTrialBlockObservationV4)
					.route,
				configurationDigest: empiricalStrictJsonDigest({ substituted: true }),
			},
		};
		await expect(
			runB112EmpiricalCalibration({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				signal: new AbortController().signal,
				runEmpiricalBlock: async ({ task, blockIndex, blockOrdinal }) =>
					calibrationEmpiricalBlockResult(
						blockOrdinal === 1
							? substituted
							: calibrationEmpiricalObservation({ frozen: fixture.frozen, task, blockIndex }),
					),
			}),
		).rejects.toThrow(/configuration and route/);
		const firstTask = fixture.catalog.tasks[0] as EmpiricalCampaignTaskV1;
		const duplicateIdentity = calibrationEmpiricalObservation({
			frozen: fixture.frozen,
			task: firstTask,
			blockIndex: 1,
		});
		await expect(
			runB112EmpiricalCalibration({
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				signal: new AbortController().signal,
				runEmpiricalBlock: async ({ task, blockIndex, blockOrdinal }) => {
					const observation = calibrationEmpiricalObservation({
						frozen: fixture.frozen,
						task,
						blockIndex,
					});
					return calibrationEmpiricalBlockResult(
						blockOrdinal === 2
							? {
									...observation,
									trialBlockRef: duplicateIdentity.trialBlockRef,
									trialBlockDigest: duplicateIdentity.trialBlockDigest,
								}
							: observation,
					);
				},
			}),
		).rejects.toThrow(/exact scheduled task block/);
	}, 20_000);

	it("atomically persists one sanitized 0600 fifteen-slot generation", async () => {
		const fixture = buildCalibrationFixture();
		const result = await runB112EmpiricalCalibration({
			frozen: fixture.frozen,
			qualificationReport: fixture.report,
			signal: new AbortController().signal,
			runEmpiricalBlock: async ({ task, blockIndex }) =>
				calibrationEmpiricalBlockResult(
					calibrationEmpiricalObservation({ frozen: fixture.frozen, task, blockIndex }),
				),
		});
		const temporary = mkdtempSync(join(tmpdir(), "graphrefly-d677-persistence-"));
		const privateRoot = join(temporary, ".private", "empirical-memory-rerun-avoidance");
		mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
		const secretSentinel = "d677-secret-sentinel";
		const protectionExecutor = createEmpiricalExactPrivateNeedleProtectionExecutor({
			policyRef: fixture.manifest.policies.protectionPolicyRef,
			policyRevision: fixture.manifest.policies.protectionPolicyRevision,
			protectedNeedleCapabilityRef: "d677-persistence-test",
			protectedNeedleCapabilityRevision: "d677-persistence-test.v1",
			protectedNeedles: [secretSentinel],
		});
		try {
			const oversizedLiveShape = Array.from({ length: 4_097 }, (_, index) => ({
				actionIndex: index,
				toolRef: `bounded-tool-${index}`,
			}));
			expect(() =>
				assertPrivateArtifactProtection({
					subject: oversizedLiveShape,
					label: "oversized-live-terminal-slot",
					protectionExecutor,
				}),
			).not.toThrow();
			expect(() =>
				assertPrivateArtifactProtection({
					subject: [...oversizedLiveShape, { material: secretSentinel }],
					label: "oversized-live-terminal-slot",
					protectionExecutor,
				}),
			).toThrow(/artifact-persistence protection/);
			const maximumNeedle = "n".repeat(MAX_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS);
			const crossChunkProtectionExecutor = createEmpiricalExactPrivateNeedleProtectionExecutor({
				policyRef: fixture.manifest.policies.protectionPolicyRef,
				policyRevision: fixture.manifest.policies.protectionPolicyRevision,
				protectedNeedleCapabilityRef: "d677-cross-chunk-persistence-test",
				protectedNeedleCapabilityRevision: "d677-cross-chunk-persistence-test.v1",
				protectedNeedles: [maximumNeedle],
			});
			const crossChunkValue = `${"a".repeat(32_768 - maximumNeedle.length / 2)}${maximumNeedle}${"z".repeat(32_768)}`;
			expect(() =>
				assertPrivateArtifactProtection({
					subject: { material: crossChunkValue },
					label: "cross-chunk-live-terminal-slot",
					protectionExecutor: crossChunkProtectionExecutor,
				}),
			).toThrow(/artifact-persistence protection/);
			await expect(
				persistPrivateCalibrationGeneration({
					privateRoot,
					generationRef: "forged-protection-generation",
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					terminalSlots: result.terminalSlots,
					scorecard: result.scorecard,
					protectionExecutor: Object.freeze({
						...protectionExecutor,
					}),
				}),
			).rejects.toThrow(/frozen D656 policy/);
			expect(readdirSync(privateRoot)).not.toContain("forged-protection-generation");
			const persisted = await persistPrivateCalibrationGeneration({
				privateRoot,
				generationRef: "calibration-v4-generation",
				frozen: fixture.frozen,
				qualificationReport: fixture.report,
				terminalSlots: result.terminalSlots,
				scorecard: result.scorecard,
				protectionExecutor,
			});
			const files = [
				"campaign-manifest.v1.json",
				"terminal-slots.v4.json",
				"campaign-scorecard.v4.json",
				"generation.v4.json",
			];
			const persistedBytes = files
				.map((file) => readFileSync(join(persisted.generationPath, file), "utf8"))
				.join("\n");
			expect(persistedBytes).not.toContain(secretSentinel);
			expect(
				JSON.parse(readFileSync(join(persisted.generationPath, files[1] as string), "utf8")),
			).toHaveLength(15);
			for (const file of files) {
				expect(statSync(join(persisted.generationPath, file)).mode & 0o777).toBe(0o600);
			}
			await expect(
				persistPrivateCalibrationGeneration({
					privateRoot,
					generationRef: "calibration-v4-generation",
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					terminalSlots: result.terminalSlots,
					scorecard: result.scorecard,
					protectionExecutor,
				}),
			).rejects.toThrow();
			expect(readdirSync(privateRoot).filter((entry) => entry.startsWith(".staging-"))).toEqual([]);
			expect(readdirSync(persisted.generationPath).sort()).toEqual([...files].sort());
			await expect(
				persistPrivateCalibrationGeneration({
					privateRoot,
					generationRef: secretSentinel,
					frozen: fixture.frozen,
					qualificationReport: fixture.report,
					terminalSlots: result.terminalSlots,
					scorecard: result.scorecard,
					protectionExecutor,
				}),
			).rejects.toThrow(/artifact-persistence protection/);
			expect(readdirSync(privateRoot)).not.toContain(secretSentinel);
		} finally {
			rmSync(temporary, { recursive: true, force: true });
		}
	}, 20_000);
});
