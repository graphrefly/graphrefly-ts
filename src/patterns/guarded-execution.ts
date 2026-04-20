/**
 * Composable safety layer (roadmap §9.0b).
 *
 * {@link guardedExecution} wraps any {@link Graph} with:
 *
 * - {@link policyEnforcer} — reactive ABAC, policies stored as a `Node` so
 *   LLMs / humans can update them at runtime. Now with full transitive
 *   dynamic coverage via `watchTopologyTree`.
 * - Scoped {@link GuardedExecutionGraph.scopedDescribe} — delegates to
 *   `target.describe({actor})` so callers see only what the actor is
 *   allowed to see.
 * - The enforcer's `violations` topic is republished as `violations` on
 *   the wrapper, composable with {@link graphLens}.`health` alerts.
 *
 * V1 scope: policies + actor + scoped describe. Budget-as-option is NOT
 * in V1 — it requires a cost-tracking design that hasn't landed yet.
 * Callers who need a budget limit today append a budget-aware
 * {@link PolicyRuleData} to the policies list (check current cost and
 * `deny` when exhausted).
 *
 * @module
 */
import type { Actor } from "../core/actor.js";
import type { PolicyRuleData } from "../core/guard.js";
import type { Node } from "../core/node.js";
import {
	type DescribeFilter,
	Graph,
	type GraphDescribeOptions,
	type GraphDescribeOutput,
	type GraphOptions,
} from "../graph/index.js";
import { type PolicyEnforcerGraph, type PolicyViolation, policyEnforcer } from "./audit.js";
import type { TopicGraph } from "./messaging.js";

/** Options for {@link guardedExecution}. */
export interface GuardedExecutionOptions {
	/**
	 * Policies enforced against every guarded write. Static list or a live
	 * `Node<readonly PolicyRuleData[]>` (LLM-updatable).
	 *
	 * **Deny-by-default gotcha:** the underlying `policyFromRules()` denies any
	 * action that matches no rule. An empty policies list in `mode: "enforce"`
	 * therefore blocks EVERY write AND every `observe` through the stacked
	 * guard — including `scopedDescribe()`. If you want a permissive base, add
	 * at least `{ effect: "allow", action: "*" }` and layer deny rules on top.
	 * In `mode: "audit"` no guards are stacked, so empty policies are safe.
	 */
	policies: readonly PolicyRuleData[] | Node<readonly PolicyRuleData[]>;
	/**
	 * Actor whose perspective drives {@link GuardedExecutionGraph.scopedDescribe}
	 * and {@link GuardedExecutionGraph.describe} — when omitted, callers must
	 * pass `{actor}` explicitly or they get the target's raw describe.
	 */
	actor?: Actor;
	/**
	 * `"enforce"` (default) — push guards onto target nodes so disallowed
	 * writes throw {@link GuardDenied}.
	 * `"audit"` — record would-be denials to the `violations` topic without
	 * blocking writes.
	 */
	mode?: "audit" | "enforce";
	/** Ring-buffer cap for the `violations` topic. Default 1000 (inherited from policyEnforcer). */
	violationsLimit?: number;
	/** Wrapper graph name. Default `${target.name}_guarded`. */
	name?: string;
	/** Wrapper graph options. */
	graph?: GraphOptions;
}

/**
 * Wrapper over a target {@link Graph} providing reactive ABAC + scoped
 * describe. Mounts a {@link PolicyEnforcerGraph} under `enforcer`.
 *
 * @category patterns
 */
export class GuardedExecutionGraph extends Graph {
	readonly enforcer: PolicyEnforcerGraph;
	readonly violations: TopicGraph<PolicyViolation>;
	private readonly _target: Graph;
	private readonly _defaultActor: Actor | undefined;

	constructor(target: Graph, opts: GuardedExecutionOptions) {
		super(opts.name ?? `${target.name}_guarded`, opts.graph);
		this._target = target;
		this._defaultActor = opts.actor;

		const enforcerOpts: {
			mode: "audit" | "enforce";
			name: string;
			violationsLimit?: number;
		} = {
			mode: opts.mode ?? "enforce",
			name: "enforcer",
		};
		if (opts.violationsLimit != null) enforcerOpts.violationsLimit = opts.violationsLimit;

		this.enforcer = policyEnforcer(target, opts.policies, enforcerOpts);
		this.violations = this.enforcer.violations;

		// Mount the enforcer as a child so `wrapper.describe()` surfaces its
		// `policies` / `violationCount` nodes for introspection.
		this.mount("enforcer", this.enforcer);
	}

	/**
	 * Describe the **target** graph scoped to the configured actor. Returns
	 * only nodes the actor is permitted to see (via the target's node guards
	 * filtering `describe()` via `actor`).
	 *
	 * Pass `{actor}` in opts to override the configured actor for this call.
	 * Pass any standard {@link GraphDescribeOptions} fields (`detail`,
	 * `fields`, `filter`) — they apply to the target's describe.
	 *
	 * **Mode interaction:**
	 * - In `mode: "enforce"` (default), the enforcer stacks a policy-derived
	 *   guard on every target node. `scopedDescribe({actor})` then filters by
	 *   the AND of per-node guards AND the stacked policy guard.
	 * - In `mode: "audit"`, NO guards are stacked — `scopedDescribe` filters
	 *   purely by the target's pre-existing per-node guards. If a target has
	 *   no node-level guards, the policy rules you pass have no effect on
	 *   visibility (they only populate the `violations` topic on writes).
	 */
	scopedDescribe(
		opts?: Omit<GraphDescribeOptions, "actor"> & { actor?: Actor },
	): GraphDescribeOutput {
		const actor = opts?.actor ?? this._defaultActor;
		const describeOpts: GraphDescribeOptions = {
			...opts,
			...(actor != null ? { actor } : {}),
		};
		return this._target.describe(describeOpts);
	}

	/** The wrapped graph (escape hatch for tooling). */
	get target(): Graph {
		return this._target;
	}
}

/**
 * Wrap a {@link Graph} with {@link policyEnforcer} plus a scoped describe
 * lens. Returns a {@link GuardedExecutionGraph} that can be mounted, diffed,
 * or composed with {@link graphLens}.
 *
 * @param target - The graph to guard.
 * @param opts - See {@link GuardedExecutionOptions}.
 *
 * @example
 * ```ts
 * const guarded = guardedExecution(app, {
 *   actor: { type: "human", id: "alice" },
 *   policies: [
 *     { effect: "allow", action: "read", actorType: "human" },
 *     { effect: "deny", action: "write", pathPattern: "system::*" },
 *   ],
 *   mode: "enforce",
 * });
 *
 * const view = guarded.scopedDescribe({ detail: "standard" });
 * guarded.violations.events.subscribe(msgs => console.log("violations:", msgs));
 * ```
 *
 * @category patterns
 */
export function guardedExecution(
	target: Graph,
	opts: GuardedExecutionOptions,
): GuardedExecutionGraph {
	return new GuardedExecutionGraph(target, opts);
}

// Re-export types useful for call sites.
export type { DescribeFilter };
