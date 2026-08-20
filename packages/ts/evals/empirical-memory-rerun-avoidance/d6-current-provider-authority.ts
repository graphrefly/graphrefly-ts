import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	admitCurrentGraphEffectResult,
	CURRENT_GRAPH_ARMS,
	CURRENT_GRAPH_QUALIFICATION_LIMITS,
	type CurrentGraphAdmittedEffectV1,
	type CurrentGraphEffectResultInputV1,
	type CurrentGraphNativeEvidenceV1,
	createCurrentGraphNativeEvalAuthority,
	snapshotCurrentGraphNativeEvidence,
	takeCurrentGraphAdmittedEffect,
	validateCurrentGraphNativeEvidence,
} from "./d5-graph-native-eval-authority.js";

export const CURRENT_GRAPH_PROVIDER_REVISION =
	"graphrefly-ts.d6.current-graph-native-provider-authority.v1" as const;
export const CURRENT_GRAPH_PROVIDER_EVIDENCE_SCHEMA =
	"graphrefly-ts.d6.current-graph-native-provider-evidence.v1" as const;
export const CURRENT_GRAPH_PROVIDER_ROUTE_SCHEMA =
	"graphrefly-ts.d6.current-graph-native-route-profile.v1" as const;
export const CURRENT_GRAPH_PROVIDER_TASK_SCHEMA =
	"graphrefly-ts.d6.current-graph-native-task-profile.v1" as const;
export const CURRENT_GRAPH_PROVIDER_ENVELOPE_SCHEMA =
	"graphrefly-ts.d32.current-graph-native-model-envelope.v1" as const;

const TOOL_REFS = Object.freeze([
	"read-file",
	"replace-exact",
	"workspace-diff",
	"focused-validation",
] as const);
const EFFECT_KINDS = Object.freeze([
	"materialization",
	"provider-request",
	"retry-wait",
	"tool-action",
	"public-semantic-validation",
	"hidden-verifier",
	"cleanup",
] as const);
const RETRY_CLASSES = Object.freeze(["retryable-transient"] as const);

export type CurrentGraphProviderToolRef = (typeof TOOL_REFS)[number];
export type CurrentGraphProviderEffectKind = (typeof EFFECT_KINDS)[number];
export type CurrentGraphProviderRetryClass = (typeof RETRY_CLASSES)[number];

export interface CurrentGraphProviderRouteProfileV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_PROVIDER_ROUTE_SCHEMA;
	readonly profileRef: string;
	readonly executionClass: "injected-no-network" | "provider-capable-pre-live";
	readonly endpointKind: "injected-chat" | "chat-completions" | "responses";
	readonly providerRef: string;
	readonly modelRef: string;
	readonly pricingRevision: string;
	readonly maxOutputTokens: number;
	readonly routeDigest: string;
}

export interface CurrentGraphProviderTaskProfileV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_PROVIDER_TASK_SCHEMA;
	readonly taskRef: string;
	readonly systemInstruction: string;
	readonly taskStatement: string;
	readonly armContexts: readonly string[];
	readonly allowedWorkspacePath: string;
	readonly taskProfileDigest: string;
}

export type CurrentGraphRuntimeToolArgumentsV1 =
	| Readonly<{ toolRef: "read-file"; path: string }>
	| Readonly<{ toolRef: "replace-exact"; path: string; oldText: string; newText: string }>
	| Readonly<{ toolRef: "workspace-diff" }>
	| Readonly<{ toolRef: "focused-validation" }>;

export interface CurrentGraphProviderUsageV1 {
	readonly requests: 1;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly actualCostMicrousd: number;
	readonly actualElapsedMs: number;
	readonly costBasis: "reported" | "conservative-reservation";
}

export interface CurrentGraphProviderBudgetLimitsV1 {
	readonly maxProviderAttempts: number;
	readonly maxRetryWaits: number;
	readonly maxCostMicrousd: number;
	readonly maxElapsedMs: number;
	readonly maxEffectFacts: number;
	readonly providerMaxCostMicrousd: number;
	readonly providerMaxElapsedMs: number;
	readonly retryWaitMaxElapsedMs: number;
	readonly localEffectMaxElapsedMs: number;
}

export interface CurrentGraphProviderBudgetStateV1 {
	readonly providerAttempts: number;
	readonly retryWaits: number;
	readonly confirmedCostMicrousd: number;
	readonly confirmedElapsedMs: number;
	readonly effectFacts: number;
}

export const CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS = Object.freeze({
	maxProviderAttempts: 120,
	maxRetryWaits: 12,
	maxCostMicrousd: 6_000_000,
	maxElapsedMs: 7_200_000,
	maxEffectFacts: 512,
	providerMaxCostMicrousd: 100_000,
	providerMaxElapsedMs: 60_000,
	retryWaitMaxElapsedMs: 60_000,
	localEffectMaxElapsedMs: 10_000,
}) satisfies CurrentGraphProviderBudgetLimitsV1;

export const CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE = createCurrentGraphProviderRouteProfile({
	profileRef: "current-provider.injected.no-network.v1",
	executionClass: "injected-no-network",
	endpointKind: "injected-chat",
	providerRef: "injected-provider",
	modelRef: "injected-model",
	pricingRevision: "injected-zero-price.v1",
	maxOutputTokens: 4_096,
});

export const CURRENT_GRAPH_PROVIDER_INJECTED_TASK = createCurrentGraphProviderTaskProfile({
	taskRef: "current-provider.injected-six-arm-task.v1",
	systemInstruction:
		"Complete the admitted task using only the Graph-authorized tools and current workspace evidence.",
	taskStatement:
		"Inspect the workspace, make the exact necessary mutation, inspect the diff, and run focused validation.",
	armContexts: CURRENT_GRAPH_ARMS.map((arm) => `Evaluation arm: ${arm}`),
	allowedWorkspacePath: "src/current.ts",
});

export interface CurrentGraphModelEnvelopeV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_PROVIDER_ENVELOPE_SCHEMA;
	readonly arm: (typeof CURRENT_GRAPH_ARMS)[number];
	readonly runSequence: number;
	readonly phaseBefore: string;
	readonly systemInstruction: string;
	readonly taskStatement: string;
	readonly armContext: string;
	readonly correctionDigest: string | null;
	readonly correctionReason:
		| "exact-replacement-unchanged"
		| "exact-replacement-old-text-not-found"
		| "exact-replacement-old-text-not-unique"
		| "mutation-proposal-cardinality"
		| "focused-validation-failed"
		| "public-semantic-validation-failed"
		| null;
	readonly correctionStage:
		| "reinspect"
		| "fresh-mutation"
		| "retained-span-mutation"
		| "validation-reinspect"
		| "validation-mutation"
		| "semantic-correction"
		| null;
	readonly requiredDisposition:
		| "reinspect-current-workspace"
		| "fresh-byte-different-exact-replacement"
		| "fresh-current-source-exact-replacement"
		| "fresh-unique-span-exact-replacement"
		| "reinspect-validation-failing-workspace"
		| "repair-focused-validation-failure"
		| "address-public-criterion-failures"
		| null;
	readonly requiredFirstToolRef: "read-file" | "replace-exact" | null;
	readonly allowedTools: readonly CurrentGraphProviderToolRef[];
	readonly envelopeDigest: string;
}

interface CurrentGraphProviderRequestProjectionV1 {
	readonly schemaVersion: "graphrefly-ts.d6.current-graph-native-effect-request.v1";
	readonly sequence: number;
	readonly arm: (typeof CURRENT_GRAPH_ARMS)[number];
	readonly runSequence: number;
	readonly effectKind: CurrentGraphProviderEffectKind;
	readonly sourceWorkflowRequestDigest: string;
	readonly sourceWorkflowEffectKind: string;
	readonly workspaceStateDigest: string | null;
	readonly routeDigest: string | null;
	readonly taskEnvelopeDigest: string | null;
	readonly logicalRequestDigest: string | null;
	readonly attemptOrdinal: number | null;
	readonly toolRef: CurrentGraphProviderToolRef | null;
	readonly toolArgumentsDigest: string | null;
	readonly toolArgumentsBytes: number;
	readonly retryDelayMs: number;
	readonly reservation: Readonly<{
		providerAttempts: number;
		retryWaits: number;
		maxCostMicrousd: number;
		maxElapsedMs: number;
	}>;
	readonly requestDigest: string;
}

export interface CurrentGraphProviderEffectAdmissionV1 {
	readonly schemaVersion: "graphrefly-ts.d6.current-graph-native-effect-admission.v1";
	readonly requestDigest: string;
	readonly admitted: true;
	readonly budgetBefore: CurrentGraphProviderBudgetStateV1;
	readonly prospectiveBudget: CurrentGraphProviderBudgetStateV1;
	readonly decisionDigest: string;
}

export type CurrentGraphProviderEffectResultInputV1 =
	| Readonly<{
			effectKind: "provider-request";
			status: "completed" | "failed";
			toolCalls: readonly CurrentGraphRuntimeToolArgumentsV1[];
			failureCode:
				| "retryable-transient"
				| "provider-failed"
				| "mutation-proposal-cardinality"
				| "mutation-proposal-content"
				| null;
			retryProposal: Readonly<{
				retryClass: CurrentGraphProviderRetryClass;
				retryAfterMs: number;
				proposalDigest: string;
			}> | null;
			usage: CurrentGraphProviderUsageV1;
			evidenceDigest: string;
	  }>
	| Readonly<{
			effectKind: "retry-wait";
			status: "completed" | "failed";
			actualElapsedMs: number;
			evidenceDigest: string;
	  }>
	| Exclude<CurrentGraphEffectResultInputV1, { effectKind: "provider-request" }>;

export interface CurrentGraphProviderAdmittedEffectV1 {
	readonly request: CurrentGraphProviderRequestProjectionV1;
	readonly admission: CurrentGraphProviderEffectAdmissionV1;
	readonly runtime: Readonly<{
		route: CurrentGraphProviderRouteProfileV1 | null;
		modelEnvelope: CurrentGraphModelEnvelopeV1 | null;
		toolArguments: CurrentGraphRuntimeToolArgumentsV1 | null;
	}>;
}

type ProviderResultProjection = Readonly<{
	effectKind: "provider-request";
	status: "completed" | "failed";
	toolCalls: readonly Readonly<{
		toolRef: CurrentGraphProviderToolRef;
		argumentsDigest: string;
		argumentsBytes: number;
	}>[];
	failureCode:
		| "retryable-transient"
		| "provider-failed"
		| "mutation-proposal-cardinality"
		| "mutation-proposal-content"
		| null;
	retryProposal: Readonly<{
		retryClass: CurrentGraphProviderRetryClass;
		retryAfterMs: number;
		proposalDigest: string;
	}> | null;
	usage: CurrentGraphProviderUsageV1;
	evidenceDigest: string;
}>;

