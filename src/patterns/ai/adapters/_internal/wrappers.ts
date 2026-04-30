/**
 * Shared shell + shape-dispatch helpers for the LLM adapter layer.
 *
 * Wave A Unit 11 decision: the 9 middleware files and the observable adapter
 * all repeated the same three boilerplate patterns:
 *
 * 1. Building the returned `LLMAdapter` shell (provider/model/capabilities
 *    pass-through). → `adapterWrapper(inner, {invoke, stream})`.
 * 2. Dispatching the adapter's `NodeInput<LLMResponse>` result across its
 *    three possible shapes (Promise / Node / plain value) + a `recordedOnce`
 *    double-record guard on the reactive path. → `adaptInvokeResult`.
 * 3. Constructing a `CallStatsEvent` from provider / model / tier / usage /
 *    latency. → `buildCallStats`.
 *
 * Two small additions:
 * - `withLayer(adapter, layerName)` stamps a `meta.middlewareLayer` tag on
 *   the returned adapter via a non-enumerable property, enabling
 *   `describeAdapterStack(adapter)` to walk the wrap chain bottom-up.
 * - `describeAdapterStack(adapter)` returns the list of layer names from
 *   innermost to outermost so users can inspect the resilient stack the same
 *   way they inspect graph topology.
 */

import { monotonicNs, wallClockNs } from "../../../../core/clock.js";
import { ERROR } from "../../../../core/messages.js";
import { type Node, node } from "../../../../core/node.js";

import { onFirstData } from "../../../../extra/operators.js";
import { fromAny } from "../../../../extra/sources.js";
import type { CallStatsEvent } from "../core/observable.js";
import type {
	ChatMessage,
	LLMAdapter,
	LLMInvokeOptions,
	LLMResponse,
	NodeInput,
	StreamDelta,
	TokenUsage,
} from "../core/types.js";

// ---------------------------------------------------------------------------
// adapterWrapper — LLMAdapter shell with provider/model/capabilities pass-through
// ---------------------------------------------------------------------------

/** Callable shape for the invoke / stream bodies that `adapterWrapper` composes. */
export type AdapterInvokeFn = (
	messages: readonly ChatMessage[],
	opts?: LLMInvokeOptions,
) => NodeInput<LLMResponse>;

export type AdapterStreamFn = (
	messages: readonly ChatMessage[],
	opts?: LLMInvokeOptions,
) => AsyncIterable<StreamDelta>;

/**
 * Builds an `LLMAdapter` shell around the given `invoke` / `stream`
 * implementations. Pass-through fields — `provider`, `model`, `capabilities`
 * — come from `inner` unless the caller overrides (`override.provider` etc.).
 *
 * Middleware files used to repeat `provider: inner.provider, model: inner.model,
 * capabilities: inner.capabilities?.bind(inner)` verbatim; this helper
 * captures that once.
 *
 * @category internal
 */
export function adapterWrapper(
	inner: LLMAdapter,
	impl: { invoke: AdapterInvokeFn; stream: AdapterStreamFn },
	override?: Partial<Pick<LLMAdapter, "provider" | "model" | "capabilities">>,
): LLMAdapter {
	return {
		provider: override?.provider ?? inner.provider,
		model: override?.model ?? inner.model,
		capabilities: override?.capabilities ?? inner.capabilities?.bind(inner),
		invoke: impl.invoke,
		stream: impl.stream,
	};
}

// ---------------------------------------------------------------------------
// adaptInvokeResult — shape-dispatch for NodeInput<LLMResponse>
// ---------------------------------------------------------------------------

/**
 * Shape-dispatch helper for `inner.invoke(...)` return values. Converts any of
 * the three `NodeInput<LLMResponse>` shapes (Promise, plain value, Node /
 * iterable) into the caller-requested output, applying `onResp` exactly once
 * on the first DATA emission.
 *
 * **Paths.**
 * - `Promise<LLMResponse>` → `Promise<R>` (chains `onResp` via `.then`; if
 *   `onError` is provided, wires `.catch` so rejected Promises flow to the
 *   error path just like the stream body does).
 * - Plain `LLMResponse` (object with `content` field) → `R` (calls `onResp`
 *   synchronously and returns the mapped value).
 * - Anything else → reactive `Node<R>` via `fromAny` + `onFirstData(onResp)`
 *   so late subscribers don't re-fire the side effect.
 *
 * @category internal
 */
