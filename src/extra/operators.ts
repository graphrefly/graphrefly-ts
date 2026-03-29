/**
 * Tier 1 sync operators (roadmap §2.1) and Tier 2 async/dynamic operators (roadmap §2.2) —
 * each returns a {@link Node} built with {@link node} (or {@link producer} for cold sources).
 */
import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	type Message,
	type Messages,
	PAUSE,
	RESOLVED,
	RESUME,
} from "../core/messages.js";
import { type Node, type NodeActions, type NodeOptions, node } from "../core/node.js";
import { derived, producer } from "../core/sugar.js";

type ExtraOpts = Omit<NodeOptions, "describeKind">;

function operatorOpts(opts?: ExtraOpts): NodeOptions {
	return { describeKind: "operator", ...opts };
}

/**
 * Maps each settled value from `source` through `project`.
 *
 * @param source - Upstream node.
 * @param project - Transform for each value.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<R>` - Derived node emitting mapped values.
 *
 * @example
 * ```ts
 * import { map, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = map(state(2), (x) => x * 3);
 * ```
 *
 * @category extra
 */
export function map<T, R>(source: Node<T>, project: (value: T) => R, opts?: ExtraOpts): Node<R> {
	return derived([source as Node], ([v]) => project(v as T), operatorOpts(opts));
}

/**
 * Forwards values that satisfy `predicate`; otherwise emits `RESOLVED` with no `DATA` (two-phase semantics).
 *
 * @param source - Upstream node.
 * @param predicate - Inclusion test.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Filtered node.
 *
 * @example
 * ```ts
 * import { filter, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = filter(state(1), (x) => x > 0);
 * ```
 *
 * @category extra
 */
export function filter<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T> {
	return node<T>(
		[source as Node],
		([v], a) => {
			if (predicate(v as T)) return v as T;
			a.down([[RESOLVED]]);
			return undefined;
		},
		operatorOpts(opts),
	);
}

/**
 * Folds each upstream value into an accumulator; emits the new accumulator every time.
 *
 * @param source - Upstream node.
 * @param reducer - `(acc, value) => nextAcc`.
 * @param seed - Initial accumulator.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<R>` - Scan node.
 *
 * @example
 * ```ts
 * import { scan, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = scan(state(1), (a, x) => a + x, 0);
 * ```
 *
 * @category extra
 */
export function scan<T, R>(
	source: Node<T>,
	reducer: (acc: R, value: T) => R,
	seed: R,
	opts?: ExtraOpts,
): Node<R> {
	let acc = seed;
	return node<R>(
		[source as Node],
		([v]) => {
			acc = reducer(acc, v as T);
			return acc;
		},
		{ ...operatorOpts(opts), initial: seed, resetOnTeardown: true },
	);
}

/**
 * Reduces to one value emitted when `source` completes; if no `DATA` arrived, emits `seed`.
 *
 * @param source - Upstream node.
 * @param reducer - `(acc, value) => nextAcc`.
 * @param seed - Empty-completion default and initial accumulator.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<R>` - Node that emits once on completion.
 *
 * @example
 * ```ts
 * import { reduce, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = reduce(state(1), (a, x) => a + x, 0);
 * ```
 *
 * @category extra
 */
export function reduce<T, R>(
	source: Node<T>,
	reducer: (acc: R, value: T) => R,
	seed: R,
	opts?: ExtraOpts,
): Node<R> {
	let acc = seed;
	let sawData = false;
	return node<R>(
		[source as Node],
		([v]) => {
			sawData = true;
			acc = reducer(acc, v as T);
			return undefined;
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			onMessage(msg: Message, _i: number, a) {
				if (msg[0] === COMPLETE) {
					if (!sawData) acc = seed;
					a.emit(acc);
					a.down([[COMPLETE]]);
					return true;
				}
				return false;
			},
		},
	);
}

/**
 * Emits at most `count` **`DATA`** values, then **`COMPLETE`**. `RESOLVED` does not advance the counter.
 *
 * @param source - Upstream node.
 * @param count - Maximum `DATA` emissions (≤0 completes immediately).
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Limited stream.
 *
 * @example
 * ```ts
 * import { take, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = take(state(0), 3);
 * ```
 *
 * @category extra
 */
export function take<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T> {
	if (count <= 0) {
		return node<T>(
			[source as Node],
			(_d, a) => {
				a.down([[COMPLETE]]);
				return undefined;
			},
			{
				...operatorOpts(opts),
				completeWhenDepsComplete: false,
				onMessage(msg, _i, a) {
					if (msg[0] === COMPLETE) {
						a.down([[COMPLETE]]);
					}
					return true;
				},
			},
		);
	}
	let taken = 0;
	let done = false;
	return node<T>(
		[source as Node],
		([v]) => {
			if (done) return undefined;
			return v as T;
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			onMessage(msg, _i, a) {
				if (msg[0] === DIRTY) return false;
				if (done) {
					return true;
				}
				if (msg[0] === DATA) {
					taken += 1;
					if (taken >= count) {
						done = true;
						a.emit(source.get() as T);
						a.down([[COMPLETE]]);
						return true;
					}
					return false;
				}
				if (msg[0] === RESOLVED) {
					return false;
				}
				if (msg[0] === COMPLETE) {
					done = true;
					a.down([[COMPLETE]]);
					return true;
				}
				if (msg[0] === ERROR) {
					a.down([msg]);
					return true;
				}
				a.down([msg]);
				return true;
			},
		},
	);
}

/**
 * Skips the first `count` **`DATA`** emissions. `RESOLVED` does not advance the counter.
 *
 * @param source - Upstream node.
 * @param count - Number of `DATA` values to drop.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Skipped stream.
 *
 * @example
 * ```ts
 * import { skip, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = skip(state(0), 2);
 * ```
 *
 * @category extra
 */
export function skip<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T> {
	let skipped = 0;
	return node<T>([source as Node], () => undefined, {
		...operatorOpts(opts),
		onMessage(msg, _i, a) {
			const t = msg[0];
			if (t === DIRTY) {
				a.down([[DIRTY]]);
				return true;
			}
			if (t === RESOLVED) {
				a.down([[RESOLVED]]);
				return true;
			}
			if (t === DATA) {
				skipped += 1;
				if (skipped <= count) {
					a.down([[RESOLVED]]);
				} else {
					a.emit(msg[1]);
				}
				return true;
			}
			return false;
		},
	});
}

/**
 * Emits while `predicate` holds; on first false, sends **`COMPLETE`**.
 *
 * @param source - Upstream node.
 * @param predicate - Continuation test.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Truncated stream.
 *
 * @example
 * ```ts
 * import { takeWhile, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = takeWhile(state(1), (x) => x < 10);
 * ```
 *
 * @category extra
 */
export function takeWhile<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T> {
	let done = false;
	return node<T>(
		[source as Node],
		([v], a) => {
			if (done) return undefined;
			if (!predicate(v as T)) {
				done = true;
				a.down([[COMPLETE]]);
				return undefined;
			}
			return v as T;
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			onMessage(msg, _i, a) {
				if (done) {
					if (msg[0] === COMPLETE) {
						a.down([[COMPLETE]]);
					}
					return true;
				}
				return false;
			},
		},
	);
}

