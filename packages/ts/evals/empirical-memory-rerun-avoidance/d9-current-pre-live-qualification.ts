import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import type {
	CurrentGraphProviderAdmittedEffectV1,
	CurrentGraphProviderEffectResultInputV1,
} from "./d6-current-provider-authority.js";
import { validateCurrentGraphLiveBundle } from "./d8-current-live.js";
import {
	CURRENT_GRAPH_LIVE_LIMITS,
	CURRENT_GRAPH_LIVE_READABLE_FILES,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_TASK,
} from "./d8-current-live-coordinates.js";
import { D9_IMPLEMENTATION_MANIFEST_DIGEST } from "./d9-current-implementation-manifest.js";
import {
	admitD9ProviderEffectResult,
	createD9ProviderRejectionAuthority,
	D9_D8_FAILURE_BASELINE,
	D9_PROVIDER_REJECTION_CAUSES,
	type D9ProviderRejectionAuthorityV1,
	type D9ProviderRejectionCause,
	type D9ProviderRejectionEvidenceV1,
	snapshotD9BoundedCanonicalEvidence,
	snapshotD9ProviderRejectionEvidence,
	takeD9ProviderEffect,
	validateD9ProviderRejectionEvidence,
} from "./d9-current-provider-rejection-authority.js";

export const D9_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d9.provider-result-rejection-qualification.v1" as const;
export const D9_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d9.provider-result-rejection-bundle.v1" as const;
export const D9_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d9.provider-result-rejection-generation.v1" as const;
export const D9_QUALIFICATION_GENERATION_REF =
	"current-graph-native-provider-rejection-no-network-2026-08-15-d9-v1" as const;
export const D9_INJECTED_TEST_GENERATION_REF =
	"current-graph-native-provider-rejection-injected-test-d9-v1" as const;

export interface D9BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d9.d8-failure-baseline-admission.v1";
}

export interface D9QualificationBundleV1 {
	readonly schemaVersion: typeof D9_QUALIFICATION_BUNDLE_SCHEMA;
	readonly basis: "consumed-d8-artifact" | "injected-test";
	readonly qualification: Readonly<{
		schemaVersion: typeof D9_QUALIFICATION_SCHEMA;
		decisionRef: "graphrefly-ts:D9";
		implementationManifestDigest: string;
		d8FailureBaseline: typeof D9_D8_FAILURE_BASELINE;
		rejectionEvidenceDigest: string;
		transparentEvidenceDigest: string;
		rejectionCauseCoverage: readonly D9ProviderRejectionCause[];
		rejectionFacts: 6;
		completedArmAdmissions: 6;
		conservativeReservationAccountingPassed: true;
		transparentSixArmPassed: true;
		providerNetworkCalls: 0;
		maxActiveExecutor: 1;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualificationDigest: string;
	}>;
	readonly rejectionEvidence: D9ProviderRejectionEvidenceV1;
	readonly transparentEvidence: D9ProviderRejectionEvidenceV1;
	readonly generation: Readonly<{
		schemaVersion: typeof D9_QUALIFICATION_GENERATION_SCHEMA;
		generationRef: typeof D9_QUALIFICATION_GENERATION_REF;
		qualificationDigest: string;
		rejectionEvidenceDigest: string;
		transparentEvidenceDigest: string;
		implementationManifestDigest: string;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

interface BaselineState {
	readonly basis: D9QualificationBundleV1["basis"];
}

const baselines = new WeakMap<object, BaselineState>();
const constructed = new WeakSet<object>();

function captureOwnDataInput(
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
	const keys = Object.keys(descriptors).sort();
	const wanted = [...expectedKeys].sort();
	if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index]))
		throw new TypeError(`${path} keys drifted`);
	const captured: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		const descriptor = descriptors[key];
		if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true)
			throw new TypeError(`${path}.${key} must be an enumerable own data property`);
		captured[key] = descriptor.value;
	}
	return Object.freeze(captured);
}

