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

export const MODEL_TARGET_SCHEMA = "graphrefly-ts.model-target.v1" as const;
export const HARNESS_ENHANCEMENT_PROFILE_SCHEMA =
	"graphrefly-ts.harness-enhancement-profile.v2" as const;
export const PROVIDER_BINDING_SCHEMA = "graphrefly-ts.provider-binding.v2" as const;
export const PROFILE_QUALIFICATION_SCHEMA = "graphrefly-ts.profile-qualification.v1" as const;
export const CURRENT_PROFILE_ELIGIBILITY_SCHEMA =
	"graphrefly-ts.current-profile-eligibility.v1" as const;
export const PROFILE_RESOLUTION_SCHEMA = "graphrefly-ts.profile-resolution.v1" as const;
export const PROFILE_RESOLVER_REVISION = "graphrefly-ts.profile-resolver.v1" as const;
export const PROFILE_DECISION_REF = "graphrefly-ts:D96" as const;

export const HARNESS_ENHANCEMENT_RECIPES = Object.freeze([
	"named-phase-tool-binding",
	"retained-inspection-span",
	"premature-final-correction",
	"fresh-mutation-after-exact-replacement-rejection",
	"actor-visible-semantic-correction",
	"sanitized-provider-failure-continuation",
] as const);

export type HarnessEnhancementRecipe = (typeof HARNESS_ENHANCEMENT_RECIPES)[number];

export interface ModelTarget {
	readonly schemaVersion: typeof MODEL_TARGET_SCHEMA;
	readonly targetRef: string;
	readonly modelRef: string;
	readonly modelRevision: string;
	readonly targetDigest: string;
}

export interface HarnessEnhancementProfile {
	readonly schemaVersion: typeof HARNESS_ENHANCEMENT_PROFILE_SCHEMA;
	readonly profileRef: string;
	readonly targetRef: string;
	readonly targetDigest: string;
	readonly inspectionMaxOutputTokens: number;
	readonly mutationMaxOutputTokens: number;
	readonly reasoningEffort: "medium";
	readonly enhancementRecipes: readonly HarnessEnhancementRecipe[];
	readonly profileDigest: string;
}

export interface ProviderBinding {
	readonly schemaVersion: typeof PROVIDER_BINDING_SCHEMA;
	readonly bindingRef: string;
	readonly targetRef: string;
	readonly targetDigest: string;
	readonly providerRef: string;
	readonly providerModelRef: string;
	readonly endpointProtocol: "chat-completions" | "responses";
	readonly proposalEncoding: "strict-json-schema";
	readonly responseContractRevision: string;
	readonly bindingDigest: string;
}

export interface ProfileQualification {
	readonly schemaVersion: typeof PROFILE_QUALIFICATION_SCHEMA;
	readonly qualificationRef: string;
	readonly targetRef: string;
	readonly targetDigest: string;
	readonly profileRef: string;
	readonly profileDigest: string;
	readonly bindingRef: string;
	readonly bindingDigest: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationMode: "injected-no-network";
	readonly qualified: true;
	readonly credentialAccessed: false;
	readonly providerNetworkAccessed: false;
	readonly liveEvaluationExecuted: false;
	readonly qualificationDigest: string;
}

export interface CurrentProfileEligibility {
	readonly schemaVersion: typeof CURRENT_PROFILE_ELIGIBILITY_SCHEMA;
	readonly decisionRef: typeof PROFILE_DECISION_REF;
	readonly eligibilityRef: string;
	readonly targetRef: string;
	readonly targetDigest: string;
	readonly profileRef: string;
	readonly profileDigest: string;
	readonly bindingRef: string;
	readonly bindingDigest: string;
	readonly qualificationRef: string;
	readonly qualificationDigest: string;
	readonly implementationManifestDigest: string;
	readonly status: "eligible" | "denied";
	readonly reasonCode: string;
	readonly eligibilityDigest: string;
}

export type ProfileResolutionFailureCode =
	| "no-exact-qualified-profile"
	| "ambiguous-exact-qualified-profile"
	| "qualification-stale"
	| "tuple-digest-mismatch"
	| "current-eligibility-denied";

