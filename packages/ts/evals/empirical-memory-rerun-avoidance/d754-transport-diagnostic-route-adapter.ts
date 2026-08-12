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

export const D754_TRANSPORT_ADAPTER_REVISION =
	"graphrefly.b112.d754.transport-diagnostic-route-adapter.v1" as const;
export const D754_TRANSPORT_FACT_SCHEMA =
	"graphrefly.b112.d754.graph-admitted-transport-diagnostic-fact.v1" as const;
export const D754_TRANSPORT_EVIDENCE_SCHEMA =
	"graphrefly.b112.d754.transport-diagnostic-graph-evidence.v1" as const;

type EffectPort = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<Readonly<Record<string, unknown>>>;
type ProviderPort = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<D734RouteBoundProviderTurnV1>;

export interface D754TransportDiagnosticFactV1 {
	readonly schemaVersion: typeof D754_TRANSPORT_FACT_SCHEMA;
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

export interface D754TransportDiagnosticGraphEvidenceV1 {
	readonly schemaVersion: typeof D754_TRANSPORT_EVIDENCE_SCHEMA;
	readonly facts: readonly D754TransportDiagnosticFactV1[];
	readonly evidenceDigest: string;
}

export interface D754TransportDiagnosticRouteAdapterV1 {
	readonly revision: typeof D754_TRANSPORT_ADAPTER_REVISION;
	readonly adapter: D734RouteBoundProviderAdapterV1;
}

export interface D754TransportDiagnosticFinalizationV1 {
	readonly transportGraphEvidence: D754TransportDiagnosticGraphEvidenceV1;
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
	const requestDigest = digest(requestDigestValue, "d754.transport.request");
	const transportDiagnostic = validateD751SanitizedTransportDiagnostic(diagnosticValue);
	return empiricalStrictJsonDigest({
		boundary: "d729.provider-request",
		classification: "transport-failure",
		errorName: "OpenRouterTransportFailure",
		requestDigest,
		transportDiagnostic,
	});
}

function validateFact(value: unknown): D754TransportDiagnosticFactV1 {
	const candidate = record(value, "d754.transportFact");
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
		"d754.transportFact",
	);
	literal(candidate.schemaVersion, D754_TRANSPORT_FACT_SCHEMA, "d754.transportFact.schema");
	const material = strictSnapshot({
		schemaVersion: D754_TRANSPORT_FACT_SCHEMA,
		runSequence: safeInteger(candidate.runSequence, "d754.transportFact.run", { max: 5 }),
		effectSequence: safeInteger(candidate.effectSequence, "d754.transportFact.effect", {
			max: 2_047,
		}),
		effectRequestDigest: digest(candidate.effectRequestDigest, "d754.transportFact.request"),
		effectAdmissionDigest: digest(candidate.effectAdmissionDigest, "d754.transportFact.admission"),
		providerResultDigest: digest(candidate.providerResultDigest, "d754.transportFact.result"),
		reconciliationDigest: digest(
			candidate.reconciliationDigest,
			"d754.transportFact.reconciliation",
		),
		phase: oneOf(candidate.phase, ["request", "response-body"], "d754.transportFact.phase"),
		causeCode: validateD751SanitizedTransportDiagnostic({
			schemaVersion: OPENROUTER_TRANSPORT_FAILURE_DIAGNOSTIC_SCHEMA,
			phase: candidate.phase,
			causeCode: candidate.causeCode,
		}).causeCode,
	});
	const factDigest = digest(candidate.factDigest, "d754.transportFact.digest");
	literal(factDigest, empiricalStrictJsonDigest(material), "d754.transportFact.digest");
	return strictSnapshot({ ...material, factDigest });
}

export function validateD754TransportDiagnosticGraphEvidence(
	value: unknown,
	graphEvidence: D722CanonicalGraphEvidenceV1,
): D754TransportDiagnosticGraphEvidenceV1 {
	const candidate = record(value, "d754.transportEvidence");
	exactKeys(candidate, ["evidenceDigest", "facts", "schemaVersion"], "d754.transportEvidence");
	literal(candidate.schemaVersion, D754_TRANSPORT_EVIDENCE_SCHEMA, "d754.transportEvidence.schema");
	const rawFacts = array(candidate.facts, "d754.transportEvidence.facts");
	if (rawFacts.length > 24) throw new TypeError("D754 transport fact bound exceeded");
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
		throw new TypeError("D754 transport Graph fact coverage drifted");
	const byAdmission = new Map(facts.map((fact) => [fact.effectAdmissionDigest, fact] as const));
	if (byAdmission.size !== facts.length)
		throw new TypeError("D754 transport Graph facts are duplicated");
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
			throw new TypeError("D754 transport Graph fact binding drifted");
	}
	const material = strictSnapshot({ schemaVersion: D754_TRANSPORT_EVIDENCE_SCHEMA, facts });
	const evidenceDigest = digest(candidate.evidenceDigest, "d754.transportEvidence.digest");
	literal(evidenceDigest, empiricalStrictJsonDigest(material), "d754.transportEvidence.digest");
	return strictSnapshot({ ...material, evidenceDigest });
}

export function createD754TransportDiagnosticRouteAdapter(inputValue: {
	readonly routeAdmission: D733GraphNativeRouteAdmissionV1;
	readonly executionClass?: "injected-no-network" | "live-provider";
	readonly materialization: EffectPort;
	readonly providerRequest: ProviderPort;
	readonly retryWait: EffectPort;
	readonly toolAction: EffectPort;
	readonly hiddenVerifier: EffectPort;
	readonly cleanup: EffectPort;
}): D754TransportDiagnosticRouteAdapterV1 {
	const input = record(inputValue, "d754.transportAdapter");
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
		"d754.transportAdapter",
	);
	for (const key of [
		"cleanup",
		"hiddenVerifier",
		"materialization",
		"providerRequest",
		"retryWait",
		"toolAction",
	] as const)
		if (typeof input[key] !== "function") throw new TypeError(`D754 ${key} port is invalid`);
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
				throw new TypeError("D754 diagnostic proposal omitted its branded transport failure");
			if (pending.length >= 24) throw new TypeError("D754 diagnostic proposal bound exhausted");
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
	const capability = Object.freeze({ revision: D754_TRANSPORT_ADAPTER_REVISION, adapter });
	states.set(capability, { pending, finalized: false });
	return capability;
}

export function finalizeD754TransportDiagnostics(
	capability: D754TransportDiagnosticRouteAdapterV1,
	graphEvidence: D722CanonicalGraphEvidenceV1,
): D754TransportDiagnosticFinalizationV1 {
	const state = states.get(capability);
	if (state === undefined || state.finalized)
		throw new TypeError("D754 transport adapter state is invalid or consumed");
	state.finalized = true;
	const facts: D754TransportDiagnosticFactV1[] = [];
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
				throw new TypeError("D754 terminal diagnostic proposal lacks exact Graph binding");
			const material = strictSnapshot({
				schemaVersion: D754_TRANSPORT_FACT_SCHEMA,
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
			throw new TypeError("D754 diagnostic proposal has no terminal or D675 Graph disposition");
		retryDiagnosticProposalCount += 1;
	}
	const material = strictSnapshot({ schemaVersion: D754_TRANSPORT_EVIDENCE_SCHEMA, facts });
	const transportGraphEvidence = validateD754TransportDiagnosticGraphEvidence(
		strictSnapshot({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) }),
		graphEvidence,
	);
	return Object.freeze({
		transportGraphEvidence,
		terminalDiagnosticProposalCount: facts.length,
		retryDiagnosticProposalCount,
	});
}
