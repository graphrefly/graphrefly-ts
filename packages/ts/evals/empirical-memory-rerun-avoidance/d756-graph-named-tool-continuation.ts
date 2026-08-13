import type { StrictJsonValue } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	type D720GraphEffectRequestV1,
	type D720ToolRef,
	D748_FORWARD_PHASE_CONTEXT_SCHEMA,
	D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA,
} from "./d722-graph-native-effect-runtime.js";
import type {
	D720CallerEffectExecutionInputV2,
	D720CallerEffectExecutionV2,
} from "./d722-graph-native-eval.js";
import type { D733GraphNativeRouteAdmissionV1 } from "./d733-graph-native-route-profile.js";
import {
	type D733OpenRouterTurnV1,
	invokeD733OpenRouterGraphTurn,
} from "./d733-openrouter-graph-turn.js";
import {
	createD734RouteBoundProviderAdapter,
	type D734RouteBoundProviderAdapterV1,
	invokeD734RouteBoundOpenRouterTurn,
} from "./d734-route-profile-provider-integration.js";
import type {
	OpenRouterResponsesByteTransportV1,
	OpenRouterResponsesTransportRequestV1,
} from "./openrouter-responses-model-turn.js";

export const D756_GRAPH_NAMED_TOOL_LOWERING_REVISION =
	"graphrefly.b112.d756.graph-named-tool-lowering.v1" as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const TOOL_NAMES = Object.freeze({
	"read-file": "read_file",
	"search-repository": "search_repository",
	"replace-exact": "replace_exact",
	"workspace-diff": "workspace_diff",
	"focused-validation": "focused_validation",
} satisfies Record<D720ToolRef, string>);

export type D756GraphToolDirectiveV1 = Readonly<{
	revision: typeof D756_GRAPH_NAMED_TOOL_LOWERING_REVISION;
	contextDigest: string;
	nextRequiredPhase: string;
	requiredDisposition: "tool-intents" | "structured-final";
	requiredToolRef: D720ToolRef | null;
	directiveDigest: string;
}>;

function requiredToolRef(
	phase: NonNullable<D720GraphEffectRequestV1["completionContext"]>["nextRequiredPhase"],
): D720ToolRef | null {
	if (phase === "inspection") return "read-file";
	if (phase === "exact-mutation") return "replace-exact";
	if (phase === "workspace-diff") return "workspace-diff";
	if (phase === "focused-validation") return "focused-validation";
	if (phase === "hidden-verifier") return null;
	throw new TypeError("D756 Graph required phase is invalid");
}

function validateContext(
	value: unknown,
): NonNullable<D720GraphEffectRequestV1["completionContext"]> {
	const context = record(value, "d756.completionContext");
	exactKeys(
		context,
		[
			"budgetProjectionDigest",
			"contextDigest",
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
		],
		"d756.completionContext",
	);
	oneOf(
		context.schemaVersion,
		[D748_FORWARD_PHASE_CONTEXT_SCHEMA, D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA],
		"d756.context.schema",
	);
	if (
		context.schemaVersion === D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA &&
		context.reason !== "hidden-verifier-failed" &&
		context.reason !== "objective-phase-advanced"
	)
		throw new TypeError("D759 correction context reason drifted");
	if (
		context.schemaVersion !== D759_HIDDEN_VERIFIER_CORRECTION_CONTEXT_SCHEMA &&
		context.reason === "hidden-verifier-failed"
	)
		throw new TypeError("D759 correction reason requires the D759 context schema");
	oneOf(
		context.nextRequiredPhase,
		["inspection", "exact-mutation", "workspace-diff", "focused-validation", "hidden-verifier"],
		"d756.context.nextRequiredPhase",
	);
	oneOf(
		context.requiredDisposition,
		["tool-intents", "structured-final"],
		"d756.context.requiredDisposition",
	);
	for (const key of [
		"budgetProjectionDigest",
		"contextDigest",
		"issuedRequestDigest",
		"rejectedRequestDigest",
		"workspaceStateDigest",
	] as const)
		digest(context[key], `d756.context.${key}`);
	const missing = array(context.missingObjectivePhases, "d756.context.missingObjectivePhases");
	if (missing.length > 4) throw new TypeError("D756 missing objective phase bound exceeded");
	for (const phase of missing)
		oneOf(
			phase,
			["inspection", "exact-mutation", "workspace-diff", "focused-validation"],
			"d756.context.missingObjectivePhase",
		);
	const refs = array(context.evidenceFreshnessRefs, "d756.context.evidenceFreshnessRefs");
	if (refs.length !== 2) throw new TypeError("D756 freshness coverage drifted");
	for (const ref of refs) digest(ref, "d756.context.evidenceFreshnessRef");
	const remaining = record(context.remainingAdmittedBounds, "d756.context.remainingBounds");
	exactKeys(
		remaining,
		["costMicrousd", "elapsedMs", "requests", "retryWaits"],
		"d756.context.remainingBounds",
	);
	for (const key of ["costMicrousd", "elapsedMs", "requests", "retryWaits"] as const)
		safeInteger(remaining[key], `d756.context.remainingBounds.${key}`, { max: 1_000_000_000 });
	for (const key of ["remainingCompletionContexts", "remainingEffectFacts", "runSequence"] as const)
		safeInteger(context[key], `d756.context.${key}`, { max: 512 });
	const { contextDigest: _contextDigest, ...material } = context;
	literal(context.contextDigest, empiricalStrictJsonDigest(material), "d756.context.contextDigest");
	return context as unknown as NonNullable<D720GraphEffectRequestV1["completionContext"]>;
}

