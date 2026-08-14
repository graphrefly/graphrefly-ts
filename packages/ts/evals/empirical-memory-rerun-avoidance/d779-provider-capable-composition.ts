import { empiricalStrictJsonDigest, exactKeys, record, strictSnapshot } from "./canonical.js";
import type {
	D723OpenRouterConversationV1,
	D723RawToolIntentV1,
} from "./d723-openrouter-graph-turn.js";
import type { D733GraphNativeRouteAdmissionV1 } from "./d733-graph-native-route-profile.js";
import {
	invokeD734RouteBoundOpenRouterTurn,
	readD734RouteBoundProviderTurn,
} from "./d734-route-profile-provider-integration.js";
import type { D719EffectAdmissionV1 } from "./d767-clean-graph-ledger.js";
import {
	type D720GraphEffectRequestV1,
	validateD720GraphEffectResult,
} from "./d767-graph-native-effect-runtime.js";
import type {
	D720CallerEffectExecutionInputV2,
	D720CallerEffectExecutionV2,
} from "./d767-graph-native-eval.js";
import {
	createD776ProviderResultEnvelope,
	type D776RouteLoweringProposalV1,
	lowerD776ProviderChatRequest,
} from "./d776-provider-result-route-authority.js";
import {
	createD778GraphTaskEnvelope,
	createD778ModelVisibleConversation,
	type D778GraphTaskEnvelopeV1,
	type D778ToolRejectionCauseV1,
	validateD778FinalChatBody,
} from "./d778-graph-task-tool-authority.js";
import type {
	OpenRouterResponsesByteTransportV1,
	OpenRouterResponsesCredentialCapabilityV1,
} from "./openrouter-responses-model-turn.js";

export const D779_PROVIDER_RESULT_ENVELOPE_SCHEMA =
	"graphrefly.b112.d779.provider-result-envelope.v1" as const;

export interface D779ProviderResultEnvelopeV1 {
	readonly schemaVersion: typeof D779_PROVIDER_RESULT_ENVELOPE_SCHEMA;
	readonly execution: D720CallerEffectExecutionV2;
	readonly routeProposal: D776RouteLoweringProposalV1 | null;
	readonly taskEnvelope: D778GraphTaskEnvelopeV1 | null;
	readonly taskWireReceiptPresent: boolean;
	readonly toolRejectionReceiptPresent: boolean;
	readonly envelopeDigest: string;
}

export interface D779ConsumedProviderResultV1 {
	readonly envelope: D779ProviderResultEnvelopeV1;
	readonly taskWireReceipt: object | null;
	readonly toolRejection: Readonly<{
		causeCode: D778ToolRejectionCauseV1;
		runSequence: number;
		toolRef: string;
		workspaceStateBeforeDigest: string;
		workspaceStateAfterDigest: string;
	}> | null;
}

type Arm = Parameters<typeof createD778GraphTaskEnvelope>[0]["arm"];

const capabilities = new WeakMap<
	object,
	Readonly<{
		taskWireReceipt: object | null;
		toolRejection: D779ConsumedProviderResultV1["toolRejection"];
	}>
>();

function mapToolRejection(error: unknown): D778ToolRejectionCauseV1 | null {
	if (!(error instanceof TypeError)) return null;
	const message = error.message;
	if (message === "D779 focused validation failed") return "focused-validation-failed";
	if (message === "D779 exact replacement is not uniquely applicable")
		return "exact-replacement-not-applicable";
	if (
		message === "D779 read path is not allowed" ||
		message === "D779 writable path is not allowed"
	)
		return "path-not-allowed";
	if (message.startsWith("D779 unexpected tool arguments")) return "unexpected-arguments";
	if (message.startsWith("D779 malformed tool arguments")) return "malformed-arguments";
	return null;
}

