import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	commitD696PrivateStagingDirectory,
	failD696PrivateStagingGeneration,
} from "./d696-continuation-assisted-live.js";
import {
	D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST,
	validateD710UntypedHttp429RetryPolicy,
} from "./d710-untyped-http-429-retry-policy.js";
import { D714_D713_SOURCE_OBSERVATION_DIGEST } from "./d714-d715-graph-native-qualification.js";
import {
	createD716GraphNativeSixArmCoordinator,
	D716_GRAPH_NATIVE_ARM_ORDER,
	D716_GRAPH_NATIVE_COORDINATOR_REVISION,
	D716_REQUIRED_D714_D715_QUALIFICATION_DIGEST,
	validateD716GraphNativeCoordinationEvidence,
} from "./d716-graph-native-live-coordinator.js";
import {
	type D716GraphNativeLiveQualificationV1,
	isConstructedD716GraphNativeLiveQualification,
	validateD716GraphNativeLiveQualification,
} from "./d716-graph-native-live-qualification.js";
import { createD717GraphNativeLiveProviderCapability } from "./d717-graph-native-live-capability.js";
import { validateEmpiricalTrialBlockObservation } from "./empirical-smoke-evidence.js";
import type { B112MatchedBlockReflectionV2 } from "./matched-block-memory.js";
import {
	type OpenRouterFirstTaskRetryWaitCapabilityV1,
	type OpenRouterMatchedTrialBlockInputV4,
	runOpenRouterMatchedTrialBlock,
} from "./openrouter-first-task-smoke.js";
import type { OpenRouterResponsesByteTransportV1 } from "./openrouter-responses-model-turn.js";
import { syncDirectory, writePrivateFile } from "./private-smoke-persistence.js";

export const D717_OBSERVATION_SCHEMA =
	"graphrefly.b112.d717.graph-native-live-provider-prelive-observation.v1" as const;
export const D717_SCORECARD_SCHEMA =
	"graphrefly.b112.d717.graph-native-live-provider-prelive-scorecard.v1" as const;
export const D717_GENERATION_SCHEMA =
	"graphrefly.b112.d717.graph-native-live-provider-prelive-generation.v1" as const;
export const D717_CLAIM_BOUNDARY =
	"package-private-injected-no-network-graph-native-live-provider-prelive" as const;
export const D717_D713_OBSERVATION_ARTIFACT_DIGEST =
	"sha256:12960d0a065f0db0b130e99e51e0c94fface5b49933521fe7842f72e9faec518" as const;
export const D717_D713_SCORECARD_ARTIFACT_DIGEST =
	"sha256:ff68afce89307ece4f3bbf4532744303091a58122917809638514962f1b1dfb7" as const;
export const D717_D713_GENERATION_ARTIFACT_DIGEST =
	"sha256:5fd10c1e6a69bee1b31ac8e387b6ca8ec0e8466bfa606ed44bc65e16df03e727" as const;

export interface D717HistoricalBaselineReceiptV1 {
	readonly evidenceClass: "exact-artifact-bytes" | "injected-source-digest-fixture";
	readonly observationArtifactDigest: typeof D717_D713_OBSERVATION_ARTIFACT_DIGEST;
	readonly scorecardArtifactDigest: typeof D717_D713_SCORECARD_ARTIFACT_DIGEST;
	readonly generationArtifactDigest: typeof D717_D713_GENERATION_ARTIFACT_DIGEST;
}

export interface D717GraphNativePreLiveObservationV1 {
	readonly schemaVersion: typeof D717_OBSERVATION_SCHEMA;
	readonly claimBoundary: typeof D717_CLAIM_BOUNDARY;
	readonly executionClass: "live-provider";
	readonly d716QualificationDigest: string;
	readonly d716CoordinatorRevision: typeof D716_GRAPH_NATIVE_COORDINATOR_REVISION;
	readonly d713ObservationArtifactDigest: typeof D717_D713_OBSERVATION_ARTIFACT_DIGEST;
	readonly d713ScorecardArtifactDigest: typeof D717_D713_SCORECARD_ARTIFACT_DIGEST;
	readonly d713GenerationArtifactDigest: typeof D717_D713_GENERATION_ARTIFACT_DIGEST;
	readonly historicalBaselineEvidenceClass:
		| "exact-artifact-bytes"
		| "injected-source-digest-fixture";
	readonly underlyingObservationDigest: string;
	readonly graphCoordinationDigest: string;
	readonly routeQualificationDigest: string;
	readonly retryPolicyDigest: typeof D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST;
	readonly issuedArms: readonly (typeof D716_GRAPH_NATIVE_ARM_ORDER)[number][];
	readonly completedArms: readonly (typeof D716_GRAPH_NATIVE_ARM_ORDER)[number][];
	readonly nextArmAuthority: "graph-only";
	readonly callerRole: "execute-and-present-immutable-completion-fact";
	readonly decisionEvidenceSource: "graph-projected-completion-facts";
	readonly graphSelectedArmCount: 6;
	readonly callerSelectedArmCount: 0;
	readonly graphArmEvidence: readonly {
		readonly arm: (typeof D716_GRAPH_NATIVE_ARM_ORDER)[number];
		readonly sequence: number;
		readonly phase: string;
		readonly evaluable: boolean;
		readonly fullTaskCompleted: boolean;
		readonly requests: number;
		readonly costMicrousd: number;
		readonly elapsedMs: number;
		readonly stoppedReason: string | null;
		readonly provenanceDigest: string;
	}[];
	readonly graphProgressPhases: readonly string[];
	readonly transportCalls: number;
	readonly retryWaitCalls: number;
	readonly maximumConcurrentTransportCalls: 1;
	readonly graphRequests: number;
	readonly graphCostMicrousd: number;
	readonly graphElapsedMs: number;
	readonly underlyingRequests: number;
	readonly underlyingAttempts: number;
	readonly underlyingWarmRunsAttempted: number;
	readonly underlyingCostMicrousd: number;
	readonly underlyingElapsedMs: number;
	readonly workspaceCleanupComplete: true;
	readonly workspaceResidueCount: 0;
	readonly fallbackUsed: false;
	readonly providerSwitchUsed: false;
	readonly coldOutcomeCensoredWarmArms: false;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly observationDigest: string;
}

