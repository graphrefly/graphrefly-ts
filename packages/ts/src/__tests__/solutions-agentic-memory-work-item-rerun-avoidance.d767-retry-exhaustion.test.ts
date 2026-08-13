import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { createD761GraphPublicSemanticValidationPolicy } from "../../evals/empirical-memory-rerun-avoidance/d767-graph-native-effect-runtime.js";
import {
	createD720SimulatedCallerExecutor,
	runD722GraphNativeEvalCore,
} from "../../evals/empirical-memory-rerun-avoidance/d767-graph-native-eval.js";
import {
	createD767InjectedBaselineForTest,
	createD767PersistenceFaultForTest,
	D767_TEST_GENERATION_REF,
	persistD767QualificationBundle,
	runD767InjectedNoNetworkQualification,
	validateD767QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d767-retry-exhaustion-qualification.js";
import { strictJsonCodec } from "../json/codec.js";

const roots: string[] = [];

async function privateRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "graphrefly-d767-"));
	const canonical = await realpath(root);
	roots.push(canonical);
	return canonical;
}

afterEach(async () => {
	while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true });
});

describe("D767 Graph-local retry exhaustion", () => {
	it("keeps exact D710 exhaustion arm-local and admits every frozen arm", async () => {
		const bundle = await runD767InjectedNoNetworkQualification(createD767InjectedBaselineForTest());
		expect(bundle.graphEvidence.runStatus).toBe("complete");
		expect(bundle.graphEvidence.ledger.completedArms).toEqual([
			"cold",
			"relevant-applied",
			"proposal-only",
			"admission-rejected",
			"irrelevant-applied",
			"wrong-scope-applied",
		]);
		expect(bundle.qualification.exhaustedRunCount).toBe(3);
		expect(bundle.qualification.retryWaitCount).toBe(4);
		expect(bundle.qualification.networkCalls).toBe(0);
		const exhausted = bundle.graphEvidence.ledger.decisions.filter(
			(decision) => decision.stoppedReason === "provider-retry-exhausted",
		);
		expect(exhausted).toHaveLength(3);
		expect(exhausted.every((decision) => decision.disposition === "admit-next")).toBe(true);
		for (const decision of exhausted) {
			const run = bundle.graphEvidence.effectRuns[decision.runSequence]!;
			const providers = run.facts.filter(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.result.effectKind === "provider-request" &&
					fact.result.status === "retryable-failure",
			);
			const expectedAttempts =
				providers[0]?.result.effectKind === "provider-request" &&
				providers[0].result.failureDiscriminator.startsWith("d671-")
					? 3
					: 2;
			expect(providers).toHaveLength(expectedAttempts);
			expect(
				providers.map((fact) =>
					fact.kind === "graph-effect-result-admitted" ? fact.request.attemptOrdinal : -1,
				),
			).toEqual(Array.from({ length: expectedAttempts }, (_, index) => index + 1));
		}
	});

	it("rejects baseline replay and canonical evidence substitution", async () => {
		const baseline = createD767InjectedBaselineForTest();
		const bundle = await runD767InjectedNoNetworkQualification(baseline);
		await expect(runD767InjectedNoNetworkQualification(baseline)).rejects.toThrow(
			"fresh exact D766 baseline",
		);
		const forged = strictJsonCodec.decode(strictJsonCodec.encode(bundle)) as Record<
			string,
			unknown
		>;
		const graph = forged.graphEvidence as Record<string, unknown>;
		const ledger = graph.ledger as Record<string, unknown>;
		ledger.completedArms = ["cold"];
		expect(() => validateD767QualificationBundle(forged)).toThrow();
	});

	it("does not merge a changed retry discriminator into the admitted chain", async () => {
		let providerCalls = 0;
		const workspace = empiricalStrictJsonDigest({ d767: "identity-mismatch-workspace" });
		const executor = createD720SimulatedCallerExecutor(async ({ effectRequest }) => {
			if (effectRequest.effectKind === "materialization")
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "materialization" as const,
						status: "ready" as const,
						workspaceStateDigest: workspace,
						evidenceDigest: empiricalStrictJsonDigest({ d767: "materialized" }),
					},
				};
			if (effectRequest.effectKind === "provider-request") {
				providerCalls += 1;
				const failureDiscriminator =
					providerCalls === 1
						? ("d710-untyped-http-429" as const)
						: ("d675-und-err-socket" as const);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "provider-request" as const,
						status: "retryable-failure" as const,
						toolIntents: Object.freeze([]),
						failureDiscriminator,
						retryAfterMs: null,
						workspaceStateDigest: workspace,
						evidenceDigest: empiricalStrictJsonDigest({ d767: "retry", providerCalls }),
					},
				};
			}
			if (effectRequest.effectKind === "retry-wait")
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 60_000,
					result: {
						effectKind: "retry-wait" as const,
						status: "completed" as const,
						evidenceDigest: empiricalStrictJsonDigest({ d767: "wait" }),
					},
				};
			if (effectRequest.effectKind !== "cleanup") throw new TypeError("unexpected effect");
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup" as const,
					status: "succeeded" as const,
					evidenceDigest: empiricalStrictJsonDigest({ d767: "cleanup" }),
				},
			};
		});
		const result = await runD722GraphNativeEvalCore({
			sourceDigest: empiricalStrictJsonDigest({ d767: "identity-mismatch" }),
			budgetLimits: {
				maxRequests: 128,
				maxRetryWaits: 12,
				maxCostMicrousd: 6_000_000,
				maxElapsedMs: 7_200_000,
			},
			effectCeilings: {
				routeDigest: empiricalStrictJsonDigest({ route: "d767-test" }),
				providerMaxCostMicrousd: 10,
				providerMaxElapsedMs: 1_000,
				localEffectMaxElapsedMs: 60_000,
			},
			executor,
			objectivePhaseRecoveryPolicy: createD761GraphPublicSemanticValidationPolicy(),
		});
		expect(providerCalls).toBe(2);
		expect(result.ledger.runStatus).toBe("stopped");
		expect(result.ledger.decisions[0]?.stoppedReason).toBe("executor-failed");
		expect(result.ledger.completedArms).toEqual([]);
	});

	it("persists a private committed bundle and cleans an injected pre-commit failure", async () => {
		const root = await privateRoot();
		const first = await runD767InjectedNoNetworkQualification(createD767InjectedBaselineForTest());
		const receipt = await persistD767QualificationBundle({ privateRoot: root, bundle: first });
		expect(receipt.generationRef).toBe(D767_TEST_GENERATION_REF);
		const generation = join(root, D767_TEST_GENERATION_REF);
		expect((await stat(generation)).mode & 0o777).toBe(0o700);
		expect((await stat(join(generation, "bundle.v1.json"))).mode & 0o777).toBe(0o600);
		expect(
			validateD767QualificationBundle(
				strictJsonCodec.decode(await readFile(join(generation, "bundle.v1.json"))),
			).bundleDigest,
		).toBe(first.bundleDigest);

		const faultRoot = await privateRoot();
		const second = await runD767InjectedNoNetworkQualification(createD767InjectedBaselineForTest());
		await expect(
			persistD767QualificationBundle({
				privateRoot: faultRoot,
				bundle: second,
				fault: createD767PersistenceFaultForTest("after-bundle-write"),
			}),
		).rejects.toThrow("after-bundle-write");
		await expect(stat(join(faultRoot, D767_TEST_GENERATION_REF))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
});
