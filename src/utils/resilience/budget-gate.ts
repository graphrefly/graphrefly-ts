/**
 * `budgetGate` — numeric-constraint flow gate (Tier 2.2 promotion from
 * `patterns/reduction/`).
 *
 * Lives alongside the other `extra/resilience/` flow controls (`retry`,
 * `circuitBreaker`, `rateLimiter`, `tokenBucket`, `fallback`, `withStatus`).
 *
 * @module
 */

import type { NodeActions } from "@graphrefly/pure-ts/core/config.js";
import { type Node, type NodeOptions, node } from "@graphrefly/pure-ts/core/node.js";
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
import { domainMeta } from "../meta.js";
import type { GateState } from "./gate-state.js";

/** A reactive constraint for {@link budgetGate}. */
export type BudgetConstraint<T = unknown> = {
	/** Constraint node whose value is checked. */
	node: Node<T>;
	/** Returns `true` when the constraint is satisfied (budget available). */
	check: (value: T) => boolean;
	/**
	 * Optional human-readable name for `BudgetGateState.constraintsSnapshot`.
	 * Defaults to the constraint Node's `.name` (or `""` when unset).
	 */
	name?: string;
};

/** Options for {@link budgetGate}. */
export type BudgetGateOptions = Omit<NodeOptions<unknown>, "describeKind" | "name" | "meta"> & {
	meta?: Record<string, unknown>;
};

/**
 * Per-constraint snapshot inside {@link BudgetGateState}. The `value` field is
 * typed as `unknown` because constraint values are generic — most callers
 * carry numeric budgets but the gate doesn't enforce that. Cast at the
 * subscriber site if you need a narrower type.
 *
 * @category extra/resilience
 */
export interface BudgetConstraintSnapshot {
	readonly name: string;
	readonly satisfied: boolean;
	readonly value: unknown;
}

/**
 * Lifecycle-shaped state companion emitted by {@link budgetGate} (DS-13.5.B,
 * locked 2026-05-01). `status` is `"open"` when every constraint's `check`
 * returns true; `"closed"` otherwise. The `constraintsSnapshot` array
 * preserves constraint ordering and reflects the most recent values seen
 * via per-constraint reactive updates.
 *
 * @category extra/resilience
 */
export interface BudgetGateState {
	readonly status: GateState;
	readonly constraintsSnapshot: ReadonlyArray<BudgetConstraintSnapshot>;
}

/**
 * Bundle returned by {@link budgetGate}: the gated output node and its
 * gate-state companion. Pre-1.0 break vs. the prior `Node<T>` return —
 * unwrap via `.node` for downstream wiring.
 *
 * @category extra/resilience
 */
