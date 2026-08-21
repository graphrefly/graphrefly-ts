import { chmod, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { empiricalSha256 } from "./canonical.js";
import {
	D41_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD41Implementation,
} from "./d41-phase-specific-inference-implementation-manifest.js";
import {
	admitD41D40Baseline,
	D41_D40_ARTIFACT_DIGEST,
	D41_QUALIFICATION_GENERATION_REF,
	persistD41Qualification,
	runD41InjectedNoNetworkQualification,
} from "./d41-phase-specific-inference-qualification.js";

if (process.env.OPENROUTER_API_KEY !== undefined)
	throw new TypeError("D41 no-network qualification refuses provider credentials");

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d41",
);
const d40Artifact = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d40/current-graph-native-phase-specific-inference-live-2026-08-20-d40-v1/artifacts/bundle.v1.json",
);

const measured = await measureD41Implementation(repositoryRoot);
if (measured !== D41_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D41 implementation manifest drifted before qualification");
const bytes = new Uint8Array(await readFile(d40Artifact));
if (empiricalSha256(bytes) !== D41_D40_ARTIFACT_DIGEST)
	throw new TypeError("D41 D40 baseline artifact drifted");
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d41-no-network-"));
await chmod(materializationRoot, 0o700);
try {
	const bundle = await runD41InjectedNoNetworkQualification({
		baseline: admitD41D40Baseline(bytes),
		baselineBasis: "consumed-d40-artifact",
		repositoryRoot,
		materializationRoot,
	});
	if ((await measureD41Implementation(repositoryRoot)) !== measured)
		throw new TypeError("D41 implementation drifted during qualification");
	const persistence = await persistD41Qualification({
		privateRoot: await realpath(privateRoot),
		bundle,
	});
	process.stdout.write(
		`${JSON.stringify({ decisionRef: bundle.qualification.decisionRef, generationRef: D41_QUALIFICATION_GENERATION_REF, bundleDigest: bundle.bundleDigest, qualificationDigest: bundle.qualification.qualificationDigest, generationDigest: bundle.generation.generationDigest, implementationManifestDigest: bundle.qualification.implementationManifestDigest, mainEvidenceDigest: bundle.mainEvidence.evidenceDigest, schemaRejectionEvidenceDigest: bundle.schemaRejectionEvidence.evidenceDigest, mainProviderAttemptCount: bundle.qualification.mainProviderAttemptCount, schemaProviderAttemptCount: bundle.qualification.schemaProviderAttemptCount, providerNetworkCalls: bundle.qualification.providerNetworkCalls, efficacyClaim: bundle.qualification.efficacyClaim, persistenceDigest: persistence.receiptDigest })}\n`,
	);
} finally {
	await rm(materializationRoot, { recursive: true, force: true });
}
