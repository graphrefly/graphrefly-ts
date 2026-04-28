/**
 * Composable safety layer (roadmap §9.0b — Tier 5.1 Wave-B rebuild).
 *
 * {@link guardedExecution} wraps any {@link Graph} with:
 *
 * - {@link policyGate} — reactive ABAC (Tier 2.3 rename of `policyEnforcer`),
 *   policies stored as a `Node` so LLMs / humans can update them at runtime.
 *   Full transitive dynamic coverage via `watchTopologyTree`.
 * - Reactive {@link GuardedExecutionGraph.scopedDescribeNode} — a thin
 *   delegate over `target.describe({ reactive: true, actor })` that re-derives
 *   on every settle (topology change, error transition, actor swap).
 * - The enforcer's `violations` topic is republished as `violations` on
 *   the wrapper, composable with {@link graphLens}'s `health`.
 * - The wrapper-level `lints` topic surfaces non-policy diagnostic warnings
 *   (`empty-policies` / `audit-no-effect` / `no-actor`) so misconfigurations
 *   are caught reactively rather than via thrown errors at scattered call sites.
 * - The `scope` derived publishes the current configuration tuple
 *   (`{actor, mode, policiesCount}`) for dashboards.
 *
 * V1 scope: policies + actor + reactive scoped describe + lints + scope.
 * Budget-as-option is NOT in V1 — it requires a cost-tracking design that
 * hasn't landed yet. Callers who need a budget limit today append a
 * budget-aware {@link PolicyRuleData} to the policies list (check current
 * cost and `deny` when exhausted).
 *
 * @module
 */
import type { Actor } from "../../core/actor.js";
import { monotonicNs } from "../../core/clock.js";
import type { PolicyRuleData } from "../../core/guard.js";
import { DATA } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { derived, state } from "../../core/sugar.js";
import { domainMeta } from "../../extra/meta.js";
import { keepalive } from "../../extra/sources.js";
import {
	type DescribeFilter,
	Graph,
	type GraphDescribeOptions,
	type GraphDescribeOutput,
	type GraphOptions,
} from "../../graph/index.js";
import { type PolicyGateGraph, type PolicyViolation, policyGate } from "../audit/index.js";
import { TopicGraph } from "../messaging/index.js";

function isNode<T>(x: unknown): x is Node<T> {
	return (
		typeof x === "object" && x !== null && "subscribe" in (x as object) && "down" in (x as object)
	);
}

function guardedMeta(kind: string): Record<string, unknown> {
	return domainMeta("guarded", kind);
}

/** Diagnostic warning published on {@link GuardedExecutionGraph.lints}. */
export interface GuardedExecutionLint {
	/**
	 * - `"empty-policies"` — `policies` Node emitted an empty array in
	 *   `mode: "enforce"`. Static empty arrays throw at construction; this
	 *   covers the reactive case.
	 * - `"audit-no-effect"` — `mode: "audit"` plus the target has no per-node
	 *   guards, so `scopedDescribeNode` filters by per-node guards only and
	 *   policies will never gate visibility (they still populate `violations`
	 *   on writes).
	 * - `"no-actor"` — neither a wrapper-configured nor per-call actor was
	 *   supplied. `scopedDescribeNode` falls back to "describe everything"
	 *   for the corresponding subscription.
	 */
	kind: "empty-policies" | "audit-no-effect" | "no-actor";
	message: string;
	timestamp_ns: number;
}

/** Configuration tuple published on {@link GuardedExecutionGraph.scope}. */
export interface GuardedScope {
	/** The wrapper-configured default actor, or `null` when none configured. */
	actor: Actor | null;
	mode: "audit" | "enforce";
	/** Current policy count (reactive — re-emits on `policies` Node updates). */
	policiesCount: number;
}

