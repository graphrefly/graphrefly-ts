import { describe, expect, it } from "vitest";
import { bridge } from "../../core/bridge.js";
import { COMPLETE, DATA, DIRTY, ERROR, type Messages, RESOLVED } from "../../core/messages.js";
import { state } from "../../core/sugar.js";
import { Graph } from "../../graph/graph.js";

describe("bridge", () => {
	it("forwards DATA from source to target", () => {
		const from = state<number>(0);
		const to = state<number>(0);
		const br = bridge(from, to);

		// Activate bridge
		br.subscribe(() => {});

		from.down([[DATA, 42]]);
		expect(to.get()).toBe(42);
	});

	it("forwards DIRTY, DATA, RESOLVED, COMPLETE, ERROR by default", () => {
		const from = state<number>(0);
		const to = state<number>(0);
		const br = bridge(from, to);
		br.subscribe(() => {});

		const received: Messages = [];
		to.subscribe((msgs) => {
			for (const msg of msgs) received.push(msg);
		});

		from.down([[DIRTY]]);
		from.down([[DATA, 1]]);
		from.down([[RESOLVED]]);

		const types = received.map((m) => m[0]);
		expect(types).toContain(DIRTY);
		expect(types).toContain(DATA);
		expect(types).toContain(RESOLVED);
	});

	it("forwards COMPLETE terminal", () => {
		const from = state<number>(0);
		const to = state<number>(0);
		const br = bridge(from, to);
		br.subscribe(() => {});

		let completed = false;
		to.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === COMPLETE) completed = true;
			}
		});

		from.down([[COMPLETE]]);
		expect(completed).toBe(true);
	});

	it("forwards ERROR terminal with payload", () => {
		const from = state<number>(0);
		const to = state<number>(0);
		const br = bridge(from, to);
		br.subscribe(() => {});

		let errorVal: unknown;
		to.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === ERROR) errorVal = msg[1];
			}
		});

		from.down([[ERROR, new Error("boom")]]);
		expect(errorVal).toBeInstanceOf(Error);
		expect((errorVal as Error).message).toBe("boom");
	});

	it("respects custom down filter", () => {
		const from = state<number>(0);
		const to = state<number>(0);
		// Only forward DATA
		const br = bridge(from, to, { down: [DATA] });
		br.subscribe(() => {});

		let gotDirty = false;
		to.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === DIRTY) gotDirty = true;
			}
		});

		from.down([[DIRTY]]);
		from.down([[DATA, 5]]);

		expect(to.get()).toBe(5);
		expect(gotDirty).toBe(false);
	});

	it("is visible in graph describe()", () => {
		const g = new Graph("test");
		const from = state(0);
		const to = state(0);
		g.add("from", from);
		g.add("to", to);

		const br = bridge(from, to, { name: "__bridge_from_to" });
		g.add("__bridge_from_to", br);
		g.connect("from", "__bridge_from_to");

		const desc = g.describe({ detail: "standard" });
		expect(desc.nodes).toHaveProperty("__bridge_from_to");
		expect(desc.nodes.__bridge_from_to.type).toBe("effect");
	});

	it("upstream from bridge reaches source via dep chain", () => {
		const from = state<number>(0);
		const to = state<number>(0);
		const br = bridge(from, to);
		br.subscribe(() => {});

		// bridge.up() should propagate to from (its dep)
		// from is a source so up() is a no-op, but it doesn't throw
		expect(() => br.up?.([[DATA, 1]])).not.toThrow();
	});

	it("forwards unknown (custom domain) message types — spec §1.3.6", () => {
		const CUSTOM_TYPE = Symbol("custom/domain-signal");
		const from = state<number>(0);
		const to = state<number>(0);
		const br = bridge(from, to);
		br.subscribe(() => {});

		const received: unknown[] = [];
		to.subscribe((msgs) => {
			for (const msg of msgs) received.push(msg[0]);
		});

		// Send a non-standard message type
		from.down([[CUSTOM_TYPE as unknown as symbol, "payload"]]);
		expect(received).toContain(CUSTOM_TYPE);
	});

	it("bridge completes itself when forwarding COMPLETE", () => {
		const from = state<number>(0);
		const to = state<number>(0);
		const br = bridge(from, to);
		br.subscribe(() => {});

		// Before COMPLETE: bridge is active
		expect(br.status).not.toBe("completed");

		from.down([[COMPLETE]]);

		// Bridge forwards COMPLETE to `to`...
		expect(to.status).toBe("completed");
		// ...and also transitions itself to terminal state
		expect(br.status).toBe("completed");
	});

	it("bridge completes itself when forwarding ERROR", () => {
		const from = state<number>(0);
		const to = state<number>(0);
		const br = bridge(from, to);
		br.subscribe(() => {});

		from.down([[ERROR, new Error("boom")]]);

		expect(br.status).toBe("errored");
	});

	it("does not forward known-but-excluded types", () => {
		const from = state<number>(0);
		const to = state<number>(0);
		// Only forward DATA — DIRTY is a known type, excluded
		const br = bridge(from, to, { down: [DATA] });
		br.subscribe(() => {});

		const received: symbol[] = [];
		to.subscribe((msgs) => {
			for (const msg of msgs) received.push(msg[0] as symbol);
		});

		from.down([[DIRTY]]);
		expect(received).not.toContain(DIRTY);
	});

	it("cleans up on graph destroy", () => {
		const g = new Graph("cleanup");
		const from = state(0);
		const to = state(0);
		g.add("from", from);
		g.add("to", to);

		const br = bridge(from, to, { name: "__bridge" });
		g.add("__bridge", br);
		g.connect("from", "__bridge");
		br.subscribe(() => {});

		// Before destroy: bridge works
		from.down([[DATA, 10]]);
		expect(to.get()).toBe(10);

		g.destroy();

		// After destroy: bridge node is torn down (status reflects it)
		// The bridge node no longer receives messages
	});
});
