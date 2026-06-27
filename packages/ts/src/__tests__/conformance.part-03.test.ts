/**
 * Behavioral conformance — TS arm of ~/src/graphrefly/spec/conformance.jsonl (D24).
 *
 * Each test is the TS adapter for a language-agnostic scenario: it builds the scenario's
 * topology, drives its input wave sequence, and asserts the expected OBSERVABLE wave output.
 *
 * C-1 (cross-graph diamond) is NOT here — it requires the wire bridge (backlog B2). The
 * in-process diamond core it leans on is green in core.test.ts (R-diamond/R-two-phase).
 */

import { describe, expect, it } from "vitest";
import type { Ctx, Message, NodeFn } from "../index.js";
import { batch, depBatch, depLatest, dynamicNode, fromPromise, graph, node } from "../index.js";

const types = (msgs: Message[]) => msgs.map((m) => m[0]);
const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);
const flush = () => new Promise((r) => setTimeout(r, 0));
function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((m) => msgs.push(m));
	return { msgs, unsub };
}

// C-25 (R-rewire-deferred-committed-boundary / D110): ctx.rewireNext/ctx.upNext tasks apply only
// after the owner reaches a committed, unpaused boundary view. Rollback drops the tasks caused by
// that batch; it does not let subscribeDep/unsubscribeDep/replaceDeps/upNext leak a hidden committed effect.
describe("C-25 — deferred self-boundary tasks require committed + unpaused boundary", () => {
	function makeHelper(seed: number) {
		let hctx: Ctx | null = null;
		let activated = false;
		let deactivated = false;
		const n = node<number>([], (ctx) => {
			hctx = ctx;
			activated = true;
			ctx.onDeactivation(() => {
				deactivated = true;
			});
			ctx.down([["DATA", seed]]);
		});
		return {
			node: n,
			emit: (v: number) => (hctx as Ctx).down([["DATA", v]]),
			isActivated: () => activated,
			isDeactivated: () => deactivated,
		};
	}

	it("batch commit settles the old shape before draining a queued subscribeDep", () => {
		const s = node<number>([], null);
		const helper = makeHelper(42);
		const opFn: NodeFn = (ctx) => {
			const h = depBatch(ctx, 1);
			if (h) for (const v of h) ctx.down([["DATA", `helper:${v}`]]);
			const sv = depBatch(ctx, 0);
			if (sv && sv.length > 0) {
				ctx.rewireNext.subscribeDep(helper.node, opFn);
				ctx.down([["DATA", `source:${sv.at(-1)}`]]);
				expect(helper.isActivated()).toBe(false);
			}
		};
		const op = node<string>([s], opFn, {
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		});
		const { msgs } = collect(op);
		msgs.length = 0;

		batch(() => {
			s.down([["DATA", 1]]);
			expect(op.deps).toEqual([s]);
			expect(helper.isActivated()).toBe(false);
			expect(data(msgs)).toEqual([]);
		});

		expect(op.deps).toEqual([s, helper.node]);
		expect(helper.isActivated()).toBe(true);
		expect(data(msgs)).toEqual(["source:1", "helper:42"]);
	});

	it("rollback drops a queued subscribeDep: helper cache does not activate and deps stay old-shape", () => {
		const s = node<number>([], null, { initial: 1 });
		const helper = makeHelper(10);
		const opFn: NodeFn = (ctx) => {
			if (depBatch(ctx, 0)) ctx.rewireNext.subscribeDep(helper.node, opFn);
		};
		const op = node<number>([s], opFn, { completeWhenDepsComplete: false });

		batch((bctx) => {
			collect(op); // activation inside the open batch queues the task under that batch
			expect(op.deps).toEqual([s]);
			expect(helper.isActivated()).toBe(false);
			bctx.rollback();
		});

		expect(op.deps).toEqual([s]);
		expect(helper.isActivated()).toBe(false);
	});

	it("rollback drops a queued unsubscribeDep cleanup: helper stays subscribed and live", () => {
		const s = node<number>([], null, { initial: 1 });
		const helper = makeHelper(20);
		const opFn: NodeFn = (ctx) => {
			if (depBatch(ctx, 0)) ctx.rewireNext.unsubscribeDep(helper.node, opFn);
			const h = depBatch(ctx, 1);
			if (h) for (const v of h) ctx.down([["DATA", v as number]]);
		};
		const op = node<number>([s, helper.node], opFn, {
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		});
		let msgs: Message[] = [];

		batch((bctx) => {
			msgs = collect(op).msgs; // activation queues unsubscribeDep under the open batch
			expect(helper.isActivated()).toBe(true);
			bctx.rollback();
		});

		expect(op.deps).toEqual([s, helper.node]);
		expect(helper.isDeactivated()).toBe(false);
		msgs.length = 0;
		helper.emit(21);
		expect(data(msgs)).toEqual([21]);
	});

	it("rollback drops a queued replaceDeps: replacement helper never activates", () => {
		const s = node<number>([], null, { initial: 1 });
		const oldHelper = makeHelper(30);
		const newHelper = makeHelper(31);
		const opFn: NodeFn = (ctx) => {
			if (depBatch(ctx, 0)) ctx.rewireNext.replaceDeps([s, newHelper.node], opFn);
			const h = depBatch(ctx, 1);
			if (h) for (const v of h) ctx.down([["DATA", v as number]]);
		};
		const op = node<number>([s, oldHelper.node], opFn, {
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		});

		batch((bctx) => {
			collect(op); // activation queues replaceDeps under the open batch
			expect(oldHelper.isActivated()).toBe(true);
			bctx.rollback();
		});

		expect(op.deps).toEqual([s, oldHelper.node]);
		expect(oldHelper.isDeactivated()).toBe(false);
		expect(newHelper.isActivated()).toBe(false);
	});

	it("rollback drops ctx.upNext self-demand: no pull delivery routes after the batch", () => {
		const pullId = Symbol("c25-pull");
		const acc = node<number>([], null, { initial: 7 });
		const snap = node<number>([acc], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]), {
			pullId,
		});
		const stream = node<number>([], null, { initial: 1 });
		const received: number[] = [];
		const consumer = node<number>(
			[stream, snap],
			(ctx) => {
				const snapB = depBatch(ctx, 1);
				if (snapB) for (const v of snapB) received.push(v as number);
				if (depBatch(ctx, 0)) ctx.upNext([["PULL", { pullId }]]);
			},
			{ partial: true },
		);

		batch((bctx) => {
			collect(consumer);
			bctx.rollback();
		});

		expect(received).toEqual([]);
	});

	it("a paused owner holds queued subscribeDep until the final RESUME", () => {
		const s = node<number>([], null);
		const helper = makeHelper(50);
		const l1 = Symbol("pause-1");
		const l2 = Symbol("pause-2");
		const opFn: NodeFn = (ctx) => {
			if (depBatch(ctx, 0)) {
				ctx.rewireNext.subscribeDep(helper.node, opFn);
				ctx.down([["DATA", 1]]);
			}
		};
		const op = node<number>([s], opFn, { completeWhenDepsComplete: false });
		op.subscribe((m) => {
			if (m[0] === "DATA") {
				op.up([
					["PAUSE", l1],
					["PAUSE", l2],
				]);
			}
		});

		s.down([["DATA", 1]]);
		expect(helper.isActivated()).toBe(false);
		op.up([["RESUME", l1]]);
		expect(helper.isActivated()).toBe(false);
		op.up([["RESUME", l2]]);
		expect(helper.isActivated()).toBe(true);
	});

	it("combined batch+pause: commit before resume does not drain until resume", () => {
		const s = node<number>([], null);
		const helper = makeHelper(60);
		const lock = Symbol("pause");
		const opFn: NodeFn = (ctx) => {
			if (depBatch(ctx, 0)) {
				ctx.rewireNext.subscribeDep(helper.node, opFn);
				ctx.down([["DATA", 1]]);
			}
		};
		const op = node<number>([s], opFn, { completeWhenDepsComplete: false });
		op.subscribe((m) => {
			if (m[0] === "DATA") op.up([["PAUSE", lock]]);
		});

		batch(() => s.down([["DATA", 1]]));
		expect(helper.isActivated()).toBe(false);
		op.up([["RESUME", lock]]);
		expect(helper.isActivated()).toBe(true);
	});

	it("combined batch+pause: resume before commit still waits for batch commit", () => {
		const s = node<number>([], null, { initial: 1 });
		const helper = makeHelper(70);
		const lock = Symbol("pause");
		const opFn: NodeFn = (ctx) => {
			if (depBatch(ctx, 0)) {
				ctx.rewireNext.subscribeDep(helper.node, opFn);
				ctx.down([["DATA", 1]]);
			}
		};
		const op = node<number>([s], opFn, { completeWhenDepsComplete: false });
		op.subscribe((m) => {
			if (m[0] === "DATA") op.up([["PAUSE", lock]]);
		});

		batch(() => {
			expect(helper.isActivated()).toBe(false);
			op.up([["RESUME", lock]]);
			expect(helper.isActivated()).toBe(false);
		});
		expect(helper.isActivated()).toBe(true);
	});
});

