import { empiricalStrictJsonDigest } from "./canonical.js";
import {
	type D45AdmittedEffectV1,
	type D45EffectResultInputV1,
	type D45GraphToolAuthorityV1,
	type D45LocalResultInputV1,
	readD45ToolArguments,
} from "./graph-tool-authority.js";
import {
	D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
	D45_PUBLIC_SEMANTIC_SCENARIOS,
	D45_READABLE_PATHS,
	D45_WRITABLE_PATH,
} from "./graph-tool-qualification.js";
import type { HarnessArm } from "./harness-campaign-policy.js";
import type { D44LiveExecutorV1 } from "./live-effect-executor.js";
import { D44_BUGGY_ADMISSION_BLOCK, D44_FIXED_ADMISSION_BLOCK } from "./live-effect-executor.js";
import { lowerD45ProviderEffect } from "./mechanical-chat-adapter.js";

export interface D65InjectedExecutorObservationV1 {
	readonly providerCalls: number;
	readonly maxActiveEffects: 1;
	readonly disposed: boolean;
}

export function createD65InjectedReplicateExecutor(input?: {
	readonly providerCostMicrousd?: number;
	readonly rejectArm?: HarnessArm;
	readonly providerFailureArm?: HarnessArm;
	readonly retryOnceDelayMs?: number;
	readonly failDispose?: boolean;
}): Readonly<{
	readonly executor: D44LiveExecutorV1;
	readonly observation: () => D65InjectedExecutorObservationV1;
}> {
	const workspaceStates = new Map<string, string>();
	const inspectionOrdinals = new Map<string, number>();
	let active = false;
	let disposed = false;
	let providerCalls = 0;
	let retryIssued = false;
	const providerCostMicrousd = input?.providerCostMicrousd ?? 1_000;
	if (!Number.isSafeInteger(providerCostMicrousd) || providerCostMicrousd < 0)
		throw new TypeError("D65 injected provider cost must be a non-negative safe integer");
	const retryOnceDelayMs = input?.retryOnceDelayMs ?? 0;
	if (!Number.isSafeInteger(retryOnceDelayMs) || retryOnceDelayMs < 0)
		throw new TypeError("D65 injected retry delay must be a non-negative safe integer");

	function stateFor(effect: D45AdmittedEffectV1): string {
		const state = workspaceStates.get(effect.arm);
		if (state === undefined) throw new TypeError("D65 injected workspace was not materialized");
		return state;
	}

	function localResult(
		effect: D45AdmittedEffectV1,
		outcome: "success" | "passed" | "failed",
		workspaceStateDigest: string | null,
		criteria: D45LocalResultInputV1["criteria"],
		sourceSnapshotDigest?: string,
	): D45EffectResultInputV1 {
		const semantic =
			effect.sourceD43EffectKind === "public-semantic-validation" ||
			effect.sourceD43EffectKind === "hidden-verifier";
		const normalizedCriteria = criteria;
		return {
			effectKind: "local-effect",
			outcome,
			elapsedMs: 1,
			evidenceDigest: semantic
				? empiricalStrictJsonDigest({
						request: effect.requestDigest,
						admission: effect.admissionDigest,
						outcome,
						workspace: workspaceStateDigest,
						sourceSnapshotDigest,
						criteriaDigest:
							normalizedCriteria === null ? null : empiricalStrictJsonDigest(normalizedCriteria),
					})
				: empiricalStrictJsonDigest({
						request: effect.requestDigest,
						outcome,
						workspace: workspaceStateDigest,
					}),
			workspaceStateDigest,
			criteria: normalizedCriteria,
			...(semantic ? { sourceSnapshotDigest: sourceSnapshotDigest! } : {}),
		};
	}

	const executor: D44LiveExecutorV1 = Object.freeze({
		revision: "graphrefly-ts.d44.d45-live-composition.v1",
		async execute(
			authorityValue: object,
			effect: D45AdmittedEffectV1,
		): Promise<{
			readonly result: D45EffectResultInputV1;
			readonly retryDelayMs: number;
		}> {
			if (disposed || active) throw new TypeError("D65 injected executor lifecycle drifted");
			active = true;
			try {
				const authority = authorityValue as D45GraphToolAuthorityV1;
				if (effect.effectKind === "provider-proposal") {
					providerCalls += 1;
					const wire = lowerD45ProviderEffect(authority, effect);
					if (retryOnceDelayMs > 0 && !retryIssued) {
						retryIssued = true;
						return {
							result: {
								effectKind: "provider-proposal",
								outcome: "retryable-provider-failure",
								elapsedMs: 1,
								costMicrousd: providerCostMicrousd,
								usage: null,
								wireDigest: wire.wireDigest,
								retryClass: "D710",
								responseRejectionCode: null,
								proposal: null,
							},
							retryDelayMs: retryOnceDelayMs,
						};
					}
					if (input?.providerFailureArm === effect.arm) {
						return {
							result: {
								effectKind: "provider-proposal",
								outcome: "transport-failed",
								elapsedMs: 1,
								costMicrousd: providerCostMicrousd,
								usage: null,
								wireDigest: wire.wireDigest,
								retryClass: null,
								responseRejectionCode: null,
								proposal: null,
							},
							retryDelayMs: 0,
						};
					}
					let proposal: Extract<
						D45EffectResultInputV1,
						{ effectKind: "provider-proposal" }
					>["proposal"];
					if (input?.rejectArm === effect.arm) {
						proposal = { toolCalls: [] };
					} else if (effect.phase === "inspection") {
						const ordinal = inspectionOrdinals.get(effect.arm) ?? 0;
						proposal = {
							toolCalls: [
								{
									toolRef: "read-file",
									path: D45_READABLE_PATHS[Math.min(ordinal, D45_READABLE_PATHS.length - 1)]!,
								},
							],
						};
						inspectionOrdinals.set(effect.arm, ordinal + 1);
					} else {
						proposal = {
							toolCalls: [
								{
									toolRef: "replace-exact",
									path: D45_WRITABLE_PATH,
									oldText: D44_BUGGY_ADMISSION_BLOCK,
									newText: D44_FIXED_ADMISSION_BLOCK,
								},
							],
						};
					}
					return {
						result: {
							effectKind: "provider-proposal",
							outcome: "success",
							elapsedMs: 1,
							costMicrousd: providerCostMicrousd,
							usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0 },
							wireDigest: wire.wireDigest,
							retryClass: null,
							responseRejectionCode: null,
							proposal,
						},
						retryDelayMs: 0,
					};
				}
				if (effect.sourceD43EffectKind === "materialization") {
					const state = empiricalStrictJsonDigest({ arm: effect.arm, state: "materialized" });
					workspaceStates.set(effect.arm, state);
					return { result: localResult(effect, "success", state, null), retryDelayMs: 0 };
				}
				if (effect.effectKind === "workspace-freshness") {
					const state = stateFor(effect);
					return {
						result: {
							effectKind: "workspace-freshness",
							elapsedMs: 1,
							evidenceDigest: empiricalStrictJsonDigest({ request: effect.requestDigest, state }),
							observedWorkspaceStateDigest: state,
						},
						retryDelayMs: 0,
					};
				}
				if (effect.effectKind === "tool-action") {
					const argumentsValue = readD45ToolArguments(authority, effect);
					const before = stateFor(effect);
					const after =
						argumentsValue.toolRef === "replace-exact"
							? empiricalStrictJsonDigest({ before, mutation: effect.argumentsDigest })
							: before;
					workspaceStates.set(effect.arm, after);
					const content =
						argumentsValue.toolRef === "read-file"
							? argumentsValue.path === D45_WRITABLE_PATH
								? D44_BUGGY_ADMISSION_BLOCK
								: `// bounded injected content for ${argumentsValue.path}\n`
							: null;
					return {
						result: {
							effectKind: "tool-action",
							status: "success",
							causeCode: null,
							elapsedMs: 1,
							evidenceDigest: empiricalStrictJsonDigest({
								request: effect.requestDigest,
								before,
								after,
							}),
							workspaceStateBeforeDigest: before,
							workspaceStateAfterDigest: after,
							content,
						},
						retryDelayMs: 0,
					};
				}
				const state = stateFor(effect);
				if (effect.sourceD43EffectKind === "public-semantic-validation") {
					const observations = D45_PUBLIC_SEMANTIC_SCENARIOS.map((scenario) =>
						Object.freeze({
							causeCode: null,
							criterion: scenario.criterion,
							scenarioRef: scenario.scenarioRef,
							scenarioDigest: scenario.scenarioDigest,
							observationDigest: empiricalStrictJsonDigest({
								requestDigest: effect.sourceD43RequestDigest,
								scenarioDigest: scenario.scenarioDigest,
								passed: true,
								causeCode: null,
							}),
							freshnessDigest: empiricalStrictJsonDigest({
								requestDigest: effect.sourceD43RequestDigest,
								sequence: effect.sourceD43Sequence,
							}),
							passed: true,
						}),
					);
					const criteria = Object.freeze({
						scenarioSetDigest: D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
						observations: Object.freeze(observations),
					});
					const sourceSnapshotDigest = empiricalStrictJsonDigest({ state, public: true });
					return {
						result: localResult(effect, "passed", state, criteria, sourceSnapshotDigest),
						retryDelayMs: 0,
					};
				}
				if (effect.sourceD43EffectKind === "hidden-verifier") {
					const outcome = effect.arm === "relevant-applied" ? "passed" : "failed";
					const sourceSnapshotDigest = empiricalStrictJsonDigest({ state, hidden: true });
					return {
						result: localResult(effect, outcome, state, null, sourceSnapshotDigest),
						retryDelayMs: 0,
					};
				}
				if (effect.sourceD43EffectKind === "cleanup") {
					workspaceStates.delete(effect.arm);
					return { result: localResult(effect, "success", null, null), retryDelayMs: 0 };
				}
				return {
					result: localResult(
						effect,
						effect.sourceD43EffectKind === "focused-validation" ? "passed" : "success",
						state,
						null,
					),
					retryDelayMs: 0,
				};
			} finally {
				active = false;
			}
		},
		async dispose() {
			if (active) throw new TypeError("D65 cannot dispose an active injected effect");
			disposed = true;
			workspaceStates.clear();
			if (input?.failDispose === true) throw new TypeError("D65 bounded injected cleanup failure");
		},
	});
	return Object.freeze({
		executor,
		observation: () => Object.freeze({ providerCalls, maxActiveEffects: 1 as const, disposed }),
	});
}
