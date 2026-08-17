import { chmod, mkdir, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
	D26_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD26Implementation,
} from "./d26-phase-specific-real-provider-implementation-manifest.js";
import {
	admitD26D25Baseline,
	persistD26QualificationBundle,
	runD26InjectedNoNetworkQualification,
	validateD26QualificationBundle,
} from "./d26-phase-specific-real-provider-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d26",
);
const d25Artifact = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d25/current-graph-native-phase-specific-tool-no-network-2026-08-16-d25-v2/artifacts/bundle.v1.json",
);

await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
const measured = await measureD26Implementation(repositoryRoot);
if (measured !== D26_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D26 implementation manifest drifted before qualification");
const bundle = await runD26InjectedNoNetworkQualification({
	baseline: admitD26D25Baseline(new Uint8Array(await readFile(d25Artifact))),
	implementationManifestDigest: measured,
	repositoryRoot,
});
validateD26QualificationBundle(bundle);
const receipt = await persistD26QualificationBundle({
	bundle,
	privateRoot: await realpath(privateRoot),
});
if ((await measureD26Implementation(repositoryRoot)) !== D26_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D26 implementation manifest drifted after qualification");
process.stdout.write(
	`${JSON.stringify({
		decisionRef: bundle.qualification.decisionRef,
		bundleArtifactDigest: receipt.artifactDigests["bundle.v1.json"],
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
		implementationManifestDigest: measured,
		exactSixArmsCompleted: bundle.qualification.exactSixArmsCompleted,
		realWorkspaceLifecyclePassed: bundle.qualification.realWorkspaceLifecyclePassed,
		exactNamedFinalWirePassed: bundle.qualification.exactNamedFinalWirePassed,
		providerNetworkCalls: bundle.qualification.providerNetworkCalls,
		liveGateEvaluated: bundle.qualification.liveGateEvaluated,
		efficacyClaim: bundle.qualification.efficacyClaim,
	})}\n`,
);
