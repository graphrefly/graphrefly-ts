import { factoryTag } from "@graphrefly/pure-ts/core/meta.js";
import { node } from "@graphrefly/pure-ts/core/node.js";
import { memoryKv } from "@graphrefly/pure-ts/extra";
import { Graph } from "@graphrefly/pure-ts/graph/graph.js";
import { describe, expect, it } from "vitest";
import type { GraphSpec, GraphSpecCatalog } from "../../../utils/graphspec/index.js";
import {
	createGraph,
	deleteSnapshot,
	diffSnapshots,
	listSnapshots,
	restoreSnapshot,
	runReduction,
	SurfaceError,
	saveSnapshot,
} from "../../../utils/surface/index.js";

/** Shared catalog for surface tests. Mirrors the style in graphspec tests. */
const catalog: GraphSpecCatalog = {
	fns: {
		double: (deps) =>
			node(
				deps,
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit((data[0] as number) * 2);
				},
				{ describeKind: "derived" },
			),
		addOne: (deps) =>
			node(
				deps,
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit((data[0] as number) + 1);
				},
				{ describeKind: "derived" },
			),
		identity: (deps) =>
			node(
				deps,
				(batchData, actions, ctx) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
					);
					actions.emit(data[0]);
				},
				{ describeKind: "derived" },
			),
	},
};

const basicSpec: GraphSpec = {
	name: "basic-reduce",
	nodes: {
		input: { type: "state", deps: [], value: 0 },
		doubled: { type: "derived", deps: ["input"], meta: { ...factoryTag("double") } },
		output: { type: "derived", deps: ["doubled"], meta: { ...factoryTag("addOne") } },
	},
};

