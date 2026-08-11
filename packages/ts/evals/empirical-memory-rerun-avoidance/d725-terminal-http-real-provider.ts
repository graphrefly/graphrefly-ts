import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type { D719CleanBudgetLimitsV1 } from "./d719-clean-graph-ledger.js";
import {
	type D720EffectResultV1,
	validateD720GraphEffectResult,
} from "./d722-graph-native-effect-runtime.js";
import type {
	D720CallerEffectExecutionInputV2,
	D720EffectCeilingsV2,
	D722GraphNativeEvalCoreV1,
} from "./d722-graph-native-eval.js";
import {
	consumeD723AdapterReceipt,
	createD723RealProviderAdapter,
	type D723AdapterReceiptV1,
	type D723EffectPortV1,
	runD723RealProviderAdapter,
} from "./d723-graph-native-real-provider.js";
import {
	D723_OPENROUTER_GRAPH_TURN_REVISION,
	type D723OpenRouterConversationV1,
	type D723OpenRouterTurnV1,
	invokeD723OpenRouterGraphTurn,
} from "./d723-openrouter-graph-turn.js";
import {
	admitD724TerminalHttpEvidence,
	createD724TerminalHttpAuthority,
	createD724TerminalHttpEvidence,
	type D724TerminalHttpEvidenceV1,
	type D724TerminalHttpGraphEvidenceV1,
	snapshotD724TerminalHttpGraphEvidence,
	validateD724TerminalHttpGraphEvidence,
} from "./d724-terminal-http-evidence.js";
import { D725_IMPLEMENTATION_MANIFEST_DIGEST } from "./d725-implementation-manifest.js";
import type {
	OpenRouterResponsesByteTransportV1,
	OpenRouterResponsesCredentialCapabilityV1,
	OpenRouterResponsesTransportRequestV1,
	OpenRouterResponsesTransportResponseV1,
} from "./openrouter-responses-model-turn.js";

export const D725_DECISION_REF = "decision.D725" as const;
export const D725_DECISION_REVISION = "2026-08-11.v1" as const;
export const D725_OPENROUTER_TURN_REVISION =
	"graphrefly.b112.d725.openrouter-terminal-http-turn.v1" as const;
export const D725_ADAPTER_REVISION =
	"graphrefly.b112.d725.terminal-http-real-provider-adapter.v1" as const;
export const D725_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d725.terminal-http-real-provider-qualification.v1" as const;
export const D725_GENERATION_SCHEMA =
	"graphrefly.b112.d725.terminal-http-real-provider-generation.v1" as const;
export const D725_BUNDLE_SCHEMA =
	"graphrefly.b112.d725.terminal-http-real-provider-bundle.v1" as const;
export const D725_GENERATION_REF = "d725-terminal-http-real-provider-pre-live-v1" as const;

type TurnProvenance = "transport" | "injected-no-network";

export interface D725OpenRouterTurnV1 extends D723OpenRouterTurnV1 {
	readonly revision: typeof D725_OPENROUTER_TURN_REVISION;
	readonly terminalHttpEvidence: D724TerminalHttpEvidenceV1 | null;
}

export type D725ProviderEffectPortV1 = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<D725OpenRouterTurnV1>;

export interface D725RealProviderAdapterV1 {
	readonly revision: typeof D725_ADAPTER_REVISION;
}

export interface D725AdapterReceiptV1 {
	readonly revision: "graphrefly.b112.d725.adapter-receipt.v1";
}

export interface D725AdapterRunV1 {
	readonly core: D722GraphNativeEvalCoreV1;
	readonly terminalHttpGraphEvidence: D724TerminalHttpGraphEvidenceV1;
	readonly receipt: D725AdapterReceiptV1;
}

export interface D725OperationalSummaryV1 {
	readonly executionClass: "injected-no-network" | "live-provider";
	readonly graphAdmittedEffectCount: number;
	readonly graphReconciledEffectCount: number;
	readonly terminalProviderResultCount: number;
	readonly terminalHttpAdmissionCount: number;
	readonly graphRetryWaitCount: number;
	readonly maxActiveInvocations: 0 | 1;
	readonly allEffectsGraphAdmitted: true;
	readonly allUsageGraphReconciled: true;
	readonly exactTerminalHttpCoverage: true;
}

