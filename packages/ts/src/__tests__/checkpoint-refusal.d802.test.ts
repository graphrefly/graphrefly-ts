/**
 * R-checkpoint@1 (graphrefly:D802): refusals read `not restorable: <node id>: <reason>` in every
 * package, never a raw JSON or serializer error. A local-only node fails at restore; a node whose
 * private state, retained values, recipe config or ERROR payload is not JSON fails at capture.
 * Also the optional recipe of `g.derived`, `g.effect` and `g.producer`: restore takes only the
 * value-level callback from the registry and rebuilds the node with the same sugar and gate.
 */
import { describe, expect, it } from "vitest";
import type { NodeFn } from "../ctx/types.js";
import type { GraphRecipeFactory, GraphSugarRecipeFactory } from "../graph/restore.js";
import {
	defaultRestoreRegistry,
	type Graph,
	graph,
	type Message,
	type Node,
	restoreGraph,
	type StateNode,
} from "../index.js";

function collect(n: Node<unknown> | undefined): Message[] {
	if (n === undefined) throw new Error("collect: missing node");
	const msgs: Message[] = [];
	n.subscribe((incoming) => {
		for (const m of incoming) if (m[0] !== "PENDING") msgs.push(m);
	});
	return msgs;
}

/** The exact message a call is refused with. */
function refusal(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		return (error as Error).message;
	}
	throw new Error("expected a refusal");
}

const asState = <T>(n: Node<unknown> | undefined) => n as unknown as StateNode<T>;

describe("refusal text: not restorable: <node id>: <reason>", () => {
	it("restore refuses a computed node built without a recipe", () => {
		const g = graph();
		const src = g.state(1, { name: "src" });
		collect(g.derived([src], (n: number) => n + 1, { name: "plus" }));
		// Capture saves a local-only node; it is refused at restore, not at capture.
		const checkpoint = g.checkpoint();
		expect(checkpoint.nodes.find((n) => n.id === "plus")?.recipe).toBeUndefined();
		expect(refusal(() => restoreGraph(checkpoint, { registry: defaultRestoreRegistry }))).toBe(
			"not restorable: plus: local-only, built or replaced without a recipe",
		);
	});

	it("restore refuses a node replaced without a recipe", () => {
		const fn: NodeFn = (ctx) => ctx.down([["DATA", ctx.deps[0].value]]);
		const registry = {
			same: { ref: "same", build: () => ({ fn }) } satisfies GraphRecipeFactory,
		};
		const g = graph();
		const a = g.state(1, { name: "a" });
		const n = g.node([a], fn, { name: "n", recipe: { ref: "same" } });
		g.replace(n, [a], fn);
		expect(refusal(() => restoreGraph(g.checkpoint(), { registry }))).toBe(
			"not restorable: n: local-only, built or replaced without a recipe",
		);
	});

	it("capture refuses private state that is not JSON", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		collect(
			g.node(
				[a],
				(ctx) => {
					ctx.state.set(new Map());
					ctx.down([["DATA", 1]]);
				},
				{ name: "s", recipe: { ref: "s" } },
			),
		);
		expect(refusal(() => g.checkpoint())).toBe("not restorable: s: its private state is not JSON");
	});

	it("capture refuses a recipe config that is not JSON, active or not", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		g.derived([a], (n: number) => n, {
			name: "d",
			recipe: { ref: "d", config: { k: Number.NaN } },
		});
		expect(refusal(() => g.checkpoint())).toBe("not restorable: d: its recipe config is not JSON");
		const node = graph();
		const b = node.state(1, { name: "b" });
		collect(
			node.node([b], (ctx) => ctx.down([["DATA", 1]]), {
				name: "n",
				recipe: { ref: "n", config: { at: new Date(0) } },
			}),
		);
		expect(refusal(() => node.checkpoint())).toBe(
			"not restorable: n: its recipe config is not JSON",
		);
	});

	it("capture refuses retained values that are not JSON, held or received", () => {
		const held = graph();
		held.state<unknown>(new Map(), { name: "m" });
		expect(refusal(() => held.checkpoint())).toBe(
			"not restorable: m: its retained values are not JSON",
		);

		const computed = graph();
		const a = computed.state(1, { name: "a" });
		collect(computed.node([a], (ctx) => ctx.down([["DATA", 1n]]), { name: "big" }));
		expect(refusal(() => computed.checkpoint())).toBe(
			"not restorable: big: its retained values are not JSON",
		);
	});

	it("capture refuses an ERROR payload that is not JSON", () => {
		const g = graph();
		g.state(1, { name: "e" }).error(new Error("boom"));
		expect(refusal(() => g.checkpoint())).toBe("not restorable: e: its ERROR payload is not JSON");

		const computed = graph();
		const a = computed.state(1, { name: "a" });
		collect(
			computed.node([a], (ctx) => ctx.down([["ERROR", () => "not json"]]), {
				name: "fails",
				recipe: { ref: "fails" },
				error: "manual",
			}),
		);
		expect(refusal(() => computed.checkpoint())).toBe(
			"not restorable: fails: its ERROR payload is not JSON",
		);
	});
});

