import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	type D722CanonicalGraphEvidenceV1,
	deriveD722CanonicalGraphEvidence,
} from "./d722-graph-completion-memory-insight.js";
import {
	createD726ArmLocalTerminalProviderPolicy,
	type D720ExecutorFailureClassificationV1,
	validateD720GraphEffectResult,
} from "./d722-graph-native-effect-runtime.js";
import {
	createD720SimulatedCallerExecutor,
	type D720CallerEffectExecutionInputV2,
	type D720CallerEffectExecutionV2,
	type D722GraphNativeEvalCoreV1,
	runD722GraphNativeEvalCore,
} from "./d722-graph-native-eval.js";
import {
	admitD724TerminalHttpEvidence,
	createD724TerminalHttpAuthority,
	type D724TerminalHttpGraphEvidenceV1,
	snapshotD724TerminalHttpGraphEvidence,
	validateD724TerminalHttpEvidence,
	validateD724TerminalHttpGraphEvidence,
} from "./d724-terminal-http-evidence.js";
import type {
	D725OpenRouterTurnV1,
	D725OperationalSummaryV1,
} from "./d725-terminal-http-real-provider.js";
import {
	D726_BUDGET_LIMITS,
	D726_COORDINATES_DIGEST,
	D726_D725_QUALIFICATION_COORDINATES,
	D726_DECISION_REF,
	D726_DECISION_REVISION,
	D726_EFFECT_CEILINGS,
	D726_GENERATION_REF,
} from "./d726-coordinates.js";
import {
	consumeD726PrivateImplementationAttestation,
	D726_IMPLEMENTATION_MANIFEST_DIGEST,
	type D726PrivateImplementationAttestationV1,
} from "./d726-implementation-manifest.js";
import {
	consumeD726ExecutionAuthority,
	type D726ExecutionAuthorityV1,
} from "./d726-single-use-dispatch-claim.js";
import { D729_MODEL_SLUG } from "./d729-coordinates.js";
import { readOpenRouterTransportFailureDiagnostic } from "./openrouter-transport-failure.js";

export const D726_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d726.graph-native-live-qualification.v2" as const;
export const D726_OBSERVATION_SCHEMA =
	"graphrefly.b112.d726.graph-native-live-observation.v2" as const;
export const D726_GENERATION_SCHEMA =
	"graphrefly.b112.d726.graph-native-live-generation.v2" as const;
export const D726_BUNDLE_SCHEMA = "graphrefly.b112.d726.graph-native-live-bundle.v2" as const;

export interface D726LiveAdapterBindingV1 {
	readonly revision: "graphrefly.b112.d726.live-adapter-binding.v1";
}

export interface D726ProviderAdapterV1 {
	readonly revision: "graphrefly.b112.d726.provider-adapter.v1";
}

export interface D726ProviderTurnV1 {
	readonly revision: "graphrefly.b112.d726.provider-turn.v1";
}

export interface D726LiveBundleV1 {
	readonly schemaVersion: typeof D726_BUNDLE_SCHEMA;
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	readonly terminalHttpGraphEvidence: D724TerminalHttpGraphEvidenceV1;
	readonly observation: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly bundleDigest: string;
}

type EffectPort = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<D720CallerEffectExecutionV2>;
type ProviderPort = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<D726ProviderTurnV1>;

interface AdapterState {
	readonly executionClass: "injected-no-network" | "live-provider";
	readonly ports: {
		readonly materialization: EffectPort;
		readonly providerRequest: ProviderPort;
		readonly retryWait: EffectPort;
		readonly toolAction: EffectPort;
		readonly hiddenVerifier: EffectPort;
		readonly cleanup: EffectPort;
	};
	consumed: boolean;
}

type ProviderTurnState =
	| {
			readonly kind: "provider-turn";
			readonly turn: D725OpenRouterTurnV1;
			readonly usageBasis: "measured" | "conservative-reservation";
	  }
	| {
			readonly kind: "executor-failure";
			readonly classification: D720ExecutorFailureClassificationV1;
			readonly evidenceDigest: string;
	  };

const adapterStates = new WeakMap<object, AdapterState>();
const providerTurns = new WeakMap<object, ProviderTurnState>();
const liveAdapterBindings = new WeakMap<object, D726ProviderAdapterV1>();
const constructedBundles = new WeakSet<object>();

export function createD726ProviderTurn(
	turn: D725OpenRouterTurnV1,
	usageBasis: "measured" | "conservative-reservation" = "measured",
): D726ProviderTurnV1 {
	if (typeof turn !== "object" || turn === null)
		throw new TypeError("D726 provider turn is invalid");
	oneOf(usageBasis, ["measured", "conservative-reservation"], "d726.providerTurn.usageBasis");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d726.provider-turn.v1" as const,
	});
	providerTurns.set(capability, { kind: "provider-turn", turn, usageBasis });
	return capability;
}