export interface D725QualificationV1 {
	readonly schemaVersion: typeof D725_QUALIFICATION_SCHEMA;
	readonly decisionRef: typeof D725_DECISION_REF;
	readonly decisionRevision: typeof D725_DECISION_REVISION;
	readonly adapterRevision: typeof D725_ADAPTER_REVISION;
	readonly turnRevision: typeof D725_OPENROUTER_TURN_REVISION;
	readonly underlyingTurnRevision: typeof D723_OPENROUTER_GRAPH_TURN_REVISION;
	readonly sourceDigest: string;
	readonly ledgerEvidenceDigest: string;
	readonly terminalHttpGraphEvidence: D724TerminalHttpGraphEvidenceV1;
	readonly terminalProbeGraphEvidence: D724TerminalHttpGraphEvidenceV1;
	readonly operational: D725OperationalSummaryV1;
	readonly executionClass: "injected-no-network";
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly qualificationDigest: string;
}

export interface D725GenerationV1 {
	readonly schemaVersion: typeof D725_GENERATION_SCHEMA;
	readonly generationRef: typeof D725_GENERATION_REF;
	readonly qualificationDigest: string;
	readonly terminalHttpGraphEvidenceDigest: string;
	readonly terminalProbeGraphEvidenceDigest: string;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly generationDigest: string;
}

export interface D725PreLiveBundleV1 {
	readonly schemaVersion: typeof D725_BUNDLE_SCHEMA;
	readonly qualification: D725QualificationV1;
	readonly generation: D725GenerationV1;
	readonly bundleDigest: string;
}

interface AdapterState {
	readonly executionClass: "injected-no-network" | "live-provider";
	readonly ports: Readonly<{
		readonly materialization: D723EffectPortV1;
		readonly providerRequest: D725ProviderEffectPortV1;
		readonly retryWait: D723EffectPortV1;
		readonly toolAction: D723EffectPortV1;
		readonly hiddenVerifier: D723EffectPortV1;
		readonly cleanup: D723EffectPortV1;
	}>;
	consumed: boolean;
}

interface ReceiptState {
	readonly d723Receipt: D723AdapterReceiptV1;
	readonly executionClass: "injected-no-network" | "live-provider";
	consumed: boolean;
}

const constructedTurns = new WeakMap<object, TurnProvenance>();
const adapterStates = new WeakMap<object, AdapterState>();
const receiptStates = new WeakMap<object, ReceiptState>();
const constructedBundles = new WeakSet<object>();

function mediaTypeDisposition(): D724TerminalHttpEvidenceV1["mediaTypeDisposition"] {
	// The frozen D723 byte transport does not expose response Content-Type. D725
	// records that absence honestly instead of inferring it from the body.
	return "unavailable";
}

function validateTransportResponse(value: unknown): OpenRouterResponsesTransportResponseV1 {
	const candidate = record(value, "d725.transportResponse");
	exactKeys(
		candidate,
		Object.hasOwn(candidate, "retryAfterDisposition")
			? ["body", "retryAfterDisposition", "retryAfterMs", "status"]
			: ["body", "retryAfterMs", "status"],
		"d725.transportResponse",
	);
	const status = safeInteger(candidate.status, "d725.transportResponse.status", {
		min: 100,
		max: 599,
	});
	if (!(candidate.body instanceof Uint8Array))
		throw new TypeError("D725 transport response body must be Uint8Array");
	const body = new Uint8Array(candidate.body);
	if (body.byteLength > 1_048_576)
		throw new TypeError("D725 transport response body exceeds the bound");
	const retryAfterMs =
		candidate.retryAfterMs === null
			? null
			: safeInteger(candidate.retryAfterMs, "d725.transportResponse.retryAfterMs", {
					max: 86_400_000,
				});
	if (!Object.hasOwn(candidate, "retryAfterDisposition"))
		return Object.freeze({ status, body, retryAfterMs });
	const retryAfterDisposition = oneOf(
		candidate.retryAfterDisposition,
		["absent", "parsed", "invalid", "unavailable"] as const,
		"d725.transportResponse.retryAfterDisposition",
	);
	if (
		(retryAfterDisposition === "parsed" && retryAfterMs === null) ||
		(retryAfterDisposition !== "parsed" && retryAfterMs !== null)
	)
		throw new TypeError("D725 Retry-After value and disposition disagree");
	return Object.freeze({ status, body, retryAfterMs, retryAfterDisposition });
}

