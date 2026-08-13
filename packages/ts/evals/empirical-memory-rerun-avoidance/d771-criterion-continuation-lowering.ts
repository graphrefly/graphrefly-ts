import type { StrictJsonValue } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type { D719CleanBudgetLimitsV1, D719EffectAdmissionV1 } from "./d719-clean-graph-ledger.js";
import { invokeD734RouteBoundOpenRouterTurn } from "./d734-route-profile-provider-integration.js";
import {
	createD756GraphNamedToolTransport,
	deriveD756GraphToolDirective,
} from "./d756-graph-named-tool-continuation.js";
import type {
	D720GraphEffectRequestV1,
	D720ToolRef,
	D761PublicCriterionFailureCodeV1,
} from "./d767-graph-native-effect-runtime.js";
import { D761_CRITERION_FAILURE_CONTEXT_SCHEMA } from "./d767-graph-native-effect-runtime.js";
import {
	createD720SimulatedCallerExecutor,
	type D720CallerEffectExecutionInputV2,
	type D720CallerEffectExecutionV2,
	type D720CallerExecutorV2,
} from "./d767-graph-native-eval.js";
import { deriveD771ModelExposure } from "./d771-arm-aware-positive-gate.js";
import type {
	OpenRouterResponsesByteTransportV1,
	OpenRouterResponsesTransportRequestV1,
} from "./openrouter-responses-model-turn.js";

export const D771_CRITERION_NAMED_TOOL_LOWERING_REVISION =
	"graphrefly.b112.d771.criterion-named-tool-lowering.v1" as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_BODY_BYTES = 1_048_576;
