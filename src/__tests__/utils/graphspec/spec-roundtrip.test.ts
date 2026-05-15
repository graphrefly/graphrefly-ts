/**
 * Tier 1.5.3 (Session A.1 lock) — Phase 3 unified-shape suite.
 *
 * Verifies:
 * - `describe({ detail: "spec" })` projects only structural fields and strips
 *   runtime state.
 * - `factoryTag(name, args)` stamps `meta.factory` + `meta.factoryArgs` on
 *   the resulting node.
 * - `compileSpec` reads `meta.factory` + `meta.factoryArgs` directly (Phase 3
 *   collapses the dual-read; the legacy `fn` / `source` / `config` /
 *   `initial` field-form is gone).
 * - `decompileSpec` is the canonical name (`decompileGraph` removed).
 * - State nodes self-tag via `factoryTag("state", { initial })` so initial
 *   values round-trip through `meta.factoryArgs.initial` (path (a)).
 */

import { DATA, factoryTag, node } from "@graphrefly/pure-ts/core";
import { Graph } from "@graphrefly/pure-ts/graph";
import { describe, expect, it } from "vitest";
import { compileSpec, decompileSpec, type GraphSpec } from "../../../utils/graphspec/index.js";

describe("describe({ detail: 'spec' })", () => {
	it("projects type/deps/meta and strips runtime fields", () => {
		const g = new Graph("g");
		const a = node([], {
			name: "a",
			meta: { ...factoryTag("counter", { initial: 42 }) },
			initial: 42,
		});
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{
				describeKind: "derived",
				name: "b",
				meta: { ...factoryTag("multiplier", { by: 2 }), domain: "math" },
			},
		);
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });
		// Activate so values populate; spec projection should still strip them.
		const off = b.subscribe(() => {});

		const spec = g.describe({ detail: "spec" });
		expect(spec.nodes.a).toBeDefined();
		expect(spec.nodes.b).toBeDefined();

		// Structural fields preserved.
		expect(spec.nodes.a!.type).toBe("state");
		expect(spec.nodes.b!.type).toBe("derived");
		expect(spec.nodes.b!.deps).toContain("a");

		// Meta carries factory + factoryArgs.
		expect(spec.nodes.a!.meta?.factory).toBe("counter");
		expect((spec.nodes.a!.meta?.factoryArgs as { initial: number }).initial).toBe(42);
		expect(spec.nodes.b!.meta?.factory).toBe("multiplier");
		expect((spec.nodes.b!.meta?.factoryArgs as { by: number }).by).toBe(2);
		// Domain meta also preserved.
		expect(spec.nodes.b!.meta?.domain).toBe("math");

		// Runtime fields stripped (status/guard/lastMutation always; `value`
		// retained for state nodes only — path (b) lock).
		expect(spec.nodes.a!.status).toBeUndefined();
		expect(spec.nodes.a!.lastMutation).toBeUndefined();
		expect(spec.nodes.a!.guard).toBeUndefined();
		// State node: `value` retained as the seed initial.
		expect(spec.nodes.a!.value).toBe(42);
		// Derived node: `value` stripped (runtime artifact).
		expect(spec.nodes.b!.value).toBeUndefined();

		off();
	});
});

describe("factoryTag", () => {
	it("returns factory + factoryArgs object suitable for meta", () => {
		const tag = factoryTag("rateLimiter", { permits: 10, intervalMs: 1_000 });
		expect(tag).toEqual({
			factory: "rateLimiter",
			factoryArgs: { permits: 10, intervalMs: 1_000 },
		});
	});

	it("omits factoryArgs when not provided", () => {
		const tag = factoryTag("singleton");
		expect(tag).toEqual({ factory: "singleton" });
		expect("factoryArgs" in tag).toBe(false);
	});

	it("merges cleanly with other meta", () => {
		const meta = { ...factoryTag("withTimeout", { ms: 500 }), domain: "resilience" };
		expect(meta).toEqual({
			factory: "withTimeout",
			factoryArgs: { ms: 500 },
			domain: "resilience",
		});
	});
});

