/**
 * Watermark-based backpressure controller — reactive PAUSE/RESUME flow control.
 *
 * Purely synchronous, event-driven. No timers, no polling, no Promises.
 * Each controller instance uses a unique lockId so multiple controllers
 * on the same upstream node do not collide.
 *
 * @module
 */

import { type Messages, PAUSE, RESUME } from "../../core/messages.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WatermarkOptions = {
	/** Pending count at which PAUSE is sent upstream. */
	highWaterMark: number;
	/** Pending count at which RESUME is sent upstream (after being paused). */
	lowWaterMark: number;
};

export type WatermarkController = {
	/** Call when a DATA message is buffered/enqueued. Returns `true` if PAUSE was just sent. */
	onEnqueue(): boolean;
	/** Call when a buffered item is consumed. Returns `true` if RESUME was just sent. */
	onDequeue(): boolean;
	/** Current un-consumed item count. */
	readonly pending: number;
	/** Whether upstream is currently paused by this controller. */
	readonly paused: boolean;
	/** Dispose: if paused, sends RESUME to unblock upstream. */
	dispose(): void;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let nextLockId = 0;

/**
 * Creates a watermark-based backpressure controller.
 *
 * @param sendUp - Callback that delivers messages upstream (typically `handle.up`).
 * @param opts - High/low watermark thresholds (item counts).
 * @returns A {@link WatermarkController}.
 *
 * @example
 * ```ts
 * const handle = graph.observe("fast-source");
 * const wm = createWatermarkController(
 *   (msgs) => handle.up(msgs),
 *   { highWaterMark: 64, lowWaterMark: 16 },
 * );
 *
 * // In sink callback:
 * handle.subscribe((msgs) => {
 *   for (const msg of msgs) {
 *     if (msg[0] === DATA) {
 *       buffer.push(msg[1]);
 *       wm.onEnqueue();
 *     }
 *   }
 * });
 *
 * // When consumer drains:
 * const item = buffer.shift();
 * wm.onDequeue();
 * ```
 *
 * @category extra
 */
export function createWatermarkController(
	sendUp: (messages: Messages) => void,
	opts: WatermarkOptions,
): WatermarkController {
	if (opts.highWaterMark < 1) throw new RangeError("highWaterMark must be >= 1");
	if (opts.lowWaterMark < 0) throw new RangeError("lowWaterMark must be >= 0");
	if (opts.lowWaterMark >= opts.highWaterMark)
		throw new RangeError("lowWaterMark must be < highWaterMark");
	const lockId = Symbol(`bp-${++nextLockId}`);
	let pending = 0;
	let paused = false;

	return {
		onEnqueue(): boolean {
			pending += 1;
			if (!paused && pending >= opts.highWaterMark) {
				paused = true;
				sendUp([[PAUSE, lockId]]);
				return true;
			}
			return false;
		},
		onDequeue(): boolean {
			if (pending > 0) pending -= 1;
			if (paused && pending <= opts.lowWaterMark) {
				paused = false;
				sendUp([[RESUME, lockId]]);
				return true;
			}
			return false;
		},
		get pending() {
			return pending;
		},
		get paused() {
			return paused;
		},
		dispose() {
			if (paused) {
				paused = false;
				sendUp([[RESUME, lockId]]);
			}
		},
	};
}