/**
 * Forwards `source` until `notifier` matches `predicate` (default: notifier **`DATA`**), then **`COMPLETE`**.
 *
 * @param source - Main upstream.
 * @param notifier - Triggers completion when `predicate(msg)` is true.
 * @param opts - Optional {@link NodeOptions}, plus `predicate` for custom notifier matching.
 * @returns `Node<T>` - Truncated stream.
 *
 * @example
 * ```ts
 * import { producer, takeUntil, state } from "@graphrefly/graphrefly-ts";
 *
 * const src = state(1);
 * const stop = producer((_d, a) => a.emit(undefined));
 * const n = takeUntil(src, stop);
 * ```
 *
 * @category extra
 */
export function takeUntil<T>(
	source: Node<T>,
	notifier: Node,
	opts?: ExtraOpts & { predicate?: (msg: Message) => boolean },
): Node<T> {
	const pred = opts?.predicate ?? ((m: Message) => m[0] === DATA);
	const { predicate: _, ...restOpts } = opts ?? {};
	let stopped = false;
	return node<T>(
		[source as Node, notifier],
		([v]) => {
			if (stopped) return undefined;
			return v as T;
		},
		{
			...operatorOpts(restOpts as ExtraOpts),
			completeWhenDepsComplete: false,
			onMessage(msg, i, a) {
				if (stopped) {
					if (msg[0] === COMPLETE) {
						a.down([[COMPLETE]]);
					}
					return true;
				}
				if (i === 1) {
					if (pred(msg)) {
						stopped = true;
						a.down([[COMPLETE]]);
						return true;
					}
					return true;
				}
				return false;
			},
		},
	);
}

/**
 * Emits the first **`DATA`** then **`COMPLETE`** (same as `take(source, 1)`).
 *
 * @param source - Upstream node.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Single-value stream.
 *
 * @example
 * ```ts
 * import { first, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = first(state(42));
 * ```
 *
 * @category extra
 */
export function first<T>(source: Node<T>, opts?: ExtraOpts): Node<T> {
	return take(source, 1, opts);
}

/**
 * Buffers values and emits the last **`DATA`** on **`COMPLETE`**; optional `defaultValue` if none arrived.
 *
 * @param source - Upstream node.
 * @param options - Optional {@link NodeOptions} and `defaultValue` when empty.
 * @returns `Node<T>` - Last-or-default node.
 *
 * @example
 * ```ts
 * import { last, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = last(state(1), { defaultValue: 0 });
 * ```
 *
 * @category extra
 */
export function last<T>(source: Node<T>, options?: ExtraOpts & { defaultValue?: T }): Node<T> {
	const { defaultValue, ...rest } = options ?? {};
	const useDefault = options != null && Object.hasOwn(options, "defaultValue");
	let lastVal: T | undefined;
	let has = false;
	return node<T>(
		[source as Node],
		([v]) => {
			lastVal = v as T;
			has = true;
			return undefined;
		},
		{
			...operatorOpts(rest),
			completeWhenDepsComplete: false,
			onMessage(msg, _i, a) {
				if (msg[0] === COMPLETE) {
					if (has) {
						a.emit(lastVal as T);
					} else if (useDefault) {
						a.emit(defaultValue as T);
					}
					a.down([[COMPLETE]]);
					return true;
				}
				return false;
			},
		},
	);
}

/**
 * Emits the first value matching `predicate`, then **`COMPLETE`**.
 *
 * @param source - Upstream node.
 * @param predicate - Match test.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - First-match stream.
 *
 * @example
 * ```ts
 * import { find, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = find(state(1), (x) => x > 0);
 * ```
 *
 * @category extra
 */
export function find<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T> {
	return take(filter(source, predicate, opts), 1, opts);
}

/**
 * Emits the `index`th **`DATA`** (zero-based), then **`COMPLETE`**.
 *
 * @param source - Upstream node.
 * @param index - Zero-based emission index.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Single indexed value.
 *
 * @example
 * ```ts
 * import { elementAt, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = elementAt(state(0), 2);
 * ```
 *
 * @category extra
 */
export function elementAt<T>(source: Node<T>, index: number, opts?: ExtraOpts): Node<T> {
	return take(skip(source, index, opts), 1, opts);
}

/**
 * Prepends `initial` as **`DATA`**, then forwards every value from `source`.
 *
 * @param source - Upstream node.
 * @param initial - Value emitted before upstream.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Prefixed stream.
 *
 * @example
 * ```ts
 * import { startWith, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = startWith(state(2), 0);
 * ```
 *
 * @category extra
 */
export function startWith<T>(source: Node<T>, initial: T, opts?: ExtraOpts): Node<T> {
	let prepended = false;
	return node<T>(
		[source as Node],
		([v], a) => {
			if (!prepended) {
				prepended = true;
				a.emit(initial);
			}
			a.emit(v as T);
			return undefined;
		},
		operatorOpts(opts),
	);
}

/**
 * Invokes `fn` for side effects; values pass through unchanged.
 *
 * @param source - Upstream node.
 * @param fn - Side effect per value.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Passthrough node.
 *
 * @example
 * ```ts
 * import { tap, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = tap(state(1), (x) => console.log(x));
 * ```
 *
 * @category extra
 */
export function tap<T>(source: Node<T>, fn: (value: T) => void, opts?: ExtraOpts): Node<T> {
	return derived(
		[source as Node],
		([v]) => {
			fn(v as T);
			return v as T;
		},
		operatorOpts(opts),
	);
}

/**
 * Suppresses adjacent duplicates using `equals` (default `Object.is`).
 *
 * @param source - Upstream node.
 * @param equals - Optional equality for consecutive values.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Deduped stream.
 *
 * @example
 * ```ts
 * import { distinctUntilChanged, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = distinctUntilChanged(state(1));
 * ```
 *
 * @category extra
 */
export function distinctUntilChanged<T>(
	source: Node<T>,
	equals: (a: T, b: T) => boolean = Object.is,
	opts?: ExtraOpts,
): Node<T> {
	return node<T>([source as Node], ([v]) => v as T, {
		...operatorOpts(opts),
		equals: equals as (a: unknown, b: unknown) => boolean,
	});
}

/**
 * Emits `[previous, current]` pairs starting after the second value (first pair uses `RESOLVED` only).
 *
 * @param source - Upstream node.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<readonly [T, T]>` - Pair stream.
 *
 * @example
 * ```ts
 * import { pairwise, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = pairwise(state(0));
 * ```
 *
 * @category extra
 */
export function pairwise<T>(source: Node<T>, opts?: ExtraOpts): Node<readonly [T, T]> {
	let prev: T | undefined;
	let hasPrev = false;
	return node<readonly [T, T]>(
		[source as Node],
		([v], a) => {
			const x = v as T;
			if (!hasPrev) {
				prev = x;
				hasPrev = true;
				a.down([[RESOLVED]]);
				return undefined;
			}
			const pair = [prev as T, x] as const;
			prev = x;
			return pair;
		},
		operatorOpts(opts),
	);
}

