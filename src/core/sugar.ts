/**
 * Remaining sugar constructors over the raw `node()` primitive.
 *
 * `state`, `derived`, `effect`, `producer` (and typed variants `derivedT`,
 * `effectT`) have been removed from core. Their equivalents live as
 * restricted-signature methods on `Graph` (see `graph.ts`):
 *   - `graph.state(name, initial?, opts?)`
 *   - `graph.derived(name, depPaths, fn, opts?)`
 *   - `graph.effect(name, depPaths, fn, opts?)`
 *   - `graph.producer(name, setupFn, opts?)`
 *
 * What remains here:
 *   - `dynamicNode` — track-proxy wrapper (no Graph equivalent yet)
 *   - `autoTrackNode` — runtime dep discovery (Jotai/signals compat)
 *   - `pipe` — left-to-right operator composition
 *   - `NodeValues` — tuple-mapped type utility (used by compat layers)
 */

import {
	type FnCtx,
	type Node,
	type NodeFn,
	type NodeFnCleanup,
	NodeImpl,
	type NodeOptions,
	node,
} from "./node.js";

// ---------------------------------------------------------------------------
// NodeValues — tuple-mapped type utility
// ---------------------------------------------------------------------------

/**
 * Maps a tuple of `Node<V>`s to a tuple of `V`s. Used by compat layers
 * and typed APIs to propagate dep value types into callback parameters.
 */
export type NodeValues<TDeps extends readonly Node<unknown>[]> = {
	readonly [K in keyof TDeps]: TDeps[K] extends Node<infer V> ? V : never;
};

// ---------------------------------------------------------------------------
// dynamicNode — track-proxy wrapper
// ---------------------------------------------------------------------------

/**
 * Proxy handed to a {@link DynamicFn}. `track(dep)` returns the dep's
 * latest DATA payload, as delivered through the protocol. Reading from
 * `track` does NOT bypass the message protocol — it reads the internal
 * `DepRecord.prevData` (the stable end-of-previous-wave value) that
 * `_onDepMessage` already populated. If a dep has not yet sent DATA,
 * `track` returns `undefined`.
 */
export type TrackFn = (dep: Node) => unknown;

/** User-level dynamicNode compute. */
export type DynamicFn<T> = (track: TrackFn, ctx: FnCtx) => T | undefined | null;

/**
 * Exposes dep values via a `track(dep)` proxy instead of positional
 * `data[i]`. All declared `allDeps` participate in wave tracking; unused
 * deps that update just re-run fn, and `equals` absorbs unchanged outputs
 * as RESOLVED.
 *
 * **First-run gate (Lock 6.C′):** `dynamicNode` defaults `partial: true`.
 * fn runs as soon as the wave machinery has any data to compute on; deps
 * that have not yet emitted return `undefined` via `track(dep)`. The fn
 * must handle `undefined` for those deps. Pass `{ partial: false }` to
 * opt into core's first-run gate (spec §2.7) when you need to wait for
 * every declared dep to settle before fn fires.
 *
 * P3-compliant: `track(dep)` reads from the framework-managed
 * `DepRecord.prevData` populated by the protocol, never from
 * `dep.cache`.
 *
 * @example
 * ```ts
 * const a = node<number>([], { initial: 1 });
 * const b = node<number>([], { initial: 10 });
 * const sum = dynamicNode([a, b], (track) => (track(a) as number) + (track(b) as number));
 * ```
 */
export function dynamicNode<T = unknown>(
	allDeps: readonly Node[],
	fn: DynamicFn<T>,
	opts?: NodeOptions<T> & { partial?: boolean },
): Node<T> {
	const depIndex = new Map<Node, number>();
	allDeps.forEach((d, i) => {
		depIndex.set(d, i);
	});
	const wrapped: NodeFn = (batchData, actions, ctx) => {
		const data = batchData.map((batch, i) =>
			batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
		);
		const track: TrackFn = (dep) => {
			const i = depIndex.get(dep);
			if (i == null) {
				throw new Error(`dynamicNode: untracked dep "${dep.name ?? "<unnamed>"}"`);
			}
			return data[i];
		};
		actions.emit(fn(track, ctx));
		return undefined;
	};
	// Lock 6.C′ (Phase 13.6.A): `dynamicNode` defaults `partial: true` — the
	// "selective deps" use case (read whichever subset is relevant for the
	// current branch) does not fit gate-all-deps semantics. Users can still
	// pass `partial: false` to opt into the first-run gate.
	return node<T>(allDeps, wrapped, { describeKind: "derived", partial: true, ...opts });
}

// ---------------------------------------------------------------------------
// autoTrackNode — runtime dep discovery (Jotai/signals compat)
// ---------------------------------------------------------------------------

/**
 * Like {@link dynamicNode} but deps are discovered at runtime via `track()`
 * calls — no upfront `allDeps` array needed. Designed for pull-based compat
 * layers (Jotai atoms, TC39 Signals) where deps are unknown until fn runs.
 *
 * **Two-phase discovery:**
 * 1. fn runs. Each `track(dep)` for an unknown dep: subscribes immediately
 *    via `_addDep`, returns `dep.cache` as a stub (P3 boundary exception).
 *    Result is discarded (discovery run).
 * 2. New deps settle (DATA from subscribe handshake). Wave machinery
 *    re-triggers fn. `track(dep)` now returns protocol-delivered `data[i]`.
 *    If MORE unknown deps appear, repeat step 1.
 * 3. Converges when no new deps found → real run → `actions.emit(result)`.
 *
 * P3 violation is limited to discovery runs. Once all deps are known,
 * subsequent waves use protocol-delivered values exclusively.
 *
 * Re-entrance safety: `_addDep` subscribes immediately. If the dep delivers
 * DATA synchronously during fn execution, `_execFn`'s re-entrance guard
 * defers the re-run to after the current fn returns.
 *
 * @param opts - Optional {@link AutoTrackOptions}. Pass `{ partial: true }` to
 *   allow fn to run before all known deps have delivered their first value
 *   (useful for optional/secondary deps).
 *
 * @example
 * ```ts
 * const a = node<number>([], { initial: 1 });
 * const b = node<number>([], { initial: 2 });
 * const sum = autoTrackNode((track) => track(a) + track(b));
 * // deps [a, b] discovered automatically on first run
 * ```
 */
