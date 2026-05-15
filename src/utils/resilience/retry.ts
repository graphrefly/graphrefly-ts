/**
 * Retry — re-attempt a node on terminal failure.
 *
 * Two modes selected by the type of `input`:
 * - **Source mode** (`Node<T>`): resubscribes the same node after each ERROR.
 *   Upstream must be `resubscribable: true` or retries are silent no-ops.
 * - **Factory mode** (`() => Node<T>`): builds a fresh node per attempt.
 *
 * Shared with `circuitBreaker` / `rateLimiter`: `NodeOrValue<RetryOptions>`
 * lets callers swap retry config reactively (re-validates on each attempt).
 */

import {
	COMPLETE,
	DATA,
	DIRTY,
	ERROR,
	factoryTag,
	type Message,
	type Node,
	node,
	RESOLVED,
} from "@graphrefly/pure-ts/core";
import { ResettableTimer } from "../../base/utils/resettable-timer.js";
import { coerceDelayNs, isNode, msgVal, type NodeOrValue, operatorOpts } from "./_internal.js";
import {
	type BackoffPreset,
	type BackoffStrategy,
	NS_PER_MS,
	resolveBackoffPreset,
} from "./backoff.js";
import type { StatusValue } from "./status.js";

/**
 * Lifecycle-shaped state companion emitted by {@link retry} (DS-13.5.B,
 * locked 2026-05-01). Tracks the retry state machine's current status,
 * the attempt counter, and the last scheduled delay (null before the
 * first retry).
 *
 * @category extra/resilience
 */
export interface RetryState {
	status: StatusValue;
	attempt: number;
	lastDelay_ns: number | null;
}

/**
 * Bundle returned by {@link retry}: the retry-wrapped output node and its
 * lifecycle state companion. Pre-1.0 break vs the prior `Node<T>` return.
 *
 * **Single-subscriber / pipeline-only contract (DS-13.5.B QA, N1, 2026-05-03).**
 * The `retryState` companion is allocated once at factory time and shared
 * across all subscribers to `node`. With one subscriber (the typical use
 * case — wire `node` into your downstream chain, optionally observe
 * `retryState` separately) the companion reflects a coherent timeline.
 * With **two or more subscribers** to `node`, each subscriber re-runs the
 * producer body and writes into the same `retryState`, including
 * `publish("pending")` resets that can clobber an in-flight machine's
 * `running`/`paused` state. Don't fan out `node` to multiple subscribers
 * and rely on `retryState` accuracy unless you use
 * {@link keepalive} / `share`-style consolidation.
 *
 * @category extra/resilience
 */
export interface RetryBundle<T> {
	node: Node<T>;
	retryState: Node<RetryState>;
}

export type RetryOptions = {
	/**
	 * Max retry attempts after each terminal `ERROR` (not counting the first failure).
	 *
	 * **Required when `backoff` is set.** Pass `Infinity` to opt in to unbounded retries
	 * — the explicit value rules out the silent-infinite-budget footgun (a flaky provider
	 * + exponential backoff + omitted `count` would previously default to ~2.1B retries).
	 */
	count?: number;
	/** Delay between attempts; strategies use **nanoseconds**. */
	backoff?: BackoffStrategy | BackoffPreset;
	/**
	 * Caller-supplied metadata merged into the produced node's `meta` (Tier 5.2
	 * D8 widening). Use {@link domainMeta} to tag the layer for `describe()`
	 * grouping. The primitive's `factoryTag("retry", …)` always wins against
	 * caller keys.
	 */
	meta?: Record<string, unknown>;
};

/** Factory-mode-only options. `initial` seeds the outer node's cache before the first attempt. */
export type RetryFactoryOptions<T> = RetryOptions & {
	/** Initial cache value for the outer node before the factory runs the first time. */
	initial?: T;
};

/**
 * Resolved retry config shared by source-mode and factory-mode wrappers.
 * Centralises the unbounded-retry footgun guard and strategy resolution.
 */
type ResolvedRetryConfig = {
	maxRetries: number;
	strategy: BackoffStrategy | null;
};

function resolveRetryConfig(opts?: RetryOptions): ResolvedRetryConfig {
	const count = opts?.count;
	const backoffOpt = opts?.backoff;

	// Unbounded-retry footgun fix: if `backoff` is set without explicit `count`,
	// throw at construction time. Caller must opt in to `Infinity` for unbounded.
	if (backoffOpt !== undefined && count === undefined) {
		throw new RangeError(
			"retry({ backoff }) requires explicit count to prevent unbounded retries; pass { count: <n>, backoff: ... }",
		);
	}

	const maxRetries = count !== undefined ? count : 0;
	if (maxRetries < 0) throw new RangeError("retry count must be >= 0");

	const strategy: BackoffStrategy | null =
		backoffOpt === undefined
			? null
			: typeof backoffOpt === "string"
				? resolveBackoffPreset(backoffOpt)
				: backoffOpt;

	return { maxRetries, strategy };
}

