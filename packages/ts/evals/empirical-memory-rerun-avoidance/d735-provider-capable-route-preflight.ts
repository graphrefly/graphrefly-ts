import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
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
	strictSnapshot,
} from "./canonical.js";
import type { D733GraphNativeRouteAdmissionV1 } from "./d733-graph-native-route-profile.js";
import { readD733AdmittedRouteProfile } from "./d733-graph-native-route-profile.js";
import type { D734RouteBoundProviderAdapterV1 } from "./d734-route-profile-provider-integration.js";
import {
	runD734RouteProfileSixArmIntegration,
	validateD734RouteGraphEvidence,
} from "./d734-route-profile-provider-integration.js";

export const D735_DECISION_REF = "decision.D735" as const;
export const D735_DECISION_REVISION = "2026-08-11.v1" as const;
export const D735_PREFLIGHT_FACT_SCHEMA = "graphrefly.b112.d735.live-preflight-fact.v1" as const;
export const D735_PREFLIGHT_EVIDENCE_SCHEMA =
	"graphrefly.b112.d735.live-preflight-graph-evidence.v1" as const;
export const D735_ADAPTER_PROVENANCE_SCHEMA =
	"graphrefly.b112.d735.provider-capable-adapter-provenance.v1" as const;

export const D735_PREFLIGHT_STAGES = Object.freeze([
	"implementation-validated",
	"historical-artifact-validated",
	"fresh-pricing-observed",
	"credential-presence-observed",
	"same-credential-zero-byok-observed",
	"route-access-admitted",
	"simulated-dispatch-claim-admitted",
	"current-key-admitted",
	"provider-ready",
] as const);

export type D735PreflightStageV1 = (typeof D735_PREFLIGHT_STAGES)[number];

export interface D735PreflightFactV1 {
	readonly schemaVersion: typeof D735_PREFLIGHT_FACT_SCHEMA;
	readonly sequence: number;
	readonly stage: D735PreflightStageV1;
	readonly evidenceDigest: string;
	readonly routeProfileDigest: string;
	readonly routeAdmissionDigest: string;
	readonly factDigest: string;
}

export interface D735PreflightGraphEvidenceV1 {
	readonly schemaVersion: typeof D735_PREFLIGHT_EVIDENCE_SCHEMA;
	readonly facts: readonly D735PreflightFactV1[];
	readonly evidenceDigest: string;
}

export interface D735ProviderCapableRouteAdapterV1 {
	readonly revision: "graphrefly.b112.d735.provider-capable-route-adapter.v1";
}

export interface D735SimulatedPreflightCapabilityV1 {
	readonly revision: "graphrefly.b112.d735.simulated-live-preflight-capability.v1";
}

interface PreflightAuthorityState {
	readonly proposalNode: Node<unknown>;
	readonly facts: D735PreflightFactV1[];
}

interface PreflightState {
	readonly evidence: D735PreflightGraphEvidenceV1;
	readonly profileDigest: string;
	readonly admissionDigest: string;
}

interface AdapterState {
	readonly adapter: D734RouteBoundProviderAdapterV1;
	readonly profileDigest: string;
	readonly admissionDigest: string;
	readonly adapterSourceDigest: string;
	consumed: boolean;
}

const preflights = new WeakMap<object, PreflightState>();
const adapters = new WeakMap<object, AdapterState>();

function validatePreflightFact(value: unknown, expectedSequence?: number): D735PreflightFactV1 {
	const candidate = record(value, "d735.preflightFact");
	exactKeys(
		candidate,
		[
			"evidenceDigest",
			"factDigest",
			"routeAdmissionDigest",
			"routeProfileDigest",
			"schemaVersion",
			"sequence",
			"stage",
		],
		"d735.preflightFact",
	);
	literal(candidate.schemaVersion, D735_PREFLIGHT_FACT_SCHEMA, "d735.preflightFact.schema");
	const sequence = safeInteger(candidate.sequence, "d735.preflightFact.sequence", {
		min: 0,
		max: D735_PREFLIGHT_STAGES.length - 1,
	});
	if (expectedSequence !== undefined && sequence !== expectedSequence)
		throw new TypeError("D735 preflight sequence drifted");
	literal(candidate.stage, D735_PREFLIGHT_STAGES[sequence], "d735.preflightFact.stage");
	for (const key of ["evidenceDigest", "routeAdmissionDigest", "routeProfileDigest"] as const)
		digest(candidate[key], `d735.preflightFact.${key}`);
	const factDigest = digest(candidate.factDigest, "d735.preflightFact.factDigest");
	const { factDigest: _factDigest, ...material } = candidate;
	literal(factDigest, empiricalStrictJsonDigest(material), "d735.preflightFact.factDigest");
	return strictSnapshot(candidate) as unknown as D735PreflightFactV1;
}

