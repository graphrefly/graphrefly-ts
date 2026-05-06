/**
 * Phase 13.6.B Batch 3 — PAUSE buffer reshape verification.
 *
 * Sources:
 * - Lock 2.C — `_pauseBuffer` is `Messages[]` (array of waves), per-wave replay
 * - Lock 2.C′ — current-code refactor: type + push site + drain site
 * - Lock 2.C′-pre — buffer scope extends to tier-3 AND tier-4 (INVALIDATE)
 * - Lock 6.A — `cfg.pauseBufferMax` cap with overflow ERROR (cycle-gated)
 *
 * Audit-sweep tests required by Lock 2.C:
 * (a) multi-DATA wave during pause replays verbatim (no equals collapse)
 * (b) single-DATA wave matching prior buffered wave's emission collapses to
 *     RESOLVED on replay
 * (c) single-RESOLVED wave during pause replays verbatim
 *
 * Plus Lock 2.C′-pre coverage:
 * (d) tier-4 INVALIDATE waves are buffered too
 * (e) cross-tier ordering (DATA wave then INVALIDATE wave) preserved on replay
 *
 * Plus Lock 6.A overflow:
 * (f) buffer at cap drops oldest + ERRORs once per cycle
 * (g) ERROR diagnostic carries { nodeId, droppedCount, configuredMax,
 *     lockHeldDurationMs }
 */

import { describe, expect, it } from "vitest";
import { GraphReFlyConfig, registerBuiltins } from "../../core/config.js";
import { DATA, ERROR, INVALIDATE, PAUSE, RESOLVED, RESUME } from "../../core/messages.js";
import { defaultConfig, node } from "../../core/node.js";

function freshConfig(opts?: { pauseBufferMax?: number }): GraphReFlyConfig {
	const cfg = new GraphReFlyConfig({
		onMessage: defaultConfig.onMessage,
		onSubscribe: defaultConfig.onSubscribe,
	});
	registerBuiltins(cfg);
	if (opts?.pauseBufferMax != null) {
		cfg.pauseBufferMax = opts.pauseBufferMax;
	}
	return cfg;
}

describe("Phase 13.6.B B3 — Lock 2.C wave-shape preserved across pause boundary", () => {
	it("multi-DATA wave during pause replays verbatim (no equals collapse)", () => {
		// Pre-13.6.B bug: the flat `Message[]` buffer split a multi-DATA wave
		// into N single-DATA waves on replay; equals substitution then
		// wrongly collapsed duplicates. With Messages[] + per-wave replay,
		// the wave shape is preserved — `_updateState`'s `dataCount > 1`
		// guard suppresses equals, and both DATAs reach subscribers.
		const s = node<number>([], { pausable: "resumeAll", initial: 0 });
		const seen: number[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) seen.push(m[1] as number);
		});
		const baseLen = seen.length;

		const lock = Symbol("multi-data");
		s.down([[PAUSE, lock]]);

		// One down() call carrying multiple DATA = one multi-DATA wave.
		s.down([
			[DATA, 5],
			[DATA, 5], // duplicate — must NOT collapse on replay
		]);

		s.down([[RESUME, lock]]);

		expect(seen.slice(baseLen)).toEqual([5, 5]);
		expect(s.cache).toBe(5);
		unsub();
	});

	it("repeated single-DATA pulses with the same value during pause are absorbed (current impl)", () => {
		// Two consecutive single-DATA waves with the same value. **Current
		// 13.6.B B3 impl** advances `_cached` during the original mid-pause
		// wave's `_updateState`, so by replay time the cache already equals
		// the buffered DATA's payload — both replayed waves collapse to
		// RESOLVED via equals substitution. This is the long-standing
		// "absorbed pulse" semantic (D2, 2026-04-13).
		//
		// Lock 2.C's spec-intent ("cache reference for replay equals = end
		// of *previous wave in the buffer*, starting from pre-pause cache")
		// would make wave 1 emit DATA(7) and wave 2 collapse to RESOLVED —
		// see `docs/optimizations.md` "Lock 2.C — pre-pause cache snapshot
		// for replay equals" for the deferred follow-up that brings the
		// impl into spec alignment. Producers that need pulse semantics
		// (every write observable regardless of value) should set
		// `equals: () => false` on the node today.
		const s = node<number>([], { pausable: "resumeAll", initial: 0 });
		const seen: Array<[symbol, unknown?]> = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0], m[1]]);
		});
		const baseLen = seen.length;

		const lock = Symbol("collapse");
		s.down([[PAUSE, lock]]);
		s.emit(7);
		s.emit(7);
		s.down([[RESUME, lock]]);

		const tail = seen.slice(baseLen);
		const dataPayloads = tail.filter(([t]) => t === DATA).map(([, v]) => v);
		const resolvedCount = tail.filter(([t]) => t === RESOLVED).length;
		// Current behavior: both waves collapse to RESOLVED on replay.
		expect(dataPayloads).toEqual([]);
		expect(resolvedCount).toBeGreaterThanOrEqual(2);
		expect(s.cache).toBe(7);
		unsub();
	});

	it("single-RESOLVED wave during pause replays verbatim", () => {
		// A `down([[RESOLVED]])` call against a node that already has a cache
		// produces a single-RESOLVED wave. The buffer must store and replay
		// it without rewriting.
		const s = node<number>([], { pausable: "resumeAll", initial: 99 });
		const seen: symbol[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});
		const baseLen = seen.length;

		const lock = Symbol("resolved");
		s.down([[PAUSE, lock]]);
		s.down([[RESOLVED]]);
		s.down([[RESUME, lock]]);

		expect(seen.slice(baseLen)).toContain(RESOLVED);
		expect(s.cache).toBe(99);
		unsub();
	});
});

