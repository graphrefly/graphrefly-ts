import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { empiricalSha256, sameBytes } from "./canonical.js";
import {
	D16_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD16Implementation,
} from "./d16-current-implementation-manifest.js";
import {
	D16_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
	D16_D15_QUALIFICATION_ARTIFACT_DIGEST,
} from "./d16-current-live-coordinates.js";
import {
	admitD16D15QualificationBaseline,
	persistD16QualificationBundle,
	runD16InjectedNoNetworkQualification,
} from "./d16-current-pre-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateOperatorRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const privateRoot = join(privateOperatorRoot, "current-graph-native-d16");
const d15BundlePath = join(
	privateOperatorRoot,
	"current-graph-native-d15/current-graph-native-live-no-network-qualification-2026-08-16-d15-v4/artifacts/bundle.v1.json",
);
const generationRoot = join(privateRoot, D16_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF);

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
			throw new TypeError("D16 no-network baseline identity is invalid");
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
				throw new TypeError("D16 no-network baseline changed while read");
		} finally {
			await second.close();
		}
		return bytes;
	} finally {
		await first.close();
	}
}

if (process.version !== "v24.18.0") throw new TypeError("D16 no-network Node toolchain drifted");
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
if ((await realpath(privateRoot)) !== privateRoot)
	throw new TypeError("D16 no-network private root is not canonical");
await lstat(generationRoot).then(
	() => {
		throw new TypeError("D16 no-network qualification generation already exists");
	},
	(error: unknown) => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	},
);
const before = await measureD16Implementation(repositoryRoot);
if (before !== D16_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D16 no-network implementation manifest drifted before qualification");
const d15Bytes = await exactPrivateBytes(d15BundlePath);
if (empiricalSha256(d15Bytes) !== D16_D15_QUALIFICATION_ARTIFACT_DIGEST)
	throw new TypeError("D16 no-network D15 artifact drifted");
const bundle = await runD16InjectedNoNetworkQualification({
	repositoryRoot,
	baseline: admitD16D15QualificationBaseline(d15Bytes),
	implementationManifestDigest: before,
});
const after = await measureD16Implementation(repositoryRoot);
if (after !== before) throw new TypeError("D16 implementation changed during qualification");
const receipt = await persistD16QualificationBundle({ privateRoot, bundle });
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
