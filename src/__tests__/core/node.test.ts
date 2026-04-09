import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	PAUSE,
	RESOLVED,
	RESUME,
	TEARDOWN,
} from "../../core/messages.js";
import { describeNode, metaSnapshot } from "../../core/meta.js";
import { node } from "../../core/node.js";

describe("node primitive", () => {
	it("source node emits messages to subscribers", () => {
		const s = node<number>();
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
		const payloads: unknown[] = [];
		const unsub = broken.subscribe((messages) => {
			for (const m of messages) {
				seen.push(m[0] as symbol);
				if (m[0] === ERROR) payloads.push(m[1]);
			}
		});

		source.down([[DATA, 1]]);
		expect(broken.status).toBe("errored");
		expect(seen).toContain(ERROR);
		expect(payloads[0]).toBeInstanceOf(Error);
		expect((payloads[0] as Error).message).toContain("fn threw");
		expect((payloads[0] as Error).cause).toBeInstanceOf(Error);
		expect(((payloads[0] as Error).cause as Error).message).toBe("boom");
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3.3 — RESOLVED enables transitive skip (leaf fn not re-run).
	it("RESOLVED on mid skips leaf compute when value unchanged", () => {
		const source = node<number>({ initial: 0 });
		const mid = node([source], ([v]) => ((v as number) > 0 ? "p" : "n"), {
			equals: (a, b) => a === b,
		});
		let leafRuns = 0;
		const leaf = node([mid], ([m]) => {
			leafRuns += 1;
			return m;
		});
		const unsub = leaf.subscribe(() => undefined);
		const afterConnect = leafRuns;

		source.down([[DIRTY], [DATA, 1]]);
		const afterFirstPush = leafRuns;
		expect(afterFirstPush).toBeGreaterThan(afterConnect);

		source.down([[DIRTY], [DATA, 2]]);
		expect(leafRuns).toBe(afterFirstPush);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3.4 — ERROR is terminal (no further downstream messages).
	it("after ERROR, non-resubscribable node does not emit to sinks again", () => {
		const source = node<number>();
		const broken = node([source], () => {
			throw new Error("boom");
		});
		let deliveries = 0;
		const unsub = broken.subscribe(() => {
			deliveries += 1;
		});

		source.down([[DATA, 1]]);
		// 2 deliveries: DIRTY (from dep settling) + ERROR (from throwing fn)
		expect(deliveries).toBe(2);

		source.down([[DIRTY], [DATA, 2]]);
		// No additional deliveries after terminal ERROR
		expect(deliveries).toBe(2);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §2.5 — custom equals never receives undefined (initial cached state).
	it("custom equals is not called with undefined on first computation", () => {
		const source = node<number>({ initial: 1 });
		let equalsCalled = false;
		const mid = node([source], ([v]) => new Map([["k", v]]), {
			equals: (a, b) => {
				equalsCalled = true;
				// This would crash if a were undefined: (a as Map<...>).size
				return (a as Map<string, unknown>).size === (b as Map<string, unknown>).size;
			},
		});
		const unsub = mid.subscribe(() => {});
		// First computation should NOT call equals (cached is still undefined)
		expect(equalsCalled).toBe(false);
		// Change source value so fn re-runs with a different dep value
		source.down([[DIRTY], [DATA, 2]]);
		// Second computation should call equals (both sides are real Maps)
		expect(equalsCalled).toBe(true);
		unsub();
	});

	// Spec: GRAPHREFLY-SPEC §1.3
	it("ERROR message tuple contains the exact thrown Error instance as payload", () => {
		const source = node<number>({ initial: 0 });
		const theError = new Error("exact-instance");
		const broken = node([source], () => {
			throw theError;
		});
		const collected: unknown[][] = [];
		const unsub = broken.subscribe((messages) => {
			collected.push([...messages]);
		});

		source.down([[DATA, 1]]);
		unsub();

		// Find the ERROR message tuple across all collected batches
		const errorMsg = collected.flat().find((m) => (m as unknown[])[0] === ERROR) as
			| unknown[]
			| undefined;
		expect(errorMsg).toBeDefined();
		expect(errorMsg?.[0]).toBe(ERROR);
		// Error is wrapped with node name context; original is in .cause
		const wrapped = errorMsg?.[1] as Error;
		expect(wrapped).toBeInstanceOf(Error);
		expect(wrapped.message).toContain("fn threw");
		expect(wrapped.cause).toBe(theError);
	});

	it("resetOnTeardown clears cached value on TEARDOWN", () => {
		const n = node<number>({ initial: 42, resetOnTeardown: true });
		const unsub = n.subscribe(() => undefined);
		expect(n.get()).toBe(42);
		n.down([[TEARDOWN]]);
		expect(n.get()).toBeUndefined();
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

	it("forwards PAUSE then RESUME through multi-hop derived chain", () => {
		const source = node<number>({ initial: 1 });
		const hop = node([source], ([v]) => v as number);
		const leaf = node([hop], ([v]) => (v as number) * 2);
		const seen: symbol[] = [];
		const unsub = leaf.subscribe((messages) => {
			for (const m of messages) {
				seen.push(m[0] as symbol);
			}
		});

		source.down([[PAUSE, "lock-a"]]);
		source.down([[RESUME, "lock-a"]]);
		unsub();

		expect(seen.indexOf(PAUSE)).toBeGreaterThanOrEqual(0);
		expect(seen.indexOf(RESUME)).toBeGreaterThan(seen.indexOf(PAUSE));
	});

	it("INVALIDATE propagates and clears caches along multi-hop derived chain", () => {
		const source = node<number>({ initial: 42 });
		const hop = node([source], ([v]) => v as number);
		const leaf = node([hop], ([v]) => (v as number) + 1);
		let sawInvalidate = false;
		const unsub = leaf.subscribe((messages) => {
			sawInvalidate ||= messages.some((m) => m[0] === INVALIDATE);
		});

		expect(leaf.get()).toBe(43);
		source.down([[INVALIDATE]]);
		unsub();

		expect(sawInvalidate).toBe(true);
		expect(source.get()).toBeUndefined();
		expect(hop.get()).toBeUndefined();
		expect(leaf.get()).toBeUndefined();
		expect(source.status).toBe("dirty");
	});

	it("INVALIDATE clears dep memo so identical DATA triggers recompute", () => {
		const source = node<number>({ initial: 7 });
		let runs = 0;
		const d = node([source], ([v]) => {
			runs += 1;
			return (v as number) + 1;
		});
		const unsub = d.subscribe(() => undefined);
		expect(runs).toBe(1);
		expect(d.get()).toBe(8);
		source.down([[INVALIDATE]]);
		source.down([[DIRTY], [DATA, 7]]);
		unsub();

		expect(runs).toBe(2);
		expect(d.get()).toBe(8);
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
		// Producer emits 42 during connect, then push-on-subscribe replays cached 42
		expect(values).toEqual([42, 42]);
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

describe("D1: sink snapshot during emitToSinks", () => {
	it("unsubscribing another sink mid-delivery does not skip it", () => {
		const src = node<number>();
		const log: string[] = [];
		let unsubB: () => void;
		const unsubA = src.subscribe(() => {
			log.push("A");
			// A unsubscribes B during delivery
			unsubB();
		});
		unsubB = src.subscribe(() => {
			log.push("B");
		});
		src.down([[DIRTY], [DATA, 1]]);
		// Both should have been called despite A removing B mid-iteration
		expect(log).toContain("A");
		expect(log).toContain("B");
		unsubA();
	});
});

describe("D2: DIRTY→COMPLETE without DATA unsticks dirty node", () => {
	it("dep goes DIRTY then COMPLETE (no DATA) — derived resolves", () => {
		const a = node({ initial: 1 });
		const b = node({ initial: 2 });
		const sinkMsgs: symbol[][] = [];
		const derived = node([a, b], ([av, bv]) => {
			return (av as number) + (bv as number);
		});
		derived.subscribe((msgs) => {
			sinkMsgs.push(msgs.map((m) => m[0] as symbol));
		});
		expect(derived.get()).toBe(3);

		// a goes DIRTY then COMPLETE without DATA
		a.down([[DIRTY]]);
		expect(derived.status).toBe("dirty");
		a.down([[COMPLETE]]);
		// Dep values unchanged → runFn fires the equality shortcut → RESOLVED
		// Node must NOT stay stuck in "dirty".
		expect(derived.status).not.toBe("dirty");
		// Sinks should have received DIRTY then RESOLVED (value unchanged)
		const flat = sinkMsgs.flat();
		expect(flat).toContain(DIRTY);
		expect(flat).toContain(RESOLVED);
	});

	it("dep goes DIRTY then COMPLETE — multi-dep diamond unsticks", () => {
		const a = node({ initial: 1 });
		const b = node({ initial: 2 });
		const derived = node([a, b], ([av, bv]) => (av as number) + (bv as number));
		derived.subscribe(() => undefined);

		// Both deps go dirty, only b settles; a completes without DATA
		a.down([[DIRTY]]);
		b.down([[DIRTY]]);
		expect(derived.status).toBe("dirty");
		b.down([[DATA, 20]]);
		// b settled but a still dirty → no recompute yet
		a.down([[COMPLETE]]);
		// Now a is done (no pending dirty bits) → derived should recompute
		expect(derived.status).not.toBe("dirty");
		expect(derived.get()).toBe(21); // 1 + 20
	});
});

describe("D3: TEARDOWN updates status to disconnected", () => {
	it("source node status becomes disconnected after TEARDOWN", () => {
		const src = node({ initial: 1 });
		expect(src.status).toBe("settled");
		src.down([[TEARDOWN]]);
		expect(src.status).toBe("disconnected");
	});

	it("terminated node status becomes disconnected after TEARDOWN (B3)", () => {
		const src = node({ initial: 1 });
		src.down([[COMPLETE]]);
		expect(src.status).toBe("completed");
		src.down([[TEARDOWN]]);
		expect(src.status).toBe("disconnected");
	});
});

describe("connect-order re-entrancy guard", () => {
	it("multi-dep node sees all dep values on first compute (no premature runFn)", () => {
		// dep `a` emits DATA immediately on subscribe (producer pattern).
		// Without the _connecting guard, `runFn` would fire during the subscribe
		// loop before `b` is wired, seeing b.get() as undefined.
		const a = node(
			(_deps, { down }) => {
				down([[DATA, "from-a"]]);
			},
			{ name: "a" },
		);
		const b = node<number>({ initial: 42, name: "b" });

		const seen: unknown[][] = [];
		const derived = node([a, b], (depValues) => {
			seen.push([...depValues]);
			return `${depValues[0]}-${depValues[1]}`;
		});

		const unsub = derived.subscribe(() => undefined);
		unsub();

		// The first (and ideally only) runFn call should see both dep values
		expect(seen.length).toBeGreaterThanOrEqual(1);
		expect(seen[0]).toEqual(["from-a", 42]);
		expect(derived.get()).toBe("from-a-42");
	});

	it("connect guard does not suppress post-connect updates", () => {
		const a = node(
			(_deps, { down }) => {
				down([[DATA, 1]]);
			},
			{ name: "a" },
		);
		const b = node<number>({ initial: 2, name: "b" });
		const derived = node([a, b], ([av, bv]) => (av as number) + (bv as number));
		const unsub = derived.subscribe(() => undefined);

		// After connect, normal updates still propagate
		b.down([[DIRTY], [DATA, 10]]);
		expect(derived.get()).toBe(11);
		unsub();
	});

	it("runFn terminal guard: dep updates after COMPLETE do not recompute", () => {
		const src = node({ initial: 1 });
		let recompute = 0;
		const d = node([src], ([v]) => {
			recompute += 1;
			return v;
		});
		d.subscribe(() => undefined);
		expect(recompute).toBe(1);
		src.down([[COMPLETE]]);
		expect(d.status).toBe("completed");
		src.down([[DIRTY], [DATA, 2]]);
		expect(recompute).toBe(1);
	});

	it("TEARDOWN after COMPLETE runs lifecycle and reaches sinks (B3)", () => {
		const src = node({ initial: 1 });
		const n = node([src], ([v]) => v, { meta: { m: 0 } });
		const sinkTypes: symbol[] = [];
		let metaSawTeardown = false;
		const unsubMeta = n.meta.m.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === TEARDOWN)) metaSawTeardown = true;
		});
		const unsub = n.subscribe((msgs) => {
			for (const m of msgs) sinkTypes.push(m[0] as symbol);
		});
		src.down([[COMPLETE]]);
		expect(n.status).toBe("completed");
		n.down([[TEARDOWN]]);
		expect(metaSawTeardown).toBe(true);
		expect(sinkTypes.filter((t) => t === TEARDOWN).length).toBeGreaterThanOrEqual(1);
		unsub();
		unsubMeta();
	});
});

describe("meta (companion stores)", () => {
	it("meta keys are subscribable nodes with initial values", () => {
		const n = node([node({ initial: 0 })], ([v]) => v, {
			name: "with-meta",
			meta: { description: "hi", status: "idle" },
		});
		expect(n.meta.description.get()).toBe("hi");
		expect(n.meta.status.get()).toBe("idle");
		expect(metaSnapshot(n)).toEqual({ description: "hi", status: "idle" });
	});

	it("meta field is independently subscribable from the parent node", () => {
		const src = node({ initial: 1 });
		const n = node([src], ([v]) => (v as number) * 2, {
			meta: { err: null as string | null },
		});
		const seen: symbol[][] = [];
		const unsub = n.meta.err.subscribe((msgs) => {
			seen.push(msgs.map((m) => m[0] as symbol));
		});
		n.meta.err.down([[DIRTY], [DATA, "bad"]]);
		unsub();
		// Push-on-subscribe delivers the initial cached value (null) as DATA,
		// then the explicit down() delivers DIRTY and DATA.
		expect(seen).toEqual([[DATA], [DIRTY], [DATA]]);
		expect(metaSnapshot(n).err).toBe("bad");
	});

	it("meta can be updated without subscribing to the parent", () => {
		const n = node({ initial: 0, meta: { tag: "a" } });
		expect(n.meta.tag.get()).toBe("a");
		n.meta.tag.down([[DATA, "b"]]);
		expect(n.meta.tag.get()).toBe("b");
		expect(metaSnapshot(n)).toEqual({ tag: "b" });
	});

	it("metaSnapshot is empty when no meta option", () => {
		const n = node({ initial: 1 });
		expect(metaSnapshot(n)).toEqual({});
	});

	it("parent TEARDOWN still disconnects when one meta.down throws", () => {
		const src = node({ initial: 1 });
		const n = node([src], ([v]) => (v as number) * 2, {
			meta: { flaky: 0, stable: 1 },
		});
		const origFlakyDown = n.meta.flaky.down.bind(n.meta.flaky);
		n.meta.flaky.down = (msgs) => {
			if (msgs[0]?.[0] === TEARDOWN) throw new Error("meta teardown boom");
			origFlakyDown(msgs);
		};
		let stableSawTeardown = false;
		const unsubStable = n.meta.stable.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === TEARDOWN)) stableSawTeardown = true;
		});
		const unsub = n.subscribe(() => {});
		n.down([[TEARDOWN]]);
		expect(stableSawTeardown).toBe(true);
		expect(n.status).toBe("disconnected");
		unsub();
		unsubStable();
	});

	it("parent TEARDOWN propagates to every meta child when none throw", () => {
		const n = node({ initial: 0, meta: { a: 1, b: 2, c: 3 } });
		const saw: string[] = [];
		const unsubs = (["a", "b", "c"] as const).map((key) =>
			n.meta[key].subscribe((msgs) => {
				if (msgs.some((m) => m[0] === TEARDOWN)) saw.push(key);
			}),
		);
		n.down([[TEARDOWN]]);
		expect(saw.sort()).toEqual(["a", "b", "c"]);
		for (const u of unsubs) u();
	});

	it("TEARDOWN runs stopProducer even when meta.down throws (producer restarts on resubscribe)", () => {
		let producerRuns = 0;
		const p = node(
			(_deps, { down }) => {
				producerRuns += 1;
				down([[DATA, producerRuns]]);
			},
			{ meta: { m: 0 } },
		);
		const origMetaDown = p.meta.m.down.bind(p.meta.m);
		p.meta.m.down = (msgs) => {
			if (msgs[0]?.[0] === TEARDOWN) throw new Error("meta teardown boom");
			origMetaDown(msgs);
		};
		const u1 = p.subscribe(() => undefined);
		expect(producerRuns).toBe(1);
		p.down([[TEARDOWN]]);
		expect(producerRuns).toBe(1);
		u1();
		const u2 = p.subscribe(() => undefined);
		expect(producerRuns).toBe(2);
		u2();
	});

	it("metaSnapshot omits keys when get() throws", () => {
		const n = node({ initial: 0, meta: { fine: 1, bad: 2 } });
		const bad = n.meta.bad as { get: () => unknown };
		bad.get = () => {
			throw new Error("no snapshot");
		};
		expect(metaSnapshot(n)).toEqual({ fine: 1 });
	});

	it("metaSnapshot omits every key whose get() throws", () => {
		const n = node({ initial: 0, meta: { ok: 0, x: 1, y: 2 } });
		for (const key of ["x", "y"] as const) {
			const child = n.meta[key] as { get: () => unknown };
			child.get = () => {
				throw new Error("bad");
			};
		}
		expect(metaSnapshot(n)).toEqual({ ok: 0 });
	});

	it("meta mapping is frozen (read-only parity with graphrefly-py MappingProxyType)", () => {
		const n = node({ initial: 0, meta: { k: 1 } });
		expect(Object.isFrozen(n.meta)).toBe(true);
	});

	it("describeNode includes meta and spec fields", () => {
		const n = node({
			initial: 0,
			meta: { description: "purpose", type_hint: "integer" },
			name: "retry_limit",
		});
		const d = describeNode(n);
		expect(d.type).toBe("state");
		expect(d.status).toBe("settled");
		expect(d.name).toBe("retry_limit");
		expect(d.deps).toEqual([]);
		expect(d.meta).toEqual({ description: "purpose", type_hint: "integer" });
		expect(d.value).toBe(0);
	});

	it("describeNode derived lists dep names", () => {
		const src = node({ initial: 1, name: "input" });
		const n = node([src], ([v]) => (v as number) * 2, {
			name: "validate",
			meta: { description: "ok" },
		});
		const snap = describeNode(n);
		expect(snap.type).toBe("derived");
		expect(snap.deps).toEqual(["input"]);
		expect(snap.meta).toEqual({ description: "ok" });
	});
});
