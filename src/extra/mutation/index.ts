/**
 * Audited-mutation framework (Audit 2 — locked 2026-04-24; promoted to
 * `extra/mutation/` per consolidation plan §1, Tier 2.2).
 *
 * Phase-4 primitives share the same shape: imperative mutation methods +
 * closure state + reactive audit log + freeze-at-entry + rollback-on-throw.
 * This module factors out the common machinery so each primitive becomes
 * declarative wiring over typed audit records:
 *  - `approvalGate`, `pipeline.approvalGate`  (Wave A.2 Unit 8)
 *  - `JobQueueGraph`                          (Wave B.3 Unit 15)
 *  - `CqrsGraph.dispatch`                     (Wave C.2 Unit 20)
 *  - `CqrsGraph.saga`                         (Wave C.3 Unit 22)
 *  - `processManager`                         (Wave 7)
 */

import { batch } from "../../core/batch.js";
import { wallClockNs } from "../../core/clock.js";
import { type NodeGuard, policy } from "../../core/guard.js";
import { DATA, DIRTY } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";
import { Graph } from "../../graph/graph.js";
import {
	type ReactiveLogBundle,
	type ReactiveLogOptions,
	reactiveLog,
} from "../data-structures/reactive-log.js";

// ── tryIncrementBounded ──────────────────────────────────────────────────

/**
 * Bounded increment for a self-owned counter state node.
 *
 * Reads `counter.cache`, bumps by `by` (default 1) if `cur + by <= cap`,
 * writes back. Returns `false` when the cap would be exceeded (no-op write).
 * Documented P3 exception: the counter is not a declared dep of the caller —
 * it's a private budget read+written from a single call site. This helper
 * keeps the `.cache` access in one named place so caller bodies (which may
 * be inside reactive fn execution paths) stay free of cross-node `.cache`
 * reads.
 *
 * **Safety today:**
 *   1. Single-threaded JS runner never invokes the caller concurrently.
 *   2. `counter.down` writes the cache synchronously before returning, so
 *      synchronous re-entry through a downstream publish reads the
 *      freshly-incremented value — no double-count.
 *
 * **Future risk:** under a free-threaded runner (PY no-GIL or hypothetical
 * concurrent TS runner), two concurrent firings could still race. Revisit
 * when that surfaces.
 *
 * @param counter - Self-owned counter Node. Caller is the sole writer.
 * @param cap - Upper bound (inclusive). Pass `Number.MAX_SAFE_INTEGER` for
 *              "effectively unbounded" use cases (e.g. token meters).
 * @param by - Delta to add (default `1`). Must be a finite non-negative
 *             number; callers should pre-validate. Overflow-safe via
 *             `by > cap - cur` check rather than `cur + by >= cap`.
 */
export function tryIncrementBounded(counter: Node<number>, cap: number, by = 1): boolean {
	const cur = (counter.cache as number | undefined) ?? 0;
	if (by > cap - cur) return false;
	counter.down([[DIRTY], [DATA, cur + by]]);
	return true;
}

// ── Audit record schema ──────────────────────────────────────────────────

/** Shared base shape for every audit record. Per-primitive types extend this. */
export interface BaseAuditRecord {
	readonly t_ns: number;
	readonly seq?: number;
	readonly handlerVersion?: { id: string; version: string | number };
}

// ── Default audit guard ──────────────────────────────────────────────────

/**
 * Allow `observe` and `signal`; deny external `write` on the audit log so
 * consumers can subscribe + signal-bridge but cannot inject fake records.
 */
export const DEFAULT_AUDIT_GUARD: NodeGuard = policy((allow, deny) => {
	allow("observe");
	allow("signal");
	deny("write");
});

// ── createAuditLog ───────────────────────────────────────────────────────

