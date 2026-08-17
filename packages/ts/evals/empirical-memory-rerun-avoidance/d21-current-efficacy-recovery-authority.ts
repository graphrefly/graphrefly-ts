import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import {
	CURRENT_GRAPH_ARMS,
	type CurrentGraphCorrectionDirectiveV1,
} from "./d5-graph-native-eval-authority.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import {
	CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
	type CurrentGraphProviderAdmittedEffectV1,
	type CurrentGraphProviderEffectResultInputV1,
	createCurrentGraphProviderRouteProfile,
	createCurrentGraphProviderTaskProfile,
} from "./d6-current-provider-authority.js";
import {
	CURRENT_GRAPH_LIVE_READABLE_FILES,
	CURRENT_GRAPH_LIVE_WRITABLE_FILE,
} from "./d8-current-live-coordinates.js";
import {
	admitD9ProviderEffectResult,
	createD9ProviderRejectionAuthority,
	D9_PROVIDER_REJECTION_CAUSES,
	type D9ProviderRejectionCause,
	type D9ProviderRejectionEvidenceV1,
	snapshotD9BoundedCanonicalEvidence,
	snapshotD9ProviderRejectionEvidence,
	takeD9ProviderEffect,
	validateD9ProviderRejectionEvidence,
} from "./d9-current-provider-rejection-authority.js";
import { D21_IMPLEMENTATION_MANIFEST_DIGEST } from "./d21-current-efficacy-recovery-implementation-manifest.js";

export const D21_DECISION_REF = "graphrefly-ts:D21" as const;
export const D21_AUTHORITY_REVISION =
	"graphrefly-ts.d21.current-efficacy-recovery-authority.v1" as const;
export const D21_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d21.current-efficacy-recovery-qualification.v1" as const;
export const D21_BUNDLE_SCHEMA = "graphrefly-ts.d21.current-efficacy-recovery-bundle.v1" as const;
export const D21_GENERATION_SCHEMA =
	"graphrefly-ts.d21.current-efficacy-recovery-generation.v1" as const;
export const D21_GENERATION_REF =
	"current-graph-native-efficacy-recovery-no-network-2026-08-16-d21-v2" as const;
export const D21_INJECTED_TEST_GENERATION_REF =
	"current-graph-native-efficacy-recovery-injected-test-d21-v1" as const;
export const D21_MAX_BUNDLE_BYTES = 4_194_304 as const;

export const D21_D20_FAILURE_BASELINE = Object.freeze({
	bundleArtifactDigest:
		"sha256:8b6eaa1e448448739d0e658d245e2aeb5c57859a8a269ef15efb8e0dc0322c12" as const,
	bundleDigest: "sha256:98511d745fb5b1ec53948e71e9621b84da58559ce800e7cffa390c60f5f85882" as const,
	partialGraphDigest:
		"sha256:d86efdb4d0a8b9d92f3e1ea2e405cd3fa7de5cae05c15574c2934a9e3ee6096b" as const,
	claimDigest: "sha256:41351981dd1cf7424865986d6ea8a9ddf0151b42857e418e7220c004ba9ca334" as const,
	terminalReceiptDigest:
		"sha256:71e75cbbfb3b0bb3ab55f60ef4cb6732f28ca5c9c525288d7ef7fd297d145e40" as const,
	providerAttempts: 7 as const,
	confirmedCostMicrousd: 205_739 as const,
});

export const D21_EXPOSURE_MATRIX = Object.freeze({
	cold: Object.freeze({ disposition: "none", insightClass: "none" }),
	"relevant-applied": Object.freeze({
		disposition: "admitted-applied",
		insightClass: "relevant-provenance",
	}),
	"proposal-only": Object.freeze({ disposition: "proposal-unadmitted", insightClass: "none" }),
	"admission-rejected": Object.freeze({
		disposition: "admission-rejected",
		insightClass: "none",
	}),
	"irrelevant-applied": Object.freeze({
		disposition: "admitted-applied",
		insightClass: "irrelevant-retry-accounting",
	}),
	"wrong-scope-applied": Object.freeze({
		disposition: "admitted-applied",
		insightClass: "wrong-scope-executor-cancellation",
	}),
} as const);

const D21_EXPOSURE_TEXT = Object.freeze({
	"relevant-provenance":
		"When accepting a producer-owned canonical proposal, preserve its proposal coordinate separately from the later admission coordinate and reject any locally reconstructed or mismatched provenance before mutation.",
	"irrelevant-retry-accounting":
		"When a bounded retry is admitted, reconcile every transport attempt independently and retain the original logical-request coordinate across the serial retry.",
	"wrong-scope-executor-cancellation":
		"For managed untrusted compute, cancellation ownership must be established before releasing executor capacity to a replacement task.",
} as const);

