import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { createD19ProviderPort } from "../../evals/empirical-memory-rerun-avoidance/d19-current-real-provider-adapter.js";
import {
	createD19InjectedD18BaselineForTest,
	D19_INJECTED_TEST_GENERATION_REF,
	persistD19InjectedQualificationForTest,
	runD19InjectedNoNetworkQualification,
	validateD19QualificationBundle,
} from "../../evals/empirical-memory-rerun-avoidance/d19-current-real-provider-qualification.js";
import { strictJsonCodec } from "../../src/json/codec.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const injectedManifest = `sha256:${"1".repeat(64)}`;

describe("graphrefly-ts:D19 current real-provider composition", () => {
	let bundle: Awaited<ReturnType<typeof runD19InjectedNoNetworkQualification>>;
	let constructedBundle: Awaited<ReturnType<typeof runD19InjectedNoNetworkQualification>>;
	let globalNetworkCalls = 0;
	beforeAll(async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			globalNetworkCalls += 1;
			throw new TypeError("D19 global network is forbidden");
		}) as typeof fetch;
		try {
			constructedBundle = await runD19InjectedNoNetworkQualification({
				baseline: createD19InjectedD18BaselineForTest(),
				implementationManifestDigest: injectedManifest,
				repositoryRoot,
				generationRef: D19_INJECTED_TEST_GENERATION_REF,
			});
			bundle = validateD19QualificationBundle(constructedBundle);
		} finally {
			globalThis.fetch = originalFetch;
		}
	}, 180_000);

	it("qualifies six real local lifecycles and all bounded provider retry/failure paths without network", async () => {
		expect(bundle.qualification).toMatchObject({
			externalNetworkCalls: 0,
			armOrder: [
				"cold",
				"relevant-applied",
				"proposal-only",
				"admission-rejected",
				"irrelevant-applied",
				"wrong-scope-applied",
			],
			fullRealLocalLifecyclePassed: true,
			publicSemanticIndependentPassed: true,
			hiddenVerifierPassed: true,
			retryPoliciesPassed: ["D671", "D675", "D710"],
			maxActiveEffects: 1,
			workspaceResidueCount: 0,
			liveGateEvaluated: false,
			efficacyClaim: "none",
		});
		expect(globalNetworkCalls).toBe(0);
		expect(JSON.stringify(bundle)).not.toMatch(
			/authorization|Bearer|OPENROUTER_API_KEY|oldText|newText|stack|not-json/u,
		);
	}, 180_000);

	it("rejects accessor and re-digested canonical substitution", async () => {
		const accessor = Object.create(null) as Record<string, unknown>;
		for (const [key, value] of Object.entries(bundle)) accessor[key] = value;
		Object.defineProperty(accessor, "graphEvidence", { get: () => bundle.graphEvidence });
		expect(() => validateD19QualificationBundle(accessor)).toThrow(/own data property/u);
		const substituted = strictJsonCodec.decode(strictJsonCodec.encode(bundle)) as any;
		substituted.graphEvidence = substituted.retryEvidence.D671;
		expect(() => validateD19QualificationBundle(substituted)).toThrow();
	}, 180_000);

	it("reconciles every bounded post-response rejection conservatively instead of throwing", async () => {
		const body = Object.freeze({ model: "injected" });
		const effect = {
			kind: "provider-attempt",
			request: {
				requestDigest: empiricalStrictJsonDigest({ request: "d19-result-rejection" }),
				wireBodyDigest: empiricalStrictJsonDigest(body),
				reservation: { maxCostMicrousd: 100_000, maxElapsedMs: 120_000 },
			},
		} as any;
		const validResult = {
			choices: [
				{
					message: {
						tool_calls: [
							{
								function: {
									name: "read_file",
									arguments: JSON.stringify({ path: "packages/ts/package.json" }),
								},
							},
						],
					},
				},
			],
			usage: { prompt_tokens: 100, completion_tokens: 20 },
		};
		const cases = [
			() =>
				new Response(JSON.stringify(validResult), { headers: { "content-type": "text/plain" } }),
			() =>
				new Response(
					JSON.stringify({
						...validResult,
						choices: [
							{
								message: {
									tool_calls: [
										{
											function: {
												name: "read_file",
												arguments: JSON.stringify({
													path: "packages/ts/package.json",
													extra: true,
												}),
											},
										},
									],
								},
							},
						],
					}),
					{ headers: { "content-type": "application/json" } },
				),
			() =>
				new Response(
					JSON.stringify({
						...validResult,
						usage: { prompt_tokens: 2_000_000, completion_tokens: 200_000 },
					}),
					{ headers: { "content-type": "application/json" } },
				),
			() =>
				new Response("", {
					headers: {
						"content-length": String(2 * 1_048_576 + 1),
						"content-type": "application/json",
					},
				}),
		] as const;
		for (const response of cases) {
			const provider = createD19ProviderPort({
				bearerToken: "injected-no-network",
				fetchImpl: (async () => response()) as typeof fetch,
				now: (() => {
					let value = 0;
					return () => ++value;
				})(),
			});
			const result = await provider(effect, { kind: "provider-attempt", body });
			expect(result).toMatchObject({
				status: "failed",
				failureFamily: "executor",
				costBasis: "conservative-reservation",
				actualCostMicrousd: 100_000,
				retryProposal: null,
			});
		}
		const transport = createD19ProviderPort({
			bearerToken: "injected-no-network",
			fetchImpl: (async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new TypeError("injected body transport failure"));
						},
					}),
					{ headers: { "content-type": "application/json" } },
				)) as typeof fetch,
			now: (() => {
				let value = 0;
				return () => ++value;
			})(),
		});
		await expect(transport(effect, { kind: "provider-attempt", body })).resolves.toMatchObject({
			status: "failed",
			failureFamily: "transport",
			costBasis: "conservative-reservation",
			actualCostMicrousd: 100_000,
			retryProposal: null,
		});
	});

	it("atomically persists one test-only generation and rejects bundle replay", async () => {
		const privateRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d19-persist-")));
		try {
			const receipt = await persistD19InjectedQualificationForTest({
				privateRoot,
				bundle: constructedBundle,
			});
			const persisted = validateD19QualificationBundle(
				strictJsonCodec.decode(
					new Uint8Array(
						await readFile(join(privateRoot, receipt.generationRef, "artifacts", "bundle.v1.json")),
					),
				),
			);
			expect(persisted.bundleDigest).toBe(bundle.bundleDigest);
			await expect(
				persistD19InjectedQualificationForTest({ privateRoot, bundle: constructedBundle }),
			).rejects.toThrow(/forged or replayed/u);
		} finally {
			await rm(privateRoot, { recursive: true, force: true });
		}
	}, 180_000);
});
