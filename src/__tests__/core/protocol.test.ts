import { describe, expect, it } from "vitest";
import { batch, downWithBatch, isBatching } from "../../core/batch.js";
import type { GlobalInspectorEvent } from "../../core/config.js";
import { GraphReFlyConfig, registerBuiltins } from "../../core/config.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	type Messages,
	PAUSE,
	RESOLVED,
	RESUME,
	START,
	TEARDOWN,
} from "../../core/messages.js";
import { defaultConfig, node } from "../../core/node.js";

/** Shorthand for the tierOf callback required by downWithBatch in v5. */
const tierOf = (t: symbol) => defaultConfig.messageTier(t);

describe("message protocol", () => {
	// Regression: GRAPHREFLY-SPEC §1.1 — Messages are arrays of tuples; no single-message shorthand.
	it("messages are arrays of [Type, Data?] tuples — no shorthand", () => {
		const msgs: readonly [typeof DATA, number][] = [[DATA, 42]];
		expect(msgs).toEqual([[DATA, 42]]);
	});
});

describe("downWithBatch", () => {
	// Regression: GRAPHREFLY-SPEC §1.3.1 — outside a batch, DIRTY reaches sinks before DATA.
	it("without batch: emits immediate then phase-2 in order", () => {
		const log: symbol[][] = [];
		downWithBatch(
			(msgs) => {
				log.push(msgs.map((m) => m[0]));
			},
			[[DIRTY], [DATA, 1]],
			tierOf,
		);
		expect(log).toEqual([[DIRTY], [DATA]]);
	});

	// Regression: phase-2 before terminal — COMPLETE alone would otherwise reach sinks before deferred DATA.
	it("without batch: DATA then COMPLETE when both appear in one downWithBatch", () => {
		const log: symbol[][] = [];
		downWithBatch(
			(msgs) => {
				log.push(msgs.map((m) => m[0]));
			},
			[[DATA, 1], [COMPLETE]],
			tierOf,
		);
		expect(log).toEqual([[DATA], [COMPLETE]]);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — inside batch, DIRTY flushes immediately; DATA waits for batch end.
	it("inside batch: DIRTY immediate, DATA deferred until batch exits", () => {
		const log: symbol[][] = [];
		batch(() => {
			expect(isBatching()).toBe(true);
			downWithBatch(
				(msgs) => {
					log.push(msgs.map((m) => m[0]));
				},
				[[DIRTY], [DATA, 42]],
				tierOf,
			);
			expect(log).toEqual([[DIRTY]]);
		});
		expect(isBatching()).toBe(false);
		expect(log).toEqual([[DIRTY], [DATA]]);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — RESOLVED is phase-2 and deferred with DATA.
	it("RESOLVED is deferred like DATA (phase 2)", () => {
		const log: symbol[][] = [];
		batch(() => {
			downWithBatch(
				(msgs) => {
					log.push(msgs.map((m) => m[0]));
				},
				[[DIRTY], [RESOLVED]],
				tierOf,
			);
			expect(log).toEqual([[DIRTY]]);
		});
		expect(log).toEqual([[DIRTY], [RESOLVED]]);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — nested batch: inner deferred work waits for outer drain.
	it("nested batch does not flush until outermost exits", () => {
		const log: string[] = [];
		batch(() => {
			downWithBatch(
				(msgs) => log.push(`a:${msgs[0]?.[0] === DATA ? "d" : "i"}`),
				[[DATA, 1]],
				tierOf,
			);
			batch(() => {
				downWithBatch(
					(msgs) => log.push(`b:${msgs[0]?.[0] === DATA ? "d" : "i"}`),
					[[DATA, 2]],
					tierOf,
				);
				expect(log.filter((x) => x.startsWith("b"))).toEqual([]);
			});
			expect(log.filter((x) => x.startsWith("b"))).toEqual([]);
		});
		expect(log).toEqual(["a:d", "b:d"]);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.6 — unknown types are not treated as phase-2 for deferral.
	it("unknown message types are not deferred (forward-compat)", () => {
		const CUSTOM = Symbol("custom.upstream");
		const log: string[] = [];
		batch(() => {
			downWithBatch(
				(msgs) => {
					log.push(String(msgs[0]?.[0]));
				},
				[[CUSTOM, { x: 1 }]],
				tierOf,
			);
			expect(log.length).toBe(1);
		});
		expect(log.length).toBe(1);
	});

	// Regression: GRAPHREFLY-SPEC §1.1 — empty batches are ignored.
	it("empty messages is a no-op", () => {
		let n = 0;
		downWithBatch(
			() => {
				n += 1;
			},
			[],
			tierOf,
		);
		expect(n).toBe(0);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — throwing during batch discards deferred phase-2 for that batch.
	it("does not flush deferred phase-2 when batch fn throws", () => {
		const log: symbol[][] = [];
		expect(() =>
			batch(() => {
				downWithBatch(
					(msgs) => {
						log.push(msgs.map((m) => m[0]));
					},
					[[DATA, 1]],
					tierOf,
				);
				throw new Error("abort");
			}),
		).toThrow("abort");
		expect(log).toEqual([]);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — inner batch throw aborts outer deferral without flushing pending DATA.
	it("nested inner throw clears pending for outer batch", () => {
		const log: symbol[][] = [];
		expect(() =>
			batch(() => {
				downWithBatch(
					(msgs) => {
						log.push(msgs.map((m) => m[0]));
					},
					[[DATA, 1]],
					tierOf,
				);
				batch(() => {
					throw new Error("inner");
				});
			}),
		).toThrow("inner");
		expect(log).toEqual([]);
	});
});

describe("batch drain semantics", () => {
	// Regression: GRAPHREFLY-SPEC §1.3.7 — during drain, `isBatching` stays true; nested phase-2 re-queues.
	it("isBatching is true during drain (nested emissions are deferred)", () => {
		const log: string[] = [];
		let batchingDuringDrain: boolean | undefined;

		batch(() => {
			downWithBatch(
				(_msgs) => {
					// This runs during drain — isBatching should be true
					batchingDuringDrain = isBatching();
					log.push("first-drain");
					// Nested emission during drain should be deferred
					downWithBatch(
						(_msgs2) => {
							log.push("nested-drain");
						},
						[[DATA, 99]],
						tierOf,
					);
				},
				[[DATA, 1]],
				tierOf,
			);
		});

		expect(batchingDuringDrain).toBe(true);
		// Both should have drained: first, then nested
		expect(log).toEqual(["first-drain", "nested-drain"]);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — drain processes multiple deferred emissions; isolate callback failures.
	it("per-emission try/catch: one throwing callback does not orphan others", () => {
		const log: string[] = [];

		expect(() =>
			batch(() => {
				downWithBatch(
					() => {
						throw new Error("boom");
					},
					[[DATA, 1]],
					tierOf,
				);
				downWithBatch(
					() => {
						log.push("second");
					},
					[[DATA, 2]],
					tierOf,
				);
			}),
		).toThrow("boom");

		// Second callback should still have run despite first throwing
		expect(log).toEqual(["second"]);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — after outermost batch exits, `isBatching` is false.
	it("isBatching is false after drain completes", () => {
		batch(() => {
			downWithBatch(() => undefined, [[DATA, 1]], tierOf);
		});
		expect(isBatching()).toBe(false);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — nested throw during drain: outer deferred items still run where specified (A4).
	it("nested batch throw during drain does not clear outer deferral queue (A4)", () => {
		const log: string[] = [];
		expect(() =>
			batch(() => {
				downWithBatch(
					() => {
						downWithBatch(
							() => {
								log.push("deferred-from-callback");
							},
							[[DATA, 1]],
							tierOf,
						);
						batch(() => {
							throw new Error("inner");
						});
					},
					[[DATA, 0]],
					tierOf,
				);
			}),
		).toThrow("inner");
		expect(log).toEqual(["deferred-from-callback"]);
	});
});

describe("D4: drain cycle detection", () => {
	// Regression: GRAPHREFLY-SPEC §1.3.7 — unbounded re-entrant deferral during drain must throw (cycle guard).
	it("reactive cycle during drain throws instead of infinite-looping", () => {
		expect(() =>
			batch(() => {
				const cyclicEmit = (): void => {
					downWithBatch(
						() => {
							// re-enqueue indefinitely
							downWithBatch(() => cyclicEmit(), [[DATA, 1]], tierOf);
						},
						[[DATA, 0]],
						tierOf,
					);
				};
				cyclicEmit();
			}),
		).toThrow(/reactive cycle/);
	});
});

describe("terminal and control messages are not phase-2", () => {
	// Regression: GRAPHREFLY-SPEC §1.2 — PAUSE, RESUME emit immediately even in batch (tier 2).
	it("PAUSE, RESUME emit immediately in batch", () => {
		for (const t of [PAUSE, RESUME] as const) {
			const log: symbol[] = [];
			batch(() => {
				downWithBatch(
					(msgs) => {
						log.push(msgs[0]?.[0] as symbol);
					},
					[[t]],
					tierOf,
				);
				expect(log).toEqual([t]);
			});
			expect(log).toEqual([t]);
		}
	});

	// v5: TEARDOWN is tier 5, deferred to drainPhase4 inside a batch.
	it("TEARDOWN is deferred inside batch (tier 5)", () => {
		const log: symbol[] = [];
		batch(() => {
			downWithBatch(
				(msgs) => {
					log.push(msgs[0]?.[0] as symbol);
				},
				[[TEARDOWN]],
				tierOf,
			);
			// TEARDOWN is deferred inside batch.
			expect(log).toEqual([]);
		});
		// Delivered on batch exit.
		expect(log).toEqual([TEARDOWN]);
	});

	// Canonical ordering: terminal signals (COMPLETE, ERROR) are tier 4 — deferred to
	// after phase-2 inside a batch, so DATA/RESOLVED reach sinks before node goes terminal.
	it("ERROR, COMPLETE are deferred (tier 4) — delivered after phase-2 in batch", () => {
		for (const t of [ERROR, COMPLETE] as const) {
			const log: symbol[] = [];
			batch(() => {
				downWithBatch(
					(msgs) => {
						log.push(msgs[0]?.[0] as symbol);
					},
					[[t]],
					tierOf,
				);
				// Terminal is deferred inside batch (tier 4).
				expect(log).toEqual([]);
			});
			// Delivered on batch exit.
			expect(log).toEqual([t]);
		}
	});

	// Canonical ordering: [[DATA, v], [COMPLETE]] delivers DATA before COMPLETE.
	it("DATA before COMPLETE in composite batch (one-shot source pattern)", () => {
		const log: symbol[][] = [];
		downWithBatch(
			(msgs) => {
				log.push(msgs.map((m) => m[0]));
			},
			[[DATA, null], [COMPLETE]],
			tierOf,
		);
		expect(log).toEqual([[DATA], [COMPLETE]]);
	});

	// Canonical ordering with all three tiers present.
	it("DIRTY then DATA then COMPLETE in composite batch", () => {
		const log: symbol[][] = [];
		downWithBatch(
			(msgs) => {
				log.push(msgs.map((m) => m[0]));
			},
			[[DIRTY], [DATA, 42], [COMPLETE]],
			tierOf,
		);
		expect(log).toEqual([[DIRTY], [DATA], [COMPLETE]]);
	});

	// Inside batch: immediate, then deferred phase-2, then deferred terminal.
	it("inside batch: DIRTY immediate, DATA and COMPLETE deferred in order", () => {
		const log: symbol[][] = [];
		batch(() => {
			downWithBatch(
				(msgs) => {
					log.push(msgs.map((m) => m[0]));
				},
				[[DIRTY], [DATA, 1], [COMPLETE]],
				tierOf,
			);
			// Only DIRTY is immediate.
			expect(log).toEqual([[DIRTY]]);
		});
		// After batch: DATA then COMPLETE.
		expect(log).toEqual([[DIRTY], [DATA], [COMPLETE]]);
	});
});

describe("integration: void sources", () => {
	// Regression: one-shot sources (IDB, Promise wrappers) emitting [[DATA, null], [COMPLETE]]
	// through operators previously broke because COMPLETE was delivered before DATA.
	it("one-shot void producer delivers DATA(null) then COMPLETE to subscriber", () => {
		const log: [symbol, unknown?][] = [];
		// Simulate a one-shot void source (like fromIDBTransaction).
		// null is the protocol-idiomatic "void" value; undefined is reserved as sentinel.
		const oneShot = node<null>(
			[],
			(_data, actions) => {
				actions.down([[DATA, null], [COMPLETE]]);
			},
			{ describeKind: "producer" },
		);
		const unsub = oneShot.subscribe((msgs: Messages) => {
			for (const m of msgs) log.push([m[0], m[1]]);
		});
		// Subscribe delivers [[START]] handshake first; then the producer's
		// fn emits DATA(null)+COMPLETE during `_onActivate`. Under the
		// B1 unified dispatch, raw `actions.down([[DATA], [COMPLETE]])` is
		// auto-framed with `[DIRTY]` at the emit waist.
		expect(log.map((m) => m[0])).toEqual([START, DIRTY, DATA, COMPLETE]);
		expect(log[2][1]).toBe(null);
		unsub();
	});
});

// ---------------------------------------------------------------------------
// B3 — Equals subtree skip correctness (guards against cascade regressions)
// ---------------------------------------------------------------------------

describe("B3: equals subtree skip — downstream fn-run counts under no-op inputs", () => {
	it("5-level chain: 50% no-op writes only re-run leaf fn on actual changes", () => {
		// Source toggles between 0 and 1 every other write. With equals
		// configured on every level, the duplicate writes should produce
		// RESOLVED at the first derived, which cascades as RESOLVED through
		// the chain, which fires the downstream pre-fn skip at every level.
		// The leaf fn should run exactly (writes / 2 + 1) times — once for
		// each distinct value, not once per write.
		const a = node<number>([], { initial: 0 });
		let leafRuns = 0;
		const b = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived", equals: (x, y) => x === y },
		);
		const c = node(
			[b],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) + 1);
			},
			{ describeKind: "derived", equals: (x, y) => x === y },
		);
		const d = node(
			[c],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) - 1);
			},
			{ describeKind: "derived", equals: (x, y) => x === y },
		);
		const e = node(
			[d],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				leafRuns += 1;
				actions.emit((data[0] as number) + 7);
			},
			{ describeKind: "derived", equals: (x, y) => x === y },
		);
		const unsub = e.subscribe(() => undefined);
		const baseRuns = leafRuns; // initial activation run
		// Pattern: 0, 0, 1, 1, 0, 0, 1, 1 — each distinct value repeats
		// twice, so the leaf should run exactly 4 times (one per pair).
		const pattern = [0, 0, 1, 1, 0, 0, 1, 1];
		for (const v of pattern) {
			a.down([[DATA, v]]);
		}
		// Expected: baseRuns (initial) + 4 transitions (0→1, 1→0, 0→1 after
		// the first 0 which equals the initial). Actually the initial cache
		// is 0; the first push(0) should RESOLVED (no leaf re-run); second
		// push(0) RESOLVED; push(1) → DATA → leaf runs; push(1) RESOLVED;
		// push(0) → DATA → leaf runs; push(0) RESOLVED; push(1) → DATA →
		// leaf runs; push(1) RESOLVED. That's 3 leaf runs after initial.
		expect(leafRuns - baseRuns).toBe(3);
		expect(e.cache).toBe(1 * 2 + 1 - 1 + 7); // = 9
		unsub();
	});

	it("diamond: both legs collapse to RESOLVED when source doesn't change", () => {
		// Source toggle drives both legs. Duplicate writes should produce
		// RESOLVED on both legs, which the join's pre-fn skip absorbs.
		const src = node<number>([], { initial: 0 });
		let joinRuns = 0;
		const left = node(
			[src],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) * 2);
			},
			{ describeKind: "derived", equals: (x, y) => x === y },
		);
		const right = node(
			[src],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit((data[0] as number) + 10);
			},
			{ describeKind: "derived", equals: (x, y) => x === y },
		);
		const joined = node(
			[left, right],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				joinRuns += 1;
				actions.emit((data[0] as number) + (data[1] as number));
			},
			{ describeKind: "derived", equals: (x, y) => x === y },
		);
		const unsub = joined.subscribe(() => undefined);
		const baseRuns = joinRuns;
		// Write the same value twice — the join should see RESOLVED on both
		// legs and skip entirely.
		src.down([[DATA, 0]]);
		src.down([[DATA, 0]]);
		expect(joinRuns - baseRuns).toBe(0);
		// Actually change the value — join runs once.
		src.down([[DATA, 1]]);
		expect(joinRuns - baseRuns).toBe(1);
		expect(joined.cache).toBe(1 * 2 + (1 + 10)); // = 13
		unsub();
	});
});

// ---------------------------------------------------------------------------
// C0 — PAUSE/RESUME lock-id tracking + bufferAll
// ---------------------------------------------------------------------------

describe("C0: PAUSE/RESUME lock-id", () => {
	it("bare [[PAUSE]] without lockId throws", () => {
		const a = node([], { initial: 0 });
		const d = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(data[0]);
			},
			{ describeKind: "derived" },
		);
		const unsub = d.subscribe(() => {});
		expect(() => a.down([[PAUSE]])).toThrow(/lockId/);
		unsub();
	});

	it("bare [[RESUME]] without lockId throws", () => {
		const a = node([], { initial: 0 });
		const d = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(data[0]);
			},
			{ describeKind: "derived" },
		);
		const unsub = d.subscribe(() => {});
		expect(() => a.down([[RESUME]])).toThrow(/lockId/);
		unsub();
	});

	it("multi-pauser correctness — releasing one lock keeps paused while another holds", () => {
		const a = node([], { initial: 0 });
		// effect-style node that can be observed for paused state
		let fnRuns = 0;
		const d = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				fnRuns += 1;
				actions.emit(data[0]);
			},
			{ describeKind: "derived" },
		);
		const unsub = d.subscribe(() => {});
		const baseRuns = fnRuns;

		const lockA = Symbol("A");
		const lockB = Symbol("B");

		// Two pausers hold locks.
		a.down([[PAUSE, lockA]]);
		a.down([[PAUSE, lockB]]);

		// While paused, a new DATA from `a` should not cause `d.fn` to run.
		a.down([[DIRTY], [DATA, 1]]);
		expect(fnRuns).toBe(baseRuns); // still paused, no fn execution

		// Lock A releases first — lock B still held, so `d` stays paused.
		a.down([[RESUME, lockA]]);
		expect(fnRuns).toBe(baseRuns); // B still holds

		// Lock B releases — now all locks released, pending wave replays.
		a.down([[RESUME, lockB]]);
		expect(fnRuns).toBe(baseRuns + 1);
		expect(d.cache).toBe(1);

		unsub();
	});

	it("idempotent RESUME for unknown lockId is a no-op", () => {
		const a = node([], { initial: 0 });
		const d = node(
			[a],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				actions.emit(data[0]);
			},
			{ describeKind: "derived" },
		);
		const unsub = d.subscribe(() => {});

		const lock = Symbol("ghost");
		// Never paused with this lock — RESUME should not throw, should not
		// unpause anything, and should leave the node in a normal state.
		expect(() => a.down([[RESUME, lock]])).not.toThrow();
		a.down([[DIRTY], [DATA, 42]]);
		expect(d.cache).toBe(42);
		unsub();
	});

	it("pausable: resumeAll buffers DATA and replays on final lock release", () => {
		// A node with bufferAll mode buffers outgoing tier-3 messages while
		// paused, then replays them in order when the final lock is released.
		const s = node<number>(
			(_actions) => {
				// Manual producer — we drive it via node.emit from outside.
			},
			{ pausable: "resumeAll", initial: 0, describeKind: "state" },
		);
		const log: number[] = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) log.push(m[1] as number);
			}
		});
		const baseLog = log.length;

		const lock = Symbol("bufferAll");
		s.down([[PAUSE, lock]]);

		// While paused, emit three DATA values — they should be buffered, not
		// delivered live.
		s.emit(1);
		s.emit(2);
		s.emit(3);
		expect(log.length).toBe(baseLog); // nothing delivered while paused

		// Release the lock — buffered values replay in order.
		s.down([[RESUME, lock]]);
		expect(log.slice(baseLog)).toEqual([1, 2, 3]);
		expect(s.cache).toBe(3);

		unsub();
	});

	it("pausable: resumeAll — COMPLETE bypasses bufferAll and reaches subscribers even while paused", () => {
		// Spec §2.6 bufferAll: tier-4 (COMPLETE/ERROR) dispatches synchronously
		// even while a pause lock is held — stream-lifecycle signals must
		// reach observers regardless of flow control, parallel to tier-5
		// TEARDOWN's bypass. Prior to this: tier-4 was captured in pauseBuffer
		// and silently discarded at _deactivate if no RESUME ever came,
		// stranding subscribers without an end-of-stream signal.
		const s = node([], { pausable: "resumeAll", initial: 0 });
		const seen: Array<[symbol, unknown?]> = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push([m[0], m[1]]);
		});
		// Capture the index right after the subscribe handshake so we can
		// reason about only the post-activation trace (initial [[DATA, 0]]
		// push-on-subscribe is part of the handshake and not relevant here).
		const postActivation = seen.length;
		const lock = Symbol("held-indefinitely");
		s.down([[PAUSE, lock]]);
		s.emit(1); // captured in buffer, never observed (expected lost)
		s.emit(2); // captured in buffer, never observed (expected lost)
		s.down([[COMPLETE]]);
		const tail = seen.slice(postActivation);
		// Subscriber MUST observe COMPLETE even though lock is still held.
		expect(tail.map((m) => m[0])).toContain(COMPLETE);
		// Emits (1) and (2) must stay buffered — no DATA payload 1 or 2
		// reached the subscriber. (DIRTY/RESOLVED tier-1/3 bookkeeping is
		// orthogonal; specifically the deferred DATA values are absent.)
		for (const [t, v] of tail) {
			if (t === DATA) {
				expect(v).not.toBe(1);
				expect(v).not.toBe(2);
			}
		}
		unsub();
	});

	it("pausable: resumeAll — ERROR bypasses bufferAll and reaches subscribers even while paused", () => {
		// Companion to the COMPLETE test: tier-4 ERROR also bypasses bufferAll.
		const s = node([], { pausable: "resumeAll", initial: 0 });
		const seen: Array<{ type: symbol; value?: unknown }> = [];
		const unsub = s.subscribe((msgs) => {
			for (const m of msgs) seen.push({ type: m[0], value: m[1] });
		});
		const lock = Symbol("held");
		s.down([[PAUSE, lock]]);
		s.emit(1);
		const err = new Error("boom");
		s.down([[ERROR, err]]);
		const errorEntry = seen.find((e) => e.type === ERROR);
		expect(errorEntry).toBeDefined();
		expect(errorEntry?.value).toBe(err);
		unsub();
	});

	it("pause state is cleared on teardown — no leak, no cross-lifecycle bleed", () => {
		// Regression: bufferAll state (_pauseLocks, _pauseBuffer) used to
		// leak across _deactivate, which was both a memory leak on
		// non-resubscribable nodes and a correctness bug on resubscribable
		// nodes (new subscribers would see a permanently stuck node with
		// pauseLocks from a dead lifecycle).
		const s = node<number>([], {
			pausable: "resumeAll",
			resubscribable: true,
			initial: 0,
		}) as unknown as import("../../core/node.js").NodeImpl<number>;
		const lockOldLifecycle = Symbol("lock-old");

		const unsub = s.subscribe(() => undefined);
		s.down([[PAUSE, lockOldLifecycle]]);
		s.emit(1); // buffered
		s.emit(2); // buffered
		// Terminate the lifecycle WITHOUT releasing the lock.
		s.down([[COMPLETE]]);
		unsub();
		// After teardown the internal pause state should be clean.
		expect(s._pauseLocks).toBeNull();
		expect(s._pauseBuffer).toBeNull();
		expect(s._paused).toBe(false);

		// Resubscribable reset: new subscriber should see a clean node, not
		// a stuck-paused leftover from the previous lifecycle.
		const log: number[] = [];
		const unsub2 = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) log.push(m[1] as number);
		});
		expect(s._pauseLocks).toBeNull();
		expect(s._paused).toBe(false);
		// Emit a new value — should flow through, not get swallowed.
		s.emit(99);
		expect(log).toContain(99);
		unsub2();
	});
});

