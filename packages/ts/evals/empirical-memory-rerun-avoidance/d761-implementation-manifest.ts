import { readFile } from "node:fs/promises";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D761_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	graphLedger: "sha256:82c66dc10ff9a7a9bb709316280362fe9755cf35b972664d7bfbfe4464ab4105",
	graphRuntime: "sha256:aa50eeda5a4bd36171d9fdde25051d1cafe057c2e212d2e925887c654b4f1631",
	graphProjection: "sha256:9fb33ab51b185a1787fc092ea148cb493eebfb7e7e27891a1631a534bba3dc73",
	graphEval: "sha256:b8e7917ff4b990fad14bd7aa11b9c1ac3360d162803dc7fb0250ed66480459c0",
	qualification: "sha256:c03ba69d4b07550b0d9b6628539d8f80cd51d24cb2a20e9f4160c5a1c2782083",
	focusedTest: "sha256:9e6daa816e7a7c9437dd68d436fd15e24381a45692077543e87f9aa5e7986142",
	runner: "sha256:d3cc6fd8a7946537ad180051275d9a6ac98c9eb82385541f264976753ac5e60c",
});

export const D761_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d761.implementation-manifest.v1",
	decisionRef: "decision.D761",
	decisionRevision: "2026-08-12.v1",
	sourceSha256: D761_IMPLEMENTATION_SOURCE_SHA256,
});

export const D761_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D761_IMPLEMENTATION_MANIFEST,
);

const SOURCE_URLS = Object.freeze({
	graphLedger: new URL("./d761-clean-graph-ledger.ts", import.meta.url),
	graphRuntime: new URL("./d761-graph-native-effect-runtime.ts", import.meta.url),
	graphProjection: new URL("./d761-graph-completion-memory-insight.ts", import.meta.url),
	graphEval: new URL("./d761-graph-native-eval.ts", import.meta.url),
	qualification: new URL("./d761-public-semantic-validation-qualification.ts", import.meta.url),
	focusedTest: new URL(
		"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d761-public-semantic-validation.test.ts",
		import.meta.url,
	),
	runner: new URL("./run-d761-no-network-pre-live.ts", import.meta.url),
});

export async function measureD761Implementation(): Promise<string> {
	for (const key of Object.keys(SOURCE_URLS) as (keyof typeof SOURCE_URLS)[]) {
		const bytes = await readFile(SOURCE_URLS[key]);
		if (empiricalSha256(bytes) !== D761_IMPLEMENTATION_SOURCE_SHA256[key])
			throw new TypeError(`D761 implementation source drifted: ${key}`);
	}
	return D761_IMPLEMENTATION_MANIFEST_DIGEST;
}
