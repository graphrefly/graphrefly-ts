import {
	array,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type { D722CanonicalGraphEvidenceV1 } from "./d722-graph-completion-memory-insight.js";
import type { D720CallerEffectExecutionInputV2 } from "./d722-graph-native-eval.js";
import type { D733GraphNativeRouteAdmissionV1 } from "./d733-graph-native-route-profile.js";
import {
	createD734RouteBoundProviderAdapter,
	type D734RouteBoundProviderAdapterV1,
	type D734RouteBoundProviderTurnV1,
} from "./d734-route-profile-provider-integration.js";
import {
	type D751TransportDiagnosticProposalV1,
	executeD751SanitizedTransportBoundary,
	validateD751SanitizedTransportDiagnostic,
} from "./d751-sanitized-transport-diagnostic.js";
import {
	OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA,
	type OpenRouterTransportFailureDiagnosticV1,
	readOpenRouterTransportFailureDiagnostic,
} from "./openrouter-transport-failure.js";

export const D758_TRANSPORT_ADAPTER_REVISION =
	"graphrefly.b112.d758.transport-diagnostic-route-adapter.v1" as const;
export const D758_TRANSPORT_FACT_SCHEMA =
	"graphrefly.b112.d758.graph-admitted-transport-diagnostic-fact.v1" as const;
export const D758_TRANSPORT_EVIDENCE_SCHEMA =
	"graphrefly.b112.d758.transport-diagnostic-graph-evidence.v1" as const;

type EffectPort = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<Readonly<Record<string, unknown>>>;
type ProviderPort = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<D734RouteBoundProviderTurnV1>;

export interface D758TransportDiagnosticFactV1 {
	readonly schemaVersion: typeof D758_TRANSPORT_FACT_SCHEMA;
	readonly runSequence: number;
	readonly effectSequence: number;
	readonly effectRequestDigest: string;
	readonly effectAdmissionDigest: string;
	readonly providerResultDigest: string;
	readonly reconciliationDigest: string;
	readonly phase: OpenRouterTransportFailureDiagnosticV1["phase"];
	readonly causeCode: OpenRouterTransportFailureDiagnosticV1["causeCode"];
	readonly factDigest: string;
}

export interface D758TransportDiagnosticGraphEvidenceV1 {
	readonly schemaVersion: typeof D758_TRANSPORT_EVIDENCE_SCHEMA;
	readonly facts: readonly D758TransportDiagnosticFactV1[];
	readonly evidenceDigest: string;
}

export interface D758TransportDiagnosticRouteAdapterV1 {
	readonly revision: typeof D758_TRANSPORT_ADAPTER_REVISION;
	readonly adapter: D734RouteBoundProviderAdapterV1;
}

export interface D758TransportDiagnosticFinalizationV1 {
	readonly transportGraphEvidence: D758TransportDiagnosticGraphEvidenceV1;
	readonly terminalDiagnosticProposalCount: number;
	readonly retryDiagnosticProposalCount: number;
}

interface PendingDiagnostic {
	readonly requestDigest: string;
	readonly proposal: D751TransportDiagnosticProposalV1;
	readonly diagnostic: OpenRouterTransportFailureDiagnosticV1;
}

interface AdapterState {
	readonly pending: PendingDiagnostic[];
	finalized: boolean;
}

const states = new WeakMap<object, AdapterState>();

function diagnosticEvidenceDigest(
	requestDigestValue: string,
	diagnosticValue: OpenRouterTransportFailureDiagnosticV1,
): string {
	const requestDigest = digest(requestDigestValue, "d758.transport.request");
	const transportDiagnostic = validateD751SanitizedTransportDiagnostic(diagnosticValue);
	return empiricalStrictJsonDigest({
		boundary: "d729.provider-request",
		classification: "transport-failure",
		errorName: "OpenRouterTransportFailure",
		requestDigest,
		transportDiagnostic,
	});
}

function validateFact(value: unknown): D758TransportDiagnosticFactV1 {
	const candidate = record(value, "d758.transportFact");
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
		"d758.transportFact",
	);
	literal(candidate.schemaVersion, D758_TRANSPORT_FACT_SCHEMA, "d758.transportFact.schema");
	const material = strictSnapshot({
		schemaVersion: D758_TRANSPORT_FACT_SCHEMA,
		runSequence: safeInteger(candidate.runSequence, "d758.transportFact.run", { max: 5 }),
		effectSequence: safeInteger(candidate.effectSequence, "d758.transportFact.effect", {
			max: 2_047,
		}),
		effectRequestDigest: digest(candidate.effectRequestDigest, "d758.transportFact.request"),
		effectAdmissionDigest: digest(candidate.effectAdmissionDigest, "d758.transportFact.admission"),
		providerResultDigest: digest(candidate.providerResultDigest, "d758.transportFact.result"),
		reconciliationDigest: digest(
			candidate.reconciliationDigest,
			"d758.transportFact.reconciliation",
		),
		phase: oneOf(candidate.phase, ["request", "response-body"], "d758.transportFact.phase"),
		causeCode: validateD751SanitizedTransportDiagnostic({
			schemaVersion: OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA,
			phase: candidate.phase,
			causeCode: candidate.causeCode,
		}).causeCode,
	});
	const factDigest = digest(candidate.factDigest, "d758.transportFact.digest");
	literal(factDigest, empiricalStrictJsonDigest(material), "d758.transportFact.digest");
	return strictSnapshot({ ...material, factDigest });
}

