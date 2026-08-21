import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import type { CurrentGraphProviderFactV1 } from "./d6-current-provider-authority.js";
import { CURRENT_GRAPH_LIVE_ROUTE } from "./d8-current-live-coordinates.js";
import {
	D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
	D21_TASK_PROFILE,
} from "./d21-current-efficacy-recovery-authority.js";
import {
	admitD41EffectResult,
	createD41InferenceAuthority,
	type D41InferenceEvidenceV1,
	snapshotD41InferenceEvidence,
	takeD41AdmittedEffect,
	validateD41InferenceEvidence,
} from "./d41-phase-specific-inference-authority.js";
import { validateD41QualificationBundle } from "./d41-phase-specific-inference-qualification.js";
import {
	createD41PhaseSpecificRealProviderExecutor,
	type D41PhaseSpecificRealProviderExecutorV1,
} from "./d41-phase-specific-real-provider-composition.js";
import {
	consumeD42ExecutionAuthority,
	consumeD42PreexecutionFailureAuthority,
	type D42ExecutionAuthorityV1,
	type D42PreexecutionFailureAuthorityV1,
} from "./d42-phase-specific-inference-live-claim.js";
import {
	D42_COORDINATES_DIGEST,
	D42_D41_ARTIFACT_DIGEST,
	D42_D41_BUNDLE_DIGEST,
	D42_D41_GENERATION_DIGEST,
	D42_D41_IMPLEMENTATION_MANIFEST_DIGEST,
	D42_D41_MAIN_EVIDENCE_DIGEST,
	D42_D41_QUALIFICATION_DIGEST,
	D42_DECISION_REF,
	D42_GENERATION_REF,
	D42_REPAIRED_LIVE_LIMITS,
} from "./d42-phase-specific-inference-live-coordinates.js";
import {
	D42_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD42Implementation,
} from "./d42-phase-specific-inference-live-implementation-manifest.js";
import type { D42CredentialV1 } from "./d42-phase-specific-inference-live-preflight.js";

export const D42_BASELINE_ADMISSION_REVISION =
	"graphrefly-ts.d42.d41-baseline-admission.v1" as const;
export const D42_BUNDLE_SCHEMA = "graphrefly-ts.d42.premature-final-live-bundle.v1" as const;
export const D42_GATE_SCHEMA = "graphrefly-ts.d42.positive-differential-gate.v1" as const;
export const D42_PARTIAL_SCHEMA = "graphrefly-ts.d42.partial-graph-evidence.v1" as const;
export const D42_GENERATION_SCHEMA = "graphrefly-ts.d42.live-generation.v1" as const;
export const D42_TERMINAL_SCHEMA = "graphrefly-ts.d42.live-terminal-receipt.v1" as const;
export const D42_MAX_BUNDLE_BYTES = 8_388_608;

export interface D42D41BaselineAdmissionV1 {
	readonly revision: typeof D42_BASELINE_ADMISSION_REVISION;
}

export interface D42PositiveDifferentialGateV1 {
	readonly schemaVersion: typeof D42_GATE_SCHEMA;
	readonly definitionDigest: string;
	readonly evaluated: boolean;
	readonly passed: boolean;
	readonly failureCodes: readonly string[];
	readonly gateDigest: string;
}

export interface D42PartialGraphEvidenceV1 {
	readonly schemaVersion: typeof D42_PARTIAL_SCHEMA;
	readonly decisionRef: typeof D42_DECISION_REF;
	readonly coordinatesDigest: string;
	readonly providerFacts: readonly CurrentGraphProviderFactV1[];
	readonly activeRequestDigest: string | null;
	readonly activeAdmissionDigest: string | null;
	readonly activeEffectKind: string | null;
	readonly completedGraphEvidence: D41InferenceEvidenceV1 | null;
	readonly failureCode:
		| "executor-boundary-failed"
		| "graph-admission-failed"
		| "effect-bound-exhausted"
		| "executor-disposal-failed";
	readonly partialGraphDigest: string;
}

