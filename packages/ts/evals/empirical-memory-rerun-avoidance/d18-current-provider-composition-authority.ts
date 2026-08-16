import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	admitD17EffectResult,
	createD17Authority,
	D17_ARMS,
	D17_COMPLETE_TASK_STATEMENT,
	D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
	type D17AdmittedEffectFactV1,
	type D17AdmittedEffectV1,
	type D17Arm,
	type D17EffectResultInputV1,
	type D17EvidenceV1,
	type D17ToolRef,
	nextD17Effect,
	snapshotD17Evidence,
	takeD17ProviderMaterial,
	validateD17Evidence,
} from "./d17-current-efficacy-authority.js";

export const D18_DECISION_REF = "graphrefly-ts:D18" as const;
export const D18_AUTHORITY_REVISION =
	"graphrefly-ts.d18.current-provider-composition-authority.v1" as const;
export const D18_EVIDENCE_SCHEMA =
	"graphrefly-ts.d18.current-provider-composition-evidence.v1" as const;

const D18_ROUTE_BASE = strictSnapshot({
	schemaVersion: "graphrefly-ts.d18.route.v1" as const,
	model: "deepseek/deepseek-v4-flash-0731" as const,
	selectedModel: "deepseek/deepseek-v4-flash-20260731" as const,
	provider: "DeepInfra" as const,
	providerTag: "deepinfra/fp8" as const,
	endpointClass: "chat-completions" as const,
	reasoningEffort: "high" as const,
	maxOutputTokens: 65_536,
	pricing: Object.freeze({
		inputMicrousdPerMillion: 80_000,
		outputMicrousdPerMillion: 180_000,
		cacheReadMicrousdPerMillion: 16_000,
		revision: "graphrefly-ts.current.deepinfra-fp8-pricing.v4" as const,
	}),
});

export const D18_ROUTE = Object.freeze({
	...D18_ROUTE_BASE,
	routeDigest: empiricalStrictJsonDigest(D18_ROUTE_BASE),
});

export interface D18LimitsV1 {
	readonly maxProviderAttempts: number;
	readonly maxRetryWaits: number;
	readonly maxCostMicrousd: number;
	readonly maxElapsedMs: number;
	readonly providerMaxCostMicrousd: number;
	readonly retryWaitMaxElapsedMs: number;
}

export const D18_LIMITS = Object.freeze({
	maxProviderAttempts: 96,
	maxRetryWaits: 12,
	maxCostMicrousd: 6_000_000,
	maxElapsedMs: 7_200_000,
	providerMaxCostMicrousd: 100_000,
	retryWaitMaxElapsedMs: 60_000,
});

export const D18_INSPECTION_PATHS = Object.freeze([
	"packages/ts/src/executors/managed-cloud-postgresql.ts",
	"packages/ts/src/executors/managed-untrusted-js-compute.ts",
	"packages/ts/src/identity.ts",
	"packages/ts/src/orchestration/agent-runtime-tool-provider-run-admission.ts",
] as const);

export const D18_WRITABLE_PATH = D18_INSPECTION_PATHS[0];

export type D18RetryPolicy = "D671" | "D675" | "D710";
export type D18RetryCause =
	| "typed-rate-limit-or-503"
	| "request-phase-und-err-socket"
	| "untyped-http-429";

export interface D18BudgetStateV1 {
	readonly providerAttempts: number;
	readonly retryWaits: number;
	readonly actualCostMicrousd: number;
	readonly actualElapsedMs: number;
}

export interface D18ProviderAttemptRequestV1 {
	readonly schemaVersion: "graphrefly-ts.d18.provider-attempt-request.v1";
	readonly sequence: number;
	readonly arm: D17Arm;
	readonly phase: "inspection" | "mutation";
	readonly workflowRequestDigest: string;
	readonly workflowAdmissionDigest: string;
	readonly logicalRequestDigest: string;
	readonly attemptOrdinal: 1 | 2;
	readonly routeDigest: string;
	readonly modelVisibleEnvelopeDigest: string;
	readonly wireBodyDigest: string;
	readonly namedToolChoice: "replace_exact" | null;
	readonly reservation: Readonly<{
		providerAttempts: 1;
		maxCostMicrousd: number;
		maxElapsedMs: number;
	}>;
	readonly requestDigest: string;
}

export interface D18RetryWaitRequestV1 {
	readonly schemaVersion: "graphrefly-ts.d18.retry-wait-request.v1";
	readonly sequence: number;
	readonly arm: D17Arm;
	readonly workflowRequestDigest: string;
	readonly logicalRequestDigest: string;
	readonly routeDigest: string;
	readonly retryPolicy: D18RetryPolicy;
	readonly retryCause: D18RetryCause;
	readonly delayMs: number;
	readonly reservation: Readonly<{ retryWaits: 1; maxElapsedMs: number }>;
	readonly requestDigest: string;
}

export interface D18EffectAdmissionV1 {
	readonly schemaVersion: "graphrefly-ts.d18.effect-admission.v1";
	readonly requestDigest: string;
	readonly admitted: true;
	readonly budgetBefore: D18BudgetStateV1;
	readonly prospectiveBudget: D18BudgetStateV1;
	readonly admissionDigest: string;
}

export type D18AdmittedEffectV1 =
	| Readonly<{
			kind: "workflow-local";
			workflowEffect: D17AdmittedEffectV1;
	  }>
	| Readonly<{
			kind: "provider-attempt";
			request: D18ProviderAttemptRequestV1;
			admission: D18EffectAdmissionV1;
	  }>
	| Readonly<{
			kind: "retry-wait";
			request: D18RetryWaitRequestV1;
			admission: D18EffectAdmissionV1;
	  }>;

export type D18RuntimeToolArgumentsV1 =
	| Readonly<{ toolRef: "read-file"; path: string }>
	| Readonly<{ toolRef: "replace-exact"; path: string; oldText: string; newText: string }>
	| Readonly<{ toolRef: "workspace-diff" }>
	| Readonly<{ toolRef: "focused-validation" }>;

export type D18RuntimeMaterialV1 =
	| Readonly<{ kind: "provider-attempt"; body: unknown }>
	| Readonly<{ kind: "workflow-local"; toolArguments: D18RuntimeToolArgumentsV1 | null }>;

export type D18ProviderResultInputV1 =
	| Readonly<{
			effectKind: "provider-attempt";
			status: "completed";
			wireBodyDigest: string;
			toolIntents: readonly D18RuntimeToolArgumentsV1[];
			inputTokens: number;
			outputTokens: number;
			cacheReadTokens: number;
			actualCostMicrousd: number;
			actualElapsedMs: number;
			evidenceDigest: string;
	  }>
	| Readonly<{
			effectKind: "provider-attempt";
			status: "failed";
			wireBodyDigest: string;
			failureFamily: "transport" | "http" | "executor";
			retryProposal: Readonly<{
				policy: D18RetryPolicy;
				cause: D18RetryCause;
				delayMs: number;
			}> | null;
			costBasis: "reported" | "conservative-reservation";
			actualCostMicrousd: number;
			actualElapsedMs: number;
			evidenceDigest: string;
	  }>;

export interface D18ProviderFactV1 {
	readonly schemaVersion: "graphrefly-ts.d18.provider-fact.v1";
	readonly sequence: number;
	readonly request: D18ProviderAttemptRequestV1 | D18RetryWaitRequestV1;
	readonly admission: D18EffectAdmissionV1;
	readonly result: Readonly<Record<string, unknown>>;
	readonly reconciliation: Readonly<{
		actualCostMicrousd: number;
		actualElapsedMs: number;
		budgetAfter: D18BudgetStateV1;
		reconciliationDigest: string;
	}>;
	readonly factDigest: string;
}

