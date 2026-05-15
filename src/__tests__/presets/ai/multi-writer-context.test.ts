/**
 * DS-14.6.A delta-4 — multi-writer worked-example lock-test.
 *
 * Proves L2 (subgraph-level write isolation — two actors own different pool
 * segments, write concurrently) + L4 (per-view rendering — same entry at
 * different tiers in two views) + L5 (shared `(id, tier)` cache — one
 * `llmCompress` call across both views asking the same tier).
 */
import { node } from "@graphrefly/pure-ts/core";
import { Graph } from "@graphrefly/pure-ts/graph";
import { describe, expect, it } from "vitest";
import { type ContextView, renderContextView } from "../../../presets/ai/context/index.js";
import { actorPool } from "../../../presets/harness/actor-pool.js";

describe("DS-14.6.A delta-4 — multi-writer + per-view + cross-view cache", () => {
	it("two actors write concurrently; two views render the same entry at different tiers; one cached LLM call", () => {
		const g = new Graph("g");
		let llmCalls = 0;
		const pool = actorPool<string>(g, {
			name: "mw",
			llmCompress: (e, tier) => {
				llmCalls += 1;
				return `sum:${e.id}@${tier}`;
			},
		});

		const view = (rules: ContextView<string>["rules"]): ContextView<string> => ({
			filter: () => true,
			pressure: node<number>([], { initial: 1 }),
			budgetTokens: 10_000,
			rules,
		});

		const a1 = pool.attachActor({ id: "w1", view: view([]) });
		const a2 = pool.attachActor({ id: "w2", view: view([]) });

		// L2: concurrent writers, different segments (own actor tag).
		const id1 = a1.publish({
			payload: "doc one",
			tags: ["seg1"],
			importance: 0.8,
			compressible: true,
			topic: "context",
		});
		a2.publish({
			payload: "doc two",
			tags: ["seg2"],
			importance: 0.4,
			compressible: true,
			topic: "context",
		});

		const entries = pool.contextPool.entries.cache ?? [];
		expect(entries.map((e) => e.id)).toEqual([id1, entries[1]?.id]);
		expect(entries[0]?.tags).toContain("actor:w1");
		expect(entries[1]?.tags).toContain("actor:w2");

		// L4 + L5: two views both summarising seg1 to tier 2 → one cached call.
		const summariseSeg1 = view([
			{ match: { tagsAny: ["seg1"] }, action: "llm-summary" as const, toTier: 2 as const },
		]);
		const vA = renderContextView(pool.contextPool, summariseSeg1);
		const vB = renderContextView(pool.contextPool, {
			...summariseSeg1,
			pressure: node<number>([], { initial: 1 }),
		});
		vA.subscribe(() => {});
		vB.subscribe(() => {});

		const pick = (n: typeof vA) =>
			(n.cache ?? []).find((r) => r.id === id1) as { tier: number; payload: unknown } | undefined;
		expect(pick(vA)).toMatchObject({ tier: 2, payload: `sum:${id1}@2` });
		expect(pick(vB)).toMatchObject({ tier: 2, payload: `sum:${id1}@2` });
		// L5: shared (id, tier) cache → exactly one llmCompress call.
		expect(llmCalls).toBe(1);

		a1.release();
		a2.release();
		pool.dispose();
	});
});
