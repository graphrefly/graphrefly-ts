/**
 * M1 dispatcher parity — `set_deps` dynamic dependency replacement.
 *
 * D5 (post-rustImpl-activation parity cleanup): the M1 milestone-coverage
 * table claims a `set_deps` dep-replacement surface. As of 2026-05-20
 * the substrate primitive is **public on the `Impl` contract** —
 * `ImplNode.setDeps` / `.addDep` / `.removeDep` (the Phase-13.8 rewire
 * trio, promoted from `_setDeps`/`_addDep`/`_removeDep`; semantics
 * TLA+-verified `wave_protocol_rewire_MC`, per `project_rewire_gap`).
 *
 * **Arm scope — cross-arm (D263/D264 LANDED 2026-05-20).** Both
 * `@graphrefly/pure-ts` and `@graphrefly/native` expose the trio.
 * The native side reroutes `impl.map` through a generic TSFN-backed
 * `register_user_derived` napi (D264 P1) so the operator-fn rebind +
 * `Core::set_deps` dep-shape change compose JS-side without a
 * substrate-trait widening. Scope is confined to `impl.map` on the
 * rust arm (per D264 — the only operator the failing scenario uses;
 * other operators keep their OperatorOp dispatch and have no fn-rebind
 * hook). Tracked: docs/cross-track-ledger.md §1 (D5 row — LANDED).
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("M1 set_deps parity — $name", (impl) => {
	test("setDeps rewires a dependent from dep A → dep B (old edge stops driving it)", async () => {
		const a = await impl.node<number>([], { initial: 1, name: "a" });
		const b = await impl.node<number>([], { initial: 100, name: "b" });
		const dep = await impl.map(a, (x: number) => x + 1); // a=1 → 2

		const seen: Array<readonly [symbol, unknown]> = [];
		const unsub = await dep.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
		});
		try {
			expect(dep.cache).toBe(2);

			// Rewire dep: A → B, new fn over the new single-dep shape.
			seen.length = 0;
			await dep.setDeps([b], (data) => [((data[0]?.[0] as number) ?? 0) + 1]);
			// Subscribe-handshake on B drives a recompute: b=100 → 101.
			expect(dep.cache).toBe(101);

			// The old A edge no longer drives dep.
			seen.length = 0;
			await a.down([[impl.DATA, 999]]);
			expect(dep.cache).toBe(101);
			expect(seen.filter(([t]) => t === impl.DATA)).toEqual([]);

			// The new B edge drives dep, DIRTY ahead of recomputed DATA.
			seen.length = 0;
			await b.down([[impl.DATA, 7]]);
			const dirtyIdx = seen.findIndex(([t]) => t === impl.DIRTY);
			const dataIdx = seen.findIndex(([t, v]) => t === impl.DATA && v === 8);
			expect(dirtyIdx).toBeGreaterThanOrEqual(0);
			expect(dataIdx).toBeGreaterThanOrEqual(0);
			expect(dirtyIdx).toBeLessThan(dataIdx);
			expect(dep.cache).toBe(8);
		} finally {
			await unsub();
		}
	});

	test("addDep wires a new edge in; removeDep wires it back out (fn re-paired each time)", async () => {
		const a = await impl.node<number>([], { initial: 10, name: "a" });
		const b = await impl.node<number>([], { initial: 20, name: "b" });
		const dep = await impl.map(a, (x: number) => x); // a=10 → 10

		const unsub = await dep.subscribe(() => {});
		try {
			expect(dep.cache).toBe(10);

			// Append b. Substrate passes per-wave `data` (a non-emitting
			// dep's slot is empty; latest lives in prevData, not exposed
			// on the thin Impl fn) — so the fn forwards whichever dep
			// drove this wave. addDep's subscribe-handshake on b (a
			// state node with cached 20) drives the first recompute.
			const fwd = (data: ReadonlyArray<ReadonlyArray<unknown>>) => {
				const av = data[0]?.[0] as number | undefined;
				const bv = data[1]?.[0] as number | undefined;
				return [bv ?? av];
			};
			const idx = await dep.addDep(b, fwd);
			expect(idx).toBe(1);
			expect(dep.cache).toBe(20); // b just delivered via handshake

			// a still drives the (now 2-dep) node.
			await a.down([[impl.DATA, 5]]);
			expect(dep.cache).toBe(5);

			// b also drives it — the new edge is live.
			await b.down([[impl.DATA, 99]]);
			expect(dep.cache).toBe(99);

			// Remove b — fn re-declared for the back-to-1-dep shape.
			await dep.removeDep(b, (data) => [data[0]?.[0] as number]);
			// a still drives dep post-removal.
			await a.down([[impl.DATA, 7]]);
			expect(dep.cache).toBe(7);

			// b no longer drives dep (edge gone).
			await b.down([[impl.DATA, 999]]);
			expect(dep.cache).toBe(7);
		} finally {
			await unsub();
		}
	});

	test("setDeps rejects a self-dependency", async () => {
		const a = await impl.node<number>([], { initial: 1, name: "a" });
		const dep = await impl.map(a, (x: number) => x + 1);
		const unsub = await dep.subscribe(() => {});
		try {
			await expect(dep.setDeps([dep], (data) => [data[0][0] as number])).rejects.toThrow(
				/self-dependency/,
			);
			// Topology unchanged — original edge still live.
			await a.down([[impl.DATA, 9]]);
			expect(dep.cache).toBe(10);
		} finally {
			await unsub();
		}
	});
});
