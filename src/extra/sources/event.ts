/**
 * Event-shaped sources — DOM events, timers, raf, cron.
 *
 * - {@link fromTimer} — one-shot or periodic.
 * - {@link fromRaf} — animation-frame-driven (browser); falls back to
 *   `setTimeout(~16ms)` in non-browser hosts.
 * - {@link fromCron} — polls on `tickMs` and emits when the current minute
 *   matches a 5-field cron expression.
 * - {@link fromEvent} — wraps a DOM-style `addEventListener` target.
 *
 * Each source uses `sourceOpts({ describeKind: "producer" })` for `describe()`
 * grouping consistency.
 */

import { wallClockNs } from "../../core/clock.js";
import { COMPLETE, ERROR } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";
import { type CronSchedule, matchesCron, parseCron } from "../cron.js";
import { type AsyncSourceOpts, type ExtraOpts, sourceOpts } from "./_internal.js";

/** Options for {@link fromCron}. */
export type FromCronOptions = ExtraOpts & {
	/** Polling interval in ms. Default `60_000`. */
	tickMs?: number;
	/** Output format: `"timestamp_ns"` (default) emits wall-clock nanoseconds; `"date"` emits a `Date` object. */
	output?: "timestamp_ns" | "date";
};

/** DOM-style event target (browser or `node:events`). */
export type EventTargetLike = {
	addEventListener(
		type: string,
		listener: (ev: unknown) => void,
		options?: boolean | { capture?: boolean; passive?: boolean; once?: boolean },
	): void;
	removeEventListener(
		type: string,
		listener: (ev: unknown) => void,
		options?: boolean | { capture?: boolean; passive?: boolean; once?: boolean },
	): void;
};

/**
 * Builds a timer-driven source: one-shot (first tick then `COMPLETE`) or periodic (`0`, `1`, `2`, …).
 *
 * @param ms - Milliseconds before the first emission.
 * @param opts - Producer options plus optional `period` for repeating ticks and optional `signal` (`AbortSignal`) to cancel with `ERROR`.
 * @returns `Node<number>` — tick counter from `0`; teardown clears timers.
 *
 * @example
 * ```ts
 * import { fromTimer } from "@graphrefly/graphrefly-ts";
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
				// a.emit() delivers DATA to downstream synchronously before
				// COMPLETE arrives — no queueMicrotask needed.
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

/**
 * Animation-frame-driven source. Emits on every `requestAnimationFrame` tick,
 * yielding the frame timestamp (DOMHighResTimeStamp, ms since navigation).
 *
 * Use instead of `fromTimer({ period: 16 })` when animation smoothness matters.
 * In a real browser, `requestAnimationFrame` synchronizes with the display
 * refresh. The source keeps ticking even when the tab is hidden — it
 * transparently switches to `setTimeout` while the tab is backgrounded (so
 * downstream state updates continue) and returns to `requestAnimationFrame`
 * when the tab regains focus.
 *
 * When `requestAnimationFrame` is unavailable (Node test environments, SSR),
 * this falls back to `setTimeout(~16ms)` unconditionally. Abortable via
 * `signal` (emits `ERROR`).
 *
 * @example
 * ```ts
 * import { fromRaf, derived } from "@graphrefly/graphrefly-ts";
 *
 * const frame = fromRaf();
 * const bouncingX = derived([frame], ([t]) => 50 + 40 * Math.sin((t as number) * 0.001));
 * ```
 *
 * @category extra
 */
