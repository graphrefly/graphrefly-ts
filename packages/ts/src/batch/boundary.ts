/**
 * A graph's wave boundary and request queue (R-request-order, R-graph-domain@3).
 *
 * Each graph owns one {@link WaveDomain}, held by its NodeCore: the depth of the wave being
 * delivered, the queue of requests made during it, and its open batch body. Graphs share none of
 * them (graphrefly:D803): a request to one graph is never held by another graph's wave or batch.
 * Every wave origin of a graph brackets its synchronous cascade with {@link enterWave} /
 * {@link exitWave} on that graph's domain; nested calls only count, and the outermost exit runs
 * what was queued, in request order, each as a wave of its own.
 *
 * Queued work is tagged with the batch frame that caused it (when any): only a committed frame's
 * tasks run, and a rollback drops them (C-25 / D110). With nothing queued, the drain is one check
 * per outermost wave.
 */

import type { NodeCore } from "../node/core.js";

export interface BoundaryTask {
	readonly apply: () => void;
	readonly batchToken?: object;
}

/** One graph's wave, request queue and batch (R-graph-domain@3). */
export interface WaveDomain {
	depth: number;
	queue: BoundaryTask[];
	head: number;
	/** Requests that run before everything queued (a committing batch's body requests). */
	priority: Array<() => void>;
	/** The open batch body, if any (batch.ts). */
	batch: unknown;
	/** The batch whose commit is being delivered, if any (batch.ts). */
	boundaryOwner: unknown;
}

export function makeWaveDomain(): WaveDomain {
	return { depth: 0, queue: [], head: 0, priority: [], batch: null, boundaryOwner: null };
}

/** True while this graph is delivering a wave (D161, R-checkpoint). */
export function isWaveActive(core: NodeCore): boolean {
	return core.domain.depth !== 0;
}

/** Enter a wave of this graph (re-entrant). Pair with {@link exitWave} in a try/finally. */
export function enterWave(core: NodeCore): void {
	core.domain.depth++;
}

/** Exit a wave of this graph; the outermost exit runs what was queued. */
export function exitWave(core: NodeCore): void {
	const d = core.domain;
	d.depth--;
	if (d.depth === 0 && (d.priority.length > 0 || d.head < d.queue.length)) drain(core);
}

/** R-request-order: a committing batch's requests run before anything its commit wave asks for. */
export function deferFirst(core: NodeCore, ops: ReadonlyArray<() => void>): void {
	core.domain.priority = [...ops, ...core.domain.priority];
}

export interface DeferredBoundaryOptions {
	readonly batchToken?: object;
}

/** Queue a request of this graph, run after its current wave (R-request-order). */
export function deferRequest(
	core: NodeCore,
	apply: () => void,
	options: DeferredBoundaryOptions = {},
): void {
	core.domain.queue.push({ apply, batchToken: options.batchToken });
}

/** D110: an uncommitted batch cannot leak queued boundary effects. */
export function dropBoundaryTasksForBatch(core: NodeCore, batchToken: object): void {
	const d = core.domain;
	d.queue = d.queue.slice(d.head).filter((task) => task.batchToken !== batchToken);
	d.head = 0;
}

function drain(core: NodeCore): void {
	// Each queued request runs as a wave of its own and may queue more, which this loop runs too.
	// The depth++ around each keeps that wave's own outermost exit from draining again.
	//
	// A request whose application throws does not abandon the rest of the queue; with no host
	// reporter, the first failure is re-thrown once the queue is empty.
	const d = core.domain;
	let escaped: { e: unknown } | null = null;
	const run = (apply: () => void): void => {
		d.depth++;
		try {
			apply();
		} catch (e) {
			// R-request-order: a queued request's caller has returned, so its failure goes to the
			// graph's host reporter; with none, it is re-thrown once the queue is empty.
			const report = core.report;
			if (report !== undefined) {
				try {
					report({ source: "queued request", error: e });
				} catch {
					// a reporter that throws is ignored
				}
			} else if (escaped === null) escaped = { e };
		} finally {
			d.depth--;
		}
	};
	while (d.priority.length > 0 || d.head < d.queue.length) {
		const first = d.priority.shift();
		if (first !== undefined) {
			run(first);
			continue;
		}
		const task = d.queue[d.head++] as BoundaryTask;
		if (task.batchToken !== undefined) {
			// A stale token means the batch never reached the committed boundary (D110). Rollback
			// normally removes these before drain; this guard covers commit failures before the
			// batch frame marks itself committed.
			const committed = (task.batchToken as { committed?: boolean }).committed === true;
			if (!committed) continue;
		}
		run(task.apply);
	}
	d.queue = [];
	d.head = 0;
	if (escaped !== null) throw (escaped as { e: unknown }).e;
}
