/**
 * Sources and sinks (roadmap §2.3). Each API returns a {@link Node} built with
 * {@link node}, {@link producer}, {@link derived}, or {@link effect} — no second protocol.
 */
import { COMPLETE, DATA, ERROR, type Message } from "../core/messages.js";
import { type Node, type NodeOptions, type NodeSink, node } from "../core/node.js";
import { producer } from "../core/sugar.js";
import { type CronSchedule, matchesCron, parseCron } from "./cron.js";

type ExtraOpts = Omit<NodeOptions, "describeKind">;

function sourceOpts(opts?: ExtraOpts): NodeOptions {
	return { describeKind: "producer", ...opts };
}

/** @internal kept for toArray which is an operator, not a producer */
function operatorOpts(opts?: ExtraOpts): NodeOptions {
	return { describeKind: "operator", ...opts };
}

/** Options for {@link fromTimer} / {@link fromPromise} / {@link fromAsyncIter}. */
export type AsyncSourceOpts = ExtraOpts & { signal?: AbortSignal };

/** Options for {@link fromCron}. */
export type FromCronOptions = ExtraOpts & {
	/** Polling interval in ms. Default `60_000`. */
	tickMs?: number;
	/** Output format: `"timestamp_ns"` (default) emits `Date.now() * 1_000_000`; `"date"` emits a `Date` object. */
	output?: "timestamp_ns" | "date";
};

/** DOM-style event target (browser or `node:events`). */
export type EventTargetLike = {
	addEventListener(
		type: string,
		listener: (ev: unknown) => void,
		options?: boolean | { capture?: boolean; passive?: boolean; once?: boolean },
	): void;
	removeEventListener(
		type: string,
		listener: (ev: unknown) => void,
		options?: boolean | { capture?: boolean; passive?: boolean; once?: boolean },
	): void;
};

function wrapSubscribeHook<T>(inner: Node<T>, before: (sink: NodeSink) => void): Node<T> {
	// Create a real NodeImpl (via `node()`) so the wrapper works with Graph.add()
	// and Graph.connect() which require `instanceof NodeImpl`.
	const wrapper = node<T>([inner], ([val]) => val as T, {
		describeKind: "operator",
		initial: inner.get(),
	});
	const origSubscribe = wrapper.subscribe.bind(wrapper);
	(wrapper as { subscribe: typeof wrapper.subscribe }).subscribe = (sink, hints) => {
		before(sink);
		return origSubscribe(sink, hints);
	};
	return wrapper;
}

/**
 * One-shot: emits `0` after `ms` then **`COMPLETE`**.
 * Periodic: emits `0` after `ms`, then `1, 2, 3, ...` every `period` ms (never completes until teardown).
 * If `signal` aborts first, emits **`ERROR`** with the abort reason and no `DATA`.
 */
