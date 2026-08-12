import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import type { Node } from "../../src/node/node.js";
import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	strictSnapshot,
} from "./canonical.js";
import { validateD720GraphEffectResult } from "./d722-graph-native-effect-runtime.js";
import type {
	D720CallerEffectExecutionInputV2,
	D720CallerEffectExecutionV2,
} from "./d722-graph-native-eval.js";
import {
	createD724TerminalHttpEvidence,
	type D724TerminalHttpEvidenceV1,
} from "./d724-terminal-http-evidence.js";
import {
	D725_OPENROUTER_TURN_REVISION,
	type D725OpenRouterTurnV1,
} from "./d725-terminal-http-real-provider.js";
import { D729_BUDGET_LIMITS, D729_EFFECT_CEILINGS } from "./d729-coordinates.js";
import {
	createD726ProviderAdapter,
	createD726ProviderTurn,
	type D726ProviderAdapterV1,
	type D726ProviderTurnV1,
	runD726GraphProviderBlockCore,
	runD726InjectedNoNetworkQualification,
} from "./d729-provider-block-core.js";
import {
	type D733GraphNativeRouteAdmissionV1,
	readD733AdmittedRouteProfile,
} from "./d733-graph-native-route-profile.js";
import {
	type D733OpenRouterTurnV1,
	invokeD733OpenRouterGraphTurn,
} from "./d733-openrouter-graph-turn.js";
import type {
	OpenRouterResponsesByteTransportV1,
	OpenRouterResponsesCredentialCapabilityV1,
	OpenRouterResponsesTransportRequestV1,
	OpenRouterResponsesTransportResponseV1,
} from "./openrouter-responses-model-turn.js";

export const D734_DECISION_REF = "decision.D734" as const;
export const D734_DECISION_REVISION = "2026-08-11.v1" as const;
export const D734_ROUTE_BINDING_FACT_SCHEMA = "graphrefly.b112.d734.route-binding-fact.v1" as const;
export const D734_ROUTE_GRAPH_EVIDENCE_SCHEMA =
	"graphrefly.b112.d734.route-graph-evidence.v1" as const;

export interface D734RouteBindingFactV1 {
	readonly schemaVersion: typeof D734_ROUTE_BINDING_FACT_SCHEMA;
	readonly effectRequestDigest: string;
	readonly effectAdmissionDigest: string;
	readonly providerResultDigest: string;
	readonly routeProfileDigest: string;
	readonly routeAdmissionDigest: string;
	readonly actualRouteEvidenceDigest: string | null;
	readonly factDigest: string;
}

export interface D734RouteGraphEvidenceV1 {
	readonly schemaVersion: typeof D734_ROUTE_GRAPH_EVIDENCE_SCHEMA;
	readonly facts: readonly D734RouteBindingFactV1[];
	readonly evidenceDigest: string;
}

export interface D734RouteBoundProviderTurnV1 {
	readonly revision: "graphrefly.b112.d734.route-bound-provider-turn.v1";
}

export interface D734RouteBoundProviderAdapterV1 {
	readonly revision: "graphrefly.b112.d734.route-bound-provider-adapter.v1";
}

export interface D734RouteBoundProviderTurnSnapshotV1 {
	readonly turn: D725OpenRouterTurnV1;
	readonly routeProfileDigest: string;
	readonly routeAdmissionDigest: string;
	readonly actualRouteEvidenceDigest: string | null;
	readonly usageBasis: "measured" | "conservative-reservation";
}

type EffectPort = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<D720CallerEffectExecutionV2>;
type RouteProviderPort = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<D734RouteBoundProviderTurnV1>;

interface TurnState {
	readonly turn: D725OpenRouterTurnV1;
	readonly routeProfileDigest: string;
	readonly routeAdmissionDigest: string;
	readonly actualRouteEvidenceDigest: string | null;
	readonly usageBasis: "measured" | "conservative-reservation";
}

interface RouteAuthorityState {
	readonly proposalNode: Node<unknown>;
	readonly facts: D734RouteBindingFactV1[];
}

interface AdapterState {
	readonly adapter: D726ProviderAdapterV1;
	readonly authority: RouteAuthorityState;
	readonly profileDigest: string;
	readonly routeAdmissionDigest: string;
	consumed: boolean;
}

const turnStates = new WeakMap<object, TurnState>();
const adapterStates = new WeakMap<object, AdapterState>();