export interface D18EvidenceV1 {
	readonly schemaVersion: typeof D18_EVIDENCE_SCHEMA;
	readonly decisionRef: typeof D18_DECISION_REF;
	readonly authorityRevision: typeof D18_AUTHORITY_REVISION;
	readonly baseline: Readonly<{
		commit: "80d5f01a48af679fa8aacd44f82662b703c8db0d";
		d17BundleArtifactDigest: "sha256:2bfdef6295e4de0680da6b17da2c7606d0e221365cb54457d3e28a5ac672886a";
		d17ImplementationManifestDigest: "sha256:a1cb4da3401159bf6015f7ea8e4a100f1c4a2e7a3519bb4c9e2b3ce0987cf811";
	}>;
	readonly topology: Readonly<{
		providerFactNode: "current/d18/provider-facts";
		canonicalProjectionNode: "current/d18/canonical-projection";
		topologyDigest: string;
	}>;
	readonly route: typeof D18_ROUTE;
	readonly limits: D18LimitsV1;
	readonly workflowEvidence: D17EvidenceV1;
	readonly providerFacts: readonly D18ProviderFactV1[];
	readonly budget: D18BudgetStateV1;
	readonly maxActiveEffects: 1;
	readonly runStatus: "complete";
	readonly liveGateEvaluated: false;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D18AuthorityV1 {
	readonly revision: typeof D18_AUTHORITY_REVISION;
}

interface ProviderContext {
	readonly workflowEffect: D17AdmittedEffectV1;
	readonly modelVisibleEnvelope: string;
	readonly body: unknown;
	readonly bodyDigest: string;
	readonly logicalRequestDigest: string;
	attemptOrdinal: 1 | 2;
}

interface RuntimeProviderFact {
	readonly projection: D18ProviderFactV1;
	readonly rawToolIntents: readonly D18RuntimeToolArgumentsV1[];
}

interface AuthorityState {
	readonly owner: ReturnType<typeof graph>;
	readonly factNode: ReturnType<typeof createRuntimeFactNode>;
	readonly workflow: ReturnType<typeof createD17Authority>;
	readonly limits: D18LimitsV1;
	readonly facts: D18ProviderFactV1[];
	readonly workflowFacts: D17AdmittedEffectFactV1[];
	budget: D18BudgetStateV1;
	active: D18AdmittedEffectV1 | null;
	providerContext: ProviderContext | null;
	pendingToolArguments: D18RuntimeToolArgumentsV1[];
	nextSequence: number;
	finished: boolean;
}

const states = new WeakMap<object, AuthorityState>();
const runtimeMaterials = new WeakMap<object, D18RuntimeMaterialV1>();

const ZERO_BUDGET = Object.freeze({
	providerAttempts: 0,
	retryWaits: 0,
	actualCostMicrousd: 0,
	actualElapsedMs: 0,
});

function createRuntimeFactNode(owner: ReturnType<typeof graph>) {
	return owner.node<RuntimeProviderFact>([], null, { name: "current/d18/provider-facts" });
}

function baseline() {
	return Object.freeze({
		commit: "80d5f01a48af679fa8aacd44f82662b703c8db0d" as const,
		d17BundleArtifactDigest:
			"sha256:2bfdef6295e4de0680da6b17da2c7606d0e221365cb54457d3e28a5ac672886a" as const,
		d17ImplementationManifestDigest:
			"sha256:a1cb4da3401159bf6015f7ea8e4a100f1c4a2e7a3519bb4c9e2b3ce0987cf811" as const,
	});
}

function topology() {
	const material = strictSnapshot({
		providerFactNode: "current/d18/provider-facts" as const,
		canonicalProjectionNode: "current/d18/canonical-projection" as const,
	});
	return Object.freeze({ ...material, topologyDigest: empiricalStrictJsonDigest(material) });
}

function stateFor(authority: D18AuthorityV1): AuthorityState {
	const state = states.get(authority);
	if (state === undefined) throw new TypeError("D18 authority is forged");
	return state;
}

function canonicalBody(modelVisibleEnvelope: string, namedToolChoice: "replace_exact" | null) {
	const tools = Object.freeze(
		namedToolChoice === null
			? [
					Object.freeze({
						type: "function",
						function: Object.freeze({
							name: "read_file",
							description: "Read one exact admitted file.",
							parameters: Object.freeze({
								type: "object",
								additionalProperties: false,
								required: ["path"],
								properties: Object.freeze({
									path: Object.freeze({ type: "string", enum: D18_INSPECTION_PATHS }),
								}),
							}),
						}),
					}),
				]
			: [
					Object.freeze({
						type: "function",
						function: Object.freeze({
							name: "replace_exact",
							description: "Replace one exact occurrence in the admitted file.",
							parameters: Object.freeze({
								type: "object",
								additionalProperties: false,
								required: ["path", "oldText", "newText"],
								properties: Object.freeze({
									path: Object.freeze({ type: "string", enum: [D18_WRITABLE_PATH] }),
									oldText: Object.freeze({ type: "string", minLength: 1, maxLength: 32_768 }),
									newText: Object.freeze({ type: "string", maxLength: 32_768 }),
								}),
							}),
						}),
					}),
				],
	);
	return strictSnapshot({
		model: D18_ROUTE.model,
		messages: [{ role: "user", content: modelVisibleEnvelope }],
		tools,
		tool_choice:
			namedToolChoice === null
				? "required"
				: { type: "function", function: { name: namedToolChoice } },
		max_tokens: D18_ROUTE.maxOutputTokens,
		reasoning: { effort: D18_ROUTE.reasoningEffort },
		provider: {
			order: [D18_ROUTE.providerTag],
			only: [D18_ROUTE.providerTag],
			allow_fallbacks: false,
			require_parameters: true,
		},
	});
}

function prospective(
	state: AuthorityState,
	reservation: {
		providerAttempts?: number;
		retryWaits?: number;
		maxCostMicrousd?: number;
		maxElapsedMs: number;
	},
): D18BudgetStateV1 {
	return Object.freeze({
		providerAttempts: state.budget.providerAttempts + (reservation.providerAttempts ?? 0),
		retryWaits: state.budget.retryWaits + (reservation.retryWaits ?? 0),
		actualCostMicrousd: state.budget.actualCostMicrousd + (reservation.maxCostMicrousd ?? 0),
		actualElapsedMs: state.budget.actualElapsedMs + reservation.maxElapsedMs,
	});
}

function withinLimits(value: D18BudgetStateV1, limits: D18LimitsV1): boolean {
	return (
		value.providerAttempts <= limits.maxProviderAttempts &&
		value.retryWaits <= limits.maxRetryWaits &&
		value.actualCostMicrousd <= limits.maxCostMicrousd &&
		value.actualElapsedMs <= limits.maxElapsedMs
	);
}

function admission(
	state: AuthorityState,
	request: D18ProviderAttemptRequestV1 | D18RetryWaitRequestV1,
): D18EffectAdmissionV1 {
	const reservation =
		request.schemaVersion === "graphrefly-ts.d18.provider-attempt-request.v1"
			? request.reservation
			: request.reservation;
	const candidate = prospective(state, reservation);
	if (!withinLimits(candidate, state.limits))
		throw new TypeError("D18 effect lacks Graph budget headroom");
	const base = strictSnapshot({
		schemaVersion: "graphrefly-ts.d18.effect-admission.v1" as const,
		requestDigest: request.requestDigest,
		admitted: true as const,
		budgetBefore: state.budget,
		prospectiveBudget: candidate,
	});
	return Object.freeze({ ...base, admissionDigest: empiricalStrictJsonDigest(base) });
}

function scheduleProviderAttempt(state: AuthorityState): void {
	const context = state.providerContext;
	if (context === null || state.active !== null)
		throw new TypeError("D18 provider scheduling state drifted");
	const workflowRequest = context.workflowEffect.request;
	const maxElapsedMs = workflowRequest.reservation.maxElapsedMs;
	const base = strictSnapshot({
		schemaVersion: "graphrefly-ts.d18.provider-attempt-request.v1" as const,
		sequence: state.nextSequence++,
		arm: workflowRequest.arm,
		phase: workflowRequest.phase as "inspection" | "mutation",
		workflowRequestDigest: workflowRequest.requestDigest,
		workflowAdmissionDigest: context.workflowEffect.admission.admissionDigest,
		logicalRequestDigest: context.logicalRequestDigest,
		attemptOrdinal: context.attemptOrdinal,
		routeDigest: D18_ROUTE.routeDigest,
		modelVisibleEnvelopeDigest: workflowRequest.modelVisibleEnvelopeDigest,
		wireBodyDigest: context.bodyDigest,
		namedToolChoice:
			workflowRequest.requiredFirstToolRef === "replace-exact" ? ("replace_exact" as const) : null,
		reservation: Object.freeze({
			providerAttempts: 1 as const,
			maxCostMicrousd: state.limits.providerMaxCostMicrousd,
			maxElapsedMs,
		}),
	});
	const request = Object.freeze({ ...base, requestDigest: empiricalStrictJsonDigest(base) });
	const candidate = prospective(state, request.reservation);
	if (!withinLimits(candidate, state.limits)) {
		const failed = Object.freeze({
			effectKind: "provider-request" as const,
			status: "failed" as const,
			toolIntents: Object.freeze([]),
			observedModelVisibleEnvelopeDigest: workflowRequest.modelVisibleEnvelopeDigest,
			wireMessagesDigest: workflowRequest.modelVisibleEnvelopeDigest,
			failureFamily: "executor" as const,
			evidenceDigest: empiricalStrictJsonDigest({
				kind: "d18-provider-headroom-denied",
				workflowRequestDigest: workflowRequest.requestDigest,
			}),
			actualCostMicrousd: 0,
			actualElapsedMs: 0,
		});
		state.workflowFacts.push(admitD17EffectResult(state.workflow, context.workflowEffect, failed));
		state.providerContext = null;
		scheduleNext(state);
		return;
	}
	const effect = Object.freeze({
		kind: "provider-attempt" as const,
		request,
		admission: admission(state, request),
	});
	state.active = effect;
	runtimeMaterials.set(effect, Object.freeze({ kind: "provider-attempt", body: context.body }));
}

function scheduleRetryWait(
	state: AuthorityState,
	policy: D18RetryPolicy,
	cause: D18RetryCause,
	delayMs: number,
): void {
	const context = state.providerContext;
	if (context === null || state.active !== null)
		throw new TypeError("D18 retry scheduling state drifted");
	const base = strictSnapshot({
		schemaVersion: "graphrefly-ts.d18.retry-wait-request.v1" as const,
		sequence: state.nextSequence++,
		arm: context.workflowEffect.request.arm,
		workflowRequestDigest: context.workflowEffect.request.requestDigest,
		logicalRequestDigest: context.logicalRequestDigest,
		routeDigest: D18_ROUTE.routeDigest,
		retryPolicy: policy,
		retryCause: cause,
		delayMs,
		reservation: Object.freeze({ retryWaits: 1 as const, maxElapsedMs: delayMs }),
	});
	const request = Object.freeze({ ...base, requestDigest: empiricalStrictJsonDigest(base) });
	const effect = Object.freeze({
		kind: "retry-wait" as const,
		request,
		admission: admission(state, request),
	});
	state.active = effect;
	runtimeMaterials.set(effect, Object.freeze({ kind: "workflow-local", toolArguments: null }));
}

function scheduleNext(state: AuthorityState): void {
	if (state.active !== null) throw new TypeError("D18 effect overlap");
	const workflowEffect = nextD17Effect(state.workflow);
	if (workflowEffect === null) {
		state.finished = true;
		return;
	}
	if (workflowEffect.request.effectKind !== "provider-request") {
		const effect = Object.freeze({ kind: "workflow-local" as const, workflowEffect });
		state.active = effect;
		let args: D18RuntimeToolArgumentsV1 | null = null;
		if (workflowEffect.request.effectKind === "tool-action") {
			if (
				workflowEffect.request.toolRef === "read-file" ||
				workflowEffect.request.toolRef === "replace-exact"
			) {
				const shifted = state.pendingToolArguments.shift();
				if (shifted === undefined || shifted.toolRef !== workflowEffect.request.toolRef)
					throw new TypeError("D18 Graph runtime tool argument queue drifted");
				args = shifted;
			} else if (workflowEffect.request.toolRef !== null) {
				args = Object.freeze({ toolRef: workflowEffect.request.toolRef });
			}
		}
		runtimeMaterials.set(effect, Object.freeze({ kind: "workflow-local", toolArguments: args }));
		return;
	}
	const material = takeD17ProviderMaterial(state.workflow, workflowEffect);
	const named =
		workflowEffect.request.requiredFirstToolRef === "replace-exact" ? "replace_exact" : null;
	const body = canonicalBody(material.modelVisibleEnvelope, named);
	state.providerContext = {
		workflowEffect,
		modelVisibleEnvelope: material.modelVisibleEnvelope,
		body,
		bodyDigest: empiricalStrictJsonDigest(body),
		logicalRequestDigest: workflowEffect.request.logicalRequestDigest ?? "",
		attemptOrdinal: 1,
	};
	scheduleProviderAttempt(state);
}

function validateToolArguments(value: unknown, path: string): D18RuntimeToolArgumentsV1 {
	const candidate = record(value, path);
	const toolRef = oneOf(candidate.toolRef, ["read-file", "replace-exact"], `${path}.toolRef`);
	if (toolRef === "read-file") {
		exactKeys(candidate, ["path", "toolRef"], path);
		if (!D18_INSPECTION_PATHS.includes(candidate.path as (typeof D18_INSPECTION_PATHS)[number]))
			throw new TypeError(`${path}.path is not an admitted inspection path`);
		return Object.freeze({ toolRef, path: candidate.path as string });
	}
	exactKeys(candidate, ["newText", "oldText", "path", "toolRef"], path);
	if (candidate.path !== D18_WRITABLE_PATH)
		throw new TypeError("D18 replace_exact path is not writable");
	if (
		typeof candidate.oldText !== "string" ||
		candidate.oldText.length < 1 ||
		candidate.oldText.length > 32_768 ||
		typeof candidate.newText !== "string" ||
		candidate.newText.length > 32_768
	)
		throw new TypeError("D18 replace_exact arguments exceed their runtime bound");
	return Object.freeze({
		toolRef,
		path: candidate.path,
		oldText: candidate.oldText,
		newText: candidate.newText,
	});
}

function validateProviderResult(
	value: unknown,
	request: D18ProviderAttemptRequestV1,
): {
	projection: Readonly<Record<string, unknown>>;
	rawToolIntents: readonly D18RuntimeToolArgumentsV1[];
} {
	const candidate = record(value, "D18 provider result");
	if (candidate.effectKind !== "provider-attempt")
		throw new TypeError("D18 provider result kind drifted");
	if (candidate.wireBodyDigest !== request.wireBodyDigest)
		throw new TypeError("D18 provider wire body drifted");
	const status = oneOf(candidate.status, ["completed", "failed"], "D18 provider status");
	const actualCostMicrousd = safeInteger(candidate.actualCostMicrousd, "D18 provider cost", {
		max: request.reservation.maxCostMicrousd,
	});
	const actualElapsedMs = safeInteger(candidate.actualElapsedMs, "D18 provider elapsed", {
		max: request.reservation.maxElapsedMs,
	});
	const evidenceDigest = digest(candidate.evidenceDigest, "D18 provider evidence");
	if (status === "completed") {
		exactKeys(
			candidate,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"cacheReadTokens",
				"effectKind",
				"evidenceDigest",
				"inputTokens",
				"outputTokens",
				"status",
				"toolIntents",
				"wireBodyDigest",
			],
			"D18 provider result",
		);
		const values = array(candidate.toolIntents, "D18 provider toolIntents");
		if (values.length > 4) throw new TypeError("D18 provider tool intent bound exceeded");
		const raw = Object.freeze(
			values.map((entry, index) => validateToolArguments(entry, `D18 tool[${index}]`)),
		);
		if (request.phase === "inspection") {
			if (
				raw.length !== 4 ||
				raw.some(
					(entry, index) =>
						entry.toolRef !== "read-file" || entry.path !== D18_INSPECTION_PATHS[index],
				)
			)
				throw new TypeError("D18 inspection response is not the exact ordered four-read batch");
		} else if (raw.length !== 1 || raw[0]?.toolRef !== "replace-exact") {
			throw new TypeError("D18 mutation response did not honor named replace_exact");
		}
		const toolIntents = Object.freeze(
			raw.map((entry) =>
				Object.freeze({
					toolRef: entry.toolRef,
					argumentsDigest: empiricalStrictJsonDigest(entry),
					argumentsBytes: new TextEncoder().encode(JSON.stringify(entry)).byteLength,
				}),
			),
		);
		return {
			rawToolIntents: raw,
			projection: strictSnapshot({
				effectKind: "provider-attempt",
				status,
				wireBodyDigest: request.wireBodyDigest,
				toolIntents,
				inputTokens: safeInteger(candidate.inputTokens, "D18 input tokens", { max: 2_000_000 }),
				outputTokens: safeInteger(candidate.outputTokens, "D18 output tokens", { max: 200_000 }),
				cacheReadTokens: safeInteger(candidate.cacheReadTokens, "D18 cache tokens", {
					max: 2_000_000,
				}),
				actualCostMicrousd,
				actualElapsedMs,
				evidenceDigest,
			}),
		};
	}
	exactKeys(
		candidate,
		[
			"actualCostMicrousd",
			"actualElapsedMs",
			"costBasis",
			"effectKind",
			"evidenceDigest",
			"failureFamily",
			"retryProposal",
			"status",
			"wireBodyDigest",
		],
		"D18 provider result",
	);
	const proposal = candidate.retryProposal;
	let retryProposal: Readonly<{
		policy: D18RetryPolicy;
		cause: D18RetryCause;
		delayMs: number;
	}> | null = null;
	if (proposal !== null) {
		const proposed = record(proposal, "D18 retry proposal");
		exactKeys(proposed, ["cause", "delayMs", "policy"], "D18 retry proposal");
		const policy = oneOf(proposed.policy, ["D671", "D675", "D710"], "D18 retry policy");
		const cause = oneOf(
			proposed.cause,
			["typed-rate-limit-or-503", "request-phase-und-err-socket", "untyped-http-429"],
			"D18 retry cause",
		);
		const expected: Record<D18RetryPolicy, D18RetryCause> = {
			D671: "typed-rate-limit-or-503",
			D675: "request-phase-und-err-socket",
			D710: "untyped-http-429",
		};
		if (expected[policy] !== cause) throw new TypeError("D18 retry policy discriminator drifted");
		retryProposal = Object.freeze({
			policy,
			cause,
			delayMs: safeInteger(proposed.delayMs, "D18 retry delay", { max: 60_000 }),
		});
	}
	return {
		rawToolIntents: Object.freeze([]),
		projection: strictSnapshot({
			effectKind: "provider-attempt",
			status,
			wireBodyDigest: request.wireBodyDigest,
			failureFamily: oneOf(
				candidate.failureFamily,
				["transport", "http", "executor"],
				"D18 failure family",
			),
			retryProposal,
			costBasis: oneOf(
				candidate.costBasis,
				["reported", "conservative-reservation"],
				"D18 cost basis",
			),
			actualCostMicrousd,
			actualElapsedMs,
			evidenceDigest,
		}),
	};
}

