/**
 * Reactive append-only log (CSP-2.8, D54/D60) — two-port collection with incremental views.
 *
 * Shape = the shared {@link collectionCore} two ports over an array (or ring-buffer if `maxSize`)
 * BACKEND (D60). Specializations (D60 #5 / review #5):
 *   - SNAPSHOT (the full `readonly T[]`) is the lazy pull port like the others, BUT the log's main
 *     consumption is INCREMENTAL: `tail()` / `slice()` / `scan()` re-derive on the DELTA backbone
 *     (dep=[delta]), folding each appended value as it arrives — NOT re-scanning a pushed full array.
 *   - `append(undefined)` throws: `undefined` is the substrate SENTINEL (R-data-payload / R-sentinel),
 *     not a valid value.
 *   - empty log: the snapshot is `[]` (a real empty array); a never-appended `scan` seeds its initial.
 *     There is NO `[[RESOLVED]]`-for-empty dual role (D49 narrowed RESOLVED to undirty-only, D60 #5b).
 *   - `attach(upstream)` = the D54 widening (a declared input-fold dep), NOT an imperative subscribe.
 *   - {@link mergeReactiveLogs} is a DECLARED-DEP merge (deps=[...delta streams]), NOT the old
 *     internal-subscribe island (D45 must-fix, D60 #5e).
 *   - storage persistence = D57 (binding-layer observe-sink), out of scope here.
 *
 * Per-language (D6/D24, never in parity, no conformance — the substrate pull is already C-16).
 */

import { type Ctx, depBatch, depCount } from "../../ctx/types.js";
import { type Node, node } from "../../node/node.js";
import { trimHeadOverflow } from "../policies/collection.js";
import type { LogChange } from "./change.js";
import { type CollectionCore, type CollectionCoreOptions, collectionCore } from "./core.js";

export interface ReactiveLogOptions extends CollectionCoreOptions {
	/** Ring-buffer cap: appends past `maxSize` evict the oldest (head-trim, append-only-safe). */
	maxSize?: number;
}

export interface ReactiveLog<T> {
	readonly delta: Node<LogChange<T>>;
	/** SNAPSHOT pull node: demand → full `readonly T[]` (lazy O(n)). For incremental use {@link tail}, {@link slice}, or {@link scan}. */
	readonly snapshot: Node<readonly T[]>;
	readonly pullId: symbol;
	/** Entry count (O(1)). Sync non-reactive read. */
	readonly size: number;
	/** Positional access (O(1)); negative Python-style; `undefined` out of range. Sync read. */
	at(index: number): T | undefined;
	/** Full contents (O(n) fresh copy). Sync non-reactive read (cold-start peek). */
	toArray(): readonly T[];
	/** Append one value. Throws on `undefined` (substrate SENTINEL, R-data-payload). */
	append(value: T): void;
	/** Append many; one delta event. No-op if empty. Throws if any value is `undefined`. */
	appendMany(values: readonly T[]): void;
	clear(): void;
	/** Remove the first `n` entries (clamped to size). */
	trimHead(n: number): void;
	/**
	 * Incremental tail view: a derived node emitting the last `n` entries, recomputed on each delta
	 * (dep=[delta], D60 #5a). Memoized per `n` until {@link dispose}; use stable ranges for
	 * long-lived logs. Subscribe to keep it live.
	 */
	tail(n: number): Node<readonly T[]>;
	/**
	 * Incremental positional view: a derived node emitting `toArray().slice(start, stop)`,
	 * recomputed on each delta (dep=[delta], D60 #5a). Memoized per `[start, stop]` until
	 * {@link dispose}; use stable ranges for long-lived logs.
	 */
	slice(start: number, stop?: number): Node<readonly T[]>;
	/**
	 * Incremental running aggregate over appended values (dep=[delta], D60 #5a). O(1) per append —
	 * folds only the new values each delta; resets on `clear`/`trimHead` (a non-append delta) via a
	 * full re-fold. Emits the current accumulator on every mutation; seeds `initial` on an empty log.
	 */
	scan<A>(initial: A, step: (acc: A, value: T) => A): Node<A>;
	/** D54 widening: every value from `src` is appended. Returns a disposer. */
	attach(src: Node<T>): () => void;
	dispose(): void;
}

/** Default array / ring-buffer backend (D60 first-cut; persistent backend deferred). */
class LogBackend<T> {
	private _version = 0;
	private buf: T[];
	private readonly maxSize?: number;

