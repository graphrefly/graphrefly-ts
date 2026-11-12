import { reportFailure } from "../batch/boundary.js";
import { strictCanonicalJsonBytes } from "../json/codec.js";
import { errorPayload, isTerminal, SENTINEL } from "../protocol/messages.js";
import { makeDepBookkeeping } from "./core.js";
import type { Node } from "./node.js";
import { type NodeRuntimeHost, nodeRuntimeHost } from "./node-runtime-host.js";
import type { RuntimeReleaseFailure } from "./owned-acquisition.js";
import {
	closeNodeRegistration,
	notifyTopologyDepsChanged,
	setRuntimeReleaseFailures,
	withRunningGraph,
} from "./runtime-accessors.js";
import type { NodeReceived, Status } from "./types.js";

export function nodeActivate<T>(self: NodeRuntimeHost<T>): void {
	self._lifecycle.activated = true;
	const seed = self._seed;
	self._seed = undefined;
	self._dep.unsubs = new Array(self._slot.deps.length);
	self._dep.idxBoxes = new Array(self._slot.deps.length);
	// R-checkpoint: a restored node's first activation compares what it had received from each
	// dependency with what the dependency holds now; only a changed dependency gives input.
	const restored = { changed: false };
	// R-lifetime: activation acquires every dependency, then runs the function once on their
	// snapshots (and whatever they sent as they activated).
	self._wave.activating = true;
	try {
		self._slot.deps.forEach((dep, i) => {
			self._subscribeDepAt(
				dep,
				seed === undefined
					? undefined
					: { received: seed.received[i], onChange: () => (restored.changed = true) },
			);
		});
	} finally {
		self._wave.activating = false;
	}
	const deferred = self._wave.rewireRunPending;
	self._wave.rewireRunPending = false;
	if (self._slot.handle === null && self._slot.deps.length === 0) return; // a state node has no function
	if (self._wave.pending > 0) return; // a dependency is mid-wave; the run waits for it
	if (seed !== undefined) {
		// R-checkpoint: the function runs once if a dependency changed, with only the changed ones as
		// input, and otherwise does not run; the setup runs either way, as at every activation.
		if (restored.changed || deferred) self._runWave();
		else nodeRunSetup(self);
		return;
	}
	self._runWave();
}

/**
 * R-lifetime: run the lifetime's setup without a run of the function (a restored first activation
 * with nothing changed). What it sends goes out as the node's output; a throw is its ERROR.
 */
function nodeRunSetup<T>(self: NodeRuntimeHost<T>): void {
	const setup = self._slot.setup;
	const lifetime = self._lifetime;
	if (setup === undefined || lifetime.setupDone || self._value.terminal !== undefined) return;
	lifetime.setupDone = true;
	const ctx = self._buildCtx();
	try {
		const cleanup = withRunningGraph(
			self._core,
			self._slot.environment,
			self._slot.dispatcher,
			() => setup(ctx),
		);
		if (typeof cleanup === "function") lifetime.cleanup = cleanup;
	} catch (error) {
		ctx.down([["ERROR", errorPayload(error, "node setup threw without a valid error payload")]]);
	}
}

/** Whether a dependency still holds what a restored node had received from it (R-checkpoint). */
function sameAsReceived(
	received: NodeReceived,
	values: readonly unknown[],
	terminal: unknown,
): { values: boolean; terminal: boolean } {
	const same = (a: unknown, b: unknown): boolean => {
		if (a === b) return true;
		try {
			return (
				new TextDecoder().decode(strictCanonicalJsonBytes(a)) ===
				new TextDecoder().decode(strictCanonicalJsonBytes(b))
			);
		} catch {
			return false;
		}
	};
	return {
		values: same([...received.values], [...values]),
		terminal: same(received.terminal ?? null, terminal ?? null),
	};
}

