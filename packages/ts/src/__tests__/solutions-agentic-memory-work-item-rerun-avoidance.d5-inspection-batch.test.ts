import { chmod, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	admitCurrentGraphEffectResult,
	CURRENT_GRAPH_QUALIFICATION_LIMITS,
	createCurrentGraphNativeEvalAuthority,
	D5_MAX_INSPECTION_BATCH,
	takeCurrentGraphAdmittedEffect,
} from "../../evals/empirical-memory-rerun-avoidance/d5-graph-native-eval-authority.js";
import {
	persistCurrentGraphQualificationBundle,
	runCurrentGraphNativeNoNetworkQualification,
	validateCurrentGraphQualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d5-inspection-batch-qualification.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function digest(value: unknown): string {
	return empiricalStrictJsonDigest(value);
}

function admitMaterialization(authority: ReturnType<typeof createCurrentGraphNativeEvalAuthority>) {
	const effect = takeCurrentGraphAdmittedEffect(authority);
	if (effect === null || effect.request.effectKind !== "materialization")
		throw new TypeError("expected D5 materialization");
	const workspaceStateDigest = digest({ workspace: effect.request.arm });
	admitCurrentGraphEffectResult(authority, effect.request.requestDigest, {
		effectKind: "materialization",
		status: "completed",
		workspaceStateDigest,
		evidenceDigest: digest({ materialized: effect.request.requestDigest }),
		actualCostMicrousd: 0,
		actualElapsedMs: 1,
	});
	return workspaceStateDigest;
}

function admitInspectionBatch(
	authority: ReturnType<typeof createCurrentGraphNativeEvalAuthority>,
	toolIntents: readonly ("read-file" | "workspace-diff")[],
) {
	const effect = takeCurrentGraphAdmittedEffect(authority);
	if (effect === null || effect.request.effectKind !== "provider-request")
		throw new TypeError("expected D5 provider request");
	admitCurrentGraphEffectResult(authority, effect.request.requestDigest, {
		effectKind: "provider-request",
		status: "completed",
		disposition: "tool-intents",
		toolIntents,
		failureCode: null,
		evidenceDigest: digest({ request: effect.request.requestDigest, toolIntents }),
		actualCostMicrousd: 1,
		actualElapsedMs: 1,
	});
}

describe("graphrefly-ts:D5 Graph-native inspection-batch admission", () => {
	it("admits four independent inspections in provider order as serial Graph effects", () => {
		const authority = createCurrentGraphNativeEvalAuthority({
			limits: CURRENT_GRAPH_QUALIFICATION_LIMITS,
		});
		const workspaceStateDigest = admitMaterialization(authority);
		admitInspectionBatch(authority, ["read-file", "read-file", "read-file", "read-file"]);
		const requestDigests: string[] = [];
		for (let index = 0; index < 4; index += 1) {
			const effect = takeCurrentGraphAdmittedEffect(authority);
			expect(effect?.request).toMatchObject({
				effectKind: "tool-action",
				toolRef: "read-file",
				workspaceStateDigest,
			});
			requestDigests.push(effect!.request.requestDigest);
			admitCurrentGraphEffectResult(authority, effect!.request.requestDigest, {
				effectKind: "tool-action",
				toolRef: "read-file",
				status: "succeeded",
				causeCode: null,
				workspaceStateBeforeDigest: workspaceStateDigest,
				workspaceStateAfterDigest: workspaceStateDigest,
				nonEmptyDiff: false,
				evidenceDigest: digest({ read: index }),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			});
		}
		expect(new Set(requestDigests).size).toBe(4);
		expect(takeCurrentGraphAdmittedEffect(authority)?.request).toMatchObject({
			effectKind: "provider-request",
			phaseBefore: "inspection",
		});
	});

	it("rejects a non-read or oversized initial batch before any tool effect", () => {
		const wrongToolAuthority = createCurrentGraphNativeEvalAuthority({
			limits: CURRENT_GRAPH_QUALIFICATION_LIMITS,
		});
		admitMaterialization(wrongToolAuthority);
		admitInspectionBatch(wrongToolAuthority, ["read-file", "workspace-diff"]);
		const cleanup = takeCurrentGraphAdmittedEffect(wrongToolAuthority);
		expect(cleanup?.request).toMatchObject({ effectKind: "cleanup", toolRef: null });

		const oversizedAuthority = createCurrentGraphNativeEvalAuthority({
			limits: CURRENT_GRAPH_QUALIFICATION_LIMITS,
		});
		admitMaterialization(oversizedAuthority);
		expect(() =>
			admitInspectionBatch(
				oversizedAuthority,
				Array.from({ length: D5_MAX_INSPECTION_BATCH + 1 }, () => "read-file" as const),
			),
		).toThrow("tool intent bound exceeded");
		expect(takeCurrentGraphAdmittedEffect(oversizedAuthority)?.request.effectKind).toBe(
			"provider-request",
		);

		const driftAuthority = createCurrentGraphNativeEvalAuthority({
			limits: CURRENT_GRAPH_QUALIFICATION_LIMITS,
		});
		const workspaceStateDigest = admitMaterialization(driftAuthority);
		admitInspectionBatch(driftAuthority, ["read-file"]);
		const readEffect = takeCurrentGraphAdmittedEffect(driftAuthority)!;
		expect(() =>
			admitCurrentGraphEffectResult(driftAuthority, readEffect.request.requestDigest, {
				effectKind: "tool-action",
				toolRef: "read-file",
				status: "succeeded",
				causeCode: null,
				workspaceStateBeforeDigest: workspaceStateDigest,
				workspaceStateAfterDigest: digest({ workspaceStateDigest, drifted: true }),
				nonEmptyDiff: false,
				evidenceDigest: digest("drifted-read"),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			}),
		).toThrow("read-only inspection changed workspace state");
		expect(takeCurrentGraphAdmittedEffect(driftAuthority)?.request.requestDigest).toBe(
			readEffect.request.requestDigest,
		);
	});

	it("qualifies and atomically persists the exact six-arm four-read lifecycle", async () => {
		const bundle = await runCurrentGraphNativeNoNetworkQualification();
		const validated = validateCurrentGraphQualificationBundle(bundle);
		expect(validated.qualification).toMatchObject({
			decisionRef: "graphrefly-ts:D5",
			fourReadInspectionBatchCount: 12,
			serialReadEffectCount: 48,
			networkCalls: 0,
			qualified: true,
		});
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d5-inspection-"));
		await chmod(root, 0o700);
		const canonicalRoot = await realpath(root);
		roots.push(canonicalRoot);
		const receipt = await persistCurrentGraphQualificationBundle({
			privateRoot: canonicalRoot,
			bundle,
		});
		expect(receipt.generationRef).toContain("d5-inspection-batch");
		expect((await stat(join(receipt.finalRoot, "artifacts", "bundle.v1.json"))).mode & 0o777).toBe(
			0o600,
		);
	});

	it("denies replacement recovery unless all four reinspection effects have headroom", () => {
		const authority = createCurrentGraphNativeEvalAuthority({
			limits: {
				maxProviderRequests: 10,
				maxCostMicrousd: 10,
				maxElapsedMs: 127,
				maxEffectFacts: 100,
				providerMaxCostMicrousd: 1,
				providerMaxElapsedMs: 10,
				localEffectMaxElapsedMs: 10,
			},
		});
		const workspaceStateDigest = admitMaterialization(authority);
		admitInspectionBatch(authority, ["read-file", "read-file", "read-file", "read-file"]);
		for (let index = 0; index < 4; index += 1) {
			const read = takeCurrentGraphAdmittedEffect(authority)!;
			admitCurrentGraphEffectResult(authority, read.request.requestDigest, {
				effectKind: "tool-action",
				toolRef: "read-file",
				status: "succeeded",
				causeCode: null,
				workspaceStateBeforeDigest: workspaceStateDigest,
				workspaceStateAfterDigest: workspaceStateDigest,
				nonEmptyDiff: false,
				evidenceDigest: digest({ headroomRead: index }),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			});
		}
		const mutation = takeCurrentGraphAdmittedEffect(authority)!;
		admitCurrentGraphEffectResult(authority, mutation.request.requestDigest, {
			effectKind: "provider-request",
			status: "completed",
			disposition: "tool-intents",
			toolIntents: ["replace-exact", "workspace-diff", "focused-validation"],
			failureCode: null,
			evidenceDigest: digest("headroom-mutation"),
			actualCostMicrousd: 1,
			actualElapsedMs: 1,
		});
		const replace = takeCurrentGraphAdmittedEffect(authority)!;
		admitCurrentGraphEffectResult(authority, replace.request.requestDigest, {
			effectKind: "tool-action",
			toolRef: "replace-exact",
			status: "failed",
			causeCode: "exact-replacement-unchanged",
			workspaceStateBeforeDigest: workspaceStateDigest,
			workspaceStateAfterDigest: workspaceStateDigest,
			nonEmptyDiff: false,
			evidenceDigest: digest("headroom-replacement-rejected"),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		});
		expect(takeCurrentGraphAdmittedEffect(authority)?.request.effectKind).toBe("cleanup");
	});
});
