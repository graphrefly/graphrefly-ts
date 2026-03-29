import { DATA, isPhase2Message, type Message, type Messages, RESOLVED } from "./messages.js";

/**
 * §1.3.7 — Inside a batch, DIRTY propagates immediately; DATA and RESOLVED are
 * deferred until the outermost `batch()` callback returns.
 */

const MAX_DRAIN_ITERATIONS = 1000;

let batchDepth = 0;
let flushInProgress = false;
const pendingPhase2: Array<() => void> = [];

/**
 * Returns whether the current call stack is inside a batch scope **or** while
 * deferred phase-2 work is draining.
 *
 * Matching Python's `is_batching()` semantics: nested emissions during drain
 * are deferred until the current drain pass completes, preventing ordering
 * bugs when callbacks trigger further DATA/RESOLVED.
 *
 * @returns `true` while inside `batch()` or while the drain loop is running.
 *
 * @category core
 */
export function isBatching(): boolean {
	return batchDepth > 0 || flushInProgress;
}

/**
 * Runs `fn` inside a batch scope. Nested `batch()` calls share one deferral queue.
 * If `fn` throws (including from a nested `batch`), deferred DATA/RESOLVED for
 * that **outer** `batch` frame are discarded — phase-2 is not flushed after an
 * error. While the drain loop is running (`flushInProgress`), a nested `batch`
 * that throws must **not** clear the global queue (cross-language decision A4).
 *
 * During the drain loop, `isBatching()` remains true so nested `emitWithBatch`
 * calls still defer phase-2 messages. The drain loop runs until the queue is
 * quiescent (no pending work remains). Per-emission try/catch ensures one
 * throwing callback does not orphan remaining emissions; the first error is
 * re-thrown after all emissions drain. Callbacks that ran before the throw may
 * have applied phase-2 — partial graph state is intentional (decision C1).
 *
 * @param fn — Synchronous work that may call `emitWithBatch` / `node.down()`.
 *
 * @example
 * ```ts
 * import { core } from "@graphrefly/graphrefly-ts";
 *
 * core.batch(() => {
 *   core.emitWithBatch(sink, [[core.DATA, 1]]);
 * });
 * ```
 *
 * @category core
 */
export function batch(fn: () => void): void {
	batchDepth += 1;
	let threw = false;
	try {
		fn();
	} catch (e) {
		threw = true;
		throw e;
	} finally {
		batchDepth -= 1;
		if (batchDepth === 0) {
			if (threw) {
				// Do not wipe the outer drain's queue (decision A4).
				if (!flushInProgress) {
					pendingPhase2.length = 0;
				}
			} else {
				drainPending();
			}
		}
	}
}

function drainPending(): void {
	const ownsFlush = !flushInProgress;
	if (ownsFlush) {
		flushInProgress = true;
	}
	let firstError: unknown;
	let hasError = false;
	try {
		let iterations = 0;
		while (pendingPhase2.length > 0) {
			iterations += 1;
			if (iterations > MAX_DRAIN_ITERATIONS) {
				pendingPhase2.length = 0;
				throw new Error(
					`batch drain exceeded ${MAX_DRAIN_ITERATIONS} iterations — likely a reactive cycle`,
				);
			}
			const ops = pendingPhase2.splice(0);
			for (const run of ops) {
				try {
					run();
				} catch (e) {
					if (!hasError) {
						firstError = e;
						hasError = true;
					}
				}
			}
		}
	} finally {
		if (ownsFlush) {
			flushInProgress = false;
		}
	}
	if (hasError) {
		throw firstError;
	}
}

/**
 * Splits a message array into immediate vs phase-2 tuples (`DATA`, `RESOLVED`).
 * Used by `emitWithBatch` and for tests.
 *
 * @param messages — One `down()` payload; order within each group is preserved.
 * @returns `immediate` (non-phase-2) and `deferred` (phase-2) tuples.
 *
 * @category core
 */
export function partitionForBatch(messages: Messages): {
	immediate: Messages;
	deferred: Messages;
} {
	const immediate: Message[] = [];
	const deferred: Message[] = [];
	for (const m of messages) {
		if (isPhase2Message(m)) {
			deferred.push(m);
		} else {
			immediate.push(m);
		}
	}
	return { immediate, deferred };
}

/**
 * Delivers messages through `emit`, applying batch semantics: non-phase-2 runs
 * immediately; `DATA` and `RESOLVED` are deferred until the outermost `batch()`
 * completes successfully (in registration order).
 *
 * Phase-2 messages are deferred whenever `isBatching()` is true — i.e. while
 * inside a `batch()` scope **or** while the drain loop is running. This matches
 * Python's `defer_when="batching"` semantics and prevents ordering issues when
 * deferred callbacks trigger further emissions.
 *
 * @param emit — Sink (e.g. subscriber or internal forwarder). Called one or two times per invocation when not batching, or once for immediate plus once when the batch flushes.
 * @param messages — Full `[[Type, Data?], ...]` array for one emission.
 *
 * @example
 * ```ts
 * import { core } from "@graphrefly/graphrefly-ts";
 *
 * core.emitWithBatch((msgs) => console.log(msgs), [[core.DIRTY], [core.DATA, 42]]);
 * ```
 *
 * @category core
 */
export function emitWithBatch(emit: (messages: Messages) => void, messages: Messages): void {
	if (messages.length === 0) {
		return;
	}
	// Fast path: single-message batches (most common in graph-internal propagation)
	// skip partitionForBatch allocation entirely.
	if (messages.length === 1) {
		const t = messages[0][0];
		if (t === DATA || t === RESOLVED) {
			if (isBatching()) {
				pendingPhase2.push(() => emit(messages));
			} else {
				emit(messages);
			}
		} else {
			emit(messages);
		}
		return;
	}
	// Multi-message: partition into immediate and deferred to preserve
	// two-phase ordering (DIRTY propagates before DATA for diamond settlement).
	const { immediate, deferred } = partitionForBatch(messages);
	if (immediate.length > 0) {
		emit(immediate);
	}
	if (deferred.length === 0) {
		return;
	}
	if (isBatching()) {
		pendingPhase2.push(() => emit(deferred));
	} else {
		emit(deferred);
	}
}
