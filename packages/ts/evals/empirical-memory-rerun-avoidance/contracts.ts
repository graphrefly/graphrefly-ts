export const EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS = Object.freeze({
	campaignManifest: "graphrefly.private-solution-eval.empirical-campaign-manifest.v1",
	taskQualificationObservation:
		"graphrefly.private-solution-eval.empirical-task-qualification-observation.v1",
	taskQualificationReport:
		"graphrefly.private-solution-eval.empirical-task-qualification-report.v1",
});

export type EmpiricalTaskSourceStratum = "historical-pre-fix" | "held-out-overlay";
export type EmpiricalCampaignProfile = "smoke" | "calibration" | "confirmatory";
export type EmpiricalUsageSource =
	| "provider-reported"
	| "provider-count-endpoint"
	| "adapter-estimated"
	| "host-measured";

export type EmpiricalWarmBranchKind =
	| "relevant-applied"
	| "proposal-only"
	| "admission-rejected"
	| "irrelevant-applied"
	| "wrong-scope-applied";

export const EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS = Object.freeze([
	"actor-claim-rejection",
	"command-policy",
	"known-good-verifier",
	"missing-evidence-non-evaluable",
	"non-executable-evidence-non-evaluable",
	"out-of-policy-diff-rejection",
	"plausible-wrong-verifier",
	"target-defect-verifier",
	"test-tamper-rejection",
	"unreliable-evidence-non-evaluable",
	"verifier-tamper-rejection",
	"workspace-isolation",
] as const);

export type EmpiricalQualificationEvidenceKind =
	(typeof EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS)[number];

export interface EmpiricalEvidenceRefV1 {
	readonly kind: EmpiricalQualificationEvidenceKind;
	readonly id: string;
	readonly digest: string;
	readonly subjectRef: string;
	readonly subjectDigest: string;
	readonly fixtureSuiteDigest: string;
	readonly harnessRevision: string;
}

export interface EmpiricalCampaignTaskV1 {
	readonly taskRef: string;
	readonly sourceStratum: EmpiricalTaskSourceStratum;
	readonly repositoryRef: string;
	readonly originalCommitSha: string;
	readonly originalTreeDigest: string;
	readonly actorTreeDigest: string;
	readonly overlayDigest: string | null;
	readonly worldDigest: string;
	readonly worldRevision: string;
	readonly evalScopeDigest: string;
	readonly environmentRef: string;
	readonly environmentRevision: string;
	readonly environmentDigest: string;
	readonly toolchainRevision: string;
	readonly toolchainDigest: string;
	readonly workItemRef: string;
	readonly workItemDigest: string;
	readonly acceptanceDigest: string;
	readonly workspaceRecipeRef: string;
	readonly workspaceRecipeRevision: string;
	readonly workspaceRecipeDigest: string;
	readonly allowedCommandPolicyRef: string;
	readonly allowedCommandPolicyRevision: string;
	readonly allowedCommandPolicyDigest: string;
	readonly verifierProfileRef: string;
	readonly verifierProfileRevision: string;
	readonly verifierProfileDigest: string;
}

export interface EmpiricalTaskCatalogV1 {
	readonly taskCatalogRevision: string;
	readonly tasks: readonly EmpiricalCampaignTaskV1[];
}

export type EmpiricalTrialPlanV1 =
	| {
			readonly profile: "smoke";
			readonly activeTaskRefs: readonly [string];
			readonly attemptedColdBlocksPerTask: 1;
			readonly branchOrderMode: "explicit";
			readonly branchOrder: readonly EmpiricalWarmBranchKind[];
	  }
	| {
			readonly profile: "calibration";
			readonly activeTaskRefs: readonly string[];
			readonly attemptedColdBlocksPerTask: 3;
			readonly branchOrderMode: "explicit";
			readonly branchOrder: readonly EmpiricalWarmBranchKind[];
	  }
	| {
			readonly profile: "confirmatory";
			readonly activeTaskRefs: readonly string[];
			readonly attemptedColdBlocksPerTask: number;
			readonly preregistrationRef: string;
			readonly claimThresholdRevision: string;
			readonly stoppingRuleRevision: string;
			readonly branchOrderMode: "explicit";
			readonly branchOrder: readonly EmpiricalWarmBranchKind[];
	  };

export interface EmpiricalModelCapabilitiesV1 {
	readonly toolCalling: boolean;
	readonly structuredOutput: boolean;
	readonly reasoningControl: boolean;
	readonly seed: boolean;
	readonly providerUsage: boolean;
}

export interface EmpiricalModelSettingsV1 {
	readonly sampling: {
		readonly temperature: number | null;
		readonly topP: number | null;
		readonly seed: number | null;
	};
	readonly reasoning: {
		readonly mode: "none" | "provider-native";
		readonly effort: string | null;
	};
	readonly output: {
		readonly format: "strict-json";
		readonly schemaRef: string;
		readonly schemaRevision: string;
		readonly schemaDigest: string;
		readonly maxOutputTokens: number;
	};
	readonly tools: {
		readonly enabled: true;
		readonly schemaRevision: string;
		readonly toolRefs: readonly string[];
		readonly toolSetDigest: string;
		readonly choice: "auto" | "required";
		readonly maxSteps: number;
	};
}

