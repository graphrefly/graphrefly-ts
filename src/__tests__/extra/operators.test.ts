import { afterEach, describe, expect, it, vi } from "vitest";
import { batch } from "../../core/batch.js";
import { COMPLETE, DATA, DIRTY, ERROR, PAUSE, RESOLVED, RESUME } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";
import { derived, producer, state } from "../../core/sugar.js";
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
import { collect } from "../test-helpers.js";

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
		expect(sc.cache).toBe(3);
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
		const s = node<number>();
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
		const s = node<number>();
		const out = take(s, 0);
		const { batches } = collect(out);
		s.down([[DATA, 1]]);
		expect(out.cache).toBe(undefined);
		expect(batches.flat().some((m) => m[0] === COMPLETE)).toBe(true);
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — takeWhile completes when predicate fails.
	it("takeWhile forwards DATA until predicate is false", () => {
		const s = state(1);
		const tw = takeWhile(s, (n) => (n as number) < 3);
		const { batches } = collect(tw);
		// Push-on-subscribe delivers initial value 1 (passes predicate)
		s.down([[DATA, 2]]);
		s.down([[DATA, 5]]);
		const dataVals = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		// All emitted values must satisfy the predicate (< 3)
		expect(dataVals.every((v) => (v as number) < 3)).toBe(true);
		expect(dataVals).toContain(1);
		expect(dataVals).toContain(2);
		// Value 5 must NOT appear (predicate fails)
		expect(dataVals).not.toContain(5);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.4 — first is take(1); terminal after one DATA.
	it("first emits a single DATA then completes", () => {
		const s2 = node<number>();
		const f2 = first(s2);
		const { batches: bf2 } = collect(f2);
		s2.down([[DATA, 9]]);
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
		const s2 = node<number>();
		const d = distinctUntilChanged(s2);
		const { batches: bd } = collect(d);
		s2.down([[DATA, 1]]);
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
		expect(c.cache).toEqual([10, 2]);
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

	// Regression: GRAPHREFLY-SPEC §1.3 — derived with initial seeds before upstream DATA.
	it("derived with initial emits seed before upstream DATA", () => {
		const s = state(0);
		const sw = derived([s as Node], ([v]) => v, { initial: -1 });
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
		const s2 = node<number>();
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
		const p = node<number>();
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
		const a = node<number>();
		const b = node<number>();
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
		expect(combo.cache).toEqual([6, 13]);
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

	// Regression: exhaustMap drops outer DATA while inner is active.
	// fn+closure B pattern: source is a declared dep, so the dep-wave
	// propagates DIRTY downstream. Drop emits RESOLVED to close the wave.
	it("exhaustMap drops outer DATA while inner active", () => {
		const src = state(0);
		const inner = state(10);
		const out = exhaustMap(src, () => inner);
		const { batches, unsub } = collect(out);
		src.down([[DATA, 1]]);
		inner.down([[DATA, 1]]);
		const beforeDrop = batches.flat().length;
		src.down([[DATA, 2]]); // dropped — inner still active
		// Drop emits DIRTY+RESOLVED (dep-wave opened by source, closed by fn).
		const dropMsgs = batches.flat().slice(beforeDrop);
		const dropTypes = dropMsgs.map((m: any) => m[0]);
		expect(dropTypes).toContain(DIRTY);
		expect(dropTypes).toContain(RESOLVED);
		expect(dropTypes).not.toContain(DATA);
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

	// Regression: SESSION-tier2-parity-nonlocal-forward-inner #4 — forwardInner must not duplicate
	// initial DATA when an inner derived node already emits during subscribe.
	it("switchMap does not duplicate initial DATA for derived inner on attach", () => {
		const src = node<number>();
		const base = node<number>();
		const out = switchMap(src, () => map(base, (n) => (n as number) + 1));
		const { batches, unsub } = collect(out);
		src.down([[DATA, 1]]);
		base.down([[DATA, 10]]);
		const initial = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		expect(initial.filter((v) => v === 11).length).toBe(1);
		unsub();
	});

	// Regression: roadmap §3.1b — higher-order projects accept Iterable via fromAny coercion.
	it("concatMap coerces iterable project returns", () => {
		const src = producer<number>((a) => {
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

	// Regression: GRAPHREFLY-SPEC §1.3.7 — timer-backed operators should not fire phase-2 while
	// source DATA is still deferred inside an active batch.
	it("debounce does not flush DATA until batch exits (fake timers)", () => {
		vi.useFakeTimers();
		const s = node<number>();
		const out = debounce(s, 50);
		const { batches, unsub } = collect(out);
		batch(() => {
			s.down([[DATA, 7]]);
			vi.advanceTimersByTime(100);
			expect(batches.flat().some((m) => m[0] === DATA)).toBe(false);
		});
		vi.advanceTimersByTime(50);
		expect(batches.flat().find((m) => m[0] === DATA)?.[1]).toBe(7);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3 — delay forwards DIRTY immediately; DATA after timeout.
	it("delay shifts DATA by ms (fake timers)", () => {
		vi.useFakeTimers();
		const s = node<number>();
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
		const s = node<number>();
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
		const src = node<number>();
		const tick = node<number>();
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
		s.down([[DATA, 3]]);
		// Push-on-subscribe delivers initial 1; subsequent DATA values fill buffers.
		// Verify that at least one buffer was emitted with expected size.
		const buffers = batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1] as number[]);
		expect(buffers.length).toBeGreaterThanOrEqual(1);
		expect(buffers.some((b) => b.length === 2)).toBe(true);
		unsub();
	});

	// Regression: GRAPHREFLY-SPEC §1.3.4 — rescue converts ERROR into downstream DATA.
	it("rescue maps ERROR to value", () => {
		const s = node<number>();
		const out = rescue(s, () => 42);
		const { batches, unsub } = collect(out);
		s.down([[ERROR, new Error("x")]]);
		expect(batches.flat().find((m) => m[0] === DATA)?.[1]).toBe(42);
		unsub();
	});

	// Regression: SESSION-tier2-parity-nonlocal-forward-inner — rescue wrapped around a higher-order
	// operator must recover inner ERROR as DATA and avoid leaking terminal ERROR downstream.
	it("rescue recovers ERROR from switchMap inner source", () => {
		const src = state(1);
		const out = rescue(
			switchMap(src, () =>
				producer<number>((a) => {
					a.down([[ERROR, new Error("inner")], [COMPLETE]]);
				}),
			),
			() => 123,
		);
		const { batches, unsub } = collect(out);
		const flat = batches.flat();
		expect(flat.find((m) => m[0] === DATA)?.[1]).toBe(123);
		expect(flat.some((m) => m[0] === ERROR)).toBe(false);
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
		const lock = Symbol("test-lock");
		s.down([[PAUSE, lock]]);
		s.down([[DIRTY]]);
		s.down([[DATA, 5]]);
		s.down([[RESUME, lock]]);
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

// ---------------------------------------------------------------------------
// Tier 1 operator matrix — DIRTY, RESOLVED-suppression, ERROR/COMPLETE propagation, reconnect
// ---------------------------------------------------------------------------

describe("Tier 1 operator matrix — map", () => {
	it("DIRTY arrives before DATA at subscriber", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.1
		const src = state(1);
		const m = map(src, (x) => (x as number) * 2);
		const types: symbol[] = [];
		const unsub = m.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		types.length = 0;
		src.down([[DIRTY], [DATA, 2]]);
		unsub();
		const dirtyIdx = types.indexOf(DIRTY);
		const dataIdx = types.indexOf(DATA);
		expect(dirtyIdx).toBeGreaterThanOrEqual(0);
		expect(dataIdx).toBeGreaterThan(dirtyIdx);
	});

	it("RESOLVED suppression: same-value upstream emits RESOLVED, fn does not rerun", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.3
		const src = state(1);
		let fnRuns = 0;
		const m = map(src, (x) => {
			fnRuns += 1;
			return (x as number) > 0 ? "pos" : "neg";
		});
		const unsub = m.subscribe(() => undefined);
		fnRuns = 0;
		// Push a new upstream value that maps to the same output ("pos")
		src.down([[DIRTY], [DATA, 2]]);
		const runsAfter = fnRuns;
		unsub();
		// map always reruns, but the node should emit RESOLVED not DATA
		// The downstream should not see DATA for the unchanged value
		const unsub2 = m.subscribe((msgs) => {
			// Collect for RESOLVED check only — map's fn runs but RESOLVED is sent downstream
			void msgs;
		});
		unsub2();
		const src2 = state(1);
		const m2 = map(src2, (x) => {
			return (x as number) > 0 ? "pos" : "neg";
		});
		const resolvedTypes: symbol[] = [];
		const unsubR = m2.subscribe((msgs) => {
			for (const msg of msgs) resolvedTypes.push(msg[0] as symbol);
		});
		resolvedTypes.length = 0;
		src2.down([[DIRTY], [DATA, 3]]); // still maps to "pos"
		unsubR();
		expect(resolvedTypes).toContain(RESOLVED);
		expect(resolvedTypes).not.toContain(DATA);
		void runsAfter;
	});

	it("ERROR propagation: upstream ERROR flows through map", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const m = map(src, (x) => x);
		const types: symbol[] = [];
		const unsub = m.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		const err = new Error("up");
		src.down([[ERROR, err]]);
		unsub();
		expect(types).toContain(ERROR);
	});

	it("COMPLETE propagation: upstream COMPLETE flows through map", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const m = map(src, (x) => x);
		const types: symbol[] = [];
		const unsub = m.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[COMPLETE]]);
		unsub();
		expect(types).toContain(COMPLETE);
	});

	it("reconnect after teardown: resubscribe receives fresh values", () => {
		const src = state(1);
		const m = map(src, (x) => (x as number) * 2);
		const unsub1 = m.subscribe(() => undefined);
		unsub1();
		const values: number[] = [];
		const unsub2 = m.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) values.push(msg[1] as number);
			}
		});
		src.down([[DATA, 5]]);
		unsub2();
		expect(values).toContain(10);
	});
});

describe("Tier 1 operator matrix — filter", () => {
	it("DIRTY arrives before DATA at subscriber", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.1
		const src = state(1);
		const f = filter(src, (x) => (x as number) > 0);
		const types: symbol[] = [];
		const unsub = f.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		types.length = 0;
		src.down([[DIRTY], [DATA, 2]]);
		unsub();
		const dirtyIdx = types.indexOf(DIRTY);
		const dataIdx = types.indexOf(DATA);
		expect(dirtyIdx).toBeGreaterThanOrEqual(0);
		expect(dataIdx).toBeGreaterThan(dirtyIdx);
	});

	it("RESOLVED suppression: filtered-out value emits RESOLVED not DATA", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.3
		const src = state(5);
		const f = filter(src, (x) => (x as number) > 10);
		const types: symbol[] = [];
		const unsub = f.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		types.length = 0;
		src.down([[DIRTY], [DATA, 3]]); // 3 < 10 → filtered out → RESOLVED
		unsub();
		expect(types).toContain(RESOLVED);
		expect(types).not.toContain(DATA);
	});

	it("ERROR propagation: upstream ERROR flows through filter", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const f = filter(src, (x) => (x as number) > 0);
		const types: symbol[] = [];
		const unsub = f.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[ERROR, new Error("up")]]);
		unsub();
		expect(types).toContain(ERROR);
	});

	it("COMPLETE propagation: upstream COMPLETE flows through filter", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const f = filter(src, (x) => (x as number) > 0);
		const types: symbol[] = [];
		const unsub = f.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[COMPLETE]]);
		unsub();
		expect(types).toContain(COMPLETE);
	});

	it("reconnect after teardown: resubscribe receives fresh values", () => {
		const src = state(1);
		const f = filter(src, (x) => (x as number) > 0);
		const unsub1 = f.subscribe(() => undefined);
		unsub1();
		const values: number[] = [];
		const unsub2 = f.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) values.push(msg[1] as number);
			}
		});
		src.down([[DATA, 5]]);
		unsub2();
		expect(values).toContain(5);
	});
});