function retryFactoryArgs(opts?: RetryOptions): Record<string, unknown> | undefined {
	const args: Record<string, unknown> = {};
	if (opts?.count !== undefined) args.count = opts.count;
	if (typeof opts?.backoff === "string") args.backoff = opts.backoff;
	return Object.keys(args).length > 0 ? args : undefined;
}

/**
 * Shared retry state machine. Both `_retrySource` and `_retryFactory` thin-wrap this:
 * the only per-mode logic is supplied via `acquireSource` (returns a fresh `Node<T>`
 * per attempt — for source-mode it just returns the captured `Node`; for factory-mode
 * it calls the user factory and forwards synchronous throws into the same retry path).
 *
 * **Reactive cfg (Tier 6.5 3.2.2, 2026-04-29).** `getCfg` is invoked at
 * every decision point (`scheduleRetryOrFinish` count + strategy reads)
 * so option swaps mid-flight take effect at the next attempt boundary
 * per the locked semantic rule: "next attempt fails immediately if
 * already exhausted under new count; `backoff` swap takes effect at next
 * retry's delay calculation."
 */
function _runRetryStateMachine<T>(
	getCfg: () => ResolvedRetryConfig,
	acquireSource: () => Node<T>,
	a: { emit: (v: T) => void; down: (msgs: Message[]) => void },
	emitState?: (next: RetryState) => void,
): () => void {
	let attempt = 0;
	let stopped = false;
	let prevDelay: number | null = null;
	let unsub: (() => void) | undefined;
	const timer = new ResettableTimer();
	const publish = (status: StatusValue): void => {
		emitState?.({ status, attempt, lastDelay_ns: prevDelay });
	};
	publish("pending");

	function disconnectUpstream(): void {
		unsub?.();
		unsub = undefined;
	}

	function scheduleRetryOrFinish(err: unknown): void {
		if (stopped) return;
		const cfg = getCfg();
		if (attempt >= cfg.maxRetries) {
			disconnectUpstream();
			publish("errored");
			a.down([[ERROR, err]]);
			return;
		}
		const raw = cfg.strategy === null ? 0 : cfg.strategy(attempt, err, prevDelay);
		// null from strategy = "stop retrying" (e.g. withMaxAttempts cap reached)
		if (raw === null || raw === undefined) {
			disconnectUpstream();
			publish("errored");
			a.down([[ERROR, err]]);
			return;
		}
		// A misbehaving strategy (returns NaN / non-finite / negative) MUST NOT
		// escape into the upstream drain. Treat it like `strategy === null`
		// (stop retrying) and emit the original error — the strategy bug is a
		// separate concern the user can inspect via the emitted error's stack.
		let delayNs: number;
		try {
			delayNs = coerceDelayNs(raw);
		} catch {
			disconnectUpstream();
			publish("errored");
			a.down([[ERROR, err]]);
			return;
		}
		prevDelay = delayNs;
		attempt += 1;
		disconnectUpstream();
		publish("paused");
		// `Math.max(1, …)` floor: every backoff schedule floors at 1ms even when
		// the strategy returns 0ns. Avoids 0-delay re-entrancy on the active
		// stack frame (which would risk stack overflow on a tight ERROR loop).
		const delayMs = delayNs > 0 ? delayNs / NS_PER_MS : 1;
		// §5.10: setTimeout (not fromTimer) — retry delay needs clearTimeout/setTimeout;
		// fromTimer creates a new Node per reset, adding lifecycle overhead per retry.
		timer.start(delayMs, () => {
			if (stopped) return;
			connect();
		});
	}

	function connect(): void {
		timer.cancel();
		disconnectUpstream();
		let src: Node<T>;
		try {
			src = acquireSource();
		} catch (err) {
			scheduleRetryOrFinish(err);
			return;
		}
		publish("running");
		unsub = src.subscribe((msgs) => {
			if (stopped) return;
			for (const m of msgs) {
				const t = m[0];
				if (t === DIRTY) a.down([[DIRTY]]);
				else if (t === DATA) {
					attempt = 0;
					prevDelay = null;
					a.emit(m[1] as T);
					publish("running");
				} else if (t === RESOLVED) a.down([[RESOLVED]]);
				else if (t === COMPLETE) {
					// DF2 (2026-04-29): set `stopped = true` BEFORE
					// `disconnectUpstream()` so a re-entrant ERROR delivered
					// in the same wave (after disconnect runs but before the
					// teardown closure fires `stopped = true`) hits the
					// `if (stopped) return` guard at line 159 and cannot
					// schedule a new retry timer.
					stopped = true;
					disconnectUpstream();
					publish("completed");
					a.down([[COMPLETE]]);
				} else if (t === ERROR) {
					scheduleRetryOrFinish(msgVal(m));
					return;
				} else a.down([m]);
			}
		});
	}

	connect();

	return () => {
		const wasStopped = stopped;
		stopped = true;
		timer.cancel();
		disconnectUpstream();
		if (!wasStopped) publish("cancelled");
	};
}

