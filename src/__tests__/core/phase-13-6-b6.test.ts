/**
 * Phase 13.6.B Batch 6 — `replayBuffer: N` implementation (Lock 6.G, spec §2.5).
 *
 * The node maintains a circular buffer of the last N **outgoing** DATA
 * values; new (late) subscribers receive the buffer as one wave after
 * the START handshake. Replaces the legacy `replay()` operator + sink-
 * hook monkey-patching pattern.
 *
 * Audit-sweep tests required by Lock 6.G:
 * (a) late subscriber sees buffered DATAs in order, after START
 * (b) capacity overflow drops oldest
 * (c) `replayBuffer: 0` / absent / negative / NaN → feature disabled
 * (d) RESOLVED entries are NOT buffered (equals-substituted DATA)
 * (e) INVALIDATE on a non-terminal node preserves buffer (history survives)
 * (f) TEARDOWN clears buffer
 * (g) Resubscribable lifecycle reset (terminal-then-subscribe) clears buffer
 * (h) `initial:` value alone does not populate the buffer (only outgoing DATA)
 * (i) interaction with pause: pause-buffered DATAs push to replay only when
 *     RESUME drain dispatches them to sinks (not during mid-pause cache
 *     advance)
 * (j) buffer survives subscribe/unsubscribe cycles for non-resubscribable nodes
 *     that keep at least one sink alive (no `_deactivate` in between)
 */

import { describe, expect, it } from "vitest";
import { COMPLETE, DATA, INVALIDATE, PAUSE, RESUME, START, TEARDOWN } from "../../core/messages.js";
import { node } from "../../core/node.js";

