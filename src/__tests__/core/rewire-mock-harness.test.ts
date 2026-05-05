/**
 * Phase 13.8 — mock AI self-pruning harness scenario for `_rewire`.
 *
 * Per `project_rewire_gap` memory: "AI self-pruning of harness topology"
 * is the founding use case for rewire. This test builds the canonical
 * scenario from the implementation-plan §13.8 deliverable list.
 *
 * If the API can't express this cleanly, the rewire shape is wrong —
 * findings flow back into `rewire-gap-findings.md`.
 *
 * Also covers Phase 13.8 Scenario 9 — `graph._rewire("mount::leaf", [...])`
 * across mount boundaries.
 */

import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { COMPLETE, DATA } from "../../core/messages.js";
import type { Node, NodeFn, NodeImpl } from "../../core/node.js";
import { node } from "../../core/node.js";
import { Graph, type TopologyEvent } from "../../graph/graph.js";

// Test helper: read the current `_fn` off a node so rewire calls can pass
// the existing fn explicitly (the substrate API requires fn at every call).
const fnOf = (n: Node): NodeFn => (n as NodeImpl)._fn as NodeFn;
// No-op fn for guard-rejection tests where the fn argument never runs.
const noopFn: NodeFn = () => {};

describe("Phase 13.8 — graph._rewire mock-harness scenario", () => {
	// ─────────────────────────────────────────────────────────────────────
	// Mock AI self-pruning harness
	// ─────────────────────────────────────────────────────────────────────

	it("AI self-pruning: graph rewires `score` to bypass redundant `enrich` wrapper", () => {
		const g = new Graph("harness");

		// Pipeline: ingest → enrich → score → output
		const ingest = g.add(node<number>({ initial: 1 }), { name: "ingest" });
		const enrich = g.add(
			node<number>([ingest], (data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				// Pretend-enrich: add 10 (sometimes a no-op for some inputs).
				actions.emit(((v as number) ?? 0) + 10);
			}),
			{ name: "enrich" },
		);
		const score = g.add(
			node<number>([enrich], (data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit(((v as number) ?? 0) * 2);
			}),
			{ name: "score" },
		);
		const output = g.add(
			node<number>([score], (data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit(v as number);
			}),
			{ name: "output" },
		);

		const seen: number[] = [];
		output.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) seen.push(m[1] as number);
		});

		// Initial wiring: 1 → enrich(11) → score(22) → output(22)
		expect(output.cache).toBe(22);

		// AI decides `enrich` is no-op-grade for current inputs and prunes
		// it: rewire `score` to read directly from `ingest`. Same fn (score
		// computes `data[0] * 2` and `ingest` produces a number, same shape
		// as the old `enrich` dep).
		const audit = g._rewire("score", ["ingest"], fnOf(score));

		expect(audit.removed).toEqual(["enrich"]);
		expect(audit.added).toEqual(["ingest"]);
		expect(audit.kept).toEqual([]);

		// New wiring: 1 → score(2) → output(2)
		expect(output.cache).toBe(2);
		// Stream saw both pre- and post-rewire values.
		expect(seen).toContain(22);
		expect(seen.at(-1)).toBe(2);

		// `enrich` was unsubscribed by score's rewire, but still registered
		// on the graph. Removing it via graph.remove should not affect score.
		g.remove("enrich");
		expect(score.cache).toBe(2);
		expect(output.cache).toBe(2);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Topology event emission
	// ─────────────────────────────────────────────────────────────────────

	it("emits TopologyEvent { kind: 'rewired', name, audit } on graph.topology", () => {
		const g = new Graph("g");
		const a = g.add(node<number>({ initial: 1 }), { name: "a" });
		const b = g.add(node<number>({ initial: 2 }), { name: "b" });
		const c = g.add(
			node<number>([a], (data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit((v as number) * 10);
			}),
			{ name: "c" },
		);
		void b;
		c.subscribe(() => {});

		const events: TopologyEvent[] = [];
		g.topology.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) events.push(m[1] as TopologyEvent);
		});

		const audit = g._rewire("c", ["b"], fnOf(c));

		const rewired = events.find((e) => e.kind === "rewired");
		expect(rewired).toBeDefined();
		expect(rewired?.name).toBe("c");
		expect((rewired as { audit: typeof audit }).audit).toEqual(audit);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario 9 — cross-mount rewire
	// ─────────────────────────────────────────────────────────────────────

	it("scenario 9: graph._rewire with cross-mount path resolves via `mount::leaf`", () => {
		const root = new Graph("root");
		const child = new Graph("child");
		root.mount("child", child);

		const inner = child.add(node<number>({ initial: 5 }), { name: "inner" });
		void inner;
		const a = root.add(node<number>({ initial: 1 }), { name: "a" });
		void a;
		const consumer = root.add(
			node<number>([a], (data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit((v as number) * 10);
			}),
			{ name: "consumer" },
		);
		consumer.subscribe(() => {});
		expect(consumer.cache).toBe(10);

		// Rewire consumer to point at child::inner. Same fn (multiplication
		// of a single dep value).
		const audit = root._rewire("consumer", ["child::inner"], fnOf(consumer));
		expect(audit.removed).toEqual(["a"]);
		expect(audit.added).toEqual(["child::inner"]);

		expect(consumer.cache).toBe(50);
	});

	it("scenario 9b: cross-mount cycle rejection works through reachability check", () => {
		const root = new Graph("root");
		const child = new Graph("child");
		root.mount("child", child);

		const inner = child.add(node<number>({ initial: 1 }), { name: "inner" });
		void inner;
		const a = root.add(
			node<number>(
				["child::inner"].map((p) => root.resolve(p)),
				(data, actions, ctx) => {
					const v = data[0]?.[0] ?? ctx.prevData[0];
					actions.emit((v as number) + 1);
				},
			),
			{ name: "a" },
		);
		void a;

		// Try to make `child::inner` depend on `a` — would create cycle
		// inner → a → inner.
		expect(() => root._rewire("child::inner", ["a"], noopFn)).toThrowError(/would create cycle/);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Edge cases unique to the Graph layer
	// ─────────────────────────────────────────────────────────────────────

	it("rewire on a foreign Node not registered raises a clear error", () => {
		const g = new Graph("g");
		expect(() => g._rewire("nonexistent", [], noopFn)).toThrowError(/unknown node/);
	});

	it("audit kept[] reflects deps present in both old and new sets", () => {
		const g = new Graph("g");
		const a = g.add(node<number>({ initial: 1 }), { name: "a" });
		const b = g.add(node<number>({ initial: 2 }), { name: "b" });
		const c = g.add(node<number>({ initial: 3 }), { name: "c" });
		void a;
		void b;
		void c;
		const sink = g.add(
			node<number>([a, b], (data, actions, ctx) => {
				const av = data[0]?.[0] ?? ctx.prevData[0];
				const bv = data[1]?.[0] ?? ctx.prevData[1];
				actions.emit(((av as number) ?? 0) + ((bv as number) ?? 0));
			}),
			{ name: "sink" },
		);
		sink.subscribe(() => {});

		const audit = g._rewire("sink", ["a", "c"], fnOf(sink));
		expect(audit.kept).toEqual(["a"]);
		expect(audit.removed).toEqual(["b"]);
		expect(audit.added).toEqual(["c"]);
	});

	it("reverse-rewire from a back to enrich restores the prior topology", () => {
		const g = new Graph("g");
		const ingest = g.add(node<number>({ initial: 1 }), { name: "ingest" });
		const enrich = g.add(
			node<number>([ingest], (data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit(((v as number) ?? 0) + 10);
			}),
			{ name: "enrich" },
		);
		void enrich;
		const score = g.add(
			node<number>([enrich], (data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit(((v as number) ?? 0) * 2);
			}),
			{ name: "score" },
		);
		score.subscribe(() => {});
		expect(score.cache).toBe(22);

		const scoreFn = fnOf(score);
		g._rewire("score", ["ingest"], scoreFn);
		expect(score.cache).toBe(2);

		// Reverse: re-attach to enrich. Note enrich was decoupled from score
		// but still registered on the graph and its subscription survived
		// (or got dropped — depends on lifecycle). Since enrich had only
		// score as a downstream and score unsubscribed, enrich deactivated.
		// On rewire-to-enrich, score re-subscribes → enrich re-activates.
		g._rewire("score", ["enrich"], scoreFn);
		expect(score.cache).toBe(22);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Surface check: terminal-ed deps in the harness still propagate
	// ─────────────────────────────────────────────────────────────────────

	it("harness lifecycle: COMPLETE on ingest after rewire-away does NOT cascade to score", () => {
		const g = new Graph("g");
		const ingest = g.add(node<number>({ initial: 1 }), { name: "ingest" });
		const enrich = g.add(
			node<number>([ingest], (data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit(((v as number) ?? 0) + 10);
			}),
			{ name: "enrich" },
		);
		const score = g.add(
			node<number>([enrich], (data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit(((v as number) ?? 0) * 2);
			}),
			{ name: "score" },
		);
		score.subscribe(() => {});

		// Rewire score off enrich, onto a fresh source.
		const fresh = g.add(node<number>({ initial: 5 }), { name: "fresh" });
		void fresh;
		g._rewire("score", ["fresh"], fnOf(score));

		// Now COMPLETE enrich. score is no longer subscribed to enrich →
		// no cascade.
		enrich.down([[COMPLETE]]);
		expect(score.status).not.toBe("completed");
	});

	// ─────────────────────────────────────────────────────────────────────
	// Mid-batch rewire at the Graph layer
	// ─────────────────────────────────────────────────────────────────────

	it("graph._rewire and graph.set in the same batch — rewire wins, set queued against new dep", () => {
		const g = new Graph("g");
		const a = g.add(node<number>({ initial: 1 }), { name: "a" });
		const b = g.add(node<number>({ initial: 100 }), { name: "b" });
		void a;
		void b;
		const c = g.add(
			node<number>([a], (data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit((v as number) * 10);
			}),
			{ name: "c" },
		);
		c.subscribe(() => {});
		expect(c.cache).toBe(10);

		// Inside one batch: set b to 200, rewire c to b. Order of ops
		// matters — set b first, rewire after, so c sees b=200.
		batch(() => {
			g.set("b", 200);
			g._rewire("c", ["b"], fnOf(c));
		});
		expect(c.cache).toBe(2000);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Graph-layer _addDep / _removeDep / _rewire opts.fn
	// ─────────────────────────────────────────────────────────────────────

	it("graph._addDep with opts.fn: append new dep + replace fn via path resolution", () => {
		const g = new Graph("g");
		const a = g.add(node<number>({ initial: 3 }), { name: "a" });
		const b = g.add(node<number>({ initial: 4 }), { name: "b" });
		void b;
		const c = g.add(
			node<number>([a], (data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit((v as number) * 2);
			}),
			{ name: "c" },
		);
		c.subscribe(() => {});
		expect(c.cache).toBe(6);

		// Append b by path; supply new fn that uses both deps.
		const idx = g._addDep("c", "b", (data, actions, ctx) => {
			const av = data[0]?.[0] ?? ctx.prevData[0];
			const bv = data[1]?.[0] ?? ctx.prevData[1];
			actions.emit(((av as number) ?? 0) * ((bv as number) ?? 0));
		});
		expect(idx).toBe(1);
		expect(c.cache).toBe(12); // 3 * 4
	});

	it("graph._removeDep with opts.fn: drop dep + replace fn via path resolution", () => {
		const g = new Graph("g");
		const a = g.add(node<number>({ initial: 5 }), { name: "a" });
		const b = g.add(node<number>({ initial: 10 }), { name: "b" });
		void a;
		void b;
		const c = g.add(
			node<number>([a, b], (data, actions, ctx) => {
				const av = data[0]?.[0] ?? ctx.prevData[0];
				const bv = data[1]?.[0] ?? ctx.prevData[1];
				actions.emit(((av as number) ?? 0) + ((bv as number) ?? 0));
			}),
			{ name: "c" },
		);
		c.subscribe(() => {});
		expect(c.cache).toBe(15);

		// Drop b by path; supply fn that consumes only a.
		g._removeDep("c", "b", (data, actions, ctx) => {
			const v = data[0]?.[0] ?? ctx.prevData[0];
			actions.emit((v as number) * 100);
		});

		g.set("a", 7);
		expect(c.cache).toBe(700);
	});

	it("graph._rewire with opts.fn: full rewire including fn replacement", () => {
		const g = new Graph("g");
		const a = g.add(node<number>({ initial: 1 }), { name: "a" });
		const b = g.add(node<number>({ initial: 2 }), { name: "b" });
		void a;
		void b;
		const c = g.add(
			node<number>([a], (data, actions, ctx) => {
				const v = data[0]?.[0] ?? ctx.prevData[0];
				actions.emit((v as number) * 10);
			}),
			{ name: "c" },
		);
		c.subscribe(() => {});
		expect(c.cache).toBe(10);

		// Rewire to [a, b] AND swap fn.
		g._rewire("c", ["a", "b"], (data, actions, ctx) => {
			const av = data[0]?.[0] ?? ctx.prevData[0];
			const bv = data[1]?.[0] ?? ctx.prevData[1];
			actions.emit(((av as number) ?? 0) - ((bv as number) ?? 0));
		});
		expect(c.cache).toBe(-1); // 1 - 2
	});

	it("graph._addDep / _removeDep on unknown node throws", () => {
		const g = new Graph("g");
		const a = g.add(node<number>({ initial: 1 }), { name: "a" });
		void a;
		expect(() => g._addDep("nonexistent", a, noopFn)).toThrowError(/unknown node/);
		expect(() => g._removeDep("nonexistent", a, noopFn)).toThrowError(/unknown node/);
	});
});