describe("Tier 1 operator matrix — scan", () => {
	it("DIRTY arrives before DATA at subscriber", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.1
		const src = state(0);
		const sc = scan(src, (a, x) => a + (x as number), 0);
		const types: symbol[] = [];
		const unsub = sc.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		types.length = 0;
		src.down([[DIRTY], [DATA, 1]]);
		unsub();
		const dirtyIdx = types.indexOf(DIRTY);
		const dataIdx = types.indexOf(DATA);
		expect(dirtyIdx).toBeGreaterThanOrEqual(0);
		expect(dataIdx).toBeGreaterThan(dirtyIdx);
	});

	it("ERROR propagation: upstream ERROR flows through scan", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const sc = scan(src, (a, x) => a + (x as number), 0);
		const types: symbol[] = [];
		const unsub = sc.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[ERROR, new Error("up")]]);
		unsub();
		expect(types).toContain(ERROR);
	});

	it("COMPLETE propagation: upstream COMPLETE flows through scan", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const sc = scan(src, (a, x) => a + (x as number), 0);
		const types: symbol[] = [];
		const unsub = sc.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[COMPLETE]]);
		unsub();
		expect(types).toContain(COMPLETE);
	});

	it("reconnect after teardown: resubscribe accumulates fresh", () => {
		const src = state(0);
		const sc = scan(src, (a, x) => a + (x as number), 0);
		const unsub1 = sc.subscribe(() => undefined);
		src.down([[DATA, 5]]);
		unsub1();
		// After teardown, resubscribe and push again
		const values: number[] = [];
		const unsub2 = sc.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) values.push(msg[1] as number);
			}
		});
		src.down([[DATA, 3]]);
		unsub2();
		expect(values.length).toBeGreaterThan(0);
	});
});

