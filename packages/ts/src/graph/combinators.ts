/**
 * Multi-source combinators + notifier-driven operators (CSP-2.7 catalog re-derive, D40 / D45).
 *
 * Per-language sugar (D6/D24, never in parity). Each forms topology ONLY via DECLARED deps (D45) —
 * the frozen pure-ts reference (D41) builds these as a producer that calls `subscribeOr` on each
 * source INSIDE the fn body, which is the D45-banned describe island (an edge `describe` cannot
 * show). Re-derived here as static-dep nodes with `partial:true` (fire on any dep, R-first-run-gate
 * off) + `ctx.state` (queue / phase / winner) — so every edge is a real subscription `describe`
 * shows truthfully (D3 / R-edges-derived). Multi-source completion / error reads
 * `ctx.depRecords[i].terminal` (R-deps-terminal) via `completeWhenDepsComplete:false +
 * terminalAsRealInput:true`.
 *
 * Under D49 (no equals-absorption) `combine` emits a fresh tuple on EVERY contributing wave (no
 * substrate tuple-dedup; the pure-ts `equals` tuple comparator is gone) — pair with
 * `distinctUntilChanged` for opt-in dedup. SENTINEL ("a dep has never delivered DATA") is detected
 * via `rec.latest === undefined` (R-sentinel: `undefined` is the global sentinel, `null` is a valid
 * value).
 *
 * NOT re-derived in this cut (flagged): the window family (`window`/`windowCount`/`windowTime`)
 * emits `Node<Node<T>>` nested sub-streams — the frozen reference creates child nodes inside the fn
 * body and pushes DATA into them imperatively, which is a describe island AND an open question for
 * how an emitted live sub-stream appears in `describe` (D45/D51). Deferred to a design pass.
 */

import type { Ctx } from "../ctx/types.js";
import type { Operator } from "./operators.js";

/**
 * combine (alias `combineLatest`): emit a tuple of every dep's latest value whenever ANY dep
 * delivers, once ALL deps have delivered at least one value. `partial:true`; the all-delivered gate
 * is `rec.latest !== undefined` per dep. Completes when ALL deps complete (default
 * completeWhenDepsComplete); any dep ERROR propagates (default errorWhenDepsError). Emits a fresh
 * tuple per wave (D49 — no dedup; compose `distinctUntilChanged` to suppress unchanged tuples).
 */
export function combine<T extends readonly unknown[]>(): Operator<unknown, T> {
	return {
		factory: "combine",
		opts: { partial: true },
		body: (ctx) => {
			const vals = ctx.depRecords.map((r) => r.latest);
			if (vals.some((v) => v === undefined)) return; // not all deps delivered → undirty RESOLVED
			ctx.down([["DATA", vals as unknown as T]]);
		},
	};
}

/** combineLatest: RxJS-named alias of {@link combine}. */
export const combineLatest = combine;

/**
 * withLatestFrom: on each PRIMARY (dep 0) value, emit `[primary, latestSecondary]`; a secondary-only
 * (dep 1) wave updates the cached secondary but emits nothing. Uses the DEFAULT first-run gate
 * (`partial:false`), NOT partial — the frozen reference's Phase 10.5 W1 fix: with `partial:true` the
 * primary's push-on-subscribe fires the fn BEFORE the secondary has delivered, so the initial pair
 * is dropped. The gate holds the first run until BOTH deps settle, then fires once with both
 * populated; subsequent waves are gate-free and fire on primary-alone. Completes when the PRIMARY
 * completes (not the secondary) — `completeWhenDepsComplete:false + terminalAsRealInput:true` with a
 * primary-terminal check; a secondary terminal is ignored (its last value persists).
 */
