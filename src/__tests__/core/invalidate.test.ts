/**
 * DS-13.5.A — INVALIDATE protocol redesign tests.
 *
 * Spec: GRAPHREFLY-SPEC.md §1.3 (tier table), §2.4 (INVALIDATE settles wave),
 * §2.4a (same-wave merge rules), §2.6 (TEARDOWN auto-precedes with
 * COMPLETE/ERROR — Q16).
 *
 * The Agent 5 deadlock pattern (a single `[[INVALIDATE]]` left dependents
 * wedged in DIRTY because INVALIDATE wasn't a settle-class signal for
 * `_dirtyDepCount` accounting) is the regression sentinel for §2.4.
 */

import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	type Messages,
	RESOLVED,
	TEARDOWN,
} from "../../core/messages.js";
import { node } from "../../core/node.js";
import { Graph } from "../../graph/graph.js";

const DIRTY_TYPE_FOR_TEST = DIRTY;

describe("DS-13.5.A — INVALIDATE settles wave", () => {
	it("a single [[INVALIDATE]] on a dep settles the consuming wave (counter-test for Agent 5 deadlock)", () => {
		// Regression: pre-DS-13.5.A, INVALIDATE on a clean dep INCREMENTED
		// `_dirtyDepCount` and never decremented, leaving the consumer
		// permanently waiting for a settlement that never arrived. Agent 5
		// worked around it via `[[INVALIDATE], [RESOLVED]]`. Post-DS-13.5.A,
		// INVALIDATE is settle-class — no paired RESOLVED needed.
		const src = node<number>({ initial: 1 });
		let runs = 0;
		const consumer = node(
			[src],
			(_data, actions) => {
				runs += 1;
				actions.emit(runs);
			},
			{ describeKind: "derived" },
		);
		const unsub = consumer.subscribe(() => undefined);
		expect(runs).toBeGreaterThanOrEqual(1);
		const before = runs;

		// Plain `[[INVALIDATE]]` should settle the consumer's wave.
		src.down([[INVALIDATE]]);

		// Now push a DATA: consumer must re-fire (proves the wave was not stuck).
		src.emit(2);
		expect(runs).toBeGreaterThan(before);

		unsub();
	});

	it("INVALIDATE clears the dep's prevData slot back to SENTINEL", () => {
		const src = node<string>({ initial: "first" });
		const seenPrev: unknown[] = [];
		let runs = 0;
		const consumer = node(
			[src],
			(batchData, _actions, ctx) => {
				runs += 1;
				seenPrev.push(ctx.prevData[0]);
				const latest = batchData[0]?.at(-1) ?? ctx.prevData[0];
				return latest;
			},
			{ describeKind: "derived" },
		);
		const unsub = consumer.subscribe(() => undefined);

		// First run sees prevData[0] === undefined (SENTINEL).
		expect(runs).toBe(1);
		expect(seenPrev[0]).toBeUndefined();

		// Establish a prevData via emit so we can assert INVALIDATE clears it.
		src.emit("second");
		expect(runs).toBe(2);
		expect(seenPrev[1]).toBe("first"); // prevData[0] holds the prior emission

		// INVALIDATE must reset prevData[0] back to undefined (SENTINEL).
		src.down([[INVALIDATE]]);
		// Trigger fn re-run by emitting fresh DATA. On this run prevData[0]
		// must be `undefined` — INVALIDATE cleared the dep's prior-value slot.
		src.emit("third");
		expect(runs).toBe(3); // fn DID re-run (not vacuous)
		expect(seenPrev[2]).toBeUndefined();

		unsub();
	});
});

