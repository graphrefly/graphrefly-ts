/**
 * Reactive key–value map (CSP-2.8, D54/D60/D68) — two-port collection with policy opts.
 *
 * Shape = the shared {@link collectionCore} two ports over a `Map` BACKEND (D60). Specializations
 * (D60 #3 / review #3):
 *   - TTL/LRU are node-as-opt policies (D68). Static `maxSize` / `defaultTtl` values become constant
 *     policy deps; Node-valued opts are declared deps. The graph-visible `reactiveMap.apply` node is
 *     the normal backend mutation path and emits the public delta payloads it materializes.
 *   - LAZY TTL (no background timer): expiry is checked at read (`get`/`has`) + at synchronous
 *     snapshot materialization (`toMap`/`pruneExpired`). A read/prune that deletes an expired key
 *     emits the normal delta `delete{reason:"expired"}` (D61). Snapshot demand uses an internal pull
 *     `snapshotPrep` node: it prunes expired entries and reads the backend once, then public
 *     `snapshot` and `delta` derive from that declared prep payload. No snapshot fn drives its own
 *     dep (D37).
 *   - delete-reason enum {expired|lru-evict|archived|explicit} on the delta (D60 #3c).
 *   - LRU `maxSize`: an over-cap `set` evicts the oldest, emitting a `delete{reason:"lru-evict"}`.
 *     A live-key `get`/`has` touches LRU order WITHOUT a version bump (internal, D60 #3d).
 *   - retention (score-archive) is DEFERRED (backlog) — `delete.reason:"archived"` is reserved.
 *
 * Per-language (D6/D24, never in parity, no conformance — the substrate pull is already C-16).
 */

import type { Ctx, NodeFn } from "../../ctx/types.js";
import { Node } from "../../node/node.js";
import { initNode, type Operator } from "../operators.js";
import {
	deadlines,
	lruKeys,
	PolicyInputs,
	type PolicyOpt,
	trimHeadOverflow,
} from "../policies/collection.js";
import { timer } from "../sources.js";
import type { MapChange } from "./change.js";
import type { CollectionCoreOptions } from "./core.js";

export type ReactiveMapOpt<T> = T | Node<T>;

export interface ReactiveMapOptions extends CollectionCoreOptions {
	/**
	 * LRU cap as a node-as-opt policy (D68). A static number is a constant policy config; a Node must
	 * be graph-bound and becomes a declared dep of `reactiveMap.apply`.
	 */
	maxSize?: ReactiveMapOpt<number>;
	/**
	 * Default TTL in milliseconds as a node-as-opt policy (D68). Per-call `set(...,{ttl})` overrides.
	 * Lazy expiry only; no active timer in this cut.
	 */
	defaultTtl?: ReactiveMapOpt<number>;
	/** Injectable monotonic-ish clock for TTL (default `Date.now`). Graph-local clock = follow-up (D26). */
	now?: () => number;
}

export interface ReactiveMap<K, V> {
	readonly delta: Node<MapChange<K, V>>;
	readonly snapshot: Node<ReadonlyMap<K, V>>;
	readonly pullId: symbol;
	/** Raw entry count (O(1)); may include not-yet-pruned expired entries. Sync non-reactive read. */
	readonly size: number;
	/** Get a live value (prunes the key if expired). Sync read. */
	get(key: K): V | undefined;
	/** Live-key existence (prunes if expired). Sync read. */
	has(key: K): boolean;
	/** Current live (non-expired) entries (fresh copy). Sync non-reactive read (cold-start peek). */
	toMap(): ReadonlyMap<K, V>;
	set(key: K, value: V, opts?: { ttl?: number }): void;
	/** Bulk set; one delta event per entry, one snapshot-arm. No-op if empty. */
	setMany(entries: Iterable<readonly [K, V]>, opts?: { ttl?: number }): void;
	delete(key: K): void;
	/** Bulk delete; one delta per removed key. No-op if none present. */
	deleteMany(keys: Iterable<K>): void;
	clear(): void;
	/** Explicitly prune expired entries; every removed key emits `delete{reason:"expired"}` (D61). */
	pruneExpired(): void;
	/** D54 widening: every `[key, value]` from `src` is set. Returns a disposer. */
	setFrom(src: Node<readonly [K, V]>): () => void;
	dispose(): void;
}

interface Entry<V> {
	value: V;
	expiresAt?: number;
}

type Lookup<V> =
	| { found: true; value: V }
	| { found: false; expired?: false }
	| { found: false; expired: true; previous: V };

interface SnapshotPrep<K, V> {
	readonly snapshot: ReadonlyMap<K, V>;
	readonly expired: readonly MapChange<K, V>[];
}

