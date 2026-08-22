import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	D44_BUGGY_ADMISSION_BLOCK,
	D44_FIXED_ADMISSION_BLOCK,
} from "../../evals/empirical-memory-rerun-avoidance/d44-d45-live-composition.js";
import {
	executeD61PublicSemanticScenarios,
	executeD63WithheldSemanticScenario,
} from "../../evals/empirical-memory-rerun-avoidance/d61-public-semantic-scenarios.js";
import {
	D63_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD63Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d63-implementation-manifest.js";

const DIGEST = `sha256:${"d".repeat(64)}`;

async function withCandidate(
	mutate: (source: string) => string,
	run: (workspaceRoot: string) => Promise<void>,
): Promise<void> {
	const repositoryRoot = resolve(import.meta.dirname, "../../../..");
	const workspaceRoot = await mkdtemp(join(tmpdir(), "graphrefly-d63-candidate-"));
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
		const path = join(workspaceRoot, "packages/ts/src/executors/managed-cloud-postgresql.ts");
		await writeFile(path, mutate(await readFile(path, "utf8")), "utf8");
		await run(workspaceRoot);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
}

async function withheld(workspaceRoot: string): Promise<boolean> {
	return (
		await executeD63WithheldSemanticScenario({
			workspaceRoot,
			workspaceStateDigest: DIGEST,
			writeScopePreserved: true,
			timeoutMs: 60_000,
		})
	).passed;
}

describe("graphrefly-ts:D63 withheld behavioral verifier", () => {
	it("freezes the complete D63 implementation closure", async () => {
		expect(await measureD63Implementation()).toBe(D63_IMPLEMENTATION_MANIFEST_DIGEST);
	});

	it("accepts semantic correctness independently of expected source text", async () => {
		const equivalent = D44_FIXED_ADMISSION_BLOCK.replace(
			'assertBoundedAuthorityId(admissionProposalId, "admission proposal coordinate");',
			'assertBoundedAuthorityId(\n\t\tadmissionProposalId,\n\t\t"admission proposal coordinate",\n\t);',
		);
		expect(equivalent).not.toContain(D44_FIXED_ADMISSION_BLOCK);
		await withCandidate(
			(source) => source.replace(D44_FIXED_ADMISSION_BLOCK, equivalent),
			async (workspaceRoot) => expect(await withheld(workspaceRoot)).toBe(true),
		);
	}, 90_000);

	it("rejects the original bug and a public-fixture special case", async () => {
		await withCandidate(
			(source) => source.replace(D44_FIXED_ADMISSION_BLOCK, D44_BUGGY_ADMISSION_BLOCK),
			async (workspaceRoot) => expect(await withheld(workspaceRoot)).toBe(false),
		);

		const publicOnly = D44_FIXED_ADMISSION_BLOCK.replace(
			'assertBoundedAuthorityId(admissionProposalId, "admission proposal coordinate");',
			'if (admissionProposalId !== \'tool-provider-run-admission-proposal:["candidate:run:1"]\') assertSafe(admissionProposalId, "admission proposal coordinate");',
		);
		await withCandidate(
			(source) => source.replace(D44_FIXED_ADMISSION_BLOCK, publicOnly),
			async (workspaceRoot) => {
				const publicResult = await executeD61PublicSemanticScenarios({
					workspaceRoot,
					workspaceStateDigest: DIGEST,
					writeScopePreserved: true,
					timeoutMs: 60_000,
				});
				expect(publicResult.observations.every((value) => value.passed)).toBe(true);
				expect(await withheld(workspaceRoot)).toBe(false);
			},
		);
	}, 180_000);
});
