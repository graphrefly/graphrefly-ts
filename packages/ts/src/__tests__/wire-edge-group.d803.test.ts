/**
 * Wire edge groups (R-bridge@2; graphrefly:D803, D804): C-1 (a diamond split across two graphs)
 * and C-1b (a group releases each cause whole, in order and at most once per session). The tests
 * carry frames by hand; C-1's frames cross as canonical `WireEdgeCause` bytes (C-1a's codec).
 */

import { describe, expect, it } from "vitest";
import {
	decodeCanonicalWireEdgeCause,
	encodeCanonicalWireEdgeCause,
	frameSink,
	frameSource,
	type WireEdgeCause,
	type WireEdgeGroupIssue,
	wireEdgeGroupIn,
	wireEdgeGroupOut,
} from "../adapters/index.js";
import { type Ctx, depLatest, depWaves } from "../ctx/types.js";
import { graph } from "../graph/graph.js";
import type { Message, Wave } from "../protocol/messages.js";

const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const dec = (b: unknown) => JSON.parse(new TextDecoder().decode(b as Uint8Array));

/**
 * An in-memory channel the test delivers by hand: send queues a frame, flush delivers queued frames
 * to the receiving end, hand delivers a frame the test built. With `bytes`, every frame crosses as
 * canonical WireEdgeCause bytes.
 */
function channel(bytes = false) {
	let deliver: ((frame: unknown) => void) | null = null;
	const queue: WireEdgeCause[] = [];
	const carry = (f: WireEdgeCause): unknown =>
		bytes ? decodeCanonicalWireEdgeCause(encodeCanonicalWireEdgeCause(f)) : f;
	return {
		queue,
		send: (f: WireEdgeCause) => queue.push(f),
		open: (d: (frame: unknown) => void) => {
			deliver = d;
			return () => {
				deliver = null;
			};
		},
		flush(n = queue.length) {
			for (const f of queue.splice(0, n)) deliver?.(carry(f));
		},
		hand: (f: unknown) => deliver?.(f),
	};
}

/** Counts a node function's runs and keeps the latest input values each run saw. */
function counted(fn: (ctx: Ctx) => void) {
	const runs: unknown[][] = [];
	const wrapped = (ctx: Ctx) => {
		runs.push(
			ctx.waveData.map((_, i) => {
				const v = depLatest(ctx, i);
				return v === undefined ? undefined : dec(v);
			}),
		);
		fn(ctx);
	};
	return { fn: wrapped, runs };
}

const mapNode = (f: (v: number) => number) => (ctx: Ctx) => {
	if (depWaves(ctx, 0).some((w) => w.length > 0))
		ctx.down([["DATA", enc(f(dec(depLatest(ctx, 0))))]]);
};
const dataOf = (msgs: Wave) => msgs.filter((m) => m[0] === "DATA").map((m) => m[1]);
const body = (msgs: Wave | undefined) =>
	(msgs ?? [])
		.filter((m) => m[0] !== "PENDING")
		.map((m) => (m.length > 1 ? [m[0], dec((m as readonly [string, unknown])[1])] : [...m]));
const types = (msgs: Wave) => msgs.map((m) => m[0]);