export function fromRaf(opts?: AsyncSourceOpts): Node<number> {
	const { signal, ...rest } = opts ?? {};
	return node<number>((_data, a) => {
		let done = false;
		let rafId: number | undefined;
		let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
		let abortListenerAdded = false;
		let visibilityListenerAdded = false;

		const raf: typeof requestAnimationFrame | undefined =
			typeof requestAnimationFrame === "function" ? requestAnimationFrame : undefined;
		const caf: typeof cancelAnimationFrame | undefined =
			typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : undefined;
		const doc: Document | undefined = typeof document !== "undefined" ? document : undefined;

		const clearPending = () => {
			if (rafId !== undefined && caf) caf(rafId);
			if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
			rafId = undefined;
			fallbackTimer = undefined;
		};
		const cleanup = () => {
			done = true;
			clearPending();
			if (abortListenerAdded) {
				signal?.removeEventListener("abort", onAbort);
				abortListenerAdded = false;
			}
			if (visibilityListenerAdded && doc) {
				doc.removeEventListener("visibilitychange", onVisibilityChange);
				visibilityListenerAdded = false;
			}
		};
		const onAbort = () => {
			if (done) return;
			cleanup();
			a.down([[ERROR, signal!.reason]]);
		};
		const tick = (now: number) => {
			if (done) return;
			a.emit(now);
			scheduleNext();
		};
		const scheduleNext = () => {
			if (done) return;
			// Prefer rAF for display-synced ticks when the tab is visible; when
			// hidden, rAF is throttled to ~0 by the browser, so fall back to
			// setTimeout so downstream state continues updating.
			if (raf && (!doc || doc.visibilityState !== "hidden")) {
				rafId = raf(tick);
			} else {
				fallbackTimer = setTimeout(() => tick(performance.now()), 16);
			}
		};
		const onVisibilityChange = () => {
			if (done) return;
			// Cancel any pending schedule and re-schedule via the path now
			// appropriate for the current visibility state.
			clearPending();
			scheduleNext();
		};

		if (signal?.aborted) {
			onAbort();
			return cleanup;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		abortListenerAdded = signal !== undefined;
		if (doc && raf) {
			doc.addEventListener("visibilitychange", onVisibilityChange);
			visibilityListenerAdded = true;
		}
		scheduleNext();
		return cleanup;
	}, sourceOpts(rest));
}

/**
 * Polls on an interval; when the current minute matches a 5-field cron expression, emits once (see {@link parseCron}).
 *
 * @param expr - Cron string (`min hour dom month dow`).
 * @param opts - Producer options plus `tickMs` (default `60_000`) and `output` (`timestamp_ns` default, or `date` for `Date` values).
 * @returns `Node<number>` (nanosecond timestamp) or `Node<Date>` when `output: "date"`.
 *
 * @example
 * ```ts
 * import { fromCron } from "@graphrefly/graphrefly-ts";
 *
 * fromCron("0 9 * * 1");
 * ```
 *
 * @category extra
 */
export function fromCron(expr: string, opts?: FromCronOptions & { output: "date" }): Node<Date>;
export function fromCron(expr: string, opts?: FromCronOptions): Node<number>;
export function fromCron(expr: string, opts?: FromCronOptions): Node<number | Date> {
	const schedule: CronSchedule = parseCron(expr);
	const { tickMs: tickOpt, output, ...rest } = opts ?? {};
	const tickMs = tickOpt ?? 60_000;
	const emitDate = output === "date";
	return node<number | Date>(
		(_data, a) => {
			let lastFiredKey = -1;
			const check = () => {
				const now = new Date();
				const key =
					now.getFullYear() * 100_000_000 +
					(now.getMonth() + 1) * 1_000_000 +
					now.getDate() * 10_000 +
					now.getHours() * 100 +
					now.getMinutes();
				if (key !== lastFiredKey && matchesCron(schedule, now)) {
					lastFiredKey = key;
					a.emit(emitDate ? now : wallClockNs());
				}
			};
			check();
			const id = setInterval(check, tickMs);
			return () => clearInterval(id);
		},
		{ ...sourceOpts(rest), name: rest.name ?? `cron:${expr}` },
	);
}

/**
 * Wraps a DOM-style `addEventListener` target; each event becomes a `DATA` emission.
 *
 * @param target - Object with `addEventListener` / `removeEventListener`.
 * @param type - Event name (e.g. `"click"`).
 * @param opts - Producer options plus listener options (`capture`, `passive`, `once`).
 * @returns `Node<T>` — event payloads; teardown removes the listener.
 *
 * @example
 * ```ts
 * import { fromEvent } from "@graphrefly/graphrefly-ts";
 *
 * fromEvent(document.body, "click");
 * ```
 *
 * @category extra
 */
export function fromEvent<T = unknown>(
	target: EventTargetLike,
	type: string,
	opts?: ExtraOpts & { capture?: boolean; passive?: boolean; once?: boolean },
): Node<T> {
	const { capture, passive, once, ...rest } = opts ?? {};
	return node<T>((_data, a) => {
		const handler = (e: unknown) => {
			a.emit(e as T);
		};
		const options = { capture, passive, once };
		target.addEventListener(type, handler, options);
		return () => target.removeEventListener(type, handler, options);
	}, sourceOpts(rest));
}