/**
 * Combines the latest value from each dependency whenever any dep settles (combineLatest).
 *
 * @param sources - Tuple of nodes (fixed arity preserves tuple type).
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Tuple of latest values.
 *
 * @example
 * ```ts
 * import { combine, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = combine([state(1), state("a")] as const);
 * ```
 *
 * @category extra
 */
export function combine<const T extends readonly unknown[]>(
	sources: { [K in keyof T]: Node<T[K]> },
	opts?: ExtraOpts,
): Node<T> {
	const deps = [...sources] as unknown as Node[];
	return node<T>(deps, (vals) => vals as unknown as T, operatorOpts(opts));
}

/**
 * When `primary` settles, emits `[primary, latestSecondary]`. `secondary` alone updates cache only.
 *
 * @param primary - Main stream.
 * @param secondary - Latest value is paired on each primary emission.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<readonly [A, B]>` - Paired stream.
 *
 * @example
 * ```ts
 * import { state, withLatestFrom } from "@graphrefly/graphrefly-ts";
 *
 * const n = withLatestFrom(state(1), state("x"));
 * ```
 *
 * @category extra
 */
export function withLatestFrom<A, B>(
	primary: Node<A>,
	secondary: Node<B>,
	opts?: ExtraOpts,
): Node<readonly [A, B]> {
	let latestB: B | undefined;
	let hasB = false;
	return node<readonly [A, B]>([primary as Node, secondary as Node], () => undefined, {
		...operatorOpts(opts),
		onMessage(msg, i, a) {
			if (i === 1 && (msg[0] === DATA || msg[0] === RESOLVED)) {
				latestB = secondary.get() as B;
				hasB = true;
				return true;
			}
			if (i === 0 && (msg[0] === DATA || msg[0] === RESOLVED)) {
				if (!hasB) {
					latestB = secondary.get() as B;
					hasB = true;
				}
				a.emit([primary.get() as A, latestB as B]);
				return true;
			}
			if (i === 0 && msg[0] === DIRTY) {
				a.down([[DIRTY]]);
				return true;
			}
			if (i === 1 && msg[0] === DIRTY) {
				return true;
			}
			if (msg[0] === COMPLETE || msg[0] === ERROR) {
				a.down([msg]);
				return true;
			}
			a.down([msg]);
			return true;
		},
	});
}

/**
 * Merges **`DATA`** from any source with correct two-phase dirty tracking. **`COMPLETE`** after **all** sources complete (spec §1.3.5).
 *
 * @param sources - Nodes to merge (empty completes immediately).
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Merged stream.
 *
 * @remarks
 * **Ordering:** DIRTY/RESOLVED rules follow multi-source semantics in `GRAPHREFLY-SPEC.md`.
 *
 * @example
 * ```ts
 * import { merge, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = merge([state(1), state(2)]);
 * ```
 *
 * @category extra
 */
export function merge<T>(sources: readonly Node<T>[], opts?: ExtraOpts): Node<T> {
	if (sources.length === 0) {
		return producer<T>((_d, a) => {
			a.down([[COMPLETE]]);
			return undefined;
		}, operatorOpts(opts));
	}
	const deps = sources as unknown as Node[];
	const n = deps.length;
	let completed = 0;
	let dirtyMask = 0n;
	let anyData = false;
	return node<T>(deps, () => undefined, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, i, a) {
			const t = msg[0];
			const bit = 1n << BigInt(i);
			if (t === DIRTY) {
				const wasClean = dirtyMask === 0n;
				dirtyMask |= bit;
				if (wasClean) {
					anyData = false;
					a.down([[DIRTY]]);
				}
				return true;
			}
			if (t === RESOLVED) {
				if (dirtyMask & bit) {
					dirtyMask &= ~bit;
					if (dirtyMask === 0n && !anyData) {
						a.down([[RESOLVED]]);
					}
				}
				return true;
			}
			if (t === DATA) {
				dirtyMask &= ~bit;
				anyData = true;
				a.emit(msg[1]);
				return true;
			}
			if (t === COMPLETE) {
				dirtyMask &= ~bit;
				completed += 1;
				if (completed >= n) {
					a.down([[COMPLETE]]);
				}
				return true;
			}
			if (t === ERROR) {
				a.down([msg]);
				return true;
			}
			a.down([msg]);
			return true;
		},
	});
}

/**
 * Zips one **`DATA`** from each source per cycle into a tuple. Only **`DATA`** enqueues (spec §1.3.3).
 *
 * @param sources - Tuple of nodes.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Zipped tuples.
 *
 * @example
 * ```ts
 * import { state, zip } from "@graphrefly/graphrefly-ts";
 *
 * const n = zip([state(1), state(2)] as const);
 * ```
 *
 * @category extra
 */
export function zip<const T extends readonly unknown[]>(
	sources: { [K in keyof T]: Node<T[K]> },
	opts?: ExtraOpts,
): Node<T> {
	const n = sources.length;
	if (n === 0) {
		return node<T>([], () => [] as unknown as T, operatorOpts(opts));
	}
	const deps = [...sources] as unknown as Node[];
	const queues: unknown[][] = Array.from({ length: n }, () => []);
	let dirtyMask = 0n;
	let anyData = false;
	let active = n;

	function tryEmit(a: { emit(v: T): void }) {
		while (queues.every((q) => q.length > 0)) {
			const tuple = queues.map((q) => q.shift()!) as unknown as T;
			a.emit(tuple);
		}
	}

	return node<T>(deps, () => undefined, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, i, a) {
			const t = msg[0];
			const bit = 1n << BigInt(i);
			if (t === DIRTY) {
				const wasClean = dirtyMask === 0n;
				dirtyMask |= bit;
				if (wasClean) {
					anyData = false;
					a.down([[DIRTY]]);
				}
				return true;
			}
			if (t === RESOLVED) {
				if (dirtyMask & bit) {
					dirtyMask &= ~bit;
					if (dirtyMask === 0n) {
						if (anyData) {
							tryEmit(a);
						} else {
							a.down([[RESOLVED]]);
						}
					}
				}
				return true;
			}
			if (t === DATA) {
				dirtyMask &= ~bit;
				queues[i].push(msg[1]);
				anyData = true;
				if (dirtyMask === 0n) {
					tryEmit(a);
				}
				return true;
			}
			if (t === COMPLETE) {
				active -= 1;
				if (active === 0 || queues[i].length === 0) {
					a.down([[COMPLETE]]);
				}
				return true;
			}
			if (t === ERROR) {
				a.down([msg]);
				return true;
			}
			a.down([msg]);
			return true;
		},
	});
}

/**
 * Plays all of `firstSrc`, then all of `secondSrc`. **`DATA`** from `secondSrc` during phase one is buffered until handoff.
 *
 * @param firstSrc - First segment.
 * @param secondSrc - Second segment.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Concatenated stream.
 *
 * @example
 * ```ts
 * import { concat, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = concat(state(1), state(2));
 * ```
 *
 * @category extra
 */
