import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
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
import {
	type D722CanonicalGraphEvidenceV1,
	deriveD722CanonicalGraphEvidence,
} from "./d722-graph-completion-memory-insight.js";
import {
	createD726ArmLocalTerminalProviderPolicy,
	createD748GraphForwardPhaseContinuationPolicy,
	type D720ToolRef,
} from "./d722-graph-native-effect-runtime.js";
import { D733_DEEPSEEK_V4_FLASH_0731_PROFILE } from "./d733-coordinates.js";
import {
	createD733GraphNativeRouteAdmission,
	createD733RouteAccessProjection,
	createD733RouteEligibility,
} from "./d733-graph-native-route-profile.js";
import {
	runD734RouteProfileSixArmLiveIntegration,
	validateD734RouteGraphEvidence,
} from "./d734-route-profile-provider-integration.js";
import {
	createD756RouteBoundProviderAdapter,
	D756_GRAPH_NAMED_TOOL_LOWERING_REVISION,
} from "./d756-graph-named-tool-continuation.js";
import { D756_IMPLEMENTATION_MANIFEST_DIGEST } from "./d756-implementation-manifest.js";
import { D757_IMPLEMENTATION_MANIFEST_DIGEST } from "./d757-implementation-manifest.js";

export const D757_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d757.named-tool-provider-pre-live-qualification.v1" as const;
export const D757_GENERATION_SCHEMA =
	"graphrefly.b112.d757.named-tool-provider-pre-live-generation.v1" as const;
export const D757_BUNDLE_SCHEMA =
	"graphrefly.b112.d757.named-tool-provider-pre-live-bundle.v1" as const;
export const D757_GENERATION_REF = "d757-named-tool-provider-pre-live-2026-08-12-v1" as const;

