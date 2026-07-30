// packages/ts/runners/local-untrusted-js/runner.ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createContext, Script, SourceTextModule } from "node:vm";

// packages/ts/src/batch/boundary.ts
var depth = 0;
var pendingCores = [];
var pendingHead = 0;
function enterWave() {
  depth++;
}
function exitWave() {
  depth--;
  if (depth === 0 && pendingHead < pendingCores.length) drain();
}
function deferRewire(core, apply, options = {}) {
  core.enqueueBoundaryTask({ apply, batchToken: options.batchToken, isReady: options.isReady });
  pendingCores.push(core);
}
function scheduleBoundaryDrain(core) {
  for (let i = 0; i < core.boundaryTaskCount(); i++) pendingCores.push(core);
  if (depth === 0 && pendingHead < pendingCores.length) drain();
}
function dropBoundaryTasksForBatch(batchToken) {
  const seen = /* @__PURE__ */ new Set();
  for (let i = pendingHead; i < pendingCores.length; i++) {
    const core = pendingCores[i];
    if (seen.has(core)) continue;
    seen.add(core);
    core.dropBoundaryTasksForBatch(batchToken);
  }
}
function drain() {
  let escaped = null;
  while (pendingHead < pendingCores.length) {
    const core = pendingCores[pendingHead++];
    const task = core.shiftBoundaryTask();
    if (task === void 0) continue;
    if (task.batchToken !== void 0) {
      const committed = task.batchToken.committed === true;
      if (!committed) continue;
    }
    if (task.isReady !== void 0 && !task.isReady()) {
      core.unshiftBoundaryTask(task);
      continue;
    }
    depth++;
    try {
      task.apply();
    } catch (e) {
      if (escaped === null) escaped = { e };
    } finally {
      depth--;
    }
  }
  pendingCores.length = 0;
  pendingHead = 0;
  if (escaped !== null) throw escaped.e;
}

// packages/ts/src/batch/batch.ts
var active = null;
var boundaryOwner = null;
function currentBatch() {
  return active !== null;
}
function currentBoundaryBatchToken() {
  return active ?? boundaryOwner ?? void 0;
}
function deferToBatch(target, tier3Wave) {
  if (active === null) return false;
  if (!active.deferred.has(target)) active.order.push(target);
  active.deferred.set(target, tier3Wave);
  return true;
}
function deferAfterBatchForTarget(target, fn) {
  if (active === null || !active.deferred.has(target)) return false;
  const owner = active;
  target.__deferBoundary(() => {
    if (owner.committed) fn();
  }, owner);
  return true;
}
function commit(b) {
  const prev = boundaryOwner;
  boundaryOwner = b;
  try {
    for (const target of b.order) {
      const wave = b.deferred.get(target);
      if (wave) target.__commitBatchedWave(wave);
    }
    b.committed = true;
  } catch (e) {
    dropBoundaryTasksForBatch(b);
    throw e;
  } finally {
    boundaryOwner = prev;
  }
}
function rollback(b) {
  dropBoundaryTasksForBatch(b);
  for (const target of b.order) target.__rollbackBatched();
}
function batch(fn) {
  enterWave();
  try {
    if (active !== null) {
      const outer = active;
      return fn({
        rollback: () => {
          outer.rolledBack = true;
        }
      });
    }
    const b = { order: [], deferred: /* @__PURE__ */ new Map(), committed: false, rolledBack: false };
    active = b;
    const bctx = {
      rollback: () => {
        b.rolledBack = true;
      }
    };
    let result;
    try {
      result = fn(bctx);
    } catch (e) {
      active = null;
      rollback(b);
      throw e;
    }
    active = null;
    if (b.rolledBack) rollback(b);
    else {
      commit(b);
    }
    return result;
  } finally {
    exitWave();
  }
}

// packages/ts/src/protocol/messages.ts
var SENTINEL = void 0;
function isInvalidErrorPayload(v) {
  return v === SENTINEL || typeof v === "boolean";
}
function errorPayload(reason, fallback = "error without a valid payload") {
  return isInvalidErrorPayload(reason) ? new Error(fallback) : reason;
}
var TIER_START = 0;
var TIER_CONTROL = 1;
var TIER_NOTIFICATION = 2;
var TIER_VALUE = 3;
var TIER_SETTLE = 4;
var TIER_TERMINAL = 5;
var TIER_TEARDOWN = 6;
var TIER = {
  START: TIER_START,
  PAUSE: TIER_CONTROL,
  RESUME: TIER_CONTROL,
  PULL: TIER_CONTROL,
  DIRTY: TIER_NOTIFICATION,
  DATA: TIER_VALUE,
  RESOLVED: TIER_VALUE,
  INVALIDATE: TIER_SETTLE,
  COMPLETE: TIER_TERMINAL,
  ERROR: TIER_TERMINAL,
  TEARDOWN: TIER_TEARDOWN
};
function messageTier(t) {
  return TIER[t];
}
function isDeferredTier(t) {
  return TIER[t] >= TIER_VALUE;
}
function isValueTier(t) {
  return TIER[t] === TIER_VALUE;
}
function isPauseBufferedTier(t) {
  const tier = TIER[t];
  return tier === TIER_VALUE || tier === TIER_SETTLE;
}
function isTerminal(t) {
  return TIER[t] === TIER_TERMINAL;
}
function isUpAllowed(t) {
  const tier = TIER[t];
  return tier !== void 0 && tier !== TIER_START && tier !== TIER_VALUE && tier !== TIER_TERMINAL;
}

// packages/ts/src/ctx/types.ts
var CTX_DEP_CACHE = /* @__PURE__ */ Symbol.for("graphrefly.ctx.depCache");
var ctxDepWaveOrigins = /* @__PURE__ */ new WeakMap();
function setCtxDepWaveOrigin(ctx, origin) {
  ctxDepWaveOrigins.set(ctx, origin);
}
var CTX_NODE_BINDING = /* @__PURE__ */ Symbol("graphrefly.ctx.nodeBinding");
function depCount(ctx) {
  return ctx.waveData.length;
}
function depLatest(ctx, depIndex) {
  return ctx[CTX_DEP_CACHE]?.latest[depIndex];
}

// packages/ts/src/dispatcher/index.ts
var PoolTable = class {
  constructor(kind) {
    this.kind = kind;
  }
  kind;
  fns = [];
  free = [];
  register(fn) {
    const reused = this.free.pop();
    if (reused !== void 0) {
      this.fns[reused] = fn;
      return reused;
    }
    const id = this.fns.length;
    this.fns.push(fn);
    return id;
  }
  unregister(handleId) {
    if (this.fns[handleId] === void 0) return;
    this.fns[handleId] = void 0;
    this.free.push(handleId);
  }
  invoke(handleId, ctx) {
    this.fns[handleId](ctx);
  }
};
var dispatcherHandleStatKey = (h) => JSON.stringify([String(h.poolId), String(h.handleId)]);
var Dispatcher = class {
  pools = [];
  syncPoolId;
  asyncPoolId;
  // opt-in profile recorder (default OFF → zero overhead, F-PERF).
  _recording = false;
  _stats = /* @__PURE__ */ new Map();
  _totalInvokes = 0;
  constructor() {
    this.syncPoolId = this.addPool(new PoolTable("sync"));
    this.asyncPoolId = this.addPool(new PoolTable("async"));
  }
  /** Turn the profile recorder on/off (D39). Off = zero overhead on invoke. */
  setRecording(on) {
    this._recording = on;
  }
  /** Reset accumulated profiling counters. */
  clearStats() {
    this._stats.clear();
    this._totalInvokes = 0;
  }
  /** Read a handle's accumulated counters (undefined if it never ran while recording). */
  statFor(handle) {
    return this._stats.get(dispatcherHandleStatKey(handle));
  }
  /** Total fn invocations recorded across the dispatcher. */
  get totalInvokes() {
    return this._totalInvokes;
  }
  addPool(pool) {
    const id = this.pools.length;
    this.pools.push(pool);
    return id;
  }
  /** Register a fn in a pool, returning its Handle. Default pool = sync (R-sync-core). */
  register(fn, pool = "sync") {
    const poolId = pool === "sync" ? this.syncPoolId : pool === "async" ? this.asyncPoolId : pool;
    const handleId = this.pools[poolId].register(fn);
    return { poolId, handleId };
  }
  /**
   * Release a handle (B15): frees the pool slot (closure GC'd, id reusable) and drops any
   * accumulated profile stat so a reused id never inherits the previous tenant's counters.
   * Called on rewire fn-swap (node._rewire) — the old handle is dropped before the node
   * adopts the new one. Idempotent. NOT called on deactivate (a node's handle survives
   * activate↔deactivate and is reused on reactivation; only a rewire swaps it).
   */
  unregister(handle) {
    this.pools[handle.poolId].unregister(handle.handleId);
    this._stats.delete(dispatcherHandleStatKey(handle));
  }
  /** Uniform sync-void invoke (R-sync-core / R-dispatch-all). */
  invoke(handle, ctx) {
    if (!this._recording) {
      this.pools[handle.poolId].invoke(handle.handleId, ctx);
      return;
    }
    this._totalInvokes++;
    const t0 = performance.now();
    try {
      this.pools[handle.poolId].invoke(handle.handleId, ctx);
    } finally {
      const dur = (performance.now() - t0) * 1e6;
      const key = dispatcherHandleStatKey(handle);
      const s = this._stats.get(key) ?? {
        invokes: 0,
        totalDurationNs: 0,
        lastDurationNs: 0
      };
      s.invokes++;
      s.lastDurationNs = dur;
      s.totalDurationNs += dur;
      this._stats.set(key, s);
    }
  }
  poolKind(poolId) {
    return this.pools[poolId].kind;
  }
};
var defaultDispatcher = new Dispatcher();

// packages/ts/src/node/core.ts
var NodeCore = class {
  nextId = 0;
  slots = [];
  values = [];
  waves = [];
  controls = [];
  lifecycles = [];
  depStates = [];
  privateStates = [];
  hooks = [];
  syncCtxs = [];
  versionStates = [];
  boundary = { queue: [], head: 0 };
  createSlot(slot, state) {
    const id = this.nextId++;
    const full = { ...slot, id };
    this.slots[id] = full;
    this.depStates[id] = state.dep;
    this.lifecycles[id] = state.lifecycle;
    this.values[id] = state.value;
    this.waves[id] = state.wave;
    this.controls[id] = state.control;
    this.privateStates[id] = state.privateState;
    this.hooks[id] = state.hooks;
    this.syncCtxs[id] = state.syncCtx;
    this.versionStates[id] = state.version;
    return { id, slot: full };
  }
  get(id) {
    const slot = this.slots[id];
    if (slot === void 0) throw new Error("NodeCore: unknown node slot");
    return slot;
  }
  getValue(id) {
    const value = this.values[id];
    if (value === void 0) throw new Error("NodeCore: unknown node value state");
    return value;
  }
  getWave(id) {
    const wave = this.waves[id];
    if (wave === void 0) throw new Error("NodeCore: unknown node wave state");
    return wave;
  }
  getControl(id) {
    const control = this.controls[id];
    if (control === void 0) throw new Error("NodeCore: unknown node control state");
    return control;
  }
  getLifecycle(id) {
    const lifecycle = this.lifecycles[id];
    if (lifecycle === void 0) throw new Error("NodeCore: unknown node lifecycle state");
    return lifecycle;
  }
  getDep(id) {
    const dep = this.depStates[id];
    if (dep === void 0) throw new Error("NodeCore: unknown node dep state");
    return dep;
  }
  getPrivateState(id) {
    const state = this.privateStates[id];
    if (state === void 0) throw new Error("NodeCore: unknown node private state");
    return state;
  }
  getHooks(id) {
    const hooks = this.hooks[id];
    if (hooks === void 0) throw new Error("NodeCore: unknown node cleanup hooks");
    return hooks;
  }
  getSyncCtx(id) {
    const state = this.syncCtxs[id];
    if (state === void 0) throw new Error("NodeCore: unknown node ctx state");
    return state;
  }
  getVersion(id) {
    const state = this.versionStates[id];
    if (state === void 0) throw new Error("NodeCore: unknown node version state");
    return state;
  }
  /** @internal D122: release graph-owned ephemeral node runtime state from core retention. */
  releaseSlot(id) {
    this.slots[id] = void 0;
    this.depStates[id] = void 0;
    this.lifecycles[id] = void 0;
    this.values[id] = void 0;
    this.waves[id] = void 0;
    this.controls[id] = void 0;
    this.privateStates[id] = void 0;
    this.hooks[id] = void 0;
    this.syncCtxs[id] = void 0;
    this.versionStates[id] = void 0;
  }
  /** @internal B49: graph-local deferred-boundary queue (rewireNext/upNext/batch-after-commit). */
  enqueueBoundaryTask(task) {
    this.boundary.queue.push(task);
  }
  /** @internal */
  hasBoundaryTasks() {
    return this.boundary.head < this.boundary.queue.length;
  }
  /** @internal */
  boundaryTaskCount() {
    return this.boundary.queue.length - this.boundary.head;
  }
  /** @internal */
  shiftBoundaryTask() {
    if (!this.hasBoundaryTasks()) {
      this.boundary.queue = [];
      this.boundary.head = 0;
      return void 0;
    }
    const task = this.boundary.queue[this.boundary.head++];
    if (!this.hasBoundaryTasks()) {
      this.boundary.queue = [];
      this.boundary.head = 0;
    }
    return task;
  }
  /** @internal Put a not-yet-ready task back at this core's FIFO head. */
  unshiftBoundaryTask(task) {
    const remaining = this.boundary.queue.slice(this.boundary.head);
    this.boundary.queue = [task, ...remaining];
    this.boundary.head = 0;
  }
  /** @internal D110: discard all pending tasks caused by an uncommitted batch. */
  dropBoundaryTasksForBatch(batchToken) {
    const remaining = this.boundary.queue.slice(this.boundary.head).filter((task) => task.batchToken !== batchToken);
    this.boundary.queue = remaining;
    this.boundary.head = 0;
  }
};
function makeDepBookkeeping(depCount2) {
  return {
    batch: new Array(depCount2).fill(null),
    waveData: Array.from({ length: depCount2 }, () => []),
    waveTokens: new Array(depCount2).fill(void 0),
    waveLive: Array.from({ length: depCount2 }, () => []),
    prev: new Array(depCount2).fill(SENTINEL),
    hasData: new Array(depCount2).fill(false),
    dirty: new Array(depCount2).fill(false),
    tier: new Array(depCount2).fill(0),
    terminal: new Array(depCount2).fill(void 0),
    terminalInput: new Array(depCount2).fill(void 0),
    unsubs: [],
    idxBoxes: []
  };
}

// packages/ts/src/graph/environment.ts
var EnvironmentDrivers = class _EnvironmentDrivers {
  process;
  http;
  sse;
  websocket;
  webhook;
  constructor(init = {}) {
    this.process = init.process;
    this.http = init.http;
    this.sse = init.sse;
    this.websocket = init.websocket;
    this.webhook = init.webhook;
    Object.freeze(this);
  }
  static empty() {
    return EMPTY_ENVIRONMENT;
  }
  withProcess(driver) {
    return new _EnvironmentDrivers({ ...this, process: driver });
  }
  withHttp(driver) {
    return new _EnvironmentDrivers({ ...this, http: driver });
  }
  withSse(driver) {
    return new _EnvironmentDrivers({ ...this, sse: driver });
  }
  withWebSocket(driver) {
    return new _EnvironmentDrivers({ ...this, websocket: driver });
  }
  withWebhook(driver) {
    return new _EnvironmentDrivers({ ...this, webhook: driver });
  }
  processDriver() {
    return this.process;
  }
  httpDriver() {
    return this.http;
  }
  sseDriver() {
    return this.sse;
  }
  webSocketDriver() {
    return this.websocket;
  }
  webhookDriver() {
    return this.webhook;
  }
};
var EMPTY_ENVIRONMENT = new EnvironmentDrivers();

// packages/ts/src/node/protocol-guards.ts
function terminalView(t) {
  return t === void 0 ? false : t;
}
function normalizePullDemand(demand) {
  if (typeof demand !== "object" || demand === null || Array.isArray(demand)) {
    throw new Error("ctx.up: PULL requires { pullId, params? } demand payload (D269)");
  }
  const pullId = demand.pullId;
  if (typeof pullId !== "string" && typeof pullId !== "symbol") {
    throw new Error("ctx.up: PULL demand requires a string or symbol pullId (D269)");
  }
  const params = demand.params;
  return params === void 0 ? { pullId } : { pullId, params };
}
function validateDownPayloads(msgs) {
  for (const m of msgs) {
    if (messageTier(m[0]) === void 0) {
      throw new Error(
        `down: ${String(m[0])} is not in the closed message-type set (R-msg-closed-set)`
      );
    }
    if (m[0] === "DATA" && m[1] === void 0) {
      throw new Error("down: DATA requires a non-SENTINEL payload (R-data-payload)");
    }
    if (m[0] === "ERROR" && isInvalidErrorPayload(m[1])) {
      throw new Error("down: ERROR requires a non-SENTINEL, non-boolean payload (R-data-payload)");
    }
  }
}

// packages/ts/src/node/runtime-accessors.ts
var constructingCore;
var constructingEnvironment;
var ownerTokens = /* @__PURE__ */ new WeakMap();
var topologyDepsChangedObservers = /* @__PURE__ */ new WeakMap();
var checkpointReaders = /* @__PURE__ */ new WeakMap();
var restoreWriters = /* @__PURE__ */ new WeakMap();
var runtimeReleasers = /* @__PURE__ */ new WeakMap();
var runtimeQuiescenceReaders = /* @__PURE__ */ new WeakMap();
var subscriberCountReaders = /* @__PURE__ */ new WeakMap();
var activationReaders = /* @__PURE__ */ new WeakMap();
var releasedNodes = /* @__PURE__ */ new WeakSet();
function withNodeCore(core, create) {
  const prev = constructingCore;
  constructingCore = core;
  try {
    return create();
  } finally {
    constructingCore = prev;
  }
}
function takeConstructingNodeCore() {
  const core = constructingCore;
  constructingCore = void 0;
  return core;
}
function withEnvironmentDrivers(environment, create) {
  const prev = constructingEnvironment;
  constructingEnvironment = environment;
  try {
    return create();
  } finally {
    constructingEnvironment = prev;
  }
}
function takeConstructingEnvironmentDrivers() {
  const environment = constructingEnvironment;
  constructingEnvironment = void 0;
  return environment;
}
function getNodeOwner(n) {
  return ownerTokens.get(n);
}
function setNodeOwner(n, owner) {
  ownerTokens.set(n, owner);
}
function setNodeTopologyDepsChangedObserver(n, observer) {
  topologyDepsChangedObservers.set(n, observer);
}
function notifyTopologyDepsChanged(node, prevDeps, deps) {
  topologyDepsChangedObservers.get(node)?.(node, prevDeps, deps);
}
function checkpointStateOfNode(n) {
  const read = checkpointReaders.get(n);
  if (read === void 0) throw new Error("checkpoint: unknown node state");
  return read();
}
function releaseRuntimeOfNode(n) {
  runtimeReleasers.get(n)?.();
}
function isNodeRuntimeQuiescentForRelease(n) {
  return runtimeQuiescenceReaders.get(n)?.() ?? false;
}
function subscriberCountOfNode(n) {
  return subscriberCountReaders.get(n)?.() ?? 0;
}
function isNodeActiveForRelease(n) {
  return activationReaders.get(n)?.() ?? false;
}
function isNodeRuntimeReleased(n) {
  return releasedNodes.has(n);
}

