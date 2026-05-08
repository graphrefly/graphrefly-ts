/**
 * Legacy pure-TS impl arm — async-shaped wrapper (D077).
 *
 * Wraps `@graphrefly/legacy-pure-ts`'s sync API in Promise.resolve()
 * so the same parity scenarios run against both the legacy impl and
 * the napi-rs Rust impl (which is fundamentally async per D070).
 * Promise.resolve overhead is microseconds — negligible for parity
 * tests.
 */

import * as legacy from "@graphrefly/legacy-pure-ts";
import type { Impl, ImplGraph, ImplNode, Message, SinkFn, Tier, UnsubFn } from "./types.js";

// ---------------------------------------------------------------------------
// ImplNode wrapper for legacy.Node
// ---------------------------------------------------------------------------

class LegacyNode<T> implements ImplNode<T> {
	constructor(public readonly inner: legacy.Node<T>) {}

	async subscribe(cb: SinkFn<T>): Promise<UnsubFn> {
		const unsub = this.inner.subscribe((msgs) => {
			cb(msgs as ReadonlyArray<Message<T>>);
		});
		return async () => {
			unsub();
		};
	}

	async down(msgs: ReadonlyArray<Message<T>>): Promise<void> {
		this.inner.down(msgs as legacy.Messages);
	}

	get cache(): T | undefined {
		const c = this.inner.cache;
		return c === null ? undefined : c;
	}

	async complete(): Promise<void> {
		this.inner.down([[legacy.COMPLETE]]);
	}

	async error(value: T): Promise<void> {
		this.inner.down([[legacy.ERROR, value]]);
	}

	async invalidate(): Promise<void> {
		this.inner.down([[legacy.INVALIDATE]]);
	}

	async teardown(): Promise<void> {
		this.inner.down([[legacy.TEARDOWN]]);
	}

	async pause(lockId: number): Promise<void> {
		this.inner.down([[legacy.PAUSE, lockId]]);
	}

	async resume(_lockId: number): Promise<{ replayed: number; dropped: number } | null> {
		this.inner.down([[legacy.RESUME, _lockId]]);
		// Legacy `down([[RESUME]])` doesn't surface the resume report
		// (replayed/dropped). For parity, return null — Rust impl returns
		// the report; tests that rely on report values gate on impl name.
		return null;
	}

	async allocLockId(): Promise<number> {
		// Legacy doesn't expose alloc_lock_id on Node. Use a process-
		// counter mirror so tests get unique-enough ids.
		return ++LEGACY_LOCK_COUNTER;
	}

	async setResubscribable(_value: boolean): Promise<void> {
		// Legacy nodes have a `resubscribable` flag at construction;
		// post-construction setter is not part of the public Node API.
		// No-op here — tests that exercise this gate on impl name.
	}

	async hasFiredOnce(): Promise<boolean> {
		// Not surfaced on legacy.Node public API. Approximate via cache
		// presence — true if cache is not undefined/null.
		return this.inner.cache !== undefined && this.inner.cache !== null;
	}
}

let LEGACY_LOCK_COUNTER = 0;

// ---------------------------------------------------------------------------
// ImplGraph wrapper for legacy.Graph
// ---------------------------------------------------------------------------

class LegacyGraph implements ImplGraph {
	constructor(public readonly inner: legacy.Graph) {}

	tryResolve(path: string): ImplNode<unknown> | undefined {
		const found = this.inner.tryResolve(path);
		return found ? new LegacyNode<unknown>(found) : undefined;
	}

	nameOf(node: ImplNode<unknown>): string | undefined {
		const inner = node.inner as legacy.Node;
		return this.inner.nameOf(inner);
	}

	async state<T>(name: string, initial?: T): Promise<ImplNode<T>> {
		const n = this.inner.state<T>(name, initial as T);
		return new LegacyNode<T>(n);
	}

