import { chmod, lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	admitCurrentGraphEffectResult,
	CURRENT_GRAPH_ARMS,
	CURRENT_GRAPH_QUALIFICATION_LIMITS,
	type CurrentGraphAdmittedEffectV1,
	type CurrentGraphEffectResultInputV1,
	createCurrentGraphNativeEvalAuthority,
	runCurrentGraphNativeEval,
	takeCurrentGraphAdmittedEffect,
	validateCurrentGraphNativeEvidence,
} from "../../evals/empirical-memory-rerun-avoidance/current-graph-native-eval-authority.js";
import {
	createCurrentGraphPersistenceFaultForTest,
	persistCurrentGraphQualificationBundle,
	runCurrentGraphNativeNoNetworkQualification,
	validateCurrentGraphQualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/current-graph-native-eval-qualification.js";
import {
	runCurrentManagedCloudPublicSemanticValidation,
	validateCurrentManagedCloudPublicSemanticValidation,
} from "../../evals/empirical-memory-rerun-avoidance/current-managed-cloud-public-semantic-validation.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function privateRoot() {
	const root = await mkdtemp(join(tmpdir(), "graphrefly-current-d1-"));
	await chmod(root, 0o700);
	const canonical = await realpath(root);
	roots.push(canonical);
	return canonical;
}

function digest(label: unknown) {
	return `sha256:${Buffer.from(JSON.stringify(label)).toString("hex").padEnd(64, "0").slice(0, 64)}`;
}

function secondFailureExecutor() {
	return async (effect: CurrentGraphAdmittedEffectV1): Promise<CurrentGraphEffectResultInputV1> => {
		const request = effect.request;
		const local = { actualCostMicrousd: 0 as const, actualElapsedMs: 1 };
		if (request.effectKind === "materialization") {
			return {
				...local,
				effectKind: "materialization",
				status: "completed",
				workspaceStateDigest: digest({ arm: request.arm }),
				evidenceDigest: digest(request.requestDigest),
			};
		}
		if (request.effectKind === "provider-request") {
			const toolIntents =
				request.correctionDirective?.stage === "reinspect" || request.phaseBefore === "none"
					? (["read-file"] as const)
					: (["replace-exact", "workspace-diff", "focused-validation"] as const);
			return {
				effectKind: "provider-request",
				status: "completed",
				disposition: "tool-intents",
				toolIntents,
				failureCode: null,
				evidenceDigest: digest({ request: request.requestDigest, toolIntents }),
				actualCostMicrousd: 1,
				actualElapsedMs: 1,
			};
		}
		if (request.effectKind === "tool-action") {
			const workspace = request.workspaceStateDigest!;
			if (request.toolRef === "replace-exact") {
				return {
					...local,
					effectKind: "tool-action",
					toolRef: "replace-exact",
					status: "failed",
					causeCode: "exact-replacement-not-applicable",
					workspaceStateBeforeDigest: workspace,
					workspaceStateAfterDigest: workspace,
					nonEmptyDiff: false,
					evidenceDigest: digest({ rejected: request.requestDigest }),
				};
			}
			return {
				...local,
				effectKind: "tool-action",
				toolRef: request.toolRef!,
				status: "succeeded",
				causeCode: null,
				workspaceStateBeforeDigest: workspace,
				workspaceStateAfterDigest: workspace,
				nonEmptyDiff: request.toolRef === "workspace-diff",
				evidenceDigest: digest({ completed: request.requestDigest }),
			};
		}
		if (request.effectKind === "cleanup") {
			return {
				...local,
				effectKind: "cleanup",
				status: "completed",
				workspaceStateDigest: null,
				evidenceDigest: digest({ cleanup: request.requestDigest }),
			};
		}
		throw new TypeError(`unexpected effect ${request.effectKind}`);
	};
}