export type AuditLogOpts<R extends BaseAuditRecord> = {
	name: string;
	/** Bounded retention; default 1024 per Audit 2 / cross-cutting bounded-default policy. */
	retainedLimit?: number;
	/** Override the default audit guard. */
	guard?: NodeGuard;
	/** Mount the audit `entries` Node under this graph (and activate withLatest). */
	graph?: Graph;
	/** Pass-through to {@link reactiveLog}. */
	versioning?: ReactiveLogOptions<R>["versioning"];
};

/**
 * Build a reactive audit log with sane defaults: bounded retention, deny-write
 * guard, `withLatest()` companions activated. Returns the {@link ReactiveLogBundle}
 * directly — primitives expose this as `<primitive>.events` / `.decisions` /
 * `.dispatches` / `.invocations` and alias it as `.audit`.
 *
 * @category internal
 */
export function createAuditLog<R extends BaseAuditRecord>(
	opts: AuditLogOpts<R>,
): ReactiveLogBundle<R> {
	const log = reactiveLog<R>([], {
		name: opts.name,
		maxSize: opts.retainedLimit ?? 1024,
		guard: opts.guard ?? DEFAULT_AUDIT_GUARD,
		...(opts.versioning != null ? { versioning: opts.versioning } : {}),
	});
	// Lazy companion activation up-front so `bundle.lastValue` / `hasLatest`
	// are queryable without an explicit `withLatest()` call.
	log.withLatest();
	if (opts.graph) {
		opts.graph.add(log.entries, { name: opts.name });
	}
	return log;
}

// ── Mutation framework (two tiers) ───────────────────────────────────────
//
// Both `lightMutation` (substrate-tier) and `wrapMutation` (orchestration-tier)
// share the same audit-record stamping and seq-cursor semantics via the
// `appendAudit` + `bumpCursor` helpers below. They differ only in the top-level
// frame:
//
// - `lightMutation` runs the action plain (no batch, no rollback). Use for
//   atomic single-write mutations where rollback-on-throw is not needed
//   (memory primitive `upsert/remove/clear/link/unlink/rescore/reindex`,
//   `TopicGraph.publish`, `JobQueueGraph.enqueue/ack/nack`).
//
// - `wrapMutation` opens a `batch()` frame around the action so an in-flight
//   throw rolls back partial state. Use for orchestration-tier multi-step
//   mutations (`gate.approve/reject/modify/open/close`, `CqrsGraph.dispatch`,
//   `CqrsGraph.saga`, `processManager.start/cancel`).
//
// **Heuristic:** if your imperative method's body is one or two lines (mutate
// state, emit), use `lightMutation`. If it runs a user-supplied handler or
// has multiple steps that could leave inconsistent state mid-throw, use
// `wrapMutation`. Audit log shape is identical; only orchestration overhead
// differs.

export type FailureMeta = {
	t_ns: number;
	seq?: number;
	errorType: string;
};

export type SuccessMeta = {
	t_ns: number;
	seq?: number;
};

/** Common opts shared by both tiers. */
export type MutationOpts<TArgs extends readonly unknown[], TResult, R extends BaseAuditRecord> = {
	/**
	 * Optional audit log. When omitted, the wrapper still provides freeze /
	 * seq-advance / rollback-on-throw (`wrapMutation`) but skips audit-record
	 * emission entirely — useful for primitives that want centralized mutation
	 * semantics without a dedicated audit log surface (e.g. `Topic.publish`).
	 * Pair with `onSuccess` / `onFailure` to emit records.
	 */
	audit?: ReactiveLogBundle<R>;
	/** Build the success record from the action's args + result + meta. */
	onSuccess?: (args: TArgs, result: TResult, meta: SuccessMeta) => R | undefined;
	/** Build the failure record from the args + error + meta. */
	onFailure?: (args: TArgs, error: unknown, meta: FailureMeta) => R | undefined;
	/** Freeze inputs at entry (default `true`). Pass `false` for hot paths. */
	freeze?: boolean;
	/** Optional sequence cursor — auto-advanced and stamped onto records. */
	seq?: Node<number>;
	/** Optional handler version — stamped into the record (Audit 5). */
	handlerVersion?: { id: string; version: string | number };
};

