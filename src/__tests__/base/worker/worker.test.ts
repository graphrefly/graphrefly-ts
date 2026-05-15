import { MessageChannel } from "node:worker_threads";
import type { Messages } from "@graphrefly/pure-ts/core";
import {
	batch,
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	node,
	RESOLVED,
	TEARDOWN,
} from "@graphrefly/pure-ts/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { workerBridge } from "../../../base/worker/bridge.js";
import {
	deserializeError,
	nameToSignal,
	serializeError,
	signalToName,
} from "../../../base/worker/protocol.js";
import { workerSelf } from "../../../base/worker/self.js";
import type { WorkerTransport } from "../../../base/worker/transport.js";
import { collect } from "../test-helpers.js";

/** Create a pair of WorkerTransport backed by a node:worker_threads MessageChannel. */
function transportPair(): [WorkerTransport, WorkerTransport] {
	const { port1, port2 } = new MessageChannel();
	const makeTransport = (port: typeof port1): WorkerTransport => ({
		post(data, transfer) {
			port.postMessage(data, transfer ?? []);
		},
		listen(handler) {
			const h = (data: unknown) => handler(data);
			port.on("message", h);
			return () => port.off("message", h);
		},
		terminate() {
			port.close();
		},
	});
	return [makeTransport(port1), makeTransport(port2)];
}

function tick(ms = 0): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Protocol serialization
// ---------------------------------------------------------------------------

describe("worker protocol", () => {
	it("serializes and deserializes signal names", () => {
		expect(signalToName(TEARDOWN)).toBe("TEARDOWN");
		expect(signalToName(COMPLETE)).toBe("COMPLETE");
		expect(signalToName(ERROR)).toBe("ERROR");
		expect(nameToSignal("TEARDOWN")).toBe(TEARDOWN);
		expect(nameToSignal("COMPLETE")).toBe(COMPLETE);
		expect(nameToSignal("UNKNOWN")).toBeUndefined();
		expect(signalToName(Symbol("bogus"))).toBe("UNKNOWN");
	});

	it("round-trips custom Symbol.for types", () => {
		const CUSTOM = Symbol.for("custom/MY_TYPE");
		const name = signalToName(CUSTOM);
		expect(name).toBe("custom/MY_TYPE");
		const restored = nameToSignal(name);
		expect(restored).toBe(CUSTOM);
	});

	it("serializes and deserializes errors", () => {
		const err = new Error("test error");
		err.name = "TestError";
		const serialized = serializeError(err);
		expect(serialized.message).toBe("test error");
		expect(serialized.name).toBe("TestError");
		expect(serialized.stack).toBeDefined();

		const restored = deserializeError(serialized);
		expect(restored.message).toBe("test error");
		expect(restored.name).toBe("TestError");
	});

	it("serializes non-Error values", () => {
		const serialized = serializeError("string error");
		expect(serialized.message).toBe("string error");
		expect(serialized.name).toBe("Error");
	});
});

// ---------------------------------------------------------------------------
// Bridge + Self handshake & bidirectional flow
// ---------------------------------------------------------------------------

