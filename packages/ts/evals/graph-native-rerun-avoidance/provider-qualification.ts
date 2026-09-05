import { depBatch } from "../../src/ctx/types.js";
import { Graph } from "../../src/graph/graph.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
} from "./canonical.js";
import { CURRENT_ROOT_EVAL_PROVIDER_ROUTE } from "./current-provider-route.js";

// D155: qualification is not an efficacy campaign. No experimental task is loaded.
export const PROVIDER_QUALIFICATION_REF = "provider-qualification-together-2026-09-03-1";
export const PROVIDER_QUALIFICATION_CAP = 100_000;
export const PROVIDER_QUALIFICATION_REQUEST_CAP = 3;
export const PROVIDER_QUALIFICATION_RESERVATION = 33_333;
export const PROVIDER_QUALIFICATION_ROUTE = Object.freeze({
	providerRef: CURRENT_ROOT_EVAL_PROVIDER_ROUTE.providerRef,
	providerModelRef: CURRENT_ROOT_EVAL_PROVIDER_ROUTE.modelRef,
});
const CURRENT_QUALIFICATION_SETTLEMENT_POLICY = Object.freeze({
	requestCap: PROVIDER_QUALIFICATION_REQUEST_CAP,
	reservationMicrousd: PROVIDER_QUALIFICATION_RESERVATION,
	totalCapMicrousd: PROVIDER_QUALIFICATION_CAP,
	stopOnUnusable: true,
});

export type QualificationOutcome = Readonly<{
	request: number;
	admissionDigest: string;
	responseDigest: string;
	status: number;
	usable: boolean;
	reason: string;
	providerReportedMicrousd: number | null;
	accountedMicrousd: number;
}>;
export type QualificationState = Readonly<{
	executionRef: string;
	outcomes: readonly QualificationOutcome[];
	accountedMicrousd: number;
	terminal: boolean;
	stopReason: "requests-complete" | "provider-rejected" | "budget-stopped" | null;
}>;
export type QualificationAdmission = Readonly<{
	executionRef: string;
	request: number;
	providerRef: string;
	providerModelRef: string;
	reservationMicrousd: number;
	requestDigest: string;
	admissionDigest: string;
}>;

export function qualificationAdmission(state: QualificationState): QualificationAdmission | null {
	if (state.terminal) return null;
	return makeAdmission(state.executionRef, state.outcomes.length + 1);
}
function makeAdmission(executionRef: string, request: number): QualificationAdmission {
	initialQualificationState(executionRef);
	if (!Number.isSafeInteger(request) || request < 1 || request > PROVIDER_QUALIFICATION_REQUEST_CAP)
		throw new TypeError("qualification request bound invalid");
	const value = {
		executionRef,
		request,
		...PROVIDER_QUALIFICATION_ROUTE,
		reservationMicrousd: PROVIDER_QUALIFICATION_RESERVATION,
		requestDigest: empiricalSha256(new TextEncoder().encode(qualificationRequestBody(request))),
	};
	return Object.freeze({ ...value, admissionDigest: empiricalStrictJsonDigest(value) });
}

export const QUALIFICATION_PRICING = Object.freeze({
	inputMicrousdPerMillionTokens: CURRENT_ROOT_EVAL_PROVIDER_ROUTE.inputMicrousdPerMillionTokens,
	outputMicrousdPerMillionTokens: CURRENT_ROOT_EVAL_PROVIDER_ROUTE.outputMicrousdPerMillionTokens,
	cacheReadMicrousdPerMillionTokens:
		CURRENT_ROOT_EVAL_PROVIDER_ROUTE.cacheReadMicrousdPerMillionTokens,
});
export const qualificationExamples = [
	{ candidateRefs: ["qualification-1-candidate-a", "qualification-1-candidate-b"], requested: 1 },
	{ candidateRefs: ["qualification-2-candidate-a", "qualification-2-candidate-b"], requested: 0 },
	{ candidateRefs: ["qualification-3-candidate-a", "qualification-3-candidate-b"], requested: 1 },
] as const;

export function qualificationCandidateCatalogDigest(request: number): string {
	const example = qualificationExamples[request - 1];
	if (example === undefined) throw new TypeError("qualification candidate catalog request invalid");
	return empiricalStrictJsonDigest({
		kind: "root-eval-d156-provider-qualification-candidate-catalog",
		request,
		candidateRefs: example.candidateRefs,
	});
}

