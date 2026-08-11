import { chmod, lstat, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	consumeD721AdapterRunReceipt,
	createD721InjectedNoNetworkFixture,
	createD721ProviderCapableEffectAdapter,
	runD721ProviderCapableEffectAdapter,
} from "../../evals/empirical-memory-rerun-avoidance/d721-provider-capable-effect-adapter.js";
import {
	createD721PersistenceFaultForTest,
	D721_GENERATION_REF,
	persistD721ProviderCapablePreLiveBundle,
	runD721ProviderCapablePreLiveQualification,
	validateD721ProviderCapablePreLiveBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d721-provider-capable-pre-live.js";
import { strictJsonCodec } from "../json/codec.js";

const sourceDigest = empiricalStrictJsonDigest({ fixture: "d721-provider-capable" });
const routeDigest = empiricalStrictJsonDigest({ route: "d721-injected-no-network" });
const budgetLimits = Object.freeze({
	maxRequests: 96,
	maxRetryWaits: 16,
	maxCostMicrousd: 100_000,
	maxElapsedMs: 3_000_000,
});
const effectCeilings = Object.freeze({
	routeDigest,
	providerMaxCostMicrousd: 1_000,
	providerMaxElapsedMs: 30_000,
	localEffectMaxElapsedMs: 120_000,
});

async function runQualified() {
	const fixture = createD721InjectedNoNetworkFixture();
	const bundle = await runD721ProviderCapablePreLiveQualification({
		sourceDigest,
		budgetLimits,
		effectCeilings,
		adapter: fixture.adapter,
	});
	return { bundle, fixture };
}

describe("D721 provider-capable Graph-native pre-live integration", () => {
	it("runs six independent arms through six narrow ports and the one Graph ledger", async () => {
		const { bundle, fixture } = await runQualified();
		const validated = validateD721ProviderCapablePreLiveBundle(bundle);
		expect(validated.qualification.completedArmCount).toBe(6);
		expect(validated.qualification.graphAdmittedEffectCount).toBe(60);
		expect(validated.qualification.exercisedRetryReasons).toEqual([
			"d671-rate-limit-exceeded",
			"d675-und-err-socket",
			"d710-untyped-http-429",
		]);
		expect(validated.qualification.effectKindCounts).toEqual({
			materialization: 6,
			"provider-request": 15,
			"retry-wait": 3,
			"tool-action": 24,
			"hidden-verifier": 6,
			cleanup: 6,
		});
		expect(validated.underlyingBundle.graphEvidence.ledger.completedArms).toHaveLength(6);
		expect(validated.underlyingBundle.graphEvidence.ledger.effectReconciliations).toHaveLength(60);
		expect(
			validated.underlyingBundle.graphEvidence.ledger.effectReconciliations.every(
				(x) => x.basis === "measured",
			),
		).toBe(true);
		expect(fixture.cleanupCalls()).toBe(6);
		expect(fixture.remainingWorkspaces()).toBe(0);
	});

	it("rejects accessors, forged adapters, reuse and caller/result provenance drift", async () => {
		let getterHits = 0;
		const accessor = Object.defineProperty({}, "materialization", {
			enumerable: true,
			get() {
				getterHits += 1;
				return async () => undefined;
			},
		});
		expect(() => createD721ProviderCapableEffectAdapter(accessor)).toThrow();
		expect(getterHits).toBe(0);
		await expect(
			runD721ProviderCapablePreLiveQualification({
				sourceDigest,
				budgetLimits,
				effectCeilings,
				adapter: { revision: "graphrefly.b112.d721.provider-capable-effect-adapter.v1" },
			}),
		).rejects.toThrow(/exact injected no-network/);
		const arbitrary = createD721ProviderCapableEffectAdapter({
			materialization: async () => {
				throw new Error("must not execute");
			},
			providerRequest: async () => {
				throw new Error("must not execute");
			},
			retryWait: async () => {
				throw new Error("must not execute");
			},
			toolAction: async () => {
				throw new Error("must not execute");
			},
			hiddenVerifier: async () => {
				throw new Error("must not execute");
			},
			cleanup: async () => {
				throw new Error("must not execute");
			},
		});
		await expect(
			runD721ProviderCapablePreLiveQualification({
				sourceDigest,
				budgetLimits,
				effectCeilings,
				adapter: arbitrary,
			}),
		).rejects.toThrow(/exact injected no-network/);
		const fixture = createD721InjectedNoNetworkFixture();
		const bundle = await runD721ProviderCapablePreLiveQualification({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			adapter: fixture.adapter,
		});
		await expect(
			runD721ProviderCapablePreLiveQualification({
				sourceDigest,
				budgetLimits,
				effectCeilings,
				adapter: fixture.adapter,
			}),
		).rejects.toThrow(/single-use/);
		const forged = structuredClone(bundle) as any;
		forged.qualification.graphAdmittedEffectCount += 1;
		forged.qualification.qualificationDigest = empiricalStrictJsonDigest({
			forged: "qualification",
		});
		forged.bundleDigest = empiricalStrictJsonDigest({ forged: "bundle" });
		expect(() => validateD721ProviderCapablePreLiveBundle(forged)).toThrow();
	});

	it("records provider failure through Graph cleanup but refuses to qualify it as the full pre-live run", async () => {
		const fixture = createD721InjectedNoNetworkFixture({ throwProvider: true });
		const failedRun = await runD721ProviderCapableEffectAdapter({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			adapter: fixture.adapter,
		});
		const summary = consumeD721AdapterRunReceipt(failedRun.receipt, failedRun.underlyingBundle);
		expect(summary.failedEffectCount).toBe(1);
		expect(
			failedRun.underlyingBundle.graphEvidence.ledger.effectReconciliations.find(
				(fact) => fact.basis === "conservative-reservation",
			)?.basis,
		).toBe("conservative-reservation");
		expect(fixture.cleanupCalls()).toBe(1);
		expect(fixture.remainingWorkspaces()).toBe(0);
		const qualificationFixture = createD721InjectedNoNetworkFixture({ throwProvider: true });
		await expect(
			runD721ProviderCapablePreLiveQualification({
				sourceDigest,
				budgetLimits,
				effectCeilings,
				adapter: qualificationFixture.adapter,
			}),
		).rejects.toThrow(/complete independent six-arm|coverage|conservative/);
		expect(qualificationFixture.cleanupCalls()).toBe(1);
		expect(qualificationFixture.remainingWorkspaces()).toBe(0);
	});

	it("preserves D720 pre-effect cancellation with zero adapter invocations", async () => {
		const abortController = new AbortController();
		abortController.abort();
		const fixture = createD721InjectedNoNetworkFixture();
		const run = await runD721ProviderCapableEffectAdapter({
			sourceDigest,
			budgetLimits,
			effectCeilings,
			adapter: fixture.adapter,
			signal: abortController.signal,
		});
		expect(consumeD721AdapterRunReceipt(run.receipt, run.underlyingBundle)).toEqual({
			executedEffectCount: 0,
			failedEffectCount: 0,
			maxActiveInvocations: 0,
		});
		expect(run.underlyingBundle.runStatus).toBe("stopped");
		expect(() => consumeD721AdapterRunReceipt(run.receipt, run.underlyingBundle)).toThrow(
			/single-use/,
		);
		expect(() =>
			consumeD721AdapterRunReceipt(structuredClone(run.receipt), run.underlyingBundle),
		).toThrow(/not constructed/);
	});

	it("rejects accessor and cyclic port results before canonical snapshotting", async () => {
		for (const resultKind of ["accessor", "cyclic"] as const) {
			let getterHits = 0;
			const badResult =
				resultKind === "accessor"
					? Object.defineProperty({ actualCostMicrousd: 0, actualElapsedMs: 1 }, "result", {
							enumerable: true,
							get() {
								getterHits += 1;
								return {};
							},
						})
					: (() => {
							const cyclic: any = {
								actualCostMicrousd: 0,
								actualElapsedMs: 1,
								result: {
									effectKind: "materialization",
									status: "ready",
									workspaceStateDigest: sourceDigest,
									evidenceDigest: sourceDigest,
								},
							};
							cyclic.result.extra = cyclic;
							return cyclic;
						})();
			const never = async () => {
				throw new Error("later effect must not execute");
			};
			const cleanup = async ({ effectRequest }: any) => ({
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup",
					status: "succeeded",
					evidenceDigest: empiricalStrictJsonDigest({ effectRequest, cleaned: true }),
				},
			});
			const adapter = createD721ProviderCapableEffectAdapter({
				materialization: async () => badResult as any,
				providerRequest: never,
				retryWait: never,
				toolAction: never,
				hiddenVerifier: never,
				cleanup,
			});
			const run = await runD721ProviderCapableEffectAdapter({
				sourceDigest,
				budgetLimits,
				effectCeilings,
				adapter,
			});
			expect(consumeD721AdapterRunReceipt(run.receipt, run.underlyingBundle)).toMatchObject({
				executedEffectCount: 2,
				failedEffectCount: 1,
			});
			expect(getterHits).toBe(0);
		}
	});

	it("bounds nested qualification evidence before canonical snapshotting", async () => {
		const { bundle } = await runQualified();
		const oversized = structuredClone(bundle) as any;
		oversized.qualification.exercisedRetryReasons = Array.from(
			{ length: 4_096 },
			() => "d671-rate-limit-exceeded",
		);
		expect(() => validateD721ProviderCapablePreLiveBundle(oversized)).toThrow(/retry reasons/);
		let getterHits = 0;
		const accessor = structuredClone(bundle) as any;
		Object.defineProperty(accessor.generation, "generationDigest", {
			enumerable: true,
			get() {
				getterHits += 1;
				return bundle.generation.generationDigest;
			},
		});
		expect(() => validateD721ProviderCapablePreLiveBundle(accessor)).toThrow();
		expect(getterHits).toBe(0);
	});

	it("admits cancellation through Graph and still executes the owned cleanup before refusing qualification", async () => {
		const abortController = new AbortController();
		const fixture = createD721InjectedNoNetworkFixture({ abortController });
		await expect(
			runD721ProviderCapablePreLiveQualification({
				sourceDigest,
				budgetLimits,
				effectCeilings,
				adapter: fixture.adapter,
				signal: abortController.signal,
			}),
		).rejects.toThrow(/complete independent six-arm|conservative/);
		expect(fixture.cleanupCalls()).toBe(1);
		expect(fixture.remainingWorkspaces()).toBe(0);
	});

	it("persists only canonical Graph/D721 artifacts with exclusive atomic generation ownership", async () => {
		const { bundle } = await runQualified();
		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d721-")));
		await chmod(privateRoot, 0o700);
		try {
			const receipt = await persistD721ProviderCapablePreLiveBundle({ privateRoot, bundle });
			expect(receipt.generationRef).toBe(D721_GENERATION_REF);
			const finalRoot = join(privateRoot, D721_GENERATION_REF);
			expect((await lstat(finalRoot)).mode & 0o777).toBe(0o700);
			const artifactsRoot = join(finalRoot, "artifacts");
			const names = await readdir(artifactsRoot);
			expect(names.sort()).toEqual([
				"bundle.v1.json",
				"generation.v1.json",
				"graph-evidence.v1.json",
				"qualification.v1.json",
			]);
			for (const name of names)
				expect((await lstat(join(artifactsRoot, name))).mode & 0o777).toBe(0o600);
			const persisted = strictJsonCodec.decode(
				await readFile(join(artifactsRoot, "bundle.v1.json")),
			);
			expect(validateD721ProviderCapablePreLiveBundle(persisted).bundleDigest).toBe(
				bundle.bundleDigest,
			);
			await expect(
				persistD721ProviderCapablePreLiveBundle({ privateRoot, bundle }),
			).rejects.toThrow(/already exists/);
			expect((await readdir(finalRoot)).filter((name) => name.includes("staging"))).toEqual([]);
			await expect(
				persistD721ProviderCapablePreLiveBundle({
					privateRoot,
					bundle: structuredClone(bundle),
				}),
			).rejects.toThrow(/same-process/);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	}, 30_000);

	it("removes its exact claimed generation after injected precommit failures", async () => {
		for (const stage of ["after-claim", "after-artifacts-rename"] as const) {
			const { bundle } = await runQualified();
			const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d721-fault-")));
			await chmod(privateRoot, 0o700);
			try {
				await expect(
					persistD721ProviderCapablePreLiveBundle({
						privateRoot,
						bundle,
						fault: createD721PersistenceFaultForTest(stage),
					}),
				).rejects.toThrow(/injected/);
				expect(await readdir(privateRoot)).toEqual([]);
			} finally {
				await rm(privateRoot, { recursive: true, force: true });
			}
		}
	}, 30_000);

	it("contains no legacy observation, scorecard or generation wrapper", async () => {
		const { bundle } = await runQualified();
		const encoded = new TextDecoder().decode(strictJsonCodec.encode(bundle));
		expect(encoded).not.toContain("empirical-trial-block-observation");
		expect(encoded).not.toContain("scorecard");
		expect(encoded).not.toContain("credential");
		expect(encoded).not.toContain("rawBody");
		expect(encoded).not.toContain("invocationFacts");
	});
});
