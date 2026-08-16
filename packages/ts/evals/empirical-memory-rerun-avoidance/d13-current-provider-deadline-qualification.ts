import { chmod, lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
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
import type {
	CurrentGraphProviderAdmittedEffectV1,
	CurrentGraphProviderBudgetLimitsV1,
	CurrentGraphProviderEffectResultInputV1,
} from "./d6-current-provider-authority.js";
import {
	admitCurrentGraphLiveZeroByok,
	composeCurrentGraphLivePreclaim,
	readCurrentGraphLiveOfficialPricing,
} from "./d8-current-live-preflight.js";
import {
	d11ConservativeTransportResult,
	executeD11TransportBoundary,
} from "./d11-current-transport-boundary.js";
import {
	admitD11ProviderEffectEnvelope,
	createD11TransportFailureAuthority,
	type D11TransportFailureEvidenceV1,
	snapshotD11TransportFailureEvidence,
	takeD11ProviderEffect,
	validateD11TransportFailureEvidence,
} from "./d11-current-transport-failure-authority.js";
import {
	D12_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD12Implementation,
} from "./d12-current-implementation-manifest.js";
import { validateD12CurrentGraphLiveBundle } from "./d12-current-live.js";
import {
	D12_CURRENT_GRAPH_LIVE_LIMITS,
	D12_CURRENT_GRAPH_LIVE_PROVIDER_NAME,
	D12_CURRENT_GRAPH_LIVE_PROVIDER_TAG,
	D12_CURRENT_GRAPH_LIVE_QUANTIZATION,
	D12_CURRENT_GRAPH_LIVE_READABLE_FILES,
	D12_CURRENT_GRAPH_LIVE_REQUEST_MODEL,
	D12_CURRENT_GRAPH_LIVE_ROUTE,
	D12_CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
	D12_CURRENT_GRAPH_LIVE_TASK,
} from "./d12-current-live-coordinates.js";
import {
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
	createD12CurrentGraphOpenRouterExecutor,
} from "./d12-current-openrouter-adapter.js";
import {
	D13_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD13Implementation,
} from "./d13-current-implementation-manifest.js";

export const D13_DECISION_REF = "graphrefly-ts:D13" as const;
export const D13_DECISION_REVISION = "2026-08-16.v1" as const;
export const D13_PROVIDER_MAX_ELAPSED_MS = 120_000 as const;
export const D13_LEGACY_PROVIDER_MAX_ELAPSED_MS = 60_000 as const;
export const D13_COMPLETED_PROVIDER_ELAPSED_MS = 60_001 as const;
export const D13_EXPECTED_PROVIDER_ATTEMPTS = 13 as const;
export const D13_D12_BASELINE_ARTIFACT_DIGEST =
	"sha256:5586bca12204364af18bdb24796df4119392ada6ce3b52c7be6118a9fe33b513" as const;
export const D13_D12_BASELINE_BUNDLE_DIGEST =
	"sha256:a77eee914279c5f4f395d4d21f052483af5d7b07099470013a8f32de312b931d" as const;
export const D13_D12_BASELINE_GRAPH_DIGEST =
	"sha256:04049363ae69ed921e71f928f835e293f91ad2579ffd8094230647fbd06ff359" as const;
export const D13_D12_BASELINE_GENERATION_DIGEST =
	"sha256:1c71c1585cc341eb2072b03a3c1b9624f728aa7646be66bf4bcc4799ac73ed64" as const;
export const D13_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d13.provider-deadline-qualification.v1" as const;
export const D13_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d13.provider-deadline-bundle.v1" as const;
export const D13_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d13.provider-deadline-generation.v1" as const;
export const D13_QUALIFICATION_PERSISTENCE_SCHEMA =
	"graphrefly-ts.d13.provider-deadline-persistence.v1" as const;
export const D13_QUALIFICATION_GENERATION_REF =
	"current-graph-native-provider-deadline-no-network-2026-08-16-d13-v1" as const;
export const D13_INJECTED_TEST_GENERATION_REF =
	"current-graph-native-provider-deadline-injected-test-d13-v1" as const;
export const D13_MAX_QUALIFICATION_BYTES = 4_194_304;

export const D13_PROVIDER_LIMITS = Object.freeze({
	...D12_CURRENT_GRAPH_LIVE_LIMITS,
	providerMaxElapsedMs: D13_PROVIDER_MAX_ELAPSED_MS,
}) satisfies CurrentGraphProviderBudgetLimitsV1;

export const D13_COORDINATES = strictSnapshot({
	decisionRef: D13_DECISION_REF,
	decisionRevision: D13_DECISION_REVISION,
	d12BaselineArtifactDigest: D13_D12_BASELINE_ARTIFACT_DIGEST,
	d12BaselineBundleDigest: D13_D12_BASELINE_BUNDLE_DIGEST,
	d12BaselineGraphDigest: D13_D12_BASELINE_GRAPH_DIGEST,
	d12BaselineGenerationDigest: D13_D12_BASELINE_GENERATION_DIGEST,
	providerMaxElapsedMs: D13_PROVIDER_MAX_ELAPSED_MS,
	legacyProviderMaxElapsedMs: D13_LEGACY_PROVIDER_MAX_ELAPSED_MS,
	maxElapsedMs: D13_PROVIDER_LIMITS.maxElapsedMs,
	providerMaxCostMicrousd: D13_PROVIDER_LIMITS.providerMaxCostMicrousd,
	routeDigest: D12_CURRENT_GRAPH_LIVE_ROUTE.routeDigest,
	taskProfileDigest: D12_CURRENT_GRAPH_LIVE_TASK.taskProfileDigest,
	modelInformationSetChanged: false,
	retryPolicies: ["D671", "D675", "D710"],
	armOrder: [
		"cold",
		"relevant-applied",
		"proposal-only",
		"admission-rejected",
		"irrelevant-applied",
		"wrong-scope-applied",
	],
	maxActiveArms: 1,
	coldCensorsWarm: false,
	causalAttribution: "undetermined",
	efficacyClaim: "none",
});
export const D13_COORDINATES_DIGEST = empiricalStrictJsonDigest(D13_COORDINATES);

export interface D13D12BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d13.d12-baseline-admission.v1";
}