function validateRouteBindingFact(value: unknown): D734RouteBindingFactV1 {
	const candidate = record(value, "d734.routeBindingFact");
	exactKeys(
		candidate,
		[
			"actualRouteEvidenceDigest",
			"effectAdmissionDigest",
			"effectRequestDigest",
			"factDigest",
			"providerResultDigest",
			"routeAdmissionDigest",
			"routeProfileDigest",
			"schemaVersion",
		],
		"d734.routeBindingFact",
	);
	literal(candidate.schemaVersion, D734_ROUTE_BINDING_FACT_SCHEMA, "d734.routeBindingFact.schema");
	for (const key of [
		"effectAdmissionDigest",
		"effectRequestDigest",
		"providerResultDigest",
		"routeAdmissionDigest",
		"routeProfileDigest",
	] as const)
		digest(candidate[key], `d734.routeBindingFact.${key}`);
	if (candidate.actualRouteEvidenceDigest !== null)
		digest(candidate.actualRouteEvidenceDigest, "d734.routeBindingFact.actualRouteEvidenceDigest");
	const factDigest = digest(candidate.factDigest, "d734.routeBindingFact.factDigest");
	const { factDigest: _factDigest, ...material } = candidate;
	literal(factDigest, empiricalStrictJsonDigest(material), "d734.routeBindingFact.factDigest");
	return strictSnapshot(candidate) as unknown as D734RouteBindingFactV1;
}

function createRouteAuthority(): RouteAuthorityState {
	const owner = graph({ name: "d734/route-binding-authority" });
	const proposalNode = owner.node<unknown>([], null, { name: "d734/route-binding-proposals" });
	const admissionNode = owner.node<D734RouteBindingFactV1>(
		[proposalNode],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) ctx.down([["DATA", validateRouteBindingFact(raw)]]);
		},
		{ name: "d734/route-binding-admissions", factory: "d734RouteBindingAdmission" },
	);
	const facts: D734RouteBindingFactV1[] = [];
	admissionNode.subscribe((message) => {
		if (message[0] !== "DATA") return;
		if (facts.length >= 256) throw new TypeError("D734 route binding fact bound exhausted");
		const fact = message[1] as D734RouteBindingFactV1;
		if (facts.some((candidate) => candidate.effectAdmissionDigest === fact.effectAdmissionDigest))
			throw new TypeError("D734 route binding admission was replayed");
		facts.push(fact);
	});
	return { proposalNode, facts };
}

function admitRouteBinding(
	authority: RouteAuthorityState,
	input: Omit<D734RouteBindingFactV1, "factDigest" | "schemaVersion">,
): D734RouteBindingFactV1 {
	const material = strictSnapshot({
		schemaVersion: D734_ROUTE_BINDING_FACT_SCHEMA,
		...input,
	});
	const proposal = Object.freeze({
		...material,
		factDigest: empiricalStrictJsonDigest(material),
	});
	const before = authority.facts.length;
	authority.proposalNode.down([["DATA", proposal]]);
	const admitted = authority.facts[before];
	if (admitted === undefined || authority.facts.length !== before + 1)
		throw new TypeError("D734 Graph omitted route binding admission");
	return admitted;
}

function snapshotRouteEvidence(authority: RouteAuthorityState): D734RouteGraphEvidenceV1 {
	const material = strictSnapshot({
		schemaVersion: D734_ROUTE_GRAPH_EVIDENCE_SCHEMA,
		facts: authority.facts,
	});
	return strictSnapshot({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D734RouteGraphEvidenceV1;
}

export function validateD734RouteGraphEvidence(value: unknown): D734RouteGraphEvidenceV1 {
	const candidate = record(value, "d734.routeGraphEvidence");
	exactKeys(candidate, ["evidenceDigest", "facts", "schemaVersion"], "d734.routeGraphEvidence");
	literal(
		candidate.schemaVersion,
		D734_ROUTE_GRAPH_EVIDENCE_SCHEMA,
		"d734.routeGraphEvidence.schema",
	);
	const rawFacts = array(candidate.facts, "d734.routeGraphEvidence.facts");
	if (rawFacts.length > 256) throw new TypeError("D734 route Graph fact array is invalid");
	const facts = Object.freeze(rawFacts.map(validateRouteBindingFact));
	const admissions = new Set(facts.map((fact) => fact.effectAdmissionDigest));
	if (admissions.size !== facts.length)
		throw new TypeError("D734 route Graph evidence repeats an effect admission");
	const material = strictSnapshot({ schemaVersion: D734_ROUTE_GRAPH_EVIDENCE_SCHEMA, facts });
	literal(
		candidate.evidenceDigest,
		empiricalStrictJsonDigest(material),
		"d734.routeGraphEvidence.digest",
	);
	return strictSnapshot({
		...material,
		evidenceDigest: candidate.evidenceDigest,
	}) as unknown as D734RouteGraphEvidenceV1;
}

function capturedActualRouteEvidenceDigest(
	response: OpenRouterResponsesTransportResponseV1 | null,
): string | null {
	if (response === null || response.status !== 200) return null;
	let root: unknown;
	try {
		root = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body));
	} catch (error) {
		throw new TypeError("D734 provider response is not UTF-8 JSON", { cause: error });
	}
	const object = record(root, "d734.providerResponse");
	return empiricalStrictJsonDigest(
		record(object.openrouter_metadata, "d734.providerResponse.route"),
	);
}

