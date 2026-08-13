import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import type { StrictJsonValue } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type { D719CleanBudgetLimitsV1, D719EffectAdmissionV1 } from "./d719-clean-graph-ledger.js";
import { invokeD734RouteBoundOpenRouterTurn } from "./d734-route-profile-provider-integration.js";
import { createD756GraphNamedToolTransport } from "./d756-graph-named-tool-continuation.js";
import type { D720GraphEffectRequestV1 } from "./d767-graph-native-effect-runtime.js";
import { D761_CRITERION_FAILURE_CONTEXT_SCHEMA } from "./d767-graph-native-effect-runtime.js";
import type { D771CanonicalGraphEvidenceV1 } from "./d771-graph-completion-memory-insight.js";
import type {
	OpenRouterResponsesByteTransportV1,
	OpenRouterResponsesTransportRequestV1,
} from "./openrouter-responses-model-turn.js";

export const D773_LIVE_ROUTE_REVISION = "graphrefly.b112.d773.live-route-directive.v1" as const;
export const D773_ROUTE_FACT_SCHEMA = "graphrefly.b112.d773.live-route-fact.v1" as const;
export const D773_ROUTE_EVIDENCE_SCHEMA = "graphrefly.b112.d773.live-route-evidence.v1" as const;

const ARMS = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_BODY_BYTES = 1_048_576;

export interface D773LiveRouteDirectiveV1 {
	readonly revision: typeof D773_LIVE_ROUTE_REVISION;
	readonly arm: (typeof ARMS)[number];
	readonly requestDigest: string;
	readonly admissionDigest: string;
	readonly contextAdmissionDigest: string;
	readonly contextDigest: string;
	readonly taskStatementDigest: string;
	readonly conversationDigest: string;
	readonly expectedMessagesDigest: string;
	readonly directiveDigest: string;
}

export interface D773LiveRouteProposalV1 {
	readonly revision: "graphrefly.b112.d773.live-route-proposal.v1";
	readonly arm: (typeof ARMS)[number];
	readonly requestDigest: string;
	readonly logicalRequestDigest: string;
	readonly attemptOrdinal: number;
	readonly contextDigest: string;
	readonly contextAdmissionDigest: string;
	readonly directiveDigest: string;
	readonly taskStatementDigest: string;
	readonly conversationDigest: string;
	readonly modelVisibleMessagesDigest: string;
	readonly loweredBodyDigest: string;
	readonly requiredToolName: "replace_exact" | null;
	readonly proposalDigest: string;
}

export interface D773LiveRouteFactV1 extends Omit<D773LiveRouteProposalV1, "proposalDigest"> {
	readonly schemaVersion: typeof D773_ROUTE_FACT_SCHEMA;
	readonly runSequence: number;
	readonly effectSequence: number;
	readonly graphEvidenceDigest: string;
	readonly admissionDigest: string;
	readonly resultDigest: string;
	readonly reconciliationDigest: string;
	readonly factDigest: string;
}

export interface D773LiveRouteEvidenceV1 {
	readonly schemaVersion: typeof D773_ROUTE_EVIDENCE_SCHEMA;
	readonly facts: readonly D773LiveRouteFactV1[];
	readonly providerResultCount: number;
	readonly coverageComplete: boolean;
	readonly evidenceDigest: string;
}

export interface D773LiveRouteAuthorityV1 {
	readonly revision: "graphrefly.b112.d773.live-route-authority.v1";
}

interface DirectiveState {
	readonly request: D720GraphEffectRequestV1;
	readonly admission: D719EffectAdmissionV1;
}

interface AuthorityState {
	readonly proposalNode: ReturnType<typeof graph>["node"] extends (...args: infer _A) => infer _R
		? any
		: never;
	readonly facts: D773LiveRouteFactV1[];
}

const directives = new WeakMap<object, DirectiveState>();
const proposals = new WeakSet<object>();
const pending = new WeakMap<object, D773LiveRouteProposalV1>();
const authorities = new WeakMap<object, AuthorityState>();

function ownRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
	const candidate = record(value, path);
	exactKeys(candidate, keys, path);
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
		if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined)
			throw new TypeError(`${path}.${key} must be an own data property`);
	}
	return candidate;
}

