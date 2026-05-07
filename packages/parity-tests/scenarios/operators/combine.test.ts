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

describe.each(impls)(
	"R1.3.4.b combine — any-dep-fire emits tuple — $name",
	(impl) => {
		test("combine emits tuple on any dep fire", () => {
			const a = impl.node<number>([], { initial: 1, name: "a" });
			const b = impl.node<number>([], { initial: 2, name: "b" });
			const c = impl.combine(a, b);

			const seen: unknown[] = [];
			const unsub = c.subscribe((msgs) => {
				for (const msg of msgs)
					if (msg[0] === impl.DATA) seen.push(msg[1]);
			});

			try {
				// Push-on-subscribe: both have values → tuple emitted.
				expect(seen.length).toBeGreaterThanOrEqual(1);
				const lastTuple = seen[seen.length - 1] as readonly unknown[];
				expect(lastTuple).toEqual([1, 2]);

				// Emit on a → new tuple.
				seen.length = 0;
				a.down([[impl.DATA, 10]]);
				expect(seen.length).toBe(1);
				expect(seen[0]).toEqual([10, 2]);

				// Emit on b → new tuple with latest a.
				seen.length = 0;
				b.down([[impl.DATA, 20]]);
				expect(seen.length).toBe(1);
				expect(seen[0]).toEqual([10, 20]);
			} finally {
				unsub();
			}
		});

		test("combine gate holds until all deps fire", () => {
			const a = impl.node<number>([], { name: "a" });
			const b = impl.node<number>([], { name: "b" });
			const c = impl.combine(a, b);

			const seen: unknown[] = [];
			const unsub = c.subscribe((msgs) => {
				for (const msg of msgs)
					if (msg[0] === impl.DATA) seen.push(msg[1]);
			});

			try {
				expect(seen).toHaveLength(0);

				a.down([[impl.DATA, 1]]);
				expect(seen).toHaveLength(0);

				b.down([[impl.DATA, 2]]);
				expect(seen).toHaveLength(1);
				expect(seen[0]).toEqual([1, 2]);
			} finally {
				unsub();
			}
		});
	},
);

// =====================================================================
// withLatestFrom
// =====================================================================

describe.each(impls)(
	"Phase 10.5 withLatestFrom — fire-on-primary-only — $name",
	(impl) => {
		test("emits only when primary fires", () => {
			const primary = impl.node<number>([], { initial: 1, name: "primary" });
			const secondary = impl.node<number>([], {
				initial: 2,
				name: "secondary",
			});
			const wlf = impl.withLatestFrom(primary, secondary);

			const seen: unknown[] = [];
			const unsub = wlf.subscribe((msgs) => {
				for (const msg of msgs)
					if (msg[0] === impl.DATA) seen.push(msg[1]);
			});

			try {
				// Push-on-subscribe delivers initial pair.
				expect(seen.length).toBeGreaterThanOrEqual(1);

				// Emit on secondary only → no DATA.
				seen.length = 0;
				secondary.down([[impl.DATA, 20]]);
				expect(seen).toHaveLength(0);

				// Emit on primary → pair with latest secondary.
				primary.down([[impl.DATA, 10]]);
				expect(seen).toHaveLength(1);
				expect(seen[0]).toEqual([10, 20]);
			} finally {
				unsub();
			}
		});

		test("gate holds until both deps deliver", () => {
			const primary = impl.node<number>([], { name: "primary" });
			const secondary = impl.node<number>([], { name: "secondary" });
			const wlf = impl.withLatestFrom(primary, secondary);

			const seen: unknown[] = [];
			const unsub = wlf.subscribe((msgs) => {
				for (const msg of msgs)
					if (msg[0] === impl.DATA) seen.push(msg[1]);
			});

			try {
				expect(seen).toHaveLength(0);

				primary.down([[impl.DATA, 1]]);
				expect(seen).toHaveLength(0);

				// Secondary delivery releases the gate (both deps now have
				// values). First-fire emits regardless of which dep triggered.
				secondary.down([[impl.DATA, 2]]);
				expect(seen).toHaveLength(1);
				expect(seen[0]).toEqual([1, 2]);

				// Subsequent secondary-only fire → no emission.
				seen.length = 0;
				secondary.down([[impl.DATA, 20]]);
				expect(seen).toHaveLength(0);

				// Primary fires → pair with latest secondary.
				primary.down([[impl.DATA, 10]]);
				expect(seen).toHaveLength(1);
				expect(seen[0]).toEqual([10, 20]);
			} finally {
				unsub();
			}
		});
	},
);

// =====================================================================
// merge
// =====================================================================

describe.each(impls)("D022 merge — forward DATA verbatim — $name", (impl) => {
	test("merge forwards all dep DATA", () => {
		const a = impl.node<number>([], { initial: 1, name: "a" });
		const b = impl.node<number>([], { initial: 2, name: "b" });
		const m = impl.merge(a, b);

		const seen: unknown[] = [];
		const unsub = m.subscribe((msgs) => {
			for (const msg of msgs)
				if (msg[0] === impl.DATA) seen.push(msg[1]);
		});

		try {
			// Push-on-subscribe: both source values forwarded.
			expect(seen).toContain(1);
			expect(seen).toContain(2);

			// Emit on a → forwarded.
			seen.length = 0;
			a.down([[impl.DATA, 10]]);
			expect(seen).toContain(10);

			// Emit on b → forwarded.
			seen.length = 0;
			b.down([[impl.DATA, 20]]);
			expect(seen).toContain(20);
		} finally {
			unsub();
		}
	});

	test("merge completes when all deps complete", () => {
		const a = impl.node<number>([], { initial: 1, name: "a" });
		const b = impl.node<number>([], { initial: 2, name: "b" });
		const m = impl.merge(a, b);

		let completed = false;
		const unsub = m.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.COMPLETE) completed = true;
		});

		try {
			a.down([[impl.COMPLETE]]);
			expect(completed).toBe(false);

			b.down([[impl.COMPLETE]]);
			expect(completed).toBe(true);
		} finally {
			unsub();
		}
	});
});
