import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import { validateD724TerminalHttpEvidence } from "./d724-terminal-http-evidence.js";
import {
	invokeD734RouteBoundOpenRouterTurn,
	readD734RouteBoundProviderTurn,
} from "./d734-route-profile-provider-integration.js";
import type {
	D719EffectAdmissionV1,
	D719EffectReconciliationV1,
} from "./d767-clean-graph-ledger.js";
import {
	type D720EffectResultV1,
	type D720GraphEffectRequestV1,
	D748_FORWARD_PHASE_CONTEXT_SCHEMA,
	D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA,
	D761_CRITERION_FAILURE_CONTEXT_SCHEMA,
	validateD720GraphEffectResult,
} from "./d767-graph-native-effect-runtime.js";
import type {
	D720CallerEffectExecutionV2,
	D720EffectCeilingsV2,
} from "./d767-graph-native-eval.js";
import type {
	OpenRouterResponsesByteTransportV1,
	OpenRouterResponsesTransportRequestV1,
} from "./openrouter-responses-model-turn.js";

export const D774_PROVIDER_RESULT_ENVELOPE_SCHEMA =
	"graphrefly.b112.d774.provider-result-envelope.v1" as const;
export const D774_ROUTE_PROPOSAL_SCHEMA =
	"graphrefly.b112.d774.route-lowering-proposal.v1" as const;
export const D774_ROUTE_FACT_SCHEMA = "graphrefly.b112.d774.route-fact.v1" as const;
export const D774_ROUTE_EVIDENCE_SCHEMA = "graphrefly.b112.d774.route-evidence.v1" as const;

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const MAX_BODY_BYTES = 1_048_576;
const TOOL_NAMES = Object.freeze({
	"exact-mutation": "replace_exact",
	"workspace-diff": "workspace_diff",
	"focused-validation": "focused_validation",
	"hidden-verifier": null,
} as const);
const PHASES = Object.freeze(Object.keys(TOOL_NAMES) as (keyof typeof TOOL_NAMES)[]);

type D774Phase = (typeof PHASES)[number];

export interface D774RouteLoweringProposalV1 {
	readonly schemaVersion: typeof D774_ROUTE_PROPOSAL_SCHEMA;
	readonly runSequence: number;
	readonly effectSequence: number;
	readonly requestDigest: string;
	readonly logicalRequestDigest: string;
	readonly attemptOrdinal: number;
	readonly admissionDigest: string;
	readonly contextDigest: string;
	readonly nextRequiredPhase: D774Phase | null;
	readonly requiredDisposition: "tool-intents" | "structured-final" | "unchanged";
	readonly requiredToolName: "replace_exact" | "workspace_diff" | "focused_validation" | null;
	readonly inputBodyDigest: string;
	readonly loweredBodyDigest: string;
	readonly modelVisibleMessagesDigest: string;
	readonly proposalDigest: string;
}

export interface D774ProviderResultEnvelopeV1 {
	readonly schemaVersion: typeof D774_PROVIDER_RESULT_ENVELOPE_SCHEMA;
	readonly execution: D720CallerEffectExecutionV2;
	readonly routeProposal: D774RouteLoweringProposalV1 | null;
	readonly envelopeDigest: string;
}

export interface D774RouteFactV1
	extends Omit<D774RouteLoweringProposalV1, "proposalDigest" | "schemaVersion"> {
	readonly schemaVersion: typeof D774_ROUTE_FACT_SCHEMA;
	readonly resultDigest: string;
	readonly resultFactDigest: string;
	readonly reconciliationDigest: string;
	readonly factDigest: string;
}

export interface D774RouteEvidenceV1 {
	readonly schemaVersion: typeof D774_ROUTE_EVIDENCE_SCHEMA;
	readonly facts: readonly D774RouteFactV1[];
	readonly providerResultCount: number;
	readonly coverageComplete: boolean;
	readonly evidenceDigest: string;
}

export interface D774RouteAuthorityV1 {
	readonly revision: "graphrefly.b112.d774.route-authority.v1";
	readonly admit: (input: {
		readonly proposal: D774RouteLoweringProposalV1;
		readonly request: D720GraphEffectRequestV1;
		readonly admission: D719EffectAdmissionV1;
		readonly result: D720EffectResultV1;
		readonly resultFactDigest: string;
		readonly reconciliation: D719EffectReconciliationV1;
	}) => D774RouteFactV1;
	readonly snapshot: (providerResultCount: number) => D774RouteEvidenceV1;
}

function ownRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
	const candidate = record(value, path);
	exactKeys(candidate, keys, path);
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			!descriptor.enumerable ||
			descriptor.get !== undefined ||
			descriptor.set !== undefined
		)
			throw new TypeError(`${path}.${key} must be an own enumerable data property`);
	}
	return candidate;
}

function validateAdmission(value: unknown): D719EffectAdmissionV1 {
	const candidate = ownRecord(
		value,
		[
			"admitted",
			"arm",
			"budgetReasons",
			"budgetStateBefore",
			"budgetStateIfReserved",
			"decisionDigest",
			"effectSequence",
			"kind",
			"proposalDigest",
			"retryAuthorized",
			"runKind",
		],
		"d774.admission",
	);
	if (candidate.kind !== "effect-admission-decided" || candidate.admitted !== true)
		throw new TypeError("D774 route lowering requires an admitted Graph effect");
	const { decisionDigest, ...material } = candidate;
	digest(decisionDigest, "d774.admission.decisionDigest");
	if (decisionDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D774 admission digest drifted");
	return strictSnapshot(candidate) as unknown as D719EffectAdmissionV1;
}

function validateReconciliation(value: unknown): D719EffectReconciliationV1 {
	const candidate = ownRecord(
		value,
		[
			"actualCostMicrousd",
			"actualElapsedMs",
			"admissionDigest",
			"basis",
			"effectSequence",
			"failureDiscriminator",
			"kind",
			"outcome",
			"proposalDigest",
			"reconciliationDigest",
			"reservationExceeded",
			"retryWaitSatisfied",
		],
		"d774.reconciliation",
	);
	if (candidate.kind !== "effect-reconciled")
		throw new TypeError("D774 reconciliation kind drifted");
	const { reconciliationDigest, ...material } = candidate;
	digest(reconciliationDigest, "d774.reconciliation.reconciliationDigest");
	if (reconciliationDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D774 reconciliation digest drifted");
	return strictSnapshot(candidate) as unknown as D719EffectReconciliationV1;
}

function validateExecution(
	value: unknown,
	request: D720GraphEffectRequestV1,
): D720CallerEffectExecutionV2 {
	const candidate = ownRecord(
		value,
		[
			"actualCostMicrousd",
			"actualElapsedMs",
			"result",
			...(Object.hasOwn(value as object, "usageBasis") ? ["usageBasis" as const] : []),
		],
		"d774.execution",
	);
	safeInteger(candidate.actualCostMicrousd, "d774.execution.actualCostMicrousd", {
		max: 1_000_000_000,
	});
	safeInteger(candidate.actualElapsedMs, "d774.execution.actualElapsedMs", {
		max: 1_000_000_000,
	});
	if (Object.hasOwn(candidate, "usageBasis"))
		oneOf(candidate.usageBasis, ["conservative-reservation"], "d774.execution.usageBasis");
	const result = validateD720GraphEffectResult(candidate.result, request);
	return Object.freeze({ ...candidate, result }) as unknown as D720CallerEffectExecutionV2;
}

function validateCriterionContext(value: unknown): {
	readonly contextDigest: string;
	readonly nextRequiredPhase: D774Phase;
	readonly requiredDisposition: "tool-intents" | "structured-final";
	readonly runSequence: number;
	readonly issuedRequestDigest: string;
	readonly workspaceStateDigest: string;
} {
	const probe = record(value, "d774.contextProbe");
	const keys = [
		"budgetProjectionDigest",
		"contextDigest",
		...(Object.hasOwn(probe, "criterionFailures") ? ["criterionFailures" as const] : []),
		"evidenceFreshnessRefs",
		"issuedRequestDigest",
		"missingObjectivePhases",
		"nextRequiredPhase",
		"reason",
		"rejectedRequestDigest",
		"remainingAdmittedBounds",
		"remainingCompletionContexts",
		"remainingEffectFacts",
		"requiredDisposition",
		"runSequence",
		"schemaVersion",
		"workspaceStateDigest",
	];
	const context = ownRecord(value, keys, "d774.context");
	if (
		![
			D748_FORWARD_PHASE_CONTEXT_SCHEMA,
			D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA,
			D761_CRITERION_FAILURE_CONTEXT_SCHEMA,
		].includes(context.schemaVersion as never)
	)
		throw new TypeError("D774 correction context schema drifted");
	const phase = oneOf(context.nextRequiredPhase, PHASES, "d774.context.nextRequiredPhase");
	const requiredDisposition = oneOf(
		context.requiredDisposition,
		["tool-intents", "structured-final"],
		"d774.context.requiredDisposition",
	);
	if (
		(phase === "hidden-verifier") !== (requiredDisposition === "structured-final") ||
		(phase !== "hidden-verifier") !== (requiredDisposition === "tool-intents")
	)
		throw new TypeError("D774 phase disposition drifted");
	const { contextDigest, ...material } = context;
	digest(contextDigest, "d774.context.contextDigest");
	if (contextDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D774 correction context digest drifted");
	return Object.freeze({
		contextDigest: contextDigest as string,
		nextRequiredPhase: phase,
		requiredDisposition,
		runSequence: safeInteger(context.runSequence, "d774.context.runSequence", { max: 11 }),
		issuedRequestDigest: digest(context.issuedRequestDigest, "d774.context.issuedRequestDigest"),
		workspaceStateDigest: digest(context.workspaceStateDigest, "d774.context.workspaceStateDigest"),
	});
}

function validateRequest(value: unknown): D720GraphEffectRequestV1 {
	const request = record(value, "d774.request");
	const { requestDigest, ...material } = request;
	digest(requestDigest, "d774.request.requestDigest");
	if (requestDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D774 Graph request digest drifted");
	if (request.effectKind !== "provider-request")
		throw new TypeError("D774 route lowering requires a provider request");
	return strictSnapshot(request) as unknown as D720GraphEffectRequestV1;
}

function validateProposal(value: unknown): D774RouteLoweringProposalV1 {
	const candidate = ownRecord(
		value,
		[
			"admissionDigest",
			"attemptOrdinal",
			"contextDigest",
			"effectSequence",
			"inputBodyDigest",
			"logicalRequestDigest",
			"loweredBodyDigest",
			"modelVisibleMessagesDigest",
			"nextRequiredPhase",
			"proposalDigest",
			"requestDigest",
			"requiredDisposition",
			"requiredToolName",
			"runSequence",
			"schemaVersion",
		],
		"d774.routeProposal",
	);
	if (candidate.schemaVersion !== D774_ROUTE_PROPOSAL_SCHEMA)
		throw new TypeError("D774 route proposal schema drifted");
	for (const key of [
		"admissionDigest",
		"contextDigest",
		"inputBodyDigest",
		"logicalRequestDigest",
		"loweredBodyDigest",
		"modelVisibleMessagesDigest",
		"proposalDigest",
		"requestDigest",
	] as const)
		digest(candidate[key], `d774.routeProposal.${key}`);
	for (const key of ["attemptOrdinal", "effectSequence", "runSequence"] as const)
		safeInteger(candidate[key], `d774.routeProposal.${key}`, { max: 512 });
	if (candidate.nextRequiredPhase !== null)
		oneOf(candidate.nextRequiredPhase, PHASES, "d774.routeProposal.nextRequiredPhase");
	oneOf(
		candidate.requiredDisposition,
		["tool-intents", "structured-final", "unchanged"],
		"d774.routeProposal.requiredDisposition",
	);
	if (candidate.requiredToolName !== null)
		oneOf(
			candidate.requiredToolName,
			["replace_exact", "workspace_diff", "focused_validation"],
			"d774.routeProposal.requiredToolName",
		);
	const { proposalDigest, ...material } = candidate;
	if (proposalDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D774 route proposal digest drifted");
	return strictSnapshot(candidate) as unknown as D774RouteLoweringProposalV1;
}

export function lowerD774ProviderChatRequest(inputValue: {
	readonly effectRequest: D720GraphEffectRequestV1;
	readonly admission: D719EffectAdmissionV1;
	readonly body: Uint8Array;
}): Readonly<{ readonly body: Uint8Array; readonly proposal: D774RouteLoweringProposalV1 }> {
	const input = ownRecord(inputValue, ["admission", "body", "effectRequest"], "d774.lower.input");
	const request = validateRequest(input.effectRequest);
	const admission = validateAdmission(input.admission);
	if (admission.decisionDigest !== (input.admission as D719EffectAdmissionV1).decisionDigest)
		throw new TypeError("D774 request/admission coordinates drifted");
	const bytes = input.body;
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_BODY_BYTES)
		throw new TypeError("D774 provider body is outside the bound");
	const body = ownRecord(
		JSON.parse(decoder.decode(bytes)),
		["messages", "model", "provider", "reasoning", "stream", "tool_choice", "tools"],
		"d774.providerBody",
	);
	const messages = array(body.messages, "d774.providerBody.messages");
	if (messages.length < 1 || messages.length > 128)
		throw new TypeError("D774 model-visible message bound drifted");
	let phase: D774Phase | null = null;
	let contextDigest = request.logicalRequestDigest;
	let requiredDisposition: D774RouteLoweringProposalV1["requiredDisposition"] = "unchanged";
	let requiredToolName: D774RouteLoweringProposalV1["requiredToolName"] = null;
	let loweredBody: Record<string, unknown> = body;
	if (request.completionContext !== undefined) {
		const probe = record(request.completionContext, "d774.contextSchema");
		if (
			[
				D748_FORWARD_PHASE_CONTEXT_SCHEMA,
				D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA,
				D761_CRITERION_FAILURE_CONTEXT_SCHEMA,
			].includes(probe.schemaVersion as never)
		) {
			const context = validateCriterionContext(request.completionContext);
			if (
				context.runSequence !== request.runSequence ||
				context.issuedRequestDigest !== request.issuedRequestDigest ||
				request.workspaceStateDigest === null ||
				context.workspaceStateDigest !== request.workspaceStateDigest
			)
				throw new TypeError("D774 correction context is not bound to its Graph request/state");
			phase = context.nextRequiredPhase;
			contextDigest = context.contextDigest;
			requiredDisposition = context.requiredDisposition;
			requiredToolName = TOOL_NAMES[phase];
			if (requiredToolName === null) {
				loweredBody = strictSnapshot({ ...body, tool_choice: "none" }) as Record<string, unknown>;
			} else {
				const matches = array(body.tools, "d774.providerBody.tools").filter((value, index) => {
					const tool = record(value, `d774.providerBody.tools[${index}]`);
					const fn = record(tool.function, `d774.providerBody.tools[${index}].function`);
					return tool.type === "function" && fn.name === requiredToolName;
				});
				if (matches.length !== 1)
					throw new TypeError("D774 required phase tool is not uniquely available");
				loweredBody = strictSnapshot({
					...body,
					tool_choice: { type: "function", function: { name: requiredToolName } },
				}) as Record<string, unknown>;
			}
		}
	}
	if (
		phase === null &&
		request.completionContext === undefined &&
		request.phaseBefore === "focused-validation-passed"
	) {
		phase = "hidden-verifier";
		requiredDisposition = "structured-final";
		requiredToolName = null;
		loweredBody = strictSnapshot({ ...body, tool_choice: "none" }) as Record<string, unknown>;
	}
	const lowered = encoder.encode(JSON.stringify(loweredBody));
	if (lowered.byteLength > MAX_BODY_BYTES) throw new TypeError("D774 lowered body exceeds bound");
	const material = strictSnapshot({
		schemaVersion: D774_ROUTE_PROPOSAL_SCHEMA,
		runSequence: request.runSequence,
		effectSequence: request.effectSequence,
		requestDigest: request.requestDigest,
		logicalRequestDigest: request.logicalRequestDigest,
		attemptOrdinal: request.attemptOrdinal,
		admissionDigest: admission.decisionDigest,
		contextDigest,
		nextRequiredPhase: phase,
		requiredDisposition,
		requiredToolName,
		inputBodyDigest: empiricalSha256(bytes),
		loweredBodyDigest: empiricalSha256(lowered),
		modelVisibleMessagesDigest: empiricalStrictJsonDigest(messages),
	});
	return Object.freeze({
		body: lowered,
		proposal: Object.freeze({ ...material, proposalDigest: empiricalStrictJsonDigest(material) }),
	});
}

export function createD774ProviderResultEnvelope(inputValue: {
	readonly effectRequest: D720GraphEffectRequestV1;
	readonly execution: D720CallerEffectExecutionV2;
	readonly routeProposal: D774RouteLoweringProposalV1 | null;
}): D774ProviderResultEnvelopeV1 {
	const input = ownRecord(
		inputValue,
		["effectRequest", "execution", "routeProposal"],
		"d774.envelope.input",
	);
	const request = strictSnapshot(input.effectRequest) as D720GraphEffectRequestV1;
	const execution = validateExecution(input.execution, request);
	const proposal = input.routeProposal === null ? null : validateProposal(input.routeProposal);
	if ((request.effectKind === "provider-request") !== (proposal !== null))
		throw new TypeError("D774 provider result/route proposal cardinality drifted");
	if (
		proposal !== null &&
		(proposal.requestDigest !== request.requestDigest ||
			proposal.logicalRequestDigest !== request.logicalRequestDigest ||
			proposal.attemptOrdinal !== request.attemptOrdinal ||
			proposal.effectSequence !== request.effectSequence)
	)
		throw new TypeError("D774 route proposal is not bound to its provider result");
	const material = strictSnapshot({
		schemaVersion: D774_PROVIDER_RESULT_ENVELOPE_SCHEMA,
		execution,
		routeProposal: proposal,
	});
	return Object.freeze({ ...material, envelopeDigest: empiricalStrictJsonDigest(material) });
}

export async function invokeD774AdmittedRouteTurn(
	inputValue: Parameters<typeof invokeD734RouteBoundOpenRouterTurn>[0] & {
		readonly admission: D719EffectAdmissionV1;
	},
): Promise<D774ProviderResultEnvelopeV1> {
	const input = ownRecord(
		inputValue,
		[
			"admission",
			"conversation",
			"credential",
			"effectRequest",
			"monotonicNowMs",
			"routeAdmission",
			"signal",
			"taskStatement",
			"transport",
			...(Object.hasOwn(inputValue, "usageBasis") ? ["usageBasis" as const] : []),
		],
		"d774.admittedRouteTurn",
	);
	const effectRequest = validateRequest(input.effectRequest);
	const admission = validateAdmission(input.admission);
	const transport = ownRecord(input.transport, ["request"], "d774.admittedRouteTurn.transport");
	if (typeof transport.request !== "function") throw new TypeError("D774 transport is invalid");
	let calls = 0;
	let proposal: D774RouteLoweringProposalV1 | null = null;
	const loweringTransport: OpenRouterResponsesByteTransportV1 = Object.freeze({
		async request(request: OpenRouterResponsesTransportRequestV1) {
			calls += 1;
			if (calls !== 1) throw new TypeError("D774 adapter attempted more than one transport call");
			const lowered = lowerD774ProviderChatRequest({
				effectRequest,
				admission,
				body: request.body,
			});
			proposal = lowered.proposal;
			return Reflect.apply(transport.request as (...args: unknown[]) => unknown, input.transport, [
				{ ...request, body: lowered.body },
			]) as ReturnType<OpenRouterResponsesByteTransportV1["request"]>;
		},
	});
	const { admission: _admission, ...base } = input;
	const capability = await invokeD734RouteBoundOpenRouterTurn({
		...(base as unknown as Parameters<typeof invokeD734RouteBoundOpenRouterTurn>[0]),
		transport: loweringTransport,
	});
	if (calls !== 1 || proposal === null)
		throw new TypeError("D774 adapter omitted admitted transport");
	const snapshot = readD734RouteBoundProviderTurn(capability);
	const terminal = snapshot.turn.result.status === "terminal-failure";
	if (terminal !== (snapshot.turn.terminalHttpEvidence !== null))
		throw new TypeError("D774 terminal HTTP evidence cardinality drifted");
	if (snapshot.turn.terminalHttpEvidence !== null)
		validateD724TerminalHttpEvidence(snapshot.turn.terminalHttpEvidence);
	const result = terminal
		? validateD720GraphEffectResult(
				{
					...snapshot.turn.result,
					failureProvenance: "http-terminal",
					executorFailureClassification: null,
				},
				effectRequest,
			)
		: snapshot.turn.result;
	return createD774ProviderResultEnvelope({
		effectRequest,
		routeProposal: proposal,
		execution: {
			result,
			actualCostMicrousd: snapshot.turn.actualCostMicrousd,
			actualElapsedMs: snapshot.turn.actualElapsedMs,
			...(snapshot.usageBasis === "conservative-reservation"
				? { usageBasis: "conservative-reservation" as const }
				: {}),
		},
	});
}

export function validateD774ProviderResultEnvelope(
	value: unknown,
	request: D720GraphEffectRequestV1,
	admissionValue?: D719EffectAdmissionV1,
): D774ProviderResultEnvelopeV1 {
	const candidate = ownRecord(
		value,
		["envelopeDigest", "execution", "routeProposal", "schemaVersion"],
		"d774.envelope",
	);
	if (candidate.schemaVersion !== D774_PROVIDER_RESULT_ENVELOPE_SCHEMA)
		throw new TypeError("D774 provider result envelope schema drifted");
	const rebuilt = createD774ProviderResultEnvelope({
		effectRequest: request,
		execution: candidate.execution as D720CallerEffectExecutionV2,
		routeProposal:
			candidate.routeProposal === null
				? null
				: (candidate.routeProposal as D774RouteLoweringProposalV1),
	});
	if (
		admissionValue !== undefined &&
		rebuilt.routeProposal !== null &&
		rebuilt.routeProposal.admissionDigest !== validateAdmission(admissionValue).decisionDigest
	)
		throw new TypeError("D774 route proposal is not bound to its Graph admission");
	if (candidate.envelopeDigest !== rebuilt.envelopeDigest)
		throw new TypeError("D774 provider result envelope digest drifted");
	return rebuilt;
}

export function createD774RouteAuthority(): D774RouteAuthorityV1 {
	const owner = graph({ name: "d774/route-authority" });
	const proposalNode = owner.node<D774RouteFactV1>([], null, { name: "d774/route-proposals" });
	const facts: D774RouteFactV1[] = [];
	const admissionNode = owner.node<D774RouteFactV1>(
		[proposalNode],
		(ctx) => {
			for (const batch of depBatch(ctx, 0) ?? []) ctx.down([["DATA", batch as D774RouteFactV1]]);
		},
		{ name: "d774/route-admissions", factory: "d774RouteAdmission" },
	);
	admissionNode.subscribe((message) => {
		if (message[0] !== "DATA") return;
		const fact = message[1] as D774RouteFactV1;
		if (facts.length >= 128) throw new TypeError("D774 route fact bound exhausted");
		if (
			facts.some(
				(value) =>
					value.requestDigest === fact.requestDigest ||
					value.admissionDigest === fact.admissionDigest ||
					value.resultFactDigest === fact.resultFactDigest,
			)
		)
			throw new TypeError("D774 route proposal replayed");
		facts.push(fact);
	});
	return Object.freeze({
		revision: "graphrefly.b112.d774.route-authority.v1" as const,
		admit(inputValue: {
			readonly proposal: D774RouteLoweringProposalV1;
			readonly request: D720GraphEffectRequestV1;
			readonly admission: D719EffectAdmissionV1;
			readonly result: D720EffectResultV1;
			readonly resultFactDigest: string;
			readonly reconciliation: D719EffectReconciliationV1;
		}) {
			const input = ownRecord(
				inputValue,
				["admission", "proposal", "reconciliation", "request", "result", "resultFactDigest"],
				"d774.routeAdmission",
			);
			const proposal = validateProposal(input.proposal);
			const request = validateRequest(input.request);
			const admission = validateAdmission(input.admission);
			const result = validateD720GraphEffectResult(input.result, request);
			const reconciliation = validateReconciliation(input.reconciliation);
			const resultFactDigest = digest(input.resultFactDigest, "d774.routeAdmission.resultFact");
			if (
				proposal.requestDigest !== request.requestDigest ||
				proposal.admissionDigest !== admission.decisionDigest ||
				reconciliation.proposalDigest !== admission.proposalDigest ||
				reconciliation.admissionDigest !== admission.decisionDigest ||
				reconciliation.effectSequence !== admission.effectSequence
			)
				throw new TypeError("D774 route fact coordinates drifted");
			const material = strictSnapshot({
				...proposal,
				schemaVersion: D774_ROUTE_FACT_SCHEMA,
				resultDigest: empiricalStrictJsonDigest(result),
				resultFactDigest,
				reconciliationDigest: reconciliation.reconciliationDigest,
			});
			const { proposalDigest: _proposalDigest, ...withoutProposalDigest } = material;
			const fact = Object.freeze({
				...withoutProposalDigest,
				factDigest: empiricalStrictJsonDigest(withoutProposalDigest),
			}) as D774RouteFactV1;
			const before = facts.length;
			proposalNode.down([["DATA", fact]]);
			if (facts.length !== before + 1) throw new TypeError("D774 Graph omitted route admission");
			return fact;
		},
		snapshot(providerResultCountValue: number) {
			const providerResultCount = safeInteger(
				providerResultCountValue,
				"d774.routeEvidence.providerResultCount",
				{ max: 128 },
			);
			const material = strictSnapshot({
				schemaVersion: D774_ROUTE_EVIDENCE_SCHEMA,
				facts,
				providerResultCount,
				coverageComplete: facts.length === providerResultCount,
			});
			return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
		},
	});
}

export function validateD774RouteEvidence(
	value: unknown,
	providerFacts: readonly Readonly<Record<string, unknown>>[],
	ceilings?: D720EffectCeilingsV2,
	reconciliations?: readonly D719EffectReconciliationV1[],
): D774RouteEvidenceV1 {
	const candidate = ownRecord(
		value,
		["coverageComplete", "evidenceDigest", "facts", "providerResultCount", "schemaVersion"],
		"d774.routeEvidence",
	);
	if (candidate.schemaVersion !== D774_ROUTE_EVIDENCE_SCHEMA)
		throw new TypeError("D774 route evidence schema drifted");
	const facts = array(candidate.facts, "d774.routeEvidence.facts");
	if (facts.length > 128 || providerFacts.length > 128)
		throw new TypeError("D774 route evidence bound exceeded");
	if (
		candidate.providerResultCount !== providerFacts.length ||
		candidate.coverageComplete !== (facts.length === providerFacts.length)
	)
		throw new TypeError("D774 route evidence coverage drifted");
	const providerKeys = providerFacts.map((fact) => {
		const request = record(fact.request, "d774.providerFact.request");
		const result = record(fact.result, "d774.providerFact.result");
		if (request.effectKind !== "provider-request" || result.effectKind !== "provider-request")
			throw new TypeError("D774 provider fact kind drifted");
		return `${request.requestDigest}:${fact.admissionDigest}:${fact.factDigest}`;
	});
	const routeKeys = facts.map((value, index) => {
		const fact = ownRecord(
			value,
			[
				"admissionDigest",
				"attemptOrdinal",
				"contextDigest",
				"effectSequence",
				"factDigest",
				"inputBodyDigest",
				"logicalRequestDigest",
				"loweredBodyDigest",
				"modelVisibleMessagesDigest",
				"nextRequiredPhase",
				"reconciliationDigest",
				"requestDigest",
				"requiredDisposition",
				"requiredToolName",
				"resultDigest",
				"resultFactDigest",
				"runSequence",
				"schemaVersion",
			],
			`d774.routeEvidence.facts[${index}]`,
		);
		if (fact.schemaVersion !== D774_ROUTE_FACT_SCHEMA)
			throw new TypeError("D774 route fact schema drifted");
		const { factDigest, ...material } = fact;
		if (factDigest !== empiricalStrictJsonDigest(material))
			throw new TypeError("D774 route fact digest drifted");
		const providerFact = providerFacts.filter(
			(candidate) =>
				record(candidate.request, "d774.routeProvider.request").requestDigest ===
					fact.requestDigest &&
				candidate.admissionDigest === fact.admissionDigest &&
				candidate.factDigest === fact.resultFactDigest,
		);
		if (providerFact.length !== 1 || fact.resultDigest !== providerFact[0]!.resultDigest)
			throw new TypeError("D774 route fact is not exact for its provider result");
		if (reconciliations !== undefined) {
			const matchingReconciliations = reconciliations
				.map(validateReconciliation)
				.filter((reconciliation) => reconciliation.admissionDigest === fact.admissionDigest);
			if (
				matchingReconciliations.length !== 1 ||
				matchingReconciliations[0]!.reconciliationDigest !== fact.reconciliationDigest
			)
				throw new TypeError("D774 route fact is not exact for its usage reconciliation");
		}
		return `${fact.requestDigest}:${fact.admissionDigest}:${fact.resultFactDigest}`;
	});
	if (
		new Set(providerKeys).size !== providerKeys.length ||
		new Set(routeKeys).size !== routeKeys.length ||
		providerKeys.length !== routeKeys.length ||
		providerKeys.some((key) => !routeKeys.includes(key))
	)
		throw new TypeError("D774 provider-result/route-fact bijection drifted");
	if (ceilings !== undefined) digest(ceilings.routeDigest, "d774.routeEvidence.routeDigest");
	const { evidenceDigest, ...material } = candidate;
	if (evidenceDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D774 route evidence digest drifted");
	return strictSnapshot(candidate) as unknown as D774RouteEvidenceV1;
}