export function concat<T>(firstSrc: Node<T>, secondSrc: Node<T>, opts?: ExtraOpts): Node<T> {
	let phase: 0 | 1 = 0;
	const pending: unknown[] = [];
	return node<T>([firstSrc as Node, secondSrc as Node], () => undefined, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, i, a) {
			const t = msg[0];
			if (phase === 0 && i === 1) {
				if (t === DATA) {
					pending.push(msg[1]);
				} else if (t === ERROR) {
					a.down([msg]);
				}
				return true;
			}
			if (phase === 0 && i === 0) {
				if (t === COMPLETE) {
					phase = 1;
					for (const v of pending) {
						a.emit(v as T);
					}
					pending.length = 0;
					return true;
				}
				a.down([msg]);
				return true;
			}
			if (phase === 1 && i === 0) {
				return true;
			}
			if (phase === 1 && i === 1) {
				a.down([msg]);
				return true;
			}
			return true;
		},
	});
}

/**
 * First source to emit **`DATA`** wins; later traffic follows only the winner (Rx-style `race`).
 *
 * @param sources - Contestants (empty completes immediately; one node is identity).
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Winning stream.
 *
 * @example
 * ```ts
 * import { race, state } from "@graphrefly/graphrefly-ts";
 *
 * const n = race([state(1), state(2)]);
 * ```
 *
 * @category extra
 */
export function race<T>(sources: readonly Node<T>[], opts?: ExtraOpts): Node<T> {
	if (sources.length === 0) {
		return producer<T>((_d, a) => {
			a.down([[COMPLETE]]);
			return undefined;
		}, operatorOpts(opts));
	}
	if (sources.length === 1) {
		return node<T>([sources[0] as Node], ([v]) => v as T, operatorOpts(opts));
	}
	const deps = sources as unknown as Node[];
	let winner: number | null = null;
	return node<T>(deps, () => undefined, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, i, a) {
			const t = msg[0];
			if (winner !== null && i !== winner) {
				return true;
			}
			if (t === DATA && winner === null) {
				winner = i;
				a.emit(msg[1]);
				return true;
			}
			if (winner !== null && i === winner) {
				if (t === DATA) {
					a.emit(msg[1]);
					return true;
				}
				a.down([msg]);
				return true;
			}
			if (winner === null) {
				if (t === DIRTY) {
					a.down([[DIRTY]]);
					return true;
				}
				if (t === RESOLVED) {
					a.down([[RESOLVED]]);
					return true;
				}
				if (t === COMPLETE || t === ERROR) {
					a.down([msg]);
					return true;
				}
			}
			return false;
		},
	});
}

// --- Tier 2: async / dynamic (roadmap §2.2), all on `node` / `producer` ---

function forwardInner<R>(inner: Node<R>, a: NodeActions, onInnerComplete: () => void): () => void {
	let unsub: (() => void) | undefined;
	unsub = inner.subscribe((msgs) => {
		let sawComplete = false;
		let sawError = false;
		const out: Message[] = [];
		for (const m of msgs) {
			if (m[0] === COMPLETE) sawComplete = true;
			else {
				if (m[0] === ERROR) sawError = true;
				out.push(m);
			}
		}
		if (out.length > 0) a.down(out as unknown as Messages);
		if (sawError) {
			unsub?.();
			unsub = undefined;
			onInnerComplete();
		} else if (sawComplete) {
			onInnerComplete();
		}
	});
	return () => {
		unsub?.();
		unsub = undefined;
	};
}

/**
 * Maps each settled value to an inner node; unsubscribes the previous inner (Rx-style `switchMap`).
 *
 * @param source - Upstream node.
 * @param project - Maps each outer value to an inner node.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<R>` - Emissions from the active inner subscription.
 * @example
 * ```ts
 * import { switchMap, state } from "@graphrefly/graphrefly-ts";
 *
 * const src = state(0);
 * switchMap(src, (n) => state((n as number) * 2));
 * ```
 *
 * @category extra
 */
export function switchMap<T, R>(
	source: Node<T>,
	project: (value: T) => Node<R>,
	opts?: ExtraOpts,
): Node<R> {
	let innerUnsub: (() => void) | undefined;
	let sourceDone = false;

	function clearInner(): void {
		innerUnsub?.();
		innerUnsub = undefined;
	}

	function attach(v: T, a: NodeActions): void {
		clearInner();
		innerUnsub = forwardInner(project(v), a, () => {
			clearInner();
			if (sourceDone) a.down([[COMPLETE]]);
		});
	}

	return node<R>(
		[source as Node],
		([v], a) => {
			if (v !== undefined) attach(v as T, a);
			return clearInner;
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			onMessage(msg, _i, a) {
				const t = msg[0];
				if (t === ERROR) {
					clearInner();
					a.down([msg]);
					return true;
				}
				if (t === COMPLETE) {
					sourceDone = true;
					if (innerUnsub === undefined) a.down([[COMPLETE]]);
					return true;
				}
				if (t === DIRTY) {
					a.down([[DIRTY]]);
					return true;
				}
				if (t === RESOLVED) {
					a.down([[RESOLVED]]);
					return true;
				}
				if (t === DATA) {
					attach(msg[1] as T, a);
					return true;
				}
				return false;
			},
		},
	);
}

/**
 * Like {@link switchMap}, but ignores outer `DATA` while an inner subscription is active (`exhaustMap`).
 *
 * @param source - Upstream node.
 * @param project - Maps each outer value to an inner node.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<R>` - Emissions from the active inner while it runs.
 * @example
 * ```ts
 * import { exhaustMap, state } from "@graphrefly/graphrefly-ts";
 *
 * exhaustMap(state(0), () => state(1));
 * ```
 *
 * @category extra
 */
export function exhaustMap<T, R>(
	source: Node<T>,
	project: (value: T) => Node<R>,
	opts?: ExtraOpts,
): Node<R> {
	let innerUnsub: (() => void) | undefined;
	let sourceDone = false;

	function clearInner(): void {
		innerUnsub?.();
		innerUnsub = undefined;
	}

	function attach(v: T, a: NodeActions): void {
		innerUnsub = forwardInner(project(v), a, () => {
			clearInner();
			if (sourceDone) a.down([[COMPLETE]]);
		});
	}

	return node<R>(
		[source as Node],
		([v], a) => {
			if (v !== undefined && innerUnsub === undefined) attach(v as T, a);
			return clearInner;
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			onMessage(msg, _i, a) {
				const t = msg[0];
				if (t === ERROR) {
					clearInner();
					a.down([msg]);
					return true;
				}
				if (t === COMPLETE) {
					sourceDone = true;
					if (innerUnsub === undefined) a.down([[COMPLETE]]);
					return true;
				}
				if (t === DIRTY) {
					a.down([[DIRTY]]);
					return true;
				}
				if (t === RESOLVED) {
					a.down([[RESOLVED]]);
					return true;
				}
				if (t === DATA) {
					if (innerUnsub !== undefined) {
						a.down([[RESOLVED]]);
						return true;
					}
					attach(msg[1] as T, a);
					return true;
				}
				return false;
			},
		},
	);
}

/**
 * Enqueues each outer value and subscribes to inners one at a time (`concatMap`).
 *
 * @param source - Upstream node.
 * @param project - Maps each outer value to an inner node.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<R>` - Sequential concatenation of inner streams.
 * @example
 * ```ts
 * import { concatMap, state } from "@graphrefly/graphrefly-ts";
 *
 * concatMap(state(0), (n) => state((n as number) + 1));
 * ```
 *
 * @category extra
 */
