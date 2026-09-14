// spending-host-call-local-worker.ts
import assert from "node:assert/strict";
import { performance as performance2 } from "node:perf_hooks";

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
function depWaves(ctx, depIndex) {
  return ctx.waveData[depIndex] ?? [];
}
function depBatch(ctx, depIndex) {
  const waves = depWaves(ctx, depIndex);
  if (waves.length === 0) return null;
  const flattened = waves.flat().filter((v) => v !== SENTINEL);
  return flattened.length === 0 ? [] : flattened;
}
function depLatest(ctx, depIndex) {
  return ctx[CTX_DEP_CACHE]?.latest[depIndex];
}

// packages/ts/src/batch/boundary.ts
var depth = 0;
var pendingCores = [];
var pendingHead = 0;
function isWaveActive() {
  return depth !== 0;
}
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

// packages/ts/src/node/node-runtime-host.ts
function nodeRuntimeHost(node) {
  return node;
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
function assertNoDuplicateJsonObjectKeys(text2) {
  let index = 0;
  function fail(message) {
    throw new TypeError(`strictJsonCodec: ${message}`);
  }
  function skipWhitespace() {
    while (/\s/.test(text2[index] ?? "")) index += 1;
  }
  function readJsonString() {
    const start = index;
    index += 1;
    while (index < text2.length) {
      const ch = text2[index];
      if (ch === '"') {
        index += 1;
        try {
          return JSON.parse(text2.slice(start, index));
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
    if (text2.slice(index, index + literal.length) !== literal) {
      fail(`malformed JSON near byte ${index}`);
    }
    index += literal.length;
  }
  function consumeNumber() {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text2.slice(index));
    if (!match) fail(`malformed JSON number near byte ${index}`);
    index += match[0].length;
  }
  function parseValue(path) {
    skipWhitespace();
    const ch = text2[index];
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
    const keys3 = /* @__PURE__ */ new Set();
    index += 1;
    skipWhitespace();
    if (text2[index] === "}") {
      index += 1;
      return;
    }
    while (index < text2.length) {
      skipWhitespace();
      if (text2[index] !== '"') fail(`expected object key near byte ${index}`);
      const key = readJsonString();
      if (keys3.has(key)) {
        throw new TypeError(
          `strictJsonCodec: duplicate object key ${JSON.stringify(key)} at ${path}`
        );
      }
      keys3.add(key);
      skipWhitespace();
      if (text2[index] !== ":") fail(`expected ':' after object key near byte ${index}`);
      index += 1;
      parseValue(`${path}.${key}`);
      skipWhitespace();
      if (text2[index] === ",") {
        index += 1;
        continue;
      }
      if (text2[index] === "}") {
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
    if (text2[index] === "]") {
      index += 1;
      return;
    }
    let item = 0;
    while (index < text2.length) {
      parseValue(`${path}[${item}]`);
      item += 1;
      skipWhitespace();
      if (text2[index] === ",") {
        index += 1;
        continue;
      }
      if (text2[index] === "]") {
        index += 1;
        return;
      }
      fail(`expected ',' or ']' near byte ${index}`);
    }
    fail("unterminated JSON array");
  }
  parseValue("$");
  skipWhitespace();
  if (index !== text2.length) fail(`trailing JSON token near byte ${index}`);
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
      const text2 = decoder.decode(bytes);
      assertNoDuplicateJsonObjectKeys(text2);
      const decoded = JSON.parse(text2);
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
  let hash2 = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of input) {
    hash2 ^= BigInt(byte);
    hash2 = BigInt.asUintN(64, hash2 * prime);
  }
  return hash2.toString(16).padStart(16, "0");
}
function defaultNodeVersionHash(bytes) {
  return `fnv1a64:${fnv1a64(bytes)}`;
}
function computeV1Cid(policy2, value) {
  return policy2.hash(strictCanonicalJsonBytes(value));
}
function assertNodeVersionDataCompatible(policy2, value) {
  if (!policy2.enabled || policy2.level === 0) return;
  strictCanonicalJsonBytes(value);
}
function snapshotNodeVersionData(policy2, value) {
  if (!policy2.enabled || policy2.level === 0) return value;
  const bytes = strictCanonicalJsonBytes(value);
  return strictJsonCodec.decode(bytes);
}
function resolveNodeVersioningPolicy(policy2) {
  if (policy2 === false) return { enabled: false };
  if (policy2 === void 0 || policy2 === 0) return { enabled: true, level: 0 };
  if (policy2 === 1) return { enabled: true, level: 1, hash: defaultNodeVersionHash };
  if (typeof policy2 === "object" && policy2 !== null) {
    if (policy2.level === 0) return { enabled: true, level: 0 };
    if (policy2.level === 1) {
      return { enabled: true, level: 1, hash: policy2.hash ?? defaultNodeVersionHash };
    }
  }
  throw new Error("node: versioning level must be 0 or 1; V2/V3 are not locked yet (D109)");
}
function createNodeVersion(policy2, initialValue = ABSENT_V1_SEED) {
  if (!policy2.enabled) return void 0;
  if (policy2.level === 0) return Object.freeze({ level: 0, counter: 0 });
  return Object.freeze({
    level: 1,
    counter: 0,
    cid: computeV1Cid(policy2, initialValue),
    prev: null
  });
}
function advanceNodeVersion(current, policy2, value) {
  if (!policy2.enabled) return void 0;
  if (current === void 0) return createNodeVersion(policy2, value);
  if (policy2.level === 0) {
    return Object.freeze({ level: 0, counter: current.counter + 1 });
  }
  const previous = current.level === 1 ? current.cid : null;
  return Object.freeze({
    level: 1,
    counter: current.counter + 1,
    cid: computeV1Cid(policy2, value),
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

// packages/ts/src/node/runtime-accessors.ts
var constructingCore;
var constructingEnvironment;
var registrations = /* @__PURE__ */ new WeakMap();
function issueNodeRegistration(node) {
  registrations.set(node, { kind: "live", host: nodeRuntimeHost(node) });
}
function liveRegistration(node) {
  const record = registrations.get(node);
  return record?.kind === "live" ? record : void 0;
}
function closeNodeRegistration(node) {
  registrations.set(node, { kind: "retired" });
}
function setRuntimeReleaseFailures(node, failures) {
  const record = registrations.get(node);
  if (record?.kind !== "retired") throw new Error("release: node access is not closed");
  record.failures = failures;
}
function runtimeReleaseFailuresOfNode(node) {
  const record = registrations.get(node);
  return record?.kind === "retired" ? record.failures : void 0;
}
function nodeBackendContributor(node) {
  return liveRegistration(node)?.backendContributor;
}
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
  return liveRegistration(n)?.graphAttachment?.owner;
}
function nodeOwnerForGraphUse(n, label) {
  const record = registrations.get(n);
  if (record?.kind === "retired" || record?.kind === "live" && record.host._released) {
    throw new Error(`${label} has been released from its graph lifecycle (D122)`);
  }
  return record?.kind === "live" ? record.graphAttachment?.owner : void 0;
}
function setNodeOwner(n, owner) {
  const record = liveRegistration(n);
  if (record === void 0) throw new Error("graph: unknown node state");
  record.graphAttachment = { owner };
}
function setNodeTopologyDepsChangedObserver(n, observer) {
  const attachment = liveRegistration(n)?.graphAttachment;
  if (attachment === void 0) throw new Error("graph: unknown node owner");
  attachment.observer = observer;
}
function notifyTopologyDepsChanged(node, prevDeps, deps) {
  liveRegistration(node)?.graphAttachment?.observer?.(node, prevDeps, deps);
}
function checkpointStateOfNode(n) {
  const self = liveRegistration(n)?.host;
  if (self === void 0) throw new Error("checkpoint: unknown node state");
  return {
    cache: self._value.cache,
    hasData: self._value.hasData,
    terminal: self._value.terminal,
    activated: self._lifecycle.activated,
    hasCalledFnOnce: self._wave.hasCalledFnOnce,
    ctxState: { value: self._privateState.value, persist: self._privateState.persist },
    version: cloneNodeVersion(self._version.value),
    handle: self._slot.handle
  };
}
function releaseRuntimeOfNode(n) {
  liveRegistration(n)?.host._releaseRuntime();
}
function isNodeRuntimeQuiescentForRelease(n) {
  return liveRegistration(n)?.host._isRuntimeQuiescentForRelease() ?? false;
}
function subscriberCountOfNode(n) {
  return liveRegistration(n)?.host._subscriberCount() ?? 0;
}
function isNodeActiveForRelease(n) {
  return liveRegistration(n)?.host._lifecycle.activated ?? false;
}
function isNodeRuntimeReleased(n) {
  const record = registrations.get(n);
  return record?.kind === "retired" || record?.kind === "live" && record.host._released;
}

// packages/ts/src/node/owned-acquisition.ts
var constructionAcquisitions = /* @__PURE__ */ new WeakMap();
function cleanupNodeAcquisition(a) {
  if (a.registered) return [];
  if (a.node !== void 0) {
    try {
      releaseRuntimeOfNode(a.node);
    } catch (cause) {
      return runtimeReleaseFailuresOfNode(a.node) ?? [
        {
          resource: "runtime",
          cause,
          core: a.core,
          slot: a.slot,
          dispatcher: a.dispatcher,
          handle: a.handle
        }
      ];
    }
    return runtimeReleaseFailuresOfNode(a.node) ?? [];
  }
  const failures = [];
  if (a.handle !== void 0) {
    try {
      a.dispatcher.unregister(a.handle);
    } catch (cause) {
      failures.push({ resource: "handle", cause, handle: a.handle, dispatcher: a.dispatcher });
    }
  }
  if (a.slot !== void 0) {
    try {
      a.core.releaseSlot(a.slot);
    } catch (cause) {
      failures.push({ resource: "slot", cause, core: a.core, slot: a.slot });
    }
  }
  return failures;
}
function failNodeAcquisition(a, cause) {
  const failures = cleanupNodeAcquisition(a);
  if (failures.length === 0) throw cause;
  throw new ColdNodeAcquisitionError(cause, failures);
}
var ColdNodeAcquisitionError = class extends Error {
  cleanupErrors;
  constructor(cause, failures) {
    super("node: construction failed with residual resources", { cause });
    this.name = "ColdNodeAcquisitionError";
    this.cleanupErrors = Object.freeze([...failures]);
  }
};

// packages/ts/src/graph/graph-lifecycle.ts
var graphRegistrations = /* @__PURE__ */ new WeakMap();

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
  createSlot(slot, state, acquisition) {
    const id = this.nextId++;
    if (acquisition !== void 0) {
      acquisition.core = this;
      acquisition.slot = id;
    }
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
  const dep = {
    batch: new Array(depCount2),
    waveData: new Array(depCount2),
    waveTokens: new Array(depCount2),
    waveLive: new Array(depCount2),
    prev: new Array(depCount2),
    hasData: new Array(depCount2),
    dirty: new Array(depCount2),
    tier: new Array(depCount2),
    terminal: new Array(depCount2),
    terminalInput: new Array(depCount2),
    unsubs: [],
    idxBoxes: []
  };
  for (let i = 0; i < depCount2; i++) {
    dep.batch[i] = null;
    dep.waveData[i] = [];
    dep.waveTokens[i] = void 0;
    dep.waveLive[i] = [];
    dep.prev[i] = SENTINEL;
    dep.hasData[i] = false;
    dep.dirty[i] = false;
    dep.tier[i] = 0;
    dep.terminal[i] = void 0;
    dep.terminalInput[i] = void 0;
  }
  return dep;
}

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
  const sink = (msg, delivery) => {
    if (ignoreInitialPush && delivery === void 0) return;
    if (ignoreInitialPush) ignoreInitialPush = false;
    if (box.v === -1) return;
    self._receiveFromDep(box.v, msg, delivery);
  };
  nodeRuntimeHost(depNode)._subscribeOwned(sink, {
    record: (release) => {
      if (idx0 !== -1) {
        self._dep.unsubs[idx0] = release;
        self._dep.idxBoxes[idx0] = box;
      }
    }
  });
  if (ignoreInitialPush && idx0 !== -1 && box.v !== -1) self._seedRestoredDepAt(idx0, depNode);
  ignoreInitialPush = false;
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
  const releaseErrors = [];
  const recordReleaseError = (error, resource, handle) => {
    releaseErrors.push({
      cause: error,
      resource,
      ...handle === void 0 ? {} : { handle, dispatcher: self._slot.dispatcher }
    });
  };
  self._lifecycle.activated = false;
  for (const u of self._dep.unsubs) {
    try {
      u?.();
    } catch (error) {
      recordReleaseError(error, "subscription");
    }
  }
  for (const fn of self._hooks.onDeactivation) {
    try {
      fn();
    } catch (error) {
      recordReleaseError(error, "deactivation");
    }
  }
  self._dep.unsubs = [];
  self._dep.idxBoxes = [];
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
  closeNodeRegistration(node);
  try {
    self._core.releaseSlot(self._id);
  } catch (cause) {
    releaseErrors.push({ resource: "slot", cause, core: self._core, slot: self._id });
  }
  if (releaseErrors.length > 0) {
    setRuntimeReleaseFailures(node, Object.freeze(releaseErrors));
    throw releaseErrors[0].cause;
  }
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
  validateNodeRewire(self, newDeps, opts);
  const oldDeps = self._slot.deps;
  const added = newDeps.filter((d) => !oldDeps.includes(d));
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
function validateNodeRewire(self, newDeps, opts = {}) {
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
}

// packages/ts/src/node/node.ts
var Node = class _Node {
  _core;
  _id;
  _slot;
  _dep;
  _value;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
  _wave;
  _control;
  _lifecycle;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: used by the issued runtime host.
  _privateState;
  _hooks;
  _syncCtxState;
  _version;
  _restoredActivationPending = false;
  _released = false;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
  get _syncCtx() {
    return this._syncCtxState.value;
  }
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
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
    const suppliedAcquisition = constructionAcquisitions.get(opts);
    const acquisition = suppliedAcquisition ?? { name: "bare node" };
    constructionAcquisitions.delete(opts);
    const core = takeConstructingNodeCore();
    const dispatcher = opts.dispatcher ?? defaultDispatcher;
    const environment = takeConstructingEnvironmentDrivers() ?? EnvironmentDrivers.empty();
    try {
      const versioning = resolveNodeVersioningPolicy(opts.versioning);
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
      if (handle !== null && typeof handleOrFn === "function") {
        acquisition.dispatcher = dispatcher;
        acquisition.handle = handle;
      }
      const n = deps.length;
      const dep = makeDepBookkeeping(n);
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
        },
        acquisition
      );
      acquisition.core = this._core;
      acquisition.slot = created.id;
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
      _Node._retainIndirectRuntimeMethods(this);
      issueNodeRegistration(this);
      acquisition.node = this;
    } catch (cause) {
      if (suppliedAcquisition !== void 0) throw cause;
      failNodeAcquisition(acquisition, cause);
    }
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
    return this._subscribeOwned(sink);
  }
  _subscribeOwned(sink, acquisition) {
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
      const unsubscribe = () => {
        if (!this._lifecycle.subscribers.delete(sink)) return;
        if (this._lifecycle.subscribers.size === 0) this._deactivate();
      };
      acquisition?.record(unsubscribe);
      sink(["START"]);
      if (this._slot.replayN > 0 && this._value.replayRing.length > 0) {
        for (const v of this._value.replayRing) sink(["DATA", v]);
      } else if (this._value.hasData && !this._slot.pull) {
        sink(["DATA", this._value.cache]);
      } else if (this._value.status === "dirty" && !this._slot.pull) {
        sink(["DIRTY"]);
      }
      if (!this._lifecycle.activated) this._activate();
      return unsubscribe;
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
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
  _subscriberCount() {
    return nodeSubscriberCount(nodeRuntimeHost(this));
  }
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
  _isRuntimeQuiescentForRelease() {
    return nodeIsRuntimeQuiescentForRelease(nodeRuntimeHost(this));
  }
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
  _releaseRuntime() {
    nodeReleaseRuntime(nodeRuntimeHost(this));
  }
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
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
function checkpointBackendStateOfNode(node, path) {
  const contributor = nodeBackendContributor(node);
  if (contributor === void 0) return void 0;
  return toCheckpointJson(contributor(), path);
}

// packages/ts/src/graph/operators.ts
function initNodeWithCore(core, op, deps, opts = {}, acquired) {
  return withNodeCore(core, () => makeInitNode(op, deps, opts, acquired));
}
function makeInitNode(op, deps, opts, acquired) {
  const body = operatorNodeFn(op);
  const merged = { factory: op.factory, ...op.opts, ...opts };
  if (acquired !== void 0) constructionAcquisitions.set(merged, acquired);
  try {
    return new Node([...deps], body, merged);
  } finally {
    constructionAcquisitions.delete(merged);
  }
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
function merge() {
  return {
    factory: "merge",
    opts: { partial: true },
    body: (ctx) => {
      for (let i = 0; i < depCount(ctx); i++) {
        const b = depBatch(ctx, i);
        if (b && b.length > 0) {
          for (const v of b) ctx.down([["DATA", v]]);
        }
      }
    }
  };
}

// packages/ts/src/graph/construction-scope.ts
var ColdConstructionError = class extends Error {
  constructor(instance, originalCause, cleanupErrors) {
    super(
      `construction ${instance} rejected; cleanup ${cleanupErrors.length === 0 ? "complete" : "incomplete"}${originalCause instanceof Error ? `: ${originalCause.message}` : ""}`
    );
    this.instance = instance;
    this.originalCause = originalCause;
    this.cleanupErrors = cleanupErrors;
  }
  instance;
  originalCause;
  cleanupErrors;
};
function stableBoundary() {
  if (isWaveActive() || currentBatch())
    throw new Error("construction requires a stable wave/batch boundary");
}
function checkInputs(registrar, inputs) {
  const seen = /* @__PURE__ */ new Set();
  const pending = [...inputs];
  while (pending.length > 0) {
    const node = pending.pop();
    if (seen.has(node)) continue;
    seen.add(node);
    registrar.assertRegisteredNode(node, "construction input/dependency");
    const host = nodeRuntimeHost(node);
    if (host._value.terminal !== void 0 && !host._slot.resubscribable)
      throw new Error("construction input is terminal and non-resubscribable");
    pending.push(...node.deps);
  }
}
function prepareConstruction(graph, manifest) {
  stableBoundary();
  const registrar = graphRegistrations.get(graph);
  if (registrar === void 0) throw new Error("construction graph is not registered");
  if (!manifest.name || manifest.name.length > 256 || !Number.isSafeInteger(manifest.epoch) || manifest.epoch < 1)
    throw new TypeError("construction needs a bounded name and positive epoch");
  if (manifest.names.length === 0 || manifest.names.length > 4096 || new Set(manifest.names).size !== manifest.names.length)
    throw new TypeError("construction needs a finite unique name manifest");
  for (const name of manifest.names) {
    if (!name || name.length > 512) throw new TypeError("invalid construction node name");
    registrar.assertAvailableName(name);
  }
  if (registrar.constructions.has(manifest.name))
    throw new Error("construction instance already owned");
  checkInputs(registrar, manifest.inputs);
  return new ConstructionScope(registrar, manifest);
}
var ConstructionScope = class {
  constructor(registrar, manifest) {
    this.registrar = registrar;
    this.manifest = Object.freeze({
      ...manifest,
      names: Object.freeze([...manifest.names]),
      inputs: Object.freeze([...manifest.inputs])
    });
    this.available = new Set(manifest.names);
  }
  registrar;
  phase = "cold";
  acquisitions = [];
  sealedOwner;
  startupNode;
  available;
  manifest;
  /** Private component seam: validate native construction identity without reading business DATA. */
  assertContext(graph, startup, epoch3) {
    if (this.phase !== "cold" || graphRegistrations.get(graph) !== this.registrar || startup !== this.startupNode || epoch3 !== this.manifest.epoch)
      throw new TypeError("causal construction context mismatch");
  }
  node(deps = [], fn = null, opts = {}) {
    if (this.phase !== "cold") throw new Error("construction is sealed");
    const name = opts.name;
    if (name === void 0 || !this.available.delete(name))
      throw new Error("node is outside construction manifest");
    const acquired = {
      name,
      dispatcher: void 0,
      handle: void 0,
      core: void 0,
      slot: void 0,
      node: void 0,
      registered: false
    };
    this.acquisitions.push(acquired);
    return this.registrar.createOwned(deps, fn, opts, acquired);
  }
  initNode(op, deps, opts = {}) {
    return this.node(deps, operatorNodeFn(op), {
      factory: op.factory,
      ...op.opts,
      ...op.restore === void 0 ? {} : { restore: op.restore },
      ...opts
    });
  }
  startupSource() {
    this.startupNode = this.node([], null, {
      name: `${this.manifest.name}/startup`,
      factory: "graphConstructionStartup",
      initial: Object.freeze({
        kind: "graph-startup",
        instance: this.manifest.name,
        epoch: this.manifest.epoch,
        state: "starting"
      })
    });
    return this.startupNode;
  }
  /** Cold inspection only: actual acquired members, never edges synthesized from the manifest. */
  readIncoming() {
    stableBoundary();
    if (this.phase !== "cold") throw new Error("construction is sealed");
    const nodes = /* @__PURE__ */ new Set();
    for (const record of this.acquisitions) {
      if (record.node === void 0 || !record.registered)
        throw new Error("construction resource not registered");
      this.registrar.assertRegisteredNode(record.node, "inspected construction member");
      nodes.add(record.node);
    }
    return this.registrar.readIncoming(nodes);
  }
  seal(startup, roots) {
    stableBoundary();
    if (this.phase !== "cold" || this.available.size !== 0)
      throw new Error("construction topology is incomplete or sealed");
    checkInputs(this.registrar, this.manifest.inputs);
    const nodes = this.acquisitions.map((record) => {
      if (record.node === void 0 || !record.registered)
        throw new Error("construction resource not registered");
      this.registrar.assertRegisteredNode(record.node, "sealed construction member");
      return record.node;
    });
    if (startup !== this.startupNode || !nodes.includes(startup) || new Set(roots).size !== roots.length || roots.includes(startup) || roots.some((root) => !nodes.includes(root)))
      throw new Error("invalid construction root plan");
    this.phase = "sealed";
    this.sealedOwner = {
      instance: this.manifest.name,
      epoch: this.manifest.epoch,
      nodes: Object.freeze(nodes),
      roots: Object.freeze([startup, ...roots].map((node) => ({ node }))),
      startup,
      phase: "owned"
    };
    return this.sealedOwner;
  }
  transferToGraph(owner) {
    if (this.phase !== "sealed" || owner !== this.sealedOwner || owner.instance !== this.manifest.name || this.registrar.constructions.has(owner.instance))
      throw new Error("invalid construction ownership transfer");
    this.registrar.constructions.set(owner.instance, owner);
    this.phase = "transferred";
    this.acquisitions.length = 0;
  }
  abort(cause) {
    if (this.phase === "aborted") throw new Error("construction was already aborted");
    if (this.phase === "transferred")
      throw new Error("cannot cold-abort an owned running instance");
    this.phase = "aborted";
    const errors = [];
    const attempt = (resource, cleanup, locator = {}) => {
      try {
        cleanup();
      } catch (error) {
        errors.push({ ...locator, resource, cause: error });
      }
    };
    const registered = this.acquisitions.filter((a) => a.registered).map((a) => a.node);
    attempt(
      this.manifest.name,
      () => this.registrar.releaseNodes(registered, { reason: "cold construction failure" })
    );
    for (const a of this.acquisitions) {
      if (a.registered) continue;
      for (const failure of cleanupNodeAcquisition(a)) {
        if (a.node === void 0 || runtimeReleaseFailuresOfNode(a.node) === void 0)
          errors.push({ ...failure, resource: `${a.name}:${failure.resource}` });
      }
    }
    const detailed = this.acquisitions.flatMap(
      (a) => a.node === void 0 ? [] : (runtimeReleaseFailuresOfNode(a.node) ?? []).map((failure) => ({
        ...failure,
        resource: `${a.name}:${failure.resource}`
      }))
    );
    if (detailed.length > 0) {
      const nodesWithFailures = new Set(
        this.acquisitions.filter((a) => a.node !== void 0 && runtimeReleaseFailuresOfNode(a.node)).map((a) => a.name)
      );
      for (let i = errors.length - 1; i >= 0; i--) {
        if (errors[i].resource === this.manifest.name || nodesWithFailures.has(errors[i].resource))
          errors.splice(i, 1);
      }
      errors.push(...detailed);
    }
    throw new ColdConstructionError(this.manifest.name, cause, Object.freeze(errors));
  }
};
function startConstruction(graph, owner) {
  stableBoundary();
  if (graphRegistrations.get(graph)?.existingConstructions?.get(owner.instance) !== owner || owner.phase !== "owned")
    throw new Error("construction is not owned or was already started");
  owner.phase = "starting";
  let code;
  try {
    for (const lease of owner.roots) {
      nodeRuntimeHost(lease.node)._subscribeOwned(() => {
      }, {
        record: (release) => {
          lease.unsubscribe = release;
        }
      });
      if (owner.nodes.some(
        (node) => nodeRuntimeHost(node)._value.terminal !== void 0 && nodeRuntimeHost(node)._value.terminal !== true
      )) {
        code = "protocol-error";
        throw new Error("construction startup encountered protocol ERROR");
      }
    }
    owner.phase = "started";
  } catch (error) {
    owner.startupError = error;
    owner.phase = "faulted";
    code ??= "activation-failed";
  }
  const fact = Object.freeze({
    kind: "graph-startup",
    instance: owner.instance,
    epoch: owner.epoch,
    state: owner.phase,
    ...code === void 0 ? {} : { code }
  });
  try {
    owner.startup.down([["DATA", fact]]);
  } catch (error) {
    owner.deliveryError = error;
  }
}

// examples/spending-alerts/causal-publication.ts
import { createHash } from "node:crypto";

// packages/ts/src/solutions/causal-occurrence/capabilities.ts
var issued = /* @__PURE__ */ new WeakMap();
function causalBinding(binding2) {
  if (binding2.contract !== "contract-v2" || binding2.implementationRevision !== "construction-v1" || binding2.scope !== "full" || !Number.isSafeInteger(binding2.epoch) || binding2.epoch < 1 || Object.keys(binding2).length !== 4)
    throw new TypeError("unsupported causal binding or lifecycle epoch");
  return Object.freeze({ ...binding2 });
}
function assertCausalCapabilities(graph, full, binding2) {
  const root = issued.get(full);
  if (root === void 0 || root.graph !== graph || root.level !== "full" || root.binding.contract !== binding2.contract || root.binding.implementationRevision !== binding2.implementationRevision || root.binding.scope !== binding2.scope || root.binding.epoch !== binding2.epoch)
    throw new TypeError("causal capability binding mismatch");
  for (const handle of [full.identity, full.execution, full.retained]) {
    const record = issued.get(handle);
    if (record === void 0 || record.instance !== root.instance || record.graph !== graph)
      throw new TypeError("causal capability lineage mismatch");
  }
  if (full.execution.identity !== full.identity || full.retained.execution !== full.execution)
    throw new TypeError("causal capability lower handle mismatch");
}
function createCausalCapabilities(graph, scope, name, ports, binding2) {
  const causalQuiescence = scope.node(
    [ports.quiescence],
    (ctx) => {
      for (const raw of depBatch(ctx, 0) ?? []) {
        const value = raw;
        ctx.down([
          [
            "DATA",
            Object.freeze({
              kind: value.kind,
              revisionDomain: value.revisionDomain,
              evaluatedThroughRevision: value.evaluatedThroughRevision,
              lifecycle: value.lifecycle,
              pendingOccurrenceRefs: value.pendingOccurrenceRefs,
              pendingEffectIds: value.pendingEffectIds
            })
          ]
        ]);
      }
    },
    { name: `${name}/causal-quiescence`, factory: "causalLifecycleQuiescence" }
  );
  const identity = Object.freeze({
    released: ports.released,
    currentness: ports.currentness,
    issues: ports.issues
  });
  const execution = Object.freeze({
    identity,
    terminals: ports.terminals,
    conservation: ports.conservation,
    causalQuiescence
  });
  const retained = Object.freeze({
    execution,
    coverage: ports.coverage,
    retainedQuiescence: ports.quiescence
  });
  const full = Object.freeze({ identity, execution, retained, startup: ports.startup });
  const instance = Object.freeze({});
  for (const [level, handle] of [
    ["identity", identity],
    ["execution", execution],
    ["retained", retained],
    ["full", full]
  ])
    issued.set(handle, { graph, instance, binding: binding2, level });
  return full;
}

// packages/ts/src/solutions/causal-occurrence/committed-view.ts
function prepareCommittedEffectsView(state, changed, hasFacts, authorityId, binding2) {
  if (!changed && (state.committedEffects !== void 0 || !hasFacts))
    return state.committedEffects;
  const effects = Object.freeze(
    Array.from(
      state.effects.values(),
      (record) => Object.freeze({
        proposal: record.proposal,
        ...record.admission === void 0 ? {} : { admission: record.admission },
        ...record.outcome === void 0 ? {} : { outcome: record.outcome }
      })
    )
  );
  const domains = /* @__PURE__ */ new Set([
    ...state.retentionFloorByDomain.keys(),
    ...state.retentionGapThroughByDomain.keys()
  ]);
  const retention = Object.freeze(
    Array.from(
      domains,
      (revisionDomain) => Object.freeze({
        revisionDomain,
        floor: state.retentionFloorByDomain.get(revisionDomain) ?? 0,
        gapThrough: state.retentionGapThroughByDomain.get(revisionDomain) ?? 0
      })
    )
  );
  return Object.freeze({
    kind: "causal-committed-effects",
    authorityId,
    binding: binding2,
    effects,
    retention
  });
}

// packages/ts/src/identity.ts
function canonicalTupleKey(parts) {
  return JSON.stringify(parts);
}

// packages/ts/src/solutions/causal-occurrence/identity.ts
var digestPattern = /^sha256:[0-9a-f]{64}$/u;
var CAUSAL_OCCURRENCE_SCHEMA_REVISION = "graphrefly/causal-occurrence-contract/v1@contract-v2";
var terminalCoverage = /* @__PURE__ */ new Set([
  "included",
  "excluded",
  "redacted",
  "sampled",
  "external-only",
  "stale",
  "unavailable",
  "retention-gap",
  "skipped-revision"
]);
function issue(code, message, refs = []) {
  return Object.freeze({ kind: "issue", code, message, severity: "error", refs });
}
function dataKey(value) {
  return stableJsonString(value);
}
var sha256Constants = Object.freeze([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function rotateRight(value, count) {
  return value >>> count | value << 32 - count;
}
function sha256(value) {
  const input = new TextEncoder().encode(value);
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 128;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const hash2 = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1)
      words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ words[index - 15] >>> 3;
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ words[index - 2] >>> 10;
      words[index] = words[index - 16] + s0 + words[index - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash2;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = e & f ^ ~e & g;
      const temporary1 = h + sum1 + choice + sha256Constants[index] + words[index] >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = a & b ^ a & c ^ b & c;
      const temporary2 = sum0 + majority >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + temporary1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = temporary1 + temporary2 >>> 0;
    }
    hash2[0] = hash2[0] + a >>> 0;
    hash2[1] = hash2[1] + b >>> 0;
    hash2[2] = hash2[2] + c >>> 0;
    hash2[3] = hash2[3] + d >>> 0;
    hash2[4] = hash2[4] + e >>> 0;
    hash2[5] = hash2[5] + f >>> 0;
    hash2[6] = hash2[6] + g >>> 0;
    hash2[7] = hash2[7] + h >>> 0;
  }
  return `sha256:${[...hash2].map((word) => word.toString(16).padStart(8, "0")).join("")}`;
}
function causalOccurrenceDigest(value) {
  return sha256(
    dataKey({
      schemaRevision: CAUSAL_OCCURRENCE_SCHEMA_REVISION,
      revisionDomain: value.revisionDomain,
      occurrenceId: value.occurrenceId,
      revision: value.revision,
      value: value.value,
      sourceRefs: value.sourceRefs
    })
  );
}
function canonicalSnapshot(value) {
  const freeze2 = (item) => {
    if (item === null || typeof item !== "object") return item;
    if (Array.isArray(item)) return Object.freeze(item.map(freeze2));
    return Object.freeze(
      Object.fromEntries(Object.entries(item).map(([key, child]) => [key, freeze2(child)]))
    );
  };
  return freeze2(JSON.parse(dataKey(value)));
}
function canonicalEntry(value) {
  try {
    return Object.freeze({ key: dataKey(value), snapshot: canonicalSnapshot(value) });
  } catch {
    return void 0;
  }
}
function refKey(value) {
  return canonicalTupleKey([
    value.revisionDomain,
    String(value.revision),
    value.occurrenceId,
    value.digest,
    dataKey(value.sourceRefs)
  ]);
}
function occurrenceIdKey(value) {
  return canonicalTupleKey([value.revisionDomain, value.occurrenceId]);
}
function revisionKey(domain, revision) {
  return canonicalTupleKey([domain, String(revision)]);
}
function effectKey(value) {
  return canonicalTupleKey([refKey(value.occurrence), value.effectId]);
}
function validToken(value) {
  return typeof value === "string" && value.length > 0;
}
function validSourceRef(value) {
  return value !== null && typeof value === "object" && "kind" in value && validToken(value.kind) && "id" in value && validToken(value.id);
}
function validRef(value) {
  return value !== null && typeof value === "object" && "revisionDomain" in value && validToken(value.revisionDomain) && "occurrenceId" in value && validToken(value.occurrenceId) && "revision" in value && Number.isSafeInteger(value.revision) && value.revision > 0 && "digest" in value && typeof value.digest === "string" && digestPattern.test(value.digest) && "sourceRefs" in value && Array.isArray(value.sourceRefs) && value.sourceRefs.length > 0 && value.sourceRefs.every(validSourceRef) && new Set(value.sourceRefs.map((ref3) => canonicalTupleKey([ref3.kind, ref3.id]))).size === value.sourceRefs.length;
}
function validAdmissionState(value) {
  return value === "admitted" || value === "rejected";
}
function validOutcomeState(value) {
  return value === "succeeded" || value === "failed" || value === "cancelled" || value === "reconcile-required" || value === "unknown";
}
function validTerminal(value) {
  return (value.state === "completed" || value.state === "failed" || value.state === "skipped") && validResult(value.result) && value.state === "completed" === (value.result.kind === "ok");
}
function sameRef(left, right) {
  return refKey(left) === refKey(right);
}
function validResult(value) {
  if (value === null || typeof value !== "object") return false;
  if (value.kind === "ok") return Object.hasOwn(value, "value");
  return value.kind === "error" && value.error?.kind === "issue" && validToken(value.error.code) && validToken(value.error.message);
}
function pushIssue(outputs, value) {
  outputs.push({ kind: "issue", value });
}
var retainPending = (opts, outputs, map2, key, value, label) => {
  const prior = map2.get(key);
  if (prior !== void 0) {
    if (dataKey(prior) !== dataKey(value))
      pushIssue(
        outputs,
        issue(
          `causal-occurrence/${label}-conflict`,
          `Pending ${label} replay conflicts with retained DATA.`,
          [key]
        )
      );
    return;
  }
  if (map2.size >= opts.maxPending) {
    pushIssue(
      outputs,
      issue(
        `causal-occurrence/${label}-pending-bound`,
        `Pending ${label} exceeded bounded retention.`,
        [key]
      )
    );
    return;
  }
  map2.set(key, value);
};
function retainDomain(context, domain) {
  const { state, opts, outputs } = context;
  if (state.domains.has(domain)) return true;
  if (state.domains.size >= opts.maxOccurrences) {
    pushIssue(
      outputs,
      issue("causal-occurrence/domain-bound", "Revision-domain retention bound was reached.", [
        domain
      ])
    );
    return false;
  }
  state.domains.add(domain);
  return true;
}
function findOccurrence(context, ref3) {
  const { state } = context;
  return state.byRevision.get(revisionKey(ref3.revisionDomain, ref3.revision))?.value;
}
function exactOccurrence(context, ref3) {
  const retained = findOccurrence(context, ref3);
  return retained !== void 0 && sameRef(retained, ref3) ? retained : void 0;
}
function rejectDefinitiveMissingRef(context, ref3, label) {
  const { state, outputs } = context;
  const retained = findOccurrence(context, ref3);
  const floor = state.retentionFloorByDomain.get(ref3.revisionDomain) ?? 0;
  const highWater = state.highWaterByDomain.get(ref3.revisionDomain) ?? 0;
  if (retained !== void 0 && !sameRef(retained, ref3)) {
    pushIssue(
      outputs,
      issue(
        `causal-occurrence/${label}-occurrence-conflict`,
        `${label} references a conflicting occurrence revision.`,
        [refKey(ref3)]
      )
    );
    return true;
  }
  if (ref3.revision <= floor || ref3.revision <= highWater && retained === void 0) {
    pushIssue(
      outputs,
      issue(
        ref3.revision <= floor ? `causal-occurrence/${label}-retention-gap` : `causal-occurrence/${label}-stale`,
        `${label} references a revision that cannot regain authority.`,
        [refKey(ref3)]
      )
    );
    return true;
  }
  return false;
}
function maybeRelease(context, occurrence3) {
  const { state, outputs } = context;
  const key = refKey(occurrence3);
  const admission = state.admissions.get(key);
  const currentness = state.currentness.get(key);
  if (admission?.state !== "admitted" || !sameRef(admission.occurrence, occurrence3) || currentness?.state !== "current" || state.released.has(key) || currentness.evaluatedThroughRevision < occurrence3.revision)
    return;
  state.released.add(key);
  outputs.push({ kind: "release", value: occurrence3 });
}
function exactAdmission(context, occurrence3) {
  const { state } = context;
  const admission = state.admissions.get(refKey(occurrence3));
  return admission !== void 0 && sameRef(admission.occurrence, occurrence3) ? admission : void 0;
}
function currentnessMetadata(value, occurrence3) {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return;
  const keys3 = Reflect.ownKeys(value);
  if (keys3.length !== 4 || !keys3.every(
    (key) => key === "kind" || key === "occurrence" || key === "evaluatedThroughRevision" || key === "state"
  ))
    return;
  const fields = Object.getOwnPropertyDescriptors(value);
  for (const key of keys3) {
    const field = fields[key];
    if (field === void 0 || !("value" in field) || !field.enumerable) return;
  }
  if (fields.kind.value !== "causal-currentness" || fields.occurrence.value !== occurrence3 || typeof fields.evaluatedThroughRevision.value !== "number" || !Number.isSafeInteger(fields.evaluatedThroughRevision.value) || fields.evaluatedThroughRevision.value < 0 || fields.state.value !== "current" && fields.state.value !== "stale")
    return;
  return {
    kind: fields.kind.value,
    occurrence: null,
    evaluatedThroughRevision: fields.evaluatedThroughRevision.value,
    state: fields.state.value
  };
}
function currentnessChanged(prior, value, occurrence3) {
  if (Object.isFrozen(occurrence3)) {
    const before = currentnessMetadata(prior, occurrence3);
    const after = currentnessMetadata(value, occurrence3);
    if (before !== void 0 && after !== void 0) return dataKey(before) !== dataKey(after);
  }
  return dataKey(prior) !== dataKey(value);
}
function recomputeCurrentness(context, revisionDomain) {
  const { state, outputs } = context;
  const watermark = state.watermarks.get(revisionDomain);
  if (watermark === void 0) return;
  const floor = state.retentionFloorByDomain.get(revisionDomain) ?? 0;
  const occurrences = [...state.byRevision.values()].map((entry) => entry.value).filter((value) => value.revisionDomain === revisionDomain && value.revision <= watermark).sort((left, right) => left.revision - right.revision);
  const evaluated = occurrences.map((occurrence3) => ({
    occurrence: occurrence3,
    admission: exactAdmission(context, occurrence3)
  }));
  const sequenceComplete = (state.highWaterByDomain.get(revisionDomain) ?? 0) >= watermark && (state.retentionGapThroughByDomain.get(revisionDomain) ?? 0) === 0 && ![...state.pending.values()].some(
    (entry) => entry.value.revisionDomain === revisionDomain && entry.value.revision <= watermark
  ) && evaluated.filter(({ occurrence: occurrence3 }) => occurrence3.revision > floor).every(({ admission }) => admission !== void 0);
  const latestAdmitted = /* @__PURE__ */ new Map();
  for (const { occurrence: occurrence3, admission } of evaluated) {
    if (admission?.state === "admitted")
      latestAdmitted.set(occurrenceIdKey(occurrence3), occurrence3);
  }
  for (const { occurrence: occurrence3, admission } of evaluated) {
    const newer = latestAdmitted.get(occurrenceIdKey(occurrence3));
    const value = admission === void 0 || !sequenceComplete ? {
      kind: "causal-currentness",
      occurrence: occurrence3,
      evaluatedThroughRevision: watermark,
      state: "unverifiable",
      ...(state.retentionGapThroughByDomain.get(revisionDomain) ?? 0) > 0 ? {
        gapRef: {
          revisionDomain,
          afterRevision: state.retentionGapThroughByDomain.get(revisionDomain),
          reason: "retention-gap",
          evidenceRef: {
            kind: "causal-evidence",
            id: state.occurrenceRetentionGaps.get(revisionDomain).evidenceId
          }
        }
      } : {}
    } : admission.state === "rejected" ? {
      kind: "causal-currentness",
      occurrence: occurrence3,
      evaluatedThroughRevision: watermark,
      state: "stale"
    } : newer !== void 0 && newer !== occurrence3 ? {
      kind: "causal-currentness",
      occurrence: occurrence3,
      evaluatedThroughRevision: watermark,
      state: "superseded",
      supersededBy: newer
    } : {
      kind: "causal-currentness",
      occurrence: occurrence3,
      evaluatedThroughRevision: watermark,
      state: "current"
    };
    const key = refKey(occurrence3);
    const prior = state.currentness.get(key);
    state.currentness.set(key, value);
    if (prior === void 0 || currentnessChanged(prior, value, occurrence3))
      outputs.push({ kind: "currentness", value });
    maybeRelease(context, occurrence3);
  }
  return { watermark, occurrences, sequenceComplete, latestAdmitted };
}
function flushAdmissions(context) {
  const { state, outputs } = context;
  for (const [key, admission] of state.admissions) {
    const retained = findOccurrence(context, admission.occurrence);
    if (retained !== void 0 && !sameRef(retained, admission.occurrence)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/admission-mismatch",
          "Deferred admission conflicts with the retained occurrence revision.",
          [key]
        )
      );
      state.admissions.delete(key);
    }
    if (retained === void 0 && rejectDefinitiveMissingRef(context, admission.occurrence, "admission"))
      state.admissions.delete(key);
  }
}
function receiveAdmissions(context, arrival) {
  const { state, opts, outputs } = context;
  for (const admission of arrival.values) {
    if (admission === null || typeof admission !== "object" || !validRef(admission.occurrence) || !validToken(admission.decisionId) || typeof admission.decisionDigest !== "string" || !digestPattern.test(admission.decisionDigest) || !validAdmissionState(admission.state)) {
      pushIssue(
        outputs,
        issue("causal-occurrence/invalid-admission", "Occurrence admission identity is invalid.")
      );
      continue;
    }
    const canonical = canonicalEntry(admission);
    if (canonical === void 0) {
      pushIssue(
        outputs,
        issue("causal-occurrence/non-data-admission", "Admission must be canonical DATA.")
      );
      continue;
    }
    if (!retainDomain(context, admission.occurrence.revisionDomain)) continue;
    const key = refKey(admission.occurrence);
    const prior = state.admissions.get(key);
    if (prior !== void 0) {
      if (dataKey(prior) !== canonical.key)
        pushIssue(
          outputs,
          issue(
            "causal-occurrence/admission-conflict",
            "Admission replay conflicts with retained decision.",
            [key]
          )
        );
      continue;
    }
    const retained = findOccurrence(context, admission.occurrence);
    if (retained !== void 0 && !sameRef(retained, admission.occurrence)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/admission-mismatch",
          "Admission does not match the retained occurrence.",
          [key]
        )
      );
      continue;
    }
    if (retained === void 0 && state.admissions.size >= opts.maxPending) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/admission-bound",
          "Unmatched admission exceeded bounded pending retention.",
          [key]
        )
      );
      continue;
    }
    state.admissions.set(key, canonical.snapshot);
  }
}
function receiveWatermarks(context, arrival) {
  const { state, outputs } = context;
  for (const watermark of arrival.values) {
    if (watermark === null || typeof watermark !== "object" || !validToken(watermark.revisionDomain) || !Number.isSafeInteger(watermark.revision) || watermark.revision < 0) {
      pushIssue(outputs, issue("causal-occurrence/invalid-watermark", "Watermark is invalid."));
      continue;
    }
    if (!retainDomain(context, watermark.revisionDomain)) continue;
    const prior = state.watermarks.get(watermark.revisionDomain) ?? 0;
    if (watermark.revision < prior) {
      pushIssue(
        outputs,
        issue("causal-occurrence/stale-watermark", "Watermark cannot move backwards.")
      );
      continue;
    }
    state.watermarks.set(watermark.revisionDomain, watermark.revision);
  }
}

