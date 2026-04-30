import { describe, expect, it, vi } from "vitest";
import { create } from "../../compat/zustand/index.js";
import { DATA } from "../../core/messages.js";
import { node } from "../../core/node.js";

describe("zustand compat", () => {
	it("create: initializes with state from initializer", () => {
		const store = create(() => ({ count: 0 }));
		expect(store.getState()).toEqual({ count: 0 });
	});

	it("setState: partial update merges by default", () => {
		const store = create(() => ({ count: 0, tag: "init" }));
		store.setState({ count: 1 });
		expect(store.getState()).toEqual({ count: 1, tag: "init" });
	});

	it("setState: replacement when replace: true", () => {
		const store = create<any>(() => ({ count: 0, tag: "init" }));
		store.setState({ count: 1 }, true);
		expect(store.getState()).toEqual({ count: 1 });
	});

	it("setState: functional update receives current state", () => {
		const store = create(() => ({ count: 10 }));
		store.setState((s) => ({ count: s.count + 5 }));
		expect(store.getState()).toEqual({ count: 15 });
	});

	it("subscribe: listener receives (state, prevState)", () => {
		const store = create(() => ({ count: 0 }));
		const listener = vi.fn();
		const unsub = store.subscribe(listener);

		store.setState({ count: 1 });
		expect(listener).toHaveBeenCalledWith({ count: 1 }, { count: 0 });

		store.setState({ count: 2 });
		expect(listener).toHaveBeenCalledWith({ count: 2 }, { count: 1 });

		unsub();
		store.setState({ count: 3 });
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("actions inside state can call set/get", () => {
		const store = create<any>((set, get) => ({
			count: 0,
			inc: () => set({ count: get().count + 1 }),
		}));

		store.getState().inc();
		expect(store.getState().count).toBe(1);
		store.getState().inc();
		expect(store.getState().count).toBe(2);
	});

	it("behave as a Graph: access nodes and features", () => {
		const store = create(() => ({ value: "init" }));
		// Graph name is "zustand" internally by default
		expect(store.name).toBe("zustand");
		// Local node name is "state"
		expect(store.node("state").cache).toEqual({ value: "init" });

		store.set("state", { value: "changed" });
		expect(store.getState()).toEqual({ value: "changed" });
	});

	it("getInitialState returns the starting value", () => {
		const initial = { count: 0 };
		const store = create(() => initial);
		expect(store.getInitialState()).toBe(initial);
	});

	it("destroy: tears down the graph", () => {
		const store = create(() => ({ count: 0 }));
		const stateNode = store.node("state");
		store.destroy();
		expect(stateNode.status).toBe("sentinel");
	});

	it("two-way bridge: native diamond over store.node('state') resolves without glitches", () => {
		// Regression: zustand's setState used to bypass the framed emit
		// pipeline (`n.down([[DATA, v]])` instead of `n.emit(v)`), which
		// meant no auto-prefixed `[DIRTY]`. Diamond legs built from the
		// state node wouldn't coordinate and a downstream computed fired
		// with glitch values mid-wave.
		const store = create(() => ({ x: 1 }));
		const state = store.node("state") as ReturnType<typeof store.node> & {
			subscribe: (s: unknown) => () => void;
		};

		// Left leg: x * 10. Right leg: x + 100. Diamond: left + right.
		const left = node(
			[state],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as { x: number }).x * 10);
			},
			{ describeKind: "derived" },
		);
		const right = node(
			[state],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as { x: number }).x + 100);
			},
			{ describeKind: "derived" },
		);
		const final = node(
			[left, right],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) + (data[1] as number));
			},
			{ describeKind: "derived" },
		);

		const seen: number[] = [];
		const unsub = final.subscribe((msgs) => {
			for (const [t, v] of msgs) {
				if (t === DATA) seen.push(v as number);
			}
		});

		// Push-on-subscribe replay of the initial wave.
		expect(final.cache).toBe(111); // (1 * 10) + (1 + 100) = 10 + 101
		expect(seen).toEqual([111]);

		// Setting x=5 via zustand's setState must collapse the diamond
		// to exactly one fire with the final resolved value 155 — not a
		// glitchy intermediate like 151 (new left 50 + stale right 101)
		// or 110 (stale left 10 + new right 105).
		store.setState({ x: 5 });
		expect(final.cache).toBe(155); // 50 + 105
		expect(seen).toEqual([111, 155]);

		store.setState({ x: 10 });
		expect(final.cache).toBe(210); // 100 + 110
		expect(seen).toEqual([111, 155, 210]);

		unsub();
	});
});
