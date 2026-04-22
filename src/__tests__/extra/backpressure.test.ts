import { describe, expect, it, vi } from "vitest";
import {
	ObserveGateway,
	type ObserveWsMessage,
	observeSSE,
	observeSubscription,
} from "../../compat/nestjs/gateway.js";
import { COMPLETE, DATA, type Messages, PAUSE, RESUME } from "../../core/messages.js";
import { node } from "../../core/node.js";
import { state } from "../../core/sugar.js";
import { createWatermarkController } from "../../extra/backpressure.js";
import { Graph } from "../../graph/graph.js";

// ---------------------------------------------------------------------------
// WatermarkController unit tests
// ---------------------------------------------------------------------------

describe("WatermarkController", () => {
	function setup(high = 3, low = 1) {
		const sent: Messages[] = [];
		const wm = createWatermarkController((msgs) => sent.push(msgs), {
			highWaterMark: high,
			lowWaterMark: low,
		});
		return { wm, sent };
	}

	it("tracks pending count", () => {
		const { wm } = setup();
		expect(wm.pending).toBe(0);
		wm.onEnqueue();
		expect(wm.pending).toBe(1);
		wm.onEnqueue();
		expect(wm.pending).toBe(2);
		wm.onDequeue();
		expect(wm.pending).toBe(1);
	});

	it("sends PAUSE at highWaterMark", () => {
		const { wm, sent } = setup(3, 1);
		wm.onEnqueue(); // 1
		wm.onEnqueue(); // 2
		expect(wm.paused).toBe(false);
		expect(sent).toHaveLength(0);

		const paused = wm.onEnqueue(); // 3 = highWaterMark
		expect(paused).toBe(true);
		expect(wm.paused).toBe(true);
		expect(sent).toHaveLength(1);
		expect(sent[0]![0]![0]).toBe(PAUSE);
	});

	it("sends RESUME at lowWaterMark after being paused", () => {
		const { wm, sent } = setup(3, 1);
		wm.onEnqueue();
		wm.onEnqueue();
		wm.onEnqueue(); // PAUSE sent
		expect(wm.paused).toBe(true);

		wm.onDequeue(); // 2 — still above lowWaterMark
		expect(wm.paused).toBe(true);
		expect(sent).toHaveLength(1); // only PAUSE

		const resumed = wm.onDequeue(); // 1 = lowWaterMark
		expect(resumed).toBe(true);
		expect(wm.paused).toBe(false);
		expect(sent).toHaveLength(2); // PAUSE + RESUME
		expect(sent[1]![0]![0]).toBe(RESUME);
	});

	it("does not send RESUME when not paused", () => {
		const { wm, sent } = setup(3, 1);
		wm.onEnqueue();
		wm.onDequeue();
		expect(sent).toHaveLength(0);
	});

	it("does not send duplicate PAUSE", () => {
		const { wm, sent } = setup(3, 1);
		wm.onEnqueue();
		wm.onEnqueue();
		wm.onEnqueue(); // PAUSE
		wm.onEnqueue(); // 4 — still paused, no duplicate
		expect(sent).toHaveLength(1);
	});

	it("dispose sends RESUME if paused", () => {
		const { wm, sent } = setup(2, 0);
		wm.onEnqueue();
		wm.onEnqueue(); // PAUSE
		expect(wm.paused).toBe(true);
		wm.dispose();
		expect(wm.paused).toBe(false);
		expect(sent).toHaveLength(2);
		expect(sent[1]![0]![0]).toBe(RESUME);
	});

	it("dispose is no-op when not paused", () => {
		const { wm, sent } = setup();
		wm.dispose();
		expect(sent).toHaveLength(0);
	});

	it("uses unique lockId per controller", () => {
		const sent1: Messages[] = [];
		const sent2: Messages[] = [];
		const wm1 = createWatermarkController((m) => sent1.push(m), {
			highWaterMark: 1,
			lowWaterMark: 0,
		});
		const wm2 = createWatermarkController((m) => sent2.push(m), {
			highWaterMark: 1,
			lowWaterMark: 0,
		});
		wm1.onEnqueue();
		wm2.onEnqueue();

		const lockId1 = sent1[0]![0]![1];
		const lockId2 = sent2[0]![0]![1];
		expect(typeof lockId1).toBe("symbol");
		expect(typeof lockId2).toBe("symbol");
		expect(lockId1).not.toBe(lockId2);
	});

	it("pending does not go below zero", () => {
		const { wm } = setup();
		wm.onDequeue();
		wm.onDequeue();
		expect(wm.pending).toBe(0);
	});

	it("throws on invalid watermark options", () => {
		const noop = () => {};
		expect(() => createWatermarkController(noop, { highWaterMark: 0, lowWaterMark: 0 })).toThrow(
			"highWaterMark must be >= 1",
		);
		expect(() => createWatermarkController(noop, { highWaterMark: 3, lowWaterMark: -1 })).toThrow(
			"lowWaterMark must be >= 0",
		);
		expect(() => createWatermarkController(noop, { highWaterMark: 3, lowWaterMark: 3 })).toThrow(
			"lowWaterMark must be < highWaterMark",
		);
		expect(() => createWatermarkController(noop, { highWaterMark: 3, lowWaterMark: 5 })).toThrow(
			"lowWaterMark must be < highWaterMark",
		);
	});
});