export function createD726ExecutorFailureProviderTurn(inputValue: {
	readonly classification:
		| "executor-threw"
		| "transport-failure"
		| "route-evidence-failure"
		| "response-decode-failure";
	readonly evidenceDigest: string;
}): D726ProviderTurnV1 {
	const input = record(inputValue, "d726.executorFailureTurn");
	exactKeys(input, ["classification", "evidenceDigest"], "d726.executorFailureTurn");
	oneOf(
		input.classification,
		["executor-threw", "transport-failure", "route-evidence-failure", "response-decode-failure"],
		"d726.executorFailureTurn.classification",
	);
	digest(input.evidenceDigest, "d726.executorFailureTurn.evidenceDigest");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d726.provider-turn.v1" as const,
	});
	providerTurns.set(capability, {
		kind: "executor-failure",
		classification: input.classification as D720ExecutorFailureClassificationV1,
		evidenceDigest: input.evidenceDigest as string,
	});
	return capability;
}

export function createD729SanitizedExecutorFailureProviderTurn(
	error: unknown,
	requestDigestValue: string,
): D726ProviderTurnV1 {
	const requestDigest = digest(requestDigestValue, "d729.executorFailure.requestDigest");
	const name = error instanceof Error ? error.name : "unknown";
	const message = error instanceof Error ? error.message : "unknown";
	const bounded = `${name}:${message}`.slice(0, 4_096);
	const transportDiagnostic = readOpenRouterTransportFailureDiagnostic(error);
	const classification: D720ExecutorFailureClassificationV1 =
		transportDiagnostic !== null
			? "transport-failure"
			: /response|choice|tool call|tool arguments|usage|utf-8 json|choice count|finish reason/i.test(
						bounded,
					)
				? "response-decode-failure"
				: /route|selected model|provider evidence|provider metadata/i.test(bounded)
					? "route-evidence-failure"
					: "executor-threw";
	return createD726ExecutorFailureProviderTurn({
		classification,
		evidenceDigest: empiricalStrictJsonDigest({
			boundary: "d729.provider-request",
			classification,
			errorName: name.slice(0, 128),
			requestDigest,
			transportDiagnostic,
		}),
	});
}

export function createD726ProviderAdapter(inputValue: {
	readonly executionClass: "injected-no-network" | "live-provider";
	readonly materialization: EffectPort;
	readonly providerRequest: ProviderPort;
	readonly retryWait: EffectPort;
	readonly toolAction: EffectPort;
	readonly hiddenVerifier: EffectPort;
	readonly cleanup: EffectPort;
}): D726ProviderAdapterV1 {
	const input = record(inputValue, "d726.adapter");
	exactKeys(
		input,
		[
			"cleanup",
			"executionClass",
			"hiddenVerifier",
			"materialization",
			"providerRequest",
			"retryWait",
			"toolAction",
		],
		"d726.adapter",
	);
	oneOf(input.executionClass, ["injected-no-network", "live-provider"], "d726.adapter.class");
	for (const key of [
		"cleanup",
		"hiddenVerifier",
		"materialization",
		"providerRequest",
		"retryWait",
		"toolAction",
	] as const)
		if (typeof input[key] !== "function")
			throw new TypeError(`D726 ${key} port must be an own function`);
	const adapter = Object.freeze({
		revision: "graphrefly.b112.d726.provider-adapter.v1" as const,
	});
	adapterStates.set(adapter, {
		executionClass: input.executionClass as "injected-no-network" | "live-provider",
		ports: {
			materialization: input.materialization as EffectPort,
			providerRequest: input.providerRequest as ProviderPort,
			retryWait: input.retryWait as EffectPort,
			toolAction: input.toolAction as EffectPort,
			hiddenVerifier: input.hiddenVerifier as EffectPort,
			cleanup: input.cleanup as EffectPort,
		},
		consumed: false,
	});
	return adapter;
}

export function createD726LiveAdapterBinding(inputValue: {
	readonly adapter: D726ProviderAdapterV1;
	readonly privateImplementationAttestation: D726PrivateImplementationAttestationV1;
	readonly implementationManifestDigest: string;
	readonly coordinatesDigest: string;
}): D726LiveAdapterBindingV1 {
	const input = record(inputValue, "d726.liveAdapter");
	exactKeys(
		input,
		[
			"adapter",
			"coordinatesDigest",
			"implementationManifestDigest",
			"privateImplementationAttestation",
		],
		"d726.liveAdapter",
	);
	literal(
		digest(input.implementationManifestDigest, "d726.liveAdapter.implementation"),
		D726_IMPLEMENTATION_MANIFEST_DIGEST,
		"d726.liveAdapter.implementation",
	);
	literal(
		consumeD726PrivateImplementationAttestation(
			input.privateImplementationAttestation as D726PrivateImplementationAttestationV1,
		),
		D726_IMPLEMENTATION_MANIFEST_DIGEST,
		"d726.liveAdapter.privateImplementation",
	);
	literal(
		digest(input.coordinatesDigest, "d726.liveAdapter.coordinates"),
		D726_COORDINATES_DIGEST,
		"d726.liveAdapter.coordinates",
	);
	const binding = Object.freeze({
		revision: "graphrefly.b112.d726.live-adapter-binding.v1" as const,
	});
	liveAdapterBindings.set(binding, input.adapter as D726ProviderAdapterV1);
	return binding;
}

