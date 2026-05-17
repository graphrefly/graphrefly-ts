/**
 * DS-14.7 follow-up #1 — recipe library tests.
 *
 * Each recipe is a shipped composition over a `reactiveFactStore` extension
 * face; tests assert the composed behavior end-to-end (inspection-as-test:
 * drive `ingest`, read `itemNode`/outputs synchronously, fake-timer the two
 * timer-driven recipes).
 */

import { batch, DATA, monotonicNs, node, wallClockNs } from "@graphrefly/pure-ts/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	admissionLlmJudge,
	bitemporalQuery,
	consolidationRem,
	decayExponential,
	type FactId,
	influenceAnalysis,
	invalidationTracer,
	type MemoryFragment,
	type OutcomeSignal,
	reactiveFactStore,
	type StoreReadHandle,
	scoringByOutcome,
	shardByTenant,
} from "../../../utils/memory/index.js";

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
function readHandleOf<T>(frags: readonly MemoryFragment<T>[]): StoreReadHandle<T> {
	const m = new Map(frags.map((f) => [f.id, f] as const));
	return { get: (id) => m.get(id), has: (id) => m.has(id), size: m.size, values: () => m.values() };
}

afterEach(() => vi.useRealTimers());

// ── scoring-by-outcome ───────────────────────────────────────────────────
describe("recipes.scoringByOutcome", () => {
	it("feeds an outcome signal back into the applied scoring policy (continual learning)", () => {
		const ingest = ingestNode<string>();
		const outcomes = node<OutcomeSignal>([], { initial: undefined });
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
			outcome: outcomes,
			scoring: scoringByOutcome<string>(outcomes, { base: () => 0.5 }),
		});
		const it0 = mem.itemNode("x");
		it0.subscribe(() => undefined);
		ingest.emit(frag("x", "X", { confidence: 0.5 }));
		outcomes.emit({ factId: "x", reward: 0.3 });
		expect((it0.cache as MemoryFragment<string>).confidence).toBeCloseTo(0.8, 6);
		// Cumulative + clamped at 1.
		outcomes.emit({ factId: "x", reward: 0.9 });
		expect((it0.cache as MemoryFragment<string>).confidence).toBe(1);
		mem.destroy();
	});

	it("accumulates EVERY signal in a batched wave (full-wave fold, not last-only)", () => {
		const ingest = ingestNode<string>();
		const outcomes = node<OutcomeSignal>([], { initial: undefined });
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
			outcome: outcomes,
			scoring: scoringByOutcome<string>(outcomes, { base: () => 0 }),
		});
		const it0 = mem.itemNode("x");
		it0.subscribe(() => undefined);
		ingest.emit(frag("x", "X", { confidence: 0 }));
		// Two signals for the same id IN ONE WAVE — a last-only fold would drop
		// the first (0.4); the contract folds both ⇒ 0.4 + 0.5 = 0.9.
		batch(() => {
			outcomes.emit({ factId: "x", reward: 0.4 });
			outcomes.emit({ factId: "x", reward: 0.5 });
		});
		expect((it0.cache as MemoryFragment<string>).confidence).toBeCloseTo(0.9, 6);
		mem.destroy();
	});
});