/** Options for {@link guardedExecution}. */
export interface GuardedExecutionOptions {
	/**
	 * Policies enforced against every guarded write. Static list or a live
	 * `Node<readonly PolicyRuleData[]>` (LLM-updatable).
	 *
	 * **Empty-policies handling:**
	 * - Static empty array + `mode: "enforce"` throws `RangeError` at
	 *   construction (deny-by-default is almost certainly a misconfiguration).
	 * - Node-supplied empty array + `mode: "enforce"` emits a one-time
	 *   `"empty-policies"` lint on first such emission (the wrapper can't
	 *   throw mid-run — surface the warning reactively).
	 * - `mode: "audit"` tolerates empty policies (no guards stacked; policies
	 *   only feed the `violations` channel on writes).
	 */
	policies: readonly PolicyRuleData[] | Node<readonly PolicyRuleData[]>;
	/**
	 * Default actor used when the caller invokes
	 * {@link GuardedExecutionGraph.scopedDescribeNode} without an override.
	 * Accepts a static {@link Actor} or a `Node<Actor>` — when a Node is
	 * supplied, the reactive describe re-derives on every actor emission so
	 * harnesses binding a per-turn actor get a single live describe Node
	 * instead of re-creating one per turn.
	 *
	 * Omit to scope per-call only. A `"no-actor"` lint fires once per instance
	 * if neither a configured nor per-call actor is ever supplied (the
	 * resulting describe is unscoped — full visibility).
	 */
	actor?: Actor | Node<Actor>;
	/**
	 * `"enforce"` (default) — push guards onto target nodes so disallowed
	 * writes throw {@link GuardDenied}.
	 * `"audit"` — record would-be denials to the `violations` topic without
	 * blocking writes.
	 */
	mode?: "audit" | "enforce";
	/** Ring-buffer cap for the `violations` topic. Default 1000 (inherited from policyGate). */
	violationsLimit?: number;
	/** Ring-buffer cap for the `lints` topic. Default 64 — each lint kind fires at most once per instance. */
	lintsLimit?: number;
	/** Wrapper graph name. Default `${target.name}_guarded`. */
	name?: string;
	/** Wrapper graph options. */
	graph?: GraphOptions;
}

/**
 * Wrapper over a target {@link Graph} providing reactive ABAC + reactive
 * scoped describe + diagnostic lints. Mounts a {@link PolicyGateGraph} under
 * `enforcer`, a {@link TopicGraph} of {@link GuardedExecutionLint} under
 * `lints`, and a `scope` derived publishing `{actor, mode, policiesCount}`.
 *
 * @category patterns
 */
export class GuardedExecutionGraph extends Graph {
	readonly enforcer: PolicyGateGraph;
	readonly violations: TopicGraph<PolicyViolation>;
	readonly lints: TopicGraph<GuardedExecutionLint>;
	readonly scope: Node<GuardedScope>;
	/**
	 * Canonical reactive describe scoped to the wrapper's configured `actor`.
	 * Subscribes ONCE at construction; lifecycle owned by the wrapper (disposed
	 * on `wrapper.destroy()`). Use this property for the common case
	 * (long-lived consumer wanting "describe scoped to my actor"); use
	 * {@link scopedDescribeNode} only when a per-call actor override or
	 * different `detail`/`fields` is required.
	 *
	 * Re-derives on every settle of the target graph: structural changes,
	 * status transitions (errors flip nodes into `"errored"`), and actor
	 * emissions (when a `Node<Actor>` is bound, including the SENTINEL bridge
	 * applied internally — see qa G1B).
	 */
	readonly scopedDescribe: Node<GraphDescribeOutput>;
	private readonly _target: Graph;
	private readonly _actorNode: Node<Actor | null>;
	private readonly _mode: "audit" | "enforce";
	private readonly _firedLintKinds = new Set<GuardedExecutionLint["kind"]>();

