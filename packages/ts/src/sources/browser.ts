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
