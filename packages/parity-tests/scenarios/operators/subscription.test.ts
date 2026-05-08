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
	test("zip pairs DATA from two sources", async () => {
		const s1 = await impl.node<number>([], { name: "s1" });
		const s2 = await impl.node<number>([], { name: "s2" });
		const z = await impl.zip([s1, s2]);

		const seen: unknown[] = [];
		const unsub = await z.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1]);
		});

		try {
			await s1.down([[impl.DATA, 1]]);
			await s2.down([[impl.DATA, 10]]);
			await s1.down([[impl.DATA, 2]]);
			await s2.down([[impl.DATA, 20]]);

			expect(seen).toEqual([
				[1, 10],
				[2, 20],
			]);
		} finally {
			await unsub();
		}
	});

	test("zip buffers per-source until all sources have DATA", async () => {
		const s1 = await impl.node<number>([], { name: "s1" });
		const s2 = await impl.node<number>([], { name: "s2" });
		const z = await impl.zip([s1, s2]);

		const seen: unknown[] = [];
		const unsub = await z.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1]);
		});

		try {
			await s1.down([[impl.DATA, 1]]);
			await s1.down([[impl.DATA, 2]]);
			await s1.down([[impl.DATA, 3]]);
			expect(seen).toEqual([]);

			await s2.down([[impl.DATA, 100]]);
			expect(seen).toEqual([[1, 100]]);
		} finally {
			await unsub();
		}
	});

	// D6: zip with 3+ sources — verifies the N-wise tuple emission
	// extends past the typical 2-source case.
	test("zip with three sources emits triples once all three have DATA", async () => {
		const s1 = await impl.node<number>([], { name: "s1" });
		const s2 = await impl.node<number>([], { name: "s2" });
		const s3 = await impl.node<number>([], { name: "s3" });
		const z = await impl.zip([s1, s2, s3]);

		const seen: unknown[] = [];
		const unsub = await z.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1]);
		});

		try {
			await s1.down([[impl.DATA, 1]]);
			await s2.down([[impl.DATA, 10]]);
			expect(seen).toEqual([]); // need s3 too
			await s3.down([[impl.DATA, 100]]);
			expect(seen).toEqual([[1, 10, 100]]);

			// Subsequent triples follow the same all-queues-non-empty rule.
			await s1.down([[impl.DATA, 2]]);
			await s3.down([[impl.DATA, 200]]);
			expect(seen).toEqual([[1, 10, 100]]);
			await s2.down([[impl.DATA, 20]]);
			expect(seen).toEqual([
				[1, 10, 100],
				[2, 20, 200],
			]);
		} finally {
			await unsub();
		}
	});
});

// =====================================================================
// concat — sequentially forward `first` then `second`
// =====================================================================

