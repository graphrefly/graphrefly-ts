import { describe, expect, it } from "vitest";
import { ctxRewireDiff } from "../ctx/types.js";
import type { Ctx, Message } from "../index.js";
import {
	Dispatcher,
	defaultNodeVersionHash,
	depBatch,
	depLatest,
	graph,
	strictCanonicalJsonBytes,
	strictJsonCodec,
} from "../index.js";
import { addOwnedNodeDep } from "./helpers/owned-rewire.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
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

describe("first-run gate (R-first-run-gate)", () => {
	it("partial:false holds fn until every dep has settled", () => {
		const g = graph();
		let fired = false;
		const a = g.node<number>([], null, { initial: 1 });
		const b = g.node<number>([], null); // uncached — never settles
		g.node<number>([a, b], () => {
			fired = true;
		});
		collect(g.node<number>([a, b], () => {})); // force-activate a separate gate path

		// Build the gated node explicitly and activate it:
		fired = false;
		const gated = g.node<number>([a, b], () => {
			fired = true;
		});
		gated.subscribe(() => {});
		expect(fired).toBe(false); // b never delivered real DATA -> gate holds
		b.set(9);
		expect(fired).toBe(true); // now both settled -> fires once
	});

	it("partial:true fires without waiting for all deps", () => {
		const g = graph();
		let fired = false;
		const a = g.node<number>([], null, { initial: 1 });
		const b = g.node<number>([], null); // uncached
		const d = g.node<number>(
			[a, b],
			(ctx: Ctx) => {
				fired = true;
				// fn body guards SENTINEL per dep (R-first-run-gate partial contract)
				const bv = depLatest(ctx, 1);
				ctx.down([["DATA", bv === undefined ? -1 : (bv as number)]]);
			},
			{ partial: true },
		);
		d.subscribe(() => {});
		expect(fired).toBe(true);
		expect(d.cache).toBe(-1);
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
			"versionStates",
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
		expect(sideTableCounts(coreOf(s))).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);

		expect(s.cache).toBe(1);
		expect(s.status.cache).toBe("ready");
		expect(s.factory).toBe("probe");
	});

	it("uses packed NodeId-indexed arrays for B49 side tables", () => {
		const g = graph();
		const a = g.state(1);
		const b = g.derived([a], (v) => v + 1);
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
			"versionStates",
		]) {
			expect(Array.isArray(core[table]), table).toBe(true);
			expect((core[table] as unknown[]).length, table).toBe(2);
		}
		expect((core.slots as unknown[])[idOf(a)]).toBe(slotOf(a));
		expect((core.slots as unknown[])[idOf(b)]).toBe(slotOf(b));
		expect(slotCount(core)).toBe(2);
		expect(sideTableCounts(core)).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
	});

	it("does not add a parallel frontier or adjacency transport over subscriber propagation", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		const coreKeys = Reflect.ownKeys(coreOf(s)).map((key) => String(key));
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
			"versionStates",
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

describe("D109 node runtime versioning", () => {
	it("defaults nodes to nodev0 and advances only on DATA", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		expect(s.version).toEqual({ level: 0, counter: 0 });

		s.set(2);
		expect(s.version).toEqual({ level: 0, counter: 1 });

		g.batch(() => {
			s.set(3);
			s.set(4);
		});
		expect(s.version).toEqual({ level: 0, counter: 3 });

		s.invalidate();
		expect(s.version).toEqual({ level: 0, counter: 3 });

		s.complete();
		expect(s.version).toEqual({ level: 0, counter: 3 });

		const errored = g.node<number>([], null, { initial: 1 });
		errored.error("boom");
		expect(errored.version).toEqual({ level: 0, counter: 0 });
	});

	it("supports graph default V1, per-node overrides, and versioning:false absence", () => {
		const hash = testHash;
		const g = graph({ versioning: { level: 1, hash } });
		const inherited = g.state({ n: 1 }, { name: "inherited" });
		const overridden = g.state(1, { name: "overridden", versioning: 0 });
		const disabled = g.state(1, { name: "disabled", versioning: false });

		expect(inherited.version).toEqual({
			level: 1,
			counter: 0,
			cid: 'h:{"n":1}',
			prev: null,
		});
		inherited.set({ n: 2 });
		expect(inherited.version).toEqual({
			level: 1,
			counter: 1,
			cid: 'h:{"n":2}',
			prev: 'h:{"n":1}',
		});
		expect(overridden.version).toEqual({ level: 0, counter: 0 });
		expect(disabled.version).toBeUndefined();

		const byId = Object.fromEntries(g.describe().nodes.map((n) => [n.id, n]));
		expect(byId.inherited?.version).toEqual(inherited.version);
		expect(byId.overridden?.version).toEqual({ level: 0, counter: 0 });
		expect(byId.disabled?.version).toBeUndefined();
	});

	it("keeps returned version objects immutable snapshots", () => {
		const g = graph();
		const s = g.node<number>([], null, { initial: 1 });
		const v = s.version as { counter: number };
		expect(Object.isFrozen(v)).toBe(true);
		expect(() => {
			v.counter = 99;
		}).toThrow();
		expect(s.version).toEqual({ level: 0, counter: 0 });
	});

	it("uses the default V1 hash over stable JSON-compatible data", () => {
		const g = graph();
		const s = g.node<{ b: number; a: number }>([], null, {
			initial: { b: 2, a: 1 },
			versioning: 1,
		});
		expect(s.version).toEqual({
			level: 1,
			counter: 0,
			cid: defaultNodeVersionHash(strictCanonicalJsonBytes({ a: 1, b: 2 })),
			prev: null,
		});
		expect(defaultNodeVersionHash(strictCanonicalJsonBytes({ b: 2, a: 1 }))).toBe(
			defaultNodeVersionHash(strictJsonCodec.encode({ a: 1, b: 2 })),
		);
	});

	it("passes strict canonical JSON UTF-8 bytes to custom V1 hash callbacks (D112)", () => {
		const g = graph();
		const calls: Uint8Array[] = [];
		const hash = (bytes: Uint8Array) => {
			expect(bytes).toBeInstanceOf(Uint8Array);
			calls.push(Uint8Array.from(bytes));
			return `bytes:${decodeTestJsonBytes(bytes)}`;
		};
		const s = g.node<Record<string, number>>([], null, {
			initial: { b: 2, a: 1 },
			versioning: { level: 1, hash },
		});

		expect(calls.map(decodeTestJsonBytes)).toEqual(['{"a":1,"b":2}']);
		expect(s.version).toEqual({
			level: 1,
			counter: 0,
			cid: 'bytes:{"a":1,"b":2}',
			prev: null,
		});
	});

	it("uses equivalent canonical bytes for V1 payloads with different key insertion order (D112)", () => {
		const g = graph();
		const calls: string[] = [];
		const hash = (bytes: Uint8Array) => {
			const canonical = decodeTestJsonBytes(bytes);
			calls.push(canonical);
			return `h:${canonical}`;
		};
		const s = g.node<Record<string, number>>([], null, {
			initial: JSON.parse('{"b":2,"a":1}') as Record<string, number>,
			versioning: { level: 1, hash },
		});
		const initialCid = s.version?.level === 1 ? s.version.cid : undefined;

		s.set(JSON.parse('{"a":1,"b":2}') as Record<string, number>);

		expect(calls).toEqual(['{"a":1,"b":2}', '{"a":1,"b":2}']);
		expect(s.version).toEqual({
			level: 1,
			counter: 1,
			cid: initialCid,
			prev: initialCid,
		});
	});

	it("V1 rejects non-strict-JSON DATA before mutating cache or version", () => {
		const g = graph();
		const s = g.node<number | bigint>([], null, { initial: 1, versioning: 1 });
		const downstream = g.node<number | bigint>([s], (ctx) => {
			ctx.down([["DATA", depLatest(ctx, 0)]]);
		});
		const { msgs } = collect(s);
		const downstreamMsgs = collect(downstream).msgs;
		msgs.length = 0;
		downstreamMsgs.length = 0;
		const before = s.version;
		expect(() => s.set(2n)).toThrow(/not JSON-encodable/);
		expect(s.version).toEqual(before);
		expect(s.cache).toBe(1);
		expect(s.status.cache).toBe("ready");
		expect(msgs).toEqual([]);
		expect(downstreamMsgs).toEqual([]);

		s.set(2);
		expect(types(msgs)).toEqual(["PENDING", "DATA"]);
		expect(types(downstreamMsgs)).toEqual(["PENDING", "DATA"]);
		expect(s.version).toMatchObject({ level: 1, counter: 1 });
		expect(s.cache).toBe(2);

		const customHash = (bytes: Uint8Array) => `custom:${decodeTestJsonBytes(bytes)}`;
		const custom = g.node<unknown>([], null, {
			initial: 1,
			versioning: { level: 1, hash: customHash },
		});
		const customBefore = custom.version;
		expect(() => custom.set(new Date(0))).toThrow(/non-plain object/);
		expect(custom.version).toEqual(customBefore);
		expect(custom.cache).toBe(1);

		const terminal = g.node<unknown>([], null, { initial: 1, versioning: 1 });
		terminal.complete();
		const terminalBefore = terminal.version;
		expect(() => terminal.set(2n)).toThrow(/ended/);
		expect(terminal.version).toEqual(terminalBefore);
		expect(terminal.cache).toBe(1);
		expect(terminal.status.output).toBe("completed");
	});

	it("V1 rejects deferred batch DATA before PENDING, cache, or version changes", () => {
		const g = graph();
		const batched = g.node<unknown>([], null, { initial: 1, versioning: 1 });
		const batchedMsgs = collect(batched).msgs;
		batchedMsgs.length = 0;
		const batchedBefore = batched.version;

		expect(() => g.batch(() => batched.set(2n))).toThrow(/not JSON-encodable/);
		expect(batchedMsgs).toEqual([]);
		expect(batched.version).toEqual(batchedBefore);
		expect(batched.cache).toBe(1);
		expect(batched.status.cache).toBe("ready");

		const batchedSnapshot = g.node<Record<string, unknown>>([], null, {
			initial: { a: 0 },
			versioning: { level: 1, hash: testHash },
		});
		const batchedSnapshotMsgs = collect(batchedSnapshot).msgs;
		batchedSnapshotMsgs.length = 0;
		const batchedPayload: Record<string, unknown> = { a: 1 };
		g.batch(() => {
			batchedSnapshot.set(batchedPayload);
			batchedPayload.a = 2;
			batchedPayload.bad = 2n;
		});
		expect(types(batchedSnapshotMsgs)).toEqual(["PENDING", "DATA"]);
		expect(batchedSnapshotMsgs[1]).toEqual(["DATA", { a: 1 }]);
		expect(batchedSnapshot.cache).toEqual({ a: 1 });
		expect(batchedSnapshot.version).toMatchObject({
			level: 1,
			counter: 1,
			cid: 'h:{"a":1}',
		});
	});

	it("does not apply the D112 strict JSON preflight to V0 or versioning:false", () => {
		const g = graph();
		const v0 = g.node<unknown>([], null, { initial: 1, versioning: 0 });
		const v0Msgs = collect(v0).msgs;
		v0Msgs.length = 0;
		v0.set(2n);
		expect(v0.version).toEqual({ level: 0, counter: 1 });
		expect(v0.cache).toBe(2n);
		expect(types(v0Msgs)).toEqual(["PENDING", "DATA"]);

		const disabled = g.node<unknown>([], null, { initial: 1, versioning: false });
		const disabledMsgs = collect(disabled).msgs;
		disabledMsgs.length = 0;
		disabled.set(new Date(0));
		expect(disabled.version).toBeUndefined();
		expect(disabled.cache).toEqual(new Date(0));
		expect(types(disabledMsgs)).toEqual(["PENDING", "DATA"]);
	});

	it("V1 rejects non-strict-JSON initial values at construction", () => {
		expect(() => graph().node<unknown>([], null, { initial: 2n, versioning: 1 })).toThrow(
			/not JSON-encodable/,
		);
		const g = graph({ versioning: 1 });
		expect(() => g.state(new Date(0), { name: "bad-date" })).toThrow(/non-plain object/);
	});

	it("fails honestly for unapproved V2/V3 levels", () => {
		expect(() => graph().node([], null, { versioning: { level: 2 } as unknown as 1 })).toThrow(
			/V2\/V3/,
		);
		const g = graph({ versioning: { level: 3 } as unknown as 1 });
		expect(() => g.state(1)).toThrow(/V2\/V3/);
	});
});
