/**
 * Phase 13.8 — real-consumer ergonomics validation for `_rewire` + `_setDeps` /
 * `_addDep` / `_removeDep` substrate APIs.
 *
 * Goal: take the rewire substrate out of synthetic [a, b, c] tests and into
 * realistic AI self-pruning shapes that match the founding use case
 * (`project_rewire_gap` memory, blocked since 2026-04-26 until Phase 13.8).
 * Findings flow back into `docs/research/rewire-gap-findings.md` § Real-consumer
 * ergonomics.
 *
 * Each test simulates an AI controller that:
 * 1. Builds a realistic pipeline using the public `Graph` API.
 * 2. Subscribes to `graph.topology` to capture rewire audits as a real
 *    consumer would.
 * 3. Observes pipeline output, decides a topology change is warranted.
 * 4. Calls `Graph._rewire` / `_addDep` / `_removeDep` with appropriate
 *    `opts.fn`.
 * 5. Verifies the post-change output is correct AND the topology subscriber
 *    saw a coherent audit trail.
 */

import { describe, expect, it } from "vitest";
import { DATA } from "../../core/messages.js";
import type { Node, NodeFn, NodeImpl } from "../../core/node.js";
import { node } from "../../core/node.js";
import { Graph, type GraphRewireAudit, type TopologyEvent } from "../../graph/graph.js";

const fnOf = (n: Node): NodeFn => (n as NodeImpl)._fn as NodeFn;
const noopFn: NodeFn = () => {};