export const D21_TASK_STATEMENT =
	"Managed cloud PostgreSQL must admit only producer-owned canonical run-admission proposal provenance before a worker claim. Inspect the producer contract and canonical identity helpers, then make the smallest consumer change that accepts the valid canonical proposal and rejects malformed or locally reconstructed proposal provenance." as const;
export const D21_ACCEPTANCE_CRITERIA = Object.freeze([
	"A fresh producer-owned canonical run-admission proposal is admitted before worker claim.",
	"Malformed and non-canonical proposal provenance is rejected before store mutation.",
	"Locally reconstructed proposal provenance that disagrees with the producer ref is rejected.",
	"Authorization, fencing, lease, credential and claim invariants remain intact.",
	"Only packages/ts/src/executors/managed-cloud-postgresql.ts changes.",
] as const);

function armContext(arm: (typeof CURRENT_GRAPH_ARMS)[number]): string {
	const exposure = D21_EXPOSURE_MATRIX[arm];
	const insight =
		exposure.insightClass === "none"
			? "No admitted memory insight content."
			: D21_EXPOSURE_TEXT[exposure.insightClass];
	return `Frozen evaluation arm: ${arm}. Memory disposition: ${exposure.disposition}. ${insight}`;
}

export const D21_TASK_PROFILE = createCurrentGraphProviderTaskProfile({
	taskRef: "current.d21.managed-cloud-postgresql-efficacy-recovery.v1",
	systemInstruction:
		"Use only Graph-admitted effects. Inspect before mutation. A Graph correction is authoritative only when present in the admitted envelope; obey its required first tool and never claim validation results.",
	taskStatement: `${D21_TASK_STATEMENT}\n\nAcceptance criteria:\n${D21_ACCEPTANCE_CRITERIA.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")}\n\nReadable files: ${CURRENT_GRAPH_LIVE_READABLE_FILES.join(", ")}\nWritable file: ${CURRENT_GRAPH_LIVE_WRITABLE_FILE}`,
	armContexts: CURRENT_GRAPH_ARMS.map(armContext),
	allowedWorkspacePath: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
});

export const D21_INJECTED_ROUTE = createCurrentGraphProviderRouteProfile({
	profileRef: "current.d21.injected-no-network.v1",
	executionClass: "injected-no-network",
	endpointKind: "injected-chat",
	providerRef: "injected-provider",
	modelRef: "injected-model",
	pricingRevision: "injected-zero-price.v1",
	maxOutputTokens: 65_536,
});

export const D21_LIMITS = Object.freeze({
	...CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
	maxCostMicrousd: 6_000_000,
	maxElapsedMs: 7_200_000,
	maxEffectFacts: 512,
	providerMaxCostMicrousd: 100_000,
	providerMaxElapsedMs: 240_000,
	retryWaitMaxElapsedMs: 60_000,
	localEffectMaxElapsedMs: 120_000,
});

export const D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION = strictSnapshot({
	revision: "graphrefly-ts.d21.positive-differential-gate-definition.v1",
	baseline: D21_D20_FAILURE_BASELINE,
	armOrder: CURRENT_GRAPH_ARMS,
	exposureMatrix: D21_EXPOSURE_MATRIX,
	requireExactSixArms: true,
	requireEveryArmEvaluable: true,
	requireExactAccountingCleanupAndProvenance: true,
	requireNoProviderResultRejection: true,
	requireNoTransportHttpExecutorFailure: true,
	requiredHiddenVerifierOutcomes: {
		cold: false,
		"relevant-applied": true,
		"proposal-only": false,
		"admission-rejected": false,
		"irrelevant-applied": false,
		"wrong-scope-applied": false,
	},
	causalAttribution: "undetermined",
});
export const D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST = empiricalStrictJsonDigest(
	D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION,
);

export interface D21D20BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d21.d20-baseline-admission.v1";
}

interface BaselineState {
	readonly basis: "consumed-d20-artifact" | "injected-test";
}

