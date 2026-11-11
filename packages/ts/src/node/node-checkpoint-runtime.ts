import type { NodeRuntimeHost } from "./node-runtime-host.js";
import type { NodeRestoreState } from "./types.js";

/**
 * R-checkpoint: install a restored node's construction seed (R-subscription) without a wave or a
 * subscription. A state gets its values as one array and then its terminal; a computed node also
 * gets its private state and, when it had a lifetime, the record of what it received, which its
 * first activation compares with what its dependencies hold then.
 */
export function nodeRestoreState(self: NodeRuntimeHost, state: NodeRestoreState): void {
	self._assertNotReleased("restoreGraph");
	const values = [...state.values];
	self._value.lastArray = values;
	self._value.hasData = values.length > 0;
	self._value.cache = values.length > 0 ? values[values.length - 1] : undefined;
	self._value.terminal = state.terminal;
	self._wave.hasCalledFnOnce = state.seed?.ran ?? false;
	self._wave.emittedDirtyThisWave = false;
	self._wave.emittedSettleThisWave = false;
	self._wave.pending = 0;
	self._wave.insideRunWave = false;
	self._wave.inDepMutation = false;
	self._wave.rewireRunPending = false;
	self._privateState.value = state.privateState;
	self._syncCtx = null;
	self._resetDepState();
	// A restored graph has no subscribers, and a restored node receives no waves before its first
	// activation (R-checkpoint).
	self._lifecycle.activated = false;
	self._lifecycle.subscribers.clear();
	self._seed = state.seed;
}
