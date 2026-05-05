/**
 * Reactive append-only log (roadmap §3.2) — emits `readonly T[]` snapshots directly.
 *
 * Internal version counter drives efficient equality without leaking `Versioned`
 * into the public API (spec §5.12).
 *
 * **Audit 1 (2026-04-24):** Adds `view(spec)` consolidated views, `withLatest()`
 * with `meta.lastValue` companion node, `attach(upstream)`
 * for drain-from-source wiring, factory-level `mergeReactiveLogs(logs)` for
 * fan-in, `guard?` option on `entries`, and `attachStorage(tiers)` integration
 * with the Audit 4 storage layer. {@link LogBackend} gains `snapshot()` /
 * `restore()` for cold-tier load on startup.
 *
 * **Lock 5.A (Phase 13.6.B B8):** `T` no longer permits `undefined`. The
 * SENTINEL family collapse retired the `T | undefined` exception that
 * justified the `hasLatest` companion. Concrete API impact:
 * - `lastValue` is now `Node<T>` (was `Node<T | undefined>`). `.cache`
 *   still returns `T | undefined` at the protocol level when the log is
 *   empty (sentinel state) — the type narrowing rules out *appending*
 *   `undefined`, which is enforced via runtime guard in `append` /
 *   `appendMany`.
 * - `hasLatest` is REMOVED. Empty-vs-non-empty is unambiguous from the
 *   wave shape: `[[RESOLVED]]` (R2 use, empty log) vs `[[DATA, v]]`
 *   (non-empty). Callers that need a boolean reactively should derive
 *   from `entries.length > 0`.
 * - `append(undefined as T)` throws — same applies to `appendMany`.
 */
import { batch } from "../../core/batch.js";
import { wallClockNs } from "../../core/clock.js";
import type { NodeGuard } from "../../core/guard.js";
import { COMPLETE, DATA, DIRTY, ERROR, RESOLVED } from "../../core/messages.js";
import { type Node, node } from "../../core/node.js";
import type { VersioningLevel } from "../../core/versioning.js";
import type { LogChange, LogChangePayload } from "./change.js";
import { keepalive } from "../sources/index.js";
import type { AppendLogStorageTier } from "../storage/tiers.js";

export type ReactiveLogOptions<T> = {
	name?: string;
	maxSize?: number;
	/**
	 * Optional versioning level for the underlying `entries` state node. Set
	 * at construction time; cannot be changed later. Pass `0` for V0 identity
	 * + monotonic version counter, or `1` for V1 + content-addressed cid.
	 */
	versioning?: VersioningLevel;
	/**
	 * Optional guard policy applied to the `entries` node. Use to deny
	 * external `write` while permitting `observe` / `signal` — eliminates the
	 * passthrough-derived pattern in CQRS event streams (Audit 1 #7).
	 */
	guard?: NodeGuard;
	/**
	 * Storage backend. Defaults to `NativeLogBackend` (ring buffer if `maxSize` is set,
	 * flat array otherwise). Users can plug in persistent / RRB-tree backends via
	 * the {@link LogBackend} interface.
	 */
	backend?: LogBackend<T>;
	/**
	 * Enable the `mutationLog` delta companion log. When set, every mutation
	 * appends a typed `LogChange<T>` record in the same batch frame as
	 * the snapshot emission (same-wave consistency).
	 *
	 * - `true` — creates a companion log with default options.
	 * - `{ maxSize?, name? }` — forwards to the inner companion log.
	 */
	mutationLog?: true | { maxSize?: number; name?: string };
};

/**
 * Discriminated view spec for {@link ReactiveLogBundle.view}. New `kind`s
 * (e.g. `"filter"`, `"windowByTime"`) layer in without new methods.
 */
export type ViewSpec<_T = unknown> =
	| { kind: "tail"; n: number }
	| { kind: "slice"; start: number; stop?: number }
	| { kind: "fromCursor"; cursor: Node<number> };

