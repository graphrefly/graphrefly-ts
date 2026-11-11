import { currentBatch, deferToBatch } from "../batch/batch.js";
import { deferRewire } from "../batch/boundary.js";
import type { DeliveryMeta } from "../ctx/types.js";
import type { Message, Wave } from "../protocol/messages.js";
import { isDeferredTier, isValueTier, messageTier, SENTINEL } from "../protocol/messages.js";
import type { Node } from "./node.js";
import type { NodeRuntimeHost } from "./node-runtime-host.js";
import { validateDownPayloads } from "./protocol-guards.js";
import {
	advanceNodeVersion,
	assertNodeVersionDataCompatible,
	type NodeVersion,
	snapshotNodeVersionData,
} from "./versioning.js";

export function nodeDown<T>(self: NodeRuntimeHost<T>, msgs: Wave): void {
	if (self._released) return;
	validateDownPayloads(msgs);
	const deliveryWave = {};
	const assertVersionDataCompatible = (wave: readonly Message[]) => {
		for (const m of wave) {
			if (m[0] === "DATA") assertNodeVersionDataCompatible(self._version.policy, m[1]);
		}
	};
	const snapshotVersionData = (wave: readonly Message[]): Message[] =>
		wave.map((m) =>
			m[0] === "DATA"
				? (["DATA", snapshotNodeVersionData(self._version.policy, m[1])] as Message)
				: m,
		);
	assertVersionDataCompatible(msgs);
	// Terminal-is-forever (R-terminals): once COMPLETE/ERROR has been emitted the node's output
	// is final — a self-emit (state.set / ctx.down) in a LATER wave is a no-op, never resurrecting
	// the cache or re-emitting. A single wave that goes terminal mid-loop is unaffected: _terminal
	// is still undefined at entry. Resubscribable reset clears _terminal before any re-emit.
	if (self._value.terminal !== undefined) return;
	let sorted: Message[] = [...msgs].sort((a, b) => messageTier(a[0]) - messageTier(b[0]));
	// R-same-wave-merge: collapse repeated INVALIDATE in one wave (Q9) so the
	// cleanup hook + downstream broadcast fire at most once.
	const firstInvalidate = sorted.findIndex((m) => m[0] === "INVALIDATE");
	if (firstInvalidate !== -1) {
		sorted = sorted.filter((m, i) => m[0] !== "INVALIDATE" || i === firstInvalidate);
	}
	// R-batch-coalesce (D12): inside a batch, emit PENDING immediately but defer the
	// tier-3 settle slice to commit so a shared downstream recomputes once. Only
	// external emits defer (fn emits during commit run normally).
	if (!self._wave.insideRunWave && currentBatch()) {
		const deferred = snapshotVersionData(sorted.filter((m) => isDeferredTier(m[0])));
		if (deferred.length > 0) {
			if (!self._wave.emittedDirtyThisWave) {
				self._wave.emittedDirtyThisWave = true;
				self._value.status = "dirty";
				self._emitToSubs(["PENDING"], { wave: deliveryWave, last: false });
			}
			self._wave.batchDirtyOwed = true; // BH1: owe a balancing RESOLVED on rollback
			deferToBatch(self as unknown as Node<unknown>, deferred);
			return;
		}
	}
	let dataCount = 0;
	let hasTier3 = false;
	for (const m of sorted) {
		if (m[0] === "DATA") dataCount++;
		if (isValueTier(m[0])) hasTier3 = true;
	}
	const plannedVersions: Array<NodeVersion | undefined> = new Array(sorted.length);
	if (dataCount > 0) {
		let plannedVersion = self._version.value;
		for (let i = 0; i < sorted.length; i++) {
			const m = sorted[i];
			if (m[0] !== "DATA") continue;
			plannedVersion = advanceNodeVersion(plannedVersion, self._version.policy, m[1]);
			plannedVersions[i] = plannedVersion;
		}
	}

	// The kernel sends PENDING before an EXTERNAL value emit (R-wave: PENDING is the kernel's
	// alone; node output carrying PENDING is rejected at ctx.down).
	if (hasTier3 && !self._wave.insideRunWave && !self._wave.emittedDirtyThisWave) {
		self._wave.emittedDirtyThisWave = true;
		self._value.status = "dirty";
		self._emitToSubs(["PENDING"], { wave: deliveryWave, last: false });
	}

	for (let i = 0; i < sorted.length; i++) {
		const m = sorted[i];
		const delivery = { wave: deliveryWave, last: i === sorted.length - 1 };
		// R-resolved-undirty (D49): a tier-3+ emit this wave means the fn produced a settle,
		// so no synthesized undirty RESOLVED is owed (see _runWave).
		if (isDeferredTier(m[0])) self._wave.emittedSettleThisWave = true;
		if (m[0] === "DATA") {
			const v = m[1] as T;
			// R-resolved-undirty (D49): every value-occurrence is emitted as DATA — the
			// substrate never substitutes DATA->RESOLVED on value-equality. Dedup is opt-in
			// at the operator layer (distinctUntilChanged), never a substrate behavior.
			self._value.cache = v;
			self._value.hasData = true;
			self._value.status = "settled";
			self._version.value = plannedVersions[i];
			if (self._slot.replayN > 0) {
				self._value.replayRing.push(v);
				if (self._value.replayRing.length > self._slot.replayN) self._value.replayRing.shift();
			}
			self._emitToSubs(["DATA", v], delivery);
			continue;
		}
		if (m[0] === "RESOLVED") {
			self._value.status = self._value.hasData ? "resolved" : "sentinel";
			self._emitToSubs(["RESOLVED"], delivery);
			continue;
		}
		if (m[0] === "INVALIDATE") {
			self._invalidate(delivery);
			continue;
		}
		if (m[0] === "COMPLETE") {
			if (self._value.terminal !== undefined) continue;
			self._value.terminal = true;
			self._value.status = "completed";
			self._emitToSubs(["COMPLETE"], delivery);
			continue;
		}
		if (m[0] === "ERROR") {
			if (self._value.terminal !== undefined) continue;
			self._value.terminal = m[1];
			self._value.status = "errored";
			self._emitToSubs(["ERROR", m[1]], delivery);
		}
	}

	if (!self._wave.insideRunWave) self._wave.emittedDirtyThisWave = false;
}