describe("Phase 13.6.B B3 — Lock 2.C′-pre tier-4 INVALIDATE buffered + ordered", () => {
	it("INVALIDATE wave during pause is buffered (does NOT clear cache mid-pause)", () => {
		// Pre-13.6.B: tier-4 INVALIDATE bypassed the buffer and ran through
		// _updateState immediately mid-pause, clearing cache while subscribers
		// were still cut off. Lock 2.C′-pre says INVALIDATE is part of the
		// settle slice and must be buffered.
		const s = node<number>([], { pausable: "resumeAll", initial: 42 });
		const seen: Array<[symbol, unknown?]> = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0], m[1]]);
		});
		const baseLen = seen.length;

		const lock = Symbol("invalidate-buffered");
		s.down([[PAUSE, lock]]);

		// Send INVALIDATE while paused. Without buffering, this would reset
		// cache to undefined and status to "sentinel" mid-pause — observable
		// to a snapshot but the subscriber sees nothing until replay. With
		// buffering, mid-pause cache stays at 42 (the original wave's
		// `_updateState` still ran since we don't gate state mutations on
		// pause; but the message itself is buffered for replay).
		s.down([[INVALIDATE]]);
		// Subscriber must NOT have seen INVALIDATE while paused.
		const tailMid = seen.slice(baseLen);
		expect(tailMid.map(([t]) => t)).not.toContain(INVALIDATE);

		s.down([[RESUME, lock]]);

		// On replay, INVALIDATE reaches the subscriber.
		const tailFinal = seen.slice(baseLen);
		expect(tailFinal.map(([t]) => t)).toContain(INVALIDATE);
		unsub();
	});

	it("DATA wave then INVALIDATE wave preserved in arrival order on replay", () => {
		const s = node<number>([], { pausable: "resumeAll", initial: 0 });
		const seen: Array<[symbol, unknown?]> = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0], m[1]]);
		});
		const baseLen = seen.length;

		const lock = Symbol("ordered");
		s.down([[PAUSE, lock]]);
		s.emit(1); // wave A — single-DATA
		s.down([[INVALIDATE]]); // wave B — single-INVALIDATE
		s.emit(2); // wave C — single-DATA after invalidate
		s.down([[RESUME, lock]]);

		// Pull just the settle-class entries (DATA / RESOLVED / INVALIDATE)
		// from the post-base trace.
		const tail = seen
			.slice(baseLen)
			.filter(([t]) => t === DATA || t === RESOLVED || t === INVALIDATE);
		// Expect: DATA(1), INVALIDATE, DATA(2). The DATA(1) carries the value
		// because cache was 0 before; equals(0,1) false → DATA. INVALIDATE
		// resets cache. DATA(2) carries because cache is now undefined.
		const types = tail.map(([t]) => t);
		const dataValues = tail.filter(([t]) => t === DATA).map(([, v]) => v);
		expect(types).toEqual([DATA, INVALIDATE, DATA]);
		expect(dataValues).toEqual([1, 2]);
		unsub();
	});
});