export function concatMap<T, R>(
	source: Node<T>,
	project: (value: T) => Node<R>,
	opts?: ExtraOpts & { maxBuffer?: number },
): Node<R> {
	const { maxBuffer: maxBuf, ...concatNodeOpts } = opts ?? {};
	const queue: T[] = [];
	let innerUnsub: (() => void) | undefined;
	let sourceDone = false;

	function clearInner(): void {
		innerUnsub?.();
		innerUnsub = undefined;
	}

	function tryPump(a: NodeActions): void {
		if (innerUnsub !== undefined) return;
		if (queue.length === 0) {
			if (sourceDone) a.down([[COMPLETE]]);
			return;
		}
		const v = queue.shift()!;
		innerUnsub = forwardInner(project(v), a, () => {
			clearInner();
			tryPump(a);
		});
	}

	function enqueue(v: T, a: NodeActions): void {
		if (maxBuf && maxBuf > 0 && queue.length >= maxBuf) queue.shift();
		queue.push(v);
		tryPump(a);
	}

	return node<R>(
		[source as Node],
		([v], a) => {
			if (v !== undefined) enqueue(v as T, a);
			return clearInner;
		},
		{
			...operatorOpts(concatNodeOpts),
			completeWhenDepsComplete: false,
			onMessage(msg, _i, a) {
				const t = msg[0];
				if (t === ERROR) {
					clearInner();
					queue.length = 0;
					a.down([msg]);
					return true;
				}
				if (t === COMPLETE) {
					sourceDone = true;
					tryPump(a);
					return true;
				}
				if (t === DIRTY) {
					a.down([[DIRTY]]);
					return true;
				}
				if (t === RESOLVED) {
					a.down([[RESOLVED]]);
					return true;
				}
				if (t === DATA) {
					enqueue(msg[1] as T, a);
					return true;
				}
				return false;
			},
		},
	);
}

/**
 * Subscribes to every inner in parallel and merges outputs (`mergeMap` / `flatMap`).
 *
 * @param source - Upstream node.
 * @param project - Maps each outer value to an inner node.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<R>` - Merged output of all active inners; completes when the outer and every inner complete.
 * @example
 * ```ts
 * import { mergeMap, state } from "@graphrefly/graphrefly-ts";
 *
 * mergeMap(state(0), (n) => state((n as number) + 1));
 * ```
 *
 * @category extra
 */
export function mergeMap<T, R>(
	source: Node<T>,
	project: (value: T) => Node<R>,
	opts?: ExtraOpts,
): Node<R> {
	let active = 0;
	let sourceDone = false;
	const innerStops = new Set<() => void>();

	function tryComplete(a: NodeActions): void {
		if (sourceDone && active === 0) a.down([[COMPLETE]]);
	}

	function spawn(v: T, a: NodeActions): void {
		active++;
		const inner = project(v);
		let stop: (() => void) | undefined;
		const runStop = (): void => {
			stop?.();
			if (stop !== undefined) innerStops.delete(stop);
			stop = undefined;
		};
		stop = inner.subscribe((msgs) => {
			let sawComplete = false;
			const out: Message[] = [];
			for (const m of msgs) {
				if (m[0] === COMPLETE) sawComplete = true;
				else out.push(m);
			}
			if (out.length > 0) a.down(out as unknown as Messages);
			if (sawComplete) {
				runStop();
				active--;
				tryComplete(a);
			}
		});
		innerStops.add(stop);
	}

	function clearAll(): void {
		for (const u of innerStops) u();
		innerStops.clear();
		active = 0;
	}

	return node<R>(
		[source as Node],
		([v], a) => {
			if (v !== undefined) spawn(v as T, a);
			return clearAll;
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			onMessage(msg, _i, a) {
				const t = msg[0];
				if (t === ERROR) {
					clearAll();
					a.down([msg]);
					return true;
				}
				if (t === COMPLETE) {
					sourceDone = true;
					tryComplete(a);
					return true;
				}
				if (t === DIRTY) {
					a.down([[DIRTY]]);
					return true;
				}
				if (t === RESOLVED) {
					a.down([[RESOLVED]]);
					return true;
				}
				if (t === DATA) {
					spawn(msg[1] as T, a);
					return true;
				}
				return false;
			},
		},
	);
}

/** @alias mergeMap */
export const flatMap = mergeMap;

/**
 * Delays phase-2 emissions by `ms` (timers). `DIRTY` still forwards immediately.
 *
 * @param source - Upstream node.
 * @param ms - Delay in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Same values, shifted in time.
 * @example
 * ```ts
 * import { delay, state } from "@graphrefly/graphrefly-ts";
 *
 * delay(state(1), 100);
 * ```
 *
 * @category extra
 */
export function delay<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T> {
	const timers = new Set<ReturnType<typeof setTimeout>>();
	function clearAll(): void {
		for (const id of timers) clearTimeout(id);
		timers.clear();
	}
	return node<T>([source as Node], () => clearAll, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, _i, a) {
			const t = msg[0];
			if (t === DIRTY || t === ERROR || t === COMPLETE || t === PAUSE || t === RESUME) {
				if (t === COMPLETE) clearAll();
				a.down([msg]);
				return true;
			}
			if (t === RESOLVED) {
				a.down([msg]);
				return true;
			}
			if (t === DATA) {
				const id = setTimeout(() => {
					timers.delete(id);
					a.down([msg]);
				}, ms);
				timers.add(id);
				return true;
			}
			a.down([msg]);
			return true;
		},
	});
}

/**
 * Emits the latest value only after `ms` quiet time since the last trigger (`debounce`).
 *
 * @param source - Upstream node.
 * @param ms - Quiet window in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Debounced stream.
 * @example
 * ```ts
 * import { debounce, state } from "@graphrefly/graphrefly-ts";
 *
 * debounce(state(0), 50);
 * ```
 *
 * @category extra
 */
export function debounce<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: T | undefined;
	function clearTimer(): void {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
	}
	return node<T>([source as Node], () => clearTimer, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, _i, a) {
			const t = msg[0];
			if (t === ERROR || t === PAUSE || t === RESUME) {
				clearTimer();
				a.down([msg]);
				return true;
			}
			if (t === COMPLETE) {
				if (timer !== undefined) {
					clearTimer();
					a.emit(pending as T);
				}
				a.down([msg]);
				return true;
			}
			if (t === DIRTY) {
				a.down([[DIRTY]]);
				return true;
			}
			if (t === DATA) {
				clearTimer();
				pending = msg[1] as T;
				timer = setTimeout(() => {
					timer = undefined;
					a.emit(pending as T);
				}, ms);
				return true;
			}
			if (t === RESOLVED) {
				clearTimer();
				timer = setTimeout(() => {
					timer = undefined;
					a.down([[RESOLVED]]);
				}, ms);
				return true;
			}
			a.down([msg]);
			return true;
		},
	});
}

export type ThrottleOptions = { leading?: boolean; trailing?: boolean };

/**
 * Rate-limits emissions to at most once per `ms` window (`throttleTime`).
 *
 * @param source - Upstream node.
 * @param ms - Minimum spacing in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`) plus `leading` / `trailing`.
 * @returns `Node<T>` - Throttled stream.
 * @example
 * ```ts
 * import { throttle, state } from "@graphrefly/graphrefly-ts";
 *
 * throttle(state(0), 1_000, { trailing: false });
 * ```
 *
 * @category extra
 */
