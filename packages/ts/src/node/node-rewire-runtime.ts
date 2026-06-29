import { currentBoundaryBatchToken, deferAfterBatchForTarget } from "../batch/batch.js";
import { deferRewire } from "../batch/boundary.js";
import type { NodeFn } from "../ctx/types.js";
import type { Wave } from "../protocol/messages.js";
import { errorPayload, SENTINEL } from "../protocol/messages.js";
import type { Node } from "./node.js";
import { type NodeRuntimeHost, nodeRuntimeHost } from "./node-runtime-host.js";
import { notifyTopologyDepsChanged } from "./runtime-accessors.js";
import type { RewireOp } from "./types.js";

export function nodeRequestRewireNext<T>(self: NodeRuntimeHost<T>, op: RewireOp): void {
	deferRewire(self._core, () => self._applyRewireNext(op), {
		batchToken: currentBoundaryBatchToken(),
		isReady: () => !self._hasBoundaryPauseLock(),
	});
}

export function nodeRequestUpNext<T>(
	self: NodeRuntimeHost<T>,
	msgs: Wave,
	towardDep?: number,
): void {
	deferRewire(
		self._core,
		() => {
			if (!self._released) self._up(msgs, towardDep);
		},
		{
			batchToken: currentBoundaryBatchToken(),
			isReady: () => !self._hasBoundaryPauseLock(),
		},
	);
}

export function nodeApplyRewireNext<T>(self: NodeRuntimeHost<T>, op: RewireOp): void {
	if (self._released) return;
	try {
		// D62 / R-rewire-deferred: terminal seals output but does NOT cancel queued topology.
		// Public/immediate rewire of a terminal node still rejects; the exception is only for
		// self-triggered ops already issued before terminal and now draining at the boundary.
		if (op.kind === "add") {
			const next = self._slot.deps.includes(op.dep)
				? [...self._slot.deps]
				: [...self._slot.deps, op.dep];
			self._rewire(next, op.fn, { allowTerminalOwner: true });
		} else if (op.kind === "remove") {
			self._rewire(
				self._slot.deps.filter((d) => d !== op.dep),
				op.fn,
				{ allowTerminalOwner: true },
			);
		} else {
			self._rewire(self._dedupDeps(op.deps), op.fn, { allowTerminalOwner: true });
		}
	} catch (e) {
		// An invalid deferred op (cycle / self / non-resubscribable terminal dep) surfaces as
		// an ERROR on this node (D30-consistent) rather than stranding the rest of the drain
		// queue. Reachable only on misuse — higher-order operator inners are fresh, acyclic
		// leaf sources. Coerce a SENTINEL reason (a rewire fn that `throw undefined`s) to a real
		// Error so _down's R-data-payload guard does not itself throw out of the drain.
		self._down([["ERROR", errorPayload(e, "rewireNext op failed")]]);
	}
}

export function nodeRewire<T>(
	self: NodeRuntimeHost<T>,
	newDeps: Node<unknown>[],
	fn: NodeFn,
	opts: { allowTerminalOwner?: boolean } = {},
): boolean {
	const node = self as unknown as Node<unknown>;
	// ── rejects (R-rewire / D42) ──
	if (self._value.terminal !== undefined && !opts.allowTerminalOwner)
		throw new Error(
			"rewire: node is terminal (completed/errored) — cannot rewire (R-rewire / D42)",
		);
	if (self._wave.insideRunWave)
		throw new Error(
			"rewire: mid-fn topology mutation — a fn mutating its own deps mid-wave is the feedback cycle (R-rewire / D37)",
		);
	if (self._wave.inDepMutation)
		throw new Error(
			"rewire: reentrant dep mutation — another replaceDeps/subscribeDep/unsubscribeDep is in flight (R-rewire)",
		);
	if (newDeps.includes(node)) throw new Error("rewire: self-dependency rejected (R-rewire / D42)");
	const oldDeps = self._slot.deps;
	const added = newDeps.filter((d) => !oldDeps.includes(d));
	for (const d of added) {
		if (self._reachableUpstream(d, node))
			throw new Error(
				"rewire: would create a cycle — dep already transitively depends on this node (R-rewire / D42)",
			);
		const dep = nodeRuntimeHost(d);
		if (dep._value.terminal !== undefined && !dep._slot.resubscribable)
			throw new Error(
				"rewire: cannot add a non-resubscribable terminal dep — would wedge (R-rewire / D42)",
			);
		self._assertRewireDepOwner(d);
	}

	if (
		deferAfterBatchForTarget(node, () => {
			self._rewire(newDeps, fn, { ...opts, allowTerminalOwner: true });
		})
	) {
		return true;
	}
	if (!self._lifecycle.activated) self._restoredActivationPending = false;

	self._wave.inDepMutation = true;
	self._wave.rewireRunPending = false;
	let zeroDepUnDirty = false;
	try {
		// fn swap (SD-1): re-register against the same pool, then release the old handle
		// (B15) so the rewired-away fn closure is GC'd and its dispatcher slot is reused —
		// a rewire-heavy graph (CSP-2.7 *Map) no longer leaks a handle per swap. Register
		// first, then unregister the old: self._slot.handle never points at a freed slot, and a
		// null old handle (a passthrough/state node gaining a fn) has nothing to free.
		const oldHandle = self._slot.handle;
		self._slot.handle = self._slot.dispatcher.register(fn, self._slot.pool);
		if (oldHandle !== null) self._slot.dispatcher.unregister(oldHandle);

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
		// + subscription, added deps start fresh (R-rewire Q1/Q4).
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
		self._dep.unsubs = newUnsubs;
		self._dep.idxBoxes = newBoxes;
		self._dep.waveData = newDeps.map(() => []);
		self._dep.waveTokens = new Array(newDeps.length).fill(undefined);
		self._dep.waveLive = newDeps.map(() => []);
		self._syncCtx = null;

		// Subscribe added deps — push-on-subscribe (R-push-subscribe) delivers a cached
		// dep's DATA here, which drives _maybeRun; a SENTINEL dep delivers START only.
		if (self._lifecycle.activated) {
			for (const d of added) self._subscribeDepAt(d);
		}
		notifyTopologyDepsChanged(node, oldDeps, newDeps);

		// Q6 auto-settle: removing the sole dirty contributor closes the wave. With deps
		// remaining, request the atomic settle (recompute → DATA for a value; a no-emit fn
		// gets a substrate-synthesized undirty RESOLVED per R-resolved-undirty/D49 — NOT
		// equals-absorption, which is gone). With zero deps the node is inert (degenerate
		// fn-no-deps) — just un-dirty downstream. Cache is preserved either way (Q7).
		if (removedDirtyContributor && self._wave.pending === 0 && self._value.status === "dirty") {
			if (newDeps.length > 0) self._wave.rewireRunPending = true;
			else zeroDepUnDirty = true;
		}
	} finally {
		self._wave.inDepMutation = false;
	}

	// Atomic post-mutation settle (outside the reentrancy guard so a fresh wave runs
	// normally): ONE two-phase DIRTY→DATA recompute if any added dep delivered data or a
	// sole-dirty dep was removed; else the zero-dep un-dirty via _down (pause/batch-safe).
	if (self._wave.rewireRunPending) {
		self._wave.rewireRunPending = false;
		self._settleRewire();
	} else if (zeroDepUnDirty) {
		if (self._wave.emittedDirtyThisWave) self._down([["RESOLVED"]]);
		else self._value.status = self._value.hasData ? "settled" : "sentinel";
	}
	return false;
}
