import { describe, expect, it } from "vitest";
import { ctxRewireDiff } from "../ctx/types.js";
import type { Ctx, Message } from "../index.js";
import { graph } from "../index.js";
import type { Subscribable } from "./helpers/collect.js";

function collect(n: Subscribable) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((incoming) => {
		for (const m of incoming) {
			msgs.push(m);
		}
	});
	return { msgs, unsub };
}

const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("state node (manual source)", () => {
	it("push-on-subscribe delivers START then cached DATA (R-subscription)", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 5 });
		const { msgs } = collect(s);
		expect(msgs).toEqual([["START"], ["DATA", 5]]);
		expect(s.cache).toBe(5);
		expect(s.status.cache).toBe("ready");
	});

	it("uncached subscribe delivers only START", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const { msgs } = collect(s);
		expect(msgs).toEqual([["START"]]);
		expect(s.cache).toBeUndefined();
		expect(s.status.cache).toBe("empty");
	});

	it("a host set sends PENDING then DATA in one array (R-wave)", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.set(2);
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
		expect(msgs[1]).toEqual(["DATA", 2]);
		expect(s.cache).toBe(2);
	});

	it("null is a valid DATA value (R-messages)", () => {
		const g = graph();
		const s = g.node<number | null>([], null, { initial: null });
		const { msgs } = collect(s);
		expect(msgs).toEqual([["START"], ["DATA", null]]);
		expect(s.cache).toBeNull();
	});
});

describe("occurrences stay DATA (R-wave / D49)", () => {
	it("re-emitting the same value yields DATA, not RESOLVED (no equals-substitution)", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 5 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.set(5); // same value is still a distinct occurrence
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
		expect(s.cache).toBe(5);
	});

	it("a changed value yields DATA", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 5 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.set(6);
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
		expect(s.cache).toBe(6);
	});

	it("a multi-DATA wave passes every occurrence as DATA", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 5 });
		const { msgs } = collect(s);
		msgs.length = 0;
		g.batch(() => {
			s.set(5);
			s.set(5);
		});
		expect(types(msgs)).toEqual(["PENDING", "DATA", "DATA"]);
	});
});

describe("compute node (derived)", () => {
	it("computes from a dep and recomputes on change", () => {
		const g = graph();
		const count = g.node<number>([], null, { initial: 2 });
		const doubled = g.node<number>([count], (ctx: Ctx) => {
			ctx.down([["DATA", (ctx.deps[0].value as number) * 2]]);
		});
		const { msgs } = collect(doubled);
		expect(doubled.cache).toBe(4);
		expect(msgs).toContainEqual(["DATA", 4]);

		msgs.length = 0;
		count.set(10);
		expect(doubled.cache).toBe(20);
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
		expect(msgs[1]).toEqual(["DATA", 20]);
	});
});

describe("diamond (R-wave, glitch-free join)", () => {
	it("join node computes exactly once per upstream change, after both deps settle", () => {
		const g = graph();
		let fireCount = 0;
		const a = g.node<number>([], null, { initial: 1 });
		const b = g.node<number>([a], (ctx: Ctx) =>
			ctx.down([["DATA", (ctx.deps[0].value as number) + 10]]),
		);
		const c = g.node<number>([a], (ctx: Ctx) =>
			ctx.down([["DATA", (ctx.deps[0].value as number) + 20]]),
		);
		const d = g.node<number>([b, c], (ctx: Ctx) => {
			fireCount++;
			ctx.down([["DATA", (ctx.deps[0].value as number) + (ctx.deps[1].value as number)]]);
		});

		collect(d);
		expect(d.cache).toBe(32); // (1+10) + (1+20)
		expect(fireCount).toBe(1); // joined once, not once per leg

		fireCount = 0;
		a.set(2);
		expect(d.cache).toBe(34); // (2+10) + (2+20)
		expect(fireCount).toBe(1); // recomputed exactly once
	});
});