function createPreflightAuthority(): PreflightAuthorityState {
	const owner = graph({ name: "d735/live-preflight-authority" });
	const proposalNode = owner.node<unknown>([], null, { name: "d735/live-preflight-proposals" });
	const admissionNode = owner.node<D735PreflightFactV1>(
		[proposalNode],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) ctx.down([["DATA", validatePreflightFact(raw)]]);
		},
		{ name: "d735/live-preflight-admissions", factory: "d735LivePreflightAdmission" },
	);
	const facts: D735PreflightFactV1[] = [];
	admissionNode.subscribe((message) => {
		if (message[0] !== "DATA") return;
		if (facts.length >= D735_PREFLIGHT_STAGES.length)
			throw new TypeError("D735 preflight fact bound exhausted");
		const fact = validatePreflightFact(message[1], facts.length);
		facts.push(fact);
	});
	return { proposalNode, facts };
}

function admitPreflightFact(
	authority: PreflightAuthorityState,
	input: Omit<D735PreflightFactV1, "factDigest" | "schemaVersion">,
): void {
	const material = strictSnapshot({ schemaVersion: D735_PREFLIGHT_FACT_SCHEMA, ...input });
	authority.proposalNode.down([
		["DATA", Object.freeze({ ...material, factDigest: empiricalStrictJsonDigest(material) })],
	]);
}

export function validateD735PreflightGraphEvidence(value: unknown): D735PreflightGraphEvidenceV1 {
	const candidate = record(value, "d735.preflightEvidence");
	exactKeys(candidate, ["evidenceDigest", "facts", "schemaVersion"], "d735.preflightEvidence");
	literal(candidate.schemaVersion, D735_PREFLIGHT_EVIDENCE_SCHEMA, "d735.preflightEvidence.schema");
	const values = array(candidate.facts, "d735.preflightEvidence.facts");
	if (values.length !== D735_PREFLIGHT_STAGES.length)
		throw new TypeError("D735 preflight evidence is incomplete");
	const facts = Object.freeze(values.map((fact, index) => validatePreflightFact(fact, index)));
	const material = strictSnapshot({ schemaVersion: D735_PREFLIGHT_EVIDENCE_SCHEMA, facts });
	const evidenceDigest = digest(candidate.evidenceDigest, "d735.preflightEvidence.digest");
	literal(evidenceDigest, empiricalStrictJsonDigest(material), "d735.preflightEvidence.digest");
	return strictSnapshot({ ...material, evidenceDigest });
}

export function createD735SimulatedLivePreflight(inputValue: {
	readonly routeAdmission: D733GraphNativeRouteAdmissionV1;
	readonly stageEvidenceDigests: readonly string[];
}): D735SimulatedPreflightCapabilityV1 {
	const input = record(inputValue, "d735.createPreflight");
	exactKeys(input, ["routeAdmission", "stageEvidenceDigests"], "d735.createPreflight");
	const profile = readD733AdmittedRouteProfile(input.routeAdmission);
	const values = array(input.stageEvidenceDigests, "d735.createPreflight.stageEvidenceDigests");
	if (values.length !== D735_PREFLIGHT_STAGES.length)
		throw new TypeError("D735 preflight requires every frozen stage");
	const authority = createPreflightAuthority();
	for (const [sequence, stage] of D735_PREFLIGHT_STAGES.entries())
		admitPreflightFact(authority, {
			sequence,
			stage,
			evidenceDigest: digest(values[sequence], `d735.preflight.stage[${sequence}]`),
			routeProfileDigest: profile.profileDigest,
			routeAdmissionDigest: (input.routeAdmission as D733GraphNativeRouteAdmissionV1)
				.admissionDigest,
		});
	const material = strictSnapshot({
		schemaVersion: D735_PREFLIGHT_EVIDENCE_SCHEMA,
		facts: authority.facts,
	});
	const evidence = validateD735PreflightGraphEvidence({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	});
	const capability = Object.freeze({
		revision: "graphrefly.b112.d735.simulated-live-preflight-capability.v1" as const,
	});
	preflights.set(capability, {
		evidence,
		profileDigest: profile.profileDigest,
		admissionDigest: (input.routeAdmission as D733GraphNativeRouteAdmissionV1).admissionDigest,
	});
	return capability;
}