async function driveToFirstReplace(
	authority: ReturnType<typeof createCurrentGraphNativeEvalAuthority>,
) {
	const workspaceStateDigest = digest("workspace:first-replace");
	const materialization = takeCurrentGraphAdmittedEffect(authority)!;
	admitCurrentGraphEffectResult(authority, materialization.request.requestDigest, {
		effectKind: "materialization",
		status: "completed",
		workspaceStateDigest,
		evidenceDigest: digest("materialization:first-replace"),
		actualCostMicrousd: 0,
		actualElapsedMs: 1,
	});
	const inspectionRequest = takeCurrentGraphAdmittedEffect(authority)!;
	admitCurrentGraphEffectResult(authority, inspectionRequest.request.requestDigest, {
		effectKind: "provider-request",
		status: "completed",
		disposition: "tool-intents",
		toolIntents: ["read-file"],
		failureCode: null,
		evidenceDigest: digest("provider:inspection"),
		actualCostMicrousd: 1,
		actualElapsedMs: 1,
	});
	const read = takeCurrentGraphAdmittedEffect(authority)!;
	admitCurrentGraphEffectResult(authority, read.request.requestDigest, {
		effectKind: "tool-action",
		toolRef: "read-file",
		status: "succeeded",
		causeCode: null,
		workspaceStateBeforeDigest: workspaceStateDigest,
		workspaceStateAfterDigest: workspaceStateDigest,
		nonEmptyDiff: false,
		evidenceDigest: digest("tool:read"),
		actualCostMicrousd: 0,
		actualElapsedMs: 1,
	});
	const mutationRequest = takeCurrentGraphAdmittedEffect(authority)!;
	admitCurrentGraphEffectResult(authority, mutationRequest.request.requestDigest, {
		effectKind: "provider-request",
		status: "completed",
		disposition: "tool-intents",
		toolIntents: ["replace-exact", "workspace-diff", "focused-validation"],
		failureCode: null,
		evidenceDigest: digest("provider:mutation"),
		actualCostMicrousd: 1,
		actualElapsedMs: 1,
	});
	return { effect: takeCurrentGraphAdmittedEffect(authority)!, workspaceStateDigest };
}

function hiddenFailureExecutor() {
	return async (effect: CurrentGraphAdmittedEffectV1): Promise<CurrentGraphEffectResultInputV1> => {
		const request = effect.request;
		const local = { actualCostMicrousd: 0 as const, actualElapsedMs: 1 };
		if (request.effectKind === "materialization") {
			return {
				...local,
				effectKind: "materialization",
				status: "completed",
				workspaceStateDigest: digest({ arm: request.arm, workspace: true }),
				evidenceDigest: digest({ request: request.requestDigest, materialized: true }),
			};
		}
		if (request.effectKind === "provider-request") {
			const toolIntents =
				request.phaseBefore === "none"
					? (["read-file"] as const)
					: (["replace-exact", "workspace-diff", "focused-validation"] as const);
			return {
				effectKind: "provider-request",
				status: "completed",
				disposition: "tool-intents",
				toolIntents,
				failureCode: null,
				evidenceDigest: digest({ request: request.requestDigest, toolIntents }),
				actualCostMicrousd: 1,
				actualElapsedMs: 1,
			};
		}
		if (request.effectKind === "tool-action") {
			const before = request.workspaceStateDigest!;
			const after =
				request.toolRef === "replace-exact"
					? digest({ before, mutation: request.requestDigest })
					: before;
			return {
				...local,
				effectKind: "tool-action",
				toolRef: request.toolRef!,
				status: "succeeded",
				causeCode: null,
				workspaceStateBeforeDigest: before,
				workspaceStateAfterDigest: after,
				nonEmptyDiff: request.toolRef === "workspace-diff",
				evidenceDigest: digest({ request: request.requestDigest, after }),
			};
		}
		if (request.effectKind === "public-semantic-validation") {
			return {
				...local,
				effectKind: "public-semantic-validation",
				status: "passed",
				criterionFailures: [],
				workspaceStateDigest: request.workspaceStateDigest!,
				evidenceDigest: digest({ request: request.requestDigest, public: "passed" }),
			};
		}
		if (request.effectKind === "hidden-verifier") {
			return {
				...local,
				effectKind: "hidden-verifier",
				status: "failed",
				workspaceStateDigest: request.workspaceStateDigest!,
				evidenceDigest: digest({ request: request.requestDigest, hidden: "failed" }),
			};
		}
		return {
			...local,
			effectKind: "cleanup",
			status: "completed",
			workspaceStateDigest: null,
			evidenceDigest: digest({ request: request.requestDigest, cleanup: true }),
		};
	};
}

