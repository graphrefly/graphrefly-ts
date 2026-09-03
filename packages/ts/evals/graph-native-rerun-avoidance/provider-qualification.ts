import { depBatch } from "../../src/ctx/types.js";
import { Graph } from "../../src/graph/graph.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
} from "./canonical.js";

// D155: qualification is not an efficacy campaign. No experimental task is loaded.
export const PROVIDER_QUALIFICATION_REF = "provider-qualification-together-2026-09-03-1";
export const PROVIDER_QUALIFICATION_CAP = 100_000;
export const PROVIDER_QUALIFICATION_REQUEST_CAP = 3;
export const PROVIDER_QUALIFICATION_RESERVATION = 33_333;
export const PROVIDER_QUALIFICATION_ROUTE = Object.freeze({
	providerRef: "together",
	providerModelRef: "deepseek/deepseek-v4-flash-0731",
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
	if (!Number.isSafeInteger(request) || request < 1 || request > 3)
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
	inputMicrousdPerMillionTokens: 140_000,
	outputMicrousdPerMillionTokens: 280_000,
	cacheReadMicrousdPerMillionTokens: 30_000,
});
export const qualificationPath = "qualification.ts";
export const qualificationExamples = [
	["export const value = 1;", "export const value = 2;"],
	["\treturn left + right;", "\treturn left - right;"],
	["const enabled = false;\r\n", "const enabled = true;\r\n"],
] as const;

function qualificationRequestBody(request: number): string {
	const example = qualificationExamples[request - 1];
	if (example === undefined) throw new TypeError("qualification wire rejected route or request");
	const body = JSON.stringify({
		model: PROVIDER_QUALIFICATION_ROUTE.providerModelRef,
		messages: [
			{
				role: "system",
				content:
					"This is a transport qualification, not an evaluation task. Return exactly the requested replacement JSON. Copy the provided strings exactly, preserving whitespace. Do not use tools.",
			},
			{
				role: "user",
				content: `Return this exact object: ${JSON.stringify({ path: qualificationPath, oldText: example[0], newText: example[1] })}`,
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
						path: { type: "string", enum: [qualificationPath] },
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

export function settleQualification(state: QualificationState, raw: unknown): QualificationState {
	const admission = qualificationAdmission(state);
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
		spent > PROVIDER_QUALIFICATION_CAP
			? "budget-stopped"
			: !value.usable
				? "provider-rejected"
				: outcomes.length === PROVIDER_QUALIFICATION_REQUEST_CAP
					? "requests-complete"
					: spent + PROVIDER_QUALIFICATION_RESERVATION > PROVIDER_QUALIFICATION_CAP
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
