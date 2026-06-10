import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as adapters from "../adapters/index.js";
import * as observeStorage from "../adapters/observe-storage.js";
import * as composition from "../composition/index.js";
import * as core from "../core/index.js";
import * as cqrs from "../cqrs/index.js";
import type {
	ReactiveOpt as DataStructuresReactiveOpt,
	ReactiveView as DataStructuresReactiveView,
	ViewCachePolicy as DataStructuresViewCachePolicy,
} from "../data-structures/index.js";
import * as dataStructures from "../data-structures/index.js";
import * as graphLayer from "../graph/index.js";
import type {
	CapacityPolicy,
	GraphCheckpoint,
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
import * as messaging from "../messaging/index.js";
import * as operators from "../operators/index.js";
import * as orchestration from "../orchestration/index.js";
import * as patterns from "../patterns/index.js";
import * as render from "../render/index.js";
import * as solutions from "../solutions/index.js";
import * as sourcesBrowser from "../sources/browser.js";
import * as sources from "../sources/index.js";
import * as sourcesNode from "../sources/node.js";
import * as storageBrowser from "../storage/browser.js";
import * as storage from "../storage/index.js";
import * as storageNode from "../storage/node.js";
import * as testing from "../testing/index.js";

const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
const exportsJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
	exports?: Record<string, unknown>;
};

describe("package subpath barrels (D40/D41 intent parity)", () => {
	it("publishes only the intended package subpaths", () => {
		expect(Object.keys(exportsJson.exports ?? {}).sort()).toEqual([
			".",
			"./adapters",
			"./adapters/observe-storage",
			"./composition",
			"./core",
			"./cqrs",
			"./data-structures",
			"./graph",
			"./messaging",
			"./operators",
			"./orchestration",
			"./patterns",
			"./render",
			"./solutions",
			"./sources",
			"./sources/browser",
			"./sources/node",
			"./storage",
			"./storage/browser",
			"./storage/node",
			"./testing",
		]);
		expect(exportsJson.exports?.["./base"]).toBeUndefined();
		expect(exportsJson.exports?.["./compat"]).toBeUndefined();
		expect(exportsJson.exports?.["./presets"]).toBeUndefined();
		expect(exportsJson.exports?.["./utils"]).toBeUndefined();
		expect(exportsJson.exports?.["./graph/render"]).toBeUndefined();
		expect(exportsJson.exports?.["./graph/sources"]).toBeUndefined();
		expect(exportsJson.exports?.["./graph/operators"]).toBeUndefined();
		expect(exportsJson.exports?.["./storage/wal"]).toBeUndefined();
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
		expect(typeof composition.topologyDiff).toBe("function");
		expect(typeof dataStructures.reactiveMap).toBe("function");
		expect(typeof render.describeToJson).toBe("function");
		expect(typeof render.describeToMermaidUrl).toBe("function");
		expect(typeof adapters.getGraphToken).toBe("function");
		expect(typeof adapters.jotaiAtom).toBe("function");
		expect(typeof adapters.nanoAtom).toBe("function");
		expect(typeof adapters.recordReadableStore).toBe("function");
		expect(typeof adapters.signalFromNode).toBe("function");
		expect(typeof adapters.externalStore).toBe("function");
		expect(typeof adapters.readableStore).toBe("function");
		expect(typeof adapters.subscribeNodeValues).toBe("function");
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
		expect(typeof observeStorage.attachObserveEventLog).toBe("function");
		expect(typeof observeStorage.attachObserveSink).toBe("function");
		expect(typeof patterns.profileSummary).toBe("function");
		expect(typeof patterns.cosineSimilarity).toBe("function");
		expect(typeof patterns.admissionScored).toBe("function");
		expect(typeof patterns.admissionFilter3D).toBe("function");
		expect(typeof patterns.shardByTenant).toBe("function");
		expect(typeof patterns.validateMemoryFragment).toBe("function");
		expect(typeof patterns.filterMemoryFragments).toBe("function");
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
		expect(typeof cqrs.cqrs).toBe("function");
		expect(typeof cqrs.cqrsCommandHandler).toBe("function");
		expect(typeof cqrs.cqrsProjection).toBe("function");
		expect(Object.hasOwn(cqrs, "dedupeReducer")).toBe(false);
		expect(typeof messaging.messageBus).toBe("function");
		expect(typeof messaging.fromTopic).toBe("function");
		expect(typeof messaging.toTopic).toBe("function");
		expect(typeof messaging.dynamicHub).toBe("function");
		expect(typeof messaging.fromHubTopic).toBe("function");
		expect(typeof messaging.toHubTopic).toBe("function");
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
		expect(typeof orchestration.retryPolicy).toBe("function");
		expect(typeof orchestration.retryStatusBundle).toBe("function");
		expect(typeof orchestration.breakerBundle).toBe("function");
		expect(typeof orchestration.processBundle).toBe("function");
		expect(typeof orchestration.processEffectRunner).toBe("function");
		expect(typeof orchestration.rateLimitBundle).toBe("function");
		expect(typeof orchestration.timeoutBundle).toBe("function");
		expect(typeof graphLayer.workerDerived).toBe("function");
		expect(Object.hasOwn(patterns, "guardedExecution")).toBe(false);
		expect(Object.hasOwn(patterns, "inspect")).toBe(false);
		expect(Object.hasOwn(patterns, "resilientPipeline")).toBe(false);
		expect(Object.keys(solutions)).toEqual([]);
	});

	it("exports node-only sources as a package subpath without polluting universal sources", () => {
		expect(exportsJson.exports?.["./sources/node"]).toBeDefined();
		expect(typeof sourcesNode.fromFSWatch).toBe("function");
		expect(typeof sourcesNode.fromGitHook).toBe("function");
		expect(typeof sourcesNode.fromSpawn).toBe("function");
		expect(typeof sourcesNode.nodeProcessDriver).toBe("function");
		expect(typeof sourcesNode.runProcess).toBe("function");
		expect(Object.hasOwn(sources, "fromFSWatch")).toBe(false);
		expect(Object.hasOwn(sources, "fromGitHook")).toBe(false);
		expect(Object.hasOwn(sources, "fromSpawn")).toBe(false);
		expect(Object.hasOwn(sources, "nodeProcessDriver")).toBe(false);
		expect(Object.hasOwn(sources, "runProcess")).toBe(false);
	});

	it("exports browser-safe sources as a package subpath without node-only adapters", () => {
		expect(exportsJson.exports?.["./sources/browser"]).toBeDefined();
		expect(typeof sourcesBrowser.fromAny).toBe("function");
		expect(typeof sourcesBrowser.fromEvent).toBe("function");
		expect(typeof sourcesBrowser.fromIDBRequest).toBe("function");
		expect(typeof sourcesBrowser.fromIDBTransaction).toBe("function");
		expect(Object.hasOwn(sourcesBrowser, "fromFSWatch")).toBe(false);
		expect(Object.hasOwn(sourcesBrowser, "fromGitHook")).toBe(false);
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
	});
});
