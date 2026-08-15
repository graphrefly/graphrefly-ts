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
import {
	type CurrentGraphLiveBundleV1,
	runCurrentGraphLiveMeasurement,
	validateCurrentGraphLiveBundle,
} from "./d6-current-live.js";
import {
	acquireCurrentGraphLiveDispatchClaimAtRootForTest,
	consumeCurrentGraphLiveDispatchClaim,
} from "./d6-current-live-claim.js";
import {
	CURRENT_GRAPH_LIVE_D5_IMPLEMENTATION_MANIFEST_DIGEST,
	CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST,
	CURRENT_GRAPH_LIVE_D5_QUALIFICATION_BUNDLE_DIGEST,
	CURRENT_GRAPH_LIVE_D5_QUALIFICATION_DIGEST,
	CURRENT_GRAPH_LIVE_DECISION_REF,
	CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	CURRENT_GRAPH_LIVE_QUANTIZATION,
	CURRENT_GRAPH_LIVE_READABLE_FILES,
	CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
} from "./d6-current-live-coordinates.js";
import {
	admitCurrentGraphLiveZeroByok,
	composeCurrentGraphLivePreclaim,
	readCurrentGraphLiveOfficialPricing,
} from "./d6-current-live-preflight.js";
import {
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
	createCurrentGraphOpenRouterExecutor,
} from "./d6-current-openrouter-adapter.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";

export const CURRENT_GRAPH_LIVE_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d6.current-graph-live-no-network-qualification.v1" as const;
export const CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d6.current-graph-live-no-network-generation.v1" as const;
export const CURRENT_GRAPH_LIVE_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d6.current-graph-live-no-network-bundle.v1" as const;
export const CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF =
	"current-graph-native-live-no-network-qualification-2026-08-14-d6-v2" as const;
export const CURRENT_GRAPH_LIVE_MAX_QUALIFICATION_BYTES = 4_194_304;
export const CURRENT_GRAPH_LIVE_QUALIFICATION_PERSISTENCE_SCHEMA =
	"graphrefly-ts.d6.current-graph-live-no-network-persistence.v1" as const;

export interface CurrentGraphLiveQualificationBundleV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_LIVE_QUALIFICATION_BUNDLE_SCHEMA;
	readonly qualification: Readonly<{
		schemaVersion: typeof CURRENT_GRAPH_LIVE_QUALIFICATION_SCHEMA;
		decisionRef: typeof CURRENT_GRAPH_LIVE_DECISION_REF;
		implementationManifestDigest: string;
		d5QualificationArtifactDigest: typeof CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST;
		d5QualificationBundleDigest: typeof CURRENT_GRAPH_LIVE_D5_QUALIFICATION_BUNDLE_DIGEST;
		d5QualificationDigest: typeof CURRENT_GRAPH_LIVE_D5_QUALIFICATION_DIGEST;
		graphBundleDigest: string;
		fullSixArmIntegrationPassed: true;
		fourReadInspectionBatchCount: 6;
		serialReadEffectCount: 24;
		providerAttempts: number;
		retryWaits: 1;
		maxActiveTransport: 1;
		providerNetworkCalls: 0;
		workspaceResidueCount: 0;
		retryRequestIdentityPassed: true;
		publicSemanticValidationPassed: true;
		hiddenVerifierPassed: true;
		cleanupPassed: true;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualificationDigest: string;
	}>;
	readonly graphBundle: CurrentGraphLiveBundleV1;
	readonly generation: Readonly<{
		schemaVersion: typeof CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_SCHEMA;
		generationRef: typeof CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF;
		qualificationDigest: string;
		graphBundleDigest: string;
		implementationManifestDigest: string;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

export interface CurrentGraphLiveQualificationPersistenceReceiptV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_LIVE_QUALIFICATION_PERSISTENCE_SCHEMA;
	readonly generationRef: typeof CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF;
	readonly bundleArtifactDigest: string;
	readonly bundleDigest: string;
	readonly generationDigest: string;
	readonly qualificationDigest: string;
	readonly receiptDigest: string;
}

const constructed = new WeakSet<object>();

