/**
 * DS-2.7.A — first-run gate cross-port lock (spec §2.7).
 *
 * Pins the four normative rules locked 2026-05-19 in
 * `archive/docs/SESSION-DS-2.7.A-first-run-gate.md`:
 *
 * - `R2.7.0` — RESOLVED does NOT settle the gate. A dep that only ever
 *   emits RESOLVED holds the gate forever.
 * - `R2.7.1` — Terminal does NOT settle by default; Reduce-class operators
 *   opt in via `NodeOptions.terminalAsRealInput: true`.
 * - `R2.7.2` — `partial: true` truly disables the gate (the fn body MUST
 *   guard SENTINEL slots); `terminalAsRealInput` is ignored when
 *   `partial: true` (the gate is OFF either way).
 * - `R2.7.3` — Gate scope = `_hasCalledFnOnce`. INVALIDATE does NOT re-arm.
 *
 * These assertions target the bare `node()` primitive — operator-level
 * Reduce-class behavior is covered separately by the existing
 * `operators.test.ts` `reduce` / `last` / `take` suites, and by the
 * cross-impl behavioral parity scenario at
 * `packages/parity-tests/scenarios/core/first-run-gate.test.ts`.
 *
 * **`ctx.prevData[i]` reflects the END of the *previous* wave** (see
 * `node.ts:2810` — snapshot taken BEFORE this wave's commit). For the
 * *current* wave's value, read `data[i]?.at(-1)` (the fn's first
 * argument) per the documented contract. Combined access pattern:
 * `data[i]?.at(-1) ?? ctx.prevData[i]`.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { COMPLETE, ERROR, INVALIDATE, RESOLVED } from "../../core/messages.js";
import { node } from "../../core/node.js";

/** Convenience: "current value of dep i this fn-fire" — DATA this wave with
 * prevData fallback. Mirrors `dynamicNode`'s unwrap (`core/sugar.ts:91-101`).
 * (`graph.derived` passes raw `batchData` to the user fn — it does NOT
 * unwrap; only `dynamicNode`/`autoTrackNode` do.) Correctness relies on the
 * spec §1.2 invariant that `undefined` is never a valid DATA payload — if a
 * batch is non-empty its last element is the real DATA value, never the
 * SENTINEL. */
function currentOf(
	data: readonly (readonly unknown[] | undefined)[],
	prevData: readonly unknown[],
	i: number,
): unknown {
	const batch = data[i];
	if (batch != null && batch.length > 0) return batch[batch.length - 1];
	return prevData[i];
}

describe("DS-2.7.A R2.7.0 — RESOLVED does NOT settle the first-run gate", () => {
	it("a dep that only ever emits RESOLVED keeps fn gated forever", () => {
		const ready = node<number>([], { initial: 1 });
		const resolvedOnly = node<number>(); // sentinel forever from this side
		const fired: Array<unknown> = [];
		const out = node<unknown>([ready, resolvedOnly], (data, a, ctx) => {
			fired.push([currentOf(data, ctx.prevData, 0), currentOf(data, ctx.prevData, 1)]);
			a.emit(true);
		});
		const unsub = out.subscribe(() => undefined);
		try {
			// Direct RESOLVED on `resolvedOnly` — explicitly NOT a DATA delivery.
			resolvedOnly.down([[RESOLVED]]);
			// ready has cached DATA via push-on-subscribe; resolvedOnly only
			// ever sent RESOLVED — gate must HOLD.
			expect(fired).toHaveLength(0);
		} finally {
			unsub();
		}
	});

	it("once the RESOLVED-only dep finally emits DATA, fn fires once", () => {
		const ready = node<number>([], { initial: 1 });
		const slow = node<number>();
		const fired: Array<[unknown, unknown]> = [];
		const out = node<unknown>([ready, slow], (data, a, ctx) => {
			fired.push([currentOf(data, ctx.prevData, 0), currentOf(data, ctx.prevData, 1)]);
			a.emit(true);
		});
		const unsub = out.subscribe(() => undefined);
		try {
			slow.down([[RESOLVED]]); // gate still held
			expect(fired).toHaveLength(0);
			slow.emit(7); // real DATA — releases the gate
			expect(fired).toEqual([[1, 7]]);
		} finally {
			unsub();
		}
	});
});

