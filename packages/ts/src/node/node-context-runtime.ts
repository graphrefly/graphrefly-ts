import { currentBoundaryBatchToken, request } from "../batch/batch.js";
import { deferRequest } from "../batch/boundary.js";
import {
	CTX_NODE_BINDING,
	type Ctx,
	type CtxDep,
	type CtxState,
	type DepTerminal,
	setCtxDepWaveOrigin,
} from "../ctx/types.js";
import { type Message, SENTINEL } from "../protocol/messages.js";
import type { Node } from "./node.js";
import { CORE, DEP, LIFETIME, PRIVATE_STATE, RELEASED, SLOT, WAVE } from "./node-keys.js";
import { nodeDown, nodePublish, prepareArrays } from "./node-output-runtime.js";
import {
	nodeApplyRewireDiff,
	nodeRequestRewire,
	nodeRequestRewireDiff,
} from "./node-rewire-runtime.js";
import { validateNodeOutput } from "./protocol-guards.js";
import { graphNodeIdOf, withEnvironmentDrivers, withNodeCore } from "./runtime-accessors.js";

/** R-invocation: one ctx per setup/function invocation; retained output/state keep the lifetime. */
export function nodeBuildCtx<T>(self: Node<T>): { ctx: Ctx; close(): void } {
	let active = true;
	const check = () => {
		if (!active) throw new Error("ctx.deps is only available during setup or function invocation");
	};
	return {
		ctx: nodeMakeCtx(self, check, () => active),
		close: () => {
			active = false;
		},
	};
}

const COMPLETE: DepTerminal = Object.freeze({ kind: "complete" });
const NO_WAVES: readonly (readonly unknown[])[] = Object.freeze([]);

function depTerminalOf(t: unknown): DepTerminal | undefined {
	if (t === undefined) return undefined;
	return t === true ? COMPLETE : { kind: "error", error: t };
}

/**
 * One dependency view reads inputs only while its own invocation is open.
 */
function makeDepView<T>(self: Node<T>, index: number, check: () => void): CtxDep {
	let idNode: Node<unknown> | undefined;
	let id = "";
	return {
		get id() {
			check();
			const dep = self[SLOT].deps[index] as Node<unknown>;
			if (dep !== idNode) {
				idNode = dep;
				id = graphNodeIdOf(dep);
			}
			return id;
		},
		get waves() {
			check();
			const arrays = self[DEP].inputs[index]?.waveData;
			if (arrays === undefined || arrays.length === 0) return NO_WAVES;
			return arrays.map((a) => (a.includes(SENTINEL) ? a.filter((v) => v !== SENTINEL) : a));
		},
		get terminal() {
			check();
			return depTerminalOf(self[DEP].inputs[index]?.terminalInput);
		},
		get value() {
			check();
			return self[DEP].inputs[index]?.prev;
		},
		get has() {
			check();
			return self[DEP].inputs[index]?.hasData === true;
		},
		get invalidated() {
			check();
			return (
				self[SLOT].invalidatePolicy === "manual" && self[DEP].inputs[index]?.invalidated === true
			);
		},
	};
}