type WireToolName = "read_file" | "replace_exact" | "workspace_diff" | "focused_validation";
type WireDisposition = "auto" | "named" | "none";
interface WireFact {
	readonly runSequence: number;
	readonly logicalRequestDigest: string;
	readonly requestDigest: string;
	readonly attemptOrdinal: number;
	readonly contextDigest: string | null;
	readonly bodyDigest: string;
	readonly disposition: WireDisposition;
	readonly requiredToolRef: D720ToolRef | null;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const constructedBundles = new WeakSet<object>();

export interface D757NamedToolPreLiveBundleV1 {
	readonly schemaVersion: typeof D757_BUNDLE_SCHEMA;
	readonly executionClass: "simulated-contract";
	readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	readonly retryGraphEvidence: D722CanonicalGraphEvidenceV1;
	readonly routeEvidence: Readonly<Record<string, unknown>>;
	readonly retryRouteEvidence: Readonly<Record<string, unknown>>;
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly bundleDigest: string;
}

function sha(value: unknown): string {
	return empiricalStrictJsonDigest(value);
}

function routeAdmission() {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	return createD733GraphNativeRouteAdmission({
		profile,
		access: createD733RouteAccessProjection({
			profile,
			observationRevision: "d757.injected-no-network.v1",
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

interface FixtureState {
	readonly adapter: ReturnType<typeof createD756RouteBoundProviderAdapter>;
	readonly providerCalls: () => number;
	readonly wireBodyDigests: () => readonly string[];
	readonly wireFacts: () => readonly WireFact[];
	readonly namedToolCounts: () => Readonly<Record<WireToolName, number>>;
	readonly noneCount: () => number;
	readonly retryWaitCount: () => number;
	readonly retryWireIdentity: () => boolean;
	readonly maxActive: () => number;
	readonly workspaceCount: () => number;
}

function createFixture(retryOnce: boolean): FixtureState {
	const profile = D733_DEEPSEEK_V4_FLASH_0731_PROFILE;
	const admission = routeAdmission();
	const workspaces = new Map<number, string>();
	const wireDigests: string[] = [];
	const wireFacts: WireFact[] = [];
	const firstBodies = new Map<string, Uint8Array>();
	const counts: Record<WireToolName, number> = {
		read_file: 0,
		replace_exact: 0,
		workspace_diff: 0,
		focused_validation: 0,
	};
	let none = 0;
	let providerCalls = 0;
	let retryWaits = 0;
	let retryInjected = false;
	let retryIdentity = true;
	let active = 0;
	let maxActive = 0;
	const enter = () => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		if (active !== 1) throw new TypeError("D757 observed parallel effects");
	};
	const leave = () => {
		active -= 1;
	};
	const adapter = createD756RouteBoundProviderAdapter({
		routeAdmission: admission,
		executionClass: "live-provider",
		async materialization({ effectRequest }) {
			enter();
			try {
				const workspace = sha({ d757Workspace: effectRequest.runSequence });
				workspaces.set(effectRequest.runSequence, workspace);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "materialization" as const,
						status: "ready" as const,
						workspaceStateDigest: workspace,
						evidenceDigest: sha({ materialized: effectRequest.runSequence }),
					},
				};
			} finally {
				leave();
			}
		},
		async providerRequestInput(executionInput) {
			return {
				credential: {
					bearerToken: "not-a-live-d757-credential",
					credentialBindingRef: "d757.injected-no-network",
					credentialBindingRevision: "v1",
				},
				transport: {
					async request(request: { body: Uint8Array }) {
						enter();
						try {
							providerCalls += 1;
							const bodyBytes = request.body.slice();
							const bodyDigest = empiricalSha256(bodyBytes);
							wireDigests.push(bodyDigest);
							const logical = executionInput.effectRequest.logicalRequestDigest;
							const prior = firstBodies.get(logical);
							if (prior === undefined) firstBodies.set(logical, bodyBytes);
							else retryIdentity = retryIdentity && sameBytes(prior, bodyBytes);
							const body = JSON.parse(decoder.decode(bodyBytes)) as {
								tool_choice: "auto" | "none" | { type: "function"; function: { name: string } };
							};
							const name =
								body.tool_choice === "auto"
									? "read_file"
									: body.tool_choice === "none"
										? null
										: body.tool_choice.function.name;
							if (name === null) none += 1;
							else {
								if (!(name in counts)) throw new TypeError("D757 wire selected an unknown tool");
								counts[name as WireToolName] += 1;
							}
							const toolRefByName: Readonly<Record<WireToolName, D720ToolRef>> = {
								read_file: "read-file",
								replace_exact: "replace-exact",
								workspace_diff: "workspace-diff",
								focused_validation: "focused-validation",
							};
							wireFacts.push(
								Object.freeze({
									runSequence: executionInput.effectRequest.runSequence,
									logicalRequestDigest: logical,
									requestDigest: executionInput.effectRequest.requestDigest,
									attemptOrdinal: executionInput.effectRequest.attemptOrdinal,
									contextDigest:
										executionInput.effectRequest.completionContext?.contextDigest ?? null,
									bodyDigest,
									disposition:
										body.tool_choice === "auto"
											? "auto"
											: body.tool_choice === "none"
												? "none"
												: "named",
									requiredToolRef: name === null ? null : toolRefByName[name as WireToolName],
								}),
							);
							if (
								retryOnce &&
								!retryInjected &&
								executionInput.effectRequest.completionContext?.reason ===
									"objective-phase-advanced"
							) {
								retryInjected = true;
								return {
									status: 429,
									retryAfterMs: null,
									retryAfterDisposition: "absent" as const,
									body: encoder.encode('{"error":{"message":"bounded retry"}}'),
								};
							}
							const args =
								name === "read_file"
									? { path: "fixture.ts" }
									: name === "replace_exact"
										? { path: "fixture.ts", oldText: "before", newText: "after" }
										: {};
							const toolCalls =
								name === null
									? []
									: [
											{
												id: `d757-${providerCalls}`,
												type: "function",
												function: { name, arguments: JSON.stringify(args) },
											},
										];
							return {
								status: 200,
								retryAfterMs: null,
								body: encoder.encode(
									JSON.stringify({
										id: `d757-response-${providerCalls}`,
										usage: { prompt_tokens: 1, completion_tokens: 1 },
										choices: [
											name === null
												? { finish_reason: "stop", message: { content: "{}" } }
												: {
														finish_reason: "tool_calls",
														message: { content: null, tool_calls: toolCalls },
													},
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
							};
						} finally {
							leave();
						}
					},
				},
				taskStatement: "D757 injected Graph named-tool qualification",
				conversation: { messages: [] },
				signal: executionInput.signal ?? new AbortController().signal,
				monotonicNowMs: () => providerCalls,
				routeAdmission: admission,
			};
		},
		async retryWait({ effectRequest }) {
			enter();
			try {
				retryWaits += 1;
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: effectRequest.retryAfterMs ?? 60_000,
					result: {
						effectKind: "retry-wait" as const,
						status: "completed" as const,
						evidenceDigest: sha({ waited: effectRequest.logicalRequestDigest }),
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
				const before = workspaces.get(effectRequest.runSequence);
				if (intent === null || before === undefined)
					throw new TypeError("D757 tool state is missing");
				const after =
					intent.toolRef === "replace-exact"
						? sha({ before, mutation: intent.intentDigest })
						: before;
				workspaces.set(effectRequest.runSequence, after);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "tool-action" as const,
						toolRef: intent.toolRef,
						intentDigest: intent.intentDigest,
						status: "succeeded" as const,
						nonEmptyDiff: intent.toolRef === "workspace-diff",
						workspaceStateBeforeDigest: before,
						workspaceStateAfterDigest: after,
						evidenceDigest: sha({ tool: intent.intentDigest }),
					},
				};
			} finally {
				leave();
			}
		},
		async hiddenVerifier({ effectRequest }) {
			const workspace = workspaces.get(effectRequest.runSequence);
			if (workspace === undefined) throw new TypeError("D757 verifier state is missing");
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "hidden-verifier" as const,
					status: "passed" as const,
					workspaceStateDigest: workspace,
					evidenceDigest: sha({ verifier: effectRequest.runSequence }),
				},
			};
		},
		async cleanup({ effectRequest }) {
			workspaces.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup" as const,
					status: "succeeded" as const,
					evidenceDigest: sha({ cleanup: effectRequest.runSequence }),
				},
			};
		},
	});
	return Object.freeze({
		adapter,
		providerCalls: () => providerCalls,
		wireBodyDigests: () => Object.freeze([...wireDigests]),
		wireFacts: () => Object.freeze(wireFacts.map((fact) => Object.freeze({ ...fact }))),
		namedToolCounts: () => Object.freeze({ ...counts }),
		noneCount: () => none,
		retryWaitCount: () => retryWaits,
		retryWireIdentity: () => retryIdentity,
		maxActive: () => maxActive,
		workspaceCount: () => workspaces.size,
	});
}

function replayGraph(value: unknown, path: string): D722CanonicalGraphEvidenceV1 {
	const candidate = record(value, path);
	const runs = array(candidate.effectRuns, `${path}.effectRuns`);
	if (runs.length > 12) throw new TypeError("D757 Graph run bound exceeded");
	const replayed = deriveD722CanonicalGraphEvidence(
		candidate.ledger,
		runs as D722CanonicalGraphEvidenceV1["effectRuns"],
		createD726ArmLocalTerminalProviderPolicy(),
		createD748GraphForwardPhaseContinuationPolicy(),
	);
	literal(sha(candidate), sha(replayed), `${path}.replay`);
	return replayed;
}

function namedCounts(value: unknown, path: string): Readonly<Record<WireToolName, number>> {
	const candidate = record(value, path);
	exactKeys(
		candidate,
		["focused_validation", "read_file", "replace_exact", "workspace_diff"],
		path,
	);
	for (const key of ["focused_validation", "read_file", "replace_exact", "workspace_diff"] as const)
		safeInteger(candidate[key], `${path}.${key}`, { max: 128 });
	return strictSnapshot(candidate) as Readonly<Record<WireToolName, number>>;
}

function toolForPhase(phase: string): D720ToolRef | null {
	if (phase === "inspection") return "read-file";
	if (phase === "exact-mutation") return "replace-exact";
	if (phase === "workspace-diff") return "workspace-diff";
	if (phase === "focused-validation") return "focused-validation";
	if (phase === "hidden-verifier") return null;
	throw new TypeError("D757 wire fact phase is invalid");
}

function validateWireFacts(
	value: unknown,
	graph: D722CanonicalGraphEvidenceV1,
	path: string,
	expectedCount: number,
	retryExpected: boolean,
): readonly WireFact[] {
	const raw = array(value, path);
	if (raw.length !== expectedCount) throw new TypeError("D757 wire fact coverage drifted");
	const facts = raw.map((entry, index) => {
		const candidate = record(entry, `${path}[${index}]`);
		exactKeys(
			candidate,
			[
				"attemptOrdinal",
				"bodyDigest",
				"contextDigest",
				"disposition",
				"logicalRequestDigest",
				"requestDigest",
				"requiredToolRef",
				"runSequence",
			],
			`${path}[${index}]`,
		);
		safeInteger(candidate.runSequence, `${path}[${index}].runSequence`, { max: 11 });
		safeInteger(candidate.attemptOrdinal, `${path}[${index}].attemptOrdinal`, { min: 1, max: 3 });
		for (const key of ["bodyDigest", "logicalRequestDigest", "requestDigest"] as const)
			digest(candidate[key], `${path}[${index}].${key}`);
		if (candidate.contextDigest !== null)
			digest(candidate.contextDigest, `${path}[${index}].contextDigest`);
		if (!(["auto", "named", "none"] as const).includes(candidate.disposition as WireDisposition))
			throw new TypeError("D757 wire disposition is invalid");
		if (
			candidate.requiredToolRef !== null &&
			candidate.requiredToolRef !== "read-file" &&
			candidate.requiredToolRef !== "replace-exact" &&
			candidate.requiredToolRef !== "workspace-diff" &&
			candidate.requiredToolRef !== "focused-validation"
		)
			throw new TypeError("D757 wire tool ref is invalid");
		return strictSnapshot(candidate) as unknown as WireFact;
	});
	const providerRequests = graph.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" && fact.request.effectKind === "provider-request"
				? [fact.request]
				: [],
		),
	);
	if (providerRequests.length !== facts.length)
		throw new TypeError("D757 Graph provider and wire coverage drifted");
	for (const request of providerRequests) {
		const matches = facts.filter((fact) => fact.requestDigest === request.requestDigest);
		if (matches.length !== 1) throw new TypeError("D757 wire fact does not bind one Graph request");
		const fact = matches[0]!;
		literal(fact.runSequence, request.runSequence, "d757.wire.runSequence");
		literal(fact.logicalRequestDigest, request.logicalRequestDigest, "d757.wire.logicalRequest");
		literal(fact.attemptOrdinal, request.attemptOrdinal, "d757.wire.attemptOrdinal");
		const context = request.completionContext;
		if (context === undefined) {
			literal(fact.contextDigest, null, "d757.wire.context");
			literal(fact.disposition, "auto", "d757.wire.disposition");
			literal(fact.requiredToolRef, "read-file", "d757.wire.initialTool");
		} else {
			literal(fact.contextDigest, context.contextDigest, "d757.wire.context");
			const expectedTool = toolForPhase(context.nextRequiredPhase);
			literal(fact.requiredToolRef, expectedTool, "d757.wire.requiredTool");
			literal(fact.disposition, expectedTool === null ? "none" : "named", "d757.wire.disposition");
		}
	}
	const byLogical = new Map<string, WireFact[]>();
	for (const fact of facts)
		byLogical.set(fact.logicalRequestDigest, [
			...(byLogical.get(fact.logicalRequestDigest) ?? []),
			fact,
		]);
	const retried = [...byLogical.values()].filter((group) => group.length > 1);
	if (retried.length !== (retryExpected ? 1 : 0))
		throw new TypeError("D757 retry wire group coverage drifted");
	for (const group of retried) {
		if (
			group.length !== 2 ||
			group[0]?.attemptOrdinal !== 1 ||
			group[1]?.attemptOrdinal !== 2 ||
			group[0]?.bodyDigest !== group[1]?.bodyDigest ||
			group[0]?.contextDigest !== group[1]?.contextDigest ||
			group[0]?.requiredToolRef !== group[1]?.requiredToolRef
		)
			throw new TypeError("D757 retry wire identity drifted");
	}
	return Object.freeze(facts);
}

