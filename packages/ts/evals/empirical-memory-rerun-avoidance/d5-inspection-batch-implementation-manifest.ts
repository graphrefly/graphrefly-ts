import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const CURRENT_GRAPH_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	authority: "sha256:a3d17b9d96138a2a90dd8ecc265d803c4234bf145bfebc32b8778b8851e01189",
	publicSemanticValidation:
		"sha256:5707b5dffaae53f566ba89987a59dc1da62fca5c03bb2fa020a1b8d018de8b50",
	qualification: "sha256:26c296379ac8f585a205a78d8fdf588a1f9b268c7ad4f9e4c1b575f3d689ba79",
	privateRunner: "sha256:398291e723089ed89207a42a4c8f40ebad42bb9e3e97dc1709a74db0b640b931",
});

export const CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d5.inspection-batch-implementation-manifest.v1",
	sources: CURRENT_GRAPH_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureCurrentGraphImplementation(): Promise<string> {
	const measured = Object.freeze({
		authority: empiricalSha256(
			await readFile(join(import.meta.dirname, "d5-graph-native-eval-authority.ts")),
		),
		publicSemanticValidation: empiricalSha256(
			await readFile(
				join(import.meta.dirname, "current-managed-cloud-public-semantic-validation.ts"),
			),
		),
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "d5-inspection-batch-qualification.ts")),
		),
		privateRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-d5-inspection-batch-no-network.ts")),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(CURRENT_GRAPH_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D5 Graph implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d5.inspection-batch-implementation-manifest.v1",
		sources: measured,
	});
}
