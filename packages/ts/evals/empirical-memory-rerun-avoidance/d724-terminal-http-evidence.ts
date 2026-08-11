import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import type { Node } from "../../src/node/node.js";
import {
	array,
	boolean,
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

export const D724_TERMINAL_HTTP_EVIDENCE_SCHEMA =
	"graphrefly.b112.d724.terminal-http-evidence.v1" as const;
export const D724_TERMINAL_HTTP_ADMISSION_SCHEMA =
	"graphrefly.b112.d724.terminal-http-admission.v1" as const;
export const D724_TERMINAL_HTTP_GRAPH_EVIDENCE_SCHEMA =
	"graphrefly.b112.d724.terminal-http-graph-evidence.v1" as const;
const D724_MAX_TERMINAL_HTTP_FACTS = 256;

export interface D724TerminalHttpEvidenceV1 {
	readonly schemaVersion: typeof D724_TERMINAL_HTTP_EVIDENCE_SCHEMA;
	readonly httpStatus: number;
	readonly statusClass: "4xx" | "5xx" | "other";
	readonly mediaTypeDisposition:
		| "application-json"
		| "text-json"
		| "text"
		| "html"
		| "absent"
		| "other"
		| "unavailable";
	readonly bodyShape:
		| "empty"
		| "error-envelope"
		| "json-object"
		| "json-array"
		| "text"
		| "invalid-utf8";
	readonly recognizedTypePresent: boolean;
	readonly recognizedCodePresent: boolean;
	readonly retryAfterDisposition: "absent" | "parsed" | "invalid" | "unavailable";
	readonly responseDigest: string;
	readonly evidenceDigest: string;
}

export interface D724TerminalHttpAdmissionV1 {
	readonly schemaVersion: typeof D724_TERMINAL_HTTP_ADMISSION_SCHEMA;
	readonly effectRequestDigest: string;
	readonly effectAdmissionDigest: string;
	readonly providerResultDigest: string;
	readonly terminalHttpEvidence: D724TerminalHttpEvidenceV1;
	readonly admissionDigest: string;
}

export interface D724TerminalHttpGraphEvidenceV1 {
	readonly schemaVersion: typeof D724_TERMINAL_HTTP_GRAPH_EVIDENCE_SCHEMA;
	readonly facts: readonly D724TerminalHttpAdmissionV1[];
	readonly evidenceDigest: string;
}

export interface D724TerminalHttpAuthorityV1 {
	readonly revision: "graphrefly.b112.d724.terminal-http-authority.v1";
}

interface AuthorityState {
	readonly proposalNode: Node<unknown>;
	readonly facts: D724TerminalHttpAdmissionV1[];
}

const constructedAuthorities = new WeakMap<object, AuthorityState>();

function statusClass(status: number): D724TerminalHttpEvidenceV1["statusClass"] {
	if (status >= 400 && status <= 499) return "4xx";
	if (status >= 500 && status <= 599) return "5xx";
	return "other";
}

function bodyProjection(
	bytes: Uint8Array,
): Pick<
	D724TerminalHttpEvidenceV1,
	"bodyShape" | "recognizedCodePresent" | "recognizedTypePresent"
> {
	if (bytes.byteLength === 0)
		return Object.freeze({
			bodyShape: "empty" as const,
			recognizedCodePresent: false,
			recognizedTypePresent: false,
		});
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return Object.freeze({
			bodyShape: "invalid-utf8" as const,
			recognizedCodePresent: false,
			recognizedTypePresent: false,
		});
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return Object.freeze({
			bodyShape: "text" as const,
			recognizedCodePresent: false,
			recognizedTypePresent: false,
		});
	}
	if (Array.isArray(parsed))
		return Object.freeze({
			bodyShape: "json-array" as const,
			recognizedCodePresent: false,
			recognizedTypePresent: false,
		});
	if (typeof parsed !== "object" || parsed === null)
		return Object.freeze({
			bodyShape: "text" as const,
			recognizedCodePresent: false,
			recognizedTypePresent: false,
		});
	const root = parsed as Record<string, unknown>;
	const error =
		typeof root.error === "object" && root.error !== null
			? (root.error as Record<string, unknown>)
			: null;
	return Object.freeze({
		bodyShape: error === null ? ("json-object" as const) : ("error-envelope" as const),
		recognizedCodePresent:
			typeof error?.code === "string" ||
			typeof error?.code === "number" ||
			typeof root.code === "string" ||
			typeof root.code === "number",
		recognizedTypePresent: typeof error?.type === "string" || typeof root.type === "string",
	});
}

