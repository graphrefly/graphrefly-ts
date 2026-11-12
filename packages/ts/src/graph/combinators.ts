/**
 * Multi-source combinators + notifier-driven operators (CSP-2.7 catalog re-derive, D40 / D45).
 *
 * Per-language sugar (D6/D24, never in parity). Each forms topology ONLY via DECLARED deps (D45) —
 * the frozen pure-ts reference (D41) builds these as a producer that calls `subscribeOr` on each
 * source INSIDE the fn body, which is the D45-banned describe island (an edge `describe` cannot
 * show). Re-derived here as static-dep kernel nodes, which run on any dependency (graphrefly-ts:D184),
 * with `ctx.state` (queue / phase / winner) — so every edge is a real subscription `describe`
 * shows truthfully (D3 / R-edges-derived). Multi-source completion / error reads
 * `ctx.deps[i].terminal` (R-terminals) via the manual COMPLETE policy.
 *
 * Under D49 (no equals-absorption) `combine` emits a fresh tuple on EVERY contributing wave (no
 * substrate tuple-dedup; the pure-ts `equals` tuple comparator is gone) — pair with
 * `distinctUntilChanged` for opt-in dedup. SENTINEL ("a dep has never delivered DATA") is detected
 * via `ctx.deps[i].value === undefined` (R-sentinel: `undefined` is the global sentinel, `null` is a valid
 * value).
 *
 * NOT re-derived in this cut (flagged): the window family (`window`/`windowCount`/`windowTime`)
 * emits `Node<Node<T>>` nested sub-streams — the frozen reference creates child nodes inside the fn
 * body and pushes DATA into them imperatively, which is a describe island AND an open question for
 * how an emitted live sub-stream appears in `describe` (D45/D51). Deferred to a design pass.
 */

import type { Ctx, DepTerminal } from "../ctx/types.js";
import type { Message } from "../protocol/messages.js";
import { toCheckpointJson } from "./checkpoint.js";
import { eachInputArray } from "./each-input-array.js";
import type { Operator } from "./operators.js";

