import type { Actor } from "./actor.js";
import { type Node, NodeImpl } from "./node.js";

/**
 * Actions checked by {@link NodeGuard}. `write` covers both {@link Node.down} and
 * {@link Node.up} today; finer-grained strings may be added later (e.g. `"write.data"`).
 */
export type GuardAction = "write" | "signal" | "observe" | (string & {});

export type NodeGuard = (actor: Actor, action: GuardAction) => boolean;

export type GuardDeniedDetails = {
	actor: Actor;
	action: GuardAction;
	/** Registry or options name when known */
	nodeName?: string;
};

/**
 * Thrown when a {@link NodeGuard} denies an action for a given actor.
 *
 * Carries the rejected `actor`, `action`, and optional `nodeName` for diagnostic
 * messages and middleware error handling.
 *
 * @example
 * ```ts
 * import { GuardDenied, policy } from "@graphrefly/graphrefly-ts";
 *
 * const guard = policy((allow) => { allow("observe"); });
 * try {
 *   if (!guard({ type: "llm", id: "agent-1" }, "write")) {
 *     throw new GuardDenied(
 *       { actor: { type: "llm", id: "agent-1" }, action: "write", nodeName: "userInput" },
 *     );
 *   }
 * } catch (e) {
 *   if (e instanceof GuardDenied) console.error(e.action, e.actor.type); // "write" "llm"
 * }
 * ```
 */
export class GuardDenied extends Error {
	readonly actor: Actor;
	readonly action: GuardAction;
	readonly nodeName?: string;

	/**
	 * @param details - Actor, action, and optional node name for the denial.
	 * @param message - Optional override for the default error message.
	 */
	constructor(details: GuardDeniedDetails, message?: string) {
		super(
			message ??
				`GuardDenied: action "${String(details.action)}" denied for actor type "${String(details.actor.type)}"`,
		);
		this.name = "GuardDenied";
		this.actor = details.actor;
		this.action = details.action;
		this.nodeName = details.nodeName;
	}

	/** Qualified registry path when known (roadmap diagnostics: same as {@link nodeName}). */
	get node(): string | undefined {
		return this.nodeName;
	}
}

type Where = (actor: Actor) => boolean;

type Rule = {
	kind: "allow" | "deny";
	actions: Set<GuardAction>;
	where: Where;
};

function normalizeActions(action: GuardAction | readonly GuardAction[]): GuardAction[] {
	if (Array.isArray(action)) {
		return [...action];
	}
	return [action as GuardAction];
}

function matchesActions(set: Set<GuardAction>, action: GuardAction): boolean {
	return set.has(action) || set.has("*" as GuardAction);
}

export type PolicyAllow = (
	action: GuardAction | readonly GuardAction[],
	opts?: { where?: Where },
) => void;

export type PolicyDeny = (
	action: GuardAction | readonly GuardAction[],
	opts?: { where?: Where },
) => void;

export type PolicyRuleData = {
	effect: "allow" | "deny";
	action: GuardAction | readonly GuardAction[];
	actorType?: string | readonly string[];
	actorId?: string | readonly string[];
	claims?: Record<string, unknown>;
};

/**
 * Declarative guard builder. Precedence: any matching **deny** blocks even if an allow also matches.
 * If no rule matches, the guard returns `false` (deny-by-default). Aligned with graphrefly-py `policy()`.
 *
 * @param build - Callback that registers `allow(...)` / `deny(...)` rules in order.
 * @returns A `NodeGuard` for use as `node({ guard })`.
 *
 * @example
 * ```ts
 * const guard = policy((allow, deny) => {
 *   allow("observe");
 *   deny("write", { where: (a) => a.type === "llm" });
 * });
 * ```
 */
export function policy(build: (allow: PolicyAllow, deny: PolicyDeny) => void): NodeGuard {
	const rules: Rule[] = [];
	const allow: PolicyAllow = (action, opts) => {
		rules.push({
			kind: "allow",
			actions: new Set(normalizeActions(action)),
			where: opts?.where ?? (() => true),
		});
	};
	const deny: PolicyDeny = (action, opts) => {
		rules.push({
			kind: "deny",
			actions: new Set(normalizeActions(action)),
			where: opts?.where ?? (() => true),
		});
	};
	build(allow, deny);
	return (actor, action) => {
		let denied = false;
		let allowed = false;
		for (const r of rules) {
			if (!matchesActions(r.actions, action)) continue;
			if (!r.where(actor)) continue;
			if (r.kind === "deny") {
				denied = true;
			} else {
				allowed = true;
			}
		}
		if (denied) return false;
		return allowed;
	};
}

/**
 * Rebuild a declarative guard from persisted policy data (snapshot-safe).
 *
 * Rules are deny-overrides, same semantics as {@link policy}.
 */
