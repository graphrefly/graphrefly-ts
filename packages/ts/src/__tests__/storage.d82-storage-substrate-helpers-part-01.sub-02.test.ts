import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { KvStorageTier } from "../index.js";
import {
	hasStoragePutIfAbsent,
	hasStorageVersioned,
	memoryBackend,
	memoryKv,
	requireKvVersioned,
	requireStoragePutIfAbsent,
	requireStorageVersioned,
	tieredReadThrough,
	webStorageBackend,
} from "../index.js";
import { fileAppendLog, fileBackend, fileKv, sqliteBackend } from "../storage/node.js";
import { storagePhysicalKey } from "../storage/physical-key.js";

interface TestStorage {
	entries: Record<string, string>;
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
	key(index: number): string | null;
	length: number;
}

const createStorage = (): TestStorage => {
	const entries: Record<string, string> = {};
	const storage: TestStorage = {
		get entries() {
			return entries;
		},
		getItem(key) {
			return entries[key] ?? null;
		},
		setItem(key, value) {
			entries[key] = value;
		},
		removeItem(key) {
			delete entries[key];
		},
		key(index) {
			const keys = Object.keys(entries).sort();
			return keys[index] ?? null;
		},
		get length() {
			return Object.keys(entries).length;
		},
	};
	return storage;
};

const makeTempDir = () => mkdtempSync(join(tmpdir(), "graphrefly-ts-storage-"));

const _flushMicrotasks = async (turns = 1) => {
	for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

const _awaitDone = (run: (done: () => void) => void) =>
	new Promise<void>((resolve) => {
		run(resolve);
	});

const bytesToHex = (bytes: Uint8Array) =>
	[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const _sha256Hex = async (bytes: Uint8Array) =>
	bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)));

