import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const CURRENT_GRAPH_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	authority: "sha256:e4f04d8fcca638fa9f4e4e8a074662050728e87724714179ab6816366417f2d3",
	publicSemanticValidation:
		"sha256:5707b5dffaae53f566ba89987a59dc1da62fca5c03bb2fa020a1b8d018de8b50",
	qualification: "sha256:45a55daa6d7be1e592beaf35e55ac7d9890318c2abd4c89704c0fd270f9383e8",
	privateRunner: "sha256:953172d7033946dac4a29e972af835c91b00ff8342a027fa95bce273814b7ab1",
});

export const CURRENT_GRAPH_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d1.current-graph-native-implementation-manifest.v1",
	sources: CURRENT_GRAPH_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureCurrentGraphImplementation(): Promise<string> {
	const measured = Object.freeze({
		authority: empiricalSha256(
			await readFile(join(import.meta.dirname, "current-graph-native-eval-authority.ts")),
		),
		publicSemanticValidation: empiricalSha256(
			await readFile(
				join(import.meta.dirname, "current-managed-cloud-public-semantic-validation.ts"),
			),
		),
		qualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "current-graph-native-eval-qualification.ts")),
		),
		privateRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-current-graph-native-no-network.ts")),
		),
	});
	if (JSON.stringify(measured) !== JSON.stringify(CURRENT_GRAPH_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("current Graph implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d1.current-graph-native-implementation-manifest.v1",
		sources: measured,
	});
}
