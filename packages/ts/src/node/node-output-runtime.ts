import { currentBatch, deferToBatch } from "../batch/batch.js";
import { deferRewire, scheduleBoundaryDrain } from "../batch/boundary.js";
import type { DeliveryMeta } from "../ctx/types.js";
import type { LockId, Message, PullDemand, Wave } from "../protocol/messages.js";
import {
	isDeferredTier,
	isPauseBufferedTier,
	isUpAllowed,
	isValueTier,
	messageTier,
	SENTINEL,
} from "../protocol/messages.js";
import type { Node } from "./node.js";
import { type NodeRuntimeHost, nodeRuntimeHost } from "./node-runtime-host.js";
import { normalizePullDemand, validateDownPayloads } from "./protocol-guards.js";
import type { UpRouteState } from "./types.js";
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
	// Terminal-is-forever (R-terminal / D17 / B30): once COMPLETE/ERROR has been emitted the
	// node is final — a self-emit (state.set / ctx.down) in a LATER wave is a no-op, never
	// resurrecting the cache or re-emitting. The COMPLETE/ERROR arms below also self-guard
	// against a double terminal, but DATA/RESOLVED/INVALIDATE had no entry guard, so a
	// post-terminal set() would overwrite cache + emit DATA. R-teardown-terminal-relay / D65
	// carves out the only post-terminal exception: TEARDOWN still relays downstream for unwire
	// without reopening value output. A single wave that goes terminal mid-loop (e.g.
	// [COMPLETE, TEARDOWN]) is unaffected: _terminal is still undefined at entry.
	// Resubscribable reset clears _terminal before any re-emit.
	if (self._value.terminal !== undefined) {
		if (!msgs.some((m) => m[0] === "TEARDOWN")) return;
		self._value.hasTorndown = true;
		if (self._slot.resetOnTeardown) {
			self._value.cache = SENTINEL;
			self._value.hasData = false;
		}
		self._emitToSubs(["TEARDOWN"], { wave: deliveryWave, last: true });
		return;
	}
	let sorted: Message[] = [...msgs].sort((a, b) => messageTier(a[0]) - messageTier(b[0]));
	// R-same-wave-merge: collapse repeated INVALIDATE in one wave (Q9) so the
	// cleanup hook + downstream broadcast fire at most once.
	const firstInvalidate = sorted.findIndex((m) => m[0] === "INVALIDATE");
	if (firstInvalidate !== -1) {
		sorted = sorted.filter((m, i) => m[0] !== "INVALIDATE" || i === firstInvalidate);
	}
	// R-teardown-complete: a TEARDOWN reaching a non-terminal node synthesizes a
	// COMPLETE prefix (so firstValueFrom-style bridges resolve), unless the wave
	// already carries a terminal or the node already tore down.
	const hasTeardown = sorted.some((m) => m[0] === "TEARDOWN");
	const hasTerminal = sorted.some((m) => m[0] === "COMPLETE" || m[0] === "ERROR");
	if (
		hasTeardown &&
		!hasTerminal &&
		self._value.terminal === undefined &&
		!self._value.hasTorndown
	) {
		sorted = [["COMPLETE"], ...sorted];
	}
	// R-batch-coalesce (D12): inside a batch, emit DIRTY immediately but defer the
	// tier-3 settle slice to commit so a shared downstream recomputes once. Only
	// external emits defer (fn emits during commit run normally).
	if (!self._wave.insideRunWave && currentBatch()) {
		const deferred = snapshotVersionData(sorted.filter((m) => isDeferredTier(m[0])));
		if (deferred.length > 0) {
			if (!self._wave.emittedDirtyThisWave) {
				self._wave.emittedDirtyThisWave = true;
				self._value.status = "dirty";
				self._emitToSubs(["DIRTY"], { wave: deliveryWave, last: false });
			}
			self._wave.batchDirtyOwed = true; // BH1: owe a balancing RESOLVED on rollback
			deferToBatch(self as unknown as Node<unknown>, deferred);
			return;
		}
	}
	// R-pause-modes / R-async-paused: defer the settle slice (tier 3/4) into the
	// pause buffer while paused; tier 0-2 (DIRTY/PAUSE/RESUME), tier 5 (terminal),
	// tier 6 (TEARDOWN) bypass so end-of-stream + control always reach observers.
	if (self._shouldBufferOnPause()) {
		const buffered = snapshotVersionData(sorted.filter((m) => isPauseBufferedTier(m[0])));
		if (buffered.length > 0) {
			// B36 / R-resolved-undirty: buffering a settle slice still means this fn wave
			// produced a settle. Without this, _runWave sees "dirty + no settle" and
			// synthesizes a RESOLVED that pierces the pause while the DATA waits in the buffer.
			self._wave.emittedSettleThisWave = true;
			self._control.pauseBuffer.push(buffered);
		}
		sorted = sorted.filter((m) => !isPauseBufferedTier(m[0]));
		if (sorted.length === 0) return;
	}
	let dataCount = 0;
	let hasTier3 = false;
	let hasResolved = false;
	for (const m of sorted) {
		if (m[0] === "DATA") dataCount++;
		if (m[0] === "RESOLVED") hasResolved = true;
		if (isValueTier(m[0])) hasTier3 = true;
	}
	// EC2 / R-resolved-undirty tier-3 exclusivity: a wave's tier-3 slot is >=1 DATA
	// (occurrence) XOR exactly 1 RESOLVED (undirty) — never mixed. Reject fail-fast.
	if (dataCount >= 1 && hasResolved) {
		throw new Error(
			"down: a wave cannot mix DATA and RESOLVED (tier-3 exclusivity, R-resolved-undirty)",
		);
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

	// Synthesize a leading DIRTY for an EXTERNAL tier-3 emit (R-dirty-before-data), and for
	// PULL demand fns only when they actually emit tier-3. A no-op pull helper must stay silent.
	if (
		hasTier3 &&
		(!self._wave.insideRunWave || self._control.pullDirtyOwed) &&
		!self._wave.emittedDirtyThisWave
	) {
		self._wave.emittedDirtyThisWave = true;
		self._value.status = "dirty";
		self._emitToSubs(["DIRTY"], { wave: deliveryWave, last: false });
	}

	for (let i = 0; i < sorted.length; i++) {
		const m = sorted[i];
		const delivery = { wave: deliveryWave, last: i === sorted.length - 1 };
		// R-resolved-undirty (D49): a tier-3+ emit this wave means the fn produced a settle,
		// so no synthesized undirty RESOLVED is owed (see _runWave).
		if (isDeferredTier(m[0])) self._wave.emittedSettleThisWave = true;
		if (m[0] === "DIRTY") {
			if (!self._wave.emittedDirtyThisWave) {
				self._wave.emittedDirtyThisWave = true;
				self._value.status = "dirty";
				self._emitToSubs(["DIRTY"], delivery);
			}
			continue;
		}
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
			self._control.pauseBuffer = []; // BH3: terminal discards buffered settle slices
			self._value.status = "completed";
			self._emitToSubs(["COMPLETE"], delivery);
			continue;
		}
		if (m[0] === "ERROR") {
			if (self._value.terminal !== undefined) continue;
			self._value.terminal = m[1];
			self._control.pauseBuffer = []; // BH3: terminal discards buffered settle slices
			self._value.status = "errored";
			self._emitToSubs(["ERROR", m[1]], delivery);
			continue;
		}
		if (m[0] === "TEARDOWN") {
			self._value.hasTorndown = true;
			if (self._slot.resetOnTeardown) {
				self._value.cache = SENTINEL;
				self._value.hasData = false;
			}
			self._emitToSubs(["TEARDOWN"], delivery);
		}
		// PAUSE / RESUME — control slice.
	}

	if (!self._wave.insideRunWave) self._wave.emittedDirtyThisWave = false;
}

