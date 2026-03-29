import { describe, expect, it } from "vitest";
import { COMPLETE, DATA } from "../../core/messages.js";
import { state } from "../../core/sugar.js";
import {
	combine,
	concat,
	distinctUntilChanged,
	elementAt,
	filter,
	find,
	first,
	last,
	map,
	merge,
	pairwise,
	race,
	reduce,
	scan,
	skip,
	startWith,
	take,
	takeUntil,
	takeWhile,
	tap,
	withLatestFrom,
	zip,
} from "../../extra/operators.js";

function collect(node: { subscribe: (fn: (m: unknown) => void) => () => void }) {
	const batches: unknown[][] = [];
	const unsub = node.subscribe((msgs) => {
		batches.push([...msgs]);
	});
	return { batches, unsub };
}

describe("extra operators (Tier 1)", () => {
	it("map / filter / tap", () => {
		const s = state(1);
		const m = map(s, (n) => n * 2);
		const f = filter(m, (n) => n > 2);
		const seen: number[] = [];
		const t = tap(f, (n) => {
			seen.push(n);
		});
		const { batches, unsub } = collect(t);
		s.down([[DATA, 2]]);
		expect(seen.filter((n) => n === 4).length).toBeGreaterThanOrEqual(1);
		expect(batches.some((b) => b.some((x) => x[0] === DATA))).toBe(true);
		unsub();
	});

	it("scan and reduce", () => {
		const s = state(0);
		const sc = scan(s, (a, x) => a + (x as number), 0);
		const { batches: bs } = collect(sc);
		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);
		expect(sc.get()).toBe(3);
		expect(bs.length).toBeGreaterThan(0);

		const sR = state(0);
		const r = reduce(sR, (a, x) => a + (x as number), 0);
		const { batches: br } = collect(r);
		sR.down([[DATA, 10]]);
		sR.down([[COMPLETE]]);
		expect(br.some((b) => b.some((m) => m[0] === DATA))).toBe(true);
		expect(br.some((b) => b.some((m) => m[0] === COMPLETE))).toBe(true);
	});

	it("take counts only DATA (composes with skip)", () => {
		const s = state(0);
		const out = take(skip(s, 1), 2);
		const { batches } = collect(out);
		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);
		s.down([[DATA, 3]]);
		const dataVals = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		expect(dataVals).toEqual([2, 3]);
		expect(batches.flat().some((m) => m[0] === COMPLETE)).toBe(true);
	});

	it("take(0) completes without DATA", () => {
		const s = state(1);
		const out = take(s, 0);
		const { batches } = collect(out);
		expect(out.get()).toBe(undefined);
		expect(batches.flat().some((m) => m[0] === COMPLETE)).toBe(true);
	});

	it("takeWhile and first", () => {
		const s = state(1);
		const tw = takeWhile(s, (n) => (n as number) < 3);
		const { batches } = collect(tw);
		s.down([[DATA, 2]]);
		s.down([[DATA, 5]]);
		const dataVals = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		expect(dataVals).toEqual([1, 2]);

		const s2 = state(9);
		const f2 = first(s2);
		const { batches: bf2 } = collect(f2);
		s2.down([[DATA, 9]]);
		expect(bf2.flat().filter((m) => m[0] === DATA).length).toBe(1);
	});

	it("takeUntil, distinctUntilChanged, pairwise", () => {
		const s = state(0);
		const stop = state(0);
		const tu = takeUntil(s, stop);
		const { batches } = collect(tu);
		s.down([[DATA, 1]]);
		stop.down([[DATA, 1]]);
		expect(batches.flat().some((m) => m[0] === COMPLETE)).toBe(true);

		const s2 = state(1);
		const d = distinctUntilChanged(s2);
		const { batches: bd } = collect(d);
		s2.down([[DATA, 1]]);
		s2.down([[DATA, 1]]);
		const dataCount = bd.flat().filter((m) => m[0] === DATA).length;
		expect(dataCount).toBe(1);

		const s3 = state(0);
		const p = pairwise(s3);
		const { batches: bp } = collect(p);
		s3.down([[DATA, 1]]);
		s3.down([[DATA, 2]]);
		const lastData = bp
			.flat()
			.filter((m) => m[0] === DATA)
			.at(-1)?.[1] as readonly [number, number] | undefined;
		expect(lastData).toEqual([1, 2]);
	});

	it("combine, zip, merge, concat, race", () => {
		const a = state(1);
		const b = state(2);
		const c = combine([a, b] as const);
		collect(c);
		a.down([[DATA, 10]]);
		expect(c.get()).toEqual([10, 2]);

		const x = state(1);
		const y = state(2);
		const z = zip([x, y] as const);
		const { batches: bz } = collect(z);
		x.down([[DATA, 3]]);
		y.down([[DATA, 4]]);
		expect(bz.flat().some((m) => m[0] === DATA)).toBe(true);

		const m1 = state(1);
		const m2 = state(2);
		const mg = merge([m1, m2]);
		const { batches: bm } = collect(mg);
		m1.down([[DATA, 5]]);
		expect(bm.length).toBeGreaterThan(0);

		const e1 = state(0);
		const e2 = state(0);
		const mgc = merge([e1, e2]);
		const { batches: bmc } = collect(mgc);
		e1.down([[COMPLETE]]);
		expect(bmc.flat().some((m) => m[0] === COMPLETE)).toBe(false);
		e2.down([[COMPLETE]]);
		expect(bmc.flat().some((m) => m[0] === COMPLETE)).toBe(true);

		const f = state(1);
		const sec = state(2);
		const co = concat(f, sec);
		const { batches: bco } = collect(co);
		f.down([[DATA, 7]]);
		f.down([[COMPLETE]]);
		sec.down([[DATA, 8]]);
		const concatData = bco
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		expect(concatData).toContain(7);
		expect(concatData).toContain(8);

		const r1 = state(1);
		const r2 = state(2);
		const rc = race([r1, r2]);
		const { batches: br } = collect(rc);
		r1.down([[DATA, 11]]);
		expect(br.flat().filter((m) => m[0] === DATA).length).toBeGreaterThanOrEqual(1);
	});

	it("startWith, elementAt, find, last", () => {
		const s = state(0);
		const sw = startWith(s, -1);
		const { batches: bsw } = collect(sw);
		s.down([[DATA, 0]]);
		expect(
			bsw
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]),
		).toContain(-1);

		const s2 = state(0);
		const ea = elementAt(s2, 2);
		const { batches: bea } = collect(ea);
		s2.down([[DATA, 10]]);
		s2.down([[DATA, 20]]);
		s2.down([[DATA, 30]]);
		expect(bea.flat().find((m) => m[0] === DATA)?.[1]).toBe(30);

		const s3 = state(0);
		const fd = find(s3, (n) => (n as number) >= 2);
		const { batches: bfd } = collect(fd);
		s3.down([[DATA, 1]]);
		s3.down([[DATA, 2]]);
		expect(bfd.flat().find((m) => m[0] === DATA)?.[1]).toBe(2);

		const s4 = state(0);
		const la = last(s4, { defaultValue: 99 });
		const { batches: bla } = collect(la);
		s4.down([[DATA, 42]]);
		s4.down([[COMPLETE]]);
		expect(bla.flat().find((m) => m[0] === DATA)?.[1]).toBe(42);
	});

	it("withLatestFrom forwards primary with secondary snapshot", () => {
		const p = state(1);
		const q = state(2);
		const w = withLatestFrom(p, q);
		const { batches } = collect(w);
		q.down([[DATA, 20]]);
		p.down([[DATA, 10]]);
		const dataMsg = batches.flat().find((m) => m[0] === DATA);
		expect(dataMsg?.[1]).toEqual([10, 20]);
	});

	it("race continues forwarding from winner (not just first DATA)", () => {
		const a = state(0);
		const b = state(0);
		const rc = race([a, b]);
		const { batches } = collect(rc);
		a.down([[DATA, 1]]);
		a.down([[DATA, 2]]);
		b.down([[DATA, 99]]);
		const dataVals = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		expect(dataVals).toEqual([1, 2]);
	});

	it("map through diamond topology", () => {
		const src = state(1);
		const left = map(src, (n) => (n as number) * 2);
		const right = map(src, (n) => (n as number) + 10);
		const combo = combine([left, right] as const);
		collect(combo);
		src.down([[DATA, 3]]);
		expect(combo.get()).toEqual([6, 13]);
	});

	it("reduce emits only on COMPLETE", () => {
		const s = state(0);
		const r = reduce(s, (a, x) => a + (x as number), 0);
		const { batches } = collect(r);
		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);
		expect(batches.flat().filter((m) => m[0] === DATA).length).toBe(0);
		s.down([[COMPLETE]]);
		const dataVals = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		expect(dataVals).toEqual([3]);
		expect(batches.flat().some((m) => m[0] === COMPLETE)).toBe(true);
	});

	it("concat buffers second-source DATA during phase 0", () => {
		const a = state(0);
		const b = state(0);
		const co = concat(a, b);
		const { batches } = collect(co);
		b.down([[DATA, 50]]);
		a.down([[COMPLETE]]);
		const dataVals = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		expect(dataVals).toContain(50);
	});
});
