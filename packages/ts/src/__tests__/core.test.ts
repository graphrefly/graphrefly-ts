import { describe, expect, it } from "vitest";
import { ctxRewireDiff } from "../ctx/types.js";
import type { Ctx, Message } from "../index.js";
import {
	Dispatcher,
	depBatch,
	depLatest,
	graph,
	strictCanonicalJsonBytes,
	strictJsonCodec,
} from "../index.js";
import type { Subscribable } from "./helpers/collect.js";
import { addOwnedNodeDep } from "./helpers/owned-rewire.js";

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
const TEST_JSON_DECODER = new TextDecoder();
const decodeTestJsonBytes = (bytes: Uint8Array) => TEST_JSON_DECODER.decode(bytes);
const testHash = (bytes: Uint8Array) => `h:${decodeTestJsonBytes(bytes)}`;

describe("state node (manual source)", () => {
	it("push-on-subscribe delivers START then cached DATA (R-push-subscribe, R-initial)", () => {
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

	it("external down emits PENDING before DATA (R-dirty-before-data, two-phase)", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		const { msgs } = collect(s);
		msgs.length = 0;
		s.set(2);
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
		expect(msgs[1]).toEqual(["DATA", 2]);
		expect(s.cache).toBe(2);
	});

	it("null is a valid DATA value (R-data-payload)", () => {
		const g = graph();
		const s = g.node<number | null>([], null, { initial: null });
		const { msgs } = collect(s);
		expect(msgs).toEqual([["START"], ["DATA", null]]);
		expect(s.cache).toBeNull();
	});
});

describe("occurrences stay DATA (R-resolved-undirty / D49, supersedes R-equals)", () => {
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
			ctx.down([["DATA", (depLatest(ctx, 0) as number) * 2]]);
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

describe("diamond (R-diamond, glitch-free join)", () => {
	it("join node computes exactly once per upstream change, after both deps settle", () => {
		const g = graph();
		let fireCount = 0;
		const a = g.node<number>([], null, { initial: 1 });
		const b = g.node<number>([a], (ctx: Ctx) =>
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + 10]]),
		);
		const c = g.node<number>([a], (ctx: Ctx) =>
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + 20]]),
		);
		const d = g.node<number>([b, c], (ctx: Ctx) => {
			fireCount++;
			ctx.down([["DATA", (depLatest(ctx, 0) as number) + (depLatest(ctx, 1) as number)]]);
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
			const bv = depLatest(ctx, 1);
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

describe("B49 core-slot migration", () => {
	const coreOf = (n: object) => (n as unknown as Record<string, unknown>)._core;
	const occupied = (xs: unknown[]) => xs.filter((x) => x !== undefined).length;
	const slotCount = (core: unknown) =>
		occupied((core as Record<string, unknown>).slots as unknown[]);
	const sideTableCounts = (core: unknown) => {
		const c = core as Record<string, unknown>;
		return [
			"depStates",
			"lifecycles",
			"values",
			"waves",
			"privateStates",
			"lifetimes",
			"syncCtxs",
		].map((k) => occupied(c[k] as unknown[]));
	};
	const boundaryTaskCount = (core: unknown) => {
		const boundary = (core as Record<string, unknown>).domain as {
			queue: unknown[];
			head: number;
		};
		return boundary.queue.length - boundary.head;
	};

	it("stores wave bookkeeping behind the Node view, without old direct-field shims", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1, factory: "probe" });
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
			"subscribers",
			"activated",
			"dep",
			"privateState",
			"lifetimes",
			"syncCtx",
			"version",
		]) {
			expect(Object.hasOwn(slot, sideTableField), sideTableField).toBe(false);
		}
		expect(sideTableCounts(coreOf(s))).toEqual([1, 1, 1, 1, 1, 1, 1]);

		expect(s.cache).toBe(1);
		expect(s.status.cache).toBe("ready");
		expect(s.factory).toBe("probe");
	});

	it("uses packed NodeId-indexed arrays for B49 side tables", () => {
		const g = graph();
		const a = g.state(1);
		const b = g.derived([a], (v) => v! + 1);
		const core = coreOf(a) as Record<string, unknown>;
		const idOf = (n: object) => (n as unknown as Record<string, unknown>)._id as number;
		const slotOf = (n: object) => (n as unknown as Record<string, unknown>)._slot;

		for (const table of [
			"slots",
			"depStates",
			"lifecycles",
			"values",
			"waves",
			"privateStates",
			"lifetimes",
			"syncCtxs",
		]) {
			expect(Array.isArray(core[table]), table).toBe(true);
			expect((core[table] as unknown[]).length, table).toBe(2);
		}
		expect((core.slots as unknown[])[idOf(a)]).toBe(slotOf(a));
		expect((core.slots as unknown[])[idOf(b)]).toBe(slotOf(b));
		expect(slotCount(core)).toBe(2);
		expect(sideTableCounts(core)).toEqual([2, 2, 2, 2, 2, 2, 2]);
	});

	it("does not add a parallel frontier or adjacency transport over subscriber propagation", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		const coreKeys = Reflect.ownKeys(coreOf(s) as object).map((key) => String(key));
		const knownCoreFields = new Set([
			"nextId",
			"slots",
			"values",
			"waves",
			"lifecycles",
			"depStates",
			"privateStates",
			"lifetimes",
			"syncCtxs",
			"domain",
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
				nested ??= graph().node<number>([], null, { initial: 7 });
				return pool === undefined ? super.register(fn) : super.register(fn, pool);
			}
		}

		const g = graph({ dispatcher: new NestedDispatcher() });
		const src = g.state(1);
		const d = g.derived([src], (v) => v! + 1);

		expect(nested).toBeDefined();
		expect(coreOf(d)).toBe(coreOf(src));
		expect(coreOf(nested as object)).not.toBe(coreOf(src));
	});

	it("rejects public rewire from a graph-owned node to a different graph's node", () => {
		const g1 = graph();
		const a = g1.state(1);
		const d = g1.derived([a], (v) => v! + 1);
		const foreign = graph().state(2);

		expect(() =>
			addOwnedNodeDep(d, foreign, (ctx: Ctx) => ctx.down([["DATA", depLatest(ctx, 0)]])),
		).toThrow(/different graph/);
		expect(d.deps).toEqual([a]);
	});

	it("stores deferred-boundary work on the owning core and drains it at the wave boundary", () => {
		const g = graph();
		const trigger = g.state(0);
		const inner = g.node<number>([], (ctx) => ctx.down([["DATA", 7]]));
		let queuedInsideRun = -1;
		const op = g.node<number>(
			[trigger],
			function opFn(ctx) {
				if (depLatest(ctx, 0) === 1) {
					ctxRewireDiff(ctx, [inner]);
					queuedInsideRun = boundaryTaskCount(coreOf(op));
				}
			},
			{ complete: "manual" },
		);
		op.subscribe(() => {});
		trigger.set(1);

		expect(queuedInsideRun).toBe(1);
		expect(boundaryTaskCount(coreOf(op))).toBe(0);
		expect(op.deps).toContain(inner);
		expect(inner.cache).toBe(7);
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
				if (depBatch(ctx, 0)) ctxRewireDiff(ctx, [innerA1]);
				if (depBatch(ctx, 1)) ctxRewireDiff(ctx, [innerA2]);
			},
			{ complete: "manual" },
		);
		const opB = gB.node<number>([sourceB], function opBFn(ctx) {
			if (depBatch(ctx, 0)) ctxRewireDiff(ctx, [innerB1]);
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
