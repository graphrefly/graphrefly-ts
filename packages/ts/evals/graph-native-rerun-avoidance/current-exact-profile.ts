import { CURRENT_IMPLEMENTATION_MANIFEST_DIGEST } from "./implementation-manifest.js";
import {
	createDeepSeekV4Flash0731FireworksStructuredProfileDefinition,
	createInjectedNoNetworkProfileQualification,
	exactQualifiedProfileCatalogInput,
	type QualifiedProfileCatalogInput,
} from "./model-harness-profile.js";
import { MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST } from "./model-harness-profile-qualification.js";

export function createCurrentExactModelHarnessProfileInput(): QualifiedProfileCatalogInput {
	const definition = createDeepSeekV4Flash0731FireworksStructuredProfileDefinition();
	const qualification = createInjectedNoNetworkProfileQualification({
		definition,
		implementationManifestDigest: CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: MODEL_HARNESS_PROFILE_NO_NETWORK_QA_ARTIFACT_DIGEST,
	});
	return exactQualifiedProfileCatalogInput(
		{ ...definition, qualification },
		CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
	);
}