describe("Phase 13.8 — real-consumer ergonomics", () => {
	// ─────────────────────────────────────────────────────────────────────
	// Scenario A: AI prunes a no-op intermediate stage
	// ─────────────────────────────────────────────────────────────────────
	//
	// Pipeline: rawText → normalize → trim → score → output
	// AI runs a sample wave, observes that `trim` is a no-op for the current
	// input distribution (text is already trimmed), and rewires `score` to
	// read directly from `normalize`. `trim` stays registered on the graph
	// but is no longer on the data path. No fn signature change needed
	// because both `normalize` and `trim` produce the same shape (string).

	it("Scenario A: AI prunes a no-op stage; pipeline output unchanged; audit captured", () => {
		const g = new Graph("text-pipeline");

		// Pipeline stages.
		// Input is already-trimmed so `trim` is genuinely a no-op for this wave.
		g.add(node<string>({ initial: "hello world" }), { name: "rawText" });
		g.add(
			node<string>([g.node("rawText")], (data, actions, ctx) => {
				const v = (data[0]?.[0] ?? ctx.prevData[0]) as string;
				actions.emit(v.toLowerCase());
			}),
			{ name: "normalize" },
		);
		g.add(
			node<string>([g.node("normalize")], (data, actions, ctx) => {
				const v = (data[0]?.[0] ?? ctx.prevData[0]) as string;
				// Trimming is a no-op for already-trimmed inputs.
				actions.emit(v.trim());
			}),
			{ name: "trim" },
		);
		const score = g.add(
			node<number>([g.node("trim")], (data, actions, ctx) => {
				const v = (data[0]?.[0] ?? ctx.prevData[0]) as string;
				// Length-based score.
				actions.emit(v.length);
			}),
			{ name: "score" },
		);

		score.subscribe(() => {});

		// AI controller subscribes to topology to keep an audit log.
		const auditLog: TopologyEvent[] = [];
		g.topology.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) auditLog.push(m[1] as TopologyEvent);
		});

		// rawText "  hello world  " → normalize "  hello world  " (lowercase
		// is no-op) → trim "hello world" → score 11.
		const before = score.cache;
		expect(before).toBe(11);

		// AI decides: for this input, trim is no-op (the lowercased text was
		// already trimmed-equivalent for our purposes). Bypass it.
		const audit = g._rewire("score", ["normalize"], fnOf(score));

		expect(audit.removed).toEqual(["trim"]);
		expect(audit.added).toEqual(["normalize"]);
		expect(audit.kept).toEqual([]);

		// Output unchanged because trim was no-op for this input.
		expect(score.cache).toBe(11);

		// Audit visible to the topology subscriber.
		const rewireEvent = auditLog.find((e) => e.kind === "rewired");
		expect(rewireEvent).toBeDefined();
		expect((rewireEvent as { audit: GraphRewireAudit }).audit).toEqual(audit);

		// `trim` is still registered on the graph; just not on the data path.
		expect(g.node("trim")).toBeDefined();
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario B: AI swaps a broken tool with `opts.fn` to update planner shape
	// ─────────────────────────────────────────────────────────────────────
	//
	// Pipeline: planner aggregates [toolA, toolB] outputs.
	// AI detects toolB is broken/irrelevant; replaces it with toolC.
	// Tool slot count is unchanged BUT the meaning of slot 1 changed — the
	// planner's fn would still work positionally, but a careful AI would
	// supply a new fn that knows about toolC's specific shape.

	it("Scenario B: AI swaps a tool dep + supplies new fn that knows the new tool's shape", () => {
		const g = new Graph("multi-tool-planner");

		g.add(node<string>({ initial: "Q1 revenue by region" }), { name: "query" });

		// Tools — each produces a different kind of insight.
		g.add(
			node<{ source: string; rows: number }>([g.node("query")], (data, actions, ctx) => {
				const q = (data[0]?.[0] ?? ctx.prevData[0]) as string;
				actions.emit({ source: "sql", rows: q.length });
			}),
			{ name: "toolSQL" },
		);
		g.add(
			node<{ source: string; matches: number }>([g.node("query")], (data, actions, ctx) => {
				const q = (data[0]?.[0] ?? ctx.prevData[0]) as string;
				// Pretend this tool is broken — emits zeros.
				actions.emit({ source: "vectorSearch-broken", matches: 0 });
				void q;
			}),
			{ name: "toolBroken" },
		);
		g.add(
			node<{ source: string; pages: number }>([g.node("query")], (data, actions, ctx) => {
				const q = (data[0]?.[0] ?? ctx.prevData[0]) as string;
				actions.emit({ source: "docSearch", pages: Math.floor(q.length / 5) });
			}),
			{ name: "toolDocs" },
		);

		// Planner — initially uses [toolSQL, toolBroken].
		const planner = g.add(
			node<string>([g.node("toolSQL"), g.node("toolBroken")], (data, actions, ctx) => {
				const sql = (data[0]?.[0] ?? ctx.prevData[0]) as { source: string; rows: number };
				const vec = (data[1]?.[0] ?? ctx.prevData[1]) as {
					source: string;
					matches: number;
				};
				actions.emit(
					`Plan: query SQL (${sql?.rows ?? 0} rows) + vector (${vec?.matches ?? 0} matches)`,
				);
			}),
			{ name: "planner" },
		);
		planner.subscribe(() => {});

		const initialPlan = planner.cache;
		expect(initialPlan).toContain("rows");
		expect(initialPlan).toContain("matches");

		// AI detects toolBroken returns 0 matches consistently → swap for toolDocs.
		// The new tool produces a DIFFERENT shape (`pages` instead of `matches`),
		// so the planner needs a new fn to consume it.
		g._rewire("planner", ["toolSQL", "toolDocs"], (data, actions, ctx) => {
			const sql = (data[0]?.[0] ?? ctx.prevData[0]) as { source: string; rows: number };
			const docs = (data[1]?.[0] ?? ctx.prevData[1]) as {
				source: string;
				pages: number;
			};
			actions.emit(`Plan: query SQL (${sql?.rows ?? 0} rows) + docs (${docs?.pages ?? 0} pages)`);
		});

		// Post-rewire plan reflects the new tool's shape.
		const newPlan = planner.cache;
		expect(newPlan).toContain("rows");
		expect(newPlan).toContain("pages");
		expect(newPlan).not.toContain("matches");
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario C: AI extends pipeline with a new stage via `_addDep` + opts.fn
	// ─────────────────────────────────────────────────────────────────────
	//
	// Pipeline: input → output (single dep). AI adds a `validator` stage
	// dep to output and updates output's fn to combine input + validation.

	it("Scenario C: AI extends a node's deps with `_addDep` + opts.fn", () => {
		const g = new Graph("validation-extend");

		g.add(node<number>({ initial: 42 }), { name: "input" });
		g.add(
			node<{ ok: boolean }>([g.node("input")], (data, actions, ctx) => {
				const v = (data[0]?.[0] ?? ctx.prevData[0]) as number;
				actions.emit({ ok: v > 0 });
			}),
			{ name: "validator" },
		);
		const output = g.add(
			node<string>([g.node("input")], (data, actions, ctx) => {
				const v = (data[0]?.[0] ?? ctx.prevData[0]) as number;
				actions.emit(`Result: ${v}`);
			}),
			{ name: "output" },
		);
		output.subscribe(() => {});
		expect(output.cache).toBe("Result: 42");

		// AI decides output should also incorporate validator state.
		const newIdx = g._addDep("output", "validator", (data, actions, ctx) => {
			const v = (data[0]?.[0] ?? ctx.prevData[0]) as number;
			const validation = (data[1]?.[0] ?? ctx.prevData[1]) as {
				ok: boolean;
			};
			actions.emit(`Result: ${v} (ok=${validation?.ok ?? "?"})`);
		});
		expect(newIdx).toBe(1); // appended at end

		expect(output.cache).toBe("Result: 42 (ok=true)");
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario D: AI strips a stage via `_removeDep` + opts.fn
	// ─────────────────────────────────────────────────────────────────────

	it("Scenario D: AI strips a dep via `_removeDep` + opts.fn", () => {
		const g = new Graph("trim-down");

		g.add(node<number>({ initial: 100 }), { name: "input" });
		g.add(
			node<number>([g.node("input")], (data, actions, ctx) => {
				const v = (data[0]?.[0] ?? ctx.prevData[0]) as number;
				actions.emit(v * 0.05); // expensive tax computation
			}),
			{ name: "tax" },
		);
		const total = g.add(
			node<number>([g.node("input"), g.node("tax")], (data, actions, ctx) => {
				const base = (data[0]?.[0] ?? ctx.prevData[0]) as number;
				const tax = (data[1]?.[0] ?? ctx.prevData[1]) as number;
				actions.emit(base + tax);
			}),
			{ name: "total" },
		);
		total.subscribe(() => {});
		expect(total.cache).toBe(105); // 100 + 5

		// AI decides tax is no longer needed (e.g. customer is tax-exempt).
		// Drop the tax dep AND swap fn to ignore the missing slot.
		g._removeDep("total", "tax", (data, actions, ctx) => {
			const base = (data[0]?.[0] ?? ctx.prevData[0]) as number;
			actions.emit(base);
		});

		// Drive a fresh wave through input.
		g.set("input", 200);
		expect(total.cache).toBe(200); // tax-free
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario E: External-controller pattern (the ergonomic reality)
	// ─────────────────────────────────────────────────────────────────────
	//
	// **Ergonomic finding:** rewires CANNOT be triggered from inside a
	// subscriber callback that fires synchronously during the upstream's
	// fn execution. Subscribers fire while `_isExecutingFn === true`, so
	// `_setDeps`/`_addDep`/`_removeDep` reject with "mid-fn topology
	// mutation". The error is then caught by the upstream's `_execFn`
	// catch and emitted as ERROR downstream — silently breaking the
	// caller's intent.
	//
	// The correct pattern: AI controllers call rewire from OUTSIDE any
	// subscriber callback — typically from the outer driver loop after
	// inspecting state via `graph.observe()` or direct `node.cache` reads.
	// This test demonstrates the working pattern.

	it("Scenario E: external-driver rewire (the pattern AI controllers should use)", () => {
		const g = new Graph("external-driver");

		g.add(node<number>({ initial: 1 }), { name: "a" });
		g.add(node<number>({ initial: 100 }), { name: "b" });
		const consumer = g.add(
			node<number>([g.node("a")], (data, actions, ctx) => {
				const v = (data[0]?.[0] ?? ctx.prevData[0]) as number;
				actions.emit(v * 10);
			}),
			{ name: "consumer" },
		);
		consumer.subscribe(() => {});

		// Initial wave: a=1 → consumer=10.
		expect(consumer.cache).toBe(10);

		// AI driver loop: drive an input, inspect state, rewire if needed.
		g.set("a", 5);
		// consumer = 50 now.
		if ((consumer.cache as number) >= 50) {
			g._rewire("consumer", ["b"], fnOf(consumer));
		}
		// Now consumer reads from b=100 → 1000.
		expect(consumer.cache).toBe(1000);
	});

	it("Scenario E2: subscriber-driven rewire is rejected mid-fn (foot-gun documented)", () => {
		// Confirms the constraint described above. A subscriber that fires
		// during upstream fn-emit cannot call rewire — it'll be rejected.
		const g = new Graph("foot-gun-mid-fn");

		const a = g.add(node<number>({ initial: 1 }), { name: "a" });
		g.add(node<number>({ initial: 100 }), { name: "b" });
		const consumer = g.add(
			node<number>([g.node("a")], (data, actions, ctx) => {
				const v = (data[0]?.[0] ?? ctx.prevData[0]) as number;
				actions.emit(v * 10);
			}),
			{ name: "consumer" },
		);
		consumer.subscribe(() => {});

		let caughtError: string | undefined;
		consumer.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA && (m[1] as number) >= 50) {
					try {
						g._rewire("consumer", ["b"], fnOf(consumer));
					} catch (err) {
						caughtError = (err as Error).message;
					}
				}
			}
		});

		g.set("a", 5);
		// Rewire was rejected ("mid-fn topology mutation") and caught locally.
		// consumer's deps unchanged → still reads from `a`. cache = 50.
		expect(caughtError).toMatch(/mid-fn topology mutation/);
		expect(consumer.cache).toBe(50);
		// consumer's deps are unchanged (still [a]).
		const deps = (consumer as unknown as { _deps: { node: unknown }[] })._deps;
		expect(deps).toHaveLength(1);
		expect(deps[0].node).toBe(a);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario F: COMPLETE on a removed dep does not propagate (cascade clean)
	// ─────────────────────────────────────────────────────────────────────

	it("Scenario F: completing a pruned dep does NOT cascade to the consumer", () => {
		const g = new Graph("cascade-isolation");

		g.add(node<number>({ initial: 1 }), { name: "stale" });
		g.add(node<number>({ initial: 2 }), { name: "fresh" });
		const consumer = g.add(
			node<number>([g.node("stale")], (data, actions, ctx) => {
				const v = (data[0]?.[0] ?? ctx.prevData[0]) as number;
				actions.emit(v * 10);
			}),
			{ name: "consumer" },
		);
		consumer.subscribe(() => {});
		expect(consumer.cache).toBe(10);

		// AI decides "stale" is being deprecated; rewire consumer onto "fresh".
		g._rewire("consumer", ["fresh"], fnOf(consumer));
		expect(consumer.cache).toBe(20);

		// Now COMPLETE the deprecated source. Should NOT propagate to consumer.
		g.complete("stale");
		expect(consumer.status).not.toBe("completed");
		expect(consumer.cache).toBe(20);
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario G: Topology subscriber audits multiple sequential rewires
	// ─────────────────────────────────────────────────────────────────────
	//
	// AI controllers often perform multiple rewires in sequence. The
	// topology subscriber should see each one with a coherent audit.

	it("Scenario G: sequential rewires produce a coherent audit trail", () => {
		const g = new Graph("audit-trail");

		g.add(node<number>({ initial: 1 }), { name: "a" });
		g.add(node<number>({ initial: 2 }), { name: "b" });
		g.add(node<number>({ initial: 3 }), { name: "c" });
		const sink = g.add(
			node<number>([g.node("a")], (data, actions, ctx) => {
				const v = (data[0]?.[0] ?? ctx.prevData[0]) as number;
				actions.emit(v * 100);
			}),
			{ name: "sink" },
		);
		sink.subscribe(() => {});

		const audits: GraphRewireAudit[] = [];
		g.topology.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					const ev = m[1] as TopologyEvent;
					if (ev.kind === "rewired") audits.push(ev.audit);
				}
			}
		});

		// AI does a sequence of rewires.
		g._rewire("sink", ["b"], fnOf(sink));
		g._rewire("sink", ["a", "b"], (data, actions, ctx) => {
			const av = (data[0]?.[0] ?? ctx.prevData[0]) as number;
			const bv = (data[1]?.[0] ?? ctx.prevData[1]) as number;
			actions.emit(av + bv);
		});
		g._rewire("sink", ["c"], (data, actions, ctx) => {
			const cv = (data[0]?.[0] ?? ctx.prevData[0]) as number;
			actions.emit(cv * 1000);
		});

		expect(audits).toHaveLength(3);
		expect(audits[0]).toEqual({ name: "sink", removed: ["a"], added: ["b"], kept: [] });
		expect(audits[1]).toEqual({ name: "sink", removed: [], added: ["a"], kept: ["b"] });
		expect(audits[2]).toEqual({ name: "sink", removed: ["a", "b"], added: ["c"], kept: [] });

		expect(sink.cache).toBe(3000); // 3 * 1000
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario H: graph.observe + rewire — value observers stay coherent
	// ─────────────────────────────────────────────────────────────────────
	//
	// `graph.observe(path)` is the user-facing way to watch a node's
	// value stream. After a rewire that changes how the node computes,
	// the observer should keep seeing values from the same node identity
	// (the node didn't change, only its inputs).

	it("Scenario H: graph.observe sink stays coherent across a rewire", () => {
		const g = new Graph("observe-coherence");

		g.add(node<number>({ initial: 10 }), { name: "src1" });
		g.add(node<number>({ initial: 100 }), { name: "src2" });
		g.add(
			node<number>([g.node("src1")], (data, actions, ctx) => {
				const v = (data[0]?.[0] ?? ctx.prevData[0]) as number;
				actions.emit(v * 2);
			}),
			{ name: "out" },
		);

		const observed: number[] = [];
		const obs = g.observe("out");
		obs.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === DATA) observed.push(m[1] as number);
		});

		// Initial: 10 * 2 = 20.
		expect(observed).toContain(20);

		// Rewire to src2 with new fn that knows the new dep.
		g._rewire("out", ["src2"], (data, actions, ctx) => {
			const v = (data[0]?.[0] ?? ctx.prevData[0]) as number;
			actions.emit(v + 1);
		});
		// 100 + 1 = 101 — observer sees this through the same subscription.
		expect(observed).toContain(101);

		// Drive a fresh wave through the new dep.
		g.set("src2", 200);
		// 200 + 1 = 201.
		expect(observed).toContain(201);

		// Observer never had to re-subscribe; the node identity stayed stable.
	});

	// ─────────────────────────────────────────────────────────────────────
	// Scenario I: Required-fn lock surfaces the foot-gun explicitly
	// ─────────────────────────────────────────────────────────────────────
	//
	// Phase 13.8 lock makes `fn` required at every rewire call site. This
	// closes the silent shape-mismatch path — the caller MUST acknowledge
	// what fn pairs with the new dep set. If they pass the OLD fn for a
	// shape-changing rewire, the bug surfaces but at least the call site
	// makes the decision visible (auditable in code review / AI logs).

	it("Scenario I: required-fn lock — caller must explicitly acknowledge fn-deps pairing", () => {
		const g = new Graph("required-fn-foot-gun");

		g.add(node<number>({ initial: 5 }), { name: "tens" }); // tens digit
		g.add(node<number>({ initial: 7 }), { name: "ones" }); // ones digit
		g.add(node<number>({ initial: 99 }), { name: "different" });
		const score = g.add(
			node<number>([g.node("tens"), g.node("ones")], (data, actions, ctx) => {
				const t = (data[0]?.[0] ?? ctx.prevData[0]) as number;
				const o = (data[1]?.[0] ?? ctx.prevData[1]) as number;
				actions.emit(t * 10 + o); // 57
			}),
			{ name: "score" },
		);
		score.subscribe(() => {});
		expect(score.cache).toBe(57);

		// AI rewires score's deps to [different, ones]. Caller MUST pass fn —
		// type system enforces it. If the caller passes the OLD fn, the bug
		// surfaces (data[0] is now "different" not "tens") but the call site
		// explicitly declared "I'm reusing the existing fn for the new shape."
		g._rewire("score", ["different", "ones"], fnOf(score));
		expect(score.cache).toBe(997); // 99 * 10 + 7 — wrong semantics but visible
		// Compare: with a fresh fn that knows the new dep semantics, the
		// caller takes responsibility correctly. Pure fn swap (no dep
		// change) — needs a fresh wave to trigger fn re-execution.
		g._rewire("score", ["different", "ones"], (data, actions, ctx) => {
			// Treat the slot as just "the multiplier" rather than "tens".
			const m = (data[0]?.[0] ?? ctx.prevData[0]) as number;
			const o = (data[1]?.[0] ?? ctx.prevData[1]) as number;
			actions.emit(m + o); // semantic intent: sum
		});
		// Pure fn swap doesn't auto-fire; drive a fresh DATA on `different`
		// to trigger. Use a NEW value so equals-suppression doesn't skip emit.
		g.set("different", 50);
		expect(score.cache).toBe(57); // 50 + 7 (new fn semantics)
	});
});
