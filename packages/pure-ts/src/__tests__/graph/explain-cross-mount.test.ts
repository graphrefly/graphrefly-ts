/**
 * Phase 13.K — Cross-graph `explain()` walk validation regression.
 *
 * Source: `archive/docs/SESSION-multi-agent-gap-analysis.md` G6 + drift suspicion.
 *
 * The static-face / dynamic-interior pitch (the multi-agent layer's
 * differentiator vs LangGraph's imperative supervisor) depends on
 * `Graph.describe({ explain })` walking through `parent.mount(...)`
 * boundaries cleanly. This file pins the cases:
 *
 *  1. Parent → child: `parent.derived` ← `child::node`. Walks one hop down.
 *  2. Child → parent → child: an explicit shared dep at parent level lets
 *     explain trace from one child through the parent into another child.
 *  3. Through `topicBridge`: source-topic `events` → bridge `output` →
 *     `bridge::attach` → target-topic `events`. The bridge → target.events
 *     edge is a soft forward edge declared via `meta.attachTarget` (see
 *     `src/base/meta/attach-edge-meta.ts`). Wave propagation flows via
 *     the imperative `targetTopic.publish(v)` in the attach effect body;
 *     explain consumes the resolved `meta.attachTarget` reverse-pred
 *     index to walk past the hop. Phase 13.K resolution dispatch D
 *     (2026-05-22).
 *
 * Per the locked plan: if any case fails, file the gap before claiming the
 * pitch.
 */

import { describe, expect, it } from "vitest";
import { topic, topicBridge } from "../../../../../src/utils/messaging/index.js";
import { node } from "../../core/node.js";
import { Graph } from "../../graph/graph.js";

// ---------------------------------------------------------------------------
// Case 1: parent → child (one-hop down)
// ---------------------------------------------------------------------------