	constructor(target: Graph, opts: GuardedExecutionOptions) {
		super(opts.name ?? `${target.name}_guarded`, opts.graph);
		this._target = target;
		this._mode = opts.mode ?? "enforce";

		const policiesOpt = opts.policies;
		const policiesIsNode = isNode<readonly PolicyRuleData[]>(policiesOpt);
		// Static empty + enforce → throw (deny-by-default = misconfig).
		if (
			!policiesIsNode &&
			this._mode === "enforce" &&
			(policiesOpt as readonly PolicyRuleData[]).length === 0
		) {
			throw new RangeError(
				'guardedExecution: empty `policies` in `mode: "enforce"` denies every action. ' +
					'Pass at least `{ effect: "allow", action: "*" }` and layer deny rules on top.',
			);
		}

		// Lints topic — mounted before any potential first-DATA emission.
		this.lints = new TopicGraph<GuardedExecutionLint>("lints", {
			retainedLimit: opts.lintsLimit ?? 64,
		});
		this.mount("lints", this.lints);

		// Normalize `actor` to a Node<Actor | null>. `null` (a valid DATA in
		// the v5 sentinel-as-undefined model) means "no actor configured" —
		// `target.describe({ reactive: true })`'s `resolveActorOption` treats
		// `null` cache as "no scoping" (full visibility), and the `scope`
		// derived can publish `actor: null` cleanly. Using `state(undefined)`
		// here would leave the actor node in sentinel state, which never fires
		// DATA on subscribe and would block the `scope` derived's first-run
		// gate from completing.
		//
		// qa G1B (EC2 fix): when the caller passes a `Node<Actor>`, that node's
		// cache may itself be SENTINEL at construction (e.g. a `producer`
		// awaiting first emission, or a deferred `derived`). Forwarding the raw
		// Node would re-introduce the same sentinel-stall on `scope`. Bridge
		// through a `derived([actorOpt], ...)` with a `null` initial so the
		// internal `_actorNode` always carries non-sentinel cache; the bridge
		// re-emits whenever the caller's Node emits, and forwards `null`
		// through unchanged.
		const actorOpt = opts.actor;
		if (actorOpt == null) {
			this._actorNode = state<Actor | null>(null, { name: "actor" });
		} else if (isNode<Actor>(actorOpt)) {
			this._actorNode = derived<Actor | null>(
				[actorOpt],
				([a]) => (a as Actor | null | undefined) ?? null,
				{ name: "actor", initial: null },
			);
		} else {
			this._actorNode = state<Actor | null>(actorOpt, { name: "actor" });
		}

		// Mount the enforcer.
		const enforcerOpts: { mode: "audit" | "enforce"; name: string; violationsLimit?: number } = {
			mode: this._mode,
			name: "enforcer",
		};
		if (opts.violationsLimit != null) enforcerOpts.violationsLimit = opts.violationsLimit;
		this.enforcer = policyGate(target, opts.policies, enforcerOpts);
		this.violations = this.enforcer.violations;
		this.mount("enforcer", this.enforcer);

		// Empty-policies one-time lint (Node form, enforce mode only).
		if (policiesIsNode && this._mode === "enforce") {
			const policiesNode = policiesOpt as Node<readonly PolicyRuleData[]>;
			// Two paths here intentionally:
			//   (1) Synchronous cache seed — fires immediately if the Node was
			//       constructed with an empty array as its current cache. This
			//       covers `state<…[]>([])` and any pre-emitted derived.
			//   (2) Subscribe path — catches subsequent empty emissions AND
			//       handles the SENTINEL case (cache=undefined at construction)
			//       where the Node fires its first DATA after the wrapper is
			//       built. The `_firedLintKinds` Set keeps the lint one-shot
			//       across both paths.
			// qa F6 (deferred): if a Node's initial cache is SENTINEL (undefined)
			// AND it never emits an empty array (only ever non-empty), the lint
			// never fires — that's correct behavior, the configuration is
			// effectively non-empty for the wrapper's lifetime.
			const cached = policiesNode.cache as readonly PolicyRuleData[] | undefined;
			if (cached != null && cached.length === 0) {
				this._fireLint(
					"empty-policies",
					'`policies` Node cached an empty array in `mode: "enforce"` — every action will be denied. Add at least one allow rule.',
				);
			}
			const offEmpty = policiesNode.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] !== DATA) continue;
					const v = m[1] as readonly PolicyRuleData[] | undefined;
					if (v == null || v.length === 0) {
						this._fireLint(
							"empty-policies",
							'`policies` Node emitted an empty array in `mode: "enforce"` — every action will be denied. Add at least one allow rule.',
						);
					}
				}
			});
			this.addDisposer(offEmpty);
		}

		// Audit-mode + no per-node guards on the target → fire once.
		// qa EC5 (deferred): the check is one-shot at construction. If the
		// caller later mounts a guarded node into the target, the lint stays
		// retained even though the configuration is now effective. Recommended
		// pattern: mount per-node guards on the target BEFORE wrapping.
		// Reactive recompute (subscribe to target.topology, clear lint when a
		// guard appears) is filed in `docs/optimizations.md` as a follow-up.
		if (this._mode === "audit") {
			const described = target.describe({ detail: "full" });
			const anyGuard = Object.values(described.nodes).some((n) => n.guard != null);
			if (!anyGuard) {
				this._fireLint(
					"audit-no-effect",
					'`mode: "audit"` + target has no per-node guards — `scopedDescribeNode` filters by per-node guards only, so policy rules will not affect describe() visibility. Policies still populate the `violations` topic on writes.',
				);
			}
		}

		// No-actor lint: fires at construction when neither configured nor
		// implicitly carried via a Node-cache. Per-call overrides on
		// `scopedDescribeNode` cannot retroactively suppress this — the
		// configured-default branch is what callers most often miss.
		if (actorOpt == null) {
			this._fireLint(
				"no-actor",
				"no actor configured — `wrapper.scopedDescribe` and `scopedDescribeNode()` will return an unscoped describe (full visibility) unless a per-call actor is supplied.",
			);
		}

		// Scope derived: live tuple of {actor, mode, policiesCount}.
		this.scope = derived<GuardedScope>(
			[this._actorNode, this.enforcer.policies],
			([actor, policies]) => ({
				actor: (actor as Actor | null | undefined) ?? null,
				mode: this._mode,
				policiesCount: (policies as readonly PolicyRuleData[]).length,
			}),
			{
				name: "scope",
				describeKind: "derived",
				meta: guardedMeta("scope"),
			},
		);
		this.add(this.scope, { name: "scope" });
		this.addDisposer(keepalive(this.scope));

		// qa G1A "same concept": single canonical reactive describe bound to
		// the configured actor, mounted once at construction. Removes the
		// per-call handle proliferation from the prior `scopedDescribeNode`
		// pattern (the method is retained as the per-call escape hatch). The
		// reactive describe re-derives on actor swap / topology change /
		// status transition; lifecycle owned by the wrapper.
		const scopedHandle = target.describe({
			reactive: true,
			actor: this._actorNode as Node<Actor>,
			reactiveName: "scopedDescribe",
		});
		this.scopedDescribe = scopedHandle.node;
		this.add(this.scopedDescribe, { name: "scopedDescribe" });
		this.addDisposer(scopedHandle.dispose);
	}

	private _fireLint(kind: GuardedExecutionLint["kind"], message: string): void {
		if (this._firedLintKinds.has(kind)) return;
		this._firedLintKinds.add(kind);
		this.lints.publish({ kind, message, timestamp_ns: monotonicNs() });
	}

	/**
	 * **Per-call escape hatch.** Prefer {@link scopedDescribe} (the mounted
	 * property) for the common case of "describe scoped to my actor." Use
	 * this method ONLY when you need a per-call actor override or different
	 * `detail`/`fields`/`filter`.
	 *
	 * Returns a live `Node<GraphDescribeOutput>` scoped to the supplied (or
	 * configured) actor, plus an explicit `dispose` for caller-controlled
	 * lifecycle. Re-derives on every settle of the target graph: structural
	 * changes, status transitions, and actor emissions (when a `Node<Actor>`
	 * is bound).
	 *
	 * **Lifecycle (qa G1A — EC1 fix).** Each call instantiates a fresh
	 * `target.describe({reactive: true})` handle (with its own version state,
	 * observe handle, transitive topology subscriptions, derived + keepalive).
	 * The caller MUST invoke the returned `dispose()` when finished to release
	 * these resources. Disposers ARE also tracked on the wrapper graph so
	 * `wrapper.destroy()` cleans up any handles the caller forgot — but a
	 * long-lived wrapper with heavy per-call usage will leak until destroy
	 * unless `dispose()` is called explicitly.
	 *
	 * @param actorOverride - Optional per-call override. Static {@link Actor}
	 *   or `Node<Actor>`. Omit to use the wrapper-configured default.
	 * @param opts - Standard {@link GraphDescribeOptions} fields (`detail`,
	 *   `fields`, `filter`). `actor` / `reactive` / `reactiveName` are
	 *   controlled by the wrapper.
	 * @returns `{node, dispose}` — `node` is the live describe Node; `dispose`
	 *   tears down the underlying reactive describe subscription idempotently.
	 */
	scopedDescribeNode(
		actorOverride?: Actor | Node<Actor>,
		opts?: Omit<GraphDescribeOptions, "actor" | "reactive" | "reactiveName">,
	): { node: Node<GraphDescribeOutput>; dispose: () => void } {
		const actorNode =
			actorOverride == null
				? this._actorNode
				: isNode<Actor>(actorOverride)
					? actorOverride
					: state<Actor>(actorOverride, { name: "actor_override" });
		const handle = this._target.describe({
			reactive: true,
			// `_actorNode` is `Node<Actor | null>`. The `as Node<Actor>` cast is
			// safe at runtime: `_describeReactive` resolves the actor via
			// `resolveActorOption`, which treats `null`/`undefined` cache as
			// "no scoping" (full visibility). Documented in graph.ts §
			// "Cache-undefined semantics."
			actor: actorNode as Node<Actor>,
			...(opts ?? {}),
		});
		// Track on the wrapper as a safety net for callers who forget to
		// dispose; explicit `dispose()` is still the canonical lifecycle path.
		this.addDisposer(handle.dispose);
		return { node: handle.node, dispose: handle.dispose };
	}

	/** The wrapped graph (escape hatch for tooling). */
	get target(): Graph {
		return this._target;
	}
}