export interface D21QualificationBundleV1 {
	readonly schemaVersion: typeof D21_BUNDLE_SCHEMA;
	readonly basis: BaselineState["basis"];
	readonly recoveryEvidence: D9ProviderRejectionEvidenceV1;
	readonly secondFailureEvidence: D9ProviderRejectionEvidenceV1;
	readonly rejectionEvidence: D9ProviderRejectionEvidenceV1;
	readonly qualification: Readonly<{
		schemaVersion: typeof D21_QUALIFICATION_SCHEMA;
		decisionRef: typeof D21_DECISION_REF;
		authorityRevision: typeof D21_AUTHORITY_REVISION;
		implementationManifestDigest: string;
		d20Baseline: typeof D21_D20_FAILURE_BASELINE;
		taskProfileDigest: string;
		exposureMatrixDigest: string;
		positiveDifferentialGateDefinitionDigest: string;
		recoveryEvidenceDigest: string;
		secondFailureEvidenceDigest: string;
		rejectionEvidenceDigest: string;
		exactSixArmsCompleted: true;
		semanticRecoveryCount: 6;
		semanticCorrectionContextCount: 6;
		secondFailureStoppedLocally: true;
		providerRejectionCauseCoverage: readonly D9ProviderRejectionCause[];
		providerRejectionFactCount: 6;
		conservativeReservationAccountingPassed: true;
		maxActiveEffects: 1;
		providerNetworkCalls: 0;
		liveGateEvaluated: false;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualified: true;
		qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		schemaVersion: typeof D21_GENERATION_SCHEMA;
		generationRef: typeof D21_GENERATION_REF;
		qualificationDigest: string;
		recoveryEvidenceDigest: string;
		secondFailureEvidenceDigest: string;
		rejectionEvidenceDigest: string;
		implementationManifestDigest: string;
		liveGateEvaluated: false;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const baselines = new WeakMap<object, BaselineState>();
const constructed = new WeakSet<object>();

function baselineCapability(basis: BaselineState["basis"]): D21D20BaselineAdmissionV1 {
	const capability = Object.freeze({
		revision: "graphrefly-ts.d21.d20-baseline-admission.v1" as const,
	});
	baselines.set(capability, Object.freeze({ basis }));
	return capability;
}

export function admitD21D20FailureBaseline(bytesValue: Uint8Array): D21D20BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D21 D20 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D21_D20_FAILURE_BASELINE.bundleArtifactDigest)
		throw new TypeError("D21 D20 baseline artifact drifted");
	const bundle = record(strictJsonCodec.decode(bytes), "D21 D20 baseline bundle");
	exactKeys(
		bundle,
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
		"D21 D20 baseline bundle",
	);
	const partial = record(bundle.partialGraphEvidence, "D21 D20 partial Graph evidence");
	const terminal = record(bundle.terminalReceipt, "D21 D20 terminal receipt");
	if (
		bundle.disposition !== "partial-failure" ||
		bundle.bundleDigest !== D21_D20_FAILURE_BASELINE.bundleDigest ||
		partial.partialGraphDigest !== D21_D20_FAILURE_BASELINE.partialGraphDigest ||
		bundle.claimDigest !== D21_D20_FAILURE_BASELINE.claimDigest ||
		terminal.claimDigest !== D21_D20_FAILURE_BASELINE.claimDigest ||
		terminal.terminalReceiptDigest !== D21_D20_FAILURE_BASELINE.terminalReceiptDigest ||
		terminal.providerAttempts !== D21_D20_FAILURE_BASELINE.providerAttempts ||
		terminal.confirmedCostMicrousd !== D21_D20_FAILURE_BASELINE.confirmedCostMicrousd ||
		bundle.graphEvidence !== null ||
		bundle.generation !== null
	)
		throw new TypeError("D21 D20 baseline coordinates drifted");
	return baselineCapability("consumed-d20-artifact");
}

export function createD21InjectedBaselineForTest(): D21D20BaselineAdmissionV1 {
	return baselineCapability("injected-test");
}

function consumeBaseline(value: unknown): BaselineState {
	if (value === null || typeof value !== "object") throw new TypeError("D21 baseline is invalid");
	const state = baselines.get(value);
	if (state === undefined) throw new TypeError("D21 baseline is forged or replayed");
	baselines.delete(value);
	return state;
}

function reportedUsage() {
	return Object.freeze({
		requests: 1 as const,
		inputTokens: 101,
		outputTokens: 37,
		cacheReadTokens: 0,
		actualCostMicrousd: 17,
		actualElapsedMs: 19,
		costBasis: "reported" as const,
	});
}

function providerSuccess(effect: CurrentGraphProviderAdmittedEffectV1) {
	const envelope = effect.runtime.modelEnvelope;
	if (envelope === null) throw new TypeError("D21 provider envelope is unavailable");
	const correction = envelope.correctionStage;
	const toolCalls =
		envelope.phaseBefore === "none" || correction === "reinspect"
			? CURRENT_GRAPH_LIVE_READABLE_FILES.map((path) => ({
					toolRef: "read-file" as const,
					path,
				}))
			: [
					{
						toolRef: "replace-exact" as const,
						path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
						oldText: "before",
						newText: `after-${effect.request.runSequence}-${correction ?? "initial"}`,
					},
					{ toolRef: "workspace-diff" as const },
					{ toolRef: "focused-validation" as const },
				];
	return Object.freeze({
		effectKind: "provider-request" as const,
		status: "completed" as const,
		toolCalls: Object.freeze(toolCalls),
		failureCode: null,
		retryProposal: null,
		usage: reportedUsage(),
		evidenceDigest: empiricalStrictJsonDigest({
			requestDigest: effect.request.requestDigest,
			envelopeDigest: envelope.envelopeDigest,
			toolCalls,
		}),
	});
}