// packages/ts/src/node/node-context-runtime.ts
function nodeBuildCtx(self) {
  const kind = self._slot.handle ? self._slot.dispatcher.poolKind(self._slot.handle.poolId) : "sync";
  if (kind === "sync") {
    if (self._syncCtx === null) self._syncCtx = self._makeCtx();
    self._refreshCtx(self._syncCtx);
    return self._syncCtx;
  }
  return self._makeCtx({
    waveData: self._dep.waveData.map((waves) => waves.map((w) => [...w])),
    waveLive: self._dep.waveLive.map((waves) => [...waves]),
    terminal: self._dep.terminalInput.map(terminalView),
    latest: [...self._dep.prev]
  });
}
function nodeMakeCtx(self, snapshot) {
  const ctx = {
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
      replaceDeps: (deps, fn) => self._requestRewireNext({ kind: "set", deps, fn })
    },
    // R-up-routing / R-pull (D269): deferred up — route a control/demand wave (e.g. PULL)
    // up the declared cone at the committed boundary. The SELF-demand path: an
    // immediate ctx.up whose delivery loops back re-enters this fn (D37 / R-reentrancy).
    upNext: (msgs, towardDep) => self._requestUpNext(msgs, towardDep),
    ...self._control.activePull === void 0 ? {} : { pull: self._control.activePull },
    [CTX_DEP_CACHE]: { latest: snapshot?.latest ?? self._dep.prev },
    [CTX_NODE_BINDING]: {
      dispatcher: self._slot.dispatcher,
      create: (factory) => withEnvironmentDrivers(self._slot.environment, () => withNodeCore(self._core, factory))
    }
  };
  setCtxDepWaveOrigin(ctx, { live: snapshot?.waveLive ?? self._dep.waveLive });
  if (self._slot.dynamic) {
    ctx.track = (i) => ctx[CTX_DEP_CACHE]?.latest[i];
  }
  return ctx;
}
function nodeRefreshCtx(self, ctx) {
  ctx.waveData = self._dep.waveData;
  ctx.terminal = self._dep.terminalInput.map(terminalView);
  if (self._control.activePull === void 0) {
    delete ctx.pull;
  } else {
    ctx.pull = self._control.activePull;
  }
  ctx[CTX_DEP_CACHE] = { latest: self._dep.prev };
  setCtxDepWaveOrigin(ctx, { live: self._dep.waveLive });
}
function nodeMakeState(self) {
  return {
    get: () => self._privateState.value,
    set: (v) => {
      self._privateState.value = v;
    },
    persist: (on = true) => {
      self._privateState.persist = on;
    }
  };
}

// packages/ts/src/node/node-input-runtime.ts
function nodeRecordDepProjection(self, idx, delivery) {
  const token = delivery?.wave ?? {};
  if (self._dep.waveTokens[idx] !== token) {
    self._dep.waveData[idx].push([]);
    self._dep.waveLive[idx].push(delivery !== void 0);
    self._dep.waveTokens[idx] = token;
  }
  return self._dep.waveData[idx][self._dep.waveData[idx].length - 1];
}
function nodeDepProjectionHasData(self, idx) {
  const projection = self._dep.waveData[idx][self._dep.waveData[idx].length - 1];
  return projection?.some((v) => v !== SENTINEL) ?? false;
}
function nodeReceiveFromDep(self, idx, msg, delivery) {
  if (self._released) return;
  const t = msg[0];
  if (t === "START") return;
  const isLastInDeliveredWave = delivery?.last ?? true;
  if (self._value.terminal !== void 0) {
    if (t === "TEARDOWN") self._down([["TEARDOWN"]]);
    return;
  }
  if (t === "INVALIDATE") {
    const projection = self._recordDepProjection(idx, delivery);
    projection.push(SENTINEL);
    if (projection.some((v) => v !== SENTINEL) && isLastInDeliveredWave) self._maybeRun();
    self._dep.prev[idx] = SENTINEL;
    self._dep.hasData[idx] = false;
    self._dep.batch[idx] = null;
    if (self._dep.dirty[idx]) {
      self._dep.dirty[idx] = false;
      self._wave.pending--;
    }
    if (self._control.pausedDepWaveOccurred && self._dep.batch.every((b) => b === null)) {
      self._control.pausedDepWaveOccurred = false;
    }
    const hadData = self._value.hasData;
    self._invalidate();
    if (self._wave.pending === 0 && self._wave.emittedDirtyThisWave) {
      if (!hadData) self._down([["RESOLVED"]]);
      else self._wave.emittedDirtyThisWave = false;
    }
    self._fireOwedDemandIfReady();
    return;
  }
  if (isTerminal(t)) {
    const isError = t === "ERROR";
    const errPayload = isError ? msg[1] : void 0;
    self._dep.terminal[idx] = isError ? errPayload : true;
    self._dep.terminalInput[idx] = isError ? errPayload : true;
    self._releaseDepDirty(idx);
    const ranValueBeforeTerminal = self._depProjectionHasData(idx) && isLastInDeliveredWave;
    if (ranValueBeforeTerminal) self._maybeRun();
    if (isError && self._slot.errorWhenDepsError) {
      self._down([["ERROR", errPayload]]);
    } else if (self._slot.terminalAsRealInput) {
      if (ranValueBeforeTerminal) {
        self._fireOwedDemandIfReady();
        return;
      }
      self._maybeRun();
    } else if (self._slot.completeWhenDepsComplete && self._allDepsTerminal()) {
      self._down([["COMPLETE"]]);
    } else {
      self._settleAfterAbsorbedTerminal();
    }
    self._fireOwedDemandIfReady();
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
    self._fireOwedDemandIfReady();
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
    self._fireOwedDemandIfReady();
    return;
  }
}
function nodeReleaseDepDirty(self, idx) {
  if (self._dep.dirty[idx]) {
    self._dep.dirty[idx] = false;
    self._wave.pending--;
  }
}
function nodeSettleAfterAbsorbedTerminal(self) {
  if (self._wave.pending !== 0 || !self._wave.emittedDirtyThisWave) return;
  const sawData = self._dep.batch.some((b) => b !== null && b.length > 0);
  if (sawData) self._maybeRun();
  if (self._wave.emittedDirtyThisWave) self._down([["RESOLVED"]]);
}
function nodeMarkDirty(self) {
  self._value.status = "dirty";
  if (self._isPullQuiet()) return;
  if (!self._wave.emittedDirtyThisWave) {
    self._wave.emittedDirtyThisWave = true;
    self._emitToSubs(["DIRTY"]);
  }
}
function nodeMaybeRun(self) {
  if (self._wave.inDepMutation) {
    self._wave.rewireRunPending = true;
    return;
  }
  if (self._slot.pausable === true && (self._isPaused() || self._isPullQuiet())) {
    self._control.pausedDepWaveOccurred = true;
    return;
  }
  self._tryRun();
}
function nodeSettleRewire(self) {
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
  self._markDirty();
  self._runWave();
}
function nodeTryRun(self) {
  if (self._wave.pending > 0) return;
  if (self._slot.handle === null) {
    self._passthroughEmit();
    return;
  }
  if (!self._wave.hasCalledFnOnce) {
    if (self._slot.partial || self._allDepsSettled()) self._runWave();
    return;
  }
  self._runWave();
}
function nodeAllDepsSettled(self) {
  for (let i = 0; i < self._slot.deps.length; i++) {
    if (self._dep.hasData[i]) continue;
    if (self._slot.terminalAsRealInput && self._dep.terminal[i] !== void 0) continue;
    return false;
  }
  return true;
}
function nodePassthroughEmit(self) {
  const b = self._dep.batch[0];
  if (b !== null && b.length > 0) {
    self._down([["DATA", b[b.length - 1]]]);
  } else if (self._wave.emittedDirtyThisWave) {
    self._down([["RESOLVED"]]);
  }
  self._dep.batch[0] = null;
  self._wave.emittedDirtyThisWave = false;
}
function nodeRunWave(self) {
  if (self._wave.insideRunWave)
    throw new Error(
      "synchronous feedback cycle: node fn re-entered its own wave (R-reentrancy / D37)"
    );
  self._wave.hasCalledFnOnce = true;
  self._hooks.onInvalidate = [];
  self._hooks.onDeactivation = [];
  const ctx = self._buildCtx();
  const wasDirty = self._wave.emittedDirtyThisWave;
  self._wave.emittedSettleThisWave = false;
  self._wave.insideRunWave = true;
  try {
    self._slot.dispatcher.invoke(self._slot.handle, ctx);
  } finally {
    self._wave.insideRunWave = false;
  }
  if (wasDirty && !self._wave.emittedSettleThisWave && self._value.terminal === void 0 && !self._isAsyncPool()) {
    self._down([["RESOLVED"]]);
  }
  for (let i = 0; i < self._dep.batch.length; i++) {
    self._dep.batch[i] = null;
    self._dep.waveData[i] = [];
    self._dep.waveTokens[i] = void 0;
    self._dep.waveLive[i] = [];
    self._dep.terminalInput[i] = void 0;
  }
  self._wave.emittedDirtyThisWave = false;
}

// packages/ts/src/node/node-runtime-host.ts
function nodeRuntimeHost(node) {
  return node;
}