export async function runD757InjectedNoNetworkQualification(): Promise<D757NamedToolPreLiveBundleV1> {
	const mainFixture = createFixture(false);
	const retryFixture = createFixture(true);
	const main = await runD734RouteProfileSixArmLiveIntegration({
		sourceDigest: sha({ decision: "D757", case: "main" }),
		adapter: mainFixture.adapter,
		objectivePhaseRecoveryPolicy: createD748GraphForwardPhaseContinuationPolicy(),
		signal: AbortSignal.timeout(30_000),
	});
	const retry = await runD734RouteProfileSixArmLiveIntegration({
		sourceDigest: sha({ decision: "D757", case: "retry" }),
		adapter: retryFixture.adapter,
		objectivePhaseRecoveryPolicy: createD748GraphForwardPhaseContinuationPolicy(),
		signal: AbortSignal.timeout(30_000),
	});
	const graphEvidence = replayGraph(main.run.graphEvidence, "d757.mainGraph");
	const retryGraphEvidence = replayGraph(retry.run.graphEvidence, "d757.retryGraph");
	const routeEvidence = validateD734RouteGraphEvidence(main.routeEvidence);
	const retryRouteEvidence = validateD734RouteGraphEvidence(retry.routeEvidence);
	const mainCounts = mainFixture.namedToolCounts();
	const retryCounts = retryFixture.namedToolCounts();
	if (
		graphEvidence.runStatus !== "complete" ||
		retryGraphEvidence.runStatus !== "complete" ||
		graphEvidence.ledger.completedArms.length !== 6 ||
		retryGraphEvidence.ledger.completedArms.length !== 6 ||
		mainFixture.providerCalls() !== 30 ||
		retryFixture.providerCalls() !== 31 ||
		mainFixture.noneCount() !== 6 ||
		retryFixture.noneCount() !== 6 ||
		Object.values(mainCounts).some((count) => count !== 6) ||
		Object.entries(retryCounts).some(
			([name, count]) => count !== (name === "replace_exact" ? 7 : 6),
		) ||
		retryFixture.retryWaitCount() !== 1 ||
		!retryFixture.retryWireIdentity() ||
		mainFixture.maxActive() !== 1 ||
		retryFixture.maxActive() !== 1 ||
		mainFixture.workspaceCount() !== 0 ||
		retryFixture.workspaceCount() !== 0
	)
		throw new TypeError("D757 full no-network qualification coverage failed");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D757_QUALIFICATION_SCHEMA,
		decisionRef: "decision.D757",
		baselineCommit: "235a737950442bcb6d3cfc994d49fbaf8ee2f054",
		baselineManifestDigest: D756_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest: D757_IMPLEMENTATION_MANIFEST_DIGEST,
		loweringRevision: D756_GRAPH_NAMED_TOOL_LOWERING_REVISION,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		retryGraphEvidenceDigest: retryGraphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
		retryRouteEvidenceDigest: retryRouteEvidence.evidenceDigest,
		mainProviderCalls: mainFixture.providerCalls(),
		retryProviderCalls: retryFixture.providerCalls(),
		retryWaitCount: retryFixture.retryWaitCount(),
		retryWireIdentity: retryFixture.retryWireIdentity(),
		mainNamedToolCounts: mainCounts,
		retryNamedToolCounts: retryCounts,
		mainStructuredFinalCount: mainFixture.noneCount(),
		retryStructuredFinalCount: retryFixture.noneCount(),
		mainWireBodyDigests: mainFixture.wireBodyDigests(),
		retryWireBodyDigests: retryFixture.wireBodyDigests(),
		mainWireFacts: mainFixture.wireFacts(),
		retryWireFacts: retryFixture.wireFacts(),
		maxActiveInvocations: 1,
		providerNetworkCalls: 0,
		workspaceResidueCount: 0,
		materialFree: true,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: sha(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D757_GENERATION_SCHEMA,
		generationRef: D757_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		retryGraphEvidenceDigest: retryGraphEvidence.evidenceDigest,
		baselineManifestDigest: D756_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest: D757_IMPLEMENTATION_MANIFEST_DIGEST,
		materialFree: true,
		providerNetworkCalls: 0,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: sha(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D757_BUNDLE_SCHEMA,
		executionClass: "simulated-contract" as const,
		graphEvidence,
		retryGraphEvidence,
		routeEvidence,
		retryRouteEvidence,
		qualification,
		generation,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: sha(material) });
	constructedBundles.add(bundle);
	return bundle as unknown as D757NamedToolPreLiveBundleV1;
}

