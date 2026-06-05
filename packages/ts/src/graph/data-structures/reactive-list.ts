/**
 * Reactive positional list (CSP-2.8, D54/D60) — the two-port collection template.
 *
 * Shape (D60 + review #2): a mutable array BACKEND (the single materialized state) + the shared
 * {@link collectionCore} two ports — a DELTA stream ({@link ReactiveList.delta}, one event per
 * mutation, O(1)) and a lazy pull SNAPSHOT ({@link ReactiveList.snapshot}, materialized only on a
 * cone-routed RESUME demand). Mutation input is D54 A3 hybrid: ergonomic imperative methods (the
 * external boundary, state-verb-legitimate, D4) + `appendFrom(src)` widening (an in-graph producer
 * drives the list with zero imperative glue). Synchronous quick-reads (`at`/`size`/`toArray`) are
 * the deliberately-non-reactive peek for cold/imperative reads (D60).
 *
 * Per-language (D6/D24, never in parity, no conformance — the substrate pull is already C-16).
 */

import { type Ctx, depBatch, depCount, depLatest } from "../../ctx/types.js";
import { Node } from "../../node/node.js";
import { errorPayload } from "../../protocol/messages.js";
import type { Operator } from "../operators.js";
import { trimHeadOverflow } from "../policies/collection.js";
import type { ReactiveOpt } from "../policies/types.js";
import type { ListChange } from "./change.js";
import { type CollectionCore, type CollectionCoreOptions, collectionCore } from "./core.js";

export type ReactiveListOpt<T> = ReactiveOpt<T>;

export interface ReactiveListOptions extends CollectionCoreOptions {
	/**
	 * Head-trim capacity policy (D72). A static number caps the list locally; a Node-valued maxSize
	 * must be graph-bound and becomes a declared policy dep that trims on policy changes.
	 */
	maxSize?: ReactiveListOpt<number>;
}

export interface ReactiveList<T> {
	/** DELTA stream: one {@link ListChange} per mutation (O(1)). Subscribe to observe events. */
	readonly delta: Node<ListChange<T>>;
	/** SNAPSHOT pull node: demand via `ctx.upNext([[RESUME, pullId]])` → one `readonly T[]` (lazy O(n)). */
	readonly snapshot: Node<readonly T[]>;
	/** The snapshot node's pullId — write it verbatim into the demander's fn (D59). */
	readonly pullId: symbol;
	/** Current entry count (O(1), synchronous non-reactive read). */
	readonly size: number;
	/** Positional access (O(1)); negative indices Python-style; `undefined` out of range. Sync read. */
	at(index: number): T | undefined;
	/** Full current contents (O(n), fresh defensive copy). Sync non-reactive read (cold-start peek). */
	toArray(): readonly T[];
	append(value: T): void;
	/** Append all values; one delta event + one snapshot-arm. No-op if `values` is empty. */
	appendMany(values: readonly T[]): void;
	/** Insert at `index` (0..size). Throws `RangeError` out of range. */
	insert(index: number, value: T): void;
	/** Insert all at `index` as one op. No-op if `values` is empty. Throws out of range. */
	insertMany(index: number, values: readonly T[]): void;
	/** Remove and return the value at `index` (default last; negative Python-style). Throws if empty/out of range. */
	pop(index?: number): T;
	clear(): void;
	/** D54 widening: every value from `src` is appended. Returns a disposer. */
	appendFrom(src: Node<T>): () => void;
	/** Release the widening subscriptions (idempotent). */
	dispose(): void;
}

/** Default mutable-array backend (D60 first-cut; pluggable persistent/immutable backend deferred). */
class ListBackend<T> {
	private _version = 0;
	private readonly buf: T[];

	constructor(initial?: readonly T[], maxSize?: number) {
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
		this._version += 1;
	}

	appendMany(values: readonly T[]): void {
		if (values.length === 0) return;
		for (const v of values) this.buf.push(v);
		this._version += 1;
	}

	insert(index: number, value: T): void {
		if (!Number.isInteger(index) || index < 0 || index > this.buf.length)
			throw new RangeError(`insert: index ${index} out of range [0, ${this.buf.length}]`);
		this.buf.splice(index, 0, value);
		this._version += 1;
	}