export function nodeUp<T>(
	self: NodeRuntimeHost<T>,
	msgs: Wave,
	towardDep?: number,
	route?: UpRouteState,
): void {
	if (self._released) return;
	const routeState = route ?? { demandFired: new Map() };
	for (const m of msgs) {
		if (!isUpAllowed(m[0])) {
			throw new Error(
				`ctx.up: ${m[0]} is down-only (tier ${messageTier(m[0])}); up carries control tiers only (R-ctx-up)`,
			);
		}
	}
	for (const m of msgs) {
		if (m[0] === "PAUSE") {
			// PAUSE is NODE-TARGETED (R-up-routing): it ACQUIRES a lock, so there is no
			// pre-existing holder to route to — a controller targets the node directly.
			self._pauseAcquire(m[1]);
		} else if (m[0] === "RESUME") {
			// R-up-routing (D269): RESUME is pause-lock release only.
			if (self._control.pauseLockset.has(m[1])) {
				// a pause lock held HERE → release LOCALLY (normal pause/resume, R-pause-lockset).
				self._pauseRelease(m[1]);
			} else {
				// not held here → forward UP the declared cone to find the holder.
				self._forwardUp(m, towardDep, routeState);
			}
		} else if (m[0] === "PULL") {
			// R-up-routing / R-pull (D269/D272): DEMAND-IF-PULL-HOLDER-ELSE-FORWARD-UP.
			const demand = normalizePullDemand(m[1]);
			if (self._slot.pull && demand.pullId === self._slot.pullLock) {
				if (!self._markDemandRouted(demand.pullId, routeState)) self._onDemand(demand);
			} else {
				self._forwardUp(["PULL", demand], towardDep, routeState);
			}
		} else if (self._slot.deps.length === 0) {
			// R-up-at-source (D38): a depless source is the terminus of upstream control.
			// INVALIDATE → HONOR the invalidate-request. Routed through _down (NOT a direct
			// _invalidate call, QA A-2) so the invalidate-request respects batch-defer (D12)
			// and pause-buffer exactly like a downstream-originated INVALIDATE; _down's
			// INVALIDATE branch calls _invalidate() (clear cache → SENTINEL, fire onInvalidate,
			// broadcast downstream). Outside batch/pause it is identical to a direct call.
			// DIRTY / TEARDOWN → DROP (no coherent terminus action; self-dirty would wedge
			// downstream awaiting a settle that never comes; source lifecycle is source-owned).
			if (m[0] === "INVALIDATE") self._down([["INVALIDATE"]]);
		} else {
			// dep-bearing intermediate: forward DIRTY/INVALIDATE/TEARDOWN up toward deps.
			self._forwardUp(m, towardDep, routeState);
		}
	}
}