export function validateD757NamedToolPreLiveBundle(value: unknown): D757NamedToolPreLiveBundleV1 {
	const candidate = record(value, "d757.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"efficacyClaim",
			"executionClass",
			"generation",
			"graphEvidence",
			"qualification",
			"retryGraphEvidence",
			"retryRouteEvidence",
			"routeEvidence",
			"schemaVersion",
		],
		"d757.bundle",
	);
	literal(candidate.schemaVersion, D757_BUNDLE_SCHEMA, "d757.bundle.schema");
	literal(candidate.executionClass, "simulated-contract", "d757.bundle.executionClass");
	literal(candidate.causalAttribution, "undetermined", "d757.bundle.causal");
	literal(candidate.efficacyClaim, "none", "d757.bundle.efficacy");
	const graphEvidence = replayGraph(candidate.graphEvidence, "d757.bundle.graphEvidence");
	const retryGraphEvidence = replayGraph(
		candidate.retryGraphEvidence,
		"d757.bundle.retryGraphEvidence",
	);
	const routeEvidence = validateD734RouteGraphEvidence(candidate.routeEvidence);
	const retryRouteEvidence = validateD734RouteGraphEvidence(candidate.retryRouteEvidence);
	const qualification = record(candidate.qualification, "d757.qualification");
	exactKeys(
		qualification,
		[
			"baselineCommit",
			"baselineManifestDigest",
			"causalAttribution",
			"decisionRef",
			"efficacyClaim",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"loweringRevision",
			"mainNamedToolCounts",
			"mainProviderCalls",
			"mainStructuredFinalCount",
			"mainWireBodyDigests",
			"mainWireFacts",
			"materialFree",
			"maxActiveInvocations",
			"providerNetworkCalls",
			"qualificationDigest",
			"retryGraphEvidenceDigest",
			"retryNamedToolCounts",
			"retryProviderCalls",
			"retryRouteEvidenceDigest",
			"retryStructuredFinalCount",
			"retryWaitCount",
			"retryWireBodyDigests",
			"retryWireFacts",
			"retryWireIdentity",
			"routeEvidenceDigest",
			"schemaVersion",
			"workspaceResidueCount",
		],
		"d757.qualification",
	);
	literal(qualification.schemaVersion, D757_QUALIFICATION_SCHEMA, "d757.qualification.schema");
	literal(qualification.decisionRef, "decision.D757", "d757.qualification.decision");
	literal(
		qualification.baselineCommit,
		"235a737950442bcb6d3cfc994d49fbaf8ee2f054",
		"d757.qualification.commit",
	);
	literal(
		qualification.baselineManifestDigest,
		D756_IMPLEMENTATION_MANIFEST_DIGEST,
		"d757.qualification.baselineManifest",
	);
	literal(
		qualification.implementationManifestDigest,
		D757_IMPLEMENTATION_MANIFEST_DIGEST,
		"d757.qualification.implementation",
	);
	literal(
		qualification.loweringRevision,
		D756_GRAPH_NAMED_TOOL_LOWERING_REVISION,
		"d757.qualification.lowering",
	);
	literal(qualification.graphEvidenceDigest, graphEvidence.evidenceDigest, "d757.graphDigest");
	literal(
		qualification.retryGraphEvidenceDigest,
		retryGraphEvidence.evidenceDigest,
		"d757.retryGraphDigest",
	);
	literal(qualification.routeEvidenceDigest, routeEvidence.evidenceDigest, "d757.routeDigest");
	literal(
		qualification.retryRouteEvidenceDigest,
		retryRouteEvidence.evidenceDigest,
		"d757.retryRouteDigest",
	);
	literal(qualification.mainProviderCalls, 30, "d757.mainCalls");
	literal(qualification.retryProviderCalls, 31, "d757.retryCalls");
	literal(qualification.retryWaitCount, 1, "d757.retryWaits");
	literal(qualification.retryWireIdentity, true, "d757.retryIdentity");
	literal(qualification.mainStructuredFinalCount, 6, "d757.mainFinals");
	literal(qualification.retryStructuredFinalCount, 6, "d757.retryFinals");
	literal(qualification.maxActiveInvocations, 1, "d757.serial");
	literal(qualification.providerNetworkCalls, 0, "d757.network");
	literal(qualification.workspaceResidueCount, 0, "d757.cleanup");
	literal(qualification.materialFree, true, "d757.materialFree");
	literal(qualification.causalAttribution, "undetermined", "d757.qualification.causal");
	literal(qualification.efficacyClaim, "none", "d757.qualification.efficacy");
	const mainCounts = namedCounts(qualification.mainNamedToolCounts, "d757.mainCounts");
	const retryCounts = namedCounts(qualification.retryNamedToolCounts, "d757.retryCounts");
	for (const count of Object.values(mainCounts)) literal(count, 6, "d757.mainCounts");
	for (const [name, count] of Object.entries(retryCounts))
		literal(count, name === "replace_exact" ? 7 : 6, "d757.retryCounts");
	for (const [key, expectedLength] of [
		["mainWireBodyDigests", 30],
		["retryWireBodyDigests", 31],
	] as const) {
		const values = array(qualification[key], `d757.qualification.${key}`);
		if (values.length !== expectedLength) throw new TypeError("D757 wire digest coverage drifted");
		for (const value of values) digest(value, `d757.qualification.${key}.digest`);
	}
	const mainWireFacts = validateWireFacts(
		qualification.mainWireFacts,
		graphEvidence,
		"d757.qualification.mainWireFacts",
		30,
		false,
	);
	const retryWireFacts = validateWireFacts(
		qualification.retryWireFacts,
		retryGraphEvidence,
		"d757.qualification.retryWireFacts",
		31,
		true,
	);
	if (
		mainWireFacts.some(
			(fact, index) => fact.bodyDigest !== (qualification.mainWireBodyDigests as string[])[index],
		) ||
		retryWireFacts.some(
			(fact, index) => fact.bodyDigest !== (qualification.retryWireBodyDigests as string[])[index],
		)
	)
		throw new TypeError("D757 wire fact and digest ordering drifted");
	const { qualificationDigest: _qualificationDigest, ...qualificationMaterial } = qualification;
	digest(qualification.qualificationDigest, "d757.qualification.qualificationDigest");
	literal(
		qualification.qualificationDigest,
		sha(qualificationMaterial),
		"d757.qualification.digest",
	);
	const generation = record(candidate.generation, "d757.generation");
	exactKeys(
		generation,
		[
			"baselineManifestDigest",
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"materialFree",
			"providerNetworkCalls",
			"qualificationDigest",
			"retryGraphEvidenceDigest",
			"schemaVersion",
		],
		"d757.generation",
	);
	literal(generation.schemaVersion, D757_GENERATION_SCHEMA, "d757.generation.schema");
	literal(generation.generationRef, D757_GENERATION_REF, "d757.generation.ref");
	literal(
		generation.qualificationDigest,
		qualification.qualificationDigest as string,
		"d757.generation.q",
	);
	literal(generation.graphEvidenceDigest, graphEvidence.evidenceDigest, "d757.generation.graph");
	literal(
		generation.retryGraphEvidenceDigest,
		retryGraphEvidence.evidenceDigest,
		"d757.generation.retryGraph",
	);
	literal(
		generation.baselineManifestDigest,
		D756_IMPLEMENTATION_MANIFEST_DIGEST,
		"d757.generation.baselineManifest",
	);
	literal(
		generation.implementationManifestDigest,
		D757_IMPLEMENTATION_MANIFEST_DIGEST,
		"d757.generation.implementation",
	);
	literal(generation.materialFree, true, "d757.generation.materialFree");
	literal(generation.providerNetworkCalls, 0, "d757.generation.network");
	literal(generation.causalAttribution, "undetermined", "d757.generation.causal");
	literal(generation.efficacyClaim, "none", "d757.generation.efficacy");
	const { generationDigest: _generationDigest, ...generationMaterial } = generation;
	literal(generation.generationDigest, sha(generationMaterial), "d757.generation.digest");
	const material = strictSnapshot({
		schemaVersion: D757_BUNDLE_SCHEMA,
		executionClass: "simulated-contract" as const,
		graphEvidence,
		retryGraphEvidence,
		routeEvidence,
		retryRouteEvidence,
		qualification: strictSnapshot(qualification),
		generation: strictSnapshot(generation),
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	literal(candidate.bundleDigest, sha(material), "d757.bundle.digest");
	return Object.freeze({
		...material,
		bundleDigest: candidate.bundleDigest,
	}) as unknown as D757NamedToolPreLiveBundleV1;
}

export interface D757PersistenceFaultV1 {
	readonly revision: "graphrefly.b112.d757.persistence-fault.v1";
}
const faultStates = new WeakMap<
	object,
	{ stage: "after-write" | "after-rename"; consumed: boolean }
>();
export function createD757PersistenceFaultForTest(
	stage: "after-write" | "after-rename",
): D757PersistenceFaultV1 {
	const capability = Object.freeze({
		revision: "graphrefly.b112.d757.persistence-fault.v1" as const,
	});
	faultStates.set(capability, { stage, consumed: false });
	return capability;
}

interface Identity {
	readonly dev: number;
	readonly ino: number;
}
async function assertDirectory(path: string, identity: Identity): Promise<void> {
	const stat = await lstat(path);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== 0o700 ||
		stat.dev !== identity.dev ||
		stat.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("D757 persistence directory identity drifted");
}
async function writeFile(path: string, bytes: Uint8Array): Promise<Identity> {
	const handle = await open(
		path,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)
			throw new TypeError("D757 persistence file identity drifted");
		return { dev: stat.dev, ino: stat.ino };
	} finally {
		await handle.close();
	}
}
async function assertFile(path: string, identity: Identity, bytes: Uint8Array): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.dev !== identity.dev ||
			stat.ino !== identity.ino ||
			!sameBytes(new Uint8Array(await handle.readFile()), bytes)
		)
			throw new TypeError("D757 persistence file readback drifted");
	} finally {
		await handle.close();
	}
}