// packages/ts/src/node/node-lifecycle-runtime.ts
function nodeActivate(self) {
  self._lifecycle.activated = true;
  const seedRestoredDeps = self._restoredActivationPending;
  self._restoredActivationPending = false;
  self._dep.unsubs = new Array(self._slot.deps.length);
  self._dep.idxBoxes = new Array(self._slot.deps.length);
  for (const dep of self._slot.deps) self._subscribeDepAt(dep, { seedRestored: seedRestoredDeps });
  if (self._slot.deps.length === 0 && self._slot.handle !== null && !self._wave.hasCalledFnOnce) {
    self._runWave();
  }
}
function nodeSubscribeDepAt(self, depNode, opts = {}) {
  const idx0 = self._slot.deps.indexOf(depNode);
  const box = { v: idx0 };
  let ignoreInitialPush = opts.seedRestored === true;
  if (ignoreInitialPush && idx0 !== -1) {
    self._seedRestoredDepAt(idx0, depNode);
    const dep = nodeRuntimeHost(depNode);
    if (dep._value.terminal !== void 0 && !dep._slot.resubscribable) {
      self._dep.unsubs[idx0] = () => {
      };
      self._dep.idxBoxes[idx0] = box;
      return;
    }
  }
  const unsub = depNode.subscribe((msg, delivery) => {
    if (ignoreInitialPush && delivery === void 0) return;
    if (ignoreInitialPush) ignoreInitialPush = false;
    if (box.v === -1) return;
    self._receiveFromDep(box.v, msg, delivery);
  });
  if (ignoreInitialPush && idx0 !== -1 && box.v !== -1) self._seedRestoredDepAt(idx0, depNode);
  ignoreInitialPush = false;
  if (idx0 !== -1) {
    self._dep.unsubs[idx0] = unsub;
    self._dep.idxBoxes[idx0] = box;
  }
}
function nodeSeedRestoredDepAt(self, idx, depNode) {
  const dep = nodeRuntimeHost(depNode);
  const seedData = dep._value.hasData && !dep._slot.pull;
  self._dep.batch[idx] = null;
  self._dep.waveData[idx] = [];
  self._dep.waveTokens[idx] = void 0;
  self._dep.waveLive[idx] = [];
  self._dep.prev[idx] = seedData ? dep._value.cache : SENTINEL;
  self._dep.hasData[idx] = seedData;
  self._dep.dirty[idx] = false;
  self._dep.tier[idx] = seedData ? 3 : 0;
  self._dep.terminal[idx] = dep._value.terminal;
  self._dep.terminalInput[idx] = void 0;
}
function nodeDeactivate(self) {
  self._lifecycle.activated = false;
  for (const u of self._dep.unsubs) if (u) u();
  self._dep.unsubs = [];
  self._dep.idxBoxes = [];
  for (const fn of self._hooks.onDeactivation) fn();
  self._hooks.onDeactivation = [];
  self._hooks.onInvalidate = [];
  const isCompute = self._slot.handle !== null || self._slot.deps.length > 0;
  if (isCompute) {
    self._value.cache = SENTINEL;
    self._value.hasData = false;
    self._value.status = "sentinel";
  }
  self._resetDepState();
  self._wave.hasCalledFnOnce = false;
  self._control.pauseLockset.clear();
  self._control.pauseBuffer = [];
  self._control.pausedDepWaveOccurred = false;
  self._control.demandOwed = void 0;
  self._control.activePull = void 0;
  self._control.pullDirtyOwed = false;
  self._value.replayRing = [];
  if (!self._privateState.persist) self._privateState.value = SENTINEL;
}
function nodeSubscriberCount(self) {
  return self._lifecycle.subscribers.size;
}
function nodeIsRuntimeQuiescentForRelease(self) {
  return !self._released && self._value.status !== "dirty" && self._value.status !== "pending" && self._wave.pending === 0 && !self._wave.insideRunWave && !self._wave.inDepMutation && !self._wave.rewireRunPending && !self._wave.batchDirtyOwed && self._dep.dirty.every((dirty) => !dirty) && self._control.pauseBuffer.length === 0 && !self._control.pausedDepWaveOccurred && self._control.demandOwed === void 0 && self._control.activePull === void 0 && !self._control.inDeliverDemand && self._control.pauseLockset.size === 0;
}
function nodeReleaseRuntime(self) {
  if (self._released) return;
  self._released = true;
  const node = self;
  releasedNodes.add(node);
  let releaseError;
  const recordReleaseError = (error) => {
    if (releaseError === void 0) releaseError = error;
  };
  self._lifecycle.activated = false;
  for (const u of self._dep.unsubs) {
    try {
      u();
    } catch (error) {
      recordReleaseError(error);
    }
  }
  for (const fn of self._hooks.onDeactivation) {
    try {
      fn();
    } catch (error) {
      recordReleaseError(error);
    }
  }
  self._dep.unsubs = [];
  self._dep.idxBoxes = [];
  self._lifecycle.subscribers.clear();
  if (self._slot.handle !== null) {
    self._slot.dispatcher.unregister(self._slot.handle);
    self._slot.handle = null;
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
  self._value.status = "sentinel";
  self._value.terminal = void 0;
  self._value.replayRing = [];
  self._privateState.value = SENTINEL;
  self._privateState.persist = false;
  self._syncCtx = null;
  self._resetDepState();
  self._hooks.onDeactivation = [];
  self._hooks.onInvalidate = [];
  self._control.pauseLockset.clear();
  self._control.pauseBuffer = [];
  self._control.pausedDepWaveOccurred = false;
  self._control.demandOwed = void 0;
  self._control.activePull = void 0;
  self._control.pullDirtyOwed = false;
  self._restoredActivationPending = false;
  checkpointReaders.delete(node);
  restoreWriters.delete(node);
  runtimeReleasers.delete(node);
  runtimeQuiescenceReaders.delete(node);
  subscriberCountReaders.delete(node);
  activationReaders.delete(node);
  ownerTokens.delete(node);
  topologyDepsChangedObservers.delete(node);
  self._core.releaseSlot(self._id);
  if (releaseError !== void 0) throw releaseError;
}
function nodeResetDepState(self) {
  const n = self._slot.deps.length;
  for (let i = 0; i < n; i++) {
    self._dep.batch[i] = null;
    self._dep.waveData[i] = [];
    self._dep.waveTokens[i] = void 0;
    self._dep.waveLive[i] = [];
    self._dep.prev[i] = SENTINEL;
    self._dep.hasData[i] = false;
    self._dep.dirty[i] = false;
    self._dep.tier[i] = 0;
    self._dep.terminal[i] = void 0;
    self._dep.terminalInput[i] = void 0;
  }
  self._wave.pending = 0;
  self._wave.emittedDirtyThisWave = false;
}

// packages/ts/src/json/codec.ts
var JS_MIN_NORMAL_NUMBER = 2 ** -1022;
function deepFreezeStrictJson(value) {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const item of value) deepFreezeStrictJson(item);
    } else {
      for (const item of Object.values(value)) deepFreezeStrictJson(item);
    }
    Object.freeze(value);
  }
  return value;
}
function assertStableJsonNumber(value, path) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`stableJsonString: non-finite number at ${path}`);
  }
}
function assertStrictJsonNumber(value, path) {
  assertStableJsonNumber(value, path);
  if (Object.is(value, -0)) {
    throw new TypeError(`stableJsonString: non-canonical number at ${path}`);
  }
  const abs = Math.abs(value);
  if (abs > 0 && abs < JS_MIN_NORMAL_NUMBER) {
    throw new TypeError(`stableJsonString: subnormal number at ${path}`);
  }
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new TypeError(`stableJsonString: integer outside safe range at ${path}`);
  }
}
function sortedJsonValue(value, seen = /* @__PURE__ */ new Set(), path = "$", strictNumbers = false) {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (strictNumbers) assertStrictJsonNumber(value, path);
    else assertStableJsonNumber(value, path);
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError(`stableJsonString: value at ${path} is not JSON-encodable`);
  }
  if (seen.has(value)) throw new TypeError(`stableJsonString: circular reference at ${path}`);
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    throw new TypeError(`stableJsonString: non-plain object at ${path}`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError(`stableJsonString: symbol-keyed properties at ${path}`);
      }
      for (const key of Object.getOwnPropertyNames(value)) {
        const isIndex = /^(0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(Number(key)) && Number(key) < value.length;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor !== void 0 && ("get" in descriptor || "set" in descriptor)) {
          throw new TypeError(`stableJsonString: accessor property at ${path}.${key}`);
        }
        if (key !== "length" && !isIndex) {
          throw new TypeError(`stableJsonString: non-index array property at ${path}.${key}`);
        }
        if (key !== "length" && descriptor !== void 0 && !descriptor.enumerable) {
          throw new TypeError(`stableJsonString: non-enumerable array property at ${path}.${key}`);
        }
      }
      const out2 = [];
      for (let i = 0; i < value.length; i += 1) {
        if (!(i in value)) {
          throw new TypeError(`stableJsonString: sparse array hole at ${path}[${i}]`);
        }
        out2.push(sortedJsonValue(value[i], seen, `${path}[${i}]`, strictNumbers));
      }
      return out2;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`stableJsonString: symbol-keyed properties at ${path}`);
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor !== void 0 && ("get" in descriptor || "set" in descriptor)) {
        throw new TypeError(`stableJsonString: accessor property at ${path}.${key}`);
      }
      if (descriptor !== void 0 && !descriptor.enumerable) {
        throw new TypeError(`stableJsonString: non-enumerable property at ${path}.${key}`);
      }
    }
    const out = /* @__PURE__ */ Object.create(null);
    for (const key of Object.keys(value).sort()) {
      out[key] = sortedJsonValue(
        value[key],
        seen,
        `${path}.${key}`,
        strictNumbers
      );
    }
    return out;
  } finally {
    seen.delete(value);
  }
}
function stableJsonString(value) {
  return JSON.stringify(sortedJsonValue(value));
}
function strictStableJsonString(value) {
  return JSON.stringify(cloneStrictJsonValue(value));
}
function jsonCodecFor() {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    encode(value) {
      return encoder.encode(stableJsonString(value));
    },
    decode(bytes) {
      return JSON.parse(decoder.decode(bytes));
    }
  };
}
var jsonCodec = jsonCodecFor();
function bytesEqual(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function hasUnpairedSurrogate(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(i + 1);
      if (next >= 56320 && next <= 57343) {
        i += 1;
        continue;
      }
      return true;
    }
    if (code >= 56320 && code <= 57343) return true;
  }
  return false;
}
function assertNoUnpairedSurrogates(value, seen = /* @__PURE__ */ new Set(), path = "$") {
  if (typeof value === "string") {
    if (hasUnpairedSurrogate(value)) {
      throw new TypeError(`strictJsonCodec: unpaired surrogate at ${path}`);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (descriptor === void 0 || "get" in descriptor || "set" in descriptor) continue;
        assertNoUnpairedSurrogates(descriptor.value, seen, `${path}[${i}]`);
      }
      return;
    }
    for (const key of Object.keys(value)) {
      if (hasUnpairedSurrogate(key)) {
        throw new TypeError(`strictJsonCodec: unpaired surrogate at ${path}.${key}`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === void 0 || "get" in descriptor || "set" in descriptor) continue;
      assertNoUnpairedSurrogates(descriptor.value, seen, `${path}.${key}`);
    }
  } finally {
    seen.delete(value);
  }
}
function strictJsonDataErrorsInner(value, label, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string" && hasUnpairedSurrogate(value)) {
      return { errors: [`${label} must not contain unpaired surrogate strings`] };
    }
    return { errors: [], value };
  }
  if (typeof value === "number") {
    try {
      assertStrictJsonNumber(value, label);
    } catch (error) {
      return { errors: [error instanceof Error ? error.message : String(error)] };
    }
    return { errors: [], value };
  }
  if (typeof value !== "object") {
    return { errors: [`${label} is not JSON-encodable`] };
  }
  if (seen.has(value)) return { errors: [`${label} must not contain circular references`] };
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    return { errors: [`stableJsonString: non-plain object at ${label}`] };
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const errors2 = [];
      if (Object.getOwnPropertySymbols(value).length > 0) {
        errors2.push(`${label} must not carry symbol keys`);
      }
      for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === void 0) continue;
        const isIndex = /^(0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(Number(key)) && Number(key) < value.length;
        if ("get" in descriptor || "set" in descriptor) {
          errors2.push(`${label}.${key} must be a data property`);
        }
        if (key !== "length" && !isIndex) {
          errors2.push(`${label}.${key} must be an indexed data property`);
        }
        if (key !== "length" && isIndex && !descriptor.enumerable) {
          errors2.push(`${label}.${key} must be enumerable`);
        }
      }
      const out2 = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === void 0) {
          errors2.push(`stableJsonString: sparse array hole at ${label}[${index}]`);
          continue;
        }
        if ("get" in descriptor || "set" in descriptor) {
          errors2.push(`${label}[${index}] must be a data property`);
          continue;
        }
        if (!descriptor.enumerable) {
          errors2.push(`${label}[${index}] must be enumerable`);
          continue;
        }
        const nested = strictJsonDataErrorsInner(descriptor.value, `${label}[${index}]`, seen);
        errors2.push(...nested.errors);
        if (nested.errors.length === 0 && nested.value !== void 0) out2.push(nested.value);
      }
      if (errors2.length > 0) return { errors: errors2 };
      return { errors: [], value: Object.freeze(out2) };
    }
    const errors = [];
    if (Object.getOwnPropertySymbols(value).length > 0) {
      errors.push(`${label} must not carry symbol keys`);
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === void 0) continue;
      if ("get" in descriptor || "set" in descriptor) {
        errors.push(`${label}.${key} must be a data property`);
      }
      if (!descriptor.enumerable) {
        errors.push(`${label}.${key} must be enumerable`);
      }
      if (hasUnpairedSurrogate(key)) {
        errors.push(`${label}.${key} must not contain unpaired surrogate keys`);
      }
    }
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === void 0 || "get" in descriptor || "set" in descriptor) continue;
      const nested = strictJsonDataErrorsInner(descriptor.value, `${label}.${key}`, seen);
      errors.push(...nested.errors);
      if (nested.errors.length === 0 && nested.value !== void 0) {
        Object.defineProperty(out, key, {
          value: nested.value,
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
    }
    if (errors.length > 0) return { errors };
    return { errors: [], value: Object.freeze(out) };
  } finally {
    seen.delete(value);
  }
}
function cloneStrictJsonValue(value, label = "strictJsonValue") {
  const result = strictJsonDataErrorsInner(value, label, /* @__PURE__ */ new Set());
  if (result.errors.length > 0 || result.value === void 0) {
    throw new TypeError(`${label}: ${result.errors.join("; ")}`);
  }
  return deepFreezeStrictJson(result.value);
}
function cloneStrictJsonObject(value, label = "strictJsonObject") {
  const cloned = cloneStrictJsonValue(value, label);
  if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
    throw new TypeError(`${label}: value must be a strict JSON object`);
  }
  return cloned;
}
function assertNoDuplicateJsonObjectKeys(text) {
  let index = 0;
  function fail(message) {
    throw new TypeError(`strictJsonCodec: ${message}`);
  }
  function skipWhitespace() {
    while (/\s/.test(text[index] ?? "")) index += 1;
  }
  function readJsonString() {
    const start = index;
    index += 1;
    while (index < text.length) {
      const ch = text[index];
      if (ch === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          fail("malformed JSON string");
        }
      }
      if (ch === "\\") {
        index += 2;
        continue;
      }
      index += 1;
    }
    fail("unterminated JSON string");
  }
  function consumeLiteral(literal) {
    if (text.slice(index, index + literal.length) !== literal) {
      fail(`malformed JSON near byte ${index}`);
    }
    index += literal.length;
  }
  function consumeNumber() {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(index));
    if (!match) fail(`malformed JSON number near byte ${index}`);
    index += match[0].length;
  }
  function parseValue(path) {
    skipWhitespace();
    const ch = text[index];
    if (ch === "{") {
      parseObject(path);
      return;
    }
    if (ch === "[") {
      parseArray(path);
      return;
    }
    if (ch === '"') {
      readJsonString();
      return;
    }
    if (ch === "t") {
      consumeLiteral("true");
      return;
    }
    if (ch === "f") {
      consumeLiteral("false");
      return;
    }
    if (ch === "n") {
      consumeLiteral("null");
      return;
    }
    if (ch === "-" || ch !== void 0 && ch >= "0" && ch <= "9") {
      consumeNumber();
      return;
    }
    fail(`malformed JSON near byte ${index}`);
  }
  function parseObject(path) {
    const keys = /* @__PURE__ */ new Set();
    index += 1;
    skipWhitespace();
    if (text[index] === "}") {
      index += 1;
      return;
    }
    while (index < text.length) {
      skipWhitespace();
      if (text[index] !== '"') fail(`expected object key near byte ${index}`);
      const key = readJsonString();
      if (keys.has(key)) {
        throw new TypeError(
          `strictJsonCodec: duplicate object key ${JSON.stringify(key)} at ${path}`
        );
      }
      keys.add(key);
      skipWhitespace();
      if (text[index] !== ":") fail(`expected ':' after object key near byte ${index}`);
      index += 1;
      parseValue(`${path}.${key}`);
      skipWhitespace();
      if (text[index] === ",") {
        index += 1;
        continue;
      }
      if (text[index] === "}") {
        index += 1;
        return;
      }
      fail(`expected ',' or '}' near byte ${index}`);
    }
    fail("unterminated JSON object");
  }
  function parseArray(path) {
    index += 1;
    skipWhitespace();
    if (text[index] === "]") {
      index += 1;
      return;
    }
    let item = 0;
    while (index < text.length) {
      parseValue(`${path}[${item}]`);
      item += 1;
      skipWhitespace();
      if (text[index] === ",") {
        index += 1;
        continue;
      }
      if (text[index] === "]") {
        index += 1;
        return;
      }
      fail(`expected ',' or ']' near byte ${index}`);
    }
    fail("unterminated JSON array");
  }
  parseValue("$");
  skipWhitespace();
  if (index !== text.length) fail(`trailing JSON token near byte ${index}`);
}
function strictJsonCodecFor() {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return {
    encode(value) {
      assertNoUnpairedSurrogates(value);
      return encoder.encode(strictStableJsonString(value));
    },
    decode(bytes) {
      const text = decoder.decode(bytes);
      assertNoDuplicateJsonObjectKeys(text);
      const decoded = JSON.parse(text);
      assertNoUnpairedSurrogates(decoded);
      const canonical = encoder.encode(strictStableJsonString(decoded));
      if (!bytesEqual(bytes, canonical)) {
        throw new TypeError("strictJsonCodec: bytes are not canonical stable JSON");
      }
      return decoded;
    }
  };
}
var strictJsonCodec = strictJsonCodecFor();
function strictCanonicalJsonBytes(value) {
  return strictJsonCodec.encode(value);
}
function assertStrictJsonObject(value, label = "strictJsonObject") {
  return cloneStrictJsonObject(value, label);
}

// packages/ts/src/node/versioning.ts
var ABSENT_V1_SEED = Object.freeze({
  "@graphrefly/node-version": "v1-absent"
});
function fnv1a64(input) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of input) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}
function defaultNodeVersionHash(bytes) {
  return `fnv1a64:${fnv1a64(bytes)}`;
}
function computeV1Cid(policy, value) {
  return policy.hash(strictCanonicalJsonBytes(value));
}
function assertNodeVersionDataCompatible(policy, value) {
  if (!policy.enabled || policy.level === 0) return;
  strictCanonicalJsonBytes(value);
}
function snapshotNodeVersionData(policy, value) {
  if (!policy.enabled || policy.level === 0) return value;
  const bytes = strictCanonicalJsonBytes(value);
  return strictJsonCodec.decode(bytes);
}
function resolveNodeVersioningPolicy(policy) {
  if (policy === false) return { enabled: false };
  if (policy === void 0 || policy === 0) return { enabled: true, level: 0 };
  if (policy === 1) return { enabled: true, level: 1, hash: defaultNodeVersionHash };
  if (typeof policy === "object" && policy !== null) {
    if (policy.level === 0) return { enabled: true, level: 0 };
    if (policy.level === 1) {
      return { enabled: true, level: 1, hash: policy.hash ?? defaultNodeVersionHash };
    }
  }
  throw new Error("node: versioning level must be 0 or 1; V2/V3 are not locked yet (D109)");
}
function createNodeVersion(policy, initialValue = ABSENT_V1_SEED) {
  if (!policy.enabled) return void 0;
  if (policy.level === 0) return Object.freeze({ level: 0, counter: 0 });
  return Object.freeze({
    level: 1,
    counter: 0,
    cid: computeV1Cid(policy, initialValue),
    prev: null
  });
}
function advanceNodeVersion(current, policy, value) {
  if (!policy.enabled) return void 0;
  if (current === void 0) return createNodeVersion(policy, value);
  if (policy.level === 0) {
    return Object.freeze({ level: 0, counter: current.counter + 1 });
  }
  const previous = current.level === 1 ? current.cid : null;
  return Object.freeze({
    level: 1,
    counter: current.counter + 1,
    cid: computeV1Cid(policy, value),
    prev: previous
  });
}
function cloneNodeVersion(version) {
  if (version === void 0) return void 0;
  if (version.level === 0) return Object.freeze({ level: 0, counter: version.counter });
  return Object.freeze({
    level: 1,
    counter: version.counter,
    cid: version.cid,
    prev: version.prev
  });
}
function restoredV1Cid(policy, hasData, cache) {
  return computeV1Cid(policy, hasData ? cache : ABSENT_V1_SEED);
}

