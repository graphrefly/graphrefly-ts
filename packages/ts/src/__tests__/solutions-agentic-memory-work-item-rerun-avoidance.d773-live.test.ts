import { chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import { D733_DEEPSEEK_V4_FLASH_0731_PROFILE } from "../../evals/empirical-memory-rerun-avoidance/d733-coordinates.js";
import {
	createD733GraphNativeRouteAdmission,
	createD733RouteAccessProjection,
	createD733RouteEligibility,
} from "../../evals/empirical-memory-rerun-avoidance/d733-graph-native-route-profile.js";
import { runD771InjectedNoNetworkQualification } from "../../evals/empirical-memory-rerun-avoidance/d771-pre-live-qualification.js";
import {
	D773_BASELINE_COMMIT,
	D773_BUDGET_LIMITS,
	D773_DECISION_REF,
	D773_HISTORICAL_ARTIFACT_SHA256,
	D773_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
} from "../../evals/empirical-memory-rerun-avoidance/d773-coordinates.js";
import { validateD773LiveBundle } from "../../evals/empirical-memory-rerun-avoidance/d773-graph-native-live.js";
import { D773_IMPLEMENTATION_MANIFEST_DIGEST } from "../../evals/empirical-memory-rerun-avoidance/d773-implementation-manifest.js";
import {
	createD773LiveRouteDirective,
	invokeD773LiveRouteTurn,
	takeD773LiveRouteProposal,
} from "../../evals/empirical-memory-rerun-avoidance/d773-live-route-authority.js";
import { acquireD773SingleUseDispatchClaimAtRootForTest } from "../../evals/empirical-memory-rerun-avoidance/d773-single-use-dispatch-claim.js";

const encoder = new TextEncoder();
const sha = (label: string) => empiricalStrictJsonDigest({ label });

function routeAdmission() {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	return createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d773.injected-no-network.v1",
			allowedModels: [profile.requestModel],
			allowedProviders: [profile.providerName],
		}),
		eligibility: createD733RouteEligibility({
			profile,
			responseBytes: encoder.encode(
				JSON.stringify({
					data: {
						id: profile.requestModel,
						endpoints: [
							{
								name: `${profile.providerName} | ${profile.selectedEndpointModel}`,
								provider_name: profile.providerName,
								tag: profile.providerTag,
								quantization: profile.quantization,
								model: profile.selectedEndpointModel,
								supported_parameters: ["reasoning", "tool_choice", "tools"],
								pricing: {
									prompt: profile.pricing.promptUsdPerToken,
									completion: profile.pricing.completionUsdPerToken,
									input_cache_read: profile.pricing.cacheReadUsdPerToken,
								},
							},
						],
					},
				}),
			),
		}),
	});
}

