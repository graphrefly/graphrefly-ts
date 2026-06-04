import { describe, expect, it } from "vitest";
import * as storageBrowser from "../storage/browser.js";

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

	it("does not export retired snapshot/WAL APIs", () => {
		expect(Object.hasOwn(storageBrowser, "attachSnapshotStorage")).toBe(false);
		expect(Object.hasOwn(storageBrowser, "restoreSnapshot")).toBe(false);
		expect(Object.hasOwn(storageBrowser, "replayWal")).toBe(false);
	});
});