export interface D42LiveBundleV1 {
	readonly schemaVersion: typeof D42_BUNDLE_SCHEMA;
	readonly decisionRef: typeof D42_DECISION_REF;
	readonly executionClass: "live-provider" | "injected-no-network";
	readonly disposition: "success" | "partial-failure";
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly d41ArtifactDigest: typeof D42_D41_ARTIFACT_DIGEST;
	readonly d41BundleDigest: typeof D42_D41_BUNDLE_DIGEST;
	readonly d41MainEvidenceDigest: typeof D42_D41_MAIN_EVIDENCE_DIGEST;
	readonly d41GenerationDigest: typeof D42_D41_GENERATION_DIGEST;
	readonly d41QualificationDigest: typeof D42_D41_QUALIFICATION_DIGEST;
	readonly d41ImplementationManifestDigest: typeof D42_D41_IMPLEMENTATION_MANIFEST_DIGEST;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly claimDigest: string;
	readonly currentKeyAdmissionDigest: string;
	readonly graphEvidence: D41InferenceEvidenceV1 | null;
	readonly partialGraphEvidence: D42PartialGraphEvidenceV1 | null;
	readonly gate: D42PositiveDifferentialGateV1;
	readonly generation: Readonly<Record<string, StrictJsonValue>> | null;
	readonly terminalReceipt: Readonly<Record<string, StrictJsonValue>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none" | "frozen-task-block-positive-differential";
	readonly bundleDigest: string;
}

const baselines = new WeakMap<object, "consumed-d41-artifact" | "injected-test">();
const constructed = new WeakSet<object>();

function makeBaseline(basis: "consumed-d41-artifact" | "injected-test") {
	const value = Object.freeze({ revision: D42_BASELINE_ADMISSION_REVISION });
	baselines.set(value, basis);
	return value;
}

export function admitD42D41Baseline(bytesValue: Uint8Array): D42D41BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D42 D41 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D42_D41_ARTIFACT_DIGEST)
		throw new TypeError("D42 D41 immutable artifact drifted");
	const bundle = validateD41QualificationBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.baselineBasis !== "consumed-d40-artifact" ||
		bundle.bundleDigest !== D42_D41_BUNDLE_DIGEST ||
		bundle.mainEvidence.evidenceDigest !== D42_D41_MAIN_EVIDENCE_DIGEST ||
		bundle.generation.generationDigest !== D42_D41_GENERATION_DIGEST ||
		bundle.qualification.qualificationDigest !== D42_D41_QUALIFICATION_DIGEST ||
		bundle.qualification.implementationManifestDigest !== D42_D41_IMPLEMENTATION_MANIFEST_DIGEST ||
		bundle.qualification.efficacyClaim !== "none"
	)
		throw new TypeError("D42 D41 immutable coordinates drifted");
	return makeBaseline("consumed-d41-artifact");
}

export function createD42InjectedBaselineForTest(): D42D41BaselineAdmissionV1 {
	return makeBaseline("injected-test");
}

function consumeBaseline(
	value: unknown,
	expected: "consumed-d41-artifact" | "injected-test",
): void {
	if (value === null || typeof value !== "object") throw new TypeError("D42 baseline is invalid");
	const basis = baselines.get(value);
	baselines.delete(value);
	if (basis !== expected) throw new TypeError("D42 baseline is forged, replayed or drifted");
}

function credentialBinding(credential: D42CredentialV1): string {
	return empiricalStrictJsonDigest({
		credentialBindingRef: credential.credentialBindingRef,
		credentialBindingRevision: credential.credentialBindingRevision,
		keyVisiblePrefix: credential.bearerToken.slice(0, 12),
		keyVisibleSuffix: credential.bearerToken.slice(-3),
	});
}

const ARMS = [
	"cold",
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
] as const;

