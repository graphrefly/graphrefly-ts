/**
 * Regressions found by the independent review of the phase 1 kernel re-port
 * (graphrefly-ts:D817-KERNEL-REPORT-TS). Each was reproduced on the code before its repair.
 */
import { describe, expect, it } from "vitest";
import { type Ctx, markRequestFirstRun, type NodeFn, requestWrites } from "../ctx/types.js";
import { reactiveMap } from "../graph/data-structures/reactive-map.js";
import {
	defaultRestoreRegistry,
	type GraphRestoreRegistry,
	graph,
	type Message,
	type Node,
	restoreGraph,
	type StateNode,
	switchMap,
} from "../index.js";

const asState = <T>(n: Node<unknown> | undefined) => n as unknown as StateNode<T>;

describe("R-request-order@7: rewires asked for before an earlier one ran", () => {
	it("two attaches in one batch body both become the collection's dependencies", () => {
		const g = graph();
		const a = g.state<readonly [string, number]>(undefined as never, { name: "a" });
		const b = g.state<readonly [string, number]>(undefined as never, { name: "b" });
		const m = reactiveMap<string, number>(g, { name: "map" });
		g.batch(() => {
			m.setFrom(a);
			m.setFrom(b);
		});
		a.set(["x", 1]);
		b.set(["y", 2]);
		expect([...m.toMap()].sort()).toEqual([
			["x", 1],
			["y", 2],
		]);
	});

	it("switchMap given two outer values before its rewire ran follows the last, without ERROR", () => {
		const g = graph();
		const t = g.state<number>(undefined as never, { name: "t" });
		const s = g.state<number>(undefined as never, { name: "s" });
		const inner1 = g.state(100, { name: "i1" });
		const inner2 = g.state(200, { name: "i2" });
		const op = g.initNode(
			switchMap((v: number) => (v === 1 ? inner1 : inner2)),
			[s as Node<number>],
		);
		const msgs: Message[] = [];
		op.subscribe((w) => msgs.push(...w));
		t.subscribe((w) => {
			if (w.some((m) => m[0] === "DATA" && m[1] === 1)) {
				s.set(1);
				s.set(2);
			}
		});
		t.set(1);
		expect(msgs.some((m) => m[0] === "ERROR")).toBe(false);
		expect(op.deps).toEqual([s, inner2]);
		expect(msgs.filter((m) => m[0] === "DATA").at(-1)).toEqual(["DATA", 200]);
		inner1.set(101);
		expect(msgs.filter((m) => m[0] === "DATA").at(-1)).toEqual(["DATA", 200]);
		inner2.set(201);
		expect(msgs.filter((m) => m[0] === "DATA").at(-1)).toEqual(["DATA", 201]);
	});
});

describe("R-lifetime@2: a request input after a restore", () => {
	it("the first request after a restore is served", () => {
		const served: unknown[] = [];
		const holder: NodeFn = (ctx: Ctx) => {
			const writes = requestWrites(ctx, 1);
			if (writes === null) return;
			served.push(...writes);
			ctx.down([["DATA", writes.length]]);
		};
		const registry: GraphRestoreRegistry = {
			...defaultRestoreRegistry,
			holder: { ref: "holder", build: () => ({ fn: holder, setup: markRequestFirstRun }) },
		};
		const g = graph();
		g.state(1, { name: "src" });
		const req = g.state(0, { name: "req" });
		const h = g.node([g.find("src") as Node<unknown>, req], holder, {
			name: "h",
			setup: markRequestFirstRun,
			recipe: { ref: "holder" },
		});
		h.subscribe(() => {});
		req.set(1);
		expect(served).toEqual([1]);
		const checkpoint = g.checkpoint();
		served.length = 0;
		const r = restoreGraph(JSON.parse(JSON.stringify(checkpoint)), { registry });
		(r.find("h") as Node<unknown>).subscribe(() => {});
		expect(served).toEqual([]);
		asState<number>(r.find("req")).set(2);
		expect(served).toEqual([2]);
	});
});

describe("R-lifetime@2: a node released during a wave receives nothing more", () => {
	it("a quiet node let go by an earlier subscriber's end does not run, and ends with nothing", () => {
		const g = graph();
		const s = g.state(0, { name: "s" });
		let runs = 0;
		const x = g.node<number>(
			[s],
			(ctx) => {
				runs++;
				ctx.down([["DATA", ctx.deps[0].value as number]]);
			},
			{ name: "x", quiet: true, error: "manual" },
		);
		const y = g.node<number>([x], (ctx) => ctx.down([["DATA", ctx.deps[0].value as number]]), {
			name: "y",
		});
		const t = g.node<number>([s, y], () => {}, { name: "t" });
		const seen: Message[] = [];
		t.subscribe((w) => seen.push(...w));
		const before = runs;
		// s's ERROR ends t first (auto ERROR), whose closing lifetime lets go of y and then of x.
		s.error("boom");
		expect(seen.at(-1)).toEqual(["ERROR", "boom"]);
		expect(runs).toBe(before);
		expect(x.status).toMatchObject({ output: "open", lifecycle: "inactive" });
	});
});

describe("R-node@4: a profiled graph's definition gives the function as it was given", () => {
	it("definition(id).fn is the given function with and without profiling", () => {
		const fn: NodeFn = (ctx) => ctx.down([["DATA", 1]]);
		const profiled = graph({ profile: true });
		profiled.node([profiled.state(1, { name: "s" })], fn, { name: "n" });
		expect(profiled.definition("n").fn).toBe(fn);
		const plain = graph();
		plain.node([plain.state(1, { name: "s" })], fn, { name: "n" });
		expect(plain.definition("n").fn).toBe(fn);
	});
});