interface D13DeadlineEvidenceV1 {
	readonly schemaVersion: "graphrefly-ts.d13.deadline-evidence.v1";
	readonly providerReservationMs: 120_000;
	readonly completedAfterLegacyDeadlineMs: typeof D13_COMPLETED_PROVIDER_ELAPSED_MS;
	readonly responseBodyRemainingMs: 59_999;
	readonly graphProviderResultsBeyondLegacy: typeof D13_EXPECTED_PROVIDER_ATTEMPTS;
	readonly ownedDeadlineAtMs: 120_000;
	readonly requestPhaseScheduledMs: 120_000;
	readonly callerCancellationDisposition: "propagated-not-admitted";
	readonly singleMonotonicDeadlinePassed: true;
	readonly evidenceDigest: string;
}

export interface D13QualificationBundleV1 {
	readonly schemaVersion: typeof D13_QUALIFICATION_BUNDLE_SCHEMA;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D13_QUALIFICATION_SCHEMA;
		readonly decisionRef: typeof D13_DECISION_REF;
		readonly baselineBasis: "exact-d12-artifact" | "injected-test";
		readonly coordinatesDigest: string;
		readonly implementationManifestDigest: string;
		readonly d12BaselineArtifactDigest: typeof D13_D12_BASELINE_ARTIFACT_DIGEST;
		readonly d12BaselineBundleDigest: typeof D13_D12_BASELINE_BUNDLE_DIGEST;
		readonly d12BaselineGraphDigest: typeof D13_D12_BASELINE_GRAPH_DIGEST;
		readonly d12BaselineGenerationDigest: typeof D13_D12_BASELINE_GENERATION_DIGEST;
		readonly graphEvidenceDigest: string;
		readonly deadlineEvidenceDigest: string;
		readonly fullSixArmIntegrationPassed: true;
		readonly deadlineAlignmentPassed: true;
		readonly retryIdentityPassed: true;
		readonly cancellationOwnershipPassed: true;
		readonly providerAttempts: number;
		readonly confirmedCostMicrousd: number;
		readonly confirmedElapsedMs: number;
		readonly retryWaits: 1;
		readonly maxActiveTransport: 1;
		readonly providerNetworkCalls: 0;
		readonly workspaceResidueCount: 0;
		readonly cleanupPassed: true;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualificationDigest: string;
	}>;
	readonly graphEvidence: D11TransportFailureEvidenceV1;
	readonly deadlineEvidence: D13DeadlineEvidenceV1;
	readonly generation: Readonly<{
		readonly schemaVersion: typeof D13_QUALIFICATION_GENERATION_SCHEMA;
		readonly generationRef: typeof D13_QUALIFICATION_GENERATION_REF;
		readonly qualificationDigest: string;
		readonly graphEvidenceDigest: string;
		readonly deadlineEvidenceDigest: string;
		readonly implementationManifestDigest: string;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const baselineStates = new WeakMap<object, "exact-d12-artifact" | "injected-test">();
const constructedBundles = new WeakSet<object>();

function baselineCapability(
	basis: "exact-d12-artifact" | "injected-test",
): D13D12BaselineAdmissionV1 {
	const capability = Object.freeze({
		revision: "graphrefly-ts.d13.d12-baseline-admission.v1" as const,
	});
	baselineStates.set(capability, basis);
	return capability;
}

export function admitD13D12Baseline(bytesValue: Uint8Array): D13D12BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D13 D12 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D13_D12_BASELINE_ARTIFACT_DIGEST)
		throw new TypeError("D13 D12 baseline artifact drifted");
	const bundle = validateD12CurrentGraphLiveBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.executionClass !== "live-provider" ||
		bundle.disposition !== "success" ||
		bundle.bundleDigest !== D13_D12_BASELINE_BUNDLE_DIGEST ||
		bundle.graphEvidence?.evidenceDigest !== D13_D12_BASELINE_GRAPH_DIGEST ||
		bundle.graphEvidence.transportFailureCount !== 6 ||
		bundle.generation?.generationDigest !== D13_D12_BASELINE_GENERATION_DIGEST ||
		bundle.generation.efficacyClaim !== "none"
	)
		throw new TypeError("D13 D12 baseline projection drifted");
	return baselineCapability("exact-d12-artifact");
}

