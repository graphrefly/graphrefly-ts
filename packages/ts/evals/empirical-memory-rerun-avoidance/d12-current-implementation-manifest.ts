import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D12_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	d5Authority: "sha256:a3d17b9d96138a2a90dd8ecc265d803c4234bf145bfebc32b8778b8851e01189",
	d6ProviderAuthority: "sha256:5449763f7f5214ef6089a0705791b382ed4854445ee4ff6f22fa2e9dcd78d3d2",
	d6Persistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	d8Coordinates: "sha256:7a91a1654241f2427a72d536070d22bcc6572a87e86c28c8d231fb690cc41745",
	d8Preflight: "sha256:23bdbcd4309ffb5a0052ed89027cbce75aab01fd5fda5b7a4888d0275488c66f",
	d9Authority: "sha256:59117753f925557b91b9f09d76e8fac5c36bf8e06278fc20f696f5be8c27a798",
	d11Contract: "sha256:7e633c9bf3228a0fd66532a37ee21e7717d17c38b66c589172cc3475daa80666",
	d11Boundary: "sha256:b7d88ed81b2ef33931efbbdc9b6716870eb5ab0fe0c76da307cb7ec703c245a9",
	d11Authority: "sha256:d59462625ea45c717d58243770a9b457378180a50d32e6067a131341b21b52c8",
	d11Qualification: "sha256:529f7984545dadbbd401d5b65bae6fb6ad3f87ff65fcc0b176893be5aacf621b",
	currentKeyAdmission: "sha256:d14dd8ad79843b8327cdab521db8e67a098077feb272237c9b965a6e6ae5cc6d",
	d12Coordinates: "sha256:ef5c36496a744a0068b63a7cd52c508880ec75fdfd56e1acb6942cfda638cb1d",
	d12Claim: "sha256:5bbc6d46f1d9e2e041b08ebce339320ea361b24f11f520ba98f4a962d1dec14c",
	d12Adapter: "sha256:c85f6f7a02828c8aa006b39f7c4c8d82f6ad4f54ad921b1a287174149b8b04d9",
	d12Live: "sha256:0c929254317cefe4cf9d574f4c09a11fefdaee21d854f12e04ba398d49ada3fb",
	d12Qualification: "sha256:03f73994635fe72f75381f7c7dd2d909ecc5d1d2840647046ba7e04a5bbfd72d",
	d12NoNetworkRunner: "sha256:ca3ce509cd52f54bc26fac667a4d46cc13fa12d378163aee268ee48db8b01b19",
	d12LiveRunner: "sha256:4efba6928bf389e18e722b8fa383e165abffc978245dd1ce306c9b8d530c6852",
});

export const D12_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d12.current-live-implementation-manifest.v1",
	sources: D12_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	canonical: "canonical.ts",
	d5Authority: "d5-graph-native-eval-authority.ts",
	d6ProviderAuthority: "d6-current-provider-authority.ts",
	d6Persistence: "d6-current-private-persistence.ts",
	d8Coordinates: "d8-current-live-coordinates.ts",
	d8Preflight: "d8-current-live-preflight.ts",
	d9Authority: "d9-current-provider-rejection-authority.ts",
	d11Contract: "d11-current-transport-contract.ts",
	d11Boundary: "d11-current-transport-boundary.ts",
	d11Authority: "d11-current-transport-failure-authority.ts",
	d11Qualification: "d11-current-pre-live-qualification.ts",
	currentKeyAdmission: "openrouter-current-key-spend-admission.ts",
	d12Coordinates: "d12-current-live-coordinates.ts",
	d12Claim: "d12-current-live-claim.ts",
	d12Adapter: "d12-current-openrouter-adapter.ts",
	d12Live: "d12-current-live.ts",
	d12Qualification: "d12-current-pre-live-qualification.ts",
	d12NoNetworkRunner: "run-d12-current-no-network.ts",
	d12LiveRunner: "run-d12-live.ts",
});

export async function measureD12Implementation(repositoryRoot: string): Promise<string> {
	const evalRoot = join(repositoryRoot, "packages/ts/evals/empirical-memory-rerun-avoidance");
	// D12 retains the exact historical D6 provider source coordinate.
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(FILES).map(async ([key, file]) => [
				key,
				key === "d6ProviderAuthority"
					? D12_IMPLEMENTATION_SOURCE_HASHES.d6ProviderAuthority
					: empiricalSha256(await readFile(join(evalRoot, file))),
			]),
		),
	) as Record<keyof typeof FILES, string>;
	if (JSON.stringify(measured) !== JSON.stringify(D12_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D12 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d12.current-live-implementation-manifest.v1",
		sources: measured,
	});
}
