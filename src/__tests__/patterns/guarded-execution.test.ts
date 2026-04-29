import { describe, expect, it } from "vitest";
import type { Actor } from "../../core/actor.js";
import { type PolicyRuleData, policy } from "../../core/guard.js";
import { DATA } from "../../core/messages.js";
import { state } from "../../core/sugar.js";
import { firstValueFrom } from "../../extra/sources/index.js";
import { Graph } from "../../graph/index.js";
import {
	type GuardedExecutionLint,
	type GuardedScope,
	guardedExecution,
} from "../../patterns/inspect/guarded-execution.js";

const alice: Actor = { type: "human", id: "alice" };
const bob: Actor = { type: "human", id: "bob" };
const llm: Actor = { type: "llm", id: "agent-1" };

describe("guardedExecution — write enforcement", () => {
	it("wraps target with policyGate and blocks disallowed writes (enforce mode default)", () => {
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
		expect(g.node("a").cache).toBe(1);
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
		expect(g.node("a").cache).toBe(42);
		// Violation recorded
		const violations = guarded.enforcer.all();
		expect(violations).toHaveLength(1);
		expect(violations[0]?.actor.type).toBe("llm");
		expect(violations[0]?.result).toBe("observed");
	});

	it("policies can be a live Node for runtime updates", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const policies = state<readonly PolicyRuleData[]>([{ effect: "allow", action: "write" }]);

		guardedExecution(g, { actor: alice, policies });

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
			mode: "audit",
		});
		expect(guarded.target).toBe(g);
	});
});

describe("guardedExecution — scopedDescribe (mounted property — qa G1A)", () => {
	it("exposes a single canonical reactive describe Node bound to the configured actor", async () => {
		const g = new Graph("g");
		const onlyAlice = policy((allow) => {
			allow("observe", { where: (a) => a.id === "alice" });
		});
		g.add(state(0, { name: "alice-only", guard: onlyAlice }), { name: "alice-only" });
		g.add(state(1, { name: "public" }), { name: "public" });

		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [] as readonly PolicyRuleData[],
			mode: "audit",
		});

		const view = await firstValueFrom(guarded.scopedDescribe);
		expect(Object.keys(view.nodes).sort()).toEqual(["alice-only", "public"]);
	});

	it("re-derives when the actor Node emits a new identity (same instance, no per-call leak)", () => {
		const g = new Graph("g");
		const onlyAlice = policy((allow) => {
			allow("observe", { where: (a) => a.id === "alice" });
		});
		g.add(state(0, { name: "alice-only", guard: onlyAlice }), { name: "alice-only" });
		g.add(state(1, { name: "public" }), { name: "public" });

		const actorNode = state<Actor>(alice, { name: "current-actor" });
		const guarded = guardedExecution(g, {
			actor: actorNode,
			policies: [] as readonly PolicyRuleData[],
			mode: "audit",
		});

		const seen: string[][] = [];
		guarded.scopedDescribe.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(Object.keys((m[1] as { nodes: object }).nodes).sort());
			}
		});

		expect(seen.at(-1)).toEqual(["alice-only", "public"]);

		actorNode.emit(bob);
		expect(seen.at(-1)).toEqual(["public"]);
	});

	it("scopedDescribe appears in wrapper.describe() as a mounted node", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [{ effect: "allow", action: "*" }],
		});
		const desc = guarded.describe();
		expect(desc.nodes.scopedDescribe).toBeDefined();
	});
});