function qualificationRequestBody(request: number): string {
	const example = qualificationExamples[request - 1];
	if (example === undefined) throw new TypeError("qualification wire rejected route or request");
	const body = JSON.stringify({
		model: PROVIDER_QUALIFICATION_ROUTE.providerModelRef,
		messages: [
			{
				role: "system",
				content:
					"This is a transport qualification, not an evaluation task. Return one allowed candidateRef in the required JSON shape. Do not use tools.",
			},
			{
				role: "user",
				content: `Select ${example.candidateRefs[example.requested]} from these two allowed refs: ${example.candidateRefs.join(", ")}.`,
			},
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "occurrence_bound_candidate_selection",
				strict: true,
				schema: {
					type: "object",
					additionalProperties: false,
					required: ["candidateRef"],
					properties: {
						candidateRef: { type: "string", enum: [...example.candidateRefs] },
					},
				},
			},
		},
		max_tokens: 16384,
		reasoning: { effort: "medium" },
		provider: {
			order: [...CURRENT_ROOT_EVAL_PROVIDER_ROUTE.requestProviderOrder],
			only: [...CURRENT_ROOT_EVAL_PROVIDER_ROUTE.requestProviderOrder],
			allow_fallbacks: false,
			require_parameters: true,
			data_collection: "deny",
			zdr: true,
		},
	});
	// Conservative bound: every input byte is a token, plus 4096 framing tokens;
	// completion includes the full admitted reasoning/output allowance.
	const bound = Math.ceil(
		((Buffer.byteLength(body) + 4096) * QUALIFICATION_PRICING.inputMicrousdPerMillionTokens +
			16384 * QUALIFICATION_PRICING.outputMicrousdPerMillionTokens) /
			1_000_000,
	);
	if (bound > PROVIDER_QUALIFICATION_RESERVATION)
		throw new TypeError("qualification wire exceeds reservation");
	return body;
}

export function qualificationWire(admission: QualificationAdmission): string {
	const expected = makeAdmission(admission.executionRef, admission.request);
	if (empiricalStrictJsonDigest(admission) !== empiricalStrictJsonDigest(expected))
		throw new TypeError("qualification wire admission drift");
	return qualificationRequestBody(admission.request);
}

export function initialQualificationState(executionRef: string): QualificationState {
	if (!/^provider-qualification-[a-z0-9-]{1,100}$/u.test(executionRef))
		throw new TypeError("qualification execution identity invalid");
	return Object.freeze({
		executionRef,
		outcomes: [],
		accountedMicrousd: 0,
		terminal: false,
		stopReason: null,
	});
}

function settleQualificationAgainstAdmission(
	state: QualificationState,
	raw: unknown,
	admission: QualificationAdmission | null,
	policy: Readonly<{
		readonly requestCap: number;
		readonly reservationMicrousd: number;
		readonly totalCapMicrousd: number;
		readonly stopOnUnusable: boolean;
	}>,
): QualificationState {
	const value = record(raw, "qualification outcome");
	exactKeys(
		value,
		[
			"request",
			"admissionDigest",
			"responseDigest",
			"status",
			"usable",
			"reason",
			"providerReportedMicrousd",
			"accountedMicrousd",
		],
		"qualification outcome",
	);
	const accountedMicrousd = safeInteger(value.accountedMicrousd, "qualification accounted cost");
	const reported =
		value.providerReportedMicrousd === null
			? null
			: safeInteger(value.providerReportedMicrousd, "qualification reported cost");
	if (
		admission === null ||
		value.request !== admission.request ||
		value.admissionDigest !== admission.admissionDigest ||
		!/^sha256:[a-f0-9]{64}$/u.test(String(value.responseDigest)) ||
		typeof value.usable !== "boolean" ||
		typeof value.reason !== "string" ||
		!/^[a-z0-9-]{1,100}$/u.test(value.reason) ||
		!Number.isSafeInteger(value.status) ||
		Number(value.status) < 0 ||
		Number(value.status) > 599 ||
		accountedMicrousd !== (reported ?? admission.reservationMicrousd) ||
		(value.usable && (reported === null || value.status !== 200))
	)
		throw new TypeError("qualification outcome lost exact admission or cost evidence");
	const outcomes = Object.freeze([
		...state.outcomes,
		Object.freeze({ ...value }) as QualificationOutcome,
	]);
	const spent = state.accountedMicrousd + accountedMicrousd;
	const stopReason =
		spent > policy.totalCapMicrousd
			? "budget-stopped"
			: policy.stopOnUnusable && !value.usable
				? "provider-rejected"
				: outcomes.length === policy.requestCap
					? "requests-complete"
					: spent + policy.reservationMicrousd > policy.totalCapMicrousd
						? "budget-stopped"
						: null;
	return Object.freeze({
		executionRef: state.executionRef,
		outcomes,
		accountedMicrousd: spent,
		terminal: stopReason !== null,
		stopReason,
	});
}

