import type { DeliveryMeta } from "../ctx/types.js";
import type { Handle } from "../dispatcher/index.js";
import type { Message } from "../protocol/messages.js";
import { isTerminal, SENTINEL } from "../protocol/messages.js";
import type { NodeRuntimeHost } from "./node-runtime-host.js";

export function nodeRecordDepProjection<T>(
	self: NodeRuntimeHost<T>,
	idx: number,
	delivery: DeliveryMeta | undefined,
): unknown[] {
	const token = delivery?.wave ?? {};
	if (self._dep.waveTokens[idx] !== token) {
		self._dep.waveData[idx].push([]);
		self._dep.waveTokens[idx] = token;
	}
	return self._dep.waveData[idx][self._dep.waveData[idx].length - 1];
}

export function nodeDepProjectionHasData<T>(self: NodeRuntimeHost<T>, idx: number): boolean {
	const projection = self._dep.waveData[idx][self._dep.waveData[idx].length - 1];
	return projection?.some((v) => v !== SENTINEL) ?? false;
}

export function nodeReceiveFromDep<T>(
	self: NodeRuntimeHost<T>,
	idx: number,
	msg: Message,
	delivery?: DeliveryMeta,
): void {
	if (self._released) return;
	const t = msg[0];
	if (t === "START") return;
	const isLastInDeliveredWave = delivery?.last ?? true;
	// Terminal-is-forever, except terminal intermediates still relay upstream TEARDOWN
	// downstream for lifecycle unwire (R-teardown-terminal-relay / D65).
	if (self._value.terminal !== undefined) {
		if (t === "TEARDOWN") self._down([["TEARDOWN"]]);
		return;
	}

	if (t === "INVALIDATE") {
		const projection = self._recordDepProjection(idx, delivery);
		projection.push(SENTINEL);
		if (projection.some((v) => v !== SENTINEL) && isLastInDeliveredWave) self._maybeRun();
		// The dep's value is gone — drop our cached latest view to SENTINEL so the
		// never-emitted detector reads correctly, C-3) and cascade (idempotent).
		self._dep.prev[idx] = SENTINEL;
		self._dep.hasData[idx] = false;
		self._dep.batch[idx] = null;
		// EC3: un-wedge the dirty bookkeeping if this dep had gone DIRTY first, so an
		// INVALIDATE-before-DATA doesn't strand _pending / downstream forever
		// (R-invalidate-idempotent — exists to prevent the wedged-DIRTY deadlock).
		if (self._dep.dirty[idx]) {
			self._dep.dirty[idx] = false;
			self._wave.pending--;
		}
		// D50 / R-paused-invalidate: this INVALIDATE SUPERSEDES the dep's buffered
		// paused dep-wave (_depBatch[idx] just cleared). Re-derive the paused-recompute
		// flag — if no dep still carries a buffered DATA, CANCEL the paused recompute
		// (attributed cancellation; the node has settled to SENTINEL via its own
		// INVALIDATE, so a RESUME must not recompute against a now-SENTINEL dep). A
		// surviving dep keeps it set; a later DATA re-arms it ([DATA,INVALIDATE,DATA2]).
		if (self._control.pausedDepWaveOccurred && self._dep.batch.every((b) => b === null)) {
			self._control.pausedDepWaveOccurred = false;
		}
		const hadData = self._value.hasData;
		self._invalidate(); // cascades INVALIDATE iff populated; no-op otherwise
		// If we broadcast DIRTY this wave but _invalidate produced no settle (the node
		// was never populated, so the cascade is suppressed per the rule), un-dirty
		// downstream with a RESOLVED once all deps have settled.
		if (self._wave.pending === 0 && self._wave.emittedDirtyThisWave) {
			if (!hadData) self._down([["RESOLVED"]]);
			else self._wave.emittedDirtyThisWave = false;
		}
		self._fireOwedDemandIfReady(); // R-pull (D59/B1/F6): an INVALIDATE settle can drain _pending → fire a deferred demand
		return;
	}

	if (isTerminal(t)) {
		// Tier 5 (R-tier / D34): COMPLETE | ERROR — ONE branch routed by the CENTRAL tier table,
		// not a per-variant string check (feedback_use_tier_for_signal_routing). The shared terminal
		// bookkeeping (record the terminal + release the in-wave DIRTY) runs for ANY tier-5 message;
		// only the COMPLETE-vs-ERROR cascade differs, so discriminate by the type within the tier.
		const isError = t === "ERROR";
		const errPayload = isError ? (msg as readonly ["ERROR", unknown])[1] : undefined;
		self._dep.terminal[idx] = isError ? errPayload : true;
		self._dep.terminalInput[idx] = isError ? errPayload : true;
		// R-terminal-settles-dirty (B35): a terminal RELEASES this dep's outstanding in-wave DIRTY
		// contribution (the exactly-one-settle invariant) — exactly as DATA/RESOLVED/INVALIDATE do
		// (a dirty-then-terminal-without-DATA dep would otherwise strand _pending and wedge the node,
		// the deadlock R-invalidate-idempotent prevents for INVALIDATE).
		self._releaseDepDirty(idx);
		const ranValueBeforeTerminal = self._depProjectionHasData(idx) && isLastInDeliveredWave;
		if (ranValueBeforeTerminal) self._maybeRun();
		if (isError && self._slot.errorWhenDepsError) {
			self._down([["ERROR", errPayload]]); // auto-cascade ERROR → node itself terminal
		} else if (self._slot.terminalAsRealInput) {
			if (ranValueBeforeTerminal) {
				self._fireOwedDemandIfReady();
				return;
			}
			self._maybeRun(); // rescue/reduce/catch/*Map: the fn reads depTerminal(ctx, idx)
		} else if (self._slot.completeWhenDepsComplete && self._allDepsTerminal()) {
			// R-deps-terminal auto-COMPLETE + B42: COMPLETE once ALL deps are TERMINAL (each COMPLETE
			// or an absorbed ERROR) — so an absorbed-error dep terminating LAST still fires the
			// cascade. terminalAsRealInput is checked FIRST so a rescue recovers via _maybeRun rather
			// than being preempted (no operator sets both completeWhenDepsComplete:true + tari:true).
			self._down([["COMPLETE"]]);
		} else {
			// absorbed terminal, NOT an input + not auto-completing: the dep's signalled change did
			// not materialise (no DATA) → un-dirty downstream, keep cache (R-resolved-undirty balance).
			self._settleAfterAbsorbedTerminal();
		}
		self._fireOwedDemandIfReady(); // R-pull (D59/B1/F6): a dep terminal can drain _pending → fire a deferred demand (no-op if this node went terminal)
		return;
	}

	if (t === "TEARDOWN") {
		self._down([["TEARDOWN"]]);
		return;
	}

	if (t === "DIRTY") {
		if (!self._dep.dirty[idx]) {
			self._dep.dirty[idx] = true;
			self._wave.pending++;
			self._dep.tier[idx] = 2;
			self._markDirty();
		}
		return;
	}

	if (t === "DATA") {
		const v = msg[1];
		self._recordDepProjection(idx, delivery).push(v);
		const b = self._dep.batch[idx];
		if (b === null) self._dep.batch[idx] = [v];
		else b.push(v);
		self._dep.prev[idx] = v;
		self._dep.hasData[idx] = true;
		self._dep.tier[idx] = 3;
		if (self._dep.dirty[idx]) {
			self._dep.dirty[idx] = false;
			self._wave.pending--;
		}
		if (isLastInDeliveredWave) self._maybeRun();
		self._fireOwedDemandIfReady(); // R-pull pin 5: settle-ready now → fire a deferred demand
		return;
	}

	if (t === "RESOLVED") {
		self._recordDepProjection(idx, delivery);
		self._dep.tier[idx] = 3;
		if (self._dep.dirty[idx]) {
			self._dep.dirty[idx] = false;
			self._wave.pending--;
		}
		if (isLastInDeliveredWave) self._maybeRun();
		self._fireOwedDemandIfReady(); // R-pull pin 5: settle-ready now → fire a deferred demand
		return;
	}
	// PAUSE / RESUME are not delivered downstream to a dep-subscriber; a node is
	// paused via its own up() (lockset), not by an upstream dep.
}