function exactCoordinates(input: {
	readonly budgetLimits: unknown;
	readonly effectCeilings: unknown;
}): void {
	if (
		empiricalStrictJsonDigest(input.budgetLimits) !==
			empiricalStrictJsonDigest(D726_BUDGET_LIMITS) ||
		empiricalStrictJsonDigest(input.effectCeilings) !==
			empiricalStrictJsonDigest(D726_EFFECT_CEILINGS)
	)
		throw new TypeError("D726 execution coordinates drifted");
}

function canonicalGraphEvidence(core: D722GraphNativeEvalCoreV1): D722CanonicalGraphEvidenceV1 {
	if (core.ledger.issuedRequests.length !== core.effectRuns.length)
		throw new TypeError(
			`D726 Graph run coverage drifted: ${core.ledger.issuedRequests.length}/${core.effectRuns.length}`,
		);
	return deriveD722CanonicalGraphEvidence(
		core.ledger,
		core.effectRuns,
		createD726ArmLocalTerminalProviderPolicy(),
	);
}

function usageFromGraph(graphEvidence: D722CanonicalGraphEvidenceV1) {
	const proposalKind = new Map(
		graphEvidence.ledger.effectProposals.map((entry) => [entry.effectSequence, entry.effectKind]),
	);
	return graphEvidence.ledger.effectReconciliations.reduce(
		(state, entry) => ({
			requests:
				state.requests + (proposalKind.get(entry.effectSequence) === "provider-request" ? 1 : 0),
			retryWaits:
				state.retryWaits + (proposalKind.get(entry.effectSequence) === "retry-wait" ? 1 : 0),
			costMicrousd: state.costMicrousd + entry.actualCostMicrousd,
			elapsedMs: state.elapsedMs + entry.actualElapsedMs,
			conservativeReservationCount:
				state.conservativeReservationCount + (entry.basis === "conservative-reservation" ? 1 : 0),
		}),
		{
			requests: 0,
			retryWaits: 0,
			costMicrousd: 0,
			elapsedMs: 0,
			conservativeReservationCount: 0,
		},
	);
}

export function validateD726TerminalProviderCoverage(
	graphEvidence: D722CanonicalGraphEvidenceV1,
	terminalHttpGraphEvidence: D724TerminalHttpGraphEvidenceV1,
): void {
	const terminalResults = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.status === "terminal-failure"
				? [{ fact, provenance: fact.result.failureProvenance }]
				: [],
		),
	);
	for (const terminal of terminalResults)
		if (terminal.provenance !== "http-terminal" && terminal.provenance !== "executor-failure")
			throw new TypeError("D726 terminal provider result lacks Graph provenance");
	const expected = terminalResults.flatMap(({ fact, provenance }) =>
		provenance === "http-terminal"
			? [
					{
						request: fact.request.requestDigest,
						admission: fact.admissionDigest,
						result: fact.resultDigest,
					},
				]
			: [],
	);
	if (terminalHttpGraphEvidence.facts.length !== expected.length)
		throw new TypeError("D726 terminal HTTP coverage drifted");
	for (const item of expected) {
		const matches = terminalHttpGraphEvidence.facts.filter(
			(fact) =>
				fact.effectRequestDigest === item.request &&
				fact.effectAdmissionDigest === item.admission &&
				fact.providerResultDigest === item.result,
		);
		if (matches.length !== 1) throw new TypeError("D726 terminal HTTP binding drifted");
	}
}

