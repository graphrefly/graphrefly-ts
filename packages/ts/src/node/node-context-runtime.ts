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

export function nodeBuildCtx<T>(self: NodeRuntimeHost<T>): Ctx {
	const kind = self._slot.handle
		? self._slot.dispatcher.poolKind(self._slot.handle.poolId)
		: "sync";
	if (kind === "sync") {
		if (self._syncCtx === null) self._syncCtx = self._makeCtx();
		self._refreshCtx(self._syncCtx);
		return self._syncCtx;
	}
	// async: snapshot dep inputs so a deferred late-emit reads this wave's view.
	return self._makeCtx({
		waveData: self._dep.waveData.map((waves) => waves.map((w) => [...w])),
		waveLive: self._dep.waveLive.map((waves) => [...waves]),
		terminal: [...self._dep.terminalInput],
		invalidated: nodeInvalidatedView(self),
		latest: [...self._dep.prev],
		has: [...self._dep.hasData],
	});
}

/** What a ctx's dependency views read: the node's live inputs, or an async run's snapshot. */
interface DepInputs {
	readonly waveData: readonly (readonly unknown[])[][];
	readonly terminal: readonly (true | unknown | undefined)[];
	readonly invalidated: readonly boolean[];
	readonly latest: readonly unknown[];
	readonly has: readonly boolean[];
}

const COMPLETE: DepTerminal = Object.freeze({ kind: "complete" });
const NO_WAVES: readonly (readonly unknown[])[] = Object.freeze([]);

function depTerminalOf(t: unknown): DepTerminal | undefined {
	if (t === undefined) return undefined;
	return t === true ? COMPLETE : { kind: "error", error: t };
}

/**
 * One dependency's view (R-invocation@2): an array keeps its boundary; markers are not values.
 * Without `snapshot` it reads the node's live inputs, so a reused sync ctx needs no refresh.
 */
function makeDepView<T>(self: NodeRuntimeHost<T>, index: number, snapshot?: DepInputs): CtxDep {
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
			const arrays = (snapshot ?? self._dep).waveData[index];
			if (arrays === undefined || arrays.length === 0) return NO_WAVES;
			return arrays.map((a) => (a.includes(SENTINEL) ? a.filter((v) => v !== SENTINEL) : a));
		},
		get terminal() {
			return depTerminalOf(snapshot ? snapshot.terminal[index] : self._dep.terminalInput[index]);
		},
		get value() {
			return snapshot ? snapshot.latest[index] : self._dep.prev[index];
		},
		get has() {
			return (snapshot ? snapshot.has[index] : self._dep.hasData[index]) === true;
		},
		get invalidated() {
			if (snapshot) return snapshot.invalidated[index] === true;
			return self._slot.invalidatePolicy === "manual" && self._dep.invalidated[index] === true;
		},
	};
}

/** The dependency views of a ctx, one per current dependency. */
function makeDepViews<T>(self: NodeRuntimeHost<T>, snapshot?: DepInputs): CtxDep[] {
	return self._slot.deps.map((_, i) => makeDepView(self, i, snapshot));
}

export function nodeMakeCtx<T>(
	self: NodeRuntimeHost<T>,
	snapshot?: {
		waveData: unknown[][][];
		waveLive?: boolean[][];
		terminal: unknown[];
		invalidated?: boolean[];
		latest: unknown[];
		has: boolean[];
	},
): Ctx {
	const inputs: DepInputs | undefined =
		snapshot === undefined
			? undefined
			: {
					waveData: snapshot.waveData,
					terminal: snapshot.terminal,
					invalidated: snapshot.invalidated ?? [],
					latest: snapshot.latest,
					has: snapshot.has,
				};
	// R-lifetime: every ctx belongs to exactly one lifetime; output through a ctx whose lifetime has
	// closed is dropped.
	const signal = nodeLifetimeSignal(self);
	const ctx: Ctx = {
		// Wave-owner boundary (D47): a SYNC fn's emit nests under the public entry that drove
		// it (cheap inc/dec, no early drain); an ASYNC-pool fn re-enters here from its stashed
		// ctx at depth 0, so this is the boundary that drains any ctx.rewire it issued.
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
		deps: makeDepViews(self, inputs),
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
	setCtxDepWaveOrigin(ctx, { live: snapshot?.waveLive ?? self._dep.waveLive });
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
	setCtxDepWaveOrigin(ctx, { live: self._dep.waveLive });
}

function nodeInvalidatedView<T>(self: NodeRuntimeHost<T>): boolean[] {
	return self._slot.invalidatePolicy === "manual"
		? [...self._dep.invalidated]
		: self._dep.invalidated.map(() => false);
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
