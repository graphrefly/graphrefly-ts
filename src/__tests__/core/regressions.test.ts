/**
 * Regression tests for spec-verified behaviors.
 * Each test names the bug and anchors it to a spec section.
 *
 * Note: Many PY regression scenarios are already covered in other TS test files:
 * - RESOLVED transitive skip → node.test.ts
 * - Diamond recompute count → node.test.ts, operators.test.ts
 * - describe() Appendix B → graph.test.ts
 * - switchMap forward_inner duplicate → operators.test.ts
 *
 * This file collects additional regression scenarios surfaced by cross-repo parity.
 */

import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { DATA, DIRTY, ERROR } from "../../core/messages.js";
import { type NodeImpl, node } from "../../core/node.js";
import { autoTrackNode, derived, state } from "../../core/sugar.js";

describe("regressions", () => {
	// Spec: GRAPHREFLY-SPEC §1.2 — bare [DATA] without payload is a protocol violation.
	it("bare [DATA] tuple (missing payload) is silently skipped", () => {
		const source = node<number>({ initial: 0 });
		const unsub = source.subscribe(() => undefined);
		// Bare [DATA] should not crash or update the cached value.
		source.down([[DATA] as unknown as [symbol, number]]);
		expect(source.cache).toBe(0);
		expect(source.status).toBe("settled"); // unchanged from initial
		unsub();
	});

	// Spec: batch drain — AggregateError when multiple callbacks throw (parity with PY ExceptionGroup).
	it("batch drain collects multiple errors into AggregateError", () => {
		const a = node<number>({ initial: 0 });
		const b = node<number>({ initial: 0 });
		const errA = new Error("error-a");
		const errB = new Error("error-b");
		// Subscribers that only throw when non-initial DATA arrives (deferred during batch drain).
		// Push-on-subscribe delivers the initial value (0), so we skip that.
		a.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === DATA && (m[1] as number) > 0)) throw errA;
		});
		b.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === DATA && (m[1] as number) > 0)) throw errB;
		});

		let caught: unknown;
		try {
			batch(() => {
				a.down([[DIRTY], [DATA, 1]]);
				b.down([[DIRTY], [DATA, 2]]);
			});
		} catch (e) {
			caught = e;
		}

		expect(caught).toBeInstanceOf(AggregateError);
		const agg = caught as AggregateError;
		expect(agg.errors).toHaveLength(2);
		expect(agg.errors).toContain(errA);
		expect(agg.errors).toContain(errB);
	});

	// Verify single error still throws unwrapped (backward compat).
	it("batch drain with single callback error throws unwrapped", () => {
		const a = node<number>({ initial: 0 });
		const singleErr = new Error("single");
		// Only throw on non-initial DATA to avoid throwing during push-on-subscribe.
		a.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === DATA && (m[1] as number) > 0)) throw singleErr;
		});

		let caught: unknown;
		try {
			a.down([[DIRTY], [DATA, 1]]);
		} catch (e) {
			caught = e;
		}

		expect(caught).toBe(singleErr);
	});

	// ---------------------------------------------------------------------------
	// subscribe() transactional rollback
	// ---------------------------------------------------------------------------

	// When a dep's subscribe() throws during _activate(), the calling node's
	// subscription must be fully rolled back: sink removed, sinkCount correct,
	// and all previously-subscribed deps unsubscribed. The node must be
	// re-subscribable without counter drift.

	it("subscribe rollback: _activate() dep-throw leaves node clean for re-subscribe", () => {
		const a = state<number>(1);
		const b = state<number>(2);
		// combined depends on [a, b]. We patch b.subscribe to throw once,
		// so _activate() succeeds on a then fails on b.
		const combined = derived([a, b], ([x, y]) => (x as number) + (y as number));

		const err = new Error("subscribe-denied");
		const origB = (b as NodeImpl<number>).subscribe.bind(b);
		let patchCallCount = 0;
		(b as NodeImpl<number>).subscribe = (sink, actor) => {
			if (patchCallCount++ === 0) throw err;
			return origB(sink, actor);
		};

		// Subscribing to combined should throw (b.subscribe fails)
		expect(() => combined.subscribe(() => {})).toThrow("subscribe-denied");

		// Restore b
		(b as NodeImpl<number>).subscribe = origB;

		// combined's internal sinkCount must be 0 — no sink leaked
		expect((combined as NodeImpl<number>)._sinkCount).toBe(0);
		// a must have no subscribers (combined rolled back its subscription to a)
		expect((a as NodeImpl<number>)._sinkCount).toBe(0);

		// Re-subscribe must work and deliver the correct sum
		const seen: number[] = [];
		const unsub = combined.subscribe((msgs) => {
			for (const [t, v] of msgs) if (t === DATA) seen.push(v as number);
		});
		expect(seen).toContain(3); // 1 + 2
		unsub();
	});

	it("subscribe rollback: failed _activate() does not leave orphaned sinks on deps", () => {
		// Three-dep chain: a, b, c. b.subscribe throws. After rollback:
		// - a must have 0 sinks (was subscribed, then rolled back)
		// - b must have 0 sinks (subscribe threw before sink registration)
		// - c must have 0 sinks (never reached)
		const a = state<number>(10);
		const b = state<number>(20);
		const c = state<number>(30);
		const combined = derived(
			[a, b, c],
			([x, y, z]) => (x as number) + (y as number) + (z as number),
		);

		const origB = (b as NodeImpl<number>).subscribe.bind(b);
		(b as NodeImpl<number>).subscribe = () => {
			throw new Error("b-denied");
		};

		expect(() => combined.subscribe(() => {})).toThrow("b-denied");
		(b as NodeImpl<number>).subscribe = origB;

		expect((a as NodeImpl<number>)._sinkCount).toBe(0);
		expect((b as NodeImpl<number>)._sinkCount).toBe(0);
		expect((c as NodeImpl<number>)._sinkCount).toBe(0);
		// combined is clean — subsequent subscribe works
		const vals: number[] = [];
		const unsub = combined.subscribe((msgs) => {
			for (const [t, v] of msgs) if (t === DATA) vals.push(v as number);
		});
		expect(vals).toContain(60);
		unsub();
	});

	it("_addDep rollback: subscribe-throws removes dep record and node recovers cleanly", () => {
		// autoTrackNode discovers dep b during fn. b.subscribe throws on the
		// FIRST internal _addDep call. The dep record must be removed from
		// _deps and _dirtyDepCount must not be left inflated — otherwise the
		// pending-rerun second pass (which retries _addDep(b) and succeeds)
		// would drift the counter and hang the wave.
		//
		// Correct behavior: autoTrackNode treats the first failed discovery as
		// a transient cache read (stores error in ctx.store, does NOT emit ERROR),
		// retries on pendingRerun, succeeds on the second _addDep(b) call, and
		// eventually emits the correct sum without any ERROR.
		const a = state<number>(1);
		const b = state<number>(2);

		const origB = (b as NodeImpl<number>).subscribe.bind(b);
		let addDepCallCount = 0;
		(b as NodeImpl<number>).subscribe = (sink, actor) => {
			// Throw only on the first internal subscribe from _addDep.
			if (addDepCallCount++ === 0) throw new Error("b-transient-denied");
			return origB(sink, actor);
		};

		const tracker = autoTrackNode((track) => {
			const av = track(a) as number;
			const bv = track(b) as number;
			return av + bv;
		});

		const emitted: number[] = [];
		const errors: unknown[] = [];
		const unsub = tracker.subscribe((msgs) => {
			for (const [t, v] of msgs) {
				if (t === DATA) emitted.push(v as number);
				if (t === ERROR) errors.push(v);
			}
		});

		// No ERROR must be emitted — the failed first discovery was retried
		expect(errors).toHaveLength(0);
		// Tracker must have settled to the correct sum (1 + 2 = 3)
		expect(emitted).toContain(3);
		// b is properly subscribed after the second (successful) _addDep call
		expect((b as NodeImpl<number>)._sinkCount).toBeGreaterThan(0);

		unsub();
		(b as NodeImpl<number>).subscribe = origB;
	});

	// ---------------------------------------------------------------------------
	// Stale drainPhase2 liveness check (dep.unsub === null guard)
	// ---------------------------------------------------------------------------

	// When a node subscribes and immediately unsubscribes inside a batch, the
	// handshake DATA is deferred into drainPhase2. After unsubscription,
	// dep.unsub is null. The stale drainPhase2 closure must be silently
	// dropped — it must NOT trigger the node's fn or cause any emissions.

	it("stale drainPhase2 closure is silently dropped after unsubscription", () => {
		const s = state<number>(1);
		const seen: number[] = [];
		const derived1 = derived([s], ([v]) => (v as number) * 10);

		batch(() => {
			// Subscribe to derived1 inside the batch. The handshake DATA(10) is
			// deferred into drainPhase2 because we are inside a batch.
			const unsub = derived1.subscribe((msgs) => {
				for (const [t, v] of msgs) if (t === DATA) seen.push(v as number);
			});
			// Immediately unsubscribe — derived1 deactivates. dep.unsub is set
			// to null by resetDepRecord. The stale drainPhase2 closure now has
			// dep.unsub === null.
			unsub();
		});
		// drainPhase2 ran after the batch. The stale closure must have been
		// dropped — derived1.fn must not have run, no DATA emitted.
		expect(seen).toEqual([]);
		// derived1 has no subscribers now
		expect((derived1 as NodeImpl<number>)._sinkCount).toBe(0);
	});

	it("stale closure dropped but re-subscription after batch works correctly", () => {
		// After the stale-closure scenario, a fresh subscribe must produce the
		// correct value — no counter drift from the dropped stale wave.
		const s = state<number>(5);
		const doubled = derived([s], ([v]) => (v as number) * 2);

		batch(() => {
			const unsub = doubled.subscribe(() => {});
			unsub();
		});

		const seen: number[] = [];
		const unsub2 = doubled.subscribe((msgs) => {
			for (const [t, v] of msgs) if (t === DATA) seen.push(v as number);
		});
		expect(seen).toContain(10); // 5 * 2
		unsub2();
	});
});
