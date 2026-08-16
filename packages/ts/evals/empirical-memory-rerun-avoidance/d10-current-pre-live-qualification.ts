import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import {
	admitCurrentGraphLiveZeroByok as admitD10CurrentGraphLiveZeroByok,
	composeCurrentGraphLivePreclaim as composeD10CurrentGraphLivePreclaim,
	readCurrentGraphLiveOfficialPricing as readD10CurrentGraphLiveOfficialPricing,
} from "./d8-current-live-preflight.js";
import {
	createCurrentGraphOpenRouterExecutor,
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK as D10_CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK as D10_CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
} from "./d8-current-openrouter-adapter.js";
import { validateD9QualificationBundle } from "./d9-current-pre-live-qualification.js";
import {
	type D10CurrentGraphLiveBundleV1,
	runD10CurrentGraphLiveMeasurement,
	validateD10CurrentGraphLiveBundle,
} from "./d10-current-live.js";
import {
	acquireD10CurrentGraphLiveDispatchClaimAtRootForTest,
	consumeD10CurrentGraphLiveDispatchClaim,
} from "./d10-current-live-claim.js";
import {
	D10_CURRENT_GRAPH_LIVE_DECISION_REF,
	D10_CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	D10_CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	D10_CURRENT_GRAPH_LIVE_QUANTIZATION,
	D10_CURRENT_GRAPH_LIVE_READABLE_FILES,
	D10_CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	D10_CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
	D10_D9_IMPLEMENTATION_MANIFEST_DIGEST,
	D10_D9_QUALIFICATION_ARTIFACT_DIGEST,
	D10_D9_QUALIFICATION_BUNDLE_DIGEST,
	D10_D9_QUALIFICATION_DIGEST,
} from "./d10-current-live-coordinates.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";

export const D10_CURRENT_GRAPH_LIVE_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d10.current-graph-live-no-network-qualification.v1" as const;
export const D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d10.current-graph-live-no-network-generation.v1" as const;
export const D10_CURRENT_GRAPH_LIVE_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d10.current-graph-live-no-network-bundle.v1" as const;
export const D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF =
	"current-graph-native-live-no-network-qualification-2026-08-15-d10-v1" as const;
export const D10_CURRENT_GRAPH_LIVE_MAX_QUALIFICATION_BYTES = 4_194_304;
export const D10_CURRENT_GRAPH_LIVE_QUALIFICATION_PERSISTENCE_SCHEMA =
	"graphrefly-ts.d10.current-graph-live-no-network-persistence.v1" as const;

