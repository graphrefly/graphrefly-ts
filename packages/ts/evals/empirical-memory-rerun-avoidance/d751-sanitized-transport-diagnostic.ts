import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import type { Node } from "../../src/node/node.js";
import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	type D722CanonicalGraphEvidenceV1,
	deriveD722CanonicalGraphEvidence,
} from "./d722-graph-completion-memory-insight.js";
import { createD726ArmLocalTerminalProviderPolicy } from "./d722-graph-native-effect-runtime.js";
import {
	createD726ProviderAdapter,
	createD729SanitizedExecutorFailureProviderTurn,
	type D726ProviderTurnV1,
	runD726InjectedNoNetworkQualification,
} from "./d729-provider-block-core.js";
import {
	D751_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD751Implementation,
} from "./d751-implementation-manifest.js";
import {
	createOpenRouterTransportFailure,
	OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA,
	type OpenRouterTransportFailureDiagnosticV1,
	readOpenRouterTransportFailureDiagnostic,
} from "./openrouter-transport-failure.js";

export const D751_DECISION_REF = "decision.D751" as const;
export const D751_DECISION_REVISION = "2026-08-12.v1" as const;
export const D751_TRANSPORT_FACT_SCHEMA =
	"graphrefly.b112.d751.graph-admitted-transport-diagnostic-fact.v1" as const;
export const D751_TRANSPORT_GRAPH_EVIDENCE_SCHEMA =
	"graphrefly.b112.d751.transport-diagnostic-graph-evidence.v1" as const;
export const D751_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d751.sanitized-transport-diagnostic-qualification.v1" as const;
export const D751_GENERATION_SCHEMA =
	"graphrefly.b112.d751.sanitized-transport-diagnostic-generation.v1" as const;
export const D751_GENERATION_REF =
	"d751-sanitized-transport-diagnostic-pre-live-2026-08-12-v5" as const;

export const D751_IMMUTABLE_D750 = Object.freeze({
	bundleArtifactSha256: "sha256:c8030f76a65f21dab0bad020f5e72243385cf936d92bbb2e05fdaf627e38bcc4",
	bundleDigest: "sha256:c5b8fe7128fef05fc1ce9420993a93e543968440904732d12e7c4c12cfdcee97",
	generationDigest: "sha256:afbc26e5087186c088797a8b98f4c2213bb9a745d5179a2666d02b1f1ff53cd5",
	terminalReceiptDigest: "sha256:d5ee9be3c659bc5cdf3371bc2da99123c8c4cb65927436821352bfda984bf9f9",
});

const D751_CAUSE_CODES = Object.freeze([
	"abort-err",
	"econnrefused",
	"econnreset",
	"und-err-connect-timeout",
	"eai-again",
	"enotfound",
	"epipe",
	"und-err-aborted",
	"und-err-body-timeout",
	"und-err-headers-timeout",
	"und-err-socket",
	"etimedout",
	"unrecognized",
] as const);

type D751TransportCauseCode = (typeof D751_CAUSE_CODES)[number];

const REQUIRED_CAUSE_COVERAGE = Object.freeze([
	"abort-err",
	"econnreset",
	"und-err-connect-timeout",
	"enotfound",
	"und-err-body-timeout",
	"und-err-headers-timeout",
	"unrecognized",
] satisfies readonly D751TransportCauseCode[]);

export interface D751TransportDiagnosticProposalV1 {
	readonly revision: "graphrefly.b112.d751.transport-diagnostic-proposal.v1";
}

export interface D751SanitizedProviderTurnV1 {
	readonly turn: D726ProviderTurnV1;
	readonly proposal: D751TransportDiagnosticProposalV1 | null;
}

export interface D751TransportDiagnosticFactV1 {
	readonly schemaVersion: typeof D751_TRANSPORT_FACT_SCHEMA;
	readonly runSequence: number;
	readonly effectSequence: number;
	readonly effectRequestDigest: string;
	readonly effectAdmissionDigest: string;
	readonly providerResultDigest: string;
	readonly reconciliationDigest: string;
	readonly phase: OpenRouterTransportFailureDiagnosticV1["phase"];
	readonly causeCode: D751TransportCauseCode;
	readonly factDigest: string;
}

export interface D751TransportDiagnosticGraphEvidenceV1 {
	readonly schemaVersion: typeof D751_TRANSPORT_GRAPH_EVIDENCE_SCHEMA;
	readonly facts: readonly D751TransportDiagnosticFactV1[];
	readonly evidenceDigest: string;
}

export interface D751TransportDiagnosticAuthorityV1 {
	readonly revision: "graphrefly.b112.d751.transport-diagnostic-authority.v1";
}

export interface D751QualificationV1 {
	readonly schemaVersion: typeof D751_QUALIFICATION_SCHEMA;
	readonly decisionRef: typeof D751_DECISION_REF;
	readonly decisionRevision: typeof D751_DECISION_REVISION;
	readonly historicalD750: typeof D751_IMMUTABLE_D750;
	readonly implementationManifestDigest: typeof D751_IMPLEMENTATION_MANIFEST_DIGEST;
	readonly graphEvidence: readonly D722CanonicalGraphEvidenceV1[];
	readonly transportGraphEvidence: D751TransportDiagnosticGraphEvidenceV1;
	readonly requiredCauseCoverage: typeof REQUIRED_CAUSE_COVERAGE;
	readonly simulatedProviderEffectCount: number;
	readonly providerTransportCallCount: 0;
	readonly networkCallCount: 0;
	readonly retryWaitCount: 0;
	readonly maxActiveArms: 1;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly qualificationDigest: string;
}

export interface D751PersistenceReceiptV1 {
	readonly generationPath: string;
	readonly qualificationDigest: string;
	readonly generationDigest: string;
}

export interface D751PersistenceFaultV1 {
	readonly revision: "graphrefly.b112.d751.persistence-fault.v1";
}

const constructedQualifications = new WeakSet<object>();
const persistenceFaults = new WeakMap<
	object,
	"after-staging" | "after-commit" | "after-rename" | "after-final-sync"
>();
const transportDiagnosticProposals = new WeakMap<
	object,
	{
		readonly requestDigest: string;
		readonly evidenceDigest: string;
		readonly diagnostic: OpenRouterTransportFailureDiagnosticV1;
	}
