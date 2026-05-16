import { DATA, monotonicNs, node } from "@graphrefly/pure-ts/core";
import {
	appendLogStorage,
	bigintJsonCodecFor,
	keepalive,
	memoryBackend,
} from "@graphrefly/pure-ts/extra";
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
			"consolidated",
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

// ── Deterministic cascade validTo (memo:Re P1 — rebuildable projection) ──

describe("utils.memory.reactiveFactStore — deterministic cascade validTo", () => {
	it("cascade-invalidated dependent inherits the root's validTo, not a fresh clock read", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		mem.cascade.subscribe(() => undefined);
		const dep = mem.itemNode("commute");
		dep.subscribe(() => undefined);
		ingest.emit(frag("home", "Beijing"));
		ingest.emit(frag("commute", "15-min bike", { sources: ["home"] }));
		// Obsolete `home` with an explicit, well-known validTo.
		const ROOT_VALID_TO = 1_234_567_890n;
		ingest.emit(frag("home", "Shanghai", { validTo: ROOT_VALID_TO }));
		expect((dep.cache as MemoryFragment<string>).validTo).toBe(ROOT_VALID_TO);
		mem.destroy();
	});

	it("transitive chain inherits the original root's validTo at every link", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		mem.cascade.subscribe(() => undefined);
		const bN = mem.itemNode("b");
		const cN = mem.itemNode("c");
		bN.subscribe(() => undefined);
		cN.subscribe(() => undefined);
		ingest.emit(frag("a", "A"));
		ingest.emit(frag("b", "B", { sources: ["a"] }));
		ingest.emit(frag("c", "C", { sources: ["b"] }));
		const ROOT_VALID_TO = 999_000n;
		ingest.emit(frag("a", "A2", { validTo: ROOT_VALID_TO }));
		expect((bN.cache as MemoryFragment<string>).validTo).toBe(ROOT_VALID_TO);
		expect((cN.cache as MemoryFragment<string>).validTo).toBe(ROOT_VALID_TO);
		mem.destroy();
	});

	it("replaying the same ingest stream yields byte-identical cascade validTo", () => {
		const run = () => {
			const ingest = ingestNode<string>();
			const mem = reactiveFactStore<string>({
				ingest,
				extractDependencies: (f) => f.sources,
			});
			mem.cascade.subscribe(() => undefined);
			const dep = mem.itemNode("y");
			dep.subscribe(() => undefined);
			ingest.emit(frag("x", "X"));
			ingest.emit(frag("y", "Y", { sources: ["x"] }));
			ingest.emit(frag("x", "X2", { validTo: 555n }));
			const v = (dep.cache as MemoryFragment<string>).validTo;
			mem.destroy();
			return v;
		};
		// Two independent runs of the identical stream → identical store.
		expect(run()).toBe(run());
		expect(run()).toBe(555n);
	});

	it("CascadeEvent carries the deterministic rootValidTo", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		const seen: CascadeEvent[] = [];
		mem.cascade.subscribe((msgs) => {
			for (const m of msgs)
				if (m[0] === DATA) for (const e of m[1] as readonly CascadeEvent[]) seen.push(e);
		});
		ingest.emit(frag("p", "P"));
		ingest.emit(frag("q", "Q", { sources: ["p"] }));
		ingest.emit(frag("p", "P2", { validTo: 7777n }));
		const ev = seen.find((e) => e.factId === "q");
		expect(ev).toBeDefined();
		expect(ev!.rootValidTo).toBe(7777n);
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

// ── F1/F5/F3 cascade-termination semantic fixes ──────────────────────────

describe("utils.memory.reactiveFactStore — cascade convergence (F1/F5/F3)", () => {
	// Count non-empty cascade DATA emissions — the convergence witness.
	function cascadeCounter(mem: ReturnType<typeof reactiveFactStore<string>>) {
		let nonEmpty = 0;
		let total = 0;
		mem.cascade.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] !== DATA) continue;
				total += 1;
				if ((m[1] as readonly CascadeEvent[]).length > 0) nonEmpty += 1;
			}
		});
		return {
			get nonEmpty() {
				return nonEmpty;
			},
			get total() {
				return total;
			},
		};
	}

	it("F1/F5(a): a low-confidence-but-still-live root does NOT drive the cascade (no perpetual re-emit)", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
			reviewThreshold: 0.5,
		});
		const c = cascadeCounter(mem);
		mem.review.subscribe(() => undefined);
		mem.addDisposer(keepalive(mem.review));
		const depItem = mem.itemNode("dep");
		depItem.subscribe(() => undefined);

		// `root` is low-confidence (0.1 < 0.5) but NEVER obsolete (no validTo);
		// `dep` is a live dependent. Pre-fix this looped: the detector re-emitted
		// a cascade for `dep` on every detector pass forever.
		ingest.emit(frag("root", "R", { confidence: 0.1 }));
		ingest.emit(frag("dep", "D", { sources: ["root"], confidence: 0.9 }));

		// Convergence: the low-confidence root produced ZERO cascade waves and
		// the dependent stays live. The fact is surfaced through `review`.
		expect(c.nonEmpty).toBe(0);
		expect((depItem.cache as MemoryFragment<string>).validTo).toBeUndefined();
		expect((mem.review.cache as ReviewRequest).factId).toBe("root");
		expect(mem.cascadeOverflow.cache).toBeNull();

		// Re-running the detector (another ingest) still emits no cascade for
		// the still-live low-confidence root — bounded, not perpetual.
		ingest.emit(frag("other", "O", { confidence: 0.95 }));
		expect(c.nonEmpty).toBe(0);
		mem.destroy();
	});

	it("F1/F5(b): an obsolete root emits its cascade exactly once across waves", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
		});
		const c = cascadeCounter(mem);
		const dItem = mem.itemNode("d");
		dItem.subscribe(() => undefined);

		ingest.emit(frag("r", "R"));
		ingest.emit(frag("d", "D", { sources: ["r"] }));
		const before = c.nonEmpty;
		// `r` → obsolete: drives the cascade exactly once.
		ingest.emit(frag("r", "R2", { validTo: BigInt(monotonicNs()) }));
		expect((dItem.cache as MemoryFragment<string>).validTo).toBeDefined();
		const afterFirst = c.nonEmpty;
		expect(afterFirst).toBe(before + 1);

		// Many subsequent unrelated ingests re-run the detector; `r` stays
		// obsolete but is in processedRoots → no further cascade waves.
		for (let i = 0; i < 20; i += 1) ingest.emit(frag(`x${i}`, `v${i}`));
		expect(c.nonEmpty).toBe(afterFirst);
		expect(mem.cascadeOverflow.cache).toBeNull();
		mem.destroy();
	});

	it("F1/F5: concurrent wire-back ingest during an in-flight cascade still converges", () => {
		const ingest = ingestNode<string>();
		const trigger = node<number>([], { initial: undefined });
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
			// Consolidator wire-back ingests a successor mid-life; pre-fix this
			// reset the shared counter and could defeat the backstop.
			consolidateTrigger: trigger,
			consolidate: (store) => {
				if (!store.has("a")) return [];
				return [frag("summary", `n:${store.size}`, { sources: ["a"] })];
			},
		});
		const c = cascadeCounter(mem);
		const bItem = mem.itemNode("b");
		bItem.subscribe(() => undefined);
		mem.consolidated.subscribe(() => undefined);

		ingest.emit(frag("a", "A"));
		ingest.emit(frag("b", "B", { sources: ["a"] }));
		// Fire a consolidation wire-back (commits `summary` dep on `a`), THEN
		// make `a` obsolete. Cascade must converge despite the interleaved
		// ingest-driven counter reset.
		trigger.emit(1);
		ingest.emit(frag("a", "A2", { validTo: BigInt(monotonicNs()) }));

		expect((bItem.cache as MemoryFragment<string>).validTo).toBeDefined();
		// Bounded number of cascade waves (finite, no hang). The exact count is
		// small; we assert a generous upper bound to prove convergence.
		expect(c.total).toBeLessThan(50);
		expect(mem.cascadeOverflow.cache).toBeNull();
		mem.destroy();
	});

	it("F3: phantom edge (extractDependencies names an un-ingested id) converges", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({
			ingest,
			// `b` declares a dependency on `ghost`, which is never ingested.
			extractDependencies: (f) => f.sources,
		});
		const c = cascadeCounter(mem);
		mem.cascade.subscribe(() => undefined);

		ingest.emit(frag("real", "R"));
		ingest.emit(frag("b", "B", { sources: ["ghost", "real"] }));
		// `real` becomes obsolete; its dependent set via dependentsIndex is
		// empty (b depends on ghost+real but the index keys by source id).
		ingest.emit(frag("real", "R2", { validTo: BigInt(monotonicNs()) }));
		// Now make `ghost`'s phantom presence the trigger: ingest then obsolete
		// a fact that lists a never-existing dependent path. The phantom-edge
		// `!depFact` guard prevents an infinite cascade.
		ingest.emit(frag("ghost", "G", { validTo: BigInt(monotonicNs()) }));

		// Converges: bounded waves, no overflow, no hang.
		expect(c.total).toBeLessThan(50);
		expect(mem.cascadeOverflow.cache).toBeNull();
		mem.destroy();
	});

	it("F1/F5: transitive chain fully propagates and converges (no overflow) within the iteration budget", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
			// Budget comfortably exceeds the chain length so termination is
			// the per-root contract + empty-array fixpoint, not the backstop.
			cascadeMaxIterations: 16,
		});
		const c = cascadeCounter(mem);
		const tail = mem.itemNode("f5");
		tail.subscribe(() => undefined);
		// f0 → f1 → ... → f5 chain. Each link becomes obsolete in turn and
		// drives its cascade exactly once; the wave count is bounded and the
		// cascade converges to the tail without tripping the overflow cap.
		ingest.emit(frag("f0", "v0"));
		for (let i = 1; i <= 5; i += 1) {
			ingest.emit(frag(`f${i}`, `v${i}`, { sources: [`f${i - 1}`] }));
		}
		ingest.emit(frag("f0", "v0b", { validTo: BigInt(monotonicNs()) }));
		expect((tail.cache as MemoryFragment<string>).validTo).toBeDefined();
		expect(mem.cascadeOverflow.cache).toBeNull();
		// Bounded, finite emission count — the convergence witness.
		expect(c.total).toBeLessThan(40);
		expect(c.nonEmpty).toBeLessThanOrEqual(6);
		mem.destroy();
	});
});

