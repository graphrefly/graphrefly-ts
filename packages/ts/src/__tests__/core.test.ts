import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import { batch, Dispatcher, depBatch, depLatest, graph, initNode, node } from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}

const types = (msgs: Message[]) => msgs.map((m) => m[0]);

describe("state node (manual source)", () => {
	it("push-on-subscribe delivers START then cached DATA (R-push-subscribe, R-initial)", () => {
		const s = node<number>([], null, { initial: 5 });
		const { msgs } = collect(s);
		expect(msgs).toEqual([["START"], ["DATA", 5]]);
		expect(s.cache).toBe(5);
		expect(s.status).toBe("settled");
	});

	it("uncached subscribe delivers only START", () => {
		const s = node<number>([], null);
		const { msgs } = collect(s);
		expect(msgs).toEqual([["START"]]);
		expect(s.cache).toBeUndefined();
		expect(s.status).toBe("sentinel");
	});

	it("external down emits DIRTY before DATA (R-dirty-before-data, two-phase)", () => {
		const s = node<number>([], null, { initial: 1 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.down([["DATA", 2]]);
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(msgs[1]).toEqual(["DATA", 2]);
		expect(s.cache).toBe(2);
	});

	it("null is a valid DATA value (R-data-payload)", () => {
		const s = node<number | null>([], null, { initial: null });
		const { msgs } = collect(s);
		expect(msgs).toEqual([["START"], ["DATA", null]]);
		expect(s.cache).toBeNull();
	});
});

describe("occurrences stay DATA (R-resolved-undirty / D49, supersedes R-equals)", () => {
	it("re-emitting the same value yields DATA, not RESOLVED (no equals-substitution)", () => {
		const s = node<number>([], null, { initial: 5 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.down([["DATA", 5]]); // same value is still a distinct occurrence
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(s.cache).toBe(5);
	});

	it("a changed value yields DATA", () => {
		const s = node<number>([], null, { initial: 5 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.down([["DATA", 6]]);
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(s.cache).toBe(6);
	});

	it("a multi-DATA wave passes every occurrence as DATA", () => {
		const s = node<number>([], null, { initial: 5 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.down([
			["DATA", 5],
			["DATA", 5],
		]);
		expect(types(msgs)).toEqual(["DIRTY", "DATA", "DATA"]);
	});
});

describe("compute node (derived)", () => {
	it("computes from a dep and recomputes on change", () => {
		const count = node<number>([], null, { initial: 2 });
		const doubled = node<number>([count], (ctx: Ctx) => {
			ctx.down([["DATA", (depLatest(ctx, 0) as number) * 2]]);
		});
		const { msgs } = collect(doubled);
		expect(doubled.cache).toBe(4);
		expect(msgs).toContainEqual(["DATA", 4]);

		msgs.length = 0;
		count.down([["DATA", 10]]);
		expect(doubled.cache).toBe(20);
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(msgs[1]).toEqual(["DATA", 20]);
	});
});

describe("diamond (R-diamond, glitch-free join)", () => {
	it("join node computes exactly once per upstream change, after both deps settle", () => {
		let fireCount = 0;
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([a], (ctx: Ctx) =>
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + 10]]),
		);
		const c = node<number>([a], (ctx: Ctx) =>
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + 20]]),
		);
		const d = node<number>([b, c], (ctx: Ctx) => {
			fireCount++;
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + (depLatest(ctx, 1) as number)]]);
		});

		collect(d);
		expect(d.cache).toBe(32); // (1+10) + (1+20)
		expect(fireCount).toBe(1); // joined once, not once per leg

		fireCount = 0;
		a.down([["DATA", 2]]);
		expect(d.cache).toBe(34); // (2+10) + (2+20)
		expect(fireCount).toBe(1); // recomputed exactly once
	});
});

describe("first-run gate (R-first-run-gate)", () => {
	it("partial:false holds fn until every dep has settled", () => {
		let fired = false;
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null); // uncached — never settles
		node<number>([a, b], () => {
			fired = true;
		});
		collect(node<number>([a, b], () => {})); // force-activate a separate gate path

		// Build the gated node explicitly and activate it:
		fired = false;
		const gated = node<number>([a, b], () => {
			fired = true;
		});
		gated.subscribe(() => {});
		expect(fired).toBe(false); // b never delivered real DATA -> gate holds
		b.down([["DATA", 9]]);
		expect(fired).toBe(true); // now both settled -> fires once
	});

	it("partial:true fires without waiting for all deps", () => {
		let fired = false;
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null); // uncached
		const g = node<number>(
			[a, b],
			(ctx: Ctx) => {
				fired = true;
				// fn body guards SENTINEL per dep (R-first-run-gate partial contract)
				const bv = depLatest(ctx, 1);
				ctx.down([["DATA", bv === undefined ? -1 : (bv as number)]]);
			},
			{ partial: true },
		);
		g.subscribe(() => {});
		expect(fired).toBe(true);
		expect(g.cache).toBe(-1);
	});
});

