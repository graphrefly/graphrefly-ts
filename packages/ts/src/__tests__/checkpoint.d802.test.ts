/**
 * R-checkpoint@1 (graphrefly:D802), scenario C-38, and the TS checkpoint layout
 * (graphrefly-ts:D178): capture at a wave boundary, restore into a new graph, the restored first
 * activation, recipes on the instance, lifetime dependencies, ended nodes and refusals.
 */
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Ctx, NodeFn } from "../ctx/types.js";
import { renderSnapshot } from "../graph/render.js";
import { mountGraph } from "../graph/topology.js";
import type {
	GraphRecipeFactory,
	GraphRestoreRegistry,
	Message,
	RestoreGraphOptions,
} from "../index.js";
import {
	Dispatcher,
	defaultRestoreRegistry,
	define,
	type Graph,
	graph,
	map,
	type Node,
	reactiveIndex,
	reactiveList,
	reactiveLog,
	reactiveMap,
	restoreGraph,
	restoreRegistry,
	type StateNode,
	take,
	timer,
} from "../index.js";
import { checkpointStateOfNode } from "../node/runtime-accessors.js";

afterEach(() => {
	vi.useRealTimers();
});

const stops = new WeakMap<Message[], () => void>();
function collect(n: Node<unknown> | undefined): Message[] {
	const msgs: Message[] = [];
	if (n === undefined) throw new Error("collect: missing node");
	stops.set(
		msgs,
		n.subscribe((incoming) => {
			for (const m of incoming) msgs.push(m);
		}),
	);
	return msgs;
}
const stop = (msgs: Message[]) => stops.get(msgs)?.();
/** The graph ids of nodes (graph-registered nodes carry no name of their own). */
const ids = (g: Graph, nodes: readonly Node<unknown>[] | undefined) =>
	(nodes ?? []).map((n) => renderSnapshot(g).nodes.find((d) => g.find(d.id) === n)?.id);
const types = (msgs: readonly Message[]) => msgs.map((m) => m[0]);
const asState = <T>(n: Node<unknown> | undefined) => n as unknown as StateNode<T>;
const privateStateOf = (n: Node<unknown> | undefined) =>
	checkpointStateOfNode(n as Node<unknown>).privateState;

/** The C-38 topology, with counters for what ran. */
function c38() {
	const counts = { p: 0, ended: 0, rew: 0, tick: 0, timersStarted: 0, timersStopped: 0 };
	const pInputs: { waves: readonly unknown[] | null; terminal: unknown; invalidated: boolean }[] =
		[];
	// p over a, with private state counting its runs; a value of 0 sends nothing.
	const pFn: NodeFn = (ctx) => {
		counts.p++;
		pInputs.push({
			waves: ctx.deps[0].waves.length === 0 ? null : ctx.deps[0].waves.flat(),
			terminal: ctx.deps[0].terminal,
			invalidated: ctx.deps[0].invalidated,
		});
		const runs = (ctx.state.get<{ runs: number }>()?.runs ?? 0) + 1;
		ctx.state.set({ runs });
		const v = (ctx.deps[0].waves.length === 0 ? null : ctx.deps[0].waves.flat())?.at(-1);
		if (typeof v === "number" && v !== 0) ctx.down([["DATA", v * 10]]);
	};
	// ended over a: sends a value and completes on its first run, after setting private state.
	const endedFn: NodeFn = (ctx) => {
		counts.ended++;
		ctx.state.set({ seen: true });
		ctx.down([["DATA", (ctx.deps[0].value as number) + 100], ["COMPLETE"]]);
	};
	// rew declares a and rewires itself onto a and b for its lifetime.
	let b: Node<unknown> | undefined;
	const rewFn: NodeFn = (ctx) => {
		counts.rew++;
		const deps = rewDeps();
		if (deps.length === 1 && b !== undefined) ctx.rewire([deps[0], b]);
		let sum = 0;
		for (let i = 0; i < ctx.deps.length; i++) sum += (ctx.deps[i].value as number) ?? 0;
		ctx.down([["DATA", sum]]);
	};
	let rewDepsRef: () => Node<unknown>[] = () => [];
	const rewDeps = () => rewDepsRef();
	// tick: a source whose setup starts a timer that counts in private state.
	const tickSetup = (ctx: Ctx) => {
		counts.timersStarted++;
		const id = setInterval(() => {
			const n = (ctx.state.get<number>() ?? 0) + 1;
			ctx.state.set(n);
			ctx.down([["DATA", n]]);
		}, 10);
		return () => {
			counts.timersStopped++;
			clearInterval(id);
		};
	};
	const tickFn: NodeFn = () => {
		counts.tick++;
	};
	const registry: GraphRestoreRegistry = {
		...defaultRestoreRegistry,
		p: { ref: "p", build: () => ({ fn: pFn }) } satisfies GraphRecipeFactory,
		ended: { ref: "ended", build: () => ({ fn: endedFn }) } satisfies GraphRecipeFactory,
		rew: { ref: "rew", build: () => ({ fn: rewFn }) } satisfies GraphRecipeFactory,
		tick: {
			ref: "tick",
			build: () => ({ fn: tickFn, setup: tickSetup }),
		} satisfies GraphRecipeFactory,
	};
	const build = () => {
		const g = graph({ name: "c38" });
		const a = g.state(1, { name: "a" });
		b = g.state(5, { name: "b" });
		const p = g.node([a], pFn, { name: "p", recipe: { ref: "p" } });
		const ended = g.node([a], endedFn, { name: "ended", recipe: { ref: "ended" } });
		const rew = g.node([a], rewFn, { name: "rew", recipe: { ref: "rew" } });
		rewDepsRef = () => (g.find("rew") as Node<unknown>).deps as Node<unknown>[];
		const tick = g.node([], tickFn, { name: "tick", recipe: { ref: "tick" }, setup: tickSetup });
		return { g, a, b, p, ended, rew, tick };
	};
	const restore = (checkpoint: ReturnType<Graph["checkpoint"]>) => {
		const r = restoreGraph(checkpoint, { registry });
		b = r.find("b");
		rewDepsRef = () => (r.find("rew") as Node<unknown>).deps as Node<unknown>[];
		return r;
	};
	return { counts, pInputs, registry, build, restore };
}

