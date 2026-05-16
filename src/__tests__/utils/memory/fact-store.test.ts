import { DATA, monotonicNs, node } from "@graphrefly/pure-ts/core";
import { keepalive } from "@graphrefly/pure-ts/extra";
import { describe, expect, it } from "vitest";
import {
	type CascadeEvent,
	type CascadeOverflow,
	type FactStore,
	type MemoryAnswer,
	type MemoryFragment,
	type MemoryQuery,
	type OutcomeSignal,
	type ReviewRequest,
	reactiveFactStore,
	type ScoringPolicy,
} from "../../../utils/memory/index.js";

// ── Fixture helpers ──────────────────────────────────────────────────────

function frag<T>(id: string, payload: T, opts: Partial<MemoryFragment<T>> = {}): MemoryFragment<T> {
	return {
		id,
		payload,
		t_ns: BigInt(monotonicNs()),
		confidence: opts.confidence ?? 1,
		tags: opts.tags ?? [],
		sources: opts.sources ?? [],
		...opts,
	};
}

function ingestNode<T>() {
	return node<MemoryFragment<T>>([], { initial: undefined });
}

// ── Topology ─────────────────────────────────────────────────────────────

describe("utils.memory.reactiveFactStore — topology", () => {
	it("mounts the ~12 fixed operator nodes and the cascade cycle edges", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
		});
		const desc = mem.describe();
		const names = Object.keys(desc.nodes);
		// Static topology — count is independent of how many facts land.
		for (const n of [
			"shard_0",
			"shard_1",
			"shard_2",
			"shard_3",
			"fact_store",
			"dependents_index",
			"extract_op",
			"invalidation_detector",
			"cascade",
			"cascade_processor",
			"cascade_overflow",
			"review",
			"answer",
			"consolidator",
		]) {
			expect(names).toContain(n);
		}
		// Cascade cycle edges visible in describe().
		const edges = desc.edges.map((e) => `${e.from}->${e.to}`);
		expect(edges).toContain("invalidation_detector->cascade");
		expect(edges).toContain("cascade->cascade_processor");
		mem.destroy();
	});

	it("does not grow topology as facts are ingested", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		const before = Object.keys(mem.describe().nodes).length;
		for (let i = 0; i < 50; i += 1) ingest.emit(frag(`f${i}`, `v${i}`));
		const after = Object.keys(mem.describe().nodes).length;
		expect(after).toBe(before);
		mem.destroy();
	});
});

// ── MEME L1: direct replace ──────────────────────────────────────────────

describe("utils.memory.reactiveFactStore — MEME L1 (direct replace)", () => {
	it("re-ingesting an id overwrites the stored fragment", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		const item = mem.itemNode("loc");
		item.subscribe(() => undefined);
		ingest.emit(frag("loc", "Beijing"));
		expect((item.cache as MemoryFragment<string>).payload).toBe("Beijing");
		ingest.emit(frag("loc", "Shanghai"));
		expect((item.cache as MemoryFragment<string>).payload).toBe("Shanghai");
		mem.destroy();
	});
});

// ── MEME L2: cascade invalidation ────────────────────────────────────────

