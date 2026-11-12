import type { DeliveryMeta } from "../ctx/types.js";
import type { Handle } from "../dispatcher/index.js";
import type { Message } from "../protocol/messages.js";
import { errorPayload, isTerminal, SENTINEL } from "../protocol/messages.js";
import { nodeDeferQuietOutput } from "./node-context-runtime.js";
import {
	isMarking,
	nodeMarkDependents,
	nodePublishTail,
	TAIL_DELIVERY,
	TAIL_MARK,
	takeTailCall,
} from "./node-output-runtime.js";
import type { NodeRuntimeHost } from "./node-runtime-host.js";
import { withRunningGraph } from "./runtime-accessors.js";

export function nodeRecordDepProjection<T>(
	self: NodeRuntimeHost<T>,
	idx: number,
	delivery: DeliveryMeta | undefined,
): unknown[] {
	const token = delivery?.wave ?? {};
	if (self._dep.waveTokens[idx] !== token) {
		self._dep.waveData[idx].push([]);
		// A snapshot (what a new dependent receives at subscription) is not a live wave.
		self._dep.waveLive[idx].push(delivery !== undefined && delivery.snapshot !== true);
		self._dep.waveTokens[idx] = token;
	}
	return self._dep.waveData[idx][self._dep.waveData[idx].length - 1];
}

