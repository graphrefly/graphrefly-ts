/**
 * M5 reactive structures parity — ReactiveList.
 *
 * Covers ordered list CRUD: append, insert, pop, clear. ReactiveList
 * supports positional insert/pop (unlike ReactiveLog which is append-only).
 * No maxSize — insert-anywhere semantics make eviction ambiguous.
 *
 * Rust port reference: `~/src/graphrefly-rs/crates/graphrefly-structures/src/reactive.rs`
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("M5 ReactiveList — CRUD parity — $name", (impl) => {
	const hasStructures = () => impl.structures != null;

	test.runIf(hasStructures())("append adds to end", async () => {
		const s = impl.structures!;
		const list = s.reactiveList<number>();
		await list.append(10);
		await list.append(20);
		expect(list.size).toBe(2);
		expect(list.at(0)).toBe(10);
		expect(list.at(1)).toBe(20);
	});

	test.runIf(hasStructures())("insert splices at position", async () => {
		const s = impl.structures!;
		const list = s.reactiveList<string>();
		await list.appendMany(["a", "c"]);
		await list.insert(1, "b");
		expect(list.size).toBe(3);
		expect(list.at(0)).toBe("a");
		expect(list.at(1)).toBe("b");
		expect(list.at(2)).toBe("c");
	});

	test.runIf(hasStructures())("pop removes and returns by index", async () => {
		const s = impl.structures!;
		const list = s.reactiveList<number>();
		await list.appendMany([10, 20, 30]);
		const popped = await list.pop(1);
		expect(popped).toBe(20);
		expect(list.size).toBe(2);
		expect(list.at(0)).toBe(10);
		expect(list.at(1)).toBe(30);
	});

	test.runIf(hasStructures())("pop with negative index removes from end", async () => {
		const s = impl.structures!;
		const list = s.reactiveList<number>();
		await list.appendMany([1, 2, 3]);
		const popped = await list.pop(-1);
		expect(popped).toBe(3);
		expect(list.size).toBe(2);
	});

	test.runIf(hasStructures())("clear empties the list", async () => {
		const s = impl.structures!;
		const list = s.reactiveList<number>();
		await list.appendMany([1, 2, 3]);
		await list.clear();
		expect(list.size).toBe(0);
	});

	test.runIf(hasStructures())("at() supports negative indices", async () => {
		const s = impl.structures!;
		const list = s.reactiveList<string>();
		await list.appendMany(["x", "y", "z"]);
		expect(list.at(-1)).toBe("z");
		expect(list.at(-3)).toBe("x");
		expect(list.at(5)).toBeUndefined();
	});

	test.runIf(hasStructures())("appendMany emits single snapshot", async () => {
		const s = impl.structures!;
		const list = s.reactiveList<number>();
		const snapshots: unknown[] = [];
		const unsub = await list.node.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) snapshots.push(msg[1]);
		});
		try {
			snapshots.length = 0;
			await list.appendMany([1, 2, 3]);
			expect(snapshots.length).toBe(1);
			expect(snapshots[0]).toEqual([1, 2, 3]);
		} finally {
			await unsub();
		}
	});
});
