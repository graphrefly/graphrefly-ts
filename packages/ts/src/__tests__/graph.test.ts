import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { depLatest } from "../ctx/types.js";
import type { GraphRestoreDescriptor, Message, RestoreGraphOptions } from "../index.js";
import {
	Dispatcher,
	defaultRestoreRegistry,
	define,
	GRAPH_CHECKPOINT_VERSION,
	graph,
	map,
	restoreGraph,
	restoreRegistry,
	strictJsonCodec,
	take,
	timer,
} from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	n.subscribe((m) => msgs.push(m));
	return msgs;
}
const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("Graph — 8-verb sugar (CSP-2)", () => {
	it("state + derived: value-level fn computes from dep values (D27)", () => {
		const g = graph();
		const count = g.state(0);
		const doubled = g.derived([count], (n) => n * 2);
		collect(doubled);
		expect(doubled.cache).toBe(0);
		count.set(5);
		expect(doubled.cache).toBe(10);
	});

	it("derived over multiple deps receives typed values in order", () => {
		const g = graph();
		const a = g.state(2);
		const b = g.state(3);
		const sum = g.derived([a, b], (x, y) => x + y);
		collect(sum);
		expect(sum.cache).toBe(5);
		b.set(10);
		expect(sum.cache).toBe(12);
	});

	it("effect runs on dep settle and registers a deactivation cleanup", () => {
		const g = graph();
		const s = g.state(1);
		const seen: number[] = [];
		let cleaned = 0;
		const e = g.effect([s], (n) => {
			seen.push(n);
			return () => {
				cleaned++;
			};
		});
		const unsub = e.subscribe(() => {});
		expect(seen).toEqual([1]);
		s.set(2);
		expect(seen).toEqual([1, 2]);
		unsub(); // last subscriber → deactivate → cleanup
		expect(cleaned).toBe(1);
	});

	it("D30: a value-level fn that throws emits ERROR downstream (not a crash)", () => {
		const g = graph();
		const s = g.state(1);
		const bad = g.derived([s], (n) => {
			if (n > 0) throw new Error("boom");
			return n;
		});
		const msgs = collect(bad);
		expect(types(msgs)).toContain("ERROR");
		expect(bad.status).toBe("errored");
	});

	it("R-reentrancy via graph (D37): a synchronous feedback cycle yields ERROR, not a hang", () => {
		const g = graph();
		const s = g.state(0);
		const d = g.derived([s], (n) => n + 1);
		const seen: Message[] = [];
		// effect feeds back into s → S→D→E→S cycle. The substrate rejects the re-entry
		// (throw); the graph layer's value-level boundary catches it → ERROR. No hang.
		const e = g.effect([d], (n) => {
			s.set(n as number);
		});
		expect(() => e.subscribe((m) => seen.push(m))).not.toThrow(); // caught, not escaped
		// R-reentrancy: the ERROR lands on a node ON the cycle — the value-level catch nearest
		// the throw on the synchronous unwind (impl-determined, d or e), NOT necessarily the
		// re-entered node. Assert SOME cycle node errored, not which (per the amended spec).
		expect([d.status, e.status]).toContain("errored");
	});
});

