import { deferAfterBatchForTarget, request } from "../batch/batch.js";
import { reportFailure } from "../batch/boundary.js";
import type { NodeFn } from "../ctx/types.js";
import { type Message, SENTINEL } from "../protocol/messages.js";
import { makeDepBookkeeping } from "./core.js";
import type { Node } from "./node.js";
import { nodeCallSink } from "./node-output-runtime.js";
import { type NodeRuntimeHost } from "./node-runtime-host.js";
import { notifyTopologyDepsChanged } from "./runtime-accessors.js";
import type { NodeDefinition, ReplaceOptions } from "./types.js";

/** R-request-order: refused at once for a duplicate, the node itself, or a node that depends on it. */
function assertRewireList<T>(self: NodeRuntimeHost<T>, deps: readonly Node<unknown>[]): void {
	if (new Set(deps).size !== deps.length) throw new Error("rewire: duplicate dependency");
	const node = self as unknown as Node<unknown>;
	for (const d of deps) {
		if (d === node || self._reachableUpstream(d, node))
			throw new Error("rewire: a dependency is the node itself or depends on it");
		self._assertRewireDepOwner(d);
	}
}

function nodeQueueRewire<T>(
	self: NodeRuntimeHost<T>,
	signal: AbortSignal,
	next: (current: readonly Node<unknown>[]) => Node<unknown>[],
): void {
	// R-request-order: dropped if its lifetime has closed when asked for or when it runs.
	if (signal.aborted) return;
	request(self._core, () => {
		if (self._released || signal.aborted) return;
		const current = self._slot.deps;
		const deps = next(current);
		if (deps.length === current.length && deps.every((d, i) => d === current[i])) return;
		// graphrefly:D806 (2): the cycle check runs again when the request runs; refused, it changes
		// nothing and its failure is the queued request's, for the host reporter (R-failure@3), not
		// this node's ERROR.
		assertRewireList(self, deps);
		self._rewire(deps);
	});
}

/** R-request-order: ctx.rewire(deps). */
export function nodeRequestRewire<T>(
	self: NodeRuntimeHost<T>,
	signal: AbortSignal,
	deps: Node<unknown>[],
): void {
	assertRewireList(self, deps);
	nodeQueueRewire(self, signal, () => deps);
}

/** Internal: a rewire by difference for operators, computed when the request runs. */
export function nodeRequestRewireDiff<T>(
	self: NodeRuntimeHost<T>,
	signal: AbortSignal,
	add: readonly Node<unknown>[],
	remove: readonly Node<unknown>[],
): void {
	nodeQueueRewire(self, signal, (current) => {
		const out = current.filter((d) => !remove.includes(d));
		for (const d of add) if (!out.includes(d)) out.push(d);
		return out;
	});
}

/** Internal: apply a rewire by difference now, from inside a request; dropped after a close. */
export function nodeApplyRewireDiff<T>(
	self: NodeRuntimeHost<T>,
	signal: AbortSignal,
	add: readonly Node<unknown>[],
	remove: readonly Node<unknown>[],
): void {
	if (self._released || signal.aborted) return;
	const current = self._slot.deps;
	const deps = current.filter((d) => !remove.includes(d));
	for (const d of add) if (!deps.includes(d)) deps.push(d);
	if (deps.length === current.length && deps.every((d, i) => d === current[i])) return;
	self._rewire(deps);
}

/**
 * Internal: change a live instance's dependencies for its current lifetime (ctx.rewire, and the
 * restore of a lifetime that had rewired). The declared dependencies and the function stay; a new
 * definition goes through replace (R-node).
 */
