/**
 * Phase 13.6.B Batch 7 — `ctx.store` default flips to preserve-across-deactivation
 * (Lock 6.D, G.20 flip).
 *
 * Pre-flip: `_deactivate` and `_resetForFreshLifecycle` both wiped
 * `_store` to `{}`. Operators relied on this implicit reset.
 *
 * Post-flip: `_store` PRESERVES across both lifecycle paths. Operators
 * that need restart-on-resubscribe install `onDeactivation` cleanups
 * that explicitly clear their store keys.
 *
 * Tests focus on the core flip semantic — operator-specific behavior is
 * already covered by the broader test suite (any regression would surface
 * there).
 *
 * (a) Bare `node()` with no cleanup hook — store survives across
 *     sub→unsub→re-sub.
 * (b) `onDeactivation` hook fires when sole sink unsubs and can clear
 *     specific store keys.
 * (c) `_resetForFreshLifecycle` (terminal-resubscribable subscribe-after-
 *     terminal) preserves store.
 * (d) `onDeactivation` selective clear: keys NOT listed in the hook
 *     persist across cycles; listed keys are gone.
 * (e) Multiple subscribe/unsubscribe cycles with different sinks (no full
 *     deactivation between) — store flows through unchanged.
 */

import { describe, expect, it } from "vitest";
import { COMPLETE } from "../../core/messages.js";
import { node } from "../../core/node.js";