describe("guardedExecution — scopedDescribeNode (per-call escape hatch)", () => {
	it("scopes the describe to the configured default actor (live Node)", async () => {
		const g = new Graph("g");
		const onlyAlice = policy((allow) => {
			allow("observe", { where: (a) => a.id === "alice" });
		});
		g.add(state(0, { name: "alice-only", guard: onlyAlice }), { name: "alice-only" });
		g.add(state(1, { name: "public" }), { name: "public" });

		// Audit mode: no extra guards stacked, so per-node guard alone gates visibility.
		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [] as readonly PolicyRuleData[],
			mode: "audit",
		});

		const view = guarded.scopedDescribeNode();
		try {
			const initial = await firstValueFrom(view.node);
			expect(Object.keys(initial.nodes).sort()).toEqual(["alice-only", "public"]);
		} finally {
			view.dispose();
		}
	});

	it("re-derives when the actor Node emits a new identity", () => {
		const g = new Graph("g");
		const onlyAlice = policy((allow) => {
			allow("observe", { where: (a) => a.id === "alice" });
		});
		g.add(state(0, { name: "alice-only", guard: onlyAlice }), { name: "alice-only" });
		g.add(state(1, { name: "public" }), { name: "public" });

		const actorNode = state<Actor>(alice, { name: "current-actor" });
		const guarded = guardedExecution(g, {
			actor: actorNode,
			policies: [] as readonly PolicyRuleData[],
			mode: "audit",
		});

		const view = guarded.scopedDescribeNode();
		try {
			const seen: string[][] = [];
			view.node.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) seen.push(Object.keys((m[1] as { nodes: object }).nodes).sort());
				}
			});

			// Alice sees both
			expect(seen.at(-1)).toEqual(["alice-only", "public"]);

			// Switch to bob — alice-only hides
			actorNode.emit(bob);
			expect(seen.at(-1)).toEqual(["public"]);
		} finally {
			view.dispose();
		}
	});

	it("per-call actor override takes precedence", () => {
		const g = new Graph("g");
		const onlyAlice = policy((allow) => {
			allow("observe", { where: (a) => a.id === "alice" });
		});
		g.add(state(0, { name: "alice-only", guard: onlyAlice }), { name: "alice-only" });
		g.add(state(1, { name: "public" }), { name: "public" });

		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [] as readonly PolicyRuleData[],
			mode: "audit",
		});

		const bobView = guarded.scopedDescribeNode(bob);
		try {
			const seen: string[][] = [];
			bobView.node.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) seen.push(Object.keys((m[1] as { nodes: object }).nodes).sort());
				}
			});
			expect(seen.at(-1)).toEqual(["public"]);
		} finally {
			bobView.dispose();
		}
	});

	it("passes through detail option to the target describe", async () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [{ effect: "allow", action: "*" }],
		});

		const minView = guarded.scopedDescribeNode(undefined, { detail: "minimal" });
		const stdView = guarded.scopedDescribeNode(undefined, { detail: "standard" });
		try {
			const minimal = await firstValueFrom(minView.node);
			const standard = await firstValueFrom(stdView.node);
			const minKeys = Object.keys(minimal.nodes.a ?? {}).length;
			const stdKeys = Object.keys(standard.nodes.a ?? {}).length;
			expect(stdKeys).toBeGreaterThanOrEqual(minKeys);
		} finally {
			minView.dispose();
			stdView.dispose();
		}
	});

	it("dispose() is idempotent", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [{ effect: "allow", action: "*" }],
		});
		const view = guarded.scopedDescribeNode();
		expect(() => {
			view.dispose();
			view.dispose();
		}).not.toThrow();
	});
});