/**
 * combine: emit a tuple of every dep's latest value whenever ANY dep
 * delivers, once ALL deps have delivered at least one value. the all-delivered gate
 * is `ctx.deps[i].value !== undefined` per dep. Completes when ALL deps complete (default
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
		recipe: { ref: "combine" },
		opts: {},
		body: (ctx) => {
			const vals = Array.from({ length: ctx.deps.length }, (_, i) => ctx.deps[i].value);
			if (vals.some((v) => v === undefined)) return; // not all deps delivered → undirty RESOLVED
			ctx.down([["DATA", vals as unknown as T]]);
		},
	};
}

/**
 * withLatestFrom: on each PRIMARY (dep 0) value, emit `[primary, latestSecondary]`; a secondary-only
 * (dep 1) wave updates the cached secondary but emits nothing. Primary values that arrive before the
 * secondary has any value are held in private state and paired once it arrives, in one array (the
 * frozen reference's Phase 10.5 W1 fix: the primary's push-on-subscribe must not be dropped). The
 * kernel has no first-run gate (graphrefly-ts:D184), so this hold is the operator's own. Completes
 * when the PRIMARY completes (not the secondary) — the manual COMPLETE policy with a primary-terminal
 * check; a secondary terminal is ignored (its last value persists).
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
		recipe: { ref: "withLatestFrom" },
		opts: { complete: "manual" },
		body: (ctx) => {
			const sec = ctx.deps[1]?.value as B | undefined;
			if (sec === undefined) {
				// No secondary yet: hold this run's primary values until it arrives.
				const held = ctx.state.get<A[]>() ?? [];
				for (const v of ctx.deps[0].waves.flat()) held.push(v as A);
				ctx.state.set(held);
			} else {
				const held = ctx.state.get<A[]>();
				if (held !== undefined && held.length > 0) {
					ctx.state.set([]);
					ctx.down(held.map((v) => ["DATA", [v, sec] as readonly [A, B]]));
				}
				// Primary values, one array per primary array, then the primary's COMPLETE when it came
				// in the same array.
				eachInputArray(ctx, 0, (v, out) => {
					out.push(["DATA", [v, sec] as readonly [A, B]]);
				});
			}
			if (ctx.deps[0].terminal?.kind === "complete") ctx.down([["COMPLETE"]]);
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
 * every dep has at least one queued value, then shifting one from each, in `ctx.state`
 * queues. Completes as soon as ANY dep is terminal AND its queue is empty (no further
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
		recipe: { ref: "zip" },
		opts: { complete: "manual" },
		body: (ctx) => {
			const n = ctx.deps.length;
			if (n === 0) {
				ctx.down([["COMPLETE"]]);
				return;
			}
			const st = ctx.state.get<ZipState>() ?? {
				queues: Array.from({ length: n }, () => [] as unknown[]),
				terminal: new Array(n).fill(false),
			};
			for (let i = 0; i < n; i++) {
				const b = ctx.deps[i].waves.length === 0 ? null : ctx.deps[i].waves.flat();
				if (b) for (const v of b) st.queues[i].push(v);
				if (ctx.deps[i].terminal?.kind === "complete") st.terminal[i] = true;
			}
			// The tuples a run forms go out as one array, with COMPLETE last if a dep is drained.
			const out: Message[] = [];
			while (st.queues.every((q) => q.length > 0)) {
				out.push(["DATA", st.queues.map((q) => q.shift()) as unknown as T]);
			}
			ctx.state.set(st);
			// A terminal dep whose queue is now drained can never contribute another tuple → COMPLETE.
			if (st.terminal.some((ended, i) => ended && st.queues[i].length === 0))
				out.push(["COMPLETE"]);
			ctx.down(out);
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
 * flushed at the handoff (dep 0 COMPLETE). `ctx.state` phase. Completes when dep 1
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
		recipe: { ref: "concat" },
		opts: { complete: "manual" },
		body: (ctx) => {
			const firstBatch = ctx.deps[0].waves.length === 0 ? null : ctx.deps[0].waves.flat();
			const secondBatch =
				(ctx.deps[1]?.waves ?? []).length === 0 ? null : (ctx.deps[1]?.waves.flat() ?? []);
			const firstTerminal = ctx.deps[0].terminal;
			const secondTerminal = ctx.deps[1]?.terminal;
			const st: ConcatState<S> = ctx.state.get<ConcatState<S>>() ?? {
				phase: 0,
				pending: [],
				secondDone: false,
			};
			// What a run plays goes out as one array, with COMPLETE last when the second dep is done.
			const out: Message[] = [];
			const play = (values: readonly unknown[] | null) => {
				if (values) for (const v of values) out.push(["DATA", v]);
			};
			if (st.phase === 0) {
				play(firstBatch);
				if (secondBatch) for (const v of secondBatch) st.pending.push(v as S);
				if (secondTerminal?.kind === "complete") st.secondDone = true;
				if (firstTerminal?.kind === "complete") {
					st.phase = 1;
					play(st.pending);
					st.pending = [];
					if (st.secondDone) out.push(["COMPLETE"]);
				}
			} else {
				play(secondBatch);
				if (secondTerminal?.kind === "complete") out.push(["COMPLETE"]);
			}
			ctx.state.set(st);
			ctx.down(out);
		},
	};
}

/** Internal: which dep won the {@link race} (null until the first DATA). */
interface RaceState {
	winner: number | null;
	terminals: (DepTerminal | null)[];
}

