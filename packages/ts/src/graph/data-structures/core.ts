/**
 * The shared reactiveCollection core (CSP-2.8, D60).
 *
 * Every reactive data structure (list/map/index/log) is `collectionCore(backend) + a typed method
 * surface` (D60 #5). The core owns the TWO output ports and nothing else:
 *
 *   - BACKEND — the single materialized state (D60 #1): a plain mutable object with a monotonic
 *     `version` + a `snapshot()`. It applies deltas and IS the materialized state; there is NO ACC
 *     node and NO effect bridge re-deriving it (the misdesign D60 rejected — the backend already
 *     integrates, its cost is intrinsic). The backend is a closure object, not a graph node, so its
 *     durability is structural (survives last-subscriber disconnect; node ROM/RAM is moot, D60 #1).
 *
 *   - DELTA port (D60 #2a) — an always-on bare source ({@link CollectionCore.delta}); each mutation
 *     pushes ONE change payload (O(1)/mutation). Downstream watches events anytime. It is the
 *     structure's BACKBONE: the snapshot node declares it as its dep (D60 reactiveList topology).
 *
 *   - SNAPSHOT port (D60 #2b) — a pull-mode node ({@link CollectionCore.snapshot}, R-pull/D59) that
 *     is QUIET by default and, on a cone-routed RESUME demand, LAZILY reads `backend.snapshot()`
 *     (one O(n) materialization) and pushes it once, then re-quiets. The O(n) build happens ONLY on
 *     demand — never eagerly per mutation (D60 #2b: lazy is P·O(n), not M·O(n)). It has NO value of
 *     its own — its fn reads the backend on demand, so the backend stays the single source of truth
 *     (D60 #3). Coalesce-on-no-change is free: the delta-dep's DIRTY/DATA arms the pull node via
 *     R-pull's quiet-absorb accounting; a demand with no intervening delta is silent (C-16).
 *
 * Demand path: a downstream consumer issues `ctx.upNext([[RESUME, core.pullId]])` (boundary-deferred
 * self-demand, R-up-routing/D59) — it needs the snapshot node upstream in its declared cone, NOT its
 * reference. Cold-start (a demand before any mutation) is silent by substrate coalesce (C-16); for an
 * initial/imperative read use the structure's synchronous quick-read (the deliberately-non-reactive
 * peek, D60) — the reactive pull serves the watch-delta-then-demand pattern.
 *
 * Per-language (D6/D24, never in parity, no conformance — the substrate pull is already C-16).
 */

import type { Ctx } from "../../ctx/types.js";
import type { Dispatcher } from "../../dispatcher/index.js";
import { Node } from "../../node/node.js";

/** The materialized-state contract a structure's backend must satisfy (D60 #1). */
export interface CollectionBackend<S> {
	/** Monotonic mutation counter; advances on every visible state change (idempotency, D49). */
	readonly version: number;
	/** A fresh defensive materialization of the current state (D60: first-cut defensive copy). */
	snapshot(): S;
}

export interface CollectionCoreOptions {
	/** Debug/inspection name; the delta/snapshot nodes derive `${name}.delta` / `${name}.snapshot`. */
	name?: string;
	/** Dispatcher for the core's nodes (default = process-global, D26). */
	dispatcher?: Dispatcher;
}

export interface CollectionCore<S, C> {
	/** DELTA backbone (D60 #2a): a bare source; every {@link CollectionCore.emit} pushes one change. */
	readonly delta: Node<C>;
	/** SNAPSHOT pull node (D60 #2b): demand via `ctx.upNext([[RESUME, pullId]])`; lazy O(n) on demand. */
	readonly snapshot: Node<S>;
	/** The snapshot node's pullId — the author writes it verbatim into the demander's fn (D59). */
	readonly pullId: symbol;
	/** Push one delta event (the imperative path: a method mutates the backend, then calls this). */
	emit(change: C): void;
	/**
	 * D54 widening: fold an in-graph producer `src` into the backend. `apply` mutates the backend +
	 * `emit`s the change(s). The folder is a DECLARED-dep node (describe shows `src → folder`, NOT a
	 * D45 island); its emit is the structure's plumbing (D54-sanctioned). Returns a disposer.
	 */
	bindSource<V>(src: Node<V>, apply: (value: V) => void): () => void;
}

/**
 * Build the shared core for a reactive structure (D60). `factory` names the nodes for describe
 * (D6/D51 auto-discovery). The structure passes its `backend` (any {@link CollectionBackend}) and
 * layers a typed method surface on top.
 */
export function collectionCore<S, C>(
	backend: CollectionBackend<S>,
	factory: string,
	opts: CollectionCoreOptions = {},
): CollectionCore<S, C> {
	const { name, dispatcher } = opts;
	const base: { dispatcher?: Dispatcher } = dispatcher ? { dispatcher } : {};

	// DELTA backbone: a bare source (D60 #2a / review #2 — node([], null), no `initial`, so a late
	// subscriber gets no fake "initial change"; state is the snapshot port's job).
	const delta = new Node<C>([], null, {
		...base,
		factory: `${factory}.delta`,
		name: name ? `${name}.delta` : undefined,
	});

	// SNAPSHOT pull node: dep=[delta] (the backbone arms it via quiet-absorb so coalesce is free,
	// D60). The fn IGNORES the delta value — it reads `backend.snapshot()` on demand (D60 #3). The
	// pullId is a unique Symbol (R-pull/D59: matched by identity, zero collision with pause locks).
	// `partial:true`: the fn does not need the delta's value, so it must not gate on "all deps
	// settled" — it fires whenever armed (a mutation since the last delivery).
	const pullId = Symbol(name ? `${name}.snapshot` : `${factory}.snapshot`);
	const snapFn = (ctx: Ctx): void => {
		ctx.down([["DATA", backend.snapshot()]]);
	};
	const snapshot = new Node<S>([delta as Node<unknown>], snapFn, {
		...base,
		pullId,
		partial: true,
		factory: `${factory}.snapshot`,
		name: name ? `${name}.snapshot` : undefined,
	});

	function emit(change: C): void {
		// External tier-3 emit → the substrate synthesizes the leading DIRTY (R-dirty-before-data),
		// which the quiet snapshot node absorbs (R-pull) and uses to arm its next demand delivery.
		delta.down([["DATA", change]]);
	}

	function bindSource<V>(src: Node<V>, apply: (value: V) => void): () => void {
		// A declared-dep folder (effect-shaped): reads each src batch value, applies it to the backend
		// (apply mutates + emits the delta). src → folder is a real edge describe shows (D54 widening,
		// NOT the D45-banned internal subscribe). Keepalive-activated so it drives the backend even
		// with no external subscriber (it is an input adapter, not an output).
		const folder = new Node<void>(
			[src as Node<unknown>],
			(ctx: Ctx) => {
				const b = ctx.depRecords[0]?.batch;
				try {
					if (b) for (const v of b) apply(v as V);
				} catch (e) {
					ctx.down([["ERROR", e ?? new Error("collectionCore.bindSource failed")]]);
				}
			},
			{ ...base, factory: `${factory}.bindSource`, name: name ? `${name}.bind` : undefined },
		);
		return folder.subscribe(() => {});
	}

	return { delta, snapshot, pullId, emit, bindSource };
}
