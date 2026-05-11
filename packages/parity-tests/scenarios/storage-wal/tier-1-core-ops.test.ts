/**
 * M4.F Tier 1 parity scenarios — core tier operations.
 *
 * Snapshot save/load round-trip, KV CRUD, append-log buffering, rollback,
 * compactEvery, debounce config. All ops test the `StorageImpl` sub-interface
 * across both impls.
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("M4.F Tier 1 — core tier ops — $name", (impl) => {
	const hasStorage = () => impl.storage != null;

	// ── Snapshot tier ───────────────────────────────────────────────────

	describe("snapshot tier", () => {
		test.runIf(hasStorage())("save + flush + load round-trips a value", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.snapshotTier(backend, { name: "snap" });
			tier.save({ x: 1 });
			tier.flush();
			const loaded = tier.load();
			expect(loaded).toEqual({ x: 1 });
		});

		test.runIf(hasStorage())("last-write-wins: multiple saves before flush", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.snapshotTier(backend, { name: "snap" });
			tier.save({ x: 1 });
			tier.save({ x: 2 });
			tier.flush();
			expect(tier.load()).toEqual({ x: 2 });
		});

		test.runIf(hasStorage())("rollback discards pending writes", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			// debounceMs > 0 buffers writes so rollback has something to discard
			const tier = s.snapshotTier(backend, { name: "snap", debounceMs: 999 });
			tier.save({ x: 1 });
			tier.flush();
			tier.save({ x: 2 });
			tier.rollback();
			expect(tier.load()).toEqual({ x: 1 });
		});

		test.runIf(hasStorage())("name getter matches construction", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.snapshotTier(backend, { name: "my-snap" });
			expect(tier.name).toBe("my-snap");
		});

		test.runIf(hasStorage())("load returns undefined before any save", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.snapshotTier(backend, { name: "empty" });
			expect(tier.load()).toBeUndefined();
		});
	});

	// ── KV tier ─────────────────────────────────────────────────────────

	describe("kv tier", () => {
		test.runIf(hasStorage())("save + flush + load round-trips by key", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.kvTier(backend, { name: "kv" });
			tier.save("a", { v: 10 });
			tier.save("b", { v: 20 });
			tier.flush();
			expect(tier.load("a")).toEqual({ v: 10 });
			expect(tier.load("b")).toEqual({ v: 20 });
			expect(tier.load("c")).toBeUndefined();
		});

		test.runIf(hasStorage())("delete removes a key", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.kvTier(backend, { name: "kv" });
			tier.save("a", { v: 1 });
			tier.flush();
			tier.delete("a");
			tier.flush();
			expect(tier.load("a")).toBeUndefined();
		});

		test.runIf(hasStorage())("list returns keys with prefix", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.kvTier(backend, { name: "kv" });
			tier.save("ns/a", 1);
			tier.save("ns/b", 2);
			tier.save("other/c", 3);
			tier.flush();
			const keys = tier.list("ns/");
			expect(keys.sort()).toEqual(["ns/a", "ns/b"]);
		});

		test.runIf(hasStorage())("rollback discards pending writes", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.kvTier(backend, { name: "kv", debounceMs: 999 });
			tier.save("a", 1);
			tier.flush();
			tier.save("a", 2);
			tier.rollback();
			expect(tier.load("a")).toBe(1);
		});
	});

	// ── Append-log tier ─────────────────────────────────────────────────

	describe("append-log tier", () => {
		test.runIf(hasStorage())("appendEntries + flush + loadEntries round-trips", async () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.appendLogTier(backend, { name: "log" });
			await tier.appendEntries([{ a: 1 }, { a: 2 }]);
			tier.flush();
			const entries = await tier.loadEntries();
			expect(entries).toEqual([{ a: 1 }, { a: 2 }]);
		});

		test.runIf(hasStorage())("multiple appends accumulate", async () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			// Use debounce to buffer both appends, then flush once
			const tier = s.appendLogTier(backend, { name: "log", debounceMs: 999 });
			tier.appendEntries([{ a: 1 }]);
			tier.appendEntries([{ a: 2 }]);
			await tier.flush();
			const entries = await tier.loadEntries();
			expect(entries).toEqual([{ a: 1 }, { a: 2 }]);
		});

		test.runIf(hasStorage())("rollback discards pending appends", async () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.appendLogTier(backend, { name: "log", debounceMs: 999 });
			await tier.appendEntries([{ a: 1 }]);
			tier.flush();
			await tier.appendEntries([{ a: 2 }]);
			tier.rollback();
			const entries = await tier.loadEntries();
			expect(entries).toEqual([{ a: 1 }]);
		});
	});

	// ── Memory backend ──────────────────────────────────────────────────

	describe("memory backend", () => {
		test.runIf(hasStorage())("readRaw returns undefined for absent key", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			expect(backend.readRaw("nonexistent")).toBeUndefined();
		});

		test.runIf(hasStorage())("list returns empty for no matches", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			expect(backend.list("none/")).toEqual([]);
		});

		test.runIf(hasStorage())("readRaw sees bytes written by tier flush", () => {
			const s = impl.storage!;
			const backend = s.memoryBackend();
			const tier = s.kvTier(backend, { name: "kv" });
			tier.save("k", { hello: "world" });
			tier.flush();
			const raw = backend.readRaw("k");
			expect(raw).toBeDefined();
			// Should be valid JSON
			expect(() => JSON.parse(raw!)).not.toThrow();
		});
	});
});