function createEnvelope(input: {
	readonly effectRequest: D720GraphEffectRequestV1;
	readonly execution: D720CallerEffectExecutionV2;
	readonly routeProposal: D776RouteLoweringProposalV1 | null;
	readonly taskEnvelope: D778GraphTaskEnvelopeV1 | null;
	readonly taskWireReceipt: object | null;
	readonly toolRejection: D779ConsumedProviderResultV1["toolRejection"];
}): D779ProviderResultEnvelopeV1 {
	const base = createD776ProviderResultEnvelope({
		effectRequest: input.effectRequest,
		execution: input.execution,
		routeProposal: input.routeProposal,
	});
	const provider = input.effectRequest.effectKind === "provider-request";
	if (
		provider !==
		(input.taskEnvelope !== null && input.taskWireReceipt !== null && input.routeProposal !== null)
	)
		throw new TypeError("D779 provider task-wire capability cardinality drifted");
	if (
		(input.toolRejection !== null) !==
		(input.execution.result.effectKind === "tool-action" &&
			input.execution.result.status === "failed")
	)
		throw new TypeError("D779 tool-rejection capability cardinality drifted");
	const material = strictSnapshot({
		schemaVersion: D779_PROVIDER_RESULT_ENVELOPE_SCHEMA,
		execution: base.execution,
		routeProposal: base.routeProposal,
		taskEnvelope: input.taskEnvelope,
		taskWireReceiptPresent: input.taskWireReceipt !== null,
		toolRejectionReceiptPresent: input.toolRejection !== null,
	});
	const envelope = Object.freeze({
		...material,
		envelopeDigest: empiricalStrictJsonDigest(material),
	}) as D779ProviderResultEnvelopeV1;
	capabilities.set(envelope, {
		taskWireReceipt: input.taskWireReceipt,
		toolRejection: input.toolRejection,
	});
	return envelope;
}

export function consumeD779ProviderResultEnvelope(
	value: unknown,
	request: D720GraphEffectRequestV1,
	admission: D719EffectAdmissionV1,
): D779ConsumedProviderResultV1 {
	const candidate = record(value, "d779.envelope");
	exactKeys(
		candidate,
		[
			"envelopeDigest",
			"execution",
			"routeProposal",
			"schemaVersion",
			"taskEnvelope",
			"taskWireReceiptPresent",
			"toolRejectionReceiptPresent",
		],
		"d779.envelope",
	);
	if (candidate.schemaVersion !== D779_PROVIDER_RESULT_ENVELOPE_SCHEMA)
		throw new TypeError("D779 provider result envelope schema drifted");
	const stored = capabilities.get(candidate);
	if (stored === undefined)
		throw new TypeError("D779 provider result envelope is forged or replayed");
	capabilities.delete(candidate);
	const base = createD776ProviderResultEnvelope({
		effectRequest: request,
		execution: candidate.execution as D720CallerEffectExecutionV2,
		routeProposal: candidate.routeProposal as D776RouteLoweringProposalV1 | null,
	});
	if (
		base.routeProposal !== null &&
		base.routeProposal.admissionDigest !== admission.decisionDigest
	)
		throw new TypeError("D779 route proposal is not bound to its Graph admission");
	const rebuilt = createEnvelope({
		effectRequest: request,
		execution: base.execution,
		routeProposal: base.routeProposal,
		taskEnvelope: candidate.taskEnvelope as D778GraphTaskEnvelopeV1 | null,
		taskWireReceipt: stored.taskWireReceipt,
		toolRejection: stored.toolRejection,
	});
	capabilities.delete(rebuilt);
	if (candidate.envelopeDigest !== rebuilt.envelopeDigest)
		throw new TypeError("D779 provider result envelope digest drifted");
	return Object.freeze({
		envelope: rebuilt,
		taskWireReceipt: stored.taskWireReceipt,
		toolRejection: stored.toolRejection,
	});
}

type D779RouteTurnInput = {
	readonly arm: Arm;
	readonly admission: D719EffectAdmissionV1;
	readonly effectRequest: D720GraphEffectRequestV1;
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly routeAdmission: D733GraphNativeRouteAdmissionV1;
	readonly monotonicNowMs: () => number;
	readonly signal: AbortSignal;
	readonly conversation?: D723OpenRouterConversationV1;
};

export interface D779AdmittedRouteTurnV1 {
	readonly envelope: D779ProviderResultEnvelopeV1;
	readonly conversation: D723OpenRouterConversationV1;
	readonly rawToolIntents: readonly D723RawToolIntentV1[];
}