describe("utils.memory.reactiveFactStore — MEME L2 (cascade)", () => {
	it("invalidating a source cascades validTo onto its dependents", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		mem.cascade.subscribe(() => undefined);
		const dep = mem.itemNode("commute");
		dep.subscribe(() => undefined);
		// `commute` depends on `home`.
		ingest.emit(frag("home", "Beijing"));
		ingest.emit(frag("commute", "15-min bike", { sources: ["home"] }));
		expect((dep.cache as MemoryFragment<string>).validTo).toBeUndefined();
		// Now `home` becomes obsolete (move). Cascade must flip `commute`.
		ingest.emit(frag("home", "Shanghai", { validTo: BigInt(monotonicNs()) }));
		const after = dep.cache as MemoryFragment<string>;
		expect(after.validTo).toBeDefined();
		mem.destroy();
	});

	it("emits cascade messages carrying a causalReason (explain visibility)", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		const seen: CascadeEvent[] = [];
		mem.cascade.subscribe((msgs) => {
			for (const m of msgs)
				if (m[0] === DATA) for (const e of m[1] as readonly CascadeEvent[]) seen.push(e);
		});
		ingest.emit(frag("a", "A"));
		ingest.emit(frag("b", "B", { sources: ["a"] }));
		ingest.emit(frag("a", "A2", { validTo: BigInt(monotonicNs()) }));
		const cascadeForB = seen.find((e) => e.factId === "b");
		expect(cascadeForB).toBeDefined();
		expect(cascadeForB!.reason).toBe("obsolete");
		expect(cascadeForB!.causalReason).toMatch(/dependentsIndex\[a\] → b/);
		mem.destroy();
	});

	it("reaches a fixpoint on a transitive dependency chain", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		mem.cascade.subscribe(() => undefined);
		const cN = mem.itemNode("c");
		cN.subscribe(() => undefined);
		// a → b → c chain.
		ingest.emit(frag("a", "A"));
		ingest.emit(frag("b", "B", { sources: ["a"] }));
		ingest.emit(frag("c", "C", { sources: ["b"] }));
		ingest.emit(frag("a", "A2", { validTo: BigInt(monotonicNs()) }));
		// Transitive: a obsolete → b flipped → c flipped. Fixpoint, no overflow.
		expect((cN.cache as MemoryFragment<string>).validTo).toBeDefined();
		expect(mem.cascadeOverflow.cache).toBeNull();
		mem.destroy();
	});
});

// ── MEME L3: obsolescence / bi-temporal ──────────────────────────────────

describe("utils.memory.reactiveFactStore — MEME L3 (obsolescence)", () => {
	it("query with asOf excludes facts whose validTo has passed", () => {
		const ingest = ingestNode<string>();
		const query = node<MemoryQuery>([], { initial: undefined });
		const mem = reactiveFactStore<string>({
			ingest,
			query,
			extractDependencies: (f) => f.sources,
		});
		mem.answer.subscribe(() => undefined);
		const t0 = BigInt(monotonicNs());
		ingest.emit(frag("colleague", "we are colleagues", { validFrom: t0, validTo: t0 + 100n }));
		// As-of after validTo — fact is obsolete ("we WERE colleagues").
		query.emit({ asOf: t0 + 500n });
		expect((mem.answer.cache as MemoryAnswer<string>).results.length).toBe(0);
		// As-of within validity window — fact is current.
		query.emit({ asOf: t0 + 50n });
		expect((mem.answer.cache as MemoryAnswer<string>).results.length).toBe(1);
		mem.destroy();
	});
});

// ── Cascade overflow cap ─────────────────────────────────────────────────

describe("utils.memory.reactiveFactStore — cascade overflow cap", () => {
	it("emits a per-batch overflow summary when the cycle exceeds maxIterations", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
			cascadeMaxIterations: 2,
		});
		mem.cascade.subscribe(() => undefined);
		const overflows: CascadeOverflow[] = [];
		mem.cascadeOverflow.subscribe((msgs) => {
			for (const m of msgs)
				if (m[0] === DATA && m[1] != null) overflows.push(m[1] as CascadeOverflow);
		});
		// Long chain: f0 → f1 → ... → f10. Each cascade round flips one more,
		// re-triggering the detector; with maxIterations=2 it overflows.
		ingest.emit(frag("f0", "v0"));
		for (let i = 1; i <= 10; i += 1) {
			ingest.emit(frag(`f${i}`, `v${i}`, { sources: [`f${i - 1}`] }));
		}
		ingest.emit(frag("f0", "v0b", { validTo: BigInt(monotonicNs()) }));
		expect(overflows.length).toBeGreaterThan(0);
		const o = overflows[0]!;
		expect(o.droppedCount).toBeGreaterThan(0);
		expect(Array.isArray(o.sample)).toBe(true);
		expect(o.sample.length).toBeLessThanOrEqual(8);
		mem.destroy();
	});
});

// ── Sharding fan-out ─────────────────────────────────────────────────────

