import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { empiricalSha256, sameBytes } from "./canonical.js";
import {
	CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentGraphLiveImplementation,
} from "./d8-current-implementation-manifest.js";
import { CURRENT_GRAPH_LIVE_PRIVATE_ROOT } from "./d8-current-live-claim.js";
import { CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST } from "./d8-current-live-coordinates.js";
import {
	CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
	persistCurrentGraphLiveQualification,
	runCurrentGraphLiveNoNetworkQualification,
} from "./d8-current-pre-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateOperatorRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const d5QualificationBundlePath = join(
	privateOperatorRoot,
	"d5-inspection-batch/d5-inspection-batch-no-network-qualification-2026-08-14-v3/artifacts/bundle.v1.json",
);
const generationRoot = join(
	CURRENT_GRAPH_LIVE_PRIVATE_ROOT,
	CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
);

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
			throw new TypeError("D8 no-network baseline identity is invalid");
		const first = new Uint8Array(await handle.readFile());
		const secondHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const secondStat = await secondHandle.stat();
			const second = new Uint8Array(await secondHandle.readFile());
			if (secondStat.dev !== stat.dev || secondStat.ino !== stat.ino || !sameBytes(first, second))
				throw new TypeError("D8 no-network baseline changed while read");
		} finally {
			await secondHandle.close();
		}
		return first;
	} finally {
		await handle.close();
	}
}

if (process.version !== "v24.18.0") throw new TypeError("D8 no-network Node toolchain drifted");
await lstat(generationRoot).then(
	() => {
		throw new TypeError("D8 no-network qualification generation already exists");
	},
	(error: unknown) => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	},
);
const measured = await measureCurrentGraphLiveImplementation(repositoryRoot);
if (measured !== CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D8 no-network implementation manifest drifted");
const d5QualificationBundleBytes = await boundedPrivateFile(d5QualificationBundlePath);
if (
	empiricalSha256(d5QualificationBundleBytes) !==
	CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST
)
	throw new TypeError("D8 no-network D5 qualification artifact drifted");
const bundle = await runCurrentGraphLiveNoNetworkQualification({
	repositoryRoot,
	d5QualificationBundleBytes,
	implementationManifestDigest: measured,
});
const injectedProviderAttempts = bundle.qualification.providerAttempts;
const receipt = await persistCurrentGraphLiveQualification({
	privateRoot: CURRENT_GRAPH_LIVE_PRIVATE_ROOT,
	bundle,
});
process.stdout.write(
	`${JSON.stringify({
		executionClass: "injected-no-network",
		realProviderCalls: 0,
		networkCalls: 0,
		injectedProviderAttempts,
		d5QualificationArtifactDigest: CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST,
		implementationManifestDigest: measured,
		receipt,
	})}\n`,
);