describe("Graph.describe — snapshot shape (R-describe / D39)", () => {
	it("emits a flat snapshot with ids, factory names, status, value, deps, edges", () => {
		const g = graph({ name: "demo" });
		const count = g.state(0, { name: "count" });
		const doubled = g.derived([count], (n) => n * 2, { name: "doubled" });
		collect(doubled);
		count.set(5);

		const snap = g.describe();
		expect(snap.name).toBe("demo");
		const byId = Object.fromEntries(snap.nodes.map((n) => [n.id, n]));
		expect(byId.count.factory).toBe("state");
		expect(byId.count.value).toBe(5);
		expect(byId.count.status).toBe("settled");
		expect(byId.doubled.factory).toBe("derived");
		expect(byId.doubled.value).toBe(10);
		expect(byId.doubled.deps).toEqual(["count"]);
		expect(snap.edges).toContainEqual({ from: "count", to: "doubled" });
	});

	it("absent value field = SENTINEL (never-emitted)", () => {
		const g = graph();
		const s = g.state(0, { name: "s" });
		g.derived([s], (n) => n, { name: "d" }); // not subscribed → never runs
		const snap = g.describe();
		const dNode = snap.nodes.find((n) => n.id === "d");
		expect(dNode && "value" in dNode).toBe(false); // SENTINEL → field absent
	});

	it("explain mode filters to the causal chain from→to", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.derived([a], (x) => x + 1, { name: "b" });
		const c = g.derived([b], (x) => x + 1, { name: "c" });
		const side = g.state(9, { name: "side" }); // off the a→c chain
		collect(c);
		collect(g.derived([side], (x) => x, { name: "sideD" }));

		const snap = g.describe({ explain: { from: "a", to: "c" } });
		const ids = snap.nodes.map((n) => n.id).sort();
		expect(ids).toEqual(["a", "b", "c"]);
	});

	it("mount nests a subgraph under a :: prefixed path", () => {
		const parent = graph({ name: "p" });
		parent.state(0, { name: "root" });
		const child = graph({ name: "c" });
		child.state(1, { name: "leaf" });
		parent.mount(child, { at: "sub" });

		const snap = parent.describe();
		expect(snap.subgraphs?.[0].nodes.some((n) => n.id === "sub::leaf")).toBe(true);
	});
});