export function validateD758TransportDiagnosticGraphEvidence(
	value: unknown,
	graphEvidence: D722CanonicalGraphEvidenceV1,
): D758TransportDiagnosticGraphEvidenceV1 {
	const candidate = record(value, "d758.transportEvidence");
	exactKeys(candidate, ["evidenceDigest", "facts", "schemaVersion"], "d758.transportEvidence");
	literal(candidate.schemaVersion, D758_TRANSPORT_EVIDENCE_SCHEMA, "d758.transportEvidence.schema");
	const rawFacts = array(candidate.facts, "d758.transportEvidence.facts");
	if (rawFacts.length > 24) throw new TypeError("D758 transport fact bound exceeded");
	const facts = Object.freeze(rawFacts.map(validateFact));
	const expected = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.status === "terminal-failure" &&
			fact.result.failureProvenance === "executor-failure" &&
			fact.result.executorFailureClassification === "transport-failure"
				? [{ run, fact }]
				: [],
		),
	);
	if (facts.length !== expected.length)
		throw new TypeError("D758 transport Graph fact coverage drifted");
	const byAdmission = new Map(facts.map((fact) => [fact.effectAdmissionDigest, fact] as const));
	if (byAdmission.size !== facts.length)
		throw new TypeError("D758 transport Graph facts are duplicated");
	for (const item of expected) {
		const fact = byAdmission.get(item.fact.admissionDigest);
		const reconciliation = graphEvidence.ledger.effectReconciliations.filter(
			(value) => value.admissionDigest === item.fact.admissionDigest,
		);
		if (
			fact === undefined ||
			reconciliation.length !== 1 ||
			fact.runSequence !== item.run.runSequence ||
			fact.effectSequence !== item.fact.request.effectSequence ||
			fact.effectRequestDigest !== item.fact.request.requestDigest ||
			fact.providerResultDigest !== item.fact.resultDigest ||
			fact.reconciliationDigest !== reconciliation[0]!.reconciliationDigest ||
			diagnosticEvidenceDigest(fact.effectRequestDigest, {
				schemaVersion: OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA,
				phase: fact.phase,
				causeCode: fact.causeCode,
			}) !== item.fact.result.evidenceDigest
		)
			throw new TypeError("D758 transport Graph fact binding drifted");
	}
	const material = strictSnapshot({ schemaVersion: D758_TRANSPORT_EVIDENCE_SCHEMA, facts });
	const evidenceDigest = digest(candidate.evidenceDigest, "d758.transportEvidence.digest");
	literal(evidenceDigest, empiricalStrictJsonDigest(material), "d758.transportEvidence.digest");
	return strictSnapshot({ ...material, evidenceDigest });
}

