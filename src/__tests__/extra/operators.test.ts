import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA, DIRTY, ERROR, PAUSE, RESOLVED, RESUME } from "../../core/messages.js";
import { producer, state } from "../../core/sugar.js";
import {
	audit,
	bufferCount,
	combine,
	concat,
	concatMap,
	debounce,
	delay,
	distinctUntilChanged,
	elementAt,
	exhaustMap,
	filter,
	find,
	first,
	interval,
	last,
	map,
	merge,
	mergeMap,
	pairwise,
	pausable,
	race,
	reduce,
	repeat,
	rescue,
	sample,
	scan,
	skip,
	startWith,
	switchMap,
	take,
	takeUntil,
	takeWhile,
	tap,
	throttle,
	timeout,
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

function tick(ms = 0): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("extra operators (Tier 1)", () => {
	// Regression: GRAPHREFLY-SPEC §1.3 — derived map forwards DATA through the protocol.
	it("map doubles values for downstream subscribers", () => {
		const s = state(1);
		const m = map(s, (n) => n * 2);
		const { batches, unsub } = collect(m);
		s.down([[DATA, 2]]);
		expect(batches.some((b) => b.some((x) => x[0] === DATA && x[1] === 4))).toBe(true);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — filter is a derived gate on settled values.
	it("filter passes only values matching the predicate", () => {
		const s = state(1);
		const f = filter(
			map(s, (n) => n * 2),
			(n) => n > 2,
		);
		const { batches, unsub } = collect(f);
		s.down([[DATA, 2]]);
		expect(batches.some((b) => b.some((x) => x[0] === DATA && x[1] === 4))).toBe(true);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §2.6 — tap observes without changing the stream shape.
	it("tap runs side effects for each forwarded DATA", () => {
		const s = state(1);
		const seen: number[] = [];
		const t = tap(
			filter(
				map(s, (n) => n * 2),
				(n) => n > 2,
			),
			(n) => {
				seen.push(n);
			},
		);
		const { batches, unsub } = collect(t);
		s.down([[DATA, 2]]);
		expect(seen.filter((n) => n === 4).length).toBeGreaterThanOrEqual(1);
		expect(batches.some((b) => b.some((x) => x[0] === DATA))).toBe(true);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — scan accumulates on each DATA/RESOLVED cycle.
	it("scan folds successive DATA into an accumulator", () => {
		const s = state(0);
		const sc = scan(s, (a, x) => a + (x as number), 0);
		const { batches: bs } = collect(sc);
		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);
		expect(sc.get()).toBe(3);
		expect(bs.length).toBeGreaterThan(0);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.5 — reduce emits once when upstream completes.
	it("reduce emits aggregated DATA on upstream COMPLETE", () => {
		const sR = state(0);
		const r = reduce(sR, (a, x) => a + (x as number), 0);
		const { batches: br } = collect(r);
		sR.down([[DATA, 10]]);
		sR.down([[COMPLETE]]);
		expect(br.some((b) => b.some((m) => m[0] === DATA))).toBe(true);
		expect(br.some((b) => b.some((m) => m[0] === COMPLETE))).toBe(true);
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — take counts DATA emissions (RESOLVED does not advance).
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

	// Regression: GRAPHREFLY-SPEC §1.3.4 — non-positive take completes immediately (terminal).
	it("take(0) completes without DATA", () => {
		const s = state(1);
		const out = take(s, 0);
		const { batches } = collect(out);
		expect(out.get()).toBe(undefined);
		expect(batches.flat().some((m) => m[0] === COMPLETE)).toBe(true);
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — takeWhile completes when predicate fails.
	it("takeWhile forwards DATA until predicate is false", () => {
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
	});

	// Regression: GRAPHREFLY-SPEC §1.3.4 — first is take(1); terminal after one DATA.
	it("first emits a single DATA then completes", () => {
		const s2 = state(9);
		const f2 = first(s2);
		const { batches: bf2 } = collect(f2);
		s2.down([[DATA, 9]]);
		expect(bf2.flat().filter((m) => m[0] === DATA).length).toBe(1);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.5 — takeUntil completes when notifier matches predicate.
	it("takeUntil completes when notifier emits matching DATA", () => {
		const s = state(0);
		const stop = state(0);
		const tu = takeUntil(s, stop);
		const { batches } = collect(tu);
		s.down([[DATA, 1]]);
		stop.down([[DATA, 1]]);
		expect(batches.flat().some((m) => m[0] === COMPLETE)).toBe(true);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.3 — distinctUntilChanged suppresses unchanged consecutive values.
	it("distinctUntilChanged does not repeat DATA for identical consecutive values", () => {
		const s2 = state(1);
		const d = distinctUntilChanged(s2);
		const { batches: bd } = collect(d);
		s2.down([[DATA, 1]]);
		s2.down([[DATA, 1]]);
		const dataCount = bd.flat().filter((m) => m[0] === DATA).length;
		expect(dataCount).toBe(1);
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — pairwise needs two source emissions before first tuple.
	it("pairwise emits a tuple of the last two DATA values", () => {
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

	// Regression: GRAPHREFLY-SPEC §1.3 — combine is multi-dep derived (latest tuple).
	it("combine reflects latest value from each source", () => {
		const a = state(1);
		const b = state(2);
		const c = combine(a, b);
		collect(c);
		a.down([[DATA, 10]]);
		expect(c.get()).toEqual([10, 2]);
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — zip pairs DATA in lockstep.
	it("zip emits when each source has produced a value", () => {
		const x = state(1);
		const y = state(2);
		const z = zip(x, y);
		const { batches: bz } = collect(z);
		x.down([[DATA, 3]]);
		y.down([[DATA, 4]]);
		expect(bz.flat().some((m) => m[0] === DATA)).toBe(true);
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — merge forwards any source DATA.
	it("merge forwards DATA from the first source that emits", () => {
		const m1 = state(1);
		const m2 = state(2);
		const mg = merge(m1, m2);
		const { batches: bm } = collect(mg);
		m1.down([[DATA, 5]]);
		expect(bm.length).toBeGreaterThan(0);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.5 — merge completes only after all sources complete.
	it("merge completes only after every source has completed", () => {
		const e1 = state(0);
		const e2 = state(0);
		const mgc = merge(e1, e2);
		const { batches: bmc } = collect(mgc);
		e1.down([[COMPLETE]]);
		expect(bmc.flat().some((m) => m[0] === COMPLETE)).toBe(false);
		e2.down([[COMPLETE]]);
		expect(bmc.flat().some((m) => m[0] === COMPLETE)).toBe(true);
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — concat serializes sources after the first completes.
	it("concat forwards second source only after the first completes", () => {
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
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — race mirrors first winning DATA source.
	it("race forwards DATA from whichever source wins", () => {
		const r1 = state(1);
		const r2 = state(2);
		const rc = race(r1, r2);
		const { batches: br } = collect(rc);
		r1.down([[DATA, 11]]);
		expect(br.flat().filter((m) => m[0] === DATA).length).toBeGreaterThanOrEqual(1);
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — startWith prepends an initial DATA.
	it("startWith emits seed before upstream DATA", () => {
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
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — elementAt is indexed take-after-skip.
	it("elementAt emits the nth DATA (zero-based index)", () => {
		const s2 = state(0);
		const ea = elementAt(s2, 2);
		const { batches: bea } = collect(ea);
		s2.down([[DATA, 10]]);
		s2.down([[DATA, 20]]);
		s2.down([[DATA, 30]]);
		expect(bea.flat().find((m) => m[0] === DATA)?.[1]).toBe(30);
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — find is filter + take(1).
	it("find completes on first value matching the predicate", () => {
		const s3 = state(0);
		const fd = find(s3, (n) => (n as number) >= 2);
		const { batches: bfd } = collect(fd);
		s3.down([[DATA, 1]]);
		s3.down([[DATA, 2]]);
		expect(bfd.flat().find((m) => m[0] === DATA)?.[1]).toBe(2);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.5 — last emits on upstream COMPLETE (or default).
	it("last emits the final DATA when upstream completes", () => {
		const s4 = state(0);
		const la = last(s4, { defaultValue: 99 });
		const { batches: bla } = collect(la);
		s4.down([[DATA, 42]]);
		s4.down([[COMPLETE]]);
		expect(bla.flat().find((m) => m[0] === DATA)?.[1]).toBe(42);
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — withLatestFrom pairs primary with latest secondary.
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

	// Regression: GRAPHREFLY-SPEC §1.3 — race winner keeps streaming; loser ignored after pick.
	it("race continues forwarding from winner (not just first DATA)", () => {
		const a = state(0);
		const b = state(0);
		const rc = race(a, b);
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

	// Regression: GRAPHREFLY-SPEC §1.3.2 — diamond: phase-1 completes before phase-2 recompute.
	it("map through diamond topology", () => {
		const src = state(1);
		const left = map(src, (n) => (n as number) * 2);
		const right = map(src, (n) => (n as number) + 10);
		const combo = combine(left, right);
		collect(combo);
		src.down([[DATA, 3]]);
		expect(combo.get()).toEqual([6, 13]);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.5 — reduce aggregates until COMPLETE, then emits once.
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

	// Regression: GRAPHREFLY-SPEC §1.3 — concat may buffer second source until first completes.
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

describe("extra operators (Tier 2)", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	// Regression: GRAPHREFLY-SPEC §2 — switchMap tears down previous inner subscription on new outer DATA.
	it("switchMap unsubscribes prior inner", () => {
		const src = state(0);
		const innerA = state(100);
		const innerB = state(200);
		const out = switchMap(src, (v) => ((v as number) === 0 ? innerA : innerB));
		const { batches, unsub } = collect(out);
		innerA.down([[DATA, 11]]);
		src.down([[DATA, 1]]);
		innerB.down([[DATA, 22]]);
		innerA.down([[DATA, 99]]);
		const dataVals = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1] as number);
		expect(dataVals).toContain(11);
		expect(dataVals).toContain(22);
		expect(dataVals).not.toContain(99);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3.3 — exhaustMap may emit RESOLVED while inner is busy.
	it("exhaustMap drops outer DATA while inner active", () => {
		const src = state(0);
		const inner = state(10);
		const out = exhaustMap(src, () => inner);
		const { batches, unsub } = collect(out);
		src.down([[DATA, 1]]);
		inner.down([[DATA, 1]]);
		src.down([[DATA, 2]]);
		const resolvedAfterSecond = batches.flat().filter((m) => m[0] === RESOLVED);
		expect(resolvedAfterSecond.length).toBeGreaterThanOrEqual(1);
		inner.down([[COMPLETE]]);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §2 — concatMap waits for inner COMPLETE before next outer value.
	it("concatMap runs inners sequentially", () => {
		const src = state(0);
		const a = state(100);
		const b = state(200);
		let wave = 0;
		const out = concatMap(src, () => {
			wave += 1;
			return wave === 1 ? a : b;
		});
		const { batches, unsub } = collect(out);
		src.down([[DATA, 1]]);
		b.down([[DATA, 999]]);
		expect(
			batches
				.flat()
				.filter((m) => m[0] === DATA)
				.some((m) => m[1] === 999),
		).toBe(false);
		a.down([[COMPLETE]]);
		src.down([[DATA, 2]]);
		b.down([[DATA, 201]]);
		expect(
			batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1] as number),
		).toContain(201);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §2 — mergeMap multiplexes concurrent inner subscriptions.
	it("mergeMap keeps multiple inners active", () => {
		const src = state(0);
		const inner1 = state(1);
		const inner2 = state(2);
		let pick = 0;
		const out = mergeMap(src, () => {
			pick += 1;
			return pick === 1 ? inner1 : inner2;
		});
		const { batches, unsub } = collect(out);
		src.down([[DATA, 1]]);
		src.down([[DATA, 2]]);
		inner1.down([[DATA, 10]]);
		inner2.down([[DATA, 20]]);
		const dataVals = new Set(
			batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1] as number),
		);
		expect(dataVals.has(10)).toBe(true);
		expect(dataVals.has(20)).toBe(true);
		inner1.down([[COMPLETE]]);
		inner2.down([[COMPLETE]]);
		src.down([[COMPLETE]]);
		unsub();
	});

	// Regression: roadmap §3.1b — higher-order projects accept scalar via fromAny coercion.
	it("switchMap coerces scalar project returns", () => {
		const src = state(0);
		const out = switchMap(src, (v) => (v as number) + 100);
		const { batches, unsub } = collect(out);
		src.down([[DATA, 2]]);
		const dataVals = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		expect(dataVals).toContain(102);
		unsub();
	});

	// Regression: roadmap §3.1b — higher-order projects accept PromiseLike via fromAny coercion.
	it("switchMap coerces Promise project returns", async () => {
		const src = state(0);
		const out = switchMap(src, (v) => Promise.resolve((v as number) + 5));
		const { batches, unsub } = collect(out);
		src.down([[DATA, 3]]);
		await tick(0);
		const dataVals = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		expect(dataVals).toContain(8);
		unsub();
	});

	// Regression: parity 3.1 — forwardInner emits current settled inner value on attach.
	it("switchMap forwards settled inner current value immediately", () => {
		const src = state(1);
		const out = switchMap(src, (v) => state((v as number) * 10));
		const { batches, unsub } = collect(out);
		const dataVals = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		expect(dataVals).toContain(10);
		unsub();
	});

	// Regression: roadmap §3.1b — higher-order projects accept Iterable via fromAny coercion.
	it("concatMap coerces iterable project returns", () => {
		const src = producer<number>((_d, a) => {
			a.down([[DATA, 4], [COMPLETE]]);
		});
		const out = concatMap(src, (v) => [v * 2, v * 3]);
		const { batches, unsub } = collect(out);
		const dataVals = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1] as number);
		expect(dataVals).toEqual(expect.arrayContaining([8, 12]));
		unsub();
	});

	// Regression: roadmap §3.1b — higher-order projects accept AsyncIterable via fromAny coercion.
	it("mergeMap coerces async iterable project returns", async () => {
		const src = state(0);
		const out = mergeMap(src, async function* (v: number) {
			yield v + 1;
			yield v + 2;
		});
		const { batches, unsub } = collect(out);
		src.down([[DATA, 10]]);
		await tick(0);
		await tick(0);
		const dataVals = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1] as number);
		expect(dataVals).toEqual(expect.arrayContaining([11, 12]));
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — debounce delays phase-2 until quiet window (timers).
	it("debounce emits once after quiet window (fake timers)", () => {
		vi.useFakeTimers();
		const s = state(0);
		const out = debounce(s, 50);
		const { batches, unsub } = collect(out);
		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);
		s.down([[DATA, 3]]);
		expect(batches.flat().filter((m) => m[0] === DATA).length).toBe(0);
		vi.advanceTimersByTime(50);
		expect(batches.flat().find((m) => m[0] === DATA)?.[1]).toBe(3);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — delay forwards DIRTY immediately; DATA after timeout.
	it("delay shifts DATA by ms (fake timers)", () => {
		vi.useFakeTimers();
		const s = state(0);
		const out = delay(s, 40);
		const { batches, unsub } = collect(out);
		s.down([[DATA, 7]]);
		expect(batches.flat().filter((m) => m[0] === DATA).length).toBe(0);
		vi.advanceTimersByTime(40);
		expect(batches.flat().find((m) => m[0] === DATA)?.[1]).toBe(7);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3.4 — timeout emits ERROR when no DATA resets the timer.
	it("timeout errors when idle (fake timers)", () => {
		vi.useFakeTimers();
		const s = state(0);
		const out = timeout(s, 30);
		const { batches, unsub } = collect(out);
		vi.advanceTimersByTime(30);
		expect(batches.flat().some((m) => m[0] === ERROR)).toBe(true);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — throttle rate-limits DATA (leading edge).
	it("throttle leading edge passes first emission", () => {
		vi.useFakeTimers();
		const s = state(0);
		const out = throttle(s, 1_000, { trailing: false });
		const { batches, unsub } = collect(out);
		s.down([[DATA, 1]]);
		expect(batches.flat().find((m) => m[0] === DATA)?.[1]).toBe(1);
		s.down([[DATA, 2]]);
		expect(batches.flat().filter((m) => m[0] === DATA).length).toBe(1);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — sample pulls latest source value on notifier DATA.
	it("sample emits when notifier settles", () => {
		const src = state(1);
		const tick = state(0);
		const out = sample(src, tick);
		const { batches, unsub } = collect(out);
		src.down([[DATA, 10]]);
		tick.down([[DATA, 1]]);
		expect(batches.flat().find((m) => m[0] === DATA)?.[1]).toBe(10);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — bufferCount emits fixed-size arrays of DATA.
	it("bufferCount batches DATA", () => {
		const s = state(1);
		const out = bufferCount(s, 2);
		const { batches, unsub } = collect(out);
		s.down([[DATA, 2]]);
		expect(batches.flat().find((m) => m[0] === DATA)?.[1]).toEqual([1, 2]);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3.4 — rescue converts ERROR into downstream DATA.
	it("rescue maps ERROR to value", () => {
		const s = state(0);
		const out = rescue(s, () => 42);
		const { batches, unsub } = collect(out);
		s.down([[ERROR, new Error("x")]]);
		expect(batches.flat().find((m) => m[0] === DATA)?.[1]).toBe(42);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3.4 — rescue recovery failure propagates ERROR.
	it("rescue forwards ERROR when recover throws", () => {
		const s = state(0);
		const boom = new Error("recover");
		const out = rescue(s, () => {
			throw boom;
		});
		const { batches, unsub } = collect(out);
		s.down([[ERROR, new Error("up")]]);
		const errMsg = batches.flat().find((m) => m[0] === ERROR);
		expect(errMsg?.[1]).toBe(boom);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.2 — PAUSE buffers; RESUME flushes pending protocol messages.
	it("pausable buffers then flushes on RESUME", () => {
		const s = state(0);
		const out = pausable(s);
		const { batches, unsub } = collect(out);
		s.down([[PAUSE]]);
		s.down([[DIRTY]]);
		s.down([[DATA, 5]]);
		s.down([[RESUME]]);
		expect(batches.flat().filter((m) => m[0] === DATA).length).toBeGreaterThanOrEqual(1);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §2.1 — interval producer emits on timer while subscribed.
	it("interval ticks via producer (fake timers)", () => {
		vi.useFakeTimers();
		const tick = interval(100);
		const { batches, unsub } = collect(tick);
		vi.advanceTimersByTime(250);
		const values = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1] as number);
		expect(values.length).toBeGreaterThanOrEqual(2);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §2 — repeat resubscribes to source for N terminal rounds.
	it("repeat completes after N rounds", () => {
		const s = state(1, { resubscribable: true });
		const out = repeat(s, 2);
		const { batches, unsub } = collect(out);
		s.down([[COMPLETE]]);
		s.down([[COMPLETE]]);
		expect(batches.flat().some((m) => m[0] === COMPLETE)).toBe(true);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — audit samples latest after window (trailing edge).
	it("audit emits trailing-only after timer (fake timers)", () => {
		vi.useFakeTimers();
		const s = state(0);
		const out = audit(s, 100);
		const { batches, unsub } = collect(out);
		s.down([[DATA, 1]]);
		// No leading emit
		const immediate = batches.flat().filter((m) => m[0] === DATA);
		expect(immediate.length).toBe(0);
		vi.advanceTimersByTime(150);
		const after = batches.flat().filter((m) => m[0] === DATA);
		expect(after.length).toBe(1);
		expect(after[0][1]).toBe(1);
		unsub();
	});

	// Regression: operator validates repeat count > 0.
	it("repeat throws on count <= 0", () => {
		const s = state(0);
		expect(() => repeat(s, 0)).toThrow(RangeError);
	});

	// Regression: operator validates bufferCount count > 0.
	it("bufferCount throws on count <= 0", () => {
		const s = state(0);
		expect(() => bufferCount(s, 0)).toThrow(RangeError);
	});
});
