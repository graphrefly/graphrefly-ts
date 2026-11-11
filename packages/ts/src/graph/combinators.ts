/**
 * Multi-source combinators + notifier-driven operators (CSP-2.7 catalog re-derive, D40 / D45).
 *
 * Per-language sugar (D6/D24, never in parity). Each forms topology ONLY via DECLARED deps (D45) —
 * the frozen pure-ts reference (D41) builds these as a producer that calls `subscribeOr` on each
 * source INSIDE the fn body, which is the D45-banned describe island (an edge `describe` cannot
 * show). Re-derived here as static-dep nodes with `partial:true` (fire on any dep, R-first-run-gate
 * off) + `ctx.state` (queue / phase / winner) — so every edge is a real subscription `describe`
 * shows truthfully (D3 / R-edges-derived). Multi-source completion / error reads
 * `depTerminal(ctx, i)` (R-deps-terminal) via the manual COMPLETE policy.
 *
 * Under D49 (no equals-absorption) `combine` emits a fresh tuple on EVERY contributing wave (no
 * substrate tuple-dedup; the pure-ts `equals` tuple comparator is gone) — pair with
 * `distinctUntilChanged` for opt-in dedup. SENTINEL ("a dep has never delivered DATA") is detected
 * via `depLatest(ctx, i) === undefined` (R-sentinel: `undefined` is the global sentinel, `null` is a valid
 * value).
 *
 * NOT re-derived in this cut (flagged): the window family (`window`/`windowCount`/`windowTime`)
 * emits `Node<Node<T>>` nested sub-streams — the frozen reference creates child nodes inside the fn
 * body and pushes DATA into them imperatively, which is a describe island AND an open question for
 * how an emitted live sub-stream appears in `describe` (D45/D51). Deferred to a design pass.
 */

import {
	type Ctx,
	depBatch,
	depCount,
	depLatest,
	depTerminal,
	isTerminalComplete,
	isTerminalError,
	isTerminalNone,
	terminalErrorValue,
} from "../ctx/types.js";
import type { Operator } from "./operators.js";

/**
 * combine (alias `combineLatest`): emit a tuple of every dep's latest value whenever ANY dep
 * delivers, once ALL deps have delivered at least one value. `partial:true`; the all-delivered gate
 * is `depLatest(ctx, i) !== undefined` per dep. Completes when ALL deps complete (default
 * the auto COMPLETE policy); any dep ERROR propagates (the auto ERROR policy). Emits a fresh
 * tuple per wave (D49 — no dedup; compose `distinctUntilChanged` to suppress unchanged tuples).
 * @returns A `Operator<unknown, T>` value.
 * @category operators
 * @example
 * ```ts
 * import { combine } from "@graphrefly/ts/operators";
 * ```
 */
