/**
 * Higher-order operator parity scenarios (M3 Slice E, D044).
 *
 * Covers `switchMap` / `exhaustMap` / `concatMap` / `mergeMap` from
 * `extra/operators/higher-order.ts`. Each is a producer-shape op that
 * projects each outer DATA to an inner Node and subscribes to it; the
 * four flavors differ in how they handle a new outer DATA while a
 * prior inner is still active (cancel / drop / queue / parallel).
 *
 * Rust port reference:
 * `~/src/graphrefly-rs/crates/graphrefly-operators/src/higher_order.rs`
 * (Slice E, landed 2026-05-07 per
 * `~/src/graphrefly-rs/docs/migration-status.md`).
 *
 * Until `@graphrefly/native` publishes `rustImpl` in `impls/rust.ts`,
 * these scenarios run against `pureTsImpl` only. When `rustImpl` flips
 * non-null, divergences fail loud.
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

// =====================================================================
// switchMap — cancel-on-new
// =====================================================================

describe.each(impls)("R8.L2 switchMap parity — $name", (impl) => {
	test("switchMap cancels prior inner on new outer DATA", async () => {
		const outer = await impl.node<number>([], { name: "outer" });
		const inner1 = await impl.node<number>([], { name: "inner1" });
		const inner2 = await impl.node<number>([], { name: "inner2" });
		const inners = [inner1, inner2];
		const m = await impl.switchMap<number, number>(outer, () => inners.shift()!);

		const seen: number[] = [];
		const unsub = await m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			await outer.down([[impl.DATA, 1]]); // -> inner1
			await inner1.down([[impl.DATA, 100]]);
			expect(seen).toEqual([100]);

			await outer.down([[impl.DATA, 2]]); // -> cancel inner1, subscribe inner2
			await inner1.down([[impl.DATA, 999]]); // ignored
			await inner2.down([[impl.DATA, 200]]);
			expect(seen).toEqual([100, 200]);
		} finally {
			await unsub();
		}
	});

	test("switchMap completes when outer completes with no active inner", async () => {
		const outer = await impl.node<number>([], { name: "outer" });
		// Inner factory needs to be sync (project fn returns ImplNode synchronously);
		// pre-construct the inner outside the projector closure.
		const innerProto = await impl.node<number>([], {});
		const m = await impl.switchMap<number, number>(outer, () => innerProto);

		let completed = false;
		const unsub = await m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.COMPLETE) completed = true;
		});

		try {
			await outer.down([[impl.COMPLETE]]);
			expect(completed).toBe(true);
		} finally {
			await unsub();
		}
	});
});

// =====================================================================
// exhaustMap — drop-while-active
// =====================================================================

describe.each(impls)("R8.L2 exhaustMap parity — $name", (impl) => {
	test("exhaustMap drops outer DATA while inner is active", async () => {
		const outer = await impl.node<number>([], { name: "outer" });
		const inner1 = await impl.node<number>([], { name: "inner1" });
		let projectCount = 0;
		const m = await impl.exhaustMap<number, number>(outer, () => {
			projectCount++;
			return inner1;
		});

		const seen: number[] = [];
		const unsub = await m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			await outer.down([[impl.DATA, 1]]); // -> inner1 active
			await outer.down([[impl.DATA, 2]]); // dropped
			await outer.down([[impl.DATA, 3]]); // dropped
			expect(projectCount).toBe(1);

			await inner1.down([[impl.DATA, 100]]);
			expect(seen).toEqual([100]);
		} finally {
			await unsub();
		}
	});

	test("exhaustMap accepts new outer DATA after inner completes", async () => {
		const outer = await impl.node<number>([], { name: "outer" });
		const inner1 = await impl.node<number>([], { name: "inner1" });
		const inner2 = await impl.node<number>([], { name: "inner2" });
		const inners = [inner1, inner2];
		const m = await impl.exhaustMap<number, number>(outer, () => inners.shift()!);

		const seen: number[] = [];
		const unsub = await m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			await outer.down([[impl.DATA, 1]]);
			await inner1.down([[impl.DATA, 100]]);
			await inner1.down([[impl.COMPLETE]]); // window closed
			await outer.down([[impl.DATA, 2]]); // -> inner2
			await inner2.down([[impl.DATA, 200]]);
			expect(seen).toEqual([100, 200]);
		} finally {
			await unsub();
		}
	});
});

// =====================================================================
// concatMap — sequential queue
// =====================================================================

describe.each(impls)("R8.L2 concatMap parity — $name", (impl) => {
	test("concatMap processes inners sequentially", async () => {
		const outer = await impl.node<number>([], { name: "outer" });
		const inner1 = await impl.node<number>([], { name: "inner1" });
		const inner2 = await impl.node<number>([], { name: "inner2" });
		const inner3 = await impl.node<number>([], { name: "inner3" });
		const inners = [inner1, inner2, inner3];
		let projectCount = 0;
		const m = await impl.concatMap<number, number>(outer, () => {
			projectCount++;
			return inners.shift()!;
		});

		const seen: number[] = [];
		const unsub = await m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			await outer.down([[impl.DATA, 1]]);
			await outer.down([[impl.DATA, 2]]);
			await outer.down([[impl.DATA, 3]]);
			expect(projectCount).toBe(1); // 2/3 queued

			await inner1.down([[impl.DATA, 10]]);
			await inner1.down([[impl.COMPLETE]]);
			expect(projectCount).toBe(2);

			await inner2.down([[impl.DATA, 20]]);
			await inner2.down([[impl.COMPLETE]]);
			expect(projectCount).toBe(3);

			await inner3.down([[impl.DATA, 30]]);
			expect(seen).toEqual([10, 20, 30]);
		} finally {
			await unsub();
		}
	});

	test("concatMap completes after outer + queued inners drain", async () => {
		const outer = await impl.node<number>([], { name: "outer" });
		const inner1 = await impl.node<number>([], { name: "inner1" });
		const inner2 = await impl.node<number>([], { name: "inner2" });
		const inners = [inner1, inner2];
		const m = await impl.concatMap<number, number>(outer, () => inners.shift()!);

		let completed = false;
		const unsub = await m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.COMPLETE) completed = true;
		});

		try {
			await outer.down([[impl.DATA, 1]]);
			await outer.down([[impl.DATA, 2]]);
			await outer.down([[impl.COMPLETE]]);
			await inner1.down([[impl.COMPLETE]]);
			await inner2.down([[impl.COMPLETE]]);
			expect(completed).toBe(true);
		} finally {
			await unsub();
		}
	});
});

// =====================================================================
// mergeMap — parallel up to concurrency cap
// =====================================================================

describe.each(impls)("R8.L2 mergeMap parity — $name", (impl) => {
	test("mergeMap unbounded spawns all inners in parallel", async () => {
		const outer = await impl.node<number>([], { name: "outer" });
		const inner1 = await impl.node<number>([], { name: "inner1" });
		const inner2 = await impl.node<number>([], { name: "inner2" });
		const inner3 = await impl.node<number>([], { name: "inner3" });
		const inners = [inner1, inner2, inner3];
		const m = await impl.mergeMap<number, number>(outer, () => inners.shift()!);

		const seen: number[] = [];
		const unsub = await m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			await outer.down([[impl.DATA, 1]]);
			await outer.down([[impl.DATA, 2]]);
			await outer.down([[impl.DATA, 3]]);

			await inner1.down([[impl.DATA, 10]]);
			await inner2.down([[impl.DATA, 20]]);
			await inner3.down([[impl.DATA, 30]]);

			expect([...seen].sort((a, b) => a - b)).toEqual([10, 20, 30]);
		} finally {
			await unsub();
		}
	});

	test("mergeMap with concurrency=2 caps active inners", async () => {
		const outer = await impl.node<number>([], { name: "outer" });
		const inner1 = await impl.node<number>([], { name: "inner1" });
		const inner2 = await impl.node<number>([], { name: "inner2" });
		const inner3 = await impl.node<number>([], { name: "inner3" });
		const inners = [inner1, inner2, inner3];
		let projectCount = 0;
		const m = await impl.mergeMap<number, number>(
			outer,
			() => {
				projectCount++;
				return inners.shift()!;
			},
			2,
		);

		const unsub = await m.subscribe(() => {});

		try {
			await outer.down([[impl.DATA, 1]]);
			await outer.down([[impl.DATA, 2]]);
			await outer.down([[impl.DATA, 3]]);
			expect(projectCount).toBe(2); // third buffered

			await inner1.down([[impl.COMPLETE]]);
			expect(projectCount).toBe(3); // third drains
		} finally {
			await unsub();
		}
	});

	test("mergeMap completes after outer + all inners complete", async () => {
		const outer = await impl.node<number>([], { name: "outer" });
		const inner1 = await impl.node<number>([], { name: "inner1" });
		const inner2 = await impl.node<number>([], { name: "inner2" });
		const inners = [inner1, inner2];
		const m = await impl.mergeMap<number, number>(outer, () => inners.shift()!);

		let completed = false;
		const unsub = await m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.COMPLETE) completed = true;
		});

		try {
			await outer.down([[impl.DATA, 1]]);
			await outer.down([[impl.DATA, 2]]);
			await outer.down([[impl.COMPLETE]]);
			expect(completed).toBe(false);

			await inner1.down([[impl.COMPLETE]]);
			expect(completed).toBe(false);

			await inner2.down([[impl.COMPLETE]]);
			expect(completed).toBe(true);
		} finally {
			await unsub();
		}
	});
});
