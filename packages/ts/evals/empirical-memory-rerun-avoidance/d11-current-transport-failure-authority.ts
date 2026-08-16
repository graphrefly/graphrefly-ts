import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import type {
	CurrentGraphProviderAdmittedEffectV1,
	CurrentGraphProviderBudgetLimitsV1,
	CurrentGraphProviderFactV1,
	CurrentGraphProviderRouteProfileV1,
	CurrentGraphProviderTaskProfileV1,
} from "./d6-current-provider-authority.js";
import {
	admitD9ProviderEffectResult,
	createD9ProviderRejectionAuthority,
	type D9ProviderAdmissionOutcomeV1,
	type D9ProviderRejectionAuthorityV1,
	type D9ProviderRejectionEvidenceV1,
	snapshotD9BoundedCanonicalEvidence,
	snapshotD9ProviderRejectionEvidence,
	takeD9ProviderEffect,
	validateD9ProviderRejectionEvidence,
} from "./d9-current-provider-rejection-authority.js";
import {
	consumeD11TransportProposal,
	d11ConservativeTransportResult,
} from "./d11-current-transport-boundary.js";
import {
	D11_TRANSPORT_CAUSES,
	D11_TRANSPORT_ENVELOPE_SCHEMA,
	D11_TRANSPORT_FACT_SCHEMA,
	type D11TransportCause,
	type D11TransportPhase,
	validD11TransportPhaseCause,
} from "./d11-current-transport-contract.js";

export { executeD11TransportBoundary } from "./d11-current-transport-boundary.js";
export type {
	D11TransportCause,
	D11TransportFailureProposalV1,
	D11TransportPhase,
	D11TransportResultEnvelopeV1,
} from "./d11-current-transport-contract.js";
export {
	D11_TRANSPORT_CAUSES,
	D11_TRANSPORT_ENVELOPE_SCHEMA,
	D11_TRANSPORT_FACT_SCHEMA,
	D11_TRANSPORT_PROPOSAL_SCHEMA,
} from "./d11-current-transport-contract.js";
export const D11_TRANSPORT_EVIDENCE_SCHEMA =
	"graphrefly-ts.d11.transport-failure-evidence.v1" as const;
export const D11_TRANSPORT_AUTHORITY_REVISION =
	"graphrefly-ts.d11.transport-failure-authority.v1" as const;

export const D11_D10_FAILURE_BASELINE = Object.freeze({
	implementationCommit: "ced9f5dd983209470c981ef2c7f8cea110a682ff" as const,
	bundleArtifactDigest:
		"sha256:89a620907bb6704d3c77585f4832c9250791344237ac5be3cb6746eb7f6815b0" as const,
	bundleDigest: "sha256:83cb89e02f707861a6693448269e535cb65528859a8786d8e490c3c2cfb7d99e" as const,
	partialGraphDigest:
		"sha256:ddb3418ceff2cd2cec355b2e6bd829232579923642ad5cc706047b9f87c9b5c8" as const,
	terminalReceiptDigest:
		"sha256:c6b0a89c870d0b6b0d1d472bf0931e4f35ad32b7228332c31edfb331774dbe09" as const,
	claimDigest: "sha256:57e53f04cb9603a26eba05405f00e2fd2957de4c4d1e272e59a38af73d9adb03" as const,
});

export interface D11TransportFailureFactV1 {
	readonly schemaVersion: typeof D11_TRANSPORT_FACT_SCHEMA;
	readonly sequence: number;
	readonly arm: CurrentGraphProviderAdmittedEffectV1["request"]["arm"];
	readonly runSequence: number;
	readonly phase: D11TransportPhase;
	readonly causeCode: D11TransportCause;
	readonly request: CurrentGraphProviderFactV1["request"];
	readonly admission: CurrentGraphProviderFactV1["admission"];
	readonly providerFactDigest: string;
	readonly reconciliation: CurrentGraphProviderFactV1["reconciliation"];
	readonly proposalDigest: string;
	readonly factDigest: string;
}

