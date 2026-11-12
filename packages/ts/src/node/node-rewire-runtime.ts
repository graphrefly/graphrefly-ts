import { deferAfterBatchForTarget, request } from "../batch/batch.js";
import type { NodeFn } from "../ctx/types.js";
import type { Message } from "../protocol/messages.js";
import { type DepInput, makeDepBookkeeping, makeDepInput } from "./core.js";
import type { Node } from "./node.js";
import { nodeSettle, nodeSettleRewire } from "./node-input-runtime.js";
import {
	CORE,
	DEP,
	LIFECYCLE,
	LIFETIME,
	RELEASED,
	SEED_NOTE,
	SLOT,
	SYNC_CTX,
	VALUE,
	WAVE,
} from "./node-keys.js";
import { nodeFinishCleanup, nodeSubscribeDepAt } from "./node-lifecycle-runtime.js";
import { nodeCallSink, nodeDown, nodeMarkDependents } from "./node-output-runtime.js";
import { getNodeOwner, notifyTopologyDepsChanged } from "./runtime-accessors.js";
import type { NodeDefinition, ReplaceOptions } from "./types.js";

/** Whether `target` is `from` or upstream of it. */
function reachableUpstream(from: Node<unknown>, target: Node<unknown>): boolean {
	const seen = new Set<Node<unknown>>();
	const stack: Node<unknown>[] = [from];
	while (stack.length > 0) {
		const n = stack.pop();
		if (n === undefined) continue;
		if (n === target) return true;
		if (seen.has(n)) continue;
		seen.add(n);
		// R-request-order: through current and declared dependencies, since a closing lifetime
		// puts the declared ones back.
		const slot = n[SLOT];
		for (const d of slot.deps) stack.push(d);
		for (const d of slot.declaredDeps) stack.push(d);
	}
	return false;
}

/** D22 / R-graph-domain: a dependency of `self` belongs to its graph. */
export function assertRewireDepOwner<T>(self: Node<T>, dep: Node<unknown>): void {
	const selfOwner = getNodeOwner(self);
	const depOwner = getNodeOwner(dep);
	if (selfOwner !== undefined && depOwner !== undefined && selfOwner !== depOwner)
		throw new Error(
			"rewire: dep belongs to a different graph; cross-graph deps require a wire bridge (D22 / R-graph-domain)",
		);
}

/** R-request-order: refused at once for a duplicate, the node itself, or a node that depends on it. */
function assertRewireList<T>(self: Node<T>, deps: readonly Node<unknown>[]): void {
	if (new Set(deps).size !== deps.length) throw new Error("rewire: duplicate dependency");
	const node: Node<unknown> = self;
	for (const d of deps) {
		if (d === node || reachableUpstream(d, node))
			throw new Error("rewire: a dependency is the node itself or depends on it");
		assertRewireDepOwner(self, d);
	}
}

function nodeQueueRewire<T>(
	self: Node<T>,
	signal: AbortSignal,
	next: (current: readonly Node<unknown>[]) => Node<unknown>[],
): void {
	// R-request-order: dropped if its lifetime has closed when asked for or when it runs.
	if (signal.aborted) return;
	request(self[CORE], () => {
		if (self[RELEASED] || signal.aborted) return;
		const current = self[SLOT].deps;
		const deps = next(current);
		if (deps.length === current.length && deps.every((d, i) => d === current[i])) return;
		// graphrefly:D806 (2): the cycle check runs again when the request runs; refused, it changes
		// nothing and its failure is the queued request's, for the host reporter (R-failure@3), not
		// this node's ERROR.
		assertRewireList(self, deps);
		nodeRewire(self, deps);
	});
}

/** R-request-order: ctx.rewire(deps). */
export function nodeRequestRewire<T>(
	self: Node<T>,
	signal: AbortSignal,
	deps: Node<unknown>[],
): void {
	assertRewireList(self, deps);
	nodeQueueRewire(self, signal, () => deps);
}

/** Internal: a rewire by difference for operators, computed when the request runs. */
export function nodeRequestRewireDiff<T>(
	self: Node<T>,
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
	self: Node<T>,
	signal: AbortSignal,
	add: readonly Node<unknown>[],
	remove: readonly Node<unknown>[],
): void {
	if (self[RELEASED] || signal.aborted) return;
	const current = self[SLOT].deps;
	const deps = current.filter((d) => !remove.includes(d));
	for (const d of add) if (!deps.includes(d)) deps.push(d);
	if (deps.length === current.length && deps.every((d, i) => d === current[i])) return;
	nodeRewire(self, deps);
}

/**
 * Internal: change a live instance's dependencies for its current lifetime (ctx.rewire, and the
 * restore of a lifetime that had rewired). The declared dependencies and the function stay; a new
 * definition goes through replace (R-node).
 */
