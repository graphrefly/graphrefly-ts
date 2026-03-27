import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { COMPLETE, DATA, DIRTY, ERROR, PAUSE, RESOLVED, RESUME } from "../../core/messages.js";
import { node } from "../../core/node.js";

describe("node primitive", () => {
	it("source node emits messages to subscribers", () => {
		const s = node<number>({ initial: 0 });
		const seen: symbol[][] = [];
		const unsub = s.subscribe((messages) => {
			seen.push(messages.map((m) => m[0] as symbol));
		});

		s.down([[DIRTY], [DATA, 1]]);
		unsub();

		expect(s.get()).toBe(1);
		expect(s.status).toBe("settled");
		expect(seen).toEqual([[DIRTY], [DATA]]);
	});

	it("derived node emits RESOLVED when equals says unchanged", () => {
		const source = node<number>({ initial: 1 });
		const derived = node([source], ([v]) => ((v as number) > 0 ? "positive" : "other"), {
			equals: (a, b) => a === b,
		});
		const seen: symbol[][] = [];
		const unsub = derived.subscribe((messages) => {
			seen.push(messages.map((m) => m[0] as symbol));
		});

		source.down([[DATA, 2]]);
		unsub();

		expect(derived.get()).toBe("positive");
		expect(seen).toContainEqual([RESOLVED]);
	});

	it("diamond settles once per upstream change", () => {
		const a = node<number>({ initial: 0 });
		const b = node([a], ([v]) => (v as number) + 1);
		const c = node([a], ([v]) => (v as number) + 2);
		let dRuns = 0;
		const d = node([b, c], ([bv, cv]) => {
			dRuns += 1;
			return (bv as number) + (cv as number);
		});

		const unsub = d.subscribe(() => undefined);
		const before = dRuns;
		a.down([[DIRTY], [DATA, 5]]);
		const after = dRuns;
		unsub();

		expect(after - before).toBe(1);
		expect(d.get()).toBe(13);
	});

	it("fn throw is forwarded as ERROR downstream", () => {
		const source = node<number>({ initial: 0 });
		const broken = node([source], () => {
			throw new Error("boom");
		});
		const seen: symbol[] = [];
		const unsub = broken.subscribe((messages) => {
			for (const m of messages) {
				seen.push(m[0] as symbol);
			}
		});

		source.down([[DATA, 1]]);
		expect(broken.status).toBe("errored");
		expect(seen).toContain(ERROR);
		unsub();
	});

	it("resubscribable nodes allow fresh subscriptions after terminal", () => {
		const n = node<number>({ initial: 1, resubscribable: true });
		const seen: symbol[] = [];
		const unsub1 = n.subscribe((messages) => {
			for (const m of messages) {
				seen.push(m[0] as symbol);
			}
		});

		n.down([[COMPLETE]]);
		unsub1();

		const unsub2 = n.subscribe(() => undefined);
		n.down([[DATA, 2]]);
		unsub2();

		expect(seen).toContain(COMPLETE);
		expect(n.get()).toBe(2);
	});

	it("passthrough node forwards unknown message types", () => {
		const CUSTOM = Symbol("custom");
		const source = node<number>({ initial: 0 });
		const passthrough = node([source]);
		const seen: symbol[] = [];
		const unsub = passthrough.subscribe((messages) => {
			for (const m of messages) {
				seen.push(m[0] as symbol);
			}
		});

		source.down([[CUSTOM, 1]]);
		unsub();

		expect(seen).toContain(CUSTOM);
	});

	it("supports node(deps, opts) without fn as passthrough form", () => {
		const source = node<number>({ initial: 1 });
		const wire = node([source], { name: "wire" });
		const seen: symbol[] = [];
		const unsub = wire.subscribe((messages) => {
			for (const m of messages) {
				seen.push(m[0] as symbol);
			}
		});

		source.down([[DATA, 2]]);
		unsub();

		expect(wire.name).toBe("wire");
		expect(seen).toContain(DATA);
	});

	it("forwards PAUSE and RESUME through a derived node", () => {
		const source = node<number>({ initial: 0 });
		const derived = node([source], ([v]) => v as number);
		const seen: symbol[] = [];
		const unsub = derived.subscribe((messages) => {
			for (const m of messages) {
				seen.push(m[0] as symbol);
			}
		});

		source.down([[PAUSE, "lock"]]);
		source.down([[RESUME, "lock"]]);
		unsub();

		expect(seen).toContain(PAUSE);
		expect(seen).toContain(RESUME);
	});

	it("supports node(fn, opts) producer form", () => {
		const p = node(
			(_deps, { down }) => {
				down([[DATA, 42]]);
			},
			{ name: "producer-like" },
		);
		const values: number[] = [];
		const unsub = p.subscribe((messages) => {
			for (const m of messages) {
				if (m[0] === DATA) {
					values.push(m[1] as number);
				}
			}
		});
		unsub();

		expect(p.name).toBe("producer-like");
		expect(values).toEqual([42]);
	});

	it("completeWhenDepsComplete: false suppresses auto-COMPLETE", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const derived = node([a, b], ([av, bv]) => (av as number) + (bv as number), {
			completeWhenDepsComplete: false,
		});
		const seen: symbol[] = [];
		const unsub = derived.subscribe((messages) => {
			for (const m of messages) {
				seen.push(m[0] as symbol);
			}
		});

		a.down([[COMPLETE]]);
		b.down([[COMPLETE]]);
		unsub();

		expect(seen).not.toContain(COMPLETE);
		expect(derived.status).not.toBe("completed");
	});

	it("completeWhenDepsComplete: true (default) emits COMPLETE when all deps complete", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const derived = node([a, b], ([av, bv]) => (av as number) + (bv as number));
		const seen: symbol[] = [];
		const unsub = derived.subscribe((messages) => {
			for (const m of messages) {
				seen.push(m[0] as symbol);
			}
		});

		a.down([[COMPLETE]]);
		expect(seen).not.toContain(COMPLETE);

		b.down([[COMPLETE]]);
		unsub();

		expect(seen).toContain(COMPLETE);
	});

	it("supports >31 dependencies via Uint32Array bitmask", () => {
		const sources: ReturnType<typeof node<number>>[] = [];
		for (let i = 0; i < 40; i++) {
			sources.push(node<number>({ initial: i }));
		}

		let fnRuns = 0;
		const sum = node(sources, (deps) => {
			fnRuns += 1;
			return (deps as number[]).reduce((a, b) => a + b, 0);
		});

		const unsub = sum.subscribe(() => undefined);
		const before = fnRuns;

		// Update source at index 35 (beyond 31-bit limit)
		sources[35].down([[DIRTY], [DATA, 100]]);

		expect(fnRuns - before).toBe(1);
		// Original sum: 0+1+...+39 = 780. Replace 35 with 100: 780 - 35 + 100 = 845
		expect(sum.get()).toBe(845);
		unsub();
	});

	it(">31 deps: diamond settlement works correctly", () => {
		const sources: ReturnType<typeof node<number>>[] = [];
		for (let i = 0; i < 35; i++) {
			sources.push(node<number>({ initial: 0 }));
		}

		let fnRuns = 0;
		const combined = node(sources, (deps) => {
			fnRuns += 1;
			return (deps as number[]).reduce((a, b) => a + b, 0);
		});

		const unsub = combined.subscribe(() => undefined);
		const before = fnRuns;

		// Update two sources — should still settle once
		batch(() => {
			sources[0].down([[DIRTY], [DATA, 10]]);
			sources[34].down([[DIRTY], [DATA, 20]]);
		});

		expect(fnRuns - before).toBe(1);
		expect(combined.get()).toBe(30);
		unsub();
	});

	it(">31 deps: COMPLETE fires when all deps complete", () => {
		const sources: ReturnType<typeof node<number>>[] = [];
		for (let i = 0; i < 35; i++) {
			sources.push(node<number>({ initial: i }));
		}

		const combined = node(sources, (deps) => (deps as number[]).reduce((a, b) => a + b, 0));
		const seen: symbol[] = [];
		const unsub = combined.subscribe((messages) => {
			for (const m of messages) {
				seen.push(m[0] as symbol);
			}
		});

		// Complete all but last
		for (let i = 0; i < 34; i++) {
			sources[i].down([[COMPLETE]]);
		}
		expect(seen).not.toContain(COMPLETE);

		// Complete the last one
		sources[34].down([[COMPLETE]]);
		unsub();

		expect(seen).toContain(COMPLETE);
	});

	it("single-dep optimization: chain computes correctly with skipped DIRTY", () => {
		const source = node<number>({ initial: 0 });
		const derived = node([source], ([v]) => (v as number) * 2);
		const leaf = node([derived], ([v]) => (v as number) + 100);
		const unsub = leaf.subscribe(() => undefined);

		source.down([[DIRTY], [DATA, 5]]);
		unsub();

		// Values propagate correctly through optimized chain
		expect(derived.get()).toBe(10);
		expect(leaf.get()).toBe(110);
	});

	it("single-dep optimization: diamond still settles once", () => {
		const a = node<number>({ initial: 0 });
		const b = node([a], ([v]) => (v as number) + 1);
		const c = node([a], ([v]) => (v as number) + 2);
		let dRuns = 0;
		const d = node([b, c], ([bv, cv]) => {
			dRuns += 1;
			return (bv as number) + (cv as number);
		});

		const unsub = d.subscribe(() => undefined);
		const before = dRuns;
		a.down([[DIRTY], [DATA, 5]]);
		const after = dRuns;
		unsub();

		// a has two subscribers (b, c) → optimization disabled on a
		// Diamond settlement works correctly
		expect(after - before).toBe(1);
		expect(d.get()).toBe(13);
	});

	it("single-dep optimization: disabled when second subscriber joins", () => {
		const source = node<number>({ initial: 0 });
		const d1 = node([source], ([v]) => (v as number) + 1);
		const d2 = node([source], ([v]) => (v as number) + 2);

		const e1: symbol[][] = [];
		const e2: symbol[][] = [];
		const unsub1 = d1.subscribe((msgs) => {
			e1.push(msgs.map((m) => m[0] as symbol));
		});
		const unsub2 = d2.subscribe((msgs) => {
			e2.push(msgs.map((m) => m[0] as symbol));
		});

		e1.length = 0;
		e2.length = 0;
		source.down([[DIRTY], [DATA, 5]]);
		unsub1();
		unsub2();

		// source has two subscribers → DIRTY not skipped
		const allTypes1 = e1.flat();
		const allTypes2 = e2.flat();
		expect(allTypes1).toContain(DIRTY);
		expect(allTypes2).toContain(DIRTY);
	});

	it("single-dep optimization: handles RESOLVED for unchanged values", () => {
		const source = node<number>({ initial: 1 });
		const derived = node([source], ([v]) => ((v as number) > 0 ? "positive" : "negative"));
		const unsub1 = derived.subscribe(() => undefined);

		const emissions: symbol[][] = [];
		unsub1();
		const unsub2 = derived.subscribe((msgs) => {
			emissions.push(msgs.map((m) => m[0] as symbol));
		});

		emissions.length = 0;
		// Value changes but derived result stays "positive"
		source.down([[DIRTY], [DATA, 2]]);
		unsub2();

		expect(derived.get()).toBe("positive");
		// Should emit RESOLVED (not DATA) since value unchanged
		const allTypes = emissions.flat();
		expect(allTypes).toContain(RESOLVED);
		expect(allTypes).not.toContain(DATA);
	});

	it("single-dep optimization: re-enabled when subscriber count drops to one", () => {
		const source = node<number>({ initial: 0 });
		const d1 = node([source], ([v]) => (v as number) + 1);
		const d2 = node([source], ([v]) => (v as number) + 2);

		const unsub1 = d1.subscribe(() => undefined);
		const unsub2 = d2.subscribe(() => undefined);

		// Two subscribers → optimization off on source
		unsub2(); // d2 unsubscribes → back to one single-dep subscriber

		source.down([[DIRTY], [DATA, 10]]);
		unsub1();

		// Values still correct after optimization re-engages
		expect(d1.get()).toBe(11);
	});

	it("single-dep optimization: fewer sink calls in optimized chain", () => {
		const source = node<number>({ initial: 0 });

		// Manually subscribe to source to count calls
		let callCount = 0;
		const derived = node([source], ([v]) => {
			callCount += 1;
			return (v as number) * 2;
		});
		const leaf = node([derived], ([v]) => (v as number) + 100);
		const unsub = leaf.subscribe(() => undefined);

		callCount = 0;

		// With optimization: source skips DIRTY to derived, derived gets one DATA call
		// Without optimization: derived would get DIRTY then DATA (two calls to handleDepMessages)
		source.down([[DIRTY], [DATA, 5]]);

		// fn should still run exactly once
		expect(callCount).toBe(1);
		expect(leaf.get()).toBe(110);
		unsub();
	});

	it("standalone DIRTY passes through even with single-dep optimization", () => {
		const source = node<number>({ initial: 0 });
		const derived = node([source], ([v]) => (v as number) * 2);
		const seen: symbol[] = [];
		const unsub = derived.subscribe((messages) => {
			for (const m of messages) {
				seen.push(m[0] as symbol);
			}
		});

		seen.length = 0;
		// Standalone DIRTY without DATA — must NOT be swallowed
		source.down([[DIRTY]]);

		expect(seen).toContain(DIRTY);
		unsub();
	});

	it("dep COMPLETE after DIRTY does not block settlement", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		let fnRuns = 0;
		const derived = node([a, b], ([av, bv]) => {
			fnRuns += 1;
			return (av as number) + (bv as number);
		});

		const unsub = derived.subscribe(() => undefined);
		const before = fnRuns;

		// a sends DIRTY, then COMPLETEs instead of DATA/RESOLVED
		// b sends a normal update
		a.down([[DIRTY]]);
		a.down([[COMPLETE]]);
		b.down([[DIRTY], [DATA, 10]]);

		// derived should still recompute with latest values
		expect(fnRuns).toBeGreaterThan(before);
		expect(derived.get()).toBe(11); // a=1 (initial, no DATA), b=10
		unsub();
	});

	it("multi-dep passthrough waits for all deps to COMPLETE", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const wire = node([a, b], { name: "wire" });
		const seen: symbol[] = [];
		const unsub = wire.subscribe((messages) => {
			for (const m of messages) {
				seen.push(m[0] as symbol);
			}
		});

		a.down([[COMPLETE]]);
		expect(seen).not.toContain(COMPLETE);
		expect(wire.status).not.toBe("completed");

		b.down([[COMPLETE]]);
		expect(seen).toContain(COMPLETE);
		unsub();
	});

	it("double-unsubscribe is safe", () => {
		const source = node<number>({ initial: 0 });
		const d1 = node([source], ([v]) => (v as number) + 1);
		const d2 = node([source], ([v]) => (v as number) + 2);
		const d3 = node([source], ([v]) => (v as number) + 3);

		const unsub1 = d1.subscribe(() => undefined);
		const unsub2 = d2.subscribe(() => undefined);
		const unsub3 = d3.subscribe(() => undefined);

		// Double-unsubscribe should not corrupt counter state
		unsub2();
		unsub2();

		unsub1();
		unsub3();

		// Source should still work after all unsubs
		source.down([[DIRTY], [DATA, 5]]);
		expect(source.get()).toBe(5);
	});
});
