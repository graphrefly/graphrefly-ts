import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { empiricalSha256, sameBytes } from "./canonical.js";
import {
	D10_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD10Implementation,
} from "./d10-current-implementation-manifest.js";
import { D10_D9_QUALIFICATION_ARTIFACT_DIGEST } from "./d10-current-live-coordinates.js";
import {
	admitD10D9QualificationBaseline,
	D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
	persistD10CurrentGraphLiveQualification,
	runD10CurrentGraphLiveNoNetworkQualification,
} from "./d10-current-pre-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateOperatorRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const d9BundlePath = join(
	privateOperatorRoot,
	"current-graph-native-d9/current-graph-native-provider-rejection-no-network-2026-08-15-d9-v1/artifacts/bundle.v1.json",
);
const d10PrivateRoot = join(privateOperatorRoot, "current-graph-native-d10");
const generationRoot = join(d10PrivateRoot, D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF);

async function boundedPrivateFile(path: string): Promise<Uint8Array> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			stat.nlink !== 1 ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.size < 1 ||
			stat.size > 4_194_304 ||
			(await realpath(path)) !== path
		)
			throw new TypeError("D10 no-network D9 baseline identity is invalid");
		const first = new Uint8Array(await handle.readFile());
		const secondHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const secondStat = await secondHandle.stat();
			const second = new Uint8Array(await secondHandle.readFile());
			if (secondStat.dev !== stat.dev || secondStat.ino !== stat.ino || !sameBytes(first, second))
				throw new TypeError("D10 no-network D9 baseline changed while read");
		} finally {
			await secondHandle.close();
		}
		return first;
	} finally {
		await handle.close();
	}
}

if (process.version !== "v24.18.0") throw new TypeError("D10 no-network Node toolchain drifted");
await mkdir(d10PrivateRoot, { recursive: true, mode: 0o700 });
await chmod(d10PrivateRoot, 0o700);
if ((await realpath(d10PrivateRoot)) !== d10PrivateRoot)
	throw new TypeError("D10 no-network private root is not canonical");
await lstat(generationRoot).then(
	() => {
		throw new TypeError("D10 no-network qualification generation already exists");
	},
	(error: unknown) => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	},
);
const before = await measureD10Implementation(repositoryRoot);
if (before !== D10_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D10 no-network implementation manifest drifted before qualification");
const d9Bytes = await boundedPrivateFile(d9BundlePath);
if (empiricalSha256(d9Bytes) !== D10_D9_QUALIFICATION_ARTIFACT_DIGEST)
	throw new TypeError("D10 no-network D9 artifact drifted");
const bundle = await runD10CurrentGraphLiveNoNetworkQualification({
	repositoryRoot,
	baseline: admitD10D9QualificationBaseline(d9Bytes),
	implementationManifestDigest: before,
});
const after = await measureD10Implementation(repositoryRoot);
if (after !== before) throw new TypeError("D10 implementation changed during qualification");
const receipt = await persistD10CurrentGraphLiveQualification({
	privateRoot: d10PrivateRoot,
	bundle,
});
process.stdout.write(
	`${JSON.stringify({
		executionClass: "injected-no-network",
		credentialReads: 0,
		claimCalls: 0,
		providerCalls: 0,
		networkCalls: 0,
		implementationManifestDigest: before,
		d9QualificationArtifactDigest: empiricalSha256(d9Bytes),
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
		rejectionCount: bundle.graphBundle.graphEvidence?.rejectionCount,
		receipt,
	})}\n`,
);
