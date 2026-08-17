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
import { CURRENT_GRAPH_LIVE_ROUTE } from "./d8-current-live-coordinates.js";
import type { D9ProviderRejectionFactV1 } from "./d9-current-provider-rejection-authority.js";
import {
	D21_LIMITS,
	D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
	D21_TASK_PROFILE,
} from "./d21-current-efficacy-recovery-authority.js";
import {
	admitD25EffectResult,
	createD25PhaseAuthority,
	type D25PhaseEvidenceV1,
	snapshotD25PhaseEvidence,
	validateD25PhaseEvidence,
} from "./d25-phase-specific-tool-admission.js";
import {
	createD26PhaseSpecificRealProviderExecutor,
	type D26PhaseSpecificExecutorV1,
} from "./d26-phase-specific-real-provider-composition.js";
import { validateD26QualificationBundle } from "./d26-phase-specific-real-provider-qualification.js";
import {
	consumeD27ExecutionAuthority,
	type D27DispatchClaimV1,
	type D27ExecutionAuthorityV1,
} from "./d27-phase-specific-live-claim.js";
import {
	D27_COORDINATES_DIGEST,
	D27_D26_ARTIFACT_DIGEST,
	D27_D26_BUNDLE_DIGEST,
	D27_D26_GENERATION_DIGEST,
	D27_D26_IMPLEMENTATION_MANIFEST_DIGEST,
	D27_D26_QUALIFICATION_DIGEST,
	D27_DECISION_REF,
	D27_GENERATION_REF,
} from "./d27-phase-specific-live-coordinates.js";
import type { D27CredentialV1 } from "./d27-phase-specific-live-preflight.js";

export const D27_BASELINE_ADMISSION_REVISION =
	"graphrefly-ts.d28.d26-baseline-admission.v1" as const;
export const D27_BUNDLE_SCHEMA = "graphrefly-ts.d28.phase-specific-live-bundle.v1" as const;
export const D27_GATE_SCHEMA = "graphrefly-ts.d28.positive-differential-gate.v1" as const;
export const D27_PARTIAL_SCHEMA = "graphrefly-ts.d28.partial-graph-evidence.v1" as const;
export const D27_GENERATION_SCHEMA = "graphrefly-ts.d28.live-generation.v1" as const;
export const D27_TERMINAL_SCHEMA = "graphrefly-ts.d28.live-terminal-receipt.v1" as const;
export const D27_MAX_BUNDLE_BYTES = 4_194_304;

export interface D27D26BaselineAdmissionV1 {
	readonly revision: typeof D27_BASELINE_ADMISSION_REVISION;
}

export interface D27PositiveDifferentialGateV1 {
	readonly schemaVersion: typeof D27_GATE_SCHEMA;
	readonly definitionDigest: string;
	readonly evaluated: boolean;
	readonly passed: boolean;
	readonly failureCodes: readonly string[];
	readonly gateDigest: string;
}

export interface D27PartialGraphEvidenceV1 {
	readonly schemaVersion: typeof D27_PARTIAL_SCHEMA;
	readonly decisionRef: typeof D27_DECISION_REF;
	readonly coordinatesDigest: string;
	readonly providerFacts: readonly CurrentGraphProviderFactV1[];
	readonly rejectionFacts: readonly D9ProviderRejectionFactV1[];
	readonly activeRequestDigest: string | null;
	readonly failureCode:
		| "executor-boundary-failed"
		| "graph-admission-failed"
		| "effect-bound-exhausted"
		| "executor-disposal-failed";
	readonly partialGraphDigest: string;
}

