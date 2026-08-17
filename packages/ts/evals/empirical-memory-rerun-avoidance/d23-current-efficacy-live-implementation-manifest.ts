import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D23_IMPLEMENTATION_FILES = Object.freeze({
	coordinates:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d23-current-efficacy-live-coordinates.ts",
	preflight:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d23-current-efficacy-live-preflight.ts",
	claim: "packages/ts/evals/empirical-memory-rerun-avoidance/d23-current-efficacy-live-claim.ts",
	live: "packages/ts/evals/empirical-memory-rerun-avoidance/d23-current-efficacy-live.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d23-current-efficacy-live-qualification.ts",
	runner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d23-current-efficacy-live-no-network.ts",
	liveRunner: "packages/ts/evals/empirical-memory-rerun-avoidance/run-d23-current-efficacy-live.ts",
	d22Manifest:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d22-current-efficacy-real-provider-implementation-manifest.ts",
	d22Authority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d22-current-efficacy-real-provider-qualification.ts",
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
	preflightPrimitive:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d20-current-live-preflight.ts",
	currentKey:
		"packages/ts/evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.ts",
	persistence:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-private-persistence.ts",
	canonical: "packages/ts/evals/empirical-memory-rerun-avoidance/canonical.ts",
	strictJsonCodec: "packages/ts/src/json/codec.ts",
} as const);

export const D23_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	coordinates: "sha256:9a534e5c941f1f4765fc698903b36211d463c368272aa9ce4e7b3d0ee5084599",
	preflight: "sha256:ff0344add85dce55f46c611491fb031de621da1100e338da19b4cd5cc9ed43c2",
	claim: "sha256:9897f5b72f5c7ef5f8d5f31226329e3cbcd1ca79859d40ec04fff58cd12b5585",
	live: "sha256:4dd364e11a227bd7ba5900966580576ee6c72cf2010c4d13a29be4df1f6a2857",
	qualification: "sha256:3704d7ba4a039592912d77e284206ae2791f765e74e8f3b8f308a825da225d10",
	runner: "sha256:666f3af384226be514c917b683fb14d00291411bd9c272187323638e3e0f1631",
	liveRunner: "sha256:5c974036234bca2b4bd56592e47c9a2e4c717010b671c843c4c664d05529596f",
	d22Manifest: "sha256:12d8a18336e75239ad84561743198aea0b852796fdf5b3d5a56d6de6a5ef8704",
	d22Authority: "sha256:1536e9d0f69f2ab845680c9a799264d19b59b451bc50af87d022efc71bd2c8f3",
	d21Authority: "sha256:60c3462b86c592365166b5919e25d75fbf4659352710c4aea12e2f03d6db4542",
	graphAuthority: "sha256:a3d17b9d96138a2a90dd8ecc265d803c4234bf145bfebc32b8778b8851e01189",
	providerAuthority: "sha256:d40fac8743dff42463aa8bc43c958b9b03da4855e57a5bc28a599fd109b3279b",
	rejectionAuthority: "sha256:59117753f925557b91b9f09d76e8fac5c36bf8e06278fc20f696f5be8c27a798",
	openRouterExecutor: "sha256:4d3247eedb63cf45fca98314031da4b09ef1c7d59b4518a5a95a490988bdabf5",
	liveCoordinates: "sha256:7a91a1654241f2427a72d536070d22bcc6572a87e86c28c8d231fb690cc41745",
	preflightPrimitive: "sha256:d0791cd7dc6a4d774d1049d39764f346b9d75d0b75082e234f20ee8289ed1c07",
	currentKey: "sha256:d14dd8ad79843b8327cdab521db8e67a098077feb272237c9b965a6e6ae5cc6d",
	persistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	strictJsonCodec: "sha256:7fadd889fa5ca55b83a812e67462a48873c50e67d4b9451e7f361e1af8a44ffa",
} as const);

export const D23_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:03f7c391ea786c455b9f60f8212f75f31869a27995c7d409e5a96c7b00b3df3f" as const;

export async function measureD23Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = resolve(repositoryRootValue);
	const measured = Object.freeze(
		Object.fromEntries(
			await Promise.all(
				Object.entries(D23_IMPLEMENTATION_FILES).map(
					async ([key, path]) =>
						[
							key,
							empiricalSha256(new Uint8Array(await readFile(resolve(repositoryRoot, path)))),
						] as const,
				),
			),
		),
	);
	for (const [key, expected] of Object.entries(D23_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[key] !== expected)
			throw new TypeError(`D23 implementation source drifted: ${key}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({ revision: "graphrefly-ts.d23.implementation-manifest.v1", sources: measured }),
	);
}
