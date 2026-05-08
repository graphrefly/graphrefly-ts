/**
 * Internal helpers shared by operator sub-files.
 *
 * `operatorOpts` / `partialOperatorOpts` / `gatedOperatorOpts` thread the
 * correct `describeKind: "derived"` plus `partial` flag combinations through
 * every sub-file's `node()` calls so describe-graph output stays consistent.
 */

import type { NodeOptions } from "../../core/node.js";

export type ExtraOpts = Omit<NodeOptions<unknown>, "describeKind">;

export function operatorOpts<T = unknown>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "derived", ...opts } as NodeOptions<T>;
}

/**
 * Like {@link operatorOpts} but declares `partial: true` — use for operators
 * whose fn body deliberately handles partial-dep waves (fires on primary
 * alone, emits RESOLVED when a required peer is still sentinel, etc.). Opts
 * out of the core §2.7 first-run gate. User `opts.partial = false` override
 * wins via the spread, but this is rare — the gate-on default only makes
 * sense for fns that expect all deps to have delivered.
 */
export function partialOperatorOpts<T = unknown>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "derived", partial: true, ...opts } as NodeOptions<T>;
}

/**
 * Like {@link partialOperatorOpts} but declares `partial: false` — first-run
 * gate ON. Use for operators that DO need to wait for every dep to deliver
 * real DATA before firing the first time, but want the standard derived/
 * effect "operator" describeKind for describe() output.
 *
 * Phase 10.5 (2026-04-29; `archive/docs/SESSION-graph-narrow-waist.md` §
 * "Phase 10.5"): introduced when `withLatestFrom` flipped from `partial:
 * true` to `partial: false`. The first-run gate fixes the documented W1
 * initial-pair drop without breaking post-warmup semantics (the gate is
 * `_hasCalledFnOnce === false` only — once fn fires, subsequent waves are
 * gate-free).
 *
 * **Caller override:** the spread order is `{ ..., ...opts }`, so a
 * user-supplied `opts.partial = true` silently overrides the helper's
 * default. Same shape as {@link partialOperatorOpts}'s override behavior.
 * If you want to FORCE `partial: false` on a specific operator regardless
 * of caller opts, write the helper inline at the call site (e.g.
 * `{ describeKind: "derived", ...opts, partial: false }`) so the override
 * is rejected.
 */
export function gatedOperatorOpts<T = unknown>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "derived", partial: false, ...opts } as NodeOptions<T>;
}
