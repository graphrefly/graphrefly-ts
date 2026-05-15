import { DATA } from "@graphrefly/pure-ts/core";
import { node } from "@graphrefly/pure-ts/core";
import { describe, expect, it } from "vitest";
import { effectScope, isReadonly, isRef, nextTick, ref } from "vue";
import { useStore, useSubscribe, useSubscribeRecord } from "../../compat/vue/index.js";

describe("Vue bindings", () => {
	it("useSubscribe returns a readonly ref synced with node", async () => {
		const testNode = node({ initial: "hello" });
		let r: any;

		const scope = effectScope();
		scope.run(() => {
			r = useSubscribe(testNode);
		});

		expect(isRef(r)).toBe(true);
		expect(isReadonly(r)).toBe(true);
		expect(r.value).toBe("hello");

		testNode.down([[DATA, "world"]]);
		expect(r.value).toBe("world");

		scope.stop(); // unsubscribes
		testNode.down([[DATA, "ignored"]]);
		expect(r.value).toBe("world"); // subscription was torn down
	});

	it("useStore returns a writable ref", () => {
		const testNode = node({ initial: 10 });
		let r: any;

		const scope = effectScope();
		scope.run(() => {
			r = useStore(testNode);
		});

		expect(isRef(r)).toBe(true);
		expect(isReadonly(r)).toBe(false);

		// test write
		r.value = 42;
		expect(testNode.cache).toBe(42);

		// test read
		testNode.down([[DATA, 50]]);
		expect(r.value).toBe(50);
		scope.stop();
	});

	it("useSubscribeRecord creates reactive sync of dynamic records", async () => {
		const a = node({ initial: 1 });
		const b = node({ initial: 2 });
		const keysRef = ref(["a"]);

		const factory = (key: string) => ({ item: key === "a" ? a : b });

		let r: any;
		const scope = effectScope();
		scope.run(() => {
			r = useSubscribeRecord(keysRef, factory);
		});

		expect(r.value).toEqual({ a: { item: 1 } });

		// update child node
		a.down([[DATA, 100]]);
		await nextTick(); // useSubscribeRecord queues batch update
		expect(r.value).toEqual({ a: { item: 100 } });

		// push new key
		keysRef.value = ["a", "b"];
		await nextTick();
		expect(r.value).toEqual({ a: { item: 100 }, b: { item: 2 } });

		// verify b updates
		b.down([[DATA, 200]]);
		await nextTick();
		expect(r.value).toEqual({ a: { item: 100 }, b: { item: 200 } });

		scope.stop();
	});
});
