import { chmod, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	admitD43EffectResult,
	createD43GraphHarnessAuthority,
	takeD43AdmittedEffect,
	validateD43GraphHarnessEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/d43-graph-harness-authority.js";
import {
	D43_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD43Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d43-graph-harness-implementation-manifest.js";
import {
	canonicalReplayD43Qualification,
	D43_QUALIFICATION_GENERATION_REF,
	persistD43Qualification,
	runD43InjectedNoNetworkQualification,
	validateD43QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d43-graph-harness-qualification.js";
import { lowerD43ProviderEffect } from "../../evals/empirical-memory-rerun-avoidance/d43-mechanical-provider-adapter.js";
import {
	createD43ModelHarnessPolicy,
	createD43PolicyCatalog,
	createD43QualificationPolicy,
	resolveD43HarnessPlan,
} from "../../evals/empirical-memory-rerun-avoidance/d43-model-harness-policy.js";

const assignment = Object.freeze({
	assignmentRef: "assignment.d43.test",
	modelRef: "deepseek/deepseek-v4-flash-0731",
	providerRef: "deepinfra/fp8/chat",
	campaignRef: "campaign.memory-rerun-avoidance.six-arm.d43-v1",
});

function localSuccess() {
	return Object.freeze({
		outcome: "success" as const,
		elapsedMs: 1,
		costMicrousd: 0,
		usage: null,
		wireDigest: null,
		retryClass: null,
		criteria: null,
	});
}

describe("graphrefly-ts:D43 automatic model-policy Graph harness", () => {
	it("resolves a frozen policy automatically and derives an inspectable plan without runtime approval", () => {
		const policy = createD43QualificationPolicy();
		const plan = resolveD43HarnessPlan(createD43PolicyCatalog([policy]), assignment);
		expect(plan.modelRef).toBe(assignment.modelRef);
		expect(plan.providerRef).toBe(assignment.providerRef);
		expect(plan.humanRuntimeApprovalRequired).toBe(false);
		expect(plan.maxActiveEffects).toBe(1);
		expect(plan.enhancementRecipes).toHaveLength(6);
		const { campaignDigest: _campaignDigest, ...campaign } = policy.campaign;

		const narrowPolicy = createD43ModelHarnessPolicy({
			policyRef: `${policy.policyRef}.narrow`,
			model: {
				profileRef: policy.model.profileRef,
				modelRef: policy.model.modelRef,
				supportsNamedToolChoice: true,
				supportsParallelToolCalls: false,
				inspectionMaxOutputTokens: policy.model.inspectionMaxOutputTokens,
				mutationMaxOutputTokens: policy.model.mutationMaxOutputTokens,
			},
			provider: {
				bindingRef: policy.provider.bindingRef,
				providerRef: policy.provider.providerRef,
				endpointProtocol: policy.provider.endpointProtocol,
				namedToolChoiceEncoding: policy.provider.namedToolChoiceEncoding,
				allowFallback: false,
				allowProviderSwitch: false,
				allowParallelEffects: false,
				providerDeadlineMs: policy.provider.providerDeadlineMs,
			},
			campaign,
			enhancementRecipes: ["named-phase-tool-binding"],
		});
		const narrowPlan = resolveD43HarnessPlan(createD43PolicyCatalog([narrowPolicy]), assignment);
		expect(narrowPlan.enhancementRecipes).toEqual(["named-phase-tool-binding"]);
		const narrowAuthority = createD43GraphHarnessAuthority({
			catalog: createD43PolicyCatalog([narrowPolicy]),
			assignment,
		});
		const materialization = takeD43AdmittedEffect(narrowAuthority)!;
		admitD43EffectResult(narrowAuthority, materialization, localSuccess());
		const inspection = takeD43AdmittedEffect(narrowAuthority)!;
		admitD43EffectResult(narrowAuthority, inspection, {
			outcome: "wrong-tool",
			elapsedMs: 1,
			costMicrousd: 1,
			usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
			wireDigest: lowerD43ProviderEffect(inspection).wireDigest,
			retryClass: null,
			criteria: null,
		});
		expect(takeD43AdmittedEffect(narrowAuthority)?.kind).toBe("cleanup");
	});

	it("qualifies the five six-arm Graph scenarios and the complete known failure closure", async () => {
		const bundle = validateD43QualificationBundle(await runD43InjectedNoNetworkQualification());
		expect(bundle.qualification.exactSixArmScenarios).toBe(5);
		expect(bundle.qualification.mainFrozenGateWouldPass).toBe(true);
		expect(bundle.qualification.allKnownFailureOutcomesObserved).toBe(true);
		expect(bundle.qualification.exactRetryWireIdentity).toBe(true);
		expect(bundle.qualification.conservativeReservationObserved).toBe(true);
		expect(bundle.qualification.historicalRuntimeDependencies).toBe(0);
		expect(bundle.qualification.providerNetworkCalls).toBe(0);
		expect(bundle.qualification.credentialReads).toBe(0);
		expect(bundle.qualification.efficacyClaim).toBe("none");
		expect(bundle.mainEvidence.arms.every((arm) => arm.evaluable)).toBe(true);
		expect(bundle.infrastructureFailureEvidence.arms.every((arm) => arm.completed)).toBe(true);
		expect(bundle.headroomEvidence.findings.some((item) => item.kind === "budget-exhausted")).toBe(
			true,
		);
		expect(canonicalReplayD43Qualification(bundle)).toEqual(bundle);
		expect(() =>
			validateD43GraphHarnessEvidence({ ...bundle.mainEvidence, unadmitted: true }),
		).toThrow();
	}, 120_000);

	it("rejects replay, substitution, retry wire drift, and canonical evidence mutation", () => {
		const catalog = createD43PolicyCatalog([createD43QualificationPolicy()]);
		const authority = createD43GraphHarnessAuthority({ catalog, assignment });
		const materialization = takeD43AdmittedEffect(authority)!;
		expect(() => admitD43EffectResult(authority, { ...materialization }, localSuccess())).toThrow(
			/forged, substituted, or replayed/,
		);
		admitD43EffectResult(authority, materialization, localSuccess());
		expect(() => admitD43EffectResult(authority, materialization, localSuccess())).toThrow(
			/forged, substituted, or replayed/,
		);
		const inspection = takeD43AdmittedEffect(authority)!;
		const firstLowering = lowerD43ProviderEffect(inspection);
		admitD43EffectResult(authority, inspection, {
			outcome: "retryable-provider-failure",
			elapsedMs: 1,
			costMicrousd: 0,
			usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
			wireDigest: firstLowering.wireDigest,
			retryClass: "D710",
			criteria: null,
		});
		const retry = takeD43AdmittedEffect(authority)!;
		expect(retry.logicalRequestDigest).toBe(inspection.logicalRequestDigest);
		const retryLowering = lowerD43ProviderEffect(retry);
		expect(retryLowering.bytes).toEqual(firstLowering.bytes);
		expect(retryLowering.wireDigest).toBe(firstLowering.wireDigest);
		expect(() =>
			admitD43EffectResult(authority, retry, {
				outcome: "success",
				elapsedMs: 1,
				costMicrousd: 1,
				usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
				wireDigest: `sha256:${"2".repeat(64)}`,
				retryClass: null,
				criteria: null,
			}),
		).toThrow(/wire identity drifted/);
		admitD43EffectResult(authority, retry, {
			outcome: "success",
			elapsedMs: 1,
			costMicrousd: 1,
			usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 },
			wireDigest: retryLowering.wireDigest,
			retryClass: null,
			criteria: null,
		});
		expect(() => validateD43GraphHarnessEvidence({})).toThrow();
	});

	it("persists one canonical qualification atomically and refuses overwrite", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d43-persist-"));
		await chmod(root, 0o700);
		try {
			const bundle = await runD43InjectedNoNetworkQualification();
			const privateRoot = await realpath(root);
			const receipt = await persistD43Qualification({ privateRoot, bundle });
			expect(receipt.bundleArtifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
			await expect(persistD43Qualification({ privateRoot, bundle })).rejects.toThrow();
			const bytes = await readFile(
				join(privateRoot, D43_QUALIFICATION_GENERATION_REF, "bundle.v1.json"),
			);
			expect(bytes.byteLength).toBeGreaterThan(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 120_000);

	it("binds implementation bytes and has no D1-D42 runtime imports", async () => {
		expect(await measureD43Implementation()).toBe(D43_IMPLEMENTATION_MANIFEST_DIGEST);
		const root = new URL("../../evals/empirical-memory-rerun-avoidance/", import.meta.url);
		for (const file of [
			"d43-model-harness-policy.ts",
			"d43-graph-harness-authority.ts",
			"d43-graph-harness-qualification.ts",
			"d43-mechanical-provider-adapter.ts",
			"run-d43-model-policy-no-network.ts",
		]) {
			const source = await readFile(new URL(file, root), "utf8");
			expect(source).not.toMatch(/from "\.\/d(?:[1-9]|[1-3]\d|4[0-2])-/u);
		}
	});
});