describe("globalInspector hook", () => {
	function freshConfig(): GraphReFlyConfig {
		const cfg = new GraphReFlyConfig({
			onMessage: defaultConfig.onMessage,
			onSubscribe: defaultConfig.onSubscribe,
		});
		registerBuiltins(cfg);
		return cfg;
	}

	it("fires once per outgoing batch with the final messages", () => {
		const cfg = freshConfig();
		const events: GlobalInspectorEvent[] = [];
		cfg.globalInspector = (ev) => events.push(ev);

		const s = node([], { config: cfg, initial: 0 });
		const off = s.subscribe(() => {});
		// Subscribe handshake delivers START + cached DATA via `downToSink`,
		// not through `_emit`'s framing waist — hook does not fire on handshake.
		expect(events.length).toBe(0);

		s.emit(1);
		expect(events.length).toBe(1);
		const ev = events[0]!;
		expect(ev.kind).toBe("emit");
		expect(ev.node).toBe(s);
		// finalMessages is post-equals: DIRTY + DATA(1).
		const types = ev.messages.map((m) => m[0]);
		expect(types).toContain(DIRTY);
		expect(types).toContain(DATA);

		off();
	});

	it("respects inspectorEnabled toggle (no fire when disabled)", () => {
		const cfg = freshConfig();
		cfg.inspectorEnabled = false;
		let calls = 0;
		cfg.globalInspector = () => {
			calls++;
		};

		const s = node([], { config: cfg, initial: 0 });
		const off = s.subscribe(() => {});
		s.emit(1);
		expect(calls).toBe(0);
		off();
	});

	it("swallows hook exceptions (instrumentation cannot break the data plane)", () => {
		const cfg = freshConfig();
		cfg.globalInspector = () => {
			throw new Error("inspector blew up");
		};

		const s = node([], { config: cfg, initial: 0 });
		const log: number[] = [];
		const off = s.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) log.push(m[1] as number);
		});
		expect(() => s.emit(42)).not.toThrow();
		expect(log).toContain(42);
		off();
	});

	it("settable at any time (does not freeze the config)", () => {
		const cfg = freshConfig();
		const s = node([], { config: cfg, initial: 0 });
		// Touching a hook getter freezes the config; touching globalInspector must not.
		const initial = cfg.globalInspector;
		expect(initial).toBeUndefined();
		// Setting after a node exists should still work.
		cfg.globalInspector = () => {};
		expect(cfg.globalInspector).toBeDefined();
		// Resetting to undefined unsubscribes.
		cfg.globalInspector = undefined;
		expect(cfg.globalInspector).toBeUndefined();
		void s;
	});
});