async function invokeD779AdmittedRouteTurnInternal(
	inputValue: D779RouteTurnInput,
): Promise<D779AdmittedRouteTurnV1> {
	const input = record(inputValue, "d779.routeTurn");
	exactKeys(
		input,
		[
			"admission",
			"arm",
			"credential",
			"effectRequest",
			"monotonicNowMs",
			"routeAdmission",
			"signal",
			"transport",
			...(Object.hasOwn(input, "conversation") ? ["conversation" as const] : []),
		],
		"d779.routeTurn",
	);
	const request = input.effectRequest as D720GraphEffectRequestV1;
	if (request.effectKind !== "provider-request")
		throw new TypeError("D779 route turn requires a provider request");
	const taskEnvelope = createD778GraphTaskEnvelope({
		arm: input.arm as Arm,
		effectRequest: request,
	});
	const currentTask = createD778ModelVisibleConversation(taskEnvelope);
	const priorConversation = Object.hasOwn(input, "conversation")
		? (input.conversation as D723OpenRouterConversationV1)
		: null;
	const conversation =
		priorConversation === null
			? currentTask
			: strictSnapshot({
					messages: [...currentTask.messages, ...priorConversation.messages.slice(2)],
				});
	let calls = 0;
	let routeProposal: D776RouteLoweringProposalV1 | null = null;
	let taskWireReceipt: object | null = null;
	const capability = await invokeD734RouteBoundOpenRouterTurn({
		effectRequest: request as never,
		credential: input.credential as OpenRouterResponsesCredentialCapabilityV1,
		transport: {
			async request(transportRequest) {
				calls += 1;
				if (calls !== 1) throw new TypeError("D779 adapter attempted multiple transports");
				const lowered = lowerD776ProviderChatRequest({
					effectRequest: request,
					admission: input.admission as D719EffectAdmissionV1,
					body: transportRequest.body,
				});
				routeProposal = lowered.proposal;
				taskWireReceipt = validateD778FinalChatBody({
					body: lowered.body,
					envelope: taskEnvelope,
					requestDigest: request.requestDigest,
					...(request.completionContext == null
						? {}
						: { completionContext: request.completionContext }),
				});
				return (input.transport as OpenRouterResponsesByteTransportV1).request({
					...transportRequest,
					body: lowered.body,
				});
			},
		},
		taskStatement: taskEnvelope.taskStatement,
		conversation,
		signal: input.signal as AbortSignal,
		monotonicNowMs: input.monotonicNowMs as () => number,
		routeAdmission: input.routeAdmission as D733GraphNativeRouteAdmissionV1,
		usageBasis: "measured",
	});
	if (calls !== 1 || routeProposal === null || taskWireReceipt === null)
		throw new TypeError("D779 admitted route omitted an exact wire capability");
	const snapshot = readD734RouteBoundProviderTurn(capability);
	const terminal = snapshot.turn.result.status === "terminal-failure";
	const result = validateD720GraphEffectResult(
		terminal
			? {
					...snapshot.turn.result,
					failureProvenance: "http-terminal",
					executorFailureClassification: null,
				}
			: snapshot.turn.result,
		request,
	);
	const envelope = createEnvelope({
		effectRequest: request,
		routeProposal,
		taskEnvelope,
		taskWireReceipt,
		toolRejection: null,
		execution: {
			result,
			actualCostMicrousd: snapshot.turn.actualCostMicrousd,
			actualElapsedMs: snapshot.turn.actualElapsedMs,
			...(snapshot.usageBasis === "conservative-reservation"
				? { usageBasis: snapshot.usageBasis }
				: {}),
		},
	});
	return Object.freeze({
		envelope,
		conversation: snapshot.turn.conversation,
		rawToolIntents: snapshot.turn.rawToolIntents,
	});
}

export async function invokeD779AdmittedRouteTurn(
	inputValue: D779RouteTurnInput,
): Promise<D779ProviderResultEnvelopeV1> {
	return (await invokeD779AdmittedRouteTurnInternal(inputValue)).envelope;
}

export async function invokeD779AdmittedRouteTurnWithState(
	inputValue: D779RouteTurnInput,
): Promise<D779AdmittedRouteTurnV1> {
	return invokeD779AdmittedRouteTurnInternal(inputValue);
}

