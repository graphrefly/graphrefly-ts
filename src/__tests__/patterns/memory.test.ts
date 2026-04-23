import { describe, expect, it } from "vitest";
import {
	collection,
	decay,
	knowledgeGraph,
	lightCollection,
	vectorIndex,
} from "../../patterns/memory/index.js";

describe("patterns.memory.lightCollection", () => {
	it("evicts oldest entry under fifo policy", () => {
		const c = lightCollection<number>({ maxSize: 2, policy: "fifo" });
		c.upsert("a", 1);
		c.upsert("b", 2);
		c.upsert("c", 3);
		expect(c.has("a")).toBe(false);
		expect(c.has("b")).toBe(true);
		expect(c.has("c")).toBe(true);
	});

	it("evicts least recently used entry under lru policy", () => {
		const c = lightCollection<number>({ maxSize: 2, policy: "lru" });
		c.upsert("a", 1);
		c.upsert("b", 2);
		expect(c.get("a")).toBe(1); // touch a
		c.upsert("c", 3);
		expect(c.has("a")).toBe(true);
		expect(c.has("b")).toBe(false);
		expect(c.has("c")).toBe(true);
	});
});

describe("patterns.memory.collection", () => {
	it("builds a graph with items/ranked/size nodes", () => {
		const g = collection<number>("mem", { maxSize: 2, score: (v) => v });
		g.upsert("x", 1);
		g.upsert("y", 5);
		g.upsert("z", 3);
		expect(g.get("size")).toBe(2);
		const ranked = g.get("ranked") as Array<{ id: string; score: number }>;
		expect(ranked.length).toBe(2);
		expect(ranked[0]?.score).toBeGreaterThanOrEqual(ranked[1]?.score ?? 0);
	});
});

describe("patterns.memory.vectorIndex", () => {
	it("supports flat cosine search", () => {
		const idx = vectorIndex<{ label: string }>({ backend: "flat", dimension: 2 });
		idx.upsert("a", [1, 0], { label: "x-axis" });
		idx.upsert("b", [0, 1], { label: "y-axis" });
		const out = idx.search([0.9, 0.1], 1);
		expect(out[0]?.id).toBe("a");
		expect(out[0]?.meta?.label).toBe("x-axis");
	});

	it("requires optional hnsw adapter when backend is hnsw", () => {
		expect(() => vectorIndex({ backend: "hnsw" })).toThrow(/optional dependency adapter/i);
	});

	it("flat cosine zero-pads query and rows to max length when dimension is omitted", () => {
		const idx = vectorIndex<{ label: string }>({ backend: "flat" });
		idx.upsert("long", [1, 0, 0, 1], { label: "four" });
		const out = idx.search([1, 0], 1);
		expect(out[0]?.score).toBeCloseTo(1 / Math.SQRT2, 5);
	});
});

describe("patterns.memory.knowledgeGraph", () => {
	it("stores entities and relations", () => {
		const kg = knowledgeGraph<{ name: string }>("kg");
		kg.upsertEntity("reactiveMap", { name: "reactiveMap" });
		kg.upsertEntity("reactiveIndex", { name: "reactiveIndex" });
		kg.link("reactiveMap", "reactiveIndex", "composes");
		const related = kg.related("reactiveMap");
		expect(related.length).toBe(1);
		expect(related[0]?.relation).toBe("composes");
	});
});

describe("patterns.memory.decay", () => {
	it("decays score with floor", () => {
		const score = decay(10, 10, 0.5, 2);
		expect(score).toBeGreaterThanOrEqual(2);
		expect(score).toBeLessThan(10);
	});
});