function retryAfterDisposition(
	response: OpenRouterResponsesTransportResponseV1,
): D724TerminalHttpEvidenceV1["retryAfterDisposition"] {
	return (
		response.retryAfterDisposition ?? (response.retryAfterMs === null ? "unavailable" : "parsed")
	);
}

function constructTurn(
	turn: D723OpenRouterTurnV1,
	terminalHttpEvidence: D724TerminalHttpEvidenceV1 | null,
	provenance: TurnProvenance,
): D725OpenRouterTurnV1 {
	const constructed = Object.freeze({
		...turn,
		revision: D725_OPENROUTER_TURN_REVISION,
		terminalHttpEvidence,
	});
	constructedTurns.set(constructed, provenance);
	return constructed;
}

export async function invokeD725OpenRouterGraphTurn(input: {
	readonly effectRequest: D720CallerEffectExecutionInputV2["effectRequest"];
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly taskStatement: string;
	readonly conversation: D723OpenRouterConversationV1;
	readonly signal: AbortSignal;
	readonly monotonicNowMs: () => number;
}): Promise<D725OpenRouterTurnV1> {
	let candidate: D724TerminalHttpEvidenceV1 | null = null;
	let responseSeen = false;
	const transport: OpenRouterResponsesByteTransportV1 = Object.freeze({
		async request(request: OpenRouterResponsesTransportRequestV1) {
			if (responseSeen) throw new TypeError("D725 turn transport was invoked more than once");
			responseSeen = true;
			const response = validateTransportResponse(await input.transport.request(request));
			if (response.status !== 200)
				candidate = createD724TerminalHttpEvidence({
					httpStatus: response.status,
					mediaTypeDisposition: mediaTypeDisposition(),
					retryAfterDisposition: retryAfterDisposition(response),
					responseBytes: response.body,
				});
			return response;
		},
	});
	const turn = await invokeD723OpenRouterGraphTurn({ ...input, transport });
	if (!responseSeen) throw new TypeError("D725 turn omitted its transport response");
	if (turn.result.effectKind !== "provider-request")
		throw new TypeError("D725 turn returned a non-provider result");
	const terminal = turn.result.status === "terminal-failure";
	if (terminal && candidate === null)
		throw new TypeError("D725 terminal response omitted terminal HTTP evidence");
	if (candidate !== null && !terminal && turn.result.status !== "retryable-failure")
		throw new TypeError("D725 terminal response and provider disposition disagree");
	return constructTurn(turn, terminal ? candidate : null, "transport");
}

export function createD725InjectedNoNetworkTurn(inputValue: {
	readonly result: D720EffectResultV1;
	readonly actualCostMicrousd: number;
	readonly actualElapsedMs: number;
	readonly conversation?: D723OpenRouterConversationV1;
}): D725OpenRouterTurnV1 {
	const input = record(inputValue, "d725.injectedTurn");
	exactKeys(
		input,
		Object.hasOwn(input, "conversation")
			? ["actualCostMicrousd", "actualElapsedMs", "conversation", "result"]
			: ["actualCostMicrousd", "actualElapsedMs", "result"],
		"d725.injectedTurn",
	);
	if (
		typeof input.result !== "object" ||
		input.result === null ||
		(input.result as { effectKind?: unknown }).effectKind !== "provider-request"
	)
		throw new TypeError("D725 injected turn requires a provider result");
	const result = strictSnapshot(input.result) as unknown as D720EffectResultV1;
	if (result.status === "terminal-failure")
		throw new TypeError("D725 injected success fixture cannot forge terminal HTTP evidence");
	const conversation = Object.hasOwn(input, "conversation")
		? (strictSnapshot(input.conversation) as unknown as D723OpenRouterConversationV1)
		: Object.freeze({ messages: Object.freeze([]) });
	return constructTurn(
		Object.freeze({
			result,
			actualCostMicrousd: safeInteger(
				input.actualCostMicrousd,
				"d725.injectedTurn.actualCostMicrousd",
				{ max: 6_000_000 },
			),
			actualElapsedMs: safeInteger(input.actualElapsedMs, "d725.injectedTurn.actualElapsedMs", {
				max: 7_200_000,
			}),
			conversation,
			rawToolIntents: Object.freeze([]),
		}),
		null,
		"injected-no-network",
	);
}

