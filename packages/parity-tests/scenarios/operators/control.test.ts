/**
 * Slice U control-operator parity scenarios.
 *
 * Covers: `tap`, `tapObserver`, `onFirstData`, `rescue`, `valve`,
 * `settle`, `repeat`.
 *
 * Rust port reference:
 * `~/src/graphrefly-rs/crates/graphrefly-operators/src/control.rs`
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

// ---------------------------------------------------------------------------
// tap
// ---------------------------------------------------------------------------

describe.each(impls)("Slice U control — tap parity — $name", (impl) => {
	test("tap observes values without altering the stream", async () => {
		const src = await impl.node<number>([], { initial: 1, name: "src" });
		const tapped: number[] = [];
		const t = await impl.tap(src, (x) => tapped.push(x));

		const seen: number[] = [];
		const unsub = await t.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			// Push-on-subscribe should have fired tap + downstream
			expect(tapped).toContain(1);
			expect(seen).toContain(1);

			tapped.length = 0;
			seen.length = 0;
			await src.down([[impl.DATA, 42]]);
			expect(tapped).toEqual([42]);
			expect(seen).toEqual([42]);
		} finally {
			await unsub();
		}
	});
});

// ---------------------------------------------------------------------------
// tapObserver
// ---------------------------------------------------------------------------

describe.each(impls)("Slice U control — tapObserver parity — $name", (impl) => {
	test("tapObserver fires data and error callbacks", async () => {
		const src = await impl.node<number>([], { initial: 5, name: "src" });
		const dataLog: number[] = [];
		const errorLog: unknown[] = [];

		const t = await impl.tapObserver(src, {
			data: (x) => dataLog.push(x),
			error: (e) => errorLog.push(e),
		});

		const unsub = await t.subscribe(() => {});

		try {
			expect(dataLog).toContain(5);

			await src.down([[impl.DATA, 10]]);
			expect(dataLog).toContain(10);

			// Exercise error callback — ERROR is terminal.
			await src.error("oops" as unknown as number);
			expect(errorLog.length).toBeGreaterThan(0);
			expect(errorLog).toContain("oops");
		} finally {
			await unsub();
		}
	});

	test("tapObserver fires complete callback", async () => {
		const src = await impl.node<number>([], { initial: 5, name: "src" });
		let completeFired = false;

		const t = await impl.tapObserver(src, {
			complete: () => {
				completeFired = true;
			},
		});

		const unsub = await t.subscribe(() => {});

		try {
			await src.down([[impl.COMPLETE]]);
			expect(completeFired).toBe(true);
		} finally {
			await unsub();
		}
	});
});

// ---------------------------------------------------------------------------
// onFirstData
// ---------------------------------------------------------------------------

describe.each(impls)("Slice U control — onFirstData parity — $name", (impl) => {
	test("onFirstData fires fn once on first DATA", async () => {
		const src = await impl.node<number>([], { initial: 1, name: "src" });
		const firsts: number[] = [];
		const t = await impl.onFirstData(src, (x) => firsts.push(x));

		const unsub = await t.subscribe(() => {});

		try {
			// First DATA from push-on-subscribe
			expect(firsts.length).toBe(1);
			expect(firsts[0]).toBe(1);

			// Second DATA should NOT fire fn again
			await src.down([[impl.DATA, 2]]);
			expect(firsts.length).toBe(1);
		} finally {
			await unsub();
		}
	});
});

// ---------------------------------------------------------------------------
// rescue
// ---------------------------------------------------------------------------

describe.each(impls)("Slice U control — rescue parity — $name", (impl) => {
	test("rescue recovers from ERROR with a fallback value", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const r = await impl.rescue<number>(src, (err) => {
			if (typeof err === "string" && err === "boom") return -1;
			return undefined; // propagate
		});

		const seen: number[] = [];
		const errors: unknown[] = [];
		const unsub = await r.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seen.push(msg[1] as number);
				if (msg[0] === impl.ERROR) errors.push(msg[1]);
			}
		});

		try {
			await src.down([[impl.DATA, 1]]);
			expect(seen).toContain(1);

			// Recovery path — "boom" maps to -1.
			await src.error("boom" as unknown as number);
			expect(seen).toContain(-1);
		} finally {
			await unsub();
		}
	});

	test("rescue propagates ERROR when callback returns undefined", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const r = await impl.rescue<number>(src, () => undefined);

		const errors: unknown[] = [];
		const unsub = await r.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.ERROR) errors.push(msg[1]);
			}
		});

		try {
			// Propagation path — callback returns undefined → original error forwarded.
			await src.error("unrecoverable" as unknown as number);
			expect(errors.length).toBeGreaterThan(0);
			expect(errors).toContain("unrecoverable");
		} finally {
			await unsub();
		}
	});
});

// ---------------------------------------------------------------------------
// valve
// ---------------------------------------------------------------------------

describe.each(impls)("Slice U control — valve parity — $name", (impl) => {
	test("valve gates data flow based on control + predicate", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const ctrl = await impl.node<string>([], { initial: "open", name: "ctrl" });
		const v = await impl.valve(src, ctrl, (x) => x === "open");

		const seen: number[] = [];
		const unsub = await v.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			// Gate is open — data flows through
			await src.down([[impl.DATA, 1]]);
			expect(seen).toContain(1);

			// Close gate
			await ctrl.down([[impl.DATA, "closed"]]);
			seen.length = 0;
			await src.down([[impl.DATA, 2]]);
			expect(seen).toEqual([]);

			// Re-open gate
			await ctrl.down([[impl.DATA, "open"]]);
			await src.down([[impl.DATA, 3]]);
			expect(seen).toContain(3);
		} finally {
			await unsub();
		}
	});
});

// ---------------------------------------------------------------------------
// settle
// ---------------------------------------------------------------------------

describe.each(impls)("Slice U control — settle parity — $name", (impl) => {
	test("settle emits after quietWaves consecutive stable waves", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const s = await impl.settle(src, 2);

		const seen: number[] = [];
		const unsub = await s.subscribe((msgs) => {
			for (const msg of msgs) if (msg[0] === impl.DATA) seen.push(msg[1] as number);
		});

		try {
			// First emission — counter starts
			await src.down([[impl.DATA, 10]]);
			// Same value again — 1 quiet wave
			await src.down([[impl.DATA, 10]]);
			// Same value again — 2 quiet waves → should settle
			await src.down([[impl.DATA, 10]]);
			expect(seen).toContain(10);
		} finally {
			await unsub();
		}
	});
});

// ---------------------------------------------------------------------------
// repeat
// ---------------------------------------------------------------------------

describe.each(impls)("Slice U control — repeat parity — $name", (impl) => {
	test("repeat plays source count times total", async () => {
		// repeat(src, count) where count=2 means two total plays.
		// Source must be resubscribable so repeat can re-subscribe after COMPLETE.
		const src = await impl.node<number>([], { initial: 42, name: "src", resubscribable: true });
		const r = await impl.repeat(src, 2);

		const seen: number[] = [];
		let completed = false;
		const unsub = await r.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seen.push(msg[1] as number);
				if (msg[0] === impl.COMPLETE) completed = true;
			}
		});

		try {
			// Push-on-subscribe delivers initial
			expect(seen).toContain(42);

			// Complete src → repeat round 1 done, starts round 2
			await src.complete();
			// Round 2 push-on-subscribe delivers cached value again
			// Then complete again → all rounds done
			await src.complete();
			expect(completed).toBe(true);
		} finally {
			await unsub();
		}
	});
});