describe("Phase 13.K — cross-mount explain walks (G6 validation)", () => {
	it("explain walks from a parent.derived dep to its mounted child source", () => {
		const parent = new Graph("parent");
		const child = new Graph("child");
		const x = node<number>([], { name: "x", initial: 1, describeKind: "state" });
		child.add(x, { name: "x" });
		parent.mount("child", child);

		// Parent derived depending on the mounted child node by Node ref.
		const y = parent.derived<number>(
			"y",
			[x as import("../../core/node.js").Node<unknown>],
			(data, ctx) => {
				const b0 = data[0];
				const v = (b0 != null && b0.length > 0 ? b0.at(-1) : ctx.prevData[0]) as number;
				return [v * 2];
			},
		);
		void y;

		const chain = parent.describe({ explain: { from: "child::x", to: "y" } });
		expect(chain.found).toBe(true);
		// Two-hop minimum — `from` and `to` are non-trivially connected.
		expect(chain.steps.length).toBeGreaterThanOrEqual(2);
		for (const step of chain.steps) {
			expect(step.path).not.toContain("<anonymous>");
			expect(step.path).not.toBe("");
		}
	});

	// -------------------------------------------------------------------------
	// Case 2: child A → parent → child B (multi-mount with shared parent dep)
	// -------------------------------------------------------------------------

	it("explain walks across two mounts via a shared parent-level node", () => {
		const parent = new Graph("parent");
		const childA = new Graph("childA");
		const childB = new Graph("childB");

		const a = node<number>([], { name: "a", initial: 10, describeKind: "state" });
		childA.add(a, { name: "a" });

		// Parent-level derived that depends on childA.a — visible to childB
		// when childB constructs a derived against this Node ref.
		parent.mount("childA", childA);
		const shared = parent.derived<number>(
			"shared",
			[a as import("../../core/node.js").Node<unknown>],
			(data, ctx) => {
				const b0 = data[0];
				const v = (b0 != null && b0.length > 0 ? b0.at(-1) : ctx.prevData[0]) as number;
				return [v + 100];
			},
		);

		// childB has a derived against `shared` via Node ref.
		const bDerived = childB.derived<number>(
			"b",
			[shared as import("../../core/node.js").Node<unknown>],
			(data, ctx) => {
				const b0 = data[0];
				const v = (b0 != null && b0.length > 0 ? b0.at(-1) : ctx.prevData[0]) as number;
				return [v * 3];
			},
		);
		void bDerived;
		parent.mount("childB", childB);

		// Walk from childA::a all the way to childB::b.
		const chain = parent.describe({
			explain: { from: "childA::a", to: "childB::b" },
		});
		expect(chain.found).toBe(true);
		// Path: childA::a → shared → childB::b — three steps minimum.
		expect(chain.steps.length).toBeGreaterThanOrEqual(3);
		// Middle step is the shared parent node.
		expect(chain.steps.some((s) => s.path === "shared")).toBe(true);
		for (const step of chain.steps) {
			expect(step.path).not.toContain("<anonymous>");
		}
	});

	// -------------------------------------------------------------------------
	// Case 3: topicBridge end-to-end via soft forward edge (Phase 13.K
	//   resolution, dispatch D). The bridge now declares an `attach` effect
	//   mount whose `meta.attachTarget` points at `dst::events`; describe
	//   resolves the Node ref to a path string, and explain consumes the
	//   resulting reverse-pred index as a "soft forward edge" so the BFS
	//   walks past the imperative `targetTopic.publish(v)` hop. Wave
	//   propagation is unchanged — the soft edge is an explainability
	//   concern only. See `src/base/meta/attach-edge-meta.ts`.
	// -------------------------------------------------------------------------

	it("explain walks topicBridge.output → bridge.attach → dst.events via soft forward edge", () => {
		const parent = new Graph("parent");
		const src = topic<number>("src");
		const dst = topic<number>("dst");
		parent.mount("src", src);
		parent.mount("dst", dst);
		const bridge = topicBridge<number>("bridge", src, dst);
		parent.mount("bridge", bridge);

		// Declared edges still walk: src::events → bridge::subscription::
		// available → bridge::output.
		const insideBridge = parent.describe({
			explain: { from: "src::events", to: "bridge::output" },
		});
		expect(insideBridge.found).toBe(true);

		// End-to-end walk now succeeds: src::events → … → bridge::output →
		// bridge::attach → dst::events. The bridge::attach → dst::events
		// hop is a soft forward edge (no declared dep — bridge::attach's
		// `meta.attachTarget` resolved to "dst::events" at describe time).
		const endToEnd = parent.describe({
			explain: { from: "src::events", to: "dst::events" },
		});
		expect(endToEnd.found).toBe(true);
		const paths = endToEnd.steps.map((s) => s.path);
		expect(paths).toContain("bridge::output");
		expect(paths).toContain("bridge::attach");
		expect(paths[0]).toBe("src::events");
		expect(paths[paths.length - 1]).toBe("dst::events");

		// The soft-edge marker lands on `bridge::attach` — that step's
		// OUTGOING edge to `dst::events` is the attach-meta hop, NOT a
		// declared dep, so `via_attach_edge: true` AND `dep_index` is
		// absent.
		const attachStep = endToEnd.steps.find((s) => s.path === "bridge::attach")!;
		expect(attachStep).toBeDefined();
		expect(attachStep.via_attach_edge).toBe(true);
		expect(attachStep.dep_index).toBeUndefined();

		// Declared-dep hops do NOT get the marker — sanity that we didn't
		// over-mark every step.
		const outputStep = endToEnd.steps.find((s) => s.path === "bridge::output")!;
		expect(outputStep.via_attach_edge).toBeUndefined();

		// Pretty-print renders the soft hop with a distinct arrow + suffix
		// so `console.log(chain.text)` makes the wave-untraversable hop
		// visible (not just present in the structured `steps[]`).
		expect(endToEnd.text).toMatch(/↝ dst::events.*\(via attach-edge\)/);
		// Declared-dep hops use the standard `↓` arrow and have no suffix.
		expect(endToEnd.text).toMatch(/↓ bridge::output/);
	});
});

// ---------------------------------------------------------------------------
// Sanity: explain rejects from/to that don't exist in the snapshot
// ---------------------------------------------------------------------------

describe("Phase 13.K — explain failure modes (sanity)", () => {
	it("returns no-such-from when `from` is not in the snapshot", () => {
		const g = new Graph("parent");
		g.add(node<number>([], { name: "x", initial: 1 }), { name: "x" });
		const chain = g.describe({ explain: { from: "ghost", to: "x" } });
		expect(chain.found).toBe(false);
		expect(chain.reason).toBe("no-such-from");
	});

	it("returns no-such-to when `to` is not in the snapshot", () => {
		const g = new Graph("parent");
		g.add(node<number>([], { name: "x", initial: 1 }), { name: "x" });
		const chain = g.describe({ explain: { from: "x", to: "ghost" } });
		expect(chain.found).toBe(false);
		expect(chain.reason).toBe("no-such-to");
	});
});