// packages/ts/src/solutions/causal-occurrence/evidence.ts
function emitCoverage(context, occurrence3) {
  const { state, opts, outputs } = context;
  let occurrenceKey2;
  const entries = [...state.evidence.values(), ...state.coverageGaps.values()].filter((value) => {
    const entryKey = refKey(value.occurrence);
    occurrenceKey2 ??= refKey(occurrence3);
    return entryKey === occurrenceKey2;
  });
  const byKind = new Map(entries.map((value) => [value.evidenceKind, value]));
  const missingKinds = opts.requiredEvidenceKinds.filter((kind) => !byKind.has(kind));
  const terminalGapKinds = opts.requiredEvidenceKinds.filter((kind) => {
    const value = byKind.get(kind);
    return value !== void 0 && value.coverage !== "included" && value.coverage !== "external-only";
  });
  outputs.push({
    kind: "coverage",
    value: {
      kind: "causal-evidence-coverage",
      occurrence: occurrence3,
      complete: missingKinds.length === 0 && entries.every(
        (value) => value.coverage !== "retention-gap" && value.coverage !== "skipped-revision"
      ),
      entries: Object.freeze(entries),
      missingKinds: Object.freeze(missingKinds),
      terminalGapKinds: Object.freeze(terminalGapKinds)
    }
  });
}
function retainEvidence(context, key, evidence) {
  const { state, opts, outputs } = context;
  const prior = state.evidence.get(key);
  if (prior !== void 0) {
    if (dataKey(prior) !== dataKey(evidence))
      pushIssue(
        outputs,
        issue("causal-occurrence/evidence-conflict", "Evidence replay conflicts.", [key])
      );
    return;
  }
  if (state.evidence.size >= opts.maxEvidence) {
    pushIssue(
      outputs,
      issue("causal-occurrence/evidence-bound", "Evidence retention bound was reached.", [key])
    );
    const gapKey = JSON.stringify([
      refKey(evidence.occurrence),
      opts.requiredEvidenceKinds.includes(evidence.evidenceKind) ? evidence.evidenceKind : null
    ]);
    if (!state.coverageGaps.has(gapKey))
      state.coverageGaps.set(
        gapKey,
        canonicalSnapshot({ ...evidence, coverage: "retention-gap" })
      );
  } else {
    state.evidence.set(key, evidence);
  }
  emitCoverage(context, evidence.occurrence);
}
function flushEvidence(context) {
  const { state } = context;
  for (const [key, evidence] of state.pendingEvidence) {
    if (exactOccurrence(context, evidence.occurrence) === void 0) {
      if (rejectDefinitiveMissingRef(context, evidence.occurrence, "evidence"))
        state.pendingEvidence.delete(key);
      continue;
    }
    retainEvidence(context, key, evidence);
    state.pendingEvidence.delete(key);
  }
}
function receiveEvidence(context, arrival) {
  const { state, opts, outputs } = context;
  for (const evidence of arrival.values) {
    if (evidence === null || typeof evidence !== "object" || !validRef(evidence.occurrence) || !validToken(evidence.evidenceKind) || !validToken(evidence.evidenceId) || typeof evidence.evidenceDigest !== "string" || !digestPattern.test(evidence.evidenceDigest) || !terminalCoverage.has(evidence.coverage) || evidence.coverage === "external-only" && (!Array.isArray(evidence.refs) || evidence.refs.length === 0 || !evidence.refs.every(validToken))) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/evidence-mismatch",
          "Evidence does not match retained occurrence authority."
        )
      );
      continue;
    }
    const canonical = canonicalEntry(evidence);
    if (canonical === void 0) {
      pushIssue(
        outputs,
        issue("causal-occurrence/non-data-evidence", "Evidence must be canonical DATA.")
      );
      continue;
    }
    if (!retainDomain(context, evidence.occurrence.revisionDomain)) continue;
    const key = canonicalTupleKey([
      refKey(evidence.occurrence),
      evidence.evidenceKind,
      evidence.evidenceId
    ]);
    if (exactOccurrence(context, evidence.occurrence) === void 0) {
      if (rejectDefinitiveMissingRef(context, evidence.occurrence, "evidence")) continue;
      retainPending(opts, outputs, state.pendingEvidence, key, canonical.snapshot, "evidence");
      continue;
    }
    retainEvidence(context, key, canonical.snapshot);
  }
}
function isEvidenceTerminal(context, revisionDomain, domain) {
  const { state, opts } = context;
  const { watermark, occurrences } = domain;
  for (const evidence of state.pendingEvidence.values()) {
    if (evidence.occurrence.revisionDomain === revisionDomain && evidence.occurrence.revision <= watermark)
      return false;
  }
  if (occurrences.length === 0 || opts.requiredEvidenceKinds.length === 0) return true;
  const covered = /* @__PURE__ */ new Map();
  for (const records of [state.evidence, state.coverageGaps]) {
    for (const entry of records.values()) {
      if (entry.occurrence.revisionDomain !== revisionDomain || !terminalCoverage.has(entry.coverage))
        continue;
      const key = refKey(entry.occurrence);
      let kinds = covered.get(key);
      if (kinds === void 0) {
        kinds = /* @__PURE__ */ new Set();
        covered.set(key, kinds);
      }
      kinds.add(entry.evidenceKind);
    }
  }
  return occurrences.every((occurrence3) => {
    const kinds = covered.get(refKey(occurrence3));
    return opts.requiredEvidenceKinds.every((kind) => kinds?.has(kind) === true);
  });
}