type MapIntent<K, V> =
	| { kind: "set"; key: K; value: V; ttl?: number }
	| { kind: "delete"; key: K }
	| { kind: "clear" }
	| { kind: "pruneExpired" }
	| { kind: "pruneKey"; key: K };

/** Default `Map`-backed store. TTL/LRU policy lives in graph-visible policy/apply nodes (D68). */
class MapBackend<K, V> {
	private _version = 0;
	private readonly store = new Map<K, Entry<V>>();
	private readonly now: () => number;

	constructor(opts: { now?: () => number }) {
		this.now = opts.now ?? Date.now;
	}

	get version(): number {
		return this._version;
	}

	get size(): number {
		return this.store.size;
	}

	nowMs(): number {
		return this.now();
	}

	expiresAtOf(key: K): number | undefined {
		return this.store.get(key)?.expiresAt;
	}

	private isExpired(e: Entry<V>): boolean {
		return e.expiresAt !== undefined && this.now() >= e.expiresAt;
	}

	resolveExpiresAt(ttl?: number): number | undefined {
		if (ttl === undefined) return undefined;
		if (!Number.isFinite(ttl) || ttl <= 0)
			throw new RangeError(`reactiveMap: ttl must be a positive finite number (got ${ttl})`);
		return this.now() + ttl;
	}

	private deleteExpired(key: K, e: Entry<V>): Array<[K, V]> {
		this.store.delete(key);
		this._version += 1;
		return [[key, e.value]];
	}

	/** Read without materializing expiry. Caller routes expired deletes through the apply node (D68). */
	lookup(key: K): Lookup<V> {
		const e = this.store.get(key);
		if (e === undefined) return { found: false };
		if (this.isExpired(e)) return { found: false, expired: true, previous: e.value };
		// LRU touch (no version bump — internal, D60 #3d).
		this.store.delete(key);
		this.store.set(key, e);
		return { found: true, value: e.value };
	}

	/** Set; returns the entries evicted by LRU overflow (the caller emits their delete deltas). */
	set(key: K, value: V, expiresAt?: number): void {
		if (this.store.has(key)) this.store.delete(key); // re-insert at LRU end
		this.store.set(key, { value, expiresAt });
		this._version += 1;
	}

	enforceLru(maxSize?: number): Array<[K, V]> {
		const evicted: Array<[K, V]> = [];
		for (const oldest of trimHeadOverflow(lruKeys(this.store.keys()).keys(), {
			maxSize,
			size: this.store.size,
		})) {
			const e = this.store.get(oldest);
			if (e !== undefined) evicted.push([oldest, e.value]);
			this.store.delete(oldest);
		}
		if (evicted.length > 0) this._version += 1;
		return evicted;
	}

	delete(key: K): Lookup<V> {
		const e = this.store.get(key);
		if (e === undefined) return { found: false };
		this.store.delete(key);
		this._version += 1;
		return { found: true, value: e.value };
	}

	clear(): number {
		const n = this.store.size;
		if (n === 0) return 0;
		this.store.clear();
		this._version += 1;
		return n;
	}

	pruneExpired(): Array<[K, V]> {
		const removed: Array<[K, V]> = [];
		for (const [k, e] of this.store) {
			if (this.isExpired(e)) {
				this.store.delete(k);
				removed.push([k, e.value]);
			}
		}
		if (removed.length > 0) this._version += 1;
		return removed;
	}

	pruneKeyIfExpired(key: K): Array<[K, V]> {
		const e = this.store.get(key);
		if (e === undefined || !this.isExpired(e)) return [];
		return this.deleteExpired(key, e);
	}

	/** Fresh snapshot of live entries. Does not prune; callers choose whether to materialize expiry. */
	snapshot(): ReadonlyMap<K, V> {
		const out = new Map<K, V>();
		for (const [k, e] of this.store) if (!this.isExpired(e)) out.set(k, e.value);
		return out;
	}
}

/**
 * Create a reactive map (D54/D60). DELTA stream of {@link MapChange} + lazy pull SNAPSHOT (a
 * `ReadonlyMap`) + pullId via {@link collectionCore}; this layer adds the typed map surface.
 */
