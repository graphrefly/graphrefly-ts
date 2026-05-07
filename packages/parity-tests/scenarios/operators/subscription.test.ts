/**
 * Subscription-managed combinator parity scenarios (M3 Slice D-ops).
 *
 * Covers the four producer-shape ops in `combine.ts` + `take.ts`:
 * `zip` / `concat` / `race` / `takeUntil`. Each is a node with no
 * declared deps that subscribes to its upstream sources from inside
 * its fn body and re-enters Core to emit on itself.
 *
 * Rust port reference: `~/src/graphrefly-rs/crates/graphrefly-operators/src/ops_impl.rs`
 * (Slice D-ops, landed 2026-05-06 per `~/src/graphrefly-rs/docs/migration-status.md`).
 *
 * Until `@graphrefly/native` publishes `rustImpl` in `impls/rust.ts`,
 * these scenarios run against `legacyImpl` only. When `rustImpl` flips
 * non-null, divergences fail loud — the rust arm uses the same
 * `impl.<name>` surface.
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

// =====================================================================
// zip — pair handles N-wise across N sources
// =====================================================================

describe.each(impls)("R5.7 subscription — zip parity — $name", (impl) => {
	test("zip pairs DATA from two sources", () => {
		const s1 = impl.node<number>([], { name: "s1" });
		const s2 = impl.node<number>([], { name: "s2" });
		const z = impl.zip(s1, s2);

		const seen: unknown[] = [];
		const unsub = z.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1]);
		});

		try {
			s1.down([[impl.DATA, 1]]);
			s2.down([[impl.DATA, 10]]);
			s1.down([[impl.DATA, 2]]);
			s2.down([[impl.DATA, 20]]);

			expect(seen).toEqual([
				[1, 10],
				[2, 20],
			]);
		} finally {
			unsub();
		}
	});

	test("zip buffers per-source until all sources have DATA", () => {
		const s1 = impl.node<number>([], { name: "s1" });
		const s2 = impl.node<number>([], { name: "s2" });
		const z = impl.zip(s1, s2);

		const seen: unknown[] = [];
		const unsub = z.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1]);
		});

		try {
			s1.down([[impl.DATA, 1]]);
			s1.down([[impl.DATA, 2]]);
			s1.down([[impl.DATA, 3]]);
			expect(seen).toEqual([]);

			s2.down([[impl.DATA, 100]]);
			expect(seen).toEqual([[1, 100]]);
		} finally {
			unsub();
		}
	});
});

// =====================================================================
// concat — sequentially forward `first` then `second`
// =====================================================================

describe.each(impls)("R5.7 subscription — concat parity — $name", (impl) => {
	test("concat forwards first then second after first completes", () => {
		const s1 = impl.node<number>([], { name: "s1" });
		const s2 = impl.node<number>([], { name: "s2" });
		const c = impl.concat(s1, s2);

		const seen: number[] = [];
		const unsub = c.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			s1.down([[impl.DATA, 1]]);
			s1.down([[impl.DATA, 2]]);
			s1.down([[impl.COMPLETE]]);
			s2.down([[impl.DATA, 10]]);
			s2.down([[impl.DATA, 20]]);

			expect(seen).toEqual([1, 2, 10, 20]);
		} finally {
			unsub();
		}
	});

	test("concat buffers second-source DATA during phase zero", () => {
		const s1 = impl.node<number>([], { name: "s1" });
		const s2 = impl.node<number>([], { name: "s2" });
		const c = impl.concat(s1, s2);

		const seen: number[] = [];
		const unsub = c.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			s1.down([[impl.DATA, 1]]);
			// s2 emits BEFORE s1 completes — should buffer.
			s2.down([[impl.DATA, 99]]);
			expect(seen).toEqual([1]);

			s1.down([[impl.COMPLETE]]);
			// On phase transition, buffered s2 DATA drains.
			expect(seen).toEqual([1, 99]);
		} finally {
			unsub();
		}
	});
});

// =====================================================================
// race — first source to emit DATA wins; losers are silently ignored
// =====================================================================

describe.each(impls)("R5.7 subscription — race parity — $name", (impl) => {
	test("race winner forwards subsequent DATA; loser DATA is ignored", () => {
		const s1 = impl.node<number>([], { name: "s1" });
		const s2 = impl.node<number>([], { name: "s2" });
		const r = impl.race(s1, s2);

		const seen: number[] = [];
		const unsub = r.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			s1.down([[impl.DATA, 1]]); // s1 wins
			s2.down([[impl.DATA, 99]]); // ignored
			s1.down([[impl.DATA, 2]]); // forwarded
			expect(seen).toEqual([1, 2]);
		} finally {
			unsub();
		}
	});

	test("race ignores losers across multiple sources", () => {
		const s1 = impl.node<number>([], { name: "s1" });
		const s2 = impl.node<number>([], { name: "s2" });
		const s3 = impl.node<number>([], { name: "s3" });
		const r = impl.race(s1, s2, s3);

		const seen: number[] = [];
		const unsub = r.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			s2.down([[impl.DATA, 50]]); // s2 wins
			s1.down([[impl.DATA, 1]]);
			s3.down([[impl.DATA, 100]]);
			s2.down([[impl.DATA, 60]]);
			expect(seen).toEqual([50, 60]);
		} finally {
			unsub();
		}
	});
});

// =====================================================================
// takeUntil — terminate on notifier DATA
// =====================================================================

describe.each(impls)("R5.7 subscription — takeUntil parity — $name", (impl) => {
	test("takeUntil forwards source until notifier emits", () => {
		const src = impl.node<number>([], { name: "src" });
		const notif = impl.node<unknown>([], { name: "notif" });
		const t = impl.takeUntil(src, notif);

		const seen: number[] = [];
		let completed = false;
		const unsub = t.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seen.push(msg[1] as number);
				else if (msg[0] === impl.COMPLETE) completed = true;
			}
		});

		try {
			src.down([[impl.DATA, 1]]);
			src.down([[impl.DATA, 2]]);
			notif.down([[impl.DATA, "stop-signal"]]);
			src.down([[impl.DATA, 3]]); // ignored — already completed

			expect(seen).toEqual([1, 2]);
			expect(completed).toBe(true);
		} finally {
			unsub();
		}
	});

	test("takeUntil does not forward notifier value", () => {
		const src = impl.node<number>([], { name: "src" });
		const notif = impl.node<unknown>([], { name: "notif" });
		const t = impl.takeUntil(src, notif);

		const seen: unknown[] = [];
		const unsub = t.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1]);
		});

		try {
			notif.down([[impl.DATA, "ignored-payload"]]);
			expect(seen).toEqual([]);
		} finally {
			unsub();
		}
	});
});
