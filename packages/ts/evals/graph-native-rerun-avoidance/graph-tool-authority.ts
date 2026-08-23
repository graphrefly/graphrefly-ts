import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import {
	array,
	boolean,
	coordinate,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	admitD43EffectResult,
	createGraphHarnessAuthority,
	type D43AdmittedEffectV1,
	type D43EffectResultInputV1,
	type D43FactV1,
	type D43PublicSemanticCriteriaV1,
	type GraphHarnessEvidence,
	snapshotGraphHarnessEvidence,
	takeD43AdmittedEffect,
	validateGraphHarnessEvidence,
} from "./graph-harness-authority.js";
import {
	HARNESS_ARMS,
	type HarnessCampaignPolicy,
	validateHarnessCampaignPolicy,
} from "./harness-campaign-policy.js";
import type { QualifiedProfileCatalogInput } from "./model-harness-profile.js";

export const D45_AUTHORITY_REVISION =
	"graphrefly-ts.graph-tool-admission-authority.d74.v2" as const;
export const D45_EFFECT_SCHEMA = "graphrefly-ts.graph-tool-admitted-effect.d74.v2" as const;
export const D45_FACT_SCHEMA = "graphrefly-ts.graph-tool-canonical-fact.d74.v2" as const;
export const D45_EVIDENCE_SCHEMA = "graphrefly-ts.graph-tool-canonical-evidence.d74.v2" as const;
export const D45_PARTIAL_EVIDENCE_SCHEMA =
	"graphrefly-ts.graph-tool-partial-canonical-evidence.d74.v2" as const;
export const D52_REPLACE_TEXT_MAX_BYTES = 512 as const;
export const D52_REPLACE_EXPANSION_MAX_BYTES = 128 as const;

const PROVIDER_OUTCOMES = Object.freeze([
	"success",
	"wrong-tool",
	"premature-final",
	"length",
	"schema-rejected",
	"provider-rejected",
	"transport-failed",
	"retryable-provider-failure",
	"executor-failed",
] as const);

export const D68_RESPONSE_REJECTION_CODES = Object.freeze([
	"response-byte-bound",
	"response-status-invalid",
	"response-utf8-invalid",
	"response-json-invalid",
	"response-root-shape",
	"response-usage-shape",
	"response-token-invalid",
	"response-cache-token-invalid",
	"response-tool-envelope-invalid",
] as const);

const LOCAL_OUTCOMES = Object.freeze([
	"success",
	"passed",
	"failed",
	"wrong-scope",
	"executor-failed",
] as const);

const TOOL_FAILURES = Object.freeze([
	"read-failed",
	"replacement-not-found",
	"replacement-not-unique",
	"replacement-unchanged",
	"workspace-state-drift",
	"executor-failed",
] as const);

export type D45ProviderOutcome = (typeof PROVIDER_OUTCOMES)[number];
export type D68ResponseRejectionCode = (typeof D68_RESPONSE_REJECTION_CODES)[number];
export type D45LocalOutcome = (typeof LOCAL_OUTCOMES)[number];
export type D45ToolFailure = (typeof TOOL_FAILURES)[number];

export type D45ToolArgumentsV1 =
	| Readonly<{ toolRef: "read-file"; path: string }>
	| Readonly<{
			toolRef: "replace-exact";
			path: string;
			oldText: string;
			newText: string;
	  }>;

export interface D45UsageV1 {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
}

export interface D45AdmittedEffectV1 {
	readonly schemaVersion: typeof D45_EFFECT_SCHEMA;
	readonly sequence: number;
	readonly effectKind: "provider-proposal" | "workspace-freshness" | "tool-action" | "local-effect";
	readonly sourceD43EffectKind: D43AdmittedEffectV1["kind"];
	readonly sourceD43EffectDigest: string;
	readonly sourceD43RequestDigest: string;
	readonly sourceD43Sequence: number;
	readonly arm: D43AdmittedEffectV1["arm"];
	readonly phase: "inspection" | "mutation" | null;
	readonly toolRef: "read-file" | "replace-exact" | null;
	readonly toolOrdinal: number | null;
	readonly toolCount: number | null;
	readonly path: string | null;
	readonly argumentsDigest: string | null;
	readonly argumentsBytes: number;
	readonly workspaceStateDigest: string | null;
	readonly logicalRequestDigest: string;
	readonly planDigest: string;
	readonly profileResolutionDigest: string;
	readonly modelRef: string;
	readonly providerRef: string;
	readonly endpointProtocol: "chat-completions" | "responses";
	readonly namedToolChoiceEncoding: "function-object" | "tool-name";
	readonly responseContractRevision: string;
	readonly reasoningEffort: "high";
	readonly requireParameters: true;
	readonly taskEnvelopeDigest: string;
	readonly retainsInspectionSpan: boolean;
	readonly maxOutputTokens: number | null;
	readonly requestDigest: string;
	readonly admissionDigest: string;
	readonly providerReservationMicrousd: number;
	readonly elapsedReservationMs: number;
	readonly effectDigest: string;
}

export interface D45ProviderProposalResultInputV1 {
	readonly effectKind: "provider-proposal";
	readonly outcome: D45ProviderOutcome;
	readonly elapsedMs: number;
	readonly costMicrousd: number;
	readonly usage: D45UsageV1 | null;
	readonly wireDigest: string | null;
	readonly retryClass: "D671" | "D675" | "D710" | null;
	readonly responseRejectionCode: D68ResponseRejectionCode | null;
	readonly proposal: Readonly<{ toolCalls: readonly D45ToolArgumentsV1[] }> | null;
}

export interface D45ToolResultInputV1 {
	readonly effectKind: "tool-action";
	readonly status: "success" | "failed";
	readonly causeCode: D45ToolFailure | null;
	readonly elapsedMs: number;
	readonly evidenceDigest: string;
	readonly workspaceStateBeforeDigest: string;
	readonly workspaceStateAfterDigest: string;
	readonly content: string | null;
}

export interface D45WorkspaceFreshnessResultInputV1 {
	readonly effectKind: "workspace-freshness";
	readonly elapsedMs: number;
	readonly evidenceDigest: string;
	readonly observedWorkspaceStateDigest: string;
}

export interface D45LocalResultInputV1 {
	readonly effectKind: "local-effect";
	readonly outcome: D45LocalOutcome;
	readonly elapsedMs: number;
	readonly evidenceDigest: string;
	readonly workspaceStateDigest: string | null;
	readonly criteria: D43EffectResultInputV1["criteria"];
	readonly sourceSnapshotDigest?: string | null;
}

export type D45EffectResultInputV1 =
	| D45ProviderProposalResultInputV1
	| D45WorkspaceFreshnessResultInputV1
	| D45ToolResultInputV1
	| D45LocalResultInputV1;

interface ToolProjection {
	readonly toolRef: "read-file" | "replace-exact";
	readonly path: string;
	readonly argumentsDigest: string;
	readonly argumentsBytes: number;
	readonly oldTextBytes: number;
	readonly newTextBytes: number;
}

interface ProviderProjection {
	readonly outcome: D45ProviderOutcome;
	readonly elapsedMs: number;
	readonly costMicrousd: number;
	readonly reconciledCostMicrousd: number;
	readonly reconciledElapsedMs: number;
	readonly usage: D45UsageV1 | null;
	readonly wireDigest: string | null;
	readonly retryClass: "D671" | "D675" | "D710" | null;
	readonly responseRejectionCode: D68ResponseRejectionCode | null;
	readonly proposalRejectionCode:
		| "cardinality"
		| "wrong-tool"
		| "path-not-allowed"
		| "argument-bounds"
		| "budget-headroom"
		| null;
	readonly proposalDigest: string | null;
	readonly toolCalls: readonly ToolProjection[];
	readonly reconciliationDigest: string;
}

export interface D45BudgetProjectionV1 {
	readonly providerAttempts: number;
	readonly confirmedCostMicrousd: number;
	readonly confirmedElapsedMs: number;
	readonly effectResults: number;
}

interface ToolResultProjection {
	readonly status: "success" | "failed";
	readonly causeCode: D45ToolFailure | null;
	readonly elapsedMs: number;
	readonly evidenceDigest: string;
	readonly workspaceStateBeforeDigest: string;
	readonly workspaceStateAfterDigest: string;
	readonly contentDigest: string | null;
	readonly contentBytes: number;
}

interface WorkspaceFreshnessProjection {
	readonly elapsedMs: number;
	readonly evidenceDigest: string;
	readonly argumentsDigest: string;
	readonly proposalDigest: string;
	readonly expectedWorkspaceStateDigest: string;
	readonly observedWorkspaceStateDigest: string;
	readonly fresh: boolean;
}

interface LocalResultProjection {
	readonly outcome: D45LocalOutcome;
	readonly elapsedMs: number;
	readonly evidenceDigest: string;
	readonly workspaceStateDigest: string | null;
	readonly criteria: D43EffectResultInputV1["criteria"];
	readonly sourceSnapshotDigest?: string | null;
}

export type D45FactV1 =
	| Readonly<{
			schemaVersion: typeof D45_FACT_SCHEMA;
			sequence: number;
			factKind: "effect-admitted";
			effect: D45AdmittedEffectV1;
			factDigest: string;
	  }>
	| Readonly<{
			schemaVersion: typeof D45_FACT_SCHEMA;
			sequence: number;
			factKind: "provider-wire-admitted";
			effectDigest: string;
			requestDigest: string;
			admissionDigest: string;
			logicalRequestDigest: string;
			wireDigest: string;
			factDigest: string;
	  }>
	| Readonly<{
			schemaVersion: typeof D45_FACT_SCHEMA;
			sequence: number;
			factKind: "workspace-freshness-result";
			effectDigest: string;
			requestDigest: string;
			admissionDigest: string;
			result: WorkspaceFreshnessProjection;
			factDigest: string;
	  }>
	| Readonly<{
			schemaVersion: typeof D45_FACT_SCHEMA;
			sequence: number;
			factKind: "provider-result";
			effectDigest: string;
			requestDigest: string;
			admissionDigest: string;
			result: ProviderProjection;
			factDigest: string;
	  }>
	| Readonly<{
			schemaVersion: typeof D45_FACT_SCHEMA;
			sequence: number;
			factKind: "tool-result";
			effectDigest: string;
			requestDigest: string;
			admissionDigest: string;
			result: ToolResultProjection;
			factDigest: string;
	  }>
	| Readonly<{
			schemaVersion: typeof D45_FACT_SCHEMA;
			sequence: number;
			factKind: "local-result";
			effectDigest: string;
			requestDigest: string;
			admissionDigest: string;
			result: LocalResultProjection;
			factDigest: string;
	  }>;