// packages/ts/src/node/node-output-runtime.ts
function nodeDown(self, msgs) {
  if (self._released) return;
  validateDownPayloads(msgs);
  const deliveryWave = {};
  const assertVersionDataCompatible = (wave) => {
    for (const m of wave) {
      if (m[0] === "DATA") assertNodeVersionDataCompatible(self._version.policy, m[1]);
    }
  };
  const snapshotVersionData = (wave) => wave.map(
    (m) => m[0] === "DATA" ? ["DATA", snapshotNodeVersionData(self._version.policy, m[1])] : m
  );
  assertVersionDataCompatible(msgs);
  if (self._value.terminal !== void 0) {
    if (!msgs.some((m) => m[0] === "TEARDOWN")) return;
    self._value.hasTorndown = true;
    if (self._slot.resetOnTeardown) {
      self._value.cache = SENTINEL;
      self._value.hasData = false;
    }
    self._emitToSubs(["TEARDOWN"], { wave: deliveryWave, last: true });
    return;
  }
  let sorted = [...msgs].sort((a, b) => messageTier(a[0]) - messageTier(b[0]));
  const firstInvalidate = sorted.findIndex((m) => m[0] === "INVALIDATE");
  if (firstInvalidate !== -1) {
    sorted = sorted.filter((m, i) => m[0] !== "INVALIDATE" || i === firstInvalidate);
  }
  const hasTeardown = sorted.some((m) => m[0] === "TEARDOWN");
  const hasTerminal = sorted.some((m) => m[0] === "COMPLETE" || m[0] === "ERROR");
  if (hasTeardown && !hasTerminal && self._value.terminal === void 0 && !self._value.hasTorndown) {
    sorted = [["COMPLETE"], ...sorted];
  }
  if (!self._wave.insideRunWave && currentBatch()) {
    const deferred = snapshotVersionData(sorted.filter((m) => isDeferredTier(m[0])));
    if (deferred.length > 0) {
      if (!self._wave.emittedDirtyThisWave) {
        self._wave.emittedDirtyThisWave = true;
        self._value.status = "dirty";
        self._emitToSubs(["DIRTY"], { wave: deliveryWave, last: false });
      }
      self._wave.batchDirtyOwed = true;
      deferToBatch(self, deferred);
      return;
    }
  }
  if (self._shouldBufferOnPause()) {
    const buffered = snapshotVersionData(sorted.filter((m) => isPauseBufferedTier(m[0])));
    if (buffered.length > 0) {
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
  if (dataCount >= 1 && hasResolved) {
    throw new Error(
      "down: a wave cannot mix DATA and RESOLVED (tier-3 exclusivity, R-resolved-undirty)"
    );
  }
  const plannedVersions = new Array(sorted.length);
  if (dataCount > 0) {
    let plannedVersion = self._version.value;
    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i];
      if (m[0] !== "DATA") continue;
      plannedVersion = advanceNodeVersion(plannedVersion, self._version.policy, m[1]);
      plannedVersions[i] = plannedVersion;
    }
  }
  if (hasTier3 && (!self._wave.insideRunWave || self._control.pullDirtyOwed) && !self._wave.emittedDirtyThisWave) {
    self._wave.emittedDirtyThisWave = true;
    self._value.status = "dirty";
    self._emitToSubs(["DIRTY"], { wave: deliveryWave, last: false });
  }
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    const delivery = { wave: deliveryWave, last: i === sorted.length - 1 };
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
      const v = m[1];
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
      if (self._value.terminal !== void 0) continue;
      self._value.terminal = true;
      self._control.pauseBuffer = [];
      self._value.status = "completed";
      self._emitToSubs(["COMPLETE"], delivery);
      continue;
    }
    if (m[0] === "ERROR") {
      if (self._value.terminal !== void 0) continue;
      self._value.terminal = m[1];
      self._control.pauseBuffer = [];
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
  }
  if (!self._wave.insideRunWave) self._wave.emittedDirtyThisWave = false;
}
function nodeUp(self, msgs, towardDep, route) {
  if (self._released) return;
  const routeState = route ?? { demandFired: /* @__PURE__ */ new Map() };
  for (const m of msgs) {
    const tier = messageTier(m[0]);
    if (tier === void 0) {
      throw new Error(
        `ctx.up: ${String(m[0])} is not in the closed message-type set (R-msg-closed-set)`
      );
    }
    if (!isUpAllowed(m[0])) {
      throw new Error(
        `ctx.up: ${m[0]} is not up-going (tier ${tier}); up carries control/demand messages only (R-ctx-up)`
      );
    }
  }
  for (const m of msgs) {
    if (m[0] === "PAUSE") {
      self._pauseAcquire(m[1]);
    } else if (m[0] === "RESUME") {
      if (self._control.pauseLockset.has(m[1])) {
        self._pauseRelease(m[1]);
      } else {
        self._forwardUp(m, towardDep, routeState);
      }
    } else if (m[0] === "PULL") {
      const demand = normalizePullDemand(m[1]);
      if (self._slot.pull && demand.pullId === self._slot.pullLock) {
        if (!self._markDemandRouted(demand.pullId, routeState)) self._onDemand(demand);
      } else {
        self._forwardUp(["PULL", demand], towardDep, routeState);
      }
    } else if (self._slot.deps.length === 0) {
      if (m[0] === "INVALIDATE") self._down([["INVALIDATE"]]);
    } else {
      self._forwardUp(m, towardDep, routeState);
    }
  }
}
function nodeMarkDemandRouted(self, lockId, route) {
  let holders = route.demandFired.get(lockId);
  if (holders === void 0) {
    holders = /* @__PURE__ */ new Set();
    route.demandFired.set(lockId, holders);
  }
  const node = self;
  if (holders.has(node)) return true;
  holders.add(node);
  return false;
}
function nodeForwardUp(self, m, towardDep, route) {
  if (self._slot.deps.length === 0) return;
  if (towardDep !== void 0) {
    const d = self._slot.deps[towardDep];
    if (d !== void 0) nodeRuntimeHost(d)._up([m], void 0, route);
  } else {
    for (const dep of self._slot.deps) nodeRuntimeHost(dep)._up([m], void 0, route);
  }
}
function nodeIsPaused(self) {
  return self._control.pauseLockset.size > 0;
}
function nodeHasBoundaryPauseLock(self) {
  if (self._slot.pausable === false) return false;
  return self._control.pauseLockset.size > 0;
}
function nodeIsAsyncPool(self) {
  return self._slot.handle !== null && self._slot.dispatcher.poolKind(self._slot.handle.poolId) === "async";
}
function nodePauseAcquire(self, lockId) {
  self._control.pauseLockset.add(lockId);
}
function nodePauseRelease(self, lockId) {
  if (!self._control.pauseLockset.has(lockId)) return;
  self._control.pauseLockset.delete(lockId);
  if (self._slot.pull && self._control.demandOwed !== void 0) self._fireOwedDemandIfReady();
  if (self._hasBoundaryPauseLock()) return;
  scheduleBoundaryDrain(self._core);
  if (self._slot.pull) return;
  self._onResume();
}
function nodeOnResume(self) {
  if (self._value.terminal !== void 0) {
    self._control.pauseBuffer = [];
    self._control.pausedDepWaveOccurred = false;
    self._control.demandOwed = void 0;
    self._control.activePull = void 0;
    self._control.pullDirtyOwed = false;
    return;
  }
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
function nodeCanFireDemand(self) {
  if (self._value.terminal !== void 0 || self._wave.pending > 0) return false;
  return self._control.pauseLockset.size === 0;
}
function nodeDeliverPullDemand(self, demand) {
  self._control.demandOwed = void 0;
  self._control.activePull = demand;
  self._control.inDeliverDemand = true;
  try {
    self._firePullDemand();
  } finally {
    self._control.activePull = void 0;
    self._control.inDeliverDemand = false;
  }
}
function nodeOnDemand(self, demand) {
  if (self._control.inDeliverDemand) return;
  if (self._canFireDemand()) self._deliverPullDemand(demand);
  else self._control.demandOwed = demand;
}
function nodeFirePullDemand(self) {
  let drainedBuffer = false;
  if (self._control.pauseBuffer.length > 0) {
    const buf = self._control.pauseBuffer;
    self._control.pauseBuffer = [];
    for (const wave of buf) self._down(wave);
    drainedBuffer = true;
  }
  if (drainedBuffer) return;
  if (self._control.pausedDepWaveOccurred) {
    const gated = self._slot.handle !== null && !self._wave.hasCalledFnOnce && !(self._slot.partial || self._allDepsSettled());
    if (self._wave.pending > 0 || gated) return;
    self._control.pausedDepWaveOccurred = false;
    self._wave.emittedDirtyThisWave = false;
    self._control.pullDirtyOwed = true;
    try {
      self._tryRun();
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
function nodeFireOwedDemandIfReady(self) {
  if (self._control.inDeliverDemand) return;
  if (self._slot.pull && self._control.demandOwed !== void 0 && self._canFireDemand()) {
    self._deliverPullDemand(self._control.demandOwed);
  }
}
function nodeShouldBufferOnPause(self) {
  if (self._slot.pausable === false) return false;
  if (!self._isPaused() && !self._isPullQuiet()) return false;
  if (self._slot.pausable === "resumeAll") return true;
  if (!self._wave.insideRunWave && self._isAsyncPool() && self._slot.deps.length > 0) return true;
  return false;
}
function nodeInvalidate(self, delivery) {
  if (!self._value.hasData) return;
  self._value.cache = SENTINEL;
  self._value.hasData = false;
  self._value.status = "sentinel";
  self._value.replayRing = [];
  for (const fn of self._hooks.onInvalidate) fn();
  self._emitToSubs(["INVALIDATE"], delivery);
}
function nodeAllDepsTerminal(self) {
  if (self._slot.deps.length === 0) return false;
  for (const tm of self._dep.terminal) if (tm === void 0) return false;
  return true;
}
function nodeResetLifecycle(self) {
  for (const u of self._dep.unsubs) if (u) u();
  self._dep.unsubs = [];
  self._dep.idxBoxes = [];
  self._lifecycle.subscribers.clear();
  self._lifecycle.activated = false;
  self._value.terminal = void 0;
  self._value.hasTorndown = false;
  self._wave.hasCalledFnOnce = false;
  self._resetDepState();
  self._control.pauseLockset.clear();
  self._control.pauseBuffer = [];
  self._control.pausedDepWaveOccurred = false;
  self._control.demandOwed = void 0;
  self._control.activePull = void 0;
  self._control.pullDirtyOwed = false;
  self._value.replayRing = [];
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
function nodeEmitToSubs(self, msg, delivery) {
  if (self._released) return;
  const subs = [...self._lifecycle.subscribers];
  for (const sink of subs) sink(msg, delivery);
}
function nodeCommitBatchedWave(self, wave) {
  self._wave.batchDirtyOwed = false;
  self._down(wave);
}
function nodeRollbackBatched(self) {
  if (self._wave.batchDirtyOwed) {
    self._wave.batchDirtyOwed = false;
    self._wave.emittedDirtyThisWave = false;
    self._value.status = self._value.hasData ? "settled" : "sentinel";
    self._emitToSubs(["RESOLVED"]);
  }
}
function nodeDeferBoundary(self, fn, batchToken) {
  deferRewire(self._core, fn, {
    batchToken,
    isReady: () => !self._hasBoundaryPauseLock()
  });
}

// packages/ts/src/node/node-rewire-runtime.ts
function nodeRequestRewireNext(self, op) {
  deferRewire(self._core, () => self._applyRewireNext(op), {
    batchToken: currentBoundaryBatchToken(),
    isReady: () => !self._hasBoundaryPauseLock()
  });
}
function nodeRequestUpNext(self, msgs, towardDep) {
  deferRewire(
    self._core,
    () => {
      if (!self._released) self._up(msgs, towardDep);
    },
    {
      batchToken: currentBoundaryBatchToken(),
      isReady: () => !self._hasBoundaryPauseLock()
    }
  );
}
function nodeApplyRewireNext(self, op) {
  if (self._released) return;
  try {
    if (op.kind === "add") {
      const next = self._slot.deps.includes(op.dep) ? [...self._slot.deps] : [...self._slot.deps, op.dep];
      self._rewire(next, op.fn, { allowTerminalOwner: true });
    } else if (op.kind === "remove") {
      self._rewire(
        self._slot.deps.filter((d) => d !== op.dep),
        op.fn,
        { allowTerminalOwner: true }
      );
    } else {
      self._rewire(self._dedupDeps(op.deps), op.fn, { allowTerminalOwner: true });
    }
  } catch (e) {
    self._down([["ERROR", errorPayload(e, "rewireNext op failed")]]);
  }
}
function nodeRewire(self, newDeps, fn, opts = {}) {
  const node = self;
  if (self._value.terminal !== void 0 && !opts.allowTerminalOwner)
    throw new Error(
      "rewire: node is terminal (completed/errored) \u2014 cannot rewire (R-rewire / D42)"
    );
  if (self._wave.insideRunWave)
    throw new Error(
      "rewire: mid-fn topology mutation \u2014 a fn mutating its own deps mid-wave is the feedback cycle (R-rewire / D37)"
    );
  if (self._wave.inDepMutation)
    throw new Error(
      "rewire: reentrant dep mutation \u2014 another replaceDeps/subscribeDep/unsubscribeDep is in flight (R-rewire)"
    );
  if (newDeps.includes(node)) throw new Error("rewire: self-dependency rejected (R-rewire / D42)");
  const oldDeps = self._slot.deps;
  const added = newDeps.filter((d) => !oldDeps.includes(d));
  for (const d of added) {
    if (self._reachableUpstream(d, node))
      throw new Error(
        "rewire: would create a cycle \u2014 dep already transitively depends on this node (R-rewire / D42)"
      );
    const dep = nodeRuntimeHost(d);
    if (dep._value.terminal !== void 0 && !dep._slot.resubscribable)
      throw new Error(
        "rewire: cannot add a non-resubscribable terminal dep \u2014 would wedge (R-rewire / D42)"
      );
    self._assertRewireDepOwner(d);
  }
  if (deferAfterBatchForTarget(node, () => {
    self._rewire(newDeps, fn, { ...opts, allowTerminalOwner: true });
  })) {
    return true;
  }
  if (!self._lifecycle.activated) self._restoredActivationPending = false;
  self._wave.inDepMutation = true;
  self._wave.rewireRunPending = false;
  let zeroDepUnDirty = false;
  try {
    const oldHandle = self._slot.handle;
    self._slot.handle = self._slot.dispatcher.register(fn, self._slot.pool);
    if (oldHandle !== null) self._slot.dispatcher.unregister(oldHandle);
    const removed = oldDeps.filter((d) => !newDeps.includes(d));
    let removedDirtyContributor = false;
    for (const d of removed) {
      const oldIdx = oldDeps.indexOf(d);
      if (self._dep.dirty[oldIdx]) {
        removedDirtyContributor = true;
        self._wave.pending--;
      }
      if (self._lifecycle.activated) {
        const box = self._dep.idxBoxes[oldIdx];
        if (box) box.v = -1;
        const unsub = self._dep.unsubs[oldIdx];
        if (unsub) unsub();
      }
    }
    const n = newDeps.length;
    const newBatch = new Array(n).fill(null);
    const newPrev = new Array(n).fill(SENTINEL);
    const newHasData = new Array(n).fill(false);
    const newDirty = new Array(n).fill(false);
    const newTier = new Array(n).fill(0);
    const newTerminal = new Array(n).fill(void 0);
    const newTerminalInput = new Array(n).fill(void 0);
    const newUnsubs = new Array(n);
    const newBoxes = new Array(n);
    for (let j = 0; j < n; j++) {
      const oldIdx = oldDeps.indexOf(newDeps[j]);
      if (oldIdx !== -1) {
        newBatch[j] = self._dep.batch[oldIdx];
        newPrev[j] = self._dep.prev[oldIdx];
        newHasData[j] = self._dep.hasData[oldIdx];
        newDirty[j] = self._dep.dirty[oldIdx];
        newTier[j] = self._dep.tier[oldIdx];
        newTerminal[j] = self._dep.terminal[oldIdx];
        newUnsubs[j] = self._dep.unsubs[oldIdx];
        const box = self._dep.idxBoxes[oldIdx];
        if (box) box.v = j;
        newBoxes[j] = box;
      }
    }
    self._slot.deps = newDeps;
    self._dep.batch = newBatch;
    self._dep.prev = newPrev;
    self._dep.hasData = newHasData;
    self._dep.dirty = newDirty;
    self._dep.tier = newTier;
    self._dep.terminal = newTerminal;
    self._dep.terminalInput = newTerminalInput;
    self._dep.unsubs = newUnsubs;
    self._dep.idxBoxes = newBoxes;
    self._dep.waveData = newDeps.map(() => []);
    self._dep.waveTokens = new Array(newDeps.length).fill(void 0);
    self._dep.waveLive = newDeps.map(() => []);
    self._syncCtx = null;
    if (self._lifecycle.activated) {
      for (const d of added) self._subscribeDepAt(d);
    }
    notifyTopologyDepsChanged(node, oldDeps, newDeps);
    if (removedDirtyContributor && self._wave.pending === 0 && self._value.status === "dirty") {
      if (newDeps.length > 0) self._wave.rewireRunPending = true;
      else zeroDepUnDirty = true;
    }
  } finally {
    self._wave.inDepMutation = false;
  }
  if (self._wave.rewireRunPending) {
    self._wave.rewireRunPending = false;
    self._settleRewire();
  } else if (zeroDepUnDirty) {
    if (self._wave.emittedDirtyThisWave) self._down([["RESOLVED"]]);
    else self._value.status = self._value.hasData ? "settled" : "sentinel";
  }
  return false;
}

// packages/ts/src/node/node.ts
var Node = class _Node {
  _core;
  _id;
  _slot;
  _dep;
  _value;
  _wave;
  _control;
  _lifecycle;
  _privateState;
  _hooks;
  _syncCtxState;
  _version;
  _restoredActivationPending = false;
  _released = false;
  get _syncCtx() {
    return this._syncCtxState.value;
  }
  set _syncCtx(ctx) {
    this._syncCtxState.value = ctx;
  }
  static _retainIndirectRuntimeMethods(node) {
    void node._dep;
    void node._hooks;
    void node._restoredActivationPending;
    void node._requestRewireNext;
    void node._requestUpNext;
    void node._applyRewireNext;
    void node._reachableUpstream;
    void node._assertRewireDepOwner;
    void node._subscribeDepAt;
    void node._seedRestoredDepAt;
    void node._recordDepProjection;
    void node._depProjectionHasData;
    void node._receiveFromDep;
    void node._releaseDepDirty;
    void node._settleAfterAbsorbedTerminal;
    void node._markDirty;
    void node._maybeRun;
    void node._settleRewire;
    void node._tryRun;
    void node._allDepsSettled;
    void node._passthroughEmit;
    void node._runWave;
    void node._buildCtx;
    void node._makeCtx;
    void node._refreshCtx;
    void node._makeState;
    void node._markDemandRouted;
    void node._forwardUp;
    void node._isPullQuiet;
    void node._isPaused;
    void node._hasBoundaryPauseLock;
    void node._isAsyncPool;
    void node._pauseAcquire;
    void node._pauseRelease;
    void node._onResume;
    void node._canFireDemand;
    void node._deliverPullDemand;
    void node._onDemand;
    void node._firePullDemand;
    void node._fireOwedDemandIfReady;
    void node._shouldBufferOnPause;
    void node._invalidate;
    void node._allDepsTerminal;
    void node._emitToSubs;
  }
  constructor(deps, handleOrFn, opts = {}) {
    const core = takeConstructingNodeCore();
    const dispatcher = opts.dispatcher ?? defaultDispatcher;
    const environment = takeConstructingEnvironmentDrivers() ?? EnvironmentDrivers.empty();
    const pool = opts.pool ?? "sync";
    const pausable = opts.pausable ?? true;
    const pullLock = opts.pullId;
    const pull = opts.pullId !== void 0;
    if (pull && pausable === false)
      throw new Error(
        "node: pullId is incompatible with pausable:false \u2014 a pull node uses the pausable delivery-content axis (R-pull / R-pause-modes / D55,D269)"
      );
    let handle;
    if (handleOrFn === null) handle = null;
    else if (typeof handleOrFn === "function") handle = dispatcher.register(handleOrFn, pool);
    else handle = handleOrFn;
    const n = deps.length;
    const dep = makeDepBookkeeping(n);
    const versioning = resolveNodeVersioningPolicy(opts.versioning);
    const value = {
      cache: SENTINEL,
      hasData: false,
      status: "sentinel",
      terminal: void 0,
      hasTorndown: false,
      replayRing: []
    };
    if (opts.initial !== void 0) {
      value.cache = opts.initial;
      value.hasData = true;
      value.status = "settled";
    }
    const pauseLockset = /* @__PURE__ */ new Set();
    this._core = core ?? new NodeCore();
    const created = this._core.createSlot(
      {
        deps,
        handle,
        pool,
        dispatcher,
        environment,
        partial: opts.partial ?? false,
        terminalAsRealInput: opts.terminalAsRealInput ?? false,
        completeWhenDepsComplete: opts.completeWhenDepsComplete ?? true,
        errorWhenDepsError: opts.errorWhenDepsError ?? true,
        resubscribable: opts.resubscribable ?? false,
        resetOnTeardown: opts.resetOnTeardown ?? false,
        pausable,
        pull,
        pullLock,
        replayN: opts.replayBuffer ?? 0,
        dynamic: opts.dynamic ?? false,
        name: opts.name,
        factory: opts.factory
      },
      {
        dep,
        lifecycle: { subscribers: /* @__PURE__ */ new Set(), activated: false },
        value,
        wave: {
          pending: 0,
          hasCalledFnOnce: false,
          emittedDirtyThisWave: false,
          emittedSettleThisWave: false,
          insideRunWave: false,
          inDepMutation: false,
          rewireRunPending: false,
          batchDirtyOwed: false
        },
        control: {
          pauseLockset,
          pausedDepWaveOccurred: false,
          pauseBuffer: [],
          demandOwed: void 0,
          activePull: void 0,
          pullDirtyOwed: false,
          inDeliverDemand: false
        },
        privateState: { value: SENTINEL, persist: false },
        hooks: { onDeactivation: [], onInvalidate: [] },
        syncCtx: { value: null },
        version: {
          policy: versioning,
          value: createNodeVersion(
            versioning,
            opts.initial !== void 0 ? opts.initial : void 0
          )
        }
      }
    );
    this._id = created.id;
    this._slot = this._core.get(this._id);
    this._dep = this._core.getDep(this._id);
    this._value = this._core.getValue(this._id);
    this._wave = this._core.getWave(this._id);
    this._control = this._core.getControl(this._id);
    this._lifecycle = this._core.getLifecycle(this._id);
    this._privateState = this._core.getPrivateState(this._id);
    this._hooks = this._core.getHooks(this._id);
    this._syncCtxState = this._core.getSyncCtx(this._id);
    this._version = this._core.getVersion(this._id);
    checkpointReaders.set(this, () => ({
      cache: this._value.cache,
      hasData: this._value.hasData,
      terminal: this._value.terminal,
      activated: this._lifecycle.activated,
      hasCalledFnOnce: this._wave.hasCalledFnOnce,
      ctxState: {
        value: this._privateState.value,
        persist: this._privateState.persist
      },
      version: cloneNodeVersion(this._version.value),
      handle: this._slot.handle
    }));
    restoreWriters.set(this, (state) => {
      this._assertNotReleased("restoreGraph");
      this._value.cache = state.cache;
      this._value.hasData = state.hasData;
      this._value.status = state.status;
      this._value.terminal = state.terminal;
      this._value.hasTorndown = false;
      this._value.replayRing = [];
      this._wave.hasCalledFnOnce = state.hasCalledFnOnce;
      this._wave.emittedDirtyThisWave = false;
      this._wave.emittedSettleThisWave = false;
      this._wave.pending = 0;
      this._wave.insideRunWave = false;
      this._wave.inDepMutation = false;
      this._wave.rewireRunPending = false;
      this._wave.batchDirtyOwed = false;
      this._control.pauseBuffer = [];
      this._control.pausedDepWaveOccurred = false;
      this._control.demandOwed = void 0;
      this._control.activePull = void 0;
      this._control.pullDirtyOwed = false;
      this._control.inDeliverDemand = false;
      this._control.pauseLockset.clear();
      this._privateState.value = state.ctxState.value;
      this._privateState.persist = state.ctxState.persist;
      if (state.version === false) {
        this._version.policy = { enabled: false };
        this._version.value = void 0;
      } else if (state.version.level === 0) {
        this._version.policy = { enabled: true, level: 0 };
        this._version.value = cloneNodeVersion(state.version);
      } else {
        if (!this._version.policy.enabled || this._version.policy.level !== 1) {
          throw new Error(
            `restoreGraph: checkpoint node version level ${state.version.level} requires matching node versioning policy`
          );
        }
        if (!state.hasData && state.version.counter > 0) {
          throw new Error(
            "restoreGraph: checkpoint node version cid cannot be verified without current DATA under V1 versioning (D109)"
          );
        }
        const expectedCid = restoredV1Cid(this._version.policy, state.hasData, state.cache);
        if (expectedCid !== state.version.cid) {
          throw new Error(
            "restoreGraph: checkpoint node version cid does not match the selected node versioning hash policy (D109)"
          );
        }
        this._version.value = cloneNodeVersion(state.version);
      }
      this._syncCtx = null;
      this._resetDepState();
      this._lifecycle.activated = false;
      this._lifecycle.subscribers.clear();
      this._restoredActivationPending = true;
    });
    runtimeReleasers.set(this, () => this._releaseRuntime());
    runtimeQuiescenceReaders.set(this, () => this._isRuntimeQuiescentForRelease());
    subscriberCountReaders.set(this, () => this._subscriberCount());
    activationReaders.set(this, () => this._lifecycle.activated);
    _Node._retainIndirectRuntimeMethods(this);
  }
  /** R-pull (D55/D272): true while a pull node is not serving a PULL demand pulse. */
  _isPullQuiet() {
    return this._slot.pull && this._control.activePull === void 0;
  }
  /**
   * R-pull (D269/D272): this pull node's pullId (pure data, like {@link cache}/{@link handle} —
   * never triggers computation). A consumer demands one delivery by cone-routing PULL of it (no
   * node reference): `ctx.up([["PULL", { pullId }]])` (immediate; loops back → D37 for a self-read
   * dep) or `ctx.upNext([["PULL", { pullId }]])` (boundary-deferred self-demand). Undefined for a
   * non-pull node. The author writes the pullId verbatim; routing matches by identity.
   */
  get pullId() {
    return this._slot.pullLock;
  }
  get cache() {
    return this._value.cache;
  }
  get status() {
    return this._value.status;
  }
  get version() {
    return cloneNodeVersion(this._version.value);
  }
  get name() {
    return this._slot.name;
  }
  /** R-describe/D51: real factory name for a standalone graph-less node (a runtime *Map inner). */
  get factory() {
    return this._slot.factory;
  }
  /**
   * The node's CURRENT/LIVE deps (R-describe / R-edges-derived / D51) — readonly view of the
   * live `_deps`, which a rewire (C-8 / C-11) mutates. The graph's describe() reads this (NOT a
   * construction-time snapshot) so every edge corresponds to a real current subscription (D3).
   * Inspection-only, like cache/status; never triggers computation.
   */
  get deps() {
    return this._slot.deps;
  }
  /**
   * The fn handle (pure data `(poolId, handleId)`, D7) or null for state/passthrough
   * nodes. Inspection-only (L1.6 handle is referenceable/inspectable) — lets the graph
   * layer key a dispatcher-backed profile recorder WITHOUT putting counters on the node
   * (R-node-thin / D39).
   */
  get handle() {
    return this._slot.handle;
  }
  /** R-push-subscribe: a new sink receives START, then cached DATA (or DIRTY if dirty). */
  subscribe(sink) {
    this._assertNotReleased("subscribe");
    enterWave();
    try {
      if (this._value.terminal !== void 0) {
        if (this._slot.resubscribable) {
          this._restoredActivationPending = false;
          this._resetLifecycle();
        } else
          throw new Error(
            "subscribe: node is non-resubscribable and has terminated; the stream is permanently over (R-terminal / R2.2.7.b)"
          );
      }
      this._lifecycle.subscribers.add(sink);
      sink(["START"]);
      if (this._slot.replayN > 0 && this._value.replayRing.length > 0) {
        for (const v of this._value.replayRing) sink(["DATA", v]);
      } else if (this._value.hasData && !this._slot.pull) {
        sink(["DATA", this._value.cache]);
      } else if (this._value.status === "dirty" && !this._slot.pull) {
        sink(["DIRTY"]);
      }
      if (!this._lifecycle.activated) this._activate();
      return () => {
        if (!this._lifecycle.subscribers.delete(sink)) return;
        if (this._lifecycle.subscribers.size === 0) this._deactivate();
      };
    } finally {
      exitWave();
    }
  }
  /** External emission toward sinks (state-node push, or async late-emit). One call = one wave. */
  down(msgs) {
    this._assertNotReleased("down");
    enterWave();
    try {
      this._down(msgs);
    } finally {
      exitWave();
    }
  }
  /**
   * Emit upstream toward deps — control tiers only (R-ctx-up). `towardDep` (a dep index) routes up
   * ONE declared edge (R-up-routing directed-up); omitted = broadcast up all deps.
   */
  up(msgs, towardDep) {
    this._assertNotReleased("up");
    enterWave();
    try {
      this._up(msgs, towardDep);
    } finally {
      exitWave();
    }
  }
  // ── rewire (R-rewire / D42): intra-graph runtime topology mutation ──
  /**
   * Replace this node's deps atomically (surgical, Option-C). Requires an explicit
   * `fn` (SD-1 fn-deps pairing — user fns read dep input positionally). Kept deps
   * keep their subscription + per-dep state; only removed deps unsubscribe and only
   * added deps fresh-subscribe (push-on-subscribe for an added cached dep). The
   * first-run gate and cache are PRESERVED (R-rewire Q2/Q7). Intra-graph only (D22).
   */
  replaceDeps(newDeps, fn) {
    this._assertNotReleased("replaceDeps");
    this._rewire(this._dedupDeps(newDeps), fn);
  }
  /** Subscribe to one dep (special case of replaceDeps); returns its index. fn required (SD-1). */
  subscribeDep(depNode, fn) {
    this._assertNotReleased("subscribeDep");
    const next = this._slot.deps.includes(depNode) ? [...this._slot.deps] : [...this._slot.deps, depNode];
    const deferred = this._rewire(next, fn);
    return deferred ? next.indexOf(depNode) : this._slot.deps.indexOf(depNode);
  }
  /** Unsubscribe from one dep (special case of replaceDeps); idempotent if absent (fn swap still applies). */
  unsubscribeDep(depNode, fn) {
    this._assertNotReleased("unsubscribeDep");
    this._rewire(
      this._slot.deps.filter((d) => d !== depNode),
      fn
    );
  }
  _requestRewireNext(op) {
    nodeRequestRewireNext(nodeRuntimeHost(this), op);
  }
  _requestUpNext(msgs, towardDep) {
    nodeRequestUpNext(nodeRuntimeHost(this), msgs, towardDep);
  }
  _applyRewireNext(op) {
    nodeApplyRewireNext(nodeRuntimeHost(this), op);
  }
  _dedupDeps(deps) {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const d of deps)
      if (!seen.has(d)) {
        seen.add(d);
        out.push(d);
      }
    return out;
  }
  _reachableUpstream(from, target) {
    const seen = /* @__PURE__ */ new Set();
    const stack = [from];
    while (stack.length > 0) {
      const n = stack.pop();
      if (n === void 0) continue;
      if (n === target) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const d of nodeRuntimeHost(n)._slot.deps) stack.push(d);
    }
    return false;
  }
  _assertRewireDepOwner(dep) {
    const selfOwner = getNodeOwner(this);
    const depOwner = getNodeOwner(dep);
    if (selfOwner !== void 0 && depOwner !== void 0 && selfOwner !== depOwner)
      throw new Error(
        "rewire: dep belongs to a different graph; cross-graph deps require a wire bridge (D22 / R-graph-domain)"
      );
  }
  _rewire(newDeps, fn, opts = {}) {
    return nodeRewire(nodeRuntimeHost(this), newDeps, fn, opts);
  }
  // ── activation / deactivation (lazy; R-rom-ram) ──
  _activate() {
    nodeActivate(nodeRuntimeHost(this));
  }
  _deactivate() {
    nodeDeactivate(nodeRuntimeHost(this));
  }
  _assertNotReleased(op) {
    if (this._released)
      throw new Error(`${op}: node has been released from its graph lifecycle (D122)`);
  }
  _subscriberCount() {
    return nodeSubscriberCount(nodeRuntimeHost(this));
  }
  _isRuntimeQuiescentForRelease() {
    return nodeIsRuntimeQuiescentForRelease(nodeRuntimeHost(this));
  }
  _releaseRuntime() {
    nodeReleaseRuntime(nodeRuntimeHost(this));
  }
  _resetDepState() {
    nodeResetDepState(nodeRuntimeHost(this));
  }
  _subscribeDepAt(depNode, opts = {}) {
    nodeSubscribeDepAt(nodeRuntimeHost(this), depNode, opts);
  }
  _seedRestoredDepAt(idx, depNode) {
    nodeSeedRestoredDepAt(nodeRuntimeHost(this), idx, depNode);
  }
  _recordDepProjection(idx, delivery) {
    return nodeRecordDepProjection(nodeRuntimeHost(this), idx, delivery);
  }
  _depProjectionHasData(idx) {
    return nodeDepProjectionHasData(nodeRuntimeHost(this), idx);
  }
  _receiveFromDep(idx, msg, delivery) {
    nodeReceiveFromDep(nodeRuntimeHost(this), idx, msg, delivery);
  }
  _releaseDepDirty(idx) {
    nodeReleaseDepDirty(nodeRuntimeHost(this), idx);
  }
  _settleAfterAbsorbedTerminal() {
    nodeSettleAfterAbsorbedTerminal(nodeRuntimeHost(this));
  }
  _markDirty() {
    nodeMarkDirty(nodeRuntimeHost(this));
  }
  _maybeRun() {
    nodeMaybeRun(nodeRuntimeHost(this));
  }
  _settleRewire() {
    nodeSettleRewire(nodeRuntimeHost(this));
  }
  _tryRun() {
    nodeTryRun(nodeRuntimeHost(this));
  }
  _allDepsSettled() {
    return nodeAllDepsSettled(nodeRuntimeHost(this));
  }
  _passthroughEmit() {
    nodePassthroughEmit(nodeRuntimeHost(this));
  }
  _runWave() {
    nodeRunWave(nodeRuntimeHost(this));
  }
  _buildCtx() {
    return nodeBuildCtx(nodeRuntimeHost(this));
  }
  _makeCtx(snapshot) {
    return nodeMakeCtx(nodeRuntimeHost(this), snapshot);
  }
  _refreshCtx(ctx) {
    nodeRefreshCtx(nodeRuntimeHost(this), ctx);
  }
  _makeState() {
    return nodeMakeState(nodeRuntimeHost(this));
  }
  // ── downstream emission pipeline (the unified waist) ──
  _down(msgs) {
    nodeDown(nodeRuntimeHost(this), msgs);
  }
  _up(msgs, towardDep, route) {
    nodeUp(nodeRuntimeHost(this), msgs, towardDep, route);
  }
  _markDemandRouted(lockId, route) {
    return nodeMarkDemandRouted(nodeRuntimeHost(this), lockId, route);
  }
  _forwardUp(m, towardDep, route) {
    nodeForwardUp(nodeRuntimeHost(this), m, towardDep, route);
  }
  _isPaused() {
    return nodeIsPaused(nodeRuntimeHost(this));
  }
  _hasBoundaryPauseLock() {
    return nodeHasBoundaryPauseLock(nodeRuntimeHost(this));
  }
  _isAsyncPool() {
    return nodeIsAsyncPool(nodeRuntimeHost(this));
  }
  _pauseAcquire(lockId) {
    nodePauseAcquire(nodeRuntimeHost(this), lockId);
  }
  _pauseRelease(lockId) {
    nodePauseRelease(nodeRuntimeHost(this), lockId);
  }
  _onResume() {
    nodeOnResume(nodeRuntimeHost(this));
  }
  _canFireDemand() {
    return nodeCanFireDemand(nodeRuntimeHost(this));
  }
  _deliverPullDemand(demand) {
    nodeDeliverPullDemand(nodeRuntimeHost(this), demand);
  }
  _onDemand(demand) {
    nodeOnDemand(nodeRuntimeHost(this), demand);
  }
  _firePullDemand() {
    nodeFirePullDemand(nodeRuntimeHost(this));
  }
  _fireOwedDemandIfReady() {
    nodeFireOwedDemandIfReady(nodeRuntimeHost(this));
  }
  _shouldBufferOnPause() {
    return nodeShouldBufferOnPause(nodeRuntimeHost(this));
  }
  _invalidate(delivery) {
    nodeInvalidate(nodeRuntimeHost(this), delivery);
  }
  _allDepsTerminal() {
    return nodeAllDepsTerminal(nodeRuntimeHost(this));
  }
  _emitToSubs(msg, delivery) {
    nodeEmitToSubs(nodeRuntimeHost(this), msg, delivery);
  }
  /** R-terminal: resubscribable reset clears terminal + dep state + re-arms the gate. */
  _resetLifecycle() {
    nodeResetLifecycle(nodeRuntimeHost(this));
  }
  /** Batch commit (R-batch-coalesce): deliver the deferred tier-3 wave now. */
  __commitBatchedWave(wave) {
    nodeCommitBatchedWave(nodeRuntimeHost(this), wave);
  }
  /** Batch rollback: balance the immediate DIRTY with a RESOLVED so downstream un-dirties. */
  __rollbackBatched() {
    nodeRollbackBatched(nodeRuntimeHost(this));
  }
  /** B49: enqueue a committed-boundary task on this node's graph-local core. */
  __deferBoundary(fn, batchToken) {
    nodeDeferBoundary(nodeRuntimeHost(this), fn, batchToken);
  }
};

// packages/ts/src/identity.ts
function canonicalTupleKey(parts) {
  return JSON.stringify(parts);
}

// packages/ts/src/graph/blueprint.ts
var GRAPH_BLUEPRINT_VERSION = "graphrefly.blueprint.v2";
function normalizeTopologyMeta(meta, label = "meta", kind = "graph meta") {
  try {
    return assertStrictJsonObject(meta, label);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TypeError(`${label}: ${kind} must be strict JSON-compatible data (D177): ${message}`);
  }
}
function normalizeTopology(snapshot) {
  return normalizeTopologySnapshot(snapshot, /* @__PURE__ */ new WeakSet(), "$");
}
function normalizeTopologySnapshot(snapshot, seen, path) {
  if (snapshot === null || typeof snapshot !== "object") {
    throw new TypeError(`normalizeTopology: snapshot at ${path} must be an object`);
  }
  if (seen.has(snapshot)) {
    throw new TypeError(`normalizeTopology: circular subgraph reference at ${path}`);
  }
  seen.add(snapshot);
  try {
    const nodes = mapDense(snapshot.nodes, `${path}.nodes`, (node, index) => {
      const nodePath = `${path}.nodes[${index}]`;
      assertTopologyObject(node, nodePath);
      const id = topologyString(node.id, `${nodePath}.id`);
      const factory = topologyString(node.factory, `${nodePath}.factory`);
      const out2 = {
        id,
        factory,
        deps: mapDense(
          node.deps,
          `${labelForNode(id)}.deps`,
          (dep, depIndex) => topologyString(dep, `${labelForNode(id)}.deps[${depIndex}]`)
        )
      };
      if (node.name !== void 0) {
        out2.name = topologyString(node.name, `${nodePath}.name`);
      }
      if (node.meta !== void 0) {
        out2.meta = normalizeTopologyMeta(node.meta, `${labelForNode(id)}.meta`);
      }
      return out2;
    }).sort(compareNodes);
    const out = {
      nodes,
      edges: deriveEdges(nodes)
    };
    if (snapshot.mountId !== void 0) {
      out.mountId = topologyString(snapshot.mountId, `${path}.mountId`);
    }
    if (snapshot.name !== void 0) {
      out.name = topologyString(snapshot.name, `${path}.name`);
    }
    if (snapshot.subgraphs !== void 0) {
      out.subgraphs = mapDense(
        snapshot.subgraphs,
        `${path}.subgraphs`,
        (subgraph, index) => normalizeTopologySnapshot(subgraph, seen, `${path}.subgraphs[${index}]`)
      ).sort(compareTopologies);
    }
    return out;
  } finally {
    seen.delete(snapshot);
  }
}
function mapDense(values, path, mapper) {
  if (!Array.isArray(values)) {
    throw new TypeError(`normalizeTopology: ${path} must be an array`);
  }
  const out = [];
  for (let i = 0; i < values.length; i += 1) {
    if (!(i in values)) {
      throw new TypeError(`normalizeTopology: sparse array hole at ${path}[${i}]`);
    }
    out.push(mapper(values[i], i));
  }
  return out;
}
function assertTopologyObject(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`normalizeTopology: ${path} must be an object`);
  }
}
function topologyString(value, path) {
  if (typeof value !== "string") {
    throw new TypeError(`normalizeTopology: ${path} must be a string`);
  }
  return value;
}
function graphBlueprintDiagnostics(topology) {
  const issues = [];
  collectDiagnostics(topology, issues);
  issues.sort(compareIssues);
  return { ok: !issues.some((issue) => issue.severity === "error"), issues };
}
function collectDiagnostics(topology, issues) {
  const seen = /* @__PURE__ */ new Set();
  const duplicateIds = /* @__PURE__ */ new Set();
  for (const node of topology.nodes) {
    if (seen.has(node.id)) duplicateIds.add(node.id);
    seen.add(node.id);
  }
  for (const id of duplicateIds) {
    issues.push({
      severity: "error",
      code: "duplicate-node-id",
      nodeId: id,
      message: `duplicate topology node id '${id}'`
    });
  }
  const dependents = /* @__PURE__ */ new Map();
  for (const node of topology.nodes) dependents.set(node.id, 0);
  for (const node of topology.nodes) {
    for (const dep of node.deps) {
      if (!seen.has(dep)) {
        issues.push({
          severity: "error",
          code: "dangling-dep",
          nodeId: node.id,
          from: dep,
          to: node.id,
          message: `node '${node.id}' depends on missing node '${dep}'`
        });
        continue;
      }
      dependents.set(dep, (dependents.get(dep) ?? 0) + 1);
    }
  }
  for (const node of topology.nodes) {
    if (node.deps.length === 0 && (dependents.get(node.id) ?? 0) === 0) {
      issues.push({
        severity: "warning",
        code: "island-node",
        nodeId: node.id,
        message: `node '${node.id}' has no deps and no dependents`
      });
    }
  }
  for (const subgraph of topology.subgraphs ?? []) collectDiagnostics(subgraph, issues);
}
function deriveEdges(nodes) {
  const seen = /* @__PURE__ */ new Set();
  const edges = [];
  for (const node of nodes) {
    for (const from of node.deps) {
      const key = canonicalTupleKey([from, node.id]);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from, to: node.id });
    }
  }
  return edges.sort(compareEdges);
}
function labelForNode(id) {
  return id === "" ? "node" : `node '${id}'`;
}
function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareNodes(a, b) {
  return compareText(a.id, b.id);
}
function compareEdges(a, b) {
  return compareText(a.from, b.from) || compareText(a.to, b.to);
}
function compareTopologies(a, b) {
  return compareText(a.mountId ?? "", b.mountId ?? "") || compareText(stableJsonString(a), stableJsonString(b));
}
function compareIssues(a, b) {
  return compareText(a.code, b.code) || compareText(a.nodeId ?? "", b.nodeId ?? "") || compareText(a.from ?? "", b.from ?? "") || compareText(a.to ?? "", b.to ?? "");
}

