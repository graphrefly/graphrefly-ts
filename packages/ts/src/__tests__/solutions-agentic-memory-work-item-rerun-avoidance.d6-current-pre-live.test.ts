import { chmod, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
} from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { runCurrentGraphNativeNoNetworkQualification as runD5Qualification } from "../../evals/empirical-memory-rerun-avoidance/d5-inspection-batch-qualification.js";
import {
	CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST as D6_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentGraphLiveImplementation as measureD6Implementation,
} from "../../evals/empirical-memory-rerun-avoidance/d6-current-implementation-manifest.js";
import { CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST } from "../../evals/empirical-memory-rerun-avoidance/d6-current-live-coordinates.js";
import {
	persistCurrentGraphLiveQualification as persistD6Qualification,
	runCurrentGraphLiveNoNetworkQualification as runD6Qualification,
	validateCurrentGraphLiveQualificationBundle as validateD6Qualification,
} from "../../evals/empirical-memory-rerun-avoidance/d6-current-pre-live-qualification.js";
import {
	admitCurrentGraphProviderEffectResult,
	CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
	CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
	CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
	createCurrentGraphProviderAuthority,
	takeCurrentGraphProviderEffect,
} from "../../evals/empirical-memory-rerun-avoidance/d6-current-provider-authority.js";
import { strictJsonCodec } from "../../src/json/codec.js";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("graphrefly-ts:D6 current Graph-native provider pre-live", () => {
	it("discards a phase-rejected raw tool batch before admitting the next arm", () => {
		const authority = createCurrentGraphProviderAuthority({
			limits: CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
			routeProfile: CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
			taskProfile: CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
		});
		const workspaceStateDigest = empiricalStrictJsonDigest({ workspace: "d14-regression" });
		const providerUsage = {
			requests: 1 as const,
			inputTokens: 1,
			outputTokens: 1,
			cacheReadTokens: 0,
			actualCostMicrousd: 1,
			actualElapsedMs: 1,
			costBasis: "reported" as const,
		};
		const completeMaterialization = () => {
			const effect = takeCurrentGraphProviderEffect(authority)!;
			expect(effect.request.effectKind).toBe("materialization");
			admitCurrentGraphProviderEffectResult(authority, effect.request.requestDigest, {
				effectKind: "materialization",
				status: "completed",
				workspaceStateDigest,
				evidenceDigest: empiricalStrictJsonDigest({ effect: effect.request.requestDigest }),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			});
		};
		const admitReadBatch = (prefix: string) => {
			const effect = takeCurrentGraphProviderEffect(authority)!;
			expect(effect.request.effectKind).toBe("provider-request");
			const toolCalls = ["a", "b", "c", "d"].map((suffix) => ({
				toolRef: "read-file" as const,
				path: `src/${prefix}-${suffix}.ts`,
			}));
			const fact = admitCurrentGraphProviderEffectResult(authority, effect.request.requestDigest, {
				effectKind: "provider-request",
				status: "completed",
				toolCalls,
				failureCode: null,
				retryProposal: null,
				usage: providerUsage,
				evidenceDigest: empiricalStrictJsonDigest({
					request: effect.request.requestDigest,
					toolCalls,
				}),
			});
			return { fact, toolCalls };
		};

		completeMaterialization();
		const firstBatch = admitReadBatch("cold");
		for (const expected of firstBatch.toolCalls) {
			const effect = takeCurrentGraphProviderEffect(authority)!;
			expect(effect.request).toMatchObject({ effectKind: "tool-action", toolRef: "read-file" });
			expect(effect.runtime.toolArguments).toEqual(expected);
			admitCurrentGraphProviderEffectResult(authority, effect.request.requestDigest, {
				effectKind: "tool-action",
				toolRef: "read-file",
				status: "succeeded",
				causeCode: null,
				workspaceStateBeforeDigest: workspaceStateDigest,
				workspaceStateAfterDigest: workspaceStateDigest,
				nonEmptyDiff: false,
				evidenceDigest: empiricalStrictJsonDigest({ read: expected.path }),
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
			});
		}

		const invalidMutation = takeCurrentGraphProviderEffect(authority)!;
		expect(invalidMutation.request.effectKind).toBe("provider-request");
		const invalidMutationFact = admitCurrentGraphProviderEffectResult(
			authority,
			invalidMutation.request.requestDigest,
			{
				effectKind: "provider-request",
				status: "completed",
				toolCalls: [
					{
						toolRef: "replace-exact",
						path: "src/current.ts",
						oldText: "old",
						newText: "new",
					},
				],
				failureCode: null,
				retryProposal: null,
				usage: providerUsage,
				evidenceDigest: empiricalStrictJsonDigest({ invalid: "phase-batch" }),
			},
		);
		expect(invalidMutationFact.result.effectKind).toBe("provider-request");
		const cleanup = takeCurrentGraphProviderEffect(authority)!;
		expect(cleanup.request.effectKind).toBe("cleanup");
		expect(cleanup.runtime.toolArguments).toBeNull();
		admitCurrentGraphProviderEffectResult(authority, cleanup.request.requestDigest, {
			effectKind: "cleanup",
			status: "completed",
			workspaceStateDigest: null,
			evidenceDigest: empiricalStrictJsonDigest({ cleanup: cleanup.request.requestDigest }),
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		});

		completeMaterialization();
		const nextBatch = admitReadBatch("relevant");
		expect(nextBatch.fact.sequence).toBe(invalidMutationFact.sequence + 3);
		const nextRead = takeCurrentGraphProviderEffect(authority)!;
		expect(nextRead.request).toMatchObject({
			arm: "relevant-applied",
			effectKind: "tool-action",
			toolRef: "read-file",
		});
		expect(nextRead.runtime.toolArguments).toEqual(nextBatch.toolCalls[0]);
	});

	it("qualifies the D5 four-read Graph through the provider-capable six-arm composition", async () => {
		const repositoryRoot = resolve(import.meta.dirname, "../../../..");
		const d5Bundle = await runD5Qualification();
		const d5Bytes = strictJsonCodec.encode(d5Bundle);
		expect(empiricalSha256(d5Bytes)).toBe(CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST);
		expect(await measureD6Implementation(repositoryRoot)).toBe(D6_IMPLEMENTATION_MANIFEST_DIGEST);

		const tampered = d5Bytes.slice();
		tampered[tampered.length - 1] ^= 1;
		await expect(
			runD6Qualification({
				repositoryRoot,
				d5QualificationBundleBytes: tampered,
				implementationManifestDigest: D6_IMPLEMENTATION_MANIFEST_DIGEST,
			}),
		).rejects.toThrow("D5 qualification artifact drifted");

		const constructed = await runD6Qualification({
			repositoryRoot,
			d5QualificationBundleBytes: d5Bytes,
			implementationManifestDigest: D6_IMPLEMENTATION_MANIFEST_DIGEST,
		});
		const bundle = validateD6Qualification(constructed);
		expect(bundle.qualification).toMatchObject({
			decisionRef: "graphrefly-ts:D6",
			fullSixArmIntegrationPassed: true,
			fourReadInspectionBatchCount: 6,
			serialReadEffectCount: 24,
			providerAttempts: 13,
			retryWaits: 1,
			maxActiveTransport: 1,
			providerNetworkCalls: 0,
			workspaceResidueCount: 0,
			phaseRejectedBatchIsolationPassed: true,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
		});
		expect(bundle.graphBundle.graphEvidence?.workflowEvidence.runs).toHaveLength(6);
		expect(
			bundle.graphBundle.graphEvidence?.workflowEvidence.runs.every(
				(run) => run.cleanupStatus === "completed",
			),
		).toBe(true);

		const privateRoot = await mkdtemp(join(tmpdir(), "graphrefly-d6-pre-live-"));
		await chmod(privateRoot, 0o700);
		const canonicalRoot = await realpath(privateRoot);
		roots.push(canonicalRoot);
		const receipt = await persistD6Qualification({
			privateRoot: canonicalRoot,
			bundle: constructed,
		});
		const artifactRoot = join(canonicalRoot, receipt.generationRef, "artifacts");
		expect((await stat(join(artifactRoot, "bundle.v1.json"))).mode & 0o777).toBe(0o600);
		expect(await readFile(join(artifactRoot, "bundle.v1.json"))).not.toHaveLength(0);

		const replayRoot = await mkdtemp(join(tmpdir(), "graphrefly-d6-replay-"));
		await chmod(replayRoot, 0o700);
		roots.push(await realpath(replayRoot));
		await expect(
			persistD6Qualification({ privateRoot: replayRoot, bundle: constructed }),
		).rejects.toThrow("same-process and single-use");
	}, 300_000);
});
