import type { AgentRequestIssued } from "../../src/orchestration/agent-runtime.js";
import { empiricalStrictJsonDigest, exactKeys, record, strictSnapshot } from "./canonical.js";
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
} from "./d767-clean-graph-ledger.js";
import {
	admitD720GraphCancellation,
	admitD720GraphEffectBoundExhaustion,
	admitD722GraphEffectResult,
	createD722GraphCompletionContextPolicy,
	createD722GraphEffectRuntime,
	type D720EffectResultV1,
	type D720ExecutorFailureClassificationV1,
	type D720GraphEffectRequestV1,
	type D722GraphEffectEvidenceV1,
	type D726ArmLocalTerminalProviderPolicyV1,
	type D737GraphObjectivePhaseRecoveryPolicyV1,
	deriveD720GraphArmResult,
	nextD720GraphEffectDecision,
	snapshotD722GraphEffectEvidence,
} from "./d767-graph-native-effect-runtime.js";
import type {
	D720CallerEffectExecutionInputV2,
	D720EffectCeilingsV2,
} from "./d767-graph-native-eval.js";
import {
	createD776RouteAuthority,
	type D776ProviderResultEnvelopeV1,
	type D776RouteEvidenceV1,
	validateD776ProviderResultEnvelope,
} from "./d776-provider-result-route-authority.js";

export const D776_GRAPH_NATIVE_CORE_REVISION =
	"graphrefly.b112.d776.provider-envelope-graph-core.v1" as const;

export interface D776CallerExecutorV1 {
	readonly revision: "graphrefly.b112.d776.caller-executor.v1";
	readonly execute: (
		input: D720CallerEffectExecutionInputV2,
	) => Promise<D776ProviderResultEnvelopeV1>;
}

export interface D776GraphNativeCoreV1 {
	readonly ledger: D719CleanGraphEvidenceV1;
	readonly effectRuns: readonly D722GraphEffectEvidenceV1[];
	readonly routeEvidence: D776RouteEvidenceV1;
}

function validateExecutor(value: unknown): D776CallerExecutorV1 {
	const candidate = record(value, "d776.executor");
	exactKeys(candidate, ["execute", "revision"], "d776.executor");
	if (candidate.revision !== "graphrefly.b112.d776.caller-executor.v1")
		throw new TypeError("D776 executor revision drifted");
	const descriptor = Object.getOwnPropertyDescriptor(candidate, "execute");
	if (
		descriptor === undefined ||
		!("value" in descriptor) ||
		typeof descriptor.value !== "function" ||
		!descriptor.enumerable
	)
		throw new TypeError("D776 executor must expose one own immutable execution function");
	return candidate as unknown as D776CallerExecutorV1;
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

function failedEffectResult(
	request: D720GraphEffectRequestV1,
	cause: D720ExecutorFailureClassificationV1,
): D720EffectResultV1 {
	const evidenceDigest = empiricalStrictJsonDigest({ requestDigest: request.requestDigest, cause });
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
			failureProvenance: "executor-failure",
			executorFailureClassification: cause,
			retryAfterMs: null,
			workspaceStateDigest:
				request.workspaceStateDigest ??
				empiricalStrictJsonDigest({ unavailable: request.requestDigest }),
			evidenceDigest,
		});
	if (request.effectKind === "retry-wait")
		return Object.freeze({ effectKind: "retry-wait", status: "failed", evidenceDigest });
	if (request.effectKind === "tool-action") {
		if (request.toolIntent === null) throw new TypeError("D776 failed tool lacks Graph intent");
		const state =
			request.workspaceStateDigest ??
			empiricalStrictJsonDigest({ unavailable: request.requestDigest });
		return Object.freeze({
			effectKind: "tool-action",
			toolRef: request.toolIntent.toolRef,
			intentDigest: request.toolIntent.intentDigest,
			status: "failed",
			nonEmptyDiff: false,
			workspaceStateBeforeDigest: state,
			workspaceStateAfterDigest: state,
			evidenceDigest,
		});
	}
	if (request.effectKind === "public-semantic-validation")
		return Object.freeze({
			effectKind: "public-semantic-validation",
			status: "executor-failed",
			criterionFailures: Object.freeze([]),
			workspaceStateDigest:
				request.workspaceStateDigest ??
				empiricalStrictJsonDigest({ unavailable: request.requestDigest }),
			evidenceDigest,
		});
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