export function nodeRewire<T>(self: NodeRuntimeHost<T>, newDeps: Node<unknown>[]): boolean {
	const node = self as unknown as Node<unknown>;
	validateNodeRewire(self, newDeps);
	const oldDeps = self._slot.deps;
	const added = newDeps.filter((d) => !oldDeps.includes(d));

	if (
		deferAfterBatchForTarget(self._core, node, () => {
			self._rewire(newDeps);
		})
	) {
		return true;
	}
	if (!self._lifecycle.activated) self._seed = undefined;

	self._wave.inDepMutation = true;
	self._wave.rewireRunPending = false;
	let zeroDepUnDirty = false;
	try {
		const removed = oldDeps.filter((d) => !newDeps.includes(d));
		let removedDirtyContributor = false;
		for (const d of removed) {
			const oldIdx = oldDeps.indexOf(d);
			if (self._dep.dirty[oldIdx]) {
				removedDirtyContributor = true;
				self._wave.pending--;
			}
			if (self._lifecycle.activated) {
				const box = self._dep.idxBoxes[oldIdx];
				if (box) box.v = -1; // drain: any stale in-flight callback drops
				const unsub = self._dep.unsubs[oldIdx];
				if (unsub) unsub(); // stops the removed dep's edge — no further delivery
			}
		}

		// Rebuild per-dep parallel arrays in newDeps order; kept deps carry their state
		// + subscription, added deps start fresh (R-request-order).
		const n = newDeps.length;
		const newBatch: Array<unknown[] | null> = new Array(n).fill(null);
		const newPrev: unknown[] = new Array(n).fill(SENTINEL);
		const newHasData: boolean[] = new Array(n).fill(false);
		const newDirty: boolean[] = new Array(n).fill(false);
		const newTier: number[] = new Array(n).fill(0);
		const newTerminal: Array<true | unknown | undefined> = new Array(n).fill(undefined);
		const newTerminalInput: Array<true | unknown | undefined> = new Array(n).fill(undefined);
		const newUnsubs: Array<() => void> = new Array(n);
		const newBoxes: Array<{ v: number }> = new Array(n);
		for (let j = 0; j < n; j++) {
			const oldIdx = oldDeps.indexOf(newDeps[j]);
			if (oldIdx !== -1) {
				newBatch[j] = self._dep.batch[oldIdx];
				newPrev[j] = self._dep.prev[oldIdx];
				newHasData[j] = self._dep.hasData[oldIdx];
				newDirty[j] = self._dep.dirty[oldIdx];
				newTier[j] = self._dep.tier[oldIdx];
				newTerminal[j] = self._dep.terminal[oldIdx];
				newUnsubs[j] = self._dep.unsubs[oldIdx];
				// carry the kept dep's subscription box and point it at the new index (O(1) reroute)
				const box = self._dep.idxBoxes[oldIdx];
				if (box) box.v = j;
				newBoxes[j] = box;
			}
		}
		self._slot.deps = newDeps;
		self._dep.batch = newBatch;
		self._dep.prev = newPrev;
		self._dep.hasData = newHasData;
		self._dep.dirty = newDirty;
		self._dep.tier = newTier;
		self._dep.terminal = newTerminal;
		self._dep.terminalInput = newTerminalInput;
		self._dep.invalidated = new Array(n).fill(false);
		self._dep.unsubs = newUnsubs;
		self._dep.idxBoxes = newBoxes;
		self._dep.waveData = newDeps.map(() => []);
		self._dep.waveTokens = new Array(newDeps.length).fill(undefined);
		self._dep.waveLive = newDeps.map(() => []);
		self._syncCtx = null;

		// Subscribe added deps — push-on-subscribe (R-subscription) delivers a cached
		// dep's DATA here, which drives _maybeRun; a SENTINEL dep delivers START only.
		if (self._lifecycle.activated) {
			for (const d of added) self._subscribeDepAt(d);
		}
		notifyTopologyDepsChanged(node, oldDeps, newDeps);

		// Q6 auto-settle: removing the sole dirty contributor closes the wave. With deps
		// remaining, request the atomic settle (recompute → DATA for a value; a no-emit fn
		// gets the kernel's RESOLVED per R-wave/D49 — NOT equals-absorption, which is gone).
		// With zero deps the node is inert (degenerate fn-no-deps) — just un-dirty downstream.
		// Cache is preserved either way (Q7).
		if (removedDirtyContributor && self._wave.pending === 0 && self._wave.emittedDirtyThisWave) {
			if (newDeps.length > 0) self._wave.rewireRunPending = true;
			else zeroDepUnDirty = true;
		}
	} finally {
		self._wave.inDepMutation = false;
	}

	// Atomic post-mutation settle (outside the reentrancy guard so a fresh wave runs
	// normally): ONE recompute if any added dep delivered data or a
	// sole-dirty dep was removed; else the zero-dep un-dirty via _down (batch-safe).
	if (self._wave.rewireRunPending) {
		self._wave.rewireRunPending = false;
		self._settleRewire();
	} else if (zeroDepUnDirty) {
		if (self._wave.emittedDirtyThisWave) self._down([["RESOLVED"]]);
	}
	return false;
}

/** Internal adapters validate at call time and repeat against actual deps at commit. */
export function validateNodeRewire<T>(self: NodeRuntimeHost<T>, newDeps: Node<unknown>[]): void {
	const node = self as unknown as Node<unknown>;
	// ── rejects (R-request-order / D42) ──
	if (self._value.terminal !== undefined)
		throw new Error(
			"rewire: node is terminal (completed/errored) — cannot rewire (R-request-order / D42)",
		);
	if (self._wave.insideRunWave)
		throw new Error(
			"rewire: mid-fn topology mutation — a fn mutating its own deps mid-wave is the feedback cycle (R-request-order / D37)",
		);
	if (self._wave.inDepMutation)
		throw new Error(
			"rewire: reentrant dep mutation — another rewire is in flight (R-request-order)",
		);
	if (newDeps.includes(node))
		throw new Error("rewire: self-dependency rejected (R-request-order / D42)");
	const oldDeps = self._slot.deps;
	const added = newDeps.filter((d) => !oldDeps.includes(d));
	for (const d of added) {
		if (self._reachableUpstream(d, node))
			throw new Error(
				"rewire: would create a cycle — dep already transitively depends on this node (R-request-order / D42)",
			);
		// R-terminals: an ended node can be added; its snapshot carries its terminal.
		self._assertRewireDepOwner(d);
	}
}