// C-26 (R-msg-closed-set / R-tier / R-ctx-up / R-pull / R-up-routing): D269 makes PULL the
// explicit demand message with holder-visible params; RESUME remains pause-lock release only.
describe("C-26 — PULL is explicit demand with params; RESUME remains pause-only", () => {
	it("routes PULL params, drops unknown PULL, rejects DATA-up, and keeps latest owed params", () => {
		const pullId = Symbol("c26-pull");
		const acc = node<number>([], null, { initial: 0 });
		const seen: unknown[] = [];
		const snap = node<number>(
			[acc],
			(ctx) => {
				seen.push(ctx.pull?.params);
				ctx.down([["DATA", depLatest(ctx, 0) as number]]);
			},
			{ pullId },
		);
		const { msgs } = collect(snap);
		msgs.length = 0;

		acc.down([["DATA", 1]]);
		snap.up([["PULL", { pullId, params: { cursor: 7, limit: 2 } }]]);
		expect(seen).toEqual([{ cursor: 7, limit: 2 }]);
		expect(data(msgs)).toEqual([1]);

		msgs.length = 0;
		acc.down([["DATA", 2]]);
		snap.up([["RESUME", pullId]]);
		expect(msgs).toEqual([]);
		expect(seen).toHaveLength(1);

		expect(() =>
			snap.up([["PULL", { pullId: Symbol("missing"), params: { cursor: 9 } }]]),
		).not.toThrow();
		expect(msgs).toEqual([]);
		expect(() => snap.up([["DATA", 3] as Message])).toThrow(/ctx\.up|control|demand|DATA/i);

		acc.down([["DIRTY"]]);
		snap.up([["PULL", { pullId, params: { cursor: 1 } }]]);
		snap.up([["PULL", { pullId, params: { cursor: 2 } }]]);
		acc.down([["DATA", 5]]);
		expect(seen.at(-1)).toEqual({ cursor: 2 });
		expect(data(msgs)).toEqual([5]);
	});

	it("ordinary pause locks still release through RESUME without acting as pull demand", () => {
		const s = node<number>([], null, { initial: 1 });
		const n = node<number>([s], (ctx) => ctx.down([["DATA", depLatest(ctx, 0) as number]]));
		const { msgs } = collect(n);
		msgs.length = 0;
		const lock = Symbol("pause");

		n.up([["PAUSE", lock]]);
		s.down([["DATA", 2]]);
		expect(msgs).toEqual([["DIRTY"]]);
		n.up([["RESUME", lock]]);
		expect(types(msgs)).toEqual(["DIRTY", "DATA"]);
		expect(data(msgs)).toEqual([2]);
	});
});