export async function executeD779ToolBoundary(inputValue: {
	readonly input: D720CallerEffectExecutionInputV2;
	readonly execute: () => Promise<D720CallerEffectExecutionV2>;
	readonly snapshotWorkspaceState: () => Promise<string>;
	readonly elapsedOnRejectionMs: () => number;
}): Promise<D779ProviderResultEnvelopeV1> {
	const input = record(inputValue, "d779.toolBoundary");
	exactKeys(
		input,
		["elapsedOnRejectionMs", "execute", "input", "snapshotWorkspaceState"],
		"d779.toolBoundary",
	);
	const executionInput = input.input as D720CallerEffectExecutionInputV2;
	const request = executionInput.effectRequest;
	if (request.effectKind !== "tool-action" || request.toolIntent === null)
		throw new TypeError("D779 tool boundary requires a Graph-issued tool action");
	const before = await (input.snapshotWorkspaceState as () => Promise<string>)();
	try {
		const execution = await (input.execute as () => Promise<D720CallerEffectExecutionV2>)();
		return createEnvelope({
			effectRequest: request,
			execution,
			routeProposal: null,
			taskEnvelope: null,
			taskWireReceipt: null,
			toolRejection: null,
		});
	} catch (error) {
		const causeCode = mapToolRejection(error);
		if (causeCode === null) throw error;
		const after = await (input.snapshotWorkspaceState as () => Promise<string>)();
		if (after !== before)
			throw new TypeError("D779 rejected tool changed workspace state", { cause: error });
		const execution: D720CallerEffectExecutionV2 = Object.freeze({
			actualCostMicrousd: 0,
			actualElapsedMs: (input.elapsedOnRejectionMs as () => number)(),
			result: Object.freeze({
				effectKind: "tool-action" as const,
				toolRef: request.toolIntent.toolRef,
				intentDigest: request.toolIntent.intentDigest,
				status: "failed" as const,
				nonEmptyDiff: false,
				workspaceStateBeforeDigest: before,
				workspaceStateAfterDigest: after,
				evidenceDigest: empiricalStrictJsonDigest({
					requestDigest: request.requestDigest,
					causeCode,
					before,
					after,
				}),
			}),
		});
		return createEnvelope({
			effectRequest: request,
			execution,
			routeProposal: null,
			taskEnvelope: null,
			taskWireReceipt: null,
			toolRejection: Object.freeze({
				causeCode,
				runSequence: request.runSequence,
				toolRef: request.toolIntent.toolRef,
				workspaceStateBeforeDigest: before,
				workspaceStateAfterDigest: after,
			}),
		});
	}
}

export function createD779PlainEffectEnvelope(inputValue: {
	readonly effectRequest: D720GraphEffectRequestV1;
	readonly execution: D720CallerEffectExecutionV2;
}): D779ProviderResultEnvelopeV1 {
	return createEnvelope({
		effectRequest: inputValue.effectRequest,
		execution: inputValue.execution,
		routeProposal: null,
		taskEnvelope: null,
		taskWireReceipt: null,
		toolRejection: null,
	});
}

export function createD779ProviderResultEnvelope(inputValue: {
	readonly effectRequest: D720GraphEffectRequestV1;
	readonly execution: D720CallerEffectExecutionV2;
	readonly routeProposal: null;
}): D779ProviderResultEnvelopeV1 {
	if (inputValue.routeProposal !== null)
		throw new TypeError("D779 plain effect envelope cannot carry a provider route proposal");
	return createD779PlainEffectEnvelope(inputValue);
}

export function replaceD779ProviderExecutionForQualification(inputValue: {
	readonly envelope: D779ProviderResultEnvelopeV1;
	readonly effectRequest: D720GraphEffectRequestV1;
	readonly admission: D719EffectAdmissionV1;
	readonly execution: D720CallerEffectExecutionV2;
}): D779ProviderResultEnvelopeV1 {
	const consumed = consumeD779ProviderResultEnvelope(
		inputValue.envelope,
		inputValue.effectRequest,
		inputValue.admission,
	);
	if (consumed.envelope.routeProposal === null || consumed.envelope.taskEnvelope === null)
		throw new TypeError("D779 qualification replacement requires a provider envelope");
	return createEnvelope({
		effectRequest: inputValue.effectRequest,
		execution: inputValue.execution,
		routeProposal: consumed.envelope.routeProposal,
		taskEnvelope: consumed.envelope.taskEnvelope,
		taskWireReceipt: consumed.taskWireReceipt,
		toolRejection: null,
	});
}
