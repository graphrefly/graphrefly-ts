import { chmod, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createD704PreflightCapability,
	D704_APPROVAL_REF,
	D704_APPROVAL_REVISION,
	D704_CLAIM_BOUNDARY,
	D704_PRICING_REVISION,
} from "../../evals/empirical-memory-rerun-avoidance/d704-mutation-first-live.js";
import {
	acquireD704SingleUseDispatchClaimAtPrivateRoot,
	consumeD704SingleUseDispatchClaim,
	consumePersistedD704DispatchClaimForExecutionAtPrivateRoot,
	D704_LIVE_GENERATION_REF,
	D704_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY,
} from "../../evals/empirical-memory-rerun-avoidance/d704-single-use-dispatch-claim.js";

async function createPrivateTestRoot(): Promise<{
	readonly container: string;
	readonly privateRoot: string;
}> {
	const container = await mkdtemp(join(tmpdir(), "graphrefly-d704-claim-"));
	const privateRoot = join(container, ".private", "empirical-memory-rerun-avoidance");
	await mkdir(privateRoot, { recursive: true, mode: 0o700 });
	await chmod(privateRoot, 0o700);
	return { container, privateRoot };
}

describe("D704 mutation-first live authority", () => {
	it("freezes the exact live approval without efficacy attribution", () => {
		expect(D704_APPROVAL_REF).toBe("decision.D704");
		expect(D704_APPROVAL_REVISION).toBe("decision.D704.2026-08-09.v1");
		expect(D704_CLAIM_BOUNDARY).toContain("no-efficacy-claim");
		expect(D704_PRICING_REVISION).toContain("2026-08-09");
		expect(D704_LIVE_GENERATION_REF).toContain("d704");
	});

	it("atomically permits only one cross-process-shaped D704 dispatch contender", async () => {
		const { container, privateRoot } = await createPrivateTestRoot();
		try {
			const results = await Promise.allSettled([
				acquireD704SingleUseDispatchClaimAtPrivateRoot(privateRoot),
				acquireD704SingleUseDispatchClaimAtPrivateRoot(privateRoot),
			]);
			expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
			expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
			const acquired = results.find(
				(
					result,
				): result is PromiseFulfilledResult<
					Awaited<ReturnType<typeof acquireD704SingleUseDispatchClaimAtPrivateRoot>>
				> => result.status === "fulfilled",
			)?.value;
			expect(acquired).toBeDefined();
			expect(() => consumeD704SingleUseDispatchClaim(acquired)).not.toThrow();
			expect(() => consumeD704SingleUseDispatchClaim(acquired)).toThrow(/single-use claim/);
			const persistedExecution =
				await consumePersistedD704DispatchClaimForExecutionAtPrivateRoot(privateRoot);
			expect(() => consumeD704SingleUseDispatchClaim(persistedExecution)).not.toThrow();
			await expect(
				consumePersistedD704DispatchClaimForExecutionAtPrivateRoot(privateRoot),
			).rejects.toThrow(/already consumed/);
			const claimPath = join(privateRoot, D704_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
			expect((await stat(claimPath)).mode & 0o777).toBe(0o700);
			const claimFile = join(claimPath, "dispatch-claim.v1.json");
			expect((await stat(claimFile)).mode & 0o777).toBe(0o600);
			expect(JSON.parse(await readFile(claimFile, "utf8"))).toMatchObject({
				decisionRef: D704_APPROVAL_REF,
				decisionRevision: D704_APPROVAL_REVISION,
				generationRef: D704_LIVE_GENERATION_REF,
				maxSpendMicrousd: 6_000_000,
				noResetTotalLimitMicrousd: 32_000_000,
			});
		} finally {
			await rm(container, { recursive: true, force: true });
		}
	});

	it("rejects live preflight without exact D703 and D690 evidence", () => {
		expect(() =>
			createD704PreflightCapability({
				d690OfflineEvidence: {},
				d703DryRunArtifacts: {},
				d703Preflight: {},
				executionClass: "live-provider",
			}),
		).toThrow();
	});
});
