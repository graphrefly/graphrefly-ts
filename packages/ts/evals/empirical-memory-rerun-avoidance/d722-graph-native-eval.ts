import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import type { AgentRequestIssued } from "../../src/orchestration/agent-runtime.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	admitD719CleanGraphArmResult,
	admitD719CleanGraphCancellation,
	createD719CleanEffectController,
	createD719CleanGraphLedger,
	type D719CleanBudgetLimitsV1,
	type D719CleanGraphEvidenceV1,
	type D719CleanRequestInput,
	type D719EffectAdmissionV1,
	reconcileD719CleanGraphEffect,
	reconcileD719CleanGraphEffectConservatively,
	requestD719CleanGraphEffect,
	snapshotD719CleanGraphBudgetState,
	snapshotD719CleanGraphEvidence,
	takeNextD719CleanGraphRequest,
	validateD719CleanGraphEvidence,
} from "./d719-clean-graph-ledger.js";
import {
	admitD720GraphCancellation,
	admitD720GraphEffectBoundExhaustion,
	admitD720GraphEffectResult,
	admitD722GraphEffectResult,
	createD720GraphEffectRuntime,
	createD722GraphCompletionContextPolicy,
	createD722GraphEffectRuntime,
	type D720EffectResultV1,
	type D720GraphEffectEvidenceV1,
	type D720GraphEffectRequestV1,
	type D722GraphEffectEvidenceV1,
	deriveD720GraphArmResult,
	deriveD720GraphArmResultFromEvidence,
	nextD720GraphEffectDecision,
	snapshotD720GraphEffectEvidence,
	snapshotD722GraphEffectEvidence,
	validateD720GraphEffectEvidence,
	validateD720GraphEffectResult,
} from "./d722-graph-native-effect-runtime.js";

export const D720_GRAPH_NATIVE_EVAL_REVISION =
	"graphrefly.b112.d720.clean-graph-native-eval.v2" as const;
export const D720_GRAPH_NATIVE_EVAL_BUNDLE_SCHEMA =
	"graphrefly.b112.d720.graph-native-eval-bundle.v2" as const;
export const D720_CANONICAL_GRAPH_EVIDENCE_SCHEMA =
	"graphrefly.b112.d720.canonical-graph-evidence.v1" as const;
export const D720_GRAPH_NATIVE_PERSISTENCE_SCHEMA =
	"graphrefly.b112.d720.graph-native-persistence-receipt.v2" as const;

export interface D720CallerEffectExecutionInputV2 {
	readonly request: AgentRequestIssued<D719CleanRequestInput>;
	readonly effectRequest: D720GraphEffectRequestV1;
	readonly admission: D719EffectAdmissionV1;
	readonly signal?: AbortSignal;
}

export interface D720CallerEffectExecutionV2 {
	readonly result: D720EffectResultV1;
	readonly actualCostMicrousd: number;
	readonly actualElapsedMs: number;
}

export interface D720CallerExecutorV2 {
	readonly revision: "graphrefly.b112.d720.caller-executor.v2";
}

export interface D720EffectCeilingsV2 {
	readonly routeDigest: string;
	readonly providerMaxCostMicrousd: number;
	readonly providerMaxElapsedMs: number;
	readonly localEffectMaxElapsedMs: number;
}

export interface D720GraphNativeEvalBundleV1 {
	readonly schemaVersion: typeof D720_GRAPH_NATIVE_EVAL_BUNDLE_SCHEMA;
	readonly evalRevision: typeof D720_GRAPH_NATIVE_EVAL_REVISION;
	readonly executionClass: "simulated-contract";
	readonly graphEvidence: D720CanonicalGraphEvidenceV1;
	readonly graphEvidenceDigest: string;
	readonly findingsDigest: string;
	readonly runStatus: "complete" | "stopped";
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly bundleDigest: string;
}

