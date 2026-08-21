import { describe, expect, it } from "vitest";
import {
	D52_REPLACE_EXPANSION_MAX_BYTES,
	D52_REPLACE_TEXT_MAX_BYTES,
} from "../../evals/empirical-memory-rerun-avoidance/d45-graph-tool-authority.js";
import {
	D52_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD52Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d52-task-outcome-implementation-manifest.js";
import { runD52InjectedNoNetworkQualification } from "../../evals/empirical-memory-rerun-avoidance/d52-task-outcome-qualification.js";

describe("graphrefly-ts:D52 task outcome and bounded correction authority", () => {
	it("derives a positive frozen gate from one passed treatment and five evaluable model failures", () => {
		const bundle = runD52InjectedNoNetworkQualification();
		const { qualification } = bundle;
		expect(qualification.exactSixArmsCompleted).toBe(true);
		expect(qualification.frozenGateWouldPass).toBe(true);
		expect(qualification.relevantTaskPassed).toBe(true);
		expect(qualification.controlsTaskFailed).toBe(true);
		expect(qualification.earlierFailureHiddenVerifierNull).toBe(true);
		expect(qualification.hiddenFailurePreserved).toBe(true);
		expect(bundle.evidence.arms.map(({ taskOutcome }) => taskOutcome)).toEqual([
			"failed",
			"passed",
			"failed",
			"failed",
			"failed",
			"failed",
		]);
	});

	it("rejects broad replacements before tool admission and exposes only Graph-owned correction evidence", () => {
		const { qualification } = runD52InjectedNoNetworkQualification();
		expect(D52_REPLACE_TEXT_MAX_BYTES).toBe(512);
		expect(D52_REPLACE_EXPANSION_MAX_BYTES).toBe(128);
		expect(qualification.overlongRejectedBeforeTool).toBe(true);
		expect(qualification.expansionRejectedBeforeTool).toBe(true);
		expect(qualification.exactBoundaryAdmitted).toBe(true);
		expect(qualification.argumentBoundsFacts).toBe(2);
		expect(qualification.focusedValidationReservationMs).toBe(60_000);
		expect(qualification.publicSemanticValidationReservationMs).toBe(60_000);
		expect(qualification.otherLocalReservationsUnchanged).toBe(true);
		expect(qualification.publicCorrectionContextExposed).toBe(true);
		expect(qualification.rawMutationMaterialPersisted).toBe(false);
		expect(qualification.providerNetworkCalls).toBe(0);
		expect(qualification.credentialReads).toBe(0);
		expect(qualification.dispatchClaims).toBe(0);
	});

	it("binds the complete D52 implementation", async () => {
		expect(await measureD52Implementation()).toBe(D52_IMPLEMENTATION_MANIFEST_DIGEST);
	});
});
