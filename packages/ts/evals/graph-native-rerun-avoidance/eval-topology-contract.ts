import type { DescribeSnapshot } from "../../src/graph/describe.js";
import { ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS } from "./eval-topology.js";
import { HARNESS_ARMS } from "./harness-campaign-policy.js";

export const ROOT_EVAL_REQUIRED_NODES = Object.freeze({
	"eval/billing/current-key-before": "state",
	"eval/profile/qualified-catalog": "state",
	"eval/profile/graph-admission": "rootEvalCurrentProfileAdmission",
	"eval/campaign/replicate-controller": "rootEvalReplicateController",
	"eval/work-item/objective-data": "rootEvalWorkItemData",
	"eval/work-item/attempt-resource-plan": "rootEvalWorkItemPlan",
	"eval/solution/work-item-execution/workItemSeeds": "workItemSeedProjector",
	"eval/solution/work-item-execution/plan/runtime": "workItemEffectPlanProjector",
	"eval/work-item/admitted-plan-authority": "rootEvalWorkItemAdmittedPlanAuthority",
	"eval/solution/work-item-execution/effectRuns/runtime": "workItemEffectRunProjector",
	"eval/solution/work-item-execution/requestFacts": "workItemExecutionRequestFacts",
	"eval/solution/agentic-work-item-memory-application/bridge/projection":
		"agenticWorkItemMemoryBridge",
	"eval/solution/agentic-work-item-memory-application/admission/projection":
		"agenticMemoryRecordAdmission",
	"eval/solution/agentic-work-item-memory-application/application/projection":
		"agenticMemoryRecordApplication",
	"eval/solution/agentic-memory-exposure/snapshot": "agenticMemoryRecordUseGate",
	"eval/solution/agentic-memory/projection": "agenticMemoryProjection",
	"eval/solution/agentic-memory/retrieval/snapshot": "memoryRetrievalSnapshot",
	"eval/memory/context-for-work-item": "rootEvalMemoryContextForWorkItem",
	"eval/provider/proposal": "rootEvalProviderProposal",
	"eval/provider/replicate-proposal-batches": "rootEvalReplicateProposalBatches",
	"eval/provider/graph-admission-and-budget": "rootEvalProviderGraphAdmission",
	"eval/provider/result-input": "rootEvalTerminalProviderResultInput",
	"eval/provider/retryable-result-input": "rootEvalRetryableProviderResultInput",
	"eval/provider/result-admission": "rootEvalProviderResultAdmission",
	"eval/provider/retryable-result-admission": "rootEvalRetryableProviderResultAdmission",
	"eval/provider/all-result-admissions": "rootEvalAllProviderResultAdmissions",
	"eval/provider/result-batches": "rootEvalProviderOutcomeBatches",
	"eval/provider/reconciliation": "rootEvalProviderReconciliation",
	"eval/tool/exact-admission": "rootEvalExactToolAdmission",
	"eval/retry/delay-admission": "rootEvalRetryDelayAdmission",
	"eval/executor/current-provider-effect": "rootEvalProviderExecutorBoundary",
	"eval/executor/current-tool-effect": "rootEvalToolExecutorBoundary",
	"eval/executor/current-retry-delay": "rootEvalRetryDelayExecutorBoundary",
	"eval/billing/observation-result-input": "rootEvalBillingObservationResultInput",
	"eval/billing/observation-proposal-and-stopping": "rootEvalBillingObservationProposalAndStopping",
	"eval/billing/observation-proposals": "rootEvalBillingObservationProposals",
	"eval/billing/observation-admission": "rootEvalBillingObservationAdmission",
	"eval/executor/current-billing-observation": "rootEvalBillingObservationExecutorBoundary",
	"eval/billing/reconciliation": "rootEvalBillingReconciliation",
	"eval/executor/provider-effect-lifecycle-registry": "rootEvalEffectLifecycleRegistry",
	"eval/executor/retry-effect-lifecycle-registry": "rootEvalRetryEffectLifecycleRegistry",
	"eval/executor/tool-effect-lifecycle-registry": "rootEvalToolEffectLifecycleRegistry",
	"eval/executor/billing-effect-lifecycle-registry": "rootEvalBillingEffectLifecycleRegistry",
	"eval/executor/active-provider-effects": "rootEvalAllActiveEffects",
	"eval/executor/active-tool-effects": "rootEvalActiveToolEffects",
	"eval/executor/active-retry-effects": "rootEvalActiveRetryEffects",
	"eval/executor/active-billing-effects": "rootEvalActiveBillingEffects",
	"eval/observation/provider-effect-activity": "rootEvalProviderEffectActivity",
	"eval/observation/tool-effect-activity": "rootEvalToolEffectActivity",
	"eval/observation/retry-effect-activity": "rootEvalRetryEffectActivity",
	"eval/observation/billing-effect-activity": "rootEvalBillingEffectActivity",
	"eval/observation/effect-activity": "rootEvalEffectActivityTimeline",
	"eval/executor/caller-admitted-effect": "rootEvalCallerAdmittedEffectGate",
	"eval/executor/caller-admitted-tool-effect": "rootEvalCallerAdmittedToolEffectGate",
	"eval/executor/caller-admitted-retry-effect": "rootEvalCallerAdmittedRetryEffectGate",
	"eval/executor/caller-admitted-billing-effect": "rootEvalCallerAdmittedBillingEffectGate",
	"eval/tool/result": "rootEvalExactToolResult",
	"eval/verification/diff": "rootEvalDiffVerification",
	"eval/verification/public-semantic": "rootEvalPublicSemanticVerification",
	"eval/verification/hidden-verifier": "rootEvalHiddenVerifier",
	"eval/cleanup/completed": "rootEvalCleanup",
	"eval/verification/diagnostics": "rootEvalVerificationDiagnostics",
	"eval/budget/state": "rootEvalBudgetState",
	"eval/retry/proposal": "rootEvalRetryProposal",
	"eval/retry/proposal-fact": "rootEvalRetryProposalFact",
	"eval/findings/efficacy-state": "rootEvalEfficacyState",
	"eval/findings/efficacy": "rootEvalEfficacyFinding",
	"eval/observation/terminal-lifecycle-consistency": "rootEvalTerminalLifecycleConsistency",
	"eval/controls/memory-provenance": "state",
	"eval/observation/inputs": "combine",
	"eval/observation/events": "rootEvalObservationEvents",
	"eval/observation": "rootEvalGraphNativeObservation",
} as const);