export function withLatestFrom<A, B>(): Operator<unknown, readonly [A, B]> {
	return {
		factory: "withLatestFrom",
		opts: { completeWhenDepsComplete: false, terminalAsRealInput: true },
		body: (ctx) => {
			const primary = ctx.depRecords[0];
			const secondary = ctx.depRecords[1];
			if (primary.terminal === true) {
				ctx.down([["COMPLETE"]]);
				return;
			}
			const b0 = primary.batch;
			if (!b0 || b0.length === 0) return; // secondary-only wave → quiet
			const sec = secondary.latest as B | undefined;
			if (sec === undefined) return; // secondary never delivered → quiet
			for (const v of b0) ctx.down([["DATA", [v, sec] as readonly [A, B]]]);
		},
	};
}

/** Internal: per-dep FIFO queues for {@link zip}. */
interface ZipState {
	queues: unknown[][];
}

/**
 * zip: combine one value from EACH dep, in lockstep, into a tuple — buffering per-dep queues until
 * every dep has at least one queued value, then shifting one from each. `partial:true` +
 * `ctx.state` queues. Completes as soon as ANY dep is terminal AND its queue is empty (no further
 * tuple can form) — `completeWhenDepsComplete:false + terminalAsRealInput:true`. Any dep ERROR
 * propagates (default errorWhenDepsError).
 */
export function zip<T extends readonly unknown[]>(): Operator<unknown, T> {
	return {
		factory: "zip",
		opts: { partial: true, completeWhenDepsComplete: false, terminalAsRealInput: true },
		body: (ctx) => {
			const n = ctx.depRecords.length;
			const st = ctx.state.get<ZipState>() ?? { queues: Array.from({ length: n }, () => []) };
			for (let i = 0; i < n; i++) {
				const b = ctx.depRecords[i].batch;
				if (b) for (const v of b) st.queues[i].push(v);
			}
			while (st.queues.every((q) => q.length > 0)) {
				ctx.down([["DATA", st.queues.map((q) => q.shift()) as unknown as T]]);
			}
			ctx.state.set(st);
			// A terminal dep whose queue is now drained can never contribute another tuple → COMPLETE.
			for (let i = 0; i < n; i++) {
				if (ctx.depRecords[i].terminal === true && st.queues[i].length === 0) {
					ctx.down([["COMPLETE"]]);
					return;
				}
			}
		},
	};
}

/** Internal: phase + buffered second-source values for {@link concat}. */
interface ConcatState<S> {
	phase: 0 | 1;
	pending: S[];
	secondDone: boolean;
}

/**
 * concat: play ALL of dep 0, then ALL of dep 1. Dep-1 DATA arriving during phase 0 is buffered and
 * flushed at the handoff (dep 0 COMPLETE). `partial:true` + `ctx.state` phase. Completes when dep 1
 * completes (or when dep 0 completes and dep 1 already had). `completeWhenDepsComplete:false +
 * terminalAsRealInput:true`; any dep ERROR propagates (default errorWhenDepsError).
 */
export function concat<S>(): Operator<S, S> {
	return {
		factory: "concat",
		opts: { partial: true, completeWhenDepsComplete: false, terminalAsRealInput: true },
		body: (ctx) => {
			const first = ctx.depRecords[0];
			const second = ctx.depRecords[1];
			const st: ConcatState<S> = ctx.state.get<ConcatState<S>>() ?? {
				phase: 0,
				pending: [],
				secondDone: false,
			};
			if (st.phase === 0) {
				if (first.batch) for (const v of first.batch) ctx.down([["DATA", v]]);
				if (second.batch) for (const v of second.batch) st.pending.push(v as S);
				if (second.terminal === true) st.secondDone = true;
				if (first.terminal === true) {
					st.phase = 1;
					for (const v of st.pending) ctx.down([["DATA", v]]);
					st.pending = [];
					if (st.secondDone) ctx.down([["COMPLETE"]]);
				}
			} else {
				if (second.batch) for (const v of second.batch) ctx.down([["DATA", v]]);
				if (second.terminal === true) ctx.down([["COMPLETE"]]);
			}
			ctx.state.set(st);
		},
	};
}