describe("utils.memory.reactiveFactStore — sharding", () => {
	it("distributes facts across shards via the default hash-mod sharder", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		mem.factStore.subscribe(() => undefined);
		for (let i = 0; i < 40; i += 1) ingest.emit(frag(`fact-${i}`, `v${i}`));
		const populated = mem.shards.filter((s) => (s.cache as FactStore<string>).byId.size > 0).length;
		// 40 hashed ids across 4 shards — overwhelmingly likely to use >1 shard.
		expect(populated).toBeGreaterThan(1);
		const total = mem.shards.reduce((acc, s) => acc + (s.cache as FactStore<string>).byId.size, 0);
		expect(total).toBe(40);
		mem.destroy();
	});

	it("honors a caller-supplied shardBy override", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
			shardCount: 2,
			shardBy: (f) => (f.tags.includes("hot") ? 0 : 1),
		});
		mem.factStore.subscribe(() => undefined);
		ingest.emit(frag("a", "A", { tags: ["hot"] }));
		ingest.emit(frag("b", "B", { tags: ["cold"] }));
		expect((mem.shards[0]!.cache as FactStore<string>).byId.has("a")).toBe(true);
		expect((mem.shards[1]!.cache as FactStore<string>).byId.has("b")).toBe(true);
		mem.destroy();
	});
});

// ── The four extension faces ─────────────────────────────────────────────

describe("utils.memory.reactiveFactStore — extension faces", () => {
	it("① plain fn: extractDependencies feeds the dependentsIndex", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
		});
		mem.dependentsIndex.subscribe(() => undefined);
		ingest.emit(frag("src", "S"));
		ingest.emit(frag("der", "D", { sources: ["src"] }));
		const idx = mem.dependentsIndex.cache as ReadonlyMap<string, readonly string[]>;
		expect(idx.get("src")).toEqual(["der"]);
		mem.destroy();
	});

	it("② Node<Policy>: reactive scoring policy drives outcome write-back", () => {
		const ingest = ingestNode<string>();
		const outcome = node<OutcomeSignal>([], { initial: undefined });
		const scoring = node<ScoringPolicy<string>>([], {
			initial: (f) => Math.min(1, f.confidence + 0.5),
		});
		const mem = reactiveFactStore<string>({
			ingest,
			outcome,
			scoring,
			extractDependencies: (f) => f.sources,
		});
		const item = mem.itemNode("x");
		item.subscribe(() => undefined);
		ingest.emit(frag("x", "X", { confidence: 0.2 }));
		outcome.emit({ factId: "x", reward: 0 });
		expect((item.cache as MemoryFragment<string>).confidence).toBeCloseTo(0.7, 5);
		mem.destroy();
	});

	it("③ topic input: outcome topic without scoring nudges confidence by reward", () => {
		const ingest = ingestNode<string>();
		const outcome = node<OutcomeSignal>([], { initial: undefined });
		const mem = reactiveFactStore<string>({
			ingest,
			outcome,
			extractDependencies: (f) => f.sources,
		});
		const item = mem.itemNode("y");
		item.subscribe(() => undefined);
		ingest.emit(frag("y", "Y", { confidence: 0.5 }));
		outcome.emit({ factId: "y", reward: 0.3 });
		expect((item.cache as MemoryFragment<string>).confidence).toBeCloseTo(0.8, 5);
		mem.destroy();
	});

	it("④ topic output subscribe: cascade events observable for routing", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		const observed: CascadeEvent[] = [];
		// Caller composes a derived over the cascade output.
		const tap = node([mem.cascade], (b, a, c) => {
			const evts = (b[0]?.at(-1) ?? c.prevData[0] ?? []) as readonly CascadeEvent[];
			for (const e of evts) observed.push(e);
			a.emit(evts.length);
		});
		tap.subscribe(() => undefined);
		ingest.emit(frag("p", "P"));
		ingest.emit(frag("q", "Q", { sources: ["p"] }));
		ingest.emit(frag("p", "P2", { validTo: BigInt(monotonicNs()) }));
		expect(observed.some((e) => e.factId === "q")).toBe(true);
		mem.destroy();
	});

	it("consolidator: cron-triggered summary wires back into ingest", () => {
		const ingest = ingestNode<string>();
		const trigger = node<number>([], { initial: undefined });
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
			consolidateTrigger: trigger,
			consolidate: (store) => {
				const all = [...store.values()];
				if (all.length < 2) return [];
				// Order-independent: count + a deterministic parent reference.
				const parent = store.has("e1") ? "e1" : all[0]!.id;
				return [
					frag("summary", `consolidated:${all.length}`, {
						parent_fragment_id: parent,
					}),
				];
			},
		});
		mem.consolidated.subscribe(() => undefined);
		const summary = mem.itemNode("summary");
		summary.subscribe(() => undefined);
		ingest.emit(frag("e1", "episode 1"));
		ingest.emit(frag("e2", "episode 2"));
		trigger.emit(1);
		const s = summary.cache as MemoryFragment<string>;
		expect(s.payload).toBe("consolidated:2");
		expect(s.parent_fragment_id).toBe("e1");
		mem.destroy();
	});
});

