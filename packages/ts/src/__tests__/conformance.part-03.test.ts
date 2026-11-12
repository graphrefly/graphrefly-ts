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
import type { Ctx, Message, Wave } from "../index.js";
import { fromPromise, graph } from "../index.js";

const types = (msgs: Message[]) => msgs.map((m) => m[0]);
const _data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);
const flush = () => new Promise((r) => setTimeout(r, 0));
function collect(n: { subscribe(s: (msgs: Wave) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe((incoming) => {
		for (const m of incoming) {
			msgs.push(m);
		}
	});
	return { msgs, unsub };
}

// C-25 (R-rewire-deferred-committed-boundary / D110): ctx.rewireNext/ctx.upNext tasks apply only
// after the owner reaches a committed, unpaused boundary view. Rollback drops the tasks caused by
// that batch; it does not let subscribeDep/unsubscribeDep/replaceDeps/upNext leak a hidden committed effect.

// C-26 (R-msg-closed-set / R-tier / R-ctx-up / R-pull / R-up-routing): D269 makes PULL the
// explicit demand message with holder-visible params; RESUME remains pause-lock release only.

// C-27 (R-pull / R-fn-contract / R-ctx-up): no-change PULL reaches the holder; downstream DATA is
// the helper's ordinary output decision, so params may drive retained output while plain helpers may stay silent.

describe("C-23 raw ctx.deps waves are the only dep-value input (R-fn-contract / R-ctx-wave-data / R-data-payload / D77/D78)", () => {
	const cloneWaveData = (ctx: Ctx) => ctx.deps.map((d) => d.waves.map((w) => [...w]));

	it("exposes waves/terminal per dependency, not depRecords/latest/prevData aliases", () => {
		let seen: { waveData: unknown[][][]; terminal: unknown[]; hasDepRecords: boolean } | null =
			null;
		const g = graph();
		const a = g.node<number>([], null);
		const n = g.node<number>(
			[a],
			(ctx) => {
				seen = {
					waveData: cloneWaveData(ctx),
					terminal: ctx.deps.map((d) => d.terminal),
					hasDepRecords: "depRecords" in ctx,
				};
			},
			{},
		);
		collect(n);

		a.set(1);

		expect(seen).toEqual({
			waveData: [[[1]]],
			terminal: [undefined],
			hasDepRecords: false,
		});
	});

	it("distinguishes no-wave, a split at INVALIDATE, null, and empty-array payloads", () => {
		const captures: unknown[][][][] = [];
		const g = graph();
		const a = g.node<unknown>([], null);
		const b = g.node<unknown>([], null);
		const n = g.node<unknown>(
			[a, b],
			(ctx) => {
				captures.push(cloneWaveData(ctx));
			},
			{},
		);
		collect(n);

		b.set("b");
		expect(captures.at(-1)).toEqual([[], [["b"]]]);

		// R-wave: the array is split at its last INVALIDATE; what came before it is dropped.
		g.batch(() => {
			a.set(1);
			a.set(2);
			a.invalidate();
			a.set(3);
		});
		expect(captures.at(-1)).toEqual([[[3]], []]);

		a.set(null);
		expect(captures.at(-1)).toEqual([[[null]], []]);

		a.set([]);
		expect(captures.at(-1)).toEqual([[[[]]], []]);
	});

	it("a RESOLVED-only wave is one empty array (the kernel settles a silent dependency)", () => {
		const captures: unknown[][][][] = [];
		const g = graph();
		const src = g.node<number>([], null, { initial: 0 });
		// a sends nothing for odd values, so the kernel settles it with RESOLVED.
		const a = g.node<number>([src], (ctx) => {
			const v = ctx.deps[0].value as number;
			if (v % 2 === 0) ctx.down([["DATA", v]]);
		});
		const n = g.node<unknown>(
			[a],
			(ctx) => {
				captures.push(cloneWaveData(ctx));
			},
			{},
		);
		collect(n);
		src.set(1);
		expect(captures.at(-1)).toEqual([[[]]]);
	});

	it("keeps COMPLETE/ERROR out of waves and in the dependency's terminal", () => {
		const terminals: unknown[][] = [];
		const waves: unknown[][][][] = [];
		const g = graph();
		const a = g.node<number>([], null);
		const n = g.node<number>(
			[a],
			(ctx) => {
				waves.push(cloneWaveData(ctx));
				terminals.push(ctx.deps.map((d) => d.terminal));
			},
			{
				complete: "manual",
				error: "manual",
			},
		);
		collect(n);

		a.complete();
		expect(waves.at(-1)).toEqual([[]]);
		expect(terminals.at(-1)).toEqual([{ kind: "complete" }]);

		const e = new Error("boom");
		const b = g.node<number>([], null);
		const m = g.node<number>(
			[b],
			(ctx) => {
				waves.push(cloneWaveData(ctx));
				terminals.push(ctx.deps.map((d) => d.terminal));
			},
			{
				complete: "manual",
				error: "manual",
			},
		);
		collect(m);
		b.error(e);
		expect(waves.at(-1)).toEqual([[]]);
		expect(terminals.at(-1)).toEqual([{ kind: "error", error: e }]);

		const c = g.node<number>([], null);
		const p = g.node<number>(
			[c],
			(ctx) => {
				waves.push(cloneWaveData(ctx));
				terminals.push(ctx.deps.map((d) => d.terminal));
			},
			{
				complete: "manual",
				error: "manual",
			},
		);
		collect(p);
		c.error(null);
		expect(waves.at(-1)).toEqual([[]]);
		expect(terminals.at(-1)).toEqual([{ kind: "error", error: null }]);
	});

	it("exposes terminal metadata only for the invocation that observed the terminal", () => {
		const captures: Array<{ waveData: unknown[][][]; terminal: unknown[] }> = [];
		const g = graph();
		const a = g.node<number>([], null);
		const b = g.node<number>([], null);
		const n = g.node<number>(
			[a, b],
			(ctx) => {
				captures.push({
					waveData: cloneWaveData(ctx),
					terminal: ctx.deps.map((d) => d.terminal),
				});
			},
			{
				complete: "manual",
			},
		);
		collect(n);

		a.complete();
		expect(captures.at(-1)).toEqual({
			waveData: [[], []],
			terminal: [{ kind: "complete" }, undefined],
		});

		b.set(1);
		expect(captures.at(-1)).toEqual({ waveData: [[], [[1]]], terminal: [undefined, undefined] });
	});

	it("rejects boolean ERROR payloads at the protocol boundary and coerces host-source failures", async () => {
		const g = graph();
		const s = g.node<number>([], null);
		const msgs: Message[] = [];
		s.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		msgs.length = 0;
		expect(() => s.error(undefined)).toThrow(/non-SENTINEL/);
		expect(() => s.error(false)).toThrow(/non-boolean/);
		expect(() => s.error(true)).toThrow(/non-boolean/);
		expect(() =>
			g.batch(() => {
				s.set(1);
				s.error(false);
			}),
		).toThrow(/non-boolean/);
		expect(msgs).toEqual([]);

		for (const reason of [undefined, false, true]) {
			const n = g.initNode(fromPromise(Promise.reject(reason)), []);
			const msgs: Message[] = [];
			n.subscribe((incoming) => {
				for (const m of incoming) {
					msgs.push(m);
				}
			});
			await flush();
			const last = msgs.at(-1);
			expect(last?.[0]).toBe("ERROR");
			expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error);
		}
	});

	it("lets a dynamic node inspect waveData to stay quiet on an unread-dep-only wave", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const b = g.node<number>([], null);
		const captures: unknown[][][][] = [];
		const d = g.node<number>([a, b], (ctx) => {
			captures.push(cloneWaveData(ctx));
			if (ctx.deps[1].waves.length) return;
			ctx.down([["DATA", ctx.deps[0].value as number]]);
		});
		const { msgs } = collect(d);
		msgs.length = 0;

		b.set(2);

		expect(captures.at(-1)).toEqual([[], [[2]]]);
		expect(types(msgs)).toEqual(["PENDING", "RESOLVED"]);
	});
});