function terminalEvidence(
	turn: D733OpenRouterTurnV1,
	response: OpenRouterResponsesTransportResponseV1 | null,
): D724TerminalHttpEvidenceV1 | null {
	if (turn.result.status !== "terminal-failure") return null;
	if (response === null)
		throw new TypeError("D734 terminal provider turn omitted its HTTP response");
	return createD724TerminalHttpEvidence({
		httpStatus: response.status,
		mediaTypeDisposition: "unavailable",
		retryAfterDisposition:
			response.retryAfterDisposition ?? (response.retryAfterMs === null ? "unavailable" : "parsed"),
		responseBytes: response.body,
	});
}

export async function invokeD734RouteBoundOpenRouterTurn(input: {
	readonly effectRequest: Parameters<typeof invokeD733OpenRouterGraphTurn>[0]["effectRequest"];
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly taskStatement: string;
	readonly conversation: Parameters<typeof invokeD733OpenRouterGraphTurn>[0]["conversation"];
	readonly signal: AbortSignal;
	readonly monotonicNowMs: () => number;
	readonly routeAdmission: D733GraphNativeRouteAdmissionV1;
	readonly usageBasis?: "measured" | "conservative-reservation";
}): Promise<D734RouteBoundProviderTurnV1> {
	const captured = record(input, "d734.turn.input");
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
		"d734.turn.input",
	);
	const routeAdmission = captured.routeAdmission as D733GraphNativeRouteAdmissionV1;
	const profile = readD733AdmittedRouteProfile(routeAdmission);
	const inputTransport = record(captured.transport, "d734.turn.transport");
	exactKeys(inputTransport, ["request"], "d734.turn.transport");
	const requestPort = inputTransport.request;
	if (typeof requestPort !== "function")
		throw new TypeError("D734 transport request port is invalid");
	let response: OpenRouterResponsesTransportResponseV1 | null = null;
	const transport: OpenRouterResponsesByteTransportV1 = Object.freeze({
		async request(request: OpenRouterResponsesTransportRequestV1) {
			if (response !== null) throw new TypeError("D734 transport was invoked more than once");
			const next = record(
				await Reflect.apply(requestPort, captured.transport, [request]),
				"d734.turn.transportResponse",
			);
			exactKeys(
				next,
				Object.hasOwn(next, "retryAfterDisposition")
					? ["body", "retryAfterDisposition", "retryAfterMs", "status"]
					: ["body", "retryAfterMs", "status"],
				"d734.turn.transportResponse",
			);
			if (!(next.body instanceof Uint8Array) || next.body.byteLength > 1_048_576)
				throw new TypeError("D734 transport response body is invalid");
			response = Object.freeze({
				...(next as unknown as OpenRouterResponsesTransportResponseV1),
				body: new Uint8Array(next.body),
			});
			return response;
		},
	});
	const d733Turn = await invokeD733OpenRouterGraphTurn({
		effectRequest: captured.effectRequest as Parameters<
			typeof invokeD733OpenRouterGraphTurn
		>[0]["effectRequest"],
		credential: captured.credential as OpenRouterResponsesCredentialCapabilityV1,
		transport,
		taskStatement: captured.taskStatement as string,
		conversation: captured.conversation as Parameters<
			typeof invokeD733OpenRouterGraphTurn
		>[0]["conversation"],
		signal: captured.signal as AbortSignal,
		monotonicNowMs: captured.monotonicNowMs as () => number,
		routeAdmission,
	});
	const routeEvidenceDigest = capturedActualRouteEvidenceDigest(response);
	const d725Turn = Object.freeze({
		...d733Turn,
		revision: D725_OPENROUTER_TURN_REVISION,
		terminalHttpEvidence: terminalEvidence(d733Turn, response),
	}) as D725OpenRouterTurnV1;
	const usageBasis = Object.hasOwn(captured, "usageBasis")
		? (captured.usageBasis as "measured" | "conservative-reservation")
		: "measured";
	const capability = Object.freeze({
		revision: "graphrefly.b112.d734.route-bound-provider-turn.v1" as const,
	});
	turnStates.set(capability, {
		turn: d725Turn,
		routeProfileDigest: profile.profileDigest,
		routeAdmissionDigest: routeAdmission.admissionDigest,
		actualRouteEvidenceDigest: routeEvidenceDigest,
		usageBasis,
	});
	return capability;
}