export type ReactiveLogBundle<T> = {
	/** Emits `readonly T[]` on each append/clear/trim (two-phase). */
	readonly entries: Node<readonly T[]>;
	/** Current entry count (O(1)). */
	readonly size: number;
	/** Positional access (O(1)); returns `undefined` on out-of-range. Supports negative indices. */
	at: (index: number) => T | undefined;
	append: (value: T) => void;
	/** Push all values, emit one snapshot. No-op if `values` is empty. */
	appendMany: (values: readonly T[]) => void;
	clear: () => void;
	/** Remove the first `n` entries (clamped to `size`). */
	trimHead: (n: number) => void;
	/**
	 * Activate the {@link ReactiveLogBundle.lastValue} companion node (lazy —
	 * installed on first call, reused thereafter). Returns `entries` so
	 * chaining reads naturally.
	 *
	 * **Companion-node access is on the bundle** (not `entries.meta`) because
	 * `Node.meta` is frozen at construction; bundle-level lazy properties
	 * give the same semantics with simpler ergonomics.
	 */
	withLatest: () => Node<readonly T[]>;
	/**
	 * Most-recently-appended value. Accessing this property activates the
	 * companion lazily — same as calling {@link ReactiveLogBundle.withLatest}.
	 *
	 * **Empty-log path emits `RESOLVED`, not `DATA(undefined)`.** When the log
	 * holds no entries, `lastValue` settles via `[[RESOLVED]]` (R2 dual-role
	 * — wave settled, no value to advertise). The §1.2 "DATA(undefined) is
	 * not a valid emission" invariant stands.
	 *
	 * **Lock 5.A (Phase 13.6.B B8):** `T` excludes `undefined`. Empty-vs-
	 * non-empty distinguishes from the wave shape — RESOLVED for empty,
	 * DATA(value) for non-empty. The pre-Lock-5.A `hasLatest` companion
	 * was retired because the dual-role RESOLVED already disambiguates.
	 *
	 * Note: `.cache` may still return `undefined` when the log is empty
	 * (sentinel state) — that's the protocol-level "never sent" signal,
	 * not a valid `T` payload.
	 */
	readonly lastValue: Node<T>;
	/**
	 * Reactive view per discriminated `ViewSpec`. Memoized per-spec — repeat
	 * calls with identical spec return the same node.
	 */
	view: (spec: ViewSpec<T>) => Node<readonly T[]>;
	/**
	 * Subscribe to `upstream` and append every DATA into this log. Returns a
	 * disposer. ERROR / COMPLETE on `upstream` propagate through the disposer
	 * (caller is responsible for terminal handling on the log).
	 */
	attach: (upstream: Node<T>) => () => void;
	/**
	 * Wire one or more append-log storage tiers. Each tier receives entries on
	 * every append wave; tier-internal flush/rollback honors the wave-as-
	 * transaction model (Audit 4). Returns a disposer.
	 */
	attachStorage: (tiers: readonly AppendLogStorageTier<T>[]) => () => void;
	/**
	 * Incremental running aggregate over the log. O(1) per append — only
	 * applies `step` to entries appended since the last emission. Returns a
	 * `Node<TAcc>` that emits the current accumulator on every log mutation.
	 *
	 * Replay via the log's `replayBuffer: N` per Lock 6.G (no scan-internal
	 * buffering). Returns `Node<TAcc>` per Lock 5.A (no `| undefined`).
	 */
	scan: <TAcc>(initial: TAcc, step: (acc: TAcc, value: T) => TAcc) => Node<TAcc>;
	/**
	 * Delta companion log. Present iff `mutationLog` option was configured.
	 * Each mutation appends a typed `LogChange<T>` record in the same
	 * batch frame as the snapshot emission (same-wave consistency).
	 */
	readonly mutationLog?: ReactiveLogBundle<LogChange<T>>;
	/** Releases all cached views (tail + slice + fromCursor). */
	disposeAllViews: () => void;
	/** Releases all internal keepalives. Idempotent. */
	dispose: () => void;
};

// ── Backend interface ─────────────────────────────────────────────────────

/**
 * Storage contract for {@link reactiveLog}. Implementations own the mutable state and
 * expose a monotonic `version` counter that increments on every structural change.
 *
 * **Audit 1:** `snapshot()` returns an immutable readonly view (codec encodes
 * at the storage tier boundary). `restore(values)` replaces backend state on
 * cold-tier startup load — fires one DATA emission for the restored shape.
 *
 * @category extra
 */