/** Internal: which dep won the {@link race} (null until the first DATA). */
interface RaceState {
	winner: number | null;
}

/**
 * race: the FIRST dep to deliver DATA wins; thereafter only the winner's messages flow (losers are
 * dropped, including their terminals). `partial:true` + `ctx.state` winner. `errorWhenDepsError:false`
 * (a LOSER's error must not error the race — only the winner's) + `completeWhenDepsComplete:false +
 * terminalAsRealInput:true`. If every dep terminates before any DATA, COMPLETE.
 */
export function race<S>(): Operator<S, S> {
	return {
		factory: "race",
		opts: {
			partial: true,
			errorWhenDepsError: false,
			completeWhenDepsComplete: false,
			terminalAsRealInput: true,
		},
		body: (ctx) => {
			const n = ctx.depRecords.length;
			const st: RaceState = ctx.state.get<RaceState>() ?? { winner: null };
			if (st.winner === null) {
				// Find the first dep that delivered DATA this wave → it wins.
				for (let i = 0; i < n; i++) {
					const b = ctx.depRecords[i].batch;
					if (b && b.length > 0) {
						st.winner = i;
						for (const v of b) ctx.down([["DATA", v]]);
						break;
					}
				}
				if (st.winner === null) {
					// No winner yet — if EVERY dep is terminal (none ever delivered DATA), COMPLETE.
					// Recompute from the (sticky, terminal-is-forever) flags each wave — NEVER
					// accumulate a counter, or a dep that terminated in an earlier wave is re-counted
					// every subsequent wave (premature COMPLETE while a later dep is still live, n>=3).
					if (ctx.depRecords.every((r) => r.terminal !== undefined)) {
						ctx.state.set(st);
						ctx.down([["COMPLETE"]]);
						return;
					}
				}
			} else {
				const w = ctx.depRecords[st.winner];
				if (w.batch) for (const v of w.batch) ctx.down([["DATA", v]]);
				if (w.terminal === true) {
					ctx.state.set(st);
					ctx.down([["COMPLETE"]]);
					return;
				}
				if (w.terminal !== undefined) {
					ctx.state.set(st);
					ctx.down([["ERROR", w.terminal]]);
					return;
				}
			}
			ctx.state.set(st);
		},
	};
}

// ── notifier-driven (D46 first-cut: gated on a reactive notifier dep, no wall-clock) ──

/**
 * buffer: accumulate dep 0 (source) DATA; flush the buffer as an array each time dep 1 (notifier)
 * delivers DATA. `partial:true` + `ctx.state` buffer. On source COMPLETE, flush any remainder then
 * COMPLETE (`completeWhenDepsComplete:false + terminalAsRealInput:true`; a notifier terminal is
 * ignored). Source/notifier ERROR propagates (default errorWhenDepsError).
 */
export function buffer<S>(): Operator<unknown, S[]> {
	return {
		factory: "buffer",
		opts: { partial: true, completeWhenDepsComplete: false, terminalAsRealInput: true },
		body: (ctx) => {
			const source = ctx.depRecords[0];
			const notifier = ctx.depRecords[1];
			const buf = ctx.state.get<S[]>() ?? [];
			if (source.batch) for (const v of source.batch) buf.push(v as S);
			if (source.terminal === true) {
				if (buf.length > 0) ctx.down([["DATA", [...buf]]]);
				ctx.state.set([]);
				ctx.down([["COMPLETE"]]);
				return;
			}
			if (notifier.batch && notifier.batch.length > 0) {
				ctx.down([["DATA", [...buf]]]); // flush (may be empty) on each notifier signal
				ctx.state.set([]);
				return;
			}
			ctx.state.set(buf);
		},
	};
}

/**
 * bufferCount: batch consecutive source DATA into arrays of length `count`; the remainder flushes on
 * source COMPLETE. Single dep + `ctx.state` buffer + `completeWhenDepsComplete:false +
 * terminalAsRealInput:true`.
 */