export function combine<T extends readonly unknown[]>(): Operator<unknown, T> {
	return {
		factory: "combine",
		opts: { partial: true },
		body: (ctx) => {
			const vals = Array.from({ length: depCount(ctx) }, (_, i) => depLatest(ctx, i));
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
 * completes (not the secondary) — the manual COMPLETE policy with a
 * primary-terminal check; a secondary terminal is ignored (its last value persists).
 * @returns A `Operator<unknown, readonly [A, B]>` value.
 * @category operators
 * @example
 * ```ts
 * import { withLatestFrom } from "@graphrefly/ts/operators";
 * ```
 */
export function withLatestFrom<A, B>(): Operator<unknown, readonly [A, B]> {
	return {
		factory: "withLatestFrom",
		opts: { complete: "manual" },
		body: (ctx) => {
			const b0 = depBatch(ctx, 0);
			const sec = depLatest(ctx, 1) as B | undefined;
			// Primary values first (a secondary-only wave, or no secondary yet, sends nothing), then the
			// primary's COMPLETE when it came in the same array.
			if (b0 && sec !== undefined)
				for (const v of b0) ctx.down([["DATA", [v, sec] as readonly [A, B]]]);
			if (isTerminalComplete(depTerminal(ctx, 0))) ctx.down([["COMPLETE"]]);
		},
	};
}

/** Internal: per-dep FIFO queues for {@link zip}. */
interface ZipState {
	queues: unknown[][];
	terminal: boolean[];
}

/**
 * zip: combine one value from EACH dep, in lockstep, into a tuple — buffering per-dep queues until
 * every dep has at least one queued value, then shifting one from each. `partial:true` +
 * `ctx.state` queues. Completes as soon as ANY dep is terminal AND its queue is empty (no further
 * tuple can form) — the manual COMPLETE policy. Any dep ERROR
 * propagates (the auto ERROR policy).
 * @returns A `Operator<unknown, T>` value.
 * @category operators
 * @example
 * ```ts
 * import { zip } from "@graphrefly/ts/operators";
 * ```
 */
export function zip<T extends readonly unknown[]>(): Operator<unknown, T> {
	return {
		factory: "zip",
		opts: { partial: true, complete: "manual" },
		body: (ctx) => {
			const n = depCount(ctx);
			if (n === 0) {
				ctx.down([["COMPLETE"]]);
				return;
			}
			const st = ctx.state.get<ZipState>() ?? {
				queues: Array.from({ length: n }, () => [] as unknown[]),
				terminal: new Array(n).fill(false),
			};
			for (let i = 0; i < n; i++) {
				const b = depBatch(ctx, i);
				if (b) for (const v of b) st.queues[i].push(v);
				if (isTerminalComplete(depTerminal(ctx, i))) st.terminal[i] = true;
			}
			while (st.queues.every((q) => q.length > 0)) {
				ctx.down([["DATA", st.queues.map((q) => q.shift()) as unknown as T]]);
			}
			ctx.state.set(st);
			// A terminal dep whose queue is now drained can never contribute another tuple → COMPLETE.
			for (let i = 0; i < n; i++) {
				if (st.terminal[i] && st.queues[i].length === 0) {
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
 * completes (or when dep 0 completes and dep 1 already had). the manual COMPLETE policy; any dep ERROR propagates (the auto ERROR policy).
 * @returns A `Operator<S, S>` value.
 * @category operators
 * @example
 * ```ts
 * import { concat } from "@graphrefly/ts/operators";
 * ```
 */
export function concat<S>(): Operator<S, S> {
	return {
		factory: "concat",
		opts: { partial: true, complete: "manual" },
		body: (ctx) => {
			const firstBatch = depBatch(ctx, 0);
			const secondBatch = depBatch(ctx, 1);
			const firstTerminal = depTerminal(ctx, 0);
			const secondTerminal = depTerminal(ctx, 1);
			const st: ConcatState<S> = ctx.state.get<ConcatState<S>>() ?? {
				phase: 0,
				pending: [],
				secondDone: false,
			};
			if (st.phase === 0) {
				if (firstBatch) for (const v of firstBatch) ctx.down([["DATA", v]]);
				if (secondBatch) for (const v of secondBatch) st.pending.push(v as S);
				if (isTerminalComplete(secondTerminal)) st.secondDone = true;
				if (isTerminalComplete(firstTerminal)) {
					st.phase = 1;
					for (const v of st.pending) ctx.down([["DATA", v]]);
					st.pending = [];
					if (st.secondDone) ctx.down([["COMPLETE"]]);
				}
			} else {
				if (secondBatch) for (const v of secondBatch) ctx.down([["DATA", v]]);
				if (isTerminalComplete(secondTerminal)) ctx.down([["COMPLETE"]]);
			}
			ctx.state.set(st);
		},
	};
}

/** Internal: which dep won the {@link race} (null until the first DATA). */
interface RaceState {
	winner: number | null;
	terminals: unknown[];
}

/**
 * race: the FIRST dep to deliver DATA wins; thereafter only the winner's messages flow (losers are
 * dropped, including their terminals). `partial:true` + `ctx.state` winner. the manual ERROR policy
 * (a LOSER's error must not error the race — only the winner's) + the manual COMPLETE policy. If every dep terminates before any DATA, COMPLETE.
 * @returns A `Operator<S, S>` value.
 * @category operators
 * @example
 * ```ts
 * import { race } from "@graphrefly/ts/operators";
 * ```
 */
export function race<S>(): Operator<S, S> {
	return {
		factory: "race",
		opts: {
			partial: true,
			complete: "manual",
			error: "manual",
		},
		body: (ctx) => {
			const n = depCount(ctx);
			const st: RaceState = ctx.state.get<RaceState>() ?? {
				winner: null,
				terminals: new Array(n).fill(false),
			};
			for (let i = 0; i < n; i++) {
				const terminal = depTerminal(ctx, i);
				if (!isTerminalNone(terminal)) st.terminals[i] = terminal;
			}
			if (st.winner === null) {
				// Find the first dep that delivered DATA this wave → it wins.
				for (let i = 0; i < n; i++) {
					const b = depBatch(ctx, i);
					if (b && b.length > 0) {
						st.winner = i;
						break;
					}
				}
				// No winner yet — if EVERY dep is terminal (none ever delivered DATA), COMPLETE.
				if (st.winner === null && st.terminals.every((t) => !isTerminalNone(t))) {
					ctx.state.set(st);
					ctx.down([["COMPLETE"]]);
					return;
				}
			}
			ctx.state.set(st);
			if (st.winner === null) return;
			// The winner's values, then its terminal when it came in the same array (also in the
			// wave that picked it).
			const b = depBatch(ctx, st.winner);
			const terminal = depTerminal(ctx, st.winner);
			if (b) for (const v of b) ctx.down([["DATA", v]]);
			if (isTerminalComplete(terminal)) ctx.down([["COMPLETE"]]);
			else if (isTerminalError(terminal)) ctx.down([["ERROR", terminalErrorValue(terminal)]]);
		},
	};
}

// ── notifier-driven (D46 first-cut: gated on a reactive notifier dep, no wall-clock) ──

/**
 * buffer: accumulate dep 0 (source) DATA; flush the buffer as an array each time dep 1 (notifier)
 * delivers DATA. `partial:true` + `ctx.state` buffer. On source COMPLETE, flush any remainder then
 * COMPLETE (the manual COMPLETE policy; a notifier terminal is
 * ignored). Source/notifier ERROR propagates (the auto ERROR policy).
 * @returns A `Operator<unknown, S[]>` value.
 * @category operators
 * @example
 * ```ts
 * import { buffer } from "@graphrefly/ts/operators";
 * ```
 */
export function buffer<S>(): Operator<unknown, S[]> {
	return {
		factory: "buffer",
		opts: { partial: true, complete: "manual" },
		body: (ctx) => {
			const sourceBatch = depBatch(ctx, 0);
			const notifierBatch = depBatch(ctx, 1);
			const buf = ctx.state.get<S[]>() ?? [];
			if (sourceBatch) for (const v of sourceBatch) buf.push(v as S);
			if (isTerminalComplete(depTerminal(ctx, 0))) {
				if (buf.length > 0) ctx.down([["DATA", [...buf]]]);
				ctx.state.set([]);
				ctx.down([["COMPLETE"]]);
				return;
			}
			if (notifierBatch && notifierBatch.length > 0) {
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
 * source COMPLETE. Single dep + `ctx.state` buffer + the manual COMPLETE policy.
 * @param count - count value used by the helper.
 * @returns A `Operator<S, S[]>` value.
 * @category operators
 * @example
 * ```ts
 * import { bufferCount } from "@graphrefly/ts/operators";
 * ```
 */
export function bufferCount<S>(count: number): Operator<S, S[]> {
	if (!Number.isInteger(count) || count < 1) {
		throw new RangeError(`bufferCount: count must be a positive integer (got ${count})`);
	}
	return {
		factory: "bufferCount",
		opts: { complete: "manual" },
		body: (ctx) => {
			const b = depBatch(ctx, 0);
			const buf = ctx.state.get<S[]>() ?? [];
			if (b) {
				for (const v of b) {
					buf.push(v as S);
					if (buf.length >= count) ctx.down([["DATA", buf.splice(0, buf.length)]]);
				}
			}
			if (isTerminalComplete(depTerminal(ctx, 0))) {
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
 * the manual COMPLETE and ERROR policies (manual
 * terminal handling). No flush of the held value on source COMPLETE (RxJS sample semantics).
 * @returns A `Operator<unknown, S>` value.
 * @category operators
 * @example
 * ```ts
 * import { sample } from "@graphrefly/ts/operators";
 * ```
 */
export function sample<S>(): Operator<unknown, S> {
	return {
		factory: "sample",
		opts: {
			partial: true,
			complete: "manual",
			error: "manual",
		},
		body: (ctx) => {
			const sourceBatch = depBatch(ctx, 0);
			const notifierBatch = depBatch(ctx, 1);
			const sourceTerminal = depTerminal(ctx, 0);
			const notifierTerminal = depTerminal(ctx, 1);
			const st: SampleState<S> = ctx.state.get<SampleState<S>>() ?? {
				last: undefined,
				sourceDone: false,
			};
			// ERROR from either dep → terminate.
			if (isTerminalError(sourceTerminal)) {
				ctx.down([["ERROR", terminalErrorValue(sourceTerminal)]]);
				return;
			}
			if (isTerminalError(notifierTerminal)) {
				ctx.down([["ERROR", terminalErrorValue(notifierTerminal)]]);
				return;
			}
			if (sourceBatch) for (const v of sourceBatch) st.last = { v: v as S };
			if (isTerminalComplete(sourceTerminal)) {
				st.sourceDone = true;
				st.last = undefined;
			}
			if (isTerminalComplete(notifierTerminal)) {
				ctx.state.set(st);
				ctx.down([["COMPLETE"]]);
				return;
			}
			if (notifierBatch && notifierBatch.length > 0 && st.last !== undefined && !st.sourceDone) {
				ctx.down([["DATA", st.last.v]]);
			}
			ctx.state.set(st);
		},
	};
}

/**
 * takeUntil: forward dep 0 (source) DATA until dep 1 (notifier) delivers its first DATA, then
 * COMPLETE. `partial:true` + the manual COMPLETE policy: a source
 * COMPLETE forwards COMPLETE; a notifier DATA triggers COMPLETE. Source/notifier ERROR propagates
 * (the auto ERROR policy).
 * @returns A `Operator<unknown, S>` value.
 * @category operators
 * @example
 * ```ts
 * import { takeUntil } from "@graphrefly/ts/operators";
 * ```
 */
export function takeUntil<S>(): Operator<unknown, S> {
	return {
		factory: "takeUntil",
		opts: { partial: true, complete: "manual" },
		body: (ctx: Ctx) => {
			const sourceBatch = depBatch(ctx, 0);
			const notifierBatch = depBatch(ctx, 1);
			if (notifierBatch && notifierBatch.length > 0) {
				ctx.down([["COMPLETE"]]); // notifier fired → stop
				return;
			}
			if (sourceBatch) for (const v of sourceBatch) ctx.down([["DATA", v]]);
			if (isTerminalComplete(depTerminal(ctx, 0))) ctx.down([["COMPLETE"]]);
		},
	};
}
