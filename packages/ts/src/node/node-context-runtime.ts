import { enterWave, exitWave } from "../batch/boundary.js";
import {
	CTX_DEP_CACHE,
	CTX_NODE_BINDING,
	type Ctx,
	type CtxState,
	type TerminalData,
	type WaveData,
} from "../ctx/types.js";
import type { PullDemand } from "../protocol/messages.js";
import type { Node } from "./node.js";
import type { NodeRuntimeHost } from "./node-runtime-host.js";
import { terminalView } from "./protocol-guards.js";
import { withEnvironmentDrivers, withNodeCore } from "./runtime-accessors.js";

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
		terminal: self._dep.terminalInput.map(terminalView),
		latest: [...self._dep.prev],
	});
}

export function nodeMakeCtx<T>(
	self: NodeRuntimeHost<T>,
	snapshot?: { waveData: unknown[][][]; terminal: unknown[]; latest: unknown[] },
): Ctx {
	const ctx: Ctx = {
		// Wave-owner boundary (D47): a SYNC fn's emit nests under the public entry that drove
		// it (cheap inc/dec, no early drain); an ASYNC-pool fn re-enters here from its stashed
		// ctx at depth 0, so this is the boundary that drains any rewireNext it issued.
		up: (msgs, towardDep) => {
			if (self._released) return;
			enterWave();
			try {
				self._up(msgs, towardDep);
			} finally {
				exitWave();
			}
		},
		down: (msgs) => {
			if (self._released) return;
			enterWave();
			try {
				self._down(msgs);
			} finally {
				exitWave();
			}
		},
		waveData: snapshot?.waveData ?? self._dep.waveData,
		terminal: snapshot?.terminal ?? self._dep.terminalInput.map(terminalView),
		state: self._makeState(),
		onDeactivation: (fn) => {
			if (self._released) return;
			self._hooks.onDeactivation.push(fn);
		},
		onInvalidate: (fn) => {
			if (self._released) return;
			self._hooks.onInvalidate.push(fn);
		},
		environment: () => self._slot.environment,
		// R-rewire-deferred (D47): defer a self-dep-set mutation to the committed boundary.
		rewireNext: {
			subscribeDep: (dep, fn) => self._requestRewireNext({ kind: "add", dep, fn }),
			unsubscribeDep: (dep, fn) => self._requestRewireNext({ kind: "remove", dep, fn }),
			replaceDeps: (deps, fn) => self._requestRewireNext({ kind: "set", deps, fn }),
		},
		// R-up-routing / R-pull (D269): deferred up — route a control/demand wave (e.g. PULL)
		// up the declared cone at the committed boundary. The SELF-demand path: an
		// immediate ctx.up whose delivery loops back re-enters this fn (D37 / R-reentrancy).
		upNext: (msgs, towardDep) => self._requestUpNext(msgs, towardDep),
		...(self._control.activePull === undefined ? {} : { pull: self._control.activePull }),
		[CTX_DEP_CACHE]: { latest: snapshot?.latest ?? self._dep.prev },
		[CTX_NODE_BINDING]: {
			dispatcher: self._slot.dispatcher,
			create: <U>(factory: () => Node<U>) =>
				withEnvironmentDrivers(self._slot.environment, () => withNodeCore(self._core, factory)),
		},
	};
	if (self._slot.dynamic) {
		// R-dynamic-node: read a dep's latest by index. Untracked deps still drive waves and
		// re-run the fn; under D49 (no equals-substitution) the fn re-emits its current value
		// as DATA — to suppress redundant downstream propagation, pair with distinctUntilChanged.
		ctx.track = (i: number) => ctx[CTX_DEP_CACHE]?.latest[i];
	}
	return ctx;
}

export function nodeRefreshCtx<T>(self: NodeRuntimeHost<T>, ctx: Ctx): void {
	(ctx as { waveData: WaveData }).waveData = self._dep.waveData;
	(ctx as { terminal: TerminalData }).terminal = self._dep.terminalInput.map(terminalView);
	if (self._control.activePull === undefined) {
		delete (ctx as { pull?: PullDemand }).pull;
	} else {
		(ctx as { pull?: PullDemand }).pull = self._control.activePull;
	}
	ctx[CTX_DEP_CACHE] = { latest: self._dep.prev };
}

export function nodeMakeState<T>(self: NodeRuntimeHost<T>): CtxState {
	return {
		get: <S>() => self._privateState.value as S | undefined,
		set: <S>(v: S) => {
			self._privateState.value = v;
		},
		persist: (on = true) => {
			self._privateState.persist = on;
		},
	};
}