>();
const constructedAuthorities = new WeakMap<
	object,
	{ readonly proposalNode: Node<unknown>; readonly facts: D751TransportDiagnosticFactV1[] }
>();

function sha(label: string): string {
	return empiricalStrictJsonDigest({ label });
}

function assertBoundedCanonicalTree(value: unknown, label: string): void {
	const pending: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }];
	const seen = new Set<object>();
	let nodes = 0;
	while (pending.length > 0) {
		const current = pending.pop()!;
		if (++nodes > 100_000 || current.depth > 32)
			throw new TypeError(`${label} canonical tree bound exceeded`);
		if (typeof current.value !== "object" || current.value === null) continue;
		if (seen.has(current.value)) throw new TypeError(`${label} canonical tree is cyclic`);
		seen.add(current.value);
		const keys = Reflect.ownKeys(current.value);
		if (keys.length > 4_096) throw new TypeError(`${label} canonical object key bound exceeded`);
		if (Array.isArray(current.value)) {
			if (keys.some((key) => key !== "length" && typeof key !== "string"))
				throw new TypeError(`${label} array keys are invalid`);
			for (let index = 0; index < current.value.length; index++)
				if (!Object.hasOwn(current.value, index)) throw new TypeError(`${label} array is sparse`);
		}
		for (const key of keys) {
			if (key === "length" && Array.isArray(current.value)) continue;
			const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
			if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
				throw new TypeError(`${label} contains a non-data property`);
			pending.push({ value: descriptor.value, depth: current.depth + 1 });
		}
	}
}

export function validateD751SanitizedTransportDiagnostic(
	value: unknown,
): OpenRouterTransportFailureDiagnosticV1 {
	const candidate = record(value, "d751.transportDiagnostic");
	exactKeys(candidate, ["causeCode", "phase", "schemaVersion"], "d751.transportDiagnostic");
	literal(
		candidate.schemaVersion,
		OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA,
		"d751.transportDiagnostic.schema",
	);
	oneOf(candidate.phase, ["request", "response-body"], "d751.transportDiagnostic.phase");
	oneOf(candidate.causeCode, D751_CAUSE_CODES, "d751.transportDiagnostic.causeCode");
	return strictSnapshot(candidate) as unknown as OpenRouterTransportFailureDiagnosticV1;
}

function d751SanitizedTransportDiagnosticEvidenceDigest(inputValue: {
	readonly requestDigest: string;
	readonly transportDiagnostic: OpenRouterTransportFailureDiagnosticV1;
}): string {
	const input = record(inputValue, "d751.transportDiagnosticEvidence");
	exactKeys(input, ["requestDigest", "transportDiagnostic"], "d751.transportDiagnosticEvidence");
	const requestDigest = digest(input.requestDigest, "d751.transportDiagnosticEvidence.request");
	const transportDiagnostic = validateD751SanitizedTransportDiagnostic(input.transportDiagnostic);
	return empiricalStrictJsonDigest({
		boundary: "d729.provider-request",
		classification: "transport-failure",
		errorName: "OpenRouterTransportFailure",
		requestDigest,
		transportDiagnostic,
	});
}

export function createD751SanitizedExecutorFailureProviderTurn(
	error: unknown,
	requestDigestValue: string,
): D751SanitizedProviderTurnV1 {
	const requestDigest = digest(requestDigestValue, "d751.executorFailure.requestDigest");
	const diagnostic = readOpenRouterTransportFailureDiagnostic(error);
	if (diagnostic === null)
		throw new TypeError("D751 transport boundary requires a sanitized transport failure");
	const validatedDiagnostic = validateD751SanitizedTransportDiagnostic(diagnostic);
	const evidenceDigest = d751SanitizedTransportDiagnosticEvidenceDigest({
		requestDigest,
		transportDiagnostic: validatedDiagnostic,
	});
	const turn = createD729SanitizedExecutorFailureProviderTurn(error, requestDigest);
	const proposal = Object.freeze({
		revision: "graphrefly.b112.d751.transport-diagnostic-proposal.v1" as const,
	});
	transportDiagnosticProposals.set(
		proposal,
		Object.freeze({
			requestDigest,
			evidenceDigest,
			diagnostic: validatedDiagnostic,
		}),
	);
	return Object.freeze({ turn, proposal });
}

export async function executeD751SanitizedTransportBoundary(
	invoke: () => Promise<D726ProviderTurnV1>,
	requestDigest: string,
): Promise<D751SanitizedProviderTurnV1> {
	if (typeof invoke !== "function")
		throw new TypeError("D751 transport boundary invoke is invalid");
	try {
		return Object.freeze({ turn: await invoke(), proposal: null });
	} catch (error) {
		if (readOpenRouterTransportFailureDiagnostic(error) === null) throw error;
		return createD751SanitizedExecutorFailureProviderTurn(error, requestDigest);
	}
}

function consumeD751TransportDiagnosticProposal(proposal: D751TransportDiagnosticProposalV1) {
	const material = transportDiagnosticProposals.get(proposal);
	if (material === undefined)
		throw new TypeError("D751 transport diagnostic proposal is invalid or consumed");
	transportDiagnosticProposals.delete(proposal);
	return material;
}

function replayGraph(value: unknown): D722CanonicalGraphEvidenceV1 {
	assertBoundedCanonicalTree(value, "d751.graphEvidence");
	const candidate = record(value, "d751.graphEvidence");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"completionContexts",
			"effectRuns",
			"efficacyClaim",
			"evidenceDigest",
			"insightTopology",
			"insightTopologyDigest",
			"ledger",
			"memoryInsights",
			"runStatus",
			"schemaVersion",
		],
		"d751.graphEvidence",
	);
	const effectRuns = array(candidate.effectRuns, "d751.graphEvidence.effectRuns");
	if (effectRuns.length > 12) throw new TypeError("D751 Graph run bound exceeded");
	for (const [key, max] of [
		["completionContexts", 24],
		["memoryInsights", 24],
	] as const) {
		const values = array(candidate[key], `d751.graphEvidence.${key}`);
		if (values.length > max) throw new TypeError(`D751 Graph ${key} bound exceeded`);
	}
	const replay = deriveD722CanonicalGraphEvidence(
		candidate.ledger,
		effectRuns as D722CanonicalGraphEvidenceV1["effectRuns"],
		createD726ArmLocalTerminalProviderPolicy(),
	);
	literal(
		empiricalStrictJsonDigest(replay),
		empiricalStrictJsonDigest(candidate),
		"d751.graphEvidence.replay",
	);
	return replay;
}

