import { describe, expect, it } from "vitest";
import * as storageBrowser from "../storage/browser.js";
import { hasStorageVersioned, requireStorageVersioned } from "../storage/index.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const withIndexedDbUnavailable = async (fn: () => Promise<void>) => {
	const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, "indexedDB");
	delete (globalThis as { indexedDB?: unknown }).indexedDB;
	try {
		await fn();
	} finally {
		if (descriptor) {
			Object.defineProperty(globalThis, "indexedDB", descriptor);
		} else {
			delete (globalThis as { indexedDB?: unknown }).indexedDB;
		}
	}
};

const withIndexedDbMock = async (indexedDb: IDBFactory, fn: () => Promise<void>): Promise<void> => {
	const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, "indexedDB");
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: indexedDb,
	});
	try {
		await fn();
	} finally {
		if (descriptor) {
			Object.defineProperty(globalThis, "indexedDB", descriptor);
		} else {
			delete (globalThis as { indexedDB?: unknown }).indexedDB;
		}
	}
};

describe("storage/browser (D103/D106)", () => {
	it("exports the passive browser IndexedDB storage helpers", () => {
		expect(typeof storageBrowser.indexedDbBackend).toBe("function");
		expect(typeof storageBrowser.indexedDbKv).toBe("function");
		expect(typeof storageBrowser.indexedDbAppendLog).toBe("function");
	});

	it("formats backend.name as idb:{dbName}/{storeName}", () => {
		const dbName = "gft-db";
		const storeName = "gft-store";

		const backend = storageBrowser.indexedDbBackend({ dbName, storeName });
		expect(backend.name).toBe(`idb:${dbName}/${storeName}`);
	});

	it("does not claim D108 versioned support without IndexedDB generation metadata", () => {
		const backend = storageBrowser.indexedDbBackend({ dbName: "gft-db", storeName: "kv" });

		expect(hasStorageVersioned(backend)).toBe(false);
		expect(() => requireStorageVersioned(backend, "indexedDbBackend")).toThrow(
			/indexedDbBackend: backend does not support versioned get\/set-if-match/,
		);
	});

	it("rejects with a clear error when indexedDB is unavailable", async () => {
		await withIndexedDbUnavailable(async () => {
			const backend = storageBrowser.indexedDbBackend({ dbName: "gft-db", storeName: "kv" });
			await expect(backend.get("missing")).rejects.toThrow(
				"indexedDbBackend: indexedDB is not available in this environment",
			);
		});
	});

	it("opens existing databases without forcing version 1 when version is omitted", async () => {
		let openedVersion: number | undefined;
		const fakeStore = {
			get() {
				const req: Partial<IDBRequest> = {};
				queueMicrotask(() => {
					req.result = undefined;
					req.onsuccess?.call(req as IDBRequest, new Event("success"));
				});
				return req as IDBRequest;
			},
		};
		const fakeDb = {
			objectStoreNames: { contains: () => true },
			transaction: () => ({
				objectStore: () => fakeStore,
			}),
		};
		const fakeIndexedDb = {
			open(_name: string, version?: number) {
				openedVersion = version;
				const req: Partial<IDBOpenDBRequest> = {};
				queueMicrotask(() => {
					req.result = fakeDb as IDBDatabase;
					req.onsuccess?.call(req as IDBOpenDBRequest, new Event("success"));
				});
				return req as IDBOpenDBRequest;
			},
		} as IDBFactory;

		await withIndexedDbMock(fakeIndexedDb, async () => {
			const backend = storageBrowser.indexedDbBackend({ dbName: "gft-db", storeName: "kv" });
			await expect(backend.get("missing")).resolves.toBeUndefined();
		});

		expect(openedVersion).toBeUndefined();
	});

	it("does not cache a rejected IndexedDB open forever", async () => {
		let opens = 0;
		const fakeStore = {
			get() {
				const req: Partial<IDBRequest> = {};
				queueMicrotask(() => {
					req.result = undefined;
					req.onsuccess?.call(req as IDBRequest, new Event("success"));
				});
				return req as IDBRequest;
			},
		};
		const fakeDb = {
			objectStoreNames: { contains: () => true },
			transaction: () => ({
				objectStore: () => fakeStore,
			}),
		};
		const fakeIndexedDb = {
			open() {
				opens += 1;
				const req: Partial<IDBOpenDBRequest> = {};
				queueMicrotask(() => {
					if (opens === 1) {
						req.error = new Error("transient open failure") as DOMException;
						req.onerror?.call(req as IDBOpenDBRequest, new Event("error"));
						return;
					}
					req.result = fakeDb as IDBDatabase;
					req.onsuccess?.call(req as IDBOpenDBRequest, new Event("success"));
				});
				return req as IDBOpenDBRequest;
			},
		} as IDBFactory;

		await withIndexedDbMock(fakeIndexedDb, async () => {
			const backend = storageBrowser.indexedDbBackend({ dbName: "gft-db", storeName: "kv" });
			await expect(backend.get("missing")).rejects.toThrow("transient open failure");
			await expect(backend.get("missing")).resolves.toBeUndefined();
		});

		expect(opens).toBe(2);
	});

	it("fails fast on non-string IndexedDB runtime keys", () => {
		const backend = storageBrowser.indexedDbBackend({ dbName: "gft-db", storeName: "kv" });

		expect(() => backend.get(1 as unknown as string)).toThrow(/key must be a string/);
		expect(() => backend.putIfAbsent?.(1 as unknown as string, new Uint8Array([1]))).toThrow(
			/key must be a string/,
		);
		expect(() => backend.delete(1 as unknown as string)).toThrow(/key must be a string/);
		expect(() => backend.list(1 as unknown as string)).toThrow(/list prefix must be a string/);
	});

	it("rejects malformed IndexedDB stored values as corruption", async () => {
		const fakeStore = {
			get() {
				const req: Partial<IDBRequest> = {};
				queueMicrotask(() => {
					req.result = { bytes: [1, 2, 3] };
					req.onsuccess?.call(req as IDBRequest, new Event("success"));
				});
				return req as IDBRequest;
			},
		};
		const fakeDb = {
			objectStoreNames: { contains: () => true },
			transaction: () => ({
				objectStore: () => fakeStore as unknown as IDBObjectStore,
			}),
		};
		const fakeIndexedDb = {
			open() {
				const req: Partial<IDBOpenDBRequest> = {};
				queueMicrotask(() => {
					req.result = fakeDb as IDBDatabase;
					req.onsuccess?.call(req as IDBOpenDBRequest, new Event("success"));
				});
				return req as IDBOpenDBRequest;
			},
		} as IDBFactory;

		await withIndexedDbMock(fakeIndexedDb, async () => {
			const backend = storageBrowser.indexedDbBackend({ dbName: "gft-db", storeName: "kv" });
			await expect(backend.get("bad")).rejects.toThrow(/malformed stored bytes/);
		});
	});

	it("rejects non-string IndexedDB list keys without String projection", async () => {
		const fakeStore = {
			getAllKeys() {
				const req: Partial<IDBRequest> = {};
				queueMicrotask(() => {
					req.result = ["cache/1", 2, "cache/3"];
					req.onsuccess?.call(req as IDBRequest, new Event("success"));
				});
				return req as IDBRequest;
			},
		};
		const fakeDb = {
			objectStoreNames: { contains: () => true },
			transaction: () => ({
				objectStore: () => fakeStore as unknown as IDBObjectStore,
			}),
		};
		const fakeIndexedDb = {
			open() {
				const req: Partial<IDBOpenDBRequest> = {};
				queueMicrotask(() => {
					req.result = fakeDb as IDBDatabase;
					req.onsuccess?.call(req as IDBOpenDBRequest, new Event("success"));
				});
				return req as IDBOpenDBRequest;
			},
		} as IDBFactory;

		await withIndexedDbMock(fakeIndexedDb, async () => {
			const backend = storageBrowser.indexedDbBackend({ dbName: "gft-db", storeName: "kv" });
			await expect(backend.list("cache/")).rejects.toThrow(/stored key must be a string/);
		});
	});

	it("sorts IndexedDB list results deterministically without prefix projection", async () => {
		const fakeStore = {
			getAllKeys() {
				const req: Partial<IDBRequest> = {};
				queueMicrotask(() => {
					req.result = ["cache/2", "other/0", "cache/10", "cache/1"];
					req.onsuccess?.call(req as IDBRequest, new Event("success"));
				});
				return req as IDBRequest;
			},
		};
		const fakeDb = {
			objectStoreNames: { contains: () => true },
			transaction: () => ({
				objectStore: () => fakeStore as unknown as IDBObjectStore,
			}),
		};
		const fakeIndexedDb = {
			open() {
				const req: Partial<IDBOpenDBRequest> = {};
				queueMicrotask(() => {
					req.result = fakeDb as IDBDatabase;
					req.onsuccess?.call(req as IDBOpenDBRequest, new Event("success"));
				});
				return req as IDBOpenDBRequest;
			},
		} as IDBFactory;

		await withIndexedDbMock(fakeIndexedDb, async () => {
			const backend = storageBrowser.indexedDbBackend({ dbName: "gft-db", storeName: "kv" });
			await expect(backend.list("cache/")).resolves.toEqual(["cache/1", "cache/10", "cache/2"]);
		});
	});

	it("rejects instead of hanging when an IndexedDB upgrade is blocked", async () => {
		const existingDb = {
			version: 1,
			close() {
				/* no-op */
			},
			objectStoreNames: { contains: () => false },
		};
		const fakeIndexedDb = {
			open(_name: string, version?: number) {
				const req: Partial<IDBOpenDBRequest> = {};
				queueMicrotask(() => {
					if (version === undefined) {
						req.result = existingDb as IDBDatabase;
						req.onsuccess?.call(req as IDBOpenDBRequest, new Event("success"));
						return;
					}
					req.onblocked?.call(req as IDBOpenDBRequest, new Event("blocked"));
				});
				return req as IDBOpenDBRequest;
			},
		} as IDBFactory;

		await withIndexedDbMock(fakeIndexedDb, async () => {
			const backend = storageBrowser.indexedDbBackend({ dbName: "gft-db", storeName: "kv" });
			await expect(backend.get("missing")).rejects.toThrow(
				"indexedDbBackend: open blocked; close existing database connections and retry",
			);
		});
	});

	it("rejects putIfAbsent for non-conflict IndexedDB write failures", async () => {
		const fakeStore = {
			add() {
				const req: Partial<IDBRequest> = {};
				queueMicrotask(() => {
					req.error = new DOMException("bad key", "DataError");
					req.onerror?.call(req as IDBRequest, new Event("error"));
				});
				return req as IDBRequest;
			},
		};
		const fakeDb = {
			objectStoreNames: { contains: () => true },
			transaction: () => {
				const tx: Partial<IDBTransaction> = {
					objectStore: () => fakeStore as unknown as IDBObjectStore,
				};
				queueMicrotask(() => {
					tx.error = new DOMException("bad key", "DataError");
					tx.onerror?.call(tx as IDBTransaction, new Event("error"));
				});
				return tx as IDBTransaction;
			},
		};
		const fakeIndexedDb = {
			open() {
				const req: Partial<IDBOpenDBRequest> = {};
				queueMicrotask(() => {
					req.result = fakeDb as IDBDatabase;
					req.onsuccess?.call(req as IDBOpenDBRequest, new Event("success"));
				});
				return req as IDBOpenDBRequest;
			},
		} as IDBFactory;

		await withIndexedDbMock(fakeIndexedDb, async () => {
			const backend = storageBrowser.indexedDbBackend({ dbName: "gft-db", storeName: "kv" });
			await expect(backend.putIfAbsent?.("bad key", new Uint8Array([1]))).rejects.toThrow(
				"bad key",
			);
		});
	});

	it("resolves putIfAbsent success only after the transaction commits", async () => {
		let settled = false;
		let tx: Partial<IDBTransaction> | undefined;
		const fakeStore = {
			add() {
				const req: Partial<IDBRequest> = {};
				queueMicrotask(() => {
					req.onsuccess?.call(req as IDBRequest, new Event("success"));
				});
				return req as IDBRequest;
			},
		};
		const fakeDb = {
			objectStoreNames: { contains: () => true },
			transaction: () => {
				tx = {
					objectStore: () => fakeStore as unknown as IDBObjectStore,
				};
				return tx as IDBTransaction;
			},
		};
		const fakeIndexedDb = {
			open() {
				const req: Partial<IDBOpenDBRequest> = {};
				queueMicrotask(() => {
					req.result = fakeDb as IDBDatabase;
					req.onsuccess?.call(req as IDBOpenDBRequest, new Event("success"));
				});
				return req as IDBOpenDBRequest;
			},
		} as IDBFactory;

		await withIndexedDbMock(fakeIndexedDb, async () => {
			const backend = storageBrowser.indexedDbBackend({ dbName: "gft-db", storeName: "kv" });
			const result = backend.putIfAbsent?.("k", new Uint8Array([1])).then((value) => {
				settled = true;
				return value;
			});
			await flush();
			expect(settled).toBe(false);

			tx?.oncomplete?.call(tx as IDBTransaction, new Event("complete"));

			await expect(result).resolves.toBe(true);
			expect(settled).toBe(true);
		});
	});

	it("does not export retired snapshot/WAL APIs", () => {
		expect(Object.hasOwn(storageBrowser, "attachSnapshotStorage")).toBe(false);
		expect(Object.hasOwn(storageBrowser, "restoreSnapshot")).toBe(false);
		expect(Object.hasOwn(storageBrowser, "replayWal")).toBe(false);
	});
});
