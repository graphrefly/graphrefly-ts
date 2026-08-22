import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	D61_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD61Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d61-implementation-manifest.js";
import { executeD61PublicSemanticScenarios } from "../../evals/empirical-memory-rerun-avoidance/d61-public-semantic-scenarios.js";
import {
	runD61InjectedNoNetworkQualification,
	validateD61QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d61-semantic-recovery-qualification.js";

describe("graphrefly-ts:D61 independent semantic evidence and bounded recovery", () => {
	it("qualifies the complete current Graph-native real composition without network", async () => {
		const bundle = validateD61QualificationBundle(await runD61InjectedNoNetworkQualification());
		expect(bundle.qualification.independentPublicSemanticEvidenceQualified).toBe(true);
		expect(bundle.qualification.boundedFreshMutationCorrectionQualified).toBe(true);
		expect(bundle.qualification.providerBoundaryFailureClosureQualified).toBe(true);
		expect(bundle.qualification.realWorktreeSixArmsQualified).toBe(true);
		expect(bundle.qualification.providerNetworkCalls).toBe(0);
		expect(await measureD61Implementation()).toBe(D61_IMPLEMENTATION_MANIFEST_DIGEST);
	}, 600_000);

	it("rejects candidate imports that escape the frozen semantic snapshot before execution", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const workspaceRoot = await mkdtemp(join(tmpdir(), "graphrefly-d61-import-escape-"));
		try {
			await mkdir(join(workspaceRoot, "packages/ts"), { recursive: true });
			await cp(join(repositoryRoot, "packages/ts/src"), join(workspaceRoot, "packages/ts/src"), {
				recursive: true,
			});
			await cp(
				join(repositoryRoot, "packages/ts/package.json"),
				join(workspaceRoot, "packages/ts/package.json"),
			);
			await cp(join(repositoryRoot, "package.json"), join(workspaceRoot, "package.json"));
			const candidatePath = join(
				workspaceRoot,
				"packages/ts/src/executors/managed-cloud-postgresql.ts",
			);
			const escapedImport = join(
				repositoryRoot,
				"packages/ts/evals/empirical-memory-rerun-avoidance/d43-model-harness-policy.ts",
			);
			await writeFile(
				candidatePath,
				`${await readFile(candidatePath, "utf8")}\nimport ${JSON.stringify(escapedImport)};\n`,
			);
			await expect(
				executeD61PublicSemanticScenarios({
					workspaceRoot,
					workspaceStateDigest: `sha256:${"a".repeat(64)}`,
					writeScopePreserved: true,
					timeoutMs: 60_000,
				}),
			).rejects.toThrow(/semantic coordinator failed closed/);
		} finally {
			await rm(workspaceRoot, { recursive: true, force: true });
		}
	}, 90_000);

	it("bounds snapshot, bundle, scenarios, reconciliation, and cleanup with one supervisor deadline", async () => {
		const started = performance.now();
		await expect(
			executeD61PublicSemanticScenarios({
				workspaceRoot: resolve(import.meta.dirname, "../../../.."),
				workspaceStateDigest: `sha256:${"b".repeat(64)}`,
				writeScopePreserved: true,
				timeoutMs: 1_000,
			}),
		).rejects.toThrow(/coordinator exceeded Graph deadline/);
		expect(performance.now() - started).toBeLessThan(2_500);
	}, 5_000);
});
