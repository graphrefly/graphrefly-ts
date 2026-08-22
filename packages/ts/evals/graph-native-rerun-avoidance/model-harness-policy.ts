import {
	array,
	boolean,
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

export const D43_DECISION_REF = "graphrefly-ts:D43" as const;
export const D43_POLICY_SCHEMA = "graphrefly-ts.d43.model-harness-policy.v1" as const;
export const D43_PLAN_SCHEMA = "graphrefly-ts.d43.harness-plan.v1" as const;
export const D43_CATALOG_REVISION = "graphrefly-ts.d43.policy-catalog.v1" as const;

export const D43_ARMS = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);

export const D43_ENHANCEMENT_RECIPES = Object.freeze([
	"named-phase-tool-binding",
	"retained-inspection-span",
	"premature-final-correction",
	"fresh-mutation-after-exact-replacement-rejection",
	"actor-visible-semantic-correction",
	"sanitized-provider-failure-continuation",
] as const);

function publicSemanticScenario(
	criterion:
		| "actor-visible-behavior-changed"
		| "acceptance-criteria-satisfied"
		| "scope-preserved"
		| "regression-free",
	scenarioRef: string,
	description: string,
) {
	const material = strictSnapshot({ criterion, scenarioRef, description });
	return Object.freeze({ ...material, scenarioDigest: empiricalStrictJsonDigest(material) });
}

export const D43_QUALIFICATION_PUBLIC_SEMANTIC_SCENARIOS = Object.freeze([
	publicSemanticScenario(
		"actor-visible-behavior-changed",
		"public-scenario.behavior-change.d43-v1",
		"A completed work item is not executed again when the actor repeats the same request.",
	),
	publicSemanticScenario(
		"acceptance-criteria-satisfied",
		"public-scenario.acceptance.d43-v1",
		"A non-completed work item remains eligible for execution under the public request contract.",
	),
	publicSemanticScenario(
		"scope-preserved",
		"public-scenario.scope.d43-v1",
		"Only the workspace scope named by the public request is changed.",
	),
	publicSemanticScenario(
		"regression-free",
		"public-scenario.regression.d43-v1",
		"Unrelated admission and cleanup behavior remains unchanged after the candidate mutation.",
	),
]);

export const D43_QUALIFICATION_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST = empiricalStrictJsonDigest(
	D43_QUALIFICATION_PUBLIC_SEMANTIC_SCENARIOS.map(({ criterion, scenarioRef, scenarioDigest }) => ({
		criterion,
		scenarioRef,
		scenarioDigest,
	})),
);

export type D43Arm = (typeof D43_ARMS)[number];
export type D43EnhancementRecipe = (typeof D43_ENHANCEMENT_RECIPES)[number];

export interface D43ModelDialectProfileV1 {
	readonly profileRef: string;
	readonly modelRef: string;
	readonly supportsNamedToolChoice: true;
	readonly supportsParallelToolCalls: boolean;
	readonly inspectionMaxOutputTokens: number;
	readonly mutationMaxOutputTokens: number;
	readonly profileDigest: string;
}

export interface D43ProviderBindingV1 {
	readonly bindingRef: string;
	readonly providerRef: string;
	readonly endpointProtocol: "chat-completions" | "responses";
	readonly namedToolChoiceEncoding: "function-object" | "tool-name";
	readonly allowFallback: false;
	readonly allowProviderSwitch: false;
	readonly allowParallelEffects: false;
	readonly providerDeadlineMs: number;
	readonly bindingDigest: string;
}

export interface D43CampaignPolicyV1 {
	readonly campaignRef: string;
	readonly arms: typeof D43_ARMS;
	readonly maxProviderAttempts: number;
	readonly maxCostMicrousd: number;
	readonly maxElapsedMs: number;
	readonly localEffectReservationMs: number;
	readonly providerReservationMicrousd: number;
	readonly publicSemanticScenarioSetDigest: string;
	readonly taskEnvelopeDigest: string;
	readonly maxSameLogicalRequestRetries: 1;
	readonly retryClasses: readonly ["D671", "D675", "D710"];
	readonly campaignDigest: string;
}