describe("Phase 13.6.B B3 — Lock 6.A pauseBufferMax overflow", () => {
	it("buffer over cap emits ERROR once per cycle and transitions node to terminal", () => {
		// Lock 6.A: "The error propagates downstream per default error
		// semantics (rule 1.4)." Rule 1.4 makes ERROR a terminal lifecycle
		// signal — overflow heavy-hands the node into `"errored"` rather
		// than silently shedding past the first drop. Bump
		// `cfg.pauseBufferMax` if the producer's sustained pause backlog
		// genuinely exceeds the default 10_000.
		const cfg = freshConfig({ pauseBufferMax: 3 });
		const s = node<number>([], { pausable: "resumeAll", initial: 0, config: cfg });
		const seen: Array<[symbol, unknown?]> = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0], m[1]]);
		});
		const baseLen = seen.length;

		const lock = Symbol("overflow");
		s.down([[PAUSE, lock]]);
		s.emit(1);
		s.emit(2);
		s.emit(3);
		s.emit(4); // first overflow → ERROR + terminal
		s.emit(5); // post-terminal — no-op

		const errorsMidPause = seen.slice(baseLen).filter(([t]) => t === ERROR);
		expect(errorsMidPause.length).toBe(1);
		// Node is now terminal.
		expect(s.status).toBe("errored");

		// RESUME after terminal — buffered waves are NOT replayed (terminal
		// node's `_emit` no-ops on tier-3 input).
		s.down([[RESUME, lock]]);
		const dataValues = seen
			.slice(baseLen)
			.filter(([t]) => t === DATA)
			.map(([, v]) => v);
		expect(dataValues).toEqual([]);
		unsub();
	});

	it("overflow ERROR carries diagnostic { nodeId, droppedCount, configuredMax, lockHeldDurationMs }", () => {
		const cfg = freshConfig({ pauseBufferMax: 1 });
		const s = node<number>([], {
			pausable: "resumeAll",
			initial: 0,
			config: cfg,
			name: "overflow-diag",
		});
		const errors: Error[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === ERROR) errors.push(m[1] as Error);
			}
		});

		const lock = Symbol("diag");
		s.down([[PAUSE, lock]]);
		s.emit(1);
		s.emit(2); // first overflow → ERROR + terminal
		s.emit(3); // post-terminal — no-op
		s.down([[RESUME, lock]]);

		expect(errors.length).toBe(1);
		const detail = (errors[0] as Error & { detail?: Record<string, unknown> }).detail;
		expect(detail).toBeDefined();
		expect(detail?.nodeId).toBe("overflow-diag");
		expect(detail?.configuredMax).toBe(1);
		expect(typeof detail?.droppedCount).toBe("number");
		expect(detail?.droppedCount).toBeGreaterThanOrEqual(1);
		expect(typeof detail?.lockHeldDurationMs).toBe("number");
		expect(detail?.lockHeldDurationMs).toBeGreaterThanOrEqual(0);
		// And the node is terminal (Lock 6.A G1.2 fix — overflow ERROR
		// transitions status, not just delivers signal out-of-band).
		expect(s.status).toBe("errored");
		// Single-line readable error (no doubled `Node "X":` prefix from
		// `_wrapFnError` on top of the inner message — G2.3 fix).
		expect(errors[0].message.split("Node ").length).toBe(2);
		unsub();
	});

	it("overflow bookkeeping resets via _resetForFreshLifecycle on resubscribable terminal recovery", () => {
		// Resubscribable node hits overflow → terminal. After last unsub +
		// re-subscribe, `subscribe` invokes `_resetForFreshLifecycle()`
		// which clears `_pauseStartNs / _pauseDroppedCount / _pauseOverflowed`
		// (G2.1 fix). The next pause cycle's overflow can therefore emit a
		// fresh ERROR rather than being gated by stale `_pauseOverflowed === true`.
		const cfg = freshConfig({ pauseBufferMax: 1 });
		const s = node<number>([], {
			pausable: "resumeAll",
			initial: 0,
			resubscribable: true,
			config: cfg,
		});

		// Cycle 1 — overflow → terminal.
		const errors1: Error[] = [];
		let u1 = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === ERROR) errors1.push(m[1] as Error);
		});
		s.down([[PAUSE, Symbol("c1")]]);
		s.emit(1);
		s.emit(2); // overflow → ERROR + terminal
		expect(errors1.length).toBe(1);
		expect(s.status).toBe("errored");
		u1();

		// Cycle 2 — re-subscribe (triggers _resetForFreshLifecycle on the
		// resubscribable terminal node). New pause cycle works fresh.
		const errors2: Error[] = [];
		u1 = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === ERROR) errors2.push(m[1] as Error);
		});
		s.down([[PAUSE, Symbol("c2")]]);
		s.emit(10);
		s.emit(20); // overflow → fresh ERROR (would be silenced by stale _pauseOverflowed)
		expect(errors2.length).toBe(1);
		u1();
	});
});

describe("Phase 13.6.B B3 — Lock 4.A G1.3 cleanup hook fires once across pause/replay", () => {
	it("onInvalidate fires exactly once when INVALIDATE is buffered through pause and replayed on RESUME", () => {
		// Pre-G1.3 bug: `c.onInvalidate` was NOT nulled after firing in the
		// `_updateState` INVALIDATE branch. A buffered INVALIDATE wave fired
		// the hook once during the original mid-pause `_updateState` walk
		// AND AGAIN when the wave was replayed on RESUME — double-firing
		// resource teardown / cache flush hooks. G1.3 nulls the slot before
		// invocation (mirroring `onRerun`'s pattern), so the replay walk
		// sees `c.onInvalidate === undefined` and skips.
		let invalidations = 0;
		const src = node<number>([], { pausable: "resumeAll", initial: 1 });
		const d = node<number>([src], (data, a) => {
			a.emit((data[0]?.at(-1) as number) ?? 0);
			return {
				onInvalidate: () => {
					invalidations++;
				},
			};
		});
		const unsub = d.subscribe(() => undefined);
		expect(invalidations).toBe(0);

		// Pause downstream, send INVALIDATE through src → d while paused.
		const lock = Symbol("once");
		d.down([[PAUSE, lock]]);
		src.down([[INVALIDATE]]); // buffers an INVALIDATE wave on `d`
		d.down([[RESUME, lock]]);

		// Hook fires exactly once across the pause boundary, not twice.
		expect(invalidations).toBe(1);
		unsub();
	});
});
