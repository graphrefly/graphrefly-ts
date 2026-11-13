import { enterWave, exitWave, reportFailure } from "../batch/boundary.js";
import { type Message, SENTINEL } from "../protocol/messages.js";
import { makeDepBookkeeping, makeDepInput, type Subscriber } from "./core.js";
import type { Node } from "./node.js";
import { nodeReceiveFromDep, nodeSettle } from "./node-input-runtime.js";
import {
	CORE,
	DEP,
	ID,
	LIFECYCLE,
	LIFETIME,
	PRIVATE_STATE,
	RELEASED,
	SEED_NOTE,
	SLOT,
	VALUE,
	WAVE,
} from "./node-keys.js";
import { nodeCallSink } from "./node-output-runtime.js";
import type { RuntimeReleaseFailure, SubscriptionAcquisition } from "./owned-acquisition.js";
import {
	closeNodeRegistration,
	notifyTopologyDepsChanged,
	setRuntimeReleaseFailures,
} from "./runtime-accessors.js";
import type { Status } from "./types.js";

/**
 * activation runs on an explicit stack of frames, not JS recursion, so a chain
 * of any depth activates. A frame is one subscription to one node (nodeSubscribeOwned): it
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
	readonly self: Node<unknown>;
	/** undefined: activation only (nodeActivate), no subscription. */
	readonly subscriber: Subscriber | undefined;
	readonly acquisition: SubscriptionAcquisition | undefined;
	phase: number;
	/** The subscription's wave boundary is open (enterWave without its exitWave yet). */
	entered: boolean;
	unsubscribe: (() => void) | undefined;
	deps: readonly Node<unknown>[];
	len: number;
	i: number;
}

const activations: Activation[] = [];

function newActivation(
	self: Node<unknown>,
	subscriber: Subscriber | undefined,
	acquisition: SubscriptionAcquisition | undefined,
): Activation {
	return {
		self,
		subscriber,
		acquisition,
		phase: ACT_INIT,
		entered: false,
		unsubscribe: undefined,
		deps: NO_DEPS,
		len: 0,
		i: 0,
	};
}

const NO_DEPS: readonly Node<unknown>[] = Object.freeze([]);

/** D122: a node released from its graph's lifecycle takes no more input or subscriptions. */
export function nodeAssertNotReleased<T>(self: Node<T>, op: string): void {
	if (self[RELEASED])
		throw new Error(`${op}: node has been released from its graph lifecycle (D122)`);
}

/**
 * R-subscription / R-lifetime: subscribing activates an inactive node first, so the first array is
 * START plus the snapshot as the activation left it; arrays the activation sent before this
 * subscriber joined are not delivered to it separately. An ended node's function never runs again.
 */
export function nodeSubscribeOwned<T>(
	self: Node<T>,
	subscriber: Subscriber,
	acquisition?: SubscriptionAcquisition,
): () => void {
	const root = newActivation(self, subscriber, acquisition);
	driveActivations(root);
	return root.unsubscribe as () => void;
}

export function nodeActivate<T>(self: Node<T>): void {
	driveActivations(newActivation(self, undefined, undefined));
}

function driveActivations(root: Activation): void {
	const base = activations.length;
	activations.push(root);
	try {
		while (activations.length > base) stepActivation(activations[activations.length - 1]!);
	} catch (error) {
		unwindActivations(base, error);
	}
}

function stepActivation(f: Activation): void {
	const self = f.self;
	switch (f.phase) {
		case ACT_INIT: {
			if (f.subscriber === undefined) {
				beginActivation(f);
				return;
			}
			nodeAssertNotReleased(self, "subscribe");
			// Wave-owner boundary (R-request-order): the activation cascade can run fns that make
			// requests such as ctx.rewire; they wait for the OUTERMOST exit, which runs them in
			// order. Nested subscribes (dep wiring) just inc/dec the depth.
			enterWave(self[CORE]);
			f.entered = true;
			f.unsubscribe = makeUnsubscribe(self, f.subscriber);
			// D161: ownership precedes dependency activation, START and the snapshot.
			f.acquisition?.record(f.unsubscribe);
			if (!self[LIFECYCLE].activated && self[VALUE].terminal === undefined) beginActivation(f);
			else f.phase = ACT_ATTACH;
			return;
		}
		case ACT_DEPS: {
			if (f.i < f.len) {
				const dep = f.deps[f.i++] as Node<unknown>;
				const link = nodeDepLink(self, dep);
				activations.push(newActivation(dep, link.subscriber, link.acquisition));
				return;
			}
			self[WAVE].activating = false;
			f.phase = ACT_RUN;
			finishActivation(self);
			if (f.subscriber === undefined) completeActivation(f);
			else f.phase = ACT_ATTACH;
			return;
		}
		case ACT_ATTACH: {
			attachSubscriber(f, f.subscriber as Subscriber);
			completeActivation(f);
			return;
		}
	}
}

