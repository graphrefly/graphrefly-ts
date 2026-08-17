import { chmod, mkdir, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
	D23_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD23Implementation,
} from "./d23-current-efficacy-live-implementation-manifest.js";
import {
	admitD23QualificationBaseline,
	persistD23Qualification,
	runD23InjectedNoNetworkQualification,
	validateD23QualificationBundle,
} from "./d23-current-efficacy-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d23",
);
const d22Artifact = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d22/current-graph-native-efficacy-real-provider-no-network-2026-08-16-d22-v2/artifacts/bundle.v1.json",
);

await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
const measured = await measureD23Implementation(repositoryRoot);
if (measured !== D23_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D23 implementation manifest drifted before qualification");
const bundle = await runD23InjectedNoNetworkQualification({
	repositoryRoot,
	baseline: admitD23QualificationBaseline(new Uint8Array(await readFile(d22Artifact))),
	implementationManifestDigest: measured,
});
validateD23QualificationBundle(bundle);
const receipt = await persistD23Qualification({ privateRoot: await realpath(privateRoot), bundle });
if ((await measureD23Implementation(repositoryRoot)) !== D23_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D23 implementation manifest drifted after qualification");
process.stdout.write(
	`${JSON.stringify({
		decisionRef: bundle.qualification.decisionRef,
		bundleArtifactDigest: receipt.bundleArtifactDigest,
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
		implementationManifestDigest: measured,
		providerAttempts: bundle.qualification.providerAttempts,
		providerNetworkCalls: bundle.qualification.providerNetworkCalls,
		liveGateEvaluated: bundle.qualification.liveGateEvaluated,
		efficacyClaim: bundle.qualification.efficacyClaim,
	})}\n`,
);