export interface EligibleProfileResolution {
	readonly schemaVersion: typeof PROFILE_RESOLUTION_SCHEMA;
	readonly resolverRevision: typeof PROFILE_RESOLVER_REVISION;
	readonly status: "eligible";
	readonly requestedTargetRef: string;
	readonly targetRef: string;
	readonly targetDigest: string;
	readonly profileRef: string;
	readonly profileDigest: string;
	readonly bindingRef: string;
	readonly bindingDigest: string;
	readonly providerRef: string;
	readonly qualificationRef: string;
	readonly qualificationDigest: string;
	readonly eligibilityRef: string;
	readonly eligibilityDigest: string;
	readonly implementationManifestDigest: string;
	readonly resolutionDigest: string;
}

export interface IneligibleProfileResolution {
	readonly schemaVersion: typeof PROFILE_RESOLUTION_SCHEMA;
	readonly resolverRevision: typeof PROFILE_RESOLVER_REVISION;
	readonly status: "ineligible";
	readonly requestedTargetRef: string;
	readonly failureCode: ProfileResolutionFailureCode;
	readonly candidateCount: number;
	readonly resolutionDigest: string;
}

export type ProfileResolution = EligibleProfileResolution | IneligibleProfileResolution;

export interface QualifiedProfileCatalogInput {
	readonly requestedTargetRef: string;
	readonly currentImplementationManifestDigest: string;
	readonly targets: readonly ModelTarget[];
	readonly profiles: readonly HarnessEnhancementProfile[];
	readonly bindings: readonly ProviderBinding[];
	readonly qualifications: readonly ProfileQualification[];
}

export interface ProfileResolverInput extends QualifiedProfileCatalogInput {
	readonly currentEligibility: readonly CurrentProfileEligibility[];
}

export interface ProfileResolver {
	readonly revision: typeof PROFILE_RESOLVER_REVISION;
	resolve(input: ProfileResolverInput): ProfileResolution;
}

export interface ExactProfileDefinition {
	readonly target: ModelTarget;
	readonly profile: HarnessEnhancementProfile;
	readonly binding: ProviderBinding;
}

function withDigest<T extends object, K extends string>(
	material: T,
	key: K,
): T & Readonly<Record<K, string>> {
	return Object.freeze({ ...material, [key]: empiricalStrictJsonDigest(material) }) as T &
		Readonly<Record<K, string>>;
}

export function validateModelTarget(value: unknown): ModelTarget {
	const candidate = record(value, "model target");
	exactKeys(
		candidate,
		["modelRef", "modelRevision", "schemaVersion", "targetDigest", "targetRef"],
		"model target",
	);
	literal(candidate.schemaVersion, MODEL_TARGET_SCHEMA, "model target.schemaVersion");
	const material = strictSnapshot({
		schemaVersion: MODEL_TARGET_SCHEMA,
		targetRef: coordinate(candidate.targetRef, "model target.targetRef"),
		modelRef: coordinate(candidate.modelRef, "model target.modelRef"),
		modelRevision: coordinate(candidate.modelRevision, "model target.modelRevision"),
	});
	const targetDigest = digest(candidate.targetDigest, "model target.targetDigest");
	literal(targetDigest, empiricalStrictJsonDigest(material), "model target.targetDigest");
	return Object.freeze({ ...material, targetDigest });
}

export function createModelTarget(input: Omit<ModelTarget, "targetDigest">): ModelTarget {
	return validateModelTarget(withDigest(strictSnapshot(input), "targetDigest"));
}