describe("D773 D771-qualified Graph-native live boundary", () => {
	it("freezes the exact approved baseline and numeric boundary", () => {
		expect(D773_DECISION_REF).toBe("decision.D773");
		expect(D773_BASELINE_COMMIT).toBe("0446f6b6");
		expect(D773_HISTORICAL_ARTIFACT_SHA256).toBe(
			"sha256:d6994fea93b82eddb5e337cb8694b4842bbcc8f25a04cfd7668507efc2843a25",
		);
		expect(D773_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST).toBe(
			"sha256:6b3a371bc57a4d84b6a3b8adbfb96b4e8440ed314ec073fa020e71e0a0bd79f0",
		);
		expect(D773_BUDGET_LIMITS.maxCostMicrousd).toBe(6_000_000);
	});

	it("runs the qualified six-arm Graph fixture and binds a real-route request before transport", async () => {
		const baseline = await runD771InjectedNoNetworkQualification();
		expect(baseline.gate.passed).toBe(true);
		expect(baseline.graphEvidence.ledger.completedArms).toHaveLength(6);
		const providerFact = baseline.graphEvidence.effectRuns
			.flatMap((run) => run.facts)
			.find(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.request.effectKind === "provider-request" &&
					fact.request.attemptOrdinal === 1,
			);
		if (providerFact?.kind !== "graph-effect-result-admitted")
			throw new TypeError("provider fact missing");
		const admission = baseline.graphEvidence.ledger.effectAdmissions.find(
			(value) => value.decisionDigest === providerFact.admissionDigest,
		);
		if (admission === undefined) throw new TypeError("admission missing");
		const taskStatement = "Public D773 task statement";
		const conversation = Object.freeze({ messages: Object.freeze([]) });
		const directive = createD773LiveRouteDirective({
			arm: admission.arm,
			effectRequest: providerFact.request,
			admission,
			budgetLimits: D773_BUDGET_LIMITS,
			taskStatement,
			conversation,
		});
		let calls = 0;
		await invokeD773LiveRouteTurn({
			directive,
			effectRequest: providerFact.request as never,
			credential: {
				bearerToken: "not-a-live-d773-key",
				credentialBindingRef: "d773.injected",
				credentialBindingRevision: "v1",
			},
			transport: {
				async request() {
					calls += 1;
					return {
						status: 200,
						retryAfterMs: null,
						body: encoder.encode(
							JSON.stringify({
								id: "d773-injected",
								usage: { prompt_tokens: 1, completion_tokens: 1 },
								choices: [{ finish_reason: "stop", message: { content: "{}" } }],
								openrouter_metadata: {
									endpoints: {
										available: [
											{
												provider: "DeepInfra",
												model: "deepseek/deepseek-v4-flash-20260731",
												selected: true,
											},
										],
									},
								},
							}),
						),
					};
				},
			},
			taskStatement,
			conversation,
			signal: new AbortController().signal,
			monotonicNowMs: () => calls,
			routeAdmission: routeAdmission(),
			usageBasis: "measured",
		});
		expect(calls).toBe(1);
		expect(takeD773LiveRouteProposal(providerFact.request)?.requestDigest).toBe(
			providerFact.request.requestDigest,
		);
		const criterionFact = baseline.graphEvidence.effectRuns
			.flatMap((run) => run.facts)
			.find(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.request.effectKind === "provider-request" &&
					fact.request.attemptOrdinal === 1 &&
					fact.request.completionContext?.reason === "public-semantic-validation-failed",
			);
		if (criterionFact?.kind !== "graph-effect-result-admitted")
			throw new TypeError("criterion fact missing");
		const criterionAdmission = baseline.graphEvidence.ledger.effectAdmissions.find(
			(value) => value.decisionDigest === criterionFact.admissionDigest,
		);
		if (criterionAdmission === undefined) throw new TypeError("criterion admission missing");
		const criterionDirective = createD773LiveRouteDirective({
			arm: criterionAdmission.arm,
			effectRequest: criterionFact.request,
			admission: criterionAdmission,
			budgetLimits: D773_BUDGET_LIMITS,
			taskStatement,
			conversation,
		});
		let criterionCalls = 0;
		await invokeD773LiveRouteTurn({
			directive: criterionDirective,
			effectRequest: criterionFact.request as never,
			credential: {
				bearerToken: "not-a-live-d773-key",
				credentialBindingRef: "d773.injected",
				credentialBindingRevision: "v1",
			},
			transport: {
				async request(request) {
					criterionCalls += 1;
					const body = JSON.parse(new TextDecoder().decode(request.body));
					expect(body.tool_choice.function.name).toBe("replace_exact");
					return {
						status: 200,
						retryAfterMs: null,
						body: encoder.encode(
							JSON.stringify({
								id: "d773-criterion",
								usage: { prompt_tokens: 1, completion_tokens: 1 },
								choices: [
									{
										finish_reason: "tool_calls",
										message: {
											content: null,
											tool_calls: [
												{
													id: "d773-replace",
													type: "function",
													function: {
														name: "replace_exact",
														arguments: JSON.stringify({
															path: "fixture.ts",
															oldText: "a",
															newText: "b",
														}),
													},
												},
											],
										},
									},
								],
								openrouter_metadata: {
									endpoints: {
										available: [
											{
												provider: "DeepInfra",
												model: "deepseek/deepseek-v4-flash-20260731",
												selected: true,
											},
										],
									},
								},
							}),
						),
					};
				},
			},
			taskStatement,
			conversation,
			signal: new AbortController().signal,
			monotonicNowMs: () => criterionCalls,
			routeAdmission: routeAdmission(),
			usageBasis: "measured",
		});
		expect(criterionCalls).toBe(1);
		expect(takeD773LiveRouteProposal(criterionFact.request)?.requiredToolName).toBe(
			"replace_exact",
		);
	});

	it("makes the durable dispatch claim exclusive and rejects caller-authored bundles", async () => {
		const root = await mkdtemp(join(tmpdir(), "graphrefly-d773-claim-"));
		await chmod(root, 0o700);
		try {
			const input = {
				pricingReadDigest: sha("pricing"),
				zeroByokObservationDigest: sha("zero-byok"),
				implementationManifestDigest: D773_IMPLEMENTATION_MANIFEST_DIGEST,
			};
			await acquireD773SingleUseDispatchClaimAtRootForTest(await realpath(root), input);
			await expect(
				acquireD773SingleUseDispatchClaimAtRootForTest(await realpath(root), input),
			).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
		expect(() =>
			validateD773LiveBundle({
				schemaVersion: "graphrefly.b112.d773.live-bundle.v1",
				disposition: "success",
				graphEvidence: {},
				routeEvidence: {},
				qualification: {},
				observation: {},
				generation: {},
				terminalReceipt: {},
				bundleDigest: sha("forged"),
			}),
		).toThrow();
	});
});
