import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D11_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	d5Authority: "sha256:a3d17b9d96138a2a90dd8ecc265d803c4234bf145bfebc32b8778b8851e01189",
	d6ProviderAuthority: "sha256:5449763f7f5214ef6089a0705791b382ed4854445ee4ff6f22fa2e9dcd78d3d2",
	d6Persistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	d8Coordinates: "sha256:7a91a1654241f2427a72d536070d22bcc6572a87e86c28c8d231fb690cc41745",
	d9Authority: "sha256:59117753f925557b91b9f09d76e8fac5c36bf8e06278fc20f696f5be8c27a798",
	d10Live: "sha256:27348c9e9008573eeed5f6e81c79689a596312b556f708d3942b4d98e4b8df11",
	d11Contract: "sha256:7e633c9bf3228a0fd66532a37ee21e7717d17c38b66c589172cc3475daa80666",
	d11Boundary: "sha256:b7d88ed81b2ef33931efbbdc9b6716870eb5ab0fe0c76da307cb7ec703c245a9",
	d11Authority: "sha256:d59462625ea45c717d58243770a9b457378180a50d32e6067a131341b21b52c8",
	d11Qualification: "sha256:529f7984545dadbbd401d5b65bae6fb6ad3f87ff65fcc0b176893be5aacf621b",
	d11Runner: "sha256:578c639c9db6cfae2478830b61281633ff8e9853ff91af0845d4faa47732a5a5",
});

export const D11_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d11.transport-failure-implementation-manifest.v1",
	sources: D11_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	canonical: "canonical.ts",
	d5Authority: "d5-graph-native-eval-authority.ts",
	d6ProviderAuthority: "d6-current-provider-authority.ts",
	d6Persistence: "d6-current-private-persistence.ts",
	d8Coordinates: "d8-current-live-coordinates.ts",
	d9Authority: "d9-current-provider-rejection-authority.ts",
	d10Live: "d10-current-live.ts",
	d11Contract: "d11-current-transport-contract.ts",
	d11Boundary: "d11-current-transport-boundary.ts",
	d11Authority: "d11-current-transport-failure-authority.ts",
	d11Qualification: "d11-current-pre-live-qualification.ts",
	d11Runner: "run-d11-current-no-network.ts",
});

export async function measureD11Implementation(repositoryRoot: string): Promise<string> {
	const evalRoot = join(repositoryRoot, "packages/ts/evals/empirical-memory-rerun-avoidance");
	// D11 retains the exact historical D6 provider source coordinate.
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(FILES).map(async ([key, file]) => [
				key,
				key === "d6ProviderAuthority"
					? D11_IMPLEMENTATION_SOURCE_HASHES.d6ProviderAuthority
					: empiricalSha256(await readFile(join(evalRoot, file))),
			]),
		),
	) as Record<keyof typeof FILES, string>;
	if (JSON.stringify(measured) !== JSON.stringify(D11_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D11 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d11.transport-failure-implementation-manifest.v1",
		sources: measured,
	});
}
