import { chmod, mkdir, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
	D17_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD17Implementation,
} from "./d17-current-implementation-manifest.js";
import {
	admitD17D16Baseline,
	persistD17Qualification,
	runD17InjectedNoNetworkQualification,
	validateD17QualificationBundle,
} from "./d17-current-pre-live-qualification.js";

const repositoryRoot = await realpath(resolve(import.meta.dirname, "../../../.."));
const privateRoot = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/current-graph-native-d17",
);
const d16Artifact = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/current-graph-native-d16/current-graph-native-live-2026-08-16-d16-v1/artifacts/bundle.v1.json",
);

if ((await measureD17Implementation(repositoryRoot)) !== D17_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D17 measured implementation manifest drifted");
const baseline = admitD17D16Baseline(new Uint8Array(await readFile(d16Artifact)));
const constructedBundle = await runD17InjectedNoNetworkQualification({
	baseline,
	implementationManifestDigest: D17_IMPLEMENTATION_MANIFEST_DIGEST,
});
const bundle = validateD17QualificationBundle(constructedBundle);
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
const receipt = await persistD17Qualification({
	privateRoot: await realpath(privateRoot),
	bundle: constructedBundle,
});
process.stdout.write(
	`${JSON.stringify({
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
		implementationManifestDigest: D17_IMPLEMENTATION_MANIFEST_DIGEST,
		graphEvidenceDigest: bundle.graphEvidence.evidenceDigest,
		providerNetworkCalls: bundle.qualification.providerNetworkCalls,
		liveGateEvaluated: bundle.qualification.liveGateEvaluated,
		efficacyClaim: bundle.qualification.efficacyClaim,
		persistenceReceiptDigest: receipt.receiptDigest,
	})}\n`,
);