export interface D27LiveBundleV1 {
	readonly schemaVersion: typeof D27_BUNDLE_SCHEMA;
	readonly decisionRef: typeof D27_DECISION_REF;
	readonly executionClass: "live-provider" | "injected-no-network";
	readonly disposition: "success" | "partial-failure";
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly d26ArtifactDigest: typeof D27_D26_ARTIFACT_DIGEST;
	readonly d26BundleDigest: typeof D27_D26_BUNDLE_DIGEST;
	readonly d26QualificationDigest: typeof D27_D26_QUALIFICATION_DIGEST;
	readonly d26GenerationDigest: typeof D27_D26_GENERATION_DIGEST;
	readonly d26ImplementationManifestDigest: typeof D27_D26_IMPLEMENTATION_MANIFEST_DIGEST;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly claimDigest: string;
	readonly currentKeyAdmissionDigest: string;
	readonly graphEvidence: D25PhaseEvidenceV1 | null;
	readonly partialGraphEvidence: D27PartialGraphEvidenceV1 | null;
	readonly gate: D27PositiveDifferentialGateV1;
	readonly generation: Readonly<Record<string, StrictJsonValue>> | null;
	readonly terminalReceipt: Readonly<Record<string, StrictJsonValue>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none" | "frozen-task-block-positive-differential";
	readonly bundleDigest: string;
}

const baselines = new WeakMap<object, "consumed-d26-artifact" | "injected-test">();
const constructed = new WeakSet<object>();

function makeBaseline(basis: "consumed-d26-artifact" | "injected-test") {
	const value = Object.freeze({ revision: D27_BASELINE_ADMISSION_REVISION });
	baselines.set(value, basis);
	return value;
}

export function admitD27D26Baseline(bytesValue: Uint8Array): D27D26BaselineAdmissionV1 {
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D27_D26_ARTIFACT_DIGEST)
		throw new TypeError("D27 D26 artifact drifted");
	const bundle = validateD26QualificationBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.basis !== "consumed-d25-artifact" ||
		bundle.bundleDigest !== D27_D26_BUNDLE_DIGEST ||
		bundle.qualification.qualificationDigest !== D27_D26_QUALIFICATION_DIGEST ||
		bundle.generation.generationDigest !== D27_D26_GENERATION_DIGEST ||
		bundle.qualification.implementationManifestDigest !== D27_D26_IMPLEMENTATION_MANIFEST_DIGEST ||
		bundle.qualification.providerNetworkCalls !== 0 ||
		bundle.qualification.liveGateEvaluated !== false ||
		bundle.qualification.efficacyClaim !== "none"
	)
		throw new TypeError("D27 D26 canonical coordinates drifted");
	return makeBaseline("consumed-d26-artifact");
}

export function createD27InjectedBaselineForTest(): D27D26BaselineAdmissionV1 {
	return makeBaseline("injected-test");
}

function consumeBaseline(value: unknown, expected: "consumed-d26-artifact" | "injected-test") {
	if (value === null || typeof value !== "object") throw new TypeError("D27 baseline is invalid");
	const basis = baselines.get(value);
	baselines.delete(value);
	if (basis !== expected) throw new TypeError("D27 baseline is forged, replayed or drifted");
}

function credentialBinding(credential: D27CredentialV1): string {
	return empiricalStrictJsonDigest({
		credentialBindingRef: credential.credentialBindingRef,
		credentialBindingRevision: credential.credentialBindingRevision,
		keyVisiblePrefix: credential.bearerToken.slice(0, 12),
		keyVisibleSuffix: credential.bearerToken.slice(-3),
	});
}

