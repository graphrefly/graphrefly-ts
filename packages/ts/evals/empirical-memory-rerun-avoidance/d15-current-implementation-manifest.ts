import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import {
	CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST as D6_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentGraphLiveImplementation as measureD6Implementation,
} from "./d6-current-implementation-manifest.js";
import {
	D14_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD14Implementation,
} from "./d14-current-implementation-manifest.js";

export const D15_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	d15Coordinates: "sha256:f389df1d8297a42f802b7a12c7e2623a465d428ce0cc0db6a12eb51c21b7b97a",
	d15Claim: "sha256:4658769496cb7bebcba3ff196cdf23f88f7df55006b221137a902617bb72bd08",
	d15Live: "sha256:19f09107f1a5c4dd6da699fcc6fa5d37500da54804f1f12ee641ddc04ef64039",
	d15Qualification: "sha256:e98aa4acc547d77f1aa9e636a1fa9b003b299df286640da9442b0d3fef8d795c",
	d15NoNetworkRunner: "sha256:ecbb686d37bf8ea28bada1e9049678f952f9788e8830d3b126997cb36bb53496",
	d15LiveRunner: "sha256:d5dcfb5e6a6a12d4fcd7c0dcfe419b2e67c56a2269b91d62f54585ca8a69468a",
});

export const D15_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d15.current-live-implementation-manifest.v1",
	d6ImplementationManifestDigest: D6_IMPLEMENTATION_MANIFEST_DIGEST,
	d14ImplementationManifestDigest: D14_IMPLEMENTATION_MANIFEST_DIGEST,
	sources: D15_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	d15Coordinates: "d15-current-live-coordinates.ts",
	d15Claim: "d15-current-live-claim.ts",
	d15Live: "d15-current-live.ts",
	d15Qualification: "d15-current-pre-live-qualification.ts",
	d15NoNetworkRunner: "run-d15-current-no-network.ts",
	d15LiveRunner: "run-d15-live.ts",
});

export async function measureD15Implementation(repositoryRoot: string): Promise<string> {
	if ((await measureD6Implementation(repositoryRoot)) !== D6_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D15 D6 implementation baseline drifted");
	if ((await measureD14Implementation(repositoryRoot)) !== D14_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D15 D14 operational baseline drifted");
	const evalRoot = join(repositoryRoot, "packages/ts/evals/empirical-memory-rerun-avoidance");
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(FILES).map(async ([key, file]) => [
				key,
				empiricalSha256(await readFile(join(evalRoot, file))),
			]),
		),
	) as Record<keyof typeof FILES, string>;
	if (JSON.stringify(measured) !== JSON.stringify(D15_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D15 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d15.current-live-implementation-manifest.v1",
		d6ImplementationManifestDigest: D6_IMPLEMENTATION_MANIFEST_DIGEST,
		d14ImplementationManifestDigest: D14_IMPLEMENTATION_MANIFEST_DIGEST,
		sources: measured,
	});
}