describe("DS-2.7.A R2.7.1 — terminal does NOT settle the gate by default", () => {
	it("default (no terminalAsRealInput): COMPLETE-only dep holds the gate", () => {
		const ready = node<number>([], { initial: 1 });
		const completeOnly = node<number>(); // will COMPLETE without ever emitting DATA
		const fired: Array<unknown> = [];
		const out = node<unknown>([ready, completeOnly], (_data, a) => {
			fired.push(true);
			a.emit(true);
		});
		const unsub = out.subscribe(() => undefined);
		try {
			completeOnly.down([[COMPLETE]]);
			expect(fired).toHaveLength(0);
		} finally {
			unsub();
		}
	});

	it("default: ERROR-only dep also holds the gate (terminal !== DATA)", () => {
		const ready = node<number>([], { initial: 1 });
		const errorOnly = node<number>();
		const fired: Array<unknown> = [];
		// `errorWhenDepsError: false` so the gate-holds path is observed
		// rather than the ERROR-propagation path tearing the wave first.
		const out = node<unknown>(
			[ready, errorOnly],
			(_data, a) => {
				fired.push(true);
				a.emit(true);
			},
			{ errorWhenDepsError: false },
		);
		const unsub = out.subscribe(() => undefined);
		try {
			errorOnly.down([[ERROR, new Error("boom")]]);
			expect(fired).toHaveLength(0);
		} finally {
			unsub();
		}
	});

	it("terminalAsRealInput: true — COMPLETE-only dep releases the gate", () => {
		const ready = node<number>([], { initial: 1 });
		const completeOnly = node<number>();
		const fired: Array<[unknown, unknown, unknown]> = [];
		const out = node<unknown>(
			[ready, completeOnly],
			(data, a, ctx) => {
				fired.push([
					currentOf(data, ctx.prevData, 0),
					currentOf(data, ctx.prevData, 1),
					ctx.terminalDeps[1],
				]);
				a.emit(true);
			},
			{ terminalAsRealInput: true, completeWhenDepsComplete: false },
		);
		const unsub = out.subscribe(() => undefined);
		try {
			completeOnly.down([[COMPLETE]]);
			expect(fired).toHaveLength(1);
			expect(fired[0]?.[0]).toBe(1); // ready cached DATA carried over
			expect(fired[0]?.[1]).toBeUndefined(); // completeOnly never emitted DATA
			expect(fired[0]?.[2]).toBe(true); // terminalDeps[1] === true (COMPLETE)
		} finally {
			unsub();
		}
	});
});

