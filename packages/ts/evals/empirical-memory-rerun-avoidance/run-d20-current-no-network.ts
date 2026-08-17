import { chmod, mkdir, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
	D20_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD20Implementation,
} from "./d20-current-live-implementation-manifest.js";
import {
	admitD20QualificationBaseline,
	persistD20Qualification,
	runD20InjectedNoNetworkQualification,
} from "./d20-current-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d20",
);
const d19Artifact = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d19/current-graph-native-real-provider-no-network-2026-08-16-d19-v3/artifacts/bundle.v1.json",
);

await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
const measured = await measureD20Implementation(repositoryRoot);
if (measured !== D20_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D20 implementation manifest digest drifted");
const baseline = admitD20QualificationBaseline(new Uint8Array(await readFile(d19Artifact)));
const bundle = await runD20InjectedNoNetworkQualification({
	repositoryRoot,
	baseline,
	implementationManifestDigest: measured,
});
const receipt = await persistD20Qualification({
	privateRoot: await realpath(privateRoot),
	bundle,
});
process.stdout.write(
	`${JSON.stringify({
		decisionRef: bundle.qualification.decisionRef,
		bundleArtifactDigest: receipt.bundleArtifactDigest,
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
		implementationManifestDigest: measured,
		externalNetworkCalls: bundle.qualification.externalNetworkCalls,
		liveGateEvaluated: bundle.qualification.liveGateEvaluated,
		efficacyClaim: bundle.qualification.efficacyClaim,
	})}\n`,
);