describe("Graph.checkpoint — public data shape (R-snapshot / D83 / D90)", () => {
	it("returns a versioned strict-JSON-compatible checkpoint with live topology and mounts", () => {
		const parent = graph({ name: "parent" });
		const count = parent.state(0, { name: "count" });
		const doubled = parent.derived([count], (n) => n * 2, { name: "doubled" });
		collect(doubled);
		count.set(5);
		const child = graph({ name: "child" });
		child.state(null, { name: "nil" });
		parent.mount(child, { at: "child" });

		const checkpoint = parent.checkpoint();
		expect(checkpoint.version).toBe(GRAPH_CHECKPOINT_VERSION);
		expect(() => strictJsonCodec.encode(checkpoint)).not.toThrow();
		const byId = Object.fromEntries(checkpoint.nodes.map((n) => [n.id, n]));
		expect(byId.count.factory).toEqual({ kind: "registry-ref", ref: "state" });
		expect(byId.count.value).toEqual({ kind: "DATA", data: 5 });
		expect(byId.doubled.factory.kind).toBe("local-only");
		expect(byId.doubled.value).toEqual({ kind: "DATA", data: 10 });
		expect(byId.doubled.deps).toEqual(["count"]);
		expect(byId.doubled.lifecycle.hasCalledFnOnce).toBe(true);
		expect(checkpoint.edges).toContainEqual({ from: "count", to: "doubled" });
		expect(checkpoint.mounts?.[0].at).toBe("child");
		expect(checkpoint.mounts?.[0].checkpoint.nodes[0]).toMatchObject({
			id: "nil",
			value: { kind: "DATA", data: null },
		});
	});

	it("captures ran-but-SENTINEL lifecycle state explicitly", () => {
		const g = graph();
		const quiet = g.producer(() => {}, { name: "quiet" });
		collect(quiet);

		const node = g.checkpoint().nodes.find((n) => n.id === "quiet");
		expect(node?.value).toEqual({ kind: "SENTINEL" });
		expect(node?.lifecycle).toEqual({ activated: true, hasCalledFnOnce: true });
	});

	it("uses explicit SENTINEL/DATA discriminants for absence, null, and empty arrays", () => {
		const g = graph();
		const src = g.state(0, { name: "src" });
		g.derived([src], (n) => n, { name: "cold" });
		g.state(null, { name: "nil" });
		g.state([], { name: "empty" });

		const byId = Object.fromEntries(g.checkpoint().nodes.map((n) => [n.id, n]));
		expect(byId.cold.value).toEqual({ kind: "SENTINEL" });
		expect(byId.nil.value).toEqual({ kind: "DATA", data: null });
		expect(byId.empty.value).toEqual({ kind: "DATA", data: [] });
	});

	it("captures node-private ctx.state even when the state is non-persist", () => {
		const g = graph();
		const src = g.state(1, { name: "src" });
		const memo = g.node(
			[src],
			(ctx) => {
				ctx.state.set({ latest: depLatest(ctx, 0), runs: 1 });
				ctx.down([["DATA", "ok"]]);
			},
			{ name: "memo" },
		);
		collect(memo);

		const node = g.checkpoint().nodes.find((n) => n.id === "memo");
		expect(node?.ctxState).toEqual({
			persist: false,
			value: { kind: "DATA", data: { latest: 1, runs: 1 } },
		});
	});

	it("discriminates COMPLETE and ERROR terminal state when represented", () => {
		const g = graph();
		const done = g.state(1, { name: "done" });
		const failed = g.state(2, { name: "failed" });
		done.down([["COMPLETE"]]);
		failed.down([["ERROR", "boom"]]);

		const byId = Object.fromEntries(g.checkpoint().nodes.map((n) => [n.id, n]));
		expect(byId.done.terminal).toEqual({ kind: "COMPLETE" });
		expect(byId.failed.terminal).toEqual({ kind: "ERROR", error: "boom" });
	});

	it("fails honestly for non-strict-JSON cache, meta, ctx.state, and terminal payloads", () => {
		const badCache = graph();
		badCache.state(1n, { name: "big" });
		expect(() => badCache.checkpoint()).toThrow(/strict JSON compatible/);

		const badMeta = graph();
		badMeta.state(1, { name: "meta", meta: { f: () => undefined } });
		expect(() => badMeta.checkpoint()).toThrow(/strict JSON compatible/);

		const badString = graph();
		badString.state("\ud800", { name: "surrogate" });
		expect(() => badString.checkpoint()).toThrow(/strict JSON compatible/);

		const badName = graph();
		badName.state(1, { name: "\ud800" });
		expect(() => badName.checkpoint()).toThrow(/strict JSON compatible/);

		const badCtxState = graph();
		const src = badCtxState.state(1, { name: "src" });
		const memo = badCtxState.node(
			[src],
			(ctx) => {
				ctx.state.set(Symbol("nope"));
				ctx.down([["DATA", "ok"]]);
			},
			{ name: "memo" },
		);
		collect(memo);
		expect(() => badCtxState.checkpoint()).toThrow(/strict JSON compatible/);

		const badTerminal = graph();
		const failed = badTerminal.state(1, { name: "failed" });
		failed.down([["ERROR", new Error("not-json")]]);
		expect(() => badTerminal.checkpoint()).toThrow(/strict JSON compatible/);
	});

	it("rejects duplicate ids and cyclic mounts instead of producing ambiguous checkpoints", () => {
		const duplicate = graph();
		duplicate.state(1, { name: "same" });
		expect(() => duplicate.state(2, { name: "same" })).toThrow(/duplicate node id/);

		const cyclic = graph();
		cyclic.mount(cyclic, { at: "self" });
		expect(() => cyclic.checkpoint()).toThrow(/cyclic graph mount/);
	});

	it("keeps graph checkpoint strict JSON validation independent from storage codecs (D96)", () => {
		const source = readFileSync(new URL("../graph/checkpoint.ts", import.meta.url), "utf8");
		expect(source).not.toContain("../storage/codec.js");
	});
});

