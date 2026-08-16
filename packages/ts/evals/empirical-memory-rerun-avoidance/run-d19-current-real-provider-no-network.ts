import { constants } from "node:fs";
import { chmod, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { empiricalSha256, sameBytes } from "./canonical.js";
import {
	D19_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD19Implementation,
} from "./d19-current-real-provider-implementation-manifest.js";
import {
	admitD19D18Baseline,
	D19_D18_BASELINE_ARTIFACT_DIGEST,
	persistD19Qualification,
	runD19InjectedNoNetworkQualification,
	validateD19QualificationBundle,
} from "./d19-current-real-provider-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const operatorRoot = resolve(import.meta.dirname, "../.private/empirical-memory-rerun-avoidance");
const privateRoot = join(operatorRoot, "current-graph-native-d19");
const d18BundlePath = join(
	operatorRoot,
	"current-graph-native-d18",
	"current-graph-native-provider-composition-no-network-2026-08-16-d18-v1",
	"artifacts",
	"bundle.v1.json",
);

async function readExactPrivateArtifact(path: string, expectedDigest: string): Promise<Uint8Array> {
	const firstHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const firstStat = await firstHandle.stat();
		if (
			!firstStat.isFile() ||
			firstStat.nlink !== 1 ||
			(firstStat.mode & 0o777) !== 0o600 ||
			firstStat.size < 1 ||
			firstStat.size > 4_194_304 ||
			(await realpath(path)) !== path
		)
			throw new TypeError("D19 baseline private artifact identity is invalid");
		const first = new Uint8Array(await firstHandle.readFile());
		const secondHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const secondStat = await secondHandle.stat();
			const second = new Uint8Array(await secondHandle.readFile());
			if (
				secondStat.dev !== firstStat.dev ||
				secondStat.ino !== firstStat.ino ||
				!sameBytes(first, second)
			)
				throw new TypeError("D19 baseline private artifact changed while read");
		} finally {
			await secondHandle.close();
		}
		if (empiricalSha256(first) !== expectedDigest)
			throw new TypeError("D19 baseline private artifact digest drifted");
		return first;
	} finally {
		await firstHandle.close();
	}
}

await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
if ((await realpath(privateRoot)) !== privateRoot)
	throw new TypeError("D19 private root is not canonical");
const manifestDigest = await measureD19Implementation(repositoryRoot);
if (manifestDigest !== D19_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D19 implementation manifest drifted");
const baselineBytes = await readExactPrivateArtifact(
	d18BundlePath,
	D19_D18_BASELINE_ARTIFACT_DIGEST,
);
const baseline = admitD19D18Baseline(baselineBytes);
const bundle = await runD19InjectedNoNetworkQualification({
	baseline,
	implementationManifestDigest: manifestDigest,
	repositoryRoot,
});
const validated = validateD19QualificationBundle(bundle);
const receipt = await persistD19Qualification({ privateRoot, bundle });
process.stdout.write(
	`${JSON.stringify(
		{
			bundleDigest: validated.bundleDigest,
			qualificationDigest: validated.qualification.qualificationDigest,
			generationDigest: validated.generation.generationDigest,
			implementationManifestDigest: manifestDigest,
			graphEvidenceDigest: validated.graphEvidence.evidenceDigest,
			externalNetworkCalls: validated.qualification.externalNetworkCalls,
			injectedTransportCalls: validated.qualification.injectedTransportCalls,
			maxActiveEffects: validated.qualification.maxActiveEffects,
			workspaceResidueCount: validated.qualification.workspaceResidueCount,
			liveGateEvaluated: validated.qualification.liveGateEvaluated,
			efficacyClaim: validated.qualification.efficacyClaim,
			receiptDigest: receipt.receiptDigest,
		},
		null,
		2,
	)}\n`,
);
