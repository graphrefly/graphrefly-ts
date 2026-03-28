import { describe, expect, it, vi } from "vitest";
import { batch } from "../../core/batch.js";
import { DATA, DIRTY, ERROR, type Message, type Messages } from "../../core/messages.js";
import { node } from "../../core/node.js";

// Custom message types for testing
const ESCROW_LOCKED = Symbol.for("test/ESCROW_LOCKED");
const PAYMENT_REQUIRED = Symbol.for("test/PAYMENT_REQUIRED");
const THREAT_DETECTED = Symbol.for("test/THREAT_DETECTED");

describe("onMessage (spec §2.6)", () => {
	it("intercepts a custom message type and consumes it", () => {
		const source = node<number>({ initial: 0 });
		const downstream: Messages[] = [];

		const handler = node([source], ([v]) => v, {
			onMessage(msg, _depIndex, actions) {
				if (msg[0] === ESCROW_LOCKED) {
					actions.emit({ status: "locked", tx: msg[1] });
					return true;
				}
				return false;
			},
		});

		handler.subscribe((msgs) => downstream.push(msgs));

		// Send custom message type
		source.down([[ESCROW_LOCKED, "0xabc"]]);

		// Handler should have emitted a DATA with the transformed value
		const allTypes = downstream.flat().map((m) => m[0]);
		expect(allTypes).toContain(DATA);
		expect(handler.get()).toEqual({ status: "locked", tx: "0xabc" });
	});

	it("forwards custom messages when onMessage returns false", () => {
		const source = node<number>({ initial: 0 });
		const downstream: Messages[] = [];

		const handler = node([source], ([v]) => v, {
			onMessage(msg, _depIndex, _actions) {
				if (msg[0] === ESCROW_LOCKED) return true;
				return false;
			},
		});

		handler.subscribe((msgs) => downstream.push(msgs));

		// PAYMENT_REQUIRED is not handled by onMessage → forwarded by default dispatch
		source.down([[PAYMENT_REQUIRED, { amount: 0.1 }]]);

		const forwarded = downstream.flat();
		expect(forwarded).toContainEqual([PAYMENT_REQUIRED, { amount: 0.1 }]);
	});

	it("nodes without onMessage forward unknown types unchanged", () => {
		const source = node<number>({ initial: 0 });
		const passthrough = node([source], ([v]) => v);
		const downstream: Messages[] = [];

		passthrough.subscribe((msgs) => downstream.push(msgs));
		source.down([[THREAT_DETECTED, { level: "critical" }]]);

		const forwarded = downstream.flat();
		expect(forwarded).toContainEqual([THREAT_DETECTED, { level: "critical" }]);
	});

	it("onMessage receives the correct depIndex", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const indices: number[] = [];

		const handler = node([a, b], ([av, bv]) => (av as number) + (bv as number), {
			onMessage(msg, depIndex, _actions) {
				if (msg[0] === ESCROW_LOCKED) {
					indices.push(depIndex);
					return true;
				}
				return false;
			},
		});

		handler.subscribe(() => undefined);

		a.down([[ESCROW_LOCKED, "from-a"]]);
		b.down([[ESCROW_LOCKED, "from-b"]]);

		expect(indices).toEqual([0, 1]);
	});

	it("onMessage can intercept protocol messages (DIRTY/DATA)", () => {
		const source = node<number>({ initial: 0 });
		const dirtySeen: unknown[] = [];
		let fnRuns = 0;

		const handler = node(
			[source],
			([v]) => {
				fnRuns++;
				return v;
			},
			{
				onMessage(msg, _depIndex, _actions) {
					if (msg[0] === DIRTY) {
						dirtySeen.push("intercepted");
						return true; // consume DIRTY — fn should not run
					}
					return false;
				},
			},
		);

		handler.subscribe(() => undefined);

		// Send DIRTY alone — it should be consumed
		source.down([[DIRTY]]);
		expect(dirtySeen).toEqual(["intercepted"]);

		// DATA still goes through default dispatch
		const fnRunsBefore = fnRuns;
		source.down([[DATA, 42]]);
		// DATA on a node with fn that didn't see DIRTY — _onDepSettled auto-marks
		// dirty, so fn runs exactly once
		expect(fnRuns).toBe(fnRunsBefore + 1);
	});

	it("consumed messages are NOT forwarded downstream", () => {
		const source = node<number>({ initial: 0 });
		const downstream: Messages[] = [];

		const handler = node([source], ([v]) => v, {
			onMessage(msg, _depIndex, _actions) {
				if (msg[0] === ESCROW_LOCKED) return true; // consume, no emit
				return false;
			},
		});

		handler.subscribe((msgs) => downstream.push(msgs));
		// Clear initial subscription emissions
		downstream.length = 0;

		source.down([[ESCROW_LOCKED, "0xabc"]]);

		// Nothing should appear downstream — consumed with no emit
		expect(downstream).toEqual([]);
	});

	it("onMessage works with passthrough nodes (no fn)", () => {
		const source = node<number>({ initial: 0 });
		const downstream: Messages[] = [];

		// Passthrough node (no fn) with onMessage
		const handler = node([source], undefined, {
			onMessage(msg, _depIndex, actions) {
				if (msg[0] === ESCROW_LOCKED) {
					actions.down([[DATA, `escrow:${msg[1]}`]]);
					return true;
				}
				return false;
			},
		});

		handler.subscribe((msgs) => downstream.push(msgs));

		// Custom type → intercepted
		source.down([[ESCROW_LOCKED, "tx1"]]);
		const escrowMsgs = downstream.flat().filter((m) => m[0] === DATA);
		expect(escrowMsgs[0]?.[1]).toBe("escrow:tx1");

		// Normal DATA → passthrough as usual
		downstream.length = 0;
		source.down([[DATA, 99]]);
		const dataMsgs = downstream.flat().filter((m) => m[0] === DATA);
		expect(dataMsgs).toContainEqual([DATA, 99]);
	});

	it("onMessage works correctly inside batch()", () => {
		const source = node<number>({ initial: 0 });
		const downstream: Messages[] = [];
		const customSeen: unknown[] = [];

		const handler = node([source], ([v]) => v, {
			onMessage(msg, _depIndex, _actions) {
				if (msg[0] === ESCROW_LOCKED) {
					customSeen.push(msg[1]);
					return true;
				}
				return false;
			},
		});

		handler.subscribe((msgs) => downstream.push(msgs));

		batch(() => {
			source.down([[DIRTY]]);
			source.down([[ESCROW_LOCKED, "batched"]]);
			source.down([[DATA, 10]]);
		});

		expect(customSeen).toEqual(["batched"]);
		// Normal DIRTY/DATA cycle should still work
		expect(handler.get()).toBe(10);
	});

	it("onMessage handler is not called for source nodes (no deps)", () => {
		const onMsg = vi.fn(() => true);

		// Source node — onMessage should never fire (no deps to receive from)
		const source = node<number>({ initial: 0, onMessage: onMsg });
		source.subscribe(() => undefined);
		source.down([[DATA, 1]]);

		expect(onMsg).not.toHaveBeenCalled();
	});

	it("chain of nodes: custom type propagates through non-handling nodes", () => {
		const source = node<number>({ initial: 0 });

		// Middle node: no onMessage → forwards unknown types
		const middle = node([source], ([v]) => v);

		// End node: handles ESCROW_LOCKED
		const endResults: unknown[] = [];
		const end = node([middle], ([v]) => v, {
			onMessage(msg, _depIndex, actions) {
				if (msg[0] === ESCROW_LOCKED) {
					endResults.push(msg[1]);
					actions.emit(`handled:${msg[1]}`);
					return true;
				}
				return false;
			},
		});

		end.subscribe(() => undefined);

		source.down([[ESCROW_LOCKED, "deep"]]);

		expect(endResults).toEqual(["deep"]);
		expect(end.get()).toBe("handled:deep");
	});

	it("onMessage that throws emits ERROR downstream", () => {
		const source = node<number>({ initial: 0 });
		const downstream: Message[] = [];

		const handler = node([source], ([v]) => v, {
			onMessage(msg, _depIndex, _actions) {
				if (msg[0] === ESCROW_LOCKED) {
					throw new Error("handler exploded");
				}
				return false;
			},
		});

		handler.subscribe((msgs) => {
			for (const m of msgs) downstream.push(m);
		});
		downstream.length = 0;

		source.down([[ESCROW_LOCKED, "boom"]]);

		const errorMsgs = downstream.filter((m) => m[0] === ERROR);
		expect(errorMsgs).toHaveLength(1);
		expect((errorMsgs[0][1] as Error).message).toBe("handler exploded");
		expect(handler.status).toBe("errored");
	});

	it("custom message on one dep does not break diamond settlement", () => {
		const root = node<number>({ initial: 0 });
		const left = node([root], ([v]) => (v as number) + 1);
		const right = node([root], ([v]) => (v as number) + 2);
		const customSeen: unknown[] = [];
		let diamondRuns = 0;

		const diamond = node(
			[left, right],
			([l, r]) => {
				diamondRuns++;
				return (l as number) + (r as number);
			},
			{
				onMessage(msg, depIndex, _actions) {
					if (msg[0] === ESCROW_LOCKED) {
						customSeen.push({ depIndex, data: msg[1] });
						return true;
					}
					return false;
				},
			},
		);

		diamond.subscribe(() => undefined);
		const runsAfterConnect = diamondRuns;

		// Normal DIRTY/DATA cycle through diamond should still work
		root.down([[DIRTY], [DATA, 10]]);
		expect(diamond.get()).toBe(10 + 1 + (10 + 2)); // 23
		expect(diamondRuns).toBe(runsAfterConnect + 1); // exactly once

		// Custom message through one branch doesn't break settlement
		left.down([[ESCROW_LOCKED, "via-left"]]);
		expect(customSeen).toEqual([{ depIndex: 0, data: "via-left" }]);
		// Value unchanged, diamond fn not called again
		expect(diamondRuns).toBe(runsAfterConnect + 1);

		// Normal update still works after custom message
		root.down([[DIRTY], [DATA, 20]]);
		expect(diamond.get()).toBe(20 + 1 + (20 + 2)); // 43
		expect(diamondRuns).toBe(runsAfterConnect + 2);
	});
});
