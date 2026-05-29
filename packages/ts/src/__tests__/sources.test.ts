import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../index.js";
import {
	fromAny,
	fromAsyncIter,
	fromIter,
	fromPromise,
	graph,
	interval,
	of,
	timer,
} from "../index.js";

const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);

const flush = () => new Promise((r) => setTimeout(r, 0));

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

	it("fromPromise rejecting with undefined → clean ERROR, never [[ERROR, undefined]] (R-data-payload)", async () => {
		const g = graph();
		// Promise.reject(undefined) would otherwise reach ctx.down([[ERROR, undefined]]) and throw
		// inside the .then callback (unhandled rejection); the source coerces undefined → Error.
		const n = g.initNode(fromPromise(Promise.reject(undefined)), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		await flush();
		const last = msgs[msgs.length - 1];
		expect(last[0]).toBe("ERROR");
		expect((last as ["ERROR", unknown])[1]).toBeInstanceOf(Error); // non-SENTINEL payload
		expect(n.status).toBe("errored");
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

	it("of emits a single value then COMPLETE synchronously", () => {
		const g = graph();
		const n = g.initNode(of(42), []);
		const msgs: Message[] = [];
		n.subscribe((x) => msgs.push(x));
		expect(data(msgs)).toEqual([42]);
		expect(msgs[msgs.length - 1][0]).toBe("COMPLETE");
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

	it("describe shows the source factory name (D6)", () => {
		const g = graph();
		g.initNode(timer(1000), [], { name: "clock" });
		const snap = g.describe();
		const byId = Object.fromEntries(snap.nodes.map((n) => [n.id, n]));
		expect(byId.clock.factory).toBe("timer");
	});
});