export function policyFromRules(rules: readonly PolicyRuleData[]): NodeGuard {
	return policy((allow, deny) => {
		for (const rule of rules) {
			const actorTypes =
				rule.actorType == null
					? null
					: new Set(Array.isArray(rule.actorType) ? rule.actorType : [rule.actorType]);
			const actorIds =
				rule.actorId == null
					? null
					: new Set(Array.isArray(rule.actorId) ? rule.actorId : [rule.actorId]);
			const claimEntries = Object.entries(rule.claims ?? {});
			const where: Where = (actor) => {
				if (actorTypes !== null && !actorTypes.has(String(actor.type))) return false;
				if (actorIds !== null && !actorIds.has(String(actor.id ?? ""))) return false;
				for (const [key, value] of claimEntries) {
					if ((actor as Record<string, unknown>)[key] !== value) return false;
				}
				return true;
			};
			if (rule.effect === "deny") {
				deny(rule.action, { where });
			} else {
				allow(rule.action, { where });
			}
		}
	});
}

/**
 * Reactive-options widening of {@link policy} (DS-14.5.A delta #8, Q7;
 * follows the DS-13.5.B reactive-options pattern landed 2026-05-03).
 *
 * The closure-builder `policy()` form freezes its rules at construction.
 * Multi-agent subgraph ownership needs the allow-set to *re-point* when an
 * ownership claim is made / released / overridden, without rebuilding graph
 * topology. `policyAllowing` accepts either a static actor-id allow-list OR a
 * `Node<readonly string[]>` whose current cache is the live allow-list; the
 * returned `NodeGuard` reads the latest value synchronously at write-check
 * time (`Node.cache` is a sync getter — no async in the guard path).
 *
 * Semantics:
 * - `action === "write"` (and `"signal"`): allowed iff `actor.id` is in the
 *   current allow-set. Deny-by-default when the set is empty / SENTINEL
 *   (`cache == null`) — an unclaimed subgraph denies every writer until a
 *   claim names an owner (Q7 hard-block; the un-claimed case is closed, not
 *   open).
 * - `action === "observe"`: always allowed — ownership gates *writes*, not
 *   reads (reviewers / supervisors must still inspect an owned subgraph).
 * - other custom actions: deny-by-default (same as `policy()`).
 *
 * @param allowed - Static `readonly string[]` of permitted `Actor.id`s, OR a
 *   `Node<readonly string[]>` reactive option (claim/release/override
 *   re-emits the set).
 *
 * @example
 * ```ts
 * const owner = state<readonly string[]>(["agent-a"]);
 * const g = policyAllowing(owner);
 * g({ type: "llm", id: "agent-a" }, "write"); // true
 * g({ type: "llm", id: "agent-b" }, "write"); // false
 * owner.set(["agent-b"]);                       // claim handed over
 * g({ type: "llm", id: "agent-b" }, "write"); // true (re-pointed, no rewire)
 * ```
 */
export function policyAllowing(allowed: readonly string[] | Node<readonly string[]>): NodeGuard {
	const readAllow = (): readonly string[] => {
		if (allowed instanceof NodeImpl) {
			const c = (allowed as Node<readonly string[]>).cache;
			return Array.isArray(c) ? c : [];
		}
		return allowed as readonly string[];
	};
	return (actor, action) => {
		if (action === "observe") return true;
		if (action === "write" || action === "signal") {
			const set = readAllow();
			return set.includes(String(actor.id ?? ""));
		}
		return false;
	};
}

const STANDARD_WRITE_TYPES = ["human", "llm", "wallet", "system"] as const;

/**
 * Derives a best-effort `meta.access` hint string by probing `guard` with the
 * standard actor types `human`, `llm`, `wallet`, `system` for the `"write"` action
 * (roadmap 1.5). Aligned with graphrefly-py `access_hint_for_guard`.
 *
 * @param guard - Guard function to probe (typically from {@link policy}).
 * @returns `"restricted"` when no standard type is allowed; `"both"` when both
 *   `human` and `llm` are allowed (plus optionally `system`); the single allowed
 *   type name when only one passes; or a `"+"` joined list otherwise.
 *
 * @example
 * ```ts
 * import { policy, accessHintForGuard } from "@graphrefly/graphrefly-ts";
 *
 * const guardBoth = policy((allow) => { allow("write"); });
 * accessHintForGuard(guardBoth); // "both"
 *
 * const guardHuman = policy((allow) => {
 *   allow("write", { where: (a) => a.type === "human" });
 * });
 * accessHintForGuard(guardHuman); // "human"
 * ```
 */
export function accessHintForGuard(guard: NodeGuard): string {
	const allowed = STANDARD_WRITE_TYPES.filter((t) => guard({ type: t, id: "" }, "write"));
	if (allowed.length === 0) return "restricted";
	if (
		allowed.includes("human") &&
		allowed.includes("llm") &&
		allowed.every((t) => t === "human" || t === "llm" || t === "system")
	) {
		return "both";
	}
	if (allowed.length === 1) return allowed[0];
	return allowed.join("+");
}