export function validateHarnessEnhancementProfile(value: unknown): HarnessEnhancementProfile {
	const candidate = record(value, "harness enhancement profile");
	exactKeys(
		candidate,
		[
			"enhancementRecipes",
			"inspectionMaxOutputTokens",
			"mutationMaxOutputTokens",
			"reasoningEffort",
			"profileDigest",
			"profileRef",
			"schemaVersion",
			"targetDigest",
			"targetRef",
		],
		"harness enhancement profile",
	);
	literal(
		candidate.schemaVersion,
		HARNESS_ENHANCEMENT_PROFILE_SCHEMA,
		"harness enhancement profile.schemaVersion",
	);
	const rawRecipes = array(
		candidate.enhancementRecipes,
		"harness enhancement profile.enhancementRecipes",
	);
	if (rawRecipes.length < 1 || rawRecipes.length > HARNESS_ENHANCEMENT_RECIPES.length) {
		throw new TypeError("harness enhancement profile recipe count is outside its bound");
	}
	const enhancementRecipes = rawRecipes.map((recipe, index) =>
		oneOf(
			recipe,
			HARNESS_ENHANCEMENT_RECIPES,
			`harness enhancement profile.enhancementRecipes[${index}]`,
		),
	);
	if (new Set(enhancementRecipes).size !== enhancementRecipes.length) {
		throw new TypeError("harness enhancement profile recipes must be unique");
	}
	const material = strictSnapshot({
		schemaVersion: HARNESS_ENHANCEMENT_PROFILE_SCHEMA,
		profileRef: coordinate(candidate.profileRef, "harness enhancement profile.profileRef"),
		targetRef: coordinate(candidate.targetRef, "harness enhancement profile.targetRef"),
		targetDigest: digest(candidate.targetDigest, "harness enhancement profile.targetDigest"),
		inspectionMaxOutputTokens: safeInteger(
			candidate.inspectionMaxOutputTokens,
			"harness enhancement profile.inspectionMaxOutputTokens",
			{ min: 1, max: 131_072 },
		),
		mutationMaxOutputTokens: safeInteger(
			candidate.mutationMaxOutputTokens,
			"harness enhancement profile.mutationMaxOutputTokens",
			{ min: 1, max: 32_768 },
		),
		reasoningEffort: literal(
			candidate.reasoningEffort,
			"medium",
			"harness enhancement profile.reasoningEffort",
		),
		enhancementRecipes,
	});
	const profileDigest = digest(
		candidate.profileDigest,
		"harness enhancement profile.profileDigest",
	);
	literal(
		profileDigest,
		empiricalStrictJsonDigest(material),
		"harness enhancement profile.profileDigest",
	);
	return Object.freeze({ ...material, profileDigest });
}

export function createHarnessEnhancementProfile(
	input: Omit<HarnessEnhancementProfile, "profileDigest">,
): HarnessEnhancementProfile {
	return validateHarnessEnhancementProfile(withDigest(strictSnapshot(input), "profileDigest"));
}

export function validateProviderBinding(value: unknown): ProviderBinding {
	const candidate = record(value, "provider binding");
	exactKeys(
		candidate,
		[
			"bindingDigest",
			"bindingRef",
			"endpointProtocol",
			"proposalEncoding",
			"providerModelRef",
			"providerRef",
			"responseContractRevision",
			"schemaVersion",
			"targetDigest",
			"targetRef",
		],
		"provider binding",
	);
	literal(candidate.schemaVersion, PROVIDER_BINDING_SCHEMA, "provider binding.schemaVersion");
	const material = strictSnapshot({
		schemaVersion: PROVIDER_BINDING_SCHEMA,
		bindingRef: coordinate(candidate.bindingRef, "provider binding.bindingRef"),
		targetRef: coordinate(candidate.targetRef, "provider binding.targetRef"),
		targetDigest: digest(candidate.targetDigest, "provider binding.targetDigest"),
		providerRef: coordinate(candidate.providerRef, "provider binding.providerRef"),
		providerModelRef: coordinate(candidate.providerModelRef, "provider binding.providerModelRef"),
		endpointProtocol: oneOf(
			candidate.endpointProtocol,
			["chat-completions", "responses"] as const,
			"provider binding.endpointProtocol",
		),
		proposalEncoding: oneOf(
			candidate.proposalEncoding,
			["strict-json-schema"] as const,
			"provider binding.proposalEncoding",
		),
		responseContractRevision: coordinate(
			candidate.responseContractRevision,
			"provider binding.responseContractRevision",
		),
	});
	const bindingDigest = digest(candidate.bindingDigest, "provider binding.bindingDigest");
	literal(bindingDigest, empiricalStrictJsonDigest(material), "provider binding.bindingDigest");
	return Object.freeze({ ...material, bindingDigest });
}