export function nodeReleaseDepDirty<T>(self: NodeRuntimeHost<T>, idx: number): void {
	if (self._dep.dirty[idx]) {
		self._dep.dirty[idx] = false;
		self._wave.pending--;
	}
}

export function nodeSettleAfterAbsorbedTerminal<T>(self: NodeRuntimeHost<T>): void {
	if (self._wave.pending !== 0 || !self._wave.emittedDirtyThisWave) return;
	// A real value occurred this wave (some OTHER dep delivered DATA) → recompute. _maybeRun
	// runs the fn ONLY if it's not gated (first-run gate open, not paused); it may emit DATA, a
	// fn-synthesized undirty RESOLVED, or nothing (gated / gate still holds).
	const sawData = self._dep.batch.some((b) => b !== null && b.length > 0);
	if (sawData) self._maybeRun();
	// If after that the node STILL owes a downstream settle (no DATA occurred, OR the recompute
	// was gated — e.g. the first-run gate holds because the terminated dep never delivered and
	// terminalAsRealInput is false), balance the broadcast DIRTY with one undirty RESOLVED
	// (R-resolved-undirty), keeping the cache (a terminal, unlike INVALIDATE, leaves the value).
	// Without this fallback a DIRTY-then-terminal-without-DATA dep on a pre-first-run multi-dep
	// node would strand the DIRTY → downstream wedged (the B35 class, in the gate-holds corner).
	if (self._wave.emittedDirtyThisWave) self._down([["RESOLVED"]]);
}

