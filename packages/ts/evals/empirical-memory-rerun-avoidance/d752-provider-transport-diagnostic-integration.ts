import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import type { D722CanonicalGraphEvidenceV1 } from "./d722-graph-completion-memory-insight.js";
import type {
	D720EffectResultV1,
	D720GraphEffectRequestV1,
	D720ToolRef,
} from "./d722-graph-native-effect-runtime.js";
import type { D720CallerEffectExecutionInputV2 } from "./d722-graph-native-eval.js";
import {
	createD722InjectedModelFixture,
	invokeD722InjectedModelFixture,
} from "./d722-injected-model-fixture.js";
import { D733_DEEPSEEK_V4_FLASH_0731_PROFILE } from "./d733-coordinates.js";
import {
	createD733GraphNativeRouteAdmission,
	createD733RouteAccessProjection,
	createD733RouteEligibility,
	type D733GraphNativeRouteAdmissionV1,
} from "./d733-graph-native-route-profile.js";
import {
	createD734RouteBoundProviderAdapter,
	type D734RouteBoundProviderAdapterV1,
	type D734RouteBoundProviderTurnV1,
	type D734RouteGraphEvidenceV1,
	invokeD734RouteBoundOpenRouterTurn,
	runD734RouteProfileSixArmIntegration,
	validateD734RouteGraphEvidence,
} from "./d734-route-profile-provider-integration.js";
import {
	admitD751TransportDiagnostic,
	createD751TransportDiagnosticAuthority,
	D751_GENERATION_REF,
	D751_IMMUTABLE_D750,
	type D751TransportDiagnosticGraphEvidenceV1,
	type D751TransportDiagnosticProposalV1,
	executeD751SanitizedTransportBoundary,
	snapshotD751TransportDiagnosticGraphEvidence,
	validateD751Qualification,
	validateD751TransportDiagnosticGraphEvidence,
} from "./d751-sanitized-transport-diagnostic.js";
import {
	D752_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD752Implementation,
} from "./d752-implementation-manifest.js";
import type { OpenRouterResponsesTransportResponseV1 } from "./openrouter-responses-model-turn.js";
import { createOpenRouterTransportFailure } from "./openrouter-transport-failure.js";

export const D752_DECISION_REF = "decision.D752" as const;
export const D752_DECISION_REVISION = "2026-08-12.v1" as const;
export const D752_ADAPTER_REVISION =
	"graphrefly.b112.d752.transport-diagnostic-route-adapter.v1" as const;
export const D752_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d752.transport-diagnostic-provider-integration-qualification.v1" as const;
export const D752_BUNDLE_SCHEMA =
	"graphrefly.b112.d752.transport-diagnostic-provider-integration-bundle.v1" as const;
export const D752_GENERATION_SCHEMA =
	"graphrefly.b112.d752.transport-diagnostic-provider-integration-generation.v1" as const;
export const D752_GENERATION_REF =
	"d752-transport-diagnostic-provider-integration-pre-live-2026-08-12-v1" as const;

export const D752_D751_BASELINE = Object.freeze({
	implementationCommit: "31de3d8d",
	implementationManifestDigest:
		"sha256:26ee44ba8c0afe0e29721f7c377ad0b0860c0b50bcfb6206ba0a9ba874254489",
	qualificationArtifactSha256:
		"sha256:bdeddf7e1cf977f13584274c7560cf5de23f786d3aa27e06d2e195bd176b98e8",
	qualificationDigest: "sha256:fe2a3aa526f3156fc62763adc7616c2a4bb52b0b1a0a1ffe3778a8fe9936ad50",
	generationArtifactSha256:
		"sha256:8bf5b3c45ac25c6ad65cd1f0808676f7d5a8fa6df9090a41609e4e0cd6b5423a",
	generationDigest: "sha256:96ee90686fc09549bfc4c23ae0c0719fe6c54e447b2e8cc46b81cda732a5937b",
	generationRef: D751_GENERATION_REF,
	historicalD750: D751_IMMUTABLE_D750,
});

type EffectPort = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<Readonly<Record<string, unknown>>>;
type RouteProviderPort = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<D734RouteBoundProviderTurnV1>;

interface PendingProposal {
	readonly requestDigest: string;
	readonly proposal: D751TransportDiagnosticProposalV1;
}

interface AdapterState {
	readonly proposals: PendingProposal[];
	finalized: boolean;
}

export interface D752TransportDiagnosticRouteAdapterV1 {
	readonly revision: typeof D752_ADAPTER_REVISION;
	readonly adapter: D734RouteBoundProviderAdapterV1;
}

export interface D752AdapterFinalizationV1 {
	readonly transportGraphEvidence: D751TransportDiagnosticGraphEvidenceV1;
	readonly terminalDiagnosticProposalCount: number;
	readonly retryDiagnosticProposalCount: number;
}

export interface D752QualificationV1 {
	readonly schemaVersion: typeof D752_QUALIFICATION_SCHEMA;
	readonly decisionRef: typeof D752_DECISION_REF;
	readonly decisionRevision: typeof D752_DECISION_REVISION;
	readonly d751Baseline: typeof D752_D751_BASELINE;
	readonly implementationManifestDigest: string;
	readonly graphEvidence: readonly D722CanonicalGraphEvidenceV1[];
	readonly routeEvidence: readonly D734RouteGraphEvidenceV1[];
	readonly transportGraphEvidence: D751TransportDiagnosticGraphEvidenceV1;
	readonly graphProviderResultCount: number;
	readonly graphRouteResultCount: number;
	readonly graphTransportFailureResultCount: number;
	readonly graphNonTransportFailureResultCount: number;
	readonly retryWaitCount: number;
	readonly terminalDiagnosticProposalCount: number;
	readonly retryDiagnosticProposalCount: number;
	readonly proposalReplayRejected: true;
	readonly networkCallCount: 0;
	readonly maxActiveEffects: 1;
	readonly allSixArmsCompleted: true;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly qualificationDigest: string;
}

