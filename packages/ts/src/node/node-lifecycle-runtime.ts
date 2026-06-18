import { SENTINEL } from "../protocol/messages.js";
import type { Node } from "./node.js";
import { type NodeRuntimeHost, nodeRuntimeHost } from "./node-runtime-host.js";
import {
	activationReaders,
	checkpointReaders,
	ownerTokens,
	releasedNodes,
	restoreWriters,
	runtimeQuiescenceReaders,
	runtimeReleasers,
	subscriberCountReaders,
	topologyDepsChangedObservers,
} from "./runtime-accessors.js";

export function nodeActivate<T>(self: NodeRuntimeHost<T>): void {
	self._lifecycle.activated = true;
	const seedRestoredDeps = self._restoredActivationPending;
	self._restoredActivationPending = false;
	// R-pull (D55/D272): activePull is undefined before wiring deps, so each dep's
	// push-on-subscribe DIRTY/DATA is absorbed quietly, not relayed downstream.
	self._dep.unsubs = new Array(self._slot.deps.length);
	self._dep.idxBoxes = new Array(self._slot.deps.length);
	for (const dep of self._slot.deps) self._subscribeDepAt(dep, { seedRestored: seedRestoredDeps });
	// Depless producer (fn, no deps): run once on activation.
	if (self._slot.deps.length === 0 && self._slot.handle !== null && !self._wave.hasCalledFnOnce) {
		self._runWave();
	}
}

export function nodeSubscribeDepAt<T>(
	self: NodeRuntimeHost<T>,
	depNode: Node<unknown>,
	opts: { seedRestored?: boolean } = {},
): void {
	const idx0 = self._slot.deps.indexOf(depNode);
	const box = { v: idx0 };
	let ignoreInitialPush = opts.seedRestored === true;
	if (ignoreInitialPush && idx0 !== -1) {
		self._seedRestoredDepAt(idx0, depNode);
		const dep = nodeRuntimeHost(depNode);
		if (dep._value.terminal !== undefined && !dep._slot.resubscribable) {
			self._dep.unsubs[idx0] = () => {};
			self._dep.idxBoxes[idx0] = box;
			return;
		}
	}
	const unsub = depNode.subscribe((msg, delivery) => {
		if (ignoreInitialPush && delivery === undefined) return;
		if (ignoreInitialPush) ignoreInitialPush = false;
		if (box.v === -1) return; // dep removed — stale callback, drop (drain)
		self._receiveFromDep(box.v, msg, delivery);
	});
	if (ignoreInitialPush && idx0 !== -1 && box.v !== -1) self._seedRestoredDepAt(idx0, depNode);
	ignoreInitialPush = false;
	if (idx0 !== -1) {
		self._dep.unsubs[idx0] = unsub;
		self._dep.idxBoxes[idx0] = box;
	}
}

export function nodeSeedRestoredDepAt<T>(
	self: NodeRuntimeHost<T>,
	idx: number,
	depNode: Node<unknown>,
): void {
	const dep = nodeRuntimeHost(depNode);
	const seedData = dep._value.hasData && !dep._slot.pull;
	self._dep.batch[idx] = null;
	self._dep.waveData[idx] = [];
	self._dep.waveTokens[idx] = undefined;
	self._dep.prev[idx] = seedData ? dep._value.cache : SENTINEL;
	self._dep.hasData[idx] = seedData;
	self._dep.dirty[idx] = false;
	self._dep.tier[idx] = seedData ? 3 : 0;
	self._dep.terminal[idx] = dep._value.terminal;
	self._dep.terminalInput[idx] = undefined;
}

export function nodeDeactivate<T>(self: NodeRuntimeHost<T>): void {
	self._lifecycle.activated = false;
	for (const u of self._dep.unsubs) if (u) u();
	self._dep.unsubs = [];
	self._dep.idxBoxes = [];
	for (const fn of self._hooks.onDeactivation) fn();
	self._hooks.onDeactivation = [];
	self._hooks.onInvalidate = [];

	const isCompute = self._slot.handle !== null || self._slot.deps.length > 0;
	if (isCompute) {
		// RAM: compute nodes clear cache; reconnect re-runs fn fresh.
		self._value.cache = SENTINEL;
		self._value.hasData = false;
		self._value.status = "sentinel";
	}
	self._resetDepState();
	self._wave.hasCalledFnOnce = false;
	self._control.pauseLockset.clear();
	self._control.pauseBuffer = [];
	self._control.pausedDepWaveOccurred = false;
	self._control.demandOwed = undefined; // R-pull (D269): drop any deferred demand
	self._control.activePull = undefined;
	self._control.pullDirtyOwed = false;
	self._value.replayRing = []; // BH6: don't replay stale values to a post-reactivation subscriber
	if (!self._privateState.persist) self._privateState.value = SENTINEL;
}