/**
 * race: the FIRST dep to deliver DATA wins; thereafter only the winner's messages flow (losers are
 * dropped, including their terminals). `ctx.state` winner. the manual ERROR policy
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
			complete: "manual",
			error: "manual",
		},
		body: (ctx) => {
			const n = ctx.deps.length;
			const st: RaceState = ctx.state.get<RaceState>() ?? {
				winner: null,
				terminals: new Array(n).fill(null),
			};
			for (let i = 0; i < n; i++) {
				const terminal = ctx.deps[i].terminal;
				if (terminal !== undefined) st.terminals[i] = terminal;
			}
			if (st.winner === null) {
				// Find the first dep that delivered DATA this wave → it wins.
				for (let i = 0; i < n; i++) {
					const b = ctx.deps[i].waves.length === 0 ? null : ctx.deps[i].waves.flat();
					if (b && b.length > 0) {
						st.winner = i;
						break;
					}
				}
				// No winner yet — if EVERY dep is terminal (none ever delivered DATA), COMPLETE.
				if (st.winner === null && st.terminals.every((t) => t !== null)) {
					ctx.state.set(st);
					ctx.down([["COMPLETE"]]);
					return;
				}
			}
			ctx.state.set(st);
			if (st.winner === null) return;
			// The winner's values, then its terminal when it came in the same array (also in the
			// wave that picked it).
			const terminal = ctx.deps[st.winner]?.terminal;
			eachInputArray(ctx, st.winner, (v, out) => {
				out.push(["DATA", v]);
			});
			if (terminal?.kind === "complete") ctx.down([["COMPLETE"]]);
			else if (terminal?.kind === "error") ctx.down([["ERROR", terminal.error]]);
		},
	};
}

// ── notifier-driven (D46 first-cut: gated on a reactive notifier dep, no wall-clock) ──

/**
 * buffer: accumulate dep 0 (source) DATA; flush the buffer as an array each time dep 1 (notifier)
 * delivers DATA. `ctx.state` buffer. On source COMPLETE, flush any remainder then
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
		recipe: { ref: "buffer" },
		opts: { complete: "manual" },
		body: (ctx) => {
			const sourceBatch = ctx.deps[0].waves.length === 0 ? null : ctx.deps[0].waves.flat();
			const notifierBatch =
				(ctx.deps[1]?.waves ?? []).length === 0 ? null : (ctx.deps[1]?.waves.flat() ?? []);
			const buf = ctx.state.get<S[]>() ?? [];
			if (sourceBatch) for (const v of sourceBatch) buf.push(v as S);
			if (ctx.deps[0].terminal?.kind === "complete") {
				ctx.down([["DATA", [...buf]]]);
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
		recipe: { ref: "bufferCount", config: { count: toCheckpointJson(count, "bufferCount.count") } },
		opts: { complete: "manual" },
		body: (ctx) => {
			const b = ctx.deps[0].waves.length === 0 ? null : ctx.deps[0].waves.flat();
			const buf = ctx.state.get<S[]>() ?? [];
			// The buffers a run fills go out as one array, with the remainder and COMPLETE at the end.
			const out: Message[] = [];
			if (b) {
				for (const v of b) {
					buf.push(v as S);
					if (buf.length >= count) out.push(["DATA", buf.splice(0, buf.length)]);
				}
			}
			if (ctx.deps[0].terminal?.kind === "complete") {
				if (buf.length > 0) out.push(["DATA", [...buf]]);
				ctx.state.set([]);
				out.push(["COMPLETE"]);
				ctx.down(out);
				return;
			}
			ctx.state.set(buf);
			ctx.down(out);
		},
	};
}

/** Internal: latest sampled source value + whether the source has completed, for {@link sample}. */
interface SampleState<S> {
	last?: { v: S };
	sourceDone: boolean;
}

/**
 * sample: emit the source's (dep 0) most recent value each time the notifier (dep 1) delivers DATA.
 * `ctx.state`. The notifier completing completes the operator; the source completing
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
			complete: "manual",
			error: "manual",
		},
		body: (ctx) => {
			const sourceBatch = ctx.deps[0].waves.length === 0 ? null : ctx.deps[0].waves.flat();
			const notifierBatch =
				(ctx.deps[1]?.waves ?? []).length === 0 ? null : (ctx.deps[1]?.waves.flat() ?? []);
			const sourceTerminal = ctx.deps[0].terminal;
			const notifierTerminal = ctx.deps[1]?.terminal;
			// No `last` key until a value arrives: private state is strict JSON (R-checkpoint@1).
			const st: SampleState<S> = ctx.state.get<SampleState<S>>() ?? {
				sourceDone: false,
			};
			// ERROR from either dep → terminate.
			if (sourceTerminal?.kind === "error") {
				ctx.down([["ERROR", sourceTerminal?.kind === "error" ? sourceTerminal.error : undefined]]);
				return;
			}
			if (notifierTerminal?.kind === "error") {
				ctx.down([
					["ERROR", notifierTerminal?.kind === "error" ? notifierTerminal.error : undefined],
				]);
				return;
			}
			if (sourceBatch) for (const v of sourceBatch) st.last = { v: v as S };
			if (sourceTerminal?.kind === "complete") {
				st.sourceDone = true;
				delete st.last;
			}
			if (notifierTerminal?.kind === "complete") {
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
 * COMPLETE. the manual COMPLETE policy: a source
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
		recipe: { ref: "takeUntil" },
		opts: { complete: "manual" },
		body: (ctx: Ctx) => {
			const sourceBatch = ctx.deps[0].waves.length === 0 ? null : ctx.deps[0].waves.flat();
			const notifierBatch =
				(ctx.deps[1]?.waves ?? []).length === 0 ? null : (ctx.deps[1]?.waves.flat() ?? []);
			if (notifierBatch && notifierBatch.length > 0) {
				ctx.down([["COMPLETE"]]); // notifier fired → stop
				return;
			}
			if (sourceBatch) for (const v of sourceBatch) ctx.down([["DATA", v]]);
			if (ctx.deps[0].terminal?.kind === "complete") ctx.down([["COMPLETE"]]);
		},
	};
}