/**
 * Retry operator — two modes selected by the type of `input`:
 *
 * **Source mode** (`input: Node<T>`): resubscribes to the same node after each terminal
 * `ERROR`. The upstream should use `resubscribable: true` if it must emit again after `ERROR`.
 *
 * **Factory mode** (`input: () => Node<T>`): invokes the factory to build a fresh `Node<T>`
 * on every connect / reconnect. Ideal for producers that capture per-attempt resources
 * (sockets, clients, file handles) that become unusable after an error. Synchronous
 * exceptions thrown by the factory are treated as terminal ERROR and run through the
 * same retry pipeline as inner-node ERROR.
 *
 * @param input - Upstream node or factory that returns a fresh node per attempt.
 * @param opts - `count` caps attempts (**required when `backoff` is set**; pass `Infinity` to opt in to unbounded); `backoff` supplies delay in **nanoseconds** (or a preset name); `initial` seeds the outer node cache (factory mode only).
 * @returns Node that retries on error.
 *
 * @throws {RangeError} when `backoff` is provided without an explicit `count` (unbounded-retry footgun guard) or when `count < 0`.
 *
 * @remarks
 * **Protocol:** Forwards unknown message tuples unchanged; handles `DIRTY`, `DATA`, `RESOLVED`, `COMPLETE`, `ERROR`.
 *
 * **Backoff floor:** every scheduled delay is floored at 1ms via `Math.max(1, delayNs / NS_PER_MS)` even when the strategy returns 0ns. This avoids 0-delay re-entrancy on the active stack frame on a tight ERROR loop. Strategies that return `null`/`undefined` stop retrying immediately and forward the original error.
 *
 * @example
 * ```ts
 * // Source mode — resubscribe the same node:
 * import { ERROR, NS_PER_SEC, producer, retry, constant } from "@graphrefly/graphrefly-ts";
 *
 * const src = producer(
 *   (a) => { a.down([[ERROR, new Error("x")]]); },
 *   { resubscribable: true },
 * );
 * const out = retry(src, { count: 2, backoff: constant(0.25 * NS_PER_SEC) });
 *
 * // Factory mode — fresh node per attempt (e.g. reconnecting WebSocket):
 * import { NS_PER_SEC, exponential, retry, fromWebSocket } from "@graphrefly/graphrefly-ts";
 *
 * const connected$ = retry(
 *   () => fromWebSocket(new WebSocket("wss://example/stream")),
 *   { count: 10, backoff: exponential({ baseNs: 1 * NS_PER_SEC }) },
 * );
 * ```
 *
 * @category extra
 */
export function retry<T>(input: Node<T>, opts?: NodeOrValue<RetryOptions>): RetryBundle<T>;
export function retry<T>(
	input: () => Node<T>,
	opts?: NodeOrValue<RetryFactoryOptions<T>>,
): RetryBundle<T>;
export function retry<T>(
	input: Node<T> | (() => Node<T>),
	opts?: NodeOrValue<RetryOptions | RetryFactoryOptions<T>>,
): RetryBundle<T> {
	const retryState = node<RetryState>([], {
		name: "retryState",
		describeKind: "state",
		initial: { status: "pending", attempt: 0, lastDelay_ns: null },
		equals: (a, b) =>
			a === b ||
			(a != null &&
				b != null &&
				typeof a === "object" &&
				typeof b === "object" &&
				JSON.stringify(a) === JSON.stringify(b)),
	});
	const emit = (s: RetryState): void => {
		retryState.down([[DIRTY], [DATA, s]]);
	};
	if (typeof input === "function") {
		return {
			node: _retryFactory(input, opts as NodeOrValue<RetryFactoryOptions<T>> | undefined, emit),
			retryState,
		};
	}
	return {
		node: _retrySource(input, opts as NodeOrValue<RetryOptions> | undefined, emit),
		retryState,
	};
}