export type EmpiricalStrictJsonShapeV1 =
	| {
			readonly kind: "null";
	  }
	| {
			readonly kind: "boolean";
	  }
	| {
			readonly kind: "number" | "integer";
			readonly minimum: number | null;
			readonly maximum: number | null;
	  }
	| {
			readonly kind: "string";
			readonly minLength: number;
			readonly maxLength: number;
			readonly enum: readonly string[] | null;
	  }
	| {
			readonly kind: "array";
			readonly items: EmpiricalStrictJsonShapeV1;
			readonly minItems: number;
			readonly maxItems: number;
	  }
	| {
			readonly kind: "object";
			readonly properties: readonly {
				readonly name: string;
				readonly required: boolean;
				readonly shape: EmpiricalStrictJsonShapeV1;
			}[];
			readonly additionalProperties: false;
	  }
	| {
			readonly kind: "one-of";
			readonly variants: readonly EmpiricalStrictJsonShapeV1[];
	  };

export interface EmpiricalToolSchemaCatalogEntryV1 {
	readonly toolRef: string;
	readonly schemaRevision: string;
	readonly inputSchema: EmpiricalStrictJsonShapeV1;
	readonly inputSchemaDigest: string;
}

export interface EmpiricalOutputSchemaCatalogEntryV1 {
	readonly schemaRef: string;
	readonly role: "actor" | "auxiliary-judge" | "semantic-redactor";
	readonly schemaRevision: string;
	readonly schema: EmpiricalStrictJsonShapeV1;
	readonly schemaDigest: string;
}

export interface EmpiricalSchemaCatalogV1 {
	readonly schemaVersion: "graphrefly.private-solution-eval.strict-json-shape.v1";
	readonly catalogRevision: string;
	readonly tools: readonly EmpiricalToolSchemaCatalogEntryV1[];
	readonly outputs: readonly EmpiricalOutputSchemaCatalogEntryV1[];
}

export interface EmpiricalModelConfigurationV1 {
	readonly configurationRef: string;
	readonly role: "actor" | "auxiliary-judge" | "semantic-redactor";
	readonly providerFamily: string;
	readonly provider: string;
	readonly model: string;
	readonly modelIdentityKind: "exact-snapshot" | "alias-disclosed";
	readonly endpoint: string;
	readonly endpointRevision: string;
	readonly adapterRevision: string;
	readonly bindingRevision: string;
	readonly promptRevision: string;
	readonly systemPromptRevision: string;
	readonly capabilities: EmpiricalModelCapabilitiesV1;
	readonly settings: EmpiricalModelSettingsV1;
	readonly usageSource: EmpiricalUsageSource;
	readonly tokenizerRef: string | null;
	readonly tokenizerRevision: string | null;
	readonly pricingRevision: string;
	readonly pricingScheduleRef: string;
	readonly credentialPolicyRef: string;
	readonly credentialPolicyRevision: string;
}

export interface EmpiricalOptionalRolePolicyV1 {
	readonly enabled: boolean;
	readonly configurationRef: string | null;
	readonly policyRef: string | null;
	readonly policyRevision: string | null;
	readonly credentialBindingRef: string | null;
	readonly credentialBindingRevision: string | null;
	readonly tracePolicyRef: string | null;
	readonly tracePolicyRevision: string | null;
	readonly inputAuthorityRef: string | null;
	readonly inputAuthorityRevision: string | null;
}

export interface EmpiricalCampaignPolicyCoordinatesV1 {
	readonly plannerRevision: string;
	readonly executorRevision: string;
	readonly reflectorRevision: string;
	readonly mapperRevision: string;
	readonly protectionPolicyRef: string;
	readonly protectionPolicyRevision: string;
	readonly artifactPolicyRef: string;
	readonly artifactPolicyRevision: string;
	readonly rawArtifactPersistence: "disabled";
	readonly repositoryEvidenceInclusion: "not-approved";
	readonly actorPolicyRef: string;
	readonly actorPolicyRevision: string;
	readonly actorCredentialBindingRef: string;
	readonly actorCredentialBindingRevision: string;
	readonly actorTracePolicyRef: string;
	readonly actorTracePolicyRevision: string;
	readonly actorInputAuthorityRef: string;
	readonly actorInputAuthorityRevision: string;
	readonly auxiliaryJudge: EmpiricalOptionalRolePolicyV1;
	readonly semanticRedactor: EmpiricalOptionalRolePolicyV1;
}

