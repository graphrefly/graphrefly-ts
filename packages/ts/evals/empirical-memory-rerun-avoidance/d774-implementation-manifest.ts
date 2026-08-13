import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	D771_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD771Implementation,
} from "./d771-implementation-manifest.js";

export const D774_IMPLEMENTATION_FILES = Object.freeze({
	providerAuthority: "d774-provider-result-route-authority.ts",
	graphCore: "d774-graph-native-eval.ts",
	qualification: "d774-pre-live-qualification.ts",
	runner: "run-d774-no-network-pre-live.ts",
	routeIntegration: "d734-route-profile-provider-integration.ts",
	routeTurn: "d733-openrouter-graph-turn.ts",
	routeProfile: "d733-graph-native-route-profile.ts",
	providerTurn: "d723-openrouter-graph-turn.ts",
	terminalPolicy: "d725-terminal-http-real-provider.ts",
	terminalEvidence: "d724-terminal-http-evidence.ts",
	providerCore: "d729-provider-block-core.ts",
	transportBinding: "openrouter-responses-model-turn.ts",
} as const);

export const D774_IMPLEMENTATION_SOURCE_SHA256 = Object.freeze({
	providerAuthority: "sha256:794910fa05a6b85443af788d68f8a1c201dd1f3d30bc1f99b1e8094e910e51d3",
	graphCore: "sha256:e29f7350badaa46dcc807d4d24e0b98d0399caaa73bcfbbef03d84d582934ab9",
	qualification: "sha256:880e7173dbf6e1a26fe4173a9dac8c76e470079bb7b228fb2011a069da46b5bf",
	runner: "sha256:268d17d95aed550cc53d2b13e5dbd0b0aefbdf67ea1847d302b3e9abc67344a1",
	routeIntegration: "sha256:d7ebc60e6c94e12f120b6f77d40ca84116f43f2cab2fe288bed82f92b010b3f2",
	routeTurn: "sha256:3ad8d04cfbd91f2641d8d9811ec6efb722569906ee632408787802efa0453029",
	routeProfile: "sha256:9c134ae620765ec87f5a6da05c0222bb71389f49c6d436e76b80d11cac10e0fd",
	providerTurn: "sha256:6fac7319b4dc57b5751bf2e823b6bd2fb88143de84046fbda2f128f48084c926",
	terminalPolicy: "sha256:0ebb190e0e2ab24a61a33ae49ccbb923ff6a717c0bbc78b76b479e3f416d44bd",
	terminalEvidence: "sha256:46c450b1ce057568db79fa5eb595e7c22024833ec034d899c78e9789e690e0e2",
	providerCore: "sha256:ec1a644edb5989315a4a3ec5e6e621786f89b1c9e9493026a91ad7568e1f7cd5",
	transportBinding: "sha256:a128ac4a0c94ad3cfbc23e4fb9fefae849d4fa505ad0630483eb3c03cecac221",
} as const);

export const D774_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:f411c3eb4fabe55e5b6828a7942cb9cdefefd8b609c3e25629ea4d4a0495c908" as const;

export async function measureD774Implementation(): Promise<string> {
	if ((await measureD771Implementation()) !== D771_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D774 D771 implementation baseline drifted");
	const root = dirname(fileURLToPath(import.meta.url));
	const measured: Record<string, string> = {};
	for (const [key, file] of Object.entries(D774_IMPLEMENTATION_FILES))
		measured[key] = empiricalSha256(await readFile(join(root, file)));
	for (const [key, expected] of Object.entries(D774_IMPLEMENTATION_SOURCE_SHA256))
		if (measured[key] !== expected)
			throw new TypeError(`D774 implementation source drifted: ${key}`);
	const material = strictSnapshot({
		decisionRef: "decision.D774.2026-08-13.v1",
		baselineManifestDigest: D771_IMPLEMENTATION_MANIFEST_DIGEST,
		files: D774_IMPLEMENTATION_FILES,
		sourceSha256: D774_IMPLEMENTATION_SOURCE_SHA256,
		nodeVersion: "v24.18.0",
	});
	const digest = empiricalStrictJsonDigest(material);
	if (digest !== D774_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D774 implementation manifest digest drifted");
	return digest;
}
