import { readFile } from "node:fs/promises";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D727_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	graphRuntime: "sha256:25be41e2e8b39afa4898ae32572a80a4f6165d4482816a97d070ec61bf1dfeac",
	graphEval: "sha256:9e82c5a992c9d95ead48f871b371c9875c3dcd510d2eef9d30e655a2d95590d2",
	providerBoundary: "sha256:25066e15cfebbcda5583134cb182ab97d72288288f99e033124749a24b941598",
	partialFailureBoundary: "sha256:f624f14beb36999f7cc2bea1f2753111b774cdff572cc4fd142c9fe42ee62e75",
});

export const D727_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d727.implementation-manifest.v1",
	sourceSha256: D727_IMPLEMENTATION_SOURCE_SHA256,
});

export const D727_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D727_IMPLEMENTATION_MANIFEST,
);

export async function measureD727Implementation(): Promise<string> {
	const [graphRuntime, graphEval, providerBoundary, partialFailureBoundary] = await Promise.all([
		readFile(new URL("./d722-graph-native-effect-runtime.ts", import.meta.url)),
		readFile(new URL("./d722-graph-native-eval.ts", import.meta.url)),
		readFile(new URL("./d726-graph-native-live.ts", import.meta.url)),
		readFile(new URL("./d727-executor-failure-pre-live.ts", import.meta.url)),
	]);
	const measured = {
		graphRuntime: empiricalSha256(graphRuntime),
		graphEval: empiricalSha256(graphEval),
		providerBoundary: empiricalSha256(providerBoundary),
		partialFailureBoundary: empiricalSha256(partialFailureBoundary),
	};
	for (const key of Object.keys(measured) as (keyof typeof measured)[])
		if (measured[key] !== D727_IMPLEMENTATION_SOURCE_SHA256[key])
			throw new TypeError(`D727 implementation source drifted: ${key}`);
	return D727_IMPLEMENTATION_MANIFEST_DIGEST;
}