export function createD724TerminalHttpEvidence(inputValue: {
	readonly httpStatus: number;
	readonly mediaTypeDisposition: D724TerminalHttpEvidenceV1["mediaTypeDisposition"];
	readonly retryAfterDisposition: D724TerminalHttpEvidenceV1["retryAfterDisposition"];
	readonly responseBytes: Uint8Array;
}): D724TerminalHttpEvidenceV1 {
	const input = record(inputValue, "d724.terminalHttpInput");
	exactKeys(
		input,
		["httpStatus", "mediaTypeDisposition", "responseBytes", "retryAfterDisposition"],
		"d724.terminalHttpInput",
	);
	const httpStatus = safeInteger(input.httpStatus, "d724.httpStatus", { min: 100, max: 599 });
	if (httpStatus === 200)
		throw new TypeError("D724 terminal HTTP evidence cannot describe success");
	const mediaTypeDisposition = oneOf(
		input.mediaTypeDisposition,
		["application-json", "text-json", "text", "html", "absent", "other", "unavailable"] as const,
		"d724.mediaTypeDisposition",
	);
	const retryAfterDisposition = oneOf(
		input.retryAfterDisposition,
		["absent", "parsed", "invalid", "unavailable"] as const,
		"d724.retryAfterDisposition",
	);
	if (!(input.responseBytes instanceof Uint8Array))
		throw new TypeError("D724 response bytes must be Uint8Array");
	const responseBytes = new Uint8Array(input.responseBytes);
	if (responseBytes.byteLength > 1_048_576)
		throw new TypeError("D724 response bytes exceed the bound");
	const body = bodyProjection(responseBytes);
	const material = strictSnapshot({
		schemaVersion: D724_TERMINAL_HTTP_EVIDENCE_SCHEMA,
		httpStatus,
		statusClass: statusClass(httpStatus),
		mediaTypeDisposition,
		...body,
		retryAfterDisposition,
		responseDigest: empiricalSha256(responseBytes),
	});
	return strictSnapshot({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D724TerminalHttpEvidenceV1;
}

export function validateD724TerminalHttpEvidence(value: unknown): D724TerminalHttpEvidenceV1 {
	const candidate = record(value, "d724.terminalHttpEvidence");
	exactKeys(
		candidate,
		[
			"bodyShape",
			"evidenceDigest",
			"httpStatus",
			"mediaTypeDisposition",
			"recognizedCodePresent",
			"recognizedTypePresent",
			"responseDigest",
			"retryAfterDisposition",
			"schemaVersion",
			"statusClass",
		],
		"d724.terminalHttpEvidence",
	);
	literal(candidate.schemaVersion, D724_TERMINAL_HTTP_EVIDENCE_SCHEMA, "d724.schema");
	const httpStatus = safeInteger(candidate.httpStatus, "d724.httpStatus", { min: 100, max: 599 });
	if (httpStatus === 200) throw new TypeError("D724 terminal HTTP status cannot be 200");
	literal(candidate.statusClass, statusClass(httpStatus), "d724.statusClass");
	oneOf(
		candidate.mediaTypeDisposition,
		["application-json", "text-json", "text", "html", "absent", "other", "unavailable"] as const,
		"d724.mediaTypeDisposition",
	);
	oneOf(
		candidate.bodyShape,
		["empty", "error-envelope", "json-object", "json-array", "text", "invalid-utf8"] as const,
		"d724.bodyShape",
	);
	boolean(candidate.recognizedTypePresent, "d724.recognizedTypePresent");
	boolean(candidate.recognizedCodePresent, "d724.recognizedCodePresent");
	oneOf(
		candidate.retryAfterDisposition,
		["absent", "parsed", "invalid", "unavailable"] as const,
		"d724.retryAfterDisposition",
	);
	digest(candidate.responseDigest, "d724.responseDigest");
	const evidenceDigest = digest(candidate.evidenceDigest, "d724.evidenceDigest");
	const { evidenceDigest: _ignored, ...material } = candidate;
	literal(evidenceDigest, empiricalStrictJsonDigest(material), "d724.evidenceDigest");
	return strictSnapshot(candidate) as unknown as D724TerminalHttpEvidenceV1;
}

export function validateD724TerminalHttpAdmission(value: unknown): D724TerminalHttpAdmissionV1 {
	const candidate = record(value, "d724.terminalHttpAdmission");
	exactKeys(
		candidate,
		[
			"admissionDigest",
			"effectAdmissionDigest",
			"effectRequestDigest",
			"providerResultDigest",
			"schemaVersion",
			"terminalHttpEvidence",
		],
		"d724.terminalHttpAdmission",
	);
	literal(
		candidate.schemaVersion,
		D724_TERMINAL_HTTP_ADMISSION_SCHEMA,
		"d724.terminalHttpAdmission.schema",
	);
	digest(candidate.effectRequestDigest, "d724.effectRequestDigest");
	digest(candidate.effectAdmissionDigest, "d724.effectAdmissionDigest");
	digest(candidate.providerResultDigest, "d724.providerResultDigest");
	validateD724TerminalHttpEvidence(candidate.terminalHttpEvidence);
	const admissionDigest = digest(candidate.admissionDigest, "d724.admissionDigest");
	const { admissionDigest: _ignored, ...material } = candidate;
	literal(admissionDigest, empiricalStrictJsonDigest(material), "d724.admissionDigest");
	return strictSnapshot(candidate) as unknown as D724TerminalHttpAdmissionV1;
}

function authorityState(value: unknown): AuthorityState {
	if (typeof value !== "object" || value === null)
		throw new TypeError("D724 terminal HTTP authority is invalid");
	const state = constructedAuthorities.get(value);
	if (state === undefined)
		throw new TypeError("D724 terminal HTTP authority is not Graph-constructed");
	return state;
}

export function createD724TerminalHttpAuthority(): D724TerminalHttpAuthorityV1 {
	const owner = graph({ name: "d724/terminal-http-authority" });
	const proposalNode = owner.node<unknown>([], null, { name: "d724/terminal-http-proposals" });
	const admissionNode = owner.node<D724TerminalHttpAdmissionV1>(
		[proposalNode],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? [])
				ctx.down([["DATA", validateD724TerminalHttpAdmission(raw)]]);
		},
		{ name: "d724/terminal-http-admissions", factory: "d724TerminalHttpAdmission" },
	);
	const facts: D724TerminalHttpAdmissionV1[] = [];
	admissionNode.subscribe((message) => {
		if (message[0] !== "DATA") return;
		if (facts.length >= D724_MAX_TERMINAL_HTTP_FACTS)
			throw new TypeError("D724 terminal HTTP fact bound exhausted");
		const fact = message[1] as D724TerminalHttpAdmissionV1;
		if (
			facts.some(
				(candidate) =>
					candidate.effectAdmissionDigest === fact.effectAdmissionDigest ||
					candidate.providerResultDigest === fact.providerResultDigest,
			)
		)
			throw new TypeError("D724 terminal HTTP fact was already admitted");
		facts.push(fact);
	});
	const capability = Object.freeze({
		revision: "graphrefly.b112.d724.terminal-http-authority.v1" as const,
	});
	constructedAuthorities.set(capability, { proposalNode, facts });
	return capability;
}

