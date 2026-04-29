/**
 * Sugar constructors over the raw `node()` primitive.
 *
 * Each factory wraps a user-friendly function into the canonical
 * `NodeFn = (data, actions, ctx) => cleanup | void` shape, then calls
 * `node(...)`. This is the only place `actions.emit(...)` is invoked
 * on behalf of the user — if you need finer control (multi-emission,
 * raw `actions.down` / `actions.up`, cleanup return), use the raw
 * `node()` factory from `./node.js` directly.
 *
 * See SESSION-foundation-redesign.md §8.5 + §10.6 for the rewrite.
 */

import type { NodeActions } from "./config.js";
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
// First-run gate — now enforced in core (spec §2.7)
// ---------------------------------------------------------------------------
//
// Previous versions of this file carried a `sentinelGuard` helper that emitted
// RESOLVED whenever any dep was still sentinel at fn-fire time. That guard
// lived at the sugar layer, which made the first-run gate observable on the
// wire as `[[DIRTY], [RESOLVED], [DIRTY], [DATA]]` for multi-parent derived
// activation (one DIRTY/RESOLVED pair per partial-dep settle in the subscribe
// loop).
//
// The gate is now in core (`NodeImpl._maybeRunFnOnSettlement`, controlled by
// `NodeOptions.partial`). Sugar `derived` / `effect` inherit the default
// `partial: false` so their wrapped fn only runs with all deps settled —
// wire is the clean `[[START], [DIRTY], [DATA, fn(initial...)]]` shape.
// Callers who need pre-gate partial firing pass `partial: true`; the sugar
// wrapper falls back to `ctx.prevData[i]` (which is `undefined` for sentinel
// deps) so user fn sees the same "undefined for unset dep" contract it had
// under the old `allowPartial: true` path.

// ---------------------------------------------------------------------------
// state — manual source with an optional initial value
// ---------------------------------------------------------------------------

/**
 * Creates a manual source node. Drive it with `state.emit(v)` (framed,
 * diamond-safe) or `state.down([[DATA, v]])` (raw compat path).
 *
 * **Sentinel form.** Omit `initial` (or pass `undefined`) to leave the
 * node in `"sentinel"` status — the canonical "no value yet" state.
 * Downstream `derived` first-run gate then waits for the first real DATA
 * before firing. Pass an explicit `null` to cache `null` as DATA — `null`
 * is a valid DATA value per spec §2.2 ("`T | null` is the only valid DATA
 * domain; `undefined` is reserved as the global SENTINEL").
 *
 * @example
 * ```ts
 * import { state, derived } from "@graphrefly/graphrefly";
 *
 * // Cached form — starts at 10, derived fires immediately on subscribe.
 * const counter = state(10);
 *
 * // Sentinel form — derived's first-run gate waits for the first emit.
 * const candidates = state<readonly string[]>();
 * const ready = derived([candidates], ([cands]) => cands.length > 0);
 * candidates.emit(["v1"]); // ready fires now
 * ```
 *
 * @param initial - Starting cached value (optional). Omit or pass
 *   `undefined` for the sentinel form; pass `null` to cache `null`.
 * @param opts - Optional {@link NodeOptions} (excluding `initial`).
 */
export function state<T>(initial?: T, opts?: Omit<NodeOptions<T>, "initial">): Node<T> {
	return node<T>([], { ...opts, initial });
}

// ---------------------------------------------------------------------------
// producer — no-deps source with a compute body
// ---------------------------------------------------------------------------

/**
 * User-level producer compute: runs once on first-subscriber activation.
 * Receives `actions` for imperative emission and `ctx` for FnCtx (typically
 * only `store` is useful on a producer — no deps means `prevData` and
 * `terminalDeps` are empty).
 */
export type ProducerFn = (
	actions: NodeActions,
	ctx: FnCtx,
	// biome-ignore lint/suspicious/noConfusingVoidType: matches NodeFn — see its JSDoc.
) => NodeFnCleanup | void;

/**
 * Creates a producer node with no deps; `fn` runs once when the first
 * subscriber connects. Return a cleanup function (`() => void` — fires on
 * every transition) or an object with granular hooks
 * (`{ beforeRun?, deactivate?, invalidate? }` — each hook fires on its named
 * transition only) to register teardown. See {@link NodeFnCleanup}.
 *
 * @example
 * ```ts
 * const ticker = producer((actions) => {
 *   const id = setInterval(() => actions.emit(Date.now()), 1000);
 *   return () => clearInterval(id);
 * });
 * ```
 */
export function producer<T = unknown>(fn: ProducerFn, opts?: NodeOptions<T>): Node<T> {
	const wrapped: NodeFn = (_data, actions, ctx) => fn(actions, ctx) ?? undefined;
	return node<T>(wrapped, { describeKind: "producer", ...opts });
}

// ---------------------------------------------------------------------------
// derived — dep-driven pure compute
// ---------------------------------------------------------------------------

/**
 * User-level derived compute: receives the latest DATA from each dep and
 * returns the new value. The sugar wraps it with `actions.emit(fn(...))`
 * so the return value flows through the framed emit pipeline.
 *
 * For derived nodes that need to inspect `ctx.prevData` / `ctx.terminalDeps`
 * / `ctx.store`, accept the optional second parameter.
 */
export type DerivedFn<T> = (data: readonly unknown[], ctx: FnCtx) => T | undefined | null;