function validateTransportFact(value: unknown): D751TransportDiagnosticFactV1 {
	const candidate = record(value, "d751.transportFact");
	exactKeys(
		candidate,
		[
			"causeCode",
			"effectAdmissionDigest",
			"effectRequestDigest",
			"effectSequence",
			"factDigest",
			"phase",
			"providerResultDigest",
			"reconciliationDigest",
			"runSequence",
			"schemaVersion",
		],
		"d751.transportFact",
	);
	literal(candidate.schemaVersion, D751_TRANSPORT_FACT_SCHEMA, "d751.transportFact.schema");
	safeInteger(candidate.runSequence, "d751.transportFact.runSequence", { max: 255 });
	safeInteger(candidate.effectSequence, "d751.transportFact.effectSequence", { max: 2_047 });
	for (const key of [
		"effectRequestDigest",
		"effectAdmissionDigest",
		"providerResultDigest",
		"reconciliationDigest",
	] as const)
		digest(candidate[key], `d751.transportFact.${key}`);
	const diagnostic = validateD751SanitizedTransportDiagnostic({
		schemaVersion: OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA,
		phase: candidate.phase,
		causeCode: candidate.causeCode,
	});
	const { factDigest: _ignored, ...material } = candidate;
	literal(
		digest(candidate.factDigest, "d751.transportFact.factDigest"),
		empiricalStrictJsonDigest(material),
		"d751.transportFact.factDigest",
	);
	return strictSnapshot({
		...candidate,
		phase: diagnostic.phase,
		causeCode: diagnostic.causeCode,
	}) as D751TransportDiagnosticFactV1;
}

function authorityState(authority: D751TransportDiagnosticAuthorityV1) {
	const state = constructedAuthorities.get(authority);
	if (state === undefined) throw new TypeError("D751 transport authority is not Graph-constructed");
	return state;
}

export function createD751TransportDiagnosticAuthority(): D751TransportDiagnosticAuthorityV1 {
	const owner = graph({ name: "d751/transport-diagnostic-authority" });
	const proposalNode = owner.node<unknown>([], null, {
		name: "d751/transport-diagnostic-proposals",
	});
	const admissionNode = owner.node<D751TransportDiagnosticFactV1>(
		[proposalNode],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) ctx.down([["DATA", validateTransportFact(raw)]]);
		},
		{
			name: "d751/transport-diagnostic-admissions",
			factory: "d751TransportDiagnosticAdmission",
		},
	);
	const facts: D751TransportDiagnosticFactV1[] = [];
	admissionNode.subscribe((message) => {
		if (message[0] !== "DATA") return;
		if (facts.length >= 24) throw new TypeError("D751 transport fact bound exhausted");
		const fact = message[1] as D751TransportDiagnosticFactV1;
		if (facts.some((candidate) => candidate.effectAdmissionDigest === fact.effectAdmissionDigest))
			throw new TypeError("D751 transport admission was replayed");
		facts.push(fact);
	});
	const authority = Object.freeze({
		revision: "graphrefly.b112.d751.transport-diagnostic-authority.v1" as const,
	});
	constructedAuthorities.set(authority, { proposalNode, facts });
	return authority;
}

export function admitD751TransportDiagnostic(
	authority: D751TransportDiagnosticAuthorityV1,
	inputValue: {
		readonly proposal: D751TransportDiagnosticProposalV1;
		readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	},
): D751TransportDiagnosticFactV1 {
	const state = authorityState(authority);
	const input = record(inputValue, "d751.admitTransportDiagnostic");
	exactKeys(input, ["graphEvidence", "proposal"], "d751.admitTransportDiagnostic");
	const proposal = consumeD751TransportDiagnosticProposal(
		input.proposal as D751TransportDiagnosticProposalV1,
	);
	const graphEvidence = replayGraph(input.graphEvidence);
	const matches = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.status === "terminal-failure" &&
			fact.result.failureProvenance === "executor-failure" &&
			fact.result.executorFailureClassification === "transport-failure" &&
			fact.request.requestDigest === proposal.requestDigest &&
			fact.result.evidenceDigest === proposal.evidenceDigest
				? [{ run, fact }]
				: [],
		),
	);
	if (matches.length !== 1)
		throw new TypeError("D751 adapter proposal lacks one exact admitted Graph result");
	const match = matches[0]!;
	const admissions = graphEvidence.ledger.effectAdmissions.filter(
		(admission) => admission.decisionDigest === match.fact.admissionDigest,
	);
	const reconciliations = graphEvidence.ledger.effectReconciliations.filter(
		(reconciliation) => reconciliation.admissionDigest === match.fact.admissionDigest,
	);
	if (admissions.length !== 1 || reconciliations.length !== 1)
		throw new TypeError("D751 adapter proposal lacks exact Graph admission/reconciliation");
	const diagnostic = validateD751SanitizedTransportDiagnostic(proposal.diagnostic);
	if (
		d751SanitizedTransportDiagnosticEvidenceDigest({
			requestDigest: proposal.requestDigest,
			transportDiagnostic: diagnostic,
		}) !== proposal.evidenceDigest
	)
		throw new TypeError("D751 adapter proposal diagnostic binding drifted");
	const material = strictSnapshot({
		schemaVersion: D751_TRANSPORT_FACT_SCHEMA,
		runSequence: match.run.runSequence,
		effectSequence: admissions[0]!.effectSequence,
		effectRequestDigest: match.fact.request.requestDigest,
		effectAdmissionDigest: match.fact.admissionDigest,
		providerResultDigest: match.fact.resultDigest,
		reconciliationDigest: reconciliations[0]!.reconciliationDigest,
		phase: diagnostic.phase,
		causeCode: diagnostic.causeCode,
	});
	const candidate = strictSnapshot({
		...material,
		factDigest: empiricalStrictJsonDigest(material),
	});
	const before = state.facts.length;
	state.proposalNode.down([["DATA", candidate]]);
	const admitted = state.facts[before];
	if (admitted === undefined || state.facts.length !== before + 1)
		throw new TypeError("D751 Graph omitted transport diagnostic admission");
	return admitted;
}

