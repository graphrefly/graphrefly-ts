/**
 * Slice 3e/3f cold-source parity scenarios.
 *
 * Covers: `fromIter`, `of`, `empty`, `throwError`.
 *
 * Rust port reference:
 * `~/src/graphrefly-rs/crates/graphrefly-operators/src/source.rs`
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

// ---------------------------------------------------------------------------
// fromIter
// ---------------------------------------------------------------------------

describe.each(impls)("Slice 3e sources — fromIter parity — $name", (impl) => {
	test("fromIter emits each value then completes", async () => {
		const src = await impl.fromIter([10, 20, 30]);

		const seen: number[] = [];
		let completed = false;
		const unsub = await src.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seen.push(msg[1] as number);
				if (msg[0] === impl.COMPLETE) completed = true;
			}
		});

		try {
			expect(seen).toEqual([10, 20, 30]);
			expect(completed).toBe(true);
		} finally {
			await unsub();
		}
	});
});

// ---------------------------------------------------------------------------
// of
// ---------------------------------------------------------------------------

describe.each(impls)("Slice 3e sources — of parity — $name", (impl) => {
	test("of emits values then completes (same as fromIter)", async () => {
		const src = await impl.of(["a", "b", "c"]);

		const seen: string[] = [];
		let completed = false;
		const unsub = await src.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seen.push(msg[1] as string);
				if (msg[0] === impl.COMPLETE) completed = true;
			}
		});

		try {
			expect(seen).toEqual(["a", "b", "c"]);
			expect(completed).toBe(true);
		} finally {
			await unsub();
		}
	});
});

// ---------------------------------------------------------------------------
// empty
// ---------------------------------------------------------------------------

describe.each(impls)("Slice 3f sources — empty parity — $name", (impl) => {
	test("empty completes immediately with no DATA", async () => {
		const src = await impl.empty<number>();

		const seen: unknown[] = [];
		let completed = false;
		const unsub = await src.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seen.push(msg[1]);
				if (msg[0] === impl.COMPLETE) completed = true;
			}
		});

		try {
			expect(seen).toEqual([]);
			expect(completed).toBe(true);
		} finally {
			await unsub();
		}
	});
});

// ---------------------------------------------------------------------------
// throwError
// ---------------------------------------------------------------------------

describe.each(impls)("Slice 3f sources — throwError parity — $name", (impl) => {
	test("throwError emits ERROR immediately with no DATA", async () => {
		const src = await impl.throwError<number>("kaboom");

		const seen: unknown[] = [];
		const errors: unknown[] = [];
		const unsub = await src.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seen.push(msg[1]);
				if (msg[0] === impl.ERROR) errors.push(msg[1]);
			}
		});

		try {
			expect(seen).toEqual([]);
			expect(errors).toContain("kaboom");
		} finally {
			await unsub();
		}
	});
});