export function createProviderBinding(
	input: Omit<ProviderBinding, "bindingDigest">,
): ProviderBinding {
	return validateProviderBinding(withDigest(strictSnapshot(input), "bindingDigest"));
}

export function validateProfileQualification(value: unknown): ProfileQualification {
	const candidate = record(value, "profile qualification");
	exactKeys(
		candidate,
		[
			"bindingDigest",
			"bindingRef",
			"credentialAccessed",
			"implementationManifestDigest",
			"liveEvaluationExecuted",
			"profileDigest",
			"profileRef",
			"providerNetworkAccessed",
			"qualificationArtifactDigest",
			"qualificationDigest",
			"qualificationMode",
			"qualificationRef",
			"qualified",
			"schemaVersion",
			"targetDigest",
			"targetRef",
		],
		"profile qualification",
	);
	literal(
		candidate.schemaVersion,
		PROFILE_QUALIFICATION_SCHEMA,
		"profile qualification.schemaVersion",
	);
	const material = strictSnapshot({
		schemaVersion: PROFILE_QUALIFICATION_SCHEMA,
		qualificationRef: coordinate(
			candidate.qualificationRef,
			"profile qualification.qualificationRef",
		),
		targetRef: coordinate(candidate.targetRef, "profile qualification.targetRef"),
		targetDigest: digest(candidate.targetDigest, "profile qualification.targetDigest"),
		profileRef: coordinate(candidate.profileRef, "profile qualification.profileRef"),
		profileDigest: digest(candidate.profileDigest, "profile qualification.profileDigest"),
		bindingRef: coordinate(candidate.bindingRef, "profile qualification.bindingRef"),
		bindingDigest: digest(candidate.bindingDigest, "profile qualification.bindingDigest"),
		implementationManifestDigest: digest(
			candidate.implementationManifestDigest,
			"profile qualification.implementationManifestDigest",
		),
		qualificationArtifactDigest: digest(
			candidate.qualificationArtifactDigest,
			"profile qualification.qualificationArtifactDigest",
		),
		qualificationMode: literal(
			candidate.qualificationMode,
			"injected-no-network",
			"profile qualification.qualificationMode",
		),
		qualified: literal(candidate.qualified, true, "profile qualification.qualified"),
		credentialAccessed: literal(
			candidate.credentialAccessed,
			false,
			"profile qualification.credentialAccessed",
		),
		providerNetworkAccessed: literal(
			candidate.providerNetworkAccessed,
			false,
			"profile qualification.providerNetworkAccessed",
		),
		liveEvaluationExecuted: literal(
			candidate.liveEvaluationExecuted,
			false,
			"profile qualification.liveEvaluationExecuted",
		),
	});
	const qualificationDigest = digest(
		candidate.qualificationDigest,
		"profile qualification.qualificationDigest",
	);
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(material),
		"profile qualification.qualificationDigest",
	);
	return Object.freeze({ ...material, qualificationDigest });
}

export function createProfileQualification(
	input: Omit<ProfileQualification, "qualificationDigest">,
): ProfileQualification {
	return validateProfileQualification(withDigest(strictSnapshot(input), "qualificationDigest"));
}