function evaluateGate(
	evidence: D41InferenceEvidenceV1 | null,
	evaluated: boolean,
): D42PositiveDifferentialGateV1 {
	const failures: string[] = [];
	if (evidence === null) failures.push("measurement-incomplete");
	else {
		const phase = evidence.retainedSpanEvidence.phaseEvidence;
		const provider = phase.workflowEvidence;
		const workflow = provider.providerEvidence.workflowEvidence;
		if (provider.rejectionCount !== 0) failures.push("provider-result-rejection");
		if (workflow.runStatus !== "complete" || workflow.runs.length !== ARMS.length)
			failures.push("six-arm-completion-missing");
		for (const [index, arm] of ARMS.entries()) {
			const run = workflow.runs[index];
			if (run?.arm !== arm) failures.push(`arm-order:${arm}`);
			if (
				run?.status !== "completed" ||
				run.publicSemanticValidationAttempted !== true ||
				run.publicSemanticValidationPassed !== true ||
				run.hiddenVerifierAttempted !== true ||
				run.cleanupStatus !== "completed"
			)
				failures.push(`not-evaluable:${arm}`);
			if (run?.hiddenVerifierPassed !== (arm === "relevant-applied"))
				failures.push(`hidden-differential:${arm}`);
		}
		if (
			provider.providerEvidence.facts.some(
				(fact) => fact.result.effectKind === "provider-request" && fact.result.status === "failed",
			)
		)
			failures.push("provider-attempt-failure");
		if (phase.phaseFacts.some((fact) => fact.disposition.endsWith("rejected")))
			failures.push("phase-admission-failure");
	}
	const material = strictSnapshot({
		schemaVersion: D42_GATE_SCHEMA,
		definitionDigest: D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
		evaluated,
		passed: evaluated && failures.length === 0,
		failureCodes: Object.freeze(failures),
	});
	return Object.freeze({ ...material, gateDigest: empiricalStrictJsonDigest(material) });
}

function partialEvidence(input: {
	readonly providerFacts: readonly CurrentGraphProviderFactV1[];
	readonly activeRequestDigest: string | null;
	readonly activeAdmissionDigest: string | null;
	readonly activeEffectKind: string | null;
	readonly completedGraphEvidence: D41InferenceEvidenceV1 | null;
	readonly failureCode: D42PartialGraphEvidenceV1["failureCode"];
}): D42PartialGraphEvidenceV1 {
	const material = strictSnapshot({
		schemaVersion: D42_PARTIAL_SCHEMA,
		decisionRef: D42_DECISION_REF,
		coordinatesDigest: D42_COORDINATES_DIGEST,
		providerFacts: input.providerFacts,
		activeRequestDigest: input.activeRequestDigest,
		activeAdmissionDigest: input.activeAdmissionDigest,
		activeEffectKind: input.activeEffectKind,
		completedGraphEvidence: input.completedGraphEvidence,
		failureCode: input.failureCode,
	});
	return Object.freeze({ ...material, partialGraphDigest: empiricalStrictJsonDigest(material) });
}