function contextDigest(request: D720GraphEffectRequestV1): string {
	return request.completionContext === undefined
		? request.logicalRequestDigest
		: digest(
				record(request.completionContext, "d773.context").contextDigest,
				"d773.context.digest",
			);
}

function expectedMessages(
	request: D720GraphEffectRequestV1,
	taskStatement: string,
	conversation: Readonly<{ readonly messages: readonly StrictJsonValue[] }>,
): readonly StrictJsonValue[] {
	const prior = array(conversation.messages, "d773.conversation.messages");
	if (prior.length > 128) throw new TypeError("D773 conversation bound exceeded");
	const messages: StrictJsonValue[] =
		prior.length === 0
			? [
					{
						role: "system",
						content:
							"You are the actor in a closed repository repair. Use only the supplied tools. Inspect first, make the smallest exact change, inspect the diff, run focused validation, and only then return a short JSON object. Never invent tool results.",
					},
					{
						role: "user",
						content: JSON.stringify({
							task: taskStatement,
							graphRun: {
								runSequence: request.runSequence,
								issuedRequestDigest: request.issuedRequestDigest,
							},
						}),
					},
				]
			: [...(prior as readonly StrictJsonValue[])];
	if (request.completionContext !== undefined)
		messages.push({
			role: "user",
			content: JSON.stringify({ graphCompletionContext: request.completionContext }),
		});
	return strictSnapshot(messages);
}

export function createD773LiveRouteDirective(inputValue: {
	readonly arm: (typeof ARMS)[number];
	readonly effectRequest: D720GraphEffectRequestV1;
	readonly admission: D719EffectAdmissionV1;
	readonly contextAdmission?: D719EffectAdmissionV1;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly taskStatement: string;
	readonly conversation: Readonly<{ readonly messages: readonly StrictJsonValue[] }>;
}): D773LiveRouteDirectiveV1 {
	const input = ownRecord(
		inputValue,
		[
			"admission",
			"arm",
			"budgetLimits",
			...(Object.hasOwn(inputValue, "contextAdmission") ? ["contextAdmission" as const] : []),
			"conversation",
			"effectRequest",
			"taskStatement",
		],
		"d773.directive.input",
	);
	const request = input.effectRequest as D720GraphEffectRequestV1;
	if (request.effectKind !== "provider-request")
		throw new TypeError("D773 route requires provider effect");
	oneOf(input.arm, ARMS, "d773.directive.arm");
	if (
		typeof input.taskStatement !== "string" ||
		input.taskStatement.length < 1 ||
		input.taskStatement.length > 32_768
	)
		throw new TypeError("D773 task statement is outside the bound");
	const admission = ownRecord(
		input.admission,
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
		"d773.directive.admission",
	);
	if (admission.kind !== "effect-admission-decided" || admission.admitted !== true)
		throw new TypeError("D773 route requires Graph admission");
	const { decisionDigest, ...admissionMaterial } = admission;
	if (decisionDigest !== empiricalStrictJsonDigest(admissionMaterial))
		throw new TypeError("D773 admission digest drifted");
	const original = (input.contextAdmission ?? input.admission) as D719EffectAdmissionV1;
	const originalRecord = ownRecord(
		original,
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
		"d773.directive.contextAdmission",
	);
	const { decisionDigest: originalDigest, ...originalMaterial } = originalRecord;
	if (originalDigest !== empiricalStrictJsonDigest(originalMaterial))
		throw new TypeError("D773 context admission digest drifted");
	if (
		request.attemptOrdinal > 1 &&
		(input.contextAdmission === undefined || admission.retryAuthorized !== true)
	)
		throw new TypeError("D773 retry lacks original Graph admission");
	for (const key of ["maxCostMicrousd", "maxElapsedMs", "maxRequests", "maxRetryWaits"] as const)
		safeInteger(record(input.budgetLimits, "d773.budget")[key], `d773.budget.${key}`, {
			max: 1_000_000_000,
		});
	const conversation = input.conversation as Readonly<{
		readonly messages: readonly StrictJsonValue[];
	}>;
	const expected = expectedMessages(request, input.taskStatement as string, conversation);
	const material = strictSnapshot({
		revision: D773_LIVE_ROUTE_REVISION,
		arm: input.arm as (typeof ARMS)[number],
		requestDigest: request.requestDigest,
		admissionDigest: decisionDigest as string,
		contextAdmissionDigest: originalDigest as string,
		contextDigest: contextDigest(request),
		taskStatementDigest: empiricalStrictJsonDigest(input.taskStatement),
		conversationDigest: empiricalStrictJsonDigest(conversation),
		expectedMessagesDigest: empiricalStrictJsonDigest(expected),
	});
	const directive = Object.freeze({
		...material,
		directiveDigest: empiricalStrictJsonDigest(material),
	});
	directives.set(directive, { request, admission: input.admission as D719EffectAdmissionV1 });
	return directive;
}

