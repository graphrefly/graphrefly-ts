import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPLETE, DATA, ERROR } from "../../core/messages.js";
import { fromIDBRequest, fromIDBTransaction } from "../../extra/storage-browser.js";
import {
	appendLogStorage,
	dictKv,
	memoryAppendLog,
	memoryBackend,
	memoryKv,
	memorySnapshot,
	snapshotStorage,
} from "../../extra/storage-tiers.js";
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

// ── Audit 4 — transaction semantics ───────────────────────────────────

describe("storage tier transaction semantics (Audit 4)", () => {
	it("snapshotStorage with debounceMs > 0 buffers across waves until flush()", async () => {
		const backend = memoryBackend();
		const tier = snapshotStorage<{ name: string; value: number }>(backend, {
			name: "snap",
			debounceMs: 10_000,
		});

		// Three saves in sequence — none should hit the backend yet.
		tier.save({ name: "snap", value: 1 });
		tier.save({ name: "snap", value: 2 });
		tier.save({ name: "snap", value: 3 });

		expect(backend.read("snap")).toBeUndefined();

		// Explicit flush commits the latest pending snapshot only — snapshot
		// tiers track a single pending record by design.
		await tier.flush?.();
		const bytes = backend.read("snap") as Uint8Array;
		const decoded = JSON.parse(new TextDecoder().decode(bytes));
		expect(decoded).toEqual({ name: "snap", value: 3 });
	});

	it("snapshotStorage rollback() discards pending without writing", async () => {
		const backend = memoryBackend();
		const tier = snapshotStorage<{ name: string; v: number }>(backend, {
			name: "snap",
			debounceMs: 10_000,
		});

		tier.save({ name: "snap", v: 42 });
		await tier.rollback?.();
		// flush() after rollback is a no-op — pending was cleared.
		await tier.flush?.();
		expect(backend.read("snap")).toBeUndefined();
	});

	it("snapshotStorage with debounceMs=0 (sync-through) writes on every save", () => {
		const backend = memoryBackend();
		const tier = snapshotStorage<{ name: string; v: number }>(backend, { name: "snap" });

		tier.save({ name: "snap", v: 1 });
		expect(backend.read("snap")).toBeDefined();
		const decoded1 = JSON.parse(new TextDecoder().decode(backend.read("snap") as Uint8Array));
		expect(decoded1.v).toBe(1);

		tier.save({ name: "snap", v: 2 });
		const decoded2 = JSON.parse(new TextDecoder().decode(backend.read("snap") as Uint8Array));
		expect(decoded2.v).toBe(2);
	});

	it("appendLogStorage with debounceMs > 0 buffers entries until flush()", async () => {
		const backend = memoryBackend();
		const tier = appendLogStorage<{ id: number }>(backend, {
			name: "log",
			debounceMs: 10_000,
		});

		tier.appendEntries([{ id: 1 }, { id: 2 }]);
		tier.appendEntries([{ id: 3 }]);
		expect(backend.read("log")).toBeUndefined();

		await tier.flush?.();
		const bytes = backend.read("log") as Uint8Array;
		const decoded = JSON.parse(new TextDecoder().decode(bytes));
		expect(decoded).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
	});

	it("appendLogStorage rollback() discards buffered entries", async () => {
		const backend = memoryBackend();
		const tier = appendLogStorage<{ id: number }>(backend, {
			name: "log",
			debounceMs: 10_000,
		});

		tier.appendEntries([{ id: 1 }, { id: 2 }]);
		await tier.rollback?.();
		await tier.flush?.();
		expect(backend.read("log")).toBeUndefined();
	});

	it("appendLogStorage keyOf partitions entries across backend keys", async () => {
		const backend = memoryBackend();
		const tier = appendLogStorage<{ topic: string; id: number }>(backend, {
			keyOf: (e) => e.topic,
		});

		// Each `appendEntries` triggers an auto-flush (no debounceMs) that
		// returns a Promise on the per-tier serialized write chain. Awaiting
		// each in turn drains the chain — `tier.flush()` alone is not enough
		// because it short-circuits when `pending` is already empty.
		await Promise.resolve(tier.appendEntries([{ topic: "orders", id: 1 }]));
		await Promise.resolve(tier.appendEntries([{ topic: "shipments", id: 10 }]));
		await Promise.resolve(tier.appendEntries([{ topic: "orders", id: 2 }]));

		const orders = JSON.parse(new TextDecoder().decode(backend.read("orders") as Uint8Array));
		const shipments = JSON.parse(new TextDecoder().decode(backend.read("shipments") as Uint8Array));
		expect(orders).toEqual([
			{ topic: "orders", id: 1 },
			{ topic: "orders", id: 2 },
		]);
		expect(shipments).toEqual([{ topic: "shipments", id: 10 }]);
	});

	it("multi-tier read: first-tier-wins via tier.load() — caller iterates in order", async () => {
		const hot = memorySnapshot<{ name: string; value: number }>({ name: "snap" });
		const cold = memorySnapshot<{ name: string; value: number }>({ name: "snap" });

		// Only the cold tier has the record.
		await cold.save({ name: "snap", value: 99 });

		const tiers = [hot, cold];
		// First-hit-wins read pattern (mirrors framework wiring per Audit 4).
		let found: { name: string; value: number } | undefined;
		for (const t of tiers) {
			const v = await t.load?.();
			if (v !== undefined) {
				found = v;
				break;
			}
		}
		expect(found?.value).toBe(99);
	});

	it("userspace iteration over tiers: per-tier failures are isolated; healthy tiers still persist", async () => {
		// This test exercises the **userspace** pattern documented in Audit 4
		// for callers that fan a single write across multiple tiers — NOT the
		// framework's wiring layer (which iterates tiers internally per
		// primitive). It pins the documented "best-effort cross-tier
		// atomicity" caveat: one tier failing does NOT prevent others from
		// persisting, and the failure surfaces as an exception the caller can
		// route to `options.onError` or equivalent.
		const goodTier = memoryAppendLog<{ id: number }>({ name: "good" });
		const failTier = {
			name: "bad",
			appendEntries: () => {
				throw new Error("disk full");
			},
			flush: async () => {},
			rollback: async () => {},
		};

		const tiers = [goodTier, failTier];
		const errors: unknown[] = [];
		for (const t of tiers) {
			try {
				const r = t.appendEntries([{ id: 1 }]);
				if (r instanceof Promise) await r;
			} catch (e) {
				errors.push(e);
			}
		}

		expect(errors.length).toBe(1);
		await goodTier.flush?.();
		const result = await goodTier.loadEntries?.();
		expect(result?.entries).toEqual([{ id: 1 }]);
	});

	it("appendLogStorage compactEvery auto-flushes every N writes regardless of debounce", async () => {
		const backend = memoryBackend();
		const tier = appendLogStorage<{ id: number }>(backend, {
			name: "log",
			debounceMs: 10_000,
			compactEvery: 2,
		});

		// Entry 1 — under compactEvery threshold; debounce is 10s so the
		// backend stays untouched.
		tier.appendEntries([{ id: 1 }]);
		expect(backend.read("log")).toBeUndefined();

		// Entry 2 — compactEvery hit → tier auto-flushes. Awaiting the
		// `appendEntries` return drains the per-tier flush chain. **No
		// explicit `tier.flush?.()`** — that would mask the auto-flush
		// behavior under test.
		await Promise.resolve(tier.appendEntries([{ id: 2 }]));

		const bytes = backend.read("log") as Uint8Array;
		expect(bytes).toBeDefined();
		expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual([{ id: 1 }, { id: 2 }]);
	});
});