export interface D43ModelHarnessPolicyV1 {
	readonly schemaVersion: typeof D43_POLICY_SCHEMA;
	readonly policyRef: string;
	readonly model: D43ModelDialectProfileV1;
	readonly provider: D43ProviderBindingV1;
	readonly campaign: D43CampaignPolicyV1;
	readonly enhancementRecipes: readonly D43EnhancementRecipe[];
	readonly policyDigest: string;
}

export interface D43HarnessPlanV1 {
	readonly schemaVersion: typeof D43_PLAN_SCHEMA;
	readonly decisionRef: typeof D43_DECISION_REF;
	readonly assignmentRef: string;
	readonly policyRef: string;
	readonly modelRef: string;
	readonly providerRef: string;
	readonly campaignRef: string;
	readonly policyDigest: string;
	readonly modelProfileDigest: string;
	readonly providerBindingDigest: string;
	readonly campaignDigest: string;
	readonly enhancementRecipes: readonly D43EnhancementRecipe[];
	readonly arms: typeof D43_ARMS;
	readonly serialExecution: true;
	readonly maxActiveEffects: 1;
	readonly humanRuntimeApprovalRequired: false;
	readonly planDigest: string;
}

export interface D43PolicyCatalogV1 {
	readonly revision: typeof D43_CATALOG_REVISION;
}

const catalogs = new WeakMap<object, readonly D43ModelHarnessPolicyV1[]>();

function validateModel(value: unknown): D43ModelDialectProfileV1 {
	const candidate = record(value, "D43 policy.model");
	exactKeys(
		candidate,
		[
			"inspectionMaxOutputTokens",
			"modelRef",
			"mutationMaxOutputTokens",
			"profileDigest",
			"profileRef",
			"supportsNamedToolChoice",
			"supportsParallelToolCalls",
		],
		"D43 policy.model",
	);
	const material = strictSnapshot({
		profileRef: coordinate(candidate.profileRef, "D43 policy.model.profileRef"),
		modelRef: coordinate(candidate.modelRef, "D43 policy.model.modelRef"),
		supportsNamedToolChoice: literal(
			candidate.supportsNamedToolChoice,
			true,
			"D43 policy.model.supportsNamedToolChoice",
		),
		supportsParallelToolCalls: boolean(
			candidate.supportsParallelToolCalls,
			"D43 policy.model.supportsParallelToolCalls",
		),
		inspectionMaxOutputTokens: safeInteger(
			candidate.inspectionMaxOutputTokens,
			"D43 policy.model.inspectionMaxOutputTokens",
			{ min: 1, max: 131_072 },
		),
		mutationMaxOutputTokens: safeInteger(
			candidate.mutationMaxOutputTokens,
			"D43 policy.model.mutationMaxOutputTokens",
			{ min: 1, max: 32_768 },
		),
	});
	const profileDigest = digest(candidate.profileDigest, "D43 policy.model.profileDigest");
	literal(profileDigest, empiricalStrictJsonDigest(material), "D43 policy.model.profileDigest");
	return Object.freeze({ ...material, profileDigest });
}

function validateProvider(value: unknown): D43ProviderBindingV1 {
	const candidate = record(value, "D43 policy.provider");
	exactKeys(
		candidate,
		[
			"allowFallback",
			"allowParallelEffects",
			"allowProviderSwitch",
			"bindingDigest",
			"bindingRef",
			"endpointProtocol",
			"namedToolChoiceEncoding",
			"providerDeadlineMs",
			"providerRef",
		],
		"D43 policy.provider",
	);
	const material = strictSnapshot({
		bindingRef: coordinate(candidate.bindingRef, "D43 policy.provider.bindingRef"),
		providerRef: coordinate(candidate.providerRef, "D43 policy.provider.providerRef"),
		endpointProtocol: oneOf(
			candidate.endpointProtocol,
			["chat-completions", "responses"] as const,
			"D43 policy.provider.endpointProtocol",
		),
		namedToolChoiceEncoding: oneOf(
			candidate.namedToolChoiceEncoding,
			["function-object", "tool-name"] as const,
			"D43 policy.provider.namedToolChoiceEncoding",
		),
		allowFallback: literal(candidate.allowFallback, false, "D43 policy.provider.allowFallback"),
		allowProviderSwitch: literal(
			candidate.allowProviderSwitch,
			false,
			"D43 policy.provider.allowProviderSwitch",
		),
		allowParallelEffects: literal(
			candidate.allowParallelEffects,
			false,
			"D43 policy.provider.allowParallelEffects",
		),
		providerDeadlineMs: safeInteger(
			candidate.providerDeadlineMs,
			"D43 policy.provider.providerDeadlineMs",
			{ min: 1_000, max: 600_000 },
		),
	});
	const bindingDigest = digest(candidate.bindingDigest, "D43 policy.provider.bindingDigest");
	literal(bindingDigest, empiricalStrictJsonDigest(material), "D43 policy.provider.bindingDigest");
	return Object.freeze({ ...material, bindingDigest });
}