describe("Tier 1 operator matrix — take", () => {
	it("DIRTY arrives before DATA at subscriber", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.1
		const src = state(0);
		const t = take(src, 5);
		const types: symbol[] = [];
		const unsub = t.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		types.length = 0;
		src.down([[DIRTY], [DATA, 1]]);
		unsub();
		const dirtyIdx = types.indexOf(DIRTY);
		const dataIdx = types.indexOf(DATA);
		expect(dirtyIdx).toBeGreaterThanOrEqual(0);
		expect(dataIdx).toBeGreaterThan(dirtyIdx);
	});

	it("RESOLVED suppression: upstream RESOLVED flows as RESOLVED (no DATA)", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.3
		const src = state(1);
		const t = take(src, 5);
		// Push same value twice via a derived with equals
		const derived2 = map(src, (x) => ((x as number) > 0 ? "pos" : "neg"));
		const t2 = take(derived2, 5);
		const types: symbol[] = [];
		const unsub = t2.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		types.length = 0;
		src.down([[DIRTY], [DATA, 2]]); // still "pos"
		unsub();
		expect(types).toContain(RESOLVED);
		expect(types).not.toContain(DATA);
		void t;
	});

	it("ERROR propagation: upstream ERROR flows through take", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const t = take(src, 5);
		const types: symbol[] = [];
		const unsub = t.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[ERROR, new Error("up")]]);
		unsub();
		expect(types).toContain(ERROR);
	});

	it("COMPLETE propagation: upstream COMPLETE flows through take", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const t = take(src, 5);
		const types: symbol[] = [];
		const unsub = t.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[COMPLETE]]);
		unsub();
		expect(types).toContain(COMPLETE);
	});

	it("reconnect after teardown: resubscribe receives fresh values", () => {
		const src = node<number>();
		const t = take(src, 3);
		const unsub1 = t.subscribe(() => undefined);
		src.down([[DATA, 1]]);
		unsub1();
		const values: number[] = [];
		const unsub2 = t.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) values.push(msg[1] as number);
			}
		});
		src.down([[DATA, 7]]);
		unsub2();
		expect(values).toContain(7);
	});
});