export function settleQualification(state: QualificationState, raw: unknown): QualificationState {
	return settleQualificationAgainstAdmission(
		state,
		raw,
		qualificationAdmission(state),
		CURRENT_QUALIFICATION_SETTLEMENT_POLICY,
	);
}

/** Reconstruct receipts rather than trusting a terminal/spend flag supplied by a caller. */
export function validateQualificationState(raw: unknown): QualificationState {
	const value = record(raw, "qualification state");
	exactKeys(
		value,
		["executionRef", "outcomes", "accountedMicrousd", "terminal", "stopReason"],
		"qualification state",
	);
	if (
		typeof value.executionRef !== "string" ||
		!Array.isArray(value.outcomes) ||
		value.outcomes.length > PROVIDER_QUALIFICATION_REQUEST_CAP
	)
		throw new TypeError("qualification state bounds invalid");
	let checked = initialQualificationState(value.executionRef);
	for (const outcome of value.outcomes) checked = settleQualification(checked, outcome);
	if (empiricalStrictJsonDigest(value) !== empiricalStrictJsonDigest(checked))
		throw new TypeError("qualification state conservation invalid");
	return checked;
}

const ROOT_EVAL_HISTORICAL_QUALIFICATION_V1_PATH = "qualification.ts" as const;
export const ROOT_EVAL_HISTORICAL_QUALIFICATION_V1_CONTRACT = Object.freeze({
	executionRef: "provider-qualification-together-2026-09-03-1",
	providerRef: "together",
	providerModelRef: "deepseek/deepseek-v4-flash-0731",
	requestCap: 3,
	reservationMicrousd: 33_333,
	totalCapMicrousd: 100_000,
	stopOnUnusable: true,
});
const ROOT_EVAL_HISTORICAL_QUALIFICATION_V1_EXAMPLES = Object.freeze([
	Object.freeze(["export const value = 1;", "export const value = 2;"]),
	Object.freeze(["\treturn left + right;", "\treturn left - right;"]),
	Object.freeze(["const enabled = false;\r\n", "const enabled = true;\r\n"]),
]);

function historicalQualificationV1RequestBody(request: number): string {
	const example = ROOT_EVAL_HISTORICAL_QUALIFICATION_V1_EXAMPLES[request - 1];
	if (example === undefined) throw new TypeError("historical qualification request invalid");
	return JSON.stringify({
		model: ROOT_EVAL_HISTORICAL_QUALIFICATION_V1_CONTRACT.providerModelRef,
		messages: [
			{
				role: "system",
				content:
					"This is a transport qualification, not an evaluation task. Return exactly the requested replacement JSON. Copy the provided strings exactly, preserving whitespace. Do not use tools.",
			},
			{
				role: "user",
				content: `Return this exact object: ${JSON.stringify({
					path: ROOT_EVAL_HISTORICAL_QUALIFICATION_V1_PATH,
					oldText: example[0],
					newText: example[1],
				})}`,
			},
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "exact_replacement_proposal",
				strict: true,
				schema: {
					type: "object",
					additionalProperties: false,
					required: ["path", "oldText", "newText"],
					properties: {
						path: { type: "string", enum: [ROOT_EVAL_HISTORICAL_QUALIFICATION_V1_PATH] },
						oldText: { type: "string", minLength: 1, maxLength: 32768 },
						newText: { type: "string", maxLength: 32768 },
					},
				},
			},
		},
		max_tokens: 16384,
		reasoning: { effort: "medium" },
		provider: {
			order: ["together"],
			only: ["together"],
			allow_fallbacks: false,
			require_parameters: true,
			data_collection: "deny",
			zdr: true,
		},
	});
}

