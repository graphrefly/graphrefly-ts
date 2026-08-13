import { readFile } from "node:fs/promises";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D767_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	graphLedger: "sha256:cbfadd5e999fbe845bf859e1e4f291e571394dee274e675d00d55b028694e8fb",
	graphRuntime: "sha256:a5b613827d037a78cc39f9185816ae54a131b5c8734622ad3bf5103c9afac9cb",
	graphEval: "sha256:135ab4aa9f6b6e293cc37b8dd45895dd46d69b29b7f3acc0679d03a012bbd226",
	graphProjection: "sha256:58b2d3464022672e6c7a13cf1993636ba2541a8dcea4547b28dbffb8dba89012",
	qualification: "sha256:05cc40c9e6db2d393e7ebfc3d16c3aaa5827dc9aadc2bb618378a20d9307b1f8",
	runner: "sha256:51cefc71358c1cda296b146fba9f161a75d5ebc8722cd25a07ca7e33c9398db9",
});

export const D767_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly.b112.d767.implementation-manifest.v1",
	sources: D767_IMPLEMENTATION_SOURCE_SHA256,
});

const sources = Object.freeze({
	graphLedger: new URL("./d767-clean-graph-ledger.ts", import.meta.url),
	graphRuntime: new URL("./d767-graph-native-effect-runtime.ts", import.meta.url),
	graphEval: new URL("./d767-graph-native-eval.ts", import.meta.url),
	graphProjection: new URL("./d767-graph-completion-memory-insight.ts", import.meta.url),
	qualification: new URL("./d767-retry-exhaustion-qualification.ts", import.meta.url),
	runner: new URL("./run-d767-no-network-pre-live.ts", import.meta.url),
});

export async function measureD767Implementation(): Promise<string> {
	const measured: Record<string, string> = {};
	for (const [key, url] of Object.entries(sources))
		measured[key] = empiricalSha256(await readFile(url));
	for (const [key, expected] of Object.entries(D767_IMPLEMENTATION_SOURCE_SHA256))
		if (measured[key] !== expected)
			throw new TypeError(`D767 implementation source drifted: ${key}`);
	return empiricalStrictJsonDigest({
		revision: "graphrefly.b112.d767.implementation-manifest.v1",
		sources: measured,
	});
}
