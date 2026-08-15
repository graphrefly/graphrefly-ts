import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import { CURRENT_GRAPH_LIVE_D5_IMPLEMENTATION_MANIFEST_DIGEST } from "./d6-current-live-coordinates.js";

export const CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	d5Authority: "sha256:a3d17b9d96138a2a90dd8ecc265d803c4234bf145bfebc32b8778b8851e01189",
	publicSemanticValidation:
		"sha256:5707b5dffaae53f566ba89987a59dc1da62fca5c03bb2fa020a1b8d018de8b50",
	providerAuthority: "sha256:5449763f7f5214ef6089a0705791b382ed4854445ee4ff6f22fa2e9dcd78d3d2",
	coordinates: "sha256:992cea545a8fa414d68711185bfb86e7c90d2567c82e7c0eb2c9f92454647bbb",
	preflight: "sha256:23288472643be11af217a4f2e4de22bea758e0873717dc1ae9815aeedffdd731",
	claim: "sha256:3b2481ca18bd809d24a436d3ee6da1ac89cdd1f5bce59baf948eed96eb853d32",
	liveAuthority: "sha256:a0869bf9c681d188f5060b0d32b82323b5cf8c3c542d05772a539d239da5769c",
	openRouterAdapter: "sha256:386554b90cb8c8038b11216bd148ef460af9aa421f78eaac3c1ad055cbc9622e",
	qualification: "sha256:f7159da20794b5b3dba27c5e82fd961e9801f006e4df1cba6047812f256d104f",
	runner: "sha256:44385f70dde7c11200965d62a335d947b6f11ac1b5f02e3f969319d6e4cb871f",
	privatePersistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	currentKeyAdmission: "sha256:d14dd8ad79843b8327cdab521db8e67a098077feb272237c9b965a6e6ae5cc6d",
});

export const CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d6.current-graph-live-implementation-manifest.v1",
	d5BaselineManifestDigest: CURRENT_GRAPH_LIVE_D5_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: CURRENT_GRAPH_LIVE_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	canonical: "canonical.ts",
	d5Authority: "d5-graph-native-eval-authority.ts",
	publicSemanticValidation: "current-managed-cloud-public-semantic-validation.ts",
	providerAuthority: "d6-current-provider-authority.ts",
	coordinates: "d6-current-live-coordinates.ts",
	preflight: "d6-current-live-preflight.ts",
	claim: "d6-current-live-claim.ts",
	liveAuthority: "d6-current-live.ts",
	openRouterAdapter: "d6-current-openrouter-adapter.ts",
	qualification: "d6-current-pre-live-qualification.ts",
	runner: "run-d6-current-no-network.ts",
	privatePersistence: "d6-current-private-persistence.ts",
	currentKeyAdmission: "openrouter-current-key-spend-admission.ts",
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
		throw new TypeError("current D6 live implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d6.current-graph-live-implementation-manifest.v1",
		d5BaselineManifestDigest: CURRENT_GRAPH_LIVE_D5_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