export function throttle<T>(
	source: Node<T>,
	ms: number,
	opts?: ExtraOpts & ThrottleOptions,
): Node<T> {
	const { leading: leadingOpt, trailing: trailingOpt, ...throttleNodeOpts } = opts ?? {};
	const leading = leadingOpt !== false;
	const trailing = trailingOpt === true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastEmit = 0;
	let pending: T | undefined;
	let hasPending = false;

	function clearTimer(): void {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
	}

	return node<T>(
		[source as Node],
		() => {
			clearTimer();
			return undefined;
		},
		{
			...operatorOpts(throttleNodeOpts),
			completeWhenDepsComplete: false,
			onMessage(msg, _i, a) {
				const t = msg[0];
				if (t === ERROR || t === COMPLETE || t === PAUSE || t === RESUME) {
					clearTimer();
					a.down([msg]);
					return true;
				}
				if (t === DIRTY) {
					a.down([[DIRTY]]);
					return true;
				}
				if (t === RESOLVED) {
					a.down([[RESOLVED]]);
					return true;
				}
				if (t === DATA) {
					const v = msg[1] as T;
					const now = Date.now();
					if (leading && now - lastEmit >= ms) {
						lastEmit = now;
						a.emit(v);
						clearTimer();
						if (trailing) {
							timer = setTimeout(() => {
								timer = undefined;
								if (hasPending) {
									lastEmit = Date.now();
									a.emit(pending as T);
									hasPending = false;
								}
							}, ms);
						}
						return true;
					}
					if (trailing) {
						pending = v;
						hasPending = true;
						if (timer === undefined) {
							timer = setTimeout(
								() => {
									timer = undefined;
									if (hasPending) {
										lastEmit = Date.now();
										a.emit(pending as T);
										hasPending = false;
									}
								},
								Math.max(0, ms - (now - lastEmit)),
							);
						}
					}
					return true;
				}
				a.down([msg]);
				return true;
			},
		},
	);
}

/**
 * Emits the most recent source value whenever `notifier` settles (`sample`).
 *
 * @param source - Node whose latest value is sampled.
 * @param notifier - When this node settles (`DATA` / `RESOLVED`), a sample is taken.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Sampled snapshots of `source`.
 * @remarks **Undefined payload:** If `T` includes `undefined`, `get() === undefined` is treated as “no snapshot” and the operator emits `RESOLVED` instead of `DATA`.
 * @example
 * ```ts
 * import { sample, state } from "@graphrefly/graphrefly-ts";
 *
 * sample(state(1), state(0));
 * ```
 *
 * @category extra
 */
export function sample<T>(source: Node<T>, notifier: Node<unknown>, opts?: ExtraOpts): Node<T> {
	return node<T>([source as Node, notifier as Node], () => undefined, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, i, a) {
			const t = msg[0];
			if (t === ERROR) {
				a.down([msg]);
				return true;
			}
			if (t === COMPLETE) {
				a.down([msg]);
				return true;
			}
			if (i === 1 && t === DATA) {
				const v = (source as Node<T>).get();
				if (v !== undefined) a.emit(v as T);
				else a.down([[RESOLVED]]);
				return true;
			}
			if (i === 1 && t === RESOLVED) {
				return true;
			}
			if (i === 0) {
				return true;
			}
			return false;
		},
	});
}

/**
 * After each source `DATA`, waits `ms` then emits the latest value if another `DATA` has not arrived (`auditTime` / trailing window).
 *
 * @param source - Upstream node.
 * @param ms - Window in milliseconds after each `DATA`.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Trailing-edge sampled stream.
 * @example
 * ```ts
 * import { audit, state } from "@graphrefly/graphrefly-ts";
 *
 * audit(state(0), 100);
 * ```
 *
 * @category extra
 */
export function audit<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let latest: T | undefined;
	let has = false;

	function clearTimer(): void {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
	}

	return node<T>([source as Node], () => clearTimer, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, _i, a) {
			const t = msg[0];
			if (t === ERROR || t === COMPLETE || t === PAUSE || t === RESUME) {
				clearTimer();
				a.down([msg]);
				return true;
			}
			if (t === DIRTY) {
				a.down([[DIRTY]]);
				return true;
			}
			if (t === RESOLVED) {
				a.down([[RESOLVED]]);
				return true;
			}
			if (t === DATA) {
				latest = msg[1] as T;
				has = true;
				clearTimer();
				timer = setTimeout(() => {
					timer = undefined;
					if (has) {
						has = false;
						a.emit(latest as T);
					}
				}, ms);
				return true;
			}
			a.down([msg]);
			return true;
		},
	});
}

/**
 * Errors if no `DATA` arrives within `ms` after subscribe or after the previous `DATA`.
 *
 * @param source - Upstream node.
 * @param ms - Idle budget in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`) and `with` for a custom error payload.
 * @returns `Node<T>` - Pass-through with idle watchdog.
 * @example
 * ```ts
 * import { timeout, state } from "@graphrefly/graphrefly-ts";
 *
 * timeout(state(0), 5_000);
 * ```
 *
 * @category extra
 */
export function timeout<T>(
	source: Node<T>,
	ms: number,
	opts?: ExtraOpts & { with?: unknown },
): Node<T> {
	const { with: withPayload, ...timeoutNodeOpts } = opts ?? {};
	let timer: ReturnType<typeof setTimeout> | undefined;
	const err = withPayload ?? new Error("timeout");

	function arm(a: NodeActions): void {
		clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			a.down([[ERROR, err]]);
		}, ms);
	}

	return node<T>(
		[source as Node],
		([_v], a) => {
			arm(a);
			return () => clearTimeout(timer);
		},
		{
			...operatorOpts(timeoutNodeOpts),
			completeWhenDepsComplete: false,
			onMessage(msg, _i, a) {
				const t = msg[0];
				if (t === DATA) {
					arm(a);
					a.down([msg]);
					return true;
				}
				if (t === COMPLETE || t === ERROR) {
					clearTimeout(timer);
					a.down([msg]);
					return true;
				}
				if (t === DIRTY || t === RESOLVED) {
					a.down([msg]);
					return true;
				}
				a.down([msg]);
				return true;
			},
		},
	);
}

/**
 * Buffers source `DATA` values; flushes an array when `notifier` settles (`buffer`).
 *
 * @param source - Upstream node.
 * @param notifier - Flush trigger on each settlement.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T[]>` - Emits buffered arrays (may be empty-handled via `RESOLVED` when nothing buffered).
 * @example
 * ```ts
 * import { buffer, state } from "@graphrefly/graphrefly-ts";
 *
 * buffer(state(0), state(0));
 * ```
 *
 * @category extra
 */