export interface LogBackend<T> {
	readonly version: number;
	readonly size: number;
	at(index: number): T | undefined;
	append(value: T): void;
	appendMany(values: readonly T[]): void;
	clear(): number;
	trimHead(n: number): number;
	slice(start: number, stop?: number): readonly T[];
	tail(n: number): readonly T[];
	toArray(): readonly T[];
	/** Immutable snapshot for codec serialization. Equivalent to `toArray()`. */
	snapshot(): readonly T[];
	/** Replace backend state with `values` (used by cold-tier restore). */
	restore(values: readonly T[]): void;
}

/**
 * Default append-only log backend.
 *
 * - When `maxSize` is set: uses a **ring buffer** with `_head` index and circular
 *   modular arithmetic. Append and trim become O(1); snapshot is O(size) unrolling.
 * - When `maxSize` is unset: uses a flat array with standard push/splice.
 *
 * @category extra
 */
export class NativeLogBackend<T> implements LogBackend<T> {
	private _version = 0;
	private readonly _maxSize?: number;
	private readonly _buf: T[];
	private _head = 0;
	private _size = 0;

	constructor(initial?: readonly T[], maxSize?: number) {
		if (maxSize !== undefined && maxSize < 1) {
			throw new RangeError("maxSize must be >= 1");
		}
		this._maxSize = maxSize;
		if (maxSize !== undefined) {
			this._buf = new Array(maxSize);
			if (initial && initial.length > 0) {
				const take = Math.min(initial.length, maxSize);
				const start = initial.length - take;
				for (let i = 0; i < take; i++) {
					this._buf[i] = initial[start + i]!;
				}
				this._size = take;
			}
		} else {
			this._buf = initial ? [...initial] : [];
			this._size = this._buf.length;
		}
	}

	get version(): number {
		return this._version;
	}

	get size(): number {
		return this._size;
	}

	at(index: number): T | undefined {
		if (!Number.isInteger(index)) return undefined;
		const i = index >= 0 ? index : this._size + index;
		if (i < 0 || i >= this._size) return undefined;
		if (this._maxSize !== undefined) {
			return this._buf[(this._head + i) % this._maxSize];
		}
		return this._buf[i];
	}

	append(value: T): void {
		this._rawAppend(value);
		this._version += 1;
	}

	appendMany(values: readonly T[]): void {
		if (values.length === 0) return;
		const start =
			this._maxSize !== undefined && values.length > this._maxSize
				? values.length - this._maxSize
				: 0;
		for (let i = start; i < values.length; i++) {
			this._rawAppend(values[i] as T);
		}
		this._version += 1;
	}

	clear(): number {
		if (this._size === 0) return 0;
		const n = this._size;
		if (this._maxSize === undefined) {
			this._buf.length = 0;
		} else {
			for (let i = 0; i < n; i++) {
				this._buf[(this._head + i) % this._maxSize] = undefined as unknown as T;
			}
		}
		this._head = 0;
		this._size = 0;
		this._version += 1;
		return n;
	}

	trimHead(n: number): number {
		if (!Number.isInteger(n) || n < 0) {
			throw new RangeError(`trimHead: n must be a non-negative integer (got ${n})`);
		}
		if (n === 0 || this._size === 0) return 0;
		const removed = Math.min(n, this._size);
		if (this._maxSize === undefined) {
			this._buf.splice(0, removed);
		} else {
			for (let i = 0; i < removed; i++) {
				this._buf[(this._head + i) % this._maxSize] = undefined as unknown as T;
			}
			this._head = (this._head + removed) % this._maxSize;
		}
		this._size -= removed;
		this._version += 1;
		return removed;
	}

	slice(start: number, stop?: number): readonly T[] {
		if (!Number.isInteger(start) || start < 0) {
			throw new RangeError(`slice: start must be a non-negative integer (got ${start})`);
		}
		if (stop !== undefined && (!Number.isInteger(stop) || stop < 0)) {
			throw new RangeError(`slice: stop must be a non-negative integer or undefined (got ${stop})`);
		}
		const end = stop === undefined ? this._size : Math.min(Math.max(stop, 0), this._size);
		const s = Math.min(start, this._size);
		if (s >= end) return [];
		const len = end - s;
		if (this._maxSize === undefined) {
			return this._buf.slice(s, end);
		}
		const out: T[] = new Array(len);
		for (let i = 0; i < len; i++) {
			out[i] = this._buf[(this._head + s + i) % this._maxSize]!;
		}
		return out;
	}