export interface D752BundleV1 {
	readonly schemaVersion: typeof D752_BUNDLE_SCHEMA;
	readonly qualification: D752QualificationV1;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly bundleDigest: string;
}

export interface D752PersistenceReceiptV1 {
	readonly generationPath: string;
	readonly qualificationDigest: string;
	readonly generationDigest: string;
	readonly bundleDigest: string;
}

export interface D752PersistenceFaultV1 {
	readonly revision: "graphrefly.b112.d752.persistence-fault.v1";
}

const adapterStates = new WeakMap<object, AdapterState>();
const constructedQualifications = new WeakSet<object>();
const constructedBundles = new WeakSet<object>();
const persistenceFaults = new WeakMap<
	object,
	"after-staging" | "after-commit" | "after-rename" | "after-final-sync"
>();

function functionsOnly(input: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
	for (const key of keys)
		if (typeof input[key] !== "function") throw new TypeError(`D752 ${key} port is invalid`);
}

export function createD752TransportDiagnosticRouteAdapter(inputValue: {
	readonly routeAdmission: D733GraphNativeRouteAdmissionV1;
	readonly executionClass?: "injected-no-network" | "live-provider";
	readonly materialization: EffectPort;
	readonly providerRequest: RouteProviderPort;
	readonly retryWait: EffectPort;
	readonly toolAction: EffectPort;
	readonly hiddenVerifier: EffectPort;
	readonly cleanup: EffectPort;
}): D752TransportDiagnosticRouteAdapterV1 {
	const input = record(inputValue, "d752.adapter");
	exactKeys(
		input,
		[
			"cleanup",
			...(Object.hasOwn(input, "executionClass") ? (["executionClass"] as const) : []),
			"hiddenVerifier",
			"materialization",
			"providerRequest",
			"retryWait",
			"routeAdmission",
			"toolAction",
		],
		"d752.adapter",
	);
	functionsOnly(input, [
		"cleanup",
		"hiddenVerifier",
		"materialization",
		"providerRequest",
		"retryWait",
		"toolAction",
	]);
	const proposals: PendingProposal[] = [];
	const providerRequest = input.providerRequest as RouteProviderPort;
	const adapter = createD734RouteBoundProviderAdapter({
		routeAdmission: input.routeAdmission as D733GraphNativeRouteAdmissionV1,
		...(Object.hasOwn(input, "executionClass")
			? { executionClass: input.executionClass as "injected-no-network" | "live-provider" }
			: {}),
		materialization: input.materialization as never,
		retryWait: input.retryWait as never,
		toolAction: input.toolAction as never,
		hiddenVerifier: input.hiddenVerifier as never,
		cleanup: input.cleanup as never,
		async providerRequest(executionInput) {
			let capturedFailure: readonly [unknown] | null = null;
			const sanitized = await executeD751SanitizedTransportBoundary(async () => {
				try {
					return (await Reflect.apply(providerRequest, undefined, [executionInput])) as never;
				} catch (error) {
					capturedFailure = Object.freeze([error]);
					throw error;
				}
			}, executionInput.effectRequest.requestDigest);
			if (sanitized.proposal === null)
				return sanitized.turn as unknown as D734RouteBoundProviderTurnV1;
			if (capturedFailure === null)
				throw new TypeError("D752 diagnostic proposal omitted its transport failure");
			if (proposals.length >= 24) throw new TypeError("D752 diagnostic proposal bound exhausted");
			proposals.push(
				Object.freeze({
					requestDigest: executionInput.effectRequest.requestDigest,
					proposal: sanitized.proposal,
				}),
			);
			throw capturedFailure[0];
		},
	});
	const capability = Object.freeze({ revision: D752_ADAPTER_REVISION, adapter });
	adapterStates.set(capability, { proposals, finalized: false });
	return capability;
}

function providerFacts(graphEvidence: D722CanonicalGraphEvidenceV1) {
	return graphEvidence.effectRuns.flatMap((run) =>
		run.facts.filter(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.effectKind === "provider-request",
		),
	);
}

export function finalizeD752TransportDiagnostics(
	capability: D752TransportDiagnosticRouteAdapterV1,
	graphEvidence: D722CanonicalGraphEvidenceV1,
): D752AdapterFinalizationV1 {
	const state = adapterStates.get(capability);
	if (state === undefined || state.finalized)
		throw new TypeError("D752 adapter diagnostic state is invalid or consumed");
	state.finalized = true;
	const authority = createD751TransportDiagnosticAuthority();
	const facts = providerFacts(graphEvidence);
	let terminalDiagnosticProposalCount = 0;
	let retryDiagnosticProposalCount = 0;
	for (const pending of state.proposals) {
		const matches = facts.filter(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.request.requestDigest === pending.requestDigest,
		);
		if (matches.length < 1) throw new TypeError("D752 proposal lacks a Graph provider result");
		const terminal = matches.filter(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.status === "terminal-failure" &&
				fact.result.failureProvenance === "executor-failure" &&
				fact.result.executorFailureClassification === "transport-failure",
		);
		if (terminal.length === 1) {
			admitD751TransportDiagnostic(authority, {
				proposal: pending.proposal,
				graphEvidence,
			});
			terminalDiagnosticProposalCount += 1;
			continue;
		}
		const retry = matches.filter(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.status === "retryable-failure" &&
				fact.result.failureDiscriminator === "d675-und-err-socket",
		);
		if (retry.length !== 1)
			throw new TypeError("D752 diagnostic proposal has no terminal or D675 Graph disposition");
		let rejected = false;
		try {
			admitD751TransportDiagnostic(authority, {
				proposal: pending.proposal,
				graphEvidence,
			});
		} catch {
			rejected = true;
		}
		if (!rejected) throw new TypeError("D752 retry-only diagnostic became a terminal fact");
		retryDiagnosticProposalCount += 1;
	}
	return Object.freeze({
		transportGraphEvidence: validateD751TransportDiagnosticGraphEvidence(
			snapshotD751TransportDiagnosticGraphEvidence(authority),
			[graphEvidence],
		),
		terminalDiagnosticProposalCount,
		retryDiagnosticProposalCount,
	});
}