	async derived<T>(
		name: string,
		deps: ReadonlyArray<ImplNode<unknown>>,
		fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
	): Promise<ImplNode<T>> {
		const innerDeps = deps.map((d) => d.inner as legacy.Node);
		const fnAdapter: legacy.GraphDerivedFn<T> = (data) =>
			fn(data.map((d) => d ?? [])) as readonly (T | null)[];
		const n = this.inner.derived<T>(name, innerDeps, fnAdapter);
		return new LegacyNode<T>(n);
	}

	async dynamic<T>(
		name: string,
		deps: ReadonlyArray<ImplNode<unknown>>,
		fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
	): Promise<ImplNode<T>> {
		// Legacy doesn't have a separate `dynamic` method — `derived`
		// covers both static and dynamic via fn behavior. Both impls
		// route through derived for parity-test purposes.
		return this.derived(name, deps, fn);
	}

	async add<T>(name: string, node: ImplNode<T>): Promise<ImplNode<T>> {
		const inner = node.inner as legacy.Node<T>;
		this.inner.add(inner, { name });
		return node;
	}

	async set(name: string, value: unknown): Promise<void> {
		this.inner.set(name, value);
	}

	async get(name: string): Promise<unknown> {
		const n = this.inner.tryResolve(name);
		return n?.cache;
	}

	async invalidate(name: string): Promise<void> {
		this.inner.invalidate(name);
	}

	async complete(name: string): Promise<void> {
		this.inner.complete(name);
	}

	async error(name: string, value: unknown): Promise<void> {
		this.inner.error(name, value);
	}

	async remove(name: string): Promise<{ nodeCount: number; mountCount: number }> {
		const audit = this.inner.remove(name);
		return {
			nodeCount: audit.nodes.length,
			mountCount: audit.mounts.length,
		};
	}

	async signal(messages: ReadonlyArray<Message>): Promise<void> {
		this.inner.signal(messages as legacy.Messages);
	}

	async mount(name: string, child?: ImplGraph): Promise<ImplGraph> {
		if (child) {
			const m = this.inner.mount(name, (child as LegacyGraph).inner);
			return new LegacyGraph(m);
		}
		const m = this.inner.mount(name);
		return new LegacyGraph(m);
	}

	async unmount(name: string): Promise<{ nodeCount: number; mountCount: number }> {
		// Legacy uses `remove()` for both nodes and mounts.
		const audit = this.inner.remove(name);
		return {
			nodeCount: audit.nodes.length,
			mountCount: audit.mounts.length,
		};
	}

	async destroy(): Promise<void> {
		this.inner.destroy();
	}

	edges(opts?: { recursive?: boolean }): Array<[string, string]> {
		const result = this.inner.edges(opts);
		return result.map(([a, b]) => [a, b] as [string, string]);
	}

	describe(): unknown {
		return this.inner.describe();
	}
}

// ---------------------------------------------------------------------------
// Operator wrappers — each takes ImplNode args, calls legacy operator,
// wraps result in LegacyNode.
// ---------------------------------------------------------------------------

function unwrap<T>(n: ImplNode<T>): legacy.Node<T> {
	return n.inner as legacy.Node<T>;
}

function wrap<T>(n: legacy.Node<T>): ImplNode<T> {
	return new LegacyNode<T>(n);
}

// ---------------------------------------------------------------------------
// The Impl arm
// ---------------------------------------------------------------------------