// DS-13.5.B helper: like `resolveReactiveOption` but shallow-merges each
// reactive emit over the prior opts and treats empty `{}` as a no-op
// (per the locked cross-cutting rule). Static-form arg returns the value
// as-is and never subscribes.
function makeMergedOptsMirror<R extends Record<string, unknown>>(
	arg: NodeOrValue<R> | undefined,
): { current: () => R | undefined; unsub: () => void } {
	if (arg === undefined) {
		return { current: () => undefined, unsub: () => undefined };
	}
	if (!isNode(arg)) {
		return { current: () => arg as R, unsub: () => undefined };
	}
	const optsNode = arg as Node<R>;
	let merged: R | undefined = (optsNode.cache as R | undefined) ?? undefined;
	const unsub = optsNode.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] !== DATA) continue;
			const next = m[1] as R | undefined;
			if (next == null || typeof next !== "object") continue;
			if (Object.keys(next).length === 0) continue; // empty {} no-op
			merged = { ...(merged ?? ({} as R)), ...next } as R;
		}
	});
	return { current: () => merged, unsub };
}

// DF6 (2026-04-29): once-per-source dedup for the source-mode-retry warn.
// Mirrors the `_bumpCursorWarned` pattern in `extra/mutation/index.ts`.
const _retrySourceNonResubscribableWarned = new WeakSet<Node<unknown>>();

function _retrySource<T>(
	source: Node<T>,
	opts?: NodeOrValue<RetryOptions>,
	emitState?: (s: RetryState) => void,
): Node<T> {
	// Source-mode retry re-subscribes to the SAME source node after each
	// terminal ERROR. If the upstream was constructed with the default
	// `resubscribable: false`, the second subscribe-after-terminal is a
	// silent no-op and retries effectively never re-deliver. Surface
	// once-per-source so misconfigurations fail loud without log spam.
	const sourceWithFlag = source as unknown as { _resubscribable?: boolean };
	if (
		sourceWithFlag._resubscribable === false &&
		!_retrySourceNonResubscribableWarned.has(source)
	) {
		_retrySourceNonResubscribableWarned.add(source);
		console.warn(
			"retry(source, opts): source-mode requires `resubscribable: true` on the upstream " +
				"node. Retries will be silent no-ops after the first ERROR. Either pass " +
				"`resubscribable: true` to the source factory, OR use factory-mode retry " +
				"`retry(() => buildSource(), opts)` so each attempt builds a fresh node.",
		);
	}
	const staticOpts = isNode(opts) ? undefined : (opts as RetryOptions | undefined);
	// Eager validation for static-form opts (preserves construction-time
	// "backoff without count" RangeError). Reactive-form opts re-validate
	// per `getCfg()` call inside the state machine.
	if (!isNode(opts)) resolveRetryConfig(staticOpts);
	return node<T>(
		(_data, a) => {
			const merged = makeMergedOptsMirror<RetryOptions>(opts);
			const getCfg = (): ResolvedRetryConfig => resolveRetryConfig(merged.current());
			const inner = _runRetryStateMachine(getCfg, () => source, a, emitState);
			return () => {
				inner();
				merged.unsub();
			};
		},
		{
			...operatorOpts(),
			initial: source.cache,
			meta: {
				...(staticOpts?.meta ?? {}),
				...factoryTag(
					"retry",
					isNode(opts) ? { reactiveOpts: true } : retryFactoryArgs(staticOpts),
				),
			},
		},
	);
}

function _retryFactory<T>(
	factory: () => Node<T>,
	opts?: NodeOrValue<RetryFactoryOptions<T>>,
	emitState?: (s: RetryState) => void,
): Node<T> {
	const staticOpts = isNode(opts) ? undefined : (opts as RetryFactoryOptions<T> | undefined);
	// Eager validation for static-form opts (Tier 3.1 footgun preservation).
	if (!isNode(opts)) resolveRetryConfig(staticOpts);
	return node<T>(
		(_data, a) => {
			const merged = makeMergedOptsMirror<RetryFactoryOptions<T>>(opts);
			const getCfg = (): ResolvedRetryConfig => resolveRetryConfig(merged.current());
			const inner = _runRetryStateMachine(getCfg, factory, a, emitState);
			return () => {
				inner();
				merged.unsub();
			};
		},
		{
			...operatorOpts(),
			initial: staticOpts?.initial as T | undefined,
			meta: {
				...(staticOpts?.meta ?? {}),
				...factoryTag(
					"retry",
					isNode(opts) ? { reactiveOpts: true } : retryFactoryArgs(staticOpts),
				),
			},
		},
	);
}