export function adaptInvokeResult<R>(
	input: NodeInput<LLMResponse>,
	opts: {
		onResp: (resp: LLMResponse) => R;
		/**
		 * If provided, rejected Promises are piped through this handler (for
		 * stats / budget recording) before re-throwing. Signature mirrors the
		 * stream try/catch shape so callers can share a single error-recording
		 * closure across both paths.
		 */
		onError?: (err: unknown) => void;
		/** Optional node name for the reactive-path derived (describe-friendly). */
		name?: string;
	},
): Promise<R> | R | Node<R> {
	const { onResp, onError, name } = opts;

	// Promise / thenable: chain .then, optionally .catch.
	if (input != null && typeof (input as PromiseLike<LLMResponse>).then === "function") {
		const p = input as Promise<LLMResponse>;
		if (onError) {
			return p.then(onResp).catch((err: unknown) => {
				onError(err);
				throw err;
			});
		}
		return p.then(onResp);
	}
	// Plain LLMResponse (synchronous).
	if (input != null && typeof input === "object" && "content" in (input as object)) {
		return onResp(input as LLMResponse);
	}
	// Reactive / iterable — map inside a `derived` guarded by `onFirstData`
	// so the side-effect fires exactly once per node lifetime (push-on-
	// subscribe replay on late subscribers is silent).
	const bridged = fromAny(input);
	// Wire `onError` via a side-subscription on the bridged node. `onFirstData`
	// only handles DATA — ERROR messages need their own hook so stats /
	// budget recording fires symmetrically with the Promise path. The
	// subscription runs for the lifetime of the derived below (keepalive via
	// the downstream derived's activation), and fires at most once per ERROR
	// frame. Without this, ERRORs on Node-shaped adapter returns silently
	// bypass budget/observable recording.
	if (onError) {
		let errored = false;
		bridged.subscribe((msgs) => {
			for (const m of msgs) {
				if (errored) return;
				if ((m as readonly [symbol, unknown])[0] === ERROR) {
					errored = true;
					onError((m as readonly [symbol, unknown])[1]);
				}
			}
		});
	}
	// `captured` holds the mapped value from the first DATA so re-subscribers
	// and re-emissions see a stable mapped value without re-firing `onResp`.
	// Use a distinct `mapped` sentinel (not nullish) because `onResp` may
	// legitimately return `null` / `undefined` / `0` — the prior
	// `captured ?? onResp(v)` guard re-fired `onResp` on falsy captured, which
	// broke the "exactly once per node lifetime" contract.
	let captured: R;
	let mapped = false;
	const tapped = onFirstData(bridged, (v) => {
		captured = onResp(v);
		mapped = true;
	});
	return node<R>(
		[tapped],
		(batchData, actions, ctx) => {
			const data = batchData.map((batch, i) =>
				batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
			);
			const v = data[0];
			if (v == null) {
				actions.emit(null as R);
				return;
			}
			if (mapped) {
				actions.emit(captured);
				return;
			}
			actions.emit(onResp(v as LLMResponse));
		},
		{ describeKind: "derived", name: name ?? "adapt/invokeTap" },
	);
}

// ---------------------------------------------------------------------------
// buildCallStats — CallStatsEvent constructor
// ---------------------------------------------------------------------------

export interface BuildCallStatsArgs {
	provider: string;
	model: string;
	tier?: string;
	usage: TokenUsage;
	startNs: number;
	method: "invoke" | "stream";
	error?: { readonly type: string; readonly message: string };
	/** Override the wall-clock stamp (useful for tests / replay). */
	startWallClockNs?: number;
	/** Override the monotonic end stamp (useful for tests). */
	endNs?: number;
}

/**
 * Constructs a {@link CallStatsEvent} from the arguments observable.ts and
 * budget-gate.ts used to assemble inline. The `timestamp` / `latencyMs` are
 * computed from `startNs` + (optional) `endNs`; `wallClock` is snapshot at
 * call-start via `wallClockNs()` unless overridden.
 *
 * @category internal
 */
export function buildCallStats(args: BuildCallStatsArgs): CallStatsEvent {
	const end = args.endNs ?? monotonicNs();
	return {
		timestamp: end,
		wallClock: args.startWallClockNs ?? wallClockNs(),
		provider: args.provider,
		model: args.model,
		tier: args.tier,
		usage: args.usage,
		latencyMs: Math.max(0, (end - args.startNs) / 1e6),
		method: args.method,
		...(args.error ? { error: args.error } : {}),
	};
}

/** Convenience — empty disaggregated usage stub used by every middleware. */
export function emptyUsageStub(): TokenUsage {
	return { input: { regular: 0 }, output: { regular: 0 } };
}

// ---------------------------------------------------------------------------
// meta.middlewareLayer + describeAdapterStack (Unit 11 Q1 user directive)
// ---------------------------------------------------------------------------

/** Symbol key carrying the wrap chain on the returned adapter. Non-enumerable. */
const MIDDLEWARE_LAYERS = Symbol.for("graphrefly.adapter.middlewareLayers");

/**
 * Stamp `adapter` with a middleware-layer name and return it. The stamp is a
 * non-enumerable property keyed by `Symbol.for("graphrefly.adapter.middlewareLayers")`
 * — opaque to users, visible via {@link describeAdapterStack}.
 *
 * Each wrap prepends its layer to `inner`'s chain so the stack can be walked
 * bottom-up (innermost first). Providers have no layer stamp — they show up
 * as the bottom of the chain via their `provider` / `model` identity.
 *
 * @category internal
 */
export function withLayer<A extends LLMAdapter>(
	adapter: A,
	layerName: string,
	inner?: LLMAdapter,
): A {
	const innerLayers = inner ? readLayers(inner) : [];
	const chain = [...innerLayers, layerName];
	Object.defineProperty(adapter, MIDDLEWARE_LAYERS, {
		value: Object.freeze(chain),
		enumerable: false,
		writable: false,
		configurable: false,
	});
	return adapter;
}

/**
 * Returns the middleware-layer names stamped on `adapter`, innermost first.
 * An adapter that has never been wrapped returns `[]` — callers combine the
 * result with `adapter.provider` / `adapter.model` for a full stack render.
 *
 * @example
 * ```ts
 * const stack = describeAdapterStack(resilientAdapter(anthropicAdapter(), opts).adapter);
 * // → ["withTimeout", "withRetry", "withBreaker", "withBudgetGate", "withRateLimiter", "cascade"]
 * ```
 *
 * @category extra
 */
export function describeAdapterStack(adapter: LLMAdapter): readonly string[] {
	return readLayers(adapter);
}

function readLayers(adapter: LLMAdapter): readonly string[] {
	const v = (adapter as unknown as Record<symbol, unknown>)[MIDDLEWARE_LAYERS];
	return Array.isArray(v) ? (v as readonly string[]) : [];
}