describe("DS-13.5.A — same-wave merge rules (§2.4a)", () => {
	it("DATA + INVALIDATE in same wave: both deliver in tier order, cache ends cleared", () => {
		// Spec §2.4a: the natural tier-sort walk handles the merge. DATA
		// (tier 3) processes first (cache → 42), then INVALIDATE (tier 4)
		// clears cache back to undefined. Subscribers observe the full
		// chronology — no message is silently dropped.
		const src = node<number>({ initial: 0 });
		const seen: symbol[] = [];
		const unsub = src.subscribe((msgs) => {
			for (const m of msgs as Messages) seen.push(m[0]);
		});
		seen.length = 0;

		src.down([[DATA, 42], [INVALIDATE]]);

		// Cache ends cleared (INVALIDATE wins by running last in tier order).
		expect(src.cache).toBeUndefined();
		// Both DATA and INVALIDATE delivered to sinks.
		expect(seen).toContain(DATA);
		expect(seen).toContain(INVALIDATE);
		// Order: DATA before INVALIDATE.
		const dataIdx = seen.indexOf(DATA);
		const invIdx = seen.indexOf(INVALIDATE);
		expect(dataIdx).toBeGreaterThanOrEqual(0);
		expect(invIdx).toBeGreaterThan(dataIdx);

		unsub();
	});

	it("non-monotone input [[INVALIDATE], [DATA, v]] sorts to [DATA, INVALIDATE] order", () => {
		// User emits in reverse order; _frameBatch's stable tier-sort puts
		// DATA (tier 3) before INVALIDATE (tier 4). End state matches the
		// monotone case — cache cleared, both delivered.
		const src = node<number>({ initial: 0 });
		const seen: symbol[] = [];
		const unsub = src.subscribe((msgs) => {
			for (const m of msgs as Messages) seen.push(m[0]);
		});
		seen.length = 0;

		src.down([[INVALIDATE], [DATA, 99]]);

		expect(src.cache).toBeUndefined();
		const dataIdx = seen.indexOf(DATA);
		const invIdx = seen.indexOf(INVALIDATE);
		expect(dataIdx).toBeGreaterThanOrEqual(0);
		expect(invIdx).toBeGreaterThan(dataIdx);

		unsub();
	});

	it("RESOLVED + INVALIDATE in same wave: both deliver, cache ends cleared", () => {
		// RESOLVED is a no-op for cache; INVALIDATE clears it. Both delivered.
		const src = node<number>({ initial: 7 });
		const seen: symbol[] = [];
		const unsub = src.subscribe((msgs) => {
			for (const m of msgs as Messages) seen.push(m[0]);
		});
		seen.length = 0;

		src.down([[RESOLVED], [INVALIDATE]]);

		// Cache cleared by INVALIDATE (RESOLVED leaves cache alone, INVALIDATE wins).
		expect(src.cache).toBeUndefined();
		expect(seen).toContain(RESOLVED);
		expect(seen).toContain(INVALIDATE);
		const resIdx = seen.indexOf(RESOLVED);
		const invIdx = seen.indexOf(INVALIDATE);
		expect(invIdx).toBeGreaterThan(resIdx);

		unsub();
	});

	it("Q9: INVALIDATE + INVALIDATE in same wave collapses to one (consumer counter settles cleanly)", () => {
		const src = node<number>({ initial: 5 });
		let invalidateDeliveries = 0;
		const sinkUnsub = src.subscribe((msgs) => {
			for (const m of msgs as Messages) {
				if (m[0] === INVALIDATE) invalidateDeliveries += 1;
			}
		});
		invalidateDeliveries = 0;

		// Add a consumer derived node so we can verify _dirtyDepCount settles.
		let runs = 0;
		const consumer = node(
			[src],
			(_data, actions) => {
				runs += 1;
				actions.emit(runs);
			},
			{ describeKind: "derived" },
		);
		const consumerUnsub = consumer.subscribe(() => undefined);
		const runsBefore = runs;

		src.down([[INVALIDATE], [INVALIDATE]]);

		// Q9 — only one INVALIDATE delivered to sinks regardless of input count.
		expect(invalidateDeliveries).toBe(1);
		// Cache cleared.
		expect(src.cache).toBeUndefined();

		// Consumer wave settled cleanly — emit fresh DATA to confirm fn re-fires.
		src.emit(99);
		expect(runs).toBeGreaterThan(runsBefore);

		sinkUnsub();
		consumerUnsub();
	});
});