function validateOperational(
	value: unknown,
	executionClass: "injected-no-network" | "live-provider",
) {
	const candidate = record(value, "d726.operational");
	exactKeys(
		candidate,
		[
			"allEffectsGraphAdmitted",
			"allUsageGraphReconciled",
			"exactTerminalHttpCoverage",
			"executionClass",
			"graphAdmittedEffectCount",
			"graphReconciledEffectCount",
			"graphRetryWaitCount",
			"maxActiveInvocations",
			"terminalHttpAdmissionCount",
			"terminalProviderResultCount",
		],
		"d726.operational",
	);
	literal(candidate.executionClass, executionClass, "d726.operational.executionClass");
	const admitted = safeInteger(candidate.graphAdmittedEffectCount, "d726.operational.admitted", {
		max: 6_144,
	});
	literal(
		safeInteger(candidate.graphReconciledEffectCount, "d726.operational.reconciled", {
			max: 6_144,
		}),
		admitted,
		"d726.operational.reconciled",
	);
	const terminals = safeInteger(
		candidate.terminalProviderResultCount,
		"d726.operational.terminals",
		{
			max: 256,
		},
	);
	literal(
		safeInteger(candidate.terminalHttpAdmissionCount, "d726.operational.http", { max: 256 }),
		terminals,
		"d726.operational.http",
	);
	safeInteger(candidate.graphRetryWaitCount, "d726.operational.retryWaits", { max: 12 });
	if (candidate.maxActiveInvocations !== 0 && candidate.maxActiveInvocations !== 1)
		throw new TypeError("D726 operational maxActiveInvocations is invalid");
	literal(candidate.allEffectsGraphAdmitted, true, "d726.operational.admitted");
	literal(candidate.allUsageGraphReconciled, true, "d726.operational.reconciled");
	literal(candidate.exactTerminalHttpCoverage, true, "d726.operational.terminalCoverage");
	return strictSnapshot(candidate) as unknown as D725OperationalSummaryV1;
}

export async function runD726GraphProviderBlockCore(input: {
	readonly sourceDigest: string;
	readonly budgetLimits: typeof D726_BUDGET_LIMITS;
	readonly effectCeilings: typeof D726_EFFECT_CEILINGS;
	readonly adapter: D726ProviderAdapterV1;
	readonly executionClass: "injected-no-network" | "live-provider";
	readonly signal: AbortSignal;
}) {
	exactCoordinates(input);
	const state = adapterStates.get(input.adapter);
	if (state === undefined || state.consumed)
		throw new TypeError("D726 adapter must be fresh and constructed");
	state.consumed = true;
	if (state.executionClass !== input.executionClass)
		throw new TypeError("D726 adapter execution class drifted");
	let active = 0;
	let maxActive: 0 | 1 = 0;
	const terminalAuthority = createD724TerminalHttpAuthority();
	const executor = createD720SimulatedCallerExecutor(async (executionInput) => {
		if (active !== 0) throw new TypeError("D726 forbids parallel effect execution");
		active = 1;
		maxActive = 1;
		try {
			if (executionInput.effectRequest.effectKind !== "provider-request") {
				const port = {
					materialization: state.ports.materialization,
					"retry-wait": state.ports.retryWait,
					"tool-action": state.ports.toolAction,
					"hidden-verifier": state.ports.hiddenVerifier,
					cleanup: state.ports.cleanup,
				}[executionInput.effectRequest.effectKind];
				return port(executionInput);
			}
			const capability = await state.ports.providerRequest(executionInput);
			const turnState = providerTurns.get(capability);
			if (turnState === undefined)
				throw new TypeError("D726 provider turn is unconstructed or reused");
			providerTurns.delete(capability);
			if (turnState.kind === "executor-failure") {
				const result = validateD720GraphEffectResult(
					{
						effectKind: "provider-request",
						status: "terminal-failure",
						toolIntents: [],
						failureDiscriminator: "none",
						retryAfterMs: null,
						workspaceStateDigest: executionInput.effectRequest.workspaceStateDigest,
						evidenceDigest: turnState.evidenceDigest,
						failureProvenance: "executor-failure",
						executorFailureClassification: turnState.classification,
					},
					executionInput.effectRequest,
				);
				return Object.freeze({
					result,
					actualCostMicrousd: D726_EFFECT_CEILINGS.providerMaxCostMicrousd,
					actualElapsedMs: D726_EFFECT_CEILINGS.providerMaxElapsedMs,
					usageBasis: "conservative-reservation" as const,
				});
			}
			const { turn, usageBasis } = turnState;
			const validatedResult = validateD720GraphEffectResult(
				turn.result,
				executionInput.effectRequest,
			);
			const terminal =
				validatedResult.effectKind === "provider-request" &&
				validatedResult.status === "terminal-failure";
			if (terminal !== (turn.terminalHttpEvidence !== null))
				throw new TypeError("D726 terminal HTTP evidence coverage drifted");
			const result = terminal
				? validateD720GraphEffectResult(
						{
							...validatedResult,
							failureProvenance: "http-terminal",
							executorFailureClassification: null,
						},
						executionInput.effectRequest,
					)
				: validatedResult;
			if (terminal)
				admitD724TerminalHttpEvidence(terminalAuthority, {
					effectRequestDigest: executionInput.effectRequest.requestDigest,
					effectAdmissionDigest: executionInput.admission.decisionDigest,
					providerResultDigest: empiricalStrictJsonDigest(result),
					terminalHttpEvidence: validateD724TerminalHttpEvidence(turn.terminalHttpEvidence),
				});
			return Object.freeze({
				result,
				actualCostMicrousd:
					usageBasis === "conservative-reservation"
						? D726_EFFECT_CEILINGS.providerMaxCostMicrousd
						: safeInteger(turn.actualCostMicrousd, "d726.turn.actualCostMicrousd", {
								max: D726_BUDGET_LIMITS.maxCostMicrousd,
							}),
				actualElapsedMs:
					usageBasis === "conservative-reservation"
						? D726_EFFECT_CEILINGS.providerMaxElapsedMs
						: safeInteger(turn.actualElapsedMs, "d726.turn.actualElapsedMs", {
								max: D726_BUDGET_LIMITS.maxElapsedMs,
							}),
				...(usageBasis === "conservative-reservation" ? { usageBasis } : {}),
			});
		} finally {
			active = 0;
		}
	});
	const core = await runD722GraphNativeEvalCore({
		sourceDigest: digest(input.sourceDigest, "d726.sourceDigest"),
		budgetLimits: input.budgetLimits,
		effectCeilings: input.effectCeilings,
		executor,
		armLocalTerminalPolicy: createD726ArmLocalTerminalProviderPolicy(),
		signal: input.signal,
	});
	const terminalHttpGraphEvidence = snapshotD724TerminalHttpGraphEvidence(terminalAuthority);
	const admitted = core.ledger.effectAdmissions.filter((entry) => entry.admitted);
	const retryWaitCount = core.ledger.effectProposals.filter(
		(entry) =>
			entry.effectKind === "retry-wait" &&
			admitted.some((admission) => admission.effectSequence === entry.effectSequence),
	).length;
	const operational = validateOperational(
		{
			executionClass: input.executionClass,
			graphAdmittedEffectCount: admitted.length,
			graphReconciledEffectCount: core.ledger.effectReconciliations.length,
			terminalProviderResultCount: terminalHttpGraphEvidence.facts.length,
			terminalHttpAdmissionCount: terminalHttpGraphEvidence.facts.length,
			graphRetryWaitCount: retryWaitCount,
			maxActiveInvocations: maxActive,
			allEffectsGraphAdmitted: true,
			allUsageGraphReconciled: true,
			exactTerminalHttpCoverage: true,
		},
		input.executionClass,
	);
	if (operational.maxActiveInvocations !== 1)
		throw new TypeError("D726 block was not strictly serial");
	const graphEvidence = canonicalGraphEvidence(core);
	validateD726TerminalProviderCoverage(graphEvidence, terminalHttpGraphEvidence);
	return Object.freeze({
		graphEvidence,
		terminalHttpGraphEvidence,
		operational,
		usage: usageFromGraph(graphEvidence),
	});
}