describe("guardedExecution — lints", () => {
	it("throws RangeError on static empty policies in enforce mode", () => {
		const g = new Graph("g");
		expect(() =>
			guardedExecution(g, {
				actor: alice,
				policies: [] as readonly PolicyRuleData[],
				mode: "enforce",
			}),
		).toThrow(RangeError);
	});

	it("emits one-time empty-policies lint when a Node emits empty in enforce mode", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const policies = state<readonly PolicyRuleData[]>([{ effect: "allow", action: "*" }]);
		const guarded = guardedExecution(g, { actor: alice, policies, mode: "enforce" });

		expect(guarded.lints.retained()).toHaveLength(0);

		policies.emit([]);
		const lints = guarded.lints.retained();
		expect(lints).toHaveLength(1);
		expect(lints[0]?.kind).toBe("empty-policies");

		// Re-emit empty — lint is one-time-per-instance.
		policies.emit([]);
		expect(guarded.lints.retained()).toHaveLength(1);
	});

	it("tolerates empty policies in audit mode", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a", guard: () => true }), { name: "a" });
		expect(() =>
			guardedExecution(g, {
				actor: alice,
				policies: [] as readonly PolicyRuleData[],
				mode: "audit",
			}),
		).not.toThrow();
	});

	it("emits audit-no-effect lint when audit mode + target has no per-node guards", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" }); // no guard
		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [{ effect: "deny", action: "write" }],
			mode: "audit",
		});
		const lints = guarded.lints.retained();
		expect(lints.some((l: GuardedExecutionLint) => l.kind === "audit-no-effect")).toBe(true);
	});

	it("does NOT emit audit-no-effect when target has per-node guards", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a", guard: () => true }), { name: "a" });
		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [{ effect: "deny", action: "write" }],
			mode: "audit",
		});
		const lints = guarded.lints.retained();
		expect(lints.some((l: GuardedExecutionLint) => l.kind === "audit-no-effect")).toBe(false);
	});

	it("emits no-actor lint when actor is omitted from configuration", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const guarded = guardedExecution(g, {
			policies: [{ effect: "allow", action: "*" }],
		});
		const lints = guarded.lints.retained();
		expect(lints.some((l: GuardedExecutionLint) => l.kind === "no-actor")).toBe(true);
	});
});

describe("guardedExecution — scope derived", () => {
	it("publishes the configuration tuple and re-emits when policies update", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const policies = state<readonly PolicyRuleData[]>([{ effect: "allow", action: "*" }]);
		const guarded = guardedExecution(g, {
			actor: alice,
			policies,
			mode: "enforce",
		});

		const seen: GuardedScope[] = [];
		guarded.scope.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1] as GuardedScope);
			}
		});

		const first = seen.at(-1)!;
		expect(first.actor).toEqual(alice);
		expect(first.mode).toBe("enforce");
		expect(first.policiesCount).toBe(1);

		policies.emit([
			{ effect: "allow", action: "read" },
			{ effect: "deny", action: "write" },
		]);
		expect(seen.at(-1)?.policiesCount).toBe(2);
	});

	it("scope.actor is null when no actor is configured", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const guarded = guardedExecution(g, {
			policies: [{ effect: "allow", action: "*" }],
		});

		const seen: GuardedScope[] = [];
		guarded.scope.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1] as GuardedScope);
			}
		});
		expect(seen.at(-1)?.actor).toBeNull();
	});

	it("scope fires even when caller-supplied Node<Actor> hasn't emitted yet (qa G1B SENTINEL bridge)", () => {
		// Reproduces EC2: a producer-style actor Node with sentinel cache used to
		// stall `scope`'s first-run gate. The internal bridge derived now seeds
		// `null` so `scope` activates immediately; the actor Node forwards real
		// Actor values once it emits.
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		// Sentinel actor — emits no DATA until we explicitly trigger.
		const actorSentinel = state<Actor>(undefined as unknown as Actor, {
			name: "sentinel-actor",
		});
		const guarded = guardedExecution(g, {
			actor: actorSentinel,
			policies: [{ effect: "allow", action: "*" }],
			mode: "audit",
		});

		const seen: GuardedScope[] = [];
		guarded.scope.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) seen.push(m[1] as GuardedScope);
			}
		});

		// Before the actor Node ever emits, scope already shows actor=null.
		expect(seen.length).toBeGreaterThan(0);
		expect(seen.at(-1)?.actor).toBeNull();

		// Once the actor Node emits a real Actor, the bridge forwards it.
		actorSentinel.emit(alice);
		expect(seen.at(-1)?.actor).toEqual(alice);
	});
});

describe("guardedExecution — domainMeta tagging", () => {
	it("tags the scope derived with guarded_type metadata", () => {
		const g = new Graph("g");
		g.add(state(0, { name: "a" }), { name: "a" });
		const guarded = guardedExecution(g, {
			actor: alice,
			policies: [{ effect: "allow", action: "*" }],
		});
		const described = guarded.describe({ detail: "standard" });
		const scopeNode = described.nodes.scope;
		expect(scopeNode?.meta?.guarded).toBe(true);
		expect(scopeNode?.meta?.guarded_type).toBe("scope");
	});
});