function localResult(
	effect: CurrentGraphProviderAdmittedEffectV1,
	semanticAttempts: Map<number, number>,
	semanticMode: "recover" | "always-fail",
): CurrentGraphProviderEffectResultInputV1 {
	const request = effect.request;
	const evidenceDigest = empiricalStrictJsonDigest({ requestDigest: request.requestDigest });
	if (request.effectKind === "materialization")
		return Object.freeze({
			effectKind: "materialization" as const,
			status: "completed" as const,
			workspaceStateDigest: empiricalStrictJsonDigest({ arm: request.arm, revision: 0 }),
			evidenceDigest,
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		});
	if (request.effectKind === "tool-action") {
		if (request.workspaceStateDigest === null || request.toolRef === null)
			throw new TypeError("D21 local tool request is incomplete");
		const after =
			request.toolRef === "replace-exact"
				? empiricalStrictJsonDigest({
						before: request.workspaceStateDigest,
						requestDigest: request.requestDigest,
					})
				: request.workspaceStateDigest;
		return Object.freeze({
			effectKind: "tool-action" as const,
			toolRef: request.toolRef,
			status: "succeeded" as const,
			causeCode: null,
			workspaceStateBeforeDigest: request.workspaceStateDigest,
			workspaceStateAfterDigest: after,
			nonEmptyDiff: request.toolRef === "workspace-diff",
			evidenceDigest,
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		});
	}
	if (request.effectKind === "public-semantic-validation") {
		if (request.workspaceStateDigest === null)
			throw new TypeError("D21 semantic request is incomplete");
		const attempt = semanticAttempts.get(request.runSequence) ?? 0;
		semanticAttempts.set(request.runSequence, attempt + 1);
		const failed = semanticMode === "always-fail" || attempt === 0;
		return Object.freeze({
			effectKind: "public-semantic-validation" as const,
			status: failed ? ("failed" as const) : ("passed" as const),
			criterionFailures: failed
				? Object.freeze(["local-reconstruction-not-rejected" as const])
				: Object.freeze([]),
			workspaceStateDigest: request.workspaceStateDigest,
			evidenceDigest,
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		});
	}
	if (request.effectKind === "hidden-verifier") {
		if (request.workspaceStateDigest === null)
			throw new TypeError("D21 hidden verifier request is incomplete");
		return Object.freeze({
			effectKind: "hidden-verifier" as const,
			status: "passed" as const,
			workspaceStateDigest: request.workspaceStateDigest,
			evidenceDigest,
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		});
	}
	if (request.effectKind === "cleanup")
		return Object.freeze({
			effectKind: "cleanup" as const,
			status: "completed" as const,
			workspaceStateDigest: request.workspaceStateDigest,
			evidenceDigest,
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		});
	throw new TypeError(`D21 unexpected local effect ${request.effectKind}`);
}

function invalidProviderResult(
	causeCode: D9ProviderRejectionCause,
	effect: CurrentGraphProviderAdmittedEffectV1,
): unknown {
	const valid = providerSuccess(effect);
	const read = { toolRef: "read-file", path: CURRENT_GRAPH_LIVE_READABLE_FILES[0] };
	if (causeCode === "provider-result-schema-invalid") return { ...valid, extra: true };
	if (causeCode === "provider-result-cardinality-invalid") return { ...valid, toolCalls: [] };
	if (causeCode === "provider-tool-count-exceeded")
		return { ...valid, toolCalls: [read, read, read, read, read] };
	if (causeCode === "provider-tool-argument-invalid")
		return { ...valid, toolCalls: [{ toolRef: "read-file", path: "" }] };
	if (causeCode === "provider-usage-reservation-exceeded")
		return {
			...valid,
			usage: { ...reportedUsage(), actualElapsedMs: effect.request.reservation.maxElapsedMs + 1 },
		};
	return {
		effectKind: "provider-request",
		status: "failed",
		toolCalls: [],
		failureCode: "retryable-transient",
		retryProposal: {
			retryClass: "retryable-transient",
			retryAfterMs: 7,
			proposalDigest: empiricalStrictJsonDigest({ invalid: true }),
		},
		usage: reportedUsage(),
		evidenceDigest: empiricalStrictJsonDigest({ invalid: causeCode }),
	};
}