export interface D45CanonicalEvidenceV1 {
	readonly schemaVersion: typeof D45_EVIDENCE_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D61";
	readonly authorityRevision: typeof D45_AUTHORITY_REVISION;
	readonly facts: readonly D45FactV1[];
	readonly lifecycle: GraphHarnessEvidence;
	readonly findings: readonly Readonly<{
		readonly factSequence: number;
		readonly effectDigest: string;
		readonly causeCode: string;
	}>[];
	readonly budget: D45BudgetProjectionV1;
	readonly proposalCount: number;
	readonly admittedToolCount: number;
	readonly completedToolCount: number;
	readonly proposalToolBijection: boolean;
	readonly maxActiveEffectsObserved: 1;
	readonly rawMaterialPersisted: false;
	readonly exactSixArmsCompleted: boolean;
	readonly frozenGateWouldPass: boolean;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D45PartialCanonicalEvidenceV1 {
	readonly schemaVersion: typeof D45_PARTIAL_EVIDENCE_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D61";
	readonly authorityRevision: typeof D45_AUTHORITY_REVISION;
	readonly terminalCauseCode:
		| "provider-interrupted"
		| "tool-interrupted"
		| "local-effect-interrupted"
		| "persistence-interrupted";
	readonly facts: readonly D45FactV1[];
	readonly activeEffectDigest: string | null;
	readonly activeWireDigest: string | null;
	readonly budget: D45BudgetProjectionV1;
	readonly lifecycleComplete: false;
	readonly rawMaterialPersisted: false;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D45GraphToolAuthorityV1 {
	readonly revision: typeof D45_AUTHORITY_REVISION;
}

export interface D68GraphProgressV1 {
	readonly schemaVersion: "graphrefly-ts.d68.graph-progress.v1";
	readonly activeArm: D43AdmittedEffectV1["arm"] | null;
	readonly activeEffectKind: D45AdmittedEffectV1["effectKind"] | null;
	readonly activePhase: D45AdmittedEffectV1["phase"];
	readonly activeElapsedReservationMs: number;
	readonly factSequence: number;
	readonly completedArmCount: number;
	readonly providerAttempts: number;
	readonly confirmedCostMicrousd: number;
	readonly confirmedElapsedMs: number;
	readonly remainingProviderAttempts: number;
	readonly remainingCostMicrousd: number;
	readonly remainingElapsedMs: number;
	readonly progressDigest: string;
}

export interface D45ProviderMaterialV1 {
	readonly systemInstruction: string;
	readonly taskStatement: string;
	readonly armContext: string;
	readonly intent: D43AdmittedEffectV1["intent"];
	readonly readablePaths: readonly string[];
	readonly writablePath: string;
	readonly correctionContext:
		| Readonly<{
				kind: "focused-validation";
				causeCode: "focused-validation-failed";
				sourceFactDigest: string;
		  }>
		| Readonly<{
				kind: "public-semantic-validation";
				sourceFactDigest: string;
				scenarioSetDigest: string;
				observations: readonly Readonly<{
					criterion: D43PublicSemanticCriteriaV1["observations"][number]["criterion"];
					scenarioRef: string;
					passed: boolean;
					causeCode: D43PublicSemanticCriteriaV1["observations"][number]["causeCode"];
				}>[];
		  }>
		| null;
	readonly retainedReads: readonly Readonly<{
		readonly path: string;
		readonly content: string;
	}>[];
}

export interface D45TaskMaterialInputV1 {
	readonly systemInstruction: string;
	readonly taskStatement: string;
	readonly armContexts: Readonly<Record<D43AdmittedEffectV1["arm"], string>>;
	readonly readablePaths: readonly string[];
	readonly writablePath: string;
}

interface ProviderRuntimeResult {
	readonly input: D45ProviderProposalResultInputV1;
	readonly projection: ProviderProjection;
}

interface ToolRuntimeResult {
	readonly input: D45ToolResultInputV1;
	readonly projection: ToolResultProjection;
}

interface WorkspaceFreshnessRuntimeResult {
	readonly input: D45WorkspaceFreshnessResultInputV1;
	readonly projection: WorkspaceFreshnessProjection;
}

interface LocalRuntimeResult {
	readonly input: D45LocalResultInputV1;
	readonly projection: LocalResultProjection;
}

type RuntimeFact =
	| Readonly<{ projection: D45FactV1; runtime: null }>
	| Readonly<{ projection: D45FactV1; runtime: ProviderRuntimeResult }>
	| Readonly<{ projection: D45FactV1; runtime: WorkspaceFreshnessRuntimeResult }>
	| Readonly<{ projection: D45FactV1; runtime: ToolRuntimeResult }>
	| Readonly<{ projection: D45FactV1; runtime: LocalRuntimeResult }>;

interface PendingTool {
	readonly arguments: D45ToolArgumentsV1;
	readonly projection: ToolProjection;
	readonly ordinal: number;
	readonly count: number;
	materialRead: boolean;
}

interface PendingProvider {
	readonly innerEffect: D43AdmittedEffectV1;
	readonly result: ProviderRuntimeResult;
}

interface State {
	readonly owner: ReturnType<typeof graph>;
	readonly factNode: ReturnType<typeof createFactNode>;
	readonly inner: ReturnType<typeof createGraphHarnessAuthority>;
	readonly readablePaths: ReadonlySet<string>;
	readonly writablePath: string;
	readonly systemInstruction: string;
	readonly taskStatement: string;
	readonly armContexts: Readonly<Record<D43AdmittedEffectV1["arm"], string>>;
	readonly taskEnvelopeDigest: string;
	readonly campaign: HarnessCampaignPolicy;
	readonly reasoningEffort: "high";
	readonly requireParameters: true;
	readonly facts: D45FactV1[];
	readonly providerWireByLogicalRequest: Map<string, string>;
	readonly retainedReads: Map<string, string>;
	readonly correctionContexts: Map<
		D43AdmittedEffectV1["arm"],
		Exclude<D45ProviderMaterialV1["correctionContext"], null>
	>;
	active: D45AdmittedEffectV1 | null;
	innerActive: D43AdmittedEffectV1 | null;
	pendingProvider: PendingProvider | null;
	pendingTools: PendingTool[];
	workspaceStateDigest: string | null;
	nextFactSequence: number;
	nextEffectSequence: number;
	finished: boolean;
	providerMaterialRead: boolean;
	activeWireDigest: string | null;
	pendingToolFreshnessAdmitted: boolean;
}

const states = new WeakMap<object, State>();
const effectOwners = new WeakMap<object, D45GraphToolAuthorityV1>();

function createFactNode(owner: ReturnType<typeof graph>) {
	return owner.node<RuntimeFact>([], null, { name: "d45/canonical-runtime-facts" });
}

function bytes(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function boundedString(value: unknown, path: string, maxBytes: number, allowEmpty = false): string {
	if (typeof value !== "string" || (!allowEmpty && value.length === 0))
		throw new TypeError(`${path} must be a bounded string`);
	if (bytes(value) > maxBytes) throw new TypeError(`${path} exceeded its byte bound`);
	return value;
}

export function d45TaskEnvelopeDigest(input: D45TaskMaterialInputV1): string {
	return empiricalStrictJsonDigest({
		systemInstruction: input.systemInstruction,
		taskStatement: input.taskStatement,
		armContexts: input.armContexts,
		readablePaths: input.readablePaths,
		writablePath: input.writablePath,
	});
}

function fact<T extends Omit<D45FactV1, "factDigest">>(value: T): D45FactV1 {
	const material = strictSnapshot(value);
	return Object.freeze({
		...material,
		factDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D45FactV1;
}

function emit(state: State, value: RuntimeFact) {
	state.factNode.down([["DATA", value]]);
}

function stateFor(authority: D45GraphToolAuthorityV1): State {
	const state = states.get(authority);
	if (state === undefined) throw new TypeError("D45 authority is forged");
	return state;
}

function countOccurrences(haystack: string, needle: string): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let offset = 0;
	while (offset <= haystack.length - needle.length) {
		const index = haystack.indexOf(needle, offset);
		if (index < 0) break;
		count += 1;
		offset = index + 1;
	}
	return count;
}

function validateToolArguments(value: unknown): D45ToolArgumentsV1 {
	const candidate = record(value, "D45 proposal tool arguments");
	const toolRef = oneOf(
		candidate.toolRef,
		["read-file", "replace-exact"] as const,
		"D45 proposal toolRef",
	);
	if (toolRef === "read-file") {
		exactKeys(candidate, ["path", "toolRef"], "D45 read-file arguments");
		return Object.freeze({
			toolRef,
			path: coordinate(candidate.path, "D45 read-file path"),
		});
	}
	exactKeys(candidate, ["newText", "oldText", "path", "toolRef"], "D45 replace arguments");
	const oldText = boundedString(
		candidate.oldText,
		"D45 replace oldText",
		D52_REPLACE_TEXT_MAX_BYTES,
	);
	const newText = boundedString(
		candidate.newText,
		"D45 replace newText",
		D52_REPLACE_TEXT_MAX_BYTES,
		true,
	);
	if (bytes(newText) > bytes(oldText) + D52_REPLACE_EXPANSION_MAX_BYTES)
		throw new TypeError("D45 replace expansion exceeded its byte bound");
	return Object.freeze({
		toolRef,
		path: coordinate(candidate.path, "D45 replace path"),
		oldText,
		newText,
	});
}

function toolProjection(argumentsValue: D45ToolArgumentsV1): ToolProjection {
	const canonical = strictSnapshot(argumentsValue);
	return Object.freeze({
		toolRef: argumentsValue.toolRef,
		path: argumentsValue.path,
		argumentsDigest: empiricalStrictJsonDigest(canonical),
		argumentsBytes: bytes(JSON.stringify(canonical)),
		oldTextBytes: argumentsValue.toolRef === "replace-exact" ? bytes(argumentsValue.oldText) : 0,
		newTextBytes: argumentsValue.toolRef === "replace-exact" ? bytes(argumentsValue.newText) : 0,
	});
}

function validateUsage(value: unknown): D45UsageV1 {
	const candidate = record(value, "D45 provider usage");
	exactKeys(candidate, ["cacheReadTokens", "inputTokens", "outputTokens"], "D45 usage");
	return Object.freeze({
		inputTokens: safeInteger(candidate.inputTokens, "D45 inputTokens", { max: 10_000_000 }),
		outputTokens: safeInteger(candidate.outputTokens, "D45 outputTokens", { max: 1_000_000 }),
		cacheReadTokens: safeInteger(candidate.cacheReadTokens, "D45 cacheReadTokens", {
			max: 10_000_000,
		}),
	});
}

function validatePersistedProviderProjection(value: unknown, path: string): void {
	const result = record(value, path);
	const outcome = oneOf(result.outcome, PROVIDER_OUTCOMES, `${path}.outcome`);
	safeInteger(result.elapsedMs, `${path}.elapsedMs`, { max: 7_200_000 });
	safeInteger(result.costMicrousd, `${path}.costMicrousd`, { max: 6_000_000 });
	safeInteger(result.reconciledCostMicrousd, `${path}.reconciledCostMicrousd`, {
		max: 6_000_000,
	});
	safeInteger(result.reconciledElapsedMs, `${path}.reconciledElapsedMs`, { max: 7_200_000 });
	if (result.usage !== null) validateUsage(result.usage);
	if (result.wireDigest !== null) digest(result.wireDigest, `${path}.wireDigest`);
	if (result.retryClass !== null)
		oneOf(result.retryClass, ["D671", "D675", "D710"] as const, `${path}.retryClass`);
	const responseRejectionCode =
		result.responseRejectionCode === null
			? null
			: oneOf(
					result.responseRejectionCode,
					D68_RESPONSE_REJECTION_CODES,
					`${path}.responseRejectionCode`,
				);
	if (responseRejectionCode !== null)
		oneOf(responseRejectionCode, D68_RESPONSE_REJECTION_CODES, `${path}.responseRejectionCode`);
	const proposalRejectionCode =
		result.proposalRejectionCode === null
			? null
			: oneOf(
					result.proposalRejectionCode,
					[
						"cardinality",
						"wrong-tool",
						"path-not-allowed",
						"argument-bounds",
						"budget-headroom",
					] as const,
					`${path}.proposalRejectionCode`,
				);
	if (
		(responseRejectionCode !== null && proposalRejectionCode !== null) ||
		(responseRejectionCode !== null && outcome !== "schema-rejected") ||
		(proposalRejectionCode === "wrong-tool" && outcome !== "wrong-tool") ||
		(proposalRejectionCode !== null &&
			proposalRejectionCode !== "wrong-tool" &&
			outcome !== "schema-rejected") ||
		(outcome === "schema-rejected" &&
			responseRejectionCode === null &&
			proposalRejectionCode === null)
	)
		throw new TypeError(`${path} rejection provenance drifted`);
	const calls = array(result.toolCalls, `${path}.toolCalls`).map((callValue, index) => {
		const call = record(callValue, `${path}.toolCalls[${index}]`);
		exactKeys(
			call,
			["argumentsBytes", "argumentsDigest", "newTextBytes", "oldTextBytes", "path", "toolRef"],
			`${path}.toolCalls[${index}]`,
		);
		const toolRef = oneOf(
			call.toolRef,
			["read-file", "replace-exact"] as const,
			`${path}.toolCalls[${index}].toolRef`,
		);
		coordinate(call.path, `${path}.toolCalls[${index}].path`);
		digest(call.argumentsDigest, `${path}.toolCalls[${index}].argumentsDigest`);
		const argumentsBytes = safeInteger(call.argumentsBytes, `${path}.argumentsBytes`, {
			min: 1,
			max: 66_000,
		});
		const oldTextBytes = safeInteger(call.oldTextBytes, `${path}.oldTextBytes`, {
			max: D52_REPLACE_TEXT_MAX_BYTES,
		});
		const newTextBytes = safeInteger(call.newTextBytes, `${path}.newTextBytes`, {
			max: D52_REPLACE_TEXT_MAX_BYTES,
		});
		if (
			(toolRef === "read-file" && (oldTextBytes !== 0 || newTextBytes !== 0)) ||
			(toolRef === "replace-exact" &&
				(oldTextBytes === 0 ||
					newTextBytes > oldTextBytes + D52_REPLACE_EXPANSION_MAX_BYTES ||
					argumentsBytes < oldTextBytes + newTextBytes))
		)
			throw new TypeError(`${path} tool projection byte coordinates drifted`);
		return call;
	});
	const expectedProposalDigest = calls.length === 0 ? null : empiricalStrictJsonDigest(calls);
	if (result.proposalDigest !== expectedProposalDigest)
		throw new TypeError(`${path} proposal digest drifted from bounded projections`);
	digest(result.reconciliationDigest, `${path}.reconciliationDigest`);
}

function validateCriteriaProjection(
	value: unknown,
	effect: D45AdmittedEffectV1,
	path: string,
): void {
	const criteria = record(value, `${path}.criteria`);
	exactKeys(criteria, ["observations", "scenarioSetDigest"], `${path}.criteria`);
	const scenarioSetDigest = digest(
		criteria.scenarioSetDigest,
		`${path}.criteria.scenarioSetDigest`,
	);
	const criterionOrder = [
		"actor-visible-behavior-changed",
		"acceptance-criteria-satisfied",
		"scope-preserved",
		"regression-free",
	] as const;
	const causeOrder = [
		"canonical-proposal-not-admitted",
		"malformed-provenance-mutated-store",
		"reconstructed-provenance-admitted",
		"claim-invariant-regression",
	] as const;
	const observations = array(criteria.observations, `${path}.criteria.observations`);
	if (observations.length !== criterionOrder.length)
		throw new TypeError(`${path} public-semantic observation cardinality drifted`);
	const scenarioProjection = observations.map((value, index) => {
		const item = record(value, `${path}.criteria.observations[${index}]`);
		exactKeys(
			item,
			[
				"causeCode",
				"criterion",
				"freshnessDigest",
				"observationDigest",
				"passed",
				"scenarioDigest",
				"scenarioRef",
			],
			`${path}.criteria.observations[${index}]`,
		);
		if (item.criterion !== criterionOrder[index])
			throw new TypeError(`${path} public-semantic criterion order drifted`);
		const passed = boolean(item.passed, `${path}.criteria.observations[${index}].passed`);
		const causeCode =
			item.causeCode === null
				? null
				: oneOf(item.causeCode, causeOrder, `${path}.criteria.observations[${index}].causeCode`);
		if (passed === (causeCode !== null) || (!passed && causeCode !== causeOrder[index]))
			throw new TypeError(`${path} public-semantic disposition/cause drifted`);
		const scenarioRef = coordinate(
			item.scenarioRef,
			`${path}.criteria.observations[${index}].scenarioRef`,
		);
		const scenarioDigest = digest(
			item.scenarioDigest,
			`${path}.criteria.observations[${index}].scenarioDigest`,
		);
		if (
			digest(
				item.observationDigest,
				`${path}.criteria.observations[${index}].observationDigest`,
			) !==
			empiricalStrictJsonDigest({
				requestDigest: effect.sourceD43RequestDigest,
				scenarioDigest,
				passed,
				causeCode,
			})
		)
			throw new TypeError(`${path} public-semantic observation provenance drifted`);
		if (
			digest(item.freshnessDigest, `${path}.criteria.observations[${index}].freshnessDigest`) !==
			empiricalStrictJsonDigest({
				requestDigest: effect.sourceD43RequestDigest,
				sequence: effect.sourceD43Sequence,
			})
		)
			throw new TypeError(`${path} public-semantic freshness provenance drifted`);
		return { criterion: criterionOrder[index], scenarioRef, scenarioDigest };
	});
	if (empiricalStrictJsonDigest(scenarioProjection) !== scenarioSetDigest)
		throw new TypeError(`${path} public-semantic scenario set drifted`);
}

function validatePersistedResultProjection(
	factKind: "workspace-freshness-result" | "tool-result" | "local-result",
	value: unknown,
	effect: D45AdmittedEffectV1,
	path: string,
): void {
	const result = record(value, path);
	if (factKind === "workspace-freshness-result") {
		if (effect.effectKind !== "workspace-freshness")
			throw new TypeError(`${path} bound the wrong admitted effect`);
		safeInteger(result.elapsedMs, `${path}.elapsedMs`, { max: effect.elapsedReservationMs });
		for (const key of [
			"evidenceDigest",
			"argumentsDigest",
			"proposalDigest",
			"expectedWorkspaceStateDigest",
			"observedWorkspaceStateDigest",
		] as const)
			digest(result[key], `${path}.${key}`);
		if (
			result.argumentsDigest !== effect.argumentsDigest ||
			result.expectedWorkspaceStateDigest !== effect.workspaceStateDigest ||
			typeof result.fresh !== "boolean" ||
			result.fresh !== (result.expectedWorkspaceStateDigest === result.observedWorkspaceStateDigest)
		)
			throw new TypeError(`${path} freshness coordinates drifted`);
		return;
	}
	if (factKind === "tool-result") {
		if (effect.effectKind !== "tool-action")
			throw new TypeError(`${path} bound the wrong admitted effect`);
		const status = oneOf(result.status, ["success", "failed"] as const, `${path}.status`);
		const causeCode =
			result.causeCode === null
				? null
				: oneOf(result.causeCode, TOOL_FAILURES, `${path}.causeCode`);
		if ((status === "success") !== (causeCode === null))
			throw new TypeError(`${path} status/cause coordinates drifted`);
		safeInteger(result.elapsedMs, `${path}.elapsedMs`, { max: effect.elapsedReservationMs });
		digest(result.evidenceDigest, `${path}.evidenceDigest`);
		const before = digest(result.workspaceStateBeforeDigest, `${path}.workspaceBefore`);
		const after = digest(result.workspaceStateAfterDigest, `${path}.workspaceAfter`);
		const contentBytes = safeInteger(result.contentBytes, `${path}.contentBytes`, {
			max: 131_072,
		});
		if (result.contentDigest !== null) digest(result.contentDigest, `${path}.contentDigest`);
		if (
			(status === "failed" && before !== after) ||
			(effect.toolRef === "read-file" && status === "success" && before !== after) ||
			(effect.toolRef === "read-file" && status === "success") !==
				(result.contentDigest !== null || contentBytes > 0) ||
			(effect.toolRef !== "read-file" && (result.contentDigest !== null || contentBytes !== 0))
		)
			throw new TypeError(`${path} tool-result material-free coordinates drifted`);
		return;
	}
	if (effect.effectKind !== "local-effect")
		throw new TypeError(`${path} bound the wrong admitted effect`);
	const carriesSemanticSnapshot =
		effect.sourceD43EffectKind === "public-semantic-validation" ||
		effect.sourceD43EffectKind === "hidden-verifier";
	exactKeys(
		result,
		carriesSemanticSnapshot
			? [
					"criteria",
					"effectKind",
					"elapsedMs",
					"evidenceDigest",
					"outcome",
					"sourceSnapshotDigest",
					"workspaceStateDigest",
				]
			: [
					"criteria",
					"effectKind",
					"elapsedMs",
					"evidenceDigest",
					"outcome",
					"workspaceStateDigest",
				],
		path,
	);
	oneOf(result.outcome, LOCAL_OUTCOMES, `${path}.outcome`);
	safeInteger(result.elapsedMs, `${path}.elapsedMs`, { max: effect.elapsedReservationMs });
	digest(result.evidenceDigest, `${path}.evidenceDigest`);
	if (result.workspaceStateDigest !== null)
		digest(result.workspaceStateDigest, `${path}.workspaceStateDigest`);
	const publicSemanticSucceeded =
		effect.sourceD43EffectKind === "public-semantic-validation" &&
		result.outcome !== "executor-failed";
	if (publicSemanticSucceeded !== (result.criteria !== null))
		throw new TypeError(`${path} public-semantic criteria coordinates drifted`);
	if (carriesSemanticSnapshot) {
		const sourceSnapshotDigest =
			result.sourceSnapshotDigest === null
				? null
				: digest(result.sourceSnapshotDigest, `${path}.sourceSnapshotDigest`);
		if ((result.outcome !== "executor-failed") !== (sourceSnapshotDigest !== null))
			throw new TypeError(`${path} semantic snapshot disposition drifted`);
		if (result.criteria !== null) validateCriteriaProjection(result.criteria, effect, path);
		if (
			result.evidenceDigest !==
			empiricalStrictJsonDigest({
				request: effect.requestDigest,
				admission: effect.admissionDigest,
				outcome: result.outcome,
				workspace: result.workspaceStateDigest,
				sourceSnapshotDigest,
				criteriaDigest:
					result.criteria === null ? null : empiricalStrictJsonDigest(result.criteria),
			})
		)
			throw new TypeError(`${path} semantic Graph evidence binding drifted`);
	}
}

function validateProviderResult(
	state: State,
	effect: D45AdmittedEffectV1,
	value: unknown,
): ProviderRuntimeResult {
	const candidate = record(value, "D45 provider result");
	exactKeys(
		candidate,
		[
			"costMicrousd",
			"effectKind",
			"elapsedMs",
			"outcome",
			"proposal",
			"responseRejectionCode",
			"retryClass",
			"usage",
			"wireDigest",
		],
		"D45 provider result",
	);
	if (candidate.effectKind !== "provider-proposal")
		throw new TypeError("D45 provider result kind drifted");
	const outcome = oneOf(candidate.outcome, PROVIDER_OUTCOMES, "D45 provider outcome");
	const elapsedMs = safeInteger(candidate.elapsedMs, "D45 provider elapsedMs", {
		max: effect.elapsedReservationMs,
	});
	const costMicrousd = safeInteger(candidate.costMicrousd, "D45 provider cost", {
		max: effect.providerReservationMicrousd,
	});
	const usage = candidate.usage === null ? null : validateUsage(candidate.usage);
	const wireDigest =
		candidate.wireDigest === null ? null : digest(candidate.wireDigest, "D45 wireDigest");
	const retryClass =
		candidate.retryClass === null
			? null
			: oneOf(candidate.retryClass, ["D671", "D675", "D710"] as const, "D45 retryClass");
	if ((outcome === "retryable-provider-failure") !== (retryClass !== null))
		throw new TypeError("D45 retry classification drifted");
	const responseRejectionCode =
		candidate.responseRejectionCode === null
			? null
			: oneOf(
					candidate.responseRejectionCode,
					D68_RESPONSE_REJECTION_CODES,
					"D45 response rejection code",
				);
	if ((outcome === "schema-rejected") !== (responseRejectionCode !== null))
		throw new TypeError("D45 response rejection classification drifted");
	const usageMayBeUnavailable =
		outcome === "schema-rejected" ||
		outcome === "provider-rejected" ||
		outcome === "transport-failed" ||
		outcome === "retryable-provider-failure" ||
		outcome === "executor-failed";
	if (!usageMayBeUnavailable && usage === null)
		throw new TypeError("D45 completed provider result omitted usage");
	if (wireDigest === null) throw new TypeError("D45 provider result omitted final wire digest");
	let toolCalls: D45ToolArgumentsV1[] = [];
	let proposalRejectionCode: ProviderProjection["proposalRejectionCode"] = null;
	if (outcome === "success") {
		const proposal = record(candidate.proposal, "D45 provider proposal");
		exactKeys(proposal, ["toolCalls"], "D45 provider proposal");
		const rawCalls = array(proposal.toolCalls, "D45 provider toolCalls");
		const validCardinality = rawCalls.length === 1;
		if (!validCardinality) proposalRejectionCode = "cardinality";
		if (proposalRejectionCode === null) {
			try {
				toolCalls = rawCalls.map(validateToolArguments);
			} catch {
				proposalRejectionCode = "argument-bounds";
			}
		}
		if (proposalRejectionCode === null) {
			const required = effect.phase === "inspection" ? "read-file" : "replace-exact";
			if (toolCalls.some((call) => call.toolRef !== required)) proposalRejectionCode = "wrong-tool";
		}
		if (proposalRejectionCode === null) {
			if (
				toolCalls.some((call) =>
					effect.phase === "inspection"
						? !state.readablePaths.has(call.path) ||
							(state.retainedReads.size < state.readablePaths.size
								? state.retainedReads.has(call.path)
								: call.path !== state.writablePath)
						: call.path !== state.writablePath,
				)
			)
				proposalRejectionCode = "path-not-allowed";
		}
		if (proposalRejectionCode === null) {
			const budget = deriveD45Budget(state.facts);
			const compositeElapsedReservationMs =
				toolCalls.length * (10_000 + 30_000) + state.campaign.localEffectReservationMs;
			if (
				budget.confirmedElapsedMs + elapsedMs + compositeElapsedReservationMs >
				state.campaign.maxElapsedMs
			)
				proposalRejectionCode = "budget-headroom";
		}
		if (proposalRejectionCode !== null) toolCalls = [];
	} else if (candidate.proposal !== null) {
		throw new TypeError("D45 non-success provider result carried a proposal");
	}
	const projections = Object.freeze(toolCalls.map(toolProjection));
	const proposalDigest = projections.length === 0 ? null : empiricalStrictJsonDigest(projections);
	const reconciledCostMicrousd = usageMayBeUnavailable
		? Math.max(costMicrousd, effect.providerReservationMicrousd)
		: costMicrousd;
	const reconciledElapsedMs =
		outcome === "executor-failed" ? effect.elapsedReservationMs : elapsedMs;
	const effectiveOutcome: D45ProviderOutcome =
		proposalRejectionCode === null
			? outcome
			: proposalRejectionCode === "wrong-tool"
				? "wrong-tool"
				: "schema-rejected";
	const input = Object.freeze({
		effectKind: "provider-proposal" as const,
		outcome: effectiveOutcome,
		elapsedMs,
		costMicrousd,
		usage,
		wireDigest,
		retryClass,
		responseRejectionCode,
		proposal:
			effectiveOutcome === "success"
				? Object.freeze({ toolCalls: Object.freeze(toolCalls) })
				: null,
	});
	const projectionMaterial = strictSnapshot({
		outcome: effectiveOutcome,
		elapsedMs,
		costMicrousd,
		reconciledCostMicrousd,
		reconciledElapsedMs,
		usage,
		wireDigest,
		retryClass,
		responseRejectionCode,
		proposalRejectionCode,
		proposalDigest,
		toolCalls: projections,
	});
	const projection = Object.freeze({
		...projectionMaterial,
		reconciliationDigest: empiricalStrictJsonDigest({
			requestDigest: effect.requestDigest,
			admissionDigest: effect.admissionDigest,
			actualCostMicrousd: costMicrousd,
			reconciledCostMicrousd,
			actualElapsedMs: elapsedMs,
			reconciledElapsedMs,
			usage,
		}),
	});
	return { input, projection };
}

function validateToolResult(effect: D45AdmittedEffectV1, value: unknown): ToolRuntimeResult {
	const candidate = record(value, "D45 tool result");
	exactKeys(
		candidate,
		[
			"causeCode",
			"content",
			"effectKind",
			"elapsedMs",
			"evidenceDigest",
			"status",
			"workspaceStateAfterDigest",
			"workspaceStateBeforeDigest",
		],
		"D45 tool result",
	);
	if (candidate.effectKind !== "tool-action") throw new TypeError("D45 tool result kind drifted");
	const status = oneOf(candidate.status, ["success", "failed"] as const, "D45 tool status");
	const elapsedMs = safeInteger(candidate.elapsedMs, "D45 tool elapsedMs", {
		max: effect.elapsedReservationMs,
	});
	const evidenceDigest = digest(candidate.evidenceDigest, "D45 tool evidenceDigest");
	const before = digest(candidate.workspaceStateBeforeDigest, "D45 tool workspace before");
	const after = digest(candidate.workspaceStateAfterDigest, "D45 tool workspace after");
	let causeCode: D45ToolFailure | null = null;
	if (status === "failed")
		causeCode = oneOf(candidate.causeCode, TOOL_FAILURES, "D45 tool causeCode");
	else if (candidate.causeCode !== null) throw new TypeError("D45 successful tool carried cause");
	let content: string | null = null;
	if (effect.toolRef === "read-file" && status === "success") {
		content = boundedString(candidate.content, "D45 read content", 131_072, true);
		if (before !== after) throw new TypeError("D45 read-file changed workspace state");
	} else if (candidate.content !== null) {
		throw new TypeError("D45 non-read result carried content");
	}
	if (effect.toolRef === "replace-exact" && status === "success" && before === after)
		throw new TypeError("D45 successful replacement did not change workspace state");
	if (status === "failed" && before !== after)
		throw new TypeError("D45 failed tool changed workspace state");
	if (
		causeCode === "workspace-state-drift" &&
		(before === effect.workspaceStateDigest || after !== before)
	)
		throw new TypeError("D45 workspace drift fact did not report a truthful unchanged observation");
	const input = Object.freeze({
		effectKind: "tool-action" as const,
		status,
		causeCode,
		elapsedMs,
		evidenceDigest,
		workspaceStateBeforeDigest: before,
		workspaceStateAfterDigest: after,
		content,
	});
	const projection = Object.freeze({
		status,
		causeCode,
		elapsedMs,
		evidenceDigest,
		workspaceStateBeforeDigest: before,
		workspaceStateAfterDigest: after,
		contentDigest: content === null ? null : empiricalStrictJsonDigest(content),
		contentBytes: content === null ? 0 : bytes(content),
	});
	return { input, projection };
}

function validateWorkspaceFreshnessResult(
	state: State,
	effect: D45AdmittedEffectV1,
	value: unknown,
): WorkspaceFreshnessRuntimeResult {
	const candidate = record(value, "D45 workspace freshness result");
	exactKeys(
		candidate,
		["effectKind", "elapsedMs", "evidenceDigest", "observedWorkspaceStateDigest"],
		"D45 workspace freshness result",
	);
	if (candidate.effectKind !== "workspace-freshness")
		throw new TypeError("D45 workspace freshness result kind drifted");
	const pending = state.pendingTools[0];
	const provider = state.pendingProvider;
	if (
		pending === undefined ||
		provider === null ||
		state.workspaceStateDigest === null ||
		effect.argumentsDigest !== pending.projection.argumentsDigest
	)
		throw new TypeError("D45 workspace freshness result lost its exact proposal");
	const elapsedMs = safeInteger(candidate.elapsedMs, "D45 workspace freshness elapsedMs", {
		max: effect.elapsedReservationMs,
	});
	const evidenceDigest = digest(candidate.evidenceDigest, "D45 workspace freshness evidenceDigest");
	const observedWorkspaceStateDigest = digest(
		candidate.observedWorkspaceStateDigest,
		"D45 observed workspace state",
	);
	const fresh = observedWorkspaceStateDigest === state.workspaceStateDigest;
	const input = Object.freeze({
		effectKind: "workspace-freshness" as const,
		elapsedMs,
		evidenceDigest,
		observedWorkspaceStateDigest,
	});
	const projection = Object.freeze({
		elapsedMs,
		evidenceDigest,
		argumentsDigest: pending.projection.argumentsDigest,
		proposalDigest: provider.result.projection.proposalDigest!,
		expectedWorkspaceStateDigest: state.workspaceStateDigest,
		observedWorkspaceStateDigest,
		fresh,
	});
	return { input, projection };
}

function validateLocalResult(effect: D45AdmittedEffectV1, value: unknown): LocalRuntimeResult {
	const candidate = record(value, "D45 local result");
	const carriesSemanticSnapshot =
		effect.sourceD43EffectKind === "public-semantic-validation" ||
		effect.sourceD43EffectKind === "hidden-verifier";
	exactKeys(
		candidate,
		carriesSemanticSnapshot
			? [
					"criteria",
					"effectKind",
					"elapsedMs",
					"evidenceDigest",
					"outcome",
					"sourceSnapshotDigest",
					"workspaceStateDigest",
				]
			: [
					"criteria",
					"effectKind",
					"elapsedMs",
					"evidenceDigest",
					"outcome",
					"workspaceStateDigest",
				],
		"D45 local result",
	);
	if (candidate.effectKind !== "local-effect") throw new TypeError("D45 local result kind drifted");
	const outcome = oneOf(candidate.outcome, LOCAL_OUTCOMES, "D45 local outcome");
	const elapsedMs = safeInteger(candidate.elapsedMs, "D45 local elapsedMs", {
		max: effect.elapsedReservationMs,
	});
	const evidenceDigest = digest(candidate.evidenceDigest, "D45 local evidenceDigest");
	const workspaceStateDigest =
		candidate.workspaceStateDigest === null
			? null
			: digest(candidate.workspaceStateDigest, "D45 local workspace state");
	const criteria = candidate.criteria as D43EffectResultInputV1["criteria"];
	let sourceSnapshotDigest: string | null | undefined;
	if (carriesSemanticSnapshot) {
		if (
			effect.sourceD43EffectKind === "public-semantic-validation" &&
			(outcome === "executor-failed") === (criteria !== null)
		)
			throw new TypeError("D45 public semantic result criteria disposition drifted");
		if (effect.sourceD43EffectKind === "hidden-verifier" && criteria !== null)
			throw new TypeError("D45 withheld semantic result exposed criteria");
		sourceSnapshotDigest =
			candidate.sourceSnapshotDigest === null
				? null
				: digest(candidate.sourceSnapshotDigest, "D45 public semantic source snapshot");
		if ((outcome !== "executor-failed") !== (sourceSnapshotDigest !== null))
			throw new TypeError("D45 semantic snapshot disposition drifted");
		if (criteria !== null) validateCriteriaProjection(criteria, effect, "D45 local result");
		if (
			evidenceDigest !==
			empiricalStrictJsonDigest({
				request: effect.requestDigest,
				admission: effect.admissionDigest,
				outcome,
				workspace: workspaceStateDigest,
				sourceSnapshotDigest,
				criteriaDigest: criteria === null ? null : empiricalStrictJsonDigest(criteria),
			})
		)
			throw new TypeError("D45 semantic Graph evidence binding drifted");
	} else if (criteria !== null)
		throw new TypeError("D45 non-semantic local result carried criteria");
	const input = Object.freeze({
		effectKind: "local-effect" as const,
		outcome,
		elapsedMs,
		evidenceDigest,
		workspaceStateDigest,
		criteria,
		...(sourceSnapshotDigest === undefined ? {} : { sourceSnapshotDigest }),
	});
	return { input, projection: input };
}

function providerToD43(
	pending: PendingProvider,
	outcome: D43EffectResultInputV1["outcome"],
): D43EffectResultInputV1 {
	const result = pending.result.projection;
	return Object.freeze({
		outcome,
		elapsedMs: result.elapsedMs,
		costMicrousd: result.costMicrousd,
		usage: result.usage,
		wireDigest: result.wireDigest,
		retryClass: result.retryClass,
		criteria: null,
	});
}

function providerOutcomeToD43(outcome: D45ProviderOutcome): D43EffectResultInputV1["outcome"] {
	return outcome;
}

function clearProvider(state: State) {
	state.pendingProvider = null;
	state.pendingTools = [];
	state.pendingToolFreshnessAdmitted = false;
}

function finishComposite(state: State, outcome: D43EffectResultInputV1["outcome"]): void {
	const pending = state.pendingProvider;
	if (pending === null) throw new TypeError("D45 provider phase material is missing");
	admitD43EffectResult(state.inner, pending.innerEffect, providerToD43(pending, outcome));
	clearProvider(state);
	state.innerActive = null;
}

function applyProviderFact(state: State, runtime: ProviderRuntimeResult) {
	const inner = state.innerActive;
	if (inner === null || (inner.kind !== "inspection" && inner.kind !== "mutation"))
		throw new TypeError("D45 provider fact lost its D43 phase admission");
	const result = runtime.projection;
	if (result.outcome !== "success") {
		admitD43EffectResult(state.inner, inner, {
			outcome: providerOutcomeToD43(result.outcome),
			elapsedMs: result.elapsedMs,
			costMicrousd: result.costMicrousd,
			usage: result.usage,
			wireDigest: result.wireDigest,
			retryClass: result.retryClass,
			criteria: null,
		});
		state.innerActive = null;
		return;
	}
	const rawCalls = runtime.input.proposal?.toolCalls;
	if (rawCalls === undefined) throw new TypeError("D45 successful provider result lost proposal");
	state.pendingProvider = { innerEffect: inner, result: runtime };
	state.pendingTools = rawCalls.map((argumentsValue, index) => ({
		arguments: argumentsValue,
		projection: toolProjection(argumentsValue),
		ordinal: index + 1,
		count: rawCalls.length,
		materialRead: false,
	}));
	state.pendingToolFreshnessAdmitted = false;
	if (inner.kind === "mutation") {
		const mutation = rawCalls[0];
		if (mutation?.toolRef !== "replace-exact")
			throw new TypeError("D45 mutation proposal lost exact tool");
		const retained = state.retainedReads.get(mutation.path);
		let rejection: D43EffectResultInputV1["outcome"] | null = null;
		if (mutation.oldText === mutation.newText) rejection = "replacement-unchanged";
		else if (retained === undefined || countOccurrences(retained, mutation.oldText) === 0)
			rejection = "replacement-not-found";
		else if (countOccurrences(retained, mutation.oldText) !== 1)
			rejection = "replacement-not-unique";
		if (rejection !== null) finishComposite(state, rejection);
	}
}

function toolFailureToD43(cause: D45ToolFailure): D43EffectResultInputV1["outcome"] {
	if (cause === "replacement-not-found") return "replacement-not-found";
	if (cause === "replacement-not-unique") return "replacement-not-unique";
	if (cause === "replacement-unchanged") return "replacement-unchanged";
	return "executor-failed";
}

function applyToolFact(state: State, runtime: ToolRuntimeResult) {
	const pending = state.pendingTools[0];
	if (pending === undefined) throw new TypeError("D45 tool fact has no admitted proposal");
	if (!pending.materialRead)
		throw new TypeError("D45 tool result arrived before capability access");
	const truthfulWorkspaceDrift =
		runtime.input.status === "failed" && runtime.input.causeCode === "workspace-state-drift";
	if (
		!truthfulWorkspaceDrift &&
		runtime.input.workspaceStateBeforeDigest !== state.workspaceStateDigest
	)
		throw new TypeError("D45 tool result used stale workspace state");
	if (runtime.input.status === "failed") {
		finishComposite(state, toolFailureToD43(runtime.input.causeCode ?? "executor-failed"));
		return;
	}
	if (pending.arguments.toolRef === "read-file") {
		state.retainedReads.set(pending.arguments.path, runtime.input.content ?? "");
	} else {
		const retained = state.retainedReads.get(pending.arguments.path);
		if (retained === undefined)
			throw new TypeError("D45 successful replacement lost its retained inspection span");
		state.retainedReads.set(
			pending.arguments.path,
			retained.replace(pending.arguments.oldText, pending.arguments.newText),
		);
		state.workspaceStateDigest = runtime.input.workspaceStateAfterDigest;
	}
	state.pendingTools.shift();
	state.pendingToolFreshnessAdmitted = false;
	if (state.pendingTools.length === 0) finishComposite(state, "success");
}

function localToD43(runtime: LocalRuntimeResult): D43EffectResultInputV1 {
	return Object.freeze({
		outcome: runtime.input.outcome,
		elapsedMs: runtime.input.elapsedMs,
		costMicrousd: 0,
		usage: null,
		wireDigest: null,
		retryClass: null,
		criteria: runtime.input.criteria,
	});
}

function applyLocalFact(state: State, runtime: LocalRuntimeResult, sourceFactDigest: string) {
	const inner = state.innerActive;
	if (inner === null) throw new TypeError("D45 local fact lost its D43 effect");
	if (inner.kind === "materialization" && runtime.input.outcome === "success") {
		if (runtime.input.workspaceStateDigest === null)
			throw new TypeError("D45 materialization omitted workspace state");
		state.workspaceStateDigest = runtime.input.workspaceStateDigest;
	}
	if (
		inner.kind !== "materialization" &&
		inner.kind !== "cleanup" &&
		runtime.input.workspaceStateDigest !== state.workspaceStateDigest
	)
		throw new TypeError("D45 local result used stale workspace state");
	admitD43EffectResult(state.inner, inner, localToD43(runtime));
	if (runtime.input.outcome === "failed" && inner.kind === "focused-validation") {
		state.correctionContexts.set(
			inner.arm,
			Object.freeze({
				kind: "focused-validation",
				causeCode: "focused-validation-failed",
				sourceFactDigest,
			}),
		);
	}
	if (
		runtime.input.outcome === "failed" &&
		inner.kind === "public-semantic-validation" &&
		runtime.input.criteria !== null
	) {
		state.correctionContexts.set(
			inner.arm,
			Object.freeze({
				kind: "public-semantic-validation",
				sourceFactDigest,
				scenarioSetDigest: runtime.input.criteria.scenarioSetDigest,
				observations: Object.freeze(
					runtime.input.criteria.observations.map(({ criterion, scenarioRef, passed, causeCode }) =>
						Object.freeze({ criterion, scenarioRef, passed, causeCode }),
					),
				),
			}),
		);
	}
	if (inner.kind === "cleanup") {
		state.retainedReads.clear();
		state.correctionContexts.delete(inner.arm);
		state.workspaceStateDigest = null;
	}
	state.innerActive = null;
}

function applyFact(state: State, value: RuntimeFact) {
	if (value.projection.factKind === "effect-admitted") {
		state.facts.push(value.projection);
		state.active = value.projection.effect;
		return;
	}
	if (value.projection.factKind === "provider-wire-admitted") {
		if (
			state.active === null ||
			state.active.effectKind !== "provider-proposal" ||
			value.projection.effectDigest !== state.active.effectDigest ||
			value.projection.requestDigest !== state.active.requestDigest ||
			value.projection.admissionDigest !== state.active.admissionDigest ||
			value.projection.logicalRequestDigest !== state.active.logicalRequestDigest ||
			state.activeWireDigest !== null
		)
			throw new TypeError("D45 provider wire admission lost its exact active effect");
		const priorWire = state.providerWireByLogicalRequest.get(value.projection.logicalRequestDigest);
		if (priorWire !== undefined && priorWire !== value.projection.wireDigest)
			throw new TypeError("D45 same-logical-request wire identity drifted before dispatch");
		state.providerWireByLogicalRequest.set(
			value.projection.logicalRequestDigest,
			value.projection.wireDigest,
		);
		state.activeWireDigest = value.projection.wireDigest;
		state.facts.push(value.projection);
		return;
	}
	if (value.projection.factKind === "provider-result")
		applyProviderFact(state, value.runtime as ProviderRuntimeResult);
	else if (value.projection.factKind === "workspace-freshness-result") {
		const runtime = value.runtime as WorkspaceFreshnessRuntimeResult;
		if (runtime.projection.fresh) state.pendingToolFreshnessAdmitted = true;
		else finishComposite(state, "executor-failed");
	} else if (value.projection.factKind === "tool-result")
		applyToolFact(state, value.runtime as ToolRuntimeResult);
	else applyLocalFact(state, value.runtime as LocalRuntimeResult, value.projection.factDigest);
	state.facts.push(value.projection);
	state.active = null;
	state.activeWireDigest = null;
}

export function createD45GraphToolAuthority(input: {
	readonly profileInput: QualifiedProfileCatalogInput;
	readonly assignmentRef: string;
	readonly readablePaths: readonly string[];
	readonly writablePath: string;
	readonly taskMaterial: {
		readonly systemInstruction: string;
		readonly taskStatement: string;
		readonly armContexts: Readonly<Record<D43AdmittedEffectV1["arm"], string>>;
	};
	readonly routeProfile: {
		readonly reasoningEffort: "high";
		readonly requireParameters: true;
	};
	readonly campaign: HarnessCampaignPolicy;
}): D45GraphToolAuthorityV1 {
	if (
		input.routeProfile.reasoningEffort !== "high" ||
		input.routeProfile.requireParameters !== true
	)
		throw new TypeError("D45 route profile drifted from the admitted route");
	const campaign = validateHarnessCampaignPolicy(input.campaign);
	const readablePaths = new Set(
		input.readablePaths.map((item) => coordinate(item, "D45 readable path")),
	);
	const writablePath = coordinate(input.writablePath, "D45 writable path");
	if (!readablePaths.has(writablePath)) throw new TypeError("D45 writable path must be readable");
	const systemInstruction = boundedString(
		input.taskMaterial.systemInstruction,
		"D45 system instruction",
		16_384,
	);
	const taskStatement = boundedString(
		input.taskMaterial.taskStatement,
		"D45 task statement",
		32_768,
	);
	if (
		Object.keys(input.taskMaterial.armContexts).sort().join("\n") !==
		[...HARNESS_ARMS].sort().join("\n")
	)
		throw new TypeError("D45 task material arm contexts drifted");
	const armContexts = Object.freeze(
		Object.fromEntries(
			Object.entries(input.taskMaterial.armContexts).map(([arm, context]) => [
				arm,
				boundedString(context, `D45 arm context ${arm}`, 16_384, true),
			]),
		) as unknown as Record<D43AdmittedEffectV1["arm"], string>,
	);
	const taskEnvelopeDigest = d45TaskEnvelopeDigest({
		systemInstruction,
		taskStatement,
		armContexts,
		readablePaths: [...readablePaths],
		writablePath,
	});
	const owner = graph({ name: "d45/provider-proposal-tool-admission" });
	const factNode = createFactNode(owner);
	const inner = createGraphHarnessAuthority({
		profileInput: input.profileInput,
		campaign,
		assignmentRef: input.assignmentRef,
	});
	const authority = Object.freeze({ revision: D45_AUTHORITY_REVISION });
	let state!: State;
	const projectionNode = owner.node<RuntimeFact>(
		[factNode],
		(ctx) => {
			for (const item of (depBatch(ctx, 0) ?? []) as readonly RuntimeFact[]) {
				applyFact(state, item);
				ctx.down([["DATA", item]]);
			}
		},
		{ name: "d45/canonical-projection", factory: "d45GraphToolProjection" },
	);
	state = {
		owner,
		factNode,
		inner,
		readablePaths,
		writablePath,
		systemInstruction,
		taskStatement,
		armContexts,
		taskEnvelopeDigest,
		campaign,
		reasoningEffort: input.routeProfile.reasoningEffort,
		requireParameters: input.routeProfile.requireParameters,
		facts: [],
		providerWireByLogicalRequest: new Map(),
		retainedReads: new Map(),
		correctionContexts: new Map(),
		active: null,
		innerActive: null,
		pendingProvider: null,
		pendingTools: [],
		workspaceStateDigest: null,
		nextFactSequence: 1,
		nextEffectSequence: 1,
		finished: false,
		providerMaterialRead: false,
		activeWireDigest: null,
		pendingToolFreshnessAdmitted: false,
	};
	projectionNode.subscribe(() => undefined);
	states.set(authority, state);
	return authority;
}

function effectFromInner(state: State, inner: D43AdmittedEffectV1): D45AdmittedEffectV1 {
	const effectKind = inner.providerEffect
		? ("provider-proposal" as const)
		: ("local-effect" as const);
	const sequence = state.nextEffectSequence++;
	const requestMaterial = strictSnapshot({
		sequence,
		effectKind,
		sourceD43EffectKind: inner.kind,
		sourceD43EffectDigest: inner.effectDigest,
		sourceD43RequestDigest: inner.requestDigest,
		sourceD43Sequence: inner.sequence,
		arm: inner.arm,
		phase: inner.kind === "inspection" || inner.kind === "mutation" ? inner.kind : null,
		toolRef: null,
		toolOrdinal: null,
		toolCount: null,
		path: null,
		argumentsDigest: null,
		argumentsBytes: 0,
		workspaceStateDigest: state.workspaceStateDigest,
		logicalRequestDigest: inner.logicalRequestDigest,
		planDigest: inner.planDigest,
		profileResolutionDigest: inner.profileResolutionDigest,
		modelRef: inner.modelRef,
		providerRef: inner.providerRef,
		endpointProtocol: inner.endpointProtocol,
		namedToolChoiceEncoding: inner.namedToolChoiceEncoding,
		responseContractRevision: inner.responseContractRevision,
		reasoningEffort: state.reasoningEffort,
		requireParameters: state.requireParameters,
		taskEnvelopeDigest: inner.taskEnvelopeDigest,
		retainsInspectionSpan: inner.retainsInspectionSpan,
		maxOutputTokens: inner.maxOutputTokens,
	});
	if (inner.providerEffect && inner.taskEnvelopeDigest !== state.taskEnvelopeDigest)
		throw new TypeError("D45 provider effect task material drifted from Graph policy");
	const requestDigest = empiricalStrictJsonDigest(requestMaterial);
	const admissionDigest = empiricalStrictJsonDigest({
		requestDigest,
		innerAdmissionDigest: inner.admissionDigest,
		workspaceStateDigest: state.workspaceStateDigest,
	});
	const material = strictSnapshot({
		schemaVersion: D45_EFFECT_SCHEMA,
		...requestMaterial,
		requestDigest,
		admissionDigest,
		providerReservationMicrousd: inner.providerReservationMicrousd,
		elapsedReservationMs: inner.elapsedReservationMs,
	});
	return Object.freeze({ ...material, effectDigest: empiricalStrictJsonDigest(material) });
}

function effectFromPendingTool(
	state: State,
	pending: PendingTool,
	effectKind: "workspace-freshness" | "tool-action",
): D45AdmittedEffectV1 {
	const provider = state.pendingProvider;
	if (provider === null) throw new TypeError("D45 tool admission lost provider result");
	const inner = provider.innerEffect;
	const sequence = state.nextEffectSequence++;
	const requestMaterial = strictSnapshot({
		sequence,
		effectKind,
		sourceD43EffectKind: inner.kind,
		sourceD43EffectDigest: inner.effectDigest,
		sourceD43RequestDigest: inner.requestDigest,
		sourceD43Sequence: inner.sequence,
		arm: inner.arm,
		phase: inner.kind as "inspection" | "mutation",
		toolRef: effectKind === "tool-action" ? pending.arguments.toolRef : null,
		toolOrdinal: pending.ordinal,
		toolCount: pending.count,
		path: pending.arguments.path,
		argumentsDigest: pending.projection.argumentsDigest,
		argumentsBytes: pending.projection.argumentsBytes,
		workspaceStateDigest: state.workspaceStateDigest,
		logicalRequestDigest: inner.logicalRequestDigest,
		planDigest: inner.planDigest,
		profileResolutionDigest: inner.profileResolutionDigest,
		modelRef: inner.modelRef,
		providerRef: inner.providerRef,
		endpointProtocol: inner.endpointProtocol,
		namedToolChoiceEncoding: inner.namedToolChoiceEncoding,
		responseContractRevision: inner.responseContractRevision,
		reasoningEffort: state.reasoningEffort,
		requireParameters: state.requireParameters,
		taskEnvelopeDigest: inner.taskEnvelopeDigest,
		retainsInspectionSpan: inner.retainsInspectionSpan,
		maxOutputTokens: null,
	});
	const requestDigest = empiricalStrictJsonDigest(requestMaterial);
	const admissionDigest = empiricalStrictJsonDigest({
		requestDigest,
		providerProposalDigest: provider.result.projection.proposalDigest,
		providerResultWireDigest: provider.result.projection.wireDigest,
		workspaceStateDigest: state.workspaceStateDigest,
	});
	const material = strictSnapshot({
		schemaVersion: D45_EFFECT_SCHEMA,
		...requestMaterial,
		requestDigest,
		admissionDigest,
		providerReservationMicrousd: 0,
		elapsedReservationMs: effectKind === "workspace-freshness" ? 10_000 : 30_000,
	});
	return Object.freeze({ ...material, effectDigest: empiricalStrictJsonDigest(material) });
}

export function takeD45AdmittedEffect(
	authority: D45GraphToolAuthorityV1,
): D45AdmittedEffectV1 | null {
	const state = stateFor(authority);
	if (state.active !== null) throw new TypeError("D45 active effect has not been reconciled");
	if (state.finished) return null;
	let effect: D45AdmittedEffectV1;
	if (state.pendingTools.length > 0) {
		effect = effectFromPendingTool(
			state,
			state.pendingTools[0]!,
			state.pendingToolFreshnessAdmitted ? "tool-action" : "workspace-freshness",
		);
	} else {
		const inner = takeD43AdmittedEffect(state.inner);
		if (inner === null) {
			state.finished = true;
			return null;
		}
		state.innerActive = inner;
		effect = effectFromInner(state, inner);
	}
	const budget = deriveD45Budget(state.facts);
	if (
		budget.providerAttempts + (effect.effectKind === "provider-proposal" ? 1 : 0) >
			state.campaign.maxProviderAttempts ||
		budget.confirmedCostMicrousd + effect.providerReservationMicrousd >
			state.campaign.maxCostMicrousd ||
		budget.confirmedElapsedMs + effect.elapsedReservationMs > state.campaign.maxElapsedMs
	)
		throw new TypeError("D45 Graph budget headroom is insufficient for the next exact effect");
	const projection = fact({
		schemaVersion: D45_FACT_SCHEMA,
		sequence: state.nextFactSequence++,
		factKind: "effect-admitted",
		effect,
	});
	emit(state, { projection, runtime: null });
	const admitted = state.active as D45AdmittedEffectV1 | null;
	if (admitted === null || admitted.effectDigest !== effect.effectDigest)
		throw new TypeError("D45 Graph did not project admitted effect");
	effectOwners.set(admitted, authority);
	state.providerMaterialRead = false;
	state.activeWireDigest = null;
	return admitted;
}

export function readD45ProviderMaterial(
	authority: D45GraphToolAuthorityV1,
	effect: D45AdmittedEffectV1,
): D45ProviderMaterialV1 {
	const state = stateFor(authority);
	if (
		state.active !== effect ||
		effectOwners.get(effect) !== authority ||
		effect.effectKind !== "provider-proposal"
	)
		throw new TypeError("D45 provider material capability is forged, substituted, or stale");
	if (state.providerMaterialRead)
		throw new TypeError("D45 provider material capability is one-shot");
	state.providerMaterialRead = true;
	return Object.freeze({
		systemInstruction: state.systemInstruction,
		taskStatement: state.taskStatement,
		armContext: state.armContexts[effect.arm],
		intent: state.innerActive?.intent ?? "initial",
		readablePaths: Object.freeze([...state.readablePaths]),
		writablePath: state.writablePath,
		correctionContext:
			state.innerActive?.intent === "semantic-correction"
				? (state.correctionContexts.get(effect.arm) ?? null)
				: null,
		retainedReads: Object.freeze(
			[...state.retainedReads.entries()].map(([path, content]) => Object.freeze({ path, content })),
		),
	});
}

export function admitD45ProviderWire(
	authority: D45GraphToolAuthorityV1,
	effect: D45AdmittedEffectV1,
	wireDigestValue: string,
): void {
	const state = stateFor(authority);
	if (
		state.active !== effect ||
		effectOwners.get(effect) !== authority ||
		effect.effectKind !== "provider-proposal" ||
		!state.providerMaterialRead
	)
		throw new TypeError("D45 provider wire admission is forged, substituted, or premature");
	const wireDigest = digest(wireDigestValue, "D45 admitted wire digest");
	const priorWire = state.providerWireByLogicalRequest.get(effect.logicalRequestDigest);
	if (priorWire !== undefined && priorWire !== wireDigest)
		throw new TypeError("D45 same-logical-request wire identity drifted before dispatch");
	const projection = fact({
		schemaVersion: D45_FACT_SCHEMA,
		sequence: state.nextFactSequence++,
		factKind: "provider-wire-admitted",
		effectDigest: effect.effectDigest,
		requestDigest: effect.requestDigest,
		admissionDigest: effect.admissionDigest,
		logicalRequestDigest: effect.logicalRequestDigest,
		wireDigest,
	});
	emit(state, { projection, runtime: null });
}

export function readD45ToolArguments(
	authority: D45GraphToolAuthorityV1,
	effect: D45AdmittedEffectV1,
): D45ToolArgumentsV1 {
	const state = stateFor(authority);
	if (
		state.active !== effect ||
		effectOwners.get(effect) !== authority ||
		effect.effectKind !== "tool-action"
	)
		throw new TypeError("D45 tool capability is forged, substituted, or stale");
	const pending = state.pendingTools[0];
	if (pending === undefined || pending.projection.argumentsDigest !== effect.argumentsDigest)
		throw new TypeError("D45 tool capability lost proposal provenance");
	if (pending.materialRead) throw new TypeError("D45 tool capability is one-shot");
	pending.materialRead = true;
	return strictSnapshot(pending.arguments) as D45ToolArgumentsV1;
}

export function admitD45EffectResult(
	authority: D45GraphToolAuthorityV1,
	effect: D45AdmittedEffectV1,
	value: D45EffectResultInputV1,
): void {
	const state = stateFor(authority);
	if (state.active !== effect || effectOwners.get(effect) !== authority)
		throw new TypeError("D45 effect is forged, substituted, or replayed");
	let runtime:
		| ProviderRuntimeResult
		| WorkspaceFreshnessRuntimeResult
		| ToolRuntimeResult
		| LocalRuntimeResult;
	let projection: D45FactV1;
	if (effect.effectKind === "provider-proposal") {
		if (!state.providerMaterialRead)
			throw new TypeError("D45 provider result arrived before material capability access");
		if (state.activeWireDigest === null)
			throw new TypeError("D45 provider result arrived before final wire admission");
		runtime = validateProviderResult(state, effect, value);
		if (
			runtime.projection.wireDigest !== null &&
			runtime.projection.wireDigest !== state.activeWireDigest
		)
			throw new TypeError("D45 provider result wire drifted from Graph admission");
		projection = fact({
			schemaVersion: D45_FACT_SCHEMA,
			sequence: state.nextFactSequence++,
			factKind: "provider-result",
			effectDigest: effect.effectDigest,
			requestDigest: effect.requestDigest,
			admissionDigest: effect.admissionDigest,
			result: runtime.projection,
		});
	} else if (effect.effectKind === "workspace-freshness") {
		runtime = validateWorkspaceFreshnessResult(state, effect, value);
		projection = fact({
			schemaVersion: D45_FACT_SCHEMA,
			sequence: state.nextFactSequence++,
			factKind: "workspace-freshness-result",
			effectDigest: effect.effectDigest,
			requestDigest: effect.requestDigest,
			admissionDigest: effect.admissionDigest,
			result: runtime.projection,
		});
	} else if (effect.effectKind === "tool-action") {
		const pending = state.pendingTools[0];
		if (pending === undefined || !pending.materialRead)
			throw new TypeError("D45 tool result arrived before capability access");
		runtime = validateToolResult(effect, value);
		if (
			runtime.input.causeCode !== "workspace-state-drift" &&
			runtime.input.workspaceStateBeforeDigest !== state.workspaceStateDigest
		)
			throw new TypeError("D45 tool result used stale workspace state");
		projection = fact({
			schemaVersion: D45_FACT_SCHEMA,
			sequence: state.nextFactSequence++,
			factKind: "tool-result",
			effectDigest: effect.effectDigest,
			requestDigest: effect.requestDigest,
			admissionDigest: effect.admissionDigest,
			result: runtime.projection,
		});
	} else {
		runtime = validateLocalResult(effect, value);
		projection = fact({
			schemaVersion: D45_FACT_SCHEMA,
			sequence: state.nextFactSequence++,
			factKind: "local-result",
			effectDigest: effect.effectDigest,
			requestDigest: effect.requestDigest,
			admissionDigest: effect.admissionDigest,
			result: runtime.projection,
		});
	}
	emit(state, { projection, runtime } as RuntimeFact);
	effectOwners.delete(effect);
}

function deriveD45Budget(
	facts: readonly D45FactV1[],
	active: D45AdmittedEffectV1 | null = null,
	activeWireDigest: string | null = null,
): D45BudgetProjectionV1 {
	const effects = new Map<string, D45AdmittedEffectV1>();
	for (const item of facts) {
		if (item.factKind === "effect-admitted") {
			effects.set(item.effect.effectDigest, item.effect);
		}
	}
	let providerAttempts = 0;
	let confirmedCostMicrousd = 0;
	let confirmedElapsedMs = 0;
	let effectResults = 0;
	for (const item of facts) {
		if (
			item.factKind !== "provider-result" &&
			item.factKind !== "workspace-freshness-result" &&
			item.factKind !== "tool-result" &&
			item.factKind !== "local-result"
		)
			continue;
		const effect = effects.get(item.effectDigest);
		if (effect === undefined) throw new TypeError("D45 budget result lost its admitted effect");
		effectResults += 1;
		if (item.factKind === "provider-result") {
			providerAttempts += 1;
			confirmedCostMicrousd += item.result.reconciledCostMicrousd;
			confirmedElapsedMs += item.result.reconciledElapsedMs;
		} else if (item.factKind === "workspace-freshness-result") {
			confirmedElapsedMs += item.result.elapsedMs;
		} else {
			const executorFailed =
				item.factKind === "tool-result"
					? item.result.causeCode === "executor-failed"
					: item.result.outcome === "executor-failed";
			confirmedElapsedMs += executorFailed ? effect.elapsedReservationMs : item.result.elapsedMs;
		}
	}
	if (active !== null) {
		confirmedElapsedMs += active.elapsedReservationMs;
		if (active.effectKind === "provider-proposal" && activeWireDigest !== null) {
			providerAttempts += 1;
			confirmedCostMicrousd += active.providerReservationMicrousd;
		}
	}
	return Object.freeze({
		providerAttempts,
		confirmedCostMicrousd,
		confirmedElapsedMs,
		effectResults,
	});
}

function deriveD45Findings(facts: readonly D45FactV1[]) {
	const findings: Array<
		Readonly<{ factSequence: number; effectDigest: string; causeCode: string }>
	> = [];
	for (const item of facts) {
		if (item.factKind === "provider-result" && item.result.responseRejectionCode !== null)
			findings.push(
				Object.freeze({
					factSequence: item.sequence,
					effectDigest: item.effectDigest,
					causeCode: `provider-response-${item.result.responseRejectionCode}`,
				}),
			);
		else if (item.factKind === "provider-result" && item.result.proposalRejectionCode !== null)
			findings.push(
				Object.freeze({
					factSequence: item.sequence,
					effectDigest: item.effectDigest,
					causeCode: `provider-proposal-${item.result.proposalRejectionCode}`,
				}),
			);
		else if (item.factKind === "provider-result" && item.result.outcome !== "success")
			findings.push(
				Object.freeze({
					factSequence: item.sequence,
					effectDigest: item.effectDigest,
					causeCode: `provider-result-${item.result.outcome}`,
				}),
			);
		else if (item.factKind === "workspace-freshness-result" && !item.result.fresh)
			findings.push(
				Object.freeze({
					factSequence: item.sequence,
					effectDigest: item.effectDigest,
					causeCode: "workspace-state-drift",
				}),
			);
		else if (item.factKind === "tool-result" && item.result.causeCode !== null)
			findings.push(
				Object.freeze({
					factSequence: item.sequence,
					effectDigest: item.effectDigest,
					causeCode: item.result.causeCode,
				}),
			);
	}
	return Object.freeze(findings);
}

function evidenceMaterial(state: State) {
	const lifecycle = snapshotGraphHarnessEvidence(state.inner);
	const budget = deriveD45Budget(state.facts);
	const proposalCount = state.facts
		.filter((item) => item.factKind === "provider-result")
		.reduce(
			(total, item) =>
				total +
				(item as Extract<D45FactV1, { factKind: "provider-result" }>).result.toolCalls.length,
			0,
		);
	const admittedToolCount = state.facts.filter(
		(item) => item.factKind === "effect-admitted" && item.effect.effectKind === "tool-action",
	).length;
	const completedToolCount = state.facts.filter((item) => item.factKind === "tool-result").length;
	return strictSnapshot({
		schemaVersion: D45_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D61" as const,
		authorityRevision: D45_AUTHORITY_REVISION,
		facts: state.facts,
		lifecycle,
		findings: deriveD45Findings(state.facts),
		budget,
		proposalCount,
		admittedToolCount,
		completedToolCount,
		proposalToolBijection:
			proposalCount === admittedToolCount && admittedToolCount === completedToolCount,
		maxActiveEffectsObserved: 1 as const,
		rawMaterialPersisted: false as const,
		exactSixArmsCompleted: lifecycle.exactSixArmsCompleted,
		frozenGateWouldPass:
			lifecycle.frozenGateWouldPass &&
			budget.providerAttempts <= lifecycle.campaign.maxProviderAttempts &&
			budget.confirmedCostMicrousd <= lifecycle.campaign.maxCostMicrousd &&
			budget.confirmedElapsedMs <= lifecycle.campaign.maxElapsedMs,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
}

export function snapshotD45PartialCanonicalEvidence(
	authority: D45GraphToolAuthorityV1,
): D45PartialCanonicalEvidenceV1 {
	const state = stateFor(authority);
	const terminalCauseCode: D45PartialCanonicalEvidenceV1["terminalCauseCode"] =
		state.active?.effectKind === "provider-proposal"
			? "provider-interrupted"
			: state.active?.effectKind === "workspace-freshness" ||
					state.active?.effectKind === "tool-action" ||
					state.pendingTools.length > 0
				? "tool-interrupted"
				: state.active?.effectKind === "local-effect"
					? "local-effect-interrupted"
					: "persistence-interrupted";
	const material = strictSnapshot({
		schemaVersion: D45_PARTIAL_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D61" as const,
		authorityRevision: D45_AUTHORITY_REVISION,
		terminalCauseCode,
		facts: state.facts,
		activeEffectDigest: state.active?.effectDigest ?? null,
		activeWireDigest: state.activeWireDigest,
		budget: deriveD45Budget(state.facts, state.active, state.activeWireDigest),
		lifecycleComplete: false as const,
		rawMaterialPersisted: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

/** Graph-derived, material-free diagnostics; never an admission or evidence side ledger. */
export function snapshotD68GraphProgress(authority: D45GraphToolAuthorityV1): D68GraphProgressV1 {
	const state = stateFor(authority);
	const budget = deriveD45Budget(state.facts, state.active, state.activeWireDigest);
	const effects = new Map<string, D45AdmittedEffectV1>();
	for (const item of state.facts)
		if (item.factKind === "effect-admitted") effects.set(item.effect.effectDigest, item.effect);
	const completedArms = new Set<D43AdmittedEffectV1["arm"]>();
	for (const item of state.facts) {
		if (item.factKind !== "local-result") continue;
		const effect = effects.get(item.effectDigest);
		if (effect?.sourceD43EffectKind === "cleanup") completedArms.add(effect.arm);
	}
	const material = strictSnapshot({
		schemaVersion: "graphrefly-ts.d68.graph-progress.v1" as const,
		activeArm: state.active?.arm ?? null,
		activeEffectKind: state.active?.effectKind ?? null,
		activePhase: state.active?.phase ?? null,
		activeElapsedReservationMs: state.active?.elapsedReservationMs ?? 0,
		factSequence: state.nextFactSequence - 1,
		completedArmCount: completedArms.size,
		providerAttempts: budget.providerAttempts,
		confirmedCostMicrousd: budget.confirmedCostMicrousd,
		confirmedElapsedMs: budget.confirmedElapsedMs,
		remainingProviderAttempts: Math.max(
			0,
			state.campaign.maxProviderAttempts - budget.providerAttempts,
		),
		remainingCostMicrousd: Math.max(
			0,
			state.campaign.maxCostMicrousd - budget.confirmedCostMicrousd,
		),
		remainingElapsedMs: Math.max(0, state.campaign.maxElapsedMs - budget.confirmedElapsedMs),
	});
	return Object.freeze({ ...material, progressDigest: empiricalStrictJsonDigest(material) });
}

function assertNoD45RawMaterial(value: unknown, path = "D45 partial evidence"): void {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) assertNoD45RawMaterial(item, `${path}[${index}]`);
		return;
	}
	if (value === null || typeof value !== "object") return;
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (
			["body", "content", "error", "headers", "message", "newText", "oldText", "stack"].includes(
				key,
			)
		)
			throw new TypeError(`${path} carried forbidden raw material key ${key}`);
		assertNoD45RawMaterial(item, `${path}.${key}`);
	}
}

export function validateD45PartialCanonicalEvidence(value: unknown): D45PartialCanonicalEvidenceV1 {
	const candidate = record(value, "D45 partial evidence");
	exactKeys(
		candidate,
		[
			"activeEffectDigest",
			"activeWireDigest",
			"authorityRevision",
			"budget",
			"causalAttribution",
			"decisionRef",
			"efficacyClaim",
			"evidenceDigest",
			"facts",
			"lifecycleComplete",
			"rawMaterialPersisted",
			"schemaVersion",
			"terminalCauseCode",
		],
		"D45 partial evidence",
	);
	if (
		candidate.schemaVersion !== D45_PARTIAL_EVIDENCE_SCHEMA ||
		candidate.decisionRef !== "graphrefly-ts:D61" ||
		candidate.authorityRevision !== D45_AUTHORITY_REVISION ||
		candidate.lifecycleComplete !== false ||
		candidate.rawMaterialPersisted !== false ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none"
	)
		throw new TypeError("D45 partial evidence fixed coordinate drifted");
	const terminalCauseCode = oneOf(
		candidate.terminalCauseCode,
		[
			"provider-interrupted",
			"tool-interrupted",
			"local-effect-interrupted",
			"persistence-interrupted",
		] as const,
		"D45 partial terminal cause",
	);
	assertNoD45RawMaterial(candidate.facts);
	const facts = array(candidate.facts, "D45 partial facts") as unknown as D45FactV1[];
	const seenAdmissions = new Set<string>();
	const seenResults = new Set<string>();
	let temporalActive: D45AdmittedEffectV1 | null = null;
	let temporalWire: string | null = null;
	let pendingToolCount = 0;
	for (const [index, factValue] of facts.entries()) {
		const item = record(factValue, `D45 partial fact[${index}]`);
		if (item.sequence !== index + 1 || item.schemaVersion !== D45_FACT_SCHEMA)
			throw new TypeError("D45 partial fact coordinate drifted");
		const { factDigest: suppliedFactDigest, ...factMaterial } = item;
		if (
			digest(suppliedFactDigest, `D45 partial fact[${index}].factDigest`) !==
			empiricalStrictJsonDigest(factMaterial)
		)
			throw new TypeError("D45 partial fact digest drifted");
		if (item.factKind === "effect-admitted") {
			exactKeys(
				item,
				["effect", "factDigest", "factKind", "schemaVersion", "sequence"],
				`D45 partial fact[${index}]`,
			);
			const effect = item.effect as D45AdmittedEffectV1;
			exactKeys(
				record(item.effect, `D45 partial fact[${index}].effect`),
				[
					"admissionDigest",
					"argumentsBytes",
					"argumentsDigest",
					"arm",
					"effectDigest",
					"effectKind",
					"elapsedReservationMs",
					"endpointProtocol",
					"logicalRequestDigest",
					"maxOutputTokens",
					"modelRef",
					"namedToolChoiceEncoding",
					"responseContractRevision",
					"path",
					"phase",
					"planDigest",
					"profileResolutionDigest",
					"providerRef",
					"providerReservationMicrousd",
					"reasoningEffort",
					"requestDigest",
					"requireParameters",
					"retainsInspectionSpan",
					"schemaVersion",
					"sequence",
					"sourceD43EffectDigest",
					"sourceD43EffectKind",
					"sourceD43RequestDigest",
					"sourceD43Sequence",
					"taskEnvelopeDigest",
					"toolCount",
					"toolOrdinal",
					"toolRef",
					"workspaceStateDigest",
				],
				`D45 partial fact[${index}].effect`,
			);
			if (temporalActive !== null || seenAdmissions.has(effect.effectDigest))
				throw new TypeError("D45 partial facts duplicated or overlapped an admission");
			const { effectDigest: suppliedEffectDigest, ...effectMaterial } = effect;
			if (
				digest(suppliedEffectDigest, "D45 partial effectDigest") !==
				empiricalStrictJsonDigest(effectMaterial)
			)
				throw new TypeError("D45 partial effect digest drifted");
			seenAdmissions.add(effect.effectDigest);
			temporalActive = effect;
			temporalWire = null;
			continue;
		}
		const effectDigest = digest(item.effectDigest, `D45 partial fact[${index}].effectDigest`);
		if (temporalActive?.effectDigest !== effectDigest)
			throw new TypeError("D45 partial result lost temporal admission");
		if (
			item.requestDigest !== temporalActive.requestDigest ||
			item.admissionDigest !== temporalActive.admissionDigest
		)
			throw new TypeError("D45 partial result request/admission provenance drifted");
		if (item.factKind === "provider-wire-admitted") {
			exactKeys(
				item,
				[
					"admissionDigest",
					"effectDigest",
					"factDigest",
					"factKind",
					"logicalRequestDigest",
					"requestDigest",
					"schemaVersion",
					"sequence",
					"wireDigest",
				],
				`D45 partial fact[${index}]`,
			);
			if (temporalActive.effectKind !== "provider-proposal" || temporalWire !== null)
				throw new TypeError("D45 partial wire fact drifted");
			temporalWire = digest(item.wireDigest, "D45 partial wireDigest");
			continue;
		}
		if (
			item.factKind !== "provider-result" &&
			item.factKind !== "workspace-freshness-result" &&
			item.factKind !== "tool-result" &&
			item.factKind !== "local-result"
		)
			throw new TypeError("D45 partial fact kind drifted");
		exactKeys(
			item,
			[
				"admissionDigest",
				"effectDigest",
				"factDigest",
				"factKind",
				"requestDigest",
				"result",
				"schemaVersion",
				"sequence",
			],
			`D45 partial fact[${index}]`,
		);
		const resultShape = record(item.result, `D45 partial fact[${index}].result`);
		if (item.factKind === "provider-result")
			exactKeys(
				resultShape,
				[
					"costMicrousd",
					"elapsedMs",
					"outcome",
					"proposalDigest",
					"proposalRejectionCode",
					"responseRejectionCode",
					"reconciledCostMicrousd",
					"reconciledElapsedMs",
					"reconciliationDigest",
					"retryClass",
					"toolCalls",
					"usage",
					"wireDigest",
				],
				`D45 partial fact[${index}].result`,
			);
		else if (item.factKind === "workspace-freshness-result")
			exactKeys(
				resultShape,
				[
					"argumentsDigest",
					"elapsedMs",
					"evidenceDigest",
					"expectedWorkspaceStateDigest",
					"fresh",
					"observedWorkspaceStateDigest",
					"proposalDigest",
				],
				`D45 partial fact[${index}].result`,
			);
		else if (item.factKind === "tool-result")
			exactKeys(
				resultShape,
				[
					"causeCode",
					"contentBytes",
					"contentDigest",
					"elapsedMs",
					"evidenceDigest",
					"status",
					"workspaceStateAfterDigest",
					"workspaceStateBeforeDigest",
				],
				`D45 partial fact[${index}].result`,
			);
		else
			exactKeys(
				resultShape,
				temporalActive.sourceD43EffectKind === "public-semantic-validation" ||
					temporalActive.sourceD43EffectKind === "hidden-verifier"
					? [
							"criteria",
							"effectKind",
							"elapsedMs",
							"evidenceDigest",
							"outcome",
							"sourceSnapshotDigest",
							"workspaceStateDigest",
						]
					: [
							"criteria",
							"effectKind",
							"elapsedMs",
							"evidenceDigest",
							"outcome",
							"workspaceStateDigest",
						],
				`D45 partial fact[${index}].result`,
			);
		if (seenResults.has(effectDigest)) throw new TypeError("D45 partial duplicated a result");
		if (item.factKind === "provider-result") {
			const result = record(item.result, "D45 partial provider result");
			validatePersistedProviderProjection(result, "D45 partial provider result");
			pendingToolCount = array(result.toolCalls, "D45 partial provider tools").length;
			if (temporalWire !== result.wireDigest)
				throw new TypeError("D45 partial provider result lost final-wire binding");
			if (
				result.reconciliationDigest !==
				empiricalStrictJsonDigest({
					requestDigest: temporalActive.requestDigest,
					admissionDigest: temporalActive.admissionDigest,
					actualCostMicrousd: result.costMicrousd,
					reconciledCostMicrousd: result.reconciledCostMicrousd,
					actualElapsedMs: result.elapsedMs,
					reconciledElapsedMs: result.reconciledElapsedMs,
					usage: result.usage,
				})
			)
				throw new TypeError("D45 partial provider reconciliation drifted");
		} else if (item.factKind === "workspace-freshness-result") {
			const result = resultShape;
			validatePersistedResultProjection(
				"workspace-freshness-result",
				result,
				temporalActive,
				"D45 partial workspace freshness result",
			);
			if (
				temporalActive.effectKind !== "workspace-freshness" ||
				result.argumentsDigest !== temporalActive.argumentsDigest ||
				result.expectedWorkspaceStateDigest !== temporalActive.workspaceStateDigest ||
				result.fresh !==
					(result.expectedWorkspaceStateDigest === result.observedWorkspaceStateDigest)
			)
				throw new TypeError("D45 partial workspace freshness provenance drifted");
			if (result.fresh === false) pendingToolCount = 0;
		} else if (item.factKind === "tool-result") {
			validatePersistedResultProjection(
				"tool-result",
				resultShape,
				temporalActive,
				"D45 partial tool result",
			);
			if (resultShape.status === "failed") pendingToolCount = 0;
			else pendingToolCount = Math.max(0, pendingToolCount - 1);
		} else {
			validatePersistedResultProjection(
				"local-result",
				resultShape,
				temporalActive,
				"D45 partial local result",
			);
		}
		seenResults.add(effectDigest);
		temporalActive = null;
		temporalWire = null;
	}
	const activeEffectDigest =
		candidate.activeEffectDigest === null
			? null
			: digest(candidate.activeEffectDigest, "D45 partial activeEffectDigest");
	const activeWireDigest =
		candidate.activeWireDigest === null
			? null
			: digest(candidate.activeWireDigest, "D45 partial activeWireDigest");
	if (
		activeEffectDigest !== (temporalActive?.effectDigest ?? null) ||
		activeWireDigest !== temporalWire
	)
		throw new TypeError("D45 partial active coordinate drifted from canonical facts");
	const derivedTerminalCauseCode: D45PartialCanonicalEvidenceV1["terminalCauseCode"] =
		temporalActive?.effectKind === "provider-proposal"
			? "provider-interrupted"
			: temporalActive?.effectKind === "workspace-freshness" ||
					temporalActive?.effectKind === "tool-action" ||
					pendingToolCount > 0
				? "tool-interrupted"
				: temporalActive?.effectKind === "local-effect"
					? "local-effect-interrupted"
					: "persistence-interrupted";
	if (terminalCauseCode !== derivedTerminalCauseCode)
		throw new TypeError("D45 partial terminal cause drifted from Graph state");
	const budget = deriveD45Budget(facts, temporalActive, temporalWire);
	if (empiricalStrictJsonDigest(candidate.budget) !== empiricalStrictJsonDigest(budget))
		throw new TypeError("D45 partial budget drifted from canonical facts");
	const { evidenceDigest: suppliedEvidenceDigest, ...material } = candidate;
	if (
		digest(suppliedEvidenceDigest, "D45 partial evidenceDigest") !==
		empiricalStrictJsonDigest(material)
	)
		throw new TypeError("D45 partial evidence digest drifted");
	return strictSnapshot(candidate) as unknown as D45PartialCanonicalEvidenceV1;
}

export function snapshotD45CanonicalEvidence(
	authority: D45GraphToolAuthorityV1,
): D45CanonicalEvidenceV1 {
	const material = evidenceMaterial(stateFor(authority));
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

function replayD43Lifecycle(value: unknown): GraphHarnessEvidence {
	return validateGraphHarnessEvidence(value);
}

function validateD45LifecycleBijection(
	facts: readonly D45FactV1[],
	lifecycle: GraphHarnessEvidence,
) {
	const admittedByDigest = new Map<string, D45AdmittedEffectV1>();
	for (const item of facts) {
		if (item.factKind === "effect-admitted") {
			if (admittedByDigest.has(item.effect.effectDigest))
				throw new TypeError("D45 canonical facts duplicated an effect admission");
			admittedByDigest.set(item.effect.effectDigest, item.effect);
		}
	}
	const lifecycleEffects = lifecycle.facts.filter(
		(item): item is Extract<D43FactV1, { factKind: "effect-admitted" }> =>
			item.factKind === "effect-admitted",
	);
	const lifecycleResults = new Map(
		lifecycle.facts
			.filter(
				(item): item is Extract<D43FactV1, { factKind: "effect-result" }> =>
					item.factKind === "effect-result",
			)
			.map((item) => [item.effectDigest, item.result] as const),
	);
	const lifecycleEffectsByDigest = new Map(
		lifecycleEffects.map((item) => [item.effect.effectDigest, item.effect] as const),
	);
	const providerResultsByEffect = new Map(
		facts
			.filter(
				(item): item is Extract<D45FactV1, { factKind: "provider-result" }> =>
					item.factKind === "provider-result",
			)
			.map((item) => [item.effectDigest, item.result] as const),
	);
	const freshnessResultsByEffect = new Map(
		facts
			.filter(
				(item): item is Extract<D45FactV1, { factKind: "workspace-freshness-result" }> =>
					item.factKind === "workspace-freshness-result",
			)
			.map((item) => [item.effectDigest, item.result] as const),
	);
	const providerOuterBySource = new Map(
		[...admittedByDigest.values()]
			.filter((effect) => effect.effectKind === "provider-proposal")
			.map((effect) => [effect.sourceD43EffectDigest, effect] as const),
	);
	for (const effect of admittedByDigest.values()) {
		const requestMaterial = strictSnapshot({
			sequence: effect.sequence,
			effectKind: effect.effectKind,
			sourceD43EffectKind: effect.sourceD43EffectKind,
			sourceD43EffectDigest: effect.sourceD43EffectDigest,
			sourceD43RequestDigest: effect.sourceD43RequestDigest,
			sourceD43Sequence: effect.sourceD43Sequence,
			arm: effect.arm,
			phase: effect.phase,
			toolRef: effect.toolRef,
			toolOrdinal: effect.toolOrdinal,
			toolCount: effect.toolCount,
			path: effect.path,
			argumentsDigest: effect.argumentsDigest,
			argumentsBytes: effect.argumentsBytes,
			workspaceStateDigest: effect.workspaceStateDigest,
			logicalRequestDigest: effect.logicalRequestDigest,
			planDigest: effect.planDigest,
			profileResolutionDigest: effect.profileResolutionDigest,
			modelRef: effect.modelRef,
			providerRef: effect.providerRef,
			endpointProtocol: effect.endpointProtocol,
			namedToolChoiceEncoding: effect.namedToolChoiceEncoding,
			responseContractRevision: effect.responseContractRevision,
			reasoningEffort: effect.reasoningEffort,
			requireParameters: effect.requireParameters,
			taskEnvelopeDigest: effect.taskEnvelopeDigest,
			retainsInspectionSpan: effect.retainsInspectionSpan,
			maxOutputTokens: effect.maxOutputTokens,
		});
		if (effect.requestDigest !== empiricalStrictJsonDigest(requestMaterial))
			throw new TypeError("D45 outer request digest was not derived from its bounded coordinates");
		const source = lifecycleEffectsByDigest.get(effect.sourceD43EffectDigest);
		if (source === undefined) throw new TypeError("D45 effect lost its source lifecycle admission");
		const expectedAdmission =
			effect.effectKind === "tool-action" || effect.effectKind === "workspace-freshness"
				? (() => {
						const provider = providerOuterBySource.get(effect.sourceD43EffectDigest);
						const result = provider && providerResultsByEffect.get(provider.effectDigest);
						if (provider === undefined || result === undefined)
							throw new TypeError("D45 tool admission lost its provider proposal result");
						return empiricalStrictJsonDigest({
							requestDigest: effect.requestDigest,
							providerProposalDigest: result.proposalDigest,
							providerResultWireDigest: result.wireDigest,
							workspaceStateDigest: effect.workspaceStateDigest,
						});
					})()
				: empiricalStrictJsonDigest({
						requestDigest: effect.requestDigest,
						innerAdmissionDigest: source.admissionDigest,
						workspaceStateDigest: effect.workspaceStateDigest,
					});
		if (effect.admissionDigest !== expectedAdmission)
			throw new TypeError("D45 effect admission digest drifted from Graph provenance");
		const { effectDigest: suppliedEffectDigest, ...effectMaterial } = effect;
		if (suppliedEffectDigest !== empiricalStrictJsonDigest(effectMaterial))
			throw new TypeError("D45 effect digest drifted from admitted material");
	}
	for (const lifecycleEffect of lifecycleEffects) {
		const matches = [...admittedByDigest.values()].filter(
			(effect) =>
				(effect.effectKind === "provider-proposal" || effect.effectKind === "local-effect") &&
				effect.sourceD43EffectDigest === lifecycleEffect.effect.effectDigest,
		);
		if (matches.length !== 1)
			throw new TypeError("D45 lifecycle effect did not have one exact outer admission");
		const outer = matches[0]!;
		if (
			outer.sourceD43RequestDigest !== lifecycleEffect.effect.requestDigest ||
			outer.logicalRequestDigest !== lifecycleEffect.effect.logicalRequestDigest ||
			outer.sourceD43EffectKind !== lifecycleEffect.effect.kind ||
			outer.sourceD43Sequence !== lifecycleEffect.effect.sequence ||
			outer.arm !== lifecycleEffect.effect.arm ||
			outer.effectKind !==
				(lifecycleEffect.effect.providerEffect ? "provider-proposal" : "local-effect") ||
			outer.phase !==
				(lifecycleEffect.effect.kind === "inspection" || lifecycleEffect.effect.kind === "mutation"
					? lifecycleEffect.effect.kind
					: null) ||
			outer.planDigest !== lifecycleEffect.effect.planDigest ||
			outer.profileResolutionDigest !== lifecycleEffect.effect.profileResolutionDigest ||
			outer.modelRef !== lifecycleEffect.effect.modelRef ||
			outer.providerRef !== lifecycleEffect.effect.providerRef ||
			outer.endpointProtocol !== lifecycleEffect.effect.endpointProtocol ||
			outer.namedToolChoiceEncoding !== lifecycleEffect.effect.namedToolChoiceEncoding ||
			outer.responseContractRevision !== lifecycleEffect.effect.responseContractRevision ||
			outer.taskEnvelopeDigest !== lifecycleEffect.effect.taskEnvelopeDigest ||
			outer.retainsInspectionSpan !== lifecycleEffect.effect.retainsInspectionSpan ||
			outer.maxOutputTokens !== lifecycleEffect.effect.maxOutputTokens ||
			outer.providerReservationMicrousd !== lifecycleEffect.effect.providerReservationMicrousd ||
			outer.elapsedReservationMs !== lifecycleEffect.effect.elapsedReservationMs
		)
			throw new TypeError("D45 outer admission drifted from its lifecycle effect");
	}
	for (const item of facts) {
		if (item.factKind === "effect-admitted") continue;
		const effect = admittedByDigest.get(item.effectDigest);
		if (effect === undefined) throw new TypeError("D45 result lost its exact outer admission");
		if (
			item.requestDigest !== effect.requestDigest ||
			item.admissionDigest !== effect.admissionDigest
		)
			throw new TypeError("D45 result request/admission provenance drifted");
		if (item.factKind === "provider-wire-admitted") {
			if (
				effect.effectKind !== "provider-proposal" ||
				item.logicalRequestDigest !== effect.logicalRequestDigest
			)
				throw new TypeError("D45 provider wire lost its exact effect provenance");
			continue;
		}
		if (item.factKind === "provider-result") {
			if (effect.effectKind !== "provider-proposal")
				throw new TypeError("D45 provider result bound a non-provider effect");
			const expectedReconciliation = empiricalStrictJsonDigest({
				requestDigest: effect.requestDigest,
				admissionDigest: effect.admissionDigest,
				actualCostMicrousd: item.result.costMicrousd,
				reconciledCostMicrousd: item.result.reconciledCostMicrousd,
				actualElapsedMs: item.result.elapsedMs,
				reconciledElapsedMs: item.result.reconciledElapsedMs,
				usage: item.result.usage,
			});
			if (item.result.reconciliationDigest !== expectedReconciliation)
				throw new TypeError("D45 provider reconciliation digest drifted");
			const lifecycleResult = lifecycleResults.get(effect.sourceD43EffectDigest);
			if (
				lifecycleResult === undefined ||
				lifecycleResult.costMicrousd !== item.result.costMicrousd ||
				lifecycleResult.elapsedMs !== item.result.elapsedMs ||
				lifecycleResult.wireDigest !== item.result.wireDigest ||
				lifecycleResult.retryClass !== item.result.retryClass ||
				empiricalStrictJsonDigest(lifecycleResult.usage) !==
					empiricalStrictJsonDigest(item.result.usage)
			)
				throw new TypeError("D45 provider result lost lifecycle reconciliation binding");
			if (item.result.outcome !== "success" && lifecycleResult.outcome !== item.result.outcome)
				throw new TypeError("D45 terminal provider outcome drifted from lifecycle evidence");
		} else if (item.factKind === "workspace-freshness-result") {
			validatePersistedResultProjection(
				"workspace-freshness-result",
				item.result,
				effect,
				"D45 workspace freshness result",
			);
			if (
				effect.effectKind !== "workspace-freshness" ||
				item.result.argumentsDigest !== effect.argumentsDigest ||
				item.result.expectedWorkspaceStateDigest !== effect.workspaceStateDigest ||
				item.result.fresh !==
					(item.result.expectedWorkspaceStateDigest === item.result.observedWorkspaceStateDigest)
			)
				throw new TypeError("D45 workspace freshness result lost exact effect provenance");
		} else if (item.factKind === "tool-result") {
			validatePersistedResultProjection("tool-result", item.result, effect, "D45 tool result");
			if (effect.effectKind !== "tool-action")
				throw new TypeError("D45 tool result bound a non-tool effect");
		} else {
			validatePersistedResultProjection("local-result", item.result, effect, "D45 local result");
			if (effect.effectKind !== "local-effect")
				throw new TypeError("D45 local result bound a non-local effect");
			const lifecycleResult = lifecycleResults.get(effect.sourceD43EffectDigest);
			if (
				lifecycleResult === undefined ||
				lifecycleResult.outcome !== item.result.outcome ||
				lifecycleResult.elapsedMs !== item.result.elapsedMs ||
				empiricalStrictJsonDigest(lifecycleResult.criteria) !==
					empiricalStrictJsonDigest(item.result.criteria)
			)
				throw new TypeError("D45 local result lost lifecycle binding");
		}
	}
	const toolResults = new Set(
		facts
			.filter(
				(item): item is Extract<D45FactV1, { factKind: "tool-result" }> =>
					item.factKind === "tool-result",
			)
			.map((item) => item.effectDigest),
	);
	const wireCounts = new Map<string, number>();
	const resultCounts = new Map<string, number>();
	const wireByEffect = new Map<string, string>();
	for (const item of facts) {
		if (item.factKind === "provider-wire-admitted") {
			wireCounts.set(item.effectDigest, (wireCounts.get(item.effectDigest) ?? 0) + 1);
			wireByEffect.set(item.effectDigest, item.wireDigest);
		}
		if (
			item.factKind === "provider-result" ||
			item.factKind === "workspace-freshness-result" ||
			item.factKind === "tool-result" ||
			item.factKind === "local-result"
		)
			resultCounts.set(item.effectDigest, (resultCounts.get(item.effectDigest) ?? 0) + 1);
	}
	for (const effect of admittedByDigest.values()) {
		if (effect.effectKind === "tool-action" && !toolResults.has(effect.effectDigest))
			throw new TypeError("D45 admitted tool omitted its canonical result");
		if (effect.effectKind === "provider-proposal" && wireCounts.get(effect.effectDigest) !== 1)
			throw new TypeError("D45 provider effect did not have one exact final-wire admission");
		if (
			effect.effectKind === "provider-proposal" &&
			providerResultsByEffect.get(effect.effectDigest)?.wireDigest !==
				wireByEffect.get(effect.effectDigest)
		)
			throw new TypeError("D45 provider result drifted from its final-wire fact");
		if (resultCounts.get(effect.effectDigest) !== 1)
			throw new TypeError("D45 effect did not have exactly one canonical result");
	}
	let activeEffect: D45AdmittedEffectV1 | null = null;
	let activeWireSeen = false;
	const providerWireByLogicalRequest = new Map<string, string>();
	let freshnessArgumentsDigest: string | null = null;
	let freshnessWorkspaceStateDigest: string | null = null;
	for (const item of facts) {
		if (item.factKind === "effect-admitted") {
			if (activeEffect !== null)
				throw new TypeError("D45 canonical facts overlapped active effects");
			if (
				item.effect.effectKind === "tool-action" &&
				(freshnessArgumentsDigest !== item.effect.argumentsDigest ||
					freshnessWorkspaceStateDigest !== item.effect.workspaceStateDigest)
			)
				throw new TypeError(
					"D45 tool was released without its immediately preceding freshness fact",
				);
			activeEffect = item.effect;
			activeWireSeen = false;
			if (item.effect.effectKind === "tool-action") {
				freshnessArgumentsDigest = null;
				freshnessWorkspaceStateDigest = null;
			}
			continue;
		}
		if (item.factKind === "provider-wire-admitted") {
			if (
				activeEffect?.effectKind !== "provider-proposal" ||
				activeEffect.effectDigest !== item.effectDigest ||
				activeWireSeen
			)
				throw new TypeError("D45 final-wire fact was out of canonical order");
			const priorWire = providerWireByLogicalRequest.get(item.logicalRequestDigest);
			if (priorWire !== undefined && priorWire !== item.wireDigest)
				throw new TypeError("D45 canonical same-logical-request wire identity drifted");
			providerWireByLogicalRequest.set(item.logicalRequestDigest, item.wireDigest);
			activeWireSeen = true;
			continue;
		}
		if (activeEffect === null || activeEffect.effectDigest !== item.effectDigest)
			throw new TypeError("D45 result was out of canonical effect order");
		if (item.factKind === "provider-result" && !activeWireSeen)
			throw new TypeError("D45 provider result preceded its final-wire admission");
		if (item.factKind === "workspace-freshness-result") {
			freshnessArgumentsDigest = item.result.fresh ? item.result.argumentsDigest : null;
			freshnessWorkspaceStateDigest = item.result.fresh
				? item.result.expectedWorkspaceStateDigest
				: null;
		}
		activeEffect = null;
		activeWireSeen = false;
	}
	if (activeEffect !== null)
		throw new TypeError("D45 completed evidence retained an active effect");
	for (const [sourceDigest, provider] of providerOuterBySource) {
		const result = providerResultsByEffect.get(provider.effectDigest);
		if (result === undefined) throw new TypeError("D45 provider admission omitted its result");
		const freshnesses = [...admittedByDigest.values()]
			.filter(
				(effect) =>
					effect.effectKind === "workspace-freshness" &&
					effect.sourceD43EffectDigest === sourceDigest,
			)
			.sort((left, right) => (left.toolOrdinal ?? 0) - (right.toolOrdinal ?? 0));
		const tools = [...admittedByDigest.values()]
			.filter(
				(effect) =>
					effect.effectKind === "tool-action" && effect.sourceD43EffectDigest === sourceDigest,
			)
			.sort((left, right) => (left.toolOrdinal ?? 0) - (right.toolOrdinal ?? 0));
		if (tools.length > result.toolCalls.length)
			throw new TypeError("D45 admitted more tools than its exact provider proposal");
		if (
			freshnesses.length < tools.length ||
			freshnesses.length > tools.length + 1 ||
			(freshnesses.length === tools.length + 1 &&
				freshnessResultsByEffect.get(freshnesses.at(-1)!.effectDigest)?.fresh !== false)
		)
			throw new TypeError("D45 exact tools lost their one-to-one freshness admission");
		for (const [index, freshness] of freshnesses.entries()) {
			const proposed = result.toolCalls[index];
			if (
				proposed === undefined ||
				freshness.toolOrdinal !== index + 1 ||
				freshness.toolCount !== result.toolCalls.length ||
				freshness.toolRef !== null ||
				freshness.path !== proposed.path ||
				freshness.argumentsDigest !== proposed.argumentsDigest
			)
				throw new TypeError("D45 workspace freshness admission drifted from proposal ordinal");
		}
		for (const [index, tool] of tools.entries()) {
			const proposed = result.toolCalls[index];
			const freshness = freshnesses[index];
			if (
				proposed === undefined ||
				freshness === undefined ||
				freshnessResultsByEffect.get(freshness.effectDigest)?.fresh !== true ||
				tool.toolOrdinal !== index + 1 ||
				tool.toolCount !== result.toolCalls.length ||
				tool.toolRef !== proposed.toolRef ||
				tool.path !== proposed.path ||
				tool.argumentsDigest !== proposed.argumentsDigest ||
				tool.argumentsBytes !== proposed.argumentsBytes ||
				tool.phase !== provider.phase ||
				tool.planDigest !== provider.planDigest ||
				tool.profileResolutionDigest !== provider.profileResolutionDigest ||
				tool.modelRef !== provider.modelRef ||
				tool.providerRef !== provider.providerRef ||
				tool.endpointProtocol !== provider.endpointProtocol ||
				tool.namedToolChoiceEncoding !== provider.namedToolChoiceEncoding ||
				tool.responseContractRevision !== provider.responseContractRevision ||
				tool.reasoningEffort !== provider.reasoningEffort ||
				tool.requireParameters !== provider.requireParameters ||
				tool.taskEnvelopeDigest !== provider.taskEnvelopeDigest
			)
				throw new TypeError("D45 tool admission drifted from its exact proposal ordinal");
		}
		const lifecycleOutcome = lifecycleResults.get(sourceDigest)?.outcome;
		if (lifecycleOutcome === "success" && tools.length !== result.toolCalls.length)
			throw new TypeError("D45 successful composite omitted an admitted proposal tool");
	}
}

export function validateD45CanonicalEvidence(value: unknown): D45CanonicalEvidenceV1 {
	const candidate = record(value, "D45 evidence");
	exactKeys(
		candidate,
		[
			"admittedToolCount",
			"authorityRevision",
			"budget",
			"causalAttribution",
			"completedToolCount",
			"decisionRef",
			"efficacyClaim",
			"evidenceDigest",
			"exactSixArmsCompleted",
			"facts",
			"findings",
			"frozenGateWouldPass",
			"lifecycle",
			"maxActiveEffectsObserved",
			"proposalCount",
			"proposalToolBijection",
			"rawMaterialPersisted",
			"schemaVersion",
		],
		"D45 evidence",
	);
	if (
		candidate.schemaVersion !== D45_EVIDENCE_SCHEMA ||
		candidate.decisionRef !== "graphrefly-ts:D61" ||
		candidate.authorityRevision !== D45_AUTHORITY_REVISION ||
		candidate.maxActiveEffectsObserved !== 1 ||
		candidate.rawMaterialPersisted !== false ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none"
	)
		throw new TypeError("D45 evidence fixed coordinate drifted");
	const facts = array(candidate.facts, "D45 evidence facts") as unknown as D45FactV1[];
	for (let index = 0; index < facts.length; index += 1) {
		const item = record(facts[index], `D45 fact[${index}]`);
		if (item.sequence !== index + 1) throw new TypeError("D45 fact sequence drifted");
		const factKind = oneOf(
			item.factKind,
			[
				"effect-admitted",
				"provider-wire-admitted",
				"provider-result",
				"workspace-freshness-result",
				"tool-result",
				"local-result",
			] as const,
			`D45 fact[${index}].factKind`,
		);
		if (factKind === "effect-admitted") {
			exactKeys(
				item,
				["effect", "factDigest", "factKind", "schemaVersion", "sequence"],
				`D45 fact[${index}]`,
			);
			const effect = record(item.effect, `D45 fact[${index}].effect`);
			exactKeys(
				effect,
				[
					"admissionDigest",
					"argumentsBytes",
					"argumentsDigest",
					"arm",
					"effectDigest",
					"effectKind",
					"elapsedReservationMs",
					"endpointProtocol",
					"logicalRequestDigest",
					"maxOutputTokens",
					"modelRef",
					"namedToolChoiceEncoding",
					"responseContractRevision",
					"path",
					"phase",
					"planDigest",
					"profileResolutionDigest",
					"providerRef",
					"providerReservationMicrousd",
					"reasoningEffort",
					"requestDigest",
					"requireParameters",
					"retainsInspectionSpan",
					"schemaVersion",
					"sequence",
					"sourceD43EffectDigest",
					"sourceD43EffectKind",
					"sourceD43RequestDigest",
					"sourceD43Sequence",
					"taskEnvelopeDigest",
					"toolCount",
					"toolOrdinal",
					"toolRef",
					"workspaceStateDigest",
				],
				`D45 fact[${index}].effect`,
			);
			if (
				effect.schemaVersion !== D45_EFFECT_SCHEMA ||
				effect.reasoningEffort !== "high" ||
				effect.requireParameters !== true
			)
				throw new TypeError("D45 admitted effect fixed route coordinate drifted");
		} else if (factKind === "provider-wire-admitted") {
			exactKeys(
				item,
				[
					"admissionDigest",
					"effectDigest",
					"factDigest",
					"factKind",
					"logicalRequestDigest",
					"requestDigest",
					"schemaVersion",
					"sequence",
					"wireDigest",
				],
				`D45 fact[${index}]`,
			);
			digest(item.wireDigest, `D45 fact[${index}].wireDigest`);
		} else {
			exactKeys(
				item,
				[
					"admissionDigest",
					"effectDigest",
					"factDigest",
					"factKind",
					"requestDigest",
					"result",
					"schemaVersion",
					"sequence",
				],
				`D45 fact[${index}]`,
			);
			const result = record(item.result, `D45 fact[${index}].result`);
			if (factKind === "provider-result") {
				exactKeys(
					result,
					[
						"costMicrousd",
						"elapsedMs",
						"outcome",
						"proposalDigest",
						"proposalRejectionCode",
						"responseRejectionCode",
						"reconciledCostMicrousd",
						"reconciledElapsedMs",
						"reconciliationDigest",
						"retryClass",
						"toolCalls",
						"usage",
						"wireDigest",
					],
					`D45 fact[${index}].result`,
				);
				for (const [callIndex, callValue] of array(
					result.toolCalls,
					"D45 tool projections",
				).entries()) {
					const call = record(callValue, `D45 tool projection[${callIndex}]`);
					exactKeys(
						call,
						[
							"argumentsBytes",
							"argumentsDigest",
							"newTextBytes",
							"oldTextBytes",
							"path",
							"toolRef",
						],
						`D45 tool projection[${callIndex}]`,
					);
				}
				validatePersistedProviderProjection(result, `D45 fact[${index}].result`);
			} else if (factKind === "workspace-freshness-result") {
				exactKeys(
					result,
					[
						"argumentsDigest",
						"elapsedMs",
						"evidenceDigest",
						"expectedWorkspaceStateDigest",
						"fresh",
						"observedWorkspaceStateDigest",
						"proposalDigest",
					],
					`D45 fact[${index}].result`,
				);
			} else if (factKind === "tool-result") {
				exactKeys(
					result,
					[
						"causeCode",
						"contentBytes",
						"contentDigest",
						"elapsedMs",
						"evidenceDigest",
						"status",
						"workspaceStateAfterDigest",
						"workspaceStateBeforeDigest",
					],
					`D45 fact[${index}].result`,
				);
			} else {
				exactKeys(
					result,
					Object.hasOwn(result, "sourceSnapshotDigest")
						? [
								"criteria",
								"effectKind",
								"elapsedMs",
								"evidenceDigest",
								"outcome",
								"sourceSnapshotDigest",
								"workspaceStateDigest",
							]
						: [
								"criteria",
								"effectKind",
								"elapsedMs",
								"evidenceDigest",
								"outcome",
								"workspaceStateDigest",
							],
					`D45 fact[${index}].result`,
				);
			}
		}
		const { factDigest: supplied, ...material } = item;
		if (digest(supplied, `D45 fact[${index}].factDigest`) !== empiricalStrictJsonDigest(material))
			throw new TypeError("D45 fact digest drifted");
	}
	const lifecycle = replayD43Lifecycle(candidate.lifecycle);
	validateD45LifecycleBijection(facts, lifecycle);
	if (
		empiricalStrictJsonDigest(candidate.findings) !==
		empiricalStrictJsonDigest(deriveD45Findings(facts))
	)
		throw new TypeError("D45 findings drifted from canonical Graph facts");
	const budgetCandidate = record(candidate.budget, "D45 evidence budget");
	exactKeys(
		budgetCandidate,
		["confirmedCostMicrousd", "confirmedElapsedMs", "effectResults", "providerAttempts"],
		"D45 evidence budget",
	);
	const budget = Object.freeze({
		providerAttempts: safeInteger(budgetCandidate.providerAttempts, "D45 budget providerAttempts"),
		confirmedCostMicrousd: safeInteger(
			budgetCandidate.confirmedCostMicrousd,
			"D45 budget confirmedCostMicrousd",
		),
		confirmedElapsedMs: safeInteger(
			budgetCandidate.confirmedElapsedMs,
			"D45 budget confirmedElapsedMs",
		),
		effectResults: safeInteger(budgetCandidate.effectResults, "D45 budget effectResults"),
	});
	if (empiricalStrictJsonDigest(budget) !== empiricalStrictJsonDigest(deriveD45Budget(facts)))
		throw new TypeError("D45 budget projection drifted from canonical facts");
	const proposalCount = safeInteger(candidate.proposalCount, "D45 proposalCount");
	const admittedToolCount = safeInteger(candidate.admittedToolCount, "D45 admittedToolCount");
	const completedToolCount = safeInteger(candidate.completedToolCount, "D45 completedToolCount");
	const derivedProposalCount = facts
		.filter((item) => item.factKind === "provider-result")
		.reduce(
			(total, item) =>
				total +
				(item as Extract<D45FactV1, { factKind: "provider-result" }>).result.toolCalls.length,
			0,
		);
	const derivedAdmitted = facts.filter(
		(item) => item.factKind === "effect-admitted" && item.effect.effectKind === "tool-action",
	).length;
	const derivedCompleted = facts.filter((item) => item.factKind === "tool-result").length;
	if (
		proposalCount !== derivedProposalCount ||
		admittedToolCount !== derivedAdmitted ||
		completedToolCount !== derivedCompleted ||
		candidate.proposalToolBijection !==
			(proposalCount === admittedToolCount && admittedToolCount === completedToolCount) ||
		candidate.exactSixArmsCompleted !== lifecycle.exactSixArmsCompleted ||
		candidate.frozenGateWouldPass !==
			(lifecycle.frozenGateWouldPass &&
				budget.providerAttempts <= lifecycle.campaign.maxProviderAttempts &&
				budget.confirmedCostMicrousd <= lifecycle.campaign.maxCostMicrousd &&
				budget.confirmedElapsedMs <= lifecycle.campaign.maxElapsedMs)
	)
		throw new TypeError("D45 evidence derived projection drifted");
	const { evidenceDigest: supplied, ...material } = candidate;
	if (digest(supplied, "D45 evidenceDigest") !== empiricalStrictJsonDigest(material))
		throw new TypeError("D45 evidence digest drifted");
	return strictSnapshot(candidate) as unknown as D45CanonicalEvidenceV1;
}
