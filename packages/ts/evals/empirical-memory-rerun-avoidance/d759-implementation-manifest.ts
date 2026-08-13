import { readFile } from "node:fs/promises";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D759_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	graphLedger: "sha256:a63894f692c5748130cc4f3aace34428522aa7eb08a73605ff1f68499aad5593",
	graphRuntime: "sha256:bc826a13d70351e245b04e8845bdf22f60cc86426a8bfe37e799c94c01693460",
	graphProjection: "sha256:e0406b642e164469c7bb88858e1b391aa4aa65c6142e4d1689a7895f50b3c901",
	graphEval: "sha256:f50fea949840d72ff1e53fad634543e991375eb031cbe9fbb8ac57f527c5f209",
	namedToolLowering: "sha256:95dce829d31319a4de03f81f60057f7668de4111b9f0300e9fd1728af1aee95f",
	namedToolFocusedTest: "sha256:337a92f0dfbdce3213e5e824ad87d28dcf0dcbbeac3b8bd2c16d0deabee751c7",
	qualification: "sha256:88fd4310a262e1373bb609195a8a4589f5125004ae6a0be3c083b30fa9a98bc1",
	focusedTest: "sha256:10b38fdd9ca90a45b47f4891844c08f6e60363c39589b1b6a65578ebf386e5a8",
	runner: "sha256:7c54bfdbce2eaa4e44771b9990bc82b98c9ad8ece8eec8ba36323d92c63d5276",
});

export const D759_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d759.implementation-manifest.v1",
	decisionRef: "decision.D759",
	decisionRevision: "2026-08-12.v1",
	sourceSha256: D759_IMPLEMENTATION_SOURCE_SHA256,
});

export const D759_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D759_IMPLEMENTATION_MANIFEST,
);

const SOURCE_URLS = Object.freeze({
	graphLedger: new URL("./d719-clean-graph-ledger.ts", import.meta.url),
	graphRuntime: new URL("./d722-graph-native-effect-runtime.ts", import.meta.url),
	graphProjection: new URL("./d722-graph-completion-memory-insight.ts", import.meta.url),
	graphEval: new URL("./d722-graph-native-eval.ts", import.meta.url),
	namedToolLowering: new URL("./d756-graph-named-tool-continuation.ts", import.meta.url),
	namedToolFocusedTest: new URL(
		"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d756-named-tool.test.ts",
		import.meta.url,
	),
	qualification: new URL("./d759-hidden-verifier-correction-qualification.ts", import.meta.url),
	focusedTest: new URL(
		"../../src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d759-hidden-verifier-correction.test.ts",
		import.meta.url,
	),
	runner: new URL("./run-d759-no-network-pre-live.ts", import.meta.url),
});

export async function measureD759Implementation(): Promise<string> {
	for (const key of Object.keys(SOURCE_URLS) as (keyof typeof SOURCE_URLS)[]) {
		const bytes = await readFile(SOURCE_URLS[key]);
		if (empiricalSha256(bytes) !== D759_IMPLEMENTATION_SOURCE_SHA256[key])
			throw new TypeError(`D759 implementation source drifted: ${key}`);
	}
	return D759_IMPLEMENTATION_MANIFEST_DIGEST;
}
