import { empiricalStrictJsonDigest, exactKeys, record, safeInteger } from "./canonical.js";
import type { D719CleanBudgetLimitsV1 } from "./d719-clean-graph-ledger.js";
import {
	type D720ToolIntentV1,
	validateD720GraphEffectResult,
} from "./d720-graph-native-effect-runtime.js";
import {
	createD720SimulatedCallerExecutor,
	type D720CallerEffectExecutionInputV2,
	type D720CallerEffectExecutionV2,
	type D720EffectCeilingsV2,
	type D720GraphNativeEvalBundleV1,
	runD720GraphNativeEval,
	validateD720GraphNativeEvalBundle,
} from "./d720-graph-native-eval.js";

export const D721_PROVIDER_CAPABLE_ADAPTER_REVISION =
	"graphrefly.b112.d721.provider-capable-effect-adapter.v2" as const;
export const D721_ADAPTER_RUN_RECEIPT_REVISION =
	"graphrefly.b112.d721.adapter-run-receipt.v1" as const;

const EFFECT_KINDS = [
	"materialization",
	"provider-request",
	"retry-wait",
	"tool-action",
	"hidden-verifier",
	"cleanup",
] as const;
const MAX_EXECUTION_ATTEMPTS = 512 * 12;

export type D721EffectExecutionPortV1 = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<D720CallerEffectExecutionV2>;

export interface D721ProviderCapableEffectAdapterV1 {
	readonly revision: typeof D721_PROVIDER_CAPABLE_ADAPTER_REVISION;
}

export interface D721AdapterRunReceiptV1 {
	readonly revision: typeof D721_ADAPTER_RUN_RECEIPT_REVISION;
}

export interface D721ProviderCapableAdapterRunV1 {
	readonly underlyingBundle: D720GraphNativeEvalBundleV1;
	readonly receipt: D721AdapterRunReceiptV1;
}

export interface D721AdapterRunSummaryV1 {
	readonly executedEffectCount: number;
	readonly failedEffectCount: number;
	readonly maxActiveInvocations: 0 | 1;
}

export interface D721InjectedNoNetworkFixtureV1 {
	readonly adapter: D721ProviderCapableEffectAdapterV1;
	readonly callsByEffectKind: ReadonlyMap<string, number>;
	readonly cleanupCalls: () => number;
	readonly remainingWorkspaces: () => number;
}

interface AdapterState {
	readonly ports: Readonly<Record<(typeof EFFECT_KINDS)[number], D721EffectExecutionPortV1>>;
	consumed: boolean;
}

interface TraversalAttempt {
	readonly admissionDigest: string;
	readonly outcome: "completed" | "port-threw" | "invalid-envelope";
}

interface ReceiptState {
	readonly attempts: readonly TraversalAttempt[];
	readonly maxActiveInvocations: 0 | 1;
	consumed: boolean;
}

const constructedAdapters = new WeakMap<object, AdapterState>();
const injectedNoNetworkAdapters = new WeakSet<object>();
const constructedReceipts = new WeakMap<object, ReceiptState>();

function validatePortEnvelope(
	value: unknown,
	input: D720CallerEffectExecutionInputV2,
): D720CallerEffectExecutionV2 {
	const candidate = record(value, "d721.portResult");
	exactKeys(candidate, ["actualCostMicrousd", "actualElapsedMs", "result"], "d721.portResult");
	safeInteger(candidate.actualCostMicrousd, "d721.portResult.actualCostMicrousd", {
		max: 1_000_000_000,
	});
	safeInteger(candidate.actualElapsedMs, "d721.portResult.actualElapsedMs", {
		max: 1_000_000_000,
	});
	// The D720 validator performs all nested count/depth/string/accessor checks before
	// this untrusted result can be snapshotted by the adapter.
	const result = validateD720GraphEffectResult(candidate.result, input.effectRequest);
	return Object.freeze({
		actualCostMicrousd: candidate.actualCostMicrousd as number,
		actualElapsedMs: candidate.actualElapsedMs as number,
		result,
	});
}