function validateCampaign(value: unknown): D43CampaignPolicyV1 {
	const candidate = record(value, "D43 policy.campaign");
	exactKeys(
		candidate,
		[
			"arms",
			"campaignDigest",
			"campaignRef",
			"maxCostMicrousd",
			"maxElapsedMs",
			"maxProviderAttempts",
			"maxSameLogicalRequestRetries",
			"localEffectReservationMs",
			"providerReservationMicrousd",
			"publicSemanticScenarioSetDigest",
			"retryClasses",
			"taskEnvelopeDigest",
		],
		"D43 policy.campaign",
	);
	const arms = array(candidate.arms, "D43 policy.campaign.arms");
	const retryClasses = array(candidate.retryClasses, "D43 policy.campaign.retryClasses");
	literal(empiricalStrictJsonDigest(arms), empiricalStrictJsonDigest(D43_ARMS), "D43 arms");
	literal(
		empiricalStrictJsonDigest(retryClasses),
		empiricalStrictJsonDigest(["D671", "D675", "D710"]),
		"D43 retry classes",
	);
	const material = strictSnapshot({
		campaignRef: coordinate(candidate.campaignRef, "D43 policy.campaign.campaignRef"),
		arms: D43_ARMS,
		maxProviderAttempts: safeInteger(
			candidate.maxProviderAttempts,
			"D43 policy.campaign.maxProviderAttempts",
			{ min: 6, max: 192 },
		),
		maxCostMicrousd: safeInteger(candidate.maxCostMicrousd, "D43 policy.campaign.maxCostMicrousd", {
			min: 1,
			max: 100_000_000,
		}),
		maxElapsedMs: safeInteger(candidate.maxElapsedMs, "D43 policy.campaign.maxElapsedMs", {
			min: 1_000,
			max: 86_400_000,
		}),
		localEffectReservationMs: safeInteger(
			candidate.localEffectReservationMs,
			"D43 policy.campaign.localEffectReservationMs",
			{ min: 1, max: 600_000 },
		),
		providerReservationMicrousd: safeInteger(
			candidate.providerReservationMicrousd,
			"D43 policy.campaign.providerReservationMicrousd",
			{ min: 1, max: 10_000_000 },
		),
		publicSemanticScenarioSetDigest: digest(
			candidate.publicSemanticScenarioSetDigest,
			"D43 policy.campaign.publicSemanticScenarioSetDigest",
		),
		taskEnvelopeDigest: digest(
			candidate.taskEnvelopeDigest,
			"D43 policy.campaign.taskEnvelopeDigest",
		),
		maxSameLogicalRequestRetries: literal(
			candidate.maxSameLogicalRequestRetries,
			1,
			"D43 policy.campaign.maxSameLogicalRequestRetries",
		),
		retryClasses: ["D671", "D675", "D710"] as const,
	});
	const campaignDigest = digest(candidate.campaignDigest, "D43 policy.campaign.campaignDigest");
	literal(
		campaignDigest,
		empiricalStrictJsonDigest(material),
		"D43 policy.campaign.campaignDigest",
	);
	return Object.freeze({ ...material, campaignDigest });
}

