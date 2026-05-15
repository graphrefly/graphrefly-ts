/**
 * DS-14.6.A U-A — tagged context substrate.
 */

import { node } from "@graphrefly/pure-ts/core";
import { Graph } from "@graphrefly/pure-ts/graph";
import { describe, expect, it } from "vitest";
import {
	type ContextView,
	renderContextView,
	taggedContextPool,
} from "../../../presets/ai/context/index.js";

function pressureNode(initial: number) {
	return node<number>([], { initial });
}
function lastRendered<T>(n: ReturnType<typeof renderContextView<T>>) {
	let out: readonly unknown[] = [];
	const unsub = n.subscribe((msgs) => {
		for (const m of msgs) if (typeof m[0] === "symbol" && m[1] !== undefined) out = m[1] as never;
	});
	unsub();
	return out as readonly { id: string; tier: number; payload: unknown; compressed: boolean }[];
}

describe("DS-14.6.A U-A — taggedContextPool", () => {
	it("append-only pool: add / entries / byTag", () => {
		const g = new Graph("g");
		const pool = taggedContextPool<string>(g, { topic: "t" });
		pool.add({ payload: "a", tags: ["x"], importance: 0.9, compressible: true, topic: "t" });
		pool.add({ payload: "b", tags: ["y"], importance: 0.1, compressible: true, topic: "t" });
		expect((pool.entries.cache ?? []).map((e) => e.payload)).toEqual(["a", "b"]);
		const xs = pool.byTag("x");
		xs.subscribe(() => {});
		expect((xs.cache ?? []).map((e) => e.payload)).toEqual(["a"]);
		pool.dispose();
	});

	it("pressure 0 → tier-0 passthrough; pressure>0 applies first matching rule", () => {
		const g = new Graph("g");
		const pool = taggedContextPool<string>(g, { topic: "t" });
		pool.add({
			id: "e1",
			payload: "hello world this is long",
			tags: ["doc"],
			importance: 0.5,
			compressible: true,
			topic: "t",
		});
		const pressure = pressureNode(0);
		const view: ContextView<string> = {
			filter: () => true,
			pressure,
			budgetTokens: 10_000,
			rules: [{ match: { tagsAny: ["doc"] }, action: "truncate", maxChars: 5 }],
		};
		const rv = renderContextView(pool, view);
		rv.subscribe(() => {});
		expect(lastRendered(rv)[0]).toMatchObject({
			tier: 0,
			compressed: false,
			payload: "hello world this is long",
		});
		pressure.emit(1);
		expect(lastRendered(rv)[0]).toMatchObject({ tier: 1, compressed: true, payload: "hello" });
		pool.dispose();
	});

	it("evict rule removes the entry from the view; reference replaces payload", () => {
		const g = new Graph("g");
		const pool = taggedContextPool<string>(g, { topic: "t" });
		pool.add({
			id: "k",
			payload: "secret",
			tags: ["drop"],
			importance: 0.2,
			compressible: true,
			topic: "t",
		});
		pool.add({
			id: "r",
			payload: "keep",
			tags: ["ref"],
			importance: 0.2,
			compressible: true,
			topic: "t",
		});
		const rv = renderContextView(pool, {
			filter: () => true,
			pressure: pressureNode(1),
			budgetTokens: 10_000,
			rules: [
				{ match: { tagsAny: ["drop"] }, action: "evict" },
				{ match: { tagsAny: ["ref"] }, action: "reference" },
			],
		});
		rv.subscribe(() => {});
		const out = lastRendered(rv);
		expect(out.map((r) => r.id)).toEqual(["r"]);
		expect(out[0]).toMatchObject({ payload: "[ref:r]", compressed: true });
		pool.dispose();
	});

	it("llm-summary: throws at construction without llmCompress; caches (id,tier) across views with it", () => {
		const g = new Graph("g");
		const noLlm = taggedContextPool<string>(g, { topic: "n" });
		expect(() =>
			renderContextView(noLlm, {
				filter: () => true,
				pressure: pressureNode(1),
				budgetTokens: 1000,
				rules: [{ match: {}, action: "llm-summary", toTier: 2 }],
			}),
		).toThrow(/llm-summary/);

		let calls = 0;
		const pool = taggedContextPool<string>(g, {
			topic: "s",
			llmCompress: (e) => {
				calls += 1;
				return `sum(${e.id})`;
			},
		});
		pool.add({
			id: "z",
			payload: "long original text",
			tags: [],
			importance: 0.5,
			compressible: true,
			topic: "s",
		});
		const mkView = (): ContextView<string> => ({
			filter: () => true,
			pressure: pressureNode(1),
			budgetTokens: 1000,
			rules: [{ match: {}, action: "llm-summary", toTier: 2 }],
		});
		const v1 = renderContextView(pool, mkView());
		const v2 = renderContextView(pool, mkView());
		v1.subscribe(() => {});
		v2.subscribe(() => {});
		expect(lastRendered(v1)[0]).toMatchObject({ tier: 2, payload: "sum(z)", compressed: true });
		expect(lastRendered(v2)[0]).toMatchObject({ tier: 2, payload: "sum(z)" });
		// Shared (id,tier) cache → exactly one llmCompress call across both views.
		expect(calls).toBe(1);
		pool.dispose();
	});

	it("token budget trims lowest-importance rendered entries", () => {
		const g = new Graph("g");
		const pool = taggedContextPool<string>(g, { topic: "t" });
		pool.add({
			id: "hi",
			payload: "AAAAAAAA",
			tags: [],
			importance: 0.9,
			compressible: false,
			topic: "t",
		});
		pool.add({
			id: "lo",
			payload: "BBBBBBBB",
			tags: [],
			importance: 0.1,
			compressible: false,
			topic: "t",
		});
		const rv = renderContextView(pool, {
			filter: () => true,
			pressure: pressureNode(0),
			budgetTokens: 2, // ~8 chars => 2 tokens each; only one fits
			rules: [],
		});
		rv.subscribe(() => {});
		const out = lastRendered(rv);
		expect(out.map((r) => r.id)).toEqual(["hi"]); // low-importance "lo" trimmed
		pool.dispose();
	});

	it("poolGC removes by policy and rewrites the append-only log", () => {
		const g = new Graph("g");
		const pool = taggedContextPool<string>(g, { topic: "t" });
		for (let i = 0; i < 5; i++) {
			pool.add({
				id: `n${i}`,
				payload: `v${i}`,
				tags: [],
				importance: i / 10,
				compressible: true,
				topic: "t",
			});
		}
		const removed = pool.poolGC({ importanceBelow: 0.3 });
		expect(removed).toBe(3); // i=0,1,2 → importance 0,0.1,0.2 < 0.3
		expect((pool.entries.cache ?? []).map((e) => e.id)).toEqual(["n3", "n4"]);
		pool.dispose();
	});
});
