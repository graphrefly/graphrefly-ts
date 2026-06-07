import { describe, expect, it } from "vitest";
import type { Message } from "../index.js";
import { graph } from "../index.js";
import {
	fromIDBRequest,
	fromIDBTransaction,
	type IDBRequestLike,
	type IDBTransactionLike,
} from "../sources/browser.js";

const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);

describe("browser source adapters", () => {
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