export interface D11TransportFailureEvidenceV1 {
	readonly schemaVersion: typeof D11_TRANSPORT_EVIDENCE_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D11";
	readonly topology: Readonly<{
		runtimeFactNode: "current/d11/transport-failures/runtime-facts";
		canonicalProjectionNode: "current/d11/transport-failures/canonical-projection";
		topologyDigest: string;
	}>;
	readonly d10FailureBaseline: typeof D11_D10_FAILURE_BASELINE;
	readonly d9Evidence: D9ProviderRejectionEvidenceV1;
	readonly transportFacts: readonly D11TransportFailureFactV1[];
	readonly transportFailureCount: number;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D11TransportFailureAuthorityV1 {
	readonly revision: typeof D11_TRANSPORT_AUTHORITY_REVISION;
}

export type D11TransportAdmissionOutcomeV1 = Readonly<{
	providerOutcome: D9ProviderAdmissionOutcomeV1;
	transportFact: D11TransportFailureFactV1 | null;
}>;

interface D11State {
	readonly owner: ReturnType<typeof graph>;
	readonly transportNode: ReturnType<typeof createTransportNode>;
	readonly d9: D9ProviderRejectionAuthorityV1;
	readonly transportFacts: D11TransportFailureFactV1[];
	active: CurrentGraphProviderAdmittedEffectV1 | null;
}

const states = new WeakMap<object, D11State>();

function createTransportNode(owner: ReturnType<typeof graph>) {
	return owner.node<D11TransportFailureFactV1>([], null, {
		name: "current/d11/transport-failures/runtime-facts",
	});
}

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

function exactAcceptedProviderFailure(value: unknown): boolean {
	try {
		const result = record(value, "D11 provider result");
		exactKeys(
			result,
			[
				"effectKind",
				"evidenceDigest",
				"failureCode",
				"retryProposal",
				"status",
				"toolCalls",
				"usage",
			],
			"D11 provider result",
		);
		const usage = record(result.usage, "D11 provider result usage");
		exactKeys(
			usage,
			[
				"actualCostMicrousd",
				"actualElapsedMs",
				"cacheReadTokens",
				"costBasis",
				"inputTokens",
				"outputTokens",
				"requests",
			],
			"D11 provider result usage",
		);
		return (
			result.effectKind === "provider-request" &&
			result.status === "failed" &&
			result.failureCode === "provider-failed" &&
			result.retryProposal === null &&
			Array.isArray(result.toolCalls) &&
			result.toolCalls.length === 0 &&
			usage.requests === 1 &&
			usage.costBasis === "conservative-reservation"
		);
	} catch {
		return false;
	}
}

function topology() {
	const material = strictSnapshot({
		runtimeFactNode: "current/d11/transport-failures/runtime-facts" as const,
		canonicalProjectionNode: "current/d11/transport-failures/canonical-projection" as const,
	});
	return Object.freeze({ ...material, topologyDigest: empiricalStrictJsonDigest(material) });
}

function stateFor(value: unknown): D11State {
	if (value === null || typeof value !== "object")
		throw new TypeError("D11 transport authority must be an object");
	const state = states.get(value);
	if (state === undefined) throw new TypeError("D11 transport authority is forged");
	return state;
}

export function createD11TransportFailureAuthority(input: {
	readonly limits: CurrentGraphProviderBudgetLimitsV1;
	readonly routeProfile: CurrentGraphProviderRouteProfileV1;
	readonly taskProfile: CurrentGraphProviderTaskProfileV1;
}): D11TransportFailureAuthorityV1 {
	const owner = graph({ name: "current/d11/transport-failures/graph-native-eval" });
	const transportNode = createTransportNode(owner);
	const projectionNode = owner.node<D11TransportFailureFactV1>(
		[transportNode],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) ctx.down([["DATA", fact]]);
		},
		{
			name: "current/d11/transport-failures/canonical-projection",
			factory: "d11TransportFailureCanonicalProjection",
		},
	);
	const authority = Object.freeze({ revision: D11_TRANSPORT_AUTHORITY_REVISION });
	const state: D11State = {
		owner,
		transportNode,
		d9: createD9ProviderRejectionAuthority(input),
		transportFacts: [],
		active: null,
	};
	projectionNode.subscribe((message) => {
		if (message[0] === "DATA") state.transportFacts.push(message[1] as D11TransportFailureFactV1);
	});
	states.set(authority, state);
	return authority;
}

export function takeD11ProviderEffect(
	authority: D11TransportFailureAuthorityV1,
): CurrentGraphProviderAdmittedEffectV1 | null {
	const state = stateFor(authority);
	if (state.active !== null)
		throw new TypeError("D11 transport Graph already has a taken active effect");
	const effect = takeD9ProviderEffect(state.d9);
	state.active = effect;
	return effect;
}