export function createD725RealProviderAdapter(value: {
	readonly executionClass: "injected-no-network" | "live-provider";
	readonly materialization: D723EffectPortV1;
	readonly providerRequest: D725ProviderEffectPortV1;
	readonly retryWait: D723EffectPortV1;
	readonly toolAction: D723EffectPortV1;
	readonly hiddenVerifier: D723EffectPortV1;
	readonly cleanup: D723EffectPortV1;
}): D725RealProviderAdapterV1 {
	const candidate = record(value, "d725.adapter");
	exactKeys(
		candidate,
		[
			"cleanup",
			"executionClass",
			"hiddenVerifier",
			"materialization",
			"providerRequest",
			"retryWait",
			"toolAction",
		],
		"d725.adapter",
	);
	const executionClass = oneOf(
		candidate.executionClass,
		["injected-no-network", "live-provider"] as const,
		"d725.adapter.executionClass",
	);
	for (const key of [
		"cleanup",
		"hiddenVerifier",
		"materialization",
		"providerRequest",
		"retryWait",
		"toolAction",
	] as const) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			typeof descriptor.value !== "function"
		)
			throw new TypeError(`D725 ${key} port must be an own function data property`);
	}
	const adapter = Object.freeze({ revision: D725_ADAPTER_REVISION });
	adapterStates.set(adapter, {
		executionClass,
		consumed: false,
		ports: Object.freeze({
			materialization: candidate.materialization as D723EffectPortV1,
			providerRequest: candidate.providerRequest as D725ProviderEffectPortV1,
			retryWait: candidate.retryWait as D723EffectPortV1,
			toolAction: candidate.toolAction as D723EffectPortV1,
			hiddenVerifier: candidate.hiddenVerifier as D723EffectPortV1,
			cleanup: candidate.cleanup as D723EffectPortV1,
		}),
	});
	return adapter;
}

function validateTerminalCoverage(
	core: D722GraphNativeEvalCoreV1,
	graphEvidenceValue: unknown,
): { readonly terminalProviderResultCount: number; readonly terminalHttpAdmissionCount: number } {
	const graphEvidence = validateD724TerminalHttpGraphEvidence(graphEvidenceValue);
	const expected = core.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.status === "terminal-failure"
				? [
						{
							effectRequestDigest: fact.request.requestDigest,
							effectAdmissionDigest: fact.admissionDigest,
							providerResultDigest: fact.resultDigest,
						},
					]
				: [],
		),
	);
	if (graphEvidence.facts.length !== expected.length)
		throw new TypeError("D725 terminal HTTP Graph coverage is incomplete or surplus");
	for (const item of expected) {
		const matches = graphEvidence.facts.filter(
			(fact) =>
				fact.effectRequestDigest === item.effectRequestDigest &&
				fact.effectAdmissionDigest === item.effectAdmissionDigest &&
				fact.providerResultDigest === item.providerResultDigest,
		);
		if (matches.length !== 1) throw new TypeError("D725 terminal HTTP Graph binding drifted");
	}
	return Object.freeze({
		terminalProviderResultCount: expected.length,
		terminalHttpAdmissionCount: graphEvidence.facts.length,
	});
}