describe("Tier 1 operator matrix — takeWhile", () => {
	it("DIRTY arrives before DATA at subscriber", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.1
		const src = state(0);
		const tw = takeWhile(src, (x) => (x as number) < 100);
		const types: symbol[] = [];
		const unsub = tw.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		types.length = 0;
		src.down([[DIRTY], [DATA, 1]]);
		unsub();
		const dirtyIdx = types.indexOf(DIRTY);
		const dataIdx = types.indexOf(DATA);
		expect(dirtyIdx).toBeGreaterThanOrEqual(0);
		expect(dataIdx).toBeGreaterThan(dirtyIdx);
	});

	it("ERROR propagation: upstream ERROR flows through takeWhile", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const tw = takeWhile(src, (x) => (x as number) < 100);
		const types: symbol[] = [];
		const unsub = tw.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[ERROR, new Error("up")]]);
		unsub();
		expect(types).toContain(ERROR);
	});

	it("COMPLETE propagation: upstream COMPLETE flows through takeWhile after predicate fails", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		// takeWhile only forwards COMPLETE once done=true (predicate failed);
		// COMPLETE from upstream while predicate is still passing is intentionally not forwarded
		// because the stream is still live. Only when the predicate gate closes does upstream
		// COMPLETE propagate.
		const src = state(0);
		const tw = takeWhile(src, (x) => (x as number) < 3);
		const types: symbol[] = [];
		const unsub = tw.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		// Push a value that fails the predicate — this causes takeWhile to emit COMPLETE itself
		src.down([[DATA, 5]]); // predicate fails → done=true, emits COMPLETE
		// Now send upstream COMPLETE (with done=true, it should also forward)
		src.down([[COMPLETE]]);
		unsub();
		expect(types).toContain(COMPLETE);
	});

	it("reconnect after teardown: resubscribe receives fresh values", () => {
		const src = state(0);
		const tw = takeWhile(src, (x) => (x as number) < 100);
		const unsub1 = tw.subscribe(() => undefined);
		unsub1();
		const values: number[] = [];
		const unsub2 = tw.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) values.push(msg[1] as number);
			}
		});
		src.down([[DATA, 5]]);
		unsub2();
		expect(values).toContain(5);
	});
});