const TOOL_NAMES = Object.freeze({
	"read-file": "read_file",
	"search-repository": "search_repository",
	"replace-exact": "replace_exact",
	"workspace-diff": "workspace_diff",
	"focused-validation": "focused_validation",
} satisfies Record<D720ToolRef, string>);
const FAILURE_CODES = Object.freeze([
	"canonical-provenance-not-admitted",
	"malformed-provenance-not-rejected",
	"local-reconstruction-not-rejected",
	"authorization-invariant-regressed",
] satisfies readonly D761PublicCriterionFailureCodeV1[]);
const D771_ARMS = Object.freeze([
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const);
const pendingLoweringProposals = new WeakMap<object, D771CriterionLoweringProposalV1>();
const constructedLoweringProposals = new WeakSet<object>();
const constructedRouteDirectives = new WeakMap<
	object,
	{
		readonly request: D720GraphEffectRequestV1;
		readonly admission: D719EffectAdmissionV1;
	}
>();

export interface D771CriterionLoweringProposalV1 {
	readonly revision: "graphrefly.b112.d771.criterion-lowering-proposal.v1";
	readonly requestDigest: string;
	readonly logicalRequestDigest: string;
	readonly attemptOrdinal: number;
	readonly contextDigest: string;
	readonly contextAdmissionDigest: string | null;
	readonly graphDirectiveDigest: string | null;
	readonly loweredBodyDigest: string;
	readonly requiredToolName: "replace_exact" | null;
	readonly conversationDigest: string;
	readonly modelVisibleMessagesDigest: string;
	readonly exposureEvidenceDigest: string;
	readonly proposalDigest: string;
}

export interface D771CriterionToolDirectiveV1 {
	readonly revision: typeof D771_CRITERION_NAMED_TOOL_LOWERING_REVISION;
	readonly contextDigest: string;
	readonly criterionFailures: readonly D761PublicCriterionFailureCodeV1[];
	readonly requiredToolRef: "replace-exact" | null;
	readonly directiveDigest: string;
}

export interface D771CriterionRouteDirectiveV1 {
	readonly revision: "graphrefly.b112.d771.graph-criterion-route-directive.v1";
	readonly requestDigest: string;
	readonly admissionDigest: string;
	readonly contextAdmissionDigest: string;
	readonly contextDigest: string;
	readonly conversationDigest: string;
	readonly modelVisibleMessagesDigest: string;
	readonly exposureEvidenceDigest: string;
	readonly directiveDigest: string;
}

function ownRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		(Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
		Object.getOwnPropertySymbols(value).length !== 0
	)
		throw new TypeError(`${path} must be an exact own-data record`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const actual = Object.keys(descriptors).sort();
	const expected = [...keys].sort();
	if (
		actual.length !== expected.length ||
		actual.some((key, index) => key !== expected[index]) ||
		Object.values(descriptors).some(
			(descriptor) => !descriptor.enumerable || !("value" in descriptor),
		)
	)
		throw new TypeError(`${path} must be an exact own-data record`);
	return Object.fromEntries(
		keys.map((key) => [key, (descriptors[key] as PropertyDescriptor & { value: unknown }).value]),
	);
}

function ownDenseArray(value: unknown, path: string, max: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
		throw new TypeError(`${path} must be a dense array`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (
		value.length > max ||
		Object.getOwnPropertySymbols(value).length !== 0 ||
		Object.keys(descriptors).some(
			(key) => key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length),
		)
	)
		throw new TypeError(`${path} must be a bounded dense array`);
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = descriptors[String(index)];
		if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
			throw new TypeError(`${path} must be a bounded dense array`);
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}

function validateCriterionContext(value: unknown): Readonly<Record<string, unknown>> {
	const probe = ownRecord(
		value,
		Object.keys(Object.getOwnPropertyDescriptors(value as object)),
		"d771.completionContextProbe",
	);
	const hasCriterionFailures = Object.hasOwn(probe, "criterionFailures");
	const context = ownRecord(
		value,
		[
			"budgetProjectionDigest",
			"contextDigest",
			...(hasCriterionFailures ? ["criterionFailures" as const] : []),
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
		"d771.completionContext",
	);
	const criterionFailure =
		context.reason === "public-semantic-validation-failed" &&
		context.nextRequiredPhase === "exact-mutation" &&
		context.requiredDisposition === "tool-intents" &&
		hasCriterionFailures;
	const forwardToVerifier =
		context.reason === "objective-phase-advanced" &&
		context.nextRequiredPhase === "hidden-verifier" &&
		context.requiredDisposition === "structured-final" &&
		!hasCriterionFailures;
	if (
		context.schemaVersion !== D761_CRITERION_FAILURE_CONTEXT_SCHEMA ||
		(!criterionFailure && !forwardToVerifier)
	)
		throw new TypeError("D771 criterion continuation coordinates drifted");
	for (const key of [
		"budgetProjectionDigest",
		"contextDigest",
		"issuedRequestDigest",
		"rejectedRequestDigest",
		"workspaceStateDigest",
	] as const)
		digest(context[key], `d771.completionContext.${key}`);
	const failures = hasCriterionFailures
		? ownDenseArray(context.criterionFailures, "d771.criterionFailures", 4)
		: Object.freeze([]);
	if (criterionFailure && (failures.length < 1 || new Set(failures).size !== failures.length))
		throw new TypeError("D771 criterion failures must be non-empty and unique");
	for (const failure of failures) oneOf(failure, FAILURE_CODES, "d771.criterionFailure");
	const missing = ownDenseArray(context.missingObjectivePhases, "d771.missingObjectivePhases", 4);
	if (
		missing.join(",") !==
		(criterionFailure ? "exact-mutation,workspace-diff,focused-validation" : "")
	)
		throw new TypeError("D771 missing objective phases drifted");
	const refs = ownDenseArray(context.evidenceFreshnessRefs, "d771.evidenceFreshnessRefs", 2);
	if (refs.length !== 2) throw new TypeError("D771 freshness coverage drifted");
	for (const ref of refs) digest(ref, "d771.evidenceFreshnessRef");
	const remaining = ownRecord(
		context.remainingAdmittedBounds,
		["costMicrousd", "elapsedMs", "requests", "retryWaits"],
		"d771.remainingAdmittedBounds",
	);
	for (const key of ["costMicrousd", "elapsedMs", "requests", "retryWaits"] as const)
		safeInteger(remaining[key], `d771.remainingAdmittedBounds.${key}`, { max: 1_000_000_000 });
	for (const key of ["remainingCompletionContexts", "remainingEffectFacts", "runSequence"] as const)
		safeInteger(context[key], `d771.completionContext.${key}`, { max: 512 });
	const { contextDigest, ...material } = context;
	if (contextDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D771 criterion continuation digest drifted");
	return Object.freeze({
		...context,
		criterionFailures: failures,
		missingObjectivePhases: missing,
	});
}

function budgetState(value: unknown, path: string) {
	const state = ownRecord(value, ["costMicrousd", "elapsedMs", "requests", "retryWaits"], path);
	for (const key of ["costMicrousd", "elapsedMs", "requests", "retryWaits"] as const)
		safeInteger(state[key], `${path}.${key}`, { max: 1_000_000_000 });
	return state as Readonly<
		Record<"costMicrousd" | "elapsedMs" | "requests" | "retryWaits", number>
	>;
}

function createD771GraphCriterionRouteDirective(inputValue: {
	readonly effectRequest: D720GraphEffectRequestV1;
	readonly admission: D719EffectAdmissionV1;
	readonly contextAdmission?: D719EffectAdmissionV1;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly arm:
		| "cold"
		| "relevant-applied"
		| "proposal-only"
		| "admission-rejected"
		| "irrelevant-applied"
		| "wrong-scope-applied";
}): D771CriterionRouteDirectiveV1 | null {
	const input = ownRecord(
		inputValue,
		[
			"admission",
			"arm",
			"budgetLimits",
			...(Object.hasOwn(inputValue, "contextAdmission") ? ["contextAdmission" as const] : []),
			"effectRequest",
		],
		"d771.graphDirectiveInput",
	);
	const request = input.effectRequest as D720GraphEffectRequestV1;
	const toolDirective = deriveD771CriterionToolDirective(request);
	const exposure = deriveD771ModelExposure(input.arm as never, request);
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
		"d771.graphAdmission",
	);
	if (admission.kind !== "effect-admission-decided" || admission.admitted !== true)
		throw new TypeError("D771 criterion route requires an admitted Graph effect");
	const { decisionDigest, ...admissionMaterial } = admission;
	digest(decisionDigest, "d771.graphAdmission.decisionDigest");
	if (decisionDigest !== empiricalStrictJsonDigest(admissionMaterial))
		throw new TypeError("D771 Graph admission digest drifted");
	const contextAdmission = ownRecord(
		input.contextAdmission ?? input.admission,
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
		"d771.contextAdmission",
	);
	const { decisionDigest: contextAdmissionDigest, ...contextAdmissionMaterial } = contextAdmission;
	if (
		contextAdmission.kind !== "effect-admission-decided" ||
		contextAdmission.admitted !== true ||
		contextAdmissionDigest !== empiricalStrictJsonDigest(contextAdmissionMaterial)
	)
		throw new TypeError("D771 context admission provenance drifted");
	if (
		request.attemptOrdinal > 1 &&
		(input.contextAdmission === undefined ||
			admission.retryAuthorized !== true ||
			admission.arm !== contextAdmission.arm ||
			admission.runKind !== contextAdmission.runKind)
	)
		throw new TypeError("D771 criterion retry lacks its original Graph context admission");
	const before = budgetState(
		contextAdmission.budgetStateBefore,
		"d771.contextAdmission.budgetBefore",
	);
	const reserved = budgetState(
		contextAdmission.budgetStateIfReserved,
		"d771.contextAdmission.budgetReserved",
	);
	const limits = ownRecord(
		input.budgetLimits,
		["maxCostMicrousd", "maxElapsedMs", "maxRequests", "maxRetryWaits"],
		"d771.graphBudgetLimits",
	);
	for (const key of ["maxCostMicrousd", "maxElapsedMs", "maxRequests", "maxRetryWaits"] as const)
		safeInteger(limits[key], `d771.graphBudgetLimits.${key}`, { max: 1_000_000_000 });
	const context =
		toolDirective === null ? null : validateCriterionContext(request.completionContext);
	if (context === null) {
		const genericContextDigest =
			request.completionContext === undefined
				? request.logicalRequestDigest
				: record(request.completionContext, "d771.genericCompletionContext").contextDigest;
		digest(genericContextDigest, "d771.genericCompletionContext.contextDigest");
		const material = strictSnapshot({
			revision: "graphrefly.b112.d771.graph-criterion-route-directive.v1" as const,
			requestDigest: request.requestDigest,
			admissionDigest: decisionDigest as string,
			contextAdmissionDigest: contextAdmissionDigest as string,
			contextDigest: genericContextDigest as string,
			conversationDigest: exposure.conversationDigest,
			modelVisibleMessagesDigest: exposure.modelVisibleMessagesDigest,
			exposureEvidenceDigest: exposure.evidenceDigest,
		});
		const directive = Object.freeze({
			...material,
			directiveDigest: empiricalStrictJsonDigest(material),
		});
		constructedRouteDirectives.set(directive, {
			request,
			admission: input.admission as D719EffectAdmissionV1,
		});
		return directive;
	}
	const remaining = context.remainingAdmittedBounds as Record<string, number>;
	const expectedRemaining = {
		requests: Math.max(0, (limits.maxRequests as number) - reserved.requests),
		retryWaits: Math.max(0, (limits.maxRetryWaits as number) - reserved.retryWaits),
		costMicrousd: Math.max(0, (limits.maxCostMicrousd as number) - reserved.costMicrousd),
		elapsedMs: Math.max(0, (limits.maxElapsedMs as number) - reserved.elapsedMs),
	};
	if (empiricalStrictJsonDigest(remaining) !== empiricalStrictJsonDigest(expectedRemaining))
		throw new TypeError("D771 completion context is not bound to Graph budget admission");
	const expectedBudgetProjectionDigest = empiricalStrictJsonDigest({
		budgetStateBeforeContinuation: before,
		providerReservation: {
			maxCostMicrousd: reserved.costMicrousd - before.costMicrousd,
			maxElapsedMs: reserved.elapsedMs - before.elapsedMs,
		},
		remainingAdmittedBounds: expectedRemaining,
	});
	if (context.budgetProjectionDigest !== expectedBudgetProjectionDigest)
		throw new TypeError("D771 Graph budget projection digest drifted");
	const material = strictSnapshot({
		revision: "graphrefly.b112.d771.graph-criterion-route-directive.v1" as const,
		requestDigest: request.requestDigest,
		admissionDigest: decisionDigest as string,
		contextAdmissionDigest: contextAdmissionDigest as string,
		contextDigest: context.contextDigest as string,
		conversationDigest: exposure.conversationDigest,
		modelVisibleMessagesDigest: exposure.modelVisibleMessagesDigest,
		exposureEvidenceDigest: exposure.evidenceDigest,
	});
	const directive = Object.freeze({
		...material,
		directiveDigest: empiricalStrictJsonDigest(material),
	});
	constructedRouteDirectives.set(directive, {
		request,
		admission: input.admission as D719EffectAdmissionV1,
	});
	return directive;
}

export function createD771GraphAdmittedCallerExecutor(inputValue: {
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly execute: (
		input: D720CallerEffectExecutionInputV2 & {
			readonly criterionRouteDirective: D771CriterionRouteDirectiveV1 | null;
		},
	) => Promise<D720CallerEffectExecutionV2>;
}): D720CallerExecutorV2 {
	const input = ownRecord(inputValue, ["budgetLimits", "execute"], "d771.graphExecutor");
	if (typeof input.execute !== "function") throw new TypeError("D771 Graph executor is invalid");
	const limits = strictSnapshot(input.budgetLimits) as D719CleanBudgetLimitsV1;
	const originalContextAdmissions = new Map<string, D719EffectAdmissionV1>();
	return createD720SimulatedCallerExecutor(async (executionInput) => {
		const arm = executionInput.request.input?.value?.arm;
		oneOf(arm, D771_ARMS, "d771.graphExecutor.arm");
		const originalContextAdmission = originalContextAdmissions.get(
			executionInput.effectRequest.logicalRequestDigest,
		);
		const criterionRouteDirective =
			executionInput.effectRequest.effectKind === "provider-request"
				? createD771GraphCriterionRouteDirective({
						arm: arm as (typeof D771_ARMS)[number],
						effectRequest: executionInput.effectRequest,
						admission: executionInput.admission,
						budgetLimits: limits,
						...(executionInput.effectRequest.attemptOrdinal > 1 &&
						originalContextAdmission !== undefined
							? { contextAdmission: originalContextAdmission }
							: {}),
					})
				: null;
		if (criterionRouteDirective !== null && executionInput.effectRequest.attemptOrdinal === 1)
			originalContextAdmissions.set(
				executionInput.effectRequest.logicalRequestDigest,
				executionInput.admission,
			);
		return Reflect.apply(
			input.execute as (value: unknown) => Promise<D720CallerEffectExecutionV2>,
			undefined,
			[Object.freeze({ ...executionInput, criterionRouteDirective })],
		);
	});
}

export function deriveD771CriterionToolDirective(
	requestValue: D720GraphEffectRequestV1,
): D771CriterionToolDirectiveV1 | null {
	const request = ownRecord(
		requestValue,
		[
			"attemptOrdinal",
			...(Object.hasOwn(requestValue, "completionContext") ? ["completionContext" as const] : []),
			"effectKind",
			"effectSequence",
			"issuedRequestDigest",
			"kind",
			"logicalRequestDigest",
			"phaseBefore",
			"requestDigest",
			"retryAfterMs",
			"retryReason",
			"runSequence",
			"toolIntent",
			"workspaceStateDigest",
		],
		"d771.effectRequest",
	);
	if (request.effectKind !== "provider-request")
		throw new TypeError("D771 named-tool lowering requires a provider effect");
	const { requestDigest, ...requestMaterial } = request;
	digest(requestDigest, "d771.effectRequest.requestDigest");
	if (requestDigest !== empiricalStrictJsonDigest(requestMaterial))
		throw new TypeError("D771 Graph effect request digest drifted");
	if (!Object.hasOwn(request, "completionContext")) return null;
	const contextRecord = record(request.completionContext, "d771.completionContextProbe");
	if (contextRecord.schemaVersion !== D761_CRITERION_FAILURE_CONTEXT_SCHEMA) {
		deriveD756GraphToolDirective(requestValue as never);
		return null;
	}
	const context = validateCriterionContext(request.completionContext);
	if (
		context.runSequence !== request.runSequence ||
		context.issuedRequestDigest !== request.issuedRequestDigest ||
		request.workspaceStateDigest === null ||
		context.workspaceStateDigest !== request.workspaceStateDigest
	)
		throw new TypeError("D771 criterion continuation is not bound to its Graph request");
	const material = strictSnapshot({
		revision: D771_CRITERION_NAMED_TOOL_LOWERING_REVISION,
		contextDigest: context.contextDigest as string,
		criterionFailures: context.criterionFailures as readonly D761PublicCriterionFailureCodeV1[],
		requiredToolRef:
			context.reason === "public-semantic-validation-failed" ? ("replace-exact" as const) : null,
	});
	return Object.freeze({ ...material, directiveDigest: empiricalStrictJsonDigest(material) });
}

function lowerCriterionChatBody(
	bytes: Uint8Array,
	directive: D771CriterionToolDirectiveV1,
): Uint8Array {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_BODY_BYTES)
		throw new TypeError("D771 Chat body is outside the bound");
	let decoded: unknown;
	try {
		decoded = JSON.parse(decoder.decode(bytes));
	} catch (error) {
		throw new TypeError("D771 Chat body is not UTF-8 JSON", { cause: error });
	}
	const body = ownRecord(
		decoded,
		["messages", "model", "provider", "reasoning", "stream", "tool_choice", "tools"],
		"d771.chatBody",
	);
	if (body.tool_choice !== "required")
		throw new TypeError("D771 criterion continuation must require a tool disposition");
	const tools = array(body.tools, "d771.chatBody.tools");
	const requiredName =
		directive.requiredToolRef === null ? null : TOOL_NAMES[directive.requiredToolRef];
	if (requiredName !== null) {
		const matches = tools.filter((entry, index) => {
			const tool = record(entry, `d771.chatBody.tools[${index}]`);
			const fn = record(tool.function, `d771.chatBody.tools[${index}].function`);
			return tool.type === "function" && fn.name === requiredName;
		});
		if (matches.length !== 1)
			throw new TypeError("D771 required named tool is not uniquely available");
	}
	const lowered = strictSnapshot({
		...body,
		tool_choice:
			requiredName === null ? "none" : { type: "function", function: { name: requiredName } },
	}) as StrictJsonValue;
	const encoded = encoder.encode(JSON.stringify(lowered));
	if (encoded.byteLength > MAX_BODY_BYTES)
		throw new TypeError("D771 lowered Chat body exceeds bound");
	return encoded;
}

function createD771CriterionNamedToolTransport(inputValue: {
	readonly effectRequest: D720GraphEffectRequestV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly graphDirective: D771CriterionRouteDirectiveV1;
}): OpenRouterResponsesByteTransportV1 {
	const input = ownRecord(
		inputValue,
		["effectRequest", "graphDirective", "transport"],
		"d771.transportInput",
	);
	const effectRequest = input.effectRequest as D720GraphEffectRequestV1;
	const directive = deriveD771CriterionToolDirective(effectRequest);
	const graphDirective = input.graphDirective as D771CriterionRouteDirectiveV1;
	const graphState = constructedRouteDirectives.get(graphDirective);
	if (graphState === undefined || graphState.request !== effectRequest)
		throw new TypeError("D771 transport requires the exact unconsumed Graph route directive");
	constructedRouteDirectives.delete(graphDirective);
	const transport = ownRecord(input.transport, ["request"], "d771.transport");
	if (typeof transport.request !== "function")
		throw new TypeError("D771 transport port is invalid");
	let calls = 0;
	const capture = Object.freeze({
		async request(request: OpenRouterResponsesTransportRequestV1) {
			calls += 1;
			if (calls !== 1) throw new TypeError("D771 transport was called more than once");
			let decodedBody: unknown;
			try {
				decodedBody = JSON.parse(decoder.decode(request.body));
			} catch (error) {
				throw new TypeError("D771 final model request body is not JSON", { cause: error });
			}
			const finalBody = record(decodedBody, "d771.finalModelRequest");
			const messages = array(finalBody.messages, "d771.finalModelRequest.messages");
			const modelVisibleMessagesDigest = empiricalStrictJsonDigest(messages);
			if (modelVisibleMessagesDigest !== graphDirective.modelVisibleMessagesDigest)
				throw new TypeError("D771 final model-visible messages differ from Graph exposure");
			const response = (await Reflect.apply(
				transport.request as (...args: unknown[]) => unknown,
				input.transport,
				[request],
			)) as Awaited<ReturnType<OpenRouterResponsesByteTransportV1["request"]>>;
			const material = strictSnapshot({
				revision: "graphrefly.b112.d771.criterion-lowering-proposal.v1" as const,
				requestDigest: effectRequest.requestDigest,
				logicalRequestDigest: effectRequest.logicalRequestDigest,
				attemptOrdinal: effectRequest.attemptOrdinal,
				contextDigest: graphDirective.contextDigest,
				contextAdmissionDigest: graphDirective.contextAdmissionDigest,
				graphDirectiveDigest: graphDirective.directiveDigest,
				loweredBodyDigest: empiricalSha256(request.body),
				requiredToolName:
					directive?.requiredToolRef === "replace-exact" ? ("replace_exact" as const) : null,
				conversationDigest: graphDirective.conversationDigest,
				modelVisibleMessagesDigest,
				exposureEvidenceDigest: graphDirective.exposureEvidenceDigest,
			});
			const proposal = Object.freeze({
				...material,
				proposalDigest: empiricalStrictJsonDigest(material),
			});
			pendingLoweringProposals.set(effectRequest, proposal);
			constructedLoweringProposals.add(proposal);
			return response;
		},
	});
	if (directive === null)
		return createD756GraphNamedToolTransport({
			effectRequest: effectRequest as never,
			transport: capture,
		});
	return Object.freeze({
		async request(request: OpenRouterResponsesTransportRequestV1) {
			return capture.request({ ...request, body: lowerCriterionChatBody(request.body, directive) });
		},
	});
}

export function takeD771CriterionLoweringProposal(
	effectRequest: D720GraphEffectRequestV1,
): D771CriterionLoweringProposalV1 | null {
	const proposal = pendingLoweringProposals.get(effectRequest);
	if (proposal === undefined) return null;
	pendingLoweringProposals.delete(effectRequest);
	return proposal;
}

export function consumeD771CriterionLoweringProposal(
	proposal: D771CriterionLoweringProposalV1,
): D771CriterionLoweringProposalV1 {
	if (!constructedLoweringProposals.has(proposal))
		throw new TypeError("D771 lowering proposal is forged or replayed");
	constructedLoweringProposals.delete(proposal);
	return proposal;
}

export async function invokeD771RouteBoundOpenRouterTurn(
	inputValue: Parameters<typeof invokeD734RouteBoundOpenRouterTurn>[0] & {
		readonly graphDirective?: D771CriterionRouteDirectiveV1;
	},
): ReturnType<typeof invokeD734RouteBoundOpenRouterTurn> {
	const input = ownRecord(
		inputValue,
		[
			"conversation",
			"credential",
			"effectRequest",
			...(Object.hasOwn(inputValue, "graphDirective") ? ["graphDirective" as const] : []),
			"monotonicNowMs",
			"routeAdmission",
			"signal",
			"taskStatement",
			"transport",
			...(Object.hasOwn(inputValue, "usageBasis") ? ["usageBasis" as const] : []),
		],
		"d771.routeBoundTurn",
	);
	const effectRequest = input.effectRequest as D720GraphEffectRequestV1;
	deriveD771CriterionToolDirective(effectRequest);
	const graphDirective = input.graphDirective as D771CriterionRouteDirectiveV1 | undefined;
	if (graphDirective === undefined)
		throw new TypeError("D771 provider route requires a Graph-issued directive");
	const graphState = constructedRouteDirectives.get(graphDirective);
	if (graphState === undefined || graphState.request !== input.effectRequest)
		throw new TypeError("D771 provider route requires the exact Graph-issued directive");
	const expectedExposure = {
		conversationDigest: empiricalStrictJsonDigest(input.conversation),
	};
	if (graphDirective.conversationDigest !== expectedExposure.conversationDigest)
		throw new TypeError("D771 model exposure differs from the Graph-issued route directive");
	const { graphDirective: _graphDirective, ...baseInput } = input;
	return invokeD734RouteBoundOpenRouterTurn({
		...(baseInput as unknown as Parameters<typeof invokeD734RouteBoundOpenRouterTurn>[0]),
		transport: createD771CriterionNamedToolTransport({
			effectRequest: input.effectRequest as D720GraphEffectRequestV1,
			graphDirective,
			transport: input.transport as OpenRouterResponsesByteTransportV1,
		}),
	});
}