export function nodeReceiveFromDep<T>(
	self: NodeRuntimeHost<T>,
	idx: number,
	msg: Message,
	delivery?: DeliveryMeta,
): void {
	// Q15: a call straight from a delivery or marking loop continues that loop instead of recursing.
	const tail = takeTailCall();
	if (self._released) return;
	const t = msg[0];
	if (t === "START") {
		// R-subscription: a new instance of this dependency (a replace) starts its record over.
		self._dep.waveData[idx] = [];
		self._dep.waveLive[idx] = [];
		self._dep.waveTokens[idx] = undefined;
		self._dep.batch[idx] = null;
		self._dep.prev[idx] = SENTINEL;
		self._dep.hasData[idx] = false;
		self._dep.terminal[idx] = undefined;
		self._dep.terminalInput[idx] = undefined;
		self._dep.invalidated[idx] = false;
		return;
	}
	// R-terminals: an ended node's function never runs again; its input is dropped.
	if (self._value.terminal !== undefined) return;
	const last = delivery?.last ?? true;

	if (t === "PENDING") {
		if (!self._dep.dirty[idx]) {
			self._dep.dirty[idx] = true;
			self._wave.pending++;
			self._dep.tier[idx] = 2;
			nodeMarkDirty(self, tail === TAIL_MARK);
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
	} else if (t === "RESOLVED") {
		self._recordDepProjection(idx, delivery);
		self._dep.tier[idx] = 3;
	} else if (t === "INVALIDATE") {
		// R-invalidation: what came before an INVALIDATE on this input is gone, and what comes
		// after it is ordinary input. What it does to this node is decided once the wave settles.
		self._dep.waveData[idx] = [];
		self._dep.waveLive[idx] = [];
		self._dep.waveTokens[idx] = undefined;
		self._dep.batch[idx] = null;
		self._dep.prev[idx] = SENTINEL;
		self._dep.hasData[idx] = false;
		self._dep.invalidated[idx] = true;
	} else if (isTerminal(t)) {
		// R-terminals: record the dependency's end; the policies are applied once the wave settles.
		const ended = t === "ERROR" ? (msg as readonly ["ERROR", unknown])[1] : true;
		self._dep.terminal[idx] = ended;
		self._dep.terminalInput[idx] = ended;
	} else return;
	// R-wave: DATA, RESOLVED, INVALIDATE and a terminal each settle this input's pending mark once.
	if (self._dep.dirty[idx]) {
		self._dep.dirty[idx] = false;
		self._wave.pending--;
	}
	// A delivery is all of a node's arrays for the wave; the node settles once, at its end.
	if (last) nodeMaybeRun(self, tail === TAIL_DELIVERY);
}

export function nodeMarkDirty<T>(self: NodeRuntimeHost<T>, tail = false): void {
	// R-wave: a quiet node consumes its input waves without being marked pending or sending
	// anything, so its dependents never wait for it and its status never turns "dirty"; what its
	// function sends goes out after the current wave as a new wave of its own (the quiet branch
	// of ctx.down). Its internal dep pending accounting (the PENDING-branch _pending++) still runs.
	if (self._slot.quiet) return;
	if (!self._wave.emittedDirtyThisWave) {
		self._wave.emittedDirtyThisWave = true;
		nodeMarkDependents(self, tail);
	}
}

export function nodeMaybeRun<T>(self: NodeRuntimeHost<T>, tail = false): void {
	// R-request-order: an added dep's snapshot lands here mid-rewire. Defer the fn-run until
	// every added dep is wired, so the function runs once on all the added snapshots as one
	// input wave, never on a partial view (multi-add) — _settleRewire drains this flag. R-lifetime: activation likewise runs the function once, on every
	// dependency's snapshot.
	if (self._wave.inDepMutation || self._wave.activating) {
		self._wave.rewireRunPending = true;
		return;
	}
	nodeTryRun(self, tail);
}

export function nodeSettleRewire<T>(self: NodeRuntimeHost<T>): void {
	if (self._wave.pending > 0) return;
	// R-request-order: the added dependencies' snapshots are one ordinary input wave.
	nodeSettle(self, false);
}

export function nodeTryRun<T>(self: NodeRuntimeHost<T>, tail = false): void {
	if (self._wave.pending > 0) return;
	nodeSettle(self, false, tail);
}

function nodeTerminalPolicy<T>(self: NodeRuntimeHost<T>, t: unknown): "auto" | "manual" {
	return t === true ? self._slot.completePolicy : self._slot.errorPolicy;
}

/**
 * Settle one wave at this node, once every pending input has settled (R-wave, R-terminals,
 * R-invalidation), in the reference kernel's order:
 * 1. auto ERROR: a dependency's ERROR ends the node without running its function; an
 *    INVALIDATE that reached it earlier in the wave takes effect first;
 * 2. auto INVALIDATE: an input's INVALIDATE invalidates the node without running its function;
 * 3. the function runs on what remains: values, a terminal under the manual policy, an
 *    INVALIDATE under the manual policy, a lifetime's first run (`force`, at activation), or, under auto COMPLETE, the last dependency's terminal even when it is the
 *    run's only input (graphrefly:D806 (1), R-terminals@1, C-17);
 * 4. auto COMPLETE: once every dependency has ended, COMPLETE follows the run's output;
 * 5. a node marked pending that sent nothing gets the kernel's one RESOLVED.
 * All of it goes out as one delivery, so a dependent settles once on it. `tail` (Q15): this settle
 * was reached straight from a delivery's last message, so its publication continues that loop.
 */
export function nodeSettle<T>(self: NodeRuntimeHost<T>, force: boolean, tail = false): void {
	if (self._value.terminal !== undefined || self._released) return;
	const wasDirty = self._wave.emittedDirtyThisWave;
	const n = self._slot.deps.length;
	const anyInvalidated = self._dep.invalidated.some((b) => b);

	if (self._slot.errorPolicy === "auto") {
		const at = self._dep.terminalInput.findIndex((t) => t !== undefined && t !== true);
		if (at >= 0) {
			const error = self._dep.terminalInput[at];
			nodeConsumeInput(self);
			const end: Message[][] = [];
			if (anyInvalidated && self._value.hasData) end.push([["INVALIDATE"]]);
			end.push([["ERROR", error]]);
			nodeSettleOutput(self, [], end, wasDirty, tail);
			return;
		}
	}

	const lead: Message[][] =
		anyInvalidated && self._slot.invalidatePolicy === "auto" && self._value.hasData
			? [[["INVALIDATE"]]]
			: [];

	let out: Message[][] = [];
	const allEnded = n > 0 && self._dep.terminal.every((t) => t !== undefined);
	if (self._slot.handle !== null) {
		// graphrefly-ts:D184 (the user's Q1): the kernel has no first-run gate; a function runs on
		// activation and on any input, and the value-level sugar keeps its own gate.
		const manualTerminal = self._dep.terminalInput.some(
			(t) => t !== undefined && nodeTerminalPolicy(self, t) === "manual",
		);
		const lastTerminal =
			self._slot.completePolicy === "auto" &&
			allEnded &&
			self._dep.terminalInput.some((t) => t !== undefined);
		const runs =
			force ||
			!self._lifetime.setupDone ||
			self._dep.waveData.some((w) => w.length > 0) ||
			manualTerminal ||
			lastTerminal ||
			(anyInvalidated && self._slot.invalidatePolicy === "manual");
		if (runs) out = nodeInvoke(self);
	}
	nodeConsumeInput(self);

	const endsItself = out.some((a) => a.some((m) => isTerminal(m[0])));
	if (self._slot.completePolicy === "auto" && allEnded && !endsItself) out.push([["COMPLETE"]]);
	nodeSettleOutput(self, lead, out, wasDirty, tail);
}

/** The input a settlement consumed. */
function nodeConsumeInput<T>(self: NodeRuntimeHost<T>): void {
	for (let i = 0; i < self._dep.batch.length; i++) {
		self._dep.batch[i] = null;
		self._dep.waveData[i] = [];
		self._dep.waveTokens[i] = undefined;
		self._dep.waveLive[i] = [];
		self._dep.terminalInput[i] = undefined;
		self._dep.invalidated[i] = false;
	}
}

/**
 * Send a settlement's arrays. A quiet node passes an auto INVALIDATE on now and sends the rest
 * after the wave as a new wave of its own; nothing waits for it, so it needs no RESOLVED.
 */
function nodeSettleOutput<T>(
	self: NodeRuntimeHost<T>,
	now: Message[][],
	rest: Message[][],
	wasDirty: boolean,
	tail: boolean,
): void {
	if (self._slot.quiet) {
		if (now.length > 0) {
			// Q15: in the delivery loop's tail, the loop sends `now` and then does the rest.
			if (tail && nodePublishTail(self, now, quietSettleTail, rest)) return;
			self._publish(now);
		}
		quietSettleTail(self, rest);
		return;
	}
	const out = [...now, ...rest];
	if (wasDirty && !out.some((a) => a.some(isMarking))) out.push([["RESOLVED"]]);
	if (out.length > 0) {
		if (tail && nodePublishTail(self, out, settleTail, undefined)) return;
		self._publish(out);
	}
	settleTail(self, undefined);
}

/** What a settle does after its publication's fanout (a function, so the loop can run it later). */
function settleTail(self: NodeRuntimeHost<unknown>, _rest?: Message[][]): void {
	self._wave.emittedDirtyThisWave = false;
}

/** A quiet node's settle after its INVALIDATE's fanout: the rest is a wave of its own, later. */
function quietSettleTail(self: NodeRuntimeHost<unknown>, rest: Message[][] | undefined): void {
	if (rest !== undefined && rest.length > 0) nodeDeferQuietOutput(self, rest);
}

/** One run of the node's function; returns the arrays it sent (R-invocation, R-failure). */
function nodeInvoke<T>(self: NodeRuntimeHost<T>): Message[][] {
	// R-invocation@2: a running function is never reentered. Every way back into this node during
	// its run (a host input, a late ctx.down, a subscribe) is a request that waits for the wave.
	const ctx = self._buildCtx();
	// R-subscription@3: only the seeded instance's first run receives the seed's note.
	(ctx as { seed: unknown }).seed = self._seedNote;
	self._seedNote = undefined;
	// R-lifetime: the setup runs once per lifetime, just before the function's first run in it,
	// with that run's ctx; what it sends is that run's output and a throw in it is the node's ERROR.
	const lifetime = self._lifetime;
	const setup = lifetime.setupDone ? undefined : self._slot.setup;
	lifetime.setupDone = true;
	self._wave.emittedSettleThisWave = false;
	self._wave.runOutput = [];
	self._wave.insideRunWave = true;
	let thrown: { readonly error: unknown } | undefined;
	try {
		withRunningGraph(self._core, self._slot.environment, self._slot.dispatcher, () => {
			if (setup !== undefined) {
				const cleanup = setup(ctx);
				if (typeof cleanup === "function") lifetime.cleanup = cleanup;
			}
			self._slot.dispatcher.invoke(self._slot.handle as Handle, ctx);
		});
	} catch (error) {
		thrown = { error };
	} finally {
		self._wave.insideRunWave = false;
	}
	const out: Message[][] = self._wave.runOutput.map((a) => [...a]);
	self._wave.runOutput = [];
	// R-failure: a throw from the function (including an output ctx.down rejected) is this node's
	// ERROR; what it sent before the throw is dropped.
	if (thrown !== undefined)
		return [
			[["ERROR", errorPayload(thrown.error, "node function threw without a valid error payload")]],
		];
	return out;
}
