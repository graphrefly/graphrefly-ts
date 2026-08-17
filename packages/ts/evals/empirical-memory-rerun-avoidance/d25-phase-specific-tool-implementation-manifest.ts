import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D25_IMPLEMENTATION_FILES = Object.freeze({
	authority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d25-phase-specific-tool-admission.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d25-phase-specific-tool-qualification.ts",
	runner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d25-phase-specific-tool-no-network.ts",
	graphAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d5-graph-native-eval-authority.ts",
	providerAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-provider-authority.ts",
	rejectionAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d9-current-provider-rejection-authority.ts",
	recoveryAuthority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d21-current-efficacy-recovery-authority.ts",
	baselineValidator:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d23-current-efficacy-live.ts",
	canonical: "packages/ts/evals/empirical-memory-rerun-avoidance/canonical.ts",
	strictJsonCodec: "packages/ts/src/json/codec.ts",
} as const);

export const D25_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	authority: "sha256:3a0ab0d2d036a80b2e356a57397d68dbe8466560040646098dc64789e309bb24",
	qualification: "sha256:c74f403e7b1f855f2bcf18df9c1a988cce4e177abb8b35cd7dc75107dbe143ae",
	runner: "sha256:a2e2c969568663945f69547bcc14d887adb0a10c0bf0d480f00a066d77074955",
	graphAuthority: "sha256:a3d17b9d96138a2a90dd8ecc265d803c4234bf145bfebc32b8778b8851e01189",
	providerAuthority: "sha256:d40fac8743dff42463aa8bc43c958b9b03da4855e57a5bc28a599fd109b3279b",
	rejectionAuthority: "sha256:59117753f925557b91b9f09d76e8fac5c36bf8e06278fc20f696f5be8c27a798",
	recoveryAuthority: "sha256:60c3462b86c592365166b5919e25d75fbf4659352710c4aea12e2f03d6db4542",
	baselineValidator: "sha256:4dd364e11a227bd7ba5900966580576ee6c72cf2010c4d13a29be4df1f6a2857",
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	strictJsonCodec: "sha256:7fadd889fa5ca55b83a812e67462a48873c50e67d4b9451e7f361e1af8a44ffa",
} as const);

export const D25_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:ee52e06601e4c4c8795e7f168c66391bfb034dc686bc1a223488a48912e7c850" as const;

export async function measureD25Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = resolve(repositoryRootValue);
	const measured = Object.freeze(
		Object.fromEntries(
			await Promise.all(
				Object.entries(D25_IMPLEMENTATION_FILES).map(async ([key, path]) => [
					key,
					empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path)))),
				]),
			),
		),
	);
	for (const [key, expected] of Object.entries(D25_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[key] !== expected)
			throw new TypeError(`D25 implementation source drifted: ${key}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({ revision: "graphrefly-ts.d25.implementation-manifest.v1", sources: measured }),
	);
}
