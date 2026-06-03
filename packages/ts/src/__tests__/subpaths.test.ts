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
import * as storage from "../storage/index.js";
import * as storageNode from "../storage/node.js";
import * as testing from "../testing/index.js";

const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
const exportsJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
	exports?: Record<string, unknown>;
};

describe("package subpath barrels (D40/D41 intent parity)", () => {
	it("exposes the clean-slate layer surfaces from source barrels", () => {
		expect(typeof core.node).toBe("function");
		expect(typeof graphLayer.Graph).toBe("function");
		expect(typeof graphLayer.GRAPH_CHECKPOINT_VERSION).toBe("string");
		expect(typeof graphLayer.restoreGraph).toBe("function");
		expect(typeof operators.map).toBe("function");
		expect(typeof operators.define).toBe("function");
		expect(typeof operators.restoreRegistry).toBe("function");
		expect(typeof sources.fromAny).toBe("function");
		expect(typeof composition.topologyDiff).toBe("function");
		expect(typeof dataStructures.reactiveMap).toBe("function");
		expect(typeof render.describeToJson).toBe("function");
		expect(typeof storage.attachObserveSink).toBe("function");
		expect(typeof storage.memoryKv).toBe("function");
		expect(typeof storage.memoryAppendLog).toBe("function");
		expect(typeof storage.multiWriterAppendLogStorage).toBe("function");
		expect(typeof storage.memoryMultiWriterAppendLog).toBe("function");
		expect(typeof storage.attachObserveEventLog).toBe("function");
		expect(typeof testing.assertDirtyPrecedesTerminalData).toBe("function");
	});

	it("does not resurrect retired window/storage surfaces through the subpaths", () => {
		expect(Object.hasOwn(operators, "window")).toBe(false);
		expect(Object.hasOwn(operators, "windowCount")).toBe(false);
		expect(Object.hasOwn(operators, "windowTime")).toBe(false);
		expect(Object.hasOwn(storage, "attachSnapshotStorage")).toBe(false);
		expect(Object.hasOwn(storage, "restoreSnapshot")).toBe(false);
		expect(Object.hasOwn(graphLayer, "attachSnapshotStorage")).toBe(false);
		expect(Object.hasOwn(graphLayer, "restoreSnapshot")).toBe(false);
	});

	it("exports storage/node as a package subpath", () => {
		expect(exportsJson.exports?.["./storage/node"]).toBeDefined();
		expect(typeof storageNode.fileBackend).toBe("function");
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
			.toEqualTypeOf<"graphrefly.ts.checkpoint.v1">();
	});
});
