import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import type { D719CleanBudgetLimitsV1 } from "./d719-clean-graph-ledger.js";
import { validateD720GraphEffectResult } from "./d722-graph-native-effect-runtime.js";
import {
	createD720SimulatedCallerExecutor,
	type D720CallerEffectExecutionInputV2,
	type D720CallerEffectExecutionV2,
	type D720EffectCeilingsV2,
	type D722GraphNativeEvalCoreV1,
	runD722GraphNativeEvalCore,
} from "./d722-graph-native-eval.js";

export const D723_DECISION_REF = "decision.D723" as const;
export const D723_DECISION_REVISION = "2026-08-11.v1" as const;
export const D723_ADAPTER_REVISION =
	"graphrefly.b112.d723.graph-native-real-provider-effect-adapter.v1" as const;
export const D723_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d723.graph-native-real-provider-qualification.v1" as const;
export const D723_GENERATION_SCHEMA =
	"graphrefly.b112.d723.graph-native-real-provider-generation.v1" as const;
export const D723_GENERATION_REF = "d723-graph-native-real-provider-v1" as const;
export const D723_D722_ARTIFACT_SHA256 = Object.freeze({
	commit: "sha256:a074f06f7a9647b1e6529e6f9ef6c36854b686316f52bace3092870ff8aaf110",
	qualification: "sha256:4d2c8e82c9749079fc1c9915f7e4cfe0c4f109b6bb16e2cee537b112cb1b29c5",
	bundle: "sha256:23878488cbd3187abe376d75303428f4df3bf62b5e9974dc27a143ba9310b62b",
	graphEvidence: "sha256:5d07b6cb6bbe0adf3f4af14c67614636fa114216bacac771ea5ca3bfb28e41e2",
	generation: "sha256:1fc85d135f9bbcfbac52aa2ee114838a204740a333f3ad45e52c637b3551d137",
});

const EFFECT_KINDS = Object.freeze([
	"materialization",
	"provider-request",
	"retry-wait",
	"tool-action",
	"hidden-verifier",
	"cleanup",
] as const);
const MAX_EFFECT_TRAVERSALS = 6_144;

export type D723EffectPortV1 = (
	input: Readonly<D720CallerEffectExecutionInputV2>,
) => Promise<D720CallerEffectExecutionV2>;

export interface D723RealProviderAdapterV1 {
	readonly revision: typeof D723_ADAPTER_REVISION;
}

export interface D723AdapterReceiptV1 {
	readonly revision: "graphrefly.b112.d723.adapter-receipt.v1";
}

interface AdapterState {
	readonly ports: Readonly<Record<(typeof EFFECT_KINDS)[number], D723EffectPortV1>>;
	readonly executionClass: "injected-no-network" | "live-provider";
	consumed: boolean;
}

interface ReceiptState {
	readonly admissionDigests: readonly string[];
	readonly failedEffects: number;
	readonly maxActive: 0 | 1;
	readonly executionClass: "injected-no-network" | "live-provider";
	consumed: boolean;
}

export interface D723AdapterRunV1 {
	readonly core: D722GraphNativeEvalCoreV1;
	readonly receipt: D723AdapterReceiptV1;
}

export interface D723OperationalSummaryV1 {
	readonly executionClass: "injected-no-network" | "live-provider";
	readonly graphAdmittedEffectCount: number;
	readonly graphReconciledEffectCount: number;
	readonly failedEffectCount: number;
	readonly maxActiveInvocations: 0 | 1;
	readonly allEffectsGraphAdmitted: true;
	readonly allUsageGraphReconciled: true;
}

const adapterStates = new WeakMap<object, AdapterState>();
const receiptStates = new WeakMap<object, ReceiptState>();

function validateExecutionEnvelope(
	value: unknown,
	input: D720CallerEffectExecutionInputV2,
): D720CallerEffectExecutionV2 {
	const candidate = record(value, "d723.effectExecution");
	exactKeys(candidate, ["actualCostMicrousd", "actualElapsedMs", "result"], "d723.effectExecution");
	const actualCostMicrousd = safeInteger(
		candidate.actualCostMicrousd,
		"d723.effectExecution.actualCostMicrousd",
		{ max: 6_000_000 },
	);
	const actualElapsedMs = safeInteger(
		candidate.actualElapsedMs,
		"d723.effectExecution.actualElapsedMs",
		{ max: 7_200_000 },
	);
	return Object.freeze({
		actualCostMicrousd,
		actualElapsedMs,
		result: validateD720GraphEffectResult(candidate.result, input.effectRequest),
	});
}

export function createD723RealProviderAdapter(value: {
	readonly executionClass: "injected-no-network" | "live-provider";
	readonly materialization: D723EffectPortV1;
	readonly providerRequest: D723EffectPortV1;
	readonly retryWait: D723EffectPortV1;
	readonly toolAction: D723EffectPortV1;
	readonly hiddenVerifier: D723EffectPortV1;
	readonly cleanup: D723EffectPortV1;
}): D723RealProviderAdapterV1 {
	const candidate = record(value, "d723.adapter");
	exactKeys(
		candidate,
		[
			"cleanup",
			"executionClass",
			"hiddenVerifier",
			"materialization",
			"providerRequest",
			"retryWait",
			"toolAction",
		],
		"d723.adapter",
	);
	const executionClass = oneOf(
		candidate.executionClass,
		["injected-no-network", "live-provider"] as const,
		"d723.adapter.executionClass",
	);
	for (const key of [
		"cleanup",
		"hiddenVerifier",
		"materialization",
		"providerRequest",
		"retryWait",
		"toolAction",
	] as const) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
		if (
			descriptor === undefined ||
			!("value" in descriptor) ||
			typeof descriptor.value !== "function"
		)
			throw new TypeError(`D723 ${key} port must be an own function data property`);
	}
	const adapter = Object.freeze({ revision: D723_ADAPTER_REVISION });
	adapterStates.set(adapter, {
		executionClass,
		consumed: false,
		ports: Object.freeze({
			materialization: candidate.materialization as D723EffectPortV1,
			"provider-request": candidate.providerRequest as D723EffectPortV1,
			"retry-wait": candidate.retryWait as D723EffectPortV1,
			"tool-action": candidate.toolAction as D723EffectPortV1,
			"hidden-verifier": candidate.hiddenVerifier as D723EffectPortV1,
			cleanup: candidate.cleanup as D723EffectPortV1,
		}),
	});
	return adapter;
}