export function deriveD756GraphToolDirective(
	request: D720GraphEffectRequestV1,
): D756GraphToolDirectiveV1 | null {
	const candidate = record(request, "d756.effectRequest");
	if (candidate.effectKind !== "provider-request")
		throw new TypeError("D756 named-tool lowering requires a provider effect");
	if (!Object.hasOwn(candidate, "completionContext")) return null;
	const context = validateContext(candidate.completionContext);
	const toolRef = requiredToolRef(context.nextRequiredPhase);
	if (
		(context.requiredDisposition === "structured-final") !== (toolRef === null) ||
		(context.requiredDisposition === "tool-intents") !== (toolRef !== null)
	)
		throw new TypeError("D756 Graph disposition and required phase disagree");
	const material = strictSnapshot({
		revision: D756_GRAPH_NAMED_TOOL_LOWERING_REVISION,
		contextDigest: context.contextDigest,
		nextRequiredPhase: context.nextRequiredPhase,
		requiredDisposition: context.requiredDisposition,
		requiredToolRef: toolRef,
	});
	return Object.freeze({ ...material, directiveDigest: empiricalStrictJsonDigest(material) });
}

function lowerChatBody(bytes: Uint8Array, directive: D756GraphToolDirectiveV1): Uint8Array {
	if (bytes.byteLength < 1 || bytes.byteLength > 1_048_576)
		throw new TypeError("D756 Chat body is outside the bound");
	let decoded: unknown;
	try {
		decoded = JSON.parse(decoder.decode(bytes));
	} catch (error) {
		throw new TypeError("D756 Chat body is not UTF-8 JSON", { cause: error });
	}
	const body = record(decoded, "d756.chatBody");
	exactKeys(
		body,
		["messages", "model", "provider", "reasoning", "stream", "tool_choice", "tools"],
		"d756.chatBody",
	);
	if (body.tool_choice !== "required")
		throw new TypeError("D756 expected the admitted completion request to require a disposition");
	const tools = array(body.tools, "d756.chatBody.tools");
	if (directive.requiredToolRef !== null) {
		const requiredName = TOOL_NAMES[directive.requiredToolRef];
		const matching = tools.filter((entry, index) => {
			const tool = record(entry, `d756.chatBody.tools[${index}]`);
			const fn = record(tool.function, `d756.chatBody.tools[${index}].function`);
			return tool.type === "function" && fn.name === requiredName;
		});
		if (matching.length !== 1)
			throw new TypeError("D756 required named tool is not uniquely available");
	}
	const lowered = strictSnapshot({
		...body,
		tool_choice:
			directive.requiredToolRef === null
				? "none"
				: { type: "function", function: { name: TOOL_NAMES[directive.requiredToolRef] } },
	}) as StrictJsonValue;
	const encoded = encoder.encode(JSON.stringify(lowered));
	if (encoded.byteLength > 1_048_576)
		throw new TypeError("D756 lowered Chat body exceeds the bound");
	return encoded;
}

export function createD756GraphNamedToolTransport(inputValue: {
	readonly effectRequest: D720GraphEffectRequestV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
}): OpenRouterResponsesByteTransportV1 {
	const input = record(inputValue, "d756.transportInput");
	exactKeys(input, ["effectRequest", "transport"], "d756.transportInput");
	const directive = deriveD756GraphToolDirective(input.effectRequest as D720GraphEffectRequestV1);
	const inputTransport = input.transport as OpenRouterResponsesByteTransportV1;
	if (directive === null) return inputTransport;
	const transportRecord = record(inputTransport, "d756.transport");
	exactKeys(transportRecord, ["request"], "d756.transport");
	if (typeof transportRecord.request !== "function")
		throw new TypeError("D756 transport request port is invalid");
	let calls = 0;
	return Object.freeze({
		async request(request: OpenRouterResponsesTransportRequestV1) {
			calls += 1;
			if (calls !== 1) throw new TypeError("D756 transport was called more than once");
			return Reflect.apply(
				transportRecord.request as (...args: unknown[]) => unknown,
				inputTransport,
				[{ ...request, body: lowerChatBody(request.body, directive) }],
			) as ReturnType<OpenRouterResponsesByteTransportV1["request"]>;
		},
	});
}

