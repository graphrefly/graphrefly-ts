import { chmod, mkdir, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { admitD25D24Baseline } from "./d25-phase-specific-tool-admission.js";
import {
	D25_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD25Implementation,
} from "./d25-phase-specific-tool-implementation-manifest.js";
import {
	persistD25QualificationBundle,
	runD25InjectedNoNetworkQualification,
	validateD25QualificationBundle,
} from "./d25-phase-specific-tool-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d25",
);
const d24Artifact = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d23/current-graph-native-efficacy-live-2026-08-16-d23-v1/artifacts/bundle.v1.json",
);

await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
const measured = await measureD25Implementation(repositoryRoot);
if (measured !== D25_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D25 implementation manifest drifted before qualification");
const bundle = await runD25InjectedNoNetworkQualification({
	baseline: admitD25D24Baseline(new Uint8Array(await readFile(d24Artifact))),
	basis: "consumed-d24-artifact",
	implementationManifestDigest: measured,
});
validateD25QualificationBundle(bundle);
const receipt = await persistD25QualificationBundle({
	privateRoot: await realpath(privateRoot),
	bundle,
});
if ((await measureD25Implementation(repositoryRoot)) !== D25_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D25 implementation manifest drifted after qualification");
process.stdout.write(
	`${JSON.stringify({
		decisionRef: bundle.qualification.decisionRef,
		bundleArtifactDigest: receipt.artifactDigest,
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
		implementationManifestDigest: measured,
		exactSixArmsCompleted: bundle.qualification.exactSixArmsCompleted,
		d24NearMissMatrixPassed: bundle.qualification.d24NearMissMatrixPassed,
		providerNetworkCalls: bundle.qualification.providerNetworkCalls,
		liveGateEvaluated: bundle.qualification.liveGateEvaluated,
		efficacyClaim: bundle.qualification.efficacyClaim,
	})}\n`,
);
