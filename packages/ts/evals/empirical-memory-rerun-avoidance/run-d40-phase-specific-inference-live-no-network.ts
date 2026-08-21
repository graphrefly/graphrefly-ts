import { chmod, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { empiricalSha256 } from "./canonical.js";
import { admitD40D39Baseline } from "./d40-phase-specific-inference-live.js";
import { D40_PRIVATE_ROOT } from "./d40-phase-specific-inference-live-claim.js";
import {
	D40_D39_ARTIFACT_DIGEST,
	D40_QUALIFICATION_GENERATION_REF,
} from "./d40-phase-specific-inference-live-coordinates.js";
import {
	D40_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD40Implementation,
} from "./d40-phase-specific-inference-live-implementation-manifest.js";
import {
	persistD40Qualification,
	runD40InjectedNoNetworkQualification,
} from "./d40-phase-specific-inference-live-qualification.js";

if (process.env.OPENROUTER_API_KEY !== undefined)
	throw new TypeError("D40 no-network qualification refuses provider credentials");

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const d39Artifact = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d39/current-graph-native-premature-final-live-2026-08-20-d39-v2/artifacts/bundle.v1.json",
);

const measured = await measureD40Implementation(repositoryRoot);
if (measured !== D40_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D40 implementation manifest drifted before qualification");
const bytes = new Uint8Array(await readFile(d39Artifact));
if (empiricalSha256(bytes) !== D40_D39_ARTIFACT_DIGEST)
	throw new TypeError("D40 D39 baseline artifact drifted");
await mkdir(D40_PRIVATE_ROOT, { recursive: true, mode: 0o700 });
await chmod(D40_PRIVATE_ROOT, 0o700);
const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d40-no-network-"));
await chmod(materializationRoot, 0o700);
try {
	const bundle = await runD40InjectedNoNetworkQualification({
		baseline: admitD40D39Baseline(bytes),
		baselineBasis: "consumed-d39-artifact",
		repositoryRoot,
		materializationRoot,
	});
	if ((await measureD40Implementation(repositoryRoot)) !== measured)
		throw new TypeError("D40 implementation drifted during qualification");
	const persistence = await persistD40Qualification({
		privateRoot: await realpath(D40_PRIVATE_ROOT),
		bundle,
	});
	process.stdout.write(
		`${JSON.stringify({ decisionRef: bundle.qualification.decisionRef, generationRef: D40_QUALIFICATION_GENERATION_REF, bundleDigest: bundle.bundleDigest, qualificationDigest: bundle.qualification.qualificationDigest, generationDigest: bundle.generation.generationDigest, mainBundleDigest: bundle.mainBundle.bundleDigest, implementationManifestDigest: bundle.qualification.implementationManifestDigest, providerAttemptCount: bundle.qualification.providerAttemptCount, inspectionFactCount: bundle.qualification.inspectionFactCount, mutationFactCount: bundle.qualification.mutationFactCount, providerNetworkCalls: bundle.qualification.providerNetworkCalls, efficacyClaim: bundle.qualification.efficacyClaim, persistenceDigest: persistence.receiptDigest })}\n`,
	);
} finally {
	await rm(materializationRoot, { recursive: true, force: true });
}