export async function persistD757NamedToolPreLiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D757NamedToolPreLiveBundleV1;
	readonly fault?: D757PersistenceFaultV1;
}) {
	const input = record(inputValue, "d757.persist");
	exactKeys(
		input,
		Object.hasOwn(input, "fault") ? ["bundle", "fault", "privateRoot"] : ["bundle", "privateRoot"],
		"d757.persist",
	);
	if (!constructedBundles.delete(input.bundle as object))
		throw new TypeError("D757 persistence requires a same-process constructed bundle");
	const bundle = validateD757NamedToolPreLiveBundle(input.bundle);
	let fault: "after-write" | "after-rename" | null = null;
	if (Object.hasOwn(input, "fault")) {
		const state =
			typeof input.fault === "object" && input.fault !== null
				? faultStates.get(input.fault)
				: undefined;
		if (state === undefined || state.consumed)
			throw new TypeError("D757 persistence fault is invalid or consumed");
		state.consumed = true;
		fault = state.stage;
	}
	if (typeof input.privateRoot !== "string" || resolve(input.privateRoot) !== input.privateRoot)
		throw new TypeError("D757 private root must be absolute");
	const privateRoot = await realpath(input.privateRoot);
	if (privateRoot !== input.privateRoot) throw new TypeError("D757 private root is not canonical");
	const parentHandle = await open(
		privateRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	let operationError: unknown = null;
	let finalIdentity: Identity | null = null;
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactBytes: readonly (readonly [string, Uint8Array])[] = [];
	try {
		const parentStat = await parentHandle.stat();
		const parentIdentity = { dev: parentStat.dev, ino: parentStat.ino };
		await assertDirectory(privateRoot, parentIdentity);
		const finalRoot = join(privateRoot, D757_GENERATION_REF);
		await mkdir(finalRoot, { mode: 0o700 });
		finalHandle = await open(
			finalRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const finalStat = await finalHandle.stat();
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		await assertDirectory(finalRoot, finalIdentity);
		artifactBytes = [
			["graph-evidence.v1.json", strictJsonCodec.encode(bundle.graphEvidence)],
			["retry-graph-evidence.v1.json", strictJsonCodec.encode(bundle.retryGraphEvidence)],
			["qualification.v1.json", strictJsonCodec.encode(bundle.qualification)],
			["generation.v1.json", strictJsonCodec.encode(bundle.generation)],
			["bundle.v1.json", strictJsonCodec.encode(bundle)],
		];
		const staging = join(finalRoot, `.d757-staging-${randomUUID()}`);
		await mkdir(staging, { mode: 0o700 });
		const stagingStat = await lstat(staging);
		const stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		await assertDirectory(staging, stagingIdentity);
		const fileIdentities = new Map<string, Identity>();
		for (const [name, bytes] of artifactBytes)
			fileIdentities.set(name, await writeFile(join(staging, name), bytes));
		const stagingHandle = await open(
			staging,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		for (const [name, bytes] of artifactBytes)
			await assertFile(join(staging, name), fileIdentities.get(name)!, bytes);
		if (fault === "after-write") throw new TypeError("D757 injected after-write failure");
		const artifactsRoot = join(finalRoot, "artifacts");
		await rename(staging, artifactsRoot);
		artifactsHandle = await open(
			artifactsRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const artifactsStat = await artifactsHandle.stat();
		const artifactsIdentity = { dev: artifactsStat.dev, ino: artifactsStat.ino };
		if (
			artifactsIdentity.dev !== stagingIdentity.dev ||
			artifactsIdentity.ino !== stagingIdentity.ino
		)
			throw new TypeError("D757 artifact rename identity drifted");
		if (fault === "after-rename") throw new TypeError("D757 injected after-rename failure");
		const commitBytes = strictJsonCodec.encode(
			strictSnapshot({
				schemaVersion: "graphrefly.b112.d757.atomic-commit.v1",
				generationRef: D757_GENERATION_REF,
				bundleDigest: bundle.bundleDigest,
				artifactsDirectory: "artifacts",
			}),
		);
		const commitIdentity = await writeFile(join(finalRoot, "commit.v1.json"), commitBytes);
		await finalHandle.sync();
		await parentHandle.sync();
		for (const [name, bytes] of artifactBytes)
			await assertFile(join(artifactsRoot, name), fileIdentities.get(name)!, bytes);
		await assertFile(join(finalRoot, "commit.v1.json"), commitIdentity, commitBytes);
		await assertDirectory(privateRoot, parentIdentity);
		await assertDirectory(finalRoot, finalIdentity);
		await assertDirectory(artifactsRoot, artifactsIdentity);
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
			throw new TypeError("D757 stable persistence handle drifted");
		await assertDirectory(privateRoot, parentIdentity);
		await assertDirectory(finalRoot, finalIdentity);
		await assertDirectory(artifactsRoot, artifactsIdentity);
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
			"D757 persistence handle cleanup failed",
		);
	const finalRoot = join(privateRoot, D757_GENERATION_REF);
	let cleanupError: unknown = null;
	if (operationError !== null && finalIdentity !== null) {
		const current = await lstat(finalRoot).catch(() => null);
		if (current?.dev === finalIdentity.dev && current.ino === finalIdentity.ino) {
			try {
				const tombstone = join(privateRoot, `.d757-tombstone-${randomUUID()}`);
				await rename(finalRoot, tombstone);
				const moved = await lstat(tombstone);
				if (moved.dev !== finalIdentity.dev || moved.ino !== finalIdentity.ino)
					throw new TypeError("D757 cleanup tombstone ownership drifted");
				await rm(tombstone, { recursive: true, force: true });
				await parentHandle.sync();
			} catch (error) {
				cleanupError = error;
			}
		} else cleanupError = new TypeError("D757 persistence cleanup ownership drifted");
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentClose[0]?.status === "rejected") errors.push(parentClose[0].reason);
		if (errors.length > 1) throw new AggregateError(errors, "D757 persistence cleanup failed");
		throw operationError;
	}
	const receiptMaterial = strictSnapshot({
		schemaVersion: "graphrefly.b112.d757.persistence-receipt.v1",
		generationRef: D757_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		artifactDigests: artifactBytes.map(([name, bytes]) => ({
			name,
			sha256: empiricalSha256(bytes),
		})),
	});
	return Object.freeze({ ...receiptMaterial, persistenceDigest: sha(receiptMaterial) });
}
