import {
	empiricalSha256,
	empiricalStrictJsonDigest,
} from "../../../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS,
	EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS,
	type EmpiricalCampaignManifestV1,
	type EmpiricalCampaignTaskV1,
	type EmpiricalTaskCatalogV1,
	type EmpiricalTaskQualificationObservationV1,
	type EmpiricalTaskQualificationReportV1,
} from "../../../../evals/empirical-memory-rerun-avoidance/contracts.js";
import {
	createEmpiricalTaskQualificationReport,
	empiricalTaskCatalogDigest,
} from "../../../../evals/empirical-memory-rerun-avoidance/qualification.js";
import { strictJsonCodec } from "../../../json/codec.js";

export const empiricalFixtureDigest = (label: string): string =>
	empiricalSha256(new TextEncoder().encode(label));

const taskSpecificEvidenceKinds = new Set([
	"command-policy",
	"out-of-policy-diff-rejection",
	"target-defect-verifier",
	"workspace-isolation",
]);

function task(
	index: number,
	sourceStratum: "historical-pre-fix" | "held-out-overlay",
): EmpiricalCampaignTaskV1 {
	const taskRef = `qualification-placeholder-task-${index}`;
	const originalTreeDigest = empiricalFixtureDigest(`${taskRef}:original-tree`);
	return Object.freeze({
		taskRef,
		sourceStratum,
		repositoryRef: "graphrefly-ts",
		originalCommitSha: String(index).repeat(40),
		originalTreeDigest,
		actorTreeDigest:
			sourceStratum === "historical-pre-fix"
				? originalTreeDigest
				: empiricalFixtureDigest(`${taskRef}:actor-tree`),
		overlayDigest:
			sourceStratum === "held-out-overlay" ? empiricalFixtureDigest(`${taskRef}:overlay`) : null,
		worldDigest: empiricalFixtureDigest(`${taskRef}:world`),
		worldRevision: "world-placeholder.v1",
		evalScopeDigest: empiricalFixtureDigest(`${taskRef}:eval-scope`),
		environmentRef: "environment-placeholder",
		environmentRevision: "environment-placeholder.v1",
		environmentDigest: empiricalFixtureDigest(`${taskRef}:environment`),
		toolchainRevision: "toolchain-placeholder.v1",
		toolchainDigest: empiricalFixtureDigest(`${taskRef}:toolchain`),
		workItemRef: `work-item-placeholder-${index}`,
		workItemDigest: empiricalFixtureDigest(`${taskRef}:work-item`),
		acceptanceDigest: empiricalFixtureDigest(`${taskRef}:acceptance`),
		workspaceRecipeRef: "workspace-recipe-placeholder",
		workspaceRecipeRevision: "workspace-recipe-placeholder.v1",
		workspaceRecipeDigest: empiricalFixtureDigest(`${taskRef}:workspace-recipe`),
		allowedCommandPolicyRef: "command-policy-placeholder",
		allowedCommandPolicyRevision: "command-policy-placeholder.v1",
		allowedCommandPolicyDigest: empiricalFixtureDigest(`${taskRef}:command-policy`),
		verifierProfileRef: `verifier-profile-placeholder-${index}`,
		verifierProfileRevision: "verifier-profile-placeholder.v1",
		verifierProfileDigest: empiricalFixtureDigest(`${taskRef}:verifier-profile`),
	});
}

export function buildEmpiricalQualificationCatalogFixture(): EmpiricalTaskCatalogV1 {
	return Object.freeze({
		taskCatalogRevision: "qualification-catalog-placeholder.v1",
		tasks: Object.freeze([
			task(1, "historical-pre-fix"),
			task(2, "historical-pre-fix"),
			task(3, "historical-pre-fix"),
			task(4, "held-out-overlay"),
			task(5, "held-out-overlay"),
		]),
	});
}

