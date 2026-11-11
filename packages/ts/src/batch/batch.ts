/**
 * Declarative batch (R-batch-coalesce / D12).
 *
 * Inside a batch, PENDING propagates immediately but the tier-3 settle slice
 * (DATA/RESOLVED/INVALIDATE) is deferred to commit, so a shared downstream
 * recomputes ONCE after all batched sources settle. Success -> commit; a thrown
 * error -> rollback; `bctx.rollback()` is the explicit escape hatch.
 *
 * Coalescing note: this kernel coalesces multiple emits to the SAME node within
 * one batch to the latest tier-3 wave (last-value-wins). Full per-item batch-array
 * delivery (downstream fn receiving [v1..vK]) is a documented refinement — the
 * dominant use (coalescing a diamond join to one recompute) is exact here.
 */

import type { NodeCore } from "../node/core.js";
import type { Wave } from "../protocol/messages.js";
import {
	deferDirect,
	deferFirst,
	deferRewire,
	dropBoundaryTasksForBatch,
	enterWave,
	exitWave,
	isWaveActive,
} from "./boundary.js";

/** A node target the batch can commit/rollback against (structural, avoids an import cycle). */
export interface BatchTarget {
	__markBatchedWave(wave: Wave): void;
	__commitBatchedWave(wave: Wave): void;
	/** Compute the function writes staged for this node (set(fn)); throws to fail the commit. */
	__resolveBatchedWave(wave: Wave): Wave;
	__deferBoundary(fn: () => void, batchToken?: object): void;
}

export interface BatchCtx {
	/** Discard all deferred emissions in this batch instead of committing. */
	rollback(): void;
}

/** A function write staged by set(fn), computed when the write runs (R-request-order). */
export class DeferredWrite {
	constructor(readonly fn: (prev: unknown) => unknown) {}
}

interface ActiveBatch {
	order: BatchTarget[];
	deferred: Map<BatchTarget, Wave>;
	/** The lifetime that staged a node's output; a commit drops what a closed lifetime staged. */
	lifetimes: Map<BatchTarget, AbortSignal>;
	/** Topology requests the body made; they run after the commit (R-request-order). */
	requests: Array<() => void>;
	committed: boolean;
	rolledBack: boolean;
}

let active: ActiveBatch | null = null;
let boundaryOwner: ActiveBatch | null = null;

export function currentBatch(): boolean {
	return active !== null;
}

export function currentBoundaryBatchToken(): object | undefined {
	return active ?? boundaryOwner ?? undefined;
}

/**
 * Defer a node's tier-3 settle slice into the active batch. Returns true if a batch
 * captured it; false if there is no active batch (caller emits normally).
 */
/** Stage a node's whole array for the commit (the caller passes what is staged so far plus more). */
export function deferToBatch(target: BatchTarget, wave: Wave): boolean {
	if (active === null) return false;
	if (!active.deferred.has(target)) active.order.push(target);
	active.deferred.set(target, wave);
	return true;
}

/** R-request-order: output staged through this lifetime is dropped if it closes before the commit. */
export function noteBatchLifetime(target: BatchTarget, signal: AbortSignal): void {
	active?.lifetimes.set(target, signal);
}

/**
 * R-request-order: run a request now, or, if a wave is being delivered, after it, in the order
 * requests were made. Inside a batch body it runs after the batch's commit.
 */
export function request(core: NodeCore, op: () => void): void {
	if (active !== null) {
		active.requests.push(op);
		return;
	}
	if (isWaveActive()) {
		deferRewire(core, op);
		return;
	}
	enterWave();
	try {
		op();
	} finally {
		exitWave();
	}
}

/** What a node has staged in the open batch, if anything. */
export function stagedBatchWave(target: BatchTarget): Wave | undefined {
	return active?.deferred.get(target);
}

/**
 * Defer a topology mutation until after the active batch has committed/rolled back,
 * but only when this target has an uncommitted settle slice in the current batch.
 */
export function deferAfterBatchForTarget(target: BatchTarget, fn: () => void): boolean {
	if (active === null || !active.deferred.has(target)) return false;
	const owner = active;
	target.__deferBoundary(() => {
		if (owner.committed) fn();
	}, owner);
	return true;
}

function commit(b: ActiveBatch): void {
	const prev = boundaryOwner;
	boundaryOwner = b;
	// R-request-order: the body's requests run after this wave, before anything the wave asks for,
	// and also when a function write fails the commit.
	deferFirst(b.requests);
	try {
		// A function write sees the writes staged before it; a throw commits nothing.
		const staged: Array<[BatchTarget, Wave]> = [];
		for (const target of b.order) {
			const wave = b.deferred.get(target);
			if (wave === undefined || b.lifetimes.get(target)?.aborted === true) continue;
			const resolved = target.__resolveBatchedWave(wave);
			if (resolved.length > 0) staged.push([target, resolved]);
		}
		// O3: the commit is one wave: every staged node marks its cone pending first, then each
		// delivers its one accumulated array, so a fan-in over several of them runs once.
		for (const [target, wave] of staged) target.__markBatchedWave(wave);
		for (const [target, wave] of staged) target.__commitBatchedWave(wave);
		b.committed = true;
	} catch (e) {
		dropBoundaryTasksForBatch(b);
		throw e;
	} finally {
		boundaryOwner = prev;
	}
}

function rollback(b: ActiveBatch): void {
	// O3: nothing was delivered before the commit, so there is nothing to compensate.
	dropBoundaryTasksForBatch(b);
}

/**
 * Run updates as one coalesced batch.
 *
 * @param fn - Synchronous callback that performs node updates and may call `rollback()`.
 * @returns The callback return value when the batch commits.
 * @example
 * ```ts
 * import { batch } from "@graphrefly/ts/core";
 * import { graph } from "@graphrefly/ts/graph";
 *
 * const g = graph();
 * const left = g.state(0);
 * const right = g.state(0);
 *
 * batch(() => {
 *   left.set(1);
 *   right.set(2);
 * });
 * ```
 * @remarks **One wave:** the body delivers nothing; its writes commit as one array per node in
 *   one wave, so shared downstream nodes recompute once for the batch (R-request-order).
 * @category core
 */
export function batch<R>(fn: (bctx: BatchCtx) => R): R {
	// O3: a batch is one synchronous wave, which an async function cannot hold open.
	if (Object.prototype.toString.call(fn) === "[object AsyncFunction]")
		throw new TypeError(
			"batch: the body must be synchronous; finish asynchronous work first, then batch the writes",
		);
	if (active !== null) {
		// A batch inside a batch body joins the outer one (one commit).
		const outer = active;
		return fn({
			rollback: () => {
				outer.rolledBack = true;
			},
		});
	}
	const b: ActiveBatch = {
		order: [],
		deferred: new Map(),
		lifetimes: new Map(),
		requests: [],
		committed: false,
		rolledBack: false,
	};
	const bctx: BatchCtx = {
		rollback: () => {
			b.rolledBack = true;
		},
	};
	// The body runs at once, also during a wave, and nothing is delivered while it runs.
	const during = isWaveActive();
	enterWave();
	active = b;
	let result: R;
	try {
		try {
			result = fn(bctx);
		} finally {
			active = null;
		}
		if (b.rolledBack) rollback(b);
		else if (during)
			deferDirect(() => commit(b)); // the commit is a request (R-request-order)
		else commit(b);
	} catch (e) {
		rollback(b);
		throw e;
	} finally {
		exitWave();
	}
	return result;
}
