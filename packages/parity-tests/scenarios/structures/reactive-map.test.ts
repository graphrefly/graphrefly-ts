/**
 * M5 reactive structures parity — ReactiveMap.
 *
 * Covers key-value map CRUD: set, get, has, delete, clear.
 * Advanced features: LRU eviction under maxSize cap.
 *
 * TTL and retention policy are TS-only features (require timer substrate
 * not wired in the napi binding); they run against pureTsImpl only.
 *
 * Rust port reference: `~/src/graphrefly-rs/crates/graphrefly-structures/src/reactive.rs`
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("M5 ReactiveMap — CRUD parity — $name", (impl) => {
	const hasStructures = () => impl.structures != null;

	test.runIf(hasStructures())("set + get + has", async () => {
		const s = impl.structures!;
		const map = s.reactiveMap<string, number>();
		await map.set("a", 1);
		await map.set("b", 2);
		expect(map.has("a")).toBe(true);
		expect(map.get("a")).toBe(1);
		expect(map.get("b")).toBe(2);
		expect(map.has("c")).toBe(false);
		expect(map.get("c")).toBeUndefined();
	});

	test.runIf(hasStructures())("set overwrites existing key", async () => {
		const s = impl.structures!;
		const map = s.reactiveMap<string, number>();
		await map.set("x", 10);
		await map.set("x", 20);
		expect(map.get("x")).toBe(20);
		expect(map.size).toBe(1);
	});

	test.runIf(hasStructures())("delete removes key", async () => {
		const s = impl.structures!;
		const map = s.reactiveMap<string, number>();
		await map.set("a", 1);
		await map.set("b", 2);
		await map.delete("a");
		expect(map.has("a")).toBe(false);
		expect(map.size).toBe(1);
	});

	test.runIf(hasStructures())("delete nonexistent is no-op", async () => {
		const s = impl.structures!;
		const map = s.reactiveMap<string, number>();
		await map.set("a", 1);
		const snapshots: unknown[] = [];
		const unsub = await map.node.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) snapshots.push(msg[1]);
		});
		try {
			snapshots.length = 0;
			await map.delete("nonexistent");
			// No emission for nonexistent key delete.
			expect(snapshots.length).toBe(0);
		} finally {
			await unsub();
		}
	});

	test.runIf(hasStructures())("clear empties the map", async () => {
		const s = impl.structures!;
		const map = s.reactiveMap<string, number>();
		await map.set("a", 1);
		await map.set("b", 2);
		await map.clear();
		expect(map.size).toBe(0);
		expect(map.has("a")).toBe(false);
	});

	test.runIf(hasStructures())("set emits snapshot with new entry", async () => {
		const s = impl.structures!;
		const map = s.reactiveMap<string, number>();
		const snapshots: unknown[] = [];
		const unsub = await map.node.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) snapshots.push(msg[1]);
		});
		try {
			snapshots.length = 0;
			await map.set("k", 42);
			expect(snapshots.length).toBeGreaterThanOrEqual(1);
			expect(map.size).toBe(1);
		} finally {
			await unsub();
		}
	});
});

describe.each(impls)("M5 ReactiveMap — LRU parity — $name", (impl) => {
	const hasStructures = () => impl.structures != null;

	test.runIf(hasStructures())("maxSize evicts least-recently-used on overflow", async () => {
		const s = impl.structures!;
		const map = s.reactiveMap<string, number>({ maxSize: 2 });
		await map.set("a", 1);
		await map.set("b", 2);
		await map.set("c", 3); // should evict "a"
		expect(map.size).toBe(2);
		expect(map.has("a")).toBe(false);
		expect(map.has("b")).toBe(true);
		expect(map.has("c")).toBe(true);
	});
});