export async function invokeD756GraphNamedToolOpenRouterTurn(
	input: Parameters<typeof invokeD733OpenRouterGraphTurn>[0],
): Promise<D733OpenRouterTurnV1> {
	const captured = record(input, "d756.turn");
	exactKeys(
		captured,
		[
			"conversation",
			"credential",
			"effectRequest",
			"monotonicNowMs",
			"routeAdmission",
			"signal",
			"taskStatement",
			"transport",
		],
		"d756.turn",
	);
	const effectRequest = captured.effectRequest as D720GraphEffectRequestV1;
	const transport = createD756GraphNamedToolTransport({
		effectRequest,
		transport: captured.transport as OpenRouterResponsesByteTransportV1,
	});
	const turn = await invokeD733OpenRouterGraphTurn({
		...(captured as unknown as Parameters<typeof invokeD733OpenRouterGraphTurn>[0]),
		transport,
	});
	return turn;
}

export async function invokeD756RouteBoundOpenRouterTurn(
	input: Parameters<typeof invokeD734RouteBoundOpenRouterTurn>[0],
): ReturnType<typeof invokeD734RouteBoundOpenRouterTurn> {
	const captured = record(input, "d756.routeBoundTurn");
	exactKeys(
		captured,
		[
			"conversation",
			"credential",
			"effectRequest",
			"monotonicNowMs",
			"routeAdmission",
			"signal",
			"taskStatement",
			"transport",
			...(Object.hasOwn(captured, "usageBasis") ? ["usageBasis" as const] : []),
		],
		"d756.routeBoundTurn",
	);
	return invokeD734RouteBoundOpenRouterTurn({
		...(captured as unknown as Parameters<typeof invokeD734RouteBoundOpenRouterTurn>[0]),
		transport: createD756GraphNamedToolTransport({
			effectRequest: captured.effectRequest as D720GraphEffectRequestV1,
			transport: captured.transport as OpenRouterResponsesByteTransportV1,
		}),
	});
}

type EffectPort = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<D720CallerEffectExecutionV2>;

type ProviderInputPort = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<Omit<Parameters<typeof invokeD734RouteBoundOpenRouterTurn>[0], "effectRequest">>;

export function createD756RouteBoundProviderAdapter(inputValue: {
	readonly routeAdmission: D733GraphNativeRouteAdmissionV1;
	readonly executionClass?: "injected-no-network" | "live-provider";
	readonly materialization: EffectPort;
	readonly providerRequestInput: ProviderInputPort;
	readonly retryWait: EffectPort;
	readonly toolAction: EffectPort;
	readonly hiddenVerifier: EffectPort;
	readonly cleanup: EffectPort;
}): D734RouteBoundProviderAdapterV1 {
	const input = record(inputValue, "d756.adapter");
	exactKeys(
		input,
		[
			"cleanup",
			...(Object.hasOwn(input, "executionClass") ? ["executionClass" as const] : []),
			"hiddenVerifier",
			"materialization",
			"providerRequestInput",
			"retryWait",
			"routeAdmission",
			"toolAction",
		],
		"d756.adapter",
	);
	for (const key of [
		"cleanup",
		"hiddenVerifier",
		"materialization",
		"providerRequestInput",
		"retryWait",
		"toolAction",
	] as const)
		if (typeof input[key] !== "function") throw new TypeError(`D756 ${key} port is invalid`);
	return createD734RouteBoundProviderAdapter({
		routeAdmission: input.routeAdmission as D733GraphNativeRouteAdmissionV1,
		...(Object.hasOwn(input, "executionClass")
			? { executionClass: input.executionClass as "injected-no-network" | "live-provider" }
			: {}),
		materialization: input.materialization as EffectPort,
		retryWait: input.retryWait as EffectPort,
		toolAction: input.toolAction as EffectPort,
		hiddenVerifier: input.hiddenVerifier as EffectPort,
		cleanup: input.cleanup as EffectPort,
		async providerRequest(executionInput) {
			const providerInput = await Reflect.apply(
				input.providerRequestInput as ProviderInputPort,
				undefined,
				[executionInput],
			);
			const providerInputRecord = record(providerInput, "d756.providerInput");
			exactKeys(
				providerInputRecord,
				[
					"conversation",
					"credential",
					"monotonicNowMs",
					"routeAdmission",
					"signal",
					"taskStatement",
					"transport",
					...(Object.hasOwn(providerInputRecord, "usageBasis") ? ["usageBasis" as const] : []),
				],
				"d756.providerInput",
			);
			return invokeD756RouteBoundOpenRouterTurn({
				...(providerInputRecord as unknown as Omit<
					Parameters<typeof invokeD734RouteBoundOpenRouterTurn>[0],
					"effectRequest"
				>),
				effectRequest: executionInput.effectRequest,
			});
		},
	});
}
