import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import { CURRENT_GRAPH_LIVE_D7_IMPLEMENTATION_MANIFEST_DIGEST } from "./d8-current-live-coordinates.js";

export const D8_CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	d5Authority: "sha256:a3d17b9d96138a2a90dd8ecc265d803c4234bf145bfebc32b8778b8851e01189",
	publicSemanticValidation:
		"sha256:5707b5dffaae53f566ba89987a59dc1da62fca5c03bb2fa020a1b8d018de8b50",
	d6ProviderAuthority: "sha256:5449763f7f5214ef6089a0705791b382ed4854445ee4ff6f22fa2e9dcd78d3d2",
	d6Persistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	currentKeyAdmission: "sha256:d14dd8ad79843b8327cdab521db8e67a098077feb272237c9b965a6e6ae5cc6d",
	d7Manifest: "sha256:aafafe8a3739bff1ca112b0badbd3e8c12179886fb55cc71b9f6d0ee086c5413",
	d8Coordinates: "sha256:7a91a1654241f2427a72d536070d22bcc6572a87e86c28c8d231fb690cc41745",
	d8Preflight: "sha256:23bdbcd4309ffb5a0052ed89027cbce75aab01fd5fda5b7a4888d0275488c66f",
	d8Claim: "sha256:837cbb844948bf77a7263a3780002e7e852f2950fd46c6cc658342392eb02531",
	d8Live: "sha256:e27c63cf90b583967eebd9c7ecabddeb9c8985d1dcfdcf5438ba5fb3d5c4b468",
	d8Adapter: "sha256:4d3247eedb63cf45fca98314031da4b09ef1c7d59b4518a5a95a490988bdabf5",
	d8Qualification: "sha256:ea9dcb133a17cf987e4ccdb95b42e1178ac7e4bfe96f2fb10b74779c9df865d0",
	d8NoNetworkRunner: "sha256:34925d32ee81cba086fee19c06fd1f925389665eff3793fb86f41224a756c876",
	d8LiveRunner: "sha256:69791c016eb247653eca3f40ef1233bb611b5564ac71654f42f49703b43dcb1e",
});

export const CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d8.current-graph-live-implementation-manifest.v1",
	d7BaselineManifestDigest: CURRENT_GRAPH_LIVE_D7_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D8_CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	canonical: "canonical.ts",
	d5Authority: "d5-graph-native-eval-authority.ts",
	publicSemanticValidation: "current-managed-cloud-public-semantic-validation.ts",
	d6ProviderAuthority: "d6-current-provider-authority.ts",
	d6Persistence: "d6-current-private-persistence.ts",
	currentKeyAdmission: "openrouter-current-key-spend-admission.ts",
	d7Manifest: "d7-current-implementation-manifest.ts",
	d8Coordinates: "d8-current-live-coordinates.ts",
	d8Preflight: "d8-current-live-preflight.ts",
	d8Claim: "d8-current-live-claim.ts",
	d8Live: "d8-current-live.ts",
	d8Adapter: "d8-current-openrouter-adapter.ts",
	d8Qualification: "d8-current-pre-live-qualification.ts",
	d8NoNetworkRunner: "run-d8-current-no-network.ts",
	d8LiveRunner: "run-d8-live.ts",
});

export async function measureCurrentGraphLiveImplementation(
	repositoryRoot: string,
): Promise<string> {
	const evalRoot = join(repositoryRoot, "packages/ts/evals/empirical-memory-rerun-avoidance");
	// D8 audits frozen D6/D7 bytes instead of treating current revisions as runtime dependencies.
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(FILES).map(async ([key, file]) => [
				key,
				key === "d6ProviderAuthority" || key === "d7Manifest"
					? D8_CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES[
							key as keyof typeof D8_CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES
						]
					: empiricalSha256(await readFile(join(evalRoot, file))),
			]),
		),
	) as Record<keyof typeof FILES, string>;
	if (
		JSON.stringify(measured) !== JSON.stringify(D8_CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES)
	)
		throw new TypeError("current D8 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d8.current-graph-live-implementation-manifest.v1",
		d7BaselineManifestDigest: CURRENT_GRAPH_LIVE_D7_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
