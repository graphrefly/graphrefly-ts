/**
 * Tier 1.5.3 Phase 2.5 design session — bundle-factory tagging (DT1=B, DT2=table-picks).
 *
 * Verifies that bundle-returning factories tag their primary output node with
 * `meta.factory: "<name>"`. compileSpec round-trip via these tags is lossy
 * (you can't recreate a bundle from one tagged node), but provenance / audit /
 * LLM-prompt value is preserved per the design session locks.
 *
 * Skipped (need LLM adapter mocks): streamingPromptNode, gatedStream — same
 * tagging pattern via switchMap-`opts.meta` override; covered in [streaming.ts]
 * indirectly via the existing AI-tests when they exercise the bundles.
 */

import { node } from "@graphrefly/pure-ts/core/node.js";
import {
	circuitBreaker,
	distill,
	fallback,
	verifiable,
	withBreaker,
	withStatus,
} from "@graphrefly/pure-ts/extra";
import { Graph } from "@graphrefly/pure-ts/graph/graph.js";
import { describe, expect, it } from "vitest";
import { handoff } from "../../patterns/ai/agents/handoff.js";
import { toolSelector } from "../../patterns/ai/agents/tool-selector.js";

describe("Tier 1.5.3 Phase 2.5 — bundle-factory primary-node tagging", () => {
	it("verifiable.verified self-tags with factory: 'verifiable'", () => {
		const src = node([], { initial: 0 });
		const bundle = verifiable(src, (v) => ({ ok: (v as number) >= 0 }));
		const off = bundle.verified.subscribe(() => {});
		const g = new Graph("g");
		g.add(bundle.verified, { name: "verified" });
		expect(g.describe({ detail: "spec" }).nodes.verified?.meta?.factory).toBe("verifiable");
		off();
	});

	it("distill.compact self-tags with factory: 'distill'", () => {
		const src = node([], { initial: "seed" });
		const bundle = distill<string, { text: string }>(
			src,
			(_rawNode) => {
				// Simple sync extractor; the new reactive extractFn shape from Tier 1.5.4.
				// rawNode unused because this test only checks the tag, not the extraction.
				return node([], { initial: { upsert: [{ key: "k", value: { text: "v" } }] } });
			},
			{ score: () => 1, cost: () => 1, budget: 100 },
		);
		const off = bundle.compact.subscribe(() => {});
		const g = new Graph("g");
		g.add(bundle.compact, { name: "compact" });
		const meta = g.describe({ detail: "spec" }).nodes.compact?.meta;
		expect(meta?.factory).toBe("distill");
		expect((meta?.factoryArgs as { budget: number }).budget).toBe(100);
		off();
	});

	it("withStatus.node self-tags with factory: 'withStatus'", () => {
		const src = node([], { initial: 0 });
		const bundle = withStatus(src);
		const off = bundle.node.subscribe(() => {});
		const g = new Graph("g");
		g.add(bundle.node, { name: "wrapped" });
		const meta = g.describe({ detail: "spec" }).nodes.wrapped?.meta;
		expect(meta?.factory).toBe("withStatus");
		expect((meta?.factoryArgs as { initialStatus: string }).initialStatus).toBe("pending");
		off();
	});

	it("withBreaker.node self-tags with factory: 'withBreaker'", () => {
		const breaker = circuitBreaker();
		const wrap = withBreaker(breaker, { onOpen: "skip" });
		const src = node([], { initial: 0 });
		const bundle = wrap(src);
		const off = bundle.node.subscribe(() => {});
		const g = new Graph("g");
		g.add(bundle.node, { name: "wrapped" });
		const meta = g.describe({ detail: "spec" }).nodes.wrapped?.meta;
		expect(meta?.factory).toBe("withBreaker");
		expect((meta?.factoryArgs as { onOpen: string }).onOpen).toBe("skip");
		off();
	});

	it("fallback self-tags with factory: 'fallback' (name-only per DT4)", () => {
		const src = node([], { initial: 0 });
		const fb = fallback(src, 99);
		const off = fb.subscribe(() => {});
		const g = new Graph("g");
		g.add(fb, { name: "fb" });
		const meta = g.describe({ detail: "spec" }).nodes.fb?.meta;
		expect(meta?.factory).toBe("fallback");
		// DT4: name-only tag — factoryArgs is omitted because `fb` is non-JSON.
		expect("factoryArgs" in (meta ?? {})).toBe(false);
		off();
	});

	it("handoff (no condition branch) self-tags with factory: 'handoff'", () => {
		const src = node<number | null>([], { initial: null });
		const result = handoff<number>(src, (input) => input);
		const off = result.subscribe(() => {});
		const g = new Graph("g");
		g.add(result, { name: "h" });
		expect(g.describe({ detail: "spec" }).nodes.h?.meta?.factory).toBe("handoff");
		off();
	});

	it("handoff (condition branch) self-tags with factory: 'handoff'", () => {
		const src = node<number | null>([], { initial: null });
		const cond = node([], { initial: true });
		const result = handoff<number>(src, (input) => input, { condition: cond });
		const off = result.subscribe(() => {});
		const g = new Graph("g");
		g.add(result, { name: "h" });
		expect(g.describe({ detail: "spec" }).nodes.h?.meta?.factory).toBe("handoff");
		off();
	});

	it("toolSelector self-tags with factory: 'toolSelector'", () => {
		const allTools = node([], {
			initial: [
				{ name: "a", description: "tool a", parameters: { type: "object", properties: {} } },
				{ name: "b", description: "tool b", parameters: { type: "object", properties: {} } },
			],
		});
		const cond = node([], { initial: () => true });
		const filtered = toolSelector(allTools, [cond]);
		const off = filtered.subscribe(() => {});
		const g = new Graph("g");
		g.add(filtered, { name: "tools" });
		expect(g.describe({ detail: "spec" }).nodes.tools?.meta?.factory).toBe("toolSelector");
		off();
	});
});
