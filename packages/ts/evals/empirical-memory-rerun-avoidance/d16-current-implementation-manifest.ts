import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import {
	D15_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD15Implementation,
} from "./d15-current-implementation-manifest.js";

export const D16_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d16Coordinates: "sha256:d144df19765a489cd7568253e128fed50c69cb48ea2dffd17f601aa28eee8738",
	d16Claim: "sha256:5438605dd31b1ebf7e8845c58ca2e24bea59b10f00bb2d48b9bf158a485b1deb",
	d16Live: "sha256:1f023d8a287b8a9c0d823a4d5534b1e1df616c410fa640e61cf8391a7a4dd0ba",
	d16Qualification: "sha256:0056b3ae628266c0f70874975e978195c544963914e9a4814ec3038f7c647083",
	d16NoNetworkRunner: "sha256:09670a15fb68c932c615f5bc93a1c97f5ff6a3361b6f5da749efdffe3d414493",
	d16LiveRunner: "sha256:b8112241751a3348f0938e6e2ffce783527ef175b3b6e0761af7b52d6bc47c3c",
});

export const D16_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d16.current-live-implementation-manifest.v1",
	d15ImplementationManifestDigest: D15_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D16_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	d16Coordinates: "d16-current-live-coordinates.ts",
	d16Claim: "d16-current-live-claim.ts",
	d16Live: "d16-current-live.ts",
	d16Qualification: "d16-current-pre-live-qualification.ts",
	d16NoNetworkRunner: "run-d16-current-no-network.ts",
	d16LiveRunner: "run-d16-live.ts",
});

export async function measureD16Implementation(repositoryRoot: string): Promise<string> {
	if ((await measureD15Implementation(repositoryRoot)) !== D15_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D16 D15 implementation baseline drifted");
	const evalRoot = join(repositoryRoot, "packages/ts/evals/empirical-memory-rerun-avoidance");
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(FILES).map(async ([key, file]) => [
				key,
				empiricalSha256(await readFile(join(evalRoot, file))),
			]),
		),
	) as Record<keyof typeof FILES, string>;
	if (JSON.stringify(measured) !== JSON.stringify(D16_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D16 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d16.current-live-implementation-manifest.v1",
		d15ImplementationManifestDigest: D15_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
