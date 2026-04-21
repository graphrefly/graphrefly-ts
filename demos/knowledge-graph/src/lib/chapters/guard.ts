// Chapter 4 — Guard. Same reactive pipeline; wrap the KG in policyEnforcer
// so an "untrusted-llm" actor is blocked from writing to entities.
//
// "Try malicious write" calls `kg.set("entities", value, { actor })` with the
// untrusted-llm actor. policyEnforcer in `enforce` mode pushes a guard onto
// the entities node that throws GuardDenied for that actor. The legitimate
// apply-extraction effect still works because `kg.upsertEntity` calls go
// through internal writes that aren't tagged with the untrusted actor.
// This is the closure for homepage pain point 03 ("Composition Without
// Guardrails").

import type { LLMAdapter } from "@graphrefly/graphrefly/patterns/ai";
import { type PolicyEnforcerGraph, policyEnforcer } from "@graphrefly/graphrefly/patterns/audit";
import type { NodeRegistry } from "@graphrefly/graphrefly/patterns/demo-shell";
import { buildReactiveChapter, type ReactiveChapter } from "./reactive.js";

export const GUARD_SOURCE = `// Same reactive pipeline as chapter 2.
const kg = buildReactiveChapter(adapter, paper).kg;

// Wrap the KG in a reactive ABAC enforcer. Mode: "enforce" pushes guards
// onto target nodes so disallowed writes throw GuardDenied at write time.
const enforced = policyEnforcer(kg, [
  { effect: "deny",  action: "write", actorType: "llm", actorId: "untrusted-llm" },
  { effect: "allow", action: "write", actorType: "system" },
], { mode: "enforce" });

// A legitimate write — system actor, allowed. Use kg.set(path, value, opts)
// — the public API. No protocol internals (DATA, raw down) leak into your
// app code.
kg.set("entities", nextEntities, { actor: { type: "system", id: "demo" } });

// An adversarial write — same node, untrusted-llm actor. THROWS.
try {
  kg.set("entities", nextEntities, { actor: { type: "llm", id: "untrusted-llm" } });
} catch (err) {
  // GuardDenied — recorded to enforced.violations.
}

// All violations are reactive too — subscribe to the topic, build a UI.
enforced.violations.events.subscribe(...);
`;

export type GuardChapter = Omit<ReactiveChapter, "id"> & {
	id: "guard";
	enforced: PolicyEnforcerGraph;
	tryMaliciousWrite: () => { ok: boolean; error?: string };
};

export function buildGuardChapter(adapter: LLMAdapter, initialPaperText: string): GuardChapter {
	const base = buildReactiveChapter(adapter, initialPaperText);

	const enforced = policyEnforcer(
		base.kg,
		[
			{ effect: "deny", action: "write", actorType: "llm", actorId: "untrusted-llm" },
			{ effect: "allow", action: "write", actorType: "system" },
		],
		{ mode: "enforce", name: "kg_enforced" },
	);

	const registry: NodeRegistry = new Map(base.registry);
	registry.set("policies", { codeLine: 5, visualSelector: "[data-guard-banner]" });
	registry.set("violations", { codeLine: 18, visualSelector: "[data-guard-banner]" });

	return {
		...base,
		id: "guard",
		sourceCode: GUARD_SOURCE,
		registry,
		enforced,
		tryMaliciousWrite() {
			try {
				const current =
					(base.kg.resolve("entities").cache as ReadonlyMap<string, unknown> | undefined) ??
					new Map();
				const next = new Map(current);
				next.set("malicious-injection", {
					id: "malicious-injection",
					label: "Malicious payload",
					kind: "other",
				});
				base.kg.set("entities", next, {
					actor: { type: "llm", id: "untrusted-llm" },
				});
				return { ok: true };
			} catch (err) {
				return { ok: false, error: err instanceof Error ? err.message : String(err) };
			}
		},
	};
}