describe.each(impls)("R5.7 subscription — concat parity — $name", (impl) => {
	test("concat forwards first then second after first completes", async () => {
		const s1 = await impl.node<number>([], { name: "s1" });
		const s2 = await impl.node<number>([], { name: "s2" });
		const c = await impl.concat(s1, s2);

		const seen: number[] = [];
		const unsub = await c.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			await s1.down([[impl.DATA, 1]]);
			await s1.down([[impl.DATA, 2]]);
			await s1.down([[impl.COMPLETE]]);
			await s2.down([[impl.DATA, 10]]);
			await s2.down([[impl.DATA, 20]]);

			expect(seen).toEqual([1, 2, 10, 20]);
		} finally {
			await unsub();
		}
	});

	test("concat buffers second-source DATA during phase zero", async () => {
		const s1 = await impl.node<number>([], { name: "s1" });
		const s2 = await impl.node<number>([], { name: "s2" });
		const c = await impl.concat(s1, s2);

		const seen: number[] = [];
		const unsub = await c.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			await s1.down([[impl.DATA, 1]]);
			// s2 emits BEFORE s1 completes — should buffer.
			await s2.down([[impl.DATA, 99]]);
			expect(seen).toEqual([1]);

			await s1.down([[impl.COMPLETE]]);
			// On phase transition, buffered s2 DATA drains.
			expect(seen).toEqual([1, 99]);
		} finally {
			await unsub();
		}
	});

	// D6 / D4 (Rust port D041) regression: if `second` completes during
	// phase 0 (before `first`), concat must self-complete on phase
	// transition after draining `pending`. Pre-fix concat hangs because
	// second's COMPLETE fires once and won't be re-observed.
	//
	// PER-IMPL: TS legacy has the pre-fix behavior (concat hangs); Rust
	// port D041 has the fix. `runIf(impl.name !== "legacy-pure-ts")`
	// activates the assertion for any non-legacy impl (including
	// `rustImpl` once it publishes), so the divergence becomes a
	// loud failure instead of a silent skip.
	test.runIf(impl.name !== "legacy-pure-ts")(
		"concat self-completes when second completes during phase zero (Rust-port-only fix; D041 / D-ops /qa D4)",
		async () => {
			const s1 = await impl.node<number>([], { name: "s1" });
			const s2 = await impl.node<number>([], { name: "s2" });
			const c = await impl.concat(s1, s2);

			const seen: number[] = [];
			let completed = false;
			const unsub = await c.subscribe((msgs) => {
				for (const msg of msgs) {
					if (msg[0] === impl.DATA) seen.push(msg[1] as number);
					else if (msg[0] === impl.COMPLETE) completed = true;
				}
			});

			try {
				await s1.down([[impl.DATA, 1]]);
				await s2.down([[impl.DATA, 99]]);
				await s2.down([[impl.COMPLETE]]);
				// Concat must NOT have completed yet — s1 still going.
				expect(completed).toBe(false);

				await s1.down([[impl.COMPLETE]]);
				// Phase transition drains pending(99), then sees second already
				// completed → self-completes.
				expect(seen).toEqual([1, 99]);
				expect(completed).toBe(true);
			} finally {
				await unsub();
			}
		},
	);

	// D6: concat error during phase 0 from `second` propagates the ERROR
	// (and abandons `first`). Pre-fix audit confirmed this works; pinning
	// it here as a parity assertion.
	test("concat propagates ERROR from second during phase zero", async () => {
		const s1 = await impl.node<number>([], { name: "s1" });
		const s2 = await impl.node<number>([], { name: "s2" });
		const c = await impl.concat(s1, s2);

		const seen: number[] = [];
		let errored = false;
		const unsub = await c.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seen.push(msg[1] as number);
				else if (msg[0] === impl.ERROR) errored = true;
			}
		});

		try {
			await s1.down([[impl.DATA, 1]]);
			await s2.down([[impl.ERROR, "boom"]]);
			expect(errored).toBe(true);
			expect(seen).toEqual([1]);
		} finally {
			await unsub();
		}
	});
});

// =====================================================================
// race — first source to emit DATA wins; losers are silently ignored
// =====================================================================

