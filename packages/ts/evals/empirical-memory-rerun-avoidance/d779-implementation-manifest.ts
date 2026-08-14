import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import {
	D776_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD776Implementation,
} from "./d776-implementation-manifest.js";
import {
	D778_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD778Implementation,
} from "./d778-implementation-manifest.js";

const ROOT = resolve(import.meta.dirname, "../../../..");
export const D779_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	providerComposition: "sha256:94bea5572092cd466936145b793620067428d3ea30dd523c4daa4cb78b7c94f2",
	graphCore: "sha256:5cd629fda9eea9e29e6f4058d943d85d476be887d7490965c0c8b3bfc2e5dd24",
	qualification: "sha256:31dccb0abc3f638a4d33ad8f406f030e3b0217faf014456eee102952a65e78bf",
	runner: "sha256:1d6ca57b62b26e5437b3d152794ee756fa5b476eeafdc6c2d37319092449d9b7",
});
export const D779_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly.b112.d779.implementation-manifest.v1",
	d776ImplementationManifestDigest: D776_IMPLEMENTATION_MANIFEST_DIGEST,
	d778ImplementationManifestDigest: D778_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D779_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureD779Implementation(): Promise<string> {
	if ((await measureD778Implementation()) !== D778_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D779 D778 implementation baseline drifted");
	if ((await measureD776Implementation()) !== D776_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D779 D776 Graph dependency baseline drifted");
	const paths = {
		providerComposition:
			"packages/ts/evals/empirical-memory-rerun-avoidance/d779-provider-capable-composition.ts",
		graphCore: "packages/ts/evals/empirical-memory-rerun-avoidance/d779-graph-native-eval.ts",
		qualification:
			"packages/ts/evals/empirical-memory-rerun-avoidance/d779-pre-live-qualification.ts",
		runner: "packages/ts/evals/empirical-memory-rerun-avoidance/run-d779-no-network-pre-live.ts",
	} as const;
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(paths).map(async ([key, path]) => [
				key,
				empiricalSha256(new Uint8Array(await readFile(resolve(ROOT, path)))),
			]),
		),
	);
	if (JSON.stringify(measured) !== JSON.stringify(D779_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D779 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly.b112.d779.implementation-manifest.v1",
		d776ImplementationManifestDigest: D776_IMPLEMENTATION_MANIFEST_DIGEST,
		d778ImplementationManifestDigest: D778_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
