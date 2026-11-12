import { enterWave, exitWave, reportFailure } from "../batch/boundary.js";
import { strictCanonicalJsonBytes } from "../json/codec.js";
import { errorPayload, isTerminal, type Message, SENTINEL } from "../protocol/messages.js";
import { makeDepBookkeeping, type Subscriber } from "./core.js";
import type { Node } from "./node.js";
import { nodeCallSink } from "./node-output-runtime.js";
import { type NodeRuntimeHost, nodeRuntimeHost } from "./node-runtime-host.js";
import type { RuntimeReleaseFailure, SubscriptionAcquisition } from "./owned-acquisition.js";
import {
	closeNodeRegistration,
	notifyTopologyDepsChanged,
	setRuntimeReleaseFailures,
	withRunningGraph,
} from "./runtime-accessors.js";
import type { NodeReceived, NodeSeed, Status } from "./types.js";

/**
 * graphrefly-ts Q15: activation runs on an explicit stack of frames, not JS recursion, so a chain
 * of any depth activates. A frame is one subscription to one node (Node._subscribeOwned): it
 * activates the node if needed, acquiring each dependency as a child frame on top of it, runs the
 * node's first run once every dependency is acquired, and then attaches the subscriber with START
 * and the snapshot. The order and the cleanup on a throw are those of the recursive calls.
 */
const ACT_INIT = 0;
/** Acquiring the dependencies (R-lifetime: `activating`). */
const ACT_DEPS = 1;
/** Activation's first run (or setup), after the dependencies. */
const ACT_RUN = 2;
/** Attaching the subscriber: START and the snapshot. */
const ACT_ATTACH = 3;
const ACT_DONE = 4;

interface Activation {
	readonly self: NodeRuntimeHost<unknown>;
	/** undefined: activation only (nodeActivate), no subscription. */
	readonly subscriber: Subscriber | undefined;
	readonly acquisition: SubscriptionAcquisition | undefined;
	phase: number;
	/** The subscription's wave boundary is open (enterWave without its exitWave yet). */
	entered: boolean;
	/** The snapshot is being handed to a dependent subscriber. */
	handshake: boolean;
	unsubscribe: (() => void) | undefined;
	deps: readonly Node<unknown>[];
	len: number;
	i: number;
	seed: NodeSeed | undefined;
	restored: { changed: boolean } | undefined;
	/** The dependency link whose child frame is on top of this one. */
	link: DepLink | undefined;
}

const activations: Activation[] = [];

function newActivation(
	self: NodeRuntimeHost<unknown>,
	subscriber: Subscriber | undefined,
	acquisition: SubscriptionAcquisition | undefined,
): Activation {
	return {
		self,
		subscriber,
		acquisition,
		phase: ACT_INIT,
		entered: false,
		handshake: false,
		unsubscribe: undefined,
		deps: NO_DEPS,
		len: 0,
		i: 0,
		seed: undefined,
		restored: undefined,
		link: undefined,
	};
}

const NO_DEPS: readonly Node<unknown>[] = Object.freeze([]);

/**
 * R-subscription / R-lifetime: subscribing activates an inactive node first, so the first array is
 * START plus the snapshot as the activation left it; arrays the activation sent before this
 * subscriber joined are not delivered to it separately. An ended node's function never runs again.
 */
export function nodeSubscribeOwned<T>(
	self: NodeRuntimeHost<T>,
	subscriber: Subscriber,
	acquisition?: SubscriptionAcquisition,
): () => void {
	const root = newActivation(self as NodeRuntimeHost<unknown>, subscriber, acquisition);
	driveActivations(root);
	return root.unsubscribe as () => void;
}

export function nodeActivate<T>(self: NodeRuntimeHost<T>): void {
	driveActivations(newActivation(self as NodeRuntimeHost<unknown>, undefined, undefined));
}

function driveActivations(root: Activation): void {
	const base = activations.length;
	activations.push(root);
	try {
		while (activations.length > base) stepActivation(activations[activations.length - 1]!, base);
	} catch (error) {
		unwindActivations(base, error);
	}
}

