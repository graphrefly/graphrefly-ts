/**
 * D817 checkpoint re-port, step 1 (graphrefly-ts:D817): capture and the refusals of capture and
 * restore.
 *
 * TS harness for the refusal clauses of the root scenario C-38 in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-checkpoint@3 (graphrefly:D819, D812): the
 * format marker, capture only at a wave boundary, the first node in creation order that cannot be
 * saved (within one node what is not JSON comes first, then a computed node without a recipe, then
 * a recipe without a non-empty string reference), and restore's refusal of a checkpoint of another
 * format, of a local-only node, of missing received records and of a reference the registry lacks.
 * Some of this is not built yet; those tests fail until it is.
 */

import { describe, expect, it } from "vitest";
import type { Ctx } from "../ctx/types.js";
import type { GraphCheckpoint } from "../graph/checkpoint.js";
import { graph } from "../graph/graph.js";
import { type GraphRestoreRegistry, restoreGraph } from "../graph/restore.js";
import type { Node } from "../node/node.js";
import type { Wave } from "../protocol/messages.js";

type Graph = ReturnType<typeof graph>;

const FORMAT = "graphrefly-ts/checkpoint@2";
const LOCAL = "local-only, built or replaced without a recipe";

/** The message a call is refused with, or "no refusal". */
function refusal(run: () => unknown): string {
	try {
		run();
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
	return "no refusal";
}

const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const keep = (node: Node<unknown>) => node.subscribe(() => {});
const nothing = () => {};

/** Sends its dependency's value plus one. */
const plusOne = (ctx: Ctx) => {
	if (ctx.deps[0]?.has) ctx.down([["DATA", (ctx.deps[0].value as number) + 1]]);
};

/** a = 1, p over a built from the recipe "plus", subscribed. */
function small(calls = { plus: 0 }) {
	const registry: GraphRestoreRegistry = {
		plus: {
			ref: "plus",
			build: () => {
				calls.plus += 1;
				return { fn: plusOne };
			},
		},
	};
	const g = graph();
	const a = g.state(1, { name: "a" });
	const p = g.node<number>([a], plusOne, { name: "p", recipe: { ref: "plus" } });
	keep(p);
	return { g, a, p, registry, calls };
}

describe("C-38 (R-checkpoint@3): the format marker", () => {
	it("C-38 (R-checkpoint@3): a capture is marked graphrefly-ts/checkpoint@2", () => {
		const { g } = small();
		expect(g.checkpoint().format).toBe(FORMAT);
	});

	it("C-38 (R-checkpoint@3): a checkpoint marked with any other format is refused at restore", () => {
		const { g, registry, calls } = small();
		const cp = roundTrip(g.checkpoint());
		calls.plus = 0;
		for (const format of [
			"graphrefly-ts/checkpoint@1",
			"graphrefly-ts/checkpoint@3",
			"graphrefly/checkpoint@2",
			"",
		]) {
			const other = { ...cp, format } as unknown as GraphCheckpoint;
			expect(() => restoreGraph(other, { registry }), format).toThrow();
		}
		const { format: _dropped, ...unmarked } = cp;
		expect(() => restoreGraph(unmarked as unknown as GraphCheckpoint, { registry })).toThrow();
		expect(calls.plus).toBe(0);
		expect(() => restoreGraph(cp, { registry })).not.toThrow();
	});
});

describe("C-38 (R-checkpoint@3): capture is taken only at a wave boundary", () => {
	it("C-38 (R-checkpoint@3): a capture inside a wave is refused; between waves it is taken", () => {
		const { g, a } = small();
		let inside = "not asked";
		const seen: Wave[] = [];
		a.subscribe((msgs) => {
			seen.push(msgs);
			if (msgs.some((m) => m[0] === "DATA" && m[1] === 4)) inside = refusal(() => g.checkpoint());
		});
		a.set(4);
		expect(inside).toMatch(/wave boundary/);
		expect(seen).toEqual([
			[["START"], ["DATA", 1]],
			[["PENDING"], ["DATA", 4]],
		]);
		expect(g.find("p")?.cache).toBe(5);
		expect(() => g.checkpoint()).not.toThrow();
	});

	it("C-38 (R-checkpoint@3): a capture inside a batch body is refused, and the body's writes still commit", () => {
		const { g, a } = small();
		let inside = "not asked";
		g.batch(() => {
			a.set(7);
			inside = refusal(() => g.checkpoint());
		});
		expect(inside).toMatch(/wave boundary/);
		expect(g.find("p")?.cache).toBe(8);
		expect(() => g.checkpoint()).not.toThrow();
	});
});

describe("C-38 (R-checkpoint@3): capture refuses what cannot be saved", () => {
	it("C-38 (R-checkpoint@3): a value, a private state, a recipe configuration and an ERROR payload that are not JSON", () => {
		const value = graph();
		value.state<unknown>(1n, { name: "z" });
		expect(refusal(() => value.checkpoint())).toBe(
			"not restorable: z: its retained values are not JSON",
		);

		const state = graph();
		const a = state.state(1, { name: "a" });
		keep(
			state.node(
				[a],
				(ctx) => {
					ctx.state.set(new Map());
					ctx.down([["DATA", 1]]);
				},
				{ name: "k", recipe: { ref: "k" } },
			),
		);
		expect(refusal(() => state.checkpoint())).toBe(
			"not restorable: k: its private state is not JSON",
		);

		const config = graph();
		const b = config.state(1, { name: "b" });
		config.node([b], plusOne, { name: "x", recipe: { ref: "plus", config: { k: 1n } } });
		expect(refusal(() => config.checkpoint())).toBe(
			"not restorable: x: its recipe config is not JSON",
		);

		const payload = graph();
		payload.state(1, { name: "e" }).error(new Error("boom"));
		expect(refusal(() => payload.checkpoint())).toBe(
			"not restorable: e: its ERROR payload is not JSON",
		);
	});

	it("C-38 (R-checkpoint@3): a computed node built without a recipe is local-only, and capture names it", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		g.node([a], plusOne, { name: "s", recipe: { ref: "plus" } });
		g.node([a], plusOne, { name: "raw" });
		expect(refusal(() => g.checkpoint())).toBe(`not restorable: raw: ${LOCAL}`);
	});

	it("C-38 (R-checkpoint@3): a node replaced without a recipe is local-only, also when it keeps its dependencies and function", () => {
		const g = graph();
		const a = g.state(1, { name: "a" });
		const p = g.node<number>([a], plusOne, { name: "p", recipe: { ref: "plus" } });
		keep(p);
		g.replace(p, [a], plusOne);
		expect(refusal(() => g.checkpoint())).toBe(`not restorable: p: ${LOCAL}`);
		g.replace(p, [a], plusOne, { recipe: { ref: "plus" } });
		expect(() => g.checkpoint()).not.toThrow();
	});

	it("C-38 (R-checkpoint@3): a local-only node holding what is not JSON is refused for that; holding only JSON, as local-only", () => {
		const held = (send: unknown, privateState: unknown) => {
			const g = graph();
			keep(
				g.node(
					[],
					(ctx) => {
						if (privateState !== undefined) ctx.state.set(privateState);
						ctx.down([["DATA", send]]);
					},
					{ name: "n" },
				),
			);
			return refusal(() => g.checkpoint());
		};
		expect(held(1n, undefined)).toBe("not restorable: n: its retained values are not JSON");
		expect(held(1, new Map())).toBe("not restorable: n: its private state is not JSON");
		expect(held(1, { ok: true })).toBe(`not restorable: n: ${LOCAL}`);

		const ended = graph();
		keep(ended.node([], (ctx) => ctx.down([["ERROR", new Error("boom")]]), { name: "n" }));
		expect(refusal(() => ended.checkpoint())).toBe(
			"not restorable: n: its ERROR payload is not JSON",
		);
	});

	it("C-38 (R-checkpoint@3): a local-only node that received what is not JSON is refused for that", () => {
		const g = graph();
		const n = g.node([], nothing, { name: "n" });
		const b = g.state<unknown>(1, { name: "b" });
		g.replace(n, [b], nothing);
		keep(n);
		b.set(1n);
		expect(refusal(() => g.checkpoint())).toBe(
			"not restorable: n: its received values are not JSON",
		);
	});
});