/**
 * Creates a derived node that computes **one output per wave** from the latest
 * value of each dependency — **snapshot / combine semantics**.
 *
 * `fn` receives one scalar per dep (the last DATA value seen this wave, or the
 * prior-wave value as fallback). It is called once per settled wave and emits
 * a single value via `actions.emit`. The equals check then suppresses the
 * emission as `RESOLVED` if the output has not changed.
 *
 * **Not for streaming one-to-one transforms.** If each DATA value in a batch
 * must produce a corresponding output (e.g. transforming every item emitted by
 * `fromIter` individually), use {@link map} or raw `node()` with full batch
 * iteration instead. `derived` only sees the *last* value per dep when a batch
 * carries multiple DATAs.
 *
 * @example
 * ```ts
 * const a = state(1);
 * const b = derived([a], ([x]) => (x as number) * 2);
 * ```
 */
export function derived<T = unknown>(
	deps: readonly Node[],
	fn: DerivedFn<T>,
	opts?: NodeOptions<T>,
): Node<T> {
	// First-run gate lives in core (§2.7). Core default `partial: false`
	// matches sugar's intent — no explicit flag needed. Spread-order note: a
	// hypothetical `opts.partial = undefined` still resolves to the core
	// default because spread of an undefined property is a no-op (v8+); the
	// `?? false` on the core side would cover it anyway.
	const wrapped: NodeFn = (batchData, actions, ctx) => {
		const data = batchData.map((batch, i) =>
			batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
		);
		actions.emit(fn(data, ctx));
		return undefined;
	};
	return node<T>(deps, wrapped, { describeKind: "derived", ...opts });
}

// ---------------------------------------------------------------------------
// effect — dep-driven side effect, no auto-emit
// ---------------------------------------------------------------------------

/**
 * User-level effect compute: fires when deps settle. Return value is NOT
 * auto-emitted — use `actions.emit(v)` / `actions.down(msgs)` explicitly if
 * the effect also wants to produce downstream messages. Return a cleanup
 * function (`() => void`) or an object with granular hooks
 * (`{ beforeRun?, deactivate?, invalidate? }`) to register teardown.
 * See {@link NodeFnCleanup}.
 */
export type EffectFn = (
	data: readonly unknown[],
	actions: NodeActions,
	ctx: FnCtx,
	// biome-ignore lint/suspicious/noConfusingVoidType: matches NodeFn — see its JSDoc.
) => NodeFnCleanup | void;

/**
 * Runs a side-effect when deps settle. Return value is not auto-emitted.
 *
 * @example
 * ```ts
 * effect([source], ([v]) => {
 *   console.log(v);
 * });
 * ```
 */
export function effect(
	deps: readonly Node[],
	fn: EffectFn,
	opts?: NodeOptions<unknown>,
): Node<unknown> {
	// First-run gate lives in core (§2.7). Core default matches sugar's
	// intent. User override: pass `partial: true` to fire on partial deps.
	const wrapped: NodeFn = (batchData, actions, ctx) => {
		const data = batchData.map((batch, i) =>
			batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
		);
		return fn(data, actions, ctx) ?? undefined;
	};
	return node(deps, wrapped, { describeKind: "effect", ...opts });
}

// ---------------------------------------------------------------------------
// dynamicNode — track-proxy wrapper over `derived`
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
 * Sugar over `derived(...)` that exposes dep values via a `track(dep)`
 * proxy instead of positional `data[i]`. All declared `allDeps` participate
 * in wave tracking, so the first fn run waits for every dep to settle.
 * Unused deps that update just re-run fn; `equals` absorbs unchanged
 * outputs as RESOLVED.
 *
 * P3-compliant: `track(dep)` reads from the framework-managed
 * `DepRecord.prevData` populated by the protocol, never from
 * `dep.cache`.
 *
 * @example
 * ```ts
 * const a = state(1);
 * const b = state(10);
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
	return derived<T>(
		allDeps,
		// data[i] is already sugar-unwrapped to a scalar by derived()'s wrapper.
		(data, ctx) => {
			const track: TrackFn = (dep) => {
				const i = depIndex.get(dep);
				if (i == null) {
					throw new Error(`dynamicNode: untracked dep "${dep.name ?? "<unnamed>"}"`);
				}
				return data[i];
			};
			return fn(track, ctx);
		},
		opts,
	);
}

// ---------------------------------------------------------------------------
// pipe — left-to-right operator composition
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
 * const a = state(1), b = state(2);
 * const sum = autoTrackNode((track) => track(a) + track(b));
 * // deps [a, b] discovered automatically on first run
 * ```
 */
/**
 * Options for {@link autoTrackNode}.
 */
export interface AutoTrackOptions<T> extends NodeOptions<T> {
	/**
	 * When `true`, fn may run before all known deps have delivered their first
	 * DATA. Unknown deps return `undefined` via `track()`, which the fn must
	 * handle explicitly. Useful when some deps are "nice-to-have" — e.g. a
	 * primary computation should continue while a secondary dep is still
	 * initialising.
	 *
	 * When `false` (default), fn is held until every declared dep has delivered
	 * at least one DATA value — core's first-run gate (spec §2.7) handles this.
	 * Delegates to {@link NodeOptions.partial}; both semantics are aligned: the
	 * gate is first-run-only (`_hasCalledFnOnce`), so INVALIDATE on a dep does
	 * NOT re-gate after fn has fired once. Pull-based compat layers (Signals,
	 * Jotai) that rely on "consistent compute across INVALIDATE" should
	 * explicitly wrap their dep reads with null/undefined handling in fn.
	 *
	 * @default false
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

	implRef = new NodeImpl<T>([], wrappedFn, {
		describeKind: "derived",
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