export interface D717GraphNativePreLiveScorecardV1 {
	readonly schemaVersion: typeof D717_SCORECARD_SCHEMA;
	readonly claimBoundary: typeof D717_CLAIM_BOUNDARY;
	readonly observationDigest: string;
	readonly qualified: boolean;
	readonly graphIntegrationQualified: true;
	readonly historicalBaselineBytesQualified: boolean;
	readonly completedArmCount: number;
	readonly evaluableArmCount: number;
	readonly firstHarnessFindingArm: (typeof D716_GRAPH_NATIVE_ARM_ORDER)[number] | null;
	readonly harnessFindingCode:
		| "no-harness-blocker-observed"
		| "review-budget-admission-or-request-efficiency"
		| "repair-caller-materialization-handoff"
		| "repair-caller-cleanup-ownership"
		| "inspect-cancellation-ownership"
		| "inspect-provider-or-pre-tool-failure"
		| "improve-objective-progress-continuation"
		| "require-post-mutation-diff"
		| "require-focused-validation"
		| "repair-focused-validation"
		| "inspect-hidden-verifier-admission"
		| "inspect-hidden-verifier-result";
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly scorecardDigest: string;
}

const constructedHistoricalReceipts = new WeakSet<object>();
const constructedObservations = new WeakSet<object>();
const constructedScorecards = new WeakSet<object>();

function exactByteInput(value: unknown, label: string): Uint8Array {
	if (
		!(value instanceof Uint8Array) ||
		value.byteLength === 0 ||
		value.byteLength > 4 * 1024 * 1024
	) {
		throw new TypeError(`D717 ${label} bytes are invalid`);
	}
	return new Uint8Array(value);
}

export function createD717HistoricalBaselineReceipt(inputValue: {
	readonly observationBytes: Uint8Array;
	readonly scorecardBytes: Uint8Array;
	readonly generationBytes: Uint8Array;
}): D717HistoricalBaselineReceiptV1 {
	const descriptorKeys = ["generationBytes", "observationBytes", "scorecardBytes"] as const;
	if (Object.getPrototypeOf(inputValue) !== Object.prototype) {
		throw new TypeError("D717 historical artifact input must be a plain object");
	}
	for (const key of descriptorKeys) {
		const descriptor = Object.getOwnPropertyDescriptor(inputValue, key);
		if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
			throw new TypeError(`D717 historical ${key} must be an own enumerable data property`);
		}
	}
	if (Object.keys(inputValue).sort().join("|") !== [...descriptorKeys].sort().join("|")) {
		throw new TypeError("D717 historical artifact input has unexpected keys");
	}
	const observationBytes = exactByteInput(inputValue.observationBytes, "observation");
	const scorecardBytes = exactByteInput(inputValue.scorecardBytes, "scorecard");
	const generationBytes = exactByteInput(inputValue.generationBytes, "generation");
	if (
		empiricalSha256(observationBytes) !== D717_D713_OBSERVATION_ARTIFACT_DIGEST ||
		empiricalSha256(scorecardBytes) !== D717_D713_SCORECARD_ARTIFACT_DIGEST ||
		empiricalSha256(generationBytes) !== D717_D713_GENERATION_ARTIFACT_DIGEST
	) {
		throw new TypeError("D717 exact D713 historical artifact bytes drifted");
	}
	const receipt = Object.freeze({
		evidenceClass: "exact-artifact-bytes" as const,
		observationArtifactDigest: D717_D713_OBSERVATION_ARTIFACT_DIGEST,
		scorecardArtifactDigest: D717_D713_SCORECARD_ARTIFACT_DIGEST,
		generationArtifactDigest: D717_D713_GENERATION_ARTIFACT_DIGEST,
	});
	constructedHistoricalReceipts.add(receipt);
	return receipt;
}

