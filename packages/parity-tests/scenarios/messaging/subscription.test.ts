/**
 * F18 (D203 native-ship) reactive structures parity — `ReactiveLog`
 * `view` / `scan` / `attach`.
 *
 * These are the substrate primitives the messaging `subscription`
 * pattern composes: a cursor-based `view` is a durable subscription's
 * replay window; `scan` is a running aggregate over the topic log;
 * `attach` is the topic-bridge ingress. Rust core logic shipped in M5;
 * this scenario is authored in-slice as the receipt for the F18 napi
 * binding (D196 exemption per D203).
 *
 * Rust core: `ReactiveLog::{view,scan,attach}` (reactive.rs).
 * napi: `BenchReactiveLog::{view_tail,view_slice,view_from_cursor,
 * scan,attach}` (structures_bindings.rs).
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("F18 ReactiveLog view/scan/attach parity — $name", (impl) => {
	const hasStructures = () => impl.structures != null;

	test.runIf(hasStructures())("view(tail) emits the last-n window", async () => {
		const s = impl.structures!;
		const log = s.reactiveLog<number>();
		const view = await log.view({ kind: "tail", n: 2 });
		const snaps: number[][] = [];
		const unsub = await view.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === impl.DATA) snaps.push(m[1] as number[]);
		});
		try {
			await log.append(1);
			await log.append(2);
			await log.append(3);
			expect(snaps[snaps.length - 1]).toEqual([2, 3]);
		} finally {
			await unsub();
		}
	});

	test.runIf(hasStructures())("view(slice) emits [start,stop)", async () => {
		const s = impl.structures!;
		const log = s.reactiveLog<number>();
		await log.appendMany([10, 20, 30, 40]);
		const view = await log.view({ kind: "slice", start: 1, stop: 3 });
		const snaps: number[][] = [];
		const unsub = await view.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === impl.DATA) snaps.push(m[1] as number[]);
		});
		try {
			// Push-on-subscribe replay (spec §2.2): the view was created
			// AFTER the appends, so the late subscriber must receive the
			// cached `[20,30]` window immediately — exercises the Rust
			// synchronous handshake-sink path, not just steady state.
			expect(snaps.length).toBeGreaterThanOrEqual(1);
			expect(snaps[0]).toEqual([20, 30]);
			// Slice [1,3) is stable across a tail append; still re-emits.
			await log.append(50);
			expect(snaps[snaps.length - 1]).toEqual([20, 30]);
		} finally {
			await unsub();
		}
	});

	test.runIf(hasStructures())(
		"view(fromCursor) replays from the cursor position onward",
		async () => {
			const s = impl.structures!;
			const log = s.reactiveLog<number>();
			const cursor = await impl.node<number>([], { name: "cursor", initial: 0 });
			await log.appendMany([1, 2, 3, 4, 5]);
			const view = await log.view({ kind: "fromCursor", cursor });
			const snaps: number[][] = [];
			const unsub = await view.subscribe((msgs) => {
				for (const m of msgs) if (m[0] === impl.DATA) snaps.push(m[1] as number[]);
			});
			try {
				await cursor.down([[impl.DATA, 3]]);
				expect(snaps[snaps.length - 1]).toEqual([4, 5]);
			} finally {
				await unsub();
			}
		},
	);

	test.runIf(hasStructures())("scan accumulates over appends", async () => {
		const s = impl.structures!;
		const log = s.reactiveLog<number>();
		const sum = await log.scan<number>(0, (acc, v) => acc + v);
		const seen: number[] = [];
		const unsub = await sum.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === impl.DATA) seen.push(m[1] as number);
		});
		try {
			await log.append(5);
			await log.append(7);
			await log.append(3);
			expect(seen[seen.length - 1]).toBe(15);
		} finally {
			await unsub();
		}
	});

	test.runIf(hasStructures())("attach appends upstream DATA into the log", async () => {
		const s = impl.structures!;
		const log = s.reactiveLog<number>();
		const upstream = await impl.node<number>([], { name: "up" });
		const off = await log.attach(upstream);
		try {
			await upstream.down([[impl.DATA, 100]]);
			await upstream.down([[impl.DATA, 200]]);
			expect(log.size).toBe(2);
			expect(log.at(0)).toBe(100);
			expect(log.at(1)).toBe(200);
		} finally {
			await off();
		}
	});
});
