/**
 * Higher-order operators — switchMap / mergeMap / concatMap / exhaustMap / flatMap
 * (D47 / R-rewire-deferred / CSP-2.7). Per-language sugar (D6/D24); built on the deferred
 * self-rewire substrate (ctx.rewireNext) + the g.initNode funnel (D43). Each test drives a
 * controllable inner "subject" so the flatten policy + inner-lifecycle folding are observable.
 */

import { describe, expect, it } from "vitest";
import type { Ctx, Message } from "../index.js";
import {
	concatMap,
	Dispatcher,
	depLatest,
	exhaustMap,
	flatMap,
	graph,
	initNode,
	map,
	mergeMap,
	node,
	of,
	repeat,
	switchMap,
} from "../index.js";

function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}
const data = (m: Message[]) =>
	m.filter((x) => x[0] === "DATA").map((x) => (x as ["DATA", unknown])[1]);
const coreOf = (n: object) => (n as unknown as Record<string, unknown>)._core;

class CountingDispatcher extends Dispatcher {
	register(...args: Parameters<Dispatcher["register"]>): ReturnType<Dispatcher["register"]> {
		this.registerCount += 1;
		return super.register(...args);
	}
	registerCount = 0;
}

/** A controllable inner source whose activation + deactivation (cancellation) are observable. */
function subject() {
	let ctxRef: Ctx | null = null;
	let activated = false;
	let deactivated = false;
	const n = node<number>([], (ctx) => {
		ctxRef = ctx;
		activated = true;
		ctx.onDeactivation(() => {
			deactivated = true;
		});
	});
	return {
		node: n,
		next: (v: number) => (ctxRef as Ctx).down([["DATA", v]]),
		complete: () => (ctxRef as Ctx).down([["COMPLETE"]]),
		error: (e: unknown) => (ctxRef as Ctx).down([["ERROR", e]]),
		emit: (msgs: Message[]) => (ctxRef as Ctx).down(msgs),
		isActivated: () => activated,
		isDeactivated: () => deactivated,
	};
}

