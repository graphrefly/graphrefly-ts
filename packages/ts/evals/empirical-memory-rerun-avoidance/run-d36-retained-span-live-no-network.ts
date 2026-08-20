import { chmod, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { empiricalSha256 } from "./canonical.js";
import { D36_PRIVATE_ROOT } from "./d36-retained-span-live-claim.js";
import {
	D36_D35_ARTIFACT_DIGEST,
	D36_QUALIFICATION_GENERATION_REF,
} from "./d36-retained-span-live-coordinates.js";
import {
	D36_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD36Implementation,
} from "./d36-retained-span-live-implementation-manifest.js";
import {
	admitD36QualificationBaseline,
	persistD36Qualification,
	runD36InjectedNoNetworkQualification,
} from "./d36-retained-span-live-qualification.js";

if (process.env.OPENROUTER_API_KEY !== undefined)
	throw new TypeError("D36 no-network qualification refuses provider credentials");

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const d35Artifact = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d35/current-graph-native-retained-span-real-provider-no-network-2026-08-20-d35-v1/artifacts/bundle.v1.json",
);

const measured = await measureD36Implementation(repositoryRoot);
if (measured !== D36_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D36 implementation manifest drifted before qualification");
const bytes = new Uint8Array(await readFile(d35Artifact));
if (empiricalSha256(bytes) !== D36_D35_ARTIFACT_DIGEST)
	throw new TypeError("D36 D35 qualification artifact drifted");
await mkdir(D36_PRIVATE_ROOT, { recursive: true, mode: 0o700 });
await chmod(D36_PRIVATE_ROOT, 0o700);
const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d36-no-network-"));
await chmod(materializationRoot, 0o700);
try {
	const bundle = await runD36InjectedNoNetworkQualification({
		baseline: admitD36QualificationBaseline(bytes),
		baselineBasis: "consumed-d35-artifact",
		repositoryRoot,
		materializationRoot,
	});
	if ((await measureD36Implementation(repositoryRoot)) !== measured)
		throw new TypeError("D36 implementation drifted during qualification");
	const persistence = await persistD36Qualification({
		privateRoot: await realpath(D36_PRIVATE_ROOT),
		bundle,
	});
	process.stdout.write(
		`${JSON.stringify({ decisionRef: bundle.qualification.decisionRef, generationRef: D36_QUALIFICATION_GENERATION_REF, bundleDigest: bundle.bundleDigest, qualificationDigest: bundle.qualification.qualificationDigest, generationDigest: bundle.generation.generationDigest, mainBundleDigest: bundle.mainBundle.bundleDigest, implementationManifestDigest: bundle.qualification.implementationManifestDigest, providerTransportCalls: bundle.qualification.providerTransportCalls, retainedSpanTransportCalls: bundle.qualification.retainedSpanTransportCalls, providerNetworkCalls: bundle.qualification.providerNetworkCalls, efficacyClaim: bundle.qualification.efficacyClaim, persistenceDigest: persistence.receiptDigest })}\n`,
	);
} finally {
	await rm(materializationRoot, { recursive: true, force: true });
}