export function nodeMarkDemandRouted<T>(
	self: NodeRuntimeHost<T>,
	lockId: LockId,
	route: UpRouteState,
): boolean {
	let holders = route.demandFired.get(lockId);
	if (holders === undefined) {
		holders = new Set();
		route.demandFired.set(lockId, holders);
	}
	const node = self as unknown as Node<unknown>;
	if (holders.has(node)) return true;
	holders.add(node);
	return false;
}

export function nodeForwardUp<T>(
	self: NodeRuntimeHost<T>,
	m: Message,
	towardDep: number | undefined,
	route: UpRouteState,
): void {
	if (self._slot.deps.length === 0) return; // depless source terminus → drop
	if (towardDep !== undefined) {
		const d = self._slot.deps[towardDep];
		if (d !== undefined) nodeRuntimeHost(d)._up([m], undefined, route);
	} else {
		for (const dep of self._slot.deps) nodeRuntimeHost(dep)._up([m], undefined, route);
	}
}

export function nodeIsPaused<T>(self: NodeRuntimeHost<T>): boolean {
	return self._control.pauseLockset.size > 0;
}

export function nodeHasBoundaryPauseLock<T>(self: NodeRuntimeHost<T>): boolean {
	if (self._slot.pausable === false) return false;
	return self._control.pauseLockset.size > 0;
}

export function nodeIsAsyncPool<T>(self: NodeRuntimeHost<T>): boolean {
	return (
		self._slot.handle !== null &&
		self._slot.dispatcher.poolKind(self._slot.handle.poolId) === "async"
	);
}

export function nodePauseAcquire<T>(self: NodeRuntimeHost<T>, lockId: unknown): void {
	self._control.pauseLockset.add(lockId); // Set => same-id repeat PAUSE is idempotent
}

export function nodePauseRelease<T>(self: NodeRuntimeHost<T>, lockId: unknown): void {
	if (!self._control.pauseLockset.has(lockId)) return; // unknown id => no-op
	self._control.pauseLockset.delete(lockId);
	// R-pull (D59 / D272): releasing an EXTERNAL pause lock can unblock an owed demand.
	// Pull quiet is activePull-derived and never stored in pauseLockset.
	if (self._slot.pull && self._control.demandOwed !== undefined) self._fireOwedDemandIfReady();
	if (self._hasBoundaryPauseLock()) return; // another external lock still held => stay paused
	scheduleBoundaryDrain(self._core);
	if (self._slot.pull) return; // pull nodes stay quiet until PULL, even after external resume
	self._onResume();
}

export function nodeOnResume<T>(self: NodeRuntimeHost<T>): void {
	// BH3: a node that terminated while paused discards its buffer and never
	// replays/recomputes (terminal-is-forever).
	if (self._value.terminal !== undefined) {
		self._control.pauseBuffer = [];
		self._control.pausedDepWaveOccurred = false;
		self._control.demandOwed = undefined;
		self._control.activePull = undefined;
		self._control.pullDirtyOwed = false;
		return;
	}
	// Non-pull pause/resume (R-pause-modes): drain buffered settle slices (resumeAll /
	// async-at-paused, R-async-paused), then fire a coalesced dep-wave once (default mode).
	// A PULL node does not resume by draining here; its demand fires through _onDemand.
	if (self._control.pauseBuffer.length > 0) {
		const buf = self._control.pauseBuffer;
		self._control.pauseBuffer = [];
		for (const wave of buf) self._down(wave);
	}
	if (self._control.pausedDepWaveOccurred) {
		self._control.pausedDepWaveOccurred = false;
		self._tryRun();
	}
}