describe("no first-run gate in the kernel; derived and effect gate on values (graphrefly-ts:D184)", () => {
	it("a kernel node runs on activation, before every dependency has a value", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const b = g.node<number>([], null); // no value yet
		const d = g.node<number>([a, b], (ctx: Ctx) => {
			const bv = ctx.deps[1].value;
			ctx.down([["DATA", bv === undefined ? -1 : (bv as number)]]);
		});
		d.subscribe(() => {});
		expect(d.cache).toBe(-1);
		b.set(9);
		expect(d.cache).toBe(9);
	});

	it("derived and effect call their function only once every dependency has a value", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const b = g.node<number>([], null);
		const derivedCalls: unknown[][] = [];
		const effectCalls: unknown[][] = [];
		const sum = g.derived([a, b], (x, y) => {
			derivedCalls.push([x, y]);
			return (x as number) + (y as number);
		});
		g.effect([a, b], (x, y) => {
			effectCalls.push([x, y]);
		});
		const values = collect(sum);
		g.retain(g.describe().at(-1)?.id as string);
		expect(derivedCalls).toEqual([]);
		expect(effectCalls).toEqual([]);
		expect(sum.cache).toBeUndefined();
		expect(values.msgs.some((m) => m[0] === "DATA")).toBe(false);
		b.set(9);
		expect(derivedCalls).toEqual([[1, 9]]);
		expect(effectCalls).toEqual([[1, 9]]);
		expect(sum.cache).toBe(10);
	});

	it("derived over an input that settles with RESOLVED alone settles with the kernel's RESOLVED (C-12 (b), R-wave)", () => {
		const g = graph();
		const s = g.state(100);
		// f sends nothing for a value under 100, so the kernel settles it with RESOLVED.
		const f = g.node<number>([s], (ctx: Ctx) => {
			const v = ctx.deps[0].value as number;
			if (v >= 100) ctx.down([["DATA", v]]);
		});
		const d = g.derived([f], (v) => v! * 2);
		const { msgs } = collect(d);
		expect(d.cache).toBe(200);
		msgs.length = 0;

		// derived's gate calls its function only for new DATA, so d is settled by the kernel too.
		s.set(50);
		expect(types(msgs)).toEqual(["PENDING", "RESOLVED"]);
		expect(d.cache).toBe(200);
		expect(d.status.cache).not.toBe("stale");
	});
});

describe("closed message set at node output (R-messages)", () => {
	it("down rejects unknown tags; there is no up", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const custom = [["CUSTOM"]] as unknown as Message[];
		let rejected: unknown;
		const d = g.node<number>([a], (ctx: Ctx) => {
			try {
				ctx.down(custom);
			} catch (error) {
				rejected = error;
			}
			ctx.down([["DATA", 1]]);
		});
		d.subscribe(() => {});
		expect(String(rejected)).toMatch(/closed message-type set/);
		expect(d.cache).toBe(1);
		expect("up" in d).toBe(false);
		expect("down" in d).toBe(false);
	});
});

describe("graph domains (R-graph-domain)", () => {
	it("refuses a graph node over another graph's node and registers nothing", () => {
		const g1 = graph();
		g1.state(1, { name: "anchor" });
		const before = g1.describe().map((n) => n.id);
		const foreign = graph().state(2);

		expect(() => g1.derived([foreign], (v) => v)).toThrow(/different graph/);
		expect(g1.describe().map((n) => n.id)).toEqual(before);
	});

	it("refuses a ctx.rewire to another graph's node and changes nothing", () => {
		const g1 = graph();
		const a = g1.state(1);
		let kept: Ctx | undefined;
		const d = g1.node<number>([a], (ctx: Ctx) => {
			kept = ctx;
			ctx.down([["DATA", (ctx.deps[0].value as number) + 1]]);
		});
		d.subscribe(() => {});
		const foreign = graph().state(2);

		expect(() => (kept as Ctx).rewire([a, foreign])).toThrow(/different graph/);
		expect(d.deps).toEqual([a]);
		expect(d.cache).toBe(2);
	});

	it("keeps each graph's request queue its own: a write to another graph in a batch body runs at once (R-graph-domain@3, D803)", () => {
		const order: string[] = [];
		const gA = graph();
		const gB = graph();
		const sourceA = gA.node<number>([], null);
		const sourceB = gB.node<number>([], null);
		const innerA1 = gA.node<number>([], (ctx) => {
			order.push("A1");
			ctx.down([["DATA", 1]]);
		});
		const innerA2 = gA.node<number>([], (ctx) => {
			order.push("A2");
			ctx.down([["DATA", 2]]);
		});
		const innerB1 = gB.node<number>([], (ctx) => {
			order.push("B1");
			ctx.down([["DATA", 1]]);
		});
		const opA = gA.node<number>(
			[sourceA],
			function opAFn(ctx) {
				if (ctx.deps[0].waves.length > 0) ctxRewireDiff(ctx, [innerA1]);
				// innerA1 is the second dependency once the first rewire ran.
				if ((ctx.deps[1]?.waves.length ?? 0) > 0) ctxRewireDiff(ctx, [innerA2]);
			},
			{ complete: "manual" },
		);
		const opB = gB.node<number>([sourceB], function opBFn(ctx) {
			if (ctx.deps[0].waves.length > 0) ctxRewireDiff(ctx, [innerB1]);
		});
		opA.subscribe(() => {});
		opB.subscribe(() => {});

		gA.batch(() => {
			sourceA.set(1);
			sourceB.set(1);
		});

		// sourceB's write is gB's own request and runs inside the body; gA's queue then runs in order.
		expect(order).toEqual(["B1", "A1", "A2"]);
	});
});
