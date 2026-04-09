import {
	DATA,
	isPhase2Message,
	isTerminalMessage,
	type Message,
	type Messages,
	messageTier,
	RESOLVED,
} from "./messages.js";

/**
 * §1.3.7 — Inside a batch, DIRTY propagates immediately; DATA and RESOLVED are
 * deferred until the outermost `batch()` callback returns. Terminal signals
 * (COMPLETE, ERROR) are delivered after phase-2 messages in the same batch
 * (see canonical ordering in `messages.ts`).
 */

const MAX_DRAIN_ITERATIONS = 1000;

let batchDepth = 0;
let flushInProgress = false;
const pendingPhase2: Array<() => void> = [];
const pendingPhase3: Array<() => void> = [];

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
 * @example
 * ```ts
 * import { batch, isBatching } from "@graphrefly/graphrefly-ts";
 *
 * batch(() => {
 *   console.log(isBatching()); // true
 * });
 * ```
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
 * During the drain loop, `isBatching()` remains true so nested `downWithBatch`
 * calls still defer phase-2 messages. The drain loop runs until the queue is
 * quiescent (no pending work remains). Per-emission try/catch ensures one
 * throwing callback does not orphan remaining emissions; the first error is
 * re-thrown after all emissions drain. Callbacks that ran before the throw may
 * have applied phase-2 — partial graph state is intentional (decision C1).
 *
 * @param fn — Synchronous work that may call `downWithBatch` / `node.down()`.
 * @returns `void` — all side-effects happen through `downWithBatch` and the
 *   phase-2 drain that runs after `fn` returns.
 *
 * @example
 * ```ts
 * import { core } from "@graphrefly/graphrefly-ts";
 *
 * core.batch(() => {
 *   core.downWithBatch(sink, [[core.DATA, 1]]);
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
					pendingPhase3.length = 0;
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
	const errors: unknown[] = [];
	try {
		let iterations = 0;
		// Drain phase-2 first, then phase-3. If phase-3 callbacks enqueue new
		// phase-2 work, the outer loop catches it and drains phase-2 again
		// before re-entering phase-3.
		while (pendingPhase2.length > 0 || pendingPhase3.length > 0) {
			// Phase-2 (DATA/RESOLVED) — parent node values settle here.
			while (pendingPhase2.length > 0) {
				iterations += 1;
				if (iterations > MAX_DRAIN_ITERATIONS) {
					pendingPhase2.length = 0;
					pendingPhase3.length = 0;
					throw new Error(
						`batch drain exceeded ${MAX_DRAIN_ITERATIONS} iterations — likely a reactive cycle`,
					);
				}
				const ops = pendingPhase2.splice(0);
				for (const run of ops) {
					try {
						run();
					} catch (e) {
						errors.push(e);
					}
				}
			}
			// Phase-3 — meta companion emissions that must follow parent settlement.
			if (pendingPhase3.length > 0) {
				iterations += 1;
				if (iterations > MAX_DRAIN_ITERATIONS) {
					pendingPhase2.length = 0;
					pendingPhase3.length = 0;
					throw new Error(
						`batch drain exceeded ${MAX_DRAIN_ITERATIONS} iterations — likely a reactive cycle`,
					);
				}
				const ops = pendingPhase3.splice(0);
				for (const run of ops) {
					try {
						run();
					} catch (e) {
						errors.push(e);
					}
				}
			}
		}
	} finally {
		if (ownsFlush) {
			flushInProgress = false;
		}
	}
	if (errors.length === 1) {
		throw errors[0];
	}
	if (errors.length > 1) {
		throw new AggregateError(errors, "batch drain: multiple callbacks threw");
	}
}

/**
 * Splits a message array into three groups by signal tier (see `messages.ts`):
 *
 * - **immediate** — tier 0–2, 5: START, DIRTY, INVALIDATE, PAUSE, RESUME, TEARDOWN, unknown
 * - **deferred** — tier 3: DATA, RESOLVED (phase-2, deferred inside `batch()`)
 * - **terminal** — tier 4: COMPLETE, ERROR (delivered after phase-2)
 *
 * Order within each group is preserved.
 *
 * @param messages — One `down()` payload.
 * @returns Three groups in canonical delivery order.
 *
 * @example
 * ```ts
 * import { DATA, DIRTY, COMPLETE, partitionForBatch } from "@graphrefly/graphrefly-ts";
 *
 * partitionForBatch([[DIRTY], [DATA, 1], [COMPLETE]]);
 * // { immediate: [[DIRTY]], deferred: [[DATA, 1]], terminal: [[COMPLETE]] }
 * ```
 *
 * @category core
 */
export function partitionForBatch(messages: Messages): {
	immediate: Messages;
	deferred: Messages;
	terminal: Messages;
} {
	const immediate: Message[] = [];
	const deferred: Message[] = [];
	const terminal: Message[] = [];
	for (const m of messages) {
		if (isPhase2Message(m)) {
			deferred.push(m);
		} else if (isTerminalMessage(m[0])) {
			terminal.push(m);
		} else {
			immediate.push(m);
		}
	}
	return { immediate, deferred, terminal };
}

/**
 * Delivers messages downstream through `sink`, applying batch semantics and
 * canonical tier-based ordering (see `messages.ts`):
 *
 * 1. **Immediate** (tier 0–2, 5): START, DIRTY, INVALIDATE, PAUSE, RESUME, TEARDOWN,
 *    unknown — delivered synchronously.
 * 2. **Phase-2** (tier 3): DATA, RESOLVED — deferred while `isBatching()`.
 * 3. **Terminal** (tier 4): COMPLETE, ERROR — always delivered after phase-2.
 *    When batching, terminal is queued after deferred phase-2 in the pending list.
 *    When not batching, terminal is delivered after phase-2 synchronously.
 *
 * This ordering prevents the "COMPLETE-before-DATA" class of bugs: terminal
 * signals never make a node terminal before phase-2 values reach sinks,
 * regardless of how the source assembled the message array.
 *
 * @param sink — Sink callback. May be called up to three times per invocation
 *   (immediate, deferred, terminal) when not batching.
 * @param messages — Full `[[Type, Data?], ...]` array for one downstream delivery.
 * @param phase — Starting delivery phase (`2` = data, `3` = terminal). Default `2`.
 * @param options - Optional configuration.
 * @option strategy | `"partition"` or `"sequential"` | `"partition"` | `"partition"` groups by tier; `"sequential"` preserves message order within each tier using `messageTier()` classification.
 * @returns `void` — delivery is performed through `sink` callbacks, synchronously
 *   or deferred into the active batch queue.
 *
 * @example
 * ```ts
 * import { core } from "@graphrefly/graphrefly-ts";
 *
 * core.downWithBatch((msgs) => console.log(msgs), [[core.DIRTY], [core.DATA, 42]]);
 * ```
 *
 * @category core
 */
/** Delivery strategy for {@link downWithBatch}. Mirrors Python `DownStrategy`. */
export type DownStrategy = "partition" | "sequential";

export function downWithBatch(
	sink: (messages: Messages) => void,
	messages: Messages,
	phase: 2 | 3 = 2,
	options?: { strategy?: DownStrategy },
): void {
	if (messages.length === 0) {
		return;
	}

	if (options?.strategy === "sequential") {
		_downSequential(sink, messages, phase);
		return;
	}

	const queue = phase === 3 ? pendingPhase3 : pendingPhase2;

	// Fast path: single-message batches (most common in graph-internal propagation)
	// skip partitionForBatch allocation entirely.
	if (messages.length === 1) {
		const t = messages[0][0];
		if (t === DATA || t === RESOLVED) {
			if (isBatching()) {
				queue.push(() => sink(messages));
			} else {
				sink(messages);
			}
		} else if (isTerminalMessage(t)) {
			// Terminal single message: defer when batching so any preceding
			// phase-2 in the queue flushes first.
			if (isBatching()) {
				queue.push(() => sink(messages));
			} else {
				sink(messages);
			}
		} else {
			// Immediate: deliver synchronously.
			sink(messages);
		}
		return;
	}
	// Multi-message: three-way partition by tier.
	const { immediate, deferred, terminal } = partitionForBatch(messages);

	// 1. Immediate signals (tier 0–2, 5) — deliver synchronously now.
	if (immediate.length > 0) {
		sink(immediate);
	}

	// 2. Deferred (tier 3) + Terminal (tier 4) — canonical order preserved.
	if (isBatching()) {
		if (deferred.length > 0) {
			queue.push(() => sink(deferred));
		}
		if (terminal.length > 0) {
			queue.push(() => sink(terminal));
		}
	} else {
		if (deferred.length > 0) {
			sink(deferred);
		}
		if (terminal.length > 0) {
			sink(terminal);
		}
	}
}

/**
 * Sequential strategy: walk messages one at a time. Phase-2 (DATA/RESOLVED) and
 * terminal (COMPLETE/ERROR) messages are deferred while batching; immediate
 * messages deliver synchronously. Matches graphrefly-py `_down_sequential`.
 *
 * Tier legend (after START introduction):
 *   0 = START              — immediate, delivered before other tiers
 *   1 = DIRTY, INVALIDATE  — immediate
 *   2 = PAUSE, RESUME      — immediate
 *   3 = DATA, RESOLVED     — deferred inside batch
 *   4 = COMPLETE, ERROR    — deferred to phase-3 queue (drains after data)
 *   5 = TEARDOWN           — deferred to phase-3 queue (drains after data)
 */
function _downSequential(
	sink: (messages: Messages) => void,
	messages: Messages,
	phase: 2 | 3 = 2,
): void {
	const dataQueue = phase === 3 ? pendingPhase3 : pendingPhase2;
	for (const msg of messages) {
		const tier = messageTier(msg[0]);
		if (tier === 3) {
			// Phase-2 (DATA/RESOLVED): defer while batching.
			if (isBatching()) {
				const m = msg;
				dataQueue.push(() => sink([m]));
			} else {
				sink([msg]);
			}
		} else if (tier >= 4) {
			// Terminal + destruction (COMPLETE/ERROR/TEARDOWN): always route to
			// phase-3 queue — terminals and teardown must drain after all phase-2
			// work to prevent premature termination or early resource release.
			if (isBatching()) {
				const m = msg;
				pendingPhase3.push(() => sink([m]));
			} else {
				sink([msg]);
			}
		} else {
			// Immediate (START, DIRTY, INVALIDATE, PAUSE, RESUME):
			// deliver synchronously.
			sink([msg]);
		}
	}
}
