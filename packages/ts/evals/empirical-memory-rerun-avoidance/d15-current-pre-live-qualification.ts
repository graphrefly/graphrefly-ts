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
import { validateCurrentGraphLiveQualificationBundle as validateD6QualificationBundle } from "./d6-current-pre-live-qualification.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import {
	admitCurrentGraphLiveZeroByok,
	composeCurrentGraphLivePreclaim,
	readCurrentGraphLiveOfficialPricing,
} from "./d8-current-live-preflight.js";
import {
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
	createD12CurrentGraphOpenRouterExecutor as createD15CurrentGraphOpenRouterExecutor,
} from "./d12-current-openrouter-adapter.js";
import { D15_IMPLEMENTATION_MANIFEST_DIGEST } from "./d15-current-implementation-manifest.js";
import {
	type D15CurrentGraphLiveBundleV1,
	runD15CurrentGraphLiveMeasurement,
	validateD15CurrentGraphLiveBundle,
} from "./d15-current-live.js";
import {
	acquireD15CurrentGraphLiveDispatchClaimAtRootForTest,
	consumeD15CurrentGraphLiveDispatchClaim,
} from "./d15-current-live-claim.js";
import {
	D15_CURRENT_GRAPH_LIVE_DECISION_REF,
	D15_CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	D15_CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	D15_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
	D15_CURRENT_GRAPH_LIVE_QUANTIZATION,
	D15_CURRENT_GRAPH_LIVE_READABLE_FILES,
	D15_CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	D15_CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
	D15_D6_IMPLEMENTATION_MANIFEST_DIGEST,
	D15_D6_QUALIFICATION_ARTIFACT_DIGEST,
	D15_D6_QUALIFICATION_BUNDLE_DIGEST,
	D15_D6_QUALIFICATION_DIGEST,
	D15_D6_QUALIFICATION_GENERATION_DIGEST,
} from "./d15-current-live-coordinates.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";

export const D15_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d15.current-live-no-network-qualification.v1" as const;
export const D15_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d15.current-live-no-network-bundle.v1" as const;
export const D15_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d15.current-live-no-network-generation.v1" as const;
export const D15_QUALIFICATION_PERSISTENCE_SCHEMA =
	"graphrefly-ts.d15.current-live-no-network-persistence.v1" as const;
export const D15_INJECTED_TEST_GENERATION_REF =
	"current-graph-native-live-no-network-injected-test-d15-v1" as const;
export const D15_MAX_QUALIFICATION_BYTES = 4_194_304;

export interface D15D6BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d15.d6-baseline-admission.v1";
}

export interface D15QualificationBundleV1 {
	readonly schemaVersion: typeof D15_QUALIFICATION_BUNDLE_SCHEMA;
	readonly qualification: Readonly<{
		schemaVersion: typeof D15_QUALIFICATION_SCHEMA;
		decisionRef: typeof D15_CURRENT_GRAPH_LIVE_DECISION_REF;
		implementationManifestDigest: string;
		baselineBasis: "exact-d6-artifact" | "injected-test";
		d6QualificationArtifactDigest: typeof D15_D6_QUALIFICATION_ARTIFACT_DIGEST;
		d6QualificationBundleDigest: typeof D15_D6_QUALIFICATION_BUNDLE_DIGEST;
		d6QualificationDigest: typeof D15_D6_QUALIFICATION_DIGEST;
		graphBundleDigest: string;
		fullSixArmIntegrationPassed: true;
		transportFailureCount: 1;
		transportPhaseCause: "request:dns-failure";
		conservativeTransportAccountingPassed: true;
		transportCleanupAndNextArmPassed: true;
		providerAttempts: number;
		retryWaits: 1;
		maxActiveTransport: 1;
		providerNetworkCalls: 0;
		retryRequestIdentityPassed: true;
		workspaceResidueCount: 0;
		cleanupPassed: true;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualificationDigest: string;
	}>;
	readonly graphBundle: D15CurrentGraphLiveBundleV1;
	readonly generation: Readonly<{
		schemaVersion: typeof D15_QUALIFICATION_GENERATION_SCHEMA;
		generationRef: typeof D15_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF;
		qualificationDigest: string;
		graphBundleDigest: string;
		implementationManifestDigest: string;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const baselineStates = new WeakMap<object, "exact-d6-artifact" | "injected-test">();
const constructedBundles = new WeakSet<object>();

function baselineCapability(
	basis: "exact-d6-artifact" | "injected-test",
): D15D6BaselineAdmissionV1 {
	const capability = Object.freeze({
		revision: "graphrefly-ts.d15.d6-baseline-admission.v1" as const,
	});
	baselineStates.set(capability, basis);
	return capability;
}

export function admitD15D6QualificationBaseline(bytesValue: Uint8Array): D15D6BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array)) throw new TypeError("D15 D6 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D15_D6_QUALIFICATION_ARTIFACT_DIGEST)
		throw new TypeError("D15 D6 qualification artifact drifted");
	const bundle = validateD6QualificationBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.bundleDigest !== D15_D6_QUALIFICATION_BUNDLE_DIGEST ||
		bundle.qualification.qualificationDigest !== D15_D6_QUALIFICATION_DIGEST ||
		bundle.qualification.implementationManifestDigest !== D15_D6_IMPLEMENTATION_MANIFEST_DIGEST ||
		bundle.qualification.phaseRejectedBatchIsolationPassed !== true ||
		bundle.qualification.efficacyClaim !== "none" ||
		bundle.generation.generationDigest !== D15_D6_QUALIFICATION_GENERATION_DIGEST
	)
		throw new TypeError("D15 D6 qualification projection drifted");
	return baselineCapability("exact-d6-artifact");
}