describe("D82 storage substrate helpers — sub 2", () => {
	it("tieredReadThrough reports all-miss-tier errors as error status", async () => {
		const failures: unknown[] = [];
		const result = await tieredReadThrough({
			key: "all-fail",
			tiers: [
				{
					get: () => Promise.reject(new Error("tier0 failed")),
					set: () => Promise.resolve(),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
				{
					get: () => Promise.reject(new Error("tier1 failed")),
					set: () => Promise.resolve(),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
			],
			onError: (ctx) => {
				if (ctx.stage === "lookup") failures.push(ctx.error);
			},
		});

		expect(result.status).toBe("error");
		expect(result.facts.map((fact) => fact.kind)).toEqual(["error", "error"]);
		expect(failures).toHaveLength(2);
	});

	it("tieredReadThrough reports mixed miss/error no-hit results as error status", async () => {
		const result = await tieredReadThrough({
			key: "partial-fail",
			tiers: [
				{
					get: () => Promise.resolve(undefined),
					set: () => Promise.resolve(),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
				{
					get: () => Promise.reject(new Error("cold failed")),
					set: () => Promise.resolve(),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
			],
		});

		expect(result.status).toBe("error");
		expect(result.value).toBeUndefined();
		expect(result.facts.map((fact) => fact.kind)).toEqual(["miss", "error"]);
	});

	it("tieredReadThrough captures promotion write failures as facts", async () => {
		const errors: unknown[] = [];
		const result = await tieredReadThrough({
			key: "write-fail",
			tiers: [
				{
					get: () => Promise.resolve(undefined),
					set: () => Promise.reject(new Error("promotion failed")),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
				{
					get: () => Promise.resolve({ value: 3 }),
					set: () => Promise.resolve(),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
			],
			promoteTo: [0],
			tierNames: ["hot", "cold"],
			onError: (ctx) => {
				if (ctx.stage === "promotion") {
					errors.push(ctx.error);
				}
			},
		});

		expect(result.status).toBe("hit");
		expect(result.value).toEqual({ value: 3 });
		expect(result.facts.map((fact) => fact.kind)).toEqual(["miss", "hit"]);
		expect(result.promotions).toEqual([
			expect.objectContaining({ tier: { index: 0, name: "hot" }, ok: false }),
		]);
		expect(String(result.promotions[0]?.error)).toContain("promotion failed");
		expect(errors).toHaveLength(1);
	});

	it("tieredReadThrough uses D108 setIfMatch for stale-proof promotion when available", async () => {
		const hot = memoryKv<number>();
		const hotVersioned = requireKvVersioned(hot);
		const hotTier: KvStorageTier<number> = {
			...hot,
			async getVersioned(key) {
				const observed = await hotVersioned.getVersioned(key);
				await hot.set(key, 1);
				return observed;
			},
			setIfMatch: hotVersioned.setIfMatch.bind(hotVersioned),
		};
		const cold = memoryKv<number>();
		await cold.set("k", 7);

		const result = await tieredReadThrough({
			key: "k",
			tiers: [hotTier, cold],
			promoteTo: [0],
		});

		expect(result.status).toBe("hit");
		expect(result.value).toBe(7);
		expect(result.facts.map((fact) => [fact.kind, fact.tier.index])).toEqual([
			["miss", 0],
			["hit", 1],
		]);
		expect(result.promotions).toEqual([{ tier: { index: 0 }, ok: false }]);
		expect(await hot.get("k")).toBe(1);
	});

	it("tieredReadThrough does not bypass a versioned target when generation lookup failed", async () => {
		const calls: string[] = [];
		const errors: string[] = [];
		const hotTier: KvStorageTier<number> = {
			get: () => {
				calls.push("get");
				return Promise.resolve(undefined);
			},
			set: () => {
				calls.push("set");
				throw new Error("plain set must not run");
			},
			getVersioned: () => {
				calls.push("getVersioned");
				throw new Error("versioned read failed");
			},
			setIfMatch: () => {
				calls.push("setIfMatch");
				return Promise.resolve(true);
			},
			delete: () => Promise.resolve(),
			list: () => Promise.resolve([]),
		};
		const cold = memoryKv<number>();
		await cold.set("k", 9);

		const result = await tieredReadThrough({
			key: "k",
			tiers: [hotTier, cold],
			promoteTo: [0],
			onError: (ctx) => {
				errors.push(`${ctx.stage}:${String((ctx.error as Error).message ?? ctx.error)}`);
			},
		});

		expect(result.status).toBe("hit");
		expect(result.value).toBe(9);
		expect(result.facts.map((fact) => [fact.kind, fact.tier.index])).toEqual([
			["error", 0],
			["hit", 1],
		]);
		expect(result.promotions).toEqual([
			expect.objectContaining({
				tier: { index: 0 },
				ok: false,
			}),
		]);
		expect(String(result.promotions[0]?.error)).toContain("not observed with a generation");
		expect(calls).toEqual(["getVersioned"]);
		expect(errors).toEqual([
			"lookup:versioned read failed",
			"promotion:tieredReadThrough: versioned promotion target was not observed with a generation",
		]);
	});

	it("memoryBackend putIfAbsent creates once, preserves bytes, and clones", async () => {
		const backend = memoryBackend();
		const first = new Uint8Array([1, 2, 3]);
		const second = new Uint8Array([9, 9, 9]);

		expect(hasStoragePutIfAbsent(backend)).toBe(true);
		expect(requireStoragePutIfAbsent(backend)).toBe(backend);
		expect(await backend.putIfAbsent("k", first)).toBe(true);
		first[0] = 7;

		expect(await backend.putIfAbsent("k", second)).toBe(false);
		second[1] = 8;
		const stored = await backend.get("k");
		expect([...stored!]).toEqual([1, 2, 3]);
		stored![0] = 6;
		expect([...(await backend.get("k"))!]).toEqual([1, 2, 3]);
	});

	it("memoryBackend supports D108 versioned present and absent observations", async () => {
		const backend = requireStorageVersioned(memoryBackend());

		expect(hasStorageVersioned(backend)).toBe(true);
		const absent = await backend.getVersioned("k");
		expect(absent.kind).toBe("miss");
		expect(await backend.setIfMatch("k", new Uint8Array([1]), absent.generation)).toBe(true);
		expect(await backend.setIfMatch("k", new Uint8Array([2]), absent.generation)).toBe(false);
		expect(await backend.setIfMatch("other", new Uint8Array([9]), absent.generation)).toBe(false);
		expect(await backend.get("k")).toEqual(new Uint8Array([1]));

		const present = await backend.getVersioned("k");
		expect(present.kind).toBe("hit");
		if (present.kind === "hit") {
			present.value[0] = 9;
		}
		expect(await backend.get("k")).toEqual(new Uint8Array([1]));

		await backend.put("k", new Uint8Array([3]));
		expect(await backend.setIfMatch("k", new Uint8Array([4]), present.generation)).toBe(false);
		const fresh = await backend.getVersioned("k");
		expect(await backend.setIfMatch("k", new Uint8Array([4]), fresh.generation)).toBe(true);
		expect(await backend.get("k")).toEqual(new Uint8Array([4]));

		backend.clear();
		expect(await backend.setIfMatch("k", new Uint8Array([5]), fresh.generation)).toBe(false);
	});

	it("webStorageBackend stores hex bytes deterministically, lists by namespace, and rejects malformed data", () => {
		const storage = createStorage();
		const backend = webStorageBackend(storage, { namespace: "web" });

		const raw = new Uint8Array([8, 9, 10]);
		backend.put("cache/key", raw);
		raw[0] = 1;

		expect(storage.entries[storagePhysicalKey("web", "cache/key")]).toBe("08090a");
		expect([...(backend.get("cache/key") ?? new Uint8Array())]).toEqual([8, 9, 10]);
		expect(backend.list("cache")).toEqual(["cache/key"]);
		expect(backend.list("other")).toEqual([]);

		storage.setItem(storagePhysicalKey("web", "bad"), "not-hex");
		expect(() => backend.get("bad")).toThrow(/malformed stored bytes/);
		expect(hasStorageVersioned(backend)).toBe(false);
		expect(() => requireStorageVersioned(backend, "webStorageBackend")).toThrow(
			/webStorageBackend: backend does not support versioned/,
		);
	});

	it("webStorageBackend uses tuple namespace keys and accepts delimiter-like runtime keys", () => {
		const storage = createStorage();

		expect(() => webStorageBackend(storage, { namespace: null as unknown as string })).toThrow(
			/namespace/,
		);

		const backend = webStorageBackend(storage, { namespace: "ns" });
		const root = webStorageBackend(storage);
		root.put("root", new Uint8Array([9]));
		backend.put("bad\u0000key", new Uint8Array([1]));
		expect([...(backend.get("bad\u0000key") ?? new Uint8Array())]).toEqual([1]);
		expect(() => backend.get(1 as unknown as string)).toThrow(/key must be a string/);
		expect(backend.list("bad\u0000")).toEqual(["bad\u0000key"]);
		expect(root.list()).toEqual(["root"]);
		expect(backend.list()).toEqual(["bad\u0000key"]);
		expect(() => backend.list(1 as unknown as string)).toThrow(/list prefix must be a string/);

		storage.setItem(`storage-namespace:${JSON.stringify(["ns", "bad", "key"])}`, "01");
		expect(() => backend.list()).toThrow(/malformed stored key/);
	});

	it("fileBackend persists bytes, lists logical keys, and supports putIfAbsent", async () => {
		const dir = makeTempDir();
		try {
			const backend = fileBackend(dir, { namespace: "ns" });
			const root = fileBackend(dir);
			await root.put("root", new Uint8Array([9]));
			await backend.put("", new Uint8Array([0]));
			await backend.put("a", new Uint8Array([1, 2, 3]));
			await backend.put("ab", new Uint8Array([9, 8, 7]));
			expect(await backend.putIfAbsent?.("a", new Uint8Array([4]))).toBe(false);
			expect(await backend.putIfAbsent?.("c", new Uint8Array([3]))).toBe(true);

			const first = await backend.get("a");
			const second = await backend.get("ab");
			expect(first).toEqual(new Uint8Array([1, 2, 3]));
			expect(second).toEqual(new Uint8Array([9, 8, 7]));

			first![0] = 9;
			expect(await backend.get("a")).toEqual(new Uint8Array([1, 2, 3]));

			const listAll = await backend.list();
			expect(listAll).toEqual(["", "a", "ab", "c"]);
			expect(await backend.list("a")).toEqual(["a", "ab"]);

			await backend.delete("ab");
			expect(await backend.get("ab")).toBeUndefined();
			expect(await backend.list()).toEqual(["", "a", "c"]);
			expect(await root.list()).toEqual(["root"]);
			expect(hasStorageVersioned(backend)).toBe(false);
			expect(() => requireStorageVersioned(backend, "fileBackend")).toThrow(
				/fileBackend: backend does not support versioned/,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fileBackend uses tuple namespace keys and accepts delimiter-like runtime keys", async () => {
		const dir = makeTempDir();
		try {
			expect(() => fileBackend(dir, { namespace: null as unknown as string })).toThrow(/namespace/);

			const backend = fileBackend(dir, { namespace: "ns" });
			await backend.put("bad\u0000key", new Uint8Array([1]));
			expect(await backend.get("bad\u0000key")).toEqual(new Uint8Array([1]));
			expect(() => backend.get(1 as unknown as string)).toThrow(/key must be a string/);
			expect(await backend.list("bad\u0000")).toEqual(["bad\u0000key"]);
			expect(() => backend.list(1 as unknown as string)).toThrow(/list prefix must be a string/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fileBackend rejects unsafe filename extensions", () => {
		const dir = join(tmpdir(), "graphrefly-ts-storage-extension-negative");
		expect(() => fileBackend(dir, { extension: "/../../x" })).toThrow(/extension/);
		expect(() => fileBackend(dir, { extension: "..bin" })).toThrow(/extension/);
		expect(() => fileBackend(dir, { extension: "" })).toThrow(/extension/);
	});

	it("fileKv and fileAppendLog stay passive typed wrappers over fileBackend", async () => {
		const dir = makeTempDir();
		try {
			const kv = fileKv<{ value: string }>(dir, { namespace: "typed" });
			await kv.set("a", { value: "one" });
			expect(await kv.get("a")).toEqual({ value: "one" });
			expect(await kv.list()).toEqual(["a"]);

			const log = fileAppendLog<{ value: string }>(dir, {
				namespace: "typed-log",
				prefix: "events",
			});
			await log.append({ value: "first" });
			await log.append({ value: "second" });
			expect((await log.read()).map((entry) => [entry.seq, entry.value.value])).toEqual([
				[0, "first"],
				[1, "second"],
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("sqliteBackend validates table names before touching optional node:sqlite", () => {
		expect(() => sqliteBackend(":memory:", { tableName: "bad-name" })).toThrow(/tableName/);
		expect(() => sqliteBackend(":memory:", { tableName: "1bad" })).toThrow(/tableName/);
		expect(() => sqliteBackend(":memory:", { namespace: null as unknown as string })).toThrow(
			/namespace/,
		);
	});
});