// packages/ts/src/solutions/causal-occurrence/lifecycle.ts
function settledForEviction(context, occurrence3) {
  const { state } = context;
  const key = refKey(occurrence3);
  const admission = state.admissions.get(key);
  if (admission?.state === "rejected") return true;
  if (admission?.state !== "admitted" || !state.released.has(key) || !state.emittedTerminals.has(key))
    return false;
  if ([
    ...state.pendingEffectProposals.values(),
    ...state.pendingEffectAdmissions.values(),
    ...state.pendingEffectOutcomes.values()
  ].some((fact) => sameRef(fact.occurrence, occurrence3)))
    return false;
  return [...state.effects.values()].filter((record) => sameRef(record.proposal.occurrence, occurrence3)).every(
    (record) => record.admission?.state === "rejected" || record.admission?.state === "admitted" && record.outcome !== void 0
  );
}
function emitConservation(context, occurrence3) {
  const { state, outputs } = context;
  const records = [...state.effects.values()].filter(
    (record) => sameRef(record.proposal.occurrence, occurrence3)
  );
  const admitted = records.filter((record) => record.admission?.state === "admitted");
  const count = (value) => admitted.filter((record) => record.outcome?.state === value).length;
  outputs.push({
    kind: "conservation",
    value: {
      kind: "causal-effect-conservation",
      occurrence: occurrence3,
      proposed: records.length,
      pendingAdmission: records.filter((record) => record.admission === void 0).length,
      rejected: records.filter((record) => record.admission?.state === "rejected").length,
      admitted: admitted.length,
      active: admitted.filter((record) => record.outcome === void 0).length,
      succeeded: count("succeeded"),
      failed: count("failed"),
      cancelled: count("cancelled"),
      reconcileRequired: count("reconcile-required"),
      unknown: count("unknown")
    }
  });
}
function retainEffectProposal(context, key, proposal) {
  const { state, opts, outputs } = context;
  const pending = state.pendingEffectProposals.get(key);
  if (pending !== void 0 && dataKey(pending) !== dataKey(proposal)) {
    pushIssue(
      outputs,
      issue(
        "causal-occurrence/effect-proposal-conflict",
        "Effect proposal conflicts with its retained pending snapshot.",
        [key]
      )
    );
    return true;
  }
  const prior = state.effects.get(key);
  if (prior !== void 0) {
    if (prior.key !== dataKey(proposal))
      pushIssue(
        outputs,
        issue("causal-occurrence/effect-proposal-conflict", "Effect proposal replay conflicts.", [
          key
        ])
      );
    return true;
  }
  if (state.effects.size >= opts.maxEffects) {
    pushIssue(
      outputs,
      issue("causal-occurrence/effect-bound", "Effect retention bound was reached.", [key])
    );
    return false;
  }
  state.effects.set(key, { proposal, key: dataKey(proposal) });
  context.committedViewChanged = true;
  emitConservation(context, proposal.occurrence);
  return true;
}
function flushEffectsAndTerminals(context) {
  const { state, opts, outputs } = context;
  for (const [key, proposal] of state.pendingEffectProposals) {
    if (exactOccurrence(context, proposal.occurrence) === void 0 && rejectDefinitiveMissingRef(context, proposal.occurrence, "effect-proposal")) {
      state.pendingEffectProposals.delete(key);
      continue;
    }
    if (exactOccurrence(context, proposal.occurrence) === void 0 || !state.released.has(refKey(proposal.occurrence)))
      continue;
    if (retainEffectProposal(context, key, proposal)) state.pendingEffectProposals.delete(key);
  }
  for (const [key, admission] of state.pendingEffectAdmissions) {
    const record = state.effects.get(key);
    if (record === void 0) {
      if (rejectDefinitiveMissingRef(context, admission.occurrence, "effect-admission"))
        state.pendingEffectAdmissions.delete(key);
      continue;
    }
    if (record.proposal.proposalDigest !== admission.proposalDigest || dataKey(record.proposal.requestRef) !== dataKey(admission.requestRef) || !sameRef(record.proposal.occurrence, admission.occurrence)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-admission-mismatch",
          "Deferred effect admission does not match its proposal.",
          [key]
        )
      );
      state.pendingEffectAdmissions.delete(key);
      continue;
    }
    if (record.admission === void 0) {
      state.effects.set(key, { ...record, admission });
      context.committedViewChanged = true;
    } else if (dataKey(record.admission) !== dataKey(admission))
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-admission-conflict",
          "Deferred effect admission conflicts with retained admission.",
          [key]
        )
      );
    state.pendingEffectAdmissions.delete(key);
    emitConservation(context, admission.occurrence);
  }
  for (const [key, outcome2] of state.pendingEffectOutcomes) {
    const record = state.effects.get(key);
    if (record?.admission === void 0) {
      if (rejectDefinitiveMissingRef(context, outcome2.occurrence, "effect-outcome"))
        state.pendingEffectOutcomes.delete(key);
      continue;
    }
    const matches = record.admission.state === "admitted" && record.proposal.proposalDigest === outcome2.proposalDigest && dataKey(record.proposal.requestRef) === dataKey(outcome2.requestRef) && dataKey(record.admission.admissionRef) === dataKey(outcome2.admissionRef) && sameRef(record.proposal.occurrence, outcome2.occurrence) && outcome2.state === "succeeded" === (outcome2.result.kind === "ok");
    if (!matches) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-outcome-mismatch",
          "Deferred effect outcome lacks exact admitted authority.",
          [key]
        )
      );
      state.pendingEffectOutcomes.delete(key);
      continue;
    }
    if (record.outcome === void 0) {
      state.effects.set(key, { ...record, outcome: outcome2 });
      context.committedViewChanged = true;
    } else if (dataKey(record.outcome) !== dataKey(outcome2))
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-outcome-conflict",
          "Deferred effect outcome conflicts with retained outcome.",
          [key]
        )
      );
    state.pendingEffectOutcomes.delete(key);
    emitConservation(context, outcome2.occurrence);
  }
  for (const [pendingKey, terminal] of state.pendingTerminals) {
    const key = refKey(terminal.occurrence);
    if (exactOccurrence(context, terminal.occurrence) === void 0 && rejectDefinitiveMissingRef(context, terminal.occurrence, "terminal")) {
      state.pendingTerminals.delete(pendingKey);
      continue;
    }
    if (exactOccurrence(context, terminal.occurrence) === void 0 || !state.released.has(key))
      continue;
    const branches = state.terminals.get(key) ?? /* @__PURE__ */ new Map();
    const prior = branches.get(terminal.branch);
    if (prior === void 0) branches.set(terminal.branch, terminal);
    else if (dataKey(prior) !== dataKey(terminal))
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/terminal-conflict",
          "Deferred branch terminal conflicts with retained terminal.",
          [key, terminal.branch]
        )
      );
    state.terminals.set(key, branches);
    state.pendingTerminals.delete(pendingKey);
    if (!state.emittedTerminals.has(key) && opts.requiredBranches.every((branch) => branches.has(branch))) {
      state.emittedTerminals.add(key);
      outputs.push({
        kind: "terminal",
        value: {
          kind: "causal-terminal-fan-in",
          occurrence: terminal.occurrence,
          terminals: Object.freeze(opts.requiredBranches.map((branch) => branches.get(branch)))
        }
      });
    }
  }
}
function receiveTerminals(context, arrival) {
  const { state, opts, outputs } = context;
  for (const terminal of arrival.values) {
    if (terminal === null || typeof terminal !== "object" || !validRef(terminal.occurrence) || !validToken(terminal.branch) || !opts.requiredBranches.includes(terminal.branch) || !validTerminal(terminal)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/terminal-mismatch",
          "Terminal does not match an admitted branch occurrence."
        )
      );
      continue;
    }
    const canonical = canonicalEntry(terminal);
    if (canonical === void 0) {
      pushIssue(
        outputs,
        issue("causal-occurrence/non-data-terminal", "Terminal must be canonical DATA.")
      );
      continue;
    }
    if (!retainDomain(context, terminal.occurrence.revisionDomain)) continue;
    const key = refKey(terminal.occurrence);
    const pendingKey = canonicalTupleKey([key, terminal.branch]);
    if (exactOccurrence(context, terminal.occurrence) === void 0 && rejectDefinitiveMissingRef(context, terminal.occurrence, "terminal"))
      continue;
    if (exactOccurrence(context, terminal.occurrence) === void 0 || !state.released.has(key)) {
      retainPending(
        opts,
        outputs,
        state.pendingTerminals,
        pendingKey,
        canonical.snapshot,
        "terminal"
      );
      continue;
    }
    const branches = state.terminals.get(key) ?? /* @__PURE__ */ new Map();
    const prior = branches.get(terminal.branch);
    if (prior !== void 0 && dataKey(prior) !== canonical.key)
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/terminal-conflict",
          "Branch terminal replay conflicts with retained terminal.",
          [key, terminal.branch]
        )
      );
    else if (prior === void 0) branches.set(terminal.branch, canonical.snapshot);
    state.terminals.set(key, branches);
    if (!state.emittedTerminals.has(key) && opts.requiredBranches.every((branch) => branches.has(branch))) {
      state.emittedTerminals.add(key);
      outputs.push({
        kind: "terminal",
        value: {
          kind: "causal-terminal-fan-in",
          occurrence: terminal.occurrence,
          terminals: Object.freeze(opts.requiredBranches.map((branch) => branches.get(branch)))
        }
      });
    }
  }
}
function receiveProposals(context, arrival) {
  const { state, opts, outputs } = context;
  for (const proposal of arrival.values) {
    if (proposal === null || typeof proposal !== "object" || !validRef(proposal.occurrence) || !validToken(proposal.effectId) || !validSourceRef(proposal.requestRef) || typeof proposal.proposalDigest !== "string" || !digestPattern.test(proposal.proposalDigest)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-proposal-mismatch",
          "Effect proposal lacks exact occurrence authority."
        )
      );
      continue;
    }
    const canonical = canonicalEntry(proposal);
    if (canonical === void 0) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/non-data-effect-proposal",
          "Effect proposal must be canonical DATA."
        )
      );
      continue;
    }
    if (!retainDomain(context, proposal.occurrence.revisionDomain)) continue;
    const key = effectKey(proposal);
    if (exactOccurrence(context, proposal.occurrence) === void 0 && rejectDefinitiveMissingRef(context, proposal.occurrence, "effect-proposal"))
      continue;
    if (exactOccurrence(context, proposal.occurrence) === void 0 || !state.released.has(refKey(proposal.occurrence))) {
      retainPending(
        opts,
        outputs,
        state.pendingEffectProposals,
        key,
        canonical.snapshot,
        "effect-proposal"
      );
      continue;
    }
    if (!retainEffectProposal(context, key, canonical.snapshot))
      retainPending(
        opts,
        outputs,
        state.pendingEffectProposals,
        key,
        canonical.snapshot,
        "effect-proposal"
      );
  }
}
function receiveEffectAdmissions(context, arrival) {
  const { state, opts, outputs } = context;
  for (const admission of arrival.values) {
    if (admission === null || typeof admission !== "object" || !validRef(admission.occurrence) || !validToken(admission.effectId) || !validSourceRef(admission.requestRef) || !validSourceRef(admission.admissionRef) || typeof admission.proposalDigest !== "string" || !digestPattern.test(admission.proposalDigest) || !validAdmissionState(admission.state)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/invalid-effect-admission",
          "Effect admission identity or state is invalid."
        )
      );
      continue;
    }
    const canonical = canonicalEntry(admission);
    if (canonical === void 0) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/non-data-effect-admission",
          "Effect admission must be canonical DATA."
        )
      );
      continue;
    }
    if (!retainDomain(context, admission.occurrence.revisionDomain)) continue;
    const key = effectKey(admission);
    const record = state.effects.get(key);
    if (record === void 0) {
      if (rejectDefinitiveMissingRef(context, admission.occurrence, "effect-admission")) continue;
      retainPending(
        opts,
        outputs,
        state.pendingEffectAdmissions,
        key,
        canonical.snapshot,
        "effect-admission"
      );
      continue;
    }
    if (record.proposal.proposalDigest !== admission.proposalDigest || dataKey(record.proposal.requestRef) !== dataKey(canonical.snapshot.requestRef) || !sameRef(record.proposal.occurrence, admission.occurrence)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-admission-mismatch",
          "Effect admission has no exact proposal.",
          [key]
        )
      );
      continue;
    }
    if (record.admission !== void 0) {
      if (dataKey(record.admission) !== canonical.key)
        pushIssue(
          outputs,
          issue(
            "causal-occurrence/effect-admission-conflict",
            "Effect admission replay conflicts.",
            [key]
          )
        );
      continue;
    }
    state.effects.set(key, { ...record, admission: canonical.snapshot });
    context.committedViewChanged = true;
    emitConservation(context, admission.occurrence);
  }
}
function receiveOutcomes(context, arrival) {
  const { state, opts, outputs } = context;
  for (const outcome2 of arrival.values) {
    if (outcome2 === null || typeof outcome2 !== "object" || !validRef(outcome2.occurrence) || !validToken(outcome2.effectId) || !validSourceRef(outcome2.requestRef) || !validSourceRef(outcome2.admissionRef) || typeof outcome2.proposalDigest !== "string" || !digestPattern.test(outcome2.proposalDigest) || !validOutcomeState(outcome2.state) || !validResult(outcome2.result)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/invalid-effect-outcome",
          "Effect outcome identity, state, or D184 result is invalid."
        )
      );
      continue;
    }
    const canonical = canonicalEntry(outcome2);
    if (canonical === void 0) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/non-data-effect-outcome",
          "Effect outcome must be canonical DATA."
        )
      );
      continue;
    }
    const resultMatchesState = validResult(outcome2.result) && outcome2.state === "succeeded" === (outcome2.result.kind === "ok");
    if (!resultMatchesState) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-outcome-mismatch",
          "Effect outcome D184 result must match its terminal state."
        )
      );
      continue;
    }
    if (!retainDomain(context, outcome2.occurrence.revisionDomain)) continue;
    const key = effectKey(outcome2);
    const record = state.effects.get(key);
    if (record === void 0 || record.admission === void 0) {
      if (rejectDefinitiveMissingRef(context, outcome2.occurrence, "effect-outcome")) continue;
      retainPending(
        opts,
        outputs,
        state.pendingEffectOutcomes,
        key,
        canonical.snapshot,
        "effect-outcome"
      );
      continue;
    }
    if (record.admission.state !== "admitted" || record.proposal.proposalDigest !== outcome2.proposalDigest || dataKey(record.proposal.requestRef) !== dataKey(canonical.snapshot.requestRef) || dataKey(record.admission.admissionRef) !== dataKey(canonical.snapshot.admissionRef) || !sameRef(record.proposal.occurrence, outcome2.occurrence)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-outcome-mismatch",
          "Effect outcome requires exact admitted authority and a D184 result matching its state.",
          [key]
        )
      );
      continue;
    }
    if (record.outcome !== void 0) {
      if (dataKey(record.outcome) !== canonical.key)
        pushIssue(
          outputs,
          issue("causal-occurrence/effect-outcome-conflict", "Effect outcome replay conflicts.", [
            key
          ])
        );
      continue;
    }
    state.effects.set(key, { ...record, outcome: canonical.snapshot });
    context.committedViewChanged = true;
    emitConservation(context, outcome2.occurrence);
  }
}
function pendingObligations(context, revisionDomain, domain) {
  const { state } = context;
  const { watermark, occurrences, latestAdmitted } = domain;
  const pending = /* @__PURE__ */ new Map();
  for (const occurrence3 of occurrences) {
    const key = refKey(occurrence3);
    const admission = exactAdmission(context, occurrence3);
    const isLatest = latestAdmitted.get(occurrenceIdKey(occurrence3)) === occurrence3;
    if (admission === void 0 || admission.state === "admitted" && isLatest && !state.released.has(key) || state.released.has(key) && !state.emittedTerminals.has(key))
      pending.set(key, occurrence3);
  }
  for (const admission of state.admissions.values()) {
    if (admission.occurrence.revisionDomain === revisionDomain && admission.occurrence.revision <= watermark && exactOccurrence(context, admission.occurrence) === void 0)
      pending.set(refKey(admission.occurrence), admission.occurrence);
  }
  for (const terminal of state.pendingTerminals.values()) {
    if (terminal.occurrence.revisionDomain === revisionDomain && terminal.occurrence.revision <= watermark)
      pending.set(refKey(terminal.occurrence), terminal.occurrence);
  }
  const pendingEffects = [...state.effects.values()].filter(
    (record) => record.proposal.occurrence.revisionDomain === revisionDomain && record.proposal.occurrence.revision <= watermark && (record.admission === void 0 || record.admission.state === "admitted" && record.outcome === void 0)
  );
  const pendingEffectIds = new Set(pendingEffects.map((record) => record.proposal.effectId));
  for (const effect of [
    ...state.pendingEffectProposals.values(),
    ...state.pendingEffectAdmissions.values(),
    ...state.pendingEffectOutcomes.values()
  ]) {
    if (effect.occurrence.revisionDomain === revisionDomain && effect.occurrence.revision <= watermark)
      pendingEffectIds.add(effect.effectId);
  }
  return { pendingOccurrenceRefs: Object.freeze([...pending.values()]), pendingEffectIds };
}