const encoder = new TextEncoder();
const toolNames: Readonly<Record<D720ToolRef, string>> = Object.freeze({
	"read-file": "read_file",
	"search-repository": "search_repository",
	"replace-exact": "replace_exact",
	"workspace-diff": "workspace_diff",
	"focused-validation": "focused_validation",
});

function routeAdmission(): D733GraphNativeRouteAdmissionV1 {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	return createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d752.injected-access.v1",
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

function argsFor(toolRef: D720ToolRef): Record<string, string> {
	switch (toolRef) {
		case "read-file":
			return { path: "fixture.ts" };
		case "search-repository":
			return { query: "fixture" };
		case "replace-exact":
			return { path: "fixture.ts", oldText: "before", newText: "after" };
		case "workspace-diff":
		case "focused-validation":
			return {};
	}
}

function successResponse(
	request: D720GraphEffectRequestV1,
	result: D720EffectResultV1,
): OpenRouterResponsesTransportResponseV1 {
	if (result.effectKind !== "provider-request") throw new TypeError("D752 model result is invalid");
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	const calls = result.toolIntents.map((intent, index) => ({
		id: `d752-${request.runSequence}-${request.effectSequence}-${index}`,
		type: "function",
		function: {
			name: toolNames[intent.toolRef],
			arguments: JSON.stringify(argsFor(intent.toolRef)),
		},
	}));
	return Object.freeze({
		status: 200,
		retryAfterMs: null,
		body: encoder.encode(
			JSON.stringify({
				id: `d752-response-${request.runSequence}-${request.effectSequence}`,
				usage: { prompt_tokens: 17, completion_tokens: 11 },
				choices: [
					calls.length > 0
						? { finish_reason: "tool_calls", message: { content: null, tool_calls: calls } }
						: { finish_reason: "stop", message: { content: '{"completed":true}' } },
				],
				openrouter_metadata: {
					endpoints: {
						available: [
							{
								provider: profile.providerName,
								model: profile.selectedEndpointModel,
								selected: true,
							},
						],
					},
				},
			}),
		),
	});
}

type InjectedScenario = "mixed-retry-transport" | "non-transport";

interface InjectedFixture {
	readonly capability: D752TransportDiagnosticRouteAdapterV1;
	readonly operationalState: () => {
		readonly maxActiveEffects: 0 | 1;
		readonly activeWorkspaces: number;
	};
}

function injectedFixture(scenario: InjectedScenario): InjectedFixture {
	const model = createD722InjectedModelFixture();
	const admission = routeAdmission();
	const workspaces = new Map<number, string>();
	const runIndexes = new Map<number, number>();
	const attempts = new Map<number, number>();
	let monotonicTick = 0;
	let active = 0;
	let maxActiveEffects: 0 | 1 = 0;
	const enter = () => {
		if (active !== 0) throw new TypeError("D752 observed parallel effects");
		active = 1;
		maxActiveEffects = 1;
	};
	const leave = () => {
		active = 0;
	};
	const indexFor = (runSequence: number) => {
		let index = runIndexes.get(runSequence);
		if (index === undefined) {
			index = runIndexes.size;
			runIndexes.set(runSequence, index);
		}
		return index;
	};
	const capability = createD752TransportDiagnosticRouteAdapter({
		routeAdmission: admission,
		async materialization({ effectRequest }) {
			enter();
			try {
				indexFor(effectRequest.runSequence);
				const workspace = empiricalStrictJsonDigest({
					d752: "workspace",
					run: effectRequest.runSequence,
				});
				workspaces.set(effectRequest.runSequence, workspace);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "materialization",
						status: "ready",
						workspaceStateDigest: workspace,
						evidenceDigest: empiricalStrictJsonDigest({ workspace, materialized: true }),
					},
				};
			} finally {
				leave();
			}
		},
		async providerRequest(executionInput) {
			enter();
			try {
				monotonicTick += 1;
				const request = executionInput.effectRequest;
				const runIndex = indexFor(request.runSequence);
				const attempt = (attempts.get(request.runSequence) ?? 0) + 1;
				attempts.set(request.runSequence, attempt);
				if (scenario === "non-transport" && runIndex === 0) {
					throw new TypeError("D752 injected non-transport executor failure");
				}
				const routeTurn: D734RouteBoundProviderTurnV1 = await invokeD734RouteBoundOpenRouterTurn({
					effectRequest: request,
					credential: {
						bearerToken: "not-a-live-d752-injected-credential",
						credentialBindingRef: "d752.injected-no-network",
						credentialBindingRevision: "v1",
					},
					transport: {
						async request() {
							if (scenario === "mixed-retry-transport" && attempt === 1) {
								if (runIndex === 0)
									return Object.freeze({
										status: 429,
										retryAfterMs: 7_000,
										retryAfterDisposition: "parsed" as const,
										body: encoder.encode('{"error":{"type":"rate_limit_exceeded"}}'),
									});
								if (runIndex === 1) {
									throw createOpenRouterTransportFailure("request", { code: "UND_ERR_SOCKET" });
								}
								if (runIndex === 2)
									return Object.freeze({
										status: 429,
										retryAfterMs: null,
										retryAfterDisposition: "absent" as const,
										body: encoder.encode('{"error":{"message":"bounded retry"}}'),
									});
								if (runIndex === 3 || runIndex === 4) {
									throw createOpenRouterTransportFailure("request", {
										code: runIndex === 3 ? "ECONNRESET" : "ENOTFOUND",
									});
								}
							}
							const result = await invokeD722InjectedModelFixture(model, request);
							return successResponse(request, result);
						},
					},
					taskStatement: "D752 injected no-network task",
					conversation: Object.freeze({ messages: Object.freeze([]) }),
					signal: executionInput.signal ?? new AbortController().signal,
					monotonicNowMs: () => monotonicTick,
					routeAdmission: admission,
					usageBasis: "measured",
				});
				return routeTurn;
			} finally {
				leave();
			}
		},
		async retryWait({ effectRequest }) {
			enter();
			try {
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: effectRequest.retryAfterMs ?? 60_000,
					result: {
						effectKind: "retry-wait",
						status: "completed",
						evidenceDigest: empiricalStrictJsonDigest({ retry: effectRequest.requestDigest }),
					},
				};
			} finally {
				leave();
			}
		},
		async toolAction({ effectRequest }) {
			enter();
			try {
				const intent = effectRequest.toolIntent;
				if (intent === null) throw new TypeError("D752 tool request omitted intent");
				const before = workspaces.get(effectRequest.runSequence);
				if (before === undefined) throw new TypeError("D752 tool request omitted workspace");
				const after =
					intent.toolRef === "replace-exact"
						? empiricalStrictJsonDigest({ before, intent: intent.intentDigest })
						: before;
				workspaces.set(effectRequest.runSequence, after);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "tool-action",
						toolRef: intent.toolRef,
						intentDigest: intent.intentDigest,
						status: "succeeded",
						nonEmptyDiff: intent.toolRef === "workspace-diff",
						workspaceStateBeforeDigest: before,
						workspaceStateAfterDigest: after,
						evidenceDigest: empiricalStrictJsonDigest({ before, after, intent }),
					},
				};
			} finally {
				leave();
			}
		},
		async hiddenVerifier({ effectRequest }) {
			enter();
			try {
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "hidden-verifier",
						status: "passed",
						evidenceDigest: empiricalStrictJsonDigest({ verified: effectRequest.runSequence }),
					},
				};
			} finally {
				leave();
			}
		},
		async cleanup({ effectRequest }) {
			enter();
			try {
				workspaces.delete(effectRequest.runSequence);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "cleanup",
						status: "succeeded",
						evidenceDigest: empiricalStrictJsonDigest({ cleaned: effectRequest.runSequence }),
					},
				};
			} finally {
				leave();
			}
		},
	});
	return Object.freeze({
		capability,
		operationalState: () =>
			Object.freeze({
				maxActiveEffects,
				activeWorkspaces: workspaces.size,
			}),
	});
}