	tail(n: number): readonly T[] {
		if (!Number.isInteger(n) || n < 0) {
			throw new RangeError(`tail: n must be a non-negative integer (got ${n})`);
		}
		if (n === 0 || this._size === 0) return [];
		const take = Math.min(n, this._size);
		return this.slice(this._size - take, this._size);
	}

	toArray(): readonly T[] {
		if (this._maxSize === undefined) {
			return [...this._buf];
		}
		const out: T[] = new Array(this._size);
		for (let i = 0; i < this._size; i++) {
			out[i] = this._buf[(this._head + i) % this._maxSize]!;
		}
		return out;
	}

	snapshot(): readonly T[] {
		return this.toArray();
	}

	restore(values: readonly T[]): void {
		if (this._maxSize === undefined) {
			this._buf.length = 0;
			for (let i = 0; i < values.length; i++) this._buf.push(values[i] as T);
			this._size = this._buf.length;
		} else {
			const cap = this._maxSize;
			for (let i = 0; i < cap; i++) this._buf[i] = undefined as unknown as T;
			this._head = 0;
			const take = Math.min(values.length, cap);
			const start = values.length - take;
			for (let i = 0; i < take; i++) {
				this._buf[i] = values[start + i] as T;
			}
			this._size = take;
		}
		this._version += 1;
	}

	private _rawAppend(value: T): void {
		if (this._maxSize === undefined) {
			this._buf.push(value);
			this._size = this._buf.length;
			return;
		}
		if (this._size < this._maxSize) {
			this._buf[(this._head + this._size) % this._maxSize] = value;
			this._size += 1;
		} else {
			this._buf[this._head] = value;
			this._head = (this._head + 1) % this._maxSize;
		}
	}
}

// ── Reactive wrapper ──────────────────────────────────────────────────────

function keepaliveDerived(n: Node<unknown>): () => void {
	return n.subscribe(() => {});
}

/** Default cap on the LRU view cache for `tail(n)` / `slice(start, stop?)`. */
const DEFAULT_VIEW_CACHE_MAX = 64;

/**
 * Creates an append-only reactive log that emits immutable `readonly T[]` snapshots.
 *
 * Each structural mutation (`append`, `appendMany`, `clear`, `trimHead`) triggers
 * a two-phase `[DIRTY, DATA]` emission on the `entries` node so downstream
 * derived nodes update reactively. Views (`tail`, `slice`, `fromCursor`) are
 * memoized derived nodes — subscribe once and they stay live.
 *
 * @param initial - Optional initial entries loaded into the log at construction.
 * @param options - Optional name, max size (ring buffer), versioning level, guard policy, and custom backend.
 * @returns `ReactiveLogBundle<T>` with `entries`, `append`, `appendMany`, `clear`, `trimHead`, `view`, `attach`, `attachStorage`, and disposal methods.
 *
 * @example
 * ```ts
 * import { reactiveLog } from "@graphrefly/graphrefly/extra";
 *
 * const log = reactiveLog<string>([], { name: "messages" });
 * log.entries.subscribe((msgs) => {
 *   for (const m of msgs) {
 *     if (m[0] === 1) console.log("entries:", m[1]);
 *   }
 * });
 * log.append("hello");
 * log.append("world");
 * ```
 *
 * @remarks
 * **Ring buffer:** Pass `maxSize` to cap the log length; older entries are evicted on overflow.
 * **Storage:** Call `attachStorage(tiers)` to wire one or more `AppendLogStorageTier` instances for persistence.
 *
 * @category extra
 */
