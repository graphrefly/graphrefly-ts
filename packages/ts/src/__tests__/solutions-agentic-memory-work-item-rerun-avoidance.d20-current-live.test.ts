import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
	D20_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD20Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d20-current-live-implementation-manifest.js";
import {
	createD20QualificationInjectedBaselineForTest,
	runD20InjectedNoNetworkQualification,
	validateD20QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d20-current-live-qualification.js";
import { strictJsonCodec } from "../../src/json/codec.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

describe("graphrefly-ts:D20 current Graph-native live qualification", () => {
	let bundle: Awaited<ReturnType<typeof runD20InjectedNoNetworkQualification>>;
	let globalNetworkCalls = 0;

	beforeAll(async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			globalNetworkCalls += 1;
			throw new TypeError("D20 qualification attempted global network");
		}) as typeof fetch;
		try {
			bundle = await runD20InjectedNoNetworkQualification({
				repositoryRoot,
				baseline: createD20QualificationInjectedBaselineForTest(),
				implementationManifestDigest: D20_IMPLEMENTATION_MANIFEST_DIGEST,
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	}, 240_000);

	it("runs all six arms serially with an exact D710 retry and no live efficacy claim", () => {
		const validated = validateD20QualificationBundle(bundle);
		expect(validated.qualification).toMatchObject({
			fullSixArmIntegrationPassed: true,
			fixedArmOrderPassed: true,
			coldIndependentWarmAdmissionPassed: true,
			retryIdentityPassed: true,
			retryWaits: 1,
			maxActiveEffects: 1,
			workspaceResidueCount: 0,
			externalNetworkCalls: 0,
			liveGateEvaluated: false,
			efficacyClaim: "none",
		});
		expect(validated.mainBundle.graphEvidence?.workflowEvidence.runs).toHaveLength(6);
		expect(validated.mainBundle.gate.evaluated).toBe(false);
		expect(validated.partialBundle.disposition).toBe("partial-failure");
		expect(validated.partialBundle.generation).toBeNull();
		expect(globalNetworkCalls).toBe(0);
		expect(JSON.stringify(validated)).not.toMatch(
			/OPENROUTER_API_KEY|Bearer |sk-or-v1-test|oldText|newText|stack/u,
		);
	}, 240_000);

	it("rejects accessor and redigested projection substitution", () => {
		const accessor = Object.create(null) as Record<string, unknown>;
		for (const [key, value] of Object.entries(bundle)) accessor[key] = value;
		Object.defineProperty(accessor, "qualification", { get: () => bundle.qualification });
		expect(() => validateD20QualificationBundle(accessor)).toThrow(/own data property/u);

		const substituted = strictJsonCodec.decode(strictJsonCodec.encode(bundle)) as any;
		substituted.mainBundle.terminalReceipt.confirmedCostMicrousd += 1;
		expect(() => validateD20QualificationBundle(substituted)).toThrow();
	});

	it("binds the qualification to the exact D20 implementation closure", async () => {
		await expect(measureD20Implementation(repositoryRoot)).resolves.toBe(
			D20_IMPLEMENTATION_MANIFEST_DIGEST,
		);
	});
});