export function buildEmpiricalQualificationObservationFixture(
	task: EmpiricalCampaignTaskV1,
): EmpiricalTaskQualificationObservationV1 {
	const fixtureSuiteDigest = empiricalFixtureDigest(`${task.taskRef}:verifier-fixtures`);
	const harnessRevision = "qualification-harness-placeholder.v1";
	return Object.freeze({
		schemaVersion: EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS.taskQualificationObservation,
		taskRef: task.taskRef,
		taskDigest: empiricalStrictJsonDigest(task),
		verifierProfileRef: task.verifierProfileRef,
		verifierProfileRevision: task.verifierProfileRevision,
		verifierProfileDigest: task.verifierProfileDigest,
		workspace: Object.freeze({
			actorTreeDigest: task.actorTreeDigest,
			workspaceRecipeRef: task.workspaceRecipeRef,
			workspaceRecipeRevision: task.workspaceRecipeRevision,
			workspaceRecipeDigest: task.workspaceRecipeDigest,
			environmentDigest: task.environmentDigest,
			toolchainDigest: task.toolchainDigest,
			repositoryState: "clean-single-baseline",
			remotes: 0,
			descendantHistoryVisible: false,
			uncommittedChanges: false,
			overlayVisibleAsDiff: false,
			hiddenVerifierMaterialVisible: false,
			expectedPatchVisible: false,
			freshMaterializationVerified: true,
			sharedCacheMode: "readonly",
			cleanupFailureClassifiedNonEvaluable: true,
		}),
		commands: Object.freeze({
			policyRef: task.allowedCommandPolicyRef,
			policyRevision: task.allowedCommandPolicyRevision,
			policyDigest: task.allowedCommandPolicyDigest,
			resolved: true,
			networkAllowed: false,
			containerRuntimeAllowed: false,
			credentialAccessAllowed: false,
			outOfTreeWritesAllowed: false,
		}),
		verifierCalibration: Object.freeze({
			executable: true,
			targetDefectVerdict: "failed",
			knownGoodVerdict: "passed",
			plausibleWrongVerdict: "failed",
			actorClaimsCanSatisfy: false,
			verifierTamperingRejected: true,
			outOfPolicyDiffRejected: true,
			evidenceComplete: true,
			missingEvidenceClassifiedNonEvaluable: true,
			unreliableEvidenceClassifiedNonEvaluable: true,
			nonExecutableEvidenceClassifiedNonEvaluable: true,
			testTamperingRejected: true,
			fixtureSuiteRevision: "verifier-fixtures-placeholder.v1",
			fixtureSuiteDigest,
			harnessRevision,
			evidenceRefs: Object.freeze(
				EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS.map((kind) =>
					Object.freeze({
						kind,
						id: `${task.taskRef}:${kind}`,
						digest: empiricalFixtureDigest(`${task.taskRef}:${kind}:evidence`),
						subjectRef: taskSpecificEvidenceKinds.has(kind)
							? task.taskRef
							: task.verifierProfileRef,
						subjectDigest: taskSpecificEvidenceKinds.has(kind)
							? empiricalStrictJsonDigest(task)
							: task.verifierProfileDigest,
						fixtureSuiteDigest,
						harnessRevision,
					}),
				),
			),
		}),
		duration: Object.freeze({
			observedDurationMs: 1_000,
			limitMs: 10_000,
		}),
		issueCodes: Object.freeze([]),
	});
}

export function buildEmpiricalQualificationReportFixture(
	catalog = buildEmpiricalQualificationCatalogFixture(),
): EmpiricalTaskQualificationReportV1 {
	return createEmpiricalTaskQualificationReport(
		catalog,
		catalog.tasks.map(buildEmpiricalQualificationObservationFixture),
	);
}

