import { describe, expect, it } from "vitest";
import type { Message } from "../index.js";
import { graph } from "../index.js";
import {
	type AnimationFrameHandle,
	type AnimationFrameScheduler,
	fromIDBRequest,
	fromIDBTransaction,
	fromRaf,
	type IDBRequestLike,
	type IDBTransactionLike,
	type VisibilityDocumentLike,
} from "../sources/browser.js";

const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);

describe("browser source adapters", () => {
	it("fromRaf emits frame timestamps and cancels the pending host frame on unsubscribe", () => {
		let nextHandle = 0;
		const callbacks = new Map<AnimationFrameHandle, (time: number) => void>();
		const canceled: AnimationFrameHandle[] = [];
		const scheduler: AnimationFrameScheduler = {
			requestAnimationFrame(callback) {
				const handle = ++nextHandle;
				callbacks.set(handle, callback);
				return handle;
			},
			cancelAnimationFrame(handle) {
				canceled.push(handle);
				callbacks.delete(handle);
			},
		};
		const n = graph().initNode(fromRaf({ scheduler }), [], { name: "frames" });
		const msgs: Message[] = [];
		const unsubscribe = n.subscribe((msg) => msgs.push(msg));

		const first = callbacks.get(1);
		callbacks.delete(1);
		first?.(12.5);
		const second = callbacks.get(2);
		callbacks.delete(2);
		second?.(24);
		unsubscribe();
		callbacks.get(3)?.(48);

		expect(data(msgs)).toEqual([12.5, 24]);
		expect(canceled).toEqual([3]);
	});

	it("fromRaf can park while the visibility document is hidden", () => {
		let nextHandle = 0;
		const callbacks = new Map<AnimationFrameHandle, (time: number) => void>();
		let visibilityListener: (() => void) | undefined;
		let visibilityState = "hidden";
		const scheduler: AnimationFrameScheduler = {
			requestAnimationFrame(callback) {
				const handle = ++nextHandle;
				callbacks.set(handle, callback);
				return handle;
			},
			cancelAnimationFrame(handle) {
				callbacks.delete(handle);
			},
		};
		const visibilityDocument: VisibilityDocumentLike = {
			get visibilityState() {
				return visibilityState;
			},
			addEventListener(type, listener) {
				if (type === "visibilitychange") visibilityListener = listener;
			},
			removeEventListener(type, listener) {
				if (type === "visibilitychange" && visibilityListener === listener) {
					visibilityListener = undefined;
				}
			},
		};
		const n = graph().initNode(
			fromRaf({ scheduler, pauseWhenHidden: true, document: visibilityDocument }),
			[],
		);
		const msgs: Message[] = [];
		const unsubscribe = n.subscribe((msg) => msgs.push(msg));

		expect(callbacks.size).toBe(0);
		visibilityState = "visible";
		visibilityListener?.();
		const first = callbacks.get(1);
		callbacks.delete(1);
		first?.(10);
		visibilityState = "hidden";
		visibilityListener?.();
		callbacks.get(2)?.(20);
		unsubscribe();

		expect(data(msgs)).toEqual([10]);
		expect(callbacks.size).toBe(0);
		expect(visibilityListener).toBeUndefined();
	});

	it("fromIDBRequest emits request result then COMPLETE", () => {
		const request: IDBRequestLike<number> = {
			result: 42,
			error: null,
			onsuccess: null,
			onerror: null,
		};
		const n = graph().initNode(fromIDBRequest(request), []);
		const msgs: Message[] = [];
		n.subscribe((msg) => msgs.push(msg));

		request.onsuccess?.call(request, { type: "success" });

		expect(data(msgs)).toEqual([42]);
		expect(msgs.at(-1)?.[0]).toBe("COMPLETE");
		expect(request.onsuccess).toBeNull();
		expect(request.onerror).toBeNull();
	});

	it("fromIDBRequest coerces undefined request result to ERROR", () => {
		const request: IDBRequestLike<undefined> = {
			result: undefined,
			error: null,
			onsuccess: null,
			onerror: null,
		};
		const n = graph().initNode(fromIDBRequest(request), []);
		const msgs: Message[] = [];
		n.subscribe((msg) => msgs.push(msg));

		request.onsuccess?.call(request, { type: "success" });

		expect(data(msgs)).toEqual([]);
		expect(msgs.at(-1)?.[0]).toBe("ERROR");
		expect((msgs.at(-1) as ["ERROR", unknown])[1]).toBeInstanceOf(TypeError);
	});

	it("fromIDBTransaction completes without DATA on success", () => {
		const transaction: IDBTransactionLike = {
			error: null,
			oncomplete: null,
			onerror: null,
			onabort: null,
		};
		const n = graph().initNode(fromIDBTransaction(transaction), []);
		const msgs: Message[] = [];
		n.subscribe((msg) => msgs.push(msg));

		transaction.oncomplete?.call(transaction, { type: "complete" });

		expect(data(msgs)).toEqual([]);
		expect(msgs.at(-1)?.[0]).toBe("COMPLETE");
		expect(transaction.oncomplete).toBeNull();
		expect(transaction.onerror).toBeNull();
		expect(transaction.onabort).toBeNull();
	});

	it("fromIDBTransaction emits ERROR on abort", () => {
		const transaction: IDBTransactionLike = {
			error: new Error("abort"),
			oncomplete: null,
			onerror: null,
			onabort: null,
		};
		const n = graph().initNode(fromIDBTransaction(transaction), []);
		const msgs: Message[] = [];
		n.subscribe((msg) => msgs.push(msg));

		transaction.onabort?.call(transaction, { type: "abort" });

		expect(data(msgs)).toEqual([]);
		expect(msgs.at(-1)?.[0]).toBe("ERROR");
		expect((msgs.at(-1) as ["ERROR", unknown])[1]).toBe(transaction.error);
	});
});