describe("C-38 restore keeps the saved state, refreshes once on a changed input, and reopens what a setup opened", () => {
	function captured() {
		vi.useFakeTimers();
		const f = c38();
		const o = f.build();
		const subs = [collect(o.p), collect(o.ended), collect(o.rew), collect(o.tick)];
		vi.advanceTimersByTime(10);
		expect(o.tick.cache).toBe(1);
		expect(ids(o.g, o.rew.deps)).toEqual(["a", "b"]);
		const checkpoint = o.g.checkpoint();
		for (const s of subs) stop(s);
		const before = { ...f.counts };
		return { f, o, checkpoint, before };
	}

	it("restore runs no function, sends nothing and gives the same topology description", () => {
		const { f, o, checkpoint, before } = captured();
		const r = f.restore(checkpoint);
		expect(f.counts).toEqual(before);
		const shape = (g: Graph) =>
			renderSnapshot(g).nodes.map((n) => ({ id: n.id, factory: n.factory, deps: n.deps }));
		// The live graph's rew went back to its declared dependencies when its lifetime closed; the
		// checkpoint saved the lifetime's.
		expect(shape(r).map((n) => n.id)).toEqual(shape(o.g).map((n) => n.id));
		expect(renderSnapshot(r).edges).toContainEqual({ from: "b", to: "rew" });
		expect(ids(r, r.definition("rew").deps)).toEqual(["a"]);
		for (const id of ["a", "b", "p", "ended", "rew", "tick"])
			expect(checkpointStateOfNode(r.find(id) as Node<unknown>).activated).toBe(false);
	});

	it("the first subscription gets p's saved values and state without p running", () => {
		const { f, checkpoint, before } = captured();
		const r = f.restore(checkpoint);
		const p = collect(r.find("p"));
		expect(p).toEqual([["START"], ["DATA", 10]]);
		expect(privateStateOf(r.find("p"))).toEqual({ runs: 1 });
		expect(f.counts.p).toBe(before.p);
	});

	it("a changed dependency runs p once with only that dependency as input", () => {
		const { f, checkpoint, before } = captured();
		const r = f.restore(checkpoint);
		asState<number>(r.find("a")).set(2);
		const p = collect(r.find("p"));
		expect(f.counts.p).toBe(before.p + 1);
		expect(f.pInputs.at(-1)).toEqual({ waves: [2], terminal: undefined, invalidated: false });
		expect(p).toEqual([["START"], ["DATA", 20]]);
		expect(privateStateOf(r.find("p"))).toEqual({ runs: 2 });
	});

	it("a run that sends nothing keeps the saved value", () => {
		const { f, checkpoint, before } = captured();
		const r = f.restore(checkpoint);
		asState<number>(r.find("a")).set(0);
		const p = collect(r.find("p"));
		expect(f.counts.p).toBe(before.p + 1);
		expect(p).toEqual([["START"], ["DATA", 10]]);
	});

	it("a restored node keeps the function it was built with; only its first run sees ctx.seed", () => {
		// R-invocation@2 / R-subscription@3: the seed's note reaches the seeded instance's first run.
		const seen: boolean[] = [];
		const fn: NodeFn = (ctx) => {
			seen.push(ctx.seed !== undefined);
			ctx.down([["DATA", (ctx.deps[0].value as number) * 2]]);
		};
		const registry: GraphRestoreRegistry = {
			...defaultRestoreRegistry,
			double: { ref: "double", build: () => ({ fn }) } satisfies GraphRecipeFactory,
		};
		const g = graph();
		const a = g.state(1, { name: "a" });
		const live = collect(g.node([a], fn, { name: "d", recipe: { ref: "double" } }));
		const checkpoint = g.checkpoint();
		stop(live);
		expect(seen).toEqual([false]);
		const r = restoreGraph(checkpoint, { registry });
		expect(r.definition("d").fn).toBe(fn);
		asState<number>(r.find("a")).set(2);
		const d = collect(r.find("d"));
		asState<number>(r.find("a")).set(3);
		expect(seen).toEqual([false, true, false]);
		expect(d).toEqual([["START"], ["DATA", 4], ["PENDING"], ["DATA", 6]]);
	});

	it("an INVALIDATE followed by a set before the first subscription is seen as the set alone", () => {
		const { f, checkpoint, before } = captured();
		const r = f.restore(checkpoint);
		const a = asState<number>(r.find("a"));
		a.invalidate();
		a.set(3);
		collect(r.find("p"));
		expect(f.counts.p).toBe(before.p + 1);
		expect(f.pInputs.at(-1)).toEqual({ waves: [3], terminal: undefined, invalidated: false });
		expect(r.find("p")?.cache).toBe(30);
	});

	it("a dependency that only completed brings its COMPLETE without its values again", () => {
		const { f, checkpoint, before } = captured();
		const r = f.restore(checkpoint);
		asState<number>(r.find("a")).complete();
		const p = collect(r.find("p"));
		expect(f.counts.p).toBe(before.p + 1);
		// No values: the terminal alone is the input.
		expect(f.pInputs.at(-1)).toEqual({
			waves: null,
			terminal: { kind: "complete" },
			invalidated: false,
		});
		expect(p).toEqual([["START"], ["DATA", 10], ["COMPLETE"]]);
	});

	it("an ended node comes back ended with its dependencies and without private state", () => {
		const { f, o, checkpoint } = captured();
		expect(o.ended.status.output).toBe("completed");
		const r = f.restore(checkpoint);
		const ended = r.find("ended");
		expect(ended?.status.output).toBe("completed");
		expect(ids(r, ended?.deps)).toEqual(["a"]);
		expect(privateStateOf(ended)).toBeUndefined();
		expect(collect(ended)).toEqual([["START"], ["DATA", 101], ["COMPLETE"]]);
		expect(f.counts.ended).toBe(1);
	});

	it("the rewired node is restored onto its lifetime's dependencies", () => {
		const { f, checkpoint, before } = captured();
		const r = f.restore(checkpoint);
		const rew = r.find("rew") as Node<unknown>;
		expect(ids(r, rew.deps)).toEqual(["a", "b"]);
		const msgs = collect(rew);
		expect(msgs).toEqual([["START"], ["DATA", 6]]);
		expect(f.counts.rew).toBe(before.rew);
		asState<number>(r.find("b")).set(7);
		expect(rew.cache).toBe(8);
		stop(msgs);
		// The lifetime closed: its dependencies go back to the declared ones (R-lifetime).
		expect(ids(r, rew.deps)).toEqual(["a"]);
	});

	it("the timer source's setup starts one timer at its first activation and counts on", () => {
		const { f, checkpoint, before } = captured();
		const r = f.restore(checkpoint);
		const tick = collect(r.find("tick"));
		expect(f.counts.timersStarted).toBe(before.timersStarted + 1);
		expect(f.counts.tick).toBe(before.tick);
		expect(tick).toEqual([["START"], ["DATA", 1]]);
		vi.advanceTimersByTime(10);
		expect(tick.at(-1)).toEqual(["DATA", 2]);
		stop(tick);
		expect(f.counts.timersStopped).toBe(before.timersStopped + 1);
	});

	it("a restored graph captured again before anything subscribes restores to the same state", () => {
		const { f, checkpoint, before } = captured();
		const again = f.restore(checkpoint).checkpoint();
		expect(again).toEqual(checkpoint);
		const r = f.restore(again);
		expect(collect(r.find("p"))).toEqual([["START"], ["DATA", 10]]);
		expect(privateStateOf(r.find("p"))).toEqual({ runs: 1 });
		expect(f.counts.p).toBe(before.p);
	});

	it("no checkpoint carries revision or version evidence", () => {
		const { checkpoint } = captured();
		const text = JSON.stringify(checkpoint);
		expect(text).not.toMatch(/"version"|"revision"|"cid"|"configVersion"/);
		expect(checkpoint.format).toBe("graphrefly-ts/checkpoint@1");
	});

	it("captures inside a wave or a batch body are refused", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		let inWave: unknown;
		const probe = g.node(
			[a],
			(ctx) => {
				try {
					g.checkpoint();
				} catch (error) {
					inWave = error;
				}
				ctx.down([["DATA", 1]]);
			},
			{ name: "probe" },
		);
		collect(probe);
		expect(String(inWave)).toMatch(/wave boundary/);
		g.batch(() => {
			a.set(2);
			expect(() => g.checkpoint()).toThrow(/wave boundary/);
		});
		expect(() => g.checkpoint()).not.toThrow();
	});

	it("values, private state and ERROR payloads that are not JSON are refused", () => {
		const values = graph();
		values.state<unknown>(new Map(), { name: "m" });
		expect(() => values.checkpoint()).toThrow(
			"not restorable: m: its retained values are not JSON",
		);

		const state = graph();
		const a = state.state(1, { name: "a" });
		collect(
			state.node(
				[a],
				(ctx) => {
					ctx.state.set(new Map());
					ctx.down([["DATA", 1]]);
				},
				{ name: "s", recipe: { ref: "s" } },
			),
		);
		expect(() => state.checkpoint()).toThrow("not restorable: s: its private state is not JSON");

		const errored = graph();
		errored.state(1, { name: "e" }).error(new Error("boom"));
		expect(() => errored.checkpoint()).toThrow("not restorable: e: its ERROR payload is not JSON");

		const jsonError = graph();
		jsonError.state(1, { name: "e" }).error({ code: "boom" });
		const r = restoreGraph(jsonError.checkpoint(), { registry: {} });
		expect(collect(r.find("e"))).toEqual([["START"], ["DATA", 1], ["ERROR", { code: "boom" }]]);
	});

	it("a missing recipe, a local-only node and a checkpoint without received records fail", () => {
		const { f, checkpoint } = captured();
		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			"not restorable: p: missing recipe",
		);

		const local = graph();
		const src = local.state(1, { name: "src" });
		local.derived([src], (n) => n, { name: "derived" });
		expect(() => restoreGraph(local.checkpoint(), { registry: defaultRestoreRegistry })).toThrow(
			"not restorable: derived: local-only, built or replaced without a recipe",
		);

		// The user's Q5: the tag names the package; any other tag is refused and not migrated.
		for (const format of [
			"graphrefly.checkpoint.v1",
			"graphrefly.checkpoint.v2",
			"graphrefly-rs/checkpoint@1",
		]) {
			const other = { ...checkpoint, format } as unknown as typeof checkpoint;
			expect(() => f.restore(other), format).toThrow(/format/);
		}
		const noReceived = structuredClone(checkpoint);
		const p = noReceived.nodes.find((n) => n.id === "p");
		if (p?.lifetime == null) throw new Error("p has no lifetime");
		for (const malformed of [{}, null, { values: [] }, { terminal: { kind: "none" } }]) {
			(p.lifetime as { received: unknown[] }).received = [malformed];
			expect(() => f.restore(noReceived)).toThrow("not restorable: p: missing received records");
		}
		delete (p.lifetime as { received?: unknown }).received;
		expect(() => f.restore(noReceived)).toThrow("not restorable: p: missing received records");
		delete p.lifetime;
		expect(() => f.restore(noReceived)).toThrow("not restorable: p: missing received records");
	});

	it("replace: without a recipe local-only, with a recipe and setup that recipe, onto a later dependency", () => {
		const fn: NodeFn = (ctx) => ctx.down([["DATA", ctx.deps[0].value]]);
		const setups = { count: 0 };
		const registry: GraphRestoreRegistry = {
			...defaultRestoreRegistry,
			old: { ref: "old", build: () => ({ fn }) } satisfies GraphRecipeFactory,
			next: {
				ref: "next",
				build: () => ({
					fn,
					setup: () => {
						setups.count++;
					},
				}),
			} satisfies GraphRecipeFactory,
		};
		const g = graph();
		const a = g.state(1, { name: "a" });
		const n = g.node([a], fn, { name: "n", recipe: { ref: "old" } });
		collect(n);
		// Same dependencies, another function, no recipe: local-only, not restored as "old".
		g.replace(n, [a], (ctx) => ctx.down([["DATA", 99]]));
		expect(() => restoreGraph(g.checkpoint(), { registry })).toThrow(
			"not restorable: n: local-only, built or replaced without a recipe",
		);
		// Another recipe and setup, onto a dependency made after the node.
		const later = g.state(7, { name: "later" });
		g.replace(n, [later], fn, { recipe: { ref: "next" }, setup: () => {} });
		const checkpoint = g.checkpoint();
		expect(checkpoint.nodes.map((x) => x.id)).toEqual(["a", "n", "later"]);
		const r = restoreGraph(checkpoint, { registry });
		expect(r.definition("n").recipe).toEqual({ ref: "next" });
		expect(ids(r, r.find("n")?.deps)).toEqual(["later"]);
		collect(r.find("n"));
		expect(setups.count).toBe(1);
		expect(r.find("n")?.cache).toBe(7);
	});
});