/**
 * Options for {@link autoTrackNode}.
 */
export interface AutoTrackOptions<T> extends NodeOptions<T> {
	/**
	 * When `true` (default for `autoTrackNode` per Lock 6.C′), fn may run
	 * before all known deps have delivered their first DATA. Unknown deps
	 * return `undefined` via `track()`, which the fn must handle explicitly.
	 * This matches `autoTrackNode`'s discovery semantics: deps are unknown
	 * until fn runs, so a gate-all-declared-deps wait would deadlock.
	 *
	 * Pass `partial: false` to opt into core's first-run gate (spec §2.7) —
	 * fn is held until every declared dep has delivered at least one DATA
	 * value. Useful only for compat layers that pre-declare all deps in
	 * `opts.deps` (rare). Note: the gate is first-run-only
	 * (`_hasCalledFnOnce`), so INVALIDATE on a dep does NOT re-gate after fn
	 * has fired once. Pull-based compat layers (Signals, Jotai) that rely on
	 * "consistent compute across INVALIDATE" should explicitly wrap their
	 * dep reads with null/undefined handling in fn.
	 *
	 * @default true
	 */
	partial?: boolean;
}

export function autoTrackNode<T = unknown>(
	fn: (track: TrackFn, ctx: FnCtx) => T | undefined | null,
	opts?: AutoTrackOptions<T>,
): Node<T> {
	let implRef: NodeImpl<T>;
	const depIndexMap = new Map<Node, number>();

	const wrappedFn: NodeFn = (batchData, actions, ctx) => {
		let foundNew = false;
		const track: TrackFn = (dep) => {
			const idx = depIndexMap.get(dep);
			if (idx !== undefined) {
				// Known dep — return latest protocol-delivered value.
				// batch non-null+non-empty → latest from this wave;
				// otherwise fall back to ctx.prevData (last known value).
				if (idx < batchData.length) {
					const batch = batchData[idx];
					if (batch != null && batch.length > 0) return batch.at(-1);
					return ctx.prevData[idx];
				}
				return dep.cache;
			}
			// Unknown dep — discovery phase.
			foundNew = true;
			const newIdx = implRef._addDep(dep);
			depIndexMap.set(dep, newIdx);
			return dep.cache; // P3 boundary exception (discovery stub)
		};

		// First-run gate for pre-discovery sentinel deps is now enforced by
		// core (§2.7, `NodeOptions.partial`). The previous inline
		// sentinel-on-every-wave guard (which also re-gated on INVALIDATE) was
		// removed 2026-04-23 to align with the unified gate semantics. Users
		// who need consistent compute across INVALIDATE should handle
		// `undefined` / `null` dep values in their fn body — `track()` returns
		// `ctx.prevData[idx]` which is `undefined` for a just-invalidated dep.

		try {
			const result = fn(track, ctx);
			if (!foundNew) {
				// Real run — all deps known, protocol-delivered values.
				actions.emit(result);
				// Clear any stale discovery error from a prior run.
				if (ctx.store.__autoTrackLastDiscoveryError != null) {
					delete ctx.store.__autoTrackLastDiscoveryError;
				}
			}
			// Discovery run — result discarded. New deps are subscribed via
			// _addDep. Their DATA delivery triggers _maybeRunFnOnSettlement
			// via the _pendingRerun mechanism, which will re-call fn.
		} catch (err) {
			if (!foundNew) throw err;
			// Discovery run threw — most likely a stale `.cache` read (P3
			// boundary exception), which the protocol-delivered retry will
			// not hit. Preserve the error on `ctx.store` for inspection; if
			// the retry succeeds, the flag is cleared above. If fn has a
			// real bug unrelated to cache, the non-discovery retry will
			// re-throw it out of `_execFn`.
			ctx.store.__autoTrackLastDiscoveryError = err;
		}
		return undefined;
	};

	// Lock 6.C′ (Phase 13.6.A): `autoTrackNode` defaults `partial: true` —
	// runtime dep discovery requires fn to run before deps are known, so a
	// gate-all-declared-deps semantic doesn't fit. Users can still pass
	// `partial: false` to opt into the first-run gate (rare; typically only
	// for compat layers that pre-declare all deps in `opts`).
	implRef = new NodeImpl<T>([], wrappedFn, {
		describeKind: "derived",
		partial: true,
		...opts,
	});
	return implRef;
}

// ---------------------------------------------------------------------------
// pipe — left-to-right operator composition
// ---------------------------------------------------------------------------

/** Unary operator used by {@link pipe}. */
export type PipeOperator = (n: Node) => Node;

/**
 * Composes unary operators left-to-right; returns the final node.
 *
 * @example
 * ```ts
 * const out = pipe(
 *   source,
 *   (n) => map(n, (x) => x + 1),
 *   (n) => filter(n, (x) => x > 0),
 * );
 * ```
 */
export function pipe(source: Node, ...ops: PipeOperator[]): Node {
	let current = source;
	for (const op of ops) current = op(current);
	return current;
}