// ---------------------------------------------------------------------------
// GraphObserveOne.up() integration
// ---------------------------------------------------------------------------

describe("GraphObserveOne.up()", () => {
	it("propagates PAUSE upstream through observed node", () => {
		const s = state(0);
		const g = new Graph("bp-up");
		g.add(s, { name: "s" });

		const upMsgs: Messages[] = [];
		const orig = s.up;
		s.up = (msgs: Messages) => {
			upMsgs.push(msgs);
			orig?.call(s, msgs);
		};

		const handle = g.observe("s");
		handle.subscribe(() => {});
		handle.up([[PAUSE, "test-lock"]]);

		expect(upMsgs.length).toBe(1);
		expect(upMsgs[0]![0]![0]).toBe(PAUSE);
		expect(upMsgs[0]![0]![1]).toBe("test-lock");
		g.destroy();
	});

	it("graph-wide observe.up() targets specific path", () => {
		const a = state(0);
		const b = state(0);
		const g = new Graph("bp-up-all");
		g.add(a, { name: "a" });
		g.add(b, { name: "b" });

		const aMsgs: Messages[] = [];
		const bMsgs: Messages[] = [];
		const origA = a.up;
		const origB = b.up;
		a.up = (msgs: Messages) => {
			aMsgs.push(msgs);
			origA?.call(a, msgs);
		};
		b.up = (msgs: Messages) => {
			bMsgs.push(msgs);
			origB?.call(b, msgs);
		};

		const handle = g.observe();
		handle.subscribe(() => {});
		handle.up("a", [[PAUSE, "lock-a"]]);

		expect(aMsgs.length).toBe(1);
		expect(bMsgs.length).toBe(0);
		g.destroy();
	});
});

// ---------------------------------------------------------------------------
// observeSubscription backpressure
// ---------------------------------------------------------------------------

describe("observeSubscription — backpressure", () => {
	it("sends PAUSE when queue exceeds highWaterMark", () => {
		const s = node<number>();
		const g = new Graph("sub-bp");
		g.add(s, { name: "n" });

		const upMsgs: Messages[] = [];
		const orig = s.up;
		s.up = (msgs: Messages) => {
			upMsgs.push(msgs);
			orig?.call(s, msgs);
		};

		const iter = observeSubscription<number>(g, "n", {
			highWaterMark: 2,
			lowWaterMark: 1,
		});

		// Push 2 items without consuming — should trigger PAUSE at highWaterMark
		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);

		expect(upMsgs.some((m) => m[0]![0] === PAUSE)).toBe(true);

		// Drain via next() — should eventually trigger RESUME
		void iter.next();
		expect(upMsgs.some((m) => m[0]![0] === RESUME)).toBe(true);

		void iter.return!();
		g.destroy();
	});

	it("no backpressure when options not set", async () => {
		const s = node<number>();
		const g = new Graph("sub-no-bp");
		g.add(s, { name: "n" });

		const upMsgs: Messages[] = [];
		const orig = s.up;
		s.up = (msgs: Messages) => {
			upMsgs.push(msgs);
			orig?.call(s, msgs);
		};

		const iter = observeSubscription<number>(g, "n");
		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);
		s.down([[DATA, 3]]);
		s.down([[COMPLETE]]);

		const results: number[] = [];
		for await (const v of iter) results.push(v);
		expect(results).toEqual([1, 2, 3]);
		expect(upMsgs.length).toBe(0);
		g.destroy();
	});

	it("dispose sends RESUME on iterator return", () => {
		const s = state<number>(0);
		const g = new Graph("sub-bp-dispose");
		g.add(s, { name: "n" });

		const upMsgs: Messages[] = [];
		const orig = s.up;
		s.up = (msgs: Messages) => {
			upMsgs.push(msgs);
			orig?.call(s, msgs);
		};

		const iter = observeSubscription<number>(g, "n", {
			highWaterMark: 1,
			lowWaterMark: 0,
		});

		s.down([[DATA, 1]]); // triggers PAUSE
		expect(upMsgs.some((m) => m[0]![0] === PAUSE)).toBe(true);

		void iter.return!(); // dispose should RESUME
		expect(upMsgs.filter((m) => m[0]![0] === RESUME).length).toBe(1);
		g.destroy();
	});
});

// ---------------------------------------------------------------------------
// ObserveGateway backpressure
// ---------------------------------------------------------------------------