export function readD734RouteBoundProviderTurn(
	value: D734RouteBoundProviderTurnV1,
): D734RouteBoundProviderTurnSnapshotV1 {
	const state = turnStates.get(value);
	if (state === undefined) throw new TypeError("D734 route-bound provider turn is invalid");
	return Object.freeze({ ...state });
}

export function createD734RouteBoundProviderAdapter(inputValue: {
	readonly routeAdmission: D733GraphNativeRouteAdmissionV1;
	readonly executionClass?: "injected-no-network" | "live-provider";
	readonly materialization: EffectPort;
	readonly providerRequest: RouteProviderPort;
	readonly retryWait: EffectPort;
	readonly toolAction: EffectPort;
	readonly hiddenVerifier: EffectPort;
	readonly cleanup: EffectPort;
}): D734RouteBoundProviderAdapterV1 {
	const input = record(inputValue, "d734.adapter");
	exactKeys(
		input,
		[
			"cleanup",
			...(Object.hasOwn(input, "executionClass") ? ["executionClass" as const] : []),
			"hiddenVerifier",
			"materialization",
			"providerRequest",
			"retryWait",
			"routeAdmission",
			"toolAction",
		],
		"d734.adapter",
	);
	const profile = readD733AdmittedRouteProfile(input.routeAdmission);
	for (const key of [
		"cleanup",
		"hiddenVerifier",
		"materialization",
		"providerRequest",
		"retryWait",
		"toolAction",
	] as const)
		if (typeof input[key] !== "function") throw new TypeError(`D734 ${key} port is invalid`);
	const authority = createRouteAuthority();
	const executionClass = Object.hasOwn(input, "executionClass")
		? input.executionClass
		: "injected-no-network";
	if (executionClass !== "injected-no-network" && executionClass !== "live-provider")
		throw new TypeError("D734 adapter execution class is invalid");
	const adapter = createD726ProviderAdapter({
		executionClass,
		materialization: input.materialization as EffectPort,
		retryWait: input.retryWait as EffectPort,
		toolAction: input.toolAction as EffectPort,
		hiddenVerifier: input.hiddenVerifier as EffectPort,
		cleanup: input.cleanup as EffectPort,
		async providerRequest(executionInput): Promise<D726ProviderTurnV1> {
			const capability = await Reflect.apply(
				input.providerRequest as RouteProviderPort,
				undefined,
				[executionInput],
			);
			const turn = turnStates.get(capability);
			if (turn === undefined)
				throw new TypeError("D734 route-bound provider turn is invalid or reused");
			turnStates.delete(capability);
			literal(turn.routeProfileDigest, profile.profileDigest, "d734.turn.profileDigest");
			literal(
				turn.routeAdmissionDigest,
				(input.routeAdmission as D733GraphNativeRouteAdmissionV1).admissionDigest,
				"d734.turn.routeAdmissionDigest",
			);
			const terminal = turn.turn.result.status === "terminal-failure";
			const graphResult = terminal
				? validateD720GraphEffectResult(
						{
							...turn.turn.result,
							failureProvenance: "http-terminal",
							executorFailureClassification: null,
						},
						executionInput.effectRequest,
					)
				: validateD720GraphEffectResult(turn.turn.result, executionInput.effectRequest);
			admitRouteBinding(authority, {
				effectRequestDigest: executionInput.effectRequest.requestDigest,
				effectAdmissionDigest: executionInput.admission.decisionDigest,
				providerResultDigest: empiricalStrictJsonDigest(graphResult),
				routeProfileDigest: turn.routeProfileDigest,
				routeAdmissionDigest: turn.routeAdmissionDigest,
				actualRouteEvidenceDigest: turn.actualRouteEvidenceDigest,
			});
			return createD726ProviderTurn(turn.turn, turn.usageBasis);
		},
	});
	const capability = Object.freeze({
		revision: "graphrefly.b112.d734.route-bound-provider-adapter.v1" as const,
	});
	adapterStates.set(capability, {
		adapter,
		authority,
		profileDigest: profile.profileDigest,
		routeAdmissionDigest: (input.routeAdmission as D733GraphNativeRouteAdmissionV1).admissionDigest,
		consumed: false,
	});
	return capability;
}