export function snapshotD751TransportDiagnosticGraphEvidence(
	authority: D751TransportDiagnosticAuthorityV1,
): D751TransportDiagnosticGraphEvidenceV1 {
	const state = authorityState(authority);
	const material = strictSnapshot({
		schemaVersion: D751_TRANSPORT_GRAPH_EVIDENCE_SCHEMA,
		facts: state.facts,
	});
	return strictSnapshot({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	}) as D751TransportDiagnosticGraphEvidenceV1;
}

export function validateD751TransportDiagnosticGraphEvidence(
	value: unknown,
	graphEvidenceValue: readonly D722CanonicalGraphEvidenceV1[],
): D751TransportDiagnosticGraphEvidenceV1 {
	const candidate = record(value, "d751.transportGraphEvidence");
	exactKeys(candidate, ["evidenceDigest", "facts", "schemaVersion"], "d751.transportGraphEvidence");
	literal(
		candidate.schemaVersion,
		D751_TRANSPORT_GRAPH_EVIDENCE_SCHEMA,
		"d751.transportGraphEvidence.schema",
	);
	const rawFacts = array(candidate.facts, "d751.transportGraphEvidence.facts");
	if (rawFacts.length > 24) throw new TypeError("D751 transport Graph fact bound exceeded");
	const facts = Object.freeze(rawFacts.map(validateTransportFact));
	if (new Set(facts.map((fact) => fact.effectAdmissionDigest)).size !== facts.length)
		throw new TypeError("D751 transport Graph facts are duplicated");
	const rawGraphEvidence = array(graphEvidenceValue, "d751.transportGraphEvidence.graphEvidence");
	if (rawGraphEvidence.length < 1 || rawGraphEvidence.length > 4)
		throw new TypeError("D751 transport Graph evidence collection bound exceeded");
	const graphEvidence = Object.freeze(rawGraphEvidence.map((item) => replayGraph(item)));
	const expected = graphEvidence.flatMap((graphItem) =>
		graphItem.effectRuns.flatMap((run) =>
			run.facts.flatMap((fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.result.effectKind === "provider-request" &&
				fact.result.status === "terminal-failure" &&
				fact.result.failureProvenance === "executor-failure" &&
				fact.result.executorFailureClassification === "transport-failure"
					? [{ graphItem, run, fact }]
					: [],
			),
		),
	);
	if (facts.length !== expected.length)
		throw new TypeError("D751 transport Graph fact coverage drifted");
	if (new Set(expected.map((item) => item.fact.admissionDigest)).size !== expected.length)
		throw new TypeError("D751 expected transport admissions are duplicated");
	const factByAdmission = new Map(facts.map((fact) => [fact.effectAdmissionDigest, fact] as const));
	for (const expectedItem of expected) {
		const fact = factByAdmission.get(expectedItem.fact.admissionDigest);
		if (
			fact === undefined ||
			!(
				fact.runSequence === expectedItem.run.runSequence &&
				fact.effectRequestDigest === expectedItem.fact.request.requestDigest &&
				fact.effectAdmissionDigest === expectedItem.fact.admissionDigest &&
				fact.providerResultDigest === expectedItem.fact.resultDigest &&
				d751SanitizedTransportDiagnosticEvidenceDigest({
					requestDigest: fact.effectRequestDigest,
					transportDiagnostic: {
						schemaVersion: OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA,
						phase: fact.phase,
						causeCode: fact.causeCode,
					},
				}) === expectedItem.fact.result.evidenceDigest &&
				expectedItem.graphItem.ledger.effectAdmissions.some(
					(admission) =>
						admission.decisionDigest === fact.effectAdmissionDigest &&
						admission.effectSequence === fact.effectSequence,
				) &&
				expectedItem.graphItem.ledger.effectReconciliations.some(
					(reconciliation) =>
						reconciliation.admissionDigest === fact.effectAdmissionDigest &&
						reconciliation.effectSequence === fact.effectSequence &&
						reconciliation.reconciliationDigest === fact.reconciliationDigest,
				)
			)
		)
			throw new TypeError("D751 transport Graph fact exact binding drifted");
		factByAdmission.delete(fact.effectAdmissionDigest);
	}
	if (factByAdmission.size !== 0) throw new TypeError("D751 transport Graph fact surplus drifted");
	const material = strictSnapshot({
		schemaVersion: D751_TRANSPORT_GRAPH_EVIDENCE_SCHEMA,
		facts,
	});
	literal(
		digest(candidate.evidenceDigest, "d751.transportGraphEvidence.digest"),
		empiricalStrictJsonDigest(material),
		"d751.transportGraphEvidence.digest",
	);
	return strictSnapshot({
		...material,
		evidenceDigest: candidate.evidenceDigest,
	}) as D751TransportDiagnosticGraphEvidenceV1;
}

function injectedAdapter(
	scenarios: readonly { readonly phase: "request" | "response-body"; readonly code: string }[],
) {
	const workspaces = new Map<number, string>();
	const proposals: D751TransportDiagnosticProposalV1[] = [];
	let calls = 0;
	const adapter = createD726ProviderAdapter({
		executionClass: "injected-no-network",
		async materialization({ effectRequest }) {
			const workspace = sha(`d751-workspace-${effectRequest.runSequence}`);
			workspaces.set(effectRequest.runSequence, workspace);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "materialization",
					status: "ready",
					workspaceStateDigest: workspace,
					evidenceDigest: sha(`d751-materialization-${effectRequest.runSequence}`),
				},
			};
		},
		async providerRequest({ effectRequest }) {
			const scenario = scenarios[calls++];
			if (scenario === undefined) throw new TypeError("D751 injected scenario underflow");
			const captured = await executeD751SanitizedTransportBoundary(async () => {
				throw createOpenRouterTransportFailure(scenario.phase, { code: scenario.code });
			}, effectRequest.requestDigest);
			if (captured.proposal === null)
				throw new TypeError("D751 injected transport failure omitted its proposal");
			proposals.push(captured.proposal);
			return captured.turn;
		},
		async retryWait() {
			throw new TypeError("D751 diagnostics cannot expand retry policy");
		},
		async toolAction() {
			throw new TypeError("D751 terminal transport failure cannot execute tools");
		},
		async hiddenVerifier() {
			throw new TypeError("D751 terminal transport failure cannot verify");
		},
		async cleanup({ effectRequest }) {
			workspaces.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup",
					status: "succeeded",
					evidenceDigest: sha(`d751-cleanup-${effectRequest.runSequence}`),
				},
			};
		},
	});
	return Object.freeze({ adapter, calls: () => calls, proposals, workspaces });
}

