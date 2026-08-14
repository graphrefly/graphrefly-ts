import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

const ROOT = resolve(import.meta.dirname, "../../../..");
export const D778_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	taskToolAuthority: "sha256:ee85f493b747f51bfc1e7f115c2d56993f68da051b6675705673d6a30cfb0059",
	qualification: "sha256:054e124923bfddcda9b0dd8301c291628856decabc9a55b54561536dcc0bb096",
	runner: "sha256:fd33d0c21f5ada4c9ae84410032ffff5c6d475c0cf560cd26b40258140add430",
});
export const D778_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly.b112.d778.implementation-manifest.v1",
	sources: D778_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD778Implementation(): Promise<string> {
	const paths = {
		taskToolAuthority:
			"packages/ts/evals/empirical-memory-rerun-avoidance/d778-graph-task-tool-authority.ts",
		qualification:
			"packages/ts/evals/empirical-memory-rerun-avoidance/d778-pre-live-qualification.ts",
		runner: "packages/ts/evals/empirical-memory-rerun-avoidance/run-d778-no-network-pre-live.ts",
	} as const;
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(paths).map(async ([key, path]) => [
				key,
				empiricalSha256(new Uint8Array(await readFile(resolve(ROOT, path)))),
			]),
		),
	);
	if (JSON.stringify(measured) !== JSON.stringify(D778_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D778 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly.b112.d778.implementation-manifest.v1",
		sources: measured,
	});
}