describe("mergeMap (D47 / R-rewire-deferred)", () => {
	it("binds coerced runtime inners to the owning graph dispatcher/core (B34b / D22)", () => {
		const dispatcher = new CountingDispatcher();
		const g = graph({ dispatcher });
		const s = g.node<number>([], null);
		const op = g.initNode(
			mergeMap((v: number) => [v, v + 1]),
			[s],
		);

		expect(dispatcher.registerCount).toBe(1); // the mergeMap operator body itself
		const { msgs } = collect(op);
		s.down([["DATA", 1]]);

		expect(dispatcher.registerCount).toBeGreaterThan(1); // the fromAny/fromIter inner
		expect(data(msgs)).toEqual([1, 2]);
	});

	it("does not let coercion-time user getters consume the graph core binding (B34b)", () => {
		const dispatcher = new CountingDispatcher();
		const g = graph({ dispatcher });
		const s = g.node<number>([], null);
		let trapNode: object | null = null;
		const target = {};
		const thenKey = "th" + "en";
		Object.defineProperty(target, thenKey, { value: () => undefined });
		const input = new Proxy(target, {
			get(target, prop, receiver) {
				if (prop === thenKey && trapNode === null) trapNode = node<number>([], null);
				return Reflect.get(target, prop, receiver);
			},
		}) as PromiseLike<number>;
		const op = g.initNode(
			mergeMap(() => input),
			[s],
		);

		collect(op);
		s.down([["DATA", 1]]);
		const inner = op.deps[1];

		expect(trapNode).not.toBeNull();
		expect(coreOf(trapNode as object)).not.toBe(coreOf(op));
		expect(inner).toBeDefined();
		expect(coreOf(inner as object)).toBe(coreOf(op));
		expect(dispatcher.registerCount).toBeGreaterThan(1);
	});

	it("keeps all inners live and interleaves their emissions; a completed inner is bounded", () => {
		const a = subject();
		const b = subject();
		const g = graph();
		const s = g.node([], null); // manual source
		const op = g.initNode(
			mergeMap((v: number) => (v === 1 ? a.node : b.node)),
			[s],
		);
		const { msgs } = collect(op);

		s.down([["DATA", 1]]); // → inner a added
		s.down([["DATA", 2]]); // → inner b added (a stays live — merge)
		expect(a.isActivated()).toBe(true);
		expect(b.isActivated()).toBe(true);

		a.next(10);
		b.next(20);
		a.next(11);
		expect(data(msgs)).toEqual([10, 20, 11]); // interleaved (concurrent inners)

		a.complete(); // inner a done → unsubscribeDep → deactivated (bounding); b unaffected
		expect(a.isDeactivated()).toBe(true);
		expect(b.isDeactivated()).toBe(false);

		b.next(21);
		expect(data(msgs)).toEqual([10, 20, 11, 21]);
	});

	it("a projector returning an ALREADY-LIVE inner is merged once (no inners↔deps desync)", () => {
		// QA fix (mutation-verified): subscribeDep is set-idempotent, so a duplicate-projected Node must
		// not be double-tracked in `inners` — otherwise the inners[i]↔deps[i+1] map skews by one and
		// a LATER inner COMPLETE removes the WRONG (already-gone) inner, leaking the real one. The
		// leak only surfaces on a subsequent removal, so we drive X (twice → dup), then a distinct Y,
		// then complete both and assert Y is actually torn down.
		const x = subject();
		const y = subject();
		const g = graph();
		const s = g.node([], null);
		const op = g.initNode(
			mergeMap((v: number) => (v === 3 ? y.node : x.node)),
			[s],
		);
		collect(op);

		s.down([["DATA", 1]]); // add x
		s.down([["DATA", 2]]); // re-project x → already live → skipped (no double-track)
		s.down([["DATA", 3]]); // add a DISTINCT inner y
		x.complete(); // remove x → deps=[S,y]
		y.complete(); // remove y — only correct if inners stayed aligned (else x's stale slot is hit)
		expect(x.isDeactivated()).toBe(true);
		expect(y.isDeactivated()).toBe(true); // WITHOUT the dedup guard this stays false (wrong slot removed)
	});

	it("flatMap is an alias of mergeMap", () => {
		const a = subject();
		const g = graph();
		const s = g.node([], null);
		const op = g.initNode(
			flatMap((_v: number) => a.node),
			[s],
		);
		const { msgs } = collect(op);
		s.down([["DATA", 1]]);
		a.next(7);
		expect(data(msgs)).toEqual([7]);
	});

	it("COMPLETEs when the source is done AND every inner has completed", () => {
		const a = subject();
		const g = graph();
		const s = g.node([], null);
		const op = g.initNode(
			mergeMap((_v: number) => a.node),
			[s],
		);
		const { msgs } = collect(op);

		s.down([["DATA", 1]]); // add inner a
		s.down([["COMPLETE"]]); // source done, but inner a still live → NOT complete yet
		expect(op.status).not.toBe("completed");

		a.next(9);
		a.complete(); // last inner done + source done → op COMPLETEs
		expect(data(msgs)).toEqual([9]);
		expect(op.status).toBe("completed");
	});

	it("a throwing projector → ERROR (D30, self-catch survives rewire)", () => {
		const g = graph();
		const s = g.node([], null);
		const op = g.initNode(
			mergeMap((_v: number) => {
				throw new Error("boom");
			}),
			[s],
		);
		collect(op);
		s.down([["DATA", 1]]);
		expect(op.status).toBe("errored");
	});

	it("source ERROR detaches every live inner before emitting ERROR (D81)", () => {
		const a = subject();
		const b = subject();
		const g = graph();
		const s = g.node([], null);
		const op = g.initNode(
			mergeMap((v: number) => (v === 1 ? a.node : b.node)),
			[s],
		);
		const { msgs } = collect(op);

		s.down([["DATA", 1]]);
		s.down([["DATA", 2]]);
		a.next(10);
		const err = new Error("source boom");
		s.down([["ERROR", err]]);

		expect(op.status).toBe("errored");
		expect(msgs.at(-1)).toEqual(["ERROR", err]);
		expect(a.isDeactivated()).toBe(true);
		expect(b.isDeactivated()).toBe(true);
		expect(op.deps).toEqual([s]);
		expect(a.node.status).not.toBe("completed");
		expect(a.node.status).not.toBe("errored");
		expect(b.node.status).not.toBe("completed");
		expect(b.node.status).not.toBe("errored");

		const afterError = msgs.length;
		a.next(11);
		b.next(20);
		s.down([["DATA", 3]]);
		expect(msgs).toHaveLength(afterError);
	});

	it("inner ERROR detaches sibling inners before emitting ERROR (D81)", () => {
		const a = subject();
		const b = subject();
		const g = graph();
		const s = g.node([], null);
		const op = g.initNode(
			mergeMap((v: number) => (v === 1 ? a.node : b.node)),
			[s],
		);
		const { msgs } = collect(op);

		s.down([["DATA", 1]]);
		s.down([["DATA", 2]]);
		b.next(20);
		const err = new Error("inner boom");
		a.error(err);

		expect(op.status).toBe("errored");
		expect(msgs.at(-1)).toEqual(["ERROR", err]);
		expect(a.isDeactivated()).toBe(true);
		expect(b.isDeactivated()).toBe(true);
		expect(op.deps).toEqual([s]);
		expect(b.node.status).not.toBe("completed");
		expect(b.node.status).not.toBe("errored");

		const afterError = msgs.length;
		b.next(21);
		s.down([["DATA", 3]]);
		expect(msgs).toHaveLength(afterError);
		expect(msgs.some((m) => m[0] === "COMPLETE")).toBe(false);
	});

	it("inner DATA in the same wave before ERROR is forwarded before cleanup (D81)", () => {
		const a = subject();
		const g = graph();
		const s = g.node([], null);
		const op = g.initNode(
			mergeMap((_v: number) => a.node),
			[s],
		);
		const { msgs } = collect(op);
		const err = new Error("inner boom");

		s.down([["DATA", 1]]);
		a.emit([
			["DATA", 10],
			["ERROR", err],
		]);

		expect(data(msgs)).toEqual([10]);
		expect(msgs.at(-1)).toEqual(["ERROR", err]);
		expect(a.isDeactivated()).toBe(true);
		expect(op.deps).toEqual([s]);
	});

	it("projector ERROR detaches previously-live inners and seals later output (D81)", () => {
		const a = subject();
		const g = graph();
		const s = g.node([], null);
		const op = g.initNode(
			mergeMap((v: number) => {
				if (v === 2) throw new Error("projector boom");
				return a.node;
			}),
			[s],
		);
		const { msgs } = collect(op);

		s.down([["DATA", 1]]);
		a.next(10);
		s.down([["DATA", 2]]);

		expect(op.status).toBe("errored");
		expect(msgs.at(-1)?.[0]).toBe("ERROR");
		expect(a.isDeactivated()).toBe(true);
		expect(op.deps).toEqual([s]);
		expect(a.node.status).not.toBe("completed");
		expect(a.node.status).not.toBe("errored");

		const afterError = msgs.length;
		a.next(11);
		s.down([["DATA", 3]]);
		expect(msgs).toHaveLength(afterError);
	});
});