async function drive(input: {
	readonly executionAuthority: D42ExecutionAuthorityV1;
	readonly baseline: D42D41BaselineAdmissionV1;
	readonly executionClass: D42LiveBundleV1["executionClass"];
	readonly executorFactory: (
		authority: ReturnType<typeof createD41InferenceAuthority>,
	) => D41PhaseSpecificRealProviderExecutorV1;
	readonly implementationManifestDigest: string;
	readonly allowConsumedBaselineForQualification?: boolean;
	readonly beforeProviderEffect?: () => Promise<void>;
}): Promise<D42LiveBundleV1> {
	consumeBaseline(
		input.baseline,
		input.executionClass === "live-provider" || input.allowConsumedBaselineForQualification === true
			? "consumed-d41-artifact"
			: "injected-test",
	);
	const executionAuthority = consumeD42ExecutionAuthority(input.executionAuthority);
	if (executionAuthority.claim.implementationManifestDigest !== input.implementationManifestDigest)
		throw new TypeError("D42 implementation authority drifted");
	const graphAuthority = createD41InferenceAuthority({
		limits: D42_REPAIRED_LIVE_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: D21_TASK_PROFILE,
	});
	const executor = input.executorFactory(graphAuthority);
	const providerFacts: CurrentGraphProviderFactV1[] = [];
	let activeRequestDigest: string | null = null;
	let activeAdmissionDigest: string | null = null;
	let activeEffectKind: string | null = null;
	let graphEvidence: D41InferenceEvidenceV1 | null = null;
	let failureCode: D42PartialGraphEvidenceV1["failureCode"] | null = null;
	try {
		for (let guard = 0; guard < D42_REPAIRED_LIVE_LIMITS.maxEffectFacts; guard += 1) {
			const admitted = takeD41AdmittedEffect(graphAuthority);
			if (admitted === null) {
				try {
					graphEvidence = validateD41InferenceEvidence(
						snapshotD41InferenceEvidence(graphAuthority),
					);
				} catch {
					failureCode = "graph-admission-failed";
				}
				break;
			}
			const request = admitted.effect.effect.effect.request;
			activeRequestDigest = request.requestDigest;
			activeAdmissionDigest = admitted.effect.effect.effect.admission.decisionDigest;
			activeEffectKind = request.effectKind;
			let execution: Awaited<ReturnType<D41PhaseSpecificRealProviderExecutorV1["execute"]>>;
			try {
				if (request.effectKind === "provider-request") await input.beforeProviderEffect?.();
				execution = await executor.execute(admitted);
			} catch {
				failureCode = "executor-boundary-failed";
				break;
			}
			try {
				const outcome = admitD41EffectResult(
					graphAuthority,
					execution.admitted,
					execution.result,
					execution.wireReceipt,
				);
				providerFacts.push(outcome.providerFact);
				activeRequestDigest = null;
				activeAdmissionDigest = null;
				activeEffectKind = null;
			} catch {
				failureCode = "graph-admission-failed";
				break;
			}
		}
		if (graphEvidence === null && failureCode === null) failureCode = "effect-bound-exhausted";
	} finally {
		try {
			await executor.dispose();
		} catch {
			failureCode ??= "executor-disposal-failed";
		}
	}
	const success = graphEvidence !== null && failureCode === null;
	const partial = success
		? null
		: partialEvidence({
				providerFacts,
				activeRequestDigest,
				activeAdmissionDigest,
				activeEffectKind,
				completedGraphEvidence: graphEvidence,
				failureCode: failureCode ?? "graph-admission-failed",
			});
	const canonicalGraphEvidence = success ? graphEvidence : null;
	const gate = evaluateGate(
		canonicalGraphEvidence,
		input.executionClass === "live-provider" && success,
	);
	const efficacyClaim = gate.passed
		? ("frozen-task-block-positive-differential" as const)
		: ("none" as const);
	const generation = success
		? (() => {
				const material = strictSnapshot({
					schemaVersion: D42_GENERATION_SCHEMA,
					generationRef: D42_GENERATION_REF,
					coordinatesDigest: D42_COORDINATES_DIGEST,
					graphEvidenceDigest: graphEvidence!.evidenceDigest,
					gateDigest: gate.gateDigest,
					implementationManifestDigest: input.implementationManifestDigest,
					qualificationArtifactDigest: executionAuthority.claim.qualificationArtifactDigest,
					qualificationDigest: executionAuthority.claim.qualificationDigest,
					causalAttribution: "undetermined" as const,
					efficacyClaim,
				});
				return Object.freeze({
					...material,
					generationDigest: empiricalStrictJsonDigest(material),
				});
			})()
		: null;
	const facts =
		graphEvidence?.retainedSpanEvidence.phaseEvidence.workflowEvidence.providerEvidence.facts ??
		providerFacts;
	const providerAttempts = facts.filter(
		(fact) => fact.request.effectKind === "provider-request",
	).length;
	const confirmedCostMicrousd = facts.reduce(
		(sum, fact) => sum + fact.reconciliation.actualCostMicrousd,
		0,
	);
	const terminalMaterial = strictSnapshot({
		schemaVersion: D42_TERMINAL_SCHEMA,
		decisionRef: D42_DECISION_REF,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		claimDigest: executionAuthority.claim.claimDigest,
		currentKeyAdmissionDigest: executionAuthority.currentKeyAdmission.admissionDigest,
		graphEvidenceDigest: canonicalGraphEvidence?.evidenceDigest ?? null,
		partialGraphDigest: partial?.partialGraphDigest ?? null,
		gateDigest: gate.gateDigest,
		providerAttempts,
		confirmedCostMicrousd,
		failureCode,
		causalAttribution: "undetermined" as const,
		efficacyClaim,
	});
	const terminalReceipt = Object.freeze({
		...terminalMaterial,
		terminalReceiptDigest: empiricalStrictJsonDigest(terminalMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D42_BUNDLE_SCHEMA,
		decisionRef: D42_DECISION_REF,
		executionClass: input.executionClass,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		coordinatesDigest: D42_COORDINATES_DIGEST,
		implementationManifestDigest: input.implementationManifestDigest,
		d41ArtifactDigest: D42_D41_ARTIFACT_DIGEST,
		d41BundleDigest: D42_D41_BUNDLE_DIGEST,
		d41MainEvidenceDigest: D42_D41_MAIN_EVIDENCE_DIGEST,
		d41GenerationDigest: D42_D41_GENERATION_DIGEST,
		d41QualificationDigest: D42_D41_QUALIFICATION_DIGEST,
		d41ImplementationManifestDigest: D42_D41_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: executionAuthority.claim.qualificationArtifactDigest,
		qualificationDigest: executionAuthority.claim.qualificationDigest,
		pricingObservationDigest: executionAuthority.claim.pricingObservationDigest,
		zeroByokObservationDigest: executionAuthority.claim.zeroByokObservationDigest,
		claimDigest: executionAuthority.claim.claimDigest,
		currentKeyAdmissionDigest: executionAuthority.currentKeyAdmission.admissionDigest,
		graphEvidence: canonicalGraphEvidence,
		partialGraphEvidence: partial,
		gate,
		generation,
		terminalReceipt,
		causalAttribution: "undetermined" as const,
		efficacyClaim,
	});
	const bundle = Object.freeze({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as D42LiveBundleV1;
	if (
		strictJsonCodec.encode(bundle as unknown as StrictJsonValue).byteLength > D42_MAX_BUNDLE_BYTES
	)
		throw new TypeError("D42 live bundle exceeded its byte bound");
	constructed.add(bundle);
	return bundle;
}

export async function runD42LiveMeasurement(input: {
	readonly executionAuthority: D42ExecutionAuthorityV1;
	readonly baseline: D42D41BaselineAdmissionV1;
	readonly credential: D42CredentialV1;
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly implementationManifestDigest: string;
	readonly now?: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
}): Promise<D42LiveBundleV1> {
	if (
		input.executionAuthority.claim.scope !== "live-fixed-root" ||
		credentialBinding(input.credential) !== input.executionAuthority.claim.credentialBindingDigest
	)
		throw new TypeError("D42 live credential or claim scope drifted");
	return drive({
		executionAuthority: input.executionAuthority,
		baseline: input.baseline,
		executionClass: "live-provider",
		implementationManifestDigest: input.implementationManifestDigest,
		beforeProviderEffect: async () => {
			if (
				(await measureD42Implementation(input.repositoryRoot)) !==
				input.implementationManifestDigest
			)
				throw new TypeError("D42 implementation drifted before admitted provider effect");
		},
		executorFactory: (_authority) =>
			createD41PhaseSpecificRealProviderExecutor({
				repositoryRoot: input.repositoryRoot,
				materializationRoot: input.materializationRoot,
				credential: input.credential,
				fetchImpl: globalThis.fetch,
				now: input.now,
				sleep: input.sleep,
			}),
	});
}

export async function runD42InjectedMeasurementForTest(input: {
	readonly executionAuthority: D42ExecutionAuthorityV1;
	readonly baseline: D42D41BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
	readonly executorFactory: (
		authority: ReturnType<typeof createD41InferenceAuthority>,
	) => D41PhaseSpecificRealProviderExecutorV1;
	readonly allowConsumedBaselineForQualification?: boolean;
}): Promise<D42LiveBundleV1> {
	return drive({ ...input, executionClass: "injected-no-network" });
}

function validateD42PartialGraphEvidence(value: unknown): D42PartialGraphEvidenceV1 {
	const candidate = record(value, "D42 partial Graph evidence");
	exactKeys(
		candidate,
		[
			"activeAdmissionDigest",
			"activeEffectKind",
			"activeRequestDigest",
			"completedGraphEvidence",
			"coordinatesDigest",
			"decisionRef",
			"failureCode",
			"partialGraphDigest",
			"providerFacts",
			"schemaVersion",
		],
		"D42 partial Graph evidence",
	);
	if (
		candidate.schemaVersion !== D42_PARTIAL_SCHEMA ||
		candidate.decisionRef !== D42_DECISION_REF ||
		candidate.coordinatesDigest !== D42_COORDINATES_DIGEST ||
		!(
			[
				"executor-boundary-failed",
				"graph-admission-failed",
				"effect-bound-exhausted",
				"executor-disposal-failed",
			] as const
		).includes(candidate.failureCode as never)
	)
		throw new TypeError("D42 partial Graph evidence coordinates drifted");
	for (const [key, value] of [
		["activeRequestDigest", candidate.activeRequestDigest],
		["activeAdmissionDigest", candidate.activeAdmissionDigest],
	] as const)
		if (value !== null) digest(value, `D42 partial ${key}`);
	if (
		candidate.activeEffectKind !== null &&
		!(
			[
				"materialization",
				"provider-request",
				"retry-wait",
				"tool-action",
				"public-semantic-validation",
				"hidden-verifier",
				"cleanup",
			] as const
		).includes(candidate.activeEffectKind as never)
	)
		throw new TypeError("D42 partial active effect kind drifted");
	const providerFacts = array(candidate.providerFacts, "D42 partial provider facts");
	if (providerFacts.length > D42_REPAIRED_LIVE_LIMITS.maxEffectFacts)
		throw new TypeError("D42 partial provider fact bound exceeded");
	const completedGraphEvidence =
		candidate.completedGraphEvidence === null
			? null
			: validateD41InferenceEvidence(candidate.completedGraphEvidence);
	if (completedGraphEvidence !== null) {
		const completeFacts =
			completedGraphEvidence.retainedSpanEvidence.phaseEvidence.workflowEvidence.providerEvidence
				.facts;
		const completeDigests = new Set(completeFacts.map((fact) => fact.factDigest));
		for (const [index, factValue] of providerFacts.entries()) {
			const fact = record(factValue, `D42 partial provider facts[${index}]`);
			if (!completeDigests.has(digest(fact.factDigest, `D42 partial provider fact[${index}]`)))
				throw new TypeError("D42 partial provider facts are not bound to completed Graph evidence");
		}
	}
	const material = strictSnapshot({
		schemaVersion: D42_PARTIAL_SCHEMA,
		decisionRef: D42_DECISION_REF,
		coordinatesDigest: D42_COORDINATES_DIGEST,
		providerFacts,
		activeRequestDigest: candidate.activeRequestDigest,
		activeAdmissionDigest: candidate.activeAdmissionDigest,
		activeEffectKind: candidate.activeEffectKind,
		completedGraphEvidence,
		failureCode: candidate.failureCode,
	});
	if (candidate.partialGraphDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D42 partial Graph evidence digest drifted");
	return Object.freeze({
		...material,
		partialGraphDigest: candidate.partialGraphDigest,
	}) as D42PartialGraphEvidenceV1;
}

function validateD42Generation(
	value: unknown,
	input: {
		readonly graphEvidenceDigest: string;
		readonly gateDigest: string;
		readonly qualificationArtifactDigest: string;
		readonly qualificationDigest: string;
		readonly efficacyClaim: D42LiveBundleV1["efficacyClaim"];
	},
): Readonly<Record<string, StrictJsonValue>> {
	const candidate = record(value, "D42 generation");
	exactKeys(
		candidate,
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
		"D42 generation",
	);
	const material = strictSnapshot({
		schemaVersion: D42_GENERATION_SCHEMA,
		generationRef: D42_GENERATION_REF,
		coordinatesDigest: D42_COORDINATES_DIGEST,
		graphEvidenceDigest: input.graphEvidenceDigest,
		gateDigest: input.gateDigest,
		implementationManifestDigest: D42_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: input.qualificationArtifactDigest,
		qualificationDigest: input.qualificationDigest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: input.efficacyClaim,
	});
	if (
		candidate.generationDigest !== empiricalStrictJsonDigest(material) ||
		empiricalStrictJsonDigest(
			strictSnapshot(
				Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "generationDigest")),
			),
		) !== empiricalStrictJsonDigest(material)
	)
		throw new TypeError("D42 generation drifted");
	return Object.freeze({ ...material, generationDigest: candidate.generationDigest });
}

export function validateD42LiveBundle(value: unknown): D42LiveBundleV1 {
	const candidate = record(value, "D42 live bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"claimDigest",
			"coordinatesDigest",
			"currentKeyAdmissionDigest",
			"d41ArtifactDigest",
			"d41BundleDigest",
			"d41ImplementationManifestDigest",
			"d41MainEvidenceDigest",
			"d41GenerationDigest",
			"d41QualificationDigest",
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
		"D42 live bundle",
	);
	if (
		candidate.schemaVersion !== D42_BUNDLE_SCHEMA ||
		candidate.decisionRef !== D42_DECISION_REF ||
		(candidate.executionClass !== "live-provider" &&
			candidate.executionClass !== "injected-no-network") ||
		(candidate.disposition !== "success" && candidate.disposition !== "partial-failure") ||
		candidate.coordinatesDigest !== D42_COORDINATES_DIGEST ||
		candidate.implementationManifestDigest !== D42_IMPLEMENTATION_MANIFEST_DIGEST ||
		candidate.d41ArtifactDigest !== D42_D41_ARTIFACT_DIGEST ||
		candidate.d41BundleDigest !== D42_D41_BUNDLE_DIGEST ||
		candidate.d41MainEvidenceDigest !== D42_D41_MAIN_EVIDENCE_DIGEST ||
		candidate.d41GenerationDigest !== D42_D41_GENERATION_DIGEST ||
		candidate.d41QualificationDigest !== D42_D41_QUALIFICATION_DIGEST ||
		candidate.d41ImplementationManifestDigest !== D42_D41_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("D42 live coordinates drifted");
	for (const key of [
		"claimDigest",
		"currentKeyAdmissionDigest",
		"pricingObservationDigest",
		"qualificationArtifactDigest",
		"qualificationDigest",
		"zeroByokObservationDigest",
	] as const)
		digest(candidate[key], `D42 live ${key}`);
	const graphEvidence =
		candidate.graphEvidence === null ? null : validateD41InferenceEvidence(candidate.graphEvidence);
	const partialGraphEvidence =
		candidate.partialGraphEvidence === null
			? null
			: validateD42PartialGraphEvidence(candidate.partialGraphEvidence);
	if (
		(candidate.disposition === "success") !== (graphEvidence !== null) ||
		(candidate.disposition === "success") !== (candidate.generation !== null) ||
		(candidate.disposition === "partial-failure") !== (partialGraphEvidence !== null) ||
		(candidate.disposition === "partial-failure") === (graphEvidence !== null)
	)
		throw new TypeError("D42 disposition drifted");
	const expectedGate = evaluateGate(
		graphEvidence,
		candidate.executionClass === "live-provider" && candidate.disposition === "success",
	);
	if (
		empiricalStrictJsonDigest(candidate.gate) !==
		empiricalStrictJsonDigest(expectedGate as unknown as StrictJsonValue)
	)
		throw new TypeError("D42 gate drifted");
	const expectedClaim = expectedGate.passed ? "frozen-task-block-positive-differential" : "none";
	if (candidate.efficacyClaim !== expectedClaim || candidate.causalAttribution !== "undetermined")
		throw new TypeError("D42 efficacy claim drifted");
	const generation =
		candidate.generation === null
			? null
			: validateD42Generation(candidate.generation, {
					graphEvidenceDigest: graphEvidence!.evidenceDigest,
					gateDigest: expectedGate.gateDigest,
					qualificationArtifactDigest: candidate.qualificationArtifactDigest as string,
					qualificationDigest: candidate.qualificationDigest as string,
					efficacyClaim: expectedClaim,
				});
	const terminal = record(candidate.terminalReceipt, "D42 terminal receipt");
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
		"D42 terminal receipt",
	);
	const accountingEvidence = graphEvidence ?? partialGraphEvidence?.completedGraphEvidence ?? null;
	const accountingFacts =
		accountingEvidence?.retainedSpanEvidence.phaseEvidence.workflowEvidence.providerEvidence
			.facts ??
		partialGraphEvidence?.providerFacts ??
		[];
	const providerAttempts = accountingFacts.filter((fact) => {
		const request = record(record(fact, "D42 accounting fact").request, "D42 accounting request");
		return request.effectKind === "provider-request";
	}).length;
	const confirmedCostMicrousd = accountingFacts.reduce((sum, fact) => {
		const reconciliation = record(
			record(fact, "D42 accounting fact").reconciliation,
			"D42 accounting reconciliation",
		);
		return sum + safeInteger(reconciliation.actualCostMicrousd, "D42 actual cost");
	}, 0);
	const terminalMaterial = strictSnapshot({
		schemaVersion: D42_TERMINAL_SCHEMA,
		decisionRef: D42_DECISION_REF,
		disposition: candidate.disposition,
		claimDigest: candidate.claimDigest,
		currentKeyAdmissionDigest: candidate.currentKeyAdmissionDigest,
		graphEvidenceDigest: graphEvidence?.evidenceDigest ?? null,
		partialGraphDigest: partialGraphEvidence?.partialGraphDigest ?? null,
		gateDigest: expectedGate.gateDigest,
		providerAttempts,
		confirmedCostMicrousd,
		failureCode: partialGraphEvidence?.failureCode ?? null,
		causalAttribution: "undetermined" as const,
		efficacyClaim: expectedClaim,
	});
	if (
		terminal.terminalReceiptDigest !== empiricalStrictJsonDigest(terminalMaterial) ||
		empiricalStrictJsonDigest(
			strictSnapshot(
				Object.fromEntries(
					Object.entries(terminal).filter(([key]) => key !== "terminalReceiptDigest"),
				),
			),
		) !== empiricalStrictJsonDigest(terminalMaterial)
	)
		throw new TypeError("D42 terminal receipt drifted");
	const canonical = strictSnapshot({
		...candidate,
		graphEvidence,
		partialGraphEvidence,
		gate: expectedGate,
		generation,
		terminalReceipt: Object.freeze({
			...terminalMaterial,
			terminalReceiptDigest: terminal.terminalReceiptDigest,
		}),
	});
	const material = strictSnapshot(
		Object.fromEntries(Object.entries(canonical).filter(([key]) => key !== "bundleDigest")),
	);
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D42 bundle digest drifted");
	return canonical as unknown as D42LiveBundleV1;
}

export async function persistD42LiveBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D42LiveBundleV1;
}) {
	if (!constructed.has(input.bundle as object))
		throw new TypeError("D42 live bundle is forged or replayed");
	constructed.delete(input.bundle as object);
	const bundle = validateD42LiveBundle(input.bundle);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d42.live-commit.v1",
		generationRef: D42_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		terminalReceiptDigest: digest(
			bundle.terminalReceipt.terminalReceiptDigest,
			"D42 terminal receipt",
		),
		disposition: bundle.disposition,
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D42_GENERATION_REF,
		artifacts: Object.freeze({
			"bundle.v1.json": strictJsonCodec.encode(bundle as unknown as StrictJsonValue),
			"terminal-receipt.v1.json": strictJsonCodec.encode(bundle.terminalReceipt as StrictJsonValue),
		}),
		commitBytes: strictJsonCodec.encode({
			...commitMaterial,
			commitDigest: empiricalStrictJsonDigest(commitMaterial),
		}),
	});
}