export function validateCurrentProfileEligibility(value: unknown): CurrentProfileEligibility {
	const candidate = record(value, "current profile eligibility");
	exactKeys(
		candidate,
		[
			"bindingDigest",
			"bindingRef",
			"decisionRef",
			"eligibilityDigest",
			"eligibilityRef",
			"implementationManifestDigest",
			"profileDigest",
			"profileRef",
			"qualificationDigest",
			"qualificationRef",
			"reasonCode",
			"schemaVersion",
			"status",
			"targetDigest",
			"targetRef",
		],
		"current profile eligibility",
	);
	literal(
		candidate.schemaVersion,
		CURRENT_PROFILE_ELIGIBILITY_SCHEMA,
		"current profile eligibility.schemaVersion",
	);
	const material = strictSnapshot({
		schemaVersion: CURRENT_PROFILE_ELIGIBILITY_SCHEMA,
		decisionRef: literal(
			candidate.decisionRef,
			PROFILE_DECISION_REF,
			"current profile eligibility.decisionRef",
		),
		eligibilityRef: coordinate(
			candidate.eligibilityRef,
			"current profile eligibility.eligibilityRef",
		),
		targetRef: coordinate(candidate.targetRef, "current profile eligibility.targetRef"),
		targetDigest: digest(candidate.targetDigest, "current profile eligibility.targetDigest"),
		profileRef: coordinate(candidate.profileRef, "current profile eligibility.profileRef"),
		profileDigest: digest(candidate.profileDigest, "current profile eligibility.profileDigest"),
		bindingRef: coordinate(candidate.bindingRef, "current profile eligibility.bindingRef"),
		bindingDigest: digest(candidate.bindingDigest, "current profile eligibility.bindingDigest"),
		qualificationRef: coordinate(
			candidate.qualificationRef,
			"current profile eligibility.qualificationRef",
		),
		qualificationDigest: digest(
			candidate.qualificationDigest,
			"current profile eligibility.qualificationDigest",
		),
		implementationManifestDigest: digest(
			candidate.implementationManifestDigest,
			"current profile eligibility.implementationManifestDigest",
		),
		status: oneOf(
			candidate.status,
			["eligible", "denied"] as const,
			"current profile eligibility.status",
		),
		reasonCode: coordinate(candidate.reasonCode, "current profile eligibility.reasonCode"),
	});
	const eligibilityDigest = digest(
		candidate.eligibilityDigest,
		"current profile eligibility.eligibilityDigest",
	);
	literal(
		eligibilityDigest,
		empiricalStrictJsonDigest(material),
		"current profile eligibility.eligibilityDigest",
	);
	return Object.freeze({ ...material, eligibilityDigest });
}

function ineligible(
	requestedTargetRef: string,
	failureCode: ProfileResolutionFailureCode,
	candidateCount: number,
): IneligibleProfileResolution {
	const material = strictSnapshot({
		schemaVersion: PROFILE_RESOLUTION_SCHEMA,
		resolverRevision: PROFILE_RESOLVER_REVISION,
		status: "ineligible" as const,
		requestedTargetRef,
		failureCode,
		candidateCount,
	});
	return Object.freeze({ ...material, resolutionDigest: empiricalStrictJsonDigest(material) });
}