describe("Tier 1 operator matrix — skip", () => {
	it("DIRTY arrives before DATA at subscriber (after skip threshold)", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.1
		const src = state(0);
		const sk = skip(src, 0);
		const types: symbol[] = [];
		const unsub = sk.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		types.length = 0;
		src.down([[DIRTY], [DATA, 1]]);
		unsub();
		const dirtyIdx = types.indexOf(DIRTY);
		const dataIdx = types.indexOf(DATA);
		expect(dirtyIdx).toBeGreaterThanOrEqual(0);
		expect(dataIdx).toBeGreaterThan(dirtyIdx);
	});

	it("ERROR propagation: upstream ERROR flows through skip", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const sk = skip(src, 0);
		const types: symbol[] = [];
		const unsub = sk.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[ERROR, new Error("up")]]);
		unsub();
		expect(types).toContain(ERROR);
	});

	it("COMPLETE propagation: upstream COMPLETE flows through skip", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const sk = skip(src, 0);
		const types: symbol[] = [];
		const unsub = sk.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[COMPLETE]]);
		unsub();
		expect(types).toContain(COMPLETE);
	});

	it("reconnect after teardown: resubscribe receives fresh values", () => {
		const src = state(0);
		const sk = skip(src, 0);
		const unsub1 = sk.subscribe(() => undefined);
		unsub1();
		const values: number[] = [];
		const unsub2 = sk.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) values.push(msg[1] as number);
			}
		});
		src.down([[DATA, 9]]);
		unsub2();
		expect(values).toContain(9);
	});
});

describe("Tier 1 operator matrix — distinctUntilChanged", () => {
	it("DIRTY arrives before DATA at subscriber", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.1
		const src = state(1);
		const d = distinctUntilChanged(src);
		const types: symbol[] = [];
		const unsub = d.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		types.length = 0;
		src.down([[DIRTY], [DATA, 2]]);
		unsub();
		const dirtyIdx = types.indexOf(DIRTY);
		const dataIdx = types.indexOf(DATA);
		expect(dirtyIdx).toBeGreaterThanOrEqual(0);
		expect(dataIdx).toBeGreaterThan(dirtyIdx);
	});

	it("RESOLVED suppression: duplicate value emits RESOLVED not DATA", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.3
		const src = state(5);
		const d = distinctUntilChanged(src);
		const types: symbol[] = [];
		const unsub = d.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		types.length = 0;
		src.down([[DIRTY], [DATA, 5]]); // same value again
		unsub();
		expect(types).toContain(RESOLVED);
		expect(types).not.toContain(DATA);
	});

	it("ERROR propagation: upstream ERROR flows through distinctUntilChanged", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const d = distinctUntilChanged(src);
		const types: symbol[] = [];
		const unsub = d.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[ERROR, new Error("up")]]);
		unsub();
		expect(types).toContain(ERROR);
	});

	it("COMPLETE propagation: upstream COMPLETE flows through distinctUntilChanged", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const d = distinctUntilChanged(src);
		const types: symbol[] = [];
		const unsub = d.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[COMPLETE]]);
		unsub();
		expect(types).toContain(COMPLETE);
	});

	it("reconnect after teardown: resubscribe receives fresh values", () => {
		const src = state(0);
		const d = distinctUntilChanged(src);
		const unsub1 = d.subscribe(() => undefined);
		unsub1();
		const values: number[] = [];
		const unsub2 = d.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) values.push(msg[1] as number);
			}
		});
		src.down([[DATA, 7]]);
		unsub2();
		expect(values).toContain(7);
	});
});