// packages/ts/src/graph/checkpoint.ts
var GRAPH_CHECKPOINT_VERSION = "graphrefly.checkpoint.v1";
function toCheckpointJson(value, path = "$") {
  try {
    return strictJsonCodec.decode(strictJsonCodec.encode(value));
  } catch (cause) {
    throw new TypeError(`checkpoint: value at ${path} is not strict JSON compatible`, {
      cause
    });
  }
}
function checkpointValue(value, hasData, path) {
  if (!hasData || value === SENTINEL) return { kind: "SENTINEL" };
  return { kind: "DATA", data: toCheckpointJson(value, path) };
}
function checkpointTerminal(value, path) {
  if (value === void 0) return { kind: "none" };
  if (value === true) return { kind: "COMPLETE" };
  return { kind: "ERROR", error: toCheckpointJson(value, path) };
}
var backendStateContributors = /* @__PURE__ */ new WeakMap();
function checkpointBackendStateOfNode(node, path) {
  const contributor = backendStateContributors.get(node);
  if (contributor === void 0) return void 0;
  return toCheckpointJson(contributor(), path);
}

// packages/ts/src/graph/describe.ts
function topologyFromDescribe(snapshot) {
  const nodes = snapshot.nodes.map((node) => {
    const topologyNode = {
      id: node.id,
      factory: node.factory,
      deps: [...node.deps]
    };
    if (node.name !== void 0) topologyNode.name = node.name;
    if (node.meta !== void 0) topologyNode.meta = cloneTopologyMeta(node.meta);
    return topologyNode;
  });
  const out = {
    nodes,
    edges: snapshot.edges.map((edge) => ({ from: edge.from, to: edge.to }))
  };
  if (snapshot.mountId !== void 0) out.mountId = snapshot.mountId;
  if (snapshot.name !== void 0) out.name = snapshot.name;
  if (snapshot.subgraphs !== void 0)
    out.subgraphs = snapshot.subgraphs.map(topologyFromDescribe);
  return out;
}
function cloneTopologyMeta(meta) {
  return cloneTopologyValue(meta, /* @__PURE__ */ new WeakMap());
}
function cloneTopologyValue(value, seen) {
  if (value === null) return null;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return value;
  if (kind === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("topology(): meta must be finite JSON-compatible data (D39/D173)");
    }
    return value;
  }
  if (kind !== "object") {
    throw new Error("topology(): meta must be JSON-compatible data (D39/D173)");
  }
  const objectValue = value;
  const cached = seen.get(objectValue);
  if (cached !== void 0) return cached;
  if (Array.isArray(value)) {
    const out2 = new Array(value.length);
    seen.set(objectValue, out2);
    for (let i = 0; i < value.length; i += 1) {
      if (!(i in value)) {
        throw new Error("topology(): meta arrays must be dense JSON-compatible data (D39/D173)");
      }
      out2[i] = cloneTopologyValue(value[i], seen);
    }
    return out2;
  }
  const proto = Object.getPrototypeOf(objectValue);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error("topology(): meta must be plain JSON-compatible data (D39/D173)");
  }
  const out = {};
  seen.set(objectValue, out);
  for (const [key, item] of Object.entries(value))
    out[key] = cloneTopologyValue(item, seen);
  return out;
}

