/**
 * M5 reactive structures parity — ReactiveLog.
 *
 * Covers append-only log CRUD, ring-buffer cap, trimHead, and snapshot
 * emission semantics. Both impls emit DIRTY→DATA two-phase snapshots on
 * every structural mutation.
 *
 * Rust port reference: `~/src/graphrefly-rs/crates/graphrefly-structures/src/reactive.rs`
 * napi binding: `~/src/graphrefly-rs/crates/graphrefly-bindings-js/src/structures_bindings.rs`
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("M5 ReactiveLog — CRUD parity — $name", (impl) => {
	const hasStructures = () => impl.structures != null;

	test.runIf(hasStructures())("append emits snapshot with new entry", async () => {
		const s = impl.structures!;
		const log = s.reactiveLog<number>();
		const snapshots: unknown[] = [];
		const unsub = await log.node.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) snapshots.push(msg[1]);
		});
		try {
			snapshots.length = 0;
			await log.append(1);
			expect(snapshots.length).toBeGreaterThanOrEqual(1);
			const last = snapshots[snapshots.length - 1] as number[];
			expect(last).toContain(1);
			expect(log.size).toBe(1);
		} finally {
			await unsub();
		}
	});

	test.runIf(hasStructures())("appendMany emits single snapshot", async () => {
		const s = impl.structures!;
		const log = s.reactiveLog<string>();
		const snapshots: unknown[] = [];
		const unsub = await log.node.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) snapshots.push(msg[1]);
		});
		try {
			snapshots.length = 0;
			await log.appendMany(["a", "b", "c"]);
			// Should emit exactly one DATA snapshot for the batch.
			expect(snapshots.length).toBe(1);
			const snap = snapshots[0] as string[];
			expect(snap).toEqual(["a", "b", "c"]);
			expect(log.size).toBe(3);
		} finally {
			await unsub();
		}
	});

	test.runIf(hasStructures())("clear empties the log", async () => {
		const s = impl.structures!;
		const log = s.reactiveLog<number>();
		await log.append(1);
		await log.append(2);
		expect(log.size).toBe(2);
		await log.clear();
		expect(log.size).toBe(0);
	});

	test.runIf(hasStructures())("at() supports positive and negative indices", async () => {
		const s = impl.structures!;
		const log = s.reactiveLog<string>();
		await log.appendMany(["x", "y", "z"]);
		expect(log.at(0)).toBe("x");
		expect(log.at(2)).toBe("z");
		expect(log.at(-1)).toBe("z");
		expect(log.at(-3)).toBe("x");
		expect(log.at(10)).toBeUndefined();
	});

	test.runIf(hasStructures())("trimHead removes first n entries", async () => {
		const s = impl.structures!;
		const log = s.reactiveLog<number>();
		await log.appendMany([10, 20, 30, 40, 50]);
		await log.trimHead(2);
		expect(log.size).toBe(3);
		expect(log.at(0)).toBe(30);
	});
});

describe.each(impls)("M5 ReactiveLog — ring buffer parity — $name", (impl) => {
	const hasStructures = () => impl.structures != null;

	test.runIf(hasStructures())("maxSize caps log length on overflow", async () => {
		const s = impl.structures!;
		const log = s.reactiveLog<number>({ maxSize: 3 });
		await log.appendMany([1, 2, 3, 4, 5]);
		expect(log.size).toBe(3);
		// Oldest entries evicted — last 3 remain.
		expect(log.at(0)).toBe(3);
		expect(log.at(1)).toBe(4);
		expect(log.at(2)).toBe(5);
	});
});