/**
 * R-request-order / R-node: replace gives the node a new instance under the same id, subscribers
 * and policies: new dependencies, function, setup and recipe, and no values, terminal, private
 * state or lifetime. An active node closes its old lifetime (signal, cleanup) and runs the new
 * instance as on a first activation; its sinks receive START and the new snapshot, and its
 * dependents receive the snapshot as their input from a new instance. A request.
 */
export function nodeReplace<T>(
	self: NodeRuntimeHost<T>,
	deps: Node<unknown>[],
	fn: NodeFn,
	opts: ReplaceOptions = {},
): void {
	if (self._slot.handle === null && self._slot.declaredDeps.length === 0)
		throw new Error("replace: a state node has no definition to replace");
	assertRewireList(self, deps);
	request(self._core, () => {
		if (self._released) return;
		assertRewireList(self, deps);
		nodeApplyReplace(self, [...deps], fn, opts);
	});
}

function nodeApplyReplace<T>(
	self: NodeRuntimeHost<T>,
	deps: Node<unknown>[],
	fn: NodeFn,
	opts: ReplaceOptions,
): void {
	const node = self as unknown as Node<unknown>;
	const active = self._lifecycle.activated;
	// Close the old instance's lifetime: abort its signal; its dependencies are released after the
	// new ones are acquired, so a shared upstream stays active; then its cleanup runs.
	const lifetime = self._lifetime;
	lifetime.controller?.abort();
	const cleanup = lifetime.cleanup;
	lifetime.controller = null;
	lifetime.cleanup = undefined;
	lifetime.setupDone = false;
	const oldDeps = self._slot.deps;
	const oldUnsubs = self._dep.unsubs;
	for (const box of self._dep.idxBoxes) if (box) box.v = -1;
	// The new instance.
	const oldHandle = self._slot.handle;
	self._slot.handle = self._slot.dispatcher.register(fn, self._slot.pool);
	if (oldHandle !== null) self._slot.dispatcher.unregister(oldHandle);
	self._slot.fn = fn;
	self._slot.setup = opts.setup;
	self._slot.recipe = opts.recipe;
	self._slot.deps = deps;
	self._slot.declaredDeps = deps;
	Object.assign(self._dep, makeDepBookkeeping(deps.length));
	self._value.cache = undefined;
	self._value.hasData = false;
	self._value.lastArray = [];
	self._value.terminal = undefined;
	self._wave.pending = 0;
	self._wave.emittedDirtyThisWave = false;
	self._seed = undefined;
	self._syncCtx = null;
	if (active) {
		self._wave.activating = true;
		try {
			for (const dep of deps) self._subscribeDepAt(dep);
		} finally {
			self._wave.activating = false;
		}
		self._wave.rewireRunPending = false;
	}
	for (const u of oldUnsubs) u?.();
	if (cleanup !== undefined) {
		lifetime.closing = true;
		try {
			cleanup();
		} catch (error) {
			reportFailure(self._core, `cleanup of ${self._slot.name ?? "node"}`, error);
		} finally {
			lifetime.closing = false;
		}
	}
	self._privateState.value = SENTINEL;
	notifyTopologyDepsChanged(node, oldDeps, deps);
	if (!active) return; // the next subscription activates the new instance

	// The first run, as at a first activation: it sets the retained values only.
	const subscribers = self._lifecycle.subscribers;
	self._lifecycle.subscribers = new Set();
	try {
		if (self._wave.pending === 0) self._runWave();
	} finally {
		self._lifecycle.subscribers = subscribers;
	}
	// Every subscriber receives START and the new instance's snapshot, also after an old terminal.
	const terminal = self._value.terminal;
	const snapshot: Message[] = [
		...self._value.lastArray.map((v) => ["DATA", v] as Message),
		...(terminal === undefined
			? []
			: [(terminal === true ? ["COMPLETE"] : ["ERROR", terminal]) as Message]),
	];
	if (snapshot.length > 0) self._markDependents();
	const start: Message[] = [["START"], ...snapshot];
	for (const sub of [...subscribers]) {
		if (sub.kind === "sink") nodeCallSink(self, sub, start);
		else {
			const wave = {};
			for (let i = 0; i < start.length; i++)
				sub.fn(start[i] as Message, { wave, last: i === start.length - 1, snapshot: true });
		}
	}
}

/** R-node@2: the current definition: declared deps, the instance's fn, setup, recipe, policies. */
export function nodeDefinition<T>(self: NodeRuntimeHost<T>): NodeDefinition {
	return {
		deps: [...self._slot.declaredDeps],
		fn: self._slot.fn,
		setup: self._slot.setup,
		recipe: self._slot.recipe,
		complete: self._slot.completePolicy,
		error: self._slot.errorPolicy,
		invalidate: self._slot.invalidatePolicy,
		quiet: self._slot.quiet,
	};
}