const SCENARIO_BATCHES = Object.freeze([
	Object.freeze([
		{ phase: "request" as const, code: "UND_ERR_CONNECT_TIMEOUT" },
		{ phase: "request" as const, code: "UND_ERR_HEADERS_TIMEOUT" },
		{ phase: "response-body" as const, code: "UND_ERR_BODY_TIMEOUT" },
		{ phase: "request" as const, code: "ECONNRESET" },
		{ phase: "request" as const, code: "ENOTFOUND" },
	]),
	Object.freeze([
		{ phase: "request" as const, code: "ABORT_ERR" },
		{ phase: "request" as const, code: "D751_UNKNOWN" },
		{ phase: "response-body" as const, code: "ECONNRESET" },
		{ phase: "request" as const, code: "UND_ERR_CONNECT_TIMEOUT" },
		{ phase: "response-body" as const, code: "UND_ERR_BODY_TIMEOUT" },
	]),
]);

const REQUIRED_DIAGNOSTIC_MULTISET = Object.freeze(
	SCENARIO_BATCHES.flatMap((batch) => batch.map((item) => `${item.phase}:${item.code}`))
		.map((item) =>
			item
				.replace("ABORT_ERR", "abort-err")
				.replace("ECONNRESET", "econnreset")
				.replace("ENOTFOUND", "enotfound")
				.replace("UND_ERR_BODY_TIMEOUT", "und-err-body-timeout")
				.replace("UND_ERR_CONNECT_TIMEOUT", "und-err-connect-timeout")
				.replace("UND_ERR_HEADERS_TIMEOUT", "und-err-headers-timeout")
				.replace("D751_UNKNOWN", "unrecognized"),
		)
		.sort(),
);