export type WrapMutationOpts<
	TArgs extends readonly unknown[],
	TResult,
	R extends BaseAuditRecord,
> = MutationOpts<TArgs, TResult, R>;

export type LightMutationOpts<
	TArgs extends readonly unknown[],
	TResult,
	R extends BaseAuditRecord,
> = MutationOpts<TArgs, TResult, R>;

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const k of Object.keys(value as Record<string, unknown>)) {
		deepFreeze((value as Record<string, unknown>)[k]);
	}
	return Object.freeze(value);
}

/**
 * Advance a cursor node and return the new value. Emits `[DIRTY], [DATA, next]`
 * directly on the cursor — atomic outside a batch, rollback-discardable inside.
 *
 * Resets to `0` if the cursor cache is missing, non-numeric, `NaN`, or
 * non-finite (e.g. corrupted by `restore()` from a malformed snapshot, or
 * by a misbehaving codec). `??` alone would let `NaN` and `""` pass through
 * and silently corrupt audit ordering downstream.
 *
 * **Silent reset diagnostic (EH-12).** When the cache holds a non-numeric
 * value at bump time, the cursor restarts at 0 and the next bump returns 1
 * — colliding with the seq stamped on the very first record after construct.
 * To make seq-monotonicity violations after a restore visible to operators,
 * the helper emits a one-shot `console.warn` per cursor instance describing
 * the offending value. The cursor is identified by a `WeakSet<Node<number>>`
 * so the warning fires exactly once per node — repeat malformed bumps stay
 * quiet to avoid log spam. Production callers wanting to suppress can swap
 * the global `console` (universal-safe code path; no Node-only API used).
 *
 * Works whether or not the cursor has any subscribers — `down` updates the
 * cache regardless, so primitives that bump before consumers attach (e.g.
 * `JobQueueGraph.enqueue`) still see a coherent sequence.
 *
 * @category internal
 */
const _bumpCursorWarned = new WeakSet<Node<number>>();
export function bumpCursor(seq: Node<number>): number {
	const raw = seq.cache;
	const valid = typeof raw === "number" && Number.isFinite(raw);
	if (!valid && raw !== undefined && !_bumpCursorWarned.has(seq)) {
		_bumpCursorWarned.add(seq);
		console.warn(
			`bumpCursor: cursor cache held a non-numeric value (${String(raw)}); resetting to 0. ` +
				"Causes include: a snapshot codec round-tripping the cursor as a string / null / NaN, " +
				"OR a malformed initial seed (e.g. state<number>(NaN)). " +
				"Audit consumers may see colliding seq values after this point.",
		);
	}
	const cur = valid ? raw : 0;
	const next = cur + 1;
	seq.down([[DIRTY], [DATA, next]]);
	return next;
}

/**
 * Build a record via the supplied builder, stamp `handlerVersion` if present,
 * and append it to the audit log. `undefined` records are skipped (callers
 * pass an `onSuccess` / `onFailure` that returns `undefined` to opt out per
 * call).
 *
 * @category internal
 */
export function appendAudit<
	TArgs extends readonly unknown[],
	TValue,
	R extends BaseAuditRecord,
	M extends SuccessMeta | FailureMeta,
>(
	audit: ReactiveLogBundle<R>,
	builder: (args: TArgs, value: TValue, meta: M) => R | undefined,
	args: TArgs,
	value: TValue,
	meta: M,
	handlerVersion?: { id: string; version: string | number },
): void {
	const record = builder(args, value, meta);
	if (record === undefined) return;
	const stamped = handlerVersion != null ? ({ ...record, handlerVersion } as R) : record;
	audit.append(stamped);
}

