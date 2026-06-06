import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as composition from "../composition/index.js";
import * as core from "../core/index.js";
import type {
	ReactiveOpt as DataStructuresReactiveOpt,
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
	ReactiveListOpt,
	ReactiveMapOpt,
	ReactiveMapRetentionEntry,
	ReactiveMapRetentionPolicy,
	ReactiveOpt,
	RetentionPolicy,
	ViewCachePolicy,
} from "../index.js";
import * as operators from "../operators/index.js";
import * as render from "../render/index.js";
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
			"./composition",
			"./core",
			"./data-structures",
			"./graph",
			"./operators",
			"./render",
			"./sources",
			"./sources/node",
			"./storage",
			"./storage/browser",
			"./storage/node",
			"./testing",
		]);
		expect(exportsJson.exports?.["./graph/render"]).toBeUndefined();
		expect(exportsJson.exports?.["./graph/sources"]).toBeUndefined();
		expect(exportsJson.exports?.["./graph/operators"]).toBeUndefined();
		expect(exportsJson.exports?.["./storage/wal"]).toBeUndefined();
	});

	it("exposes the clean-slate layer surfaces from source barrels", () => {
		expect(typeof core.node).toBe("function");
		expect(typeof graphLayer.Graph).toBe("function");
		expect(typeof graphLayer.coalesceObserve).toBe("function");
		expect(typeof graphLayer.explainPath).toBe("function");
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
		expect(typeof sources.fromEvent).toBe("function");
		expect(typeof sources.fromPushNotification).toBe("function");
		expect(typeof sources.firstValueFrom).toBe("function");
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
		expect(typeof storage.attachObserveSink).toBe("function");
		expect(typeof storage.memoryKv).toBe("function");
		expect(typeof storage.memoryAppendLog).toBe("function");
		expect(typeof storage.multiWriterAppendLogStorage).toBe("function");
		expect(typeof storage.memoryMultiWriterAppendLog).toBe("function");
		expect(typeof storage.attachObserveEventLog).toBe("function");
		expect(typeof storage.tieredReadThrough).toBe("function");
		expect(typeof storage.readThroughKv).toBe("function");
		expect(typeof storage.readAppendLogPage).toBe("function");
		expect(typeof storage.readObserveEventLogPage).toBe("function");
		expect(typeof storage.walFrame).toBe("function");
		expect(typeof storage.walFrameKey).toBe("function");
		expect(typeof testing.assertDirtyPrecedesTerminalData).toBe("function");
	});

	it("exports node-only sources as a package subpath without polluting universal sources", () => {
		expect(exportsJson.exports?.["./sources/node"]).toBeDefined();
		expect(typeof sourcesNode.fromFSWatch).toBe("function");
		expect(Object.hasOwn(sources, "fromFSWatch")).toBe(false);
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
		expectTypeOf<DataStructuresReactiveOpt<string>>().toEqualTypeOf<ReactiveOpt<string>>();
		expectTypeOf<DataStructuresViewCachePolicy>().toEqualTypeOf<ViewCachePolicy>();
		expectTypeOf<GraphCheckpoint>()
			.toHaveProperty("version")
			.toEqualTypeOf<"graphrefly.checkpoint.v1">();
	});
});