/** R-lifetime: activation acquires every dependency, then runs the function once on their snapshots. */
function beginActivation(f: Activation): void {
	const self = f.self;
	self[LIFECYCLE].activated = true;
	const inputs = self[DEP].inputs;
	for (let i = 0; i < inputs.length; i++) inputs[i].unsub = undefined;
	// R-lifetime: activation acquires every dependency, then runs the function once on their
	// snapshots (and whatever they sent as they activated).
	self[WAVE].activating = true;
	f.deps = self[SLOT].deps;
	f.len = f.deps.length;
	f.i = 0;
	f.phase = ACT_DEPS;
}

/** Activation once every dependency is acquired: the lifetime's first run (R-lifetime). */
function finishActivation(self: Node<unknown>): void {
	self[WAVE].rewireRunPending = false;
	if (self[SLOT].handle === null && self[SLOT].deps.length === 0) return; // a state node has no function
	if (self[WAVE].pending > 0) return; // a dependency is mid-wave; the run waits for it
	// R-subscription@3: a seeded node's first activation is an ordinary one; its first run gets the
	// seed's note (ctx.seed).
	nodeSettle(self, true);
}

/** R-subscription: the new subscriber gets START and the snapshot as one array. */
function attachSubscriber(f: Activation, subscriber: Subscriber): void {
	const self = f.self;
	self[LIFECYCLE].subscribers.add(subscriber);
	const terminal = self[VALUE].terminal;
	const start: Message[] = [
		["START"],
		...self[VALUE].lastArray.map((v) => ["DATA", v] as Message),
		...(terminal === undefined
			? []
			: [(terminal === true ? ["COMPLETE"] : ["ERROR", terminal]) as Message]),
	];
	if (subscriber.kind === "sink") {
		nodeCallSink(self, subscriber, start);
		return;
	}
	// A new dependent receives the snapshot as one input array, not a live wave.
	subscriber.fn([start], true);
}

/** A frame is done: close its wave boundary; its parent goes on with its next dependency. */
function completeActivation(f: Activation): void {
	activations.pop();
	f.phase = ACT_DONE;
	if (f.entered) {
		f.entered = false;
		exitWave(f.self[CORE]);
	}
}

/** A throw unwinds every frame above `base` as it unwound the recursive calls, then is rethrown. */
function unwindActivations(base: number, thrown: unknown): never {
	let error = thrown;
	while (activations.length > base) {
		const f = activations.pop() as Activation;
		if (f.phase === ACT_DEPS) f.self[WAVE].activating = false;
		f.phase = ACT_DONE;
		if (f.entered) {
			f.entered = false;
			try {
				exitWave(f.self[CORE]);
			} catch (e) {
				error = e;
			}
		}
	}
	throw error;
}

/** The subscription's unsubscribe; the last one out deactivates the node (R-lifetime). */
function makeUnsubscribe(self: Node<unknown>, subscriber: Subscriber): () => void {
	let left = false;
	return () => {
		// called straight from a teardown loop, the deactivation continues that loop.
		const tail = teardownTail;
		teardownTail = false;
		if (left) return;
		left = true;
		self[LIFECYCLE].subscribers.delete(subscriber);
		if (self[LIFECYCLE].subscribers.size === 0) {
			if (tail) teardowns.push(beginTeardown(self, TD_DEACTIVATE, undefined));
			else nodeDeactivate(self);
		}
	};
}

