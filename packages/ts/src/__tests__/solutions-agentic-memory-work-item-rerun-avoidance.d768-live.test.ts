import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	D768_BASELINE_COMMIT,
	D768_BUDGET_LIMITS,
	D768_DECISION_REF,
	D768_HISTORICAL_ARTIFACT_SHA256,
	D768_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
} from "../../evals/empirical-memory-rerun-avoidance/d768-coordinates.js";
import { validateD768LiveBundle } from "../../evals/empirical-memory-rerun-avoidance/d768-graph-native-live.js";
import { D768_IMPLEMENTATION_MANIFEST_DIGEST } from "../../evals/empirical-memory-rerun-avoidance/d768-implementation-manifest.js";
import { acquireD768SingleUseDispatchClaimAtRootForTest } from "../../evals/empirical-memory-rerun-avoidance/d768-single-use-dispatch-claim.js";

const sha = (label: string) => empiricalStrictJsonDigest({ label });

describe("D768 D767-qualified live replacement boundary", () => {
	it("freezes the exact approved baseline and numeric boundary", () => {
		expect(D768_DECISION_REF).toBe("decision.D768");
		expect(D768_BASELINE_COMMIT).toBe("2dfeeb69");
		expect(D768_HISTORICAL_ARTIFACT_SHA256).toBe(
			"sha256:b770dba74ecf4940c322f5b34cccae5dec4c14155c79be65e50f89185507042c",
		);
		expect(D768_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST).toBe(
			"sha256:b14745426a7676b2b1c3e28643e29f8ca09b64881ed8e6731c6ceba87004cca2",
		);
		expect(D768_BUDGET_LIMITS.maxCostMicrousd).toBe(6_000_000);
	});

	it("makes the durable dispatch claim exclusive before any execution authority exists", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d768-claim-"));
		await chmod(root, 0o700);
		try {
			const input = {
				pricingReadDigest: sha("pricing"),
				zeroByokObservationDigest: sha("zero-byok"),
				implementationManifestDigest: D768_IMPLEMENTATION_MANIFEST_DIGEST,
			};
			const claim = await acquireD768SingleUseDispatchClaimAtRootForTest(
				await realpath(root),
				input,
			);
			expect(claim.scope).toBe("injected-test-root");
			await expect(
				acquireD768SingleUseDispatchClaimAtRootForTest(await realpath(root), input),
			).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a caller-authored live bundle", () => {
		expect(() =>
			validateD768LiveBundle({
				schemaVersion: "graphrefly.b112.d768.live-bundle.v1",
				disposition: "success",
				graphEvidence: {},
				qualification: {},
				observation: {},
				generation: {},
				bundleDigest: sha("forged"),
			}),
		).toThrow();
	});
});