export interface EmpiricalCampaignBudgetsV1 {
	readonly campaign: {
		readonly maxRequests: number;
		readonly maxCostMicrousd: number;
		readonly maxElapsedMs: number;
	};
	readonly taskModel: {
		readonly maxAttemptedColdBlocks: number;
		readonly maxRequests: number;
		readonly maxCostMicrousd: number;
	};
	readonly agentRun: {
		readonly maxSteps: number;
		readonly maxRequests: number;
		readonly maxElapsedMs: number;
		readonly maxOutputBytes: number;
	};
}

export interface EmpiricalCampaignAggregationV1 {
	readonly aggregationRevision: string;
	readonly intervalRevision: string;
	readonly aggregationSeed: string;
	readonly clusterUnit: "task";
	readonly confidenceLevel: 0.95;
}

export interface EmpiricalCampaignManifestV1 {
	readonly schemaVersion: typeof EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS.campaignManifest;
	readonly campaignRef: string;
	readonly familyRef: string;
	readonly lane: "empirical-real-model";
	readonly catalog: EmpiricalTaskCatalogV1;
	readonly qualification: {
		readonly qualificationRevision: string;
		readonly taskCatalogDigest: string;
		readonly reportDigest: string;
	};
	readonly trialPlan: EmpiricalTrialPlanV1;
	readonly schemaCatalog: EmpiricalSchemaCatalogV1;
	readonly modelConfigurations: readonly EmpiricalModelConfigurationV1[];
	readonly policies: EmpiricalCampaignPolicyCoordinatesV1;
	readonly budgets: EmpiricalCampaignBudgetsV1;
	readonly aggregation: EmpiricalCampaignAggregationV1;
}

export interface EmpiricalTaskQualificationObservationV1 {
	readonly schemaVersion: typeof EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS.taskQualificationObservation;
	readonly taskRef: string;
	readonly taskDigest: string;
	readonly verifierProfileRef: string;
	readonly verifierProfileRevision: string;
	readonly verifierProfileDigest: string;
	readonly workspace: {
		readonly actorTreeDigest: string;
		readonly workspaceRecipeRef: string;
		readonly workspaceRecipeRevision: string;
		readonly workspaceRecipeDigest: string;
		readonly environmentDigest: string;
		readonly toolchainDigest: string;
		readonly repositoryState: "clean-single-baseline" | "other";
		readonly remotes: number;
		readonly descendantHistoryVisible: boolean;
		readonly uncommittedChanges: boolean;
		readonly overlayVisibleAsDiff: boolean;
		readonly hiddenVerifierMaterialVisible: boolean;
		readonly expectedPatchVisible: boolean;
		readonly freshMaterializationVerified: boolean;
		readonly sharedCacheMode: "none" | "readonly" | "mutable";
		readonly cleanupFailureClassifiedNonEvaluable: boolean;
	};
	readonly commands: {
		readonly policyRef: string;
		readonly policyRevision: string;
		readonly policyDigest: string;
		readonly resolved: boolean;
		readonly networkAllowed: boolean;
		readonly containerRuntimeAllowed: boolean;
		readonly credentialAccessAllowed: boolean;
		readonly outOfTreeWritesAllowed: boolean;
	};
	readonly verifierCalibration: {
		readonly executable: boolean;
		readonly targetDefectVerdict: "passed" | "failed" | "unverifiable";
		readonly knownGoodVerdict: "passed" | "failed" | "unverifiable";
		readonly plausibleWrongVerdict: "passed" | "failed" | "unverifiable";
		readonly actorClaimsCanSatisfy: boolean;
		readonly verifierTamperingRejected: boolean;
		readonly outOfPolicyDiffRejected: boolean;
		readonly evidenceComplete: boolean;
		readonly missingEvidenceClassifiedNonEvaluable: boolean;
		readonly unreliableEvidenceClassifiedNonEvaluable: boolean;
		readonly nonExecutableEvidenceClassifiedNonEvaluable: boolean;
		readonly testTamperingRejected: boolean;
		readonly fixtureSuiteRevision: string;
		readonly fixtureSuiteDigest: string;
		readonly harnessRevision: string;
		readonly evidenceRefs: readonly EmpiricalEvidenceRefV1[];
	};
	readonly duration: {
		readonly observedDurationMs: number;
		readonly limitMs: number;
	};
	readonly issueCodes: readonly string[];
}

export interface EmpiricalTaskQualificationReportV1 {
	readonly schemaVersion: typeof EMPIRICAL_MEMORY_RERUN_AVOIDANCE_SCHEMAS.taskQualificationReport;
	readonly taskCatalogDigest: string;
	readonly observations: readonly EmpiricalTaskQualificationObservationV1[];
	readonly qualified: boolean;
	readonly issueCodes: readonly string[];
}

export interface FrozenEmpiricalCampaignManifestV1 {
	readonly manifest: EmpiricalCampaignManifestV1;
	readonly canonicalBytes: readonly number[];
	readonly manifestDigest: string;
	readonly taskCatalogDigest: string;
}