// packages/ts/src/graph/graph-lifecycle.ts
var restoreRegistrars = /* @__PURE__ */ new WeakMap();
var lifecycleRegistrars = /* @__PURE__ */ new WeakMap();

// packages/ts/src/graph/graph-support.ts
function isNonAuthoritativeCollectionHelperMeta(meta) {
  return meta?.kind === "collection_delta" || meta?.kind === "collection_intent" || meta?.kind === "collection_policy_apply" || meta?.kind === "collection_snapshot" || meta?.kind === "collection_snapshot_prep";
}
function assertCheckpointQuiescentStatus(status, id, op) {
  if (status === "pending" || status === "dirty") {
    throw new Error(
      `${op}: node '${id}' has non-quiescent status '${status}' that cannot be checkpoint-restored yet`
    );
  }
}
function topologyPathMatches(eventPath, path) {
  return eventPath === path || eventPath.startsWith(`${path}::`);
}
function prefixTopologyPath(prefix, path) {
  return `${prefix}::${path}`;
}
function cloneTopologyEvent(event) {
  const deps = Object.freeze([...event.deps]);
  const prevDeps = event.prevDeps === void 0 ? void 0 : Object.freeze([...event.prevDeps]);
  return Object.freeze({
    kind: event.kind,
    path: event.path,
    deps,
    ...prevDeps !== void 0 ? { prevDeps } : {},
    ...event.factory !== void 0 ? { factory: event.factory } : {},
    seq: event.seq
  });
}
function checkpointFactory(name, node, unregistered, restore, meta) {
  const state = checkpointStateOfNode(node);
  if (unregistered) {
    return {
      kind: "local-only",
      name,
      reason: "node is an unregistered live dependency auto-discovered from topology"
    };
  }
  if (restore === void 0 && typeof meta?.kind === "string" && meta.kind.startsWith("collection_")) {
    return {
      kind: "local-only",
      name,
      reason: "collection helper node has no backend checkpoint restore metadata"
    };
  }
  if (restore !== void 0) {
    const out = {
      kind: "registry-ref",
      ref: toCheckpointJson(restore.ref, `${name}.factory.ref`)
    };
    if (restore.config !== void 0)
      out.config = toCheckpointJson(restore.config, `${name}.factory.config`);
    if (restore.configVersion !== void 0)
      out.configVersion = toCheckpointJson(restore.configVersion, `${name}.factory.configVersion`);
    return out;
  }
  if (state.handle !== null) {
    return {
      kind: "local-only",
      name,
      reason: "node uses a function body; first-cut checkpoints do not serialize local functions"
    };
  }
  return { kind: "registry-ref", ref: name };
}
function explainSubset(snap, chain) {
  const fwd = /* @__PURE__ */ new Map();
  const rev = /* @__PURE__ */ new Map();
  const push = (map, k, v) => {
    const a = map.get(k);
    if (a) a.push(v);
    else map.set(k, [v]);
  };
  for (const e of snap.edges) {
    push(fwd, e.from, e.to);
    push(rev, e.to, e.from);
  }
  const reach = (start, adj) => {
    const seen = /* @__PURE__ */ new Set([start]);
    const stack = [start];
    while (stack.length > 0) {
      const cur = stack.pop();
      for (const nxt of adj.get(cur) ?? []) {
        if (!seen.has(nxt)) {
          seen.add(nxt);
          stack.push(nxt);
        }
      }
    }
    return seen;
  };
  const onPath = new Set([...reach(chain.from, fwd)].filter((id) => reach(chain.to, rev).has(id)));
  return {
    ...snap.name !== void 0 ? { name: snap.name } : {},
    nodes: snap.nodes.filter((n) => onPath.has(n.id)),
    edges: snap.edges.filter((e) => onPath.has(e.from) && onPath.has(e.to))
  };
}

// packages/ts/src/graph/graph-topology-group.ts
var GraphTopologyGroup = class {
  name;
  _graph;
  _members = [];
  _released = false;
  constructor(graph2, opts = {}) {
    this._graph = graph2;
    this.name = opts.name;
  }
  get released() {
    return this._released;
  }
  add(node) {
    this._assertLive();
    const lifecycle = lifecycleRegistrars.get(this._graph);
    if (lifecycle === void 0) throw new Error("topologyGroup: graph lifecycle unavailable");
    lifecycle.assertRegisteredNode(node, `topology group '${this.name ?? "group"}' member`);
    if (!this._members.includes(node)) this._members.push(node);
    return node;
  }
  node(deps = [], fn = null, opts = {}) {
    this._assertLive();
    return this.add(this._graph.node(deps, fn, opts));
  }
  state(initial, opts = {}) {
    this._assertLive();
    return this.add(this._graph.state(initial, opts));
  }
  producer(fn, opts = {}) {
    this._assertLive();
    return this.add(this._graph.producer(fn, opts));
  }
  derived(deps, fn, opts = {}) {
    this._assertLive();
    return this.add(this._graph.derived(deps, fn, opts));
  }
  effect(deps, fn, opts = {}) {
    this._assertLive();
    return this.add(this._graph.effect(deps, fn, opts));
  }
  initNode(op, deps, opts = {}) {
    this._assertLive();
    return this.add(this._graph.initNode(op, deps, opts));
  }
  release(opts = {}) {
    if (this._released) return;
    const lifecycle = lifecycleRegistrars.get(this._graph);
    if (lifecycle === void 0) throw new Error("topologyGroup: graph lifecycle unavailable");
    lifecycle.releaseNodes([...this._members], {
      reason: opts.reason ?? this.name
    });
    this._members.length = 0;
    this._released = true;
  }
  _assertLive() {
    if (this._released) {
      throw new Error(`topology group '${this.name ?? "group"}' has been released (D152)`);
    }
  }
};

// packages/ts/src/graph/operators.ts
function initNodeWithCore(core, op, deps, opts = {}) {
  return withNodeCore(core, () => makeInitNode(op, deps, opts));
}
function makeInitNode(op, deps, opts) {
  const body = operatorNodeFn(op);
  return new Node([...deps], body, { factory: op.factory, ...op.opts, ...opts });
}
function operatorNodeFn(op) {
  return (ctx) => {
    try {
      op.body(ctx);
    } catch (e) {
      ctx.down([["ERROR", errorPayload(e, "operator threw without a valid error payload")]]);
    }
  };
}

