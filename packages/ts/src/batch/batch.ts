/**
 * Declarative batch (R-batch-coalesce / D12).
 *
 * Inside a batch, DIRTY propagates immediately but the tier-3 settle slice
 * (DATA/RESOLVED/INVALIDATE) is deferred to commit, so a shared downstream
 * recomputes ONCE after all batched sources settle. Success -> commit; a thrown
 * error -> rollback; `bctx.rollback()` is the explicit escape hatch.
 *
 * Coalescing note: this kernel coalesces multiple emits to the SAME node within
 * one batch to the latest tier-3 wave (last-value-wins). Full per-item batch-array
 * delivery (downstream fn receiving [v1..vK]) is a documented refinement — the
 * dominant use (coalescing a diamond join to one recompute) is exact here.
 */

import type { Wave } from "../protocol/messages.js";
import { enterWave, exitWave } from "./boundary.js";

/** A node target the batch can commit/rollback against (structural, avoids an import cycle). */
export interface BatchTarget {
	__commitBatchedWave(wave: Wave): void;
	__rollbackBatched(): void;
}

export interface BatchCtx {
	/** Discard all deferred emissions in this batch instead of committing. */
	rollback(): void;
}

interface ActiveBatch {
	order: BatchTarget[];
	deferred: Map<BatchTarget, Wave>;
	rolledBack: boolean;
}

let active: ActiveBatch | null = null;

export function currentBatch(): boolean {
	return active !== null;
}

/**
 * Defer a node's tier-3 settle slice into the active batch. Returns true if a batch
 * captured it; false if there is no active batch (caller emits normally).
 */
export function deferToBatch(target: BatchTarget, tier3Wave: Wave): boolean {
	if (active === null) return false;
	if (!active.deferred.has(target)) active.order.push(target);
	active.deferred.set(target, tier3Wave); // last-value coalescing
	return true;
}

function commit(b: ActiveBatch): void {
	for (const target of b.order) {
		const wave = b.deferred.get(target);
		if (wave) target.__commitBatchedWave(wave);
	}
}

function rollback(b: ActiveBatch): void {
	for (const target of b.order) target.__rollbackBatched();
}

/** Run `fn` as a batch (D12). DATA deferred to commit; throw/rollback discards. */
export function batch<R>(fn: (bctx: BatchCtx) => R): R {
	// Wave-owner boundary (R-rewire-deferred / D47): bracket the whole batch (fn + commit) so a
	// ctx.rewireNext issued by a fn that runs during COMMIT drains AFTER the commit, never on the
	// un-committed view. Inner waves (state.set, commit cascade) nest under this owner.
	enterWave();
	try {
		if (active !== null) {
			// Nested batch joins the outer frame (one commit at the outermost exit).
			const outer = active;
			return fn({
				rollback: () => {
					outer.rolledBack = true;
				},
			});
		}
		const b: ActiveBatch = { order: [], deferred: new Map(), rolledBack: false };
		active = b;
		const bctx: BatchCtx = {
			rollback: () => {
				b.rolledBack = true;
			},
		};
		let result: R;
		try {
			result = fn(bctx);
		} catch (e) {
			active = null;
			rollback(b);
			throw e;
		}
		active = null;
		if (b.rolledBack) rollback(b);
		else commit(b);
		return result;
	} finally {
		exitWave();
	}
}