describe("C-38 (R-checkpoint@3): capture names the first node in creation order that cannot be saved", () => {
	const refused = (build: (g: Graph) => void) => {
		const g = graph();
		build(g);
		return refusal(() => g.checkpoint());
	};
	const holdsBigInt = (g: Graph, id: string) =>
		keep(g.node([], (ctx) => ctx.down([["DATA", 1n]]), { name: id, recipe: { ref: "b" } }));
	const localOnly = (g: Graph, id: string) => g.node([], nothing, { name: id });

	it("C-38 (R-checkpoint@3): a local-only node and a node holding a value that is not JSON, in both orders", () => {
		expect(
			refused((g) => {
				localOnly(g, "A");
				holdsBigInt(g, "B");
			}),
		).toBe(`not restorable: A: ${LOCAL}`);
		expect(
			refused((g) => {
				holdsBigInt(g, "B");
				localOnly(g, "A");
			}),
		).toBe("not restorable: B: its retained values are not JSON");
	});

	it("C-38 (R-checkpoint@3): a local-only node and a state holding a value that is not JSON, in both orders", () => {
		expect(
			refused((g) => {
				localOnly(g, "A");
				g.state<unknown>(1n, { name: "z" });
			}),
		).toBe(`not restorable: A: ${LOCAL}`);
		expect(
			refused((g) => {
				g.state<unknown>(1n, { name: "z" });
				localOnly(g, "A");
			}),
		).toBe("not restorable: z: its retained values are not JSON");
	});

	it("C-38 (R-checkpoint@3): a local-only node and a recipe configuration that is not JSON, in both orders", () => {
		const badConfig = (g: Graph) =>
			g.node([], nothing, { name: "B", recipe: { ref: "b", config: { k: 1n } } });
		expect(
			refused((g) => {
				localOnly(g, "A");
				badConfig(g);
			}),
		).toBe(`not restorable: A: ${LOCAL}`);
		expect(
			refused((g) => {
				badConfig(g);
				localOnly(g, "A");
			}),
		).toBe("not restorable: B: its recipe config is not JSON");
	});

	it("C-38 (R-checkpoint@3): a recipe without a non-empty string reference is refused as a missing recipe, no reference after it", () => {
		for (const recipe of [{}, { config: 1 }, { ref: "" }, { ref: 5 }, "name", 0, false, []]) {
			expect(
				refused((g) => {
					g.node([], nothing, { name: "n", recipe });
				}),
				`node: ${JSON.stringify(recipe)}`,
			).toBe("not restorable: n: missing recipe");
			expect(
				refused((g) => {
					const n = g.node([], nothing, { name: "n", recipe: { ref: "x" } });
					g.replace(n, [], nothing, { recipe });
				}),
				`replace: ${JSON.stringify(recipe)}`,
			).toBe("not restorable: n: missing recipe");
		}
	});

	it("C-38 (R-checkpoint@3): a recipe without a reference and a local-only node, in both orders", () => {
		expect(
			refused((g) => {
				g.node([], nothing, { name: "X", recipe: {} });
				localOnly(g, "A");
			}),
		).toBe("not restorable: X: missing recipe");
		expect(
			refused((g) => {
				localOnly(g, "A");
				g.node([], nothing, { name: "X", recipe: {} });
			}),
		).toBe(`not restorable: A: ${LOCAL}`);
	});

	it("C-38 (R-checkpoint@3): a recipe without a reference whose configuration is not JSON is refused for the configuration", () => {
		expect(
			refused((g) => {
				g.node([], nothing, { name: "X", recipe: { config: { k: 1n } } });
			}),
		).toBe("not restorable: X: its recipe config is not JSON");
	});

	it("C-38 (R-checkpoint@3): a node made first that received what is not JSON from a later dependency is the node named", () => {
		expect(
			refused((g) => {
				const n = g.node([], nothing, {
					name: "n",
					recipe: { ref: "b" },
					complete: "manual",
					error: "manual",
				});
				keep(n);
				const late = g.state(1, { name: "late" });
				g.replace(n, [late], nothing, { recipe: { ref: "b" } });
				late.error(new Error("boom"));
			}),
		).toBe("not restorable: n: its ERROR payload is not JSON");
		expect(
			refused((g) => {
				const x = g.node([], nothing, { name: "X", recipe: {} });
				keep(x);
				const late = g.state<unknown>(1, { name: "late" });
				g.replace(x, [late], nothing, { recipe: {} });
				late.set(1n);
			}),
		).toBe("not restorable: X: its received values are not JSON");
	});
});