export async function runD725RealProviderAdapter(inputValue: {
	readonly sourceDigest: string;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly effectCeilings: D720EffectCeilingsV2;
	readonly adapter: D725RealProviderAdapterV1;
	readonly signal?: AbortSignal;
}): Promise<D725AdapterRunV1> {
	const input = record(inputValue, "d725.run");
	exactKeys(
		input,
		Object.hasOwn(input, "signal")
			? ["adapter", "budgetLimits", "effectCeilings", "signal", "sourceDigest"]
			: ["adapter", "budgetLimits", "effectCeilings", "sourceDigest"],
		"d725.run",
	);
	digest(input.sourceDigest, "d725.run.sourceDigest");
	if (Object.hasOwn(input, "signal") && !(input.signal instanceof AbortSignal))
		throw new TypeError("D725 signal is invalid");
	const state =
		typeof input.adapter === "object" && input.adapter !== null
			? adapterStates.get(input.adapter)
			: undefined;
	if (state === undefined || state.consumed)
		throw new TypeError("D725 adapter must be fresh and constructed");
	state.consumed = true;
	const terminalAuthority = createD724TerminalHttpAuthority();
	const d723 = createD723RealProviderAdapter({
		executionClass: state.executionClass,
		materialization: state.ports.materialization,
		async providerRequest(executionInput) {
			const turn = await state.ports.providerRequest(executionInput);
			const provenance =
				typeof turn === "object" && turn !== null ? constructedTurns.get(turn) : undefined;
			if (
				provenance === undefined ||
				(state.executionClass === "live-provider" && provenance !== "transport")
			)
				throw new TypeError("D725 provider turn provenance is invalid");
			const result = validateD720GraphEffectResult(turn.result, executionInput.effectRequest);
			const terminal =
				result.effectKind === "provider-request" && result.status === "terminal-failure";
			if (terminal !== (turn.terminalHttpEvidence !== null))
				throw new TypeError("D725 provider terminal evidence coverage drifted");
			const actualCostMicrousd = safeInteger(
				turn.actualCostMicrousd,
				"d725.providerTurn.actualCostMicrousd",
				{ max: 6_000_000 },
			);
			const actualElapsedMs = safeInteger(
				turn.actualElapsedMs,
				"d725.providerTurn.actualElapsedMs",
				{ max: 7_200_000 },
			);
			if (terminal)
				admitD724TerminalHttpEvidence(terminalAuthority, {
					effectRequestDigest: executionInput.effectRequest.requestDigest,
					effectAdmissionDigest: executionInput.admission.decisionDigest,
					providerResultDigest: empiricalStrictJsonDigest(result),
					terminalHttpEvidence: turn.terminalHttpEvidence!,
				});
			return Object.freeze({
				result,
				actualCostMicrousd,
				actualElapsedMs,
			});
		},
		retryWait: state.ports.retryWait,
		toolAction: state.ports.toolAction,
		hiddenVerifier: state.ports.hiddenVerifier,
		cleanup: state.ports.cleanup,
	});
	const run = await runD723RealProviderAdapter(
		Object.hasOwn(input, "signal")
			? {
					sourceDigest: input.sourceDigest as string,
					budgetLimits: input.budgetLimits as D719CleanBudgetLimitsV1,
					effectCeilings: input.effectCeilings as D720EffectCeilingsV2,
					adapter: d723,
					signal: input.signal as AbortSignal,
				}
			: {
					sourceDigest: input.sourceDigest as string,
					budgetLimits: input.budgetLimits as D719CleanBudgetLimitsV1,
					effectCeilings: input.effectCeilings as D720EffectCeilingsV2,
					adapter: d723,
				},
	);
	const terminalHttpGraphEvidence = snapshotD724TerminalHttpGraphEvidence(terminalAuthority);
	validateTerminalCoverage(run.core, terminalHttpGraphEvidence);
	const receipt = Object.freeze({ revision: "graphrefly.b112.d725.adapter-receipt.v1" as const });
	receiptStates.set(receipt, {
		d723Receipt: run.receipt,
		executionClass: state.executionClass,
		consumed: false,
	});
	return Object.freeze({ core: run.core, terminalHttpGraphEvidence, receipt });
}