export interface D720CanonicalGraphEvidenceV1 {
	readonly schemaVersion: typeof D720_CANONICAL_GRAPH_EVIDENCE_SCHEMA;
	readonly ledger: D719CleanGraphEvidenceV1;
	readonly effectRuns: readonly D720GraphEffectEvidenceV1[];
	readonly findings: D719CleanGraphEvidenceV1["findings"];
	readonly runStatus: "complete" | "stopped";
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D722GraphNativeEvalCoreV1 {
	readonly ledger: D719CleanGraphEvidenceV1;
	readonly effectRuns: readonly D722GraphEffectEvidenceV1[];
}

export interface D720PersistedBundleReceiptV1 {
	readonly schemaVersion: typeof D720_GRAPH_NATIVE_PERSISTENCE_SCHEMA;
	readonly bundleRef: string;
	readonly graphEvidenceArtifactDigest: string;
	readonly findingsArtifactDigest: string;
	readonly bundleArtifactDigest: string;
	readonly bundleDigest: string;
	readonly persistenceDigest: string;
}

interface ExecutorState {
	readonly execute: (
		input: D720CallerEffectExecutionInputV2,
	) => Promise<D720CallerEffectExecutionV2>;
}

const constructedExecutors = new WeakMap<object, ExecutorState>();
const constructedBundles = new WeakSet<object>();

function signalIsAborted(signal: AbortSignal | undefined): boolean {
	return signal?.aborted === true;
}

function validateEffectCeilings(value: unknown): D720EffectCeilingsV2 {
	const candidate = record(value, "d720.effectCeilings");
	exactKeys(
		candidate,
		["localEffectMaxElapsedMs", "providerMaxCostMicrousd", "providerMaxElapsedMs", "routeDigest"],
		"d720.effectCeilings",
	);
	digest(candidate.routeDigest, "d720.effectCeilings.routeDigest");
	for (const key of [
		"localEffectMaxElapsedMs",
		"providerMaxCostMicrousd",
		"providerMaxElapsedMs",
	] as const)
		safeInteger(candidate[key], `d720.effectCeilings.${key}`, { min: 1, max: 1_000_000_000 });
	return strictSnapshot(candidate) as unknown as D720EffectCeilingsV2;
}

function reservationFor(request: D720GraphEffectRequestV1, ceilings: D720EffectCeilingsV2) {
	const retryWaitFloor =
		request.retryReason === "d710-untyped-http-429"
			? Math.max(60_000, request.retryAfterMs ?? 0)
			: request.retryReason === "d671-rate-limit-exceeded" ||
					request.retryReason === "d671-provider-overloaded"
				? Math.max(request.attemptOrdinal === 2 ? 5_000 : 10_000, request.retryAfterMs ?? 0)
				: (request.retryAfterMs ?? 0);
	return Object.freeze({
		effectKind: request.effectKind,
		logicalRequestDigest: request.logicalRequestDigest,
		routeDigest: ceilings.routeDigest,
		attemptOrdinal: request.attemptOrdinal,
		retryReason: request.retryReason,
		retryAfterMs: request.retryAfterMs,
		maxCostMicrousd:
			request.effectKind === "provider-request" ? ceilings.providerMaxCostMicrousd : 0,
		maxElapsedMs:
			request.effectKind === "provider-request"
				? ceilings.providerMaxElapsedMs
				: request.effectKind === "retry-wait"
					? Math.max(ceilings.localEffectMaxElapsedMs, retryWaitFloor)
					: ceilings.localEffectMaxElapsedMs,
	});
}

function validateExecutedEffect(value: unknown): D720CallerEffectExecutionV2 {
	const candidate = record(value, "d720.executedEffect");
	exactKeys(candidate, ["actualCostMicrousd", "actualElapsedMs", "result"], "d720.executedEffect");
	safeInteger(candidate.actualCostMicrousd, "d720.executedEffect.actualCostMicrousd", {
		max: 1_000_000_000,
	});
	safeInteger(candidate.actualElapsedMs, "d720.executedEffect.actualElapsedMs", {
		max: 1_000_000_000,
	});
	const result = record(candidate.result, "d720.executedEffect.result");
	oneOf(
		result.effectKind,
		[
			"materialization",
			"provider-request",
			"retry-wait",
			"tool-action",
			"hidden-verifier",
			"cleanup",
		],
		"d720.executedEffect.result.effectKind",
	);
	return strictSnapshot(candidate) as unknown as D720CallerEffectExecutionV2;
}

function failedEffectResult(
	request: D720GraphEffectRequestV1,
	cause: "graph-admission-denied" | "executor-threw" | "invalid-executor-result",
): D720EffectResultV1 {
	const evidenceDigest = empiricalStrictJsonDigest({
		requestDigest: request.requestDigest,
		outcome: cause,
	});
	if (request.effectKind === "materialization")
		return Object.freeze({
			effectKind: "materialization",
			status: "failed",
			workspaceStateDigest: null,
			evidenceDigest,
		});
	if (request.effectKind === "provider-request")
		return Object.freeze({
			effectKind: "provider-request",
			status: "terminal-failure",
			toolIntents: Object.freeze([]),
			failureDiscriminator: "none",
			retryAfterMs: null,
			workspaceStateDigest:
				request.workspaceStateDigest ??
				empiricalStrictJsonDigest({ unavailable: request.requestDigest }),
			evidenceDigest,
		});
	if (request.effectKind === "retry-wait")
		return Object.freeze({ effectKind: "retry-wait", status: "failed", evidenceDigest });
	if (request.effectKind === "tool-action") {
		if (request.toolIntent === null) throw new TypeError("D720 failed tool lacks Graph intent");
		return Object.freeze({
			effectKind: "tool-action",
			toolRef: request.toolIntent.toolRef,
			intentDigest: request.toolIntent.intentDigest,
			status: "failed",
			nonEmptyDiff: false,
			workspaceStateBeforeDigest:
				request.workspaceStateDigest ??
				empiricalStrictJsonDigest({ unavailable: request.requestDigest }),
			workspaceStateAfterDigest:
				request.workspaceStateDigest ??
				empiricalStrictJsonDigest({ unavailable: request.requestDigest }),
			evidenceDigest,
		});
	}
	if (request.effectKind === "hidden-verifier")
		return Object.freeze({
			effectKind: "hidden-verifier",
			status: "failed",
			workspaceStateDigest:
				request.workspaceStateDigest ??
				empiricalStrictJsonDigest({ unavailable: request.requestDigest }),
			evidenceDigest,
		});
	return Object.freeze({ effectKind: "cleanup", status: "failed", evidenceDigest });
}

export function createD720SimulatedCallerExecutor(
	execute: (input: D720CallerEffectExecutionInputV2) => Promise<D720CallerEffectExecutionV2>,
): D720CallerExecutorV2 {
	if (typeof execute !== "function") throw new TypeError("D720 executor must be a function");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d720.caller-executor.v2" as const,
	});
	constructedExecutors.set(capability, { execute });
	return capability;
}

function executorState(value: unknown): ExecutorState {
	if (typeof value !== "object" || value === null) {
		throw new TypeError("D720 executor must be a constructed capability");
	}
	const state = constructedExecutors.get(value);
	if (state === undefined) throw new TypeError("D720 executor was not constructed by the eval");
	return state;
}

