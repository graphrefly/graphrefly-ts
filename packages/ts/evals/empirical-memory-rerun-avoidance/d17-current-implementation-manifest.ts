import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const D17_IMPLEMENTATION_SOURCE_HASHES = Object.freeze({
	authority: "sha256:567937fc4feb0370f4b93fd68fa1d9098dcd723034971c823876f8da73a8cc33",
	adapter: "sha256:33a2a9102a00413cf5b3ef8f17eb940038f5ded88cb71d67075621b948e3830f",
	qualification: "sha256:a6f92236a533dc4290cd3266fa1c07152f236c845f31e4fab6c7ea0df1cd8940",
	runner: "sha256:1fad7504bdc1488976e93bce3f3ffb958faefa674d43a3b02d7b9e2a9bdb0022",
});

export const D17_IMPLEMENTATION_MANIFEST_DIGEST = empiricalStrictJsonDigest({
	revision: "graphrefly-ts.d17.current-efficacy-implementation-manifest.v1",
	sources: D17_IMPLEMENTATION_SOURCE_HASHES,
});

const FILES = Object.freeze({
	authority: "d17-current-efficacy-authority.ts",
	adapter: "d17-current-injected-adapter.ts",
	qualification: "d17-current-pre-live-qualification.ts",
	runner: "run-d17-current-no-network.ts",
});

export async function measureD17Implementation(repositoryRoot: string): Promise<string> {
	const evalRoot = join(repositoryRoot, "packages/ts/evals/empirical-memory-rerun-avoidance");
	const measured = Object.fromEntries(
		await Promise.all(
			Object.entries(FILES).map(async ([key, file]) => [
				key,
				empiricalSha256(await readFile(join(evalRoot, file))),
			]),
		),
	) as Record<keyof typeof FILES, string>;
	if (JSON.stringify(measured) !== JSON.stringify(D17_IMPLEMENTATION_SOURCE_HASHES))
		throw new TypeError("D17 implementation source drifted");
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d17.current-efficacy-implementation-manifest.v1",
		sources: measured,
	});
}
