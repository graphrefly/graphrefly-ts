import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	audit,
	auditTime,
	bufferTime,
	debounce,
	delay,
	graph,
	inspectToAscii,
	type Message,
	map,
	throttle,
	timeout,
} from "../index.js";
import { asState } from "./helpers/as-state.js";

const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);
const types = (msgs: Message[]) => msgs.map((m) => m[0]);
const timerCount = () => vi.getTimerCount();

// CSP-2.7 Slice 4 (D52 / B23): wall-clock time operators as *Map + timer compositions — NO raw
// setTimeout in operator bodies (R-no-raw-async). Driven with fake timers like the source tests.
describe("Slice 4 — wall-clock time operators (D52, *Map + timer)", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("delay shifts every value by ms, keeping all (mergeMap + timer)", () => {
		const g = graph();
		const s = g.node<number>([], null); // manual source
		const d = g.initNode(delay<number>(100), [s]);
		const msgs: Message[] = [];
		d.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		s.set(1);
		s.set(2);
		expect(data(msgs)).toEqual([]); // nothing yet — both delayed
		vi.advanceTimersByTime(100);
		expect(data(msgs)).toEqual([1, 2]); // both fire after 100ms, in order
	});

	it("debounce emits only the latest value after ms of quiet (switchMap + timer cancel-restart)", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const d = g.initNode(debounce<number>(100), [s]);
		const msgs: Message[] = [];
		d.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		s.set(1);
		vi.advanceTimersByTime(50); // 1's timer not yet fired
		s.set(2); // cancels 1's timer (onDeactivation clearTimeout), restarts
		vi.advanceTimersByTime(50); // 50ms since 2 — still not quiet enough
		expect(data(msgs)).toEqual([]);
		vi.advanceTimersByTime(50); // now 100ms since 2 → emit 2 (1 was dropped)
		expect(data(msgs)).toEqual([2]);
	});

	it("throttle emits the leading value, then ignores the source for ms (exhaustMap + window)", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const t = g.initNode(throttle<number>(100), [s]);
		const msgs: Message[] = [];
		t.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		s.set(1); // leading edge → emit 1 immediately
		s.set(2); // within the window → dropped
		expect(data(msgs)).toEqual([1]);
		vi.advanceTimersByTime(100); // window closes
		s.set(3); // new window → emit 3
		expect(data(msgs)).toEqual([1, 3]);
	});
});