async function runAuthority(
	mode: "recovery" | "rejection" | "second-failure",
	metrics: { active: number; max: number },
) {
	const authority = createD9ProviderRejectionAuthority({
		limits: D21_LIMITS,
		routeProfile: D21_INJECTED_ROUTE,
		taskProfile: D21_TASK_PROFILE,
	});
	const semanticAttempts = new Map<number, number>();
	let rejectedArm = 0;
	for (let guard = 0; guard < D21_LIMITS.maxEffectFacts; guard += 1) {
		const effect = takeD9ProviderEffect(authority);
		if (effect === null)
			return validateD9ProviderRejectionEvidence(snapshotD9ProviderRejectionEvidence(authority));
		metrics.active += 1;
		metrics.max = Math.max(metrics.max, metrics.active);
		try {
			const result =
				effect.request.effectKind === "provider-request"
					? mode === "rejection"
						? invalidProviderResult(D9_PROVIDER_REJECTION_CAUSES[rejectedArm++]!, effect)
						: providerSuccess(effect)
					: localResult(
							effect,
							semanticAttempts,
							mode === "second-failure" ? "always-fail" : "recover",
						);
			admitD9ProviderEffectResult(authority, effect.request.requestDigest, result);
		} finally {
			metrics.active -= 1;
		}
	}
	throw new TypeError("D21 authority exceeded its effect bound");
}

function semanticCorrectionContexts(evidence: D9ProviderRejectionEvidenceV1) {
	return evidence.providerEvidence.workflowEvidence.facts
		.filter((fact) => fact.request.effectKind === "provider-request")
		.map((fact) => fact.request.correctionDirective)
		.filter(
			(context): context is NonNullable<typeof context> => context?.stage === "semantic-correction",
		);
}

function assertRecoveryEvidence(evidence: D9ProviderRejectionEvidenceV1): void {
	const workflow = evidence.providerEvidence.workflowEvidence;
	const contexts = semanticCorrectionContexts(evidence);
	if (
		evidence.rejectionCount !== 0 ||
		workflow.runStatus !== "complete" ||
		workflow.runs.length !== CURRENT_GRAPH_ARMS.length ||
		workflow.runs.some(
			(run, index) =>
				run.arm !== CURRENT_GRAPH_ARMS[index] ||
				run.status !== "completed" ||
				!run.semanticRecoveryUsed ||
				!run.publicSemanticValidationPassed ||
				!run.hiddenVerifierPassed ||
				run.cleanupStatus !== "completed",
		) ||
		contexts.length !== CURRENT_GRAPH_ARMS.length
	)
		throw new TypeError(
			`D21 semantic recovery lifecycle drifted: ${JSON.stringify({
				rejectionCount: evidence.rejectionCount,
				runStatus: workflow.runStatus,
				runs: workflow.runs,
				contextCount: contexts.length,
			})}`,
		);
	for (const context of contexts) {
		if (
			context.requiredFirstToolRef !== "replace-exact" ||
			context.criterionFailures.length !== 1 ||
			context.criterionFailures[0] !== "local-reconstruction-not-rejected"
		)
			throw new TypeError("D21 semantic correction context drifted");
	}
}

function assertRejectionEvidence(evidence: D9ProviderRejectionEvidenceV1): void {
	const coverage = evidence.rejectionFacts.map((fact) => fact.causeCode);
	if (
		empiricalStrictJsonDigest(coverage) !==
			empiricalStrictJsonDigest(D9_PROVIDER_REJECTION_CAUSES) ||
		evidence.providerEvidence.workflowEvidence.runs.length !== CURRENT_GRAPH_ARMS.length ||
		evidence.providerEvidence.workflowEvidence.runs.some(
			(run) => run.status !== "incomplete" || run.cleanupStatus !== "completed",
		) ||
		evidence.rejectionFacts.some(
			(fact) =>
				fact.reconciliation.actualCostMicrousd !== fact.request.reservation.maxCostMicrousd ||
				fact.reconciliation.actualElapsedMs !== fact.request.reservation.maxElapsedMs,
		)
	)
		throw new TypeError("D21 provider rejection coverage drifted");
}

function assertSecondFailureEvidence(evidence: D9ProviderRejectionEvidenceV1): void {
	const workflow = evidence.providerEvidence.workflowEvidence;
	const semanticFindings = workflow.findings.filter(
		(finding) => finding.code === "public-semantic-validation-failed",
	);
	if (
		evidence.rejectionCount !== 0 ||
		workflow.runStatus !== "complete" ||
		workflow.runs.length !== CURRENT_GRAPH_ARMS.length ||
		workflow.runs.some(
			(run) =>
				run.status !== "incomplete" ||
				!run.semanticRecoveryUsed ||
				run.publicSemanticValidationPassed ||
				run.hiddenVerifierAttempted ||
				run.cleanupStatus !== "completed",
		) ||
		semanticFindings.length !== CURRENT_GRAPH_ARMS.length * 2
	)
		throw new TypeError("D21 second semantic failure boundary drifted");
}

