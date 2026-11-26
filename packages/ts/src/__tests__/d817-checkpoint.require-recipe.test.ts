/**
 * D817 checkpoint re-port, step 1 (graphrefly-ts:D817): a graph that requires a recipe on every
 * computed instance.
 *
 * TS harness for the root scenario C-50 in ~/src/graphrefly/spec/conformance.jsonl, against
 * R-node@4 and R-checkpoint@3 (graphrefly:D812): `graph({ requireRecipe: true })` refuses creating
 * or replacing a computed node without a recipe when it is asked for; asked from a running
 * function, the refusal is that function's throw unless it catches it; a checkpoint does not hold
 * the requirement, and `restoreGraph(cp, { registry, requireRecipe: true })` gives it again. The
 * refusal's text and the ERROR payload it becomes are the package's (C-50's note), so they are not
 * compared. Not built yet at the graph and restore surface; these tests fail until it is.
 */

import { describe, expect, it } from "vitest";
import type { Ctx } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { GraphOptions } from "../graph/graph-types.js";
import {
	type GraphRestoreRegistry,
	type RestoreGraphOptions,
	restoreGraph,
} from "../graph/restore.js";
import type { Node } from "../node/node.js";
import type { Wave } from "../protocol/messages.js";

type Graph = ReturnType<typeof graph>;

const none = <T>() => undefined as unknown as T;
const pending = (...msgs: Wave): Wave => [["PENDING"], ...msgs];
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const requiring = () => graph({ requireRecipe: true } as GraphOptions);
const restoreRequiring = (cp: ReturnType<Graph["checkpoint"]>, registry: GraphRestoreRegistry) =>
	restoreGraph(cp, { registry, requireRecipe: true } as RestoreGraphOptions);