describe("workerBridge + workerSelf", () => {
	let bridges: Array<{ destroy(): void }> = [];

	afterEach(() => {
		for (const b of bridges) b.destroy();
		bridges = [];
	});

	it("completes handshake and exchanges initial values", async () => {
		const [mainTransport, workerTransport] = transportPair();

		const mainNode = node([], { name: "mainVal", initial: 42 });

		const bridge = workerBridge(mainTransport, {
			expose: { mainVal: mainNode },
			import: ["workerVal"] as const,
			name: "test",
		});
		bridges.push(bridge);

		const self = workerSelf(workerTransport, {
			import: ["mainVal"] as const,
			expose: () => {
				const w = node([], { name: "workerVal", initial: 100 });
				return { workerVal: w };
			},
		});
		bridges.push(self);

		await tick(50);

		// Bridge should be connected
		expect(bridge.meta.status.cache).toBe("connected");

		// Worker's initial value should be available on main
		expect(bridge.workerVal.cache).toBe(100);
	});

	it("forwards value updates from main to worker", async () => {
		const [mainTransport, workerTransport] = transportPair();

		const mainNode = node([], { name: "msg", initial: "hello" });
		const bridge = workerBridge(mainTransport, {
			expose: { msg: mainNode },
			import: ["echo"] as const,
		});
		bridges.push(bridge);

		let workerProxy: { cache: unknown } | undefined;
		const self = workerSelf(workerTransport, {
			import: ["msg"] as const,
			expose: (imported) => {
				workerProxy = imported.msg;
				// Echo: derive from imported msg
				const echo = node(
					[imported.msg],
					(batchData, actions, ctx) => {
						const data = batchData.map((batch, i) =>
							batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
						);
						actions.emit(`echo:${data[0]}`);
					},
					{ describeKind: "derived" },
				);
				return { echo };
			},
		});
		bridges.push(self);

		await tick(50);

		// Worker should have received initial value
		expect(workerProxy!.cache).toBe("hello");

		// Update main node -> should propagate to worker and back as echo
		mainNode.down([[DATA, "world"]]);
		await tick(50);

		expect(workerProxy!.cache).toBe("world");
		expect(bridge.echo.cache).toBe("echo:world");
	});

	it("forwards value updates from worker to main", async () => {
		const [mainTransport, workerTransport] = transportPair();

		let workerCounter: { down(m: Messages): void } | undefined;
		const bridge = workerBridge(mainTransport, {
			import: ["counter"] as const,
		});
		bridges.push(bridge);

		const self = workerSelf(workerTransport, {
			expose: () => {
				const c = node([], { name: "counter", initial: 0 });
				workerCounter = c;
				return { counter: c };
			},
		});
		bridges.push(self);

		await tick(50);
		expect(bridge.counter.cache).toBe(0);

		workerCounter!.down([[DATA, 1]]);
		await tick(50);
		expect(bridge.counter.cache).toBe(1);

		workerCounter!.down([[DATA, 2]]);
		await tick(50);
		expect(bridge.counter.cache).toBe(2);
	});

	it("coalesces batch updates into single message", async () => {
		const [mainTransport, workerTransport] = transportPair();

		const a = node([], { name: "a", initial: 0 });
		const b = node([], { name: "b", initial: 0 });

		const postSpy = vi.fn(mainTransport.post);
		mainTransport.post = postSpy;

		const bridge = workerBridge(mainTransport, {
			expose: { a, b },
			import: ["ack"] as const,
		});
		bridges.push(bridge);

		const self = workerSelf(workerTransport, {
			expose: () => ({ ack: node([], { initial: "ok" }) }),
		});
		bridges.push(self);

		await tick(50);
		postSpy.mockClear();

		// Batch update both nodes
		batch(() => {
			a.down([[DATA, 1]]);
			b.down([[DATA, 2]]);
		});
		await tick(50);

		// Should have sent a single batch message (type "b") for both updates
		const batchMessages = postSpy.mock.calls.filter(
			([msg]) => typeof msg === "object" && msg !== null && (msg as any).t === "b",
		);
		expect(batchMessages.length).toBe(1);
		expect((batchMessages[0][0] as any).u).toEqual({ a: 1, b: 2 });
	});

	it("ignores stale batch updates when versions regress", async () => {
		const [mainTransport, workerTransport] = transportPair();
		const bridge = workerBridge(mainTransport, {
			import: ["counter"] as const,
		});
		bridges.push(bridge);

		workerTransport.post({ t: "b", u: { counter: 2 }, v: { counter: 2 } });
		await tick(20);
		expect(bridge.counter.cache).toBe(2);

		// Stale update with older version must be ignored.
		workerTransport.post({ t: "b", u: { counter: 1 }, v: { counter: 1 } });
		await tick(20);
		expect(bridge.counter.cache).toBe(2);
	});

	it("forwards COMPLETE from worker to main proxy", async () => {
		const [mainTransport, workerTransport] = transportPair();

		let workerNode: { down(m: Messages): void } | undefined;
		const bridge = workerBridge(mainTransport, {
			import: ["src"] as const,
		});
		bridges.push(bridge);

		const self = workerSelf(workerTransport, {
			expose: () => {
				const s = node([], { name: "src", initial: 0 });
				workerNode = s;
				return { src: s };
			},
		});
		bridges.push(self);

		await tick(50);

		const { batches, unsub } = collect(bridge.src);

		workerNode!.down([[COMPLETE]]);
		await tick(50);

		const hasComplete = batches.some((b) => b.some((m) => (m as any)[0] === COMPLETE));
		expect(hasComplete).toBe(true);
		unsub();
	});

	it("forwards ERROR with serialized error payload", async () => {
		const [mainTransport, workerTransport] = transportPair();

		let workerNode: { down(m: Messages): void } | undefined;
		const bridge = workerBridge(mainTransport, {
			import: ["src"] as const,
		});
		bridges.push(bridge);

		const self = workerSelf(workerTransport, {
			expose: () => {
				const s = node([], { name: "src", initial: 0 });
				workerNode = s;
				return { src: s };
			},
		});
		bridges.push(self);

		await tick(50);

		const { batches, unsub } = collect(bridge.src);

		workerNode!.down([[ERROR, new Error("boom")]]);
		await tick(50);

		const errorBatch = batches.find((b) => b.some((m) => (m as any)[0] === ERROR));
		expect(errorBatch).toBeDefined();
		const errorMsg = errorBatch!.find((m) => (m as any)[0] === ERROR) as any;
		expect(errorMsg[1]).toBeInstanceOf(Error);
		expect(errorMsg[1].message).toBe("boom");
		unsub();
	});

	it("bridge.destroy() sends TEARDOWN and sets status to closed", async () => {
		const [mainTransport, workerTransport] = transportPair();

		// Spy on worker transport to verify TEARDOWN arrives
		const workerMessages: unknown[] = [];
		const origListen = workerTransport.listen;
		workerTransport.listen = (handler) => {
			return origListen((data) => {
				workerMessages.push(data);
				handler(data);
			});
		};

		const bridge = workerBridge(mainTransport, {
			import: ["val"] as const,
		});
		bridges.push(bridge);

		const self = workerSelf(workerTransport, {
			expose: () => ({ val: node([], { initial: 1 }) }),
		});
		bridges.push(self);

		await tick(50);
		expect(bridge.meta.status.cache).toBe("connected");

		workerMessages.length = 0;
		bridge.destroy();
		await tick(100);

		expect(bridge.meta.status.cache).toBe("closed");
		// Verify bridge sent a TEARDOWN signal message
		const teardownMsg = workerMessages.find(
			(m: any) => m.t === "s" && m.sig === "TEARDOWN" && m.s === "*",
		);
		expect(teardownMsg).toBeDefined();
	});

	it("workerSelf.destroy() cleans up without crashing", async () => {
		const [mainTransport, workerTransport] = transportPair();

		const bridge = workerBridge(mainTransport, {
			import: ["val"] as const,
		});
		bridges.push(bridge);

		const self = workerSelf(workerTransport, {
			expose: () => ({ val: node([], { initial: 99 }) }),
		});

		await tick(50);
		expect(bridge.val.cache).toBe(99);

		// Destroy worker side only
		self.destroy();
		bridges.push(bridge); // already there, just for cleanup

		// Bridge should still be functional (no crash), proxy retains last value
		expect(bridge.val.cache).toBe(99);
	});

	it("handles import-only bridge (no expose)", async () => {
		const [mainTransport, workerTransport] = transportPair();

		const bridge = workerBridge(mainTransport, {
			import: ["data"] as const,
		});
		bridges.push(bridge);

		const self = workerSelf(workerTransport, {
			expose: () => ({ data: node([], { initial: { x: 1 } }) }),
		});
		bridges.push(self);

		await tick(50);
		expect(bridge.data.cache).toEqual({ x: 1 });
	});

	it("handles expose-only bridge (no import)", async () => {
		const [mainTransport, workerTransport] = transportPair();

		const mainNode = node([], { initial: "shared" });
		const bridge = workerBridge(mainTransport, {
			expose: { shared: mainNode },
		});
		bridges.push(bridge);

		let workerProxy: { cache: unknown } | undefined;
		const self = workerSelf(workerTransport, {
			import: ["shared"] as const,
			expose: (imported) => {
				workerProxy = imported.shared;
				return {};
			},
		});
		bridges.push(self);

		await tick(50);
		// Worker proxy receives the initial value via the init message
		expect(workerProxy!.cache).toBe("shared");
	});

	it("double destroy is idempotent", async () => {
		const [mainTransport, workerTransport] = transportPair();

		const bridge = workerBridge(mainTransport, {
			import: ["v"] as const,
		});

		const self = workerSelf(workerTransport, {
			expose: () => ({ v: node([], { initial: 1 }) }),
		});

		await tick(50);

		// Should not throw
		bridge.destroy();
		bridge.destroy();
		self.destroy();
		self.destroy();
	});

	it("forwards RESOLVED from worker to main proxy", async () => {
		const [mainTransport, workerTransport] = transportPair();

		let workerNode: { down(m: Messages): void } | undefined;
		const bridge = workerBridge(mainTransport, {
			import: ["src"] as const,
		});
		bridges.push(bridge);

		const self = workerSelf(workerTransport, {
			expose: () => {
				const s = node([], { name: "src", initial: 0 });
				workerNode = s;
				return { src: s };
			},
		});
		bridges.push(self);

		await tick(50);

		const { batches, unsub } = collect(bridge.src);

		workerNode!.down([[RESOLVED]]);
		await tick(50);

		const hasResolved = batches.some((b) => b.some((m) => (m as any)[0] === RESOLVED));
		expect(hasResolved).toBe(true);
		unsub();
	});

	it("forwards custom Symbol.for message types across wire", async () => {
		const [mainTransport, workerTransport] = transportPair();
		const CUSTOM = Symbol.for("custom/TEST_SIGNAL");

		let workerNode: { down(m: Messages): void } | undefined;
		const bridge = workerBridge(mainTransport, {
			import: ["src"] as const,
		});
		bridges.push(bridge);

		const self = workerSelf(workerTransport, {
			expose: () => {
				const s = node([], { name: "src", initial: 0 });
				workerNode = s;
				return { src: s };
			},
		});
		bridges.push(self);

		await tick(50);

		const { batches, unsub } = collect(bridge.src);

		workerNode!.down([[CUSTOM, "payload"]]);
		await tick(50);

		const customMsg = batches.flat().find((m) => (m as any)[0] === CUSTOM) as any;
		expect(customMsg).toBeDefined();
		expect(customMsg[1]).toBe("payload");
		unsub();
	});

	it("forwards structured payloads for custom Symbol.for types", async () => {
		const [mainTransport, workerTransport] = transportPair();
		const CUSTOM = Symbol.for("custom/OBJECT_SIGNAL");
		const payload = { nested: { ok: true }, values: [1, 2, 3] };

		let workerNode: { down(m: Messages): void } | undefined;
		const bridge = workerBridge(mainTransport, {
			import: ["src"] as const,
		});
		bridges.push(bridge);

		const self = workerSelf(workerTransport, {
			expose: () => {
				const s = node([], { name: "src", initial: 0 });
				workerNode = s;
				return { src: s };
			},
		});
		bridges.push(self);

		await tick(50);

		const { batches, unsub } = collect(bridge.src);
		workerNode!.down([[CUSTOM, payload]]);
		await tick(50);

		const customMsg = batches.flat().find((m) => (m as any)[0] === CUSTOM) as any;
		expect(customMsg).toBeDefined();
		expect(customMsg[1]).toEqual(payload);
		unsub();
	});

	it("does NOT forward DIRTY across wire (tier 0 stays local)", async () => {
		const [mainTransport, workerTransport] = transportPair();

		let workerNode: { down(m: Messages): void } | undefined;
		const bridge = workerBridge(mainTransport, {
			import: ["src"] as const,
		});
		bridges.push(bridge);

		const self = workerSelf(workerTransport, {
			expose: () => {
				const s = node([], { name: "src", initial: 0 });
				workerNode = s;
				return { src: s };
			},
		});
		bridges.push(self);

		await tick(50);

		const { batches, unsub } = collect(bridge.src);

		workerNode!.down([[DIRTY]]);
		await tick(50);

		const hasDirty = batches.some((b) => b.some((m) => (m as any)[0] === DIRTY));
		expect(hasDirty).toBe(false);
		unsub();
	});

	it("handshake timeout triggers error and closes bridge", async () => {
		const [mainTransport, _workerTransport] = transportPair();

		// No workerSelf — simulate worker never responding
		const bridge = workerBridge(mainTransport, {
			import: ["val"] as const,
			timeoutMs: 100,
		});
		bridges.push(bridge);

		expect(bridge.meta.status.cache).toBe("connecting");

		await tick(150);

		expect(bridge.meta.status.cache).toBe("closed");
		expect(bridge.meta.error.cache).toBeInstanceOf(Error);
		expect((bridge.meta.error.cache as Error)!.message).toContain("timeout");
	});
});