describe("switchMap (D47)", () => {
	it("cancels the in-flight inner on a new source value (abortInFlight) and forwards only the current", () => {
		const a = subject();
		const b = subject();
		const g = graph();
		const s = g.node([], null);
		const op = g.initNode(
			switchMap((v: number) => (v === 1 ? a.node : b.node)),
			[s],
		);
		const { msgs } = collect(op);

		s.down([["DATA", 1]]); // → inner a
		a.next(10);
		expect(data(msgs)).toEqual([10]);

		s.down([["DATA", 2]]); // switch → inner b; a is CANCELLED (source torn down)
		expect(a.isDeactivated()).toBe(true);
		expect(b.isActivated()).toBe(true);

		a.next(99); // the superseded inner is drained — no stale forward
		b.next(20);
		expect(data(msgs)).toEqual([10, 20]);
	});

	it("re-projecting the same live inner does not cancel or duplicate it", () => {
		const inner = subject();
		const g = graph();
		const s = g.node([], null);
		const op = g.initNode(
			switchMap((_v: number) => inner.node),
			[s],
		);
		const { msgs } = collect(op);

		s.down([["DATA", 1]]);
		expect(inner.isActivated()).toBe(true);
		expect(op.deps).toEqual([s, inner.node]);

		s.down([["DATA", 2]]);
		expect(inner.isDeactivated()).toBe(false);
		expect(op.deps).toEqual([s, inner.node]);

		inner.next(10);
		expect(data(msgs)).toEqual([10]);
	});
});

