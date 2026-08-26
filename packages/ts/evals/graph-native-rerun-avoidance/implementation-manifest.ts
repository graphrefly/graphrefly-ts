import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const CURRENT_QUALIFICATION_DIGEST =
	"sha256:1f13678ed0dbaa3291f38847fca33cd54cf61cafd73eeae6c950fdc2ed483cc0" as const;
export const CURRENT_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:cd48cb3d276abcdc5fb789cca1a755cbb8a6abe530b53e3a69f14577c6972fe8" as const;

// Updated only after the current closure and its no-network qualification are both frozen.
export const CURRENT_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:558dd06bcad4ffa9f88982da4c661280dbcb82341b99ba7cf54a3230bb3a6465" as const;

export const CURRENT_IMPLEMENTATION_RUNTIME = Object.freeze({
	node: "v24.18.0" as const,
	platform: "darwin" as const,
	arch: "arm64" as const,
});

export function assertCurrentImplementationRuntime(): void {
	const runtime = Reflect.get(globalThis, "process") as NodeJS.Process;
	if (
		runtime.version !== CURRENT_IMPLEMENTATION_RUNTIME.node ||
		runtime.platform !== CURRENT_IMPLEMENTATION_RUNTIME.platform ||
		runtime.arch !== CURRENT_IMPLEMENTATION_RUNTIME.arch
	)
		throw new TypeError("root eval D125 implementation runtime drifted");
}

async function listRuntimeSources(root: string, directory: string): Promise<readonly string[]> {
	const names: string[] = [];
	for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) names.push(...(await listRuntimeSources(root, path)));
		else if (entry.isFile() && entry.name.endsWith(".ts")) names.push(relative(root, path));
	}
	return names;
}

export async function measureCurrentImplementation(): Promise<string> {
	const sources = await measureCurrentImplementationInputs();
	return empiricalStrictJsonDigest({
		revision: "graphrefly-ts.d125.current-implementation-manifest.v23",
		runtime: CURRENT_IMPLEMENTATION_RUNTIME,
		sources,
	});
}

export async function measureCurrentImplementationInputs(): Promise<
	Readonly<Record<string, string>>
> {
	const repositoryRoot = resolve(import.meta.dirname, "../../../..");
	const names = [
		"canonical.ts",
		"current-exact-profile.ts",
		"eval-topology-contract.ts",
		"eval-topology.ts",
		"generate-root-eval-artifacts.ts",
		"harness-campaign-policy.ts",
		"model-harness-profile-qualification.ts",
		"model-harness-profile.ts",
		"precredential-environment.mjs",
		"qualify-live-private-inputs.ts",
		"root-eval-topology-qualification.ts",
		"root-eval-live-authority.ts",
		"root-eval-live-qualification.ts",
		"root-eval-live.ts",
		"run-live-campaign.ts",
		"run-live-campaign-bootstrap.mjs",
	] as const;
	const sources: Record<string, string> = {};
	for (const name of names)
		sources[name] = empiricalSha256(await readFile(join(import.meta.dirname, name)));
	for (const testName of [
		"model-harness-profile-current.test.ts",
		"solutions-agentic-memory-work-item-root-eval-live.test.ts",
		"solutions-agentic-memory-work-item-root-eval-topology.test.ts",
	] as const)
		sources[`tests/${testName}`] = empiricalSha256(
			await readFile(join(import.meta.dirname, "../../src/__tests__", testName)),
		);
	// D76 executes the actual Graph, Work Item and Agentic Memory package source, and
	// the semantic verifiers run through the workspace toolchain. Bind that runtime
	// closure instead of claiming that the eval-local adapter alone is sufficient.
	for (const name of await listRuntimeSources(
		repositoryRoot,
		join(repositoryRoot, "packages/ts/src"),
	))
		sources[`runtime/${name}`] = empiricalSha256(await readFile(join(repositoryRoot, name)));
	for (const name of [
		"package.json",
		"pnpm-lock.yaml",
		"pnpm-workspace.yaml",
		"packages/ts/package.json",
		"packages/ts/tsconfig.json",
		"packages/ts/tsconfig.tests.json",
		"packages/ts/vitest.config.ts",
	] as const)
		sources[`toolchain/${name}`] = empiricalSha256(await readFile(join(repositoryRoot, name)));
	return Object.freeze(sources);
}