export async function runD751InjectedNoNetworkQualification(): Promise<D751QualificationV1> {
	const implementationManifestDigest = await measureD751Implementation();
	const graphEvidence: D722CanonicalGraphEvidenceV1[] = [];
	const authority = createD751TransportDiagnosticAuthority();
	let simulatedProviderEffectCount = 0;
	for (const [index, scenarios] of SCENARIO_BATCHES.entries()) {
		const fixture = injectedAdapter(scenarios);
		const run = await runD726InjectedNoNetworkQualification({
			sourceDigest: empiricalStrictJsonDigest({ implementationManifestDigest, batchIndex: index }),
			adapter: fixture.adapter,
			signal: new AbortController().signal,
		});
		if (fixture.calls() !== scenarios.length || fixture.workspaces.size !== 0)
			throw new TypeError(
				`D751 injected execution or cleanup coverage drifted: ${fixture.calls()}/${scenarios.length}/${fixture.workspaces.size}`,
			);
		graphEvidence.push(run.graphEvidence);
		for (const [proposalIndex, proposal] of fixture.proposals.entries()) {
			admitD751TransportDiagnostic(authority, {
				proposal,
				graphEvidence: run.graphEvidence,
			});
			if (index === 0 && proposalIndex === 0) {
				const replayAuthority = createD751TransportDiagnosticAuthority();
				const firstProviderFact = run.graphEvidence.effectRuns[0]!.facts.find(
					(fact) =>
						fact.kind === "graph-effect-result-admitted" &&
						fact.result.effectKind === "provider-request",
				);
				if (firstProviderFact?.kind !== "graph-effect-result-admitted")
					throw new TypeError("D751 replay provider fact was omitted");
				const first = createD751SanitizedExecutorFailureProviderTurn(
					createOpenRouterTransportFailure(scenarios[0]!.phase, { code: scenarios[0]!.code }),
					firstProviderFact.request.requestDigest,
				);
				if (first.proposal === null)
					throw new TypeError("D751 replay diagnostic proposal was omitted");
				const admitted = admitD751TransportDiagnostic(replayAuthority, {
					proposal: first.proposal,
					graphEvidence: run.graphEvidence,
				});
				let consumedReplayRejected = false;
				try {
					admitD751TransportDiagnostic(replayAuthority, {
						proposal: first.proposal,
						graphEvidence: run.graphEvidence,
					});
				} catch {
					consumedReplayRejected = true;
				}
				if (!consumedReplayRejected)
					throw new TypeError("D751 consumed proposal replay was accepted");
				const duplicate = createD751SanitizedExecutorFailureProviderTurn(
					createOpenRouterTransportFailure(scenarios[0]!.phase, { code: scenarios[0]!.code }),
					admitted.effectRequestDigest,
				);
				if (duplicate.proposal === null)
					throw new TypeError("D751 duplicate diagnostic proposal was omitted");
				let duplicateAdmissionRejected = false;
				try {
					admitD751TransportDiagnostic(replayAuthority, {
						proposal: duplicate.proposal,
						graphEvidence: run.graphEvidence,
					});
				} catch {
					duplicateAdmissionRejected = true;
				}
				if (!duplicateAdmissionRejected)
					throw new TypeError("D751 duplicate Graph admission was accepted");
			}
		}
		simulatedProviderEffectCount += fixture.calls();
	}
	const replayed = Object.freeze(graphEvidence.map((evidence) => replayGraph(evidence)));
	const transportGraphEvidence = validateD751TransportDiagnosticGraphEvidence(
		snapshotD751TransportDiagnosticGraphEvidence(authority),
		replayed,
	);
	const facts = transportGraphEvidence.facts;
	const diagnosticMultiset = Object.freeze(
		facts.map((fact) => `${fact.phase}:${fact.causeCode}`).sort(),
	);
	if (
		empiricalStrictJsonDigest(diagnosticMultiset) !==
		empiricalStrictJsonDigest(REQUIRED_DIAGNOSTIC_MULTISET)
	)
		throw new TypeError("D751 required transport phase/cause coverage is incomplete");
	const coverage = Object.freeze([...new Set(facts.map((fact) => fact.causeCode))].sort());
	if (
		empiricalStrictJsonDigest(coverage) !==
		empiricalStrictJsonDigest([...REQUIRED_CAUSE_COVERAGE].sort())
	)
		throw new TypeError("D751 required transport cause coverage is incomplete");
	const retryWaitCount = replayed.reduce(
		(total, evidence) =>
			total +
			evidence.ledger.effectReconciliations.filter((item) =>
				evidence.ledger.effectProposals.some(
					(proposal) =>
						proposal.effectSequence === item.effectSequence && proposal.effectKind === "retry-wait",
				),
			).length,
		0,
	);
	if (retryWaitCount !== 0)
		throw new TypeError("D751 diagnostic preservation changed retry admission");
	const material = strictSnapshot({
		schemaVersion: D751_QUALIFICATION_SCHEMA,
		decisionRef: D751_DECISION_REF,
		decisionRevision: D751_DECISION_REVISION,
		historicalD750: D751_IMMUTABLE_D750,
		implementationManifestDigest,
		graphEvidence: replayed,
		transportGraphEvidence,
		requiredCauseCoverage: REQUIRED_CAUSE_COVERAGE,
		simulatedProviderEffectCount,
		providerTransportCallCount: 0 as const,
		networkCallCount: 0 as const,
		retryWaitCount,
		maxActiveArms: 1 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = strictSnapshot({
		...material,
		qualificationDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D751QualificationV1;
	if ((await measureD751Implementation()) !== implementationManifestDigest)
		throw new TypeError("D751 implementation changed during qualification");
	constructedQualifications.add(qualification);
	return qualification;
}

export function validateD751Qualification(value: unknown): D751QualificationV1 {
	const candidate = record(value, "d751.qualification");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"graphEvidence",
			"historicalD750",
			"implementationManifestDigest",
			"maxActiveArms",
			"networkCallCount",
			"providerTransportCallCount",
			"qualificationDigest",
			"requiredCauseCoverage",
			"retryWaitCount",
			"schemaVersion",
			"simulatedProviderEffectCount",
			"transportGraphEvidence",
		],
		"d751.qualification",
	);
	literal(candidate.schemaVersion, D751_QUALIFICATION_SCHEMA, "d751.qualification.schema");
	literal(candidate.decisionRef, D751_DECISION_REF, "d751.qualification.decision");
	literal(candidate.decisionRevision, D751_DECISION_REVISION, "d751.qualification.revision");
	literal(
		empiricalStrictJsonDigest(candidate.historicalD750),
		empiricalStrictJsonDigest(D751_IMMUTABLE_D750),
		"d751.qualification.history",
	);
	literal(
		candidate.implementationManifestDigest,
		D751_IMPLEMENTATION_MANIFEST_DIGEST,
		"d751.qualification.implementationManifest",
	);
	const evidence = array(candidate.graphEvidence, "d751.qualification.graphEvidence");
	if (evidence.length !== SCENARIO_BATCHES.length)
		throw new TypeError("D751 qualification Graph evidence cardinality drifted");
	const replayed = Object.freeze(evidence.map((item) => replayGraph(item)));
	for (const [index, replay] of replayed.entries())
		literal(
			replay.ledger.sourceDigest,
			empiricalStrictJsonDigest({
				implementationManifestDigest: D751_IMPLEMENTATION_MANIFEST_DIGEST,
				batchIndex: index,
			}),
			`d751.qualification.graphSource.${index}`,
		);
	const transportGraphEvidence = validateD751TransportDiagnosticGraphEvidence(
		candidate.transportGraphEvidence,
		replayed,
	);
	const derivedCoverage = Object.freeze(
		[...new Set(transportGraphEvidence.facts.map((fact) => fact.causeCode))].sort(),
	);
	const derivedDiagnosticMultiset = Object.freeze(
		transportGraphEvidence.facts.map((fact) => `${fact.phase}:${fact.causeCode}`).sort(),
	);
	literal(
		empiricalStrictJsonDigest(derivedDiagnosticMultiset),
		empiricalStrictJsonDigest(REQUIRED_DIAGNOSTIC_MULTISET),
		"d751.qualification.derivedPhaseCauseCoverage",
	);
	literal(
		empiricalStrictJsonDigest(derivedCoverage),
		empiricalStrictJsonDigest([...REQUIRED_CAUSE_COVERAGE].sort()),
		"d751.qualification.derivedCoverage",
	);
	literal(
		empiricalStrictJsonDigest(candidate.requiredCauseCoverage),
		empiricalStrictJsonDigest(REQUIRED_CAUSE_COVERAGE),
		"d751.qualification.coverage",
	);
	safeInteger(candidate.simulatedProviderEffectCount, "d751.qualification.simulatedEffects", {
		min: 1,
		max: 24,
	});
	literal(
		candidate.simulatedProviderEffectCount,
		transportGraphEvidence.facts.length,
		"d751.qualification.effects",
	);
	literal(candidate.providerTransportCallCount, 0, "d751.qualification.transportCalls");
	literal(candidate.networkCallCount, 0, "d751.qualification.networkCalls");
	const derivedRetryWaitCount = replayed.reduce(
		(total, evidenceItem) =>
			total +
			evidenceItem.ledger.effectReconciliations.filter((item) =>
				evidenceItem.ledger.effectProposals.some(
					(proposal) =>
						proposal.effectSequence === item.effectSequence && proposal.effectKind === "retry-wait",
				),
			).length,
		0,
	);
	literal(candidate.retryWaitCount, derivedRetryWaitCount, "d751.qualification.retryWaits");
	literal(derivedRetryWaitCount, 0, "d751.qualification.retryPolicyExpansion");
	literal(candidate.maxActiveArms, 1, "d751.qualification.maxActiveArms");
	literal(candidate.causalAttribution, "undetermined", "d751.qualification.attribution");
	literal(candidate.efficacyClaim, "none", "d751.qualification.efficacy");
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		decisionRef: candidate.decisionRef,
		decisionRevision: candidate.decisionRevision,
		historicalD750: candidate.historicalD750,
		implementationManifestDigest: candidate.implementationManifestDigest,
		graphEvidence: candidate.graphEvidence,
		transportGraphEvidence: candidate.transportGraphEvidence,
		requiredCauseCoverage: candidate.requiredCauseCoverage,
		simulatedProviderEffectCount: candidate.simulatedProviderEffectCount,
		providerTransportCallCount: candidate.providerTransportCallCount,
		networkCallCount: candidate.networkCallCount,
		retryWaitCount: candidate.retryWaitCount,
		maxActiveArms: candidate.maxActiveArms,
		causalAttribution: candidate.causalAttribution,
		efficacyClaim: candidate.efficacyClaim,
	});
	literal(
		digest(candidate.qualificationDigest, "d751.qualification.digest"),
		empiricalStrictJsonDigest(material),
		"d751.qualification.digest",
	);
	return strictSnapshot(candidate) as unknown as D751QualificationV1;
}

