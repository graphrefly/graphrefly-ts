import { describe, expect, it } from "vitest";
import { DATA, DIRTY, RESOLVED } from "../../core/messages.js";
import { describeNode } from "../../core/meta.js";
import { type Node, node } from "../../core/node.js";
import { derived, derivedT, effect, effectT, pipe, producer, state } from "../../core/sugar.js";

describe("sugar constructors", () => {
	it("state(initial) is a manual source with initial value", () => {
		const s = state(10);
		expect(s.cache).toBe(10);
		const seen: symbol[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});
		s.down([[DIRTY], [DATA, 11]]);
		unsub();
		expect(s.cache).toBe(11);
		expect(seen).toContain(DIRTY);
		expect(seen).toContain(DATA);
	});

	it("state<T>() (zero-arg overload) starts in sentinel status with no cached DATA", () => {
		// qa D2: zero-arg `state<T>()` is the canonical sugar for "no
		// value yet" — replaces the prior `sentinelState<T>()` factory
		// (removed pre-1.0) and the `state<T>(undefined as unknown as T)`
		// cast workaround.
		const s = state<number>();
		expect(s.cache).toBeUndefined();
		expect(s.status).toBe("sentinel");
		const seen: Array<[symbol, unknown]> = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0] as symbol, m[1]]);
		});
		// Subscribe-with-sentinel: NO DATA arrives push-on-subscribe
		// (status="sentinel" means no cached value to replay).
		expect(seen.find(([t]) => t === DATA)).toBeUndefined();
		// First emit transitions to "settled" status with a real value.
		s.emit(42);
		expect(s.cache).toBe(42);
		expect(s.status).toBe("settled");
		expect(seen.find(([t]) => t === DATA)?.[1]).toBe(42);
		unsub();
	});

	it("state(null) caches null as a valid DATA value (distinct from sentinel)", () => {
		// Spec §2.2: `T | null` is the valid DATA domain; only `undefined`
		// is the SENTINEL. Confirm `state(null)` differs from `state()`:
		// the null cache puts the node in `"settled"` status with an
		// observable null DATA on subscribe.
		const s = state<number | null>(null);
		expect(s.cache).toBeNull();
		expect(s.status).toBe("settled");
		const seen: unknown[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1]);
			}
		});
		expect(seen).toEqual([null]);
		unsub();
	});

	it("producer runs on subscribe and can emit", () => {
		const p = producer<number>((actions) => {
			actions.emit(1);
		});
		const seen: number[] = [];
		const unsub = p.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1] as number);
			}
		});
		expect(p.cache).toBe(1);
		// Producer emits 1 during _startProducer → single delivery.
		expect(seen).toEqual([1]);
		unsub();
	});

	it("derived is an alias for deps + value-returning fn", () => {
		const src = state(2);
		const d = derived([src], ([v]) => (v as number) * 3);
		const seen: symbol[] = [];
		const unsub = d.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});
		src.down([[DATA, 3]]);
		expect(d.cache).toBe(9);
		expect(seen).toContain(DATA);
		unsub();
	});

	it("effect and producer set describe kind for describe()", () => {
		const e = effect([state(0)], () => {});
		expect(describeNode(e).type).toBe("effect");
		const p = producer((actions) => {
			actions.emit(1);
		});
		expect(describeNode(p).type).toBe("producer");
	});

	it("effect runs without auto-emit from return value", () => {
		const src = state(0);
		let runs = 0;
		const e = effect([src], () => {
			runs += 1;
			return undefined;
		});
		const unsub = e.subscribe(() => undefined);
		src.down([[DIRTY], [DATA, 1]]);
		unsub();
		// Initial connect runs once; dep update runs again.
		expect(runs).toBe(2);
		expect(e.cache).toBeUndefined();
	});

	it("derivedT propagates dep value types into the callback tuple (no casts)", () => {
		const a = state(2);
		const b = state("hi");
		// data is typed as readonly [number, string] — no casts needed.
		const out = derivedT([a, b] as const, ([sum, label]) => `${label}:${sum * 2}`);
		const unsub = out.subscribe(() => undefined);
		expect(out.cache).toBe("hi:4");
		a.down([[DATA, 5]]);
		expect(out.cache).toBe("hi:10");
		unsub();
	});

	it("effectT receives typed deps and runs without auto-emit", () => {
		const src = state(7);
		const flag = state(false);
		let lastSeen: [number, boolean] | undefined;
		const e = effectT([src, flag] as const, ([n, f]) => {
			// n is number, f is boolean — no `as` needed.
			lastSeen = [n, f];
		});
		const unsub = e.subscribe(() => undefined);
		expect(lastSeen).toEqual([7, false]);
		flag.down([[DATA, true]]);
		expect(lastSeen).toEqual([7, true]);
		unsub();
	});

	it("pipe chains unary node transforms", () => {
		const src = state(1);
		const doubled = (n: Node) => derived([n], ([v]) => (v as number) * 2);
		const out = pipe(src, doubled, doubled);
		const unsub = out.subscribe(() => undefined);
		expect(out.cache).toBe(4);
		unsub();
	});

	it("pipe with no ops returns source", () => {
		const src = state("x");
		expect(pipe(src)).toBe(src);
	});

	it("raw node with explicit actions.down() does not emit DATA", () => {
		const src = state(0);
		const d = node([src], (_data, actions) => {
			actions.down([[DIRTY], [RESOLVED]]);
		});
		const vals: unknown[] = [];
		const unsub = d.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) vals.push(m[1]);
			}
		});
		src.down([[DIRTY], [DATA, 1]]);
		unsub();
		expect(vals.length).toBe(0);
	});
});