// packages/ts/src/solutions/causal-occurrence/transition.ts
function emptyState() {
  return {
    domains: /* @__PURE__ */ new Set(),
    highWaterByDomain: /* @__PURE__ */ new Map(),
    retentionFloorByDomain: /* @__PURE__ */ new Map(),
    byRevision: /* @__PURE__ */ new Map(),
    pending: /* @__PURE__ */ new Map(),
    admissions: /* @__PURE__ */ new Map(),
    released: /* @__PURE__ */ new Set(),
    terminals: /* @__PURE__ */ new Map(),
    emittedTerminals: /* @__PURE__ */ new Set(),
    effects: /* @__PURE__ */ new Map(),
    evidence: /* @__PURE__ */ new Map(),
    pendingTerminals: /* @__PURE__ */ new Map(),
    pendingEffectProposals: /* @__PURE__ */ new Map(),
    pendingEffectAdmissions: /* @__PURE__ */ new Map(),
    pendingEffectOutcomes: /* @__PURE__ */ new Map(),
    pendingEvidence: /* @__PURE__ */ new Map(),
    coverageGaps: /* @__PURE__ */ new Map(),
    watermarks: /* @__PURE__ */ new Map(),
    currentness: /* @__PURE__ */ new Map(),
    quiescence: /* @__PURE__ */ new Map(),
    retentionGapThroughByDomain: /* @__PURE__ */ new Map(),
    occurrenceRetentionGaps: /* @__PURE__ */ new Map()
  };
}
function cloneState(prior) {
  if (prior === void 0) return emptyState();
  return {
    ...prior,
    domains: new Set(prior.domains),
    highWaterByDomain: new Map(prior.highWaterByDomain),
    retentionFloorByDomain: new Map(prior.retentionFloorByDomain),
    byRevision: new Map(prior.byRevision),
    pending: new Map(prior.pending),
    admissions: new Map(prior.admissions),
    released: new Set(prior.released),
    terminals: new Map([...prior.terminals].map(([key, value]) => [key, new Map(value)])),
    emittedTerminals: new Set(prior.emittedTerminals),
    effects: new Map(prior.effects),
    evidence: new Map(prior.evidence),
    pendingTerminals: new Map(prior.pendingTerminals),
    pendingEffectProposals: new Map(prior.pendingEffectProposals),
    pendingEffectAdmissions: new Map(prior.pendingEffectAdmissions),
    pendingEffectOutcomes: new Map(prior.pendingEffectOutcomes),
    pendingEvidence: new Map(prior.pendingEvidence),
    coverageGaps: new Map(prior.coverageGaps),
    watermarks: new Map(prior.watermarks),
    currentness: new Map(prior.currentness),
    quiescence: new Map(prior.quiescence),
    retentionGapThroughByDomain: new Map(prior.retentionGapThroughByDomain),
    occurrenceRetentionGaps: new Map(prior.occurrenceRetentionGaps)
  };
}
function transitionCausalAuthority(prior, arrivals2, opts) {
  const state = cloneState(prior);
  const outputs = [];
  const emitIssue = (value) => pushIssue(outputs, value);
  const context = { state, opts, outputs, committedViewChanged: false };
  const acceptOccurrence = (entry) => {
    const occurrence3 = entry.value;
    if (state.byRevision.size >= opts.maxOccurrences) {
      const oldest = [...state.byRevision.entries()].sort(([, left], [, right]) => left.value.revision - right.value.revision).find(([, retained]) => settledForEviction(context, retained.value));
      if (oldest === void 0) {
        emitIssue(
          issue(
            "causal-occurrence/retention-capacity",
            "Occurrence retention is full of unsettled causal obligations.",
            [refKey(occurrence3)]
          )
        );
        return false;
      }
      state.byRevision.delete(oldest[0]);
      const evicted = oldest[1].value;
      const evictedRefKey = refKey(evicted);
      state.admissions.delete(evictedRefKey);
      state.released.delete(evictedRefKey);
      state.terminals.delete(evictedRefKey);
      state.emittedTerminals.delete(evictedRefKey);
      state.currentness.delete(evictedRefKey);
      for (const [key, record] of state.effects) {
        if (sameRef(record.proposal.occurrence, evicted)) {
          state.effects.delete(key);
          context.committedViewChanged = true;
        }
      }
      for (const [key, evidence] of state.evidence) {
        if (sameRef(evidence.occurrence, evicted)) state.evidence.delete(key);
      }
      for (const map2 of [
        state.pendingTerminals,
        state.pendingEffectProposals,
        state.pendingEffectAdmissions,
        state.pendingEffectOutcomes,
        state.pendingEvidence,
        state.coverageGaps
      ]) {
        for (const [key, value] of map2) {
          if (sameRef(value.occurrence, evicted)) map2.delete(key);
        }
      }
      const priorFloor = state.retentionFloorByDomain.get(evicted.revisionDomain) ?? 0;
      const priorGap = state.retentionGapThroughByDomain.get(evicted.revisionDomain) ?? 0;
      if (evicted.revision > priorFloor || evicted.revision > priorGap)
        context.committedViewChanged = true;
      state.retentionFloorByDomain.set(
        evicted.revisionDomain,
        Math.max(state.retentionFloorByDomain.get(evicted.revisionDomain) ?? 0, evicted.revision)
      );
      state.retentionGapThroughByDomain.set(
        evicted.revisionDomain,
        Math.max(
          state.retentionGapThroughByDomain.get(evicted.revisionDomain) ?? 0,
          evicted.revision
        )
      );
      const retentionGap = canonicalSnapshot({
        occurrence: evicted,
        evidenceKind: "occurrence-retention",
        evidenceId: `retention-gap/${evicted.revisionDomain}/${evicted.revision}`,
        evidenceDigest: evicted.digest,
        coverage: "retention-gap",
        refs: Object.freeze([`causal-occurrence:${refKey(evicted)}`])
      });
      state.occurrenceRetentionGaps.set(evicted.revisionDomain, retentionGap);
      outputs.push({
        kind: "coverage",
        value: {
          kind: "causal-evidence-coverage",
          occurrence: evicted,
          complete: false,
          entries: Object.freeze([retentionGap]),
          missingKinds: Object.freeze([...opts.requiredEvidenceKinds]),
          terminalGapKinds: Object.freeze([...opts.requiredEvidenceKinds])
        }
      });
    }
    state.byRevision.set(revisionKey(occurrence3.revisionDomain, occurrence3.revision), entry);
    state.highWaterByDomain.set(occurrence3.revisionDomain, occurrence3.revision);
    return true;
  };
  const receiveOccurrences = (arrival) => {
    for (const occurrence3 of arrival.values) {
      if (!validRef(occurrence3)) {
        emitIssue(issue("causal-occurrence/invalid-identity", "Occurrence identity is invalid."));
        continue;
      }
      let key;
      try {
        key = dataKey(occurrence3);
      } catch {
        emitIssue(issue("causal-occurrence/non-data", "Occurrence must be canonical DATA."));
        continue;
      }
      const { digest: digest3, ...digestMaterial } = occurrence3;
      if (causalOccurrenceDigest(digestMaterial) !== digest3) {
        emitIssue(
          issue(
            "causal-occurrence/digest-mismatch",
            "Occurrence digest does not bind contract-v2 identity and value material.",
            [refKey(occurrence3)]
          )
        );
        continue;
      }
      if (!retainDomain(context, occurrence3.revisionDomain)) continue;
      const domainKey = revisionKey(occurrence3.revisionDomain, occurrence3.revision);
      const existing = state.byRevision.get(domainKey) ?? state.pending.get(domainKey);
      if (existing !== void 0) {
        if (existing.key !== key)
          emitIssue(
            issue(
              "causal-occurrence/replay-conflict",
              "Revision replay conflicts with retained identity.",
              [refKey(occurrence3)]
            )
          );
        continue;
      }
      const highWater = state.highWaterByDomain.get(occurrence3.revisionDomain) ?? 0;
      const floor = state.retentionFloorByDomain.get(occurrence3.revisionDomain) ?? 0;
      if (occurrence3.revision <= highWater) {
        emitIssue(
          issue(
            occurrence3.revision <= floor ? "causal-occurrence/retention-gap" : "causal-occurrence/stale-revision",
            "Revision cannot regain causal authority.",
            [refKey(occurrence3)]
          )
        );
        outputs.push({
          kind: "currentness",
          value: {
            kind: "causal-currentness",
            occurrence: occurrence3,
            evaluatedThroughRevision: highWater,
            state: occurrence3.revision <= floor ? "unverifiable" : "stale"
          }
        });
        continue;
      }
      const entry = { value: canonicalSnapshot(occurrence3), key };
      if (occurrence3.revision > highWater + 1) {
        if (state.pending.size >= opts.maxPending) {
          emitIssue(
            issue(
              "causal-occurrence/pending-bound",
              "Skipped revision exceeded bounded pending retention.",
              [refKey(occurrence3)]
            )
          );
          continue;
        }
        state.pending.set(domainKey, entry);
        emitIssue(
          issue("causal-occurrence/skipped-revision", `Revision ${highWater + 1} is missing.`, [
            refKey(occurrence3)
          ])
        );
        outputs.push({
          kind: "currentness",
          value: {
            kind: "causal-currentness",
            occurrence: occurrence3,
            evaluatedThroughRevision: highWater,
            state: "unverifiable",
            missingRevision: highWater + 1,
            gapRef: {
              revisionDomain: occurrence3.revisionDomain,
              afterRevision: highWater,
              beforeRevision: occurrence3.revision,
              reason: "skipped-revision"
            }
          }
        });
        outputs.push({
          kind: "coverage",
          value: {
            kind: "causal-evidence-coverage",
            occurrence: occurrence3,
            complete: false,
            entries: Object.freeze([
              {
                occurrence: occurrence3,
                evidenceKind: "revision-sequence",
                evidenceId: `${occurrence3.revisionDomain}/${occurrence3.revision}`,
                evidenceDigest: occurrence3.digest,
                coverage: "skipped-revision"
              }
            ]),
            missingKinds: Object.freeze([...opts.requiredEvidenceKinds]),
            terminalGapKinds: Object.freeze(["revision-sequence"])
          }
        });
        continue;
      }
      if (!acceptOccurrence(entry)) {
        if (state.pending.size < opts.maxPending) state.pending.set(domainKey, entry);
        continue;
      }
      for (; ; ) {
        const nextRevision = (state.highWaterByDomain.get(occurrence3.revisionDomain) ?? 0) + 1;
        const pending = state.pending.get(revisionKey(occurrence3.revisionDomain, nextRevision));
        if (pending === void 0) break;
        if (!acceptOccurrence(pending)) break;
        state.pending.delete(revisionKey(occurrence3.revisionDomain, nextRevision));
      }
    }
  };
  const recomputeDomain = (revisionDomain) => {
    const domain = recomputeCurrentness(context, revisionDomain);
    if (domain === void 0) return;
    const { watermark, sequenceComplete } = domain;
    const { pendingOccurrenceRefs, pendingEffectIds } = pendingObligations(
      context,
      revisionDomain,
      domain
    );
    const lifecycle = sequenceComplete && pendingOccurrenceRefs.length === 0 && pendingEffectIds.size === 0;
    const evidenceTerminal = lifecycle && isEvidenceTerminal(context, revisionDomain, domain);
    const value = {
      kind: "causal-quiescence",
      revisionDomain,
      evaluatedThroughRevision: watermark,
      lifecycle,
      retainedEvidence: lifecycle && evidenceTerminal && (state.retentionGapThroughByDomain.get(revisionDomain) ?? 0) === 0,
      pendingOccurrenceRefs,
      pendingEffectIds: Object.freeze([...pendingEffectIds])
    };
    const prior2 = state.quiescence.get(revisionDomain);
    state.quiescence.set(revisionDomain, value);
    if (prior2 === void 0 || dataKey(prior2) !== dataKey(value))
      outputs.push({ kind: "quiescence", value });
  };
  const pendingWorkCount = () => state.admissions.size + state.pending.size + state.pendingTerminals.size + state.pendingEffectProposals.size + state.pendingEffectAdmissions.size + state.pendingEffectOutcomes.size + state.pendingEvidence.size;
  const refreshProjections = () => {
    for (const { value: occurrence3 } of state.byRevision.values()) {
      const watermark = state.watermarks.get(occurrence3.revisionDomain);
      if (watermark === void 0 || occurrence3.revision > watermark) continue;
      const key = refKey(occurrence3);
      const current = state.currentness.get(key);
      state.currentness.set(
        key,
        current.state === "unverifiable" && current.gapRef !== void 0 ? {
          ...current,
          gapRef: { ...current.gapRef, evidenceRef: { ...current.gapRef.evidenceRef } }
        } : { ...current }
      );
    }
    for (const domain of state.watermarks.keys()) {
      const current = state.quiescence.get(domain);
      state.quiescence.set(domain, {
        ...current,
        pendingOccurrenceRefs: Object.freeze([...current.pendingOccurrenceRefs]),
        pendingEffectIds: Object.freeze([...current.pendingEffectIds])
      });
    }
  };
  const flushPending = () => {
    const before = pendingWorkCount();
    let promoted = false;
    flushAdmissions(context);
    flushEffectsAndTerminals(context);
    flushEvidence(context);
    for (const revisionDomain of state.domains) {
      for (; ; ) {
        const revision = (state.highWaterByDomain.get(revisionDomain) ?? 0) + 1;
        const key = revisionKey(revisionDomain, revision);
        const pending = state.pending.get(key);
        if (pending === void 0 || !acceptOccurrence(pending)) break;
        state.pending.delete(key);
        promoted = true;
      }
    }
    return { promoted, changed: promoted || pendingWorkCount() !== before };
  };
  for (const arrival of arrivals2) {
    if (arrival.lane === "occurrences") receiveOccurrences(arrival);
    if (arrival.lane === "admissions") receiveAdmissions(context, arrival);
    if (arrival.lane === "branch-terminals") receiveTerminals(context, arrival);
    if (arrival.lane === "effect-proposals") receiveProposals(context, arrival);
    if (arrival.lane === "effect-admissions") receiveEffectAdmissions(context, arrival);
    if (arrival.lane === "effect-outcomes") receiveOutcomes(context, arrival);
    if (arrival.lane === "evidence") receiveEvidence(context, arrival);
    if (arrival.lane === "watermarks") receiveWatermarks(context, arrival);
  }
  for (const revisionDomain of state.watermarks.keys()) recomputeDomain(revisionDomain);
  for (; ; ) {
    const { promoted, changed } = flushPending();
    if (!changed) {
      refreshProjections();
      break;
    }
    const releasedBefore = state.released.size;
    for (const revisionDomain of state.watermarks.keys()) recomputeDomain(revisionDomain);
    if (!promoted && state.released.size === releasedBefore) break;
  }
  return { state, outputs, committedViewChanged: context.committedViewChanged };
}

// packages/ts/src/solutions/causal-occurrence/construction.ts
function causalColdNodeNames(name) {
  const suffixes = [
    "input/occurrences",
    "input/admissions",
    "input/branch-terminals",
    "input/effect-proposals",
    "input/effect-admissions",
    "input/effect-outcomes",
    "input/evidence",
    "input/watermarks",
    "arrivals",
    "authority",
    "release-candidates",
    "release-port",
    "released",
    "release-events",
    "release-controller",
    "currentness",
    "terminals",
    "conservation",
    "coverage",
    "quiescence",
    "issues",
    "causal-quiescence",
    "committed-effects"
  ];
  return suffixes.map((suffix) => `${name}/${suffix}`);
}
var PreparedCausalOptions = class {
  #options;
  constructor(options) {
    this.#options = options;
    Object.freeze(this);
  }
  get options() {
    return this.#options;
  }
};
function prepareCausalOptions(opts) {
  for (const [label, bound] of [
    ["maxOccurrences", opts.maxOccurrences],
    ["maxPending", opts.maxPending],
    ["maxEffects", opts.maxEffects],
    ["maxEvidence", opts.maxEvidence]
  ]) {
    if (!Number.isSafeInteger(bound) || bound < 1)
      throw new TypeError(`${label} must be a positive safe integer`);
  }
  if (new Set(opts.requiredBranches).size !== opts.requiredBranches.length)
    throw new TypeError("required branches must be unique");
  if (opts.requiredBranches.length === 0)
    throw new TypeError("at least one required branch must be declared");
  if (new Set(opts.requiredEvidenceKinds).size !== opts.requiredEvidenceKinds.length)
    throw new TypeError("required evidence kinds must be unique");
  opts = Object.freeze({
    ...opts,
    requiredBranches: Object.freeze([...opts.requiredBranches]),
    requiredEvidenceKinds: Object.freeze([...opts.requiredEvidenceKinds])
  });
  return new PreparedCausalOptions(opts);
}
function lane(graph, input, name, laneName) {
  return graph.node(
    [input],
    (ctx) => {
      const values = depBatch(ctx, 0) ?? [];
      if (values.length > 0) ctx.down([["DATA", { lane: laneName, values }]]);
    },
    { name, factory: "causalOccurrenceInputLane", partial: true }
  );
}
function projectFact(graph, authority, name, kind, replayBuffer) {
  return graph.node(
    [authority],
    (ctx) => {
      const values = (depBatch(ctx, 0) ?? []).filter((raw) => raw.kind === "fact" && raw.fact.kind === kind).map(
        (raw) => [
          "DATA",
          raw.fact.value
        ]
      );
      if (values.length > 0) ctx.down(values);
    },
    { name, factory: "causalOccurrenceFactProjection", replayBuffer }
  );
}
function buildCausalNodes(ownerGraph, graph, startup, preparedOptions, binding2) {
  binding2 = causalBinding(binding2);
  graph.assertContext(ownerGraph, startup, binding2.epoch);
  const opts = preparedOptions.options;
  const arrivals2 = graph.initNode(
    merge(),
    [
      lane(graph, opts.occurrences, `${opts.name}/input/occurrences`, "occurrences"),
      lane(graph, opts.admissions, `${opts.name}/input/admissions`, "admissions"),
      lane(graph, opts.branchTerminals, `${opts.name}/input/branch-terminals`, "branch-terminals"),
      lane(graph, opts.effectProposals, `${opts.name}/input/effect-proposals`, "effect-proposals"),
      lane(
        graph,
        opts.effectAdmissions,
        `${opts.name}/input/effect-admissions`,
        "effect-admissions"
      ),
      lane(graph, opts.effectOutcomes, `${opts.name}/input/effect-outcomes`, "effect-outcomes"),
      lane(graph, opts.evidence, `${opts.name}/input/evidence`, "evidence"),
      lane(graph, opts.watermarks, `${opts.name}/input/watermarks`, "watermarks")
    ],
    { name: `${opts.name}/arrivals` }
  );
  const authority = graph.node(
    [arrivals2],
    (ctx) => {
      const { state, outputs, committedViewChanged } = transitionCausalAuthority(
        ctx.state.get(),
        depBatch(ctx, 0) ?? [],
        opts
      );
      const committedEffects2 = prepareCommittedEffectsView(
        state,
        committedViewChanged,
        outputs.length > 0,
        `${opts.name}/authority`,
        binding2
      );
      state.committedEffects = committedEffects2;
      ctx.state.set(state);
      for (const output of outputs)
        ctx.down([
          [
            "DATA",
            Object.freeze({
              kind: "fact",
              fact: Object.freeze(output),
              committedEffects: committedEffects2
            })
          ]
        ]);
      if (committedViewChanged && outputs.length === 0)
        ctx.down([
          [
            "DATA",
            Object.freeze({
              kind: "view-change",
              committedEffects: committedEffects2
            })
          ]
        ]);
    },
    {
      name: `${opts.name}/authority`,
      factory: "causalOccurrenceAuthority",
      completeWhenDepsComplete: false,
      errorWhenDepsError: true
    }
  );
  const rawRelease = projectFact(
    graph,
    authority,
    `${opts.name}/release-candidates`,
    "release",
    opts.maxOccurrences
  );
  const pullId = /* @__PURE__ */ Symbol(`${opts.name}/release`);
  const quietPort = graph.node(
    [rawRelease],
    (ctx) => {
      const values = depBatch(ctx, 0) ?? [];
      if (values.length > 0) ctx.down(values.map((value) => ["DATA", value]));
    },
    {
      name: `${opts.name}/release-port`,
      factory: "causalOccurrenceQuietReleasePort",
      pullId,
      pausable: "resumeAll"
    }
  );
  const released = graph.node(
    [quietPort],
    (ctx) => {
      const values = depBatch(ctx, 0) ?? [];
      if (values.length > 0) ctx.down(values.map((value) => ["DATA", value]));
    },
    {
      name: `${opts.name}/released`,
      factory: "causalOccurrenceReleased",
      replayBuffer: opts.maxOccurrences
    }
  );
  const releaseEvents = graph.initNode(merge(), [released, rawRelease], {
    name: `${opts.name}/release-events`
  });
  const releaseController = graph.node(
    [releaseEvents],
    (ctx) => {
      if ((depBatch(ctx, 0) ?? []).length > 0) ctx.upNext([["PULL", { pullId }]]);
    },
    { name: `${opts.name}/release-controller`, factory: "causalOccurrenceReleaseController" }
  );
  const result = {
    startup,
    released,
    currentness: projectFact(
      graph,
      authority,
      `${opts.name}/currentness`,
      "currentness",
      opts.maxOccurrences
    ),
    terminals: projectFact(
      graph,
      authority,
      `${opts.name}/terminals`,
      "terminal",
      opts.maxOccurrences
    ),
    conservation: projectFact(
      graph,
      authority,
      `${opts.name}/conservation`,
      "conservation",
      opts.maxEffects
    ),
    coverage: projectFact(graph, authority, `${opts.name}/coverage`, "coverage", opts.maxEvidence),
    quiescence: projectFact(
      graph,
      authority,
      `${opts.name}/quiescence`,
      "quiescence",
      opts.maxOccurrences
    ),
    issues: projectFact(graph, authority, `${opts.name}/issues`, "issue", opts.maxPending)
  };
  const committedEffects = graph.node(
    [authority],
    (ctx) => {
      let seen = ctx.state.get();
      if (seen === void 0) {
        const slot2 = { view: void 0 };
        seen = slot2;
        ctx.state.set(slot2);
      }
      const slot = seen;
      ctx.onInvalidate(() => {
        slot.view = void 0;
      });
      for (const emission of depBatch(ctx, 0) ?? []) {
        if (seen.view === emission.committedEffects) continue;
        seen.view = emission.committedEffects;
        ctx.down([["DATA", seen.view]]);
      }
    },
    { name: `${opts.name}/committed-effects`, factory: "causalCommittedEffectsProjection" }
  );
  assertCausalOccurrenceTopology(graph.readIncoming(), opts.name);
  const full = createCausalCapabilities(ownerGraph, graph, opts.name, result, binding2);
  Object.freeze(result);
  return Object.freeze({
    ports: result,
    full,
    committedEffects,
    roots: Object.freeze([releaseController])
  });
}
function causalOccurrenceRequiredEdges(name, description) {
  const arrivals2 = `${name}/arrivals`;
  const authority = `${name}/authority`;
  const releaseCandidates = `${name}/release-candidates`;
  const releaseEvents = `${name}/release-events`;
  const releasePort = `${name}/release-port`;
  const released = `${name}/released`;
  const internal = [
    { from: `${name}/input/occurrences`, to: arrivals2 },
    { from: `${name}/input/admissions`, to: arrivals2 },
    { from: `${name}/input/branch-terminals`, to: arrivals2 },
    { from: `${name}/input/effect-proposals`, to: arrivals2 },
    { from: `${name}/input/effect-admissions`, to: arrivals2 },
    { from: `${name}/input/effect-outcomes`, to: arrivals2 },
    { from: `${name}/input/evidence`, to: arrivals2 },
    { from: `${name}/input/watermarks`, to: arrivals2 },
    { from: arrivals2, to: authority },
    { from: authority, to: releaseCandidates },
    { from: releaseCandidates, to: releasePort },
    { from: releasePort, to: released },
    { from: releaseCandidates, to: releaseEvents },
    { from: released, to: releaseEvents },
    { from: releaseEvents, to: `${name}/release-controller` },
    { from: authority, to: `${name}/currentness` },
    { from: authority, to: `${name}/terminals` },
    { from: authority, to: `${name}/conservation` },
    { from: authority, to: `${name}/coverage` },
    { from: authority, to: `${name}/quiescence` },
    { from: authority, to: `${name}/issues` },
    { from: authority, to: `${name}/committed-effects` }
  ];
  const inputLanes = [
    "occurrences",
    "admissions",
    "branch-terminals",
    "effect-proposals",
    "effect-admissions",
    "effect-outcomes",
    "evidence",
    "watermarks"
  ];
  const sources = description === void 0 ? [] : inputLanes.flatMap((laneName) => {
    const target = `${name}/input/${laneName}`;
    return description.edges.filter((edge) => edge.to === target);
  });
  return Object.freeze([...sources, ...internal]);
}
function assertCausalOccurrenceTopology(description, name) {
  const incoming = /* @__PURE__ */ new Map();
  description.edges.forEach((edge) => {
    let sources = incoming.get(edge.to);
    if (sources === void 0) {
      sources = /* @__PURE__ */ new Set();
      incoming.set(edge.to, sources);
    }
    sources.add(edge.from);
  });
  for (const laneName of [
    "occurrences",
    "admissions",
    "branch-terminals",
    "effect-proposals",
    "effect-admissions",
    "effect-outcomes",
    "evidence",
    "watermarks"
  ]) {
    if (!incoming.has(`${name}/input/${laneName}`))
      throw new TypeError(`causal occurrence topology missing source edge into ${laneName}`);
  }
  for (const edge of causalOccurrenceRequiredEdges(name, description)) {
    if (!incoming.get(edge.to)?.has(edge.from))
      throw new TypeError(
        `causal occurrence topology missing required edge ${edge.from} -> ${edge.to}`
      );
  }
}

