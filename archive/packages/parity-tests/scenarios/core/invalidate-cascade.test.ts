/**
 * M1 dispatcher parity — propagation cascade + INVALIDATE idempotency
 * (spec §1.4 / §2.2).
 *
 * D5 (post-rustImpl-activation parity cleanup). Pins two shared
 * contracts both impls MUST agree on, discovered while authoring (the
 * naive "INVALIDATE always re-fires DIRTY downstream" model is wrong —
 * BOTH arms correctly *absorb* an invalidate whose recompute is
 * value-unchanged):
 *
 *  1. **Positive cascade:** a genuine upstream value change drives
 *     DIRTY ahead of the recomputed DATA through a 2-hop operator chain
 *     (two-phase push).
 *  2. **INVALIDATE clears, never resurrects:** invalidating a
 *     deps-bearing node clears the transitive dependent's cache to the
 *     sentinel (`undefined`) and delivers NO fresh DATA — it does not
 *     eagerly recompute/resurrect a value (spec §1.4; verified identical
 *     across pure-ts and rust-via-napi).
 *
 * Built on operator factories (`impl.map`) + a standalone source —
 * `graph.derived(arbitrary fn)` is intentionally NOT used (rejected by
 * the native `BenchGraph` surface).
 *
 * Rust port reference: Core propagation + INVALIDATE idempotency
 * (Slice M1 / Slice C-1).
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("M1 cascade parity — $name", (impl) => {
	test("upstream value change cascades DIRTY → fresh DATA (two-phase)", async () => {
		const src = await impl.node<number>([], { initial: 1, name: "src" });
		const b = await impl.map(src, (x: number) => x * 2);
		const c = await impl.map(b, (x: number) => x + 1);

		const cSeen: Array<readonly [symbol, unknown]> = [];
		const unsub = await c.subscribe((msgs) => {
			for (const m of msgs) cSeen.push([m[0] as symbol, m[1]]);
		});
		try {
			expect(c.cache).toBe(3); // src=1 → b=2 → c=3

			cSeen.length = 0;
			await src.down([[impl.DATA, 5]]); // src=5 → b=10 → c=11

			const dirtyIdx = cSeen.findIndex(([t]) => t === impl.DIRTY);
			const dataIdx = cSeen.findIndex(([t, v]) => t === impl.DATA && v === 11);
			expect(dirtyIdx).toBeGreaterThanOrEqual(0);
			expect(dataIdx).toBeGreaterThanOrEqual(0);
			// DIRTY must lead the recomputed DATA.
			expect(dirtyIdx).toBeLessThan(dataIdx);
			expect(c.cache).toBe(11);
		} finally {
			await unsub();
		}
	});

	test("invalidate(deps-bearing node) clears downstream cache, delivers no fresh DATA", async () => {
		const src = await impl.node<number>([], { initial: 5, name: "src" });
		const b = await impl.map(src, (x: number) => x * 2);
		const c = await impl.map(b, (x: number) => x + 1);

		const cData: unknown[] = [];
		const unsub = await c.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === impl.DATA) cData.push(m[1]);
		});
		try {
			expect(c.cache).toBe(11); // src=5 → b=10 → c=11

			cData.length = 0;
			await b.invalidate();

			// INVALIDATE clears the dependent's cache to sentinel and
			// does NOT eagerly re-emit a recomputed value.
			expect(cData).toEqual([]);
			expect(c.cache).toBeUndefined();
		} finally {
			await unsub();
		}
	});
});