function resolveProfile(input: ProfileResolverInput): ProfileResolution {
	const requestedTargetRef = coordinate(
		input.requestedTargetRef,
		"profile resolver.requestedTargetRef",
	);
	const currentImplementationManifestDigest = digest(
		input.currentImplementationManifestDigest,
		"profile resolver.currentImplementationManifestDigest",
	);
	const targets = array(input.targets, "profile resolver.targets").map(validateModelTarget);
	const profiles = array(input.profiles, "profile resolver.profiles").map(
		validateHarnessEnhancementProfile,
	);
	const bindings = array(input.bindings, "profile resolver.bindings").map(validateProviderBinding);
	const qualifications = array(input.qualifications, "profile resolver.qualifications").map(
		validateProfileQualification,
	);
	const eligibility = array(input.currentEligibility, "profile resolver.currentEligibility").map(
		validateCurrentProfileEligibility,
	);
	if (
		[targets, profiles, bindings, qualifications, eligibility].some((items) => items.length > 32)
	) {
		throw new TypeError("profile resolver catalog exceeded its bound");
	}
	const requestedTargets = targets.filter((target) => target.targetRef === requestedTargetRef);
	if (requestedTargets.length !== 1) {
		return ineligible(
			requestedTargetRef,
			requestedTargets.length > 1
				? "ambiguous-exact-qualified-profile"
				: "no-exact-qualified-profile",
			requestedTargets.length,
		);
	}
	const target = requestedTargets[0]!;
	let sawDigestMismatch = false;
	let sawStale = false;
	let sawDenied = false;
	let ambiguousCurrentEligibilityCount = 0;
	const matches: Array<{
		readonly profile: HarnessEnhancementProfile;
		readonly binding: ProviderBinding;
		readonly qualification: ProfileQualification;
		readonly eligibility: CurrentProfileEligibility;
	}> = [];
	for (const profile of profiles.filter((item) => item.targetRef === target.targetRef)) {
		if (profile.targetDigest !== target.targetDigest) {
			sawDigestMismatch = true;
			continue;
		}
		for (const binding of bindings.filter((item) => item.targetRef === target.targetRef)) {
			if (binding.targetDigest !== target.targetDigest) {
				sawDigestMismatch = true;
				continue;
			}
			for (const qualification of qualifications.filter(
				(item) =>
					item.targetRef === target.targetRef &&
					item.profileRef === profile.profileRef &&
					item.bindingRef === binding.bindingRef,
			)) {
				if (
					qualification.targetDigest !== target.targetDigest ||
					qualification.profileDigest !== profile.profileDigest ||
					qualification.bindingDigest !== binding.bindingDigest
				) {
					sawDigestMismatch = true;
					continue;
				}
				if (qualification.implementationManifestDigest !== currentImplementationManifestDigest) {
					sawStale = true;
					continue;
				}
				const currentCandidates = eligibility.filter(
					(item) =>
						item.targetRef === target.targetRef &&
						item.profileRef === profile.profileRef &&
						item.bindingRef === binding.bindingRef &&
						item.qualificationRef === qualification.qualificationRef,
				);
				if (currentCandidates.length > 1) {
					ambiguousCurrentEligibilityCount = Math.max(
						ambiguousCurrentEligibilityCount,
						currentCandidates.length,
					);
					continue;
				}
				for (const current of currentCandidates) {
					if (
						current.targetDigest !== target.targetDigest ||
						current.profileDigest !== profile.profileDigest ||
						current.bindingDigest !== binding.bindingDigest ||
						current.qualificationDigest !== qualification.qualificationDigest
					) {
						sawDigestMismatch = true;
						continue;
					}
					if (current.implementationManifestDigest !== currentImplementationManifestDigest) {
						sawStale = true;
						continue;
					}
					if (current.status === "denied") {
						sawDenied = true;
						continue;
					}
					matches.push({ profile, binding, qualification, eligibility: current });
				}
			}
		}
	}
	if (matches.length !== 1) {
		const failureCode: ProfileResolutionFailureCode =
			matches.length > 1 || ambiguousCurrentEligibilityCount > 1
				? "ambiguous-exact-qualified-profile"
				: sawDigestMismatch
					? "tuple-digest-mismatch"
					: sawStale
						? "qualification-stale"
						: sawDenied
							? "current-eligibility-denied"
							: "no-exact-qualified-profile";
		return ineligible(
			requestedTargetRef,
			failureCode,
			Math.max(ambiguousCurrentEligibilityCount, matches.length),
		);
	}
	const selected = matches[0]!;
	const material = strictSnapshot({
		schemaVersion: PROFILE_RESOLUTION_SCHEMA,
		resolverRevision: PROFILE_RESOLVER_REVISION,
		status: "eligible" as const,
		requestedTargetRef,
		targetRef: target.targetRef,
		targetDigest: target.targetDigest,
		profileRef: selected.profile.profileRef,
		profileDigest: selected.profile.profileDigest,
		bindingRef: selected.binding.bindingRef,
		bindingDigest: selected.binding.bindingDigest,
		providerRef: selected.binding.providerRef,
		qualificationRef: selected.qualification.qualificationRef,
		qualificationDigest: selected.qualification.qualificationDigest,
		eligibilityRef: selected.eligibility.eligibilityRef,
		eligibilityDigest: selected.eligibility.eligibilityDigest,
		implementationManifestDigest: currentImplementationManifestDigest,
	});
	return Object.freeze({ ...material, resolutionDigest: empiricalStrictJsonDigest(material) });
}

export const deterministicProfileResolver: ProfileResolver = Object.freeze({
	revision: PROFILE_RESOLVER_REVISION,
	resolve: resolveProfile,
});

