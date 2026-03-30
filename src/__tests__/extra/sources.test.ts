import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPLETE, DATA, DIRTY, ERROR, RESOLVED } from "../../core/messages.js";
import { producer, state } from "../../core/sugar.js";
import { parseCron } from "../../extra/cron.js";
import { gate } from "../../extra/operators.js";
import {
	cached,
	empty,
	firstValueFrom,
	forEach,
	fromAny,
	fromAsyncIter,
	fromCron,
	fromEvent,
	fromIter,
	fromPromise,
	fromTimer,
	never,
	of,
	replay,
	share,
	throwError,
	toArray,
} from "../../extra/sources.js";

/** Next macrotick (GraphReFly + Vitest: do not use `vi.waitFor` with a sync boolean — it resolves immediately). */
function tick(ms = 0): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function collect(node: { subscribe: (fn: (m: unknown) => void) => () => void }) {
	const batches: unknown[][] = [];
	const unsub = node.subscribe((msgs) => {
		batches.push([...msgs]);
	});
	return { batches, unsub };
}

describe("extra sources & sinks (roadmap §2.3)", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("fromTimer emits then completes", async () => {
		const n = fromTimer(15);
		const { batches, unsub } = collect(n);
		await tick(50);
		const data = batches.flat().filter((m) => m[0] === DATA);
		expect(data.length).toBeGreaterThanOrEqual(1);
		expect(data[0]?.[1]).toBe(0);
		expect(batches.some((b) => b.some((m) => m[0] === COMPLETE))).toBe(true);
		unsub();
	});

	it("fromTimer periodic mode", async () => {
		vi.useFakeTimers();
		const n = fromTimer(10, { period: 5 });
		const { batches, unsub } = collect(n);
		vi.advanceTimersByTime(10);
		const d0 = batches.flat().filter((m) => m[0] === DATA);
		expect(d0.map((m) => m[1])).toContain(0);
		vi.advanceTimersByTime(5);
		const d1 = batches.flat().filter((m) => m[0] === DATA);
		expect(d1.map((m) => m[1])).toContain(1);
		vi.advanceTimersByTime(5);
		const d2 = batches.flat().filter((m) => m[0] === DATA);
		expect(d2.map((m) => m[1])).toContain(2);
		// Should NOT have completed
		expect(batches.flat().some((m) => m[0] === COMPLETE)).toBe(false);
		unsub();
	});

	it("fromTimer aborts with ERROR", () => {
		vi.useFakeTimers();
		const ac = new AbortController();
		const n = fromTimer(1000, { signal: ac.signal });
		const { batches, unsub } = collect(n);
		ac.abort(new Error("x"));
		expect(batches.some((b) => b.some((m) => m[0] === ERROR))).toBe(true);
		unsub();
	});

	it("fromIter / of", () => {
		const a = collect(fromIter([10, 20]));
		expect(
			a.batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]),
		).toEqual([10, 20]);
		expect(a.batches.some((b) => b.some((m) => m[0] === COMPLETE))).toBe(true);
		a.unsub();

		const b = collect(of(1, 2, 3));
		expect(
			b.batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]),
		).toEqual([1, 2, 3]);
		b.unsub();
	});

	it("fromIter with throwing iterator emits ERROR", () => {
		function* badIter() {
			yield 1;
			throw new Error("iter-boom");
		}
		const { batches, unsub } = collect(fromIter(badIter()));
		expect(batches.flat().some((m) => m[0] === DATA && m[1] === 1)).toBe(true);
		expect(
			batches.flat().some((m) => m[0] === ERROR && (m[1] as Error).message === "iter-boom"),
		).toBe(true);
		unsub();
	});

	it("empty / never / throwError", () => {
		const e = collect(empty());
		expect(e.batches.some((b) => b.some((m) => m[0] === COMPLETE))).toBe(true);
		expect(e.batches.flat().some((m) => m[0] === DATA)).toBe(false);
		e.unsub();

		const n = collect(never());
		expect(n.batches.length).toBe(0);
		n.unsub();

		const t = collect(throwError("boom"));
		expect(t.batches.some((b) => b.some((m) => m[0] === ERROR && m[1] === "boom"))).toBe(true);
		t.unsub();
	});

	it("fromPromise", async () => {
		const ok = collect(fromPromise(Promise.resolve(7)));
		await tick(0);
		expect(ok.batches.some((b) => b.some((m) => m[0] === COMPLETE))).toBe(true);
		expect(ok.batches.flat().find((m) => m[0] === DATA)?.[1]).toBe(7);
		ok.unsub();

		const bad = collect(fromPromise(Promise.reject(new Error("no"))));
		await tick(0);
		expect(bad.batches.some((b) => b.some((m) => m[0] === ERROR))).toBe(true);
		bad.unsub();
	});

	it("fromAny dispatches iterable", () => {
		const a = collect(fromAny([1, 2]));
		expect(
			a.batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]),
		).toEqual([1, 2]);
		a.unsub();
	});

	it("fromAny with scalar fallback", () => {
		const a = collect(fromAny(42));
		expect(
			a.batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]),
		).toEqual([42]);
		a.unsub();
	});

	it("fromAny handles null/undefined as scalar values", () => {
		const a = collect(fromAny(null));
		expect(
			a.batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]),
		).toEqual([null]);
		a.unsub();

		const b = collect(fromAny(undefined));
		expect(b.batches.flat().some((m) => m[0] === COMPLETE)).toBe(true);
		expect(b.batches.flat().some((m) => m[0] === ERROR)).toBe(false);
		b.unsub();
	});

	it("fromAny with existing Node returns same reference", () => {
		const s = state(99);
		const result = fromAny(s);
		expect(result).toBe(s);
	});

	it("fromAsyncIter", async () => {
		async function* gen() {
			yield 1;
			yield 2;
		}
		const { batches, unsub } = collect(fromAsyncIter(gen()));
		await tick(0);
		expect(
			batches
				.flat()
				.filter((m) => m[0] === DATA)
				.map((m) => m[1]),
		).toEqual([1, 2]);
		unsub();
	});

	it("toArray", () => {
		const src = fromIter(["a", "b"]);
		const { batches, unsub } = collect(toArray(src));
		const data = batches.flat().filter((m) => m[0] === DATA);
		expect(data[data.length - 1]?.[1]).toEqual(["a", "b"]);
		unsub();
	});

	it("forEach runs side effect and returns unsub", () => {
		const acc: number[] = [];
		const src = fromIter([1, 2]);
		const unsub = forEach(src, (v) => acc.push(v as number));
		expect(acc).toEqual([1, 2]);
		expect(typeof unsub).toBe("function");
		unsub();
	});

	it("share uses one upstream subscription", () => {
		let subs = 0;
		const src = producer<number>((_d, a) => {
			subs += 1;
			a.emit(1);
			return () => {
				subs -= 1;
			};
		});
		const hub = share(src);
		const a = collect(hub);
		const b = collect(hub);
		expect(subs).toBe(1);
		a.unsub();
		b.unsub();
	});

	it("replay replays buffer to late subscriber", async () => {
		const s = state(0);
		const r = replay(s, 2);
		const first = collect(r);
		await tick(0);
		s.down([[DIRTY], [DATA, 1]]);
		s.down([[DIRTY], [DATA, 2]]);
		await tick(0);
		const second = collect(r);
		await tick(0);
		const earlyData = second.batches
			.flat()
			.filter((m) => m[0] === DATA)
			.map((m) => m[1]);
		expect(earlyData.slice(0, 2)).toEqual([1, 2]);
		first.unsub();
		second.unsub();
	});

	it("cached is replay(1)", async () => {
		const s = state(0);
		const c = cached(s);
		const { batches, unsub } = collect(c);
		await tick(0);
		s.down([[DIRTY], [DATA, 42]]);
		await tick(0);
		expect(batches.flat().some((m) => m[0] === DATA && m[1] === 42)).toBe(true);
		unsub();
	});

	it("fromEvent", () => {
		const target = {
			listeners: [] as ((e: unknown) => void)[],
			addEventListener(_type: string, fn: (e: unknown) => void) {
				this.listeners.push(fn);
			},
			removeEventListener(_type: string, fn: (e: unknown) => void) {
				const i = this.listeners.indexOf(fn);
				if (i >= 0) this.listeners.splice(i, 1);
			},
		};
		const { batches, unsub } = collect(fromEvent<{ x: number }>(target, "x"));
		target.listeners[0]?.({ x: 1 });
		expect(
			batches.some((b) => b.some((m) => m[0] === DATA && (m[1] as { x: number }).x === 1)),
		).toBe(true);
		unsub();
	});

	it("parseCron rejects bad expressions", () => {
		expect(() => parseCron("bad")).toThrow();
		expect(() => parseCron("* *")).toThrow();
	});

	it("fromCron fires on matching minute (timestamp_ns)", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 2, 28, 9, 0, 0));
		const n = fromCron("0 9 * * *", { tickMs: 1000 });
		const { batches, unsub } = collect(n);
		vi.advanceTimersByTime(0);
		const data = batches.flat().filter((m) => m[0] === DATA);
		expect(data.length).toBeGreaterThanOrEqual(1);
		expect(typeof data[0]?.[1]).toBe("number");
		// Should be a nanosecond timestamp
		expect(data[0]?.[1]).toBeGreaterThan(1_000_000_000_000_000);
		unsub();
	});

	it("firstValueFrom resolves with first DATA", async () => {
		const result = await firstValueFrom(fromIter([10, 20, 30]));
		expect(result).toBe(10);
	});

	it("firstValueFrom rejects on empty", async () => {
		await expect(firstValueFrom(empty())).rejects.toThrow("completed without DATA");
	});

	it("gate forwards DATA when control is truthy", () => {
		const src = state(42);
		const ctrl = state(true);
		const g = gate(src, ctrl);
		const { batches, unsub } = collect(g);
		expect(batches.flat().some((m) => m[0] === DATA && m[1] === 42)).toBe(true);
		unsub();
	});

	it("gate emits RESOLVED when control is falsy", () => {
		const src = state(42);
		const ctrl = state(false);
		const g = gate(src, ctrl);
		const { batches, unsub } = collect(g);
		expect(batches.flat().some((m) => m[0] === RESOLVED)).toBe(true);
		expect(batches.flat().some((m) => m[0] === DATA && m[1] === 42)).toBe(false);
		unsub();
	});
});
