import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	commitD694PrivateStagingDirectory,
	D694_FOCUSED_VALIDATION_COMMAND,
	D694_FOCUSED_VALIDATION_COMMAND_DIGEST,
	failD694PrivateStagingGeneration,
	validateD694DryRunArtifactBytes,
	validateD694FocusedValidationReceipt,
} from "../../evals/empirical-memory-rerun-avoidance/d694-assisted-progress-live.js";

describe("D694 assisted historical transfer evidence", () => {
	it("binds the exact focused command and every sanitized validation field", () => {
		expect(empiricalStrictJsonDigest(D694_FOCUSED_VALIDATION_COMMAND)).toBe(
			D694_FOCUSED_VALIDATION_COMMAND_DIGEST,
		);
		const sanitizedResult = strictSnapshot({
			kind: "focused-validation-command" as const,
			commandRef: "actor.d693.focused-validation" as const,
			validationStatus: "passed" as const,
			exitCode: 0,
			stdoutByteLength: 0,
			stderrByteLength: 0,
			stdoutDigest: empiricalStrictJsonDigest({ bytes: "stdout" }),
			stderrDigest: empiricalStrictJsonDigest({ bytes: "stderr" }),
		});
		const receipt = strictSnapshot({
			trialStage: "cold" as const,
			stepIndex: 3,
			actionIndex: 3,
			commandRef: sanitizedResult.commandRef,
			validationStatus: sanitizedResult.validationStatus,
			exitCode: sanitizedResult.exitCode,
			stdoutByteLength: sanitizedResult.stdoutByteLength,
			stderrByteLength: sanitizedResult.stderrByteLength,
			stdoutDigest: sanitizedResult.stdoutDigest,
			stderrDigest: sanitizedResult.stderrDigest,
			resultDigest: empiricalStrictJsonDigest(sanitizedResult),
		});
		expect(validateD694FocusedValidationReceipt(receipt)).toEqual(receipt);
		expect(() =>
			validateD694FocusedValidationReceipt({
				...receipt,
				exitCode: 1,
			}),
		).toThrow(/status does not match/);
		expect(() =>
			validateD694FocusedValidationReceipt({
				...receipt,
				stdoutByteLength: 1,
			}),
		).toThrow(/does not bind/);
	});

	it("fails closed before dispatch on missing or substituted dry-run bytes", () => {
		expect(() =>
			validateD694DryRunArtifactBytes({
				observationBytes: new Uint8Array(),
				scorecardBytes: new Uint8Array(),
				generationBytes: new Uint8Array(),
			}),
		).toThrow(/does not match/);
	});

	it("removes the renamed generation when parent durability confirmation fails", async () => {
		const privateRoot = await mkdtemp(join(tmpdir(), "graphrefly-d694-atomic-"));
		try {
			const staging = join(privateRoot, ".d694-staging-test");
			const finalRoot = join(privateRoot, "d694-test-generation");
			await mkdir(staging, { recursive: true, mode: 0o700 });
			await writeFile(join(staging, "generation.v1.json"), "{}", { mode: 0o600 });
			let syncCalls = 0;
			await expect(
				commitD694PrivateStagingDirectory(
					{ staging, finalRoot, privateRoot },
					{
						rename,
						rm,
						async syncDirectory() {
							syncCalls += 1;
							if (syncCalls === 1) throw new TypeError("injected parent fsync failure");
						},
					},
				),
			).rejects.toThrow(/injected parent fsync failure/);
			await expect(stat(staging)).rejects.toMatchObject({ code: "ENOENT" });
			await expect(stat(finalRoot)).rejects.toMatchObject({ code: "ENOENT" });
			expect(syncCalls).toBe(2);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	});

	it("preserves a pre-commit staging cleanup failure with the original error", async () => {
		const original = new TypeError("injected staging write failure");
		const cleanup = new TypeError("injected staging cleanup failure");
		await expect(
			failD694PrivateStagingGeneration("/bounded/d694-staging-test", original, async () => {
				throw cleanup;
			}),
		).rejects.toMatchObject({
			message: "D694 atomic private staging cleanup failed",
			errors: [original, cleanup],
		});
	});
});