// examples/spending-alerts/causal-publication.ts
var REQUEST = "spending-alerts/request-material/v1";
var SNAPSHOT = "spending-alerts/material-snapshot/v1";
var PROPOSAL = "spending-alerts/effect-proposal/v1";
var MAX_FRAME = 1048576;
var MAX_PAYLOAD = 8192;
var MAX_MATERIALS = 64;
function encodeMaterial(value, limit = MAX_FRAME) {
  let immutable = true;
  let bytes = 0;
  const ancestors = /* @__PURE__ */ new Set();
  function token(s) {
    bytes += Buffer.byteLength(s, "utf8");
    if (bytes > limit) throw new TypeError("material byte limit");
    return s;
  }
  function string(s) {
    if (s.length > limit || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s))
      throw new TypeError("invalid material string");
    return token(JSON.stringify(s));
  }
  function visit(v) {
    if (v === null) return token("null");
    if (typeof v === "string") return string(v);
    if (typeof v === "boolean") return token(String(v));
    if (typeof v === "number" && Number.isFinite(v)) return token(JSON.stringify(v));
    if (typeof v !== "object" || v === null || ancestors.has(v))
      throw new TypeError("not passive JSON");
    const array2 = Array.isArray(v);
    const proto = Object.getPrototypeOf(v);
    if (array2 ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      throw new TypeError("non-data prototype");
    if (array2 && v.length > limit / 2) throw new TypeError("material byte limit");
    immutable &&= Object.isFrozen(v);
    ancestors.add(v);
    const keys3 = Reflect.ownKeys(v);
    if (keys3.length > limit / 2 || keys3.some((k) => typeof k !== "string"))
      throw new TypeError("invalid material keys");
    const names = keys3.filter((k) => !array2 || k !== "length");
    if (array2 && (names.length !== v.length || names.some((k, i) => k !== String(i))))
      throw new TypeError("non-data array");
    const pieces = [token(array2 ? "[" : "{")];
    for (const [i, key] of (array2 ? names : names.sort()).entries()) {
      const descriptor = Object.getOwnPropertyDescriptor(v, key);
      if (!("value" in descriptor) || !descriptor.enumerable)
        throw new TypeError("non-data property");
      if (i) pieces.push(token(","));
      if (!array2) pieces.push(string(key), token(":"));
      pieces.push(visit(descriptor.value));
    }
    pieces.push(token(array2 ? "]" : "}"));
    ancestors.delete(v);
    return pieces.join("");
  }
  const result = visit(value);
  return { text: result, immutable };
}
function canonicalMaterial(value, limit = MAX_FRAME) {
  return encodeMaterial(value, limit).text;
}
function materialDigest(text2) {
  return `sha256:${createHash("sha256").update(text2, "utf8").digest("hex")}`;
}
function freeze(v) {
  if (v !== null && typeof v === "object") {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v;
}
function keys(value, expected) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== expected.split(",").sort().join(","))
    throw new TypeError("material shape");
}
function text(v) {
  if (typeof v !== "string") throw new TypeError("material text");
}
function digest(v) {
  if (typeof v !== "string" || !/^sha256:[0-9a-f]{64}$/.test(v))
    throw new TypeError("material digest");
}
function epoch(v) {
  if (!Number.isSafeInteger(v) || v < 1) throw new TypeError("material epoch");
}
function ref(v) {
  keys(v, "kind,id");
  const r = v;
  text(r.kind);
  text(r.id);
}
function occurrence(raw) {
  const v = raw;
  keys(v, "revisionDomain,occurrenceId,revision,digest,sourceRefs");
  text(v.revisionDomain);
  text(v.occurrenceId);
  epoch(v.revision);
  digest(v.digest);
  if (!Array.isArray(v.sourceRefs)) throw new TypeError("material sources");
  for (const source of v.sourceRefs) ref(source);
}
function profile(v) {
  ref(v.packRef);
  ref(v.destinationRef);
  digest(v.sourceDigest);
  digest(v.runtimeDigest);
  epoch(v.compositionEpoch);
  epoch(v.hostEpoch);
}
function sameBinding(a, b) {
  return a.sourceDigest === b.sourceDigest && a.runtimeDigest === b.runtimeDigest && a.compositionEpoch === b.compositionEpoch && a.hostEpoch === b.hostEpoch && a.destinationRef.kind === b.destinationRef.kind && a.destinationRef.id === b.destinationRef.id;
}
function proposalForMaterial(m) {
  return freeze({
    occurrence: m.body.occurrence,
    effectId: m.body.effectId,
    requestRef: m.requestRef,
    proposalDigest: m.proposalDigest
  });
}
function makeRequestMaterial(body) {
  const safe = freeze(JSON.parse(canonicalMaterial(body)));
  const requestRef = { kind: REQUEST, id: materialDigest(canonicalMaterial(safe)) };
  return freeze({
    body: safe,
    requestRef,
    proposalDigest: materialDigest(
      canonicalMaterial({
        schema: PROPOSAL,
        occurrence: safe.occurrence,
        effectId: safe.effectId,
        requestRef
      })
    )
  });
}
function makeMaterialSnapshot(p, materials) {
  const body = JSON.parse(canonicalMaterial({ ...p, schema: SNAPSHOT, materials }));
  return freeze({ body, digest: materialDigest(canonicalMaterial(body)) });
}
function associationKey(p) {
  const o = p.occurrence;
  return JSON.stringify([
    o.revisionDomain,
    o.occurrenceId,
    o.revision,
    o.digest,
    o.sourceRefs.map((r) => [r.kind, r.id]),
    p.effectId,
    p.requestRef.kind,
    p.requestRef.id,
    p.proposalDigest
  ]);
}
function validateMaterialSnapshot(raw, expected) {
  const rows = /* @__PURE__ */ new Map();
  try {
    const encoded = encodeMaterial(raw);
    const frame2 = JSON.parse(encoded.text);
    keys(frame2, "body,digest");
    keys(
      frame2.body,
      "schema,packRef,sourceDigest,runtimeDigest,destinationRef,compositionEpoch,hostEpoch,materials"
    );
    if (frame2.body.schema !== SNAPSHOT || !Array.isArray(frame2.body.materials) || frame2.body.materials.length > MAX_MATERIALS)
      throw new TypeError("material frame");
    profile(frame2.body);
    digest(frame2.digest);
    if (materialDigest(canonicalMaterial(frame2.body)) !== frame2.digest)
      throw new TypeError("frame digest mismatch");
    if (!sameBinding(frame2.body, expected) || frame2.body.packRef.kind !== expected.packRef.kind || frame2.body.packRef.id !== expected.packRef.id)
      return { state: "binding-mismatch", rows };
    const contents = /* @__PURE__ */ new Map();
    for (const m of frame2.body.materials) {
      keys(m, "body,requestRef,proposalDigest");
      keys(
        m.body,
        "schema,occurrence,effectId,destinationRef,compositionEpoch,hostEpoch,inputDigest,policyDigest,sourceDigest,runtimeDigest,payloadText,payloadDigest"
      );
      const b = m.body;
      if (b.schema !== REQUEST) throw new TypeError("material schema");
      occurrence(b.occurrence);
      text(b.effectId);
      ref(b.destinationRef);
      epoch(b.hostEpoch);
      epoch(b.compositionEpoch);
      for (const d of [
        b.inputDigest,
        b.policyDigest,
        b.sourceDigest,
        b.runtimeDigest,
        b.payloadDigest,
        m.proposalDigest
      ])
        digest(d);
      ref(m.requestRef);
      text(b.payloadText);
      if (!sameBinding(b, frame2.body)) return { state: "binding-mismatch", rows: /* @__PURE__ */ new Map() };
      if (Buffer.byteLength(b.payloadText, "utf8") > MAX_PAYLOAD)
        throw new TypeError("payload byte limit");
      const payload = JSON.parse(b.payloadText);
      keys(payload, "transactionId,vendor,severity,message");
      text(payload.transactionId);
      text(payload.vendor);
      text(payload.message);
      if (!["low", "medium", "high"].includes(payload.severity) || canonicalMaterial(payload, MAX_PAYLOAD) !== b.payloadText || materialDigest(b.payloadText) !== b.payloadDigest)
        throw new TypeError("payload mismatch");
      if (m.requestRef.kind !== REQUEST || m.requestRef.id !== materialDigest(canonicalMaterial(b)) || m.proposalDigest !== materialDigest(
        canonicalMaterial({
          schema: PROPOSAL,
          occurrence: b.occurrence,
          effectId: b.effectId,
          requestRef: m.requestRef
        })
      ))
        throw new TypeError("request mismatch");
      const key = associationKey(proposalForMaterial(m));
      const identity = JSON.stringify([
        b.occurrence.revisionDomain,
        b.occurrence.occurrenceId,
        b.occurrence.revision,
        b.occurrence.digest,
        b.occurrence.sourceRefs,
        b.effectId
      ]);
      const content = canonicalMaterial(m);
      if (contents.has(identity) && contents.get(identity) !== content)
        throw new TypeError("conflicting material");
      contents.set(identity, content);
      rows.set(key, freeze(payload));
    }
    return { state: "valid", rows, cacheable: encoded.immutable };
  } catch {
    return { state: "invalid/conflicting", rows: /* @__PURE__ */ new Map() };
  }
}
function publicationFor(join2, asOf) {
  const used = /* @__PURE__ */ new Set();
  const rows = join2.view.effects.map((record) => {
    const key = associationKey(record.proposal);
    const payload = join2.index.rows.get(key);
    if (payload !== void 0) used.add(key);
    return Object.freeze({
      proposal: record.proposal,
      recorded: record.outcome?.state ?? (record.admission?.state === "admitted" ? "admitted-no-outcome" : record.admission?.state ?? "pending-admission"),
      material: join2.index.state !== "valid" ? join2.index.state : payload === void 0 ? "missing" : "matched",
      ...payload === void 0 ? {} : { payload }
    });
  });
  return Object.freeze({
    kind: "spending-alerts/publication",
    authorityId: join2.view.authorityId,
    binding: join2.view.binding,
    asOf,
    retention: join2.view.retention,
    materialFrame: join2.index.state,
    unmatchedMaterials: join2.index.rows.size - used.size,
    rows: Object.freeze(rows)
  });
}
function buildSpendingPublication(ownerGraph, scope, startup, prepared, binding2, materialSource, expected) {
  const asOf = freeze(JSON.parse(canonicalMaterial(expected)));
  keys(asOf, "packRef,sourceDigest,runtimeDigest,destinationRef,compositionEpoch,hostEpoch");
  profile(asOf);
  scope.assertContext(ownerGraph, startup, asOf.compositionEpoch);
  if (asOf.compositionEpoch !== binding2.epoch) throw new TypeError("publication context mismatch");
  const causal = buildCausalNodes(ownerGraph, scope, startup, prepared, binding2);
  const authorityId = `${prepared.options.name}/authority`;
  const expectedBinding = canonicalMaterial(binding2);
  const requestMaterialJoin = scope.node(
    [causal.committedEffects, materialSource],
    (ctx) => {
      if (ctx.waveData.length !== 2 || requestMaterialJoin.deps[0] !== causal.committedEffects || requestMaterialJoin.deps[1] !== materialSource) {
        ctx.down([["ERROR", new TypeError("publication dependency mismatch")]]);
        return;
      }
      let state = ctx.state.get();
      if (state === void 0) {
        state = {};
        ctx.state.set(state);
      }
      const view = depLatest(ctx, 0);
      const raw = depLatest(ctx, 1);
      const materialArrived = Boolean(depBatch(ctx, 1)?.length);
      if (raw === void 0 && !materialArrived) {
        state.raw = void 0;
        state.index = void 0;
        return;
      }
      if (raw !== state.raw || state.index === void 0 || materialArrived && !state.index.cacheable)
        state.index = validateMaterialSnapshot(raw, asOf);
      state.raw = raw;
      if (view === void 0) return;
      if (view.kind !== "causal-committed-effects" || view.authorityId !== authorityId || (state.validatedBinding === void 0 || state.validatedBinding !== view.binding) && canonicalMaterial(view.binding) !== expectedBinding) {
        ctx.down([["ERROR", new TypeError("publication authority binding")]]);
        return;
      }
      if (Object.isFrozen(view.binding)) state.validatedBinding = view.binding;
      ctx.down([["DATA", Object.freeze({ view, index: state.index })]]);
    },
    {
      name: "requestMaterialJoin",
      factory: "spendingRequestMaterialJoin",
      errorWhenDepsError: true
    }
  );
  const publication = scope.node(
    [requestMaterialJoin],
    (ctx) => {
      for (const j of depBatch(ctx, 0) ?? [])
        ctx.down([["DATA", publicationFor(j, asOf)]]);
    },
    { name: "publication", factory: "spendingPublication", errorWhenDepsError: true }
  );
  return Object.freeze({ causal, requestMaterialJoin, publication });
}

// examples/spending-alerts/causal-inputs.ts
var VERIFIER_REVISION = "spending-oracle-v2";
var NUMERIC_DOMAIN = "spending-finite-v1";
function frozen(v) {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    for (const child of Object.values(v)) frozen(child);
    Object.freeze(v);
  }
  return v;
}
function issue2(code, subjectId) {
  return Object.freeze({
    kind: "issue",
    code: `spending/${code}`,
    message: code,
    ...subjectId === void 0 ? {} : { subjectId }
  });
}
function hash(value) {
  return materialDigest(canonicalMaterial(value, 4 * 1048576));
}
function same(a, b) {
  return canonicalMaterial(a) === canonicalMaterial(b);
}
function occurrenceKey(o) {
  return canonicalMaterial(o);
}
function inputDigest(e) {
  return hash({ profileRef: e.profileRef, profile: e.profile, prefix: e.prefix });
}
function materialProfile(b) {
  const { packRef, sourceDigest, runtimeDigest, destinationRef, compositionEpoch, hostEpoch } = b;
  return frozen({
    packRef,
    sourceDigest,
    runtimeDigest,
    destinationRef,
    compositionEpoch,
    hostEpoch
  });
}
function keys2(v, names) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== names.split(",").sort().join(","))
    throw new TypeError("fields");
}
function str(v, max = 128) {
  if (typeof v !== "string" || !v.length || Buffer.byteLength(v) > max)
    throw new TypeError("string");
}
function number(v, max, integral = false, min = 0) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || integral && !Number.isSafeInteger(v))
    throw new TypeError("number");
}
function tick(v) {
  number(v, Number.MAX_SAFE_INTEGER, true);
}
function epoch2(v) {
  number(v, Number.MAX_SAFE_INTEGER, true, 1);
}
function boolean(v) {
  if (typeof v !== "boolean") throw new TypeError("boolean");
}
function digest2(v) {
  if (typeof v !== "string" || !/^sha256:[a-f0-9]{64}$/.test(v)) throw new TypeError("digest");
}
function array(v, limit = 64) {
  if (!Array.isArray(v) || v.length > limit) throw new TypeError("array");
}
function ref2(v) {
  keys2(v, "kind,id");
  str(v.kind);
  str(v.id);
}
function occurrence2(v) {
  keys2(v, "revisionDomain,occurrenceId,revision,digest,sourceRefs");
  str(v.revisionDomain);
  str(v.occurrenceId);
  epoch2(v.revision);
  digest2(v.digest);
  array(v.sourceRefs);
  if (!v.sourceRefs.length) throw new TypeError("source-refs");
  v.sourceRefs.forEach(ref2);
  if (new Set(v.sourceRefs.map((x) => canonicalMaterial(x))).size !== v.sourceRefs.length)
    throw new TypeError("source-refs");
}
function binding(v) {
  keys2(
    v,
    "packRef,sourceDigest,runtimeDigest,destinationRef,compositionEpoch,hostEpoch,runRef,evidenceMode"
  );
  ref2(v.packRef);
  ref2(v.destinationRef);
  digest2(v.sourceDigest);
  digest2(v.runtimeDigest);
  epoch2(v.compositionEpoch);
  epoch2(v.hostEpoch);
  str(v.runRef);
  if (v.evidenceMode !== "fixture-observations") throw new TypeError("observation-mode");
}
function profile2(v) {
  keys2(v, "dailyAverage,typicalCategories");
  number(v.dailyAverage, 1e9);
  array(v.typicalCategories, 32);
  v.typicalCategories.forEach((x) => {
    str(x, 256);
  });
  if (new Set(v.typicalCategories).size !== v.typicalCategories.length)
    throw new TypeError("categories");
}
function policy(v) {
  keys2(v, "zThreshold,dailyRatioThreshold");
  number(v.zThreshold, 1e6);
  number(v.dailyRatioThreshold, 1e6);
}
function transaction(v) {
  keys2(v, "id,vendor,category,amount,timestampIso");
  str(v.id);
  str(v.vendor, 256);
  str(v.category, 256);
  number(v.amount, 1e9);
  str(v.timestampIso);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.timestampIso) || !Number.isFinite(Date.parse(v.timestampIso)) || new Date(v.timestampIso).toISOString() !== v.timestampIso)
    throw new TypeError("timestamp");
}
function evaluation(raw) {
  keys2(
    raw,
    "evaluationRef,subjectRef,occurrence,inputDigest,profileRef,profile,policyRef,policyDigest,policy,prefix"
  );
  str(raw.evaluationRef);
  str(raw.subjectRef);
  occurrence2(raw.occurrence);
  digest2(raw.inputDigest);
  ref2(raw.profileRef);
  profile2(raw.profile);
  ref2(raw.policyRef);
  digest2(raw.policyDigest);
  policy(raw.policy);
  array(raw.prefix);
  if (!raw.prefix.length) throw new TypeError("empty-prefix");
  raw.prefix.forEach(transaction);
  const e = raw;
  if (new Set(e.prefix.map((t) => t.id)).size !== e.prefix.length || new Set(e.prefix.map((t) => t.vendor)).size !== 1 || e.inputDigest !== inputDigest(e) || e.policyDigest !== hash(e.policy))
    throw new TypeError("evaluation-binding");
  canonicalMaterial(e, 65536);
}
function receipt(v) {
  keys2(
    v,
    "receiptRef,issuerRef,verifierRevision,occurrence,inputDigest,policyDigest,sourceDigest,runtimeDigest,requestDigest,numericDomainRef,verdict,artifactRef,artifactDigest"
  );
  ref2(v.receiptRef);
  ref2(v.issuerRef);
  str(v.verifierRevision);
  occurrence2(v.occurrence);
  for (const k of [
    "inputDigest",
    "policyDigest",
    "sourceDigest",
    "runtimeDigest",
    "requestDigest",
    "artifactDigest"
  ])
    digest2(v[k]);
  str(v.numericDomainRef);
  ref2(v.artifactRef);
  if (!["pass", "fail", "unavailable"].includes(v.verdict))
    throw new TypeError("verdict");
}
function grant(v) {
  keys2(
    v,
    "grantRef,ownerRef,operation,occurrence,requestDigest,destinationRef,hostEpoch,validFrom,validThrough,maxWrites,replayScope,revoked"
  );
  ref2(v.grantRef);
  ref2(v.ownerRef);
  ref2(v.destinationRef);
  occurrence2(v.occurrence);
  digest2(v.requestDigest);
  epoch2(v.hostEpoch);
  tick(v.validFrom);
  tick(v.validThrough);
  number(v.maxWrites, 64, true, 1);
  boolean(v.revoked);
  keys2(v.replayScope, "compositionEpoch,hostEpoch");
  epoch2(v.replayScope.compositionEpoch);
  epoch2(v.replayScope.hostEpoch);
  if (v.operation !== "append-alert" || v.validFrom > v.validThrough)
    throw new TypeError("grant");
}
function outcome(v) {
  keys2(v, "occurrence,effectId,requestRef,admissionRef,proposalDigest,state,result");
  occurrence2(v.occurrence);
  str(v.effectId);
  ref2(v.requestRef);
  ref2(v.admissionRef);
  digest2(v.proposalDigest);
  if (!["succeeded", "failed", "cancelled", "reconcile-required", "unknown"].includes(
    v.state
  ))
    throw new TypeError("outcome");
  if (!v.result || typeof v.result !== "object" || !["ok", "error"].includes(v.result.kind))
    throw new TypeError("result");
}
function validateBinding(raw) {
  const v = JSON.parse(canonicalMaterial(raw));
  binding(v);
  return frozen(v);
}
function checkInput(kind, raw, expected) {
  try {
    const v = JSON.parse(canonicalMaterial(raw, kind === "pack" ? 4 * 1048576 : 1048576));
    if (kind === "arrivals") {
      keys2(v, "packRef,evaluationRefs");
      ref2(v.packRef);
      array(v.evaluationRefs);
      v.evaluationRefs.forEach((x) => {
        str(x);
      });
      if (!same(v.packRef, expected.packRef)) throw new TypeError("pack-ref");
    } else {
      const names = {
        pack: "format,binding,evaluations",
        current: "binding,current",
        verification: "binding,receipts",
        local: "binding,tick,stop,grants",
        inbox: "binding,issuerRef,artifactRef,artifactDigest,readiness,outcomes"
      };
      keys2(v, names[kind]);
      binding(v.binding);
      if (!same(v.binding, expected)) throw new TypeError("binding");
      if (kind === "pack") {
        if (v.format !== "spending-input-v1") throw new TypeError("format");
        array(v.evaluations);
        v.evaluations.forEach(evaluation);
        const es = v.evaluations;
        if (new Set(es.map((e) => e.evaluationRef)).size !== es.length || new Set(es.map((e) => occurrenceKey(e.occurrence))).size !== es.length || new Set(es.map((e) => e.prefix[0].vendor)).size > 2)
          throw new TypeError("pack-uniqueness");
        const domains = /* @__PURE__ */ new Map();
        for (const e of es) {
          const vendor = e.prefix[0].vendor, prior = domains.get(e.occurrence.revisionDomain);
          if (prior !== void 0 && prior !== vendor) throw new TypeError("domain-vendor");
          domains.set(e.occurrence.revisionDomain, vendor);
        }
      } else if (kind === "current") {
        array(v.current);
        const domains = /* @__PURE__ */ new Set();
        for (const f of v.current) {
          keys2(f, "revisionDomain,occurrence,policyRef,policyDigest,watermark");
          str(f.revisionDomain);
          occurrence2(f.occurrence);
          ref2(f.policyRef);
          digest2(f.policyDigest);
          tick(f.watermark);
          if (f.revisionDomain !== f.occurrence.revisionDomain || domains.has(f.revisionDomain))
            throw new TypeError("current-domain");
          domains.add(f.revisionDomain);
        }
      } else if (kind === "verification") {
        array(v.receipts);
        v.receipts.forEach(receipt);
      } else if (kind === "local") {
        tick(v.tick);
        boolean(v.stop);
        array(v.grants);
        v.grants.forEach(grant);
      } else {
        ref2(v.issuerRef);
        ref2(v.artifactRef);
        digest2(v.artifactDigest);
        keys2(v.readiness, "ready,observedAt,validThrough,availableSlots");
        boolean(v.readiness.ready);
        tick(v.readiness.observedAt);
        tick(v.readiness.validThrough);
        number(v.readiness.availableSlots, 1, true);
        array(v.outcomes);
        v.outcomes.forEach(outcome);
      }
    }
    return frozen({ valid: true, value: v });
  } catch {
    return { valid: false, issue: issue2(`invalid-${kind}`) };
  }
}

// examples/spending-alerts/causal-numeric.ts
function dyadic(x) {
  if (x === 0) return { integer: 0n, exponent: 0 };
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits2 = view.getBigUint64(0), field = Number(bits2 >> 52n & 2047n);
  let integer = bits2 & (1n << 52n) - 1n | (field ? 1n << 52n : 0n);
  let exponent = field ? field - 1075 : -1074;
  while ((integer & 1n) === 0n) {
    integer >>= 1n;
    exponent++;
  }
  return { integer, exponent };
}
var width = (x) => x.toString(2).length;
function exponentOfRatio(a, b) {
  let e = width(a) - width(b);
  if (e >= 0 ? a < b << BigInt(e) : a << BigInt(-e) < b) e--;
  return e;
}
function scaled(a, b, shift) {
  return shift >= 0 ? [a << BigInt(shift), b] : [a, b << BigInt(-shift)];
}
function integerSqrt(a) {
  if (a < 2n) return a;
  let x = 1n << BigInt(Math.ceil(width(a) / 2));
  for (; ; ) {
    const next = x + a / x >> 1n;
    if (next >= x) return x;
    x = next;
  }
}
function rounded(a, b, power = 0, sqrt = false) {
  if (a === 0n) return 0;
  const e = (sqrt ? Math.floor(exponentOfRatio(a, b) / 2) : exponentOfRatio(a, b)) + power;
  const unit = Math.max(-1074, e - 52);
  const [num, den] = scaled(a, b, (power - unit) * (sqrt ? 2 : 1));
  let q = sqrt ? integerSqrt(num / den) : num / den;
  const comparison = sqrt ? 4n * num - den * (2n * q + 1n) ** 2n : 2n * (num % den) - den;
  if (comparison > 0n || comparison === 0n && (q & 1n) === 1n) q++;
  return Number(q) * 2 ** unit;
}
function exactVendorStats(amounts) {
  const count = amounts.length;
  if (!count || count > 64 || amounts.some((x) => !Number.isFinite(x) || x < 0 || x > 1e9))
    throw new TypeError("spending numeric domain");
  let sumNumber = 0, squaresNumber = 0;
  let safe = true;
  for (const x of amounts) {
    sumNumber += x;
    squaresNumber += x * x;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(sumNumber) || !Number.isSafeInteger(squaresNumber))
      safe = false;
  }
  let sum, squares, exponent = 0;
  if (safe) {
    sum = BigInt(sumNumber);
    squares = BigInt(squaresNumber);
  } else {
    const parts = amounts.map(dyadic);
    exponent = Math.min(...parts.filter((p) => p.integer !== 0n).map((p) => p.exponent));
    if (!Number.isFinite(exponent)) exponent = 0;
    sum = 0n;
    squares = 0n;
    for (const part of parts) {
      const x = part.integer === 0n ? 0n : part.integer << BigInt(part.exponent - exponent);
      sum += x;
      squares += x * x;
    }
  }
  const n = BigInt(count), dispersion = n * squares - sum * sum;
  return Object.freeze({
    count,
    mean: rounded(sum, n, exponent),
    std: count > 1 ? rounded(dispersion, n * (n - 1n), exponent, true) : 0,
    moments: Object.freeze({ sum: sum.toString(), dispersion: dispersion.toString(), exponent })
  });
}
function exactZScore(amount, stats) {
  const dispersion = BigInt(stats.moments.dispersion);
  if (dispersion === 0n) return 0;
  const part = dyadic(amount), exponent = Math.min(part.exponent, stats.moments.exponent);
  const x = part.integer << BigInt(part.exponent - exponent);
  const sum = BigInt(stats.moments.sum) << BigInt(stats.moments.exponent - exponent);
  const n = BigInt(stats.count), delta = n * x - sum;
  const d = dispersion << BigInt(2 * (stats.moments.exponent - exponent));
  const magnitude = rounded(delta * delta * (n - 1n), n * d, 0, true);
  return magnitude === 0 ? 0 : delta < 0n ? -magnitude : magnitude;
}

