import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
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
	validateD34RetainedSpanEvidence,
} from "./d34-retained-span-mutation-authority.js";
import {
	createD35RetainedSpanRealProviderExecutor,
	type D35RetainedSpanRealProviderExecutorV1,
} from "./d35-retained-span-real-provider-composition.js";
import { validateD35QualificationBundle } from "./d35-retained-span-real-provider-qualification.js";
import {
	consumeD36ExecutionAuthority,
	type D36DispatchClaimV1,
	type D36ExecutionAuthorityV1,
} from "./d36-retained-span-live-claim.js";
import {
	D36_COORDINATES_DIGEST,
	D36_D35_ARTIFACT_DIGEST,
	D36_D35_BUNDLE_DIGEST,
	D36_D35_EVIDENCE_DIGEST,
	D36_D35_GENERATION_DIGEST,
	D36_D35_IMPLEMENTATION_MANIFEST_DIGEST,
	D36_D35_QUALIFICATION_DIGEST,
	D36_DECISION_REF,
	D36_GENERATION_REF,
} from "./d36-retained-span-live-coordinates.js";
import type { D36CredentialV1 } from "./d36-retained-span-live-preflight.js";

export const D36_BASELINE_ADMISSION_REVISION =
	"graphrefly-ts.d36.d35-baseline-admission.v1" as const;
export const D36_BUNDLE_SCHEMA = "graphrefly-ts.d36.retained-span-live-bundle.v1" as const;
export const D36_GATE_SCHEMA = "graphrefly-ts.d36.positive-differential-gate.v1" as const;
export const D36_PARTIAL_SCHEMA = "graphrefly-ts.d36.partial-graph-evidence.v1" as const;
export const D36_GENERATION_SCHEMA = "graphrefly-ts.d36.live-generation.v1" as const;
export const D36_TERMINAL_SCHEMA = "graphrefly-ts.d36.live-terminal-receipt.v1" as const;
export const D36_MAX_BUNDLE_BYTES = 8_388_608;

export interface D36D35BaselineAdmissionV1 {
	readonly revision: typeof D36_BASELINE_ADMISSION_REVISION;
}

export interface D36PositiveDifferentialGateV1 {
	readonly schemaVersion: typeof D36_GATE_SCHEMA;
	readonly definitionDigest: string;
	readonly evaluated: boolean;
	readonly passed: boolean;
	readonly failureCodes: readonly string[];
	readonly gateDigest: string;
}

export interface D36PartialGraphEvidenceV1 {
	readonly schemaVersion: typeof D36_PARTIAL_SCHEMA;
	readonly decisionRef: typeof D36_DECISION_REF;
	readonly coordinatesDigest: string;
	readonly providerFacts: readonly CurrentGraphProviderFactV1[];
	readonly activeRequestDigest: string | null;
	readonly activeAdmissionDigest: string | null;
	readonly activeEffectKind: string | null;
	readonly failureCode:
		| "executor-boundary-failed"
		| "graph-admission-failed"
		| "effect-bound-exhausted"
		| "executor-disposal-failed";
	readonly partialGraphDigest: string;
}

export interface D36LiveBundleV1 {
	readonly schemaVersion: typeof D36_BUNDLE_SCHEMA;
	readonly decisionRef: typeof D36_DECISION_REF;
	readonly executionClass: "live-provider" | "injected-no-network";
	readonly disposition: "success" | "partial-failure";
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly d35ArtifactDigest: typeof D36_D35_ARTIFACT_DIGEST;
	readonly d35BundleDigest: typeof D36_D35_BUNDLE_DIGEST;
	readonly d35QualificationDigest: typeof D36_D35_QUALIFICATION_DIGEST;
	readonly d35GenerationDigest: typeof D36_D35_GENERATION_DIGEST;
	readonly d35EvidenceDigest: typeof D36_D35_EVIDENCE_DIGEST;
	readonly d35ImplementationManifestDigest: typeof D36_D35_IMPLEMENTATION_MANIFEST_DIGEST;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly claimDigest: string;
	readonly currentKeyAdmissionDigest: string;
	readonly graphEvidence: D34RetainedSpanEvidenceV1 | null;
	readonly partialGraphEvidence: D36PartialGraphEvidenceV1 | null;
	readonly gate: D36PositiveDifferentialGateV1;
	readonly generation: Readonly<Record<string, StrictJsonValue>> | null;
	readonly terminalReceipt: Readonly<Record<string, StrictJsonValue>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none" | "frozen-task-block-positive-differential";
	readonly bundleDigest: string;
}

