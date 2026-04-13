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
	START,
	TEARDOWN,
} from "../../core/messages.js";
import { describeNode, metaSnapshot } from "../../core/meta.js";
import { node } from "../../core/node.js";
import { derived } from "../../core/sugar.js";

describe("node primitive", () => {
	it("source node emits messages to subscribers", () => {
		const s = node<number>();
		const seen: symbol[][] = [];
		const unsub = s.subscribe((messages) => {
			seen.push(messages.map((m) => m[0] as symbol));
		});

		s.down([[DIRTY], [DATA, 1]]);

		expect(s.cache).toBe(1);
		expect(s.status).toBe("settled");
		// SENTINEL node: subscribe delivers [[START]] alone (no cached value).
		// The explicit DIRTY+DATA batch is partitioned by tier: DIRTY (tier 1)
		// delivered first, DATA (tier 3) delivered second — two separate sink
		// calls.
		expect(seen).toEqual([[START], [DIRTY], [DATA]]);
		unsub();
	});

	it("derived node emits RESOLVED when equals says unchanged", () => {
		const source = node<number>({ initial: 1 });
		const d = derived([source], ([v]) => ((v as number) > 0 ? "positive" : "other"), {
			equals: (a, b) => a === b,
		});
		const seen: symbol[][] = [];
		const unsub = d.subscribe((messages) => {
			seen.push(messages.map((m) => m[0] as symbol));
		});

		source.down([[DATA, 2]]);

		expect(d.cache).toBe("positive");
		expect(seen).toContainEqual([RESOLVED]);
		unsub();
	});

	it("diamond settles once per upstream change", () => {
		const a = node<number>({ initial: 0 });
		const b = derived([a], ([v]) => (v as number) + 1);
		const c = derived([a], ([v]) => (v as number) + 2);
		let dRuns = 0;
		const d = derived([b, c], ([bv, cv]) => {
			dRuns += 1;
			return (bv as number) + (cv as number);
		});

		const unsub = d.subscribe(() => undefined);
		const before = dRuns;
		a.down([[DIRTY], [DATA, 5]]);
		const after = dRuns;

		expect(after - before).toBe(1);
		expect(d.cache).toBe(13);
		unsub();
	});

	it("fn throw is forwarded as ERROR downstream", () => {
		const source = node<number>({ initial: 0 });
		const broken = derived([source], () => {
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
		const mid = derived([source], ([v]) => ((v as number) > 0 ? "p" : "n"), {
			equals: (a, b) => a === b,
		});
		let leafRuns = 0;
		const leaf = derived([mid], ([m]) => {
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
		const broken = derived([source], () => {
			throw new Error("boom");
		});
		let deliveries = 0;
		const unsub = broken.subscribe(() => {
			deliveries += 1;
		});

		source.down([[DATA, 1]]);
		// 2 deliveries: DIRTY (from dep settling) + ERROR (from throwing fn).
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
		const mid = derived([source], ([v]) => new Map([["k", v]]), {
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
		const broken = derived([source], () => {
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
		expect(n.cache).toBe(42);
		n.down([[TEARDOWN]]);
		expect(n.cache).toBeUndefined();
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
		expect(n.cache).toBe(2);
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
		const d = derived([source], ([v]) => v as number);
		const seen: symbol[] = [];
		const unsub = d.subscribe((messages) => {
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
		const hop = derived([source], ([v]) => v as number);
		const leaf = derived([hop], ([v]) => (v as number) * 2);
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
		const hop = derived([source], ([v]) => v as number);
		const leaf = derived([hop], ([v]) => (v as number) + 1);
		let sawInvalidate = false;
		const unsub = leaf.subscribe((messages) => {
			sawInvalidate ||= messages.some((m) => m[0] === INVALIDATE);
		});

		expect(leaf.cache).toBe(43);
		source.down([[INVALIDATE]]);
		unsub();

		expect(sawInvalidate).toBe(true);
		expect(source.cache).toBeUndefined();
		expect(hop.cache).toBeUndefined();
		expect(leaf.cache).toBeUndefined();
		// ROM rule: state nodes preserve status across disconnect.
		// INVALIDATE set "dirty"; unsub() doesn't change that.
		expect(source.status).toBe("dirty");
	});

	it("INVALIDATE clears dep memo so identical DATA triggers recompute", () => {
		const source = node<number>({ initial: 7 });
		let runs = 0;
		const d = derived([source], ([v]) => {
			runs += 1;
			return (v as number) + 1;
		});
		const unsub = d.subscribe(() => undefined);
		expect(runs).toBe(1);
		expect(d.cache).toBe(8);
		source.down([[INVALIDATE]]);
		source.down([[DIRTY], [DATA, 7]]);

		expect(runs).toBe(2);
		expect(d.cache).toBe(8);
		unsub();
	});

	it("supports node(fn, opts) producer form", () => {
		const p = node(
			(_data, actions) => {
				actions.down([[DATA, 42]]);
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
		// Producer emits 42 during _startProducer → delivered to subscriber
		// via _downToSinks. Subscribe-time push is skipped (value was freshly
		// produced during this subscribe call).
		expect(values).toEqual([42]);
	});

	it("completeWhenDepsComplete: false suppresses auto-COMPLETE", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const d = derived([a, b], ([av, bv]) => (av as number) + (bv as number), {
			completeWhenDepsComplete: false,
		});
		const seen: symbol[] = [];
		const unsub = d.subscribe((messages) => {
			for (const m of messages) {
				seen.push(m[0] as symbol);
			}
		});

		a.down([[COMPLETE]]);
		b.down([[COMPLETE]]);
		unsub();

		expect(seen).not.toContain(COMPLETE);
		expect(d.status).not.toBe("completed");
	});

	it("completeWhenDepsComplete: true (default) emits COMPLETE when all deps complete", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const d = derived([a, b], ([av, bv]) => (av as number) + (bv as number));
		const seen: symbol[] = [];
		const unsub = d.subscribe((messages) => {
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
		const sum = derived(sources, (deps) => {
			fnRuns += 1;
			return (deps as number[]).reduce((a, b) => a + b, 0);
		});

		const unsub = sum.subscribe(() => undefined);
		const before = fnRuns;

		// Update source at index 35 (beyond 31-bit limit)
		sources[35].down([[DIRTY], [DATA, 100]]);

		expect(fnRuns - before).toBe(1);
		// Original sum: 0+1+...+39 = 780. Replace 35 with 100: 780 - 35 + 100 = 845
		expect(sum.cache).toBe(845);
		unsub();
	});

	it(">31 deps: diamond settlement works correctly", () => {
		const sources: ReturnType<typeof node<number>>[] = [];
		for (let i = 0; i < 35; i++) {
			sources.push(node<number>({ initial: 0 }));
		}

		let fnRuns = 0;
		const combined = derived(sources, (deps) => {
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
		expect(combined.cache).toBe(30);
		unsub();
	});

	it(">31 deps: COMPLETE fires when all deps complete", () => {
		const sources: ReturnType<typeof node<number>>[] = [];
		for (let i = 0; i < 35; i++) {
			sources.push(node<number>({ initial: i }));
		}

		const combined = derived(sources, (deps) => (deps as number[]).reduce((a, b) => a + b, 0));
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

	it("chain computes correctly through derived nodes", () => {
		const source = node<number>({ initial: 0 });
		const d1 = derived([source], ([v]) => (v as number) * 2);
		const leaf = derived([d1], ([v]) => (v as number) + 100);
		const unsub = leaf.subscribe(() => undefined);

		source.down([[DIRTY], [DATA, 5]]);

		// Values propagate correctly through chain
		expect(d1.cache).toBe(10);
		expect(leaf.cache).toBe(110);
		unsub();
	});

	it("diamond still settles once", () => {
		const a = node<number>({ initial: 0 });
		const b = derived([a], ([v]) => (v as number) + 1);
		const c = derived([a], ([v]) => (v as number) + 2);
		let dRuns = 0;
		const d = derived([b, c], ([bv, cv]) => {
			dRuns += 1;
			return (bv as number) + (cv as number);
		});

		const unsub = d.subscribe(() => undefined);
		const before = dRuns;
		a.down([[DIRTY], [DATA, 5]]);
		const after = dRuns;

		// Diamond settlement works correctly
		expect(after - before).toBe(1);
		expect(d.cache).toBe(13);
		unsub();
	});

	it("DIRTY is always delivered to subscribers", () => {
		const source = node<number>({ initial: 0 });
		const d1 = derived([source], ([v]) => (v as number) + 1);
		const d2 = derived([source], ([v]) => (v as number) + 2);

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

		// DIRTY is always present
		const allTypes1 = e1.flat();
		const allTypes2 = e2.flat();
		expect(allTypes1).toContain(DIRTY);
		expect(allTypes2).toContain(DIRTY);
	});

	it("handles RESOLVED for unchanged values", () => {
		const source = node<number>({ initial: 1 });
		const d = derived([source], ([v]) => ((v as number) > 0 ? "positive" : "negative"));
		const unsub1 = d.subscribe(() => undefined);

		const emissions: symbol[][] = [];
		unsub1();
		const unsub2 = d.subscribe((msgs) => {
			emissions.push(msgs.map((m) => m[0] as symbol));
		});

		emissions.length = 0;
		// Value changes but derived result stays "positive"
		source.down([[DIRTY], [DATA, 2]]);

		expect(d.cache).toBe("positive");
		// Should emit RESOLVED (not DATA) since value unchanged
		const allTypes = emissions.flat();
		expect(allTypes).toContain(RESOLVED);
		expect(allTypes).not.toContain(DATA);
		unsub2();
	});

	it("standalone DIRTY passes through to derived nodes", () => {
		const source = node<number>({ initial: 0 });
		const d = derived([source], ([v]) => (v as number) * 2);
		const seen: symbol[] = [];
		const unsub = d.subscribe((messages) => {
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
		const d = derived([a, b], ([av, bv]) => {
			fnRuns += 1;
			return (av as number) + (bv as number);
		});

		const unsub = d.subscribe(() => undefined);
		const before = fnRuns;

		// a sends DIRTY, then COMPLETEs instead of DATA/RESOLVED
		// b sends a normal update
		a.down([[DIRTY]]);
		a.down([[COMPLETE]]);
		b.down([[DIRTY], [DATA, 10]]);

		// derived should still recompute with latest values
		expect(fnRuns).toBeGreaterThan(before);
		expect(d.cache).toBe(11); // a=1 (initial, no DATA), b=10
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
		const d1 = derived([source], ([v]) => (v as number) + 1);
		const d2 = derived([source], ([v]) => (v as number) + 2);
		const d3 = derived([source], ([v]) => (v as number) + 3);

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
		expect(source.cache).toBe(5);
	});
});

describe("D1: sink snapshot during emitToSinks", () => {
	it("unsubscribing another sink mid-delivery does not skip it", () => {
		const src = node<number>();
		const log: string[] = [];
		let unsubB: () => void = () => {};
		const unsubA = src.subscribe((msgs) => {
			// Only unsub B during the actual DATA delivery (ignore the
			// subscribe-time [[START]] handshake).
			if (msgs.some((m) => m[0] === DATA)) {
				log.push("A");
				unsubB();
			}
		});
		unsubB = src.subscribe((msgs) => {
			if (msgs.some((m) => m[0] === DATA)) log.push("B");
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
		const d = derived([a, b], ([av, bv]) => {
			return (av as number) + (bv as number);
		});
		d.subscribe((msgs) => {
			sinkMsgs.push(msgs.map((m) => m[0] as symbol));
		});
		expect(d.cache).toBe(3);

		// a goes DIRTY then COMPLETE without DATA
		a.down([[DIRTY]]);
		expect(d.status).toBe("dirty");
		a.down([[COMPLETE]]);
		// Dep values unchanged → runFn fires the equality shortcut → RESOLVED
		// Node must NOT stay stuck in "dirty".
		expect(d.status).not.toBe("dirty");
		// Sinks should have received DIRTY then RESOLVED (value unchanged)
		const flat = sinkMsgs.flat();
		expect(flat).toContain(DIRTY);
		expect(flat).toContain(RESOLVED);
	});

	it("dep goes DIRTY then COMPLETE — multi-dep diamond unsticks", () => {
		const a = node({ initial: 1 });
		const b = node({ initial: 2 });
		const d = derived([a, b], ([av, bv]) => (av as number) + (bv as number));
		d.subscribe(() => undefined);

		// Both deps go dirty, only b settles; a completes without DATA
		a.down([[DIRTY]]);
		b.down([[DIRTY]]);
		expect(d.status).toBe("dirty");
		b.down([[DATA, 20]]);
		// b settled but a still dirty → no recompute yet
		a.down([[COMPLETE]]);
		// Now a is done (no pending dirty bits) → derived should recompute
		expect(d.status).not.toBe("dirty");
		expect(d.cache).toBe(21); // 1 + 20
	});
});

describe("D3: TEARDOWN updates status to sentinel", () => {
	it("source node status becomes sentinel after TEARDOWN", () => {
		const src = node({ initial: 1 });
		expect(src.status).toBe("settled");
		src.down([[TEARDOWN]]);
		expect(src.status).toBe("sentinel");
	});

	it("terminated node status becomes sentinel after TEARDOWN (B3)", () => {
		const src = node({ initial: 1 });
		src.down([[COMPLETE]]);
		expect(src.status).toBe("completed");
		src.down([[TEARDOWN]]);
		expect(src.status).toBe("sentinel");
	});
});

describe("connect-order re-entrancy guard", () => {
	it("multi-dep node sees all dep values on first compute (no premature runFn)", () => {
		// dep `a` emits DATA immediately on subscribe (producer pattern).
		// Without the _connecting guard, `runFn` would fire during the subscribe
		// loop before `b` is wired, seeing b.cache as undefined.
		const a = node(
			(_data, actions) => {
				actions.down([[DATA, "from-a"]]);
			},
			{ name: "a" },
		);
		const b = node<number>({ initial: 42, name: "b" });

		const seen: unknown[][] = [];
		const d = derived([a, b], (depValues) => {
			seen.push([...depValues]);
			return `${depValues[0]}-${depValues[1]}`;
		});

		const unsub = d.subscribe(() => undefined);

		// The first (and ideally only) runFn call should see both dep values
		expect(seen.length).toBeGreaterThanOrEqual(1);
		expect(seen[0]).toEqual(["from-a", 42]);
		expect(d.cache).toBe("from-a-42");
		unsub();
	});

	it("connect guard does not suppress post-connect updates", () => {
		const a = node(
			(_data, actions) => {
				actions.down([[DATA, 1]]);
			},
			{ name: "a" },
		);
		const b = node<number>({ initial: 2, name: "b" });
		const d = derived([a, b], ([av, bv]) => (av as number) + (bv as number));
		const unsub = d.subscribe(() => undefined);

		// After connect, normal updates still propagate
		b.down([[DIRTY], [DATA, 10]]);
		expect(d.cache).toBe(11);
		unsub();
	});

	it("runFn terminal guard: dep updates after COMPLETE do not recompute", () => {
		const src = node({ initial: 1 });
		let recompute = 0;
		const d = derived([src], ([v]) => {
			recompute += 1;
			return v;
		});
		d.subscribe(() => undefined);
		expect(recompute).toBe(1);
		src.down([[COMPLETE]]);
		// fn runs once more on the terminal event so operators like
		// last()/reduce can emit final values via ctx.terminalDeps.
		expect(recompute).toBe(2);
		expect(d.status).toBe("completed");
		src.down([[DIRTY], [DATA, 2]]);
		// After completion, no further recomputes.
		expect(recompute).toBe(2);
	});

	it("TEARDOWN after COMPLETE runs lifecycle and reaches sinks (B3)", () => {
		const src = node({ initial: 1 });
		const n = derived([src], ([v]) => v, { meta: { m: 0 } });
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
		const n = derived([node({ initial: 0 })], ([v]) => v, {
			name: "with-meta",
			meta: { description: "hi", status: "idle" },
		});
		expect(n.meta.description.cache).toBe("hi");
		expect(n.meta.status.cache).toBe("idle");
		expect(metaSnapshot(n)).toEqual({ description: "hi", status: "idle" });
	});

	it("meta field is independently subscribable from the parent node", () => {
		const src = node({ initial: 1 });
		const n = derived([src], ([v]) => (v as number) * 2, {
			meta: { err: null as string | null },
		});
		const seen: symbol[][] = [];
		const unsub = n.meta.err.subscribe((msgs) => {
			seen.push(msgs.map((m) => m[0] as symbol));
		});
		n.meta.err.down([[DIRTY], [DATA, "bad"]]);
		unsub();
		// Subscribe handshake partitions [[START], [DATA, null]]: START (tier 0)
		// delivers first, DATA (tier 3) second. Then the explicit down() further
		// partitions into DIRTY and DATA.
		expect(seen).toEqual([[START], [DATA], [DIRTY], [DATA]]);
		expect(metaSnapshot(n).err).toBe("bad");
	});

	it("meta can be updated without subscribing to the parent", () => {
		const n = node({ initial: 0, meta: { tag: "a" } });
		expect(n.meta.tag.cache).toBe("a");
		n.meta.tag.down([[DATA, "b"]]);
		expect(n.meta.tag.cache).toBe("b");
		expect(metaSnapshot(n)).toEqual({ tag: "b" });
	});

	it("metaSnapshot is empty when no meta option", () => {
		const n = node({ initial: 1 });
		expect(metaSnapshot(n)).toEqual({});
	});

	it("parent TEARDOWN still disconnects when one meta.down throws", () => {
		const src = node({ initial: 1 });
		const n = derived([src], ([v]) => (v as number) * 2, {
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
		expect(n.status).toBe("sentinel");
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
			(_data, actions) => {
				producerRuns += 1;
				actions.down([[DATA, producerRuns]]);
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

	it("metaSnapshot omits keys when cache getter throws", () => {
		const n = node({ initial: 0, meta: { fine: 1, bad: 2 } });
		Object.defineProperty(n.meta.bad, "cache", {
			get: () => {
				throw new Error("no snapshot");
			},
		});
		expect(metaSnapshot(n)).toEqual({ fine: 1 });
	});

	it("metaSnapshot omits every key whose cache getter throws", () => {
		const n = node({ initial: 0, meta: { ok: 0, x: 1, y: 2 } });
		for (const key of ["x", "y"] as const) {
			Object.defineProperty(n.meta[key], "cache", {
				get: () => {
					throw new Error("bad");
				},
			});
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
		const n = derived([src], ([v]) => (v as number) * 2, {
			name: "validate",
			meta: { description: "ok" },
		});
		const snap = describeNode(n);
		expect(snap.type).toBe("derived");
		expect(snap.deps).toEqual(["input"]);
		expect(snap.meta).toEqual({ description: "ok" });
	});
});

// §3.5 — equals substitution is a tier-3 dispatch invariant.
// Every outgoing DATA payload is compared against the live `.cache` inside
// `_updateState` (inside `_emit`), regardless of emission path: `actions.emit`,
// `actions.down`, `node.down`, or bundle-wrapped down. Cache advances per
// DATA immediately, so successive emissions within one fn run see the
// progressively updated value. See archive/docs/SESSION-foundation-redesign.md
// §3.5.1–.3.
describe("§3.5 equals substitution — dispatch-layer invariant", () => {
	function collectTier3(n: ReturnType<typeof node<number>>): {
		msgs: symbol[];
		values: Array<number | undefined>;
		unsub: () => void;
	} {
		const msgs: symbol[] = [];
		const values: Array<number | undefined> = [];
		const unsub = n.subscribe((batch) => {
			for (const m of batch) {
				msgs.push(m[0] as symbol);
				values.push(m[0] === DATA ? (m[1] as number) : undefined);
			}
		});
		// subscribe() synchronously delivers the START handshake (plus the
		// paired initial DATA if the node already has a cache). Drop that
		// baseline so tests only assert on emissions they trigger themselves.
		msgs.length = 0;
		values.length = 0;
		return { msgs, values, unsub };
	}

	it("multi-emit within a producer fn sees progressively advanced cache", () => {
		// Edge case from SESSION-foundation-redesign.md §3.5.1: fn emits
		// v1, v2, v3, v2 starting from cache=2. Each emit must see the
		// LIVE cache (advanced by the previous emit), not a snapshot at
		// fn entry. Downstream must see DATA(1),DATA(2),DATA(3),DATA(2) —
		// no spurious RESOLVED collapse — and the final node cache must
		// equal the last value actually emitted (2).
		const src = node<number>({ initial: 2 });
		const { msgs, values, unsub } = collectTier3(src);

		src.emit(1);
		src.emit(2);
		src.emit(3);
		src.emit(2);

		expect(msgs.filter((m) => m === DATA)).toHaveLength(4);
		expect(msgs.filter((m) => m === RESOLVED)).toHaveLength(0);
		expect(values.filter((v): v is number => v != null)).toEqual([1, 2, 3, 2]);
		expect(src.cache).toBe(2);
		unsub();
	});

	it("actions.emit(same) collapses to RESOLVED when value equals live cache", () => {
		const src = node<number>({ initial: 7 });
		const { msgs, unsub } = collectTier3(src);

		src.emit(7); // same as cache — should collapse

		expect(msgs).toContain(RESOLVED);
		expect(msgs.filter((m) => m === DATA)).toHaveLength(0);
		expect(src.cache).toBe(7);
		unsub();
	});

	it("raw node.down([[DATA, same]]) collapses to RESOLVED and synthesizes DIRTY (§1.3.1)", () => {
		// §3.5.1: equals substitution is protocol-invariant, not opt-in.
		// Raw `down([[DATA, same]])` runs through the dispatch-layer equals
		// check inside `_updateState`. When substituting DATA→RESOLVED with
		// no DIRTY in the wave, the walk synthesizes a DIRTY prefix so the
		// emitted batch `[[DIRTY], [RESOLVED]]` remains spec §1.3.1
		// compliant (DIRTY precedes RESOLVED).
		const src = node<number>({ initial: 42 });
		const { msgs, unsub } = collectTier3(src);

		src.down([[DATA, 42]]);

		expect(msgs).toEqual([DIRTY, RESOLVED]);
		expect(src.cache).toBe(42);
		unsub();
	});

	it("raw node.down([[DIRTY], [DATA, same]]) collapses DATA → RESOLVED without adding a second DIRTY", () => {
		// Bundle-style raw emission: caller frames DIRTY+DATA explicitly.
		// DIRTY is tier-1 and passes through unchanged. The tier-3 DATA
		// gets equals-substituted when payload matches live cache. Because
		// the caller already supplied DIRTY, the walk must NOT synthesize
		// a second one.
		const src = node<number>({ initial: 5 });
		const { msgs, unsub } = collectTier3(src);

		src.down([[DIRTY], [DATA, 5]]);

		expect(msgs).toEqual([DIRTY, RESOLVED]);
		expect(src.cache).toBe(5);
		unsub();
	});

	it("raw down with two same-value DATAs in one batch: both collapse, one synthetic DIRTY covers the wave", () => {
		// Per-message sequential walk: each DATA hits equals against live
		// cache, so a batch with two same-value DATAs collapses both. The
		// synthetic DIRTY prefix is inserted once at the head of the walk
		// and covers every RESOLVED in the batch.
		const src = node<number>({ initial: 9 });
		const { msgs, unsub } = collectTier3(src);

		src.down([
			[DATA, 9],
			[DATA, 9],
		]);

		expect(msgs).toEqual([DIRTY, RESOLVED, RESOLVED]);
		expect(src.cache).toBe(9);
		unsub();
	});

	it("interleaved non-substituted and substituted DATAs preserve ordering in rewritten copy", () => {
		// BH#4 regression guard: if a raw batch is `[DIRTY, DATA(1), DATA(1), DATA(2)]`
		// (cache already == 1), the walk must produce `[DIRTY, RESOLVED, RESOLVED, DATA(2)]`.
		// This exercises the `rewritten.push(m)` at the bottom of the non-
		// substituted DATA branch — if that push is ever removed, non-
		// substituted DATAs after a substituted one would silently disappear.
		const src = node<number>({ initial: 1 });
		const { msgs, values, unsub } = collectTier3(src);

		src.down([[DIRTY], [DATA, 1], [DATA, 1], [DATA, 2]]);

		expect(msgs).toEqual([DIRTY, RESOLVED, RESOLVED, DATA]);
		expect(values.filter((v): v is number => v != null)).toEqual([2]);
		expect(src.cache).toBe(2);
		unsub();
	});

	it("mixed emit+down+emit sequence sees coherent live cache through all paths", () => {
		// actions.emit and raw down must share the same `.cache` view:
		// 1. emit(x) when cache != x → DATA, cache = x
		// 2. down([[DATA, x]]) with cache = x → collapses to RESOLVED
		// 3. emit(x) again with cache = x → collapses to RESOLVED
		const src = node<number>({ initial: 0 });
		const { msgs, values, unsub } = collectTier3(src);

		src.emit(5); // 0 → 5: DATA
		src.down([[DATA, 5]]); // cache=5, same: RESOLVED (+ synthetic DIRTY)
		src.emit(5); // cache=5, same: RESOLVED (via bundle DIRTY prefix)

		expect(msgs.filter((m) => m === DATA)).toHaveLength(1);
		expect(msgs.filter((m) => m === RESOLVED)).toHaveLength(2);
		expect(values.filter((v): v is number => v != null)).toEqual([5]);
		expect(src.cache).toBe(5);
		unsub();
	});

	it("actions.emit(v) ≡ actions.down(bundle([DATA, v]).resolve()) — both paths hit the same dispatch walk", () => {
		// §3.5.2 taxonomy: emit is sugar for bundle-wrapped raw down. Two
		// identical state nodes emitting via the two paths must produce
		// byte-for-byte identical wire output.
		const nA = node<number>({ initial: 0 });
		const nB = node<number>({ initial: 0 });
		const collectedA = collectTier3(nA);
		const collectedB = collectTier3(nB);

		// nA uses actions.emit via node.emit sugar.
		nA.emit(5);
		// nB uses raw down with the exact batch bundle would produce for
		// emit(5) when status is not already "dirty": `[[DIRTY], [DATA, 5]]`.
		nB.down([[DIRTY], [DATA, 5]]);

		// Both should produce [DIRTY, DATA(5)] — nA via bundle auto-prefix
		// inside node.emit, nB via the explicit [DIRTY] in the raw batch.
		expect(collectedA.msgs).toEqual(collectedB.msgs);
		expect(collectedA.values).toEqual(collectedB.values);
		expect(nA.cache).toBe(nB.cache);
		collectedA.unsub();
		collectedB.unsub();
	});

	it("actions.emit(v) and raw actions.down([[DATA, v]]) are equivalent — both auto-prefix DIRTY", () => {
		// B1 unified dispatch: every entry point (emit, down, actions.*)
		// flows through `_emit` → `_frameBatch`, which auto-prefixes
		// DIRTY when any tier-3 payload is present and the node isn't
		// already in `"dirty"` status. emit(v) and down([[DATA,v]]) now
		// produce identical wire output.
		const nEmit = node<number>({ initial: 0 });
		const nRaw = node<number>({ initial: 0 });
		const collectedEmit = collectTier3(nEmit);
		const collectedRaw = collectTier3(nRaw);

		nEmit.emit(6);
		nRaw.down([[DATA, 6]]);

		expect(collectedEmit.msgs).toEqual([DIRTY, DATA]);
		expect(collectedRaw.msgs).toEqual([DIRTY, DATA]);
		collectedEmit.unsub();
		collectedRaw.unsub();
	});

	it("cache advance is visible to a post-DATA COMPLETE in the same walked batch", () => {
		// §3.5.3 — mixed-tier cache-advance ordering. The walk processes
		// messages in array order; when caller-supplied (or bundle-sorted)
		// order is tier-monotone, the tier-3 slice fully advances cache
		// before tier-4 handlers run. A COMPLETE observer sees the
		// post-DATA cache.
		const src = node<number>({ initial: 0 });
		const finalSnapshot = { cache: -1 };
		const unsub = src.subscribe((batch) => {
			for (const m of batch) {
				if (m[0] === COMPLETE) {
					finalSnapshot.cache = src.cache ?? -1;
				}
			}
		});

		src.down([[DATA, 99], [COMPLETE]]);

		expect(finalSnapshot.cache).toBe(99);
		expect(src.cache).toBe(99);
		unsub();
	});

	it("§3.5.3 unified dispatch path: tier sort happens inside _emit; cache advances within tier-3 slice", () => {
		// Under B1 the bundle builder is gone — tier sort lives inside
		// `_emit` → `_frameBatch`. Passing `[[COMPLETE], [DATA, 77]]`
		// directly to `actions.down(...)` produces the same result: the
		// framing stage sorts to tier order (DIRTY auto-prefix + DATA
		// then COMPLETE), advances cache within the tier-3 slice before
		// the COMPLETE handler runs, so downstream observers watching
		// COMPLETE see `cache === 77`.
		let completeCache = -1;
		const src = node<number>(
			[],
			(_data, actions) => {
				actions.down([[COMPLETE] as Message, [DATA, 77] as Message]);
			},
			{ initial: 0 },
		);
		const unsub = src.subscribe((batch) => {
			for (const m of batch) {
				if (m[0] === COMPLETE) completeCache = src.cache ?? -2;
			}
		});
		expect(completeCache).toBe(77);
		expect(src.cache).toBe(77);
		unsub();
	});

	it("passthrough forwarding with custom-equals source: passthrough's own walk substitutes, not the source's", () => {
		// A passthrough node (deps, no fn) forwards dep DATA through its
		// own `_emit` → `_updateState`, which compares against the
		// passthrough's own `_cached`. Two identical DATA emissions from
		// the source produce DATA then RESOLVED at the passthrough — even
		// though the passthrough code path never calls `actions.emit`.
		//
		// `src` uses `equals: () => false` so its own walk never collapses,
		// ensuring the second DATA reaches `pass` unchanged and we can
		// observe `pass`'s own substitution rather than src's.
		const src = node<number>({ equals: (_a, _b) => false });
		const pass = node<number>([src]);
		const { msgs, unsub } = collectTier3(pass as ReturnType<typeof node<number>>);

		src.down([[DIRTY], [DATA, 3]]);
		src.down([[DIRTY], [DATA, 3]]);

		const data = msgs.filter((m) => m === DATA);
		const resolved = msgs.filter((m) => m === RESOLVED);
		expect(data).toHaveLength(1); // first propagates as DATA
		expect(resolved).toHaveLength(1); // second collapses at pass (exact count)
		expect(pass.cache).toBe(3);
		unsub();
	});

	it("initial: undefined is a real cached value (not NO_VALUE) — equals fires and collapses matching emit", () => {
		// §2.5 load-bearing semantic: `"initial" in opts` is the
		// presence check, NOT `opts.initial !== undefined`. A node
		// constructed with `initial: undefined` has a real cached value
		// (undefined) and subsequent emit(undefined) must collapse to
		// RESOLVED via equals. A node with no `initial` key at all has
		// `_cached === NO_VALUE` and the first emit(undefined) passes
		// through as DATA.
		const nWithInitial = node<number | undefined>({ initial: undefined });
		const nWithout = node<number | undefined>();

		const collectedWith = collectTier3(nWithInitial as unknown as ReturnType<typeof node<number>>);
		const collectedWithout = collectTier3(nWithout as unknown as ReturnType<typeof node<number>>);

		nWithInitial.emit(undefined);
		nWithout.emit(undefined);

		// With initial: undefined — equals(undefined, undefined) = true → collapse
		expect(collectedWith.msgs.filter((m) => m === DATA)).toHaveLength(0);
		expect(collectedWith.msgs).toContain(RESOLVED);

		// Without initial — _cached is NO_VALUE → equals skipped → passes as DATA
		expect(collectedWithout.msgs.filter((m) => m === DATA)).toHaveLength(1);

		collectedWith.unsub();
		collectedWithout.unsub();
	});

	it("equals throw mid-batch delivers successfully-walked prefix then ERROR (P2 atomicity)", () => {
		// BH#1 fix: when equals throws on message N, the walk aborts,
		// returns the prefix walked up to (but not including) N, `_emit`
		// delivers that prefix to sinks, then emits a fresh ERROR batch.
		// Subscribers observe `[...walked_prefix, ERROR]`, coherent with
		// `.cache` which was advanced during the prefix walk.
		let calls = 0;
		const src = node<number>({
			initial: 0,
			equals: (a, b) => {
				calls += 1;
				// Throw on the second equals call (which fires for DATA(7)).
				if (calls >= 2) throw new Error("equals boom");
				return a === b;
			},
		});
		const seen: Array<[symbol, unknown]> = [];
		const unsub = src.subscribe((batch) => {
			for (const m of batch) seen.push([m[0] as symbol, m[1]]);
		});
		// Truncate the START handshake baseline (START + paired initial DATA(0))
		// so assertions only cover emissions from the down() call below.
		seen.length = 0;

		// Batch: DIRTY, DATA(5) — first equals call, returns false, advances cache.
		// DATA(7) — second equals call, throws. Walk aborts at index 2.
		// Prefix `[DIRTY, DATA(5)]` is delivered, then ERROR.
		src.down([[DIRTY], [DATA, 5], [DATA, 7]]);

		const msgKinds = seen.map(([k]) => k);
		expect(msgKinds).toContain(DIRTY);
		expect(msgKinds).toContain(DATA);
		expect(msgKinds).toContain(ERROR);
		// DATA(5) was delivered (walked prefix), DATA(7) was NOT (aborted).
		const dataValues = seen.filter(([k]) => k === DATA).map(([, v]) => v);
		expect(dataValues).toEqual([5]);
		// Cache advanced to 5 during prefix walk; never became 7.
		expect(src.cache).toBe(5);
		unsub();
	});
});
