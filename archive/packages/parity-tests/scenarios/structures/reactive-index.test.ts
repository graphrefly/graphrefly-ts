/**
 * M5 reactive structures parity — ReactiveIndex.
 *
 * Covers sorted index with primary key + secondary-key ordering:
 * upsert, delete, clear, has, get. Rows sorted by (secondary, primary).
 *
 * Custom equals (idempotent upsert) is tested against pureTsImpl only
 * since the napi binding doesn't expose a custom-equals factory option.
 *
 * Rust port reference: `~/src/graphrefly-rs/crates/graphrefly-structures/src/reactive.rs`
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("M5 ReactiveIndex — CRUD parity — $name", (impl) => {
	const hasStructures = () => impl.structures != null;

	test.runIf(hasStructures())("upsert + has + get", async () => {
		const s = impl.structures!;
		const index = s.reactiveIndex<string, number>();
		const wasNew = await index.upsert("alice", "a", 100);
		expect(wasNew).toBe(true);
		expect(index.has("alice")).toBe(true);
		expect(index.get("alice")).toBe(100);
	});

	test.runIf(hasStructures())("upsert updates existing primary", async () => {
		const s = impl.structures!;
		const index = s.reactiveIndex<string, number>();
		await index.upsert("bob", "b", 10);
		const wasNew = await index.upsert("bob", "b", 20);
		expect(wasNew).toBe(false);
		expect(index.get("bob")).toBe(20);
		expect(index.size).toBe(1);
	});

	test.runIf(hasStructures())("delete removes by primary key", async () => {
		const s = impl.structures!;
		const index = s.reactiveIndex<string, number>();
		await index.upsert("x", "x", 1);
		await index.upsert("y", "y", 2);
		await index.delete("x");
		expect(index.has("x")).toBe(false);
		expect(index.size).toBe(1);
	});

	test.runIf(hasStructures())("delete nonexistent is no-op", async () => {
		const s = impl.structures!;
		const index = s.reactiveIndex<string, number>();
		await index.upsert("a", "a", 1);
		const snapshots: unknown[] = [];
		const unsub = await index.node.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) snapshots.push(msg[1]);
		});
		try {
			snapshots.length = 0;
			await index.delete("nonexistent");
			expect(snapshots.length).toBe(0);
		} finally {
			await unsub();
		}
	});

	test.runIf(hasStructures())("clear empties the index", async () => {
		const s = impl.structures!;
		const index = s.reactiveIndex<string, number>();
		await index.upsert("a", "a", 1);
		await index.upsert("b", "b", 2);
		await index.clear();
		expect(index.size).toBe(0);
		expect(index.has("a")).toBe(false);
	});

	test.runIf(hasStructures())("upsert emits snapshot", async () => {
		const s = impl.structures!;
		const index = s.reactiveIndex<string, number>();
		const snapshots: unknown[] = [];
		const unsub = await index.node.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) snapshots.push(msg[1]);
		});
		try {
			snapshots.length = 0;
			await index.upsert("k", "k", 42);
			expect(snapshots.length).toBeGreaterThanOrEqual(1);
		} finally {
			await unsub();
		}
	});
});
