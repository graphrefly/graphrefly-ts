import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import { CURRENT_GRAPH_LIVE_D6_IMPLEMENTATION_MANIFEST_DIGEST } from "./d7-current-live-coordinates.js";

export const D7_CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	d5Authority: "sha256:a3d17b9d96138a2a90dd8ecc265d803c4234bf145bfebc32b8778b8851e01189",
	publicSemanticValidation:
		"sha256:5707b5dffaae53f566ba89987a59dc1da62fca5c03bb2fa020a1b8d018de8b50",
	d6ProviderAuthority: "sha256:5449763f7f5214ef6089a0705791b382ed4854445ee4ff6f22fa2e9dcd78d3d2",
	d6Coordinates: "sha256:992cea545a8fa414d68711185bfb86e7c90d2567c82e7c0eb2c9f92454647bbb",
	d6Preflight: "sha256:23288472643be11af217a4f2e4de22bea758e0873717dc1ae9815aeedffdd731",
	d6Claim: "sha256:3b2481ca18bd809d24a436d3ee6da1ac89cdd1f5bce59baf948eed96eb853d32",
	d6Live: "sha256:a0869bf9c681d188f5060b0d32b82323b5cf8c3c542d05772a539d239da5769c",
	d6Adapter: "sha256:386554b90cb8c8038b11216bd148ef460af9aa421f78eaac3c1ad055cbc9622e",
	d6Qualification: "sha256:f7159da20794b5b3dba27c5e82fd961e9801f006e4df1cba6047812f256d104f",
	d6Persistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	currentKeyAdmission: "sha256:d14dd8ad79843b8327cdab521db8e67a098077feb272237c9b965a6e6ae5cc6d",
	d7Coordinates: "sha256:dba157dfa1ac62b4a365afccfc650383640254033a83004371c409ad75e1977b",
	d7Preflight: "sha256:00cf95c7c2c07ce9ee169ba6f5a32efa45e0d0fd6cfcdbac0faf314c49657ffe",
	d7Claim: "sha256:dbe96115a026df5b1a83c78baf37ec9ea8ae60693eac940460c50f7614e03063",
	d7Live: "sha256:adcb45d67159514c1f1c2ac7148a874f44f90fd5be8b90c0ac1f65d8966f8e28",
	d7Runner: "sha256:9c540640bc8ed6fff90ce958354536ddeb94c467055710bf2229ff02f253a149",
});

export const CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d7.current-graph-live-implementation-manifest.v1",
	d6BaselineManifestDigest: CURRENT_GRAPH_LIVE_D6_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D7_CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	canonical: "canonical.ts",
	d5Authority: "d5-graph-native-eval-authority.ts",
	publicSemanticValidation: "current-managed-cloud-public-semantic-validation.ts",
	d6ProviderAuthority: "d6-current-provider-authority.ts",
	d6Coordinates: "d6-current-live-coordinates.ts",
	d6Preflight: "d6-current-live-preflight.ts",
	d6Claim: "d6-current-live-claim.ts",
	d6Live: "d6-current-live.ts",
	d6Adapter: "d6-current-openrouter-adapter.ts",
	d6Qualification: "d6-current-pre-live-qualification.ts",
	d6Persistence: "d6-current-private-persistence.ts",
	currentKeyAdmission: "openrouter-current-key-spend-admission.ts",
	d7Coordinates: "d7-current-live-coordinates.ts",
	d7Preflight: "d7-current-live-preflight.ts",
	d7Claim: "d7-current-live-claim.ts",
	d7Live: "d7-current-live.ts",
	d7Runner: "run-d7-live.ts",
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
	if (
		JSON.stringify(measured) !== JSON.stringify(D7_CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES)
	)
		throw new TypeError("current D7 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d7.current-graph-live-implementation-manifest.v1",
		d6BaselineManifestDigest: CURRENT_GRAPH_LIVE_D6_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