type CurrentGraphProviderResultProjectionV1 =
	| ProviderResultProjection
	| Readonly<{
			effectKind: "retry-wait";
			status: "completed" | "failed";
			actualElapsedMs: number;
			evidenceDigest: string;
	  }>
	| Exclude<CurrentGraphEffectResultInputV1, { effectKind: "provider-request" }>;

export interface CurrentGraphProviderFactV1 {
	readonly sequence: number;
	readonly arm: (typeof CURRENT_GRAPH_ARMS)[number];
	readonly runSequence: number;
	readonly request: CurrentGraphProviderRequestProjectionV1;
	readonly admission: CurrentGraphProviderEffectAdmissionV1;
	readonly result: CurrentGraphProviderResultProjectionV1;
	readonly reconciliation: Readonly<{
		budgetAfter: CurrentGraphProviderBudgetStateV1;
		actualCostMicrousd: number;
		actualElapsedMs: number;
		reconciliationDigest: string;
	}>;
	readonly factDigest: string;
}

export interface CurrentGraphProviderEvidenceV1 {
	readonly schemaVersion: typeof CURRENT_GRAPH_PROVIDER_EVIDENCE_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D6";
	readonly d5Baseline: Readonly<{
		commit: "892e68db6882e7b1b119c9cbccc329b1e962db93";
		bundleArtifactDigest: "sha256:a6463d782d610ab68460486c92971f48463ce4bc9af580baa4d8239fa083747c";
		implementationManifestDigest: "sha256:10d7f8202c1317bbb752b644b8b1564b9ab0cc2ab437df7a164b5105921c492f";
	}>;
	readonly topology: Readonly<{
		runtimeFactNode: "current/d6/provider/runtime-facts";
		canonicalProjectionNode: "current/d6/provider/canonical-projection";
		topologyDigest: string;
	}>;
	readonly routeProfile: CurrentGraphProviderRouteProfileV1;
	readonly taskProfileDigest: string;
	readonly limits: CurrentGraphProviderBudgetLimitsV1;
	readonly facts: readonly CurrentGraphProviderFactV1[];
	readonly workflowEvidence: CurrentGraphNativeEvidenceV1;
	readonly budget: CurrentGraphProviderBudgetStateV1;
	readonly runStatus: "complete" | "stopped";
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface CurrentGraphProviderAuthorityV1 {
	readonly revision: typeof CURRENT_GRAPH_PROVIDER_REVISION;
}

interface RuntimeAdmittedFact {
	readonly projection: CurrentGraphProviderFactV1;
	readonly rawResult: CurrentGraphProviderEffectResultInputV1;
}

interface ProviderLogicalState {
	readonly workflowEffect: CurrentGraphAdmittedEffectV1;
	readonly route: CurrentGraphProviderRouteProfileV1;
	readonly modelEnvelope: CurrentGraphModelEnvelopeV1;
	readonly logicalRequestDigest: string;
	attemptOrdinal: number;
	totalCostMicrousd: number;
	totalElapsedMs: number;
	attemptFactDigests: string[];
}

interface ProviderAuthorityState {
	readonly owner: ReturnType<typeof graph>;
	readonly runtimeFactNode: ReturnType<typeof createRuntimeFactNode>;
	readonly workflow: ReturnType<typeof createCurrentGraphNativeEvalAuthority>;
	readonly limits: CurrentGraphProviderBudgetLimitsV1;
	readonly route: CurrentGraphProviderRouteProfileV1;
	readonly task: CurrentGraphProviderTaskProfileV1;
	readonly facts: CurrentGraphProviderFactV1[];
	budget: CurrentGraphProviderBudgetStateV1;
	active: CurrentGraphProviderAdmittedEffectV1 | null;
	nextSequence: number;
	providerLogical: ProviderLogicalState | null;
	pendingToolArguments: CurrentGraphRuntimeToolArgumentsV1[];
	finished: boolean;
}

const states = new WeakMap<object, ProviderAuthorityState>();

const ZERO_BUDGET = Object.freeze({
	providerAttempts: 0,
	retryWaits: 0,
	confirmedCostMicrousd: 0,
	confirmedElapsedMs: 0,
	effectFacts: 0,
}) satisfies CurrentGraphProviderBudgetStateV1;

function createRuntimeFactNode(owner: ReturnType<typeof graph>) {
	return owner.node<RuntimeAdmittedFact>([], null, { name: "current/d6/provider/runtime-facts" });
}

function boundedString(value: unknown, path: string, maxBytes: number, allowEmpty = false): string {
	if (typeof value !== "string" || (!allowEmpty && value.length === 0))
		throw new TypeError(`${path} must be a string`);
	if (Buffer.byteLength(value, "utf8") > maxBytes)
		throw new TypeError(`${path} exceeded its byte bound`);
	return value;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], path: string): T {
	if (typeof value !== "string" || !values.includes(value as T))
		throw new TypeError(`${path} is invalid`);
	return value as T;
}

function bool(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") throw new TypeError(`${path} is invalid`);
	return value;
}

function canonicalBytes(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(strictSnapshot(value)), "utf8");
}

function validateToolArguments(value: unknown): CurrentGraphRuntimeToolArgumentsV1 {
	const candidate = record(value, "current.provider.toolArguments");
	const toolRef = oneOf(candidate.toolRef, TOOL_REFS, "current.provider.toolArguments.toolRef");
	if (toolRef === "read-file") {
		exactKeys(candidate, ["path", "toolRef"], "current.provider.toolArguments");
		boundedString(candidate.path, "current.provider.toolArguments.path", 512);
	} else if (toolRef === "replace-exact") {
		exactKeys(
			candidate,
			["newText", "oldText", "path", "toolRef"],
			"current.provider.toolArguments",
		);
		boundedString(candidate.path, "current.provider.toolArguments.path", 512);
		boundedString(candidate.oldText, "current.provider.toolArguments.oldText", 32_768);
		boundedString(candidate.newText, "current.provider.toolArguments.newText", 32_768, true);
	} else exactKeys(candidate, ["toolRef"], "current.provider.toolArguments");
	if (canonicalBytes(candidate) > 65_536)
		throw new TypeError("current provider tool arguments exceeded their canonical byte bound");
	return strictSnapshot(candidate) as CurrentGraphRuntimeToolArgumentsV1;
}

export function createCurrentGraphProviderRouteProfile(
	value: Omit<CurrentGraphProviderRouteProfileV1, "schemaVersion" | "routeDigest">,
): CurrentGraphProviderRouteProfileV1 {
	const candidate = record(value, "current.provider.route");
	exactKeys(
		candidate,
		[
			"endpointKind",
			"executionClass",
			"maxOutputTokens",
			"modelRef",
			"pricingRevision",
			"profileRef",
			"providerRef",
		],
		"current.provider.route",
	);
	const executionClass = oneOf(
		candidate.executionClass,
		["injected-no-network", "provider-capable-pre-live"],
		"current.provider.route.executionClass",
	);
	const endpointKind = oneOf(
		candidate.endpointKind,
		["injected-chat", "chat-completions", "responses"],
		"current.provider.route.endpointKind",
	);
	if ((executionClass === "injected-no-network") !== (endpointKind === "injected-chat"))
		throw new TypeError("current provider route execution class and endpoint kind disagree");
	for (const key of ["profileRef", "modelRef", "pricingRevision", "providerRef"] as const)
		boundedString(candidate[key], `current.provider.route.${key}`, 256);
	safeInteger(candidate.maxOutputTokens, "current.provider.route.maxOutputTokens", {
		min: 1,
		max: 65_536,
	});
	const material = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_PROVIDER_ROUTE_SCHEMA,
		...candidate,
	});
	return Object.freeze({
		...(material as Omit<CurrentGraphProviderRouteProfileV1, "routeDigest">),
		routeDigest: empiricalStrictJsonDigest(material),
	});
}

function validateRouteProfile(value: unknown): CurrentGraphProviderRouteProfileV1 {
	const candidate = record(value, "current.provider.route");
	exactKeys(
		candidate,
		[
			"endpointKind",
			"executionClass",
			"maxOutputTokens",
			"modelRef",
			"pricingRevision",
			"profileRef",
			"providerRef",
			"routeDigest",
			"schemaVersion",
		],
		"current.provider.route",
	);
	if (candidate.schemaVersion !== CURRENT_GRAPH_PROVIDER_ROUTE_SCHEMA)
		throw new TypeError("current provider route schema drifted");
	const rebuilt = createCurrentGraphProviderRouteProfile({
		profileRef: candidate.profileRef as string,
		executionClass:
			candidate.executionClass as CurrentGraphProviderRouteProfileV1["executionClass"],
		endpointKind: candidate.endpointKind as CurrentGraphProviderRouteProfileV1["endpointKind"],
		providerRef: candidate.providerRef as string,
		modelRef: candidate.modelRef as string,
		pricingRevision: candidate.pricingRevision as string,
		maxOutputTokens: candidate.maxOutputTokens as number,
	});
	if (candidate.routeDigest !== rebuilt.routeDigest)
		throw new TypeError("current provider route digest drifted");
	return rebuilt;
}

export function createCurrentGraphProviderTaskProfile(
	value: Omit<CurrentGraphProviderTaskProfileV1, "schemaVersion" | "taskProfileDigest">,
): CurrentGraphProviderTaskProfileV1 {
	const candidate = record(value, "current.provider.task");
	exactKeys(
		candidate,
		["allowedWorkspacePath", "armContexts", "systemInstruction", "taskRef", "taskStatement"],
		"current.provider.task",
	);
	boundedString(candidate.taskRef, "current.provider.task.taskRef", 256);
	boundedString(candidate.systemInstruction, "current.provider.task.systemInstruction", 4_096);
	boundedString(candidate.taskStatement, "current.provider.task.taskStatement", 16_384);
	boundedString(candidate.allowedWorkspacePath, "current.provider.task.allowedWorkspacePath", 512);
	const armContexts = array(candidate.armContexts, "current.provider.task.armContexts");
	if (armContexts.length !== CURRENT_GRAPH_ARMS.length)
		throw new TypeError("current provider task arm context cardinality drifted");
	for (let index = 0; index < armContexts.length; index += 1)
		boundedString(armContexts[index], `current.provider.task.armContexts[${index}]`, 1_024);
	const material = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_PROVIDER_TASK_SCHEMA,
		...candidate,
		armContexts,
	});
	if (canonicalBytes(material) > 32_768)
		throw new TypeError("current provider task profile exceeded its canonical byte bound");
	return Object.freeze({
		...(material as Omit<CurrentGraphProviderTaskProfileV1, "taskProfileDigest">),
		taskProfileDigest: empiricalStrictJsonDigest(material),
	});
}