describe("Phase 13.6.B B7 — Lock 6.D `ctx.store` preserve-by-default", () => {
	it("(a) bare node — store survives sub→unsub→re-sub when no onDeactivation hook", () => {
		const src = node<number>([], { initial: 0, resubscribable: true });
		const observed: number[] = [];
		const computed = node<number>([src], (data, a, ctx) => {
			ctx.store.invocations = ((ctx.store.invocations as number | undefined) ?? 0) + 1;
			observed.push(ctx.store.invocations as number);
			const batch = data[0];
			if (batch != null && batch.length > 0) a.emit(batch.at(-1) as number);
			else a.emit(ctx.prevData[0] as number);
		});

		const unsub1 = computed.subscribe(() => {});
		src.emit(1);
		src.emit(2);
		const lastBefore = observed[observed.length - 1];
		unsub1();

		// Re-subscribe → store preserved → invocations counter continues.
		const unsub2 = computed.subscribe(() => {});
		src.emit(3);
		const lastAfter = observed[observed.length - 1];

		// `lastAfter` MUST be > `lastBefore` because the counter wasn't reset.
		// Pre-flip auto-wipe would have reset it; post-flip preserves it.
		expect(lastAfter).toBeGreaterThan(lastBefore);
		unsub2();
	});

	it("(b) onDeactivation fires + can clear specific store keys", () => {
		const src = node<number>([], { initial: 0, resubscribable: true });
		let onDeactivationFired = 0;
		const cycle1Snapshots: Record<string, unknown>[] = [];
		const cycle2Snapshots: Record<string, unknown>[] = [];
		let cycle = 1;

		const computed = node<number>([src], (data, a, ctx) => {
			ctx.store.runs = ((ctx.store.runs as number | undefined) ?? 0) + 1;
			(cycle === 1 ? cycle1Snapshots : cycle2Snapshots).push({ ...ctx.store });
			const batch = data[0];
			if (batch != null && batch.length > 0) a.emit(batch.at(-1) as number);
			else a.emit(ctx.prevData[0] as number);
			const store = ctx.store;
			return {
				onDeactivation: () => {
					onDeactivationFired += 1;
					delete store.runs;
				},
			};
		});

		const u1 = computed.subscribe(() => {});
		src.emit(1);
		src.emit(2);
		expect(onDeactivationFired).toBe(0);
		u1();
		expect(onDeactivationFired).toBe(1);

		cycle = 2;
		const u2 = computed.subscribe(() => {});
		src.emit(3);

		// Cycle 1 ended with `runs >= 2`. Cycle 2's first snapshot must show
		// `runs === 1` — the cleanup wiped the key, fn re-init started fresh.
		const cycle1Last = cycle1Snapshots[cycle1Snapshots.length - 1].runs as number;
		const cycle2First = cycle2Snapshots[0].runs as number;
		expect(cycle1Last).toBeGreaterThanOrEqual(2);
		expect(cycle2First).toBe(1);
		u2();
	});

	it("(c) terminal-resubscribable lifecycle reset preserves store", () => {
		// `_resetForFreshLifecycle` is invoked when a new subscriber arrives
		// after a terminal-resubscribable node was driven terminal. Lock 6.D
		// says `ctx.store` preserves through this path too — pre-flip the
		// reset path also auto-wiped the store.
		const src = node<number>([], { initial: 0, resubscribable: true });
		const cycle1: Record<string, unknown>[] = [];
		const cycle2: Record<string, unknown>[] = [];
		let cycle = 1;
		const computed = node<number>(
			[src],
			(data, a, ctx) => {
				ctx.store.calls = ((ctx.store.calls as number | undefined) ?? 0) + 1;
				(cycle === 1 ? cycle1 : cycle2).push({ ...ctx.store });
				const batch = data[0];
				if (batch != null && batch.length > 0) a.emit(batch.at(-1) as number);
				else a.emit(ctx.prevData[0] as number);
				// NO onDeactivation hook — store persists through every path.
			},
			{ resubscribable: true },
		);

		const u1 = computed.subscribe(() => {});
		src.emit(1);
		// Drive computed terminal via COMPLETE on src (autoComplete cascades).
		src.down([[COMPLETE]]);
		u1();

		cycle = 2;
		const u2 = computed.subscribe(() => {});
		src.emit(2);

		expect(cycle1.length).toBeGreaterThan(0);
		expect(cycle2.length).toBeGreaterThan(0);
		const cycle1Last = cycle1[cycle1.length - 1].calls as number;
		const cycle2First = cycle2[0].calls as number;
		// Without onDeactivation, the calls counter survives the
		// terminal-then-deactivate-then-resubscribable cycle. Pre-flip would
		// have reset it.
		expect(cycle2First).toBeGreaterThan(cycle1Last);
		u2();
	});

	it("(d) onDeactivation selective clear — listed keys gone, unlisted keys persist", () => {
		const src = node<number>([], { initial: 0, resubscribable: true });
		const cycle1: Array<Record<string, unknown>> = [];
		const cycle2: Array<Record<string, unknown>> = [];
		let cycle = 1;
		const computed = node<number>([src], (data, a, ctx) => {
			(cycle === 1 ? cycle1 : cycle2).push({
				targetBefore: ctx.store.target,
				keptBefore: ctx.store.kept,
			});
			ctx.store.target = "delete-me";
			ctx.store.kept = "persist-me";
			const batch = data[0];
			if (batch != null && batch.length > 0) a.emit(batch.at(-1) as number);
			else a.emit(ctx.prevData[0] as number);
			const store = ctx.store;
			return {
				onDeactivation: () => {
					delete store.target;
					// NOT deleting `kept`.
				},
			};
		});

		const u1 = computed.subscribe(() => {});
		src.emit(1);
		u1();

		cycle = 2;
		const u2 = computed.subscribe(() => {});
		src.emit(2);
		u2();

		// Cycle 1 first call: store empty.
		expect(cycle1[0].targetBefore).toBeUndefined();
		expect(cycle1[0].keptBefore).toBeUndefined();

		// Cycle 2 first call: target was cleared, kept survived.
		expect(cycle2.length).toBeGreaterThan(0);
		expect(cycle2[0].targetBefore).toBeUndefined();
		expect(cycle2[0].keptBefore).toBe("persist-me");
	});

	it("(e) transient sink subscribe/unsub during keepalive — store flows unchanged", () => {
		const src = node<number>([], { initial: 0, resubscribable: true });
		const observed: number[] = [];
		const computed = node<number>([src], (data, a, ctx) => {
			ctx.store.runs = ((ctx.store.runs as number | undefined) ?? 0) + 1;
			observed.push(ctx.store.runs as number);
			const batch = data[0];
			if (batch != null && batch.length > 0) a.emit(batch.at(-1) as number);
			else a.emit(ctx.prevData[0] as number);
		});

		const keepalive = computed.subscribe(() => {});
		src.emit(1);
		src.emit(2);

		// Transient sink subscribe + immediate unsub. Because keepalive holds
		// `_sinkCount > 0`, _deactivate does NOT run on the transient unsub.
		const transient = computed.subscribe(() => {});
		transient();

		src.emit(3);

		// Observer counter increments monotonically across the transient
		// sub/unsub — no spurious reset.
		expect(observed).toEqual(observed.slice().sort((a, b) => a - b));
		expect(observed[observed.length - 1]).toBeGreaterThanOrEqual(3);

		keepalive();
	});
});
