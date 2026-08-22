export const OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA =
	"graphrefly.private-solution-eval.openrouter-transport-failure-diagnostic.v1";

const OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES = Object.freeze({
	abort: "abort-err",
	connectionRefused: "econnrefused",
	connectionReset: "econnreset",
	connectTimeout: "und-err-connect-timeout",
	dnsAgain: "eai-again",
	dnsNotFound: "enotfound",
	pipe: "epipe",
	requestAborted: "und-err-aborted",
	requestBodyTimeout: "und-err-body-timeout",
	requestHeadersTimeout: "und-err-headers-timeout",
	socket: "und-err-socket",
	timedOut: "etimedout",
	unrecognized: "unrecognized",
});

type OpenRouterTransportFailureCauseCode =
	(typeof OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES)[keyof typeof OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES];

export interface OpenRouterTransportFailureDiagnosticV1 {
	readonly schemaVersion: typeof OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA;
	readonly phase: "request" | "response-body";
	readonly causeCode: OpenRouterTransportFailureCauseCode;
}

const normalizedCauseCode = new Map<string, OpenRouterTransportFailureCauseCode>([
	["ABORT_ERR", OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.abort],
	["ECONNREFUSED", OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.connectionRefused],
	["ECONNRESET", OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.connectionReset],
	["EAI_AGAIN", OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.dnsAgain],
	["ENOTFOUND", OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.dnsNotFound],
	["EPIPE", OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.pipe],
	["ETIMEDOUT", OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.timedOut],
	["UND_ERR_ABORTED", OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.requestAborted],
	["UND_ERR_BODY_TIMEOUT", OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.requestBodyTimeout],
	["UND_ERR_CONNECT_TIMEOUT", OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.connectTimeout],
	["UND_ERR_HEADERS_TIMEOUT", OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.requestHeadersTimeout],
	["UND_ERR_SOCKET", OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.socket],
]);

class OpenRouterTransportFailure extends TypeError {
	readonly diagnostic: OpenRouterTransportFailureDiagnosticV1;

	constructor(phase: unknown, error: unknown) {
		super("OpenRouter byte transport failed");
		this.name = "OpenRouterTransportFailure";
		this.diagnostic = Object.freeze({
			schemaVersion: OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA,
			phase: transportFailurePhase(phase),
			causeCode: transportFailureCauseCode(error),
		});
		Object.freeze(this);
	}
}

function ownDataProperty(value: unknown, key: PropertyKey): unknown {
	if ((typeof value !== "object" && typeof value !== "function") || value === null)
		return undefined;
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
	} catch {
		return undefined;
	}
}

function transportFailurePhase(value: unknown): OpenRouterTransportFailureDiagnosticV1["phase"] {
	if (value === "request" || value === "response-body") return value;
	throw new TypeError("Invalid OpenRouter transport failure phase");
}

function transportFailureCauseCode(error: unknown): OpenRouterTransportFailureCauseCode {
	const direct = ownDataProperty(error, "code");
	if (typeof direct === "string") {
		const normalized = normalizedCauseCode.get(direct);
		if (normalized !== undefined) return normalized;
	}
	const cause = ownDataProperty(error, "cause");
	const nested = ownDataProperty(cause, "code");
	return typeof nested === "string"
		? (normalizedCauseCode.get(nested) ?? OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.unrecognized)
		: OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.unrecognized;
}

export function createOpenRouterTransportFailure(phase: unknown, error: unknown): TypeError {
	return new OpenRouterTransportFailure(phase, error);
}

export function readOpenRouterTransportFailureDiagnostic(
	error: unknown,
): OpenRouterTransportFailureDiagnosticV1 | null {
	try {
		if (!(error instanceof OpenRouterTransportFailure)) return null;
		const diagnostic = ownDataProperty(error, "diagnostic");
		if (typeof diagnostic !== "object" || diagnostic === null) return null;
		const keys = Reflect.ownKeys(diagnostic);
		if (
			keys.length !== 3 ||
			!keys.includes("schemaVersion") ||
			!keys.includes("phase") ||
			!keys.includes("causeCode")
		) {
			return null;
		}
		const schemaVersion = ownDataProperty(diagnostic, "schemaVersion");
		const phase = ownDataProperty(diagnostic, "phase");
		const causeCode = ownDataProperty(diagnostic, "causeCode");
		if (
			schemaVersion !== OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA ||
			(phase !== "request" && phase !== "response-body") ||
			typeof causeCode !== "string" ||
			![
				...normalizedCauseCode.values(),
				OPENROUTER_TRANSPORT_FAILURE_CAUSE_CODES.unrecognized,
			].includes(causeCode as OpenRouterTransportFailureCauseCode)
		) {
			return null;
		}
		return diagnostic as OpenRouterTransportFailureDiagnosticV1;
	} catch {
		return null;
	}
}