function validateTaskProfile(value: unknown): CurrentGraphProviderTaskProfileV1 {
	const candidate = record(value, "current.provider.task");
	exactKeys(
		candidate,
		[
			"allowedWorkspacePath",
			"armContexts",
			"schemaVersion",
			"systemInstruction",
			"taskProfileDigest",
			"taskRef",
			"taskStatement",
		],
		"current.provider.task",
	);
	if (candidate.schemaVersion !== CURRENT_GRAPH_PROVIDER_TASK_SCHEMA)
		throw new TypeError("current provider task schema drifted");
	const rebuilt = createCurrentGraphProviderTaskProfile({
		taskRef: candidate.taskRef as string,
		systemInstruction: candidate.systemInstruction as string,
		taskStatement: candidate.taskStatement as string,
		armContexts: candidate.armContexts as readonly string[],
		allowedWorkspacePath: candidate.allowedWorkspacePath as string,
	});
	if (candidate.taskProfileDigest !== rebuilt.taskProfileDigest)
		throw new TypeError("current provider task digest drifted");
	return rebuilt;
}

function validateLimits(value: unknown): CurrentGraphProviderBudgetLimitsV1 {
	const candidate = record(value, "current.provider.limits");
	exactKeys(
		candidate,
		[
			"localEffectMaxElapsedMs",
			"maxCostMicrousd",
			"maxEffectFacts",
			"maxElapsedMs",
			"maxProviderAttempts",
			"maxRetryWaits",
			"providerMaxCostMicrousd",
			"providerMaxElapsedMs",
			"retryWaitMaxElapsedMs",
		],
		"current.provider.limits",
	);
	for (const key of Object.keys(candidate))
		safeInteger(candidate[key], `current.provider.limits.${key}`, { min: 1 });
	return strictSnapshot(candidate) as unknown as CurrentGraphProviderBudgetLimitsV1;
}

function workflowLimitsFor(limits: CurrentGraphProviderBudgetLimitsV1) {
	return Object.freeze({
		...CURRENT_GRAPH_QUALIFICATION_LIMITS,
		maxCostMicrousd: limits.maxCostMicrousd,
		maxElapsedMs: limits.maxElapsedMs,
		maxEffectFacts: limits.maxEffectFacts,
		providerMaxCostMicrousd: limits.providerMaxCostMicrousd * 2,
		providerMaxElapsedMs: limits.providerMaxElapsedMs * 2,
		localEffectMaxElapsedMs: limits.localEffectMaxElapsedMs,
	});
}

function taskEnvelope(state: ProviderAuthorityState, effect: CurrentGraphAdmittedEffectV1) {
	const armIndex = CURRENT_GRAPH_ARMS.indexOf(effect.request.arm);
	const armContext = state.task.armContexts[armIndex];
	if (armContext === undefined) throw new TypeError("current provider arm context is missing");
	const correction = effect.request.correctionDirective;
	let requiredDisposition: CurrentGraphModelEnvelopeV1["requiredDisposition"] = null;
	if (
		correction?.reason === "exact-replacement-unchanged" ||
		correction?.reason === "exact-replacement-old-text-not-found" ||
		correction?.reason === "exact-replacement-old-text-not-unique"
	) {
		if (correction.stage === "reinspect") requiredDisposition = "reinspect-current-workspace";
		else if (correction.stage === "fresh-mutation") {
			requiredDisposition =
				correction.reason === "exact-replacement-unchanged"
					? "fresh-byte-different-exact-replacement"
					: correction.reason === "exact-replacement-old-text-not-found"
						? "fresh-current-source-exact-replacement"
						: "fresh-unique-span-exact-replacement";
		} else throw new TypeError("current provider exact-replacement correction stage drifted");
	} else if (correction?.reason === "focused-validation-failed") {
		if (correction.stage === "validation-reinspect")
			requiredDisposition = "reinspect-validation-failing-workspace";
		else if (correction.stage === "validation-mutation")
			requiredDisposition = "repair-focused-validation-failure";
		else throw new TypeError("current provider focused-validation correction stage drifted");
	} else if (correction?.reason === "public-semantic-validation-failed") {
		if (correction.stage !== "semantic-correction")
			throw new TypeError("current provider semantic correction stage drifted");
		requiredDisposition = "address-public-criterion-failures";
	} else if (correction?.reason === "mutation-proposal-cardinality") {
		if (correction.stage !== "retained-span-mutation")
			throw new TypeError("current provider mutation-cardinality correction stage drifted");
		requiredDisposition = "fresh-byte-different-exact-replacement";
	}
	const material = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_PROVIDER_ENVELOPE_SCHEMA,
		arm: effect.request.arm,
		runSequence: effect.request.runSequence,
		phaseBefore: effect.request.phaseBefore,
		systemInstruction: state.task.systemInstruction,
		taskStatement: state.task.taskStatement,
		armContext,
		correctionDigest: correction?.contextDigest ?? null,
		correctionReason: correction?.reason ?? null,
		correctionStage: correction?.stage ?? null,
		requiredDisposition,
		requiredFirstToolRef: correction?.requiredFirstToolRef ?? null,
		allowedTools: TOOL_REFS,
	});
	if (canonicalBytes(material) > 32_768)
		throw new TypeError("current provider model envelope exceeded its byte bound");
	return Object.freeze({ ...material, envelopeDigest: empiricalStrictJsonDigest(material) });
}

function reservation(
	state: ProviderAuthorityState,
	effectKind: CurrentGraphProviderEffectKind,
	retryDelayMs: number,
) {
	if (effectKind === "provider-request")
		return Object.freeze({
			providerAttempts: 1,
			retryWaits: 0,
			maxCostMicrousd: state.limits.providerMaxCostMicrousd,
			maxElapsedMs: state.limits.providerMaxElapsedMs,
		});
	if (effectKind === "retry-wait")
		return Object.freeze({
			providerAttempts: 0,
			retryWaits: 1,
			maxCostMicrousd: 0,
			maxElapsedMs: retryDelayMs,
		});
	return Object.freeze({
		providerAttempts: 0,
		retryWaits: 0,
		maxCostMicrousd: 0,
		maxElapsedMs: state.limits.localEffectMaxElapsedMs,
	});
}

function prospectiveBudget(
	state: ProviderAuthorityState,
	reserved: ReturnType<typeof reservation>,
): CurrentGraphProviderBudgetStateV1 {
	return Object.freeze({
		providerAttempts: state.budget.providerAttempts + reserved.providerAttempts,
		retryWaits: state.budget.retryWaits + reserved.retryWaits,
		confirmedCostMicrousd: state.budget.confirmedCostMicrousd + reserved.maxCostMicrousd,
		confirmedElapsedMs: state.budget.confirmedElapsedMs + reserved.maxElapsedMs,
		effectFacts: state.budget.effectFacts + 1,
	});
}

function withinLimits(state: ProviderAuthorityState, budget: CurrentGraphProviderBudgetStateV1) {
	return (
		budget.providerAttempts <= state.limits.maxProviderAttempts &&
		budget.retryWaits <= state.limits.maxRetryWaits &&
		budget.confirmedCostMicrousd <= state.limits.maxCostMicrousd &&
		budget.confirmedElapsedMs <= state.limits.maxElapsedMs &&
		budget.effectFacts <= state.limits.maxEffectFacts
	);
}

function schedule(
	state: ProviderAuthorityState,
	workflowEffect: CurrentGraphAdmittedEffectV1,
	options: {
		providerLogical?: ProviderLogicalState;
		toolArguments?: CurrentGraphRuntimeToolArgumentsV1;
		retryDelayMs?: number;
	} = {},
) {
	if (state.active !== null || state.finished)
		throw new TypeError("current provider Graph schedule overlap");
	const effectKind: CurrentGraphProviderEffectKind =
		options.retryDelayMs === undefined ? workflowEffect.request.effectKind : "retry-wait";
	const retryDelayMs = options.retryDelayMs ?? 0;
	const reserved = reservation(state, effectKind, retryDelayMs);
	const prospective = prospectiveBudget(state, reserved);
	if (!withinLimits(state, prospective))
		throw new TypeError("current provider Graph budget admission denied");
	const providerLogical = options.providerLogical;
	const toolArguments = options.toolArguments;
	const sequence = state.nextSequence++;
	const projectionMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d6.current-graph-native-effect-request.v1" as const,
		sequence,
		arm: workflowEffect.request.arm,
		runSequence: workflowEffect.request.runSequence,
		effectKind,
		sourceWorkflowRequestDigest: workflowEffect.request.requestDigest,
		sourceWorkflowEffectKind: workflowEffect.request.effectKind,
		workspaceStateDigest: workflowEffect.request.workspaceStateDigest,
		routeDigest: providerLogical?.route.routeDigest ?? null,
		taskEnvelopeDigest: providerLogical?.modelEnvelope.envelopeDigest ?? null,
		logicalRequestDigest: providerLogical?.logicalRequestDigest ?? null,
		attemptOrdinal: providerLogical?.attemptOrdinal ?? null,
		toolRef: toolArguments?.toolRef ?? workflowEffect.request.toolRef ?? null,
		toolArgumentsDigest:
			toolArguments === undefined ? null : empiricalStrictJsonDigest(toolArguments),
		toolArgumentsBytes: toolArguments === undefined ? 0 : canonicalBytes(toolArguments),
		retryDelayMs,
		reservation: reserved,
	});
	const request = Object.freeze({
		...projectionMaterial,
		requestDigest: empiricalStrictJsonDigest(projectionMaterial),
	});
	const admissionMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d6.current-graph-native-effect-admission.v1" as const,
		requestDigest: request.requestDigest,
		admitted: true as const,
		budgetBefore: state.budget,
		prospectiveBudget: prospective,
	});
	const admission = Object.freeze({
		...admissionMaterial,
		decisionDigest: empiricalStrictJsonDigest(admissionMaterial),
	});
	state.active = Object.freeze({
		request,
		admission,
		runtime: Object.freeze({
			route: providerLogical?.route ?? null,
			modelEnvelope: providerLogical?.modelEnvelope ?? null,
			toolArguments: toolArguments ?? null,
		}),
	});
}

function scheduleWorkflowEffect(state: ProviderAuthorityState): void {
	const workflowEffect = takeCurrentGraphAdmittedEffect(state.workflow);
	if (workflowEffect === null) {
		state.pendingToolArguments = [];
		state.finished = true;
		return;
	}
	if (workflowEffect.request.effectKind !== "tool-action") state.pendingToolArguments = [];
	if (workflowEffect.request.effectKind === "provider-request") {
		const modelEnvelope = taskEnvelope(state, workflowEffect);
		const logicalMaterial = strictSnapshot({
			sourceWorkflowRequestDigest: workflowEffect.request.requestDigest,
			routeDigest: state.route.routeDigest,
			taskEnvelopeDigest: modelEnvelope.envelopeDigest,
		});
		const logical: ProviderLogicalState = {
			workflowEffect,
			route: state.route,
			modelEnvelope,
			logicalRequestDigest: empiricalStrictJsonDigest(logicalMaterial),
			attemptOrdinal: 1,
			totalCostMicrousd: 0,
			totalElapsedMs: 0,
			attemptFactDigests: [],
		};
		state.providerLogical = logical;
		schedule(state, workflowEffect, { providerLogical: logical });
		return;
	}
	if (workflowEffect.request.effectKind === "tool-action") {
		const toolArguments = state.pendingToolArguments.shift();
		if (toolArguments === undefined || toolArguments.toolRef !== workflowEffect.request.toolRef)
			throw new TypeError(
				`current provider Graph tool argument queue drifted: expected=${workflowEffect.request.toolRef} actual=${toolArguments?.toolRef ?? "missing"}`,
			);
		schedule(state, workflowEffect, { toolArguments });
		return;
	}
	schedule(state, workflowEffect);
}

