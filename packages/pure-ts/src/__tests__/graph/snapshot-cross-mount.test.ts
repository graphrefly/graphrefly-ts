/**
 * M4.E1 / D276 — regression-pinning scenarios for cross-mount derived dep
 * snapshot round-trips. graphrefly-rs landed D276 on 2026-05-22 with the
 * claim that pure-ts had the same bidirectional gap (encode collapses
 * cross-mount deps to bare names; decode flat-lookup misses them). These
 * scenarios were authored 2026-05-22 to verify that premise: all 4 pass
 * against current pure-ts, so the cross-track-ledger §2 row 62 closes as
 * "verified divergence-free" — TS's `describe`-based tree-wide
 * `nodeToPath` encoding does not have the Rust-specific single-graph
 * fall-through to `_anon_<rawid>` that D276 fixed. Tests remain as pins
 * so a future refactor of `Graph.snapshot` / `Graph.fromSnapshot` can't
 * regress the bidirectional cross-mount contract.
 *
 * @module
 */

import { describe, expect, it } from "vitest";

import { node } from "../../core/node.js";
import { Graph } from "../../graph/graph.js";

describe("M4.E1: cross-mount derived dep snapshot round-trip", () => {
	it("round-trips: snapshot → fromSnapshot → snapshot produces an equal snapshot (cross-mount)", () => {
		// Build a topology where `c2::b` depends on `c1::a` (cross-mount).
		const g = new Graph("root");
		const c1 = new Graph("c1");
		const c2 = new Graph("c2");
		g.mount("c1", c1);
		g.mount("c2", c2);
		const a = node([], { name: "a", initial: 10 });
		c1.add(a, { name: "a" });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(((data[0] as number) ?? 0) + 1);
			},
			{ describeKind: "derived", name: "b" },
		);
		c2.add(b, { name: "b" });
		b.subscribe(() => {});

		const snap1 = g.snapshot();
		// Critical: c2::b's deps in the snapshot MUST reference c1::a in some
		// resolvable form. Inspect the encoded deps before testing decode.
		expect(snap1.nodes["c2::b"]).toBeDefined();
		const bDeps = snap1.nodes["c2::b"]?.deps ?? [];
		expect(bDeps).toHaveLength(1);
		// The encoded dep should resolve to c1::a — either as the qualified
		// path "c1::a" (what nodeToPath yields for cross-mount reach) or as
		// the bare local name "a" (the fallback shape that bites decode).
		// If the failure mode is the bare-name fallback, decode will throw.
		// We record the actual encoded shape so the test diagnoses which
		// branch the bug sits in.
		const encoded = bDeps[0] as string;
		expect(encoded).toBeTypeOf("string");

		// Decode side: reconstruct via factories and confirm `b` resolves.
		const g2 = Graph.fromSnapshot(snap1, {
			factories: {
				"c2::b": (name, ctx) =>
					node(
						ctx.resolvedDeps,
						(batchData, actions, ctx2) => {
							const data = batchData.map((batch, i) =>
								batch != null && batch.length > 0 ? batch.at(-1) : ctx2.prevData[i],
							);
							actions.emit(((data[0] as number) ?? 0) + 1);
						},
						{ describeKind: "derived", name },
					),
			},
		});
		const restoredB = g2.tryResolve("c2::b");
		expect(restoredB).toBeDefined();

		// Live propagation: setting c1::a must update c2::b through the
		// rebuilt cross-mount dep.
		restoredB?.subscribe(() => {});
		g2.set("c1::a", 99);
		expect(g2.node("c2::b").cache).toBe(100);

		// Idempotent round-trip — re-snapshot must equal the first snapshot
		// shape (deps encoded identically). Lock the steady-state.
		const snap2 = g2.snapshot();
		expect(snap2.nodes["c2::b"]?.deps).toEqual(snap1.nodes["c2::b"]?.deps);
	});

	it("round-trips a 3-level deep chain that crosses three mounts", () => {
		// c1::a → c2::b → c3::c — each level lives in its own mount sibling.
		const g = new Graph("root");
		const c1 = new Graph("c1");
		const c2 = new Graph("c2");
		const c3 = new Graph("c3");
		g.mount("c1", c1);
		g.mount("c2", c2);
		g.mount("c3", c3);
		const a = node([], { name: "a", initial: 1 });
		c1.add(a, { name: "a" });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(((data[0] as number) ?? 0) * 2);
			},
			{ describeKind: "derived", name: "b" },
		);
		c2.add(b, { name: "b" });
		const c = node(
			[b],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(((data[0] as number) ?? 0) + 100);
			},
			{ describeKind: "derived", name: "c" },
		);
		c3.add(c, { name: "c" });
		c.subscribe(() => {});

		const snap = g.snapshot();
		const factory = (name: string, ctx: { resolvedDeps: ReadonlyArray<unknown> }) =>
			node(
				ctx.resolvedDeps as ReadonlyArray<import("../../core/node.js").NodeInput<unknown>>,
				(batchData: Array<ReadonlyArray<unknown> | undefined>, actions, ctx2) => {
					const data = batchData.map((batch, i) =>
						batch != null && batch.length > 0 ? batch.at(-1) : ctx2.prevData[i],
					);
					if (name === "b") actions.emit(((data[0] as number) ?? 0) * 2);
					else actions.emit(((data[0] as number) ?? 0) + 100);
				},
				{ describeKind: "derived", name },
			);
		const g2 = Graph.fromSnapshot(snap, {
			factories: {
				"c2::b": factory,
				"c3::c": factory,
			},
		});
		g2.node("c3::c").subscribe(() => {});
		expect(g2.node("c3::c").cache).toBe(102); // 1 * 2 + 100
		g2.set("c1::a", 5);
		expect(g2.node("c3::c").cache).toBe(110); // 5 * 2 + 100
	});

	it("round-trips a cross-mount-UP-into-parent dep (child node depends on a root-graph state)", () => {
		// QA F4 pin (2026-05-22): the original 3 tests covered cross-mount
		// SIBLING + 3-level deep DOWN. This test pins the orthogonal axis: a
		// node inside a mount depending UP on a node owned by the parent
		// root graph. `nodeToPath` for a tree-wide describe walks `root` →
		// children, so `root_state` (registered on `root` directly) encodes
		// as bare `"root_state"` while `c1::b` encodes as `"c1::b"`. The
		// asymmetry is real and worth pinning so a future tree-wide-encode
		// refactor can't silently break the up-into-parent case.
		const g = new Graph("root");
		const c1 = new Graph("c1");
		g.mount("c1", c1);
		const rootState = node([], { name: "root_state", initial: 7 });
		g.add(rootState, { name: "root_state" });
		const b = node(
			[rootState],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(((data[0] as number) ?? 0) + 10);
			},
			{ describeKind: "derived", name: "b" },
		);
		c1.add(b, { name: "b" });
		b.subscribe(() => {});

		const snap = g.snapshot();
		expect(snap.nodes["c1::b"]).toBeDefined();
		const bDeps = snap.nodes["c1::b"]?.deps ?? [];
		expect(bDeps).toHaveLength(1);
		// Lock the wire shape: dep on a root-owned node encodes as the bare
		// `"root_state"` name (not `"root::root_state"` — root self-name is
		// stripped per the describe contract).
		expect(bDeps[0]).toBe("root_state");

		const g2 = Graph.fromSnapshot(snap, {
			factories: {
				"c1::b": (name, ctx) =>
					node(
						ctx.resolvedDeps,
						(batchData, actions, ctx2) => {
							const data = batchData.map((batch, i) =>
								batch != null && batch.length > 0 ? batch.at(-1) : ctx2.prevData[i],
							);
							actions.emit(((data[0] as number) ?? 0) + 10);
						},
						{ describeKind: "derived", name },
					),
			},
		});
		g2.node("c1::b").subscribe(() => {});
		expect(g2.node("c1::b").cache).toBe(17); // 7 + 10
		// Live propagation through the rebuilt up-into-parent dep.
		g2.set("root_state", 42);
		expect(g2.node("c1::b").cache).toBe(52);
	});

	it("round-trips a diamond cross-mount: c2::b depends on BOTH c1::a AND c3::a", () => {
		// QA F4 pin (2026-05-22): two distinct cross-mount deps on a single
		// derived node. Validates that the tree-wide `nodeToPath` encoding
		// produces TWO qualified paths in `deps`, the decode `created.has`
		// retry loop resolves both before factory invocation, and the
		// rebuilt node receives the correct ordered `resolvedDeps`. Rust
		// D276's tree-wide hydration explicitly handles multi-dep ordering;
		// this pins TS does too.
		const g = new Graph("root");
		const c1 = new Graph("c1");
		const c2 = new Graph("c2");
		const c3 = new Graph("c3");
		g.mount("c1", c1);
		g.mount("c2", c2);
		g.mount("c3", c3);
		const a1 = node([], { name: "a", initial: 10 });
		c1.add(a1, { name: "a" });
		const a3 = node([], { name: "a", initial: 20 });
		c3.add(a3, { name: "a" });
		const b = node(
			[a1, a3],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(((data[0] as number) ?? 0) + ((data[1] as number) ?? 0));
			},
			{ describeKind: "derived", name: "b" },
		);
		c2.add(b, { name: "b" });
		b.subscribe(() => {});

		const snap = g.snapshot();
		const bDeps = snap.nodes["c2::b"]?.deps ?? [];
		// Lock the wire shape: BOTH deps encode as qualified paths, in
		// declared dep order (c1::a first, c3::a second). Same-local-name
		// collision (`a` in both `c1` and `c3`) is disambiguated by the
		// mount prefix — pinning that disambiguation.
		expect(bDeps).toEqual(["c1::a", "c3::a"]);

		const g2 = Graph.fromSnapshot(snap, {
			factories: {
				"c2::b": (name, ctx) =>
					node(
						ctx.resolvedDeps,
						(batchData, actions, ctx2) => {
							const data = batchData.map((batch, i) =>
								batch != null && batch.length > 0 ? batch.at(-1) : ctx2.prevData[i],
							);
							actions.emit(((data[0] as number) ?? 0) + ((data[1] as number) ?? 0));
						},
						{ describeKind: "derived", name },
					),
			},
		});
		g2.node("c2::b").subscribe(() => {});
		expect(g2.node("c2::b").cache).toBe(30); // 10 + 20
		// Both deps must propagate independently after restore.
		g2.set("c1::a", 100);
		expect(g2.node("c2::b").cache).toBe(120); // 100 + 20
		g2.set("c3::a", 200);
		expect(g2.node("c2::b").cache).toBe(300); // 100 + 200
	});

	it("back-compat: same-graph deps still encode as bare local names", () => {
		// Lock the existing behavior so cross-mount fixes don't disturb the
		// established single-graph encoding (Rust D276's "same-graph deps
		// collapse to bare local names" invariant).
		const g = new Graph("g");
		const a = node([], { name: "a", initial: 1 });
		g.add(a, { name: "a" });
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(((data[0] as number) ?? 0) + 1);
			},
			{ describeKind: "derived", name: "b" },
		);
		g.add(b, { name: "b" });
		b.subscribe(() => {});

		const snap = g.snapshot();
		// Same-graph dep should be the bare local name "a", NOT "g::a" —
		// pinning the back-compat wire shape.
		expect(snap.nodes.b?.deps).toEqual(["a"]);
	});
});
