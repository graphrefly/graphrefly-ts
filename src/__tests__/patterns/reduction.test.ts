// FLAG: v5 behavioral change — needs investigation
// stratify and feedback tests fail with:
//   Graph "...": connect(source, target) — target must include source in its constructor deps (same node reference)
// The underlying pattern factories use Graph.connect() which now enforces deps.

import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { COMPLETE, DATA, ERROR, type Messages } from "../../core/messages.js";
import { state } from "../../core/sugar.js";
import { budgetGate } from "../../extra/resilience/budget-gate.js";
import { type StratifyRule, stratify } from "../../extra/stratify.js";
import { Graph } from "../../graph/graph.js";
import { feedback, funnel, scorer } from "../../patterns/reduction/index.js";

// ---------------------------------------------------------------------------
// stratify
// ---------------------------------------------------------------------------

describe("reduction.stratify", () => {
	it("routes values to matching branches", () => {
		const source = state<number>(0);
		const rules: StratifyRule<number>[] = [
			{ name: "even", classify: (v) => v % 2 === 0 },
			{ name: "odd", classify: (v) => v % 2 !== 0 },
		];

		const g = stratify("classify", source, rules);
		expect(g).toBeInstanceOf(Graph);

		const evenSeen: number[] = [];
		const oddSeen: number[] = [];

		g.resolve("branch/even").subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) evenSeen.push(msg[1] as number);
			}
		});
		g.resolve("branch/odd").subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) oddSeen.push(msg[1] as number);
			}
		});
		// Clear initial push-on-subscribe emissions
		evenSeen.length = 0;
		oddSeen.length = 0;

		source.down([[DATA, 2]]);
		source.down([[DATA, 3]]);
		source.down([[DATA, 4]]);
		source.down([[DATA, 7]]);

		expect(evenSeen).toEqual([2, 4]);
		expect(oddSeen).toEqual([3, 7]);
	});

	it("reactive rules: rewriting rules at runtime changes classification", () => {
		const source = state<string>("");
		const rules: StratifyRule<string>[] = [{ name: "match", classify: (v) => v === "a" }];

		const g = stratify("dynamic", source, rules);

		const seen: string[] = [];
		g.resolve("branch/match").subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) seen.push(msg[1] as string);
			}
		});
		// Clear initial push-on-subscribe emissions (initial "" doesn't match rule)
		seen.length = 0;

		source.down([[DATA, "a"]]);
		expect(seen).toEqual(["a"]);

		// Rewrite rules: now match "b" instead
		g.set("rules", [{ name: "match", classify: (v: string) => v === "b" }]);
		source.down([[DATA, "a"]]);
		source.down([[DATA, "b"]]);
		expect(seen).toEqual(["a", "b"]);
	});

	it("graph has source node and branch node registered", () => {
		// Stratify's branch nodes use the producer pattern (manual subscription
		// to `source`), so the source→branch wire is not a constructor dep and
		// is not reflected in edges() / describe(). This test asserts the
		// registry-level surface rather than the derived edge.
		const source = state(0);
		const rules: StratifyRule<number>[] = [{ name: "pos", classify: (v) => v > 0 }];

		const g = stratify("edges", source, rules);
		expect(g.node("source")).toBeDefined();
		expect(g.node("branch/pos")).toBeDefined();
	});

	it("propagates COMPLETE through branches", () => {
		const source = state<number>(0);
		const rules: StratifyRule<number>[] = [{ name: "all", classify: () => true }];

		const g = stratify("term", source, rules);
		let completed = false;
		g.resolve("branch/all").subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === COMPLETE) completed = true;
			}
		});

		source.down([[COMPLETE]]);
		expect(completed).toBe(true);
	});

	it("two-dep gating: batch source + rules uses settled rules", () => {
		const source = state<string>("x");
		const rules: StratifyRule<string>[] = [{ name: "match", classify: (v) => v === "a" }];

		const g = stratify("gate", source, rules);

		const seen: string[] = [];
		g.resolve("branch/match").subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) seen.push(msg[1] as string);
			}
		});

		// Batch: update rules to match "b" AND send source "b" simultaneously.
		// Without two-dep gating, classification would use old rules (match "a")
		// and "b" would be dropped.  With gating, both settle first.
		batch(() => {
			g.set("rules", [{ name: "match", classify: (v: string) => v === "b" }]);
			source.down([[DATA, "b"]]);
		});

		expect(seen).toEqual(["b"]);
	});

	it("source-only update still classifies correctly", () => {
		const source = state<number>(0);
		const rules: StratifyRule<number>[] = [{ name: "pos", classify: (v) => v > 0 }];

		const g = stratify("src-only", source, rules);
		const seen: number[] = [];
		g.resolve("branch/pos").subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) seen.push(msg[1] as number);
			}
		});

		source.down([[DATA, 5]]);
		source.down([[DATA, -1]]);
		source.down([[DATA, 3]]);
		expect(seen).toEqual([5, 3]);
	});

	it("rules-only update produces no downstream emission", () => {
		const source = state<string>("a");
		const rules: StratifyRule<string>[] = [{ name: "match", classify: (v) => v === "a" }];

		const g = stratify("rules-only", source, rules);
		const emissions: Messages = [];
		g.resolve("branch/match").subscribe((msgs: Messages) => {
			emissions.push(...msgs);
		});

		source.down([[DATA, "a"]]);
		const initialCount = emissions.length;

		// Change rules only — should NOT produce any new downstream messages
		g.set("rules", [{ name: "match", classify: (v: string) => v === "b" }]);
		expect(emissions.length).toBe(initialCount);
	});

	it("rules-only update after source settlement produces no spurious data", () => {
		const source = state<string>("");
		const rules: StratifyRule<string>[] = [{ name: "match", classify: (v) => v === "x" }];

		const g = stratify("resolved", source, rules);

		const dataSeen: string[] = [];
		g.resolve("branch/match").subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) dataSeen.push(msg[1] as string);
			}
		});
		// Clear initial push-on-subscribe emissions (initial "" doesn't match)
		dataSeen.length = 0;

		// Initial emission
		source.down([[DATA, "x"]]);
		expect(dataSeen).toEqual(["x"]);

		// Update rules in isolation — source not involved
		g.set("rules", [{ name: "match", classify: (v: string) => v === "y" }]);
		// No new data should appear
		expect(dataSeen).toEqual(["x"]);
	});
});