export function admitD724TerminalHttpEvidence(
	authority: D724TerminalHttpAuthorityV1,
	inputValue: {
		readonly effectRequestDigest: string;
		readonly effectAdmissionDigest: string;
		readonly providerResultDigest: string;
		readonly terminalHttpEvidence: D724TerminalHttpEvidenceV1;
	},
): D724TerminalHttpAdmissionV1 {
	const state = authorityState(authority);
	const input = record(inputValue, "d724.admitTerminalHttp");
	exactKeys(
		input,
		[
			"effectAdmissionDigest",
			"effectRequestDigest",
			"providerResultDigest",
			"terminalHttpEvidence",
		],
		"d724.admitTerminalHttp",
	);
	const material = strictSnapshot({
		schemaVersion: D724_TERMINAL_HTTP_ADMISSION_SCHEMA,
		effectRequestDigest: digest(input.effectRequestDigest, "d724.effectRequestDigest"),
		effectAdmissionDigest: digest(input.effectAdmissionDigest, "d724.effectAdmissionDigest"),
		providerResultDigest: digest(input.providerResultDigest, "d724.providerResultDigest"),
		terminalHttpEvidence: validateD724TerminalHttpEvidence(input.terminalHttpEvidence),
	});
	const proposal = Object.freeze({
		...material,
		admissionDigest: empiricalStrictJsonDigest(material),
	});
	const before = state.facts.length;
	state.proposalNode.down([["DATA", proposal]]);
	const admitted = state.facts[before];
	if (admitted === undefined || state.facts.length !== before + 1)
		throw new TypeError("D724 Graph omitted terminal HTTP admission");
	return admitted;
}