// C-27 (R-pull / R-fn-contract / R-ctx-up): no-change PULL reaches the holder; downstream DATA is
// the helper's ordinary output decision, so params may drive retained output while plain helpers may stay silent.
describe("C-27 — PULL invokes holder without dep change and params may drive retained output", () => {
	it("invokes a retained-view holder twice over stable state and lets params change the emitted page", () => {
		const pullId = Symbol("c27-page");
		const source = node<readonly number[]>([], null, { initial: [1, 2, 3] });
		const seen: unknown[] = [];
		const page = node<readonly number[]>(
			[source],
			(ctx) => {
				seen.push(ctx.pull?.params);
				const limit = ((ctx.pull?.params as { limit?: number } | undefined)?.limit ?? 3) as number;
				ctx.down([["DATA", (depLatest(ctx, 0) as readonly number[]).slice(0, limit)]]);
			},
			{ pullId },
		);
		const { msgs } = collect(page);
		msgs.length = 0;

		page.up([["PULL", { pullId, params: { limit: 1 } }]]);
		page.up([["PULL", { pullId, params: { limit: 2 } }]]);

		expect(seen).toEqual([{ limit: 1 }, { limit: 2 }]);
		expect(data(msgs)).toEqual([[1], [1, 2]]);
	});

	it("allows a plain helper to invoke on no-change PULL yet emit nothing, and RESUME is negative control", () => {
		const pullId = Symbol("c27-plain");
		const source = node<number>([], null, { initial: 10 });
		const seen: unknown[] = [];
		const plain = node<number>(
			[source],
			(ctx) => {
				seen.push(ctx.pull?.params);
				if (ctx.state.get() === "served") return;
				ctx.state.set("served");
				ctx.down([["DATA", depLatest(ctx, 0) as number]]);
			},
			{ pullId },
		);
		const { msgs } = collect(plain);
		msgs.length = 0;

		plain.up([["PULL", { pullId, params: { limit: 1 } }]]);
		expect(data(msgs)).toEqual([10]);
		msgs.length = 0;
		plain.up([["PULL", { pullId, params: { limit: 2 } }]]);
		expect(msgs).toEqual([]);
		plain.up([["RESUME", pullId]]);

		expect(seen).toEqual([{ limit: 1 }, { limit: 2 }]);
		expect(msgs).toEqual([]);
	});
});

