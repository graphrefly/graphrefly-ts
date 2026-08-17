import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D22_IMPLEMENTATION_FILES = Object.freeze({
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d22-current-efficacy-real-provider-qualification.ts",
	runner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d22-current-efficacy-real-provider-no-network.ts",
	d21Authority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d21-current-efficacy-recovery-authority.ts",
	graphAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d5-graph-native-eval-authority.ts",
	providerAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-provider-authority.ts",
	rejectionAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d9-current-provider-rejection-authority.ts",
	openRouterExecutor:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d8-current-openrouter-adapter.ts",
	liveCoordinates:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d8-current-live-coordinates.ts",
	persistence:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-private-persistence.ts",
	canonical: "packages/ts/evals/empirical-memory-rerun-avoidance/canonical.ts",
	strictJsonCodec: "packages/ts/src/json/codec.ts",
} as const);

export const D22_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	qualification: "sha256:1536e9d0f69f2ab845680c9a799264d19b59b451bc50af87d022efc71bd2c8f3",
	runner: "sha256:f4631368e6c205e3352e2475422273f2f8ce3f9de11f5b3b0a1c7809285e810e",
	d21Authority: "sha256:60c3462b86c592365166b5919e25d75fbf4659352710c4aea12e2f03d6db4542",
	graphAuthority: "sha256:a3d17b9d96138a2a90dd8ecc265d803c4234bf145bfebc32b8778b8851e01189",
	providerAuthority: "sha256:d40fac8743dff42463aa8bc43c958b9b03da4855e57a5bc28a599fd109b3279b",
	rejectionAuthority: "sha256:59117753f925557b91b9f09d76e8fac5c36bf8e06278fc20f696f5be8c27a798",
	openRouterExecutor: "sha256:4d3247eedb63cf45fca98314031da4b09ef1c7d59b4518a5a95a490988bdabf5",
	liveCoordinates: "sha256:7a91a1654241f2427a72d536070d22bcc6572a87e86c28c8d231fb690cc41745",
	persistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	strictJsonCodec: "sha256:7fadd889fa5ca55b83a812e67462a48873c50e67d4b9451e7f361e1af8a44ffa",
} as const);

export const D22_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:131e279b0d280c83c9bb6f194d57cf47f16e89301792d00e38000885ff1c332a" as const;

export async function measureD22Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = resolve(repositoryRootValue);
	const measured = Object.freeze(
		Object.fromEntries(
			await Promise.all(
				Object.entries(D22_IMPLEMENTATION_FILES).map(
					async ([key, path]) =>
						[
							key,
							empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path)))),
						] as const,
				),
			),
		),
	);
	for (const [key, expected] of Object.entries(D22_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[key] !== expected)
			throw new TypeError(`D22 implementation source drifted: ${key}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({ revision: "graphrefly-ts.d22.implementation-manifest.v1", sources: measured }),
	);
}
