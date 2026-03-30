import type { Actor } from "./actor.js";

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