function reconcile(
	state: AuthorityState,
	request: D18ProviderAttemptRequestV1 | D18RetryWaitRequestV1,
	result: Readonly<Record<string, unknown>>,
) {
	const provider = request.schemaVersion === "graphrefly-ts.d18.provider-attempt-request.v1";
	const cost = provider ? (result.actualCostMicrousd as number) : 0;
	const elapsed = result.actualElapsedMs as number;
	const budgetAfter = Object.freeze({
		providerAttempts: state.budget.providerAttempts + (provider ? 1 : 0),
		retryWaits: state.budget.retryWaits + (provider ? 0 : 1),
		actualCostMicrousd: state.budget.actualCostMicrousd + cost,
		actualElapsedMs: state.budget.actualElapsedMs + elapsed,
	});
	if (!withinLimits(budgetAfter, state.limits))
		throw new TypeError("D18 measured result exceeded Graph budget");
	const base = strictSnapshot({ actualCostMicrousd: cost, actualElapsedMs: elapsed, budgetAfter });
	return Object.freeze({ ...base, reconciliationDigest: empiricalStrictJsonDigest(base) });
}

function emitFact(
	state: AuthorityState,
	active: Exclude<D18AdmittedEffectV1, { kind: "workflow-local" }>,
	result: Readonly<Record<string, unknown>>,
	rawToolIntents: readonly D18RuntimeToolArgumentsV1[],
): D18ProviderFactV1 {
	const reconciliation = reconcile(state, active.request, result);
	const base = strictSnapshot({
		schemaVersion: "graphrefly-ts.d18.provider-fact.v1" as const,
		sequence: state.facts.length,
		request: active.request,
		admission: active.admission,
		result,
		reconciliation,
	});
	const projection = Object.freeze({ ...base, factDigest: empiricalStrictJsonDigest(base) });
	state.active = null;
	state.factNode.down([
		["DATA", Object.freeze({ projection, rawToolIntents: Object.freeze([...rawToolIntents]) })],
	]);
	return projection;
}