function qualification(
	executionClass: "injected-no-network" | "live-provider",
	run: Awaited<ReturnType<typeof runD726GraphProviderBlockCore>>,
	extra: Readonly<Record<string, unknown>>,
) {
	const material = strictSnapshot({
		schemaVersion: D726_QUALIFICATION_SCHEMA,
		decisionRef: D726_DECISION_REF,
		decisionRevision: D726_DECISION_REVISION,
		executionClass,
		coordinatesDigest: D726_COORDINATES_DIGEST,
		implementationManifestDigest: D726_IMPLEMENTATION_MANIFEST_DIGEST,
		d725Qualification: D726_D725_QUALIFICATION_COORDINATES,
		graphEvidenceDigest: run.graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: run.terminalHttpGraphEvidence.evidenceDigest,
		operational: run.operational,
		usage: run.usage,
		...extra,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return strictSnapshot({
		...material,
		qualificationDigest: empiricalStrictJsonDigest(material),
	});
}

export async function runD726InjectedNoNetworkQualification(input: {
	readonly sourceDigest: string;
	readonly adapter: D726ProviderAdapterV1;
	readonly signal: AbortSignal;
}) {
	const run = await runD726GraphProviderBlockCore({
		sourceDigest: input.sourceDigest,
		budgetLimits: D726_BUDGET_LIMITS,
		effectCeilings: D726_EFFECT_CEILINGS,
		adapter: input.adapter,
		executionClass: "injected-no-network",
		signal: input.signal,
	});
	return Object.freeze({
		qualification: qualification("injected-no-network", run, {
			providerTransportCalls: 0,
		}),
		graphEvidence: run.graphEvidence,
		terminalHttpGraphEvidence: run.terminalHttpGraphEvidence,
	});
}

export async function runD726LiveReplacement(input: {
	readonly sourceDigest: string;
	readonly budgetLimits: typeof D726_BUDGET_LIMITS;
	readonly effectCeilings: typeof D726_EFFECT_CEILINGS;
	readonly adapterBinding: D726LiveAdapterBindingV1;
	readonly executionAuthority: D726ExecutionAuthorityV1;
	readonly pricingReadDigest: string;
	readonly pricingObservationDigest: string;
	readonly providerTransportCalls: () => number;
	readonly signal: AbortSignal;
}): Promise<D726LiveBundleV1> {
	exactCoordinates(input);
	const adapter = liveAdapterBindings.get(input.adapterBinding);
	if (adapter === undefined)
		throw new TypeError("D726 live adapter binding is invalid or consumed");
	liveAdapterBindings.delete(input.adapterBinding);
	const authority = consumeD726ExecutionAuthority(input.executionAuthority);
	if (authority.scope !== "live-fixed-root")
		throw new TypeError("D726 live execution requires its fixed-root durable claim");
	literal(
		digest(input.pricingReadDigest, "d726.pricingReadDigest"),
		authority.claim.pricingReadDigest,
		"d726.pricingReadDigest",
	);
	const run = await runD726GraphProviderBlockCore({
		sourceDigest: input.sourceDigest,
		budgetLimits: input.budgetLimits,
		effectCeilings: input.effectCeilings,
		adapter,
		executionClass: "live-provider",
		signal: input.signal,
	});
	const providerTransportCalls = safeInteger(
		input.providerTransportCalls(),
		"d726.providerTransportCalls",
		{ max: 96 },
	);
	if (run.usage.requests !== providerTransportCalls)
		throw new TypeError("D726 provider calls drifted from Graph accounting");
	const liveQualification = qualification("live-provider", run, {
		claimDigest: authority.claim.claimDigest,
		pricingReadDigest: authority.claim.pricingReadDigest,
		pricingObservationDigest: digest(
			input.pricingObservationDigest,
			"d726.pricingObservationDigest",
		),
		zeroByokObservationDigest: authority.claim.zeroByokObservationDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		providerTransportCalls,
	});
	const observationMaterial = strictSnapshot({
		schemaVersion: D726_OBSERVATION_SCHEMA,
		decisionRef: D726_DECISION_REF,
		decisionRevision: D726_DECISION_REVISION,
		executionClass: "live-provider" as const,
		model: D729_MODEL_SLUG,
		provider: "DeepInfra",
		providerSlug: "deepinfra",
		quantization: "fp4",
		endpoint: "chat-completions",
		reasoningEffort: "high",
		qualificationDigest: liveQualification.qualificationDigest,
		graphEvidenceDigest: run.graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: run.terminalHttpGraphEvidence.evidenceDigest,
		graphRunStatus: run.graphEvidence.runStatus,
		completedArms: run.graphEvidence.ledger.completedArms,
		findings: run.graphEvidence.ledger.findings,
		usage: run.usage,
		providerTransportCalls,
		currentKeyAdmission: strictSnapshot({
			admissionDigest: authority.currentKeyAdmission.admissionDigest,
			limitMicrousd: authority.currentKeyAdmission.limitMicrousd,
			remainingMicrousd: authority.currentKeyAdmission.remainingMicrousd,
			usageMicrousd: authority.currentKeyAdmission.usageMicrousd,
			limitReset: authority.currentKeyAdmission.limitReset,
			isManagementKey: authority.currentKeyAdmission.isManagementKey,
		}),
		fallbackUsed: false,
		providerSwitchUsed: false,
		parallelOrBackgroundCalls: false,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const observation = strictSnapshot({
		...observationMaterial,
		observationDigest: empiricalStrictJsonDigest(observationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D726_GENERATION_SCHEMA,
		generationRef: D726_GENERATION_REF,
		qualificationDigest: liveQualification.qualificationDigest,
		observationDigest: observation.observationDigest,
		graphEvidenceDigest: run.graphEvidence.evidenceDigest,
		terminalHttpGraphEvidenceDigest: run.terminalHttpGraphEvidence.evidenceDigest,
		claimDigest: authority.claim.claimDigest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D726_BUNDLE_SCHEMA,
		qualification: liveQualification,
		graphEvidence: run.graphEvidence,
		terminalHttpGraphEvidence: run.terminalHttpGraphEvidence,
		observation,
		generation,
	});
	const bundle = strictSnapshot({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as unknown as D726LiveBundleV1;
	constructedBundles.add(bundle);
	return bundle;
}

function validateQualification(value: unknown) {
	const candidate = record(value, "d726.qualification");
	const executionClass = oneOf(
		candidate.executionClass,
		["injected-no-network", "live-provider"],
		"d726.qualification.class",
	) as "injected-no-network" | "live-provider";
	exactKeys(
		candidate,
		executionClass === "live-provider"
			? [
					"causalAttribution",
					"claimDigest",
					"coordinatesDigest",
					"currentKeyAdmissionDigest",
					"d725Qualification",
					"decisionRef",
					"decisionRevision",
					"efficacyClaim",
					"executionClass",
					"graphEvidenceDigest",
					"implementationManifestDigest",
					"operational",
					"pricingObservationDigest",
					"pricingReadDigest",
					"providerTransportCalls",
					"qualificationDigest",
					"schemaVersion",
					"terminalHttpGraphEvidenceDigest",
					"usage",
					"zeroByokObservationDigest",
				]
			: [
					"causalAttribution",
					"coordinatesDigest",
					"d725Qualification",
					"decisionRef",
					"decisionRevision",
					"efficacyClaim",
					"executionClass",
					"graphEvidenceDigest",
					"implementationManifestDigest",
					"operational",
					"providerTransportCalls",
					"qualificationDigest",
					"schemaVersion",
					"terminalHttpGraphEvidenceDigest",
					"usage",
				],
		"d726.qualification",
	);
	literal(candidate.schemaVersion, D726_QUALIFICATION_SCHEMA, "d726.qualification.schema");
	literal(candidate.decisionRef, D726_DECISION_REF, "d726.qualification.decision");
	literal(candidate.decisionRevision, D726_DECISION_REVISION, "d726.qualification.revision");
	literal(candidate.coordinatesDigest, D726_COORDINATES_DIGEST, "d726.qualification.coordinates");
	literal(
		candidate.implementationManifestDigest,
		D726_IMPLEMENTATION_MANIFEST_DIGEST,
		"d726.qualification.implementation",
	);
	literal(
		empiricalStrictJsonDigest(candidate.d725Qualification),
		empiricalStrictJsonDigest(D726_D725_QUALIFICATION_COORDINATES),
		"d726.qualification.d725",
	);
	digest(candidate.graphEvidenceDigest, "d726.qualification.graph");
	digest(candidate.terminalHttpGraphEvidenceDigest, "d726.qualification.terminal");
	validateOperational(candidate.operational, executionClass);
	const usage = record(candidate.usage, "d726.qualification.usage");
	exactKeys(
		usage,
		["conservativeReservationCount", "costMicrousd", "elapsedMs", "requests", "retryWaits"],
		"d726.qualification.usage",
	);
	for (const key of [
		"conservativeReservationCount",
		"costMicrousd",
		"elapsedMs",
		"requests",
		"retryWaits",
	] as const)
		safeInteger(usage[key], `d726.qualification.usage.${key}`, { max: 1_000_000_000 });
	safeInteger(candidate.providerTransportCalls, "d726.qualification.providerTransportCalls", {
		max: 96,
	});
	if (executionClass === "live-provider") {
		for (const key of [
			"claimDigest",
			"currentKeyAdmissionDigest",
			"pricingObservationDigest",
			"pricingReadDigest",
			"zeroByokObservationDigest",
		] as const)
			digest(candidate[key], `d726.qualification.${key}`);
	}
	literal(candidate.causalAttribution, "undetermined", "d726.qualification.attribution");
	literal(candidate.efficacyClaim, "none", "d726.qualification.efficacy");
	const qualificationDigest = digest(candidate.qualificationDigest, "d726.qualification.digest");
	const { qualificationDigest: _discarded, ...material } = candidate;
	literal(qualificationDigest, empiricalStrictJsonDigest(material), "d726.qualification.digest");
	return strictSnapshot(candidate);
}

export function validateD726LiveBundle(value: unknown): D726LiveBundleV1 {
	const candidate = record(value, "d726.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"generation",
			"graphEvidence",
			"observation",
			"qualification",
			"schemaVersion",
			"terminalHttpGraphEvidence",
		],
		"d726.bundle",
	);
	literal(candidate.schemaVersion, D726_BUNDLE_SCHEMA, "d726.bundle.schema");
	const graphCandidate = record(candidate.graphEvidence, "d726.graphEvidence");
	if (!Array.isArray(graphCandidate.effectRuns) || graphCandidate.effectRuns.length > 12)
		throw new TypeError("D726 Graph effect-run bound exceeded");
	const graphEvidence = deriveD722CanonicalGraphEvidence(
		graphCandidate.ledger,
		graphCandidate.effectRuns as D722CanonicalGraphEvidenceV1["effectRuns"],
		createD726ArmLocalTerminalProviderPolicy(),
	);
	literal(
		empiricalStrictJsonDigest(graphEvidence),
		empiricalStrictJsonDigest(graphCandidate),
		"d726.graphEvidence.replay",
	);
	const terminalHttpGraphEvidence = validateD724TerminalHttpGraphEvidence(
		candidate.terminalHttpGraphEvidence,
	);
	validateD726TerminalProviderCoverage(graphEvidence, terminalHttpGraphEvidence);
	const liveQualification = validateQualification(candidate.qualification);
	literal(liveQualification.executionClass, "live-provider", "d726.qualification.live");
	literal(
		liveQualification.graphEvidenceDigest,
		graphEvidence.evidenceDigest,
		"d726.qualification.graph",
	);
	literal(
		liveQualification.terminalHttpGraphEvidenceDigest,
		terminalHttpGraphEvidence.evidenceDigest,
		"d726.qualification.terminal",
	);
	const observation = record(candidate.observation, "d726.observation");
	exactKeys(
		observation,
		[
			"causalAttribution",
			"completedArms",
			"currentKeyAdmission",
			"decisionRef",
			"decisionRevision",
			"efficacyClaim",
			"endpoint",
			"executionClass",
			"fallbackUsed",
			"findings",
			"graphEvidenceDigest",
			"graphRunStatus",
			"model",
			"observationDigest",
			"parallelOrBackgroundCalls",
			"provider",
			"providerSlug",
			"providerSwitchUsed",
			"providerTransportCalls",
			"qualificationDigest",
			"quantization",
			"reasoningEffort",
			"schemaVersion",
			"terminalHttpGraphEvidenceDigest",
			"usage",
		],
		"d726.observation",
	);
	literal(observation.schemaVersion, D726_OBSERVATION_SCHEMA, "d726.observation.schema");
	literal(observation.decisionRef, D726_DECISION_REF, "d726.observation.decision");
	literal(observation.decisionRevision, D726_DECISION_REVISION, "d726.observation.revision");
	literal(
		observation.qualificationDigest,
		digest(liveQualification.qualificationDigest, "d726.qualification.digest"),
		"d726.observation.qualification",
	);
	literal(observation.graphEvidenceDigest, graphEvidence.evidenceDigest, "d726.observation.graph");
	literal(
		observation.terminalHttpGraphEvidenceDigest,
		terminalHttpGraphEvidence.evidenceDigest,
		"d726.observation.terminal",
	);
	literal(observation.graphRunStatus, graphEvidence.runStatus, "d726.observation.status");
	literal(
		empiricalStrictJsonDigest(observation.completedArms),
		empiricalStrictJsonDigest(graphEvidence.ledger.completedArms),
		"d726.observation.completedArms",
	);
	literal(
		empiricalStrictJsonDigest(observation.findings),
		empiricalStrictJsonDigest(graphEvidence.ledger.findings),
		"d726.observation.findings",
	);
	literal(
		empiricalStrictJsonDigest(observation.usage),
		empiricalStrictJsonDigest(usageFromGraph(graphEvidence)),
		"d726.observation.usage",
	);
	literal(observation.causalAttribution, "undetermined", "d726.observation.attribution");
	literal(observation.efficacyClaim, "none", "d726.observation.efficacy");
	const observationDigest = digest(observation.observationDigest, "d726.observation.digest");
	const { observationDigest: _discardedObservation, ...observationMaterial } = observation;
	literal(
		observationDigest,
		empiricalStrictJsonDigest(observationMaterial),
		"d726.observation.digest",
	);
	const generation = record(candidate.generation, "d726.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"claimDigest",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"observationDigest",
			"qualificationDigest",
			"schemaVersion",
			"terminalHttpGraphEvidenceDigest",
		],
		"d726.generation",
	);
	literal(generation.schemaVersion, D726_GENERATION_SCHEMA, "d726.generation.schema");
	literal(generation.generationRef, D726_GENERATION_REF, "d726.generation.ref");
	literal(
		generation.qualificationDigest,
		digest(liveQualification.qualificationDigest, "d726.qualification.digest"),
		"d726.generation.qualification",
	);
	literal(generation.observationDigest, observationDigest, "d726.generation.observation");
	literal(generation.graphEvidenceDigest, graphEvidence.evidenceDigest, "d726.generation.graph");
	literal(
		generation.terminalHttpGraphEvidenceDigest,
		terminalHttpGraphEvidence.evidenceDigest,
		"d726.generation.terminal",
	);
	const generationDigest = digest(generation.generationDigest, "d726.generation.digest");
	const { generationDigest: _discardedGeneration, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d726.generation.digest",
	);
	const bundleDigest = digest(candidate.bundleDigest, "d726.bundle.digest");
	const material = strictSnapshot({
		schemaVersion: D726_BUNDLE_SCHEMA,
		qualification: liveQualification,
		graphEvidence,
		terminalHttpGraphEvidence,
		observation: strictSnapshot(observation),
		generation: strictSnapshot(generation),
	});
	literal(bundleDigest, empiricalStrictJsonDigest(material), "d726.bundle.digest");
	return strictSnapshot({ ...material, bundleDigest }) as unknown as D726LiveBundleV1;
}

export function consumeConstructedD726LiveBundle(value: unknown): D726LiveBundleV1 {
	if (typeof value !== "object" || value === null || !constructedBundles.delete(value))
		throw new TypeError("D726 persistence requires the exact constructed live bundle");
	return validateD726LiveBundle(value);
}