export const legacyImpl: Impl = {
	name: "legacy-pure-ts",

	DATA: legacy.DATA,
	RESOLVED: legacy.RESOLVED,
	DIRTY: legacy.DIRTY,
	INVALIDATE: legacy.INVALIDATE,
	PAUSE: legacy.PAUSE,
	RESUME: legacy.RESUME,
	COMPLETE: legacy.COMPLETE,
	ERROR: legacy.ERROR,
	TEARDOWN: legacy.TEARDOWN,

	async node<T>(
		deps: ReadonlyArray<ImplNode<unknown>>,
		opts?: { initial?: T; name?: string },
	): Promise<ImplNode<T>> {
		const innerDeps = deps.map((d) => d.inner as legacy.Node);
		const n = legacy.node<T>(innerDeps, {
			initial: opts?.initial,
			name: opts?.name,
		} as legacy.NodeOptions<T>);
		return wrap(n);
	},

	Graph: class implements ImplGraph {
		private readonly impl: LegacyGraph;
		constructor(name: string) {
			this.impl = new LegacyGraph(new legacy.Graph(name));
		}
		tryResolve(path: string) {
			return this.impl.tryResolve(path);
		}
		nameOf(node: ImplNode<unknown>) {
			return this.impl.nameOf(node);
		}
		state<T>(name: string, initial?: T) {
			return this.impl.state<T>(name, initial);
		}
		derived<T>(
			name: string,
			deps: ReadonlyArray<ImplNode<unknown>>,
			fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
		) {
			return this.impl.derived<T>(name, deps, fn);
		}
		dynamic<T>(
			name: string,
			deps: ReadonlyArray<ImplNode<unknown>>,
			fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
		) {
			return this.impl.dynamic<T>(name, deps, fn);
		}
		add<T>(name: string, node: ImplNode<T>) {
			return this.impl.add<T>(name, node);
		}
		set(name: string, value: unknown) {
			return this.impl.set(name, value);
		}
		get(name: string) {
			return this.impl.get(name);
		}
		invalidate(name: string) {
			return this.impl.invalidate(name);
		}
		complete(name: string) {
			return this.impl.complete(name);
		}
		error(name: string, value: unknown) {
			return this.impl.error(name, value);
		}
		remove(name: string) {
			return this.impl.remove(name);
		}
		signal(messages: ReadonlyArray<Message>) {
			return this.impl.signal(messages);
		}
		mount(name: string, child?: ImplGraph) {
			return this.impl.mount(name, child);
		}
		unmount(name: string) {
			return this.impl.unmount(name);
		}
		destroy() {
			return this.impl.destroy();
		}
		edges(opts?: { recursive?: boolean }) {
			return this.impl.edges(opts);
		}
		describe() {
			return this.impl.describe();
		}
	},

	// Transform.
	async map<T, U>(src: ImplNode<T>, fn: (x: T) => U): Promise<ImplNode<U>> {
		return wrap(legacy.map(unwrap(src), fn));
	},
	async filter<T>(src: ImplNode<T>, predicate: (x: T) => boolean): Promise<ImplNode<T>> {
		return wrap(legacy.filter(unwrap(src), predicate));
	},
	async scan<T, U>(src: ImplNode<T>, fn: (acc: U, x: T) => U, seed: U): Promise<ImplNode<U>> {
		return wrap(legacy.scan(unwrap(src), fn, seed));
	},
	async reduce<T, U>(src: ImplNode<T>, fn: (acc: U, x: T) => U, seed: U): Promise<ImplNode<U>> {
		return wrap(legacy.reduce(unwrap(src), fn, seed));
	},
	async distinctUntilChanged<T>(
		src: ImplNode<T>,
		equals?: (a: T, b: T) => boolean,
	): Promise<ImplNode<T>> {
		return wrap(legacy.distinctUntilChanged(unwrap(src), equals));
	},
	async pairwise<T>(src: ImplNode<T>): Promise<ImplNode<[T, T]>> {
		return wrap(legacy.pairwise(unwrap(src)) as legacy.Node<[T, T]>);
	},

	// Combine.
	async combine<T>(srcs: ReadonlyArray<ImplNode<unknown>>): Promise<ImplNode<T[]>> {
		const inner = legacy.combine(...srcs.map((s) => unwrap(s)));
		return wrap(inner as unknown as legacy.Node<T[]>);
	},
	async withLatestFrom<T, U>(
		primary: ImplNode<T>,
		secondary: ImplNode<U>,
	): Promise<ImplNode<[T, U]>> {
		const inner = legacy.withLatestFrom(unwrap(primary), unwrap(secondary));
		return wrap(inner as unknown as legacy.Node<[T, U]>);
	},
	async merge<T>(srcs: ReadonlyArray<ImplNode<T>>): Promise<ImplNode<T>> {
		const inner = legacy.merge(...srcs.map((s) => unwrap(s)));
		return wrap(inner as legacy.Node<T>);
	},

	// Flow.
	async take<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T>> {
		return wrap(legacy.take(unwrap(src), count));
	},
	async skip<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T>> {
		return wrap(legacy.skip(unwrap(src), count));
	},
	async takeWhile<T>(src: ImplNode<T>, predicate: (x: T) => boolean): Promise<ImplNode<T>> {
		return wrap(legacy.takeWhile(unwrap(src), predicate));
	},
	async last<T>(src: ImplNode<T>, opts?: { defaultValue: T }): Promise<ImplNode<T>> {
		return wrap(legacy.last(unwrap(src), opts));
	},
	async first<T>(src: ImplNode<T>): Promise<ImplNode<T>> {
		return wrap(legacy.first(unwrap(src)));
	},
	async find<T>(src: ImplNode<T>, predicate: (x: T) => boolean): Promise<ImplNode<T>> {
		return wrap(legacy.find(unwrap(src), predicate));
	},
	async elementAt<T>(src: ImplNode<T>, index: number): Promise<ImplNode<T>> {
		return wrap(legacy.elementAt(unwrap(src), index));
	},

	// Subscription-managed combinators.
	async zip<T>(srcs: ReadonlyArray<ImplNode<unknown>>): Promise<ImplNode<T[]>> {
		const inner = legacy.zip(...srcs.map((s) => unwrap(s)));
		return wrap(inner as unknown as legacy.Node<T[]>);
	},
	async concat<T>(first: ImplNode<T>, second: ImplNode<T>): Promise<ImplNode<T>> {
		const inner = legacy.concat(unwrap(first), unwrap(second));
		return wrap(inner as legacy.Node<T>);
	},
	async race<T>(srcs: ReadonlyArray<ImplNode<T>>): Promise<ImplNode<T>> {
		const inner = legacy.race(...srcs.map((s) => unwrap(s)));
		return wrap(inner as legacy.Node<T>);
	},
	async takeUntil<T>(src: ImplNode<T>, notifier: ImplNode<unknown>): Promise<ImplNode<T>> {
		return wrap(legacy.takeUntil(unwrap(src), unwrap(notifier)));
	},

	// Higher-order.
	async switchMap<T, U>(outer: ImplNode<T>, project: (x: T) => ImplNode<U>): Promise<ImplNode<U>> {
		return wrap(legacy.switchMap(unwrap(outer), (x: T) => unwrap(project(x))));
	},
	async exhaustMap<T, U>(outer: ImplNode<T>, project: (x: T) => ImplNode<U>): Promise<ImplNode<U>> {
		return wrap(legacy.exhaustMap(unwrap(outer), (x: T) => unwrap(project(x))));
	},
	async concatMap<T, U>(outer: ImplNode<T>, project: (x: T) => ImplNode<U>): Promise<ImplNode<U>> {
		return wrap(legacy.concatMap(unwrap(outer), (x: T) => unwrap(project(x))));
	},
	async mergeMap<T, U>(
		outer: ImplNode<T>,
		project: (x: T) => ImplNode<U>,
		concurrency?: number,
	): Promise<ImplNode<U>> {
		const inner = legacy.mergeMap(
			unwrap(outer),
			(x: T) => unwrap(project(x)),
			concurrency !== undefined ? { concurrent: concurrency } : undefined,
		);
		return wrap(inner as legacy.Node<U>);
	},
};
