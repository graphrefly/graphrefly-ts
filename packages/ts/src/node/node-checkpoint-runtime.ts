import type { Node } from "./node.js";
import { LIFECYCLE, PRIVATE_STATE, SEED_NOTE, SLOT, VALUE, WAVE } from "./node-keys.js";
import { nodeAssertNotReleased, nodeResetDepState } from "./node-lifecycle-runtime.js";
import { nodeRewire } from "./node-rewire-runtime.js";
import type { NodeSeed } from "./types.js";

/**
 * R-subscription@3: install a node's construction seed without a wave or a subscription. A state
 * gets its values as one array and then its terminal; a computed node also gets its private state
 * and the dependencies of its first lifetime, and an open one keeps the note for the first run of
 * the seeded instance (`ctx.seed`). Its first activation is an ordinary one.
 */
export function nodeRestoreState(self: Node, seed: NodeSeed): void {
	nodeAssertNotReleased(self, "restoreGraph");
	// The first lifetime's dependencies; the declared ones come back when it closes.
	if (seed.deps !== undefined) nodeRewire(self, [...seed.deps] as Node<unknown>[]);
	const values = [...seed.values];
	self[VALUE].lastArray = values;
	self[VALUE].hasData = values.length > 0;
	self[VALUE].cache = values.length > 0 ? values[values.length - 1] : undefined;
	self[VALUE].terminal = seed.terminal;
	self[WAVE].emittedDirtyThisWave = false;
	self[WAVE].emittedSettleThisWave = false;
	self[WAVE].pending = 0;
	self[WAVE].insideRunWave = false;
	self[WAVE].inDepMutation = false;
	self[WAVE].rewireRunPending = false;
	self[PRIVATE_STATE].value = seed.privateState;
	nodeResetDepState(self);
	// A seeded graph has no subscribers, and a seeded node receives no waves before its first
	// activation.
	self[LIFECYCLE].activated = false;
	self[LIFECYCLE].subscribers.clear();
	// An ended node's function never runs again, and a state has none: neither keeps a note.
	const isState = self[SLOT].handle === null && self[SLOT].deps.length === 0;
	self[SEED_NOTE] = isState || seed.terminal !== undefined ? undefined : seed.note;
}
