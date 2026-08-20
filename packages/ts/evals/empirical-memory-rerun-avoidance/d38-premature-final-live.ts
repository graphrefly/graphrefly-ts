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
import {
	CURRENT_GRAPH_LIVE_LIMITS,
	CURRENT_GRAPH_LIVE_ROUTE,
} from "./d8-current-live-coordinates.js";
import {
	D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
	D21_TASK_PROFILE,
} from "./d21-current-efficacy-recovery-authority.js";
import {
	admitD34EffectResult,
	createD34RetainedSpanAuthority,
	type D34RetainedSpanEvidenceV1,
	snapshotD34RetainedSpanEvidence,
	takeD34AdmittedEffect,
	validateD34RetainedSpanEvidence,
} from "./d34-retained-span-mutation-authority.js";
import { validateD37QualificationBundle } from "./d37-premature-final-qualification.js";
import {
	consumeD38ExecutionAuthority,
	consumeD38PreexecutionFailureAuthority,
	type D38ExecutionAuthorityV1,
	type D38PreexecutionFailureAuthorityV1,
} from "./d38-premature-final-live-claim.js";
import {
	D38_COORDINATES_DIGEST,
	D38_D37_ARTIFACT_DIGEST,
	D38_D37_BUNDLE_DIGEST,
	D38_D37_EVIDENCE_DIGEST,
	D38_D37_GENERATION_DIGEST,
	D38_D37_IMPLEMENTATION_MANIFEST_DIGEST,
	D38_D37_QUALIFICATION_DIGEST,
	D38_DECISION_REF,
	D38_GENERATION_REF,
} from "./d38-premature-final-live-coordinates.js";
import { D38_IMPLEMENTATION_MANIFEST_DIGEST } from "./d38-premature-final-live-implementation-manifest.js";
import type { D38CredentialV1 } from "./d38-premature-final-live-preflight.js";
import {
	createD38PrematureFinalRealProviderExecutor,
	type D38PrematureFinalRealProviderExecutorV1,
} from "./d38-premature-final-real-provider-composition.js";

export const D38_BASELINE_ADMISSION_REVISION =
	"graphrefly-ts.d38.d37-baseline-admission.v2" as const;
export const D38_BUNDLE_SCHEMA = "graphrefly-ts.d38.premature-final-live-bundle.v2" as const;
export const D38_GATE_SCHEMA = "graphrefly-ts.d38.positive-differential-gate.v2" as const;
export const D38_PARTIAL_SCHEMA = "graphrefly-ts.d38.partial-graph-evidence.v2" as const;
export const D38_GENERATION_SCHEMA = "graphrefly-ts.d38.live-generation.v2" as const;
export const D38_TERMINAL_SCHEMA = "graphrefly-ts.d38.live-terminal-receipt.v2" as const;
export const D38_MAX_BUNDLE_BYTES = 8_388_608;

export interface D38D37BaselineAdmissionV1 {
	readonly revision: typeof D38_BASELINE_ADMISSION_REVISION;
}

export interface D38PositiveDifferentialGateV1 {
	readonly schemaVersion: typeof D38_GATE_SCHEMA;
	readonly definitionDigest: string;
	readonly evaluated: boolean;
	readonly passed: boolean;
	readonly failureCodes: readonly string[];
	readonly gateDigest: string;
}

export interface D38PartialGraphEvidenceV1 {
	readonly schemaVersion: typeof D38_PARTIAL_SCHEMA;
	readonly decisionRef: typeof D38_DECISION_REF;
	readonly coordinatesDigest: string;
	readonly providerFacts: readonly CurrentGraphProviderFactV1[];
	readonly activeRequestDigest: string | null;
	readonly activeAdmissionDigest: string | null;
	readonly activeEffectKind: string | null;
	readonly completedGraphEvidence: D34RetainedSpanEvidenceV1 | null;
	readonly failureCode:
		| "executor-boundary-failed"
		| "graph-admission-failed"
		| "effect-bound-exhausted"
		| "executor-disposal-failed";
	readonly partialGraphDigest: string;
}