describe("C-38 (R-checkpoint@3): restore refuses what it cannot build, before any graph is returned", () => {
	/** A checkpoint of a = 1, b = 2, s = a + b and t = a running total of a and b. */
	function sumAndScan() {
		const calls = { sum: 0, scan: 0 };
		const sum = (ctx: Ctx) =>
			ctx.down([
				["DATA", ctx.deps.reduce((s, d) => s + ((d.value as number | undefined) ?? 0), 0)],
			]);
		const scan = (ctx: Ctx) => {
			const got = ctx.deps.flatMap((d) => d.waves.flat()) as number[];
			const acc = got.reduce((s, v) => s + v, ctx.state.get<number>() ?? 0);
			ctx.state.set(acc);
			ctx.down([["DATA", acc]]);
		};
		const registry: GraphRestoreRegistry = {
			sum: {
				ref: "sum",
				build: () => {
					calls.sum += 1;
					return { fn: sum };
				},
			},
			scan: {
				ref: "scan",
				build: () => {
					calls.scan += 1;
					return { fn: scan };
				},
			},
		};
		const g = graph();
		const a = g.state(1, { name: "a" });
		const b = g.state(2, { name: "b" });
		keep(g.node([a, b], sum, { name: "s", recipe: { ref: "sum" } }));
		keep(g.node([a, b], scan, { name: "t", recipe: { ref: "scan" } }));
		a.set(3);
		return { g, registry, calls, cp: roundTrip(g.checkpoint()) };
	}

	it("C-38 (R-checkpoint@3): a recipe reference the registry lacks is refused, naming the node and the reference", () => {
		const { registry, calls, cp } = sumAndScan();
		const { scan: _missing, ...withoutScan } = registry as Record<string, never>;
		calls.sum = 0;
		expect(refusal(() => restoreGraph(cp, { registry: withoutScan }))).toBe(
			"not restorable: t: missing recipe scan",
		);
		expect(calls.sum).toBe(0);
	});

	it("C-38 (R-checkpoint@3): a checkpoint whose recipe has an empty reference is refused as a missing recipe", () => {
		const { registry, cp } = sumAndScan();
		const t = cp.nodes.find((n) => n.id === "t") as { recipe?: { ref: string } };
		if (t.recipe === undefined) throw new Error("t carries its recipe");
		t.recipe.ref = "";
		const withEmpty = { ...registry, "": (registry as Record<string, unknown>).scan };
		expect(refusal(() => restoreGraph(cp, { registry: withEmpty as GraphRestoreRegistry }))).toBe(
			"not restorable: t: missing recipe",
		);
	});

	it("C-38 (R-checkpoint@3): a checkpoint that holds a local-only node, as one written before D812, is refused", () => {
		const { registry, calls, cp } = sumAndScan();
		const t = cp.nodes.find((n) => n.id === "t") as { recipe?: unknown };
		delete t.recipe;
		calls.sum = 0;
		expect(refusal(() => restoreGraph(cp, { registry }))).toBe(`not restorable: t: ${LOCAL}`);
		expect(calls.sum).toBe(0);
	});

	it("C-38 (R-checkpoint@3): a checkpoint without what an open node received, as an earlier format, is refused", () => {
		// TS layout (graphrefly-ts:D178): a computed node's lifetime record holds what it received.
		const { registry, calls, cp } = sumAndScan();
		const s = cp.nodes.find((n) => n.id === "s") as { lifetime?: { received?: unknown } | null };
		const withoutReceived = roundTrip(cp);
		const lifetime = (withoutReceived.nodes.find((n) => n.id === "s") as typeof s).lifetime;
		if (lifetime == null) throw new Error("s was saved with its lifetime");
		delete lifetime.received;
		calls.sum = 0;
		expect(refusal(() => restoreGraph(withoutReceived, { registry }))).toBe(
			"not restorable: s: missing received records",
		);
		const withoutLifetime = roundTrip(cp);
		delete (withoutLifetime.nodes.find((n) => n.id === "s") as typeof s).lifetime;
		expect(refusal(() => restoreGraph(withoutLifetime, { registry }))).toBe(
			"not restorable: s: missing received records",
		);
		expect(calls.sum).toBe(0);
		expect(() => restoreGraph(cp, { registry })).not.toThrow();
	});

	it("C-38 (R-checkpoint@3): a capture of a restored graph restores; a restore of the capture itself does too", () => {
		const { registry, cp } = sumAndScan();
		const r = restoreGraph(cp, { registry });
		expect(() => restoreGraph(roundTrip(r.checkpoint()), { registry })).not.toThrow();
	});
});
