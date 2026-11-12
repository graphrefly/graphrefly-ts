import {
	type BatchTarget,
	currentBatch,
	currentBoundaryBatchToken,
	noteBatchLifetime,
	request,
} from "../batch/batch.js";
import { deferRequest } from "../batch/boundary.js";
import {
	CTX_NODE_BINDING,
	type Ctx,
	type CtxDep,
	type CtxState,
	type DepTerminal,
	setCtxDepWaveOrigin,
} from "../ctx/types.js";
import { type Message, SENTINEL, type Wave } from "../protocol/messages.js";
import type { Node } from "./node.js";
import { prepareArrays } from "./node-output-runtime.js";
import {
	nodeApplyRewireDiff,
	nodeRequestRewire,
	nodeRequestRewireDiff,
} from "./node-rewire-runtime.js";
import type { NodeRuntimeHost } from "./node-runtime-host.js";
import { validateNodeOutput } from "./protocol-guards.js";
import { graphNodeIdOf, withEnvironmentDrivers, withNodeCore } from "./runtime-accessors.js";

/**
 * The ctx a run is given (graphrefly:D807: one kind of run, no pool kinds). One ctx per lifetime,
 * reused run after run; its dependency views read the node's live inputs, so a read during a run
 * is that run's view (R-invocation@2). A function that keeps its ctx past the run uses it for
 * output (`ctx.down`, a later wave, R-wave@2) and its lifetime's state and signal.
 */
export function nodeBuildCtx<T>(self: NodeRuntimeHost<T>): Ctx {
	if (self._syncCtx === null) self._syncCtx = self._makeCtx();
	self._refreshCtx(self._syncCtx);
	return self._syncCtx;
}

const COMPLETE: DepTerminal = Object.freeze({ kind: "complete" });
const NO_WAVES: readonly (readonly unknown[])[] = Object.freeze([]);

function depTerminalOf(t: unknown): DepTerminal | undefined {
	if (t === undefined) return undefined;
	return t === true ? COMPLETE : { kind: "error", error: t };
}

/**
 * One dependency's view (R-invocation@2): an array keeps its boundary; markers are not values.
 * It reads the node's live inputs, so a reused ctx needs no refresh.
 */
function makeDepView<T>(self: NodeRuntimeHost<T>, index: number): CtxDep {
	let idNode: Node<unknown> | undefined;
	let id = "";
	return {
		get id() {
			const dep = self._slot.deps[index] as Node<unknown>;
			if (dep !== idNode) {
				idNode = dep;
				id = graphNodeIdOf(dep);
			}
			return id;
		},
		get waves() {
			const arrays = self._dep.inputs[index]?.waveData;
			if (arrays === undefined || arrays.length === 0) return NO_WAVES;
			return arrays.map((a) => (a.includes(SENTINEL) ? a.filter((v) => v !== SENTINEL) : a));
		},
		get terminal() {
			return depTerminalOf(self._dep.inputs[index]?.terminalInput);
		},
		get value() {
			return self._dep.inputs[index]?.prev;
		},
		get has() {
			return self._dep.inputs[index]?.hasData === true;
		},
		get invalidated() {
			return (
				self._slot.invalidatePolicy === "manual" && self._dep.inputs[index]?.invalidated === true
			);
		},
	};
}

/** The dependency views of a ctx, one per current dependency. */
function makeDepViews<T>(self: NodeRuntimeHost<T>): CtxDep[] {
	return self._slot.deps.map((_, i) => makeDepView(self, i));
}