export const ROOT_EVAL_CRITICAL_EDGES = Object.freeze([
	["eval/profile/qualified-catalog", "eval/profile/graph-admission"],
	["eval/campaign/start", "eval/campaign/replicate-controller"],
	["eval/cleanup/completed", "eval/campaign/replicate-controller"],
	["eval/campaign/replicate-controller", "eval/campaign/replicate-batches"],
	["eval/campaign/replicate-batches", "eval/work-item/objective-data"],
	["eval/work-item/objective-data", "eval/solution/work-item-execution/workItemSeeds"],
	["eval/work-item/attempt-resource-plan", "eval/solution/work-item-execution/plan/runtime"],
	[
		"eval/solution/work-item-execution/plan/effectRequests",
		"eval/solution/work-item-execution/effectRuns/runtime",
	],
	[
		"eval/solution/work-item-execution/effectRuns/effectRuns",
		"eval/solution/work-item-execution/requestFacts",
	],
	[
		"eval/work-item/objective-data",
		"eval/solution/agentic-work-item-memory-application/bridge/projection",
	],
	[
		"eval/solution/agentic-work-item-memory-application/bridge/proposals",
		"eval/solution/agentic-work-item-memory-application/admission/projection",
	],
	[
		"eval/solution/agentic-work-item-memory-application/admission/admissions",
		"eval/solution/agentic-work-item-memory-application/application/projection",
	],
	[
		"eval/solution/agentic-work-item-memory-application/application/records",
		"eval/solution/agentic-memory-exposure/snapshot",
	],
	["eval/memory/exposure-request", "eval/solution/agentic-memory-exposure/snapshot"],
	["eval/memory/exposure-decisions", "eval/solution/agentic-memory-exposure/snapshot"],
	[
		"eval/solution/agentic-memory-exposure/allowedRecords",
		"eval/solution/agentic-memory/projection",
	],
	["eval/solution/agentic-memory/fragments", "eval/solution/agentic-memory/retrieval/snapshot"],
	["eval/solution/work-item-execution/requests", "eval/provider/proposal"],
	["eval/solution/work-item-execution/plan/admitted", "eval/work-item/admitted-plan-authority"],
	["eval/work-item/admitted-plan-authority", "eval/provider/proposal"],
	["eval/profile/graph-admission", "eval/provider/proposal"],
	["eval/provider/proposal", "eval/provider/replicate-proposal-batches"],
	["eval/provider/replicate-proposal-batches", "eval/provider/proposals"],
	["eval/retry/proposal", "eval/provider/proposals"],
	["eval/provider/replicate-proposal-batches", "eval/provider/graph-admission-and-budget"],
	["eval/retry/proposal-fact", "eval/provider/graph-admission-and-budget"],
	["eval/work-item/admitted-plan-authority", "eval/provider/graph-admission-and-budget"],
	["eval/provider/result-input", "eval/provider/result-admission"],
	["eval/provider/retryable-result-input", "eval/provider/retryable-result-admission"],
	["eval/provider/result-admission", "eval/provider/all-result-admissions"],
	["eval/provider/retryable-result-admission", "eval/provider/all-result-admissions"],
	["eval/provider/result-admission", "eval/provider/result-batches"],
	["eval/provider/retryable-result-admission", "eval/provider/result-batches"],
	["eval/provider/result-admission", "eval/provider/graph-admission-and-budget"],
	["eval/provider/retryable-result-admission", "eval/provider/graph-admission-and-budget"],
	["eval/provider/graph-admission-and-budget", "eval/provider/admissions"],
	["eval/provider/graph-admission-and-budget", "eval/budget/state"],
	["eval/provider/admissions", "eval/executor/current-provider-effect"],
	["eval/provider/result-admission", "eval/tool/exact-admission"],
	["eval/tool/exact-admission", "eval/executor/current-tool-effect"],
	["eval/provider/result-batches", "eval/retry/delay-admission"],
	["eval/retry/delay-admission", "eval/executor/current-retry-delay"],
	["eval/cleanup/completed", "eval/billing/observation-proposal-and-stopping"],
	["eval/budget/state", "eval/billing/observation-proposal-and-stopping"],
	["eval/billing/observation-result-input", "eval/billing/observation-proposal-and-stopping"],
	["eval/billing/current-key-before", "eval/billing/observation-proposal-and-stopping"],
	["eval/billing/observation-proposal-and-stopping", "eval/billing/observation-proposals"],
	["eval/billing/observation-proposals", "eval/billing/observation-admission"],
	["eval/billing/current-key-before", "eval/billing/observation-admission"],
	["eval/billing/observation-admission", "eval/executor/current-billing-observation"],
	["eval/billing/observation-proposal-and-stopping", "eval/billing/reconciliation"],
	["eval/retry/delay-result-input", "eval/retry/proposal-fact"],
	["eval/retry/proposal-fact", "eval/retry/proposal"],
	["eval/executor/current-provider-effect", "eval/executor/provider-effect-lifecycle-registry"],
	["eval/provider/all-result-admissions", "eval/executor/provider-effect-lifecycle-registry"],
	["eval/campaign/start", "eval/executor/provider-effect-lifecycle-registry"],
	["eval/executor/current-retry-delay", "eval/executor/retry-effect-lifecycle-registry"],
	["eval/retry/delay-result-input", "eval/executor/retry-effect-lifecycle-registry"],
	["eval/campaign/start", "eval/executor/retry-effect-lifecycle-registry"],
	["eval/executor/current-tool-effect", "eval/executor/tool-effect-lifecycle-registry"],
	["eval/tool/result-input", "eval/executor/tool-effect-lifecycle-registry"],
	["eval/campaign/start", "eval/executor/tool-effect-lifecycle-registry"],
	["eval/executor/current-billing-observation", "eval/executor/billing-effect-lifecycle-registry"],
	["eval/billing/observation-result-input", "eval/executor/billing-effect-lifecycle-registry"],
	["eval/campaign/start", "eval/executor/billing-effect-lifecycle-registry"],
	["eval/executor/provider-effect-lifecycle-registry", "eval/executor/active-provider-effects"],
	["eval/executor/tool-effect-lifecycle-registry", "eval/executor/active-tool-effects"],
	["eval/executor/retry-effect-lifecycle-registry", "eval/executor/active-retry-effects"],
	["eval/executor/billing-effect-lifecycle-registry", "eval/executor/active-billing-effects"],
	["eval/executor/provider-effect-lifecycle-registry", "eval/observation/provider-effect-activity"],
	["eval/executor/tool-effect-lifecycle-registry", "eval/observation/tool-effect-activity"],
	["eval/executor/retry-effect-lifecycle-registry", "eval/observation/retry-effect-activity"],
	["eval/executor/billing-effect-lifecycle-registry", "eval/observation/billing-effect-activity"],
	["eval/observation/provider-effect-activity", "eval/observation/effect-activity"],
	["eval/observation/tool-effect-activity", "eval/observation/effect-activity"],
	["eval/observation/retry-effect-activity", "eval/observation/effect-activity"],
	["eval/observation/billing-effect-activity", "eval/observation/effect-activity"],
	["eval/budget/state", "eval/observation/effect-activity"],
	["eval/executor/provider-effect-lifecycle-registry", "eval/executor/caller-admitted-effect"],
	["eval/executor/tool-effect-lifecycle-registry", "eval/executor/caller-admitted-tool-effect"],
	["eval/executor/retry-effect-lifecycle-registry", "eval/executor/caller-admitted-retry-effect"],
	[
		"eval/executor/billing-effect-lifecycle-registry",
		"eval/executor/caller-admitted-billing-effect",
	],
	["eval/provider/result-admission", "eval/effect/terminal-outcomes"],
	["eval/tool/result-input", "eval/effect/terminal-outcomes"],
	["eval/effect/terminal-outcomes", "eval/provider/reconciliation"],
	["eval/effect/terminal-outcomes", "eval/tool/result"],
	["eval/tool/result", "eval/verification/diff"],
	["eval/provider/reconciliation", "eval/solution/work-item-execution/plan/runtime"],
	["eval/verification/diff", "eval/verification/public-semantic"],
	["eval/verification/public-semantic", "eval/verification/hidden-verifier"],
	["eval/verification/hidden-verifier", "eval/cleanup/completed"],
	["eval/campaign/start", "eval/verification/diagnostics"],
	["eval/cleanup/completed", "eval/verification/diagnostics"],
	["eval/verification/diagnostics", "eval/findings/efficacy-state"],
	["eval/budget/state", "eval/findings/efficacy-state"],
	["eval/campaign/state", "eval/findings/efficacy-state"],
	["eval/billing/observation-proposal-and-stopping", "eval/findings/efficacy-state"],
	["eval/findings/efficacy-state", "eval/findings/efficacy"],
	["eval/billing/reconciliation", "eval/findings/efficacy"],
	["eval/observation/effect-activity", "eval/findings/efficacy"],
	["eval/findings/efficacy", "eval/observation/terminal-lifecycle-consistency"],
	["eval/observation/effect-activity", "eval/observation/terminal-lifecycle-consistency"],
	["eval/budget/state", "eval/observation/terminal-lifecycle-consistency"],
	["eval/campaign/start", "eval/observation/terminal-lifecycle-consistency"],
	["eval/solution/agentic-memory/retrieval/ranked", "eval/memory/context-for-work-item"],
	["eval/memory/candidate-frame", "eval/memory/context-for-work-item"],
	["eval/memory/context-for-work-item", "eval/work-item/attempt-resource-plan"],
	["eval/profile/graph-admission", "eval/work-item/attempt-resource-plan"],
	["eval/campaign/state", "eval/observation/inputs"],
	["eval/controls/memory-provenance", "eval/observation/inputs"],
	["eval/findings/efficacy-state", "eval/observation/inputs"],
	["eval/observation/inputs", "eval/observation/events"],
	["eval/findings/efficacy", "eval/observation/events"],
	["eval/observation/events", "eval/observation"],
	["eval/observation/effect-activity", "eval/observation"],
	["eval/observation/terminal-lifecycle-consistency", "eval/observation"],
] as const);

