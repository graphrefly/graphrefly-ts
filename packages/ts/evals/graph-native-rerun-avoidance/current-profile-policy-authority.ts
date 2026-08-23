import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import { CURRENT_IMPLEMENTATION_MANIFEST_DIGEST } from "./implementation-manifest.js";
import {
	CURRENT_PROFILE_ELIGIBILITY_SCHEMA,
	type CurrentProfileEligibility,
	createDeepSeekV4Flash0731DeepInfraFp8ProfileDefinition,
	createInjectedNoNetworkProfileQualification,
	deterministicProfileResolver,
	PROFILE_DECISION_REF,
	type ProfileResolution,
	type ProfileResolverInput,
	type QualifiedProfileCatalogInput,
	validateCurrentProfileEligibility,
	validateHarnessEnhancementProfile,
	validateModelTarget,
	validateProfileQualification,
	validateProviderBinding,
} from "./model-harness-profile.js";
import { MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST } from "./model-harness-profile-qualification.js";

export const CURRENT_PROFILE_POLICY_AUTHORITY_REVISION =
	"graphrefly-ts.current-profile-policy-authority.d74.v1" as const;

export interface CurrentProfilePolicyAuthority {
	readonly revision: typeof CURRENT_PROFILE_POLICY_AUTHORITY_REVISION;
}

export interface CurrentProfilePolicyResolution {
	readonly resolverInput: ProfileResolverInput;
	readonly resolution: ProfileResolution;
}

interface PolicyProposal {
	readonly targetIndex: number;
	readonly profileIndex: number;
	readonly bindingIndex: number;
	readonly qualificationIndex: number;
}

const states = new WeakMap<object, CurrentProfilePolicyResolution>();

function currentEligibility(input: {
	readonly target: ReturnType<typeof validateModelTarget>;
	readonly profile: ReturnType<typeof validateHarnessEnhancementProfile>;
	readonly binding: ReturnType<typeof validateProviderBinding>;
	readonly qualification: ReturnType<typeof validateProfileQualification>;
}): CurrentProfileEligibility {
	const material = strictSnapshot({
		schemaVersion: CURRENT_PROFILE_ELIGIBILITY_SCHEMA,
		decisionRef: PROFILE_DECISION_REF,
		eligibilityRef: `current-profile-eligibility.${input.qualification.qualificationRef}.d74`,
		targetRef: input.target.targetRef,
		targetDigest: input.target.targetDigest,
		profileRef: input.profile.profileRef,
		profileDigest: input.profile.profileDigest,
		bindingRef: input.binding.bindingRef,
		bindingDigest: input.binding.bindingDigest,
		qualificationRef: input.qualification.qualificationRef,
		qualificationDigest: input.qualification.qualificationDigest,
		implementationManifestDigest: input.qualification.implementationManifestDigest,
		status: "eligible" as const,
		reasonCode: "graph-policy-exact-profile-current",
	});
	return validateCurrentProfileEligibility({
		...material,
		eligibilityDigest: empiricalStrictJsonDigest(material),
	});
}