// ── decay-exponential ────────────────────────────────────────────────────
describe("recipes.decayExponential", () => {
	it("drifts live confidence to the floor on the timer, leaves obsolete facts, then quiesces", () => {
		vi.useFakeTimers();
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		const driver = decayExponential<string>(mem, ingest, {
			halfLifeNs: 1n,
			periodMs: 100,
			floor: 0.1,
		});
		const batches: (readonly MemoryFragment<string>[])[] = [];
		driver.subscribe((msgs) => {
			for (const m of msgs)
				if (m[0] === DATA) batches.push(m[1] as readonly MemoryFragment<string>[]);
		});
		const live = mem.itemNode("live");
		const dead = mem.itemNode("dead");
		live.subscribe(() => undefined);
		dead.subscribe(() => undefined);
		// t_ns 0 ⇒ astronomically old ⇒ one pass collapses it to the floor.
		ingest.emit(frag("live", "L", { confidence: 1, t_ns: 0n }));
		ingest.emit(frag("dead", "D", { confidence: 0.9, t_ns: 0n, validTo: 5n }));

		vi.advanceTimersByTime(100); // first forgetting pass
		expect((live.cache as MemoryFragment<string>).confidence).toBe(0.1);
		expect((dead.cache as MemoryFragment<string>).confidence).toBe(0.9); // obsolete untouched
		const lastBatch = batches.at(-1) ?? [];
		expect(lastBatch.map((f) => f.id)).toEqual(["live"]);

		vi.advanceTimersByTime(100); // already at floor ⇒ no churn
		expect(batches.at(-1)).toEqual([]);
		mem.destroy();
	});

	it("quiesces via epsilon (floor=0, never reached) — drift below epsilon stops re-ingest", () => {
		vi.useFakeTimers();
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		// half-life == period ⇒ confidence halves each tick; floor 0 is never
		// reached exactly, so quiescence must come from epsilon.
		const periodNs = 100n * 1_000_000n;
		const driver = decayExponential<string>(mem, ingest, {
			halfLifeNs: periodNs,
			periodMs: 100,
			floor: 0,
		});
		const batches: (readonly MemoryFragment<string>[])[] = [];
		driver.subscribe((msgs) => {
			for (const m of msgs)
				if (m[0] === DATA) batches.push(m[1] as readonly MemoryFragment<string>[]);
		});
		const f = mem.itemNode("f");
		f.subscribe(() => undefined);
		// t_ns = the (frozen) fake-clock now ⇒ first-tick elapsed == one period.
		ingest.emit(frag("f", "F", { confidence: 1, t_ns: BigInt(wallClockNs()) }));
		let quiescedAt = -1;
		for (let i = 1; i <= 30 && quiescedAt < 0; i += 1) {
			vi.advanceTimersByTime(100);
			if ((batches.at(-1) ?? []).length === 0) quiescedAt = i;
		}
		expect(quiescedAt).toBeGreaterThan(1); // took several halvings, not instant
		const conf = (f.cache as MemoryFragment<string>).confidence;
		expect(conf).toBeGreaterThan(0); // quiesced by epsilon, NOT by hitting floor 0
		expect(conf).toBeLessThan(0.01);
		mem.destroy();
	});
});

// ── consolidation-rem ────────────────────────────────────────────────────
describe("recipes.consolidationRem", () => {
	it("consolidate() replays top-K recent live facts through summarize", () => {
		const { consolidate, consolidateTrigger } = consolidationRem<string>({
			periodMs: 1000,
			topK: 2,
			summarize: (replayed) => [
				frag("summary", replayed.map((f) => f.payload).join("+"), {
					parent_fragment_id: replayed[0]!.id,
				}),
			],
		});
		expect(consolidateTrigger).toBeTruthy();
		const out = consolidate(
			readHandleOf<string>([
				frag("a", "A", { confidence: 0.9 }),
				frag("b", "B", { confidence: 0.7 }),
				frag("c", "C", { confidence: 0.3 }),
				frag("z", "Z", { confidence: 1, validTo: 9n }), // obsolete ⇒ excluded
			]),
		);
		expect(out).toHaveLength(1);
		expect(out[0]!.payload).toBe("A+B"); // top-2 by confidence, obsolete dropped
		expect(out[0]!.parent_fragment_id).toBe("a");
	});

	it("recentWindowNs gates the pool to facts within the window of the newest", () => {
		const { consolidate } = consolidationRem<string>({
			periodMs: 1000,
			topK: 5,
			recentWindowNs: 100n,
			summarize: (replayed) => [frag("s", replayed.map((f) => f.id).join(","))],
		});
		const out = consolidate(
			readHandleOf<string>([
				frag("new", "N", { confidence: 0.5, t_ns: 1000n }), // newest
				frag("edge", "E", { confidence: 0.5, t_ns: 900n }), // exactly at cutoff (>=)
				frag("old", "O", { confidence: 1, t_ns: 800n }), // outside window — excluded
			]),
		);
		expect(out).toHaveLength(1);
		// `old` has the highest confidence but is filtered out by the window.
		expect(out[0]!.payload).toBe("new,edge");
	});

	it("wires successor fragments back into the store on the cron tick", () => {
		vi.useFakeTimers();
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
			...consolidationRem<string>({
				periodMs: 50,
				topK: 5,
				summarize: (r) => [frag("digest", `n=${r.length}`)],
			}),
		});
		const digest = mem.itemNode("digest");
		digest.subscribe(() => undefined);
		ingest.emit(frag("f1", "one"));
		ingest.emit(frag("f2", "two"));
		vi.advanceTimersByTime(50);
		expect((digest.cache as MemoryFragment<string>).payload).toBe("n=2");
		mem.destroy();
	});
});