export function validateD43ModelHarnessPolicy(value: unknown): D43ModelHarnessPolicyV1 {
	const candidate = record(value, "D43 policy");
	exactKeys(
		candidate,
		[
			"campaign",
			"enhancementRecipes",
			"model",
			"policyDigest",
			"policyRef",
			"provider",
			"schemaVersion",
		],
		"D43 policy",
	);
	literal(candidate.schemaVersion, D43_POLICY_SCHEMA, "D43 policy.schemaVersion");
	const model = validateModel(candidate.model);
	const provider = validateProvider(candidate.provider);
	const campaign = validateCampaign(candidate.campaign);
	const rawRecipes = array(candidate.enhancementRecipes, "D43 policy.enhancementRecipes");
	if (rawRecipes.length < 1 || rawRecipes.length > D43_ENHANCEMENT_RECIPES.length)
		throw new TypeError("D43 policy enhancement recipe count is outside its bound");
	const recipes = rawRecipes.map((recipe, index) =>
		oneOf(recipe, D43_ENHANCEMENT_RECIPES, `D43 policy.enhancementRecipes[${index}]`),
	);
	if (new Set(recipes).size !== recipes.length)
		throw new TypeError("D43 policy enhancement recipes must be unique");
	const material = strictSnapshot({
		schemaVersion: D43_POLICY_SCHEMA,
		policyRef: coordinate(candidate.policyRef, "D43 policy.policyRef"),
		model,
		provider,
		campaign,
		enhancementRecipes: recipes,
	});
	const policyDigest = digest(candidate.policyDigest, "D43 policy.policyDigest");
	literal(policyDigest, empiricalStrictJsonDigest(material), "D43 policy.policyDigest");
	return Object.freeze({ ...material, policyDigest });
}

export function createD43ModelHarnessPolicy(input: {
	readonly policyRef: string;
	readonly model: Omit<D43ModelDialectProfileV1, "profileDigest">;
	readonly provider: Omit<D43ProviderBindingV1, "bindingDigest">;
	readonly campaign: Omit<D43CampaignPolicyV1, "campaignDigest">;
	readonly enhancementRecipes: readonly D43EnhancementRecipe[];
}): D43ModelHarnessPolicyV1 {
	const model = Object.freeze({
		...input.model,
		profileDigest: empiricalStrictJsonDigest(input.model),
	});
	const provider = Object.freeze({
		...input.provider,
		bindingDigest: empiricalStrictJsonDigest(input.provider),
	});
	const campaign = Object.freeze({
		...input.campaign,
		campaignDigest: empiricalStrictJsonDigest(input.campaign),
	});
	const material = strictSnapshot({
		schemaVersion: D43_POLICY_SCHEMA,
		policyRef: input.policyRef,
		model,
		provider,
		campaign,
		enhancementRecipes: input.enhancementRecipes,
	});
	return validateD43ModelHarnessPolicy({
		...material,
		policyDigest: empiricalStrictJsonDigest(material),
	});
}

export function createD43PolicyCatalog(
	policiesValue: readonly D43ModelHarnessPolicyV1[],
): D43PolicyCatalogV1 {
	const policies = array(policiesValue, "D43 catalog policies").map(validateD43ModelHarnessPolicy);
	if (policies.length < 1 || policies.length > 32)
		throw new TypeError("D43 policy catalog size is outside its bound");
	const keys = policies.map(
		(policy) =>
			`${policy.model.modelRef}\u0000${policy.provider.providerRef}\u0000${policy.campaign.campaignRef}`,
	);
	if (new Set(keys).size !== keys.length)
		throw new TypeError("D43 policy catalog contains an ambiguous assignment");
	const catalog = Object.freeze({ revision: D43_CATALOG_REVISION });
	catalogs.set(catalog, Object.freeze(policies));
	return catalog;
}

