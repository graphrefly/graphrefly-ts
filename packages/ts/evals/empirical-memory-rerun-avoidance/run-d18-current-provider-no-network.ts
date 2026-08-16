import { chmod, mkdir, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
	D18_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD18Implementation,
} from "./d18-current-provider-composition-implementation-manifest.js";
import {
	admitD18D17Baseline,
	persistD18Qualification,
	runD18InjectedNoNetworkQualification,
	validateD18QualificationBundle,
} from "./d18-current-provider-composition-qualification.js";

const repositoryRoot = await realpath(resolve(import.meta.dirname, "../../../.."));
const privateRoot = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/current-graph-native-d18",
);
const d17Artifact = resolve(
	repositoryRoot,
	"packages/ts/evals/.private/empirical-memory-rerun-avoidance/current-graph-native-d17/current-graph-native-efficacy-no-network-qualification-2026-08-16-d17-v1/artifacts/bundle.v1.json",
);

if ((await measureD18Implementation(repositoryRoot)) !== D18_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D18 measured implementation manifest drifted");
const baseline = admitD18D17Baseline(new Uint8Array(await readFile(d17Artifact)));
const constructed = await runD18InjectedNoNetworkQualification({
	baseline,
	implementationManifestDigest: D18_IMPLEMENTATION_MANIFEST_DIGEST,
});
const bundle = validateD18QualificationBundle(constructed);
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
const receipt = await persistD18Qualification({
	privateRoot: await realpath(privateRoot),
	bundle: constructed,
});
process.stdout.write(
	`${JSON.stringify({
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
		implementationManifestDigest: D18_IMPLEMENTATION_MANIFEST_DIGEST,
		graphEvidenceDigest: bundle.graphEvidence.evidenceDigest,
		providerNetworkCalls: bundle.qualification.providerNetworkCalls,
		providerAttempts: bundle.graphEvidence.budget.providerAttempts,
		retryWaits: bundle.graphEvidence.budget.retryWaits,
		maxActiveEffects: bundle.qualification.maxActiveEffects,
		liveGateEvaluated: bundle.qualification.liveGateEvaluated,
		efficacyClaim: bundle.qualification.efficacyClaim,
		persistenceReceiptDigest: receipt.receiptDigest,
	})}\n`,
);