export function createCurrentProfilePolicyAuthority(
	input: QualifiedProfileCatalogInput,
): CurrentProfilePolicyAuthority {
	const candidate = record(input, "current profile policy input");
	exactKeys(
		candidate,
		[
			"bindings",
			"currentImplementationManifestDigest",
			"profiles",
			"qualifications",
			"requestedTargetRef",
			"targets",
		],
		"current profile policy input",
	);
	const requestedTargetRef = input.requestedTargetRef;
	const currentImplementationManifestDigest = digest(
		input.currentImplementationManifestDigest,
		"current profile policy implementation manifest",
	);
	const targets = array(input.targets, "current profile policy targets").map(validateModelTarget);
	const profiles = array(input.profiles, "current profile policy profiles").map(
		validateHarnessEnhancementProfile,
	);
	const bindings = array(input.bindings, "current profile policy bindings").map(
		validateProviderBinding,
	);
	const qualifications = array(input.qualifications, "current profile policy qualifications").map(
		validateProfileQualification,
	);
	const expectedDefinition = createDeepSeekV4Flash0731DeepInfraFp8ProfileDefinition();
	const expectedQualification = createInjectedNoNetworkProfileQualification({
		definition: expectedDefinition,
		implementationManifestDigest: CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST,
	});
	if ([targets, profiles, bindings, qualifications].some((items) => items.length > 32))
		throw new TypeError("current profile policy catalog exceeded its bound");

	const owner = graph({ name: "model-harness/current-profile-policy" });
	const proposalNode = owner.node<PolicyProposal>([], null, {
		name: "model-harness/current-profile-policy-proposals",
	});
	const admissionNode = owner.node<CurrentProfileEligibility>(
		[proposalNode],
		(ctx) => {
			for (const proposal of (depBatch(ctx, 0) ?? []) as readonly PolicyProposal[]) {
				const target = targets[proposal.targetIndex];
				const profile = profiles[proposal.profileIndex];
				const binding = bindings[proposal.bindingIndex];
				const qualification = qualifications[proposal.qualificationIndex];
				if (
					target === undefined ||
					profile === undefined ||
					binding === undefined ||
					qualification === undefined ||
					currentImplementationManifestDigest !== CURRENT_IMPLEMENTATION_MANIFEST_DIGEST ||
					target.targetRef !== expectedDefinition.target.targetRef ||
					target.targetDigest !== expectedDefinition.target.targetDigest ||
					profile.profileRef !== expectedDefinition.profile.profileRef ||
					profile.profileDigest !== expectedDefinition.profile.profileDigest ||
					binding.bindingRef !== expectedDefinition.binding.bindingRef ||
					binding.bindingDigest !== expectedDefinition.binding.bindingDigest ||
					qualification.qualificationRef !== expectedQualification.qualificationRef ||
					qualification.qualificationDigest !== expectedQualification.qualificationDigest ||
					profile.targetRef !== target.targetRef ||
					profile.targetDigest !== target.targetDigest ||
					binding.targetRef !== target.targetRef ||
					binding.targetDigest !== target.targetDigest ||
					binding.providerRef !== expectedDefinition.binding.providerRef ||
					binding.providerModelRef !== expectedDefinition.binding.providerModelRef ||
					binding.endpointProtocol !== expectedDefinition.binding.endpointProtocol ||
					binding.namedToolChoiceEncoding !== expectedDefinition.binding.namedToolChoiceEncoding ||
					binding.responseContractRevision !==
						expectedDefinition.binding.responseContractRevision ||
					qualification.targetRef !== target.targetRef ||
					qualification.targetDigest !== target.targetDigest ||
					qualification.profileRef !== profile.profileRef ||
					qualification.profileDigest !== profile.profileDigest ||
					qualification.bindingRef !== binding.bindingRef ||
					qualification.bindingDigest !== binding.bindingDigest ||
					qualification.implementationManifestDigest !== currentImplementationManifestDigest ||
					qualification.qualificationArtifactDigest !==
						MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST
				)
					continue;
				ctx.down([["DATA", currentEligibility({ target, profile, binding, qualification })]]);
			}
		},
		{
			name: "model-harness/current-profile-eligibility-admission",
			factory: "currentProfileEligibilityAdmission",
		},
	);
	const admitted: CurrentProfileEligibility[] = [];
	admissionNode.subscribe((message) => {
		if (message[0] !== "DATA") return;
		admitted.push(validateCurrentProfileEligibility(message[1]));
	});
	for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
		for (let profileIndex = 0; profileIndex < profiles.length; profileIndex += 1) {
			for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
				for (
					let qualificationIndex = 0;
					qualificationIndex < qualifications.length;
					qualificationIndex += 1
				) {
					proposalNode.down([
						["DATA", { targetIndex, profileIndex, bindingIndex, qualificationIndex }],
					]);
				}
			}
		}
	}
	const resolverInput: ProfileResolverInput = Object.freeze({
		requestedTargetRef,
		currentImplementationManifestDigest,
		targets: Object.freeze(targets),
		profiles: Object.freeze(profiles),
		bindings: Object.freeze(bindings),
		qualifications: Object.freeze(qualifications),
		currentEligibility: Object.freeze(admitted),
	});
	const resolution = deterministicProfileResolver.resolve(resolverInput);
	const authority = Object.freeze({ revision: CURRENT_PROFILE_POLICY_AUTHORITY_REVISION });
	states.set(authority, Object.freeze({ resolverInput, resolution }));
	return authority;
}

export function readCurrentProfilePolicyResolution(
	authority: CurrentProfilePolicyAuthority,
): CurrentProfilePolicyResolution {
	const state = states.get(authority as object);
	if (state === undefined) throw new TypeError("current profile policy authority is forged");
	return state;
}
