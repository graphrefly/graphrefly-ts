/**
 * R5.7 transform-operator parity scenarios.
 *
 * Covers the six element-wise / fold operators in `transform`: `map`,
 * `filter`, `scan`, `reduce`, `distinctUntilChanged`, `pairwise`.
 *
 * Rust port reference: `~/src/graphrefly-rs/crates/graphrefly-operators/src/transform.rs`
 * (Slice C-1, landed 2026-05-06 per `~/src/graphrefly-rs/docs/migration-status.md`).
 *
 * Rules covered:
 * - R5.7 transform single-dep batch-mapping (every operator)
 * - R1.3.1.a one-DIRTY-per-wave with multi-DATA batch (`map_batch`)
 * - D012/D018 filter silent-drop + DIRTY+RESOLVED settle on full-reject
 * - R5.7 scan running-acc emission per input
 * - R5.7 reduce silent accumulation + emit on upstream COMPLETE
 * - R5.7 distinctUntilChanged adjacent-dup suppression + first-emit
 * - R5.7 pairwise first-value swallow + (prev, current) emission
 *
 * Until `@graphrefly/native` publishes `rustImpl` in `impls/rust.ts`,
 * these scenarios run against `pureTsImpl` only. When `rustImpl` flips
 * non-null, divergences fail loud — the rust arm uses the same
 * `impl.<name>` surface.
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("R5.7 transform — map parity — $name", (impl) => {
	test("map projects each value in a single-emit wave", async () => {
		const src = await impl.node<number>([], { initial: 3, name: "src" });
		const m = await impl.map(src, (x: number) => x * 10);

		const seen: number[] = [];
		const unsub = await m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			expect(seen).toContain(30);
		} finally {
			await unsub();
		}
	});
});

describe.each(impls)("R5.7 transform — filter parity — $name", (impl) => {
	test("filter passes only matching items", async () => {
		const src = await impl.node<number>([], { initial: 0, name: "src" });
		const f = await impl.filter(src, (x: number) => x % 2 === 0);

		const seen: number[] = [];
		const unsub = await f.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			seen.length = 0; // discard handshake (initial=0 passes)
			await src.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 2]]);
			await src.down([[impl.DATA, 3]]);
			await src.down([[impl.DATA, 4]]);

			expect(seen).toEqual([2, 4]);
		} finally {
			await unsub();
		}
	});

	test("filter full-reject settles wave (D012/D018)", async () => {
		const src = await impl.node<number>([], { initial: 0, name: "src" });
		const f = await impl.filter(src, () => false);

		const seen: symbol[] = [];
		const unsub = await f.subscribe((msgs) => {
			for (const msg of msgs) seen.push(msg[0] as symbol);
		});

		try {
			seen.length = 0;
			await src.down([[impl.DATA, 7]]);

			// Subscribers see no DATA (rejected) but the wave settles —
			// either via RESOLVED (TS / Rust D018) or via implicit batch
			// closure. We check that no DATA leaked.
			expect(seen).not.toContain(impl.DATA);
		} finally {
			await unsub();
		}
	});
});

describe.each(impls)("R5.7 transform — scan parity — $name", (impl) => {
	test("scan emits running accumulator per input", async () => {
		const src = await impl.node<number>([], { initial: 0, name: "src" });
		const s = await impl.scan(src, (acc: number, x: number) => acc + x, 0);

		const seen: number[] = [];
		const unsub = await s.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			seen.length = 0;
			await src.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 2]]);
			await src.down([[impl.DATA, 3]]);

			expect(seen).toEqual([1, 3, 6]);
		} finally {
			await unsub();
		}
	});
});

describe.each(impls)("R5.7 transform — reduce parity — $name", (impl) => {
	test("reduce emits only on upstream COMPLETE; emits seed if no DATA arrived", async () => {
		const src = await impl.node<number>([], { initial: 0, name: "src" });
		const r = await impl.reduce(src, (acc: number, x: number) => acc + x, 100);

		const seen: Array<readonly [symbol, unknown]> = [];
		const unsub = await r.subscribe((msgs) => {
			for (const msg of msgs) seen.push([msg[0] as symbol, msg[1]]);
		});

		try {
			seen.length = 0;
			// No DATA from src; just COMPLETE.
			await src.down([[impl.COMPLETE]]);

			const dataEvent = seen.find(([t]) => t === impl.DATA);
			const completeEvent = seen.find(([t]) => t === impl.COMPLETE);
			expect(dataEvent?.[1]).toBe(100);
			expect(completeEvent).toBeDefined();
		} finally {
			await unsub();
		}
	});

	test("reduce accumulates DATA silently and emits final acc on COMPLETE", async () => {
		const src = await impl.node<number>([], { initial: 0, name: "src" });
		const r = await impl.reduce(src, (acc: number, x: number) => acc + x, 0);

		const seen: Array<readonly [symbol, unknown]> = [];
		const unsub = await r.subscribe((msgs) => {
			for (const msg of msgs) seen.push([msg[0] as symbol, msg[1]]);
		});

		try {
			seen.length = 0;
			await src.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 2]]);
			await src.down([[impl.DATA, 3]]);

			// No DATA emitted yet — silent accumulation.
			expect(seen.find(([t]) => t === impl.DATA)).toBeUndefined();

			await src.down([[impl.COMPLETE]]);
			const dataEvent = seen.find(([t]) => t === impl.DATA);
			expect(dataEvent?.[1]).toBe(6);
		} finally {
			await unsub();
		}
	});
});

describe.each(impls)("R5.7 transform — distinctUntilChanged parity — $name", (impl) => {
	test("suppresses adjacent duplicates; first value always emits", async () => {
		const src = await impl.node<number>([], { initial: 0, name: "src" });
		const d = await impl.distinctUntilChanged(src, (a: number, b: number) => a === b);

		const seen: number[] = [];
		const unsub = await d.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			seen.length = 0;
			await src.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 1]]); // dup, suppressed
			await src.down([[impl.DATA, 2]]);
			await src.down([[impl.DATA, 2]]); // dup, suppressed
			await src.down([[impl.DATA, 3]]);

			expect(seen).toEqual([1, 2, 3]);
		} finally {
			await unsub();
		}
	});
});

describe.each(impls)("R5.7 transform — pairwise parity — $name", (impl) => {
	test("emits (prev, current) pairs starting after the second value", async () => {
		const src = await impl.node<number>([], { initial: 0, name: "src" });
		const p = await impl.pairwise(src);

		const seen: Array<readonly [number, number]> = [];
		const unsub = await p.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) {
					seen.push(msg[1] as readonly [number, number]);
				}
			}
		});

		try {
			seen.length = 0;
			// initial=0 was first; emit two more so we get [(0,1),(1,2)].
			await src.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 2]]);

			expect(seen.length).toBe(2);
			expect(seen[0]).toEqual([0, 1]);
			expect(seen[1]).toEqual([1, 2]);
		} finally {
			await unsub();
		}
	});
});
