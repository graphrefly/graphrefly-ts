/**
 * Buffer / window operators (roadmap §2.1) — group emissions into batches or
 * sub-streams.
 *
 * `buffer` (notifier-driven flush), `bufferCount` (size-driven), `bufferTime`
 * (time-driven), `window` / `windowCount` / `windowTime` (each emit a fresh
 * sub-`Node<T>` per partition).
 */

import { COMPLETE, DATA, ERROR, type Messages } from "../../core/messages.js";
import { factoryTag } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { type ExtraOpts, operatorOpts } from "./_internal.js";

/**
 * Buffers source `DATA` values; flushes an array when `notifier` settles (`buffer`).
 *
 * @param source - Upstream node.
 * @param notifier - Flush trigger on each settlement.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T[]>` - Emits buffered arrays (may be empty-handled via `RESOLVED` when nothing buffered).
 * @example
 * ```ts
 * import { buffer, state } from "@graphrefly/graphrefly-ts";
 *
 * buffer(state(0), state(0));
 * ```
 *
 * @category extra
 */
export function buffer<T>(source: Node<T>, notifier: Node<unknown>, opts?: ExtraOpts): Node<T[]> {
	return node<T[]>((_data, a) => {
		const buf: T[] = [];

		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					buf.push(m[1] as T);
				} else if (m[0] === COMPLETE) {
					if (buf.length > 0) a.emit([...buf]);
					buf.length = 0;
					a.down([[COMPLETE]]);
				} else if (m[0] === ERROR) {
					a.down([m]);
				}
			}
		});

		const notUnsub = notifier.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					if (buf.length > 0) {
						a.emit([...buf]);
						buf.length = 0;
					}
				} else if (m[0] === COMPLETE) {
					// Notifier complete — forward
					a.down([[COMPLETE]]);
				} else if (m[0] === ERROR) {
					a.down([m]);
				}
			}
		});

		return () => {
			srcUnsub();
			notUnsub();
			buf.length = 0;
		};
	}, operatorOpts(opts));
}

/**
 * Batches consecutive `DATA` values into arrays of length `count` (`bufferCount` / `windowCount`).
 *
 * @param source - Upstream node.
 * @param count - Buffer size before emit; must be > 0.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T[]>` - Emits fixed-size arrays; remainder flushes on `COMPLETE`.
 * @example
 * ```ts
 * import { bufferCount, state } from "@graphrefly/graphrefly-ts";
 *
 * bufferCount(state(0), 3);
 * ```
 *
 * @category extra
 */
export function bufferCount<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T[]> {
	if (count <= 0) throw new RangeError("bufferCount expects count > 0");
	return node<T[]>((_data, a) => {
		const buf: T[] = [];

		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					buf.push(m[1] as T);
					if (buf.length >= count) {
						a.emit(buf.splice(0, buf.length));
					}
				} else if (m[0] === COMPLETE) {
					if (buf.length > 0) a.emit([...buf]);
					buf.length = 0;
					a.down([[COMPLETE]]);
				} else if (m[0] === ERROR) {
					a.down([m]);
				}
			}
		});

		return () => {
			srcUnsub();
			buf.length = 0;
		};
	}, operatorOpts(opts));
}

/**
 * Splits source `DATA` into sub-nodes of `count` values each. Each sub-node completes after `count` items or when source completes.
 *
 * @param source - Upstream node.
 * @param count - Items per window.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<Node<T>>` - Each emission is a sub-node carrying that window's values.
 *
 * @example
 * ```ts
 * import { windowCount, state } from "@graphrefly/graphrefly-ts";
 *
 * windowCount(state(0), 3);
 * ```
 *
 * @category extra
 */
export function windowCount<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<Node<T>> {
	if (count <= 0) throw new RangeError("windowCount expects count > 0");

	return node<Node<T>>((_data, a) => {
		let winDown: ((msgs: Messages) => void) | undefined;
		let n = 0;

		function openWindow(): void {
			const s = node<T>((_data2, actions) => {
				winDown = actions.down.bind(actions);
				return () => {
					winDown = undefined;
				};
			}, operatorOpts());
			n = 0;
			a.emit(s);
		}

		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					if (!winDown) openWindow();
					winDown?.([[DATA, m[1]]]);
					n += 1;
					if (n >= count) {
						winDown?.([[COMPLETE]]);
						winDown = undefined;
					}
				} else if (m[0] === COMPLETE) {
					winDown?.([[COMPLETE]]);
					winDown = undefined;
					a.down([[COMPLETE]]);
				} else if (m[0] === ERROR) {
					winDown?.([m]);
					winDown = undefined;
					a.down([m]);
				}
			}
		});

		return () => {
			srcUnsub();
			winDown?.([[COMPLETE]]);
			winDown = undefined;
		};
	}, operatorOpts(opts));
}

