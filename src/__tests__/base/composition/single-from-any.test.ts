import { COMPLETE, node, TEARDOWN } from "@graphrefly/pure-ts/core";
import { describe, expect, it } from "vitest";
import { singleFromAny, singleNodeFromAny } from "../../../base/composition/single-from-any.js";

describe("singleFromAny", () => {
	it("dedupes concurrent calls with the same key", async () => {
		let calls = 0;
		const fn = singleFromAny<string, string>(async (k) => {
			calls += 1;
			await new Promise((r) => setTimeout(r, 10));
			return `v:${k}`;
		});
		const [a, b, c] = await Promise.all([fn("x"), fn("x"), fn("x")]);
		expect(a).toBe("v:x");
		expect(b).toBe("v:x");
		expect(c).toBe("v:x");
		expect(calls).toBe(1);
	});

	it("different keys invoke factory separately", async () => {
		let calls = 0;
		const fn = singleFromAny<string, string>(async (k) => {
			calls += 1;
			return k;
		});
		await Promise.all([fn("a"), fn("b"), fn("a")]);
		// "a" dedupes, "b" is separate.
		expect(calls).toBeLessThanOrEqual(2);
	});

	it("clears cache on settle so next call reinvokes", async () => {
		let calls = 0;
		const fn = singleFromAny<string, string>(async (k) => {
			calls += 1;
			return k;
		});
		await fn("k");
		await fn("k");
		expect(calls).toBe(2);
	});

	it("handles sync factory return", async () => {
		const fn = singleFromAny<string, number>((k) => Number(k) * 2);
		expect(await fn("5")).toBe(10);
	});

	it("propagates rejection to all concurrent callers", async () => {
		const err = new Error("boom");
		const fn = singleFromAny<string, string>(async () => {
			throw err;
		});
		await Promise.all([expect(fn("x")).rejects.toBe(err), expect(fn("x")).rejects.toBe(err)]);
	});

	it("custom keyFn stringifies object keys", async () => {
		let calls = 0;
		const fn = singleFromAny<{ id: number }, string>(
			async (k) => {
				calls += 1;
				return `id:${k.id}`;
			},
			{ keyFn: (k) => String(k.id) },
		);
		await Promise.all([fn({ id: 1 }), fn({ id: 1 })]);
		expect(calls).toBe(1);
	});
});

describe("singleNodeFromAny", () => {
	it("returns same Node for concurrent calls with same key", () => {
		const fn = singleNodeFromAny<string, string>(async (k) => k);
		const n1 = fn("x");
		const n2 = fn("x");
		expect(n1).toBe(n2);
	});

	it("different keys produce different Nodes", () => {
		const fn = singleNodeFromAny<string, string>(async (k) => k);
		expect(fn("a")).not.toBe(fn("b"));
	});

	it("evicts on TEARDOWN so a DATA-only source releases (M8)", () => {
		let calls = 0;
		// DATA-only `state(...)` source: emits DATA on subscribe, never
		// ERROR/COMPLETE. Pre-M8 the cache entry + watcher subscription
		// outlived the node's teardown forever.
		const fn = singleNodeFromAny<string, number>((k) => {
			calls += 1;
			return node<number>([], { initial: Number(k), name: `state_${k}` });
		});
		const n1 = fn("1");
		expect(calls).toBe(1);
		// Still alive → shared (no terminal, no teardown yet).
		expect(fn("1")).toBe(n1);
		expect(calls).toBe(1);
		// Tear the shared node down. A DATA-only source never emits
		// ERROR/COMPLETE, so TEARDOWN is the only release signal.
		n1.down([[TEARDOWN]]);
		// Entry evicted → next call re-invokes the factory with a fresh Node.
		const n2 = fn("1");
		expect(n2).not.toBe(n1);
		expect(calls).toBe(2);
	});

	it("still evicts on terminal COMPLETE (regression guard for M8)", () => {
		let calls = 0;
		const fn = singleNodeFromAny<string, number>((k) => {
			calls += 1;
			return node<number>([], { initial: Number(k), name: `state_${k}` });
		});
		const n1 = fn("7");
		expect(calls).toBe(1);
		n1.down([[COMPLETE]]);
		expect(fn("7")).not.toBe(n1);
		expect(calls).toBe(2);
	});
});
