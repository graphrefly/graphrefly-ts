/**
 * Universal mutation framework (Phase 14 — DS-14 locked 2026-05-05).
 *
 * Single `mutate(act, opts)` factory replaces the prior `lightMutation` +
 * `wrapMutation` two-tier split (pre-1.0 break per Q-O2).
 *
 * Two frames:
 * - `"inline"` — no batch; up() runs raw. Seq bumps before action; persists
 *   on throw. Hot-path-friendly for atomic single-write mutations.
 * - `"transactional"` — opens `batch(() => up(...))`. On throw: batch discards
 *   deferred deliveries, then `down()` runs (if provided), then failure record.
 *
 * Phase-4 primitives share the same shape: imperative mutation methods +
 * closure state + reactive audit log + freeze-at-entry + rollback-on-throw.
 * This module factors out the common machinery so each primitive becomes
 * declarative wiring over typed audit records.
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

// ── Universal mutation factory (Phase 14 — DS-14 lock Q-O2/Q-O3) ────────
//
// Single `mutate(act, opts)` factory. Two frames:
//
// - `"inline"` — no batch frame; up() runs raw. Seq bumps before action;
//   persists on throw. Hot-path-friendly for atomic single-write mutations.
//
// - `"transactional"` — opens `batch(() => up(...))`. On throw: batch discards
//   deferred deliveries, then `down()` runs, then failure record persists.
//
// **Heuristic:** if your imperative method's body is one or two lines (mutate
// state, emit), use `frame: "inline"`. If it runs a user-supplied handler or
// has multiple steps that could leave inconsistent state mid-throw, use
// `frame: "transactional"`.

export type FailureMeta = {
	t_ns: number;
	seq?: number;
	errorType: string;
};

export type SuccessMeta = {
	t_ns: number;
	seq?: number;
};

/**
 * Mutation action shape. Plain function shorthand auto-wraps as `{ up: fn }`.
 *
 * - `up` — the mutation action (the "up migration").
 * - `down` — optional rollback for closure mutations that `batch()` can't
 *   reach. Receives the SAME frozen args as `up`. Runs AFTER batch reactive
 *   rollback, BEFORE the failure record. Throws inside `down` are
 *   console.error'd without masking the original error. Only meaningful
 *   with `frame: "transactional"`.
 */
export type MutationAct<TArgs extends readonly unknown[], TResult> = {
	up: (...args: TArgs) => TResult;
	down?: (...args: TArgs) => void;
};

export type MutationFrame = "inline" | "transactional";

export type MutateOpts<TArgs extends readonly unknown[], TResult, R extends BaseAuditRecord> = {
	/** Frame mode. `"inline"` = no batch; `"transactional"` = batch + rollback. */
	frame: MutationFrame;
	/**
	 * Optional log to append records to. When omitted, the wrapper still
	 * provides freeze / seq-advance / rollback-on-throw but skips record
	 * emission — useful for primitives that want centralized mutation
	 * semantics without a dedicated log surface (e.g. `Topic.publish`).
	 */
	log?: ReactiveLogBundle<R>;
	/** Build the success record from the action's args + result + meta. */
	onSuccessRecord?: (args: TArgs, result: TResult, meta: SuccessMeta) => R | undefined;
	/** Build the failure record from the args + error + meta. */
	onFailureRecord?: (args: TArgs, error: unknown, meta: FailureMeta) => R | undefined;
	/** Deep-freeze args at entry (default `true`). Opt out for hot paths. */
	freeze?: boolean;
	/** Optional sequence cursor — auto-advanced and stamped onto records. */
	seq?: Node<number>;
	/** Optional handler version — stamped per Audit 5. */
	handlerVersion?: { id: string; version: string | number };
};

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const k of Object.keys(value as Record<string, unknown>)) {
		deepFreeze((value as Record<string, unknown>)[k]);
	}
	return Object.freeze(value);
}

/**
 * Universal mutation factory (Phase 14 — DS-14 Q-O2).
 *
 * Replaces the prior `lightMutation` + `wrapMutation` two-tier split.
 * Single factory with `frame: "inline" | "transactional"` discriminant.
 *
 * @param act - The mutation action. Either a plain function (auto-wrapped as
 *   `{ up: fn }`) or a `{ up, down? }` object for explicit rollback.
 * @param opts - Configuration: frame, log, record builders, freeze, seq.
 * @returns A typed wrapper function with the same signature as `act.up`.
 */
export function mutate<TArgs extends readonly unknown[], TResult, R extends BaseAuditRecord>(
	act: MutationAct<TArgs, TResult> | ((...args: TArgs) => TResult),
	opts: MutateOpts<TArgs, TResult, R>,
): (...args: TArgs) => TResult {
	const { up, down } = typeof act === "function" ? { up: act, down: undefined } : act;
	const freeze = opts.freeze ?? true;

	if (opts.frame === "inline") {
		return function wrapped(...args: TArgs): TResult {
			const sealed = freeze ? (args.map(deepFreeze) as unknown as TArgs) : args;
			const t_ns = wallClockNs();
			const seq = opts.seq ? bumpCursor(opts.seq) : undefined;
			try {
				const result = up(...sealed);
				if (opts.log && opts.onSuccessRecord) {
					appendAudit<TArgs, TResult, R, SuccessMeta>(
						opts.log,
						opts.onSuccessRecord,
						sealed,
						result,
						{ t_ns, seq },
						opts.handlerVersion,
					);
				}
				return result;
			} catch (err) {
				if (opts.log && opts.onFailureRecord) {
					const errorType = err instanceof Error ? err.name : typeof err;
					appendAudit<TArgs, unknown, R, FailureMeta>(
						opts.log,
						opts.onFailureRecord,
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

	// frame === "transactional"
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
					result = up(...sealed);
					if (opts.log && opts.onSuccessRecord) {
						appendAudit<TArgs, TResult, R, SuccessMeta>(
							opts.log,
							opts.onSuccessRecord,
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
			// Fire `down` AFTER batch's reactive rollback, BEFORE failure record.
			// Gate on `captureSet` — if the throw came from outside the inner try
			// (framework-level batch error before action ran), don't fire down.
			if (captureSet && down) {
				try {
					down(...sealed);
				} catch (downErr) {
					console.error(
						`mutate: down hook threw — original action error preserved (${
							captured instanceof Error ? captured.name : typeof captured
						}). Down error:`,
						downErr,
					);
				}
			}
			if (captureSet && opts.log && opts.onFailureRecord) {
				const errorType = captured instanceof Error ? captured.name : typeof captured;
				appendAudit<TArgs, unknown, R, FailureMeta>(
					opts.log,
					opts.onFailureRecord,
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
