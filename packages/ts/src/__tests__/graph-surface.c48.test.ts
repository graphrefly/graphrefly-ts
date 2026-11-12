/**
 * C-48 (R-graph-surface@1, graphrefly:D805): the graph layer's find, describe, observe and retain,
 * with R-node, R-subscription and R-lifetime; and how each one's stop behaves within a wave.
 */

import { describe, expect, it } from "vitest";
import type { Ctx, ObserveEvent, Wave } from "../index.js";
import { graph } from "../index.js";

function c48() {
	const g = graph({ name: "c48" });
	const a = g.state(1, { name: "a" });
	const b = g.derived([a], (v) => (v as number) * 10, { name: "b" });
	const c = g.derived([a], (v) => v, { name: "c" });
	let kept: Ctx | undefined;
	const d = g.node<number>(
		[a],
		(ctx) => {
			kept = ctx;
			ctx.down([["DATA", ctx.deps[0].value as number]]);
		},
		{ name: "d" },
	);
	return { g, a, b, c, d, kept: () => kept };
}

describe("C-48: find, describe, observe and retain (R-graph-surface@1)", () => {
	it("find and describe give the nodes and activate nothing", () => {
		const { g, b } = c48();
		expect(g.find("b")).toBe(b);
		expect(g.find("missing")).toBeUndefined();
		expect(g.describe()).toEqual([
			{ id: "a", kind: "state", deps: [], quiet: false },
			{ id: "b", kind: "node", deps: ["a"], quiet: false },
			{ id: "c", kind: "node", deps: ["a"], quiet: false },
			{ id: "d", kind: "node", deps: ["a"], quiet: false },
		]);
		for (const node of g.describe())
			expect(Object.keys(node).sort()).toEqual(["deps", "id", "kind", "quiet"]);
		expect(b.status.lifecycle).toBe("inactive");
	});

	it("observe is an ordinary subscriber with one { id, msgs } event per array", () => {
		const { g, a, b } = c48();
		const first: ObserveEvent[] = [];
		const stopFirst = g.observe(["b"], (event) => first.push(event));
		expect(b.status.lifecycle).toBe("active");
		a.set(2);
		expect(first).toEqual([
			{ id: "b", msgs: [["START"], ["DATA", 10]] },
			{ id: "b", msgs: [["PENDING"], ["DATA", 20]] },
		]);

		const second: ObserveEvent[] = [];
		const stopSecond = g.observe(["b"], (event) => second.push(event));
		stopFirst();
		a.set(3);
		expect(first).toHaveLength(2);
		expect(second).toEqual([
			{ id: "b", msgs: [["START"], ["DATA", 20]] },
			{ id: "b", msgs: [["PENDING"], ["DATA", 30]] },
		]);
		stopSecond();
		expect(b.status.lifecycle).toBe("inactive");
	});

	it("each retain is its own subscription", () => {
		const { g, c } = c48();
		const releaseFirst = g.retain("c");
		expect(c.status.lifecycle).toBe("active");
		const releaseSecond = g.retain("c");
		releaseFirst();
		expect(c.status.lifecycle).toBe("active");
		releaseSecond();
		expect(c.status.lifecycle).toBe("inactive");
	});

	it("describe gives the current dependencies; definition gives the declared ones", () => {
		const { g, a, c, kept } = c48();
		const release = g.retain("d");
		kept()?.rewire([a, c]);
		expect(g.describe().find((n) => n.id === "d")?.deps).toEqual(["a", "c"]);
		expect(g.definition("d").deps).toEqual([a]);
		release();
	});
});

/** A node whose every run sends two arrays, for stopping between them. */
function twoArrays() {
	const g = graph();
	const a = g.state(0, { name: "a" });
	const n = g.node<number>(
		[a],
		(ctx) => {
			const v = ctx.deps[0].value as number;
			ctx.down([["DATA", v]]);
			ctx.down([["DATA", v + 100]]);
		},
		{ name: "n" },
	);
	return { g, a, n };
}

describe("stop within a wave (R-request-order, C-33, R-graph-surface@1)", () => {
	it("subscribe: an unsubscribe in the first array is a request; the run's second array still arrives", () => {
		const { a, n } = twoArrays();
		const seen: Wave[] = [];
		let armed = false;
		const unsubscribe = n.subscribe((msgs) => {
			seen.push(msgs);
			if (armed) {
				armed = false;
				unsubscribe();
			}
		});
		seen.length = 0;
		armed = true;
		a.set(1);
		expect(seen).toEqual([
			[["PENDING"], ["DATA", 1]],
			[["PENDING"], ["DATA", 101]],
		]);
		a.set(2);
		expect(seen).toHaveLength(2);
		expect(n.status.lifecycle).toBe("inactive");
	});

	it("observe: stop takes effect at once; the run's second array is not handed on", () => {
		const { g, a, n } = twoArrays();
		const seen: ObserveEvent[] = [];
		let armed = false;
		const stop = g.observe(["n"], (event) => {
			seen.push(event);
			if (armed) {
				armed = false;
				stop();
			}
		});
		seen.length = 0;
		armed = true;
		a.set(1);
		expect(seen).toEqual([{ id: "n", msgs: [["PENDING"], ["DATA", 1]] }]);
		expect(n.status.lifecycle).toBe("inactive");
	});

	it("retain: a release during a wave leaves no subscription by the wave's end", () => {
		const { g, a, n } = twoArrays();
		const release = g.retain("n");
		const trigger = g.derived([a], (v) => v, { name: "trigger" });
		let armed = false;
		const stopTrigger = trigger.subscribe(() => {
			if (armed) {
				armed = false;
				release();
			}
		});
		armed = true;
		a.set(1);
		expect(n.status.lifecycle).toBe("inactive");
		stopTrigger();
	});
});