describe("QA — synthesized no-emit RESOLVED uses normal timing", () => {
	it("buffers a sync fn's synthesized RESOLVED while paused in resumeAll mode", () => {
		const s = node<number>([], null, { initial: 1 });
		const f = node<number>(
			[s],
			(ctx) => {
				const value = depLatest(ctx, 0) as number;
				if (value >= 10) ctx.down([["DATA", value]]);
			},
			{ pausable: "resumeAll" },
		);
		const { msgs } = collect(f);
		msgs.length = 0;

		const L = Symbol("pause");
		f.up([["PAUSE", L]]);
		s.down([["DATA", 2]]);

		expect(types(msgs)).toEqual(["DIRTY"]);
		f.up([["RESUME", L]]);
		expect(types(msgs)).toEqual(["DIRTY", "DIRTY", "RESOLVED"]);
	});
});

describe("C-23 raw ctx waveData is the only dep-value input (R-fn-contract / R-ctx-wave-data / R-data-payload / D77/D78)", () => {
	const cloneWaveData = (ctx: Ctx) => ctx.waveData.map((waves) => waves.map((w) => [...w]));

	it("exposes waveData/terminal, not depRecords/latest/prevData aliases", () => {
		let seen: { waveData: unknown[][][]; terminal: unknown[]; hasDepRecords: boolean } | null =
			null;
		const a = node<number>([], null);
		const n = node<number>(
			[a],
			(ctx) => {
				seen = {
					waveData: cloneWaveData(ctx),
					terminal: [...ctx.terminal],
					hasDepRecords: "depRecords" in ctx,
				};
			},
			{ partial: true },
		);
		collect(n);

		a.down([["DATA", 1]]);

		expect(seen).toEqual({
			waveData: [[[1]]],
			terminal: [false],
			hasDepRecords: false,
		});
	});

	it("distinguishes no-wave, RESOLVED-only, DATA+INVALIDATE, null, and empty-array payloads", () => {
		const captures: unknown[][][][] = [];
		const a = node<unknown>([], null);
		const b = node<unknown>([], null);
		const n = node<unknown>(
			[a, b],
			(ctx) => {
				captures.push(cloneWaveData(ctx));
			},
			{ partial: true },
		);
		collect(n);

		b.down([["DATA", "b"]]);
		expect(captures.at(-1)).toEqual([[], [["b"]]]);

		a.down([["DIRTY"]]);
		a.down([["RESOLVED"]]);
		expect(captures.at(-1)).toEqual([[[]], []]);

		a.down([["DATA", 1], ["DATA", 2], ["INVALIDATE"]]);
		expect(captures.at(-1)).toEqual([[[1, 2, undefined]], []]);

		a.down([["DATA", null]]);
		expect(captures.at(-1)).toEqual([[[null]], []]);

		a.down([["DATA", []]]);
		expect(captures.at(-1)).toEqual([[[[]]], []]);
	});

	it("keeps COMPLETE/ERROR out of waveData and in ctx.terminal", () => {
		const terminals: unknown[][] = [];
		const waves: unknown[][][][] = [];
		const a = node<number>([], null);
		const n = node<number>(
			[a],
			(ctx) => {
				waves.push(cloneWaveData(ctx));
				terminals.push([...ctx.terminal]);
			},
			{
				partial: true,
				completeWhenDepsComplete: false,
				errorWhenDepsError: false,
				terminalAsRealInput: true,
			},
		);
		collect(n);

		a.down([["COMPLETE"]]);
		expect(waves.at(-1)).toEqual([[]]);
		expect(terminals.at(-1)).toEqual([true]);

		const e = new Error("boom");
		const b = node<number>([], null);
		const m = node<number>(
			[b],
			(ctx) => {
				waves.push(cloneWaveData(ctx));
				terminals.push([...ctx.terminal]);
			},
			{
				partial: true,
				completeWhenDepsComplete: false,
				errorWhenDepsError: false,
				terminalAsRealInput: true,
			},
		);
		collect(m);
		b.down([["ERROR", e]]);
		expect(waves.at(-1)).toEqual([[]]);
		expect(terminals.at(-1)).toEqual([e]);

		const c = node<number>([], null);
		const p = node<number>(
			[c],
			(ctx) => {
				waves.push(cloneWaveData(ctx));
				terminals.push([...ctx.terminal]);
			},
			{
				partial: true,
				completeWhenDepsComplete: false,
				errorWhenDepsError: false,
				terminalAsRealInput: true,
			},
		);
		collect(p);
		c.down([["ERROR", null]]);
		expect(waves.at(-1)).toEqual([[]]);
		expect(terminals.at(-1)).toEqual([null]);
	});

	it("exposes terminal metadata only for the invocation that observed the terminal", () => {
		const captures: Array<{ waveData: unknown[][][]; terminal: unknown[] }> = [];
		const a = node<number>([], null);
		const b = node<number>([], null);
		const n = node<number>(
			[a, b],
			(ctx) => {
				captures.push({
					waveData: cloneWaveData(ctx),
					terminal: [...ctx.terminal],
				});
			},
			{
				partial: true,
				completeWhenDepsComplete: false,
				terminalAsRealInput: true,
			},
		);
		collect(n);

		a.down([["COMPLETE"]]);
		expect(captures.at(-1)).toEqual({ waveData: [[], []], terminal: [true, false] });

		b.down([["DATA", 1]]);
		expect(captures.at(-1)).toEqual({ waveData: [[], [[1]]], terminal: [false, false] });
	});

	it("rejects boolean ERROR payloads at the protocol boundary and coerces host-source failures", async () => {
		const s = node<number>([], null);
		const msgs: Message[] = [];
		s.subscribe((m) => msgs.push(m));
		msgs.length = 0;
		expect(() => s.down([["ERROR", undefined]])).toThrow(/non-SENTINEL/);
		expect(() => s.down([["ERROR", false]])).toThrow(/non-boolean/);
		expect(() => s.down([["ERROR", true]])).toThrow(/non-boolean/);
		expect(() =>
			s.down([
				["DATA", 1],
				["ERROR", false],
			]),
		).toThrow(/non-boolean/);
		expect(msgs).toEqual([]);

		const g = graph();
		for (const reason of [undefined, false, true]) {
			const n = g.initNode(fromPromise(Promise.reject(reason)), []);
			const msgs: Message[] = [];
			n.subscribe((m) => msgs.push(m));
			await flush();
			const last = msgs.at(-1);
			expect(last?.[0]).toBe("ERROR");
			expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error);
		}
	});

	it("lets dynamicNode inspect waveData to stay quiet on an unread-dep-only wave", () => {
		const a = node<number>([], null, { initial: 1 });
		const b = node<number>([], null);
		const captures: unknown[][][][] = [];
		const d = dynamicNode<number>(
			[a, b],
			(ctx) => {
				captures.push(cloneWaveData(ctx));
				if (ctx.waveData[1]?.length) return;
				ctx.down([["DATA", ctx.track?.(0) as number]]);
			},
			{ partial: true },
		);
		const { msgs } = collect(d);
		msgs.length = 0;

		b.down([["DATA", 2]]);

		expect(captures.at(-1)).toEqual([[], [[2]]]);
		expect(types(msgs)).toEqual(["DIRTY", "RESOLVED"]);
	});
});