export function nodeMarkDirty<T>(self: NodeRuntimeHost<T>): void {
	self._value.status = "dirty";
	// SPIKE (protocol-pull): while quiet, ABSORB the upstream DIRTY — do NOT relay it downstream.
	// This is the P0b wedge fix: a quiet pull node that relayed DIRTY but withheld the settle
	// (coalesced by pause) wedged every downstream's two-phase _pending. The downstream learns of
	// changes via the push STREAM port, not the silent snapshot port; on demand the pull node
	// emits a fresh wave. Internal dep dirty-accounting (the DIRTY-branch _pending++) is untouched.
	if (self._isPullQuiet()) return;
	if (!self._wave.emittedDirtyThisWave) {
		self._wave.emittedDirtyThisWave = true;
		self._emitToSubs(["DIRTY"]);
	}
}

export function nodeMaybeRun<T>(self: NodeRuntimeHost<T>): void {
	// R-rewire: an added cached dep's push-on-subscribe lands here mid-mutation. Defer
	// the fn-run to ONE atomic two-phase settle after every added dep is wired, so the
	// fn never fires on a partially-populated added-dep view (multi-add) — _settleRewire
	// drains this flag.
	if (self._wave.inDepMutation) {
		self._wave.rewireRunPending = true;
		return;
	}
	// R-pause-modes + R-pull: while externally paused or pull-quiet, default pull mode
	// coalesces. `resumeAll` still runs so its outgoing settle slice can enter pauseBuffer.
	if (self._slot.pausable === true && (self._isPaused() || self._isPullQuiet())) {
		self._control.pausedDepWaveOccurred = true;
		return;
	}
	self._tryRun();
}

export function nodeSettleRewire<T>(self: NodeRuntimeHost<T>): void {
	if (self._slot.pausable === true && self._isPaused()) {
		self._control.pausedDepWaveOccurred = true;
		return;
	}
	if (self._wave.pending > 0) return;
	if (self._slot.handle === null) {
		self._passthroughEmit();
		return;
	}
	if (!self._wave.hasCalledFnOnce && !(self._slot.partial || self._allDepsSettled())) return;
	self._markDirty(); // phase 1 (no-op if already dirty, e.g. unsubscribeDep auto-settle)
	self._runWave(); // phase 2: fn → DATA/RESOLVED
}

export function nodeTryRun<T>(self: NodeRuntimeHost<T>): void {
	if (self._wave.pending > 0) return;
	if (self._slot.handle === null) {
		// Passthrough wire (deps, no fn): forward the latest dep DATA downstream.
		self._passthroughEmit();
		return;
	}
	if (!self._wave.hasCalledFnOnce) {
		if (self._slot.partial || self._allDepsSettled()) self._runWave();
		// else: first-run gate holds fn until every dep has settled (R-first-run-gate).
		return;
	}
	self._runWave();
}

