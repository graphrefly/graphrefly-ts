import { chmod, lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	D732_COORDINATES,
	D732_COORDINATES_DIGEST,
	D732_D731_QUALIFICATION_COORDINATES,
	validateD732LiveRunnerBytes,
} from "../../evals/empirical-memory-rerun-avoidance/d732-coordinates.js";
import {
	acquireD732SingleUseDispatchClaimAtRoot,
	consumeD732DispatchClaimForExecution,
	consumeD732ExecutionAuthority,
} from "../../evals/empirical-memory-rerun-avoidance/d732-single-use-dispatch-claim.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "../../evals/empirical-memory-rerun-avoidance/openrouter-current-key-spend-admission.js";

const sha = (label: string) => empiricalStrictJsonDigest({ label });

async function currentKeyAdmission() {
	return createOpenRouterCurrentKeySpendAdmissionCapability({
		async fetch() {
			return new Response(
				JSON.stringify({
					data: {
						limit: 32,
						limit_remaining: 20,
						usage: 12,
						limit_reset: null,
						is_management_key: false,
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		},
	}).read({
		credential: {
			bearerToken: "not-a-live-d732-test-credential",
			credentialBindingRef: "d732.test",
			credentialBindingRevision: "v1",
		},
		expectedLimitMicrousd: 32_000_000,
		requiredRemainingMicrousd: 6_000_000,
		signal: new AbortController().signal,
	});
}

describe("D732 D731-qualified live authorization", () => {
	it("freezes the one-block route, D731 qualification and ignored live runner", async () => {
		expect(D732_COORDINATES.blockHardCapMicrousd).toBe(6_000_000);
		expect(D732_COORDINATES.localEvalNoResetLimitMicrousd).toBe(32_000_000);
		expect(D732_COORDINATES.armOrder).toHaveLength(6);
		expect(D732_COORDINATES.maxActiveArms).toBe(1);
		expect(D732_COORDINATES.coldCensorsWarm).toBe(false);
		expect(D732_COORDINATES.retryPolicies).toEqual(["D671", "D675", "D710"]);
		expect(D732_COORDINATES.automaticRerunAllowed).toBe(false);
		expect(D732_D731_QUALIFICATION_COORDINATES.bundleDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(
			validateD732LiveRunnerBytes(
				new Uint8Array(
					await readFile(
						join(
							import.meta.dirname,
							"../../evals/.private/empirical-memory-rerun-avoidance/run-d732-live.ts",
						),
					),
				),
			),
		).toBe(D732_COORDINATES_DIGEST);
	});

	it("persists and consumes one exact claim while rejecting authority replay", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d732-claim-"));
		try {
			await chmod(root, 0o700);
			const claim = await acquireD732SingleUseDispatchClaimAtRoot(await realpath(root), {
				pricingReadDigest: sha("pricing"),
				routeEligibilityDigest: sha("eligibility"),
				zeroByokObservationDigest: sha("zero-byok"),
				d731PreLiveBundleDigest: D732_D731_QUALIFICATION_COORDINATES.bundleDigest,
			});
			const authority = await consumeD732DispatchClaimForExecution({
				claim,
				currentKeyAdmission: await currentKeyAdmission(),
			});
			expect(consumeD732ExecutionAuthority(authority).scope).toBe("injected-test-root");
			expect(() => consumeD732ExecutionAuthority(authority)).toThrow(/single-use/);
			const claimRoot = join(root, ".d732-d731-route-repair-live-2026-08-11-v1");
			expect((await lstat(claimRoot)).mode & 0o777).toBe(0o700);
			expect((await lstat(join(claimRoot, "dispatch-claim.v1.json"))).mode & 0o777).toBe(0o600);
			expect(
				(await lstat(join(claimRoot, "execution-started", "current-key-admission.v1.json"))).mode &
					0o777,
			).toBe(0o600);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
