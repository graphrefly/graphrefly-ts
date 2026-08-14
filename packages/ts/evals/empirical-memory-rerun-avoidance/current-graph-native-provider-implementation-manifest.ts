import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const CURRENT_GRAPH_PROVIDER_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	providerAuthority: "sha256:49b530f1d927ad2f6628edfb5d93e590eaecf614508af2ff53dd8530bdd64bdf",
	providerQualification: "sha256:aa7f6abb5c32f042f186d3e380f2b97eabee44238e23ebfb12b932f4b2a0d4c7",
	privateRunner: "sha256:bf07d78fc03ec3a93b65bfd00adea8c4898401d2f53c49b3bb179eaf9a75697e",
	d1Authority: "sha256:e4f04d8fcca638fa9f4e4e8a074662050728e87724714179ab6816366417f2d3",
	d1ImplementationManifest:
		"sha256:dfaff21dce596962cb3302fcc1825ebe36fd0da883535fe2fac6c6a595553b76",
});

export const CURRENT_GRAPH_PROVIDER_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d2.current-graph-native-provider-implementation-manifest.v1",
	d1BaselineManifestDigest:
		"sha256:6a9151b68dcdcb983d818ec0af9eb3ec6819883ec78a883b012edeae6229bc6d",
	sources: CURRENT_GRAPH_PROVIDER_IMPLEMENTATION_SOURCE_HASHES,
});

export async function measureCurrentGraphProviderImplementation(): Promise<string> {
	const measured = Object.freeze({
		providerAuthority: empiricalSha256(
			await readFile(join(import.meta.dirname, "current-graph-native-provider-authority.ts")),
		),
		providerQualification: empiricalSha256(
			await readFile(join(import.meta.dirname, "current-graph-native-provider-qualification.ts")),
		),
		privateRunner: empiricalSha256(
			await readFile(join(import.meta.dirname, "run-current-graph-native-provider-no-network.ts")),
		),
		d1Authority: empiricalSha256(
			await readFile(join(import.meta.dirname, "current-graph-native-eval-authority.ts")),
		),
		d1ImplementationManifest: empiricalSha256(
			await readFile(
				join(import.meta.dirname, "current-graph-native-eval-implementation-manifest.ts"),
			),
		),
	});
	if (
		JSON.stringify(measured) !== JSON.stringify(CURRENT_GRAPH_PROVIDER_IMPLEMENTATION_SOURCE_HASHES)
	)
		throw new TypeError("current provider implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d2.current-graph-native-provider-implementation-manifest.v1",
		d1BaselineManifestDigest:
			"sha256:6a9151b68dcdcb983d818ec0af9eb3ec6819883ec78a883b012edeae6229bc6d",
		sources: measured,
	});
}