export function consumeD725AdapterReceipt(
	receipt: D725AdapterReceiptV1,
	run: Pick<D725AdapterRunV1, "core" | "terminalHttpGraphEvidence">,
): D725OperationalSummaryV1 {
	const state =
		typeof receipt === "object" && receipt !== null ? receiptStates.get(receipt) : undefined;
	if (state === undefined || state.consumed)
		throw new TypeError("D725 adapter receipt is invalid or consumed");
	state.consumed = true;
	const d723 = consumeD723AdapterReceipt(state.d723Receipt, run.core);
	const coverage = validateTerminalCoverage(run.core, run.terminalHttpGraphEvidence);
	const admittedSequences = new Set(
		run.core.ledger.effectAdmissions
			.filter((admission) => admission.admitted)
			.map((admission) => admission.effectSequence),
	);
	const graphRetryWaitCount = run.core.ledger.effectProposals.filter(
		(proposal) =>
			proposal.effectKind === "retry-wait" && admittedSequences.has(proposal.effectSequence),
	).length;
	return Object.freeze({
		executionClass: state.executionClass,
		graphAdmittedEffectCount: d723.graphAdmittedEffectCount,
		graphReconciledEffectCount: d723.graphReconciledEffectCount,
		terminalProviderResultCount: coverage.terminalProviderResultCount,
		terminalHttpAdmissionCount: coverage.terminalHttpAdmissionCount,
		graphRetryWaitCount,
		maxActiveInvocations: d723.maxActiveInvocations,
		allEffectsGraphAdmitted: true,
		allUsageGraphReconciled: true,
		exactTerminalHttpCoverage: true,
	});
}

function validateOperational(value: unknown): D725OperationalSummaryV1 {
	const candidate = record(value, "d725.operational");
	exactKeys(
		candidate,
		[
			"allEffectsGraphAdmitted",
			"allUsageGraphReconciled",
			"exactTerminalHttpCoverage",
			"executionClass",
			"graphAdmittedEffectCount",
			"graphReconciledEffectCount",
			"graphRetryWaitCount",
			"maxActiveInvocations",
			"terminalHttpAdmissionCount",
			"terminalProviderResultCount",
		],
		"d725.operational",
	);
	oneOf(candidate.executionClass, ["injected-no-network", "live-provider"], "d725.executionClass");
	const admitted = safeInteger(candidate.graphAdmittedEffectCount, "d725.graphAdmitted", {
		max: 6_144,
	});
	const reconciled = safeInteger(candidate.graphReconciledEffectCount, "d725.graphReconciled", {
		max: 6_144,
	});
	if (admitted !== reconciled) throw new TypeError("D725 effect coverage drifted");
	const terminals = safeInteger(candidate.terminalProviderResultCount, "d725.terminals", {
		max: 256,
	});
	const admissions = safeInteger(candidate.terminalHttpAdmissionCount, "d725.httpAdmissions", {
		max: 256,
	});
	if (terminals !== admissions) throw new TypeError("D725 terminal HTTP count drifted");
	safeInteger(candidate.graphRetryWaitCount, "d725.graphRetryWaitCount", { max: 12 });
	if (candidate.maxActiveInvocations !== 0 && candidate.maxActiveInvocations !== 1)
		throw new TypeError("D725 maxActiveInvocations is invalid");
	literal(candidate.allEffectsGraphAdmitted, true, "d725.allEffectsGraphAdmitted");
	literal(candidate.allUsageGraphReconciled, true, "d725.allUsageGraphReconciled");
	literal(candidate.exactTerminalHttpCoverage, true, "d725.exactTerminalHttpCoverage");
	return strictSnapshot(candidate) as unknown as D725OperationalSummaryV1;
}