export function nodeAllDepsSettled<T>(self: NodeRuntimeHost<T>): boolean {
	for (let i = 0; i < self._slot.deps.length; i++) {
		if (self._dep.hasData[i]) continue;
		if (self._slot.terminalAsRealInput && self._dep.terminal[i] !== undefined) continue;
		return false;
	}
	return true;
}

export function nodePassthroughEmit<T>(self: NodeRuntimeHost<T>): void {
	// Single-dep wire: relay dep 0's latest batch value as DATA.
	const b = self._dep.batch[0];
	if (b !== null && b.length > 0) {
		self._down([["DATA", b[b.length - 1]]]);
	} else if (self._wave.emittedDirtyThisWave) {
		// R-resolved-undirty (D49): the dep settled via an undirty RESOLVED (no DATA in the
		// batch), but this wire already broadcast DIRTY downstream this wave — balance it with
		// a RESOLVED so downstream un-dirties instead of wedging. Routed through _down (NOT a
		// bare _emitToSubs) so the balance respects batch-defer (D12) + pause-buffer, matching
		// the zero-dep un-dirty path. Without this, a passthrough over a filter-reject /
		// distinctUntilChanged-dup leaves a dangling DIRTY (the wedge D49 made common).
		self._down([["RESOLVED"]]);
	}
	self._dep.batch[0] = null;
	self._wave.emittedDirtyThisWave = false;
}

export function nodeRunWave<T>(self: NodeRuntimeHost<T>): void {
	// R-reentrancy (D37): a fn that re-drives its own dep mid-wave re-enters here while
	// _insideRunWave is still set — a synchronous feedback cycle. Reject (throw); the graph
	// layer catches it and converts to [[ERROR, e]] (D30). The try/finally resets the flag
	// on every frame as the throw unwinds, leaving the graph clean for the catch. Detection
	// is node-local and free — it reuses the existing _insideRunWave flag (no new structure,
	// dispatcher stays a pure funnel).
	if (self._wave.insideRunWave)
		throw new Error(
			"synchronous feedback cycle: node fn re-entered its own wave (R-reentrancy / D37)",
		);
	self._wave.hasCalledFnOnce = true;
	// R-cleanup-hooks per-run lifecycle (D28 clarification): clear BOTH hook lists
	// before the fn runs; the fn body re-registers the current run's hooks. Only the
	// latest run's registrations are live — a re-run supersedes the prior run's hooks,
	// discarded WITHOUT firing (no fire-on-rerun; onRerun stays cut). Fixes the push-only
	// accumulation (K stale hooks fired after K runs). C-14.
	self._hooks.onInvalidate = [];
	self._hooks.onDeactivation = [];
	const ctx = self._buildCtx();
	const wasDirty = self._wave.emittedDirtyThisWave;
	self._wave.emittedSettleThisWave = false;
	self._wave.insideRunWave = true;
	try {
		self._slot.dispatcher.invoke(self._slot.handle as Handle, ctx);
	} finally {
		self._wave.insideRunWave = false;
	}

	// R-resolved-undirty (D49): a SYNC fn DIRTY'd in phase 1 that produced NO tier-3 value
	// this wave (filter-reject / distinctUntilChanged-dup / any no-emit fn) gets a substrate-
	// SYNTHESIZED undirty RESOLVED to clear the downstream dirty — operator bodies stay
	// protocol-clean (R-primary-api-clean). Status reflects cache freshness: a carried value
	// -> resolved, never-valued -> sentinel. EXEMPT: terminal/INVALIDATE waves (they set
	// _emittedSettleThisWave and balance their own dirty), and ASYNC-pool nodes — an async fn
	// that returns without emitting has DEFERRED its result (it emits later via the stashed
	// ctx), NOT rejected; synthesizing here would prematurely settle a still-pending diamond
	// leg (R-async-paused / C-4). The eventual async ctx.down carries its own DIRTY balance.
	if (
		wasDirty &&
		!self._wave.emittedSettleThisWave &&
		self._value.terminal === undefined &&
		!self._isAsyncPool()
	) {
		self._down([["RESOLVED"]]);
	}

	// roll wave-local state forward
	for (let i = 0; i < self._dep.batch.length; i++) {
		self._dep.batch[i] = null;
		self._dep.waveData[i] = [];
		self._dep.waveTokens[i] = undefined;
		self._dep.terminalInput[i] = undefined;
	}
	self._wave.emittedDirtyThisWave = false;
}