describe("ctx.up direction guard (R-ctx-up)", () => {
	it("throws on a down-only tier", () => {
		const a = node<number>([], null, { initial: 1 });
		const d = node<number>([a], (ctx: Ctx) => ctx.down([["DATA", 1]]));
		d.subscribe(() => {});
		expect(() => d.up([["DATA", 5]])).toThrow(/down-only/);
		expect(() => d.up([["COMPLETE"]])).toThrow(/down-only/);
		expect(() => d.up([["INVALIDATE"]])).not.toThrow();
	});
});

describe("B49 core-slot migration", () => {
	const coreOf = (n: object) => (n as unknown as Record<string, unknown>)._core;
	const slotCount = (core: unknown) =>
		((core as Record<string, unknown>).slots as Map<unknown, unknown>).size;
	const sideTableCounts = (core: unknown) => {
		const c = core as Record<string, unknown>;
		return [
			"depStates",
			"lifecycles",
			"values",
			"waves",
			"controls",
			"privateStates",
			"hooks",
			"syncCtxs",
		].map((k) => (c[k] as Map<unknown, unknown>).size);
	};
	const boundaryTaskCount = (core: unknown) => {
		const boundary = (core as Record<string, unknown>).boundary as {
			queue: unknown[];
			head: number;
		};
		return boundary.queue.length - boundary.head;
	};

	it("stores wave bookkeeping behind the Node view, without old direct-field shims", () => {
		const s = node<number>([], null, { initial: 1, factory: "probe" });
		const view = s as unknown as Record<string, unknown>;

		expect(Object.hasOwn(view, "_core")).toBe(true);
		expect(Object.hasOwn(view, "_id")).toBe(true);
		expect(Object.hasOwn(view, "_slot")).toBe(true);
		const slot = view._slot as Record<string, unknown>;
		for (const oldField of [
			"_deps",
			"_depBatch",
			"_depPrev",
			"_depDirty",
			"_pending",
			"_cache",
			"_status",
			"_subscribers",
			"_pauseLockset",
			"_depRecords",
		]) {
			expect(Object.hasOwn(view, oldField), oldField).toBe(false);
		}
		for (const sideTableField of [
			"value",
			"wave",
			"control",
			"subscribers",
			"activated",
			"dep",
			"privateState",
			"hooks",
			"syncCtx",
		]) {
			expect(Object.hasOwn(slot, sideTableField), sideTableField).toBe(false);
		}
		expect(sideTableCounts(coreOf(s))).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);

		expect(s.cache).toBe(1);
		expect(s.status).toBe("settled");
		expect(s.factory).toBe("probe");
	});

	it("does not add a parallel frontier or adjacency transport over subscriber propagation", () => {
		const s = node<number>([], null, { initial: 1 });
		const coreKeys = Reflect.ownKeys(coreOf(s)).map((key) => String(key));
		const knownCoreFields = new Set([
			"nextId",
			"slots",
			"values",
			"waves",
			"controls",
			"lifecycles",
			"depStates",
			"privateStates",
			"hooks",
			"syncCtxs",
			"boundary",
		]);
		const forbiddenTransportName = /adjacency|edge|frontier|queue|work/i;

		for (const key of coreKeys) {
			if (knownCoreFields.has(key)) continue;
			expect(
				key,
				"new core fields must not smuggle B50-B52 adjacency/frontier/work transport",
			).not.toMatch(forbiddenTransportName);
		}
	});

	it("uses one graph-local core for graph-created nodes while standalone nodes stay isolated", () => {
		const g1 = graph();
		const a = g1.state(1);
		const b = g1.derived([a], (v) => v + 1);
		const c = g1.initNode(
			{
				factory: "probeOp",
				body: (ctx: Ctx) => ctx.down([["DATA", depLatest(ctx, 0)]]),
			},
			[b],
		);

		const g2 = graph();
		const otherGraphNode = g2.state(1);
		const bare = node<number>([], null, { initial: 1 });
		const bareOp = initNode(
			{
				factory: "bareProbe",
				body: (ctx: Ctx) => ctx.down([["DATA", 1]]),
			},
			[],
		);

		expect(coreOf(a)).toBe(coreOf(b));
		expect(coreOf(b)).toBe(coreOf(c));
		expect(coreOf(a)).not.toBe(coreOf(otherGraphNode));
		expect(coreOf(a)).not.toBe(coreOf(bare));
		expect(coreOf(a)).not.toBe(coreOf(bareOp));

		const seen: number[] = [];
		c.subscribe((msg) => {
			if (msg[0] === "DATA") seen.push(msg[1] as number);
		});
		a.set(2);
		expect(seen.at(-1)).toBe(3);
	});

	it("does not retain a failed cross-graph graph-node construction in the target core", () => {
		const g1 = graph();
		const anchor = g1.state(1);
		const before = slotCount(coreOf(anchor));
		const foreign = graph().state(2);

		expect(() => g1.derived([foreign], (v) => v)).toThrow(/different graph/);
		expect(slotCount(coreOf(anchor))).toBe(before);
	});

	it("keeps the graph core hook one-shot when dispatcher registration constructs another node", () => {
		let nested: object | undefined;
		class NestedDispatcher extends Dispatcher {
			override register(fn: (ctx: Ctx) => void, pool?: "sync" | "async" | number) {
				nested ??= node<number>([], null, { initial: 7 });
				return pool === undefined ? super.register(fn) : super.register(fn, pool);
			}
		}

		const g = graph({ dispatcher: new NestedDispatcher() });
		const src = g.state(1);
		const d = g.derived([src], (v) => v + 1);

		expect(nested).toBeDefined();
		expect(coreOf(d)).toBe(coreOf(src));
		expect(coreOf(nested as object)).not.toBe(coreOf(src));
	});

	it("rejects public rewire from a graph-owned node to a different graph's node", () => {
		const g1 = graph();
		const a = g1.state(1);
		const d = g1.derived([a], (v) => v + 1);
		const foreign = graph().state(2);

		expect(() => d.addDep(foreign, (ctx: Ctx) => ctx.down([["DATA", depLatest(ctx, 0)]]))).toThrow(
			/different graph/,
		);
		expect(d.deps).toEqual([a]);
	});

	it("stores deferred-boundary work on the owning core and drains it at the wave boundary", () => {
		const g = graph();
		const trigger = g.state(0);
		const inner = node<number>([], (ctx) => ctx.down([["DATA", 7]]));
		let queuedInsideRun = -1;
		const op = g.node<number>(
			[trigger],
			function opFn(ctx) {
				if (depLatest(ctx, 0) === 1) {
					ctx.rewireNext.addDep(inner, opFn);
					queuedInsideRun = boundaryTaskCount(coreOf(op));
				}
			},
			{ completeWhenDepsComplete: false, terminalAsRealInput: true },
		);
		op.subscribe(() => {});
		trigger.set(1);

		expect(queuedInsideRun).toBe(1);
		expect(boundaryTaskCount(coreOf(op))).toBe(0);
		expect(op.deps).toContain(inner);
		expect(inner.cache).toBe(7);
	});

	it("preserves enqueue FIFO when deferred tasks span multiple cores", () => {
		const order: string[] = [];
		const sourceA = node<number>([], null);
		const sourceB = node<number>([], null);
		const innerA1 = node<number>([], (ctx) => {
			order.push("A1");
			ctx.down([["DATA", 1]]);
		});
		const innerA2 = node<number>([], (ctx) => {
			order.push("A2");
			ctx.down([["DATA", 2]]);
		});
		const innerB1 = node<number>([], (ctx) => {
			order.push("B1");
			ctx.down([["DATA", 1]]);
		});
		const opA = node<number>(
			[sourceA],
			function opAFn(ctx) {
				if (depBatch(ctx, 0)) ctx.rewireNext.addDep(innerA1, opAFn);
				if (depBatch(ctx, 1)) ctx.rewireNext.addDep(innerA2, opAFn);
			},
			{ completeWhenDepsComplete: false, terminalAsRealInput: true },
		);
		const opB = node<number>([sourceB], function opBFn(ctx) {
			if (depBatch(ctx, 0)) ctx.rewireNext.addDep(innerB1, opBFn);
		});
		opA.subscribe(() => {});
		opB.subscribe(() => {});

		batch(() => {
			sourceA.down([["DATA", 1]]);
			sourceB.down([["DATA", 1]]);
		});

		expect(order).toEqual(["A1", "B1", "A2"]);
	});
});