export function nodeSubscribeDepAt<T>(
	self: NodeRuntimeHost<T>,
	depNode: Node<unknown>,
	seed?: { readonly received: NodeReceived | undefined; readonly onChange: () => void },
): void {
	const idx0 = self._slot.deps.indexOf(depNode);
	const box = { v: idx0 };
	// R-checkpoint: a restored node decides at the dependency's snapshot, once the dependency has
	// activated: unchanged, the snapshot is dropped and the node holds what it had received; a
	// changed value gives the snapshot as input; an end alone gives only the terminal.
	let decision: "drop" | "terminal" | "pass" | undefined = seed === undefined ? "pass" : undefined;
	const decide = (): void => {
		const dep = nodeRuntimeHost(depNode);
		const received = seed?.received;
		const same =
			received === undefined
				? { values: false, terminal: false }
				: sameAsReceived(received, dep._value.lastArray, dep._value.terminal);
		decision = same.values ? (same.terminal ? "drop" : "terminal") : "pass";
		if (decision !== "pass" && idx0 !== -1) {
			self._seedRestoredDepAt(idx0, depNode);
			if (decision === "terminal") self._dep.terminal[idx0] = undefined;
		}
		if (decision !== "drop") seed?.onChange();
	};
	const dependent: import("../ctx/types.js").DependentSink = (msg, delivery) => {
		if (decision === undefined) {
			if (delivery?.snapshot === true) decide();
			else decision = "pass";
		}
		if (delivery?.snapshot === true) {
			if (decision === "drop") return;
			if (decision === "terminal" && !isTerminal(msg[0])) return;
		}
		if (box.v === -1) return; // dep removed — stale callback, drop (drain)
		self._receiveFromDep(box.v, msg, delivery);
	};
	nodeRuntimeHost(depNode)._subscribeOwned(
		{ kind: "dependent", fn: dependent },
		{
			record: (release) => {
				if (idx0 !== -1) {
					self._dep.unsubs[idx0] = release;
					self._dep.idxBoxes[idx0] = box;
				}
			},
		},
	);
	if (decision === undefined && box.v !== -1) decide();
}

export function nodeSeedRestoredDepAt<T>(
	self: NodeRuntimeHost<T>,
	idx: number,
	depNode: Node<unknown>,
): void {
	const dep = nodeRuntimeHost(depNode);
	const seedData = dep._value.hasData;
	self._dep.batch[idx] = null;
	self._dep.waveData[idx] = [];
	self._dep.waveTokens[idx] = undefined;
	self._dep.waveLive[idx] = [];
	self._dep.prev[idx] = seedData ? dep._value.cache : SENTINEL;
	self._dep.hasData[idx] = seedData;
	self._dep.dirty[idx] = false;
	self._dep.tier[idx] = seedData ? 3 : 0;
	self._dep.terminal[idx] = dep._value.terminal;
	self._dep.terminalInput[idx] = undefined;
	self._dep.invalidated[idx] = false;
}

/**
 * R-lifetime@2: closing a lifetime aborts its signal, releases its dependencies, runs its cleanup
 * (which may still read the private state), and then drops the private state. `onError` collects
 * failures instead of throwing (graph release).
 */
export function nodeCloseLifetime<T>(
	self: NodeRuntimeHost<T>,
	onError?: (error: unknown, resource: "subscription" | "deactivation") => void,
): void {
	const lifetime = self._lifetime;
	const controller = lifetime.controller;
	const cleanup = lifetime.cleanup;
	lifetime.controller = null;
	lifetime.cleanup = undefined;
	lifetime.setupDone = false;
	self._syncCtx = null;
	const run = (fn: () => void, resource: "subscription" | "deactivation"): void => {
		if (onError === undefined) {
			fn();
			return;
		}
		try {
			fn();
		} catch (error) {
			onError(error, resource);
		}
	};
	if (controller !== null) run(() => controller.abort(), "deactivation");
	const unsubs = self._dep.unsubs;
	self._dep.unsubs = [];
	self._dep.idxBoxes = [];
	for (const u of unsubs) if (u) run(u, "subscription");
	// R-lifetime: a ctx.rewire belongs to its lifetime; closing puts the declared dependencies back.
	if (!self._released && self._slot.deps !== self._slot.declaredDeps) {
		const prev = self._slot.deps;
		self._slot.deps = self._slot.declaredDeps;
		Object.assign(self._dep, makeDepBookkeeping(self._slot.deps.length));
		notifyTopologyDepsChanged(self as unknown as Node<unknown>, prev, self._slot.deps);
	}
	lifetime.closing = true;
	lifetime.closingSignal = controller?.signal ?? null;
	if (cleanup !== undefined) {
		if (onError !== undefined) run(cleanup, "deactivation");
		else {
			// R-failure: a cleanup that throws has no node to end; its failure goes to the graph's
			// host reporter and the close completes.
			try {
				cleanup();
			} catch (error) {
				reportFailure(self._core, `cleanup of ${self._slot.name ?? "node"}`, error);
			}
		}
	}
	lifetime.closing = false;
	lifetime.closingSignal = null;
	self._privateState.value = SENTINEL;
}