export function createD13InjectedD12BaselineForTest(): D13D12BaselineAdmissionV1 {
	return baselineCapability("injected-test");
}

function providerElapsedMs(resultValue: unknown, path: string): number {
	const result = record(resultValue, path);
	if (result.effectKind !== "provider-request")
		throw new TypeError(`${path} is not a provider result`);
	const usage = record(result.usage, `${path}.usage`);
	const elapsed = usage.actualElapsedMs;
	if (!Number.isSafeInteger(elapsed) || (elapsed as number) < 0)
		throw new TypeError(`${path}.usage.actualElapsedMs is invalid`);
	return elapsed as number;
}

function officialPricingResponse(): Response {
	const response = new Response(
		JSON.stringify({
			data: {
				id: D12_CURRENT_GRAPH_LIVE_REQUEST_MODEL,
				endpoints: [
					{
						provider_name: D12_CURRENT_GRAPH_LIVE_PROVIDER_NAME,
						tag: D12_CURRENT_GRAPH_LIVE_PROVIDER_TAG,
						quantization: D12_CURRENT_GRAPH_LIVE_QUANTIZATION,
						model: D12_CURRENT_GRAPH_LIVE_SELECTED_ENDPOINT_MODEL,
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

async function boundaryEvidence(effect: CurrentGraphProviderAdmittedEffectV1) {
	if (effect.request.reservation.maxElapsedMs !== D13_PROVIDER_MAX_ELAPSED_MS)
		throw new TypeError("D13 provider reservation is not Graph-aligned");
	let requestScheduledMs = -1;
	const completed = await executeD11TransportBoundary({
		effect,
		phase: "request",
		scheduleTimeout: (_callback, milliseconds) => {
			requestScheduledMs = milliseconds;
			return () => undefined;
		},
		invoke: async () => ({
			effectKind: "provider-request" as const,
			status: "completed" as const,
			toolCalls: [],
			failureCode: null,
			retryProposal: null,
			usage: {
				requests: 1 as const,
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				actualCostMicrousd: 1,
				actualElapsedMs: 60_001,
				costBasis: "reported" as const,
			},
			evidenceDigest: empiricalStrictJsonDigest({ boundary: "completed-after-legacy" }),
		}),
	});
	if (
		completed.transportProposal !== null ||
		providerElapsedMs(completed.result, "D13 completed boundary result") !== 60_001
	)
		throw new TypeError("D13 legacy-boundary completion drifted");
	const deadline = await executeD11TransportBoundary({
		effect,
		phase: "response-body",
		scheduleTimeout: (callback, milliseconds) => {
			if (milliseconds !== D13_PROVIDER_MAX_ELAPSED_MS)
				throw new TypeError("D13 owned deadline scheduler drifted");
			void Promise.resolve().then(callback);
			return () => undefined;
		},
		invoke: async (signal) =>
			await new Promise<CurrentGraphProviderEffectResultInputV1>((_resolve, reject) => {
				signal.addEventListener(
					"abort",
					() => reject(new DOMException("Owned deadline", "AbortError")),
					{ once: true },
				);
			}),
	});
	if (
		deadline.transportProposal?.causeCode !== "owned-deadline" ||
		providerElapsedMs(deadline.result, "D13 deadline boundary result") !==
			D13_PROVIDER_MAX_ELAPSED_MS
	)
		throw new TypeError("D13 owned deadline classification drifted");
	const caller = new AbortController();
	caller.abort();
	let callerCancelled = false;
	try {
		await executeD11TransportBoundary({
			effect,
			phase: "request",
			callerSignal: caller.signal,
			invoke: async () => d11ConservativeTransportResult(effect, "request", "owned-deadline"),
		});
	} catch (error) {
		callerCancelled = error instanceof DOMException && error.name === "AbortError";
	}
	if (!callerCancelled || requestScheduledMs !== D13_PROVIDER_MAX_ELAPSED_MS)
		throw new TypeError("D13 cancellation or scheduling ownership drifted");
	const material = strictSnapshot({
		schemaVersion: "graphrefly-ts.d13.deadline-evidence.v1" as const,
		providerReservationMs: D13_PROVIDER_MAX_ELAPSED_MS,
		completedAfterLegacyDeadlineMs: D13_COMPLETED_PROVIDER_ELAPSED_MS,
		responseBodyRemainingMs: 59_999 as const,
		graphProviderResultsBeyondLegacy: D13_EXPECTED_PROVIDER_ATTEMPTS,
		ownedDeadlineAtMs: D13_PROVIDER_MAX_ELAPSED_MS,
		requestPhaseScheduledMs: D13_PROVIDER_MAX_ELAPSED_MS,
		callerCancellationDisposition: "propagated-not-admitted" as const,
		singleMonotonicDeadlinePassed: true as const,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

export async function runD13InjectedNoNetworkQualification(inputValue: {
	readonly repositoryRoot: string;
	readonly baseline: D13D12BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
}): Promise<D13QualificationBundleV1> {
	const input = record(inputValue, "D13 qualification input");
	exactKeys(
		input,
		["baseline", "implementationManifestDigest", "repositoryRoot"],
		"D13 qualification input",
	);
	const baseline = input.baseline as D13D12BaselineAdmissionV1;
	const baselineBasis =
		typeof baseline === "object" && baseline !== null ? baselineStates.get(baseline) : undefined;
	if (baselineBasis === undefined) throw new TypeError("D13 D12 baseline is forged or replayed");
	baselineStates.delete(baseline);
	const implementationManifestDigest = digest(
		input.implementationManifestDigest,
		"D13 implementation manifest",
	);
	if (implementationManifestDigest !== D13_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D13 qualification implementation manifest drifted");
	const repositoryRoot = await realpath(resolve(String(input.repositoryRoot)));
	if ((await measureD12Implementation(repositoryRoot)) !== D12_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D13 D12 implementation baseline drifted");
	if ((await measureD13Implementation(repositoryRoot)) !== D13_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D13 implementation source drifted before qualification");
	const temporaryRoot = await mkdtemp(join(tmpdir(), "graphrefly-d13-no-network-"));
	await chmod(temporaryRoot, 0o700);
	try {
		const credential = Object.freeze({
			bearerToken: "sk-or-v1-test-current-graph-live-key-d13",
			credentialBindingRef: "openrouter.local-eval-2" as const,
			credentialBindingRevision: "2026-08-14.v1" as const,
		});
		const wallNowMs = Math.trunc(performance.timeOrigin + performance.now());
		const pricing = await readCurrentGraphLiveOfficialPricing({
			fetch: async () => officialPricingResponse(),
			nowMs: () => wallNowMs,
		});
		const zeroByok = admitCurrentGraphLiveZeroByok({
			bytes: Buffer.from(
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
					allowedModels: [D12_CURRENT_GRAPH_LIVE_REQUEST_MODEL],
					allowedProviders: [D12_CURRENT_GRAPH_LIVE_PROVIDER_NAME],
					observedAt: new Date(wallNowMs).toISOString(),
					source: "openrouter-browser-settings",
				}),
			),
			credential,
			nowMs: wallNowMs,
		});
		composeCurrentGraphLivePreclaim({
			pricingObservation: pricing,
			zeroByokObservation: zeroByok,
			credential,
		});
		let virtualNow = 0;
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
				virtualNow += 60_001;
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
						throw new TypeError("D13 retry request bytes drifted");
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
					: D12_CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) => ({
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
		const baseExecutor = createD12CurrentGraphOpenRouterExecutor({
			repositoryRoot,
			materializationRoot,
			credential,
			fetchImpl,
			now: () => virtualNow,
			sleep: async (milliseconds) => {
				virtualNow += milliseconds;
			},
		});
		const authority = createD11TransportFailureAuthority({
			limits: D13_PROVIDER_LIMITS,
			routeProfile: D12_CURRENT_GRAPH_LIVE_ROUTE,
			taskProfile: D12_CURRENT_GRAPH_LIVE_TASK,
		});
		let deadline: D13DeadlineEvidenceV1 | null = null;
		try {
			for (let guard = 0; guard < D13_PROVIDER_LIMITS.maxEffectFacts; guard += 1) {
				const effect = takeD11ProviderEffect(authority);
				if (effect === null) break;
				if (effect.request.effectKind === "provider-request") {
					if (effect.request.reservation.maxElapsedMs !== D13_PROVIDER_MAX_ELAPSED_MS)
						throw new TypeError("D13 provider effect reservation drifted");
					deadline ??= await boundaryEvidence(effect);
				}
				const envelope = await baseExecutor.execute(effect);
				admitD11ProviderEffectEnvelope(authority, effect.request.requestDigest, envelope);
			}
		} finally {
			await baseExecutor.dispose();
		}
		const graphEvidence = validateD11TransportFailureEvidence(
			snapshotD11TransportFailureEvidence(authority),
		);
		if (deadline === null) throw new TypeError("D13 deadline evidence is missing");
		const graph = graphEvidence.d9Evidence.providerEvidence;
		const providerFacts = graph.facts.filter(
			(fact) => fact.request.effectKind === "provider-request",
		);
		if (
			graph.runStatus !== "complete" ||
			graph.workflowEvidence.runs.length !== 6 ||
			graph.workflowEvidence.runs.some(
				(run) =>
					run.status !== "completed" ||
					!run.publicSemanticValidationPassed ||
					!run.hiddenVerifierPassed ||
					run.cleanupStatus !== "completed",
			) ||
			graphEvidence.transportFailureCount !== 0 ||
			graphEvidence.d9Evidence.rejectionCount !== 0 ||
			graph.budget.retryWaits !== 1 ||
			graph.budget.providerAttempts !== providerCalls ||
			providerCalls !== D13_EXPECTED_PROVIDER_ATTEMPTS ||
			providerFacts.length !== D13_EXPECTED_PROVIDER_ATTEMPTS ||
			providerFacts.some(
				(fact) =>
					fact.result.effectKind !== "provider-request" ||
					fact.result.usage.actualElapsedMs !== D13_COMPLETED_PROVIDER_ELAPSED_MS ||
					fact.reconciliation.actualElapsedMs !== D13_COMPLETED_PROVIDER_ELAPSED_MS,
			) ||
			graph.budget.confirmedElapsedMs <= D13_LEGACY_PROVIDER_MAX_ELAPSED_MS ||
			maxActive !== 1 ||
			pendingRetryBodyDigest !== null
		)
			throw new TypeError("D13 six-arm deadline-aligned Graph projection drifted");
		await lstat(materializationRoot).then(
			() => {
				throw new TypeError("D13 no-network left workspace residue");
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
			throw new TypeError("D13 no-network mutated the source workspace");
		const qualificationMaterial = strictSnapshot({
			schemaVersion: D13_QUALIFICATION_SCHEMA,
			decisionRef: D13_DECISION_REF,
			baselineBasis,
			coordinatesDigest: D13_COORDINATES_DIGEST,
			implementationManifestDigest,
			d12BaselineArtifactDigest: D13_D12_BASELINE_ARTIFACT_DIGEST,
			d12BaselineBundleDigest: D13_D12_BASELINE_BUNDLE_DIGEST,
			d12BaselineGraphDigest: D13_D12_BASELINE_GRAPH_DIGEST,
			d12BaselineGenerationDigest: D13_D12_BASELINE_GENERATION_DIGEST,
			graphEvidenceDigest: graphEvidence.evidenceDigest,
			deadlineEvidenceDigest: deadline.evidenceDigest,
			fullSixArmIntegrationPassed: true as const,
			deadlineAlignmentPassed: true as const,
			retryIdentityPassed: true as const,
			cancellationOwnershipPassed: true as const,
			providerAttempts: graph.budget.providerAttempts,
			confirmedCostMicrousd: graph.budget.confirmedCostMicrousd,
			confirmedElapsedMs: graph.budget.confirmedElapsedMs,
			retryWaits: 1 as const,
			maxActiveTransport: 1 as const,
			providerNetworkCalls: 0 as const,
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
			schemaVersion: D13_QUALIFICATION_GENERATION_SCHEMA,
			generationRef: D13_QUALIFICATION_GENERATION_REF,
			qualificationDigest: qualification.qualificationDigest,
			graphEvidenceDigest: graphEvidence.evidenceDigest,
			deadlineEvidenceDigest: deadline.evidenceDigest,
			implementationManifestDigest,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
		});
		const generation = Object.freeze({
			...generationMaterial,
			generationDigest: empiricalStrictJsonDigest(generationMaterial),
		});
		const bundleMaterial = strictSnapshot({
			schemaVersion: D13_QUALIFICATION_BUNDLE_SCHEMA,
			qualification,
			graphEvidence,
			deadlineEvidence: deadline,
			generation,
		});
		const bundle = Object.freeze({
			...bundleMaterial,
			bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
		}) as D13QualificationBundleV1;
		if (
			strictJsonCodec.encode(bundle as unknown as StrictJsonValue).byteLength >
			D13_MAX_QUALIFICATION_BYTES
		)
			throw new TypeError("D13 qualification exceeded its byte bound");
		if ((await measureD13Implementation(repositoryRoot)) !== implementationManifestDigest)
			throw new TypeError("D13 implementation changed during qualification");
		constructedBundles.add(bundle);
		return bundle;
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

function validateDeadlineEvidence(value: unknown): D13DeadlineEvidenceV1 {
	const candidate = record(value, "D13 deadline evidence");
	exactKeys(
		candidate,
		[
			"callerCancellationDisposition",
			"completedAfterLegacyDeadlineMs",
			"evidenceDigest",
			"graphProviderResultsBeyondLegacy",
			"ownedDeadlineAtMs",
			"providerReservationMs",
			"requestPhaseScheduledMs",
			"responseBodyRemainingMs",
			"schemaVersion",
			"singleMonotonicDeadlinePassed",
		],
		"D13 deadline evidence",
	);
	const { evidenceDigest, ...material } = candidate;
	if (
		candidate.schemaVersion !== "graphrefly-ts.d13.deadline-evidence.v1" ||
		candidate.providerReservationMs !== D13_PROVIDER_MAX_ELAPSED_MS ||
		candidate.completedAfterLegacyDeadlineMs !== D13_COMPLETED_PROVIDER_ELAPSED_MS ||
		candidate.responseBodyRemainingMs !== 59_999 ||
		candidate.graphProviderResultsBeyondLegacy !== D13_EXPECTED_PROVIDER_ATTEMPTS ||
		candidate.ownedDeadlineAtMs !== D13_PROVIDER_MAX_ELAPSED_MS ||
		candidate.requestPhaseScheduledMs !== D13_PROVIDER_MAX_ELAPSED_MS ||
		candidate.callerCancellationDisposition !== "propagated-not-admitted" ||
		candidate.singleMonotonicDeadlinePassed !== true ||
		evidenceDigest !== empiricalStrictJsonDigest(material)
	)
		throw new TypeError("D13 deadline evidence drifted");
	return strictSnapshot(candidate) as unknown as D13DeadlineEvidenceV1;
}

export function validateD13QualificationBundle(value: unknown): D13QualificationBundleV1 {
	const candidate = record(value, "D13 qualification bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"deadlineEvidence",
			"generation",
			"graphEvidence",
			"qualification",
			"schemaVersion",
		],
		"D13 qualification bundle",
	);
	if (candidate.schemaVersion !== D13_QUALIFICATION_BUNDLE_SCHEMA)
		throw new TypeError("D13 qualification bundle schema drifted");
	const graphEvidence = validateD11TransportFailureEvidence(candidate.graphEvidence);
	const deadlineEvidence = validateDeadlineEvidence(candidate.deadlineEvidence);
	const graph = graphEvidence.d9Evidence.providerEvidence;
	const qualification = record(candidate.qualification, "D13 qualification");
	exactKeys(
		qualification,
		[
			"baselineBasis",
			"cancellationOwnershipPassed",
			"causalAttribution",
			"cleanupPassed",
			"confirmedCostMicrousd",
			"confirmedElapsedMs",
			"coordinatesDigest",
			"d12BaselineArtifactDigest",
			"d12BaselineBundleDigest",
			"d12BaselineGenerationDigest",
			"d12BaselineGraphDigest",
			"deadlineAlignmentPassed",
			"deadlineEvidenceDigest",
			"decisionRef",
			"efficacyClaim",
			"fullSixArmIntegrationPassed",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"maxActiveTransport",
			"providerAttempts",
			"providerNetworkCalls",
			"qualificationDigest",
			"retryIdentityPassed",
			"retryWaits",
			"schemaVersion",
			"workspaceResidueCount",
		],
		"D13 qualification",
	);
	const { qualificationDigest, ...qualificationMaterial } = qualification;
	if (
		qualification.schemaVersion !== D13_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== D13_DECISION_REF ||
		(qualification.baselineBasis !== "exact-d12-artifact" &&
			qualification.baselineBasis !== "injected-test") ||
		qualification.coordinatesDigest !== D13_COORDINATES_DIGEST ||
		qualification.implementationManifestDigest !== D13_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.d12BaselineArtifactDigest !== D13_D12_BASELINE_ARTIFACT_DIGEST ||
		qualification.d12BaselineBundleDigest !== D13_D12_BASELINE_BUNDLE_DIGEST ||
		qualification.d12BaselineGraphDigest !== D13_D12_BASELINE_GRAPH_DIGEST ||
		qualification.d12BaselineGenerationDigest !== D13_D12_BASELINE_GENERATION_DIGEST ||
		qualification.graphEvidenceDigest !== graphEvidence.evidenceDigest ||
		qualification.deadlineEvidenceDigest !== deadlineEvidence.evidenceDigest ||
		qualification.fullSixArmIntegrationPassed !== true ||
		qualification.deadlineAlignmentPassed !== true ||
		qualification.retryIdentityPassed !== true ||
		qualification.cancellationOwnershipPassed !== true ||
		qualification.providerAttempts !== graph.budget.providerAttempts ||
		qualification.providerAttempts !== D13_EXPECTED_PROVIDER_ATTEMPTS ||
		qualification.confirmedCostMicrousd !== graph.budget.confirmedCostMicrousd ||
		qualification.confirmedElapsedMs !== graph.budget.confirmedElapsedMs ||
		qualification.retryWaits !== graph.budget.retryWaits ||
		qualification.retryWaits !== 1 ||
		qualification.maxActiveTransport !== 1 ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.cleanupPassed !== true ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none" ||
		graph.runStatus !== "complete" ||
		graph.workflowEvidence.runs.length !== 6 ||
		graph.workflowEvidence.runs.some(
			(run) =>
				run.status !== "completed" ||
				!run.publicSemanticValidationPassed ||
				!run.hiddenVerifierPassed ||
				run.cleanupStatus !== "completed",
		) ||
		graphEvidence.transportFailureCount !== 0 ||
		graphEvidence.d9Evidence.rejectionCount !== 0 ||
		graph.facts.filter((fact) => fact.request.effectKind === "provider-request").length !==
			D13_EXPECTED_PROVIDER_ATTEMPTS ||
		graph.facts
			.filter((fact) => fact.request.effectKind === "provider-request")
			.some(
				(fact) =>
					fact.request.reservation.maxElapsedMs !== D13_PROVIDER_MAX_ELAPSED_MS ||
					fact.result.effectKind !== "provider-request" ||
					fact.result.usage.actualElapsedMs !== D13_COMPLETED_PROVIDER_ELAPSED_MS ||
					fact.reconciliation.actualElapsedMs !== D13_COMPLETED_PROVIDER_ELAPSED_MS,
			) ||
		qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial)
	)
		throw new TypeError("D13 qualification projection drifted");
	const generation = record(candidate.generation, "D13 generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"deadlineEvidenceDigest",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"D13 generation",
	);
	const { generationDigest, ...generationMaterial } = generation;
	if (
		generation.schemaVersion !== D13_QUALIFICATION_GENERATION_SCHEMA ||
		generation.generationRef !== D13_QUALIFICATION_GENERATION_REF ||
		generation.qualificationDigest !== qualificationDigest ||
		generation.graphEvidenceDigest !== graphEvidence.evidenceDigest ||
		generation.deadlineEvidenceDigest !== deadlineEvidence.evidenceDigest ||
		generation.implementationManifestDigest !== qualification.implementationManifestDigest ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none" ||
		generationDigest !== empiricalStrictJsonDigest(generationMaterial)
	)
		throw new TypeError("D13 generation drifted");
	const { bundleDigest, ...bundleMaterial } = candidate;
	if (bundleDigest !== empiricalStrictJsonDigest(bundleMaterial))
		throw new TypeError("D13 qualification bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D13QualificationBundleV1;
}

async function persistQualification(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D13QualificationBundleV1;
	readonly expectedBasis: "exact-d12-artifact" | "injected-test";
	readonly generationRef: string;
}) {
	const input = record(inputValue, "D13 persistence input");
	exactKeys(
		input,
		["bundle", "expectedBasis", "generationRef", "privateRoot"],
		"D13 persistence input",
	);
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("D13 persistence requires a fresh constructed bundle");
	const bundle = validateD13QualificationBundle(input.bundle);
	if (bundle.qualification.baselineBasis !== input.expectedBasis)
		throw new TypeError("D13 persistence basis drifted");
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const qualificationBytes = strictJsonCodec.encode(
		bundle.qualification as unknown as StrictJsonValue,
	);
	const generationBytes = strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d13.provider-deadline-commit.v1",
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
		schemaVersion: D13_QUALIFICATION_PERSISTENCE_SCHEMA,
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

export function persistD13QualificationBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D13QualificationBundleV1;
}) {
	return persistQualification({
		...input,
		expectedBasis: "exact-d12-artifact",
		generationRef: D13_QUALIFICATION_GENERATION_REF,
	});
}

export function persistD13InjectedQualificationForTest(input: {
	readonly privateRoot: string;
	readonly bundle: D13QualificationBundleV1;
}) {
	return persistQualification({
		...input,
		expectedBasis: "injected-test",
		generationRef: D13_INJECTED_TEST_GENERATION_REF,
	});
}