// B41 tail (landed 2026-05-31): value-triggered audit/auditTime + subscribe-armed timeout/bufferTime.
describe("B41 tail — audit / auditTime / timeout / bufferTime", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("auditTime emits the window's LATEST value at the window close (trailing throttle)", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const a = g.initNode(auditTime<number>(100), [s]);
		const msgs: Message[] = [];
		a.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		s.set(1); // opens a 100ms window (latest=1)
		s.set(2); // window open → latest=2 (no emit)
		s.set(3); // latest=3
		expect(data(msgs)).toEqual([]); // nothing yet — window still open
		vi.advanceTimersByTime(100); // window closes → emit the LATEST (3), not the first
		expect(data(msgs)).toEqual([3]);
		s.set(4); // a fresh value opens a NEW window
		vi.advanceTimersByTime(100);
		expect(data(msgs)).toEqual([3, 4]);
	});

	it("audit flushes the pending latest on source COMPLETE (B44 flush-on-complete)", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const a = g.initNode(auditTime<number>(100), [s]);
		const msgs: Message[] = [];
		a.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		s.set(1); // opens a window (latest=1)
		s.set(2); // latest=2 (window still open)
		s.complete(); // source completes mid-window → flush latest=2, then COMPLETE
		expect(data(msgs)).toEqual([2]);
		expect(types(msgs)).toContain("COMPLETE");
	});

	it("audit removes its live notifier before forwarding source ERROR", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const a = g.initNode(auditTime<number>(100), [s]);
		const msgs: Message[] = [];
		a.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		s.set(1); // opens a live timer notifier
		expect(timerCount()).toBe(1);
		s.error(new Error("boom"));
		expect(types(msgs)).toContain("ERROR");
		expect(timerCount()).toBe(0);
	});

	it("audit(selector) is the general form — the window closes when the selector's notifier fires", () => {
		const g = graph();
		const s = g.node<number>([], null);
		let gate: ReturnType<typeof g.node<number>> | undefined;
		// a value-triggered window whose duration is a manual gate node (the general notifier form).
		const a = g.initNode(
			audit<number>(() => {
				gate = g.node<number>([], null);
				return gate;
			}),
			[s],
		);
		const msgs: Message[] = [];
		a.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		s.set(1); // opens a window, selector mints `gate`
		s.set(2); // latest=2 (still open)
		expect(data(msgs)).toEqual([]);
		asState(gate).set(0); // the duration notifier fires → emit the latest (2), close
		expect(data(msgs)).toEqual([2]);
	});

	it("auditTime real factory name in describe", () => {
		const g = graph();
		const s = g.node<number>([], null, { name: "s" });
		g.initNode(auditTime<number>(50), [s], { name: "au" });
		const byId = Object.fromEntries(g.inspect().nodes.map((n) => [n.id, n]));
		expect(byId.au.factory).toBe("auditTime");
	});

	it("timeout errors if no first value arrives within ms (SUBSCRIBE-armed, RxJS-cold)", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const t = timeout<number>(s, 100);
		const msgs: Message[] = [];
		t.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		expect(types(msgs)).not.toContain("ERROR"); // armed at subscribe, not yet fired
		vi.advanceTimersByTime(100); // 100ms with no value at all → timeout ERROR
		expect(types(msgs)).toContain("ERROR");
	});

	it("timeout forwards values + resets the idle timer; errors only on a gap > ms", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const t = timeout<number>(s, 100);
		const msgs: Message[] = [];
		t.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		vi.advanceTimersByTime(50); // 50/100 of the initial window
		s.set(1); // forward 1 + RESET the idle timer
		vi.advanceTimersByTime(50); // 50ms since value 1 — fine
		s.set(2); // forward 2 + reset
		vi.advanceTimersByTime(50); // 50ms since 2 — fine
		expect(data(msgs)).toEqual([1, 2]);
		expect(types(msgs)).not.toContain("ERROR");
		vi.advanceTimersByTime(50); // now 100ms since value 2 with no value → ERROR
		expect(types(msgs)).toContain("ERROR");
	});

	it("timeout forwards source COMPLETE (no spurious timeout error)", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const t = timeout<number>(s, 100);
		const msgs: Message[] = [];
		t.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		s.set(1);
		expect(timerCount()).toBe(1);
		s.complete(); // source ends → forward COMPLETE
		expect(timerCount()).toBe(0); // D62 terminal-drain removes the helper-owned timer now
		vi.advanceTimersByTime(200); // the idle timer must NOT fire after COMPLETE
		expect(data(msgs)).toEqual([1]);
		expect(types(msgs)).toContain("COMPLETE");
		expect(types(msgs)).not.toContain("ERROR");
	});

	it("timeout forwards source ERROR and clears its idle timer", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const t = timeout<number>(s, 100);
		const msgs: Message[] = [];
		t.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		expect(timerCount()).toBe(1);
		s.error(new Error("source failed"));
		expect(types(msgs)).toContain("ERROR");
		expect(timerCount()).toBe(0);
	});

	it("bufferTime flushes the buffer every ms; remainder + COMPLETE on source end", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const b = bufferTime<number>(s, 100);
		const msgs: Message[] = [];
		b.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		s.set(1);
		s.set(2);
		vi.advanceTimersByTime(100); // interval ticks → flush [1,2]
		expect(data(msgs)).toEqual([[1, 2]]);
		s.set(3);
		s.complete(); // remainder [3] flushed + COMPLETE
		expect(timerCount()).toBe(0); // terminal-drain releases the construction-time interval
		vi.advanceTimersByTime(200);
		expect(data(msgs)).toEqual([[1, 2], [3]]);
		expect(types(msgs)).toContain("COMPLETE");
	});

	it("bufferTime forwards source ERROR and clears its interval without flushing the partial buffer", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const b = bufferTime<number>(s, 100);
		const msgs: Message[] = [];
		b.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		expect(timerCount()).toBe(1);
		s.set(1);
		s.error(new Error("source failed"));
		expect(types(msgs)).toContain("ERROR");
		expect(data(msgs)).toEqual([]);
		expect(timerCount()).toBe(0);
	});

	it("timeout / bufferTime self-carry their factory name (bare-node, D51)", () => {
		const g = graph();
		const s = g.node<number>([], null);
		expect(timeout<number>(s, 100).factory).toBe("timeout");
		expect(bufferTime<number>(s, 100).factory).toBe("bufferTime");
	});

	it("timeout exposes its live helper timer through describe/render, and releases it when it ends", () => {
		const g = graph({ name: "time" });
		const s = g.node<number>([], null, { name: "src" });
		const t = timeout<number>(s, 100);
		const watch = g.initNode(
			map((v: number) => v),
			[t],
			{ name: "watch" },
		);
		const msgs: Message[] = [];

		watch.subscribe((incoming) => {
			for (const m of incoming) {
				msgs.push(m);
			}
		});
		const armed = g.inspect();
		expect(armed.nodes.some((node) => node.factory === "timeout")).toBe(true);
		expect(armed.nodes.some((node) => node.factory === "timer")).toBe(true);
		expect(inspectToAscii(armed)).toContain("timer");

		s.complete();
		const completed = g.inspect();
		expect(types(msgs)).toContain("COMPLETE");
		expect(completed.nodes.some((node) => node.factory === "timeout")).toBe(true);
		// R-lifetime: the ended timeout released its timers and is back on its declared dependencies,
		// which name its first timer; nothing holds that timer active.
		const timers = completed.nodes.filter((node) => node.factory === "timer");
		expect(timers.every((node) => node.status?.lifecycle === "inactive")).toBe(true);
	});
});