describe("compileSpec reads meta.factory directly (Tier 1.5.3 Phase 3)", () => {
	it("reads meta.factory + meta.factoryArgs for derived nodes", () => {
		const spec: GraphSpec = {
			name: "g",
			nodes: {
				input: { type: "state", value: 5, deps: [] },
				doubled: {
					type: "derived",
					deps: ["input"],
					meta: { ...factoryTag("multiply", { by: 2 }) },
				},
			},
		};

		const g = compileSpec(spec, {
			catalog: {
				fns: {
					multiply: (deps, config) =>
						node(
							[deps[0] as Parameters<typeof derived>[0][number]],
							(batchData, actions, ctx) => {
								const data = batchData.map((batch, i) =>
									batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
								);
								actions.emit((data[0] as number) * (config.by as number));
							},
							{ describeKind: "derived" },
						),
				},
			},
		});

		const doubled = g.resolve("doubled");
		const off = doubled.subscribe(() => {});
		expect(doubled.cache).toBe(10);
		off();
	});

	it("reads meta.factory for producer nodes (resolves via catalog.sources)", () => {
		const spec: GraphSpec = {
			name: "g",
			nodes: {
				heartbeat: {
					type: "producer",
					deps: [],
					meta: { ...factoryTag("seedSource", { value: 99 }) },
				},
			},
		};

		let receivedConfig: unknown = null;
		const g = compileSpec(spec, {
			catalog: {
				sources: {
					seedSource: (config) => {
						receivedConfig = config;
						return node([], { initial: config.value });
					},
				},
			},
		});

		expect(receivedConfig).toEqual({ value: 99 });
		const heartbeat = g.resolve("heartbeat");
		const off = heartbeat.subscribe(() => {});
		expect(heartbeat.cache).toBe(99);
		off();
	});

	it("state node initial via top-level value field (path (b) canonical)", () => {
		// Path (b) lock: spec projection retains `value` for state nodes so the
		// seed initial round-trips via `value`, not via meta companion nodes.
		const spec: GraphSpec = {
			name: "g",
			nodes: {
				counter: { type: "state", deps: [], value: 7 },
			},
		};
		const g = compileSpec(spec);
		expect(g.resolve("counter").cache).toBe(7);
	});

	it("state node initial via meta.factoryArgs.initial also works (legacy / explicit form)", () => {
		// A user-tagged state factory may stamp `meta.factoryArgs.initial`; the
		// `compileSpec` `readStateInitial` helper prefers it before falling back
		// to `value`. Both forms are accepted.
		const spec: GraphSpec = {
			name: "g",
			nodes: {
				counter: {
					type: "state",
					deps: [],
					meta: { ...factoryTag("counter", { initial: 42 }) },
				},
			},
		};
		const g = compileSpec(spec);
		expect(g.resolve("counter").cache).toBe(42);
	});
});

