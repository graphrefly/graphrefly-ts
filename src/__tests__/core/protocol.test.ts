import { describe, expect, it } from "vitest";
import { batch, emitWithBatch, isBatching, partitionForBatch } from "../../core/batch.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	knownMessageTypes,
	type Messages,
	PAUSE,
	RESOLVED,
	RESUME,
	TEARDOWN,
} from "../../core/messages.js";
import { producer, state } from "../../core/sugar.js";
import { concatMap, exhaustMap, mergeMap, switchMap } from "../../extra/operators.js";

describe("message protocol", () => {
	// Regression: GRAPHREFLY-SPEC §1.2 — known types are distinct symbols (open set for forward compat).
	it("exports distinct symbols for each known type", () => {
		const set = new Set(knownMessageTypes);
		expect(set.size).toBe(knownMessageTypes.length);
	});

	// Regression: GRAPHREFLY-SPEC §1.1 — Messages are arrays of tuples; no single-message shorthand.
	it("messages are arrays of [Type, Data?] tuples — no shorthand", () => {
		const msgs: readonly [typeof DATA, number][] = [[DATA, 42]];
		expect(msgs).toEqual([[DATA, 42]]);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — batch defers phase-2 (DATA/RESOLVED), not DIRTY.
	it("partitionForBatch defers DATA and RESOLVED, not DIRTY", () => {
		const m = [DIRTY, DATA, RESOLVED, INVALIDATE] as const;
		const tuples = m.map((t) => [t] as const);
		const { immediate, deferred, terminal } = partitionForBatch(tuples);
		expect(immediate.map((x) => x[0])).toEqual([DIRTY, INVALIDATE]);
		expect(deferred.map((x) => x[0])).toEqual([DATA, RESOLVED]);
		expect(terminal).toEqual([]);
	});
});

describe("emitWithBatch", () => {
	// Regression: GRAPHREFLY-SPEC §1.3.1 — outside a batch, DIRTY reaches sinks before DATA.
	it("without batch: emits immediate then phase-2 in order", () => {
		const log: symbol[][] = [];
		emitWithBatch(
			(msgs) => {
				log.push(msgs.map((m) => m[0]));
			},
			[[DIRTY], [DATA, 1]],
		);
		expect(log).toEqual([[DIRTY], [DATA]]);
	});

	// Regression: phase-2 before terminal — COMPLETE alone would otherwise reach sinks before deferred DATA.
	it("without batch: DATA then COMPLETE when both appear in one emitWithBatch", () => {
		const log: symbol[][] = [];
		emitWithBatch(
			(msgs) => {
				log.push(msgs.map((m) => m[0]));
			},
			[[DATA, 1], [COMPLETE]],
		);
		expect(log).toEqual([[DATA], [COMPLETE]]);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — inside batch, DIRTY flushes immediately; DATA waits for batch end.
	it("inside batch: DIRTY immediate, DATA deferred until batch exits", () => {
		const log: symbol[][] = [];
		batch(() => {
			expect(isBatching()).toBe(true);
			emitWithBatch(
				(msgs) => {
					log.push(msgs.map((m) => m[0]));
				},
				[[DIRTY], [DATA, 42]],
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
			emitWithBatch(
				(msgs) => {
					log.push(msgs.map((m) => m[0]));
				},
				[[DIRTY], [RESOLVED]],
			);
			expect(log).toEqual([[DIRTY]]);
		});
		expect(log).toEqual([[DIRTY], [RESOLVED]]);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — nested batch: inner deferred work waits for outer drain.
	it("nested batch does not flush until outermost exits", () => {
		const log: string[] = [];
		batch(() => {
			emitWithBatch((msgs) => log.push(`a:${msgs[0]?.[0] === DATA ? "d" : "i"}`), [[DATA, 1]]);
			batch(() => {
				emitWithBatch((msgs) => log.push(`b:${msgs[0]?.[0] === DATA ? "d" : "i"}`), [[DATA, 2]]);
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
			emitWithBatch(
				(msgs) => {
					log.push(String(msgs[0]?.[0]));
				},
				[[CUSTOM, { x: 1 }]],
			);
			expect(log.length).toBe(1);
		});
		expect(log.length).toBe(1);
	});

	// Regression: GRAPHREFLY-SPEC §1.1 — empty batches are ignored.
	it("empty messages is a no-op", () => {
		let n = 0;
		emitWithBatch(() => {
			n += 1;
		}, []);
		expect(n).toBe(0);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — throwing during batch discards deferred phase-2 for that batch.
	it("does not flush deferred phase-2 when batch fn throws", () => {
		const log: symbol[][] = [];
		expect(() =>
			batch(() => {
				emitWithBatch(
					(msgs) => {
						log.push(msgs.map((m) => m[0]));
					},
					[[DATA, 1]],
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
				emitWithBatch(
					(msgs) => {
						log.push(msgs.map((m) => m[0]));
					},
					[[DATA, 1]],
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
			emitWithBatch(
				(_msgs) => {
					// This runs during drain — isBatching should be true
					batchingDuringDrain = isBatching();
					log.push("first-drain");
					// Nested emission during drain should be deferred
					emitWithBatch(
						(_msgs2) => {
							log.push("nested-drain");
						},
						[[DATA, 99]],
					);
				},
				[[DATA, 1]],
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
				emitWithBatch(() => {
					throw new Error("boom");
				}, [[DATA, 1]]);
				emitWithBatch(() => {
					log.push("second");
				}, [[DATA, 2]]);
			}),
		).toThrow("boom");

		// Second callback should still have run despite first throwing
		expect(log).toEqual(["second"]);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — after outermost batch exits, `isBatching` is false.
	it("isBatching is false after drain completes", () => {
		batch(() => {
			emitWithBatch(() => undefined, [[DATA, 1]]);
		});
		expect(isBatching()).toBe(false);
	});

	// Regression: GRAPHREFLY-SPEC §1.3.7 — nested throw during drain: outer deferred items still run where specified (A4).
	it("nested batch throw during drain does not clear outer deferral queue (A4)", () => {
		const log: string[] = [];
		expect(() =>
			batch(() => {
				emitWithBatch(() => {
					emitWithBatch(() => {
						log.push("deferred-from-callback");
					}, [[DATA, 1]]);
					batch(() => {
						throw new Error("inner");
					});
				}, [[DATA, 0]]);
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
					emitWithBatch(() => {
						// re-enqueue indefinitely
						emitWithBatch(() => cyclicEmit(), [[DATA, 1]]);
					}, [[DATA, 0]]);
				};
				cyclicEmit();
			}),
		).toThrow(/reactive cycle/);
	});
});

describe("terminal and control messages are not phase-2", () => {
	// Regression: GRAPHREFLY-SPEC §1.2 — PAUSE, RESUME, TEARDOWN emit immediately even in batch.
	it("PAUSE, RESUME, TEARDOWN emit immediately in batch", () => {
		for (const t of [PAUSE, RESUME, TEARDOWN] as const) {
			const log: symbol[] = [];
			batch(() => {
				emitWithBatch(
					(msgs) => {
						log.push(msgs[0]?.[0] as symbol);
					},
					[[t]],
				);
				expect(log).toEqual([t]);
			});
			expect(log).toEqual([t]);
		}
	});

	// Canonical ordering: terminal signals (COMPLETE, ERROR) are tier 3 — deferred to
	// after phase-2 inside a batch, so DATA/RESOLVED reach sinks before node goes terminal.
	it("ERROR, COMPLETE are deferred (tier 3) — delivered after phase-2 in batch", () => {
		for (const t of [ERROR, COMPLETE] as const) {
			const log: symbol[] = [];
			batch(() => {
				emitWithBatch(
					(msgs) => {
						log.push(msgs[0]?.[0] as symbol);
					},
					[[t]],
				);
				// Terminal is deferred inside batch (tier 3).
				expect(log).toEqual([]);
			});
			// Delivered on batch exit.
			expect(log).toEqual([t]);
		}
	});

	// Canonical ordering: [[DATA, v], [COMPLETE]] delivers DATA before COMPLETE.
	it("DATA before COMPLETE in composite batch (one-shot source pattern)", () => {
		const log: symbol[][] = [];
		emitWithBatch(
			(msgs) => {
				log.push(msgs.map((m) => m[0]));
			},
			[[DATA, undefined], [COMPLETE]],
		);
		expect(log).toEqual([[DATA], [COMPLETE]]);
	});

	// Canonical ordering with all three tiers present.
	it("DIRTY then DATA then COMPLETE in composite batch", () => {
		const log: symbol[][] = [];
		emitWithBatch(
			(msgs) => {
				log.push(msgs.map((m) => m[0]));
			},
			[[DIRTY], [DATA, 42], [COMPLETE]],
		);
		expect(log).toEqual([[DIRTY], [DATA], [COMPLETE]]);
	});

	// Inside batch: immediate, then deferred phase-2, then deferred terminal.
	it("inside batch: DIRTY immediate, DATA and COMPLETE deferred in order", () => {
		const log: symbol[][] = [];
		batch(() => {
			emitWithBatch(
				(msgs) => {
					log.push(msgs.map((m) => m[0]));
				},
				[[DIRTY], [DATA, 1], [COMPLETE]],
			);
			// Only DIRTY is immediate.
			expect(log).toEqual([[DIRTY]]);
		});
		// After batch: DATA then COMPLETE.
		expect(log).toEqual([[DIRTY], [DATA], [COMPLETE]]);
	});
});

describe("integration: void sources and operator chains", () => {
	// Regression: one-shot sources (IDB, Promise wrappers) emitting [[DATA, undefined], [COMPLETE]]
	// through switchMap previously broke because COMPLETE was delivered before DATA.
	it("one-shot void producer delivers DATA(undefined) then COMPLETE to subscriber", () => {
		const log: [symbol, unknown?][] = [];
		// Simulate a one-shot void source (like fromIDBTransaction)
		const oneShot = producer<void>((_d, a) => {
			a.down([[DATA, undefined], [COMPLETE]]);
		});
		const unsub = oneShot.subscribe((msgs: Messages) => {
			for (const m of msgs) log.push([m[0], m[1]]);
		});
		// DATA(undefined) should arrive before COMPLETE.
		expect(log.map((m) => m[0])).toEqual([DATA, COMPLETE]);
		expect(log[0][1]).toBe(undefined);
		unsub();
	});

	it("switchMap with void inner source receives DATA(undefined) before COMPLETE", () => {
		const log: [symbol, unknown?][] = [];
		const src = state(1);
		const out = switchMap(src, () =>
			producer<void>((_d, a) => {
				a.down([[DATA, undefined], [COMPLETE]]);
			}),
		);
		const unsub = out.subscribe((msgs: Messages) => {
			for (const m of msgs) log.push([m[0], m[1]]);
		});
		// switchMap should forward DATA(undefined) from inner, then COMPLETE after inner completes + source done.
		const types = log.map((m) => m[0]);
		expect(types).toContain(DATA);
		// DATA should appear before any COMPLETE.
		const dataIdx = types.indexOf(DATA);
		const completeIdx = types.indexOf(COMPLETE);
		if (completeIdx >= 0) {
			expect(dataIdx).toBeLessThan(completeIdx);
		}
		unsub();
	});

	it("concatMap with void inner source receives DATA(undefined) before COMPLETE", () => {
		const log: [symbol, unknown?][] = [];
		const src = state(1);
		const out = concatMap(src, () =>
			producer<void>((_d, a) => {
				a.down([[DATA, undefined], [COMPLETE]]);
			}),
		);
		const unsub = out.subscribe((msgs: Messages) => {
			for (const m of msgs) log.push([m[0], m[1]]);
		});
		const types = log.map((m) => m[0]);
		expect(types).toContain(DATA);
		const dataIdx = types.indexOf(DATA);
		const completeIdx = types.indexOf(COMPLETE);
		if (completeIdx >= 0) {
			expect(dataIdx).toBeLessThan(completeIdx);
		}
		unsub();
	});

	it("mergeMap with void inner source receives DATA(undefined) before COMPLETE", () => {
		const log: [symbol, unknown?][] = [];
		const src = state(1);
		const out = mergeMap(src, () =>
			producer<void>((_d, a) => {
				a.down([[DATA, undefined], [COMPLETE]]);
			}),
		);
		const unsub = out.subscribe((msgs: Messages) => {
			for (const m of msgs) log.push([m[0], m[1]]);
		});
		const types = log.map((m) => m[0]);
		expect(types).toContain(DATA);
		const dataIdx = types.indexOf(DATA);
		const completeIdx = types.indexOf(COMPLETE);
		if (completeIdx >= 0) {
			expect(dataIdx).toBeLessThan(completeIdx);
		}
		unsub();
	});

	it("exhaustMap with void inner source receives DATA(undefined) before COMPLETE", () => {
		const log: [symbol, unknown?][] = [];
		const src = state(1);
		const out = exhaustMap(src, () =>
			producer<void>((_d, a) => {
				a.down([[DATA, undefined], [COMPLETE]]);
			}),
		);
		const unsub = out.subscribe((msgs: Messages) => {
			for (const m of msgs) log.push([m[0], m[1]]);
		});
		const types = log.map((m) => m[0]);
		expect(types).toContain(DATA);
		const dataIdx = types.indexOf(DATA);
		const completeIdx = types.indexOf(COMPLETE);
		if (completeIdx >= 0) {
			expect(dataIdx).toBeLessThan(completeIdx);
		}
		unsub();
	});

	it("partitionForBatch three-way split: DIRTY + DATA + COMPLETE", () => {
		const msgs: Messages = [[DIRTY], [DATA, 42], [COMPLETE]];
		const { immediate, deferred, terminal } = partitionForBatch(msgs);
		expect(immediate.map((m) => m[0])).toEqual([DIRTY]);
		expect(deferred.map((m) => m[0])).toEqual([DATA]);
		expect(terminal.map((m) => m[0])).toEqual([COMPLETE]);
	});

	it("partitionForBatch: ERROR is terminal tier", () => {
		const msgs: Messages = [
			[DATA, 1],
			[ERROR, new Error("oops")],
		];
		const { immediate, deferred, terminal } = partitionForBatch(msgs);
		expect(immediate).toEqual([]);
		expect(deferred.map((m) => m[0])).toEqual([DATA]);
		expect(terminal.map((m) => m[0])).toEqual([ERROR]);
	});
});