export function createD721ProviderCapableEffectAdapter(value: {
	readonly materialization: D721EffectExecutionPortV1;
	readonly providerRequest: D721EffectExecutionPortV1;
	readonly retryWait: D721EffectExecutionPortV1;
	readonly toolAction: D721EffectExecutionPortV1;
	readonly hiddenVerifier: D721EffectExecutionPortV1;
	readonly cleanup: D721EffectExecutionPortV1;
}): D721ProviderCapableEffectAdapterV1 {
	const candidate = record(value, "d721.adapterPorts");
	exactKeys(
		candidate,
		["cleanup", "hiddenVerifier", "materialization", "providerRequest", "retryWait", "toolAction"],
		"d721.adapterPorts",
	);
	for (const key of [
		"cleanup",
		"hiddenVerifier",
		"materialization",
		"providerRequest",
		"retryWait",
		"toolAction",
	] as const)
		if (typeof candidate[key] !== "function") throw new TypeError(`D721 ${key} port is invalid`);
	const adapter = Object.freeze({ revision: D721_PROVIDER_CAPABLE_ADAPTER_REVISION });
	constructedAdapters.set(adapter, {
		ports: Object.freeze({
			materialization: candidate.materialization as D721EffectExecutionPortV1,
			"provider-request": candidate.providerRequest as D721EffectExecutionPortV1,
			"retry-wait": candidate.retryWait as D721EffectExecutionPortV1,
			"tool-action": candidate.toolAction as D721EffectExecutionPortV1,
			"hidden-verifier": candidate.hiddenVerifier as D721EffectExecutionPortV1,
			cleanup: candidate.cleanup as D721EffectExecutionPortV1,
		}),
		consumed: false,
	});
	return adapter;
}

function adapterState(value: unknown): AdapterState {
	if (typeof value !== "object" || value === null)
		throw new TypeError("D721 adapter must be a constructed capability");
	const state = constructedAdapters.get(value);
	if (state === undefined) throw new TypeError("D721 adapter must be a constructed capability");
	if (state.consumed) throw new TypeError("D721 adapter is single-use");
	return state;
}

export function isD721InjectedNoNetworkQualificationAdapter(value: unknown): boolean {
	return typeof value === "object" && value !== null && injectedNoNetworkAdapters.has(value);
}