export function nodeInvalidate<T>(self: NodeRuntimeHost<T>, delivery?: DeliveryMeta): void {
	if (!self._value.hasData) return; // never-populated or already-reset → no-op
	self._value.cache = SENTINEL;
	self._value.hasData = false;
	self._value.status = "sentinel";
	self._value.replayRing = []; // BH6: invalidated values are stale — don't replay them
	for (const fn of self._hooks.onInvalidate) fn();
	self._emitToSubs(["INVALIDATE"], delivery);
}

export function nodeAllDepsTerminal<T>(self: NodeRuntimeHost<T>): boolean {
	if (self._slot.deps.length === 0) return false;
	for (const tm of self._dep.terminal) if (tm === undefined) return false;
	return true;
}

export function nodeResetLifecycle<T>(self: NodeRuntimeHost<T>): void {
	for (const u of self._dep.unsubs) if (u) u();
	self._dep.unsubs = [];
	self._dep.idxBoxes = [];
	self._lifecycle.subscribers.clear();
	self._lifecycle.activated = false;
	self._value.terminal = undefined;
	self._wave.hasCalledFnOnce = false;
	self._resetDepState();
	self._value.replayRing = []; // BH6
	const isCompute = self._slot.handle !== null || self._slot.deps.length > 0;
	if (isCompute) {
		self._value.cache = SENTINEL;
		self._value.hasData = false;
		self._value.status = "sentinel";
	} else {
		self._value.status = self._value.hasData ? "settled" : "sentinel";
	}
	if (!self._privateState.persist) self._privateState.value = SENTINEL;
}

export function nodeEmitToSubs<T>(
	self: NodeRuntimeHost<T>,
	msg: Message,
	delivery?: DeliveryMeta,
): void {
	if (self._released) return;
	// Copy guards against subscribe/unsubscribe during iteration.
	const subs = [...self._lifecycle.subscribers];
	for (const sink of subs) sink(msg, delivery);
}

export function nodeCommitBatchedWave<T>(self: NodeRuntimeHost<T>, wave: Wave): void {
	self._wave.batchDirtyOwed = false; // commit delivers the real settle (BH1)
	self._down(wave); // batch is inactive at commit -> processes normally
}

export function nodeRollbackBatched<T>(self: NodeRuntimeHost<T>): void {
	// BH1: keyed on _batchDirtyOwed (not _emittedDirtyThisWave, which a fn wave between
	// defer and rollback would have reset) so the balancing RESOLVED is never skipped.
	if (self._wave.batchDirtyOwed) {
		self._wave.batchDirtyOwed = false;
		self._wave.emittedDirtyThisWave = false;
		self._value.status = self._value.hasData ? "settled" : "sentinel";
		self._emitToSubs(["RESOLVED"]);
	}
}

export function nodeDeferBoundary<T>(
	self: NodeRuntimeHost<T>,
	fn: () => void,
	batchToken?: object,
): void {
	deferRewire(self._core, fn, { batchToken });
}