// packages/ts/src/graph/graph.ts
function nodeOwner(n) {
  return getNodeOwner(n);
}
function assertGraphLocalNode(owner, n, label) {
  if (isNodeRuntimeReleased(n)) {
    throw new Error(`${label} has been released from its graph lifecycle (D122)`);
  }
  const existing = nodeOwner(n);
  if (existing !== void 0 && existing !== owner) {
    throw new Error(
      `${label} belongs to a different graph; cross-graph deps require a wire bridge`
    );
  }
}
var StateNode = class extends Node {
  set(v) {
    this.down([["DATA", v]]);
  }
};
var Graph = class {
  name;
  _dispatcher;
  _versioning;
  _environment;
  _core = new NodeCore();
  _entries = /* @__PURE__ */ new Map();
  _byId = /* @__PURE__ */ new Map();
  _retiredIds = /* @__PURE__ */ new Set();
  _mounts = [];
  _seq = 0;
  _clock = 0;
  // graph-local monotonic clock for observe seq (D26)
  _topologyObserverSeq = 0;
  _topologyObservers = /* @__PURE__ */ new Map();
  _topologyDelivering = false;
  _topologyQueue = [];
  // D51: stable synthetic ids for unregistered live deps (runtime *Map inners) auto-discovered by
  // describe(). WeakMap-cached so successive describes agree + the inner's id is freed when it is.
  // A dedicated counter (NOT _seq) so a describe() call never perturbs registered-node id numbering.
  _synthSeq = 0;
  _synthIds = /* @__PURE__ */ new WeakMap();
  constructor(opts = {}) {
    this.name = opts.name;
    this._dispatcher = opts.dispatcher ?? defaultDispatcher;
    this._versioning = opts.versioning;
    this._environment = opts.environment ?? EnvironmentDrivers.empty();
    if (opts.profile) this._dispatcher.setRecording(true);
    restoreRegistrars.set(this, {
      stateNode: (id, stateOpts = {}) => {
        const n = this._construct(() => new StateNode([], null, this._nodeOpts(stateOpts)));
        this._addWithId(n, "state", [], stateOpts, id);
        return n;
      },
      node: (id, factory, deps, fn, nodeOpts = {}) => {
        this._assertDepsLocal(deps, `dep of restored '${id}'`);
        const n = this._construct(() => new Node([...deps], fn, this._nodeOpts(nodeOpts)));
        this._addWithId(n, factory, deps, nodeOpts, id);
        return n;
      }
    });
    lifecycleRegistrars.set(this, {
      assertRegisteredNode: (node, label) => this._assertRegisteredNode(node, label),
      releaseNodes: (nodes, releaseOpts) => this._releaseNodes(nodes, releaseOpts)
    });
  }
  // ── registration / inspection index ──
  _add(n, factory, deps, opts) {
    const id = opts.name ?? `${factory}#${this._seq++}`;
    return this._addWithId(n, factory, deps, opts, id);
  }
  _addWithId(n, factory, deps, opts, id) {
    assertGraphLocalNode(this, n, `graph node '${opts.name ?? factory}'`);
    for (const dep of deps) assertGraphLocalNode(this, dep, `dep of '${opts.name ?? factory}'`);
    if (this._byId.has(id)) {
      throw new Error(`graph: duplicate node id '${id}' (checkpoint/describe ids must be unique)`);
    }
    if (this._retiredIds.has(id)) {
      throw new Error(`graph: node id '${id}' was released and cannot be reused (D152/D153)`);
    }
    const meta = opts.meta === void 0 ? void 0 : normalizeTopologyMeta(opts.meta, `graph node '${id}' meta`);
    this._entries.set(n, {
      node: n,
      id,
      name: opts.name,
      factory,
      deps,
      meta,
      restore: opts.restore
    });
    setNodeOwner(n, this);
    this._byId.set(id, n);
    setNodeTopologyDepsChangedObserver(n, (_node, prevDeps, nextDeps) => {
      this._emitTopologyDepsChanged(n, prevDeps, nextDeps);
    });
    const seqMatch = /#(\d+)$/.exec(id);
    if (seqMatch) this._seq = Math.max(this._seq, Number(seqMatch[1]) + 1);
    this._emitTopologyNodeRegistered(n);
    return n;
  }
  _assertDepsLocal(deps, label) {
    for (const dep of deps) assertGraphLocalNode(this, dep, label);
  }
  _assertRegisteredNode(node, label) {
    assertGraphLocalNode(this, node, label);
    if (!this._entries.has(node)) {
      throw new Error(`${label} is not a registered graph node (D152)`);
    }
  }
  _nodeOpts(opts) {
    if (opts.meta !== void 0) {
      normalizeTopologyMeta(opts.meta, `graph node '${opts.name ?? opts.factory ?? "node"}' meta`);
    }
    const { name: _n, meta: _m, restore: _r, ...rest } = opts;
    return {
      ...rest,
      versioning: rest.versioning ?? this._versioning,
      dispatcher: this._dispatcher
    };
  }
  _construct(create) {
    return withEnvironmentDrivers(this._environment, () => withNodeCore(this._core, create));
  }
  /** Look up a registered node by its id. */
  find(id) {
    const local = this._byId.get(id);
    if (local !== void 0) return local;
    const separator = id.indexOf("::");
    if (separator < 0) return void 0;
    const mountPath = id.slice(0, separator);
    const childPath = id.slice(separator + 2);
    return this._mounts.find((mount) => mount.at === mountPath)?.graph.find(childPath);
  }
  _releaseNodes(nodes, _opts = {}) {
    const seen = /* @__PURE__ */ new Set();
    const entries = [];
    for (const node of nodes) {
      if (seen.has(node)) continue;
      seen.add(node);
      const entry = this._entries.get(node);
      if (entry === void 0) continue;
      entries.push({ node, entry });
    }
    const releaseSet = new Set(entries.map(({ node }) => node));
    const releaseIds = new Map(entries.map(({ node, entry }) => [node, entry.id]));
    for (const entry of this._entries.values()) {
      if (releaseSet.has(entry.node)) continue;
      for (const dep of entry.node.deps) {
        if (!releaseSet.has(dep)) continue;
        const depId = releaseIds.get(dep) ?? dep.name ?? dep.factory ?? "released node";
        throw new Error(
          `graph: cannot release node group; '${entry.id}' still depends on '${depId}' (D122)`
        );
      }
    }
    for (const { node, entry } of entries) {
      if (!isNodeRuntimeQuiescentForRelease(node)) {
        throw new Error(
          `graph: cannot release node group; '${entry.id}' is not runtime-quiescent (D124)`
        );
      }
      let internalSubscribers = 0;
      for (const { node: dependent } of entries) {
        if (dependent === node || !isNodeActiveForRelease(dependent)) continue;
        for (const dep of dependent.deps) {
          if (dep === node) internalSubscribers += 1;
        }
      }
      if (subscriberCountOfNode(node) > internalSubscribers) {
        throw new Error(
          `graph: cannot release node group; '${entry.id}' still has live subscribers (D124)`
        );
      }
    }
    const releasedEvents = this._topologyObservers.size === 0 ? [] : entries.map(({ node, entry }) => ({
      path: entry.id,
      factory: entry.factory,
      deps: this._topologyDeps(node.deps)
    }));
    for (const { node, entry } of entries) {
      this._entries.delete(node);
      this._byId.delete(entry.id);
      this._retiredIds.add(entry.id);
    }
    let releaseError;
    for (const { node } of entries) {
      try {
        releaseRuntimeOfNode(node);
      } catch (error) {
        if (releaseError === void 0) releaseError = error;
      }
    }
    for (const event of releasedEvents) this._emitTopologyNodeReleased(event);
    if (releaseError !== void 0) throw releaseError;
  }
  // ── 8 verbs (core: node/state/batch + sugar: producer/derived/effect/mount) ──
  /** ctx-level power surface: a raw `(ctx)=>void` fn (or a passthrough/state when null). */
  node(deps = [], fn = null, opts = {}) {
    this._assertDepsLocal(deps, `dep of '${opts.name ?? "node"}'`);
    const n = this._construct(() => new Node(deps, fn, this._nodeOpts(opts)));
    return this._add(n, opts.factory ?? "node", deps, opts);
  }
  /** A manual source with `.set(v)` (L4-Q1). */
  state(initial, opts = {}) {
    const n = this._construct(
      () => new StateNode([], null, { ...this._nodeOpts(opts), initial })
    );
    this._add(n, "state", [], opts);
    return n;
  }
  /** ctx-level depless source; its fn runs on activation (R-rom-ram). */
  producer(fn, opts = {}) {
    const n = this._construct(() => new Node([], fn, this._nodeOpts(opts)));
    return this._add(n, "producer", [], opts);
  }
  /** value-level pure transform: deps → value (D27 wrapped; D30 throw→ERROR). */
  derived(deps, fn, opts = {}) {
    this._assertDepsLocal(deps, `dep of '${opts.name ?? "derived"}'`);
    const ctxFn = (ctx) => {
      try {
        const args = Array.from(
          { length: depCount(ctx) },
          (_, i) => depLatest(ctx, i)
        );
        const result = fn(...args);
        if (result !== void 0) ctx.down([["DATA", result]]);
      } catch (e) {
        ctx.down([["ERROR", errorPayload(e, "derived threw without a valid error payload")]]);
      }
    };
    const n = this._construct(() => new Node([...deps], ctxFn, this._nodeOpts(opts)));
    return this._add(n, "derived", deps, opts);
  }
  /** value-level sink: deps → effect; return value (a fn) becomes onDeactivation (D28). */
  effect(deps, fn, opts = {}) {
    this._assertDepsLocal(deps, `dep of '${opts.name ?? "effect"}'`);
    const ctxFn = (ctx) => {
      try {
        const args = Array.from(
          { length: depCount(ctx) },
          (_, i) => depLatest(ctx, i)
        );
        const cleanup = fn(...args);
        if (typeof cleanup === "function") ctx.onDeactivation(cleanup);
      } catch (e) {
        ctx.down([["ERROR", errorPayload(e, "effect threw without a valid error payload")]]);
      }
    };
    const n = this._construct(() => new Node([...deps], ctxFn, this._nodeOpts(opts)));
    return this._add(n, "effect", deps, opts);
  }
  /** Declarative batch (D12): one wave, success→commit / throw→rollback. */
  batch(fn) {
    return batch(fn);
  }
  /** Embed a child graph addressable under `at` (R-mount; mount has no deps). */
  mount(child, opts) {
    if (typeof opts.at !== "string" || opts.at.length === 0) {
      throw new TypeError("graph.mount: at must be a non-empty string");
    }
    if (this._mounts.some((mounted) => mounted.at === opts.at)) {
      throw new Error(`graph.mount: duplicate sibling mount id '${opts.at}'`);
    }
    const mount = { at: opts.at, graph: child };
    this._mounts.push(mount);
    if (this._topologyObservers.size > 0) this._ensureMountedTopologyForwarders();
    this._emitTopologyMountChanged(opts.at);
  }
  // ── operator funnel (D43): instantiate any free-standing Operator (node sugar, D6/L1.5) ──
  // g.initNode is the single graph-bound entry for the whole operator/source catalog (D40):
  // it delegates to the FREE initNode (graph/operators.ts — the D30 throw→ERROR boundary +
  // dispatcher binding live there) and records the operator's REAL factory name in the
  // inspection index (_add) so describe shows it (D6/R-describe) while the node stays thin
  // (R-node-thin). Operators are free-standing factory definitions (graph/operators.ts,
  // graph/sources.ts) usable bare via the free initNode(); this funnel is the inspectable
  // path. Replaces the per-operator methods.
  /**
   * Instantiate an operator (or source) factory as a registered graph node. `deps` are
   * type-checked against the operator's input element type; the output type flows from the
   * operator. A source is a depless operator — pass `[]`. Caller `opts` (name/meta/behavioral
   * overrides) win over the operator's baked-in `opts`.
   */
  initNode(op, deps, opts = {}) {
    const entryOpts = op.restore !== void 0 && !("restore" in opts) ? { ...opts, restore: op.restore } : opts;
    for (const dep of deps)
      assertGraphLocalNode(this, dep, `dep of '${entryOpts.name ?? op.factory}'`);
    const erased = deps;
    const n = withEnvironmentDrivers(
      this._environment,
      () => initNodeWithCore(this._core, op, erased, this._nodeOpts(entryOpts))
    );
    return this._add(n, op.factory, erased, entryOpts);
  }
  /**
   * Graph-owned activation root for internal helper nodes. This is the sanctioned keepalive shape:
   * a graph, not a helper closure, owns the subscription and returns the release handle.
   */
  retain(node, opts = {}) {
    assertGraphLocalNode(this, node, opts.reason ?? "retained node");
    return node.subscribe(() => {
    });
  }
  /**
   * D152 graph-owned topology/release group. Members are ordinary registered graph nodes;
   * release is quiescent-only and removes ids atomically without synthesizing protocol messages.
   */
  topologyGroup(opts = {}) {
    return new GraphTopologyGroup(this, opts);
  }
  // ── inspection: describe / observe / profile (D39) ──
  /** Live point-in-time structure snapshot (R-describe / D39 / D51). `_prefix` carries the mount path. */
  describe(opts = {}, _prefix = "") {
    const discovered = /* @__PURE__ */ new Map();
    const localId = (n) => {
      const e = this._entries.get(n);
      if (e) return `${_prefix}${e.id}`;
      let sid = this._synthIds.get(n);
      if (sid === void 0) {
        do {
          sid = `~${n.factory ?? "?"}#${this._synthSeq++}`;
        } while (this._byId.has(sid));
        this._synthIds.set(n, sid);
      }
      discovered.set(n, sid);
      return `${_prefix}${sid}`;
    };
    const nodes = [];
    const edges = [];
    for (const entry of this._entries.values()) {
      const id = `${_prefix}${entry.id}`;
      const liveIds = entry.node.deps.map(localId);
      const dnode = {
        id,
        factory: entry.factory,
        status: entry.node.status,
        deps: liveIds
      };
      if (entry.name !== void 0) dnode.name = entry.name;
      if (entry.node.cache !== void 0) dnode.value = entry.node.cache;
      if (entry.node.version !== void 0) dnode.version = entry.node.version;
      if (entry.meta !== void 0) dnode.meta = entry.meta;
      nodes.push(dnode);
      for (const from of liveIds) edges.push({ from, to: id });
    }
    const visited = /* @__PURE__ */ new Set();
    const queue = [...discovered.keys()];
    for (let i = 0; i < queue.length; i += 1) {
      const inner = queue[i];
      if (visited.has(inner)) continue;
      visited.add(inner);
      const sid = discovered.get(inner);
      if (sid === void 0) continue;
      const liveIds = inner.deps.map(localId);
      for (const dep of inner.deps) {
        if (!this._entries.has(dep) && !visited.has(dep)) queue.push(dep);
      }
      const dnode = {
        id: `${_prefix}${sid}`,
        factory: inner.factory ?? "?",
        status: inner.status,
        deps: liveIds
      };
      if (inner.cache !== void 0) dnode.value = inner.cache;
      if (inner.version !== void 0) dnode.version = inner.version;
      nodes.push(dnode);
      for (const from of liveIds) edges.push({ from, to: dnode.id });
    }
    const snap = { nodes, edges };
    if (this.name !== void 0) snap.name = this.name;
    if (this._mounts.length > 0) {
      snap.subgraphs = this._mounts.map((m) => {
        const child = m.graph.describe({}, `${_prefix}${m.at}::`);
        child.mountId = m.at;
        return child;
      });
    }
    return opts.explain ? explainSubset(snap, opts.explain) : snap;
  }
  /**
   * D173 pure-structure topology snapshot over the same live truth source as describe().
   * Runtime status/value/version remain on describe(); blueprint metadata is a later envelope.
   */
  topology() {
    return topologyFromDescribe(this.describe());
  }
  /**
   * D177 synchronous audit/collaboration envelope over the pure topology snapshot.
   * Hashing and environment provenance enrichment stay in pure helpers outside Graph core.
   */
  blueprint(opts = {}) {
    const topology = normalizeTopology(this.topology());
    const out = {
      version: GRAPH_BLUEPRINT_VERSION,
      topology
    };
    if (opts.diagnostics) {
      out.diagnostics = graphBlueprintDiagnostics(topology);
    }
    if (opts.provenance !== void 0) {
      out.provenance = normalizeTopologyMeta(
        opts.provenance,
        "graph blueprint provenance",
        "provenance"
      );
    }
    return out;
  }
  _observeTargets(path) {
    const all = [...this._entries.values()].map((e) => [
      e.id,
      e.node
    ]);
    if (path === void 0) return all;
    const exact = this._byId.get(path);
    if (exact) return [[path, exact]];
    return all.filter(([id]) => id.startsWith(`${path}::`));
  }
  /**
   * observe(path?) = read-only enveloped EGRESS (R-observe / D39). NOT a graph node — it
   * taps the target node(s) via subscribe and forwards each Message as an ObserveEvent.
   * No path = whole graph; an exact id = a single node; otherwise a `::`-prefix subtree.
   */
  // NOTE (R-observe/D19): observe is a real, lazily-ACTIVATING subscriber — observing a
  // cold node runs its fn (and activates upstream); whole-graph observe() activates the
  // graph. "Read-only" means it never emits/mutates node state, NOT that it avoids
  // activation. Use it knowing inspection of a cold graph wakes it.
  observe(path) {
    const targets = this._observeTargets(path);
    return {
      subscribe: (sink) => {
        const unsubs = targets.map(
          ([id, n]) => n.subscribe((msg) => {
            sink({ path: id, msg, tier: messageTier(msg[0]), seq: this._clock++ });
          })
        );
        return () => {
          for (const u of unsubs) u();
        };
      }
    };
  }
  /**
   * D145 observeTopology(path?) = read-only graph lifecycle egress over the existing
   * graph registry. It is not a graph node, does not subscribe to nodes, and emits no DATA.
   */
  observeTopology(path) {
    return {
      subscribe: (sink) => {
        const id = this._topologyObserverSeq++;
        this._topologyObservers.set(id, { path, sink });
        this._ensureMountedTopologyForwarders();
        return () => {
          this._topologyObservers.delete(id);
          if (this._topologyObservers.size === 0) this._releaseMountedTopologyForwarders();
        };
      }
    };
  }
  _idForTopologyNode(n) {
    const e = this._entries.get(n);
    if (e) return e.id;
    let sid = this._synthIds.get(n);
    if (sid === void 0) {
      do {
        sid = `~${n.factory ?? "?"}#${this._synthSeq++}`;
      } while (this._byId.has(sid));
      this._synthIds.set(n, sid);
    }
    return sid;
  }
  _topologyDeps(deps) {
    return deps.map((dep) => this._idForTopologyNode(dep));
  }
  _emitTopologyNodeRegistered(node) {
    if (this._topologyObservers.size === 0) return;
    const entry = this._entries.get(node);
    if (entry === void 0) return;
    this._emitTopologyEvent({
      kind: "node-registered",
      path: entry.id,
      factory: entry.factory,
      deps: this._topologyDeps(node.deps),
      seq: this._clock++
    });
  }
  _emitTopologyDepsChanged(node, prevDeps, nextDeps) {
    if (this._topologyObservers.size === 0) return;
    const entry = this._entries.get(node);
    if (entry === void 0) return;
    this._emitTopologyEvent({
      kind: "deps-changed",
      path: entry.id,
      prevDeps: this._topologyDeps(prevDeps),
      deps: this._topologyDeps(nextDeps),
      seq: this._clock++
    });
  }
  _emitTopologyNodeReleased(event) {
    if (this._topologyObservers.size === 0) return;
    this._emitTopologyEvent({
      kind: "node-released",
      path: event.path,
      factory: event.factory,
      deps: [...event.deps],
      seq: this._clock++
    });
  }
  _emitTopologyMountChanged(path) {
    if (this._topologyObservers.size === 0) return;
    this._emitTopologyEvent({
      kind: "mount-changed",
      path,
      factory: "mount",
      deps: [],
      seq: this._clock++
    });
  }
  _ensureMountedTopologyForwarders() {
    if (this._topologyObservers.size === 0) return;
    for (const mount of this._mounts) {
      if (mount.topologyUnsub !== void 0) continue;
      const mountPath = mount.at;
      mount.topologyUnsub = mount.graph.observeTopology().subscribe((event) => {
        this._emitMountedTopologyEvent(mountPath, event);
      });
    }
  }
  _releaseMountedTopologyForwarders() {
    for (const mount of this._mounts) {
      mount.topologyUnsub?.();
      mount.topologyUnsub = void 0;
    }
  }
  _emitMountedTopologyEvent(mountPath, event) {
    if (this._topologyObservers.size === 0) return;
    this._emitTopologyEvent({
      kind: event.kind,
      path: prefixTopologyPath(mountPath, event.path),
      deps: event.deps.map((dep) => prefixTopologyPath(mountPath, dep)),
      ...event.prevDeps !== void 0 ? { prevDeps: event.prevDeps.map((dep) => prefixTopologyPath(mountPath, dep)) } : {},
      ...event.factory !== void 0 ? { factory: event.factory } : {},
      seq: this._clock++
    });
  }
  _emitTopologyEvent(event) {
    if (this._topologyDelivering) {
      this._topologyQueue.push(event);
      return;
    }
    this._topologyDelivering = true;
    try {
      let current = event;
      while (current !== void 0) {
        const observers = [...this._topologyObservers.entries()];
        for (const [id, observer] of observers) {
          if (this._topologyObservers.get(id) !== observer) continue;
          if (observer.path !== void 0 && !topologyPathMatches(current.path, observer.path))
            continue;
          try {
            observer.sink(cloneTopologyEvent(current));
          } catch {
          }
        }
        current = this._topologyQueue.shift();
      }
    } finally {
      this._topologyDelivering = false;
    }
  }
  /**
   * profile() = accumulated-counter snapshot (R-profile / D39). invokes + duration are
   * dispatcher-backed (the invoke funnel, F-DISPATCH-ALL) — counters never live on the
   * thin node (R-node-thin). Requires `graph({ profile: true })` (opt-in, F-PERF).
   */
  profile() {
    const nodes = {};
    let totalInvokes = 0;
    for (const e of this._entries.values()) {
      const h = e.node.handle;
      const stat = h ? this._dispatcher.statFor(h) : void 0;
      const invokes = stat?.invokes ?? 0;
      nodes[e.id] = {
        invokes,
        totalDurationNs: stat?.totalDurationNs ?? 0,
        lastDurationNs: stat?.lastDurationNs ?? 0,
        status: e.node.status
      };
      totalInvokes += invokes;
    }
    return { totalInvokes, nodes };
  }
  /** Versioned graph lifecycle checkpoint (R-snapshot / D83 / D90). Pure capture, no storage I/O. */
  checkpoint() {
    return this._checkpoint("", /* @__PURE__ */ new WeakSet());
  }
  _checkpoint(_prefix, stack) {
    if (stack.has(this)) {
      throw new Error("checkpoint: cyclic graph mount detected");
    }
    stack.add(this);
    const discovered = /* @__PURE__ */ new Map();
    const localId = (n) => {
      const e = this._entries.get(n);
      if (e) return `${_prefix}${e.id}`;
      let sid = this._synthIds.get(n);
      if (sid === void 0) {
        do {
          sid = `~${n.factory ?? "?"}#${this._synthSeq++}`;
        } while (this._byId.has(sid));
        this._synthIds.set(n, sid);
      }
      discovered.set(n, sid);
      return `${_prefix}${sid}`;
    };
    const nodes = [];
    const edges = [];
    for (const entry of this._entries.values()) {
      const id = `${_prefix}${entry.id}`;
      const liveIds = entry.node.deps.map(localId);
      nodes.push(
        this._checkpointNode(entry.node, id, {
          name: entry.name,
          factory: checkpointFactory(entry.factory, entry.node, false, entry.restore, entry.meta),
          deps: liveIds,
          meta: entry.meta
        })
      );
      for (const from of liveIds) edges.push({ from, to: id });
    }
    const visited = /* @__PURE__ */ new Set();
    const queue = [...discovered.keys()];
    for (let i = 0; i < queue.length; i += 1) {
      const inner = queue[i];
      if (visited.has(inner)) continue;
      visited.add(inner);
      const sid = discovered.get(inner);
      if (sid === void 0) continue;
      const liveIds = inner.deps.map(localId);
      for (const dep of inner.deps) {
        if (!this._entries.has(dep) && !visited.has(dep)) queue.push(dep);
      }
      const id = `${_prefix}${sid}`;
      nodes.push(
        this._checkpointNode(inner, id, {
          factory: checkpointFactory(inner.factory ?? "?", inner, true),
          deps: liveIds
        })
      );
      for (const from of liveIds) edges.push({ from, to: id });
    }
    const checkpoint = {
      version: GRAPH_CHECKPOINT_VERSION,
      nodes,
      edges
    };
    if (this.name !== void 0) checkpoint.name = this.name;
    if (this._mounts.length > 0) {
      checkpoint.mounts = this._mounts.map((m) => ({
        at: m.at,
        checkpoint: m.graph._checkpoint("", stack)
      }));
    }
    stack.delete(this);
    return toCheckpointJson(checkpoint, "checkpoint");
  }
  _checkpointNode(node, id, opts) {
    const state = checkpointStateOfNode(node);
    assertCheckpointQuiescentStatus(node.status, id, "checkpoint");
    const nonAuthoritativeCollectionHelper = isNonAuthoritativeCollectionHelperMeta(opts.meta);
    const out = {
      id,
      factory: opts.factory,
      status: node.status,
      deps: opts.deps,
      value: nonAuthoritativeCollectionHelper ? { kind: "SENTINEL" } : checkpointValue(state.cache, state.hasData, `${id}.value`),
      terminal: checkpointTerminal(state.terminal, `${id}.terminal`),
      lifecycle: { activated: state.activated, hasCalledFnOnce: state.hasCalledFnOnce },
      ctxState: {
        persist: state.ctxState.persist,
        value: nonAuthoritativeCollectionHelper ? { kind: "SENTINEL" } : checkpointValue(
          state.ctxState.value,
          state.ctxState.value !== SENTINEL,
          `${id}.ctxState`
        )
      }
    };
    if (opts.name !== void 0) out.name = opts.name;
    const backendState = checkpointBackendStateOfNode(node, `${id}.backendState`);
    if (backendState !== void 0) out.backendState = backendState;
    if (state.version !== void 0) out.version = state.version;
    if (opts.meta !== void 0)
      out.meta = toCheckpointJson(opts.meta, `${id}.meta`);
    return out;
  }
};
function graph(opts = {}) {
  return new Graph(opts);
}