export function createD735ProviderCapableRouteAdapter(inputValue: {
	readonly routeAdmission: D733GraphNativeRouteAdmissionV1;
	readonly baseAdapter: D734RouteBoundProviderAdapterV1;
	readonly adapterSourceDigest: string;
	readonly executionClass: "injected-no-network";
}): D735ProviderCapableRouteAdapterV1 {
	const input = record(inputValue, "d735.createAdapter");
	exactKeys(
		input,
		["adapterSourceDigest", "baseAdapter", "executionClass", "routeAdmission"],
		"d735.createAdapter",
	);
	literal(input.executionClass, "injected-no-network", "d735.createAdapter.executionClass");
	const profile = readD733AdmittedRouteProfile(input.routeAdmission);
	const capability = Object.freeze({
		revision: "graphrefly.b112.d735.provider-capable-route-adapter.v1" as const,
	});
	adapters.set(capability, {
		adapter: input.baseAdapter as D734RouteBoundProviderAdapterV1,
		profileDigest: profile.profileDigest,
		admissionDigest: (input.routeAdmission as D733GraphNativeRouteAdmissionV1).admissionDigest,
		adapterSourceDigest: digest(input.adapterSourceDigest, "d735.createAdapter.sourceDigest"),
		consumed: false,
	});
	return capability;
}

export async function runD735ProviderCapableSixArmPreflight(inputValue: {
	readonly sourceDigest: string;
	readonly adapter: D735ProviderCapableRouteAdapterV1;
	readonly preflight: D735SimulatedPreflightCapabilityV1;
	readonly signal: AbortSignal;
}) {
	const input = record(inputValue, "d735.run");
	exactKeys(input, ["adapter", "preflight", "signal", "sourceDigest"], "d735.run");
	if (!(input.signal instanceof AbortSignal)) throw new TypeError("D735 signal is invalid");
	const adapter = adapters.get(input.adapter as object);
	const preflight = preflights.get(input.preflight as object);
	if (adapter === undefined || adapter.consumed)
		throw new TypeError("D735 adapter is invalid or consumed");
	if (preflight === undefined) throw new TypeError("D735 preflight is invalid or consumed");
	adapters.delete(input.adapter as object);
	preflights.delete(input.preflight as object);
	adapter.consumed = true;
	for (const [path, actual, expected] of [
		["profile", adapter.profileDigest, preflight.profileDigest],
		["admission", adapter.admissionDigest, preflight.admissionDigest],
	] as const)
		literal(actual, expected, `d735.run.${path}`);
	const integration = await runD734RouteProfileSixArmIntegration({
		sourceDigest: digest(input.sourceDigest, "d735.run.sourceDigest"),
		adapter: adapter.adapter,
		signal: input.signal as AbortSignal,
	});
	validateD734RouteGraphEvidence(integration.routeEvidence);
	return Object.freeze({
		integration,
		preflightEvidence: preflight.evidence,
		adapterProvenance: strictSnapshot({
			schemaVersion: D735_ADAPTER_PROVENANCE_SCHEMA,
			executionClass: "injected-no-network",
			adapterSourceDigest: adapter.adapterSourceDigest,
			profileDigest: adapter.profileDigest,
			admissionDigest: adapter.admissionDigest,
			providerEffectCount: integration.routeEvidence.facts.length,
			maxActiveEffects: 1,
			fallbackUsed: false,
			providerSwitchUsed: false,
			routeSwitchUsed: false,
		}),
	});
}

export function validateD735AdapterProvenance(value: unknown) {
	const candidate = record(value, "d735.adapterProvenance");
	exactKeys(
		candidate,
		[
			"adapterSourceDigest",
			"admissionDigest",
			"executionClass",
			"fallbackUsed",
			"maxActiveEffects",
			"profileDigest",
			"providerEffectCount",
			"providerSwitchUsed",
			"routeSwitchUsed",
			"schemaVersion",
		],
		"d735.adapterProvenance",
	);
	literal(candidate.schemaVersion, D735_ADAPTER_PROVENANCE_SCHEMA, "d735.adapterProvenance.schema");
	literal(candidate.executionClass, "injected-no-network", "d735.adapterProvenance.executionClass");
	for (const key of ["adapterSourceDigest", "admissionDigest", "profileDigest"] as const)
		digest(candidate[key], `d735.adapterProvenance.${key}`);
	safeInteger(candidate.providerEffectCount, "d735.adapterProvenance.providerEffectCount", {
		min: 6,
		max: 96,
	});
	literal(candidate.maxActiveEffects, 1, "d735.adapterProvenance.maxActiveEffects");
	for (const key of ["fallbackUsed", "providerSwitchUsed", "routeSwitchUsed"] as const)
		literal(candidate[key], false, `d735.adapterProvenance.${key}`);
	return strictSnapshot(candidate);
}

export function validateD735FailureClassification(value: unknown): string {
	return oneOf(
		value,
		["terminal-http", "response-decode-failure", "transport-failure", "route-evidence-failure"],
		"d735.failureClassification",
	);
}
