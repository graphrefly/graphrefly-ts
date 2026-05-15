/**
 * Timer-based reactive source (substrate — stays in @graphrefly/pure-ts).
 *
 * Extracted from extra/sources/event.ts during cleave A2.
 * Presentation sources (fromRaf, fromCron, fromEvent) moved to
 * root src/base/sources/event/{dom,cron}.ts.
 */

import { COMPLETE, ERROR } from "../../../core/messages.js";
import { type Node, node } from "../../../core/node.js";
import { type AsyncSourceOpts, sourceOpts } from "../_internal.js";

/**
 * Builds a timer-driven source: one-shot (first tick then `COMPLETE`) or periodic (`0`, `1`, `2`, …).
 *
 * @param ms - Milliseconds before the first emission.
 * @param opts - Producer options plus optional `period` for repeating ticks and optional `signal` (`AbortSignal`) to cancel with `ERROR`.
 * @returns `Node<number>` — tick counter from `0`; teardown clears timers.
 *
 * @example
 * ```ts
 * import { fromTimer } from "@graphrefly/pure-ts";
 *
 * fromTimer(250, { period: 1_000 });
 * ```
 *
 * @category extra
 */
export function fromTimer(ms: number, opts?: AsyncSourceOpts & { period?: number }): Node<number> {
	const { signal, period, ...rest } = opts ?? {};
	return node<number>((_data, a) => {
		let done = false;
		let count = 0;
		let t: ReturnType<typeof setTimeout> | undefined;
		let iv: ReturnType<typeof setInterval> | undefined;
		const cleanup = () => {
			done = true;
			if (t !== undefined) clearTimeout(t);
			if (iv !== undefined) clearInterval(iv);
			signal?.removeEventListener("abort", onAbort);
		};
		const finish = () => {
			if (done) return;
			if (period != null) {
				a.emit(count++);
				iv = setInterval(() => {
					if (done) return;
					a.emit(count++);
				}, period);
			} else {
				// One-shot: mark done, emit, complete synchronously.
				done = true;
				signal?.removeEventListener("abort", onAbort);
				a.emit(count++);
				a.down([[COMPLETE]]);
			}
		};
		const onAbort = () => {
			if (done) return;
			cleanup();
			a.down([[ERROR, signal!.reason]]);
		};
		if (signal?.aborted) {
			onAbort();
			return;
		}
		t = setTimeout(finish, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
		return cleanup;
	}, sourceOpts(rest));
}