const baselines = new WeakMap<object, "consumed-d35-artifact" | "injected-test">();
const constructed = new WeakSet<object>();

function makeBaseline(basis: "consumed-d35-artifact" | "injected-test") {
	const value = Object.freeze({ revision: D36_BASELINE_ADMISSION_REVISION });
	baselines.set(value, basis);
	return value;
}

export function admitD36D35Baseline(bytesValue: Uint8Array): D36D35BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D36 D35 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D36_D35_ARTIFACT_DIGEST)
		throw new TypeError("D36 D35 immutable artifact drifted");
	const bundle = validateD35QualificationBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.baselineBasis !== "consumed-d34-artifact" ||
		bundle.bundleDigest !== D36_D35_BUNDLE_DIGEST ||
		bundle.qualification.qualificationDigest !== D36_D35_QUALIFICATION_DIGEST ||
		bundle.generation.generationDigest !== D36_D35_GENERATION_DIGEST ||
		bundle.evidence.evidenceDigest !== D36_D35_EVIDENCE_DIGEST ||
		bundle.qualification.implementationManifestDigest !== D36_D35_IMPLEMENTATION_MANIFEST_DIGEST ||
		bundle.qualification.efficacyClaim !== "none"
	)
		throw new TypeError("D36 D35 immutable coordinates drifted");
	return makeBaseline("consumed-d35-artifact");
}

export function createD36InjectedBaselineForTest(): D36D35BaselineAdmissionV1 {
	return makeBaseline("injected-test");
}

function consumeBaseline(
	value: unknown,
	expected: "consumed-d35-artifact" | "injected-test",
): void {
	if (value === null || typeof value !== "object") throw new TypeError("D36 baseline is invalid");
	const basis = baselines.get(value);
	baselines.delete(value);
	if (basis !== expected) throw new TypeError("D36 baseline is forged, replayed or drifted");
}

function credentialBinding(credential: D36CredentialV1): string {
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
): D36PositiveDifferentialGateV1 {
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
		schemaVersion: D36_GATE_SCHEMA,
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
	readonly failureCode: D36PartialGraphEvidenceV1["failureCode"];
}): D36PartialGraphEvidenceV1 {
	const material = strictSnapshot({
		schemaVersion: D36_PARTIAL_SCHEMA,
		decisionRef: D36_DECISION_REF,
		coordinatesDigest: D36_COORDINATES_DIGEST,
		providerFacts: input.providerFacts,
		activeRequestDigest: input.activeRequestDigest,
		activeAdmissionDigest: input.activeAdmissionDigest,
		activeEffectKind: input.activeEffectKind,
		failureCode: input.failureCode,
	});
	return Object.freeze({ ...material, partialGraphDigest: empiricalStrictJsonDigest(material) });
}

