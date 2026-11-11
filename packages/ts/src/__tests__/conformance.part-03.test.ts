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
import type { Ctx, Message } from "../index.js";
import { depLatest, dynamicNode, fromPromise, graph, node } from "../index.js";
import { eachMessage } from "../node/each-message.js";

const types = (msgs: Message[]) => msgs.map((m) => m[0]);
const _data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);
const flush = () => new Promise((r) => setTimeout(r, 0));
function collect(n: { subscribe(s: (m: Message) => void): () => void }) {
	const msgs: Message[] = [];
	const unsub = n.subscribe(eachMessage((m) => msgs.push(m)));
	return { msgs, unsub };
}

// C-25 (R-rewire-deferred-committed-boundary / D110): ctx.rewireNext/ctx.upNext tasks apply only
// after the owner reaches a committed, unpaused boundary view. Rollback drops the tasks caused by
// that batch; it does not let subscribeDep/unsubscribeDep/replaceDeps/upNext leak a hidden committed effect.

// C-26 (R-msg-closed-set / R-tier / R-ctx-up / R-pull / R-up-routing): D269 makes PULL the
// explicit demand message with holder-visible params; RESUME remains pause-lock release only.

// C-27 (R-pull / R-fn-contract / R-ctx-up): no-change PULL reaches the holder; downstream DATA is
// the helper's ordinary output decision, so params may drive retained output while plain helpers may stay silent.

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

	it("distinguishes no-wave, a split at INVALIDATE, null, and empty-array payloads", () => {
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

		// R-wave: the array is split at its last INVALIDATE; what came before it is dropped.
		a.down([["DATA", 1], ["DATA", 2], ["INVALIDATE"], ["DATA", 3]]);
		expect(captures.at(-1)).toEqual([[[3]], []]);

		a.down([["DATA", null]]);
		expect(captures.at(-1)).toEqual([[[null]], []]);

		a.down([["DATA", []]]);
		expect(captures.at(-1)).toEqual([[[[]]], []]);
	});

	it("a RESOLVED-only wave is one empty array (the kernel settles a silent dependency)", () => {
		const captures: unknown[][][][] = [];
		const src = node<number>([], null, { initial: 0 });
		// a sends nothing for odd values, so the kernel settles it with RESOLVED.
		const a = node<number>([src], (ctx) => {
			const v = depLatest(ctx, 0) as number;
			if (v % 2 === 0) ctx.down([["DATA", v]]);
		});
		const n = node<unknown>(
			[a],
			(ctx) => {
				captures.push(cloneWaveData(ctx));
			},
			{ partial: true },
		);
		collect(n);
		src.down([["DATA", 1]]);
		expect(captures.at(-1)).toEqual([[[]]]);
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
				terminal: { complete: "manual", error: "manual" },
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
				terminal: { complete: "manual", error: "manual" },
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
				terminal: { complete: "manual", error: "manual" },
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
				terminal: { complete: "manual" },
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
		s.subscribe(eachMessage((m) => msgs.push(m)));
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
			n.subscribe(eachMessage((m) => msgs.push(m)));
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
		expect(types(msgs)).toEqual(["PENDING", "RESOLVED"]);
	});
});