describe("an optional recipe on derived, effect and producer", () => {
	type Calls = { double: number };
	const doubleFactory = (calls: Calls) =>
		({
			ref: "double",
			validateConfig: (config) => config as { factor: number },
			build: (config: { factor: number }) => ({
				fn: (v: number) => {
					calls.double++;
					return v * config.factor;
				},
			}),
		}) satisfies GraphSugarRecipeFactory<{ factor: number }>;

	function build(calls: Calls): { g: Graph; a: StateNode<number>; d: Node<number> } {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const d = g.derived(
			[a],
			(v: number) => {
				calls.double++;
				return v * 2;
			},
			{ name: "d", recipe: { ref: "double", config: { factor: 2 } } },
		);
		return { g, a, d };
	}

	it("saves the recipe with its sugar and restores the derived through the same sugar", () => {
		const calls = { double: 0 };
		const { g, d } = build(calls);
		collect(d);
		const checkpoint = g.checkpoint();
		expect(checkpoint.nodes.find((n) => n.id === "d")?.recipe).toEqual({
			ref: "double",
			config: { factor: 2 },
			sugar: "derived",
		});
		const restoredCalls = { double: 0 };
		const r = restoreGraph(checkpoint, { registry: { double: doubleFactory(restoredCalls) } });
		const msgs = collect(r.find("d"));
		// Nothing changed since capture: the function does not run, the value is kept.
		expect(restoredCalls.double).toBe(0);
		expect(msgs).toEqual([["START"], ["DATA", 2]]);
		asState<number>(r.find("a")).set(5);
		expect(restoredCalls.double).toBe(1);
		expect(r.find("d")?.cache).toBe(10);
		// Captured again, the restored node keeps its recipe and sugar.
		expect(r.checkpoint().nodes.find((n) => n.id === "d")?.recipe).toEqual({
			ref: "double",
			config: { factor: 2 },
			sugar: "derived",
		});
	});

	it("a restored derived whose dependency only completed does not compute again", () => {
		const calls = { double: 0 };
		const { g, d } = build(calls);
		collect(d);
		const checkpoint = g.checkpoint();
		const restoredCalls = { double: 0 };
		const r = restoreGraph(checkpoint, { registry: { double: doubleFactory(restoredCalls) } });
		// The dependency ends with no new value: the restored first run sees only its COMPLETE.
		asState<number>(r.find("a")).complete();
		const msgs = collect(r.find("d"));
		expect(restoredCalls.double).toBe(0);
		expect(r.find("d")?.cache).toBe(2);
		expect(msgs).toEqual([["START"], ["DATA", 2], ["COMPLETE"]]);
		expect(r.find("d")?.status.output).toBe("completed");
	});

	it("a live derived whose dependency only completed does not compute again either", () => {
		const calls = { double: 0 };
		const { a, d } = build(calls);
		const msgs = collect(d);
		expect(calls.double).toBe(1);
		a.complete();
		expect(calls.double).toBe(1);
		expect(msgs).toEqual([["START"], ["DATA", 2], ["COMPLETE"]]);
	});

	it("the restored derived keeps the gate: it waits until every dependency has a value", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state<number>(undefined as unknown as number, { name: "b" });
		g.derived([a, b], (x: number, y: number) => x + y, {
			name: "sum",
			recipe: { ref: "sum" },
		});
		const calls = { sum: 0 };
		const registry = {
			sum: {
				ref: "sum",
				build: () => ({
					fn: (x: number, y: number) => {
						calls.sum++;
						return x + y;
					},
				}),
			} satisfies GraphSugarRecipeFactory,
		};
		const r = restoreGraph(g.checkpoint(), { registry });
		const msgs = collect(r.find("sum"));
		expect(calls.sum).toBe(0);
		expect(msgs).toEqual([["START"]]);
		asState<number>(r.find("b")).set(4);
		expect(calls.sum).toBe(1);
		expect(r.find("sum")?.cache).toBe(5);
	});

	it("restores a producer and an effect from their registered callbacks", () => {
		const g = graph();
		const src = g.producer((ctx) => ctx.down([["DATA", 7]]), {
			name: "src",
			recipe: { ref: "seven" },
		});
		const seen: number[] = [];
		g.effect([src], (v) => void seen.push(v as number), { name: "log", recipe: { ref: "log" } });
		const checkpoint = g.checkpoint();
		expect(checkpoint.nodes.map((n) => n.recipe)).toEqual([
			{ ref: "seven", sugar: "producer" },
			{ ref: "log", sugar: "effect" },
		]);
		const restoredSeen: number[] = [];
		const cleanups = { count: 0 };
		const r = restoreGraph(checkpoint, {
			registry: {
				seven: {
					ref: "seven",
					build: () => ({ fn: ((ctx) => ctx.down([["DATA", 8]])) satisfies NodeFn }),
				} satisfies GraphSugarRecipeFactory,
				log: {
					ref: "log",
					build: () => ({
						fn: (v: number) => {
							restoredSeen.push(v);
							return () => {
								cleanups.count++;
							};
						},
					}),
				} satisfies GraphSugarRecipeFactory,
			},
		});
		const release = r.retain("log");
		expect(restoredSeen).toEqual([8]);
		release();
		// The effect's sugar runs the latest run's cleanup when the lifetime closes.
		expect(cleanups.count).toBe(1);
	});

	it("refuses a registry factory that gives a setup for a sugar node", () => {
		const { g } = build({ double: 0 });
		const registry = {
			double: {
				ref: "double",
				build: () => ({ fn: (v: number) => v, setup: () => undefined }),
			} as unknown as GraphRecipeFactory,
		};
		expect(refusal(() => restoreGraph(g.checkpoint(), { registry }))).toBe(
			"not restorable: d: its derived recipe 'double' gives a setup; a derived takes none",
		);
	});

	it("refuses a sugar node that has both a recipe and a setup", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		expect(() =>
			g.derived([a], (v) => v, { recipe: { ref: "id" }, setup: () => undefined }),
		).toThrow(
			"derived: a node with a recipe takes no setup; the restored node could not rebuild it",
		);
		expect(() =>
			g.effect([a], () => undefined, { recipe: { ref: "e" }, setup: () => undefined }),
		).toThrow("effect: a node with a recipe takes no setup");
	});
});