export interface D38LiveBundleV1 {
	readonly schemaVersion: typeof D38_BUNDLE_SCHEMA;
	readonly decisionRef: typeof D38_DECISION_REF;
	readonly executionClass: "live-provider" | "injected-no-network";
	readonly disposition: "success" | "partial-failure";
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly d37ArtifactDigest: typeof D38_D37_ARTIFACT_DIGEST;
	readonly d37BundleDigest: typeof D38_D37_BUNDLE_DIGEST;
	readonly d37QualificationDigest: typeof D38_D37_QUALIFICATION_DIGEST;
	readonly d37GenerationDigest: typeof D38_D37_GENERATION_DIGEST;
	readonly d37EvidenceDigest: typeof D38_D37_EVIDENCE_DIGEST;
	readonly d37ImplementationManifestDigest: typeof D38_D37_IMPLEMENTATION_MANIFEST_DIGEST;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly claimDigest: string;
	readonly currentKeyAdmissionDigest: string;
	readonly graphEvidence: D34RetainedSpanEvidenceV1 | null;
	readonly partialGraphEvidence: D38PartialGraphEvidenceV1 | null;
	readonly gate: D38PositiveDifferentialGateV1;
	readonly generation: Readonly<Record<string, StrictJsonValue>> | null;
	readonly terminalReceipt: Readonly<Record<string, StrictJsonValue>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none" | "frozen-task-block-positive-differential";
	readonly bundleDigest: string;
}

const baselines = new WeakMap<object, "consumed-d37-artifact" | "injected-test">();
const constructed = new WeakSet<object>();

function makeBaseline(basis: "consumed-d37-artifact" | "injected-test") {
	const value = Object.freeze({ revision: D38_BASELINE_ADMISSION_REVISION });
	baselines.set(value, basis);
	return value;
}

export function admitD38D37Baseline(bytesValue: Uint8Array): D38D37BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D38 D37 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D38_D37_ARTIFACT_DIGEST)
		throw new TypeError("D38 D37 immutable artifact drifted");
	const bundle = validateD37QualificationBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.baselineBasis !== "consumed-d36-artifact" ||
		bundle.bundleDigest !== D38_D37_BUNDLE_DIGEST ||
		bundle.qualification.qualificationDigest !== D38_D37_QUALIFICATION_DIGEST ||
		bundle.generation.generationDigest !== D38_D37_GENERATION_DIGEST ||
		bundle.evidence.evidenceDigest !== D38_D37_EVIDENCE_DIGEST ||
		bundle.qualification.implementationManifestDigest !== D38_D37_IMPLEMENTATION_MANIFEST_DIGEST ||
		bundle.qualification.efficacyClaim !== "none"
	)
		throw new TypeError("D38 D37 immutable coordinates drifted");
	return makeBaseline("consumed-d37-artifact");
}

export function createD38InjectedBaselineForTest(): D38D37BaselineAdmissionV1 {
	return makeBaseline("injected-test");
}

function consumeBaseline(
	value: unknown,
	expected: "consumed-d37-artifact" | "injected-test",
): void {
	if (value === null || typeof value !== "object") throw new TypeError("D38 baseline is invalid");
	const basis = baselines.get(value);
	baselines.delete(value);
	if (basis !== expected) throw new TypeError("D38 baseline is forged, replayed or drifted");
}