function lowerCriterionBody(bytes: Uint8Array): Uint8Array {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_BODY_BYTES)
		throw new TypeError("D773 provider body is outside the bound");
	const body = ownRecord(
		JSON.parse(decoder.decode(bytes)),
		["messages", "model", "provider", "reasoning", "stream", "tool_choice", "tools"],
		"d773.body",
	);
	if (body.tool_choice !== "required")
		throw new TypeError("D773 criterion continuation must require tool");
	const tools = array(body.tools, "d773.body.tools");
	const replace = tools.filter((value) => {
		const tool = record(value, "d773.body.tool");
		const fn = record(tool.function, "d773.body.tool.function");
		return tool.type === "function" && fn.name === "replace_exact";
	});
	if (replace.length !== 1)
		throw new TypeError("D773 replace_exact tool is not uniquely available");
	const encoded = encoder.encode(
		JSON.stringify(
			strictSnapshot({
				...body,
				tool_choice: { type: "function", function: { name: "replace_exact" } },
			}),
		),
	);
	if (encoded.byteLength > MAX_BODY_BYTES) throw new TypeError("D773 lowered body exceeds bound");
	return encoded;
}

export async function invokeD773LiveRouteTurn(
	inputValue: Parameters<typeof invokeD734RouteBoundOpenRouterTurn>[0] & {
		readonly directive: D773LiveRouteDirectiveV1;
	},
): ReturnType<typeof invokeD734RouteBoundOpenRouterTurn> {
	const input = ownRecord(
		inputValue,
		[
			"conversation",
			"credential",
			"directive",
			"effectRequest",
			"monotonicNowMs",
			"routeAdmission",
			"signal",
			"taskStatement",
			"transport",
			...(Object.hasOwn(inputValue, "usageBasis") ? ["usageBasis" as const] : []),
		],
		"d773.invoke",
	);
	const directive = input.directive as D773LiveRouteDirectiveV1;
	const state = directives.get(directive);
	if (state === undefined || state.request !== input.effectRequest)
		throw new TypeError("D773 route directive is forged or replayed");
	directives.delete(directive);
	const request = input.effectRequest as D720GraphEffectRequestV1;
	const expected = expectedMessages(
		request,
		input.taskStatement as string,
		input.conversation as Readonly<{ readonly messages: readonly StrictJsonValue[] }>,
	);
	if (
		directive.taskStatementDigest !== empiricalStrictJsonDigest(input.taskStatement) ||
		directive.conversationDigest !== empiricalStrictJsonDigest(input.conversation) ||
		directive.expectedMessagesDigest !== empiricalStrictJsonDigest(expected)
	)
		throw new TypeError("D773 route input differs from Graph directive");
	const transport = ownRecord(input.transport, ["request"], "d773.transport");
	if (typeof transport.request !== "function") throw new TypeError("D773 transport is invalid");
	let calls = 0;
	const capture: OpenRouterResponsesByteTransportV1 = Object.freeze({
		async request(transportRequest: OpenRouterResponsesTransportRequestV1) {
			calls += 1;
			if (calls !== 1) throw new TypeError("D773 route issued more than one transport call");
			const body = record(JSON.parse(decoder.decode(transportRequest.body)), "d773.finalBody");
			const modelVisibleMessagesDigest = empiricalStrictJsonDigest(
				array(body.messages, "d773.finalBody.messages"),
			);
			if (modelVisibleMessagesDigest !== directive.expectedMessagesDigest)
				throw new TypeError("D773 model-visible messages differ from Graph directive");
			const response = (await Reflect.apply(
				transport.request as (...args: unknown[]) => unknown,
				input.transport,
				[transportRequest],
			)) as Awaited<ReturnType<OpenRouterResponsesByteTransportV1["request"]>>;
			const criterion =
				request.completionContext !== undefined &&
				record(request.completionContext, "d773.contextProbe").schemaVersion ===
					D761_CRITERION_FAILURE_CONTEXT_SCHEMA;
			const material = strictSnapshot({
				revision: "graphrefly.b112.d773.live-route-proposal.v1" as const,
				arm: directive.arm,
				requestDigest: request.requestDigest,
				logicalRequestDigest: request.logicalRequestDigest,
				attemptOrdinal: request.attemptOrdinal,
				contextDigest: directive.contextDigest,
				contextAdmissionDigest: directive.contextAdmissionDigest,
				directiveDigest: directive.directiveDigest,
				taskStatementDigest: directive.taskStatementDigest,
				conversationDigest: directive.conversationDigest,
				modelVisibleMessagesDigest,
				loweredBodyDigest: empiricalSha256(transportRequest.body),
				requiredToolName: criterion ? ("replace_exact" as const) : null,
			});
			const proposal = Object.freeze({
				...material,
				proposalDigest: empiricalStrictJsonDigest(material),
			});
			pending.set(request, proposal);
			proposals.add(proposal);
			return response;
		},
	});
	const criterion =
		request.completionContext !== undefined &&
		record(request.completionContext, "d773.contextSchema").schemaVersion ===
			D761_CRITERION_FAILURE_CONTEXT_SCHEMA;
	const { directive: _directive, ...base } = input;
	if (criterion) {
		return invokeD734RouteBoundOpenRouterTurn({
			...(base as unknown as Parameters<typeof invokeD734RouteBoundOpenRouterTurn>[0]),
			transport: Object.freeze({
				async request(value: OpenRouterResponsesTransportRequestV1) {
					return capture.request({ ...value, body: lowerCriterionBody(value.body) });
				},
			}),
		});
	}
	return invokeD734RouteBoundOpenRouterTurn({
		...(base as unknown as Parameters<typeof invokeD734RouteBoundOpenRouterTurn>[0]),
		transport: createD756GraphNamedToolTransport({
			effectRequest: request as never,
			transport: capture,
		}),
	});
}