export async function runD723RealProviderAdapter(inputValue: {
	readonly sourceDigest: string;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly effectCeilings: D720EffectCeilingsV2;
	readonly adapter: D723RealProviderAdapterV1;
	readonly signal?: AbortSignal;
}): Promise<D723AdapterRunV1> {
	const input = record(inputValue, "d723.run");
	exactKeys(
		input,
		Object.hasOwn(input, "signal")
			? ["adapter", "budgetLimits", "effectCeilings", "signal", "sourceDigest"]
			: ["adapter", "budgetLimits", "effectCeilings", "sourceDigest"],
		"d723.run",
	);
	digest(input.sourceDigest, "d723.run.sourceDigest");
	if (Object.hasOwn(input, "signal") && !(input.signal instanceof AbortSignal))
		throw new TypeError("D723 signal is invalid");
	const state =
		typeof input.adapter === "object" && input.adapter !== null
			? adapterStates.get(input.adapter)
			: undefined;
	if (state === undefined || state.consumed)
		throw new TypeError("D723 adapter must be fresh and constructed");
	state.consumed = true;
	let active = 0;
	let maxActive: 0 | 1 = 0;
	let failedEffects = 0;
	const admissionDigests: string[] = [];
	const executor = createD720SimulatedCallerExecutor(async (executionInput) => {
		if (active !== 0) throw new TypeError("D723 forbids parallel effect execution");
		if (admissionDigests.length >= MAX_EFFECT_TRAVERSALS)
			throw new TypeError("D723 effect traversal bound exceeded");
		active = 1;
		maxActive = 1;
		admissionDigests.push(executionInput.admission.decisionDigest);
		try {
			try {
				return validateExecutionEnvelope(
					await state.ports[executionInput.effectRequest.effectKind](executionInput),
					executionInput,
				);
			} catch (error) {
				failedEffects += 1;
				throw error;
			}
		} finally {
			active = 0;
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
	const receipt = Object.freeze({ revision: "graphrefly.b112.d723.adapter-receipt.v1" as const });
	receiptStates.set(receipt, {
		admissionDigests: Object.freeze(admissionDigests.slice()),
		failedEffects,
		maxActive,
		executionClass: state.executionClass,
		consumed: false,
	});
	return Object.freeze({ core, receipt });
}

export function consumeD723AdapterReceipt(
	receipt: D723AdapterReceiptV1,
	core: D722GraphNativeEvalCoreV1,
): D723OperationalSummaryV1 {
	const state =
		typeof receipt === "object" && receipt !== null ? receiptStates.get(receipt) : undefined;
	if (state === undefined || state.consumed)
		throw new TypeError("D723 adapter receipt is invalid or consumed");
	state.consumed = true;
	const admissions = core.ledger.effectAdmissions.filter((entry) => entry.admitted);
	const reconciliations = core.ledger.effectReconciliations;
	if (
		admissions.length !== state.admissionDigests.length ||
		reconciliations.length !== admissions.length
	)
		throw new TypeError("D723 Graph admission/reconciliation coverage drifted");
	for (const [index, admission] of admissions.entries()) {
		if (admission.decisionDigest !== state.admissionDigests[index])
			throw new TypeError("D723 adapter traversal order drifted from Graph");
		if (!reconciliations.some((entry) => entry.effectSequence === admission.effectSequence))
			throw new TypeError("D723 Graph reconciliation is missing");
	}
	return Object.freeze({
		executionClass: state.executionClass,
		graphAdmittedEffectCount: admissions.length,
		graphReconciledEffectCount: reconciliations.length,
		failedEffectCount: state.failedEffects,
		maxActiveInvocations: state.maxActive,
		allEffectsGraphAdmitted: true,
		allUsageGraphReconciled: true,
	});
}

export function createD723Qualification(value: {
	readonly graphEvidenceDigest: string;
	readonly operational: D723OperationalSummaryV1;
	readonly d722ArtifactDigests: typeof D723_D722_ARTIFACT_SHA256;
	readonly executionClass: "injected-no-network";
}) {
	const material = strictSnapshot({
		schemaVersion: D723_QUALIFICATION_SCHEMA,
		decisionRef: D723_DECISION_REF,
		decisionRevision: D723_DECISION_REVISION,
		adapterRevision: D723_ADAPTER_REVISION,
		graphEvidenceDigest: digest(
			value.graphEvidenceDigest,
			"d723.qualification.graphEvidenceDigest",
		),
		d722ArtifactDigests: value.d722ArtifactDigests,
		executionClass: value.executionClass,
		operational: value.operational,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({ ...material, qualificationDigest: empiricalStrictJsonDigest(material) });
}