// ── admission-llm-judge ──────────────────────────────────────────────────
describe("recipes.admissionLlmJudge", () => {
	it("deny-by-default until a verdict admits the fragment", () => {
		const ingest = ingestNode<string>();
		const verdicts = node<ReadonlyMap<FactId, boolean>>([], { initial: undefined });
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
			admissionFilter: admissionLlmJudge<string>(verdicts),
		});
		const a = mem.itemNode("a");
		a.subscribe(() => undefined);
		ingest.emit(frag("a", "A")); // no verdict ⇒ rejected
		expect(a.cache).toBeUndefined();
		verdicts.emit(new Map([["a", true]]));
		ingest.emit(frag("a", "A")); // now admitted
		expect((a.cache as MemoryFragment<string>).payload).toBe("A");
		mem.destroy();
	});
});

// ── shard-by-tenant ──────────────────────────────────────────────────────
describe("recipes.shardByTenant", () => {
	it("strict mode isolates each tenant in its own shard (+ overflow)", () => {
		const cfg = shardByTenant<{ t: string }>((f) => f.payload.t, {
			tenants: ["acme", "globex"],
		});
		expect(cfg.shardCount).toBe(3);
		expect(cfg.shardBy(frag("1", { t: "acme" }))).toBe(0);
		expect(cfg.shardBy(frag("2", { t: "globex" }))).toBe(1);
		expect(cfg.shardBy(frag("3", { t: "other" }))).toBe(2); // overflow

		const ingest = ingestNode<{ t: string }>();
		const mem = reactiveFactStore<{ t: string }>({
			ingest,
			extractDependencies: (f) => f.sources,
			...cfg,
		});
		mem.factStore.subscribe(() => undefined);
		ingest.emit(frag("a1", { t: "acme" }));
		ingest.emit(frag("g1", { t: "globex" }));
		const shard0 = mem.shards[0]!.cache as { byId: ReadonlyMap<string, unknown> };
		const shard1 = mem.shards[1]!.cache as { byId: ReadonlyMap<string, unknown> };
		expect(shard0.byId.has("a1")).toBe(true);
		expect(shard1.byId.has("g1")).toBe(true);
		expect(shard0.byId.has("g1")).toBe(false);
		mem.destroy();
	});

	it("soft mode hashes the tenant key into shardCount buckets", () => {
		const cfg = shardByTenant<{ t: string }>((f) => f.payload.t, { shardCount: 4 });
		expect(cfg.shardCount).toBe(4);
		expect(cfg.shardBy(frag("1", { t: "acme" }))).toBe("acme");
	});
});

