import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
	AgenticMemoryPassiveStoreFrameAdapter,
	AgenticMemoryPassiveStoreFrameCursor,
	AgenticMemoryPassiveStoreFrameReadResult,
	AgenticMemoryPassiveStoreFrameStatus,
	AgenticMemoryPassiveStoreFrameWriteResult,
	AgenticMemoryRecordsPersistenceHandle,
} from "../adapters/index.js";
import * as adapters from "../adapters/index.js";
import * as nestjsMicroservicesAdapters from "../adapters/nestjs/microservices.js";
import * as nestjsNativeAdapters from "../adapters/nestjs/native.js";
import * as nestjsWebsocketsAdapters from "../adapters/nestjs/websockets.js";
import * as nestjsAdapters from "../adapters/nestjs.js";
import * as observeStorage from "../adapters/observe-storage.js";
import * as reactAdapters from "../adapters/react.js";
import * as solidAdapters from "../adapters/solid.js";
import * as svelteAdapters from "../adapters/svelte.js";
import * as vueAdapters from "../adapters/vue.js";
import * as composition from "../composition/index.js";
import * as core from "../core/index.js";
import * as cqrs from "../cqrs/index.js";
import * as cqrsMessagingRecipe from "../cqrs/messaging.js";
import * as cqrsWorkQueueRecipe from "../cqrs/work-queue.js";
import type { DataIssue, DataResult } from "../data/index.js";
import * as data from "../data/index.js";
import type {
	ReactiveOpt as DataStructuresReactiveOpt,
	ReactiveView as DataStructuresReactiveView,
	ViewCachePolicy as DataStructuresViewCachePolicy,
} from "../data-structures/index.js";
import * as dataStructures from "../data-structures/index.js";
import * as executorToolProviderRecipe from "../executors/tool-provider.js";
import * as executorToolProviderAdapters from "../executors/tool-provider-adapters.js";
import * as executorToolProviderRuntime from "../executors/tool-provider-runtime.js";
import * as executorWorkQueueRecipe from "../executors/work-queue.js";
import * as graphLayer from "../graph/index.js";
import type {
	AgenticMemoryApplicationDecisionStoreFrame,
	AgenticMemoryApplicationEvidenceStoreFrame,
	AgenticMemoryApplicationEvidenceStoreFrameBundleOptions,
	AgenticMemoryBundleOptions,
	AgenticMemoryCommittedFactLog,
	AgenticMemoryCommittedFactLogAppendAttemptOptions,
	AgenticMemoryCommittedFactLogAppendAttemptResult,
	AgenticMemoryCommittedFactLogBackend,
	AgenticMemoryCommittedFactLogBackendAppendResult,
	AgenticMemoryCommittedFactLogBackendStatus,
	AgenticMemoryCommittedFactLogStartupReadOptions,
	AgenticMemoryCommittedFactLogStartupReadResult,
	AgenticMemoryCommittedFactReadMaterializationBundleOptions,
	AgenticMemoryCommittedFactReadMaterializationProjection,
	AgenticMemoryCommittedFactReadMaterializationStatus,
	AgenticMemoryConsolidationApplicationBundle,
	AgenticMemoryConsolidationApplicationBundleOptions,
	AgenticMemoryConsolidationBundle,
	AgenticMemoryConsolidationBundleOptions,
	AgenticMemoryContextAttribution,
	AgenticMemoryContextPackingBundleOptions,
	AgenticMemoryContextTruncation,
	AgenticMemoryDurabilityDownstreamAdvancePolicy,
	AgenticMemoryDurabilityGateBundleOptions,
	AgenticMemoryDurabilityGateInput,
	AgenticMemoryDurabilityGateStatus,
	AgenticMemoryFactCommitStatus,
	AgenticMemoryKgProjectionBundleOptions,
	AgenticMemoryMaterializedFactLogBootstrapBundleOptions,
	AgenticMemoryMaterializedFactLogBootstrapProjection,
	AgenticMemoryMaterializedFactLogBootstrapStatus,
	AgenticMemoryProposalAdmissionDecision,
	AgenticMemoryProposalAdmissionPolicy,
	AgenticMemoryRecord,
	AgenticMemoryRecordAdmissionPolicySourceBundleOptions,
	AgenticMemoryRecordAdmissionPolicySourceProjection,
	AgenticMemoryRecordApplicationBundleOptions,
	AgenticMemoryRecordApplicationDecision,
	AgenticMemoryRecordApplicationEvidenceFactsBundleOptions,
	AgenticMemoryRecordApplicationEvidenceFactsProjection,
	AgenticMemoryRecordApplicationMaterialIdentity,
	AgenticMemoryRecordApplicationMaterialIdentityAlgorithm,
	AgenticMemoryRecordApplicationOperation,
	AgenticMemoryRecordApplicationOperationStatus,
	AgenticMemoryRecordApplicationOptions,
	AgenticMemoryRecordApplicationPolicy,
	AgenticMemoryRecordApplicationPriorEvidence,
	AgenticMemoryRecordApplicationPriorEvidenceBundleOptions,
	AgenticMemoryRecordApplicationPriorEvidenceProjection,
	AgenticMemoryRecordCandidateMaterial,
	AgenticMemoryRecordFrame,
	AgenticMemoryRecordMaterializationIntent,
	AgenticMemoryRecordMaterializationProjection,
	AgenticMemoryRecordMaterializationStatus,
	AgenticMemoryRecordMaterializerBundleOptions,
	AgenticMemoryRecordStoreFrame,
	AgenticMemoryRecordStoreFrameBundleOptions,
	AgenticMemoryRetentionBundleOptions,
	AgenticMemoryScope,
	AgenticMemoryStatus,
	AgenticWorkItemMemoryApplicationRecipeBundleOptions,
	AgenticWorkItemMemoryApplicationRecipeResult,
	AgenticWorkItemMemoryBridgeCursor,
	AgenticWorkItemMemoryBridgeResult,
	AgenticWorkItemMemoryBridgeStatus,
	AgenticWorkItemMemoryMappingPolicy,
	AgenticWorkItemMemoryRecordCandidate,
	CapacityPolicy,
	GraphCheckpoint,
	KnowledgeAssertion,
	KnowledgeGraphReducerBundleOptions,
	MemoryFragment,
	OrderedCapacityPolicy,
	ReactiveIndexCapacityOrder,
	ReactiveIndexCapacityPolicy,
	ReactiveIndexOpt,
	ReactiveIndexOptions,
	ReactiveListOpt,
	ReactiveLogOptions,
	ReactiveMapOpt,
	ReactiveMapOptions,
	ReactiveMapRetentionEntry,
	ReactiveMapRetentionPolicy,
	ReactiveOpt,
	ReactiveView,
	RetentionPolicy,
	TopologyGroup,
	TopologyGroupOptions,
	TopologyGroupReleaseOptions,
	ViewCachePolicy,
} from "../index.js";
import * as rootPackage from "../index.js";
import * as boundaryInspection from "../inspection/boundary.js";
import * as memory from "../memory/index.js";
import * as semanticMemory from "../memory/semantic/index.js";
import * as messaging from "../messaging/index.js";
import * as operators from "../operators/index.js";
import type {
	ExecutorArtifactMaterial,
	ScheduledReadinessBundle,
	ScheduledReadinessClock,
	ScheduledReadinessReady,
	ScheduledReadinessRequested,
	ScheduledReadinessStatus,
	SizeCapacityEvidence,
	ToolProviderAdapterInput,
	ToolProviderAdapterInputBundle,
	ToolProviderAdapterInputStatus,
	ToolProviderAdapterRunBundle,
	ToolProviderAdapterRunRequested,
	ToolProviderAdapterRunResult,
	ToolProviderAdapterRunStatus,
	ToolProviderExecutionPolicy,
	ToolProviderPublicTextPolicy,
	ToolProviderRunAdmissionBundle,
	ToolProviderRunAdmissionDecision,
	ToolProviderRunAdmissionProposal,
	ToolProviderRunAdmissionStatus,
	ToolProviderRunRetryBundle,
	ToolProviderRunRetryPolicy,
	ToolProviderRunRetryProposal,
	ToolProviderRunRetryScheduled,
	ToolProviderRunRetryStatus,
} from "../orchestration/index.js";
import * as orchestration from "../orchestration/index.js";
import * as orchestrationMessagingRecipe from "../orchestration/messaging.js";
import type {
	WorkQueueLeaseExpirationCommandBundle,
	WorkQueueReadinessHandoffBundle,
	WorkQueueReadinessHandoffStatus,
	WorkQueueScheduledReadinessBundle,
	WorkQueueScheduledReadinessStatus,
} from "../orchestration/work-queue.js";
import * as orchestrationWorkQueueRecipe from "../orchestration/work-queue.js";
import * as eventFlowPatterns from "../patterns/event-flow.js";
import * as patterns from "../patterns/index.js";
import * as render from "../render/index.js";
import * as scoring from "../scoring/index.js";
import * as agenticMemoryBrowser from "../solutions/agentic-memory/browser.js";
import * as agenticMemory from "../solutions/agentic-memory/index.js";
import * as agenticMemoryNode from "../solutions/agentic-memory/node.js";
import * as agenticWorkItemMemory from "../solutions/agentic-work-item-memory/index.js";
import * as agenticWorkItemMemoryApplication from "../solutions/agentic-work-item-memory-application/index.js";
import type {
	ImageSizeLookup,
	AgenticMemoryRecordApplicationOperation as SolutionsAgenticMemoryRecordApplicationOperation,
} from "../solutions/index.js";
import * as solutions from "../solutions/index.js";
import * as reactiveLayoutBrowser from "../solutions/reactive-layout/browser/index.js";
import * as reactiveLayoutCore from "../solutions/reactive-layout/index.js";
import * as reactiveLayoutNodeCanvas from "../solutions/reactive-layout/node-canvas/index.js";
import * as reactiveLayoutReactNative from "../solutions/reactive-layout/react-native/index.js";
import * as reactiveLayoutSkia from "../solutions/reactive-layout/skia/index.js";
import * as workItemActions from "../solutions/work-item/actions.js";
import * as workItemSolution from "../solutions/work-item/index.js";
import type {
	WorkspaceProposalFamilyApplicationReadModelQuery,
	WorkspaceProposalProjectionRelease,
	WorkspaceProposalProjectionReleaseDiagnostic,
	WorkspaceProposalRepairActionDescriptor,
} from "../solutions/work-item/scheduling.js";
import * as workItemScheduling from "../solutions/work-item/scheduling.js";
import * as workItemWorkQueueRecipe from "../solutions/work-item/work-queue.js";
import * as sourcesBrowser from "../sources/browser.js";
import * as sources from "../sources/index.js";
import * as sourcesNode from "../sources/node.js";
import * as storageBrowser from "../storage/browser.js";
import * as storage from "../storage/index.js";
import * as storageNode from "../storage/node.js";
import * as testing from "../testing/index.js";
import * as workQueueModule from "../work-queue/index.js";

const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
const exportsJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
	exports?: Record<string, unknown>;
};

function listTsFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		const stat = statSync(path);
		if (stat.isDirectory()) {
			files.push(...listTsFiles(path));
			continue;
		}
		if (entry.endsWith(".ts")) files.push(path);
	}
	return files;
}

function docsPath(...segments: string[]): string {
	return join(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"..",
		"..",
		"..",
		"website",
		...segments,
	);
}