	constructor(initial?: readonly T[], maxSize?: number) {
		if (maxSize !== undefined && maxSize < 1)
			throw new RangeError("reactiveLog: maxSize must be >= 1");
		this.maxSize = maxSize;
		this.buf = initial ? [...initial] : [];
		trimHeadOverflow(this.buf, { maxSize });
	}

	get version(): number {
		return this._version;
	}
	get size(): number {
		return this.buf.length;
	}
	at(index: number): T | undefined {
		if (!Number.isInteger(index)) return undefined;
		const i = index >= 0 ? index : this.buf.length + index;
		return i < 0 || i >= this.buf.length ? undefined : this.buf[i];
	}
	snapshot(): readonly T[] {
		return [...this.buf];
	}

	append(value: T): void {
		this.buf.push(value);
		trimHeadOverflow(this.buf, { maxSize: this.maxSize });
		this._version += 1;
	}
	appendMany(values: readonly T[]): void {
		if (values.length === 0) return;
		for (const v of values) this.buf.push(v);
		trimHeadOverflow(this.buf, { maxSize: this.maxSize });
		this._version += 1;
	}
	clear(): number {
		const n = this.buf.length;
		if (n === 0) return 0;
		this.buf.length = 0;
		this._version += 1;
		return n;
	}
	trimHead(n: number): number {
		if (!Number.isInteger(n) || n < 0)
			throw new RangeError(`trimHead: n must be a non-negative integer (got ${n})`);
		if (n === 0 || this.buf.length === 0) return 0;
		const removed = Math.min(n, this.buf.length);
		this.buf.splice(0, removed);
		this._version += 1;
		return removed;
	}
}

function rejectUndefined<T>(value: T, ctx: string): void {
	// R-data-payload / R-sentinel (D60 #5): undefined is the substrate SENTINEL, not a valid value.
	if (value === undefined)
		throw new TypeError(
			`${ctx}: undefined is the substrate SENTINEL, not a valid value — use null`,
		);
}

/**
 * Create an append-only reactive log (D54/D60). DELTA + lazy pull SNAPSHOT + pullId via
 * {@link collectionCore}; this layer adds the typed append surface + incremental view/scan.
 */