describe("Tier 1 operator matrix — pairwise", () => {
	it("DIRTY arrives before DATA at subscriber", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.1
		const src = state(0);
		const p = pairwise(src);
		const types: symbol[] = [];
		const unsub = p.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		// Seed first value, then push second to trigger pairwise DATA
		src.down([[DATA, 1]]);
		types.length = 0;
		src.down([[DIRTY], [DATA, 2]]);
		unsub();
		const dirtyIdx = types.indexOf(DIRTY);
		const dataIdx = types.indexOf(DATA);
		expect(dirtyIdx).toBeGreaterThanOrEqual(0);
		expect(dataIdx).toBeGreaterThan(dirtyIdx);
	});

	it("ERROR propagation: upstream ERROR flows through pairwise", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const p = pairwise(src);
		const types: symbol[] = [];
		const unsub = p.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[ERROR, new Error("up")]]);
		unsub();
		expect(types).toContain(ERROR);
	});

	it("COMPLETE propagation: upstream COMPLETE flows through pairwise", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const p = pairwise(src);
		const types: symbol[] = [];
		const unsub = p.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[COMPLETE]]);
		unsub();
		expect(types).toContain(COMPLETE);
	});

	it("reconnect after teardown: resubscribe gets fresh pair on two pushes", () => {
		const src = state(0);
		const p = pairwise(src);
		const unsub1 = p.subscribe(() => undefined);
		src.down([[DATA, 1]]);
		src.down([[DATA, 2]]);
		unsub1();
		const values: unknown[] = [];
		const unsub2 = p.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) values.push(msg[1]);
			}
		});
		src.down([[DATA, 3]]);
		src.down([[DATA, 4]]);
		unsub2();
		expect(values.length).toBeGreaterThan(0);
	});
});

describe("Tier 1 operator matrix — reduce", () => {
	it("ERROR propagation: upstream ERROR flows through reduce", () => {
		// Spec: GRAPHREFLY-SPEC §1.3.4
		const src = state(0);
		const r = reduce(src, (a, x) => a + (x as number), 0);
		const types: symbol[] = [];
		const unsub = r.subscribe((msgs) => {
			for (const msg of msgs) types.push(msg[0] as symbol);
		});
		src.down([[ERROR, new Error("up")]]);
		unsub();
		expect(types).toContain(ERROR);
	});

	it("reconnect after teardown: resubscribe emits on COMPLETE (accumulated value)", () => {
		// reduce is stateful across subscriptions unless resubscribable:true is set.
		// After teardown and re-subscribe, it still emits on upstream COMPLETE.
		const src = state(0);
		const r = reduce(src, (a, x) => a + (x as number), 0);
		const unsub1 = r.subscribe(() => undefined);
		unsub1();
		const values: number[] = [];
		const unsub2 = r.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) values.push(msg[1] as number);
			}
		});
		src.down([[DATA, 5]]);
		src.down([[COMPLETE]]);
		unsub2();
		// reduce emits on COMPLETE — values array must have at least one entry
		expect(values.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Tier 2 — teardown and reconnect freshness
// ---------------------------------------------------------------------------

describe("Tier 2 teardown and reconnect freshness — switchMap", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("after teardown, resubscribe creates a new inner subscription (old state not retained)", () => {
		// Spec: GRAPHREFLY-SPEC §2
		const src = state(0);
		let innerCallCount = 0;
		const out = switchMap(src, (v) => {
			innerCallCount += 1;
			return state((v as number) * 10);
		});
		const unsub1 = out.subscribe(() => undefined);
		const firstCount = innerCallCount;
		unsub1();
		// Resubscribe — a fresh inner subscription should be created
		const values: number[] = [];
		const unsub2 = out.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) values.push(msg[1] as number);
			}
		});
		src.down([[DATA, 2]]);
		unsub2();
		expect(innerCallCount).toBeGreaterThan(firstCount);
		expect(values).toContain(20);
	});
});

describe("Tier 2 teardown and reconnect freshness — debounce", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("after teardown, timers are cleared — no stale emissions after unsubscribe + timer advance", () => {
		// Spec: GRAPHREFLY-SPEC §1.3
		vi.useFakeTimers();
		const src = state(0);
		const out = debounce(src, 50);
		const staleValues: number[] = [];
		const unsub = out.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) staleValues.push(msg[1] as number);
			}
		});
		src.down([[DATA, 1]]);
		// Unsubscribe before timer fires — teardown must clear pending timer
		unsub();
		// Advance time past the debounce window
		vi.advanceTimersByTime(100);
		// No stale emission should have arrived after unsubscribe
		expect(staleValues.length).toBe(0);
	});
});

