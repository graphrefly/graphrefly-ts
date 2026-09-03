import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const CURRENT_QUALIFICATION_DIGEST =
	"sha256:5e68f91f6ffabc3a7ca686d900f80f2c4b098d8b35d379c2e8b1075780dd3a8b" as const;
export const CURRENT_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:f7ca9c48948570414613ad70ae76f9790f6d57e7edac5b9837779f0d2af8d872" as const;

// Updated only after the current closure and its no-network qualification are both frozen.
export const CURRENT_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:e495ae9174a54443392d6d76d5780dddca5718efe3368f7b7f9e9f1a2dbfc2b1" as const;

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
		throw new TypeError("root eval D145 implementation runtime drifted");
}

export function measureReleaseInvariantPackageManifest(value: unknown): string {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("root eval package manifest must be an object");
	const manifest = value as Readonly<Record<string, unknown>>;
	if (typeof manifest.version !== "string" || manifest.version.length === 0)
		throw new TypeError("root eval package manifest requires a release version");
	const { version: _releaseVersion, ...behavioralManifest } = manifest;
	return empiricalStrictJsonDigest(behavioralManifest);
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
		revision: "graphrefly-ts.d152.current-implementation-manifest.v72",
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
		"provider-cost-evidence.ts",
		"focused-async-adapters.ts",
		"http-transport-leaf.ts",
		"private-diagnostic-sink.ts",
		"quiet-data-boundary.ts",
		"settled-spend.ts",
		"current-exact-profile.ts",
		"eval-topology-contract.ts",
		"eval-topology.ts",
		"generate-root-eval-artifacts.ts",
		"generate-root-eval-task-manifests.ts",
		"harness-campaign-policy.ts",
		"model-harness-profile-qualification.ts",
		"model-harness-profile.ts",
		"precredential-stage-coordinator.ts",
		"precredential-environment.mjs",
		"root-eval-charter-ledger.ts",
		"root-eval-charter-transaction.ts",
		"root-eval-d152-ledger.ts",
		"provider-qualification.ts",
		"provider-qualification-runner.ts",
		"run-provider-qualification.ts",
		"root-eval-topology-qualification.ts",
		"root-eval-live-authority.ts",
		"root-eval-live-qualification.ts",
		"root-eval-live.ts",
		"recover-d145-interrupted-campaign.ts",
		"recover-d145-source-failure.ts",
		"rollover-d145-charter-ledger.ts",
		"root-eval-task.ts",
		"root-eval-task-manifest-store.ts",
		"run-live-campaign.ts",
		"run-live-campaign-bootstrap.mjs",
		"update-operator-configuration.ts",
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
		sources[`toolchain/${name}`] =
			name === "packages/ts/package.json"
				? measureReleaseInvariantPackageManifest(
						JSON.parse(await readFile(join(repositoryRoot, name), "utf8")),
					)
				: empiricalSha256(await readFile(join(repositoryRoot, name)));
	return Object.freeze(sources);
}
