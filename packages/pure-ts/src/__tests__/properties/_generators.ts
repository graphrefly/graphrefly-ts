/**
 * Shared fast-check generators for the protocol-invariant harness.
 *
 * Topologies live next to the invariants that exercise them (`_invariants.ts`)
 * — each invariant picks the smallest topology that demonstrates the property.
 * This module ships only the **event-sequence** vocabulary used to drive those
 * topologies and the trace-recording helpers shared by every invariant.
 *
 * See `archive/docs/SESSION-rigor-infrastructure-plan.md` § "Project 1" for the
 * full motivation and the 9-invariant target list (first 6 land here).
 */

import * as fc from "fast-check";
import { batch } from "../../core/batch.js";
import { COMPLETE, START } from "../../core/messages.js";
import type { Node } from "../../core/node.js";

// ---------------------------------------------------------------------------
// Event vocabulary
// ---------------------------------------------------------------------------

export type EmitEvent = { readonly kind: "emit"; readonly value: number };
export type BatchEvent = { readonly kind: "batch"; readonly values: readonly number[] };
export type CompleteEvent = { readonly kind: "complete" };
export type Event = EmitEvent | BatchEvent | CompleteEvent;

export interface EventSequenceOptions {
	readonly maxLen?: number;
	/** Inclusive value range for emitted numbers. Small alphabet exercises equals-substitution. */
	readonly valueRange?: readonly [number, number];
	/**
	 * Cap on source emits inside one `batch` event. Defaults to 4 (full
	 * coverage). Set to `1` to keep batches structurally present but with a
	 * single emit each — used by invariant #4 to dodge the documented
	 * "multi-emit batch fires K+1 settlements at fan-in" finding (see
	 * `docs/optimizations.md`).
	 */
	readonly maxBatchEmits?: number;
}

/**
 * fast-check arbitrary producing a list of state-mutation events. Never
 * emits `complete` — invariants that need a terminal inject one explicitly.
 * Values are drawn from a small alphabet (default 0–4) so equal-value
 * emissions are common, exercising the equals-substitution path.
 */
export function eventSequenceArb(opts: EventSequenceOptions = {}): fc.Arbitrary<readonly Event[]> {
	const [lo, hi] = opts.valueRange ?? [0, 4];
	const value = fc.integer({ min: lo, max: hi });
	const emitArb: fc.Arbitrary<EmitEvent> = fc.record({
		kind: fc.constant<"emit">("emit"),
		value,
	});
	const batchArb: fc.Arbitrary<BatchEvent> = fc.record({
		kind: fc.constant<"batch">("batch"),
		values: fc.array(value, { minLength: 1, maxLength: opts.maxBatchEmits ?? 4 }),
	});
	return fc.array(fc.oneof({ weight: 7, arbitrary: emitArb }, { weight: 2, arbitrary: batchArb }), {
		minLength: 1,
		maxLength: opts.maxLen ?? 10,
	});
}

// ---------------------------------------------------------------------------
// Source driver
// ---------------------------------------------------------------------------

/**
 * Apply one event to a source. Unexpected throws propagate as fast-check
 * property failures — that is the desired behaviour for the harness. Only
 * the post-COMPLETE skip is defensive; everything else trusts the substrate
 * to either succeed or expose a real bug.
 */
export function applyEvent(
	source: Node<number>,
	event: Event,
	completed: { value: boolean },
): void {
	if (completed.value) return;
	if (event.kind === "emit") {
		source.emit(event.value);
	} else if (event.kind === "batch") {
		batch(() => {
			for (const v of event.values) source.emit(v);
		});
	} else {
		source.down([[COMPLETE]]);
		completed.value = true;
	}
}

// ---------------------------------------------------------------------------
// Trace recording
// ---------------------------------------------------------------------------

export interface Trace {
	/** Flat list of message types in delivery order (START filtered). */
	readonly types: symbol[];
	/** Parallel array of payloads (`undefined` for tuples without a payload). */
	readonly values: unknown[];
	/**
	 * Position of the first post-activation message. Messages in
	 * `types[0..activationEnd-1]` came from the synchronous `subscribe()`
	 * handshake (push-on-subscribe, §2.2); messages at `activationEnd` and
	 * after are event-driven.
	 */
	readonly activationEnd: number;
}

/**
 * Subscribe to `node`, drive `events` against `source`, return the recorded
 * trace. `node` and `source` may be the same (invariants that observe the
 * source directly) or different (downstream invariants).
 *
 * `activationEnd` is captured the instant `subscribe()` returns, giving
 * invariants a clean boundary to skip push-on-subscribe deliveries without
 * depending on heuristics like "first DIRTY."
 */
export function captureTrace<T>(
	node: Node<T>,
	source: Node<number>,
	events: readonly Event[],
): Trace {
	const types: symbol[] = [];
	const values: unknown[] = [];
	const unsub = node.subscribe((msgs) => {
		for (const msg of msgs as readonly [symbol, unknown?][]) {
			if (msg[0] === START) continue;
			types.push(msg[0]);
			values.push(msg[1]);
		}
	});
	const activationEnd = types.length;
	const completed = { value: false };
	for (const e of events) applyEvent(source, e, completed);
	unsub();
	return { types, values, activationEnd };
}
