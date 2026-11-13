import { describe, expect, it, vi } from "vitest";
import {
	openPersistentAgenticMemoryRecords,
	persistAgenticMemoryRecords,
} from "../adapters/agentic-memory-storage.js";
import {
	remoteResponder,
	wireBridge,
	wireBridgeAckDriver,
	wireBridgeProtobuf,
} from "../adapters/bridge.js";
import { remoteCall } from "../adapters/bridge-remote-call.js";
import type { RemoteCallRequest, RemoteCallResponse } from "../adapters/bridge-types.js";
import {
	frameSource,
	wireEdgeGroupIn,
	wireEdgeGroupOut,
} from "../adapters/bridge-wire-edge-group.js";
import { toHttp, toProcess, toWebSocket } from "../adapters/environment-outbound.js";
import { webSocketSession } from "../adapters/environment-websocket-session.js";
import { attachKeyedRateLimitAuthority } from "../adapters/keyed-rate-limit-authority.js";
import {
	openPersistentReactiveIndex,
	openPersistentReactiveList,
	openPersistentReactiveLog,
	openPersistentReactiveMap,
	persistReactiveCollection,
} from "../adapters/reactive-collection-storage.js";
import { cqrs, cqrsProjection } from "../cqrs/index.js";
import {
	cqrsEventOutboxCommands,
	cqrsMessageAckCommands,
	cqrsMessagingRecipe,
} from "../cqrs/messaging.js";
import { cqrsWorkQueueRecipe } from "../cqrs/work-queue.js";
import { customerHostedPostgresqlRuntime } from "../executors/customer-hosted-postgresql.js";
import { localHostExecutionGate } from "../executors/execution-environment.js";
import { localContainerPostgresqlRuntime } from "../executors/local-container-postgresql.js";
import { localUntrustedJsComputeRuntime } from "../executors/local-untrusted-js-compute.js";
import { managedCloudPostgresqlRuntime } from "../executors/managed-cloud-postgresql.js";
import { managedUntrustedJsComputeRuntime } from "../executors/managed-untrusted-js-compute.js";
import { postgresqlToolProviderRuntime } from "../executors/postgresql-tool-provider.js";
import { toolProviderExecutionRecipe } from "../executors/tool-provider.js";
import { httpToolProviderRuntime } from "../executors/tool-provider-adapters.js";
import { executorWorkQueueRecipe } from "../executors/work-queue.js";
import { reactiveCascadingCache } from "../graph/cascading-cache.js";
import { reactiveIndex } from "../graph/data-structures/reactive-index.js";
import { reactiveList } from "../graph/data-structures/reactive-list.js";
import { reactiveLog } from "../graph/data-structures/reactive-log.js";
import { reactiveMap } from "../graph/data-structures/reactive-map.js";
import { type Graph, graph } from "../graph/graph.js";
import * as topology from "../graph/topology.js";
import { workerDerived } from "../graph/worker.js";
import { messageBus, toTopic } from "../messaging/index.js";
import type { Node } from "../node/node.js";
import { attachToolProviderAdapterRuntime } from "../orchestration/agent-runtime-adapter-runtime.js";
import { structuredAgentDecisionInterpreter } from "../orchestration/agent-runtime-decision-interpreter.js";
import { effectRunCompletionProjector } from "../orchestration/agent-runtime-effect-completion.js";
import { executorOutcomeViewProjector } from "../orchestration/agent-runtime-outcome-view.js";
import { agentRequestLedgerViews } from "../orchestration/agent-runtime-request-ledger.js";
import { requestSatisfactionProjector } from "../orchestration/agent-runtime-request-satisfaction.js";
import { toolProviderAdapterInputProjector } from "../orchestration/agent-runtime-tool-provider-input.js";
import { toolProviderPolicyResolutionProjector } from "../orchestration/agent-runtime-tool-provider-policy.js";
import { toolProviderRunAdmissionProjector } from "../orchestration/agent-runtime-tool-provider-run-admission.js";
import { toolProviderRunRetryProjector } from "../orchestration/agent-runtime-tool-provider-run-retry.js";
import {
	orchestrationMessageAckCommands,
	orchestrationMessagingRecipe,
	processEventOutboxCommands,
} from "../orchestration/messaging.js";
import { processBundle, processEffectRunner } from "../orchestration/process.js";
import {
	breakerBundle,
	retryStatusBundle,
	timeoutBundle,
} from "../orchestration/resilience-bundles.js";
import { scheduledReadinessProjector } from "../orchestration/scheduled-readiness.js";
import { workItemDomainActionAdmissionProjector } from "../orchestration/work-item-runtime-admission.js";
import { orchestrationWorkQueueRecipe } from "../orchestration/work-queue.js";
import {
	workQueueLeaseExpirationCommandProjector,
	workQueueReadinessHandoffProjector,
	workQueueScheduledReadinessProjector,
} from "../orchestration/work-queue-scheduled-readiness.js";
import { admissionHandoff } from "../patterns/admission-handoff.js";
import { eventFlow, eventFlowProjection } from "../patterns/event-flow.js";
import {
	knowledgeGraphReducerBundle,
	memoryRetrievalBundle,
} from "../patterns/semantic-memory-graph.js";
import { keyedRateLimitAdmissionBundle } from "../rate-limit/keyed-rate-limit.js";
import { localFixedWindowRateLimitBundle } from "../rate-limit/local-fixed-window.js";
import { agenticMemoryRecordAdmissionPolicySourceBundle } from "../solutions/agentic-memory/admission-policy-source.js";
import {
	agenticMemoryRecordApplicationEvidenceFactsBundle,
	agenticMemoryRecordApplicationPriorEvidenceBundle,
} from "../solutions/agentic-memory/application-history.js";
import { agenticMemoryBundle } from "../solutions/agentic-memory/bundle.js";
import { agenticMemoryConsolidationBundle } from "../solutions/agentic-memory/consolidation.js";
import { agenticMemoryConsolidationApplicationBundle } from "../solutions/agentic-memory/consolidation-application.js";
import { agenticMemoryContextPackingBundle } from "../solutions/agentic-memory/context-packing.js";
import { agenticMemoryDurabilityGateBundle } from "../solutions/agentic-memory/durable-result.js";
import { agenticMemoryMaterializedFactLogBootstrapBundle } from "../solutions/agentic-memory/fact-log-bootstrap.js";
import { agenticMemoryCommittedFactReadMaterializationBundle } from "../solutions/agentic-memory/fact-log-read-materialization.js";
import { agenticMemoryKgProjectionBundle } from "../solutions/agentic-memory/kg.js";
import { agenticMemoryRecordMaterializerBundle } from "../solutions/agentic-memory/materializer.js";
import { agenticMemoryRecordAdmissionBundle } from "../solutions/agentic-memory/proposal-admission.js";
import { agenticMemoryRecordApplicationBundle } from "../solutions/agentic-memory/record-application.js";
import { agenticMemoryRecordUseGateBundle } from "../solutions/agentic-memory/record-use.js";
import { agenticMemoryRetentionBundle } from "../solutions/agentic-memory/retention.js";
import {
	agenticMemoryApplicationEvidenceStoreFrameBundle,
	agenticMemoryRecordStoreFrameBundle,
} from "../solutions/agentic-memory/store-frame.js";
import { agenticWorkItemMemoryBridgeBundle } from "../solutions/agentic-work-item-memory/bridge.js";
import { agenticWorkItemMemoryApplicationRecipeBundle } from "../solutions/agentic-work-item-memory-application/recipe.js";
import { capabilityAdmissionProjector } from "../solutions/capability-admission.js";
import { causalOccurrenceBundle } from "../solutions/causal-occurrence.js";
import { clickHouseTrustedQueryRuntime } from "../solutions/clickhouse-trusted-query-evaluation.js";
import { canvasTextMeasurements } from "../solutions/reactive-layout/browser/index.js";
import {
	reactiveBlockLayout,
	reactiveFlowLayout,
	reactiveLayout,
} from "../solutions/reactive-layout/bundles.js";
import {
	blockAdaptersProvider,
	blockMeasurementProvider,
	capabilityTextMeasurements,
	cellTextMeasurements,
	imageSizeMeasurements,
	injectedTextMeasurements,
	mergeMeasurements,
	precomputedTextMeasurements,
	readinessMeasurements,
	readinessTextMeasurements,
	svgBoundsMeasurements,
	textMeasurementProvider,
} from "../solutions/reactive-layout/measurements.js";
import { nodeCanvasTextMeasurements } from "../solutions/reactive-layout/node-canvas/index.js";
import { reactNativeLayoutMeasurements } from "../solutions/reactive-layout/react-native/index.js";
import { skiaTextMeasurements } from "../solutions/reactive-layout/skia/index.js";
import { workItemDomainActionApplicationProjector } from "../solutions/work-item/actions-application.js";
import { workItemDomainActionCapabilityGuardProjector } from "../solutions/work-item/actions-capability-guard.js";
import { workItemDomainActionProposalIntakeProjector } from "../solutions/work-item/actions-intake.js";
import {
	workItemExecutionRecipe,
	workItemSeedProjector,
} from "../solutions/work-item/execution.js";
import { workItemAuthoringProjector } from "../solutions/work-item/scheduling-authoring.js";
import { workItemEffectPlanProjector } from "../solutions/work-item/scheduling-effect-plan.js";
import {
	workItemVerificationRequestLowerer,
	workItemVerificationResultMapper,
} from "../solutions/work-item/scheduling-verification.js";
import { workItemWorkQueueRecipe } from "../solutions/work-item/work-queue.js";
import {
	workspaceProposalDomainActionApplicationProjector,
	workspaceProposalFamilyApplicationDiagnosticProjector,
	workspaceProposalFamilyApplicationReadModelProjector,
	workspaceProposalFamilyApplicationReadModelsProjector,
	workspaceProposalFamilyOutcomeDetailSupplyProjector,
	workspaceProposalProjectionReleaseDiagnosticProjector,
	workspaceProposalRepairActionDescriptorProjector,
	workspaceProposalRepairActionDisplayPolicyAdvisoryProjector,
	workspaceProposalRepairActionIntentProjector,
	workspaceProposalRepairReviewDecisionRecordingProjector,
	workspaceProposalRepairReviewProjector,
	workspaceProposalRepairReviewStatusProjector,
	workspaceProposalRepairSuccessorProposalIntakePreviewProjector,
	workspaceProposalRepairSuccessorProposalReadyRequestPreparationProjector,
	workspaceProposalRequiredInputResponseApplicationProjector,
	workspaceProposalWorkItemLinkApplicationProjector,
	workspaceProposalWorkItemSpawnApplicationProjector,
} from "../solutions/work-item/workspace-family-applications.js";
import { memoryKv } from "../storage/index.js";
import { workQueue } from "../work-queue/index.js";