// ── invalidation-tracer ──────────────────────────────────────────────────
describe("recipes.invalidationTracer", () => {
	it("accumulates causal trace entries for cascade events", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		const trace = invalidationTracer(mem, { limit: 16 });
		trace.subscribe(() => undefined);
		ingest.emit(frag("home", "Beijing"));
		ingest.emit(frag("commute", "bike", { sources: ["home"] }));
		ingest.emit(frag("home", "Shanghai", { validTo: BigInt(monotonicNs()) }));
		const entries = trace.cache as readonly { factId: string; causalReason: string }[];
		const hit = entries.find((e) => e.factId === "commute");
		expect(hit).toBeTruthy();
		expect(hit!.causalReason).toContain("dependentsIndex");
		mem.destroy();
	});

	it("records the cascade-overflow branch", () => {
		const ingest = ingestNode<string>();
		// cascadeMaxIterations:1 + a 3-deep chain ⇒ the b→c step overflows.
		const mem = reactiveFactStore<string>({
			ingest,
			extractDependencies: (f) => f.sources,
			cascadeMaxIterations: 1,
		});
		const trace = invalidationTracer(mem, { limit: 16 });
		trace.subscribe(() => undefined);
		mem.cascadeOverflow.subscribe(() => undefined);
		ingest.emit(frag("a", "A"));
		ingest.emit(frag("b", "B", { sources: ["a"] }));
		ingest.emit(frag("c", "C", { sources: ["b"] }));
		ingest.emit(frag("a", "A2", { validTo: BigInt(monotonicNs()) }));
		const entries = trace.cache as readonly { kind: string; causalReason: string }[];
		const ov = entries.find((e) => e.kind === "overflow");
		expect(ov).toBeTruthy();
		expect(ov!.causalReason).toContain("overflow");
		mem.destroy();
	});
});

// ── bitemporal-query ─────────────────────────────────────────────────────
describe("recipes.bitemporalQuery", () => {
	it("SENTINEL asOf ⇒ currently-valid; explicit asOf ⇒ historical window", () => {
		const ingest = ingestNode<string>();
		const asOf = node<bigint>([], { initial: undefined });
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		const view = bitemporalQuery(mem, asOf);
		view.subscribe(() => undefined);
		ingest.emit(frag("live", "L", { validFrom: 10n }));
		ingest.emit(frag("old", "O", { validFrom: 1n, validTo: 5n }));
		// No asOf yet ⇒ currently-valid only (validTo unset).
		expect((view.cache as readonly MemoryFragment<string>[]).map((f) => f.id)).toEqual(["live"]);
		// As of t=3 ⇒ only `old` was valid then.
		asOf.emit(3n);
		expect((view.cache as readonly MemoryFragment<string>[]).map((f) => f.id)).toEqual(["old"]);
		mem.destroy();
	});
});

// ── influence-analysis ───────────────────────────────────────────────────
describe("recipes.influenceAnalysis", () => {
	it("exposes the transitive dependent closure and influence ranking", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		const inf = influenceAnalysis(mem, { maxRanked: 8 });
		inf.ranked.subscribe(() => undefined);
		const ofA = inf.influenceOf("a");
		ofA.subscribe(() => undefined);
		ingest.emit(frag("a", "A"));
		ingest.emit(frag("b", "B", { sources: ["a"] }));
		ingest.emit(frag("c", "C", { sources: ["b"] }));
		expect([...(ofA.cache as readonly string[])].sort()).toEqual(["b", "c"]);
		const ranked = inf.ranked.cache as readonly { factId: string; influence: number }[];
		expect(ranked.find((r) => r.factId === "a")?.influence).toBe(2);
		expect(ranked.find((r) => r.factId === "b")?.influence).toBe(1);
		// `c` is a leaf — no dependents, absent from the index keys.
		expect(ranked.find((r) => r.factId === "c")).toBeUndefined();
		mem.destroy();
	});

	it("influenceOf is idempotent on repeat call with the same id (no graph.add collision)", () => {
		const ingest = ingestNode<string>();
		const mem = reactiveFactStore<string>({ ingest, extractDependencies: (f) => f.sources });
		const inf = influenceAnalysis(mem);
		const first = inf.influenceOf("home");
		// Documented usage calls this again for the same root — must NOT throw
		// (Graph.add rejects duplicate names) and must return the SAME node.
		const second = inf.influenceOf("home");
		expect(second).toBe(first);
		first.subscribe(() => undefined);
		ingest.emit(frag("home", "H"));
		ingest.emit(frag("commute", "C", { sources: ["home"] }));
		expect([...(first.cache as readonly string[])]).toEqual(["commute"]);
		mem.destroy();
	});
});
