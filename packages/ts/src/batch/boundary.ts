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
 * Every request goes on the one queue. Work queued while a batch's commit is delivered is tagged
 * with that batch, and a commit that fails drops it (C-25 / D110). With nothing queued, the drain
 * is one check per outermost wave.
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
	/** The open batch body, if any (batch.ts). */
	batch: unknown;
	/** The batch whose commit is being delivered, if any (batch.ts). */
	boundaryOwner: unknown;
	/** Callers observing this graph's reported failures while their own call runs. */
	failureObservers: Array<(source: string, error: unknown) => void>;
}

/**
 * R-failure@3 with graphrefly-ts:D181 (the user's Q9): a failure that has no caller goes to the
 * graph's host reporter only; with no reporter it goes to console.error. A reporter that throws
 * is ignored.
 */
export function reportFailure(core: NodeCore, source: string, error: unknown): void {
	for (const observe of core.domain.failureObservers) observe(source, error);
	const report = core.report;
	if (report === undefined) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`graphrefly: ${source} failed: ${message}`, error);
		return;
	}
	try {
		report({ source, error });
	} catch {
		// a reporter that throws is ignored
	}
}

/**
 * Observe the failures this graph reports while `run` runs (a caller that drives a cascade, such
 * as a construction's startup, learns that a request it caused failed); they are still reported.
 */
export function observeFailures<R>(
	core: NodeCore,
	observer: (source: string, error: unknown) => void,
	run: () => R,
): R {
	core.domain.failureObservers.push(observer);
	try {
		return run();
	} finally {
		const at = core.domain.failureObservers.lastIndexOf(observer);
		if (at >= 0) core.domain.failureObservers.splice(at, 1);
	}
}

export function makeWaveDomain(): WaveDomain {
	return {
		depth: 0,
		queue: [],
		head: 0,
		batch: null,
		boundaryOwner: null,
		failureObservers: [],
	};
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
	if (d.depth === 0 && d.head < d.queue.length) drain(core);
}

/** R-request-order: a committing batch's requests run before anything its commit wave asks for. */
export function deferFirst(core: NodeCore, ops: ReadonlyArray<() => void>): void {
	const d = core.domain;
	const rest = d.queue.splice(d.head);
	for (const apply of ops) d.queue.push({ apply });
	for (const task of rest) d.queue.push(task);
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
	// The depth++ around each keeps that wave's own outermost exit from draining again. A request
	// that throws does not abandon the rest of the queue: its caller has returned, so its failure
	// is reported (R-request-order, R-failure@3).
	const d = core.domain;
	const run = (apply: () => void): void => {
		d.depth++;
		try {
			apply();
		} catch (e) {
			reportFailure(core, "queued request", e);
		} finally {
			d.depth--;
		}
	};
	while (d.head < d.queue.length) run((d.queue[d.head++] as BoundaryTask).apply);
	d.queue = [];
	d.head = 0;
}