// ---------------------------------------------------------------------------
// funnel
// ---------------------------------------------------------------------------

describe("reduction.funnel", () => {
	it("merges sources and pipes through stages", () => {
		const s1 = state<number>(0);
		const s2 = state<number>(0);

		const g = funnel(
			"pipe",
			[s1, s2],
			[
				{
					name: "double",
					build(sub) {
						const input = state<number>(0);
						sub.add(input, { name: "input" });
						const output = state<number>(0);
						sub.add(output, { name: "output" });
						// Wire: when input gets DATA, double it and set output
						input.subscribe((msgs: Messages) => {
							for (const msg of msgs) {
								if (msg[0] === DATA) {
									output.down([[DATA, (msg[1] as number) * 2]]);
								}
							}
						});
					},
				},
			],
		);

		expect(g).toBeInstanceOf(Graph);

		const results: number[] = [];
		g.resolve("double::output").subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) results.push(msg[1] as number);
			}
		});
		// Clear initial push-on-subscribe emissions
		results.length = 0;

		s1.down([[DATA, 5]]);
		s2.down([[DATA, 3]]);

		expect(results).toEqual([10, 6]);
	});

	it("rejects empty sources", () => {
		expect(() => funnel("bad", [], [{ name: "s", build: () => {} }])).toThrow(
			"at least one source",
		);
	});

	it("rejects empty stages", () => {
		expect(() => funnel("bad", [state(0)], [])).toThrow("at least one stage");
	});

	it("rejects stage without input node", () => {
		expect(() =>
			funnel(
				"bad",
				[state(0)],
				[
					{
						name: "noInput",
						build(sub) {
							sub.add(state(0), { name: "output" });
						},
					},
				],
			),
		).toThrow('must define an "input" node');
	});

	it("rejects stage without output node", () => {
		expect(() =>
			funnel(
				"bad",
				[state(0)],
				[
					{
						name: "noOutput",
						build(sub) {
							sub.add(state(0), { name: "input" });
						},
					},
				],
			),
		).toThrow('must define an "output" node');
	});
});

