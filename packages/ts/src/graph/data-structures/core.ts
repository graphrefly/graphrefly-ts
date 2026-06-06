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

import { type Ctx, depBatch } from "../../ctx/types.js";
import type { Dispatcher } from "../../dispatcher/index.js";
import { Node, releaseRuntimeOfNode } from "../../node/node.js";
import { errorPayload } from "../../protocol/messages.js";
import { type Graph, releaseGraphNodes } from "../graph.js";
import type { Operator } from "../operators.js";
import type { ViewCachePolicy } from "../policies/types.js";

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
	/** Graph funnel for describe-visible input folds (D61). Required by *From/attach methods. */
	graph?: Graph;
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
 * Public D121 collection-view surface. A view is a derived surface: `delta` is the pushed update
 * port, `snapshot` is a lazy pull node, and neither port is writable authority.
 */
export interface ReactiveView<C, S> {
	/** Derived DELTA/update stream for the view. For light views this is recomputed from the parent backend. */
	readonly delta: Node<C>;
	/** Derived SNAPSHOT pull node: demand via `pullId` to materialize the current view. */
	readonly snapshot: Node<S>;
	/** The snapshot node's pullId (R-pull/D59), minted per view instance. */
	readonly pullId: symbol;
	/** Release memoized/light-view resources owned by the parent collection. */
	dispose(): void;
}

interface LightReactiveViewOptions<S> extends CollectionCoreOptions {
	readonly factory: string;
	readonly materializeSnapshot: () => S;
	readonly onDispose?: () => void;
}

function validateViewCacheMaxEntries(policy: ViewCachePolicy | undefined): number | undefined {
	const maxEntries = policy?.maxEntries;
	if (maxEntries === undefined) return undefined;
	if (!Number.isInteger(maxEntries) || maxEntries < 0) {
		throw new RangeError(`viewCache.maxEntries must be a non-negative integer (got ${maxEntries})`);
	}
	return maxEntries;
}

/**
 * Internal D80 memo manager for derived views. Eviction drops only the structure's memo lookup;
 * returned ReactiveView handles remain live until explicitly disposed or their parent releases all
 * live views.
 */
export class ViewMemoCache<K, V extends { dispose(): void }> {
	private readonly maxEntries: number | undefined;
	private readonly equals: (a: K, b: K) => boolean;
	private readonly memo: Array<{ key: K; value: V }> = [];
	private readonly live = new Set<V>();

	constructor(policy: ViewCachePolicy | undefined, equals: (a: K, b: K) => boolean = Object.is) {
		this.maxEntries = validateViewCacheMaxEntries(policy);
		this.equals = equals;
	}

	get(key: K): V | undefined {
		const index = this.memo.findIndex((entry) => this.equals(entry.key, key));
		if (index < 0) return undefined;
		const [entry] = this.memo.splice(index, 1);
		if (entry === undefined) return undefined;
		this.memo.push(entry);
		return entry.value;
	}

	set(key: K, value: V): void {
		this.deleteValue(value);
		this.live.add(value);
		if (this.maxEntries === 0) return;
		this.memo.push({ key, value });
		while (this.maxEntries !== undefined && this.memo.length > this.maxEntries) {
			this.memo.shift();
		}
	}

	deleteValue(value: V): void {
		for (let i = this.memo.length - 1; i >= 0; i -= 1) {
			if (this.memo[i]?.value === value) this.memo.splice(i, 1);
		}
		this.live.delete(value);
	}

	disposeAll(): void {
		for (const view of [...this.live]) view.dispose();
		this.memo.length = 0;
		this.live.clear();
	}
}

/**
 * Build a D121 first-cut light view. The view declares `parent.delta -> view.delta ->
 * view.snapshot`; the pushed `delta` forwards parent delta events as the view's arm/update stream,
 * while `snapshot` reads the parent collection backend through the supplied materializer on demand.
 * No writable state/cache is exposed (D120).
 */