function nodeMakeCtx<T>(self: Node<T>, check: () => void, invocationOpen: () => boolean): Ctx {
	// R-lifetime: every ctx belongs to exactly one lifetime; output through a ctx whose lifetime has
	// closed is dropped.
	const signal = nodeLifetimeSignal(self);
	const deps = self[SLOT].deps.map((_, i) => makeDepView(self, i, check));
	const ctx: Ctx = {
		// Wave-owner boundary (D47): an emit during the run nests under the public entry that
		// drove it (cheap inc/dec, no early drain); a function that kept its ctx re-enters here
		// at depth 0 after it returned, so this is the boundary that drains any ctx.rewire it issued.
		down: (msgs) => {
			if (self[RELEASED] || signal.aborted) return;
			// An empty array sends nothing: no array, no wave, no request, no output (as in Rust
			// and Python), during the run, after it and inside a batch body.
			if (msgs.length === 0) return;
			validateNodeOutput(msgs);
			// R-failure: an invalid array throws from ctx.down, before anything is accepted.
			const arrays = prepareArrays(msgs);
			// R-wave: during the node's run its arrays are its run's output, published after it returns.
			// A later call is a request, even inside a batch body (R-request-order@3).
			if (invocationOpen() && self[WAVE].insideRunWave) {
				nodeDown(self, msgs);
				return;
			}
			// R-wave: output after the function returned starts a wave of its own.
			nodePublishLater(self, signal, arrays, false);
		},
		emit: (...values) => {
			ctx.down(values.map((v) => ["DATA", v] as const));
		},
		get deps() {
			check();
			return deps;
		},
		state: nodeMakeState(self, signal),
		seed: undefined,
		signal,
		environment: () => self[SLOT].environment,
		rewire: (deps) => nodeRequestRewire(self, signal, [...deps]),
		[CTX_NODE_BINDING]: {
			dispatcher: self[SLOT].dispatcher,
			create: <U>(factory: () => Node<U>) =>
				withEnvironmentDrivers(self[SLOT].environment, () =>
					withNodeCore(self[CORE], factory, self[SLOT].dispatcher),
				),
			rewireDiff: (add, remove) => nodeRequestRewireDiff(self, signal, add, remove),
			rewireDiffNow: (add, remove) => nodeApplyRewireDiff(self, signal, add, remove),
		},
	};
	// Internal wrappers read origin flags during this supplying invocation.
	setCtxDepWaveOrigin(ctx, { live: (depIndex) => self[DEP].inputs[depIndex]?.waveLive });
	return ctx;
}

/** The current lifetime's signal, opening the lifetime if none is open (R-lifetime). */
export function nodeLifetimeSignal<T>(self: Node<T>): AbortSignal {
	self[LIFETIME].controller ??= new AbortController();
	return self[LIFETIME].controller.signal;
}

/** R-lifetime: whether `signal` is the node's current lifetime (also while its cleanup runs). */
export function nodeLifetimeIsCurrent<T>(self: Node<T>, signal: AbortSignal): boolean {
	return !self[RELEASED] && !signal.aborted && self[LIFETIME].controller?.signal === signal;
}

/**
 * R-lifetime@2: a ctx's private state is its lifetime's. Once that lifetime has closed (its cleanup
 * done), the ctx reads nothing and writes nothing, so it cannot reach the next lifetime's state.
 */
export function nodeMakeState<T>(self: Node<T>, signal: AbortSignal): CtxState {
	const own = () =>
		self[LIFETIME].controller?.signal === signal || self[LIFETIME].closingSignal === signal;
	return {
		get: <S>() => (own() ? (self[PRIVATE_STATE].value as S | undefined) : undefined),
		set: <S>(v: S) => {
			if (own()) self[PRIVATE_STATE].value = v;
		},
	};
}

/**
 * R-wave / R-lifetime: output that goes out later, as a wave of its own: a ctx.down after the
 * function returned and a quiet node's run output. It is a request of the node's graph
 * (R-request-order): at once outside a wave, otherwise after it. A quiet node's run output is part
 * of the cascade it settles in, so when that is a batch commit's delivery it is tagged with the
 * batch and a commit that fails drops it (C-25 / D110); a ctx.down after the run is a request like
 * set or subscribe and does not share the commit's fate (R-request-order@2). When it runs it is
 * dropped unless the lifetime it was made in is still the node's current one: a deactivation, a
 * replace and the node's end each close that lifetime, and a released node has none.
 */
export function nodePublishLater<T>(
	self: Node<T>,
	lifetime: AbortSignal,
	arrays: readonly Message[][],
	commitBound: boolean,
): void {
	const core = self[CORE];
	const send = () => {
		if (nodeLifetimeIsCurrent(self, lifetime)) nodePublish(self, arrays);
	};
	const batchToken = commitBound ? currentBoundaryBatchToken(core) : undefined;
	if (batchToken === undefined) request(core, send);
	else deferRequest(core, send, { batchToken });
}