describe("checkpoint and restore: ported cases (TS layout, graphrefly-ts:D178)", () => {
	it("restores named state values and pushes them on subscribe", () => {
		const g = graph({ name: "source" });
		const count = g.state(0, { name: "count", meta: { role: "counter" } });
		count.set(7);
		const restored = restoreGraph(g.checkpoint(), { registry: defaultRestoreRegistry });
		expect(restored.find("count")?.cache).toBe(7);
		expect(renderSnapshot(restored).nodes.find((n) => n.id === "count")).toMatchObject({
			id: "count",
			name: "count",
			factory: "state",
			value: 7,
			meta: { role: "counter" },
		});
		expect(collect(restored.find("count"))).toEqual([["START"], ["DATA", 7]]);
	});

	it("keeps no value apart from null and an empty array", () => {
		const g = graph();
		g.node([], null, { name: "cold" });
		g.state(null, { name: "nil" });
		g.state<unknown[]>([], { name: "empty" });
		const checkpoint = g.checkpoint();
		expect(checkpoint.nodes.map((n) => n.values)).toEqual([[], [null], [[]]]);
		const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
		expect(restored.find("cold")?.cache).toBeUndefined();
		expect(collect(restored.find("cold"))).toEqual([["START"]]);
		expect(restored.find("nil")?.cache).toBeNull();
		expect(restored.find("empty")?.cache).toEqual([]);
	});

	it("restores a named function map using define", () => {
		const original = graph();
		const src = original.state(1, { name: "src" });
		const inc = define<number, number>("inc", (n) => n + 1);
		collect(original.initNode(map(inc), [src], { name: "mapped" }));
		const checkpoint = original.checkpoint();
		expect(checkpoint.nodes.find((n) => n.id === "mapped")?.recipe).toEqual({
			ref: "map",
			config: { fn: "inc" },
		});
		const reloaded = define<number, number>("inc", (n) => n + 10);
		const restored = restoreGraph(checkpoint, {
			registry: restoreRegistry([reloaded], defaultRestoreRegistry),
		});
		expect(restored.find("mapped")?.cache).toBe(2);
		collect(restored.find("mapped"));
		asState<number>(restored.find("src")).set(2);
		expect(restored.find("mapped")?.cache).toBe(12);
	});

	it("a dependency that ended before the checkpoint does not reopen or rerun its dependent", () => {
		let runs = 0;
		const fn: NodeFn = (ctx) => {
			runs++;
			ctx.down([["DATA", ctx.deps[0].value as number]]);
		};
		const original = graph();
		const src = original.state(1, { name: "src" });
		collect(
			original.node([src], fn, { name: "memo", recipe: { ref: "memo" }, complete: "manual" }),
		);
		src.complete();
		const restored = restoreGraph(original.checkpoint(), {
			registry: { memo: { ref: "memo", build: () => ({ fn }) } satisfies GraphRecipeFactory },
		});
		const before = runs;
		expect(types(collect(restored.find("memo")))).toEqual(["START", "DATA"]);
		expect(runs).toBe(before);
		expect(restored.find("memo")?.cache).toBe(1);
	});

	it("a node that had no lifetime is saved holding nothing and runs fresh", () => {
		const original = graph();
		original.node([], (ctx) => ctx.down([["DATA", 1]]), {
			name: "src",
			recipe: { ref: "coldSource" },
		});
		original.node(
			[original.find("src") as Node<unknown>],
			(ctx) => ctx.down([["DATA", (ctx.deps[0].value as number) + 1]]),
			{ name: "mapped", recipe: { ref: "mapped" } },
		);
		const checkpoint = original.checkpoint();
		expect(checkpoint.nodes.every((n) => n.lifetime == null && n.values.length === 0)).toBe(true);
		const restored = restoreGraph(checkpoint, {
			registry: {
				coldSource: {
					ref: "coldSource",
					build: () => ({ fn: (ctx) => ctx.down([["DATA", 1]]) }),
				} satisfies GraphRecipeFactory,
				mapped: {
					ref: "mapped",
					build: () => ({
						fn: (ctx) => ctx.down([["DATA", (ctx.deps[0].value as number) + 1]]),
					}),
				} satisfies GraphRecipeFactory,
			},
		});
		expect(collect(restored.find("mapped"))).toEqual([["START"], ["DATA", 2]]);
	});

	it("a node rewired after restore and before its first activation runs fresh", () => {
		const original = graph();
		const src = original.state(1, { name: "src" });
		const inc = define<number, number>("restore-rewire.inc", (n) => n + 1);
		collect(original.initNode(map(inc), [src], { name: "mapped" }));
		const restored = restoreGraph(original.checkpoint(), {
			registry: restoreRegistry([inc], defaultRestoreRegistry),
		});
		const src2 = restored.state(10, { name: "src2" });
		const mapped = restored.find("mapped") as Node<unknown>;
		restored.replace(mapped, [src2], (ctx) => ctx.down([["DATA", 11]]));
		expect(collect(mapped)).toEqual([["START"], ["DATA", 11]]);
	});

	it("keeps an inline map local-only while built-in operators carry recipes", () => {
		const g = graph();
		const src = g.state(1, { name: "src" });
		g.initNode(
			map((n: number) => n + 1),
			[src],
			{ name: "inline" },
		);
		g.initNode(take<number>(2), [src], { name: "limited" });
		g.initNode(take<number>(1), [src], { name: "optOut", recipe: undefined });
		g.initNode(timer(5), [], { name: "once" });
		const recipes = Object.fromEntries(g.checkpoint().nodes.map((n) => [n.id, n.recipe]));
		expect(recipes).toEqual({
			src: undefined,
			inline: undefined,
			limited: { ref: "take", config: { n: 2 } },
			optOut: undefined,
			once: { ref: "timer", config: { ms: 5 } },
		});
		expect(() => restoreGraph(g.checkpoint(), { registry: defaultRestoreRegistry })).toThrow(
			/local-only/,
		);
	});

	it("restores built-in take and timer recipes", () => {
		vi.useFakeTimers();
		const g = graph();
		const src = g.state(1, { name: "src" });
		collect(g.initNode(take<number>(2), [src], { name: "limited" }));
		g.initNode(timer(7), [], { name: "once" });
		const restored = restoreGraph(g.checkpoint(), { registry: defaultRestoreRegistry });
		const limited = collect(restored.find("limited"));
		expect(limited).toEqual([["START"], ["DATA", 1]]);
		asState<number>(restored.find("src")).set(2);
		expect(restored.find("limited")?.cache).toBe(2);
		const once = collect(restored.find("once"));
		vi.advanceTimersByTime(7);
		expect(once.filter((m) => m[0] !== "PENDING")).toEqual([["START"], ["DATA", 0], ["COMPLETE"]]);
	});

	it("uses the dispatcher option for the restored graph", () => {
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
		collect(restored.find("mapped"));
		asState<number>(restored.find("src")).set(2);
		expect(restored.find("mapped")?.cache).toBe(3);
		expect(dispatcher.totalInvokes).toBeGreaterThan(0);
	});

	it("restores COMPLETE and ERROR without reopening ended nodes", () => {
		const g = graph();
		g.state(1, { name: "done" }).complete();
		g.state(2, { name: "failed" }).error("boom");
		const restored = restoreGraph(g.checkpoint(), { registry: defaultRestoreRegistry });
		expect(collect(restored.find("done"))).toEqual([["START"], ["DATA", 1], ["COMPLETE"]]);
		expect(collect(restored.find("failed"))).toEqual([["START"], ["DATA", 2], ["ERROR", "boom"]]);
		expect(restored.find("done")?.status.output).toBe("completed");
	});

	it("restores mounted graphs from child-local checkpoints", () => {
		const parent = graph({ name: "parent" });
		parent.state(1, { name: "root" });
		const child = graph({ name: "child" });
		child.state(2, { name: "leaf" });
		mountGraph(parent, child, { at: "child" });
		const checkpoint = parent.checkpoint();
		expect(checkpoint.mounts?.[0].checkpoint.nodes.map((n) => n.id)).toEqual(["leaf"]);
		const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
		expect(renderSnapshot(restored).subgraphs?.[0].nodes.map((n) => n.id)).toEqual(["child::leaf"]);
		expect(renderSnapshot(restored).subgraphs?.[0].nodes[0]?.value).toBe(2);
	});

	it("rejects bad options, duplicate ids, missing dependencies and bad mount ids", () => {
		expectTypeOf<RestoreGraphOptions>().not.toHaveProperty("graph");
		const g = graph();
		g.state(1, { name: "src" });
		expect(() =>
			restoreGraph(g.checkpoint(), { dispatcher: new Dispatcher() } as RestoreGraphOptions),
		).toThrow(/registry is required/);
		expect(() =>
			restoreGraph(g.checkpoint(), {
				registry: defaultRestoreRegistry,
				graph: graph(),
			} as unknown as RestoreGraphOptions),
		).toThrow(/unknown option 'graph'/);
		const duplicate = g.checkpoint();
		duplicate.nodes.push({ ...duplicate.nodes[0] });
		expect(() => restoreGraph(duplicate, { registry: defaultRestoreRegistry })).toThrow(
			/duplicate node id/,
		);
		const limited = graph();
		const s = limited.state(1, { name: "src" });
		limited.initNode(take<number>(1), [s], { name: "limited" });
		const missingDep = limited.checkpoint();
		missingDep.nodes[1].deps = ["nope"];
		expect(() => restoreGraph(missingDep, { registry: defaultRestoreRegistry })).toThrow(
			/missing dep 'nope'/,
		);
		const parent = graph();
		const child = graph();
		child.state(1, { name: "leaf" });
		mountGraph(parent, child, { at: "child" });
		const badMount = parent.checkpoint();
		if (badMount.mounts) badMount.mounts[0].checkpoint.nodes[0].id = "child::leaf";
		expect(() => restoreGraph(badMount, { registry: defaultRestoreRegistry })).toThrow(
			/child-local node id/,
		);
		const emptyMount = parent.checkpoint();
		if (emptyMount.mounts) emptyMount.mounts[0].at = "";
		expect(() => restoreGraph(emptyMount, { registry: defaultRestoreRegistry })).toThrow(
			/mount path must not be empty/,
		);
	});

	it("rejects a restore extension whose node has other dependencies than the checkpoint", () => {
		const g = graph();
		reactiveList<number>(g, [1], { name: "list" });
		const checkpoint = g.checkpoint();
		const snapshot = checkpoint.nodes.find((n) => n.id === "list.snapshot");
		if (snapshot === undefined) throw new Error("missing list snapshot");
		snapshot.deps = ["list.request", "list.delta"];
		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/dependencies that do not match/,
		);
	});
});

