import { describe, expect, it, vi } from "vitest";
import { DATA } from "../../core/messages.js";
import { state } from "../../core/sugar.js";
import { keepalive } from "../../extra/sources.js";
import { decay } from "../../extra/utils/decay.js";
import {
	type CollectionEntry,
	collection,
	type HnswAdapter,
	type KnowledgeEdge,
	knowledgeGraph,
	type RankedCollectionEntry,
	type VectorIndexAuditRecord,
	type VectorSearchResult,
	vectorIndex,
} from "../../patterns/memory/index.js";

describe("patterns.memory.decay", () => {
	it("decays score with floor", () => {
		const score = decay(10, 10, 0.5, 2);
		expect(score).toBeGreaterThanOrEqual(2);
		expect(score).toBeLessThan(10);
	});

	it("non-positive rate disables decay (returns max(min, base))", () => {
		expect(decay(7, 100, 0)).toBe(7);
		expect(decay(7, 100, -1)).toBe(7);
		expect(decay(7, 100, 0, 9)).toBe(9);
	});

	it("non-finite baseScore collapses to minScore", () => {
		expect(decay(Number.POSITIVE_INFINITY, 1, 1, 0)).toBe(0);
		expect(decay(Number.NaN, 1, 1, 0)).toBe(0);
	});
});

describe("patterns.memory.collection({ ranked: false }) — Tier 2.3 lightCollection fold", () => {
	it("evicts least recently used entry under default LRU", () => {
		const c = collection<number>("c", { maxSize: 2, ranked: false });
		c.upsert("a", 1);
		c.upsert("b", 2);
		// `b` is the most recent; upserting `c` evicts `a` (oldest by lastAccessNs).
		c.upsert("c", 3);
		const snap = c.items.cache as ReadonlyMap<string, CollectionEntry<number>>;
		expect(snap.has("a")).toBe(false);
		expect(snap.has("b")).toBe(true);
		expect(snap.has("c")).toBe(true);
	});

	it("re-upsert preserves createdAtNs but bumps lastAccessNs", () => {
		const c = collection<number>("c", { maxSize: 4, ranked: false });
		c.upsert("a", 1);
		const first = (c.items.cache as ReadonlyMap<string, CollectionEntry<number>>).get("a")!;
		c.upsert("a", 99);
		const second = (c.items.cache as ReadonlyMap<string, CollectionEntry<number>>).get("a")!;
		expect(second.value).toBe(99);
		expect(second.createdAtNs).toBe(first.createdAtNs);
		expect(second.lastAccessNs).toBeGreaterThanOrEqual(first.lastAccessNs);
	});

	it("remove and clear short-circuit on no-op", () => {
		const c = collection<number>("c", { ranked: false });
		const seen: number[] = [];
		c.items.subscribe((msgs) => {
			for (const m of msgs)
				if (m[0] === DATA) seen.push((m[1] as ReadonlyMap<string, unknown>).size);
		});
		// Initial subscribe pushes the empty map snapshot.
		const initialEmits = seen.length;
		c.remove("nope");
		c.clear();
		expect(seen.length).toBe(initialEmits);
		c.upsert("a", 1);
		expect(seen.at(-1)).toBe(1);
		c.remove("a");
		expect(seen.at(-1)).toBe(0);
	});

	it("itemNode reactively reflects upsert / remove", () => {
		const c = collection<number>("c", { ranked: false });
		const idNode = state("a");
		const itemN = c.itemNode(idNode);
		const seen: Array<CollectionEntry<number> | undefined> = [];
		itemN.subscribe((msgs) => {
			for (const m of msgs)
				if (m[0] === DATA) seen.push(m[1] as CollectionEntry<number> | undefined);
		});
		c.upsert("a", 1);
		c.upsert("b", 2);
		c.upsert("a", 3);
		c.remove("a");
		const values = seen.map((e) => e?.value);
		expect(values).toContain(1);
		expect(values).toContain(3);
		expect(values.at(-1)).toBeUndefined();
	});

	it("hasNode reactively reflects upsert / remove", () => {
		const c = collection<number>("c", { ranked: false });
		const idNode = state("a");
		const hasN = c.hasNode(idNode);
		const seen: boolean[] = [];
		hasN.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) seen.push(m[1] as boolean);
		});
		c.upsert("a", 1);
		c.remove("a");
		expect(seen).toContain(true);
		expect(seen.at(-1)).toBe(false);
	});

	it("events log records upsert / remove / clear", () => {
		const c = collection<number>("demo", { ranked: false });
		c.events.entries.subscribe(() => undefined);
		c.upsert("a", 1);
		c.remove("a");
		c.clear();
		const records = c.events.entries.cache!;
		expect(records.length).toBe(3);
		expect(records[0]?.action).toBe("upsert");
		expect(records[0]?.id).toBe("a");
		expect(records[1]?.action).toBe("remove");
		expect(records[2]?.action).toBe("clear");
	});
});