export function createD15InjectedD6BaselineForTest(): D15D6BaselineAdmissionV1 {
	return baselineCapability("injected-test");
}

function officialPricingResponse(): Response {
	const response = new Response(
		JSON.stringify({
			data: {
				id: D15_CURRENT_GRAPH_LIVE_REQUEST_MODEL,
				endpoints: [
					{
						provider_name: D15_CURRENT_GRAPH_LIVE_PROVIDER_NAME,
						tag: D15_CURRENT_GRAPH_LIVE_PROVIDER_TAG,
						quantization: D15_CURRENT_GRAPH_LIVE_QUANTIZATION,
						model: D15_CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
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

export async function runD15InjectedNoNetworkQualification(inputValue: {
	readonly repositoryRoot: string;
	readonly baseline: D15D6BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
}): Promise<D15QualificationBundleV1> {
	const input = record(inputValue, "D15 qualification input");
	exactKeys(
		input,
		["baseline", "implementationManifestDigest", "repositoryRoot"],
		"D15 qualification input",
	);
	const baseline = input.baseline as D15D6BaselineAdmissionV1;
	const baselineBasis =
		typeof baseline === "object" && baseline !== null ? baselineStates.get(baseline) : undefined;
	if (baselineBasis === undefined) throw new TypeError("D15 D6 baseline is forged or replayed");
	baselineStates.delete(baseline);
	const implementationManifestDigest = digest(
		input.implementationManifestDigest,
		"D15 implementation manifest",
	);
	if (implementationManifestDigest !== D15_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D15 qualification implementation manifest drifted");
	const repositoryRoot = await realpath(resolve(String(input.repositoryRoot)));
	const temporaryRoot = await mkdtemp(join(tmpdir(), "graphrefly-d15-no-network-"));
	await chmod(temporaryRoot, 0o700);
	try {
		const credential = Object.freeze({
			bearerToken: "sk-or-v1-test-current-graph-live-key-d15",
			credentialBindingRef: "openrouter.local-eval-2" as const,
			credentialBindingRevision: "2026-08-14.v1" as const,
		});
		const nowMs = Math.trunc(performance.timeOrigin + performance.now());
		const pricing = await readCurrentGraphLiveOfficialPricing({
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
				allowedModels: [D15_CURRENT_GRAPH_LIVE_REQUEST_MODEL],
				allowedProviders: [D15_CURRENT_GRAPH_LIVE_PROVIDER_NAME],
				observedAt: new Date(nowMs).toISOString(),
				source: "openrouter-browser-settings",
			}),
		);
		const zeroByok = admitCurrentGraphLiveZeroByok({
			bytes: zeroByokBytes,
			credential,
			nowMs,
		});
		const preclaim = composeCurrentGraphLivePreclaim({
			pricingObservation: pricing,
			zeroByokObservation: zeroByok,
			credential,
		});
		const privateRoot = join(temporaryRoot, "private");
		await mkdir(privateRoot, { mode: 0o700 });
		const claim = await acquireD15CurrentGraphLiveDispatchClaimAtRootForTest(
			await realpath(privateRoot),
			{
				preclaim,
				implementationManifestDigest,
				qualificationArtifactDigest: empiricalStrictJsonDigest({ injected: "d15" }),
				qualificationDigest: empiricalStrictJsonDigest({ injected: "d15-qualification" }),
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
		const executionAuthority = await consumeD15CurrentGraphLiveDispatchClaim({
			claim,
			currentKeyAdmission,
			allowInjectedTestScope: true,
		});
		let active = 0;
		let maxActive = 0;
		let providerCalls = 0;
		let transportInjected = false;
		let retryInjected = false;
		let pendingRetryBodyDigest: string | null = null;
		const fetchImpl: typeof fetch = async (_url, init) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			providerCalls += 1;
			try {
				if (!transportInjected) {
					transportInjected = true;
					const error = new Error("sanitized injected DNS failure");
					Object.defineProperty(error, "code", { value: "ENOTFOUND", enumerable: true });
					throw error;
				}
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
						throw new TypeError("D15 retry request bytes drifted");
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
										oldText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
										newText: CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
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
					: D15_CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) => ({
							id: `read-${providerCalls}-${index}`,
							type: "function",
							function: { name: "read_file", arguments: JSON.stringify({ path }) },
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
		const executor = createD15CurrentGraphOpenRouterExecutor({
			repositoryRoot,
			materializationRoot,
			credential,
			fetchImpl,
			sleep: async () => undefined,
		});
		const graphBundle = validateD15CurrentGraphLiveBundle(
			await runD15CurrentGraphLiveMeasurement({
				executionAuthority,
				executionClass: "injected-no-network",
				executor,
				implementationManifestDigest,
				d6QualificationArtifactDigest: D15_D6_QUALIFICATION_ARTIFACT_DIGEST,
				pricingObservationDigest: pricing.observationDigest,
				zeroByokObservationDigest: zeroByok.observationDigest,
			}),
		);
		if (graphBundle.disposition !== "success" || graphBundle.graphEvidence === null)
			throw new TypeError("D15 no-network Graph integration did not complete");
		const evidence = graphBundle.graphEvidence;
		const graph = evidence.d9Evidence.providerEvidence;
		const runs = graph.workflowEvidence.runs;
		const transportFact = evidence.transportFacts[0];
		const transportProviderFact = graph.facts.find(
			(fact) => fact.factDigest === transportFact?.providerFactDigest,
		);
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
				) ||
			evidence.transportFailureCount !== 1 ||
			transportFact?.phase !== "request" ||
			transportFact.causeCode !== "dns-failure" ||
			transportProviderFact?.result.effectKind !== "provider-request" ||
			transportProviderFact.result.usage.costBasis !== "conservative-reservation" ||
			transportProviderFact.result.usage.actualCostMicrousd !==
				transportProviderFact.request.reservation.maxCostMicrousd ||
			graph.budget.retryWaits !== 1 ||
			graph.budget.providerAttempts !== providerCalls ||
			maxActive !== 1 ||
			pendingRetryBodyDigest !== null
		)
			throw new TypeError("D15 no-network Graph transport projection drifted");
		await lstat(materializationRoot).then(
			() => {
				throw new TypeError("D15 no-network left workspace residue");
			},
			(error: unknown) => {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			},
		);
		const source = await readFile(
			join(repositoryRoot, "packages/ts/src/executors/managed-cloud-postgresql.ts"),
			"utf8",
		);
		if (!source.includes(CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK))
			throw new TypeError("D15 no-network mutated the source workspace");
		const qualificationMaterial = strictSnapshot({
			schemaVersion: D15_QUALIFICATION_SCHEMA,
			decisionRef: D15_CURRENT_GRAPH_LIVE_DECISION_REF,
			implementationManifestDigest,
			baselineBasis,
			d6QualificationArtifactDigest: D15_D6_QUALIFICATION_ARTIFACT_DIGEST,
			d6QualificationBundleDigest: D15_D6_QUALIFICATION_BUNDLE_DIGEST,
			d6QualificationDigest: D15_D6_QUALIFICATION_DIGEST,
			graphBundleDigest: graphBundle.bundleDigest,
			fullSixArmIntegrationPassed: true as const,
			transportFailureCount: 1 as const,
			transportPhaseCause: "request:dns-failure" as const,
			conservativeTransportAccountingPassed: true as const,
			transportCleanupAndNextArmPassed: true as const,
			providerAttempts: graph.budget.providerAttempts,
			retryWaits: 1 as const,
			maxActiveTransport: 1 as const,
			providerNetworkCalls: 0 as const,
			retryRequestIdentityPassed: true as const,
			workspaceResidueCount: 0 as const,
			cleanupPassed: true as const,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
		});
		const qualification = Object.freeze({
			...qualificationMaterial,
			qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
		});
		const generationMaterial = strictSnapshot({
			schemaVersion: D15_QUALIFICATION_GENERATION_SCHEMA,
			generationRef: D15_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
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
			schemaVersion: D15_QUALIFICATION_BUNDLE_SCHEMA,
			qualification,
			graphBundle,
			generation,
		});
		const bundle = Object.freeze({
			...bundleMaterial,
			bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
		}) as D15QualificationBundleV1;
		if (
			strictJsonCodec.encode(bundle as unknown as StrictJsonValue).byteLength >
			D15_MAX_QUALIFICATION_BYTES
		)
			throw new TypeError("D15 qualification exceeded its byte bound");
		constructedBundles.add(bundle);
		return bundle;
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export function validateD15QualificationBundle(value: unknown): D15QualificationBundleV1 {
	const candidate = record(value, "D15 qualification bundle");
	exactKeys(
		candidate,
		["bundleDigest", "generation", "graphBundle", "qualification", "schemaVersion"],
		"D15 qualification bundle",
	);
	if (candidate.schemaVersion !== D15_QUALIFICATION_BUNDLE_SCHEMA)
		throw new TypeError("D15 qualification bundle schema drifted");
	const graphBundle = validateD15CurrentGraphLiveBundle(candidate.graphBundle);
	if (graphBundle.executionClass !== "injected-no-network" || graphBundle.disposition !== "success")
		throw new TypeError("D15 qualification Graph bundle drifted");
	const graphEvidence = graphBundle.graphEvidence;
	if (graphEvidence === null) throw new TypeError("D15 qualification Graph evidence is missing");
	const graph = graphEvidence.d9Evidence.providerEvidence;
	const runs = graph.workflowEvidence.runs;
	const qualification = record(candidate.qualification, "D15 qualification");
	exactKeys(
		qualification,
		[
			"baselineBasis",
			"causalAttribution",
			"cleanupPassed",
			"conservativeTransportAccountingPassed",
			"d6QualificationArtifactDigest",
			"d6QualificationBundleDigest",
			"d6QualificationDigest",
			"decisionRef",
			"efficacyClaim",
			"fullSixArmIntegrationPassed",
			"graphBundleDigest",
			"implementationManifestDigest",
			"maxActiveTransport",
			"providerAttempts",
			"providerNetworkCalls",
			"qualificationDigest",
			"retryRequestIdentityPassed",
			"retryWaits",
			"schemaVersion",
			"transportCleanupAndNextArmPassed",
			"transportFailureCount",
			"transportPhaseCause",
			"workspaceResidueCount",
		],
		"D15 qualification",
	);
	const transportFact = graphEvidence.transportFacts[0];
	const providerFact = graph.facts.find(
		(fact) => fact.factDigest === transportFact?.providerFactDigest,
	);
	const { qualificationDigest, ...qualificationMaterial } = qualification;
	if (
		qualification.schemaVersion !== D15_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== D15_CURRENT_GRAPH_LIVE_DECISION_REF ||
		qualification.implementationManifestDigest !== D15_IMPLEMENTATION_MANIFEST_DIGEST ||
		(qualification.baselineBasis !== "exact-d6-artifact" &&
			qualification.baselineBasis !== "injected-test") ||
		qualification.d6QualificationArtifactDigest !== D15_D6_QUALIFICATION_ARTIFACT_DIGEST ||
		qualification.d6QualificationBundleDigest !== D15_D6_QUALIFICATION_BUNDLE_DIGEST ||
		qualification.d6QualificationDigest !== D15_D6_QUALIFICATION_DIGEST ||
		qualification.graphBundleDigest !== graphBundle.bundleDigest ||
		qualification.fullSixArmIntegrationPassed !== true ||
		qualification.transportFailureCount !== 1 ||
		graphEvidence.transportFailureCount !== 1 ||
		qualification.transportPhaseCause !== "request:dns-failure" ||
		transportFact?.phase !== "request" ||
		transportFact.causeCode !== "dns-failure" ||
		providerFact?.result.effectKind !== "provider-request" ||
		providerFact.result.usage.costBasis !== "conservative-reservation" ||
		providerFact.result.usage.actualCostMicrousd !==
			providerFact.request.reservation.maxCostMicrousd ||
		qualification.conservativeTransportAccountingPassed !== true ||
		qualification.transportCleanupAndNextArmPassed !== true ||
		qualification.retryWaits !== graph.budget.retryWaits ||
		qualification.retryWaits !== 1 ||
		qualification.providerAttempts !== graph.budget.providerAttempts ||
		qualification.maxActiveTransport !== 1 ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.retryRequestIdentityPassed !== true ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.cleanupPassed !== true ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none" ||
		runs.length !== 6 ||
		runs[0]?.status !== "incomplete" ||
		runs[0]?.cleanupStatus !== "completed" ||
		runs.slice(1).some((run) => run.status !== "completed" || run.cleanupStatus !== "completed") ||
		qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial)
	)
		throw new TypeError("D15 qualification projection drifted");
	const generation = record(candidate.generation, "D15 qualification generation");
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
		"D15 qualification generation",
	);
	const { generationDigest, ...generationMaterial } = generation;
	if (
		generation.schemaVersion !== D15_QUALIFICATION_GENERATION_SCHEMA ||
		generation.generationRef !== D15_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF ||
		generation.qualificationDigest !== qualificationDigest ||
		generation.graphBundleDigest !== graphBundle.bundleDigest ||
		generation.implementationManifestDigest !== qualification.implementationManifestDigest ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none" ||
		generationDigest !== empiricalStrictJsonDigest(generationMaterial)
	)
		throw new TypeError("D15 qualification generation drifted");
	const { bundleDigest, ...bundleMaterial } = candidate;
	if (bundleDigest !== empiricalStrictJsonDigest(bundleMaterial))
		throw new TypeError("D15 qualification bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D15QualificationBundleV1;
}

async function persistQualification(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D15QualificationBundleV1;
	readonly expectedBasis: D15QualificationBundleV1["qualification"]["baselineBasis"];
	readonly generationRef: string;
}) {
	const input = record(inputValue, "D15 qualification persistence input");
	exactKeys(
		input,
		["bundle", "expectedBasis", "generationRef", "privateRoot"],
		"D15 qualification persistence input",
	);
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("D15 qualification persistence requires a fresh constructed bundle");
	const bundle = validateD15QualificationBundle(input.bundle);
	if (bundle.qualification.baselineBasis !== input.expectedBasis)
		throw new TypeError("D15 qualification persistence basis drifted");
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const qualificationBytes = strictJsonCodec.encode(
		bundle.qualification as unknown as StrictJsonValue,
	);
	const generationBytes = strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d15.current-live-no-network-commit.v1",
		generationRef: String(input.generationRef),
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
	});
	await persistCurrentGraphPrivateGeneration({
		privateRoot: String(input.privateRoot),
		generationRef: String(input.generationRef),
		artifacts: {
			"bundle.v1.json": bundleBytes,
			"qualification.v1.json": qualificationBytes,
			"generation.v1.json": generationBytes,
		},
		commitBytes: strictJsonCodec.encode(commitMaterial as unknown as StrictJsonValue),
	});
	const receiptMaterial = strictSnapshot({
		schemaVersion: D15_QUALIFICATION_PERSISTENCE_SCHEMA,
		generationRef: String(input.generationRef),
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
	});
	return Object.freeze({
		...receiptMaterial,
		receiptDigest: empiricalStrictJsonDigest(receiptMaterial),
	});
}

export function persistD15QualificationBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D15QualificationBundleV1;
}) {
	return persistQualification({
		...input,
		expectedBasis: "exact-d6-artifact",
		generationRef: D15_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
	});
}

export function persistD15InjectedQualificationForTest(input: {
	readonly privateRoot: string;
	readonly bundle: D15QualificationBundleV1;
}) {
	return persistQualification({
		...input,
		expectedBasis: "injected-test",
		generationRef: D15_INJECTED_TEST_GENERATION_REF,
	});
}
