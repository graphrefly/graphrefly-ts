/**
 * DS-2.7.A cross-port behavioral parity — §2.7 first-run-gate rules.
 *
 * Pins the **structural-but-observable** consequences of the locked
 * predicate so both arms (`@graphrefly/pure-ts` and `@graphrefly/native`)
 * must agree on what releases the gate vs holds it:
 *
 * - `R2.7.0` — RESOLVED never settles. A non-Reduce-class derived built
 *   over a sentinel-forever dep never fires.
 * - `R2.7.1` — Reduce-class operators (`reduce`, `last`) fire on an
 *   `empty()`-style COMPLETE-only source and emit the seed / default;
 *   `map` (non-Reduce-class) does NOT fire on the same source.
 *
 * `NodeOptions.terminalAsRealInput` is **NOT** widened onto the `Impl`
 * contract in this slice (per cross-track-ledger §2 DS-2.7.A row +
 * `archive/docs/SESSION-DS-2.7.A-first-run-gate.md` Q1 framing: "Rust
 * predicate-pre-conformant, flag-surfacing slice pending"). Until the
 * Rust `/porting-to-rs` slice surfaces the flag, the parity arm asserts
 * Reduce-class terminal-awareness via the operator factories
 * themselves — pure-ts opts each in via `terminalAsRealInput: true` in
 * `extra/operators/{transform.ts,take.ts}`; rust dispatches the same
 * behavior via the hardcoded `OperatorOp::{Reduce, Last}` discriminant
 * (`crates/graphrefly-core/src/node.rs:152–158`). Structural equivalence
 * either way.
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("DS-2.7.A R2.7.0 — RESOLVED-only dep holds gate — $name", (impl) => {
	test("map over a sentinel-forever source never emits DATA", async () => {
		// A `state` with no `initial` is SENTINEL — it pushes nothing on
		// subscribe and never auto-emits. `map` is non-Reduce-class (no
		// `terminalAsRealInput`); the first-run gate must hold.
		const src = await impl.node<number>([], { name: "sentinel-src" });
		const out = await impl.map(src, (x: number) => x * 2);

		const seenData: unknown[] = [];
		const unsub = await out.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === impl.DATA) seenData.push(m[1]);
			}
		});
		try {
			// Nothing ever emitted DATA on the dep — fn never fired.
			expect(seenData).toEqual([]);
			expect(out.cache).toBeUndefined();
		} finally {
			await unsub();
		}
	});

	test("map over a sentinel dep fires only after a real DATA arrives", async () => {
		const src = await impl.node<number>([], { name: "lazy-src" });
		const out = await impl.map(src, (x: number) => x + 100);

		const seenData: unknown[] = [];
		const unsub = await out.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === impl.DATA) seenData.push(m[1]);
			}
		});
		try {
			expect(seenData).toEqual([]);
			await src.down([[impl.DATA, 7]]);
			expect(seenData).toEqual([107]);
			expect(out.cache).toBe(107);
		} finally {
			await unsub();
		}
	});
});

describe.each(
	impls,
)("DS-2.7.A R2.7.1 — Reduce-class fires on COMPLETE-only source; non-Reduce-class does not — $name", (impl) => {
	test("reduce over empty() emits the seed + COMPLETE", async () => {
		// `empty()` immediately COMPLETEs with no DATA. Reduce-class
		// `reduce` opts terminal into the gate's settle predicate
		// (`terminalAsRealInput: true` in pure-ts; `OperatorOp::Reduce`
		// dispatch in rust) so its terminal branch runs and emits the
		// seed.
		const src = await impl.empty<number>();
		const out = await impl.reduce(src, (acc: number, x: number) => acc + x, 42);

		const seenData: unknown[] = [];
		let sawComplete = false;
		const unsub = await out.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === impl.DATA) seenData.push(m[1]);
				if (m[0] === impl.COMPLETE) sawComplete = true;
			}
		});
		try {
			// reduce fires on the COMPLETE-only source: emits seed + own COMPLETE.
			expect(seenData).toEqual([42]);
			expect(sawComplete).toBe(true);
		} finally {
			await unsub();
		}
	});

	test("last over empty() with defaultValue emits the default + COMPLETE", async () => {
		const src = await impl.empty<number>();
		const out = await impl.last(src, { defaultValue: 99 });

		const seenData: unknown[] = [];
		let sawComplete = false;
		const unsub = await out.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === impl.DATA) seenData.push(m[1]);
				if (m[0] === impl.COMPLETE) sawComplete = true;
			}
		});
		try {
			expect(seenData).toEqual([99]);
			expect(sawComplete).toBe(true);
		} finally {
			await unsub();
		}
	});

	test("map over empty() does NOT emit DATA — non-Reduce-class holds the gate on terminal-only", async () => {
		// `map` is non-Reduce-class: no `terminalAsRealInput` opt-in.
		// The gate must HOLD when the only thing the source delivers
		// is a terminal. `map` auto-completes (default
		// `completeWhenDepsComplete: true`) so the COMPLETE still
		// propagates downstream — but NO mapped DATA is ever produced.
		const src = await impl.empty<number>();
		const out = await impl.map(src, (x: number) => x * 2);

		const seenData: unknown[] = [];
		let sawComplete = false;
		const unsub = await out.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === impl.DATA) seenData.push(m[1]);
				if (m[0] === impl.COMPLETE) sawComplete = true;
			}
		});
		try {
			expect(seenData).toEqual([]);
			// auto-COMPLETE still propagates the source's COMPLETE
			// downstream even though the gate held the fn — important
			// signal that the gate-predicate change did not break
			// terminal propagation.
			expect(sawComplete).toBe(true);
		} finally {
			await unsub();
		}
	});
});