// Cold prerequisite nodes carry no data; execution callbacks fail if activated.
// biome-ignore lint/suspicious/noExplicitAny: constructor catalogue supplies heterogeneous module inputs.
type Input = (name: string) => Node<any>;
type Build = (g: Graph, input: Input, suppliedName?: string) => unknown;
function cold(): never {
	throw new Error("cold naming scan must not execute a host callback");
}
const constructors: [string, Build][] = [
	[
		"lazyCollectionMethods",
		(g, input, suppliedName) => {
			const list = reactiveList<number>(g, [], { name: suppliedName });
			list.appendFrom(input("listValues"));
			const map = reactiveMap<string, number>(g);
			map.select((value) => value > 0);
			map.select((value) => value < 0);
			map.select((value) => value === 0);
			const index = reactiveIndex<string, number>(g);
			index.range("a", "z");
			index.range("b", "y");
			const log = reactiveLog<number>(g);
			log.page(0, 1);
			log.page(1, 2);
		},
	],
	[
		"lazyMessageBusProjections",
		(g, input, suppliedName) => {
			const bus = messageBus(g, { name: suppliedName });
			bus.topic("jobs");
			bus.catalog();
			bus.deadLetter();
			bus.subscription({ topic: "jobs", subscriptionId: "worker" });
			toTopic(g, input("source"), bus, "jobs");
		},
	],

	[
		"nodeCanvasTextMeasurements",
		(g, input, suppliedName) =>
			nodeCanvasTextMeasurements({
				graph: g,
				text: input("text"),
				font: input("font"),
				context: input("context"),
				name: suppliedName,
			}),
	],
	[
		"causalOccurrenceBundle",
		(g, input, suppliedName) =>
			causalOccurrenceBundle(g, {
				name: suppliedName ?? "causalOccurrence",
				occurrences: input("occurrences"),
				admissions: input("admissions"),
				branchTerminals: input("branchTerminals"),
				effectProposals: input("effectProposals"),
				effectAdmissions: input("effectAdmissions"),
				effectOutcomes: input("effectOutcomes"),
				evidence: input("evidence"),
				watermarks: input("watermarks"),
				requiredBranches: ["branch"],
				requiredEvidenceKinds: [],
				maxOccurrences: 1,
				maxPending: 1,
				maxEffects: 1,
				maxEvidence: 1,
			}),
	],
	[
		"admissionHandoff",
		(g, input, suppliedName) =>
			admissionHandoff(g, {
				candidates: input("candidates"),
				decisions: input("decisions"),
				maxPending: 1,
				maxRecent: 1,
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryApplicationEvidenceStoreFrameBundle",
		(g, input, suppliedName) =>
			agenticMemoryApplicationEvidenceStoreFrameBundle(g, {
				storeFrame: input("storeFrame"),
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryBundle",
		(g, input, suppliedName) =>
			agenticMemoryBundle(g, {
				records: input("records"),
				query: input("query"),
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryCommittedFactReadMaterializationBundle",
		(g, input, suppliedName) =>
			agenticMemoryCommittedFactReadMaterializationBundle(g, {
				readResult: input("readResult"),
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryConsolidationApplicationBundle",
		(g, input, suppliedName) =>
			agenticMemoryConsolidationApplicationBundle(g, {
				occurrences: input("occurrences"),
				maxOccurrences: 1,
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryConsolidationBundle",
		(g, input, suppliedName) =>
			agenticMemoryConsolidationBundle(g, {
				occurrences: input("occurrences"),
				maxOccurrences: 1,
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryContextPackingBundle",
		(g, input, suppliedName) =>
			agenticMemoryContextPackingBundle(g, {
				context: input("context"),
				texts: input("texts"),
				policy: input("policy"),
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryDurabilityGateBundle",
		(g, input, suppliedName) =>
			agenticMemoryDurabilityGateBundle(g, {
				attemptResult: input("attemptResult"),
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryKgProjectionBundle",
		(g, input, suppliedName) =>
			agenticMemoryKgProjectionBundle(g, {
				records: input("records"),
				drafts: input("drafts"),
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryMaterializedFactLogBootstrapBundle",
		(g, input, suppliedName) =>
			agenticMemoryMaterializedFactLogBootstrapBundle(g, {
				materialization: input("materialization"),
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryRecordAdmissionBundle",
		(g, input, suppliedName) =>
			agenticMemoryRecordAdmissionBundle(g, {
				occurrences: input("occurrences"),
				maxOccurrences: 1,
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryRecordAdmissionPolicySourceBundle",
		(g, input, suppliedName) =>
			agenticMemoryRecordAdmissionPolicySourceBundle(g, {
				policySources: input("policySources"),
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryRecordApplicationBundle",
		(g, input, suppliedName) =>
			agenticMemoryRecordApplicationBundle(g, {
				occurrences: input("occurrences"),
				maxOccurrences: 1,
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryRecordApplicationEvidenceFactsBundle",
		(g, input, suppliedName) =>
			agenticMemoryRecordApplicationEvidenceFactsBundle(g, {
				applicationDecisions: input("applicationDecisions"),
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryRecordApplicationPriorEvidenceBundle",
		(g, input, suppliedName) =>
			agenticMemoryRecordApplicationPriorEvidenceBundle(g, {
				evidenceFacts: input("evidenceFacts"),
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryRecordMaterializerBundle",
		(g, input, suppliedName) =>
			agenticMemoryRecordMaterializerBundle(g, {
				records: input("records"),
				intents: input("intents"),
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryRecordStoreFrameBundle",
		(g, input, suppliedName) =>
			agenticMemoryRecordStoreFrameBundle(g, {
				storeFrame: input("storeFrame"),
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryRecordUseGateBundle",
		(g, input, suppliedName) =>
			agenticMemoryRecordUseGateBundle(g, {
				occurrences: input("occurrences"),
				maxOccurrences: 1,
				name: suppliedName,
			}),
	],
	[
		"agenticMemoryRetentionBundle",
		(g, input, suppliedName) =>
			agenticMemoryRetentionBundle(g, {
				records: input("records"),
				commands: input("commands"),
				name: suppliedName,
			}),
	],
	[
		"agenticWorkItemMemoryApplicationRecipeBundle",
		(g, input, suppliedName) =>
			agenticWorkItemMemoryApplicationRecipeBundle(g, {
				through: "bridge",
				occurrences: input("occurrences"),
				maxOccurrences: 1,
				name: suppliedName,
			}),
	],
	[
		"agenticWorkItemMemoryBridgeBundle",
		(g, input, suppliedName) =>
			agenticWorkItemMemoryBridgeBundle(g, {
				occurrences: input("occurrences"),
				maxOccurrences: 1,
				name: suppliedName,
			}),
	],
	[
		"agentRequestLedgerViews",
		(g, input, suppliedName) => agentRequestLedgerViews(g, input("facts"), { name: suppliedName }),
	],
	[
		"attachKeyedRateLimitAuthority",
		(g, input, suppliedName) =>
			attachKeyedRateLimitAuthority(
				g,
				input("requests"),
				{ consume: cold },
				{ name: suppliedName },
			),
	],
	[
		"attachToolProviderAdapterRuntime",
		(g, input, suppliedName) =>
			attachToolProviderAdapterRuntime(g, {
				inputs: input("inputs"),
				bindings: [],
				retention: { executions: { maxSize: 2 }, runStatuses: { maxSize: 3 } },
				name: suppliedName,
			}),
	],
	[
		"blockAdaptersProvider",
		(g, _input, suppliedName) => blockAdaptersProvider({ graph: g, name: suppliedName }),
	],
	[
		"blockMeasurementProvider",
		(g, input, suppliedName) =>
			blockMeasurementProvider({
				graph: g,
				blocks: input("blocks"),
				maxWidth: input("maxWidth"),
				adapters: input("adapters"),
				name: suppliedName,
			}),
	],
	[
		"breakerBundle",
		(g, input, suppliedName) =>
			breakerBundle(g, input("events"), { failureThreshold: 1, name: suppliedName }),
	],
	[
		"canvasTextMeasurements",
		(g, input, suppliedName) =>
			canvasTextMeasurements({
				graph: g,
				text: input("text"),
				font: input("font"),
				name: suppliedName,
			}),
	],
	[
		"capabilityAdmissionProjector",
		(g, input, suppliedName) =>
			capabilityAdmissionProjector(g, {
				proposals: input("proposals"),
				decisions: input("decisions"),
				name: suppliedName,
			}),
	],
	[
		"capabilityTextMeasurements",
		(g, input, suppliedName) =>
			capabilityTextMeasurements({
				capability: input("capability"),
				graph: g,
				text: input("text"),
				font: input("font"),
				name: suppliedName,
			}),
	],
	[
		"cellTextMeasurements",
		(g, input, suppliedName) =>
			cellTextMeasurements({
				graph: g,
				text: input("text"),
				font: input("font"),
				name: suppliedName,
			}),
	],
	[
		"clickHouseTrustedQueryRuntime",
		(g, input, suppliedName) =>
			clickHouseTrustedQueryRuntime(g, {
				inputs: input("inputs"),
				admittedRunRequests: [input("admittedRunRequests")],
				capability: { execute: cold },
				name: suppliedName,
			}),
	],
	["cqrs", (g, _input, suppliedName) => cqrs(g, { name: suppliedName })],
	[
		"cqrsEventOutboxCommands",
		(g, input, suppliedName) =>
			cqrsEventOutboxCommands(g, input("events"), "topic", { name: suppliedName }),
	],
	[
		"cqrsMessageAckCommands",
		(g, input, suppliedName) =>
			cqrsMessageAckCommands(g, {
				commands: input("commands"),
				status: input("status"),
				name: suppliedName,
			}),
	],
	[
		"cqrsMessagingRecipe",
		(g, input, suppliedName) =>
			cqrsMessagingRecipe(g, {
				deliveries: input("deliveries"),
				status: input("status"),
				name: suppliedName,
			}),
	],
	[
		"cqrsProjection",
		(g, input, suppliedName) =>
			cqrsProjection(
				g,
				{ events: input("events") },
				{ initial: undefined, reducer: cold, name: suppliedName },
			),
	],
	[
		"cqrsWorkQueueRecipe",
		(g, input, suppliedName) =>
			cqrsWorkQueueRecipe(g, {
				records: input("records"),
				status: input("status"),
				name: suppliedName,
			}),
	],
	[
		"customerHostedPostgresqlRuntime",
		(g, input, suppliedName) =>
			customerHostedPostgresqlRuntime(g, {
				inputs: input("inputs"),
				approvedRunRequestNodes: [],
				releaseNodes: [],
				enrollmentNodes: [],
				readinessNodes: [],
				store: {
					compatibility: "postgresql-16-customer-hosted-cas-v1",
					schemaRevision: "customer-hosted-postgresql-control-v1",
					upsertEnrollment: cold,
					admit: cold,
					claim: cold,
					heartbeat: cold,
					persistCancellation: cold,
					acknowledgeCancellation: cold,
					settle: cold,
					acceptOfflineEvidence: cold,
					revoke: cold,
					disconnect: cold,
					expire: cold,
					close: cold,
				},
				transport: {
					protocolRevision: "customer-hosted-postgresql-outbound-wss-v1",
					// Construction opens the transport contract; this inert stub owns no I/O.
					start: () => undefined,
					send: cold,
					close: cold,
				},
				trust: { verifyServer: cold, verifyEnrollment: cold },
				workerDriver: {
					execute: cold,
					stop: cold,
					kill: cold,
					close: cold,
				},
				name: suppliedName,
			}),
	],
	[
		"effectRunCompletionProjector",
		(g, input, suppliedName) =>
			effectRunCompletionProjector(g, { effectRuns: input("effectRuns"), name: suppliedName }),
	],
	[
		"eventFlow",
		(g, input, suppliedName) =>
			eventFlow(g, {
				sources: [{ source: "source", node: input("events") }],
				name: suppliedName,
			}),
	],
	[
		"eventFlowProjection",
		(g, input, suppliedName) =>
			eventFlowProjection(
				g,
				{
					records: input("records"),
					status: input("status"),
					issues: input("issues"),
					audit: input("audit"),
					highWater: input("highWater"),
				},
				{ initial: undefined, reduce: cold, name: suppliedName },
			),
	],
	[
		"executorOutcomeViewProjector",
		(g, input, suppliedName) =>
			executorOutcomeViewProjector(g, { outcomes: input("outcomes"), name: suppliedName }),
	],
	[
		"executorWorkQueueRecipe",
		(g, input, suppliedName) =>
			executorWorkQueueRecipe(g, {
				records: input("records"),
				outcomes: input("outcomes"),
				name: suppliedName,
			}),
	],
	["frameSource", (g, _input, suppliedName) => frameSource(g, cold, { name: suppliedName })],
	[
		"httpToolProviderRuntime",
		(g, input, suppliedName) =>
			httpToolProviderRuntime(g, { inputs: input("inputs"), name: suppliedName }),
	],
	[
		"imageSizeMeasurements",
		(g, input, suppliedName) =>
			imageSizeMeasurements({
				graph: g,
				images: input("images"),
				measurer: input("measurer"),
				name: suppliedName,
			}),
	],
	[
		"injectedTextMeasurements",
		(g, input, suppliedName) =>
			injectedTextMeasurements({
				measure: cold,
				graph: g,
				text: input("text"),
				font: input("font"),
				name: suppliedName,
			}),
	],
	[
		"keyedRateLimitAdmissionBundle",
		(g, input, suppliedName) =>
			keyedRateLimitAdmissionBundle(g, {
				requests: input("requests"),
				outcomes: input("outcomes"),
				name: suppliedName,
			}),
	],
	[
		"knowledgeGraphReducerBundle",
		(g, input, suppliedName) =>
			knowledgeGraphReducerBundle(g, { assertions: input("assertions"), name: suppliedName }),
	],
	[
		"localContainerPostgresqlRuntime",
		(g, input, suppliedName) =>
			localContainerPostgresqlRuntime(g, {
				inputs: input("inputs"),
				admittedRunRequests: [input("admittedRunRequests")],
				manifests: [input("manifests")],
				readiness: [input("readiness")],
				driver: {
					compatibility: "graphrefly-local-container-postgresql-v1",
					prepare: cold,
					create: cold,
					start: cold,
					wait: cold,
					stop: cold,
					kill: cold,
					remove: cold,
					cleanup: cold,
				},
				name: suppliedName,
			}),
	],
	[
		"localFixedWindowRateLimitBundle",
		(g, input, suppliedName) =>
			localFixedWindowRateLimitBundle(g, input("source"), {
				max: 1,
				windowMs: 1,
				name: suppliedName,
			}),
	],
	[
		"localHostExecutionGate",
		(g, input, suppliedName) =>
			localHostExecutionGate(g, {
				inputs: input("inputs"),
				profiles: [input("profiles")],
				routes: [input("routes")],
				admittedRunRequests: [input("admittedRunRequests")],
				name: suppliedName,
			}),
	],
	[
		"localUntrustedJsComputeRuntime",
		(g, input, suppliedName) =>
			localUntrustedJsComputeRuntime(g, {
				inputs: input("inputs"),
				admittedRunRequests: [],
				runAdmissions: [],
				manifests: [],
				readiness: [],
				driver: {
					compatibility: "graphrefly-local-untrusted-js-compute-v1",
					execute: cold,
				},
				loadMaterial: cold,
				name: suppliedName,
			}),
	],
	[
		"managedCloudPostgresqlRuntime",
		(g, input, suppliedName) =>
			managedCloudPostgresqlRuntime(g, {
				admittedRunRequests: [],
				inputs: input("inputs"),
				manifests: [],
				readiness: [],
				store: {
					compatibility: "postgresql-16-atomic-control-store-v1",
					schemaRevision: "managed-cloud-postgresql-control-schema-v2",
					admit: cold,
					claim: cold,
					heartbeat: cold,
					persistCancellation: cold,
					acknowledgeCancellation: cold,
					settle: cold,
					expire: cold,
					disconnect: cold,
					close: cold,
				},
				transport: {
					protocolRevision: "graphrefly-managed-cloud-wss-json-v2",
					start: cold,
					send: cold,
					close: cold,
				},
				authorizationRecheck: {
					compatibility: "graphrefly-managed-cloud-postgresql-v2",
					authorizeClaim: cold,
					authorizeCredentialIssuance: cold,
				},
				name: suppliedName,
			}),
	],
	[
		"managedUntrustedJsComputeRuntime",
		(g, input, suppliedName) =>
			managedUntrustedJsComputeRuntime(g, {
				inputs: input("inputs"),
				admittedRunRequests: [],
				manifests: [],
				readiness: [],
				driver: {
					compatibility: "graphrefly-managed-untrusted-js-compute-v2",
					createSandbox: cold,
					upload: cold,
					run: cold,
					kill: cold,
					destroy: cold,
					fenceAllocation: cold,
				},
				name: suppliedName,
			}),
	],
	[
		"memoryRetrievalBundle",
		(g, input, suppliedName) =>
			memoryRetrievalBundle(g, {
				fragments: input("fragments"),
				query: input("query"),
				name: suppliedName,
			}),
	],
	[
		"mergeMeasurements",
		(g, _input, suppliedName) => mergeMeasurements({ graph: g, sources: [], name: suppliedName }),
	],
	["messageBus", (g, _input, suppliedName) => messageBus(g, { name: suppliedName })],
	[
		"openPersistentAgenticMemoryRecords",
		(g, _input, suppliedName) =>
			openPersistentAgenticMemoryRecords({
				graph: g,
				snapshotStore: memoryKv(),
				name: suppliedName,
			}),
	],
	[
		"openPersistentReactiveIndex",
		(g, _input, suppliedName) =>
			openPersistentReactiveIndex(g, { snapshotStore: memoryKv(), name: suppliedName }),
	],
	[
		"openPersistentReactiveList",
		(g, _input, suppliedName) =>
			openPersistentReactiveList(g, { snapshotStore: memoryKv(), name: suppliedName }),
	],
	[
		"openPersistentReactiveLog",
		(g, _input, suppliedName) =>
			openPersistentReactiveLog(g, { snapshotStore: memoryKv(), name: suppliedName }),
	],
	[
		"openPersistentReactiveMap",
		(g, _input, suppliedName) =>
			openPersistentReactiveMap(g, { snapshotStore: memoryKv(), name: suppliedName }),
	],
	[
		"orchestrationMessageAckCommands",
		(g, input, suppliedName) =>
			orchestrationMessageAckCommands(g, {
				commands: input("commands"),
				status: input("status"),
				name: suppliedName,
			}),
	],
	[
		"orchestrationMessagingRecipe",
		(g, input, suppliedName) =>
			orchestrationMessagingRecipe(g, {
				deliveries: input("deliveries"),
				status: input("status"),
				name: suppliedName,
			}),
	],
	[
		"orchestrationWorkQueueRecipe",
		(g, input, suppliedName) =>
			orchestrationWorkQueueRecipe(g, { records: input("records"), name: suppliedName }),
	],
	[
		"persistAgenticMemoryRecords",
		(g, input, suppliedName) =>
			persistAgenticMemoryRecords(g, input("records"), {
				snapshotStore: {
					get: cold,
					set: cold,
					delete: cold,
					list: cold,
				},
				name: suppliedName,
			}),
	],
	[
		"persistReactiveCollection",
		(g, _input, suppliedName) =>
			persistReactiveCollection(g, reactiveList(g), {
				kind: "reactiveList",
				snapshotStore: memoryKv(),
				name: suppliedName,
			}),
	],
	[
		"postgresqlToolProviderRuntime",
		(g, input, suppliedName) =>
			postgresqlToolProviderRuntime(g, {
				inputs: input("inputs"),
				admittedRunRequests: [input("admittedRunRequests")],
				resolvePlan: cold,
				driver: { compatibility: "compatibility", acquire: cold },
				adapterVersion: "adapterVersion",
				driverCompatibility: "driverCompatibility",
				argumentSchemaRef: "argumentSchemaRef",
				resultSchemaRef: "resultSchemaRef",
				supportTier: "certified",
				rolloutCohort: "rolloutCohort",
				name: suppliedName,
			}),
	],
	[
		"precomputedTextMeasurements",
		(g, input, suppliedName) =>
			precomputedTextMeasurements({
				graph: g,
				text: input("text"),
				font: input("font"),
				metrics: new Map(),
				name: suppliedName,
			}),
	],
	[
		"processBundle",
		(g, _input, suppliedName) =>
			processBundle(g, { initialState: 0, reduce: () => ({ state: 0 }), name: suppliedName }),
	],
	[
		"processEffectRunner",
		(g, input, suppliedName) =>
			processEffectRunner(g, processBundle(g, { initialState: 0, reduce: () => ({ state: 0 }) }), {
				outcomes: [input("outcomes")],
				name: suppliedName,
			}),
	],
	[
		"processEventOutboxCommands",
		(g, input, suppliedName) =>
			processEventOutboxCommands(g, input("events"), "topic", { name: suppliedName }),
	],
	[
		"reactiveBlockLayout",
		(g, input, suppliedName) =>
			reactiveBlockLayout({
				measurements: input("measurements"),
				graph: g,
				name: suppliedName,
			}),
	],
	[
		"reactiveCascadingCache",
		(g, input, suppliedName) =>
			reactiveCascadingCache({
				graph: g,
				request: input("request"),
				tiers: [],
				name: suppliedName,
			}),
	],
	[
		"reactiveFlowLayout",
		(g, input, suppliedName) =>
			reactiveFlowLayout({ measurements: input("measurements"), graph: g, name: suppliedName }),
	],
	["reactiveIndex", (g, _input, suppliedName) => reactiveIndex(g, { name: suppliedName })],
	[
		"reactiveLayout",
		(g, input, suppliedName) =>
			reactiveLayout({ measurements: input("measurements"), graph: g, name: suppliedName }),
	],
	["reactiveList", (g, _input, suppliedName) => reactiveList(g, undefined, { name: suppliedName })],
	["reactiveLog", (g, _input, suppliedName) => reactiveLog(g, undefined, { name: suppliedName })],
	["reactiveMap", (g, _input, suppliedName) => reactiveMap(g, { name: suppliedName })],
	[
		"reactNativeLayoutMeasurements",
		(g, input, suppliedName) =>
			reactNativeLayoutMeasurements({ graph: g, probes: input("probes"), name: suppliedName }),
	],
	[
		"readinessMeasurements",
		(g, input, suppliedName) =>
			readinessMeasurements({ graph: g, readiness: input("readiness"), name: suppliedName }),
	],
	[
		"readinessTextMeasurements",
		(g, input, suppliedName) =>
			readinessTextMeasurements({
				readiness: input("readiness"),
				graph: g,
				text: input("text"),
				font: input("font"),
				adapter: input("adapter"),
				name: suppliedName,
			}),
	],
	[
		"remoteCall",
		(g, _input, suppliedName) =>
			remoteCall(g, wireBridge<RemoteCallRequest, RemoteCallResponse>(g, { sessionId: "s1" }), {
				name: suppliedName,
			}),
	],
	[
		"remoteResponder",
		(g, _input, suppliedName) =>
			remoteResponder(
				g,
				wireBridge<RemoteCallResponse, RemoteCallRequest>(g, { sessionId: "s1" }),
				{ name: suppliedName },
			),
	],
	[
		"requestSatisfactionProjector",
		(g, input, suppliedName) =>
			requestSatisfactionProjector(g, {
				requestFacts: input("requestFacts"),
				name: suppliedName,
			}),
	],
	[
		"retryStatusBundle",
		(g, input, suppliedName) => retryStatusBundle(g, input("events"), { name: suppliedName }),
	],
	[
		"scheduledReadinessProjector",
		(g, _input, suppliedName) =>
			scheduledReadinessProjector(g, { schedules: [], name: suppliedName }),
	],
	[
		"skiaTextMeasurements",
		(g, input, suppliedName) =>
			skiaTextMeasurements({
				capability: input("capability"),
				graph: g,
				text: input("text"),
				font: input("font"),
				name: suppliedName,
			}),
	],
	[
		"structuredAgentDecisionInterpreter",
		(g, input, suppliedName) =>
			structuredAgentDecisionInterpreter(g, input("outcomes"), { name: suppliedName }),
	],
	[
		"svgBoundsMeasurements",
		(g, input, suppliedName) =>
			svgBoundsMeasurements({
				graph: g,
				svgs: input("svgs"),
				measurer: input("measurer"),
				name: suppliedName,
			}),
	],
	[
		"textMeasurementProvider",
		(g, input, suppliedName) =>
			textMeasurementProvider({
				graph: g,
				text: input("text"),
				font: input("font"),
				adapter: input("adapter"),
				name: suppliedName,
			}),
	],
	[
		"timeoutBundle",
		(g, input, suppliedName) => timeoutBundle(g, input("source"), 1, { name: suppliedName }),
	],
	["toHttp", (g, input, suppliedName) => toHttp(g, input("source"), cold, { name: suppliedName })],
	[
		"toolProviderAdapterInputProjector",
		(g, input, suppliedName) =>
			toolProviderAdapterInputProjector(g, {
				requestFacts: input("requestFacts"),
				policyResolutions: [],
				name: suppliedName,
			}),
	],
	[
		"toolProviderExecutionRecipe",
		(g, input, suppliedName) =>
			toolProviderExecutionRecipe(g, {
				requestFacts: input("requestFacts"),
				bindings: [],
				name: suppliedName,
			}),
	],
	[
		"toolProviderPolicyResolutionProjector",
		(g, input, suppliedName) =>
			toolProviderPolicyResolutionProjector(g, {
				requestFacts: input("requestFacts"),
				name: suppliedName,
			}),
	],
	[
		"toolProviderRunAdmissionProjector",
		(g, input, suppliedName) =>
			toolProviderRunAdmissionProjector(g, {
				inputs: input("inputs"),
				runRequests: [],
				name: suppliedName,
			}),
	],
	[
		"toolProviderRunRetryProjector",
		(g, input, suppliedName) =>
			toolProviderRunRetryProjector(g, {
				inputs: input("inputs"),
				outcomes: input("outcomes"),
				name: suppliedName,
			}),
	],
	[
		"toProcess",
		(g, input, suppliedName) => toProcess(g, input("source"), cold, { name: suppliedName }),
	],
	[
		"toTopic",
		(g, input, suppliedName) =>
			toTopic(g, input("source"), messageBus(g), "jobs", { name: suppliedName }),
	],
	[
		"toWebSocket",
		(g, input, suppliedName) =>
			toWebSocket(g, input("source"), { url: "url" }, cold, { name: suppliedName }),
	],
	[
		"webSocketSession",
		(g, _input, suppliedName) => webSocketSession(g, { url: "url" }, { name: suppliedName }),
	],
	[
		"wireBridge",
		(g, _input, suppliedName) => wireBridge(g, { sessionId: "s1", name: suppliedName }),
	],
	[
		"wireBridgeAckDriver",
		(g, input, suppliedName) =>
			wireBridgeAckDriver(g, wireBridge(g, { sessionId: "s1" }), {
				clock: input("clock"),
				timeoutMs: 1,
				name: suppliedName,
			}),
	],
	[
		"wireBridgeProtobuf",
		(g, _input, suppliedName) =>
			wireBridgeProtobuf(g, wireBridge(g, { sessionId: "s1" }), { name: suppliedName }),
	],
	[
		"wireEdgeGroupIn",
		(g, input, suppliedName) =>
			wireEdgeGroupIn(g, {
				group: "g",
				frames: input("frames"),
				edges: ["x", "issues"],
				name: suppliedName,
			}),
	],
	[
		"wireEdgeGroupOut",
		(g, input, suppliedName) =>
			wireEdgeGroupOut(g, { group: "g", edges: { x: input("x") }, name: suppliedName }),
	],
	[
		"workerDerived",
		(g, _input, suppliedName) =>
			workerDerived(g, [], {
				prepare: cold,
				compute: cold,
				backend: { run: cold },
				name: suppliedName,
			}),
	],
	[
		"workItemAuthoringProjector",
		(g, input, suppliedName) =>
			workItemAuthoringProjector(g, { facts: input("facts"), name: suppliedName }),
	],
	[
		"workItemDomainActionAdmissionProjector",
		(g, input, suppliedName) =>
			workItemDomainActionAdmissionProjector(g, {
				proposals: input("proposals"),
				decisions: input("decisions"),
				name: suppliedName,
			}),
	],
	[
		"workItemDomainActionApplicationProjector",
		(g, input, suppliedName) =>
			workItemDomainActionApplicationProjector(g, {
				proposals: input("proposals"),
				admissions: input("admissions"),
				workItems: input("workItems"),
				name: suppliedName,
			}),
	],
	[
		"workItemDomainActionCapabilityGuardProjector",
		(g, input, suppliedName) =>
			workItemDomainActionCapabilityGuardProjector(g, {
				proposals: input("proposals"),
				capabilityAdmissions: input("capabilityAdmissions"),
				guardPolicies: input("guardPolicies"),
				name: suppliedName,
			}),
	],
	[
		"workItemDomainActionProposalIntakeProjector",
		(g, input, suppliedName) =>
			workItemDomainActionProposalIntakeProjector(g, {
				proposals: input("proposals"),
				name: suppliedName,
			}),
	],
	[
		"workItemEffectPlanProjector",
		(g, input, suppliedName) =>
			workItemEffectPlanProjector(g, {
				workItems: input("workItems"),
				proposals: input("proposals"),
				name: suppliedName,
			}),
	],
	[
		"workItemExecutionRecipe",
		(g, input, suppliedName) =>
			workItemExecutionRecipe(g, {
				workItems: input("workItems"),
				effectPlanProposals: input("effectPlanProposals"),
				effectRunResults: input("effectRunResults"),
				name: suppliedName,
			}),
	],
	[
		"workItemSeedProjector",
		(g, input, suppliedName) =>
			workItemSeedProjector(g, { workItems: input("workItems"), name: suppliedName }),
	],
	[
		"workItemVerificationRequestLowerer",
		(g, input, suppliedName) =>
			workItemVerificationRequestLowerer(g, {
				workItems: input("workItems"),
				name: suppliedName,
			}),
	],
	[
		"workItemVerificationResultMapper",
		(g, input, suppliedName) =>
			workItemVerificationResultMapper(g, {
				workItems: input("workItems"),
				evidence: input("evidence"),
				name: suppliedName,
			}),
	],
	[
		"workItemWorkQueueRecipe",
		(g, input, suppliedName) =>
			workItemWorkQueueRecipe(g, {
				effectRequests: input("effectRequests"),
				records: input("records"),
				name: suppliedName,
			}),
	],
	[
		"workQueue",
		(g, _input, suppliedName) =>
			workQueue(g, {
				queueId: "jobs",
				bus: messageBus(g),
				topic: "jobs",
				subscriptionId: "worker",
				name: suppliedName,
			}),
	],
	[
		"workQueueLeaseExpirationCommandProjector",
		(g, input, suppliedName) =>
			workQueueLeaseExpirationCommandProjector(g, {
				candidates: input("candidates"),
				name: suppliedName,
			}),
	],
	[
		"workQueueReadinessHandoffProjector",
		(g, input, suppliedName) =>
			workQueueReadinessHandoffProjector(g, {
				records: input("records"),
				ready: input("ready"),
				name: suppliedName,
			}),
	],
	[
		"workQueueScheduledReadinessProjector",
		(g, input, suppliedName) =>
			workQueueScheduledReadinessProjector(g, {
				records: input("records"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalDomainActionApplicationProjector",
		(g, input, suppliedName) =>
			workspaceProposalDomainActionApplicationProjector(g, {
				records: input("records"),
				decisions: input("decisions"),
				contexts: input("contexts"),
				emittedFacts: input("emittedFacts"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalFamilyApplicationDiagnosticProjector",
		(g, _input, suppliedName) =>
			workspaceProposalFamilyApplicationDiagnosticProjector(g, { name: suppliedName }),
	],
	[
		"workspaceProposalFamilyApplicationReadModelProjector",
		(g, _input, suppliedName) =>
			workspaceProposalFamilyApplicationReadModelProjector(g, { name: suppliedName }),
	],
	[
		"workspaceProposalFamilyApplicationReadModelsProjector",
		(g, input, suppliedName) =>
			workspaceProposalFamilyApplicationReadModelsProjector(g, {
				queries: input("queries"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalFamilyOutcomeDetailSupplyProjector",
		(g, input, suppliedName) =>
			workspaceProposalFamilyOutcomeDetailSupplyProjector(g, {
				requests: input("requests"),
				suppliedOutcomes: input("suppliedOutcomes"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalProjectionReleaseDiagnosticProjector",
		(g, input, suppliedName) =>
			workspaceProposalProjectionReleaseDiagnosticProjector(g, {
				releases: input("releases"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalRepairActionDescriptorProjector",
		(g, input, suppliedName) =>
			workspaceProposalRepairActionDescriptorProjector(g, {
				requests: input("requests"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalRepairActionDisplayPolicyAdvisoryProjector",
		(g, input, suppliedName) =>
			workspaceProposalRepairActionDisplayPolicyAdvisoryProjector(g, {
				descriptors: input("descriptors"),
				requests: input("requests"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalRepairActionIntentProjector",
		(g, input, suppliedName) =>
			workspaceProposalRepairActionIntentProjector(g, {
				intents: input("intents"),
				descriptors: input("descriptors"),
				requests: input("requests"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalRepairReviewDecisionRecordingProjector",
		(g, input, suppliedName) =>
			workspaceProposalRepairReviewDecisionRecordingProjector(g, {
				requests: input("requests"),
				recordingInputs: input("recordingInputs"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalRepairReviewProjector",
		(g, _input, suppliedName) => workspaceProposalRepairReviewProjector(g, { name: suppliedName }),
	],
	[
		"workspaceProposalRepairReviewStatusProjector",
		(g, input, suppliedName) =>
			workspaceProposalRepairReviewStatusProjector(g, {
				requests: input("requests"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalRepairSuccessorProposalIntakePreviewProjector",
		(g, input, suppliedName) =>
			workspaceProposalRepairSuccessorProposalIntakePreviewProjector(g, {
				intents: input("intents"),
				descriptors: input("descriptors"),
				requests: input("requests"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalRepairSuccessorProposalReadyRequestPreparationProjector",
		(g, input, suppliedName) =>
			workspaceProposalRepairSuccessorProposalReadyRequestPreparationProjector(g, {
				previews: input("previews"),
				preparationInputs: input("preparationInputs"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalRequiredInputResponseApplicationProjector",
		(g, input, suppliedName) =>
			workspaceProposalRequiredInputResponseApplicationProjector(g, {
				records: input("records"),
				decisions: input("decisions"),
				contexts: input("contexts"),
				gates: input("gates"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalWorkItemLinkApplicationProjector",
		(g, input, suppliedName) =>
			workspaceProposalWorkItemLinkApplicationProjector(g, {
				records: input("records"),
				decisions: input("decisions"),
				contexts: input("contexts"),
				name: suppliedName,
			}),
	],
	[
		"workspaceProposalWorkItemSpawnApplicationProjector",
		(g, input, suppliedName) =>
			workspaceProposalWorkItemSpawnApplicationProjector(g, {
				records: input("records"),
				decisions: input("decisions"),
				contexts: input("contexts"),
				name: suppliedName,
			}),
	],
];
function words(segment: string): string[] {
	return (segment.replace(/\d+$/, "").match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)/g) ?? []).map((word) =>
		word.toLowerCase(),
	);
}
function checkName(name: string) {
	const segments = name.split("/");
	for (const segment of segments) expect(segment, name).toMatch(/^[a-z][a-zA-Z0-9]*$/);
	for (let i = 1; i < segments.length; i++) {
		const prefix = new Set(words(segments[i - 1]!));
		const repeated = words(segments[i]!).filter((word) => prefix.has(word));
		// Keep qualifiers that separate existing outputs or stages with identical child roles.
		const qualified =
			(segments[i] === "runtimeStatus" && prefix.has("runtime")) ||
			(segments[i - 1] === "agenticMemoryConsolidationApplication" &&
				["consolidation", "application", "applicationInput"].includes(segments[i]!));
		if (!qualified) expect(repeated, name).toEqual([]);
	}
}
describe("R-naming@1 public module default names", () => {
	it.each(constructors)("%s builds compliant node and group names", async (_name, build) => {
		const g = graph();
		const inputs = new Set<string>();
		const input: Input = (name) => {
			const id = `input/${name}`;
			inputs.add(id);
			return g.find(id) ?? g.node([], null, { name: id });
		};
		const groups: string[] = [];
		const original = topology.group;
		const spy = vi.spyOn(topology, "group").mockImplementation((host, opts) => {
			if (opts?.name) groups.push(opts.name);
			return original(host, opts);
		});
		try {
			await build(g, input);
			const nodes = g.describe().filter((node) => !inputs.has(node.id));
			expect(nodes.length).toBeGreaterThan(0);
			for (const node of nodes) {
				if (!node.id.startsWith("~")) checkName(node.id);
			}
			for (const name of groups) checkName(name);
		} finally {
			spy.mockRestore();
		}
	});
});

describe("R-naming@1 semantic default names", () => {
	it.each([
		["agenticMemoryConsolidationApplicationBundle", "agenticMemoryConsolidationApplication/input"],
		[
			"agenticWorkItemMemoryApplicationRecipeBundle",
			"agenticWorkItemMemoryApplicationRecipe/input",
		],
		["agenticMemoryContextPackingBundle", "agenticMemoryContextPacking/packed"],
		["agenticMemoryRecordAdmissionPolicySourceBundle", "agenticMemoryRecordAdmissionPolicySource"],
		["imageSizeMeasurements", "imageSizeMeasurements"],
		["svgBoundsMeasurements", "svgBoundsMeasurements"],
		["reactNativeLayoutMeasurements", "reactNativeLayoutMeasurements"],
	])("preserves semantic words in %s", async (factory, expected) => {
		const g = graph();
		const input: Input = (name) =>
			g.find(`input/${name}`) ?? g.node([], null, { name: `input/${name}` });
		const entry = constructors.find(([name]) => name === factory);
		expect(entry, factory).toBeDefined();
		await entry![1](g, input);
		expect(g.find(expected), expected).toBeDefined();
	});
});

describe("R-naming@1 deferred module construction", () => {
	it("names lazy collection views and binding nodes", () => {
		const g = graph();
		const list = reactiveList<number>(g);
		const source = g.node<number>([], null, { name: "source" });
		const stop1 = list.appendFrom(source),
			stop2 = list.appendFrom(source),
			stop3 = list.appendFrom(source);
		const map = reactiveMap<string, number>(g);
		const positive = (value: number) => value > 0;
		const selected = map.select(positive);
		expect(map.select(positive)).toBe(selected);
		map.select((value) => value < 0);
		map.select((value) => value === 0);
		const index = reactiveIndex<string, number>(g);
		const range = index.range("a", "z");
		expect(index.range("a", "z")).toBe(range);
		index.range("a", "b");
		index.range("c", "d");
		const log = reactiveLog<number>(g);
		const page = log.page(0, 2);
		expect(log.page(0, 2)).toBe(page);
		log.page(2, 4);
		log.page(4, 6);
		for (const node of g.describe()) if (!node.id.startsWith("~")) checkName(node.id);
		expect(g.describe().map((node) => node.id)).toEqual(
			expect.arrayContaining([
				"reactiveList/bind",
				"reactiveList/bind1",
				"reactiveList/bind2",
				"reactiveMap/select/delta",
				"reactiveMap/select1/delta",
				"reactiveMap/select2/delta",
				"reactiveIndex/range/delta",
				"reactiveIndex/range1/delta",
				"reactiveIndex/range2/delta",
				"reactiveLog/page/delta",
				"reactiveLog/page1/delta",
				"reactiveLog/page2/delta",
			]),
		);
		stop1();
		stop2();
		stop3();
	});
	it.each(
		constructors.filter(([name]) =>
			[
				"wireBridge",
				"wireBridgeAckDriver",
				"reactiveCascadingCache",
				"reactiveList",
				"messageBus",
				"readinessMeasurements",
				"workItemSeedProjector",
				"agenticMemoryContextPackingBundle",
			].includes(name),
		),
	)("allocates independent default scopes for %s", async (_name, build) => {
		const g = graph();
		const input: Input = (name) =>
			g.find(`input/${name}`) ?? g.node([], null, { name: `input/${name}` });
		await build(g, input);
		const before = new Set(g.describe().map((node) => node.id));
		await build(g, input);
		const added = g.describe().filter((node) => !before.has(node.id));
		expect(added.length).toBeGreaterThan(0);
		for (const node of added) if (!node.id.startsWith("~")) checkName(node.id);
	});
	it("keeps readiness payload identity separate from its generated node name", () => {
		const g = graph();
		const readiness = g.state({ ready: true }, { name: "input" });
		const facts = readinessMeasurements({ graph: g, readiness });
		const values: unknown[] = [];
		const stop = facts.subscribe((wave) => {
			for (const msg of wave) if (msg[0] === "DATA") values.push(msg[1]);
		});
		expect(values).toEqual([
			expect.arrayContaining([
				expect.objectContaining({
					targetId: "measurement-readiness",
					source: "measurement-readiness-measurements",
				}),
			]),
		]);
		stop();
	});
});

describe("public module input names", () => {
	it.each(constructors)("%s validates raw local scopes", async (_name, build) => {
		for (const suppliedName of ["bad::name", ":bad", "bad:"]) {
			const g = graph();
			const input: Input = (name) =>
				g.find(`input/${name}`) ?? g.node([], null, { name: `input/${name}` });
			const error = suppliedName.includes("::")
				? "name must not contain '::'"
				: "name must not start or end with ':'";
			await expect(async () => {
				await build(g, input, suppliedName);
			}).rejects.toThrow(new Error(error));
		}
	});
});

describe("module scope preflight", () => {
	it("does not consume a default scope when an edge name is refused", () => {
		for (const edge of ["bad::edge", ":edge", "edge:"]) {
			const g = graph();
			const frames = g.node([], null, { name: "frames" });
			const before = g.describe();
			expect(() => wireEdgeGroupIn(g, { group: "bridge", frames, edges: ["x", edge] })).toThrow();
			expect(g.describe()).toEqual(before);
			const incoming = wireEdgeGroupIn(g, { group: "bridge", frames, edges: ["x"] });
			expect(g.find("bridge/in/edges/x")).toBe(incoming.inbound.get("x"));
			expect(g.find("bridge/in1")).toBeUndefined();
		}
	});
	it("rejects dynamic wire scopes atomically while retaining explicitly named payload identities", () => {
		const g = graph();
		const frames = g.node<Uint8Array>([], null, { name: "frames" });
		const clock = g.state(0, { name: "clock" });
		const bridge = wireBridge(g, { sessionId: "session:" });
		for (const bad of [":bad", "bad:", "bad::name"]) {
			const error = bad.includes("::")
				? "name must not contain '::'"
				: "name must not start or end with ':'";
			const before = g.describe();
			expect(() => wireEdgeGroupIn(g, { group: bad, frames, edges: ["x"] })).toThrow(
				new Error(error),
			);
			expect(() => wireEdgeGroupOut(g, { group: bad, edges: { x: frames } })).toThrow(
				new Error(error),
			);
			expect(() => wireEdgeGroupIn(g, { group: "g", name: bad, frames, edges: ["x"] })).toThrow(
				new Error(error),
			);
			expect(g.describe()).toEqual(before);
		}
		const before = g.describe();
		expect(() => wireBridgeAckDriver(g, bridge, { timeoutMs: 1, clock })).toThrow(
			"name must not start or end with ':'",
		);
		expect(g.describe()).toEqual(before);
		expect(() =>
			wireEdgeGroupIn(g, { name: "explicit", group: "payload:", frames, edges: ["x"] }),
		).not.toThrow();
	});
	it("allocates around explicit and retired scopes without normalizing caller labels", () => {
		const g = graph();
		const first = reactiveList(g, [], { name: "reactiveList" });
		first.dispose();
		const second = reactiveList(g);
		const third = reactiveList(g);
		expect(g.find("reactiveList1/delta")).toBe(second.delta);
		expect(g.find("reactiveList2/delta")).toBe(third.delta);
		const custom = reactiveList(g, [], { name: "custom.name-with/a:b" });
		expect(g.find("custom.name-with/a:b/delta")).toBe(custom.delta);
	});
});

describe("naming preserves persistence contracts", () => {
	const openers = [
		[
			"reactiveList",
			(g: Graph, name?: string) =>
				openPersistentReactiveList(g, { snapshotStore: memoryKv(), name }),
		],
		[
			"reactiveLog",
			(g: Graph, name?: string) =>
				openPersistentReactiveLog(g, { snapshotStore: memoryKv(), name }),
		],
		[
			"reactiveMap",
			(g: Graph, name?: string) =>
				openPersistentReactiveMap(g, { snapshotStore: memoryKv(), name }),
		],
		[
			"reactiveIndex",
			(g: Graph, name?: string) =>
				openPersistentReactiveIndex(g, { snapshotStore: memoryKv(), name }),
		],
	] as const;
	it.each(openers)("keeps default and explicit recipe eligibility for %s", async (kind, open) => {
		const g = graph();
		const first = await open(g);
		const second = await open(g);
		const named = await open(g, "custom");
		expect(g.definition(first.collection.delta).recipe).toBeUndefined();
		expect(g.definition(second.collection.delta).recipe).toBeUndefined();
		expect(g.definition(named.collection.delta).recipe).toEqual(
			expect.objectContaining({ ref: `${kind}.delta` }),
		);
		expect(g.find(`${kind}1/persistence/status`)).toBe(second.persistence.status);
	});
	it("keeps default storage keys independently of generated graph ids", async () => {
		const g = graph();
		const list = reactiveList(g, [1]);
		const listStore = memoryKv();
		const listPersistence = persistReactiveCollection(g, list, {
			kind: "reactiveList",
			snapshotStore: listStore,
		});
		await new Promise<void>((resolve) => listPersistence.snapshot(() => resolve()));
		expect(await listStore.list()).toContain("reactiveList.persistence/snapshot");
		const records = g.state([], { name: "records" });
		const recordStore = memoryKv();
		const recordPersistence = persistAgenticMemoryRecords(g, records, {
			snapshotStore: recordStore,
		});
		await new Promise<void>((resolve) => recordPersistence.snapshot(() => resolve()));
		expect(await recordStore.list()).toContain("agenticMemoryRecords.persistence/records.snapshot");
	});
});
