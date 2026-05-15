/**
 * DOM-based reactive event sources (browser-layer).
 *
 * Moved from extra/sources/event.ts (fromEvent, fromRaf) during cleave A2.
 */

import { ERROR, type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core";

type ExtraOpts = Omit<NodeOptions, "describeKind">;
type AsyncSourceOpts = ExtraOpts & { signal?: AbortSignal };

function sourceOpts<T = unknown>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "producer", ...opts } as NodeOptions<T>;
}

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