export function lightReactiveView<C, S>(
	parentDelta: Node<unknown>,
	opts: LightReactiveViewOptions<S>,
): ReactiveView<C, S> {
	const { dispatcher, factory, graph, materializeSnapshot, name, onDispose } = opts;
	const base = dispatcher ? { dispatcher } : {};
	const deltaBody = (ctx: Ctx): void => {
		for (const change of (depBatch(ctx, 0) ?? []) as readonly C[]) {
			ctx.down([["DATA", change]]);
		}
	};
	const delta = graph
		? graph.node<C>([parentDelta], deltaBody, {
				factory: `${factory}.delta`,
				name: name ? `${name}.delta` : undefined,
				meta: { kind: "collection_view_delta", factory },
				partial: true,
			})
		: new Node<C>([parentDelta], deltaBody, {
				...base,
				factory: `${factory}.delta`,
				name: name ? `${name}.delta` : undefined,
				partial: true,
			});

	const pullId = Symbol(name ? `${name}.snapshot` : `${factory}.snapshot`);
	const snapshotBody = (ctx: Ctx): void => {
		try {
			ctx.down([["DATA", materializeSnapshot()]]);
		} catch (e) {
			ctx.down([["ERROR", errorPayload(e, `${factory}.snapshot materializer failed`)]]);
		}
	};
	const snapshot = graph
		? graph.node<S>([delta as Node<unknown>], snapshotBody, {
				factory: `${factory}.snapshot`,
				name: name ? `${name}.snapshot` : undefined,
				meta: { kind: "collection_view_snapshot", factory },
				partial: true,
				pullId,
			})
		: new Node<S>([delta as Node<unknown>], snapshotBody, {
				...base,
				factory: `${factory}.snapshot`,
				name: name ? `${name}.snapshot` : undefined,
				partial: true,
				pullId,
			});

	let disposed = false;
	return {
		delta,
		snapshot,
		pullId,
		dispose(): void {
			if (disposed) return;
			if (graph) {
				releaseGraphNodes(graph, [delta as Node<unknown>, snapshot as Node<unknown>], {
					reason: factory,
				});
			} else {
				releaseRuntimeOfNode(delta as Node<unknown>);
				releaseRuntimeOfNode(snapshot as Node<unknown>);
			}
			disposed = true;
			onDispose?.();
		},
	};
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
	const { name, dispatcher, graph } = opts;
	const base: { dispatcher?: Dispatcher } = dispatcher ? { dispatcher } : {};
	let bindSeq = 0;

	// DELTA backbone: a bare source (D60 #2a / review #2 — node([], null), no `initial`, so a late
	// subscriber gets no fake "initial change"; state is the snapshot port's job).
	const delta = graph
		? graph.node<C>([], null, {
				factory: `${factory}.delta`,
				name: name ? `${name}.delta` : undefined,
				meta: { kind: "collection_delta", collection: factory },
			})
		: new Node<C>([], null, {
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
	const snapshot = graph
		? graph.node<S>([delta as Node<unknown>], snapFn, {
				pullId,
				partial: true,
				factory: `${factory}.snapshot`,
				name: name ? `${name}.snapshot` : undefined,
				meta: { kind: "collection_snapshot", collection: factory },
			})
		: new Node<S>([delta as Node<unknown>], snapFn, {
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
		if (graph === undefined)
			throw new Error(
				"collectionCore.bindSource requires options.graph so the input fold is describe-visible (D61)",
			);
		// A graph-bound declared-dep folder (effect-shaped): reads each src batch value, applies it
		// to the backend (apply mutates + emits the delta). src → folder is a real edge describe
		// shows (D54/D61), not an internal subscribe island.
		const op: Operator<V, void> = {
			factory: `${factory}.bindSource`,
			body: (ctx: Ctx) => {
				const b = depBatch(ctx, 0);
				try {
					if (b) for (const v of b) apply(v as V);
				} catch (e) {
					ctx.down([["ERROR", errorPayload(e, "collectionCore.bindSource failed")]]);
				}
			},
		};
		const folder = graph.initNode(op, [src], {
			name: name ? `${name}.bind#${bindSeq++}` : undefined,
			meta: { kind: "collection_bind_source", collection: factory },
		});
		return graph.retain(folder, { reason: `${factory}.bindSource` });
	}

	return { delta, snapshot, pullId, emit, bindSource };
}