export function resolveD43HarnessPlan(
	catalog: D43PolicyCatalogV1,
	assignmentValue: {
		readonly assignmentRef: string;
		readonly modelRef: string;
		readonly providerRef: string;
		readonly campaignRef: string;
	},
): D43HarnessPlanV1 {
	const policies = catalogs.get(catalog as object);
	if (policies === undefined) throw new TypeError("D43 policy catalog is forged");
	const assignment = record(assignmentValue, "D43 assignment");
	exactKeys(
		assignment,
		["assignmentRef", "campaignRef", "modelRef", "providerRef"],
		"D43 assignment",
	);
	const assignmentRef = coordinate(assignment.assignmentRef, "D43 assignment.assignmentRef");
	const modelRef = coordinate(assignment.modelRef, "D43 assignment.modelRef");
	const providerRef = coordinate(assignment.providerRef, "D43 assignment.providerRef");
	const campaignRef = coordinate(assignment.campaignRef, "D43 assignment.campaignRef");
	const matches = policies.filter(
		(policy) =>
			policy.model.modelRef === modelRef &&
			policy.provider.providerRef === providerRef &&
			policy.campaign.campaignRef === campaignRef,
	);
	if (matches.length !== 1) throw new TypeError("D43 assignment has no unique approved policy");
	const policy = matches[0]!;
	const material = strictSnapshot({
		schemaVersion: D43_PLAN_SCHEMA,
		decisionRef: D43_DECISION_REF,
		assignmentRef,
		policyRef: policy.policyRef,
		modelRef,
		providerRef,
		campaignRef,
		policyDigest: policy.policyDigest,
		modelProfileDigest: policy.model.profileDigest,
		providerBindingDigest: policy.provider.bindingDigest,
		campaignDigest: policy.campaign.campaignDigest,
		enhancementRecipes: policy.enhancementRecipes,
		arms: D43_ARMS,
		serialExecution: true as const,
		maxActiveEffects: 1 as const,
		humanRuntimeApprovalRequired: false as const,
	});
	return Object.freeze({ ...material, planDigest: empiricalStrictJsonDigest(material) });
}

export function readD43PolicyForPlan(
	catalog: D43PolicyCatalogV1,
	plan: D43HarnessPlanV1,
): D43ModelHarnessPolicyV1 {
	const policies = catalogs.get(catalog as object);
	if (policies === undefined) throw new TypeError("D43 policy catalog is forged");
	const policy = policies.find((candidate) => candidate.policyDigest === plan.policyDigest);
	if (
		policy === undefined ||
		policy.policyRef !== plan.policyRef ||
		policy.model.modelRef !== plan.modelRef ||
		policy.provider.providerRef !== plan.providerRef ||
		policy.campaign.campaignRef !== plan.campaignRef
	)
		throw new TypeError("D43 plan is not bound to the resolved policy");
	const { planDigest, ...material } = plan;
	literal(planDigest, empiricalStrictJsonDigest(material), "D43 plan.planDigest");
	return policy;
}

export function createD43QualificationPolicy(): D43ModelHarnessPolicyV1 {
	return createD43ModelHarnessPolicy({
		policyRef: "policy.deepseek-v4-flash-0731.deepinfra-fp8.d43-v1",
		model: {
			profileRef: "model-profile.deepseek-v4-flash-0731.d43-v1",
			modelRef: "deepseek/deepseek-v4-flash-0731",
			supportsNamedToolChoice: true,
			supportsParallelToolCalls: false,
			inspectionMaxOutputTokens: 65_536,
			mutationMaxOutputTokens: 8_192,
		},
		provider: {
			bindingRef: "provider-binding.deepinfra-fp8-chat.d43-v1",
			providerRef: "deepinfra/fp8/chat",
			endpointProtocol: "chat-completions",
			namedToolChoiceEncoding: "function-object",
			allowFallback: false,
			allowProviderSwitch: false,
			allowParallelEffects: false,
			providerDeadlineMs: 120_000,
		},
		campaign: {
			campaignRef: "campaign.memory-rerun-avoidance.six-arm.d43-v1",
			arms: D43_ARMS,
			maxProviderAttempts: 96,
			maxCostMicrousd: 6_000_000,
			maxElapsedMs: 7_200_000,
			localEffectReservationMs: 10_000,
			providerReservationMicrousd: 100_000,
			publicSemanticScenarioSetDigest: D43_QUALIFICATION_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
			taskEnvelopeDigest: `sha256:${"b".repeat(64)}`,
			maxSameLogicalRequestRetries: 1,
			retryClasses: ["D671", "D675", "D710"],
		},
		enhancementRecipes: D43_ENHANCEMENT_RECIPES,
	});
}
