/**
 * Core reactive sources, sinks, and utilities (roadmap §2.3).
 *
 * Each API returns a {@link Node} built with {@link node}, {@link producer},
 * {@link derived}, or {@link effect} — no second protocol.
 *
 * Protocol/system/ingest adapters (fromHTTP, fromWebSocket, fromKafka, etc.)
 * live in {@link ./adapters.ts}.
 */

import { existsSync, watch } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { wallClockNs } from "../core/clock.js";
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

/**
 * Values accepted by {@link fromAny}.
 *
 * @category extra
 */
export type NodeInput<T> = Node<T> | PromiseLike<T> | AsyncIterable<T> | Iterable<T> | T;

/** Options for {@link fromCron}. */
export type FromCronOptions = ExtraOpts & {
	/** Polling interval in ms. Default `60_000`. */
	tickMs?: number;
	/** Output format: `"timestamp_ns"` (default) emits wall-clock nanoseconds; `"date"` emits a `Date` object. */
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

export type FSEventType = "change" | "rename" | "create" | "delete";
export type FSEvent = {
	type: FSEventType;
	path: string;
	root: string;
	relative_path: string;
	src_path?: string;
	dest_path?: string;
	timestamp_ns: number;
};

export type FromFSWatchOptions = ExtraOpts & {
	recursive?: boolean;
	debounce?: number;
	include?: string[];
	exclude?: string[];
};

/** @internal Shared with adapters.ts for glob matching in fromFSWatch / fromGitHook. */
export function escapeRegexChar(ch: string): string {
	return /[\\^$+?.()|[\]{}]/.test(ch) ? `\\${ch}` : ch;
}

/** @internal */
export function globToRegExp(glob: string): RegExp {
	let out = "^";
	for (let i = 0; i < glob.length; i += 1) {
		const ch = glob[i];
		if (ch === "*") {
			const next = glob[i + 1];
			if (next === "*") {
				out += ".*";
				i += 1;
			} else {
				out += "[^/]*";
			}
			continue;
		}
		out += escapeRegexChar(ch);
	}
	out += "$";
	return new RegExp(out);
}

/** @internal */
export function matchesAnyPattern(path: string, patterns: RegExp[]): boolean {
	for (const pattern of patterns) {
		if (pattern.test(path)) return true;
	}
	return false;
}

function wrapSubscribeHook<T>(inner: Node<T>, before: (sink: NodeSink) => void): Node<T> {
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
 * Builds a timer-driven source: one-shot (first tick then `COMPLETE`) or periodic (`0`, `1`, `2`, …).
 *
 * @param ms - Milliseconds before the first emission.
 * @param opts - Producer options plus optional `period` for repeating ticks and optional `signal` (`AbortSignal`) to cancel with `ERROR`.
 * @returns `Node<number>` — tick counter from `0`; teardown clears timers.
 *
 * @example
 * ```ts
 * import { fromTimer } from "@graphrefly/graphrefly-ts";
 *
 * fromTimer(250, { period: 1_000 });
 * ```
 *
 * @category extra
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
 * Polls on an interval; when the current minute matches a 5-field cron expression, emits once (see {@link parseCron}).
 *
 * @param expr - Cron string (`min hour dom month dow`).
 * @param opts - Producer options plus `tickMs` (default `60_000`) and `output` (`timestamp_ns` default, or `date` for `Date` values).
 * @returns `Node<number>` (nanosecond timestamp) or `Node<Date>` when `output: "date"`.
 *
 * @example
 * ```ts
 * import { fromCron } from "@graphrefly/graphrefly-ts";
 *
 * fromCron("0 9 * * 1");
 * ```
 *
 * @category extra
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
					a.emit(emitDate ? now : wallClockNs());
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
 * Wraps a DOM-style `addEventListener` target; each event becomes a `DATA` emission.
 *
 * @param target - Object with `addEventListener` / `removeEventListener`.
 * @param type - Event name (e.g. `"click"`).
 * @param opts - Producer options plus listener options (`capture`, `passive`, `once`).
 * @returns `Node<T>` — event payloads; teardown removes the listener.
 *
 * @example
 * ```ts
 * import { fromEvent } from "@graphrefly/graphrefly-ts";
 *
 * fromEvent(document.body, "click");
 * ```
 *
 * @category extra
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

/**
 * Watches filesystem paths and emits debounced change events.
 *
 * Uses `fs.watch` only (no polling fallback). Teardown closes all watchers.
 *
 * @category extra
 */
export function fromFSWatch(paths: string | string[], opts?: FromFSWatchOptions): Node<FSEvent> {
	const list = Array.isArray(paths) ? paths : [paths];
	if (list.length === 0) {
		throw new RangeError("fromFSWatch expects at least one path");
	}
	const { recursive = true, debounce = 100, include, exclude, ...rest } = opts ?? {};
	const includePatterns = include?.map(globToRegExp) ?? [];
	const excludePatterns = (exclude ?? ["**/node_modules/**", "**/.git/**", "**/dist/**"]).map(
		globToRegExp,
	);
	return producer<FSEvent>((_d, a) => {
		const pending = new Map<string, FSEvent>();
		const watchers: ReturnType<typeof watch>[] = [];
		let stopped = false;
		let terminalEmitted = false;
		let generation = 0;
		const closeWatchers = () => {
			for (const watcher of watchers.splice(0)) watcher.close();
		};
		const emitError = (err: unknown) => {
			if (terminalEmitted) return;
			terminalEmitted = true;
			stopped = true;
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			pending.clear();
			closeWatchers();
			a.down([[ERROR, err]]);
		};
		let timer: ReturnType<typeof setTimeout> | undefined;
		const flush = (token: number) => {
			timer = undefined;
			if (stopped || terminalEmitted) return;
			if (pending.size === 0) return;
			const batchMessages: Message[] = [];
			for (const evt of pending.values()) batchMessages.push([DATA, evt]);
			pending.clear();
			if (stopped || terminalEmitted || token !== generation) return;
			a.down(batchMessages);
		};
		try {
			for (const basePath of list) {
				const watcher = watch(
					basePath,
					{ recursive },
					(eventType: "rename" | "change", fileName: string | Buffer | null) => {
						if (stopped || terminalEmitted) return;
						if (fileName == null) return;
						const rel = String(fileName).replaceAll("\\", "/");
						const abs = resolvePath(basePath, String(fileName));
						const normalized = abs.replaceAll("\\", "/");
						const root = resolvePath(basePath).replaceAll("\\", "/");
						const relForMatch = rel.startsWith("./") ? rel.slice(2) : rel;
						const included =
							includePatterns.length === 0 ||
							matchesAnyPattern(normalized, includePatterns) ||
							matchesAnyPattern(relForMatch, includePatterns);
						if (!included) return;
						const excluded =
							matchesAnyPattern(normalized, excludePatterns) ||
							matchesAnyPattern(relForMatch, excludePatterns);
						if (excluded) return;
						let kind: FSEventType = "change";
						if (eventType === "rename") {
							try {
								kind = existsSync(normalized) ? "create" : "delete";
							} catch {
								kind = "rename";
							}
						}
						pending.set(normalized, {
							type: kind,
							path: normalized,
							root,
							relative_path: relForMatch,
							timestamp_ns: wallClockNs(),
						});
						if (timer !== undefined) clearTimeout(timer);
						const token = generation;
						timer = setTimeout(() => flush(token), debounce);
					},
				);
				watcher.on("error", (err) => emitError(err));
				watchers.push(watcher);
			}
		} catch (err) {
			emitError(err);
		}
		return () => {
			stopped = true;
			generation += 1;
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			closeWatchers();
			pending.clear();
		};
	}, sourceOpts(rest));
}

/**
 * Drains a synchronous iterable; each item is `DATA`, then `COMPLETE`, or `ERROR` if iteration throws.
 *
 * @param iterable - Values to emit in order.
 * @param opts - Optional producer options.
 * @returns `Node<T>` — one emission per element.
 *
 * @example
 * ```ts
 * import { fromIter } from "@graphrefly/graphrefly-ts";
 *
 * fromIter([1, 2, 3]);
 * ```
 *
 * @category extra
 */
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

/**
 * Lifts a Promise (or thenable) to a single-value stream: one `DATA` then `COMPLETE`, or `ERROR` on rejection.
 *
 * @param p - Promise to await.
 * @param opts - Producer options plus optional `signal` for abort → `ERROR` with reason.
 * @returns `Node<T>` — settles once.
 *
 * @example
 * ```ts
 * import { fromPromise } from "@graphrefly/graphrefly-ts";
 *
 * fromPromise(Promise.resolve(42));
 * ```
 *
 * @category extra
 */
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

/**
 * Reads an async iterable; each `next()` value becomes `DATA`; `COMPLETE` when done; `ERROR` on failure.
 *
 * @param iterable - Async source (`for await` shape).
 * @param opts - Producer options plus optional `signal` to abort the pump.
 * @returns `Node<T>` — async pull stream.
 *
 * @example
 * ```ts
 * import { fromAsyncIter } from "@graphrefly/graphrefly-ts";
 *
 * async function* gen() {
 *   yield 1;
 * }
 * fromAsyncIter(gen());
 * ```
 *
 * @category extra
 */
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
 * Coerces a value to a `Node` by shape: existing `Node` passthrough, thenable → {@link fromPromise},
 * async iterable → {@link fromAsyncIter}, sync iterable → {@link fromIter}, else scalar → {@link of}.
 *
 * @param input - Any value to wrap.
 * @param opts - Passed through when a Promise/async path is chosen.
 * @returns `Node` of the inferred element type.
 *
 * @example
 * ```ts
 * import { fromAny, state } from "@graphrefly/graphrefly-ts";
 *
 * fromAny(state(1));
 * fromAny(Promise.resolve(2));
 * ```
 *
 * @category extra
 */
export function fromAny<T>(input: NodeInput<T>, opts?: AsyncSourceOpts): Node<T> {
	if (isNode(input)) {
		return input as Node<T>;
	}
	if (isThenable(input)) {
		return fromPromise(input as PromiseLike<T>, opts);
	}
	if (input !== null && input !== undefined) {
		const candidate = input as { [Symbol.asyncIterator]?: unknown; [Symbol.iterator]?: unknown };
		if (typeof candidate[Symbol.asyncIterator] === "function") {
			return fromAsyncIter(input as AsyncIterable<T>, opts);
		}
		if (typeof candidate[Symbol.iterator] === "function") {
			return fromIter(input as Iterable<T>, opts);
		}
	}
	// scalar fallback
	return of(input as T);
}

/**
 * Emits each argument as `DATA` in order, then `COMPLETE` (implemented via {@link fromIter}).
 *
 * @param values - Values to emit.
 * @returns `Node<T>` — finite sequence.
 *
 * @example
 * ```ts
 * import { of } from "@graphrefly/graphrefly-ts";
 *
 * of(1, 2, 3);
 * ```
 *
 * @category extra
 */
export function of<T>(...values: T[]): Node<T> {
	return fromIter(values, undefined);
}

/**
 * Completes immediately with no `DATA` (cold `EMPTY` analogue).
 *
 * @param opts - Optional producer options.
 * @returns `Node<T>` — terminal `COMPLETE` only.
 *
 * @example
 * ```ts
 * import { empty } from "@graphrefly/graphrefly-ts";
 *
 * empty();
 * ```
 *
 * @category extra
 */
export function empty<T = never>(opts?: ExtraOpts): Node<T> {
	return producer<T>((_d, a) => {
		a.down([[COMPLETE]]);
		return undefined;
	}, sourceOpts(opts));
}

/**
 * Never emits and never completes until teardown (cold `NEVER` analogue).
 *
 * @param opts - Optional producer options.
 * @returns `Node<T>` — silent until unsubscribed.
 *
 * @example
 * ```ts
 * import { never } from "@graphrefly/graphrefly-ts";
 *
 * never();
 * ```
 *
 * @category extra
 */
export function never<T = never>(opts?: ExtraOpts): Node<T> {
	return producer<T>(() => undefined, sourceOpts(opts));
}

/**
 * Emits `ERROR` as soon as the producer starts (cold error source).
 *
 * @param err - Error payload forwarded as `ERROR` data.
 * @param opts - Optional producer options.
 * @returns `Node<never>` — terminates with `ERROR`.
 *
 * @example
 * ```ts
 * import { throwError } from "@graphrefly/graphrefly-ts";
 *
 * throwError(new Error("fail"));
 * ```
 *
 * @category extra
 */
export function throwError(err: unknown, opts?: ExtraOpts): Node<never> {
	return producer<never>((_d, a) => {
		a.down([[ERROR, err]]);
		return undefined;
	}, sourceOpts(opts));
}

/**
 * Subscribes immediately and runs `fn` for each upstream `DATA`; returns unsubscribe.
 *
 * @param source - Upstream node.
 * @param fn - Side effect per value.
 * @param opts - Effect node options.
 * @returns Unsubscribe function (idempotent).
 *
 * @example
 * ```ts
 * import { forEach, state } from "@graphrefly/graphrefly-ts";
 *
 * const u = forEach(state(1), (v) => console.log(v));
 * u();
 * ```
 *
 * @category extra
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
	return inner.subscribe(() => {});
}

/**
 * Buffers every `DATA`; on upstream `COMPLETE` emits one `DATA` with the full array then `COMPLETE`.
 *
 * @param source - Upstream node.
 * @param opts - Optional node options (operator describe kind).
 * @returns `Node<T[]>` — single array emission before completion.
 *
 * @example
 * ```ts
 * import { of, toArray } from "@graphrefly/graphrefly-ts";
 *
 * toArray(of(1, 2, 3));
 * ```
 *
 * @category extra
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
 * Multicasts upstream: one subscription to `source` while this wrapper has subscribers (via {@link producer}).
 *
 * @param source - Upstream node to share.
 * @param opts - Producer options; `initial` seeds from `source.get()` when set by factory.
 * @returns `Node<T>` — hot ref-counted bridge.
 *
 * @example
 * ```ts
 * import { share, state } from "@graphrefly/graphrefly-ts";
 *
 * share(state(0));
 * ```
 *
 * @category extra
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
 * Like {@link share} with a bounded replay buffer: new subscribers receive the last `bufferSize`
 * `DATA` payloads (as separate batches) before live updates.
 *
 * @param source - Upstream node.
 * @param bufferSize - Maximum past values to replay (≥ 1).
 * @param opts - Producer options.
 * @returns `Node<T>` — multicast with replay on subscribe.
 *
 * @example
 * ```ts
 * import { replay, state } from "@graphrefly/graphrefly-ts";
 *
 * replay(state(0), 3);
 * ```
 *
 * @category extra
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

/**
 * {@link replay} with `bufferSize === 1` — replays the latest `DATA` to new subscribers.
 *
 * @param source - Upstream node.
 * @param opts - Producer options.
 * @returns `Node<T>` — share + last-value replay.
 *
 * @example
 * ```ts
 * import { cached, state } from "@graphrefly/graphrefly-ts";
 *
 * cached(state(0));
 * ```
 *
 * @category extra
 */
export function cached<T>(source: Node<T>, opts?: ExtraOpts): Node<T> {
	return replay(source, 1, opts);
}

/**
 * Converts the first `DATA` on `source` into a Promise; rejects on `ERROR` or `COMPLETE` without data.
 *
 * **Important:** This subscribes and waits for a **future** emission. Data that
 * has already flowed is gone and will not be seen. Call this *before* the upstream
 * emits, or use `source.get()` / `source.status` for already-cached state.
 * See COMPOSITION-GUIDE §2 (subscription ordering).
 *
 * @param source - Node to read once.
 * @returns Promise of the first value.
 *
 * @example
 * ```ts
 * import { firstValueFrom, of } from "@graphrefly/graphrefly-ts";
 *
 * await firstValueFrom(of(42));
 * ```
 *
 * @category extra
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

/**
 * Wait for the first DATA value from `source` that satisfies `predicate`.
 *
 * Subscribes directly and resolves on the first DATA value where
 * `predicate` returns true. Reactive, no polling. Use in tests and
 * bridging code where you need a single matching value as a Promise.
 *
 * **Important:** This only captures **future** emissions — data that has
 * already flowed through the node is gone. Call this *before* the upstream
 * emits. For already-cached values, use `source.get()` / `source.status`.
 * See COMPOSITION-GUIDE §2 (subscription ordering).
 *
 * ```ts
 * const val = await firstWhere(strategy.node, snap => snap.size > 0);
 * ```
 *
 * @category extra
 */
export function firstWhere<T>(
	source: Node<T>,
	predicate: (value: T) => boolean,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const unsub = source.subscribe((msgs) => {
			for (const m of msgs) {
				if (settled) return;
				if (m[0] === DATA) {
					const v = m[1] as T;
					if (predicate(v)) {
						settled = true;
						resolve(v);
						queueMicrotask(() => unsub());
						return;
					}
				}
				if (m[0] === ERROR) {
					settled = true;
					reject(m[1]);
					queueMicrotask(() => unsub());
					return;
				}
				if (m[0] === COMPLETE) {
					settled = true;
					reject(new Error("completed without matching value"));
					queueMicrotask(() => unsub());
					return;
				}
			}
		});
	});
}

// ——————————————————————————————————————————————————————————————
//  RxJS-compatible aliases
// ——————————————————————————————————————————————————————————————

/**
 * RxJS-named alias for {@link replay} — multicast with a replay buffer of size `bufferSize`.
 *
 * @param source - Upstream node.
 * @param bufferSize - Replay depth (≥ 1).
 * @param opts - Producer options.
 * @returns Same behavior as `replay`.
 *
 * @example
 * ```ts
 * import { shareReplay, state } from "@graphrefly/graphrefly-ts";
 *
 * shareReplay(state(0), 5);
 * ```
 *
 * @category extra
 */
export const shareReplay = replay;