function baselineCapability(basis: BaselineState["basis"]): D9BaselineAdmissionV1 {
	const capability = Object.freeze({
		revision: "graphrefly-ts.d9.d8-failure-baseline-admission.v1" as const,
	});
	baselines.set(capability, Object.freeze({ basis }));
	return capability;
}

export function admitD9D8FailureBaseline(bytesValue: Uint8Array): D9BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array)) throw new TypeError("D9 D8 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D9_D8_FAILURE_BASELINE.bundleArtifactDigest)
		throw new TypeError("D9 D8 partial bundle artifact drifted");
	const bundle = validateCurrentGraphLiveBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.disposition !== "partial-failure" ||
		bundle.bundleDigest !== D9_D8_FAILURE_BASELINE.bundleDigest ||
		bundle.partialGraphEvidence?.partialGraphDigest !== D9_D8_FAILURE_BASELINE.partialGraphDigest ||
		bundle.terminalReceipt.terminalReceiptDigest !== D9_D8_FAILURE_BASELINE.terminalReceiptDigest ||
		bundle.graphEvidence !== null ||
		bundle.generation !== null
	)
		throw new TypeError("D9 D8 partial bundle coordinates drifted");
	return baselineCapability("consumed-d8-artifact");
}

export function createD9InjectedBaselineForTest(): D9BaselineAdmissionV1 {
	return baselineCapability("injected-test");
}

function consumeBaseline(value: unknown): BaselineState {
	if (value === null || typeof value !== "object") throw new TypeError("D9 baseline is invalid");
	const state = baselines.get(value);
	if (state === undefined) throw new TypeError("D9 baseline is forged or replayed");
	baselines.delete(value);
	return state;
}

function reportedUsage() {
	return Object.freeze({
		requests: 1 as const,
		inputTokens: 13,
		outputTokens: 7,
		cacheReadTokens: 0,
		actualCostMicrousd: 17,
		actualElapsedMs: 19,
		costBasis: "reported" as const,
	});
}

function completedProvider(
	effect: CurrentGraphProviderAdmittedEffectV1,
): CurrentGraphProviderEffectResultInputV1 {
	const phase = effect.runtime.modelEnvelope?.phaseBefore;
	const toolCalls =
		phase === "none"
			? CURRENT_GRAPH_LIVE_READABLE_FILES.map((path) => ({ toolRef: "read-file" as const, path }))
			: [
					{
						toolRef: "replace-exact" as const,
						path: CURRENT_GRAPH_LIVE_TASK.allowedWorkspacePath,
						oldText: "before",
						newText: "after",
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
			toolCalls,
		}),
	});
}

function localSuccess(
	effect: CurrentGraphProviderAdmittedEffectV1,
): CurrentGraphProviderEffectResultInputV1 {
	const request = effect.request;
	const evidenceDigest = empiricalStrictJsonDigest({ requestDigest: request.requestDigest });
	if (request.effectKind === "materialization")
		return {
			effectKind: "materialization",
			status: "completed",
			workspaceStateDigest: empiricalStrictJsonDigest({ arm: request.arm, revision: 0 }),
			evidenceDigest,
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		};
	if (request.effectKind === "tool-action") {
		const before = request.workspaceStateDigest!;
		const after =
			request.toolRef === "replace-exact"
				? empiricalStrictJsonDigest({ arm: request.arm, revision: 1 })
				: before;
		return {
			effectKind: "tool-action",
			toolRef: request.toolRef!,
			status: "succeeded",
			causeCode: null,
			workspaceStateBeforeDigest: before,
			workspaceStateAfterDigest: after,
			nonEmptyDiff: request.toolRef === "replace-exact" || request.toolRef === "workspace-diff",
			evidenceDigest,
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		};
	}
	if (request.effectKind === "public-semantic-validation")
		return {
			effectKind: "public-semantic-validation",
			status: "passed",
			criterionFailures: [],
			workspaceStateDigest: request.workspaceStateDigest!,
			evidenceDigest,
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		};
	if (request.effectKind === "hidden-verifier")
		return {
			effectKind: "hidden-verifier",
			status: "passed",
			workspaceStateDigest: request.workspaceStateDigest!,
			evidenceDigest,
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		};
	if (request.effectKind === "cleanup")
		return {
			effectKind: "cleanup",
			status: "completed",
			workspaceStateDigest: request.workspaceStateDigest,
			evidenceDigest,
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
		};
	throw new TypeError(`D9 qualification did not expect ${request.effectKind}`);
}