function validateUsage(value: unknown, request: CurrentGraphProviderRequestProjectionV1) {
	const usage = record(value, "current.provider.result.usage");
	exactKeys(
		usage,
		[
			"actualCostMicrousd",
			"actualElapsedMs",
			"cacheReadTokens",
			"costBasis",
			"inputTokens",
			"outputTokens",
			"requests",
		],
		"current.provider.result.usage",
	);
	if (usage.requests !== 1) throw new TypeError("current provider usage request count drifted");
	for (const key of [
		"inputTokens",
		"outputTokens",
		"cacheReadTokens",
		"actualCostMicrousd",
		"actualElapsedMs",
	] as const)
		safeInteger(usage[key], `current.provider.result.usage.${key}`, { min: 0 });
	oneOf(
		usage.costBasis,
		["reported", "conservative-reservation"],
		"current.provider.usage.costBasis",
	);
	if (
		Number(usage.actualCostMicrousd) > request.reservation.maxCostMicrousd ||
		Number(usage.actualElapsedMs) > request.reservation.maxElapsedMs
	)
		throw new TypeError("current provider usage exceeded its Graph reservation");
	return strictSnapshot(usage) as unknown as CurrentGraphProviderUsageV1;
}

function validateProviderResult(
	value: unknown,
	request: CurrentGraphProviderRequestProjectionV1,
): {
	raw: Extract<CurrentGraphProviderEffectResultInputV1, { effectKind: "provider-request" }>;
	projection: ProviderResultProjection;
} {
	const candidate = record(value, "current.provider.result");
	exactKeys(
		candidate,
		[
			"effectKind",
			"evidenceDigest",
			"failureCode",
			"retryProposal",
			"status",
			"toolCalls",
			"usage",
		],
		"current.provider.result",
	);
	if (candidate.effectKind !== "provider-request")
		throw new TypeError("current provider result kind drifted");
	const status = oneOf(candidate.status, ["completed", "failed"], "current.provider.result.status");
	const rawCalls = array(candidate.toolCalls, "current.provider.result.toolCalls");
	if (rawCalls.length > 4) throw new TypeError("current provider tool call bound exceeded");
	const toolCalls = rawCalls.map(validateToolArguments);
	digest(candidate.evidenceDigest, "current.provider.result.evidenceDigest");
	const usage = validateUsage(candidate.usage, request);
	let failureCode:
		| "retryable-transient"
		| "provider-failed"
		| "mutation-proposal-cardinality"
		| "mutation-proposal-content"
		| null = null;
	let retryProposal: ProviderResultProjection["retryProposal"] = null;
	if (status === "completed") {
		if (
			toolCalls.length === 0 ||
			candidate.failureCode !== null ||
			candidate.retryProposal !== null
		)
			throw new TypeError("current completed provider result cardinality drifted");
	} else {
		if (toolCalls.length !== 0)
			throw new TypeError("current failed provider result cannot carry tool calls");
		failureCode = oneOf(
			candidate.failureCode,
			[
				"retryable-transient",
				"provider-failed",
				"mutation-proposal-cardinality",
				"mutation-proposal-content",
			],
			"current.provider.result.failureCode",
		) as
			| "retryable-transient"
			| "provider-failed"
			| "mutation-proposal-cardinality"
			| "mutation-proposal-content";
		if (failureCode === "retryable-transient") {
			const proposal = record(candidate.retryProposal, "current.provider.result.retryProposal");
			exactKeys(
				proposal,
				["proposalDigest", "retryAfterMs", "retryClass"],
				"current.provider.result.retryProposal",
			);
			if (proposal.retryClass !== "retryable-transient")
				throw new TypeError("current provider retry class drifted");
			const retryAfterMs = safeInteger(
				proposal.retryAfterMs,
				"current.provider.result.retryAfterMs",
				{ min: 0, max: 60_000 },
			);
			const proposalMaterial = strictSnapshot({
				retryClass: "retryable-transient" as const,
				retryAfterMs,
				requestDigest: request.requestDigest,
				logicalRequestDigest: request.logicalRequestDigest,
			});
			if (proposal.proposalDigest !== empiricalStrictJsonDigest(proposalMaterial))
				throw new TypeError("current provider retry proposal digest drifted");
			retryProposal = Object.freeze({
				retryClass: "retryable-transient" as const,
				retryAfterMs,
				proposalDigest: proposal.proposalDigest as string,
			});
		} else if (candidate.retryProposal !== null)
			throw new TypeError("current terminal provider failure cannot propose retry");
	}
	const raw = strictSnapshot({
		effectKind: "provider-request" as const,
		status,
		toolCalls,
		failureCode,
		retryProposal,
		usage,
		evidenceDigest: candidate.evidenceDigest,
	}) as Extract<CurrentGraphProviderEffectResultInputV1, { effectKind: "provider-request" }>;
	const projection = strictSnapshot({
		...raw,
		toolCalls: toolCalls.map((call) => ({
			toolRef: call.toolRef,
			argumentsDigest: empiricalStrictJsonDigest(call),
			argumentsBytes: canonicalBytes(call),
		})),
	}) as ProviderResultProjection;
	return { raw, projection };
}

function validateLocalResult(
	value: unknown,
	active: CurrentGraphProviderAdmittedEffectV1,
):
	| Exclude<CurrentGraphEffectResultInputV1, { effectKind: "provider-request" }>
	| Extract<CurrentGraphProviderEffectResultInputV1, { effectKind: "retry-wait" }> {
	if (active.request.effectKind === "retry-wait") {
		const candidate = record(value, "current.provider.retryWaitResult");
		exactKeys(
			candidate,
			["actualElapsedMs", "effectKind", "evidenceDigest", "status"],
			"current.provider.retryWaitResult",
		);
		if (candidate.effectKind !== "retry-wait")
			throw new TypeError("current provider retry wait result kind drifted");
		oneOf(candidate.status, ["completed", "failed"], "current.provider.retryWaitResult.status");
		const elapsed = safeInteger(
			candidate.actualElapsedMs,
			"current.provider.retryWaitResult.elapsed",
			{
				min: 0,
				max: active.request.reservation.maxElapsedMs,
			},
		);
		digest(candidate.evidenceDigest, "current.provider.retryWaitResult.evidenceDigest");
		return strictSnapshot({ ...candidate, actualElapsedMs: elapsed }) as never;
	}
	const workflow = statesForActive(active).workflow;
	const workflowEffect = takeCurrentGraphAdmittedEffect(workflow);
	if (
		workflowEffect === null ||
		workflowEffect.request.requestDigest !== active.request.sourceWorkflowRequestDigest
	)
		throw new TypeError("current provider local result lost its workflow admission");
	const candidate = record(value, "current.provider.localResult");
	if (candidate.effectKind !== active.request.effectKind)
		throw new TypeError("current provider local result kind drifted");
	const elapsed = safeInteger(
		candidate.actualElapsedMs,
		"current.provider.localResult.actualElapsedMs",
		{
			min: 0,
			max: active.request.reservation.maxElapsedMs,
		},
	);
	if (candidate.actualCostMicrousd !== 0)
		throw new TypeError("current provider local result cannot report provider cost");
	digest(candidate.evidenceDigest, "current.provider.localResult.evidenceDigest");
	if (active.request.effectKind === "materialization") {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"effectKind",
				"evidenceDigest",
				"status",
				"workspaceStateDigest",
			],
			"current.provider.localResult",
		);
		const status = oneOf(
			candidate.status,
			["completed", "failed"],
			"current.provider.localResult.status",
		);
		if ((status === "completed") !== (typeof candidate.workspaceStateDigest === "string"))
			throw new TypeError("current provider materialization cardinality drifted");
		if (typeof candidate.workspaceStateDigest === "string")
			digest(candidate.workspaceStateDigest, "current.provider.localResult.workspaceStateDigest");
	} else if (active.request.effectKind === "tool-action") {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"causeCode",
				"effectKind",
				"evidenceDigest",
				"nonEmptyDiff",
				"status",
				"toolRef",
				"workspaceStateAfterDigest",
				"workspaceStateBeforeDigest",
			],
			"current.provider.localResult",
		);
		if (candidate.toolRef !== active.request.toolRef)
			throw new TypeError("current provider tool result ref drifted");
		const status = oneOf(
			candidate.status,
			["succeeded", "failed"],
			"current.provider.localResult.status",
		);
		const before = digest(
			candidate.workspaceStateBeforeDigest,
			"current.provider.localResult.before",
		);
		const after = digest(candidate.workspaceStateAfterDigest, "current.provider.localResult.after");
		if (before !== workflowEffect.request.workspaceStateDigest)
			throw new TypeError("current provider tool result used stale workspace state");
		bool(candidate.nonEmptyDiff, "current.provider.localResult.nonEmptyDiff");
		if (status === "failed") {
			oneOf(
				candidate.causeCode,
				[
					"exact-replacement-unchanged",
					"exact-replacement-old-text-not-found",
					"exact-replacement-old-text-not-unique",
					"malformed-arguments",
					"unexpected-arguments",
					"path-not-allowed",
					"focused-validation-failed",
				],
				"current.provider.localResult.causeCode",
			);
			if (before !== after || candidate.nonEmptyDiff !== false)
				throw new TypeError("current provider rejected tool changed workspace state");
		} else if (candidate.causeCode !== null)
			throw new TypeError("current provider successful tool carried a rejection cause");
	} else if (active.request.effectKind === "public-semantic-validation") {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"criterionFailures",
				"effectKind",
				"evidenceDigest",
				"status",
				"workspaceStateDigest",
			],
			"current.provider.localResult",
		);
		const status = oneOf(
			candidate.status,
			["passed", "failed"],
			"current.provider.localResult.status",
		);
		const failures = array(
			candidate.criterionFailures,
			"current.provider.localResult.criterionFailures",
		);
		if (failures.length > 4)
			throw new TypeError("current provider criterion failure bound exceeded");
		for (const failure of failures)
			oneOf(
				failure,
				[
					"canonical-proposal-not-admitted",
					"malformed-provenance-not-rejected",
					"local-reconstruction-not-rejected",
					"authorization-claim-invariant-regressed",
				],
				"current.provider.localResult.criterionFailure",
			);
		if ((status === "passed") !== (failures.length === 0))
			throw new TypeError("current provider semantic result cardinality drifted");
		if (
			digest(
				candidate.workspaceStateDigest,
				"current.provider.localResult.workspaceStateDigest",
			) !== workflowEffect.request.workspaceStateDigest
		)
			throw new TypeError("current provider semantic result used stale workspace state");
	} else if (active.request.effectKind === "hidden-verifier") {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"effectKind",
				"evidenceDigest",
				"status",
				"workspaceStateDigest",
			],
			"current.provider.localResult",
		);
		oneOf(candidate.status, ["passed", "failed"], "current.provider.localResult.status");
		if (
			digest(
				candidate.workspaceStateDigest,
				"current.provider.localResult.workspaceStateDigest",
			) !== workflowEffect.request.workspaceStateDigest
		)
			throw new TypeError("current provider hidden verifier used stale workspace state");
	} else {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"effectKind",
				"evidenceDigest",
				"status",
				"workspaceStateDigest",
			],
			"current.provider.localResult",
		);
		oneOf(candidate.status, ["completed", "failed"], "current.provider.localResult.status");
		if (candidate.workspaceStateDigest !== null)
			digest(candidate.workspaceStateDigest, "current.provider.localResult.workspaceStateDigest");
	}
	return strictSnapshot({ ...candidate, actualElapsedMs: elapsed }) as Exclude<
		CurrentGraphEffectResultInputV1,
		{ effectKind: "provider-request" }
	>;
}

