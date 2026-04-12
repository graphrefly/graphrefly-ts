import { describe, expect, it, vi } from "vitest";
import { create } from "../../compat/zustand/index.js";

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
		expect(store.get("state")).toEqual({ value: "init" });

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
});