export function takeD773LiveRouteProposal(
	request: D720GraphEffectRequestV1,
): D773LiveRouteProposalV1 | null {
	const proposal = pending.get(request);
	if (proposal === undefined) return null;
	pending.delete(request);
	return proposal;
}

function authorityState(authority: D773LiveRouteAuthorityV1): AuthorityState {
	const state = authorities.get(authority);
	if (state === undefined) throw new TypeError("D773 route authority is not Graph-constructed");
	return state;
}

export function createD773LiveRouteAuthority(): D773LiveRouteAuthorityV1 {
	const owner = graph({ name: "d773/live-route-authority" });
	const proposalNode = owner.node<unknown>([], null, { name: "d773/live-route-proposals" });
	const facts: D773LiveRouteFactV1[] = [];
	const admissionNode = owner.node<D773LiveRouteFactV1>(
		[proposalNode],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) ctx.down([["DATA", raw as D773LiveRouteFactV1]]);
		},
		{ name: "d773/live-route-admissions", factory: "d773LiveRouteAdmission" },
	);
	admissionNode.subscribe((message) => {
		if (message[0] !== "DATA") return;
		if (facts.length >= 128) throw new TypeError("D773 route fact bound exhausted");
		const fact = message[1] as D773LiveRouteFactV1;
		if (facts.some((candidate) => candidate.requestDigest === fact.requestDigest))
			throw new TypeError("D773 route fact replayed");
		facts.push(fact);
	});
	const authority = Object.freeze({
		revision: "graphrefly.b112.d773.live-route-authority.v1" as const,
	});
	authorities.set(authority, { proposalNode: proposalNode as never, facts });
	return authority;
}