const activeOwners = new WeakMap<object, ProviderAuthorityState>();

function statesForActive(active: CurrentGraphProviderAdmittedEffectV1) {
	const state = activeOwners.get(active);
	if (state === undefined) throw new TypeError("current provider effect admission is forged");
	return state;
}

function actuals(result: CurrentGraphProviderResultProjectionV1) {
	if (result.effectKind === "provider-request")
		return { cost: result.usage.actualCostMicrousd, elapsed: result.usage.actualElapsedMs };
	return {
		cost: "actualCostMicrousd" in result ? result.actualCostMicrousd : 0,
		elapsed: result.actualElapsedMs,
	};
}

function reconcile(
	state: ProviderAuthorityState,
	request: CurrentGraphProviderRequestProjectionV1,
	result: CurrentGraphProviderResultProjectionV1,
) {
	const measured = actuals(result);
	const budgetAfter = Object.freeze({
		providerAttempts: state.budget.providerAttempts + request.reservation.providerAttempts,
		retryWaits: state.budget.retryWaits + request.reservation.retryWaits,
		confirmedCostMicrousd: state.budget.confirmedCostMicrousd + measured.cost,
		confirmedElapsedMs: state.budget.confirmedElapsedMs + measured.elapsed,
		effectFacts: state.budget.effectFacts + 1,
	});
	const material = strictSnapshot({
		budgetAfter,
		actualCostMicrousd: measured.cost,
		actualElapsedMs: measured.elapsed,
	});
	return Object.freeze({ ...material, reconciliationDigest: empiricalStrictJsonDigest(material) });
}

function toWorkflowResult(
	result: CurrentGraphEffectResultInputV1,
): CurrentGraphEffectResultInputV1 {
	return result;
}

function applyRuntimeFact(state: ProviderAuthorityState, fact: RuntimeAdmittedFact) {
	const { projection, rawResult } = fact;
	state.facts.push(projection);
	state.budget = projection.reconciliation.budgetAfter;
	if (projection.result.effectKind === "retry-wait") {
		if (projection.result.status !== "completed" || state.providerLogical === null) {
			const logical = state.providerLogical;
			if (logical === null) throw new TypeError("current provider retry state is missing");
			admitCurrentGraphEffectResult(state.workflow, logical.workflowEffect.request.requestDigest, {
				effectKind: "provider-request",
				status: "failed",
				disposition: null,
				toolIntents: [],
				failureCode: "provider-failed",
				evidenceDigest: empiricalStrictJsonDigest(logical.attemptFactDigests),
				actualCostMicrousd: logical.totalCostMicrousd,
				actualElapsedMs: logical.totalElapsedMs,
			});
			state.providerLogical = null;
			scheduleWorkflowEffect(state);
			return;
		}
		state.providerLogical.attemptOrdinal += 1;
		schedule(state, state.providerLogical.workflowEffect, {
			providerLogical: state.providerLogical,
		});
		return;
	}
	if (projection.result.effectKind === "provider-request") {
		const logical = state.providerLogical;
		if (logical === null) throw new TypeError("current provider logical request is missing");
		logical.totalCostMicrousd += projection.result.usage.actualCostMicrousd;
		logical.totalElapsedMs += projection.result.usage.actualElapsedMs;
		logical.attemptFactDigests.push(projection.factDigest);
		if (
			projection.result.status === "failed" &&
			projection.result.retryProposal !== null &&
			logical.attemptOrdinal === 1
		) {
			schedule(state, logical.workflowEffect, {
				providerLogical: logical,
				retryDelayMs: projection.result.retryProposal.retryAfterMs,
			});
			return;
		}
		const workflowResult: Extract<
			CurrentGraphEffectResultInputV1,
			{ effectKind: "provider-request" }
		> =
			projection.result.status === "completed"
				? {
						effectKind: "provider-request",
						status: "completed",
						disposition: "tool-intents",
						toolIntents: projection.result.toolCalls.map((call) => call.toolRef),
						failureCode: null,
						evidenceDigest: empiricalStrictJsonDigest(logical.attemptFactDigests),
						actualCostMicrousd: logical.totalCostMicrousd,
						actualElapsedMs: logical.totalElapsedMs,
					}
				: {
						effectKind: "provider-request",
						status: "failed",
						disposition: null,
						toolIntents: [],
						failureCode:
							projection.result.failureCode === "mutation-proposal-cardinality" ||
							projection.result.failureCode === "mutation-proposal-content"
								? projection.result.failureCode
								: "provider-failed",
						evidenceDigest: empiricalStrictJsonDigest(logical.attemptFactDigests),
						actualCostMicrousd: logical.totalCostMicrousd,
						actualElapsedMs: logical.totalElapsedMs,
					};
		admitCurrentGraphEffectResult(
			state.workflow,
			logical.workflowEffect.request.requestDigest,
			workflowResult,
		);
		const admittedWorkflowEffect = takeCurrentGraphAdmittedEffect(state.workflow);
		if (
			projection.result.status === "completed" &&
			admittedWorkflowEffect?.request.effectKind === "tool-action"
		) {
			const raw = rawResult as Extract<
				CurrentGraphProviderEffectResultInputV1,
				{ effectKind: "provider-request" }
			>;
			state.pendingToolArguments = [...raw.toolCalls];
		} else {
			state.pendingToolArguments = [];
		}
		state.providerLogical = null;
		scheduleWorkflowEffect(state);
		return;
	}
	const workflowEffect = takeCurrentGraphAdmittedEffect(state.workflow);
	if (
		workflowEffect === null ||
		workflowEffect.request.requestDigest !== projection.request.sourceWorkflowRequestDigest
	)
		throw new TypeError("current provider local fact lost its workflow request");
	if (rawResult.effectKind === "tool-action" && rawResult.status === "failed")
		state.pendingToolArguments = [];
	admitCurrentGraphEffectResult(
		state.workflow,
		workflowEffect.request.requestDigest,
		toWorkflowResult(rawResult as CurrentGraphEffectResultInputV1),
	);
	scheduleWorkflowEffect(state);
}

export function createCurrentGraphProviderAuthority(inputValue: {
	readonly limits: CurrentGraphProviderBudgetLimitsV1;
	readonly routeProfile: CurrentGraphProviderRouteProfileV1;
	readonly taskProfile: CurrentGraphProviderTaskProfileV1;
}): CurrentGraphProviderAuthorityV1 {
	const input = record(inputValue, "current.provider.authority");
	exactKeys(input, ["limits", "routeProfile", "taskProfile"], "current.provider.authority");
	const limits = validateLimits(input.limits);
	const route = validateRouteProfile(input.routeProfile);
	const task = validateTaskProfile(input.taskProfile);
	const owner = graph({ name: "current/d6/provider/graph-native-eval" });
	const runtimeFactNode = createRuntimeFactNode(owner);
	const projectionNode = owner.node<RuntimeAdmittedFact>(
		[runtimeFactNode],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) ctx.down([["DATA", fact]]);
		},
		{
			name: "current/d6/provider/canonical-projection",
			factory: "currentProviderCanonicalProjection",
		},
	);
	const capability = Object.freeze({ revision: CURRENT_GRAPH_PROVIDER_REVISION });
	const state: ProviderAuthorityState = {
		owner,
		runtimeFactNode,
		workflow: createCurrentGraphNativeEvalAuthority({ limits: workflowLimitsFor(limits) }),
		limits,
		route,
		task,
		facts: [],
		budget: ZERO_BUDGET,
		active: null,
		nextSequence: 0,
		providerLogical: null,
		pendingToolArguments: [],
		finished: false,
	};
	projectionNode.subscribe((message) => {
		if (message[0] === "DATA") applyRuntimeFact(state, message[1] as RuntimeAdmittedFact);
	});
	states.set(capability, state);
	scheduleWorkflowEffect(state);
	return capability;
}

function stateFor(value: unknown) {
	if (value === null || typeof value !== "object")
		throw new TypeError("current provider Graph authority must be an object");
	const state = states.get(value);
	if (state === undefined) throw new TypeError("current provider Graph authority is forged");
	return state;
}

export function takeCurrentGraphProviderEffect(
	authority: CurrentGraphProviderAuthorityV1,
): CurrentGraphProviderAdmittedEffectV1 | null {
	const state = stateFor(authority);
	const active = state.active;
	if (active !== null) activeOwners.set(active, state);
	return active;
}

export function admitCurrentGraphProviderEffectResult(
	authority: CurrentGraphProviderAuthorityV1,
	requestDigestValue: string,
	resultValue: unknown,
): CurrentGraphProviderFactV1 {
	const state = stateFor(authority);
	const active = state.active;
	if (active === null) throw new TypeError("current provider Graph has no active effect");
	if (digest(requestDigestValue, "current.provider.requestDigest") !== active.request.requestDigest)
		throw new TypeError("current provider result does not match the active request");
	let rawResult: CurrentGraphProviderEffectResultInputV1;
	let result: CurrentGraphProviderResultProjectionV1;
	if (active.request.effectKind === "provider-request") {
		const validated = validateProviderResult(resultValue, active.request);
		rawResult = validated.raw;
		result = validated.projection;
	} else {
		const local = validateLocalResult(resultValue, active);
		rawResult = local;
		result = local;
		const measured = actuals(result);
		if (
			measured.cost > active.request.reservation.maxCostMicrousd ||
			measured.elapsed > active.request.reservation.maxElapsedMs
		)
			throw new TypeError("current provider local result exceeded its Graph reservation");
	}
	state.active = null;
	const reconciliation = reconcile(state, active.request, result);
	const material = strictSnapshot({
		sequence: state.facts.length,
		arm: active.request.arm,
		runSequence: active.request.runSequence,
		request: active.request,
		admission: active.admission,
		result,
		reconciliation,
	});
	const projection = Object.freeze({
		...material,
		factDigest: empiricalStrictJsonDigest(material),
	}) as CurrentGraphProviderFactV1;
	state.runtimeFactNode.down([["DATA", Object.freeze({ projection, rawResult })]]);
	return projection;
}

