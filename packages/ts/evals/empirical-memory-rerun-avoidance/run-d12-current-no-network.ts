import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { empiricalSha256, sameBytes } from "./canonical.js";
import {
	D12_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD12Implementation,
} from "./d12-current-implementation-manifest.js";
import {
	D12_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
	D12_D11_QUALIFICATION_ARTIFACT_DIGEST,
} from "./d12-current-live-coordinates.js";
import {
	admitD12D11QualificationBaseline,
	persistD12QualificationBundle,
	runD12InjectedNoNetworkQualification,
} from "./d12-current-pre-live-qualification.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateOperatorRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const privateRoot = join(privateOperatorRoot, "current-graph-native-d12");
const d11BundlePath = join(
	privateOperatorRoot,
	"current-graph-native-d11/current-graph-native-transport-failure-no-network-2026-08-15-d11-v1/artifacts/bundle.v1.json",
);
const generationRoot = join(privateRoot, D12_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF);

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
			throw new TypeError("D12 no-network baseline identity is invalid");
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
				throw new TypeError("D12 no-network baseline changed while read");
		} finally {
			await second.close();
		}
		return bytes;
	} finally {
		await first.close();
	}
}

if (process.version !== "v24.18.0") throw new TypeError("D12 no-network Node toolchain drifted");
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
await chmod(privateRoot, 0o700);
if ((await realpath(privateRoot)) !== privateRoot)
	throw new TypeError("D12 no-network private root is not canonical");
await lstat(generationRoot).then(
	() => {
		throw new TypeError("D12 no-network qualification generation already exists");
	},
	(error: unknown) => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	},
);
const before = await measureD12Implementation(repositoryRoot);
if (before !== D12_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D12 no-network implementation manifest drifted before qualification");
const d11Bytes = await exactPrivateBytes(d11BundlePath);
if (empiricalSha256(d11Bytes) !== D12_D11_QUALIFICATION_ARTIFACT_DIGEST)
	throw new TypeError("D12 no-network D11 artifact drifted");
const bundle = await runD12InjectedNoNetworkQualification({
	repositoryRoot,
	baseline: admitD12D11QualificationBaseline(d11Bytes),
	implementationManifestDigest: before,
});
const after = await measureD12Implementation(repositoryRoot);
if (after !== before) throw new TypeError("D12 implementation changed during qualification");
const receipt = await persistD12QualificationBundle({ privateRoot, bundle });
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
