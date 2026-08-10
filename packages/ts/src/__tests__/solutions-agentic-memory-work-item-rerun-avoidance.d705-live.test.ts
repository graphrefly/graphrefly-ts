import { chmod, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	acquireD704SingleUseDispatchClaimAtPrivateRoot,
	consumePersistedD704DispatchClaimForExecutionAtPrivateRoot,
	createD704ConsumedDispatchHistoryCapabilityAtPrivateRoot,
	D704_CONSUMED_DISPATCH_CLAIM_ARTIFACT_DIGEST,
	D704_CONSUMED_DISPATCH_CLAIM_DIGEST,
} from "../../evals/empirical-memory-rerun-avoidance/d704-single-use-dispatch-claim.js";
import {
	createD705PreflightCapability,
	D705_APPROVAL_REF,
	D705_APPROVAL_REVISION,
	D705_CLAIM_BOUNDARY,
	D705_PRICING_REVISION,
} from "../../evals/empirical-memory-rerun-avoidance/d705-mutation-first-live.js";
import {
	acquireD705SingleUseDispatchClaimAtPrivateRoot,
	consumeD705ConsumedDispatchHistoryCapability,
	consumeD705SingleUseDispatchClaim,
	consumePersistedD705DispatchClaimForExecutionAtPrivateRoot,
	createD705ConsumedDispatchHistoryCapabilityAtPrivateRoot,
	D705_LIVE_GENERATION_REF,
	D705_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY,
} from "../../evals/empirical-memory-rerun-avoidance/d705-single-use-dispatch-claim.js";

async function createPrivateTestRoot(): Promise<{
	readonly container: string;
	readonly privateRoot: string;
}> {
	const container = await mkdtemp(join(tmpdir(), "graphrefly-d705-claim-"));
	const privateRoot = join(container, ".private", "empirical-memory-rerun-avoidance");
	await mkdir(privateRoot, { recursive: true, mode: 0o700 });
	await chmod(privateRoot, 0o700);
	return { container, privateRoot };
}

describe("D705 mutation-first live authority", () => {
	it("freezes the exact live approval without efficacy attribution", () => {
		expect(D705_APPROVAL_REF).toBe("decision.D705");
		expect(D705_APPROVAL_REVISION).toBe("decision.D705.2026-08-09.v1");
		expect(D705_CLAIM_BOUNDARY).toContain("no-efficacy-claim");
		expect(D705_PRICING_REVISION).toContain("2026-08-09");
		expect(D705_LIVE_GENERATION_REF).toContain("d705");
	});

	it("atomically permits only one cross-process-shaped D705 dispatch contender", async () => {
		const { container, privateRoot } = await createPrivateTestRoot();
		try {
			const results = await Promise.allSettled([
				acquireD705SingleUseDispatchClaimAtPrivateRoot(privateRoot),
				acquireD705SingleUseDispatchClaimAtPrivateRoot(privateRoot),
			]);
			expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
			expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
			const acquired = results.find(
				(
					result,
				): result is PromiseFulfilledResult<
					Awaited<ReturnType<typeof acquireD705SingleUseDispatchClaimAtPrivateRoot>>
				> => result.status === "fulfilled",
			)?.value;
			expect(acquired).toBeDefined();
			expect(() => consumeD705SingleUseDispatchClaim(acquired)).not.toThrow();
			expect(() => consumeD705SingleUseDispatchClaim(acquired)).toThrow(/single-use claim/);
			const persistedExecution =
				await consumePersistedD705DispatchClaimForExecutionAtPrivateRoot(privateRoot);
			expect(() => consumeD705SingleUseDispatchClaim(persistedExecution)).not.toThrow();
			await expect(
				consumePersistedD705DispatchClaimForExecutionAtPrivateRoot(privateRoot),
			).rejects.toThrow(/already consumed/);
			const history = await createD705ConsumedDispatchHistoryCapabilityAtPrivateRoot(privateRoot);
			expect(consumeD705ConsumedDispatchHistoryCapability(history)).toMatchObject({
				executionLeaseConsumed: true,
				liveGenerationAbsent: true,
			});
			const claimPath = join(privateRoot, D705_SINGLE_USE_DISPATCH_CLAIM_DIRECTORY);
			expect((await stat(claimPath)).mode & 0o777).toBe(0o700);
			const claimFile = join(claimPath, "dispatch-claim.v1.json");
			expect((await stat(claimFile)).mode & 0o777).toBe(0o600);
			expect(JSON.parse(await readFile(claimFile, "utf8"))).toMatchObject({
				decisionRef: D705_APPROVAL_REF,
				decisionRevision: D705_APPROVAL_REVISION,
				generationRef: D705_LIVE_GENERATION_REF,
				maxSpendMicrousd: 6_000_000,
				noResetTotalLimitMicrousd: 32_000_000,
			});
		} finally {
			await rm(container, { recursive: true, force: true });
		}
	});

	it("rejects live preflight without exact D703 and D690 evidence", () => {
		expect(() =>
			createD705PreflightCapability({
				d690OfflineEvidence: {},
				d703DryRunArtifacts: {},
				d703Preflight: {},
				executionClass: "live-provider",
			}),
		).toThrow();
	});

	it("binds the exact consumed D704 dispatch history before replacement", async () => {
		const { container, privateRoot } = await createPrivateTestRoot();
		try {
			await acquireD704SingleUseDispatchClaimAtPrivateRoot(privateRoot);
			await consumePersistedD704DispatchClaimForExecutionAtPrivateRoot(privateRoot);
			const history = await createD704ConsumedDispatchHistoryCapabilityAtPrivateRoot(privateRoot);
			expect(history).toMatchObject({
				capabilityRef: "d704-consumed-dispatch-history",
				claimArtifactDigest: D704_CONSUMED_DISPATCH_CLAIM_ARTIFACT_DIGEST,
				claimDigest: D704_CONSUMED_DISPATCH_CLAIM_DIGEST,
				executionLeaseConsumed: true,
			});
			const d704ClaimFile = join(
				privateRoot,
				".d704-d703-mutation-first-live-2026-08-09-v1",
				"dispatch-claim.v1.json",
			);
			await chmod(d704ClaimFile, 0o644);
			await expect(
				createD704ConsumedDispatchHistoryCapabilityAtPrivateRoot(privateRoot),
			).rejects.toThrow(/ownership is invalid/);
		} finally {
			await rm(container, { recursive: true, force: true });
		}
	});
});
