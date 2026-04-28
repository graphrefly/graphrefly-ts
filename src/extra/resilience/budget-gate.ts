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
 * Unbounded head-index queue with O(1) `push` and O(1) `shift`.
 *
 * Distinct from {@link RingBuffer} (drop-oldest, fixed capacity) because
 * `budgetGate` MUST NOT silently drop buffered DATA when the gate is closed —
 * upstream is asked to PAUSE and the buffered items are guaranteed to flush
 * once the constraint relaxes (or on terminal force-flush). A drop-oldest
 * eviction would break that contract by losing items between PAUSE and
 * RESUME.
 *
 * Storage grows on demand and is compacted opportunistically: once the head
 * pointer crosses the midpoint of the underlying array, we slice the consumed
 * prefix away. This keeps amortized memory at ~2× live size while keeping
 * `push` and `shift` O(1) — replacing the prior `buffer.slice(1)` per drain
 * which was O(N²) over a long-lived bucket (Tier 3.3.1 fix).
 */
class HeadIndexQueue<T> {
	private buf: T[] = [];
	private head = 0;

	get size(): number {
		return this.buf.length - this.head;
	}

	push(item: T): void {
		this.buf.push(item);
	}

	/** O(1) — removes and returns the oldest item, or `undefined` when empty. */
	shift(): T | undefined {
		if (this.head >= this.buf.length) return undefined;
		const item = this.buf[this.head]!;
		// Release the slot for GC. Cheaper than splice; cost folded into the
		// periodic compaction below.
		(this.buf as Array<T | undefined>)[this.head] = undefined;
		this.head++;
		// Compact when more than half the array is consumed prefix.
		if (this.head > 32 && this.head * 2 > this.buf.length) {
			this.buf = this.buf.slice(this.head);
			this.head = 0;
		}
		return item;
	}

	clear(): void {
		this.buf = [];
		this.head = 0;
	}
}

