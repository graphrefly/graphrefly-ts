import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Message } from "../index.js";
import {
	empty,
	type FromCronOptions,
	firstValueFrom,
	fromAny,
	fromAsyncIter,
	fromCron,
	fromEvent,
	fromIter,
	fromPromise,
	fromPushNotification,
	fromTimer,
	graph,
	interval,
	matchesCron,
	never,
	type Operator,
	of,
	parseCron,
	singleFromAny,
	throwError,
	timer,
} from "../index.js";

const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);

const flush = () => new Promise((r) => setTimeout(r, 0));

class FakeEventTarget {
	readonly calls: Array<readonly ["add" | "remove", string, unknown]> = [];
	private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

	addEventListener(type: string, listener: (event: unknown) => void, options?: unknown): void {
		this.calls.push(["add", type, options]);
		const listeners = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: (event: unknown) => void, options?: unknown): void {
		this.calls.push(["remove", type, options]);
		this.listeners.get(type)?.delete(listener);
	}

	emit(type: string, event: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

// D43/D40: async sources are binding-layer producer sugar — depless Operator specs run once on
// activation, schedule their work, and emit later via the captured ctx.down (R-no-raw-async:
// setTimeout/Promise confined here). Instantiated via the generic g.initNode funnel.
describe("timer / interval sources (fake timers, D43)", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("timer one-shot emits DATA(0) then COMPLETE", () => {
		const g = graph();
		const n = g.initNode(timer(50), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		vi.advanceTimersByTime(50);
		expect(data(msgs)).toEqual([0]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
		expect(n.status).toBe("completed");
	});

	it("timer one-shot is canceled by deactivation before its first tick", () => {
		const g = graph();
		const n = g.initNode(timer(50), []);
		const msgs: Message[] = [];
		const unsub = n.subscribe((x) => msgs.push(x));
		expect(vi.getTimerCount()).toBe(1);

		unsub();
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(50);

		expect(data(msgs)).toEqual([]);
		expect(msgs).toEqual([["START"]]);
	});

	it("fromTimer preserves the frozen source name and supports AbortSignal", () => {
		const g = graph();
		const ac = new AbortController();
		const n = g.initNode(fromTimer(50, { signal: ac.signal }), [], { name: "clock" });
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		ac.abort(false);
		vi.advanceTimersByTime(50);

		const byId = Object.fromEntries(g.describe().nodes.map((node) => [node.id, node]));
		const last = msgs[msgs.length - 1];
		expect(byId.clock.factory).toBe("fromTimer");
		expect(last[0]).toBe("ERROR");
		expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error);
		expect(data(msgs)).toEqual([]);
	});

	it("fromTimer reports an already-aborted signal without scheduling DATA", () => {
		const g = graph();
		const ac = new AbortController();
		ac.abort(false);
		const n = g.initNode(fromTimer(50, { signal: ac.signal }), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		vi.advanceTimersByTime(50);

		const last = msgs[msgs.length - 1];
		expect(last[0]).toBe("ERROR");
		expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error);
		expect(data(msgs)).toEqual([]);
		expect(n.status).toBe("errored");
	});

	it("fromTimer periodic mode stops emitting after abort", () => {
		const g = graph();
		const ac = new AbortController();
		const n = g.initNode(fromTimer(50, { period: 100, signal: ac.signal }), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		vi.advanceTimersByTime(50);
		vi.advanceTimersByTime(100);
		ac.abort(true);
		vi.advanceTimersByTime(500);

		const last = msgs[msgs.length - 1];
		expect(data(msgs)).toEqual([0, 1]);
		expect(last[0]).toBe("ERROR");
		expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error);
		expect(n.status).toBe("errored");
	});

	it("interval emits periodic ticks 0,1,2,…", () => {
		const g = graph();
		const n = g.initNode(interval(100), []);
		const vals: number[] = [];
		const unsub = n.subscribe((m) => {
			if (m[0] === "DATA") vals.push(m[1] as number);
		});
		vi.advanceTimersByTime(100); // first tick → 0
		vi.advanceTimersByTime(100); // → 1
		vi.advanceTimersByTime(100); // → 2
		expect(vals).toEqual([0, 1, 2]);
		unsub(); // deactivate → onDeactivation clears the interval (no leak)
	});

	it("interval preserves its real source factory name in describe (D6)", () => {
		const g = graph();
		g.initNode(interval(100), [], { name: "ticks" });
		const byId = Object.fromEntries(g.describe().nodes.map((node) => [node.id, node]));
		expect(byId.ticks.factory).toBe("interval");
	});

	it("deactivation stops the source — no emit after unsubscribe (cleanup contract)", () => {
		const g = graph();
		const n = g.initNode(interval(100), []);
		const vals: number[] = [];
		const unsub = n.subscribe((m) => {
			if (m[0] === "DATA") vals.push(m[1] as number);
		});
		vi.advanceTimersByTime(100); // tick 0
		unsub(); // deactivate → ctx.onDeactivation clears the interval (D28)
		vi.advanceTimersByTime(500); // no live timer → no further ticks
		expect(vals).toEqual([0]); // nothing emitted after deactivation
	});
});

describe("cron sources (B60 source-boundary re-derive)", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("parseCron supports lists, ranges, and steps", () => {
		const schedule = parseCron("0,30 9-17/2 * 1-3 1-5");

		expect([...schedule.minutes]).toEqual([0, 30]);
		expect([...schedule.hours]).toEqual([9, 11, 13, 15, 17]);
		expect([...schedule.months]).toEqual([1, 2, 3]);
		expect([...schedule.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
		expect(() => parseCron("60 * * * *")).toThrow(RangeError);
		expect(() => parseCron("* * * *")).toThrow(/expected 5 fields/);
		expect(() => parseCron("*/5foo * * * *")).toThrow(/Invalid cron step/);
		expect(() => parseCron("1/2/3 * * * *")).toThrow(/Invalid cron step/);
		expect(() => parseCron("8-12bar * * * *")).toThrow(/Invalid cron field/);
	});

	it("matchesCron checks the local five-field schedule", () => {
		const schedule = parseCron("30 8 * * 1");
		expect(matchesCron(schedule, new Date(2026, 2, 30, 8, 30))).toBe(true);
		expect(matchesCron(schedule, new Date(2026, 2, 30, 8, 31))).toBe(false);
	});

	it("fromCron emits at most once per matching minute and tears down its interval", () => {
		const now = new Date(2026, 2, 30, 8, 30, 0);
		vi.setSystemTime(now);
		const g = graph();
		const n = g.initNode(fromCron("30 8 * * 1", { tickMs: 1000 }), [], { name: "cron" });
		const msgs: Message[] = [];
		const unsubscribe = n.subscribe((msg) => msgs.push(msg));

		const expected = (BigInt(now.getTime()) * 1_000_000n).toString();
		expect(data(msgs)).toEqual([expected]);
		vi.advanceTimersByTime(30_000);
		expect(data(msgs)).toEqual([expected]);
		expect(vi.getTimerCount()).toBe(1);
		unsubscribe();
		expect(vi.getTimerCount()).toBe(0);
		expect(g.describe().nodes.find((node) => node.id === "cron")?.factory).toBe("fromCron");
	});

	it("fromCron can emit Date values", () => {
		vi.setSystemTime(new Date(2026, 2, 30, 8, 30, 0));
		const g = graph();
		const n = g.initNode(fromCron("30 8 * * 1", { tickMs: 1000, output: "date" }), []);
		const msgs: Message[] = [];
		n.subscribe((msg) => msgs.push(msg));

		expect(data(msgs)[0]).toBeInstanceOf(Date);
	});

	it("fromCron accepts the exported FromCronOptions type", () => {
		const opts: FromCronOptions =
			Math.random() > 2 ? { output: "date" } : { output: "timestamp_ns" };

		expectTypeOf(fromCron("* * * * *", opts)).toEqualTypeOf<
			Operator<never, Date | number | string>
		>();
	});
});

describe("promise / iterable / coercion sources (D43)", () => {
	it("fromPromise resolves to DATA then COMPLETE", async () => {
		const g = graph();
		const n = g.initNode(fromPromise(Promise.resolve(7)), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		await flush();
		expect(data(msgs)).toEqual([7]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
	});

	it("fromPromise unsubscribe suppresses late DATA + COMPLETE", async () => {
		const g = graph();
		let resolve!: (value: number) => void;
		const p = new Promise<number>((r) => {
			resolve = r;
		});
		const n = g.initNode(fromPromise(p), []);
		const msgs: Message[] = [];
		const unsub = n.subscribe((x) => msgs.push(x));

		unsub();
		resolve(7);
		await flush();

		expect(msgs).toEqual([["START"]]);
		expect(data(msgs)).toEqual([]);
	});

	it("fromPromise rejects to ERROR", async () => {
		const g = graph();
		const boom = new Error("boom");
		const n = g.initNode(fromPromise(Promise.reject(boom)), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		await flush();
		const last = msgs[msgs.length - 1];
		expect(last[0]).toBe("ERROR");
		expect((last as ["ERROR", unknown])[1]).toBe(boom);
		expect(n.status).toBe("errored");
	});

	it("fromPromise rejecting with undefined/boolean → clean ERROR, never invalid ERROR payload", async () => {
		const g = graph();
		for (const reason of [undefined, false, true]) {
			const n = g.initNode(fromPromise(Promise.reject(reason)), []);
			const msgs: Message[] = [];
			n.subscribe((x) => msgs.push(x));
			await flush();
			const last = msgs[msgs.length - 1];
			expect(last[0]).toBe("ERROR");
			expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error);
			expect(n.status).toBe("errored");
		}
	});

	it("fromAsyncIter emits each value then COMPLETE", async () => {
		async function* gen() {
			yield 1;
			yield 2;
			yield 3;
		}
		const g = graph();
		const n = g.initNode(fromAsyncIter(gen()), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		await flush();
		expect(data(msgs)).toEqual([1, 2, 3]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
	});

	it("fromAsyncIter reports async iterator failure as ERROR after prior DATA", async () => {
		async function* throwingGen() {
			yield 1;
			throw new Error("async iter boom");
		}
		const g = graph();
		const n = g.initNode(fromAsyncIter(throwingGen()), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		await flush();

		expect(data(msgs)).toEqual([1]);
		const last = msgs[msgs.length - 1];
		expect(last[0]).toBe("ERROR");
		expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error);
		expect((last as ["ERROR", Error])[1].message).toBe("async iter boom");
		expect(n.status).toBe("errored");
	});

	it("of emits a single value then COMPLETE synchronously", () => {
		const g = graph();
		const n = g.initNode(of(42), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		expect(data(msgs)).toEqual([42]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
	});

	it("of emits variadic values; of() is terminal-only EMPTY", () => {
		const g = graph();
		const many = g.initNode(of(1, 2, 3), []);
		const manyMsgs: Message[] = [];
		many.subscribe((x) => manyMsgs.push(x));
		expect(data(manyMsgs)).toEqual([1, 2, 3]);
		expect(manyMsgs[manyMsgs.length - 1][0]).toBe("COMPLETE");

		const none = g.initNode(of(), []);
		const noneMsgs: Message[] = [];
		none.subscribe((x) => noneMsgs.push(x));
		expect(data(noneMsgs)).toEqual([]);
		expect(noneMsgs[noneMsgs.length - 1][0]).toBe("COMPLETE");
	});

	it("fromIter emits each value then COMPLETE synchronously", () => {
		const g = graph();
		const n = g.initNode(fromIter([1, 2, 3]), []);
		const vals: unknown[] = [];
		n.subscribe((m) => {
			if (m[0] === "DATA") vals.push(m[1]);
		});
		expect(vals).toEqual([1, 2, 3]);
	});

	it("fromIter reports a throwing iterator as ERROR after prior DATA", () => {
		function* throwingIter() {
			yield 1;
			throw new Error("iter boom");
		}
		const g = graph();
		const n = g.initNode(fromIter(throwingIter()), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));

		expect(data(msgs)).toEqual([1]);
		const last = msgs[msgs.length - 1];
		expect(last[0]).toBe("ERROR");
		expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error);
		expect((last as ["ERROR", Error])[1].message).toBe("iter boom");
		expect(n.status).toBe("errored");
	});

	it("empty completes without DATA", () => {
		const g = graph();
		const n = g.initNode(empty<number>(), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		expect(data(msgs)).toEqual([]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
		expect(n.status).toBe("completed");
	});

	it("never stays silent after START until deactivation", () => {
		const g = graph();
		const n = g.initNode(never<number>(), []);
		const msgs: Message[] = [];
		const unsub = n.subscribe((x) => msgs.push(x));
		expect(msgs).toEqual([["START"]]);
		expect(n.status).toBe("sentinel");
		unsub();
	});

	it("throwError emits a valid ERROR payload on activation", () => {
		const g = graph();
		for (const err of [undefined, false, true]) {
			const n = g.initNode(throwError(err), []);
			const msgs: Message[] = [];
			n.subscribe((x) => msgs.push(x));
			const last = msgs[msgs.length - 1];
			expect(last[0]).toBe("ERROR");
			expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error);
			expect(n.status).toBe("errored");
		}
	});

	it("fromAny passes an existing Node through", () => {
		const g = graph();
		const s = g.state(1);
		expect(fromAny(s)).toBe(s);
	});

	it("fromAny lifts a Promise via fromPromise", async () => {
		const n = fromAny(Promise.resolve(9));
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		await flush();
		expect(data(msgs)).toEqual([9]);
	});

	it("fromAny lifts an async iterable before treating it as a scalar", async () => {
		async function* gen() {
			yield 1;
			yield 2;
		}
		const n = fromAny(gen());
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		await flush();
		expect(data(msgs)).toEqual([1, 2]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
	});

	it("fromAny expands a sync iterable only with {iter:true}", () => {
		const expanded = fromAny([1, 2, 3], { iter: true });
		const vals: unknown[] = [];
		expanded.subscribe((m) => {
			if (m[0] === "DATA") vals.push(m[1]);
		});
		expect(vals).toEqual([1, 2, 3]);

		// default: the array is a single scalar DATA value (of)
		const scalar = fromAny([1, 2, 3]);
		const got: unknown[] = [];
		scalar.subscribe((m) => {
			if (m[0] === "DATA") got.push(m[1]);
		});
		expect(got).toEqual([[1, 2, 3]]);
	});

	it("fromAny treats null as a valid scalar DATA value (R-data-payload)", () => {
		const n = fromAny(null);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));

		expect(data(msgs)).toEqual([null]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
		expect(n.status).toBe("completed");
	});

	it("fromAny rejects undefined as DATA because it is the protocol SENTINEL", () => {
		const n = fromAny(undefined);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));

		expect(data(msgs)).toEqual([]);
		const last = msgs[msgs.length - 1];
		expect(last[0]).toBe("ERROR");
		expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error);
		expect(n.status).toBe("errored");
	});

	it("describe shows the source factory name (D6)", () => {
		const g = graph();
		g.initNode(timer(1000), [], { name: "clock" });
		const snap = g.describe();
		const byId = Object.fromEntries(snap.nodes.map((n) => [n.id, n]));
		expect(byId.clock.factory).toBe("timer");
	});

	it("firstValueFrom resolves first DATA and unsubscribes safely from sync push", async () => {
		const g = graph();
		const n = g.state(42);

		await expect(firstValueFrom(n)).resolves.toBe(42);
	});

	it("firstValueFrom rejects on ERROR or COMPLETE before DATA", async () => {
		await expect(firstValueFrom(fromAny(undefined))).rejects.toThrow(/SENTINEL|valid value/);
		await expect(firstValueFrom(fromAny([], { iter: true }))).rejects.toThrow(/without DATA/);
	});

	it("singleFromAny dedupes concurrent calls and clears the entry after settle", async () => {
		let calls = 0;
		let resolve!: (value: string) => void;
		const fn = singleFromAny<string, string>((key) => {
			calls += 1;
			return new Promise<string>((r) => {
				resolve = r;
			}).then((value) => `${key}:${value}`);
		});

		const a = fn("x");
		const b = fn("x");
		expect(calls).toBe(1);

		resolve("ok");
		await expect(Promise.all([a, b])).resolves.toEqual(["x:ok", "x:ok"]);

		let callsAfter = 0;
		const sync = singleFromAny<string, number>((key) => {
			callsAfter += 1;
			return Number(key);
		});
		await sync("2");
		await sync("2");
		expect(callsAfter).toBe(2);
	});

	it("singleFromAny dedupes same-key synchronous reentrancy", async () => {
		let calls = 0;
		let fn!: (key: string) => Promise<string>;
		fn = singleFromAny<string, string>((key) => {
			calls += 1;
			if (calls === 1) void fn(key);
			return `${key}:outer`;
		});

		await expect(fn("x")).resolves.toBe("x:outer");
		expect(calls).toBe(1);
	});

	it("singleFromAny uses identity keys by default and keyOf for structural dedupe", async () => {
		let identityCalls = 0;
		const identity = singleFromAny<{ id: number }, string>((key) => {
			identityCalls += 1;
			return `id:${key.id}`;
		});
		const shared = { id: 1 };
		await Promise.all([identity(shared), identity(shared)]);
		await Promise.all([identity({ id: 1 }), identity({ id: 1 })]);
		expect(identityCalls).toBe(3);

		let structuralCalls = 0;
		const structural = singleFromAny<{ id: number }, string>(
			(key) => {
				structuralCalls += 1;
				return `id:${key.id}`;
			},
			{ keyOf: (key) => key.id },
		);
		await Promise.all([structural({ id: 1 }), structural({ id: 1 })]);
		expect(structuralCalls).toBe(1);
	});

	it("singleFromAny bridges Nodes, errors, and empty sources through firstValueFrom", async () => {
		const g = graph();
		const state = g.state(5);
		const errorNode = g.initNode(throwError(new Error("boom")), []);
		const emptyNode = g.initNode(empty<number>(), []);

		await expect(singleFromAny<string, number>(() => state)("node")).resolves.toBe(5);
		await expect(singleFromAny<string, number>(() => errorNode)("err")).rejects.toThrow("boom");
		await expect(singleFromAny<string, number>(() => emptyNode)("empty")).rejects.toThrow(
			/without DATA/,
		);
	});

	it("singleFromAny treats sync iterables as scalar by default and first-value streams with iter:true", async () => {
		const scalar = singleFromAny<string, number[]>(() => [1, 2, 3]);
		await expect(scalar("a")).resolves.toEqual([1, 2, 3]);

		const first = singleFromAny<string, number>(() => [1, 2, 3], { iter: true });
		await expect(first("a")).resolves.toBe(1);
	});

	it("singleFromAny rejects undefined successes from async and iterable inputs", async () => {
		const promiseValue = singleFromAny<string, undefined>(() => Promise.resolve(undefined));
		await expect(promiseValue("promise")).rejects.toThrow(/SENTINEL/);

		async function* asyncValues() {
			yield undefined;
		}
		const asyncValue = singleFromAny<string, undefined>(() => asyncValues());
		await expect(asyncValue("async")).rejects.toThrow(/SENTINEL/);

		const iterValue = singleFromAny<string, undefined>(() => [undefined], { iter: true });
		await expect(iterValue("iter")).rejects.toThrow(/SENTINEL/);
	});

	it("singleFromAny closes async iterables after the first value", async () => {
		let closed = false;
		async function* gen() {
			try {
				yield 1;
				yield 2;
			} finally {
				closed = true;
			}
		}
		const fn = singleFromAny<string, number>(() => gen());

		await expect(fn("iter")).resolves.toBe(1);
		expect(closed).toBe(true);
	});

	it("singleFromAny keeps the first iterable value when close fails after reading it", async () => {
		const iterable = {
			[Symbol.iterator](): Iterator<number> {
				return {
					next: () => ({ value: 1, done: false }),
					return: () => {
						throw new Error("close failed");
					},
				};
			},
		};
		const syncValue = singleFromAny<string, number>(() => iterable, { iter: true });
		await expect(syncValue("sync")).resolves.toBe(1);

		const asyncIterable = {
			[Symbol.asyncIterator](): AsyncIterator<number> {
				return {
					next: async () => ({ value: 2, done: false }),
					return: async () => {
						throw new Error("close failed");
					},
				};
			},
		};
		const asyncValue = singleFromAny<string, number>(() => asyncIterable);
		await expect(asyncValue("async")).resolves.toBe(2);
	});
});

describe("external callback sources (D43)", () => {
	it("fromEvent turns listener callbacks into DATA and removes the listener on deactivation", () => {
		const target = new FakeEventTarget();
		const opts = { capture: true, passive: true };
		const g = graph();
		const n = g.initNode(fromEvent<{ x: number }>(target, "message", opts), [], {
			name: "events",
		});
		const msgs: Message[] = [];
		const unsubscribe = n.subscribe((x) => msgs.push(x));

		target.emit("message", { x: 1 });
		target.emit("other", { x: 2 });
		unsubscribe();
		target.emit("message", { x: 3 });

		expect(data(msgs)).toEqual([{ x: 1 }]);
		expect(target.calls).toEqual([
			["add", "message", opts],
			["remove", "message", opts],
		]);
		expect(g.describe().nodes.find((node) => node.id === "events")?.factory).toBe("fromEvent");
	});

	it("fromPushNotification delivers host pushes and calls the returned unsubscribe", () => {
		let deliver!: (payload: string) => void;
		let unsubscribed = false;
		const g = graph();
		const n = g.initNode(
			fromPushNotification<string>((next) => {
				deliver = next;
				return () => {
					unsubscribed = true;
				};
			}),
			[],
			{ name: "pushes" },
		);
		const msgs: Message[] = [];
		const unsubscribe = n.subscribe((x) => msgs.push(x));

		deliver("a");
		unsubscribe();
		deliver("b");

		expect(data(msgs)).toEqual(["a"]);
		expect(unsubscribed).toBe(true);
		expect(g.describe().nodes.find((node) => node.id === "pushes")?.factory).toBe(
			"fromPushNotification",
		);
	});

	it("fromEvent and fromPushNotification validate their host boundary inputs", () => {
		expect(() => fromEvent({} as never, "message")).toThrow(TypeError);
		expect(() => fromEvent(new FakeEventTarget(), "")).toThrow(TypeError);
		expect(() => fromPushNotification(0 as never)).toThrow(TypeError);
	});
});
