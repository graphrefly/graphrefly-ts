/**
 * Tier 1 sync operators (roadmap §2.1) — each returns a {@link Node} built with {@link node}.
 */
import { COMPLETE, DATA, DIRTY, ERROR, type Message, RESOLVED } from "../core/messages.js";
import { type Node, type NodeOptions, node } from "../core/node.js";
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
		{ ...operatorOpts(opts), initial: seed },
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
	let dirtyMask = 0;
	let anyData = false;
	return node<T>(deps, () => undefined, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg, i, a) {
			const t = msg[0];
			if (t === DIRTY) {
				const wasClean = dirtyMask === 0;
				dirtyMask |= 1 << i;
				if (wasClean) {
					anyData = false;
					a.down([[DIRTY]]);
				}
				return true;
			}
			if (t === RESOLVED) {
				if (dirtyMask & (1 << i)) {
					dirtyMask &= ~(1 << i);
					if (dirtyMask === 0 && !anyData) {
						a.down([[RESOLVED]]);
					}
				}
				return true;
			}
			if (t === DATA) {
				dirtyMask &= ~(1 << i);
				anyData = true;
				a.emit(msg[1]);
				return true;
			}
			if (t === COMPLETE) {
				dirtyMask &= ~(1 << i);
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
	let dirtyMask = 0;
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
			if (t === DIRTY) {
				const wasClean = dirtyMask === 0;
				dirtyMask |= 1 << i;
				if (wasClean) {
					anyData = false;
					a.down([[DIRTY]]);
				}
				return true;
			}
			if (t === RESOLVED) {
				if (dirtyMask & (1 << i)) {
					dirtyMask &= ~(1 << i);
					if (dirtyMask === 0) {
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
				dirtyMask &= ~(1 << i);
				queues[i].push(msg[1]);
				anyData = true;
				if (dirtyMask === 0) {
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
