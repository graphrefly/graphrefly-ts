import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPLETE, DATA, ERROR } from "../../core/messages.js";
import { fromIDBRequest, fromIDBTransaction } from "../../extra/storage-browser.js";
import { dictKv, memoryKv } from "../../extra/storage-tiers.js";
import { indexedDbKv } from "../../extra/storage-tiers-browser.js";
import { fileKv, sqliteKv } from "../../extra/storage-tiers-node.js";
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
	// Per-key store — `indexedDbKv` uses arbitrary keys unlike old `indexedDbStorage`
	const stored = new Map<unknown, unknown>();
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
								put(value: unknown, key: unknown) {
									const putReq = new FakeIDBRequest<unknown>();
									queueMicrotask(() => {
										stored.set(key, value);
										putReq.succeed(undefined);
										queueMicrotask(() =>
											tx.oncomplete?.call(tx as unknown as IDBTransaction, {} as Event),
										);
									});
									return putReq as unknown as IDBRequest<IDBValidKey>;
								},
								get(key: unknown) {
									const getReq = new FakeIDBRequest<unknown>();
									queueMicrotask(() => {
										getReq.succeed(stored.get(key));
										queueMicrotask(() =>
											tx.oncomplete?.call(tx as unknown as IDBTransaction, {} as Event),
										);
									});
									return getReq as unknown as IDBRequest<unknown>;
								},
								delete(key: unknown) {
									const delReq = new FakeIDBRequest<unknown>();
									queueMicrotask(() => {
										stored.delete(key);
										delReq.succeed(undefined);
										queueMicrotask(() =>
											tx.oncomplete?.call(tx as unknown as IDBTransaction, {} as Event),
										);
									});
									return delReq as unknown as IDBRequest<unknown>;
								},
								getAllKeys() {
									const keysReq = new FakeIDBRequest<unknown[]>();
									queueMicrotask(() => {
										keysReq.succeed([...stored.keys()]);
										queueMicrotask(() =>
											tx.oncomplete?.call(tx as unknown as IDBTransaction, {} as Event),
										);
									});
									return keysReq as unknown as IDBRequest<IDBValidKey[]>;
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

describe("storage tier factories (kv)", () => {
	it("memoryKv round-trips", async () => {
		const tier = memoryKv();
		await tier.save("k", { v: 42 });
		expect(await tier.load("k")).toEqual({ v: 42 });
		await tier.delete?.("k");
		expect(await tier.load("k")).toBeUndefined();
	});

	it("memoryKv isolates via codec (JSON clone)", async () => {
		const tier = memoryKv<{ v: number }>();
		const obj = { v: 1 };
		await tier.save("k", obj);
		obj.v = 2;
		expect((await tier.load("k"))?.v).toBe(1);
	});

	it("memoryKv list returns sorted keys", async () => {
		const tier = memoryKv();
		await tier.save("b", 2);
		await tier.save("a", 1);
		const keys = await tier.list?.();
		expect(keys).toEqual(["a", "b"]);
	});

	it("dictKv uses caller-provided bytes store", async () => {
		const store: Record<string, Uint8Array> = {};
		const tier = dictKv<{ hello: string }>(store);
		await tier.save("app", { hello: "world" });
		expect(store["app"]).toBeInstanceOf(Uint8Array);
		expect(await tier.load("app")).toEqual({ hello: "world" });
		await tier.delete?.("app");
		expect(store["app"]).toBeUndefined();
	});

	it("fileKv writes atomically", async () => {
		const dir = join(tmpdir(), `grf-kv-${Date.now()}`);
		try {
			const tier = fileKv<{ n: number }>(dir);
			await tier.save("app", { n: 1 });
			expect(await tier.load("app")).toEqual({ n: 1 });
			await tier.delete?.("app");
			expect(await tier.load("app")).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fileKv sanitizes unsafe key chars", async () => {
		const dir = join(tmpdir(), `grf-kv-${Date.now()}-sanitize`);
		try {
			const tier = fileKv(dir);
			await tier.save("app/with:slashes", { ok: true });
			expect(await tier.load("app/with:slashes")).toEqual({ ok: true });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fileKv round-trips non-ASCII keys via UTF-8 percent escaping", async () => {
		const dir = join(tmpdir(), `grf-kv-${Date.now()}-utf8`);
		try {
			const tier = fileKv(dir);
			const keys = ["caf\u00e9", "\u20ac100", "\ud83d\udc4b hello"];
			for (const k of keys) await tier.save(k, { k });
			for (const k of keys) expect(await tier.load(k)).toEqual({ k });
			// list() must recover every key we stored, unchanged.
			const listed = await tier.list?.();
			expect(Array.isArray(listed) || listed === undefined).toBe(true);
			expect([...(listed as readonly string[])].sort()).toEqual([...keys].sort());
			for (const k of keys) await tier.delete?.(k);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fileKv.list returns [] when directory does not exist", async () => {
		const dir = join(tmpdir(), `grf-kv-${Date.now()}-nonexistent`);
		const tier = fileKv(dir);
		expect(await tier.list?.()).toEqual([]);
	});

	it("sqliteKv round-trips and closes", async () => {
		const path = join(tmpdir(), `grf-kv-${Date.now()}.db`);
		try {
			const tier = sqliteKv<{ x: number }>(path);
			await tier.save("g", { x: 99 });
			expect(await tier.load("g")).toEqual({ x: 99 });
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

	it("load returns undefined on miss", async () => {
		expect(await memoryKv().load("nope")).toBeUndefined();
		const store: Record<string, Uint8Array> = {};
		expect(await dictKv(store).load("nope")).toBeUndefined();
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

	it("indexedDbKv save/load round-trip", async () => {
		const fake = installFakeIndexedDb();
		try {
			const tier = indexedDbKv({ dbName: "t", storeName: "cp" });
			await tier.save("g", { v: 7 });
			const loaded = await tier.load("g");
			// indexedDbKv stores encoded bytes — decode gives back the value
			expect(loaded).toEqual({ v: 7 });
		} finally {
			fake.restore();
		}
	});

	it("indexedDbKv delete removes record", async () => {
		const fake = installFakeIndexedDb();
		try {
			const tier = indexedDbKv({ dbName: "t", storeName: "cp" });
			await tier.save("g", { v: 7 });
			await tier.delete?.("g");
			expect(await tier.load("g")).toBeUndefined();
		} finally {
			fake.restore();
		}
	});

	it("indexedDbKv rejects when indexedDB unavailable", async () => {
		const original = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
		(globalThis as { indexedDB?: IDBFactory }).indexedDB = undefined;
		try {
			const tier = indexedDbKv({ dbName: "missing", storeName: "missing" });
			await expect(tier.load("g")).rejects.toThrow(/not available/);
		} finally {
			(globalThis as { indexedDB?: IDBFactory }).indexedDB = original;
		}
	});
});