export interface RootEvalTopologyContractReport {
	readonly rootGraphs: 1;
	readonly mounts: 0;
	readonly requiredNodes: number;
	readonly criticalEdges: number;
	readonly armOrder: typeof HARNESS_ARMS;
	readonly treatment: "relevant-applied";
	readonly controls: readonly [
		"cold",
		"proposal-only",
		"admission-rejected",
		"irrelevant-applied",
		"wrong-scope-applied",
	];
}

function sameArmOrder(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.length === HARNESS_ARMS.length &&
		value.every((arm, index) => arm === HARNESS_ARMS[index])
	);
}

export function assertRootEvalTopologyContract(
	snapshot: DescribeSnapshot,
): RootEvalTopologyContractReport {
	if (snapshot.name !== "eval/root")
		throw new Error("topology contract: root graph identity missing");
	if ((snapshot.subgraphs?.length ?? 0) !== 0)
		throw new Error("topology contract: hidden or mounted Graph detected");
	const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
	if (nodes.size !== snapshot.nodes.length)
		throw new Error("topology contract: duplicate node identity");
	for (const [id, factory] of Object.entries(ROOT_EVAL_REQUIRED_NODES)) {
		const node = nodes.get(id);
		if (node === undefined) throw new Error(`topology contract: missing node '${id}'`);
		if (node.factory !== factory)
			throw new Error(`topology contract: solution identity drift at '${id}'`);
	}
	const edges = new Set(snapshot.edges.map((edge) => `${edge.from}\n${edge.to}`));
	for (const [from, to] of ROOT_EVAL_CRITICAL_EDGES) {
		if (!nodes.has(from) || !nodes.has(to))
			throw new Error(`topology contract: missing critical node endpoint '${from}' -> '${to}'`);
		if (!edges.has(`${from}\n${to}`))
			throw new Error(`topology contract: missing critical edge '${from}' -> '${to}'`);
	}
	const start = nodes.get("eval/campaign/start");
	if (!sameArmOrder(start?.meta?.armOrder))
		throw new Error("topology contract: six-arm canonical order drift");
	if (start?.meta?.replicateCount !== 5)
		throw new Error("topology contract: five-replicate campaign drift");
	const provenance = nodes.get("eval/controls/memory-provenance");
	if (provenance?.meta?.treatment !== "relevant-applied" || provenance.meta.controls !== 5)
		throw new Error("topology contract: treatment/control identity drift");
	const workItemPlan = nodes.get("eval/work-item/attempt-resource-plan");
	if (
		workItemPlan?.meta?.timeoutAuthority !== "work-item-effect-plan" ||
		workItemPlan.meta.effectTimeoutMs !== ROOT_EVAL_DEFAULT_EFFECT_TIMEOUT_MS
	)
		throw new Error("topology contract: Work Item effect timeout authority drift");
	const providerAdmission = nodes.get("eval/provider/graph-admission-and-budget");
	const providerProposal = nodes.get("eval/provider/proposal");
	if (providerProposal?.meta?.timeoutAuthority !== "reads-work-item-plan-data")
		throw new Error("topology contract: provider proposal timeout dependency drift");
	if (providerAdmission?.meta?.timeoutAuthority !== "copied-from-work-item-plan")
		throw new Error("topology contract: provider timeout admission drift");
	const observation = nodes.get("eval/observation");
	if (
		observation?.meta?.materialFree !== true ||
		observation.meta.sanitizer !== false ||
		observation.meta.authority !== "read-only-projection"
	)
		throw new Error("topology contract: raw observation policy drift");
	if (snapshot.nodes.filter((node) => node.id === "eval/observation").length !== 1)
		throw new Error("topology contract: canonical observation identity drift");
	const diagnostics = nodes.get("eval/verification/diagnostics");
	if (
		diagnostics?.meta?.domainAuthority !== "graph-state" ||
		diagnostics.meta.materialFree !== true
	)
		throw new Error("topology contract: verification diagnostics authority drift");
	const raw = JSON.stringify(snapshot);
	for (const forbidden of [
		"api_key",
		"authorization",
		"provider body",
		"tool arguments",
		"private-marker",
	])
		if (raw.toLowerCase().includes(forbidden))
			throw new Error(`topology contract: raw material leaked through '${forbidden}'`);
	return Object.freeze({
		rootGraphs: 1,
		mounts: 0,
		requiredNodes: Object.keys(ROOT_EVAL_REQUIRED_NODES).length,
		criticalEdges: ROOT_EVAL_CRITICAL_EDGES.length,
		armOrder: HARNESS_ARMS,
		treatment: "relevant-applied",
		controls: [
			"cold",
			"proposal-only",
			"admission-rejected",
			"irrelevant-applied",
			"wrong-scope-applied",
		] as const,
	});
}