export function reactiveLog<T>(
	initial?: readonly T[],
	options: ReactiveLogOptions<T> = {},
): ReactiveLogBundle<T> {
	const { name, maxSize, versioning, guard, backend: userBackend, mutationLog: mutLogOpt } = options;
	const backend: LogBackend<T> = userBackend ?? new NativeLogBackend<T>(initial, maxSize);

	// ── Mutations companion log (Phase 14.3) ─────────────────────────────────
	// Uses a separate `reactiveLog` instance (never recurses — companion logs
	// are always created WITHOUT their own `mutationLog` option).
	const mutLog: ReactiveLogBundle<LogChange<T>> | undefined = mutLogOpt
		? reactiveLog<LogChange<T>>(undefined, {
				name: mutLogOpt === true ? (name ? `${name}.mutationLog` : undefined) : mutLogOpt.name,
				maxSize: mutLogOpt === true ? undefined : mutLogOpt.maxSize,
			})
		: undefined;
	let mutVersion = 0;
	let pendingChanges: LogChangePayload<T>[] = [];
	function enqueueChange(payload: LogChangePayload<T>): void {
		if (!mutLog) return;
		pendingChanges.push(payload);
	}

	const entries = node<readonly T[]>([], {
		initial: backend.toArray(),
		name,
		describeKind: "state",
		equals: (a, b) => a === b,
		...(versioning != null ? { versioning } : {}),
		...(guard != null ? { guard } : {}),
	});

	function pushSnapshot(): void {
		const snapshot = backend.toArray();
		const changes = pendingChanges;
		pendingChanges = [];
		batch(() => {
			// `internal: true` so deny-write guards (e.g., Audit 2's
			// DEFAULT_AUDIT_GUARD on audit logs) don't reject the log's own
			// internal pipeline. Guards apply only to external `entries.emit`.
			entries.down([[DIRTY]], { internal: true });
			entries.down([[DATA, snapshot]], { internal: true });
			for (const c of changes) {
				mutLog!.append({
					structure: "log",
					version: ++mutVersion,
					t_ns: wallClockNs(),
					lifecycle: "data",
					change: c,
				});
			}
		});
	}

	type ViewEntry = { node: Node<readonly T[]>; dispose: () => void };
	const tailCache = new Map<number, ViewEntry>();
	const sliceCache = new Map<string, ViewEntry>();
	// M6: use Map (not WeakMap) so disposeAllViews can iterate + release
	// each cursor view's keepalive subscription. Cursor cache size grows with
	// distinct cursor Nodes the bundle has been viewed by — bounded by user.
	const cursorCache = new Map<Node<number>, ViewEntry>();

	function sliceKey(start: number, stop?: number): string {
		return `${start}:${stop === undefined ? "END" : stop}`;
	}

	function evictOldestIfFull<K>(cache: Map<K, ViewEntry>): void {
		if (cache.size < DEFAULT_VIEW_CACHE_MAX) return;
		const first = cache.keys().next();
		if (first.done) return;
		const oldest = cache.get(first.value);
		if (oldest !== undefined) oldest.dispose();
		cache.delete(first.value);
	}

	function wrapMutation<R>(op: () => R): R {
		const prev = backend.version;
		try {
			return op();
		} finally {
			if (backend.version !== prev) pushSnapshot();
			else pendingChanges.length = 0;
		}
	}

	function tailView(n: number): Node<readonly T[]> {
		if (!Number.isInteger(n) || n < 0) {
			throw new RangeError(`tail: n must be a non-negative integer (got ${n})`);
		}
		const hit = tailCache.get(n);
		if (hit !== undefined) {
			tailCache.delete(n);
			tailCache.set(n, hit);
			return hit.node;
		}
		evictOldestIfFull(tailCache);
		const node_ = node(
			[entries],
			(batchData, actions, ctx) => {
				const batch0 = batchData[0];
				const s = batch0 != null && batch0.length > 0 ? batch0.at(-1) : ctx.prevData[0];
				const list = s as readonly T[];
				if (n === 0 || list.length === 0) {
					actions.emit([] as unknown as readonly T[]);
					return;
				}
				actions.emit(list.slice(Math.max(0, list.length - n)));
			},
			{ initial: backend.tail(n), describeKind: "derived" },
		);
		const dispose = keepaliveDerived(node_);
		tailCache.set(n, { node: node_, dispose });
		return node_;
	}

	function sliceView(start: number, stop?: number): Node<readonly T[]> {
		if (!Number.isInteger(start) || start < 0) {
			throw new RangeError(`slice: start must be a non-negative integer (got ${start})`);
		}
		if (stop !== undefined && (!Number.isInteger(stop) || stop < 0)) {
			throw new RangeError(`slice: stop must be a non-negative integer or undefined (got ${stop})`);
		}
		const key = sliceKey(start, stop);
		const hit = sliceCache.get(key);
		if (hit !== undefined) {
			sliceCache.delete(key);
			sliceCache.set(key, hit);
			return hit.node;
		}
		evictOldestIfFull(sliceCache);
		const node_ = node(
			[entries],
			(batchData, actions, ctx) => {
				const batch0 = batchData[0];
				const s = batch0 != null && batch0.length > 0 ? batch0.at(-1) : ctx.prevData[0];
				const list = s as readonly T[];
				actions.emit(stop === undefined ? list.slice(start) : list.slice(start, stop));
			},
			{ initial: backend.slice(start, stop), describeKind: "derived" },
		);
		const dispose = keepaliveDerived(node_);
		sliceCache.set(key, { node: node_, dispose });
		return node_;
	}

	function fromCursorView(cursor: Node<number>): Node<readonly T[]> {
		const hit = cursorCache.get(cursor);
		if (hit !== undefined) return hit.node;
		const node_ = node(
			[entries, cursor],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				const arr = data[0] as readonly T[];
				const start = Math.max(0, Math.trunc((data[1] as number) ?? 0));
				actions.emit(arr.slice(start));
			},
			{ initial: [], describeKind: "derived" },
		);
		const dispose = keepaliveDerived(node_);
		cursorCache.set(cursor, { node: node_, dispose });
		return node_;
	}

	// withLatest companion activation (lazy, idempotent)
	let lastValueCached: Node<T> | undefined;
	function activateMeta(): void {
		if (lastValueCached !== undefined) return;
		// M1: emit RESOLVED instead of DATA(undefined) when log is empty —
		// `[[DATA, undefined]]` is a §1.2 protocol violation. Empty log
		// means "nothing to advertise as latest", which is the RESOLVED
		// semantic: this wave settled, no value change. Lock 5.A retired
		// the `hasLatest` companion in favor of the wave-shape disambiguation
		// (RESOLVED = empty, DATA(v) = non-empty).
		lastValueCached = node<T>(
			[entries],
			(batchData, actions, ctx) => {
				const batch0 = batchData[0];
				const snapshot = batch0 != null && batch0.length > 0 ? batch0.at(-1) : ctx.prevData[0];
				const arr = snapshot as readonly T[] | undefined;
				if (arr == null || arr.length === 0) {
					actions.down([[RESOLVED]]);
					return;
				}
				actions.emit(arr[arr.length - 1] as T);
			},
			{
				name: name != null ? `${name}::lastValue` : "lastValue",
				describeKind: "derived",
				// `initial` is `T | null` per `NodeOptions.initial` typing —
				// when the log is empty we leave it absent (sentinel state)
				// rather than fabricating a value.
				...(backend.size === 0 ? {} : { initial: backend.at(backend.size - 1) as T }),
			},
		);
		keepaliveDerived(lastValueCached);
	}

	const bundle: ReactiveLogBundle<T> = {
		entries,

		get size(): number {
			return backend.size;
		},

		at(index: number): T | undefined {
			return backend.at(index);
		},

		append(value: T): void {
			// Lock 5.A (Phase 13.6.B B8): `T` excludes `undefined`. A literal
			// `undefined` would corrupt the empty-vs-non-empty wave-shape
			// disambiguation that replaced the retired `hasLatest` companion.
			if (value === undefined) {
				throw new TypeError(
					"reactiveLog.append(undefined) — `T` excludes undefined per Lock 5.A. " +
						"Use `T | null` for an explicit null payload.",
				);
			}
			wrapMutation(() => {
				backend.append(value);
				enqueueChange({ kind: "append", value });
			});
		},

		appendMany(values: readonly T[]): void {
			if (values.length === 0) return;
			// Lock 5.A: same `undefined` rejection at the bulk path.
			for (let i = 0; i < values.length; i++) {
				if (values[i] === undefined) {
					throw new TypeError(
						`reactiveLog.appendMany — values[${i}] is undefined; \`T\` excludes ` +
							"undefined per Lock 5.A. Use `T | null` for explicit null payloads.",
					);
				}
			}
			wrapMutation(() => {
				backend.appendMany(values);
				enqueueChange({ kind: "appendMany", values });
			});
		},

		clear(): void {
			wrapMutation(() => {
				const count = backend.clear();
				if (count > 0) enqueueChange({ kind: "clear", count });
			});
		},

		trimHead(n: number): void {
			wrapMutation(() => {
				const trimmed = backend.trimHead(n);
				if (trimmed > 0) enqueueChange({ kind: "trimHead", n: trimmed });
			});
		},

		withLatest(): Node<readonly T[]> {
			activateMeta();
			return entries;
		},

		get lastValue(): Node<T> {
			activateMeta();
			return lastValueCached!;
		},

		view(spec): Node<readonly T[]> {
			switch (spec.kind) {
				case "tail":
					return tailView(spec.n);
				case "slice":
					return sliceView(spec.start, spec.stop);
				case "fromCursor":
					return fromCursorView(spec.cursor);
			}
		},

		attach(upstream): () => void {
			const sub = upstream.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) bundle.append(m[1] as T);
				}
			});
			return () => sub();
		},

		attachStorage(tiers): () => void {
			if (tiers.length === 0) return () => {};
			// Track delivered count per tier so we only ship deltas. Initialised
			// to current backend.size below; the post-restore IIFE updates the
			// restored-from tier so we don't double-write its own data back.
			const delivered = new Map<AppendLogStorageTier<T>, number>();
			for (const t of tiers) delivered.set(t, backend.size);
			// Pre-load: best-effort restore from first tier with loadEntries support.
			void (async () => {
				for (const tier of tiers) {
					if (typeof tier.loadEntries !== "function") continue;
					try {
						const result = await Promise.resolve(tier.loadEntries());
						if (result.entries.length > 0 && backend.size === 0) {
							backend.restore(result.entries);
							// C2: mark restored-from tier as already in sync so
							// the post-restore pushSnapshot doesn't ship the
							// restored block back as a "delta". Other tiers
							// stay at 0 — they'll receive the restored block
							// as a forward write (correct).
							delivered.set(tier, result.entries.length);
							pushSnapshot();
						}
						break;
					} catch {
						/* try next tier */
					}
				}
			})();
			const sub = entries.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] !== DATA) continue;
					const arr = m[1] as readonly T[];
					for (const tier of tiers) {
						const last = delivered.get(tier) ?? 0;
						if (arr.length < last) {
							// M9: length decreased — `trimHead`/`clear` happened.
							// Re-ship the full post-trim snapshot. Append-log
							// tiers should be idempotent (or use `keyOf` to
							// dedupe partition writes); we accept the re-send
							// over silent loss of subsequent appends.
							try {
								const result = tier.appendEntries(arr);
								if (result instanceof Promise) result.catch(() => {});
							} catch {
								/* tier write error swallowed */
							}
							delivered.set(tier, arr.length);
							continue;
						}
						if (arr.length === last) continue;
						const fresh = arr.slice(last);
						delivered.set(tier, arr.length);
						try {
							const result = tier.appendEntries(fresh);
							if (result instanceof Promise) result.catch(() => {});
						} catch {
							/* tier write error swallowed; surface via tier.flush */
						}
					}
				}
			});
			return () => sub();
		},

		scan<TAcc>(initial: TAcc, step: (acc: TAcc, value: T) => TAcc): Node<TAcc> {
			let acc = initial;
			let lastProcessedSize = 0;
			return node<TAcc>([entries], (data, actions) => {
				const arr = data[0] as readonly T[] | null | undefined;
				if (arr == null || arr.length === 0) {
					// Log cleared or empty — reset accumulator.
					acc = initial;
					lastProcessedSize = 0;
					actions.emit(acc);
					return;
				}
				const currentSize = arr.length;
				if (currentSize < lastProcessedSize) {
					// Log was trimmed/cleared — full rescan.
					acc = initial;
					for (let i = 0; i < currentSize; i++) {
						acc = step(acc, arr[i]!);
					}
					lastProcessedSize = currentSize;
				} else {
					// Incremental — apply only new entries.
					for (let i = lastProcessedSize; i < currentSize; i++) {
						acc = step(acc, arr[i]!);
					}
					lastProcessedSize = currentSize;
				}
				actions.emit(acc);
			});
		},

		mutationLog: mutLog,

		disposeAllViews(): void {
			for (const entry of tailCache.values()) entry.dispose();
			tailCache.clear();
			for (const entry of sliceCache.values()) entry.dispose();
			sliceCache.clear();
			for (const entry of cursorCache.values()) entry.dispose();
			cursorCache.clear();
		},

		dispose(): void {
			for (const entry of tailCache.values()) entry.dispose();
			tailCache.clear();
			for (const entry of sliceCache.values()) entry.dispose();
			sliceCache.clear();
			for (const entry of cursorCache.values()) entry.dispose();
			cursorCache.clear();
			if (mutLog) mutLog.dispose();
		},
	};

	return bundle;
}

