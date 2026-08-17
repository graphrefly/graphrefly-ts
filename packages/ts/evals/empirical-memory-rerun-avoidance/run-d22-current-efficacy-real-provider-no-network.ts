import { chmod, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	D22_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD22Implementation,
} from "./d22-current-efficacy-real-provider-implementation-manifest.js";
import {
	admitD22D21Baseline,
	D22_GENERATION_REF,
	persistD22QualificationBundle,
	runD22InjectedNoNetworkQualification,
	validateD22QualificationBundle,
} from "./d22-current-efficacy-real-provider-qualification.js";

const repositoryRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const privateRoot = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/current-graph-native-d22",
);
const baselinePath = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/current-graph-native-d21/current-graph-native-efficacy-recovery-no-network-2026-08-16-d21-v2/artifacts/bundle.v1.json",
);

if ((await measureD22Implementation(repositoryRoot)) !== D22_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D22 implementation manifest drifted before qualification");
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
const bundle = await runD22InjectedNoNetworkQualification({
	baseline: admitD22D21Baseline(new Uint8Array(await readFile(baselinePath))),
	implementationManifestDigest: D22_IMPLEMENTATION_MANIFEST_DIGEST,
	repositoryRoot,
});
validateD22QualificationBundle(bundle);
const receipt = await persistD22QualificationBundle({ privateRoot, bundle });
if ((await measureD22Implementation(repositoryRoot)) !== D22_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D22 implementation manifest drifted after qualification");

process.stdout.write(
	`${JSON.stringify(
		{
			disposition: "qualified-no-network",
			generationRef: D22_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			bundleArtifactDigest: receipt.artifactDigests["bundle.v1.json"],
			qualificationDigest: bundle.qualification.qualificationDigest,
			generationDigest: bundle.generation.generationDigest,
			implementationManifestDigest: D22_IMPLEMENTATION_MANIFEST_DIGEST,
			semanticRecoveryCount: bundle.qualification.semanticRecoveryCount,
			providerResultRejectionCount: bundle.qualification.providerResultRejectionCount,
			providerAttempts: bundle.qualification.providerAttempts,
			retryWaits: bundle.qualification.retryWaits,
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