function historicalQualificationV1Admission(
	state: QualificationState,
): QualificationAdmission | null {
	if (state.terminal) return null;
	const request = state.outcomes.length + 1;
	const value = {
		executionRef: state.executionRef,
		request,
		providerRef: ROOT_EVAL_HISTORICAL_QUALIFICATION_V1_CONTRACT.providerRef,
		providerModelRef: ROOT_EVAL_HISTORICAL_QUALIFICATION_V1_CONTRACT.providerModelRef,
		reservationMicrousd: ROOT_EVAL_HISTORICAL_QUALIFICATION_V1_CONTRACT.reservationMicrousd,
		requestDigest: empiricalSha256(
			new TextEncoder().encode(historicalQualificationV1RequestBody(request)),
		),
	};
	return Object.freeze({ ...value, admissionDigest: empiricalStrictJsonDigest(value) });
}

/** D157 audit-only reconstruction of the exact pre-candidate qualification contract. */
export function validateHistoricalQualificationStateV1(raw: unknown): QualificationState {
	const value = record(raw, "historical qualification v1 state");
	exactKeys(
		value,
		["executionRef", "outcomes", "accountedMicrousd", "terminal", "stopReason"],
		"historical qualification v1 state",
	);
	if (
		value.executionRef !== ROOT_EVAL_HISTORICAL_QUALIFICATION_V1_CONTRACT.executionRef ||
		!Array.isArray(value.outcomes) ||
		value.outcomes.length > ROOT_EVAL_HISTORICAL_QUALIFICATION_V1_CONTRACT.requestCap
	)
		throw new TypeError("historical qualification v1 state bounds invalid");
	let checked = initialQualificationState(value.executionRef);
	for (const outcome of value.outcomes)
		checked = settleQualificationAgainstAdmission(
			checked,
			outcome,
			historicalQualificationV1Admission(checked),
			ROOT_EVAL_HISTORICAL_QUALIFICATION_V1_CONTRACT,
		);
	if (empiricalStrictJsonDigest(value) !== empiricalStrictJsonDigest(checked))
		throw new TypeError("historical qualification v1 state conservation invalid");
	return checked;
}

export function createProviderQualificationGraph(executionRef: string) {
	const graph = new Graph({ name: "provider-qualification" });
	const input = graph.node<{ kind: "start" } | { kind: "outcome"; outcome: QualificationOutcome }>(
		[],
		null,
		{
			name: "qualification/ingress",
			factory: "qualificationFacts",
		},
	);
	const state = graph.node<QualificationState>(
		[input],
		(ctx) => {
			let current = ctx.state.get<QualificationState>();
			for (const raw of depBatch(ctx, 0) ?? []) {
				const fact = raw as { kind: "start" } | { kind: "outcome"; outcome: QualificationOutcome };
				if (fact.kind === "start") {
					if (current !== undefined) throw new TypeError("qualification start replay");
					current = initialQualificationState(executionRef);
				} else {
					if (current === undefined) throw new TypeError("qualification outcome before start");
					current = settleQualification(current, fact.outcome);
				}
			}
			if (current !== undefined) {
				ctx.state.set(current);
				ctx.down([["DATA", current]]);
			}
		},
		{
			name: "qualification/request-settlement",
			factory: "qualificationSettlement",
			meta: { purpose: "provider-capability-only", efficacyClaim: "none" },
		},
	);
	const budget = graph.derived(
		[state],
		(value) => ({
			state: value,
			remainingMicrousd: PROVIDER_QUALIFICATION_CAP - value.accountedMicrousd,
		}),
		{
			name: "qualification/budget",
			meta: { maxRequests: 3, hardCapMicrousd: PROVIDER_QUALIFICATION_CAP },
		},
	);
	const admission = graph.derived([budget], ({ state: value }) => qualificationAdmission(value), {
		name: "qualification/provider-admission",
		meta: { ...PROVIDER_QUALIFICATION_ROUTE, concurrency: 1, fallback: false },
	});
	const terminal = graph.derived([state], (value) => (value.terminal ? value : null), {
		name: "qualification/terminal",
	});
	const releases = [graph.retain(admission), graph.retain(terminal)];
	return {
		graph,
		input,
		state,
		admission,
		terminal,
		dispose: () => {
			for (const release of releases) release();
		},
	};
}