describe("graphrefly-ts:D1 current Graph-native eval", () => {
	it("uses independent actor-visible behavioral scenarios instead of source substrings", async () => {
		const evidence = await runCurrentManagedCloudPublicSemanticValidation();
		expect(evidence).toMatchObject({
			status: "passed",
			criterionFailures: [],
			publicCriteriaOnly: true,
			hiddenVerifierMaterialUsed: false,
			expectedPatchMaterialUsed: false,
		});
		expect(evidence.scenarioDigests).toHaveLength(3);
	});

	it("qualifies six serial arms with Graph-owned replacement and semantic correction", async () => {
		let networkCalls = 0;
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			networkCalls += 1;
			throw new TypeError("network forbidden by current D1 qualification");
		}) as typeof fetch;
		try {
			const bundle = validateCurrentGraphQualificationBundle(
				await runCurrentGraphNativeNoNetworkQualification(),
			);
			const serialized = JSON.stringify(bundle);
			expect(serialized).not.toContain("OPENROUTER_API_KEY");
			expect(serialized).not.toContain("oldText");
			expect(serialized).not.toContain("newText");
			expect(serialized).not.toContain("expected patch");
			expect(networkCalls).toBe(0);
			expect(bundle.graphEvidence.runStatus).toBe("complete");
			expect(bundle.graphEvidence.runs.map((run) => run.arm)).toEqual(CURRENT_GRAPH_ARMS);
			expect(bundle.graphEvidence.runs.every((run) => run.status === "completed")).toBe(true);
			expect(
				bundle.graphEvidence.findings.filter((fact) => fact.code === "exact-replacement-rejected"),
			).toHaveLength(6);
			expect(
				bundle.graphEvidence.findings.filter(
					(fact) => fact.code === "public-semantic-validation-failed",
				),
			).toHaveLength(6);
			expect(
				bundle.graphEvidence.findings.filter((fact) => fact.code === "hidden-verifier-failed"),
			).toEqual([]);
			expect(bundle.qualification).toMatchObject({
				exactSixArmsCompleted: true,
				coldDidNotCensorWarm: true,
				networkCalls: 0,
				causalAttribution: "undetermined",
				efficacyClaim: "none",
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("rejects stale, accessor-bearing, replayed, and state-changing failure facts", async () => {
		const authority = createCurrentGraphNativeEvalAuthority({
			limits: CURRENT_GRAPH_QUALIFICATION_LIMITS,
		});
		const materialization = takeCurrentGraphAdmittedEffect(authority)!;
		const accessor = {
			effectKind: "materialization",
			status: "completed",
			get workspaceStateDigest() {
				throw new Error("accessor invoked");
			},
			evidenceDigest: digest("accessor"),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		};
		expect(() =>
			admitCurrentGraphEffectResult(authority, materialization.request.requestDigest, accessor),
		).toThrow(/own data property/);
		admitCurrentGraphEffectResult(authority, materialization.request.requestDigest, {
			effectKind: "materialization",
			status: "completed",
			workspaceStateDigest: digest("workspace"),
			evidenceDigest: digest("materialized"),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		});
		expect(() =>
			admitCurrentGraphEffectResult(authority, materialization.request.requestDigest, {
				effectKind: "materialization",
				status: "failed",
				workspaceStateDigest: null,
				evidenceDigest: digest("replay"),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			}),
		).toThrow(/does not match the active Graph request/);

		const evidence = await runCurrentGraphNativeEval({
			limits: CURRENT_GRAPH_QUALIFICATION_LIMITS,
			execute: secondFailureExecutor(),
		});
		expect(evidence.runs).toHaveLength(6);
		expect(evidence.runs.every((run) => run.status === "incomplete")).toBe(true);
		expect(evidence.runs.every((run) => run.replacementRecoveryUsed)).toBe(true);
		expect(
			evidence.findings.filter((finding) => finding.code === "exact-replacement-rejected"),
		).toHaveLength(12);

		const driftAuthority = createCurrentGraphNativeEvalAuthority({
			limits: CURRENT_GRAPH_QUALIFICATION_LIMITS,
		});
		const drift = await driveToFirstReplace(driftAuthority);
		expect(() =>
			admitCurrentGraphEffectResult(driftAuthority, drift.effect.request.requestDigest, {
				effectKind: "tool-action",
				toolRef: "replace-exact",
				status: "failed",
				causeCode: "exact-replacement-not-applicable",
				workspaceStateBeforeDigest: drift.workspaceStateDigest,
				workspaceStateAfterDigest: digest("unexpected-state-drift"),
				nonEmptyDiff: false,
				evidenceDigest: digest("state-drift"),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			}),
		).toThrow(/failed tool action changed workspace state/);
	});

	it("fails closed without a correction when exact recovery headroom is unavailable", async () => {
		const evidence = await runCurrentGraphNativeEval({
			limits: { ...CURRENT_GRAPH_QUALIFICATION_LIMITS, maxProviderRequests: 2 },
			execute: secondFailureExecutor(),
		});
		expect(evidence.runs).toHaveLength(6);
		expect(evidence.runs[0]).toMatchObject({
			status: "incomplete",
			replacementRecoveryUsed: false,
			cleanupStatus: "completed",
		});
		expect(
			evidence.findings.filter((finding) => finding.code === "exact-replacement-rejected"),
		).toHaveLength(1);
		expect(evidence.findings.some((finding) => finding.code === "budget-exhausted")).toBe(true);
	});

	it("keeps public-semantic and actual hidden-verifier failures distinct", async () => {
		const evidence = await runCurrentGraphNativeEval({
			limits: CURRENT_GRAPH_QUALIFICATION_LIMITS,
			execute: hiddenFailureExecutor(),
		});
		expect(
			evidence.findings.filter((finding) => finding.code === "public-semantic-validation-failed"),
		).toEqual([]);
		expect(
			evidence.findings.filter((finding) => finding.code === "hidden-verifier-failed"),
		).toHaveLength(6);
		expect(evidence.runs.every((run) => run.hiddenVerifierAttempted)).toBe(true);
		expect(evidence.runs.every((run) => run.status === "incomplete")).toBe(true);
	});

	it("canonical replay rejects substituted findings", async () => {
		const bundle = await runCurrentGraphNativeNoNetworkQualification();
		const forged = structuredClone(bundle.graphEvidence);
		forged.findings[0] = { ...forged.findings[0]!, code: "hidden-verifier-failed" };
		expect(() => validateCurrentGraphNativeEvidence(forged)).toThrow(/canonical replay drifted/);
		const nestedAccessor = structuredClone(bundle.graphEvidence);
		Object.defineProperty(nestedAccessor.facts[0]!.request, "arm", {
			enumerable: true,
			get() {
				throw new Error("must not invoke nested request accessor");
			},
		});
		expect(() => validateCurrentGraphNativeEvidence(nestedAccessor)).toThrow(/own data property/);

		const forgedPublic = structuredClone(bundle.publicBehaviorEvidence);
		forgedPublic.scenarioDigests[0] = digest("substituted-public-scenario");
		const publicMaterial = { ...forgedPublic } as Record<string, unknown>;
		delete publicMaterial.evidenceDigest;
		forgedPublic.evidenceDigest = empiricalStrictJsonDigest(publicMaterial);
		expect(() => validateCurrentManagedCloudPublicSemanticValidation(forgedPublic)).toThrow(
			/passed-scenario identity drifted/,
		);

		const accessorBundle = {
			...bundle,
			get qualification() {
				throw new Error("must not invoke qualification accessor");
			},
		};
		expect(() => validateCurrentGraphQualificationBundle(accessorBundle)).toThrow(
			/own data property/,
		);
	});

	it("publishes only a committed private bundle and cleans injected failures", async () => {
		const root = await privateRoot();
		const bundle = await runCurrentGraphNativeNoNetworkQualification();
		const receipt = await persistCurrentGraphQualificationBundle({ privateRoot: root, bundle });
		expect(receipt.bundleDigest).toBe(bundle.bundleDigest);
		expect(await readdir(receipt.finalRoot)).toEqual(["artifacts", "commit.v1.json"]);
		expect((await lstat(receipt.finalRoot)).mode & 0o777).toBe(0o700);
		expect((await lstat(join(receipt.finalRoot, "artifacts"))).mode & 0o777).toBe(0o700);
		expect((await lstat(join(receipt.finalRoot, "artifacts", "bundle.v1.json"))).mode & 0o777).toBe(
			0o600,
		);
		expect((await lstat(join(receipt.finalRoot, "commit.v1.json"))).mode & 0o777).toBe(0o600);
		await expect(
			persistCurrentGraphQualificationBundle({ privateRoot: root, bundle }),
		).rejects.toThrow(/same-process qualified bundle/);

		for (const stage of ["after-claim", "after-write", "after-rename"] as const) {
			const faultRoot = await privateRoot();
			const faultBundle = await runCurrentGraphNativeNoNetworkQualification();
			await expect(
				persistCurrentGraphQualificationBundle({
					privateRoot: faultRoot,
					bundle: faultBundle,
					fault: createCurrentGraphPersistenceFaultForTest(stage),
				}),
			).rejects.toThrow(/injected/);
			expect(await readdir(faultRoot)).toEqual([]);
		}
	}, 30_000);
});
