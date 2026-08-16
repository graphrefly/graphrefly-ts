import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import {
	D12_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD12Implementation,
} from "./d12-current-implementation-manifest.js";
import {
	D13_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD13Implementation,
} from "./d13-current-implementation-manifest.js";

export const D14_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d14Coordinates: "sha256:13799d000724f276c5dcdbabad2b62be75715d42e2c1da6f2f08915e0f7d8022",
	d14Claim: "sha256:012e4f336a5c1dbb3f67615deae7f310922e674084223d0c57f872588ac7647a",
	d14Live: "sha256:80555a9aa95602a4e085e439d5eb081e60f03e32cfb444cfb930322d86b0cf9a",
	d14Qualification: "sha256:935b30ea1dc5fa9a2ba5285b757966a9863c8cf20dec181e452135f33ebd3194",
	d14NoNetworkRunner: "sha256:425f564a562845f47235d5fd886b1f62ac9c8c9906aa3b4dd0d20a0959d3a73c",
	d14LiveRunner: "sha256:9bf7c60d5e24b9139d994cef52999bf2e3927b559f3c3072070741d8fba2e843",
});

export const D14_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d14.current-live-implementation-manifest.v1",
	d12ImplementationManifestDigest: D12_IMPLEMENTATION_MANIFEST_DIGEST,
	d13ImplementationManifestDigest: D13_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D14_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	d14Coordinates: "d14-current-live-coordinates.ts",
	d14Claim: "d14-current-live-claim.ts",
	d14Live: "d14-current-live.ts",
	d14Qualification: "d14-current-pre-live-qualification.ts",
	d14NoNetworkRunner: "run-d14-current-no-network.ts",
	d14LiveRunner: "run-d14-live.ts",
});

export async function measureD14Implementation(repositoryRoot: string): Promise<string> {
	if ((await measureD12Implementation(repositoryRoot)) !== D12_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D14 D12 implementation baseline drifted");
	if ((await measureD13Implementation(repositoryRoot)) !== D13_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D14 D13 implementation baseline drifted");
	const evalRoot = join(repositoryRoot, "packages/ts/evals/empirical-memory-rerun-avoidance");
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(FILES).map(async ([key, file]) => [
				key,
				empiricalSha256(await readFile(join(evalRoot, file))),
			]),
		),
	) as Record<keyof typeof FILES, string>;
	if (JSON.stringify(measured) !== JSON.stringify(D14_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D14 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d14.current-live-implementation-manifest.v1",
		d12ImplementationManifestDigest: D12_IMPLEMENTATION_MANIFEST_DIGEST,
		d13ImplementationManifestDigest: D13_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