function applyRuntimeFact(state: AuthorityState, runtime: RuntimeProviderFact): void {
	const fact = runtime.projection;
	state.facts.push(fact);
	state.budget = fact.reconciliation.budgetAfter;
	if (fact.request.schemaVersion === "graphrefly-ts.d18.retry-wait-request.v1") {
		const context = state.providerContext;
		if (context === null || context.attemptOrdinal !== 1)
			throw new TypeError("D18 retry context drifted");
		context.attemptOrdinal = 2;
		scheduleProviderAttempt(state);
		return;
	}
	const context = state.providerContext;
	if (
		context === null ||
		context.workflowEffect.request.requestDigest !== fact.request.workflowRequestDigest
	)
		throw new TypeError("D18 provider fact does not match the active workflow request");
	if (fact.result.status === "failed") {
		const proposal = fact.result.retryProposal as Readonly<{
			policy: D18RetryPolicy;
			cause: D18RetryCause;
			delayMs: number;
		}> | null;
		if (proposal !== null && fact.request.attemptOrdinal === 1) {
			scheduleRetryWait(state, proposal.policy, proposal.cause, proposal.delayMs);
			return;
		}
		const failed: D17EffectResultInputV1 = Object.freeze({
			effectKind: "provider-request",
			status: "failed",
			toolIntents: Object.freeze([]),
			observedModelVisibleEnvelopeDigest: fact.request.modelVisibleEnvelopeDigest,
			wireMessagesDigest: fact.request.modelVisibleEnvelopeDigest,
			failureFamily: fact.result.failureFamily as "transport" | "http" | "executor",
			evidenceDigest: fact.result.evidenceDigest as string,
			actualCostMicrousd: 0,
			actualElapsedMs: 0,
		});
		state.workflowFacts.push(admitD17EffectResult(state.workflow, context.workflowEffect, failed));
		state.providerContext = null;
		scheduleNext(state);
		return;
	}
	state.pendingToolArguments.push(...runtime.rawToolIntents);
	const completed: D17EffectResultInputV1 = Object.freeze({
		effectKind: "provider-request",
		status: "completed",
		toolIntents: Object.freeze(runtime.rawToolIntents.map((entry) => entry.toolRef as D17ToolRef)),
		observedModelVisibleEnvelopeDigest: fact.request.modelVisibleEnvelopeDigest,
		wireMessagesDigest: fact.request.modelVisibleEnvelopeDigest,
		failureFamily: null,
		evidenceDigest: fact.result.evidenceDigest as string,
		actualCostMicrousd: 0,
		actualElapsedMs: 0,
	});
	state.workflowFacts.push(admitD17EffectResult(state.workflow, context.workflowEffect, completed));
	state.providerContext = null;
	scheduleNext(state);
}