function evaluateGate(
	evidence: D25PhaseEvidenceV1 | null,
	evaluated: boolean,
): D27PositiveDifferentialGateV1 {
	const failures: string[] = [];
	if (evidence === null) failures.push("measurement-incomplete");
	else {
		const provider = evidence.workflowEvidence;
		const workflow = provider.providerEvidence.workflowEvidence;
		if (provider.rejectionCount !== 0) failures.push("provider-result-rejection");
		if (workflow.runStatus !== "complete" || workflow.runs.length !== 6)
			failures.push("six-arm-completion-missing");
		const arms = [
			"cold",
			"relevant-applied",
			"proposal-only",
			"admission-rejected",
			"irrelevant-applied",
			"wrong-scope-applied",
		] as const;
		for (const [index, arm] of arms.entries()) {
			const run = workflow.runs[index];
			if (run?.arm !== arm) failures.push(`arm-order:${arm}`);
			if (
				run?.publicSemanticValidationAttempted !== true ||
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
		if (
			evidence.phaseFacts.some(
				(fact) =>
					fact.disposition !== "accepted-inspection" && fact.disposition !== "accepted-mutation",
			)
		)
			failures.push("phase-admission-failure");
	}
	const material = strictSnapshot({
		schemaVersion: D27_GATE_SCHEMA,
		definitionDigest: D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
		evaluated,
		passed: evaluated && failures.length === 0,
		failureCodes: Object.freeze(failures),
	});
	return Object.freeze({ ...material, gateDigest: empiricalStrictJsonDigest(material) });
}

function partialEvidence(input: {
	readonly providerFacts: readonly CurrentGraphProviderFactV1[];
	readonly rejectionFacts: readonly D9ProviderRejectionFactV1[];
	readonly activeRequestDigest: string | null;
	readonly failureCode: D27PartialGraphEvidenceV1["failureCode"];
}): D27PartialGraphEvidenceV1 {
	const material = strictSnapshot({
		schemaVersion: D27_PARTIAL_SCHEMA,
		decisionRef: D27_DECISION_REF,
		coordinatesDigest: D27_COORDINATES_DIGEST,
		providerFacts: input.providerFacts,
		rejectionFacts: input.rejectionFacts,
		activeRequestDigest: input.activeRequestDigest,
		failureCode: input.failureCode,
	});
	return Object.freeze({ ...material, partialGraphDigest: empiricalStrictJsonDigest(material) });
}

async function drive(input: {
	readonly executionAuthority: D27ExecutionAuthorityV1;
	readonly baseline: D27D26BaselineAdmissionV1;
	readonly executionClass: D27LiveBundleV1["executionClass"];
	readonly executorFactory: (
		authority: ReturnType<typeof createD25PhaseAuthority>,
	) => D26PhaseSpecificExecutorV1;
	readonly implementationManifestDigest: string;
	readonly allowConsumedBaselineForQualification?: boolean;
}): Promise<D27LiveBundleV1> {
	consumeBaseline(
		input.baseline,
		input.executionClass === "live-provider" || input.allowConsumedBaselineForQualification === true
			? "consumed-d26-artifact"
			: "injected-test",
	);
	const executionAuthority = consumeD27ExecutionAuthority(input.executionAuthority);
	if (executionAuthority.claim.implementationManifestDigest !== input.implementationManifestDigest)
		throw new TypeError("D27 implementation authority drifted");
	const authority = createD25PhaseAuthority({
		limits: D21_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: D21_TASK_PROFILE,
	});
	const executor = input.executorFactory(authority);
	const providerFacts: CurrentGraphProviderFactV1[] = [];
	const rejectionFacts: D9ProviderRejectionFactV1[] = [];
	let activeRequestDigest: string | null = null;
	let graphEvidence: D25PhaseEvidenceV1 | null = null;
	let failureCode: D27PartialGraphEvidenceV1["failureCode"] | null = null;
	try {
		for (let guard = 0; guard < D21_LIMITS.maxEffectFacts; guard += 1) {
			let execution: Awaited<ReturnType<D26PhaseSpecificExecutorV1["executeNext"]>>;
			try {
				execution = await executor.executeNext();
			} catch {
				failureCode = "executor-boundary-failed";
				break;
			}
			if (execution === null) {
				try {
					graphEvidence = validateD25PhaseEvidence(snapshotD25PhaseEvidence(authority));
				} catch {
					failureCode = "graph-admission-failed";
				}
				break;
			}
			activeRequestDigest = execution.admitted.effect.request.requestDigest;
			try {
				const outcome = admitD25EffectResult(authority, execution.admitted, execution.result);
				providerFacts.push(outcome.providerFact);
				if (outcome.rejectionFact !== null) rejectionFacts.push(outcome.rejectionFact);
				activeRequestDigest = null;
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
				rejectionFacts,
				activeRequestDigest,
				failureCode: failureCode ?? "graph-admission-failed",
			});
	const gate = evaluateGate(graphEvidence, input.executionClass === "live-provider" && success);
	const efficacyClaim = gate.passed
		? ("frozen-task-block-positive-differential" as const)
		: ("none" as const);
	const generation = success
		? (() => {
				const material = strictSnapshot({
					schemaVersion: D27_GENERATION_SCHEMA,
					generationRef: D27_GENERATION_REF,
					coordinatesDigest: D27_COORDINATES_DIGEST,
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
	const facts = graphEvidence?.workflowEvidence.providerEvidence.facts ?? providerFacts;
	const providerAttempts = facts.filter(
		(fact) => fact.request.effectKind === "provider-request",
	).length;
	const confirmedCostMicrousd = facts.reduce(
		(sum, fact) => sum + fact.reconciliation.actualCostMicrousd,
		0,
	);
	const terminalMaterial = strictSnapshot({
		schemaVersion: D27_TERMINAL_SCHEMA,
		decisionRef: D27_DECISION_REF,
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
		schemaVersion: D27_BUNDLE_SCHEMA,
		decisionRef: D27_DECISION_REF,
		executionClass: input.executionClass,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		coordinatesDigest: D27_COORDINATES_DIGEST,
		implementationManifestDigest: input.implementationManifestDigest,
		d26ArtifactDigest: D27_D26_ARTIFACT_DIGEST,
		d26BundleDigest: D27_D26_BUNDLE_DIGEST,
		d26QualificationDigest: D27_D26_QUALIFICATION_DIGEST,
		d26GenerationDigest: D27_D26_GENERATION_DIGEST,
		d26ImplementationManifestDigest: D27_D26_IMPLEMENTATION_MANIFEST_DIGEST,
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
	}) as D27LiveBundleV1;
	if (
		strictJsonCodec.encode(bundle as unknown as StrictJsonValue).byteLength > D27_MAX_BUNDLE_BYTES
	)
		throw new TypeError("D27 live bundle exceeded its byte bound");
	constructed.add(bundle);
	return bundle;
}

export async function runD27LiveMeasurement(input: {
	readonly executionAuthority: D27ExecutionAuthorityV1;
	readonly baseline: D27D26BaselineAdmissionV1;
	readonly credential: D27CredentialV1;
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly implementationManifestDigest: string;
	readonly now?: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
}): Promise<D27LiveBundleV1> {
	if (
		input.executionAuthority.claim.scope !== "live-fixed-root" ||
		credentialBinding(input.credential) !== input.executionAuthority.claim.credentialBindingDigest
	)
		throw new TypeError("D27 live credential or claim scope drifted");
	return drive({
		executionAuthority: input.executionAuthority,
		baseline: input.baseline,
		executionClass: "live-provider",
		implementationManifestDigest: input.implementationManifestDigest,
		executorFactory: (authority) =>
			createD26PhaseSpecificRealProviderExecutor({
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

export async function runD27InjectedMeasurementForTest(input: {
	readonly executionAuthority: D27ExecutionAuthorityV1;
	readonly baseline: D27D26BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
	readonly executorFactory: (
		authority: ReturnType<typeof createD25PhaseAuthority>,
	) => D26PhaseSpecificExecutorV1;
	readonly allowConsumedBaselineForQualification?: boolean;
}): Promise<D27LiveBundleV1> {
	return drive({ ...input, executionClass: "injected-no-network" });
}

export function validateD27LiveBundle(value: unknown): D27LiveBundleV1 {
	const candidate = record(value, "D27 live bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"claimDigest",
			"coordinatesDigest",
			"currentKeyAdmissionDigest",
			"d26ArtifactDigest",
			"d26BundleDigest",
			"d26GenerationDigest",
			"d26ImplementationManifestDigest",
			"d26QualificationDigest",
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
		"D27 live bundle",
	);
	if (
		candidate.schemaVersion !== D27_BUNDLE_SCHEMA ||
		candidate.decisionRef !== D27_DECISION_REF ||
		candidate.coordinatesDigest !== D27_COORDINATES_DIGEST
	)
		throw new TypeError("D27 live bundle coordinates drifted");
	if (
		candidate.d26ArtifactDigest !== D27_D26_ARTIFACT_DIGEST ||
		candidate.d26BundleDigest !== D27_D26_BUNDLE_DIGEST ||
		candidate.d26QualificationDigest !== D27_D26_QUALIFICATION_DIGEST ||
		candidate.d26GenerationDigest !== D27_D26_GENERATION_DIGEST ||
		candidate.d26ImplementationManifestDigest !== D27_D26_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("D27 D26 baseline drifted");
	const graphEvidence =
		candidate.graphEvidence === null ? null : validateD25PhaseEvidence(candidate.graphEvidence);
	if (
		(candidate.disposition === "success") !== (graphEvidence !== null) ||
		(candidate.disposition === "success") !== (candidate.generation !== null) ||
		(candidate.disposition === "partial-failure") !== (candidate.partialGraphEvidence !== null)
	)
		throw new TypeError("D27 disposition drifted");
	const gate = record(candidate.gate, "D27 gate");
	const expectedGate = evaluateGate(
		graphEvidence,
		candidate.executionClass === "live-provider" && candidate.disposition === "success",
	);
	if (
		empiricalStrictJsonDigest(gate as StrictJsonValue) !==
		empiricalStrictJsonDigest(expectedGate as unknown as StrictJsonValue)
	)
		throw new TypeError("D27 gate drifted");
	const expectedClaim = expectedGate.passed ? "frozen-task-block-positive-differential" : "none";
	if (candidate.efficacyClaim !== expectedClaim || candidate.causalAttribution !== "undetermined")
		throw new TypeError("D27 claim drifted");
	const material = strictSnapshot(
		Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "bundleDigest")),
	);
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D27 bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D27LiveBundleV1;
}

export async function persistD27LiveBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D27LiveBundleV1;
}) {
	if (!constructed.has(input.bundle as object))
		throw new TypeError("D27 live bundle is forged or replayed");
	constructed.delete(input.bundle as object);
	const bundle = validateD27LiveBundle(input.bundle);
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const terminalBytes = strictJsonCodec.encode(bundle.terminalReceipt as StrictJsonValue);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d28.live-commit.v1",
		generationRef: D27_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		terminalReceiptDigest: digest(
			bundle.terminalReceipt.terminalReceiptDigest,
			"D27 terminal receipt",
		),
		disposition: bundle.disposition,
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D27_GENERATION_REF,
		artifacts: Object.freeze({
			"bundle.v1.json": bundleBytes,
			"terminal-receipt.v1.json": terminalBytes,
		}),
		commitBytes: strictJsonCodec.encode({
			...commitMaterial,
			commitDigest: empiricalStrictJsonDigest(commitMaterial),
		}),
	});
}

export async function persistD27PreexecutionFailure(input: {
	readonly privateRoot: string;
	readonly claim: D27DispatchClaimV1;
	readonly implementationManifestDigest: string;
	readonly failurePhase: "current-key-admission" | "execution-construction";
}) {
	if (input.claim.scope !== "live-fixed-root")
		throw new TypeError("D27 preexecution failure rejected a non-live claim");
	const material = strictSnapshot({
		schemaVersion: "graphrefly-ts.d28.live-preexecution-failure.v1",
		decisionRef: D27_DECISION_REF,
		generationRef: D27_GENERATION_REF,
		coordinatesDigest: D27_COORDINATES_DIGEST,
		claimDigest: input.claim.claimDigest,
		implementationManifestDigest: digest(
			input.implementationManifestDigest,
			"D27 preexecution implementation",
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
	const bytes = strictJsonCodec.encode(failure);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d28.live-preexecution-commit.v1",
		generationRef: D27_GENERATION_REF,
		failureDigest: failure.failureDigest,
		claimDigest: input.claim.claimDigest,
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D27_GENERATION_REF,
		artifacts: Object.freeze({ "partial-failure.v1.json": bytes }),
		commitBytes: strictJsonCodec.encode({
			...commitMaterial,
			commitDigest: empiricalStrictJsonDigest(commitMaterial),
		}),
	});
}