export async function runD21InjectedNoNetworkQualification(input: {
	readonly baseline: D21D20BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
}): Promise<D21QualificationBundleV1> {
	const captured = record(input, "D21 qualification input");
	exactKeys(captured, ["baseline", "implementationManifestDigest"], "D21 qualification input");
	if (captured.implementationManifestDigest !== D21_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D21 implementation manifest digest drifted");
	const baseline = consumeBaseline(captured.baseline);
	const metrics = { active: 0, max: 0 };
	const recoveryEvidence = await runAuthority("recovery", metrics);
	const secondFailureEvidence = await runAuthority("second-failure", metrics);
	const rejectionEvidence = await runAuthority("rejection", metrics);
	assertRecoveryEvidence(recoveryEvidence);
	assertSecondFailureEvidence(secondFailureEvidence);
	assertRejectionEvidence(rejectionEvidence);
	if (metrics.active !== 0 || metrics.max !== 1)
		throw new TypeError("D21 executor seriality drifted");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D21_QUALIFICATION_SCHEMA,
		decisionRef: D21_DECISION_REF,
		authorityRevision: D21_AUTHORITY_REVISION,
		implementationManifestDigest: captured.implementationManifestDigest,
		d20Baseline: D21_D20_FAILURE_BASELINE,
		taskProfileDigest: D21_TASK_PROFILE.taskProfileDigest,
		exposureMatrixDigest: empiricalStrictJsonDigest(D21_EXPOSURE_MATRIX),
		positiveDifferentialGateDefinitionDigest: D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
		recoveryEvidenceDigest: recoveryEvidence.evidenceDigest,
		secondFailureEvidenceDigest: secondFailureEvidence.evidenceDigest,
		rejectionEvidenceDigest: rejectionEvidence.evidenceDigest,
		exactSixArmsCompleted: true as const,
		semanticRecoveryCount: 6 as const,
		semanticCorrectionContextCount: 6 as const,
		secondFailureStoppedLocally: true as const,
		providerRejectionCauseCoverage: D9_PROVIDER_REJECTION_CAUSES,
		providerRejectionFactCount: 6 as const,
		conservativeReservationAccountingPassed: true as const,
		maxActiveEffects: 1 as const,
		providerNetworkCalls: 0 as const,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified: true as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D21_GENERATION_SCHEMA,
		generationRef: D21_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		recoveryEvidenceDigest: recoveryEvidence.evidenceDigest,
		secondFailureEvidenceDigest: secondFailureEvidence.evidenceDigest,
		rejectionEvidenceDigest: rejectionEvidence.evidenceDigest,
		implementationManifestDigest: captured.implementationManifestDigest,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D21_BUNDLE_SCHEMA,
		basis: baseline.basis,
		recoveryEvidence,
		secondFailureEvidence,
		rejectionEvidence,
		qualification,
		generation,
	});
	const bundle = Object.freeze({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as D21QualificationBundleV1;
	if (strictJsonCodec.encode(bundle).byteLength > D21_MAX_BUNDLE_BYTES)
		throw new TypeError("D21 qualification bundle exceeded its byte bound");
	constructed.add(bundle);
	return bundle;
}

export function validateD21QualificationBundle(value: unknown): D21QualificationBundleV1 {
	const candidate = record(
		snapshotD9BoundedCanonicalEvidence(value),
		"D21 qualification bundle",
	) as unknown as D21QualificationBundleV1;
	exactKeys(
		candidate as unknown as Record<string, unknown>,
		[
			"basis",
			"bundleDigest",
			"generation",
			"qualification",
			"recoveryEvidence",
			"rejectionEvidence",
			"secondFailureEvidence",
			"schemaVersion",
		],
		"D21 qualification bundle",
	);
	if (
		candidate.schemaVersion !== D21_BUNDLE_SCHEMA ||
		(candidate.basis !== "consumed-d20-artifact" && candidate.basis !== "injected-test")
	)
		throw new TypeError("D21 qualification bundle coordinates drifted");
	const recoveryEvidence = validateD9ProviderRejectionEvidence(candidate.recoveryEvidence);
	const secondFailureEvidence = validateD9ProviderRejectionEvidence(
		candidate.secondFailureEvidence,
	);
	const rejectionEvidence = validateD9ProviderRejectionEvidence(candidate.rejectionEvidence);
	assertRecoveryEvidence(recoveryEvidence);
	assertSecondFailureEvidence(secondFailureEvidence);
	assertRejectionEvidence(rejectionEvidence);
	const q = record(
		candidate.qualification,
		"D21 qualification",
	) as unknown as D21QualificationBundleV1["qualification"];
	exactKeys(
		q as unknown as Record<string, unknown>,
		[
			"authorityRevision",
			"causalAttribution",
			"conservativeReservationAccountingPassed",
			"d20Baseline",
			"decisionRef",
			"efficacyClaim",
			"exactSixArmsCompleted",
			"exposureMatrixDigest",
			"implementationManifestDigest",
			"liveGateEvaluated",
			"maxActiveEffects",
			"positiveDifferentialGateDefinitionDigest",
			"providerNetworkCalls",
			"providerRejectionCauseCoverage",
			"providerRejectionFactCount",
			"qualificationDigest",
			"qualified",
			"recoveryEvidenceDigest",
			"rejectionEvidenceDigest",
			"schemaVersion",
			"secondFailureEvidenceDigest",
			"secondFailureStoppedLocally",
			"semanticCorrectionContextCount",
			"semanticRecoveryCount",
			"taskProfileDigest",
		],
		"D21 qualification",
	);
	if (
		q.schemaVersion !== D21_QUALIFICATION_SCHEMA ||
		q.decisionRef !== D21_DECISION_REF ||
		q.authorityRevision !== D21_AUTHORITY_REVISION ||
		q.implementationManifestDigest !== D21_IMPLEMENTATION_MANIFEST_DIGEST ||
		empiricalStrictJsonDigest(q.d20Baseline) !==
			empiricalStrictJsonDigest(D21_D20_FAILURE_BASELINE) ||
		q.taskProfileDigest !== D21_TASK_PROFILE.taskProfileDigest ||
		q.exposureMatrixDigest !== empiricalStrictJsonDigest(D21_EXPOSURE_MATRIX) ||
		q.positiveDifferentialGateDefinitionDigest !==
			D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST ||
		q.recoveryEvidenceDigest !== recoveryEvidence.evidenceDigest ||
		q.secondFailureEvidenceDigest !== secondFailureEvidence.evidenceDigest ||
		q.rejectionEvidenceDigest !== rejectionEvidence.evidenceDigest ||
		q.exactSixArmsCompleted !== true ||
		q.semanticRecoveryCount !== 6 ||
		q.semanticCorrectionContextCount !== 6 ||
		q.secondFailureStoppedLocally !== true ||
		empiricalStrictJsonDigest(q.providerRejectionCauseCoverage) !==
			empiricalStrictJsonDigest(D9_PROVIDER_REJECTION_CAUSES) ||
		q.providerRejectionFactCount !== 6 ||
		q.conservativeReservationAccountingPassed !== true ||
		q.maxActiveEffects !== 1 ||
		q.providerNetworkCalls !== 0 ||
		q.liveGateEvaluated !== false ||
		q.causalAttribution !== "undetermined" ||
		q.efficacyClaim !== "none" ||
		q.qualified !== true
	)
		throw new TypeError("D21 qualification claims drifted");
	const { qualificationDigest: _qualificationDigest, ...qualificationFields } = q;
	const qualificationMaterial = strictSnapshot(qualificationFields);
	if (q.qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial))
		throw new TypeError("D21 qualification digest drifted");
	const g = record(
		candidate.generation,
		"D21 generation",
	) as unknown as D21QualificationBundleV1["generation"];
	exactKeys(
		g as unknown as Record<string, unknown>,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"liveGateEvaluated",
			"qualificationDigest",
			"recoveryEvidenceDigest",
			"rejectionEvidenceDigest",
			"schemaVersion",
			"secondFailureEvidenceDigest",
		],
		"D21 generation",
	);
	if (
		g.schemaVersion !== D21_GENERATION_SCHEMA ||
		g.generationRef !== D21_GENERATION_REF ||
		g.qualificationDigest !== q.qualificationDigest ||
		g.recoveryEvidenceDigest !== recoveryEvidence.evidenceDigest ||
		g.secondFailureEvidenceDigest !== secondFailureEvidence.evidenceDigest ||
		g.rejectionEvidenceDigest !== rejectionEvidence.evidenceDigest ||
		g.implementationManifestDigest !== q.implementationManifestDigest ||
		g.liveGateEvaluated !== false ||
		g.causalAttribution !== "undetermined" ||
		g.efficacyClaim !== "none"
	)
		throw new TypeError("D21 generation coordinates drifted");
	const { generationDigest: _generationDigest, ...generationFields } = g;
	const generationMaterial = strictSnapshot(generationFields);
	if (g.generationDigest !== empiricalStrictJsonDigest(generationMaterial))
		throw new TypeError("D21 generation digest drifted");
	const material = strictSnapshot({
		schemaVersion: D21_BUNDLE_SCHEMA,
		basis: candidate.basis,
		recoveryEvidence,
		secondFailureEvidence,
		rejectionEvidence,
		qualification: q,
		generation: g,
	});
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D21 bundle digest drifted");
	return Object.freeze({
		...material,
		bundleDigest: candidate.bundleDigest,
	}) as D21QualificationBundleV1;
}

