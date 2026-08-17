import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import {
	D17_ARMS,
	D17_GATE_SCHEMA,
	D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
	type D17AdmittedEffectFactV1,
	type D17PositiveDifferentialGateV1,
	validateD17Evidence,
} from "./d17-current-efficacy-authority.js";
import {
	admitD18EffectResult,
	createD18Authority,
	type D18AdmittedEffectV1,
	type D18EvidenceV1,
	type D18ProviderFactV1,
	snapshotD18Evidence,
	takeD18Effect,
	validateD18Evidence,
} from "./d18-current-provider-composition-authority.js";
import {
	createD19RealProviderAdapter,
	type D19RealProviderAdapterOptionsV1,
} from "./d19-current-real-provider-adapter.js";
import { validateD19QualificationBundle } from "./d19-current-real-provider-qualification.js";
import {
	consumeD20ExecutionAuthority,
	type D20DispatchClaimV1,
	type D20ExecutionAuthorityV1,
} from "./d20-current-live-claim.js";
import {
	D20_COORDINATES_DIGEST,
	D20_D19_ARTIFACT_DIGEST,
	D20_D19_BUNDLE_DIGEST,
	D20_D19_GENERATION_DIGEST,
	D20_D19_IMPLEMENTATION_MANIFEST_DIGEST,
	D20_D19_QUALIFICATION_DIGEST,
	D20_DECISION_REF,
	D20_GENERATION_REF,
} from "./d20-current-live-coordinates.js";
import type { D20CredentialV1 } from "./d20-current-live-preflight.js";

export const D20_BASELINE_ADMISSION_REVISION =
	"graphrefly-ts.d20.d19-baseline-admission.v1" as const;
export const D20_BUNDLE_SCHEMA = "graphrefly-ts.d20.live-bundle.v1" as const;
export const D20_PARTIAL_GRAPH_SCHEMA = "graphrefly-ts.d20.partial-graph-evidence.v1" as const;
export const D20_GENERATION_SCHEMA = "graphrefly-ts.d20.live-generation.v1" as const;
export const D20_TERMINAL_RECEIPT_SCHEMA = "graphrefly-ts.d20.live-terminal-receipt.v1" as const;
export const D20_PERSISTENCE_SCHEMA = "graphrefly-ts.d20.live-persistence.v1" as const;
export const D20_PREEXECUTION_FAILURE_SCHEMA =
	"graphrefly-ts.d20.live-preexecution-failure.v1" as const;
export const D20_MAX_BUNDLE_BYTES = 4_194_304;

export interface D20D19BaselineAdmissionV1 {
	readonly revision: typeof D20_BASELINE_ADMISSION_REVISION;
}

export interface D20PartialGraphEvidenceV1 {
	readonly schemaVersion: typeof D20_PARTIAL_GRAPH_SCHEMA;
	readonly decisionRef: typeof D20_DECISION_REF;
	readonly coordinatesDigest: string;
	readonly admittedFacts: readonly (D18ProviderFactV1 | D17AdmittedEffectFactV1)[];
	readonly activeRequestDigest: string | null;
	readonly failureCode:
		| "adapter-execution-failed"
		| "graph-admission-failed"
		| "effect-bound-exhausted"
		| "adapter-disposal-failed";
	readonly failureEffectKind: string | null;
	readonly partialGraphDigest: string;
}

export interface D20LiveBundleV1 {
	readonly schemaVersion: typeof D20_BUNDLE_SCHEMA;
	readonly decisionRef: typeof D20_DECISION_REF;
	readonly executionClass: "live-provider" | "injected-no-network";
	readonly disposition: "success" | "partial-failure";
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly d19ArtifactDigest: typeof D20_D19_ARTIFACT_DIGEST;
	readonly d19BundleDigest: typeof D20_D19_BUNDLE_DIGEST;
	readonly d19QualificationDigest: typeof D20_D19_QUALIFICATION_DIGEST;
	readonly d19GenerationDigest: typeof D20_D19_GENERATION_DIGEST;
	readonly d19ImplementationManifestDigest: typeof D20_D19_IMPLEMENTATION_MANIFEST_DIGEST;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly claimDigest: string;
	readonly currentKeyAdmissionDigest: string;
	readonly graphEvidence: D18EvidenceV1 | null;
	readonly partialGraphEvidence: D20PartialGraphEvidenceV1 | null;
	readonly gate: D17PositiveDifferentialGateV1;
	readonly generation: Readonly<Record<string, unknown>> | null;
	readonly terminalReceipt: Readonly<Record<string, unknown>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none" | "frozen-task-block-positive-differential";
	readonly bundleDigest: string;
}

