import { chmod, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { empiricalSha256 } from "./canonical.js";
import { D38_PRIVATE_ROOT } from "./d38-premature-final-live-claim.js";
import {
	D38_D37_ARTIFACT_DIGEST,
	D38_QUALIFICATION_GENERATION_REF,
} from "./d38-premature-final-live-coordinates.js";
import {
	D38_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD38Implementation,
} from "./d38-premature-final-live-implementation-manifest.js";
import {
	admitD38QualificationBaseline,
	persistD38Qualification,
	runD38InjectedNoNetworkQualification,
} from "./d38-premature-final-live-qualification.js";

if (process.env.OPENROUTER_API_KEY !== undefined)
	throw new TypeError("D38 no-network qualification refuses provider credentials");

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const d37Artifact = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d37/current-graph-native-premature-final-no-network-2026-08-20-d37-v7/artifacts/bundle.v1.json",
);

const measured = await measureD38Implementation(repositoryRoot);
if (measured !== D38_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D38 implementation manifest drifted before qualification");
const bytes = new Uint8Array(await readFile(d37Artifact));
if (empiricalSha256(bytes) !== D38_D37_ARTIFACT_DIGEST)
	throw new TypeError("D38 D37 qualification artifact drifted");
await mkdir(D38_PRIVATE_ROOT, { recursive: true, mode: 0o700 });
await chmod(D38_PRIVATE_ROOT, 0o700);
const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d38-no-network-"));
await chmod(materializationRoot, 0o700);
try {
	const bundle = await runD38InjectedNoNetworkQualification({
		baseline: admitD38QualificationBaseline(bytes),
		baselineBasis: "consumed-d37-artifact",
		repositoryRoot,
		materializationRoot,
	});
	if ((await measureD38Implementation(repositoryRoot)) !== measured)
		throw new TypeError("D38 implementation drifted during qualification");
	const persistence = await persistD38Qualification({
		privateRoot: await realpath(D38_PRIVATE_ROOT),
		bundle,
	});
	process.stdout.write(
		`${JSON.stringify({ decisionRef: bundle.qualification.decisionRef, generationRef: D38_QUALIFICATION_GENERATION_REF, bundleDigest: bundle.bundleDigest, qualificationDigest: bundle.qualification.qualificationDigest, generationDigest: bundle.generation.generationDigest, mainBundleDigest: bundle.mainBundle.bundleDigest, implementationManifestDigest: bundle.qualification.implementationManifestDigest, providerTransportCalls: bundle.qualification.providerTransportCalls, retainedSpanTransportCalls: bundle.qualification.retainedSpanTransportCalls, providerNetworkCalls: bundle.qualification.providerNetworkCalls, efficacyClaim: bundle.qualification.efficacyClaim, persistenceDigest: persistence.receiptDigest })}\n`,
	);
} finally {
	await rm(materializationRoot, { recursive: true, force: true });
}