/**
 * Wrap a {@link Graph} with {@link policyGate} plus a reactive scoped describe
 * lens. Returns a {@link GuardedExecutionGraph} that can be mounted, diffed,
 * or composed with {@link graphLens}.
 *
 * @param target - The graph to guard.
 * @param opts - See {@link GuardedExecutionOptions}.
 *
 * @example
 * ```ts
 * const guarded = guardedExecution(app, {
 *   actor: state<Actor>({ type: "human", id: "alice" }), // reactive — re-derive on swap
 *   policies: [
 *     { effect: "allow", action: "read", actorType: "human" },
 *     { effect: "deny", action: "write", pathPattern: "system::*" },
 *   ],
 *   mode: "enforce",
 * });
 *
 * // Canonical: subscribe to the mounted reactive describe (no per-call leak).
 * guarded.scopedDescribe.subscribe((msgs) => { /* live describe per actor / topology change *\/ });
 * // Per-call escape hatch (different actor / detail) — caller manages dispose.
 * const detailed = guarded.scopedDescribeNode(undefined, { detail: "standard" });
 * try { detailed.node.subscribe(/* … *\/); } finally { detailed.dispose(); }
 * guarded.violations.events.subscribe(msgs => console.log("violations:", msgs));
 * guarded.lints.events.subscribe(msgs => console.warn("lints:", msgs));
 * guarded.scope.subscribe(msgs => console.log("scope:", msgs));
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