export function nodeCanFireDemand<T>(self: NodeRuntimeHost<T>): boolean {
	if (self._value.terminal !== undefined || self._wave.pending > 0) return false;
	return self._control.pauseLockset.size === 0;
}

export function nodeDeliverPullDemand<T>(self: NodeRuntimeHost<T>, demand: PullDemand): void {
	self._control.demandOwed = undefined;
	self._control.activePull = demand;
	self._control.inDeliverDemand = true;
	try {
		self._firePullDemand();
	} finally {
		self._control.activePull = undefined;
		self._control.inDeliverDemand = false;
	}
}

export function nodeOnDemand<T>(self: NodeRuntimeHost<T>, demand: PullDemand): void {
	if (self._control.inDeliverDemand) return; // re-entrant demand during an active delivery → drop (1:1)
	if (self._canFireDemand()) self._deliverPullDemand(demand);
	else self._control.demandOwed = demand; // latest owed params wins (D269/D272)
}

export function nodeFirePullDemand<T>(self: NodeRuntimeHost<T>): void {
	let drainedBuffer = false;
	if (self._control.pauseBuffer.length > 0) {
		const buf = self._control.pauseBuffer;
		self._control.pauseBuffer = [];
		for (const wave of buf) self._down(wave);
		drainedBuffer = true;
	}
	if (drainedBuffer) return;
	if (self._control.pausedDepWaveOccurred) {
		// QA-B2: only deliver if the fn can actually run this wave (settle-ready + first-run gate
		// open). A gated run emits no DATA, so emitting the leading DIRTY would STRAND downstream
		// — the exact wedge this feature exists to prevent (NoWedgeWhileQuiet). When gated, stay
		// SILENT and KEEP _pausedDepWaveOccurred so a later demand (once every dep has settled)
		// delivers. Mirrors _settleRewire's pre-_markDirty gate.
		const gated =
			self._slot.handle !== null &&
			!self._wave.hasCalledFnOnce &&
			!(self._slot.partial || self._allDepsSettled());
		if (self._wave.pending > 0 || gated) return;
		self._control.pausedDepWaveOccurred = false;
		self._wave.emittedDirtyThisWave = false;
		self._control.pullDirtyOwed = true;
		try {
			self._tryRun(); // fn DATA triggers DIRTY-before-DATA; no DATA means no output.
		} finally {
			self._control.pullDirtyOwed = false;
		}
		return;
	}
	if (self._slot.handle !== null) {
		if (!self._wave.hasCalledFnOnce && !(self._slot.partial || self._allDepsSettled())) return;
		self._wave.emittedDirtyThisWave = false;
		self._control.pullDirtyOwed = true;
		try {
			self._runWave();
		} finally {
			self._control.pullDirtyOwed = false;
		}
	}
}

export function nodeFireOwedDemandIfReady<T>(self: NodeRuntimeHost<T>): void {
	if (self._control.inDeliverDemand) return; // don't re-enter during an active delivery (1:1, QA guard)
	if (self._slot.pull && self._control.demandOwed !== undefined && self._canFireDemand()) {
		self._deliverPullDemand(self._control.demandOwed);
	}
}

export function nodeShouldBufferOnPause<T>(self: NodeRuntimeHost<T>): boolean {
	// D44: pausable mode is the OUTER gate over R-async-paused buffering.
	// false: ignore PAUSE/RESUME ENTIRELY — never buffer, keep producing (R-pause-modes; resolves B20).
	if (self._slot.pausable === false) return false;
	if (!self._isPaused() && !self._isPullQuiet()) return false;
	// resumeAll: production-gating — buffer the node's own (sync/async) settle slice too.
	if (self._slot.pausable === "resumeAll") return true;
	// true (default): PAUSE gates recomputation/propagation, NOT a leaf source's own production.
	// An async COMPUTE node's (deps>0) in-flight result buffers (R-async-paused / C-2); a depless
	// async leaf source's own production delivers immediately (R-pause-modes / C-10).
	if (!self._wave.insideRunWave && self._isAsyncPool() && self._slot.deps.length > 0) return true;
	return false;
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
	self._value.hasTorndown = false;
	self._wave.hasCalledFnOnce = false;
	self._resetDepState();
	self._control.pauseLockset.clear();
	self._control.pauseBuffer = [];
	self._control.pausedDepWaveOccurred = false;
	self._control.demandOwed = undefined; // R-pull (D269): drop any deferred demand
	self._control.activePull = undefined;
	self._control.pullDirtyOwed = false;
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
	deferRewire(self._core, fn, {
		batchToken,
		isReady: () => !self._hasBoundaryPauseLock(),
	});
}
