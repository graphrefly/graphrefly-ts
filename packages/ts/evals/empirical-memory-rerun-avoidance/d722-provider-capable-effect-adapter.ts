import { empiricalStrictJsonDigest, exactKeys, record, safeInteger } from "./canonical.js";
import type { D719CleanBudgetLimitsV1 } from "./d719-clean-graph-ledger.js";
import { D721_PROVIDER_CAPABLE_ADAPTER_REVISION } from "./d721-provider-capable-effect-adapter.js";
import { validateD720GraphEffectResult } from "./d722-graph-native-effect-runtime.js";
import {
	createD720SimulatedCallerExecutor,
	type D720CallerEffectExecutionInputV2,
	type D720CallerEffectExecutionV2,
	type D720EffectCeilingsV2,
	type D722GraphNativeEvalCoreV1,
	runD722GraphNativeEvalCore,
} from "./d722-graph-native-eval.js";
import {
	createD722InjectedModelFixture,
	D722_INJECTED_MODEL_FIXTURE_REVISION,
	invokeD722InjectedModelFixture,
} from "./d722-injected-model-fixture.js";

export const D722_PROVIDER_CAPABLE_ADAPTER_REVISION =
	"graphrefly.b112.d722.provider-capable-completion-adapter.v1" as const;

const EFFECT_KINDS = [
	"materialization",
	"provider-request",
	"retry-wait",
	"tool-action",
	"hidden-verifier",
	"cleanup",
] as const;
const MAX_EXECUTION_ATTEMPTS = 512 * 12;

export interface D722InjectedAdapterRunV1 {
	readonly core: D722GraphNativeEvalCoreV1;
	readonly adapterRevision: typeof D722_PROVIDER_CAPABLE_ADAPTER_REVISION;
	readonly baselineAdapterRevision: typeof D721_PROVIDER_CAPABLE_ADAPTER_REVISION;
	readonly modelFixtureRevision: typeof D722_INJECTED_MODEL_FIXTURE_REVISION;
	readonly executedEffectCount: number;
	readonly failedEffectCount: number;
	readonly maxActiveInvocations: 0 | 1;
	readonly callsByEffectKind: ReadonlyMap<string, number>;
	readonly cleanupCalls: number;
	readonly remainingWorkspaces: number;
}

function evidence(value: unknown): string {
	return empiricalStrictJsonDigest(value);
}

function validateEnvelope(
	value: unknown,
	input: D720CallerEffectExecutionInputV2,
): D720CallerEffectExecutionV2 {
	const candidate = record(value, "d722.portResult");
	exactKeys(candidate, ["actualCostMicrousd", "actualElapsedMs", "result"], "d722.portResult");
	safeInteger(candidate.actualCostMicrousd, "d722.portResult.actualCostMicrousd", {
		max: 1_000_000_000,
	});
	safeInteger(candidate.actualElapsedMs, "d722.portResult.actualElapsedMs", {
		max: 1_000_000_000,
	});
	const result = validateD720GraphEffectResult(candidate.result, input.effectRequest);
	return Object.freeze({
		actualCostMicrousd: candidate.actualCostMicrousd as number,
		actualElapsedMs: candidate.actualElapsedMs as number,
		result,
	});
}

