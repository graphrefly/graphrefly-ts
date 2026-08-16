import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import type {
	CurrentGraphProviderAdmittedEffectV1,
	CurrentGraphProviderEffectResultInputV1,
} from "./d6-current-provider-authority.js";
import {
	D11_TRANSPORT_ENVELOPE_SCHEMA,
	D11_TRANSPORT_FACT_SCHEMA,
	D11_TRANSPORT_PROPOSAL_SCHEMA,
	type D11TransportCause,
	type D11TransportFailureProposalV1,
	type D11TransportPhase,
	type D11TransportResultEnvelopeV1,
	validD11TransportPhaseCause,
} from "./d11-current-transport-contract.js";

interface ProposalState {
	readonly proposal: D11TransportFailureProposalV1;
}

const proposals = new WeakMap<object, ProposalState>();

function ownDataInput(
	value: unknown,
	expectedKeys: readonly string[],
	path: string,
): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${path} must be a plain object`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null)
		throw new TypeError(`${path} must be a plain object`);
	if (Object.getOwnPropertySymbols(value).length !== 0)
		throw new TypeError(`${path} has symbol-owned properties`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const actual = Object.keys(descriptors).sort();
	const expected = [...expectedKeys].sort();
	if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
		throw new TypeError(`${path} keys drifted`);
	const captured: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of actual) {
		const descriptor = descriptors[key];
		if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true)
			throw new TypeError(`${path}.${key} must be an enumerable own data property`);
		captured[key] = descriptor.value;
	}
	return Object.freeze(captured);
}

function proposalMaterial(
	effect: CurrentGraphProviderAdmittedEffectV1,
	phase: D11TransportPhase,
	causeCode: D11TransportCause,
) {
	if (effect.request.effectKind !== "provider-request")
		throw new TypeError("D11 transport proposal requires a provider request");
	if (!validD11TransportPhaseCause(phase, causeCode))
		throw new TypeError("D11 transport phase/cause combination is invalid");
	if (effect.request.logicalRequestDigest === null || effect.request.workspaceStateDigest === null)
		throw new TypeError("D11 transport request provenance is incomplete");
	return strictSnapshot({
		schemaVersion: D11_TRANSPORT_PROPOSAL_SCHEMA,
		phase,
		causeCode,
		requestDigest: effect.request.requestDigest,
		admissionDigest: effect.admission.decisionDigest,
		logicalRequestDigest: effect.request.logicalRequestDigest,
		workspaceStateDigest: effect.request.workspaceStateDigest,
		reservationDigest: empiricalStrictJsonDigest(effect.request.reservation),
	});
}

function createProposal(
	effect: CurrentGraphProviderAdmittedEffectV1,
	phase: D11TransportPhase,
	causeCode: D11TransportCause,
): D11TransportFailureProposalV1 {
	const material = proposalMaterial(effect, phase, causeCode);
	const proposal = Object.freeze({
		...material,
		proposalDigest: empiricalStrictJsonDigest(material),
	}) as D11TransportFailureProposalV1;
	proposals.set(proposal, Object.freeze({ proposal }));
	return proposal;
}

export function consumeD11TransportProposal(
	value: unknown,
	effect: CurrentGraphProviderAdmittedEffectV1,
): D11TransportFailureProposalV1 {
	const captured = ownDataInput(
		value,
		[
			"admissionDigest",
			"causeCode",
			"logicalRequestDigest",
			"phase",
			"proposalDigest",
			"requestDigest",
			"reservationDigest",
			"schemaVersion",
			"workspaceStateDigest",
		],
		"D11 transport proposal",
	) as unknown as D11TransportFailureProposalV1;
	const state = proposals.get(value as object);
	if (state === undefined) throw new TypeError("D11 transport proposal is forged or replayed");
	proposals.delete(value as object);
	const expectedMaterial = proposalMaterial(effect, captured.phase, captured.causeCode);
	const expected = Object.freeze({
		...expectedMaterial,
		proposalDigest: empiricalStrictJsonDigest(expectedMaterial),
	});
	if (empiricalStrictJsonDigest(captured) !== empiricalStrictJsonDigest(expected))
		throw new TypeError("D11 transport proposal provenance drifted");
	return state.proposal;
}

function transportBoundaryInput(value: unknown): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("D11 transport boundary input must be a plain object");
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null)
		throw new TypeError("D11 transport boundary input must be a plain object");
	if (Object.getOwnPropertySymbols(value).length !== 0)
		throw new TypeError("D11 transport boundary input has symbol-owned properties");
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const required = ["effect", "invoke", "phase"];
	const allowed = new Set([...required, "callerSignal", "scheduleTimeout"]);
	const keys = Object.keys(descriptors);
	if (
		required.some((key) => !Object.hasOwn(descriptors, key)) ||
		keys.some((key) => !allowed.has(key))
	)
		throw new TypeError("D11 transport boundary input keys drifted");
	const captured: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		const descriptor = descriptors[key];
		if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true)
			throw new TypeError(
				`D11 transport boundary input.${key} must be an enumerable own data property`,
			);
		captured[key] = descriptor.value;
	}
	return Object.freeze(captured);
}

function codeFrom(error: unknown, depth = 0): string | null {
	if (depth > 2 || error === null || typeof error !== "object") return null;
	const code = Object.getOwnPropertyDescriptor(error, "code");
	if (code !== undefined && "value" in code && typeof code.value === "string") return code.value;
	const cause = Object.getOwnPropertyDescriptor(error, "cause");
	return cause !== undefined && "value" in cause ? codeFrom(cause.value, depth + 1) : null;
}

function causeFrom(error: unknown): D11TransportCause | null {
	const code = codeFrom(error);
	if (code === "UND_ERR_CONNECT_TIMEOUT") return "connect-timeout";
	if (code === "UND_ERR_HEADERS_TIMEOUT") return "headers-timeout";
	if (code === "UND_ERR_BODY_TIMEOUT") return "body-timeout";
	if (code === "UND_ERR_SOCKET" || code === "ECONNRESET") return "connection-reset";
	if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns-failure";
	return null;
}

function abortError(error: unknown): boolean {
	return (
		(error instanceof DOMException && error.name === "AbortError") ||
		(error instanceof Error && error.name === "AbortError")
	);
}

export function d11ConservativeTransportResult(
	effect: CurrentGraphProviderAdmittedEffectV1,
	phase: D11TransportPhase,
	causeCode: D11TransportCause,
): CurrentGraphProviderEffectResultInputV1 {
	return Object.freeze({
		effectKind: "provider-request" as const,
		status: "failed" as const,
		toolCalls: Object.freeze([]),
		failureCode: "provider-failed" as const,
		retryProposal: null,
		usage: Object.freeze({
			requests: 1 as const,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			actualCostMicrousd: effect.request.reservation.maxCostMicrousd,
			actualElapsedMs: effect.request.reservation.maxElapsedMs,
			costBasis: "conservative-reservation" as const,
		}),
		evidenceDigest: empiricalStrictJsonDigest({
			schemaVersion: D11_TRANSPORT_FACT_SCHEMA,
			requestDigest: effect.request.requestDigest,
			phase,
			causeCode,
		}),
	});
}

export async function executeD11TransportBoundary(inputValue: {
	readonly effect: CurrentGraphProviderAdmittedEffectV1;
	readonly phase: D11TransportPhase;
	readonly invoke: (signal: AbortSignal) => Promise<CurrentGraphProviderEffectResultInputV1>;
	readonly callerSignal?: AbortSignal;
	readonly scheduleTimeout?: (callback: () => void, milliseconds: number) => () => void;
}): Promise<D11TransportResultEnvelopeV1> {
	const input = transportBoundaryInput(inputValue);
	const effect = input.effect as CurrentGraphProviderAdmittedEffectV1;
	if (effect.request.effectKind !== "provider-request")
		throw new TypeError("D11 transport boundary requires a provider request");
	if (input.phase !== "request" && input.phase !== "response-body")
		throw new TypeError("D11 transport phase is invalid");
	if (typeof input.invoke !== "function") throw new TypeError("D11 transport invoke is invalid");
	const callerSignal = input.callerSignal as AbortSignal | undefined;
	if (callerSignal?.aborted) throw new DOMException("Caller cancelled", "AbortError");
	const controller = new AbortController();
	let deadlineTriggered = false;
	let callerAborted = false;
	const onCallerAbort = () => {
		callerAborted = true;
		controller.abort();
	};
	callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
	const schedule =
		(input.scheduleTimeout as
			| ((callback: () => void, milliseconds: number) => () => void)
			| undefined) ??
		((callback: () => void, milliseconds: number) => {
			const handle = setTimeout(callback, milliseconds);
			return () => clearTimeout(handle);
		});
	if (typeof schedule !== "function")
		throw new TypeError("D11 transport timeout scheduler is invalid");
	let cancelTimeout: (() => void) | null = null;
	try {
		cancelTimeout = schedule(() => {
			if (callerAborted) return;
			deadlineTriggered = true;
			controller.abort();
		}, effect.request.reservation.maxElapsedMs);
		if (typeof cancelTimeout !== "function")
			throw new TypeError("D11 transport timeout cancellation is invalid");
		const invoke = input.invoke as (
			signal: AbortSignal,
		) => Promise<CurrentGraphProviderEffectResultInputV1>;
		const result = await invoke(controller.signal);
		if (callerAborted) throw new DOMException("Caller cancelled", "AbortError");
		if (deadlineTriggered) {
			const phase = input.phase as D11TransportPhase;
			return Object.freeze({
				schemaVersion: D11_TRANSPORT_ENVELOPE_SCHEMA,
				result: d11ConservativeTransportResult(effect, phase, "owned-deadline"),
				transportProposal: createProposal(effect, phase, "owned-deadline"),
			});
		}
		return Object.freeze({
			schemaVersion: D11_TRANSPORT_ENVELOPE_SCHEMA,
			result,
			transportProposal: null,
		});
	} catch (error) {
		if (callerAborted) throw error;
		const causeCode = deadlineTriggered && abortError(error) ? "owned-deadline" : causeFrom(error);
		if (
			causeCode === null ||
			!validD11TransportPhaseCause(input.phase as D11TransportPhase, causeCode)
		)
			throw error;
		const phase = input.phase as D11TransportPhase;
		return Object.freeze({
			schemaVersion: D11_TRANSPORT_ENVELOPE_SCHEMA,
			result: d11ConservativeTransportResult(effect, phase, causeCode),
			transportProposal: createProposal(effect, phase, causeCode),
		});
	} finally {
		cancelTimeout?.();
		callerSignal?.removeEventListener("abort", onCallerAbort);
	}
}