export function createD758TransportDiagnosticRouteAdapter(inputValue: {
	readonly routeAdmission: D733GraphNativeRouteAdmissionV1;
	readonly executionClass?: "injected-no-network" | "live-provider";
	readonly materialization: EffectPort;
	readonly providerRequest: ProviderPort;
	readonly retryWait: EffectPort;
	readonly toolAction: EffectPort;
	readonly hiddenVerifier: EffectPort;
	readonly cleanup: EffectPort;
}): D758TransportDiagnosticRouteAdapterV1 {
	const input = record(inputValue, "d758.transportAdapter");
	exactKeys(
		input,
		[
			"cleanup",
			...(Object.hasOwn(input, "executionClass") ? (["executionClass"] as const) : []),
			"hiddenVerifier",
			"materialization",
			"providerRequest",
			"retryWait",
			"routeAdmission",
			"toolAction",
		],
		"d758.transportAdapter",
	);
	for (const key of [
		"cleanup",
		"hiddenVerifier",
		"materialization",
		"providerRequest",
		"retryWait",
		"toolAction",
	] as const)
		if (typeof input[key] !== "function") throw new TypeError(`D758 ${key} port is invalid`);
	const pending: PendingDiagnostic[] = [];
	const providerRequest = input.providerRequest as ProviderPort;
	const adapter = createD734RouteBoundProviderAdapter({
		routeAdmission: input.routeAdmission as D733GraphNativeRouteAdmissionV1,
		...(Object.hasOwn(input, "executionClass")
			? { executionClass: input.executionClass as "injected-no-network" | "live-provider" }
			: {}),
		materialization: input.materialization as never,
		retryWait: input.retryWait as never,
		toolAction: input.toolAction as never,
		hiddenVerifier: input.hiddenVerifier as never,
		cleanup: input.cleanup as never,
		async providerRequest(executionInput) {
			let capturedFailure: unknown = null;
			const sanitized = await executeD751SanitizedTransportBoundary(async () => {
				try {
					return (await Reflect.apply(providerRequest, undefined, [executionInput])) as never;
				} catch (error) {
					capturedFailure = error;
					throw error;
				}
			}, executionInput.effectRequest.requestDigest);
			if (sanitized.proposal === null)
				return sanitized.turn as unknown as D734RouteBoundProviderTurnV1;
			const diagnostic = readOpenRouterTransportFailureDiagnostic(capturedFailure);
			if (diagnostic === null)
				throw new TypeError("D758 diagnostic proposal omitted its branded transport failure");
			if (pending.length >= 24) throw new TypeError("D758 diagnostic proposal bound exhausted");
			pending.push(
				Object.freeze({
					requestDigest: executionInput.effectRequest.requestDigest,
					proposal: sanitized.proposal,
					diagnostic: validateD751SanitizedTransportDiagnostic(diagnostic),
				}),
			);
			throw capturedFailure;
		},
	});
	const capability = Object.freeze({ revision: D758_TRANSPORT_ADAPTER_REVISION, adapter });
	states.set(capability, { pending, finalized: false });
	return capability;
}

export function finalizeD758TransportDiagnostics(
	capability: D758TransportDiagnosticRouteAdapterV1,
	graphEvidence: D722CanonicalGraphEvidenceV1,
): D758TransportDiagnosticFinalizationV1 {
	const state = states.get(capability);
	if (state === undefined || state.finalized)
		throw new TypeError("D758 transport adapter state is invalid or consumed");
	state.finalized = true;
	const facts: D758TransportDiagnosticFactV1[] = [];
	let retryDiagnosticProposalCount = 0;
	for (const pending of state.pending) {
		void pending.proposal;
		const matches = graphEvidence.effectRuns.flatMap((run) =>
			run.facts.flatMap((fact) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.request.requestDigest === pending.requestDigest
					? [{ run, fact }]
					: [],
			),
		);
		const terminal = matches.filter(
			(item) =>
				item.fact.kind === "graph-effect-result-admitted" &&
				item.fact.result.status === "terminal-failure" &&
				item.fact.result.failureProvenance === "executor-failure" &&
				item.fact.result.executorFailureClassification === "transport-failure",
		);
		if (terminal.length === 1 && terminal[0]!.fact.kind === "graph-effect-result-admitted") {
			const item = terminal[0]!;
			const reconciliation = graphEvidence.ledger.effectReconciliations.filter(
				(value) => value.admissionDigest === item.fact.admissionDigest,
			);
			if (
				reconciliation.length !== 1 ||
				diagnosticEvidenceDigest(pending.requestDigest, pending.diagnostic) !==
					item.fact.result.evidenceDigest
			)
				throw new TypeError("D758 terminal diagnostic proposal lacks exact Graph binding");
			const material = strictSnapshot({
				schemaVersion: D758_TRANSPORT_FACT_SCHEMA,
				runSequence: item.run.runSequence,
				effectSequence: item.fact.request.effectSequence,
				effectRequestDigest: item.fact.request.requestDigest,
				effectAdmissionDigest: item.fact.admissionDigest,
				providerResultDigest: item.fact.resultDigest,
				reconciliationDigest: reconciliation[0]!.reconciliationDigest,
				phase: pending.diagnostic.phase,
				causeCode: pending.diagnostic.causeCode,
			});
			facts.push(strictSnapshot({ ...material, factDigest: empiricalStrictJsonDigest(material) }));
			continue;
		}
		const retry = matches.filter(
			(item) =>
				item.fact.kind === "graph-effect-result-admitted" &&
				item.fact.result.status === "retryable-failure" &&
				item.fact.result.failureDiscriminator === "d675-und-err-socket",
		);
		if (retry.length !== 1)
			throw new TypeError("D758 diagnostic proposal has no terminal or D675 Graph disposition");
		retryDiagnosticProposalCount += 1;
	}
	const material = strictSnapshot({ schemaVersion: D758_TRANSPORT_EVIDENCE_SCHEMA, facts });
	const transportGraphEvidence = validateD758TransportDiagnosticGraphEvidence(
		strictSnapshot({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) }),
		graphEvidence,
	);
	return Object.freeze({
		transportGraphEvidence,
		terminalDiagnosticProposalCount: facts.length,
		retryDiagnosticProposalCount,
	});
}
