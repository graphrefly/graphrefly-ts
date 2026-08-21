import { describe, expect, it } from "vitest";
import {
	D44_D45_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD44D45LiveImplementation,
} from "../../evals/empirical-memory-rerun-avoidance/d44-d45-live-implementation-manifest.js";
import {
	runD44D45InjectedNoNetworkQualification,
	validateD44D45QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d44-d45-live-qualification.js";

describe("graphrefly-ts:D44/D45 live composition", () => {
	it("runs all six arms through Graph-owned provider proposal and exact tool effects without network", async () => {
		const bundle = validateD44D45QualificationBundle(
			await runD44D45InjectedNoNetworkQualification(),
		);
		expect(bundle.qualification.exactSixArmsCompleted).toBe(true);
		expect(bundle.qualification.evaluableArms).toBe(6);
		expect(bundle.qualification.providerCalls).toBeGreaterThanOrEqual(12);
		expect(bundle.qualification.providerNetworkCalls).toBe(0);
		expect(bundle.qualification.credentialReads).toBe(0);
		expect(bundle.qualification.dispatchClaims).toBe(0);
		expect(await measureD44D45LiveImplementation()).toBe(
			D44_D45_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
		);
	}, 180_000);
});
