import { chmod, lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { empiricalSha256 } from "./canonical.js";
import { D27_PRIVATE_ROOT } from "./d27-phase-specific-live-claim.js";
import { D27_D26_ARTIFACT_DIGEST } from "./d27-phase-specific-live-coordinates.js";
import {
	D27_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD27Implementation,
} from "./d27-phase-specific-live-implementation-manifest.js";
import {
	admitD27QualificationBaseline,
	persistD27Qualification,
	runD27InjectedNoNetworkQualification,
} from "./d27-phase-specific-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateEvidenceRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const d26ArtifactFile = join(
	privateEvidenceRoot,
	"current-graph-native-d26/current-graph-native-phase-specific-real-provider-no-network-2026-08-17-d26-v2/artifacts/bundle.v1.json",
);

const stat = await lstat(d26ArtifactFile);
if (
	!stat.isFile() ||
	stat.isSymbolicLink() ||
	(stat.mode & 0o777) !== 0o600 ||
	stat.nlink !== 1 ||
	stat.size < 1 ||
	stat.size > 8_388_608
)
	throw new TypeError("D27 D26 qualification artifact ownership drifted");
const d26Bytes = new Uint8Array(await readFile(d26ArtifactFile));
if (empiricalSha256(d26Bytes) !== D27_D26_ARTIFACT_DIGEST)
	throw new TypeError("D27 D26 artifact drifted");
if ((await measureD27Implementation(repositoryRoot)) !== D27_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D27 implementation manifest drifted");
await mkdir(D27_PRIVATE_ROOT, { recursive: true, mode: 0o700 });
await chmod(D27_PRIVATE_ROOT, 0o700);
const bundle = await runD27InjectedNoNetworkQualification({
	repositoryRoot,
	baseline: admitD27QualificationBaseline(d26Bytes),
	baselineBasis: "consumed-d26-artifact",
});
const receipt = await persistD27Qualification({
	privateRoot: await realpath(D27_PRIVATE_ROOT),
	bundle,
});
process.stdout.write(
	`${JSON.stringify({ decisionRef: bundle.qualification.decisionRef, bundleDigest: bundle.bundleDigest, qualificationDigest: bundle.qualification.qualificationDigest, generationDigest: bundle.generation.generationDigest, implementationManifestDigest: bundle.qualification.implementationManifestDigest, providerTransportCalls: bundle.qualification.providerTransportCalls, providerNetworkCalls: bundle.qualification.providerNetworkCalls, efficacyClaim: bundle.qualification.efficacyClaim, persistenceDigest: receipt.receiptDigest })}\n`,
);