/** C-1: A and D in g1, B and C in g2; ga carries a from g1 to g2, gbc carries b and c back. */
function crossGraphDiamond() {
	const c1 = channel(true); // ga's frames, g1 -> g2
	const c2 = channel(true); // gbc's frames, g2 -> g1
	const g1 = graph();
	const g2 = graph();
	const A = g1.state<Uint8Array>(enc(1), { name: "A" });
	const ga = wireEdgeGroupOut(g1, { group: "ga", edges: { a: A } });
	const gaFrames = frameSource(g2, c1.open, { name: "ga.frames" });
	const gaIn = wireEdgeGroupIn(g2, { group: "ga", frames: gaFrames, edges: ["a"] });
	const inA = gaIn.inbound.get("a")!;
	const bFn = counted(mapNode((a) => a * 10));
	const cFn = counted(mapNode((a) => a * 100));
	const B = g2.node<Uint8Array>([inA], bFn.fn, { name: "B" });
	const C = g2.node<Uint8Array>([inA], cFn.fn, { name: "C" });
	const gbc = wireEdgeGroupOut(g2, { group: "gbc", edges: { b: B, c: C } });
	const gbcFrames = frameSource(g1, c2.open, { name: "gbc.frames" });
	const gbcIn = wireEdgeGroupIn(g1, { group: "gbc", frames: gbcFrames, edges: ["b", "c"] });
	const dFn = counted((ctx) => {
		const b = depLatest(ctx, 0);
		const c = depLatest(ctx, 1);
		if (b !== undefined && c !== undefined) ctx.down([["DATA", enc(`${dec(b)}:${dec(c)}`)]]);
	});
	const D = g1.node<Uint8Array>([gbcIn.inbound.get("b")!, gbcIn.inbound.get("c")!], dFn.fn, {
		name: "D",
	});
	const dArrays: unknown[][] = [];
	D.subscribe((msgs) => {
		const data = dataOf(msgs).map(dec);
		if (msgs[0]?.[0] !== "START") dArrays.push(data);
	});
	gbc.subscribe(frameSink(c2.send));
	ga.subscribe(frameSink(c1.send));
	return { A, c1, c2, bFn, cFn, dFn, dArrays };
}

describe("C-1 — a diamond split across two graphs runs its fan-in once per sender wave (R-bridge)", () => {
	it("each write of A is one cause each way, and D runs once on legs of the same A", () => {
		const { A, c1, c2, bFn, cFn, dFn, dArrays } = crossGraphDiamond();
		expect(c1.queue.map((f) => f.cause)).toEqual([1]);
		c1.flush();
		// gbc's first cause (no values yet) and the cause for A's first value
		expect(c2.queue.map((f) => f.cause)).toEqual([1, 2]);
		expect(c2.queue[0]?.edges.map((e) => [e.edgeId, types(e.arrays[0]!)])).toEqual([
			["b", ["INVALIDATE"]],
			["c", ["INVALIDATE"]],
		]);
		expect(c2.queue[1]?.edges.map((e) => e.edgeId)).toEqual(["b", "c"]); // one cause, both legs
		c2.flush();
		expect(dArrays.at(-1)).toEqual(["10:100"]); // D starts on B's and C's values over A's first
		const runs = dFn.runs.length;
		const bRuns = bFn.runs.length;
		const cRuns = cFn.runs.length;
		const arrays = dArrays.length;

		A.set(enc(2));
		expect(c1.queue).toHaveLength(1); // one g1 wave, one ga cause
		c1.flush();
		expect(bFn.runs.length - bRuns).toBe(1); // one g2 wave: B and C each run once
		expect(cFn.runs.length - cRuns).toBe(1);
		expect(c2.queue).toHaveLength(1); // one gbc cause carrying both legs
		expect(c2.queue[0]?.edges.map((e) => e.edgeId)).toEqual(["b", "c"]);
		c2.flush();
		expect(dFn.runs.length).toBe(runs + 1); // D runs once
		expect(dFn.runs.at(-1)).toEqual([20, 200]);
		expect(dArrays.slice(arrays)).toEqual([["20:200"]]); // D's sinks get one array

		A.set(enc(3));
		c1.flush();
		A.set(enc(4));
		c1.flush();
		expect(c2.queue).toHaveLength(2); // held back
		c2.flush();
		expect(dFn.runs.slice(-2)).toEqual([
			[30, 300],
			[40, 400],
		]); // two held causes, two g1 waves, in order
		for (const [b, c] of dFn.runs.filter(([b, c]) => b !== undefined && c !== undefined))
			expect(c).toBe((b as number) * 10); // D never runs on one new and one old leg
	});
});