export function createD18Authority(input: { readonly limits?: D18LimitsV1 } = {}): D18AuthorityV1 {
	const limitsValue = record(input.limits ?? D18_LIMITS, "D18 limits");
	exactKeys(
		limitsValue,
		[
			"maxCostMicrousd",
			"maxElapsedMs",
			"maxProviderAttempts",
			"maxRetryWaits",
			"providerMaxCostMicrousd",
			"retryWaitMaxElapsedMs",
		],
		"D18 limits",
	);
	const limits = Object.freeze({
		maxProviderAttempts: safeInteger(
			limitsValue.maxProviderAttempts,
			"D18 limits.maxProviderAttempts",
			{
				max: D18_LIMITS.maxProviderAttempts,
			},
		),
		maxRetryWaits: safeInteger(limitsValue.maxRetryWaits, "D18 limits.maxRetryWaits", {
			max: D18_LIMITS.maxRetryWaits,
		}),
		maxCostMicrousd: safeInteger(limitsValue.maxCostMicrousd, "D18 limits.maxCostMicrousd", {
			max: D18_LIMITS.maxCostMicrousd,
		}),
		maxElapsedMs: safeInteger(limitsValue.maxElapsedMs, "D18 limits.maxElapsedMs", {
			max: D18_LIMITS.maxElapsedMs,
		}),
		providerMaxCostMicrousd: safeInteger(
			limitsValue.providerMaxCostMicrousd,
			"D18 limits.providerMaxCostMicrousd",
			{ max: D18_LIMITS.providerMaxCostMicrousd },
		),
		retryWaitMaxElapsedMs: safeInteger(
			limitsValue.retryWaitMaxElapsedMs,
			"D18 limits.retryWaitMaxElapsedMs",
			{ max: D18_LIMITS.retryWaitMaxElapsedMs },
		),
	});
	const owner = graph({ name: "current/d18/provider-composition" });
	const factNode = createRuntimeFactNode(owner);
	const projectionNode = owner.node<RuntimeProviderFact>(
		[factNode],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) ctx.down([["DATA", fact]]);
		},
		{ name: "current/d18/canonical-projection", factory: "d18ProviderCanonicalProjection" },
	);
	const authority = Object.freeze({ revision: D18_AUTHORITY_REVISION });
	const state: AuthorityState = {
		owner,
		factNode,
		workflow: createD17Authority({ taskStatement: D17_COMPLETE_TASK_STATEMENT }),
		limits,
		facts: [],
		workflowFacts: [],
		budget: ZERO_BUDGET,
		active: null,
		providerContext: null,
		pendingToolArguments: [],
		nextSequence: 0,
		finished: false,
	};
	states.set(authority, state);
	projectionNode.subscribe((message) => {
		if (message[0] === "DATA") applyRuntimeFact(state, message[1] as RuntimeProviderFact);
	});
	scheduleNext(state);
	return authority;
}

export function takeD18Effect(authority: D18AuthorityV1): D18AdmittedEffectV1 | null {
	return stateFor(authority).active;
}

export function takeD18RuntimeMaterial(
	authority: D18AuthorityV1,
	effect: D18AdmittedEffectV1,
): D18RuntimeMaterialV1 {
	const state = stateFor(authority);
	if (state.active !== effect) throw new TypeError("D18 runtime material request is stale");
	const material = runtimeMaterials.get(effect);
	if (material === undefined) throw new TypeError("D18 runtime material was already consumed");
	runtimeMaterials.delete(effect);
	return material;
}

export function admitD18EffectResult(
	authority: D18AuthorityV1,
	effect: D18AdmittedEffectV1,
	resultValue: unknown,
	runtimeMaterialValue?: unknown,
): D18ProviderFactV1 | D17AdmittedEffectFactV1 {
	const state = stateFor(authority);
	if (state.active !== effect) throw new TypeError("D18 effect is forged, stale or replayed");
	if (effect.kind === "workflow-local") {
		const fact = admitD17EffectResult(
			state.workflow,
			effect.workflowEffect,
			resultValue as D17EffectResultInputV1,
			runtimeMaterialValue,
		);
		state.workflowFacts.push(fact);
		state.active = null;
		const cost = fact.result.actualCostMicrousd;
		const elapsed = fact.result.actualElapsedMs;
		state.budget = Object.freeze({
			...state.budget,
			actualCostMicrousd: state.budget.actualCostMicrousd + cost,
			actualElapsedMs: state.budget.actualElapsedMs + elapsed,
		});
		if (!withinLimits(state.budget, state.limits))
			throw new TypeError("D18 local effect exceeded total budget");
		scheduleNext(state);
		return fact;
	}
	if (effect.kind === "retry-wait") {
		const candidate = record(resultValue, "D18 retry result");
		exactKeys(
			candidate,
			["actualElapsedMs", "effectKind", "evidenceDigest", "status"],
			"D18 retry result",
		);
		if (candidate.effectKind !== "retry-wait" || candidate.status !== "completed")
			throw new TypeError("D18 retry wait did not complete");
		const result = strictSnapshot({
			effectKind: "retry-wait",
			status: "completed",
			actualElapsedMs: safeInteger(candidate.actualElapsedMs, "D18 retry elapsed", {
				max: effect.request.reservation.maxElapsedMs,
			}),
			evidenceDigest: digest(candidate.evidenceDigest, "D18 retry evidence"),
		});
		return emitFact(state, effect, result, Object.freeze([]));
	}
	const validated = validateProviderResult(resultValue, effect.request);
	return emitFact(state, effect, validated.projection, validated.rawToolIntents);
}

