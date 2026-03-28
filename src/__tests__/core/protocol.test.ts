import { describe, expect, it } from "vitest";
import { batch, emitWithBatch, isBatching, partitionForBatch } from "../../core/batch.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	INVALIDATE,
	knownMessageTypes,
	PAUSE,
	RESOLVED,
	RESUME,
	TEARDOWN,
} from "../../core/messages.js";

describe("message protocol", () => {
	it("exports distinct symbols for each known type", () => {
		const set = new Set(knownMessageTypes);
		expect(set.size).toBe(knownMessageTypes.length);
	});

	it("messages are arrays of [Type, Data?] tuples — no shorthand", () => {
		const msgs: readonly [typeof DATA, number][] = [[DATA, 42]];
		expect(msgs).toEqual([[DATA, 42]]);
	});

	it("partitionForBatch defers DATA and RESOLVED, not DIRTY", () => {
		const m = [DIRTY, DATA, RESOLVED, INVALIDATE] as const;
		const tuples = m.map((t) => [t] as const);
		const { immediate, deferred } = partitionForBatch(tuples);
		expect(immediate.map((x) => x[0])).toEqual([DIRTY, INVALIDATE]);
		expect(deferred.map((x) => x[0])).toEqual([DATA, RESOLVED]);
	});
});

describe("emitWithBatch", () => {
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

	it("empty messages is a no-op", () => {
		let n = 0;
		emitWithBatch(() => {
			n += 1;
		}, []);
		expect(n).toBe(0);
	});

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

	it("isBatching is false after drain completes", () => {
		batch(() => {
			emitWithBatch(() => undefined, [[DATA, 1]]);
		});
		expect(isBatching()).toBe(false);
	});

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

describe("terminal and control messages are not phase-2", () => {
	it("ERROR, COMPLETE, PAUSE, RESUME, TEARDOWN emit immediately even in batch", () => {
		for (const t of [ERROR, COMPLETE, PAUSE, RESUME, TEARDOWN] as const) {
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
});
