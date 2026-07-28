import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import type {
	EmpiricalCampaignManifestV1,
	EmpiricalTaskQualificationObservationV1,
} from "../../evals/empirical-memory-rerun-avoidance/contracts.js";
import {
	validateEmpiricalCampaignManifest,
	validateEmpiricalCampaignManifestBytes,
} from "../../evals/empirical-memory-rerun-avoidance/manifest.js";
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
				file.endsWith("model-execution.ts") || file.endsWith("openai-responses-model-turn.ts");
			const allowsFocusedTransportAsync = file.endsWith("openai-responses-model-turn.ts");
			const allowsRepositoryNodeDriver = file.endsWith("single-baseline-repository-node.ts");
			const allowsClosedHostNodeDriver = file.endsWith("closed-task-profile-host.ts");
			const allowsClosedVerifierCalibration = file.endsWith(
				"closed-task-profile-verifier-calibration.ts",
			);
			expect(source).not.toMatch(
				allowsRepositoryNodeDriver || allowsClosedHostNodeDriver || allowsClosedVerifierCalibration
					? /\b(?:Date\.now|fetch|WebSocket|setTimeout|setInterval|setImmediate|queueMicrotask)\b|\b(?:require|import)\s*\(|node:(?:http|https|net|tls)|(?:from|import)\s+["'](?:http|https|net|tls|undici|ws)["']/
					: allowsFocusedTransportAsync
						? /\b(?:Date\.now|fetch|WebSocket|setTimeout|setInterval|setImmediate|queueMicrotask)\b|\b(?:require|import)\s*\(|node:(?:http|https|net|tls|child_process)|(?:from|import)\s+["'](?:http|https|net|tls|child_process|undici|ws)["']/
						: allowsOneTurnPromise
							? /\b(?:async|Date\.now|fetch|WebSocket|setTimeout|setInterval|setImmediate|queueMicrotask)\b|\b(?:require|import)\s*\(|node:(?:http|https|net|tls|child_process)|(?:from|import)\s+["'](?:http|https|net|tls|child_process|undici|ws)["']/
							: /\b(?:async|Promise|Date\.now|fetch|WebSocket|setTimeout|setInterval|setImmediate|queueMicrotask)\b|\b(?:require|import)\s*\(|node:(?:http|https|net|tls|child_process)|(?:from|import)\s+["'](?:http|https|net|tls|child_process|undici|ws)["']/,
			);
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
						((allowsRepositoryNodeDriver || allowsClosedHostNodeDriver) &&
							(specifier === "node:child_process" ||
								specifier === "node:fs/promises" ||
								specifier === "node:path")) ||
						specifier === "../../src/json/codec.js" ||
						specifier.startsWith("./"),
				),
			).toBe(true);
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