export function admitD773LiveRouteProposal(
	authority: D773LiveRouteAuthorityV1,
	proposal: D773LiveRouteProposalV1,
	graphEvidence: D771CanonicalGraphEvidenceV1,
): D773LiveRouteFactV1 {
	if (!proposals.delete(proposal)) throw new TypeError("D773 route proposal is forged or replayed");
	const matches = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.request.effectKind === "provider-request" &&
			fact.request.requestDigest === proposal.requestDigest &&
			fact.request.logicalRequestDigest === proposal.logicalRequestDigest &&
			fact.request.attemptOrdinal === proposal.attemptOrdinal
				? [{ run, fact }]
				: [],
		),
	);
	if (matches.length !== 1) throw new TypeError("D773 route proposal lacks exact Graph result");
	const { run, fact } = matches[0]!;
	const admission = graphEvidence.ledger.effectAdmissions.filter(
		(value) => value.decisionDigest === fact.admissionDigest,
	);
	const reconciliation = graphEvidence.ledger.effectReconciliations.filter(
		(value) => value.admissionDigest === fact.admissionDigest,
	);
	if (admission.length !== 1 || reconciliation.length !== 1)
		throw new TypeError("D773 route proposal lacks exact admission/reconciliation");
	const originalAttempts = graphEvidence.effectRuns.flatMap((candidate) =>
		candidate.facts.flatMap((candidateFact) =>
			candidateFact.kind === "graph-effect-result-admitted" &&
			candidateFact.request.effectKind === "provider-request" &&
			candidateFact.request.logicalRequestDigest === proposal.logicalRequestDigest &&
			candidateFact.request.attemptOrdinal === 1
				? [candidateFact]
				: [],
		),
	);
	if (
		proposal.contextAdmissionDigest !==
		(proposal.attemptOrdinal === 1
			? fact.admissionDigest
			: originalAttempts.length === 1
				? originalAttempts[0]!.admissionDigest
				: null)
	)
		throw new TypeError("D773 retry context admission drifted");
	const material = strictSnapshot({
		schemaVersion: D773_ROUTE_FACT_SCHEMA,
		revision: proposal.revision,
		arm: proposal.arm,
		runSequence: run.runSequence,
		effectSequence: fact.request.effectSequence,
		requestDigest: proposal.requestDigest,
		logicalRequestDigest: proposal.logicalRequestDigest,
		attemptOrdinal: proposal.attemptOrdinal,
		contextDigest: proposal.contextDigest,
		contextAdmissionDigest: proposal.contextAdmissionDigest,
		directiveDigest: proposal.directiveDigest,
		taskStatementDigest: proposal.taskStatementDigest,
		conversationDigest: proposal.conversationDigest,
		modelVisibleMessagesDigest: proposal.modelVisibleMessagesDigest,
		loweredBodyDigest: proposal.loweredBodyDigest,
		requiredToolName: proposal.requiredToolName,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		admissionDigest: fact.admissionDigest,
		resultDigest: fact.resultDigest,
		reconciliationDigest: reconciliation[0]!.reconciliationDigest,
	});
	const candidate = Object.freeze({ ...material, factDigest: empiricalStrictJsonDigest(material) });
	const state = authorityState(authority);
	const before = state.facts.length;
	state.proposalNode.down([["DATA", candidate]]);
	if (state.facts.length !== before + 1) throw new TypeError("D773 Graph omitted route admission");
	return candidate;
}