describe("DS-2.7.A R2.7.2 — partial: true disables the gate; SENTINEL must be guarded by fn body", () => {
	it("partial: true fires fn on a SENTINEL dep slot (prevData[i] === undefined for the SENTINEL slot)", () => {
		const a = node<number>([], { initial: 1 });
		const b = node<number>(); // sentinel forever
		const fired: Array<[unknown, unknown, unknown]> = [];
		const out = node<unknown>(
			[a, b],
			(data, ax, ctx) => {
				fired.push([
					currentOf(data, ctx.prevData, 0),
					currentOf(data, ctx.prevData, 1),
					ctx.prevData[1],
				]);
				ax.emit(true);
			},
			{ partial: true },
		);
		const unsub = out.subscribe(() => undefined);
		try {
			// a's push-on-subscribe wave fires fn EXACTLY once even though b
			// is sentinel — partial:true releases the gate; subsequent waves
			// would not re-fire fn without a new dep wave.
			expect(fired).toHaveLength(1);
			expect(fired[0]?.[0]).toBe(1); // a delivered DATA(1) this wave
			expect(fired[0]?.[1]).toBeUndefined(); // b never emitted — SENTINEL slot
			expect(fired[0]?.[2]).toBeUndefined(); // and ctx.prevData[1] is the SENTINEL guard the fn body must check
		} finally {
			unsub();
		}
	});

	// QA F5 (DS-2.7.A `/qa` 2026-05-20) — de-tautologized: the original test
	// compared two `partial: true` nodes whose deps NEVER terminated, so the
	// terminal-aware code path in the predicate was never exercised regardless
	// of the flag value. Vacuously identical outputs do not prove the flag is
	// ignored. This rewrite drives BOTH variants through a real terminal AFTER
	// fn has already fired (still in the first-wave gate window — see the
	// `out2.terminalAsRealInput:true` variant); both must observe identical
	// terminal-handling behavior because the outer `!_partial` short-circuit
	// at `node.ts:2689` skips the entire terminal-aware predicate.
	it("partial: true × terminalAsRealInput is ignored — both variants behave identically across an upstream terminal", () => {
		// Variant A: partial:true only. Variant B: partial:true + flag.
		// If the predicate ever started consulting `_terminalAsRealInput`
		// under `partial: true`, the two variants would diverge in the
		// fn-fire count or in the SENTINEL slot read after the terminal.
		function build(flag: boolean): {
			fires: Array<[unknown, unknown]>;
			b: ReturnType<typeof node<number>>;
			unsub: () => void;
		} {
			const a = node<number>([], { initial: 1 });
			const b = node<number>(); // sentinel, will terminate later
			const fires: Array<[unknown, unknown]> = [];
			const out = node<unknown>(
				[a, b],
				(data, ax, ctx) => {
					fires.push([currentOf(data, ctx.prevData, 0), currentOf(data, ctx.prevData, 1)]);
					ax.emit(true);
				},
				flag ? { partial: true, terminalAsRealInput: true } : { partial: true },
			);
			const unsub = out.subscribe(() => undefined);
			return { fires, b, unsub };
		}

		const A = build(false);
		const B = build(true);
		try {
			// Phase 1 — push-on-subscribe with a's DATA + b sentinel: BOTH
			// variants fire exactly once with the SENTINEL slot undefined.
			expect(A.fires).toEqual([[1, undefined]]);
			expect(B.fires).toEqual([[1, undefined]]);

			// Phase 2 — b COMPLETEs without any DATA. partial:true means
			// the gate is OFF either way; the COMPLETE wave delivers terminal
			// state with no DATA → fn fires per-wave only if some dep was
			// dirty. b was dirty from push-on-subscribe handling.
			//
			// The critical assertion: A and B see IDENTICAL post-terminal
			// behavior. If `terminalAsRealInput` had ANY effect under
			// `partial: true`, B's fire count would diverge from A's.
			A.b.down([[COMPLETE]]);
			B.b.down([[COMPLETE]]);

			expect(A.fires).toEqual(B.fires);
		} finally {
			A.unsub();
			B.unsub();
		}
	});
});

describe("DS-2.7.A R2.7.3 — gate scope is `_hasCalledFnOnce`; INVALIDATE does not re-arm", () => {
	it("after fn fires once, an INVALIDATE on one dep does NOT re-gate on the other still-sentinel dep", () => {
		const a = node<number>([], { initial: 1 });
		const b = node<number>([], { initial: 2 });
		const fired: Array<[unknown, unknown]> = [];
		const out = node<unknown>([a, b], (data, ax, ctx) => {
			fired.push([currentOf(data, ctx.prevData, 0), currentOf(data, ctx.prevData, 1)]);
			ax.emit(true);
		});
		const unsub = out.subscribe(() => undefined);
		try {
			// Initial push-on-subscribe wave from BOTH cached state nodes
			// fires fn exactly once (combined activation; R2.7.3 + R2.7.0).
			expect(fired).toHaveLength(1);
			fired.length = 0;
			// INVALIDATE `b` — clears its prevData and dataBatch. Without
			// R2.7.3, the gate would re-arm and the next DATA on `a` would be
			// held until `b` re-settles. R2.7.3 says: once fn has fired
			// (`_hasCalledFnOnce`), the gate does NOT re-engage. (QA F6:
			// tightened from `>= 1` to exact-1 to catch any double-fire
			// regression — e.g., a future change that re-fires fn on the
			// INVALIDATE wave plus the DATA wave.)
			b.down([[INVALIDATE]]);
			a.emit(7);
			// fn re-runs on `a`'s DATA wave; gate is NOT holding it. Expect
			// EXACTLY ONE re-fire from `a.emit(7)`.
			expect(fired).toHaveLength(1);
			const last = fired[0];
			// data[0] = [7] → currentOf yields 7 (a delivered DATA this wave).
			expect(last?.[0]).toBe(7);
			// b slot: data[1] = undefined (not involved), ctx.prevData[1] =
			// undefined (cleared by INVALIDATE). Both are SENTINEL — fn fired
			// because the gate is one-shot, not because b re-settled.
			expect(last?.[1]).toBeUndefined();
		} finally {
			unsub();
		}
	});
});