// ---------------------------------------------------------------------------
// feedback
// ---------------------------------------------------------------------------

describe("reduction.feedback", () => {
	it("routes condition output back to reentry", () => {
		const g = new Graph("fb");
		const input = state<number>(0);
		g.add(input, { name: "input" });

		// Condition: pass through if < 5
		const cond = state<number | null>(null);
		g.add(cond, { name: "condition" });

		// Wire: input → condition (simplified: effect watches input, writes to condition)
		const inputNode = g.resolve("input");
		inputNode.subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) {
					const v = msg[1] as number;
					cond.down([[DATA, v < 5 ? v + 1 : null]]);
				}
			}
		});

		feedback(g, "condition", "input", { maxIterations: 10 });

		const seen: number[] = [];
		inputNode.subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) seen.push(msg[1] as number);
			}
		});

		// Kick off: set input to 1 → condition emits 2 → feedback → input=2 → ... → 5 → null (stops)
		input.down([[DATA, 1]]);

		// Should have iterated: 1, 2, 3, 4, 5
		expect(seen).toContain(1);
		expect(seen.length).toBeGreaterThanOrEqual(1);
		// The counter should have advanced
		const counter = g.get("__feedback_condition") as number;
		expect(counter).toBeGreaterThan(0);
	});

	it("respects maxIterations bound", () => {
		const g = new Graph("bounded");
		const input = state<number>(0);
		g.add(input, { name: "input" });

		// Always-true condition → infinite feedback without bound
		const cond = state<number>(0);
		g.add(cond, { name: "condition" });

		input.subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) {
					cond.down([[DATA, (msg[1] as number) + 1]]);
				}
			}
		});

		feedback(g, "condition", "input", { maxIterations: 3 });

		// Subscribe to activate
		cond.subscribe(() => undefined);

		input.down([[DATA, 0]]);

		const counter = g.get("__feedback_condition") as number;
		expect(counter).toBeLessThanOrEqual(3);
	});
});

// ---------------------------------------------------------------------------
// budgetGate
// ---------------------------------------------------------------------------