describe("Phase 2 — tagged factories surface meta.factory in describe()", () => {
	it("rateLimiter tags itself", async () => {
		const { rateLimiter } = await import("../../../utils/resilience/index.js");
		const { NS_PER_SEC } = await import("../../../utils/resilience/backoff.js");

		const src = node([], { initial: 0 });
		const { node: limited } = rateLimiter(src, {
			maxEvents: 5,
			windowNs: NS_PER_SEC,
			maxBuffer: Infinity,
		});
		const off = limited.subscribe(() => {});

		const g = new Graph("g");
		g.add(limited, { name: "limited" });
		const spec = g.describe({ detail: "spec" });

		expect(spec.nodes.limited?.meta?.factory).toBe("rateLimiter");
		const args = spec.nodes.limited?.meta?.factoryArgs as {
			maxEvents: number;
			windowNs: number;
		};
		expect(args.maxEvents).toBe(5);
		expect(args.windowNs).toBe(NS_PER_SEC);

		off();
	});

	it("timeout tags itself", async () => {
		const { deadline: timeout } = await import("../../../utils/resilience/index.js");
		const { NS_PER_SEC } = await import("../../../utils/resilience/backoff.js");

		const src = node([], { initial: 0 });
		const timed = timeout(src, { ns: 5 * NS_PER_SEC }).node;
		const off = timed.subscribe(() => {});

		const g = new Graph("g");
		g.add(timed, { name: "timed" });
		const spec = g.describe({ detail: "spec" });

		expect(spec.nodes.timed?.meta?.factory).toBe("deadline");
		const args = spec.nodes.timed?.meta?.factoryArgs as { ns: number };
		expect(args.ns).toBe(5 * NS_PER_SEC);

		off();
	});

	it("retry tags itself", async () => {
		const { retry } = await import("../../../utils/resilience/index.js");

		const src = node([], { initial: 0 });
		const wrapped = retry(src, { count: 3, backoff: "exponential" }).node;
		const off = wrapped.subscribe(() => {});

		const g = new Graph("g");
		g.add(wrapped, { name: "n" });
		const spec = g.describe({ detail: "spec" });

		expect(spec.nodes.n?.meta?.factory).toBe("retry");
		const args = spec.nodes.n?.meta?.factoryArgs as { count?: number; backoff?: string };
		expect(args.count).toBe(3);
		expect(args.backoff).toBe("exponential");

		off();
	});

	it("retry omits non-serializable backoff function from factoryArgs", async () => {
		const { retry } = await import("../../../utils/resilience/index.js");

		const src = node([], { initial: 0 });
		const wrapped = retry(src, { count: 2, backoff: () => 100 }).node;
		const off = wrapped.subscribe(() => {});

		const g = new Graph("g");
		g.add(wrapped, { name: "n" });
		const spec = g.describe({ detail: "spec" });

		expect(spec.nodes.n?.meta?.factory).toBe("retry");
		const args = spec.nodes.n?.meta?.factoryArgs as { count?: number; backoff?: unknown };
		expect(args.count).toBe(2);
		expect(args.backoff).toBeUndefined();

		off();
	});

	it("scan tags itself", async () => {
		const { scan } = await import("@graphrefly/pure-ts/extra");

		const src = node([], { initial: 0 });
		const wrapped = scan(src, (a: number, x: number) => a + x, 10);
		const off = wrapped.subscribe(() => {});

		const g = new Graph("g");
		g.add(wrapped, { name: "n" });
		const spec = g.describe({ detail: "spec" });

		expect(spec.nodes.n?.meta?.factory).toBe("scan");
		const args = spec.nodes.n?.meta?.factoryArgs as { initial: number };
		expect(args.initial).toBe(10);

		off();
	});

	it("distinctUntilChanged tags itself", async () => {
		const { distinctUntilChanged } = await import("@graphrefly/pure-ts/extra");

		const src = node([], { initial: 0 });
		const wrapped = distinctUntilChanged(src);
		const off = wrapped.subscribe(() => {});

		const g = new Graph("g");
		g.add(wrapped, { name: "n" });
		const spec = g.describe({ detail: "spec" });

		expect(spec.nodes.n?.meta?.factory).toBe("distinctUntilChanged");
		// equality fn isn't JSON-serializable — factoryArgs intentionally omitted.
		expect(spec.nodes.n?.meta?.factoryArgs).toBeUndefined();

		off();
	});

	it("merge tags itself", async () => {
		const { merge } = await import("@graphrefly/pure-ts/extra");

		const a = node([], { initial: 1 });
		const b = node([], { initial: 2 });
		const wrapped = merge(a, b);
		const off = wrapped.subscribe(() => {});

		const g = new Graph("g");
		g.add(wrapped, { name: "n" });
		const spec = g.describe({ detail: "spec" });

		expect(spec.nodes.n?.meta?.factory).toBe("merge");
		// variadic Node[] args aren't JSON-serializable — factoryArgs intentionally omitted.
		expect(spec.nodes.n?.meta?.factoryArgs).toBeUndefined();

		off();
	});

	it("switchMap tags itself", async () => {
		const { switchMap } = await import("@graphrefly/pure-ts/extra");

		const src = node([], { initial: 0 });
		const wrapped = switchMap(src, (n: number) => node([], { initial: n * 2 }));
		const off = wrapped.subscribe(() => {});

		const g = new Graph("g");
		g.add(wrapped, { name: "n" });
		const spec = g.describe({ detail: "spec" });

		expect(spec.nodes.n?.meta?.factory).toBe("switchMap");
		// project fn isn't JSON-serializable — factoryArgs intentionally omitted.
		expect(spec.nodes.n?.meta?.factoryArgs).toBeUndefined();

		off();
	});

	it("debounce tags itself", async () => {
		const { debounce } = await import("@graphrefly/pure-ts/extra");

		const src = node([], { initial: 0 });
		const wrapped = debounce(src, 50);
		const off = wrapped.subscribe(() => {});

		const g = new Graph("g");
		g.add(wrapped, { name: "n" });
		const spec = g.describe({ detail: "spec" });

		expect(spec.nodes.n?.meta?.factory).toBe("debounce");
		const args = spec.nodes.n?.meta?.factoryArgs as { ms: number };
		expect(args.ms).toBe(50);

		off();
	});

	it("throttle tags itself", async () => {
		const { throttle } = await import("@graphrefly/pure-ts/extra");

		const src = node([], { initial: 0 });
		const wrapped = throttle(src, 75, { trailing: true });
		const off = wrapped.subscribe(() => {});

		const g = new Graph("g");
		g.add(wrapped, { name: "n" });
		const spec = g.describe({ detail: "spec" });

		expect(spec.nodes.n?.meta?.factory).toBe("throttle");
		const args = spec.nodes.n?.meta?.factoryArgs as {
			ms: number;
			leading: boolean;
			trailing: boolean;
		};
		expect(args.ms).toBe(75);
		expect(args.leading).toBe(true);
		expect(args.trailing).toBe(true);

		off();
	});

	it("bufferTime tags itself", async () => {
		const { bufferTime } = await import("@graphrefly/pure-ts/extra");

		const src = node([], { initial: 0 });
		const wrapped = bufferTime(src, 100);
		const off = wrapped.subscribe(() => {});

		const g = new Graph("g");
		g.add(wrapped, { name: "n" });
		const spec = g.describe({ detail: "spec" });

		expect(spec.nodes.n?.meta?.factory).toBe("bufferTime");
		const args = spec.nodes.n?.meta?.factoryArgs as { ms: number };
		expect(args.ms).toBe(100);

		off();
	});

	it("frozenContext tags itself", async () => {
		const { frozenContext } = await import("../../../utils/ai/prompts/frozen-context.js");

		const src = node([], { initial: "hello" });
		const wrapped = frozenContext(src, { name: "ctx" });
		const off = wrapped.subscribe(() => {});

		const g = new Graph("g");
		g.add(wrapped, { name: "n" });
		const spec = g.describe({ detail: "spec" });

		expect(spec.nodes.n?.meta?.factory).toBe("frozenContext");
		const args = spec.nodes.n?.meta?.factoryArgs as { name: string };
		expect(args.name).toBe("ctx");

		off();
	});
});

