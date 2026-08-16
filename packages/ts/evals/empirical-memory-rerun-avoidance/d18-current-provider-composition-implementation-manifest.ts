import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D18_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	authority: "sha256:1bf76aae08abe39170126e330ab0a99ce463d96963f6c52d92cb3d35b965c7eb",
	adapter: "sha256:5081dbe4450f2a04b021b835fa5e55b8244614dff60f71401fec3655986c67de",
	qualification: "sha256:802c0b1ed2eb1e4aa42a4e3ab64cd0615214fbfee2f1ce18f146b77ce0b1a993",
	runner: "sha256:7b422c1253bc37ca51acdf84e6a8130e758e5fe990b0c7668fa4d949eae71737",
	d17Authority: "sha256:567937fc4feb0370f4b93fd68fa1d9098dcd723034971c823876f8da73a8cc33",
	d17Qualification: "sha256:a6f92236a533dc4290cd3266fa1c07152f236c845f31e4fab6c7ea0df1cd8940",
	canonical: "sha256:87423a4ca6d27a1334bd920325a6ac75108d6e88a5cd09d951165ef3717ba22a",
	persistence: "sha256:0563c15908914694df6d2b80aba11840ce8f91f2c63f6ed2c97c2e5f3dc8a113",
});

export const D18_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d18.current-provider-composition-implementation-manifest.v1",
	sources: D18_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	authority: "d18-current-provider-composition-authority.ts",
	adapter: "d18-current-injected-provider-adapter.ts",
	qualification: "d18-current-provider-composition-qualification.ts",
	runner: "run-d18-current-provider-no-network.ts",
	d17Authority: "d17-current-efficacy-authority.ts",
	d17Qualification: "d17-current-pre-live-qualification.ts",
	canonical: "canonical.ts",
	persistence: "d6-current-private-persistence.ts",
});

export async function measureD18Implementation(repositoryRoot: string): Promise<string> {
	const evalRoot = join(repositoryRoot, "packages/ts/evals/empirical-memory-rerun-avoidance");
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(FILES).map(async ([key, file]) => [
				key,
				empiricalSha256(await readFile(join(evalRoot, file))),
			]),
		),
	) as Record<keyof typeof FILES, string>;
	if (JSON.stringify(measured) !== JSON.stringify(D18_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D18 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d18.current-provider-composition-implementation-manifest.v1",
		sources: measured,
	});
}