export function nodeSubscribeDepAt<T>(self: Node<T>, depNode: Node<unknown>): void {
	const link = nodeDepLink(self, depNode);
	nodeSubscribeOwned(depNode, link.subscriber, link.acquisition);
}

/** A dependency subscription: its dependent subscriber and its acquisition. */
interface DepLink {
	readonly subscriber: Subscriber;
	readonly acquisition: SubscriptionAcquisition;
}

function nodeDepLink<T>(self: Node<T>, depNode: Node<unknown>): DepLink {
	// The dependency's record is the subscription's index box: a rewire re-points its idx.
	const idx0 = self[SLOT].deps.indexOf(depNode);
	const input = idx0 === -1 ? makeDepInput(-1) : self[DEP].inputs[idx0];
	const dependent: import("../ctx/types.js").DependentSink = (arrays, snapshot) => {
		if (input.idx === -1) return; // dep removed — stale callback, drop (drain)
		nodeReceiveFromDep(self, input.idx, arrays, snapshot);
	};
	return {
		subscriber: { kind: "dependent", fn: dependent },
		acquisition: {
			record: (release) => {
				if (idx0 !== -1) input.unsub = release;
			},
		},
	};
}

/**
 * closing lifetimes runs on an explicit stack, not JS recursion, so releasing a
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
	readonly self: Node<unknown>;
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
export function nodeCloseLifetime<T>(self: Node<T>, onError?: CloseErrorSink): void {
	driveTeardowns(beginTeardown(self, TD_CLOSE, onError));
}

/** The close up to releasing the dependencies: the lifetime's signal is aborted. */
function beginTeardown(
	self: Node<unknown>,
	kind: number,
	onError: CloseErrorSink | undefined,
): Teardown {
	if (kind === TD_DEACTIVATE) self[LIFECYCLE].activated = false;
	const lifetime = self[LIFETIME];
	const controller = lifetime.controller;
	const cleanup = lifetime.cleanup;
	lifetime.controller = null;
	lifetime.cleanup = undefined;
	lifetime.setupDone = false;
	// R-subscription@3: only the seeded instance's first run, in its first lifetime, gets the note.
	self[SEED_NOTE] = undefined;
	if (controller !== null) {
		if (onError === undefined) controller.abort();
		else
			try {
				controller.abort();
			} catch (error) {
				onError(error, "deactivation");
			}
	}
	const inputs = self[DEP].inputs;
	const unsubs: Array<() => void> = [];
	for (let i = 0; i < inputs.length; i++) {
		const input = inputs[i];
		if (input.unsub === undefined) continue;
		unsubs.push(input.unsub);
		input.unsub = undefined;
	}
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
	// R-lifetime: a ctx.rewire belongs to its lifetime; closing puts the declared dependencies back.
	if (!self[RELEASED] && self[SLOT].deps !== self[SLOT].declaredDeps) {
		const prev = self[SLOT].deps;
		self[SLOT].deps = self[SLOT].declaredDeps;
		Object.assign(self[DEP], makeDepBookkeeping(self[SLOT].deps.length));
		notifyTopologyDepsChanged(self, prev, self[SLOT].deps);
	}
	nodeFinishCleanup(self, f.controller?.signal ?? null, f.cleanup, f.onError);
	if (f.kind === TD_DEACTIVATE) nodeDeactivateEnd(self);
}

/** R-lifetime: replacement and teardown share the same final access to the old private state. */
export function nodeFinishCleanup(
	self: Node<unknown>,
	signal: AbortSignal | null,
	cleanup: (() => void) | undefined,
	onError?: CloseErrorSink,
): void {
	const lifetime = self[LIFETIME];
	lifetime.closing = true;
	lifetime.closingSignal = signal;
	try {
		cleanup?.();
	} catch (error) {
		if (onError !== undefined) onError(error, "deactivation");
		else reportFailure(self[CORE], `cleanup of ${self[SLOT].name ?? "node"}`, error);
	} finally {
		lifetime.closing = false;
		lifetime.closingSignal = null;
		self[PRIVATE_STATE].value = SENTINEL;
	}
}

