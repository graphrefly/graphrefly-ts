import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	admitCurrentGraphEffectResult,
	CURRENT_GRAPH_QUALIFICATION_LIMITS,
	type CurrentGraphBudgetLimitsV1,
	createCurrentGraphNativeEvalAuthority,
	takeCurrentGraphAdmittedEffect,
} from "../../evals/empirical-memory-rerun-avoidance/d5-graph-native-eval-authority.js";
import {
	D27_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD27Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d27-phase-specific-live-implementation-manifest.js";
import {
	createD27QualificationInjectedBaselineForTest,
	persistD27Qualification,
	runD27InjectedNoNetworkQualification,
	validateD27QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d27-phase-specific-live-qualification.js";

describe("graphrefly-ts:D33 Graph replacement and validation recovery live qualification", () => {
	it("keeps Graph admission authoritative across six injected no-network arms", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		expect(await measureD27Implementation(repositoryRoot)).toBe(D27_IMPLEMENTATION_MANIFEST_DIGEST);
		const constructedBundle = await runD27InjectedNoNetworkQualification({
			repositoryRoot,
			baseline: createD27QualificationInjectedBaselineForTest(),
			baselineBasis: "injected-test",
		});
		const bundle = validateD27QualificationBundle(constructedBundle);
		expect(bundle.qualification).toMatchObject({
			exactSixArmsCompleted: true,
			graphAdmissionBeforeEveryEffect: true,
			exactNamedWirePassed: true,
			retryIdentityPassed: true,
			exactReplacementCauseCoverage: [
				"exact-replacement-unchanged",
				"exact-replacement-old-text-not-found",
				"exact-replacement-old-text-not-unique",
			],
			validationRecoveryPassed: true,
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
		const privateRoot = await mkdtemp(join(tmpdir(), "graphrefly-d32-injected-persistence-"));
		await chmod(privateRoot, 0o700);
		try {
			await expect(
				persistD27Qualification({ privateRoot, bundle: constructedBundle }),
			).rejects.toThrow("requires consumed D31 artifact bytes");
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	}, 90_000);

	it("makes validation recovery one-shot and fail-closed on wrong tool, stale state, and headroom", () => {
		const digest = (value: unknown) => empiricalStrictJsonDigest(value);
		const advanceToFocusedValidation = (
			limitOverrides: Partial<CurrentGraphBudgetLimitsV1> = {},
		) => {
			const authority = createCurrentGraphNativeEvalAuthority({
				limits: { ...CURRENT_GRAPH_QUALIFICATION_LIMITS, ...limitOverrides },
			});
			const materialization = takeCurrentGraphAdmittedEffect(authority)!;
			const initialState = digest({ arm: materialization.request.arm, state: "initial" });
			admitCurrentGraphEffectResult(authority, materialization.request.requestDigest, {
				effectKind: "materialization",
				status: "completed",
				workspaceStateDigest: initialState,
				evidenceDigest: digest("materialized"),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			});
			const inspection = takeCurrentGraphAdmittedEffect(authority)!;
			admitCurrentGraphEffectResult(authority, inspection.request.requestDigest, {
				effectKind: "provider-request",
				status: "completed",
				disposition: "tool-intents",
				toolIntents: ["read-file"],
				failureCode: null,
				evidenceDigest: digest("inspection"),
				actualCostMicrousd: 1,
				actualElapsedMs: 1,
			});
			const read = takeCurrentGraphAdmittedEffect(authority)!;
			admitCurrentGraphEffectResult(authority, read.request.requestDigest, {
				effectKind: "tool-action",
				toolRef: "read-file",
				status: "succeeded",
				causeCode: null,
				workspaceStateBeforeDigest: initialState,
				workspaceStateAfterDigest: initialState,
				nonEmptyDiff: false,
				evidenceDigest: digest("read"),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			});
			const mutation = takeCurrentGraphAdmittedEffect(authority)!;
			admitCurrentGraphEffectResult(authority, mutation.request.requestDigest, {
				effectKind: "provider-request",
				status: "completed",
				disposition: "tool-intents",
				toolIntents: ["replace-exact", "workspace-diff", "focused-validation"],
				failureCode: null,
				evidenceDigest: digest("mutation"),
				actualCostMicrousd: 1,
				actualElapsedMs: 1,
			});
			const changedState = digest({ initialState, changed: true });
			const replacement = takeCurrentGraphAdmittedEffect(authority)!;
			admitCurrentGraphEffectResult(authority, replacement.request.requestDigest, {
				effectKind: "tool-action",
				toolRef: "replace-exact",
				status: "succeeded",
				causeCode: null,
				workspaceStateBeforeDigest: initialState,
				workspaceStateAfterDigest: changedState,
				nonEmptyDiff: true,
				evidenceDigest: digest("replacement"),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			});
			const diff = takeCurrentGraphAdmittedEffect(authority)!;
			admitCurrentGraphEffectResult(authority, diff.request.requestDigest, {
				effectKind: "tool-action",
				toolRef: "workspace-diff",
				status: "succeeded",
				causeCode: null,
				workspaceStateBeforeDigest: changedState,
				workspaceStateAfterDigest: changedState,
				nonEmptyDiff: true,
				evidenceDigest: digest("diff"),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			});
			return { authority, changedState, focus: takeCurrentGraphAdmittedEffect(authority)! };
		};
		const rejectFocus = (
			authority: ReturnType<typeof createCurrentGraphNativeEvalAuthority>,
			requestDigest: string,
			state: string,
		) =>
			admitCurrentGraphEffectResult(authority, requestDigest, {
				effectKind: "tool-action",
				toolRef: "focused-validation",
				status: "failed",
				causeCode: "focused-validation-failed",
				workspaceStateBeforeDigest: state,
				workspaceStateAfterDigest: state,
				nonEmptyDiff: false,
				evidenceDigest: digest("focused-validation-failed"),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			});

		const wrongTool = advanceToFocusedValidation();
		rejectFocus(wrongTool.authority, wrongTool.focus.request.requestDigest, wrongTool.changedState);
		const correction = takeCurrentGraphAdmittedEffect(wrongTool.authority)!;
		expect(correction.request.correctionDirective).toMatchObject({
			reason: "focused-validation-failed",
			stage: "validation-reinspect",
			requiredFirstToolRef: "read-file",
		});
		admitCurrentGraphEffectResult(wrongTool.authority, correction.request.requestDigest, {
			effectKind: "provider-request",
			status: "completed",
			disposition: "tool-intents",
			toolIntents: ["workspace-diff"],
			failureCode: null,
			evidenceDigest: digest("wrong-tool"),
			actualCostMicrousd: 1,
			actualElapsedMs: 1,
		});
		expect(takeCurrentGraphAdmittedEffect(wrongTool.authority)?.request.effectKind).toBe("cleanup");
		expect(() =>
			admitCurrentGraphEffectResult(wrongTool.authority, correction.request.requestDigest, {
				effectKind: "provider-request",
				status: "completed",
				disposition: "tool-intents",
				toolIntents: ["workspace-diff"],
				failureCode: null,
				evidenceDigest: digest("wrong-tool-replay"),
				actualCostMicrousd: 1,
				actualElapsedMs: 1,
			}),
		).toThrow("does not match the active Graph request");

		const stale = advanceToFocusedValidation();
		rejectFocus(stale.authority, stale.focus.request.requestDigest, stale.changedState);
		const reinspection = takeCurrentGraphAdmittedEffect(stale.authority)!;
		admitCurrentGraphEffectResult(stale.authority, reinspection.request.requestDigest, {
			effectKind: "provider-request",
			status: "completed",
			disposition: "tool-intents",
			toolIntents: ["read-file"],
			failureCode: null,
			evidenceDigest: digest("reinspection"),
			actualCostMicrousd: 1,
			actualElapsedMs: 1,
		});
		const staleRead = takeCurrentGraphAdmittedEffect(stale.authority)!;
		expect(() =>
			admitCurrentGraphEffectResult(stale.authority, staleRead.request.requestDigest, {
				effectKind: "tool-action",
				toolRef: "read-file",
				status: "succeeded",
				causeCode: null,
				workspaceStateBeforeDigest: stale.changedState,
				workspaceStateAfterDigest: digest({ stale: true }),
				nonEmptyDiff: false,
				evidenceDigest: digest("stale-read"),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			}),
		).toThrow("read-only inspection changed workspace state");
		expect(takeCurrentGraphAdmittedEffect(stale.authority)?.request.requestDigest).toBe(
			staleRead.request.requestDigest,
		);

		for (const limitOverrides of [
			{ maxProviderRequests: 2 },
			{ maxCostMicrousd: 200_001 },
			{ maxElapsedMs: 220_006 },
			{ maxEffectFacts: 18 },
		]) {
			const headroom = advanceToFocusedValidation(limitOverrides);
			rejectFocus(headroom.authority, headroom.focus.request.requestDigest, headroom.changedState);
			expect(takeCurrentGraphAdmittedEffect(headroom.authority)?.request.effectKind).toBe(
				"cleanup",
			);
		}

		const secondFailure = advanceToFocusedValidation();
		rejectFocus(
			secondFailure.authority,
			secondFailure.focus.request.requestDigest,
			secondFailure.changedState,
		);
		const secondReinspection = takeCurrentGraphAdmittedEffect(secondFailure.authority)!;
		admitCurrentGraphEffectResult(
			secondFailure.authority,
			secondReinspection.request.requestDigest,
			{
				effectKind: "provider-request",
				status: "completed",
				disposition: "tool-intents",
				toolIntents: ["read-file"],
				failureCode: null,
				evidenceDigest: digest("second-reinspection"),
				actualCostMicrousd: 1,
				actualElapsedMs: 1,
			},
		);
		const secondRead = takeCurrentGraphAdmittedEffect(secondFailure.authority)!;
		admitCurrentGraphEffectResult(secondFailure.authority, secondRead.request.requestDigest, {
			effectKind: "tool-action",
			toolRef: "read-file",
			status: "succeeded",
			causeCode: null,
			workspaceStateBeforeDigest: secondFailure.changedState,
			workspaceStateAfterDigest: secondFailure.changedState,
			nonEmptyDiff: false,
			evidenceDigest: digest("second-read"),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		});
		const secondMutation = takeCurrentGraphAdmittedEffect(secondFailure.authority)!;
		expect(secondMutation.request.correctionDirective).toMatchObject({
			reason: "focused-validation-failed",
			stage: "validation-mutation",
			requiredFirstToolRef: "replace-exact",
		});
		admitCurrentGraphEffectResult(secondFailure.authority, secondMutation.request.requestDigest, {
			effectKind: "provider-request",
			status: "completed",
			disposition: "tool-intents",
			toolIntents: ["replace-exact", "workspace-diff", "focused-validation"],
			failureCode: null,
			evidenceDigest: digest("second-mutation"),
			actualCostMicrousd: 1,
			actualElapsedMs: 1,
		});
		const repairedState = digest({ state: secondFailure.changedState, repaired: true });
		const secondReplace = takeCurrentGraphAdmittedEffect(secondFailure.authority)!;
		admitCurrentGraphEffectResult(secondFailure.authority, secondReplace.request.requestDigest, {
			effectKind: "tool-action",
			toolRef: "replace-exact",
			status: "succeeded",
			causeCode: null,
			workspaceStateBeforeDigest: secondFailure.changedState,
			workspaceStateAfterDigest: repairedState,
			nonEmptyDiff: true,
			evidenceDigest: digest("second-replace"),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		});
		const secondDiff = takeCurrentGraphAdmittedEffect(secondFailure.authority)!;
		admitCurrentGraphEffectResult(secondFailure.authority, secondDiff.request.requestDigest, {
			effectKind: "tool-action",
			toolRef: "workspace-diff",
			status: "succeeded",
			causeCode: null,
			workspaceStateBeforeDigest: repairedState,
			workspaceStateAfterDigest: repairedState,
			nonEmptyDiff: true,
			evidenceDigest: digest("second-diff"),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		});
		const secondFocus = takeCurrentGraphAdmittedEffect(secondFailure.authority)!;
		rejectFocus(secondFailure.authority, secondFocus.request.requestDigest, repairedState);
		expect(takeCurrentGraphAdmittedEffect(secondFailure.authority)?.request.effectKind).toBe(
			"cleanup",
		);
	});
});
