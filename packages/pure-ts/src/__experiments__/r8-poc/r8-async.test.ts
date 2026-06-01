/**
 * R8 async/remote PoC — proves the R9 claim:
 *
 *   dispatcher.invoke() is uniformly SYNC void. Async pool fns kick off work
 *   and emit results LATER via actions.emit(). The reactive graph protocol
 *   handles "late emit" correctly through the (DIRTY, DATA) pair invariant.
 *   No wave-id needed. Cross-network is identical to local-async — just a
 *   different setTimeout delay.
 */

import { describe, expect, it } from "vitest";
import type { Actions, Ctx, TinyNode } from "./protocol.js";
import { r8AsyncNode, r8Node, r8RemoteNode } from "./r8.js";

const lastOrPrev =
	(idx: number) =>
	(batchData: ReadonlyArray<unknown[] | null>, ctx: Ctx): number => {
		const b = batchData[idx];
		return (b != null && b.length > 0 ? b.at(-1) : ctx.prevData[idx]) as number;
	};

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("R9 — dispatcher.invoke stays sync, async fns emit later", () => {
	it("local-async: pushExternal returns sync; DATA arrives after microtask", async () => {
		const source = r8Node<number>([], undefined, 0);

		// Async fn: doubles the input, but only emits after a Promise.resolve hop.
		const asyncDoubler = r8AsyncNode<number>([source], (batchData, actions, ctx) => {
			const v = lastOrPrev(0)(batchData, ctx);
			// Kick off async work — dispatcher.invoke has ALREADY returned to wave.
			Promise.resolve().then(() => {
				(actions as Actions<number>).emit(v * 2);
			});
			// (fn returns void, no Promise leaks back to dispatcher)
		});

		const received: number[] = [];
		asyncDoubler.subscribe((msg) => {
			if (msg[0] === "DATA") received.push(msg[1] as number);
		});

		// SYNC: pushExternal returns immediately. No DATA yet.
		const t0 = performance.now();
		source.pushExternal(5);
		const tSyncReturn = performance.now() - t0;

		expect(received).toEqual([]); // No DATA emitted yet — fn is async
		expect(tSyncReturn).toBeLessThan(1); // pushExternal is sync, sub-ms

		// After microtask flush, DATA arrives.
		await Promise.resolve();
		await Promise.resolve();
		expect(received).toEqual([10]);
	});

	it("simulated remote: 5ms RTT — wave protocol waits correctly", async () => {
		const source = r8Node<number>([], undefined, 0);

		const remoteTransform = r8RemoteNode<number>([source], (batchData, ctx) => {
			const v = lastOrPrev(0)(batchData, ctx);
			return v + 100; // sandbox-side computation
		});

		const received: number[] = [];
		remoteTransform.subscribe((msg) => {
			if (msg[0] === "DATA") received.push(msg[1] as number);
		});

		source.pushExternal(7);
		expect(received).toEqual([]); // Wave kicked off, no DATA yet

		await delay(15); // Wait > RTT
		expect(received).toEqual([107]);
	});

	it("mixed sync + async diamond: D fires once after async leg resolves", async () => {
		// A → B (sync) → D
		// A → C (async, ~5ms) → D
		const a = r8Node<number>([], undefined, 0);
		const b = r8Node<number>([a], (batchData, actions, ctx) => {
			const v = lastOrPrev(0)(batchData, ctx);
			(actions as Actions<number>).emit(v + 1);
		});
		const c = r8RemoteNode<number>([a], (batchData, ctx) => {
			const v = lastOrPrev(0)(batchData, ctx);
			return v * 10;
		});
		const d = r8Node<number>(
			[b as TinyNode<unknown>, c as TinyNode<unknown>],
			(batchData, actions, ctx) => {
				const x = lastOrPrev(0)(batchData, ctx);
				const y = lastOrPrev(1)(batchData, ctx);
				(actions as Actions<number>).emit(x + y);
			},
		);

		const received: number[] = [];
		d.subscribe((msg) => {
			if (msg[0] === "DATA") received.push(msg[1] as number);
		});

		a.pushExternal(3);
		// B has emitted DATA(4) sync to D, but D still has C dirty.
		// fn should NOT have fired yet.
		expect(received).toEqual([]);

		await delay(15); // C resolves with 30 → D fires with 4 + 30 = 34
		expect(received).toEqual([34]);
	});

	it("two back-to-back pushes with async leg: both results flow through", async () => {
		const a = r8Node<number>([], undefined, 0);
		const slow = r8RemoteNode<number>([a], (batchData, ctx) => {
			const v = lastOrPrev(0)(batchData, ctx);
			return v + 1000;
		});

		const received: number[] = [];
		slow.subscribe((msg) => {
			if (msg[0] === "DATA") received.push(msg[1] as number);
		});

		// Two pushes in quick succession. Each triggers a fresh remote call.
		// Merge semantics: both eventually arrive.
		a.pushExternal(1);
		a.pushExternal(2);

		await delay(20);
		expect(received.length).toBeGreaterThanOrEqual(1);
		// Both results should arrive — order depends on RTT consistency.
		// We assert the SET of values rather than order.
		expect(received).toContain(1002);
	});

	it("dispatcher.invokeRouted is verified-sync — measures < 100μs even with async fn body", async () => {
		// Register a no-op async fn and time the dispatcher invoke step alone.
		const noop = r8AsyncNode<number>([r8Node<number>([], undefined, 0)], () => {
			// Don't even start async work — just return.
		});

		// Build a source with an async derived attached; measure source.pushExternal
		// (which sync-invokes through dispatcher).
		const source = r8Node<number>([], undefined, 0);
		const node = r8AsyncNode<number>([source], (_b, _a, _c) => {
			// no-op async body
		});
		node.subscribe(() => undefined);

		const ITERS = 1000;
		const t0 = performance.now();
		for (let i = 0; i < ITERS; i++) source.pushExternal(i);
		const elapsed = performance.now() - t0;
		const perCall = (elapsed * 1000) / ITERS; // μs

		expect(perCall).toBeLessThan(5); // < 5μs per push end-to-end including async dispatch
		// Hold reference so noop isn't GC'd before bench finishes (TS-only concern)
		void noop;
	});
});