export function buildEmpiricalCampaignManifestFixture(
	catalog = buildEmpiricalQualificationCatalogFixture(),
	report = buildEmpiricalQualificationReportFixture(catalog),
): EmpiricalCampaignManifestV1 {
	const stringShape = Object.freeze({
		kind: "string",
		minLength: 1,
		maxLength: 256,
		enum: null,
	} as const);
	const toolInputSchema = Object.freeze({
		kind: "object",
		properties: Object.freeze([
			Object.freeze({ name: "commandRef", required: true, shape: stringShape }),
			Object.freeze({
				name: "args",
				required: true,
				shape: Object.freeze({
					kind: "array",
					items: stringShape,
					minItems: 0,
					maxItems: 16,
				} as const),
			}),
		]),
		additionalProperties: false,
	} as const);
	const actorOutputSchema = Object.freeze({
		kind: "object",
		properties: Object.freeze([
			Object.freeze({ name: "kind", required: true, shape: stringShape }),
			Object.freeze({ name: "summary", required: true, shape: stringShape }),
		]),
		additionalProperties: false,
	} as const);
	const toolSchemaEntry = Object.freeze({
		toolRef: "tool-placeholder",
		schemaRevision: "tool-schema-placeholder.v1",
		inputSchema: toolInputSchema,
		inputSchemaDigest: empiricalStrictJsonDigest(toolInputSchema),
	});
	const outputSchemaEntry = Object.freeze({
		schemaRef: "actor-turn-output-placeholder",
		role: "actor",
		schemaRevision: "actor-output-placeholder.v1",
		schema: actorOutputSchema,
		schemaDigest: empiricalStrictJsonDigest(actorOutputSchema),
	} as const);
	const schemaCatalog = Object.freeze({
		schemaVersion: "graphrefly.private-solution-eval.strict-json-shape.v1",
		catalogRevision: "model-schema-catalog-placeholder.v1",
		tools: Object.freeze([toolSchemaEntry]),
		outputs: Object.freeze([outputSchemaEntry]),
	} as const);
	return Object.freeze({
		schemaVersion: EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS.campaignManifest,
		campaignRef: "campaign-placeholder",
		familyRef: "memory-rerun-avoidance-placeholder",
		lane: "empirical-real-model",
		catalog,
		qualification: Object.freeze({
			qualificationRevision: "qualification-gate-placeholder.v1",
			taskCatalogDigest: empiricalTaskCatalogDigest(catalog),
			reportDigest: empiricalSha256(strictJsonCodec.encode(report)),
		}),
		trialPlan: Object.freeze({
			profile: "smoke",
			activeTaskRefs: Object.freeze([catalog.tasks[0]?.taskRef as string]) as readonly [string],
			attemptedColdBlocksPerTask: 1,
			branchOrderMode: "explicit",
			branchOrder: Object.freeze([
				"relevant-applied",
				"proposal-only",
				"admission-rejected",
				"irrelevant-applied",
				"wrong-scope-applied",
			] as const),
		}),
		schemaCatalog,
		modelConfigurations: Object.freeze([
			Object.freeze({
				configurationRef: "actor-model-placeholder",
				role: "actor",
				providerFamily: "provider-family-placeholder",
				provider: "provider-placeholder",
				model: "model-placeholder-snapshot",
				modelIdentityKind: "exact-snapshot",
				endpoint: "https://provider.invalid/v1/model",
				endpointRevision: "endpoint-placeholder.v1",
				adapterRevision: "adapter-placeholder.v1",
				bindingRevision: "binding-placeholder.v1",
				promptRevision: "prompt-placeholder.v1",
				systemPromptRevision: "system-prompt-placeholder.v1",
				capabilities: Object.freeze({
					toolCalling: true,
					structuredOutput: true,
					reasoningControl: false,
					seed: false,
					providerUsage: true,
				}),
				settings: Object.freeze({
					sampling: Object.freeze({ temperature: 0, topP: 1, seed: null }),
					reasoning: Object.freeze({ mode: "none", effort: null }),
					output: Object.freeze({
						format: "strict-json",
						schemaRef: outputSchemaEntry.schemaRef,
						schemaRevision: outputSchemaEntry.schemaRevision,
						schemaDigest: outputSchemaEntry.schemaDigest,
						maxOutputTokens: 2_048,
					}),
					tools: Object.freeze({
						enabled: true,
						schemaRevision: schemaCatalog.catalogRevision,
						toolRefs: Object.freeze([toolSchemaEntry.toolRef]),
						toolSetDigest: empiricalStrictJsonDigest([toolSchemaEntry]),
						choice: "auto",
						maxSteps: 8,
					}),
				}),
				usageSource: "provider-reported",
				tokenizerRef: null,
				tokenizerRevision: null,
				pricingRevision: "pricing-placeholder.v1",
				pricingScheduleRef: "pricing-schedule-placeholder",
				credentialPolicyRef: "credential-policy-placeholder",
				credentialPolicyRevision: "credential-policy-placeholder.v1",
			}),
		]),
		policies: Object.freeze({
			plannerRevision: "planner-placeholder.v1",
			executorRevision: "executor-placeholder.v1",
			reflectorRevision: "reflector-placeholder.v1",
			mapperRevision: "mapper-placeholder.v1",
			protectionPolicyRef: "protection-policy-placeholder",
			protectionPolicyRevision: "protection-policy-placeholder.v1",
			artifactPolicyRef: "artifact-policy-placeholder",
			artifactPolicyRevision: "artifact-policy-placeholder.v1",
			rawArtifactPersistence: "disabled",
			repositoryEvidenceInclusion: "not-approved",
			actorPolicyRef: "actor-policy-placeholder",
			actorPolicyRevision: "actor-policy-placeholder.v1",
			actorCredentialBindingRef: "actor-credential-binding-placeholder",
			actorCredentialBindingRevision: "actor-credential-binding-placeholder.v1",
			actorTracePolicyRef: "actor-trace-policy-placeholder",
			actorTracePolicyRevision: "actor-trace-policy-placeholder.v1",
			actorInputAuthorityRef: "actor-input-authority-placeholder",
			actorInputAuthorityRevision: "actor-input-authority-placeholder.v1",
			auxiliaryJudge: Object.freeze({
				enabled: false,
				configurationRef: null,
				policyRef: null,
				policyRevision: null,
				credentialBindingRef: null,
				credentialBindingRevision: null,
				tracePolicyRef: null,
				tracePolicyRevision: null,
				inputAuthorityRef: null,
				inputAuthorityRevision: null,
			}),
			semanticRedactor: Object.freeze({
				enabled: false,
				configurationRef: null,
				policyRef: null,
				policyRevision: null,
				credentialBindingRef: null,
				credentialBindingRevision: null,
				tracePolicyRef: null,
				tracePolicyRevision: null,
				inputAuthorityRef: null,
				inputAuthorityRevision: null,
			}),
		}),
		budgets: Object.freeze({
			campaign: Object.freeze({
				maxRequests: 24,
				maxCostMicrousd: 1_000_000,
				maxElapsedMs: 600_000,
			}),
			taskModel: Object.freeze({
				maxAttemptedColdBlocks: 1,
				maxRequests: 24,
				maxCostMicrousd: 1_000_000,
			}),
			agentRun: Object.freeze({
				maxSteps: 8,
				maxRequests: 4,
				maxElapsedMs: 60_000,
				maxOutputBytes: 65_536,
			}),
		}),
		aggregation: Object.freeze({
			aggregationRevision: "aggregation-placeholder.v1",
			intervalRevision: "task-clustered-interval-placeholder.v1",
			aggregationSeed: "aggregation-placeholder-seed",
			clusterUnit: "task",
			confidenceLevel: 0.95,
		}),
	});
}

export function buildEmpiricalCampaignFixture() {
	const catalog = buildEmpiricalQualificationCatalogFixture();
	const observations = catalog.tasks.map(buildEmpiricalQualificationObservationFixture);
	const report = createEmpiricalTaskQualificationReport(catalog, observations);
	const manifest = buildEmpiricalCampaignManifestFixture(catalog, report);
	return Object.freeze({ catalog, observations, report, manifest });
}