export interface BudgetGateBundle<T> {
	node: Node<T>;
	budgetGateState: Node<BudgetGateState>;
}

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
 * prefix away. Memory bound is **worst-case ~3× live size** (DF3, 2026-04-29
 * doc tighten — a queue that grows to N, drains to 0.6N, then re-pushes 0.4N
 * retains ~3× live size between compactions). Amortized footprint trends
 * lower under steady-state usage. Trade-off: keeps `push` and `shift` O(1) —
 * replacing the prior `buffer.slice(1)` per drain which was O(N²) over a
 * long-lived bucket (Tier 3.3.1 fix).
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
 *    **Stall risk (qa D4):** if the constraint never relaxes AND no terminal
 *    arrives from `source`, the deferred RESOLVED is held forever. Downstream
 *    consumers that depend on `RESOLVED` for an `awaitSettled`-style
 *    coordination wait stall in this case. PAUSE is sent upstream so source
 *    backpressure stops further DATA, but the gate itself has no escape
 *    hatch — by design (the producer-pattern is fire-and-forget; recovery
 *    happens at the compositor level via timeout, retry, or cancellation).
 *
 * 4. **Constraint DIRTY suppression.** Constraint-node DIRTY does NOT
 *    propagate downstream — only `source`-DIRTY does. The gate's downstream
 *    semantics track `source`'s wave, not constraint waves.
 *
 * 5. **Lazy PAUSE (qa D3).** PAUSE is sent upstream ONLY when a `source` DATA
 *    arrives that fails the constraint check (the first blocked item). A
 *    constraint flipping closed BEFORE any source DATA arrives does NOT emit
 *    a preemptive PAUSE — upstream may push DATA freely until the first
 *    item is buffered. This matches the producer-pattern lazy-activation
 *    philosophy (don't impose backpressure for hypothetical future blocks).
 *    For eager-PAUSE semantics, wrap the gate in a compositor that watches
 *    constraints + source independently.
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
 * ## Reference equality + Tier 6.5 3.2.5 locked semantics
 *
 * **Constraint VALUES are reactive.** Each `BudgetConstraint.node` is
 * subscribed at activation; per-value changes flip the gate (re-evaluate
 * in the same wave) and trigger PAUSE/RESUME upstream. Per the locked
 * semantic rule for the reactive-options-widening batch (Tier 6.5 3.2.5,
 * 2026-04-29): "constraints array re-evaluated immediately against
 * current source; adding/removing constraints triggers gate
 * re-evaluation in the same wave" — the per-value half is shipped via
 * the existing constraint-Node subscription model.
 *
 * **The constraints ARRAY shape is static.** The factory captures the
 * `constraints` array reference and each `check` function at
 * construction; it does NOT diff subsequent arrays. To add or remove
 * constraints reactively, build the swap at the compositor level (a
 * `switchMap` rebuild over a constraint-shape Node), or construct a new
 * gate. Dynamic constraint-array reactivity is intentionally deferred —
 * the subscription churn (resub on every constraint add/remove) and
 * `latestValues` shape mutation overshoot the budget-gate's
 * fire-and-forget ergonomics.
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
): BudgetGateBundle<T> {
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

	// DS-13.5.B (locked 2026-05-01): lifecycle-shaped state companion.
	// Initialized with `status: "closed"` until activation seeds the values
	// and the first `checkBudget()` runs.
	//
	// QA A3 (2026-05-03): equality uses structural compare on
	// `(status, name, satisfied, value)` tuples via `Object.is` per
	// `value` — NOT `JSON.stringify`. Caller-supplied constraint values
	// (`unknown`) can be circular, BigInt, or otherwise non-serializable;
	// `JSON.stringify` would throw and corrupt the wave dispatch.
	function budgetGateStateEqual(a: BudgetGateState, b: BudgetGateState): boolean {
		if (a === b) return true;
		if (a.status !== b.status) return false;
		const sa = a.constraintsSnapshot;
		const sb = b.constraintsSnapshot;
		if (sa.length !== sb.length) return false;
		for (let i = 0; i < sa.length; i++) {
			const ai = sa[i];
			const bi = sb[i];
			if (ai === undefined || bi === undefined) return false;
			if (ai.name !== bi.name) return false;
			if (ai.satisfied !== bi.satisfied) return false;
			if (!Object.is(ai.value, bi.value)) return false;
		}
		return true;
	}

	const budgetGateState = node<BudgetGateState>([], {
		name: "budgetGateState",
		describeKind: "state",
		initial: {
			status: "closed",
			constraintsSnapshot: constraints.map((c) => ({
				name: c.name ?? c.node.name ?? "",
				satisfied: false,
				value: undefined,
			})),
		},
		equals: budgetGateStateEqual,
	});

	let lastEmittedState: BudgetGateState | null = null;

	function publishState(): void {
		const snapshot: BudgetConstraintSnapshot[] = constraints.map((c, i) => {
			const v = latestValues[i];
			let satisfied = false;
			try {
				satisfied = c.check(v as never);
			} catch (err) {
				// QA A3: log the bug-throw rather than silently mapping to
				// `satisfied=false`. The constraint's check function failing
				// is a programmer error — at minimum surface it to console.
				console.error(
					`budgetGate: constraint "${c.name ?? c.node.name ?? `[${i}]`}" check threw; treating as not satisfied.`,
					err,
				);
				satisfied = false;
			}
			return {
				name: c.name ?? c.node.name ?? "",
				satisfied,
				value: v,
			};
		});
		const status: GateState = snapshot.every((s) => s.satisfied) ? "open" : "closed";
		const next: BudgetGateState = { status, constraintsSnapshot: snapshot };
		if (lastEmittedState != null && budgetGateStateEqual(lastEmittedState, next)) {
			return;
		}
		lastEmittedState = next;
		budgetGateState.down([[DIRTY], [DATA, next]]);
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
	const out = node<T>(
		[],
		(_data, gateActions) => {
			// Seed `latestValues` at activation (not factory time) so any constraint
			// updates between factory return and first subscribe are captured before
			// source's push-on-subscribe fires `checkBudget()`.
			for (let i = 0; i < constraints.length; i++) {
				latestValues[i] = constraints[i]!.node.cache;
			}
			// Seed the companion state at activation as well.
			publishState();
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

	return { node: out, budgetGateState };

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
			// qa A2: hoist `checkBudget()` to a local — both branches consult it
			// and `c.check(value)` may be expensive or non-pure (closes over time,
			// counters, etc.); calling it twice was a 2× cost amplifier and an
			// inconsistency risk if the predicate flips between calls.
			//
			// qa A3: each constraint's `c.check(latestValues[i])` runs against
			// the constraint's last cached value. If a constraint's cache is
			// `undefined` (constraint Node hasn't emitted DATA yet OR was
			// activated before any push-on-subscribe), the predicate sees
			// `undefined`. Treat undefined as "constraint not ready ⇒ closed"
			// (conservative — don't release the gate on incomplete state).
			const ok = checkBudget();
			if (ok && buffer.size > 0) {
				// Invariant 2: drain FIFO downstream BEFORE releasing PAUSE upstream.
				flushBuffer(actions);
				if (buffer.size === 0 && paused) {
					paused = false;
					actions.up([[RESUME, lockId]]);
				}
			} else if (!ok && !paused && buffer.size > 0) {
				// Defensive — buffer.size > 0 implies paused=true under normal flow
				// (a buffered source DATA always sets paused). Kept for clarity if
				// invariants ever shift.
				paused = true;
				actions.up([[PAUSE, lockId]]);
			}
			// DS-13.5.B: re-publish gate state on constraint update.
			if (t === DATA) publishState();
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