export function snapshotD724TerminalHttpGraphEvidence(
	authority: D724TerminalHttpAuthorityV1,
): D724TerminalHttpGraphEvidenceV1 {
	const state = authorityState(authority);
	const material = strictSnapshot({
		schemaVersion: D724_TERMINAL_HTTP_GRAPH_EVIDENCE_SCHEMA,
		facts: state.facts,
	});
	return strictSnapshot({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D724TerminalHttpGraphEvidenceV1;
}

export function validateD724TerminalHttpGraphEvidence(
	value: unknown,
): D724TerminalHttpGraphEvidenceV1 {
	const candidate = record(value, "d724.terminalHttpGraphEvidence");
	exactKeys(candidate, ["evidenceDigest", "facts", "schemaVersion"], "d724.graphEvidence");
	literal(
		candidate.schemaVersion,
		D724_TERMINAL_HTTP_GRAPH_EVIDENCE_SCHEMA,
		"d724.graphEvidence.schema",
	);
	const rawFacts = array(candidate.facts, "d724.graphEvidence.facts");
	if (rawFacts.length > D724_MAX_TERMINAL_HTTP_FACTS)
		throw new TypeError("D724 terminal HTTP graph facts are invalid");
	const facts = rawFacts.map(validateD724TerminalHttpAdmission);
	if (
		new Set(facts.map((fact) => fact.effectAdmissionDigest)).size !== facts.length ||
		new Set(facts.map((fact) => fact.providerResultDigest)).size !== facts.length
	)
		throw new TypeError("D724 terminal HTTP graph facts are duplicated");
	const evidenceDigest = digest(candidate.evidenceDigest, "d724.graphEvidence.evidenceDigest");
	const material = strictSnapshot({
		schemaVersion: D724_TERMINAL_HTTP_GRAPH_EVIDENCE_SCHEMA,
		facts,
	});
	literal(evidenceDigest, empiricalStrictJsonDigest(material), "d724.graphEvidence.evidenceDigest");
	return strictSnapshot({
		...material,
		evidenceDigest,
	}) as unknown as D724TerminalHttpGraphEvidenceV1;
}