describe("decompileSpec is the canonical name (Phase 3)", () => {
	it("decompileGraph is no longer exported", async () => {
		const mod = await import("../../../utils/graphspec/index.js");
		expect((mod as Record<string, unknown>).decompileGraph).toBeUndefined();
	});

	it("decompileSpec(g) ≈ g.describe({ detail: 'spec' }) (modulo feedback sugar + meta-companion stripping)", () => {
		const g = new Graph("g");
		g.add(node([], { name: "a", initial: 7 }), { name: "a" });

		const viaSpec = decompileSpec(g);
		const viaDescribe = g.describe({ detail: "spec" });

		expect(viaSpec.name).toBe(viaDescribe.name);
		expect(viaSpec.name).toBe("g");
		expect(viaSpec.nodes.a).toBeDefined();
		// Path (b): state node retains `value` in spec projection so `initial`
		// round-trips without polluting the graph with meta companion nodes.
		expect(viaSpec.nodes.a!.value).toBe(7);
		expect(viaSpec.nodes.a!.type).toBe("state");
	});

	it("state initial round-trips through decompileSpec → compileSpec", () => {
		const g1 = new Graph("g");
		g1.add(node([], { name: "counter", initial: 99 }), { name: "counter" });
		const spec = decompileSpec(g1);
		const g2 = compileSpec(spec);
		expect(g2.resolve("counter").cache).toBe(99);
	});
});

describe("decompileSpec → compileSpec round-trip", () => {
	it("a graph using factoryTag-stamped derived survives decompile→compile", () => {
		// 1) Build a graph using factoryTag on a derived node.
		const g1 = new Graph("g");
		const input = node([], { name: "input", initial: 6 });
		const doubled = node(
			[input],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived", name: "doubled", meta: { ...factoryTag("multiply", { by: 2 }) } },
		);
		g1.add(input, { name: "input" });
		g1.add(doubled, { name: "doubled" });
		const offOriginal = doubled.subscribe(() => {});

		// 2) decompileSpec — filters meta-companion paths, preserves factory tags.
		const spec = decompileSpec(g1);

		// Factory tag survived.
		expect(spec.nodes.doubled?.meta?.factory).toBe("multiply");
		expect((spec.nodes.doubled?.meta?.factoryArgs as { by: number }).by).toBe(2);

		// 3) compileSpec normalizes meta.factory → fn (Phase 1 dual-read), looks
		// up the catalog, recreates the node.
		const g2 = compileSpec(spec, {
			catalog: {
				fns: {
					multiply: (deps, config) =>
						node(
							[deps[0] as Parameters<typeof derived>[0][number]],
							(batchData, actions, ctx) => {
								const data = batchData.map((batch, i) =>
									batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
								);
								actions.emit((data[0] as number) * (config.by as number));
							},
							{ describeKind: "derived" },
						),
				},
			},
		});

		const recreatedDoubled = g2.resolve("doubled");
		const recreatedInput = g2.resolve("input");
		const off = recreatedDoubled.subscribe(() => {});
		expect(recreatedInput.cache).toBe(6);
		expect(recreatedDoubled.cache).toBe(12);

		// Push a new value — recreated topology propagates.
		(recreatedInput as { down: (msgs: unknown) => void }).down([[DATA, 10]]);
		expect(recreatedDoubled.cache).toBe(20);

		off();
		offOriginal();
	});
});

