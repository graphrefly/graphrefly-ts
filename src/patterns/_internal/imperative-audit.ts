/**
 * Imperative-controller-with-audit helper layer (Audit 2 — locked 2026-04-24).
 *
 * Five Phase-4 primitives share the same shape: imperative mutation methods +
 * closure state + reactive audit log + freeze-at-entry + rollback-on-throw.
 * This module factors out the common machinery so each primitive becomes
 * declarative wiring over typed audit records:
 *  - `gate`, `pipeline.gate`            (Wave A.2 Unit 8)
 *  - `JobQueueGraph`                    (Wave B.3 Unit 15)
 *  - `CqrsGraph.dispatch`               (Wave C.2 Unit 20)
 *  - `CqrsGraph.saga`                   (Wave C.3 Unit 22)
 *  - `processManager` (Wave 7)          [out of scope this commit]
 *
 * @internal — exposed for primitive impls only; not re-exported through any
 * patterns/<x>/index.ts barrel.
 */

import { batch } from "../../core/batch.js";
import { wallClockNs } from "../../core/clock.js";
import { type NodeGuard, policy } from "../../core/guard.js";
import { DATA, DIRTY } from "../../core/messages.js";
import type { Node } from "../../core/node.js";
import { state } from "../../core/sugar.js";
import {
	type ReactiveLogBundle,
	type ReactiveLogOptions,
	reactiveLog,
} from "../../extra/reactive-log.js";
import { Graph } from "../../graph/graph.js";

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

// ── wrapMutation ─────────────────────────────────────────────────────────

export type FailureMeta = {
	t_ns: number;
	seq?: number;
	errorType: string;
};

export type SuccessMeta = {
	t_ns: number;
	seq?: number;
};

export type WrapMutationOpts<TArgs extends readonly unknown[], R extends BaseAuditRecord> = {
	/** Where to emit the audit record on success / failure. */
	audit: ReactiveLogBundle<R>;
	/** Build the success record from the action's args + result + meta. */
	onSuccess?: (args: TArgs, result: unknown, meta: SuccessMeta) => R | undefined;
	/** Build the failure record from the args + error + meta. */
	onFailure?: (args: TArgs, error: unknown, meta: FailureMeta) => R | undefined;
	/** Freeze inputs at entry (default `true`). Pass `false` for hot paths. */
	freeze?: boolean;
	/** Optional sequence cursor — auto-advanced and stamped onto records. */
	seq?: Node<number>;
	/** Optional handler version — stamped into the record (Audit 5). */
	handlerVersion?: { id: string; version: string | number };
};

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const k of Object.keys(value as Record<string, unknown>)) {
		deepFreeze((value as Record<string, unknown>)[k]);
	}
	return Object.freeze(value);
}

function bumpCursor(seq: Node<number>): number {
	const cur = (seq.cache as number | undefined) ?? 0;
	const next = cur + 1;
	seq.down([[DIRTY], [DATA, next]]);
	return next;
}

/**
 * Wraps an imperative mutation:
 *  1. Freeze args at entry (default).
 *  2. Open a batch frame (rollback-on-throw via core batch — Audit 2 #6).
 *  3. Run `action(args)` and capture result.
 *  4. On success: `audit.append(onSuccess(args, result, meta))` if callback set.
 *  5. On throw: catch OUTSIDE the batch so the failure record emits in a fresh
 *     transaction after rollback — it persists. Re-throw so callers see the failure.
 *
 * @category internal
 */
export function wrapMutation<TArgs extends readonly unknown[], TResult, R extends BaseAuditRecord>(
	action: (...args: TArgs) => TResult,
	opts: WrapMutationOpts<TArgs, R>,
): (...args: TArgs) => TResult {
	const freeze = opts.freeze ?? true;
	return function wrapped(...args: TArgs): TResult {
		const sealed = freeze ? (args.map(deepFreeze) as unknown as TArgs) : args;
		const t_ns = wallClockNs();
		let result: TResult;
		let captured: unknown;
		let captureSet = false;
		// M5: bump seq INSIDE the batch so a framework-level rollback discards
		// the cursor advance (cursor stays in sync with audit log). Captured
		// in outer scope so the failure-record handler can stamp it.
		let seq: number | undefined;
		try {
			batch(() => {
				if (opts.seq) seq = bumpCursor(opts.seq);
				try {
					result = action(...sealed);
					if (opts.onSuccess) {
						const record = opts.onSuccess(sealed, result, { t_ns, seq });
						if (record !== undefined) {
							const stamped =
								opts.handlerVersion != null
									? ({ ...record, handlerVersion: opts.handlerVersion } as R)
									: record;
							opts.audit.append(stamped);
						}
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
			if (captureSet && opts.onFailure) {
				const errorType = captured instanceof Error ? captured.name : typeof captured;
				const record = opts.onFailure(sealed, captured, { t_ns, seq, errorType });
				if (record !== undefined) {
					const stamped =
						opts.handlerVersion != null
							? ({ ...record, handlerVersion: opts.handlerVersion } as R)
							: record;
					opts.audit.append(stamped);
				}
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
	const cursor = state<number>(initial, { name, describeKind: "state" });
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
		const cursor = state<number>(initial, {
			name: k,
			describeKind: "state",
		});
		sub.add(cursor, { name: k });
		out[k] = cursor;
	}
	graph.mount(name, sub);
	return out;
}