/** R-node@2: a node's status, derived from what it holds. */
export function nodeStatus<T>(self: NodeRuntimeHost<T>): Status {
	const terminal = self._value.terminal;
	return {
		cache: !self._value.hasData
			? "empty"
			: self._wave.emittedDirtyThisWave || self._wave.pending > 0
				? "stale"
				: "ready",
		output: terminal === undefined ? "open" : terminal === true ? "completed" : "errored",
		lifecycle: self._lifetime.closing
			? "closing"
			: self._lifecycle.activated
				? "active"
				: "inactive",
	};
}

export function nodeDeactivate<T>(self: NodeRuntimeHost<T>): void {
	self._lifecycle.activated = false;
	nodeCloseLifetime(self);

	// R-lifetime: deactivation drops a computed node's retained values unless it has ended.
	const isCompute = self._slot.handle !== null || self._slot.deps.length > 0;
	if (isCompute && self._value.terminal === undefined) {
		// RAM: compute nodes clear cache; reconnect re-runs fn fresh.
		self._value.cache = SENTINEL;
		self._value.hasData = false;
		self._value.lastArray = [];
	}
	self._resetDepState();
}

export function nodeSubscriberCount<T>(self: NodeRuntimeHost<T>): number {
	return self._lifecycle.subscribers.size;
}

export function nodeIsRuntimeQuiescentForRelease<T>(self: NodeRuntimeHost<T>): boolean {
	return (
		!self._released &&
		!self._wave.emittedDirtyThisWave &&
		self._wave.pending === 0 &&
		!self._wave.insideRunWave &&
		!self._wave.inDepMutation &&
		!self._wave.rewireRunPending &&
		self._dep.dirty.every((dirty) => !dirty)
	);
}

export function nodeReleaseRuntime<T>(self: NodeRuntimeHost<T>): void {
	if (self._released) return;
	self._released = true;
	const node = self as unknown as Node<unknown>;
	const releaseErrors: RuntimeReleaseFailure[] = [];
	const recordReleaseError = (
		error: unknown,
		resource: RuntimeReleaseFailure["resource"],
		handle?: import("../dispatcher/index.js").Handle,
	): void => {
		releaseErrors.push({
			cause: error,
			resource,
			...(handle === undefined ? {} : { handle, dispatcher: self._slot.dispatcher }),
		});
	};
	self._lifecycle.activated = false;
	// D124 release is graph-owned and atomic: subscription and cleanup failures are collected, not
	// thrown mid-release, and no protocol ERROR/COMPLETE is synthesized.
	nodeCloseLifetime(self, (error, resource) => recordReleaseError(error, resource));
	self._lifecycle.subscribers.clear();
	if (self._slot.handle !== null) {
		const handle = self._slot.handle;
		try {
			self._slot.dispatcher.unregister(handle);
			self._slot.handle = null;
		} catch (error) {
			recordReleaseError(error, "handle", handle);
		}
	}
	self._slot.deps = [];
	self._dep.batch = [];
	self._dep.waveData = [];
	self._dep.waveTokens = [];
	self._dep.waveLive = [];
	self._dep.prev = [];
	self._dep.hasData = [];
	self._dep.dirty = [];
	self._dep.tier = [];
	self._dep.terminal = [];
	self._dep.terminalInput = [];
	self._value.cache = SENTINEL;
	self._value.hasData = false;
	self._value.terminal = undefined;
	self._value.lastArray = [];
	self._privateState.value = SENTINEL;
	self._syncCtx = null;
	self._resetDepState();
	self._seed = undefined;
	closeNodeRegistration(node);
	try {
		self._core.releaseSlot(self._id);
	} catch (cause) {
		releaseErrors.push({ resource: "slot", cause, core: self._core, slot: self._id });
	}
	if (releaseErrors.length > 0) {
		setRuntimeReleaseFailures(node, Object.freeze(releaseErrors));
		throw releaseErrors[0]!.cause;
	}
}

export function nodeResetDepState<T>(self: NodeRuntimeHost<T>): void {
	const n = self._slot.deps.length;
	for (let i = 0; i < n; i++) {
		self._dep.batch[i] = null;
		self._dep.waveData[i] = [];
		self._dep.waveTokens[i] = undefined;
		self._dep.waveLive[i] = [];
		self._dep.prev[i] = SENTINEL;
		self._dep.hasData[i] = false;
		self._dep.dirty[i] = false;
		self._dep.tier[i] = 0;
		self._dep.terminal[i] = undefined;
		self._dep.terminalInput[i] = undefined;
		self._dep.invalidated[i] = false;
	}
	self._wave.pending = 0;
	self._wave.emittedDirtyThisWave = false;
}
