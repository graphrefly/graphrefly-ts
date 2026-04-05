import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPLETE, DATA, ERROR } from "../../core/messages.js";
import { state } from "../../core/sugar.js";
import {
	checkpointNodeValue,
	DictCheckpointAdapter,
	FileCheckpointAdapter,
	fromIDBRequest,
	fromIDBTransaction,
	MemoryCheckpointAdapter,
	restoreGraphCheckpoint,
	restoreGraphCheckpointIndexedDb,
	SqliteCheckpointAdapter,
	saveGraphCheckpoint,
	saveGraphCheckpointIndexedDb,
} from "../../extra/checkpoint.js";
import { Graph } from "../../graph/graph.js";

function tick(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function collect(node: {
	subscribe: (fn: (msgs: readonly (readonly unknown[])[]) => void) => () => void;
}) {
	const batches: Array<readonly (readonly unknown[])[]> = [];
	const unsub = node.subscribe((msgs) => {
		batches.push([...msgs]);
	});
	return { batches, unsub };
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
	const closed: Array<{ close: () => void }> = [];
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
							} as unknown as IDBObjectStore;
						},
					};
					return tx as unknown as IDBTransaction;
				},
				close() {
					/* noop */
				},
			} as unknown as IDBDatabase;
			closed.push(db as unknown as { close: () => void });
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
		closed,
	};
}

describe("extra checkpoint (roadmap §3.1)", () => {
	it("MemoryCheckpointAdapter round-trips snapshot", () => {
		const g = new Graph("g");
		g.add("x", state(7));
		const mem = new MemoryCheckpointAdapter();
		saveGraphCheckpoint(g, mem);
		const g2 = new Graph("g");
		g2.add("x", state(0));
		expect(restoreGraphCheckpoint(g2, mem)).toBe(true);
		expect(g2.get("x")).toBe(7);
	});

	it("DictCheckpointAdapter uses caller-provided key", () => {
		const g = new Graph("app");
		g.add("n", state("hi"));
		const bag: Record<string, unknown> = {};
		const ad = new DictCheckpointAdapter(bag);
		saveGraphCheckpoint(g, ad);
		expect(bag.app).toBeDefined();
		const g2 = new Graph("app");
		g2.add("n", state(""));
		expect(restoreGraphCheckpoint(g2, ad)).toBe(true);
		expect(g2.get("n")).toBe("hi");
	});

	it("FileCheckpointAdapter writes atomically", () => {
		const dir = join(tmpdir(), `grf-ckpt-${Date.now()}`);
		try {
			const g = new Graph("g");
			g.add("a", state(1));
			const file = new FileCheckpointAdapter(dir);
			saveGraphCheckpoint(g, file);
			const g2 = new Graph("g");
			g2.add("a", state(0));
			expect(restoreGraphCheckpoint(g2, file)).toBe(true);
			expect(g2.get("a")).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("SqliteCheckpointAdapter round-trips", () => {
		const path = join(tmpdir(), `grf-sqlite-${Date.now()}.db`);
		const g = new Graph("g");
		g.add("z", state(99));
		const sql = new SqliteCheckpointAdapter(path);
		saveGraphCheckpoint(g, sql);
		const g2 = new Graph("g");
		g2.add("z", state(0));
		expect(restoreGraphCheckpoint(g2, sql)).toBe(true);
		expect(g2.get("z")).toBe(99);
		sql.close();
		try {
			rmSync(path, { force: true });
		} catch {
			/* ignore */
		}
	});

	it("CheckpointAdapter clear removes data", () => {
		const mem = new MemoryCheckpointAdapter();
		mem.save("k", { v: 1 });
		expect(mem.load("k")).toEqual({ v: 1 });
		mem.clear("k");
		expect(mem.load("k")).toBeNull();
	});

	it("restore returns false when empty", () => {
		const g = new Graph("g");
		g.add("x", state(1));
		expect(restoreGraphCheckpoint(g, new MemoryCheckpointAdapter())).toBe(false);
	});

	it("checkpointNodeValue", () => {
		const n = state(3);
		expect(checkpointNodeValue(n)).toEqual({ version: 1, value: 3 });
	});

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

	it("fromIDBTransaction emits ERROR on abort/error", async () => {
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

	it("save/restore IndexedDB checkpoint via reactive nodes", async () => {
		const fake = installFakeIndexedDb();
		try {
			const g = new Graph("g");
			g.add("x", state(7));
			const save = collect(
				saveGraphCheckpointIndexedDb(g, {
					dbName: "test-db",
					storeName: "snapshots",
				}),
			);
			await tick(0);
			await tick(0);
			const saveFlat = save.batches.flat();
			expect(saveFlat.some((m) => m[0] === ERROR)).toBe(false);
			expect(saveFlat.some((m) => m[0] === DATA && Object.is(m[1], undefined))).toBe(true);
			expect(saveFlat.some((m) => m[0] === COMPLETE)).toBe(true);
			save.unsub();

			const g2 = new Graph("g");
			g2.add("x", state(0));
			const restore = collect(
				restoreGraphCheckpointIndexedDb(g2, {
					dbName: "test-db",
					storeName: "snapshots",
				}),
			);
			await tick(0);
			await tick(0);
			expect(restore.batches.flat().some((m) => m[0] === ERROR)).toBe(false);
			restore.unsub();
			expect(fake.closed.length).toBeGreaterThanOrEqual(2);
		} finally {
			fake.restore();
		}
	});

	it("indexedDB helpers emit ERROR when indexedDB is unavailable", async () => {
		const original = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
		(globalThis as { indexedDB?: IDBFactory }).indexedDB = undefined;
		try {
			const g = new Graph("g");
			const { batches, unsub } = collect(
				saveGraphCheckpointIndexedDb(g, {
					dbName: "missing-db",
					storeName: "missing-store",
				}),
			);
			await tick(0);
			expect(batches.flat().some((m) => m[0] === ERROR)).toBe(true);
			unsub();
		} finally {
			(globalThis as { indexedDB?: IDBFactory }).indexedDB = original;
		}
	});
});