// ── Audit-log replay ─────────────────────────────────────────────────────

describe("utils.memory.reactiveFactStore — audit log", () => {
	it("records ingest / consolidate / overflow with a monotonic seq", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		mem.events.entries.subscribe(() => undefined);
		ingest.emit(frag("a", "A"));
		ingest.emit(frag("b", "B"));
		const records = mem.events.entries.cache!;
		const ingests = records.filter((r) => r.action === "ingest");
		expect(ingests.length).toBe(2);
		expect(ingests.map((r) => r.id)).toEqual(["a", "b"]);
		const seqs = records.map((r) => r.seq).filter((s): s is number => s != null);
		for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
		mem.destroy();
	});
});

// ── describe / explain cycle visibility ──────────────────────────────────

describe("utils.memory.reactiveFactStore — describe/explain", () => {
	it("tags the cascade-cycle nodes with meta.cycle='cascade' (visible in describe)", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		const names = Object.keys(mem.describe().nodes);
		// Reactive meta is mounted as `<node>::__meta__::cycle` sub-nodes — the
		// cascade-cycle tag surfaces through `describe()` exactly there
		// (COMPOSITION-GUIDE §24 explainability mitigation).
		for (const n of ["invalidation_detector", "cascade", "cascade_processor"]) {
			expect(names).toContain(`${n}::__meta__::cycle`);
			const metaNode = mem.node(`${n}::__meta__::cycle`);
			expect(metaNode.cache).toBe("cascade");
		}
		mem.destroy();
	});

	it("explain(shard_0 → fact_store) closes without islands", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		const ex = mem.describe({ explain: { from: "shard_0", to: "fact_store" } }) as {
			found: boolean;
			reason: string;
			steps: unknown[];
		};
		expect(ex.found).toBe(true);
		expect(ex.steps.length).toBeGreaterThan(0);
		mem.destroy();
	});
});

// ── SENTINEL / null guards ───────────────────────────────────────────────

describe("utils.memory.reactiveFactStore — SENTINEL / null guards", () => {
	it("answer emits null until a query is issued (=== null guard)", () => {
		const ingest = ingestNode<string>();
		const query = node<MemoryQuery>([], { initial: undefined });
		const mem = reactiveFactStore<string>({
			ingest,
			query,
			extractDependencies: (f) => f.sources,
		});
		const seen: Array<MemoryAnswer<string> | null> = [];
		mem.answer.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) seen.push(m[1] as MemoryAnswer<string> | null);
		});
		ingest.emit(frag("a", "A", { tags: ["t"] }));
		// No query yet — answer must be exactly null.
		expect(seen.at(-1)).toBe(null);
		query.emit({ tags: ["t"] });
		const last = seen.at(-1);
		expect(last).not.toBe(null);
		expect((last as MemoryAnswer<string>).results.length).toBe(1);
		mem.destroy();
	});

	it("review emits null when no fact is below the threshold", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
			reviewThreshold: 0.3,
		});
		mem.review.subscribe(() => undefined);
		mem.addDisposer(keepalive(mem.review));
		ingest.emit(frag("hi", "trusted", { confidence: 0.9 }));
		expect(mem.review.cache).toBe(null);
		ingest.emit(frag("lo", "shaky", { confidence: 0.1 }));
		const r = mem.review.cache as ReviewRequest;
		expect(r.factId).toBe("lo");
		expect(r.confidence).toBe(0.1);
		mem.destroy();
	});
});
