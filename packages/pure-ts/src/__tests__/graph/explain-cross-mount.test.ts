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
 *  3. Through `topicBridge`: source-topic `events` → bridge `output` → ???
 *     — the bridge → target.events edge goes through an imperative
 *     `_attachArrayToLog` subscriber, NOT a declared dep. This case is
 *     KNOWN to fail under the current substrate and motivates a follow-up
 *     gap; the test pins the failure mode so the gap is visible.
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
	// Case 3: topicBridge — KNOWN GAP (explain can't walk the bridge → target
	//   edge because `_attachArrayToLog` is an imperative subscribe, not a
	//   declared dep). This test pins the failure mode for documentation.
	// -------------------------------------------------------------------------

	it("[KNOWN GAP] explain does NOT walk topicBridge.output → target.events (imperative attach)", () => {
		const parent = new Graph("parent");
		const src = topic<number>("src");
		const dst = topic<number>("dst");
		parent.mount("src", src);
		parent.mount("dst", dst);
		const bridge = topicBridge<number>("bridge", src, dst);
		parent.mount("bridge", bridge);

		// Forward edges that ARE declared:
		//   src::events → bridge::subscription::available → bridge::output
		// is reachable. The bridge → dst::events edge goes through
		// `_attachArrayToLog` (imperative subscribe at the source node,
		// runtime publish on the target topic) which is NOT a declared dep.
		const insideBridge = parent.describe({
			explain: { from: "src::events", to: "bridge::output" },
		});
		expect(insideBridge.found).toBe(true);

		// The end-to-end walk to the target topic is the gap. We assert the
		// CURRENT BEHAVIOR (no path found) so the test pins the regression
		// envelope. When a future iteration adds an `attach`-edge declaration
		// to the bridge (or describes the imperative attach via a meta
		// annotation that explain consumes), this assertion will flip and
		// the test should be updated to assert `found: true`.
		const endToEnd = parent.describe({
			explain: { from: "src::events", to: "dst::events" },
		});
		expect(endToEnd.found).toBe(false);
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