function retryWaitCount(graph: D722CanonicalGraphEvidenceV1): number {
	return graph.ledger.effectProposals.filter((proposal) => proposal.effectKind === "retry-wait")
		.length;
}

function retryReasons(graphs: readonly D722CanonicalGraphEvidenceV1[]): readonly string[] {
	return Object.freeze(
		graphs
			.flatMap((graph) =>
				graph.ledger.effectProposals.flatMap((proposal) =>
					proposal.effectKind === "retry-wait" ? [proposal.retryReason] : [],
				),
			)
			.sort(),
	);
}

const D752_EXPECTED_RETRY_REASONS = Object.freeze([
	"d671-rate-limit-exceeded",
	"d675-und-err-socket",
	"d710-untyped-http-429",
]);

function providerEffectCount(graph: D722CanonicalGraphEvidenceV1): number {
	return graph.ledger.effectProposals.filter(
		(proposal) => proposal.effectKind === "provider-request",
	).length;
}

function deriveProviderResultCounts(graphs: readonly D722CanonicalGraphEvidenceV1[]) {
	const facts = graphs.flatMap(providerFacts);
	return Object.freeze({
		graphProviderResultCount: facts.length,
		graphRouteResultCount: facts.filter(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.effectKind === "provider-request" &&
				fact.result.failureProvenance !== "executor-failure",
		).length,
		graphTransportFailureResultCount: facts.filter(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.effectKind === "provider-request" &&
				fact.result.failureProvenance === "executor-failure" &&
				fact.result.executorFailureClassification === "transport-failure",
		).length,
		graphNonTransportFailureResultCount: facts.filter(
			(fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.effectKind === "provider-request" &&
				fact.result.failureProvenance === "executor-failure" &&
				fact.result.executorFailureClassification !== "transport-failure",
		).length,
	});
}

function validateRouteGraphBijection(
	graph: D722CanonicalGraphEvidenceV1,
	route: D734RouteGraphEvidenceV1,
): void {
	const expected = providerFacts(graph).filter(
		(fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.failureProvenance !== "executor-failure",
	);
	if (expected.length !== route.facts.length)
		throw new TypeError("D752 route/Graph provider coverage drifted");
	const keys = new Set(
		route.facts.map(
			(fact) =>
				`${fact.effectRequestDigest}:${fact.effectAdmissionDigest}:${fact.providerResultDigest}`,
		),
	);
	if (keys.size !== route.facts.length) throw new TypeError("D752 route facts are duplicated");
	for (const fact of expected) {
		if (fact.kind !== "graph-effect-result-admitted") continue;
		const key = `${fact.request.requestDigest}:${fact.admissionDigest}:${fact.resultDigest}`;
		if (!keys.has(key)) throw new TypeError("D752 route fact omitted a Graph provider result");
	}
}

function verifyD751Baseline(bytes: Uint8Array): void {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16 * 1_048_576)
		throw new TypeError("D752 D751 qualification bytes are invalid");
	literal(
		empiricalSha256(bytes),
		D752_D751_BASELINE.qualificationArtifactSha256,
		"d752.d751Artifact",
	);
	const qualification = validateD751Qualification(strictJsonCodec.decode(new Uint8Array(bytes)));
	literal(
		qualification.implementationManifestDigest,
		D752_D751_BASELINE.implementationManifestDigest,
		"d752.d751Manifest",
	);
	literal(
		qualification.qualificationDigest,
		D752_D751_BASELINE.qualificationDigest,
		"d752.d751Qualification",
	);
}

export async function runD752InjectedNoNetworkQualification(inputValue: {
	readonly d751QualificationBytes: Uint8Array;
}): Promise<D752BundleV1> {
	const input = record(inputValue, "d752.qualificationInput");
	exactKeys(input, ["d751QualificationBytes"], "d752.qualificationInput");
	const manifest = await measureD752Implementation();
	verifyD751Baseline(input.d751QualificationBytes as Uint8Array);
	const graphEvidence: D722CanonicalGraphEvidenceV1[] = [];
	const routeEvidence: D734RouteGraphEvidenceV1[] = [];
	const finalizations: D752AdapterFinalizationV1[] = [];
	let maxActiveEffects: 0 | 1 = 0;
	let proposalReplayRejected = false;
	for (const scenario of ["mixed-retry-transport", "non-transport"] as const) {
		const fixture = injectedFixture(scenario);
		const result = await runD734RouteProfileSixArmIntegration({
			sourceDigest: empiricalStrictJsonDigest({ manifest, scenario }),
			adapter: fixture.capability.adapter,
			signal: new AbortController().signal,
		});
		if (result.run.graphEvidence.ledger.completedArms.length !== 6)
			throw new TypeError("D752 did not complete all six Graph arms");
		const finalization = finalizeD752TransportDiagnostics(
			fixture.capability,
			result.run.graphEvidence,
		);
		if (!proposalReplayRejected) {
			try {
				finalizeD752TransportDiagnostics(fixture.capability, result.run.graphEvidence);
			} catch {
				proposalReplayRejected = true;
			}
		}
		const operationalState = fixture.operationalState();
		if (operationalState.activeWorkspaces !== 0 || operationalState.maxActiveEffects !== 1)
			throw new TypeError("D752 serial execution or cleanup drifted");
		graphEvidence.push(result.run.graphEvidence);
		routeEvidence.push(validateD734RouteGraphEvidence(result.routeEvidence));
		finalizations.push(finalization);
		maxActiveEffects = 1;
	}
	const combinedFacts = finalizations.flatMap((item) => item.transportGraphEvidence.facts);
	const transportMaterial = strictSnapshot({
		schemaVersion: "graphrefly.b112.d751.transport-diagnostic-graph-evidence.v1",
		facts: combinedFacts,
	});
	const transportGraphEvidence = validateD751TransportDiagnosticGraphEvidence(
		strictSnapshot({
			...transportMaterial,
			evidenceDigest: empiricalStrictJsonDigest(transportMaterial),
		}),
		graphEvidence,
	);
	const providerEffects = graphEvidence.reduce(
		(total, graph) => total + providerEffectCount(graph),
		0,
	);
	const providerResultCounts = deriveProviderResultCounts(graphEvidence);
	if (providerResultCounts.graphProviderResultCount !== providerEffects)
		throw new TypeError("D752 Graph provider proposal/result coverage drifted");
	const retries = graphEvidence.reduce((total, graph) => total + retryWaitCount(graph), 0);
	if (retries !== 3) throw new TypeError("D752 changed D671/D675/D710 retry admission");
	if (
		empiricalStrictJsonDigest(retryReasons(graphEvidence)) !==
		empiricalStrictJsonDigest(D752_EXPECTED_RETRY_REASONS)
	)
		throw new TypeError("D752 changed the exact retry policy set");
	if (transportGraphEvidence.facts.length < 2)
		throw new TypeError("D752 cross-arm terminal diagnostic coverage is incomplete");
	if (providerResultCounts.graphNonTransportFailureResultCount !== 1)
		throw new TypeError("D752 non-transport pass-through coverage is incomplete");
	if (!proposalReplayRejected) throw new TypeError("D752 adapter proposal replay was accepted");
	const terminalDiagnosticProposalCount = finalizations.reduce(
		(total, item) => total + item.terminalDiagnosticProposalCount,
		0,
	);
	const retryDiagnosticProposalCount = finalizations.reduce(
		(total, item) => total + item.retryDiagnosticProposalCount,
		0,
	);
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D752_QUALIFICATION_SCHEMA,
		decisionRef: D752_DECISION_REF,
		decisionRevision: D752_DECISION_REVISION,
		d751Baseline: D752_D751_BASELINE,
		implementationManifestDigest: manifest,
		graphEvidence,
		routeEvidence,
		transportGraphEvidence,
		...providerResultCounts,
		retryWaitCount: retries,
		terminalDiagnosticProposalCount,
		retryDiagnosticProposalCount,
		proposalReplayRejected: true as const,
		networkCallCount: 0 as const,
		maxActiveEffects,
		allSixArmsCompleted: true as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	}) as D752QualificationV1;
	const generationMaterial = strictSnapshot({
		schemaVersion: D752_GENERATION_SCHEMA,
		generationRef: D752_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		transportGraphEvidenceDigest: transportGraphEvidence.evidenceDigest,
		implementationManifestDigest: manifest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const bundleMaterial = strictSnapshot({
		schemaVersion: D752_BUNDLE_SCHEMA,
		qualification,
		generation,
	});
	const bundle = strictSnapshot({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	}) as D752BundleV1;
	if ((await measureD752Implementation()) !== manifest)
		throw new TypeError("D752 implementation changed during qualification");
	constructedQualifications.add(bundle.qualification);
	constructedBundles.add(bundle);
	return bundle;
}

export function validateD752Qualification(value: unknown): D752QualificationV1 {
	const candidate = record(value, "d752.qualification");
	exactKeys(
		candidate,
		[
			"allSixArmsCompleted",
			"causalAttribution",
			"d751Baseline",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"graphNonTransportFailureResultCount",
			"graphEvidence",
			"graphProviderResultCount",
			"graphRouteResultCount",
			"graphTransportFailureResultCount",
			"implementationManifestDigest",
			"maxActiveEffects",
			"networkCallCount",
			"proposalReplayRejected",
			"qualificationDigest",
			"retryDiagnosticProposalCount",
			"retryWaitCount",
			"routeEvidence",
			"schemaVersion",
			"terminalDiagnosticProposalCount",
			"transportGraphEvidence",
		],
		"d752.qualification",
	);
	literal(candidate.schemaVersion, D752_QUALIFICATION_SCHEMA, "d752.qualification.schema");
	literal(candidate.decisionRef, D752_DECISION_REF, "d752.qualification.decisionRef");
	literal(
		candidate.decisionRevision,
		D752_DECISION_REVISION,
		"d752.qualification.decisionRevision",
	);
	literal(
		empiricalStrictJsonDigest(candidate.d751Baseline),
		empiricalStrictJsonDigest(D752_D751_BASELINE),
		"d752.qualification.d751Baseline",
	);
	literal(
		digest(candidate.implementationManifestDigest, "d752.qualification.implementationManifest"),
		D752_IMPLEMENTATION_MANIFEST_DIGEST,
		"d752.qualification.implementationManifest",
	);
	const graphEvidence = array(candidate.graphEvidence, "d752.qualification.graphEvidence");
	const routeEvidence = array(candidate.routeEvidence, "d752.qualification.routeEvidence");
	if (graphEvidence.length !== 2 || routeEvidence.length !== 2)
		throw new TypeError("D752 qualification requires two exact six-arm runs");
	const validatedRoutes = routeEvidence.map(validateD734RouteGraphEvidence);
	const typedGraphs = graphEvidence as D722CanonicalGraphEvidenceV1[];
	for (const [index, graph] of typedGraphs.entries()) {
		const scenario = (["mixed-retry-transport", "non-transport"] as const)[index]!;
		literal(
			graph.ledger.sourceDigest,
			empiricalStrictJsonDigest({
				manifest: candidate.implementationManifestDigest,
				scenario,
			}),
			"d752.qualification.graphSource",
		);
		validateRouteGraphBijection(graph, validatedRoutes[index]!);
	}
	const validatedTransport = validateD751TransportDiagnosticGraphEvidence(
		candidate.transportGraphEvidence,
		typedGraphs,
	);
	const providerEffects = typedGraphs.reduce(
		(total, graph) => total + providerEffectCount(graph),
		0,
	);
	const providerResultCounts = deriveProviderResultCounts(typedGraphs);
	const retries = typedGraphs.reduce((total, graph) => total + retryWaitCount(graph), 0);
	literal(
		candidate.graphProviderResultCount,
		providerEffects,
		"d752.qualification.providerResults",
	);
	for (const key of [
		"graphProviderResultCount",
		"graphRouteResultCount",
		"graphTransportFailureResultCount",
		"graphNonTransportFailureResultCount",
	] as const)
		literal(candidate[key], providerResultCounts[key], `d752.qualification.${key}`);
	literal(candidate.retryWaitCount, retries, "d752.qualification.retries");
	if (retries !== 3) throw new TypeError("D752 qualification retry set drifted");
	if (
		empiricalStrictJsonDigest(retryReasons(typedGraphs)) !==
		empiricalStrictJsonDigest(D752_EXPECTED_RETRY_REASONS)
	)
		throw new TypeError("D752 qualification retry reasons drifted");
	literal(candidate.networkCallCount, 0, "d752.qualification.networkCalls");
	literal(candidate.proposalReplayRejected, true, "d752.qualification.proposalReplayRejected");
	literal(candidate.maxActiveEffects, 1, "d752.qualification.maxActiveEffects");
	literal(candidate.allSixArmsCompleted, true, "d752.qualification.allSixArmsCompleted");
	literal(candidate.causalAttribution, "undetermined", "d752.qualification.attribution");
	literal(candidate.efficacyClaim, "none", "d752.qualification.efficacy");
	for (const key of ["terminalDiagnosticProposalCount", "retryDiagnosticProposalCount"] as const)
		safeInteger(candidate[key], `d752.qualification.${key}`, { max: 256 });
	if (validatedTransport.facts.length !== candidate.terminalDiagnosticProposalCount)
		throw new TypeError("D752 terminal diagnostic fact count drifted");
	const { qualificationDigest: _ignored, ...material } = candidate;
	literal(
		digest(candidate.qualificationDigest, "d752.qualification.digest"),
		empiricalStrictJsonDigest(material),
		"d752.qualification.digest",
	);
	return strictSnapshot({
		...candidate,
		graphEvidence,
		routeEvidence: validatedRoutes,
		transportGraphEvidence: validatedTransport,
	}) as unknown as D752QualificationV1;
}

export function validateD752Bundle(value: unknown): D752BundleV1 {
	const candidate = record(value, "d752.bundle");
	exactKeys(
		candidate,
		["bundleDigest", "generation", "qualification", "schemaVersion"],
		"d752.bundle",
	);
	literal(candidate.schemaVersion, D752_BUNDLE_SCHEMA, "d752.bundle.schema");
	const qualification = validateD752Qualification(candidate.qualification);
	const generation = record(candidate.generation, "d752.bundle.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"qualificationDigest",
			"schemaVersion",
			"transportGraphEvidenceDigest",
		],
		"d752.bundle.generation",
	);
	literal(generation.schemaVersion, D752_GENERATION_SCHEMA, "d752.generation.schema");
	literal(generation.generationRef, D752_GENERATION_REF, "d752.generation.ref");
	literal(
		generation.qualificationDigest,
		qualification.qualificationDigest,
		"d752.generation.qualification",
	);
	literal(
		generation.transportGraphEvidenceDigest,
		qualification.transportGraphEvidence.evidenceDigest,
		"d752.generation.transportEvidence",
	);
	literal(
		generation.implementationManifestDigest,
		qualification.implementationManifestDigest,
		"d752.generation.implementation",
	);
	const { generationDigest: _generationDigest, ...generationMaterial } = generation;
	literal(
		digest(generation.generationDigest, "d752.generation.digest"),
		empiricalStrictJsonDigest(generationMaterial),
		"d752.generation.digest",
	);
	const material = strictSnapshot({
		schemaVersion: D752_BUNDLE_SCHEMA,
		qualification,
		generation,
	});
	literal(
		digest(candidate.bundleDigest, "d752.bundle.digest"),
		empiricalStrictJsonDigest(material),
		"d752.bundle.digest",
	);
	return strictSnapshot({ ...material, bundleDigest: candidate.bundleDigest }) as D752BundleV1;
}