export function reactiveLog<T>(
	initial?: readonly T[],
	options: ReactiveLogOptions = {},
): ReactiveLog<T> {
	const { maxSize, ...coreOpts } = options;
	const base = coreOpts.dispatcher ? { dispatcher: coreOpts.dispatcher } : {};
	const backend = new LogBackend<T>(initial, maxSize);
	const core: CollectionCore<readonly T[], LogChange<T>> = collectionCore(
		backend,
		"reactiveLog",
		coreOpts,
	);
	const binds: Array<() => void> = [];
	const tailMemo = new Map<number, Node<readonly T[]>>();
	const sliceMemo = new Map<string, Node<readonly T[]>>();

	return {
		delta: core.delta,
		snapshot: core.snapshot,
		pullId: core.pullId,

		get size(): number {
			return backend.size;
		},
		at(index: number): T | undefined {
			return backend.at(index);
		},
		toArray(): readonly T[] {
			return backend.snapshot();
		},

		append(value: T): void {
			rejectUndefined(value, "reactiveLog.append");
			backend.append(value);
			core.emit({ kind: "append", value });
		},
		appendMany(values: readonly T[]): void {
			if (values.length === 0) return;
			for (const v of values) rejectUndefined(v, "reactiveLog.appendMany");
			const copy = [...values];
			backend.appendMany(copy);
			core.emit({ kind: "appendMany", values: copy });
		},
		clear(): void {
			const count = backend.clear();
			if (count > 0) core.emit({ kind: "clear", count });
		},
		trimHead(n: number): void {
			const removed = backend.trimHead(n);
			if (removed > 0) core.emit({ kind: "trimHead", n: removed });
		},

		tail(n: number): Node<readonly T[]> {
			if (!Number.isInteger(n) || n < 0)
				throw new RangeError(`tail: n must be a non-negative integer (got ${n})`);
			const hit = tailMemo.get(n);
			if (hit !== undefined) return hit;
			// Incremental on the DELTA backbone (D60 #5a): each delta re-reads the backend's current
			// tail (the backend is this structure's own materialized state, D60 #1 — not a foreign
			// .cache peek). `partial:true` — the tail does not consume the delta value, it fires on arm.
			const tnode = node<readonly T[]>(
				[core.delta as Node<unknown>],
				(ctx: Ctx) => {
					const all = backend.snapshot();
					ctx.down([["DATA", n === 0 ? [] : all.slice(Math.max(0, all.length - n))]]);
				},
				{ ...base, factory: "reactiveLog.tail", partial: true },
			);
			tailMemo.set(n, tnode);
			return tnode;
		},

		slice(start: number, stop?: number): Node<readonly T[]> {
			if (!Number.isInteger(start) || start < 0) {
				throw new RangeError(`slice: start must be a non-negative integer (got ${start})`);
			}
			if (stop !== undefined && (!Number.isInteger(stop) || stop < 0)) {
				throw new RangeError(`slice: stop must be a non-negative integer (got ${stop})`);
			}
			const key = `${start}:${stop ?? ""}`;
			const hit = sliceMemo.get(key);
			if (hit !== undefined) return hit;
			// Incremental on the DELTA backbone (D60 #5a): each delta re-reads this log's own
			// backend slice. The backend is the single materialized state (D60), not a dep cache.
			const snode = node<readonly T[]>(
				[core.delta as Node<unknown>],
				(ctx: Ctx) => {
					ctx.down([["DATA", backend.snapshot().slice(start, stop)]]);
				},
				{ ...base, factory: "reactiveLog.slice", partial: true },
			);
			sliceMemo.set(key, snode);
			return snode;
		},

		scan<A>(initial: A, step: (acc: A, value: T) => A): Node<A> {
			// Incremental fold on the delta backbone: keep the accumulator + processed-count in
			// ctx.state; fold only the new tail each append; full re-fold on a shrink (clear/trimHead).
			return node<A>(
				[core.delta as Node<unknown>],
				(ctx: Ctx) => {
					const st = ctx.state.get<{ acc: A; processed: number }>() ?? {
						acc: initial,
						processed: 0,
					};
					const all = backend.snapshot();
					if (all.length < st.processed || (maxSize !== undefined && all.length <= st.processed)) {
						// Shrink or ring-buffer overwrite: re-fold from the current backend snapshot.
						let acc = initial;
						for (const v of all) acc = step(acc, v);
						st.acc = acc;
						st.processed = all.length;
					} else {
						for (let i = st.processed; i < all.length; i++) st.acc = step(st.acc, all[i] as T);
						st.processed = all.length;
					}
					ctx.state.set(st);
					ctx.down([["DATA", st.acc]]);
				},
				{ ...base, factory: "reactiveLog.scan", partial: true },
			);
		},

		attach(src: Node<T>): () => void {
			const dispose = core.bindSource(src, (value: T) => {
				rejectUndefined(value, "reactiveLog.attach");
				backend.append(value);
				core.emit({ kind: "append", value });
			});
			binds.push(dispose);
			return dispose;
		},
		dispose(): void {
			for (const d of binds) d();
			binds.length = 0;
			tailMemo.clear();
			sliceMemo.clear();
		},
	};
}

/**
 * Fan-in N reactive logs into one merged DELTA stream (D60 #5e — a DECLARED-DEP merge, NOT the old
 * internal-subscribe island). The returned node declares each log's `delta` as a dep (`partial`)
 * and re-emits every change it sees — describe shows `log[i].delta → merged` truthfully (D45).
 * For the merged SNAPSHOT, fold the merged delta with {@link ReactiveLog.scan}-style logic, or
 * demand each source's snapshot independently.
 */
export function mergeReactiveLogs<T>(logs: readonly ReactiveLog<T>[]): Node<LogChange<T>> {
	const deps = logs.map((l) => l.delta as Node<unknown>);
	return node<LogChange<T>>(
		deps,
		(ctx: Ctx) => {
			for (let i = 0; i < depCount(ctx); i++) {
				const b = depBatch(ctx, i);
				if (b) for (const c of b) ctx.down([["DATA", c as LogChange<T>]]);
			}
		},
		{ factory: "mergeReactiveLogs", partial: true },
	);
}

/**
 * Standalone incremental scan over a reactive log. Equivalent to `log.scan(initial, step)`;
 * provided for pipe-builder and helper-composition call sites.
 */
export function scanLog<T, A>(
	log: ReactiveLog<T>,
	initial: A,
	step: (acc: A, value: T) => A,
): Node<A> {
	return log.scan(initial, step);
}
