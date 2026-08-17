import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D20_IMPLEMENTATION_FILES = Object.freeze({
	coordinates: "packages/ts/evals/empirical-memory-rerun-avoidance/d20-current-live-coordinates.ts",
	preflight: "packages/ts/evals/empirical-memory-rerun-avoidance/d20-current-live-preflight.ts",
	claim: "packages/ts/evals/empirical-memory-rerun-avoidance/d20-current-live-claim.ts",
	live: "packages/ts/evals/empirical-memory-rerun-avoidance/d20-current-live.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d20-current-live-qualification.ts",
	runner: "packages/ts/evals/empirical-memory-rerun-avoidance/run-d20-current-no-network.ts",
	liveRunner: "packages/ts/evals/empirical-memory-rerun-avoidance/run-d20-live.ts",
	d19Adapter:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d19-current-real-provider-adapter.ts",
	d19Qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d19-current-real-provider-qualification.ts",
	d18Authority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d18-current-provider-composition-authority.ts",
	d18Adapter:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d18-current-injected-provider-adapter.ts",
	d17Authority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d17-current-efficacy-authority.ts",
	publicSemantic:
		"packages/ts/evals/empirical-memory-rerun-avoidance/current-managed-cloud-public-semantic-validation.ts",
	currentKey:
		"packages/ts/evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.ts",
	persistence:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-private-persistence.ts",
	canonical: "packages/ts/evals/empirical-memory-rerun-avoidance/canonical.ts",
} as const);

export const D20_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	coordinates: "sha256:f369eecc74bb984b2363258090f424ff2707468acc96558f21b8b8590265a0d4",
	preflight: "sha256:d0791cd7dc6a4d774d1049d39764f346b9d75d0b75082e234f20ee8289ed1c07",
	claim: "sha256:b3dec64ad2709a19fb39d202e73c50b7dcf80b122d538d07050298449ab571d1",
	live: "sha256:e4c67aa81dcfafb7caaf179db4610a7bc9c3cc25ac5a7e08b53b3d2b6b8e2cf9",
	qualification: "sha256:90004f9f3a8a1c6f0ceaab1524d2b801b353afc540a2a99ddd1ff4be654699de",
	runner: "sha256:262abb0b1a75577c749a6260d498d436717af84607528f04a61f99e870bacae3",
	liveRunner: "sha256:f06b6ee8ce2bf881544ee4ccfe4e5801b9f5803c3cf22de491461582b0b292b0",
	d19Adapter: "sha256:2e589080df0b20b02a74315a87e57496af8b408116bc90e3202c577bed978b34",
	d19Qualification: "sha256:ca952a1841940005e4147cb45f7cb451a15d6fad093b2ff54783cf6ebb98cebe",
	d18Authority: "sha256:1bf76aae08abe39170126e330ab0a99ce463d96963f6c52d92cb3d35b965c7eb",
	d18Adapter: "sha256:5081dbe4450f2a04b021b835fa5e55b8244614dff60f71401fec3655986c67de",
	d17Authority: "sha256:567937fc4feb0370f4b93fd68fa1d9098dcd723034971c823876f8da73a8cc33",
	publicSemantic: "sha256:5707b5dffaae53f566ba89987a59dc1da62fca5c03bb2fa020a1b8d018de8b50",
	currentKey: "sha256:d14dd8ad79843b8327cdab521db8e67a098077feb272237c9b965a6e6ae5cc6d",
	persistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
} as const);

export const D20_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:19c066e5f3b3d719abea1b12c39383d43f827846c7618801e5189f255dc40a33" as const;

export async function measureD20Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = resolve(repositoryRootValue);
	const measured = Object.freeze(
		Object.fromEntries(
			await Promise.all(
				Object.entries(D20_IMPLEMENTATION_FILES).map(
					async ([key, path]) =>
						[
							key,
							empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path)))),
						] as const,
				),
			),
		),
	);
	for (const [key, expected] of Object.entries(D20_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[key] !== expected)
			throw new TypeError(`D20 implementation source drifted: ${key}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({ revision: "graphrefly-ts.d20.implementation-manifest.v1", sources: measured }),
	);
}
