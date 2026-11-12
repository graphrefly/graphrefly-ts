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
 *   - SNAPSHOT port (D60 #2b) — a QUIET node ({@link CollectionCore.snapshot}, R-wave) over the
 *     delta and a REQUEST state ({@link CollectionCore.request}). A write to the request LAZILY
 *     reads `backend.snapshot()` (one O(n) materialization) and sends it as a new wave after the
 *     current one. The O(n) build happens ONLY on request — never eagerly per mutation (D60 #2b:
 *     lazy is P·O(n), not M·O(n)). It has NO value of its own — its fn reads the backend on
 *     request, so the backend stays the single source of truth (D60 #3). A request with no
 *     mutation since the last delivery sends nothing. Control is data on a declared edge
 *     (R-no-imperative, graphrefly-ts:D172): there is no upward demand message.
 *
 * Request path: write any value to `core.request` (outside a wave, or from a function as a
 * request that runs after the current wave). A request written before the snapshot's lifetime
 * started is not served again at its activation. For an initial/imperative read use the
 * structure's synchronous quick-read (the deliberately-non-reactive peek, D60).
 *
 * Per-language (D6/D24, never in parity, no conformance).
 */

import { type Ctx, depBatch, depLiveBatch } from "../../ctx/types.js";
import type { Node } from "../../node/node.js";
import { oneArrayPerRun } from "../../node/one-array-per-run.js";
import { errorPayload } from "../../protocol/messages.js";
import { type GraphCheckpointJson, registerBackendStateContributor } from "../checkpoint.js";
import type { Graph } from "../graph.js";
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
}

export interface CollectionCore<S, C> {
	/** DELTA backbone (D60 #2a): a bare source; every {@link CollectionCore.emit} pushes one change. */
	readonly delta: Node<C>;
	/** SNAPSHOT quiet node (D60 #2b): a write to {@link CollectionCore.request} materializes it once. */
	readonly snapshot: Node<S>;
	/** REQUEST state the snapshot declares as a dependency; each live write asks for one snapshot. */
	readonly request: Node<true>;
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
 * port, `snapshot` is a lazy quiet node served through `request`, and neither port is writable authority.
 */
export interface ReactiveView<C, S> {
	/** Derived DELTA/update stream for the view. For light views this is recomputed from the parent backend. */
	readonly delta: Node<C>;
	/** Derived SNAPSHOT quiet node: a write to `request` materializes the current view. */
	readonly snapshot: Node<S>;
	/** REQUEST state the view snapshot declares as a dependency, minted per view instance. */
	readonly request: Node<true>;
	/** Release memoized/light-view resources owned by the parent collection. */
	dispose(): void;
}

interface LightReactiveViewOptions<S> extends CollectionCoreOptions {
	readonly factory: string;
	readonly materializeSnapshot: () => S;
	readonly onDispose?: () => void;
}

interface CollectionRestoreSpec {
	readonly deltaRef: string;
	readonly snapshotRef: string;
	readonly requestRef: string;
	readonly config?: GraphCheckpointJson;
	readonly backendState: () => unknown;
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
 * Build a D121 first-cut light view in `graph`, as one topology group. The view declares `parent.delta -> view.delta ->
 * view.snapshot`; the pushed `delta` forwards parent delta events as the view's arm/update stream,
 * while `snapshot` reads the parent collection backend through the supplied materializer on demand.
 * No writable state/cache is exposed (D120).
 */
export function lightReactiveView<C, S>(
	graph: Graph,
	parentDelta: Node<unknown>,
	opts: LightReactiveViewOptions<S>,
): ReactiveView<C, S> {
	const { factory, materializeSnapshot, name, onDispose } = opts;
	const group = graph.topologyGroup({ name: name ?? factory });
	const delta = group.node<C>(
		[parentDelta],
		oneArrayPerRun((ctx: Ctx): void => {
			for (const change of (depBatch(ctx, 0) ?? []) as readonly C[]) {
				ctx.down([["DATA", change]]);
			}
		}),
		{
			factory: `${factory}.delta`,
			name: name ? `${name}.delta` : undefined,
			meta: { kind: "collection_view_delta", factory },
		},
	);
	const request = group.node<true>([], null, {
		factory: `${factory}.request`,
		name: name ? `${name}.request` : undefined,
		meta: { kind: "collection_view_request", factory },
	});
	const snapshot = group.node<S>(
		[delta as Node<unknown>, request as Node<unknown>],
		(ctx: Ctx): void => {
			if (depLiveBatch(ctx, 1) === null) return;
			try {
				ctx.down([["DATA", materializeSnapshot()]]);
			} catch (e) {
				ctx.down([["ERROR", errorPayload(e, `${factory}.snapshot materializer failed`)]]);
			}
		},
		{
			factory: `${factory}.snapshot`,
			name: name ? `${name}.snapshot` : undefined,
			meta: { kind: "collection_view_snapshot", factory },
			quiet: true,
		},
	);

	let disposed = false;
	return {
		delta,
		snapshot,
		request,
		dispose(): void {
			if (disposed) return;
			group.release({ reason: factory });
			disposed = true;
			onDispose?.();
		},
	};
}

/**
 * Build the shared core for a reactive structure (D60) in `graph` (R-graph-domain@3: every node is
 * built by a graph). `factory` names the nodes for describe (D6/D51 auto-discovery). The structure
 * passes its `backend` (any {@link CollectionBackend}) and layers a typed method surface on top.
 */
export function collectionCore<S, C>(
	graph: Graph,
	backend: CollectionBackend<S>,
	factory: string,
	opts: CollectionCoreOptions = {},
	restore?: CollectionRestoreSpec,
): CollectionCore<S, C> {
	const { name } = opts;
	let bindSeq = 0;

	// DELTA backbone: a bare source (D60 #2a / review #2 — node([], null), no `initial`, so a late
	// subscriber gets no fake "initial change"; state is the snapshot port's job).
	const delta = graph.node<C>([], null, {
		factory: `${factory}.delta`,
		name: name ? `${name}.delta` : undefined,
		meta: { kind: "collection_delta", collection: factory },
		...(restore ? { recipe: { ref: restore.deltaRef, config: restore.config } } : {}),
	});

	// REQUEST state: a write asks the snapshot node for one materialization (graphrefly-ts:D172).
	const request = graph.node<true>([], null, {
		factory: `${factory}.request`,
		name: name ? `${name}.request` : undefined,
		meta: { kind: "collection_request", collection: factory },
		...(restore ? { recipe: { ref: restore.requestRef, config: restore.config } } : {}),
	});

	// SNAPSHOT quiet node: deps=[delta, request]. The fn IGNORES the delta value — it reads
	// `backend.snapshot()` when a live request arrived (D60 #3), and only if the backend changed
	// since the last delivery; the kernel has no first-run gate (graphrefly-ts:D184).
	let deliveredVersion = backend.version;
	const snapshot = graph.node<S>(
		[delta as Node<unknown>, request as Node<unknown>],
		(ctx: Ctx): void => {
			if (depLiveBatch(ctx, 1) === null) return;
			if (backend.version === deliveredVersion) return;
			deliveredVersion = backend.version;
			ctx.down([["DATA", backend.snapshot()]]);
		},
		{
			quiet: true,
			factory: `${factory}.snapshot`,
			name: name ? `${name}.snapshot` : undefined,
			meta: { kind: "collection_snapshot", collection: factory },
			...(restore ? { recipe: { ref: restore.snapshotRef, config: restore.config } } : {}),
		},
	);

	if (restore !== undefined) {
		registerBackendStateContributor(delta as Node<unknown>, restore.backendState);
	}

	function emit(change: C): void {
		// External value emit → the kernel sends PENDING first; the quiet snapshot node absorbs it.
		delta.set(change);
	}

	function bindSource<V>(src: Node<V>, apply: (value: V) => void): () => void {
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
		return graph.retain(folder);
	}

	return { delta, snapshot, request, emit, bindSource };
}
