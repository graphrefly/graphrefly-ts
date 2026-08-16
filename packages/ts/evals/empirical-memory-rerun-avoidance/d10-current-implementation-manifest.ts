import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D10_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	d5Authority: "sha256:a3d17b9d96138a2a90dd8ecc265d803c4234bf145bfebc32b8778b8851e01189",
	d6ProviderAuthority: "sha256:5449763f7f5214ef6089a0705791b382ed4854445ee4ff6f22fa2e9dcd78d3d2",
	d6Persistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	d8Coordinates: "sha256:7a91a1654241f2427a72d536070d22bcc6572a87e86c28c8d231fb690cc41745",
	d8Preflight: "sha256:23bdbcd4309ffb5a0052ed89027cbce75aab01fd5fda5b7a4888d0275488c66f",
	d8Adapter: "sha256:4d3247eedb63cf45fca98314031da4b09ef1c7d59b4518a5a95a490988bdabf5",
	d9Authority: "sha256:59117753f925557b91b9f09d76e8fac5c36bf8e06278fc20f696f5be8c27a798",
	d9Qualification: "sha256:34f982d4098ec2073a1392391ad0a2b7bd49696e44cff463d4d9e9881cdd6f5d",
	d10Coordinates: "sha256:651cce69070a55cc0784135c0621b484347dad031ab0993a8d47f80427e29ac7",
	d10Claim: "sha256:c3d07d920f3e6fd9436a7b49d8cf7dfe642b786356279011d1ab43bec26b4075",
	d10Live: "sha256:a4116e7dc2272f4bec523c8a7fbd98fe98bda032fb8a45e4ea4bbb53d10ccba8",
	d10Qualification: "sha256:a971c87078ed21419564c01a6d6caadec1fb5d15345bf42c1375e79d58a816b2",
	d10NoNetworkRunner: "sha256:2601e6451e1eb806de46359854f7574a237ca4e895a01dc9768a967991c587a0",
	d10LiveRunner: "sha256:d017ef8679de7f9f8a8e842dd963828655d2b5d2c971d94970df0f520be16d7f",
});

export const D10_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d10.current-live-implementation-manifest.v1",
	sources: D10_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	canonical: "canonical.ts",
	d5Authority: "d5-graph-native-eval-authority.ts",
	d6ProviderAuthority: "d6-current-provider-authority.ts",
	d6Persistence: "d6-current-private-persistence.ts",
	d8Coordinates: "d8-current-live-coordinates.ts",
	d8Preflight: "d8-current-live-preflight.ts",
	d8Adapter: "d8-current-openrouter-adapter.ts",
	d9Authority: "d9-current-provider-rejection-authority.ts",
	d9Qualification: "d9-current-pre-live-qualification.ts",
	d10Coordinates: "d10-current-live-coordinates.ts",
	d10Claim: "d10-current-live-claim.ts",
	d10Live: "d10-current-live.ts",
	d10Qualification: "d10-current-pre-live-qualification.ts",
	d10NoNetworkRunner: "run-d10-current-no-network.ts",
	d10LiveRunner: "run-d10-live.ts",
});

export async function measureD10Implementation(repositoryRoot: string): Promise<string> {
	const evalRoot = join(repositoryRoot, "packages/ts/evals/empirical-memory-rerun-avoidance");
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(FILES).map(async ([key, file]) => [
				key,
				empiricalSha256(await readFile(join(evalRoot, file))),
			]),
		),
	) as Record<keyof typeof FILES, string>;
	if (JSON.stringify(measured) !== JSON.stringify(D10_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D10 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d10.current-live-implementation-manifest.v1",
		sources: measured,
	});
}
