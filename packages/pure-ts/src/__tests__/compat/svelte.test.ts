import { describe, expect, it } from "vitest";
import { useStore, useSubscribe, useSubscribeRecord } from "../../compat/svelte/index.js";
import { DATA } from "../../core/messages.js";
import { node } from "../../core/node.js";

describe("Svelte bindings", () => {
	it("useSubscribe reads value and updates", () => {
		const testNode = node({ initial: "hello" });
		const store = useSubscribe(testNode);
		let val: any;

		const unsub = store.subscribe((v) => {
			val = v;
		});

		expect(val).toBe("hello");

		testNode.down([[DATA, "world"]]);
		expect(val).toBe("world");

		unsub();
		testNode.down([[DATA, "ignored"]]);
		expect(val).toBe("world");
	});

	it("useStore acts as a writable store", () => {
		const testNode = node({ initial: 10 });
		const store = useStore(testNode);

		let val: any;
		const unsub = store.subscribe((v) => {
			val = v;
		});

		expect(val).toBe(10);

		// Test setter
		store.set(42);
		expect(val).toBe(42);
		expect(testNode.cache).toBe(42);

		// Test updater
		store.update((n) => (n as number) + 1);
		expect(val).toBe(43);
		expect(testNode.cache).toBe(43);

		unsub();
	});

	it("useSubscribeRecord syncs dynamic values", () => {
		const a = node({ initial: 1 });
		const b = node({ initial: 2 });
		const keysNode = node<string[]>({ initial: ["a"] });

		const factory = (key: string) => ({ item: key === "a" ? a : b });
		const store = useSubscribeRecord(keysNode, factory);

		let val: any;
		const unsub = store.subscribe((v) => {
			val = v;
		});

		expect(val).toEqual({ a: { item: 1 } });

		a.down([[DATA, 10]]);
		expect(val).toEqual({ a: { item: 10 } });

		keysNode.down([[DATA, ["a", "b"]]]);
		expect(val).toEqual({ a: { item: 10 }, b: { item: 2 } });

		b.down([[DATA, 20]]);
		expect(val).toEqual({ a: { item: 10 }, b: { item: 20 } });

		unsub();
	});
});
