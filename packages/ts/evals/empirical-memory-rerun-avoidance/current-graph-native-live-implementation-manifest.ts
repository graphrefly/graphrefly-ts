import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import { CURRENT_GRAPH_LIVE_D3_IMPLEMENTATION_MANIFEST_DIGEST } from "./current-graph-native-live-coordinates.js";

export const CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	d1Authority: "sha256:e4f04d8fcca638fa9f4e4e8a074662050728e87724714179ab6816366417f2d3",
	d2Authority: "sha256:49b530f1d927ad2f6628edfb5d93e590eaecf614508af2ff53dd8530bdd64bdf",
	d2Qualification: "sha256:aa7f6abb5c32f042f186d3e380f2b97eabee44238e23ebfb12b932f4b2a0d4c7",
	coordinates: "sha256:24e4cde05ef4a1c84e37036877c1c48c817d4f4717f0c8bdaac0876c504e8aa1",
	preflight: "sha256:0a87ca245e1929cb3f51c7d65f5b967c9f697101f0f1aee595a9c9acca6b21fe",
	claim: "sha256:bab5d079ac4643f8a95a2cb61bcdda9705090674971c35295930530885c8fbce",
	liveAuthority: "sha256:71b92a264eefc7bd09eb65be2ce04a2fd1f9ce652a48c53e875c5ed3234cfec7",
	openRouterAdapter: "sha256:d409c57294fd6ab56af8ac8e475f4462d88b6de43721e5f4d91ee079e056bcbf",
	qualification: "sha256:81101a66bf618d1d0355cc85f41201699c6ee15af7db2dc0a1d06cd71b410787",
	runner: "sha256:8a4adb0934bb928080af66985e20a5b9b16cd37d63f614462593e5f3bc4b106a",
	liveRunner: "sha256:774551b024bc0f911dfda12cdce5e41f1c0da463215b1aa8e158d3ede69a0bfa",
	privatePersistence: "sha256:a4b5f95750747226edd1ea8a1a81c1c7c0a9e5eb0734f97f07f6604fd46c908e",
});

export const CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d4.current-graph-live-implementation-manifest.v1",
	d3BaselineManifestDigest: CURRENT_GRAPH_LIVE_D3_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	canonical: "canonical.ts",
	d1Authority: "current-graph-native-eval-authority.ts",
	d2Authority: "current-graph-native-provider-authority.ts",
	d2Qualification: "current-graph-native-provider-qualification.ts",
	coordinates: "current-graph-native-live-coordinates.ts",
	preflight: "current-graph-native-live-preflight.ts",
	claim: "current-graph-native-live-claim.ts",
	liveAuthority: "current-graph-native-live.ts",
	openRouterAdapter: "current-graph-native-openrouter-adapter.ts",
	qualification: "current-graph-native-live-qualification.ts",
	runner: "run-current-graph-native-live-no-network.ts",
	liveRunner: "run-current-graph-native-live.ts",
	privatePersistence: "current-graph-native-private-persistence.ts",
});

export async function measureCurrentGraphLiveImplementation(
	repositoryRoot: string,
): Promise<string> {
	const evalRoot = join(repositoryRoot, "packages/ts/evals/empirical-memory-rerun-avoidance");
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(FILES).map(async ([key, file]) => [
				key,
				empiricalSha256(await readFile(join(evalRoot, file))),
			]),
		),
	) as Record<keyof typeof FILES, string>;
	if (JSON.stringify(measured) !== JSON.stringify(CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("current live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d4.current-graph-live-implementation-manifest.v1",
		d3BaselineManifestDigest: CURRENT_GRAPH_LIVE_D3_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