export function nodeSubscriberCount<T>(self: NodeRuntimeHost<T>): number {
	return self._lifecycle.subscribers.size;
}

export function nodeIsRuntimeQuiescentForRelease<T>(self: NodeRuntimeHost<T>): boolean {
	return (
		!self._released &&
		self._value.status !== "dirty" &&
		self._value.status !== "pending" &&
		self._wave.pending === 0 &&
		!self._wave.insideRunWave &&
		!self._wave.inDepMutation &&
		!self._wave.rewireRunPending &&
		!self._wave.batchDirtyOwed &&
		self._dep.dirty.every((dirty) => !dirty) &&
		self._control.pauseBuffer.length === 0 &&
		!self._control.pausedDepWaveOccurred &&
		self._control.demandOwed === undefined &&
		self._control.activePull === undefined &&
		!self._control.inDeliverDemand &&
		self._control.pauseLockset.size === 0
	);
}

export function nodeReleaseRuntime<T>(self: NodeRuntimeHost<T>): void {
	if (self._released) return;
	self._released = true;
	const node = self as unknown as Node<unknown>;
	releasedNodes.add(node);
	let releaseError: unknown;
	const recordReleaseError = (error: unknown): void => {
		if (releaseError === undefined) releaseError = error;
	};
	self._lifecycle.activated = false;
	for (const u of self._dep.unsubs) {
		try {
			u();
		} catch (error) {
			recordReleaseError(error);
			// D124 release is graph-owned and atomic; user cleanup must not split commit.
		}
	}
	for (const fn of self._hooks.onDeactivation) {
		try {
			fn();
		} catch (error) {
			recordReleaseError(error);
			// D124 release cleans runtime without synthesizing protocol ERROR/COMPLETE.
		}
	}
	self._dep.unsubs = [];
	self._dep.idxBoxes = [];
	self._lifecycle.subscribers.clear();
	if (self._slot.handle !== null) {
		self._slot.dispatcher.unregister(self._slot.handle);
		self._slot.handle = null;
	}
	self._slot.deps = [];
	self._dep.batch = [];
	self._dep.waveData = [];
	self._dep.waveTokens = [];
	self._dep.prev = [];
	self._dep.hasData = [];
	self._dep.dirty = [];
	self._dep.tier = [];
	self._dep.terminal = [];
	self._dep.terminalInput = [];
	self._value.cache = SENTINEL;
	self._value.hasData = false;
	self._value.status = "sentinel";
	self._value.terminal = undefined;
	self._value.replayRing = [];
	self._privateState.value = SENTINEL;
	self._privateState.persist = false;
	self._syncCtx = null;
	self._resetDepState();
	self._hooks.onDeactivation = [];
	self._hooks.onInvalidate = [];
	self._control.pauseLockset.clear();
	self._control.pauseBuffer = [];
	self._control.pausedDepWaveOccurred = false;
	self._control.demandOwed = undefined;
	self._control.activePull = undefined;
	self._control.pullDirtyOwed = false;
	self._restoredActivationPending = false;
	checkpointReaders.delete(node);
	restoreWriters.delete(node);
	runtimeReleasers.delete(node);
	runtimeQuiescenceReaders.delete(node);
	subscriberCountReaders.delete(node);
	activationReaders.delete(node);
	ownerTokens.delete(node);
	topologyDepsChangedObservers.delete(node);
	self._core.releaseSlot(self._id);
	if (releaseError !== undefined) throw releaseError;
}

export function nodeResetDepState<T>(self: NodeRuntimeHost<T>): void {
	const n = self._slot.deps.length;
	for (let i = 0; i < n; i++) {
		self._dep.batch[i] = null;
		self._dep.waveData[i] = [];
		self._dep.waveTokens[i] = undefined;
		self._dep.prev[i] = SENTINEL;
		self._dep.hasData[i] = false;
		self._dep.dirty[i] = false;
		self._dep.tier[i] = 0;
		self._dep.terminal[i] = undefined;
		self._dep.terminalInput[i] = undefined;
	}
	self._wave.pending = 0;
	self._wave.emittedDirtyThisWave = false;
}
