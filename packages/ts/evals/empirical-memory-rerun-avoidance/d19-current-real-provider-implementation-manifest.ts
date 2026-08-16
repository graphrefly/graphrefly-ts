import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export const D19_IMPLEMENTATION_FILES = Object.freeze({
	adapter:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d19-current-real-provider-adapter.ts",
	qualification:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d19-current-real-provider-qualification.ts",
	runner:
		"packages/ts/evals/empirical-memory-rerun-avoidance/run-d19-current-real-provider-no-network.ts",
	d18Authority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d18-current-provider-composition-authority.ts",
	d18Adapter:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d18-current-injected-provider-adapter.ts",
	d17Authority:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d17-current-efficacy-authority.ts",
	publicSemantic:
		"packages/ts/evals/empirical-memory-rerun-avoidance/current-managed-cloud-public-semantic-validation.ts",
	canonical: "packages/ts/evals/empirical-memory-rerun-avoidance/canonical.ts",
	persistence:
		"packages/ts/evals/empirical-memory-rerun-avoidance/d6-current-private-persistence.ts",
} as const);

export const D19_IMPLEMENTATION_SOURCE_DIGESTS = Object.freeze({
	adapter: "sha256:2e589080df0b20b02a74315a87e57496af8b408116bc90e3202c577bed978b34",
	qualification: "sha256:ca952a1841940005e4147cb45f7cb451a15d6fad093b2ff54783cf6ebb98cebe",
	runner: "sha256:563225066fb018cfd12006637932fc68ba2550baf9885de113a21f2243b073d1",
	d18Authority: "sha256:1bf76aae08abe39170126e330ab0a99ce463d96963f6c52d92cb3d35b965c7eb",
	d18Adapter: "sha256:5081dbe4450f2a04b021b835fa5e55b8244614dff60f71401fec3655986c67de",
	d17Authority: "sha256:567937fc4feb0370f4b93fd68fa1d9098dcd723034971c823876f8da73a8cc33",
	publicSemantic: "sha256:5707b5dffaae53f566ba89987a59dc1da62fca5c03bb2fa020a1b8d018de8b50",
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	persistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
} as const);

export const D19_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:ec1363d8a6b81a8dfad9d79ce79e9c71d0743a9655cc3409a922110c47f1a317" as const;

export async function measureD19Implementation(repositoryRootValue: string): Promise<string> {
	const repositoryRoot = resolve(repositoryRootValue);
	const measuredEntries = await Promise.all(
		Object.entries(D19_IMPLEMENTATION_FILES).map(async ([key, path]) => {
			const bytes = new Uint8Array(await readFile(resolve(repositoryRoot, path)));
			return [key, empiricalSha256(bytes)] as const;
		}),
	);
	const measured = Object.freeze(Object.fromEntries(measuredEntries));
	for (const [key, expected] of Object.entries(D19_IMPLEMENTATION_SOURCE_DIGESTS))
		if (measured[key] !== expected)
			throw new TypeError(`D19 implementation source drifted: ${key}`);
	return empiricalStrictJsonDigest(
		strictSnapshot({ revision: "graphrefly-ts.d19.implementation-manifest.v1", sources: measured }),
	);
}