async function drive(input: {
	readonly executionAuthority: D36ExecutionAuthorityV1;
	readonly baseline: D36D35BaselineAdmissionV1;
	readonly executionClass: D36LiveBundleV1["executionClass"];
	readonly executorFactory: (
		authority: ReturnType<typeof createD34RetainedSpanAuthority>,
	) => D35RetainedSpanRealProviderExecutorV1;
	readonly implementationManifestDigest: string;
	readonly allowConsumedBaselineForQualification?: boolean;
}): Promise<D36LiveBundleV1> {
	consumeBaseline(
		input.baseline,
		input.executionClass === "live-provider" || input.allowConsumedBaselineForQualification === true
			? "consumed-d35-artifact"
			: "injected-test",
	);
	const executionAuthority = consumeD36ExecutionAuthority(input.executionAuthority);
	if (executionAuthority.claim.implementationManifestDigest !== input.implementationManifestDigest)
		throw new TypeError("D36 implementation authority drifted");
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
	let failureCode: D36PartialGraphEvidenceV1["failureCode"] | null = null;
	try {
		for (let guard = 0; guard < CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts; guard += 1) {
			let execution: Awaited<ReturnType<D35RetainedSpanRealProviderExecutorV1["executeNext"]>>;
			try {
				execution = await executor.executeNext();
			} catch {
				failureCode = "executor-boundary-failed";
				break;
			}
			if (execution === null) {
				try {
					graphEvidence = validateD34RetainedSpanEvidence(
						snapshotD34RetainedSpanEvidence(graphAuthority),
					);
				} catch {
					failureCode = "graph-admission-failed";
				}
				break;
			}
			const request = execution.admitted.effect.effect.request;
			activeRequestDigest = request.requestDigest;
			activeAdmissionDigest = execution.admitted.effect.effect.admission.decisionDigest;
			activeEffectKind = request.effectKind;
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
				failureCode: failureCode ?? "graph-admission-failed",
			});
	const gate = evaluateGate(graphEvidence, input.executionClass === "live-provider" && success);
	const efficacyClaim = gate.passed
		? ("frozen-task-block-positive-differential" as const)
		: ("none" as const);
	const generation = success
		? (() => {
				const material = strictSnapshot({
					schemaVersion: D36_GENERATION_SCHEMA,
					generationRef: D36_GENERATION_REF,
					coordinatesDigest: D36_COORDINATES_DIGEST,
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
		schemaVersion: D36_TERMINAL_SCHEMA,
		decisionRef: D36_DECISION_REF,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		claimDigest: executionAuthority.claim.claimDigest,
		currentKeyAdmissionDigest: executionAuthority.currentKeyAdmission.admissionDigest,
		graphEvidenceDigest: graphEvidence?.evidenceDigest ?? null,
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
		schemaVersion: D36_BUNDLE_SCHEMA,
		decisionRef: D36_DECISION_REF,
		executionClass: input.executionClass,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		coordinatesDigest: D36_COORDINATES_DIGEST,
		implementationManifestDigest: input.implementationManifestDigest,
		d35ArtifactDigest: D36_D35_ARTIFACT_DIGEST,
		d35BundleDigest: D36_D35_BUNDLE_DIGEST,
		d35QualificationDigest: D36_D35_QUALIFICATION_DIGEST,
		d35GenerationDigest: D36_D35_GENERATION_DIGEST,
		d35EvidenceDigest: D36_D35_EVIDENCE_DIGEST,
		d35ImplementationManifestDigest: D36_D35_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: executionAuthority.claim.qualificationArtifactDigest,
		qualificationDigest: executionAuthority.claim.qualificationDigest,
		pricingObservationDigest: executionAuthority.claim.pricingObservationDigest,
		zeroByokObservationDigest: executionAuthority.claim.zeroByokObservationDigest,
		claimDigest: executionAuthority.claim.claimDigest,
		currentKeyAdmissionDigest: executionAuthority.currentKeyAdmission.admissionDigest,
		graphEvidence,
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
	}) as D36LiveBundleV1;
	if (
		strictJsonCodec.encode(bundle as unknown as StrictJsonValue).byteLength > D36_MAX_BUNDLE_BYTES
	)
		throw new TypeError("D36 live bundle exceeded its byte bound");
	constructed.add(bundle);
	return bundle;
}

export async function runD36LiveMeasurement(input: {
	readonly executionAuthority: D36ExecutionAuthorityV1;
	readonly baseline: D36D35BaselineAdmissionV1;
	readonly credential: D36CredentialV1;
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly implementationManifestDigest: string;
	readonly now?: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
}): Promise<D36LiveBundleV1> {
	if (
		input.executionAuthority.claim.scope !== "live-fixed-root" ||
		credentialBinding(input.credential) !== input.executionAuthority.claim.credentialBindingDigest
	)
		throw new TypeError("D36 live credential or claim scope drifted");
	return drive({
		executionAuthority: input.executionAuthority,
		baseline: input.baseline,
		executionClass: "live-provider",
		implementationManifestDigest: input.implementationManifestDigest,
		executorFactory: (authority) =>
			createD35RetainedSpanRealProviderExecutor({
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

export async function runD36InjectedMeasurementForTest(input: {
	readonly executionAuthority: D36ExecutionAuthorityV1;
	readonly baseline: D36D35BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
	readonly executorFactory: (
		authority: ReturnType<typeof createD34RetainedSpanAuthority>,
	) => D35RetainedSpanRealProviderExecutorV1;
	readonly allowConsumedBaselineForQualification?: boolean;
}): Promise<D36LiveBundleV1> {
	return drive({ ...input, executionClass: "injected-no-network" });
}

export function validateD36LiveBundle(value: unknown): D36LiveBundleV1 {
	const candidate = record(value, "D36 live bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"claimDigest",
			"coordinatesDigest",
			"currentKeyAdmissionDigest",
			"d35ArtifactDigest",
			"d35BundleDigest",
			"d35EvidenceDigest",
			"d35GenerationDigest",
			"d35ImplementationManifestDigest",
			"d35QualificationDigest",
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
		"D36 live bundle",
	);
	if (
		candidate.schemaVersion !== D36_BUNDLE_SCHEMA ||
		candidate.decisionRef !== D36_DECISION_REF ||
		candidate.coordinatesDigest !== D36_COORDINATES_DIGEST ||
		candidate.d35ArtifactDigest !== D36_D35_ARTIFACT_DIGEST ||
		candidate.d35BundleDigest !== D36_D35_BUNDLE_DIGEST ||
		candidate.d35QualificationDigest !== D36_D35_QUALIFICATION_DIGEST ||
		candidate.d35GenerationDigest !== D36_D35_GENERATION_DIGEST ||
		candidate.d35EvidenceDigest !== D36_D35_EVIDENCE_DIGEST ||
		candidate.d35ImplementationManifestDigest !== D36_D35_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("D36 live coordinates drifted");
	const graphEvidence =
		candidate.graphEvidence === null
			? null
			: validateD34RetainedSpanEvidence(candidate.graphEvidence);
	if (
		(candidate.disposition === "success") !== (graphEvidence !== null) ||
		(candidate.disposition === "success") !== (candidate.generation !== null) ||
		(candidate.disposition === "partial-failure") !== (candidate.partialGraphEvidence !== null)
	)
		throw new TypeError("D36 disposition drifted");
	const expectedGate = evaluateGate(
		graphEvidence,
		candidate.executionClass === "live-provider" && candidate.disposition === "success",
	);
	if (
		empiricalStrictJsonDigest(candidate.gate) !==
		empiricalStrictJsonDigest(expectedGate as unknown as StrictJsonValue)
	)
		throw new TypeError("D36 gate drifted");
	const expectedClaim = expectedGate.passed ? "frozen-task-block-positive-differential" : "none";
	if (candidate.efficacyClaim !== expectedClaim || candidate.causalAttribution !== "undetermined")
		throw new TypeError("D36 efficacy claim drifted");
	const material = strictSnapshot(
		Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "bundleDigest")),
	);
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D36 bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D36LiveBundleV1;
}

export async function persistD36LiveBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D36LiveBundleV1;
}) {
	if (!constructed.has(input.bundle as object))
		throw new TypeError("D36 live bundle is forged or replayed");
	constructed.delete(input.bundle as object);
	const bundle = validateD36LiveBundle(input.bundle);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d36.live-commit.v1",
		generationRef: D36_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		terminalReceiptDigest: digest(
			bundle.terminalReceipt.terminalReceiptDigest,
			"D36 terminal receipt",
		),
		disposition: bundle.disposition,
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D36_GENERATION_REF,
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

export async function persistD36PreexecutionFailure(input: {
	readonly privateRoot: string;
	readonly claim: D36DispatchClaimV1;
	readonly implementationManifestDigest: string;
	readonly failurePhase: "current-key-admission" | "execution-construction";
}) {
	if (input.claim.scope !== "live-fixed-root")
		throw new TypeError("D36 preexecution failure rejected a non-live claim");
	const material = strictSnapshot({
		schemaVersion: "graphrefly-ts.d36.live-preexecution-failure.v1",
		decisionRef: D36_DECISION_REF,
		generationRef: D36_GENERATION_REF,
		coordinatesDigest: D36_COORDINATES_DIGEST,
		claimDigest: input.claim.claimDigest,
		implementationManifestDigest: digest(
			input.implementationManifestDigest,
			"D36 preexecution implementation",
		),
		failurePhase: input.failurePhase,
		disposition: "partial-failure" as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const failure = Object.freeze({
		...material,
		failureDigest: empiricalStrictJsonDigest(material),
	});
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d36.live-preexecution-commit.v1",
		generationRef: D36_GENERATION_REF,
		failureDigest: failure.failureDigest,
		claimDigest: input.claim.claimDigest,
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D36_GENERATION_REF,
		artifacts: Object.freeze({
			"partial-failure.v1.json": strictJsonCodec.encode(failure),
		}),
		commitBytes: strictJsonCodec.encode({
			...commitMaterial,
			commitDigest: empiricalStrictJsonDigest(commitMaterial),
		}),
	});
}