/**
 * Substrate-tier wrapper: run `action`, optionally append a typed audit record
 * on success or failure, advance an optional `seq` cursor. No batch frame —
 * this is the hot-path-friendly variant for atomic single-write mutations.
 *
 * Behavior contract:
 * 1. Freeze args at entry (default `true`; opt out with `freeze: false` for
 *    hot paths — e.g. wrapping `vectorIndex.upsert(id, vector[768], meta)`
 *    where the deep-freeze of a 768-dim vector is a measurable tax).
 * 2. Bump `seq` (if provided) BEFORE the action runs. There is no batch frame,
 *    so the bump persists even on throw — the failure-audit record stamps the
 *    same `seq` so audit consumers see a contiguous sequence.
 * 3. Run `action(args)`. On success, if `audit` is provided AND `onSuccess`
 *    is set, `appendAudit(onSuccess, ...)`.
 * 4. On throw, if `audit` is provided AND `onFailure` is set,
 *    `appendAudit(onFailure, ...)` then re-throw. When `audit` is omitted the
 *    wrapper still provides freeze + seq + re-throw semantics — useful for
 *    primitives that want centralized mutation contracts without an audit log
 *    surface (e.g. `Topic.publish`).
 *
 * **Distinguish from {@link wrapMutation}:** `wrapMutation` opens a `batch()`
 * frame (rollback-on-throw, seq advance discarded on rollback) and is the
 * right choice when the action runs a user-supplied handler or a multi-step
 * sequence that could leave inconsistent state mid-throw.
 *
 * **Cursor / log alignment caveat (substrate-tier):** `seq` is bumped BEFORE
 * `action()` runs, and the audit-log append happens AFTER. There is no batch
 * frame, so a synchronous subscriber to `seq` that fires between the two —
 * including a subscriber on `audit.entries` itself if the substrate causes
 * it to fire transitively — observes `seq=N` while the corresponding record
 * is not yet in the log. Audit consumers that join `seq` and `audit.entries`
 * reactively must tolerate this one-tick lag, or use {@link wrapMutation}
 * (whose `batch()` frame defers downstream delivery until commit, so cursor
 * and log appear together to subscribers). The same caveat applies to
 * **re-entrant** invocation: if an `audit.entries` / `seq` subscriber
 * triggers another `lightMutation`, the inner record can land on the log
 * before the outer call's success/failure record.
 *
 * @category internal
 */
export function lightMutation<TArgs extends readonly unknown[], TResult, R extends BaseAuditRecord>(
	action: (...args: TArgs) => TResult,
	opts: LightMutationOpts<TArgs, TResult, R>,
): (...args: TArgs) => TResult {
	const freeze = opts.freeze ?? true;
	return function wrapped(...args: TArgs): TResult {
		const sealed = freeze ? (args.map(deepFreeze) as unknown as TArgs) : args;
		const t_ns = wallClockNs();
		const seq = opts.seq ? bumpCursor(opts.seq) : undefined;
		try {
			const result = action(...sealed);
			if (opts.audit && opts.onSuccess) {
				appendAudit<TArgs, TResult, R, SuccessMeta>(
					opts.audit,
					opts.onSuccess,
					sealed,
					result,
					{ t_ns, seq },
					opts.handlerVersion,
				);
			}
			return result;
		} catch (err) {
			if (opts.audit && opts.onFailure) {
				const errorType = err instanceof Error ? err.name : typeof err;
				appendAudit<TArgs, unknown, R, FailureMeta>(
					opts.audit,
					opts.onFailure,
					sealed,
					err,
					{ t_ns, seq, errorType },
					opts.handlerVersion,
				);
			}
			throw err;
		}
	};
}

/**
 * Orchestration-tier wrapper: like {@link lightMutation} but adds a `batch()`
 * frame around the action so an in-flight throw rolls back partial state.
 *
 * Behavior contract:
 *  1. Freeze args at entry (default `true`).
 *  2. Open a batch frame (rollback-on-throw via core batch — Audit 2 #6).
 *  3. Bump `seq` INSIDE the batch so a framework-level rollback discards the
 *     cursor advance (cursor stays in sync with audit log). M5.
 *  4. Run `action(args)` and capture result.
 *  5. On success: if `audit` is provided AND `onSuccess` is set,
 *     `appendAudit(onSuccess, ...)` inside the batch.
 *  6. On throw: catch OUTSIDE the batch so the failure record (if any) emits
 *     in a fresh transaction after rollback — it persists. Re-throw so callers
 *     see the failure. When `audit` is omitted the wrapper still provides
 *     batch + freeze + rollback + re-throw semantics — useful for primitives
 *     that want orchestration-tier mutation contracts without an audit log
 *     surface.
 *
 * **Distinguish from the file-private `wrapMutation` in
 * `src/extra/reactive-map.ts:540`:** that helper is a transactional wrapper
 * for the reactiveMap version counter (`pre/post-version` snapshot diffing,
 * read vs. mutation gating). Different concern, file-private, not exported.
 * This `wrapMutation` is the public Phase-4 audit framework.
 *
 * @category internal
 */