export function createD725Qualification(value: {
	readonly sourceDigest: string;
	readonly ledgerEvidenceDigest: string;
	readonly terminalHttpGraphEvidence: D724TerminalHttpGraphEvidenceV1;
	readonly terminalProbeGraphEvidence: D724TerminalHttpGraphEvidenceV1;
	readonly operational: D725OperationalSummaryV1;
}): D725QualificationV1 {
	const terminalHttpGraphEvidence = validateD724TerminalHttpGraphEvidence(
		value.terminalHttpGraphEvidence,
	);
	const terminalProbeGraphEvidence = validateD724TerminalHttpGraphEvidence(
		value.terminalProbeGraphEvidence,
	);
	if (
		terminalProbeGraphEvidence.facts.length !== 1 ||
		terminalProbeGraphEvidence.facts[0]?.terminalHttpEvidence.httpStatus !== 400
	)
		throw new TypeError("D725 qualification requires one exact injected terminal HTTP probe");
	const operational = validateOperational(value.operational);
	if (operational.executionClass !== "injected-no-network")
		throw new TypeError("D725 pre-live qualification must be injected no-network");
	if (operational.graphRetryWaitCount !== 6)
		throw new TypeError("D725 pre-live qualification retry coverage drifted");
	const material = strictSnapshot({
		schemaVersion: D725_QUALIFICATION_SCHEMA,
		decisionRef: D725_DECISION_REF,
		decisionRevision: D725_DECISION_REVISION,
		adapterRevision: D725_ADAPTER_REVISION,
		turnRevision: D725_OPENROUTER_TURN_REVISION,
		underlyingTurnRevision: D723_OPENROUTER_GRAPH_TURN_REVISION,
		sourceDigest: literal(
			digest(value.sourceDigest, "d725.qualification.sourceDigest"),
			D725_IMPLEMENTATION_MANIFEST_DIGEST,
			"d725.qualification.sourceDigest",
		),
		ledgerEvidenceDigest: digest(
			value.ledgerEvidenceDigest,
			"d725.qualification.ledgerEvidenceDigest",
		),
		terminalHttpGraphEvidence,
		terminalProbeGraphEvidence,
		operational,
		executionClass: "injected-no-network" as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({ ...material, qualificationDigest: empiricalStrictJsonDigest(material) });
}

export function validateD725Qualification(value: unknown): D725QualificationV1 {
	const candidate = record(value, "d725.qualification");
	exactKeys(
		candidate,
		[
			"adapterRevision",
			"causalAttribution",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"executionClass",
			"ledgerEvidenceDigest",
			"operational",
			"qualificationDigest",
			"schemaVersion",
			"sourceDigest",
			"terminalHttpGraphEvidence",
			"terminalProbeGraphEvidence",
			"turnRevision",
			"underlyingTurnRevision",
		],
		"d725.qualification",
	);
	literal(candidate.schemaVersion, D725_QUALIFICATION_SCHEMA, "d725.qualification.schema");
	literal(candidate.decisionRef, D725_DECISION_REF, "d725.qualification.decisionRef");
	literal(
		candidate.decisionRevision,
		D725_DECISION_REVISION,
		"d725.qualification.decisionRevision",
	);
	literal(candidate.adapterRevision, D725_ADAPTER_REVISION, "d725.qualification.adapterRevision");
	literal(candidate.turnRevision, D725_OPENROUTER_TURN_REVISION, "d725.qualification.turnRevision");
	literal(
		candidate.underlyingTurnRevision,
		D723_OPENROUTER_GRAPH_TURN_REVISION,
		"d725.qualification.underlyingTurnRevision",
	);
	literal(
		digest(candidate.sourceDigest, "d725.qualification.sourceDigest"),
		D725_IMPLEMENTATION_MANIFEST_DIGEST,
		"d725.qualification.sourceDigest",
	);
	digest(candidate.ledgerEvidenceDigest, "d725.qualification.ledgerEvidenceDigest");
	validateD724TerminalHttpGraphEvidence(candidate.terminalHttpGraphEvidence);
	const terminalProbeGraphEvidence = validateD724TerminalHttpGraphEvidence(
		candidate.terminalProbeGraphEvidence,
	);
	if (
		terminalProbeGraphEvidence.facts.length !== 1 ||
		terminalProbeGraphEvidence.facts[0]?.terminalHttpEvidence.httpStatus !== 400
	)
		throw new TypeError("D725 qualification terminal probe drifted");
	const operational = validateOperational(candidate.operational);
	literal(operational.executionClass, "injected-no-network", "d725.qualification.executionClass");
	literal(operational.graphRetryWaitCount, 6, "d725.qualification.graphRetryWaitCount");
	literal(candidate.executionClass, "injected-no-network", "d725.qualification.executionClass");
	literal(candidate.causalAttribution, "undetermined", "d725.qualification.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d725.qualification.efficacyClaim");
	const qualificationDigest = digest(
		candidate.qualificationDigest,
		"d725.qualification.qualificationDigest",
	);
	const { qualificationDigest: _ignored, ...material } = candidate;
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(material),
		"d725.qualification.qualificationDigest",
	);
	return strictSnapshot(candidate) as unknown as D725QualificationV1;
}

export function createD725PreLiveBundle(
	qualificationValue: D725QualificationV1,
): D725PreLiveBundleV1 {
	const qualification = validateD725Qualification(qualificationValue);
	const generationMaterial = strictSnapshot({
		schemaVersion: D725_GENERATION_SCHEMA,
		generationRef: D725_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		terminalHttpGraphEvidenceDigest: qualification.terminalHttpGraphEvidence.evidenceDigest,
		terminalProbeGraphEvidenceDigest: qualification.terminalProbeGraphEvidence.evidenceDigest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const bundleMaterial = strictSnapshot({
		schemaVersion: D725_BUNDLE_SCHEMA,
		qualification,
		generation,
	});
	const bundle = Object.freeze({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	});
	constructedBundles.add(bundle);
	return bundle;
}

export function validateD725PreLiveBundle(value: unknown): D725PreLiveBundleV1 {
	const candidate = record(value, "d725.bundle");
	exactKeys(
		candidate,
		["bundleDigest", "generation", "qualification", "schemaVersion"],
		"d725.bundle",
	);
	literal(candidate.schemaVersion, D725_BUNDLE_SCHEMA, "d725.bundle.schema");
	const qualification = validateD725Qualification(candidate.qualification);
	const generation = record(candidate.generation, "d725.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"qualificationDigest",
			"schemaVersion",
			"terminalHttpGraphEvidenceDigest",
			"terminalProbeGraphEvidenceDigest",
		],
		"d725.generation",
	);
	literal(generation.schemaVersion, D725_GENERATION_SCHEMA, "d725.generation.schema");
	literal(generation.generationRef, D725_GENERATION_REF, "d725.generation.ref");
	literal(
		generation.qualificationDigest,
		qualification.qualificationDigest,
		"d725.generation.qualificationDigest",
	);
	literal(
		generation.terminalHttpGraphEvidenceDigest,
		qualification.terminalHttpGraphEvidence.evidenceDigest,
		"d725.generation.terminalHttpGraphEvidenceDigest",
	);
	literal(
		generation.terminalProbeGraphEvidenceDigest,
		qualification.terminalProbeGraphEvidence.evidenceDigest,
		"d725.generation.terminalProbeGraphEvidenceDigest",
	);
	literal(generation.causalAttribution, "undetermined", "d725.generation.causalAttribution");
	literal(generation.efficacyClaim, "none", "d725.generation.efficacyClaim");
	const generationDigest = digest(generation.generationDigest, "d725.generation.digest");
	const { generationDigest: _ignored, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d725.generation.digest",
	);
	const bundleDigest = digest(candidate.bundleDigest, "d725.bundle.digest");
	const material = strictSnapshot({
		schemaVersion: D725_BUNDLE_SCHEMA,
		qualification,
		generation: strictSnapshot(generation),
	});
	literal(bundleDigest, empiricalStrictJsonDigest(material), "d725.bundle.digest");
	return strictSnapshot({ ...material, bundleDigest }) as unknown as D725PreLiveBundleV1;
}

export function isConstructedD725PreLiveBundle(value: unknown): value is D725PreLiveBundleV1 {
	return typeof value === "object" && value !== null && constructedBundles.has(value);
}