function refusal(run: () => unknown): string {
	try {
		run();
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
	return "no refusal";
}

const sinkOf = (node: Node<unknown> | undefined) => {
	if (node === undefined) throw new Error("sinkOf: missing node");
	const log: Wave[] = [];
	node.subscribe((msgs) => log.push(msgs));
	return log;
};

const plus = (k: number) => (ctx: Ctx) => {
	if (ctx.deps[0]?.has) ctx.down([["DATA", (ctx.deps[0].value as number) + k]]);
};
const inner = (text: string) => (ctx: Ctx) => ctx.down([["DATA", text]]);

const registry: GraphRestoreRegistry = {
	plus: { ref: "plus", build: (config) => ({ fn: plus((config as { k: number }).k) }) },
	inner: { ref: "inner", build: (config) => ({ fn: inner(config as string) }) },
};

/**
 * C-50's graph: state a; p over a built from a recipe, with a sink; operator o over a request
 * state, built from a recipe, whose function replaces its inner node o/inner with the definition
 * its input names; and, with `handles`, an operator of the same shape that catches a refused
 * replace and sends a value instead.
 */
function c50(g: Graph, opts: { handles?: boolean } = {}) {
	const a = g.state(1, { name: "a" });
	const p = g.node<number>([a], plus(1), { name: "p", recipe: { ref: "plus", config: { k: 1 } } });
	const pLog = sinkOf(p);
	const ask = g.state<string>(none(), { name: "ask" });
	const o = opts.handles ? "h" : "o";
	const innerNode = g.node<string>([], inner("first"), {
		name: `${o}/inner`,
		recipe: { ref: "inner", config: "first" },
	});
	const operator = g.node<string>(
		[ask],
		(ctx) => {
			if (!ctx.deps[0].has) return;
			// "recipe:<text>" names a definition with a recipe, "plain:<text>" one without.
			const asked = ctx.deps[0].value as string;
			const given = asked.startsWith("recipe:") ? { recipe: { ref: "inner", config: asked } } : {};
			if (opts.handles) {
				try {
					g.replace(innerNode, [], inner(asked), given);
				} catch {
					ctx.down([["DATA", `refused ${asked}`]]);
					return;
				}
			} else g.replace(innerNode, [], inner(asked), given);
			ctx.down([["DATA", `asked ${asked}`]]);
		},
		{ name: o, recipe: { ref: "operator" } },
	);
	const oLog = sinkOf(operator);
	const innerLog = sinkOf(innerNode);
	pLog.length = 0;
	oLog.length = 0;
	innerLog.length = 0;
	return { g, a, p, pLog, ask, inner: innerNode, operator, oLog, innerLog };
}

describe("C-50 (R-checkpoint@3): a graph that requires recipes refuses an instance without one when it is asked for", () => {
	it("C-50 (R-checkpoint@3): creating a computed node without a recipe is refused, and no node is made; a state needs none", () => {
		const g = requiring();
		const a = g.state(1, { name: "a" });
		const before = g.describe();
		expect(() => g.node([a], plus(1), { name: "raw" })).toThrow();
		expect(g.find("raw")).toBeUndefined();
		expect(g.describe()).toEqual(before);
		expect(() => g.state(2, { name: "b" })).not.toThrow();
		expect(() => g.node([a], plus(1), { name: "ok", recipe: { ref: "plus" } })).not.toThrow();
	});

	it("C-50 (R-checkpoint@3): a replace without a recipe is refused and leaves p's instance, values and subscribers; one with a recipe starts a new instance", () => {
		const f = c50(requiring());
		const fn = f.g.definition(f.p).fn;
		expect(() => f.g.replace(f.p, [f.a], plus(100))).toThrow();
		expect(f.pLog).toEqual([]);
		expect(f.g.definition(f.p).fn).toBe(fn);
		expect(f.g.definition(f.p).recipe).toEqual({ ref: "plus", config: { k: 1 } });
		expect(f.p.cache).toBe(2);
		f.a.set(2);
		expect(f.pLog).toEqual([pending(["DATA", 3])]);
		f.pLog.length = 0;
		f.g.replace(f.p, [f.a], plus(10), { recipe: { ref: "plus", config: { k: 10 } } });
		expect(f.pLog).toEqual([[["START"], ["DATA", 12]]]);
	});

	it("C-50 (R-checkpoint@3): asked from o's running function, the refusal is o's throw: o ends with ERROR and its inner stays", () => {
		const f = c50(requiring());
		const fn = f.g.definition(f.inner).fn;
		f.ask.set("plain:second");
		expect(f.oLog).toEqual([pending(["ERROR", expect.any(String)])]);
		expect(f.operator.status.output).toBe("errored");
		expect(f.g.definition(f.inner).fn).toBe(fn);
		expect(f.innerLog).toEqual([]);
		expect(f.inner.cache).toBe("first");
	});

	it("C-50 (R-checkpoint@3): given a definition with a recipe, o's inner is replaced and o goes on", () => {
		const f = c50(requiring());
		f.ask.set("recipe:second");
		expect(f.oLog).toEqual([pending(["DATA", "asked recipe:second"])]);
		expect(f.innerLog).toEqual([[["START"], ["DATA", "recipe:second"]]]);
		expect(f.g.definition(f.inner).recipe).toEqual({ ref: "inner", config: "recipe:second" });
		f.oLog.length = 0;
		f.ask.set("recipe:third");
		expect(f.oLog).toEqual([pending(["DATA", "asked recipe:third"])]);
	});

	it("C-50 (R-checkpoint@3): the operator that catches the refusal sends its value and goes on, its inner unchanged", () => {
		const f = c50(requiring(), { handles: true });
		const fn = f.g.definition(f.inner).fn;
		f.ask.set("plain:second");
		expect(f.oLog).toEqual([pending(["DATA", "refused plain:second"])]);
		expect(f.operator.status.output).toBe("open");
		expect(f.g.definition(f.inner).fn).toBe(fn);
		expect(f.innerLog).toEqual([]);
		f.oLog.length = 0;
		f.ask.set("recipe:third");
		expect(f.oLog).toEqual([pending(["DATA", "asked recipe:third"])]);
		expect(f.innerLog).toEqual([[["START"], ["DATA", "recipe:third"]]]);
	});

	it("C-50 (R-checkpoint@3): the graph without the requirement accepts every request; its capture names the first node without a recipe", () => {
		const f = c50(graph());
		f.g.node([f.a], plus(1), { name: "raw" });
		expect(refusal(() => f.g.checkpoint())).toBe(
			"not restorable: raw: local-only, built or replaced without a recipe",
		);
		f.g.replace(f.p, [f.a], plus(100));
		expect(f.pLog).toEqual([[["START"], ["DATA", 101]]]);
		expect(refusal(() => f.g.checkpoint())).toBe(
			"not restorable: p: local-only, built or replaced without a recipe",
		);
		f.ask.set("plain:second");
		expect(f.oLog).toEqual([pending(["DATA", "asked plain:second"])]);
		expect(f.innerLog).toEqual([[["START"], ["DATA", "plain:second"]]]);
	});

	it("C-50 (R-checkpoint@3): a requiring graph's capture is never refused for a missing recipe", () => {
		const f = c50(requiring());
		expect(() => f.g.node([f.a], plus(1), { name: "raw" })).toThrow();
		expect(() => f.g.replace(f.p, [f.a], plus(100))).toThrow();
		f.ask.set("plain:second");
		expect(() => f.g.checkpoint()).not.toThrow();
	});

	it("C-50 (R-checkpoint@3): a checkpoint does not hold the requirement; restore gives it only when asked", () => {
		const f = c50(requiring());
		const cp = roundTrip(f.g.checkpoint());
		const reg = { ...registry, operator: { ref: "operator", build: () => ({ fn: () => {} }) } };

		const required = restoreRequiring(cp, reg);
		const ra = required.find("a") as Node<unknown>;
		expect(() => required.node([ra], plus(1), { name: "raw" })).toThrow();
		expect(required.find("raw")).toBeUndefined();
		expect(() => required.replace("p", [ra], plus(100))).toThrow();
		const pLog = sinkOf(required.find("p"));
		expect(pLog).toEqual([[["START"], ["DATA", 2]]]);
		expect(() => required.checkpoint()).not.toThrow();

		const ordinary = restoreGraph(cp, { registry: reg });
		const oa = ordinary.find("a") as Node<unknown>;
		expect(() => ordinary.node([oa], plus(1), { name: "raw" })).not.toThrow();
		expect(refusal(() => ordinary.checkpoint())).toBe(
			"not restorable: raw: local-only, built or replaced without a recipe",
		);
	});

	it("C-50 (R-checkpoint@3): a recipe whose reference no registry knows is accepted and captured, and refused only at restore", () => {
		const g = requiring();
		const a = g.state(1, { name: "a" });
		expect(() =>
			g.node([a], plus(1), { name: "n", recipe: { ref: "nowhere", config: null } }),
		).not.toThrow();
		const cp = roundTrip(g.checkpoint());
		expect(refusal(() => restoreRequiring(cp, registry))).toBe(
			"not restorable: n: missing recipe nowhere",
		);
	});

	it("C-50 (R-checkpoint@3): a recipe without a reference passes the requirement, and its capture is refused as a missing recipe", () => {
		const g = requiring();
		const a = g.state(1, { name: "a" });
		expect(() => g.node([a], plus(1), { name: "n", recipe: { config: 1 } })).not.toThrow();
		expect(refusal(() => g.checkpoint())).toBe("not restorable: n: missing recipe");
	});
});