describe("package subpath barrels (D40/D41 intent parity)", () => {
	it("publishes only the intended package subpaths", () => {
		expect(Object.keys(exportsJson.exports ?? {}).sort()).toEqual([
			".",
			"./adapters",
			"./adapters/nestjs",
			"./adapters/nestjs/microservices",
			"./adapters/nestjs/native",
			"./adapters/nestjs/websockets",
			"./adapters/observe-storage",
			"./adapters/react",
			"./adapters/solid",
			"./adapters/svelte",
			"./adapters/vue",
			"./composition",
			"./core",
			"./cqrs",
			"./cqrs/messaging",
			"./cqrs/work-queue",
			"./data",
			"./data-structures",
			"./executors/tool-provider",
			"./executors/tool-provider-adapters",
			"./executors/tool-provider-runtime",
			"./executors/work-queue",
			"./graph",
			"./inspection/boundary",
			"./memory",
			"./memory/semantic",
			"./messaging",
			"./operators",
			"./orchestration",
			"./orchestration/messaging",
			"./orchestration/work-queue",
			"./patterns",
			"./patterns/event-flow",
			"./render",
			"./scoring",
			"./solutions",
			"./solutions/agentic-memory",
			"./solutions/agentic-memory/browser",
			"./solutions/agentic-memory/node",
			"./solutions/agentic-work-item-memory",
			"./solutions/agentic-work-item-memory-application",
			"./solutions/reactive-layout",
			"./solutions/reactive-layout/browser",
			"./solutions/reactive-layout/node-canvas",
			"./solutions/reactive-layout/react-native",
			"./solutions/reactive-layout/skia",
			"./solutions/work-item",
			"./solutions/work-item/actions",
			"./solutions/work-item/scheduling",
			"./solutions/work-item/work-queue",
			"./sources",
			"./sources/browser",
			"./sources/node",
			"./storage",
			"./storage/browser",
			"./storage/node",
			"./testing",
			"./work-queue",
		]);
		expect(exportsJson.exports?.["./base"]).toBeUndefined();
		expect(exportsJson.exports?.["./compat"]).toBeUndefined();
		expect(exportsJson.exports?.["./canvas"]).toBeUndefined();
		expect(exportsJson.exports?.["./solutions/canvas"]).toBeUndefined();
		expect(exportsJson.exports?.["./workspace-intents"]).toBeUndefined();
		expect(exportsJson.exports?.["./solutions/workspace-intents"]).toBeUndefined();
		expect(exportsJson.exports?.["./presets"]).toBeUndefined();
		expect(exportsJson.exports?.["./utils"]).toBeUndefined();
		expect(exportsJson.exports?.["./graph/render"]).toBeUndefined();
		expect(exportsJson.exports?.["./graph/sources"]).toBeUndefined();
		expect(exportsJson.exports?.["./graph/operators"]).toBeUndefined();
		expect(exportsJson.exports?.["./storage/wal"]).toBeUndefined();
	});

	it("keeps the integration matrix aligned with published package subpaths", () => {
		const matrix = readFileSync(
			docsPath("src", "content", "docs", "integrations", "matrix.md"),
			"utf8",
		);
		const matrixEntries = matrix
			.split("\n")
			.filter((line) => line.startsWith("|"))
			.map((line) => line.split("|").map((cell) => cell.trim())[3])
			.filter((cell): cell is string => cell !== undefined);
		const documentedSubpaths = Array.from(
			matrixEntries
				.filter((entry) => /^`@graphrefly\/ts(?:\/[\w./-]+)?`$/.test(entry))
				.join("\n")
				.matchAll(/`(@graphrefly\/ts(?:\/[\w./-]+)?)`/g),
			(match) => match[1],
		).map((specifier) =>
			specifier === "@graphrefly/ts" ? "." : `.${specifier.slice("@graphrefly/ts".length)}`,
		);

		expect(documentedSubpaths.length).toBeGreaterThan(0);
		for (const subpath of documentedSubpaths) {
			expect(exportsJson.exports, subpath).toHaveProperty(subpath);
		}
		for (const subpath of Object.keys(exportsJson.exports ?? {})) {
			expect(documentedSubpaths, subpath).toContain(subpath);
		}
		for (const staleEntry of [
			"fromOTel",
			"fromKafka",
			"fromWebhook",
			"toSSE",
			"fromMCP",
			"toPostgres",
		]) {
			expect(matrixEntries).not.toContain(`\`${staleEntry}\``);
		}
	});

	it("exposes the clean-slate layer surfaces from source barrels", () => {
		expect(typeof core.node).toBe("function");
		expect(typeof graphLayer.Graph).toBe("function");
		expect(typeof graphLayer.graph).toBe("function");
		expect(typeof graphLayer.coalesceObserve).toBe("function");
		expect(typeof graphLayer.domWebSocketDriver).toBe("function");
		expect(typeof graphLayer.explainPath).toBe("function");
		expect(typeof graphLayer.fetchHttpDriver).toBe("function");
		expect(typeof graphLayer.filterObserve).toBe("function");
		expect(typeof graphLayer.GRAPH_CHECKPOINT_VERSION).toBe("string");
		expect(typeof graphLayer.reachable).toBe("function");
		expect(typeof graphLayer.restoreGraph).toBe("function");
		expect(typeof graphLayer.validateNoIslands).toBe("function");
		expect(typeof operators.map).toBe("function");
		expect(typeof operators.switchMap).toBe("function");
		expect(typeof operators.repeat).toBe("function");
		expect(typeof operators.audit).toBe("function");
		expect(typeof operators.auditTime).toBe("function");
		expect(typeof operators.bufferTime).toBe("function");
		expect(typeof operators.timeout).toBe("function");
		expect(typeof operators.define).toBe("function");
		expect(typeof operators.restoreRegistry).toBe("function");
		expect(typeof sources.fromAny).toBe("function");
		expect(typeof sources.fromCron).toBe("function");
		expect(typeof sources.fromEvent).toBe("function");
		expect(typeof sources.fromPushNotification).toBe("function");
		expect(typeof sources.firstValueFrom).toBe("function");
		expect(typeof sources.matchesCron).toBe("function");
		expect(typeof sources.parseCron).toBe("function");
		expect(typeof sources.singleFromAny).toBe("function");
		expect(typeof sources.timer).toBe("function");
		expect(typeof sources.fromTimer).toBe("function");
		expect(typeof sources.of).toBe("function");
		expect(typeof sources.throwError).toBe("function");
		expect(Object.hasOwn(sources, "fromFSWatch")).toBe(false);
		expect(Object.hasOwn(sources, "fromRaf")).toBe(false);
		expect(typeof composition.topologyDiff).toBe("function");
		expect(typeof dataStructures.reactiveMap).toBe("function");
		expect(typeof render.describeToJson).toBe("function");
		expect(typeof render.describeToMermaidUrl).toBe("function");
		expect(typeof adapters.jotaiAtom).toBe("function");
		expect(typeof adapters.nanoAtom).toBe("function");
		expect(typeof adapters.recordReadableStore).toBe("function");
		expect(typeof adapters.signalFromNode).toBe("function");
		expect(typeof adapters.externalStore).toBe("function");
		expect(typeof adapters.readableStore).toBe("function");
		expect(typeof adapters.subscribeNodeValues).toBe("function");
		expect(Object.hasOwn(adapters, "fromNestReq")).toBe(false);
		expect(Object.hasOwn(adapters, "toNestHttp")).toBe(false);
		expect(Object.hasOwn(adapters, "reactExternalStore")).toBe(false);
		expect(Object.hasOwn(adapters, "svelteReadableStore")).toBe(false);
		expect(Object.hasOwn(adapters, "svelteWritableStore")).toBe(false);
		expect(typeof reactAdapters.useNodeValue).toBe("function");
		expect(typeof reactAdapters.useNodeInput).toBe("function");
		expect(typeof reactAdapters.useNodeRecord).toBe("function");
		expect(typeof vueAdapters.useNodeValue).toBe("function");
		expect(typeof vueAdapters.useNodeInput).toBe("function");
		expect(typeof vueAdapters.useNodeRecord).toBe("function");
		expect(typeof solidAdapters.createNodeValue).toBe("function");
		expect(typeof solidAdapters.createNodeInput).toBe("function");
		expect(typeof solidAdapters.createNodeRecord).toBe("function");
		expect(typeof svelteAdapters.nodeReadable).toBe("function");
		expect(typeof svelteAdapters.nodeWritable).toBe("function");
		expect(typeof svelteAdapters.nodeRecord).toBe("function");
		expect(typeof boundaryInspection.boundaryManifest).toBe("function");
		expect(typeof adapters.toHttp).toBe("function");
		expect(typeof adapters.toProcess).toBe("function");
		expect(typeof adapters.toWebSocket).toBe("function");
		expect(typeof adapters.webSocketSession).toBe("function");
		expect(typeof adapters.remoteCall).toBe("function");
		expect(typeof adapters.remoteResponder).toBe("function");
		expect(typeof adapters.remoteResponderHandler).toBe("function");
		expect(typeof adapters.wireBridge).toBe("function");
		expect(typeof adapters.wireBridgeEnvelope).toBe("function");
		expect(typeof adapters.wireBridgeIdempotencyKey).toBe("function");
		expect(Object.hasOwn(adapters, "dedupeReducer")).toBe(false);
		expect(typeof adapters.writableStore).toBe("function");
		expect(typeof adapters.zustandStore).toBe("function");
		expect(typeof nestjsAdapters.fromNestReq).toBe("function");
		expect(typeof nestjsAdapters.fromNestGuard).toBe("function");
		expect(typeof nestjsAdapters.fromNestIntercept).toBe("function");
		expect(typeof nestjsAdapters.fromNestError).toBe("function");
		expect(typeof nestjsAdapters.fromNestLifecycle).toBe("function");
		expect(typeof nestjsAdapters.fromNestCron).toBe("function");
		expect(typeof nestjsAdapters.fromNestDiagnostics).toBe("function");
		expect(typeof nestjsAdapters.sanitizeNestDiagnostic).toBe("function");
		expect(typeof nestjsAdapters.toNestHttp).toBe("function");
		expect(typeof nestjsAdapters.GraphFilter).toBe("function");
		expect(typeof nestjsAdapters.GraphGuardDecision).toBe("function");
		expect(typeof nestjsAdapters.getGraphToken).toBe("function");
		expect(typeof nestjsAdapters.getNestBoundaryToken).toBe("function");
		expect(typeof nestjsNativeAdapters.createGraphCronController).toBe("function");
		expect(typeof nestjsNativeAdapters.graphCronTarget).toBe("function");
		expect(typeof nestjsNativeAdapters.graphLifecycleTarget).toBe("function");
		expect(typeof nestjsNativeAdapters.provideGraphBoundaryInterceptor).toBe("function");
		expect(typeof nestjsNativeAdapters.provideGraphGuard).toBe("function");
		expect(typeof nestjsNativeAdapters.createGraphExceptionFilter).toBe("function");
		expect(typeof nestjsNativeAdapters.provideGraphExceptionFilter).toBe("function");
		expect(typeof nestjsNativeAdapters.createGraphGuardDeniedFilter).toBe("function");
		expect(typeof nestjsNativeAdapters.provideGraphGuardDeniedFilter).toBe("function");
		expect(typeof nestjsNativeAdapters.provideGraphCronScheduler).toBe("function");
		expect(typeof nestjsNativeAdapters.provideGraphLifecycleHooks).toBe("function");
		expect(typeof nestjsNativeAdapters.provideGraphNativeHttpProviders).toBe("function");
		expect(typeof nestjsNativeAdapters.provideGraphNativeProviders).toBe("function");
		expect(typeof nestjsNativeAdapters.GRAPHREFLY_NEST_EXCEPTION_FILTER).toBe("symbol");
		expect(typeof nestjsWebsocketsAdapters.fromNestWs).toBe("function");
		expect(typeof nestjsWebsocketsAdapters.provideGraphWsProviders).toBe("function");
		expect(typeof nestjsMicroservicesAdapters.fromNestMessage).toBe("function");
		expect(typeof nestjsMicroservicesAdapters.provideGraphMessageProviders).toBe("function");
		expect(typeof observeStorage.attachObserveEventLog).toBe("function");
		expect(typeof observeStorage.attachObserveSink).toBe("function");
		expect(typeof patterns.profileSummary).toBe("function");
		expect(typeof patterns.eventFlow).toBe("function");
		expect(typeof patterns.eventFlowProjection).toBe("function");
		expect(typeof eventFlowPatterns.eventFlow).toBe("function");
		expect(typeof eventFlowPatterns.eventFlowProjection).toBe("function");
		expect(typeof patterns.cosineSimilarity).toBe("function");
		expect(typeof patterns.admissionScored).toBe("function");
		expect(typeof patterns.admissionFilter3D).toBe("function");
		expect(typeof patterns.shardByTenant).toBe("function");
		expect(typeof patterns.validateMemoryFragment).toBe("function");
		expect(typeof patterns.filterMemoryFragments).toBe("function");
		expect(typeof patterns.memoryRetrievalBundle).toBe("function");
		expect(typeof patterns.knowledgeGraphReducerBundle).toBe("function");
		expect(typeof scoring.cosineSimilarity).toBe("function");
		expect(typeof scoring.admissionScored).toBe("function");
		expect(typeof scoring.admissionFilter3D).toBe("function");
		expect(typeof scoring.scoreSubjects).toBe("function");
		expect(typeof scoring.rankScoredSubjects).toBe("function");
		expect(typeof scoring.normalizeScoreSignal).toBe("function");
		expect(typeof scoring.isFiniteScore).toBe("function");
		expect(Object.hasOwn(scoring, "memoryRetrievalBundle")).toBe(false);
		expect(Object.hasOwn(scoring, "agenticMemoryBundle")).toBe(false);
		expect(typeof memory.validateMemoryFragment).toBe("function");
		expect(typeof memory.filterMemoryFragments).toBe("function");
		expect(typeof memory.memoryRetrievalBundle).toBe("function");
		expect(typeof memory.knowledgeGraphReducerBundle).toBe("function");
		expect(Object.hasOwn(memory, "agenticMemoryBundle")).toBe(false);
		expect(typeof semanticMemory.validateMemoryFragment).toBe("function");
		expect(typeof semanticMemory.filterMemoryFragments).toBe("function");
		expect(typeof semanticMemory.memoryRetrievalBundle).toBe("function");
		expect(typeof semanticMemory.knowledgeGraphReducerBundle).toBe("function");
		expect(typeof adapters.memoryAgenticMemoryPassiveStoreFrameAdapter).toBe("function");
		expect(typeof adapters.persistAgenticMemoryRecords).toBe("function");
		expect(typeof adapters.openPersistentAgenticMemoryRecords).toBe("function");
		expect(typeof adapters.loadAgenticMemoryRecordsState).toBe("function");
		expect(typeof storage.memoryKv).toBe("function");
		expect(typeof storage.memoryAppendLog).toBe("function");
		expect(typeof storage.multiWriterAppendLogStorage).toBe("function");
		expect(typeof storage.memoryMultiWriterAppendLog).toBe("function");
		expect(typeof storage.tieredReadThrough).toBe("function");
		expect(typeof storage.readThroughKv).toBe("function");
		expect(typeof storage.readAppendLogPage).toBe("function");
		expect(typeof storage.readObserveEventLogPage).toBe("function");
		expect(typeof storage.walFrame).toBe("function");
		expect(typeof storage.walFrameKey).toBe("function");
		expect(typeof testing.assertDirtyPrecedesTerminalData).toBe("function");
		expect(Object.hasOwn(storage, "attachObserveSink")).toBe(false);
		expect(Object.hasOwn(storage, "attachObserveEventLog")).toBe(false);
		expectTypeOf<DataIssue>().toMatchTypeOf<{
			readonly kind: "issue";
			readonly code: string;
			readonly message: string;
		}>();
		expectTypeOf<DataResult<number>>().toMatchTypeOf<
			| { readonly kind: "ok"; readonly value: number }
			| { readonly kind: "error"; readonly error: DataIssue }
		>();
		expect(Object.keys(data)).toEqual([]);
		expect(typeof cqrs.cqrs).toBe("function");
		expect(typeof cqrs.cqrsCommandHandler).toBe("function");
		expect(typeof cqrs.cqrsProjection).toBe("function");
		expect(Object.hasOwn(cqrs, "dedupeReducer")).toBe(false);
		expect(typeof cqrsMessagingRecipe.cqrsMessagingRecipe).toBe("function");
		expect(typeof cqrsWorkQueueRecipe.cqrsWorkQueueRecipe).toBe("function");
		expect(Object.hasOwn(cqrs, "cqrsMessagingRecipe")).toBe(false);
		expect(Object.hasOwn(cqrs, "cqrsWorkQueueRecipe")).toBe(false);
		expect(typeof messaging.messageBus).toBe("function");
		expect(typeof messaging.eventMessage).toBe("function");
		expect(typeof messaging.isEventMessage).toBe("function");
		expect(typeof messaging.fromTopic).toBe("function");
		expect(typeof messaging.toTopic).toBe("function");
		expect(Object.hasOwn(messaging, "dynamicHub")).toBe(false);
		expect(Object.hasOwn(messaging, "fromHubTopic")).toBe(false);
		expect(Object.hasOwn(messaging, "toHubTopic")).toBe(false);
		expect(messaging.PROMPTS_TOPIC).toBe("prompts");
		expect(messaging.STANDARD_TOPICS).toEqual([
			"prompts",
			"responses",
			"injections",
			"deferred",
			"spawns",
			"context",
			"todos",
		]);
		expect(typeof workQueueModule.workQueue).toBe("function");
		expect(typeof workItemActions.workItemDomainActionProposalIntakeProjector).toBe("function");
		expect(typeof workItemActions.workItemDomainActionAdmissionProjector).toBe("function");
		expect(typeof workItemActions.workItemDomainActionApplicationProjector).toBe("function");
		expect(typeof workItemScheduling.workItemAuthoringProjector).toBe("function");
		expect(typeof workItemScheduling.workItemEffectPlanProjector).toBe("function");
		expect(typeof workItemScheduling.workItemVerificationRequestLowerer).toBe("function");
		expect(typeof workItemScheduling.workItemVerificationResultMapper).toBe("function");
		expect(typeof workItemScheduling.workItemCreatedFromDraft).toBe("function");
		expect(typeof workItemScheduling.recordWorkspaceProposal).toBe("function");
		expect(typeof workItemScheduling.decideWorkspaceProposalAdmission).toBe("function");
		expect(typeof workItemScheduling.projectWorkspaceProposalApplicationStatus).toBe("function");
		expect(typeof workItemScheduling.assertWorkspaceProposalDataOnly).toBe("function");
		expect(
			typeof workItemScheduling.workspaceProposalRequiredInputResponseApplicationProjector,
		).toBe("function");
		expect(typeof workItemScheduling.workspaceProposalWorkItemSpawnApplicationProjector).toBe(
			"function",
		);
		expect(typeof workItemScheduling.workspaceProposalWorkItemLinkApplicationProjector).toBe(
			"function",
		);
		expect(typeof workItemScheduling.workspaceProposalDomainActionApplicationProjector).toBe(
			"function",
		);
		expect(typeof workItemScheduling.recordWorkspaceProposalRequiredInputResponseOutcome).toBe(
			"function",
		);
		expect(typeof workItemScheduling.recordWorkspaceProposalWorkItemSpawnOutcome).toBe("function");
		expect(typeof workItemScheduling.recordWorkspaceProposalWorkItemLinkOutcome).toBe("function");
		expect(typeof workItemScheduling.recordWorkspaceProposalDomainActionOutcome).toBe("function");
		expect(typeof workItemScheduling.projectWorkspaceProposalFamilyOutcomeIndex).toBe("function");
		expect(typeof workItemScheduling.projectWorkspaceProposalFamilyApplicationDiagnostics).toBe(
			"function",
		);
		expect(typeof workItemScheduling.workspaceProposalFamilyApplicationDiagnosticProjector).toBe(
			"function",
		);
		expect(typeof workItemScheduling.projectWorkspaceProposalRepairReviewRequests).toBe("function");
		expect(typeof workItemScheduling.workspaceProposalRepairReviewProjector).toBe("function");
		expect(typeof workItemScheduling.recordWorkspaceProposalRepairReviewDecision).toBe("function");
		expect(typeof workItemScheduling.projectWorkspaceProposalRepairReviewStatuses).toBe("function");
		expect(typeof workItemScheduling.workspaceProposalRepairReviewStatusProjector).toBe("function");
		expect(typeof workItemScheduling.projectWorkspaceProposalFamilyApplicationReadModel).toBe(
			"function",
		);
		expect(typeof workItemScheduling.workspaceProposalFamilyApplicationReadModelProjector).toBe(
			"function",
		);
		expect(typeof workItemScheduling.projectWorkspaceProposalFamilyApplicationReadModels).toBe(
			"function",
		);
		expect(typeof workItemScheduling.workspaceProposalFamilyApplicationReadModelsProjector).toBe(
			"function",
		);
		expect(typeof workItemScheduling.projectWorkspaceProposalFamilyOutcomeDetailSupplyResults).toBe(
			"function",
		);
		expect(typeof workItemScheduling.workspaceProposalFamilyOutcomeDetailSupplyProjector).toBe(
			"function",
		);
		expect(typeof workItemScheduling.projectWorkspaceProposalRepairActionDescriptors).toBe(
			"function",
		);
		expect(typeof workItemScheduling.workspaceProposalRepairActionDescriptorProjector).toBe(
			"function",
		);
		expect(typeof workItemScheduling.validateWorkspaceProposalRepairActionIntent).toBe("function");
		expect(
			typeof workItemScheduling.prepareWorkspaceProposalRepairReviewDecisionRecordingInput,
		).toBe("function");
		expect(
			typeof workItemScheduling.projectWorkspaceProposalRepairSuccessorProposalIntakePreview,
		).toBe("function");
		expect(
			typeof workItemScheduling.validateWorkspaceProposalRepairActionDisplayPolicyAdvisory,
		).toBe("function");
		expect(
			typeof workItemScheduling.projectWorkspaceProposalRepairActionDisplayPolicyAdvisory,
		).toBe("function");
		expect(
			typeof workItemScheduling.workspaceProposalRepairActionDisplayPolicyAdvisoryProjector,
		).toBe("function");
		expect(
			typeof workItemScheduling.prepareWorkspaceProposalRepairSuccessorProposalReadyRequest,
		).toBe("function");
		expect(typeof workItemScheduling.workspaceProposalRepairActionIntentProjector).toBe("function");
		expect(
			typeof workItemScheduling.workspaceProposalRepairSuccessorProposalIntakePreviewProjector,
		).toBe("function");
		expect(
			typeof workItemScheduling.workspaceProposalRepairSuccessorProposalReadyRequestPreparationProjector,
		).toBe("function");
		expect("isCanvasWorkspaceProposalProjectionSlotMaterial" in workItemScheduling).toBe(false);
		expect("validateCanvasWorkspaceProposalProjectionSlotLifecycle" in workItemScheduling).toBe(
			false,
		);
		expect("releaseWorkspaceProposalProjectionFromCanvasSlot" in workItemScheduling).toBe(false);
		expect("canvasWorkspaceProposalProjectionSlotReleaseProjector" in workItemScheduling).toBe(
			false,
		);
		expect(typeof workItemScheduling.isWorkspaceProposalProjectionReleaseMaterial).toBe("function");
		expect(typeof workItemScheduling.validateWorkspaceProposalProjectionReleaseMaterial).toBe(
			"function",
		);
		expect(typeof workItemScheduling.workspaceProposalProjectionReleaseDiagnosticProjector).toBe(
			"function",
		);
		expectTypeOf<WorkspaceProposalFamilyApplicationReadModelQuery>()
			.toHaveProperty("queryId")
			.toEqualTypeOf<string>();
		expectTypeOf<WorkspaceProposalProjectionRelease>()
			.toHaveProperty("targetKind")
			.toEqualTypeOf<
				| "family-read-model-query"
				| "outcome-detail-supply-request"
				| "repair-action-advisory"
				| "repair-action-intent"
				| "repair-successor-preview"
				| "repair-successor-preparation"
			>();
		expectTypeOf<WorkspaceProposalProjectionReleaseDiagnostic>()
			.toHaveProperty("status")
			.toEqualTypeOf<"blocked">();
		expectTypeOf<WorkspaceProposalRepairActionDescriptor>()
			.toHaveProperty("actionKind")
			.toEqualTypeOf<
				| "acknowledge-review"
				| "withdraw-review"
				| "mark-human-resolved"
				| "supersede-review"
				| "open-successor-proposal-flow"
			>();
		expectTypeOf<
			import("../solutions/work-item/scheduling.js").WorkspaceProposalRepairActionIntent
		>()
			.toHaveProperty("descriptorId")
			.toEqualTypeOf<string>();
		expectTypeOf<
			import("../solutions/work-item/scheduling.js").WorkspaceProposalRepairSuccessorProposalIntakePreview
		>()
			.toHaveProperty("previewId")
			.toEqualTypeOf<string>();
		expectTypeOf<
			import("../solutions/work-item/scheduling.js").WorkspaceProposalRepairActionDisplayPolicyAdvisory
		>()
			.toHaveProperty("authority")
			.toEqualTypeOf<"display-only-advisory">();
		expectTypeOf<
			import("../solutions/work-item/scheduling.js").WorkspaceProposalRepairSuccessorProposalReadyRequestPreparationInput
		>()
			.toHaveProperty("successorProposalId")
			.toEqualTypeOf<string>();
		expectTypeOf<
			import("../solutions/work-item/scheduling.js").WorkspaceProposalFamilyOutcomeDetailSupplyRequest
		>()
			.toHaveProperty("supplyRequestId")
			.toEqualTypeOf<string>();
		expect(Object.hasOwn(solutions, "workItemAuthoringProjector")).toBe(false);
		expect(Object.hasOwn(solutions, "recordWorkspaceProposal")).toBe(false);
		expect(
			Object.hasOwn(solutions, "workspaceProposalRequiredInputResponseApplicationProjector"),
		).toBe(false);
		expect(Object.hasOwn(solutions, "workspaceProposalFamilyApplicationDiagnosticProjector")).toBe(
			false,
		);
		expect(Object.hasOwn(solutions, "projectWorkspaceProposalRepairReviewRequests")).toBe(false);
		expect(Object.hasOwn(solutions, "recordWorkspaceProposalRepairReviewDecision")).toBe(false);
		expect(Object.hasOwn(solutions, "projectWorkspaceProposalRepairReviewStatuses")).toBe(false);
		expect(Object.hasOwn(solutions, "workspaceProposalFamilyApplicationReadModelProjector")).toBe(
			false,
		);
		expect(Object.hasOwn(solutions, "workspaceProposalFamilyApplicationReadModelsProjector")).toBe(
			false,
		);
		expect(Object.hasOwn(solutions, "workspaceProposalFamilyOutcomeDetailSupplyProjector")).toBe(
			false,
		);
		expect(Object.hasOwn(solutions, "workspaceProposalRepairActionDescriptorProjector")).toBe(
			false,
		);
		expect(Object.hasOwn(solutions, "validateWorkspaceProposalRepairActionIntent")).toBe(false);
		expect(
			Object.hasOwn(solutions, "projectWorkspaceProposalRepairSuccessorProposalIntakePreview"),
		).toBe(false);
		expect(
			Object.hasOwn(solutions, "validateWorkspaceProposalRepairActionDisplayPolicyAdvisory"),
		).toBe(false);
		expect(
			Object.hasOwn(solutions, "workspaceProposalRepairActionDisplayPolicyAdvisoryProjector"),
		).toBe(false);
		expect(
			Object.hasOwn(solutions, "prepareWorkspaceProposalRepairSuccessorProposalReadyRequest"),
		).toBe(false);
		expect(
			Object.hasOwn(
				solutions,
				"workspaceProposalRepairSuccessorProposalReadyRequestPreparationProjector",
			),
		).toBe(false);
		expect(Object.hasOwn(solutions, "isCanvasWorkspaceProposalProjectionSlotMaterial")).toBe(false);
		expect(Object.hasOwn(solutions, "validateCanvasWorkspaceProposalProjectionSlotLifecycle")).toBe(
			false,
		);
		expect(Object.hasOwn(solutions, "releaseWorkspaceProposalProjectionFromCanvasSlot")).toBe(
			false,
		);
		expect(Object.hasOwn(solutions, "canvasWorkspaceProposalProjectionSlotReleaseProjector")).toBe(
			false,
		);
		expect(Object.hasOwn(solutions, "isWorkspaceProposalProjectionReleaseMaterial")).toBe(false);
		expect(Object.hasOwn(solutions, "validateWorkspaceProposalProjectionReleaseMaterial")).toBe(
			false,
		);
		expect(Object.hasOwn(solutions, "workspaceProposalProjectionReleaseDiagnosticProjector")).toBe(
			false,
		);
		expect(
			Object.hasOwn(rootPackage, "workspaceProposalFamilyApplicationDiagnosticProjector"),
		).toBe(false);
		expect(Object.hasOwn(rootPackage, "projectWorkspaceProposalRepairReviewRequests")).toBe(false);
		expect(Object.hasOwn(rootPackage, "recordWorkspaceProposalRepairReviewDecision")).toBe(false);
		expect(Object.hasOwn(rootPackage, "projectWorkspaceProposalRepairReviewStatuses")).toBe(false);
		expect(Object.hasOwn(rootPackage, "workspaceProposalFamilyApplicationReadModelProjector")).toBe(
			false,
		);
		expect(
			Object.hasOwn(rootPackage, "workspaceProposalFamilyApplicationReadModelsProjector"),
		).toBe(false);
		expect(Object.hasOwn(rootPackage, "workspaceProposalFamilyOutcomeDetailSupplyProjector")).toBe(
			false,
		);
		for (const name of [
			"AGENTIC_MEMORY_RECORD_CHANGE_FORMAT",
			"AGENTIC_MEMORY_RECORD_SNAPSHOT_FORMAT",
			"AGENTIC_MEMORY_RECORD_STORAGE_FRAME_VERSION",
			"AGENTIC_MEMORY_PASSIVE_STORE_FRAME_CURSOR_KIND",
			"agenticMemoryRecordChangeFrame",
			"agenticMemoryRecordSnapshotFrame",
			"agenticMemoryRecordsSnapshotKey",
			"assertAgenticMemoryRecordChangeFrame",
			"assertAgenticMemoryRecordSnapshotFrame",
			"loadAgenticMemoryRecordsState",
			"memoryAgenticMemoryPassiveStoreFrameAdapter",
			"openPersistentAgenticMemoryRecords",
			"persistAgenticMemoryRecords",
		] as const) {
			expect(Object.hasOwn(rootPackage, name)).toBe(false);
		}
		expect(Object.hasOwn(rootPackage, "workspaceProposalRepairActionDescriptorProjector")).toBe(
			false,
		);
		expect(Object.hasOwn(rootPackage, "validateWorkspaceProposalRepairActionIntent")).toBe(false);
		expect(
			Object.hasOwn(rootPackage, "projectWorkspaceProposalRepairSuccessorProposalIntakePreview"),
		).toBe(false);
		expect(
			Object.hasOwn(rootPackage, "validateWorkspaceProposalRepairActionDisplayPolicyAdvisory"),
		).toBe(false);
		expect(
			Object.hasOwn(rootPackage, "workspaceProposalRepairActionDisplayPolicyAdvisoryProjector"),
		).toBe(false);
		expect(
			Object.hasOwn(rootPackage, "prepareWorkspaceProposalRepairSuccessorProposalReadyRequest"),
		).toBe(false);
		expect(
			Object.hasOwn(
				rootPackage,
				"workspaceProposalRepairSuccessorProposalReadyRequestPreparationProjector",
			),
		).toBe(false);
		expect(Object.hasOwn(rootPackage, "isCanvasWorkspaceProposalProjectionSlotMaterial")).toBe(
			false,
		);
		expect(
			Object.hasOwn(rootPackage, "validateCanvasWorkspaceProposalProjectionSlotLifecycle"),
		).toBe(false);
		expect(Object.hasOwn(rootPackage, "releaseWorkspaceProposalProjectionFromCanvasSlot")).toBe(
			false,
		);
		expect(
			Object.hasOwn(rootPackage, "canvasWorkspaceProposalProjectionSlotReleaseProjector"),
		).toBe(false);
		expect(Object.hasOwn(rootPackage, "isWorkspaceProposalProjectionReleaseMaterial")).toBe(false);
		expect(Object.hasOwn(rootPackage, "validateWorkspaceProposalProjectionReleaseMaterial")).toBe(
			false,
		);
		expect(
			Object.hasOwn(rootPackage, "workspaceProposalProjectionReleaseDiagnosticProjector"),
		).toBe(false);
		expect(Object.hasOwn(solutions, "recordWorkspaceProposalDomainActionOutcome")).toBe(false);
		expect(Object.hasOwn(workItemActions, "workspaceProposalRepairActionDescriptorProjector")).toBe(
			false,
		);
		expect(Object.hasOwn(workItemActions, "validateWorkspaceProposalRepairActionIntent")).toBe(
			false,
		);
		expect(
			Object.hasOwn(
				workItemActions,
				"projectWorkspaceProposalRepairSuccessorProposalIntakePreview",
			),
		).toBe(false);
		expect(
			Object.hasOwn(workItemActions, "prepareWorkspaceProposalRepairSuccessorProposalReadyRequest"),
		).toBe(false);
		expect(
			Object.hasOwn(workItemActions, "projectWorkspaceProposalFamilyApplicationReadModels"),
		).toBe(false);
		expect(
			Object.hasOwn(workItemActions, "workspaceProposalFamilyOutcomeDetailSupplyProjector"),
		).toBe(false);
		expect(
			Object.hasOwn(workItemActions, "workspaceProposalRepairActionDisplayPolicyAdvisoryProjector"),
		).toBe(false);
		expect(Object.hasOwn(workItemActions, "isCanvasWorkspaceProposalProjectionSlotMaterial")).toBe(
			false,
		);
		expect(
			Object.hasOwn(workItemActions, "validateCanvasWorkspaceProposalProjectionSlotLifecycle"),
		).toBe(false);
		expect(Object.hasOwn(workItemActions, "releaseWorkspaceProposalProjectionFromCanvasSlot")).toBe(
			false,
		);
		expect(
			Object.hasOwn(workItemActions, "canvasWorkspaceProposalProjectionSlotReleaseProjector"),
		).toBe(false);
		expect(Object.hasOwn(workItemActions, "isWorkspaceProposalProjectionReleaseMaterial")).toBe(
			false,
		);
		expect(
			Object.hasOwn(workItemActions, "validateWorkspaceProposalProjectionReleaseMaterial"),
		).toBe(false);
		expect(
			Object.hasOwn(workItemActions, "workspaceProposalProjectionReleaseDiagnosticProjector"),
		).toBe(false);
		expect(Object.hasOwn(solutions, "workItemDomainActionApplicationProjector")).toBe(false);
		expect(typeof workItemWorkQueueRecipe.workItemWorkQueueRecipe).toBe("function");
		expect(typeof workItemWorkQueueRecipe.workItemSubmitCommand).toBe("function");
		expect(typeof executorWorkQueueRecipe.executorWorkQueueRecipe).toBe("function");
		expect(typeof executorWorkQueueRecipe.executorSubmitCommand).toBe("function");
		expect(typeof executorToolProviderRecipe.toolProviderExecutionRecipe).toBe("function");
		expect(typeof executorToolProviderAdapters.localBuiltinToolProviderBinding).toBe("function");
		expect(typeof executorToolProviderAdapters.localBuiltinToolProviderAdapterPack).toBe(
			"function",
		);
		expect(typeof executorToolProviderAdapters.processToolProviderBinding).toBe("function");
		expect(typeof executorToolProviderAdapters.processToolProviderAdapterPack).toBe("function");
		expect(typeof executorToolProviderAdapters.processToolProviderCatalog).toBe("function");
		expect(typeof executorToolProviderAdapters.httpToolProviderCatalog).toBe("function");
		expect(typeof executorToolProviderAdapters.httpToolProviderRuntime).toBe("function");
		expect(Object.hasOwn(executorToolProviderAdapters, "attachToolProviderAdapterRuntime")).toBe(
			false,
		);
		expect(Object.hasOwn(executorToolProviderAdapters, "toolProviderExecutionRecipe")).toBe(false);
		expect(typeof executorToolProviderRuntime.attachToolProviderAdapterRuntime).toBe("function");
		expect(typeof orchestration.retryPolicy).toBe("function");
		expect(typeof orchestration.retryStatusBundle).toBe("function");
		expect(typeof orchestration.breakerBundle).toBe("function");
		expect(typeof orchestration.processBundle).toBe("function");
		expect(typeof orchestration.processEffectRunner).toBe("function");
		expect(typeof orchestration.rateLimitBundle).toBe("function");
		expect(typeof orchestration.timeoutBundle).toBe("function");
		expect(typeof orchestration.requestSatisfactionProjector).toBe("function");
		expect(typeof orchestration.effectRunCompletionProjector).toBe("function");
		expect(typeof orchestration.localBuiltinToolProviderCatalog).toBe("function");
		expect(typeof orchestration.executorOutcomeViewProjector).toBe("function");
		expect(typeof orchestration.validateToolProviderExecutionPolicy).toBe("function");
		expect(typeof orchestration.resolveToolProviderExecutionPolicies).toBe("function");
		expect(typeof orchestration.toolProviderPolicyResolutionProjector).toBe("function");
		expect(typeof orchestration.buildToolProviderAdapterInputs).toBe("function");
		expect(typeof orchestration.toolProviderAdapterInputProjector).toBe("function");
		expect(typeof orchestration.requestToolProviderAdapterRun).toBe("function");
		expect(typeof orchestration.toolProviderAdapterRunProjector).toBe("function");
		expect(typeof orchestration.toolProviderRunAdmissionProjector).toBe("function");
		expect(typeof orchestration.toolProviderRunRetryProjector).toBe("function");
		expect(typeof orchestration.scheduledReadinessProjector).toBe("function");
		expect(typeof orchestration.buildToolProviderExecutorOutcome).toBe("function");
		expect(Object.hasOwn(orchestration, "attachToolProviderAdapterRuntime")).toBe(false);
		expectTypeOf<ToolProviderExecutionPolicy>().toMatchTypeOf<{
			readonly kind: "tool-provider-execution-policy";
			readonly policyId: string;
			readonly providerId: string;
		}>();
		expectTypeOf<ToolProviderAdapterInputStatus>().toEqualTypeOf<
			| "ready"
			| "pending-route"
			| "missing-tool-call"
			| "missing-catalog"
			| "ambiguous-catalog"
			| "missing-tool"
			| "missing-policy"
			| "invalid-policy"
		>();
		expectTypeOf<ToolProviderAdapterInput>().toMatchTypeOf<{
			readonly kind: "tool-provider-adapter-input";
			readonly adapterInputId: string;
			readonly status: ToolProviderAdapterInputStatus;
			readonly requestId: string;
			readonly operationId: string;
		}>();
		expectTypeOf<ToolProviderAdapterInputBundle>().toHaveProperty("inputs");
		expectTypeOf<ToolProviderAdapterRunRequested>().toMatchTypeOf<{
			readonly kind: "tool-provider-adapter-run-requested";
			readonly runId: string;
			readonly adapterInputId: string;
			readonly attempt: number;
		}>();
		expectTypeOf<ToolProviderAdapterRunStatus>().toHaveProperty("status");
		expectTypeOf<ToolProviderAdapterRunBundle>().toHaveProperty("requests");
		expectTypeOf<ToolProviderRunAdmissionProposal>().toMatchTypeOf<{
			readonly kind: "tool-provider-run-admission-proposal";
			readonly proposalId: string;
			readonly approvalMode: string;
		}>();
		expectTypeOf<ToolProviderRunAdmissionDecision>().toMatchTypeOf<{
			readonly kind: "tool-provider-run-admission-decision";
			readonly decisionId: string;
			readonly proposalId: string;
			readonly outcome: "admit" | "block" | "defer";
		}>();
		expectTypeOf<ToolProviderRunAdmissionStatus>().toHaveProperty("state");
		expectTypeOf<ToolProviderRunAdmissionBundle>().toHaveProperty("approvedRunRequests");
		expectTypeOf<ToolProviderRunRetryPolicy>().toMatchTypeOf<{
			readonly kind: "tool-provider-run-retry-policy";
			readonly policyId: string;
		}>();
		expectTypeOf<ToolProviderRunRetryProposal>().toMatchTypeOf<{
			readonly kind: "tool-provider-run-retry-proposal";
			readonly nextAttempt: number;
			readonly nextRunId: string;
		}>();
		expectTypeOf<ToolProviderRunRetryScheduled>().toHaveProperty("retryAtMs");
		expectTypeOf<ToolProviderRunRetryStatus>().toHaveProperty("state");
		expectTypeOf<ToolProviderRunRetryBundle>().toHaveProperty("runRequests");
		expectTypeOf<ScheduledReadinessRequested>().toMatchTypeOf<{
			readonly kind: "scheduled-readiness-requested";
			readonly scheduleId: string;
			readonly subjectRefs: readonly unknown[];
			readonly readyAtMs: number;
		}>();
		expectTypeOf<ScheduledReadinessClock>().toMatchTypeOf<{
			readonly kind: "scheduled-readiness-clock";
			readonly nowMs: number;
		}>();
		expectTypeOf<ScheduledReadinessReady>().toHaveProperty("readyAtMs");
		expectTypeOf<ScheduledReadinessStatus>().toHaveProperty("state");
		expectTypeOf<ScheduledReadinessBundle>().toHaveProperty("ready");
		expectTypeOf<ToolProviderPublicTextPolicy>().toHaveProperty("maxSummaryChars");
		expectTypeOf<ToolProviderAdapterRunResult>().toMatchTypeOf<{ readonly kind: string }>();
		expectTypeOf<ExecutorArtifactMaterial>().toMatchTypeOf<{
			readonly kind: string;
			readonly dataMode: "inline" | "summary" | "ref" | (string & {});
		}>();
		expectTypeOf<SizeCapacityEvidence>().toHaveProperty("measurementSource");
		expect(Object.hasOwn(orchestration, "workItemEffectRunProjector")).toBe(false);
		expect(typeof orchestrationMessagingRecipe.orchestrationMessagingRecipe).toBe("function");
		expect(typeof orchestrationWorkQueueRecipe.orchestrationWorkQueueRecipe).toBe("function");
		expect(Object.hasOwn(orchestration, "orchestrationMessagingRecipe")).toBe(false);
		expect(Object.hasOwn(orchestration, "orchestrationWorkQueueRecipe")).toBe(false);
		expect(Object.hasOwn(orchestration, "workQueueScheduledReadinessProjector")).toBe(false);
		expect(Object.hasOwn(orchestration, "workQueueReadinessHandoffProjector")).toBe(false);
		expect(Object.hasOwn(orchestration, "workQueueLeaseExpirationCommandProjector")).toBe(false);
		expect(Object.hasOwn(rootPackage, "workQueueScheduledReadinessProjector")).toBe(false);
		expect(Object.hasOwn(rootPackage, "workQueueReadinessHandoffProjector")).toBe(false);
		expect(Object.hasOwn(rootPackage, "workQueueLeaseExpirationCommandProjector")).toBe(false);
		expect(typeof orchestrationWorkQueueRecipe.workQueueScheduledReadinessProjector).toBe(
			"function",
		);
		expect(typeof orchestrationWorkQueueRecipe.workQueueReadinessHandoffProjector).toBe("function");
		expect(typeof orchestrationWorkQueueRecipe.workQueueLeaseExpirationCommandProjector).toBe(
			"function",
		);
		expectTypeOf<WorkQueueScheduledReadinessBundle>().toHaveProperty("readinessSchedules");
		expectTypeOf<WorkQueueScheduledReadinessStatus>().toHaveProperty("readyAtMs");
		expectTypeOf<WorkQueueReadinessHandoffBundle>().toHaveProperty("candidates");
		expectTypeOf<WorkQueueReadinessHandoffStatus>().toHaveProperty("candidateKind");
		expectTypeOf<WorkQueueLeaseExpirationCommandBundle>().toHaveProperty("commands");
		expect(typeof rootPackage.agenticMemoryBundle).toBe("function");
		expect(typeof rootPackage.agenticMemoryContextPackingBundle).toBe("function");
		expect(typeof rootPackage.agenticMemoryRecordAdmissionBundle).toBe("function");
		expect(typeof rootPackage.projectAgenticMemoryRecordAdmissionPolicySource).toBe("function");
		expect(typeof rootPackage.agenticMemoryRecordAdmissionPolicySourceBundle).toBe("function");
		expect(typeof rootPackage.admitAgenticMemoryRecordProposals).toBe("function");
		expect(typeof rootPackage.agenticMemoryRecordApplicationBundle).toBe("function");
		expect(typeof rootPackage.projectAgenticMemoryRecordApplicationPriorEvidence).toBe("function");
		expect(typeof rootPackage.projectAgenticMemoryRecordApplicationEvidenceFacts).toBe("function");
		expect(typeof rootPackage.agenticMemoryRecordApplicationPriorEvidenceBundle).toBe("function");
		expect(typeof rootPackage.agenticMemoryRecordApplicationEvidenceFactsBundle).toBe("function");
		expect(typeof rootPackage.materializeAgenticMemoryRecordChanges).toBe("function");
		expect(typeof rootPackage.agenticMemoryRecordMaterializerBundle).toBe("function");
		expect(typeof rootPackage.agenticMemoryConsolidationApplicationBundle).toBe("function");
		expect(typeof rootPackage.applyAgenticMemoryRecordAdmissions).toBe("function");
		expect(typeof rootPackage.frameAgenticMemoryRecords).toBe("function");
		expect(typeof rootPackage.decodeAgenticMemoryRecordStoreFrame).toBe("function");
		expect(typeof rootPackage.agenticMemoryRecordStoreFrameCodec).toBe("function");
		expect(typeof rootPackage.agenticMemoryRecordStoreFrameBundle).toBe("function");
		expect(typeof rootPackage.frameAgenticMemoryApplicationEvidence).toBe("function");
		expect(typeof rootPackage.decodeAgenticMemoryApplicationEvidenceStoreFrame).toBe("function");
		expect(typeof rootPackage.agenticMemoryApplicationEvidenceStoreFrameCodec).toBe("function");
		expect(typeof rootPackage.agenticMemoryApplicationEvidenceStoreFrameBundle).toBe("function");
		expect(typeof rootPackage.frameAgenticMemoryApplicationDecisions).toBe("function");
		expect(typeof rootPackage.decodeAgenticMemoryApplicationDecisionStoreFrame).toBe("function");
		expect(typeof rootPackage.agenticMemoryApplicationDecisionStoreFrameCodec).toBe("function");
		expect(typeof rootPackage.mapAgenticWorkItemMemoryBridge).toBe("function");
		expect(typeof rootPackage.agenticWorkItemMemoryBridgeBundle).toBe("function");
		expect(typeof rootPackage.mapAgenticWorkItemMemoryApplicationRecipe).toBe("function");
		expect(typeof rootPackage.agenticWorkItemMemoryApplicationRecipeBundle).toBe("function");
		expect(rootPackage.AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM).toBe(
			"graphrefly.agenticMemoryRecordApplicationMaterial.v1",
		);
		expect(rootPackage.AGENTIC_MEMORY_COMMITTED_FACT_FORMAT).toBe(
			"graphrefly.agenticMemoryCommittedFact",
		);
		expect(rootPackage.AGENTIC_MEMORY_DURABILITY_ADVANCE_ON_COMMITTED_OR_DUPLICATE_POLICY).toBe(
			"agentic-memory-durability-advance-on-committed-or-duplicate",
		);
		expect(rootPackage.AGENTIC_MEMORY_COMMITTED_FACT_LOG_BACKEND_CURSOR_KIND).toBe(
			"agentic-memory-committed-fact-log-backend.cursor",
		);
		expect(typeof rootPackage.agenticMemoryCommittedFactBatch).toBe("function");
		expect(typeof rootPackage.memoryAgenticMemoryCommittedFactLog).toBe("function");
		expect(typeof rootPackage.agenticMemoryCommittedFactLogBackendAdapter).toBe("function");
		expect(typeof rootPackage.agenticMemoryCommittedFactLogBackendCursor).toBe("function");
		expect(typeof rootPackage.agenticMemoryCommittedFactLogBackendStatus).toBe("function");
		expect(typeof rootPackage.agenticMemoryCommittedFactLogStartupRead).toBe("function");
		expect(typeof rootPackage.agenticMemoryCommittedFactLogAppendAttempt).toBe("function");
		expect(typeof rootPackage.normalizeAgenticMemoryCommittedFactLogBackendAppendResult).toBe(
			"function",
		);
		expect(typeof rootPackage.normalizeAgenticMemoryCommittedFactLogBackendReadResult).toBe(
			"function",
		);
		expect(typeof rootPackage.materializeAgenticMemoryCommittedFacts).toBe("function");
		expect(typeof rootPackage.projectAgenticMemoryCommittedFactReadMaterialization).toBe(
			"function",
		);
		expect(typeof rootPackage.agenticMemoryCommittedFactReadMaterializationBundle).toBe("function");
		expect(typeof rootPackage.agenticMemoryMaterializedFactLogBootstrapInput).toBe("function");
		expect(typeof rootPackage.projectAgenticMemoryMaterializedFactLogBootstrap).toBe("function");
		expect(typeof rootPackage.agenticMemoryMaterializedFactLogBootstrapBundle).toBe("function");
		expect(typeof rootPackage.agenticMemoryDurabilityGateBundle).toBe("function");
		expect(typeof rootPackage.agenticMemoryDurabilityGateInput).toBe("function");
		expect(typeof rootPackage.projectAgenticMemoryDurabilityGate).toBe("function");
		expect(typeof rootPackage.agenticMemoryDurabilityResultMayAdvance).toBe("function");
		expect(typeof rootPackage.agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy).toBe(
			"function",
		);
		expect(typeof rootPackage.agenticMemoryDurabilityUncertainResolutionStatus).toBe("function");
		expect(typeof solutions.agenticMemoryBundle).toBe("function");
		expect(typeof solutions.projectAgenticMemoryRecordAdmissionPolicySource).toBe("function");
		expect(typeof solutions.agenticMemoryRecordAdmissionPolicySourceBundle).toBe("function");
		expect(typeof solutions.agenticMemoryRecordApplicationBundle).toBe("function");
		expect(typeof solutions.projectAgenticMemoryRecordApplicationPriorEvidence).toBe("function");
		expect(typeof solutions.projectAgenticMemoryRecordApplicationEvidenceFacts).toBe("function");
		expect(typeof solutions.agenticMemoryRecordApplicationPriorEvidenceBundle).toBe("function");
		expect(typeof solutions.agenticMemoryRecordApplicationEvidenceFactsBundle).toBe("function");
		expect(typeof solutions.materializeAgenticMemoryRecordChanges).toBe("function");
		expect(typeof solutions.agenticMemoryRecordMaterializerBundle).toBe("function");
		expect(typeof solutions.agenticMemoryConsolidationApplicationBundle).toBe("function");
		expect(typeof solutions.applyAgenticMemoryRecordAdmissions).toBe("function");
		expect(typeof solutions.frameAgenticMemoryRecords).toBe("function");
		expect(typeof solutions.decodeAgenticMemoryRecordStoreFrame).toBe("function");
		expect(typeof solutions.agenticMemoryRecordStoreFrameCodec).toBe("function");
		expect(typeof solutions.agenticMemoryRecordStoreFrameBundle).toBe("function");
		expect(typeof solutions.frameAgenticMemoryApplicationEvidence).toBe("function");
		expect(typeof solutions.decodeAgenticMemoryApplicationEvidenceStoreFrame).toBe("function");
		expect(typeof solutions.agenticMemoryApplicationEvidenceStoreFrameCodec).toBe("function");
		expect(typeof solutions.agenticMemoryApplicationEvidenceStoreFrameBundle).toBe("function");
		expect(typeof solutions.frameAgenticMemoryApplicationDecisions).toBe("function");
		expect(typeof solutions.decodeAgenticMemoryApplicationDecisionStoreFrame).toBe("function");
		expect(typeof solutions.agenticMemoryApplicationDecisionStoreFrameCodec).toBe("function");
		expect(typeof solutions.mapAgenticWorkItemMemoryBridge).toBe("function");
		expect(typeof solutions.agenticWorkItemMemoryBridgeBundle).toBe("function");
		expect(typeof solutions.mapAgenticWorkItemMemoryApplicationRecipe).toBe("function");
		expect(typeof solutions.agenticWorkItemMemoryApplicationRecipeBundle).toBe("function");
		expect(solutions.AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM).toBe(
			"graphrefly.agenticMemoryRecordApplicationMaterial.v1",
		);
		expect(solutions.AGENTIC_MEMORY_COMMITTED_FACT_FORMAT).toBe(
			"graphrefly.agenticMemoryCommittedFact",
		);
		expect(solutions.AGENTIC_MEMORY_DURABILITY_ADVANCE_ON_COMMITTED_OR_DUPLICATE_POLICY).toBe(
			"agentic-memory-durability-advance-on-committed-or-duplicate",
		);
		expect(solutions.AGENTIC_MEMORY_COMMITTED_FACT_LOG_BACKEND_CURSOR_KIND).toBe(
			"agentic-memory-committed-fact-log-backend.cursor",
		);
		expect(typeof solutions.agenticMemoryCommittedFactBatch).toBe("function");
		expect(typeof solutions.memoryAgenticMemoryCommittedFactLog).toBe("function");
		expect(typeof solutions.agenticMemoryCommittedFactLogBackendAdapter).toBe("function");
		expect(typeof solutions.agenticMemoryCommittedFactLogBackendCursor).toBe("function");
		expect(typeof solutions.agenticMemoryCommittedFactLogBackendStatus).toBe("function");
		expect(typeof solutions.agenticMemoryCommittedFactLogStartupRead).toBe("function");
		expect(typeof solutions.agenticMemoryCommittedFactLogAppendAttempt).toBe("function");
		expect(typeof solutions.normalizeAgenticMemoryCommittedFactLogBackendAppendResult).toBe(
			"function",
		);
		expect(typeof solutions.normalizeAgenticMemoryCommittedFactLogBackendReadResult).toBe(
			"function",
		);
		expect(typeof solutions.materializeAgenticMemoryCommittedFacts).toBe("function");
		expect(typeof solutions.projectAgenticMemoryCommittedFactReadMaterialization).toBe("function");
		expect(typeof solutions.agenticMemoryCommittedFactReadMaterializationBundle).toBe("function");
		expect(typeof solutions.agenticMemoryMaterializedFactLogBootstrapInput).toBe("function");
		expect(typeof solutions.projectAgenticMemoryMaterializedFactLogBootstrap).toBe("function");
		expect(typeof solutions.agenticMemoryMaterializedFactLogBootstrapBundle).toBe("function");
		expect(typeof solutions.agenticMemoryDurabilityGateBundle).toBe("function");
		expect(typeof solutions.agenticMemoryDurabilityGateInput).toBe("function");
		expect(typeof solutions.projectAgenticMemoryDurabilityGate).toBe("function");
		expect(typeof solutions.agenticMemoryDurabilityResultMayAdvance).toBe("function");
		expect(typeof solutions.agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy).toBe(
			"function",
		);
		expect(typeof solutions.agenticMemoryDurabilityUncertainResolutionStatus).toBe("function");
		expect(typeof agenticMemory.agenticMemoryBundle).toBe("function");
		expect(typeof agenticMemory.agenticMemoryKgProjectionBundle).toBe("function");
		expect(typeof agenticMemory.agenticMemoryRecordFrame).toBe("function");
		expect(typeof agenticMemory.agenticMemoryRecordFrameCodec).toBe("function");
		expect(typeof agenticMemory.agenticMemoryRecordCodec).toBe("function");
		expect(typeof agenticMemory.agenticMemoryRetentionBundle).toBe("function");
		expect(typeof agenticMemory.agenticMemoryConsolidationBundle).toBe("function");
		expect(typeof agenticMemory.agenticMemoryConsolidationApplicationBundle).toBe("function");
		expect(typeof agenticMemory.agenticMemoryContextPackingBundle).toBe("function");
		expect(typeof agenticMemory.agenticMemoryRecordAdmissionBundle).toBe("function");
		expect(typeof agenticMemory.projectAgenticMemoryRecordAdmissionPolicySource).toBe("function");
		expect(typeof agenticMemory.agenticMemoryRecordAdmissionPolicySourceBundle).toBe("function");
		expect(typeof agenticMemory.admitAgenticMemoryRecordProposals).toBe("function");
		expect(typeof agenticMemory.agenticMemoryRecordApplicationBundle).toBe("function");
		expect(typeof agenticMemory.projectAgenticMemoryRecordApplicationPriorEvidence).toBe(
			"function",
		);
		expect(typeof agenticMemory.projectAgenticMemoryRecordApplicationEvidenceFacts).toBe(
			"function",
		);
		expect(typeof agenticMemory.agenticMemoryRecordApplicationPriorEvidenceBundle).toBe("function");
		expect(typeof agenticMemory.agenticMemoryRecordApplicationEvidenceFactsBundle).toBe("function");
		expect(typeof agenticMemory.materializeAgenticMemoryRecordChanges).toBe("function");
		expect(typeof agenticMemory.agenticMemoryRecordMaterializerBundle).toBe("function");
		expect(typeof agenticMemory.applyAgenticMemoryRecordAdmissions).toBe("function");
		expect(typeof agenticMemory.frameAgenticMemoryRecords).toBe("function");
		expect(typeof agenticMemory.decodeAgenticMemoryRecordStoreFrame).toBe("function");
		expect(typeof agenticMemory.agenticMemoryRecordStoreFrameCodec).toBe("function");
		expect(typeof agenticMemory.agenticMemoryRecordStoreFrameBundle).toBe("function");
		expect(typeof agenticMemory.frameAgenticMemoryApplicationEvidence).toBe("function");
		expect(typeof agenticMemory.decodeAgenticMemoryApplicationEvidenceStoreFrame).toBe("function");
		expect(typeof agenticMemory.agenticMemoryApplicationEvidenceStoreFrameCodec).toBe("function");
		expect(typeof agenticMemory.agenticMemoryApplicationEvidenceStoreFrameBundle).toBe("function");
		expect(typeof agenticMemory.frameAgenticMemoryApplicationDecisions).toBe("function");
		expect(typeof agenticMemory.decodeAgenticMemoryApplicationDecisionStoreFrame).toBe("function");
		expect(typeof agenticMemory.agenticMemoryApplicationDecisionStoreFrameCodec).toBe("function");
		expect(agenticMemory.AGENTIC_MEMORY_RECORD_APPLICATION_MATERIAL_IDENTITY_ALGORITHM).toBe(
			"graphrefly.agenticMemoryRecordApplicationMaterial.v1",
		);
		expect(agenticMemory.AGENTIC_MEMORY_COMMITTED_FACT_FORMAT).toBe(
			"graphrefly.agenticMemoryCommittedFact",
		);
		expect(agenticMemory.AGENTIC_MEMORY_DURABILITY_ADVANCE_ON_COMMITTED_OR_DUPLICATE_POLICY).toBe(
			"agentic-memory-durability-advance-on-committed-or-duplicate",
		);
		expect(agenticMemory.AGENTIC_MEMORY_COMMITTED_FACT_LOG_BACKEND_CURSOR_KIND).toBe(
			"agentic-memory-committed-fact-log-backend.cursor",
		);
		expect(typeof agenticMemory.agenticMemoryCommittedRecordMaterialFact).toBe("function");
		expect(typeof agenticMemory.agenticMemoryCommittedApplicationDecisionFact).toBe("function");
		expect(typeof agenticMemory.agenticMemoryCommittedFactBatch).toBe("function");
		expect(typeof agenticMemory.memoryAgenticMemoryCommittedFactLog).toBe("function");
		expect(typeof agenticMemory.agenticMemoryCommittedFactLogBackendAdapter).toBe("function");
		expect(typeof agenticMemory.agenticMemoryCommittedFactLogBackendCursor).toBe("function");
		expect(typeof agenticMemory.agenticMemoryCommittedFactLogBackendStatus).toBe("function");
		expect(typeof agenticMemory.agenticMemoryCommittedFactLogStartupRead).toBe("function");
		expect(typeof agenticMemory.agenticMemoryCommittedFactLogAppendAttempt).toBe("function");
		expect(typeof agenticMemory.normalizeAgenticMemoryCommittedFactLogBackendAppendResult).toBe(
			"function",
		);
		expect(typeof agenticMemory.normalizeAgenticMemoryCommittedFactLogBackendReadResult).toBe(
			"function",
		);
		expect(typeof agenticMemory.materializeAgenticMemoryCommittedFacts).toBe("function");
		expect(typeof agenticMemory.projectAgenticMemoryCommittedFactReadMaterialization).toBe(
			"function",
		);
		expect(typeof agenticMemory.agenticMemoryCommittedFactReadMaterializationBundle).toBe(
			"function",
		);
		expect(typeof agenticMemory.agenticMemoryMaterializedFactLogBootstrapInput).toBe("function");
		expect(typeof agenticMemory.projectAgenticMemoryMaterializedFactLogBootstrap).toBe("function");
		expect(typeof agenticMemory.agenticMemoryMaterializedFactLogBootstrapBundle).toBe("function");
		expect(typeof agenticMemory.agenticMemoryCommittedFactSnapshotTailEquivalent).toBe("function");
		expect(typeof agenticMemory.agenticMemoryDurabilityGateBundle).toBe("function");
		expect(typeof agenticMemory.agenticMemoryDurabilityGateInput).toBe("function");
		expect(typeof agenticMemory.projectAgenticMemoryDurabilityGate).toBe("function");
		expect(typeof agenticMemory.agenticMemoryDurabilityResultMayAdvance).toBe("function");
		expect(typeof agenticMemory.agenticMemoryDurabilityAdvanceOnCommittedOrDuplicatePolicy).toBe(
			"function",
		);
		expect(typeof agenticMemory.agenticMemoryDurabilityUncertainResolutionStatus).toBe("function");
		expect(typeof agenticMemoryBrowser.indexedDbAgenticMemoryCommittedFactLogBackend).toBe(
			"function",
		);
		expect(typeof agenticMemoryNode.nodeFileAgenticMemoryCommittedFactLogBackend).toBe("function");
		expect(Object.hasOwn(agenticMemory, "indexedDbAgenticMemoryCommittedFactLogBackend")).toBe(
			false,
		);
		expect(Object.hasOwn(solutions, "indexedDbAgenticMemoryCommittedFactLogBackend")).toBe(false);
		expect(Object.hasOwn(rootPackage, "indexedDbAgenticMemoryCommittedFactLogBackend")).toBe(false);
		expect(Object.hasOwn(agenticMemory, "nodeFileAgenticMemoryCommittedFactLogBackend")).toBe(
			false,
		);
		expect(Object.hasOwn(solutions, "nodeFileAgenticMemoryCommittedFactLogBackend")).toBe(false);
		expect(Object.hasOwn(rootPackage, "nodeFileAgenticMemoryCommittedFactLogBackend")).toBe(false);
		expect(typeof solutions.admitAgenticMemoryRecordProposals).toBe("function");
		expectTypeOf<AgenticMemoryDurabilityDownstreamAdvancePolicy>().toHaveProperty("policyId");
		expectTypeOf<AgenticMemoryDurabilityGateBundleOptions>().toHaveProperty("attemptResult");
		expectTypeOf<AgenticMemoryDurabilityGateInput>().toHaveProperty("commitResult");
		expectTypeOf<AgenticMemoryDurabilityGateStatus>().toHaveProperty("commitStatus");
		expectTypeOf<AgenticMemoryRecordApplicationPolicy>().toHaveProperty("policyId");
		expectTypeOf<AgenticMemoryRecordApplicationOperation>().toEqualTypeOf<
			"create" | "replace" | "update"
		>();
		expectTypeOf<SolutionsAgenticMemoryRecordApplicationOperation>().toEqualTypeOf<AgenticMemoryRecordApplicationOperation>();
		expectTypeOf<AgenticMemoryRecordApplicationMaterialIdentityAlgorithm>().toEqualTypeOf<"graphrefly.agenticMemoryRecordApplicationMaterial.v1">();
		expectTypeOf<AgenticMemoryRecordApplicationMaterialIdentity>().toHaveProperty("key");
		expectTypeOf<AgenticMemoryRecordApplicationOperationStatus>().toHaveProperty(
			"operationVersion",
		);
		expectTypeOf<AgenticMemoryRecordApplicationDecision>()
			.toHaveProperty("reasonCode")
			.toEqualTypeOf<string>();
		expectTypeOf<AgenticMemoryRecordApplicationDecision>().toHaveProperty("materialIdentity");
		expectTypeOf<AgenticMemoryRecordApplicationDecision>()
			.toHaveProperty("operation")
			.toEqualTypeOf<AgenticMemoryRecordApplicationOperation>();
		expectTypeOf<AgenticMemoryRecordApplicationPriorEvidence>().toHaveProperty("entries");
		expectTypeOf<AgenticMemoryRecordApplicationPriorEvidenceProjection>().toHaveProperty(
			"priorEvidence",
		);
		expectTypeOf<AgenticMemoryRecordApplicationEvidenceFactsProjection>().toHaveProperty(
			"evidenceFacts",
		);
		expectTypeOf<AgenticMemoryRecordApplicationPriorEvidenceBundleOptions>().toHaveProperty(
			"evidenceFacts",
		);
		expectTypeOf<AgenticMemoryRecordApplicationEvidenceFactsBundleOptions>().toHaveProperty(
			"applicationDecisions",
		);
		expectTypeOf<AgenticMemoryRecordApplicationOptions>().toHaveProperty("priorEvidence");
		expectTypeOf<AgenticMemoryRecordApplicationBundleOptions>().toHaveProperty("priorEvidence");
		expectTypeOf<AgenticMemoryRecordMaterializationIntent>().toHaveProperty("intentId");
		expectTypeOf<AgenticMemoryRecordMaterializationIntent>()
			.toHaveProperty("operation")
			.toEqualTypeOf<AgenticMemoryRecordApplicationOperation>();
		expectTypeOf<AgenticMemoryRecordMaterializationProjection>().toHaveProperty("proposals");
		expectTypeOf<AgenticMemoryRecordMaterializationStatus>().toHaveProperty("cursor");
		expectTypeOf<AgenticMemoryRecordMaterializerBundleOptions>().toHaveProperty("intents");
		expectTypeOf<AgenticMemoryFactCommitStatus>().toEqualTypeOf<
			"committed" | "duplicate" | "conflict" | "rejected" | "uncertain"
		>();
		expectTypeOf<AgenticMemoryCommittedFactLog>().toHaveProperty("append");
		expectTypeOf<AgenticMemoryCommittedFactLogBackend>().toHaveProperty("append");
		expectTypeOf<AgenticMemoryCommittedFactLogBackendAppendResult>().toHaveProperty("status");
		expectTypeOf<AgenticMemoryCommittedFactLogBackendStatus>().toHaveProperty("capabilities");
		expectTypeOf<AgenticMemoryCommittedFactLogBackendStatus>()
			.toHaveProperty("state")
			.toEqualTypeOf<"available" | "degraded" | "unavailable" | "unknown">();
		expectTypeOf<AgenticMemoryCommittedFactLogStartupReadOptions>().toHaveProperty("read");
		expectTypeOf<AgenticMemoryCommittedFactLogStartupReadResult>().toHaveProperty(
			"bootstrapStatus",
		);
		expectTypeOf<AgenticMemoryCommittedFactLogAppendAttemptOptions>().toHaveProperty(
			"downstreamAdvancePolicy",
		);
		expectTypeOf<AgenticMemoryCommittedFactLogAppendAttemptResult>().toHaveProperty(
			"durabilityStatus",
		);
		expectTypeOf<AgenticMemoryCommittedFactReadMaterializationProjection>().toHaveProperty(
			"priorEvidence",
		);
		expectTypeOf<AgenticMemoryCommittedFactReadMaterializationStatus>().toHaveProperty(
			"factLogCursor",
		);
		expectTypeOf<AgenticMemoryCommittedFactReadMaterializationBundleOptions>().toHaveProperty(
			"readResult",
		);
		expectTypeOf<AgenticMemoryMaterializedFactLogBootstrapProjection>().toHaveProperty(
			"priorEvidence",
		);
		expectTypeOf<AgenticMemoryMaterializedFactLogBootstrapStatus>().toHaveProperty(
			"readyForCallerWiring",
		);
		expectTypeOf<AgenticMemoryMaterializedFactLogBootstrapBundleOptions>().toHaveProperty(
			"materialization",
		);
		expectTypeOf<AgenticMemoryRecordStoreFrame>().toHaveProperty("records");
		expectTypeOf<AgenticMemoryRecordStoreFrameBundleOptions>().toHaveProperty("storeFrame");
		expectTypeOf<AgenticMemoryApplicationEvidenceStoreFrame>().toHaveProperty("priorEvidence");
		expectTypeOf<AgenticMemoryApplicationEvidenceStoreFrameBundleOptions>().toHaveProperty(
			"storeFrame",
		);
		expectTypeOf<AgenticMemoryApplicationDecisionStoreFrame>().toHaveProperty(
			"applicationDecisions",
		);
		expectTypeOf<AgenticMemoryRecordAdmissionPolicySourceProjection>().toHaveProperty(
			"admissionPolicy",
		);
		expectTypeOf<AgenticMemoryRecordAdmissionPolicySourceBundleOptions>().toHaveProperty(
			"policySources",
		);
		expectTypeOf<AgenticMemoryConsolidationApplicationBundleOptions>().toHaveProperty(
			"applicationPriorEvidence",
		);
		expectTypeOf<AgenticMemoryConsolidationApplicationBundle>().toHaveProperty("application");
		expectTypeOf<AgenticMemoryConsolidationApplicationBundle>().toHaveProperty(
			"applicationOperationStatuses",
		);
		expectTypeOf<AgenticMemoryRecordCandidateMaterial>().toHaveProperty("record");
		expectTypeOf<AgenticMemoryRecordCandidateMaterial>().toHaveProperty("attribution");
		expectTypeOf<AgenticMemoryContextAttribution>()
			.toHaveProperty("fragmentId")
			.toEqualTypeOf<string | undefined>();
		expectTypeOf<AgenticMemoryContextAttribution>()
			.toHaveProperty("rank")
			.toEqualTypeOf<number | undefined>();
		expectTypeOf<AgenticMemoryContextTruncation>()
			.toHaveProperty("omittedChars")
			.toEqualTypeOf<number | undefined>();
		expectTypeOf<AgenticMemoryProposalAdmissionPolicy>().toHaveProperty("policyId");
		expectTypeOf<AgenticMemoryProposalAdmissionDecision>().toHaveProperty("admissionId");
		expectTypeOf<AgenticWorkItemMemoryMappingPolicy>().toHaveProperty("policyId");
		expectTypeOf<AgenticWorkItemMemoryRecordCandidate>().toHaveProperty("candidateId");
		expectTypeOf<AgenticWorkItemMemoryBridgeResult>().toHaveProperty("proposals");
		expectTypeOf<AgenticWorkItemMemoryBridgeStatus>().toHaveProperty("cursor");
		expectTypeOf<AgenticWorkItemMemoryBridgeCursor>().toHaveProperty("candidateConflicts");
		expectTypeOf<AgenticWorkItemMemoryApplicationRecipeResult>().toHaveProperty("bridge");
		expectTypeOf<AgenticWorkItemMemoryApplicationRecipeBundleOptions>().toHaveProperty(
			"applicationPolicy",
		);
		expect(Object.hasOwn(agenticMemory, "workItemAuthoringProjector")).toBe(false);
		expect(typeof agenticWorkItemMemory.mapAgenticWorkItemMemoryBridge).toBe("function");
		expect(typeof agenticWorkItemMemory.agenticWorkItemMemoryBridgeBundle).toBe("function");
		expect(Object.hasOwn(agenticWorkItemMemory, "mapAgenticWorkItemMemoryApplicationRecipe")).toBe(
			false,
		);
		expect(
			Object.hasOwn(agenticWorkItemMemory, "agenticWorkItemMemoryApplicationRecipeBundle"),
		).toBe(false);
		expect(Object.hasOwn(agenticWorkItemMemory, "agenticMemoryBundle")).toBe(false);
		expect(Object.hasOwn(agenticWorkItemMemory, "agenticMemoryRecordMaterializerBundle")).toBe(
			false,
		);
		expect(Object.hasOwn(agenticWorkItemMemory, "materializeAgenticMemoryRecordChanges")).toBe(
			false,
		);
		expect(
			Object.hasOwn(agenticWorkItemMemory, "agenticMemoryRecordAdmissionPolicySourceBundle"),
		).toBe(false);
		expect(Object.hasOwn(agenticWorkItemMemory, "workItemAuthoringProjector")).toBe(false);
		expect(Object.hasOwn(agenticWorkItemMemory, "persistAgenticMemoryRecords")).toBe(false);
		expect(typeof agenticWorkItemMemoryApplication.mapAgenticWorkItemMemoryApplicationRecipe).toBe(
			"function",
		);
		expect(
			Object.hasOwn(
				agenticWorkItemMemoryApplication,
				"agenticMemoryRecordAdmissionPolicySourceBundle",
			),
		).toBe(false);
		expect(
			typeof agenticWorkItemMemoryApplication.agenticWorkItemMemoryApplicationRecipeBundle,
		).toBe("function");
		expect(Object.hasOwn(agenticWorkItemMemoryApplication, "mapAgenticWorkItemMemoryBridge")).toBe(
			false,
		);
		expect(Object.hasOwn(agenticWorkItemMemoryApplication, "agenticMemoryBundle")).toBe(false);
		expect(Object.hasOwn(agenticWorkItemMemoryApplication, "workItemAuthoringProjector")).toBe(
			false,
		);
		expect(typeof solutions.capabilityAdmissionProjector).toBe("function");
		expect(typeof solutions.capabilityAdmissionProposal).toBe("function");
		expect(Object.hasOwn(solutions, "workItemWorkQueueRecipe")).toBe(false);
		expect(typeof solutions.reactiveLayout).toBe("function");
		expect(typeof solutions.reactiveBlockLayout).toBe("function");
		expect(typeof solutions.reactiveFlowLayout).toBe("function");
		expect(typeof solutions.analyzeAndMeasure).toBe("function");
		expect(typeof solutions.computeLineBreaks).toBe("function");
		expect(typeof solutions.layoutNextLine).toBe("function");
		expect(typeof solutions.carveTextLineSlots).toBe("function");
		expect(typeof solutions.computeCharPositions).toBe("function");
		expect(typeof solutions.measureBlock).toBe("function");
		expect(typeof solutions.measureBlocks).toBe("function");
		expect(typeof solutions.computeBlockFlow).toBe("function");
		expect(typeof solutions.computeTotalHeight).toBe("function");
		expect(typeof solutions.computeFlowLines).toBe("function");
		expect(typeof solutions.circleIntervalForBand).toBe("function");
		expect(typeof solutions.rectIntervalForBand).toBe("function");
		expect(typeof solutions.textMeasurementProvider).toBe("function");
		expect(typeof solutions.injectedTextMeasurements).toBe("function");
		expect(typeof solutions.precomputedTextMeasurements).toBe("function");
		expect(typeof solutions.cellTextMeasurements).toBe("function");
		expect(typeof solutions.capabilityTextMeasurements).toBe("function");
		expect(typeof solutions.readinessTextMeasurements).toBe("function");
		expect(typeof solutions.readinessMeasurements).toBe("function");
		expect(typeof solutions.imageSizeMeasurements).toBe("function");
		expect(typeof solutions.svgBoundsMeasurements).toBe("function");
		expect(typeof solutions.blockAdaptersProvider).toBe("function");
		expect(typeof solutions.blockMeasurementProvider).toBe("function");
		expect(typeof solutions.InjectedMeasureAdapter).toBe("function");
		expect(typeof solutions.PrecomputedMeasureAdapter).toBe("function");
		expect(typeof solutions.CellMeasureAdapter).toBe("function");
		expect(typeof solutions.CapabilityMeasureAdapter).toBe("function");
		expect(typeof solutions.SvgBoundsAdapter).toBe("function");
		expect(typeof solutions.ImageSizeAdapter).toBe("function");
		expect(Object.hasOwn(solutions, "CanvasMeasureAdapter")).toBe(false);
		expect(typeof reactiveLayoutCore.reactiveLayout).toBe("function");
		expect(typeof reactiveLayoutCore.reactiveBlockLayout).toBe("function");
		expect(typeof reactiveLayoutCore.reactiveFlowLayout).toBe("function");
		expect(typeof reactiveLayoutCore.textMeasurementProvider).toBe("function");
		expect(typeof reactiveLayoutCore.capabilityTextMeasurements).toBe("function");
		expect(typeof reactiveLayoutCore.readinessTextMeasurements).toBe("function");
		expect(typeof reactiveLayoutCore.readinessMeasurements).toBe("function");
		expect(typeof reactiveLayoutCore.imageSizeMeasurements).toBe("function");
		expect(typeof reactiveLayoutCore.svgBoundsMeasurements).toBe("function");
		expect(typeof reactiveLayoutCore.blockAdaptersProvider).toBe("function");
		expect(typeof reactiveLayoutCore.blockMeasurementProvider).toBe("function");
		expect(typeof reactiveLayoutCore.CellMeasureAdapter).toBe("function");
		expect(typeof reactiveLayoutCore.CapabilityMeasureAdapter).toBe("function");
		expect(reactiveLayoutCore.READINESS_MEASUREMENT_KIND).toBe("readiness");
		expect(reactiveLayoutCore.IMAGE_SIZE_MEASUREMENT_KIND).toBe("image-size");
		expect(reactiveLayoutCore.SVG_BOUNDS_MEASUREMENT_KIND).toBe("svg-bounds");
		expect(typeof reactiveLayoutCore.mergeMeasurements).toBe("function");
		expect(Object.hasOwn(reactiveLayoutCore, "CanvasMeasureAdapter")).toBe(false);
		expect(typeof reactiveLayoutBrowser.CanvasMeasureAdapter).toBe("function");
		expect(typeof reactiveLayoutBrowser.canvasTextMeasurements).toBe("function");
		expect(typeof reactiveLayoutNodeCanvas.nodeCanvasTextMeasurements).toBe("function");
		expect(typeof reactiveLayoutNodeCanvas.nodeCanvasPackageTextMeasurements).toBe("function");
		expect(typeof reactiveLayoutSkia.skiaTextMeasurements).toBe("function");
		expect(typeof reactiveLayoutSkia.skiaReadyTextMeasurements).toBe("function");
		expect(typeof reactiveLayoutSkia.skiaParagraphTextMeasureCapability).toBe("function");
		expect(typeof reactiveLayoutReactNative.reactNativeTextMeasurements).toBe("function");
		expect(typeof reactiveLayoutReactNative.reactNativeLayoutMeasurements).toBe("function");
		expect(Object.hasOwn(reactiveLayoutCore, "nodeCanvasTextMeasurements")).toBe(false);
		expect(Object.hasOwn(reactiveLayoutCore, "nodeCanvasPackageTextMeasurements")).toBe(false);
		expect(Object.hasOwn(reactiveLayoutCore, "skiaTextMeasurements")).toBe(false);
		expect(Object.hasOwn(reactiveLayoutCore, "skiaReadyTextMeasurements")).toBe(false);
		expect(Object.hasOwn(reactiveLayoutCore, "reactNativeTextMeasurements")).toBe(false);
		expect(Object.hasOwn(reactiveLayoutCore, "reactNativeLayoutMeasurements")).toBe(false);
		expect(typeof solutions.agenticMemoryKgProjectionBundle).toBe("function");
		expect(typeof solutions.agenticMemoryRecordFrame).toBe("function");
		expect(typeof solutions.agenticMemoryRecordFrameCodec).toBe("function");
		expect(typeof solutions.agenticMemoryRecordCodec).toBe("function");
		expect(typeof solutions.agenticMemoryRetentionBundle).toBe("function");
		expect(typeof solutions.agenticMemoryConsolidationBundle).toBe("function");
		expect(typeof solutions.agenticMemoryConsolidationApplicationBundle).toBe("function");
		expect(typeof solutions.agenticMemoryContextPackingBundle).toBe("function");
		expect(typeof workItemSolution.workItemAuthoringProjector).toBe("function");
		expect(typeof workItemSolution.workItemDomainActionProposalIntakeProjector).toBe("function");
		expect(typeof workItemSolution.workItemDomainActionAdmissionProjector).toBe("function");
		expect(typeof workItemSolution.workItemWorkQueueRecipe).toBe("function");
		expect(Object.hasOwn(workItemSolution, "agenticMemoryBundle")).toBe(false);
		expect(Object.hasOwn(workItemSolution, "workItemEffectRunProjector")).toBe(false);
		expect(typeof graphLayer.workerDerived).toBe("function");
		expect(Object.hasOwn(patterns, "guardedExecution")).toBe(false);
		expect(Object.hasOwn(patterns, "inspect")).toBe(false);
		expect(Object.hasOwn(patterns, "resilientPipeline")).toBe(false);
		expect(Object.hasOwn(patterns, "openPersistentReactiveMap")).toBe(false);
		expect(Object.hasOwn(patterns, "persistReactiveCollection")).toBe(false);
		expect(Object.hasOwn(patterns, "persistAgenticMemoryRecords")).toBe(false);
		expect(Object.hasOwn(solutions, "persistReactiveCollection")).toBe(false);
		expect(Object.hasOwn(solutions, "persistAgenticMemoryRecords")).toBe(false);
		expect(Object.hasOwn(solutions, "openPersistentReactiveMap")).toBe(false);
		expect(Object.hasOwn(solutions, "Graph")).toBe(false);
	});

	it("keeps D488 NestJS WebSocket and microservice peers in focused subpaths", () => {
		const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
		const nestRoot = join(sourceRoot, "adapters", "nestjs");
		const websocketFile = join(nestRoot, "websockets.ts");
		const microserviceFile = join(nestRoot, "microservices.ts");
		const nestAdapterFiles = [join(sourceRoot, "adapters", "nestjs.ts"), ...listTsFiles(nestRoot)];

		for (const file of nestAdapterFiles) {
			const source = readFileSync(file, "utf8");
			if (file === websocketFile) {
				expect(source).toContain("@nestjs/websockets");
				expect(source).not.toContain("@nestjs/microservices");
				continue;
			}
			if (file === microserviceFile) {
				expect(source).toContain("@nestjs/microservices");
				expect(source).not.toContain("@nestjs/websockets");
				continue;
			}
			expect(source, file).not.toContain("@nestjs/websockets");
			expect(source, file).not.toContain("@nestjs/microservices");
		}
		expect(typeof nestjsAdapters.GraphWs).toBe("function");
		expect(typeof nestjsAdapters.GraphMessage).toBe("function");
		expect(typeof nestjsWebsocketsAdapters.createGraphWsBridge).toBe("function");
		expect(typeof nestjsWebsocketsAdapters.provideGraphWsBridge).toBe("function");
		expect(typeof nestjsWebsocketsAdapters.provideGraphWsProviders).toBe("function");
		expect(typeof nestjsWebsocketsAdapters.GraphWsAck).toBe("function");
		expect(typeof nestjsWebsocketsAdapters.GraphWsReply).toBe("function");
		expect(typeof nestjsMicroservicesAdapters.createGraphMessageBridge).toBe("function");
		expect(typeof nestjsMicroservicesAdapters.provideGraphMessageBridge).toBe("function");
		expect(typeof nestjsMicroservicesAdapters.provideGraphMessageProviders).toBe("function");
		expect(typeof nestjsMicroservicesAdapters.GraphMessageReply).toBe("function");
		expect(Object.hasOwn(nestjsAdapters, "provideGraphWsProviders")).toBe(false);
		expect(Object.hasOwn(nestjsAdapters, "provideGraphMessageProviders")).toBe(false);
		expect(Object.hasOwn(nestjsNativeAdapters, "provideGraphWsProviders")).toBe(false);
		expect(Object.hasOwn(nestjsNativeAdapters, "provideGraphMessageProviders")).toBe(false);
	});

	it("documents D486 cron misfire and catch-up default skip semantics", () => {
		const docsPath = join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"..",
			"..",
			"..",
			"website",
			"src",
			"content",
			"docs",
			"recipes",
			"nestjs-integration.md",
		);
		const docs = readFileSync(docsPath, "utf8");

		expect(docs).toContain("missed ticks");
		expect(docs).toContain("skipped by default");
		expect(docs).toContain("no missed-status or catch-up DATA");
	});

	it("documents D495 focused NestJS provider bundles and diagnostics recipe boundaries", () => {
		const docsRoot = join(
			dirname(fileURLToPath(import.meta.url)),
			"..",
			"..",
			"..",
			"..",
			"website",
			"src",
			"content",
			"docs",
		);
		const recipe = readFileSync(join(docsRoot, "recipes", "nestjs-integration.md"), "utf8");
		const matrix = readFileSync(join(docsRoot, "integrations", "matrix.md"), "utf8");
		const compat = readFileSync(join(docsRoot, "integrations", "compat.md"), "utf8");

		for (const docs of [recipe, matrix, compat]) {
			expect(docs).toContain("D495");
			expect(docs).toContain("provider bundle");
			expect(docs).toContain("diagnostics");
		}
		expect(recipe).toContain("provideGraphWsProviders");
		expect(recipe).toContain("provideGraphMessageProviders");
		expect(recipe).toContain("bridge: { diagnosticBoundary: nestDiagnostics }");
		expect(recipe).toContain("There is no `onDiagnostic` callback or logging API");
		expect(matrix).toContain("do not scan the container");
		expect(matrix).toContain("do not create graphs");
		expect(matrix).toContain("do not own retry, session, reconnect, or transport lifecycle policy");
		expect(compat).toContain("hidden graph creation");
		expect(compat).toContain("transport retry/session/reconnect ownership");
	});

	it("exports node-only sources as a package subpath without polluting universal sources", () => {
		expect(exportsJson.exports?.["./sources/node"]).toBeDefined();
		expect(typeof sourcesNode.fromFSWatch).toBe("function");
		expect(typeof sourcesNode.fromGitPoll).toBe("function");
		expect(typeof sourcesNode.fromSpawn).toBe("function");
		expect(typeof sourcesNode.nodeProcessDriver).toBe("function");
		expect(typeof sourcesNode.runProcess).toBe("function");
		expect(Object.hasOwn(sources, "fromFSWatch")).toBe(false);
		expect(Object.hasOwn(sources, "fromGitPoll")).toBe(false);
		expect(Object.hasOwn(sources, "fromSpawn")).toBe(false);
		expect(Object.hasOwn(sources, "nodeProcessDriver")).toBe(false);
		expect(Object.hasOwn(sources, "runProcess")).toBe(false);
	});

	it("exports browser-safe sources as a package subpath without node-only adapters", () => {
		expect(exportsJson.exports?.["./sources/browser"]).toBeDefined();
		expect(typeof sourcesBrowser.fromAny).toBe("function");
		expect(typeof sourcesBrowser.fromEvent).toBe("function");
		expect(typeof sourcesBrowser.fromRaf).toBe("function");
		expect(typeof sourcesBrowser.fromIDBRequest).toBe("function");
		expect(typeof sourcesBrowser.fromIDBTransaction).toBe("function");
		expect(Object.hasOwn(sourcesBrowser, "fromFSWatch")).toBe(false);
		expect(Object.hasOwn(sourcesBrowser, "fromGitPoll")).toBe(false);
		expect(Object.hasOwn(sourcesBrowser, "fromSpawn")).toBe(false);
		expect(Object.hasOwn(sourcesBrowser, "nodeProcessDriver")).toBe(false);
		expect(Object.hasOwn(sourcesBrowser, "runProcess")).toBe(false);
	});

	it("does not resurrect retired window/storage surfaces through the subpaths", () => {
		expect(Object.hasOwn(operators, "window")).toBe(false);
		expect(Object.hasOwn(operators, "windowCount")).toBe(false);
		expect(Object.hasOwn(operators, "windowTime")).toBe(false);
		expect(Object.hasOwn(storage, "attachSnapshotStorage")).toBe(false);
		expect(Object.hasOwn(storage, "restoreSnapshot")).toBe(false);
		expect(Object.hasOwn(storage, "strictCanonicalJsonBytes")).toBe(false);
		expect(Object.hasOwn(storage, "assertNodeVersionDataCompatible")).toBe(false);
		expect(Object.hasOwn(storage, "snapshotNodeVersionData")).toBe(false);
		expect(Object.hasOwn(graphLayer, "attachSnapshotStorage")).toBe(false);
		expect(Object.hasOwn(graphLayer, "restoreSnapshot")).toBe(false);
		expect(Object.hasOwn(core, "strictCanonicalJsonBytes")).toBe(false);
		expect(Object.hasOwn(core, "assertNodeVersionDataCompatible")).toBe(false);
		expect(Object.hasOwn(core, "snapshotNodeVersionData")).toBe(false);
	});

	it("exports storage/node as a package subpath", () => {
		expect(exportsJson.exports?.["./storage/node"]).toBeDefined();
		expect(typeof storageNode.fileBackend).toBe("function");
		expect(typeof storageNode.fileKv).toBe("function");
		expect(typeof storageNode.fileAppendLog).toBe("function");
		expect(typeof storageNode.sqliteBackend).toBe("function");
		expect(typeof storageNode.sqliteKv).toBe("function");
		expect(typeof storageNode.sqliteAppendLog).toBe("function");
		expect(Object.hasOwn(storageNode, "attachSnapshotStorage")).toBe(false);
		expect(Object.hasOwn(storageNode, "restoreSnapshot")).toBe(false);
		expect(Object.hasOwn(storageNode, "restoreFromStorage")).toBe(false);
		expect(Object.hasOwn(storageNode, "hydrateGraph")).toBe(false);
		expect(Object.hasOwn(storageNode, "replayWal")).toBe(false);
	});

	it("exports D161 reactive collection persistence from the right layers", () => {
		expect(typeof storage.loadReactiveListState).toBe("function");
		expect(typeof storage.loadReactiveLogState).toBe("function");
		expect(typeof storage.loadReactiveMapState).toBe("function");
		expect(typeof storage.loadReactiveIndexState).toBe("function");
		expect(typeof storage.reactiveCollectionSnapshotFrame).toBe("function");
		expect(typeof dataStructures.restoreReactiveList).toBe("function");
		expect(typeof dataStructures.restoreReactiveLog).toBe("function");
		expect(typeof dataStructures.restoreReactiveMap).toBe("function");
		expect(typeof dataStructures.restoreReactiveIndex).toBe("function");
		expect(typeof adapters.persistReactiveCollection).toBe("function");
		expect(typeof adapters.openPersistentReactiveList).toBe("function");
		expect(typeof adapters.openPersistentReactiveLog).toBe("function");
		expect(typeof adapters.openPersistentReactiveMap).toBe("function");
		expect(typeof adapters.openPersistentReactiveIndex).toBe("function");
		expect(Object.hasOwn(storage, "persistReactiveCollection")).toBe(false);
		expect(Object.hasOwn(storage, "openPersistentReactiveList")).toBe(false);
		expect(Object.hasOwn(storage, "restoreGraph")).toBe(false);
	});

	it("exports storage/browser as a package subpath", () => {
		expect(exportsJson.exports?.["./storage/browser"]).toBeDefined();
		expect(typeof storageBrowser.indexedDbBackend).toBe("function");
		expect(typeof storageBrowser.indexedDbKv).toBe("function");
		expect(typeof storageBrowser.indexedDbAppendLog).toBe("function");
		expect(Object.hasOwn(storageBrowser, "attachSnapshotStorage")).toBe(false);
		expect(Object.hasOwn(storageBrowser, "restoreSnapshot")).toBe(false);
		expect(Object.hasOwn(storageBrowser, "restoreFromStorage")).toBe(false);
		expect(Object.hasOwn(storageBrowser, "hydrateGraph")).toBe(false);
		expect(Object.hasOwn(storageBrowser, "replayWal")).toBe(false);
	});

	it("exposes the D80 policy vocabulary from public type barrels", () => {
		expectTypeOf<ReactiveListOpt<number>>().toEqualTypeOf<ReactiveOpt<number>>();
		expectTypeOf<ReactiveMapOpt<number>>().toEqualTypeOf<ReactiveOpt<number>>();
		expectTypeOf<ReactiveIndexOpt<number>>().toEqualTypeOf<ReactiveOpt<number>>();
		expectTypeOf<ReactiveIndexCapacityPolicy>().toMatchTypeOf<
			OrderedCapacityPolicy<ReactiveIndexCapacityOrder>
		>();
		expectTypeOf<ReactiveMapRetentionPolicy<string, number>>().toMatchTypeOf<
			RetentionPolicy<ReactiveMapRetentionEntry<string, number>>
		>();
		expectTypeOf<CapacityPolicy<"lru">>()
			.toHaveProperty("maxSize")
			.toEqualTypeOf<ReactiveOpt<number>>();
		expectTypeOf<ViewCachePolicy>()
			.toHaveProperty("maxEntries")
			.toEqualTypeOf<number | undefined>();
		expectTypeOf<ReactiveLogOptions>()
			.toHaveProperty("viewCache")
			.toEqualTypeOf<ViewCachePolicy | undefined>();
		expectTypeOf<ReactiveMapOptions<string, number>>()
			.toHaveProperty("viewCache")
			.toEqualTypeOf<ViewCachePolicy | undefined>();
		expectTypeOf<ReactiveIndexOptions>()
			.toHaveProperty("viewCache")
			.toEqualTypeOf<ViewCachePolicy | undefined>();
		expectTypeOf<DataStructuresReactiveOpt<string>>().toEqualTypeOf<ReactiveOpt<string>>();
		expectTypeOf<DataStructuresReactiveView<string, string>>().toEqualTypeOf<
			ReactiveView<string, string>
		>();
		expectTypeOf<DataStructuresViewCachePolicy>().toEqualTypeOf<ViewCachePolicy>();
		expectTypeOf<TopologyGroup>().toMatchTypeOf<{
			readonly released: boolean;
			release(opts?: TopologyGroupReleaseOptions): void;
		}>();
		expectTypeOf<TopologyGroupOptions>().toEqualTypeOf<{ name?: string }>();
		expectTypeOf<GraphCheckpoint>()
			.toHaveProperty("version")
			.toEqualTypeOf<"graphrefly.checkpoint.v1">();
		expectTypeOf<ImageSizeLookup>().toMatchTypeOf<{
			get(src: string): unknown;
		}>();
		expectTypeOf<AgenticMemoryBundleOptions>()
			.toHaveProperty("name")
			.toEqualTypeOf<string | undefined>();
		expectTypeOf<AgenticMemoryBundleOptions<string>>()
			.toHaveProperty("records")
			.toMatchTypeOf<unknown>();
		expectTypeOf<AgenticMemoryRecord<string>>()
			.toHaveProperty("fragment")
			.toMatchTypeOf<MemoryFragment<string>>();
		expectTypeOf<KnowledgeAssertion>().toHaveProperty("predicate").toEqualTypeOf<string>();
		expectTypeOf<KnowledgeGraphReducerBundleOptions>()
			.toHaveProperty("assertions")
			.toMatchTypeOf<unknown>();
		expectTypeOf<AgenticMemoryKgProjectionBundleOptions>()
			.toHaveProperty("drafts")
			.toMatchTypeOf<unknown>();
		expectTypeOf<AgenticMemoryRecordFrame>().toHaveProperty("version").toEqualTypeOf<1>();
		expectTypeOf<AgenticMemoryRetentionBundleOptions>()
			.toHaveProperty("commands")
			.toMatchTypeOf<unknown>();
		expectTypeOf<AgenticMemoryConsolidationBundleOptions>()
			.toHaveProperty("outcomes")
			.toMatchTypeOf<unknown>();
		expectTypeOf<AgenticMemoryConsolidationBundle>()
			.toHaveProperty("recordProposals")
			.toMatchTypeOf<unknown>();
		expectTypeOf<AgenticMemoryRecordsPersistenceHandle>()
			.toHaveProperty("cursor")
			.toMatchTypeOf<unknown>();
		expectTypeOf<AgenticMemoryPassiveStoreFrameAdapter>()
			.toHaveProperty("write")
			.toEqualTypeOf<(frame: Uint8Array) => Promise<AgenticMemoryPassiveStoreFrameWriteResult>>();
		expectTypeOf<AgenticMemoryPassiveStoreFrameReadResult>()
			.toHaveProperty("frames")
			.toEqualTypeOf<readonly Uint8Array[]>();
		expectTypeOf<AgenticMemoryPassiveStoreFrameStatus>()
			.toHaveProperty("state")
			.toEqualTypeOf<"ready" | "empty" | "error">();
		expectTypeOf<AgenticMemoryPassiveStoreFrameCursor>()
			.toHaveProperty("kind")
			.toEqualTypeOf<"agentic-memory-passive-store-frame.cursor">();
		expectTypeOf<AgenticMemoryContextPackingBundleOptions>()
			.toHaveProperty("policy")
			.toMatchTypeOf<unknown>();
		expectTypeOf<AgenticMemoryScope>()
			.toHaveProperty("tenantId")
			.toEqualTypeOf<string | undefined>();
		expectTypeOf<AgenticMemoryStatus>()
			.toHaveProperty("state")
			.toEqualTypeOf<"ready" | "empty" | "partial" | "error">();
	});
});