export function buffer<T>(source: Node<T>, notifier: Node<unknown>, opts?: ExtraOpts): Node<T[]> {
	const buf: T[] = [];
	return node<T[]>([source as Node, notifier as Node], () => undefined, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, i, a) {
			const t = msg[0];
			if (t === ERROR) {
				a.down([msg]);
				return true;
			}
			if (t === COMPLETE && i === 0) {
				if (buf.length > 0) a.emit([...buf]);
				buf.length = 0;
				a.down([msg]);
				return true;
			}
			if (t === COMPLETE && i === 1) {
				a.down([msg]);
				return true;
			}
			if (i === 0 && t === DATA) {
				buf.push(msg[1] as T);
				return true;
			}
			if (i === 1 && t === DATA) {
				if (buf.length > 0) {
					a.emit([...buf]);
					buf.length = 0;
				} else {
					a.down([[RESOLVED]]);
				}
				return true;
			}
			if (i === 1 && t === RESOLVED) {
				return true;
			}
			if (i === 0 && (t === DIRTY || t === RESOLVED)) {
				return true;
			}
			return false;
		},
	});
}

/**
 * Batches consecutive `DATA` values into arrays of length `count` (`bufferCount` / `windowCount`).
 *
 * @param source - Upstream node.
 * @param count - Buffer size before emit; must be > 0.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T[]>` - Emits fixed-size arrays; remainder flushes on `COMPLETE`.
 * @example
 * ```ts
 * import { bufferCount, state } from "@graphrefly/graphrefly-ts";
 *
 * bufferCount(state(0), 3);
 * ```
 *
 * @category extra
 */
export function bufferCount<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T[]> {
	if (count <= 0) throw new RangeError("bufferCount expects count > 0");
	const buf: T[] = [];
	return node<T[]>(
		[source as Node],
		([v], a) => {
			if (v !== undefined) {
				buf.push(v as T);
				if (buf.length >= count) {
					a.emit(buf.splice(0, buf.length));
				}
			}
			return undefined;
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			onMessage(msg, _i, a) {
				const t = msg[0];
				if (t === ERROR) {
					a.down([msg]);
					return true;
				}
				if (t === COMPLETE) {
					if (buf.length > 0) a.emit([...buf]);
					buf.length = 0;
					a.down([[COMPLETE]]);
					return true;
				}
				if (t === DIRTY) {
					a.down([[DIRTY]]);
					return true;
				}
				if (t === RESOLVED) {
					a.down([[RESOLVED]]);
					return true;
				}
				if (t === DATA) {
					buf.push(msg[1] as T);
					if (buf.length >= count) {
						a.emit(buf.splice(0, buf.length));
					}
					return true;
				}
				return false;
			},
		},
	);
}

/**
 * Splits source `DATA` into sub-nodes of `count` values each. Each sub-node completes after `count` items or when source completes.
 *
 * @param source - Upstream node.
 * @param count - Items per window.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<Node<T>>` - Each emission is a sub-node carrying that window's values.
 *
 * @category extra
 */
export function windowCount<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<Node<T>> {
	if (count <= 0) throw new RangeError("windowCount expects count > 0");
	let win: Node<T> | undefined;
	let winDown: ((msgs: Messages) => void) | undefined;
	let n = 0;

	function openWindow(a: NodeActions): void {
		const s = producer<T>((_d, actions) => {
			winDown = actions.down.bind(actions);
			return () => {
				winDown = undefined;
			};
		}, operatorOpts());
		win = s;
		n = 0;
		a.emit(s);
	}

	return node<Node<T>>([source as Node], () => undefined, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, _i, a) {
			const t = msg[0];
			if (t === DATA) {
				if (!win) openWindow(a);
				winDown?.([[DATA, msg[1]]]);
				n += 1;
				if (n >= count) {
					winDown?.([[COMPLETE]]);
					win = undefined;
					winDown = undefined;
				}
				return true;
			}
			if (t === COMPLETE) {
				winDown?.([[COMPLETE]]);
				win = undefined;
				winDown = undefined;
				a.down([[COMPLETE]]);
				return true;
			}
			if (t === ERROR) {
				winDown?.([msg]);
				win = undefined;
				winDown = undefined;
				a.down([msg]);
				return true;
			}
			if (t === DIRTY) {
				a.down([[DIRTY]]);
				return true;
			}
			if (t === RESOLVED) {
				a.down([[RESOLVED]]);
				return true;
			}
			return false;
		},
	});
}

/**
 * Flushes buffered `DATA` values every `ms` (`bufferTime` / `windowTime`).
 *
 * @param source - Upstream node.
 * @param ms - Flush interval in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T[]>` - Time-windowed batches.
 * @example
 * ```ts
 * import { bufferTime, state } from "@graphrefly/graphrefly-ts";
 *
 * bufferTime(state(0), 250);
 * ```
 *
 * @category extra
 */
export function bufferTime<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<T[]> {
	const buf: T[] = [];
	let iv: ReturnType<typeof setInterval> | undefined;
	return node<T[]>(
		[source as Node],
		(_deps, a) => {
			iv = setInterval(() => {
				if (buf.length > 0) {
					a.emit([...buf]);
					buf.length = 0;
				}
			}, ms);
			return () => {
				if (iv !== undefined) clearInterval(iv);
			};
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			onMessage(msg, _i, a) {
				const t = msg[0];
				if (t === ERROR) {
					a.down([msg]);
					return true;
				}
				if (t === COMPLETE) {
					if (iv !== undefined) clearInterval(iv);
					if (buf.length > 0) a.emit([...buf]);
					buf.length = 0;
					a.down([[COMPLETE]]);
					return true;
				}
				if (t === DIRTY) {
					a.down([[DIRTY]]);
					return true;
				}
				if (t === RESOLVED) {
					a.down([[RESOLVED]]);
					return true;
				}
				if (t === DATA) {
					buf.push(msg[1] as T);
					return true;
				}
				return false;
			},
		},
	);
}

/**
 * Splits source `DATA` into time-windowed sub-nodes; each window lasts `ms`.
 *
 * @param source - Upstream node.
 * @param ms - Window duration in milliseconds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<Node<T>>` - Each emission is a sub-node carrying that window's values.
 *
 * @category extra
 */
export function windowTime<T>(source: Node<T>, ms: number, opts?: ExtraOpts): Node<Node<T>> {
	let winDown: ((msgs: Messages) => void) | undefined;
	let iv: ReturnType<typeof setInterval> | undefined;

	function closeWindow(): void {
		winDown?.([[COMPLETE]]);
		winDown = undefined;
	}

	return node<Node<T>>(
		[source as Node],
		(_deps, a) => {
			function openWindow(): void {
				const s = producer<T>((_d, actions) => {
					winDown = actions.down.bind(actions);
					return () => {
						winDown = undefined;
					};
				}, operatorOpts());
				a.emit(s);
			}
			openWindow();
			iv = setInterval(() => {
				closeWindow();
				openWindow();
			}, ms);
			return () => {
				if (iv !== undefined) clearInterval(iv);
				closeWindow();
			};
		},
		{
			...operatorOpts(opts),
			completeWhenDepsComplete: false,
			onMessage(msg, _i, a) {
				const t = msg[0];
				if (t === DATA) {
					winDown?.([[DATA, msg[1]]]);
					return true;
				}
				if (t === COMPLETE) {
					if (iv !== undefined) clearInterval(iv);
					closeWindow();
					a.down([[COMPLETE]]);
					return true;
				}
				if (t === ERROR) {
					if (iv !== undefined) clearInterval(iv);
					winDown?.([msg]);
					closeWindow();
					a.down([msg]);
					return true;
				}
				if (t === DIRTY) {
					a.down([[DIRTY]]);
					return true;
				}
				if (t === RESOLVED) {
					a.down([[RESOLVED]]);
					return true;
				}
				return false;
			},
		},
	);
}