export function snapshotD773LiveRouteEvidence(
	authority: D773LiveRouteAuthorityV1,
	graphEvidence: D771CanonicalGraphEvidenceV1,
): D773LiveRouteEvidenceV1 {
	const facts = authorityState(authority).facts;
	const providerResultCount = graphEvidence.effectRuns.reduce(
		(count, run) =>
			count +
			run.facts.filter(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.request.effectKind === "provider-request",
			).length,
		0,
	);
	const material = strictSnapshot({
		schemaVersion: D773_ROUTE_EVIDENCE_SCHEMA,
		facts,
		providerResultCount,
		coverageComplete: facts.length === providerResultCount,
	});
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

export function validateD773LiveRouteEvidence(
	value: unknown,
	graphEvidence: D771CanonicalGraphEvidenceV1,
): D773LiveRouteEvidenceV1 {
	const candidate = ownRecord(
		value,
		["coverageComplete", "evidenceDigest", "facts", "providerResultCount", "schemaVersion"],
		"d773.routeEvidence",
	);
	literal(candidate.schemaVersion, D773_ROUTE_EVIDENCE_SCHEMA, "d773.routeEvidence.schema");
	const rawFacts = array(candidate.facts, "d773.routeEvidence.facts");
	if (rawFacts.length > 128) throw new TypeError("D773 route fact bound exceeded");
	const facts = Object.freeze(
		rawFacts.map((raw, index) => {
			const fact = ownRecord(
				raw,
				[
					"admissionDigest",
					"arm",
					"attemptOrdinal",
					"contextAdmissionDigest",
					"contextDigest",
					"conversationDigest",
					"directiveDigest",
					"effectSequence",
					"factDigest",
					"graphEvidenceDigest",
					"logicalRequestDigest",
					"loweredBodyDigest",
					"modelVisibleMessagesDigest",
					"reconciliationDigest",
					"requestDigest",
					"requiredToolName",
					"resultDigest",
					"revision",
					"runSequence",
					"schemaVersion",
					"taskStatementDigest",
				],
				`d773.routeEvidence.facts[${index}]`,
			);
			literal(
				fact.schemaVersion,
				D773_ROUTE_FACT_SCHEMA,
				`d773.routeEvidence.facts[${index}].schema`,
			);
			for (const key of [
				"admissionDigest",
				"contextAdmissionDigest",
				"contextDigest",
				"conversationDigest",
				"directiveDigest",
				"factDigest",
				"graphEvidenceDigest",
				"logicalRequestDigest",
				"loweredBodyDigest",
				"modelVisibleMessagesDigest",
				"reconciliationDigest",
				"requestDigest",
				"resultDigest",
				"taskStatementDigest",
			] as const)
				digest(fact[key], `d773.routeEvidence.facts[${index}].${key}`);
			const { factDigest, ...material } = fact;
			literal(
				factDigest,
				empiricalStrictJsonDigest(material),
				`d773.routeEvidence.facts[${index}].digest`,
			);
			const matches = graphEvidence.effectRuns.flatMap((run) =>
				run.facts.flatMap((graphFact) =>
					graphFact.kind === "graph-effect-result-admitted" &&
					graphFact.request.requestDigest === fact.requestDigest &&
					graphFact.admissionDigest === fact.admissionDigest &&
					graphFact.resultDigest === fact.resultDigest
						? [{ run, graphFact }]
						: [],
				),
			);
			if (matches.length !== 1) throw new TypeError("D773 route fact is not Graph-bound");
			const reconciliation = graphEvidence.ledger.effectReconciliations.filter(
				(item) => item.admissionDigest === fact.admissionDigest,
			);
			if (
				fact.graphEvidenceDigest !== graphEvidence.evidenceDigest ||
				fact.runSequence !== matches[0]!.run.runSequence ||
				fact.effectSequence !== matches[0]!.graphFact.request.effectSequence ||
				reconciliation.length !== 1 ||
				fact.reconciliationDigest !== reconciliation[0]!.reconciliationDigest
			)
				throw new TypeError("D773 route fact Graph coordinates drifted");
			return strictSnapshot(fact) as unknown as D773LiveRouteFactV1;
		}),
	);
	if (new Set(facts.map((fact) => fact.requestDigest)).size !== facts.length)
		throw new TypeError("D773 route fact replayed");
	const providerResultCount = graphEvidence.effectRuns.reduce(
		(count, run) =>
			count +
			run.facts.filter(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.request.effectKind === "provider-request",
			).length,
		0,
	);
	literal(candidate.providerResultCount, providerResultCount, "d773.routeEvidence.providerCount");
	literal(
		candidate.coverageComplete,
		facts.length === providerResultCount,
		"d773.routeEvidence.coverage",
	);
	const material = strictSnapshot({
		schemaVersion: D773_ROUTE_EVIDENCE_SCHEMA,
		facts,
		providerResultCount,
		coverageComplete: facts.length === providerResultCount,
	});
	literal(
		candidate.evidenceDigest,
		empiricalStrictJsonDigest(material),
		"d773.routeEvidence.digest",
	);
	return Object.freeze({ ...material, evidenceDigest: candidate.evidenceDigest as string });
}
