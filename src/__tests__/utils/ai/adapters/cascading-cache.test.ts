import { TEARDOWN } from "@graphrefly/pure-ts/core/messages.js";
import type { KvStorageTier } from "@graphrefly/pure-ts/extra";
import { cascadingCache, lru } from "@graphrefly/pure-ts/extra";
import { describe, expect, it } from "vitest";

describe("lru eviction policy", () => {
	it("evicts least-recently-used entries", () => {
		const policy = lru<string>();
		policy.insert("a");
		policy.insert("b");
		policy.insert("c");
		expect(policy.size()).toBe(3);
		const evicted = policy.evict(1);
		expect(evicted).toEqual(["a"]);
		expect(policy.size()).toBe(2);
	});

	it("touch moves entry to front", () => {
		const policy = lru<string>();
		policy.insert("a");
		policy.insert("b");
		policy.insert("c");
		policy.touch("a");
		const evicted = policy.evict(1);
		expect(evicted).toEqual(["b"]);
	});

	it("delete removes entry", () => {
		const policy = lru<string>();
		policy.insert("a");
		policy.insert("b");
		policy.delete("a");
		expect(policy.size()).toBe(1);
		expect(policy.evict(1)).toEqual(["b"]);
	});

	it("insert is idempotent (touches existing)", () => {
		const policy = lru<string>();
		policy.insert("a");
		policy.insert("b");
		policy.insert("a");
		const evicted = policy.evict(1);
		expect(evicted).toEqual(["b"]);
	});
});

describe("cascadingCache", () => {
	function memTier<V>(): KvStorageTier & { store: Map<string, V> } {
		const store = new Map<string, V>();
		return {
			name: "test-mem",
			store,
			load: (key) => (store.has(key) ? (store.get(key) as V) : undefined),
			save: (key, value) => {
				store.set(key, value as V);
			},
			delete: (key) => {
				store.delete(key);
			},
		};
	}

	it("creates a state node per key and cascades on miss", () => {
		const hot = memTier<number>();
		const cold = memTier<number>();
		cold.store.set("x", 42);

		const c = cascadingCache<number>([hot, cold]);
		const nd = c.load("x");
		expect(nd.cache).toBe(42);
		expect(hot.store.get("x")).toBe(42);
	});

	it("returns same node for repeated loads", () => {
		const tier = memTier<number>();
		tier.store.set("k", 1);
		const c = cascadingCache<number>([tier]);
		const n1 = c.load("k");
		const n2 = c.load("k");
		expect(n1).toBe(n2);
	});

	it("save updates existing node in-place", () => {
		const tier = memTier<string>();
		const c = cascadingCache<string>([tier]);
		const nd = c.load("k");
		expect(nd.cache).toBeUndefined();
		c.save("k", "hello");
		expect(nd.cache).toBe("hello");
		expect(tier.store.get("k")).toBe("hello");
	});

	it("save creates new node if key not yet loaded", () => {
		const tier = memTier<number>();
		const c = cascadingCache<number>([tier]);
		c.save("new", 99);
		expect(c.has("new")).toBe(true);
		expect(c.load("new").cache).toBe(99);
	});

	it("writeThrough saves to all tiers", () => {
		const hot = memTier<number>();
		const cold = memTier<number>();
		const c = cascadingCache<number>([hot, cold], { writeThrough: true });
		c.save("k", 7);
		expect(hot.store.get("k")).toBe(7);
		expect(cold.store.get("k")).toBe(7);
	});

	it("default save writes to first tier only", () => {
		const hot = memTier<number>();
		const cold = memTier<number>();
		const c = cascadingCache<number>([hot, cold]);
		c.save("k", 7);
		expect(hot.store.get("k")).toBe(7);
		expect(cold.store.has("k")).toBe(false);
	});

	it("invalidate re-cascades from tiers", () => {
		const hot = memTier<number>();
		const cold = memTier<number>();
		cold.store.set("k", 10);
		const c = cascadingCache<number>([hot, cold]);
		const nd = c.load("k");
		expect(nd.cache).toBe(10);

		cold.store.set("k", 20);
		hot.store.delete("k");
		c.invalidate("k");
		expect(nd.cache).toBe(20);
		expect(hot.store.get("k")).toBe(20);
	});

	it("delete removes from all tiers and teardowns node", () => {
		const tier = memTier<number>();
		tier.store.set("k", 5);
		const c = cascadingCache<number>([tier]);
		const nd = c.load("k");

		const msgs: unknown[][] = [];
		nd.subscribe((m) => msgs.push([...m]));

		c.delete("k");
		expect(c.has("k")).toBe(false);
		expect(tier.store.has("k")).toBe(false);
		expect(msgs.some((batch) => batch.some((m: unknown) => (m as [symbol])[0] === TEARDOWN))).toBe(
			true,
		);
	});

	it("has and size", () => {
		const tier = memTier<number>();
		const c = cascadingCache<number>([tier]);
		expect(c.size).toBe(0);
		expect(c.has("a")).toBe(false);
		c.load("a");
		expect(c.has("a")).toBe(true);
		expect(c.size).toBe(1);
	});

	it("evicts when maxSize exceeded", () => {
		const tier = memTier<number>();
		const c = cascadingCache<number>([tier], { maxSize: 2 });
		c.save("a", 1);
		c.save("b", 2);
		c.save("c", 3);
		expect(c.has("a")).toBe(false);
		expect(c.has("b")).toBe(true);
		expect(c.has("c")).toBe(true);
		expect(c.size).toBe(2);
	});

	it("eviction demotes to deepest tier with save", () => {
		const hot = memTier<number>();
		const cold = memTier<number>();
		const c = cascadingCache<number>([hot, cold], { maxSize: 1 });
		c.save("a", 10);
		c.save("b", 20);
		expect(cold.store.get("a")).toBe(10);
	});

	it("skips tiers that throw on load", () => {
		const broken: KvStorageTier = {
			name: "broken",
			load() {
				throw new Error("boom");
			},
			save() {
				/* no-op — tier is effectively read-only for this test */
			},
		};
		const good = memTier<number>();
		good.store.set("k", 42);
		const c = cascadingCache<number>([broken, good]);
		expect(c.load("k").cache).toBe(42);
	});

	it("all tiers miss → value stays undefined", () => {
		const empty = memTier<number>();
		const c = cascadingCache<number>([empty]);
		expect(c.load("missing").cache).toBeUndefined();
	});

	it("async tier load resolves via Promise", async () => {
		const cold: KvStorageTier = {
			name: "cold-async",
			load: async (key) => (key === "k" ? 123 : undefined),
			save: () => {
				/* no-op */
			},
		};
		const c = cascadingCache<number>([cold]);
		const nd = c.load("k");
		expect(nd.cache).toBeUndefined();
		await new Promise((r) => setTimeout(r, 0));
		expect(nd.cache).toBe(123);
	});

	it("async tier promotes to sync hot tier on hit", async () => {
		const hot = memTier<number>();
		const cold: KvStorageTier = {
			name: "cold-async-promote",
			load: async (key) => (key === "k" ? 77 : undefined),
			save: () => {
				/* no-op */
			},
		};
		const c = cascadingCache<number>([hot, cold]);
		const nd = c.load("k");
		await new Promise((r) => setTimeout(r, 0));
		expect(nd.cache).toBe(77);
		expect(hot.store.get("k")).toBe(77);
	});
});