/**
 * Splits source `DATA` into sub-nodes, opening a new window each time `notifier` emits `DATA`.
 *
 * @param source - Upstream node.
 * @param notifier - Each `DATA` from `notifier` closes the current window and opens a new one.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<Node<T>>` - Each emission is a sub-node carrying that window's values.
 *
 * @category extra
 */
export function window<T>(
	source: Node<T>,
	notifier: Node<unknown>,
	opts?: ExtraOpts,
): Node<Node<T>> {
	let win: Node<T> | undefined;
	let winDown: ((msgs: Messages) => void) | undefined;

	function closeWindow(): void {
		winDown?.([[COMPLETE]]);
		win = undefined;
		winDown = undefined;
	}

	return node<Node<T>>([source as Node, notifier as Node], () => undefined, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, i, a) {
			const t = msg[0];
			if (i === 0 && t === DATA) {
				if (!win) {
					const s = producer<T>((_d, actions) => {
						winDown = actions.down.bind(actions);
						return () => {
							winDown = undefined;
						};
					}, operatorOpts());
					win = s;
					a.emit(s);
				}
				winDown?.([[DATA, msg[1]]]);
				return true;
			}
			if (i === 1 && t === DATA) {
				closeWindow();
				const s = producer<T>((_d, actions) => {
					winDown = actions.down.bind(actions);
					return () => {
						winDown = undefined;
					};
				}, operatorOpts());
				win = s;
				a.emit(s);
				return true;
			}
			if (t === COMPLETE && i === 0) {
				closeWindow();
				a.down([[COMPLETE]]);
				return true;
			}
			if (t === COMPLETE && i === 1) {
				return true;
			}
			if (t === ERROR) {
				winDown?.([msg]);
				win = undefined;
				winDown = undefined;
				a.down([msg]);
				return true;
			}
			if (i === 0 && (t === DIRTY || t === RESOLVED)) {
				return true;
			}
			if (i === 1 && t === RESOLVED) {
				return true;
			}
			return false;
		},
	});
}

/**
 * Increments on each tick (`interval`); uses `setInterval` via {@link producer}.
 *
 * @param periodMs - Time between ticks.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<number>` - Emits `0`, `1`, `2`, … while subscribed.
 * @example
 * ```ts
 * import { interval } from "@graphrefly/graphrefly-ts";
 *
 * interval(1_000);
 * ```
 *
 * @category extra
 */
export function interval(periodMs: number, opts?: ExtraOpts): Node<number> {
	let n = 0;
	return producer<number>((_d, a) => {
		const id = setInterval(() => {
			a.emit(n);
			n += 1;
		}, periodMs);
		return () => clearInterval(id);
	}, operatorOpts(opts));
}

/**
 * Subscribes to `source` repeatedly (`count` times, sequentially). Best with a fresh or `resubscribable` source.
 *
 * @param source - Upstream node to replay.
 * @param count - Number of subscription rounds.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Forwards each round then completes after the last inner `COMPLETE`.
 * @example
 * ```ts
 * import { repeat, state } from "@graphrefly/graphrefly-ts";
 *
 * repeat(state(1, { resubscribable: true }), 2);
 * ```
 *
 * @category extra
 */
export function repeat<T>(source: Node<T>, count: number, opts?: ExtraOpts): Node<T> {
	if (count <= 0) throw new RangeError("repeat expects count > 0");
	return producer<T>((_d, a) => {
		let remaining = count;
		let innerU: (() => void) | undefined;

		const start = (): void => {
			innerU?.();
			innerU = source.subscribe((msgs) => {
				let completed = false;
				const fwd: Message[] = [];
				for (const m of msgs) {
					if (m[0] === COMPLETE) completed = true;
					else fwd.push(m);
				}
				if (fwd.length > 0) a.down(fwd as unknown as Messages);
				if (completed) {
					innerU?.();
					innerU = undefined;
					remaining -= 1;
					if (remaining > 0) start();
					else a.down([[COMPLETE]]);
				}
			});
		};

		start();
		return () => {
			innerU?.();
		};
	}, operatorOpts(opts));
}

/**
 * While `PAUSE` is in effect, buffers `DIRTY` / `DATA` / `RESOLVED`; flushes on `RESUME`.
 *
 * @param source - Upstream node.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Pass-through with pause buffering.
 * @example
 * ```ts
 * import { pausable, state, PAUSE, RESUME } from "@graphrefly/graphrefly-ts";
 *
 * const s = state(0);
 * pausable(s);
 * s.down([[PAUSE]]);
 * s.down([[RESUME]]);
 * ```
 *
 * @category extra
 */
export function pausable<T>(source: Node<T>, opts?: ExtraOpts): Node<T> {
	let paused = false;
	const backlog: Message[] = [];

	return node<T>([source as Node], () => undefined, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, _i, a) {
			const t = msg[0];
			if (t === PAUSE) {
				paused = true;
				a.down([msg]);
				return true;
			}
			if (t === RESUME) {
				paused = false;
				a.down([msg]);
				for (const m of backlog) a.down([m]);
				backlog.length = 0;
				return true;
			}
			if (paused && (t === DIRTY || t === DATA || t === RESOLVED)) {
				backlog.push(msg);
				return true;
			}
			a.down([msg]);
			return true;
		},
	});
}

/**
 * Replaces an upstream `ERROR` with a recovered value (`catchError`-style).
 *
 * @param source - Upstream node.
 * @param recover - Maps the error payload to a replacement value; if it throws, `ERROR` is forwarded.
 * @param opts - Optional {@link NodeOptions} (excluding `describeKind`).
 * @returns `Node<T>` - Recovered stream.
 * @example
 * ```ts
 * import { rescue, state } from "@graphrefly/graphrefly-ts";
 *
 * rescue(state(0), () => 0);
 * ```
 *
 * @category extra
 */
export function rescue<T>(
	source: Node<T>,
	recover: (err: unknown) => T,
	opts?: ExtraOpts,
): Node<T> {
	return node<T>([source as Node], () => undefined, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, _i, a) {
			if (msg[0] === ERROR) {
				try {
					a.emit(recover(msg[1]));
				} catch (err) {
					a.down([[ERROR, err]]);
				}
				return true;
			}
			a.down([msg]);
			return true;
		},
	});
}

/**
 * Forward DATA only when `control` is truthy; otherwise emit RESOLVED.
 * Value-level gate (boolean control signal). See `pausable` for protocol-level PAUSE/RESUME.
 */
export function gate<T>(source: Node<T>, control: Node<boolean>, opts?: ExtraOpts): Node<T> {
	return node<T>(
		[source as Node, control as Node],
		(_deps, a) => {
			const v = (source as Node).get();
			const c = (control as Node).get();
			if (!c) {
				a.down([[RESOLVED]]);
				return undefined;
			}
			return v as T;
		},
		operatorOpts(opts),
	);
}