export async function persistD21QualificationBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D21QualificationBundleV1;
}): Promise<
	ReturnType<typeof persistCurrentGraphPrivateGeneration> extends Promise<infer T> ? T : never
> {
	const captured = record(input, "D21 persistence input");
	exactKeys(captured, ["bundle", "privateRoot"], "D21 persistence input");
	if (typeof captured.privateRoot !== "string" || captured.privateRoot.length === 0)
		throw new TypeError("D21 private root is invalid");
	if (captured.bundle === null || typeof captured.bundle !== "object")
		throw new TypeError("D21 bundle is invalid");
	if (!constructed.has(captured.bundle))
		throw new TypeError("D21 bundle is not same-process constructed");
	constructed.delete(captured.bundle);
	const bundle = validateD21QualificationBundle(captured.bundle);
	if (bundle.basis !== "consumed-d20-artifact")
		throw new TypeError("D21 production persistence requires the consumed D20 artifact");
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const qualificationBytes = strictJsonCodec.encode(
		bundle.qualification as unknown as StrictJsonValue,
	);
	const generationBytes = strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue);
	const commitBytes = strictJsonCodec.encode(
		strictSnapshot({
			generationRef: D21_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			qualificationDigest: bundle.qualification.qualificationDigest,
			generationDigest: bundle.generation.generationDigest,
		}) as StrictJsonValue,
	);
	return persistCurrentGraphPrivateGeneration({
		privateRoot: captured.privateRoot,
		generationRef: D21_GENERATION_REF,
		artifacts: Object.freeze({
			"bundle.v1.json": bundleBytes,
			"qualification.v1.json": qualificationBytes,
			"generation.v1.json": generationBytes,
		}),
		commitBytes,
	});
}