function topology() {
	const material = strictSnapshot({
		runtimeFactNode: "current/d6/provider/runtime-facts" as const,
		canonicalProjectionNode: "current/d6/provider/canonical-projection" as const,
	});
	return Object.freeze({ ...material, topologyDigest: empiricalStrictJsonDigest(material) });
}

function d5Baseline() {
	return Object.freeze({
		commit: "892e68db6882e7b1b119c9cbccc329b1e962db93" as const,
		bundleArtifactDigest:
			"sha256:a6463d782d610ab68460486c92971f48463ce4bc9af580baa4d8239fa083747c" as const,
		implementationManifestDigest:
			"sha256:10d7f8202c1317bbb752b644b8b1564b9ab0cc2ab437df7a164b5105921c492f" as const,
	});
}

function evidenceMaterial(state: ProviderAuthorityState) {
	const workflowEvidence = snapshotCurrentGraphNativeEvidence(state.workflow);
	return strictSnapshot({
		schemaVersion: CURRENT_GRAPH_PROVIDER_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D6" as const,
		d5Baseline: d5Baseline(),
		topology: topology(),
		routeProfile: state.route,
		taskProfileDigest: state.task.taskProfileDigest,
		limits: state.limits,
		facts: state.facts,
		workflowEvidence,
		budget: state.budget,
		runStatus: workflowEvidence.runStatus,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
}

export function snapshotCurrentGraphProviderEvidence(
	authority: CurrentGraphProviderAuthorityV1,
): CurrentGraphProviderEvidenceV1 {
	const state = stateFor(authority);
	if (!state.finished || state.active !== null)
		throw new TypeError("current provider Graph evidence is unfinished");
	const material = evidenceMaterial(state);
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

function validateBudget(value: unknown, path: string): CurrentGraphProviderBudgetStateV1 {
	const candidate = record(value, path);
	exactKeys(
		candidate,
		[
			"confirmedCostMicrousd",
			"confirmedElapsedMs",
			"effectFacts",
			"providerAttempts",
			"retryWaits",
		],
		path,
	);
	for (const key of Object.keys(candidate))
		safeInteger(candidate[key], `${path}.${key}`, { min: 0 });
	return strictSnapshot(candidate) as unknown as CurrentGraphProviderBudgetStateV1;
}

function validateFactShape(value: unknown, index: number): CurrentGraphProviderFactV1 {
	const path = `current.provider.evidence.facts[${index}]`;
	const candidate = record(value, path);
	exactKeys(
		candidate,
		[
			"admission",
			"arm",
			"factDigest",
			"reconciliation",
			"request",
			"result",
			"runSequence",
			"sequence",
		],
		path,
	);
	if (candidate.sequence !== index) throw new TypeError("current provider fact sequence drifted");
	oneOf(candidate.arm, CURRENT_GRAPH_ARMS, `${path}.arm`);
	safeInteger(candidate.runSequence, `${path}.runSequence`, { min: 0, max: 5 });
	const request = record(candidate.request, `${path}.request`);
	exactKeys(
		request,
		[
			"arm",
			"attemptOrdinal",
			"effectKind",
			"logicalRequestDigest",
			"requestDigest",
			"reservation",
			"retryDelayMs",
			"routeDigest",
			"runSequence",
			"schemaVersion",
			"sequence",
			"sourceWorkflowEffectKind",
			"sourceWorkflowRequestDigest",
			"taskEnvelopeDigest",
			"toolArgumentsBytes",
			"toolArgumentsDigest",
			"toolRef",
			"workspaceStateDigest",
		],
		`${path}.request`,
	);
	if (
		request.schemaVersion !== "graphrefly-ts.d6.current-graph-native-effect-request.v1" ||
		request.sequence !== index ||
		request.arm !== candidate.arm ||
		request.runSequence !== candidate.runSequence
	)
		throw new TypeError("current provider fact request coordinates drifted");
	const effectKind = oneOf(request.effectKind, EFFECT_KINDS, `${path}.request.effectKind`);
	oneOf(
		request.sourceWorkflowEffectKind,
		[
			"materialization",
			"provider-request",
			"tool-action",
			"public-semantic-validation",
			"hidden-verifier",
			"cleanup",
		],
		`${path}.request.sourceWorkflowEffectKind`,
	);
	digest(request.sourceWorkflowRequestDigest, `${path}.request.sourceWorkflowRequestDigest`);
	digest(request.requestDigest, `${path}.request.requestDigest`);
	if (request.workspaceStateDigest !== null)
		digest(request.workspaceStateDigest, `${path}.request.workspaceStateDigest`);
	safeInteger(request.retryDelayMs, `${path}.request.retryDelayMs`, { min: 0, max: 60_000 });
	const toolArgumentsBytes = safeInteger(
		request.toolArgumentsBytes,
		`${path}.request.toolArgumentsBytes`,
		{
			min: 0,
			max: 65_536,
		},
	);
	const reserved = record(request.reservation, `${path}.request.reservation`);
	exactKeys(
		reserved,
		["maxCostMicrousd", "maxElapsedMs", "providerAttempts", "retryWaits"],
		`${path}.request.reservation`,
	);
	for (const key of Object.keys(reserved))
		safeInteger(reserved[key], `${path}.request.reservation.${key}`, { min: 0 });
	if (effectKind === "provider-request" || effectKind === "retry-wait") {
		digest(request.routeDigest, `${path}.request.routeDigest`);
		digest(request.taskEnvelopeDigest, `${path}.request.taskEnvelopeDigest`);
		digest(request.logicalRequestDigest, `${path}.request.logicalRequestDigest`);
		safeInteger(request.attemptOrdinal, `${path}.request.attemptOrdinal`, { min: 1, max: 2 });
		if (
			request.sourceWorkflowEffectKind !== "provider-request" ||
			request.toolRef !== null ||
			request.toolArgumentsDigest !== null ||
			request.toolArgumentsBytes !== 0
		)
			throw new TypeError("current provider request material cardinality drifted");
		if (
			(effectKind === "provider-request" &&
				(request.retryDelayMs !== 0 ||
					reserved.providerAttempts !== 1 ||
					reserved.retryWaits !== 0)) ||
			(effectKind === "retry-wait" &&
				(reserved.providerAttempts !== 0 || reserved.retryWaits !== 1))
		)
			throw new TypeError("current provider retry reservation cardinality drifted");
	} else {
		if (
			request.routeDigest !== null ||
			request.taskEnvelopeDigest !== null ||
			request.logicalRequestDigest !== null ||
			request.attemptOrdinal !== null ||
			request.retryDelayMs !== 0 ||
			reserved.providerAttempts !== 0 ||
			reserved.retryWaits !== 0 ||
			reserved.maxCostMicrousd !== 0
		)
			throw new TypeError("current provider local request material cardinality drifted");
		if (effectKind === "tool-action") {
			oneOf(request.toolRef, TOOL_REFS, `${path}.request.toolRef`);
			digest(request.toolArgumentsDigest, `${path}.request.toolArgumentsDigest`);
			if (toolArgumentsBytes < 1 || request.workspaceStateDigest === null)
				throw new TypeError("current provider tool request arguments are missing");
		} else if (
			request.toolRef !== null ||
			request.toolArgumentsDigest !== null ||
			request.toolArgumentsBytes !== 0
		)
			throw new TypeError("current provider non-tool request carried tool arguments");
	}
	const admission = record(candidate.admission, `${path}.admission`);
	exactKeys(
		admission,
		[
			"admitted",
			"budgetBefore",
			"decisionDigest",
			"prospectiveBudget",
			"requestDigest",
			"schemaVersion",
		],
		`${path}.admission`,
	);
	if (
		admission.schemaVersion !== "graphrefly-ts.d6.current-graph-native-effect-admission.v1" ||
		admission.admitted !== true ||
		admission.requestDigest !== request.requestDigest
	)
		throw new TypeError("current provider fact admission coordinates drifted");
	validateBudget(admission.budgetBefore, `${path}.admission.budgetBefore`);
	validateBudget(admission.prospectiveBudget, `${path}.admission.prospectiveBudget`);
	digest(admission.decisionDigest, `${path}.admission.decisionDigest`);
	const reconciliation = record(candidate.reconciliation, `${path}.reconciliation`);
	exactKeys(
		reconciliation,
		["actualCostMicrousd", "actualElapsedMs", "budgetAfter", "reconciliationDigest"],
		`${path}.reconciliation`,
	);
	safeInteger(reconciliation.actualCostMicrousd, `${path}.reconciliation.actualCostMicrousd`, {
		min: 0,
	});
	safeInteger(reconciliation.actualElapsedMs, `${path}.reconciliation.actualElapsedMs`, { min: 0 });
	validateBudget(reconciliation.budgetAfter, `${path}.reconciliation.budgetAfter`);
	digest(reconciliation.reconciliationDigest, `${path}.reconciliation.reconciliationDigest`);
	validateResultProjection(candidate.result, effectKind, path);
	digest(candidate.factDigest, `${path}.factDigest`);
	if (canonicalBytes(candidate) > 131_072)
		throw new TypeError("current provider canonical fact exceeded its byte bound");
	const material = { ...candidate };
	delete material.factDigest;
	if (empiricalStrictJsonDigest(material) !== candidate.factDigest)
		throw new TypeError("current provider fact digest drifted");
	return strictSnapshot(candidate) as unknown as CurrentGraphProviderFactV1;
}

function validateResultProjection(
	value: unknown,
	effectKind: CurrentGraphProviderEffectKind,
	factPath: string,
): void {
	const path = `${factPath}.result`;
	const candidate = record(value, path);
	if (candidate.effectKind !== effectKind)
		throw new TypeError("current provider fact result kind drifted");
	digest(candidate.evidenceDigest, `${path}.evidenceDigest`);
	if (effectKind === "provider-request") {
		exactKeys(
			candidate,
			[
				"effectKind",
				"evidenceDigest",
				"failureCode",
				"retryProposal",
				"status",
				"toolCalls",
				"usage",
			],
			path,
		);
		const status = oneOf(candidate.status, ["completed", "failed"], `${path}.status`);
		const calls = array(candidate.toolCalls, `${path}.toolCalls`);
		if (calls.length > 4) throw new TypeError("current provider projected tool call bound drifted");
		for (let index = 0; index < calls.length; index += 1) {
			const call = record(calls[index], `${path}.toolCalls[${index}]`);
			exactKeys(
				call,
				["argumentsBytes", "argumentsDigest", "toolRef"],
				`${path}.toolCalls[${index}]`,
			);
			oneOf(call.toolRef, TOOL_REFS, `${path}.toolCalls[${index}].toolRef`);
			digest(call.argumentsDigest, `${path}.toolCalls[${index}].argumentsDigest`);
			safeInteger(call.argumentsBytes, `${path}.toolCalls[${index}].argumentsBytes`, {
				min: 1,
				max: 65_536,
			});
		}
		const usage = record(candidate.usage, `${path}.usage`);
		exactKeys(
			usage,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"cacheReadTokens",
				"costBasis",
				"inputTokens",
				"outputTokens",
				"requests",
			],
			`${path}.usage`,
		);
		if (usage.requests !== 1) throw new TypeError("current provider projected usage drifted");
		for (const key of [
			"actualCostMicrousd",
			"actualElapsedMs",
			"cacheReadTokens",
			"inputTokens",
			"outputTokens",
		] as const)
			safeInteger(usage[key], `${path}.usage.${key}`, { min: 0 });
		oneOf(usage.costBasis, ["reported", "conservative-reservation"], `${path}.usage.costBasis`);
		if (status === "completed") {
			if (calls.length === 0 || candidate.failureCode !== null || candidate.retryProposal !== null)
				throw new TypeError("current provider projected completion cardinality drifted");
		} else {
			if (calls.length !== 0)
				throw new TypeError("current provider projected failure carried tool calls");
			oneOf(
				candidate.failureCode,
				[
					"retryable-transient",
					"provider-failed",
					"mutation-proposal-cardinality",
					"mutation-proposal-content",
				],
				`${path}.failureCode`,
			);
			if (candidate.failureCode === "retryable-transient") {
				const retry = record(candidate.retryProposal, `${path}.retryProposal`);
				exactKeys(retry, ["proposalDigest", "retryAfterMs", "retryClass"], `${path}.retryProposal`);
				if (retry.retryClass !== "retryable-transient")
					throw new TypeError("current provider projected retry class drifted");
				safeInteger(retry.retryAfterMs, `${path}.retryProposal.retryAfterMs`, {
					min: 0,
					max: 60_000,
				});
				digest(retry.proposalDigest, `${path}.retryProposal.proposalDigest`);
			} else if (candidate.retryProposal !== null)
				throw new TypeError("current provider terminal failure proposed retry");
		}
		return;
	}
	if (effectKind === "retry-wait") {
		exactKeys(candidate, ["actualElapsedMs", "effectKind", "evidenceDigest", "status"], path);
		oneOf(candidate.status, ["completed", "failed"], `${path}.status`);
		safeInteger(candidate.actualElapsedMs, `${path}.actualElapsedMs`, { min: 0, max: 60_000 });
		return;
	}
	const exactByKind: Record<
		Exclude<CurrentGraphProviderEffectKind, "provider-request" | "retry-wait">,
		readonly string[]
	> = {
		materialization: [
			"actualCostMicrousd",
			"actualElapsedMs",
			"effectKind",
			"evidenceDigest",
			"status",
			"workspaceStateDigest",
		],
		"tool-action": [
			"actualCostMicrousd",
			"actualElapsedMs",
			"causeCode",
			"effectKind",
			"evidenceDigest",
			"nonEmptyDiff",
			"status",
			"toolRef",
			"workspaceStateAfterDigest",
			"workspaceStateBeforeDigest",
		],
		"public-semantic-validation": [
			"actualCostMicrousd",
			"actualElapsedMs",
			"criterionFailures",
			"effectKind",
			"evidenceDigest",
			"status",
			"workspaceStateDigest",
		],
		"hidden-verifier": [
			"actualCostMicrousd",
			"actualElapsedMs",
			"effectKind",
			"evidenceDigest",
			"status",
			"workspaceStateDigest",
		],
		cleanup: [
			"actualCostMicrousd",
			"actualElapsedMs",
			"effectKind",
			"evidenceDigest",
			"status",
			"workspaceStateDigest",
		],
	};
	exactKeys(candidate, exactByKind[effectKind], path);
	if (candidate.actualCostMicrousd !== 0)
		throw new TypeError("current provider projected local cost drifted");
	safeInteger(candidate.actualElapsedMs, `${path}.actualElapsedMs`, { min: 0 });
	if (effectKind === "materialization" || effectKind === "cleanup")
		oneOf(candidate.status, ["completed", "failed"], `${path}.status`);
	else if (effectKind === "tool-action") {
		oneOf(candidate.status, ["succeeded", "failed"], `${path}.status`);
		oneOf(candidate.toolRef, TOOL_REFS, `${path}.toolRef`);
		bool(candidate.nonEmptyDiff, `${path}.nonEmptyDiff`);
		digest(candidate.workspaceStateBeforeDigest, `${path}.workspaceStateBeforeDigest`);
		digest(candidate.workspaceStateAfterDigest, `${path}.workspaceStateAfterDigest`);
	} else if (effectKind === "public-semantic-validation") {
		oneOf(candidate.status, ["passed", "failed"], `${path}.status`);
		const failures = array(candidate.criterionFailures, `${path}.criterionFailures`);
		if (failures.length > 4)
			throw new TypeError("current provider projected criterion bound drifted");
		for (const failure of failures)
			oneOf(
				failure,
				[
					"canonical-proposal-not-admitted",
					"malformed-provenance-not-rejected",
					"local-reconstruction-not-rejected",
					"authorization-claim-invariant-regressed",
				],
				`${path}.criterionFailure`,
			);
	} else oneOf(candidate.status, ["passed", "failed"], `${path}.status`);
	if ("workspaceStateDigest" in candidate && candidate.workspaceStateDigest !== null)
		digest(candidate.workspaceStateDigest, `${path}.workspaceStateDigest`);
}

function replayProviderEvidence(
	value: CurrentGraphProviderEvidenceV1,
): CurrentGraphNativeEvidenceV1 {
	type RetryReplayState = Readonly<{
		logicalRequestDigest: string;
		routeDigest: string;
		taskEnvelopeDigest: string;
		sourceWorkflowRequestDigest: string;
		retryAfterMs: number;
		waitObserved: boolean;
	}>;
	const requireRetry = (candidate: RetryReplayState | null): RetryReplayState => {
		if (candidate === null) throw new TypeError("current provider replay retry state is missing");
		return candidate;
	};
	const workflow = createCurrentGraphNativeEvalAuthority({
		limits: workflowLimitsFor(value.limits),
	});
	let budget: CurrentGraphProviderBudgetStateV1 = ZERO_BUDGET;
	let providerLogical: {
		workflowEffect: CurrentGraphAdmittedEffectV1;
		logicalRequestDigest: string;
		cost: number;
		elapsed: number;
		factDigests: string[];
	} | null = null;
	let pendingTools: CurrentGraphProviderToolRef[] = [];
	let pendingRetry: RetryReplayState | null = null;
	for (const fact of value.facts) {
		const workflowEffect = takeCurrentGraphAdmittedEffect(workflow);
		if (workflowEffect === null) throw new TypeError("current provider replay has surplus facts");
		if (fact.request.sourceWorkflowRequestDigest !== workflowEffect.request.requestDigest)
			throw new TypeError("current provider replay workflow request drifted");
		if (
			fact.request.arm !== workflowEffect.request.arm ||
			fact.request.runSequence !== workflowEffect.request.runSequence ||
			fact.request.sourceWorkflowEffectKind !== workflowEffect.request.effectKind
		)
			throw new TypeError("current provider replay workflow coordinates drifted");
		const requestMaterial = { ...fact.request } as Record<string, unknown>;
		delete requestMaterial.requestDigest;
		if (empiricalStrictJsonDigest(requestMaterial) !== fact.request.requestDigest)
			throw new TypeError("current provider replay request digest drifted");
		const expectedProspective = Object.freeze({
			providerAttempts: budget.providerAttempts + fact.request.reservation.providerAttempts,
			retryWaits: budget.retryWaits + fact.request.reservation.retryWaits,
			confirmedCostMicrousd:
				budget.confirmedCostMicrousd + fact.request.reservation.maxCostMicrousd,
			confirmedElapsedMs: budget.confirmedElapsedMs + fact.request.reservation.maxElapsedMs,
			effectFacts: budget.effectFacts + 1,
		});
		if (
			expectedProspective.providerAttempts > value.limits.maxProviderAttempts ||
			expectedProspective.retryWaits > value.limits.maxRetryWaits ||
			expectedProspective.confirmedCostMicrousd > value.limits.maxCostMicrousd ||
			expectedProspective.confirmedElapsedMs > value.limits.maxElapsedMs ||
			expectedProspective.effectFacts > value.limits.maxEffectFacts
		)
			throw new TypeError("current provider replay exceeded an admitted budget limit");
		const admissionMaterial = strictSnapshot({
			schemaVersion: "graphrefly-ts.d6.current-graph-native-effect-admission.v1" as const,
			requestDigest: fact.request.requestDigest,
			admitted: true as const,
			budgetBefore: budget,
			prospectiveBudget: expectedProspective,
		});
		if (
			empiricalStrictJsonDigest(admissionMaterial) !== fact.admission.decisionDigest ||
			empiricalStrictJsonDigest(fact.admission.budgetBefore) !==
				empiricalStrictJsonDigest(budget) ||
			empiricalStrictJsonDigest(fact.admission.prospectiveBudget) !==
				empiricalStrictJsonDigest(expectedProspective)
		)
			throw new TypeError("current provider replay admission drifted");
		const measured = actuals(fact.result);
		if (
			measured.cost > fact.request.reservation.maxCostMicrousd ||
			measured.elapsed > fact.request.reservation.maxElapsedMs
		)
			throw new TypeError("current provider replay result exceeded its reservation");
		const expectedBudgetAfter = Object.freeze({
			providerAttempts: budget.providerAttempts + fact.request.reservation.providerAttempts,
			retryWaits: budget.retryWaits + fact.request.reservation.retryWaits,
			confirmedCostMicrousd: budget.confirmedCostMicrousd + measured.cost,
			confirmedElapsedMs: budget.confirmedElapsedMs + measured.elapsed,
			effectFacts: budget.effectFacts + 1,
		});
		const reconciliationMaterial = strictSnapshot({
			budgetAfter: expectedBudgetAfter,
			actualCostMicrousd: measured.cost,
			actualElapsedMs: measured.elapsed,
		});
		if (
			empiricalStrictJsonDigest(reconciliationMaterial) !==
				fact.reconciliation.reconciliationDigest ||
			empiricalStrictJsonDigest(fact.reconciliation.budgetAfter) !==
				empiricalStrictJsonDigest(expectedBudgetAfter)
		)
			throw new TypeError("current provider replay reconciliation drifted");
		budget = expectedBudgetAfter;
		if (fact.result.effectKind === "retry-wait") {
			const retry = requireRetry(pendingRetry);
			if (
				providerLogical === null ||
				retry.waitObserved ||
				fact.result.status !== "completed" ||
				fact.request.attemptOrdinal !== 1 ||
				fact.request.logicalRequestDigest !== retry.logicalRequestDigest ||
				fact.request.routeDigest !== retry.routeDigest ||
				fact.request.taskEnvelopeDigest !== retry.taskEnvelopeDigest ||
				fact.request.sourceWorkflowRequestDigest !== retry.sourceWorkflowRequestDigest ||
				fact.request.retryDelayMs !== retry.retryAfterMs
			)
				throw new TypeError("current provider replay retry wait drifted");
			pendingRetry = Object.freeze({
				logicalRequestDigest: retry.logicalRequestDigest,
				routeDigest: retry.routeDigest,
				taskEnvelopeDigest: retry.taskEnvelopeDigest,
				sourceWorkflowRequestDigest: retry.sourceWorkflowRequestDigest,
				retryAfterMs: retry.retryAfterMs,
				waitObserved: true,
			});
			continue;
		}
		if (fact.result.effectKind === "provider-request") {
			if (providerLogical === null) {
				if (fact.request.attemptOrdinal !== 1 || pendingRetry !== null)
					throw new TypeError("current provider replay initial attempt ordinal drifted");
				providerLogical = {
					workflowEffect,
					logicalRequestDigest: fact.request.logicalRequestDigest ?? "",
					cost: 0,
					elapsed: 0,
					factDigests: [],
				};
			} else if (
				providerLogical.logicalRequestDigest !== fact.request.logicalRequestDigest ||
				pendingRetry === null ||
				!pendingRetry.waitObserved ||
				fact.request.attemptOrdinal !== 2 ||
				fact.request.routeDigest !== pendingRetry.routeDigest ||
				fact.request.taskEnvelopeDigest !== pendingRetry.taskEnvelopeDigest ||
				fact.request.sourceWorkflowRequestDigest !== pendingRetry.sourceWorkflowRequestDigest
			)
				throw new TypeError("current provider replay logical request drifted across retry");
			providerLogical.cost += fact.result.usage.actualCostMicrousd;
			providerLogical.elapsed += fact.result.usage.actualElapsedMs;
			providerLogical.factDigests.push(fact.factDigest);
			if (
				fact.result.status === "failed" &&
				fact.result.retryProposal !== null &&
				fact.request.attemptOrdinal === 1
			) {
				if (pendingRetry !== null)
					throw new TypeError("current provider replay admitted an extra retry");
				const expectedProposal = empiricalStrictJsonDigest({
					retryClass: fact.result.retryProposal.retryClass,
					retryAfterMs: fact.result.retryProposal.retryAfterMs,
					requestDigest: fact.request.requestDigest,
					logicalRequestDigest: fact.request.logicalRequestDigest,
				});
				if (fact.result.retryProposal.proposalDigest !== expectedProposal)
					throw new TypeError("current provider replay retry proposal drifted");
				pendingRetry = Object.freeze({
					logicalRequestDigest: fact.request.logicalRequestDigest ?? "",
					routeDigest: fact.request.routeDigest ?? "",
					taskEnvelopeDigest: fact.request.taskEnvelopeDigest ?? "",
					sourceWorkflowRequestDigest: fact.request.sourceWorkflowRequestDigest,
					retryAfterMs: fact.result.retryProposal.retryAfterMs,
					waitObserved: false,
				});
				continue;
			}
			if (pendingRetry !== null && !pendingRetry.waitObserved)
				throw new TypeError("current provider replay skipped its admitted retry wait");
			const workflowResult: Extract<
				CurrentGraphEffectResultInputV1,
				{ effectKind: "provider-request" }
			> =
				fact.result.status === "completed"
					? {
							effectKind: "provider-request",
							status: "completed",
							disposition: "tool-intents",
							toolIntents: fact.result.toolCalls.map((call) => call.toolRef),
							failureCode: null,
							evidenceDigest: empiricalStrictJsonDigest(providerLogical.factDigests),
							actualCostMicrousd: providerLogical.cost,
							actualElapsedMs: providerLogical.elapsed,
						}
					: {
							effectKind: "provider-request",
							status: "failed",
							disposition: null,
							toolIntents: [],
							failureCode:
								fact.result.failureCode === "mutation-proposal-cardinality" ||
								fact.result.failureCode === "mutation-proposal-content"
									? fact.result.failureCode
									: "provider-failed",
							evidenceDigest: empiricalStrictJsonDigest(providerLogical.factDigests),
							actualCostMicrousd: providerLogical.cost,
							actualElapsedMs: providerLogical.elapsed,
						};
			pendingTools =
				fact.result.status === "completed" ? fact.result.toolCalls.map((call) => call.toolRef) : [];
			admitCurrentGraphEffectResult(workflow, workflowEffect.request.requestDigest, workflowResult);
			providerLogical = null;
			pendingRetry = null;
			continue;
		}
		if (workflowEffect.request.effectKind === "tool-action") {
			const expected = pendingTools.shift();
			if (expected !== workflowEffect.request.toolRef || expected !== fact.request.toolRef)
				throw new TypeError("current provider replay tool order drifted");
		}
		admitCurrentGraphEffectResult(
			workflow,
			workflowEffect.request.requestDigest,
			fact.result as CurrentGraphEffectResultInputV1,
		);
	}
	if (providerLogical !== null || pendingRetry !== null)
		throw new TypeError("current provider replay ended mid-request");
	return snapshotCurrentGraphNativeEvidence(workflow);
}

export function validateCurrentGraphProviderEvidence(
	value: unknown,
): CurrentGraphProviderEvidenceV1 {
	const candidate = record(value, "current.provider.evidence");
	exactKeys(
		candidate,
		[
			"budget",
			"causalAttribution",
			"d5Baseline",
			"decisionRef",
			"efficacyClaim",
			"evidenceDigest",
			"facts",
			"limits",
			"routeProfile",
			"runStatus",
			"schemaVersion",
			"taskProfileDigest",
			"topology",
			"workflowEvidence",
		],
		"current.provider.evidence",
	);
	if (
		candidate.schemaVersion !== CURRENT_GRAPH_PROVIDER_EVIDENCE_SCHEMA ||
		candidate.decisionRef !== "graphrefly-ts:D6" ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none"
	)
		throw new TypeError("current provider evidence coordinates drifted");
	const baseline = record(candidate.d5Baseline, "current.provider.evidence.d5Baseline");
	exactKeys(
		baseline,
		["bundleArtifactDigest", "commit", "implementationManifestDigest"],
		"current.provider.evidence.d5Baseline",
	);
	if (empiricalStrictJsonDigest(baseline) !== empiricalStrictJsonDigest(d5Baseline()))
		throw new TypeError("current provider D5 baseline drifted");
	const topologyValue = record(candidate.topology, "current.provider.evidence.topology");
	exactKeys(
		topologyValue,
		["canonicalProjectionNode", "runtimeFactNode", "topologyDigest"],
		"current.provider.evidence.topology",
	);
	const expectedTopology = topology();
	if (empiricalStrictJsonDigest(topologyValue) !== empiricalStrictJsonDigest(expectedTopology))
		throw new TypeError("current provider topology drifted");
	const routeProfile = validateRouteProfile(candidate.routeProfile);
	const limits = validateLimits(candidate.limits);
	const rawFacts = array(candidate.facts, "current.provider.evidence.facts");
	if (rawFacts.length === 0 || rawFacts.length > limits.maxEffectFacts)
		throw new TypeError("current provider evidence fact bound drifted");
	const facts = rawFacts.map(validateFactShape);
	const bounded = strictSnapshot({
		...candidate,
		routeProfile,
		limits,
		facts,
	}) as unknown as CurrentGraphProviderEvidenceV1;
	const replayedWorkflow = validateCurrentGraphNativeEvidence(replayProviderEvidence(bounded));
	const suppliedWorkflow = validateCurrentGraphNativeEvidence(candidate.workflowEvidence);
	if (replayedWorkflow.evidenceDigest !== suppliedWorkflow.evidenceDigest)
		throw new TypeError("current provider workflow replay drifted");
	const budget = validateBudget(candidate.budget, "current.provider.evidence.budget");
	const finalBudget = facts.at(-1)?.reconciliation.budgetAfter;
	if (
		finalBudget === undefined ||
		empiricalStrictJsonDigest(finalBudget) !== empiricalStrictJsonDigest(budget)
	)
		throw new TypeError("current provider final budget drifted");
	const material = strictSnapshot({
		schemaVersion: CURRENT_GRAPH_PROVIDER_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D6" as const,
		d5Baseline: d5Baseline(),
		topology: expectedTopology,
		routeProfile,
		taskProfileDigest: digest(candidate.taskProfileDigest, "current.provider.taskProfileDigest"),
		limits,
		facts,
		workflowEvidence: suppliedWorkflow,
		budget,
		runStatus: suppliedWorkflow.runStatus,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	if (candidate.runStatus !== suppliedWorkflow.runStatus)
		throw new TypeError("current provider run status drifted");
	const validated = Object.freeze({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	});
	if (candidate.evidenceDigest !== validated.evidenceDigest)
		throw new TypeError("current provider evidence digest drifted");
	return validated;
}

export async function runCurrentGraphProviderEval(inputValue: {
	readonly limits: CurrentGraphProviderBudgetLimitsV1;
	readonly routeProfile: CurrentGraphProviderRouteProfileV1;
	readonly taskProfile: CurrentGraphProviderTaskProfileV1;
	readonly execute: (
		effect: CurrentGraphProviderAdmittedEffectV1,
	) => Promise<CurrentGraphProviderEffectResultInputV1>;
}): Promise<CurrentGraphProviderEvidenceV1> {
	const input = record(inputValue, "current.provider.run");
	exactKeys(input, ["execute", "limits", "routeProfile", "taskProfile"], "current.provider.run");
	if (typeof input.execute !== "function")
		throw new TypeError("current provider executor is invalid");
	const authority = createCurrentGraphProviderAuthority({
		limits: validateLimits(input.limits),
		routeProfile: validateRouteProfile(input.routeProfile),
		taskProfile: validateTaskProfile(input.taskProfile),
	});
	for (
		let guard = 0;
		guard < CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS.maxEffectFacts;
		guard += 1
	) {
		const effect = takeCurrentGraphProviderEffect(authority);
		if (effect === null) return snapshotCurrentGraphProviderEvidence(authority);
		const result = await (
			input.execute as (
				effect: CurrentGraphProviderAdmittedEffectV1,
			) => Promise<CurrentGraphProviderEffectResultInputV1>
		)(effect);
		admitCurrentGraphProviderEffectResult(authority, effect.request.requestDigest, result);
	}
	throw new TypeError("current provider Graph eval exceeded its effect bound");
}
