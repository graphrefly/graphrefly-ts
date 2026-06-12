/**
 * Browser-safe source factories. This subpath intentionally excludes
 * Node-only adapters such as fromFSWatch.
 */

import type { Ctx } from "../ctx/types.js";
import type { Operator } from "../graph/operators.js";
import { errorPayload } from "../protocol/messages.js";

export * from "./index.js";

type IDBEventHandler<TThis> = {
	bivarianceHack(this: TThis, event: unknown): unknown;
}["bivarianceHack"];

export interface IDBRequestLike<T> {
	result: T;
	error?: unknown;
	onsuccess: null | IDBEventHandler<IDBRequestLike<T>>;
	onerror: null | IDBEventHandler<IDBRequestLike<T>>;
}

export interface IDBTransactionLike {
	error?: unknown;
	oncomplete: null | IDBEventHandler<IDBTransactionLike>;
	onerror: null | IDBEventHandler<IDBTransactionLike>;
	onabort: null | IDBEventHandler<IDBTransactionLike>;
}

export type AnimationFrameHandle = number | ReturnType<typeof setTimeout>;

export interface AnimationFrameScheduler {
	requestAnimationFrame(callback: (time: number) => void): AnimationFrameHandle;
	cancelAnimationFrame(handle: AnimationFrameHandle): void;
}

export interface VisibilityDocumentLike {
	readonly visibilityState?: "hidden" | "visible" | "prerender" | string;
	addEventListener?(type: "visibilitychange", listener: () => void): void;
	removeEventListener?(type: "visibilitychange", listener: () => void): void;
}

export interface FromRafOptions {
	/** Custom scheduler for tests or host wrappers. Defaults to browser rAF, then a timer fallback. */
	readonly scheduler?: AnimationFrameScheduler;
	/** Timer fallback cadence when requestAnimationFrame is unavailable. Default: 16ms. */
	readonly fallbackMs?: number;
	/** Fully park while the provided/browser document is hidden. Default: false. */
	readonly pauseWhenHidden?: boolean;
	/** Document-like visibility source for tests or embedded browser hosts. */
	readonly document?: VisibilityDocumentLike;
}

function source<T>(
	factory: string,
	setup: (ctx: Ctx) => undefined | (() => void),
): Operator<never, T> {
	return {
		factory,
		body: (ctx) => {
			const cleanup = setup(ctx);
			if (typeof cleanup === "function") ctx.onDeactivation(cleanup);
		},
	};
}

function defaultAnimationFrameScheduler(fallbackMs: number): AnimationFrameScheduler {
	const host = globalThis as {
		requestAnimationFrame?: (callback: (time: number) => void) => number;
		cancelAnimationFrame?: (handle: number) => void;
	};
	if (
		typeof host.requestAnimationFrame === "function" &&
		typeof host.cancelAnimationFrame === "function"
	) {
		return {
			requestAnimationFrame: (callback) => host.requestAnimationFrame?.(callback) ?? 0,
			cancelAnimationFrame: (handle) => {
				if (typeof handle === "number") host.cancelAnimationFrame?.(handle);
			},
		};
	}
	return {
		requestAnimationFrame(callback) {
			return setTimeout(() => callback(Date.now()), fallbackMs);
		},
		cancelAnimationFrame(handle) {
			clearTimeout(handle);
		},
	};
}

function defaultVisibilityDocument(): VisibilityDocumentLike | undefined {
	return (globalThis as { document?: VisibilityDocumentLike }).document;
}

/**
 * Browser animation-frame source.
 *
 * This is a browser/source boundary, not reactive-layout ownership (D181): every frame timestamp
 * enters the graph as DATA through `ctx.down`, and teardown cancels the pending host callback.
 */
export function fromRaf(opts: FromRafOptions = {}): Operator<never, number> {
	const fallbackMsOpt = opts.fallbackMs;
	const fallbackMs =
		Number.isFinite(fallbackMsOpt) && fallbackMsOpt !== undefined && fallbackMsOpt > 0
			? fallbackMsOpt
			: 16;
	const scheduler = opts.scheduler ?? defaultAnimationFrameScheduler(fallbackMs);
	const visibilityDocument = opts.document ?? defaultVisibilityDocument();
	return {
		factory: "fromRaf",
		opts: { pool: "sync", pausable: false },
		body: (ctx) => {
			let active = true;
			let frame: AnimationFrameHandle | undefined;
			const cancelPending = () => {
				if (frame === undefined) return;
				scheduler.cancelAnimationFrame(frame);
				frame = undefined;
			};
			const isHidden = () =>
				opts.pauseWhenHidden === true && visibilityDocument?.visibilityState === "hidden";
			const schedule = () => {
				if (!active || frame !== undefined || isHidden()) return;
				frame = scheduler.requestAnimationFrame((time) => {
					frame = undefined;
					if (!active || isHidden()) return;
					ctx.down([["DATA", Number.isFinite(time) ? time : Date.now()]]);
					schedule();
				});
			};
			const onVisibilityChange = () => {
				if (!active) return;
				if (isHidden()) cancelPending();
				else schedule();
			};
			if (
				opts.pauseWhenHidden === true &&
				visibilityDocument?.addEventListener &&
				visibilityDocument.removeEventListener
			) {
				visibilityDocument.addEventListener("visibilitychange", onVisibilityChange);
			}
			ctx.onDeactivation(() => {
				active = false;
				cancelPending();
				visibilityDocument?.removeEventListener?.("visibilitychange", onVisibilityChange);
			});
			schedule();
		},
	};
}

/** Wrap an IndexedDB request as a one-shot source. */
export function fromIDBRequest<T>(request: IDBRequestLike<T>): Operator<never, T> {
	return source<T>("fromIDBRequest", (ctx) => {
		let done = false;
		const clear = () => {
			request.onsuccess = null;
			request.onerror = null;
		};
		request.onsuccess = () => {
			if (done) return;
			done = true;
			clear();
			if (request.result === undefined) {
				ctx.down([
					["ERROR", new TypeError("fromIDBRequest: request.result is the substrate SENTINEL")],
				]);
				return;
			}
			ctx.down([["DATA", request.result], ["COMPLETE"]]);
		};
		request.onerror = () => {
			if (done) return;
			done = true;
			clear();
			ctx.down([["ERROR", errorPayload(request.error ?? new Error("IndexedDB request failed"))]]);
		};
		return () => {
			done = true;
			clear();
		};
	});
}

/**
 * Wrap an IndexedDB transaction lifecycle as a terminal-only source.
 *
 * Success emits COMPLETE without DATA: undefined is the TypeScript SENTINEL and cannot be a DATA
 * payload under R-data-payload.
 */
export function fromIDBTransaction(transaction: IDBTransactionLike): Operator<never, never> {
	return source<never>("fromIDBTransaction", (ctx) => {
		let done = false;
		const clear = () => {
			transaction.oncomplete = null;
			transaction.onerror = null;
			transaction.onabort = null;
		};
		const fail = (fallback: string) => {
			if (done) return;
			done = true;
			clear();
			ctx.down([["ERROR", errorPayload(transaction.error ?? new Error(fallback))]]);
		};
		transaction.oncomplete = () => {
			if (done) return;
			done = true;
			clear();
			ctx.down([["COMPLETE"]]);
		};
		transaction.onerror = () => fail("IndexedDB transaction failed");
		transaction.onabort = () => fail("IndexedDB transaction aborted");
		return () => {
			done = true;
			clear();
		};
	});
}
