/**
 * Phase 13.8 — exploratory integration tests for `_setDeps` / `_rewire`.
 *
 * Goal is gap-finding, NOT API validation. Every scenario corresponds to
 * an interaction surface the M1 Rust substrate impl can't exercise. Test
 * outcomes (pass/fail/surprise) feed into `docs/research/rewire-gap-findings.md`.
 *
 * Source: `docs/implementation-plan.md` §Phase 13.8 + design notes
 * `docs/research/rewire-design-notes.md`.
 */

import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { COMPLETE, DATA, DIRTY, INVALIDATE, PAUSE, RESUME, TEARDOWN } from "../../core/messages.js";
import type { NodeFn, NodeImpl } from "../../core/node.js";
import { node } from "../../core/node.js";

// Test-only helper: the substrate `_setDeps` requires `fn` at every call site
// to enforce explicit fn-deps pairing (Phase 13.8 lock). Tests that don't
// intend to swap fn pass `undefined` here and the helper retrieves the current
// `_fn` from the node — pragmatic test ergonomics. Tests that DO swap fn pass
// a fresh NodeFn.
const setDeps = (n: unknown, deps: readonly unknown[], fn?: NodeFn): void => {
	const impl = n as NodeImpl;
	impl._setDeps(deps as Parameters<NodeImpl["_setDeps"]>[0], fn ?? (impl._fn as NodeFn));
};

// Test-only no-op fn for guard-rejection paths where the fn argument never runs.
const noopFn: NodeFn = () => {};