export interface D10CurrentGraphLiveQualificationBundleV1 {
	readonly schemaVersion: typeof D10_CURRENT_GRAPH_LIVE_QUALIFICATION_BUNDLE_SCHEMA;
	readonly qualification: Readonly<{
		schemaVersion: typeof D10_CURRENT_GRAPH_LIVE_QUALIFICATION_SCHEMA;
		decisionRef: typeof D10_CURRENT_GRAPH_LIVE_DECISION_REF;
		implementationManifestDigest: string;
		baselineBasis: "exact-d9-artifact" | "injected-test";
		d9QualificationArtifactDigest: typeof D10_D9_QUALIFICATION_ARTIFACT_DIGEST;
		d9QualificationBundleDigest: typeof D10_D9_QUALIFICATION_BUNDLE_DIGEST;
		d9QualificationDigest: typeof D10_D9_QUALIFICATION_DIGEST;
		graphBundleDigest: string;
		fullSixArmIntegrationPassed: true;
		fourReadInspectionBatchCount: 5;
		serialReadEffectCount: 20;
		providerAttempts: number;
		retryWaits: 1;
		maxActiveTransport: 1;
		providerNetworkCalls: 0;
		providerRejectionCount: 1;
		conservativeRejectionAccountingPassed: true;
		rejectionCleanupAndNextArmPassed: true;
		workspaceResidueCount: 0;
		retryRequestIdentityPassed: true;
		publicSemanticValidationPassed: true;
		hiddenVerifierPassed: true;
		cleanupPassed: true;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualificationDigest: string;
	}>;
	readonly graphBundle: D10CurrentGraphLiveBundleV1;
	readonly generation: Readonly<{
		schemaVersion: typeof D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_SCHEMA;
		generationRef: typeof D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF;
		qualificationDigest: string;
		graphBundleDigest: string;
		implementationManifestDigest: string;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

export interface D10CurrentGraphLiveQualificationPersistenceReceiptV1 {
	readonly schemaVersion: typeof D10_CURRENT_GRAPH_LIVE_QUALIFICATION_PERSISTENCE_SCHEMA;
	readonly generationRef: typeof D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF;
	readonly bundleArtifactDigest: string;
	readonly bundleDigest: string;
	readonly generationDigest: string;
	readonly qualificationDigest: string;
	readonly receiptDigest: string;
}

const constructed = new WeakSet<object>();
const baselines = new WeakMap<object, "exact-d9-artifact" | "injected-test">();

export interface D10D9BaselineAdmissionV1 {
	readonly bundleDigest: typeof D10_D9_QUALIFICATION_BUNDLE_DIGEST;
	readonly qualificationDigest: typeof D10_D9_QUALIFICATION_DIGEST;
}

function officialPricingResponse() {
	const response = new Response(
		JSON.stringify({
			data: {
				id: D10_CURRENT_GRAPH_LIVE_REQUEST_MODEL,
				endpoints: [
					{
						provider_name: D10_CURRENT_GRAPH_LIVE_PROVIDER_NAME,
						tag: D10_CURRENT_GRAPH_LIVE_PROVIDER_TAG,
						quantization: D10_CURRENT_GRAPH_LIVE_QUANTIZATION,
						model: D10_CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
						supported_parameters: ["max_tokens", "reasoning", "tool_choice", "tools"],
						pricing: {
							prompt: "0.00000008",
							completion: "0.00000018",
							input_cache_read: "0.000000016",
						},
					},
				],
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
	Object.defineProperty(response, "url", {
		value: "https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints",
	});
	return response;
}

function validateD9QualificationBytes(bytesValue: Uint8Array) {
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D10_D9_QUALIFICATION_ARTIFACT_DIGEST)
		throw new TypeError("D10 D9 qualification artifact drifted");
	const bundle = validateD9QualificationBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.bundleDigest !== D10_D9_QUALIFICATION_BUNDLE_DIGEST ||
		bundle.qualification.implementationManifestDigest !== D10_D9_IMPLEMENTATION_MANIFEST_DIGEST ||
		bundle.qualification.qualificationDigest !== D10_D9_QUALIFICATION_DIGEST
	)
		throw new TypeError("D10 D9 qualification coordinates drifted");
	return Object.freeze({
		bundleDigest: D10_D9_QUALIFICATION_BUNDLE_DIGEST,
		qualificationDigest: D10_D9_QUALIFICATION_DIGEST,
	});
}

export function admitD10D9QualificationBaseline(bytesValue: Uint8Array): D10D9BaselineAdmissionV1 {
	const baseline = validateD9QualificationBytes(bytesValue);
	baselines.set(baseline, "exact-d9-artifact");
	return baseline;
}

export function createD10InjectedD9BaselineForTest(): D10D9BaselineAdmissionV1 {
	const baseline = Object.freeze({
		bundleDigest: D10_D9_QUALIFICATION_BUNDLE_DIGEST,
		qualificationDigest: D10_D9_QUALIFICATION_DIGEST,
	});
	baselines.set(baseline, "injected-test");
	return baseline;
}

export async function runD10CurrentGraphLiveNoNetworkQualification(inputValue: {
	readonly repositoryRoot: string;
	readonly baseline: D10D9BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
}): Promise<D10CurrentGraphLiveQualificationBundleV1> {
	const input = record(inputValue, "current.live.qualification.input");
	exactKeys(
		input,
		["baseline", "implementationManifestDigest", "repositoryRoot"],
		"current.live.qualification.input",
	);
	const d9 = input.baseline as D10D9BaselineAdmissionV1;
	const baselineBasis = typeof d9 === "object" && d9 !== null ? baselines.get(d9) : undefined;
	if (baselineBasis === undefined) throw new TypeError("D10 D9 baseline is forged or consumed");
	baselines.delete(d9);
	const implementationManifestDigest = digest(
		input.implementationManifestDigest,
		"current.live.qualification.implementationManifestDigest",
	);
	const repositoryRoot = await realpath(resolve(String(input.repositoryRoot)));
	const temporaryRoot = await mkdtemp(join(tmpdir(), "graphrefly-current-live-d8-"));
	await chmod(temporaryRoot, 0o700);
	try {
		const credential = Object.freeze({
			bearerToken: "sk-or-v1-test-current-graph-live-key-xyz",
			credentialBindingRef: "openrouter.local-eval-2" as const,
			credentialBindingRevision: "2026-08-14.v1" as const,
		});
		const nowMs = Math.trunc(performance.timeOrigin + performance.now());
		const pricing = await readD10CurrentGraphLiveOfficialPricing({
			fetch: async () => officialPricingResponse(),
			nowMs: () => nowMs,
		});
		const zeroByokBytes = Buffer.from(
			JSON.stringify({
				schemaVersion: "graphrefly-ts.d8.current-graph-live-zero-byok-observation.v1",
				decisionRef: "graphrefly-ts:D8",
				decisionRevision: "2026-08-15.v1",
				workspaceName: "GraphReFly",
				workspaceSlug: "graph-re-fly",
				keyName: "Local Eval 2",
				keyVisiblePrefix: credential.bearerToken.slice(0, 12),
				keyVisibleSuffix: credential.bearerToken.slice(-3),
				byokCredentialCount: 0,
				allowedModels: [D10_CURRENT_GRAPH_LIVE_REQUEST_MODEL],
				allowedProviders: [D10_CURRENT_GRAPH_LIVE_PROVIDER_NAME],
				observedAt: new Date(nowMs).toISOString(),
				source: "openrouter-browser-settings",
			}),
		);
		const zeroByok = admitD10CurrentGraphLiveZeroByok({
			bytes: zeroByokBytes,
			credential,
			nowMs,
		});
		const preclaim = composeD10CurrentGraphLivePreclaim({
			pricingObservation: pricing,
			zeroByokObservation: zeroByok,
			credential,
		});
		const privateRoot = join(temporaryRoot, "private");
		await mkdir(privateRoot, { mode: 0o700 });
		const claim = await acquireD10CurrentGraphLiveDispatchClaimAtRootForTest(
			await realpath(privateRoot),
			{
				preclaim,
				implementationManifestDigest,
				qualificationArtifactDigest: empiricalStrictJsonDigest({ injected: "d10" }),
				qualificationDigest: empiricalStrictJsonDigest({ injected: "d10-qualification" }),
			},
		);
		const currentKeyAdmission = await createOpenRouterCurrentKeySpendAdmissionCapability({
			fetch: async () =>
				new Response(
					JSON.stringify({
						data: {
							limit: 32,
							limit_remaining: 31,
							usage: 1,
							limit_reset: null,
							is_management_key: false,
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		}).read({
			credential,
			expectedLimitMicrousd: 32_000_000,
			requiredRemainingMicrousd: 6_000_000,
			signal: new AbortController().signal,
		});
		const executionAuthority = await consumeD10CurrentGraphLiveDispatchClaim({
			claim,
			currentKeyAdmission,
			allowInjectedTestScope: true,
		});
		let active = 0;
		let maxActive = 0;
		let providerCalls = 0;
		let retryInjected = false;
		let pendingRetryBodyDigest: string | null = null;
		const fetchImpl: typeof fetch = async (_url, init) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			providerCalls += 1;
			try {
				const bodyBytes = Buffer.from(init?.body as Uint8Array);
				const body = JSON.parse(bodyBytes.toString("utf8"));
				const currentBodyDigest = empiricalSha256(bodyBytes);
				if (!retryInjected) {
					retryInjected = true;
					pendingRetryBodyDigest = currentBodyDigest;
					return new Response(JSON.stringify({ error: { message: "bounded" } }), {
						status: 429,
						headers: { "content-type": "application/json", "retry-after": "0" },
					});
				}
				if (pendingRetryBodyDigest !== null) {
					if (pendingRetryBodyDigest !== currentBodyDigest)
						throw new TypeError("current live injected retry request bytes drifted");
					pendingRetryBodyDigest = null;
				}
				const hasReadResult = body.messages.some(
					(message: { role?: string; content?: string }) =>
						message.role === "tool" && message.content?.includes("function admittedEnvelope"),
				);
				const calls = hasReadResult
					? [
							{
								id: `replace-${providerCalls}`,
								type: "function",
								function: {
									name: "replace_exact",
									arguments: JSON.stringify({
										path: "packages/ts/src/executors/managed-cloud-postgresql.ts",
										oldText: D10_CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
										newText: D10_CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
									}),
								},
							},
							{
								id: `diff-${providerCalls}`,
								type: "function",
								function: { name: "workspace_diff", arguments: "{}" },
							},
							{
								id: `validate-${providerCalls}`,
								type: "function",
								function: { name: "focused_validation", arguments: "{}" },
							},
						]
					: D10_CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) => ({
							id: `read-${providerCalls}-${index}`,
							type: "function",
							function: {
								name: "read_file",
								arguments: JSON.stringify({ path }),
							},
						}));
				return new Response(
					JSON.stringify({
						choices: [{ message: { role: "assistant", content: null, tool_calls: calls } }],
						usage: {
							prompt_tokens: 100,
							completion_tokens: 20,
							prompt_tokens_details: { cached_tokens: 0 },
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			} finally {
				active -= 1;
			}
		};
		const materializationRoot = join(temporaryRoot, "workspaces");
		const baseExecutor = createCurrentGraphOpenRouterExecutor({
			repositoryRoot,
			materializationRoot,
			credential,
			fetchImpl,
			sleep: async () => undefined,
		});
		let rejectionInjected = false;
		const executor = Object.freeze({
			async execute(effect: Parameters<typeof baseExecutor.execute>[0]) {
				if (effect.request.effectKind === "provider-request" && !rejectionInjected) {
					rejectionInjected = true;
					return {
						effectKind: "provider-request",
						status: "completed",
						toolCalls: "invalid",
					} as never;
				}
				return baseExecutor.execute(effect);
			},
			dispose: () => baseExecutor.dispose(),
		});
		const graphBundle = validateD10CurrentGraphLiveBundle(
			await runD10CurrentGraphLiveMeasurement({
				executionAuthority,
				executionClass: "injected-no-network",
				executor,
				implementationManifestDigest,
				d9QualificationArtifactDigest: D10_D9_QUALIFICATION_ARTIFACT_DIGEST,
				pricingObservationDigest: pricing.observationDigest,
				zeroByokObservationDigest: zeroByok.observationDigest,
			}),
		);
		if (graphBundle.disposition !== "success" || graphBundle.graphEvidence === null)
			throw new TypeError("current live no-network Graph integration did not complete");
		const d9Graph = graphBundle.graphEvidence;
		const graph = d9Graph.providerEvidence;
		const fourReadInspectionBatchCount = graph.facts.filter(
			(fact) =>
				fact.request.effectKind === "provider-request" &&
				fact.result.effectKind === "provider-request" &&
				fact.result.status === "completed" &&
				fact.result.toolCalls.length === 4 &&
				fact.result.toolCalls.every((call) => call.toolRef === "read-file"),
		).length;
		const serialReadEffectCount = graph.facts.filter(
			(fact) =>
				fact.request.effectKind === "tool-action" &&
				fact.result.effectKind === "tool-action" &&
				fact.result.toolRef === "read-file" &&
				fact.result.status === "succeeded",
		).length;
		const runs = graph.workflowEvidence.runs;
		const rejectionProviderFact = graph.facts.find(
			(fact) => fact.factDigest === d9Graph.rejectionFacts[0]?.providerFactDigest,
		);
		const rejectionAccountingConservative =
			rejectionProviderFact?.result.effectKind === "provider-request" &&
			rejectionProviderFact.result.usage.costBasis === "conservative-reservation";
		if (
			runs.length !== 6 ||
			runs[0]?.status !== "incomplete" ||
			runs[0]?.cleanupStatus !== "completed" ||
			runs
				.slice(1)
				.some(
					(run) =>
						run.status !== "completed" ||
						!run.publicSemanticValidationPassed ||
						!run.hiddenVerifierPassed ||
						run.cleanupStatus !== "completed",
				)
		)
			throw new TypeError("current live no-network six-arm projection drifted");
		if (
			graph.budget.providerAttempts !== providerCalls + d9Graph.rejectionCount ||
			graph.budget.retryWaits !== 1 ||
			maxActive !== 1 ||
			fourReadInspectionBatchCount !== 5 ||
			serialReadEffectCount !== 20 ||
			d9Graph.rejectionCount !== 1 ||
			d9Graph.rejectionFacts[0]?.causeCode !== "provider-result-schema-invalid" ||
			!rejectionAccountingConservative
		)
			throw new TypeError(
				`current live no-network accounting drifted: ${JSON.stringify({ providerAttempts: graph.budget.providerAttempts, providerCalls, retryWaits: graph.budget.retryWaits, maxActive, fourReadInspectionBatchCount, serialReadEffectCount, rejectionCount: d9Graph.rejectionCount, rejectionCause: d9Graph.rejectionFacts[0]?.causeCode, rejectionAccountingConservative, runs: runs.map((run) => ({ status: run.status, cleanup: run.cleanupStatus })) })}`,
			);
		const residue = await readFile(
			join(repositoryRoot, "packages/ts/src/executors/managed-cloud-postgresql.ts"),
		);
		if (!new TextDecoder().decode(residue).includes(D10_CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK))
			throw new TypeError("current live no-network mutated the source workspace");
		await lstat(materializationRoot).then(
			() => {
				throw new TypeError("current live no-network left workspace residue");
			},
			(error: unknown) => {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			},
		);
		const qualificationMaterial = strictSnapshot({
			schemaVersion: D10_CURRENT_GRAPH_LIVE_QUALIFICATION_SCHEMA,
			decisionRef: D10_CURRENT_GRAPH_LIVE_DECISION_REF,
			implementationManifestDigest,
			baselineBasis,
			d9QualificationArtifactDigest: D10_D9_QUALIFICATION_ARTIFACT_DIGEST,
			d9QualificationBundleDigest: d9.bundleDigest,
			d9QualificationDigest: d9.qualificationDigest,
			graphBundleDigest: graphBundle.bundleDigest,
			fullSixArmIntegrationPassed: true as const,
			fourReadInspectionBatchCount: 5 as const,
			serialReadEffectCount: 20 as const,
			providerAttempts: graph.budget.providerAttempts,
			retryWaits: 1 as const,
			maxActiveTransport: 1 as const,
			providerNetworkCalls: 0 as const,
			providerRejectionCount: 1 as const,
			conservativeRejectionAccountingPassed: true as const,
			rejectionCleanupAndNextArmPassed: true as const,
			workspaceResidueCount: 0 as const,
			retryRequestIdentityPassed: true as const,
			publicSemanticValidationPassed: true as const,
			hiddenVerifierPassed: true as const,
			cleanupPassed: true as const,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
		});
		const qualification = Object.freeze({
			...qualificationMaterial,
			qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
		});
		const generationMaterial = strictSnapshot({
			schemaVersion: D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_SCHEMA,
			generationRef: D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
			qualificationDigest: qualification.qualificationDigest,
			graphBundleDigest: graphBundle.bundleDigest,
			implementationManifestDigest,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
		});
		const generation = Object.freeze({
			...generationMaterial,
			generationDigest: empiricalStrictJsonDigest(generationMaterial),
		});
		const bundleMaterial = strictSnapshot({
			schemaVersion: D10_CURRENT_GRAPH_LIVE_QUALIFICATION_BUNDLE_SCHEMA,
			qualification,
			graphBundle,
			generation,
		});
		const bundle = Object.freeze({
			...bundleMaterial,
			bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
		}) as D10CurrentGraphLiveQualificationBundleV1;
		if (
			strictJsonCodec.encode(bundle as unknown as StrictJsonValue).byteLength >
			D10_CURRENT_GRAPH_LIVE_MAX_QUALIFICATION_BYTES
		)
			throw new TypeError("current live qualification exceeded its byte bound");
		constructed.add(bundle);
		return bundle;
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export function validateD10CurrentGraphLiveQualificationBundle(
	value: unknown,
): D10CurrentGraphLiveQualificationBundleV1 {
	const candidate = record(value, "current.live.qualification.bundle");
	exactKeys(
		candidate,
		["bundleDigest", "generation", "graphBundle", "qualification", "schemaVersion"],
		"current.live.qualification.bundle",
	);
	if (candidate.schemaVersion !== D10_CURRENT_GRAPH_LIVE_QUALIFICATION_BUNDLE_SCHEMA)
		throw new TypeError("current live qualification bundle schema drifted");
	const graphBundle = validateD10CurrentGraphLiveBundle(candidate.graphBundle);
	if (graphBundle.executionClass !== "injected-no-network" || graphBundle.disposition !== "success")
		throw new TypeError("current live qualification Graph bundle drifted");
	const qualification = record(candidate.qualification, "current.live.qualification");
	exactKeys(
		qualification,
		[
			"baselineBasis",
			"causalAttribution",
			"cleanupPassed",
			"conservativeRejectionAccountingPassed",
			"d9QualificationArtifactDigest",
			"d9QualificationBundleDigest",
			"d9QualificationDigest",
			"decisionRef",
			"efficacyClaim",
			"fullSixArmIntegrationPassed",
			"fourReadInspectionBatchCount",
			"graphBundleDigest",
			"hiddenVerifierPassed",
			"implementationManifestDigest",
			"maxActiveTransport",
			"providerAttempts",
			"providerNetworkCalls",
			"providerRejectionCount",
			"publicSemanticValidationPassed",
			"qualificationDigest",
			"retryRequestIdentityPassed",
			"retryWaits",
			"rejectionCleanupAndNextArmPassed",
			"schemaVersion",
			"serialReadEffectCount",
			"workspaceResidueCount",
		],
		"current.live.qualification",
	);
	const { qualificationDigest, ...qualificationMaterial } = qualification;
	const d9Graph = graphBundle.graphEvidence;
	if (d9Graph === null) throw new TypeError("current live qualification Graph evidence is missing");
	const graph = d9Graph.providerEvidence;
	const fourReadInspectionBatchCount = graph.facts.filter(
		(fact) =>
			fact.request.effectKind === "provider-request" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.status === "completed" &&
			fact.result.toolCalls.length === 4 &&
			fact.result.toolCalls.every((call) => call.toolRef === "read-file"),
	).length;
	const serialReadEffectCount = graph.facts.filter(
		(fact) =>
			fact.request.effectKind === "tool-action" &&
			fact.result.effectKind === "tool-action" &&
			fact.result.toolRef === "read-file" &&
			fact.result.status === "succeeded",
	).length;
	const runs = graph.workflowEvidence.runs;
	const rejectionProviderFact = graph.facts.find(
		(fact) => fact.factDigest === d9Graph.rejectionFacts[0]?.providerFactDigest,
	);
	const rejectionAccountingConservative =
		rejectionProviderFact?.result.effectKind === "provider-request" &&
		rejectionProviderFact.result.usage.costBasis === "conservative-reservation";
	if (
		qualification.schemaVersion !== D10_CURRENT_GRAPH_LIVE_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== D10_CURRENT_GRAPH_LIVE_DECISION_REF ||
		(qualification.baselineBasis !== "exact-d9-artifact" &&
			qualification.baselineBasis !== "injected-test") ||
		qualification.d9QualificationArtifactDigest !== D10_D9_QUALIFICATION_ARTIFACT_DIGEST ||
		qualification.d9QualificationBundleDigest !== D10_D9_QUALIFICATION_BUNDLE_DIGEST ||
		qualification.d9QualificationDigest !== D10_D9_QUALIFICATION_DIGEST ||
		qualification.graphBundleDigest !== graphBundle.bundleDigest ||
		qualification.fullSixArmIntegrationPassed !== true ||
		qualification.fourReadInspectionBatchCount !== fourReadInspectionBatchCount ||
		fourReadInspectionBatchCount !== 5 ||
		qualification.retryWaits !== 1 ||
		qualification.maxActiveTransport !== 1 ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.retryRequestIdentityPassed !== true ||
		qualification.serialReadEffectCount !== serialReadEffectCount ||
		serialReadEffectCount !== 20 ||
		qualification.providerRejectionCount !== 1 ||
		d9Graph.rejectionCount !== 1 ||
		d9Graph.rejectionFacts[0]?.causeCode !== "provider-result-schema-invalid" ||
		!rejectionAccountingConservative ||
		qualification.conservativeRejectionAccountingPassed !== true ||
		qualification.rejectionCleanupAndNextArmPassed !== true ||
		runs.length !== 6 ||
		runs[0]?.status !== "incomplete" ||
		runs[0]?.cleanupStatus !== "completed" ||
		runs
			.slice(1)
			.some(
				(run) =>
					run.status !== "completed" ||
					!run.publicSemanticValidationPassed ||
					!run.hiddenVerifierPassed ||
					run.cleanupStatus !== "completed",
			) ||
		qualification.publicSemanticValidationPassed !== true ||
		qualification.hiddenVerifierPassed !== true ||
		qualification.cleanupPassed !== true ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none" ||
		qualification.providerAttempts !== graph.budget.providerAttempts ||
		qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial)
	)
		throw new TypeError("current live qualification projection drifted");
	const generation = record(candidate.generation, "current.live.qualification.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"graphBundleDigest",
			"implementationManifestDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"current.live.qualification.generation",
	);
	const { generationDigest, ...generationMaterial } = generation;
	if (
		generation.schemaVersion !== D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_SCHEMA ||
		generation.generationRef !== D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF ||
		generation.qualificationDigest !== qualificationDigest ||
		generation.graphBundleDigest !== graphBundle.bundleDigest ||
		generation.implementationManifestDigest !== qualification.implementationManifestDigest ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none" ||
		generationDigest !== empiricalStrictJsonDigest(generationMaterial)
	)
		throw new TypeError("current live qualification generation drifted");
	const { bundleDigest, ...bundleMaterial } = candidate;
	if (bundleDigest !== empiricalStrictJsonDigest(bundleMaterial))
		throw new TypeError("current live qualification bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D10CurrentGraphLiveQualificationBundleV1;
}

export function consumeConstructedD10CurrentGraphLiveQualification(
	value: unknown,
): D10CurrentGraphLiveQualificationBundleV1 {
	if (value === null || typeof value !== "object" || !constructed.delete(value))
		throw new TypeError("current live qualification must be same-process and single-use");
	return validateD10CurrentGraphLiveQualificationBundle(value);
}

export async function persistD10CurrentGraphLiveQualification(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D10CurrentGraphLiveQualificationBundleV1;
}): Promise<D10CurrentGraphLiveQualificationPersistenceReceiptV1> {
	const input = record(inputValue, "current.live.qualification.persistence.input");
	exactKeys(input, ["bundle", "privateRoot"], "current.live.qualification.persistence.input");
	const bundle = consumeConstructedD10CurrentGraphLiveQualification(input.bundle);
	if (bundle.qualification.baselineBasis !== "exact-d9-artifact")
		throw new TypeError("D10 production qualification persistence rejected an injected baseline");
	const privateRoot = resolve(String(input.privateRoot));
	await mkdir(privateRoot, { recursive: true, mode: 0o700 });
	await chmod(privateRoot, 0o700);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("current live qualification private root is not canonical");
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const qualificationBytes = strictJsonCodec.encode(
		bundle.qualification as unknown as StrictJsonValue,
	);
	const generationBytes = strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d10.current-graph-live-no-network-commit.v1",
		generationRef: D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
	});
	await persistCurrentGraphPrivateGeneration({
		privateRoot,
		generationRef: D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
		artifacts: {
			"bundle.v1.json": bundleBytes,
			"qualification.v1.json": qualificationBytes,
			"generation.v1.json": generationBytes,
		},
		commitBytes: strictJsonCodec.encode(commitMaterial as unknown as StrictJsonValue),
	});
	const receiptMaterial = strictSnapshot({
		schemaVersion: D10_CURRENT_GRAPH_LIVE_QUALIFICATION_PERSISTENCE_SCHEMA,
		generationRef: D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
		generationDigest: bundle.generation.generationDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
	});
	return Object.freeze({
		...receiptMaterial,
		receiptDigest: empiricalStrictJsonDigest(receiptMaterial),
	});
}
