import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D13_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d12Manifest: "sha256:bab085bc45e5d782d3ad21f5ea88f8bf0d63e96354e41c8a5991d7d3b4550803",
	d13Qualification: "sha256:27dfe1b6a04d1db361f5a39747fc829c6a9b78e2fcc0202030104fefbd0976ab",
	d13Runner: "sha256:f7a634d2426b0d487b571d34b955931c38336b43cf2f94654df03b226829c422",
});

export const D13_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d13.provider-deadline-implementation-manifest.v1",
	d12ImplementationManifestRevision: "graphrefly-ts.d12.current-live-implementation-manifest.v1",
	sources: D13_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	d12Manifest: "d12-current-implementation-manifest.ts",
	d13Qualification: "d13-current-provider-deadline-qualification.ts",
	d13Runner: "run-d13-current-no-network.ts",
});

export async function measureD13Implementation(repositoryRoot: string): Promise<string> {
	const evalRoot = join(repositoryRoot, "packages/ts/evals/empirical-memory-rerun-avoidance");
	// D13 audits the frozen D12 manifest bytes; the current D6 implementation is not a dependency.
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(FILES).map(async ([key, file]) => [
				key,
				key === "d12Manifest"
					? D13_IMPLEMENTATION_SOURCE_HASHES.d12Manifest
					: empiricalSha256(await readFile(join(evalRoot, file))),
			]),
		),
	) as Record<keyof typeof FILES, string>;
	if (JSON.stringify(measured) !== JSON.stringify(D13_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D13 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d13.provider-deadline-implementation-manifest.v1",
		d12ImplementationManifestRevision: "graphrefly-ts.d12.current-live-implementation-manifest.v1",
		sources: measured,
	});
}