describe("patterns.memory.collection", () => {
	it("ranked is lazy: undefined until subscribed", () => {
		const g = collection<number>("mem", { score: (v) => v });
		g.upsert("x", 1);
		expect(g.get("ranked")).toBeUndefined();
		g.addDisposer(keepalive(g.ranked));
		expect(Array.isArray(g.get("ranked"))).toBe(true);
	});

	it("size keepalive stays warm without external subscriber", () => {
		const g = collection<number>("mem", { maxSize: 2, score: (v) => v });
		g.upsert("x", 1);
		g.upsert("y", 5);
		g.upsert("z", 3);
		expect(g.get("size")).toBe(2);
	});

	it("ranks by descending score with maxSize eviction", () => {
		const g = collection<number>("mem", { maxSize: 2, score: (v) => v });
		g.addDisposer(keepalive(g.ranked));
		g.upsert("x", 1);
		g.upsert("y", 5);
		g.upsert("z", 3);
		const ranked = g.ranked.cache as readonly RankedCollectionEntry<number>[];
		expect(ranked.length).toBe(2);
		// Lowest score (`x:1`) evicted; remaining sorted by score desc.
		expect(ranked.map((r) => r.id)).toEqual(["y", "z"]);
		expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
	});

	it("itemNode reactively returns the entry by id", () => {
		const g = collection<number>("mem", { score: (v) => v });
		const idN = state("a");
		const itemN = g.itemNode(idN);
		itemN.subscribe(() => undefined);
		g.upsert("a", 4);
		const entry = itemN.cache as CollectionEntry<number> | undefined;
		expect(entry?.value).toBe(4);
		expect(entry?.baseScore).toBe(4);
	});

	it("rescore re-applies the latest score fn to existing entries", () => {
		const scoreFnNode = state<(v: number) => number>((v) => v);
		const g = collection<number>("mem", { score: scoreFnNode });
		g.addDisposer(keepalive(g.ranked));
		g.upsert("a", 2);
		g.upsert("b", 5);
		// Initial baseScores are 2 and 5; ranked has b first.
		const before = g.ranked.cache as readonly RankedCollectionEntry<number>[];
		expect(before.map((r) => r.id)).toEqual(["b", "a"]);
		// Flip to a different scorer that inverts the ranking but stays
		// above `minScore: 0` so decay's floor doesn't collapse both to 0
		// (smaller raw value = higher new score).
		scoreFnNode.emit((v) => 100 - v);
		// `ranked` re-derives because scoreFnNode is a dep, but baseScore on
		// entries is still 2 / 5 → ranking unchanged until rescore.
		const stillBefore = g.ranked.cache as readonly RankedCollectionEntry<number>[];
		expect(stillBefore.map((r) => r.id)).toEqual(["b", "a"]);
		g.rescore();
		const after = g.ranked.cache as readonly RankedCollectionEntry<number>[];
		expect(after.map((r) => r.id)).toEqual(["a", "b"]);
		expect(after.find((r) => r.id === "a")?.baseScore).toBe(98);
		expect(after.find((r) => r.id === "b")?.baseScore).toBe(95);
	});

	it("events log records upsert / remove / clear / rescore with seq cursor", () => {
		const g = collection<number>("mem", { score: (v) => v });
		g.events.entries.subscribe(() => undefined);
		g.upsert("a", 1);
		g.upsert("b", 2);
		g.remove("a");
		g.rescore();
		g.clear();
		const records = g.events.entries.cache!;
		expect(records.map((r) => r.action)).toEqual([
			"upsert",
			"upsert",
			"remove",
			"rescore",
			"clear",
		]);
		// seq is monotonic
		const seqs = records.map((r) => r.seq).filter((s): s is number => s != null);
		for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
	});

	it("decay-driven ranked re-derives on the refresh tick (without upsert)", async () => {
		vi.useFakeTimers();
		try {
			const g = collection<number>("mem", {
				score: (v) => v,
				decayRate: 1,
				refreshIntervalMs: 50,
			});
			g.addDisposer(keepalive(g.ranked));
			g.upsert("a", 100);
			const initialScore = (g.ranked.cache as readonly RankedCollectionEntry<number>[])[0]!.score;
			// Advance well past one refresh interval — a tick should fire and
			// `ranked` re-derives with a smaller decayed score even though no
			// upsert occurred.
			await vi.advanceTimersByTimeAsync(2_000);
			const laterScore = (g.ranked.cache as readonly RankedCollectionEntry<number>[])[0]!.score;
			expect(laterScore).toBeLessThan(initialScore);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("patterns.memory.vectorIndex", () => {
	it("searchNode reactively returns top-K cosine matches", () => {
		const idx = vectorIndex<{ label: string }>({
			backend: "flat",
			dimension: 2,
		});
		idx.upsert("a", [1, 0], { label: "x-axis" });
		idx.upsert("b", [0, 1], { label: "y-axis" });
		const query = state<readonly number[]>([0.9, 0.1]);
		const results = idx.searchNode(query, 1);
		results.subscribe(() => undefined);
		const out = results.cache as readonly VectorSearchResult<{ label: string }>[];
		expect(out[0]?.id).toBe("a");
		expect(out[0]?.meta?.label).toBe("x-axis");
	});

	it("searchNode re-derives when entries change", () => {
		const idx = vectorIndex<{ label: string }>({ backend: "flat", dimension: 2 });
		const query = state<readonly number[]>([1, 0]);
		const results = idx.searchNode(query, 5);
		results.subscribe(() => undefined);
		idx.upsert("a", [1, 0], { label: "x" });
		expect((results.cache as readonly VectorSearchResult<{ label: string }>[]).length).toBe(1);
		idx.upsert("b", [0.5, 0.5], { label: "diag" });
		expect((results.cache as readonly VectorSearchResult<{ label: string }>[]).length).toBe(2);
	});

	it("requires optional hnsw adapter when backend is hnsw", () => {
		expect(() => vectorIndex({ backend: "hnsw" })).toThrow(/optional dependency adapter/i);
	});

	it("strictDimension default throws on mixed-length upserts", () => {
		const idx = vectorIndex<{ label: string }>({ backend: "flat" });
		idx.upsert("a", [1, 0], { label: "two" });
		expect(() => idx.upsert("b", [1, 0, 0], { label: "three" })).toThrow(/dimension/i);
	});

	it("strictDimension: false opts into zero-pad search behavior", () => {
		const idx = vectorIndex<{ label: string }>({
			backend: "flat",
			strictDimension: false,
		});
		idx.upsert("long", [1, 0, 0, 1], { label: "four" });
		const query = state<readonly number[]>([1, 0]);
		const results = idx.searchNode(query, 1);
		results.subscribe(() => undefined);
		const out = results.cache as readonly VectorSearchResult<{ label: string }>[];
		expect(out[0]?.score).toBeCloseTo(1 / Math.SQRT2, 5);
	});

	it("maxSize retention evicts oldest upsert and notifies HNSW adapter", () => {
		const removed: string[] = [];
		const adapter: HnswAdapter<{ label: string }> = {
			upsert: vi.fn(),
			remove: (id) => removed.push(id),
			clear: vi.fn(),
			search: vi.fn(),
		};
		const idx = vectorIndex<{ label: string }>({
			backend: "hnsw",
			dimension: 2,
			maxSize: 2,
			hnswFactory: () => adapter,
		});
		idx.upsert("a", [1, 0], { label: "x" });
		idx.upsert("b", [0, 1], { label: "y" });
		idx.upsert("c", [0.5, 0.5], { label: "z" }); // evicts "a"
		expect(removed).toContain("a");
	});

	it("reindex re-pushes every live entry to the HNSW adapter", () => {
		const upsertSpy = vi.fn();
		const adapter: HnswAdapter<{ label: string }> = {
			upsert: upsertSpy,
			remove: vi.fn(),
			clear: vi.fn(),
			search: vi.fn(),
		};
		const idx = vectorIndex<{ label: string }>({
			backend: "hnsw",
			dimension: 2,
			hnswFactory: () => adapter,
		});
		idx.upsert("a", [1, 0]);
		idx.upsert("b", [0, 1]);
		upsertSpy.mockClear();
		idx.reindex();
		expect(upsertSpy).toHaveBeenCalledTimes(2);
	});

	it("adapter dispose runs on graph teardown", () => {
		const dispose = vi.fn();
		const adapter: HnswAdapter<unknown> = {
			upsert: vi.fn(),
			remove: vi.fn(),
			clear: vi.fn(),
			search: vi.fn(),
			dispose,
		};
		const idx = vectorIndex<unknown>({
			backend: "hnsw",
			dimension: 2,
			hnswFactory: () => adapter,
		});
		idx.destroy();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it("events log records every mutation", () => {
		const idx = vectorIndex<{ label: string }>({ backend: "flat", dimension: 2 });
		idx.events.entries.subscribe(() => undefined);
		idx.upsert("a", [1, 0]);
		idx.remove("a");
		idx.clear();
		const records = idx.events.entries.cache as readonly VectorIndexAuditRecord[];
		expect(records.map((r) => r.action)).toEqual(["upsert", "remove", "clear"]);
	});
});

describe("patterns.memory.knowledgeGraph", () => {
	it("link / unlink update edges by triple key", () => {
		const kg = knowledgeGraph<{ name: string }>("kg");
		kg.upsertEntity("a", { name: "A" });
		kg.upsertEntity("b", { name: "B" });
		kg.link("a", "b", "knows", 1);
		expect(kg.get("edgeCount")).toBe(1);
		kg.link("a", "b", "knows", 5); // replace weight
		expect(kg.get("edgeCount")).toBe(1);
		const edges = kg.edges.cache as ReadonlyMap<string, KnowledgeEdge>;
		const onlyEdge = [...edges.values()][0]!;
		expect(onlyEdge.weight).toBe(5);
		kg.unlink("a", "b", "knows");
		expect(kg.get("edgeCount")).toBe(0);
	});

	it("relatedNode returns inbound and outbound edges (symmetric)", () => {
		const kg = knowledgeGraph<{ name: string }>("kg");
		kg.upsertEntity("a", { name: "A" });
		kg.upsertEntity("b", { name: "B" });
		kg.upsertEntity("c", { name: "C" });
		kg.link("a", "b", "knows");
		kg.link("c", "b", "knows");
		const idN = state("b");
		const related = kg.relatedNode(idN);
		related.subscribe(() => undefined);
		const edges = related.cache as readonly KnowledgeEdge[];
		expect(edges.length).toBe(2);
		const fromIds = edges.map((e) => e.from).sort();
		expect(fromIds).toEqual(["a", "c"]);
	});

	it("relatedNode filters by relation when supplied; switching the relation node re-derives", () => {
		const kg = knowledgeGraph<{ name: string }, "knows" | "owes">("kg");
		kg.link("a", "b", "knows");
		kg.link("a", "b", "owes");
		const idN = state("a");
		const relN = state<"knows" | "owes">("knows");
		const filtered = kg.relatedNode(idN, relN);
		filtered.subscribe(() => undefined);
		expect((filtered.cache as readonly KnowledgeEdge[]).length).toBe(1);
		relN.emit("owes");
		expect((filtered.cache as readonly KnowledgeEdge[]).length).toBe(1);
		expect((filtered.cache as readonly KnowledgeEdge[])[0]?.relation).toBe("owes");
		// Omitting the relation arg disables filtering — separate call site.
		const all = kg.relatedNode(idN);
		all.subscribe(() => undefined);
		expect((all.cache as readonly KnowledgeEdge[]).length).toBe(2);
	});

	it("removeEntity cascades to all involving edges", () => {
		const kg = knowledgeGraph<{ name: string }>("kg");
		kg.upsertEntity("a", { name: "A" });
		kg.upsertEntity("b", { name: "B" });
		kg.upsertEntity("c", { name: "C" });
		kg.link("a", "b", "knows");
		kg.link("c", "a", "knows");
		expect(kg.get("edgeCount")).toBe(2);
		kg.removeEntity("a");
		expect(kg.get("edgeCount")).toBe(0);
		expect(kg.get("entityCount")).toBe(2);
	});

	it("orphanGC: 'remove' deletes entities after their last edge unlinks", () => {
		const kg = knowledgeGraph<{ name: string }>("kg", { orphanGC: "remove" });
		kg.upsertEntity("a", { name: "A" });
		kg.upsertEntity("b", { name: "B" });
		kg.link("a", "b", "knows");
		kg.unlink("a", "b", "knows");
		expect(kg.get("entityCount")).toBe(0);
	});

	it("entityCount and edgeCount keep keepalive without external subscriber", () => {
		const kg = knowledgeGraph<{ name: string }>("kg");
		kg.upsertEntity("a", { name: "A" });
		kg.link("a", "a", "self");
		expect(kg.get("entityCount")).toBe(1);
		expect(kg.get("edgeCount")).toBe(1);
	});

	it("events log records every mutation", () => {
		const kg = knowledgeGraph<{ name: string }>("kg");
		kg.events.entries.subscribe(() => undefined);
		kg.upsertEntity("a", { name: "A" });
		kg.link("a", "a", "self");
		kg.unlink("a", "a", "self");
		kg.removeEntity("a");
		const actions = kg.events.entries.cache!.map((r) => r.action);
		expect(actions).toEqual(["upsertEntity", "link", "unlink", "removeEntity"]);
	});
});