/** C-1b: a sender with edges x and y, a receiver with fan-in F over inbound x and y. */
function oneHop(opts: { twoArrays?: boolean } = {}) {
	const ch = channel();
	const s = graph();
	const r = graph();
	const x = s.state<Uint8Array>(enc("x0"), { name: "x" });
	const y = s.state<Uint8Array>(enc("y0"), { name: "y" });
	// x2 sends two arrays in one wave for each value of x.
	const x2 = s.node<Uint8Array>(
		[x],
		(ctx) => {
			if (!depWaves(ctx, 0).some((w) => w.length > 0)) return;
			const v = dec(depLatest(ctx, 0));
			ctx.down([["DATA", enc(`${v}a`)]]);
			ctx.down([
				["DATA", enc(`${v}b`)],
				["DATA", enc(`${v}c`)],
			]);
		},
		{ name: "x2" },
	);
	const out = wireEdgeGroupOut(s, { group: "g", edges: { x: opts.twoArrays ? x2 : x, y } });
	const frames = frameSource(r, ch.open, { name: "frames" });
	const grp = wireEdgeGroupIn(r, { group: "g", frames, edges: ["x", "y"] });
	const inX = grp.inbound.get("x")!;
	const inY = grp.inbound.get("y")!;
	const fFn = counted(() => {});
	const F = r.node([inX, inY], fFn.fn, {
		name: "F",
		partial: true,
		complete: "manual",
		error: "manual",
		invalidate: "manual",
	});
	const got = { x: [] as Wave[], y: [] as Wave[], issues: [] as WireEdgeGroupIssue[] };
	const stops = {
		x: inX.subscribe((m) => got.x.push(m)),
		y: inY.subscribe((m) => got.y.push(m)),
		issues: grp.issues.subscribe((m) => got.issues.push(...(dataOf(m) as WireEdgeGroupIssue[]))),
		f: F.subscribe(() => {}),
		out: out.subscribe(frameSink(ch.send)),
	};
	const reopen = () => {
		stops.out();
		return () => {
			stops.out = out.subscribe(frameSink(ch.send));
		};
	};
	return { s, r, x, y, out, ch, inX, inY, fFn, got, stops, reopen };
}

