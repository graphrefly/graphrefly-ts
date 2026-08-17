import { chmod, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	admitD21D20FailureBaseline,
	D21_GENERATION_REF,
	persistD21QualificationBundle,
	runD21InjectedNoNetworkQualification,
	validateD21QualificationBundle,
} from "./d21-current-efficacy-recovery-authority.js";
import {
	D21_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD21Implementation,
} from "./d21-current-efficacy-recovery-implementation-manifest.js";

const repositoryRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const privateRoot = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/current-graph-native-d21",
);
const baselinePath = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/current-graph-native-d20/current-graph-native-efficacy-live-2026-08-16-d20-v1/artifacts/bundle.v1.json",
);

if ((await measureD21Implementation(repositoryRoot)) !== D21_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D21 implementation manifest drifted before qualification");
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
const bundle = await runD21InjectedNoNetworkQualification({
	baseline: admitD21D20FailureBaseline(new Uint8Array(await readFile(baselinePath))),
	implementationManifestDigest: D21_IMPLEMENTATION_MANIFEST_DIGEST,
});
validateD21QualificationBundle(bundle);
const receipt = await persistD21QualificationBundle({ privateRoot, bundle });
if ((await measureD21Implementation(repositoryRoot)) !== D21_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D21 implementation manifest drifted after qualification");

process.stdout.write(
	`${JSON.stringify(
		{
			disposition: "qualified-no-network",
			generationRef: D21_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			bundleArtifactDigest: receipt.artifactDigests["bundle.v1.json"],
			qualificationDigest: bundle.qualification.qualificationDigest,
			generationDigest: bundle.generation.generationDigest,
			implementationManifestDigest: D21_IMPLEMENTATION_MANIFEST_DIGEST,
			semanticRecoveryCount: bundle.qualification.semanticRecoveryCount,
			providerRejectionFactCount: bundle.qualification.providerRejectionFactCount,
			providerNetworkCalls: bundle.qualification.providerNetworkCalls,
			liveGateEvaluated: bundle.qualification.liveGateEvaluated,
			efficacyClaim: bundle.qualification.efficacyClaim,
			canonicalBytes: strictJsonCodec.encode(bundle).byteLength,
			receiptDigest: receipt.receiptDigest,
		},
		null,
		2,
	)}\n`,
);