export function createD751PersistenceFault(
	stage: "after-staging" | "after-commit" | "after-rename" | "after-final-sync" = "after-staging",
): D751PersistenceFaultV1 {
	oneOf(
		stage,
		["after-staging", "after-commit", "after-rename", "after-final-sync"],
		"d751.persistenceFault.stage",
	);
	const fault = Object.freeze({
		revision: "graphrefly.b112.d751.persistence-fault.v1" as const,
	});
	persistenceFaults.set(fault, stage);
	return fault;
}

interface D751FileIdentity {
	readonly dev: number;
	readonly ino: number;
}

async function assertD751Directory(
	path: string,
	identity: D751FileIdentity,
	mode: number,
): Promise<void> {
	const status = await lstat(path);
	if (
		!status.isDirectory() ||
		status.isSymbolicLink() ||
		(status.mode & 0o777) !== mode ||
		status.nlink < 1 ||
		status.dev !== identity.dev ||
		status.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("D751 persistence directory identity drifted");
}

async function writeD751File(path: string, bytes: Uint8Array): Promise<D751FileIdentity> {
	const handle = await open(
		path,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
		const status = await handle.stat();
		if (!status.isFile() || (status.mode & 0o777) !== 0o600 || status.nlink !== 1)
			throw new TypeError("D751 persistence artifact identity drifted");
		return { dev: status.dev, ino: status.ino };
	} finally {
		await handle.close();
	}
}

async function assertD751File(
	path: string,
	identity: D751FileIdentity,
	bytes: Uint8Array,
): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const status = await handle.stat();
		if (
			!status.isFile() ||
			(status.mode & 0o777) !== 0o600 ||
			status.nlink !== 1 ||
			status.dev !== identity.dev ||
			status.ino !== identity.ino ||
			!sameBytes(new Uint8Array(await handle.readFile()), bytes)
		)
			throw new TypeError("D751 persistence artifact readback drifted");
	} finally {
		await handle.close();
	}
}

async function removeD751OwnedDirectory(
	path: string,
	identity: D751FileIdentity,
	privateRoot: string,
	parentHandle: Awaited<ReturnType<typeof open>>,
): Promise<void> {
	const tombstone = join(privateRoot, `.d751-tombstone-${randomUUID()}`);
	await rename(path, tombstone);
	const moved = await lstat(tombstone);
	if (moved.dev !== identity.dev || moved.ino !== identity.ino)
		throw new TypeError("D751 cleanup tombstone ownership drifted");
	await rm(tombstone, { recursive: true, force: true });
	await parentHandle.sync();
}