export function reactiveMap<K, V>(options: ReactiveMapOptions = {}): ReactiveMap<K, V> {
	const { maxSize, defaultTtl, now, name, dispatcher, graph } = options;
	const backend = new MapBackend<K, V>({ now });
	const base = dispatcher ? { dispatcher } : {};

	function isNodeOpt<T>(x: PolicyOpt<T> | undefined): x is Node<T> {
		return x instanceof Node;
	}

	function validateMaxSize(v: number): number {
		if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1)
			throw new RangeError(`reactiveMap: maxSize must be a positive integer (got ${v})`);
		return v;
	}

	function validateTtl(v: number): number {
		if (!Number.isFinite(v) || v <= 0)
			throw new RangeError(`reactiveMap: defaultTtl must be a positive finite number (got ${v})`);
		return v;
	}

	function constPolicyNode(label: "lruPolicy" | "ttlPolicy", value: number): Node<number> {
		const op: Operator<never, number> = {
			factory: `reactiveMap.${label}`,
			body: () => {},
			opts: { initial: value },
		};
		if (graph) {
			return graph.initNode(op, [], {
				name: name ? `${name}.${label}` : undefined,
				meta: { kind: "collection_policy", collection: "reactiveMap", policy: label },
			});
		}
		return new Node<number>([], null, {
			...base,
			initial: value,
			factory: `reactiveMap.${label}`,
			name: name ? `${name}.${label}` : undefined,
		});
	}

	function policyNode(
		label: "lruPolicy" | "ttlPolicy",
		opt: PolicyOpt<number> | undefined,
		validate: (v: number) => number,
	): Node<number> | undefined {
		if (opt === undefined) return undefined;
		if (isNodeOpt(opt)) {
			if (graph === undefined)
				throw new Error(
					`reactiveMap ${label} Node option requires options.graph so the policy edge is describe-visible (D68)`,
				);
			return opt;
		}
		return constPolicyNode(label, validate(opt));
	}

	const intentOp: Operator<never, MapIntent<K, V>> = {
		factory: "reactiveMap.intent",
		body: () => {},
	};
	const intent = graph
		? graph.initNode(intentOp, [], {
				name: name ? `${name}.intent` : undefined,
				meta: { kind: "collection_intent", collection: "reactiveMap" },
			})
		: new Node<MapIntent<K, V>>([], null, {
				...base,
				factory: "reactiveMap.intent",
				name: name ? `${name}.intent` : undefined,
			});
	const lruPolicy = policyNode("lruPolicy", maxSize, validateMaxSize);
	const ttlPolicy = policyNode("ttlPolicy", defaultTtl, validateTtl);

	let currentMaxSize = isNodeOpt(maxSize) ? undefined : maxSize;
	let currentDefaultTtl = isNodeOpt(defaultTtl) ? undefined : defaultTtl;
	const ttlHeap = deadlines<K>();
	let ttlTimer: Node<unknown> | null = null;
	let ttlTimerDue: number | undefined;
	const bindDeps = new WeakSet<Node<unknown>>();
	let bindSeq = 0;
	let apply: Node<MapChange<K, V>>;

	const policyInputs = new PolicyInputs([intent as Node<unknown>]);
	const lruReader = policyInputs.add(lruPolicy);
	const ttlReader = policyInputs.add(ttlPolicy);

	function emitExpired(ctx: Ctx, entries: Array<[K, V]>): void {
		for (const [key, previous] of entries)
			ctx.down([["DATA", { kind: "delete", key, previous, reason: "expired" }]]);
	}

	function emitLruEvicted(ctx: Ctx, entries: Array<[K, V]>): void {
		for (const [key, previous] of entries)
			ctx.down([["DATA", { kind: "delete", key, previous, reason: "lru-evict" }]]);
	}

	function nextValidExpiry(): { readonly key: K; readonly expiresAt: number } | undefined {
		for (;;) {
			const top = ttlHeap.peek();
			if (top === undefined) return undefined;
			if (backend.expiresAtOf(top.key) === top.expiresAt) return top;
			ttlHeap.pop();
		}
	}

	function scheduleTtl(ctx: Ctx, body: NodeFn): void {
		for (;;) {
			const next = nextValidExpiry();
			if (next === undefined) {
				if (ttlTimer) ctx.rewireNext.removeDep(ttlTimer, body);
				ttlTimer = null;
				ttlTimerDue = undefined;
				return;
			}
			if (next.expiresAt <= backend.nowMs()) {
				emitExpired(ctx, backend.pruneExpired());
				continue;
			}
			if (ttlTimerDue === next.expiresAt) return;
			if (ttlTimer) ctx.rewireNext.removeDep(ttlTimer, body);
			ttlTimerDue = next.expiresAt;
			ttlTimer = initNode(timer(Math.max(0, next.expiresAt - backend.nowMs())), [], base);
			ctx.rewireNext.addDep(ttlTimer, body);
			return;
		}
	}

	function applyIntent(ctx: Ctx, intentValue: MapIntent<K, V>): void {
		if (intentValue.kind === "set") {
			const ttl = intentValue.ttl ?? currentDefaultTtl;
			const expiresAt = backend.resolveExpiresAt(ttl);
			backend.set(intentValue.key, intentValue.value, expiresAt);
			if (expiresAt !== undefined) ttlHeap.push({ key: intentValue.key, expiresAt });
			ctx.down([["DATA", { kind: "set", key: intentValue.key, value: intentValue.value }]]);
			emitLruEvicted(ctx, backend.enforceLru(currentMaxSize));
			return;
		}
		if (intentValue.kind === "delete") {
			const previous = backend.delete(intentValue.key);
			if (previous.found)
				ctx.down([
					[
						"DATA",
						{ kind: "delete", key: intentValue.key, previous: previous.value, reason: "explicit" },
					],
				]);
			return;
		}
		if (intentValue.kind === "clear") {
			const count = backend.clear();
			if (count > 0) ctx.down([["DATA", { kind: "clear", count }]]);
			return;
		}
		if (intentValue.kind === "pruneExpired") {
			emitExpired(ctx, backend.pruneExpired());
			return;
		}
		emitExpired(ctx, backend.pruneKeyIfExpired(intentValue.key));
	}

	const applyBody: NodeFn = (ctx: Ctx) => {
		const nextMaxSize = lruReader.read(ctx, currentMaxSize);
		currentMaxSize = nextMaxSize === undefined ? undefined : validateMaxSize(nextMaxSize);
		const nextTtl = ttlReader.read(ctx, currentDefaultTtl);
		currentDefaultTtl = nextTtl === undefined ? undefined : validateTtl(nextTtl);

		for (const item of (ctx.depRecords[0]?.batch ?? []) as readonly MapIntent<K, V>[]) {
			applyIntent(ctx, item);
		}
		const deps = apply.deps;
		for (let i = 1; i < ctx.depRecords.length; i++) {
			if (i === lruReader.index || i === ttlReader.index) continue;
			const dep = deps[i];
			const record = ctx.depRecords[i];
			if (dep && bindDeps.has(dep)) {
				for (const item of (record?.batch ?? []) as readonly MapIntent<K, V>[]) {
					applyIntent(ctx, item);
				}
				continue;
			}
			if (
				dep === ttlTimer &&
				record &&
				((record.batch?.length ?? 0) > 0 || record.terminal === true)
			) {
				if (ttlTimer) ctx.rewireNext.removeDep(ttlTimer, applyBody);
				ttlTimer = null;
				ttlTimerDue = undefined;
				emitExpired(ctx, backend.pruneExpired());
			}
		}
		// Lowering a reactive maxSize is itself a policy-driven backend mutation (D68).
		emitLruEvicted(ctx, backend.enforceLru(currentMaxSize));
		scheduleTtl(ctx, applyBody);
	};

	const applyOp: Operator<unknown, MapChange<K, V>> = {
		factory: "reactiveMap.apply",
		body: applyBody,
		opts: { partial: true },
	};
	apply = graph
		? graph.initNode(applyOp, policyInputs.deps as readonly Node<unknown>[], {
				name: name ? `${name}.apply` : undefined,
				meta: { kind: "collection_policy_apply", collection: "reactiveMap" },
			})
		: initNode(applyOp, policyInputs.deps, {
				...base,
				name: name ? `${name}.apply` : undefined,
			});

	const pullId = Symbol(name ? `${name}.snapshot` : "reactiveMap.snapshot");
	const snapshotPrepOp: Operator<unknown, SnapshotPrep<K, V>> = {
		factory: "reactiveMap.snapshotPrep",
		body: (ctx: Ctx) => {
			const expired = backend.pruneExpired().map(
				([key, previous]): MapChange<K, V> => ({
					kind: "delete",
					key,
					previous,
					reason: "expired",
				}),
			);
			ctx.down([["DATA", { snapshot: backend.snapshot(), expired }]]);
		},
		opts: {
			...base,
			pullId,
			partial: true,
		},
	};
	const snapshotPrep = graph
		? graph.initNode(snapshotPrepOp, [apply as Node<unknown>], {
				name: name ? `${name}.snapshotPrep` : undefined,
				meta: { kind: "collection_snapshot_prep", collection: "reactiveMap" },
			})
		: initNode(snapshotPrepOp, [apply as Node<unknown>], {
				...base,
				name: name ? `${name}.snapshotPrep` : undefined,
			});
	const deltaOp: Operator<unknown, MapChange<K, V>> = {
		factory: "reactiveMap.delta",
		body: (ctx: Ctx) => {
			for (const change of ctx.depRecords[0]?.batch ?? []) {
				ctx.down([["DATA", change as MapChange<K, V>]]);
			}
			for (const prep of ctx.depRecords[1]?.batch ?? []) {
				for (const change of (prep as SnapshotPrep<K, V>).expired) ctx.down([["DATA", change]]);
			}
		},
		opts: { partial: true },
	};
	const delta = graph
		? graph.initNode(deltaOp, [apply as Node<unknown>, snapshotPrep as Node<unknown>], {
				name: name ? `${name}.delta` : undefined,
				meta: { kind: "collection_delta", collection: "reactiveMap" },
			})
		: initNode(deltaOp, [apply as Node<unknown>, snapshotPrep as Node<unknown>], {
				...base,
				name: name ? `${name}.delta` : undefined,
			});
	const snapshotOp: Operator<unknown, ReadonlyMap<K, V>> = {
		factory: "reactiveMap.snapshot",
		body: (ctx: Ctx) => {
			for (const prep of ctx.depRecords[0]?.batch ?? []) {
				ctx.down([["DATA", (prep as SnapshotPrep<K, V>).snapshot]]);
			}
		},
		opts: { partial: true },
	};
	const snapshot = graph
		? graph.initNode(snapshotOp, [snapshotPrep as Node<unknown>], {
				name: name ? `${name}.snapshot` : undefined,
				meta: { kind: "collection_snapshot", collection: "reactiveMap" },
			})
		: initNode(snapshotOp, [snapshotPrep as Node<unknown>], {
				...base,
				name: name ? `${name}.snapshot` : undefined,
			});
	const releaseApply = graph
		? graph.retain(apply, { reason: "reactiveMap.apply" })
		: apply.subscribe(() => {});
	const binds: Array<() => void> = [];

	function doSet(key: K, value: V, ttl?: number): void {
		if (ttl !== undefined) validateTtl(ttl);
		intent.down([["DATA", { kind: "set", key, value, ttl }]]);
	}

	function read(key: K): Lookup<V> {
		const r = backend.lookup(key);
		if (!r.found && r.expired) intent.down([["DATA", { kind: "pruneKey", key }]]);
		return r;
	}

	return {
		delta,
		snapshot,
		pullId,

		get size(): number {
			return backend.size;
		},
		get(key: K): V | undefined {
			const r = read(key);
			return r.found ? r.value : undefined;
		},
		has(key: K): boolean {
			return read(key).found;
		},
		toMap(): ReadonlyMap<K, V> {
			intent.down([["DATA", { kind: "pruneExpired" }]]);
			return backend.snapshot();
		},

		set(key: K, value: V, opts?: { ttl?: number }): void {
			doSet(key, value, opts?.ttl);
		},
		setMany(entries: Iterable<readonly [K, V]>, opts?: { ttl?: number }): void {
			for (const [k, v] of entries) doSet(k, v, opts?.ttl);
		},
		delete(key: K): void {
			intent.down([["DATA", { kind: "delete", key }]]);
		},
		deleteMany(keys: Iterable<K>): void {
			for (const k of keys) {
				intent.down([["DATA", { kind: "delete", key: k }]]);
			}
		},
		clear(): void {
			intent.down([["DATA", { kind: "clear" }]]);
		},
		pruneExpired(): void {
			intent.down([["DATA", { kind: "pruneExpired" }]]);
		},

		setFrom(src: Node<readonly [K, V]>): () => void {
			if (graph === undefined)
				throw new Error(
					"reactiveMap.setFrom requires options.graph so the input fold is describe-visible (D61)",
				);
			const op: Operator<readonly [K, V], MapIntent<K, V>> = {
				factory: "reactiveMap.bindSource",
				body: (ctx: Ctx) => {
					try {
						for (const [k, v] of (ctx.depRecords[0]?.batch ?? []) as readonly (readonly [K, V])[]) {
							ctx.down([["DATA", { kind: "set", key: k, value: v }]]);
						}
					} catch (e) {
						ctx.down([["ERROR", e ?? new Error("reactiveMap.bindSource failed")]]);
					}
				},
			};
			const folder = graph.initNode(op, [src], {
				name: name ? `${name}.bind#${bindSeq++}` : undefined,
				meta: { kind: "collection_bind_source", collection: "reactiveMap" },
			});
			bindDeps.add(folder as Node<unknown>);
			apply.addDep(folder as Node<unknown>, applyBody);
			let active = true;
			const dispose = () => {
				if (!active) return;
				active = false;
				apply.removeDep(folder as Node<unknown>, applyBody);
			};
			binds.push(dispose);
			return dispose;
		},
		dispose(): void {
			for (const d of binds) d();
			binds.length = 0;
			releaseApply();
		},
	};
}