/**
 * Pass-through that respects reactive constraint nodes.
 *
 * DATA flows through when all constraints are satisfied. When any constraint
 * is exceeded, `PAUSE` is sent upstream and DATA is buffered in a FIFO queue.
 * When constraints relax, the queue drains in arrival order and `RESUME` is
 * sent upstream.
 *
 * ## Invariants (do not refactor without preserving)
 *
 * 1. **Terminal force-flush.** On `COMPLETE` / `ERROR` arriving from `source`,
 *    every buffered item is emitted downstream BEFORE the terminal message is
 *    forwarded. The constraint is intentionally bypassed for the flush — once
 *    upstream is done, the caller must see the buffered work, not lose it.
 *    See COMPOSITION-GUIDE §19 (terminal-emission operators).
 *
 * 2. **PAUSE-release ordering.** When a constraint flips from saturated →
 *    released, the queue drains in FIFO order downstream BEFORE `RESUME` is
 *    sent upstream. Reversing the order (RESUME-then-drain) would let new
 *    upstream DATA interleave with the queue tail, breaking arrival-order
 *    delivery. See COMPOSITION-GUIDE §9, §9a (diamond + batch coalescing).
 *
 * 3. **Deferred RESOLVED.** A `RESOLVED` from `source` while the queue is
 *    non-empty is held until the queue drains, then forwarded — so downstream
 *    sees `[buffered DATA…, RESOLVED]` in causal order rather than
 *    `[RESOLVED, buffered DATA…]`.
 *
 * 4. **Constraint DIRTY suppression.** Constraint-node DIRTY does NOT
 *    propagate downstream — only `source`-DIRTY does. The gate's downstream
 *    semantics track `source`'s wave, not constraint waves.
 *
 * ## Queue
 *
 * The internal buffer is an unbounded {@link HeadIndexQueue} (O(1) push,
 * O(1) shift, opportunistic compaction). It does NOT use {@link RingBuffer}
 * because RingBuffer's drop-oldest eviction would silently lose buffered
 * items between PAUSE and RESUME. Backpressure (PAUSE) is the upstream
 * contract for bounding the queue, not capacity-driven eviction here.
 *
 * ## Producer-pattern: source edge is invisible to `describe()`
 *
 * `budgetGate` is constructed via `node([], fn)` and subscribes to `source`
 * and the constraint nodes manually inside its activation fn. Because no
 * dep is declared at construction, **`describe()` shows no edge from
 * `source` (or any constraint) into the returned node** — the gate looks
 * like a standalone leaf source. This is intentional (see COMPOSITION-GUIDE
 * §24 "Edges are derived, not declared"): if you want the constraint /
 * source dependency to appear in describe output, surface it at the
 * compositor level (e.g. annotate via `meta.ai.upstream`, or wrap the gate
 * in a parent factory that exposes the deps as constructor args).
 *
 * ## Reference equality
 *
 * The `constraints` array reference and each `BudgetConstraint.check`
 * function are captured at construction. The factory does NOT diff
 * subsequent `constraints` arrays (there is no subsequent — the array is
 * static for the gate's lifetime). To swap constraints reactively, build
 * the swap at the compositor level above the gate (Architecture-2:
 * compositor-only). Identity changes to `constraints` are observed only by
 * constructing a new gate.
 *
 * @param source - Input node.
 * @param constraints - Reactive constraint checks. MUST be non-empty.
 * @param opts - Optional node options.
 * @returns Gated node.
 *
 * @throws {RangeError} when `constraints.length === 0`. The gate has no
 *   meaningful identity without at least one check — degenerate to plain
 *   pass-through (e.g. via `derived([source], ([v]) => v)`) instead.
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

	const buffer = new HeadIndexQueue<T>();
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
		// FIFO drain — invariant 2 (PAUSE-release ordering). Stop early if a
		// later constraint check flips false mid-drain (the queue's tail stays
		// buffered for the next RESUME).
		while (buffer.size > 0 && checkBudget()) {
			const item = buffer.shift()!;
			actions.emit(item);
		}
		// Drain deferred RESOLVED once buffer is empty (invariant 3).
		if (buffer.size === 0 && pendingResolved) {
			pendingResolved = false;
			actions.down([[RESOLVED]]);
		}
	}

	// Producer pattern: manually subscribe to all deps for per-message interception.
	// Source / constraint edges are intentionally NOT declared as `_deps` — see
	// the JSDoc "Producer-pattern" section above and COMPOSITION-GUIDE §24.
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
				if (checkBudget() && buffer.size === 0) {
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
				if (buffer.size === 0) {
					actions.down([[RESOLVED]]);
				} else {
					// Buffer non-empty: defer RESOLVED until buffer drains (invariant 3).
					pendingResolved = true;
				}
				return true;
			}
			if (t === COMPLETE || t === ERROR) {
				// Invariant 1: terminal force-flush. Drain every buffered item
				// downstream BEFORE forwarding the terminal — bypass the constraint
				// since "upstream done" must not lose buffered work.
				while (buffer.size > 0) {
					actions.emit(buffer.shift()!);
				}
				pendingResolved = false;
				// Release PAUSE lock before forwarding terminal so upstream sees a
				// clean release rather than a still-paused terminal.
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
			if (checkBudget() && buffer.size > 0) {
				// Invariant 2: drain FIFO downstream BEFORE releasing PAUSE upstream.
				flushBuffer(actions);
				if (buffer.size === 0 && paused) {
					paused = false;
					actions.up([[RESUME, lockId]]);
				}
			} else if (!checkBudget() && !paused && buffer.size > 0) {
				// Defensive — buffer.size > 0 implies paused=true under normal flow
				// (a buffered source DATA always sets paused). Kept for clarity if
				// invariants ever shift.
				paused = true;
				actions.up([[PAUSE, lockId]]);
			}
			return true;
		}
		if (t === DIRTY) {
			// Invariant 4: constraint DIRTY does not propagate downstream.
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
