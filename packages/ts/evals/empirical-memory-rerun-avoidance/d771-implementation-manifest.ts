import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

const SOURCES = Object.freeze({
	lowering: "./d771-criterion-continuation-lowering.ts",
	loweringEvidence: "./d771-lowering-evidence-authority.ts",
	gate: "./d771-arm-aware-positive-gate.ts",
	qualification: "./d771-pre-live-qualification.ts",
	runner: "./run-d771-no-network-pre-live.ts",
	graphLedger: "./d767-clean-graph-ledger.ts",
	graphRuntime: "./d767-graph-native-effect-runtime.ts",
	graphProjection: "./d771-graph-completion-memory-insight.ts",
	graphProjectionBaseline: "./d767-graph-completion-memory-insight.ts",
	graphEval: "./d767-graph-native-eval.ts",
	semanticPolicy: "./d761-public-semantic-validation-qualification.ts",
	namedToolBaseline: "./d756-graph-named-tool-continuation.ts",
	routeIntegration: "./d734-route-profile-provider-integration.ts",
	routeProfile: "./d733-graph-native-route-profile.ts",
	routeCoordinates: "./d733-coordinates.ts",
	providerTurn: "./d723-openrouter-graph-turn.ts",
} as const);

export const D771_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	lowering: "sha256:c1627450446625918c1c59e0be77ed6a4d700093adde3b9daa94a220fc50b107",
	loweringEvidence: "sha256:3ec8bc4f140dc8598f864ec20b136aa356959dcff76297132bf7d7de85ecdae2",
	gate: "sha256:7e349a420fe18be6e058887c1b3131bf04108751c41ed30683e976e459394097",
	qualification: "sha256:b8cd12f4bc33146cded2e9a8f3b1fc66fa5d016ba12fb557a2af55873f0920bd",
	runner: "sha256:38c2bfc19f576437915384603cb284f25bcc24b3abbea72f9a348377b3c6c48f",
	graphLedger: "sha256:cbfadd5e999fbe845bf859e1e4f291e571394dee274e675d00d55b028694e8fb",
	graphRuntime: "sha256:a5b613827d037a78cc39f9185816ae54a131b5c8734622ad3bf5103c9afac9cb",
	graphProjection: "sha256:1b3ac705988a9d1cb9d00bf0a7078415e06293f2f139a23d72703995243db80b",
	graphProjectionBaseline:
		"sha256:58b2d3464022672e6c7a13cf1993636ba2541a8dcea4547b28dbffb8dba89012",
	graphEval: "sha256:135ab4aa9f6b6e293cc37b8dd45895dd46d69b29b7f3acc0679d03a012bbd226",
	semanticPolicy: "sha256:c03ba69d4b07550b0d9b6628539d8f80cd51d24cb2a20e9f4160c5a1c2782083",
	namedToolBaseline: "sha256:95dce829d31319a4de03f81f60057f7668de4111b9f0300e9fd1728af1aee95f",
	routeIntegration: "sha256:d7ebc60e6c94e12f120b6f77d40ca84116f43f2cab2fe288bed82f92b010b3f2",
	routeProfile: "sha256:9c134ae620765ec87f5a6da05c0222bb71389f49c6d436e76b80d11cac10e0fd",
	routeCoordinates: "sha256:5b48febd1f81a7e8d70254b05c5b55032f5ff2b9f209932376202cdcfd4b8bfd",
	providerTurn: "sha256:6fac7319b4dc57b5751bf2e823b6bd2fb88143de84046fbda2f128f48084c926",
} as const);

export const D771_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:6b3a371bc57a4d84b6a3b8adbfb96b4e8440ed314ec073fa020e71e0a0bd79f0" as const;

export async function measureD771Implementation(): Promise<string> {
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(SOURCES).map(async ([key, relative]) => [
				key,
				empiricalSha256(await readFile(fileURLToPath(new URL(relative, import.meta.url)))),
			]),
		),
	);
	if (
		Object.entries(D771_IMPLEMENTATION_SOURCE_DIGESTS).some(
			([key, expected]) => measured[key] !== expected,
		)
	)
		throw new TypeError("D771 implementation source drifted");
	const manifest = strictSnapshot({
		revision: "graphrefly.b112.d771.implementation-manifest.v1",
		sources: measured,
	});
	return empiricalStrictJsonDigest(manifest);
}
