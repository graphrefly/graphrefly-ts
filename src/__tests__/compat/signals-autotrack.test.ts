/**
 * Semantic edge cases for `autoTrackNode` via the Signal compat layer.
 *
 * Focus: value correctness (`.get()`) and cb count correctness
 * (subscriber fires). Fn call counts are an implementation detail and
 * are NOT asserted here — the compat contracts with Jotai and TC39
 * Signals only specify "cb fires on genuine value changes," not "fn
 * runs exactly N times."
 */

import { DATA } from "@graphrefly/pure-ts/core";
import { describe, expect, it } from "vitest";
import { Signal } from "../../compat/signals/index.js";

describe("compat/signals — autoTrackNode semantics", () => {
	it("conditional branch switching fires cb only on value changes", () => {
		const useA = new Signal.State(true);
		const a = new Signal.State("a1");
		const b = new Signal.State("b1");

		const result = new Signal.Computed(() => (useA.get() ? a.get() : b.get()));

		const seen: string[] = [];
		const unsub = Signal.sub(result, (v) => seen.push(v));

		expect(result.get()).toBe("a1");
		expect(seen).toEqual([]); // Signal.sub skips initial push

		// Flip to b's branch — exactly one fire with b's current value.
		useA.set(false);
		expect(result.get()).toBe("b1");
		expect(seen).toEqual(["b1"]);

		// a is no longer the active branch → no fire.
		a.set("a2");
		expect(result.get()).toBe("b1");
		expect(seen).toEqual(["b1"]);

		// Flip back — must reflect a's CURRENT value "a2", not stale "a1".
		useA.set(true);
		expect(result.get()).toBe("a2");
		expect(seen).toEqual(["b1", "a2"]);

		// Setting b while b is not the active branch → no fire.
		b.set("b3");
		expect(result.get()).toBe("a2");
		expect(seen).toEqual(["b1", "a2"]);

		// Flip again — must reflect b's latest value "b3".
		useA.set(false);
		expect(result.get()).toBe("b3");
		expect(seen).toEqual(["b1", "a2", "b3"]);

		unsub();
	});

	it("downstream computed chain advances when inner branch-switches", () => {
		const useA = new Signal.State(true);
		const a = new Signal.State("a1");
		const b = new Signal.State("b1");

		const inner = new Signal.Computed(() => (useA.get() ? a.get() : b.get()));
		const outer = new Signal.Computed(() => `[${inner.get()}]`);

		const seen: string[] = [];
		const unsub = Signal.sub(outer, (v) => seen.push(v));

		expect(outer.get()).toBe("[a1]");
		expect(seen).toEqual([]);

		useA.set(false);
		expect(outer.get()).toBe("[b1]");
		expect(seen).toEqual(["[b1]"]);

		b.set("b2");
		expect(outer.get()).toBe("[b2]");
		expect(seen).toEqual(["[b1]", "[b2]"]);

		// a change, but a is not in inner's currently-used branch.
		a.set("a2");
		expect(outer.get()).toBe("[b2]");
		expect(seen).toEqual(["[b1]", "[b2]"]);

		// Switch back — outer must see the fresh "a2".
		useA.set(true);
		expect(outer.get()).toBe("[a2]");
		expect(seen).toEqual(["[b1]", "[b2]", "[a2]"]);

		unsub();
	});

	it("transitive skip when mid-chain computed result is unchanged", () => {
		// Classic equality-suppression case: x flips between odd values, so
		// mod stays at 1. Downstream chain must not fire cb, because its
		// underlying value hasn't changed.
		const x = new Signal.State(1);
		const mod = new Signal.Computed(() => x.get() % 2);
		const chain = new Signal.Computed(() => mod.get() * 10);

		const seen: number[] = [];
		const unsub = Signal.sub(chain, (v) => seen.push(v));

		expect(chain.get()).toBe(10);
		expect(seen).toEqual([]);

		// x: 1 → 3 → 5, mod stays 1, chain stays 10, subscriber silent.
		x.set(3);
		expect(chain.get()).toBe(10);
		expect(seen).toEqual([]);

		x.set(5);
		expect(chain.get()).toBe(10);
		expect(seen).toEqual([]);

		// x: 5 → 4, mod flips to 0, chain becomes 0, subscriber fires.
		x.set(4);
		expect(chain.get()).toBe(0);
		expect(seen).toEqual([0]);

		// x: 4 → 6, mod stays 0, chain stays 0, silent.
		x.set(6);
		expect(chain.get()).toBe(0);
		expect(seen).toEqual([0]);

		// x: 6 → 7, mod flips to 1, chain back to 10.
		x.set(7);
		expect(chain.get()).toBe(10);
		expect(seen).toEqual([0, 10]);

		unsub();
	});

	it("sibling dep still advances outer when inner emits RESOLVED", () => {
		// Two-way bridge regression: when inner's fn runs but produces an
		// unchanged value (→ RESOLVED framed), outer's dep.inner must be
		// cleared so a subsequent sibling update to outer still advances.
		//
		// An earlier implementation swallowed the no-op emission entirely,
		// leaving outer's dep record stuck dirty and freezing the chain.
		const useA = new Signal.State(true);
		const a = new Signal.State("a1");
		const b = new Signal.State("b1");
		const inner = new Signal.Computed(() => (useA.get() ? a.get() : b.get()));

		const other = new Signal.State("o1");
		const outer = new Signal.Computed(() => `${inner.get()}|${other.get()}`);

		const seen: string[] = [];
		const unsub = Signal.sub(outer, (v) => seen.push(v));

		expect(outer.get()).toBe("a1|o1");

		useA.set(false);
		expect(outer.get()).toBe("b1|o1");
		expect(seen).toEqual(["b1|o1"]);

		// a is now the unused branch. inner's wave is a no-op.
		a.set("a2");
		expect(outer.get()).toBe("b1|o1");
		expect(seen).toEqual(["b1|o1"]);

		// Sibling dep of outer — must still advance outer past the no-op.
		other.set("o2");
		expect(outer.get()).toBe("b1|o2");
		expect(seen).toEqual(["b1|o1", "b1|o2"]);

		// Another round of inner no-op + sibling update, to catch any
		// residual "stuck once cleared stays stuck" bugs.
		a.set("a3");
		other.set("o3");
		expect(outer.get()).toBe("b1|o3");
		expect(seen).toEqual(["b1|o1", "b1|o2", "b1|o3"]);

		unsub();
	});

	it("diamond where one leg is a no-op still fires subscriber exactly once", () => {
		const base = new Signal.State(1);
		const even = new Signal.Computed(() => base.get() % 2 === 0); // false
		const doubled = new Signal.Computed(() => base.get() * 2); // 2
		const final = new Signal.Computed(() => `${even.get()}:${doubled.get()}`);

		const seen: string[] = [];
		const unsub = Signal.sub(final, (v) => seen.push(v));

		expect(final.get()).toBe("false:2");
		expect(seen).toEqual([]);

		// 1 → 3: even stays false (RESOLVED), doubled goes 2 → 6 (DATA).
		// The diamond must collapse into exactly one cb fire at the final
		// node — no intermediate "false:2" (stale doubled) or glitches.
		base.set(3);
		expect(final.get()).toBe("false:6");
		expect(seen).toEqual(["false:6"]);

		// 3 → 5: both legs stay the same parity → doubled changes, even
		// stays false. One cb fire.
		base.set(5);
		expect(final.get()).toBe("false:10");
		expect(seen).toEqual(["false:6", "false:10"]);

		// 5 → 4: parity flips → both legs change. One cb fire with the
		// final diamond-resolved value.
		base.set(4);
		expect(final.get()).toBe("true:8");
		expect(seen).toEqual(["false:6", "false:10", "true:8"]);

		unsub();
	});

	it("multi-level conditional with grow-only dep sets and cb-count fidelity", () => {
		// Three-level switch:
		//   level1 = useA ? a : b
		//   level2 = useX ? x : level1.get()
		//   top    = ${level2} + ${meta}
		//
		// Both the level1 and level2 autoTrackNodes grow their dep sets as
		// the branches flip. top has meta as an unrelated dep to stress the
		// "sibling dep must still advance after inner no-op" path. The
		// observer `seen` is the source of truth for correctness.
		const useA = new Signal.State(true);
		const useX = new Signal.State(true);
		const a = new Signal.State("a1");
		const b = new Signal.State("b1");
		const x = new Signal.State("x1");
		const meta = new Signal.State(0);

		const level1 = new Signal.Computed(() => (useA.get() ? a.get() : b.get()));
		const level2 = new Signal.Computed(() => (useX.get() ? x.get() : level1.get()));
		const top = new Signal.Computed(() => `${level2.get()}#${meta.get()}`);

		const seen: string[] = [];
		const unsub = Signal.sub(top, (v) => seen.push(v));

		expect(top.get()).toBe("x1#0");
		expect(seen).toEqual([]);

		// Change unused dep of level2 — top must not fire.
		a.set("a2");
		expect(top.get()).toBe("x1#0");
		expect(seen).toEqual([]);

		// Change the active dep of level2 — top must fire once.
		x.set("x2");
		expect(top.get()).toBe("x2#0");
		expect(seen).toEqual(["x2#0"]);

		// Flip level2's branch. level2 now depends on level1, which still
		// depends on a via useA=true. a.cache is "a2" from earlier.
		useX.set(false);
		expect(top.get()).toBe("a2#0");
		expect(seen).toEqual(["x2#0", "a2#0"]);

		// Change x — no longer used. top stays.
		x.set("x3");
		expect(top.get()).toBe("a2#0");
		expect(seen).toEqual(["x2#0", "a2#0"]);

		// Change a — propagates through level1 → level2 → top.
		a.set("a3");
		expect(top.get()).toBe("a3#0");
		expect(seen).toEqual(["x2#0", "a2#0", "a3#0"]);

		// Flip level1's branch inside level2's chain.
		useA.set(false);
		expect(top.get()).toBe("b1#0");
		expect(seen).toEqual(["x2#0", "a2#0", "a3#0", "b1#0"]);

		// Change a while a is unused at level1 AND x is unused at level2.
		// Neither level1 nor level2 produces new data — no fires at top.
		a.set("a4");
		x.set("x4");
		expect(top.get()).toBe("b1#0");
		expect(seen).toEqual(["x2#0", "a2#0", "a3#0", "b1#0"]);

		// meta (unrelated sibling dep of top) must still fire top.
		meta.set(1);
		expect(top.get()).toBe("b1#1");
		expect(seen).toEqual(["x2#0", "a2#0", "a3#0", "b1#0", "b1#1"]);

		// Flip all the way back to the original shape — values must be
		// the CURRENT ones, not stale snapshots from earlier in the test.
		useX.set(true);
		expect(top.get()).toBe("x4#1"); // x was set to "x4" above
		expect(seen).toEqual(["x2#0", "a2#0", "a3#0", "b1#0", "b1#1", "x4#1"]);

		unsub();
	});

	it("multiple subscribers see the same value and the same fire count", () => {
		// Two independent subscribers attached to the same computed must
		// each see identical values in identical order. This catches
		// "first subscriber gets DATA, second subscriber gets stale push-
		// on-subscribe from a mid-discovery state" bugs.
		const count = new Signal.State(0);
		const doubled = new Signal.Computed(() => count.get() * 2);

		const seenA: number[] = [];
		const seenB: number[] = [];

		const unsubA = Signal.sub(doubled, (v) => seenA.push(v));
		const unsubB = Signal.sub(doubled, (v) => seenB.push(v));

		expect(doubled.get()).toBe(0);
		expect(seenA).toEqual([]);
		expect(seenB).toEqual([]);

		count.set(3);
		expect(doubled.get()).toBe(6);
		expect(seenA).toEqual([6]);
		expect(seenB).toEqual([6]);

		count.set(3); // same value → no fires (equals check in SignalState.set)
		expect(seenA).toEqual([6]);
		expect(seenB).toEqual([6]);

		count.set(7);
		expect(doubled.get()).toBe(14);
		expect(seenA).toEqual([6, 14]);
		expect(seenB).toEqual([6, 14]);

		unsubA();

		count.set(10);
		expect(doubled.get()).toBe(20);
		expect(seenA).toEqual([6, 14]); // A was unsubscribed
		expect(seenB).toEqual([6, 14, 20]);

		unsubB();
	});

	it("subscribe after value already set — initial push is skipped, subsequent changes fire", () => {
		// Signal.sub's contract: initial push-on-subscribe is skipped, so a
		// subscriber attached to an already-settled node should see zero
		// fires until the next real change.
		const count = new Signal.State(5);
		const doubled = new Signal.Computed(() => count.get() * 2);

		expect(doubled.get()).toBe(10); // warm up via pull

		const seen: number[] = [];
		const unsub = Signal.sub(doubled, (v) => seen.push(v));

		// Attachment — no fire.
		expect(seen).toEqual([]);

		count.set(6);
		expect(seen).toEqual([12]);

		count.set(6); // no-op
		expect(seen).toEqual([12]);

		count.set(7);
		expect(seen).toEqual([12, 14]);

		unsub();
	});

	it("nested computed re-computes correctly across multiple updates", () => {
		// Chain: count → doubled → quadrupled → formatted
		// Each level is its own autoTrackNode. A change at count should
		// yield exactly one fire at formatted with the final value.
		const count = new Signal.State(1);
		const doubled = new Signal.Computed(() => count.get() * 2);
		const quadrupled = new Signal.Computed(() => doubled.get() * 2);
		const formatted = new Signal.Computed(() => `v=${quadrupled.get()}`);

		const seen: string[] = [];
		const unsub = Signal.sub(formatted, (v) => seen.push(v));

		expect(formatted.get()).toBe("v=4");
		expect(seen).toEqual([]);

		count.set(2);
		expect(formatted.get()).toBe("v=8");
		expect(seen).toEqual(["v=8"]);

		count.set(3);
		expect(formatted.get()).toBe("v=12");
		expect(seen).toEqual(["v=8", "v=12"]);

		// Setting same value — equals check should block fire at the
		// source, so the chain should see nothing.
		count.set(3);
		expect(seen).toEqual(["v=8", "v=12"]);

		count.set(0);
		expect(formatted.get()).toBe("v=0");
		expect(seen).toEqual(["v=8", "v=12", "v=0"]);

		unsub();
	});

	it("equality at the middle of a chain absorbs upstream churn", () => {
		// bucket = Math.floor(raw / 10)  — stays at 1 as raw goes 10..19
		// label  = bucket === 1 ? "one" : "other"
		// Both mid-chain nodes absorb upstream churn via equals-based
		// RESOLVED framing. The subscriber at `label` must fire only when
		// the label actually changes.
		const raw = new Signal.State(12);
		const bucket = new Signal.Computed(() => Math.floor(raw.get() / 10));
		const label = new Signal.Computed(() => (bucket.get() === 1 ? "one" : "other"));

		const seen: string[] = [];
		const unsub = Signal.sub(label, (v) => seen.push(v));

		expect(label.get()).toBe("one");
		expect(seen).toEqual([]);

		// Churn within bucket 1 — label must stay silent.
		for (const v of [10, 13, 17, 19, 15, 11]) {
			raw.set(v);
			expect(label.get()).toBe("one");
		}
		expect(seen).toEqual([]);

		// Cross bucket boundary — label flips to "other" once.
		raw.set(25);
		expect(label.get()).toBe("other");
		expect(seen).toEqual(["other"]);

		// More churn within bucket 2 — label stays "other".
		raw.set(22);
		raw.set(28);
		expect(seen).toEqual(["other"]);

		// Back to bucket 1 — label fires once.
		raw.set(15);
		expect(label.get()).toBe("one");
		expect(seen).toEqual(["other", "one"]);

		// Bucket 3 — "other" again.
		raw.set(33);
		expect(label.get()).toBe("other");
		expect(seen).toEqual(["other", "one", "other"]);

		unsub();
	});

	it("cb arguments survive rapid in-place updates", () => {
		// Rapid-fire updates should produce exactly one cb per call (no
		// coalescing beyond the equals check, no dropped updates).
		const count = new Signal.State(0);

		const seen: number[] = [];
		const unsub = Signal.sub(count, (v) => seen.push(v));

		const values = [1, 2, 3, 4, 5, 5, 5, 6, 6, 7];
		for (const v of values) count.set(v);

		// Equals check deduplicates consecutive same values at the source.
		expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(count.get()).toBe(7);

		unsub();
	});

	it("derived over two independent states fires once per single-state update", () => {
		const a = new Signal.State(1);
		const b = new Signal.State(10);
		const sum = new Signal.Computed(() => a.get() + b.get());

		const seen: number[] = [];
		const unsub = Signal.sub(sum, (v) => seen.push(v));

		expect(sum.get()).toBe(11);
		expect(seen).toEqual([]);

		a.set(2);
		expect(sum.get()).toBe(12);
		expect(seen).toEqual([12]);

		b.set(20);
		expect(sum.get()).toBe(22);
		expect(seen).toEqual([12, 22]);

		// Set a to a new value that yields the same sum — the sum must
		// still be recomputed once and, if the result is identical, the
		// subscriber must NOT fire.
		a.set(2); // no-op on a
		b.set(20); // no-op on b
		expect(seen).toEqual([12, 22]);

		// Change a and b independently — since jotai/signals compat does
		// NOT batch external set calls, we should see two separate fires,
		// including when we bounce through an intermediate 25 and back
		// to 22. The cache is 22 right before a.set(5), then becomes 25
		// after a.set(5), then becomes 22 again after b.set(17) — each
		// transition differs from the prior cache so each fires DATA.
		a.set(5); // sum transitions 22 → 25
		b.set(17); // sum transitions 25 → 22
		expect(sum.get()).toBe(22);
		expect(seen).toEqual([12, 22, 25, 22]);

		unsub();
	});

	it("two-way bridge: native Node observing a Signal.Computed also sees correct cb count", () => {
		// Bonus: the compat-Signal object is backed by a real Node
		// accessible via ._node. A native derived() atop it should receive
		// the same wave-correct sequence of values as a compat subscriber.
		//
		// This is the two-way bridge guarantee: stage-2 users who compose
		// compat signals into a native graphrefly graph see the same
		// semantics that pure-compat users see.
		const count = new Signal.State(1);
		const computed = new Signal.Computed(() => count.get() * 2);

		// Native graphrefly subscription over the Signal's backing node.
		// A native subscriber observes the raw wave, but filtered to DATA
		// it should see the same value sequence the compat subscribe sees
		// (plus the push-on-subscribe replay of the cached value, which
		// Signal.sub filters out via its `initial = true` guard).
		const nativeSeen: number[] = [];
		const unsub = computed._node.subscribe((msgs) => {
			for (const [t, v] of msgs) {
				if (t === DATA) nativeSeen.push(v as number);
			}
		});

		// Push-on-subscribe delivers initial value as DATA.
		expect(nativeSeen).toEqual([2]);

		count.set(3);
		expect(nativeSeen).toEqual([2, 6]);

		count.set(3); // same value → RESOLVED → not in nativeSeen
		expect(nativeSeen).toEqual([2, 6]);

		count.set(5);
		expect(nativeSeen).toEqual([2, 6, 10]);

		unsub();
	});
});