export function fromTimer(ms: number, opts?: AsyncSourceOpts & { period?: number }): Node<number> {
	const { signal, period, ...rest } = opts ?? {};
	return producer<number>((_d, a) => {
		let done = false;
		let count = 0;
		let t: ReturnType<typeof setTimeout> | undefined;
		let iv: ReturnType<typeof setInterval> | undefined;
		const cleanup = () => {
			done = true;
			if (t !== undefined) clearTimeout(t);
			if (iv !== undefined) clearInterval(iv);
			signal?.removeEventListener("abort", onAbort);
		};
		const finish = () => {
			if (done) return;
			a.emit(count++);
			if (period != null) {
				iv = setInterval(() => {
					if (done) return;
					a.emit(count++);
				}, period);
			} else {
				done = true;
				signal?.removeEventListener("abort", onAbort);
				queueMicrotask(() => a.down([[COMPLETE]]));
			}
		};
		const onAbort = () => {
			if (done) return;
			cleanup();
			a.down([[ERROR, signal!.reason]]);
		};
		if (signal?.aborted) {
			onAbort();
			return;
		}
		t = setTimeout(finish, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
		return cleanup;
	}, sourceOpts(rest));
}

/**
 * Fires on each wall-clock minute that matches a 5-field cron expression (see {@link parseCron}).
 * By default emits `Date.now() * 1_000_000` (nanosecond timestamp). Use `output: "date"` to emit `Date` objects.
 */
export function fromCron(expr: string, opts?: FromCronOptions & { output: "date" }): Node<Date>;
export function fromCron(expr: string, opts?: FromCronOptions): Node<number>;
export function fromCron(expr: string, opts?: FromCronOptions): Node<number | Date> {
	const schedule: CronSchedule = parseCron(expr);
	const { tickMs: tickOpt, output, ...rest } = opts ?? {};
	const tickMs = tickOpt ?? 60_000;
	const emitDate = output === "date";
	return producer<number | Date>(
		(_d, a) => {
			let lastFiredKey = -1;
			const check = () => {
				const now = new Date();
				const key =
					now.getFullYear() * 100_000_000 +
					(now.getMonth() + 1) * 1_000_000 +
					now.getDate() * 10_000 +
					now.getHours() * 100 +
					now.getMinutes();
				if (key !== lastFiredKey && matchesCron(schedule, now)) {
					lastFiredKey = key;
					a.emit(emitDate ? now : Date.now() * 1_000_000);
				}
			};
			check();
			const id = setInterval(check, tickMs);
			return () => clearInterval(id);
		},
		{ ...sourceOpts(rest), name: rest.name ?? `cron:${expr}` },
	);
}

/**
 * Emits each event payload as **`DATA`**. teardown clears the listener.
 */
export function fromEvent<T = unknown>(
	target: EventTargetLike,
	type: string,
	opts?: ExtraOpts & { capture?: boolean; passive?: boolean; once?: boolean },
): Node<T> {
	const { capture, passive, once, ...rest } = opts ?? {};
	return producer<T>((_d, a) => {
		const handler = (e: unknown) => {
			a.emit(e as T);
		};
		const options = { capture, passive, once };
		target.addEventListener(type, handler, options);
		return () => target.removeEventListener(type, handler, options);
	}, sourceOpts(rest));
}

/** Drains a sync iterable then **`COMPLETE`**. */
export function fromIter<T>(iterable: Iterable<T>, opts?: ExtraOpts): Node<T> {
	return producer<T>((_d, a) => {
		let cancelled = false;
		try {
			for (const x of iterable) {
				if (cancelled) return;
				a.emit(x);
			}
			if (!cancelled) a.down([[COMPLETE]]);
		} catch (e) {
			if (!cancelled) a.down([[ERROR, e]]);
		}
		return () => {
			cancelled = true;
		};
	}, sourceOpts(opts));
}

function isThenable(x: unknown): x is PromiseLike<unknown> {
	return x != null && typeof (x as PromiseLike<unknown>).then === "function";
}

/** Resolves a Promise to one **`DATA`** then **`COMPLETE`**, or **`ERROR`**. */
export function fromPromise<T>(p: Promise<T> | PromiseLike<T>, opts?: AsyncSourceOpts): Node<T> {
	const { signal, ...rest } = opts ?? {};
	return producer<T>((_d, a) => {
		let settled = false;
		const onAbort = () => {
			if (settled) return;
			settled = true;
			a.down([[ERROR, signal!.reason]]);
		};
		if (signal?.aborted) {
			onAbort();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		void Promise.resolve(p).then(
			(v) => {
				if (settled) return;
				settled = true;
				signal?.removeEventListener("abort", onAbort);
				a.emit(v as T);
				a.down([[COMPLETE]]);
			},
			(e) => {
				if (settled) return;
				settled = true;
				signal?.removeEventListener("abort", onAbort);
				a.down([[ERROR, e]]);
			},
		);
		return () => {
			settled = true;
			signal?.removeEventListener("abort", onAbort);
		};
	}, sourceOpts(rest));
}

/** Reads an async iterable; teardown aborts the in-flight loop when possible. */
export function fromAsyncIter<T>(iterable: AsyncIterable<T>, opts?: AsyncSourceOpts): Node<T> {
	const { signal: outerSignal, ...rest } = opts ?? {};
	return producer<T>((_d, a) => {
		const ac = new AbortController();
		const onOuterAbort = () => ac.abort(outerSignal?.reason);
		if (outerSignal?.aborted) {
			ac.abort(outerSignal.reason);
		} else {
			outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
		}
		const signal = outerSignal ?? ac.signal;
		let cancelled = false;
		const it = iterable[Symbol.asyncIterator]();
		const pump = (): void => {
			if (cancelled || signal.aborted) return;
			void Promise.resolve(it.next()).then(
				(step) => {
					if (cancelled || signal.aborted) return;
					if (step.done) {
						queueMicrotask(() => a.down([[COMPLETE]]));
						return;
					}
					a.emit(step.value as T);
					queueMicrotask(pump);
				},
				(e) => {
					if (!cancelled && !signal.aborted) a.down([[ERROR, e]]);
				},
			);
		};
		queueMicrotask(pump);
		return () => {
			cancelled = true;
			outerSignal?.removeEventListener("abort", onOuterAbort);
			ac.abort();
			void Promise.resolve(it.return?.()).catch(() => undefined);
		};
	}, sourceOpts(rest));
}

function isNode(x: unknown): x is Node {
	return (
		x != null &&
		typeof (x as Node).subscribe === "function" &&
		typeof (x as Node).get === "function"
	);
}

/**
 * Dispatches by shape: Node passthrough, {@link fromPromise}, {@link fromAsyncIter},
 * {@link fromIter}, or scalar fallback via {@link of}.
 */
export function fromAny<T>(
	input: T,
	opts?: AsyncSourceOpts,
): Node<T extends Node<infer U> ? U : T> {
	if (isNode(input)) {
		return input as Node<T extends Node<infer U> ? U : T>;
	}
	if (isThenable(input)) {
		return fromPromise(input as unknown as Promise<unknown>, opts) as Node<
			T extends Node<infer U> ? U : T
		>;
	}
	if (Symbol.asyncIterator in Object(input)) {
		return fromAsyncIter(input as AsyncIterable<unknown>, opts) as Node<
			T extends Node<infer U> ? U : T
		>;
	}
	if (Symbol.iterator in Object(input)) {
		return fromIter(input as Iterable<unknown>, opts) as Node<T extends Node<infer U> ? U : T>;
	}
	// scalar fallback
	return of(input) as Node<T extends Node<infer U> ? U : T>;
}

/** Finishes each argument in order with **`COMPLETE`** after the last. */
export function of<T>(...values: T[]): Node<T> {
	return fromIter(values, undefined);
}

/** Completes immediately with no **`DATA`**. */
export function empty<T = never>(opts?: ExtraOpts): Node<T> {
	return producer<T>((_d, a) => {
		a.down([[COMPLETE]]);
		return undefined;
	}, sourceOpts(opts));
}

/** Never emits and never completes until unsubscribed. */
export function never<T = never>(opts?: ExtraOpts): Node<T> {
	return producer<T>(() => undefined, sourceOpts(opts));
}

/** Terminal **`ERROR`** as soon as the producer starts. */
export function throwError(err: unknown, opts?: ExtraOpts): Node<never> {
	return producer<never>((_d, a) => {
		a.down([[ERROR, err]]);
		return undefined;
	}, sourceOpts(opts));
}

/**
 * Side-effect sink; invokes `fn` only on upstream **`DATA`**.
 * Returns an unsubscribe callable (auto-subscribes immediately).
 */
export function forEach<T>(source: Node<T>, fn: (value: T) => void, opts?: ExtraOpts): () => void {
	const inner = node([source as Node], () => undefined, {
		describeKind: "effect",
		...opts,
		onMessage(msg: Message, _i, _a) {
			if (msg[0] === DATA) {
				fn(msg[1] as T);
				return true;
			}
			return false;
		},
	});
	// Auto-subscribe and return unsubscribe
	return inner.subscribe(() => {});
}

/**
 * Collects all **`DATA`** values; on upstream **`COMPLETE`** emits one **`DATA`** (the array) then **`COMPLETE`**.
 */
export function toArray<T>(source: Node<T>, opts?: ExtraOpts): Node<T[]> {
	const acc: T[] = [];
	return node<T[]>([source as Node], () => undefined, {
		...operatorOpts(opts),
		completeWhenDepsComplete: false,
		onMessage(msg: Message, _i, a) {
			if (msg[0] === DATA) {
				acc.push(msg[1] as T);
				return true;
			}
			if (msg[0] === COMPLETE) {
				a.emit([...acc]);
				a.down([[COMPLETE]]);
				return true;
			}
			return false;
		},
	});
}

/**
 * Multicast: one subscription to `source` while this node has subscribers (via {@link producer}).
 */
export function share<T>(source: Node<T>, opts?: ExtraOpts): Node<T> {
	return producer<T>(
		(_d, a) =>
			source.subscribe((msgs) => {
				a.down(msgs);
			}),
		{ ...sourceOpts(opts), initial: source.get() },
	);
}

/**
 * Like {@link share} with a replay buffer: new sinks receive the last `bufferSize` **`DATA`**
 * payloads (as separate **`DATA`** batches) before live updates.
 */
export function replay<T>(source: Node<T>, bufferSize: number, opts?: ExtraOpts): Node<T> {
	if (bufferSize < 1) throw new RangeError("replay expects bufferSize >= 1");
	const buf: T[] = [];
	const inner = producer<T>(
		(_d, a) =>
			source.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) {
						buf.push(m[1] as T);
						if (buf.length > bufferSize) buf.shift();
					}
				}
				a.down(msgs);
			}),
		{ ...sourceOpts(opts), initial: source.get() },
	);
	return wrapSubscribeHook(inner, (sink) => {
		for (const v of buf) {
			sink([[DATA, v]]);
		}
	});
}

/** {@link replay} with `bufferSize === 1` — last value replayed to new subscribers. */
export function cached<T>(source: Node<T>, opts?: ExtraOpts): Node<T> {
	return replay(source, 1, opts);
}

/**
 * Returns a Promise that resolves with the first **`DATA`** value from `source`,
 * or rejects on **`ERROR`** or **`COMPLETE`** without data.
 */
export function firstValueFrom<T>(source: Node<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const unsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (settled) return;
				if (m[0] === DATA) {
					settled = true;
					resolve(m[1] as T);
					queueMicrotask(() => unsub());
					return;
				}
				if (m[0] === ERROR) {
					settled = true;
					reject(m[1]);
					queueMicrotask(() => unsub());
					return;
				}
				if (m[0] === COMPLETE) {
					settled = true;
					reject(new Error("completed without DATA"));
					queueMicrotask(() => unsub());
					return;
				}
			}
		});
	});
}