describe("Phase 13.8 — _setDeps integration scenarios", () => {
	// ─────────────────────────────────────────────────────────────────────
	// Baseline: validate the substrate works on the simplest topology
	// ─────────────────────────────────────────────────────────────────────

	it("baseline: rewire from {A} to {B} swaps values; cache preserved through rewire window", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit(((v as number) ?? 0) * 10);
		});
		const seen: unknown[] = [];
		const unsub = c.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) seen.push(m[1]);
		});

		// Initial wave: c sees a=1 → 10
		expect(c.cache).toBe(10);

		// Rewire to b. c.cache is preserved ACROSS rewire window per Q7;
		// resubscribe handshake delivers [[START], [DATA, 2]] → fires fn → 20.
		setDeps(c, [b]);
		expect(c.cache).toBe(20);
		expect(seen).toEqual([10, 20]);
		unsub();
	});

	it("rejects self-rewire with a clear error", () => {
		const a = node<number>({ initial: 1 });
		const c = node([a], (data, actions) => {
			actions.emit((data[0]?.[0] as number) ?? 0);
		});
		c.subscribe(() => {});
		expect(() => setDeps(c, [c])).toThrowError(/self-dependency/);
	});

	it("rejects cycle introduction via DFS through transitive _deps", () => {
		const a = node<number>({ initial: 1 });
		const b = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit(((v as number) ?? 0) + 1);
		});
		const c = node([b], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit(((v as number) ?? 0) * 2);
		});
		c.subscribe(() => {});
		// b→a, c→b, so b transitively depends on a. Trying to make a depend on
		// c would close cycle a→c→b→a.
		expect(() => setDeps(a, [c])).toThrowError(/would create cycle/);
	});

	it("idempotent: rewire to identical dep set is a no-op (kept deps untouched, fn does not re-fire)", () => {
		const a = node<number>({ initial: 1 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit(((v as number) ?? 0) * 10);
		});
		const seen: unknown[] = [];
		c.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) seen.push(m[1]);
		});
		expect(c.cache).toBe(10);

		// Surgical lock: same dep set → no removed/added → kept dep `a` is
		// untouched. No resubscribe, no push-on-subscribe replay, no fn
		// re-fire. Cache preserved. The only initial DATA seen is from
		// activation; nothing further.
		setDeps(c, [a]);
		expect(c.cache).toBe(10);
		expect(seen).toEqual([10]);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario 1 — rewire mid-batch
	// ─────────────────────────────────────────────────────────────────────

	it("scenario 1: rewire inside batch — topology change consistent with batched downstream emits", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 100 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) ?? 0);
		});
		const seen: unknown[] = [];
		c.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) seen.push(m[1]);
		});
		expect(c.cache).toBe(1);

		batch(() => {
			a.down([[DATA, 2]]);
			// rewire mid-batch — c switches from {a} to {b}.
			setDeps(c, [b]);
		});

		// Final state: c is now wired to b=100. The mid-batch a=2 emit went
		// into c's old DepRecord which got discarded by rewire.
		expect(c.cache).toBe(100);
		expect(seen.at(-1)).toBe(100);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario 2 — rewire × INVALIDATE same wave
	// ─────────────────────────────────────────────────────────────────────

	it("scenario 2: INVALIDATE then rewire — INVALIDATE clears cache, rewire to fresh dep populates", () => {
		const a = node<number>({ initial: 5 });
		const b = node<number>({ initial: 50 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 2);
		});
		const seen: { tag: symbol; value?: unknown }[] = [];
		c.subscribe((msgs) => {
			for (const m of msgs) seen.push({ tag: m[0] as symbol, value: m[1] });
		});
		expect(c.cache).toBe(10);

		// INVALIDATE c via dep — clears c._cached.
		a.down([[INVALIDATE]]);
		expect(c.cache).toBeUndefined();

		// Rewire to b. Cache was cleared by INVALIDATE; resubscribe handshake
		// delivers b=50 → fn → 100. End state: cache populated, no stale
		// INVALIDATE artifact.
		setDeps(c, [b]);
		expect(c.cache).toBe(100);

		// INVALIDATE was visible in stream; final DATA is post-rewire 100.
		const tags = seen.map((e) => e.tag);
		expect(tags).toContain(INVALIDATE);
		expect(seen.findLast((e) => e.tag === DATA)?.value).toBe(100);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario 3 — rewire while paused
	// ─────────────────────────────────────────────────────────────────────

	it("scenario 3: rewire while paused — pause locks preserved; RESUME drains correctly post-rewire", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 99 });
		const c = node(
			[a],
			(data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit((v as number) * 10);
			},
			{ pausable: "resumeAll" },
		);
		const seen: { tag: symbol; value?: unknown }[] = [];
		c.subscribe((msgs) => {
			for (const m of msgs) seen.push({ tag: m[0] as symbol, value: m[1] });
		});
		expect(c.cache).toBe(10);

		const lockId = Symbol("L");
		c.down([[PAUSE, lockId]]);

		// Rewire while paused — pause lockset preserved per Q3.
		setDeps(c, [b]);

		// Still paused — even though we connected a new dep, c shouldn't
		// fire fn while paused (resumeAll buffers settle-tier emissions).
		// Cache was preserved through rewire (Q7); fn re-fires after
		// resubscribe but its emit is buffered.
		expect((c as unknown as NodeImpl)._paused).toBe(true);

		c.down([[RESUME, lockId]]);
		expect((c as unknown as NodeImpl)._paused).toBe(false);

		// After RESUME the buffered post-rewire wave drained. b=99 → fn → 990.
		expect(c.cache).toBe(990);
		expect(seen.findLast((e) => e.tag === DATA)?.value).toBe(990);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario 4 — rewire × TEARDOWN cascade
	// ─────────────────────────────────────────────────────────────────────

	it("scenario 4: rewire on terminal node REJECTED with clear error", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});
		c.down([[COMPLETE]]);
		expect(c.status).toBe("completed");
		expect(() => setDeps(c, [b])).toThrowError(/terminal state/);
	});

	it("scenario 4b: TEARDOWN on a removed-dep does NOT cascade to rewired node", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(10);

		// Rewire c off of a, onto b.
		setDeps(c, [b]);
		expect(c.cache).toBe(20);

		// TEARDOWN on a. After rewire a is no longer a dep of c, so this
		// MUST NOT propagate to c.
		a.down([[TEARDOWN]]);
		expect(c.status).not.toBe("completed");
		expect(c.cache).toBe(20);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario 5 — rewire × non-empty replay buffer
	// ─────────────────────────────────────────────────────────────────────

	it("scenario 5: replay buffer on N is preserved across rewire", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 100 });
		const c = node(
			[a],
			(data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit((v as number) * 10);
			},
			{ replayBuffer: 5 },
		);
		c.subscribe(() => {});
		a.down([[DATA, 2]]);
		a.down([[DATA, 3]]);
		// Replay buffer of c should now contain its OUTGOING history: 10, 20, 30.
		const cBuf = (c as unknown as NodeImpl)._replayBuffer;
		expect(cBuf).toEqual([10, 20, 30]);

		setDeps(c, [b]);
		// After full disconnect/resubscribe, c re-fires off b=100 → 1000.
		// Replay buffer preserved AND extended with the new emission.
		const cBufAfter = (c as unknown as NodeImpl)._replayBuffer;
		expect(cBufAfter?.at(-1)).toBe(1000);
		expect((cBufAfter ?? []).slice(0, 3)).toEqual([10, 20, 30]);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario 6 — rewire × meta companions
	// ─────────────────────────────────────────────────────────────────────

	it("scenario 6: rewire does not disturb meta companions on N", () => {
		// `meta` builds child state nodes from initial values (per
		// node.ts:933 `meta[k] = new NodeImpl([], undefined, { initial: v, ... })`).
		// We capture the meta companion identity pre-rewire and assert it
		// (a) survives rewire intact, (b) keeps its cached value, (c) stays
		// reachable on the parent at the same key.
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node(
			[a],
			(data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit((v as number) * 10);
			},
			{ meta: { status: "alive" } },
		);
		c.subscribe(() => {});
		const metaBefore = c.meta.status;
		expect(metaBefore.cache).toBe("alive");

		setDeps(c, [b]);

		// Meta unaffected — rewire only touches `_deps`, not `meta`.
		expect(c.meta.status).toBe(metaBefore);
		expect(c.meta.status.cache).toBe("alive");
		expect(c.cache).toBe(20);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario 7 — rewire × dep COMPLETE/ERROR
	// ─────────────────────────────────────────────────────────────────────

	it("scenario 7: rewire AWAY from a COMPLETED dep — N stays live, no auto-complete cascade", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(10);

		// COMPLETE a — but c hasn't received it yet because we'll rewire first.
		// Actually the emit is synchronous, so we need to be careful here.
		// Pre-rewire emit COMPLETE on a — c receives it, dep.terminal set,
		// auto-complete fires because c has only one dep and it's done.
		// To test "rewire AWAY from completed dep doesn't propagate" we need
		// the dep to complete BEFORE c subscribes to it... which doesn't apply
		// here since c was already subscribed.
		//
		// Instead: rewire c to b, THEN complete a (the now-removed dep).
		setDeps(c, [b]);
		a.down([[COMPLETE]]);
		expect(c.status).not.toBe("completed");
		expect(c.cache).toBe(20);
	});

	it("scenario 7b: rewire TO a terminal non-resubscribable dep — REJECTED (Q1 lock 2026-05-04)", () => {
		const aTerm = node<number>({ initial: 1 });
		aTerm.subscribe(() => {});
		aTerm.down([[COMPLETE]]);
		expect(aTerm.status).toBe("completed");

		const live = node<number>({ initial: 5 });
		const c = node([live], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(50);

		// Phase 13.8 Q1 lock: substrate rejects this with a clear error
		// instead of silently producing a wedge state.
		expect(() => setDeps(c, [aTerm])).toThrowError(/non-resubscribable terminal dep/);

		// c's prior wiring is intact — failed _setDeps did not mutate state.
		expect(c.cache).toBe(50);
	});

	it("scenario 7c: rewire TO a resubscribable terminal dep — ALLOWED, dep resets via subscribe handshake", () => {
		// A resubscribable terminal dep can be added: subscribe() triggers
		// `_resetForFreshLifecycle` on it, putting it in a clean sentinel
		// state for the new edge.
		const aTerm = node<number>({ initial: 1, resubscribable: true });
		aTerm.subscribe(() => {});
		aTerm.down([[COMPLETE]]);
		expect(aTerm.status).toBe("completed");

		const c = node<number>(
			[],
			(data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit(((v as number) ?? 0) * 10);
			},
			{ describeKind: "derived" },
		);
		c.subscribe(() => {});

		// Adding aTerm via _setDeps should NOT throw — it's resubscribable.
		expect(() => setDeps(c, [aTerm])).not.toThrow();
		// After rewire, aTerm has been re-armed via subscribe →
		// `_resetForFreshLifecycle` (clears cache, sets status to sentinel),
		// then subscribe's "activated but no value yet" reflector transitions
		// status to "pending" (the live re-armed lifecycle).
		expect(aTerm.status).toBe("pending");
		// aTerm now needs a fresh emission to drive c.
		aTerm.down([[DATA, 7]]);
		expect(c.cache).toBe(70);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario 8 — rewire × resubscribable terminal-reset in flight
	// ─────────────────────────────────────────────────────────────────────

	it("scenario 8: resubscribable node post-COMPLETE then INVALIDATE-reset then rewire — clean re-arm", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 100 });
		const c = node(
			[a],
			(data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit((v as number) * 10);
			},
			{ resubscribable: true },
		);
		c.subscribe(() => {});
		expect(c.cache).toBe(10);

		// Drive c into completed via dep COMPLETE → c auto-completes.
		a.down([[COMPLETE]]);
		expect(c.status).toBe("completed");
		// On a resubscribable node, INVALIDATE triggers _resetForFreshLifecycle.
		c.down([[INVALIDATE]]);
		// After reset, status returns to sentinel; dep records reset; cache cleared.
		expect(c.status).toBe("sentinel");

		// Now rewire to b. Substrate path: full disconnect of (resetted) old
		// deps, fresh resubscribe to b. This exercises the post-reset
		// resubscribe path.
		setDeps(c, [b]);
		// b is live → fn fires → c.cache = 1000.
		expect(c.cache).toBe(1000);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario 9 — covered by the graph-layer rewire-mock-harness test;
	// _setDeps substrate is graph-agnostic. See rewire-mock-harness.test.ts.
	// ─────────────────────────────────────────────────────────────────────

	// ─────────────────────────────────────────────────────────────────────
	// Extra exploratory cases — surfaced from full-disconnect/resubscribe
	// ─────────────────────────────────────────────────────────────────────

	it("rewire on inactive node (no subscribers) just swaps _deps without resubscribing", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		// No subscribe → c is inactive.
		expect((c as unknown as NodeImpl)._sinks).toBeNull();

		setDeps(c, [b]);
		const deps = (c as unknown as NodeImpl)._deps.map((d) => d.node);
		expect(deps).toEqual([b]);
		// No subscription was wired (deferred to _activate).
		expect((c as unknown as NodeImpl)._deps[0].unsub).toBeNull();
	});

	it("rewire to empty deps {} leaves N as a degenerate fn-with-no-deps shape; cache preserved", () => {
		const a = node<number>({ initial: 7 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(70);

		setDeps(c, []);
		// No deps → _activate's empty-deps branch fires fn ONCE if a producer.
		// But c is a derived (has fn AND had deps); _setDeps doesn't re-run
		// _activate's empty-deps branch. Cache preserved per Q7; fn does
		// not re-fire because no dep delivers DATA. This is consistent with
		// design notes: "M1 should treat this as a degenerate state, not
		// auto-deactivate."
		expect(c.cache).toBe(70);
		expect((c as unknown as NodeImpl)._deps).toEqual([]);
	});

	it("rewire dedupes new dep set by reference identity", () => {
		const a = node<number>({ initial: 1 });
		const c = node<number>([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});
		setDeps(c, [a, a, a]);
		expect((c as unknown as NodeImpl)._deps.length).toBe(1);
		expect(c.cache).toBe(10);
	});

	it("rewire preserves _hasCalledFnOnce — first-run gate not re-armed (Q2)", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});
		expect((c as unknown as NodeImpl)._hasCalledFnOnce).toBe(true);

		setDeps(c, [b]);
		// The flag stays true across rewire: if it were reset, the first-run
		// gate would re-engage and (with full disconnect) the new dep would
		// have to re-deliver before fn could fire. But push-on-subscribe
		// from b={initial:2} satisfies the gate immediately so this is
		// behaviorally indistinguishable in this specific topology — the
		// invariant is that the flag stays true.
		expect((c as unknown as NodeImpl)._hasCalledFnOnce).toBe(true);
		expect(c.cache).toBe(20);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Surgical-mode-specific invariants
	// ─────────────────────────────────────────────────────────────────────

	it("surgical: kept dep's DepRecord state (prevData, dataBatch) carries through verbatim", () => {
		const a = node<number>({ initial: 7 });
		const b = node<number>({ initial: 100 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(70);

		// Snapshot the kept dep's DepRecord BEFORE rewire.
		const beforeRec = (c as unknown as NodeImpl)._deps[0];
		const beforeUnsub = beforeRec.unsub;
		const beforePrevData = beforeRec.prevData;

		// Append b — kept dep is `a` at index 0, added is `b` at index 1.
		setDeps(c, [a, b]);

		// Same DepRecord object identity — proves we did NOT recreate it.
		const afterRec = (c as unknown as NodeImpl)._deps[0];
		expect(afterRec).toBe(beforeRec);
		// Unsub function is the same — subscription was not re-issued.
		expect(afterRec.unsub).toBe(beforeUnsub);
		// prevData is the same value (untouched).
		expect(afterRec.prevData).toBe(beforePrevData);
	});

	it("surgical: kept dep does NOT see an unsub-then-resub on its sinks", () => {
		// We can't directly observe the dep's sinks set, but we can prove
		// no resubscribe happened by counting fn fires. With surgical mode,
		// adding a new dep to N should NOT cause N's fn to re-fire from
		// kept deps — it only fires when the NEW dep settles.
		const a = node<number>({ initial: 5 });
		const b = node<number>({ initial: 10 });
		let fnFireCount = 0;
		const c = node([a], (data, actions, ctx) => {
			fnFireCount++;
			const av = data[0]?.[0] ?? ctx.prevData[0];
			const bv = data[1]?.[0] ?? ctx.prevData[1];
			actions.emit(((av as number) ?? 0) + ((bv as number) ?? 0));
		});
		c.subscribe(() => {});
		expect(fnFireCount).toBe(1); // initial wave fired once
		expect(c.cache).toBe(5);

		// Append b. Surgical: a is untouched. fn fires ONCE more for the
		// added dep b's settlement. (Full-disconnect would have caused 2
		// fires — once on each kept-dep handshake replay.)
		setDeps(c, [a, b]);
		expect(fnFireCount).toBe(2);
		expect(c.cache).toBe(15);
	});

	it("surgical: tail-removal preserves remaining kept deps' DepRecord identity", () => {
		const a = node<number>({ initial: 3 });
		const b = node<number>({ initial: 4 });
		const c = node([a, b], (data, actions, ctx) => {
			const av = data[0]?.[0] ?? ctx.prevData[0];
			const bv = data[1]?.[0] ?? ctx.prevData[1];
			actions.emit(((av as number) ?? 0) * ((bv as number) ?? 0));
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(12);

		const beforeRecA = (c as unknown as NodeImpl)._deps[0];
		// Tail-remove: drop `b`. `a` stays at index 0.
		setDeps(c, [a]);
		const afterRecA = (c as unknown as NodeImpl)._deps[0];
		expect(afterRecA).toBe(beforeRecA);
		expect((c as unknown as NodeImpl)._deps).toHaveLength(1);
		// fn fires (or doesn't) per the auto-settle path — test that node is alive.
		expect(c.status).not.toBe("completed");
	});

	// ─────────────────────────────────────────────────────────────────────
	// Reorder + interior-remove (Option C: DepRecord-ref-keyed dispatch)
	// ─────────────────────────────────────────────────────────────────────
	//
	// Subscription callbacks bind to the DepRecord reference; index is
	// looked up dynamically via `_deps.indexOf(record)` at dispatch time.
	// Kept deps may shift position freely without re-subscribing.

	it("reorder: swap [a, b] → [b, a] preserves both DepRecords; kept deps don't re-subscribe", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node([a, b], (data, actions, ctx) => {
			const av = data[0]?.[0] ?? ctx.prevData[0];
			const bv = data[1]?.[0] ?? ctx.prevData[1];
			actions.emit(((av as number) ?? 0) * 100 + ((bv as number) ?? 0));
		});
		c.subscribe(() => {});
		// Initial wave: a=1 (idx 0), b=2 (idx 1) → 1*100+2 = 102
		expect(c.cache).toBe(102);

		const beforeRecA = (c as unknown as NodeImpl)._deps[0];
		const beforeRecB = (c as unknown as NodeImpl)._deps[1];
		const beforeUnsubA = beforeRecA.unsub;
		const beforeUnsubB = beforeRecB.unsub;

		// Swap: now b is at idx 0, a is at idx 1.
		setDeps(c, [b, a]);

		// Same DepRecord objects (kept deps preserved).
		const afterRecB = (c as unknown as NodeImpl)._deps[0];
		const afterRecA = (c as unknown as NodeImpl)._deps[1];
		expect(afterRecB).toBe(beforeRecB);
		expect(afterRecA).toBe(beforeRecA);
		// Subscriptions unchanged (no resub).
		expect(afterRecB.unsub).toBe(beforeUnsubB);
		expect(afterRecA.unsub).toBe(beforeUnsubA);

		// Now drive a new value through `a` — fn should see a at idx 1
		// (per the new ordering), not idx 0.
		a.down([[DATA, 5]]);
		// fn: data[0]=b's batch (no new data this wave) prevData[0]=2; data[1]=a's batch [5].
		// Result: 2*100 + 5 = 205.
		expect(c.cache).toBe(205);
	});

	it("interior-remove: [a, b, cdep] → [a, cdep] preserves cdep's DepRecord", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const cdep = node<number>({ initial: 3 });
		const sink = node([a, b, cdep], (data, actions, ctx) => {
			const av = data[0]?.[0] ?? ctx.prevData[0];
			const bv = data[1]?.[0] ?? ctx.prevData[1];
			const cv = data[2]?.[0] ?? ctx.prevData[2];
			actions.emit(((av as number) ?? 0) + ((bv as number) ?? 0) + ((cv as number) ?? 0));
		});
		sink.subscribe(() => {});
		expect(sink.cache).toBe(6);

		const beforeRecCdep = (sink as unknown as NodeImpl)._deps[2];
		const beforeUnsubCdep = beforeRecCdep.unsub;

		// Drop b. Kept cdep shifts from idx 2 to idx 1.
		setDeps(sink, [a, cdep]);

		// cdep's DepRecord identity preserved across the shift.
		const afterRecCdep = (sink as unknown as NodeImpl)._deps[1];
		expect(afterRecCdep).toBe(beforeRecCdep);
		expect(afterRecCdep.unsub).toBe(beforeUnsubCdep);

		// Drive new DATA through cdep — fn sees it at the new index 1.
		cdep.down([[DATA, 10]]);
		// fn: data[0]=a's batch (none) prevData[0]=1; data[1]=cdep's batch [10] → 1+10=11.
		expect(sink.cache).toBe(11);
	});

	it("two-step rebuild also works for callers who prefer explicit clear-then-rebuild", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node([a, b], (data, actions, ctx) => {
			const av = data[0]?.[0] ?? ctx.prevData[0];
			const bv = data[1]?.[0] ?? ctx.prevData[1];
			actions.emit(((av as number) ?? 0) + ((bv as number) ?? 0));
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(3);

		// Step 1: clear all deps (cache preserved per Q7).
		setDeps(c, []);
		expect(c.cache).toBe(3);

		// Step 2: rebuild in different order. Both are "added" — fresh DepRecords.
		setDeps(c, [b, a]);
		expect((c as unknown as NodeImpl)._deps[0].node).toBe(b);
		expect((c as unknown as NodeImpl)._deps[1].node).toBe(a);
	});

	// ─────────────────────────────────────────────────────────────────────
	// opts.fn — fn replacement at rewire time
	// ─────────────────────────────────────────────────────────────────────

	it("opts.fn: rewire with new fn that handles the new dep shape", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node([a, b], (data, actions, ctx) => {
			const av = data[0]?.[0] ?? ctx.prevData[0];
			const bv = data[1]?.[0] ?? ctx.prevData[1];
			actions.emit(((av as number) ?? 0) * 10 + ((bv as number) ?? 0));
		});
		c.subscribe(() => {});
		// Initial: a*10 + b = 12
		expect(c.cache).toBe(12);

		// Swap order [a, b] → [b, a] AND swap fn so user-visible computation
		// stays a*10 + b (now reading from new positions).
		(c as unknown as NodeImpl)._setDeps([b, a], (data, actions, ctx) => {
			const bv = data[0]?.[0] ?? ctx.prevData[0];
			const av = data[1]?.[0] ?? ctx.prevData[1];
			actions.emit(((av as number) ?? 0) * 10 + ((bv as number) ?? 0));
		});

		// Drive a fresh wave through `a` (now at index 1).
		a.down([[DATA, 5]]);
		// New fn: a*10 + b = 5*10 + 2 = 52
		expect(c.cache).toBe(52);
	});

	it("opts.fn: pure fn swap — same dep set, new fn", () => {
		const a = node<number>({ initial: 7 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(70);

		// Swap fn only; dep set unchanged. Cache preserved per Q7.
		(c as unknown as NodeImpl)._setDeps([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) + 100);
		});

		// Trigger a fresh wave through `a`. New fn runs.
		a.down([[DATA, 5]]);
		expect(c.cache).toBe(105); // 5 + 100, not 5 * 10
	});

	it("opts.fn: old cleanup's onRerun fires once when fn is swapped, before new fn runs", () => {
		const a = node<number>({ initial: 1 });
		let oldRerunFired = 0;
		let newRerunFired = 0;
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 2);
			return { onRerun: () => oldRerunFired++ };
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(2);
		// Initial run: onRerun was set but hasn't fired yet (first run, no prior).
		expect(oldRerunFired).toBe(0);

		(c as unknown as NodeImpl)._setDeps([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) + 1000);
			return { onRerun: () => newRerunFired++ };
		});

		// Drive a fresh wave. Should fire OLD onRerun (clean wrap-up of last
		// old-fn run), then run new fn (which sets new cleanup).
		a.down([[DATA, 5]]);
		expect(oldRerunFired).toBe(1);
		expect(newRerunFired).toBe(0); // new onRerun wasn't fired (it's the LATEST cleanup, fires next time)
		expect(c.cache).toBe(1005);

		// Drive another wave — now NEW fn's onRerun fires.
		a.down([[DATA, 6]]);
		expect(oldRerunFired).toBe(1); // didn't fire again
		expect(newRerunFired).toBe(1);
		expect(c.cache).toBe(1006);
	});

	it("opts.fn: _addDep with new fn — appended slot consumed by replacement fn", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 100 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(10);

		// Append b AND swap fn to consume both deps.
		(c as unknown as NodeImpl)._addDep(b, (data, actions, ctx) => {
			const av = data[0]?.[0] ?? ctx.prevData[0];
			const bv = data[1]?.[0] ?? ctx.prevData[1];
			actions.emit(((av as number) ?? 0) + ((bv as number) ?? 0));
		});

		// New fn fires once b's handshake delivers — a + b = 1 + 100 = 101.
		expect(c.cache).toBe(101);
	});

	// ─────────────────────────────────────────────────────────────────────
	// _addDep guards (Phase 13.8 QA — symmetric with _setDeps)
	// ─────────────────────────────────────────────────────────────────────

	it("_addDep rejects non-resubscribable terminal dep (Q1)", () => {
		const aTerm = node<number>({ initial: 1 });
		aTerm.subscribe(() => {});
		aTerm.down([[COMPLETE]]);
		expect(aTerm.status).toBe("completed");

		const c = node<number>({ initial: 5 });
		c.subscribe(() => {});

		expect(() => (c as unknown as NodeImpl)._addDep(aTerm, noopFn)).toThrowError(
			/non-resubscribable terminal dep/,
		);
	});

	it("_addDep allows resubscribable terminal dep (re-arms via subscribe handshake)", () => {
		const aTerm = node<number>({ initial: 1, resubscribable: true });
		aTerm.subscribe(() => {});
		aTerm.down([[COMPLETE]]);
		expect(aTerm.status).toBe("completed");

		const c = node<number>(
			[],
			(data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit(((v as number) ?? 0) * 10);
			},
			{ describeKind: "derived" },
		);
		c.subscribe(() => {});

		// Same fn — still required at API; this is a fn-preservation rewire.
		const cFn = (c as unknown as NodeImpl)._fn as NodeFn;
		expect(() => (c as unknown as NodeImpl)._addDep(aTerm, cFn)).not.toThrow();
		expect(aTerm.status).toBe("pending");
	});

	it("_addDep rejects on terminal `this`", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});
		c.down([[COMPLETE]]);
		expect(c.status).toBe("completed");

		expect(() => (c as unknown as NodeImpl)._addDep(b, noopFn)).toThrowError(/terminal state/);
	});

	it("_addDep rejects self-dependency", () => {
		const a = node<number>({ initial: 1 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});

		expect(() => (c as unknown as NodeImpl)._addDep(c, noopFn)).toThrowError(/self-dependency/);
	});

	it("_addDep rejects cycle introduction", () => {
		const a = node<number>({ initial: 1 });
		const b = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit(((v as number) ?? 0) + 1);
		});
		b.subscribe(() => {});
		// Try to make `a` depend on `b` — would close cycle a→b→a.
		expect(() => (a as unknown as NodeImpl)._addDep(b, noopFn)).toThrowError(/would create cycle/);
	});

	it("_addDep rejects mid-fn (with autoTrackNode escape hatch via _addDepInternal)", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
			// Try to mutate deps mid-fn — public _addDep should reject.
			try {
				(c as unknown as NodeImpl)._addDep(b, noopFn);
			} catch (err) {
				ctx.store.midFnAddDepError = (err as Error).message;
			}
		});
		c.subscribe(() => {});
		// fn ran, error captured.
		expect((c as unknown as NodeImpl)._store.midFnAddDepError).toMatch(/mid-fn/);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Reentrancy guard (Phase 13.8 QA C — _inDepMutation)
	// ─────────────────────────────────────────────────────────────────────

	it("reentrancy: _setDeps re-entry from a DIRTY subscriber callback rejects with clear error", () => {
		// Construct a subscriber that fires _setDeps on DIRTY (which arrives
		// during _setDeps's emit-DIRTY phase, BEFORE _isExecutingFn is set).
		// This isolates the `_inDepMutation` guard from the `_isExecutingFn`
		// guard.
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});

		let reentrantError: string | undefined;
		c.subscribe((msgs) => {
			if (reentrantError) return; // capture first only
			for (const m of msgs) {
				if (m[0] === DIRTY) {
					try {
						(c as unknown as NodeImpl)._setDeps([b], noopFn);
					} catch (err) {
						reentrantError = (err as Error).message;
						return;
					}
				}
			}
		});

		// Trigger a fresh DIRTY wave on c by emitting DATA on a. This causes
		// c's status to go dirty and emit DIRTY downstream → subscriber
		// callback fires re-entrantly. At this moment _setDeps is not in
		// flight (we're inside the dep-message dispatch, not _setDeps), so
		// this case actually checks an UNRELATED reentrancy scenario.
		a.down([[DATA, 5]]);
		// Without an outer _setDeps in flight, the reentrant call may not
		// trigger the _inDepMutation guard. Documenting this fragility:
		// reentrancy guard fires when _setDeps/_addDep/_removeDep is in
		// flight. The above scenario is not in that state.

		// Direct test: trigger reentrancy DURING _setDeps's emit-DIRTY phase.
		// When _setDeps emits DIRTY downstream, c's subscriber fires; if it
		// calls back into _setDeps, the outer _setDeps is still in flight
		// (`_inDepMutation === true`).
		const c2 = node<number>({ initial: 0 });
		let outerSetDepsReentrantError: string | undefined;
		c2.subscribe((msgs) => {
			if (outerSetDepsReentrantError) return;
			for (const m of msgs) {
				if (m[0] === DIRTY) {
					try {
						(c2 as unknown as NodeImpl)._setDeps([b], noopFn);
					} catch (err) {
						outerSetDepsReentrantError = (err as Error).message;
						return;
					}
				}
			}
		});
		// Now call _setDeps on c2. It emits DIRTY downstream → subscriber
		// fires reentrantly → guard rejects.
		(c2 as unknown as NodeImpl)._setDeps([a], noopFn);
		expect(outerSetDepsReentrantError).toMatch(/reentrant dep mutation/);
	});

	// ─────────────────────────────────────────────────────────────────────
	// _removeDep
	// ─────────────────────────────────────────────────────────────────────

	it("_removeDep: removes a dep, drops its DepRecord, surviving deps' records preserved", () => {
		const a = node<number>({ initial: 5 });
		const b = node<number>({ initial: 10 });
		// fn deliberately omits defensive `?? 0` so the missing-slot effect is
		// visible — demonstrates the user-fn-shape concern when removing a
		// dep without supplying a new fn.
		const c = node([a, b], (data, actions, ctx) => {
			const av = data[0]?.[0] ?? ctx.prevData[0];
			const bv = data[1]?.[0] ?? ctx.prevData[1];
			actions.emit((av as number) + (bv as number));
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(15);

		const beforeRecA = (c as unknown as NodeImpl)._deps[0];

		// Drop b but keep the same fn — even though it'll silently break
		// because data[1]/prevData[1] no longer exist. The Phase 13.8 lock
		// requires fn at every call; passing the existing fn here demonstrates
		// the foot-gun: explicitness doesn't fix semantics if the user
		// re-passes a fn that's incompatible with the new shape.
		const cFnOld = (c as unknown as NodeImpl)._fn as NodeFn;
		(c as unknown as NodeImpl)._removeDep(b, cFnOld);

		// a's DepRecord identity preserved.
		const afterRecA = (c as unknown as NodeImpl)._deps[0];
		expect(afterRecA).toBe(beforeRecA);
		expect((c as unknown as NodeImpl)._deps).toHaveLength(1);

		// Drive a fresh wave. fn sees data[0]=a's batch [3], data[1]=undefined,
		// prevData=[5] (length 1 — only a's record). av=3, bv=undefined.
		// 3 + undefined = NaN. Demonstrates why opts.fn matters on shape change.
		a.down([[DATA, 3]]);
		expect(c.cache).toBeNaN();
	});

	it("_removeDep with opts.fn: surviving fn handles the shrunken dep set", () => {
		const a = node<number>({ initial: 5 });
		const b = node<number>({ initial: 10 });
		const c = node([a, b], (data, actions, ctx) => {
			const av = data[0]?.[0] ?? ctx.prevData[0];
			const bv = data[1]?.[0] ?? ctx.prevData[1];
			actions.emit(((av as number) ?? 0) + ((bv as number) ?? 0));
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(15);

		// Drop b AND swap fn to read only a.
		(c as unknown as NodeImpl)._removeDep(b, (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 100);
		});

		a.down([[DATA, 7]]);
		expect(c.cache).toBe(700); // new fn: a * 100
	});

	it("_removeDep is idempotent on absent dep (still applies fn swap if requested)", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 2 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(10);

		const lengthBefore = (c as unknown as NodeImpl)._deps.length;
		const cFnOld = (c as unknown as NodeImpl)._fn as NodeFn;
		// b is not a dep; remove is no-op for the dep set. fn still required.
		expect(() => (c as unknown as NodeImpl)._removeDep(b, cFnOld)).not.toThrow();
		expect((c as unknown as NodeImpl)._deps.length).toBe(lengthBefore);

		// But fn swap still applies even on absent dep.
		(c as unknown as NodeImpl)._removeDep(b, (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) + 50);
		});
		a.down([[DATA, 3]]);
		expect(c.cache).toBe(53); // new fn: a + 50
	});

	it("_removeDep rejects on terminal node", () => {
		const a = node<number>({ initial: 1 });
		const c = node([a], (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 10);
		});
		c.subscribe(() => {});
		c.down([[COMPLETE]]);
		expect(c.status).toBe("completed");

		expect(() => (c as unknown as NodeImpl)._removeDep(a, noopFn)).toThrowError(/terminal state/);
	});

	it("_removeDep auto-settle: removing the sole DIRTY contributor closes the wave (no DATA → RESOLVED)", () => {
		const a = node<number>({ initial: 1 });
		const b = node<number>({ initial: 7 });
		const c = node([a, b], (data, actions, ctx) => {
			const av = data[0]?.[0] ?? ctx.prevData[0];
			const bv = data[1]?.[0] ?? ctx.prevData[1];
			actions.emit((av as number) + (bv as number));
		});
		c.subscribe(() => {});
		expect(c.cache).toBe(8); // initial wave: 1 + 7

		// Drive a into DIRTY-but-not-yet-DATA. c starts a wave waiting on a.
		a.down([[DIRTY]]);
		expect((c as unknown as NodeImpl)._status).toBe("dirty");
		expect((c as unknown as NodeImpl)._dirtyDepCount).toBe(1);

		// Remove a — sole DIRTY contributor. Auto-settle path runs.
		// `_maybeRunFnOnSettlement` sees `_waveHasNewData=false` (a never
		// delivered DATA this wave) → pre-fn-skip branch: emit RESOLVED
		// downstream, don't re-run fn. Cache unchanged because no new
		// dep value arrived; the wave was a "no-op wave" from c's POV.
		const cFnPreserve = (c as unknown as NodeImpl)._fn as NodeFn;
		(c as unknown as NodeImpl)._removeDep(a, cFnPreserve);

		expect((c as unknown as NodeImpl)._dirtyDepCount).toBe(0);
		expect(c.cache).toBe(8); // unchanged — RESOLVED settles without re-firing fn
		expect((c as unknown as NodeImpl)._status).not.toBe("dirty");
	});
});