export async function runD720GraphNativeEval(inputValue: {
	readonly sourceDigest: string;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly effectCeilings: D720EffectCeilingsV2;
	readonly executor: D720CallerExecutorV2;
	readonly signal?: AbortSignal;
}): Promise<D720GraphNativeEvalBundleV1> {
	const input = record(inputValue, "d720.run");
	exactKeys(
		input,
		Object.hasOwn(input, "signal")
			? ["budgetLimits", "effectCeilings", "executor", "signal", "sourceDigest"]
			: ["budgetLimits", "effectCeilings", "executor", "sourceDigest"],
		"d720.run",
	);
	const sourceDigest = digest(input.sourceDigest, "d720.run.sourceDigest");
	const executor = executorState(input.executor);
	const effectCeilings = validateEffectCeilings(input.effectCeilings);
	if (Object.hasOwn(input, "signal") && !(input.signal instanceof AbortSignal)) {
		throw new TypeError("D720 signal is invalid");
	}
	const signal = input.signal as AbortSignal | undefined;
	const ledger = createD719CleanGraphLedger({
		sourceDigest,
		budgetLimits: input.budgetLimits as D719CleanBudgetLimitsV1,
	});
	const effectEvidence: D720GraphEffectEvidenceV1[] = [];
	for (let runCount = 0; runCount < 12; runCount += 1) {
		const request = takeNextD719CleanGraphRequest(ledger);
		if (request === null) break;
		const effects = createD719CleanEffectController(ledger, request);
		const runtime = createD720GraphEffectRuntime({ request, runSequence: runCount });
		if (signalIsAborted(signal)) {
			admitD720GraphCancellation(
				runtime,
				empiricalStrictJsonDigest({
					requestDigest: empiricalStrictJsonDigest(request),
					cancelled: true,
				}),
			);
			effectEvidence.push(snapshotD720GraphEffectEvidence(runtime, "cancelled"));
			admitD719CleanGraphCancellation(ledger, request);
			break;
		}
		let cancellationRequested = false;
		let effectBoundExhausted = false;
		for (let effectCount = 0; effectCount < 512; effectCount += 1) {
			if (
				!cancellationRequested &&
				signalIsAborted(signal) &&
				nextD720GraphEffectDecision(runtime).disposition !== "complete-arm"
			) {
				admitD720GraphCancellation(
					runtime,
					empiricalStrictJsonDigest({
						requestDigest: empiricalStrictJsonDigest(request),
						cancelledBeforeEffect: effectCount,
					}),
				);
				cancellationRequested = true;
			}
			let graphDecision = nextD720GraphEffectDecision(runtime);
			if (graphDecision.disposition === "complete-arm") break;
			if (effectCount === 509 && graphDecision.effectRequest?.effectKind !== "cleanup") {
				admitD720GraphEffectBoundExhaustion(
					runtime,
					empiricalStrictJsonDigest({
						requestDigest: empiricalStrictJsonDigest(request),
						effectBound: 512,
					}),
				);
				effectBoundExhausted = true;
				graphDecision = nextD720GraphEffectDecision(runtime);
				if (graphDecision.disposition === "complete-arm") break;
			}
			const effectRequest = graphDecision.effectRequest;
			if (effectRequest === null) throw new TypeError("D720 Graph effect request is missing");
			const reservation = reservationFor(effectRequest, effectCeilings);
			const admission = requestD719CleanGraphEffect(effects, reservation);
			if (!admission.admitted) {
				admitD720GraphEffectResult(
					runtime,
					effectRequest,
					failedEffectResult(effectRequest, "graph-admission-denied"),
					admission.decisionDigest,
				);
				continue;
			}
			let rawExecution: D720CallerEffectExecutionV2;
			try {
				rawExecution = await executor.execute(
					Object.freeze(
						signal === undefined ||
							(cancellationRequested && effectRequest.effectKind === "cleanup")
							? { admission, effectRequest, request }
							: { admission, effectRequest, request, signal },
					),
				);
			} catch {
				reconcileD719CleanGraphEffectConservatively(effects, admission);
				admitD720GraphEffectResult(
					runtime,
					effectRequest,
					failedEffectResult(effectRequest, "executor-threw"),
					admission.decisionDigest,
				);
				if (!cancellationRequested && signalIsAborted(signal)) {
					admitD720GraphCancellation(
						runtime,
						empiricalStrictJsonDigest({
							requestDigest: empiricalStrictJsonDigest(request),
							cancelledAfterExecutorFailure: effectRequest.requestDigest,
						}),
					);
					cancellationRequested = true;
				}
				continue;
			}
			let execution: D720CallerEffectExecutionV2;
			try {
				const envelope = validateExecutedEffect(rawExecution);
				execution = Object.freeze({
					...envelope,
					result: validateD720GraphEffectResult(envelope.result, effectRequest),
				});
			} catch {
				reconcileD719CleanGraphEffectConservatively(effects, admission);
				admitD720GraphEffectResult(
					runtime,
					effectRequest,
					failedEffectResult(effectRequest, "invalid-executor-result"),
					admission.decisionDigest,
				);
				if (!cancellationRequested && signalIsAborted(signal)) {
					admitD720GraphCancellation(
						runtime,
						empiricalStrictJsonDigest({
							requestDigest: empiricalStrictJsonDigest(request),
							cancelledAfterInvalidExecutorResult: effectRequest.requestDigest,
						}),
					);
					cancellationRequested = true;
				}
				continue;
			}
			const retryable =
				execution.result.effectKind === "provider-request" &&
				execution.result.status === "retryable-failure";
			reconcileD719CleanGraphEffect(effects, admission, {
				actualCostMicrousd: execution.actualCostMicrousd,
				actualElapsedMs: execution.actualElapsedMs,
				outcome:
					execution.result.effectKind === "provider-request" &&
					(execution.result.status === "terminal-failure" || retryable)
						? "failed"
						: "completed",
				failureDiscriminator:
					execution.result.effectKind === "provider-request" &&
					execution.result.status === "retryable-failure"
						? execution.result.failureDiscriminator
						: "none",
			});
			admitD720GraphEffectResult(
				runtime,
				effectRequest,
				execution.result,
				admission.decisionDigest,
			);
			if (signalIsAborted(signal) && !cancellationRequested) {
				admitD720GraphCancellation(
					runtime,
					empiricalStrictJsonDigest({
						requestDigest: empiricalStrictJsonDigest(request),
						cancelledAfterEffect: effectRequest.requestDigest,
					}),
				);
				cancellationRequested = true;
			}
		}
		const runtimeEvidence = snapshotD720GraphEffectEvidence(
			runtime,
			cancellationRequested ? "cancelled" : effectBoundExhausted ? "stopped" : "complete",
		);
		effectEvidence.push(runtimeEvidence);
		if (
			!runtimeEvidence.facts.some(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.result.effectKind === "materialization",
			)
		) {
			admitD719CleanGraphCancellation(ledger, request);
			break;
		}
		const decision = admitD719CleanGraphArmResult(
			ledger,
			request,
			deriveD720GraphArmResult(runtime),
		);
		if (decision.disposition === "stop") break;
	}
	if (takeNextD719CleanGraphRequest(ledger) !== null) {
		throw new TypeError("D720 six-arm bound ended while Graph still exposed work");
	}
	const ledgerEvidence = validateD719CleanGraphEvidence(snapshotD719CleanGraphEvidence(ledger));
	const graphEvidenceMaterial = strictSnapshot({
		schemaVersion: D720_CANONICAL_GRAPH_EVIDENCE_SCHEMA,
		ledger: ledgerEvidence,
		effectRuns: Object.freeze(effectEvidence),
		findings: ledgerEvidence.findings,
		runStatus: ledgerEvidence.runStatus,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const graphEvidence = Object.freeze({
		...graphEvidenceMaterial,
		evidenceDigest: empiricalStrictJsonDigest(graphEvidenceMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D720_GRAPH_NATIVE_EVAL_BUNDLE_SCHEMA,
		evalRevision: D720_GRAPH_NATIVE_EVAL_REVISION,
		executionClass: "simulated-contract" as const,
		graphEvidence,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		findingsDigest: empiricalStrictJsonDigest(graphEvidence.findings),
		runStatus: ledgerEvidence.runStatus,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	constructedBundles.add(bundle);
	return bundle;
}

export async function runD722GraphNativeEvalCore(inputValue: {
	readonly sourceDigest: string;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly effectCeilings: D720EffectCeilingsV2;
	readonly executor: D720CallerExecutorV2;
	readonly signal?: AbortSignal;
}): Promise<D722GraphNativeEvalCoreV1> {
	const input = record(inputValue, "d722.coreRun");
	exactKeys(
		input,
		Object.hasOwn(input, "signal")
			? ["budgetLimits", "effectCeilings", "executor", "signal", "sourceDigest"]
			: ["budgetLimits", "effectCeilings", "executor", "sourceDigest"],
		"d722.coreRun",
	);
	const sourceDigest = digest(input.sourceDigest, "d722.coreRun.sourceDigest");
	const executor = executorState(input.executor);
	const effectCeilings = validateEffectCeilings(input.effectCeilings);
	if (Object.hasOwn(input, "signal") && !(input.signal instanceof AbortSignal))
		throw new TypeError("D722 signal is invalid");
	const signal = input.signal as AbortSignal | undefined;
	const completionContextPolicy = createD722GraphCompletionContextPolicy();
	const ledger = createD719CleanGraphLedger({
		sourceDigest,
		budgetLimits: input.budgetLimits as D719CleanBudgetLimitsV1,
	});
	const effectRuns: D722GraphEffectEvidenceV1[] = [];
	for (let runCount = 0; runCount < 12; runCount += 1) {
		const request = takeNextD719CleanGraphRequest(ledger);
		if (request === null) break;
		const effects = createD719CleanEffectController(ledger, request);
		const runtime = createD722GraphEffectRuntime({
			request,
			runSequence: runCount,
			completionContextPolicy,
			budgetContext: {
				limits: input.budgetLimits as D719CleanBudgetLimitsV1,
				initialState: snapshotD719CleanGraphBudgetState(ledger),
				providerMaxCostMicrousd: effectCeilings.providerMaxCostMicrousd,
				providerMaxElapsedMs: effectCeilings.providerMaxElapsedMs,
			},
		});
		if (signalIsAborted(signal)) {
			admitD720GraphCancellation(
				runtime,
				empiricalStrictJsonDigest({
					requestDigest: empiricalStrictJsonDigest(request),
					cancelled: true,
				}),
			);
			effectRuns.push(snapshotD722GraphEffectEvidence(runtime, "cancelled"));
			admitD719CleanGraphCancellation(ledger, request);
			break;
		}
		let cancellationRequested = false;
		let effectBoundExhausted = false;
		for (let effectCount = 0; effectCount < 512; effectCount += 1) {
			if (
				!cancellationRequested &&
				signalIsAborted(signal) &&
				nextD720GraphEffectDecision(runtime).disposition !== "complete-arm"
			) {
				admitD720GraphCancellation(
					runtime,
					empiricalStrictJsonDigest({
						requestDigest: empiricalStrictJsonDigest(request),
						cancelledBeforeEffect: effectCount,
					}),
				);
				cancellationRequested = true;
			}
			let graphDecision = nextD720GraphEffectDecision(runtime);
			if (graphDecision.disposition === "complete-arm") break;
			if (effectCount === 509 && graphDecision.effectRequest?.effectKind !== "cleanup") {
				admitD720GraphEffectBoundExhaustion(
					runtime,
					empiricalStrictJsonDigest({
						requestDigest: empiricalStrictJsonDigest(request),
						effectBound: 512,
					}),
				);
				effectBoundExhausted = true;
				graphDecision = nextD720GraphEffectDecision(runtime);
				if (graphDecision.disposition === "complete-arm") break;
			}
			const effectRequest = graphDecision.effectRequest;
			if (effectRequest === null) throw new TypeError("D722 Graph effect request is missing");
			const reservation = reservationFor(effectRequest, effectCeilings);
			const admission = requestD719CleanGraphEffect(effects, reservation);
			if (!admission.admitted) {
				admitD722GraphEffectResult(
					runtime,
					effectRequest,
					failedEffectResult(effectRequest, "graph-admission-denied"),
					admission.decisionDigest,
					{ actualCostMicrousd: 0, actualElapsedMs: 0 },
				);
				continue;
			}
			let rawExecution: D720CallerEffectExecutionV2;
			try {
				rawExecution = await executor.execute(
					Object.freeze(
						signal === undefined ||
							(cancellationRequested && effectRequest.effectKind === "cleanup")
							? { admission, effectRequest, request }
							: { admission, effectRequest, request, signal },
					),
				);
			} catch {
				reconcileD719CleanGraphEffectConservatively(effects, admission);
				admitD722GraphEffectResult(
					runtime,
					effectRequest,
					failedEffectResult(effectRequest, "executor-threw"),
					admission.decisionDigest,
					{
						actualCostMicrousd: reservation.maxCostMicrousd,
						actualElapsedMs: reservation.maxElapsedMs,
					},
				);
				if (!cancellationRequested && signalIsAborted(signal)) {
					admitD720GraphCancellation(
						runtime,
						empiricalStrictJsonDigest({
							requestDigest: empiricalStrictJsonDigest(request),
							cancelledAfterExecutorFailure: effectRequest.requestDigest,
						}),
					);
					cancellationRequested = true;
				}
				continue;
			}
			let execution: D720CallerEffectExecutionV2;
			try {
				const envelope = validateExecutedEffect(rawExecution);
				execution = Object.freeze({
					...envelope,
					result: validateD720GraphEffectResult(envelope.result, effectRequest),
				});
			} catch {
				reconcileD719CleanGraphEffectConservatively(effects, admission);
				admitD722GraphEffectResult(
					runtime,
					effectRequest,
					failedEffectResult(effectRequest, "invalid-executor-result"),
					admission.decisionDigest,
					{
						actualCostMicrousd: reservation.maxCostMicrousd,
						actualElapsedMs: reservation.maxElapsedMs,
					},
				);
				if (!cancellationRequested && signalIsAborted(signal)) {
					admitD720GraphCancellation(
						runtime,
						empiricalStrictJsonDigest({
							requestDigest: empiricalStrictJsonDigest(request),
							cancelledAfterInvalidExecutorResult: effectRequest.requestDigest,
						}),
					);
					cancellationRequested = true;
				}
				continue;
			}
			const retryable =
				execution.result.effectKind === "provider-request" &&
				execution.result.status === "retryable-failure";
			reconcileD719CleanGraphEffect(effects, admission, {
				actualCostMicrousd: execution.actualCostMicrousd,
				actualElapsedMs: execution.actualElapsedMs,
				outcome:
					execution.result.effectKind === "provider-request" &&
					(execution.result.status === "terminal-failure" || retryable)
						? "failed"
						: "completed",
				failureDiscriminator:
					execution.result.effectKind === "provider-request" &&
					execution.result.status === "retryable-failure"
						? execution.result.failureDiscriminator
						: "none",
			});
			admitD722GraphEffectResult(
				runtime,
				effectRequest,
				execution.result,
				admission.decisionDigest,
				{
					actualCostMicrousd: execution.actualCostMicrousd,
					actualElapsedMs: execution.actualElapsedMs,
				},
			);
			if (signalIsAborted(signal) && !cancellationRequested) {
				admitD720GraphCancellation(
					runtime,
					empiricalStrictJsonDigest({
						requestDigest: empiricalStrictJsonDigest(request),
						cancelledAfterEffect: effectRequest.requestDigest,
					}),
				);
				cancellationRequested = true;
			}
		}
		const runtimeEvidence = snapshotD722GraphEffectEvidence(
			runtime,
			cancellationRequested ? "cancelled" : effectBoundExhausted ? "stopped" : "complete",
		);
		effectRuns.push(runtimeEvidence);
		if (
			!runtimeEvidence.facts.some(
				(fact) =>
					fact.kind === "graph-effect-result-admitted" &&
					fact.result.effectKind === "materialization",
			)
		) {
			admitD719CleanGraphCancellation(ledger, request);
			break;
		}
		const decision = admitD719CleanGraphArmResult(
			ledger,
			request,
			deriveD720GraphArmResult(runtime),
		);
		if (decision.disposition === "stop") break;
	}
	if (takeNextD719CleanGraphRequest(ledger) !== null)
		throw new TypeError("D722 six-arm bound ended while Graph still exposed work");
	return Object.freeze({
		ledger: validateD719CleanGraphEvidence(snapshotD719CleanGraphEvidence(ledger)),
		effectRuns: Object.freeze(effectRuns),
	});
}

export function validateD720CanonicalGraphEvidence(value: unknown): D720CanonicalGraphEvidenceV1 {
	const candidate = record(value, "d720.graphEvidence");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"effectRuns",
			"efficacyClaim",
			"evidenceDigest",
			"findings",
			"ledger",
			"runStatus",
			"schemaVersion",
		],
		"d720.graphEvidence",
	);
	const ledger = validateD719CleanGraphEvidence(candidate.ledger);
	if (!Array.isArray(candidate.effectRuns) || candidate.effectRuns.length > 12)
		throw new TypeError("D720 Graph effect-run bound exceeded");
	const rawRuns = array(candidate.effectRuns, "d720.graphEvidence.effectRuns");
	if (rawRuns.length !== ledger.issuedRequests.length || rawRuns.length > 12)
		throw new TypeError("D720 Graph effect runs do not cover the ledger");
	const effectRuns = Object.freeze(
		rawRuns.map((run, index) => {
			const request = ledger.issuedRequests[index];
			if (request === undefined) throw new TypeError("D720 Graph-issued request is missing");
			return validateD720GraphEffectEvidence(run, request, index);
		}),
	);
	if (!Array.isArray(candidate.findings) || candidate.findings.length > 12)
		throw new TypeError("D720 Graph finding bound exceeded");
	for (const [index, rawFinding] of candidate.findings.entries()) {
		const finding = record(rawFinding, `d720.graphEvidence.findings[${index}]`);
		if (Object.keys(finding).some((key) => key.length > 128))
			throw new TypeError("D720 Graph finding contains an oversized field name");
		exactKeys(
			finding,
			[
				"arm",
				"armSequence",
				"code",
				"disposition",
				"evidenceRefs",
				"findingDigest",
				"kind",
				"nextRequiredPhase",
				"phase",
				"runKind",
				"runSequence",
			],
			`d720.graphEvidence.findings[${index}]`,
		);
		if (!Array.isArray(finding.evidenceRefs) || finding.evidenceRefs.length > 64)
			throw new TypeError("D720 Graph finding evidence-ref bound exceeded");
		for (const [refIndex, ref] of finding.evidenceRefs.entries())
			digest(ref, `d720.graphEvidence.findings[${index}].evidenceRefs[${refIndex}]`);
		for (const key of [
			"arm",
			"code",
			"disposition",
			"kind",
			"nextRequiredPhase",
			"phase",
			"runKind",
		])
			if (typeof finding[key] !== "string" || finding[key].length > 128)
				throw new TypeError("D720 Graph finding coordinate is unbounded");
		safeInteger(finding.armSequence, `d720.graphEvidence.findings[${index}].armSequence`, {
			min: 0,
			max: 5,
		});
		safeInteger(finding.runSequence, `d720.graphEvidence.findings[${index}].runSequence`, {
			min: 0,
			max: 11,
		});
		digest(finding.findingDigest, `d720.graphEvidence.findings[${index}].findingDigest`);
	}
	const findings = strictSnapshot(candidate.findings);
	if (
		candidate.schemaVersion !== D720_CANONICAL_GRAPH_EVIDENCE_SCHEMA ||
		candidate.runStatus !== ledger.runStatus ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none" ||
		empiricalStrictJsonDigest(findings) !== empiricalStrictJsonDigest(ledger.findings)
	)
		throw new TypeError("D720 canonical Graph evidence coordinates drifted");
	const material = strictSnapshot({
		schemaVersion: D720_CANONICAL_GRAPH_EVIDENCE_SCHEMA,
		ledger,
		effectRuns,
		findings: ledger.findings,
		runStatus: ledger.runStatus,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const evidenceDigest = digest(candidate.evidenceDigest, "d720.graphEvidence.evidenceDigest");
	if (evidenceDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D720 canonical Graph evidence digest mismatch");
	return Object.freeze({ ...material, evidenceDigest });
}

export function validateD720GraphNativeEvalBundle(value: unknown): D720GraphNativeEvalBundleV1 {
	const candidate = record(value, "d720.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"efficacyClaim",
			"evalRevision",
			"executionClass",
			"findingsDigest",
			"graphEvidence",
			"graphEvidenceDigest",
			"runStatus",
			"schemaVersion",
		],
		"d720.bundle",
	);
	const graphEvidence = validateD720CanonicalGraphEvidence(candidate.graphEvidence);
	const ledgerEvidence = graphEvidence.ledger;
	const effectEvidence = graphEvidence.effectRuns;
	if (effectEvidence.length !== ledgerEvidence.issuedRequests.length)
		throw new TypeError("D720 bundle effect evidence does not cover every Graph-issued run");
	for (const [runIndex, run] of effectEvidence.entries()) {
		const issuedRequest = ledgerEvidence.issuedRequests[runIndex];
		const armFact = ledgerEvidence.facts[runIndex];
		if (issuedRequest === undefined || armFact === undefined)
			throw new TypeError("D720 Graph arm provenance is incomplete");
		const effectFacts = run.facts.filter((fact) => fact.kind === "graph-effect-result-admitted");
		const expectedRuntimeStatus = armFact.execution.cancelled
			? "cancelled"
			: run.facts.some((fact) => fact.kind === "graph-effect-bound-exhausted")
				? "stopped"
				: "complete";
		if (run.runtimeStatus !== expectedRuntimeStatus)
			throw new TypeError("D720 runtime status contradicts its Graph arm fact");
		if (armFact.materialization.status === "unknown") {
			if (
				effectFacts.length !== 0 ||
				run.runtimeStatus !== "cancelled" ||
				run.facts.length !== 1 ||
				run.facts[0]?.kind !== "graph-cancellation-admitted" ||
				!armFact.execution.cancelled ||
				armFact.cleanup.status !== "unknown"
			)
				throw new TypeError("D720 pre-execution cancellation provenance drifted");
		} else {
			const derivedArmResult = deriveD720GraphArmResultFromEvidence(run, issuedRequest, runIndex);
			if (
				empiricalStrictJsonDigest(derivedArmResult.materialization) !==
					empiricalStrictJsonDigest(armFact.materialization) ||
				empiricalStrictJsonDigest(derivedArmResult.execution) !==
					empiricalStrictJsonDigest(armFact.execution) ||
				empiricalStrictJsonDigest(derivedArmResult.cleanup) !==
					empiricalStrictJsonDigest(armFact.cleanup)
			)
				throw new TypeError("D720 runtime projection contradicts the D719 Graph arm fact");
		}
		const runProposals = ledgerEvidence.effectProposals.filter(
			(proposal) => proposal.issuedRequestDigest === run.issuedRequestDigest,
		);
		if (effectFacts.length !== runProposals.length)
			throw new TypeError("D720 runtime/D719 effect fact cardinality drifted");
		for (const fact of effectFacts) {
			const admission = ledgerEvidence.effectAdmissions.find(
				(candidate) => candidate.decisionDigest === fact.admissionDigest,
			);
			const proposal =
				admission === undefined
					? undefined
					: ledgerEvidence.effectProposals.find(
							(candidate) => candidate.effectSequence === admission.effectSequence,
						);
			if (
				admission === undefined ||
				proposal === undefined ||
				proposal.issuedRequestDigest !== run.issuedRequestDigest ||
				proposal.effectKind !== fact.request.effectKind ||
				proposal.logicalRequestDigest !== fact.request.logicalRequestDigest ||
				proposal.attemptOrdinal !== fact.request.attemptOrdinal ||
				proposal.retryReason !== fact.request.retryReason ||
				proposal.retryAfterMs !== fact.request.retryAfterMs
			)
				throw new TypeError("D720 effect fact is not bound to the D719 Graph admission");
			const reconciliation = ledgerEvidence.effectReconciliations.find(
				(candidate) => candidate.effectSequence === admission.effectSequence,
			);
			if (admission.admitted !== (reconciliation !== undefined))
				throw new TypeError("D720 effect admission/reconciliation coverage drifted");
			const failed =
				(fact.result.effectKind === "materialization" && fact.result.status === "failed") ||
				(fact.result.effectKind === "provider-request" &&
					fact.result.status === "terminal-failure") ||
				(fact.result.effectKind === "retry-wait" && fact.result.status === "failed") ||
				(fact.result.effectKind === "tool-action" && fact.result.status === "failed") ||
				(fact.result.effectKind === "hidden-verifier" && fact.result.status === "failed") ||
				(fact.result.effectKind === "cleanup" && fact.result.status === "failed");
			if (!admission.admitted && !failed)
				throw new TypeError("D720 denied effect was represented as successful execution");
			if (reconciliation?.basis === "conservative-reservation" && !failed)
				throw new TypeError("D720 conservative reconciliation lacks a failed runtime fact");
			if (reconciliation?.basis === "measured") {
				const expectedOutcome =
					fact.result.effectKind === "provider-request" &&
					fact.result.status === "retryable-failure"
						? "retryable-failure"
						: fact.result.effectKind === "provider-request" &&
								fact.result.status === "terminal-failure"
							? "terminal-failure"
							: "completed";
				const expectedDiscriminator =
					fact.result.effectKind === "provider-request" &&
					fact.result.status === "retryable-failure"
						? fact.result.failureDiscriminator
						: "none";
				if (
					reconciliation.outcome !== expectedOutcome ||
					reconciliation.failureDiscriminator !== expectedDiscriminator
				)
					throw new TypeError("D720 measured reconciliation contradicts its runtime fact");
			}
		}
		for (const proposal of runProposals) {
			const admission = ledgerEvidence.effectAdmissions.find(
				(candidate) => candidate.effectSequence === proposal.effectSequence,
			);
			if (
				admission === undefined ||
				effectFacts.filter((fact) => fact.admissionDigest === admission.decisionDigest).length !== 1
			)
				throw new TypeError("D720 D719 effect proposal lacks one exact runtime fact");
		}
	}
	const snapshot = strictSnapshot({
		...candidate,
		graphEvidence,
	}) as unknown as D720GraphNativeEvalBundleV1;
	if (
		snapshot.schemaVersion !== D720_GRAPH_NATIVE_EVAL_BUNDLE_SCHEMA ||
		snapshot.evalRevision !== D720_GRAPH_NATIVE_EVAL_REVISION ||
		snapshot.executionClass !== "simulated-contract" ||
		snapshot.causalAttribution !== "undetermined" ||
		snapshot.efficacyClaim !== "none" ||
		snapshot.runStatus !== graphEvidence.runStatus
	) {
		throw new TypeError("D720 bundle coordinates drifted");
	}
	if (
		snapshot.graphEvidenceDigest !== graphEvidence.evidenceDigest ||
		snapshot.findingsDigest !== empiricalStrictJsonDigest(graphEvidence.findings)
	) {
		throw new TypeError("D720 bundle does not bind its Graph evidence");
	}
	digest(snapshot.bundleDigest, "d720.bundle.bundleDigest");
	const material = strictSnapshot({
		schemaVersion: snapshot.schemaVersion,
		evalRevision: snapshot.evalRevision,
		executionClass: snapshot.executionClass,
		graphEvidence,
		graphEvidenceDigest: snapshot.graphEvidenceDigest,
		findingsDigest: snapshot.findingsDigest,
		runStatus: snapshot.runStatus,
		causalAttribution: snapshot.causalAttribution,
		efficacyClaim: snapshot.efficacyClaim,
	});
	if (snapshot.bundleDigest !== empiricalStrictJsonDigest(material)) {
		throw new TypeError("D720 bundle digest mismatch");
	}
	return snapshot;
}

async function assertPrivateRoot(privateRoot: string): Promise<string> {
	if (typeof privateRoot !== "string" || privateRoot.length === 0) {
		throw new TypeError("D720 privateRoot is invalid");
	}
	const absolute = resolve(privateRoot);
	if (absolute !== privateRoot)
		throw new TypeError("D720 privateRoot must be absolute and canonical");
	const stat = await lstat(absolute);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
		throw new TypeError("D720 privateRoot must be a real 0700 directory");
	}
	if ((await realpath(absolute)) !== absolute) {
		throw new TypeError("D720 privateRoot realpath drifted");
	}
	return absolute;
}

function validateBundleRef(value: unknown): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 96 ||
		!/^d720-[a-z0-9][a-z0-9-]*$/.test(value)
	) {
		throw new TypeError("D720 bundleRef is invalid");
	}
	return value;
}

async function writeCanonical(
	path: string,
	bytes: Uint8Array,
): Promise<{ readonly dev: number; readonly ino: number }> {
	const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)
			throw new TypeError("D720 canonical artifact is not an owned 0600 regular file");
		await handle.writeFile(bytes);
		await handle.sync();
		return { dev: stat.dev, ino: stat.ino };
	} finally {
		await handle.close();
	}
}

