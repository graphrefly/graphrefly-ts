/**
 * M3 Slice C-2 combinator operator parity scenarios.
 *
 * Covers: `combine` (combineLatest), `withLatestFrom`, `merge`.
 *
 * Rust port reference: `~/src/graphrefly-rs/crates/graphrefly-operators/src/combine.rs`
 * (Slice C-2, landed 2026-05-06 per `~/src/graphrefly-rs/docs/migration-status.md`).
 *
 * Rules covered:
 * - R1.3.4.b combine/merge: COMPLETE when all deps complete
 * - Phase 10.5 withLatestFrom: fire-on-primary-only, gate both deps
 * - D022 merge: forward DATA verbatim, no transformation
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

// =====================================================================
// combine (combineLatest)
// =====================================================================

describe.each(impls)("R1.3.4.b combine — any-dep-fire emits tuple — $name", (impl) => {
	test("combine emits tuple on any dep fire", async () => {
		const a = await impl.node<number>([], { initial: 1, name: "a" });
		const b = await impl.node<number>([], { initial: 2, name: "b" });
		const c = await impl.combine([a, b]);

		const seen: unknown[] = [];
		const unsub = await c.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1]);
		});

		try {
			// Push-on-subscribe: both have values → tuple emitted.
			expect(seen.length).toBeGreaterThanOrEqual(1);
			const lastTuple = seen[seen.length - 1] as readonly unknown[];
			expect(lastTuple).toEqual([1, 2]);

			// Emit on a → new tuple.
			seen.length = 0;
			await a.down([[impl.DATA, 10]]);
			expect(seen.length).toBe(1);
			expect(seen[0]).toEqual([10, 2]);

			// Emit on b → new tuple with latest a.
			seen.length = 0;
			await b.down([[impl.DATA, 20]]);
			expect(seen.length).toBe(1);
			expect(seen[0]).toEqual([10, 20]);
		} finally {
			await unsub();
		}
	});

	test("combine gate holds until all deps fire", async () => {
		const a = await impl.node<number>([], { name: "a" });
		const b = await impl.node<number>([], { name: "b" });
		const c = await impl.combine([a, b]);

		const seen: unknown[] = [];
		const unsub = await c.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1]);
		});

		try {
			expect(seen).toHaveLength(0);

			await a.down([[impl.DATA, 1]]);
			expect(seen).toHaveLength(0);

			await b.down([[impl.DATA, 2]]);
			expect(seen).toHaveLength(1);
			expect(seen[0]).toEqual([1, 2]);
		} finally {
			await unsub();
		}
	});
});

// =====================================================================
// withLatestFrom
// =====================================================================

describe.each(impls)("Phase 10.5 withLatestFrom — fire-on-primary-only — $name", (impl) => {
	test("emits only when primary fires", async () => {
		const primary = await impl.node<number>([], { initial: 1, name: "primary" });
		const secondary = await impl.node<number>([], {
			initial: 2,
			name: "secondary",
		});
		const wlf = await impl.withLatestFrom(primary, secondary);

		const seen: unknown[] = [];
		const unsub = await wlf.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1]);
		});

		try {
			// Push-on-subscribe delivers initial pair.
			expect(seen.length).toBeGreaterThanOrEqual(1);

			// Emit on secondary only → no DATA.
			seen.length = 0;
			await secondary.down([[impl.DATA, 20]]);
			expect(seen).toHaveLength(0);

			// Emit on primary → pair with latest secondary.
			await primary.down([[impl.DATA, 10]]);
			expect(seen).toHaveLength(1);
			expect(seen[0]).toEqual([10, 20]);
		} finally {
			await unsub();
		}
	});

	test("gate holds until both deps deliver", async () => {
		const primary = await impl.node<number>([], { name: "primary" });
		const secondary = await impl.node<number>([], { name: "secondary" });
		const wlf = await impl.withLatestFrom(primary, secondary);

		const seen: unknown[] = [];
		const unsub = await wlf.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1]);
		});

		try {
			expect(seen).toHaveLength(0);

			await primary.down([[impl.DATA, 1]]);
			expect(seen).toHaveLength(0);

			// Secondary delivery releases the gate (both deps now have
			// values). First-fire emits regardless of which dep triggered.
			await secondary.down([[impl.DATA, 2]]);
			expect(seen).toHaveLength(1);
			expect(seen[0]).toEqual([1, 2]);

			// Subsequent secondary-only fire → no emission.
			seen.length = 0;
			await secondary.down([[impl.DATA, 20]]);
			expect(seen).toHaveLength(0);

			// Primary fires → pair with latest secondary.
			await primary.down([[impl.DATA, 10]]);
			expect(seen).toHaveLength(1);
			expect(seen[0]).toEqual([10, 20]);
		} finally {
			await unsub();
		}
	});
});

// =====================================================================
// merge
// =====================================================================

describe.each(impls)("D022 merge — forward DATA verbatim — $name", (impl) => {
	test("merge forwards all dep DATA", async () => {
		const a = await impl.node<number>([], { initial: 1, name: "a" });
		const b = await impl.node<number>([], { initial: 2, name: "b" });
		const m = await impl.merge([a, b]);

		const seen: unknown[] = [];
		const unsub = await m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1]);
		});

		try {
			// Push-on-subscribe: both source values forwarded.
			expect(seen).toContain(1);
			expect(seen).toContain(2);

			// Emit on a → forwarded.
			seen.length = 0;
			await a.down([[impl.DATA, 10]]);
			expect(seen).toContain(10);

			// Emit on b → forwarded.
			seen.length = 0;
			await b.down([[impl.DATA, 20]]);
			expect(seen).toContain(20);
		} finally {
			await unsub();
		}
	});

	test("merge completes when all deps complete", async () => {
		const a = await impl.node<number>([], { initial: 1, name: "a" });
		const b = await impl.node<number>([], { initial: 2, name: "b" });
		const m = await impl.merge([a, b]);

		let completed = false;
		const unsub = await m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.COMPLETE) completed = true;
		});

		try {
			await a.down([[impl.COMPLETE]]);
			expect(completed).toBe(false);

			await b.down([[impl.COMPLETE]]);
			expect(completed).toBe(true);
		} finally {
			await unsub();
		}
	});
});