function stepActivation(f: Activation, base: number): void {
	const self = f.self;
	switch (f.phase) {
		case ACT_INIT: {
			if (f.subscriber === undefined) {
				beginActivation(f);
				return;
			}
			self._assertNotReleased("subscribe");
			// Wave-owner boundary (R-request-order): the activation cascade can run fns that make
			// requests such as ctx.rewire; they wait for the OUTERMOST exit, which runs them in
			// order. Nested subscribes (dep wiring) just inc/dec the depth.
			enterWave(self._core);
			f.entered = true;
			f.unsubscribe = makeUnsubscribe(self, f.subscriber);
			// D161: ownership precedes dependency activation, START and the snapshot.
			f.acquisition?.record(f.unsubscribe);
			if (!self._lifecycle.activated && self._value.terminal === undefined) beginActivation(f);
			else f.phase = ACT_ATTACH;
			return;
		}
		case ACT_DEPS: {
			if (f.i < f.len) {
				const i = f.i++;
				const dep = f.deps[i] as Node<unknown>;
				const seed = f.seed;
				const restored = f.restored as { changed: boolean };
				const link = nodeDepLink(
					self,
					dep,
					seed === undefined
						? undefined
						: { received: seed.received[i], onChange: () => (restored.changed = true) },
				);
				f.link = link;
				activations.push(newActivation(nodeRuntimeHost(dep), link.subscriber, link.acquisition));
				return;
			}
			self._wave.activating = false;
			f.phase = ACT_RUN;
			finishActivation(self, f.seed, f.restored as { changed: boolean });
			if (f.subscriber === undefined) completeActivation(f, base);
			else f.phase = ACT_ATTACH;
			return;
		}
		case ACT_ATTACH: {
			attachSubscriber(f, f.subscriber as Subscriber);
			completeActivation(f, base);
			return;
		}
	}
}

/** R-lifetime: activation acquires every dependency, then runs the function once on their snapshots. */
function beginActivation(f: Activation): void {
	const self = f.self;
	self._lifecycle.activated = true;
	f.seed = self._seed;
	self._seed = undefined;
	self._dep.unsubs = new Array(self._slot.deps.length);
	self._dep.idxBoxes = new Array(self._slot.deps.length);
	// R-checkpoint: a restored node's first activation compares what it had received from each
	// dependency with what the dependency holds now; only a changed dependency gives input.
	f.restored = { changed: false };
	// R-lifetime: activation acquires every dependency, then runs the function once on their
	// snapshots (and whatever they sent as they activated).
	self._wave.activating = true;
	f.deps = self._slot.deps;
	f.len = f.deps.length;
	f.i = 0;
	f.phase = ACT_DEPS;
}