async function assertCanonicalFile(
	path: string,
	identity: { readonly dev: number; readonly ino: number },
	expectedBytes: Uint8Array,
): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		const actual = await handle.readFile();
		if (
			!stat.isFile() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.dev !== identity.dev ||
			stat.ino !== identity.ino ||
			!sameBytes(actual, expectedBytes)
		)
			throw new TypeError("D720 canonical file identity/readback drifted");
	} finally {
		await handle.close();
	}
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function cleanupOrAggregate(path: string, error: unknown, label: string): Promise<never> {
	try {
		await rm(path, { recursive: true, force: true });
	} catch (cleanupError) {
		throw new AggregateError([error, cleanupError], label);
	}
	throw error;
}

export async function persistD720GraphNativeEvalBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundleRef: string;
	readonly bundle: D720GraphNativeEvalBundleV1;
}): Promise<D720PersistedBundleReceiptV1> {
	const input = record(inputValue, "d720.persist");
	exactKeys(input, ["bundle", "bundleRef", "privateRoot"], "d720.persist");
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.has(input.bundle)
	) {
		throw new TypeError("D720 persistence requires a same-process constructed bundle");
	}
	const bundle = validateD720GraphNativeEvalBundle(input.bundle);
	const bundleRef = validateBundleRef(input.bundleRef);
	const privateRoot = await assertPrivateRoot(input.privateRoot as string);
	const finalRoot = join(privateRoot, bundleRef);
	const privateRootStat = await lstat(privateRoot);
	try {
		await mkdir(finalRoot, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new TypeError("D720 bundle already exists");
		}
		throw error;
	}
	const stagingRoot = join(finalRoot, `.d720-staging-${randomUUID()}`);
	const artifactsRoot = join(finalRoot, "artifacts");
	let graphBytes: Uint8Array;
	let findingsBytes: Uint8Array;
	let bundleBytes: Uint8Array;
	let claimedRootIdentity: { readonly dev: number; readonly ino: number } | null = null;
	let stagingIdentity: { readonly dev: number; readonly ino: number } | null = null;
	const artifactIdentities = new Map<string, { readonly dev: number; readonly ino: number }>();
	let commitIdentity: { readonly dev: number; readonly ino: number } | null = null;
	try {
		const claimedRootStat = await lstat(finalRoot);
		claimedRootIdentity = { dev: claimedRootStat.dev, ino: claimedRootStat.ino };
		const claimedPrivateRootStat = await lstat(privateRoot);
		if (
			!claimedRootStat.isDirectory() ||
			claimedRootStat.isSymbolicLink() ||
			(claimedRootStat.mode & 0o777) !== 0o700 ||
			claimedPrivateRootStat.dev !== privateRootStat.dev ||
			claimedPrivateRootStat.ino !== privateRootStat.ino ||
			(await realpath(privateRoot)) !== privateRoot ||
			(await realpath(finalRoot)) !== finalRoot
		) {
			throw new TypeError("D720 persistence ownership drifted after exclusive claim");
		}
		await mkdir(stagingRoot, { mode: 0o700 });
		const stagingStat = await lstat(stagingRoot);
		if (!stagingStat.isDirectory() || stagingStat.isSymbolicLink())
			throw new TypeError("D720 staging root is not an owned directory");
		stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		graphBytes = strictJsonCodec.encode(bundle.graphEvidence);
		findingsBytes = strictJsonCodec.encode(bundle.graphEvidence.findings);
		bundleBytes = strictJsonCodec.encode(bundle);
		for (const [name, bytes] of [
			["graph-evidence.v2.json", graphBytes],
			["harness-findings.v2.json", findingsBytes],
			["eval-bundle.v2.json", bundleBytes],
		] as const)
			artifactIdentities.set(name, await writeCanonical(join(stagingRoot, name), bytes));
		await syncDirectory(stagingRoot);
		for (const [name, expected] of [
			["graph-evidence.v2.json", graphBytes],
			["harness-findings.v2.json", findingsBytes],
			["eval-bundle.v2.json", bundleBytes],
		] as const) {
			const artifactPath = join(stagingRoot, name);
			const identity = artifactIdentities.get(name);
			if (identity === undefined) throw new TypeError(`D720 ${name} identity is missing`);
			await assertCanonicalFile(artifactPath, identity, expected);
		}
		const beforeCommitRootStat = await lstat(privateRoot);
		const beforeCommitClaimStat = await lstat(finalRoot);
		const beforeCommitStagingStat = await lstat(stagingRoot);
		if (
			beforeCommitRootStat.dev !== privateRootStat.dev ||
			beforeCommitRootStat.ino !== privateRootStat.ino ||
			(await realpath(finalRoot)) !== finalRoot ||
			beforeCommitClaimStat.dev !== claimedRootIdentity.dev ||
			beforeCommitClaimStat.ino !== claimedRootIdentity.ino ||
			stagingIdentity === null ||
			beforeCommitStagingStat.dev !== stagingIdentity.dev ||
			beforeCommitStagingStat.ino !== stagingIdentity.ino ||
			(await realpath(stagingRoot)) !== stagingRoot
		) {
			throw new TypeError("D720 persistence ownership drifted before commit");
		}
		await rename(stagingRoot, artifactsRoot);
		const committedArtifactsStat = await lstat(artifactsRoot);
		const afterRenameClaimStat = await lstat(finalRoot);
		if (
			committedArtifactsStat.dev !== stagingIdentity.dev ||
			committedArtifactsStat.ino !== stagingIdentity.ino ||
			afterRenameClaimStat.dev !== claimedRootIdentity.dev ||
			afterRenameClaimStat.ino !== claimedRootIdentity.ino ||
			(await realpath(finalRoot)) !== finalRoot
		)
			throw new TypeError("D720 persistence ownership drifted during artifact commit");
		for (const [name, identity] of artifactIdentities) {
			const artifactStat = await lstat(join(artifactsRoot, name));
			if (
				!artifactStat.isFile() ||
				artifactStat.isSymbolicLink() ||
				(artifactStat.mode & 0o777) !== 0o600 ||
				artifactStat.nlink !== 1 ||
				artifactStat.dev !== identity.dev ||
				artifactStat.ino !== identity.ino
			)
				throw new TypeError("D720 committed artifact identity drifted");
		}
		await syncDirectory(finalRoot);
		const commitBytes = strictJsonCodec.encode(
			strictSnapshot({
				schemaVersion: "graphrefly.b112.d720.graph-native-commit.v2",
				bundleDigest: bundle.bundleDigest,
				artifactsDirectory: "artifacts",
			}),
		);
		const beforeMarkerClaimStat = await lstat(finalRoot);
		if (
			beforeMarkerClaimStat.dev !== claimedRootIdentity.dev ||
			beforeMarkerClaimStat.ino !== claimedRootIdentity.ino ||
			(await realpath(finalRoot)) !== finalRoot
		)
			throw new TypeError("D720 persistence ownership drifted before commit marker");
		commitIdentity = await writeCanonical(join(finalRoot, "commit.v2.json"), commitBytes);
		await syncDirectory(finalRoot);
		const afterMarkerClaimStat = await lstat(finalRoot);
		if (
			afterMarkerClaimStat.dev !== claimedRootIdentity.dev ||
			afterMarkerClaimStat.ino !== claimedRootIdentity.ino ||
			(await realpath(finalRoot)) !== finalRoot
		)
			throw new TypeError("D720 persistence ownership drifted after commit marker");
		if (commitIdentity === null) throw new TypeError("D720 commit marker identity is missing");
		await assertCanonicalFile(join(finalRoot, "commit.v2.json"), commitIdentity, commitBytes);
		const currentPrivateRootStat = await lstat(privateRoot);
		if (
			currentPrivateRootStat.dev !== privateRootStat.dev ||
			currentPrivateRootStat.ino !== privateRootStat.ino ||
			(await realpath(privateRoot)) !== privateRoot
		) {
			throw new TypeError("D720 privateRoot identity drifted during persistence");
		}
		const stableParentHandle = await open(privateRoot, constants.O_RDONLY);
		try {
			const stableParentStat = await stableParentHandle.stat();
			if (
				stableParentStat.dev !== privateRootStat.dev ||
				stableParentStat.ino !== privateRootStat.ino
			)
				throw new TypeError("D720 parent handle identity drifted");
			await stableParentHandle.sync();
			const afterSyncParentStat = await lstat(privateRoot);
			if (
				afterSyncParentStat.dev !== privateRootStat.dev ||
				afterSyncParentStat.ino !== privateRootStat.ino ||
				(await realpath(privateRoot)) !== privateRoot
			)
				throw new TypeError("D720 parent path identity drifted after sync");
		} finally {
			await stableParentHandle.close();
		}
		const finalSuccessStat = await lstat(finalRoot);
		const finalCommitStat = await lstat(join(finalRoot, "commit.v2.json"));
		if (
			finalSuccessStat.dev !== claimedRootIdentity.dev ||
			finalSuccessStat.ino !== claimedRootIdentity.ino ||
			commitIdentity === null ||
			finalCommitStat.dev !== commitIdentity.dev ||
			finalCommitStat.ino !== commitIdentity.ino ||
			(await realpath(finalRoot)) !== finalRoot
		)
			throw new TypeError("D720 final generation identity drifted before success");
		const expectedArtifactBytes = new Map<string, Uint8Array>([
			["graph-evidence.v2.json", graphBytes],
			["harness-findings.v2.json", findingsBytes],
			["eval-bundle.v2.json", bundleBytes],
		]);
		for (const [name, identity] of artifactIdentities) {
			const expectedBytes = expectedArtifactBytes.get(name);
			if (expectedBytes === undefined) throw new TypeError("D720 final artifact bytes are missing");
			await assertCanonicalFile(join(artifactsRoot, name), identity, expectedBytes);
		}
		await assertCanonicalFile(join(finalRoot, "commit.v2.json"), commitIdentity, commitBytes);
	} catch (error) {
		const cleanupRootStat = await lstat(privateRoot).catch(() => null);
		const cleanupClaimStat = await lstat(finalRoot).catch(() => null);
		if (
			cleanupRootStat === null ||
			cleanupRootStat.dev !== privateRootStat.dev ||
			cleanupRootStat.ino !== privateRootStat.ino ||
			claimedRootIdentity === null ||
			cleanupClaimStat === null ||
			cleanupClaimStat.dev !== claimedRootIdentity.dev ||
			cleanupClaimStat.ino !== claimedRootIdentity.ino
		) {
			throw new AggregateError(
				[error, new TypeError("D720 cleanup refused after privateRoot identity drift")],
				"D720 exclusive generation ownership lost",
			);
		}
		return cleanupOrAggregate(finalRoot, error, "D720 exclusive generation cleanup failed");
	}
	const material = strictSnapshot({
		schemaVersion: D720_GRAPH_NATIVE_PERSISTENCE_SCHEMA,
		bundleRef,
		graphEvidenceArtifactDigest: empiricalSha256(graphBytes),
		findingsArtifactDigest: empiricalSha256(findingsBytes),
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
	});
	return Object.freeze({ ...material, persistenceDigest: empiricalStrictJsonDigest(material) });
}
