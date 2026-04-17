import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPLETE, DATA, ERROR } from "../../core/messages.js";
import {
	dictStorage,
	fileStorage,
	fromIDBRequest,
	fromIDBTransaction,
	indexedDbStorage,
	memoryStorage,
	sqliteStorage,
} from "../../extra/storage.js";
import { collect } from "../test-helpers.js";

function tick(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

class FakeIDBRequest<T> {
	onsuccess: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
	onerror: ((this: IDBRequest<T>, ev: Event) => unknown) | null = null;
	onupgradeneeded: ((this: IDBOpenDBRequest, ev: Event) => unknown) | null = null;
	result!: T;
	error: DOMException | null = null;

	succeed(value: T): void {
		this.result = value;
		this.onsuccess?.call(this as unknown as IDBRequest<T>, {} as Event);
	}
}

function installFakeIndexedDb() {
	const original = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
	let stored: unknown = null;
	const stores = new Set<string>();
	const opens: Array<{ close: () => void }> = [];
	const api = {
		open(_dbName: string, _version?: number): IDBOpenDBRequest {
			const req = new FakeIDBRequest<IDBDatabase>();
			const db = {
				objectStoreNames: {
					contains(name: string) {
						return stores.has(name);
					},
				},
				createObjectStore(name: string) {
					stores.add(name);
					return {} as IDBObjectStore;
				},
				transaction(_storeName: string, _mode: IDBTransactionMode) {
					const tx = {
						oncomplete: null as ((this: IDBTransaction, ev: Event) => unknown) | null,
						onerror: null as ((this: IDBTransaction, ev: Event) => unknown) | null,
						onabort: null as ((this: IDBTransaction, ev: Event) => unknown) | null,
						error: null as DOMException | null,
						objectStore() {
							return {
								put(value: unknown) {
									const putReq = new FakeIDBRequest<unknown>();
									queueMicrotask(() => {
										stored = value;
										putReq.succeed(undefined);
										queueMicrotask(() =>
											tx.oncomplete?.call(tx as unknown as IDBTransaction, {} as Event),
										);
									});
									return putReq as unknown as IDBRequest<IDBValidKey>;
								},
								get() {
									const getReq = new FakeIDBRequest<unknown>();
									queueMicrotask(() => {
										getReq.succeed(stored);
										queueMicrotask(() =>
											tx.oncomplete?.call(tx as unknown as IDBTransaction, {} as Event),
										);
									});
									return getReq as unknown as IDBRequest<unknown>;
								},
								delete() {
									const delReq = new FakeIDBRequest<unknown>();
									queueMicrotask(() => {
										stored = null;
										delReq.succeed(undefined);
										queueMicrotask(() =>
											tx.oncomplete?.call(tx as unknown as IDBTransaction, {} as Event),
										);
									});
									return delReq as unknown as IDBRequest<unknown>;
								},
							} as unknown as IDBObjectStore;
						},
					};
					return tx as unknown as IDBTransaction;
				},
				close() {
					/* noop */
				},
			} as unknown as IDBDatabase;
			opens.push(db as unknown as { close: () => void });
			queueMicrotask(() => {
				req.result = db;
				req.onupgradeneeded?.call(req as unknown as IDBOpenDBRequest, {} as Event);
				req.onsuccess?.call(req as unknown as IDBRequest<IDBDatabase>, {} as Event);
			});
			return req as unknown as IDBOpenDBRequest;
		},
	};
	(globalThis as { indexedDB?: IDBFactory }).indexedDB = api as unknown as IDBFactory;
	return {
		restore() {
			(globalThis as { indexedDB?: IDBFactory }).indexedDB = original;
		},
		opens,
	};
}

describe("storage tier factories", () => {
	it("memoryStorage round-trips", () => {
		const tier = memoryStorage();
		tier.save("k", { v: 42 });
		expect(tier.load("k")).toEqual({ v: 42 });
		tier.clear?.("k");
		expect(tier.load("k")).toBeNull();
	});

	it("memoryStorage isolates via JSON clone", () => {
		const tier = memoryStorage();
		const obj = { v: 1 };
		tier.save("k", obj);
		obj.v = 2;
		expect((tier.load("k") as { v: number }).v).toBe(1);
	});

	it("dictStorage uses caller-provided store", () => {
		const store: Record<string, unknown> = {};
		const tier = dictStorage(store);
		tier.save("app", { hello: "world" });
		expect(store.app).toEqual({ hello: "world" });
		expect(tier.load("app")).toEqual({ hello: "world" });
		tier.clear?.("app");
		expect(store.app).toBeUndefined();
	});

	it("fileStorage writes atomically", () => {
		const dir = join(tmpdir(), `grf-storage-${Date.now()}`);
		try {
			const tier = fileStorage(dir);
			tier.save("app", { n: 1 });
			expect(tier.load("app")).toEqual({ n: 1 });
			tier.clear?.("app");
			expect(tier.load("app")).toBeNull();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fileStorage sanitizes unsafe key chars", () => {
		const dir = join(tmpdir(), `grf-storage-${Date.now()}-sanitize`);
		try {
			const tier = fileStorage(dir);
			tier.save("app/with:slashes", { ok: true });
			expect(tier.load("app/with:slashes")).toEqual({ ok: true });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("sqliteStorage round-trips and closes", () => {
		const path = join(tmpdir(), `grf-storage-${Date.now()}.db`);
		try {
			const tier = sqliteStorage(path);
			tier.save("g", { x: 99 });
			expect(tier.load("g")).toEqual({ x: 99 });
			tier.close();
			// double-close is idempotent
			tier.close();
		} finally {
			try {
				rmSync(path, { force: true });
			} catch {
				/* ignore */
			}
		}
	});

	it("load returns null on miss", () => {
		expect(memoryStorage().load("nope")).toBeNull();
		expect(dictStorage({}).load("nope")).toBeNull();
	});
});

describe("IndexedDB helpers", () => {
	it("fromIDBRequest emits DATA then COMPLETE", async () => {
		const req = new FakeIDBRequest<number>();
		const { batches, unsub } = collect(fromIDBRequest(req as unknown as IDBRequest<number>));
		req.succeed(42);
		await tick(0);
		const flat = batches.flat();
		expect(flat.some((m) => m[0] === DATA && m[1] === 42)).toBe(true);
		expect(flat.some((m) => m[0] === COMPLETE)).toBe(true);
		unsub();
	});

	it("fromIDBTransaction emits ERROR on abort", async () => {
		const tx = {
			oncomplete: null as ((this: IDBTransaction, ev: Event) => unknown) | null,
			onerror: null as ((this: IDBTransaction, ev: Event) => unknown) | null,
			onabort: null as ((this: IDBTransaction, ev: Event) => unknown) | null,
			error: new DOMException("boom", "AbortError"),
		} as unknown as IDBTransaction;
		const { batches, unsub } = collect(fromIDBTransaction(tx));
		tx.onabort?.call(tx, {} as Event);
		await tick(0);
		expect(batches.flat().some((m) => m[0] === ERROR)).toBe(true);
		unsub();
	});

	it("indexedDbStorage save/load round-trip", async () => {
		const fake = installFakeIndexedDb();
		try {
			const tier = indexedDbStorage({ dbName: "t", storeName: "cp" });
			await tier.save("g", { v: 7 });
			const loaded = await tier.load("g");
			expect(loaded).toEqual({ v: 7 });
		} finally {
			fake.restore();
		}
	});

	it("indexedDbStorage clear removes record", async () => {
		const fake = installFakeIndexedDb();
		try {
			const tier = indexedDbStorage({ dbName: "t", storeName: "cp" });
			await tier.save("g", { v: 7 });
			await tier.clear?.("g");
			expect(await tier.load("g")).toBeNull();
		} finally {
			fake.restore();
		}
	});

	it("indexedDbStorage rejects when indexedDB unavailable", async () => {
		const original = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
		(globalThis as { indexedDB?: IDBFactory }).indexedDB = undefined;
		try {
			const tier = indexedDbStorage({ dbName: "missing", storeName: "missing" });
			await expect(tier.load("g")).rejects.toThrow(/not available/);
		} finally {
			(globalThis as { indexedDB?: IDBFactory }).indexedDB = original;
		}
	});
});