const baselineAdmissions = new WeakMap<object, "exact-private-artifact" | "injected-test">();
const constructedBundles = new WeakSet<object>();

function baselineAdmission(
	basis: "exact-private-artifact" | "injected-test",
): D20D19BaselineAdmissionV1 {
	const value = Object.freeze({ revision: D20_BASELINE_ADMISSION_REVISION });
	baselineAdmissions.set(value, basis);
	return value;
}

export function admitD20D19Baseline(bytesValue: Uint8Array): D20D19BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D20 D19 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D20_D19_ARTIFACT_DIGEST)
		throw new TypeError("D20 D19 artifact digest drifted");
	const bundle = validateD19QualificationBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.bundleDigest !== D20_D19_BUNDLE_DIGEST ||
		bundle.qualification.qualificationDigest !== D20_D19_QUALIFICATION_DIGEST ||
		bundle.generation.generationDigest !== D20_D19_GENERATION_DIGEST ||
		bundle.implementationManifestDigest !== D20_D19_IMPLEMENTATION_MANIFEST_DIGEST ||
		bundle.baseline.basis !== "exact-private-artifact"
	)
		throw new TypeError("D20 D19 baseline canonical projection drifted");
	return baselineAdmission("exact-private-artifact");
}

export function createD20InjectedD19BaselineForTest(): D20D19BaselineAdmissionV1 {
	return baselineAdmission("injected-test");
}

function consumeBaseline(
	value: D20D19BaselineAdmissionV1,
	executionClass: "live-provider" | "injected-no-network",
): void {
	const basis =
		typeof value === "object" && value !== null ? baselineAdmissions.get(value) : undefined;
	if (basis === undefined) throw new TypeError("D20 D19 baseline is forged or replayed");
	baselineAdmissions.delete(value);
	if (executionClass === "live-provider" && basis !== "exact-private-artifact")
		throw new TypeError("D20 D19 baseline execution class drifted");
}

function evaluateGate(evidence: D18EvidenceV1, evaluated: boolean): D17PositiveDifferentialGateV1 {
	const workflow = validateD17Evidence(evidence.workflowEvidence);
	const failures: string[] = [];
	if (workflow.runs.length !== D17_ARMS.length) failures.push("six-arm-completion-missing");
	for (let index = 0; index < D17_ARMS.length; index += 1) {
		const arm = D17_ARMS[index]!;
		const run = workflow.runs[index];
		if (run?.arm !== arm) failures.push(`arm-order:${arm}`);
		if (run?.evaluable !== true) failures.push(`not-evaluable:${arm}`);
		if (run?.providerFailureFamily !== null) failures.push(`provider-failure:${arm}`);
		if (run?.cleanupCompleted !== true) failures.push(`cleanup:${arm}`);
		if (run?.hiddenVerifierPassed !== (arm === "relevant-applied"))
			failures.push(`hidden-differential:${arm}`);
	}
	const material = strictSnapshot({
		schemaVersion: D17_GATE_SCHEMA,
		definitionDigest: D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
		evaluated,
		passed: evaluated && failures.length === 0,
		failureCodes: Object.freeze(failures),
	});
	return Object.freeze({
		...material,
		gateDigest: empiricalStrictJsonDigest(material),
	}) as D17PositiveDifferentialGateV1;
}

export function evaluateD20PositiveDifferentialGateForTest(
	evidence: D18EvidenceV1,
): D17PositiveDifferentialGateV1 {
	return evaluateGate(validateD18Evidence(evidence), true);
}