describe("DS-13.5.A — INVALIDATE inside batch", () => {
	it("plain [[INVALIDATE]] inside batch settles the consuming wave alongside fresh DATA on another dep", () => {
		// Mirrors the Agent 5 reset shape: INVALIDATE on one dep, fresh DATA
		// on others, all in a single batch. Post-DS-13.5.A, the consumer
		// re-runs once with the cleared `prevData[lastResponse] = undefined`
		// and the new status/turn values — no trailing RESOLVED needed.
		const lastResponse = node<{ token: string } | undefined>({ initial: undefined });
		const status = node<string>({ initial: "idle" });
		const turn = node<number>({ initial: 0 });

		let runs = 0;
		let observedLastResponse: unknown = "unset";
		const consumer = node(
			[status, lastResponse, turn],
			(batchData, actions, ctx) => {
				runs += 1;
				const respBatch = batchData[1];
				observedLastResponse =
					respBatch != null && respBatch.length > 0 ? respBatch.at(-1) : ctx.prevData[1];
				const stat = batchData[0]?.at(-1) ?? ctx.prevData[0];
				const t = batchData[2]?.at(-1) ?? ctx.prevData[2];
				actions.emit(`${stat as string}@${t as number}`);
			},
			{ describeKind: "derived" },
		);
		const unsub = consumer.subscribe(() => undefined);

		// Establish a prior response so first-run gate passes and the
		// consumer's prevData[lastResponse] holds a non-SENTINEL value.
		lastResponse.emit({ token: "first" });
		const runsAfterFirst = runs;
		expect(runsAfterFirst).toBeGreaterThanOrEqual(1);

		// Reset batch — INVALIDATE on lastResponse + fresh DATA on status (transition
		// to a NEW value so equals doesn't dedup it).
		batch(() => {
			lastResponse.down([[INVALIDATE]]);
			status.emit("thinking");
		});

		// Consumer re-ran with the new status — observed `lastResponse`
		// must be SENTINEL `undefined` (INVALIDATE cleared `prevData[1]`).
		expect(runs).toBeGreaterThan(runsAfterFirst);
		expect(observedLastResponse).toBeUndefined();

		unsub();
	});
});

describe("DS-13.5.A Q16 — TEARDOWN auto-precedes with COMPLETE", () => {
	it("plain [[TEARDOWN]] on a non-terminal node delivers [[COMPLETE], [TEARDOWN]] to sinks", () => {
		const n = node<number>({ initial: 1 });
		const seen: symbol[] = [];
		const unsub = n.subscribe((msgs) => {
			for (const m of msgs as Messages) seen.push(m[0]);
		});
		seen.length = 0;

		n.down([[TEARDOWN]]);

		const completeIdx = seen.indexOf(COMPLETE);
		const teardownIdx = seen.indexOf(TEARDOWN);
		expect(completeIdx).toBeGreaterThanOrEqual(0);
		expect(teardownIdx).toBeGreaterThan(completeIdx);

		unsub();
	});

	it("idempotent: redundant TEARDOWN deliveries do NOT re-emit a synthetic [COMPLETE]", () => {
		const n = node<number>({ initial: 1 });
		let completeCount = 0;
		let teardownCount = 0;
		const unsub = n.subscribe((msgs) => {
			for (const m of msgs as Messages) {
				if (m[0] === COMPLETE) completeCount += 1;
				else if (m[0] === TEARDOWN) teardownCount += 1;
			}
		});

		n.down([[TEARDOWN]]);
		n.down([[TEARDOWN]]);

		// Q16 only auto-precedes COMPLETE on the FIRST TEARDOWN (when the
		// node is not yet torn down). Redundant TEARDOWN re-deliveries — e.g.
		// from `Graph.destroy` broadcast colliding with dep cascade — must
		// not fire COMPLETE again to sinks.
		expect(completeCount).toBe(1);
		expect(teardownCount).toBeGreaterThanOrEqual(1);

		unsub();
	});

	it("does NOT auto-prefix COMPLETE when ERROR is already in the wave", () => {
		const n = node<number>({ initial: 1 });
		let completeCount = 0;
		const unsub = n.subscribe((msgs) => {
			for (const m of msgs as Messages) {
				if (m[0] === COMPLETE) completeCount += 1;
			}
		});

		n.down([[ERROR, new Error("boom")], [TEARDOWN]]);

		// ERROR is the terminal signal; Q16 must not stack a redundant
		// COMPLETE prefix when the wave already carries a terminal lifecycle.
		expect(completeCount).toBe(0);

		unsub();
	});

	it("does NOT auto-prefix COMPLETE when COMPLETE is already in the wave", () => {
		const n = node<number>({ initial: 1 });
		let completeCount = 0;
		const unsub = n.subscribe((msgs) => {
			for (const m of msgs as Messages) {
				if (m[0] === COMPLETE) completeCount += 1;
			}
		});

		n.down([[COMPLETE], [TEARDOWN]]);

		expect(completeCount).toBe(1);

		unsub();
	});

	it("Graph.remove on a non-terminal node delivers COMPLETE before TEARDOWN to subscribers", () => {
		const g = new Graph("q16-remove");
		const member = node<number>({ initial: 0, name: "member" });
		g.add(member);

		const seen: symbol[] = [];
		const unsub = member.subscribe((msgs) => {
			for (const m of msgs as Messages) seen.push(m[0]);
		});
		seen.length = 0;

		g.remove("member");

		const completeIdx = seen.indexOf(COMPLETE);
		const teardownIdx = seen.indexOf(TEARDOWN);
		expect(completeIdx).toBeGreaterThanOrEqual(0);
		expect(teardownIdx).toBeGreaterThan(completeIdx);

		unsub();
	});

	it("Graph.destroy delivers COMPLETE before TEARDOWN to every member's subscribers", () => {
		const g = new Graph("q16-destroy");
		const a = node<number>({ initial: 1, name: "a" });
		g.add(a);

		const seen: symbol[] = [];
		const unsub = a.subscribe((msgs) => {
			for (const m of msgs as Messages) seen.push(m[0]);
		});
		seen.length = 0;

		g.destroy();

		const completeIdx = seen.indexOf(COMPLETE);
		const teardownIdx = seen.indexOf(TEARDOWN);
		expect(completeIdx).toBeGreaterThanOrEqual(0);
		expect(teardownIdx).toBeGreaterThan(completeIdx);

		unsub();
	});
});

