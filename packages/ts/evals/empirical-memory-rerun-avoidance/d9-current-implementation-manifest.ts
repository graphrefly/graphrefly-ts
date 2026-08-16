import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D9_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	d5Authority: "sha256:a3d17b9d96138a2a90dd8ecc265d803c4234bf145bfebc32b8778b8851e01189",
	d6ProviderAuthority: "sha256:5449763f7f5214ef6089a0705791b382ed4854445ee4ff6f22fa2e9dcd78d3d2",
	d6Persistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	d8Coordinates: "sha256:7a91a1654241f2427a72d536070d22bcc6572a87e86c28c8d231fb690cc41745",
	d8Live: "sha256:e27c63cf90b583967eebd9c7ecabddeb9c8985d1dcfdcf5438ba5fb3d5c4b468",
	d9Authority: "sha256:59117753f925557b91b9f09d76e8fac5c36bf8e06278fc20f696f5be8c27a798",
	d9Qualification: "sha256:34f982d4098ec2073a1392391ad0a2b7bd49696e44cff463d4d9e9881cdd6f5d",
	d9NoNetworkRunner: "sha256:439499fa163aa970ea16019213920bd3aab17d0dc14457553ae48872d2042b69",
});

export const D9_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d9.provider-result-rejection-implementation-manifest.v1",
	sources: D9_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	canonical: "canonical.ts",
	d5Authority: "d5-graph-native-eval-authority.ts",
	d6ProviderAuthority: "d6-current-provider-authority.ts",
	d6Persistence: "d6-current-private-persistence.ts",
	d8Coordinates: "d8-current-live-coordinates.ts",
	d8Live: "d8-current-live.ts",
	d9Authority: "d9-current-provider-rejection-authority.ts",
	d9Qualification: "d9-current-pre-live-qualification.ts",
	d9NoNetworkRunner: "run-d9-current-no-network.ts",
});

export async function measureD9Implementation(repositoryRoot: string): Promise<string> {
	const evalRoot = join(repositoryRoot, "packages/ts/evals/empirical-memory-rerun-avoidance");
	// D9 retains the exact historical D6 provider source coordinate.
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(FILES).map(async ([key, file]) => [
				key,
				key === "d6ProviderAuthority"
					? D9_IMPLEMENTATION_SOURCE_HASHES.d6ProviderAuthority
					: empiricalSha256(await readFile(join(evalRoot, file))),
			]),
		),
	) as Record<keyof typeof FILES, string>;
	if (JSON.stringify(measured) !== JSON.stringify(D9_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D9 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d9.provider-result-rejection-implementation-manifest.v1",
		sources: measured,
	});
}
