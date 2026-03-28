import { describe, expect, it } from "vitest";
import { DATA, DIRTY, RESOLVED } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { derived, effect, pipe, producer, state } from "../../core/sugar.js";

describe("sugar constructors", () => {
	it("state(initial) is a manual source with initial value", () => {
		const s = state(10);
		expect(s.get()).toBe(10);
		const seen: symbol[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});
		s.down([[DIRTY], [DATA, 11]]);
		unsub();
		expect(s.get()).toBe(11);
		expect(seen).toContain(DIRTY);
		expect(seen).toContain(DATA);
	});

	it("producer runs on subscribe and can emit", () => {
		const p = producer<number>((_deps, { emit }) => {
			emit(1);
		});
		const seen: number[] = [];
		const unsub = p.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1] as number);
			}
		});
		unsub();
		expect(p.get()).toBe(1);
		expect(seen).toEqual([1]);
	});

	it("derived is an alias for deps + value-returning fn", () => {
		const src = state(2);
		const d = derived([src], ([v]) => (v as number) * 3);
		const seen: symbol[] = [];
		const unsub = d.subscribe((msgs) => {
			for (const m of msgs) seen.push(m[0] as symbol);
		});
		src.down([[DATA, 3]]);
		unsub();
		expect(d.get()).toBe(9);
		expect(seen).toContain(DATA);
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
		expect(e.get()).toBeUndefined();
	});

	it("pipe chains unary node transforms", () => {
		const src = state(1);
		const doubled = (n: Node) => derived([n], ([v]) => (v as number) * 2);
		const out = pipe(src, doubled, doubled);
		const unsub = out.subscribe(() => undefined);
		expect(out.get()).toBe(4);
		unsub();
	});

	it("pipe with no ops returns source", () => {
		const src = state("x");
		expect(pipe(src)).toBe(src);
	});

	it("derived with explicit down() skips return-value emit", () => {
		const src = state(0);
		const d = derived([src], (_deps, { down }) => {
			down([[DIRTY], [RESOLVED]]);
			return 999;
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