describe.each(impls)("R5.7 subscription — race parity — $name", (impl) => {
	test("race winner forwards subsequent DATA; loser DATA is ignored", async () => {
		const s1 = await impl.node<number>([], { name: "s1" });
		const s2 = await impl.node<number>([], { name: "s2" });
		const r = await impl.race([s1, s2]);

		const seen: number[] = [];
		const unsub = await r.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			await s1.down([[impl.DATA, 1]]); // s1 wins
			await s2.down([[impl.DATA, 99]]); // ignored
			await s1.down([[impl.DATA, 2]]); // forwarded
			expect(seen).toEqual([1, 2]);
		} finally {
			await unsub();
		}
	});

	test("race ignores losers across multiple sources", async () => {
		const s1 = await impl.node<number>([], { name: "s1" });
		const s2 = await impl.node<number>([], { name: "s2" });
		const s3 = await impl.node<number>([], { name: "s3" });
		const r = await impl.race([s1, s2, s3]);

		const seen: number[] = [];
		const unsub = await r.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			await s2.down([[impl.DATA, 50]]); // s2 wins
			await s1.down([[impl.DATA, 1]]);
			await s3.down([[impl.DATA, 100]]);
			await s2.down([[impl.DATA, 60]]);
			expect(seen).toEqual([50, 60]);
		} finally {
			await unsub();
		}
	});

	// D6: if every source completes without anyone emitting DATA, race
	// itself completes (P4 in Rust port — no-winner all-complete
	// termination).
	//
	// PER-IMPL: TS legacy has different semantics (first COMPLETE from
	// ANY source while no-winner immediately ends the race). Rust port
	// D-ops /qa P4 chose all-complete-without-winner.
	// `runIf(impl.name !== "legacy-pure-ts")` activates the assertion
	// for any non-legacy impl; spec amendment may harmonize the two in
	// a future revision.
	test.runIf(impl.name !== "legacy-pure-ts")(
		"race completes when all sources complete without a winner (Rust-port-only semantics; D-ops /qa P4)",
		async () => {
			const s1 = await impl.node<number>([], { name: "s1" });
			const s2 = await impl.node<number>([], { name: "s2" });
			const r = await impl.race([s1, s2]);

			let completed = false;
			const seen: number[] = [];
			const unsub = await r.subscribe((msgs) => {
				for (const msg of msgs) {
					if (msg[0] === impl.DATA) seen.push(msg[1] as number);
					else if (msg[0] === impl.COMPLETE) completed = true;
				}
			});

			try {
				await s1.down([[impl.COMPLETE]]);
				expect(completed).toBe(false); // s2 still alive
				await s2.down([[impl.COMPLETE]]);
				expect(seen).toEqual([]);
				expect(completed).toBe(true);
			} finally {
				await unsub();
			}
		},
	);

	// D6: a pre-winner ERROR from any source propagates the error
	// immediately; subsequent traffic from any source is ignored.
	test("race propagates pre-winner ERROR from any source", async () => {
		const s1 = await impl.node<number>([], { name: "s1" });
		const s2 = await impl.node<number>([], { name: "s2" });
		const r = await impl.race([s1, s2]);

		let errored = false;
		const unsub = await r.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.ERROR) errored = true;
		});

		try {
			await s1.down([[impl.ERROR, "boom"]]);
			expect(errored).toBe(true);
		} finally {
			await unsub();
		}
	});
});

// =====================================================================
// takeUntil — terminate on notifier DATA
// =====================================================================

describe.each(impls)("R5.7 subscription — takeUntil parity — $name", (impl) => {
	test("takeUntil forwards source until notifier emits", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const notif = await impl.node<unknown>([], { name: "notif" });
		const t = await impl.takeUntil(src, notif);

		const seen: number[] = [];
		let completed = false;
		const unsub = await t.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seen.push(msg[1] as number);
				else if (msg[0] === impl.COMPLETE) completed = true;
			}
		});

		try {
			await src.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 2]]);
			await notif.down([[impl.DATA, "stop-signal"]]);
			await src.down([[impl.DATA, 3]]); // ignored — already completed

			expect(seen).toEqual([1, 2]);
			expect(completed).toBe(true);
		} finally {
			await unsub();
		}
	});

	// D6 (Slice F doc cleanup, 2026-05-07): empty-source edge cases for
	// zip / race — `await impl.zip()` and `await impl.race()` with zero sources. Both
	// have ambiguous canonical semantics:
	//   - zip(): vacuous tuple — could complete immediately (degenerate
	//     all-queues-non-empty trivially true) or stay pending.
	//   - race(): no winner possible — could complete immediately or stay
	//     pending.
	// TS legacy behavior is not pinned by spec; Rust port behavior likewise
	// undecided. Defer until either impl ships a concrete answer + we can
	// pin parity. Captured as todos so the gap doesn't get lost.
	test.todo("zip with zero sources — semantics undecided (D6 deferral)");
	test.todo("race with zero sources — semantics undecided (D6 deferral)");

	test("takeUntil does not forward notifier value", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const notif = await impl.node<unknown>([], { name: "notif" });
		const t = await impl.takeUntil(src, notif);

		const seen: unknown[] = [];
		const unsub = await t.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1]);
		});

		try {
			await notif.down([[impl.DATA, "ignored-payload"]]);
			expect(seen).toEqual([]);
		} finally {
			await unsub();
		}
	});

	// D6: source ERROR propagates through takeUntil before any notifier
	// signal arrives.
	test("takeUntil propagates ERROR from source", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const notif = await impl.node<unknown>([], { name: "notif" });
		const t = await impl.takeUntil(src, notif);

		let errored = false;
		const unsub = await t.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.ERROR) errored = true;
		});

		try {
			await src.down([[impl.ERROR, "src-boom"]]);
			expect(errored).toBe(true);
		} finally {
			await unsub();
		}
	});
});