describe("ObserveGateway — backpressure", () => {
	function makeMockClient(): { send: ReturnType<typeof vi.fn>; id: string } {
		return { send: vi.fn(), id: Math.random().toString(36) };
	}

	it("sends PAUSE when messages exceed highWaterMark, RESUME on ack", () => {
		const s = node<number>();
		const g = new Graph("gw-bp");
		g.add(s, { name: "counter" });

		const upMsgs: Messages[] = [];
		const orig = s.up;
		s.up = (msgs: Messages) => {
			upMsgs.push(msgs);
			orig?.call(s, msgs);
		};

		const gw = new ObserveGateway(g, { highWaterMark: 2, lowWaterMark: 1 });
		const client = makeMockClient();
		gw.handleConnection(client);

		const sent: ObserveWsMessage[] = [];
		gw.handleMessage(client, { type: "subscribe", path: "counter" }, (msg) => sent.push(msg));

		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);

		expect(upMsgs.some((m) => m[0]![0] === PAUSE)).toBe(true);

		// Ack 1 item — should trigger RESUME (pending goes from 2 to 1 = lowWaterMark)
		gw.handleMessage(client, { type: "ack", path: "counter", count: 1 });
		expect(upMsgs.some((m) => m[0]![0] === RESUME)).toBe(true);

		gw.destroy();
		g.destroy();
	});

	it("disconnect disposes watermark controllers", () => {
		const s = state<number>(0);
		const g = new Graph("gw-bp-dc");
		g.add(s, { name: "n" });

		const upMsgs: Messages[] = [];
		const orig = s.up;
		s.up = (msgs: Messages) => {
			upMsgs.push(msgs);
			orig?.call(s, msgs);
		};

		const gw = new ObserveGateway(g, { highWaterMark: 1, lowWaterMark: 0 });
		const client = makeMockClient();
		gw.handleConnection(client);

		const sent: ObserveWsMessage[] = [];
		gw.handleMessage(client, { type: "subscribe", path: "n" }, (msg) => sent.push(msg));

		s.down([[DATA, 1]]); // PAUSE
		expect(upMsgs.some((m) => m[0]![0] === PAUSE)).toBe(true);

		gw.handleDisconnect(client); // should RESUME
		expect(upMsgs.some((m) => m[0]![0] === RESUME)).toBe(true);

		g.destroy();
	});

	it("no backpressure when watermarks not configured", () => {
		const s = state<number>(0);
		const g = new Graph("gw-no-bp");
		g.add(s, { name: "n" });

		const upMsgs: Messages[] = [];
		const orig = s.up;
		s.up = (msgs: Messages) => {
			upMsgs.push(msgs);
			orig?.call(s, msgs);
		};

		const gw = new ObserveGateway(g);
		const client = makeMockClient();
		gw.handleConnection(client);

		const sent: ObserveWsMessage[] = [];
		gw.handleMessage(client, { type: "subscribe", path: "n" }, (msg) => sent.push(msg));

		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);
		s.down([[DATA, 3]]);

		expect(upMsgs.length).toBe(0);
		gw.destroy();
		g.destroy();
	});
});

// ---------------------------------------------------------------------------
// observeSSE backpressure
// ---------------------------------------------------------------------------

describe("observeSSE — backpressure", () => {
	it("buffers and drains via pull when watermarks set", async () => {
		const s = state<number>(0);
		const g = new Graph("sse-bp");
		g.add(s, { name: "n" });

		const upMsgs: Messages[] = [];
		const orig = s.up;
		s.up = (msgs: Messages) => {
			upMsgs.push(msgs);
			orig?.call(s, msgs);
		};

		const stream = observeSSE(g, "n", { highWaterMark: 2, lowWaterMark: 1 });
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		// Push enough to trigger PAUSE
		s.down([[DATA, 1]]);
		s.down([[DATA, 2]]);

		expect(upMsgs.some((m) => m[0]![0] === PAUSE)).toBe(true);

		// Read/drain items — pull() triggers onDequeue → RESUME
		const { value: v1 } = await reader.read();
		expect(decoder.decode(v1)).toContain("event: data");

		// May need another read to cross lowWaterMark
		const { value: v2 } = await reader.read();
		expect(decoder.decode(v2)).toContain("event: data");

		expect(upMsgs.some((m) => m[0]![0] === RESUME)).toBe(true);

		// Clean up
		s.down([[COMPLETE]]);
		// Drain remaining
		while (true) {
			const { done } = await reader.read();
			if (done) break;
		}
		g.destroy();
	});

	it("works without backpressure (default)", async () => {
		const s = state<number>(0);
		const g = new Graph("sse-no-bp");
		g.add(s, { name: "n" });

		const stream = observeSSE(g, "n");
		const reader = stream.getReader();
		const decoder = new TextDecoder();

		s.down([[DATA, 42]]);
		s.down([[COMPLETE]]);

		const chunks: string[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(decoder.decode(value));
		}

		const text = chunks.join("");
		expect(text).toContain("event: data\ndata: 42\n\n");
		expect(text).toContain("event: complete\n\n");
		g.destroy();
	});
});
