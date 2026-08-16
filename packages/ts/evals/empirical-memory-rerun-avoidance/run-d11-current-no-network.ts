import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { empiricalSha256, sameBytes } from "./canonical.js";
import {
	D11_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD11Implementation,
} from "./d11-current-implementation-manifest.js";
import {
	admitD11D10FailureBaseline,
	D11_GENERATION_REF,
	persistD11QualificationBundle,
	runD11InjectedNoNetworkQualification,
} from "./d11-current-pre-live-qualification.js";
import { D11_D10_FAILURE_BASELINE } from "./d11-current-transport-failure-authority.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateOperatorRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const d10BundlePath = join(
	privateOperatorRoot,
	"current-graph-native-d10/current-graph-native-live-2026-08-15-d10-v1/artifacts/bundle.v1.json",
);
const d11PrivateRoot = join(privateOperatorRoot, "current-graph-native-d11");
const generationRoot = join(d11PrivateRoot, D11_GENERATION_REF);

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
			throw new TypeError("D11 no-network D10 baseline identity is invalid");
		const first = new Uint8Array(await handle.readFile());
		const secondHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const secondStat = await secondHandle.stat();
			const second = new Uint8Array(await secondHandle.readFile());
			if (secondStat.dev !== stat.dev || secondStat.ino !== stat.ino || !sameBytes(first, second))
				throw new TypeError("D11 no-network D10 baseline changed while read");
		} finally {
			await secondHandle.close();
		}
		return first;
	} finally {
		await handle.close();
	}
}

if (process.version !== "v24.18.0") throw new TypeError("D11 no-network Node toolchain drifted");
await mkdir(d11PrivateRoot, { recursive: true, mode: 0o700 });
await chmod(d11PrivateRoot, 0o700);
if ((await realpath(d11PrivateRoot)) !== d11PrivateRoot)
	throw new TypeError("D11 no-network private root is not canonical");
await lstat(generationRoot).then(
	() => {
		throw new TypeError("D11 no-network qualification generation already exists");
	},
	(error: unknown) => {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	},
);
const before = await measureD11Implementation(repositoryRoot);
if (before !== D11_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D11 no-network implementation manifest drifted before qualification");
const d10Bytes = await boundedPrivateFile(d10BundlePath);
if (empiricalSha256(d10Bytes) !== D11_D10_FAILURE_BASELINE.bundleArtifactDigest)
	throw new TypeError("D11 no-network D10 bundle artifact drifted");
const bundle = await runD11InjectedNoNetworkQualification({
	baseline: admitD11D10FailureBaseline(d10Bytes),
	implementationManifestDigest: before,
});
const after = await measureD11Implementation(repositoryRoot);
if (after !== before)
	throw new TypeError("D11 no-network implementation changed during qualification");
const receipt = await persistD11QualificationBundle({ privateRoot: d11PrivateRoot, bundle });
process.stdout.write(
	`${JSON.stringify({
		executionClass: "injected-no-network",
		credentialReads: 0,
		claimCalls: 0,
		providerCalls: 0,
		networkCalls: 0,
		implementationManifestDigest: before,
		d10BundleArtifactDigest: D11_D10_FAILURE_BASELINE.bundleArtifactDigest,
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
		receipt,
	})}\n`,
);
