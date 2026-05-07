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
 * these scenarios run against `legacyImpl` only. When `rustImpl` flips
 * non-null, divergences fail loud.
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

// =====================================================================
// switchMap — cancel-on-new
// =====================================================================

describe.each(impls)("R8.L2 switchMap parity — $name", (impl) => {
	test("switchMap cancels prior inner on new outer DATA", () => {
		const outer = impl.node<number>([], { name: "outer" });
		const inner1 = impl.node<number>([], { name: "inner1" });
		const inner2 = impl.node<number>([], { name: "inner2" });
		const inners = [inner1, inner2];
		const m = impl.switchMap<number, number>(outer, () => inners.shift()!);

		const seen: number[] = [];
		const unsub = m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			outer.down([[impl.DATA, 1]]); // -> inner1
			inner1.down([[impl.DATA, 100]]);
			expect(seen).toEqual([100]);

			outer.down([[impl.DATA, 2]]); // -> cancel inner1, subscribe inner2
			inner1.down([[impl.DATA, 999]]); // ignored
			inner2.down([[impl.DATA, 200]]);
			expect(seen).toEqual([100, 200]);
		} finally {
			unsub();
		}
	});

	test("switchMap completes when outer completes with no active inner", () => {
		const outer = impl.node<number>([], { name: "outer" });
		const m = impl.switchMap<number, number>(outer, () => impl.node<number>([], {}));

		let completed = false;
		const unsub = m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.COMPLETE) completed = true;
		});

		try {
			outer.down([[impl.COMPLETE]]);
			expect(completed).toBe(true);
		} finally {
			unsub();
		}
	});
});

// =====================================================================
// exhaustMap — drop-while-active
// =====================================================================

describe.each(impls)("R8.L2 exhaustMap parity — $name", (impl) => {
	test("exhaustMap drops outer DATA while inner is active", () => {
		const outer = impl.node<number>([], { name: "outer" });
		const inner1 = impl.node<number>([], { name: "inner1" });
		let projectCount = 0;
		const m = impl.exhaustMap<number, number>(outer, () => {
			projectCount++;
			return inner1;
		});

		const seen: number[] = [];
		const unsub = m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			outer.down([[impl.DATA, 1]]); // -> inner1 active
			outer.down([[impl.DATA, 2]]); // dropped
			outer.down([[impl.DATA, 3]]); // dropped
			expect(projectCount).toBe(1);

			inner1.down([[impl.DATA, 100]]);
			expect(seen).toEqual([100]);
		} finally {
			unsub();
		}
	});

	test("exhaustMap accepts new outer DATA after inner completes", () => {
		const outer = impl.node<number>([], { name: "outer" });
		const inner1 = impl.node<number>([], { name: "inner1" });
		const inner2 = impl.node<number>([], { name: "inner2" });
		const inners = [inner1, inner2];
		const m = impl.exhaustMap<number, number>(outer, () => inners.shift()!);

		const seen: number[] = [];
		const unsub = m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			outer.down([[impl.DATA, 1]]);
			inner1.down([[impl.DATA, 100]]);
			inner1.down([[impl.COMPLETE]]); // window closed
			outer.down([[impl.DATA, 2]]); // -> inner2
			inner2.down([[impl.DATA, 200]]);
			expect(seen).toEqual([100, 200]);
		} finally {
			unsub();
		}
	});
});

// =====================================================================
// concatMap — sequential queue
// =====================================================================