export function consumeConstructedD752Bundle(bundle: D752BundleV1): D752BundleV1 {
	if (!constructedBundles.has(bundle))
		throw new TypeError("D752 persistence requires a same-process constructed bundle");
	constructedBundles.delete(bundle);
	if (!constructedQualifications.has(bundle.qualification))
		throw new TypeError("D752 bundle qualification is not same-process constructed");
	constructedQualifications.delete(bundle.qualification);
	return validateD752Bundle(bundle);
}

export function createD752PersistenceFault(
	stage: "after-staging" | "after-commit" | "after-rename" | "after-final-sync",
): D752PersistenceFaultV1 {
	if (
		!(["after-staging", "after-commit", "after-rename", "after-final-sync"] as const).includes(
			stage,
		)
	)
		throw new TypeError("D752 persistence fault stage is invalid");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d752.persistence-fault.v1" as const,
	});
	persistenceFaults.set(capability, stage);
	return capability;
}

interface D752Identity {
	readonly dev: number;
	readonly ino: number;
}

async function assertD752Directory(path: string, identity: D752Identity): Promise<void> {
	const status = await lstat(path);
	if (
		!status.isDirectory() ||
		status.isSymbolicLink() ||
		(status.mode & 0o777) !== 0o700 ||
		status.nlink < 1 ||
		status.dev !== identity.dev ||
		status.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("D752 persistence directory identity drifted");
}

async function writeD752File(path: string, bytes: Uint8Array): Promise<D752Identity> {
	const handle = await open(
		path,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
		const status = await handle.stat();
		if (!status.isFile() || (status.mode & 0o777) !== 0o600 || status.nlink !== 1)
			throw new TypeError("D752 persistence artifact identity drifted");
		return { dev: status.dev, ino: status.ino };
	} finally {
		await handle.close();
	}
}

async function assertD752File(
	path: string,
	identity: D752Identity,
	bytes: Uint8Array,
): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const status = await handle.stat();
		if (
			!status.isFile() ||
			(status.mode & 0o777) !== 0o600 ||
			status.nlink !== 1 ||
			status.dev !== identity.dev ||
			status.ino !== identity.ino ||
			!sameBytes(new Uint8Array(await handle.readFile()), bytes)
		)
			throw new TypeError("D752 persistence artifact readback drifted");
	} finally {
		await handle.close();
	}
}