function signalIsAborted(signal: AbortSignal | undefined): boolean {
	return signal?.aborted === true;
}

export async function runD776GraphNativeEvalCore(inputValue: {
	readonly sourceDigest: string;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly effectCeilings: D720EffectCeilingsV2;
	readonly executor: D776CallerExecutorV1;
	readonly armLocalTerminalPolicy?: D726ArmLocalTerminalProviderPolicyV1;
	readonly objectivePhaseRecoveryPolicy?: D737GraphObjectivePhaseRecoveryPolicyV1;
	readonly signal?: AbortSignal;
}): Promise<D776GraphNativeCoreV1> {
	const input = record(inputValue, "d776.core");
	exactKeys(
		input,
		[
			"budgetLimits",
			"effectCeilings",
			"executor",
			"sourceDigest",
			...(Object.hasOwn(input, "armLocalTerminalPolicy")
				? ["armLocalTerminalPolicy" as const]
				: []),
			...(Object.hasOwn(input, "objectivePhaseRecoveryPolicy")
				? ["objectivePhaseRecoveryPolicy" as const]
				: []),
			...(Object.hasOwn(input, "signal") ? ["signal" as const] : []),
		],
		"d776.core",
	);
	const executor = validateExecutor(input.executor);
	const ceilings = strictSnapshot(input.effectCeilings) as unknown as D720EffectCeilingsV2;
	if (Object.hasOwn(input, "signal") && !(input.signal instanceof AbortSignal))
		throw new TypeError("D776 signal is invalid");
	const signal = input.signal as AbortSignal | undefined;
	const ledger = createD719CleanGraphLedger({
		sourceDigest: input.sourceDigest as string,
		budgetLimits: input.budgetLimits as D719CleanBudgetLimitsV1,
	});
	const routeAuthority = createD776RouteAuthority();
	const effectRuns: D722GraphEffectEvidenceV1[] = [];
	let providerResultCount = 0;
	for (let runCount = 0; runCount < 12; runCount += 1) {
		const request = takeNextD719CleanGraphRequest(ledger);
		if (request === null) break;
		const effects = createD719CleanEffectController(ledger, request);
		const runtime = createD722GraphEffectRuntime({
			request,
			runSequence: runCount,
			completionContextPolicy: createD722GraphCompletionContextPolicy(),
			budgetContext: {
				limits: input.budgetLimits as D719CleanBudgetLimitsV1,
				initialState: snapshotD719CleanGraphBudgetState(ledger),
				providerMaxCostMicrousd: ceilings.providerMaxCostMicrousd,
				providerMaxElapsedMs: ceilings.providerMaxElapsedMs,
				localEffectMaxElapsedMs: ceilings.localEffectMaxElapsedMs,
			},
			...(Object.hasOwn(input, "armLocalTerminalPolicy")
				? {
						armLocalTerminalPolicy:
							input.armLocalTerminalPolicy as D726ArmLocalTerminalProviderPolicyV1,
					}
				: {}),
			...(Object.hasOwn(input, "objectivePhaseRecoveryPolicy")
				? {
						objectivePhaseRecoveryPolicy:
							input.objectivePhaseRecoveryPolicy as D737GraphObjectivePhaseRecoveryPolicyV1,
					}
				: {}),
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
			let decision = nextD720GraphEffectDecision(runtime);
			if (decision.disposition === "complete-arm") break;
			if (effectCount === 509 && decision.effectRequest?.effectKind !== "cleanup") {
				admitD720GraphEffectBoundExhaustion(
					runtime,
					empiricalStrictJsonDigest({
						requestDigest: empiricalStrictJsonDigest(request),
						bound: 512,
					}),
				);
				effectBoundExhausted = true;
				decision = nextD720GraphEffectDecision(runtime);
				if (decision.disposition === "complete-arm") break;
			}
			const effectRequest = decision.effectRequest;
			if (effectRequest === null) throw new TypeError("D776 Graph effect request is missing");
			const reservation = reservationFor(effectRequest, ceilings);
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
			let envelope: D776ProviderResultEnvelopeV1;
			try {
				const raw = await executor.execute(
					Object.freeze(
						signal === undefined
							? { admission, effectRequest, request }
							: { admission, effectRequest, request, signal },
					),
				);
				envelope = validateD776ProviderResultEnvelope(raw, effectRequest, admission);
			} catch {
				const reconciliation = reconcileD719CleanGraphEffectConservatively(effects, admission);
				admitD722GraphEffectResult(
					runtime,
					effectRequest,
					failedEffectResult(effectRequest, "executor-threw"),
					admission.decisionDigest,
					{
						actualCostMicrousd: reconciliation.actualCostMicrousd,
						actualElapsedMs: reconciliation.actualElapsedMs,
					},
				);
				continue;
			}
			const execution = envelope.execution;
			const retryable =
				execution.result.effectKind === "provider-request" &&
				execution.result.status === "retryable-failure";
			const reconciliation =
				execution.usageBasis === "conservative-reservation"
					? reconcileD719CleanGraphEffectConservatively(effects, admission)
					: reconcileD719CleanGraphEffect(effects, admission, {
							actualCostMicrousd: execution.actualCostMicrousd,
							actualElapsedMs: execution.actualElapsedMs,
							outcome:
								execution.result.effectKind === "provider-request" &&
								(execution.result.status === "terminal-failure" || retryable)
									? "failed"
									: "completed",
							failureDiscriminator:
								execution.result.effectKind === "provider-request" && retryable
									? execution.result.failureDiscriminator
									: "none",
						});
			admitD722GraphEffectResult(
				runtime,
				effectRequest,
				execution.result,
				admission.decisionDigest,
				{
					actualCostMicrousd: reconciliation.actualCostMicrousd,
					actualElapsedMs: reconciliation.actualElapsedMs,
				},
			);
			if (effectRequest.effectKind === "provider-request") {
				const proposal = envelope.routeProposal;
				if (proposal === null) throw new TypeError("D776 provider result omitted route proposal");
				const resultFactMaterial = strictSnapshot({
					kind: "graph-effect-result-admitted" as const,
					request: effectRequest,
					admissionDigest: admission.decisionDigest,
					result: execution.result,
					resultDigest: empiricalStrictJsonDigest(execution.result),
					actualCostMicrousd: reconciliation.actualCostMicrousd,
					actualElapsedMs: reconciliation.actualElapsedMs,
				});
				routeAuthority.admit({
					proposal,
					request: effectRequest,
					admission,
					result: execution.result,
					resultFactDigest: empiricalStrictJsonDigest(resultFactMaterial),
					reconciliation,
				});
				providerResultCount += 1;
			}
			if (signalIsAborted(signal) && !cancellationRequested) {
				admitD720GraphCancellation(
					runtime,
					empiricalStrictJsonDigest({ cancelledAfterEffect: effectRequest.requestDigest }),
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
		const armDecision = admitD719CleanGraphArmResult(
			ledger,
			request,
			deriveD720GraphArmResult(runtime),
		);
		if (armDecision.disposition === "stop") break;
	}
	if (takeNextD719CleanGraphRequest(ledger) !== null)
		throw new TypeError("D776 six-arm bound ended while Graph still exposed work");
	return Object.freeze({
		ledger: validateD719CleanGraphEvidence(snapshotD719CleanGraphEvidence(ledger)),
		effectRuns: Object.freeze(effectRuns),
		routeEvidence: routeAuthority.snapshot(providerResultCount),
	});
}

export function createD776CallerExecutor(
	execute: (
		input: Readonly<{
			readonly request: AgentRequestIssued<D719CleanRequestInput>;
			readonly effectRequest: D720GraphEffectRequestV1;
			readonly admission: D719EffectAdmissionV1;
			readonly signal?: AbortSignal;
		}>,
	) => Promise<D776ProviderResultEnvelopeV1>,
): D776CallerExecutorV1 {
	if (typeof execute !== "function") throw new TypeError("D776 executor must be a function");
	return Object.freeze({
		revision: "graphrefly.b112.d776.caller-executor.v1" as const,
		execute,
	});
}