// examples/spending-alerts/causal-business.ts
function frame(rows, issues = [], valid = true) {
  return frozen({ valid, rows, issues });
}
function nodeMaker(scope, prefix, edges) {
  return (name, deps, fn) => {
    const expected = Object.freeze([...deps]);
    const node = scope.node(
      expected,
      (ctx) => {
        if (node.deps.length !== expected.length || node.deps.some((d, i) => d !== expected[i])) {
          ctx.down([["ERROR", new TypeError(`spending dependency mismatch: ${name}`)]]);
          return;
        }
        fn(ctx);
      },
      {
        name: `${prefix}/${name}`,
        factory: `spending/${name}`,
        partial: true,
        errorWhenDepsError: true
      }
    );
    edges.set(node, expected);
    return node;
  };
}
function project(make, name, input, fn) {
  return make(name, [input], (ctx) => {
    for (const raw of depWaves(ctx, 0).flat()) {
      if (raw === SENTINEL) {
        ctx.down([["DATA", frame([], [], false)]]);
        continue;
      }
      const f = raw;
      ctx.down([
        [
          "DATA",
          frame(
            f.rows.map((r) => ({ evaluation: r.evaluation, value: fn(r.value, r.evaluation) })),
            f.issues,
            f.valid
          )
        ]
      ]);
    }
  });
}
function join(make, name, deps, fn) {
  return make(name, deps, (ctx) => {
    let state = ctx.state.get();
    if (!state) {
      state = { maps: deps.map(() => /* @__PURE__ */ new Map()), valid: deps.map(() => false) };
      ctx.state.set(state);
    }
    const touched = /* @__PURE__ */ new Set(), issues = [];
    for (let i = 0; i < deps.length; i++) {
      if (depLatest(ctx, i) === void 0) {
        state.maps[i].clear();
        state.valid[i] = false;
      }
      for (const raw of depWaves(ctx, i).flat()) {
        if (raw === SENTINEL) {
          state.maps[i].clear();
          state.valid[i] = false;
          continue;
        }
        const f = raw;
        state.valid[i] = f.valid;
        issues.push(...f.issues);
        if (!f.valid) {
          state.maps[i].clear();
          continue;
        }
        for (const row of f.rows) {
          const k = occurrenceKey(row.evaluation.occurrence);
          if (!state.maps[i].has(k) && state.maps[i].size >= 64) {
            issues.push(issue2("join-capacity", row.evaluation.evaluationRef));
            continue;
          }
          state.maps[i].set(k, row);
          touched.add(k);
        }
      }
    }
    if (!state.valid.every(Boolean)) {
      ctx.down([["DATA", frame([], issues, false)]]);
      return;
    }
    const rows = [];
    for (const k of touched) {
      const parts = state.maps.map((m) => m.get(k));
      if (parts.every((p) => p !== void 0)) {
        const e = parts[0].evaluation;
        if (parts.some(
          (p) => p.evaluation !== e && canonicalMaterial(p.evaluation) !== canonicalMaterial(e)
        )) {
          issues.push(issue2("join-conflict", e.evaluationRef));
          continue;
        }
        rows.push({
          evaluation: e,
          value: fn(
            parts.map((p) => p.value),
            e
          )
        });
      }
    }
    if (rows.length || issues.length) ctx.down([["DATA", frame(rows, issues)]]);
  });
}
function checked(make, name, source, kind, binding2) {
  return make(name, [source], (ctx) => {
    let state = ctx.state.get();
    if (!state) {
      state = { seen: /* @__PURE__ */ new Map(), conflicts: /* @__PURE__ */ new Set() };
      ctx.state.set(state);
    }
    for (const raw of depWaves(ctx, 0).flat()) {
      let result = raw === SENTINEL ? { valid: false, issue: issue2(`invalidated-${kind}`) } : checkInput(kind, raw, binding2);
      if (result.valid && kind === "verification") {
        for (const entry of result.value.receipts) {
          const key = canonicalMaterial(entry.receiptRef), text2 = canonicalMaterial(entry), prior = state.seen.get(key);
          if (prior !== void 0 && prior !== text2) state.conflicts.add(key);
          if (state.conflicts.has(key)) {
            result = { valid: false, issue: issue2("receipt-identity-conflict") };
            break;
          }
          if (prior === void 0 && state.seen.size >= 64) {
            result = { valid: false, issue: issue2("receipt-lifetime-capacity") };
            break;
          }
          state.seen.set(key, text2);
        }
      }
      ctx.state.set(state);
      ctx.down([["DATA", result]]);
    }
  });
}
function buildBusiness(make, inputs, binding2) {
  const evaluationSelections = make(
    "evaluationSelections",
    [inputs.evaluations.pack, inputs.evaluations.arrivals],
    (ctx) => {
      let state = ctx.state.get();
      if (!state) {
        state = { available: false, pending: [] };
        ctx.state.set(state);
      }
      const problems = [];
      if (depLatest(ctx, 0) === void 0) state.available = false;
      for (const raw of depWaves(ctx, 0).flat()) {
        const result = raw === SENTINEL ? { valid: false, issue: issue2("invalidated-pack") } : checkInput("pack", raw, binding2);
        if (!result.valid) {
          state.available = false;
          problems.push(result.issue);
          continue;
        }
        const text2 = canonicalMaterial(result.value, 4 * 1048576);
        if (state.text !== void 0 && state.text !== text2) {
          state.available = false;
          problems.push(issue2("pack-conflict"));
          continue;
        }
        state.pack = result.value;
        state.text = text2;
        state.available = true;
      }
      const emitPending = () => {
        if (!state.available || !state.pack) return;
        const byRef = new Map(state.pack.evaluations.map((e) => [e.evaluationRef, e])), rows = [];
        for (const ref3 of state.pending) {
          const e = byRef.get(ref3);
          if (e) rows.push({ evaluation: e, value: e });
          else problems.push(issue2("unknown-evaluation", ref3));
        }
        state.pending = [];
        if (rows.length || problems.length) ctx.down([["DATA", frame(rows, problems.splice(0))]]);
      };
      emitPending();
      for (const raw of depWaves(ctx, 1).flat()) {
        const result = raw === SENTINEL ? { valid: false, issue: issue2("invalidated-arrivals") } : checkInput("arrivals", raw, binding2);
        if (!result.valid) {
          problems.push(result.issue);
          state.pending = [];
          ctx.down([["DATA", frame([], problems.splice(0), false)]]);
          continue;
        }
        for (const ref3 of result.value.evaluationRefs) {
          if (state.pending.length >= 64) {
            problems.push(issue2("arrival-capacity", ref3));
            break;
          }
          state.pending.push(ref3);
        }
        emitPending();
      }
      if (problems.length) ctx.down([["DATA", frame([], problems, false)]]);
    }
  );
  const transaction2 = project(
    make,
    "transaction",
    evaluationSelections,
    (e) => e.prefix[e.prefix.length - 1]
  );
  const vendorStats = project(
    make,
    "vendorStats",
    evaluationSelections,
    (e) => exactVendorStats(e.prefix.map((t) => t.amount))
  );
  const userProfile = project(make, "userProfile", evaluationSelections, (e) => e.profile);
  const policy2 = project(make, "policy", evaluationSelections, (e) => e.policy);
  const anomalyScore = join(
    make,
    "anomalyScore",
    [transaction2, vendorStats, userProfile],
    ([rawTxn, rawStats, rawProfile]) => {
      const txn = rawTxn, stats = rawStats, prof = rawProfile;
      return {
        zScore: exactZScore(txn.amount, stats),
        dailyRatio: txn.amount / Math.max(prof.dailyAverage, 1),
        categoryFamiliarity: prof.typicalCategories.includes(txn.category) ? "known" : "unknown",
        txn
      };
    }
  );
  const thresholdGate = join(make, "thresholdGate", [anomalyScore, policy2], ([a, p]) => {
    const score = a, policy3 = p;
    return {
      flagged: score.zScore > policy3.zThreshold || score.dailyRatio > policy3.dailyRatioThreshold || score.categoryFamiliarity === "unknown",
      threshold: policy3.zThreshold,
      txn: score.txn,
      score
    };
  });
  const reasonFactors = join(
    make,
    "reasonFactors",
    [thresholdGate, policy2],
    ([g, p]) => {
      const gate = g, policy3 = p, { score, txn } = gate, factors = [];
      if (gate.flagged) {
        if (score.zScore > policy3.zThreshold)
          factors.push(
            `Amount is ${score.zScore.toFixed(2)}\u03C3 above this vendor's historical mean.`
          );
        if (score.dailyRatio > policy3.dailyRatioThreshold)
          factors.push(`Amount is ${score.dailyRatio.toFixed(1)}\xD7 the user's daily average.`);
        if (score.categoryFamiliarity === "unknown")
          factors.push("Category is outside the user's typical spend profile.");
      }
      return {
        factors,
        severity: factors.length >= 3 ? "high" : factors.length === 2 ? "medium" : "low",
        txn
      };
    }
  );
  const alertMessage = project(make, "alertMessage", reasonFactors, (reason) => {
    const txn = reason.txn;
    if (!reason.factors.length)
      return {
        message: `Transaction ${txn.id} ($${txn.amount.toFixed(2)} at ${txn.vendor}) \u2014 normal.`,
        severity: reason.severity
      };
    return {
      message: [
        `Transaction ${txn.id} flagged \u2014 severity: ${reason.severity}.`,
        `Vendor: ${txn.vendor}  Amount: $${txn.amount.toFixed(2)}  Category: ${txn.category}`,
        "Reasoning:",
        reason.factors.map((f) => `  \u2022 ${f}`).join("\n")
      ].join("\n"),
      severity: reason.severity
    };
  });
  const assessment = join(
    make,
    "assessment",
    [thresholdGate, reasonFactors, alertMessage],
    ([g, r, m], e) => ({
      kind: "spending-alerts/assessment",
      evidenceMode: "fixture-observations",
      binding: binding2,
      evaluationRef: e.evaluationRef,
      occurrence: e.occurrence,
      inputDigest: e.inputDigest,
      policyDigest: e.policyDigest,
      flagged: g.flagged,
      score: g.score,
      reason: r,
      message: m.message
    })
  );
  return {
    evaluationSelections,
    transaction: transaction2,
    vendorStats,
    userProfile,
    policy: policy2,
    anomalyScore,
    thresholdGate,
    reasonFactors,
    alertMessage,
    assessment
  };
}

// examples/spending-alerts/causal-admission.ts
function collect(ctx, count) {
  let s = ctx.state.get();
  if (!s) {
    s = {
      maps: Array.from({ length: count }, () => /* @__PURE__ */ new Map()),
      valid: Array.from({ length: count }, () => false)
    };
    ctx.state.set(s);
  }
  for (let i = 0; i < count; i++) {
    if (depLatest(ctx, i) === void 0) {
      s.maps[i].clear();
      s.valid[i] = false;
    }
    for (const raw of depWaves(ctx, i).flat()) {
      if (raw === SENTINEL) {
        s.maps[i].clear();
        s.valid[i] = false;
        continue;
      }
      const f = raw;
      s.valid[i] = f.valid;
      if (!f.valid) {
        s.maps[i].clear();
        continue;
      }
      for (const row of f.rows) {
        const k = occurrenceKey(row.evaluation.occurrence);
        if (s.maps[i].has(k) || s.maps[i].size < 64) s.maps[i].set(k, row);
      }
    }
  }
  return s;
}
function latest(ctx, i) {
  const c = depLatest(ctx, i);
  return c?.valid ? c.value : void 0;
}
function buildAdmission(make, inputs, binding2, business, materials) {
  const currentFacts = checked(
    make,
    "currentFacts",
    inputs.evaluations.current,
    "current",
    binding2
  );
  const verificationFacts = checked(
    make,
    "verificationFacts",
    inputs.verification.receipts,
    "verification",
    binding2
  );
  const localFacts = checked(
    make,
    "localFacts",
    inputs.localAuthority.facts,
    "local",
    binding2
  );
  const inboxFacts = checked(
    make,
    "inboxFacts",
    inputs.inbox.facts,
    "inbox",
    binding2
  );
  const publicationPolicy = make(
    "publicationPolicy",
    [
      business.evaluationSelections,
      business.thresholdGate,
      materials.materialStore,
      currentFacts,
      verificationFacts,
      localFacts,
      inboxFacts
    ],
    (ctx) => {
      const s = collect(ctx, 3);
      s.issued ??= /* @__PURE__ */ new Map();
      const current = latest(ctx, 3), verification = latest(ctx, 4), local = latest(ctx, 5), inbox = latest(ctx, 6);
      const rows = [], problems = [];
      if (!s.valid.every(Boolean)) {
        ctx.down([["DATA", frame([], [], false)]]);
        return;
      }
      let receiptConflict;
      let comparisonTexts;
      const comparisonKey = (value) => {
        const prior = comparisonTexts?.get(value);
        if (prior !== void 0) return prior;
        const text2 = canonicalMaterial(value);
        comparisonTexts ??= /* @__PURE__ */ new Map();
        comparisonTexts.set(value, text2);
        return text2;
      };
      const sameInInvocation = (left, right) => comparisonKey(left) === comparisonKey(right);
      for (const [k, r] of s.maps[0]) {
        const e = r.evaluation, gate = s.maps[1].get(k)?.value, material = s.maps[2].get(k)?.value;
        if (!gate || !material) continue;
        const prior = s.issued.get(k);
        if (prior) continue;
        let state = "completed", admission, reason = "no-publish";
        if (gate.flagged) {
          if (material.kind === "rejected") {
            state = "failed";
            reason = material.issue.code;
          } else if (material.kind !== "retained") continue;
          else {
            const p = proposalForMaterial(material.material), requestDigest = material.material.body.payloadDigest;
            if (!verification) {
              problems.push(issue2("policy-input-pending", e.evaluationRef));
              continue;
            }
            const candidates = verification.receipts.filter(
              (v) => sameInInvocation(v.occurrence, e.occurrence) && v.inputDigest === e.inputDigest && v.policyDigest === e.policyDigest && v.sourceDigest === binding2.sourceDigest && v.runtimeDigest === binding2.runtimeDigest && v.requestDigest === requestDigest && v.verifierRevision === VERIFIER_REVISION && v.numericDomainRef === NUMERIC_DOMAIN
            );
            if (receiptConflict === void 0) {
              const receipts = /* @__PURE__ */ new Map();
              receiptConflict = false;
              for (const v of verification.receipts) {
                const key = hash(v.receiptRef), digest3 = hash(v);
                if (receipts.has(key) && receipts.get(key) !== digest3) receiptConflict = true;
                receipts.set(key, digest3);
              }
            }
            if (receiptConflict || candidates.length !== 1 || candidates[0].verdict === "unavailable") {
              problems.push(issue2("verification-pending-or-conflict", e.evaluationRef));
              continue;
            }
            const receipt2 = candidates[0];
            if (receipt2.verdict === "fail") {
              reason = "verification-rejected";
              state = "failed";
              admission = frozen({
                ...p,
                admissionRef: {
                  kind: "spending-admission",
                  id: hash({
                    proposal: p,
                    receiptRef: receipt2.receiptRef,
                    verdict: "fail",
                    binding: binding2
                  })
                },
                state: "rejected"
              });
            } else {
              if (!current || !local || !inbox) {
                problems.push(issue2("policy-input-pending", e.evaluationRef));
                continue;
              }
              const c = current.current.find((f) => sameInInvocation(f.occurrence, e.occurrence));
              if (!c || !sameInInvocation(c.policyRef, e.policyRef) || c.policyDigest !== e.policyDigest || c.watermark < e.occurrence.revision) {
                problems.push(issue2("policy-current-mismatch", e.evaluationRef));
                continue;
              }
              const grants = local.grants.filter(
                (g) => sameInInvocation(g.occurrence, e.occurrence) && g.requestDigest === requestDigest && sameInInvocation(g.destinationRef, binding2.destinationRef) && g.hostEpoch === binding2.hostEpoch && g.replayScope.hostEpoch === binding2.hostEpoch && g.replayScope.compositionEpoch === binding2.compositionEpoch
              );
              if (grants.length !== 1) {
                problems.push(issue2("grant-pending-or-conflict", e.evaluationRef));
                continue;
              }
              const grant2 = grants[0];
              const refused = grant2.revoked || local.stop || local.tick < grant2.validFrom || local.tick > grant2.validThrough;
              if (!refused && (!inbox.readiness.ready || inbox.readiness.availableSlots !== 1 || local.tick < inbox.readiness.observedAt || local.tick > inbox.readiness.validThrough)) {
                problems.push(issue2("inbox-not-ready", e.evaluationRef));
                continue;
              }
              reason = refused ? "publication-rejected" : "fixture-admission";
              state = refused ? "failed" : "completed";
              admission = frozen({
                ...p,
                admissionRef: {
                  kind: "spending-admission",
                  id: hash({
                    proposal: p,
                    receiptRef: receipt2.receiptRef,
                    grantRef: grant2.grantRef,
                    binding: binding2
                  })
                },
                state: refused ? "rejected" : "admitted"
              });
            }
          }
        }
        const terminal = {
          occurrence: e.occurrence,
          branch: "publication-policy",
          state,
          result: state === "failed" ? { kind: "error", error: issue2(reason, e.evaluationRef) } : { kind: "ok", value: { reason, evidenceMode: "fixture-observations" } }
        };
        if (s.issued.size >= 64) {
          problems.push(issue2("policy-capacity", e.evaluationRef));
          continue;
        }
        const value = frozen({ terminal, ...admission ? { admission } : {} });
        s.issued.set(k, value);
        rows.push({ evaluation: e, value });
      }
      ctx.state.set(s);
      if (rows.length || problems.length) ctx.down([["DATA", frame(rows, problems)]]);
    }
  );
  const occurrences = make(
    "occurrences",
    [business.evaluationSelections],
    (ctx) => {
      const outputs = [];
      const emit = (messages) => outputs.push(...messages);
      for (const f of depBatch(ctx, 0) ?? [])
        if (f.valid)
          for (const { evaluation: e } of f.rows) {
            const { occurrence: occurrence3, ...value } = e;
            emit([["DATA", { ...occurrence3, value }]]);
          }
      if (outputs.length) ctx.down(outputs);
    }
  );
  const occurrenceAdmissions = make(
    "occurrenceAdmissions",
    [business.evaluationSelections, currentFacts],
    (ctx) => {
      const outputs = [];
      const emit = (messages) => outputs.push(...messages);
      const s = collect(ctx, 1);
      if (!s.valid[0]) return;
      const frames = depBatch(ctx, 1) ?? [depLatest(ctx, 1)];
      for (const checked2 of frames) {
        if (!checked2?.valid) continue;
        const current = checked2.value;
        for (const { evaluation: e } of s.maps[0].values()) {
          const c = current.current.find(
            (c2) => same(c2.occurrence, e.occurrence) && same(c2.policyRef, e.policyRef) && c2.policyDigest === e.policyDigest
          );
          if (c)
            emit([
              [
                "DATA",
                {
                  occurrence: e.occurrence,
                  decisionId: `evaluation:${e.evaluationRef}`,
                  decisionDigest: hash({ occurrence: e.occurrence, inputDigest: e.inputDigest }),
                  state: "admitted"
                }
              ]
            ]);
        }
      }
      if (outputs.length) ctx.down(outputs);
    }
  );
  const branchTerminals = make(
    "branchTerminals",
    [business.assessment, business.alertMessage, publicationPolicy],
    (ctx) => {
      const outputs = [];
      const emit = (messages) => outputs.push(...messages);
      for (let i = 0; i < 3; i++)
        for (const f of depBatch(ctx, i) ?? [])
          if (f.valid)
            for (const row of f.rows) {
              const value = i === 2 ? row.value.terminal : {
                occurrence: row.evaluation.occurrence,
                branch: i === 0 ? "assessment" : "explanation",
                state: "completed",
                result: { kind: "ok", value: row.value }
              };
              emit([["DATA", value]]);
            }
      if (outputs.length) ctx.down(outputs);
    }
  );
  const effectAdmissions = make(
    "effectAdmissions",
    [publicationPolicy],
    (ctx) => {
      const outputs = [];
      const emit = (messages) => outputs.push(...messages);
      for (const f of depBatch(ctx, 0) ?? [])
        if (f.valid) {
          for (const row of f.rows) if (row.value.admission) emit([["DATA", row.value.admission]]);
        }
      if (outputs.length) ctx.down(outputs);
    }
  );
  const effectOutcomes = make("effectOutcomes", [inboxFacts], (ctx) => {
    const outputs = [];
    const emit = (messages) => outputs.push(...messages);
    for (const f of depBatch(ctx, 0) ?? [])
      if (f.valid) for (const outcome2 of f.value.outcomes) emit([["DATA", outcome2]]);
    if (outputs.length) ctx.down(outputs);
  });
  const evidence = make(
    "evidence",
    [business.evaluationSelections, materials.materialStore, verificationFacts],
    (ctx) => {
      const outputs = [];
      const emit = (messages) => outputs.push(...messages);
      const s = collect(ctx, 2);
      s.receipts ??= /* @__PURE__ */ new Map();
      const verificationFrames = depBatch(ctx, 2) ?? [depLatest(ctx, 2)];
      for (const f of verificationFrames)
        if (f?.valid)
          for (const receipt2 of f.value.receipts) {
            const key = hash(receipt2.receiptRef);
            if (!s.receipts.has(key) && s.receipts.size < 64) s.receipts.set(key, receipt2);
          }
      if (!s.valid[0]) return;
      let verification;
      for (const { evaluation: e } of s.maps[0].values()) {
        const exactOccurrence2 = occurrenceKey(e.occurrence);
        for (const [kind, digest3] of [
          ["spending-input", e.inputDigest],
          [
            "spending-code-binding",
            hash({ sourceDigest: binding2.sourceDigest, runtimeDigest: binding2.runtimeDigest })
          ]
        ])
          emit([
            [
              "DATA",
              {
                occurrence: e.occurrence,
                evidenceKind: kind,
                evidenceId: `${e.evaluationRef}:${kind}`,
                evidenceDigest: digest3,
                coverage: "included",
                refs: [binding2.runRef]
              }
            ]
          ]);
        const material = s.valid[1] ? s.maps[1].get(exactOccurrence2)?.value : void 0;
        if (!material) continue;
        verification ??= [...s.receipts.values()].map((receipt2) => ({
          receipt: receipt2,
          occurrence: occurrenceKey(receipt2.occurrence)
        }));
        const expectedRequest = material.kind === "retained" ? material.material.body.payloadDigest : material.kind === "normal" ? hash({ kind: "no-publish", evaluationRef: e.evaluationRef }) : void 0;
        for (const { receipt: v, occurrence: occurrence3 } of verification)
          if (occurrence3 === exactOccurrence2)
            emit([
              [
                "DATA",
                {
                  occurrence: e.occurrence,
                  evidenceKind: "spending-verification",
                  evidenceId: hash(v.receiptRef),
                  evidenceDigest: hash(v),
                  coverage: v.sourceDigest !== binding2.sourceDigest || v.runtimeDigest !== binding2.runtimeDigest || v.inputDigest !== e.inputDigest || v.policyDigest !== e.policyDigest || v.verifierRevision !== VERIFIER_REVISION || v.numericDomainRef !== NUMERIC_DOMAIN || expectedRequest !== void 0 && v.requestDigest !== expectedRequest ? "stale" : v.verdict === "unavailable" || expectedRequest === void 0 ? "unavailable" : "included",
                  refs: [v.artifactRef.id]
                }
              ]
            ]);
      }
      if (outputs.length) ctx.down(outputs);
    }
  );
  const watermarks = make("watermarks", [currentFacts], (ctx) => {
    const outputs = [];
    const emit = (messages) => outputs.push(...messages);
    for (const f of depBatch(ctx, 0) ?? [])
      if (f.valid)
        for (const c of f.value.current)
          emit([["DATA", { revisionDomain: c.revisionDomain, revision: c.watermark }]]);
    if (outputs.length) ctx.down(outputs);
  });
  return {
    currentFacts,
    verificationFacts,
    localFacts,
    inboxFacts,
    publicationPolicy,
    occurrences,
    occurrenceAdmissions,
    branchTerminals,
    effectAdmissions,
    effectOutcomes,
    evidence,
    watermarks
  };
}