export function nodeRewire<T>(self: Node<T>, newDeps: Node<unknown>[]): boolean {
	const node: Node<unknown> = self;
	validateNodeRewire(self, newDeps);
	const oldDeps = self[SLOT].deps;
	const added = newDeps.filter((d) => !oldDeps.includes(d));

	if (
		deferAfterBatchForTarget(self[CORE], node, () => {
			nodeRewire(self, newDeps);
		})
	) {
		return true;
	}
	if (!self[LIFECYCLE].activated) self[SEED_NOTE] = undefined;

	self[WAVE].inDepMutation = true;
	self[WAVE].rewireRunPending = false;
	let zeroDepUnDirty = false;
	try {
		const oldInputs = self[DEP].inputs;
		const removed = oldDeps.filter((d) => !newDeps.includes(d));
		let removedDirtyContributor = false;
		for (const d of removed) {
			const input = oldInputs[oldDeps.indexOf(d)];
			if (input.dirty) {
				removedDirtyContributor = true;
				self[WAVE].pending--;
			}
			// drain: the record is its subscription's index box; any stale in-flight callback drops
			input.idx = -1;
			if (self[LIFECYCLE].activated) {
				const unsub = input.unsub;
				if (unsub) unsub(); // stops the removed dep's edge — no further delivery
			}
		}

		// Reorder the records to newDeps: a kept dep keeps its record (its state and subscription),
		// pointed at its new index; an added dep gets a fresh one (R-request-order). The run's
		// input starts over.
		const n = newDeps.length;
		const inputs: DepInput[] = [];
		for (let j = 0; j < n; j++) {
			const oldIdx = oldDeps.indexOf(newDeps[j]);
			if (oldIdx === -1) {
				inputs.push(makeDepInput(j));
				continue;
			}
			const input = oldInputs[oldIdx];
			input.idx = j;
			input.waveData = [];
			input.waveLive = [];
			input.terminalInput = undefined;
			input.invalidated = false;
			inputs.push(input);
		}
		self[SLOT].deps = newDeps;
		self[DEP].inputs = inputs;
		self[SYNC_CTX].value = null;

		// Subscribe added deps — push-on-subscribe (R-subscription) delivers a cached
		// dep's DATA here, which drives nodeMaybeRun; a SENTINEL dep delivers START only.
		if (self[LIFECYCLE].activated) {
			for (const d of added) nodeSubscribeDepAt(self, d);
		}
		notifyTopologyDepsChanged(node, oldDeps, newDeps);

		// Q6 auto-settle: removing the sole dirty contributor closes the wave. With deps
		// remaining, request the atomic settle (recompute → DATA for a value; a no-emit fn
		// gets the kernel's RESOLVED per R-wave/D49 — NOT equals-absorption, which is gone).
		// With zero deps the node is inert (degenerate fn-no-deps) — just un-dirty downstream.
		// Cache is preserved either way (Q7).
		if (removedDirtyContributor && self[WAVE].pending === 0 && self[WAVE].emittedDirtyThisWave) {
			if (newDeps.length > 0) self[WAVE].rewireRunPending = true;
			else zeroDepUnDirty = true;
		}
	} finally {
		self[WAVE].inDepMutation = false;
	}

	// Atomic post-mutation settle (outside the reentrancy guard so a fresh wave runs
	// normally): ONE recompute if any added dep delivered data or a
	// sole-dirty dep was removed; else the zero-dep un-dirty via nodeDown (batch-safe).
	if (self[WAVE].rewireRunPending) {
		self[WAVE].rewireRunPending = false;
		nodeSettleRewire(self);
	} else if (zeroDepUnDirty) {
		if (self[WAVE].emittedDirtyThisWave) nodeDown(self, [["RESOLVED"]]);
	}
	return false;
}