export async function runD721ProviderCapableEffectAdapter(inputValue: {
	readonly sourceDigest: string;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly effectCeilings: D720EffectCeilingsV2;
	readonly adapter: D721ProviderCapableEffectAdapterV1;
	readonly signal?: AbortSignal;
}): Promise<D721ProviderCapableAdapterRunV1> {
	const input = record(inputValue, "d721.adapterRun");
	exactKeys(
		input,
		Object.hasOwn(input, "signal")
			? ["adapter", "budgetLimits", "effectCeilings", "signal", "sourceDigest"]
			: ["adapter", "budgetLimits", "effectCeilings", "sourceDigest"],
		"d721.adapterRun",
	);
	if (Object.hasOwn(input, "signal") && !(input.signal instanceof AbortSignal))
		throw new TypeError("D721 signal is invalid");
	const state = adapterState(input.adapter);
	state.consumed = true;
	let active = 0;
	let maxActive: 0 | 1 = 0;
	const attempts: TraversalAttempt[] = [];
	const executor = createD720SimulatedCallerExecutor(async (executionInput) => {
		if (active !== 0) throw new TypeError("D721 adapter attempted parallel effect execution");
		if (attempts.length >= MAX_EXECUTION_ATTEMPTS)
			throw new TypeError("D721 adapter execution-attempt bound exceeded");
		active += 1;
		maxActive = 1;
		const admissionDigest = executionInput.admission.decisionDigest;
		try {
			let raw: unknown;
			try {
				raw = await state.ports[executionInput.effectRequest.effectKind](executionInput);
			} catch (error) {
				attempts.push(Object.freeze({ admissionDigest, outcome: "port-threw" }));
				throw error;
			}
			try {
				const envelope = validatePortEnvelope(raw, executionInput);
				attempts.push(Object.freeze({ admissionDigest, outcome: "completed" }));
				return envelope;
			} catch (error) {
				attempts.push(Object.freeze({ admissionDigest, outcome: "invalid-envelope" }));
				throw error;
			}
		} finally {
			active -= 1;
		}
	});
	const runInput = Object.freeze(
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
	const underlyingBundle = await runD720GraphNativeEval(runInput);
	const receipt = Object.freeze({ revision: D721_ADAPTER_RUN_RECEIPT_REVISION });
	constructedReceipts.set(receipt, {
		attempts: Object.freeze(attempts.slice()),
		maxActiveInvocations: maxActive,
		consumed: false,
	});
	return Object.freeze({ underlyingBundle, receipt });
}

export function consumeD721AdapterRunReceipt(
	receipt: D721AdapterRunReceiptV1,
	underlyingValue: D720GraphNativeEvalBundleV1,
): D721AdapterRunSummaryV1 {
	if (typeof receipt !== "object" || receipt === null)
		throw new TypeError("D721 adapter receipt is invalid");
	const state = constructedReceipts.get(receipt);
	if (state === undefined) throw new TypeError("D721 adapter receipt is not constructed");
	if (state.consumed) throw new TypeError("D721 adapter receipt is single-use");
	state.consumed = true;
	const underlying = validateD720GraphNativeEvalBundle(underlyingValue);
	const admissions = underlying.graphEvidence.ledger.effectAdmissions.filter((x) => x.admitted);
	if (admissions.length !== state.attempts.length)
		throw new TypeError("D721 adapter traversal does not cover exact Graph admissions");
	const admissionByDigest = new Map(admissions.map((x) => [x.decisionDigest, x]));
	const reconciliationBySequence = new Map(
		underlying.graphEvidence.ledger.effectReconciliations.map((x) => [x.effectSequence, x]),
	);
	const seen = new Set<string>();
	let failedEffectCount = 0;
	for (const [index, attempt] of state.attempts.entries()) {
		const admission = admissionByDigest.get(attempt.admissionDigest);
		if (admission === undefined || seen.has(attempt.admissionDigest))
			throw new TypeError("D721 adapter traversal admission provenance drifted");
		seen.add(attempt.admissionDigest);
		if (admissions[index]?.decisionDigest !== attempt.admissionDigest)
			throw new TypeError("D721 adapter traversal order drifted from Graph admission order");
		const reconciliation = reconciliationBySequence.get(admission.effectSequence);
		if (reconciliation === undefined)
			throw new TypeError("D721 adapter traversal lacks Graph usage reconciliation");
		if (attempt.outcome === "completed") {
			if (reconciliation.basis !== "measured")
				throw new TypeError("D721 completed traversal lacks measured Graph reconciliation");
		} else {
			failedEffectCount += 1;
			if (reconciliation.basis !== "conservative-reservation")
				throw new TypeError("D721 failed traversal lacks conservative Graph reconciliation");
		}
	}
	return Object.freeze({
		executedEffectCount: state.attempts.length,
		failedEffectCount,
		maxActiveInvocations: state.maxActiveInvocations,
	});
}

function evidence(value: unknown): string {
	return empiricalStrictJsonDigest(value);
}

function intents(runSequence: number): readonly D720ToolIntentV1[] {
	return Object.freeze(
		(["read-file", "replace-exact", "workspace-diff", "focused-validation"] as const).map(
			(toolRef, index) =>
				Object.freeze({ toolRef, intentDigest: evidence({ runSequence, toolRef, index }) }),
		),
	);
}

export function createD721InjectedNoNetworkFixture(
	inputValue: { readonly throwProvider?: boolean; readonly abortController?: AbortController } = {},
): D721InjectedNoNetworkFixtureV1 {
	const input = record(inputValue, "d721.injectedFixture");
	exactKeys(
		input,
		Object.hasOwn(input, "abortController")
			? Object.hasOwn(input, "throwProvider")
				? ["abortController", "throwProvider"]
				: ["abortController"]
			: Object.hasOwn(input, "throwProvider")
				? ["throwProvider"]
				: [],
		"d721.injectedFixture",
	);
	if (Object.hasOwn(input, "throwProvider") && typeof input.throwProvider !== "boolean")
		throw new TypeError("D721 injected throwProvider flag is invalid");
	if (
		Object.hasOwn(input, "abortController") &&
		!(input.abortController instanceof AbortController)
	)
		throw new TypeError("D721 injected abortController is invalid");
	const workspaceStates = new Map<number, string>();
	const retryIssued = new Set<string>();
	const calls = new Map<string, number>();
	let cleanupCount = 0;
	const recordCall = (kind: string) => calls.set(kind, (calls.get(kind) ?? 0) + 1);
	const materialization: D721EffectExecutionPortV1 = async ({ effectRequest }) => {
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
	const providerRequest: D721EffectExecutionPortV1 = async (executionInput) => {
		const { effectRequest, signal } = executionInput;
		recordCall("provider-request");
		if (input.throwProvider === true) throw new Error("injected provider failure");
		if (input.abortController !== undefined) {
			(input.abortController as AbortController).abort();
			await Promise.resolve();
			if (signal?.aborted === true) throw new DOMException("Aborted", "AbortError");
		}
		const retryReason =
			effectRequest.runSequence === 0
				? "d671-rate-limit-exceeded"
				: effectRequest.runSequence === 1
					? "d675-und-err-socket"
					: effectRequest.runSequence === 2
						? "d710-untyped-http-429"
						: null;
		if (
			retryReason !== null &&
			effectRequest.phaseBefore === "none" &&
			effectRequest.attemptOrdinal === 1 &&
			!retryIssued.has(effectRequest.logicalRequestDigest)
		) {
			retryIssued.add(effectRequest.logicalRequestDigest);
			return {
				actualCostMicrousd: 7,
				actualElapsedMs: 2,
				result: {
					effectKind: "provider-request",
					status: "retryable-failure",
					toolIntents: Object.freeze([]),
					failureDiscriminator: retryReason,
					retryAfterMs: null,
					workspaceStateDigest: workspaceStates.get(effectRequest.runSequence)!,
					evidenceDigest: evidence({ effectRequest, retryReason }),
				},
			};
		}
		const firstTurn = effectRequest.phaseBefore === "none";
		return {
			actualCostMicrousd: 11,
			actualElapsedMs: 3,
			result: {
				effectKind: "provider-request",
				status: firstTurn ? "tool-intents" : "structured-final",
				toolIntents: firstTurn ? intents(effectRequest.runSequence) : Object.freeze([]),
				failureDiscriminator: "none",
				retryAfterMs: null,
				workspaceStateDigest: workspaceStates.get(effectRequest.runSequence)!,
				evidenceDigest: evidence({ effectRequest, status: firstTurn ? "tools" : "final" }),
			},
		};
	};
	const retryWait: D721EffectExecutionPortV1 = async ({ effectRequest }) => {
		recordCall("retry-wait");
		return {
			actualCostMicrousd: 0,
			actualElapsedMs: 60_000,
			result: {
				effectKind: "retry-wait",
				status: "completed",
				evidenceDigest: evidence({ effectRequest, waited: true }),
			},
		};
	};
	const toolAction: D721EffectExecutionPortV1 = async ({ effectRequest }) => {
		recordCall("tool-action");
		const toolIntent = effectRequest.toolIntent;
		if (toolIntent === null) throw new Error("Graph tool intent is missing");
		const before = workspaceStates.get(effectRequest.runSequence)!;
		const after =
			toolIntent.toolRef === "replace-exact"
				? evidence({ before, mutation: toolIntent.intentDigest })
				: before;
		workspaceStates.set(effectRequest.runSequence, after);
		return {
			actualCostMicrousd: 0,
			actualElapsedMs: 1,
			result: {
				effectKind: "tool-action",
				toolRef: toolIntent.toolRef,
				intentDigest: toolIntent.intentDigest,
				status: "succeeded",
				nonEmptyDiff: toolIntent.toolRef === "workspace-diff",
				workspaceStateBeforeDigest: before,
				workspaceStateAfterDigest: after,
				evidenceDigest: evidence({ effectRequest, status: "succeeded" }),
			},
		};
	};
	const hiddenVerifier: D721EffectExecutionPortV1 = async ({ effectRequest }) => {
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
	const cleanup: D721EffectExecutionPortV1 = async ({ effectRequest }) => {
		recordCall("cleanup");
		cleanupCount += 1;
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
	const adapter = createD721ProviderCapableEffectAdapter({
		materialization,
		providerRequest,
		retryWait,
		toolAction,
		hiddenVerifier,
		cleanup,
	});
	injectedNoNetworkAdapters.add(adapter);
	return Object.freeze({
		adapter,
		callsByEffectKind: calls,
		cleanupCalls: () => cleanupCount,
		remainingWorkspaces: () => workspaceStates.size,
	});
}