export async function persistD751PrivateGeneration(inputValue: {
	readonly privateRoot: string;
	readonly qualification: D751QualificationV1;
	readonly fault?: D751PersistenceFaultV1;
}): Promise<D751PersistenceReceiptV1> {
	const input = record(inputValue, "d751.persistence");
	exactKeys(
		input,
		Object.hasOwn(input, "fault")
			? ["fault", "privateRoot", "qualification"]
			: ["privateRoot", "qualification"],
		"d751.persistence",
	);
	if (
		typeof input.qualification !== "object" ||
		input.qualification === null ||
		!constructedQualifications.delete(input.qualification)
	)
		throw new TypeError("D751 persistence requires a fresh same-process qualification");
	const qualification = validateD751Qualification(input.qualification);
	if (typeof input.privateRoot !== "string" || resolve(input.privateRoot) !== input.privateRoot)
		throw new TypeError("D751 private root must be absolute");
	const privateRoot = await realpath(input.privateRoot);
	if (privateRoot !== input.privateRoot) throw new TypeError("D751 private root is not canonical");
	const generationMaterial = strictSnapshot({
		schemaVersion: D751_GENERATION_SCHEMA,
		generationRef: D751_GENERATION_REF,
		qualification: {
			file: "artifacts/qualification.v1.json",
			digest: qualification.qualificationDigest,
		},
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const files = Object.freeze([
		{ file: "qualification.v1.json", bytes: strictJsonCodec.encode(qualification) },
		{ file: "generation.v1.json", bytes: strictJsonCodec.encode(generation) },
	]);
	const finalPath = join(privateRoot, D751_GENERATION_REF);
	const claimPath = join(privateRoot, `.d751-claim-${D751_GENERATION_REF}`);
	const stagingPath = join(privateRoot, `.d751-staging-${randomUUID()}`);
	let faultStage: "after-staging" | "after-commit" | "after-rename" | "after-final-sync" | null =
		null;
	if (Object.hasOwn(input, "fault")) {
		faultStage =
			typeof input.fault === "object" && input.fault !== null
				? (persistenceFaults.get(input.fault) ?? null)
				: null;
		if (faultStage === null) throw new TypeError("D751 persistence fault is invalid or consumed");
		persistenceFaults.delete(input.fault as object);
	}
	const parentHandle = await open(
		privateRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	let parentIdentity: D751FileIdentity | null = null;
	let claimIdentity: D751FileIdentity | null = null;
	let stagingIdentity: D751FileIdentity | null = null;
	let finalIdentity: D751FileIdentity | null = null;
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let operationError: unknown = null;
	const generationDigest = generation.generationDigest;
	try {
		const parentStatus = await parentHandle.stat();
		parentIdentity = { dev: parentStatus.dev, ino: parentStatus.ino };
		await assertD751Directory(privateRoot, parentIdentity, 0o700);
		await mkdir(claimPath, { recursive: false, mode: 0o700 });
		const claimHandle = await open(
			claimPath,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			const claimStatus = await claimHandle.stat();
			claimIdentity = { dev: claimStatus.dev, ino: claimStatus.ino };
			await claimHandle.sync();
			await assertD751Directory(claimPath, claimIdentity, 0o700);
		} finally {
			await claimHandle.close();
		}
		await parentHandle.sync();
		await mkdir(stagingPath, { recursive: false, mode: 0o700 });
		const stagingStatus = await lstat(stagingPath);
		stagingIdentity = { dev: stagingStatus.dev, ino: stagingStatus.ino };
		await assertD751Directory(stagingPath, stagingIdentity, 0o700);
		const artifactsPath = join(stagingPath, "artifacts");
		await mkdir(artifactsPath, { recursive: false, mode: 0o700 });
		artifactsHandle = await open(
			artifactsPath,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		const artifactsStatus = await artifactsHandle.stat();
		const artifactsIdentity = { dev: artifactsStatus.dev, ino: artifactsStatus.ino };
		const identities = new Map<string, D751FileIdentity>();
		for (const file of files)
			identities.set(file.file, await writeD751File(join(artifactsPath, file.file), file.bytes));
		await artifactsHandle.sync();
		for (const file of files)
			await assertD751File(join(artifactsPath, file.file), identities.get(file.file)!, file.bytes);
		if (faultStage === "after-staging") throw new TypeError("D751 injected after-staging failure");
		const commitMaterial = strictSnapshot({
			schemaVersion: "graphrefly.b112.d751.atomic-commit.v1",
			generationRef: D751_GENERATION_REF,
			qualificationDigest: qualification.qualificationDigest,
			generationDigest,
			artifactsDirectory: "artifacts",
		});
		const commitBytes = strictJsonCodec.encode(commitMaterial);
		const commitIdentity = await writeD751File(join(stagingPath, "commit.v1.json"), commitBytes);
		const stagingHandle = await open(
			stagingPath,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		await assertD751File(join(stagingPath, "commit.v1.json"), commitIdentity, commitBytes);
		if (faultStage === "after-commit") throw new TypeError("D751 injected after-commit failure");
		await assertD751Directory(privateRoot, parentIdentity, 0o700);
		await assertD751Directory(claimPath, claimIdentity, 0o700);
		await rename(stagingPath, finalPath);
		finalIdentity = stagingIdentity;
		finalHandle = await open(
			finalPath,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		if (faultStage === "after-rename") throw new TypeError("D751 injected after-rename failure");
		await parentHandle.sync();
		if (faultStage === "after-final-sync")
			throw new TypeError("D751 injected after-final-sync failure");
		await finalHandle.sync();
		const finalArtifactsPath = join(finalPath, "artifacts");
		for (const file of files)
			await assertD751File(
				join(finalArtifactsPath, file.file),
				identities.get(file.file)!,
				file.bytes,
			);
		await assertD751File(join(finalPath, "commit.v1.json"), commitIdentity, commitBytes);
		await assertD751Directory(privateRoot, parentIdentity, 0o700);
		await assertD751Directory(finalPath, finalIdentity, 0o700);
		await assertD751Directory(finalArtifactsPath, artifactsIdentity, 0o700);
		const [finalStable, artifactsStable] = await Promise.all([
			finalHandle.stat(),
			artifactsHandle.stat(),
		]);
		if (
			finalStable.dev !== finalIdentity.dev ||
			finalStable.ino !== finalIdentity.ino ||
			artifactsStable.dev !== artifactsIdentity.dev ||
			artifactsStable.ino !== artifactsIdentity.ino
		)
			throw new TypeError("D751 stable persistence handle drifted");
		for (const file of files)
			await assertD751File(
				join(finalArtifactsPath, file.file),
				identities.get(file.file)!,
				file.bytes,
			);
		await assertD751File(join(finalPath, "commit.v1.json"), commitIdentity, commitBytes);
		await assertD751Directory(finalArtifactsPath, artifactsIdentity, 0o700);
		await assertD751Directory(finalPath, finalIdentity, 0o700);
		await assertD751Directory(privateRoot, parentIdentity, 0o700);
		await rmdir(claimPath);
		claimIdentity = null;
		await parentHandle.sync();
	} catch (error) {
		operationError = error;
	}
	const closes = await Promise.allSettled([
		artifactsHandle?.close() ?? Promise.resolve(),
		finalHandle?.close() ?? Promise.resolve(),
	]);
	const closeErrors = closes
		.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
		.map((entry) => entry.reason);
	if (closeErrors.length > 0)
		operationError = new AggregateError(
			operationError === null ? closeErrors : [operationError, ...closeErrors],
			"D751 persistence handle cleanup failed",
		);
	let cleanupError: unknown = null;
	if (operationError !== null) {
		try {
			if (finalIdentity !== null)
				await removeD751OwnedDirectory(finalPath, finalIdentity, privateRoot, parentHandle);
			else if (stagingIdentity !== null)
				await removeD751OwnedDirectory(stagingPath, stagingIdentity, privateRoot, parentHandle);
			if (claimIdentity !== null) {
				await assertD751Directory(claimPath, claimIdentity, 0o700);
				await rmdir(claimPath);
				await parentHandle.sync();
			}
		} catch (error) {
			cleanupError = error;
		}
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentClose[0]?.status === "rejected") errors.push(parentClose[0].reason);
		if (errors.length > 1) throw new AggregateError(errors, "D751 persistence cleanup failed");
		throw operationError;
	}
	return Object.freeze({
		generationPath: finalPath,
		qualificationDigest: qualification.qualificationDigest,
		generationDigest,
	});
}
