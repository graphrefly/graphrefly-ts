import { isPhase2Message, type Message, type Messages } from "./messages.js";

/**
 * §1.3.7 — Inside a batch, DIRTY propagates immediately; DATA and RESOLVED are
 * deferred until the outermost `batch()` callback returns.
 */

let batchDepth = 0;
const pendingPhase2: Array<() => void> = [];

/**
 * Returns whether the current call stack is inside an outermost or nested `batch()`.
 *
 * @returns `true` while a `batch()` callback is running.
 */
export function isBatching(): boolean {
	return batchDepth > 0;
}

/**
 * Runs `fn` inside a batch scope. Nested `batch()` calls share one deferral queue.
 * If `fn` throws (including from a nested `batch`), deferred DATA/RESOLVED are
 * discarded for that outermost run — phase-2 is not flushed after an error.
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
				pendingPhase2.length = 0;
			} else {
				const ops = pendingPhase2.splice(0);
				for (const run of ops) {
					run();
				}
			}
		}
	}
}

/**
 * Splits a message array into immediate vs phase-2 tuples (`DATA`, `RESOLVED`).
 * Used by `emitWithBatch` and for tests.
 *
 * @param messages — One `down()` payload; order within each group is preserved.
 * @returns `immediate` (non-phase-2) and `deferred` (phase-2) tuples.
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
 * @param emit — Sink (e.g. subscriber or internal forwarder). Called one or two times per invocation when not batching, or once for immediate plus once when the batch flushes.
 * @param messages — Full `[[Type, Data?], ...]` array for one emission.
 *
 * @example
 * ```ts
 * import { core } from "@graphrefly/graphrefly-ts";
 *
 * core.emitWithBatch((msgs) => console.log(msgs), [[core.DIRTY], [core.DATA, 42]]);
 * ```
 */
export function emitWithBatch(emit: (messages: Messages) => void, messages: Messages): void {
	if (messages.length === 0) {
		return;
	}
	const { immediate, deferred } = partitionForBatch(messages);
	if (immediate.length > 0) {
		emit(immediate);
	}
	if (deferred.length === 0) {
		return;
	}
	if (batchDepth > 0) {
		pendingPhase2.push(() => emit(deferred));
	} else {
		emit(deferred);
	}
}