/** Activation once every dependency is acquired: the lifetime's first run (R-lifetime). */
function finishActivation(
	self: NodeRuntimeHost<unknown>,
	seed: NodeSeed | undefined,
	restored: { changed: boolean },
): void {
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

/** R-subscription: the new subscriber gets START and the snapshot as one array. */
function attachSubscriber(f: Activation, subscriber: Subscriber): void {
	const self = f.self;
	self._lifecycle.subscribers.add(subscriber);
	const terminal = self._value.terminal;
	const start: Message[] = [
		["START"],
		...self._value.lastArray.map((v) => ["DATA", v] as Message),
		...(terminal === undefined
			? []
			: [(terminal === true ? ["COMPLETE"] : ["ERROR", terminal]) as Message]),
	];
	if (subscriber.kind === "sink") {
		nodeCallSink(self, subscriber, start);
		return;
	}
	// A new dependent receives the snapshot as one input array, not a live wave. A dependent whose
	// handshake throws is not subscribed, unless an owned acquisition records the lease for its
	// owner to release (D161).
	f.handshake = true;
	const wave = {};
	for (let i = 0; i < start.length; i++)
		subscriber.fn(start[i] as Message, { wave, last: i === start.length - 1, snapshot: true });
	f.handshake = false;
}

/** A frame is done: close its wave boundary, then its parent goes on with its next dependency. */
function completeActivation(f: Activation, base: number): void {
	activations.pop();
	f.phase = ACT_DONE;
	if (f.entered) {
		f.entered = false;
		exitWave(f.self._core);
	}
	if (activations.length > base) {
		const parent = activations[activations.length - 1] as Activation;
		const link = parent.link as DepLink;
		parent.link = undefined;
		link.finish();
	}
}

/** A throw unwinds every frame above `base` as it unwound the recursive calls, then is rethrown. */
function unwindActivations(base: number, thrown: unknown): never {
	let error = thrown;
	while (activations.length > base) {
		const f = activations.pop() as Activation;
		if (f.handshake) {
			f.handshake = false;
			try {
				if (f.acquisition === undefined) f.unsubscribe?.();
			} catch (e) {
				error = e;
			}
		}
		if (f.phase === ACT_DEPS) f.self._wave.activating = false;
		f.phase = ACT_DONE;
		if (f.entered) {
			f.entered = false;
			try {
				exitWave(f.self._core);
			} catch (e) {
				error = e;
			}
		}
	}
	throw error;
}

/** The subscription's unsubscribe; the last one out deactivates the node (R-lifetime). */
function makeUnsubscribe(self: NodeRuntimeHost<unknown>, subscriber: Subscriber): () => void {
	let left = false;
	return () => {
		// Q15: called straight from a teardown loop, the deactivation continues that loop.
		const tail = teardownTail;
		teardownTail = false;
		if (left) return;
		left = true;
		self._lifecycle.subscribers.delete(subscriber);
		if (self._lifecycle.subscribers.size === 0) {
			if (tail) teardowns.push(beginTeardown(self, TD_DEACTIVATE, undefined));
			else nodeDeactivate(self);
		}
	};
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
	const link = nodeDepLink(self, depNode, seed);
	nodeRuntimeHost(depNode)._subscribeOwned(link.subscriber, link.acquisition);
	link.finish();
}

/** A dependency subscription: its dependent subscriber, its acquisition, and what follows it. */
interface DepLink {
	readonly subscriber: Subscriber;
	readonly acquisition: SubscriptionAcquisition;
	/** After the dependency's subscription returned. */
	finish(): void;
}

function nodeDepLink<T>(
	self: NodeRuntimeHost<T>,
	depNode: Node<unknown>,
	seed: { readonly received: NodeReceived | undefined; readonly onChange: () => void } | undefined,
): DepLink {
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
	return {
		subscriber: { kind: "dependent", fn: dependent },
		acquisition: {
			record: (release) => {
				if (idx0 !== -1) {
					self._dep.unsubs[idx0] = release;
					self._dep.idxBoxes[idx0] = box;
				}
			},
		},
		finish: () => {
			if (decision === undefined && box.v !== -1) decide();
		},
	};
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
 * graphrefly-ts Q15: closing lifetimes runs on an explicit stack, not JS recursion, so releasing a
 * chain of any depth works. A frame is one lifetime closing; when releasing one of its
 * dependencies leaves that dependency without subscribers, the dependency's deactivation is a
 * frame on top of it, closed to its end before the next dependency is released, as the recursive
 * call was.
 */
const TD_CLOSE = 0;
const TD_DEACTIVATE = 1;
let teardownTail = false;

type CloseErrorSink = (error: unknown, resource: "subscription" | "deactivation") => void;

interface Teardown {
	readonly self: NodeRuntimeHost<unknown>;
	readonly kind: number;
	readonly onError: CloseErrorSink | undefined;
	readonly unsubs: readonly ((() => void) | undefined)[];
	i: number;
	readonly controller: AbortController | null;
	readonly cleanup: (() => void) | undefined;
}

const teardowns: Teardown[] = [];

/**
 * R-lifetime@2: closing a lifetime aborts its signal, releases its dependencies, runs its cleanup
 * (which may still read the private state), and then drops the private state. `onError` collects
 * failures instead of throwing (graph release).
 */
export function nodeCloseLifetime<T>(self: NodeRuntimeHost<T>, onError?: CloseErrorSink): void {
	driveTeardowns(beginTeardown(self as NodeRuntimeHost<unknown>, TD_CLOSE, onError));
}

/** The close up to releasing the dependencies: the lifetime's signal is aborted. */
function beginTeardown(
	self: NodeRuntimeHost<unknown>,
	kind: number,
	onError: CloseErrorSink | undefined,
): Teardown {
	if (kind === TD_DEACTIVATE) self._lifecycle.activated = false;
	const lifetime = self._lifetime;
	const controller = lifetime.controller;
	const cleanup = lifetime.cleanup;
	lifetime.controller = null;
	lifetime.cleanup = undefined;
	lifetime.setupDone = false;
	self._syncCtx = null;
	if (controller !== null) {
		if (onError === undefined) controller.abort();
		else
			try {
				controller.abort();
			} catch (error) {
				onError(error, "deactivation");
			}
	}
	const unsubs = self._dep.unsubs;
	self._dep.unsubs = [];
	self._dep.idxBoxes = [];
	return { self, kind, onError, unsubs, i: 0, controller, cleanup };
}

function driveTeardowns(root: Teardown): void {
	const base = teardowns.length;
	teardowns.push(root);
	while (teardowns.length > base) {
		const f = teardowns[teardowns.length - 1] as Teardown;
		try {
			stepTeardown(f);
		} catch (error) {
			teardownTail = false;
			unwindTeardowns(base, f, error);
		}
	}
}

/** Release the next dependency, or, with none left, finish the close. */
function stepTeardown(f: Teardown): void {
	if (f.i < f.unsubs.length) {
		const u = f.unsubs[f.i++];
		if (!u) return;
		teardownTail = true;
		if (f.onError === undefined) u();
		else
			try {
				u();
			} catch (error) {
				f.onError(error, "subscription");
			}
		teardownTail = false;
		return;
	}
	teardowns.pop();
	finishTeardown(f);
}

/**
 * A throw from frame `failed` ends it and every frame above `base` between it and the nearest frame
 * that collects failures (graph release); that frame records it as its dependency's and goes on.
 * With none, it is rethrown.
 */
function unwindTeardowns(base: number, failed: Teardown, thrown: unknown): void {
	let error = thrown;
	if (teardowns[teardowns.length - 1] === failed) teardowns.pop();
	while (teardowns.length > base) {
		const f = teardowns[teardowns.length - 1] as Teardown;
		if (f.onError !== undefined) {
			try {
				f.onError(error, "subscription");
				return;
			} catch (e) {
				error = e;
			}
		}
		teardowns.pop();
	}
	throw error;
}

/** The close after the dependencies are released (R-lifetime@2), then a deactivation's own end. */
function finishTeardown(f: Teardown): void {
	const self = f.self;
	const lifetime = self._lifetime;
	const onError = f.onError;
	// R-lifetime: a ctx.rewire belongs to its lifetime; closing puts the declared dependencies back.
	if (!self._released && self._slot.deps !== self._slot.declaredDeps) {
		const prev = self._slot.deps;
		self._slot.deps = self._slot.declaredDeps;
		Object.assign(self._dep, makeDepBookkeeping(self._slot.deps.length));
		notifyTopologyDepsChanged(self as unknown as Node<unknown>, prev, self._slot.deps);
	}
	lifetime.closing = true;
	lifetime.closingSignal = f.controller?.signal ?? null;
	const cleanup = f.cleanup;
	if (cleanup !== undefined) {
		if (onError !== undefined)
			try {
				cleanup();
			} catch (error) {
				onError(error, "deactivation");
			}
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
	if (f.kind === TD_DEACTIVATE) nodeDeactivateEnd(self);
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
	driveTeardowns(beginTeardown(self as NodeRuntimeHost<unknown>, TD_DEACTIVATE, undefined));
}

/** R-lifetime: deactivation drops a computed node's retained values unless it has ended. */
function nodeDeactivateEnd(self: NodeRuntimeHost<unknown>): void {
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