// packages/ts/runners/local-untrusted-js/runner.ts
var COMPATIBILITY_REVISION = "graphrefly-local-untrusted-js-compute-v1";
var RUNNER_API_REVISION = "graphrefly-runner-api-v1";
var GRAPHREFLY_PACKAGE_REVISION = "graphrefly-ts:0.7.0";
var INPUT_PATHS = ["/input/bundle.mjs", "/input/input.json", "/input/control.json"];
var MAX_RUNNER_NODES = 1e3;
var MAX_RUNNER_EDGES = 2e3;
var SAFE_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
var PRELUDE = `
(() => {
	"use strict";
	const stringify = JSON.stringify.bind(JSON);
	const parse = JSON.parse.bind(JSON);
	const freeze = Object.freeze.bind(Object);
	const keys = Object.keys.bind(Object);
	const hasOwn = Object.prototype.hasOwnProperty.call.bind(Object.prototype.hasOwnProperty);
	const nodeHandle = Symbol("graphrefly-runner-node");
	const safeName = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
	const computeById = Object.create(null);
	let declared = false;

	const cloneJson = (value, label) => {
		let encoded;
		try {
			encoded = stringify(value);
		} catch {
			throw new TypeError(label + " must be JSON data.");
		}
		if (encoded === undefined) throw new TypeError(label + " must be JSON data.");
		return parse(encoded);
	};
	const deepFreeze = (value) => {
		if (value !== null && typeof value === "object") {
			for (const key of keys(value)) deepFreeze(value[key]);
			freeze(value);
		}
		return value;
	};
	const exactNode = (value, byId) => {
		if (
			value === null ||
			typeof value !== "object" ||
			value[nodeHandle] !== true ||
			typeof value.id !== "string" ||
			!hasOwn(byId, value.id)
		) throw new TypeError("GraphReFly dependency must be a node created by this run.");
		return value;
	};
	const name = (value, label) => {
		if (typeof value !== "string" || !safeName.test(value) || value.includes("::"))
			throw new TypeError(label + " must be a safe unique name.");
		return value;
	};

	const declare = async (main, admittedInputJson) => {
		if (declared) throw new TypeError("The GraphReFly runner accepts one declaration.");
		declared = true;
		if (typeof main !== "function")
			throw new TypeError("The admitted bundle must export one default function.");
		if (typeof admittedInputJson !== "string")
			throw new TypeError("Admitted input must cross as canonical JSON text.");
		const admittedInput = parse(admittedInputJson);
		const nodes = [];
		const byId = Object.create(null);
		const names = new Set();
		let graphName = "local-code-workgraph";
		let graphDeclared = false;
		let sequence = 0;
		const add = (kind, nodeName, deps, value, meta, compute) => {
			const safeNodeName = name(nodeName, "Node name");
			if (names.has(safeNodeName)) throw new TypeError("GraphReFly node names must be unique.");
			names.add(safeNodeName);
			const id = "node-" + (++sequence);
			const plan = {
				id,
				kind,
				name: safeNodeName,
				deps: deps.map((dep) => exactNode(dep, byId).id),
				...(kind === "source" ? { value: cloneJson(value, "Source value") } : {}),
				...(meta === undefined ? {} : { meta: cloneJson(meta, "Node metadata") }),
			};
			nodes.push(plan);
			if (kind === "derived") computeById[id] = compute;
			const handle = freeze({
				[nodeHandle]: true,
				id,
				...(kind === "source"
					? { value: deepFreeze(cloneJson(plan.value, "Source value")) }
					: {}),
			});
			byId[id] = handle;
			return handle;
		};
		const api = freeze({
			graph(value) {
				if (graphDeclared) throw new TypeError("A run may declare only one GraphReFly graph.");
				graphDeclared = true;
				graphName = name(value, "Graph name");
				return graphName;
			},
			source(nodeName, value, meta) {
				return add("source", nodeName, [], value, meta);
			},
			derive(nodeName, deps, compute, meta) {
				if (!Array.isArray(deps) || typeof compute !== "function")
					throw new TypeError("GraphReFly derive needs node dependencies and a compute function.");
				const exactDeps = deps.map((dep) => exactNode(dep, byId));
				return add("derived", nodeName, exactDeps, undefined, meta, compute);
			},
			value(node) {
				const exact = exactNode(node, byId);
				if (!hasOwn(exact, "value"))
					throw new TypeError("A derived value is available only from the actual Graph runtime.");
				return exact.value;
			},
		});
		const input = deepFreeze(cloneJson(admittedInput, "Admitted input"));
		const returned = exactNode(await main(freeze({ graphrefly: api, input })), byId);
		return stringify({
			graphName,
			answerNodeId: returned.id,
			nodes,
		});
	};
		const compute = (nodeId, dependencyValuesJson) => {
			const computeFn =
				typeof nodeId === "string" && hasOwn(computeById, nodeId)
					? computeById[nodeId]
					: undefined;
			if (
				typeof nodeId !== "string" ||
				typeof computeFn !== "function" ||
				typeof dependencyValuesJson !== "string"
			) throw new TypeError("GraphReFly derived computation is unavailable.");
			const dependencyValues = deepFreeze(
				cloneJson(parse(dependencyValuesJson), "Derived dependency values"),
			);
			if (!Array.isArray(dependencyValues))
				throw new TypeError("Derived dependency values must be an array.");
			const value = Reflect.apply(computeFn, undefined, dependencyValues);
		if (value !== null && (typeof value === "object" || typeof value === "function")) {
			if (typeof value.then === "function")
				throw new TypeError("GraphReFly derive must be synchronous.");
		}
		return stringify(cloneJson(value, "Derived value"));
	};
	const controller = freeze({ declare, compute });
	for (const intrinsic of [
		Object,
		Array,
		Function,
		Promise,
		Map,
		Set,
		WeakMap,
		WeakSet,
		RegExp,
		Date,
		Error,
		TypeError,
		Number,
		String,
		Boolean,
		Symbol,
		BigInt,
		JSON,
		Math,
		Reflect,
	]) {
		if (intrinsic && intrinsic.prototype) freeze(intrinsic.prototype);
		freeze(intrinsic);
	}
	return controller;
})();
`;
function record(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function exactKeys(value, expected, label) {
  const observed = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (observed.length !== wanted.length || observed.some((key, index) => key !== wanted[index]))
    throw new TypeError(`${label} has an invalid shape.`);
}
function safeString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512)
    throw new TypeError(`${label} is invalid.`);
  return value;
}
function digest(value, label) {
  const text = safeString(value, label);
  if (!/^sha256:[a-f0-9]{64}$/.test(text)) throw new TypeError(`${label} is invalid.`);
  return text;
}
function parseControl(value) {
  if (!record(value)) throw new TypeError("Runner control must be an object.");
  exactKeys(
    value,
    [
      "contractVersion",
      "compatibilityRevision",
      "runnerApiRevision",
      "manifestFingerprint",
      "args",
      "runAdmissionId"
    ],
    "Runner control"
  );
  if (value.contractVersion !== "1" || value.compatibilityRevision !== COMPATIBILITY_REVISION || value.runnerApiRevision !== RUNNER_API_REVISION || !record(value.args) || value.args.graphreflyPackageRevision !== GRAPHREFLY_PACKAGE_REVISION)
    throw new TypeError("Runner control identity is invalid.");
  safeString(value.manifestFingerprint, "Manifest fingerprint");
  safeString(value.runAdmissionId, "Run admission id");
  const args = value.args;
  for (const key of [
    "runId",
    "sourceRevision",
    "bundleRevision",
    "compilerRevision",
    "allowedApiRevision",
    "graphreflyPackageRevision",
    "runnerRevision"
  ])
    safeString(args[key], key);
  for (const key of ["sourceDigest", "bundleDigest", "runnerImageDigest", "inputDigest"])
    digest(args[key], key);
  if (args.contractVersion !== "1" || !Number.isSafeInteger(args.attempt) || args.attempt < 1 || !Array.isArray(args.admittedInputRefs) || args.admittedInputRefs.length === 0 || args.admittedInputRefs.some((entry) => typeof entry !== "string" || entry.length === 0))
    throw new TypeError("Runner arguments are invalid.");
  return value;
}
function parseJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TypeError(`${label} must be valid JSON.`);
  }
}
function parsePlan(value) {
  if (!record(value)) throw new TypeError("Runner plan must be an object.");
  exactKeys(value, ["graphName", "answerNodeId", "nodes"], "Runner plan");
  if (typeof value.graphName !== "string" || !SAFE_NAME.test(value.graphName) || value.graphName.includes("::") || typeof value.answerNodeId !== "string" || !Array.isArray(value.nodes) || value.nodes.length === 0 || value.nodes.length > MAX_RUNNER_NODES)
    throw new TypeError("Runner plan identity or node bound is invalid.");
  const ids = /* @__PURE__ */ new Set();
  const names = /* @__PURE__ */ new Set();
  let edgeCount = 0;
  const nodes = value.nodes.map((entry) => {
    if (!record(entry)) throw new TypeError("Runner plan node must be an object.");
    const expected = entry.kind === "source" ? entry.meta === void 0 ? ["id", "kind", "name", "deps", "value"] : ["id", "kind", "name", "deps", "value", "meta"] : entry.meta === void 0 ? ["id", "kind", "name", "deps"] : ["id", "kind", "name", "deps", "meta"];
    exactKeys(entry, expected, "Runner plan node");
    if (typeof entry.id !== "string" || !/^node-[1-9][0-9]*$/.test(entry.id) || ids.has(entry.id) || entry.kind !== "source" && entry.kind !== "derived" || typeof entry.name !== "string" || !SAFE_NAME.test(entry.name) || entry.name.includes("::") || names.has(entry.name) || !Array.isArray(entry.deps) || entry.deps.some((dep) => typeof dep !== "string" || !ids.has(dep)) || entry.kind === "source" && entry.deps.length !== 0 || entry.kind === "derived" && entry.deps.length === 0)
      throw new TypeError("Runner plan node identity or dependency is invalid.");
    ids.add(entry.id);
    names.add(entry.name);
    edgeCount += entry.deps.length;
    if (edgeCount > MAX_RUNNER_EDGES) throw new TypeError("Runner plan edge bound is invalid.");
    const canonical = JSON.parse(
      new TextDecoder().decode(strictCanonicalJsonBytes(entry))
    );
    return canonical;
  });
  if (!ids.has(value.answerNodeId))
    throw new TypeError("Runner answer must identify a node created by this run.");
  return { graphName: value.graphName, answerNodeId: value.answerNodeId, nodes };
}
async function evaluateBundle(bundleSource, input) {
  const context = createContext(/* @__PURE__ */ Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
    name: "graphrefly-local-untrusted-js"
  });
  const controller = new Script(PRELUDE, {
    filename: "graphrefly-runner-prelude.js"
  }).runInContext(context);
  const rejectDynamicImport = new Script(
    `() => Promise.reject(
			new TypeError("Dynamic imports are not admitted by the GraphReFly runner API."),
		)`,
    {
      filename: "graphrefly-runner-import-policy.js"
    }
  ).runInContext(context);
  const userModule = new SourceTextModule(bundleSource, {
    context,
    identifier: "graphrefly:user-bundle",
    initializeImportMeta(meta) {
      Object.freeze(meta);
    },
    importModuleDynamically() {
      return rejectDynamicImport();
    }
  });
  await userModule.link(() => {
    throw new TypeError("Imports are not admitted by the GraphReFly runner API.");
  });
  await userModule.evaluate();
  const main2 = Reflect.get(userModule.namespace, "default");
  const declare = Reflect.get(controller, "declare");
  const encoded = await Reflect.apply(declare, void 0, [
    main2,
    new TextDecoder().decode(strictCanonicalJsonBytes(input))
  ]);
  if (typeof encoded !== "string") throw new TypeError("Runner plan serialization failed.");
  const plan = parsePlan(JSON.parse(encoded));
  const compute = Reflect.get(controller, "compute");
  return {
    plan,
    compute(nodeId, dependencyValues) {
      const computed = Reflect.apply(compute, void 0, [
        nodeId,
        new TextDecoder().decode(strictCanonicalJsonBytes(dependencyValues))
      ]);
      if (typeof computed !== "string")
        throw new TypeError("Runner derived result serialization failed.");
      const value = JSON.parse(computed);
      strictCanonicalJsonBytes(value);
      return value;
    }
  };
}
function materializeResult(evaluated, control) {
  const { plan } = evaluated;
  const runtimeGraph = graph({ name: plan.graphName });
  const group = runtimeGraph.topologyGroup({ name: "local-untrusted-js-runner" });
  const nodes = /* @__PURE__ */ new Map();
  const releases = [];
  let result;
  let failure;
  let cleanupFailure;
  try {
    for (const node of plan.nodes) {
      const opts = node.meta === void 0 ? { name: node.name } : { name: node.name, meta: node.meta };
      if (node.kind === "source") {
        nodes.set(node.id, group.state(node.value, opts));
        continue;
      }
      const deps = node.deps.map((id) => {
        const dep = nodes.get(id);
        if (dep === void 0) throw new TypeError("Runner plan dependency is unavailable.");
        return dep;
      });
      const derived = group.derived(
        deps,
        (...dependencyValues) => evaluated.compute(node.id, dependencyValues),
        opts
      );
      nodes.set(node.id, derived);
    }
    const answerNode = nodes.get(plan.answerNodeId);
    if (answerNode === void 0) throw new TypeError("Runner answer node is unavailable.");
    const answerPlan = plan.nodes.find((node) => node.id === plan.answerNodeId);
    if (answerPlan === void 0) throw new TypeError("Runner answer plan is unavailable.");
    releases.push(runtimeGraph.retain(answerNode, { reason: "local untrusted JS runner answer" }));
    if (answerNode.cache === void 0)
      throw new TypeError("Runner answer node did not produce a Graph value.");
    const answer = JSON.parse(
      new TextDecoder().decode(strictCanonicalJsonBytes(answerNode.cache))
    );
    const topology = runtimeGraph.topology();
    const describe = runtimeGraph.describe();
    result = {
      contractVersion: "1",
      answer,
      topology,
      describe,
      provenance: {
        sourceRevision: control.args.sourceRevision,
        sourceDigest: control.args.sourceDigest,
        bundleRevision: control.args.bundleRevision,
        bundleDigest: control.args.bundleDigest,
        compilerRevision: control.args.compilerRevision,
        allowedApiRevision: control.args.allowedApiRevision,
        graphreflyPackageRevision: GRAPHREFLY_PACKAGE_REVISION,
        runnerRevision: control.args.runnerRevision,
        runnerImageDigest: control.args.runnerImageDigest,
        manifestFingerprint: control.manifestFingerprint,
        runId: control.args.runId,
        attempt: control.args.attempt,
        graphName: plan.graphName,
        answerNodeId: answerPlan.name,
        admittedInputRefs: [...control.args.admittedInputRefs],
        inputDigest: control.args.inputDigest,
        runAdmissionId: control.runAdmissionId
      },
      cleanup: {
        graphNodesAfterDispose: 0,
        graphEdgesAfterDispose: 0
      }
    };
  } catch (error) {
    failure = error;
  } finally {
    for (const release of releases.reverse()) release();
    group.release({ reason: "local untrusted JS runner settled" });
    const after = runtimeGraph.topology();
    if (after.nodes.length !== 0 || after.edges.length !== 0 || after.subgraphs !== void 0)
      cleanupFailure = new Error("Runner Graph did not dispose to 0N/0E.");
  }
  if (failure !== void 0) throw failure;
  if (cleanupFailure !== void 0) throw cleanupFailure;
  if (result === void 0) throw new Error("Runner result was not materialized.");
  return result;
}
async function main() {
  if (process.argv.length !== 5 || INPUT_PATHS.some((path, index) => process.argv[index + 2] !== path))
    throw new TypeError("Runner requires the fixed bundle, input and control paths.");
  const [bundleBytes, inputBytes, controlBytes] = await Promise.all(
    INPUT_PATHS.map((path) => readFile(path))
  );
  const control = parseControl(parseJson(controlBytes, "Runner control"));
  const observedBundleDigest = `sha256:${createHash("sha256").update(bundleBytes).digest("hex")}`;
  const observedInputDigest = `sha256:${createHash("sha256").update(strictCanonicalJsonBytes(parseJson(inputBytes, "Admitted input"))).digest("hex")}`;
  if (observedBundleDigest !== control.args.bundleDigest || observedInputDigest !== control.args.inputDigest)
    throw new TypeError("Runner material digest mismatch.");
  const input = parseJson(inputBytes, "Admitted input");
  const evaluated = await evaluateBundle(new TextDecoder().decode(bundleBytes), input);
  const result = materializeResult(evaluated, control);
  process.stdout.write(strictCanonicalJsonBytes(result));
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : "Local untrusted JS runner failed.";
  process.stderr.write(`${message}
`);
  process.exitCode = 1;
});
