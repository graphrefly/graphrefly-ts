/**
 * A graph's batch (R-request-order, R-graph-domain@3).
 *
 * A batch body runs at once, also during a wave, and delivers nothing; when it returns, its host
 * inputs commit as one wave, one array per node, and its topology requests then run in order. The
 * commit is a request, so during a wave it waits like the others. A body that throws commits
 * nothing and drops its requests (R-request-order). The open batch lives on the graph's wave
 * domain, so graphs share no batch (graphrefly:D803).
 */

import type { NodeCore } from "../node/core.js";
import type { Node } from "../node/node.js";
import {
	nodeAssertBatchTarget,
	nodeCommitBatchedWave,
	nodeDeferBoundary,
	nodeMarkBatchedWave,
	nodeResolveBatchedWave,
} from "../node/node-output-runtime.js";
import { isTerminal, type Message, type Wave } from "../protocol/messages.js";
import {
	deferFirst,
	deferRequest,
	dropBoundaryTasksForBatch,
	enterWave,
	exitWave,
	isWaveActive,
} from "./boundary.js";

/**
 * A node a batch stages output for. The batch reaches it only through the node runtime functions
 * below, so a node has no public batch entry (graphrefly-ts:D175, REVIEW-D797-migration-fable 2.13).
 */
export type BatchTarget = Node<unknown>;

/** A function write staged by set(fn), computed when the write runs (R-request-order). */
export class DeferredWrite {
	constructor(readonly fn: (prev: unknown) => unknown) {}
}

interface ActiveBatch {
	order: BatchTarget[];
	/** Each node's staged array, owned by the batch and appended to in place. */
	deferred: Map<BatchTarget, Message[]>;
	/** Requests the body made; they run after the commit (R-request-order). */
	requests: Array<() => void>;
	committed: boolean;
}

function activeOf(core: NodeCore): ActiveBatch | null {
	return core.domain.batch as ActiveBatch | null;
}

/** True while this graph's batch body runs (R-graph-domain@3: each graph has its own batch). */
export function currentBatch(core: NodeCore): boolean {
	return core.domain.batch !== null;
}

export function currentBoundaryBatchToken(core: NodeCore): object | undefined {
	return activeOf(core) ?? (core.domain.boundaryOwner as ActiveBatch | null) ?? undefined;
}

/**
 * Append messages to the array a node stages for the commit (one array per node, R-request-order).
 * A terminal must stay last, so `op` names the refusal when the staged array already ends with
 * one. Appends in place: N writes to one node in a batch cost O(N), not O(N^2). Returns false
 * when no batch is open, so the caller sends normally.
 */
export function stageToBatch(
	core: NodeCore,
	target: BatchTarget,
	msgs: Iterable<Message>,
	op: string,
): boolean {
	const active = activeOf(core);
	if (active === null) return false;
	let staged = active.deferred.get(target);
	if (staged === undefined) {
		staged = [];
		active.deferred.set(target, staged);
		active.order.push(target);
	} else {
		const last = staged[staged.length - 1];
		if (last !== undefined && isTerminal(last[0]))
			throw new Error(`${op}: a terminal must be the last message of its array (R-wave)`);
	}
	for (const m of msgs) staged.push(m);
	return true;
}

/**
 * R-request-order: run a request now, or, if a wave is being delivered, after it, in the order
 * requests were made. Inside a batch body it runs after the batch's commit.
 */
export function request(core: NodeCore, op: () => void): void {
	const active = activeOf(core);
	if (active !== null) {
		active.requests.push(op);
		return;
	}
	if (isWaveActive(core)) {
		deferRequest(core, op);
		return;
	}
	enterWave(core);
	try {
		op();
	} finally {
		exitWave(core);
	}
}

/**
 * Defer a topology mutation until after the active batch has committed/rolled back,
 * but only when this target has an uncommitted settle slice in the current batch.
 */
export function deferAfterBatchForTarget(
	core: NodeCore,
	target: BatchTarget,
	fn: () => void,
): boolean {
	const active = activeOf(core);
	if (active === null || !active.deferred.has(target)) return false;
	const owner = active;
	nodeDeferBoundary(
		target,
		() => {
			if (owner.committed) fn();
		},
		owner,
	);
	return true;
}

function commit(core: NodeCore, b: ActiveBatch): void {
	const prev = core.domain.boundaryOwner;
	core.domain.boundaryOwner = b;
	// R-request-order: the body's requests run after this wave, before anything the wave asks for,
	// and also when a function write fails the commit.
	deferFirst(core, b.requests);
	try {
		// An earlier request may have ended a target since the body staged it. Refuse
		// the entire commit before running any updater or publishing any other target.
		for (const target of b.order) nodeAssertBatchTarget(target);
		// A function write sees the writes staged before it; a throw commits nothing.
		const staged: Array<[BatchTarget, Wave]> = [];
		for (const target of b.order) {
			const wave = b.deferred.get(target);
			if (wave === undefined) continue;
			const resolved = nodeResolveBatchedWave(target, wave);
			if (resolved.length > 0) staged.push([target, resolved]);
		}
		// O3: the commit is one wave: every staged node marks its cone pending first, then each
		// delivers its one accumulated array, so a fan-in over several of them runs once.
		for (const [target, wave] of staged) nodeMarkBatchedWave(target, wave);
		for (const [target, wave] of staged) nodeCommitBatchedWave(target, wave);
		b.committed = true;
	} catch (e) {
		dropBoundaryTasksForBatch(core, b);
		throw e;
	} finally {
		core.domain.boundaryOwner = prev;
	}
}

function rollback(core: NodeCore, b: ActiveBatch): void {
	// O3: nothing was delivered before the commit, so there is nothing to compensate.
	dropBoundaryTasksForBatch(core, b);
}

/**
 * Run a graph's updates as one batch (internal; the public form is `graph.batch`).
 *
 * The body runs at once and delivers nothing; its writes to this graph's nodes commit as one
 * array per node in one wave, so shared downstream nodes recompute once (R-request-order). A
 * write to another graph's node inside the body is that graph's own request (R-graph-domain@3).
 */
export function batchIn<R>(core: NodeCore, fn: () => R): R {
	// O3: a batch is one synchronous wave, which an async function cannot hold open.
	if (Object.prototype.toString.call(fn) === "[object AsyncFunction]")
		throw new TypeError(
			"batch: the body must be synchronous; finish asynchronous work first, then batch the writes",
		);
	if (activeOf(core) !== null) {
		// A batch inside a batch body of the same graph joins the outer one (one commit); a throw
		// from it discards the outer batch too when it reaches the outer body.
		return fn();
	}
	const b: ActiveBatch = {
		order: [],
		deferred: new Map(),
		requests: [],
		committed: false,
	};
	// The body runs at once, also during a wave, and nothing is delivered while it runs.
	const during = isWaveActive(core);
	enterWave(core);
	core.domain.batch = b;
	let result: R;
	try {
		try {
			result = fn();
		} finally {
			core.domain.batch = null;
		}
		if (during)
			deferRequest(core, () => commit(core, b)); // the commit is a request (R-request-order)
		else commit(core, b);
	} catch (e) {
		rollback(core, b);
		throw e;
	} finally {
		exitWave(core);
	}
	return result;
}
