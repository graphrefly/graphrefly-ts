/**
 * Thrown by {@link Node.subscribe} when the target node is
 * non-resubscribable AND has terminated (per canonical spec R2.2.7.b,
 * D118 / 2026-05-10). The stream is permanently over; the late
 * subscriber receives no handshake.
 *
 * Operators that subscribe to upstream sources (zip, concat, race,
 * `takeUntil`, mergeMap, switchMap, exhaustMap, concatMap, buffer,
 * throttle, debounce, sample, etc.) MUST handle this rejection by
 * skipping the dead source (e.g., concat advances to the next source;
 * zip self-completes since no tuple can ever form; merge_map decrements
 * its active count). See operator docs for per-operator semantics.
 *
 * Mirrors Rust `SubscribeError::TornDown { node }` for cross-impl parity.
 *
 * @example
 * ```ts
 * import { TornDownError } from "@graphrefly/graphrefly";
 * try {
 *   const unsub = deadNode.subscribe(sink);
 * } catch (e) {
 *   if (e instanceof TornDownError) {
 *     // Source is permanently over; handle per operator semantics.
 *   } else {
 *     throw e;
 *   }
 * }
 * ```
 */
export class TornDownError extends Error {
	readonly nodeName: string;
	readonly status: string;

	constructor(nodeName: string, status: string, message?: string) {
		super(
			message ??
				`subscribe(${nodeName}): node is non-resubscribable and has terminated; the stream is permanently over (R2.2.7.b)`,
		);
		this.name = "TornDownError";
		this.nodeName = nodeName;
		this.status = status;
	}
}

/**
 * Discriminator helper for matching the rejection branch without
 * `instanceof` (useful in minified / cross-realm setups).
 */
export function isTornDownError(err: unknown): err is TornDownError {
	return err instanceof Error && (err as Error).name === "TornDownError";
}

/**
 * Outcome of {@link trySubscribeOrDead} — operators that want
 * per-op dead-source semantics inspect this rather than relying on
 * try/catch boilerplate.
 *
 * Mirrors Rust `SubscribeOutcome` for cross-impl parity. Three
 * variants:
 *
 * - `{ kind: "live", unsub }` — sink installed; call `unsub()` to
 *   detach.
 * - `{ kind: "dead", node }` — source is non-resubscribable +
 *   terminal (R2.2.7.b). Sink was NOT installed. Operators should
 *   treat the source as Complete-equivalent for their lifecycle.
 *
 * Note: TS does not have a separate "Deferred" outcome — TS is
 * single-threaded so the Phase H+ ascending-order defer path
 * doesn't apply. The Rust enum's `Deferred` variant has no TS
 * analog.
 */
export type SubscribeOutcome = { kind: "live"; unsub: () => void } | { kind: "dead"; node: string };

/**
 * Subscribe with R2.2.7.b rejection translated to a typed outcome
 * rather than a thrown {@link TornDownError}. Operators that want
 * Dead-source-aware behavior (zip self-completes, concat advances,
 * race marks completed, take_until self-completes, etc.) match on
 * the outcome instead of using try/catch.
 *
 * @example
 * ```ts
 * import { trySubscribeOrDead } from "@graphrefly/graphrefly";
 *
 * const outcome = trySubscribeOrDead(source, sink);
 * if (outcome.kind === "dead") {
 *   // R2.2.7.b: source is permanently over. Per-op handling
 *   // (e.g., zip self-completes; concat advances; etc.)
 * } else {
 *   // outcome.kind === "live"; sink installed.
 *   subs.push(outcome.unsub);
 * }
 * ```
 */
export function trySubscribeOrDead<T>(
	source: { subscribe: (sink: (msgs: readonly unknown[]) => void) => () => void; name?: string },
	sink: (msgs: readonly T[]) => void,
): SubscribeOutcome {
	try {
		const unsub = source.subscribe(sink as (msgs: readonly unknown[]) => void);
		return { kind: "live", unsub };
	} catch (err) {
		if (isTornDownError(err)) {
			return { kind: "dead", node: err.nodeName };
		}
		throw err;
	}
}

/**
 * Convenience helper for operators that want to wrap a subscribe site
 * with R2.2.7.b Dead-source handling but don't want the verbose
 * `match outcome.kind === "dead"` boilerplate.
 *
 * On a live subscribe, returns the unsub function (drop-in
 * replacement for `source.subscribe(sink)`). On a Dead subscribe,
 * invokes `onDead` (per-op semantics — typically
 * `actions.down([[COMPLETE]])` for stream-transforming operators
 * that have nothing to emit when the source is permanently over) and
 * returns a no-op unsub function so the caller's cleanup chain stays
 * uniform.
 *
 * @example
 * ```ts
 * const srcUnsub = subscribeOr(source, (msgs) => {
 *   // normal sink body
 * }, () => {
 *   // Dead source: per-op handling (e.g., self-Complete).
 *   a.down([[COMPLETE]]);
 * });
 * ```
 *
 * @param source - The upstream node.
 * @param sink - Message-handling closure (matches the source's
 *   `subscribe` callback shape).
 * @param onDead - Called when the source rejects with `TornDownError`
 *   (non-resubscribable + terminal). Per-op handlers go here.
 * @returns Unsubscribe function. No-op when source was Dead; the
 *   real `() => void` from `subscribe` otherwise.
 */
export function subscribeOr<T>(
	source: { subscribe: (sink: (msgs: readonly unknown[]) => void) => () => void; name?: string },
	sink: (msgs: readonly T[]) => void,
	onDead: () => void,
): () => void {
	const outcome = trySubscribeOrDead<T>(source, sink);
	if (outcome.kind === "dead") {
		onDead();
		return () => {};
	}
	return outcome.unsub;
}