describe.each(impls)("R8.L2 concatMap parity — $name", (impl) => {
	test("concatMap processes inners sequentially", () => {
		const outer = impl.node<number>([], { name: "outer" });
		const inner1 = impl.node<number>([], { name: "inner1" });
		const inner2 = impl.node<number>([], { name: "inner2" });
		const inner3 = impl.node<number>([], { name: "inner3" });
		const inners = [inner1, inner2, inner3];
		let projectCount = 0;
		const m = impl.concatMap<number, number>(outer, () => {
			projectCount++;
			return inners.shift()!;
		});

		const seen: number[] = [];
		const unsub = m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			outer.down([[impl.DATA, 1]]);
			outer.down([[impl.DATA, 2]]);
			outer.down([[impl.DATA, 3]]);
			expect(projectCount).toBe(1); // 2/3 queued

			inner1.down([[impl.DATA, 10]]);
			inner1.down([[impl.COMPLETE]]);
			expect(projectCount).toBe(2);

			inner2.down([[impl.DATA, 20]]);
			inner2.down([[impl.COMPLETE]]);
			expect(projectCount).toBe(3);

			inner3.down([[impl.DATA, 30]]);
			expect(seen).toEqual([10, 20, 30]);
		} finally {
			unsub();
		}
	});

	test("concatMap completes after outer + queued inners drain", () => {
		const outer = impl.node<number>([], { name: "outer" });
		const inner1 = impl.node<number>([], { name: "inner1" });
		const inner2 = impl.node<number>([], { name: "inner2" });
		const inners = [inner1, inner2];
		const m = impl.concatMap<number, number>(outer, () => inners.shift()!);

		let completed = false;
		const unsub = m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.COMPLETE) completed = true;
		});

		try {
			outer.down([[impl.DATA, 1]]);
			outer.down([[impl.DATA, 2]]);
			outer.down([[impl.COMPLETE]]);
			inner1.down([[impl.COMPLETE]]);
			inner2.down([[impl.COMPLETE]]);
			expect(completed).toBe(true);
		} finally {
			unsub();
		}
	});
});

// =====================================================================
// mergeMap — parallel up to concurrency cap
// =====================================================================

describe.each(impls)("R8.L2 mergeMap parity — $name", (impl) => {
	test("mergeMap unbounded spawns all inners in parallel", () => {
		const outer = impl.node<number>([], { name: "outer" });
		const inner1 = impl.node<number>([], { name: "inner1" });
		const inner2 = impl.node<number>([], { name: "inner2" });
		const inner3 = impl.node<number>([], { name: "inner3" });
		const inners = [inner1, inner2, inner3];
		const m = impl.mergeMap<number, number>(outer, () => inners.shift()!);

		const seen: number[] = [];
		const unsub = m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			outer.down([[impl.DATA, 1]]);
			outer.down([[impl.DATA, 2]]);
			outer.down([[impl.DATA, 3]]);

			inner1.down([[impl.DATA, 10]]);
			inner2.down([[impl.DATA, 20]]);
			inner3.down([[impl.DATA, 30]]);

			expect([...seen].sort((a, b) => a - b)).toEqual([10, 20, 30]);
		} finally {
			unsub();
		}
	});

	test("mergeMap with concurrency=2 caps active inners", () => {
		const outer = impl.node<number>([], { name: "outer" });
		const inner1 = impl.node<number>([], { name: "inner1" });
		const inner2 = impl.node<number>([], { name: "inner2" });
		const inner3 = impl.node<number>([], { name: "inner3" });
		const inners = [inner1, inner2, inner3];
		let projectCount = 0;
		const m = impl.mergeMap<number, number>(
			outer,
			() => {
				projectCount++;
				return inners.shift()!;
			},
			{ concurrent: 2 },
		);

		const unsub = m.subscribe(() => {});

		try {
			outer.down([[impl.DATA, 1]]);
			outer.down([[impl.DATA, 2]]);
			outer.down([[impl.DATA, 3]]);
			expect(projectCount).toBe(2); // third buffered

			inner1.down([[impl.COMPLETE]]);
			expect(projectCount).toBe(3); // third drains
		} finally {
			unsub();
		}
	});

	test("mergeMap completes after outer + all inners complete", () => {
		const outer = impl.node<number>([], { name: "outer" });
		const inner1 = impl.node<number>([], { name: "inner1" });
		const inner2 = impl.node<number>([], { name: "inner2" });
		const inners = [inner1, inner2];
		const m = impl.mergeMap<number, number>(outer, () => inners.shift()!);

		let completed = false;
		const unsub = m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.COMPLETE) completed = true;
		});

		try {
			outer.down([[impl.DATA, 1]]);
			outer.down([[impl.DATA, 2]]);
			outer.down([[impl.COMPLETE]]);
			expect(completed).toBe(false);

			inner1.down([[impl.COMPLETE]]);
			expect(completed).toBe(false);

			inner2.down([[impl.COMPLETE]]);
			expect(completed).toBe(true);
		} finally {
			unsub();
		}
	});
});
