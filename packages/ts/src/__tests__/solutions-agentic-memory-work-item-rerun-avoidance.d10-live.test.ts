import { describe, expect, test } from "vitest";
import { isD10CompleteSixArmMeasurementForTest } from "../../evals/empirical-memory-rerun-avoidance/d10-current-live.js";
import {
	createD10InjectedD9BaselineForTest,
	runD10CurrentGraphLiveNoNetworkQualification,
	validateD10CurrentGraphLiveQualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d10-current-pre-live-qualification.js";

const repositoryRoot = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");
const manifestDigest = `sha256:${"a".repeat(64)}`;

describe("D10 Graph-native provider-rejection live composition", () => {
	test("qualifies six serial arms with one conservative rejection and next-arm release", async () => {
		const bundle = await runD10CurrentGraphLiveNoNetworkQualification({
			repositoryRoot,
			baseline: createD10InjectedD9BaselineForTest(),
			implementationManifestDigest: manifestDigest,
		});
		const validated = validateD10CurrentGraphLiveQualificationBundle(bundle);
		expect(validated.graphBundle.disposition).toBe("success");
		expect(validated.graphBundle.graphEvidence?.rejectionCount).toBe(1);
		expect(
			validated.graphBundle.graphEvidence?.providerEvidence.workflowEvidence.runs,
		).toHaveLength(6);
		expect(validated.qualification.conservativeRejectionAccountingPassed).toBe(true);
		expect(validated.qualification.rejectionCleanupAndNextArmPassed).toBe(true);
		expect(isD10CompleteSixArmMeasurementForTest(validated.graphBundle.graphEvidence!)).toBe(true);
		const rejectionRemoved = {
			...validated.graphBundle.graphEvidence!,
			rejectionFacts: [],
			rejectionCount: 0,
		};
		expect(isD10CompleteSixArmMeasurementForTest(rejectionRemoved)).toBe(false);
	}, 120_000);

	test("rejects a redigested provider-rejection projection substitution", async () => {
		const bundle = await runD10CurrentGraphLiveNoNetworkQualification({
			repositoryRoot,
			baseline: createD10InjectedD9BaselineForTest(),
			implementationManifestDigest: manifestDigest,
		});
		const forged = structuredClone(bundle) as Record<string, any>;
		forged.graphBundle.graphEvidence.rejectionFacts[0].causeCode = "provider-tool-count-exceeded";
		expect(() => validateD10CurrentGraphLiveQualificationBundle(forged)).toThrow();
	}, 120_000);
});
