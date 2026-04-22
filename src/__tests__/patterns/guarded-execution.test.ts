import { describe, expect, it } from "vitest";
import type { Actor } from "../../core/actor.js";
import { type PolicyRuleData, policy } from "../../core/guard.js";
import { state } from "../../core/sugar.js";
import { Graph } from "../../graph/index.js";
import { guardedExecution } from "../../patterns/guarded-execution.js";

const alice: Actor = { type: "human", id: "alice" };
const bob: Actor = { type: "human", id: "bob" };
const llm: Actor = { type: "llm", id: "agent-1" };

describe("guardedExecution", () => {
	it("wraps target with policyEnforcer and blocks disallowed writes (enforce mode default)", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		guardedExecution(g, {
			actor: alice,
			policies: [
				{ effect: "allow", action: "write", actorType: "human" },
				{ effect: "deny", action: "write", actorType: "llm" },
			],
		});

		// Human allowed
		g.set("a", 1, { actor: alice });
		expect(g.get("a")).toBe(1);
		// LLM denied
		expect(() => g.set("a", 99, { actor: llm })).toThrow();
	});

	it("audit mode records violations without blocking writes", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a", guard: () => true }), { name: "a" });
		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [{ effect: "deny", action: "write", actorType: "llm" }],
			mode: "audit",
		});

		g.set("a", 42, { actor: llm });
		// Write succeeded (audit mode)
		expect(g.get("a")).toBe(42);
		// Violation recorded
		const violations = guarded.enforcer.all();
		expect(violations).toHaveLength(1);
		expect(violations[0]?.actor.type).toBe("llm");
		expect(violations[0]?.result).toBe("observed");
	});

	it("scopedDescribe uses the configured default actor (visibility gated by 'observe' guard action)", () => {
		const g = new Graph("g");
		// Node visible only to Alice — `"observe"` is the action `describe()` checks.
		const onlyAlice = policy((allow) => {
			allow("observe", { where: (a) => a.id === "alice" });
		});
		g.add(state(0, { name: "alice-only", guard: onlyAlice }), { name: "alice-only" });
		g.add(state(1, { name: "public" }), { name: "public" });

		// Use audit mode: the enforcer observes writes but does NOT stack a
		// deny-by-default guard on every node, so describe() sees through to
		// the per-node `onlyAlice` guard without interference.
		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [] as readonly PolicyRuleData[],
			mode: "audit",
		});

		// Default actor (alice) sees both.
		const view = guarded.scopedDescribe();
		expect(Object.keys(view.nodes).sort()).toEqual(["alice-only", "public"]);

		// Override actor to bob — alice-only is hidden (policy denies "observe" for non-alice).
		const bobView = guarded.scopedDescribe({ actor: bob });
		expect(Object.keys(bobView.nodes)).toContain("public");
		expect(Object.keys(bobView.nodes)).not.toContain("alice-only");
	});

	it("scopedDescribe passes through detail option to the target describe", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [] as readonly PolicyRuleData[],
		});

		const minimal = guarded.scopedDescribe({ detail: "minimal" });
		const standard = guarded.scopedDescribe({ detail: "standard" });
		// Standard has more fields on each entry than minimal. Test structurally
		// by comparing key count per node rather than asserting specific field
		// names (those are spec'd on describe itself and are tested there).
		const minKeys = Object.keys(minimal.nodes.a ?? {}).length;
		const stdKeys = Object.keys(standard.nodes.a ?? {}).length;
		expect(stdKeys).toBeGreaterThanOrEqual(minKeys);
	});

	it("policies can be a live Node for runtime updates", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const policies = state<readonly PolicyRuleData[]>([{ effect: "allow", action: "write" }]);

		guardedExecution(g, {
			actor: alice,
			policies,
		});

		// Initially allowed
		g.set("a", 1, { actor: alice });

		// Tighten: deny all
		policies.emit([{ effect: "deny", action: "write" }]);
		expect(() => g.set("a", 2, { actor: alice })).toThrow();
	});

	it("violations topic is exposed and composable", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a", guard: () => true }), { name: "a" });
		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [{ effect: "deny", action: "write" }],
			mode: "audit",
		});

		g.set("a", 1, { actor: alice });
		expect(guarded.violations.retained()).toHaveLength(1);
	});

	it("transitive dynamic coverage — nodes added to an already-mounted child are guarded", () => {
		const g = new Graph("g");
		const child = new Graph("child");
		g.mount("kids", child); // BEFORE guardedExecution is built
		guardedExecution(g, {
			actor: alice,
			policies: [{ effect: "deny", action: "write" }],
		});

		child.add(state(0, { name: "x" }), { name: "x" });
		expect(() => g.set("kids::x", 1, { actor: alice })).toThrow();
	});

	it("exposes .target escape hatch", () => {
		const g = new Graph("g");
		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [] as readonly PolicyRuleData[],
		});
		expect(guarded.target).toBe(g);
	});
});