/** Internal adapters validate at call time and repeat against actual deps at commit. */
export function validateNodeRewire<T>(self: Node<T>, newDeps: Node<unknown>[]): void {
	const node: Node<unknown> = self;
	// ── rejects (R-request-order / D42) ──
	if (self[VALUE].terminal !== undefined)
		throw new Error(
			"rewire: node is terminal (completed/errored) — cannot rewire (R-request-order / D42)",
		);
	if (self[WAVE].insideRunWave)
		throw new Error(
			"rewire: mid-fn topology mutation — a fn mutating its own deps mid-wave is the feedback cycle (R-request-order / D37)",
		);
	if (self[WAVE].inDepMutation)
		throw new Error(
			"rewire: reentrant dep mutation — another rewire is in flight (R-request-order)",
		);
	if (newDeps.includes(node))
		throw new Error("rewire: self-dependency rejected (R-request-order / D42)");
	const oldDeps = self[SLOT].deps;
	const added = newDeps.filter((d) => !oldDeps.includes(d));
	for (const d of added) {
		if (reachableUpstream(d, node))
			throw new Error(
				"rewire: would create a cycle — dep already transitively depends on this node (R-request-order / D42)",
			);
		// R-terminals: an ended node can be added; its snapshot carries its terminal.
		assertRewireDepOwner(self, d);
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
	self: Node<T>,
	deps: Node<unknown>[],
	fn: NodeFn,
	opts: ReplaceOptions = {},
): void {
	if (self[SLOT].handle === null && self[SLOT].declaredDeps.length === 0)
		throw new Error("replace: a state node has no definition to replace");
	assertRewireList(self, deps);
	request(self[CORE], () => {
		if (self[RELEASED]) return;
		assertRewireList(self, deps);
		nodeApplyReplace(self, [...deps], fn, opts);
	});
}

function nodeApplyReplace<T>(
	self: Node<T>,
	deps: Node<unknown>[],
	fn: NodeFn,
	opts: ReplaceOptions,
): void {
	const node: Node<unknown> = self;
	const active = self[LIFECYCLE].activated;
	// Close the old instance's lifetime: abort its signal; its dependencies are released after the
	// new ones are acquired, so a shared upstream stays active; then its cleanup runs.
	const lifetime = self[LIFETIME];
	const closingSignal = lifetime.controller?.signal ?? null;
	lifetime.controller?.abort();
	const cleanup = lifetime.cleanup;
	lifetime.controller = null;
	lifetime.cleanup = undefined;
	lifetime.setupDone = false;
	const oldDeps = self[SLOT].deps;
	const oldInputs = self[DEP].inputs;
	const oldUnsubs: Array<() => void> = [];
	for (let i = 0; i < oldInputs.length; i++) {
		const input = oldInputs[i];
		input.idx = -1;
		if (input.unsub === undefined) continue;
		oldUnsubs.push(input.unsub);
		input.unsub = undefined;
	}
	// The new instance.
	const oldHandle = self[SLOT].handle;
	self[SLOT].handle = self[SLOT].dispatcher.register(fn);
	if (oldHandle !== null) self[SLOT].dispatcher.unregister(oldHandle);
	self[SLOT].fn = fn;
	self[SLOT].setup = opts.setup;
	self[SLOT].recipe = opts.recipe;
	self[SLOT].deps = deps;
	self[SLOT].declaredDeps = deps;
	Object.assign(self[DEP], makeDepBookkeeping(deps.length));
	self[VALUE].cache = undefined;
	self[VALUE].hasData = false;
	self[VALUE].lastArray = [];
	self[VALUE].terminal = undefined;
	self[WAVE].pending = 0;
	self[WAVE].emittedDirtyThisWave = false;
	self[SEED_NOTE] = undefined;
	self[SYNC_CTX].value = null;
	if (active) {
		self[WAVE].activating = true;
		try {
			for (const dep of deps) nodeSubscribeDepAt(self, dep);
		} finally {
			self[WAVE].activating = false;
		}
		self[WAVE].rewireRunPending = false;
	}
	for (const u of oldUnsubs) u();
	nodeFinishCleanup(self, closingSignal, cleanup);
	notifyTopologyDepsChanged(node, oldDeps, deps);
	if (!active) return; // the next subscription activates the new instance

	// The first run, as at a first activation: it sets the retained values only.
	const subscribers = self[LIFECYCLE].subscribers;
	self[LIFECYCLE].subscribers = new Set();
	try {
		if (self[WAVE].pending === 0) nodeSettle(self, true);
	} finally {
		self[LIFECYCLE].subscribers = subscribers;
	}
	// Every subscriber receives START and the new instance's snapshot, also after an old terminal.
	const terminal = self[VALUE].terminal;
	const snapshot: Message[] = [
		...self[VALUE].lastArray.map((v) => ["DATA", v] as Message),
		...(terminal === undefined
			? []
			: [(terminal === true ? ["COMPLETE"] : ["ERROR", terminal]) as Message]),
	];
	if (snapshot.length > 0) nodeMarkDependents(self);
	const start: Message[] = [["START"], ...snapshot];
	for (const sub of [...subscribers]) {
		if (sub.kind === "sink") nodeCallSink(self, sub, start);
		else sub.fn([start], true);
	}
}

/** R-node@2: the current definition: declared deps, the instance's fn, setup, recipe, policies. */
export function nodeDefinition<T>(self: Node<T>): NodeDefinition {
	return {
		deps: [...self[SLOT].declaredDeps],
		fn: self[SLOT].fn,
		setup: self[SLOT].setup,
		recipe: self[SLOT].recipe,
		complete: self[SLOT].completePolicy,
		error: self[SLOT].errorPolicy,
		invalidate: self[SLOT].invalidatePolicy,
		quiet: self[SLOT].quiet,
	};
}
