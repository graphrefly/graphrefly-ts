import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { D729_IMPLEMENTATION_MANIFEST_DIGEST } from "./d729-implementation-manifest.js";

export const D730_DECISION_REF = "decision.D730" as const;
export const D730_DECISION_REVISION = "2026-08-11.v1" as const;
export const D730_GENERATION_REF = "d730-d729-current-route-live-2026-08-11-v1" as const;
export const D730_QUALIFIED_D729_COMMIT = "6fdd2556" as const;
export const D730_QUALIFIED_NODE_VERSION = "v24.18.0" as const;
export const D730_D729_PRELIVE_ARTIFACT_SHA256 =
	"sha256:97aa4e7e27f9a644b1deab698db56bbc0eeb65359e6f3af2ca58f8c820d305a8" as const;
export const D730_D729_PRELIVE_BUNDLE_DIGEST =
	"sha256:1621745957acbecd3310f06aa796a193df09e67e150b079da23395f5c0085915" as const;
export const D730_D729_PRELIVE_QUALIFICATION_DIGEST =
	"sha256:cda3e4fba2a00584e23042ec64cd1b3b6731c8e131a8f435e99f0c708f88ea43" as const;
export const D730_D729_PRELIVE_GENERATION_DIGEST =
	"sha256:71d2af842509812cf5dc6c1f507deee9e5762e77a752890108aa6ae51f8d0b68" as const;
export const D730_D729_PRELIVE_TERMINAL_RECEIPT_DIGEST =
	"sha256:e6ea57f053a42ca356c4a3c7aded00027eaa3b9eda8e1f6651fc6901ee371832" as const;
export const D730_LIVE_RUNNER_SHA256 =
	"sha256:a110f94c8215ec3f537f2902ce1601d2f94975f06fde5ba83741404de51a32b2" as const;

export const D730_AUTHORIZATION_COORDINATES = strictSnapshot({
	decisionRef: D730_DECISION_REF,
	decisionRevision: D730_DECISION_REVISION,
	generationRef: D730_GENERATION_REF,
	qualifiedD729Commit: D730_QUALIFIED_D729_COMMIT,
	qualifiedNodeVersion: D730_QUALIFIED_NODE_VERSION,
	d729ImplementationManifestDigest: D729_IMPLEMENTATION_MANIFEST_DIGEST,
	d729PreLiveArtifactSha256: D730_D729_PRELIVE_ARTIFACT_SHA256,
	d729PreLiveBundleDigest: D730_D729_PRELIVE_BUNDLE_DIGEST,
	d729PreLiveQualificationDigest: D730_D729_PRELIVE_QUALIFICATION_DIGEST,
	d729PreLiveGenerationDigest: D730_D729_PRELIVE_GENERATION_DIGEST,
	d729PreLiveTerminalReceiptDigest: D730_D729_PRELIVE_TERMINAL_RECEIPT_DIGEST,
	blockHardCapMicrousd: 6_000_000,
	localEvalNoResetLimitMicrousd: 32_000_000,
	blockCount: 1,
	maxActiveArms: 1,
	coldCensorsWarm: false,
	retryPolicies: ["D671", "D675", "D710"],
	fallbackAllowed: false,
	providerModelRouteSwitchAllowed: false,
	parallelOrBackgroundCallsAllowed: false,
	automaticRerunAllowed: false,
	causalAttribution: "undetermined",
	efficacyClaim: "none",
});

export const D730_AUTHORIZATION_COORDINATES_DIGEST = empiricalStrictJsonDigest(
	D730_AUTHORIZATION_COORDINATES,
);

export function validateD730LiveRunnerBytes(bytes: Uint8Array): string {
	if (empiricalSha256(bytes) !== D730_LIVE_RUNNER_SHA256)
		throw new TypeError("D730 live operator source drifted");
	return D730_AUTHORIZATION_COORDINATES_DIGEST;
}
