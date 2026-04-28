/**
 * `budgetGate` — numeric-constraint flow gate (Tier 2.2 promotion from
 * `patterns/reduction/`).
 *
 * Lives alongside the other `extra/resilience/` flow controls (`retry`,
 * `circuitBreaker`, `rateLimiter`, `tokenBucket`, `fallback`, `withStatus`).
 *
 * @module
 */

import type { NodeActions } from "../../core/config.js";
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	type Message,
	PAUSE,
	RESOLVED,
	RESUME,
} from "../../core/messages.js";
import { type Node, type NodeOptions, node } from "../../core/node.js";
import { domainMeta } from "../meta.js";

/** A reactive constraint for {@link budgetGate}. */
export type BudgetConstraint<T = unknown> = {
	/** Constraint node whose value is checked. */
	node: Node<T>;
	/** Returns `true` when the constraint is satisfied (budget available). */
	check: (value: T) => boolean;
};

/** Options for {@link budgetGate}. */
export type BudgetGateOptions = Omit<NodeOptions<unknown>, "describeKind" | "name" | "meta"> & {
	meta?: Record<string, unknown>;
};

/**
 * Pass-through that respects reactive constraint nodes.
 *
 * DATA flows through when all constraints are satisfied. When any constraint
 * is exceeded, PAUSE is sent upstream and DATA is buffered. When constraints
 * relax, RESUME is sent and buffered DATA flushes.
 *
 * @param source - Input node.
 * @param constraints - Reactive constraint checks.
 * @param opts - Optional node options.
 * @returns Gated node.
 *
 * @category resilience
 */
export function budgetGate<T>(
	source: Node<T>,
	constraints: ReadonlyArray<BudgetConstraint>,
	opts?: BudgetGateOptions,
): Node<T> {
	if (constraints.length === 0) throw new RangeError("budgetGate requires at least one constraint");

	const constraintNodes = constraints.map((c) => c.node);
	const allDeps = [source as Node, ...constraintNodes] as Node[];

	let buffer: T[] = [];
	let paused = false;
	let pendingResolved = false;
	const lockId = Symbol("budget-gate");

	// Latest DATA from each constraint. Seeded at **activation time** (inside the
	// producer fn below) — a wiring-time boundary read, not a reactive-callback
	// read — so concurrent constraint updates between factory-time and
	// activation-time are reflected before `checkBudget()` first runs. The
	// subscribe handler updates this array on each constraint DATA message, so
	// `checkBudget` never reads `.cache` from inside a reactive callback.
	const latestValues: unknown[] = new Array(constraints.length);

	function checkBudget(): boolean {
		return constraints.every((c, i) => c.check(latestValues[i]));
	}

	function flushBuffer(actions: NodeActions): void {
		while (buffer.length > 0 && checkBudget()) {
			const item = buffer[0]!;
			buffer = buffer.slice(1);
			actions.emit(item);
		}
		// Drain deferred RESOLVED once buffer is empty
		if (buffer.length === 0 && pendingResolved) {
			pendingResolved = false;
			actions.down([[RESOLVED]]);
		}
	}

	// Producer pattern: manually subscribe to all deps for per-message interception
	// (onMessage removed in v5 — use producer+subscribe instead)
	return node<T>(
		[],
		(_data, gateActions) => {
			// Seed `latestValues` at activation (not factory time) so any constraint
			// updates between factory return and first subscribe are captured before
			// source's push-on-subscribe fires `checkBudget()`.
			for (let i = 0; i < constraints.length; i++) {
				latestValues[i] = constraints[i]!.node.cache;
			}
			const unsubs: Array<() => void> = [];
			for (let depIdx = 0; depIdx < allDeps.length; depIdx++) {
				const dep = allDeps[depIdx];
				unsubs.push(
					dep.subscribe((msgs) => {
						for (const msg of msgs) {
							_handleBudgetMessage(msg, depIdx, gateActions);
						}
					}),
				);
			}
			return () => {
				for (const u of unsubs) u();
			};
		},
		{
			...opts,
			describeKind: "derived",
			meta: domainMeta("resilience", "budget_gate", opts?.meta),
		} as NodeOptions<T>,
	);

	function _handleBudgetMessage(msg: Message, depIndex: number, actions: NodeActions): boolean {
		const t = msg[0];

		// Source messages (dep 0)
		if (depIndex === 0) {
			if (t === DATA) {
				if (checkBudget() && buffer.length === 0) {
					actions.emit(msg[1] as T);
				} else {
					buffer.push(msg[1] as T);
					if (!paused) {
						paused = true;
						actions.up([[PAUSE, lockId]]);
					}
				}
				return true;
			}
			if (t === DIRTY) {
				actions.down([[DIRTY]]);
				return true;
			}
			if (t === RESOLVED) {
				if (buffer.length === 0) {
					actions.down([[RESOLVED]]);
				} else {
					// Buffer non-empty: defer RESOLVED until buffer drains
					pendingResolved = true;
				}
				return true;
			}
			if (t === COMPLETE || t === ERROR) {
				// Force-flush all buffered items regardless of budget (terminal = done)
				for (const item of buffer) {
					actions.emit(item);
				}
				buffer = [];
				pendingResolved = false;
				// Release PAUSE lock before forwarding terminal
				if (paused) {
					paused = false;
					actions.up([[RESUME, lockId]]);
				}
				actions.down([msg]);
				return true;
			}
			return false;
		}

		// Constraint node messages (dep 1+): capture DATA then re-check budget
		if (t === DATA) {
			latestValues[depIndex - 1] = msg[1];
		}
		if (t === DATA || t === RESOLVED) {
			if (checkBudget() && buffer.length > 0) {
				flushBuffer(actions);
				if (buffer.length === 0 && paused) {
					paused = false;
					actions.up([[RESUME, lockId]]);
				}
			} else if (!checkBudget() && !paused && buffer.length > 0) {
				paused = true;
				actions.up([[PAUSE, lockId]]);
			}
			return true;
		}
		if (t === DIRTY) {
			// Don't propagate constraint DIRTY downstream
			return true;
		}
		if (t === ERROR) {
			// Constraint error → forward downstream
			actions.down([msg]);
			return true;
		}
		if (t === COMPLETE) {
			// Constraint completed — locked at last value, no-op
			return true;
		}
		// Unknown constraint types → default forwarding
		return false;
	}
}