describe("surface.createGraph", () => {
	it("builds a graph from a valid spec", () => {
		const g = createGraph(basicSpec, { catalog });
		expect(g).toBeInstanceOf(Graph);
		expect(g.name).toBe("basic-reduce");
		g.destroy();
	});

	it("throws SurfaceError(invalid-spec) on structural errors", () => {
		const bad: unknown = { name: "bad", nodes: { x: { type: "nonsense" } } };
		try {
			createGraph(bad as GraphSpec, { catalog });
			expect.fail("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(SurfaceError);
			const se = err as SurfaceError;
			expect(se.code).toBe("invalid-spec");
			expect(se.details?.errors).toBeDefined();
		}
	});

	it("throws SurfaceError(catalog-error) on unknown fn name", () => {
		const spec: GraphSpec = {
			name: "missing-fn",
			nodes: {
				input: { type: "state", deps: [], value: 0 },
				output: { type: "derived", deps: ["input"], meta: { ...factoryTag("doesNotExist") } },
			},
		};
		try {
			createGraph(spec, { catalog });
			expect.fail("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(SurfaceError);
			expect((err as SurfaceError).code).toBe("catalog-error");
		}
	});

	it("serializes SurfaceError as JSON-safe payload", () => {
		try {
			createGraph({ name: "", nodes: {} } as GraphSpec);
		} catch (err) {
			const payload = (err as SurfaceError).toJSON();
			expect(payload.code).toBe("invalid-spec");
			expect(typeof payload.message).toBe("string");
			expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
		}
	});
});

describe("surface.runReduction", () => {
	it("runs input → pipeline → output in one shot", async () => {
		const result = await runReduction(basicSpec, 5, { catalog });
		// doubled(5)=10, addOne(10)=11
		expect(result).toBe(11);
	});

	it("respects custom inputPath/outputPath", async () => {
		const spec: GraphSpec = {
			name: "custom-paths",
			nodes: {
				src: { type: "state", deps: [], value: 0 },
				result: { type: "derived", deps: ["src"], meta: { ...factoryTag("double") } },
			},
		};
		const result = await runReduction(spec, 7, { catalog, inputPath: "src", outputPath: "result" });
		expect(result).toBe(14);
	});

	it("throws node-not-found when inputPath is missing", async () => {
		await expect(runReduction(basicSpec, 1, { catalog, inputPath: "nope" })).rejects.toMatchObject({
			code: "node-not-found",
		});
	});

	it("throws node-not-found when outputPath is missing", async () => {
		await expect(runReduction(basicSpec, 1, { catalog, outputPath: "nope" })).rejects.toMatchObject(
			{
				code: "node-not-found",
			},
		);
	});

	it("resolves via outputNode.cache on RESOLVED (input changed, output equal)", async () => {
		// Spec §1.3.3 equals-substitution: when the input changes but the
		// output recomputes to a value equal to its cached value, the
		// graph emits [[RESOLVED]] instead of [[DATA, v]]. runReduction
		// must return the cache rather than timeout.
		const alwaysOne: GraphSpecCatalog = {
			fns: {
				double: (deps) =>
					node(
						deps,
						(batchData, actions, ctx) => {
							const data = batchData.map((batch, i) =>
								batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
							);
							actions.emit((data[0] as number) * 2);
						},
						{ describeKind: "derived" },
					),
				constOne: (deps) =>
					node(
						deps,
						(batchData, actions, ctx) => {
							const _data = batchData.map((batch, i) =>
								batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
							);
							actions.emit(1);
						},
						{ describeKind: "derived" },
					),
			},
		};
		const spec: GraphSpec = {
			name: "resolved-test",
			nodes: {
				input: { type: "state", deps: [], value: 0 },
				doubled: { type: "derived", deps: ["input"], meta: { ...factoryTag("double") } },
				output: { type: "derived", deps: ["doubled"], meta: { ...factoryTag("constOne") } },
			},
		};
		const result = await runReduction(spec, 7, { catalog: alwaysOne, timeoutMs: 200 });
		expect(result).toBe(1);
	});

	it("throws reduce-timeout when output never settles post-push", async () => {
		// Build a graph whose output node never re-emits because there's no
		// dep chain from input to output.
		const spec: GraphSpec = {
			name: "no-chain",
			nodes: {
				input: { type: "state", deps: [], value: 0 },
				unrelated: { type: "state", deps: [], value: "stuck" },
				output: { type: "derived", deps: ["unrelated"], meta: { ...factoryTag("identity") } },
			},
		};
		await expect(runReduction(spec, 1, { catalog, timeoutMs: 50 })).rejects.toMatchObject({
			code: "reduce-timeout",
		});
	});
});

describe("surface.snapshot", () => {
	it("saves and restores a state-only graph through a StorageTier", async () => {
		const stateSpec: GraphSpec = {
			name: "state-only",
			nodes: {
				input: { type: "state", deps: [], value: 0 },
				note: { type: "state", deps: [], value: "hello" },
			},
		};
		const g = createGraph(stateSpec, { catalog });
		g.set("input", 12);
		g.set("note", "world");
		const tier = memoryKv();
		const result = await saveSnapshot(g, "snap-1", tier);
		expect(result.snapshotId).toBe("snap-1");
		expect(result.timestamp_ns).toBeGreaterThan(0);
		g.destroy();

		const restored = await restoreSnapshot("snap-1", tier);
		expect(restored.name).toBe("state-only");
		expect(restored.node("input").cache).toBe(12);
		expect(restored.node("note").cache).toBe("world");
		restored.destroy();
	});

	it("passes factories through to Graph.fromSnapshot for derived restore", async () => {
		const g = createGraph(basicSpec, { catalog });
		g.set("input", 3);
		const tier = memoryKv();
		await saveSnapshot(g, "with-derived", tier);
		g.destroy();

		const seen: string[] = [];
		const restored = await restoreSnapshot("with-derived", tier, {
			factories: {
				"**": (_name, ctx) => {
					seen.push(ctx.path);
					const nodePath = ctx.path;
					return node(
						ctx.resolvedDeps,
						(batchData, actions, fnCtx) => {
							const data = batchData.map((batch, i) =>
								batch != null && batch.length > 0 ? batch.at(-1) : fnCtx.prevData[i],
							);
							const v = data[0];
							const result =
								nodePath === "doubled"
									? (v as number) * 2
									: nodePath === "output"
										? (v as number) + 1
										: v;
							actions.emit(result);
						},
						{ describeKind: "derived" },
					);
				},
			},
		});
		// Factories were invoked for non-state paths only; state auto-hydrates.
		expect(seen.sort()).toEqual(["doubled", "output"]);
		expect(restored.node("input").cache).toBe(3);
		// Derived nodes activate lazily — subscribing primes their cache.
		restored.resolve("output").subscribe(() => {});
		expect(restored.node("doubled").cache).toBe(6);
		expect(restored.node("output").cache).toBe(7);
		restored.destroy();
	});

	it("throws snapshot-not-found on missing id", async () => {
		const tier = memoryKv();
		await expect(restoreSnapshot("ghost", tier)).rejects.toMatchObject({
			code: "snapshot-not-found",
		});
	});

	it("lists saved snapshot ids", async () => {
		const g = createGraph(basicSpec, { catalog });
		const tier = memoryKv();
		await saveSnapshot(g, "a", tier);
		await saveSnapshot(g, "c", tier);
		await saveSnapshot(g, "b", tier);
		const ids = await listSnapshots(tier);
		expect([...ids]).toEqual(["a", "b", "c"]);
		g.destroy();
	});

	it("deletes a saved snapshot", async () => {
		const g = createGraph(basicSpec, { catalog });
		const tier = memoryKv();
		await saveSnapshot(g, "x", tier);
		await deleteSnapshot("x", tier);
		await expect(restoreSnapshot("x", tier)).rejects.toMatchObject({
			code: "snapshot-not-found",
		});
		g.destroy();
	});

	it("computes a structural diff between two snapshots", async () => {
		const g = createGraph(basicSpec, { catalog });
		const tier = memoryKv();
		g.set("input", 1);
		await saveSnapshot(g, "before", tier);
		g.set("input", 99);
		await saveSnapshot(g, "after", tier);
		const d = await diffSnapshots("before", "after", tier);
		expect(d.summary).not.toBe("no changes");
		g.destroy();
	});

	it("throws tier-no-list when tier lacks list()", async () => {
		const tier = { save() {}, load: () => null };
		await expect(listSnapshots(tier)).rejects.toMatchObject({
			code: "tier-no-list",
		});
	});

	it("listSnapshots filters non-surface keys on a shared tier (B6 namespacing)", async () => {
		const g = createGraph(basicSpec, { catalog });
		const tier = memoryKv();
		// Surface-written snapshot — should appear in listSnapshots.
		await saveSnapshot(g, "surface-1", tier);
		// Simulate an attachSnapshotStorage-style bare key — should NOT appear.
		await tier.save("some-graph-name", {
			mode: "full",
			seq: 0,
			timestamp_ns: 0,
			format_version: 1,
			snapshot: g.snapshot(),
		});
		const ids = await listSnapshots(tier);
		expect([...ids]).toEqual(["surface-1"]);
		// Opt-in to legacy behavior for users reading pre-namespacing sets.
		const all = await listSnapshots(tier, { includeUnprefixed: true });
		expect([...all].sort()).toEqual(["some-graph-name", "surface-1"]);
		g.destroy();
	});

	it("restoreSnapshot reads both namespaced and bare keys (back-compat)", async () => {
		const g = createGraph(basicSpec, { catalog });
		const tier = memoryKv();
		await saveSnapshot(g, "ns", tier);
		// Bare-key write for legacy compat simulation.
		await tier.save("legacy", {
			mode: "full",
			seq: 0,
			timestamp_ns: 0,
			format_version: 1,
			snapshot: g.snapshot(),
		});
		const factories = {
			"spec:basic-reduce/doubled": basicSpec.nodes.doubled,
			"spec:basic-reduce/output": basicSpec.nodes.output,
		};
		await expect(
			restoreSnapshot("ns", tier, {
				factories: { doubled: catalog.fns!.double, output: catalog.fns!.addOne },
			}),
		).resolves.toBeInstanceOf(Graph);
		await expect(
			restoreSnapshot("legacy", tier, {
				factories: { doubled: catalog.fns!.double, output: catalog.fns!.addOne },
			}),
		).resolves.toBeInstanceOf(Graph);
		void factories; // avoid unused-var
		g.destroy();
	});

	it("saveSnapshot / restoreSnapshot / deleteSnapshot / diffSnapshots reject ids with reserved prefix (D8)", async () => {
		const g = createGraph(basicSpec, { catalog });
		const tier = memoryKv();
		await expect(saveSnapshot(g, "snapshot:boom", tier)).rejects.toMatchObject({
			code: "snapshot-failed",
			message: expect.stringContaining('must not start with "snapshot:"'),
		});
		await expect(restoreSnapshot("snapshot:boom", tier)).rejects.toMatchObject({
			code: "snapshot-failed",
		});
		await expect(deleteSnapshot("snapshot:boom", tier)).rejects.toMatchObject({
			code: "snapshot-failed",
		});
		await expect(diffSnapshots("snapshot:a", "snapshot:b", tier)).rejects.toMatchObject({
			code: "snapshot-failed",
		});
		// External id "snapshot" (no colon) is allowed — only the full prefix is reserved.
		await expect(saveSnapshot(g, "snapshot", tier)).resolves.toMatchObject({
			snapshotId: "snapshot",
		});
		g.destroy();
	});
});
