/**
 * Phase 13.6.B Batch 2 — Lock 4.A + 4.A′ cleanup-hook rename.
 *
 * Verifies the new field names (`onRerun`, `onDeactivation`, `onInvalidate`)
 * fire correctly. The legacy `{ beforeRun, deactivate, invalidate }` shape and
 * `() => void` shorthand are accepted as a transitional shim — see
 * `docs/optimizations.md` "Lock 4.A — drop () => void cleanup-shorthand
 * call-site sweep" for the planned follow-up sweep.
 */

import { describe, expect, it } from "vitest";
import { DATA, INVALIDATE } from "../../core/messages.js";
import { node } from "../../core/node.js";

describe("Phase 13.6.B B2 — Lock 4.A cleanup-hook rename", () => {
	it("{ onDeactivation } fires on last-sink unsubscribe", () => {
		let deactivations = 0;
		const src = node<number>([], { initial: 1 });
		const d = node<number>([src], (data, a) => {
			a.emit((data[0]?.at(-1) as number) ?? 0);
			return {
				onDeactivation: () => {
					deactivations++;
				},
			};
		});
		const u1 = d.subscribe(() => undefined);
		const u2 = d.subscribe(() => undefined);
		expect(deactivations).toBe(0);
		u1();
		expect(deactivations).toBe(0); // still has u2
		u2();
		expect(deactivations).toBe(1);
	});

	it("{ onInvalidate } fires on INVALIDATE delivery without ending the activation", () => {
		let invalidations = 0;
		let deactivations = 0;
		const src = node<number>([], { initial: 7 });
		const d = node<number>([src], (data, a) => {
			a.emit((data[0]?.at(-1) as number) ?? 0);
			return {
				onInvalidate: () => {
					invalidations++;
				},
				onDeactivation: () => {
					deactivations++;
				},
			};
		});
		const unsub = d.subscribe(() => undefined);
		expect(invalidations).toBe(0);
		src.down([[INVALIDATE]]);
		expect(invalidations).toBe(1);
		expect(deactivations).toBe(0); // INVALIDATE preserves activation
		unsub();
		expect(deactivations).toBe(1);
	});

	it("{ onRerun } fires before fn re-runs (between waves)", () => {
		let reruns = 0;
		const src = node<number>([], { initial: 1 });
		const seen: number[] = [];
		const d = node<number>([src], (data, a) => {
			const v = (data[0]?.at(-1) as number) ?? 0;
			seen.push(v);
			a.emit(v);
			return {
				onRerun: () => {
					reruns++;
				},
			};
		});
		const unsub = d.subscribe(() => undefined);
		expect(reruns).toBe(0);
		src.down([[DATA, 2]]);
		// Cleanup runs BEFORE fn re-runs, so reruns increments by 1 prior to
		// the fn call that emitted seen=[..., 2].
		expect(reruns).toBe(1);
		expect(seen).toEqual([1, 2]);
		unsub();
	});

	it("transitional shim: function-form `() => void` still fires on all three transitions", () => {
		// This shim is documented for removal — see optimizations.md "Lock
		// 4.A — drop () => void cleanup-shorthand call-site sweep". The
		// behavioural test pins the back-compat path so the eventual sweep
		// removes both the call site AND the test together.
		let count = 0;
		const src = node<number>([], { initial: 1 });
		const d = node<number>([src], (data, a) => {
			a.emit((data[0]?.at(-1) as number) ?? 0);
			return () => {
				count++;
			};
		});
		const unsub = d.subscribe(() => undefined);
		expect(count).toBe(0);
		// Re-run fires the shim and clears it.
		src.down([[DATA, 2]]);
		expect(count).toBe(1);
		// Next run installed a fresh shim; INVALIDATE fires + clears.
		src.down([[INVALIDATE]]);
		expect(count).toBe(2);
		unsub();
		// Deactivation: no cleanup armed at deactivation (cleared by
		// INVALIDATE above), so count stays at 2.
		expect(count).toBe(2);
	});
});