describe("C-1b — a wire edge group releases each cause whole, in order, at most once (R-bridge)", () => {
	it("the first cause carries the snapshots; each sender wave is one cause of the edges that sent", () => {
		const { s, x, y, ch, fFn, got } = oneHop();
		expect(ch.queue.map((f) => [f.cause, f.edges.map((e) => e.edgeId)])).toEqual([[1, ["x", "y"]]]);
		ch.flush();
		expect(body(got.x.at(-1))).toEqual([["DATA", "x0"]]);
		const runs = fFn.runs.length;

		x.set(enc("x1"));
		y.set(enc("y1"));
		s.batch(() => {
			x.set(enc("x2"));
			y.set(enc("y2"));
		});
		expect(ch.queue.map((f) => [f.cause, f.edges.map((e) => e.edgeId)])).toEqual([
			[2, ["x"]],
			[3, ["y"]],
			[4, ["x", "y"]],
		]);
		ch.flush(1);
		expect(body(got.y.at(-1))).toEqual([["RESOLVED"]]); // an edge the cause does not carry sends nothing
		expect(fFn.runs.length).toBe(runs + 1); // one receiver wave, F runs once
		ch.flush();
		expect(fFn.runs.length).toBe(runs + 3);
		expect(fFn.runs.at(-1)).toEqual(["x2", "y2"]);
	});

	it("an edge's arrays cross as they were sent, INVALIDATE and COMPLETE included", () => {
		const { x, y, ch, got } = oneHop({ twoArrays: true });
		ch.flush();
		x.set(enc("k"));
		expect(ch.queue.at(-1)?.edges[0]?.arrays.map((a) => a.map((m) => dec(m[1])))).toEqual([
			["ka"],
			["kb", "kc"],
		]); // two arrays stay two
		const before = got.x.length;
		ch.flush();
		expect(got.x.slice(before).map(body)).toEqual([
			[["DATA", "ka"]],
			[
				["DATA", "kb"],
				["DATA", "kc"],
			],
		]);

		x.invalidate();
		y.complete();
		const n = got.x.length;
		ch.flush();
		expect(got.x.slice(n).map(body)).toEqual([[["INVALIDATE"]], [["RESOLVED"]]]);
		expect(body(got.y.at(-1))).toEqual([["COMPLETE"]]);
	});

	it("a new session starts the count again and invalidates an edge it has no value for", () => {
		const { x, ch, got, reopen } = oneHop();
		ch.flush();
		const first = got.x.length;
		const open = reopen(); // the outbound node's lifetime, the session, ends
		x.invalidate();
		open();
		const [frame] = ch.queue;
		expect(frame?.cause).toBe(1);
		expect(frame?.edges.map((e) => [e.edgeId, e.arrays[0]?.[0]?.[0]])).toEqual([
			["x", "INVALIDATE"],
			["y", "DATA"],
		]);
		ch.flush();
		expect(body(got.x.at(-1))).toEqual([["INVALIDATE"]]); // the old session's x is dropped
		expect(got.x.length).toBeGreaterThan(first);
		expect(got.issues).toEqual([]); // a new session is not a gap or a stale cause
	});

	it("an ended inbound edge takes nothing more, and a new session's INVALIDATE still lands (D804)", () => {
		const { x, y, ch, got, reopen } = oneHop();
		ch.flush();
		y.complete();
		ch.flush();
		expect(body(got.y.at(-1))).toEqual([["COMPLETE"]]);
		const open = reopen();
		x.invalidate();
		open();
		expect(ch.queue[0]?.edges.map((e) => [e.edgeId, e.arrays.map(types)])).toEqual([
			["x", [["INVALIDATE"]]],
			["y", [["DATA"], ["COMPLETE"]]],
		]); // the first cause repeats y's snapshot and its COMPLETE
		ch.flush();
		expect(body(got.x.at(-1))).toEqual([["INVALIDATE"]]); // x's stale value is dropped
		expect(got.issues).toEqual([]); // a repeated snapshot ending in its terminal is no issue
	});

	it("an edge that has no value but has ended gets an INVALIDATE ahead of its COMPLETE (D804)", () => {
		const { x, ch, got, reopen } = oneHop();
		ch.flush();
		const open = reopen();
		x.invalidate();
		x.complete();
		open();
		expect(ch.queue[0]?.edges[0]?.arrays.map(types)).toEqual([["INVALIDATE"], ["COMPLETE"]]);
		ch.flush();
		expect(got.x.slice(-2).map(body)).toEqual([[["INVALIDATE"]], [["COMPLETE"]]]); // no old value
	});

	it("stale causes are dropped, a gap is released and reported, bad frames are refused whole", () => {
		const { x, ch, got, fFn } = oneHop();
		ch.flush();
		x.set(enc("x1"));
		const sent = ch.queue[0]!;
		ch.flush();
		const session = sent.session;
		const xData = () =>
			got.x
				.flat()
				.filter((m) => m[0] === "DATA")
				.map((m) => dec(m[1]));
		const frame = (cause: number, edges: unknown[]) => ({ group: "g", session, cause, edges });
		const data = (v: unknown): Message[][] => [[["DATA", enc(v)]]];

		ch.hand(sent); // a duplicate of a released cause
		ch.hand(frame(1, [{ edgeId: "x", arrays: data("old") }])); // an older cause
		expect(xData()).toEqual(["x0", "x1"]); // neither is released
		ch.hand(frame(4, [{ edgeId: "x", arrays: data("x4") }])); // two past the last (2)
		expect(fFn.runs.at(-1)).toEqual(["x4", "y0"]); // the cause past the next is released
		ch.hand(frame(5, [{ edgeId: "z", arrays: data("z") }]));
		ch.hand(frame(6, [{ edgeId: "x", arrays: [[["PENDING"]]] }]));
		ch.hand(frame(7, [{ edgeId: "x", arrays: [[["RESOLVED"]]] }]));
		ch.hand(
			frame(8, [
				{ edgeId: "y", arrays: [[["COMPLETE"]]] },
				{ edgeId: "x", arrays: data("x8") },
			]),
		); // valid: y completes
		ch.hand(
			frame(9, [
				{ edgeId: "y", arrays: data("after end") },
				{ edgeId: "x", arrays: data("x9") },
			]),
		); // y has ended: its arrays are skipped and the divergence reported
		ch.hand(frame(10, [{ edgeId: "x", arrays: [[["COMPLETE"]], ...data("x10")] }]));
		ch.hand({ ...frame(11, [{ edgeId: "x", arrays: data("other") }]), group: "other" });
		ch.hand(frame(11, [{ edgeId: "x", arrays: data("x11") }]));
		expect(fFn.runs.at(-1)).toEqual(["x11", "y0"]); // refused frames released nothing; 11 is no gap
		expect(xData()).toContain("x9"); // frame 9 is released without y's arrays
		expect(xData()).not.toContain("other");
		expect(
			got.issues.map((i) => [
				i.kind,
				"cause" in i ? i.cause : "from" in i ? i.from : undefined,
				...("edgeId" in i ? [i.edgeId] : []),
			]),
		).toEqual([
			["stale", 2],
			["stale", 1],
			["gap", 3],
			["refused", 5],
			["refused", 6],
			["refused", 7],
			["ended", 9, "y"],
			["refused", 10],
		]);
		expect(got.y.flat().some((m) => m[0] === "COMPLETE")).toBe(true); // frame 8 was valid
		expect(got.x.flat().some((m) => m[0] === "ERROR")).toBe(false); // no inbound node fails
		expect(got.x.flat().some((m) => m[0] === "COMPLETE")).toBe(false);
	});

	it("a late subscriber to an inbound edge gets what the edge last brought", () => {
		const { x, y, ch, inY, stops } = oneHop();
		ch.flush();
		y.set(enc("y1"));
		x.set(enc("x1")); // the last cause carries only x
		ch.flush();
		stops.y();
		stops.f(); // inbound y deactivates and drops its private state
		const late: Wave[] = [];
		inY.subscribe((m) => late.push(m));
		expect(body(late[0])).toEqual([["START"], ["DATA", "y1"]]);
	});

	it("a value that is not bytes is a throw of the outbound node, so its ERROR", () => {
		const s = graph();
		const x = s.state<Uint8Array>(enc(1), { name: "x" });
		const out = wireEdgeGroupOut(s, { group: "g", edges: { x } });
		const seen: Wave[] = [];
		out.subscribe((m) => seen.push(m));
		x.set(2 as unknown as Uint8Array);
		const error = seen.flat().find((m) => m[0] === "ERROR");
		expect(String((error as readonly [string, unknown] | undefined)?.[1])).toMatch(/not bytes/);
	});

	it("sets no timer and sends nothing up either graph", () => {
		const { x, ch } = oneHop();
		const before = (globalThis.setTimeout as unknown as { mock?: unknown }).mock;
		ch.flush();
		x.set(enc("x1"));
		ch.flush();
		expect(before).toBeUndefined();
		// The bridge module never reaches a timer or an upward channel: grep-level check.
		const source = String(wireEdgeGroupIn) + String(wireEdgeGroupOut) + String(frameSource);
		expect(source).not.toMatch(/setTimeout|setInterval|\.up\(/);
	});
});