function partialEvidence(input: {
	readonly facts: readonly (D18ProviderFactV1 | D17AdmittedEffectFactV1)[];
	readonly active: D18AdmittedEffectV1 | null;
	readonly failureCode: D20PartialGraphEvidenceV1["failureCode"];
}): D20PartialGraphEvidenceV1 {
	const request =
		input.active?.kind === "workflow-local"
			? input.active.workflowEffect.request
			: input.active?.request;
	const material = strictSnapshot({
		schemaVersion: D20_PARTIAL_GRAPH_SCHEMA,
		decisionRef: D20_DECISION_REF,
		coordinatesDigest: D20_COORDINATES_DIGEST,
		admittedFacts: Object.freeze([...input.facts]),
		activeRequestDigest: request?.requestDigest ?? null,
		failureCode: input.failureCode,
		failureEffectKind:
			input.active?.kind === "workflow-local"
				? input.active.workflowEffect.request.effectKind
				: (input.active?.kind ?? null),
	});
	return Object.freeze({
		...material,
		partialGraphDigest: empiricalStrictJsonDigest(material),
	}) as D20PartialGraphEvidenceV1;
}

function partialAccounting(
	facts: readonly (D18ProviderFactV1 | D17AdmittedEffectFactV1)[],
): Readonly<{ providerAttempts: number; confirmedCostMicrousd: number }> {
	let providerAttempts = 0;
	let confirmedCostMicrousd = 0;
	for (const fact of facts) {
		if (fact.schemaVersion !== "graphrefly-ts.d18.provider-fact.v1") continue;
		const providerFact = fact as D18ProviderFactV1;
		if (providerFact.request.schemaVersion === "graphrefly-ts.d18.provider-attempt-request.v1")
			providerAttempts += 1;
		confirmedCostMicrousd += providerFact.reconciliation.actualCostMicrousd;
	}
	return Object.freeze({ providerAttempts, confirmedCostMicrousd });
}

type Adapter = ReturnType<typeof createD19RealProviderAdapter>;

