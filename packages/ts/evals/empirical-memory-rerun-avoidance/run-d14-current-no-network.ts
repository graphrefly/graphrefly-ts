import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { empiricalSha256, sameBytes } from "./canonical.js";
import {
	D14_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD14Implementation,
} from "./d14-current-implementation-manifest.js";
import {
	D14_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
	D14_D13_QUALIFICATION_ARTIFACT_DIGEST,
} from "./d14-current-live-coordinates.js";
import {
	admitD14D13QualificationBaseline,
	persistD14QualificationBundle,
	runD14InjectedNoNetworkQualification,
} from "./d14-current-pre-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateOperatorRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const privateRoot = join(privateOperatorRoot, "current-graph-native-d14");
const d13BundlePath = join(
	privateOperatorRoot,
	"current-graph-native-d13/current-graph-native-provider-deadline-no-network-2026-08-16-d13-v1/artifacts/bundle.v1.json",
);
const generationRoot = join(privateRoot, D14_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF);

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
			throw new TypeError("D14 no-network baseline identity is invalid");
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
				throw new TypeError("D14 no-network baseline changed while read");
		} finally {
			await second.close();
		}
		return bytes;
	} finally {
		await first.close();
	}
}

if (process.version !== "v24.18.0") throw new TypeError("D14 no-network Node toolchain drifted");
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
if ((await realpath(privateRoot)) !== privateRoot)
	throw new TypeError("D14 no-network private root is not canonical");
await lstat(generationRoot).then(
	() => {
		throw new TypeError("D14 no-network qualification generation already exists");
	},
	(error: unknown) => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	},
);
const before = await measureD14Implementation(repositoryRoot);
if (before !== D14_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D14 no-network implementation manifest drifted before qualification");
const d13Bytes = await exactPrivateBytes(d13BundlePath);
if (empiricalSha256(d13Bytes) !== D14_D13_QUALIFICATION_ARTIFACT_DIGEST)
	throw new TypeError("D14 no-network D13 artifact drifted");
const bundle = await runD14InjectedNoNetworkQualification({
	repositoryRoot,
	baseline: admitD14D13QualificationBaseline(d13Bytes),
	implementationManifestDigest: before,
});
const after = await measureD14Implementation(repositoryRoot);
if (after !== before) throw new TypeError("D14 implementation changed during qualification");
const receipt = await persistD14QualificationBundle({ privateRoot, bundle });
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
