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

/** Map each value from `source` through `project`. */
export function map<T, R>(source: Node<T>, project: (value: T) => R, opts?: ExtraOpts): Node<R> {
	return derived([source as Node], ([v]) => project(v as T), operatorOpts(opts));
}

/**
 * Emit values that satisfy `predicate`; when the predicate fails, downstream settles with
 * `RESOLVED` (no output) per two-phase semantics.
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

/** Fold: each emission updates an accumulator; output is the new accumulator. */
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
 * Reduce to a single value emitted when `source` completes. On an empty completion (no prior
 * `DATA`), emits `seed`.
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
 * Emit at most `count` **`DATA`** values from `source`, then `COMPLETE`. `RESOLVED` settlements
 * from upstream do not advance the counter (so `skip` + `take` composes correctly).
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
 * Skip the first `count` **`DATA`** emissions from `source`. `RESOLVED` settlements do not
 * advance the counter.
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

/** Emit values while `predicate` holds; then `COMPLETE`. */
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
 * Emit values from `source` until `notifier` delivers a matching message, then `COMPLETE`.
 * By default triggers on `DATA` from the notifier. Pass `predicate` for custom trigger logic.
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

/** First `DATA` from `source`, then `COMPLETE`. */
export function first<T>(source: Node<T>, opts?: ExtraOpts): Node<T> {
	return take(source, 1, opts);
}

/**
 * Last value before `source` completes. Use `options.defaultValue` if the source may complete
 * without emitting.
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

/** First value matching `predicate`, then `COMPLETE`. */
export function find<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
	opts?: ExtraOpts,
): Node<T> {
	return take(filter(source, predicate, opts), 1, opts);
}

/** Zero-based index: emit the `index`th `DATA`, then `COMPLETE`. */
export function elementAt<T>(source: Node<T>, index: number, opts?: ExtraOpts): Node<T> {
	return take(skip(source, index, opts), 1, opts);
}

/** `initial` first, then every value from `source`. */
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

/** Run `fn` for side effects; values pass through unchanged. */
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

/** Suppress adjacent duplicates; delegates to node-level `equals` (default `Object.is`). */
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

/** Emit `[previous, current]` pairs (starts after the second source value). */
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

/** Combine latest value from each dependency whenever any dep settles (combineLatest). */
export function combine<const T extends readonly unknown[]>(
	sources: { [K in keyof T]: Node<T[K]> },
	opts?: ExtraOpts,
): Node<T> {
	const deps = [...sources] as unknown as Node[];
	return node<T>(deps, (vals) => vals as unknown as T, operatorOpts(opts));
}

/**
 * When `primary` settles, emit `[primary, latestSecondary]`. Updates from `secondary` alone
 * refresh the cached secondary value but do not emit.
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
 * Merge: forward DATA from any dependency. Uses dirty bitmask for proper two-phase tracking.
 * **`COMPLETE`** is emitted only after **every** source has completed (spec §1.3.5).
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
 * Zip one value from each source per cycle into a tuple. Only `DATA` enqueues values
 * (RESOLVED does not per spec §1.3.3). Completes when a completed source's buffer is empty.
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
 * All values from `first` (until it completes), then all from `second`. DATA from
 * `second` that arrives during phase 0 is buffered and replayed on handoff.
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
 * Race: first source to emit `DATA` wins. All subsequent messages are forwarded only from
 * the winning source; other sources are silenced. Matches Rx `race` semantics.
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