async function drive(input: {
	readonly executionAuthority: D20ExecutionAuthorityV1;
	readonly baseline: D20D19BaselineAdmissionV1;
	readonly executionClass: "live-provider" | "injected-no-network";
	readonly adapter: Adapter;
	readonly implementationManifestDigest: string;
}): Promise<D20LiveBundleV1> {
	consumeBaseline(input.baseline, input.executionClass);
	const authority = consumeD20ExecutionAuthority(input.executionAuthority);
	if (
		authority.claim.implementationManifestDigest !== input.implementationManifestDigest ||
		(authority.claim.scope === "live-fixed-root") !== (input.executionClass === "live-provider")
	)
		throw new TypeError("D20 execution authority scope drifted");
	const graph = createD18Authority();
	const facts: (D18ProviderFactV1 | D17AdmittedEffectFactV1)[] = [];
	let active: D18AdmittedEffectV1 | null = null;
	let graphEvidence: D18EvidenceV1 | null = null;
	let failureCode: D20PartialGraphEvidenceV1["failureCode"] | null = null;
	try {
		for (let guard = 0; guard < 512; guard += 1) {
			active = takeD18Effect(graph);
			if (active === null) {
				graphEvidence = validateD18Evidence(snapshotD18Evidence(graph));
				break;
			}
			let executed: Awaited<ReturnType<Adapter["execute"]>>;
			try {
				executed = await input.adapter.execute(graph, active);
			} catch {
				failureCode = "adapter-execution-failed";
				break;
			}
			try {
				facts.push(admitD18EffectResult(graph, active, executed.result, executed.runtimeMaterial));
			} catch {
				failureCode = "graph-admission-failed";
				break;
			}
		}
		if (graphEvidence === null && failureCode === null) failureCode = "effect-bound-exhausted";
	} finally {
		try {
			await input.adapter.dispose();
		} catch {
			failureCode ??= "adapter-disposal-failed";
		}
	}
	if (input.adapter.maxActiveEffects() > 1)
		throw new TypeError("D20 adapter violated serial execution");
	if (input.adapter.workspaceResidueCount() !== 0) failureCode ??= "adapter-disposal-failed";
	const success = graphEvidence !== null && failureCode === null;
	const gate = success
		? evaluateGate(graphEvidence!, input.executionClass === "live-provider")
		: (Object.freeze({
				schemaVersion: D17_GATE_SCHEMA,
				definitionDigest: D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
				evaluated: false,
				passed: false,
				failureCodes: Object.freeze(["measurement-incomplete"]),
				gateDigest: empiricalStrictJsonDigest({
					schemaVersion: D17_GATE_SCHEMA,
					definitionDigest: D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
					evaluated: false,
					passed: false,
					failureCodes: ["measurement-incomplete"],
				}),
			}) as D17PositiveDifferentialGateV1);
	const efficacyClaim = gate.passed
		? ("frozen-task-block-positive-differential" as const)
		: ("none" as const);
	const partialGraphEvidence = success
		? null
		: partialEvidence({
				facts,
				active,
				failureCode: failureCode ?? "graph-admission-failed",
			});
	const partialUsage = partialAccounting(facts);
	const generation = success
		? (() => {
				const material = strictSnapshot({
					schemaVersion: D20_GENERATION_SCHEMA,
					generationRef: D20_GENERATION_REF,
					coordinatesDigest: D20_COORDINATES_DIGEST,
					graphEvidenceDigest: graphEvidence!.evidenceDigest,
					gateDigest: gate.gateDigest,
					implementationManifestDigest: input.implementationManifestDigest,
					qualificationArtifactDigest: authority.claim.qualificationArtifactDigest,
					qualificationDigest: authority.claim.qualificationDigest,
					causalAttribution: "undetermined" as const,
					efficacyClaim,
				});
				return Object.freeze({
					...material,
					generationDigest: empiricalStrictJsonDigest(material),
				});
			})()
		: null;
	const terminalMaterial = strictSnapshot({
		schemaVersion: D20_TERMINAL_RECEIPT_SCHEMA,
		decisionRef: D20_DECISION_REF,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		graphEvidenceDigest: graphEvidence?.evidenceDigest ?? null,
		partialGraphDigest: partialGraphEvidence?.partialGraphDigest ?? null,
		gateDigest: gate.gateDigest,
		providerAttempts: graphEvidence?.budget.providerAttempts ?? partialUsage.providerAttempts,
		confirmedCostMicrousd:
			graphEvidence?.budget.actualCostMicrousd ?? partialUsage.confirmedCostMicrousd,
		failureCode,
		causalAttribution: "undetermined" as const,
		efficacyClaim,
	});
	const terminalReceipt = Object.freeze({
		...terminalMaterial,
		terminalReceiptDigest: empiricalStrictJsonDigest(terminalMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D20_BUNDLE_SCHEMA,
		decisionRef: D20_DECISION_REF,
		executionClass: input.executionClass,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		coordinatesDigest: D20_COORDINATES_DIGEST,
		implementationManifestDigest: input.implementationManifestDigest,
		d19ArtifactDigest: D20_D19_ARTIFACT_DIGEST,
		d19BundleDigest: D20_D19_BUNDLE_DIGEST,
		d19QualificationDigest: D20_D19_QUALIFICATION_DIGEST,
		d19GenerationDigest: D20_D19_GENERATION_DIGEST,
		d19ImplementationManifestDigest: D20_D19_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: authority.claim.qualificationArtifactDigest,
		qualificationDigest: authority.claim.qualificationDigest,
		pricingObservationDigest: authority.claim.pricingObservationDigest,
		zeroByokObservationDigest: authority.claim.zeroByokObservationDigest,
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		graphEvidence,
		partialGraphEvidence,
		gate,
		generation,
		terminalReceipt,
		causalAttribution: "undetermined" as const,
		efficacyClaim,
	});
	const bundle = Object.freeze({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as D20LiveBundleV1;
	if (
		strictJsonCodec.encode(bundle as unknown as StrictJsonValue).byteLength > D20_MAX_BUNDLE_BYTES
	)
		throw new TypeError("D20 bundle exceeds its byte bound");
	constructedBundles.add(bundle);
	return bundle;
}

function credentialBinding(credential: D20CredentialV1): string {
	return empiricalStrictJsonDigest({
		credentialBindingRef: credential.credentialBindingRef,
		credentialBindingRevision: credential.credentialBindingRevision,
		keyVisiblePrefix: credential.bearerToken.slice(0, 12),
		keyVisibleSuffix: credential.bearerToken.slice(-3),
	});
}

export async function runD20LiveMeasurement(input: {
	readonly executionAuthority: D20ExecutionAuthorityV1;
	readonly baseline: D20D19BaselineAdmissionV1;
	readonly credential: D20CredentialV1;
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly implementationManifestDigest: string;
	readonly now: () => number;
	readonly sleep: (ms: number) => Promise<void>;
}): Promise<D20LiveBundleV1> {
	if (
		input.executionAuthority.claim.scope !== "live-fixed-root" ||
		credentialBinding(input.credential) !== input.executionAuthority.claim.credentialBindingDigest
	)
		throw new TypeError("D20 live credential or claim scope drifted");
	const adapter = createD19RealProviderAdapter({
		repositoryRoot: input.repositoryRoot,
		materializationRoot: input.materializationRoot,
		fetchImpl: globalThis.fetch,
		bearerToken: input.credential.bearerToken,
		now: input.now,
		sleep: input.sleep,
	});
	return drive({
		executionAuthority: input.executionAuthority,
		baseline: input.baseline,
		executionClass: "live-provider",
		adapter,
		implementationManifestDigest: input.implementationManifestDigest,
	});
}

export async function runD20InjectedMeasurementForTest(input: {
	readonly executionAuthority: D20ExecutionAuthorityV1;
	readonly baseline: D20D19BaselineAdmissionV1;
	readonly adapterOptions: D19RealProviderAdapterOptionsV1;
	readonly implementationManifestDigest: string;
}): Promise<D20LiveBundleV1> {
	return drive({
		executionAuthority: input.executionAuthority,
		baseline: input.baseline,
		executionClass: "injected-no-network",
		adapter: createD19RealProviderAdapter(input.adapterOptions),
		implementationManifestDigest: input.implementationManifestDigest,
	});
}

function validatePartial(value: unknown): D20PartialGraphEvidenceV1 {
	const candidate = record(value, "D20 partial Graph evidence");
	exactKeys(
		candidate,
		[
			"activeRequestDigest",
			"admittedFacts",
			"coordinatesDigest",
			"decisionRef",
			"failureCode",
			"failureEffectKind",
			"partialGraphDigest",
			"schemaVersion",
		],
		"D20 partial Graph evidence",
	);
	if (
		candidate.schemaVersion !== D20_PARTIAL_GRAPH_SCHEMA ||
		candidate.decisionRef !== D20_DECISION_REF ||
		candidate.coordinatesDigest !== D20_COORDINATES_DIGEST ||
		![
			"adapter-execution-failed",
			"graph-admission-failed",
			"effect-bound-exhausted",
			"adapter-disposal-failed",
		].includes(String(candidate.failureCode))
	)
		throw new TypeError("D20 partial Graph coordinates drifted");
	const facts = array(candidate.admittedFacts, "D20 partial Graph facts");
	if (facts.length > 512) throw new TypeError("D20 partial Graph facts exceed their bound");
	for (const [index, value] of facts.entries()) {
		const fact = record(value, `D20 partial Graph facts[${index}]`);
		const factDigest = digest(fact.factDigest, `D20 partial Graph facts[${index}].factDigest`);
		const { factDigest: _removed, ...factMaterial } = fact;
		if (factDigest !== empiricalStrictJsonDigest(factMaterial))
			throw new TypeError("D20 partial Graph fact digest drifted");
	}
	if (candidate.activeRequestDigest !== null)
		digest(candidate.activeRequestDigest, "D20 partial Graph active request");
	if (
		candidate.failureEffectKind !== null &&
		(typeof candidate.failureEffectKind !== "string" ||
			Buffer.byteLength(candidate.failureEffectKind, "utf8") > 64)
	)
		throw new TypeError("D20 partial Graph effect kind is invalid");
	const { partialGraphDigest, ...material } = candidate;
	if (partialGraphDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D20 partial Graph digest drifted");
	return strictSnapshot(candidate) as unknown as D20PartialGraphEvidenceV1;
}

export function validateD20LiveBundle(value: unknown): D20LiveBundleV1 {
	const candidate = record(value, "D20 bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"claimDigest",
			"coordinatesDigest",
			"currentKeyAdmissionDigest",
			"d19ArtifactDigest",
			"d19BundleDigest",
			"d19GenerationDigest",
			"d19ImplementationManifestDigest",
			"d19QualificationDigest",
			"decisionRef",
			"disposition",
			"efficacyClaim",
			"executionClass",
			"gate",
			"generation",
			"graphEvidence",
			"implementationManifestDigest",
			"partialGraphEvidence",
			"pricingObservationDigest",
			"qualificationArtifactDigest",
			"qualificationDigest",
			"schemaVersion",
			"terminalReceipt",
			"zeroByokObservationDigest",
		],
		"D20 bundle",
	);
	if (
		candidate.schemaVersion !== D20_BUNDLE_SCHEMA ||
		candidate.decisionRef !== D20_DECISION_REF ||
		candidate.coordinatesDigest !== D20_COORDINATES_DIGEST ||
		candidate.d19ArtifactDigest !== D20_D19_ARTIFACT_DIGEST ||
		candidate.d19BundleDigest !== D20_D19_BUNDLE_DIGEST ||
		candidate.d19QualificationDigest !== D20_D19_QUALIFICATION_DIGEST ||
		candidate.d19GenerationDigest !== D20_D19_GENERATION_DIGEST ||
		candidate.d19ImplementationManifestDigest !== D20_D19_IMPLEMENTATION_MANIFEST_DIGEST ||
		candidate.causalAttribution !== "undetermined"
	)
		throw new TypeError("D20 bundle coordinates drifted");
	for (const key of [
		"bundleDigest",
		"claimDigest",
		"currentKeyAdmissionDigest",
		"implementationManifestDigest",
		"pricingObservationDigest",
		"qualificationArtifactDigest",
		"qualificationDigest",
		"zeroByokObservationDigest",
	] as const)
		digest(candidate[key], `D20 bundle.${key}`);
	const graphEvidence =
		candidate.graphEvidence === null ? null : validateD18Evidence(candidate.graphEvidence);
	const partialGraphEvidence =
		candidate.partialGraphEvidence === null
			? null
			: validatePartial(candidate.partialGraphEvidence);
	if (
		(candidate.disposition === "success" &&
			(graphEvidence === null || partialGraphEvidence !== null || candidate.generation === null)) ||
		(candidate.disposition === "partial-failure" &&
			(graphEvidence !== null || partialGraphEvidence === null || candidate.generation !== null))
	)
		throw new TypeError("D20 bundle disposition projection drifted");
	const executionClass = oneOf(
		candidate.executionClass,
		["live-provider", "injected-no-network"],
		"D20 bundle.executionClass",
	);
	oneOf(candidate.disposition, ["success", "partial-failure"], "D20 bundle.disposition");
	const expectedGate =
		graphEvidence === null
			? Object.freeze({
					schemaVersion: D17_GATE_SCHEMA,
					definitionDigest: D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
					evaluated: false,
					passed: false,
					failureCodes: Object.freeze(["measurement-incomplete"]),
					gateDigest: empiricalStrictJsonDigest({
						schemaVersion: D17_GATE_SCHEMA,
						definitionDigest: D17_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
						evaluated: false,
						passed: false,
						failureCodes: ["measurement-incomplete"],
					}),
				})
			: evaluateGate(graphEvidence, executionClass === "live-provider");
	if (empiricalStrictJsonDigest(candidate.gate) !== empiricalStrictJsonDigest(expectedGate))
		throw new TypeError("D20 live gate projection drifted");
	const expectedClaim = expectedGate.passed ? "frozen-task-block-positive-differential" : "none";
	if (candidate.efficacyClaim !== expectedClaim) throw new TypeError("D20 efficacy claim drifted");
	const terminal = record(candidate.terminalReceipt, "D20 terminal receipt");
	exactKeys(
		terminal,
		[
			"causalAttribution",
			"claimDigest",
			"confirmedCostMicrousd",
			"currentKeyAdmissionDigest",
			"decisionRef",
			"disposition",
			"efficacyClaim",
			"failureCode",
			"gateDigest",
			"graphEvidenceDigest",
			"partialGraphDigest",
			"providerAttempts",
			"schemaVersion",
			"terminalReceiptDigest",
		],
		"D20 terminal receipt",
	);
	const expectedUsage =
		graphEvidence === null
			? partialAccounting(partialGraphEvidence!.admittedFacts)
			: {
					providerAttempts: graphEvidence.budget.providerAttempts,
					confirmedCostMicrousd: graphEvidence.budget.actualCostMicrousd,
				};
	if (
		terminal.schemaVersion !== D20_TERMINAL_RECEIPT_SCHEMA ||
		terminal.decisionRef !== D20_DECISION_REF ||
		terminal.disposition !== candidate.disposition ||
		terminal.claimDigest !== candidate.claimDigest ||
		terminal.currentKeyAdmissionDigest !== candidate.currentKeyAdmissionDigest ||
		terminal.graphEvidenceDigest !== (graphEvidence?.evidenceDigest ?? null) ||
		terminal.partialGraphDigest !== (partialGraphEvidence?.partialGraphDigest ?? null) ||
		terminal.gateDigest !== expectedGate.gateDigest ||
		terminal.providerAttempts !== expectedUsage.providerAttempts ||
		terminal.confirmedCostMicrousd !== expectedUsage.confirmedCostMicrousd ||
		terminal.causalAttribution !== "undetermined" ||
		terminal.efficacyClaim !== expectedClaim ||
		terminal.failureCode !==
			(partialGraphEvidence === null ? null : partialGraphEvidence.failureCode)
	)
		throw new TypeError("D20 terminal receipt projection drifted");
	safeInteger(terminal.providerAttempts, "D20 terminal provider attempts", { max: 96 });
	safeInteger(terminal.confirmedCostMicrousd, "D20 terminal cost", { max: 6_000_000 });
	const { terminalReceiptDigest, ...terminalMaterial } = terminal;
	if (terminalReceiptDigest !== empiricalStrictJsonDigest(terminalMaterial))
		throw new TypeError("D20 terminal receipt digest drifted");
	if (candidate.generation !== null) {
		const generation = record(candidate.generation, "D20 generation");
		exactKeys(
			generation,
			[
				"causalAttribution",
				"coordinatesDigest",
				"efficacyClaim",
				"gateDigest",
				"generationDigest",
				"generationRef",
				"graphEvidenceDigest",
				"implementationManifestDigest",
				"qualificationArtifactDigest",
				"qualificationDigest",
				"schemaVersion",
			],
			"D20 generation",
		);
		if (
			generation.schemaVersion !== D20_GENERATION_SCHEMA ||
			generation.generationRef !== D20_GENERATION_REF ||
			generation.coordinatesDigest !== D20_COORDINATES_DIGEST ||
			generation.graphEvidenceDigest !== graphEvidence?.evidenceDigest ||
			generation.gateDigest !== expectedGate.gateDigest ||
			generation.implementationManifestDigest !== candidate.implementationManifestDigest ||
			generation.qualificationArtifactDigest !== candidate.qualificationArtifactDigest ||
			generation.qualificationDigest !== candidate.qualificationDigest ||
			generation.causalAttribution !== "undetermined" ||
			generation.efficacyClaim !== expectedClaim
		)
			throw new TypeError("D20 generation projection drifted");
		const { generationDigest, ...generationMaterial } = generation;
		if (generationDigest !== empiricalStrictJsonDigest(generationMaterial))
			throw new TypeError("D20 generation digest drifted");
	}
	const { bundleDigest, ...material } = candidate;
	if (bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D20 bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D20LiveBundleV1;
}

export async function persistD20LiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D20LiveBundleV1;
}) {
	const input = record(inputValue, "D20 persistence input");
	exactKeys(input, ["bundle", "privateRoot"], "D20 persistence input");
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("D20 persistence requires a same-process unconsumed bundle");
	const bundle = validateD20LiveBundle(input.bundle);
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const terminalBytes = strictJsonCodec.encode(
		bundle.terminalReceipt as unknown as StrictJsonValue,
	);
	const artifacts: Record<string, Uint8Array> = {
		"bundle.v1.json": bundleBytes,
		"terminal-receipt.v1.json": terminalBytes,
	};
	if (bundle.generation !== null)
		artifacts["generation.v1.json"] = strictJsonCodec.encode(
			bundle.generation as unknown as StrictJsonValue,
		);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d20.live-commit.v1",
		generationRef: D20_GENERATION_REF,
		disposition: bundle.disposition,
		bundleDigest: bundle.bundleDigest,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		terminalReceiptDigest: digest(
			bundle.terminalReceipt.terminalReceiptDigest,
			"D20 terminal receipt digest",
		),
		generationDigest:
			bundle.generation === null
				? null
				: digest(bundle.generation.generationDigest, "D20 generation digest"),
	});
	const commit = Object.freeze({
		...commitMaterial,
		commitDigest: empiricalStrictJsonDigest(commitMaterial),
	});
	const receipt = await persistCurrentGraphPrivateGeneration({
		privateRoot: String(input.privateRoot),
		generationRef: D20_GENERATION_REF,
		artifacts,
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
	return Object.freeze({
		schemaVersion: D20_PERSISTENCE_SCHEMA,
		generationRef: D20_GENERATION_REF,
		disposition: bundle.disposition,
		bundleDigest: bundle.bundleDigest,
		commitDigest: commit.commitDigest,
		persistenceReceiptDigest: receipt.receiptDigest,
		persistenceDigest: empiricalStrictJsonDigest({
			bundleDigest: bundle.bundleDigest,
			commitDigest: commit.commitDigest,
			persistenceReceiptDigest: receipt.receiptDigest,
		}),
	});
}

export async function persistD20PreexecutionFailure(inputValue: {
	readonly privateRoot: string;
	readonly claim: D20DispatchClaimV1;
	readonly implementationManifestDigest: string;
	readonly failurePhase: "current-key-admission" | "execution-construction";
}) {
	const input = record(inputValue, "D20 preexecution failure input");
	exactKeys(
		input,
		["claim", "failurePhase", "implementationManifestDigest", "privateRoot"],
		"D20 preexecution failure input",
	);
	const claim = record(input.claim, "D20 preexecution failure claim");
	if (
		claim.decisionRef !== D20_DECISION_REF ||
		claim.generationRef !== D20_GENERATION_REF ||
		claim.scope !== "live-fixed-root" ||
		claim.coordinatesDigest !== D20_COORDINATES_DIGEST ||
		claim.implementationManifestDigest !== input.implementationManifestDigest ||
		(input.failurePhase !== "current-key-admission" &&
			input.failurePhase !== "execution-construction")
	)
		throw new TypeError("D20 preexecution failure coordinates drifted");
	for (const key of [
		"claimDigest",
		"implementationManifestDigest",
		"pricingObservationDigest",
		"qualificationArtifactDigest",
		"qualificationDigest",
		"zeroByokObservationDigest",
	] as const)
		digest(claim[key], `D20 preexecution failure claim.${key}`);
	const failureMaterial = strictSnapshot({
		schemaVersion: D20_PREEXECUTION_FAILURE_SCHEMA,
		decisionRef: D20_DECISION_REF,
		generationRef: D20_GENERATION_REF,
		disposition: "partial-failure" as const,
		failurePhase: input.failurePhase as "current-key-admission" | "execution-construction",
		failureCode: "preexecution-admission-failed" as const,
		coordinatesDigest: D20_COORDINATES_DIGEST,
		claimDigest: claim.claimDigest,
		implementationManifestDigest: claim.implementationManifestDigest,
		qualificationArtifactDigest: claim.qualificationArtifactDigest,
		qualificationDigest: claim.qualificationDigest,
		pricingObservationDigest: claim.pricingObservationDigest,
		zeroByokObservationDigest: claim.zeroByokObservationDigest,
		providerAttempts: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const failure = Object.freeze({
		...failureMaterial,
		failureDigest: empiricalStrictJsonDigest(failureMaterial),
	});
	const bytes = strictJsonCodec.encode(failure as unknown as StrictJsonValue);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d20.live-commit.v1",
		generationRef: D20_GENERATION_REF,
		disposition: "partial-failure" as const,
		bundleDigest: null,
		bundleArtifactDigest: null,
		terminalReceiptDigest: failure.failureDigest,
		generationDigest: null,
	});
	const commit = Object.freeze({
		...commitMaterial,
		commitDigest: empiricalStrictJsonDigest(commitMaterial),
	});
	const receipt = await persistCurrentGraphPrivateGeneration({
		privateRoot: String(input.privateRoot),
		generationRef: D20_GENERATION_REF,
		artifacts: { "preexecution-failure.v1.json": bytes },
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
	return Object.freeze({
		schemaVersion: D20_PERSISTENCE_SCHEMA,
		generationRef: D20_GENERATION_REF,
		disposition: "partial-failure" as const,
		failureDigest: failure.failureDigest,
		commitDigest: commit.commitDigest,
		persistenceReceiptDigest: receipt.receiptDigest,
		persistenceDigest: empiricalStrictJsonDigest({
			failureDigest: failure.failureDigest,
			commitDigest: commit.commitDigest,
			persistenceReceiptDigest: receipt.receiptDigest,
		}),
	});
}