/** R-node@2: a node's status, derived from what it holds. */
export function nodeStatus<T>(self: Node<T>): Status {
	const terminal = self[VALUE].terminal;
	return {
		cache: !self[VALUE].hasData
			? "empty"
			: self[WAVE].emittedDirtyThisWave || self[WAVE].pending > 0
				? "stale"
				: "ready",
		output: terminal === undefined ? "open" : terminal === true ? "completed" : "errored",
		lifecycle: self[LIFETIME].closing
			? "closing"
			: self[LIFECYCLE].activated
				? "active"
				: "inactive",
	};
}

export function nodeDeactivate<T>(self: Node<T>): void {
	driveTeardowns(beginTeardown(self, TD_DEACTIVATE, undefined));
}

/** R-lifetime: deactivation drops a computed node's retained values unless it has ended. */
function nodeDeactivateEnd(self: Node<unknown>): void {
	const isCompute = self[SLOT].handle !== null || self[SLOT].deps.length > 0;
	if (isCompute && self[VALUE].terminal === undefined) {
		// RAM: compute nodes clear cache; reconnect re-runs fn fresh.
		self[VALUE].cache = SENTINEL;
		self[VALUE].hasData = false;
		self[VALUE].lastArray = [];
	}
	nodeResetDepState(self);
}

export function nodeSubscriberCount<T>(self: Node<T>): number {
	return self[LIFECYCLE].subscribers.size;
}

export function nodeIsRuntimeQuiescentForRelease<T>(self: Node<T>): boolean {
	return (
		!self[RELEASED] &&
		!self[WAVE].emittedDirtyThisWave &&
		self[WAVE].pending === 0 &&
		!self[WAVE].insideRunWave &&
		!self[WAVE].inDepMutation &&
		!self[WAVE].rewireRunPending &&
		self[DEP].inputs.every((input) => !input.dirty)
	);
}

export function nodeReleaseRuntime<T>(self: Node<T>): void {
	if (self[RELEASED]) return;
	self[RELEASED] = true;
	const node: Node<unknown> = self;
	const releaseErrors: RuntimeReleaseFailure[] = [];
	const recordReleaseError = (
		error: unknown,
		resource: RuntimeReleaseFailure["resource"],
		handle?: import("../dispatcher/index.js").Handle,
	): void => {
		releaseErrors.push({
			cause: error,
			resource,
			...(handle === undefined ? {} : { handle, dispatcher: self[SLOT].dispatcher }),
		});
	};
	self[LIFECYCLE].activated = false;
	// D124 release is graph-owned and atomic: subscription and cleanup failures are collected, not
	// thrown mid-release, and no protocol ERROR/COMPLETE is synthesized.
	nodeCloseLifetime(self, (error, resource) => recordReleaseError(error, resource));
	self[LIFECYCLE].subscribers.clear();
	if (self[SLOT].handle !== null) {
		const handle = self[SLOT].handle;
		try {
			self[SLOT].dispatcher.unregister(handle);
			self[SLOT].handle = null;
		} catch (error) {
			recordReleaseError(error, "handle", handle);
		}
	}
	self[SLOT].deps = [];
	self[DEP].inputs = [];
	self[VALUE].cache = SENTINEL;
	self[VALUE].hasData = false;
	self[VALUE].terminal = undefined;
	self[VALUE].lastArray = [];
	self[PRIVATE_STATE].value = SENTINEL;
	nodeResetDepState(self);
	self[SEED_NOTE] = undefined;
	closeNodeRegistration(node);
	try {
		self[CORE].releaseSlot(self[ID]);
	} catch (cause) {
		releaseErrors.push({ resource: "slot", cause, core: self[CORE], slot: self[ID] });
	}
	if (releaseErrors.length > 0) {
		setRuntimeReleaseFailures(node, Object.freeze(releaseErrors));
		throw releaseErrors[0]!.cause;
	}
}

export function nodeResetDepState<T>(self: Node<T>): void {
	const inputs = self[DEP].inputs;
	for (let i = 0; i < inputs.length; i++) {
		const input = inputs[i];
		input.waveData = [];
		input.waveLive = [];
		input.prev = SENTINEL;
		input.hasData = false;
		input.dirty = false;
		input.terminal = undefined;
		input.terminalInput = undefined;
		input.invalidated = false;
	}
	self[WAVE].pending = 0;
	self[WAVE].emittedDirtyThisWave = false;
}
