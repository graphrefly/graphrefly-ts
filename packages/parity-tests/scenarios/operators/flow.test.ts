/**
 * Flow operator parity scenarios (Slice C-3, D024).
 *
 * Covers count / predicate / terminal-aware gates: `take`, `skip`,
 * `takeWhile`, `last`, `first`, `find`, `elementAt`. `takeUntil` is
 * intentionally NOT in this slice — Rust port defers it to a later
 * subscription-managed slice (D020 category B).
 *
 * Rust port reference:
 * `~/src/graphrefly-rs/crates/graphrefly-operators/src/flow.rs` (Slice
 * C-3, landed 2026-05-06 per
 * `~/src/graphrefly-rs/docs/migration-status.md`).
 *
 * Rules / decisions covered:
 * - D024 take(count) emits first N then self-completes
 * - D027 take(0) self-completes on first fire with no Data
 * - D018 skip full-window settles via Resolved
 * - D029 takeWhile reuses predicate_each; first-false → self-complete
 * - R5.7-style last buffers latest, emits on upstream COMPLETE
 * - last with default emits default on empty stream
 * - first/find/elementAt sugar compositions
 *
 * Until `@graphrefly/native` publishes `rustImpl` in `impls/rust.ts`,
 * these scenarios run against `legacyImpl` only. When `rustImpl` flips
 * non-null, divergences fail loud — the rust arm uses the same
 * `impl.<name>` surface.
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("flow — take parity — $name", (impl) => {
	test("take(2) emits first 2 DATA then self-completes", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const t = await impl.take(src, 2);

		const seenData: number[] = [];
		let sawComplete = false;
		const unsub = await t.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
				if (msg[0] === impl.COMPLETE) sawComplete = true;
			}
		});

		try {
			seenData.length = 0;
			sawComplete = false;
			await src.down([[impl.DATA, 10]]);
			await src.down([[impl.DATA, 20]]);
			await src.down([[impl.DATA, 30]]); // post-complete: must not surface

			expect(seenData).toEqual([10, 20]);
			expect(sawComplete).toBe(true);
		} finally {
			await unsub();
		}
	});

	test("take(0) self-completes on first fire with no Data (D027)", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const t = await impl.take(src, 0);

		const seenData: number[] = [];
		let sawComplete = false;
		const unsub = await t.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
				if (msg[0] === impl.COMPLETE) sawComplete = true;
			}
		});

		try {
			seenData.length = 0;
			sawComplete = false;
			await src.down([[impl.DATA, 99]]);

			expect(seenData).toEqual([]);
			expect(sawComplete).toBe(true);
		} finally {
			await unsub();
		}
	});

	test("upstream COMPLETE before count reached propagates COMPLETE", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const t = await impl.take(src, 5);

		const seenData: number[] = [];
		let sawComplete = false;
		const unsub = await t.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
				if (msg[0] === impl.COMPLETE) sawComplete = true;
			}
		});

		try {
			seenData.length = 0;
			sawComplete = false;
			await src.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 2]]);
			await src.down([[impl.COMPLETE]]);

			expect(seenData).toEqual([1, 2]);
			expect(sawComplete).toBe(true);
		} finally {
			await unsub();
		}
	});
});

describe.each(impls)("flow — skip parity — $name", (impl) => {
	test("skip(2) drops first 2 DATA then forwards the rest", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const s = await impl.skip(src, 2);

		const seen: number[] = [];
		const unsub = await s.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			seen.length = 0;
			await src.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 2]]);
			await src.down([[impl.DATA, 3]]);
			await src.down([[impl.DATA, 4]]);

			expect(seen).toEqual([3, 4]);
		} finally {
			await unsub();
		}
	});

	test("skip(3) full-window swallow doesn't leak DATA (D018 settle)", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const s = await impl.skip(src, 3);

		const seenTiers: symbol[] = [];
		const unsub = await s.subscribe((msgs) => {
			for (const msg of msgs) seenTiers.push(msg[0] as symbol);
		});

		try {
			seenTiers.length = 0;
			await src.down([[impl.DATA, 1]]); // still in skip window

			// No DATA leaked — implementations may use D018 RESOLVED
			// settle (Rust) or implicit batch closure (TS); both are
			// fine. The contract: subscribers see no DATA from the
			// dropped wave.
			expect(seenTiers).not.toContain(impl.DATA);
		} finally {
			await unsub();
		}
	});
});

describe.each(impls)("flow — takeWhile parity — $name", (impl) => {
	test("emits while predicate holds; on first false → COMPLETE", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const t = await impl.takeWhile(src, (x: number) => x < 10);

		const seenData: number[] = [];
		let sawComplete = false;
		const unsub = await t.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
				if (msg[0] === impl.COMPLETE) sawComplete = true;
			}
		});

		try {
			seenData.length = 0;
			sawComplete = false;
			await src.down([[impl.DATA, 3]]);
			await src.down([[impl.DATA, 7]]);
			await src.down([[impl.DATA, 12]]); // first false → complete here, no Data
			await src.down([[impl.DATA, 1]]); // post-complete: ignored

			expect(seenData).toEqual([3, 7]);
			expect(sawComplete).toBe(true);
		} finally {
			await unsub();
		}
	});
});

describe.each(impls)("flow — last parity — $name", (impl) => {
	test("buffers latest, emits Data(latest) + Complete on upstream COMPLETE", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const n = await impl.last(src);

		const seenData: number[] = [];
		let sawComplete = false;
		const unsub = await n.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
				if (msg[0] === impl.COMPLETE) sawComplete = true;
			}
		});

		try {
			seenData.length = 0;
			sawComplete = false;
			await src.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 2]]);
			await src.down([[impl.DATA, 3]]);

			// No emit yet — buffering silently.
			expect(seenData).toEqual([]);

			await src.down([[impl.COMPLETE]]);

			expect(seenData).toEqual([3]);
			expect(sawComplete).toBe(true);
		} finally {
			await unsub();
		}
	});

	test("last with default emits default when no DATA arrived", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const n = await impl.last(src, { defaultValue: 42 });

		const seenData: number[] = [];
		let sawComplete = false;
		const unsub = await n.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
				if (msg[0] === impl.COMPLETE) sawComplete = true;
			}
		});

		try {
			seenData.length = 0;
			sawComplete = false;
			await src.down([[impl.COMPLETE]]);

			expect(seenData).toEqual([42]);
			expect(sawComplete).toBe(true);
		} finally {
			await unsub();
		}
	});
});

describe.each(impls)("flow — first / find / elementAt sugar parity — $name", (impl) => {
	test("first(src) emits the first DATA then COMPLETE (= take(src, 1))", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const n = await impl.first(src);

		const seenData: number[] = [];
		let sawComplete = false;
		const unsub = await n.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
				if (msg[0] === impl.COMPLETE) sawComplete = true;
			}
		});

		try {
			seenData.length = 0;
			sawComplete = false;
			await src.down([[impl.DATA, 7]]);
			await src.down([[impl.DATA, 8]]); // ignored — already complete

			expect(seenData).toEqual([7]);
			expect(sawComplete).toBe(true);
		} finally {
			await unsub();
		}
	});

	test("find(src, predicate) emits first matching DATA then COMPLETE", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const n = await impl.find(src, (x: number) => x > 5);

		const seenData: number[] = [];
		let sawComplete = false;
		const unsub = await n.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
				if (msg[0] === impl.COMPLETE) sawComplete = true;
			}
		});

		try {
			seenData.length = 0;
			sawComplete = false;
			await src.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 3]]);
			await src.down([[impl.DATA, 8]]); // first > 5 → emit + complete
			await src.down([[impl.DATA, 9]]); // ignored

			expect(seenData).toEqual([8]);
			expect(sawComplete).toBe(true);
		} finally {
			await unsub();
		}
	});

	test("elementAt(src, index) emits the indexed DATA then COMPLETE", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const n = await impl.elementAt(src, 2);

		const seenData: number[] = [];
		let sawComplete = false;
		const unsub = await n.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
				if (msg[0] === impl.COMPLETE) sawComplete = true;
			}
		});

		try {
			seenData.length = 0;
			sawComplete = false;
			await src.down([[impl.DATA, 10]]);
			await src.down([[impl.DATA, 20]]);
			await src.down([[impl.DATA, 30]]); // index 2 → emit + complete
			await src.down([[impl.DATA, 40]]); // ignored

			expect(seenData).toEqual([30]);
			expect(sawComplete).toBe(true);
		} finally {
			await unsub();
		}
	});
});