export async function runD722InjectedProviderCapableAdapter(inputValue: {
	readonly sourceDigest: string;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly effectCeilings: D720EffectCeilingsV2;
	readonly signal?: AbortSignal;
}): Promise<D722InjectedAdapterRunV1> {
	const input = record(inputValue, "d722.injectedAdapterRun");
	exactKeys(
		input,
		Object.hasOwn(input, "signal")
			? ["budgetLimits", "effectCeilings", "signal", "sourceDigest"]
			: ["budgetLimits", "effectCeilings", "sourceDigest"],
		"d722.injectedAdapterRun",
	);
	if (Object.hasOwn(input, "signal") && !(input.signal instanceof AbortSignal))
		throw new TypeError("D722 signal is invalid");
	const workspaceStates = new Map<number, string>();
	const modelFixture = createD722InjectedModelFixture();
	const calls = new Map<string, number>();
	let cleanupCalls = 0;
	const recordCall = (kind: string) => calls.set(kind, (calls.get(kind) ?? 0) + 1);
	const materialization = async ({
		effectRequest,
	}: D720CallerEffectExecutionInputV2): Promise<D720CallerEffectExecutionV2> => {
		recordCall("materialization");
		const workspaceStateDigest = evidence({
			runSequence: effectRequest.runSequence,
			state: "base",
		});
		workspaceStates.set(effectRequest.runSequence, workspaceStateDigest);
		return {
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
			result: {
				effectKind: "materialization",
				status: "ready",
				workspaceStateDigest,
				evidenceDigest: evidence({ effectRequest, status: "ready" }),
			},
		};
	};
	const providerRequest = async (
		executionInput: D720CallerEffectExecutionInputV2,
	): Promise<D720CallerEffectExecutionV2> => {
		recordCall("provider-request");
		const result = await invokeD722InjectedModelFixture(modelFixture, executionInput.effectRequest);
		return {
			actualCostMicrousd: result.status === "retryable-failure" ? 7 : 11,
			actualElapsedMs: result.status === "retryable-failure" ? 2 : 3,
			result,
		};
	};
	const retryWait = async ({
		effectRequest,
	}: D720CallerEffectExecutionInputV2): Promise<D720CallerEffectExecutionV2> => {
		recordCall("retry-wait");
		return {
			actualCostMicrousd: 0,
			actualElapsedMs: 60_000,
			result: {
				effectKind: "retry-wait",
				status: "completed",
				evidenceDigest: evidence({ effectRequest, status: "waited" }),
			},
		};
	};
	const toolAction = async ({
		effectRequest,
	}: D720CallerEffectExecutionInputV2): Promise<D720CallerEffectExecutionV2> => {
		recordCall("tool-action");
		const tool = effectRequest.toolIntent;
		if (tool === null) throw new TypeError("D722 tool action lacks Graph-issued intent");
		const before = workspaceStates.get(effectRequest.runSequence)!;
		const after =
			tool.toolRef === "replace-exact" ? evidence({ before, mutation: tool.intentDigest }) : before;
		workspaceStates.set(effectRequest.runSequence, after);
		return {
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
			result: {
				effectKind: "tool-action",
				toolRef: tool.toolRef,
				intentDigest: tool.intentDigest,
				status: "succeeded",
				nonEmptyDiff: tool.toolRef === "workspace-diff",
				workspaceStateBeforeDigest: before,
				workspaceStateAfterDigest: after,
				evidenceDigest: evidence({ effectRequest, status: "succeeded" }),
			},
		};
	};
	const hiddenVerifier = async ({
		effectRequest,
	}: D720CallerEffectExecutionInputV2): Promise<D720CallerEffectExecutionV2> => {
		recordCall("hidden-verifier");
		return {
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
			result: {
				effectKind: "hidden-verifier",
				status: "passed",
				workspaceStateDigest: workspaceStates.get(effectRequest.runSequence)!,
				evidenceDigest: evidence({ effectRequest, status: "passed" }),
			},
		};
	};
	const cleanup = async ({
		effectRequest,
	}: D720CallerEffectExecutionInputV2): Promise<D720CallerEffectExecutionV2> => {
		recordCall("cleanup");
		cleanupCalls += 1;
		workspaceStates.delete(effectRequest.runSequence);
		return {
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
			result: {
				effectKind: "cleanup",
				status: "succeeded",
				evidenceDigest: evidence({ effectRequest, status: "succeeded" }),
			},
		};
	};
	const ports: Readonly<
		Record<
			(typeof EFFECT_KINDS)[number],
			(input: D720CallerEffectExecutionInputV2) => Promise<D720CallerEffectExecutionV2>
		>
	> = Object.freeze({
		materialization,
		"provider-request": providerRequest,
		"retry-wait": retryWait,
		"tool-action": toolAction,
		"hidden-verifier": hiddenVerifier,
		cleanup,
	});
	let active = 0;
	let maxActive = 0;
	let executed = 0;
	let failed = 0;
	const executor = createD720SimulatedCallerExecutor(async (executionInput) => {
		if (active !== 0) throw new TypeError("D722 adapter attempted parallel effect execution");
		if (executed >= MAX_EXECUTION_ATTEMPTS)
			throw new TypeError("D722 adapter execution-attempt bound exceeded");
		active += 1;
		maxActive = Math.max(maxActive, active);
		executed += 1;
		try {
			try {
				const raw = await ports[executionInput.effectRequest.effectKind](executionInput);
				return validateEnvelope(raw, executionInput);
			} catch (error) {
				failed += 1;
				throw error;
			}
		} finally {
			active -= 1;
		}
	});
	const core = await runD722GraphNativeEvalCore(
		Object.hasOwn(input, "signal")
			? {
					sourceDigest: input.sourceDigest as string,
					budgetLimits: input.budgetLimits as D719CleanBudgetLimitsV1,
					effectCeilings: input.effectCeilings as D720EffectCeilingsV2,
					executor,
					signal: input.signal as AbortSignal,
				}
			: {
					sourceDigest: input.sourceDigest as string,
					budgetLimits: input.budgetLimits as D719CleanBudgetLimitsV1,
					effectCeilings: input.effectCeilings as D720EffectCeilingsV2,
					executor,
				},
	);
	return Object.freeze({
		core,
		adapterRevision: D722_PROVIDER_CAPABLE_ADAPTER_REVISION,
		baselineAdapterRevision: D721_PROVIDER_CAPABLE_ADAPTER_REVISION,
		modelFixtureRevision: D722_INJECTED_MODEL_FIXTURE_REVISION,
		executedEffectCount: executed,
		failedEffectCount: failed,
		maxActiveInvocations: maxActive as 0 | 1,
		callsByEffectKind: calls,
		cleanupCalls,
		remainingWorkspaces: workspaceStates.size,
	});
}