export async function persistD42PreexecutionFailure(input: {
	readonly privateRoot: string;
	readonly failureAuthority: D42PreexecutionFailureAuthorityV1;
	readonly implementationManifestDigest: string;
}) {
	const authority = consumeD42PreexecutionFailureAuthority(input.failureAuthority);
	if (authority.claim.scope !== "live-fixed-root")
		throw new TypeError("D42 preexecution failure rejected a non-live claim");
	const material = strictSnapshot({
		schemaVersion: "graphrefly-ts.d42.live-preexecution-failure.v1",
		decisionRef: D42_DECISION_REF,
		generationRef: D42_GENERATION_REF,
		coordinatesDigest: D42_COORDINATES_DIGEST,
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmissionDigest,
		executionAuthorityDigest: authority.executionAuthorityDigest,
		failureAuthorityDigest: authority.authorityDigest,
		implementationManifestDigest: digest(
			input.implementationManifestDigest,
			"D42 preexecution implementation",
		),
		failurePhase: authority.failurePhase,
		disposition: "partial-failure" as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const failure = Object.freeze({
		...material,
		failureDigest: empiricalStrictJsonDigest(material),
	});
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d42.live-preexecution-commit.v1",
		generationRef: D42_GENERATION_REF,
		failureDigest: failure.failureDigest,
		claimDigest: authority.claim.claimDigest,
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D42_GENERATION_REF,
		artifacts: Object.freeze({
			"partial-failure.v1.json": strictJsonCodec.encode(failure),
		}),
		commitBytes: strictJsonCodec.encode({
			...commitMaterial,
			commitDigest: empiricalStrictJsonDigest(commitMaterial),
		}),
	});
}
