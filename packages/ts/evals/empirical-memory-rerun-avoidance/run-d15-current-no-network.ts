import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { empiricalSha256, sameBytes } from "./canonical.js";
import {
	D15_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD15Implementation,
} from "./d15-current-implementation-manifest.js";
import {
	D15_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
	D15_D6_QUALIFICATION_ARTIFACT_DIGEST,
} from "./d15-current-live-coordinates.js";
import {
	admitD15D6QualificationBaseline,
	persistD15QualificationBundle,
	runD15InjectedNoNetworkQualification,
} from "./d15-current-pre-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateOperatorRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const privateRoot = join(privateOperatorRoot, "current-graph-native-d15");
const d6BundlePath = join(
	privateOperatorRoot,
	"current-graph-native-d6/current-graph-native-live-no-network-qualification-2026-08-16-d6-v4/artifacts/bundle.v1.json",
);
const generationRoot = join(privateRoot, D15_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF);

async function exactPrivateBytes(path: string): Promise<Uint8Array> {
	const first = await open(path, "r");
	try {
		const stat = await first.stat();
		if (
			!stat.isFile() ||
			stat.nlink !== 1 ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.size > 4_194_304
		)
			throw new TypeError("D15 no-network baseline identity is invalid");
		const bytes = new Uint8Array(await first.readFile());
		const second = await open(path, "r");
		try {
			const secondStat = await second.stat();
			const secondBytes = new Uint8Array(await second.readFile());
			if (
				secondStat.dev !== stat.dev ||
				secondStat.ino !== stat.ino ||
				!sameBytes(bytes, secondBytes)
			)
				throw new TypeError("D15 no-network baseline changed while read");
		} finally {
			await second.close();
		}
		return bytes;
	} finally {
		await first.close();
	}
}

if (process.version !== "v24.18.0") throw new TypeError("D15 no-network Node toolchain drifted");
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
if ((await realpath(privateRoot)) !== privateRoot)
	throw new TypeError("D15 no-network private root is not canonical");
await lstat(generationRoot).then(
	() => {
		throw new TypeError("D15 no-network qualification generation already exists");
	},
	(error: unknown) => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	},
);
const before = await measureD15Implementation(repositoryRoot);
if (before !== D15_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D15 no-network implementation manifest drifted before qualification");
const d6Bytes = await exactPrivateBytes(d6BundlePath);
if (empiricalSha256(d6Bytes) !== D15_D6_QUALIFICATION_ARTIFACT_DIGEST)
	throw new TypeError("D15 no-network D6 artifact drifted");
const bundle = await runD15InjectedNoNetworkQualification({
	repositoryRoot,
	baseline: admitD15D6QualificationBaseline(d6Bytes),
	implementationManifestDigest: before,
});
const after = await measureD15Implementation(repositoryRoot);
if (after !== before) throw new TypeError("D15 implementation changed during qualification");
const receipt = await persistD15QualificationBundle({ privateRoot, bundle });
process.stdout.write(
	`${JSON.stringify({
		disposition: "qualified-no-network",
		credentialReads: 0,
		claimCalls: 0,
		providerCalls: 0,
		networkCalls: 0,
		implementationManifestDigest: before,
		qualificationDigest: bundle.qualification.qualificationDigest,
		bundleDigest: bundle.bundleDigest,
		generationDigest: bundle.generation.generationDigest,
		receipt,
	})}\n`,
);