function validateBijection(
	routeEvidence: D734RouteGraphEvidenceV1,
	graphEvidence: Awaited<ReturnType<typeof runD726InjectedNoNetworkQualification>>["graphEvidence"],
): void {
	const providerFacts = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.failureProvenance !== "executor-failure"
				? [fact]
				: [],
		),
	);
	if (providerFacts.length !== routeEvidence.facts.length)
		throw new TypeError("D734 provider result and route fact coverage drifted");
	for (const providerFact of providerFacts) {
		const matches = routeEvidence.facts.filter(
			(fact) =>
				fact.effectRequestDigest === providerFact.request.requestDigest &&
				fact.effectAdmissionDigest === providerFact.admissionDigest &&
				fact.providerResultDigest === providerFact.resultDigest,
		);
		if (matches.length !== 1) throw new TypeError("D734 route fact does not bind one Graph result");
	}
}

export async function runD734RouteProfileSixArmIntegration(inputValue: {
	readonly sourceDigest: string;
	readonly adapter: D734RouteBoundProviderAdapterV1;
	readonly signal: AbortSignal;
}) {
	const input = record(inputValue, "d734.run");
	exactKeys(input, ["adapter", "signal", "sourceDigest"], "d734.run");
	const sourceDigest = digest(input.sourceDigest, "d734.run.sourceDigest");
	if (!(input.signal instanceof AbortSignal)) throw new TypeError("D734 signal is invalid");
	const state = adapterStates.get(input.adapter as D734RouteBoundProviderAdapterV1);
	if (state === undefined || state.consumed)
		throw new TypeError("D734 adapter is invalid or consumed");
	state.consumed = true;
	const run = await runD726InjectedNoNetworkQualification({
		sourceDigest,
		adapter: state.adapter,
		signal: input.signal,
	});
	const routeEvidence = validateD734RouteGraphEvidence(snapshotRouteEvidence(state.authority));
	validateBijection(routeEvidence, run.graphEvidence);
	for (const fact of routeEvidence.facts) {
		literal(fact.routeProfileDigest, state.profileDigest, "d734.routeFact.profileDigest");
		literal(
			fact.routeAdmissionDigest,
			state.routeAdmissionDigest,
			"d734.routeFact.routeAdmissionDigest",
		);
	}
	if (run.graphEvidence.ledger.completedArms.length !== 6)
		throw new TypeError("D734 integration did not complete all six Graph arms");
	return Object.freeze({ run, routeEvidence });
}

export async function runD734RouteProfileSixArmLiveIntegration(inputValue: {
	readonly sourceDigest: string;
	readonly adapter: D734RouteBoundProviderAdapterV1;
	readonly signal: AbortSignal;
}) {
	const input = record(inputValue, "d734.liveRun");
	exactKeys(input, ["adapter", "signal", "sourceDigest"], "d734.liveRun");
	const sourceDigest = digest(input.sourceDigest, "d734.liveRun.sourceDigest");
	if (!(input.signal instanceof AbortSignal)) throw new TypeError("D734 live signal is invalid");
	const state = adapterStates.get(input.adapter as D734RouteBoundProviderAdapterV1);
	if (state === undefined || state.consumed)
		throw new TypeError("D734 live adapter is invalid or consumed");
	state.consumed = true;
	const run = await runD726GraphProviderBlockCore({
		sourceDigest,
		budgetLimits: D729_BUDGET_LIMITS,
		effectCeilings: D729_EFFECT_CEILINGS,
		adapter: state.adapter,
		executionClass: "live-provider",
		signal: input.signal as AbortSignal,
	});
	const routeEvidence = validateD734RouteGraphEvidence(snapshotRouteEvidence(state.authority));
	validateBijection(routeEvidence, run.graphEvidence);
	for (const fact of routeEvidence.facts) {
		literal(fact.routeProfileDigest, state.profileDigest, "d734.live.routeFact.profileDigest");
		literal(
			fact.routeAdmissionDigest,
			state.routeAdmissionDigest,
			"d734.live.routeFact.routeAdmissionDigest",
		);
	}
	return Object.freeze({ run, routeEvidence });
}