// examples/spending-alerts/causal-material-owner.ts
function buildMaterials(make, business, binding2) {
  const profile3 = materialProfile(binding2);
  const requestMaterials = join(
    make,
    "requestMaterials",
    [business.evaluationSelections, business.thresholdGate, business.alertMessage],
    ([, g, m], e) => {
      const gate = g, message = m;
      if (!gate.flagged) return { kind: "normal" };
      try {
        const payloadText = canonicalMaterial({
          transactionId: gate.txn.id,
          vendor: gate.txn.vendor,
          severity: message.severity,
          message: message.message
        });
        if (Buffer.byteLength(payloadText) + 1 > 4096) throw new TypeError("payload-capacity");
        const material = makeRequestMaterial({
          schema: "spending-alerts/request-material/v1",
          occurrence: e.occurrence,
          effectId: `alert:${e.evaluationRef}`,
          inputDigest: e.inputDigest,
          policyDigest: e.policyDigest,
          payloadText,
          payloadDigest: materialDigest(payloadText),
          sourceDigest: profile3.sourceDigest,
          runtimeDigest: profile3.runtimeDigest,
          destinationRef: profile3.destinationRef,
          compositionEpoch: profile3.compositionEpoch,
          hostEpoch: profile3.hostEpoch
        });
        return { kind: "retained", material };
      } catch {
        return { kind: "rejected", issue: issue2("material-format-or-capacity", e.evaluationRef) };
      }
    }
  );
  const materialStore = make("materialStore", [requestMaterials], (ctx) => {
    let s = ctx.state.get();
    if (!s) {
      s = { materials: /* @__PURE__ */ new Map(), snapshot: makeMaterialSnapshot(profile3, []) };
      ctx.state.set(s);
    }
    for (const f of depBatch(ctx, 0) ?? []) {
      const rows = [], problems = [...f.issues];
      for (const row of f.rows) {
        const result = row.value;
        if (result.kind !== "retained") {
          rows.push(row);
          if (result.kind === "rejected") problems.push(result.issue);
          continue;
        }
        const key = occurrenceKey(row.evaluation.occurrence), prior = s.materials.get(key);
        let failure;
        if (prior) {
          if (canonicalMaterial(prior) !== canonicalMaterial(result.material))
            failure = issue2("material-conflict", row.evaluation.evaluationRef);
          else {
            rows.push({ evaluation: row.evaluation, value: { kind: "retained", material: prior } });
            continue;
          }
        } else if (s.materials.size >= 64)
          failure = issue2("material-count-capacity", row.evaluation.evaluationRef);
        else {
          try {
            const next = makeMaterialSnapshot(profile3, [...s.materials.values(), result.material]);
            canonicalMaterial(next, 1048576);
            s.materials.set(key, result.material);
            s.snapshot = next;
          } catch {
            failure = issue2("material-byte-capacity", row.evaluation.evaluationRef);
          }
        }
        if (failure) {
          problems.push(failure);
          rows.push({ evaluation: row.evaluation, value: { kind: "rejected", issue: failure } });
        } else rows.push(row);
      }
      ctx.state.set(s);
      ctx.down([["DATA", frozen({ ...frame(rows, problems, f.valid), snapshot: s.snapshot })]]);
    }
  });
  const materialSnapshot = make("materialSnapshot", [materialStore], (ctx) => {
    for (const f of depBatch(ctx, 0) ?? []) ctx.down([["DATA", f.snapshot]]);
  });
  const effectProposals = make("effectProposals", [materialStore], (ctx) => {
    const outputs = [];
    for (const f of depBatch(ctx, 0) ?? [])
      if (f.valid) {
        for (const row of f.rows)
          if (row.value.kind === "retained")
            outputs.push(["DATA", proposalForMaterial(row.value.material)]);
      }
    if (outputs.length) ctx.down(outputs);
  });
  return { requestMaterials, materialStore, materialSnapshot, effectProposals };
}

// examples/spending-alerts/causal-preset.ts
var BUSINESS_NAMES = Object.freeze([
  "evaluationSelections",
  "transaction",
  "vendorStats",
  "userProfile",
  "policy",
  "currentFacts",
  "verificationFacts",
  "localFacts",
  "inboxFacts",
  "anomalyScore",
  "thresholdGate",
  "reasonFactors",
  "alertMessage",
  "assessment",
  "requestMaterials",
  "materialStore",
  "materialSnapshot",
  "effectProposals",
  "publicationPolicy",
  "occurrences",
  "occurrenceAdmissions",
  "branchTerminals",
  "effectAdmissions",
  "effectOutcomes",
  "evidence",
  "watermarks",
  "consumerIssues"
]);
function spendingNodeNames(name, diagnostics = "off") {
  return Object.freeze([
    `${name}/startup`,
    ...BUSINESS_NAMES.map((n) => `${name}/${n}`),
    ...causalColdNodeNames(`${name}/causal`),
    "requestMaterialJoin",
    "publication",
    ...diagnostics === "summary" ? [`${name}/diagnosticSummary`] : []
  ]);
}
function spendingInputNodes(inputs) {
  if (!inputs || Object.keys(inputs).sort().join(",") !== "evaluations,inbox,localAuthority,verification" || Object.keys(inputs.evaluations).sort().join(",") !== "arrivals,current,pack" || Object.keys(inputs.verification).join(",") !== "receipts" || Object.keys(inputs.localAuthority).join(",") !== "facts" || Object.keys(inputs.inbox).join(",") !== "facts")
    throw new TypeError("spending requires four exact input groups");
  const nodes = [
    inputs.evaluations.pack,
    inputs.evaluations.arrivals,
    inputs.evaluations.current,
    inputs.verification.receipts,
    inputs.localAuthority.facts,
    inputs.inbox.facts
  ];
  if (nodes.some((n) => !n) || new Set(nodes).size !== 6)
    throw new TypeError("spending requires six distinct input nodes");
  return Object.freeze(nodes);
}
function buildSpendingPresetNodes(ownerGraph, scope, startup, inputs, rawBinding, name, diagnostics = "off") {
  if (diagnostics !== "off" && diagnostics !== "summary")
    throw new TypeError("spending diagnostics");
  const binding2 = validateBinding(rawBinding);
  spendingInputNodes(inputs);
  scope.assertContext(ownerGraph, startup, binding2.compositionEpoch);
  const edges = /* @__PURE__ */ new Map(), make = nodeMaker(scope, name, edges);
  const business = buildBusiness(make, inputs, binding2), materials = buildMaterials(make, business, binding2), admission = buildAdmission(make, inputs, binding2, business, materials);
  const causalBinding2 = {
    contract: "contract-v2",
    implementationRevision: "construction-v1",
    scope: "full",
    epoch: binding2.compositionEpoch
  };
  const publication = buildSpendingPublication(
    ownerGraph,
    scope,
    startup,
    prepareCausalOptions({
      name: `${name}/causal`,
      occurrences: admission.occurrences,
      admissions: admission.occurrenceAdmissions,
      branchTerminals: admission.branchTerminals,
      effectProposals: materials.effectProposals,
      effectAdmissions: admission.effectAdmissions,
      effectOutcomes: admission.effectOutcomes,
      evidence: admission.evidence,
      watermarks: admission.watermarks,
      requiredBranches: ["assessment", "explanation", "publication-policy"],
      requiredEvidenceKinds: ["spending-input", "spending-code-binding", "spending-verification"],
      maxOccurrences: 64,
      maxPending: 64,
      maxEffects: 64,
      maxEvidence: 512
    }),
    causalBinding2,
    materials.materialSnapshot,
    materialProfile(binding2)
  );
  const consumerIssues = make(
    "consumerIssues",
    [
      business.evaluationSelections,
      admission.currentFacts,
      admission.verificationFacts,
      admission.localFacts,
      admission.inboxFacts,
      materials.requestMaterials,
      materials.materialStore,
      admission.publicationPolicy,
      publication.causal.ports.issues
    ],
    (ctx) => {
      for (let i = 0; i < 9; i++)
        for (const raw of depBatch(ctx, i) ?? []) {
          const value = raw;
          if (value.kind === "issue") ctx.down([["DATA", raw]]);
          else {
            if (value.issue) ctx.down([["DATA", value.issue]]);
            for (const issue3 of value.issues ?? []) ctx.down([["DATA", issue3]]);
          }
        }
    }
  );
  const view = Object.freeze({
    assessment: business.assessment,
    publication: publication.publication,
    coverage: publication.causal.ports.coverage,
    issues: consumerIssues,
    startup
  });
  const consume = Object.freeze({ view, capabilities: publication.causal.full });
  assertCausalCapabilities(ownerGraph, consume.capabilities, causalBinding2);
  const diagnosticSummary = diagnostics === "summary" ? make(
    "diagnosticSummary",
    [view.assessment, view.publication, view.coverage, view.issues],
    (ctx) => {
      const arrivals2 = ctx.waveData.map((_, i) => depBatch(ctx, i)?.length ?? 0);
      ctx.down([["DATA", frozen({ kind: "spending-diagnostic-summary", arrivals: arrivals2 })]]);
    }
  ) : void 0;
  for (const [node, expected] of edges)
    if (node.deps.length !== expected.length || node.deps.some((dep, i) => dep !== expected[i]))
      throw new TypeError("spending cold topology mismatch");
  assertCausalOccurrenceTopology(scope.readIncoming(), `${name}/causal`);
  return Object.freeze({
    consume,
    roots: publication.causal.roots,
    diagnosticSummary,
    business,
    materials,
    admission,
    publication
  });
}

// examples/spending-alerts/causal-focused-host.ts
var OfflineAlertResource = class {
  constructor(binding2, writeBytes) {
    this.writeBytes = writeBytes;
    this.binding = validateBinding(binding2);
    Object.freeze(this);
  }
  writeBytes;
  kind = "offline-alert-resource";
  binding;
  #claimed = false;
  claim() {
    if (this.#claimed) throw new TypeError("offline host epoch already claimed");
    this.#claimed = true;
    let phase = "cold";
    return {
      write: (payload) => {
        if (phase !== "transferred") throw new TypeError("offline lease is not transferred");
        return this.writeBytes(payload);
      },
      abort: () => {
        if (phase === "cold") {
          phase = "aborted";
          this.#claimed = false;
        }
      },
      transfer: () => {
        if (phase !== "cold") throw new TypeError("offline lease is not cold");
        phase = "transferred";
      }
    };
  }
};
function composeOfflineSpending(graph, inputs, rawBinding, resource, options) {
  const binding2 = validateBinding(rawBinding), name = options.name;
  if (!(resource instanceof OfflineAlertResource) || resource.kind !== "offline-alert-resource" || !same(resource.binding, binding2))
    throw new TypeError("offline resource binding");
  const scope = prepareConstruction(graph, {
    name,
    epoch: binding2.compositionEpoch,
    names: [
      ...spendingNodeNames(name, options.diagnostics),
      `${name}/hostFacts`,
      `${name}/hostGuard`,
      `${name}/runEndReady`,
      `${name}/hostPackFacts`
    ],
    inputs: [
      inputs.evaluations.pack,
      inputs.evaluations.arrivals,
      inputs.evaluations.current,
      inputs.verification.receipts,
      inputs.localAuthority.facts
    ]
  });
  const lease = resource.claim();
  try {
    const startup = scope.startupSource();
    const builtHost = buildOfflineSpendingHost(
      graph,
      scope,
      startup,
      inputs,
      binding2,
      lease,
      options
    );
    const owner = scope.seal(startup, builtHost.roots);
    scope.transferToGraph(owner);
    lease.transfer();
    startConstruction(graph, owner);
    builtHost.afterStart(owner);
    return Object.freeze({
      consume: builtHost.consume,
      owner,
      guard: builtHost.guard,
      source: builtHost.source,
      runEndReady: builtHost.runEndReady,
      built: builtHost.built,
      inspect: builtHost.inspect
    });
  } catch (error) {
    lease.abort();
    return scope.abort(error);
  }
}
function buildOfflineSpendingHost(graph, scope, startup, inputs, binding2, lease, options) {
  scope.assertContext(graph, startup, binding2.compositionEpoch);
  const name = options.name;
  const records = /* @__PURE__ */ new Map();
  let inFlight = 0, writes = 0, scheduled = false, delivering = false, revision = 0, notifications = 0;
  let fault;
  let notified = false;
  let maxFrameBytes = 0;
  const source = scope.node([], null, {
    name: `${name}/hostFacts`,
    factory: "offlineSpendingHostFacts"
  });
  const frame2 = () => frozen({
    binding: binding2,
    issuerRef: { kind: "fixture", id: "owned-offline-host" },
    artifactRef: { kind: "fixture-artifact", id: "simulated-writes" },
    artifactDigest: hash("offline-host-not-real-io"),
    readiness: {
      ready: !fault && inFlight === 0 && records.size < 64,
      observedAt: 0,
      validThrough: Number.MAX_SAFE_INTEGER,
      availableSlots: !fault && inFlight === 0 && records.size < 64 ? 1 : 0
    },
    outcomes: [...records.values()].flatMap((r) => r.outcome ? [r.outcome] : [])
  });
  const schedule = () => {
    if (scheduled || delivering || fault) return;
    scheduled = true;
    try {
      queueMicrotask(() => {
        scheduled = false;
        delivering = true;
        const captured = revision;
        try {
          const snapshot = frame2();
          maxFrameBytes = Math.max(maxFrameBytes, Buffer.byteLength(canonicalMaterial(snapshot)));
          notifications++;
          source.down([["DATA", snapshot]]);
        } catch {
          fault = "delivery-failed";
        } finally {
          delivering = false;
        }
        if (!fault && captured !== revision) schedule();
      });
    } catch {
      scheduled = false;
      fault = "schedule-failed";
    }
  };
  const complete = (r, state, code) => {
    if (r.outcome) return;
    const result = state === "succeeded" ? { kind: "ok", value: { source: "offline-host", io: false } } : {
      kind: "error",
      error: { kind: "issue", code: `spending-host/${code}`, message: code }
    };
    canonicalMaterial(result, 4096);
    r.outcome = frozen({
      ...proposalForMaterial(r.request),
      admissionRef: r.admission.admissionRef,
      state,
      result
    });
    revision++;
    schedule();
  };
  const built = buildSpendingPresetNodes(
    graph,
    scope,
    startup,
    { ...inputs, inbox: { facts: source } },
    binding2,
    name,
    options.diagnostics
  );
  const packFacts = scope.node(
    [inputs.evaluations.pack],
    (ctx) => {
      if (packFacts.deps.length !== 1 || packFacts.deps[0] !== inputs.evaluations.pack || depLatest(ctx, 0) === void 0) {
        ctx.down([
          [
            "DATA",
            {
              valid: false,
              issue: {
                kind: "issue",
                code: "host-pack-unavailable",
                message: "host pack unavailable"
              }
            }
          ]
        ]);
        return;
      }
      let original = ctx.state.get();
      for (const raw of depBatch(ctx, 0) ?? []) {
        const value = checkInput("pack", raw, binding2);
        if (value.valid) {
          const digest3 = hash(value.value);
          if (original !== void 0 && original !== digest3) {
            ctx.down([
              [
                "DATA",
                {
                  valid: false,
                  issue: {
                    kind: "issue",
                    code: "host-pack-conflict",
                    message: "host pack conflict"
                  }
                }
              ]
            ]);
            continue;
          }
          original = digest3;
          ctx.state.set(original);
        }
        ctx.down([["DATA", value]]);
      }
    },
    { name: `${name}/hostPackFacts`, factory: "offlineSpendingHostPackFacts" }
  );
  const deps = [
    built.publication.causal.committedEffects,
    built.materials.materialSnapshot,
    built.admission.currentFacts,
    built.admission.verificationFacts,
    built.admission.localFacts,
    built.admission.inboxFacts,
    packFacts
  ];
  const guard = scope.node(
    deps,
    (ctx) => {
      if (guard.deps.length !== deps.length || guard.deps.some((node, i) => node !== deps[i])) {
        fault = "guard-dependency-mismatch";
        return;
      }
      let comparisonTexts;
      const comparisonKey = (value) => {
        const prior = comparisonTexts?.get(value);
        if (prior !== void 0) return prior;
        const text2 = canonicalMaterial(value);
        comparisonTexts ??= /* @__PURE__ */ new Map();
        comparisonTexts.set(value, text2);
        return text2;
      };
      const same2 = (left, right) => comparisonKey(left) === comparisonKey(right);
      const view = depLatest(ctx, 0);
      const material = depLatest(ctx, 1);
      if (!view || !material) return;
      if (view.authorityId !== `${name}/causal/authority` || view.binding.epoch !== binding2.compositionEpoch || !same2(material.body.packRef, binding2.packRef)) {
        fault = "authority-binding";
        return;
      }
      const checked2 = (index) => {
        const value = depLatest(ctx, index);
        return value?.valid ? value.value : void 0;
      };
      const pack2 = depLatest(ctx, 6);
      const current = checked2(2), verification = checked2(3), local = checked2(4), inbox = checked2(5);
      for (const effect of view.effects) {
        const admission = effect.admission;
        if (!admission || admission.state !== "admitted" || effect.outcome) continue;
        const request = material.body.materials.find(
          (m) => same2(proposalForMaterial(m), effect.proposal)
        );
        if (!request || !same2(
          {
            ...proposalForMaterial(request),
            admissionRef: admission.admissionRef,
            state: admission.state
          },
          admission
        ))
          continue;
        const body = request.body;
        if (!same2(
          {
            ...materialProfile(binding2),
            schema: material.body.schema,
            materials: material.body.materials
          },
          material.body
        ) || body.hostEpoch !== binding2.hostEpoch || body.compositionEpoch !== binding2.compositionEpoch || body.sourceDigest !== binding2.sourceDigest || body.runtimeDigest !== binding2.runtimeDigest || !same2(body.destinationRef, binding2.destinationRef))
          continue;
        const key = canonicalMaterial(effect.proposal);
        const prior = records.get(key);
        if (prior) {
          if (!same2(prior.admission, admission)) fault = "admission-conflict";
          continue;
        }
        if (fault) continue;
        if (records.size >= 64) {
          fault = "record-capacity-proof-failed";
          continue;
        }
        const record = { request, admission };
        records.set(key, record);
        const currents = current?.current.filter((c) => same2(c.occurrence, effect.proposal.occurrence)) ?? [];
        const receipts = verification?.receipts.filter(
          (v) => same2(v.occurrence, body.occurrence) && v.inputDigest === body.inputDigest && v.policyDigest === body.policyDigest && v.sourceDigest === body.sourceDigest && v.runtimeDigest === body.runtimeDigest && v.requestDigest === body.payloadDigest && v.verifierRevision === VERIFIER_REVISION && v.numericDomainRef === NUMERIC_DOMAIN
        ) ?? [];
        const grants = local?.grants.filter(
          (g) => same2(g.occurrence, body.occurrence) && g.requestDigest === body.payloadDigest && same2(g.destinationRef, body.destinationRef) && g.hostEpoch === body.hostEpoch && g.replayScope.compositionEpoch === body.compositionEpoch && g.replayScope.hostEpoch === body.hostEpoch
        ) ?? [];
        const evaluation2 = pack2?.valid ? pack2.value.evaluations.find((e) => same2(e.occurrence, body.occurrence)) : void 0;
        const grant2 = grants[0], receipt2 = receipts[0], now = local?.tick;
        const denied = !local || local.stop || now === void 0 || currents.length !== 1 || currents[0].policyDigest !== body.policyDigest || currents[0].watermark < body.occurrence.revision || !evaluation2 || !same2(currents[0].policyRef, evaluation2.policyRef) || receipts.length !== 1 || receipt2.verdict !== "pass" || grants.length !== 1 || grant2.revoked || admission.admissionRef.kind !== "spending-admission" || admission.admissionRef.id !== hash({
          proposal: effect.proposal,
          receiptRef: receipt2.receiptRef,
          grantRef: grant2.grantRef,
          binding: binding2
        }) || now < grant2.validFrom || now > grant2.validThrough || !inbox || !inbox.readiness.ready || inbox.readiness.availableSlots !== 1 || now < inbox.readiness.observedAt || now > inbox.readiness.validThrough;
        if (denied) {
          complete(record, "cancelled", "final-guard");
          continue;
        }
        if (inFlight !== 0 || writes >= Math.min(64, grant2.maxWrites)) {
          complete(record, "cancelled", "busy-or-write-budget");
          continue;
        }
        const payload = `${body.payloadText}
`;
        if (Buffer.byteLength(payload) > 4096) {
          complete(record, "cancelled", "payload-capacity");
          continue;
        }
        inFlight++;
        revision++;
        schedule();
        if (fault) {
          inFlight--;
          complete(record, "cancelled", "notification-unavailable");
          continue;
        }
        writes++;
        try {
          Promise.resolve(lease.write(payload)).then(
            (result) => {
              inFlight--;
              let state = "unknown";
              try {
                const descriptor = Object.getOwnPropertyDescriptor(result, "bytesWritten");
                if (descriptor && "value" in descriptor && descriptor.value === Buffer.byteLength(payload))
                  state = "succeeded";
              } catch {
              }
              complete(record, state, "short-or-unknown-write");
            },
            () => {
              inFlight--;
              complete(record, "unknown", "write-rejected");
            }
          );
        } catch {
          inFlight--;
          complete(record, "unknown", "write-threw");
        }
      }
    },
    { name: `${name}/hostGuard`, factory: "offlineSpendingHostGuard" }
  );
  const endDeps = [
    built.publication.causal.ports.quiescence,
    built.publication.causal.committedEffects,
    built.admission.localFacts,
    packFacts
  ];
  const runEndReady = scope.node(
    endDeps,
    (ctx) => {
      if (runEndReady.deps.length !== endDeps.length || runEndReady.deps.some((n, i) => n !== endDeps[i])) {
        ctx.down([["DATA", false]]);
        return;
      }
      let domains = ctx.state.get();
      if (!domains) domains = /* @__PURE__ */ new Map();
      if (depLatest(ctx, 0) === void 0) domains.clear();
      for (const q of depBatch(ctx, 0) ?? []) {
        if (domains.has(q.revisionDomain) || domains.size < 64) domains.set(q.revisionDomain, q);
      }
      ctx.state.set(domains);
      const view = depLatest(ctx, 1);
      const local = depLatest(ctx, 2);
      const pack2 = depLatest(ctx, 3);
      const frontierCovered = !!pack2?.valid && pack2.value.evaluations.every((e) => {
        const q = domains?.get(e.occurrence.revisionDomain);
        return q !== void 0 && q.evaluatedThroughRevision >= e.occurrence.revision;
      });
      const ready = frontierCovered && !!local?.valid && local.value.stop && !!view && domains.size > 0 && [...domains.values()].every(
        (q) => q.lifecycle && q.retainedEvidence && q.pendingOccurrenceRefs.length === 0 && q.pendingEffectIds.length === 0
      ) && view.effects.every(
        (e) => e.admission?.state === "rejected" || e.outcome !== void 0 && !["unknown", "reconcile-required"].includes(e.outcome.state)
      );
      ctx.down([["DATA", ready]]);
    },
    { name: `${name}/runEndReady`, factory: "offlineSpendingRunEndReady" }
  );
  return Object.freeze({
    consume: built.consume,
    // Private runtime owner diagnostics: no arbitrary request/outcome injection method.
    roots: Object.freeze([...built.roots, guard, runEndReady]),
    afterStart: (owner) => {
      if (owner.startup !== startup || owner.epoch !== binding2.compositionEpoch)
        throw new TypeError("host startup owner mismatch");
      if (notified) throw new TypeError("host startup already notified");
      notified = true;
      if (owner.phase !== "started") fault = "startup-failed";
      revision++;
      schedule();
    },
    guard,
    source,
    runEndReady,
    built,
    inspect: () => Object.freeze({
      fault,
      normalEndReady: !fault && inFlight === 0 && !scheduled && !delivering && runEndReady.cache === true,
      writes,
      inFlight,
      scheduled,
      delivering,
      notifications,
      maxFrameBytes,
      records: Object.freeze(
        [...records.values()].map(
          (r) => frozen({ request: r.request, admission: r.admission, outcome: r.outcome })
        )
      )
    })
  });
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
  return { ok: !issues.some((issue3) => issue3.severity === "error"), issues };
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
  const push = (map2, k, v) => {
    const a = map2.get(k);
    if (a) a.push(v);
    else map2.set(k, [v]);
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
  constructor(graph, opts = {}) {
    this._graph = graph;
    this.name = opts.name;
  }
  get released() {
    return this._released;
  }
  add(node) {
    this._assertLive();
    const lifecycle = graphRegistrations.get(this._graph);
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
    const lifecycle = graphRegistrations.get(this._graph);
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

// packages/ts/src/graph/graph.ts
function nodeOwner(n) {
  return getNodeOwner(n);
}
function assertGraphLocalNode(owner, n, label) {
  const existing = nodeOwnerForGraphUse(n, label);
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
    graphRegistrations.set(this, new GraphRegistration(this));
  }
  // ── registration / inspection index ──
  /** D167: retain acquisition ownership until Graph publication, including operator factories. */
  _createRegistered(factory, deps, opts, create, id, supplied) {
    this._assertDepsLocal(deps, `dep of '${opts.name ?? factory}'`);
    const name = id ?? opts.name;
    if (name !== void 0) this._assertAvailableId(name);
    const nodeOpts = this._nodeOpts(opts);
    const acquired = supplied ?? { name: name ?? factory };
    constructionAcquisitions.set(nodeOpts, acquired);
    try {
      const n = this._construct(() => create(nodeOpts, acquired));
      this._addWithId(n, factory, deps, opts, name ?? `${factory}#${this._seq++}`, acquired);
      return n;
    } catch (cause) {
      if (supplied !== void 0 || acquired.registered) throw cause;
      failNodeAcquisition(acquired, cause);
    } finally {
      constructionAcquisitions.delete(nodeOpts);
    }
  }
  _assertAvailableId(id) {
    if (this._byId.has(id))
      throw new Error(`graph: duplicate node id '${id}' (checkpoint/describe ids must be unique)`);
    if (this._retiredIds.has(id))
      throw new Error(`graph: node id '${id}' was released and cannot be reused (D152/D153)`);
  }
  _addWithId(n, factory, deps, opts, id, acquired) {
    assertGraphLocalNode(this, n, `graph node '${opts.name ?? factory}'`);
    for (const dep of deps) assertGraphLocalNode(this, dep, `dep of '${opts.name ?? factory}'`);
    this._assertAvailableId(id);
    const meta = opts.meta === void 0 ? void 0 : normalizeTopologyMeta(opts.meta, `graph node '${id}' meta`);
    const entry = {
      node: n,
      id,
      name: opts.name,
      factory,
      deps,
      meta,
      restore: opts.restore
    };
    this._assertDepsLocal(deps, `dep of '${id}'`);
    this._assertAvailableId(id);
    this._entries.set(n, entry);
    setNodeOwner(n, this);
    this._byId.set(id, n);
    if (acquired !== void 0) acquired.registered = true;
    setNodeTopologyDepsChangedObserver(n, emitRegisteredDepsChanged);
    const seqMatch = /#(\d+)$/.exec(id);
    if (seqMatch) this._seq = Math.max(this._seq, Number(seqMatch[1]) + 1);
    this._emitTopologyNodeRegistered(n);
    return n;
  }
  _assertDepsLocal(deps, label) {
    for (const dep of deps) assertGraphLocalNode(this, dep, label);
  }
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
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
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
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
    let internalSubscriberCounts;
    for (const { node, entry } of entries) {
      if (!isNodeRuntimeQuiescentForRelease(node)) {
        throw new Error(
          `graph: cannot release node group; '${entry.id}' is not runtime-quiescent (D124)`
        );
      }
      if (internalSubscriberCounts === void 0 && entries.length > 1) {
        internalSubscriberCounts = /* @__PURE__ */ new Map();
        for (const { node: dependent } of entries) {
          if (!isNodeActiveForRelease(dependent)) continue;
          for (const dep of dependent.deps) {
            if (dep !== dependent && releaseSet.has(dep)) {
              internalSubscriberCounts.set(dep, (internalSubscriberCounts.get(dep) ?? 0) + 1);
            }
          }
        }
      }
      const internalSubscribers = internalSubscriberCounts?.get(node) ?? 0;
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
    let releaseFailed = false;
    for (const { node } of entries) {
      try {
        releaseRuntimeOfNode(node);
      } catch (error) {
        if (!releaseFailed) releaseError = error;
        releaseFailed = true;
      }
    }
    if (!releaseFailed) {
      const constructions = graphRegistrations.get(this).existingConstructions;
      for (const [name, owner] of constructions ?? []) {
        if (owner.nodes.every(
          (node) => isNodeRuntimeReleased(node) && !runtimeReleaseFailuresOfNode(node)
        ))
          constructions.delete(name);
      }
    }
    for (const event of releasedEvents) this._emitTopologyNodeReleased(event);
    if (releaseFailed) throw releaseError;
  }
  // ── 8 verbs (core: node/state/batch + sugar: producer/derived/effect/mount) ──
  /** ctx-level power surface: a raw `(ctx)=>void` fn (or a passthrough/state when null). */
  node(deps = [], fn = null, opts = {}) {
    this._assertDepsLocal(deps, `dep of '${opts.name ?? "node"}'`);
    return this._createRegistered(
      opts.factory ?? "node",
      deps,
      opts,
      (nodeOpts) => new Node(deps, fn, nodeOpts)
    );
  }
  /** A manual source with `.set(v)` (L4-Q1). */
  state(initial, opts = {}) {
    return this._createRegistered(
      "state",
      [],
      { ...opts, initial },
      (nodeOpts) => new StateNode([], null, nodeOpts)
    );
  }
  /** ctx-level depless source; its fn runs on activation (R-rom-ram). */
  producer(fn, opts = {}) {
    return this._createRegistered(
      "producer",
      [],
      opts,
      (nodeOpts) => new Node([], fn, nodeOpts)
    );
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
    return this._createRegistered(
      "derived",
      deps,
      opts,
      (nodeOpts) => new Node([...deps], ctxFn, nodeOpts)
    );
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
    return this._createRegistered(
      "effect",
      deps,
      opts,
      (nodeOpts) => new Node([...deps], ctxFn, nodeOpts)
    );
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
    return this._createRegistered(
      op.factory,
      erased,
      entryOpts,
      (nodeOpts, acquired) => initNodeWithCore(this._core, op, erased, nodeOpts, acquired)
    );
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
    const snap = this._describe(_prefix);
    return opts.explain ? explainSubset(snap, opts.explain) : snap;
  }
  /** B1: share discovery order; only materialization is local. Mount reads stay unchanged. */
  _describe(_prefix, incoming) {
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
      if (incoming === void 0) {
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
      }
      if (incoming === void 0 || incoming.has(entry.node)) {
        for (const from of liveIds) edges.push({ from, to: id });
      }
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
      if (incoming === void 0) {
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
    return snap;
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
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: accessed through the checked internal runtime host.
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
var nativeDescribe = Graph.prototype.describe;
var GraphRegistration = class {
  constructor(graph) {
    this.graph = graph;
    this.host = graph;
  }
  graph;
  host;
  owners;
  get existingConstructions() {
    return this.owners;
  }
  get constructions() {
    if (this.owners === void 0) this.owners = /* @__PURE__ */ new Map();
    return this.owners;
  }
  assertRegisteredNode(node, label) {
    this.host._assertRegisteredNode(node, label);
  }
  readIncoming(nodes) {
    const describe = this.graph.describe;
    return describe === nativeDescribe ? this.host._describe("", nodes) : Reflect.apply(describe, this.graph, []);
  }
  releaseNodes(nodes, opts) {
    this.host._releaseNodes(nodes, opts);
  }
  assertAvailableName(name) {
    if (this.host._byId.has(name) || this.host._retiredIds.has(name))
      throw new Error(`construction: live or retired node name ${name}`);
  }
  createOwned(deps, fn, opts, acquired) {
    for (const dep of deps) this.host._assertRegisteredNode(dep, "construction node dependency");
    return this.host._createRegistered(
      opts.factory ?? "node",
      deps,
      opts,
      (nodeOpts) => new Node([...deps], fn, nodeOpts),
      acquired.name,
      acquired
    );
  }
  stateNode(id, opts = {}) {
    return this.host._createRegistered(
      "state",
      [],
      opts,
      (nodeOpts) => new StateNode([], null, nodeOpts),
      id
    );
  }
  node(id, factory, deps, fn, opts = {}) {
    return this.host._createRegistered(
      factory,
      deps,
      opts,
      (nodeOpts) => new Node([...deps], fn, nodeOpts),
      id
    );
  }
};
function emitRegisteredDepsChanged(node, prev, deps) {
  const graph = nodeOwner(node);
  if (graph !== void 0)
    graph._emitTopologyDepsChanged(node, prev, deps);
}

// scripts/fixtures/spending-numeric-oracle.ts
function bits(x) {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleBE(x);
  return buffer.readBigUInt64BE();
}
function number2(x) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(x);
  return buffer.readDoubleBE();
}
function unitsFromBits(b) {
  const exponent = b >> 52n & 2047n, mantissa = b & 0xfffffffffffffn;
  return exponent === 0n ? mantissa : (mantissa | 0x10000000000000n) << exponent - 1n;
}
var units = (x) => unitsFromBits(bits(x));
var unitDenominator = 1n << 1074n;
function referenceRound(numerator, denominator, squareRoot) {
  if (numerator === 0n) return 0;
  const compare = (u, divisor = 1n) => squareRoot ? u * u * denominator - numerator * (unitDenominator * divisor) ** 2n : u * denominator - numerator * unitDenominator * divisor;
  let lo = 0n, hi = 0x7fefffffffffffffn;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (compare(unitsFromBits(mid)) <= 0n) lo = mid;
    else hi = mid - 1n;
  }
  const lower = unitsFromBits(lo);
  if (compare(lower) === 0n) return number2(lo);
  const midpointComparison = compare(lower + unitsFromBits(lo + 1n), 2n);
  return number2(
    midpointComparison < 0n || midpointComparison === 0n && lo % 2n === 1n ? lo + 1n : lo
  );
}
function referenceNumbers(amounts, dailyAverage) {
  const xs = amounts.map(units), count = xs.length, n = BigInt(count);
  let total = 0n, pairs = 0n;
  for (let i = 0; i < count; i++) {
    total += xs[i];
    for (let j = 0; j < i; j++) pairs += (xs[i] - xs[j]) ** 2n;
  }
  const delta = n * xs[count - 1] - total;
  const z = pairs === 0n ? 0 : referenceRound(delta ** 2n * (n - 1n), n * pairs, true);
  return {
    mean: referenceRound(total, n * unitDenominator, false),
    std: count < 2 ? 0 : referenceRound(pairs, n * (n - 1n) * unitDenominator ** 2n, true),
    zScore: z === 0 ? 0 : delta < 0n ? -z : z,
    dailyRatio: referenceRound(xs[count - 1], units(Math.max(dailyAverage, 1)), false),
    varianceNonzero: pairs !== 0n
  };
}
function referenceFixed(x, digits) {
  const negative = x < 0, magnitude = units(Math.abs(x)) * 10n ** BigInt(digits);
  let q = magnitude / unitDenominator;
  if (2n * (magnitude % unitDenominator) >= unitDenominator) q++;
  const text2 = q.toString().padStart(digits + 1, "0");
  return `${negative ? "-" : ""}${text2.slice(0, -digits)}.${text2.slice(-digits)}`;
}

// scripts/fixtures/spending-publication-oracle.ts
import { createHash as createHash2 } from "node:crypto";
function oracleEncoding(input, maxBytes = 1048576) {
  let remaining = maxBytes, immutable = true;
  const active2 = /* @__PURE__ */ new Set();
  function charge(text2) {
    remaining -= Buffer.byteLength(text2);
    if (remaining < 0) throw Error("frame bound");
    return text2;
  }
  function string(value) {
    if (value.length > remaining) throw Error("frame bound");
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c >= 55296 && c <= 56319) {
        const next = value.charCodeAt(++i);
        if (!(next >= 56320 && next <= 57343)) throw Error("surrogate");
      } else if (c >= 56320 && c <= 57343) throw Error("surrogate");
    }
    return charge(JSON.stringify(value));
  }
  function encode(value) {
    if (value === null || typeof value === "boolean") return charge(JSON.stringify(value));
    if (typeof value === "number" && Number.isFinite(value)) return charge(JSON.stringify(value));
    if (typeof value === "string") return string(value);
    if (typeof value !== "object" || value === null || active2.has(value)) throw Error("passive");
    const array2 = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array2 ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      throw Error("prototype");
    if (array2 && value.length > remaining / 2) throw Error("array bound");
    const keys3 = Reflect.ownKeys(value);
    if (keys3.length > remaining / 2 || keys3.some((k) => typeof k !== "string")) throw Error("keys");
    const names = keys3.filter((k) => !array2 || k !== "length");
    if (array2 && (names.length !== value.length || names.some((k, i) => k !== String(i))))
      throw Error("array");
    active2.add(value);
    immutable &&= Object.isFrozen(value);
    const encoded = [charge(array2 ? "[" : "{")];
    let first2 = true;
    for (const key of array2 ? names : names.sort()) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!("value" in d) || !d.enumerable) throw Error("descriptor");
      if (!first2) encoded.push(charge(","));
      first2 = false;
      if (!array2) encoded.push(string(key), charge(":"));
      encoded.push(encode(d.value));
    }
    encoded.push(charge(array2 ? "]" : "}"));
    active2.delete(value);
    return encoded.join("");
  }
  return {
    text: encode(input),
    get immutable() {
      return immutable;
    }
  };
}
function oracleCanonical(input, maxBytes = 1048576) {
  return oracleEncoding(input, maxBytes).text;
}
var oracleHash = (s) => `sha256:${createHash2("sha256").update(s).digest("hex")}`;
function oracleFreeze(v) {
  if (v !== null && typeof v === "object") {
    Object.values(v).forEach(oracleFreeze);
    Object.freeze(v);
  }
  return v;
}
function oracleMaterial(body) {
  const requestRef = {
    kind: "spending-alerts/request-material/v1",
    id: oracleHash(oracleCanonical(body))
  };
  return oracleFreeze({
    body,
    requestRef,
    proposalDigest: oracleHash(
      oracleCanonical({
        schema: "spending-alerts/effect-proposal/v1",
        occurrence: body.occurrence,
        effectId: body.effectId,
        requestRef
      })
    )
  });
}

