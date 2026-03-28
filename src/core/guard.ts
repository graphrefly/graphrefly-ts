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

export class GuardDenied extends Error {
	readonly actor: Actor;
	readonly action: GuardAction;
	readonly nodeName?: string;

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
 * Declarative guard builder. Rules run in registration order; the first matching rule wins.
 * If no rule matches, the guard returns `true` (permit).
 */
/**
 * Declarative guard builder. Precedence: any matching **deny** blocks even if
 * an allow also matches. If no rule matches, the guard returns `false` (deny).
 * Aligned with graphrefly-py `policy()`.
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
 * Best-effort `meta.access` string when a guard is present (roadmap 1.5).
 * Probes the guard with standard actor types for the `"write"` action.
 * Aligned with graphrefly-py `access_hint_for_guard`.
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