describe("concatMap (D47)", () => {
	it("runs inners one at a time in source order; later source values queue", () => {
		const a = subject();
		const b = subject();
		const g = graph();
		const s = g.node([], null);
		const op = g.initNode(
			concatMap((v: number) => (v === 1 ? a.node : b.node)),
			[s],
		);
		const { msgs } = collect(op);

		s.down([["DATA", 1]]); // activate inner a
		s.down([["DATA", 2]]); // QUEUED — a is still active (b not yet activated)
		expect(a.isActivated()).toBe(true);
		expect(b.isActivated()).toBe(false);

		a.next(10);
		a.complete(); // a done → activate the queued b
		expect(b.isActivated()).toBe(true);
		b.next(20);
		expect(data(msgs)).toEqual([10, 20]); // order preserved
	});

	it("source ERROR clears queued values and detaches the active inner (D81)", () => {
		const a = subject();
		const b = subject();
		const g = graph();
		const s = g.node([], null);
		const op = g.initNode(
			concatMap((v: number) => (v === 1 ? a.node : b.node)),
			[s],
		);
		const { msgs } = collect(op);

		s.down([["DATA", 1]]);
		s.down([["DATA", 2]]); // queued behind a
		const err = new Error("source boom");
		s.down([["ERROR", err]]);

		expect(op.status).toBe("errored");
		expect(msgs.at(-1)).toEqual(["ERROR", err]);
		expect(a.isDeactivated()).toBe(true);
		expect(b.isActivated()).toBe(false);
		expect(op.deps).toEqual([s]);

		a.complete();
		expect(b.isActivated()).toBe(false);
		expect(msgs.filter((m) => m[0] === "DATA")).toEqual([]);
	});
});

describe("exhaustMap (D47)", () => {
	it("drops source values that arrive while an inner is active", () => {
		const a = subject();
		const b = subject();
		const c = subject();
		const g = graph();
		const s = g.node([], null);
		const project = (v: number) => (v === 1 ? a.node : v === 2 ? b.node : c.node);
		const op = g.initNode(exhaustMap(project), [s]);
		const { msgs } = collect(op);

		s.down([["DATA", 1]]); // activate inner a
		s.down([["DATA", 2]]); // DROPPED — a is active
		expect(a.isActivated()).toBe(true);
		expect(b.isActivated()).toBe(false); // value 2 never projected

		a.next(10);
		a.complete(); // a done → exhaust free again
		s.down([["DATA", 3]]); // now accepted → inner c
		expect(c.isActivated()).toBe(true);
		c.next(30);
		expect(data(msgs)).toEqual([10, 30]); // the value-2 inner never contributed
	});
});