export async function persistD21InjectedQualificationForTest(input: {
	readonly privateRoot: string;
	readonly bundle: D21QualificationBundleV1;
}) {
	const captured = record(input, "D21 test persistence input");
	exactKeys(captured, ["bundle", "privateRoot"], "D21 test persistence input");
	if (typeof captured.privateRoot !== "string" || captured.privateRoot.length === 0)
		throw new TypeError("D21 test private root is invalid");
	if (captured.bundle === null || typeof captured.bundle !== "object")
		throw new TypeError("D21 test bundle is invalid");
	if (!constructed.has(captured.bundle)) throw new TypeError("D21 test bundle is not constructed");
	constructed.delete(captured.bundle);
	const bundle = validateD21QualificationBundle(captured.bundle);
	if (bundle.basis !== "injected-test")
		throw new TypeError("D21 test persistence requires injected basis");
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const commitBytes = strictJsonCodec.encode(
		strictSnapshot({
			generationRef: D21_INJECTED_TEST_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			basis: bundle.basis,
		}) as StrictJsonValue,
	);
	return persistCurrentGraphPrivateGeneration({
		privateRoot: captured.privateRoot,
		generationRef: D21_INJECTED_TEST_GENERATION_REF,
		artifacts: Object.freeze({ "bundle.v1.json": bundleBytes }),
		commitBytes,
	});
}

export function correctionDirectiveFromFact(
	evidence: D9ProviderRejectionEvidenceV1,
	runSequence: number,
): CurrentGraphCorrectionDirectiveV1 {
	const context = semanticCorrectionContexts(evidence).find((entry) =>
		evidence.providerEvidence.workflowEvidence.facts.some(
			(fact) =>
				fact.request.runSequence === runSequence &&
				fact.request.correctionDirective?.contextDigest === entry.contextDigest,
		),
	);
	if (context === undefined) throw new TypeError("D21 semantic correction context is missing");
	const fact = evidence.providerEvidence.workflowEvidence.facts.find(
		(entry) =>
			entry.request.runSequence === runSequence &&
			entry.request.correctionDirective?.contextDigest === context.contextDigest,
	);
	if (fact?.request.correctionDirective === null || fact?.request.correctionDirective === undefined)
		throw new TypeError("D21 semantic correction fact is missing");
	return fact.request.correctionDirective;
}