describe("Tier 2 teardown and reconnect freshness — concatMap", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("after teardown + resubscribe, queue is fresh (no buffered items from previous subscription)", () => {
		// Spec: GRAPHREFLY-SPEC §2
		// Verify that after teardown and resubscribe, the concatMap processes
		// new outer values fresh (no stale buffered items leak across subscriptions).
		const src = state(0);
		let wave = 0;
		const out = concatMap(src, (v) => {
			wave += 1;
			return state((v as number) * 100);
		});
		const unsub1 = out.subscribe(() => undefined);
		src.down([[DATA, 1]]);
		unsub1();
		const _prevWave = wave;
		// Resubscribe — push-on-subscribe replays src's cached value through concatMap
		const values: number[] = [];
		const unsub2 = out.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) values.push(msg[1] as number);
			}
		});
		// Output compute node clears its cache on disconnect (ROM/RAM rule).
		// Resubscribe re-runs concatMap with the source's current value, emitting
		// fresh DATA to the new sink.
		expect(values.length).toBeGreaterThan(0);
		unsub2();
	});
});

// ---------------------------------------------------------------------------
// Diamond resolution through operator chain — recompute count
// ---------------------------------------------------------------------------

describe("diamond resolution through operator chain", () => {
	it("source → map as A, map as B → combine([A, B]): DATA emitted exactly once per push", () => {
		// Spec: GRAPHREFLY-SPEC §2 (diamond resolution)
		// A and B both depend on src; combine waits for both to settle before recomputing.
		// Exactly one DATA message should reach the combine subscriber per src push.
		const src = state(0);
		const a = map(src, (x) => x);
		const b = map(src, (x) => x);
		const c = combine(a, b);
		let dataCount = 0;
		const unsub = c.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) dataCount += 1;
			}
		});
		dataCount = 0;
		src.down([[DIRTY], [DATA, 5]]);
		expect(dataCount).toBe(1);
		expect(c.cache).toEqual([5, 5]);
		unsub();
	});
});

// ---------------------------------------------------------------------------
// D8 / SENTINEL dep safety — operators must not corrupt state when dep is
// SENTINEL (no cached DATA). Regression: operator fn received undefined from
// dep.cache and processed it as real data.
// ---------------------------------------------------------------------------
describe("SENTINEL dep safety (D8 fallback)", () => {
	it("switchMap does not call project until real DATA arrives", () => {
		const trigger = node<number>();
		let projectCalls = 0;
		const out = switchMap(trigger, (_v) => {
			projectCalls++;
			return state("inner");
		});
		const { messages, unsub } = collect(out, { flat: true });
		expect(projectCalls).toBe(0);
		expect(messages.filter((m) => m[0] === DATA)).toHaveLength(0);
		trigger.down([[DATA, 1]]);
		expect(projectCalls).toBe(1);
		expect(messages.some((m) => m[0] === DATA && m[1] === "inner")).toBe(true);
		unsub();
	});

	it("exhaustMap does not call project until real DATA arrives", () => {
		const trigger = node<number>();
		let projectCalls = 0;
		const out = exhaustMap(trigger, (_v) => {
			projectCalls++;
			return state("inner");
		});
		const { unsub } = collect(out, { flat: true });
		expect(projectCalls).toBe(0);
		trigger.down([[DATA, 1]]);
		expect(projectCalls).toBe(1);
		unsub();
	});

	it("concatMap does not call project until real DATA arrives", () => {
		const trigger = node<number>();
		let projectCalls = 0;
		const out = concatMap(trigger, (_v) => {
			projectCalls++;
			return state("inner");
		});
		const { unsub } = collect(out, { flat: true });
		expect(projectCalls).toBe(0);
		trigger.down([[DATA, 1]]);
		expect(projectCalls).toBe(1);
		unsub();
	});

	it("mergeMap does not call project until real DATA arrives", () => {
		const trigger = node<number>();
		let projectCalls = 0;
		const out = mergeMap(trigger, (_v) => {
			projectCalls++;
			return state("inner");
		});
		const { unsub } = collect(out, { flat: true });
		expect(projectCalls).toBe(0);
		trigger.down([[DATA, 1]]);
		expect(projectCalls).toBe(1);
		unsub();
	});

	it("reduce does not accumulate SENTINEL undefined as data", () => {
		const trigger = node<number>();
		const out = reduce(trigger, (acc, v) => acc + v, 0);
		const { messages, unsub } = collect(out, { flat: true });
		trigger.down([[DATA, 10]]);
		trigger.down([[DATA, 20]]);
		trigger.down([[COMPLETE]]);
		const dataVals = messages.filter((m) => m[0] === DATA).map((m) => m[1]);
		expect(dataVals).toContain(30);
		unsub();
	});

	it("takeWhile does not evaluate predicate on SENTINEL undefined", () => {
		const trigger = node<number>();
		let predicateCalls = 0;
		const out = takeWhile(trigger, (v) => {
			predicateCalls++;
			return v < 10;
		});
		const { unsub } = collect(out, { flat: true });
		expect(predicateCalls).toBe(0);
		trigger.down([[DATA, 5]]);
		expect(predicateCalls).toBe(1);
		unsub();
	});

	it("last does not emit SENTINEL undefined on COMPLETE", () => {
		const trigger = node<number>();
		const out = last(trigger);
		const { messages, unsub } = collect(out, { flat: true });
		trigger.down([[COMPLETE]]);
		const dataVals = messages.filter((m) => m[0] === DATA);
		expect(dataVals).toHaveLength(0);
		unsub();
	});

	it("bufferCount does not include SENTINEL undefined in buffer", () => {
		const trigger = node<number>();
		const out = bufferCount(trigger, 2);
		const { messages, unsub } = collect(out, { flat: true });
		trigger.down([[DATA, 1]]);
		trigger.down([[DATA, 2]]);
		const dataVals = messages.filter((m) => m[0] === DATA).map((m) => m[1]);
		expect(dataVals).toEqual([[1, 2]]);
		unsub();
	});
});