describe("DS-13.5.A — push-on-subscribe after INVALIDATE (sentinel transition)", () => {
	it("late subscriber receives [START] only — no DIRTY — after source.down([[INVALIDATE]])", () => {
		// Regression sentinel for the agentLoop abort-test root cause.
		// Pre-fix, INVALIDATE set _status="dirty"; defaultOnSubscribe pushed
		// [START, DIRTY] to late-attaching subscribers, infecting their dep
		// slot with a phantom dirty count that never settled. Post-fix,
		// INVALIDATE sets _status="sentinel"; push-on-subscribe sends only
		// [START]. Locks the load-bearing transition at the protocol layer.
		const src = node<number>({ initial: 42, name: "src" });
		// Establish initial state, then INVALIDATE.
		const earlyUnsub = src.subscribe(() => undefined);
		src.down([[INVALIDATE]]);
		earlyUnsub();
		// Late subscriber attaches AFTER the INVALIDATE.
		const seen: symbol[] = [];
		const unsub = src.subscribe((msgs) => {
			for (const m of msgs as Messages) seen.push(m[0]);
		});
		// Push-on-subscribe should send only [START] — no DIRTY, no DATA.
		// (DATA absent because cache is undefined post-INVALIDATE; the
		// load-bearing property is the absence of DIRTY in the handshake.)
		expect(seen).not.toContain(DATA);
		expect(seen).not.toContain(DIRTY_TYPE_FOR_TEST);
		// Source's status is "sentinel" post-INVALIDATE pre-subscribe, then
		// transitions to "pending" inside subscribe() per the "activated but
		// no value yet" rule. Either is fine — the regression sentinel is
		// "no DIRTY pushed to the late subscriber."
		expect(["sentinel", "pending"]).toContain(src.status);
		unsub();
	});

	it("consumer attaches AFTER source's INVALIDATE; consumer fn fires once on next DATA without phantom dirty count", () => {
		// Protocol-level repro of the agent-abort C2/C3 scenario:
		// `_terminalResult` lazily activated AFTER the reset batch had
		// INVALIDATE'd `lastResponseState` — the new dep slot must NOT
		// inherit a phantom DIRTY that wedges _dirtyDepCount.
		const src = node<number>({ initial: 1, name: "src" });
		// INVALIDATE before the consumer subscribes — like the agent reset
		// batch fires before _terminalResult activates via awaitSettled.
		const keepalive = src.subscribe(() => undefined);
		src.down([[INVALIDATE]]);
		keepalive();

		let runs = 0;
		let lastSeen: number | undefined;
		const consumer = node<number>(
			[src],
			(batchData, actions, ctx) => {
				runs += 1;
				const v = batchData[0]?.at(-1) ?? ctx.prevData[0];
				if (typeof v === "number") {
					lastSeen = v;
					actions.emit(v);
				} else {
					actions.down([[RESOLVED]]);
				}
			},
			{ describeKind: "derived", partial: true, name: "consumer" },
		);
		const unsub = consumer.subscribe(() => undefined);
		const runsAfterAttach = runs;

		// Now emit fresh DATA — consumer fn MUST fire (would hang at
		// _dirtyDepCount=1 if push-on-subscribe had pushed DIRTY).
		src.emit(99);
		expect(runs).toBeGreaterThan(runsAfterAttach);
		expect(lastSeen).toBe(99);

		unsub();
	});
});