function invalidProviderResult(
	cause: D9ProviderRejectionCause,
	effect: CurrentGraphProviderAdmittedEffectV1,
): unknown {
	const read = { toolRef: "read-file", path: CURRENT_GRAPH_LIVE_READABLE_FILES[0] };
	const completed = {
		...completedProvider(effect),
		toolCalls: [read],
	};
	if (cause === "provider-result-schema-invalid") return { ...completed, unexpected: true };
	if (cause === "provider-result-cardinality-invalid") return { ...completed, toolCalls: [] };
	if (cause === "provider-tool-count-exceeded")
		return { ...completed, toolCalls: [read, read, read, read, read] };
	if (cause === "provider-tool-argument-invalid")
		return { ...completed, toolCalls: [{ toolRef: "read-file", path: "" }] };
	if (cause === "provider-usage-reservation-exceeded")
		return {
			...completed,
			usage: {
				...reportedUsage(),
				actualElapsedMs: effect.request.reservation.maxElapsedMs + 1,
			},
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
		evidenceDigest: empiricalStrictJsonDigest({ fixture: "D9-invalid-retry" }),
	};
}

async function runAuthority(input: {
	readonly reject: boolean;
	readonly metrics: { active: number; maxActive: number; calls: number };
}): Promise<D9ProviderRejectionEvidenceV1> {
	const authority: D9ProviderRejectionAuthorityV1 = createD9ProviderRejectionAuthority({
		limits: CURRENT_GRAPH_LIVE_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: CURRENT_GRAPH_LIVE_TASK,
	});
	let rejectedArm = 0;
	for (let guard = 0; guard < CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts; guard += 1) {
		const effect = takeD9ProviderEffect(authority);
		if (effect === null) return snapshotD9ProviderRejectionEvidence(authority);
		input.metrics.active += 1;
		input.metrics.maxActive = Math.max(input.metrics.maxActive, input.metrics.active);
		input.metrics.calls += 1;
		try {
			const result =
				effect.request.effectKind === "provider-request"
					? input.reject
						? invalidProviderResult(D9_PROVIDER_REJECTION_CAUSES[rejectedArm++]!, effect)
						: completedProvider(effect)
					: localSuccess(effect);
			admitD9ProviderEffectResult(authority, effect.request.requestDigest, result);
		} finally {
			input.metrics.active -= 1;
		}
	}
	throw new TypeError("D9 qualification exceeded its effect bound");
}