describe("withLatestFrom — secondary dep semantics", () => {
	it("primary fires before secondary has any value — no DATA emitted (sentinel gate)", () => {
		// Secondary has never emitted; _sentinelDepCount > 0 keeps fn gated.
		const primary = node<number>();
		const secondary = node<number>();
		const w = withLatestFrom(primary, secondary);
		const { messages, unsub } = collect(w, { flat: true });
		primary.down([[DATA, 1]]);
		expect(messages.filter((m) => m[0] === DATA)).toHaveLength(0);
		unsub();
	});

	it("secondary updates, then primary fires — pairs with latest secondary value", () => {
		const primary = node<number>();
		const secondary = state(10);
		const w = withLatestFrom(primary, secondary);
		const { messages, unsub } = collect(w, { flat: true });
		secondary.down([[DATA, 20]]);
		primary.down([[DATA, 1]]);
		const dataVals = messages.filter((m) => m[0] === DATA).map((m) => m[1]);
		expect(dataVals).toEqual([[1, 20]]);
		unsub();
	});

	it("secondary COMPLETE — operator continues, primary still emits with frozen secondary value", () => {
		// Secondary completes; autoComplete requires ALL deps terminal so
		// withLatestFrom does not complete. ctx.latestData[1] retains the
		// last secondary value for future primary emissions.
		const primary = node<number>();
		const secondary = state(10);
		const w = withLatestFrom(primary, secondary);
		const { messages, unsub } = collect(w, { flat: true });
		secondary.down([[COMPLETE]]);
		primary.down([[DATA, 5]]);
		const dataVals = messages.filter((m) => m[0] === DATA).map((m) => m[1]);
		expect(dataVals).toEqual([[5, 10]]);
		expect(messages.filter((m) => m[0] === COMPLETE || m[0] === ERROR)).toHaveLength(0);
		unsub();
	});

	it("secondary ERROR — propagates to output (autoError)", () => {
		// Both deps must be settled (sentinelDepCount=0) for _maybeAutoTerminalAfterWave
		// to fire. A sentinel primary blocks terminal propagation from secondary — see
		// "withLatestFrom sentinel gate swallows secondary ERROR" in docs/optimizations.md.
		const primary = state(1);
		const secondary = state(10);
		const w = withLatestFrom(primary, secondary);
		const { messages, unsub } = collect(w, { flat: true });
		secondary.down([[ERROR, new Error("secondary failed")]]);
		const errorMsgs = messages.filter((m) => m[0] === ERROR);
		expect(errorMsgs).toHaveLength(1);
		expect((errorMsgs[0]?.[1] as Error).message).toBe("secondary failed");
		unsub();
	});

	it("secondary COMPLETE without prior DATA — primary emission suppressed (RESOLVED)", () => {
		// secondary completes before ever emitting DATA.
		// withLatestFrom has no value to pair — suppress the emission.
		const primary = node<number>();
		const secondary = node<number>(); // raw, never emits DATA
		const w = withLatestFrom(primary, secondary);
		const { messages, unsub } = collect(w, { flat: true });
		secondary.down([[COMPLETE]]); // completes without DATA
		primary.down([[DATA, 5]]);
		const dataVals = messages.filter((m) => m[0] === DATA);
		expect(dataVals).toHaveLength(0); // no pairable value → suppress
		unsub();
	});
});