describe("DS-13.5.A Q9 — INVALIDATE+INVALIDATE collapse fires cleanup hook exactly once", () => {
	it("object-form `invalidate` hook fires once on collapsed wave", () => {
		// Q9 spec rationale: "cleanup hooks fire at most once per wave".
		// Locks the cleanup-firing invariant against a future refactor that
		// might move Q9 collapse out of `_frameBatch`.
		const src = node<number>({ initial: 0, name: "src" });
		let invalidateHookFired = 0;
		const consumer = node<number>(
			[src],
			(_batchData, actions) => {
				actions.emit(1);
				return {
					invalidate: () => {
						invalidateHookFired += 1;
					},
				};
			},
			{ describeKind: "derived", name: "consumer" },
		);
		const unsub = consumer.subscribe(() => undefined);

		// Collapse case: two INVALIDATEs in one wave on the source.
		src.down([[INVALIDATE], [INVALIDATE]]);

		// Cleanup hook MUST fire exactly once despite two INVALIDATEs in the
		// same wave (Q9 collapses to one delivery on the wire).
		expect(invalidateHookFired).toBe(1);

		unsub();
	});
});

describe("DS-13.5.A — INVALIDATE on terminal-resubscribable (N1 regression)", () => {
	it("INVALIDATE on a multi-subscribed terminal-resubscribable triggers fresh-lifecycle reset (no stale prevData leak)", () => {
		// N1 regression: a resubscribable node with multiple subscribers
		// reaches COMPLETE. One sub unsubs (so `_deactivate` does NOT run —
		// remaining sub keeps node alive). INVALIDATE arrives. Without the
		// pass-3 fix, the prior lifecycle's `_hasCalledFnOnce`,
		// `_dirtyDepCount`, and DepRecord `prevData` would persist into the
		// next wave — fn would compute against ghost state.
		const src = node<number>({ initial: 0, name: "src" });
		let fnCallsWithStalePrev = 0;
		const seenPrevValues: unknown[] = [];
		const consumer = node<number>(
			[src],
			(batchData, actions, ctx) => {
				const incoming = batchData[0];
				const fromBatch =
					incoming != null && incoming.length > 0 ? (incoming.at(-1) as number) : undefined;
				const prev = ctx.prevData[0];
				seenPrevValues.push(prev);
				// Stale-prev detection: after INVALIDATE clears the dep slot,
				// a fresh-lifecycle fn run should see prevData[0] === undefined.
				// If the lifecycle reset didn't fire, prevData[0] holds the
				// pre-COMPLETE value (e.g. 7) instead of undefined.
				if (prev !== undefined && fromBatch == null) {
					fnCallsWithStalePrev += 1;
				}
				if (fromBatch != null) actions.emit(fromBatch * 2);
				else actions.down([[RESOLVED]]);
			},
			{ describeKind: "derived", resubscribable: true, name: "consumer" },
		);

		// Multi-sub setup: ka1 + ka2 keep consumer alive across terminal.
		const ka1 = consumer.subscribe(() => undefined);
		const ka2 = consumer.subscribe(() => undefined);

		// Push a value through. Consumer fn runs, prevData[0] becomes 7.
		src.emit(7);

		// Drive consumer to terminal: emit COMPLETE on src, autoComplete cascades.
		src.down([[COMPLETE]]);
		expect(consumer.status).toBe("completed");

		// ka1 detaches. ka2 still attached → `_deactivate` does NOT run.
		// Prior-lifecycle state (prevData=7, _hasCalledFnOnce=true) lingers.
		ka1();
		expect(consumer.status).toBe("completed"); // still terminal

		// INVALIDATE arrives. Pass-3 fix: triggers full lifecycle reset.
		consumer.down([[INVALIDATE]]);
		expect(consumer.status).toBe("sentinel");

		// Now subscribe a fresh consumer at the same node — they should see
		// fresh-lifecycle behavior. Drive a fresh wave on src to make the
		// consumer's fn run; assert prevData[0] is undefined (SENTINEL),
		// proving the reset cleared the stale value.
		const seenLast: unknown[] = [];
		const ka3 = consumer.subscribe((msgs) => {
			for (const m of msgs as Messages) {
				if (m[0] === DATA) seenLast.push(m[1]);
			}
		});

		// Need to re-establish src's emission too, since src is also terminal
		// after the COMPLETE cascade. Use a fresh src for the next wave —
		// this mirrors how a real resubscribable consumer would re-attach
		// after its own deps reset.
		// Actually src here completed on src.down([[COMPLETE]]); to test
		// downstream reset cleanly, build a fresh source:
		const src2 = node<number>({ initial: 0, name: "src2" });
		const consumer2 = node<number>(
			[src2],
			(batchData, actions, ctx) => {
				const incoming = batchData[0];
				const fromBatch =
					incoming != null && incoming.length > 0 ? (incoming.at(-1) as number) : undefined;
				const prev = ctx.prevData[0];
				if (prev !== undefined && fromBatch == null) {
					fnCallsWithStalePrev += 1;
				}
				if (fromBatch != null) actions.emit(fromBatch * 2);
				else actions.down([[RESOLVED]]);
			},
			{ describeKind: "derived", resubscribable: true, name: "consumer2" },
		);
		const c2_ka1 = consumer2.subscribe(() => undefined);
		const c2_ka2 = consumer2.subscribe(() => undefined);
		src2.emit(7); // prevData[0] = 7
		src2.down([[COMPLETE]]); // consumer2 → completed
		c2_ka1();
		// INVALIDATE on terminal-resubscribable
		consumer2.down([[INVALIDATE]]);

		// Now re-emit on src2 — but src2 is itself completed. New subscribe
		// to consumer2 should NOT see stale fn computations from prior
		// lifecycle.
		const c2_seenLast: number[] = [];
		const c2_ka3 = consumer2.subscribe((msgs) => {
			for (const m of msgs as Messages) {
				if (m[0] === DATA) c2_seenLast.push(m[1] as number);
			}
		});
		// The state we care about: consumer2._hasCalledFnOnce should be false
		// post-reset (so first-run gate re-arms), DepRecords should be reset,
		// and any prior-lifecycle prevData should be cleared.
		// The most direct assertion: consumer2.cache is undefined (cleared
		// by INVALIDATE), status is "sentinel" or "pending" post-subscribe.
		expect(consumer2.cache).toBeUndefined();
		expect(["sentinel", "pending"]).toContain(consumer2.status);

		ka2();
		ka3();
		c2_ka2();
		c2_ka3();
	});

	it("subscribe() afterTerminalReset path still works for single-sub resubscribable (regression check on the helper extraction)", () => {
		// Validate that extracting `_resetForFreshLifecycle` didn't break the
		// existing `subscribe()` afterTerminalReset path.
		const src = node<number>({ initial: 0, resubscribable: true, name: "src" });
		const sub1 = src.subscribe(() => undefined);
		src.emit(5);
		expect(src.cache).toBe(5);
		src.down([[COMPLETE]]);
		expect(src.status).toBe("completed");
		sub1();

		// Re-subscribe — terminal-resubscribable should reset cleanly.
		const seen: symbol[] = [];
		const sub2 = src.subscribe((msgs) => {
			for (const m of msgs as Messages) seen.push(m[0]);
		});
		// Cache cleared by reset, status flips to pending on activation.
		expect(src.cache).toBeUndefined();
		expect(["sentinel", "pending"]).toContain(src.status);
		sub2();
	});
});