describe("Tier 1.5.3 Phase 2.5 — Graph-level factory tagging (DG1=B)", () => {
	it("Graph.tagFactory(name, args) surfaces top-level factory + factoryArgs in describe()", () => {
		const g = new Graph("g");
		g.tagFactory("agentMemory", { budget: 2000, vectorDimensions: 1536 });
		g.add(node([], { name: "store", initial: 0 }), { name: "store" });

		const out = g.describe();
		expect(out.factory).toBe("agentMemory");
		expect(out.factoryArgs).toEqual({ budget: 2000, vectorDimensions: 1536 });
	});

	it("GraphOptions.factory in constructor seeds the tag", () => {
		const g = new Graph("g", { factory: "pipelineGraph", factoryArgs: { stages: ["a", "b"] } });
		expect(g.describe().factory).toBe("pipelineGraph");
		expect(g.describe().factoryArgs).toEqual({ stages: ["a", "b"] });
	});

	it("describe({ detail: 'spec' }) preserves Graph-level factory tag", () => {
		const g = new Graph("g");
		g.tagFactory("harnessLoop", { route: "auto-fix" });
		const spec = g.describe({ detail: "spec" });
		expect(spec.factory).toBe("harnessLoop");
		expect(spec.factoryArgs).toEqual({ route: "auto-fix" });
	});

	it("Tier 3.4: placeholderArgs substitutes a Node<readonly string[]> field as `<Node>` (regression for reactive `paths` factory-tag round-trip)", async () => {
		const { placeholderArgs } = await import("@graphrefly/pure-ts/core");
		// Mirrors the Tier 3.4 `policyEnforcer({ paths: stateNode })` shape:
		// `paths` may be a static array OR a Node-of-array. Both must survive
		// `placeholderArgs` cleanly — the Node form collapses to `"<Node>"`,
		// the array form recurses element-wise.
		const pathsNode = node<readonly string[]>([], { initial: ["a", "b"] });
		const args = placeholderArgs({
			paths: pathsNode,
			mode: "enforce",
			violationsLimit: 100,
		});
		expect(args.paths).toBe("<Node>");
		expect(args.mode).toBe("enforce");
		expect(args.violationsLimit).toBe(100);

		// Static-array form recurses element-wise (string primitives pass through).
		const argsStatic = placeholderArgs({
			paths: ["a", "b"],
			mode: "audit",
		});
		expect(argsStatic.paths).toEqual(["a", "b"]);
		expect(argsStatic.mode).toBe("audit");
	});

	it("placeholderArgs substitutes non-JSON fields with descriptive strings (DG2=ii)", async () => {
		const { placeholderArgs } = await import("@graphrefly/pure-ts/core");
		const adapter = { invoke: () => ({ content: "x" }) }; // not a Node, but has a function
		const sourceNode = node([], { initial: 0 });
		const args = placeholderArgs({
			budget: 2000,
			adapter,
			extractFn: (raw: unknown) => ({ upsert: [{ key: "k", value: raw }] }),
			source: sourceNode,
			model: "claude-opus-4-7",
			tags: ["a", "b"],
		});

		expect(args.budget).toBe(2000);
		expect(args.model).toBe("claude-opus-4-7");
		expect(args.tags).toEqual(["a", "b"]);
		expect(args.extractFn).toBe("<function>");
		expect(args.source).toBe("<Node>");
		// adapter has invoke fn — recursive walk yields { invoke: "<function>" }.
		expect((args.adapter as { invoke: string }).invoke).toBe("<function>");
	});

	it("compileSpec delegates to catalog.graphFactories when spec.factory is set", () => {
		const spec: GraphSpec = {
			name: "g",
			nodes: {}, // ignored — graphFactory owns reconstruction
			factory: "myAgentMemory",
			factoryArgs: { budget: 500 },
		};

		let receivedArgs: unknown = null;
		const built = compileSpec(spec, {
			catalog: {
				graphFactories: {
					myAgentMemory: (args) => {
						receivedArgs = args;
						const sub = new Graph("g");
						sub.add(node([], { name: "marker", initial: 123 }), { name: "marker" });
						sub.tagFactory("myAgentMemory", args);
						return sub;
					},
				},
			},
		});

		expect(receivedArgs).toEqual({ budget: 500 });
		expect(built.describe().factory).toBe("myAgentMemory");
		expect(built.resolve("marker").cache).toBe(123);
	});

	it("falls back to per-node compile when spec.factory has no graphFactories entry", () => {
		const spec: GraphSpec = {
			name: "g",
			nodes: { x: { type: "state", deps: [], value: 7 } },
			factory: "unknownFactory",
		};
		// No graphFactories entry — should fall through and compile nodes normally.
		const built = compileSpec(spec, { catalog: { fns: {}, sources: {} } });
		expect(built.resolve("x").cache).toBe(7);
	});

	it("pipelineGraph self-tags with factory: 'pipelineGraph' (flagship Phase 2.5 migration)", async () => {
		const { pipelineGraph } = await import("../../../utils/orchestration/index.js");
		const p = pipelineGraph("flow", { traceCapacity: 256 });
		const out = p.describe();
		expect(out.factory).toBe("pipelineGraph");
		expect((out.factoryArgs as { traceCapacity: number }).traceCapacity).toBe(256);
	});
});