export function exactQualifiedProfileCatalogInput(
	profileSet: ExactProfileDefinition & { readonly qualification: ProfileQualification },
	currentImplementationManifestDigest: string,
): QualifiedProfileCatalogInput {
	return Object.freeze({
		requestedTargetRef: profileSet.target.targetRef,
		currentImplementationManifestDigest,
		targets: Object.freeze([profileSet.target]),
		profiles: Object.freeze([profileSet.profile]),
		bindings: Object.freeze([profileSet.binding]),
		qualifications: Object.freeze([profileSet.qualification]),
	});
}

export function createDeepSeekV4Flash0731FireworksStructuredProfileDefinition(
	input: {
		readonly enhancementRecipes?: readonly HarnessEnhancementRecipe[];
		readonly inspectionMaxOutputTokens?: number;
		readonly mutationMaxOutputTokens?: number;
		readonly reasoningEffort?: "medium";
	} = {},
): ExactProfileDefinition {
	const target = createModelTarget({
		schemaVersion: MODEL_TARGET_SCHEMA,
		targetRef: "model-target.deepseek-v4-flash-0731",
		modelRef: "deepseek/deepseek-v4-flash-0731",
		modelRevision: "0731",
	});
	const profile = createHarnessEnhancementProfile({
		schemaVersion: HARNESS_ENHANCEMENT_PROFILE_SCHEMA,
		profileRef: "harness-profile.deepseek-v4-flash-0731.v2",
		targetRef: target.targetRef,
		targetDigest: target.targetDigest,
		inspectionMaxOutputTokens: input.inspectionMaxOutputTokens ?? 65_536,
		mutationMaxOutputTokens: input.mutationMaxOutputTokens ?? 16_384,
		reasoningEffort: input.reasoningEffort ?? "medium",
		enhancementRecipes: input.enhancementRecipes ?? HARNESS_ENHANCEMENT_RECIPES,
	});
	const binding = createProviderBinding({
		schemaVersion: PROVIDER_BINDING_SCHEMA,
		bindingRef: "provider-binding.fireworks-structured-chat.v2",
		targetRef: target.targetRef,
		targetDigest: target.targetDigest,
		providerRef: "fireworks",
		providerModelRef: target.modelRef,
		endpointProtocol: "chat-completions",
		proposalEncoding: "strict-json-schema",
		responseContractRevision: "bounded-structured-proposal.v3",
	});
	return Object.freeze({ target, profile, binding });
}

export function createInjectedNoNetworkProfileQualification(input: {
	readonly definition: ExactProfileDefinition;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
}): ProfileQualification {
	const target = validateModelTarget(input.definition.target);
	const profile = validateHarnessEnhancementProfile(input.definition.profile);
	const binding = validateProviderBinding(input.definition.binding);
	if (
		profile.targetRef !== target.targetRef ||
		profile.targetDigest !== target.targetDigest ||
		binding.targetRef !== target.targetRef ||
		binding.targetDigest !== target.targetDigest
	)
		throw new TypeError("profile qualification definition tuple drifted");
	const implementationManifestDigest = digest(
		input.implementationManifestDigest,
		"profile qualification input.implementationManifestDigest",
	);
	const qualification = createProfileQualification({
		schemaVersion: PROFILE_QUALIFICATION_SCHEMA,
		qualificationRef: "profile-qualification.deepseek-v4-flash-0731.fireworks-structured.v3",
		targetRef: target.targetRef,
		targetDigest: target.targetDigest,
		profileRef: profile.profileRef,
		profileDigest: profile.profileDigest,
		bindingRef: binding.bindingRef,
		bindingDigest: binding.bindingDigest,
		implementationManifestDigest,
		qualificationArtifactDigest: digest(
			input.qualificationArtifactDigest,
			"profile qualification input.qualificationArtifactDigest",
		),
		qualificationMode: "injected-no-network",
		qualified: true,
		credentialAccessed: false,
		providerNetworkAccessed: false,
		liveEvaluationExecuted: false,
	});
	return qualification;
}