export function admitD11ProviderEffectEnvelope(
	authority: D11TransportFailureAuthorityV1,
	requestDigest: string,
	envelopeValue: unknown,
): D11TransportAdmissionOutcomeV1 {
	const state = stateFor(authority);
	const active = state.active;
	if (active === null) throw new TypeError("D11 transport Graph has no taken active effect");
	if (requestDigest !== active.request.requestDigest)
		throw new TypeError("D11 transport result does not match the active request");
	const envelope = ownDataInput(
		envelopeValue,
		["result", "schemaVersion", "transportProposal"],
		"D11 transport envelope",
	);
	if (envelope.schemaVersion !== D11_TRANSPORT_ENVELOPE_SCHEMA)
		throw new TypeError("D11 transport envelope schema drifted");
	const proposalValue = envelope.transportProposal;
	if (proposalValue === null) {
		if (
			active.request.effectKind === "provider-request" &&
			exactAcceptedProviderFailure(envelope.result)
		)
			throw new TypeError("D11 provider failure lacks an admissible transport proposal");
		state.active = null;
		const providerOutcome = admitD9ProviderEffectResult(state.d9, requestDigest, envelope.result);
		return Object.freeze({ providerOutcome, transportFact: null });
	}
	if (active.request.effectKind !== "provider-request")
		throw new TypeError("D11 transport proposal cannot bind a local effect");
	const proposal = consumeD11TransportProposal(proposalValue, active);
	const expectedResult = d11ConservativeTransportResult(active, proposal.phase, proposal.causeCode);
	if (empiricalStrictJsonDigest(envelope.result) !== empiricalStrictJsonDigest(expectedResult))
		throw new TypeError("D11 transport result is not the exact conservative failure");
	state.active = null;
	const providerOutcome = admitD9ProviderEffectResult(state.d9, requestDigest, expectedResult);
	if (providerOutcome.rejectionFact !== null)
		throw new TypeError("D11 transport failure was misclassified as provider-result rejection");
	const providerFact = providerOutcome.providerFact;
	const material = strictSnapshot({
		schemaVersion: D11_TRANSPORT_FACT_SCHEMA,
		sequence: state.transportFacts.length,
		arm: providerFact.arm,
		runSequence: providerFact.runSequence,
		phase: proposal.phase,
		causeCode: proposal.causeCode,
		request: providerFact.request,
		admission: providerFact.admission,
		providerFactDigest: providerFact.factDigest,
		reconciliation: providerFact.reconciliation,
		proposalDigest: proposal.proposalDigest,
	});
	const transportFact = Object.freeze({
		...material,
		factDigest: empiricalStrictJsonDigest(material),
	}) as D11TransportFailureFactV1;
	state.transportNode.down([["DATA", transportFact]]);
	return Object.freeze({ providerOutcome, transportFact });
}

export function snapshotD11TransportFailureEvidence(
	authority: D11TransportFailureAuthorityV1,
): D11TransportFailureEvidenceV1 {
	const state = stateFor(authority);
	if (state.active !== null)
		throw new TypeError("D11 transport evidence has an unadmitted active effect");
	const d9Evidence = validateD9ProviderRejectionEvidence(
		snapshotD9ProviderRejectionEvidence(state.d9),
	);
	const material = strictSnapshot({
		schemaVersion: D11_TRANSPORT_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D11" as const,
		topology: topology(),
		d10FailureBaseline: D11_D10_FAILURE_BASELINE,
		d9Evidence,
		transportFacts: state.transportFacts,
		transportFailureCount: state.transportFacts.length,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	}) as D11TransportFailureEvidenceV1;
}

function validateTransportFact(
	value: unknown,
	index: number,
	d9Evidence: D9ProviderRejectionEvidenceV1,
): D11TransportFailureFactV1 {
	const candidate = record(value, `D11 transport fact[${index}]`);
	exactKeys(
		candidate,
		[
			"admission",
			"arm",
			"causeCode",
			"factDigest",
			"phase",
			"proposalDigest",
			"providerFactDigest",
			"reconciliation",
			"request",
			"runSequence",
			"schemaVersion",
			"sequence",
		],
		`D11 transport fact[${index}]`,
	);
	if (
		candidate.schemaVersion !== D11_TRANSPORT_FACT_SCHEMA ||
		candidate.sequence !== index ||
		(candidate.phase !== "request" && candidate.phase !== "response-body") ||
		!D11_TRANSPORT_CAUSES.includes(candidate.causeCode as D11TransportCause) ||
		!validD11TransportPhaseCause(candidate.phase, candidate.causeCode as D11TransportCause)
	)
		throw new TypeError("D11 transport fact coordinates drifted");
	const providerFactDigest = digest(candidate.providerFactDigest, "D11 providerFactDigest");
	const proposalDigest = digest(candidate.proposalDigest, "D11 proposalDigest");
	const providerFact = d9Evidence.providerEvidence.facts.find(
		(fact) => fact.factDigest === providerFactDigest,
	);
	if (providerFact === undefined) throw new TypeError("D11 transport fact lost its provider fact");
	const causeCode = candidate.causeCode as D11TransportCause;
	const phase = candidate.phase;
	if (
		empiricalStrictJsonDigest(candidate.request) !==
			empiricalStrictJsonDigest(providerFact.request) ||
		empiricalStrictJsonDigest(candidate.admission) !==
			empiricalStrictJsonDigest(providerFact.admission) ||
		empiricalStrictJsonDigest(candidate.reconciliation) !==
			empiricalStrictJsonDigest(providerFact.reconciliation) ||
		providerFact.result.effectKind !== "provider-request" ||
		providerFact.result.status !== "failed" ||
		providerFact.result.failureCode !== "provider-failed" ||
		providerFact.result.retryProposal !== null ||
		providerFact.result.toolCalls.length !== 0 ||
		providerFact.result.usage.costBasis !== "conservative-reservation" ||
		providerFact.result.usage.actualCostMicrousd !==
			providerFact.request.reservation.maxCostMicrousd ||
		providerFact.result.usage.actualElapsedMs !== providerFact.request.reservation.maxElapsedMs ||
		providerFact.result.evidenceDigest !==
			empiricalStrictJsonDigest({
				schemaVersion: D11_TRANSPORT_FACT_SCHEMA,
				requestDigest: providerFact.request.requestDigest,
				phase,
				causeCode,
			})
	)
		throw new TypeError("D11 transport fact lost conservative provider binding");
	const material = strictSnapshot({
		schemaVersion: D11_TRANSPORT_FACT_SCHEMA,
		sequence: index,
		arm: providerFact.arm,
		runSequence: providerFact.runSequence,
		phase,
		causeCode,
		request: providerFact.request,
		admission: providerFact.admission,
		providerFactDigest,
		reconciliation: providerFact.reconciliation,
		proposalDigest,
	});
	const factDigest = digest(candidate.factDigest, "D11 factDigest");
	const { factDigest: _candidateFactDigest, ...candidateMaterial } = candidate;
	if (
		empiricalStrictJsonDigest(candidateMaterial) !== empiricalStrictJsonDigest(material) ||
		factDigest !== empiricalStrictJsonDigest(material)
	)
		throw new TypeError("D11 transport fact digest drifted");
	return Object.freeze({
		...material,
		factDigest,
	}) as D11TransportFailureFactV1;
}