/**
 * Flushes buffered `DATA` values every `ms` (`bufferTime` / `windowTime`).
 *
 * @param source - Upstream node.
 * @param ms - Flush interval in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T[]>` - Time-windowed batches.
 * @example
 * ```ts
 * import { bufferTime, state } from "@graphrefly/graphrefly-ts";
 *
 * bufferTime(state(0), 250);
 * ```
 *
 * @category extra
 */
export function bufferTime<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T[]> {
	return node<T[]>(
		(_data, a) => {
			const buf: T[] = [];

			const iv = setInterval(() => {
				if (buf.length > 0) {
					a.emit([...buf]);
					buf.length = 0;
				}
			}, ms);

			const srcUnsub = source.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) {
						buf.push(m[1] as T);
					} else if (m[0] === COMPLETE) {
						clearInterval(iv);
						if (buf.length > 0) a.emit([...buf]);
						buf.length = 0;
						a.down([[COMPLETE]]);
					} else if (m[0] === ERROR) {
						clearInterval(iv);
						a.down([m]);
					}
					// DIRTY from source is NOT forwarded — bufferTime
					// transforms the timeline. a.emit(buf) handles full
					// DIRTY+DATA framing when the interval fires.
				}
			});

			return () => {
				srcUnsub();
				clearInterval(iv);
				buf.length = 0;
			};
		},
		{
			...operatorOpts(opts),
			meta: { ...factoryTag("bufferTime", { ms }), ...(opts?.meta ?? {}) },
		},
	);
}

/**
 * Splits source `DATA` into time-windowed sub-nodes; each window lasts `ms`.
 *
 * @param source - Upstream node.
 * @param ms - Window duration in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<Node<T>>` - Each emission is a sub-node carrying that window's values.
 *
 * @example
 * ```ts
 * import { windowTime, state } from "@graphrefly/graphrefly-ts";
 *
 * windowTime(state(0), 500);
 * ```
 *
 * @category extra
 */
export function windowTime<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<Node<T>> {
	return node<Node<T>>((_data, a) => {
		let winDown: ((msgs: Messages) => void) | undefined;

		function closeWindow(): void {
			winDown?.([[COMPLETE]]);
			winDown = undefined;
		}

		function openWindow(): void {
			const s = node<T>((_data2, actions) => {
				winDown = actions.down.bind(actions);
				return () => {
					winDown = undefined;
				};
			}, operatorOpts());
			a.emit(s);
		}

		openWindow();
		const iv = setInterval(() => {
			closeWindow();
			openWindow();
		}, ms);

		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					winDown?.([[DATA, m[1]]]);
				} else if (m[0] === COMPLETE) {
					clearInterval(iv);
					closeWindow();
					a.down([[COMPLETE]]);
				} else if (m[0] === ERROR) {
					clearInterval(iv);
					winDown?.([m]);
					closeWindow();
					a.down([m]);
				}
			}
		});

		return () => {
			srcUnsub();
			clearInterval(iv);
			closeWindow();
		};
	}, operatorOpts(opts));
}

/**
 * Splits source `DATA` into sub-nodes, opening a new window each time `notifier` emits `DATA`.
 *
 * @param source - Upstream node.
 * @param notifier - Each `DATA` from `notifier` closes the current window and opens a new one.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<Node<T>>` - Each emission is a sub-node carrying that window's values.
 *
 * @example
 * ```ts
 * import { state, window } from "@graphrefly/graphrefly-ts";
 *
 * window(state(0), state(0));
 * ```
 *
 * @category extra
 */
export function window<T>(
	source: Node<T>,
	notifier: Node<unknown>,
	opts?: ExtraOpts,
): Node<Node<T>> {
	return node<Node<T>>((_data, a) => {
		let winDown: ((msgs: Messages) => void) | undefined;

		function closeWindow(): void {
			winDown?.([[COMPLETE]]);
			winDown = undefined;
		}

		function openWindow(): void {
			const s = node<T>((_data2, actions) => {
				winDown = actions.down.bind(actions);
				return () => {
					winDown = undefined;
				};
			}, operatorOpts());
			a.emit(s);
		}

		const srcUnsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					if (!winDown) openWindow();
					winDown?.([[DATA, m[1]]]);
				} else if (m[0] === COMPLETE) {
					closeWindow();
					a.down([[COMPLETE]]);
				} else if (m[0] === ERROR) {
					winDown?.([m]);
					winDown = undefined;
					a.down([m]);
				}
			}
		});

		const notUnsub = notifier.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					closeWindow();
					openWindow();
				}
			}
		});

		return () => {
			srcUnsub();
			notUnsub();
			closeWindow();
		};
	}, operatorOpts(opts));
}