// ── Opt-in payload-carrying ingest log (memo:Re P1 — rebuildable proj.) ──

describe("utils.memory.reactiveFactStore — recordIngest / ingestLog", () => {
	it("ingestLog is absent unless recordIngest is enabled", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		expect(mem.ingestLog).toBeUndefined();
		mem.destroy();
	});

	it("records every committed fragment with full payload", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
			recordIngest: true,
		});
		expect(mem.ingestLog).toBeDefined();
		mem.ingestLog!.entries.subscribe(() => undefined);
		ingest.emit(frag("a", "A"));
		ingest.emit(frag("b", "B", { sources: ["a"] }));
		const logged = mem.ingestLog!.entries.cache as readonly MemoryFragment<string>[];
		expect(logged.map((f) => [f.id, f.payload])).toEqual([
			["a", "A"],
			["b", "B"],
		]);
		mem.destroy();
	});

	it("persist ingestLog + replay rebuilds a byte-identical store", async () => {
		const backend = memoryBackend();
		const tier = appendLogStorage<MemoryFragment<string>>(backend, {
			name: "facts-ingest",
			codec: bigintJsonCodecFor<readonly MemoryFragment<string>[]>(),
		});

		// ── Original store: ingest a→b, then obsolete `a` (cascade flips b). ──
		const ingest1 = ingestNode<string>();
		const mem1 = reactiveFactStore<string>({
			ingest: ingest1,
			extractDependencies: (f) => f.sources,
			recordIngest: true,
		});
		mem1.cascade.subscribe(() => undefined);
		mem1.factStore.subscribe(() => undefined);
		mem1.ingestLog!.attachStorage([tier]);
		ingest1.emit(frag("a", "A", { t_ns: 100n }));
		ingest1.emit(frag("b", "B", { sources: ["a"], t_ns: 200n }));
		ingest1.emit(frag("a", "A2", { t_ns: 300n, validTo: 4242n }));
		await tier.flush?.();
		const store1 = (mem1.factStore.cache as { byId: ReadonlyMap<string, MemoryFragment<string>> })
			.byId;
		mem1.destroy();

		// ── Restart: replay persisted fragments into a fresh store. ──
		const { entries } = await tier.loadEntries!();
		const ingest2 = ingestNode<string>();
		const mem2 = reactiveFactStore<string>({
			ingest: ingest2,
			extractDependencies: (f) => f.sources,
		});
		mem2.cascade.subscribe(() => undefined);
		mem2.factStore.subscribe(() => undefined);
		for (const f of entries) ingest2.emit(f);
		const store2 = (mem2.factStore.cache as { byId: ReadonlyMap<string, MemoryFragment<string>> })
			.byId;

		// Byte-identical: same ids, payloads, and (deterministic) validTo.
		expect([...store2.keys()].sort()).toEqual([...store1.keys()].sort());
		for (const [id, f1] of store1) {
			const f2 = store2.get(id)!;
			expect(f2.payload).toBe(f1.payload);
			expect(f2.validTo).toBe(f1.validTo);
			expect(f2.t_ns).toBe(f1.t_ns);
		}
		// `b` was cascade-invalidated; its validTo is the deterministic root time.
		expect(store2.get("b")!.validTo).toBe(4242n);
		mem2.destroy();
	});
});
