/**
 * Slice U buffer-operator parity scenarios.
 *
 * Covers: `buffer`, `bufferCount`.
 *
 * Rust port reference:
 * `~/src/graphrefly-rs/crates/graphrefly-operators/src/buffer.rs`
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

// ---------------------------------------------------------------------------
// buffer (notifier-triggered)
// ---------------------------------------------------------------------------

describe.each(impls)("Slice U buffer — buffer parity — $name", (impl) => {
	test("buffer collects values until notifier fires", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const notifier = await impl.node<unknown>([], { name: "notifier" });
		const b = await impl.buffer(src, notifier);

		const seen: number[][] = [];
		const unsub = await b.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number[]);
		});

		try {
			await src.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 2]]);
			await src.down([[impl.DATA, 3]]);

			// Nothing emitted yet (no notifier fire)
			expect(seen).toEqual([]);

			// Notifier fires → flush buffered values
			await notifier.down([[impl.DATA, "flush"]]);
			expect(seen.length).toBe(1);
			expect(seen[0]).toEqual([1, 2, 3]);
		} finally {
			await unsub();
		}
	});
});

// ---------------------------------------------------------------------------
// bufferCount
// ---------------------------------------------------------------------------

describe.each(impls)("Slice U buffer — bufferCount parity — $name", (impl) => {
	test("bufferCount emits when count items collected", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const b = await impl.bufferCount(src, 3);

		const seen: number[][] = [];
		const unsub = await b.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number[]);
		});

		try {
			await src.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 2]]);
			expect(seen).toEqual([]); // not yet

			await src.down([[impl.DATA, 3]]);
			expect(seen.length).toBe(1);
			expect(seen[0]).toEqual([1, 2, 3]);

			// Next batch
			await src.down([[impl.DATA, 4]]);
			await src.down([[impl.DATA, 5]]);
			await src.down([[impl.DATA, 6]]);
			expect(seen.length).toBe(2);
			expect(seen[1]).toEqual([4, 5, 6]);
		} finally {
			await unsub();
		}
	});
});