describe("repeat (D47 self-rewire, factory-based — clean-slate complete design)", () => {
	it("plays a fresh factory()-minted source `count` times in sequence, then COMPLETE", () => {
		const g = graph();
		// factory mints a FRESH source each round (clean-slate hot nodes can't be re-run in place);
		// `() => [1, 2]` → fromAny(iter) → fromIter([1,2]) → emits 1,2,COMPLETE per round.
		const r = g.initNode(
			repeat<number>(() => [1, 2], 3),
			[],
		);
		const { msgs } = collect(r);
		expect(data(msgs)).toEqual([1, 2, 1, 2, 1, 2]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
		expect(r.status).toBe("completed");
	});

	it("count=1 plays the source exactly once", () => {
		const g = graph();
		const r = g.initNode(
			repeat<number>(() => [7], 1),
			[],
		);
		const { msgs } = collect(r);
		expect(data(msgs)).toEqual([7]);
		expect(r.status).toBe("completed");
	});

	it("an inner ERROR aborts repeat (errorWhenDepsError)", () => {
		const g = graph();
		// round 1 errors via a throwing projector inner (a derived that throws → D30 ERROR).
		const r = g.initNode(
			repeat<number>(() => {
				const gg = graph();
				const s = gg.state(0);
				return gg.derived([s], () => {
					throw new Error("inner boom");
				});
			}, 3),
			[],
		);
		const { msgs } = collect(r);
		expect(r.status).toBe("errored");
		expect(msgs.some((m) => m[0] === "ERROR")).toBe(true);
	});

	it("a throwing repeat factory is caught and emitted as ERROR", () => {
		const g = graph();
		const boom = new Error("repeat factory boom");
		const r = g.initNode(
			repeat<number>(() => {
				throw boom;
			}, 2),
			[],
		);

		const { msgs } = collect(r);
		expect(msgs.at(-1)).toEqual(["ERROR", boom]);
		expect(r.status).toBe("errored");
	});

	it("describe shows repeat's real factory name + its live inner (D6/D51)", () => {
		const g = graph();
		g.initNode(
			repeat<number>(() => [1], 2),
			[],
			{ name: "rep" },
		);
		const snap = g.describe();
		const rep = snap.nodes.find((dn) => dn.id === "rep");
		expect(rep?.factory).toBe("repeat");
	});
});

describe("higher-order — describe (D39 / D51): real factory name + LIVE inner topology", () => {
	it("records the operator's real factory name; before any source value, only the construction edge", () => {
		const a = subject();
		const g = graph();
		const s = g.node([], null, { name: "src" });
		g.initNode(
			switchMap((_v: number) => a.node),
			[s],
			{ name: "sw" },
		);
		const snap = g.describe();
		const sw = snap.nodes.find((dn) => dn.id === "sw");
		expect(sw?.factory).toBe("switchMap"); // D6/R-describe: REAL operator name, not "node"
		expect(sw?.deps).toEqual(["src"]); // no inner wired yet — just the construction edge
		expect(snap.edges).toContainEqual({ from: "src", to: "sw" });
	});

	it("shows a LIVE runtime inner after the operator wires it (D51 live-dep snapshot, no dangling '?')", () => {
		const a = subject();
		const g = graph();
		const s = g.node([], null, { name: "src" });
		const sw = g.initNode(
			switchMap((_v: number) => a.node),
			[s],
			{ name: "sw" },
		);
		collect(sw);
		expect(g.describe().edges).toEqual([{ from: "src", to: "sw" }]); // before: construction only

		s.down([["DATA", 1]]); // switchMap wires inner `a` as a live dep (deferred rewire drains)
		const snap = g.describe();
		// sw's live deps now include the inner; the inner is auto-discovered as a REAL snapshot node.
		const innerEdge = snap.edges.find((e) => e.to === "sw" && e.from !== "src");
		expect(innerEdge).toBeDefined(); // a live edge inner→sw (truthful, not a dangling "?")
		const innerNode = snap.nodes.find((dn) => dn.id === innerEdge?.from);
		expect(innerNode).toBeDefined(); // the inner IS emitted as a node (D51/B38 auto-discovery)
		expect(innerNode?.deps).toEqual([]); // subject() has no live deps, so it remains a leaf.
		expect(snap.nodes.find((dn) => dn.id === "sw")?.deps).toContain("src"); // S still a live dep
	});

	it("auto-discovers an unregistered live dep (a bare initNode source) WITH its factory (D51 B2 / D43)", () => {
		const g = graph();
		const inner = initNode(of(42), []); // BARE (free initNode, not g.*) → unregistered, factory "of"
		const d = g.node([inner], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]), {
			name: "d",
		});
		collect(d);
		const snap = g.describe();
		const dNode = snap.nodes.find((n) => n.id === "d");
		expect(dNode?.deps).toHaveLength(1); // d's single live dep = the bare inner
		const innerId = dNode?.deps[0] as string;
		const innerNode = snap.nodes.find((n) => n.id === innerId);
		expect(innerNode).toBeDefined(); // emitted as a node, NOT a dangling "?" edge
		expect(innerNode?.factory).toBe("of"); // named via NodeOptions.factory (D43-reserved, D51)
		expect(snap.edges).toContainEqual({ from: innerId, to: "d" });
	});

	it("auto-discovers transitive unregistered live deps (B38)", () => {
		const g = graph();
		const s = g.node([], null, { name: "src" });
		const innerLeaf = subject();
		const innerParent = initNode(
			map((n: number) => n + 1),
			[innerLeaf.node],
		);
		const sw = g.initNode(
			switchMap((_v: number) => innerParent),
			[s],
			{ name: "sw" },
		);
		collect(sw);
		s.down([["DATA", 1]]);
		innerLeaf.next(41);
		const snap = g.describe();
		const swNode = snap.nodes.find((n) => n.id === "sw");
		const parentId = swNode?.deps.find((id) => id !== "src");
		expect(parentId).toBeDefined();
		const parentNode = snap.nodes.find((n) => n.id === parentId);
		expect(parentNode?.factory).toBe("map");
		expect(parentNode?.deps.length).toBe(1);
		const leafId = parentNode?.deps[0];
		expect(leafId).toBeDefined();
		const leafNode = snap.nodes.find((n) => n.id === leafId);
		expect(leafNode).toBeDefined();
		expect(snap.edges).toContainEqual({ from: leafId as string, to: parentId as string });
	});
});