export async function runD9InjectedNoNetworkQualification(input: {
	readonly baseline: D9BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
}): Promise<D9QualificationBundleV1> {
	const captured = captureOwnDataInput(
		input,
		["baseline", "implementationManifestDigest"],
		"D9 qualification input",
	);
	const baseline = consumeBaseline(captured.baseline);
	if (captured.implementationManifestDigest !== D9_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D9 implementation manifest digest is invalid");
	const metrics = { active: 0, maxActive: 0, calls: 0 };
	const rejectionEvidence = validateD9ProviderRejectionEvidence(
		await runAuthority({ reject: true, metrics }),
	);
	const transparentEvidence = validateD9ProviderRejectionEvidence(
		await runAuthority({ reject: false, metrics }),
	);
	const rejectionCauseCoverage = rejectionEvidence.rejectionFacts.map((fact) => fact.causeCode);
	if (
		empiricalStrictJsonDigest(rejectionCauseCoverage) !==
			empiricalStrictJsonDigest(D9_PROVIDER_REJECTION_CAUSES) ||
		rejectionEvidence.providerEvidence.workflowEvidence.runs.length !== 6 ||
		!rejectionEvidence.providerEvidence.workflowEvidence.runs.every(
			(run) => run.status === "incomplete" && run.cleanupStatus === "completed",
		) ||
		transparentEvidence.rejectionCount !== 0 ||
		transparentEvidence.providerEvidence.workflowEvidence.runs.length !== 6 ||
		!transparentEvidence.providerEvidence.workflowEvidence.runs.every(
			(run) => run.status === "completed" && run.cleanupStatus === "completed",
		) ||
		metrics.active !== 0 ||
		metrics.maxActive !== 1
	)
		throw new TypeError("D9 qualification coverage drifted");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D9_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D9" as const,
		implementationManifestDigest: captured.implementationManifestDigest,
		d8FailureBaseline: D9_D8_FAILURE_BASELINE,
		rejectionEvidenceDigest: rejectionEvidence.evidenceDigest,
		transparentEvidenceDigest: transparentEvidence.evidenceDigest,
		rejectionCauseCoverage,
		rejectionFacts: 6 as const,
		completedArmAdmissions: 6 as const,
		conservativeReservationAccountingPassed: true as const,
		transparentSixArmPassed: true as const,
		providerNetworkCalls: 0 as const,
		maxActiveExecutor: 1 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D9_QUALIFICATION_GENERATION_SCHEMA,
		generationRef: D9_QUALIFICATION_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		rejectionEvidenceDigest: rejectionEvidence.evidenceDigest,
		transparentEvidenceDigest: transparentEvidence.evidenceDigest,
		implementationManifestDigest: captured.implementationManifestDigest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const bundleMaterial = strictSnapshot({
		schemaVersion: D9_QUALIFICATION_BUNDLE_SCHEMA,
		basis: baseline.basis,
		qualification,
		rejectionEvidence,
		transparentEvidence,
		generation,
	});
	const bundle = Object.freeze({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	}) as D9QualificationBundleV1;
	constructed.add(bundle);
	return bundle;
}

export function validateD9QualificationBundle(value: unknown): D9QualificationBundleV1 {
	const candidateRecord = record(
		snapshotD9BoundedCanonicalEvidence(value),
		"D9 qualification bundle",
	);
	exactKeys(
		candidateRecord,
		[
			"basis",
			"bundleDigest",
			"generation",
			"qualification",
			"rejectionEvidence",
			"schemaVersion",
			"transparentEvidence",
		],
		"D9 qualification bundle",
	);
	const candidate = candidateRecord as unknown as D9QualificationBundleV1;
	const qualificationRecord = record(candidate.qualification, "D9 qualification");
	exactKeys(
		qualificationRecord,
		[
			"causalAttribution",
			"completedArmAdmissions",
			"conservativeReservationAccountingPassed",
			"d8FailureBaseline",
			"decisionRef",
			"efficacyClaim",
			"implementationManifestDigest",
			"maxActiveExecutor",
			"providerNetworkCalls",
			"qualificationDigest",
			"rejectionCauseCoverage",
			"rejectionEvidenceDigest",
			"rejectionFacts",
			"schemaVersion",
			"transparentEvidenceDigest",
			"transparentSixArmPassed",
		],
		"D9 qualification",
	);
	const generationRecord = record(candidate.generation, "D9 qualification generation");
	exactKeys(
		generationRecord,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"qualificationDigest",
			"rejectionEvidenceDigest",
			"schemaVersion",
			"transparentEvidenceDigest",
		],
		"D9 qualification generation",
	);
	if (
		candidate.schemaVersion !== D9_QUALIFICATION_BUNDLE_SCHEMA ||
		(candidate.basis !== "consumed-d8-artifact" && candidate.basis !== "injected-test") ||
		candidate.qualification.schemaVersion !== D9_QUALIFICATION_SCHEMA ||
		candidate.qualification.decisionRef !== "graphrefly-ts:D9" ||
		candidate.qualification.implementationManifestDigest !== D9_IMPLEMENTATION_MANIFEST_DIGEST ||
		candidate.qualification.causalAttribution !== "undetermined" ||
		candidate.qualification.efficacyClaim !== "none" ||
		candidate.qualification.rejectionFacts !== 6 ||
		candidate.qualification.completedArmAdmissions !== 6 ||
		candidate.qualification.conservativeReservationAccountingPassed !== true ||
		candidate.qualification.transparentSixArmPassed !== true ||
		candidate.qualification.providerNetworkCalls !== 0 ||
		candidate.qualification.maxActiveExecutor !== 1 ||
		candidate.generation.schemaVersion !== D9_QUALIFICATION_GENERATION_SCHEMA ||
		candidate.generation.generationRef !== D9_QUALIFICATION_GENERATION_REF
	)
		throw new TypeError("D9 qualification bundle coordinates drifted");
	const rejectionEvidence = validateD9ProviderRejectionEvidence(candidate.rejectionEvidence);
	const transparentEvidence = validateD9ProviderRejectionEvidence(candidate.transparentEvidence);
	const coverage = rejectionEvidence.rejectionFacts.map((fact) => fact.causeCode);
	const rejectedRuns = rejectionEvidence.providerEvidence.workflowEvidence.runs;
	const transparentRuns = transparentEvidence.providerEvidence.workflowEvidence.runs;
	if (
		empiricalStrictJsonDigest(coverage) !==
			empiricalStrictJsonDigest(D9_PROVIDER_REJECTION_CAUSES) ||
		empiricalStrictJsonDigest(coverage) !==
			empiricalStrictJsonDigest(candidate.qualification.rejectionCauseCoverage) ||
		candidate.qualification.rejectionEvidenceDigest !== rejectionEvidence.evidenceDigest ||
		candidate.qualification.transparentEvidenceDigest !== transparentEvidence.evidenceDigest ||
		transparentEvidence.rejectionCount !== 0 ||
		rejectedRuns.length !== 6 ||
		!rejectedRuns.every(
			(run) => run.status === "incomplete" && run.cleanupStatus === "completed",
		) ||
		transparentRuns.length !== 6 ||
		!transparentRuns.every(
			(run) =>
				run.status === "completed" &&
				run.publicSemanticValidationPassed &&
				run.hiddenVerifierPassed &&
				run.cleanupStatus === "completed",
		) ||
		rejectionEvidence.providerEvidence.budget.providerAttempts !== 6 ||
		rejectionEvidence.providerEvidence.budget.retryWaits !== 0 ||
		rejectionEvidence.providerEvidence.budget.confirmedCostMicrousd !==
			6 * CURRENT_GRAPH_LIVE_LIMITS.providerMaxCostMicrousd ||
		rejectionEvidence.providerEvidence.budget.confirmedElapsedMs !==
			6 * CURRENT_GRAPH_LIVE_LIMITS.providerMaxElapsedMs + 12
	)
		throw new TypeError("D9 qualification evidence coverage drifted");
	if (
		empiricalStrictJsonDigest(candidate.qualification.d8FailureBaseline) !==
		empiricalStrictJsonDigest(D9_D8_FAILURE_BASELINE)
	)
		throw new TypeError("D9 qualification D8 baseline drifted");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D9_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D9" as const,
		implementationManifestDigest: D9_IMPLEMENTATION_MANIFEST_DIGEST,
		d8FailureBaseline: D9_D8_FAILURE_BASELINE,
		rejectionEvidenceDigest: rejectionEvidence.evidenceDigest,
		transparentEvidenceDigest: transparentEvidence.evidenceDigest,
		rejectionCauseCoverage: D9_PROVIDER_REJECTION_CAUSES,
		rejectionFacts: 6 as const,
		completedArmAdmissions: 6 as const,
		conservativeReservationAccountingPassed: true as const,
		transparentSixArmPassed: true as const,
		providerNetworkCalls: 0 as const,
		maxActiveExecutor: 1 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualificationDigest = candidate.qualification.qualificationDigest;
	if (qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial))
		throw new TypeError("D9 qualification digest drifted");
	const rebuiltQualification = Object.freeze({ ...qualificationMaterial, qualificationDigest });
	const generationMaterial = strictSnapshot({
		schemaVersion: D9_QUALIFICATION_GENERATION_SCHEMA,
		generationRef: D9_QUALIFICATION_GENERATION_REF,
		qualificationDigest,
		rejectionEvidenceDigest: rejectionEvidence.evidenceDigest,
		transparentEvidenceDigest: transparentEvidence.evidenceDigest,
		implementationManifestDigest: D9_IMPLEMENTATION_MANIFEST_DIGEST,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generationDigest = candidate.generation.generationDigest;
	if (
		generationDigest !== empiricalStrictJsonDigest(generationMaterial) ||
		candidate.generation.qualificationDigest !== qualificationDigest ||
		candidate.generation.rejectionEvidenceDigest !== rejectionEvidence.evidenceDigest ||
		candidate.generation.transparentEvidenceDigest !== transparentEvidence.evidenceDigest ||
		candidate.generation.implementationManifestDigest !==
			candidate.qualification.implementationManifestDigest
	)
		throw new TypeError("D9 qualification generation binding drifted");
	const rebuiltGeneration = Object.freeze({ ...generationMaterial, generationDigest });
	const bundleMaterial = strictSnapshot({
		schemaVersion: D9_QUALIFICATION_BUNDLE_SCHEMA,
		basis: candidate.basis,
		qualification: rebuiltQualification,
		rejectionEvidence,
		transparentEvidence,
		generation: rebuiltGeneration,
	});
	const bundleDigest = candidate.bundleDigest;
	if (bundleDigest !== empiricalStrictJsonDigest(bundleMaterial))
		throw new TypeError("D9 qualification bundle digest drifted");
	return Object.freeze({ ...bundleMaterial, bundleDigest }) as D9QualificationBundleV1;
}

async function persistBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D9QualificationBundleV1;
	readonly generationRef: string;
}) {
	if (!constructed.has(input.bundle))
		throw new TypeError("D9 qualification persistence requires a same-process bundle");
	constructed.delete(input.bundle);
	const bundle = validateD9QualificationBundle(input.bundle);
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const generationBytes = strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue);
	const qualificationBytes = strictJsonCodec.encode(
		bundle.qualification as unknown as StrictJsonValue,
	);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d9.provider-result-rejection-commit.v1",
		generationRef: input.generationRef,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
		generationDigest: bundle.generation.generationDigest,
		qualificationDigest: bundle.qualification.qualificationDigest,
	});
	const commit = Object.freeze({
		...commitMaterial,
		commitDigest: empiricalStrictJsonDigest(commitMaterial),
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: input.generationRef,
		artifacts: {
			"bundle.v1.json": bundleBytes,
			"generation.v1.json": generationBytes,
			"qualification.v1.json": qualificationBytes,
		},
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
}

export async function persistD9QualificationBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D9QualificationBundleV1;
}) {
	const captured = captureOwnDataInput(
		input,
		["bundle", "privateRoot"],
		"D9 production persistence input",
	);
	const bundle = captured.bundle as D9QualificationBundleV1;
	if (bundle.basis !== "consumed-d8-artifact")
		throw new TypeError("D9 production qualification persistence requires consumed D8 evidence");
	return persistBundle({
		privateRoot: captured.privateRoot as string,
		bundle,
		generationRef: D9_QUALIFICATION_GENERATION_REF,
	});
}

export async function persistD9InjectedQualificationForTest(input: {
	readonly privateRoot: string;
	readonly bundle: D9QualificationBundleV1;
}) {
	const captured = captureOwnDataInput(
		input,
		["bundle", "privateRoot"],
		"D9 injected persistence input",
	);
	const bundle = captured.bundle as D9QualificationBundleV1;
	if (bundle.basis !== "injected-test")
		throw new TypeError("D9 injected qualification persistence basis drifted");
	return persistBundle({
		privateRoot: captured.privateRoot as string,
		bundle,
		generationRef: D9_INJECTED_TEST_GENERATION_REF,
	});
}
