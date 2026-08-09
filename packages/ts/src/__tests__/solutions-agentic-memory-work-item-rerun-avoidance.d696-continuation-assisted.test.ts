import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { D695_NO_PROGRESS_CONTINUATION_POLICY } from "../../evals/empirical-memory-rerun-avoidance/d695-no-progress-continuation-qualification.js";
import {
	assertExactD696NoProgressReceiptCoverage,
	commitD696PrivateStagingDirectory,
	D696_D695_IMPLEMENTATION_COMMIT,
	D696_D695_POLICY_DIGEST,
	D696_LIVE_SPEND_APPROVAL_REF,
	D696_LIVE_SPEND_APPROVAL_REVISION,
	failD696PrivateStagingGeneration,
	validateD696D694HistoricalArtifacts,
	validateD696DryRunArtifactBytes,
} from "../../evals/empirical-memory-rerun-avoidance/d696-continuation-assisted-live.js";

describe("D696 continuation-assisted historical transfer evidence", () => {
	it("binds the D697-qualified bounded continuation policy", () => {
		expect(D695_NO_PROGRESS_CONTINUATION_POLICY.maxRetainedBytes).toBe(240_000);
		expect(empiricalStrictJsonDigest(D695_NO_PROGRESS_CONTINUATION_POLICY)).toBe(
			D696_D695_POLICY_DIGEST,
		);
		expect(D696_D695_IMPLEMENTATION_COMMIT).toBe("69a20d0d");
		expect(D696_LIVE_SPEND_APPROVAL_REF).toBeNull();
		expect(D696_LIVE_SPEND_APPROVAL_REVISION).toBeNull();
	});

	it("fails closed on missing historical and integrated dry-run bytes", () => {
		const missing = {
			observationBytes: new Uint8Array(),
			scorecardBytes: new Uint8Array(),
			generationBytes: new Uint8Array(),
		};
		expect(() => validateD696D694HistoricalArtifacts(missing)).toThrow(/historical D694/);
		expect(() => validateD696DryRunArtifactBytes(missing)).toThrow(/dry-run artifact/);
	});

	it("requires one exact terminal receipt for every D695 no-progress rejection", () => {
		const runs = [
			{
				trialStage: "cold" as const,
				steps: 3,
				issueCodes: ["repeated-inspection-turn-no-progress"],
			},
		];
		const receipt = {
			kind: "duplicate-inspection-batch" as const,
			trialStage: "cold" as const,
			stepIndex: 2,
			workspaceStateDigest: `sha256:${"0".repeat(64)}`,
			inspectionBatchDigest: `sha256:${"1".repeat(64)}`,
			disposition: "rejected-before-tool-execution" as const,
		};
		expect(() => assertExactD696NoProgressReceiptCoverage(runs, [receipt])).not.toThrow();
		expect(() => assertExactD696NoProgressReceiptCoverage(runs, [])).toThrow(
			/every terminal rejection/,
		);
		expect(() => assertExactD696NoProgressReceiptCoverage(runs, [receipt, receipt])).toThrow(
			/identity duplicated/,
		);
	});

	it("removes a renamed D696 generation when parent durability confirmation fails", async () => {
		const privateRoot = await mkdtemp(join(tmpdir(), "graphrefly-d696-atomic-"));
		try {
			const stagingPath = join(privateRoot, ".d696-staging-test");
			const finalPath = join(privateRoot, "d696-test-generation");
			await mkdir(stagingPath, { recursive: true, mode: 0o700 });
			await writeFile(join(stagingPath, "generation.v1.json"), "{}", { mode: 0o600 });
			let syncCalls = 0;
			await expect(
				commitD696PrivateStagingDirectory(
					{ stagingPath, finalPath, privateRoot },
					{
						rename,
						rm,
						async syncDirectory() {
							syncCalls += 1;
							if (syncCalls === 1) throw new TypeError("injected D696 parent fsync failure");
						},
					},
				),
			).rejects.toThrow(/injected D696 parent fsync failure/);
			await expect(stat(stagingPath)).rejects.toMatchObject({ code: "ENOENT" });
			await expect(stat(finalPath)).rejects.toMatchObject({ code: "ENOENT" });
			expect(syncCalls).toBe(2);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	});

	it("preserves a D696 staging cleanup failure with the original error", async () => {
		const original = new TypeError("injected D696 staging write failure");
		const cleanup = new TypeError("injected D696 staging cleanup failure");
		await expect(
			failD696PrivateStagingGeneration("/bounded/d696-staging-test", original, async () => {
				throw cleanup;
			}),
		).rejects.toMatchObject({
			message: "D696 atomic private staging cleanup failed",
			errors: [original, cleanup],
		});
	});
});