function officialPricingResponse() {
	const response = new Response(
		JSON.stringify({
			data: {
				id: CURRENT_GRAPH_LIVE_REQUEST_MODEL,
				endpoints: [
					{
						provider_name: CURRENT_GRAPH_LIVE_PROVIDER_NAME,
						tag: CURRENT_GRAPH_LIVE_PROVIDER_TAG,
						quantization: CURRENT_GRAPH_LIVE_QUANTIZATION,
						model: CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
						supported_parameters: ["reasoning", "tool_choice", "tools"],
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

function validateD5QualificationBytes(bytesValue: Uint8Array) {
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST)
		throw new TypeError("current live D5 qualification artifact drifted");
	const bundle = record(strictJsonCodec.decode(bytes), "current.live.d5Qualification");
	exactKeys(
		bundle,
		[
			"bundleDigest",
			"generation",
			"graphEvidence",
			"publicBehaviorEvidence",
			"qualification",
			"schemaVersion",
		],
		"current.live.d5Qualification",
	);
	const qualification = record(bundle.qualification, "current.live.d5Qualification.qualification");
	const generation = record(bundle.generation, "current.live.d5Qualification.generation");
	if (
		bundle.schemaVersion !== "graphrefly-ts.d5.current-graph-native-bundle.v1" ||
		bundle.bundleDigest !== CURRENT_GRAPH_LIVE_D5_QUALIFICATION_BUNDLE_DIGEST ||
		qualification.implementationManifestDigest !==
			CURRENT_GRAPH_LIVE_D5_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.qualificationDigest !== CURRENT_GRAPH_LIVE_D5_QUALIFICATION_DIGEST ||
		generation.generationRef !== "d5-inspection-batch-no-network-qualification-2026-08-14-v3" ||
		generation.qualificationDigest !== CURRENT_GRAPH_LIVE_D5_QUALIFICATION_DIGEST
	)
		throw new TypeError("current live D5 qualification coordinates drifted");
	return Object.freeze({
		bundleDigest: CURRENT_GRAPH_LIVE_D5_QUALIFICATION_BUNDLE_DIGEST,
		qualificationDigest: CURRENT_GRAPH_LIVE_D5_QUALIFICATION_DIGEST,
	});
}

export async function runCurrentGraphLiveNoNetworkQualification(inputValue: {
	readonly repositoryRoot: string;
	readonly d5QualificationBundleBytes: Uint8Array;
	readonly implementationManifestDigest: string;
}): Promise<CurrentGraphLiveQualificationBundleV1> {
	const input = record(inputValue, "current.live.qualification.input");
	exactKeys(
		input,
		["d5QualificationBundleBytes", "implementationManifestDigest", "repositoryRoot"],
		"current.live.qualification.input",
	);
	if (!(input.d5QualificationBundleBytes instanceof Uint8Array))
		throw new TypeError("current live D5 qualification bytes are invalid");
	const d5 = validateD5QualificationBytes(input.d5QualificationBundleBytes);
	const implementationManifestDigest = digest(
		input.implementationManifestDigest,
		"current.live.qualification.implementationManifestDigest",
	);
	const repositoryRoot = await realpath(resolve(String(input.repositoryRoot)));
	const temporaryRoot = await mkdtemp(join(tmpdir(), "graphrefly-current-live-d6-"));
	await chmod(temporaryRoot, 0o700);
	try {
		const credential = Object.freeze({
			bearerToken: "sk-or-v1-test-current-graph-live-key-xyz",
			credentialBindingRef: "openrouter.local-eval-2" as const,
			credentialBindingRevision: "2026-08-14.v1" as const,
		});
		const nowMs = new Date().getTime();
		const pricing = await readCurrentGraphLiveOfficialPricing({
			fetch: async () => officialPricingResponse(),
			nowMs: () => nowMs,
		});
		const zeroByokBytes = Buffer.from(
			JSON.stringify({
				schemaVersion: "graphrefly-ts.d6.current-graph-live-zero-byok-observation.v1",
				decisionRef: "graphrefly-ts:D6",
				decisionRevision: "2026-08-14.v1",
				workspaceName: "GraphReFly",
				workspaceSlug: "graph-re-fly",
				keyName: "Local Eval 2",
				keyVisiblePrefix: credential.bearerToken.slice(0, 12),
				keyVisibleSuffix: credential.bearerToken.slice(-3),
				byokCredentialCount: 0,
				allowedModels: [CURRENT_GRAPH_LIVE_REQUEST_MODEL],
				allowedProviders: [CURRENT_GRAPH_LIVE_PROVIDER_NAME],
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
		const claim = await acquireCurrentGraphLiveDispatchClaimAtRootForTest(
			await realpath(privateRoot),
			{
				preclaim,
				implementationManifestDigest,
				qualificationArtifactDigest: empiricalStrictJsonDigest({ injected: "d6" }),
				qualificationDigest: empiricalStrictJsonDigest({ injected: "d6-qualification" }),
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
		const executionAuthority = await consumeCurrentGraphLiveDispatchClaim({
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
					: CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) => ({
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
		const graphBundle = validateCurrentGraphLiveBundle(
			await runCurrentGraphLiveMeasurement({
				executionAuthority,
				executionClass: "injected-no-network",
				executor: createCurrentGraphOpenRouterExecutor({
					repositoryRoot,
					materializationRoot,
					credential,
					fetchImpl,
					sleep: async () => undefined,
				}),
				implementationManifestDigest,
				d5QualificationArtifactDigest: CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST,
				pricingObservationDigest: pricing.observationDigest,
				zeroByokObservationDigest: zeroByok.observationDigest,
			}),
		);
		if (graphBundle.disposition !== "success" || graphBundle.graphEvidence === null)
			throw new TypeError("current live no-network Graph integration did not complete");
		const graph = graphBundle.graphEvidence;
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
		if (
			runs.length !== 6 ||
			runs.some(
				(run) =>
					run.status !== "completed" ||
					!run.publicSemanticValidationPassed ||
					!run.hiddenVerifierPassed ||
					run.cleanupStatus !== "completed",
			)
		)
			throw new TypeError("current live no-network six-arm projection drifted");
		if (
			graph.budget.providerAttempts !== providerCalls ||
			graph.budget.retryWaits !== 1 ||
			maxActive !== 1 ||
			fourReadInspectionBatchCount !== 6 ||
			serialReadEffectCount !== 24
		)
			throw new TypeError("current live no-network accounting drifted");
		const residue = await readFile(
			join(repositoryRoot, "packages/ts/src/executors/managed-cloud-postgresql.ts"),
		);
		if (!new TextDecoder().decode(residue).includes(CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK))
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
			schemaVersion: CURRENT_GRAPH_LIVE_QUALIFICATION_SCHEMA,
			decisionRef: CURRENT_GRAPH_LIVE_DECISION_REF,
			implementationManifestDigest,
			d5QualificationArtifactDigest: CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST,
			d5QualificationBundleDigest: d5.bundleDigest,
			d5QualificationDigest: d5.qualificationDigest,
			graphBundleDigest: graphBundle.bundleDigest,
			fullSixArmIntegrationPassed: true as const,
			fourReadInspectionBatchCount: 6 as const,
			serialReadEffectCount: 24 as const,
			providerAttempts: graph.budget.providerAttempts,
			retryWaits: 1 as const,
			maxActiveTransport: 1 as const,
			providerNetworkCalls: 0 as const,
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
			schemaVersion: CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_SCHEMA,
			generationRef: CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
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
			schemaVersion: CURRENT_GRAPH_LIVE_QUALIFICATION_BUNDLE_SCHEMA,
			qualification,
			graphBundle,
			generation,
		});
		const bundle = Object.freeze({
			...bundleMaterial,
			bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
		}) as CurrentGraphLiveQualificationBundleV1;
		if (
			strictJsonCodec.encode(bundle as unknown as StrictJsonValue).byteLength >
			CURRENT_GRAPH_LIVE_MAX_QUALIFICATION_BYTES
		)
			throw new TypeError("current live qualification exceeded its byte bound");
		constructed.add(bundle);
		return bundle;
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export function validateCurrentGraphLiveQualificationBundle(
	value: unknown,
): CurrentGraphLiveQualificationBundleV1 {
	const candidate = record(value, "current.live.qualification.bundle");
	exactKeys(
		candidate,
		["bundleDigest", "generation", "graphBundle", "qualification", "schemaVersion"],
		"current.live.qualification.bundle",
	);
	if (candidate.schemaVersion !== CURRENT_GRAPH_LIVE_QUALIFICATION_BUNDLE_SCHEMA)
		throw new TypeError("current live qualification bundle schema drifted");
	const graphBundle = validateCurrentGraphLiveBundle(candidate.graphBundle);
	if (graphBundle.executionClass !== "injected-no-network" || graphBundle.disposition !== "success")
		throw new TypeError("current live qualification Graph bundle drifted");
	const qualification = record(candidate.qualification, "current.live.qualification");
	exactKeys(
		qualification,
		[
			"causalAttribution",
			"cleanupPassed",
			"d5QualificationArtifactDigest",
			"d5QualificationBundleDigest",
			"d5QualificationDigest",
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
			"publicSemanticValidationPassed",
			"qualificationDigest",
			"retryRequestIdentityPassed",
			"retryWaits",
			"schemaVersion",
			"serialReadEffectCount",
			"workspaceResidueCount",
		],
		"current.live.qualification",
	);
	const { qualificationDigest, ...qualificationMaterial } = qualification;
	const graph = graphBundle.graphEvidence;
	if (graph === null) throw new TypeError("current live qualification Graph evidence is missing");
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
	if (
		qualification.schemaVersion !== CURRENT_GRAPH_LIVE_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== CURRENT_GRAPH_LIVE_DECISION_REF ||
		qualification.d5QualificationArtifactDigest !==
			CURRENT_GRAPH_LIVE_D5_QUALIFICATION_ARTIFACT_DIGEST ||
		qualification.d5QualificationBundleDigest !==
			CURRENT_GRAPH_LIVE_D5_QUALIFICATION_BUNDLE_DIGEST ||
		qualification.d5QualificationDigest !== CURRENT_GRAPH_LIVE_D5_QUALIFICATION_DIGEST ||
		qualification.graphBundleDigest !== graphBundle.bundleDigest ||
		qualification.fullSixArmIntegrationPassed !== true ||
		qualification.fourReadInspectionBatchCount !== fourReadInspectionBatchCount ||
		fourReadInspectionBatchCount !== 6 ||
		qualification.retryWaits !== 1 ||
		qualification.maxActiveTransport !== 1 ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.retryRequestIdentityPassed !== true ||
		qualification.serialReadEffectCount !== serialReadEffectCount ||
		serialReadEffectCount !== 24 ||
		qualification.publicSemanticValidationPassed !== true ||
		qualification.hiddenVerifierPassed !== true ||
		qualification.cleanupPassed !== true ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none" ||
		qualification.providerAttempts !== graphBundle.graphEvidence?.budget.providerAttempts ||
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
		generation.schemaVersion !== CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_SCHEMA ||
		generation.generationRef !== CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF ||
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
	return strictSnapshot(candidate) as unknown as CurrentGraphLiveQualificationBundleV1;
}

export function consumeConstructedCurrentGraphLiveQualification(
	value: unknown,
): CurrentGraphLiveQualificationBundleV1 {
	if (value === null || typeof value !== "object" || !constructed.delete(value))
		throw new TypeError("current live qualification must be same-process and single-use");
	return validateCurrentGraphLiveQualificationBundle(value);
}

export async function persistCurrentGraphLiveQualification(inputValue: {
	readonly privateRoot: string;
	readonly bundle: CurrentGraphLiveQualificationBundleV1;
}): Promise<CurrentGraphLiveQualificationPersistenceReceiptV1> {
	const input = record(inputValue, "current.live.qualification.persistence.input");
	exactKeys(input, ["bundle", "privateRoot"], "current.live.qualification.persistence.input");
	const bundle = consumeConstructedCurrentGraphLiveQualification(input.bundle);
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
		schemaVersion: "graphrefly-ts.d6.current-graph-live-no-network-commit.v1",
		generationRef: CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest,
	});
	await persistCurrentGraphPrivateGeneration({
		privateRoot,
		generationRef: CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
		artifacts: {
			"bundle.v1.json": bundleBytes,
			"qualification.v1.json": qualificationBytes,
			"generation.v1.json": generationBytes,
		},
		commitBytes: strictJsonCodec.encode(commitMaterial as unknown as StrictJsonValue),
	});
	const receiptMaterial = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_LIVE_QUALIFICATION_PERSISTENCE_SCHEMA,
		generationRef: CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
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
