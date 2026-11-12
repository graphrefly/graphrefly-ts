import type { Node } from "./node.js";
import type { NodeRuntimeHost } from "./node-runtime-host.js";
import type { NodeSeed } from "./types.js";

/**
 * R-subscription@3: install a node's construction seed without a wave or a subscription. A state
 * gets its values as one array and then its terminal; a computed node also gets its private state
 * and the dependencies of its first lifetime, and an open one keeps the note for the first run of
 * the seeded instance (`ctx.seed`). Its first activation is an ordinary one.
 */
export function nodeRestoreState(self: NodeRuntimeHost, seed: NodeSeed): void {
	self._assertNotReleased("restoreGraph");
	// The first lifetime's dependencies; the declared ones come back when it closes.
	if (seed.deps !== undefined) self._rewire([...seed.deps] as Node<unknown>[]);
	const values = [...seed.values];
	self._value.lastArray = values;
	self._value.hasData = values.length > 0;
	self._value.cache = values.length > 0 ? values[values.length - 1] : undefined;
	self._value.terminal = seed.terminal;
	self._wave.emittedDirtyThisWave = false;
	self._wave.emittedSettleThisWave = false;
	self._wave.pending = 0;
	self._wave.insideRunWave = false;
	self._wave.inDepMutation = false;
	self._wave.rewireRunPending = false;
	self._privateState.value = seed.privateState;
	self._syncCtx = null;
	self._resetDepState();
	// A seeded graph has no subscribers, and a seeded node receives no waves before its first
	// activation.
	self._lifecycle.activated = false;
	self._lifecycle.subscribers.clear();
	// An ended node's function never runs again, and a state has none: neither keeps a note.
	const isState = self._slot.handle === null && self._slot.deps.length === 0;
	self._seedNote = isState || seed.terminal !== undefined ? undefined : seed.note;
}