export function bufferCount<S>(count: number): Operator<S, S[]> {
	if (!Number.isInteger(count) || count < 1) {
		throw new RangeError(`bufferCount: count must be a positive integer (got ${count})`);
	}
	return {
		factory: "bufferCount",
		opts: { completeWhenDepsComplete: false, terminalAsRealInput: true },
		body: (ctx) => {
			const r = ctx.depRecords[0];
			const buf = ctx.state.get<S[]>() ?? [];
			if (r.batch) {
				for (const v of r.batch) {
					buf.push(v as S);
					if (buf.length >= count) ctx.down([["DATA", buf.splice(0, buf.length)]]);
				}
			}
			if (r.terminal === true) {
				if (buf.length > 0) ctx.down([["DATA", [...buf]]]);
				ctx.state.set([]);
				ctx.down([["COMPLETE"]]);
				return;
			}
			ctx.state.set(buf);
		},
	};
}

/** Internal: latest sampled source value + whether the source has completed, for {@link sample}. */
interface SampleState<S> {
	last: { v: S } | undefined;
	sourceDone: boolean;
}

/**
 * sample: emit the source's (dep 0) most recent value each time the notifier (dep 1) delivers DATA.
 * `partial:true` + `ctx.state`. The notifier completing completes the operator; the source completing
 * stops sampling (clears the held value); an ERROR from either terminates.
 * `completeWhenDepsComplete:false + errorWhenDepsError:false + terminalAsRealInput:true` (manual
 * terminal handling). No flush of the held value on source COMPLETE (RxJS sample semantics).
 */
export function sample<S>(): Operator<unknown, S> {
	return {
		factory: "sample",
		opts: {
			partial: true,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			terminalAsRealInput: true,
		},
		body: (ctx) => {
			const source = ctx.depRecords[0];
			const notifier = ctx.depRecords[1];
			const st: SampleState<S> = ctx.state.get<SampleState<S>>() ?? {
				last: undefined,
				sourceDone: false,
			};
			// ERROR from either dep → terminate.
			if (source.terminal !== undefined && source.terminal !== true) {
				ctx.down([["ERROR", source.terminal]]);
				return;
			}
			if (notifier.terminal !== undefined && notifier.terminal !== true) {
				ctx.down([["ERROR", notifier.terminal]]);
				return;
			}
			if (source.batch) for (const v of source.batch) st.last = { v: v as S };
			if (source.terminal === true) {
				st.sourceDone = true;
				st.last = undefined;
			}
			if (notifier.terminal === true) {
				ctx.state.set(st);
				ctx.down([["COMPLETE"]]);
				return;
			}
			if (notifier.batch && notifier.batch.length > 0 && st.last !== undefined && !st.sourceDone) {
				ctx.down([["DATA", st.last.v]]);
			}
			ctx.state.set(st);
		},
	};
}

/**
 * takeUntil: forward dep 0 (source) DATA until dep 1 (notifier) delivers its first DATA, then
 * COMPLETE. `partial:true` + `completeWhenDepsComplete:false + terminalAsRealInput:true`: a source
 * COMPLETE forwards COMPLETE; a notifier DATA triggers COMPLETE. Source/notifier ERROR propagates
 * (default errorWhenDepsError).
 */
export function takeUntil<S>(): Operator<unknown, S> {
	return {
		factory: "takeUntil",
		opts: { partial: true, completeWhenDepsComplete: false, terminalAsRealInput: true },
		body: (ctx: Ctx) => {
			const source = ctx.depRecords[0];
			const notifier = ctx.depRecords[1];
			if (notifier.batch && notifier.batch.length > 0) {
				ctx.down([["COMPLETE"]]); // notifier fired → stop
				return;
			}
			if (source.batch) for (const v of source.batch) ctx.down([["DATA", v]]);
			if (source.terminal === true) ctx.down([["COMPLETE"]]);
		},
	};
}
