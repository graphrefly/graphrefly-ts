import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	debounce,
	debounceTime,
	delay,
	graph,
	type Message,
	throttle,
	throttleTime,
} from "../index.js";

const data = (msgs: Message[]) =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", unknown])[1]);

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
		d.subscribe((m) => msgs.push(m));
		s.down([["DATA", 1]]);
		s.down([["DATA", 2]]);
		expect(data(msgs)).toEqual([]); // nothing yet — both delayed
		vi.advanceTimersByTime(100);
		expect(data(msgs)).toEqual([1, 2]); // both fire after 100ms, in order
	});

	it("debounce emits only the latest value after ms of quiet (switchMap + timer cancel-restart)", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const d = g.initNode(debounce<number>(100), [s]);
		const msgs: Message[] = [];
		d.subscribe((m) => msgs.push(m));
		s.down([["DATA", 1]]);
		vi.advanceTimersByTime(50); // 1's timer not yet fired
		s.down([["DATA", 2]]); // cancels 1's timer (onDeactivation clearTimeout), restarts
		vi.advanceTimersByTime(50); // 50ms since 2 — still not quiet enough
		expect(data(msgs)).toEqual([]);
		vi.advanceTimersByTime(50); // now 100ms since 2 → emit 2 (1 was dropped)
		expect(data(msgs)).toEqual([2]);
	});

	it("debounceTime is the debounce alias (real factory name in describe)", () => {
		const g = graph();
		const s = g.node<number>([], null, { name: "s" });
		g.initNode(debounceTime<number>(50), [s], { name: "db" });
		const byId = Object.fromEntries(g.describe().nodes.map((n) => [n.id, n]));
		expect(byId.db.factory).toBe("debounceTime");
	});

	it("throttle emits the leading value, then ignores the source for ms (exhaustMap + window)", () => {
		const g = graph();
		const s = g.node<number>([], null);
		const t = g.initNode(throttle<number>(100), [s]);
		const msgs: Message[] = [];
		t.subscribe((m) => msgs.push(m));
		s.down([["DATA", 1]]); // leading edge → emit 1 immediately
		s.down([["DATA", 2]]); // within the window → dropped
		expect(data(msgs)).toEqual([1]);
		vi.advanceTimersByTime(100); // window closes
		s.down([["DATA", 3]]); // new window → emit 3
		expect(data(msgs)).toEqual([1, 3]);
	});

	it("throttleTime is the throttle alias (real factory name)", () => {
		const g = graph();
		const s = g.node<number>([], null, { name: "s" });
		g.initNode(throttleTime<number>(50), [s], { name: "th" });
		const byId = Object.fromEntries(g.describe().nodes.map((n) => [n.id, n]));
		expect(byId.th.factory).toBe("throttleTime");
	});
});