function evidenceMaterial(state: AuthorityState): Omit<D18EvidenceV1, "evidenceDigest"> {
	const workflowEvidence = snapshotD17Evidence(state.workflow, { evaluateLiveGate: false });
	return strictSnapshot({
		schemaVersion: D18_EVIDENCE_SCHEMA,
		decisionRef: D18_DECISION_REF,
		authorityRevision: D18_AUTHORITY_REVISION,
		baseline: baseline(),
		topology: topology(),
		route: D18_ROUTE,
		limits: state.limits,
		workflowEvidence,
		providerFacts: Object.freeze([...state.facts]),
		budget: state.budget,
		maxActiveEffects: 1 as const,
		runStatus: "complete" as const,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
}

function validateBudgetValue(value: unknown, path: string): D18BudgetStateV1 {
	const candidate = record(value, path);
	exactKeys(
		candidate,
		["actualCostMicrousd", "actualElapsedMs", "providerAttempts", "retryWaits"],
		path,
	);
	return Object.freeze({
		providerAttempts: safeInteger(candidate.providerAttempts, `${path}.providerAttempts`, {
			max: D18_LIMITS.maxProviderAttempts,
		}),
		retryWaits: safeInteger(candidate.retryWaits, `${path}.retryWaits`, {
			max: D18_LIMITS.maxRetryWaits,
		}),
		actualCostMicrousd: safeInteger(candidate.actualCostMicrousd, `${path}.actualCostMicrousd`, {
			max: D18_LIMITS.maxCostMicrousd,
		}),
		actualElapsedMs: safeInteger(candidate.actualElapsedMs, `${path}.actualElapsedMs`, {
			max: D18_LIMITS.maxElapsedMs,
		}),
	});
}

export function snapshotD18Evidence(authority: D18AuthorityV1): D18EvidenceV1 {
	const state = stateFor(authority);
	if (!state.finished || state.active !== null || state.providerContext !== null)
		throw new TypeError("D18 evidence is not complete");
	const material = evidenceMaterial(state);
	return Object.freeze({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}

function assertD18Fact(value: unknown, index: number): D18ProviderFactV1 {
	const fact = record(value, `D18 facts[${index}]`);
	exactKeys(
		fact,
		["admission", "factDigest", "reconciliation", "request", "result", "schemaVersion", "sequence"],
		`D18 facts[${index}]`,
	);
	if (fact.schemaVersion !== "graphrefly-ts.d18.provider-fact.v1" || fact.sequence !== index)
		throw new TypeError("D18 fact sequence/schema drifted");
	const request = record(fact.request, `D18 facts[${index}].request`);
	const admissionValue = record(fact.admission, `D18 facts[${index}].admission`);
	const result = record(fact.result, `D18 facts[${index}].result`);
	const reconciliation = record(fact.reconciliation, `D18 facts[${index}].reconciliation`);
	const requestPath = `D18 facts[${index}].request`;
	const requestSchema = oneOf(
		request.schemaVersion,
		["graphrefly-ts.d18.provider-attempt-request.v1", "graphrefly-ts.d18.retry-wait-request.v1"],
		`${requestPath}.schemaVersion`,
	);
	if (requestSchema === "graphrefly-ts.d18.provider-attempt-request.v1") {
		exactKeys(
			request,
			[
				"arm",
				"attemptOrdinal",
				"logicalRequestDigest",
				"modelVisibleEnvelopeDigest",
				"namedToolChoice",
				"phase",
				"requestDigest",
				"reservation",
				"routeDigest",
				"schemaVersion",
				"sequence",
				"wireBodyDigest",
				"workflowAdmissionDigest",
				"workflowRequestDigest",
			],
			requestPath,
		);
		oneOf(request.arm, D17_ARMS, `${requestPath}.arm`);
		oneOf(request.phase, ["inspection", "mutation"], `${requestPath}.phase`);
		safeInteger(request.attemptOrdinal, `${requestPath}.attemptOrdinal`, { min: 1, max: 2 });
		for (const key of [
			"logicalRequestDigest",
			"modelVisibleEnvelopeDigest",
			"requestDigest",
			"routeDigest",
			"wireBodyDigest",
			"workflowAdmissionDigest",
			"workflowRequestDigest",
		])
			digest(request[key], `${requestPath}.${key}`);
		if (request.routeDigest !== D18_ROUTE.routeDigest)
			throw new TypeError("D18 request route drifted");
		if (request.namedToolChoice !== null && request.namedToolChoice !== "replace_exact")
			throw new TypeError("D18 named tool choice drifted");
		const reservation = record(request.reservation, `${requestPath}.reservation`);
		exactKeys(
			reservation,
			["maxCostMicrousd", "maxElapsedMs", "providerAttempts"],
			`${requestPath}.reservation`,
		);
		if (reservation.providerAttempts !== 1) throw new TypeError("D18 provider reservation drifted");
		safeInteger(reservation.maxCostMicrousd, `${requestPath}.reservation.maxCostMicrousd`, {
			max: D18_LIMITS.providerMaxCostMicrousd,
		});
		safeInteger(reservation.maxElapsedMs, `${requestPath}.reservation.maxElapsedMs`, {
			max: 240_000,
		});
	} else {
		exactKeys(
			request,
			[
				"arm",
				"delayMs",
				"logicalRequestDigest",
				"requestDigest",
				"reservation",
				"retryCause",
				"retryPolicy",
				"routeDigest",
				"schemaVersion",
				"sequence",
				"workflowRequestDigest",
			],
			requestPath,
		);
		oneOf(request.arm, D17_ARMS, `${requestPath}.arm`);
		const policy = oneOf(
			request.retryPolicy,
			["D671", "D675", "D710"],
			`${requestPath}.retryPolicy`,
		);
		const cause = oneOf(
			request.retryCause,
			["typed-rate-limit-or-503", "request-phase-und-err-socket", "untyped-http-429"],
			`${requestPath}.retryCause`,
		);
		const expected = {
			D671: "typed-rate-limit-or-503",
			D675: "request-phase-und-err-socket",
			D710: "untyped-http-429",
		} as const;
		if (cause !== expected[policy]) throw new TypeError("D18 retry discriminator drifted");
		for (const key of [
			"logicalRequestDigest",
			"requestDigest",
			"routeDigest",
			"workflowRequestDigest",
		])
			digest(request[key], `${requestPath}.${key}`);
		const delayMs = safeInteger(request.delayMs, `${requestPath}.delayMs`, { max: 60_000 });
		const reservation = record(request.reservation, `${requestPath}.reservation`);
		exactKeys(reservation, ["maxElapsedMs", "retryWaits"], `${requestPath}.reservation`);
		if (reservation.retryWaits !== 1 || reservation.maxElapsedMs !== delayMs)
			throw new TypeError("D18 retry reservation drifted");
	}
	const { requestDigest, ...requestBase } = request;
	if (requestDigest !== empiricalStrictJsonDigest(strictSnapshot(requestBase)))
		throw new TypeError("D18 request digest drifted");
	if (requestSchema === "graphrefly-ts.d18.provider-attempt-request.v1") {
		const status = oneOf(
			result.status,
			["completed", "failed"],
			`D18 facts[${index}].result.status`,
		);
		if (status === "completed") {
			exactKeys(
				result,
				[
					"actualCostMicrousd",
					"actualElapsedMs",
					"cacheReadTokens",
					"effectKind",
					"evidenceDigest",
					"inputTokens",
					"outputTokens",
					"status",
					"toolIntents",
					"wireBodyDigest",
				],
				`D18 facts[${index}].result`,
			);
			const intents = array(result.toolIntents, `D18 facts[${index}].result.toolIntents`);
			if (intents.length < 1 || intents.length > 4)
				throw new TypeError("D18 durable tool-intent cardinality drifted");
			for (let toolIndex = 0; toolIndex < intents.length; toolIndex += 1) {
				const intent = record(
					intents[toolIndex],
					`D18 facts[${index}].result.toolIntents[${toolIndex}]`,
				);
				exactKeys(
					intent,
					["argumentsBytes", "argumentsDigest", "toolRef"],
					`D18 facts[${index}].result.toolIntents[${toolIndex}]`,
				);
				oneOf(intent.toolRef, ["read-file", "replace-exact"], `D18 facts[${index}].toolRef`);
				digest(intent.argumentsDigest, `D18 facts[${index}].argumentsDigest`);
				safeInteger(intent.argumentsBytes, `D18 facts[${index}].argumentsBytes`, {
					min: 1,
					max: 131_072,
				});
			}
			for (const key of ["inputTokens", "outputTokens", "cacheReadTokens"])
				safeInteger(result[key], `D18 facts[${index}].result.${key}`, { max: 2_000_000 });
		} else {
			exactKeys(
				result,
				[
					"actualCostMicrousd",
					"actualElapsedMs",
					"costBasis",
					"effectKind",
					"evidenceDigest",
					"failureFamily",
					"retryProposal",
					"status",
					"wireBodyDigest",
				],
				`D18 facts[${index}].result`,
			);
			oneOf(
				result.failureFamily,
				["transport", "http", "executor"],
				`D18 facts[${index}].failureFamily`,
			);
			oneOf(
				result.costBasis,
				["reported", "conservative-reservation"],
				`D18 facts[${index}].costBasis`,
			);
			if (result.retryProposal !== null) {
				const proposal = record(result.retryProposal, `D18 facts[${index}].retryProposal`);
				exactKeys(proposal, ["cause", "delayMs", "policy"], `D18 facts[${index}].retryProposal`);
				oneOf(proposal.policy, ["D671", "D675", "D710"], `D18 facts[${index}].retryPolicy`);
				oneOf(
					proposal.cause,
					["typed-rate-limit-or-503", "request-phase-und-err-socket", "untyped-http-429"],
					`D18 facts[${index}].retryCause`,
				);
				safeInteger(proposal.delayMs, `D18 facts[${index}].retryDelay`, { max: 60_000 });
			}
		}
		if (
			result.effectKind !== "provider-attempt" ||
			result.wireBodyDigest !== request.wireBodyDigest
		)
			throw new TypeError("D18 provider result binding drifted");
		safeInteger(result.actualCostMicrousd, `D18 facts[${index}].result.actualCost`, {
			max: D18_LIMITS.providerMaxCostMicrousd,
		});
		safeInteger(result.actualElapsedMs, `D18 facts[${index}].result.actualElapsed`, {
			max: 240_000,
		});
		digest(result.evidenceDigest, `D18 facts[${index}].result.evidenceDigest`);
	} else {
		exactKeys(
			result,
			["actualElapsedMs", "effectKind", "evidenceDigest", "status"],
			`D18 facts[${index}].result`,
		);
		if (result.effectKind !== "retry-wait" || result.status !== "completed")
			throw new TypeError("D18 retry result drifted");
		safeInteger(result.actualElapsedMs, `D18 facts[${index}].result.actualElapsed`, {
			max: 60_000,
		});
		digest(result.evidenceDigest, `D18 facts[${index}].result.evidenceDigest`);
	}
	exactKeys(
		admissionValue,
		[
			"admissionDigest",
			"admitted",
			"budgetBefore",
			"prospectiveBudget",
			"requestDigest",
			"schemaVersion",
		],
		`D18 facts[${index}].admission`,
	);
	if (
		admissionValue.schemaVersion !== "graphrefly-ts.d18.effect-admission.v1" ||
		admissionValue.admitted !== true ||
		admissionValue.requestDigest !== requestDigest
	)
		throw new TypeError("D18 admission coordinates drifted");
	const budgetBefore = validateBudgetValue(
		admissionValue.budgetBefore,
		`D18 facts[${index}].admission.budgetBefore`,
	);
	const prospectiveBudget = validateBudgetValue(
		admissionValue.prospectiveBudget,
		`D18 facts[${index}].admission.prospectiveBudget`,
	);
	const reservation = request.reservation as Record<string, number>;
	const expectedProspective = Object.freeze({
		providerAttempts:
			budgetBefore.providerAttempts +
			(requestSchema === "graphrefly-ts.d18.provider-attempt-request.v1" ? 1 : 0),
		retryWaits:
			budgetBefore.retryWaits +
			(requestSchema === "graphrefly-ts.d18.retry-wait-request.v1" ? 1 : 0),
		actualCostMicrousd:
			budgetBefore.actualCostMicrousd +
			(requestSchema === "graphrefly-ts.d18.provider-attempt-request.v1"
				? reservation.maxCostMicrousd
				: 0),
		actualElapsedMs: budgetBefore.actualElapsedMs + reservation.maxElapsedMs,
	});
	if (
		empiricalStrictJsonDigest(prospectiveBudget) !== empiricalStrictJsonDigest(expectedProspective)
	)
		throw new TypeError("D18 prospective budget drifted");
	const { admissionDigest, ...admissionBase } = admissionValue;
	if (admissionDigest !== empiricalStrictJsonDigest(strictSnapshot(admissionBase)))
		throw new TypeError("D18 admission digest drifted");
	exactKeys(
		reconciliation,
		["actualCostMicrousd", "actualElapsedMs", "budgetAfter", "reconciliationDigest"],
		`D18 facts[${index}].reconciliation`,
	);
	safeInteger(reconciliation.actualCostMicrousd, `D18 facts[${index}].actualCost`, {
		max: D18_LIMITS.providerMaxCostMicrousd,
	});
	safeInteger(reconciliation.actualElapsedMs, `D18 facts[${index}].actualElapsed`, {
		max: 240_000,
	});
	const { reconciliationDigest, ...reconciliationBase } = reconciliation;
	if (reconciliationDigest !== empiricalStrictJsonDigest(strictSnapshot(reconciliationBase)))
		throw new TypeError("D18 reconciliation digest drifted");
	if (
		reconciliation.actualCostMicrousd !==
			(requestSchema === "graphrefly-ts.d18.provider-attempt-request.v1"
				? result.actualCostMicrousd
				: 0) ||
		reconciliation.actualElapsedMs !== result.actualElapsedMs
	)
		throw new TypeError("D18 result reconciliation drifted");
	validateBudgetValue(reconciliation.budgetAfter, `D18 facts[${index}].reconciliation.budgetAfter`);
	const base = strictSnapshot({
		schemaVersion: fact.schemaVersion,
		sequence: fact.sequence,
		request,
		admission: admissionValue,
		result,
		reconciliation,
	});
	if (fact.factDigest !== empiricalStrictJsonDigest(base))
		throw new TypeError("D18 fact digest drifted");
	return strictSnapshot(fact) as unknown as D18ProviderFactV1;
}

export function validateD18Evidence(value: unknown): D18EvidenceV1 {
	const candidate = record(value, "D18 evidence");
	exactKeys(
		candidate,
		[
			"authorityRevision",
			"baseline",
			"budget",
			"causalAttribution",
			"decisionRef",
			"efficacyClaim",
			"evidenceDigest",
			"limits",
			"liveGateEvaluated",
			"maxActiveEffects",
			"providerFacts",
			"route",
			"runStatus",
			"schemaVersion",
			"topology",
			"workflowEvidence",
		],
		"D18 evidence",
	);
	if (
		candidate.schemaVersion !== D18_EVIDENCE_SCHEMA ||
		candidate.decisionRef !== D18_DECISION_REF ||
		candidate.authorityRevision !== D18_AUTHORITY_REVISION ||
		candidate.maxActiveEffects !== 1 ||
		candidate.runStatus !== "complete" ||
		candidate.liveGateEvaluated !== false ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none"
	)
		throw new TypeError("D18 evidence coordinates drifted");
	const baselineValue = record(candidate.baseline, "D18 evidence.baseline");
	exactKeys(
		baselineValue,
		["commit", "d17BundleArtifactDigest", "d17ImplementationManifestDigest"],
		"D18 evidence.baseline",
	);
	const routeValue = record(candidate.route, "D18 evidence.route");
	exactKeys(
		routeValue,
		[
			"endpointClass",
			"maxOutputTokens",
			"model",
			"pricing",
			"provider",
			"providerTag",
			"reasoningEffort",
			"routeDigest",
			"schemaVersion",
			"selectedModel",
		],
		"D18 evidence.route",
	);
	const pricingValue = record(routeValue.pricing, "D18 evidence.route.pricing");
	exactKeys(
		pricingValue,
		[
			"cacheReadMicrousdPerMillion",
			"inputMicrousdPerMillion",
			"outputMicrousdPerMillion",
			"revision",
		],
		"D18 evidence.route.pricing",
	);
	const limitsValue = record(candidate.limits, "D18 evidence.limits");
	exactKeys(
		limitsValue,
		[
			"maxCostMicrousd",
			"maxElapsedMs",
			"maxProviderAttempts",
			"maxRetryWaits",
			"providerMaxCostMicrousd",
			"retryWaitMaxElapsedMs",
		],
		"D18 evidence.limits",
	);
	const topologyValue = record(candidate.topology, "D18 evidence.topology");
	exactKeys(
		topologyValue,
		["canonicalProjectionNode", "providerFactNode", "topologyDigest"],
		"D18 evidence.topology",
	);
	if (empiricalStrictJsonDigest(baselineValue) !== empiricalStrictJsonDigest(baseline()))
		throw new TypeError("D18 baseline drifted");
	if (empiricalStrictJsonDigest(routeValue) !== empiricalStrictJsonDigest(D18_ROUTE))
		throw new TypeError("D18 route drifted");
	if (empiricalStrictJsonDigest(limitsValue) !== empiricalStrictJsonDigest(D18_LIMITS))
		throw new TypeError("D18 limits drifted");
	if (empiricalStrictJsonDigest(topologyValue) !== empiricalStrictJsonDigest(topology()))
		throw new TypeError("D18 topology drifted");
	const workflowEvidence = validateD17Evidence(candidate.workflowEvidence);
	if (
		workflowEvidence.gate.definitionDigest !== D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST ||
		workflowEvidence.gate.evaluated !== false ||
		workflowEvidence.efficacyClaim !== "none"
	)
		throw new TypeError("D18 workflow gate drifted");
	const factValues = array(candidate.providerFacts, "D18 providerFacts");
	if (factValues.length < 12 || factValues.length > 120)
		throw new TypeError("D18 provider fact bound drifted");
	const facts = factValues.map(assertD18Fact);
	let budget: D18BudgetStateV1 = ZERO_BUDGET;
	const providerGroups = new Map<string, D18ProviderFactV1[]>();
	const workflowIndexByRequest = new Map(
		workflowEvidence.effectFacts.map((fact, index) => [fact.request.requestDigest, index] as const),
	);
	let nextWorkflowIndex = 0;
	const seenWorkflowRequests = new Set<string>();
	const admitLocalFactsBefore = (endIndex: number) => {
		for (; nextWorkflowIndex < endIndex; nextWorkflowIndex += 1) {
			const local = workflowEvidence.effectFacts[nextWorkflowIndex];
			if (local === undefined || local.request.effectKind === "provider-request")
				throw new TypeError("D18 workflow/provider ordering drifted");
			budget = Object.freeze({
				...budget,
				actualCostMicrousd: budget.actualCostMicrousd + local.result.actualCostMicrousd,
				actualElapsedMs: budget.actualElapsedMs + local.result.actualElapsedMs,
			});
		}
	};
	for (const fact of facts) {
		const workflowRequestDigest = fact.request.workflowRequestDigest;
		if (!seenWorkflowRequests.has(workflowRequestDigest)) {
			const workflowIndex = workflowIndexByRequest.get(workflowRequestDigest);
			if (workflowIndex === undefined)
				throw new TypeError("D18 provider fact references unknown workflow request");
			admitLocalFactsBefore(workflowIndex);
			seenWorkflowRequests.add(workflowRequestDigest);
		}
		if (
			empiricalStrictJsonDigest(fact.admission.budgetBefore) !== empiricalStrictJsonDigest(budget)
		)
			throw new TypeError("D18 admission budget chain drifted");
		budget = fact.reconciliation.budgetAfter;
		const request = fact.request;
		const key = request.workflowRequestDigest;
		const group = providerGroups.get(key) ?? [];
		group.push(fact);
		providerGroups.set(key, group);
		if (
			(fact.result.status === "completed" || fact.result.retryProposal === null) &&
			request.schemaVersion === "graphrefly-ts.d18.provider-attempt-request.v1"
		) {
			const workflowIndex = workflowIndexByRequest.get(key)!;
			nextWorkflowIndex = Math.max(nextWorkflowIndex, workflowIndex + 1);
		}
	}
	admitLocalFactsBefore(workflowEvidence.effectFacts.length);
	const candidateBudget = validateBudgetValue(candidate.budget, "D18 evidence.budget");
	if (empiricalStrictJsonDigest(candidateBudget) !== empiricalStrictJsonDigest(budget))
		throw new TypeError("D18 final budget drifted");
	const workflowProviderFacts = workflowEvidence.effectFacts.filter(
		(fact) => fact.request.effectKind === "provider-request",
	);
	if (providerGroups.size !== workflowProviderFacts.length)
		throw new TypeError("D18 provider/workflow bijection drifted");
	for (const workflowFact of workflowProviderFacts) {
		const group = providerGroups.get(workflowFact.request.requestDigest);
		if (group === undefined) throw new TypeError("D18 workflow provider result is unbound");
		const attempts = group.filter(
			(fact) => fact.request.schemaVersion === "graphrefly-ts.d18.provider-attempt-request.v1",
		);
		const waits = group.filter(
			(fact) => fact.request.schemaVersion === "graphrefly-ts.d18.retry-wait-request.v1",
		);
		if (attempts.length < 1 || attempts.length > 2 || waits.length !== attempts.length - 1)
			throw new TypeError("D18 retry cardinality drifted");
		const first = attempts[0]?.request as D18ProviderAttemptRequestV1;
		for (let index = 0; index < attempts.length; index += 1) {
			const request = attempts[index]?.request as D18ProviderAttemptRequestV1;
			if (
				request.attemptOrdinal !== index + 1 ||
				request.logicalRequestDigest !== first.logicalRequestDigest ||
				request.wireBodyDigest !== first.wireBodyDigest ||
				request.routeDigest !== first.routeDigest ||
				request.modelVisibleEnvelopeDigest !== first.modelVisibleEnvelopeDigest
			)
				throw new TypeError("D18 retry identity drifted");
		}
		const terminal = attempts.at(-1)?.result;
		if (
			workflowFact.result.effectKind !== "provider-request" ||
			(workflowFact.result.status === "completed") !== (terminal?.status === "completed")
		)
			throw new TypeError("D18 terminal provider outcome drifted");
	}
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		decisionRef: candidate.decisionRef,
		authorityRevision: candidate.authorityRevision,
		baseline: candidate.baseline,
		topology: candidate.topology,
		route: candidate.route,
		limits: candidate.limits,
		workflowEvidence,
		providerFacts: facts,
		budget: candidate.budget,
		maxActiveEffects: candidate.maxActiveEffects,
		runStatus: candidate.runStatus,
		liveGateEvaluated: candidate.liveGateEvaluated,
		causalAttribution: candidate.causalAttribution,
		efficacyClaim: candidate.efficacyClaim,
	});
	if (candidate.evidenceDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D18 evidence digest drifted");
	return Object.freeze({ ...material, evidenceDigest: candidate.evidenceDigest }) as D18EvidenceV1;
}

export function D18BodyDigestForTest(value: unknown): string {
	return empiricalStrictJsonDigest(value);
}

export function D18ArmOrderForTest(): readonly D17Arm[] {
	return D17_ARMS;
}