describe("restoreGraph — fresh graph restore (R-restore / D94 / D95)", () => {
	it("restores named state DATA and pushes it on subscribe after restore", () => {
		const g = graph({ name: "source" });
		const count = g.state(0, { name: "count", meta: { role: "counter" } });
		count.set(7);

		const restored = restoreGraph(g.checkpoint(), { registry: defaultRestoreRegistry });
		const node = restored.find("count");
		expect(node?.cache).toBe(7);
		expect(restored.describe().nodes.find((n) => n.id === "count")).toMatchObject({
			id: "count",
			name: "count",
			factory: "state",
			value: 7,
			meta: { role: "counter" },
		});

		const msgs = collect(node as { subscribe(s: (m: Message) => void): () => void });
		expect(msgs).toEqual([["START"], ["DATA", 7]]);
	});

	it("preserves SENTINEL absence separately from DATA null and empty array", () => {
		const checkpoint = graph().checkpoint();
		checkpoint.nodes = [
			{
				id: "cold",
				name: "cold",
				factory: { kind: "registry-ref", ref: "state" },
				status: "sentinel",
				deps: [],
				value: { kind: "SENTINEL" },
				terminal: { kind: "none" },
				lifecycle: { activated: false, hasCalledFnOnce: false },
				ctxState: { persist: false, value: { kind: "SENTINEL" } },
			},
			{
				id: "nil",
				name: "nil",
				factory: { kind: "registry-ref", ref: "state" },
				status: "settled",
				deps: [],
				value: { kind: "DATA", data: null },
				terminal: { kind: "none" },
				lifecycle: { activated: false, hasCalledFnOnce: false },
				ctxState: { persist: false, value: { kind: "SENTINEL" } },
			},
			{
				id: "empty",
				name: "empty",
				factory: { kind: "registry-ref", ref: "state" },
				status: "settled",
				deps: [],
				value: { kind: "DATA", data: [] },
				terminal: { kind: "none" },
				lifecycle: { activated: false, hasCalledFnOnce: false },
				ctxState: { persist: false, value: { kind: "SENTINEL" } },
			},
		];
		checkpoint.edges = [];

		const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
		expect(restored.find("cold")?.cache).toBeUndefined();
		expect(
			collect(restored.find("cold") as { subscribe(s: (m: Message) => void): () => void }),
		).toEqual([["START"]]);
		expect(restored.find("nil")?.cache).toBeNull();
		expect(restored.find("empty")?.cache).toEqual([]);
	});

	it("constructs deps in topological order and restores non-persist ctx.state before the first subscriber", () => {
		const original = graph();
		const src = original.state(1, { name: "src" });
		const memo = original.node(
			[src],
			(ctx) => {
				const previous = (ctx.state.get<{ runs: number }>() ?? { runs: 0 }).runs;
				const runs = previous + 1;
				ctx.state.set({ runs });
				ctx.down([["DATA", { runs }]]);
			},
			{
				name: "memo",
				restore: { ref: "memo", config: { mode: "runs" }, configVersion: "1" },
			},
		);
		collect(memo);
		const checkpoint = original.checkpoint();
		const memoNode = checkpoint.nodes.find((n) => n.id === "memo");
		expect(memoNode?.factory).toEqual({
			kind: "registry-ref",
			ref: "memo",
			config: { mode: "runs" },
			configVersion: "1",
		});
		checkpoint.nodes.reverse();

		const memoDescriptor: GraphRestoreDescriptor = {
			ref: "memo",
			validateConfig(config, configVersion) {
				expect(config).toEqual({ mode: "runs" });
				expect(configVersion).toBe("1");
				return config;
			},
			create(ctx) {
				return ctx.registerNode(
					"memo",
					ctx.deps,
					(runCtx) => {
						const previous = (runCtx.state.get<{ runs: number }>() ?? { runs: 0 }).runs;
						const runs = previous + 1;
						runCtx.state.set({ runs });
						runCtx.down([["DATA", { runs }]]);
					},
					{ name: ctx.name },
				);
			},
		};

		const restored = restoreGraph(checkpoint, {
			registry: { ...defaultRestoreRegistry, memo: memoDescriptor },
		});
		const restoredMemo = restored.find("memo");
		expect(restoredMemo?.cache).toEqual({ runs: 1 });
		const msgs = collect(restoredMemo as { subscribe(s: (m: Message) => void): () => void });
		expect(msgs.filter((m) => m[0] === "DATA").map((m) => m[1])).toEqual([
			{ runs: 1 },
			{ runs: 2 },
		]);
	});

	it("restores a named function map using D101 define checkpoints", () => {
		const original = graph();
		const src = original.state(1, { name: "src" });
		const inc = define<number, number>("inc", (n) => n + 1);
		const mapped = original.initNode(map(inc), [src], { name: "mapped" });
		collect(mapped);

		const checkpoint = original.checkpoint();
		expect(checkpoint.nodes.find((n) => n.id === "mapped")?.factory).toEqual({
			kind: "registry-ref",
			ref: "map",
			config: { fn: "inc" },
		});

		const reloadedInc = define<number, number>("inc", (n) => n + 10);
		const registry = restoreRegistry([reloadedInc], defaultRestoreRegistry);
		const restored = restoreGraph(checkpoint, { registry });
		expect(restored.find("mapped")?.cache).toBe(2);

		collect(restored.find("mapped") as { subscribe(s: (m: Message) => void): () => void });
		(restored.find("src") as { set(v: number): void }).set(2);
		expect(restored.find("mapped")?.cache).toBe(12);
	});

	it("rejects duplicate definition refs in restore registry (D101)", () => {
		const first = define<number, number>("same", (n) => n + 1);
		const duplicate = define<number, number>("same", (n) => n + 2);
		expect(() => restoreRegistry([first, duplicate], defaultRestoreRegistry)).toThrow(
			/duplicate ref 'same'/,
		);
	});

	it("fails honestly when a restored map config references a missing function definition (D101)", () => {
		const base = graph();
		base.state(1, { name: "src" });
		const checkpoint = base.checkpoint();
		checkpoint.nodes.push({
			id: "mapped",
			name: "mapped",
			factory: { kind: "registry-ref", ref: "map", config: { fn: "missing.inc" } },
			status: "sentinel",
			deps: ["src"],
			value: { kind: "SENTINEL" },
			terminal: { kind: "none" },
			lifecycle: { activated: false, hasCalledFnOnce: false },
			ctxState: { persist: false, value: { kind: "SENTINEL" } },
		});
		checkpoint.edges.push({ from: "src", to: "mapped" });

		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/missing function definition for 'missing\.inc'/,
		);
	});

	it("keeps inline closure map local-only while static built-in operators stamp config", () => {
		const g = graph();
		const src = g.state(1, { name: "src" });
		const inline = g.initNode(
			map((n: number) => n + 1),
			[src],
			{ name: "inline" },
		);
		const limited = g.initNode(take<number>(2), [src], { name: "limited" });
		const optOut = g.initNode(take<number>(1), [src], {
			name: "optOut",
			restore: undefined,
		});
		g.initNode(timer(5), [], { name: "once" });
		g.initNode(timer(6, {}), [], { name: "onceDefaultOpts" });
		collect(inline);
		collect(limited);
		collect(optOut);

		const checkpoint = g.checkpoint();
		expect(checkpoint.nodes.find((n) => n.id === "inline")?.factory.kind).toBe("local-only");
		expect(checkpoint.nodes.find((n) => n.id === "optOut")?.factory.kind).toBe("local-only");
		expect(checkpoint.nodes.find((n) => n.id === "limited")?.factory).toEqual({
			kind: "registry-ref",
			ref: "take",
			config: { n: 2 },
		});
		expect(checkpoint.nodes.find((n) => n.id === "once")?.factory).toEqual({
			kind: "registry-ref",
			ref: "timer",
			config: { ms: 5 },
		});
		expect(checkpoint.nodes.find((n) => n.id === "onceDefaultOpts")?.factory).toEqual({
			kind: "registry-ref",
			ref: "timer",
			config: { ms: 6 },
		});
		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/local-only/,
		);

		const restorable = graph();
		const rsrc = restorable.state(1, { name: "src" });
		const rtake = restorable.initNode(take<number>(1), [rsrc], { name: "limited" });
		collect(rtake);
		const restored = restoreGraph(restorable.checkpoint(), { registry: defaultRestoreRegistry });
		expect(restored.find("limited")?.cache).toBe(1);
	});

	it("restores built-in take and timer from checkpoint descriptors", () => {
		const restorable = graph();
		const src = restorable.state(1, { name: "src" });
		restorable.initNode(take<number>(1), [src], { name: "limited" });
		restorable.initNode(timer(7), [], { name: "once" });
		restorable.initNode(timer(8, {}), [], { name: "onceDefaultOpts" });
		const checkpoint = restorable.checkpoint();

		expect(checkpoint.nodes.find((n) => n.id === "limited")?.factory).toEqual({
			kind: "registry-ref",
			ref: "take",
			config: { n: 1 },
		});
		expect(checkpoint.nodes.find((n) => n.id === "once")?.factory).toEqual({
			kind: "registry-ref",
			ref: "timer",
			config: { ms: 7 },
		});
		expect(checkpoint.nodes.find((n) => n.id === "onceDefaultOpts")?.factory).toEqual({
			kind: "registry-ref",
			ref: "timer",
			config: { ms: 8 },
		});

		const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
		const restoredLimited = restored.find("limited");
		const restoredSrc = restored.find("src") as { set(v: number): void };
		const msgs = collect(restoredLimited as { subscribe(s: (m: Message) => void): () => void });
		const restoredOnce = restored.find("once");

		expect(msgs.length >= 1).toBe(true);
		expect(restoredOnce).toBeDefined();
		expect(restoredLimited?.cache).toBe(1);
		restoredSrc.set(2);
		expect(restoredLimited?.cache).toBe(1);
	});

	it("uses restoreGraph dispatcher option for the fresh restored graph (D100)", () => {
		const original = graph();
		const src = original.state(1, { name: "src" });
		const inc = define<number, number>("inc.dispatcher", (n) => n + 1);
		collect(original.initNode(map(inc), [src], { name: "mapped" }));
		const dispatcher = new Dispatcher();
		dispatcher.setRecording(true);

		const restored = restoreGraph(original.checkpoint(), {
			registry: restoreRegistry([inc], defaultRestoreRegistry),
			dispatcher,
		});
		collect(restored.find("mapped") as { subscribe(s: (m: Message) => void): () => void });
		(restored.find("src") as { set(v: number): void }).set(2);
		expect(restored.find("mapped")?.cache).toBe(3);
		expect(dispatcher.totalInvokes).toBeGreaterThan(0);
	});

	it("restores terminal COMPLETE and ERROR state without reopening terminal nodes", () => {
		const g = graph();
		const done = g.state(1, { name: "done" });
		const failed = g.state(2, { name: "failed" });
		done.down([["COMPLETE"]]);
		failed.down([["ERROR", "boom"]]);

		const restored = restoreGraph(g.checkpoint(), { registry: defaultRestoreRegistry });
		expect(restored.find("done")?.status).toBe("completed");
		expect(restored.find("failed")?.status).toBe("errored");
		expect(() => restored.find("done")?.subscribe(() => {})).toThrow(/non-resubscribable/);
		expect(() => restored.find("failed")?.subscribe(() => {})).toThrow(/non-resubscribable/);
	});

	it("checkpoints and restores D109 node runtime versions", () => {
		const hash = (value: unknown) => `h:${JSON.stringify(value)}`;
		const g = graph({ versioning: { level: 1, hash } });
		const src = g.state(1, { name: "src" });
		const v0 = g.state(1, { name: "v0", versioning: 0 });
		const disabled = g.state(1, { name: "disabled", versioning: false });
		src.set(2);
		v0.set(2);
		expect(disabled.version).toBeUndefined();

		const checkpoint = g.checkpoint();
		expect(checkpoint.nodes.find((n) => n.id === "src")?.version).toEqual({
			level: 1,
			counter: 1,
			cid: "h:2",
			prev: "h:1",
		});
		expect(checkpoint.nodes.find((n) => n.id === "v0")?.version).toEqual({
			level: 0,
			counter: 1,
		});
		expect(checkpoint.nodes.find((n) => n.id === "disabled")?.version).toBeUndefined();

		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/matching node versioning policy/,
		);
		const restored = restoreGraph(checkpoint, {
			registry: defaultRestoreRegistry,
			versioning: { level: 1, hash },
		});
		expect(restored.find("src")?.version).toEqual({
			level: 1,
			counter: 1,
			cid: "h:2",
			prev: "h:1",
		});
		expect(restored.find("v0")?.version).toEqual({ level: 0, counter: 1 });
		expect(restored.find("disabled")?.version).toBeUndefined();

		(restored.find("src") as { set(v: number): void }).set(3);
		expect(restored.find("src")?.version).toEqual({
			level: 1,
			counter: 2,
			cid: "h:3",
			prev: "h:2",
		});
	});

	it("restores mounted fresh graphs from child-local checkpoints without double-prefixing", () => {
		const parent = graph({ name: "parent" });
		parent.state(1, { name: "root" });
		const child = graph({ name: "child" });
		child.state(2, { name: "leaf" });
		parent.mount(child, { at: "child" });

		const checkpoint = parent.checkpoint();
		expect(checkpoint.mounts?.[0].checkpoint.nodes.map((n) => n.id)).toEqual(["leaf"]);
		const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
		expect(restored.describe().subgraphs?.[0].nodes.map((n) => n.id)).toEqual(["child::leaf"]);
		expect(restored.describe().subgraphs?.[0].nodes[0]?.value).toBe(2);
	});

	it("rejects missing refs, local-only factories, unknown restore options, duplicate ids, missing deps, and edge mismatches", () => {
		expectTypeOf<RestoreGraphOptions>().not.toHaveProperty("graph");
		const localOnly = graph();
		const src = localOnly.state(1, { name: "src" });
		localOnly.derived([src], (n) => n, { name: "derived" });
		expect(() =>
			restoreGraph(localOnly.checkpoint(), { registry: defaultRestoreRegistry }),
		).toThrow(/local-only/);

		const missingRef = graph();
		missingRef.state(1, { name: "src" });
		expect(() => restoreGraph(missingRef.checkpoint(), { registry: {} })).toThrow(
			/missing registry/,
		);
		expect(() =>
			restoreGraph(missingRef.checkpoint(), {
				dispatcher: new Dispatcher(),
			} as RestoreGraphOptions),
		).toThrow(/registry is required/);

		const target = graph();
		target.state(0, { name: "untouched" });
		expect(() =>
			restoreGraph(missingRef.checkpoint(), {
				registry: defaultRestoreRegistry,
				graph: target,
			} as unknown as RestoreGraphOptions),
		).toThrow(/unknown option 'graph'/);
		expect(target.find("untouched")?.cache).toBe(0);

		const duplicate = missingRef.checkpoint();
		duplicate.nodes.push({ ...duplicate.nodes[0] });
		expect(() => restoreGraph(duplicate, { registry: defaultRestoreRegistry })).toThrow(
			/duplicate node id/,
		);

		const missingDep = missingRef.checkpoint();
		missingDep.nodes[0].deps = ["nope"];
		expect(() => restoreGraph(missingDep, { registry: defaultRestoreRegistry })).toThrow(
			/missing dep/,
		);

		const edgeMismatch = missingRef.checkpoint();
		edgeMismatch.edges = [{ from: "src", to: "src" }];
		expect(() => restoreGraph(edgeMismatch, { registry: defaultRestoreRegistry })).toThrow(
			/not present in target deps/,
		);

		const terminalMismatch = missingRef.checkpoint();
		terminalMismatch.nodes[0].status = "completed";
		terminalMismatch.nodes[0].terminal = { kind: "none" };
		expect(() => restoreGraph(terminalMismatch, { registry: defaultRestoreRegistry })).toThrow(
			/terminal status requires terminal state/,
		);

		const badMountPrefix = graph();
		const child = graph();
		child.state(1, { name: "leaf" });
		badMountPrefix.mount(child, { at: "child" });
		const badMountCheckpoint = badMountPrefix.checkpoint();
		if (badMountCheckpoint.mounts)
			badMountCheckpoint.mounts[0].checkpoint.nodes[0].id = "child::leaf";
		expect(() => restoreGraph(badMountCheckpoint, { registry: defaultRestoreRegistry })).toThrow(
			/child-local node id/,
		);
	});

	it("rejects descriptor output whose registered deps do not match the checkpoint", () => {
		const original = graph();
		const src = original.state(1, { name: "src" });
		const memo = original.node([src], (ctx) => ctx.down([["DATA", depLatest(ctx, 0)]]), {
			name: "memo",
			restore: { ref: "memo" },
		});
		collect(memo);

		const badDescriptor: GraphRestoreDescriptor = {
			ref: "memo",
			create(ctx) {
				return ctx.registerNode("memo", [], (runCtx) => {
					runCtx.down([["DATA", "bad"]]);
				});
			},
		};

		expect(() =>
			restoreGraph(original.checkpoint(), {
				registry: { ...defaultRestoreRegistry, memo: badDescriptor },
			}),
		).toThrow(/deps that do not match/);
	});
});