export function nodeMakeCtx<T>(self: NodeRuntimeHost<T>): Ctx {
	// R-lifetime: every ctx belongs to exactly one lifetime; output through a ctx whose lifetime has
	// closed is dropped.
	const signal = nodeLifetimeSignal(self);
	const ctx: Ctx = {
		// Wave-owner boundary (D47): an emit during the run nests under the public entry that
		// drove it (cheap inc/dec, no early drain); a function that kept its ctx re-enters here
		// at depth 0 after it returned, so this is the boundary that drains any ctx.rewire it issued.
		down: (msgs) => {
			if (self._released || signal.aborted) return;
			// An empty array sends nothing: no array, no wave, no request, no output (as in Rust
			// and Python), during the run, after it and inside a batch body.
			if (msgs.length === 0) return;
			validateNodeOutput(msgs);
			// R-failure: an invalid array throws from ctx.down, before anything is accepted.
			prepareArrays(msgs);
			noteBatchLifetime(self._core, self as unknown as Node<unknown>, signal);
			// R-wave: during the node's run its arrays are its run's output, published after it returns.
			// Inside a batch body they are staged for the commit (R-request-order).
			if (self._wave.insideRunWave || currentBatch(self._core)) {
				self._down(msgs);
				return;
			}
			// R-wave / R-request-order: output after the function returned starts a wave of its own,
			// as a request: during another wave it waits for it, and it is dropped if this ctx's
			// lifetime has closed (or the node got a new instance) before it runs.
			const array: Wave = [...msgs];
			request(self._core, () => {
				if (!nodeLifetimeIsCurrent(self, signal)) return;
				self._down(array);
			});
		},
		emit: (...values) => {
			ctx.down(values.map((v) => ["DATA", v] as const));
		},
		deps: makeDepViews(self),
		state: self._makeState(signal),
		seed: undefined,
		signal,
		environment: () => self._slot.environment,
		rewire: (deps) => nodeRequestRewire(self, signal, [...deps]),
		[CTX_NODE_BINDING]: {
			dispatcher: self._slot.dispatcher,
			create: <U>(factory: () => Node<U>) =>
				withEnvironmentDrivers(self._slot.environment, () =>
					withNodeCore(self._core, factory, self._slot.dispatcher),
				),
			rewireDiff: (add, remove) => nodeRequestRewireDiff(self, signal, add, remove),
			rewireDiffNow: (add, remove) => nodeApplyRewireDiff(self, signal, add, remove),
		},
	};
	// The live flags of each dependency's arrays: the node's live inputs, which a reused ctx
	// reads as its views do, so it needs no refresh.
	setCtxDepWaveOrigin(ctx, { live: (depIndex) => self._dep.inputs[depIndex]?.waveLive });
	return ctx;
}

/** The current lifetime's signal, opening the lifetime if none is open (R-lifetime). */
export function nodeLifetimeSignal<T>(self: NodeRuntimeHost<T>): AbortSignal {
	self._lifetime.controller ??= new AbortController();
	return self._lifetime.controller.signal;
}

export function nodeRefreshCtx<T>(self: NodeRuntimeHost<T>, ctx: Ctx): void {
	// The views read the node's live inputs; only a rewire changes how many there are.
	if (ctx.deps.length !== self._slot.deps.length)
		(ctx as { deps: readonly CtxDep[] }).deps = makeDepViews(self);
}

/** R-lifetime: whether `signal` is the node's current lifetime (also while its cleanup runs). */
export function nodeLifetimeIsCurrent<T>(self: NodeRuntimeHost<T>, signal: AbortSignal): boolean {
	return !self._released && !signal.aborted && self._lifetime.controller?.signal === signal;
}

/**
 * R-lifetime@2: a ctx's private state is its lifetime's. Once that lifetime has closed (its cleanup
 * done), the ctx reads nothing and writes nothing, so it cannot reach the next lifetime's state.
 */
export function nodeMakeState<T>(self: NodeRuntimeHost<T>, signal: AbortSignal): CtxState {
	const own = () =>
		self._lifetime.controller?.signal === signal || self._lifetime.closingSignal === signal;
	return {
		get: <S>() => (own() ? (self._privateState.value as S | undefined) : undefined),
		set: <S>(v: S) => {
			if (own()) self._privateState.value = v;
		},
	};
}

/**
 * R-wave: a quiet node's run output goes out after the current wave as one wave of its own, its
 * arrays kept apart and in order, with the kernel's PENDING before them. It is a request of the
 * node's graph and is dropped if the run's lifetime has closed or the node has ended first.
 */
export function nodeDeferQuietOutput<T>(self: NodeRuntimeHost<T>, arrays: Message[][]): void {
	const signal = self._lifetime.controller?.signal;
	const out = arrays.map((a) => [...a]);
	deferRequest(
		self._core,
		() => {
			// A node that has not run has no lifetime (an auto terminal from a dependency); its
			// output stands while it is still active.
			if (
				signal === undefined
					? self._released || !self._lifecycle.activated
					: !nodeLifetimeIsCurrent(self, signal)
			)
				return;
			if (self._value.terminal !== undefined) return;
			self._publish(out);
		},
		{ batchToken: currentBoundaryBatchToken(self._core) },
	);
}