export function validateD11TransportFailureEvidence(value: unknown): D11TransportFailureEvidenceV1 {
	const candidate = record(snapshotD9BoundedCanonicalEvidence(value), "D11 transport evidence");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"d10FailureBaseline",
			"d9Evidence",
			"decisionRef",
			"efficacyClaim",
			"evidenceDigest",
			"schemaVersion",
			"topology",
			"transportFailureCount",
			"transportFacts",
		],
		"D11 transport evidence",
	);
	if (
		candidate.schemaVersion !== D11_TRANSPORT_EVIDENCE_SCHEMA ||
		candidate.decisionRef !== "graphrefly-ts:D11" ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none" ||
		empiricalStrictJsonDigest(candidate.d10FailureBaseline) !==
			empiricalStrictJsonDigest(D11_D10_FAILURE_BASELINE) ||
		empiricalStrictJsonDigest(candidate.topology) !== empiricalStrictJsonDigest(topology()) ||
		!Array.isArray(candidate.transportFacts) ||
		candidate.transportFacts.length > 6 ||
		candidate.transportFailureCount !== candidate.transportFacts.length
	)
		throw new TypeError("D11 transport evidence coordinates drifted");
	const d9Evidence = validateD9ProviderRejectionEvidence(candidate.d9Evidence);
	const transportFacts = candidate.transportFacts.map((fact, index) =>
		validateTransportFact(fact, index, d9Evidence),
	);
	const transportKeys = new Set(transportFacts.map((fact) => fact.providerFactDigest));
	if (transportKeys.size !== transportFacts.length)
		throw new TypeError("D11 transport evidence reused a provider fact");
	const rejectionKeys = new Set(d9Evidence.rejectionFacts.map((fact) => fact.providerFactDigest));
	if ([...transportKeys].some((key) => rejectionKeys.has(key)))
		throw new TypeError("D11 transport and D9 rejection evidence overlap");
	const failedProviderFacts = d9Evidence.providerEvidence.facts.filter(
		(fact) =>
			fact.result.effectKind === "provider-request" &&
			fact.result.status === "failed" &&
			fact.result.failureCode === "provider-failed",
	);
	if (
		failedProviderFacts.length !== transportKeys.size + rejectionKeys.size ||
		failedProviderFacts.some(
			(fact) => !transportKeys.has(fact.factDigest) && !rejectionKeys.has(fact.factDigest),
		)
	)
		throw new TypeError("D11 failed provider facts lack exact failure-family coverage");
	const material = strictSnapshot({
		schemaVersion: D11_TRANSPORT_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D11" as const,
		topology: topology(),
		d10FailureBaseline: D11_D10_FAILURE_BASELINE,
		d9Evidence,
		transportFacts,
		transportFailureCount: transportFacts.length,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const validated = Object.freeze({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	}) as D11TransportFailureEvidenceV1;
	if (candidate.evidenceDigest !== validated.evidenceDigest)
		throw new TypeError("D11 transport evidence digest drifted");
	return validated;
}