	insertMany(index: number, values: readonly T[]): void {
		if (!Number.isInteger(index) || index < 0 || index > this.buf.length)
			throw new RangeError(`insertMany: index ${index} out of range [0, ${this.buf.length}]`);
		if (values.length === 0) return;
		this.buf.splice(index, 0, ...values);
		this._version += 1;
	}

	pop(index: number): T {
		if (this.buf.length === 0) throw new RangeError("pop from empty list");
		if (!Number.isInteger(index)) throw new RangeError(`pop: index ${index} must be an integer`);
		const i = index >= 0 ? index : this.buf.length + index;
		if (i < 0 || i >= this.buf.length) throw new RangeError(`pop: index ${index} out of range`);
		const [v] = this.buf.splice(i, 1);
		this._version += 1;
		return v as T;
	}

	clear(): number {
		const n = this.buf.length;
		if (n === 0) return 0;
		this.buf.length = 0;
		this._version += 1;
		return n;
	}

	enforceMaxSize(maxSize?: number): number {
		const removed = trimHeadOverflow(this.buf, { maxSize }).length;
		if (removed > 0) this._version += 1;
		return removed;
	}
}

/**
 * Create a reactive list (D54/D60). The DELTA + SNAPSHOT ports + pullId come from the shared
 * {@link collectionCore}; this layer adds the typed list method surface + backend.
 *
 * @example
 * ```ts
 * const list = reactiveList<number>([1]);
 * // observe events:
 * list.delta.subscribe((m) => { if (m[0] === "DATA") console.log("Δ", m[1]); });
 * list.append(2);                 // delta: {kind:"append", value:2}
 * // demand the snapshot (a downstream consumer, holding `list.snapshot` upstream, runs):
 * //   ctx.upNext([["RESUME", list.pullId]]);  → SNAPSHOT delivers [1, 2]
 * list.toArray();                 // [1, 2]   (synchronous non-reactive read)
 * ```
 */