// ── mergeReactiveLogs ─────────────────────────────────────────────────────

/**
 * Bundle returned by {@link mergeReactiveLogs}. `node` is the merged output;
 * `dispose()` releases the internal subscriptions to all input logs and the
 * keepalive on `node`. After dispose the merge stops responding to inputs
 * but `node`'s last cached value remains queryable.
 *
 * @category extra
 */
export interface MergedReactiveLog<T> {
	readonly node: Node<readonly T[]>;
	dispose(): void;
}

const mergeMemo = new WeakMap<readonly Node<readonly unknown[]>[], MergedReactiveLog<unknown>>();

/**
 * Fan-in helper that merges N reactive logs into a single time-ordered output
 * by concatenation. Returns `{ node, dispose }`. Producer-pattern: subscribes
 * to each input internally; COMPLETE on an input drops it from the active
 * set; ERROR propagates per spec §2.2. Memoized by reference identity on the
 * `logs` array — repeat calls with the same reference return the same bundle.
 *
 * Internal subscriptions are invisible in `describe()` (sanctioned per §24);
 * `explain()` across the merge surfaces only the merged stream. Caller must
 * `dispose()` when done to release subscriptions to input logs (no auto-GC
 * because of the memoization map).
 *
 * @category extra
 */
export function mergeReactiveLogs<T>(logs: readonly Node<readonly T[]>[]): MergedReactiveLog<T> {
	const cached = mergeMemo.get(logs as unknown as readonly Node<readonly unknown[]>[]);
	if (cached) return cached as unknown as MergedReactiveLog<T>;

	const seedSnapshots = logs.map((n) => (n.cache as readonly T[] | undefined) ?? []);
	const initial = seedSnapshots.flat() as readonly T[];

	// Use a producer-pattern derived: we subscribe to inputs internally (not
	// declared as deps) to keep the merge invisible to describe per Audit 1 #4.
	const out = node<readonly T[]>([], {
		initial,
		name: "mergeReactiveLogs",
		describeKind: "state",
		equals: (a, b) => a === b,
	});

	const lastBuckets: T[][] = logs.map((_, i) => [...(seedSnapshots[i] ?? [])]);
	// Per-input subscription handles. `subs[idx] = undefined` after COMPLETE so
	// dispose() iterates only live subscriptions and a stray DATA from an
	// already-completed input is impossible (the sub is gone).
	const subs: Array<(() => void) | undefined> = [];
	for (let i = 0; i < logs.length; i++) {
		const idx = i;
		const sub = logs[idx]!.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					lastBuckets[idx] = [...(m[1] as readonly T[])];
					out.emit(lastBuckets.flat());
				} else if (m[0] === COMPLETE) {
					// Drop the input from the active set: clear its bucket AND
					// release the subscription so any post-COMPLETE DATA from
					// the (misbehaving) input cannot reach the merged stream.
					lastBuckets[idx] = [];
					const u = subs[idx];
					if (u !== undefined) {
						subs[idx] = undefined;
						u();
					}
				} else if (m[0] === ERROR) {
					out.down([[ERROR, m[1]]]);
				}
			}
		});
		subs.push(sub);
	}
	const keepDispose = keepalive(out);

	let disposed = false;
	const bundle: MergedReactiveLog<T> = {
		node: out as Node<readonly T[]>,
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const u of subs) u?.();
			subs.length = 0;
			keepDispose();
			mergeMemo.delete(logs as unknown as readonly Node<readonly unknown[]>[]);
		},
	};

	mergeMemo.set(
		logs as unknown as readonly Node<readonly unknown[]>[],
		bundle as MergedReactiveLog<unknown>,
	);
	return bundle;
}
