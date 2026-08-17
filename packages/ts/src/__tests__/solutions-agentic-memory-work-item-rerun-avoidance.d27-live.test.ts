import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	D27_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD27Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d27-phase-specific-live-implementation-manifest.js";
import {
	createD27QualificationInjectedBaselineForTest,
	runD27InjectedNoNetworkQualification,
	validateD27QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d27-phase-specific-live-qualification.js";

describe("graphrefly-ts:D31 Graph correction-context live qualification", () => {
	it("keeps Graph admission authoritative across six injected no-network arms", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		expect(await measureD27Implementation(repositoryRoot)).toBe(D27_IMPLEMENTATION_MANIFEST_DIGEST);
		const bundle = validateD27QualificationBundle(
			await runD27InjectedNoNetworkQualification({
				repositoryRoot,
				baseline: createD27QualificationInjectedBaselineForTest(),
				baselineBasis: "injected-test",
			}),
		);
		expect(bundle.qualification).toMatchObject({
			exactSixArmsCompleted: true,
			graphAdmissionBeforeEveryEffect: true,
			exactNamedWirePassed: true,
			retryIdentityPassed: true,
			providerNetworkCalls: 0,
			maxActiveEffects: 1,
			workspaceResidueCount: 0,
			liveGateEvaluated: false,
			efficacyClaim: "none",
			qualified: true,
		});
		expect(
			bundle.mainBundle.graphEvidence?.workflowEvidence.providerEvidence.workflowEvidence.runs,
		).toHaveLength(6);
	}, 90_000);
});
