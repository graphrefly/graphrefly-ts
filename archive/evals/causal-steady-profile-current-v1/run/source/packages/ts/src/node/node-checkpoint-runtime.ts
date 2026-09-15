import type { NodeRuntimeHost } from "./node-runtime-host.js";
import type { NodeRestoreState } from "./types.js";
import { cloneNodeVersion, restoredV1Cid } from "./versioning.js";

/** D94: fixed restore operation over the issued runtime; no additional state owner. */
export function nodeRestoreState(self: NodeRuntimeHost, state: NodeRestoreState): void {
	self._assertNotReleased("restoreGraph");
	self._value.cache = state.cache as unknown;
	self._value.hasData = state.hasData;
	self._value.status = state.status;
	self._value.terminal = state.terminal;
	self._value.hasTorndown = false;
	self._value.replayRing = [];
	self._wave.hasCalledFnOnce = state.hasCalledFnOnce;
	self._wave.emittedDirtyThisWave = false;
	self._wave.emittedSettleThisWave = false;
	self._wave.pending = 0;
	self._wave.insideRunWave = false;
	self._wave.inDepMutation = false;
	self._wave.rewireRunPending = false;
	self._wave.batchDirtyOwed = false;
	self._control.pauseBuffer = [];
	self._control.pausedDepWaveOccurred = false;
	self._control.demandOwed = undefined;
	self._control.activePull = undefined;
	self._control.pullDirtyOwed = false;
	self._control.inDeliverDemand = false;
	self._control.pauseLockset.clear();
	self._privateState.value = state.ctxState.value;
	self._privateState.persist = state.ctxState.persist;
	if (state.version === false) {
		self._version.policy = { enabled: false };
		self._version.value = undefined;
	} else if (state.version.level === 0) {
		self._version.policy = { enabled: true, level: 0 };
		self._version.value = cloneNodeVersion(state.version);
	} else {
		if (!self._version.policy.enabled || self._version.policy.level !== 1) {
			throw new Error(
				`restoreGraph: checkpoint node version level ${state.version.level} requires matching node versioning policy`,
			);
		}
		// D109: V1 restore must match the selected hash lane. After DATA then
		// INVALIDATE/resetOnTeardown, cache is absent while cid remains the last DATA cid;
		// without the DATA value, restore cannot verify the lane, so fail honestly.
		if (!state.hasData && state.version.counter > 0) {
			throw new Error(
				"restoreGraph: checkpoint node version cid cannot be verified without current DATA under V1 versioning (D109)",
			);
		}
		const expectedCid = restoredV1Cid(self._version.policy, state.hasData, state.cache);
		if (expectedCid !== state.version.cid) {
			throw new Error(
				"restoreGraph: checkpoint node version cid does not match the selected node versioning hash policy (D109)",
			);
		}
		self._version.value = cloneNodeVersion(state.version);
	}
	self._syncCtx = null;
	self._resetDepState();
	// A fresh restored graph has no subscribers before return. Keep activation closed so the
	// first real subscriber wires deps normally; D94's preserved lifecycle bit is the first-run
	// gate (`hasCalledFnOnce`), not a hidden subscription graph.
	self._lifecycle.activated = false;
	self._lifecycle.subscribers.clear();
	self._restoredActivationPending = true;
}
