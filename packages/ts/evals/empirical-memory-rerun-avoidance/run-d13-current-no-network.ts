import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { empiricalSha256, sameBytes } from "./canonical.js";
import {
	D12_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD12Implementation,
} from "./d12-current-implementation-manifest.js";
import {
	D13_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD13Implementation,
} from "./d13-current-implementation-manifest.js";
import {
	admitD13D12Baseline,
	D13_D12_BASELINE_ARTIFACT_DIGEST,
	D13_QUALIFICATION_GENERATION_REF,
	persistD13QualificationBundle,
	runD13InjectedNoNetworkQualification,
} from "./d13-current-provider-deadline-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateOperatorRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const privateRoot = join(privateOperatorRoot, "current-graph-native-d13");
const d12BundlePath = join(
	privateOperatorRoot,
	"current-graph-native-d12/current-graph-native-live-2026-08-15-d12-v1/artifacts/bundle.v1.json",
);
const generationRoot = join(privateRoot, D13_QUALIFICATION_GENERATION_REF);

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
			throw new TypeError("D13 D12 baseline identity is invalid");
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
				throw new TypeError("D13 D12 baseline changed while read");
		} finally {
			await second.close();
		}
		return bytes;
	} finally {
		await first.close();
	}
}

if (process.version !== "v24.18.0") throw new TypeError("D13 Node toolchain drifted");
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
if ((await realpath(privateRoot)) !== privateRoot)
	throw new TypeError("D13 private root is not canonical");
await lstat(generationRoot).then(
	() => {
		throw new TypeError("D13 qualification generation already exists");
	},
	(error: unknown) => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	},
);
const d12Manifest = await measureD12Implementation(repositoryRoot);
if (d12Manifest !== D12_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D13 D12 implementation baseline drifted");
const before = await measureD13Implementation(repositoryRoot);
if (before !== D13_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D13 implementation manifest drifted before qualification");
const d12Bytes = await exactPrivateBytes(d12BundlePath);
if (empiricalSha256(d12Bytes) !== D13_D12_BASELINE_ARTIFACT_DIGEST)
	throw new TypeError("D13 D12 artifact drifted");
const bundle = await runD13InjectedNoNetworkQualification({
	repositoryRoot,
	baseline: admitD13D12Baseline(d12Bytes),
	implementationManifestDigest: before,
});
const after = await measureD13Implementation(repositoryRoot);
if (after !== before) throw new TypeError("D13 implementation changed during qualification");
const receipt = await persistD13QualificationBundle({ privateRoot, bundle });
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
