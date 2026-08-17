import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D26_IMPLEMENTATION_FILES = Object.freeze({
	composition:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d26-phase-specific-real-provider-composition.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d26-phase-specific-real-provider-qualification.ts",
	runner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d26-phase-specific-real-provider-no-network.ts",
	d25Authority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d25-phase-specific-tool-admission.ts",
	d25Qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d25-phase-specific-tool-qualification.ts",
	d25Manifest:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d25-phase-specific-tool-implementation-manifest.ts",
	providerAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-provider-authority.ts",
	rejectionAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d9-current-provider-rejection-authority.ts",
	recoveryAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d21-current-efficacy-recovery-authority.ts",
	openRouterAdapter:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d8-current-openrouter-adapter.ts",
	realWorkspaceFixture:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d22-current-efficacy-real-provider-qualification.ts",
	coordinates: "packages/ts/evals/empirical-memory-rerun-avoidance/d8-current-live-coordinates.ts",
	privatePersistence:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-private-persistence.ts",
	canonical: "packages/ts/evals/empirical-memory-rerun-avoidance/canonical.ts",
	strictJsonCodec: "packages/ts/src/json/codec.ts",
} as const);

export const D26_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	composition: "sha256:f03f0a1804b2f9c554155ee450e03d5ef44613409c830f18192e5e95c3174d12",
	qualification: "sha256:cd9f6ccb7d4f377b9f79093f1275d029696460495730a9aeba6b998e165aaa63",
	runner: "sha256:bc2836d28e600fd5eefb7153602586a94c7b3816963ab93133b56a17ee81dd81",
	d25Authority: "sha256:3a0ab0d2d036a80b2e356a57397d68dbe8466560040646098dc64789e309bb24",
	d25Qualification: "sha256:c74f403e7b1f855f2bcf18df9c1a988cce4e177abb8b35cd7dc75107dbe143ae",
	d25Manifest: "sha256:c4e0d23f18644866d3d1d2a949cea30fa20a30f8c8fa9afa7c8fb8a1bec0da7f",
	providerAuthority: "sha256:d40fac8743dff42463aa8bc43c958b9b03da4855e57a5bc28a599fd109b3279b",
	rejectionAuthority: "sha256:59117753f925557b91b9f09d76e8fac5c36bf8e06278fc20f696f5be8c27a798",
	recoveryAuthority: "sha256:60c3462b86c592365166b5919e25d75fbf4659352710c4aea12e2f03d6db4542",
	openRouterAdapter: "sha256:4d3247eedb63cf45fca98314031da4b09ef1c7d59b4518a5a95a490988bdabf5",
	realWorkspaceFixture: "sha256:1536e9d0f69f2ab845680c9a799264d19b59b451bc50af87d022efc71bd2c8f3",
	coordinates: "sha256:7a91a1654241f2427a72d536070d22bcc6572a87e86c28c8d231fb690cc41745",
	privatePersistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	strictJsonCodec: "sha256:7fadd889fa5ca55b83a812e67462a48873c50e67d4b9451e7f361e1af8a44ffa",
} as const);

export const D26_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:58dbe33cd14cfa26095df5505d436090488c2157e0706a562eb3f479baee5b41" as const;

export async function measureD26Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = resolve(repositoryRootValue);
	const measured = Object.freeze(
		Object.fromEntries(
			await Promise.all(
				Object.entries(D26_IMPLEMENTATION_FILES).map(async ([key, path]) => [
					key,
					empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path)))),
				]),
			),
		),
	);
	for (const [key, expected] of Object.entries(D26_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[key] !== expected)
			throw new TypeError(`D26 implementation source drifted: ${key}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({ revision: "graphrefly-ts.d26.implementation-manifest.v1", sources: measured }),
	);
}
