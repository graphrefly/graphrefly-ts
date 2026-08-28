import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";

export const CURRENT_QUALIFICATION_DIGEST =
	"sha256:8cf4c81dbfcfd8406ae97aaf63ca5dba319c35b53939a9cba25c1c641e2865d0" as const;
export const CURRENT_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:c6f66e8e62d9d74e2bbb3b4b931ce68b1a7a529944bd6c8eb9dce413a784a5d9" as const;

// Updated only after the current closure and its no-network qualification are both frozen.
export const CURRENT_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:ac1e8bc628590f8786074b8c72740fc9f21ab9568692fabc8ac31c01b9afdb4f" as const;

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
		revision: "graphrefly-ts.d147.current-implementation-manifest.v47",
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
		"generate-root-eval-task-manifests.ts",
		"harness-campaign-policy.ts",
		"model-harness-profile-qualification.ts",
		"model-harness-profile.ts",
		"precredential-stage-coordinator.ts",
		"precredential-environment.mjs",
		"root-eval-charter-ledger.ts",
		"root-eval-charter-transaction.ts",
		"root-eval-topology-qualification.ts",
		"root-eval-live-authority.ts",
		"root-eval-live-qualification.ts",
		"root-eval-live.ts",
		"root-eval-task.ts",
		"root-eval-task-manifest-store.ts",
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
