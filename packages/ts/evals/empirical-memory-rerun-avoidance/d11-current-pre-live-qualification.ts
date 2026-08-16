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
import {
	CURRENT_GRAPH_LIVE_LIMITS,
	CURRENT_GRAPH_LIVE_READABLE_FILES,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_TASK,
} from "./d8-current-live-coordinates.js";
import { validateD10CurrentGraphLiveBundle } from "./d10-current-live.js";
import { D11_IMPLEMENTATION_MANIFEST_DIGEST } from "./d11-current-implementation-manifest.js";
import {
	admitD11ProviderEffectEnvelope,
	createD11TransportFailureAuthority,
	D11_D10_FAILURE_BASELINE,
	D11_TRANSPORT_CAUSES,
	D11_TRANSPORT_ENVELOPE_SCHEMA,
	type D11TransportCause,
	type D11TransportFailureAuthorityV1,
	type D11TransportFailureEvidenceV1,
	type D11TransportPhase,
	type D11TransportResultEnvelopeV1,
	executeD11TransportBoundary,
	snapshotD11TransportFailureEvidence,
	takeD11ProviderEffect,
	validateD11TransportFailureEvidence,
} from "./d11-current-transport-failure-authority.js";

export const D11_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d11.transport-failure-qualification.v1" as const;
export const D11_BUNDLE_SCHEMA = "graphrefly-ts.d11.transport-failure-bundle.v1" as const;
export const D11_GENERATION_SCHEMA = "graphrefly-ts.d11.transport-failure-generation.v1" as const;
export const D11_GENERATION_REF =
	"current-graph-native-transport-failure-no-network-2026-08-15-d11-v1" as const;
export const D11_INJECTED_TEST_GENERATION_REF =
	"current-graph-native-transport-failure-injected-test-d11-v1" as const;

export interface D11BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d11.d10-failure-baseline-admission.v1";
}

export interface D11QualificationBundleV1 {
	readonly schemaVersion: typeof D11_BUNDLE_SCHEMA;
	readonly basis: "consumed-d10-artifact" | "injected-test";
	readonly qualification: Readonly<{
		schemaVersion: typeof D11_QUALIFICATION_SCHEMA;
		decisionRef: "graphrefly-ts:D11";
		implementationManifestDigest: string;
		d10FailureBaseline: typeof D11_D10_FAILURE_BASELINE;
		transportEvidenceDigest: string;
		transparentEvidenceDigest: string;
		retryEvidenceDigest: string;
		phaseCauseCoverage: readonly string[];
		transportFailureFacts: 6;
		completedArmAdmissions: 6;
		conservativeReservationAccountingPassed: true;
		armLocalContinuationPassed: true;
		transparentSixArmPassed: true;
		retryInvariantPassed: true;
		retryWaits: 6;
		callerCancellationRejected: true;
		unknownFailureRejected: true;
		negativeBoundaryReceiptDigest: string;
		providerNetworkCalls: 0;
		maxActiveExecutor: 1;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualificationDigest: string;
	}>;
	readonly transportEvidence: D11TransportFailureEvidenceV1;
	readonly transparentEvidence: D11TransportFailureEvidenceV1;
	readonly retryEvidence: D11TransportFailureEvidenceV1;
	readonly generation: Readonly<{
		schemaVersion: typeof D11_GENERATION_SCHEMA;
		generationRef: typeof D11_GENERATION_REF;
		qualificationDigest: string;
		transportEvidenceDigest: string;
		transparentEvidenceDigest: string;
		retryEvidenceDigest: string;
		implementationManifestDigest: string;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

interface BaselineState {
	readonly basis: D11QualificationBundleV1["basis"];
}

type RunMode = "transport" | "transparent" | "retry";

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

function baselineCapability(basis: BaselineState["basis"]): D11BaselineAdmissionV1 {
	const capability = Object.freeze({
		revision: "graphrefly-ts.d11.d10-failure-baseline-admission.v1" as const,
	});
	baselines.set(capability, Object.freeze({ basis }));
	return capability;
}

export function admitD11D10FailureBaseline(bytesValue: Uint8Array): D11BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D11 D10 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D11_D10_FAILURE_BASELINE.bundleArtifactDigest)
		throw new TypeError("D11 D10 partial bundle artifact drifted");
	const bundle = validateD10CurrentGraphLiveBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.disposition !== "partial-failure" ||
		bundle.bundleDigest !== D11_D10_FAILURE_BASELINE.bundleDigest ||
		bundle.partialGraphEvidence?.partialGraphDigest !==
			D11_D10_FAILURE_BASELINE.partialGraphDigest ||
		bundle.terminalReceipt.terminalReceiptDigest !==
			D11_D10_FAILURE_BASELINE.terminalReceiptDigest ||
		bundle.claimDigest !== D11_D10_FAILURE_BASELINE.claimDigest ||
		bundle.graphEvidence !== null ||
		bundle.generation !== null
	)
		throw new TypeError("D11 D10 partial bundle coordinates drifted");
	return baselineCapability("consumed-d10-artifact");
}