// scripts/fixtures/spending-preset-oracle.ts
function oracleBusiness(e) {
  const { mean, std, zScore, dailyRatio } = referenceNumbers(
    e.prefix.map((t) => t.amount),
    e.profile.dailyAverage
  );
  const txn = e.prefix[e.prefix.length - 1];
  const known = e.profile.typicalCategories.indexOf(txn.category) !== -1;
  const flags = [zScore > e.policy.zThreshold, dailyRatio > e.policy.dailyRatioThreshold, !known], flagged = flags.some(Boolean);
  const factors = [
    `Amount is ${referenceFixed(zScore, 2)}\u03C3 above this vendor's historical mean.`,
    `Amount is ${referenceFixed(dailyRatio, 1)}\xD7 the user's daily average.`,
    "Category is outside the user's typical spend profile."
  ].filter((_, i) => flags[i]);
  const severity = factors.length > 2 ? "high" : factors.length === 2 ? "medium" : "low";
  const message = flagged ? [
    `Transaction ${txn.id} flagged \u2014 severity: ${severity}.`,
    `Vendor: ${txn.vendor}  Amount: $${referenceFixed(txn.amount, 2)}  Category: ${txn.category}`,
    "Reasoning:",
    ...factors.map((f) => `  \u2022 ${f}`)
  ].join("\n") : `Transaction ${txn.id} ($${referenceFixed(txn.amount, 2)} at ${txn.vendor}) \u2014 normal.`;
  return oracleFreeze({ mean, std, zScore, dailyRatio, flagged, factors, severity, message, txn });
}
function oracleRequest(e, b) {
  const result = oracleBusiness(e);
  if (!result.flagged) return void 0;
  const payloadText = oracleCanonical({
    transactionId: result.txn.id,
    vendor: result.txn.vendor,
    severity: result.severity,
    message: result.message
  });
  return oracleMaterial({
    schema: "spending-alerts/request-material/v1",
    occurrence: e.occurrence,
    effectId: `alert:${e.evaluationRef}`,
    inputDigest: e.inputDigest,
    policyDigest: e.policyDigest,
    payloadText,
    payloadDigest: oracleHash(payloadText),
    sourceDigest: b.sourceDigest,
    runtimeDigest: b.runtimeDigest,
    destinationRef: b.destinationRef,
    compositionEpoch: b.compositionEpoch,
    hostEpoch: b.hostEpoch
  });
}

// scripts/fixtures/spending-preset-harness.ts
var fixtureHash = oracleHash(
  "explicit offline fixture; not a loaded-source or host attestation"
);
var presetBinding = oracleFreeze({
  packRef: { kind: "offline-pack", id: "preset" },
  sourceDigest: fixtureHash,
  runtimeDigest: fixtureHash,
  destinationRef: { kind: "offline-inbox", id: "no-host" },
  compositionEpoch: 1,
  hostEpoch: 1,
  runRef: "preset-fixture",
  evidenceMode: "fixture-observations"
});
function evaluationFixture(index = 0, vendor = "coffee", prefixLength = 2, flagged = true) {
  const id = `evaluation-${vendor}-${index}`, prefix = Array.from({ length: prefixLength }, (_, i) => ({
    id: `${id}:tx${i}`,
    vendor,
    category: "coffee",
    amount: 100 + i * 40,
    timestampIso: "2026-09-09T00:00:00.000Z"
  }));
  const policy2 = { zThreshold: flagged ? 0.5 : 100, dailyRatioThreshold: 100 }, profile3 = { dailyAverage: 100, typicalCategories: ["coffee"] }, profileRef = { kind: "profile", id: "base" }, policyRef = { kind: "policy", id: flagged ? "alert" : "normal" };
  const value = {
    evaluationRef: id,
    subjectRef: id,
    inputDigest: oracleHash(oracleCanonical({ profileRef, profile: profile3, prefix })),
    profileRef,
    profile: profile3,
    policyRef,
    policyDigest: oracleHash(oracleCanonical(policy2)),
    policy: policy2,
    prefix
  };
  const ref3 = {
    revisionDomain: `fixture-${vendor}`,
    occurrenceId: id,
    revision: index + 1,
    sourceRefs: [{ kind: "evaluation", id }]
  };
  const digest3 = oracleHash(
    oracleCanonical({
      schemaRevision: "graphrefly/causal-occurrence-contract/v1@contract-v2",
      ...ref3,
      value
    })
  );
  return oracleFreeze({ ...value, occurrence: { ...ref3, digest: digest3 } });
}
function evaluationPack(evaluations2, binding2 = presetBinding) {
  return oracleFreeze({ format: "spending-input-v1", binding: binding2, evaluations: evaluations2 });
}
function policyFacts(e, binding2 = presetBinding) {
  const request = oracleRequest(e, binding2), requestDigest = request?.body.payloadDigest ?? oracleHash(oracleCanonical({ kind: "no-publish", evaluationRef: e.evaluationRef }));
  const artifactDigest = oracleHash(
    oracleCanonical({
      verifierRevision: "spending-oracle-v2",
      evaluation: e,
      binding: binding2,
      result: oracleBusiness(e)
    })
  );
  const current = {
    binding: binding2,
    current: [
      {
        revisionDomain: e.occurrence.revisionDomain,
        occurrence: e.occurrence,
        policyRef: e.policyRef,
        policyDigest: e.policyDigest,
        watermark: e.occurrence.revision
      }
    ]
  };
  const verification = {
    binding: binding2,
    receipts: [
      {
        receiptRef: { kind: "fixture-verification", id: artifactDigest },
        issuerRef: { kind: "fixture", id: "independent-pairwise-oracle" },
        verifierRevision: "spending-oracle-v2",
        occurrence: e.occurrence,
        inputDigest: e.inputDigest,
        policyDigest: e.policyDigest,
        sourceDigest: binding2.sourceDigest,
        runtimeDigest: binding2.runtimeDigest,
        requestDigest,
        numericDomainRef: "spending-finite-v1",
        verdict: "pass",
        artifactRef: { kind: "fixture-artifact", id: artifactDigest },
        artifactDigest
      }
    ]
  };
  const local = {
    binding: binding2,
    tick: 1,
    stop: false,
    grants: [
      {
        grantRef: { kind: "fixture-grant", id: e.evaluationRef },
        ownerRef: { kind: "fixture-owner", id: "offline" },
        operation: "append-alert",
        occurrence: e.occurrence,
        requestDigest,
        destinationRef: binding2.destinationRef,
        hostEpoch: binding2.hostEpoch,
        validFrom: 0,
        validThrough: 100,
        maxWrites: 64,
        replayScope: { compositionEpoch: binding2.compositionEpoch, hostEpoch: binding2.hostEpoch },
        revoked: false
      }
    ]
  };
  const inbox = {
    binding: binding2,
    issuerRef: { kind: "fixture", id: "passive-boundary" },
    artifactRef: { kind: "fixture-artifact", id: "no-io" },
    artifactDigest: fixtureHash,
    readiness: { ready: true, observedAt: 0, validThrough: 100, availableSlots: 1 },
    outcomes: []
  };
  return oracleFreeze({ current, verification, local, inbox, request });
}

// scripts/fixtures/spending-focused-host-harness.ts
async function drain2() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function inputsFor(graph) {
  const sources = {
    pack: graph.node([], null, { name: "pack" }),
    arrivals: graph.node([], null, { name: "arrivals" }),
    current: graph.node([], null, { name: "current" }),
    verification: graph.node([], null, { name: "verification" }),
    local: graph.node([], null, { name: "local" })
  };
  return {
    sources,
    inputs: {
      evaluations: { pack: sources.pack, arrivals: sources.arrivals, current: sources.current },
      verification: { receipts: sources.verification },
      localAuthority: { facts: sources.local }
    }
  };
}

// spending-host-call-local-worker.ts
var evaluations = Array.from({ length: 32 }, (_, i) => [evaluationFixture(i, "coffee"), evaluationFixture(i, "tea")]).flat();
var pack = evaluationPack(evaluations);
var facts = evaluations.map((e) => policyFacts(e));
var payloads = evaluations.map((e) => oracleRequest(e, presetBinding).body.payloadText + "\n");
var arrivals = evaluations.map((e) => ({ packRef: presetBinding.packRef, evaluationRefs: [e.evaluationRef] }));
async function sample(mode) {
  const graph = new Graph({ name: "spending-call-local" }), { sources, inputs } = inputsFor(graph), calls = [];
  const resource = new OfflineAlertResource(presetBinding, async (payload) => {
    calls.push(payload);
    return { bytesWritten: Buffer.byteLength(payload) };
  });
  const t0 = performance2.now();
  const host = composeOfflineSpending(graph, inputs, presetBinding, resource, { name: "spending", diagnostics: mode });
  const constructionMs = performance2.now() - t0;
  const stops = Object.values(host.consume.view).map((node) => node.subscribe(() => {
  }));
  const send = (lane2, value) => sources[lane2].down([["DATA", value]]);
  const rows = [];
  try {
    await drain2();
    send("pack", pack);
    for (let i = 0; i < 64; i++) {
      const f = facts[i];
      const t1 = performance2.now();
      batch(() => {
        send("current", f.current);
        send("verification", f.verification);
        send("local", f.local);
        send("arrivals", arrivals[i]);
      });
      const syncInputMs = performance2.now() - t1;
      assert.equal(calls.length, i + 1);
      assert.equal(calls[i], payloads[i]);
      const t2 = performance2.now();
      await drain2();
      const completionMs = performance2.now() - t2;
      const state = host.inspect();
      assert.equal(state.fault, void 0);
      assert.equal(state.records.length, i + 1);
      assert.ok(state.records.every((r) => r.outcome?.state === "succeeded"));
      rows.push({ frontier: i + 1, syncInputMs, completionMs, heapUsed: process.memoryUsage().heapUsed, rss: process.memoryUsage().rss, notifications: state.notifications, maxFrameBytes: state.maxFrameBytes });
    }
    const latest2 = facts.slice(-2);
    batch(() => {
      send("current", { ...latest2[0].current, current: latest2.flatMap((f) => f.current.current) });
      send("local", { ...latest2[0].local, stop: true, grants: latest2.flatMap((f) => f.local.grants) });
    });
    await drain2();
    const final = host.inspect();
    assert.equal(final.normalEndReady, true);
    assert.equal(final.writes, 64);
    assert.equal(final.inFlight, 0);
    return { constructionMs, rows, witness: { topology: graph.topology(), calls, records: final.records, normalEndReady: final.normalEndReady }, final: { writes: 64, records: 64, normalEndReady: true, notifications: final.notifications, maxFrameBytes: final.maxFrameBytes } };
  } finally {
    stops.forEach((stop) => stop());
    for (const r of host.owner.roots) r.unsubscribe?.();
    const group = graph.topologyGroup();
    for (const n of graph.describe().nodes) group.add(graph.find(n.id));
    group.release();
  }
}
export {
  sample
};
