import { describe, expect, it } from "vitest";
import { TEARDOWN } from "../../core/messages.js";
import { type CacheTier, cascadingCache, lru, tieredStorage } from "../../extra/cascading-cache.js";
import { MemoryCheckpointAdapter } from "../../extra/checkpoint.js";

describe("lru eviction policy", () => {
	it("evicts least-recently-used entries", () => {
		const policy = lru<string>();
		policy.insert("a");
		policy.insert("b");
		policy.insert("c");
		expect(policy.size()).toBe(3);
		// LRU order: c (head) → b → a (tail)
		const evicted = policy.evict(1);
		expect(evicted).toEqual(["a"]);
		expect(policy.size()).toBe(2);
	});

	it("touch moves entry to front", () => {
		const policy = lru<string>();
		policy.insert("a");
		policy.insert("b");
		policy.insert("c");
		policy.touch("a"); // a moves to front
		// Order: a → c → b (tail)
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
		policy.insert("a"); // re-insert touches
		const evicted = policy.evict(1);
		expect(evicted).toEqual(["b"]); // b is now LRU
	});
});

describe("cascadingCache", () => {
	function memTier<V>(): CacheTier<V> & { store: Map<string, V> } {
		const store = new Map<string, V>();
		return {
			store,
			load: (key) => store.get(key),
			save: (key, value) => store.set(key, value),
			clear: (key) => store.delete(key),
		};
	}

	it("creates a state node per key and cascades on miss", () => {
		const hot = memTier<number>();
		const cold = memTier<number>();
		cold.store.set("x", 42);

		const c = cascadingCache([hot, cold]);
		const nd = c.load("x");
		expect(nd.cache).toBe(42);
		// Auto-promoted to hot tier
		expect(hot.store.get("x")).toBe(42);
	});

	it("returns same node for repeated loads", () => {
		const tier = memTier<number>();
		tier.store.set("k", 1);
		const c = cascadingCache([tier]);
		const n1 = c.load("k");
		const n2 = c.load("k");
		expect(n1).toBe(n2);
	});

	it("save updates existing node in-place", () => {
		const tier = memTier<string>();
		const c = cascadingCache([tier]);
		const nd = c.load("k"); // undefined
		expect(nd.cache).toBeUndefined();
		c.save("k", "hello");
		expect(nd.cache).toBe("hello");
		expect(tier.store.get("k")).toBe("hello");
	});

	it("save creates new node if key not yet loaded", () => {
		const tier = memTier<number>();
		const c = cascadingCache([tier]);
		c.save("new", 99);
		expect(c.has("new")).toBe(true);
		expect(c.load("new").cache).toBe(99);
	});

	it("writeThrough saves to all tiers", () => {
		const hot = memTier<number>();
		const cold = memTier<number>();
		const c = cascadingCache([hot, cold], { writeThrough: true });
		c.save("k", 7);
		expect(hot.store.get("k")).toBe(7);
		expect(cold.store.get("k")).toBe(7);
	});

	it("default save writes to first tier only", () => {
		const hot = memTier<number>();
		const cold = memTier<number>();
		const c = cascadingCache([hot, cold]); // writeThrough defaults false
		c.save("k", 7);
		expect(hot.store.get("k")).toBe(7);
		expect(cold.store.has("k")).toBe(false);
	});

	it("invalidate re-cascades from tiers", () => {
		const hot = memTier<number>();
		const cold = memTier<number>();
		cold.store.set("k", 10);
		const c = cascadingCache([hot, cold]);
		const nd = c.load("k");
		expect(nd.cache).toBe(10);

		// Change cold tier value
		cold.store.set("k", 20);
		hot.store.delete("k"); // clear hot cache
		c.invalidate("k");
		expect(nd.cache).toBe(20);
		// Re-promoted to hot
		expect(hot.store.get("k")).toBe(20);
	});

	it("delete removes from all tiers and teardowns node", () => {
		const tier = memTier<number>();
		tier.store.set("k", 5);
		const c = cascadingCache([tier]);
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
		const c = cascadingCache([tier]);
		expect(c.size).toBe(0);
		expect(c.has("a")).toBe(false);
		c.load("a");
		expect(c.has("a")).toBe(true);
		expect(c.size).toBe(1);
	});

	it("evicts when maxSize exceeded", () => {
		const tier = memTier<number>();
		const c = cascadingCache([tier], { maxSize: 2 });
		c.save("a", 1);
		c.save("b", 2);
		c.save("c", 3); // should evict "a" (LRU)
		expect(c.has("a")).toBe(false);
		expect(c.has("b")).toBe(true);
		expect(c.has("c")).toBe(true);
		expect(c.size).toBe(2);
	});

	it("eviction demotes to deepest tier with save", () => {
		const hot = memTier<number>();
		const cold = memTier<number>();
		const c = cascadingCache([hot, cold], { maxSize: 1 });
		c.save("a", 10);
		c.save("b", 20); // evicts "a", demotes to cold
		expect(cold.store.get("a")).toBe(10);
	});

	it("skips tiers that throw on load", () => {
		const broken: CacheTier<number> = {
			load() {
				throw new Error("boom");
			},
		};
		const good = memTier<number>();
		good.store.set("k", 42);
		const c = cascadingCache([broken, good]);
		expect(c.load("k").cache).toBe(42);
	});

	it("all tiers miss → value stays undefined", () => {
		const empty = memTier<number>();
		const c = cascadingCache([empty]);
		expect(c.load("missing").cache).toBeUndefined();
	});
});

describe("tieredStorage", () => {
	it("wraps CheckpointAdapters as cascadingCache", () => {
		const mem = new MemoryCheckpointAdapter();
		mem.save("k", { value: 42 });

		const ts = tieredStorage([mem]);
		const nd = ts.load("k");
		expect(nd.cache).toEqual({ value: 42 });
	});

	it("save/load/invalidate/delete/has/size work", () => {
		const mem = new MemoryCheckpointAdapter();
		const ts = tieredStorage([mem]);
		ts.save("x", "hello");
		expect(ts.has("x")).toBe(true);
		expect(ts.size).toBe(1);
		expect(ts.load("x").cache).toBe("hello");

		ts.invalidate("x");
		expect(ts.load("x").cache).toBe("hello"); // re-cascaded from adapter

		ts.delete("x");
		expect(ts.has("x")).toBe(false);
	});

	it("exposes inner cache", () => {
		const ts = tieredStorage([new MemoryCheckpointAdapter()]);
		expect(ts.cache).toBeDefined();
	});
});
