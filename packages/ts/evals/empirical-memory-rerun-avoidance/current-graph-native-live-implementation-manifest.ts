import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import { CURRENT_GRAPH_LIVE_D2_IMPLEMENTATION_MANIFEST_DIGEST } from "./current-graph-native-live-coordinates.js";

export const CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	d1Authority: "sha256:e4f04d8fcca638fa9f4e4e8a074662050728e87724714179ab6816366417f2d3",
	d2Authority: "sha256:49b530f1d927ad2f6628edfb5d93e590eaecf614508af2ff53dd8530bdd64bdf",
	d2Qualification: "sha256:aa7f6abb5c32f042f186d3e380f2b97eabee44238e23ebfb12b932f4b2a0d4c7",
	coordinates: "sha256:30d1a02c3d7d39c77dda8faabe4f8affd3f328abb35742d594f86f62a75b7b3d",
	preflight: "sha256:4d40564feda92e30f07c58d4fdb037deb8753814b82c72fd74f032875866dd6b",
	claim: "sha256:b629695bc940b6d24466fc9a7ac49e06fabdf3df11fa2742fff39f0e5ec45b81",
	liveAuthority: "sha256:60eee720506859130998a2d1f6af036a88c5d823eb0be93b716ca395381b5fb9",
	openRouterAdapter: "sha256:d409c57294fd6ab56af8ac8e475f4462d88b6de43721e5f4d91ee079e056bcbf",
	qualification: "sha256:93b2aae188677ff9bb68d04751749d47068e5637a38fdeb7c3cceada8d2e075e",
	runner: "sha256:87ff8fcc0b647b5cc9189661f1f1516499afc8d3ecb3897e66a11a25b4fd18d8",
	liveRunner: "sha256:2cd240fac81c9dd7c68eb3883d027000cc0de921ac2931178f98ae816ea602f6",
	privatePersistence: "sha256:a4b5f95750747226edd1ea8a1a81c1c7c0a9e5eb0734f97f07f6604fd46c908e",
});

export const CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d3.current-graph-live-implementation-manifest.v1",
	d2BaselineManifestDigest: CURRENT_GRAPH_LIVE_D2_IMPLEMENTATION_MANIFEST_DIGEST,
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
		revision: "graphrefly-ts.d3.current-graph-live-implementation-manifest.v1",
		d2BaselineManifestDigest: CURRENT_GRAPH_LIVE_D2_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