export function createD11InjectedBaselineForTest(): D11BaselineAdmissionV1 {
	return baselineCapability("injected-test");
}

function consumeBaseline(value: unknown): BaselineState {
	if (value === null || typeof value !== "object") throw new TypeError("D11 baseline is invalid");
	const state = baselines.get(value);
	if (state === undefined) throw new TypeError("D11 baseline is forged or replayed");
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

function retryableProvider(
	effect: CurrentGraphProviderAdmittedEffectV1,
): CurrentGraphProviderEffectResultInputV1 {
	const retryAfterMs = [7_000, 1_000, 60_000][effect.request.runSequence % 3]!;
	const proposalMaterial = strictSnapshot({
		retryClass: "retryable-transient" as const,
		retryAfterMs,
		requestDigest: effect.request.requestDigest,
		logicalRequestDigest: effect.request.logicalRequestDigest,
	});
	return Object.freeze({
		effectKind: "provider-request" as const,
		status: "failed" as const,
		toolCalls: Object.freeze([]),
		failureCode: "retryable-transient" as const,
		retryProposal: Object.freeze({
			retryClass: "retryable-transient" as const,
			retryAfterMs,
			proposalDigest: empiricalStrictJsonDigest(proposalMaterial),
		}),
		usage: reportedUsage(),
		evidenceDigest: empiricalStrictJsonDigest({
			fixture: "D11-bounded-retry",
			requestDigest: effect.request.requestDigest,
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
	if (request.effectKind === "retry-wait")
		return {
			effectKind: "retry-wait",
			status: "completed",
			actualElapsedMs: request.reservation.maxElapsedMs,
			evidenceDigest,
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
	throw new TypeError(`D11 qualification did not expect ${request.effectKind}`);
}

function transportFixture(cause: D11TransportCause): {
	readonly phase: D11TransportPhase;
	readonly invoke: (signal: AbortSignal) => Promise<CurrentGraphProviderEffectResultInputV1>;
	readonly scheduleTimeout?: (callback: () => void, milliseconds: number) => () => void;
} {
	if (cause === "owned-deadline")
		return {
			phase: "response-body",
			scheduleTimeout: (callback) => {
				callback();
				return () => undefined;
			},
			invoke: async (signal) => {
				if (!signal.aborted) throw new TypeError("D11 owned deadline fixture did not abort");
				throw new DOMException("sanitized", "AbortError");
			},
		};
	const code =
		cause === "connect-timeout"
			? "UND_ERR_CONNECT_TIMEOUT"
			: cause === "headers-timeout"
				? "UND_ERR_HEADERS_TIMEOUT"
				: cause === "body-timeout"
					? "UND_ERR_BODY_TIMEOUT"
					: cause === "connection-reset"
						? "ECONNRESET"
						: "ENOTFOUND";
	return {
		phase: cause === "body-timeout" || cause === "connection-reset" ? "response-body" : "request",
		invoke: async () => {
			throw Object.freeze({ code });
		},
	};
}

async function runAuthority(input: {
	readonly mode: RunMode;
	readonly metrics: { active: number; maxActive: number; providerCalls: number };
}): Promise<D11TransportFailureEvidenceV1> {
	const authority: D11TransportFailureAuthorityV1 = createD11TransportFailureAuthority({
		limits: CURRENT_GRAPH_LIVE_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: CURRENT_GRAPH_LIVE_TASK,
	});
	let transportIndex = 0;
	for (let guard = 0; guard < CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts; guard += 1) {
		const effect = takeD11ProviderEffect(authority);
		if (effect === null) return snapshotD11TransportFailureEvidence(authority);
		input.metrics.active += 1;
		input.metrics.maxActive = Math.max(input.metrics.maxActive, input.metrics.active);
		try {
			let envelope: D11TransportResultEnvelopeV1;
			if (effect.request.effectKind === "provider-request") {
				input.metrics.providerCalls += 1;
				if (input.mode === "transport") {
					const fixture = transportFixture(D11_TRANSPORT_CAUSES[transportIndex++]!);
					envelope = await executeD11TransportBoundary({ effect, ...fixture });
				} else {
					const shouldRetry =
						input.mode === "retry" &&
						effect.request.attemptOrdinal === 1 &&
						effect.runtime.modelEnvelope?.phaseBefore === "none";
					envelope = await executeD11TransportBoundary({
						effect,
						phase: "request",
						invoke: async () =>
							shouldRetry ? retryableProvider(effect) : completedProvider(effect),
					});
				}
			} else {
				envelope = Object.freeze({
					schemaVersion: D11_TRANSPORT_ENVELOPE_SCHEMA,
					result: localSuccess(effect),
					transportProposal: null,
				});
			}
			admitD11ProviderEffectEnvelope(authority, effect.request.requestDigest, envelope);
		} finally {
			input.metrics.active -= 1;
		}
	}
	throw new TypeError("D11 qualification exceeded its effect bound");
}

function exactPhaseCauseCoverage(evidence: D11TransportFailureEvidenceV1): readonly string[] {
	return Object.freeze(evidence.transportFacts.map((fact) => `${fact.phase}:${fact.causeCode}`));
}

function expectedPhaseCauseCoverage(): readonly string[] {
	return Object.freeze([
		"response-body:owned-deadline",
		"request:connect-timeout",
		"request:headers-timeout",
		"response-body:body-timeout",
		"response-body:connection-reset",
		"request:dns-failure",
	]);
}

function negativeReceiptMaterial() {
	return strictSnapshot({
		callerCancellationRejected: true as const,
		unknownFailureRejected: true as const,
		proposalReplayRejected: true as const,
		accessorRejectedWithoutInvocation: true as const,
		requestMismatchRejectedWithoutInvocation: true as const,
	});
}

async function runNegativeBoundaryQualification(): Promise<string> {
	const createProvider = () => {
		const authority = createD11TransportFailureAuthority({
			limits: CURRENT_GRAPH_LIVE_LIMITS,
			routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
			taskProfile: CURRENT_GRAPH_LIVE_TASK,
		});
		const materialization = takeD11ProviderEffect(authority)!;
		admitD11ProviderEffectEnvelope(authority, materialization.request.requestDigest, {
			schemaVersion: D11_TRANSPORT_ENVELOPE_SCHEMA,
			result: localSuccess(materialization),
			transportProposal: null,
		});
		return { authority, provider: takeD11ProviderEffect(authority)! };
	};
	const first = createProvider();
	const fixture = transportFixture("connect-timeout");
	const envelope = await executeD11TransportBoundary({ effect: first.provider, ...fixture });
	admitD11ProviderEffectEnvelope(first.authority, first.provider.request.requestDigest, envelope);
	const second = createProvider();
	let replayRejected = false;
	try {
		admitD11ProviderEffectEnvelope(
			second.authority,
			second.provider.request.requestDigest,
			envelope,
		);
	} catch {
		replayRejected = true;
	}
	let getterCalls = 0;
	const accessor = {} as Record<string, unknown>;
	Object.defineProperty(accessor, "schemaVersion", {
		enumerable: true,
		get() {
			getterCalls += 1;
			return D11_TRANSPORT_ENVELOPE_SCHEMA;
		},
	});
	let mismatchRejected = false;
	try {
		admitD11ProviderEffectEnvelope(
			second.authority,
			empiricalStrictJsonDigest({ wrong: true }),
			accessor,
		);
	} catch {
		mismatchRejected = true;
	}
	let accessorRejected = false;
	try {
		admitD11ProviderEffectEnvelope(
			second.authority,
			second.provider.request.requestDigest,
			accessor,
		);
	} catch {
		accessorRejected = true;
	}
	const caller = new AbortController();
	caller.abort();
	let callerRejected = false;
	try {
		await executeD11TransportBoundary({
			effect: second.provider,
			phase: "request",
			callerSignal: caller.signal,
			invoke: async () => {
				throw new DOMException("sanitized", "AbortError");
			},
		});
	} catch {
		callerRejected = true;
	}
	let unknownRejected = false;
	try {
		await executeD11TransportBoundary({
			effect: second.provider,
			phase: "request",
			invoke: async () => {
				throw Object.freeze({ code: "UNKNOWN" });
			},
		});
	} catch {
		unknownRejected = true;
	}
	if (
		!replayRejected ||
		!mismatchRejected ||
		!accessorRejected ||
		getterCalls !== 0 ||
		!callerRejected ||
		!unknownRejected
	)
		throw new TypeError("D11 negative boundary qualification drifted");
	return empiricalStrictJsonDigest(negativeReceiptMaterial());
}

function validateQualifiedEvidence(input: {
	readonly transportEvidence: D11TransportFailureEvidenceV1;
	readonly transparentEvidence: D11TransportFailureEvidenceV1;
	readonly retryEvidence: D11TransportFailureEvidenceV1;
}): void {
	const transportRuns = input.transportEvidence.d9Evidence.providerEvidence.workflowEvidence.runs;
	const transparentRuns =
		input.transparentEvidence.d9Evidence.providerEvidence.workflowEvidence.runs;
	const retryRuns = input.retryEvidence.d9Evidence.providerEvidence.workflowEvidence.runs;
	if (
		empiricalStrictJsonDigest(exactPhaseCauseCoverage(input.transportEvidence)) !==
			empiricalStrictJsonDigest(expectedPhaseCauseCoverage()) ||
		transportRuns.length !== 6 ||
		!transportRuns.every(
			(run) => run.status === "incomplete" && run.cleanupStatus === "completed",
		) ||
		input.transportEvidence.d9Evidence.providerEvidence.budget.providerAttempts !== 6 ||
		input.transportEvidence.d9Evidence.providerEvidence.budget.confirmedCostMicrousd !==
			6 * CURRENT_GRAPH_LIVE_LIMITS.providerMaxCostMicrousd ||
		input.transportEvidence.d9Evidence.providerEvidence.budget.confirmedElapsedMs !==
			6 * CURRENT_GRAPH_LIVE_LIMITS.providerMaxElapsedMs + 12 ||
		transparentRuns.length !== 6 ||
		!transparentRuns.every(
			(run) =>
				run.status === "completed" &&
				run.publicSemanticValidationPassed &&
				run.hiddenVerifierPassed &&
				run.cleanupStatus === "completed",
		) ||
		input.transparentEvidence.transportFailureCount !== 0 ||
		retryRuns.length !== 6 ||
		!retryRuns.every((run) => run.status === "completed" && run.cleanupStatus === "completed") ||
		input.retryEvidence.transportFailureCount !== 0 ||
		input.retryEvidence.d9Evidence.providerEvidence.budget.retryWaits !== 6
	)
		throw new TypeError("D11 qualification evidence coverage drifted");
	const providerFacts = input.retryEvidence.d9Evidence.providerEvidence.facts.filter(
		(fact) => fact.request.effectKind === "provider-request",
	);
	for (const runSequence of [0, 1, 2, 3, 4, 5]) {
		const firstLogical = providerFacts.filter(
			(fact) =>
				fact.runSequence === runSequence &&
				fact.request.logicalRequestDigest ===
					providerFacts.find(
						(candidate) =>
							candidate.runSequence === runSequence && candidate.request.attemptOrdinal === 1,
					)?.request.logicalRequestDigest,
		);
		if (
			firstLogical.length !== 2 ||
			firstLogical[0]?.request.attemptOrdinal !== 1 ||
			firstLogical[1]?.request.attemptOrdinal !== 2 ||
			firstLogical[0].request.routeDigest !== firstLogical[1].request.routeDigest ||
			firstLogical[0].request.taskEnvelopeDigest !== firstLogical[1].request.taskEnvelopeDigest ||
			firstLogical[0].request.sourceWorkflowRequestDigest !==
				firstLogical[1].request.sourceWorkflowRequestDigest ||
			firstLogical[0].result.effectKind !== "provider-request" ||
			firstLogical[1].result.effectKind !== "provider-request" ||
			firstLogical[0].result.status !== "failed" ||
			firstLogical[0].result.retryProposal === null ||
			firstLogical[1].result.status !== "completed"
		)
			throw new TypeError("D11 retry identity coverage drifted");
	}
}

export async function runD11InjectedNoNetworkQualification(inputValue: {
	readonly baseline: D11BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
}): Promise<D11QualificationBundleV1> {
	const input = captureOwnDataInput(
		inputValue,
		["baseline", "implementationManifestDigest"],
		"D11 qualification input",
	);
	const baseline = consumeBaseline(input.baseline);
	if (input.implementationManifestDigest !== D11_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D11 implementation manifest digest is invalid");
	const metrics = { active: 0, maxActive: 0, providerCalls: 0 };
	const transportEvidence = validateD11TransportFailureEvidence(
		await runAuthority({ mode: "transport", metrics }),
	);
	const transparentEvidence = validateD11TransportFailureEvidence(
		await runAuthority({ mode: "transparent", metrics }),
	);
	const retryEvidence = validateD11TransportFailureEvidence(
		await runAuthority({ mode: "retry", metrics }),
	);
	const negativeBoundaryReceiptDigest = await runNegativeBoundaryQualification();
	validateQualifiedEvidence({ transportEvidence, transparentEvidence, retryEvidence });
	if (metrics.active !== 0 || metrics.maxActive !== 1)
		throw new TypeError("D11 qualification serial execution drifted");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D11_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D11" as const,
		implementationManifestDigest: input.implementationManifestDigest,
		d10FailureBaseline: D11_D10_FAILURE_BASELINE,
		transportEvidenceDigest: transportEvidence.evidenceDigest,
		transparentEvidenceDigest: transparentEvidence.evidenceDigest,
		retryEvidenceDigest: retryEvidence.evidenceDigest,
		phaseCauseCoverage: exactPhaseCauseCoverage(transportEvidence),
		transportFailureFacts: 6 as const,
		completedArmAdmissions: 6 as const,
		conservativeReservationAccountingPassed: true as const,
		armLocalContinuationPassed: true as const,
		transparentSixArmPassed: true as const,
		retryInvariantPassed: true as const,
		retryWaits: 6 as const,
		callerCancellationRejected: true as const,
		unknownFailureRejected: true as const,
		negativeBoundaryReceiptDigest,
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
		schemaVersion: D11_GENERATION_SCHEMA,
		generationRef: D11_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		transportEvidenceDigest: transportEvidence.evidenceDigest,
		transparentEvidenceDigest: transparentEvidence.evidenceDigest,
		retryEvidenceDigest: retryEvidence.evidenceDigest,
		implementationManifestDigest: input.implementationManifestDigest,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const bundleMaterial = strictSnapshot({
		schemaVersion: D11_BUNDLE_SCHEMA,
		basis: baseline.basis,
		qualification,
		transportEvidence,
		transparentEvidence,
		retryEvidence,
		generation,
	});
	const bundle = Object.freeze({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	}) as D11QualificationBundleV1;
	constructed.add(bundle);
	return bundle;
}

export function validateD11QualificationBundle(value: unknown): D11QualificationBundleV1 {
	const candidateRecord = record(value, "D11 qualification bundle");
	exactKeys(
		candidateRecord,
		[
			"basis",
			"bundleDigest",
			"generation",
			"qualification",
			"retryEvidence",
			"schemaVersion",
			"transparentEvidence",
			"transportEvidence",
		],
		"D11 qualification bundle",
	);
	const candidate = candidateRecord as unknown as D11QualificationBundleV1;
	const qualification = record(candidate.qualification, "D11 qualification");
	exactKeys(
		qualification,
		[
			"armLocalContinuationPassed",
			"callerCancellationRejected",
			"causalAttribution",
			"completedArmAdmissions",
			"conservativeReservationAccountingPassed",
			"d10FailureBaseline",
			"decisionRef",
			"efficacyClaim",
			"implementationManifestDigest",
			"maxActiveExecutor",
			"negativeBoundaryReceiptDigest",
			"phaseCauseCoverage",
			"providerNetworkCalls",
			"qualificationDigest",
			"retryEvidenceDigest",
			"retryInvariantPassed",
			"retryWaits",
			"schemaVersion",
			"transparentEvidenceDigest",
			"transparentSixArmPassed",
			"transportEvidenceDigest",
			"transportFailureFacts",
			"unknownFailureRejected",
		],
		"D11 qualification",
	);
	const generation = record(candidate.generation, "D11 generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"qualificationDigest",
			"retryEvidenceDigest",
			"schemaVersion",
			"transparentEvidenceDigest",
			"transportEvidenceDigest",
		],
		"D11 generation",
	);
	if (
		candidate.schemaVersion !== D11_BUNDLE_SCHEMA ||
		(candidate.basis !== "consumed-d10-artifact" && candidate.basis !== "injected-test") ||
		candidate.qualification.schemaVersion !== D11_QUALIFICATION_SCHEMA ||
		candidate.qualification.decisionRef !== "graphrefly-ts:D11" ||
		candidate.qualification.implementationManifestDigest !== D11_IMPLEMENTATION_MANIFEST_DIGEST ||
		candidate.qualification.causalAttribution !== "undetermined" ||
		candidate.qualification.efficacyClaim !== "none" ||
		candidate.qualification.transportFailureFacts !== 6 ||
		candidate.qualification.completedArmAdmissions !== 6 ||
		candidate.qualification.conservativeReservationAccountingPassed !== true ||
		candidate.qualification.armLocalContinuationPassed !== true ||
		candidate.qualification.transparentSixArmPassed !== true ||
		candidate.qualification.retryInvariantPassed !== true ||
		candidate.qualification.retryWaits !== 6 ||
		candidate.qualification.callerCancellationRejected !== true ||
		candidate.qualification.unknownFailureRejected !== true ||
		candidate.qualification.negativeBoundaryReceiptDigest !==
			empiricalStrictJsonDigest(negativeReceiptMaterial()) ||
		candidate.qualification.providerNetworkCalls !== 0 ||
		candidate.qualification.maxActiveExecutor !== 1 ||
		candidate.generation.schemaVersion !== D11_GENERATION_SCHEMA ||
		candidate.generation.generationRef !== D11_GENERATION_REF
	)
		throw new TypeError("D11 qualification coordinates drifted");
	const transportEvidence = validateD11TransportFailureEvidence(candidate.transportEvidence);
	const transparentEvidence = validateD11TransportFailureEvidence(candidate.transparentEvidence);
	const retryEvidence = validateD11TransportFailureEvidence(candidate.retryEvidence);
	validateQualifiedEvidence({ transportEvidence, transparentEvidence, retryEvidence });
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D11_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D11" as const,
		implementationManifestDigest: D11_IMPLEMENTATION_MANIFEST_DIGEST,
		d10FailureBaseline: D11_D10_FAILURE_BASELINE,
		transportEvidenceDigest: transportEvidence.evidenceDigest,
		transparentEvidenceDigest: transparentEvidence.evidenceDigest,
		retryEvidenceDigest: retryEvidence.evidenceDigest,
		phaseCauseCoverage: expectedPhaseCauseCoverage(),
		transportFailureFacts: 6 as const,
		completedArmAdmissions: 6 as const,
		conservativeReservationAccountingPassed: true as const,
		armLocalContinuationPassed: true as const,
		transparentSixArmPassed: true as const,
		retryInvariantPassed: true as const,
		retryWaits: 6 as const,
		callerCancellationRejected: true as const,
		unknownFailureRejected: true as const,
		negativeBoundaryReceiptDigest: empiricalStrictJsonDigest(negativeReceiptMaterial()),
		providerNetworkCalls: 0 as const,
		maxActiveExecutor: 1 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualificationDigest = candidate.qualification.qualificationDigest;
	const { qualificationDigest: _candidateQualificationDigest, ...candidateQualificationMaterial } =
		candidate.qualification;
	if (
		empiricalStrictJsonDigest(candidateQualificationMaterial) !==
			empiricalStrictJsonDigest(qualificationMaterial) ||
		qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial)
	)
		throw new TypeError("D11 qualification digest drifted");
	const rebuiltQualification = Object.freeze({ ...qualificationMaterial, qualificationDigest });
	const generationMaterial = strictSnapshot({
		schemaVersion: D11_GENERATION_SCHEMA,
		generationRef: D11_GENERATION_REF,
		qualificationDigest,
		transportEvidenceDigest: transportEvidence.evidenceDigest,
		transparentEvidenceDigest: transparentEvidence.evidenceDigest,
		retryEvidenceDigest: retryEvidence.evidenceDigest,
		implementationManifestDigest: D11_IMPLEMENTATION_MANIFEST_DIGEST,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generationDigest = candidate.generation.generationDigest;
	const { generationDigest: _candidateGenerationDigest, ...candidateGenerationMaterial } =
		candidate.generation;
	if (
		empiricalStrictJsonDigest(candidateGenerationMaterial) !==
			empiricalStrictJsonDigest(generationMaterial) ||
		generationDigest !== empiricalStrictJsonDigest(generationMaterial)
	)
		throw new TypeError("D11 generation digest drifted");
	const rebuiltGeneration = Object.freeze({ ...generationMaterial, generationDigest });
	const bundleMaterial = strictSnapshot({
		schemaVersion: D11_BUNDLE_SCHEMA,
		basis: candidate.basis,
		qualification: rebuiltQualification,
		transportEvidence,
		transparentEvidence,
		retryEvidence,
		generation: rebuiltGeneration,
	});
	const bundleDigest = candidate.bundleDigest;
	if (bundleDigest !== empiricalStrictJsonDigest(bundleMaterial))
		throw new TypeError("D11 qualification bundle digest drifted");
	return Object.freeze({ ...bundleMaterial, bundleDigest }) as D11QualificationBundleV1;
}

async function persistBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D11QualificationBundleV1;
	readonly generationRef: string;
}) {
	if (!constructed.has(input.bundle))
		throw new TypeError("D11 qualification persistence requires a same-process bundle");
	constructed.delete(input.bundle);
	const bundle = validateD11QualificationBundle(input.bundle);
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const generationBytes = strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue);
	const qualificationBytes = strictJsonCodec.encode(
		bundle.qualification as unknown as StrictJsonValue,
	);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d11.transport-failure-commit.v1",
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

export async function persistD11QualificationBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D11QualificationBundleV1;
}) {
	const input = captureOwnDataInput(
		inputValue,
		["bundle", "privateRoot"],
		"D11 production persistence input",
	);
	const bundle = input.bundle as D11QualificationBundleV1;
	if (bundle.basis !== "consumed-d10-artifact")
		throw new TypeError("D11 production persistence requires consumed D10 evidence");
	return persistBundle({
		privateRoot: input.privateRoot as string,
		bundle,
		generationRef: D11_GENERATION_REF,
	});
}

export async function persistD11InjectedQualificationForTest(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D11QualificationBundleV1;
}) {
	const input = captureOwnDataInput(
		inputValue,
		["bundle", "privateRoot"],
		"D11 injected persistence input",
	);
	const bundle = input.bundle as D11QualificationBundleV1;
	if (bundle.basis !== "injected-test")
		throw new TypeError("D11 injected persistence basis drifted");
	return persistBundle({
		privateRoot: input.privateRoot as string,
		bundle,
		generationRef: D11_INJECTED_TEST_GENERATION_REF,
	});
}