describe("Phase 13.6.B B6 — Lock 6.G `replayBuffer: N` core behavior", () => {
	it("(a) late subscriber receives buffered DATAs in order after START", () => {
		const s = node<number>([], { replayBuffer: 5 });
		const earlySeen: number[] = [];
		const earlyUnsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) earlySeen.push(m[1] as number);
		});

		s.emit(1);
		s.emit(2);
		s.emit(3);

		// Late subscriber arrives — must receive buffered history.
		const lateOrder: Array<[symbol, unknown?]> = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) lateOrder.push([m[0], m[1]]);
		});

		// Late sub must see START first, then DATA for each buffered value.
		expect(lateOrder[0][0]).toBe(START);
		const lateData = lateOrder.filter(([t]) => t === DATA).map(([, v]) => v);
		expect(lateData).toEqual([1, 2, 3]);

		// Live emission after subscribe goes to both subscribers.
		s.emit(4);
		expect(earlySeen).toEqual([1, 2, 3, 4]);
		const lateLive = lateOrder
			.filter(([t]) => t === DATA)
			.map(([, v]) => v)
			.slice(3); // drop the replay slice
		expect(lateLive).toEqual([4]);

		earlyUnsub();
		lateUnsub();
	});

	it("(b) capacity overflow drops oldest", () => {
		const s = node<number>([], { replayBuffer: 3 });
		const keepAlive = s.subscribe(() => {});

		s.emit(1);
		s.emit(2);
		s.emit(3);
		s.emit(4); // pushes 1 out
		s.emit(5); // pushes 2 out

		const lateData: number[] = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) lateData.push(m[1] as number);
		});

		expect(lateData).toEqual([3, 4, 5]);

		keepAlive();
		lateUnsub();
	});

	it("(c) replayBuffer: 0 / negative / NaN / absent → feature disabled", () => {
		for (const cap of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
			const s = node<number>([], cap === undefined ? {} : { replayBuffer: cap });
			const keepAlive = s.subscribe(() => {});
			s.emit(1);
			s.emit(2);
			const lateData: number[] = [];
			const lateUnsub = s.subscribe((msgs) => {
				for (const m of msgs) if (m[0] === DATA) lateData.push(m[1] as number);
			});
			// With buffer disabled, late sub gets only the cache push (one DATA).
			expect(lateData).toEqual([2]);
			keepAlive();
			lateUnsub();
		}
	});

	it("(d) RESOLVED entries are NOT buffered (equals-substituted DATA)", () => {
		const s = node<number>([], { replayBuffer: 5 });
		const keepAlive = s.subscribe(() => {});

		s.emit(1);
		s.emit(1); // equals → RESOLVED, not pushed
		s.emit(2);
		s.emit(2); // equals → RESOLVED, not pushed
		s.emit(3);

		const lateData: number[] = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) lateData.push(m[1] as number);
		});

		expect(lateData).toEqual([1, 2, 3]);

		keepAlive();
		lateUnsub();
	});

	it("(e) INVALIDATE on a non-terminal node preserves the replay buffer", () => {
		const s = node<number>([], { replayBuffer: 5 });
		const keepAlive = s.subscribe(() => {});

		s.emit(10);
		s.emit(20);
		s.emit(30);

		// INVALIDATE — clears _cached, sets status to "sentinel". Per spec
		// §2.5 + Lock 6.G semantics confirmed in B6 design discussion: the
		// replay buffer is independent of `_cached` and represents emission
		// history, not current value. INVALIDATE does NOT touch it.
		s.down([[INVALIDATE]]);
		expect(s.cache).toBeUndefined();
		expect(s.status).toBe("sentinel");

		const lateData: number[] = [];
		const lateOrder: symbol[] = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) {
				lateOrder.push(m[0] as symbol);
				if (m[0] === DATA) lateData.push(m[1] as number);
			}
		});

		// Late sub gets START + the prior history.
		expect(lateOrder[0]).toBe(START);
		expect(lateData).toEqual([10, 20, 30]);

		keepAlive();
		lateUnsub();
	});

	it("(f) TEARDOWN clears the replay buffer (history dropped)", () => {
		// `resetOnTeardown: true` so this state node's `_cached` is also
		// cleared (otherwise RAM rule preserves it and the cache-DATA
		// fallback would deliver the last value — separate concern from
		// buffer clearing). With both cleared, a re-subscribe sees no
		// DATA at all, proving the buffer was cleared (not "merged into
		// cache push").
		const s = node<number>([], {
			replayBuffer: 5,
			resubscribable: true,
			resetOnTeardown: true,
		});
		const keepAlive = s.subscribe(() => {});

		s.emit(1);
		s.emit(2);
		s.emit(3);

		s.down([[TEARDOWN]]);
		keepAlive();

		const lateData: number[] = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) lateData.push(m[1] as number);
		});

		expect(lateData).toEqual([]);

		lateUnsub();
	});

	it("(f, follow-up) state node without `resetOnTeardown` — buffer cleared, cache preserved", () => {
		// State node default: TEARDOWN preserves `_cached` (RAM rule). The
		// replay buffer is still cleared — a re-subscribe sees the
		// single cache value via the legacy cache-DATA push, NOT the
		// pre-teardown emission history.
		const s = node<number>([], { replayBuffer: 5, resubscribable: true });
		const keepAlive = s.subscribe(() => {});

		s.emit(1);
		s.emit(2);
		s.emit(3);

		s.down([[TEARDOWN]]);
		keepAlive();

		const lateData: number[] = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) lateData.push(m[1] as number);
		});

		// Only the residual cached value (3), NOT the full buffered history.
		expect(lateData).toEqual([3]);

		lateUnsub();
	});

	it("(g) terminal-resubscribable subscribe after COMPLETE clears buffer", () => {
		// Drive node to terminal (COMPLETE), drop the sink so `_deactivate`
		// fires + clears `_replayBuffer`. New sub after terminal goes through
		// `_resetForFreshLifecycle` (afterTerminalReset path) — also a
		// belt-and-suspenders clear. Either path leaves the buffer empty.
		const s = node<number>([], { replayBuffer: 5, resubscribable: true });
		const sinkA = s.subscribe(() => {});
		s.emit(1);
		s.emit(2);
		s.emit(3);

		s.down([[COMPLETE]]);
		sinkA();

		const lateData: number[] = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) lateData.push(m[1] as number);
		});

		expect(lateData).toEqual([]);

		lateUnsub();
	});

	it("(h) `initial:` value alone does not populate replay buffer", () => {
		// Pre-populated cache via `initial` is NOT an outgoing emission —
		// the buffer should remain empty. Late sub should fall back to the
		// legacy cache-DATA push for the initial value.
		const s = node<number>([], { initial: 42, replayBuffer: 5 });

		const seen: Array<[symbol, unknown?]> = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0], m[1]]);
		});

		// Subscriber sees START + DATA(42) via the legacy path (buffer empty
		// because no `emit` yet). Exactly one DATA, not duplicated.
		const dataPayloads = seen.filter(([t]) => t === DATA).map(([, v]) => v);
		expect(dataPayloads).toEqual([42]);

		unsub();
	});

	it("(h, follow-up) once node emits, buffer takes over from cache push", () => {
		const s = node<number>([], { initial: 42, replayBuffer: 3 });
		const keepAlive = s.subscribe(() => {});
		s.emit(100);
		s.emit(200);

		const lateData: number[] = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) lateData.push(m[1] as number);
		});

		// Late sub sees buffered history [42-was-cache-but-not-buffered, 100, 200]
		// — but `42` was never an outgoing emission, so only [100, 200] show up.
		// The buffer takes priority over cache push (no duplicate `200` from cache).
		expect(lateData).toEqual([100, 200]);

		keepAlive();
		lateUnsub();
	});

	it("(i) pause/resume — replay buffer pushes only when DATA actually dispatches", () => {
		// Mid-pause emissions advance `_cached` (the original wave's
		// `_updateState` runs synchronously) but DON'T dispatch to sinks.
		// Per Lock 6.G spec ("outgoing DATA"), the replay buffer must NOT
		// push during pause-buffering. On RESUME drain, the buffered waves
		// replay through `_emit(wave)` and reach the dispatch site — at
		// which point they push to the replay buffer.
		//
		// QA D6 (Phase 13.6.B QA pass): asserts the EXACT post-resume
		// buffer contents to lock the post-equals "outgoing" semantic.
		// Each buffered wave goes through `_updateState` again on drain;
		// equals-substitution compares each replayed DATA against the
		// walking cache. With distinct values 1/2/3 and the cache walking
		// 3→1→2→3, every replayed DATA differs from the current cache and
		// dispatches as DATA → buffer accumulates [1, 2, 3]. If a future
		// refactor moved the push site INTO `_updateState`, mid-pause
		// emissions would push (corrupting the "values-seen" semantic) and
		// this assertion would shift — catching the regression.
		const s = node<number>([], { pausable: "resumeAll", replayBuffer: 10 });
		const keepAlive = s.subscribe(() => {});

		const lock = Symbol("pause-replay");
		s.down([[PAUSE, lock]]);
		s.emit(1);
		s.emit(2);
		s.emit(3);

		// Mid-pause: late sub arriving here has empty replay buffer → falls
		// back to cache-DATA push (latest mid-pause cache). Confirms the
		// dispatch-only push semantic — no buffer entries accumulated yet.
		const midPauseData: number[] = [];
		const midPauseUnsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) midPauseData.push(m[1] as number);
		});
		expect(midPauseData).toEqual([3]);
		midPauseUnsub();

		s.down([[RESUME, lock]]);

		// Post-RESUME drain: the three buffered waves replay through
		// `_emit`. Cache walks 3→1→2→3 (each replayed DATA differs from
		// the current cache, so equals-substitution does NOT collapse to
		// RESOLVED). Each dispatches DATA → pushes to replay buffer.
		// Buffer post-resume = [1, 2, 3].
		const lateData: number[] = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) lateData.push(m[1] as number);
		});

		expect(lateData).toEqual([1, 2, 3]);

		keepAlive();
		lateUnsub();
	});

	it("(i.2) pause/resume — equals-collapsed mid-pause emits do NOT push to replay buffer", () => {
		// QA D6 follow-up: explicitly exercise the post-equals "outgoing"
		// semantic. Mid-pause emit values that match the seed via equals;
		// on RESUME drain, equals-substitution collapses each to RESOLVED
		// → those waves do NOT push to the replay buffer (push site is
		// gated on the `DATA` message type after `_updateState`'s
		// substitution). Buffer post-resume = [] because every replayed
		// wave collapsed.
		const s = node<number>([], {
			pausable: "resumeAll",
			replayBuffer: 10,
			initial: 7,
		});
		const keepAlive = s.subscribe(() => {});

		const lock = Symbol("pause-collapse");
		s.down([[PAUSE, lock]]);
		// Emit the same value the cache already holds — every wave will
		// collapse to RESOLVED on replay (equals(7, 7) = true).
		s.emit(7);
		s.emit(7);
		s.emit(7);
		s.down([[RESUME, lock]]);

		const lateData: number[] = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) lateData.push(m[1] as number);
		});

		// Buffer is empty → late sub falls back to cache-DATA push (the
		// preserved `_cached === 7`). NOT three identical replays.
		expect(lateData).toEqual([7]);

		keepAlive();
		lateUnsub();
	});

	it("(j) buffer persists across subscribe/unsubscribe when keepalive prevents _deactivate", () => {
		const s = node<number>([], { replayBuffer: 3 });
		const keepAlive = s.subscribe(() => {});

		s.emit(7);
		s.emit(8);
		s.emit(9);

		// Subscribe → unsubscribe a transient sink. `_deactivate` does NOT
		// fire because `keepAlive` keeps `_sinkCount > 0`. Buffer must
		// persist for the next late sub.
		const transient = s.subscribe(() => {});
		transient();

		const lateData: number[] = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) lateData.push(m[1] as number);
		});

		expect(lateData).toEqual([7, 8, 9]);

		keepAlive();
		lateUnsub();
	});

	it("(k) sentinel-status node with empty buffer falls back to no-DATA START handshake", () => {
		// Compute node, no `initial`, no emit, no DATA — `_cached` undefined,
		// status sentinel, buffer empty. Sub should see only START (no DATA).
		const s = node<number>([], { replayBuffer: 5 });
		const seen: symbol[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});

		expect(seen).toContain(START);
		expect(seen).not.toContain(DATA);

		unsub();
	});

	it("(l) buffer correctly captures `null` payloads (null is valid DATA)", () => {
		const s = node<number | null>([], { replayBuffer: 3 });
		const keepAlive = s.subscribe(() => {});

		s.emit(1);
		s.emit(null);
		s.emit(2);

		const lateData: Array<number | null> = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) lateData.push(m[1] as number | null);
		});

		expect(lateData).toEqual([1, null, 2]);

		keepAlive();
		lateUnsub();
	});

	it("(m) capacity is floored from fractional input", () => {
		// Lock 6.G: clamp via Math.floor. `replayBuffer: 2.7` → capacity 2.
		const s = node<number>([], { replayBuffer: 2.7 });
		const keepAlive = s.subscribe(() => {});

		s.emit(1);
		s.emit(2);
		s.emit(3);

		const lateData: number[] = [];
		const lateUnsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) lateData.push(m[1] as number);
		});

		expect(lateData).toEqual([2, 3]);

		keepAlive();
		lateUnsub();
	});
});