function credentialBinding(credential: D38CredentialV1): string {
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
	evidence: D34RetainedSpanEvidenceV1 | null,
	evaluated: boolean,
): D38PositiveDifferentialGateV1 {
	const failures: string[] = [];
	if (evidence === null) failures.push("measurement-incomplete");
	else {
		const phase = evidence.phaseEvidence;
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
		schemaVersion: D38_GATE_SCHEMA,
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
	readonly completedGraphEvidence: D34RetainedSpanEvidenceV1 | null;
	readonly failureCode: D38PartialGraphEvidenceV1["failureCode"];
}): D38PartialGraphEvidenceV1 {
	const material = strictSnapshot({
		schemaVersion: D38_PARTIAL_SCHEMA,
		decisionRef: D38_DECISION_REF,
		coordinatesDigest: D38_COORDINATES_DIGEST,
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
	readonly executionAuthority: D38ExecutionAuthorityV1;
	readonly baseline: D38D37BaselineAdmissionV1;
	readonly executionClass: D38LiveBundleV1["executionClass"];
	readonly executorFactory: (
		authority: ReturnType<typeof createD34RetainedSpanAuthority>,
	) => D38PrematureFinalRealProviderExecutorV1;
	readonly implementationManifestDigest: string;
	readonly allowConsumedBaselineForQualification?: boolean;
}): Promise<D38LiveBundleV1> {
	consumeBaseline(
		input.baseline,
		input.executionClass === "live-provider" || input.allowConsumedBaselineForQualification === true
			? "consumed-d37-artifact"
			: "injected-test",
	);
	const executionAuthority = consumeD38ExecutionAuthority(input.executionAuthority);
	if (executionAuthority.claim.implementationManifestDigest !== input.implementationManifestDigest)
		throw new TypeError("D38 implementation authority drifted");
	const graphAuthority = createD34RetainedSpanAuthority({
		limits: CURRENT_GRAPH_LIVE_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: D21_TASK_PROFILE,
	});
	const executor = input.executorFactory(graphAuthority);
	const providerFacts: CurrentGraphProviderFactV1[] = [];
	let activeRequestDigest: string | null = null;
	let activeAdmissionDigest: string | null = null;
	let activeEffectKind: string | null = null;
	let graphEvidence: D34RetainedSpanEvidenceV1 | null = null;
	let failureCode: D38PartialGraphEvidenceV1["failureCode"] | null = null;
	try {
		for (let guard = 0; guard < CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts; guard += 1) {
			const admitted = takeD34AdmittedEffect(graphAuthority);
			if (admitted === null) {
				try {
					graphEvidence = validateD34RetainedSpanEvidence(
						snapshotD34RetainedSpanEvidence(graphAuthority),
					);
				} catch {
					failureCode = "graph-admission-failed";
				}
				break;
			}
			const request = admitted.effect.effect.request;
			activeRequestDigest = request.requestDigest;
			activeAdmissionDigest = admitted.effect.effect.admission.decisionDigest;
			activeEffectKind = request.effectKind;
			let execution: Awaited<ReturnType<D38PrematureFinalRealProviderExecutorV1["execute"]>>;
			try {
				execution = await executor.execute(admitted);
			} catch {
				failureCode = "executor-boundary-failed";
				break;
			}
			try {
				const outcome = admitD34EffectResult(graphAuthority, execution.admitted, execution.result);
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
					schemaVersion: D38_GENERATION_SCHEMA,
					generationRef: D38_GENERATION_REF,
					coordinatesDigest: D38_COORDINATES_DIGEST,
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
		graphEvidence?.phaseEvidence.workflowEvidence.providerEvidence.facts ?? providerFacts;
	const providerAttempts = facts.filter(
		(fact) => fact.request.effectKind === "provider-request",
	).length;
	const confirmedCostMicrousd = facts.reduce(
		(sum, fact) => sum + fact.reconciliation.actualCostMicrousd,
		0,
	);
	const terminalMaterial = strictSnapshot({
		schemaVersion: D38_TERMINAL_SCHEMA,
		decisionRef: D38_DECISION_REF,
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
		schemaVersion: D38_BUNDLE_SCHEMA,
		decisionRef: D38_DECISION_REF,
		executionClass: input.executionClass,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		coordinatesDigest: D38_COORDINATES_DIGEST,
		implementationManifestDigest: input.implementationManifestDigest,
		d37ArtifactDigest: D38_D37_ARTIFACT_DIGEST,
		d37BundleDigest: D38_D37_BUNDLE_DIGEST,
		d37QualificationDigest: D38_D37_QUALIFICATION_DIGEST,
		d37GenerationDigest: D38_D37_GENERATION_DIGEST,
		d37EvidenceDigest: D38_D37_EVIDENCE_DIGEST,
		d37ImplementationManifestDigest: D38_D37_IMPLEMENTATION_MANIFEST_DIGEST,
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
	}) as D38LiveBundleV1;
	if (
		strictJsonCodec.encode(bundle as unknown as StrictJsonValue).byteLength > D38_MAX_BUNDLE_BYTES
	)
		throw new TypeError("D38 live bundle exceeded its byte bound");
	constructed.add(bundle);
	return bundle;
}

export async function runD38LiveMeasurement(input: {
	readonly executionAuthority: D38ExecutionAuthorityV1;
	readonly baseline: D38D37BaselineAdmissionV1;
	readonly credential: D38CredentialV1;
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly implementationManifestDigest: string;
	readonly now?: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
}): Promise<D38LiveBundleV1> {
	if (
		input.executionAuthority.claim.scope !== "live-fixed-root" ||
		credentialBinding(input.credential) !== input.executionAuthority.claim.credentialBindingDigest
	)
		throw new TypeError("D38 live credential or claim scope drifted");
	return drive({
		executionAuthority: input.executionAuthority,
		baseline: input.baseline,
		executionClass: "live-provider",
		implementationManifestDigest: input.implementationManifestDigest,
		executorFactory: (authority) =>
			createD38PrematureFinalRealProviderExecutor({
				authority,
				repositoryRoot: input.repositoryRoot,
				materializationRoot: input.materializationRoot,
				credential: input.credential,
				fetchImpl: globalThis.fetch,
				now: input.now,
				sleep: input.sleep,
			}),
	});
}

export async function runD38InjectedMeasurementForTest(input: {
	readonly executionAuthority: D38ExecutionAuthorityV1;
	readonly baseline: D38D37BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
	readonly executorFactory: (
		authority: ReturnType<typeof createD34RetainedSpanAuthority>,
	) => D38PrematureFinalRealProviderExecutorV1;
	readonly allowConsumedBaselineForQualification?: boolean;
}): Promise<D38LiveBundleV1> {
	return drive({ ...input, executionClass: "injected-no-network" });
}

function validateD38PartialGraphEvidence(value: unknown): D38PartialGraphEvidenceV1 {
	const candidate = record(value, "D38 partial Graph evidence");
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
		"D38 partial Graph evidence",
	);
	if (
		candidate.schemaVersion !== D38_PARTIAL_SCHEMA ||
		candidate.decisionRef !== D38_DECISION_REF ||
		candidate.coordinatesDigest !== D38_COORDINATES_DIGEST ||
		!(
			[
				"executor-boundary-failed",
				"graph-admission-failed",
				"effect-bound-exhausted",
				"executor-disposal-failed",
			] as const
		).includes(candidate.failureCode as never)
	)
		throw new TypeError("D38 partial Graph evidence coordinates drifted");
	for (const [key, value] of [
		["activeRequestDigest", candidate.activeRequestDigest],
		["activeAdmissionDigest", candidate.activeAdmissionDigest],
	] as const)
		if (value !== null) digest(value, `D38 partial ${key}`);
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
		throw new TypeError("D38 partial active effect kind drifted");
	const providerFacts = array(candidate.providerFacts, "D38 partial provider facts");
	if (providerFacts.length > CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts)
		throw new TypeError("D38 partial provider fact bound exceeded");
	const completedGraphEvidence =
		candidate.completedGraphEvidence === null
			? null
			: validateD34RetainedSpanEvidence(candidate.completedGraphEvidence);
	if (completedGraphEvidence !== null) {
		const completeFacts =
			completedGraphEvidence.phaseEvidence.workflowEvidence.providerEvidence.facts;
		const completeDigests = new Set(completeFacts.map((fact) => fact.factDigest));
		for (const [index, factValue] of providerFacts.entries()) {
			const fact = record(factValue, `D38 partial provider facts[${index}]`);
			if (!completeDigests.has(digest(fact.factDigest, `D38 partial provider fact[${index}]`)))
				throw new TypeError("D38 partial provider facts are not bound to completed Graph evidence");
		}
	}
	const material = strictSnapshot({
		schemaVersion: D38_PARTIAL_SCHEMA,
		decisionRef: D38_DECISION_REF,
		coordinatesDigest: D38_COORDINATES_DIGEST,
		providerFacts,
		activeRequestDigest: candidate.activeRequestDigest,
		activeAdmissionDigest: candidate.activeAdmissionDigest,
		activeEffectKind: candidate.activeEffectKind,
		completedGraphEvidence,
		failureCode: candidate.failureCode,
	});
	if (candidate.partialGraphDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D38 partial Graph evidence digest drifted");
	return Object.freeze({
		...material,
		partialGraphDigest: candidate.partialGraphDigest,
	}) as D38PartialGraphEvidenceV1;
}

function validateD38Generation(
	value: unknown,
	input: {
		readonly graphEvidenceDigest: string;
		readonly gateDigest: string;
		readonly qualificationArtifactDigest: string;
		readonly qualificationDigest: string;
		readonly efficacyClaim: D38LiveBundleV1["efficacyClaim"];
	},
): Readonly<Record<string, StrictJsonValue>> {
	const candidate = record(value, "D38 generation");
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
		"D38 generation",
	);
	const material = strictSnapshot({
		schemaVersion: D38_GENERATION_SCHEMA,
		generationRef: D38_GENERATION_REF,
		coordinatesDigest: D38_COORDINATES_DIGEST,
		graphEvidenceDigest: input.graphEvidenceDigest,
		gateDigest: input.gateDigest,
		implementationManifestDigest: D38_IMPLEMENTATION_MANIFEST_DIGEST,
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
		throw new TypeError("D38 generation drifted");
	return Object.freeze({ ...material, generationDigest: candidate.generationDigest });
}

export function validateD38LiveBundle(value: unknown): D38LiveBundleV1 {
	const candidate = record(value, "D38 live bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"claimDigest",
			"coordinatesDigest",
			"currentKeyAdmissionDigest",
			"d37ArtifactDigest",
			"d37BundleDigest",
			"d37EvidenceDigest",
			"d37GenerationDigest",
			"d37ImplementationManifestDigest",
			"d37QualificationDigest",
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
		"D38 live bundle",
	);
	if (
		candidate.schemaVersion !== D38_BUNDLE_SCHEMA ||
		candidate.decisionRef !== D38_DECISION_REF ||
		(candidate.executionClass !== "live-provider" &&
			candidate.executionClass !== "injected-no-network") ||
		(candidate.disposition !== "success" && candidate.disposition !== "partial-failure") ||
		candidate.coordinatesDigest !== D38_COORDINATES_DIGEST ||
		candidate.implementationManifestDigest !== D38_IMPLEMENTATION_MANIFEST_DIGEST ||
		candidate.d37ArtifactDigest !== D38_D37_ARTIFACT_DIGEST ||
		candidate.d37BundleDigest !== D38_D37_BUNDLE_DIGEST ||
		candidate.d37QualificationDigest !== D38_D37_QUALIFICATION_DIGEST ||
		candidate.d37GenerationDigest !== D38_D37_GENERATION_DIGEST ||
		candidate.d37EvidenceDigest !== D38_D37_EVIDENCE_DIGEST ||
		candidate.d37ImplementationManifestDigest !== D38_D37_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("D38 live coordinates drifted");
	for (const key of [
		"claimDigest",
		"currentKeyAdmissionDigest",
		"pricingObservationDigest",
		"qualificationArtifactDigest",
		"qualificationDigest",
		"zeroByokObservationDigest",
	] as const)
		digest(candidate[key], `D38 live ${key}`);
	const graphEvidence =
		candidate.graphEvidence === null
			? null
			: validateD34RetainedSpanEvidence(candidate.graphEvidence);
	const partialGraphEvidence =
		candidate.partialGraphEvidence === null
			? null
			: validateD38PartialGraphEvidence(candidate.partialGraphEvidence);
	if (
		(candidate.disposition === "success") !== (graphEvidence !== null) ||
		(candidate.disposition === "success") !== (candidate.generation !== null) ||
		(candidate.disposition === "partial-failure") !== (partialGraphEvidence !== null) ||
		(candidate.disposition === "partial-failure") === (graphEvidence !== null)
	)
		throw new TypeError("D38 disposition drifted");
	const expectedGate = evaluateGate(
		graphEvidence,
		candidate.executionClass === "live-provider" && candidate.disposition === "success",
	);
	if (
		empiricalStrictJsonDigest(candidate.gate) !==
		empiricalStrictJsonDigest(expectedGate as unknown as StrictJsonValue)
	)
		throw new TypeError("D38 gate drifted");
	const expectedClaim = expectedGate.passed ? "frozen-task-block-positive-differential" : "none";
	if (candidate.efficacyClaim !== expectedClaim || candidate.causalAttribution !== "undetermined")
		throw new TypeError("D38 efficacy claim drifted");
	const generation =
		candidate.generation === null
			? null
			: validateD38Generation(candidate.generation, {
					graphEvidenceDigest: graphEvidence!.evidenceDigest,
					gateDigest: expectedGate.gateDigest,
					qualificationArtifactDigest: candidate.qualificationArtifactDigest as string,
					qualificationDigest: candidate.qualificationDigest as string,
					efficacyClaim: expectedClaim,
				});
	const terminal = record(candidate.terminalReceipt, "D38 terminal receipt");
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
		"D38 terminal receipt",
	);
	const accountingEvidence = graphEvidence ?? partialGraphEvidence?.completedGraphEvidence ?? null;
	const accountingFacts =
		accountingEvidence?.phaseEvidence.workflowEvidence.providerEvidence.facts ??
		partialGraphEvidence?.providerFacts ??
		[];
	const providerAttempts = accountingFacts.filter((fact) => {
		const request = record(record(fact, "D38 accounting fact").request, "D38 accounting request");
		return request.effectKind === "provider-request";
	}).length;
	const confirmedCostMicrousd = accountingFacts.reduce((sum, fact) => {
		const reconciliation = record(
			record(fact, "D38 accounting fact").reconciliation,
			"D38 accounting reconciliation",
		);
		return sum + safeInteger(reconciliation.actualCostMicrousd, "D38 actual cost");
	}, 0);
	const terminalMaterial = strictSnapshot({
		schemaVersion: D38_TERMINAL_SCHEMA,
		decisionRef: D38_DECISION_REF,
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
		throw new TypeError("D38 terminal receipt drifted");
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
		throw new TypeError("D38 bundle digest drifted");
	return canonical as unknown as D38LiveBundleV1;
}

export async function persistD38LiveBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D38LiveBundleV1;
}) {
	if (!constructed.has(input.bundle as object))
		throw new TypeError("D38 live bundle is forged or replayed");
	constructed.delete(input.bundle as object);
	const bundle = validateD38LiveBundle(input.bundle);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d38.live-commit.v1",
		generationRef: D38_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		terminalReceiptDigest: digest(
			bundle.terminalReceipt.terminalReceiptDigest,
			"D38 terminal receipt",
		),
		disposition: bundle.disposition,
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D38_GENERATION_REF,
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

export async function persistD38PreexecutionFailure(input: {
	readonly privateRoot: string;
	readonly failureAuthority: D38PreexecutionFailureAuthorityV1;
	readonly implementationManifestDigest: string;
}) {
	const authority = consumeD38PreexecutionFailureAuthority(input.failureAuthority);
	if (authority.claim.scope !== "live-fixed-root")
		throw new TypeError("D38 preexecution failure rejected a non-live claim");
	const material = strictSnapshot({
		schemaVersion: "graphrefly-ts.d38.live-preexecution-failure.v2",
		decisionRef: D38_DECISION_REF,
		generationRef: D38_GENERATION_REF,
		coordinatesDigest: D38_COORDINATES_DIGEST,
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmissionDigest,
		executionAuthorityDigest: authority.executionAuthorityDigest,
		failureAuthorityDigest: authority.authorityDigest,
		implementationManifestDigest: digest(
			input.implementationManifestDigest,
			"D38 preexecution implementation",
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
		schemaVersion: "graphrefly-ts.d38.live-preexecution-commit.v2",
		generationRef: D38_GENERATION_REF,
		failureDigest: failure.failureDigest,
		claimDigest: authority.claim.claimDigest,
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D38_GENERATION_REF,
		artifacts: Object.freeze({
			"partial-failure.v1.json": strictJsonCodec.encode(failure),
		}),
		commitBytes: strictJsonCodec.encode({
			...commitMaterial,
			commitDigest: empiricalStrictJsonDigest(commitMaterial),
		}),
	});
}