export function reactiveList<T>(
	initial?: readonly T[],
	options: ReactiveListOptions = {},
): ReactiveList<T> {
	const { maxSize, graph, dispatcher } = options;
	const base = dispatcher ? { dispatcher } : {};

	function isNodeOpt(x: ReactiveListOpt<number> | undefined): x is Node<number> {
		return x instanceof Node;
	}

	function validateMaxSize(v: number): number {
		if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1)
			throw new RangeError(`reactiveList: maxSize must be a positive integer (got ${v})`);
		return v;
	}

	const initialMaxSize = isNodeOpt(maxSize) ? undefined : maxSize;
	const backend = new ListBackend<T>(
		initial,
		initialMaxSize === undefined ? undefined : validateMaxSize(initialMaxSize),
	);
	const core: CollectionCore<readonly T[], ListChange<T>> = collectionCore(
		backend,
		"reactiveList",
		options,
	);
	const binds: Array<() => void> = [];
	const bindDeps = new WeakSet<Node<unknown>>();
	let bindSeq = 0;
	let capacityPolicy: Node<number> | undefined;
	let apply: Node<ListChange<T>> | undefined;
	let releaseApply = () => {};
	let currentMaxSize = initialMaxSize;

	function emitTrimmed(n: number): void {
		if (n > 0) core.emit({ kind: "trimHead", n });
	}

	function enforceCapacity(): void {
		emitTrimmed(backend.enforceMaxSize(currentMaxSize));
	}

	const applyBody = (ctx: Ctx): void => {
		const deps = apply?.deps ?? [];
		for (let i = 0; i < depCount(ctx); i++) {
			const dep = deps[i];
			if (dep === capacityPolicy) {
				const latest = depLatest(ctx, i);
				if (latest !== undefined) currentMaxSize = validateMaxSize(latest as number);
				continue;
			}
			if (dep && bindDeps.has(dep)) {
				for (const value of (depBatch(ctx, i) ?? []) as readonly T[]) {
					backend.append(value);
					core.emit({ kind: "append", value });
					enforceCapacity();
				}
			}
		}
		enforceCapacity();
	};

	function ensureApply(): Node<ListChange<T>> {
		if (apply !== undefined) return apply;
		const op: Operator<unknown, ListChange<T>> = {
			factory: "reactiveList.capacityPolicy",
			body: applyBody,
			opts: { partial: true },
		};
		const deps = capacityPolicy ? [capacityPolicy as Node<unknown>] : [];
		apply = graph
			? graph.initNode(op, deps, {
					name: options.name ? `${options.name}.capacityPolicy` : undefined,
					meta: { kind: "collection_policy_apply", collection: "reactiveList" },
				})
			: new Node<ListChange<T>>(deps, op.body, {
					...base,
					factory: "reactiveList.capacityPolicy",
					partial: true,
					name: options.name ? `${options.name}.capacityPolicy` : undefined,
				});
		releaseApply = graph
			? graph.retain(apply, { reason: "reactiveList.capacityPolicy" })
			: apply.subscribe(() => {});
		return apply;
	}

	function constPolicyNode(value: number): Node<number> {
		const op: Operator<never, number> = {
			factory: "reactiveList.maxSizePolicy",
			body: () => {},
			opts: { initial: value },
		};
		if (graph) {
			return graph.initNode(op, [], {
				name: options.name ? `${options.name}.maxSizePolicy` : undefined,
				meta: { kind: "collection_policy", collection: "reactiveList", policy: "maxSize" },
			});
		}
		return new Node<number>([], null, {
			...base,
			initial: value,
			factory: "reactiveList.maxSizePolicy",
			name: options.name ? `${options.name}.maxSizePolicy` : undefined,
		});
	}

	if (maxSize !== undefined) {
		if (isNodeOpt(maxSize) && graph === undefined)
			throw new Error(
				"reactiveList maxSize Node option requires options.graph so the policy edge is describe-visible (D72)",
			);
		capacityPolicy = isNodeOpt(maxSize)
			? maxSize
			: graph
				? constPolicyNode(validateMaxSize(maxSize))
				: undefined;
		if (capacityPolicy !== undefined) ensureApply();
	}

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
			backend.append(value);
			core.emit({ kind: "append", value });
			enforceCapacity();
		},
		appendMany(values: readonly T[]): void {
			if (values.length === 0) return;
			const copy = [...values];
			backend.appendMany(copy);
			core.emit({ kind: "appendMany", values: copy });
			enforceCapacity();
		},
		insert(index: number, value: T): void {
			backend.insert(index, value);
			core.emit({ kind: "insert", index, value });
			enforceCapacity();
		},
		insertMany(index: number, values: readonly T[]): void {
			if (values.length === 0) {
				// still validate the index (mirror backend) so an out-of-range empty insert throws
				backend.insertMany(index, values);
				return;
			}
			const copy = [...values];
			backend.insertMany(index, copy);
			core.emit({ kind: "insertMany", index, values: copy });
			enforceCapacity();
		},
		pop(index = -1): T {
			const resolved = index < 0 ? backend.size + index : index;
			const value = backend.pop(index);
			core.emit({ kind: "pop", index: resolved, value });
			return value;
		},
		clear(): void {
			const count = backend.clear();
			if (count > 0) core.emit({ kind: "clear", count });
		},

		appendFrom(src: Node<T>): () => void {
			if (graph === undefined)
				throw new Error(
					"reactiveList.appendFrom requires options.graph so the input fold is describe-visible (D61)",
				);
			const op: Operator<T, T> = {
				factory: "reactiveList.bindSource",
				body: (ctx: Ctx) => {
					try {
						for (const value of (depBatch(ctx, 0) ?? []) as readonly T[]) {
							ctx.down([["DATA", value]]);
						}
					} catch (e) {
						ctx.down([["ERROR", errorPayload(e, "reactiveList.bindSource failed")]]);
					}
				},
			};
			const folder = graph.initNode(op, [src], {
				name: options.name ? `${options.name}.bind#${bindSeq++}` : undefined,
				meta: { kind: "collection_bind_source", collection: "reactiveList" },
			});
			bindDeps.add(folder as Node<unknown>);
			const applyNode = ensureApply();
			applyNode.subscribeDep(folder as Node<unknown>, applyBody);
			let active = true;
			const dispose = () => {
				if (!active) return;
				active = false;
				applyNode.unsubscribeDep(folder as Node<unknown>, applyBody);
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