describe("reduction.budgetGate", () => {
	it("passes DATA when budget is available", () => {
		const source = state<number>(0);
		const budget = state<number>(100); // budget = 100
		const gated = budgetGate(source, [{ node: budget, check: (v) => (v as number) > 0 }]);

		const seen: number[] = [];
		gated.subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) seen.push(msg[1] as number);
			}
		});
		// Clear initial push-on-subscribe emissions
		seen.length = 0;

		source.down([[DATA, 42]]);
		expect(seen).toEqual([42]);
	});

	it("buffers DATA when budget exhausted, flushes on replenish", () => {
		const source = state<number>(0);
		const budget = state<number>(0); // exhausted

		const gated = budgetGate(source, [{ node: budget, check: (v) => (v as number) > 0 }]);

		const seen: number[] = [];
		gated.subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) seen.push(msg[1] as number);
			}
		});

		// Push-on-subscribe delivers initial 0 which gets buffered (budget=0).
		// Clear the seen array; the buffered initial is still in the gate's internal buffer.
		seen.length = 0;

		source.down([[DATA, 1]]);
		source.down([[DATA, 2]]);
		expect(seen).toEqual([]); // buffered

		// Replenish budget — flushes buffered initial 0, plus 1 and 2
		budget.down([[DATA, 50]]);
		expect(seen).toEqual([0, 1, 2]); // flushed (includes initial push-on-subscribe value)
	});

	it("rejects zero constraints", () => {
		expect(() => budgetGate(state(0), [])).toThrow("at least one constraint");
	});

	it("propagates COMPLETE and flushes buffer", () => {
		const source = state<number>(0);
		const budget = state<number>(0);
		const gated = budgetGate(source, [{ node: budget, check: (v) => (v as number) > 0 }]);

		const seen: number[] = [];
		let completed = false;
		gated.subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) seen.push(msg[1] as number);
				if (msg[0] === COMPLETE) completed = true;
			}
		});

		source.down([[DATA, 10]]);
		source.down([[COMPLETE]]);
		// Buffer flushed on COMPLETE even though budget is 0
		// (flushBuffer checks budget, but we still get COMPLETE)
		expect(completed).toBe(true);
	});

	it("propagates ERROR", () => {
		const source = state<number>(0);
		const budget = state<number>(100);
		const gated = budgetGate(source, [{ node: budget, check: (v) => (v as number) > 0 }]);

		let errored = false;
		gated.subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === ERROR) errored = true;
			}
		});

		source.down([[ERROR, new Error("boom")]]);
		expect(errored).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// scorer
// ---------------------------------------------------------------------------

describe("reduction.scorer", () => {
	it("computes weighted scores from signal and weight nodes", () => {
		const sig1 = state<number>(0);
		const sig2 = state<number>(0);
		const w1 = state<number>(1);
		const w2 = state<number>(1);

		const s = scorer([sig1, sig2], [w1, w2]);

		let result: { value: number[]; score: number; breakdown: number[] } | undefined;
		s.subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA)
					result = msg[1] as { value: number[]; score: number; breakdown: number[] };
			}
		});

		sig1.down([[DATA, 3]]);
		sig2.down([[DATA, 7]]);

		expect(result).toBeDefined();
		expect(result!.value).toEqual([3, 7]);
		expect(result!.score).toBe(10); // 3*1 + 7*1
		expect(result!.breakdown).toEqual([3, 7]);
	});

	it("reacts to weight changes", () => {
		const sig1 = state<number>(5);
		const w1 = state<number>(1);

		const s = scorer([sig1], [w1]);

		let result: { score: number } | undefined;
		s.subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) result = msg[1] as { score: number };
			}
		});

		sig1.down([[DATA, 5]]);
		expect(result!.score).toBe(5);

		w1.down([[DATA, 3]]);
		expect(result!.score).toBe(15); // 5 * 3
	});

	it("supports custom scoreFns", () => {
		const sig1 = state<number>(0);
		const w1 = state<number>(1);

		const s = scorer([sig1], [w1], {
			scoreFns: [(v) => (v as number) ** 2], // square the signal
		});

		let result: { score: number } | undefined;
		s.subscribe((msgs: Messages) => {
			for (const msg of msgs) {
				if (msg[0] === DATA) result = msg[1] as { score: number };
			}
		});

		sig1.down([[DATA, 4]]);
		expect(result!.score).toBe(16); // 4^2 * 1
	});

	it("rejects mismatched sources/weights", () => {
		expect(() => scorer([state(0), state(0)], [state(1)])).toThrow(
			"same number of sources and weights",
		);
	});

	it("rejects empty sources", () => {
		expect(() => scorer([], [])).toThrow("at least one source");
	});

	it("has reduction meta", () => {
		const s = scorer([state(0)], [state(1)]);
		const meta = s.meta;
		expect(meta.reduction.cache).toBe(true);
		expect(meta.reduction_type.cache).toBe("scorer");
	});
});