describe("collection backends (TS restore extension, graphrefly-ts:D178)", () => {
	it("restores each collection from its backendState", () => {
		const original = graph();
		const list = reactiveList<number>(original, [1], { name: "list" });
		list.append(2);
		const index = reactiveIndex<string, number>(original, { name: "idx" });
		index.upsert("a", 1, 10);
		const log = reactiveLog<string>(original, ["a"], { name: "log" });
		log.append("b");
		const mapCollection = reactiveMap<string, number>(original, { name: "map" });
		mapCollection.set("k", 42);
		const restored = restoreGraph(original.checkpoint(), { registry: defaultRestoreRegistry });
		const byId = Object.fromEntries(restored.checkpoint().nodes.map((n) => [n.id, n]));
		expect(byId["list.delta"].backendState).toEqual([1, 2]);
		expect(byId["idx.delta"].backendState).toEqual([{ primary: "a", secondary: 1, value: 10 }]);
		expect(byId["log.delta"].backendState).toEqual(["a", "b"]);
		expect(byId["map.intent"].backendState).toEqual([["k", 42]]);
		for (const id of ["list.delta", "list.snapshot", "idx.snapshot", "log.snapshot", "map.delta"])
			expect(byId[id].values).toEqual([]);
		expect(byId["map.delta"].deps).toEqual(["map.apply", "map.snapshotPrep"]);
		expect(byId["map.snapshot"].deps).toEqual(["map.snapshotPrep"]);
		expect(types(collect(restored.find("list.delta")))).toEqual(["START"]);
	});

	it("the backend, not a saved snapshot value, is the collection's authority", () => {
		const original = graph();
		reactiveList<number>(original, [1, 2], { name: "list" });
		const checkpoint = original.checkpoint();
		const snapshot = checkpoint.nodes.find((n) => n.id === "list.snapshot");
		if (snapshot === undefined) throw new Error("missing list snapshot");
		snapshot.values = [["not-authority"]];
		const restored = restoreGraph(checkpoint, { registry: defaultRestoreRegistry });
		const byId = Object.fromEntries(restored.checkpoint().nodes.map((n) => [n.id, n]));
		expect(byId["list.delta"].backendState).toEqual([1, 2]);
		expect(byId["list.snapshot"].values).toEqual([]);
	});

	it("rejects malformed index and log backends", () => {
		const original = graph();
		reactiveIndex<string, number>(original, { name: "idx" }).upsert("a", 1, 10);
		reactiveLog<string>(original, ["a", "b"], { name: "log", maxSize: 2 });
		const checkpoint = original.checkpoint();
		const idxDelta = checkpoint.nodes.find((n) => n.id === "idx.delta");
		const logDelta = checkpoint.nodes.find((n) => n.id === "log.delta");
		if (!idxDelta || !logDelta) throw new Error("missing collection nodes");
		idxDelta.backendState = [
			{ primary: "a", secondary: 1, value: 10 },
			{ primary: "a", secondary: 2, value: 20 },
		];
		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/duplicates an earlier index row/,
		);
		idxDelta.backendState = [{ primary: "a", secondary: 1, value: 10 }];
		logDelta.backendState = ["a", "b", "c"];
		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/backendState exceeds config\.maxSize/,
		);
	});

	it("rejects malformed map backends", () => {
		const g = graph();
		reactiveMap<string, number>(g, { name: "map" });
		const checkpoint = g.checkpoint();
		const intent = checkpoint.nodes.find((n) => n.id === "map.intent");
		if (!intent) throw new Error("missing map intent");
		intent.backendState = [["a", 1, "extra"]];
		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/must be a \[key, value\] map entry/,
		);
		intent.backendState = [
			["a", 1],
			["a", 2],
		];
		expect(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry })).toThrow(
			/duplicates an earlier map key/,
		);
	});

	it("refuses a map backend that would lose per-entry TTL or has duplicate JSON keys", () => {
		const ttl = graph();
		reactiveMap<string, number>(ttl, { name: "map" }).set("ttl", 1, { ttl: 1000 });
		expect(() => ttl.checkpoint()).toThrow(/cannot preserve per-entry TTL/);
		const dup = graph();
		const m = reactiveMap<{ id: number }, string>(dup, { name: "map" });
		m.set({ id: 1 }, "first");
		m.set({ id: 1 }, "second");
		expect(() => dup.checkpoint()).toThrow(/duplicate strict-JSON keys/);
	});
});