export function wrapMutation<TArgs extends readonly unknown[], TResult, R extends BaseAuditRecord>(
	action: (...args: TArgs) => TResult,
	opts: WrapMutationOpts<TArgs, TResult, R>,
): (...args: TArgs) => TResult {
	const freeze = opts.freeze ?? true;
	return function wrapped(...args: TArgs): TResult {
		const sealed = freeze ? (args.map(deepFreeze) as unknown as TArgs) : args;
		const t_ns = wallClockNs();
		let result: TResult;
		let captured: unknown;
		let captureSet = false;
		let seq: number | undefined;
		try {
			batch(() => {
				if (opts.seq) seq = bumpCursor(opts.seq);
				try {
					result = action(...sealed);
					if (opts.audit && opts.onSuccess) {
						appendAudit<TArgs, TResult, R, SuccessMeta>(
							opts.audit,
							opts.onSuccess,
							sealed,
							result,
							{ t_ns, seq },
							opts.handlerVersion,
						);
					}
				} catch (err) {
					captured = err;
					captureSet = true;
					throw err;
				}
			});
		} catch (outerErr) {
			// C4: when `captureSet === false` the throw came from outside the
			// inner try (e.g. framework-level batch error before action ran).
			// Re-throw the actual `outerErr` so the original isn't masked as
			// `undefined`.
			if (captureSet && opts.audit && opts.onFailure) {
				const errorType = captured instanceof Error ? captured.name : typeof captured;
				appendAudit<TArgs, unknown, R, FailureMeta>(
					opts.audit,
					opts.onFailure,
					sealed,
					captured,
					{ t_ns, seq, errorType },
					opts.handlerVersion,
				);
			}
			throw captureSet ? captured : outerErr;
		}
		return result!;
	};
}

// ── registerCursor / registerCursorMap ───────────────────────────────────

/**
 * Promote a closure counter to a state node mounted under `graph`.
 * Replaces ad-hoc `let _seq = 0` patterns with a node observable in
 * `describe()` and persistable via storage tiers.
 *
 * @category internal
 */
export function registerCursor(graph: Graph, name: string, initial = 0): Node<number> {
	const cursor = node<number>([], { initial, name, describeKind: "state" });
	graph.add(cursor, { name });
	return cursor;
}

/**
 * Promote a closure `Map<K, number>` to N state nodes (one per key) mounted
 * under `<graph>::<name>::<key>`. Used by saga (per-event-type cursor).
 *
 * @category internal
 */
export function registerCursorMap<K extends string>(
	graph: Graph,
	name: string,
	keys: readonly K[],
	initial = 0,
): { readonly [P in K]: Node<number> } {
	const out = {} as { [P in K]: Node<number> };
	// Mount cursors under a child plain-Graph so per-key node names stay flat
	// (path-separator `::` is reserved by Graph.add). Using `Graph` directly
	// rather than `graph.constructor` avoids spawning a typed subclass with
	// an incompatible constructor signature (e.g., CqrsGraph(name, opts)).
	const sub = new Graph(name);
	for (const k of keys) {
		const cursor = node<number>([], {
			initial,
			name: k,
			describeKind: "state",
		});
		sub.add(cursor, { name: k });
		out[k] = cursor;
	}
	graph.mount(name, sub);
	return out;
}
