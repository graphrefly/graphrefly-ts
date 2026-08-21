import { chmod, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { empiricalSha256 } from "./canonical.js";
import { admitD42D41Baseline } from "./d42-phase-specific-inference-live.js";
import { D42_PRIVATE_ROOT } from "./d42-phase-specific-inference-live-claim.js";
import {
	D42_D41_ARTIFACT_DIGEST,
	D42_QUALIFICATION_GENERATION_REF,
} from "./d42-phase-specific-inference-live-coordinates.js";
import {
	D42_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD42Implementation,
} from "./d42-phase-specific-inference-live-implementation-manifest.js";
import {
	persistD42Qualification,
	runD42InjectedNoNetworkQualification,
} from "./d42-phase-specific-inference-live-qualification.js";

if (process.env.OPENROUTER_API_KEY !== undefined)
	throw new TypeError("D42 no-network qualification refuses provider credentials");

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const d41Artifact = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d41/current-graph-native-phase-specific-inference-no-network-2026-08-20-d41-v1/artifacts/bundle.v1.json",
);

const measured = await measureD42Implementation(repositoryRoot);
if (measured !== D42_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D42 implementation manifest drifted before qualification");
const bytes = new Uint8Array(await readFile(d41Artifact));
if (empiricalSha256(bytes) !== D42_D41_ARTIFACT_DIGEST)
	throw new TypeError("D42 D41 baseline artifact drifted");
await mkdir(D42_PRIVATE_ROOT, { recursive: true, mode: 0o700 });
await chmod(D42_PRIVATE_ROOT, 0o700);
const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d42-no-network-"));
await chmod(materializationRoot, 0o700);
try {
	const bundle = await runD42InjectedNoNetworkQualification({
		baseline: admitD42D41Baseline(bytes),
		baselineBasis: "consumed-d41-artifact",
		repositoryRoot,
		materializationRoot,
	});
	if ((await measureD42Implementation(repositoryRoot)) !== measured)
		throw new TypeError("D42 implementation drifted during qualification");
	const persistence = await persistD42Qualification({
		privateRoot: await realpath(D42_PRIVATE_ROOT),
		bundle,
	});
	process.stdout.write(
		`${JSON.stringify({ decisionRef: bundle.qualification.decisionRef, generationRef: D42_QUALIFICATION_GENERATION_REF, bundleDigest: bundle.bundleDigest, qualificationDigest: bundle.qualification.qualificationDigest, generationDigest: bundle.generation.generationDigest, mainBundleDigest: bundle.mainBundle.bundleDigest, implementationManifestDigest: bundle.qualification.implementationManifestDigest, providerAttemptCount: bundle.qualification.providerAttemptCount, inspectionFactCount: bundle.qualification.inspectionFactCount, mutationFactCount: bundle.qualification.mutationFactCount, providerNetworkCalls: bundle.qualification.providerNetworkCalls, efficacyClaim: bundle.qualification.efficacyClaim, persistenceDigest: persistence.receiptDigest })}\n`,
	);
} finally {
	await rm(materializationRoot, { recursive: true, force: true });
}