describe("Phase 2 operator mop-up — map/filter/reduce/take/tap/withLatestFrom self-tag", () => {
	it("map tags itself", async () => {
		const { map } = await import("@graphrefly/pure-ts/extra");
		const src = node([], { initial: 0 });
		const m = map(src, (v) => v * 2);
		const off = m.subscribe(() => {});
		const g = new Graph("g");
		g.add(m, { name: "m" });
		expect(g.describe({ detail: "spec" }).nodes.m?.meta?.factory).toBe("map");
		off();
	});

	it("filter tags itself", async () => {
		const { filter } = await import("@graphrefly/pure-ts/extra");
		const src = node([], { initial: 0 });
		const f = filter(src, (v) => v > 0);
		const off = f.subscribe(() => {});
		const g = new Graph("g");
		g.add(f, { name: "f" });
		expect(g.describe({ detail: "spec" }).nodes.f?.meta?.factory).toBe("filter");
		off();
	});

	it("reduce tags itself with initial seed", async () => {
		const { reduce } = await import("@graphrefly/pure-ts/extra");
		const src = node([], { initial: 1 });
		const r = reduce(src, (a, v) => a + v, 100);
		const off = r.subscribe(() => {});
		const g = new Graph("g");
		g.add(r, { name: "r" });
		const meta = g.describe({ detail: "spec" }).nodes.r?.meta;
		expect(meta?.factory).toBe("reduce");
		expect((meta?.factoryArgs as { initial: number }).initial).toBe(100);
		off();
	});

	it("take tags itself with count", async () => {
		const { take } = await import("@graphrefly/pure-ts/extra");
		const src = node([], { initial: 0 });
		const t = take(src, 3);
		const off = t.subscribe(() => {});
		const g = new Graph("g");
		g.add(t, { name: "t" });
		const meta = g.describe({ detail: "spec" }).nodes.t?.meta;
		expect(meta?.factory).toBe("take");
		expect((meta?.factoryArgs as { count: number }).count).toBe(3);
		off();
	});

	it("tap tags itself (function form)", async () => {
		const { tap } = await import("@graphrefly/pure-ts/extra");
		const src = node([], { initial: 0 });
		const t = tap(src, () => undefined);
		const off = t.subscribe(() => {});
		const g = new Graph("g");
		g.add(t, { name: "t" });
		expect(g.describe({ detail: "spec" }).nodes.t?.meta?.factory).toBe("tap");
		off();
	});

	it("withLatestFrom tags itself", async () => {
		const { withLatestFrom } = await import("@graphrefly/pure-ts/extra");
		const a = node([], { initial: 1 });
		const b = node([], { initial: 2 });
		const w = withLatestFrom(a, b);
		const off = w.subscribe(() => {});
		const g = new Graph("g");
		g.add(w, { name: "w" });
		expect(g.describe({ detail: "spec" }).nodes.w?.meta?.factory).toBe("withLatestFrom");
		off();
	});
});