async function removeD752OwnedDirectory(
	path: string,
	identity: D752Identity,
	privateRoot: string,
	parentHandle: Awaited<ReturnType<typeof open>>,
): Promise<void> {
	const tombstone = join(privateRoot, `.d752-tombstone-${randomUUID()}`);
	await rename(path, tombstone);
	const moved = await lstat(tombstone);
	if (moved.dev !== identity.dev || moved.ino !== identity.ino)
		throw new TypeError("D752 cleanup ownership drifted");
	await rm(tombstone, { recursive: true, force: true });
	await parentHandle.sync();
}

export async function persistD752PrivateGeneration(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D752BundleV1;
	readonly fault?: D752PersistenceFaultV1;
}): Promise<D752PersistenceReceiptV1> {
	const input = record(inputValue, "d752.persistence");
	exactKeys(
		input,
		Object.hasOwn(input, "fault") ? ["bundle", "fault", "privateRoot"] : ["bundle", "privateRoot"],
		"d752.persistence",
	);
	const bundle = consumeConstructedD752Bundle(input.bundle as D752BundleV1);
	if (typeof input.privateRoot !== "string" || resolve(input.privateRoot) !== input.privateRoot)
		throw new TypeError("D752 private root must be absolute");
	const privateRoot = await realpath(input.privateRoot);
	if (privateRoot !== input.privateRoot) throw new TypeError("D752 private root is not canonical");
	let faultStage: "after-staging" | "after-commit" | "after-rename" | "after-final-sync" | null =
		null;
	if (Object.hasOwn(input, "fault")) {
		faultStage =
			typeof input.fault === "object" && input.fault !== null
				? (persistenceFaults.get(input.fault) ?? null)
				: null;
		if (faultStage === null) throw new TypeError("D752 persistence fault is invalid or consumed");
		persistenceFaults.delete(input.fault as object);
	}
	const files = Object.freeze([
		{ file: "qualification.v1.json", bytes: strictJsonCodec.encode(bundle.qualification) },
		{ file: "generation.v1.json", bytes: strictJsonCodec.encode(bundle.generation) },
		{
			file: "transport-diagnostic-graph-evidence.v1.json",
			bytes: strictJsonCodec.encode(bundle.qualification.transportGraphEvidence),
		},
		{ file: "bundle.v1.json", bytes: strictJsonCodec.encode(bundle) },
	]);
	const finalPath = join(privateRoot, D752_GENERATION_REF);
	const claimPath = join(privateRoot, `.d752-claim-${D752_GENERATION_REF}`);
	const stagingPath = join(privateRoot, `.d752-staging-${randomUUID()}`);
	const parentHandle = await open(
		privateRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	let parentIdentity: D752Identity | null = null;
	let claimIdentity: D752Identity | null = null;
	let stagingIdentity: D752Identity | null = null;
	let finalIdentity: D752Identity | null = null;
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let operationError: unknown = null;
	try {
		const parentStatus = await parentHandle.stat();
		parentIdentity = { dev: parentStatus.dev, ino: parentStatus.ino };
		await assertD752Directory(privateRoot, parentIdentity);
		await mkdir(claimPath, { recursive: false, mode: 0o700 });
		const claimHandle = await open(
			claimPath,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			const status = await claimHandle.stat();
			claimIdentity = { dev: status.dev, ino: status.ino };
			await claimHandle.sync();
			await assertD752Directory(claimPath, claimIdentity);
		} finally {
			await claimHandle.close();
		}
		await parentHandle.sync();
		await mkdir(stagingPath, { recursive: false, mode: 0o700 });
		const stagingStatus = await lstat(stagingPath);
		stagingIdentity = { dev: stagingStatus.dev, ino: stagingStatus.ino };
		await assertD752Directory(stagingPath, stagingIdentity);
		const artifactsPath = join(stagingPath, "artifacts");
		await mkdir(artifactsPath, { recursive: false, mode: 0o700 });
		artifactsHandle = await open(
			artifactsPath,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const artifactsStatus = await artifactsHandle.stat();
		const artifactsIdentity = { dev: artifactsStatus.dev, ino: artifactsStatus.ino };
		const identities = new Map<string, D752Identity>();
		for (const file of files)
			identities.set(file.file, await writeD752File(join(artifactsPath, file.file), file.bytes));
		await artifactsHandle.sync();
		for (const file of files)
			await assertD752File(join(artifactsPath, file.file), identities.get(file.file)!, file.bytes);
		if (faultStage === "after-staging") throw new TypeError("D752 injected after-staging failure");
		const commitMaterial = strictSnapshot({
			schemaVersion: "graphrefly.b112.d752.atomic-commit.v1",
			generationRef: D752_GENERATION_REF,
			qualificationDigest: bundle.qualification.qualificationDigest,
			generationDigest: bundle.generation.generationDigest,
			bundleDigest: bundle.bundleDigest,
			artifactsDirectory: "artifacts",
		});
		const commitBytes = strictJsonCodec.encode(commitMaterial);
		const commitIdentity = await writeD752File(join(stagingPath, "commit.v1.json"), commitBytes);
		const stagingHandle = await open(
			stagingPath,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		await assertD752File(join(stagingPath, "commit.v1.json"), commitIdentity, commitBytes);
		if (faultStage === "after-commit") throw new TypeError("D752 injected after-commit failure");
		await assertD752Directory(privateRoot, parentIdentity);
		await assertD752Directory(claimPath, claimIdentity);
		await rename(stagingPath, finalPath);
		finalIdentity = stagingIdentity;
		finalHandle = await open(
			finalPath,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		if (faultStage === "after-rename") throw new TypeError("D752 injected after-rename failure");
		await parentHandle.sync();
		if (faultStage === "after-final-sync")
			throw new TypeError("D752 injected after-final-sync failure");
		await finalHandle.sync();
		const finalArtifactsPath = join(finalPath, "artifacts");
		for (const file of files)
			await assertD752File(
				join(finalArtifactsPath, file.file),
				identities.get(file.file)!,
				file.bytes,
			);
		await assertD752File(join(finalPath, "commit.v1.json"), commitIdentity, commitBytes);
		await assertD752Directory(privateRoot, parentIdentity);
		await assertD752Directory(finalPath, finalIdentity);
		await assertD752Directory(finalArtifactsPath, artifactsIdentity);
		const [finalStable, artifactsStable] = await Promise.all([
			finalHandle.stat(),
			artifactsHandle.stat(),
		]);
		if (
			finalStable.dev !== finalIdentity.dev ||
			finalStable.ino !== finalIdentity.ino ||
			artifactsStable.dev !== artifactsIdentity.dev ||
			artifactsStable.ino !== artifactsIdentity.ino
		)
			throw new TypeError("D752 stable persistence handle drifted");
		for (const file of files)
			await assertD752File(
				join(finalArtifactsPath, file.file),
				identities.get(file.file)!,
				file.bytes,
			);
		await assertD752Directory(finalArtifactsPath, artifactsIdentity);
		await assertD752Directory(finalPath, finalIdentity);
		await assertD752Directory(privateRoot, parentIdentity);
		await rmdir(claimPath);
		claimIdentity = null;
		await parentHandle.sync();
	} catch (error) {
		operationError = error;
	}
	const closes = await Promise.allSettled([
		artifactsHandle?.close() ?? Promise.resolve(),
		finalHandle?.close() ?? Promise.resolve(),
	]);
	const closeErrors = closes
		.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
		.map((entry) => entry.reason);
	if (closeErrors.length > 0)
		operationError = new AggregateError(
			operationError === null ? closeErrors : [operationError, ...closeErrors],
			"D752 persistence handle cleanup failed",
		);
	let cleanupError: unknown = null;
	if (operationError !== null) {
		try {
			if (finalIdentity !== null)
				await removeD752OwnedDirectory(finalPath, finalIdentity, privateRoot, parentHandle);
			else if (stagingIdentity !== null)
				await removeD752OwnedDirectory(stagingPath, stagingIdentity, privateRoot, parentHandle);
			if (claimIdentity !== null) {
				await assertD752Directory(claimPath, claimIdentity);
				await rmdir(claimPath);
				await parentHandle.sync();
			}
		} catch (error) {
			cleanupError = error;
		}
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentClose[0]?.status === "rejected") errors.push(parentClose[0].reason);
		if (errors.length > 1) throw new AggregateError(errors, "D752 persistence cleanup failed");
		throw operationError;
	}
	return Object.freeze({
		generationPath: finalPath,
		qualificationDigest: bundle.qualification.qualificationDigest,
		generationDigest: bundle.generation.generationDigest as string,
		bundleDigest: bundle.bundleDigest,
	});
}
