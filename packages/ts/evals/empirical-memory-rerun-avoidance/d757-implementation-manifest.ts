import { readFile } from "node:fs/promises";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D756_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD756Implementation,
} from "./d756-implementation-manifest.js";

export const D757_PRE_LIVE_SOURCE_SHA256 =
	"sha256:baaa9ca74219f1859fe492a3304e69d063ed86e7b458e739b6bf2b3ce5d5474d" as const;
export const D757_RUNNER_SOURCE_SHA256 =
	"sha256:ae3afae633fbda33ce09e2f047cb19cbc2453e30800452dfd45b39838e2f4fc5" as const;

export const D757_IMPLEMENTATION_MANIFEST = strictSnapshot({
	revision: "graphrefly.b112.d757.implementation-manifest.v1",
	decisionRef: "decision.D757",
	baselineCommit: "235a737950442bcb6d3cfc994d49fbaf8ee2f054",
	baselineManifestDigest: D756_IMPLEMENTATION_MANIFEST_DIGEST,
	preLiveSourceSha256: D757_PRE_LIVE_SOURCE_SHA256,
	runnerSourceSha256: D757_RUNNER_SOURCE_SHA256,
});

export const D757_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest(
	D757_IMPLEMENTATION_MANIFEST,
);

export async function measureD757Implementation(): Promise<string> {
	if ((await measureD756Implementation()) !== D756_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D757 D756 baseline implementation drifted");
	const [preLive, runner] = await Promise.all([
		readFile(new URL("./d757-named-tool-pre-live.ts", import.meta.url)),
		readFile(new URL("./run-d757-no-network-pre-live.ts", import.meta.url)),
	]);
	if (
		empiricalSha256(preLive) !== D757_PRE_LIVE_SOURCE_SHA256 ||
		empiricalSha256(runner) !== D757_RUNNER_SOURCE_SHA256
	)
		throw new TypeError("D757 pre-live implementation drifted");
	return D757_IMPLEMENTATION_MANIFEST_DIGEST;
}