export function createD717InjectedHistoricalBaselineReceipt(inputValue: {
	readonly sourceObservationDigest: typeof D714_D713_SOURCE_OBSERVATION_DIGEST;
}): D717HistoricalBaselineReceiptV1 {
	const input = record(inputValue, "d717.injectedHistoricalBaseline");
	exactKeys(input, ["sourceObservationDigest"], "d717.injectedHistoricalBaseline");
	if (input.sourceObservationDigest !== D714_D713_SOURCE_OBSERVATION_DIGEST) {
		throw new TypeError("D717 injected baseline requires the exact D713 source observation");
	}
	const receipt = Object.freeze({
		evidenceClass: "injected-source-digest-fixture" as const,
		observationArtifactDigest: D717_D713_OBSERVATION_ARTIFACT_DIGEST,
		scorecardArtifactDigest: D717_D713_SCORECARD_ARTIFACT_DIGEST,
		generationArtifactDigest: D717_D713_GENERATION_ARTIFACT_DIGEST,
	});
	constructedHistoricalReceipts.add(receipt);
	return receipt;
}

async function assertRootsClean(roots: readonly string[]): Promise<void> {
	for (const root of roots) {
		try {
			await lstat(root);
			throw new TypeError("D717 caller executor left workspace residue");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}

function cleanupComplete(
	observation: ReturnType<typeof validateEmpiricalTrialBlockObservation>,
): boolean {
	const runs = [
		observation.cold,
		...observation.warmBranches.flatMap((branch) => (branch.run === null ? [] : [branch.run])),
	];
	return runs.every((run) => !run.issueCodes.includes("workspace-cleanup-failed"));
}

export async function runD717GraphNativePreLiveBlock(inputValue: {
	readonly block: OpenRouterMatchedTrialBlockInputV4;
	readonly d716Qualification: D716GraphNativeLiveQualificationV1;
	readonly historicalBaseline: D717HistoricalBaselineReceiptV1;
	readonly warmReflection: B112MatchedBlockReflectionV2;
}): Promise<{
	readonly observation: D717GraphNativePreLiveObservationV1;
	readonly scorecard: D717GraphNativePreLiveScorecardV1;
}> {
	const input = record(inputValue, "d717.run");
	exactKeys(
		input,
		["block", "d716Qualification", "historicalBaseline", "warmReflection"],
		"d717.run",
	);
	if (!constructedHistoricalReceipts.has(input.historicalBaseline as object)) {
		throw new TypeError("D717 run requires same-process exact D713 historical bytes");
	}
	if (!isConstructedD716GraphNativeLiveQualification(input.d716Qualification)) {
		throw new TypeError("D717 run requires a same-process D716 qualification");
	}
	const constructedD716Qualification =
		input.d716Qualification as D716GraphNativeLiveQualificationV1;
	const d716Qualification = validateD716GraphNativeLiveQualification(constructedD716Qualification);
	const block = record(input.block, "d717.block") as unknown as OpenRouterMatchedTrialBlockInputV4;
	if (block.executionClass !== "live-provider" || block.prepareWarmHost === undefined) {
		throw new TypeError("D717 requires live-provider execution with all warm materializations");
	}
	if (
		block.untypedHttp429RetryPolicy === undefined ||
		empiricalStrictJsonDigest(
			validateD710UntypedHttp429RetryPolicy(block.untypedHttp429RetryPolicy),
		) !== D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST
	) {
		throw new TypeError("D717 requires the exact inherited D710 retry policy");
	}
	if (
		Object.hasOwn(block, "graphNativeSixArmCoordinator") ||
		Object.hasOwn(block, "graphNativeLiveProviderCapability")
	) {
		throw new TypeError("D717 owns the Graph coordinator and live-provider capability");
	}
	const historicalBaseline = input.historicalBaseline as D717HistoricalBaselineReceiptV1;
	const warmReflection = input.warmReflection as B112MatchedBlockReflectionV2;
	const coordinator = createD716GraphNativeSixArmCoordinator({
		qualificationDigest: D716_REQUIRED_D714_D715_QUALIFICATION_DIGEST,
		infrastructureEvidenceDigest: empiricalStrictJsonDigest({
			kind: "d717.injected-no-network-infrastructure.v1",
			routeQualificationDigest: empiricalStrictJsonDigest(block.routeQualification),
			d713GenerationArtifactDigest: historicalBaseline.generationArtifactDigest,
		}),
		warmReflection,
	});
	const liveCapability = createD717GraphNativeLiveProviderCapability({
		coordinator,
		d716Qualification: constructedD716Qualification,
	});
	const roots = [block.host.materialization.workspace.rootPathForHostRunner()];
	let transportCalls = 0;
	let activeTransportCalls = 0;
	let maximumConcurrentTransportCalls = 0;
	let retryWaitCalls = 0;
	const measuredTransport: OpenRouterResponsesByteTransportV1 = Object.freeze({
		async request(request: Parameters<OpenRouterResponsesByteTransportV1["request"]>[0]) {
			if (activeTransportCalls !== 0) throw new TypeError("D717 forbids parallel transport");
			transportCalls += 1;
			activeTransportCalls += 1;
			maximumConcurrentTransportCalls = Math.max(
				maximumConcurrentTransportCalls,
				activeTransportCalls,
			);
			try {
				return await block.transport.request(request);
			} finally {
				activeTransportCalls -= 1;
			}
		},
	});
	const measuredRetryWait: OpenRouterFirstTaskRetryWaitCapabilityV1 = Object.freeze({
		async wait(request: Parameters<OpenRouterFirstTaskRetryWaitCapabilityV1["wait"]>[0]) {
			retryWaitCalls += 1;
			await block.retryWait.wait(request);
		},
	});
	const prepareWarmHost = async (
		request: Parameters<NonNullable<typeof block.prepareWarmHost>>[0],
	) => {
		const materialization = await block.prepareWarmHost!(request);
		roots.push(materialization.workspace.rootPathForHostRunner());
		return materialization;
	};
	const result = await runOpenRouterMatchedTrialBlock({
		...block,
		transport: measuredTransport,
		retryWait: measuredRetryWait,
		prepareWarmHost,
		graphNativeSixArmCoordinator: coordinator,
		graphNativeLiveProviderCapability: liveCapability,
	});
	if (result.profile !== "smoke" || result.graphNativeCoordination === undefined) {
		throw new TypeError("D717 requires integrated smoke Graph evidence");
	}
	if (result.graphNativeLiveProviderQualificationDigest !== d716Qualification.evidenceDigest) {
		throw new TypeError("D717 matched runner omitted the exact D716 qualification binding");
	}
	const underlying = validateEmpiricalTrialBlockObservation(result.observation);
	const graph = validateD716GraphNativeCoordinationEvidence(result.graphNativeCoordination);
	await assertRootsClean(roots);
	if (
		graph.issuedArms.join("|") !== D716_GRAPH_NATIVE_ARM_ORDER.join("|") ||
		graph.completedArms.join("|") !== D716_GRAPH_NATIVE_ARM_ORDER.join("|") ||
		graph.maxActiveArms !== 1 ||
		!graph.warmArmsIndependentOfCold ||
		maximumConcurrentTransportCalls !== 1 ||
		transportCalls !== underlying.result.attempts ||
		!cleanupComplete(underlying)
	) {
		throw new TypeError("D717 full six-arm live-provider dry-run gates failed");
	}
	const graphRequests = graph.progress.reduce((sum, item) => sum + item.requests, 0);
	const graphCostMicrousd = graph.progress.reduce((sum, item) => sum + item.costMicrousd, 0);
	const graphElapsedMs = graph.progress.reduce((sum, item) => sum + item.elapsedMs, 0);
	if (
		graphRequests !== underlying.result.requests ||
		graphCostMicrousd !== underlying.result.costMicrousd ||
		graphElapsedMs !== underlying.result.latencyMs
	) {
		throw new TypeError("D717 Graph budget projection drifted from caller evidence");
	}
	const material = strictSnapshot({
		schemaVersion: D717_OBSERVATION_SCHEMA,
		claimBoundary: D717_CLAIM_BOUNDARY,
		executionClass: "live-provider" as const,
		d716QualificationDigest: d716Qualification.evidenceDigest,
		d716CoordinatorRevision: D716_GRAPH_NATIVE_COORDINATOR_REVISION,
		d713ObservationArtifactDigest: historicalBaseline.observationArtifactDigest,
		d713ScorecardArtifactDigest: historicalBaseline.scorecardArtifactDigest,
		d713GenerationArtifactDigest: historicalBaseline.generationArtifactDigest,
		historicalBaselineEvidenceClass: historicalBaseline.evidenceClass,
		underlyingObservationDigest: empiricalStrictJsonDigest(underlying),
		graphCoordinationDigest: graph.evidenceDigest,
		routeQualificationDigest: empiricalStrictJsonDigest(block.routeQualification),
		retryPolicyDigest: D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST,
		issuedArms: graph.issuedArms,
		completedArms: graph.completedArms,
		nextArmAuthority: "graph-only" as const,
		callerRole: "execute-and-present-immutable-completion-fact" as const,
		decisionEvidenceSource: "graph-projected-completion-facts" as const,
		graphSelectedArmCount: 6 as const,
		callerSelectedArmCount: 0 as const,
		graphArmEvidence: graph.progress,
		graphProgressPhases: graph.progress.map((item) => item.phase),
		transportCalls,
		retryWaitCalls,
		maximumConcurrentTransportCalls: 1 as const,
		graphRequests,
		graphCostMicrousd,
		graphElapsedMs,
		underlyingRequests: underlying.result.requests,
		underlyingAttempts: underlying.result.attempts,
		underlyingWarmRunsAttempted: underlying.result.warmRunsAttempted,
		underlyingCostMicrousd: underlying.result.costMicrousd,
		underlyingElapsedMs: underlying.result.latencyMs,
		workspaceCleanupComplete: true as const,
		workspaceResidueCount: 0 as const,
		fallbackUsed: false as const,
		providerSwitchUsed: false as const,
		coldOutcomeCensoredWarmArms: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const observation = strictSnapshot({
		...material,
		observationDigest: empiricalStrictJsonDigest(material),
	});
	validateD717GraphNativePreLiveObservation(observation);
	constructedObservations.add(observation);
	return Object.freeze({
		observation,
		scorecard: createD717GraphNativePreLiveScorecard(observation),
	});
}

export function validateD717GraphNativePreLiveObservation(
	value: unknown,
): D717GraphNativePreLiveObservationV1 {
	const candidate = record(value, "d717.observation");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"callerRole",
			"callerSelectedArmCount",
			"claimBoundary",
			"coldOutcomeCensoredWarmArms",
			"completedArms",
			"d713GenerationArtifactDigest",
			"d713ObservationArtifactDigest",
			"d713ScorecardArtifactDigest",
			"d716CoordinatorRevision",
			"d716QualificationDigest",
			"decisionEvidenceSource",
			"efficacyClaim",
			"executionClass",
			"fallbackUsed",
			"graphCoordinationDigest",
			"graphArmEvidence",
			"graphCostMicrousd",
			"graphElapsedMs",
			"graphProgressPhases",
			"graphRequests",
			"graphSelectedArmCount",
			"historicalBaselineEvidenceClass",
			"issuedArms",
			"maximumConcurrentTransportCalls",
			"nextArmAuthority",
			"observationDigest",
			"providerSwitchUsed",
			"retryWaitCalls",
			"retryPolicyDigest",
			"routeQualificationDigest",
			"schemaVersion",
			"transportCalls",
			"underlyingAttempts",
			"underlyingCostMicrousd",
			"underlyingElapsedMs",
			"underlyingObservationDigest",
			"underlyingRequests",
			"underlyingWarmRunsAttempted",
			"workspaceCleanupComplete",
			"workspaceResidueCount",
		],
		"d717.observation",
	);
	if (
		!Array.isArray(candidate.issuedArms) ||
		candidate.issuedArms.length !== 6 ||
		!Array.isArray(candidate.completedArms) ||
		candidate.completedArms.length !== 6 ||
		!Array.isArray(candidate.graphArmEvidence) ||
		candidate.graphArmEvidence.length !== 6 ||
		!Array.isArray(candidate.graphProgressPhases) ||
		candidate.graphProgressPhases.length !== 6
	) {
		throw new TypeError("D717 observation requires six bounded Graph arm facts");
	}
	const snapshot = strictSnapshot(candidate) as unknown as D717GraphNativePreLiveObservationV1;
	if (
		snapshot.schemaVersion !== D717_OBSERVATION_SCHEMA ||
		snapshot.claimBoundary !== D717_CLAIM_BOUNDARY ||
		snapshot.executionClass !== "live-provider" ||
		snapshot.d716CoordinatorRevision !== D716_GRAPH_NATIVE_COORDINATOR_REVISION ||
		snapshot.d713ObservationArtifactDigest !== D717_D713_OBSERVATION_ARTIFACT_DIGEST ||
		snapshot.d713ScorecardArtifactDigest !== D717_D713_SCORECARD_ARTIFACT_DIGEST ||
		snapshot.d713GenerationArtifactDigest !== D717_D713_GENERATION_ARTIFACT_DIGEST ||
		snapshot.retryPolicyDigest !== D710_UNTYPED_HTTP_429_RETRY_POLICY_DIGEST ||
		snapshot.nextArmAuthority !== "graph-only" ||
		snapshot.callerRole !== "execute-and-present-immutable-completion-fact" ||
		snapshot.decisionEvidenceSource !== "graph-projected-completion-facts" ||
		snapshot.graphSelectedArmCount !== 6 ||
		snapshot.callerSelectedArmCount !== 0 ||
		!(["exact-artifact-bytes", "injected-source-digest-fixture"] as const).includes(
			snapshot.historicalBaselineEvidenceClass,
		) ||
		snapshot.maximumConcurrentTransportCalls !== 1 ||
		!snapshot.workspaceCleanupComplete ||
		snapshot.workspaceResidueCount !== 0 ||
		snapshot.fallbackUsed ||
		snapshot.providerSwitchUsed ||
		snapshot.coldOutcomeCensoredWarmArms ||
		snapshot.causalAttribution !== "undetermined" ||
		snapshot.efficacyClaim !== "none" ||
		snapshot.issuedArms.join("|") !== D716_GRAPH_NATIVE_ARM_ORDER.join("|") ||
		snapshot.completedArms.join("|") !== D716_GRAPH_NATIVE_ARM_ORDER.join("|") ||
		snapshot.transportCalls !== snapshot.underlyingAttempts ||
		snapshot.graphRequests !== snapshot.underlyingRequests ||
		snapshot.graphCostMicrousd !== snapshot.underlyingCostMicrousd ||
		snapshot.graphElapsedMs !== snapshot.underlyingElapsedMs
	) {
		throw new TypeError("D717 observation coordinates drifted");
	}
	for (const field of [
		"d716QualificationDigest",
		"underlyingObservationDigest",
		"graphCoordinationDigest",
		"routeQualificationDigest",
		"observationDigest",
	] as const) {
		digest(snapshot[field], `d717.${field}`);
	}
	const allowedPhases = new Set([
		"none",
		"inspection",
		"exact-mutation",
		"workspace-diff",
		"focused-validation-attempted",
		"focused-validation-passed",
		"hidden-verifier-attempted",
		"hidden-verifier-passed",
	]);
	if (snapshot.graphProgressPhases.some((phase) => !allowedPhases.has(phase))) {
		throw new TypeError("D717 observation contains an unknown Graph progress phase");
	}
	let projectedRequests = 0;
	let projectedCostMicrousd = 0;
	let projectedElapsedMs = 0;
	for (const [index, raw] of snapshot.graphArmEvidence.entries()) {
		const item = record(raw, `d717.graphArmEvidence[${index}]`);
		exactKeys(
			item,
			[
				"arm",
				"costMicrousd",
				"elapsedMs",
				"evaluable",
				"fullTaskCompleted",
				"phase",
				"provenanceDigest",
				"requests",
				"sequence",
				"stoppedReason",
			],
			`d717.graphArmEvidence[${index}]`,
		);
		if (
			item.arm !== D716_GRAPH_NATIVE_ARM_ORDER[index] ||
			item.sequence !== index ||
			item.phase !== snapshot.graphProgressPhases[index] ||
			!allowedPhases.has(item.phase as string) ||
			typeof item.evaluable !== "boolean" ||
			typeof item.fullTaskCompleted !== "boolean" ||
			(item.stoppedReason !== null &&
				![
					"budget-exhausted",
					"warm-preparation-failed",
					"workspace-cleanup-failed",
					"cancelled",
				].includes(item.stoppedReason as string))
		) {
			throw new TypeError("D717 Graph arm evidence drifted");
		}
		safeInteger(item.requests, `d717.graphArmEvidence[${index}].requests`, { min: 0, max: 576 });
		safeInteger(item.costMicrousd, `d717.graphArmEvidence[${index}].costMicrousd`, {
			min: 0,
			max: 6_000_000,
		});
		safeInteger(item.elapsedMs, `d717.graphArmEvidence[${index}].elapsedMs`, {
			min: 0,
			max: 7_200_000,
		});
		digest(item.provenanceDigest, `d717.graphArmEvidence[${index}].provenanceDigest`);
		projectedRequests += item.requests as number;
		projectedCostMicrousd += item.costMicrousd as number;
		projectedElapsedMs += item.elapsedMs as number;
	}
	if (
		projectedRequests !== snapshot.graphRequests ||
		projectedCostMicrousd !== snapshot.graphCostMicrousd ||
		projectedElapsedMs !== snapshot.graphElapsedMs
	) {
		throw new TypeError("D717 Graph arm log does not reproduce the Graph totals");
	}
	for (const field of [
		"transportCalls",
		"retryWaitCalls",
		"graphRequests",
		"underlyingRequests",
		"underlyingAttempts",
	] as const) {
		safeInteger(snapshot[field], `d717.${field}`, { min: 0, max: 576 });
	}
	safeInteger(snapshot.underlyingWarmRunsAttempted, "d717.underlyingWarmRunsAttempted", {
		min: 0,
		max: 5,
	});
	for (const field of ["graphCostMicrousd", "underlyingCostMicrousd"] as const) {
		safeInteger(snapshot[field], `d717.${field}`, { min: 0, max: 6_000_000 });
	}
	for (const field of ["graphElapsedMs", "underlyingElapsedMs"] as const) {
		safeInteger(snapshot[field], `d717.${field}`, { min: 0, max: 7_200_000 });
	}
	const { observationDigest: _digest, ...material } = snapshot;
	if (empiricalStrictJsonDigest(material) !== snapshot.observationDigest) {
		throw new TypeError("D717 observation digest mismatch");
	}
	return snapshot;
}

export function createD717GraphNativePreLiveScorecard(
	observation: D717GraphNativePreLiveObservationV1,
): D717GraphNativePreLiveScorecardV1 {
	if (!constructedObservations.has(observation as object)) {
		throw new TypeError("D717 scorecard requires a same-process observation");
	}
	validateD717GraphNativePreLiveObservation(observation);
	const finding = deriveD717HarnessFinding(observation);
	const material = strictSnapshot({
		schemaVersion: D717_SCORECARD_SCHEMA,
		claimBoundary: D717_CLAIM_BOUNDARY,
		observationDigest: observation.observationDigest,
		qualified: observation.historicalBaselineEvidenceClass === "exact-artifact-bytes",
		graphIntegrationQualified: true as const,
		historicalBaselineBytesQualified:
			observation.historicalBaselineEvidenceClass === "exact-artifact-bytes",
		completedArmCount: observation.completedArms.length,
		evaluableArmCount: observation.graphArmEvidence.filter((item) => item.evaluable).length,
		firstHarnessFindingArm: finding.arm,
		harnessFindingCode: finding.code,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const scorecard = strictSnapshot({
		...material,
		scorecardDigest: empiricalStrictJsonDigest(material),
	});
	validateD717GraphNativePreLiveScorecard(scorecard);
	constructedScorecards.add(scorecard);
	return scorecard;
}

export function deriveD717HarnessFinding(
	observation: D717GraphNativePreLiveObservationV1,
): Readonly<{
	readonly arm: (typeof D716_GRAPH_NATIVE_ARM_ORDER)[number] | null;
	readonly code: D717GraphNativePreLiveScorecardV1["harnessFindingCode"];
}> {
	validateD717GraphNativePreLiveObservation(observation);
	for (const item of observation.graphArmEvidence) {
		if (item.fullTaskCompleted) continue;
		const code: D717GraphNativePreLiveScorecardV1["harnessFindingCode"] =
			item.stoppedReason === "budget-exhausted"
				? "review-budget-admission-or-request-efficiency"
				: item.stoppedReason === "warm-preparation-failed"
					? "repair-caller-materialization-handoff"
					: item.stoppedReason === "workspace-cleanup-failed"
						? "repair-caller-cleanup-ownership"
						: item.stoppedReason === "cancelled"
							? "inspect-cancellation-ownership"
							: item.phase === "none"
								? "inspect-provider-or-pre-tool-failure"
								: item.phase === "inspection"
									? "improve-objective-progress-continuation"
									: item.phase === "exact-mutation"
										? "require-post-mutation-diff"
										: item.phase === "workspace-diff"
											? "require-focused-validation"
											: item.phase === "focused-validation-attempted"
												? "repair-focused-validation"
												: item.phase === "focused-validation-passed"
													? "inspect-hidden-verifier-admission"
													: "inspect-hidden-verifier-result";
		return Object.freeze({ arm: item.arm, code });
	}
	return Object.freeze({ arm: null, code: "no-harness-blocker-observed" as const });
}

export function validateD717GraphNativePreLiveScorecard(
	value: unknown,
): D717GraphNativePreLiveScorecardV1 {
	const candidate = record(value, "d717.scorecard");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"claimBoundary",
			"completedArmCount",
			"efficacyClaim",
			"evaluableArmCount",
			"firstHarnessFindingArm",
			"graphIntegrationQualified",
			"harnessFindingCode",
			"historicalBaselineBytesQualified",
			"observationDigest",
			"qualified",
			"schemaVersion",
			"scorecardDigest",
		],
		"d717.scorecard",
	);
	const snapshot = strictSnapshot(candidate) as unknown as D717GraphNativePreLiveScorecardV1;
	const allowedFindingCodes = new Set<D717GraphNativePreLiveScorecardV1["harnessFindingCode"]>([
		"no-harness-blocker-observed",
		"review-budget-admission-or-request-efficiency",
		"repair-caller-materialization-handoff",
		"repair-caller-cleanup-ownership",
		"inspect-cancellation-ownership",
		"inspect-provider-or-pre-tool-failure",
		"improve-objective-progress-continuation",
		"require-post-mutation-diff",
		"require-focused-validation",
		"repair-focused-validation",
		"inspect-hidden-verifier-admission",
		"inspect-hidden-verifier-result",
	]);
	if (
		snapshot.schemaVersion !== D717_SCORECARD_SCHEMA ||
		snapshot.claimBoundary !== D717_CLAIM_BOUNDARY ||
		typeof snapshot.qualified !== "boolean" ||
		!snapshot.graphIntegrationQualified ||
		typeof snapshot.historicalBaselineBytesQualified !== "boolean" ||
		snapshot.qualified !== snapshot.historicalBaselineBytesQualified ||
		snapshot.completedArmCount !== 6 ||
		snapshot.evaluableArmCount < 0 ||
		snapshot.evaluableArmCount > 6 ||
		!Number.isSafeInteger(snapshot.evaluableArmCount) ||
		(snapshot.firstHarnessFindingArm !== null &&
			!D716_GRAPH_NATIVE_ARM_ORDER.includes(snapshot.firstHarnessFindingArm)) ||
		!allowedFindingCodes.has(snapshot.harnessFindingCode) ||
		(snapshot.harnessFindingCode === "no-harness-blocker-observed") !==
			(snapshot.firstHarnessFindingArm === null) ||
		snapshot.causalAttribution !== "undetermined" ||
		snapshot.efficacyClaim !== "none"
	) {
		throw new TypeError("D717 scorecard coordinates drifted");
	}
	digest(snapshot.observationDigest, "d717.scorecard.observationDigest");
	digest(snapshot.scorecardDigest, "d717.scorecard.scorecardDigest");
	const { scorecardDigest: _digest, ...material } = snapshot;
	if (empiricalStrictJsonDigest(material) !== snapshot.scorecardDigest) {
		throw new TypeError("D717 scorecard digest mismatch");
	}
	return snapshot;
}

export async function persistD717GraphNativePrivateGeneration(inputValue: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly observation: D717GraphNativePreLiveObservationV1;
	readonly scorecard: D717GraphNativePreLiveScorecardV1;
}): Promise<{ readonly generationPath: string; readonly generationDigest: string }> {
	const input = record(inputValue, "d717.persistence");
	exactKeys(
		input,
		["generationRef", "observation", "privateRoot", "scorecard"],
		"d717.persistence",
	);
	if (
		!constructedObservations.has(input.observation as object) ||
		!constructedScorecards.has(input.scorecard as object)
	) {
		throw new TypeError("D717 persistence requires same-process evidence");
	}
	if (
		typeof input.privateRoot !== "string" ||
		typeof input.generationRef !== "string" ||
		!/^[a-z0-9][a-z0-9.-]{0,127}$/.test(input.generationRef)
	) {
		throw new TypeError("D717 persistence coordinates are invalid");
	}
	await mkdir(input.privateRoot, { recursive: true, mode: 0o700 });
	const rootStatus = await lstat(input.privateRoot);
	if (
		!rootStatus.isDirectory() ||
		rootStatus.isSymbolicLink() ||
		(rootStatus.mode & 0o777) !== 0o700
	) {
		throw new TypeError("D717 private root must be an exact 0700 directory");
	}
	const finalPath = join(input.privateRoot, input.generationRef);
	try {
		await lstat(finalPath);
		throw new TypeError("D717 generation already exists");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const observation = input.observation as D717GraphNativePreLiveObservationV1;
	const scorecard = input.scorecard as D717GraphNativePreLiveScorecardV1;
	validateD717GraphNativePreLiveObservation(observation);
	validateD717GraphNativePreLiveScorecard(scorecard);
	if (scorecard.observationDigest !== observation.observationDigest) {
		throw new TypeError("D717 scorecard does not bind the observation");
	}
	if (
		scorecard.historicalBaselineBytesQualified !==
		(observation.historicalBaselineEvidenceClass === "exact-artifact-bytes")
	) {
		throw new TypeError("D717 scorecard historical qualification drifted");
	}
	const finding = deriveD717HarnessFinding(observation);
	if (
		scorecard.firstHarnessFindingArm !== finding.arm ||
		scorecard.harnessFindingCode !== finding.code
	) {
		throw new TypeError("D717 scorecard harness finding drifted from Graph evidence");
	}
	const generationMaterial = strictSnapshot({
		schemaVersion: D717_GENERATION_SCHEMA,
		generationRef: input.generationRef,
		claimBoundary: D717_CLAIM_BOUNDARY,
		observation: {
			file: "graph-native-prelive-observation.v1.json",
			digest: observation.observationDigest,
		},
		scorecard: {
			file: "graph-native-prelive-scorecard.v1.json",
			digest: scorecard.scorecardDigest,
		},
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const files = [
		{ file: generation.observation.file, bytes: strictJsonCodec.encode(observation) },
		{ file: generation.scorecard.file, bytes: strictJsonCodec.encode(scorecard) },
		{ file: "generation.v1.json", bytes: strictJsonCodec.encode(generation) },
	] as const;
	const stagingPath = join(input.privateRoot, `.d717-staging-${randomUUID()}`);
	try {
		await mkdir(stagingPath, { mode: 0o700 });
		for (const file of files) await writePrivateFile(join(stagingPath, file.file), file.bytes);
		await syncDirectory(stagingPath);
		for (const file of files) {
			const readback = new Uint8Array(await readFile(join(stagingPath, file.file)));
			if (!Buffer.from(readback).equals(file.bytes))
				throw new TypeError(`D717 staging readback failed for ${file.file}`);
		}
		await commitD696PrivateStagingDirectory({
			stagingPath,
			finalPath,
			privateRoot: input.privateRoot,
		});
		constructedObservations.delete(observation as object);
		constructedScorecards.delete(scorecard as object);
		return Object.freeze({
			generationPath: finalPath,
			generationDigest: generation.generationDigest,
		});
	} catch (error) {
		return failD696PrivateStagingGeneration(stagingPath, error);
	}
}
