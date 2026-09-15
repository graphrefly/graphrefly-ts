// scripts/fixtures/causal-coverage-profile.ts
import assert2 from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

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

// packages/ts/src/solutions/causal-occurrence/capabilities.ts
var issued = /* @__PURE__ */ new WeakMap();
function causalBinding(binding3) {
  if (binding3.contract !== "contract-v2" || binding3.implementationRevision !== "construction-v1" || binding3.scope !== "full" || !Number.isSafeInteger(binding3.epoch) || binding3.epoch < 1 || Object.keys(binding3).length !== 4)
    throw new TypeError("unsupported causal binding or lifecycle epoch");
  return Object.freeze({ ...binding3 });
}
function assertCausalCapabilities(graph, full, binding3) {
  const root = issued.get(full);
  if (root === void 0 || root.graph !== graph || root.level !== "full" || root.binding.contract !== binding3.contract || root.binding.implementationRevision !== binding3.implementationRevision || root.binding.scope !== binding3.scope || root.binding.epoch !== binding3.epoch)
    throw new TypeError("causal capability binding mismatch");
  for (const handle of [full.identity, full.execution, full.retained]) {
    const record = issued.get(handle);
    if (record === void 0 || record.instance !== root.instance || record.graph !== graph)
      throw new TypeError("causal capability lineage mismatch");
  }
  if (full.execution.identity !== full.identity || full.retained.execution !== full.execution)
    throw new TypeError("causal capability lower handle mismatch");
}
function createCausalCapabilities(graph, scope, name, ports, binding3) {
  const causalQuiescence = scope.node(
    [ports.quiescence],
    (ctx) => {
      for (const raw2 of depBatch(ctx, 0) ?? []) {
        const value2 = raw2;
        ctx.down([
          [
            "DATA",
            Object.freeze({
              kind: value2.kind,
              revisionDomain: value2.revisionDomain,
              evaluatedThroughRevision: value2.evaluatedThroughRevision,
              lifecycle: value2.lifecycle,
              pendingOccurrenceRefs: value2.pendingOccurrenceRefs,
              pendingEffectIds: value2.pendingEffectIds
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
    issued.set(handle, { graph, instance, binding: binding3, level });
  return full;
}

// packages/ts/src/json/codec.ts
var JS_MIN_NORMAL_NUMBER = 2 ** -1022;
function deepFreezeStrictJson(value2) {
  if (value2 !== null && typeof value2 === "object") {
    if (Array.isArray(value2)) {
      for (const item of value2) deepFreezeStrictJson(item);
    } else {
      for (const item of Object.values(value2)) deepFreezeStrictJson(item);
    }
    Object.freeze(value2);
  }
  return value2;
}
function assertStableJsonNumber(value2, path) {
  if (!Number.isFinite(value2)) {
    throw new TypeError(`stableJsonString: non-finite number at ${path}`);
  }
}
function assertStrictJsonNumber(value2, path) {
  assertStableJsonNumber(value2, path);
  if (Object.is(value2, -0)) {
    throw new TypeError(`stableJsonString: non-canonical number at ${path}`);
  }
  const abs = Math.abs(value2);
  if (abs > 0 && abs < JS_MIN_NORMAL_NUMBER) {
    throw new TypeError(`stableJsonString: subnormal number at ${path}`);
  }
  if (Number.isInteger(value2) && !Number.isSafeInteger(value2)) {
    throw new TypeError(`stableJsonString: integer outside safe range at ${path}`);
  }
}
function sortedJsonValue(value2, seen = /* @__PURE__ */ new Set(), path = "$", strictNumbers = false) {
  if (value2 === null) return null;
  if (typeof value2 === "string" || typeof value2 === "boolean") return value2;
  if (typeof value2 === "number") {
    if (strictNumbers) assertStrictJsonNumber(value2, path);
    else assertStableJsonNumber(value2, path);
    return value2;
  }
  if (typeof value2 !== "object") {
    throw new TypeError(`stableJsonString: value at ${path} is not JSON-encodable`);
  }
  if (seen.has(value2)) throw new TypeError(`stableJsonString: circular reference at ${path}`);
  const proto = Object.getPrototypeOf(value2);
  if (!Array.isArray(value2) && proto !== Object.prototype && proto !== null) {
    throw new TypeError(`stableJsonString: non-plain object at ${path}`);
  }
  seen.add(value2);
  try {
    if (Array.isArray(value2)) {
      if (Object.getOwnPropertySymbols(value2).length > 0) {
        throw new TypeError(`stableJsonString: symbol-keyed properties at ${path}`);
      }
      for (const key2 of Object.getOwnPropertyNames(value2)) {
        const isIndex = /^(0|[1-9]\d*)$/.test(key2) && Number.isSafeInteger(Number(key2)) && Number(key2) < value2.length;
        const descriptor = Object.getOwnPropertyDescriptor(value2, key2);
        if (descriptor !== void 0 && ("get" in descriptor || "set" in descriptor)) {
          throw new TypeError(`stableJsonString: accessor property at ${path}.${key2}`);
        }
        if (key2 !== "length" && !isIndex) {
          throw new TypeError(`stableJsonString: non-index array property at ${path}.${key2}`);
        }
        if (key2 !== "length" && descriptor !== void 0 && !descriptor.enumerable) {
          throw new TypeError(`stableJsonString: non-enumerable array property at ${path}.${key2}`);
        }
      }
      const out2 = [];
      for (let i = 0; i < value2.length; i += 1) {
        if (!(i in value2)) {
          throw new TypeError(`stableJsonString: sparse array hole at ${path}[${i}]`);
        }
        out2.push(sortedJsonValue(value2[i], seen, `${path}[${i}]`, strictNumbers));
      }
      return out2;
    }
    if (Object.getOwnPropertySymbols(value2).length > 0) {
      throw new TypeError(`stableJsonString: symbol-keyed properties at ${path}`);
    }
    for (const key2 of Object.getOwnPropertyNames(value2)) {
      const descriptor = Object.getOwnPropertyDescriptor(value2, key2);
      if (descriptor !== void 0 && ("get" in descriptor || "set" in descriptor)) {
        throw new TypeError(`stableJsonString: accessor property at ${path}.${key2}`);
      }
      if (descriptor !== void 0 && !descriptor.enumerable) {
        throw new TypeError(`stableJsonString: non-enumerable property at ${path}.${key2}`);
      }
    }
    const out = /* @__PURE__ */ Object.create(null);
    for (const key2 of Object.keys(value2).sort()) {
      out[key2] = sortedJsonValue(
        value2[key2],
        seen,
        `${path}.${key2}`,
        strictNumbers
      );
    }
    return out;
  } finally {
    seen.delete(value2);
  }
}
function stableJsonString(value2) {
  return JSON.stringify(sortedJsonValue(value2));
}
function strictStableJsonString(value2) {
  return JSON.stringify(cloneStrictJsonValue(value2));
}
function jsonCodecFor() {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return {
    encode(value2) {
      return encoder.encode(stableJsonString(value2));
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
function hasUnpairedSurrogate(value2) {
  for (let i = 0; i < value2.length; i += 1) {
    const code = value2.charCodeAt(i);
    if (code >= 55296 && code <= 56319) {
      const next = value2.charCodeAt(i + 1);
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
function assertNoUnpairedSurrogates(value2, seen = /* @__PURE__ */ new Set(), path = "$") {
  if (typeof value2 === "string") {
    if (hasUnpairedSurrogate(value2)) {
      throw new TypeError(`strictJsonCodec: unpaired surrogate at ${path}`);
    }
    return;
  }
  if (value2 === null || typeof value2 !== "object") return;
  if (seen.has(value2)) return;
  seen.add(value2);
  try {
    if (Array.isArray(value2)) {
      for (let i = 0; i < value2.length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value2, String(i));
        if (descriptor === void 0 || "get" in descriptor || "set" in descriptor) continue;
        assertNoUnpairedSurrogates(descriptor.value, seen, `${path}[${i}]`);
      }
      return;
    }
    for (const key2 of Object.keys(value2)) {
      if (hasUnpairedSurrogate(key2)) {
        throw new TypeError(`strictJsonCodec: unpaired surrogate at ${path}.${key2}`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value2, key2);
      if (descriptor === void 0 || "get" in descriptor || "set" in descriptor) continue;
      assertNoUnpairedSurrogates(descriptor.value, seen, `${path}.${key2}`);
    }
  } finally {
    seen.delete(value2);
  }
}
function strictJsonDataErrorsInner(value2, label, seen) {
  if (value2 === null || typeof value2 === "string" || typeof value2 === "boolean") {
    if (typeof value2 === "string" && hasUnpairedSurrogate(value2)) {
      return { errors: [`${label} must not contain unpaired surrogate strings`] };
    }
    return { errors: [], value: value2 };
  }
  if (typeof value2 === "number") {
    try {
      assertStrictJsonNumber(value2, label);
    } catch (error) {
      return { errors: [error instanceof Error ? error.message : String(error)] };
    }
    return { errors: [], value: value2 };
  }
  if (typeof value2 !== "object") {
    return { errors: [`${label} is not JSON-encodable`] };
  }
  if (seen.has(value2)) return { errors: [`${label} must not contain circular references`] };
  const proto = Object.getPrototypeOf(value2);
  if (!Array.isArray(value2) && proto !== Object.prototype && proto !== null) {
    return { errors: [`stableJsonString: non-plain object at ${label}`] };
  }
  seen.add(value2);
  try {
    if (Array.isArray(value2)) {
      const errors2 = [];
      if (Object.getOwnPropertySymbols(value2).length > 0) {
        errors2.push(`${label} must not carry symbol keys`);
      }
      for (const key2 of Object.getOwnPropertyNames(value2)) {
        const descriptor = Object.getOwnPropertyDescriptor(value2, key2);
        if (descriptor === void 0) continue;
        const isIndex = /^(0|[1-9]\d*)$/.test(key2) && Number.isSafeInteger(Number(key2)) && Number(key2) < value2.length;
        if ("get" in descriptor || "set" in descriptor) {
          errors2.push(`${label}.${key2} must be a data property`);
        }
        if (key2 !== "length" && !isIndex) {
          errors2.push(`${label}.${key2} must be an indexed data property`);
        }
        if (key2 !== "length" && isIndex && !descriptor.enumerable) {
          errors2.push(`${label}.${key2} must be enumerable`);
        }
      }
      const out2 = [];
      for (let index = 0; index < value2.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value2, String(index));
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
    if (Object.getOwnPropertySymbols(value2).length > 0) {
      errors.push(`${label} must not carry symbol keys`);
    }
    for (const key2 of Object.getOwnPropertyNames(value2)) {
      const descriptor = Object.getOwnPropertyDescriptor(value2, key2);
      if (descriptor === void 0) continue;
      if ("get" in descriptor || "set" in descriptor) {
        errors.push(`${label}.${key2} must be a data property`);
      }
      if (!descriptor.enumerable) {
        errors.push(`${label}.${key2} must be enumerable`);
      }
      if (hasUnpairedSurrogate(key2)) {
        errors.push(`${label}.${key2} must not contain unpaired surrogate keys`);
      }
    }
    const out = {};
    for (const key2 of Object.keys(value2).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value2, key2);
      if (descriptor === void 0 || "get" in descriptor || "set" in descriptor) continue;
      const nested = strictJsonDataErrorsInner(descriptor.value, `${label}.${key2}`, seen);
      errors.push(...nested.errors);
      if (nested.errors.length === 0 && nested.value !== void 0) {
        Object.defineProperty(out, key2, {
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
    seen.delete(value2);
  }
}
function cloneStrictJsonValue(value2, label = "strictJsonValue") {
  const result = strictJsonDataErrorsInner(value2, label, /* @__PURE__ */ new Set());
  if (result.errors.length > 0 || result.value === void 0) {
    throw new TypeError(`${label}: ${result.errors.join("; ")}`);
  }
  return deepFreezeStrictJson(result.value);
}
function cloneStrictJsonObject(value2, label = "strictJsonObject") {
  const cloned = cloneStrictJsonValue(value2, label);
  if (cloned === null || typeof cloned !== "object" || Array.isArray(cloned)) {
    throw new TypeError(`${label}: value must be a strict JSON object`);
  }
  return cloned;
}
function assertNoDuplicateJsonObjectKeys(text3) {
  let index = 0;
  function fail(message) {
    throw new TypeError(`strictJsonCodec: ${message}`);
  }
  function skipWhitespace() {
    while (/\s/.test(text3[index] ?? "")) index += 1;
  }
  function readJsonString() {
    const start = index;
    index += 1;
    while (index < text3.length) {
      const ch = text3[index];
      if (ch === '"') {
        index += 1;
        try {
          return JSON.parse(text3.slice(start, index));
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
  function consumeLiteral(literal2) {
    if (text3.slice(index, index + literal2.length) !== literal2) {
      fail(`malformed JSON near byte ${index}`);
    }
    index += literal2.length;
  }
  function consumeNumber() {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text3.slice(index));
    if (!match) fail(`malformed JSON number near byte ${index}`);
    index += match[0].length;
  }
  function parseValue(path) {
    skipWhitespace();
    const ch = text3[index];
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
    if (text3[index] === "}") {
      index += 1;
      return;
    }
    while (index < text3.length) {
      skipWhitespace();
      if (text3[index] !== '"') fail(`expected object key near byte ${index}`);
      const key2 = readJsonString();
      if (keys3.has(key2)) {
        throw new TypeError(
          `strictJsonCodec: duplicate object key ${JSON.stringify(key2)} at ${path}`
        );
      }
      keys3.add(key2);
      skipWhitespace();
      if (text3[index] !== ":") fail(`expected ':' after object key near byte ${index}`);
      index += 1;
      parseValue(`${path}.${key2}`);
      skipWhitespace();
      if (text3[index] === ",") {
        index += 1;
        continue;
      }
      if (text3[index] === "}") {
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
    if (text3[index] === "]") {
      index += 1;
      return;
    }
    let item = 0;
    while (index < text3.length) {
      parseValue(`${path}[${item}]`);
      item += 1;
      skipWhitespace();
      if (text3[index] === ",") {
        index += 1;
        continue;
      }
      if (text3[index] === "]") {
        index += 1;
        return;
      }
      fail(`expected ',' or ']' near byte ${index}`);
    }
    fail("unterminated JSON array");
  }
  parseValue("$");
  skipWhitespace();
  if (index !== text3.length) fail(`trailing JSON token near byte ${index}`);
}
function strictJsonCodecFor() {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return {
    encode(value2) {
      assertNoUnpairedSurrogates(value2);
      return encoder.encode(strictStableJsonString(value2));
    },
    decode(bytes) {
      const text3 = decoder.decode(bytes);
      assertNoDuplicateJsonObjectKeys(text3);
      const decoded = JSON.parse(text3);
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
function strictCanonicalJsonBytes(value2) {
  return strictJsonCodec.encode(value2);
}
function assertStrictJsonObject(value2, label = "strictJsonObject") {
  return cloneStrictJsonObject(value2, label);
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
function computeV1Cid(policy3, value2) {
  return policy3.hash(strictCanonicalJsonBytes(value2));
}
function assertNodeVersionDataCompatible(policy3, value2) {
  if (!policy3.enabled || policy3.level === 0) return;
  strictCanonicalJsonBytes(value2);
}
function snapshotNodeVersionData(policy3, value2) {
  if (!policy3.enabled || policy3.level === 0) return value2;
  const bytes = strictCanonicalJsonBytes(value2);
  return strictJsonCodec.decode(bytes);
}
function resolveNodeVersioningPolicy(policy3) {
  if (policy3 === false) return { enabled: false };
  if (policy3 === void 0 || policy3 === 0) return { enabled: true, level: 0 };
  if (policy3 === 1) return { enabled: true, level: 1, hash: defaultNodeVersionHash };
  if (typeof policy3 === "object" && policy3 !== null) {
    if (policy3.level === 0) return { enabled: true, level: 0 };
    if (policy3.level === 1) {
      return { enabled: true, level: 1, hash: policy3.hash ?? defaultNodeVersionHash };
    }
  }
  throw new Error("node: versioning level must be 0 or 1; V2/V3 are not locked yet (D109)");
}
function createNodeVersion(policy3, initialValue = ABSENT_V1_SEED) {
  if (!policy3.enabled) return void 0;
  if (policy3.level === 0) return Object.freeze({ level: 0, counter: 0 });
  return Object.freeze({
    level: 1,
    counter: 0,
    cid: computeV1Cid(policy3, initialValue),
    prev: null
  });
}
function advanceNodeVersion(current2, policy3, value2) {
  if (!policy3.enabled) return void 0;
  if (current2 === void 0) return createNodeVersion(policy3, value2);
  if (policy3.level === 0) {
    return Object.freeze({ level: 0, counter: current2.counter + 1 });
  }
  const previous = current2.level === 1 ? current2.cid : null;
  return Object.freeze({
    level: 1,
    counter: current2.counter + 1,
    cid: computeV1Cid(policy3, value2),
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

// packages/ts/src/node/node-runtime-host.ts
function nodeRuntimeHost(node) {
  return node;
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
      const key2 = dispatcherHandleStatKey(handle);
      const s = this._stats.get(key2) ?? {
        invokes: 0,
        totalDurationNs: 0,
        lastDurationNs: 0
      };
      s.invokes++;
      s.lastDurationNs = dur;
      s.totalDurationNs += dur;
      this._stats.set(key2, s);
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
    const value2 = this.values[id];
    if (value2 === void 0) throw new Error("NodeCore: unknown node value state");
    return value2;
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
  let sorted2 = [...msgs].sort((a, b) => messageTier(a[0]) - messageTier(b[0]));
  const firstInvalidate = sorted2.findIndex((m) => m[0] === "INVALIDATE");
  if (firstInvalidate !== -1) {
    sorted2 = sorted2.filter((m, i) => m[0] !== "INVALIDATE" || i === firstInvalidate);
  }
  const hasTeardown = sorted2.some((m) => m[0] === "TEARDOWN");
  const hasTerminal = sorted2.some((m) => m[0] === "COMPLETE" || m[0] === "ERROR");
  if (hasTeardown && !hasTerminal && self._value.terminal === void 0 && !self._value.hasTorndown) {
    sorted2 = [["COMPLETE"], ...sorted2];
  }
  if (!self._wave.insideRunWave && currentBatch()) {
    const deferred = snapshotVersionData(sorted2.filter((m) => isDeferredTier(m[0])));
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
    const buffered = snapshotVersionData(sorted2.filter((m) => isPauseBufferedTier(m[0])));
    if (buffered.length > 0) {
      self._wave.emittedSettleThisWave = true;
      self._control.pauseBuffer.push(buffered);
    }
    sorted2 = sorted2.filter((m) => !isPauseBufferedTier(m[0]));
    if (sorted2.length === 0) return;
  }
  let dataCount = 0;
  let hasTier3 = false;
  let hasResolved = false;
  for (const m of sorted2) {
    if (m[0] === "DATA") dataCount++;
    if (m[0] === "RESOLVED") hasResolved = true;
    if (isValueTier(m[0])) hasTier3 = true;
  }
  if (dataCount >= 1 && hasResolved) {
    throw new Error(
      "down: a wave cannot mix DATA and RESOLVED (tier-3 exclusivity, R-resolved-undirty)"
    );
  }
  const plannedVersions = new Array(sorted2.length);
  if (dataCount > 0) {
    let plannedVersion = self._version.value;
    for (let i = 0; i < sorted2.length; i++) {
      const m = sorted2[i];
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
  for (let i = 0; i < sorted2.length; i++) {
    const m = sorted2[i];
    const delivery = { wave: deliveryWave, last: i === sorted2.length - 1 };
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
      const value2 = {
        cache: SENTINEL,
        hasData: false,
        status: "sentinel",
        terminal: void 0,
        hasTorndown: false,
        replayRing: []
      };
      if (opts.initial !== void 0) {
        value2.cache = opts.initial;
        value2.hasData = true;
        value2.status = "settled";
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
          value: value2,
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
function toCheckpointJson(value2, path = "$") {
  try {
    return strictJsonCodec.decode(strictJsonCodec.encode(value2));
  } catch (cause) {
    throw new TypeError(`checkpoint: value at ${path} is not strict JSON compatible`, {
      cause
    });
  }
}
function checkpointValue(value2, hasData, path) {
  if (!hasData || value2 === SENTINEL) return { kind: "SENTINEL" };
  return { kind: "DATA", data: toCheckpointJson(value2, path) };
}
function checkpointTerminal(value2, path) {
  if (value2 === void 0) return { kind: "none" };
  if (value2 === true) return { kind: "COMPLETE" };
  return { kind: "ERROR", error: toCheckpointJson(value2, path) };
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

// packages/ts/src/solutions/causal-occurrence/committed-view.ts
function prepareCommittedEffectsView(state, changed, hasFacts, authorityId, binding3) {
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
    binding: binding3,
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
function dataKey(value2) {
  return stableJsonString(value2);
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
function rotateRight(value2, count) {
  return value2 >>> count | value2 << 32 - count;
}
function sha256(value2) {
  const input = new TextEncoder().encode(value2);
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
function causalOccurrenceDigest(value2) {
  return sha256(
    dataKey({
      schemaRevision: CAUSAL_OCCURRENCE_SCHEMA_REVISION,
      revisionDomain: value2.revisionDomain,
      occurrenceId: value2.occurrenceId,
      revision: value2.revision,
      value: value2.value,
      sourceRefs: value2.sourceRefs
    })
  );
}
function canonicalSnapshot(value2) {
  const freeze3 = (item) => {
    if (item === null || typeof item !== "object") return item;
    if (Array.isArray(item)) return Object.freeze(item.map(freeze3));
    return Object.freeze(
      Object.fromEntries(Object.entries(item).map(([key2, child]) => [key2, freeze3(child)]))
    );
  };
  return freeze3(JSON.parse(dataKey(value2)));
}
function canonicalEntry(value2) {
  try {
    return Object.freeze({ key: dataKey(value2), snapshot: canonicalSnapshot(value2) });
  } catch {
    return void 0;
  }
}
function refKey(value2) {
  return canonicalTupleKey([
    value2.revisionDomain,
    String(value2.revision),
    value2.occurrenceId,
    value2.digest,
    dataKey(value2.sourceRefs)
  ]);
}
function occurrenceIdKey(value2) {
  return canonicalTupleKey([value2.revisionDomain, value2.occurrenceId]);
}
function revisionKey(domain, revision) {
  return canonicalTupleKey([domain, String(revision)]);
}
function effectKey(value2) {
  return canonicalTupleKey([refKey(value2.occurrence), value2.effectId]);
}
function validToken(value2) {
  return typeof value2 === "string" && value2.length > 0;
}
function validSourceRef(value2) {
  return value2 !== null && typeof value2 === "object" && "kind" in value2 && validToken(value2.kind) && "id" in value2 && validToken(value2.id);
}
function validRef(value2) {
  return value2 !== null && typeof value2 === "object" && "revisionDomain" in value2 && validToken(value2.revisionDomain) && "occurrenceId" in value2 && validToken(value2.occurrenceId) && "revision" in value2 && Number.isSafeInteger(value2.revision) && value2.revision > 0 && "digest" in value2 && typeof value2.digest === "string" && digestPattern.test(value2.digest) && "sourceRefs" in value2 && Array.isArray(value2.sourceRefs) && value2.sourceRefs.length > 0 && value2.sourceRefs.every(validSourceRef) && new Set(value2.sourceRefs.map((ref4) => canonicalTupleKey([ref4.kind, ref4.id]))).size === value2.sourceRefs.length;
}
function validAdmissionState(value2) {
  return value2 === "admitted" || value2 === "rejected";
}
function validOutcomeState(value2) {
  return value2 === "succeeded" || value2 === "failed" || value2 === "cancelled" || value2 === "reconcile-required" || value2 === "unknown";
}
function validTerminal(value2) {
  return (value2.state === "completed" || value2.state === "failed" || value2.state === "skipped") && validResult(value2.result) && value2.state === "completed" === (value2.result.kind === "ok");
}
function sameRef(left, right) {
  return refKey(left) === refKey(right) && left.digest === right.digest && dataKey(left.sourceRefs) === dataKey(right.sourceRefs);
}
function validResult(value2) {
  if (value2 === null || typeof value2 !== "object") return false;
  if (value2.kind === "ok") return Object.hasOwn(value2, "value");
  return value2.kind === "error" && value2.error?.kind === "issue" && validToken(value2.error.code) && validToken(value2.error.message);
}
function pushIssue(outputs, value2) {
  outputs.push({ kind: "issue", value: value2 });
}
var retainPending = (opts, outputs, map3, key2, value2, label) => {
  const prior = map3.get(key2);
  if (prior !== void 0) {
    if (dataKey(prior) !== dataKey(value2))
      pushIssue(
        outputs,
        issue(
          `causal-occurrence/${label}-conflict`,
          `Pending ${label} replay conflicts with retained DATA.`,
          [key2]
        )
      );
    return;
  }
  if (map3.size >= opts.maxPending) {
    pushIssue(
      outputs,
      issue(
        `causal-occurrence/${label}-pending-bound`,
        `Pending ${label} exceeded bounded retention.`,
        [key2]
      )
    );
    return;
  }
  map3.set(key2, value2);
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
function findOccurrence(context, ref4) {
  const { state } = context;
  return state.byRevision.get(revisionKey(ref4.revisionDomain, ref4.revision))?.value;
}
function exactOccurrence(context, ref4) {
  const retained = findOccurrence(context, ref4);
  return retained !== void 0 && sameRef(retained, ref4) ? retained : void 0;
}
function rejectDefinitiveMissingRef(context, ref4, label) {
  const { state, outputs } = context;
  const retained = findOccurrence(context, ref4);
  const floor = state.retentionFloorByDomain.get(ref4.revisionDomain) ?? 0;
  const highWater = state.highWaterByDomain.get(ref4.revisionDomain) ?? 0;
  if (retained !== void 0 && !sameRef(retained, ref4)) {
    pushIssue(
      outputs,
      issue(
        `causal-occurrence/${label}-occurrence-conflict`,
        `${label} references a conflicting occurrence revision.`,
        [refKey(ref4)]
      )
    );
    return true;
  }
  if (ref4.revision <= floor || ref4.revision <= highWater && retained === void 0) {
    pushIssue(
      outputs,
      issue(
        ref4.revision <= floor ? `causal-occurrence/${label}-retention-gap` : `causal-occurrence/${label}-stale`,
        `${label} references a revision that cannot regain authority.`,
        [refKey(ref4)]
      )
    );
    return true;
  }
  return false;
}
function maybeRelease(context, occurrence4) {
  const { state, outputs } = context;
  const key2 = refKey(occurrence4);
  const admission = state.admissions.get(key2);
  const currentness = state.currentness.get(key2);
  if (admission?.state !== "admitted" || !sameRef(admission.occurrence, occurrence4) || currentness?.state !== "current" || state.released.has(key2) || currentness.evaluatedThroughRevision < occurrence4.revision)
    return;
  state.released.add(key2);
  outputs.push({ kind: "release", value: occurrence4 });
}
function exactAdmission(context, occurrence4) {
  const { state } = context;
  const admission = state.admissions.get(refKey(occurrence4));
  return admission !== void 0 && sameRef(admission.occurrence, occurrence4) ? admission : void 0;
}
function currentnessMetadata(value2, occurrence4) {
  if (value2 === null || typeof value2 !== "object" || Object.getPrototypeOf(value2) !== Object.prototype)
    return;
  const keys3 = Reflect.ownKeys(value2);
  if (keys3.length !== 4 || !keys3.every(
    (key2) => key2 === "kind" || key2 === "occurrence" || key2 === "evaluatedThroughRevision" || key2 === "state"
  ))
    return;
  const fields2 = Object.getOwnPropertyDescriptors(value2);
  for (const key2 of keys3) {
    const field = fields2[key2];
    if (field === void 0 || !("value" in field) || !field.enumerable) return;
  }
  if (fields2.kind.value !== "causal-currentness" || fields2.occurrence.value !== occurrence4 || typeof fields2.evaluatedThroughRevision.value !== "number" || !Number.isSafeInteger(fields2.evaluatedThroughRevision.value) || fields2.evaluatedThroughRevision.value < 0 || fields2.state.value !== "current" && fields2.state.value !== "stale")
    return;
  return {
    kind: fields2.kind.value,
    occurrence: null,
    evaluatedThroughRevision: fields2.evaluatedThroughRevision.value,
    state: fields2.state.value
  };
}
function currentnessChanged(prior, value2, occurrence4) {
  if (Object.isFrozen(occurrence4)) {
    const before = currentnessMetadata(prior, occurrence4);
    const after = currentnessMetadata(value2, occurrence4);
    if (before !== void 0 && after !== void 0) return dataKey(before) !== dataKey(after);
  }
  return dataKey(prior) !== dataKey(value2);
}
function recomputeCurrentness(context, revisionDomain) {
  const { state, outputs } = context;
  const watermark = state.watermarks.get(revisionDomain);
  if (watermark === void 0) return;
  const floor = state.retentionFloorByDomain.get(revisionDomain) ?? 0;
  const occurrences = [...state.byRevision.values()].map((entry) => entry.value).filter((value2) => value2.revisionDomain === revisionDomain && value2.revision <= watermark).sort((left, right) => left.revision - right.revision);
  const sequenceComplete = (state.highWaterByDomain.get(revisionDomain) ?? 0) >= watermark && (state.retentionGapThroughByDomain.get(revisionDomain) ?? 0) === 0 && ![...state.pending.values()].some(
    (entry) => entry.value.revisionDomain === revisionDomain && entry.value.revision <= watermark
  ) && occurrences.filter((occurrence4) => occurrence4.revision > floor).every((occurrence4) => exactAdmission(context, occurrence4) !== void 0);
  const latestAdmitted = /* @__PURE__ */ new Map();
  for (const occurrence4 of occurrences) {
    if (exactAdmission(context, occurrence4)?.state === "admitted")
      latestAdmitted.set(occurrenceIdKey(occurrence4), occurrence4);
  }
  for (const occurrence4 of occurrences) {
    const admission = exactAdmission(context, occurrence4);
    const newer = latestAdmitted.get(occurrenceIdKey(occurrence4));
    const value2 = admission === void 0 || !sequenceComplete ? {
      kind: "causal-currentness",
      occurrence: occurrence4,
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
      occurrence: occurrence4,
      evaluatedThroughRevision: watermark,
      state: "stale"
    } : newer !== void 0 && newer !== occurrence4 ? {
      kind: "causal-currentness",
      occurrence: occurrence4,
      evaluatedThroughRevision: watermark,
      state: "superseded",
      supersededBy: newer
    } : {
      kind: "causal-currentness",
      occurrence: occurrence4,
      evaluatedThroughRevision: watermark,
      state: "current"
    };
    const key2 = refKey(occurrence4);
    const prior = state.currentness.get(key2);
    state.currentness.set(key2, value2);
    if (prior === void 0 || currentnessChanged(prior, value2, occurrence4))
      outputs.push({ kind: "currentness", value: value2 });
    maybeRelease(context, occurrence4);
  }
  return { watermark, occurrences, sequenceComplete, latestAdmitted };
}
function flushAdmissions(context) {
  const { state, outputs } = context;
  for (const [key2, admission] of state.admissions) {
    const retained = findOccurrence(context, admission.occurrence);
    if (retained !== void 0 && !sameRef(retained, admission.occurrence)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/admission-mismatch",
          "Deferred admission conflicts with the retained occurrence revision.",
          [key2]
        )
      );
      state.admissions.delete(key2);
    }
    if (retained === void 0 && rejectDefinitiveMissingRef(context, admission.occurrence, "admission"))
      state.admissions.delete(key2);
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
    const key2 = refKey(admission.occurrence);
    const prior = state.admissions.get(key2);
    if (prior !== void 0) {
      if (dataKey(prior) !== canonical.key)
        pushIssue(
          outputs,
          issue(
            "causal-occurrence/admission-conflict",
            "Admission replay conflicts with retained decision.",
            [key2]
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
          [key2]
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
          [key2]
        )
      );
      continue;
    }
    state.admissions.set(key2, canonical.snapshot);
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
function emitCoverage(context, occurrence4) {
  const { state, opts, outputs } = context;
  const entries = [...state.evidence.values(), ...state.coverageGaps.values()].filter(
    (value2) => sameRef(value2.occurrence, occurrence4)
  );
  const byKind = new Map(entries.map((value2) => [value2.evidenceKind, value2]));
  const missingKinds = opts.requiredEvidenceKinds.filter((kind) => !byKind.has(kind));
  const terminalGapKinds = opts.requiredEvidenceKinds.filter((kind) => {
    const value2 = byKind.get(kind);
    return value2 !== void 0 && value2.coverage !== "included" && value2.coverage !== "external-only";
  });
  outputs.push({
    kind: "coverage",
    value: {
      kind: "causal-evidence-coverage",
      occurrence: occurrence4,
      complete: missingKinds.length === 0 && entries.every(
        (value2) => value2.coverage !== "retention-gap" && value2.coverage !== "skipped-revision"
      ),
      entries: Object.freeze(entries),
      missingKinds: Object.freeze(missingKinds),
      terminalGapKinds: Object.freeze(terminalGapKinds)
    }
  });
}
function retainEvidence(context, key2, evidence) {
  const { state, opts, outputs } = context;
  const prior = state.evidence.get(key2);
  if (prior !== void 0) {
    if (dataKey(prior) !== dataKey(evidence))
      pushIssue(
        outputs,
        issue("causal-occurrence/evidence-conflict", "Evidence replay conflicts.", [key2])
      );
    return;
  }
  if (state.evidence.size >= opts.maxEvidence) {
    pushIssue(
      outputs,
      issue("causal-occurrence/evidence-bound", "Evidence retention bound was reached.", [key2])
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
    state.evidence.set(key2, evidence);
  }
  emitCoverage(context, evidence.occurrence);
}
function flushEvidence(context) {
  const { state } = context;
  for (const [key2, evidence] of state.pendingEvidence) {
    if (exactOccurrence(context, evidence.occurrence) === void 0) {
      if (rejectDefinitiveMissingRef(context, evidence.occurrence, "evidence"))
        state.pendingEvidence.delete(key2);
      continue;
    }
    retainEvidence(context, key2, evidence);
    state.pendingEvidence.delete(key2);
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
    const key2 = canonicalTupleKey([
      refKey(evidence.occurrence),
      evidence.evidenceKind,
      evidence.evidenceId
    ]);
    if (exactOccurrence(context, evidence.occurrence) === void 0) {
      if (rejectDefinitiveMissingRef(context, evidence.occurrence, "evidence")) continue;
      retainPending(opts, outputs, state.pendingEvidence, key2, canonical.snapshot, "evidence");
      continue;
    }
    retainEvidence(context, key2, canonical.snapshot);
  }
}
function isEvidenceTerminal(context, revisionDomain, domain) {
  const { state, opts } = context;
  const { watermark, occurrences } = domain;
  const evidenceTerminal = ![...state.pendingEvidence.values()].some(
    (evidence) => evidence.occurrence.revisionDomain === revisionDomain && evidence.occurrence.revision <= watermark
  ) && occurrences.every(
    (occurrence4) => opts.requiredEvidenceKinds.every(
      (kind) => [...state.evidence.values(), ...state.coverageGaps.values()].some(
        (entry) => sameRef(entry.occurrence, occurrence4) && entry.evidenceKind === kind && terminalCoverage.has(entry.coverage)
      )
    )
  );
  return evidenceTerminal;
}

// packages/ts/src/solutions/causal-occurrence/lifecycle.ts
function settledForEviction(context, occurrence4) {
  const { state } = context;
  const key2 = refKey(occurrence4);
  const admission = state.admissions.get(key2);
  if (admission?.state === "rejected") return true;
  if (admission?.state !== "admitted" || !state.released.has(key2) || !state.emittedTerminals.has(key2))
    return false;
  if ([
    ...state.pendingEffectProposals.values(),
    ...state.pendingEffectAdmissions.values(),
    ...state.pendingEffectOutcomes.values()
  ].some((fact) => sameRef(fact.occurrence, occurrence4)))
    return false;
  return [...state.effects.values()].filter((record) => sameRef(record.proposal.occurrence, occurrence4)).every(
    (record) => record.admission?.state === "rejected" || record.admission?.state === "admitted" && record.outcome !== void 0
  );
}
function emitConservation(context, occurrence4) {
  const { state, outputs } = context;
  const records = [...state.effects.values()].filter(
    (record) => sameRef(record.proposal.occurrence, occurrence4)
  );
  const admitted = records.filter((record) => record.admission?.state === "admitted");
  const count = (value2) => admitted.filter((record) => record.outcome?.state === value2).length;
  outputs.push({
    kind: "conservation",
    value: {
      kind: "causal-effect-conservation",
      occurrence: occurrence4,
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
function retainEffectProposal(context, key2, proposal2) {
  const { state, opts, outputs } = context;
  const pending = state.pendingEffectProposals.get(key2);
  if (pending !== void 0 && dataKey(pending) !== dataKey(proposal2)) {
    pushIssue(
      outputs,
      issue(
        "causal-occurrence/effect-proposal-conflict",
        "Effect proposal conflicts with its retained pending snapshot.",
        [key2]
      )
    );
    return true;
  }
  const prior = state.effects.get(key2);
  if (prior !== void 0) {
    if (prior.key !== dataKey(proposal2))
      pushIssue(
        outputs,
        issue("causal-occurrence/effect-proposal-conflict", "Effect proposal replay conflicts.", [
          key2
        ])
      );
    return true;
  }
  if (state.effects.size >= opts.maxEffects) {
    pushIssue(
      outputs,
      issue("causal-occurrence/effect-bound", "Effect retention bound was reached.", [key2])
    );
    return false;
  }
  state.effects.set(key2, { proposal: proposal2, key: dataKey(proposal2) });
  context.committedViewChanged = true;
  emitConservation(context, proposal2.occurrence);
  return true;
}
function flushEffectsAndTerminals(context) {
  const { state, opts, outputs } = context;
  for (const [key2, proposal2] of state.pendingEffectProposals) {
    if (exactOccurrence(context, proposal2.occurrence) === void 0 && rejectDefinitiveMissingRef(context, proposal2.occurrence, "effect-proposal")) {
      state.pendingEffectProposals.delete(key2);
      continue;
    }
    if (exactOccurrence(context, proposal2.occurrence) === void 0 || !state.released.has(refKey(proposal2.occurrence)))
      continue;
    if (retainEffectProposal(context, key2, proposal2)) state.pendingEffectProposals.delete(key2);
  }
  for (const [key2, admission] of state.pendingEffectAdmissions) {
    const record = state.effects.get(key2);
    if (record === void 0) {
      if (rejectDefinitiveMissingRef(context, admission.occurrence, "effect-admission"))
        state.pendingEffectAdmissions.delete(key2);
      continue;
    }
    if (record.proposal.proposalDigest !== admission.proposalDigest || dataKey(record.proposal.requestRef) !== dataKey(admission.requestRef) || !sameRef(record.proposal.occurrence, admission.occurrence)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-admission-mismatch",
          "Deferred effect admission does not match its proposal.",
          [key2]
        )
      );
      state.pendingEffectAdmissions.delete(key2);
      continue;
    }
    if (record.admission === void 0) {
      state.effects.set(key2, { ...record, admission });
      context.committedViewChanged = true;
    } else if (dataKey(record.admission) !== dataKey(admission))
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-admission-conflict",
          "Deferred effect admission conflicts with retained admission.",
          [key2]
        )
      );
    state.pendingEffectAdmissions.delete(key2);
    emitConservation(context, admission.occurrence);
  }
  for (const [key2, outcome3] of state.pendingEffectOutcomes) {
    const record = state.effects.get(key2);
    if (record?.admission === void 0) {
      if (rejectDefinitiveMissingRef(context, outcome3.occurrence, "effect-outcome"))
        state.pendingEffectOutcomes.delete(key2);
      continue;
    }
    const matches = record.admission.state === "admitted" && record.proposal.proposalDigest === outcome3.proposalDigest && dataKey(record.proposal.requestRef) === dataKey(outcome3.requestRef) && dataKey(record.admission.admissionRef) === dataKey(outcome3.admissionRef) && sameRef(record.proposal.occurrence, outcome3.occurrence) && outcome3.state === "succeeded" === (outcome3.result.kind === "ok");
    if (!matches) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-outcome-mismatch",
          "Deferred effect outcome lacks exact admitted authority.",
          [key2]
        )
      );
      state.pendingEffectOutcomes.delete(key2);
      continue;
    }
    if (record.outcome === void 0) {
      state.effects.set(key2, { ...record, outcome: outcome3 });
      context.committedViewChanged = true;
    } else if (dataKey(record.outcome) !== dataKey(outcome3))
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-outcome-conflict",
          "Deferred effect outcome conflicts with retained outcome.",
          [key2]
        )
      );
    state.pendingEffectOutcomes.delete(key2);
    emitConservation(context, outcome3.occurrence);
  }
  for (const [pendingKey, terminal] of state.pendingTerminals) {
    const key2 = refKey(terminal.occurrence);
    if (exactOccurrence(context, terminal.occurrence) === void 0 && rejectDefinitiveMissingRef(context, terminal.occurrence, "terminal")) {
      state.pendingTerminals.delete(pendingKey);
      continue;
    }
    if (exactOccurrence(context, terminal.occurrence) === void 0 || !state.released.has(key2))
      continue;
    const branches = state.terminals.get(key2) ?? /* @__PURE__ */ new Map();
    const prior = branches.get(terminal.branch);
    if (prior === void 0) branches.set(terminal.branch, terminal);
    else if (dataKey(prior) !== dataKey(terminal))
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/terminal-conflict",
          "Deferred branch terminal conflicts with retained terminal.",
          [key2, terminal.branch]
        )
      );
    state.terminals.set(key2, branches);
    state.pendingTerminals.delete(pendingKey);
    if (!state.emittedTerminals.has(key2) && opts.requiredBranches.every((branch) => branches.has(branch))) {
      state.emittedTerminals.add(key2);
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
    const key2 = refKey(terminal.occurrence);
    const pendingKey = canonicalTupleKey([key2, terminal.branch]);
    if (exactOccurrence(context, terminal.occurrence) === void 0 && rejectDefinitiveMissingRef(context, terminal.occurrence, "terminal"))
      continue;
    if (exactOccurrence(context, terminal.occurrence) === void 0 || !state.released.has(key2)) {
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
    const branches = state.terminals.get(key2) ?? /* @__PURE__ */ new Map();
    const prior = branches.get(terminal.branch);
    if (prior !== void 0 && dataKey(prior) !== canonical.key)
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/terminal-conflict",
          "Branch terminal replay conflicts with retained terminal.",
          [key2, terminal.branch]
        )
      );
    else if (prior === void 0) branches.set(terminal.branch, canonical.snapshot);
    state.terminals.set(key2, branches);
    if (!state.emittedTerminals.has(key2) && opts.requiredBranches.every((branch) => branches.has(branch))) {
      state.emittedTerminals.add(key2);
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
  for (const proposal2 of arrival.values) {
    if (proposal2 === null || typeof proposal2 !== "object" || !validRef(proposal2.occurrence) || !validToken(proposal2.effectId) || !validSourceRef(proposal2.requestRef) || typeof proposal2.proposalDigest !== "string" || !digestPattern.test(proposal2.proposalDigest)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-proposal-mismatch",
          "Effect proposal lacks exact occurrence authority."
        )
      );
      continue;
    }
    const canonical = canonicalEntry(proposal2);
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
    if (!retainDomain(context, proposal2.occurrence.revisionDomain)) continue;
    const key2 = effectKey(proposal2);
    if (exactOccurrence(context, proposal2.occurrence) === void 0 && rejectDefinitiveMissingRef(context, proposal2.occurrence, "effect-proposal"))
      continue;
    if (exactOccurrence(context, proposal2.occurrence) === void 0 || !state.released.has(refKey(proposal2.occurrence))) {
      retainPending(
        opts,
        outputs,
        state.pendingEffectProposals,
        key2,
        canonical.snapshot,
        "effect-proposal"
      );
      continue;
    }
    if (!retainEffectProposal(context, key2, canonical.snapshot))
      retainPending(
        opts,
        outputs,
        state.pendingEffectProposals,
        key2,
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
    const key2 = effectKey(admission);
    const record = state.effects.get(key2);
    if (record === void 0) {
      if (rejectDefinitiveMissingRef(context, admission.occurrence, "effect-admission")) continue;
      retainPending(
        opts,
        outputs,
        state.pendingEffectAdmissions,
        key2,
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
          [key2]
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
            [key2]
          )
        );
      continue;
    }
    state.effects.set(key2, { ...record, admission: canonical.snapshot });
    context.committedViewChanged = true;
    emitConservation(context, admission.occurrence);
  }
}
function receiveOutcomes(context, arrival) {
  const { state, opts, outputs } = context;
  for (const outcome3 of arrival.values) {
    if (outcome3 === null || typeof outcome3 !== "object" || !validRef(outcome3.occurrence) || !validToken(outcome3.effectId) || !validSourceRef(outcome3.requestRef) || !validSourceRef(outcome3.admissionRef) || typeof outcome3.proposalDigest !== "string" || !digestPattern.test(outcome3.proposalDigest) || !validOutcomeState(outcome3.state) || !validResult(outcome3.result)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/invalid-effect-outcome",
          "Effect outcome identity, state, or D184 result is invalid."
        )
      );
      continue;
    }
    const canonical = canonicalEntry(outcome3);
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
    const resultMatchesState = validResult(outcome3.result) && outcome3.state === "succeeded" === (outcome3.result.kind === "ok");
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
    if (!retainDomain(context, outcome3.occurrence.revisionDomain)) continue;
    const key2 = effectKey(outcome3);
    const record = state.effects.get(key2);
    if (record === void 0 || record.admission === void 0) {
      if (rejectDefinitiveMissingRef(context, outcome3.occurrence, "effect-outcome")) continue;
      retainPending(
        opts,
        outputs,
        state.pendingEffectOutcomes,
        key2,
        canonical.snapshot,
        "effect-outcome"
      );
      continue;
    }
    if (record.admission.state !== "admitted" || record.proposal.proposalDigest !== outcome3.proposalDigest || dataKey(record.proposal.requestRef) !== dataKey(canonical.snapshot.requestRef) || dataKey(record.admission.admissionRef) !== dataKey(canonical.snapshot.admissionRef) || !sameRef(record.proposal.occurrence, outcome3.occurrence)) {
      pushIssue(
        outputs,
        issue(
          "causal-occurrence/effect-outcome-mismatch",
          "Effect outcome requires exact admitted authority and a D184 result matching its state.",
          [key2]
        )
      );
      continue;
    }
    if (record.outcome !== void 0) {
      if (dataKey(record.outcome) !== canonical.key)
        pushIssue(
          outputs,
          issue("causal-occurrence/effect-outcome-conflict", "Effect outcome replay conflicts.", [
            key2
          ])
        );
      continue;
    }
    state.effects.set(key2, { ...record, outcome: canonical.snapshot });
    context.committedViewChanged = true;
    emitConservation(context, outcome3.occurrence);
  }
}
function pendingObligations(context, revisionDomain, domain) {
  const { state } = context;
  const { watermark, occurrences, latestAdmitted } = domain;
  const pending = /* @__PURE__ */ new Map();
  for (const occurrence4 of occurrences) {
    const key2 = refKey(occurrence4);
    const admission = exactAdmission(context, occurrence4);
    const isLatest = latestAdmitted.get(occurrenceIdKey(occurrence4)) === occurrence4;
    if (admission === void 0 || admission.state === "admitted" && isLatest && !state.released.has(key2) || state.released.has(key2) && !state.emittedTerminals.has(key2))
      pending.set(key2, occurrence4);
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
    terminals: new Map([...prior.terminals].map(([key2, value2]) => [key2, new Map(value2)])),
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
function transitionCausalAuthority(prior, arrivals, opts) {
  const state = cloneState(prior);
  const outputs = [];
  const emitIssue = (value2) => pushIssue(outputs, value2);
  const context = { state, opts, outputs, committedViewChanged: false };
  const acceptOccurrence = (entry) => {
    const occurrence4 = entry.value;
    if (state.byRevision.size >= opts.maxOccurrences) {
      const oldest = [...state.byRevision.entries()].sort(([, left], [, right]) => left.value.revision - right.value.revision).find(([, retained]) => settledForEviction(context, retained.value));
      if (oldest === void 0) {
        emitIssue(
          issue(
            "causal-occurrence/retention-capacity",
            "Occurrence retention is full of unsettled causal obligations.",
            [refKey(occurrence4)]
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
      for (const [key2, record] of state.effects) {
        if (sameRef(record.proposal.occurrence, evicted)) {
          state.effects.delete(key2);
          context.committedViewChanged = true;
        }
      }
      for (const [key2, evidence] of state.evidence) {
        if (sameRef(evidence.occurrence, evicted)) state.evidence.delete(key2);
      }
      for (const map3 of [
        state.pendingTerminals,
        state.pendingEffectProposals,
        state.pendingEffectAdmissions,
        state.pendingEffectOutcomes,
        state.pendingEvidence,
        state.coverageGaps
      ]) {
        for (const [key2, value2] of map3) {
          if (sameRef(value2.occurrence, evicted)) map3.delete(key2);
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
    state.byRevision.set(revisionKey(occurrence4.revisionDomain, occurrence4.revision), entry);
    state.highWaterByDomain.set(occurrence4.revisionDomain, occurrence4.revision);
    return true;
  };
  const receiveOccurrences = (arrival) => {
    for (const occurrence4 of arrival.values) {
      if (!validRef(occurrence4)) {
        emitIssue(issue("causal-occurrence/invalid-identity", "Occurrence identity is invalid."));
        continue;
      }
      let key2;
      try {
        key2 = dataKey(occurrence4);
      } catch {
        emitIssue(issue("causal-occurrence/non-data", "Occurrence must be canonical DATA."));
        continue;
      }
      const { digest: digest6, ...digestMaterial } = occurrence4;
      if (causalOccurrenceDigest(digestMaterial) !== digest6) {
        emitIssue(
          issue(
            "causal-occurrence/digest-mismatch",
            "Occurrence digest does not bind contract-v2 identity and value material.",
            [refKey(occurrence4)]
          )
        );
        continue;
      }
      if (!retainDomain(context, occurrence4.revisionDomain)) continue;
      const domainKey = revisionKey(occurrence4.revisionDomain, occurrence4.revision);
      const existing = state.byRevision.get(domainKey) ?? state.pending.get(domainKey);
      if (existing !== void 0) {
        if (existing.key !== key2)
          emitIssue(
            issue(
              "causal-occurrence/replay-conflict",
              "Revision replay conflicts with retained identity.",
              [refKey(occurrence4)]
            )
          );
        continue;
      }
      const highWater = state.highWaterByDomain.get(occurrence4.revisionDomain) ?? 0;
      const floor = state.retentionFloorByDomain.get(occurrence4.revisionDomain) ?? 0;
      if (occurrence4.revision <= highWater) {
        emitIssue(
          issue(
            occurrence4.revision <= floor ? "causal-occurrence/retention-gap" : "causal-occurrence/stale-revision",
            "Revision cannot regain causal authority.",
            [refKey(occurrence4)]
          )
        );
        outputs.push({
          kind: "currentness",
          value: {
            kind: "causal-currentness",
            occurrence: occurrence4,
            evaluatedThroughRevision: highWater,
            state: occurrence4.revision <= floor ? "unverifiable" : "stale"
          }
        });
        continue;
      }
      const entry = { value: canonicalSnapshot(occurrence4), key: key2 };
      if (occurrence4.revision > highWater + 1) {
        if (state.pending.size >= opts.maxPending) {
          emitIssue(
            issue(
              "causal-occurrence/pending-bound",
              "Skipped revision exceeded bounded pending retention.",
              [refKey(occurrence4)]
            )
          );
          continue;
        }
        state.pending.set(domainKey, entry);
        emitIssue(
          issue("causal-occurrence/skipped-revision", `Revision ${highWater + 1} is missing.`, [
            refKey(occurrence4)
          ])
        );
        outputs.push({
          kind: "currentness",
          value: {
            kind: "causal-currentness",
            occurrence: occurrence4,
            evaluatedThroughRevision: highWater,
            state: "unverifiable",
            missingRevision: highWater + 1,
            gapRef: {
              revisionDomain: occurrence4.revisionDomain,
              afterRevision: highWater,
              beforeRevision: occurrence4.revision,
              reason: "skipped-revision"
            }
          }
        });
        outputs.push({
          kind: "coverage",
          value: {
            kind: "causal-evidence-coverage",
            occurrence: occurrence4,
            complete: false,
            entries: Object.freeze([
              {
                occurrence: occurrence4,
                evidenceKind: "revision-sequence",
                evidenceId: `${occurrence4.revisionDomain}/${occurrence4.revision}`,
                evidenceDigest: occurrence4.digest,
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
        const nextRevision = (state.highWaterByDomain.get(occurrence4.revisionDomain) ?? 0) + 1;
        const pending = state.pending.get(revisionKey(occurrence4.revisionDomain, nextRevision));
        if (pending === void 0) break;
        if (!acceptOccurrence(pending)) break;
        state.pending.delete(revisionKey(occurrence4.revisionDomain, nextRevision));
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
    const evidenceTerminal = isEvidenceTerminal(context, revisionDomain, domain);
    const lifecycle = sequenceComplete && pendingOccurrenceRefs.length === 0 && pendingEffectIds.size === 0;
    const value2 = {
      kind: "causal-quiescence",
      revisionDomain,
      evaluatedThroughRevision: watermark,
      lifecycle,
      retainedEvidence: lifecycle && evidenceTerminal && (state.retentionGapThroughByDomain.get(revisionDomain) ?? 0) === 0,
      pendingOccurrenceRefs,
      pendingEffectIds: Object.freeze([...pendingEffectIds])
    };
    const prior2 = state.quiescence.get(revisionDomain);
    state.quiescence.set(revisionDomain, value2);
    if (prior2 === void 0 || dataKey(prior2) !== dataKey(value2))
      outputs.push({ kind: "quiescence", value: value2 });
  };
  const flushPending = () => {
    let promoted = false;
    flushAdmissions(context);
    flushEffectsAndTerminals(context);
    flushEvidence(context);
    for (const revisionDomain of state.domains) {
      for (; ; ) {
        const revision = (state.highWaterByDomain.get(revisionDomain) ?? 0) + 1;
        const key2 = revisionKey(revisionDomain, revision);
        const pending = state.pending.get(key2);
        if (pending === void 0 || !acceptOccurrence(pending)) break;
        state.pending.delete(key2);
        promoted = true;
      }
    }
    return promoted;
  };
  for (const arrival of arrivals) {
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
    const promoted = flushPending();
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
      const values = (depBatch(ctx, 0) ?? []).filter((raw2) => raw2.kind === "fact" && raw2.fact.kind === kind).map(
        (raw2) => [
          "DATA",
          raw2.fact.value
        ]
      );
      if (values.length > 0) ctx.down(values);
    },
    { name, factory: "causalOccurrenceFactProjection", replayBuffer }
  );
}
function buildCausalNodes(ownerGraph, graph, startup, preparedOptions, binding3) {
  binding3 = causalBinding(binding3);
  graph.assertContext(ownerGraph, startup, binding3.epoch);
  const opts = preparedOptions.options;
  const arrivals = graph.initNode(
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
    [arrivals],
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
        binding3
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
      if (values.length > 0) ctx.down(values.map((value2) => ["DATA", value2]));
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
      if (values.length > 0) ctx.down(values.map((value2) => ["DATA", value2]));
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
  const full = createCausalCapabilities(ownerGraph, graph, opts.name, result, binding3);
  Object.freeze(result);
  return Object.freeze({
    ports: result,
    full,
    committedEffects,
    roots: Object.freeze([releaseController])
  });
}
function causalOccurrenceRequiredEdges(name, description) {
  const arrivals = `${name}/arrivals`;
  const authority = `${name}/authority`;
  const releaseCandidates = `${name}/release-candidates`;
  const releaseEvents = `${name}/release-events`;
  const releasePort = `${name}/release-port`;
  const released = `${name}/released`;
  const internal = [
    { from: `${name}/input/occurrences`, to: arrivals },
    { from: `${name}/input/admissions`, to: arrivals },
    { from: `${name}/input/branch-terminals`, to: arrivals },
    { from: `${name}/input/effect-proposals`, to: arrivals },
    { from: `${name}/input/effect-admissions`, to: arrivals },
    { from: `${name}/input/effect-outcomes`, to: arrivals },
    { from: `${name}/input/evidence`, to: arrivals },
    { from: `${name}/input/watermarks`, to: arrivals },
    { from: arrivals, to: authority },
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
import { createHash } from "node:crypto";
var REQUEST = "spending-alerts/request-material/v1";
var SNAPSHOT = "spending-alerts/material-snapshot/v1";
var PROPOSAL = "spending-alerts/effect-proposal/v1";
var MAX_FRAME = 1048576;
var MAX_PAYLOAD = 8192;
var MAX_MATERIALS = 64;
function encodeMaterial(value2, limit = MAX_FRAME) {
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
    for (const [i, key2] of (array2 ? names : names.sort()).entries()) {
      const descriptor = Object.getOwnPropertyDescriptor(v, key2);
      if (!("value" in descriptor) || !descriptor.enumerable)
        throw new TypeError("non-data property");
      if (i) pieces.push(token(","));
      if (!array2) pieces.push(string(key2), token(":"));
      pieces.push(visit(descriptor.value));
    }
    pieces.push(token(array2 ? "]" : "}"));
    ancestors.delete(v);
    return pieces.join("");
  }
  const result = visit(value2);
  return { text: result, immutable };
}
function canonicalMaterial(value2, limit = MAX_FRAME) {
  return encodeMaterial(value2, limit).text;
}
function materialDigest(text3) {
  return `sha256:${createHash("sha256").update(text3, "utf8").digest("hex")}`;
}
function freeze(v) {
  if (v !== null && typeof v === "object") {
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  return v;
}
function keys(value2, expected) {
  if (value2 === null || typeof value2 !== "object" || Array.isArray(value2) || Object.keys(value2).sort().join(",") !== expected.split(",").sort().join(","))
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
function occurrence(raw2) {
  const v = raw2;
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
function validateMaterialSnapshot(raw2, expected) {
  const rows = /* @__PURE__ */ new Map();
  try {
    const encoded = encodeMaterial(raw2);
    const frame3 = JSON.parse(encoded.text);
    keys(frame3, "body,digest");
    keys(
      frame3.body,
      "schema,packRef,sourceDigest,runtimeDigest,destinationRef,compositionEpoch,hostEpoch,materials"
    );
    if (frame3.body.schema !== SNAPSHOT || !Array.isArray(frame3.body.materials) || frame3.body.materials.length > MAX_MATERIALS)
      throw new TypeError("material frame");
    profile(frame3.body);
    digest(frame3.digest);
    if (materialDigest(canonicalMaterial(frame3.body)) !== frame3.digest)
      throw new TypeError("frame digest mismatch");
    if (!sameBinding(frame3.body, expected) || frame3.body.packRef.kind !== expected.packRef.kind || frame3.body.packRef.id !== expected.packRef.id)
      return { state: "binding-mismatch", rows };
    const contents = /* @__PURE__ */ new Map();
    for (const m of frame3.body.materials) {
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
      if (!sameBinding(b, frame3.body)) return { state: "binding-mismatch", rows: /* @__PURE__ */ new Map() };
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
      const key2 = associationKey(proposalForMaterial(m));
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
      rows.set(key2, freeze(payload));
    }
    return { state: "valid", rows, cacheable: encoded.immutable };
  } catch {
    return { state: "invalid/conflicting", rows: /* @__PURE__ */ new Map() };
  }
}
function publicationFor(join3, asOf) {
  const used = /* @__PURE__ */ new Set();
  const rows = join3.view.effects.map((record) => {
    const key2 = associationKey(record.proposal);
    const payload = join3.index.rows.get(key2);
    if (payload !== void 0) used.add(key2);
    return Object.freeze({
      proposal: record.proposal,
      recorded: record.outcome?.state ?? (record.admission?.state === "admitted" ? "admitted-no-outcome" : record.admission?.state ?? "pending-admission"),
      material: join3.index.state !== "valid" ? join3.index.state : payload === void 0 ? "missing" : "matched",
      ...payload === void 0 ? {} : { payload }
    });
  });
  return Object.freeze({
    kind: "spending-alerts/publication",
    authorityId: join3.view.authorityId,
    binding: join3.view.binding,
    asOf,
    retention: join3.view.retention,
    materialFrame: join3.index.state,
    unmatchedMaterials: join3.index.rows.size - used.size,
    rows: Object.freeze(rows)
  });
}
function buildSpendingPublication(ownerGraph, scope, startup, prepared, binding3, materialSource, expected) {
  const asOf = freeze(JSON.parse(canonicalMaterial(expected)));
  keys(asOf, "packRef,sourceDigest,runtimeDigest,destinationRef,compositionEpoch,hostEpoch");
  profile(asOf);
  scope.assertContext(ownerGraph, startup, asOf.compositionEpoch);
  if (asOf.compositionEpoch !== binding3.epoch) throw new TypeError("publication context mismatch");
  const causal = buildCausalNodes(ownerGraph, scope, startup, prepared, binding3);
  const authorityId = `${prepared.options.name}/authority`;
  const expectedBinding = canonicalMaterial(binding3);
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
      const raw2 = depLatest(ctx, 1);
      const materialArrived = Boolean(depBatch(ctx, 1)?.length);
      if (raw2 === void 0 && !materialArrived) {
        state.raw = void 0;
        state.index = void 0;
        return;
      }
      if (raw2 !== state.raw || state.index === void 0 || materialArrived && !state.index.cacheable)
        state.index = validateMaterialSnapshot(raw2, asOf);
      state.raw = raw2;
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
function hash(value2) {
  return materialDigest(canonicalMaterial(value2, 4 * 1048576));
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
function evaluation(raw2) {
  keys2(
    raw2,
    "evaluationRef,subjectRef,occurrence,inputDigest,profileRef,profile,policyRef,policyDigest,policy,prefix"
  );
  str(raw2.evaluationRef);
  str(raw2.subjectRef);
  occurrence2(raw2.occurrence);
  digest2(raw2.inputDigest);
  ref2(raw2.profileRef);
  profile2(raw2.profile);
  ref2(raw2.policyRef);
  digest2(raw2.policyDigest);
  policy(raw2.policy);
  array(raw2.prefix);
  if (!raw2.prefix.length) throw new TypeError("empty-prefix");
  raw2.prefix.forEach(transaction);
  const e = raw2;
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
function validateBinding(raw2) {
  const v = JSON.parse(canonicalMaterial(raw2));
  binding(v);
  return frozen(v);
}
function checkInput(kind, raw2, expected) {
  try {
    const v = JSON.parse(canonicalMaterial(raw2, kind === "pack" ? 4 * 1048576 : 1048576));
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
    for (const raw2 of depWaves(ctx, 0).flat()) {
      if (raw2 === SENTINEL) {
        ctx.down([["DATA", frame([], [], false)]]);
        continue;
      }
      const f = raw2;
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
      for (const raw2 of depWaves(ctx, i).flat()) {
        if (raw2 === SENTINEL) {
          state.maps[i].clear();
          state.valid[i] = false;
          continue;
        }
        const f = raw2;
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
function checked(make, name, source, kind, binding3) {
  return make(name, [source], (ctx) => {
    let state = ctx.state.get();
    if (!state) {
      state = { seen: /* @__PURE__ */ new Map(), conflicts: /* @__PURE__ */ new Set() };
      ctx.state.set(state);
    }
    for (const raw2 of depWaves(ctx, 0).flat()) {
      let result = raw2 === SENTINEL ? { valid: false, issue: issue2(`invalidated-${kind}`) } : checkInput(kind, raw2, binding3);
      if (result.valid && kind === "verification") {
        for (const entry of result.value.receipts) {
          const key2 = canonicalMaterial(entry.receiptRef), text3 = canonicalMaterial(entry), prior = state.seen.get(key2);
          if (prior !== void 0 && prior !== text3) state.conflicts.add(key2);
          if (state.conflicts.has(key2)) {
            result = { valid: false, issue: issue2("receipt-identity-conflict") };
            break;
          }
          if (prior === void 0 && state.seen.size >= 64) {
            result = { valid: false, issue: issue2("receipt-lifetime-capacity") };
            break;
          }
          state.seen.set(key2, text3);
        }
      }
      ctx.state.set(state);
      ctx.down([["DATA", result]]);
    }
  });
}
function buildBusiness(make, inputs, binding3) {
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
      for (const raw2 of depWaves(ctx, 0).flat()) {
        const result = raw2 === SENTINEL ? { valid: false, issue: issue2("invalidated-pack") } : checkInput("pack", raw2, binding3);
        if (!result.valid) {
          state.available = false;
          problems.push(result.issue);
          continue;
        }
        const text3 = canonicalMaterial(result.value, 4 * 1048576);
        if (state.text !== void 0 && state.text !== text3) {
          state.available = false;
          problems.push(issue2("pack-conflict"));
          continue;
        }
        state.pack = result.value;
        state.text = text3;
        state.available = true;
      }
      const emitPending = () => {
        if (!state.available || !state.pack) return;
        const byRef = new Map(state.pack.evaluations.map((e) => [e.evaluationRef, e])), rows = [];
        for (const ref4 of state.pending) {
          const e = byRef.get(ref4);
          if (e) rows.push({ evaluation: e, value: e });
          else problems.push(issue2("unknown-evaluation", ref4));
        }
        state.pending = [];
        if (rows.length || problems.length) ctx.down([["DATA", frame(rows, problems.splice(0))]]);
      };
      emitPending();
      for (const raw2 of depWaves(ctx, 1).flat()) {
        const result = raw2 === SENTINEL ? { valid: false, issue: issue2("invalidated-arrivals") } : checkInput("arrivals", raw2, binding3);
        if (!result.valid) {
          problems.push(result.issue);
          state.pending = [];
          ctx.down([["DATA", frame([], problems.splice(0), false)]]);
          continue;
        }
        for (const ref4 of result.value.evaluationRefs) {
          if (state.pending.length >= 64) {
            problems.push(issue2("arrival-capacity", ref4));
            break;
          }
          state.pending.push(ref4);
        }
        emitPending();
      }
      if (problems.length) ctx.down([["DATA", frame([], problems, false)]]);
    }
  );
  const transaction3 = project(
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
  const policy3 = project(make, "policy", evaluationSelections, (e) => e.policy);
  const anomalyScore = join(
    make,
    "anomalyScore",
    [transaction3, vendorStats, userProfile],
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
  const thresholdGate = join(make, "thresholdGate", [anomalyScore, policy3], ([a, p]) => {
    const score = a, policy4 = p;
    return {
      flagged: score.zScore > policy4.zThreshold || score.dailyRatio > policy4.dailyRatioThreshold || score.categoryFamiliarity === "unknown",
      threshold: policy4.zThreshold,
      txn: score.txn,
      score
    };
  });
  const reasonFactors = join(
    make,
    "reasonFactors",
    [thresholdGate, policy3],
    ([g, p]) => {
      const gate = g, policy4 = p, { score, txn } = gate, factors = [];
      if (gate.flagged) {
        if (score.zScore > policy4.zThreshold)
          factors.push(
            `Amount is ${score.zScore.toFixed(2)}\u03C3 above this vendor's historical mean.`
          );
        if (score.dailyRatio > policy4.dailyRatioThreshold)
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
      binding: binding3,
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
    transaction: transaction3,
    vendorStats,
    userProfile,
    policy: policy3,
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
    for (const raw2 of depWaves(ctx, i).flat()) {
      if (raw2 === SENTINEL) {
        s.maps[i].clear();
        s.valid[i] = false;
        continue;
      }
      const f = raw2;
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
function buildAdmission(make, inputs, binding3, business, materials) {
  const currentFacts = checked(
    make,
    "currentFacts",
    inputs.evaluations.current,
    "current",
    binding3
  );
  const verificationFacts = checked(
    make,
    "verificationFacts",
    inputs.verification.receipts,
    "verification",
    binding3
  );
  const localFacts = checked(
    make,
    "localFacts",
    inputs.localAuthority.facts,
    "local",
    binding3
  );
  const inboxFacts = checked(
    make,
    "inboxFacts",
    inputs.inbox.facts,
    "inbox",
    binding3
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
      const current2 = latest(ctx, 3), verification = latest(ctx, 4), local = latest(ctx, 5), inbox = latest(ctx, 6);
      const rows = [], problems = [];
      if (!s.valid.every(Boolean)) {
        ctx.down([["DATA", frame([], [], false)]]);
        return;
      }
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
              (v) => same(v.occurrence, e.occurrence) && v.inputDigest === e.inputDigest && v.policyDigest === e.policyDigest && v.sourceDigest === binding3.sourceDigest && v.runtimeDigest === binding3.runtimeDigest && v.requestDigest === requestDigest && v.verifierRevision === VERIFIER_REVISION && v.numericDomainRef === NUMERIC_DOMAIN
            );
            const receipts = /* @__PURE__ */ new Map();
            let conflict = false;
            for (const v of verification.receipts) {
              const key2 = hash(v.receiptRef), digest6 = hash(v);
              if (receipts.has(key2) && receipts.get(key2) !== digest6) conflict = true;
              receipts.set(key2, digest6);
            }
            if (conflict || candidates.length !== 1 || candidates[0].verdict === "unavailable") {
              problems.push(issue2("verification-pending-or-conflict", e.evaluationRef));
              continue;
            }
            const receipt3 = candidates[0];
            if (receipt3.verdict === "fail") {
              reason = "verification-rejected";
              state = "failed";
              admission = frozen({
                ...p,
                admissionRef: {
                  kind: "spending-admission",
                  id: hash({
                    proposal: p,
                    receiptRef: receipt3.receiptRef,
                    verdict: "fail",
                    binding: binding3
                  })
                },
                state: "rejected"
              });
            } else {
              if (!current2 || !local || !inbox) {
                problems.push(issue2("policy-input-pending", e.evaluationRef));
                continue;
              }
              const c = current2.current.find((f) => same(f.occurrence, e.occurrence));
              if (!c || !same(c.policyRef, e.policyRef) || c.policyDigest !== e.policyDigest || c.watermark < e.occurrence.revision) {
                problems.push(issue2("policy-current-mismatch", e.evaluationRef));
                continue;
              }
              const grants = local.grants.filter(
                (g) => same(g.occurrence, e.occurrence) && g.requestDigest === requestDigest && same(g.destinationRef, binding3.destinationRef) && g.hostEpoch === binding3.hostEpoch && g.replayScope.hostEpoch === binding3.hostEpoch && g.replayScope.compositionEpoch === binding3.compositionEpoch
              );
              if (grants.length !== 1) {
                problems.push(issue2("grant-pending-or-conflict", e.evaluationRef));
                continue;
              }
              const grant3 = grants[0];
              const refused = grant3.revoked || local.stop || local.tick < grant3.validFrom || local.tick > grant3.validThrough;
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
                    receiptRef: receipt3.receiptRef,
                    grantRef: grant3.grantRef,
                    binding: binding3
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
        const value2 = frozen({ terminal, ...admission ? { admission } : {} });
        s.issued.set(k, value2);
        rows.push({ evaluation: e, value: value2 });
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
            const { occurrence: occurrence4, ...value2 } = e;
            emit([["DATA", { ...occurrence4, value: value2 }]]);
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
      for (const checked3 of frames) {
        if (!checked3?.valid) continue;
        const current2 = checked3.value;
        for (const { evaluation: e } of s.maps[0].values()) {
          const c = current2.current.find(
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
              const value2 = i === 2 ? row.value.terminal : {
                occurrence: row.evaluation.occurrence,
                branch: i === 0 ? "assessment" : "explanation",
                state: "completed",
                result: { kind: "ok", value: row.value }
              };
              emit([["DATA", value2]]);
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
      if (f.valid) for (const outcome3 of f.value.outcomes) emit([["DATA", outcome3]]);
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
          for (const receipt3 of f.value.receipts) {
            const key2 = hash(receipt3.receiptRef);
            if (!s.receipts.has(key2) && s.receipts.size < 64) s.receipts.set(key2, receipt3);
          }
      const verification = [...s.receipts.values()];
      if (!s.valid[0]) return;
      for (const { evaluation: e } of s.maps[0].values()) {
        for (const [kind, digest6] of [
          ["spending-input", e.inputDigest],
          [
            "spending-code-binding",
            hash({ sourceDigest: binding3.sourceDigest, runtimeDigest: binding3.runtimeDigest })
          ]
        ])
          emit([
            [
              "DATA",
              {
                occurrence: e.occurrence,
                evidenceKind: kind,
                evidenceId: `${e.evaluationRef}:${kind}`,
                evidenceDigest: digest6,
                coverage: "included",
                refs: [binding3.runRef]
              }
            ]
          ]);
        const material = s.valid[1] ? s.maps[1].get(occurrenceKey(e.occurrence))?.value : void 0;
        if (!material) continue;
        const expectedRequest = material.kind === "retained" ? material.material.body.payloadDigest : material.kind === "normal" ? hash({ kind: "no-publish", evaluationRef: e.evaluationRef }) : void 0;
        for (const v of verification)
          if (same(v.occurrence, e.occurrence))
            emit([
              [
                "DATA",
                {
                  occurrence: e.occurrence,
                  evidenceKind: "spending-verification",
                  evidenceId: hash(v.receiptRef),
                  evidenceDigest: hash(v),
                  coverage: v.sourceDigest !== binding3.sourceDigest || v.runtimeDigest !== binding3.runtimeDigest || v.inputDigest !== e.inputDigest || v.policyDigest !== e.policyDigest || v.verifierRevision !== VERIFIER_REVISION || v.numericDomainRef !== NUMERIC_DOMAIN || expectedRequest !== void 0 && v.requestDigest !== expectedRequest ? "stale" : v.verdict === "unavailable" || expectedRequest === void 0 ? "unavailable" : "included",
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
function buildMaterials(make, business, binding3) {
  const profile4 = materialProfile(binding3);
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
          sourceDigest: profile4.sourceDigest,
          runtimeDigest: profile4.runtimeDigest,
          destinationRef: profile4.destinationRef,
          compositionEpoch: profile4.compositionEpoch,
          hostEpoch: profile4.hostEpoch
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
      s = { materials: /* @__PURE__ */ new Map(), snapshot: makeMaterialSnapshot(profile4, []) };
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
        const key2 = occurrenceKey(row.evaluation.occurrence), prior = s.materials.get(key2);
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
            const next = makeMaterialSnapshot(profile4, [...s.materials.values(), result.material]);
            canonicalMaterial(next, 1048576);
            s.materials.set(key2, result.material);
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
  const binding3 = validateBinding(rawBinding);
  spendingInputNodes(inputs);
  scope.assertContext(ownerGraph, startup, binding3.compositionEpoch);
  const edges = /* @__PURE__ */ new Map(), make = nodeMaker(scope, name, edges);
  const business = buildBusiness(make, inputs, binding3), materials = buildMaterials(make, business, binding3), admission = buildAdmission(make, inputs, binding3, business, materials);
  const causalBinding2 = {
    contract: "contract-v2",
    implementationRevision: "construction-v1",
    scope: "full",
    epoch: binding3.compositionEpoch
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
    materialProfile(binding3)
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
        for (const raw2 of depBatch(ctx, i) ?? []) {
          const value2 = raw2;
          if (value2.kind === "issue") ctx.down([["DATA", raw2]]);
          else {
            if (value2.issue) ctx.down([["DATA", value2.issue]]);
            for (const issue4 of value2.issues ?? []) ctx.down([["DATA", issue4]]);
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
      const arrivals = ctx.waveData.map((_, i) => depBatch(ctx, i)?.length ?? 0);
      ctx.down([["DATA", frozen({ kind: "spending-diagnostic-summary", arrivals })]]);
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

// packages/ts/src/graph/graph-lifecycle.ts
var graphRegistrations = /* @__PURE__ */ new WeakMap();

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
function assertTopologyObject(value2, path) {
  if (value2 === null || typeof value2 !== "object" || Array.isArray(value2)) {
    throw new TypeError(`normalizeTopology: ${path} must be an object`);
  }
}
function topologyString(value2, path) {
  if (typeof value2 !== "string") {
    throw new TypeError(`normalizeTopology: ${path} must be a string`);
  }
  return value2;
}
function graphBlueprintDiagnostics(topology) {
  const issues = [];
  collectDiagnostics(topology, issues);
  issues.sort(compareIssues);
  return { ok: !issues.some((issue4) => issue4.severity === "error"), issues };
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
      const key2 = canonicalTupleKey([from, node.id]);
      if (seen.has(key2)) continue;
      seen.add(key2);
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
function cloneTopologyValue(value2, seen) {
  if (value2 === null) return null;
  const kind = typeof value2;
  if (kind === "string" || kind === "boolean") return value2;
  if (kind === "number") {
    if (!Number.isFinite(value2)) {
      throw new Error("topology(): meta must be finite JSON-compatible data (D39/D173)");
    }
    return value2;
  }
  if (kind !== "object") {
    throw new Error("topology(): meta must be JSON-compatible data (D39/D173)");
  }
  const objectValue = value2;
  const cached = seen.get(objectValue);
  if (cached !== void 0) return cached;
  if (Array.isArray(value2)) {
    const out2 = new Array(value2.length);
    seen.set(objectValue, out2);
    for (let i = 0; i < value2.length; i += 1) {
      if (!(i in value2)) {
        throw new Error("topology(): meta arrays must be dense JSON-compatible data (D39/D173)");
      }
      out2[i] = cloneTopologyValue(value2[i], seen);
    }
    return out2;
  }
  const proto = Object.getPrototypeOf(objectValue);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error("topology(): meta must be plain JSON-compatible data (D39/D173)");
  }
  const out = {};
  seen.set(objectValue, out);
  for (const [key2, item] of Object.entries(value2))
    out[key2] = cloneTopologyValue(item, seen);
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
  const push = (map3, k, v) => {
    const a = map3.get(k);
    if (a) a.push(v);
    else map3.set(k, [v]);
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
      let current2 = event;
      while (current2 !== void 0) {
        const observers = [...this._topologyObservers.entries()];
        for (const [id, observer] of observers) {
          if (this._topologyObservers.get(id) !== observer) continue;
          if (observer.path !== void 0 && !topologyPathMatches(current2.path, observer.path))
            continue;
          try {
            observer.sink(cloneTopologyEvent(current2));
          } catch {
          }
        }
        current2 = this._topologyQueue.shift();
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
  const text3 = q.toString().padStart(digits + 1, "0");
  return `${negative ? "-" : ""}${text3.slice(0, -digits)}.${text3.slice(-digits)}`;
}

// scripts/fixtures/spending-publication-oracle.ts
import { createHash as createHash2 } from "node:crypto";
function oracleEncoding(input, maxBytes = 1048576) {
  let remaining = maxBytes, immutable = true;
  const active2 = /* @__PURE__ */ new Set();
  function charge(text3) {
    remaining -= Buffer.byteLength(text3);
    if (remaining < 0) throw Error("frame bound");
    return text3;
  }
  function string(value2) {
    if (value2.length > remaining) throw Error("frame bound");
    for (let i = 0; i < value2.length; i++) {
      const c = value2.charCodeAt(i);
      if (c >= 55296 && c <= 56319) {
        const next = value2.charCodeAt(++i);
        if (!(next >= 56320 && next <= 57343)) throw Error("surrogate");
      } else if (c >= 56320 && c <= 57343) throw Error("surrogate");
    }
    return charge(JSON.stringify(value2));
  }
  function encode(value2) {
    if (value2 === null || typeof value2 === "boolean") return charge(JSON.stringify(value2));
    if (typeof value2 === "number" && Number.isFinite(value2)) return charge(JSON.stringify(value2));
    if (typeof value2 === "string") return string(value2);
    if (typeof value2 !== "object" || value2 === null || active2.has(value2)) throw Error("passive");
    const array2 = Array.isArray(value2), proto = Object.getPrototypeOf(value2);
    if (array2 ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
      throw Error("prototype");
    if (array2 && value2.length > remaining / 2) throw Error("array bound");
    const keys3 = Reflect.ownKeys(value2);
    if (keys3.length > remaining / 2 || keys3.some((k) => typeof k !== "string")) throw Error("keys");
    const names = keys3.filter((k) => !array2 || k !== "length");
    if (array2 && (names.length !== value2.length || names.some((k, i) => k !== String(i))))
      throw Error("array");
    active2.add(value2);
    immutable &&= Object.isFrozen(value2);
    const encoded = [charge(array2 ? "[" : "{")];
    let first2 = true;
    for (const key2 of array2 ? names : names.sort()) {
      const d = Object.getOwnPropertyDescriptor(value2, key2);
      if (!("value" in d) || !d.enumerable) throw Error("descriptor");
      if (!first2) encoded.push(charge(","));
      first2 = false;
      if (!array2) encoded.push(string(key2), charge(":"));
      encoded.push(encode(d.value));
    }
    encoded.push(charge(array2 ? "]" : "}"));
    active2.delete(value2);
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
function oracleSnapshot(p, materials) {
  const body = { ...p, schema: "spending-alerts/material-snapshot/v1", materials };
  return oracleFreeze({ body, digest: oracleHash(oracleCanonical(body)) });
}
function shape(v, names) {
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join("|") !== names.split("|").sort().join("|"))
    throw Error("shape");
  return v;
}
function stringFields(v, names) {
  for (const n of names.split("|")) if (typeof v[n] !== "string") throw Error("string");
}
function reference(v) {
  const o = shape(v, "kind|id");
  stringFields(o, "kind|id");
}
function isDigest(v) {
  if (typeof v !== "string" || !/^sha256:[0-9a-f]{64}$/.test(v)) throw Error("digest");
}
function coordinates(v) {
  reference(v.destinationRef);
  isDigest(v.sourceDigest);
  isDigest(v.runtimeDigest);
  for (const n of ["hostEpoch", "compositionEpoch"])
    if (!Number.isSafeInteger(v[n]) || v[n] < 1) throw Error("epoch");
}
function coordinatesEqual(left, right) {
  for (const key2 of ["sourceDigest", "runtimeDigest", "compositionEpoch", "hostEpoch"])
    if (left[key2] !== right[key2]) return false;
  const a = left.destinationRef, b = right.destinationRef;
  return a.kind === b.kind && a.id === b.id;
}
function proposalKey(p) {
  const o = p.occurrence;
  return JSON.stringify([
    p.effectId,
    p.proposalDigest,
    p.requestRef.kind,
    p.requestRef.id,
    o.occurrenceId,
    o.revisionDomain,
    o.revision,
    o.digest,
    o.sourceRefs.map((r) => [r.kind, r.id])
  ]);
}
function verifyPublicationMaterial(raw2, expected) {
  try {
    const encoding = oracleEncoding(raw2);
    const encoded = encoding.text;
    if (Buffer.byteLength(encoded) > 1048576) throw Error("frame bound");
    const frame3 = shape(JSON.parse(encoded), "body|digest");
    const body = shape(
      frame3.body,
      "schema|packRef|destinationRef|sourceDigest|runtimeDigest|compositionEpoch|hostEpoch|materials"
    );
    if (body.schema !== "spending-alerts/material-snapshot/v1" || !Array.isArray(body.materials) || body.materials.length > 64)
      throw Error("snapshot");
    reference(body.packRef);
    coordinates(body);
    isDigest(frame3.digest);
    if (oracleHash(oracleCanonical(body)) !== frame3.digest) throw Error("frame hash");
    if (!coordinatesEqual(body, expected) || oracleCanonical(body.packRef) !== oracleCanonical(expected.packRef))
      return { state: "binding-mismatch", rows: /* @__PURE__ */ new Map() };
    const rows = /* @__PURE__ */ new Map(), identities = /* @__PURE__ */ new Map();
    for (const value2 of body.materials) {
      const m = shape(value2, "body|requestRef|proposalDigest");
      const b = shape(
        m.body,
        "schema|occurrence|effectId|destinationRef|compositionEpoch|hostEpoch|inputDigest|policyDigest|sourceDigest|runtimeDigest|payloadText|payloadDigest"
      );
      if (b.schema !== "spending-alerts/request-material/v1") throw Error("schema");
      coordinates(b);
      stringFields(b, "effectId|payloadText");
      for (const n of ["inputDigest", "policyDigest", "payloadDigest"]) isDigest(b[n]);
      isDigest(m.proposalDigest);
      reference(m.requestRef);
      const o = shape(b.occurrence, "revisionDomain|occurrenceId|revision|digest|sourceRefs");
      stringFields(o, "revisionDomain|occurrenceId");
      isDigest(o.digest);
      if (!Number.isSafeInteger(o.revision) || o.revision < 1 || !Array.isArray(o.sourceRefs))
        throw Error("occurrence");
      o.sourceRefs.forEach(reference);
      if (!coordinatesEqual(b, body)) return { state: "binding-mismatch", rows: /* @__PURE__ */ new Map() };
      const payloadText = b.payloadText;
      if (Buffer.byteLength(payloadText) > 8192) throw Error("payload bound");
      const payload = shape(JSON.parse(payloadText), "transactionId|vendor|severity|message");
      stringFields(payload, "transactionId|vendor|severity|message");
      if (!["low", "medium", "high"].includes(payload.severity) || oracleCanonical(payload) !== payloadText || oracleHash(payloadText) !== b.payloadDigest)
        throw Error("payload hash");
      const request = m.requestRef;
      if (request.kind !== "spending-alerts/request-material/v1" || request.id !== oracleHash(oracleCanonical(b)))
        throw Error("request hash");
      const proposal2 = {
        occurrence: b.occurrence,
        effectId: b.effectId,
        requestRef: request,
        proposalDigest: m.proposalDigest
      };
      if (m.proposalDigest !== oracleHash(
        oracleCanonical({
          schema: "spending-alerts/effect-proposal/v1",
          occurrence: b.occurrence,
          effectId: b.effectId,
          requestRef: request
        })
      ))
        throw Error("proposal hash");
      const key2 = proposalKey(proposal2), identity = oracleCanonical([b.occurrence, b.effectId]), bytes = oracleCanonical(m);
      if (identities.has(identity) && identities.get(identity) !== bytes) throw Error("conflict");
      identities.set(identity, bytes);
      rows.set(key2, oracleFreeze(payload));
    }
    return { state: "valid", rows, cacheable: encoding.immutable };
  } catch {
    return { state: "invalid/conflicting", rows: /* @__PURE__ */ new Map() };
  }
}
function oraclePublication(view, index, profile4) {
  const used = /* @__PURE__ */ new Set();
  const rows = view.effects.map((r) => {
    const key2 = proposalKey(r.proposal), payload = index.rows.get(key2);
    if (payload !== void 0) used.add(key2);
    return Object.freeze({
      proposal: r.proposal,
      recorded: r.outcome?.state ?? (r.admission?.state === "admitted" ? "admitted-no-outcome" : r.admission?.state ?? "pending-admission"),
      material: index.state !== "valid" ? index.state : payload === void 0 ? "missing" : "matched",
      ...payload === void 0 ? {} : { payload }
    });
  });
  return Object.freeze({
    kind: "spending-alerts/publication",
    authorityId: view.authorityId,
    binding: view.binding,
    asOf: profile4,
    retention: view.retention,
    materialFrame: index.state,
    unmatchedMaterials: index.rows.size - used.size,
    rows: Object.freeze(rows)
  });
}
function oracleProfile(raw2) {
  const p = JSON.parse(oracleCanonical(raw2));
  shape(p, "packRef|destinationRef|sourceDigest|runtimeDigest|compositionEpoch|hostEpoch");
  reference(p.packRef);
  coordinates(p);
  return oracleFreeze(p);
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
function verifyBusiness(e, observed) {
  if (!Number.isFinite(observed.score.zScore) || !Number.isFinite(observed.score.dailyRatio))
    return false;
  const expected = oracleBusiness(e), close = (a, b) => Number.isFinite(a) && Math.abs(a - b) <= 1e-10 * Math.max(1, Math.abs(b));
  const actualFlags = [
    observed.score.zScore > e.policy.zThreshold,
    observed.score.dailyRatio > e.policy.dailyRatioThreshold,
    !e.profile.typicalCategories.includes(expected.txn.category)
  ];
  const actualFactors = [
    `Amount is ${referenceFixed(observed.score.zScore, 2)}\u03C3 above this vendor's historical mean.`,
    `Amount is ${referenceFixed(observed.score.dailyRatio, 1)}\xD7 the user's daily average.`,
    "Category is outside the user's typical spend profile."
  ].filter((_, i) => actualFlags[i]);
  return observed.flagged === actualFlags.some(Boolean) && oracleCanonical(observed.reason.factors) === oracleCanonical(actualFactors) && close(observed.score.zScore, expected.zScore) && close(observed.score.dailyRatio, expected.dailyRatio) && observed.flagged === expected.flagged && observed.reason.severity === expected.severity && oracleCanonical(observed.reason.factors) === oracleCanonical(expected.factors) && observed.message === expected.message;
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

// scripts/fixtures/spending-numeric-plain.ts
function decode(x) {
  if (x === 0) return 0n;
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x);
  const value2 = b.readBigUInt64BE(), field = value2 >> 52n;
  return field === 0n ? value2 : (value2 & 0xfffffffffffffn) + 0x10000000000000n << field - 1n;
}
function raw(x) {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x);
  return b.readBigUInt64BE();
}
function value(bits2) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(bits2);
  return b.readDoubleBE();
}
var denominatorUnit = 1n << 1074n;
function roundRoot(n, d, candidate) {
  if (n === 0n) return 0;
  const center = raw(candidate);
  const compare = (sumUnits) => d * sumUnits ** 2n - n * (2n * denominatorUnit) ** 2n;
  for (const bits2 of [center, center - 1n, center + 1n]) {
    if (bits2 < 0n || bits2 > 0x7fefffffffffffffn) continue;
    const here = decode(value(bits2));
    const low = bits2 === 0n ? -1n : compare(here + decode(value(bits2 - 1n)));
    const high = compare(here + decode(value(bits2 + 1n)));
    if ((low < 0n || low === 0n && bits2 % 2n === 0n) && (high > 0n || high === 0n && bits2 % 2n === 0n))
      return value(bits2);
  }
  let lo = 0n, hi = raw(8);
  while (lo + 1n < hi) {
    const mid = lo + hi >> 1n, u = decode(value(mid));
    if (d * u * u <= n * denominatorUnit * denominatorUnit) lo = mid;
    else hi = mid;
  }
  const cmp = compare(decode(value(lo)) + decode(value(hi)));
  return value(cmp < 0n || cmp === 0n && lo % 2n !== 0n ? hi : lo);
}
function plainMoments(amounts) {
  const anchor = decode(amounts[0]), n = BigInt(amounts.length);
  let sum = 0n, sumSquares = 0n;
  for (const x of amounts) {
    const delta2 = decode(x) - anchor;
    sum += delta2;
    sumSquares += delta2 * delta2;
  }
  const dispersion = n * sumSquares - sum * sum;
  const delta = n * (decode(amounts[amounts.length - 1]) - anchor) - sum;
  const numerator = delta * delta * (n - 1n), denominator = n * dispersion;
  return {
    numerator: numerator.toString(),
    denominator: denominator.toString(),
    negative: delta < 0n
  };
}
function plainScore(moments) {
  const numerator = BigInt(moments.numerator), denominator = BigInt(moments.denominator);
  let magnitude = 0;
  if (numerator !== 0n && denominator !== 0n) {
    const shiftN = Math.max(0, numerator.toString(2).length - 53);
    const shiftD = Math.max(0, denominator.toString(2).length - 53);
    const power = shiftN - shiftD;
    const estimate = Math.sqrt(
      Number(numerator >> BigInt(shiftN)) / Number(denominator >> BigInt(shiftD)) * 2 ** (power % 2)
    ) * 2 ** Math.floor(power / 2);
    magnitude = roundRoot(numerator, denominator, estimate);
  }
  return magnitude === 0 ? 0 : moments.negative ? -magnitude : magnitude;
}
function plainNumbers(amounts, dailyAverage) {
  return {
    zScore: plainScore(plainMoments(amounts)),
    dailyRatio: amounts[amounts.length - 1] === 0 ? 0 : amounts[amounts.length - 1] / Math.max(dailyAverage, 1)
  };
}

// scripts/fixtures/spending-preset-reference-input.ts
var reject = () => {
  throw new TypeError("reference input contract");
};
var fields = (value2, shape2) => {
  if (!value2 || Array.isArray(value2) || typeof value2 !== "object" || Object.keys(value2).sort().join() !== Object.keys(shape2).sort().join())
    reject();
  for (const key2 of Object.keys(shape2)) shape2[key2](value2[key2]);
};
var text2 = (limit = 128) => (v) => {
  if (typeof v !== "string" || !v.length || Buffer.byteLength(v) > limit) reject();
};
var number3 = (max = Number.MAX_SAFE_INTEGER, min = 0, integer = true) => (v) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || integer && !Number.isSafeInteger(v))
    reject();
};
var bool = (v) => {
  if (typeof v !== "boolean") reject();
};
var literal = (...values) => (v) => {
  if (!values.includes(v)) reject();
};
var digest3 = (v) => {
  if (typeof v !== "string" || !/^sha256:[a-f0-9]{64}$/.test(v)) reject();
};
var ref3 = (v) => fields(v, { kind: text2(), id: text2() });
var list = (check, max = 64, min = 0) => (v) => {
  if (!Array.isArray(v) || v.length < min || v.length > max) reject();
  for (let i = 0; i < v.length; i++) {
    if (!Object.hasOwn(v, i)) reject();
    check(v[i]);
  }
};
var unique = (items) => {
  if (new Set(items.map((x) => oracleCanonical(x))).size !== items.length) reject();
};
var occurrence3 = (v) => {
  fields(v, {
    revisionDomain: text2(),
    occurrenceId: text2(),
    revision: number3(void 0, 1),
    digest: digest3,
    sourceRefs: list(ref3, 64, 1)
  });
  unique(v.sourceRefs);
};
var profile3 = (v) => {
  fields(v, { dailyAverage: number3(1e9, 0, false), typicalCategories: list(text2(256), 32) });
  unique(v.typicalCategories);
};
var policy2 = (v) => fields(v, { zThreshold: number3(1e6, 0, false), dailyRatioThreshold: number3(1e6, 0, false) });
var transaction2 = (v) => {
  fields(v, {
    id: text2(),
    vendor: text2(256),
    category: text2(256),
    amount: number3(1e9, 0, false),
    timestampIso: text2()
  });
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.timestampIso) || !Number.isFinite(Date.parse(v.timestampIso)) || new Date(v.timestampIso).toISOString() !== v.timestampIso)
    reject();
};
var evaluation2 = (e) => {
  fields(e, {
    evaluationRef: text2(),
    subjectRef: text2(),
    occurrence: occurrence3,
    inputDigest: digest3,
    profileRef: ref3,
    profile: profile3,
    policyRef: ref3,
    policyDigest: digest3,
    policy: policy2,
    prefix: list(transaction2, 64, 1)
  });
  unique(e.prefix.map((t) => t.id));
  if (new Set(e.prefix.map((t) => t.vendor)).size !== 1 || Buffer.byteLength(oracleCanonical(e)) > 65536)
    reject();
  if (e.inputDigest !== oracleHash(oracleCanonical({ profileRef: e.profileRef, profile: e.profile, prefix: e.prefix })) || e.policyDigest !== oracleHash(oracleCanonical(e.policy)))
    reject();
};
var binding2 = (v) => fields(v, {
  packRef: ref3,
  sourceDigest: digest3,
  runtimeDigest: digest3,
  destinationRef: ref3,
  compositionEpoch: number3(void 0, 1),
  hostEpoch: number3(void 0, 1),
  runRef: text2(),
  evidenceMode: literal("fixture-observations")
});
var receipt2 = (v) => fields(v, {
  receiptRef: ref3,
  issuerRef: ref3,
  verifierRevision: text2(),
  occurrence: occurrence3,
  inputDigest: digest3,
  policyDigest: digest3,
  sourceDigest: digest3,
  runtimeDigest: digest3,
  requestDigest: digest3,
  numericDomainRef: text2(),
  verdict: literal("pass", "fail", "unavailable"),
  artifactRef: ref3,
  artifactDigest: digest3
});
var grant2 = (v) => {
  fields(v, {
    grantRef: ref3,
    ownerRef: ref3,
    operation: literal("append-alert"),
    occurrence: occurrence3,
    requestDigest: digest3,
    destinationRef: ref3,
    hostEpoch: number3(void 0, 1),
    validFrom: number3(),
    validThrough: number3(),
    maxWrites: number3(64, 1),
    replayScope: (x) => fields(x, { compositionEpoch: number3(void 0, 1), hostEpoch: number3(void 0, 1) }),
    revoked: bool
  });
  if (v.validFrom > v.validThrough) reject();
};
var current = (v) => {
  fields(v, {
    revisionDomain: text2(),
    occurrence: occurrence3,
    policyRef: ref3,
    policyDigest: digest3,
    watermark: number3()
  });
  if (v.revisionDomain !== v.occurrence.revisionDomain) reject();
};
var outcome2 = (v) => fields(v, {
  occurrence: occurrence3,
  effectId: text2(),
  requestRef: ref3,
  admissionRef: ref3,
  proposalDigest: digest3,
  state: literal("succeeded", "failed", "cancelled", "unknown", "reconcile-required"),
  result: (x) => {
    if (!x || typeof x !== "object" || !["ok", "error"].includes(x.kind)) reject();
  }
});
function referenceInput(lane2, raw2, expected) {
  const encoded = oracleCanonical(raw2, lane2 === "pack" ? 4 * 1048576 : 1048576);
  if (Buffer.byteLength(encoded) > (lane2 === "pack" ? 4 * 1048576 : 1048576)) reject();
  const v = JSON.parse(encoded);
  if (lane2 === "arrivals") {
    fields(v, { packRef: ref3, evaluationRefs: list(text2()) });
    if (oracleCanonical(v.packRef) !== oracleCanonical(expected.packRef)) reject();
  } else {
    const shape2 = {
      pack: { format: literal("spending-input-v1"), evaluations: list(evaluation2) },
      current: { current: list(current) },
      verification: { receipts: list(receipt2) },
      local: { tick: number3(), stop: bool, grants: list(grant2) },
      inbox: {
        issuerRef: ref3,
        artifactRef: ref3,
        artifactDigest: digest3,
        readiness: (x) => fields(x, {
          ready: bool,
          observedAt: number3(),
          validThrough: number3(),
          availableSlots: number3(1)
        }),
        outcomes: list(outcome2)
      }
    };
    fields(v, { binding: binding2, ...shape2[lane2] });
    if (oracleCanonical(v.binding) !== oracleCanonical(expected)) reject();
    if (lane2 === "pack") {
      unique(v.evaluations.map((e) => e.evaluationRef));
      unique(v.evaluations.map((e) => e.occurrence));
      if (new Set(v.evaluations.map((e) => e.prefix[0].vendor)).size > 2) reject();
      const domains = /* @__PURE__ */ new Map();
      for (const e of v.evaluations) {
        const vendor = e.prefix[0].vendor, prior = domains.get(e.occurrence.revisionDomain);
        if (prior !== void 0 && prior !== vendor) reject();
        domains.set(e.occurrence.revisionDomain, vendor);
      }
    } else if (lane2 === "current") unique(v.current.map((c) => c.revisionDomain));
  }
  return oracleFreeze(v);
}
function referenceBinding(raw2) {
  const value2 = JSON.parse(oracleCanonical(raw2));
  binding2(value2);
  return oracleFreeze(value2);
}

// scripts/fixtures/spending-preset-plain.ts
var digest4 = (x) => oracleHash(oracleCanonical(x));
var equal = (a, b) => oracleCanonical(a) === oracleCanonical(b);
function plainBusiness(e) {
  const txn = e.prefix[e.prefix.length - 1];
  const { zScore, dailyRatio } = plainNumbers(
    e.prefix.map((t) => t.amount),
    e.profile.dailyAverage
  );
  const factors = [];
  if (zScore > e.policy.zThreshold)
    factors.push(`Amount is ${zScore.toFixed(2)}\u03C3 above this vendor's historical mean.`);
  if (dailyRatio > e.policy.dailyRatioThreshold)
    factors.push(`Amount is ${dailyRatio.toFixed(1)}\xD7 the user's daily average.`);
  if (!e.profile.typicalCategories.includes(txn.category))
    factors.push("Category is outside the user's typical spend profile.");
  const severity = factors.length >= 3 ? "high" : factors.length === 2 ? "medium" : "low", flagged = factors.length > 0;
  const message = flagged ? `Transaction ${txn.id} flagged \u2014 severity: ${severity}.
Vendor: ${txn.vendor}  Amount: $${txn.amount.toFixed(2)}  Category: ${txn.category}
Reasoning:
${factors.map((f) => `  \u2022 ${f}`).join("\n")}` : `Transaction ${txn.id} ($${txn.amount.toFixed(2)} at ${txn.vendor}) \u2014 normal.`;
  return {
    score: {
      zScore,
      dailyRatio,
      categoryFamiliarity: e.profile.typicalCategories.includes(txn.category) ? "known" : "unknown",
      txn
    },
    flagged,
    reason: { factors, severity, txn },
    message
  };
}
function plainMaterial(e, b, result) {
  const payloadText = oracleCanonical({
    transactionId: result.score.txn.id,
    vendor: result.score.txn.vendor,
    severity: result.reason.severity,
    message: result.message
  });
  if (Buffer.byteLength(payloadText) + 1 > 4096) throw Error("payload capacity");
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
var PlainSpending = class {
  constructor(binding3) {
    this.binding = binding3;
    this.binding = referenceBinding(binding3);
  }
  binding;
  evaluations = /* @__PURE__ */ new Map();
  assessments = /* @__PURE__ */ new Map();
  materials = /* @__PURE__ */ new Map();
  effects = /* @__PURE__ */ new Map();
  issues = [];
  pending = [];
  eligible = /* @__PURE__ */ new Set();
  occurrenceAdmissions = /* @__PURE__ */ new Set();
  released = /* @__PURE__ */ new Set();
  watermarks = /* @__PURE__ */ new Map();
  identity = /* @__PURE__ */ new Map();
  domains = /* @__PURE__ */ new Set();
  evidenceReceipts = /* @__PURE__ */ new Map();
  evidenceRecords = /* @__PURE__ */ new Map();
  branches = /* @__PURE__ */ new Map();
  pendingTerminals = /* @__PURE__ */ new Map();
  issuedPolicy = /* @__PURE__ */ new Set();
  terminal(id, branch) {
    const e = this.evaluations.get(id);
    if (!this.retainDomain(e.occurrence.revisionDomain)) return;
    const retained = this.identity.get(e.occurrence.revisionDomain)?.get(e.occurrence.revision);
    if (retained && !equal(retained.occurrence, e.occurrence)) return;
    if (this.released.has(id)) {
      this.branches.get(id)?.add(branch);
      return;
    }
    const key2 = oracleCanonical([id, branch]);
    if (!this.pendingTerminals.has(key2) && this.pendingTerminals.size < 64)
      this.pendingTerminals.set(key2, { id, branch });
  }
  retainDomain(domain) {
    if (this.domains.has(domain)) return true;
    if (this.domains.size === 64) {
      this.issues.push("domain capacity");
      return false;
    }
    this.domains.add(domain);
    return true;
  }
  receiptHistory = /* @__PURE__ */ new Map();
  receiptConflicts = /* @__PURE__ */ new Set();
  pendingOutcomes = /* @__PURE__ */ new Map();
  pack;
  packText;
  facts = {};
  prepare(lane2, raw2) {
    const v = referenceInput(lane2, raw2, this.binding);
    if (lane2 === "verification")
      for (const receipt3 of v.receipts) {
        const key2 = oracleCanonical(receipt3.receiptRef), prior = this.receiptHistory.get(key2), content = oracleCanonical(receipt3);
        if (prior !== void 0 && prior !== content) this.receiptConflicts.add(key2);
        if (this.receiptConflicts.has(key2)) throw Error("receipt conflict");
        if (prior === void 0 && this.receiptHistory.size >= 64) throw Error("receipt capacity");
        this.receiptHistory.set(key2, content);
      }
    return v;
  }
  push(lane2, raw2) {
    const arrived = [];
    let value2;
    try {
      value2 = this.prepare(lane2, raw2);
    } catch (e) {
      if (lane2 === "pack") this.pack = void 0;
      else if (lane2 === "arrivals") this.pending.length = 0;
      else delete this.facts[lane2];
      if (lane2 === "pack" || lane2 === "arrivals") this.eligible.clear();
      this.issues.push(String(e));
      return;
    }
    if (lane2 === "pack") {
      const pack = value2, text3 = oracleCanonical(pack, 4 * 1048576);
      if (this.packText !== void 0 && text3 !== this.packText) {
        this.pack = void 0;
        this.eligible.clear();
        this.issues.push("pack conflict");
        return;
      }
      this.pack = pack;
      this.packText = text3;
    } else if (lane2 === "arrivals") {
      for (const ref4 of value2.evaluationRefs) {
        if (this.pending.length >= 64) {
          this.issues.push("pending capacity");
          break;
        }
        this.pending.push(ref4);
      }
    } else {
      Object.assign(this.facts, { [lane2]: value2 });
      if (lane2 === "current")
        for (const c of value2.current) {
          const prior = this.watermarks.get(c.revisionDomain) ?? 0;
          if (this.retainDomain(c.revisionDomain) && c.watermark >= prior)
            this.watermarks.set(c.revisionDomain, c.watermark);
        }
    }
    if (this.pack) {
      for (const id of this.pending.splice(0)) {
        const e = this.pack.evaluations.find((e2) => e2.evaluationRef === id);
        if (!e) {
          this.issues.push("unknown evaluation");
          continue;
        }
        this.eligible.add(id);
        arrived.push(id);
        if (this.evaluations.has(id)) continue;
        this.evaluations.set(id, e);
        const { occurrence: occurrence4, ...body } = e, { digest: claimed, ...coordinates2 } = occurrence4;
        if (this.retainDomain(occurrence4.revisionDomain) && claimed === digest4({
          schemaRevision: "graphrefly/causal-occurrence-contract/v1@contract-v2",
          ...coordinates2,
          value: body
        })) {
          let domain = this.identity.get(occurrence4.revisionDomain);
          if (!domain) {
            domain = /* @__PURE__ */ new Map();
            this.identity.set(occurrence4.revisionDomain, domain);
          }
          if (!domain.has(occurrence4.revision)) domain.set(occurrence4.revision, e);
        }
        const result = plainBusiness(e);
        if (this.retainDomain(e.occurrence.revisionDomain)) this.branches.set(id, /* @__PURE__ */ new Set());
        this.assessments.set(id, result);
        if (!result.flagged) continue;
        try {
          if (this.materials.size >= 64) throw Error("material capacity");
          const material = plainMaterial(e, this.binding, result);
          const { runRef: _run, evidenceMode: _mode, ...profile4 } = this.binding;
          oracleSnapshot(profile4, [...this.materials.values(), material]);
          this.materials.set(id, material);
          this.effects.set(id, {
            proposal: {
              occurrence: e.occurrence,
              effectId: material.body.effectId,
              requestRef: material.requestRef,
              proposalDigest: material.proposalDigest
            }
          });
        } catch (error) {
          this.issues.push(String(error));
        }
      }
    }
    if (lane2 === "verification")
      for (const receipt3 of value2.receipts) {
        const key2 = oracleCanonical(receipt3.receiptRef);
        if (!this.evidenceReceipts.has(key2) && this.evidenceReceipts.size < 64)
          this.evidenceReceipts.set(key2, receipt3);
      }
    this.reconcile(lane2 === "inbox" ? value2.outcomes : [], arrived);
  }
  reconcile(incomingOutcomes, arrived) {
    const { current: current2, verification, local, inbox } = this.facts;
    for (const id of this.eligible) {
      const e = this.evaluations.get(id);
      if (current2?.current.some(
        (c) => equal(c.occurrence, e.occurrence) && equal(c.policyRef, e.policyRef) && c.policyDigest === e.policyDigest
      )) {
        if (this.retainDomain(e.occurrence.revisionDomain)) this.occurrenceAdmissions.add(id);
      }
    }
    for (const [name, domain] of this.identity) {
      const through = this.watermarks.get(name);
      if (through === void 0) continue;
      const ordered = [...domain].filter(([n]) => n <= through).sort(([a], [b]) => a - b);
      if (ordered.length !== through || ordered.some(([n, e], i) => n !== i + 1 || !this.occurrenceAdmissions.has(e.evaluationRef)))
        continue;
      const latest2 = /* @__PURE__ */ new Map();
      for (const [, e] of ordered) latest2.set(e.occurrence.occurrenceId, e);
      for (const e of latest2.values()) this.released.add(e.evaluationRef);
    }
    for (const [key2, { id, branch }] of this.pendingTerminals) {
      const occurrence4 = this.evaluations.get(id).occurrence;
      const retained = this.identity.get(occurrence4.revisionDomain)?.get(occurrence4.revision);
      if (retained && !equal(retained.occurrence, occurrence4)) {
        this.pendingTerminals.delete(key2);
        continue;
      }
      if (this.released.has(id)) {
        this.branches.get(id)?.add(branch);
        this.pendingTerminals.delete(key2);
      }
    }
    for (const branch of ["assessment", "explanation"])
      for (const id of arrived) this.terminal(id, branch);
    for (const [id, record] of this.effects) {
      if (record.admission || !this.eligible.has(id)) continue;
      const e = this.evaluations.get(id), material = this.materials.get(id);
      const receipts = verification?.receipts.filter(
        (v) => equal(v.occurrence, e.occurrence) && v.inputDigest === e.inputDigest && v.policyDigest === e.policyDigest && v.sourceDigest === this.binding.sourceDigest && v.runtimeDigest === this.binding.runtimeDigest && v.requestDigest === material.body.payloadDigest && v.verifierRevision === "spending-oracle-v2" && v.numericDomainRef === "spending-finite-v1"
      ) ?? [];
      if (receipts.length !== 1 || receipts[0].verdict === "unavailable") continue;
      const receipt3 = receipts[0];
      if (receipt3.verdict === "fail") {
        record.admission = {
          ...record.proposal,
          state: "rejected",
          admissionRef: {
            kind: "spending-admission",
            id: digest4({
              proposal: record.proposal,
              receiptRef: receipt3.receiptRef,
              verdict: "fail",
              binding: this.binding
            })
          }
        };
        continue;
      }
      if (!current2 || !local || !inbox) continue;
      if (!current2.current.some(
        (c) => equal(c.occurrence, e.occurrence) && equal(c.policyRef, e.policyRef) && c.policyDigest === e.policyDigest && c.watermark >= e.occurrence.revision
      ))
        continue;
      const grants = local.grants.filter(
        (g2) => equal(g2.occurrence, e.occurrence) && g2.requestDigest === material.body.payloadDigest && equal(g2.destinationRef, this.binding.destinationRef) && g2.hostEpoch === this.binding.hostEpoch && g2.replayScope.hostEpoch === this.binding.hostEpoch && g2.replayScope.compositionEpoch === this.binding.compositionEpoch
      );
      if (grants.length !== 1) continue;
      const g = grants[0], refused = g.revoked || local.stop || local.tick < g.validFrom || local.tick > g.validThrough;
      if (!refused && (!inbox.readiness.ready || inbox.readiness.availableSlots !== 1 || local.tick < inbox.readiness.observedAt || local.tick > inbox.readiness.validThrough))
        continue;
      record.admission = {
        ...record.proposal,
        state: refused ? "rejected" : "admitted",
        admissionRef: {
          kind: "spending-admission",
          id: digest4({
            proposal: record.proposal,
            receiptRef: receipt3.receiptRef,
            grantRef: g.grantRef,
            binding: this.binding
          })
        }
      };
    }
    const applyOutcome = (o) => {
      const e = [...this.effects.values()].find(
        (e2) => equal(e2.proposal.occurrence, o.occurrence) && e2.proposal.effectId === o.effectId
      );
      if (!e?.admission || ![...this.effects].some(([id, record]) => record === e && this.released.has(id)))
        return false;
      if (e.admission.state === "admitted" && equal(e.proposal.requestRef, o.requestRef) && e.proposal.proposalDigest === o.proposalDigest && equal(e.admission.admissionRef, o.admissionRef) && !e.outcome)
        e.outcome = o;
      return true;
    };
    for (const [key2, o] of this.pendingOutcomes)
      if (applyOutcome(o)) this.pendingOutcomes.delete(key2);
    for (const o of incomingOutcomes) {
      const result = o.result;
      if (!result || typeof result !== "object") continue;
      if (o.state === "succeeded") {
        if (result.kind !== "ok" || !Object.hasOwn(result, "value")) continue;
      } else {
        if (!["failed", "cancelled", "unknown", "reconcile-required"].includes(o.state)) continue;
        if (result.kind !== "error" || !result.error || result.error.kind !== "issue" || typeof result.error.code !== "string" || !result.error.code || typeof result.error.message !== "string" || !result.error.message)
          continue;
      }
      if (!this.retainDomain(o.occurrence.revisionDomain)) continue;
      const key2 = digest4({ occurrence: o.occurrence, effectId: o.effectId });
      if (!applyOutcome(o) && !this.pendingOutcomes.has(key2) && this.pendingOutcomes.size < 64)
        this.pendingOutcomes.set(key2, o);
    }
    for (const id of this.eligible) {
      const e = this.evaluations.get(id), b = this.assessments.get(id);
      if (!this.domains.has(e.occurrence.revisionDomain)) continue;
      if ((!b.flagged || this.effects.get(id)?.admission || !this.materials.has(id)) && !this.issuedPolicy.has(id)) {
        this.issuedPolicy.add(id);
        this.terminal(id, "publication-policy");
      }
      const retain = (v) => {
        const key2 = oracleCanonical([v.occurrence, v.evidenceKind, v.evidenceId]);
        if (!this.evidenceRecords.has(key2) && this.evidenceRecords.size < 512)
          this.evidenceRecords.set(key2, v);
      };
      for (const [kind, value2] of [
        ["spending-input", e.inputDigest],
        [
          "spending-code-binding",
          digest4({
            sourceDigest: this.binding.sourceDigest,
            runtimeDigest: this.binding.runtimeDigest
          })
        ]
      ])
        retain({
          occurrence: e.occurrence,
          evidenceKind: kind,
          evidenceId: `${id}:${kind}`,
          evidenceDigest: value2,
          coverage: "included",
          refs: [this.binding.runRef]
        });
      const request = b.flagged ? this.materials.get(id)?.body.payloadDigest : digest4({ kind: "no-publish", evaluationRef: id });
      for (const receipt3 of this.evidenceReceipts.values())
        if (equal(receipt3.occurrence, e.occurrence)) {
          const stale = receipt3.sourceDigest !== this.binding.sourceDigest || receipt3.runtimeDigest !== this.binding.runtimeDigest || receipt3.inputDigest !== e.inputDigest || receipt3.policyDigest !== e.policyDigest || receipt3.verifierRevision !== "spending-oracle-v2" || receipt3.numericDomainRef !== "spending-finite-v1" || request !== void 0 && receipt3.requestDigest !== request;
          retain({
            occurrence: e.occurrence,
            evidenceKind: "spending-verification",
            evidenceId: digest4(receipt3.receiptRef),
            evidenceDigest: digest4(receipt3),
            coverage: stale ? "stale" : receipt3.verdict === "unavailable" || request === void 0 ? "unavailable" : "included",
            refs: [receipt3.artifactRef.id]
          });
        }
    }
  }
  evidenceSnapshot() {
    return [...this.evidenceRecords.values()].filter((v) => {
      const domain = this.identity.get(v.occurrence.revisionDomain);
      return domain && equal(domain.get(v.occurrence.revision)?.occurrence ?? null, v.occurrence) && [...domain.keys()].filter((n) => n <= v.occurrence.revision).length === v.occurrence.revision;
    });
  }
  obligationSnapshot() {
    const evidence = this.evidenceSnapshot();
    return [...this.watermarks].map(([domain, through]) => {
      const rows = [...this.identity.get(domain)?.values() ?? []].filter(
        (e) => e.occurrence.revision <= through
      );
      const sequence = rows.length === through && rows.every((e) => this.occurrenceAdmissions.has(e.evaluationRef));
      const lifecycle = sequence && ![...this.pendingTerminals.values()].some((t) => {
        const ref4 = this.evaluations.get(t.id).occurrence;
        return ref4.revisionDomain === domain && ref4.revision <= through;
      }) && ![...this.pendingOutcomes.values()].some(
        (o) => o.occurrence.revisionDomain === domain && o.occurrence.revision <= through
      ) && rows.every((e) => {
        const effect = this.effects.get(e.evaluationRef);
        return this.released.has(e.evaluationRef) && this.branches.get(e.evaluationRef)?.size === 3 && (!effect || effect.admission?.state === "rejected" || !!effect.outcome);
      });
      const retainedEvidence = lifecycle && rows.every(
        (e) => ["spending-input", "spending-code-binding", "spending-verification"].every(
          (kind) => evidence.some((v) => equal(v.occurrence, e.occurrence) && v.evidenceKind === kind)
        )
      );
      return {
        revisionDomain: domain,
        evaluatedThroughRevision: through,
        lifecycle,
        retainedEvidence
      };
    });
  }
  invalidate(lane2) {
    if (lane2 === "pack" || lane2 === "arrivals") this.eligible.clear();
    if (lane2 === "pack") this.pack = void 0;
    else if (lane2 === "arrivals") this.pending.length = 0;
    else delete this.facts[lane2];
  }
  snapshot() {
    return [...this.effects].filter(([id]) => this.released.has(id)).map(([, e]) => ({
      proposal: e.proposal,
      admission: e.admission ?? null,
      outcome: e.outcome ?? null
    }));
  }
};

// scripts/fixtures/spending-publication-reference.ts
function buildReferencePublication(graph, scope, startup, prepared, binding3, material, inputProfile) {
  const profile4 = oracleProfile(inputProfile);
  scope.assertContext(graph, startup, profile4.compositionEpoch);
  if (profile4.compositionEpoch !== binding3.epoch) throw TypeError("publication context mismatch");
  const causal = buildCausalNodes(graph, scope, startup, prepared, binding3);
  const expectedId = `${prepared.options.name}/authority`, expectedBinding = oracleCanonical(binding3);
  const join3 = scope.node(
    [causal.committedEffects, material],
    (ctx) => {
      if (ctx.waveData.length !== 2 || join3.deps[0] !== causal.committedEffects || join3.deps[1] !== material) {
        ctx.down([["ERROR", new TypeError("publication dependency mismatch")]]);
        return;
      }
      let memory = ctx.state.get();
      if (!memory) {
        memory = {};
        ctx.state.set(memory);
      }
      const current2 = depLatest(ctx, 1), delivered = (depBatch(ctx, 1)?.length ?? 0) > 0;
      if (current2 === void 0 && !delivered) {
        memory.input = void 0;
        memory.index = void 0;
        return;
      }
      if (memory.index === void 0 || memory.input !== current2 || delivered && !memory.index.cacheable) {
        memory.index = verifyPublicationMaterial(current2, profile4);
        memory.input = current2;
      }
      const view = depLatest(ctx, 0);
      if (!view) return;
      if (view.kind !== "causal-committed-effects" || view.authorityId !== expectedId || oracleCanonical(view.binding) !== expectedBinding) {
        ctx.down([["ERROR", new TypeError("publication authority binding")]]);
        return;
      }
      ctx.down([["DATA", Object.freeze({ view, index: memory.index })]]);
    },
    {
      name: "requestMaterialJoin",
      factory: "spendingRequestMaterialJoin",
      errorWhenDepsError: true
    }
  );
  const publication = scope.node(
    [join3],
    (ctx) => {
      for (const input of depBatch(ctx, 0) ?? []) {
        const value2 = input;
        const result = oraclePublication(value2.view, value2.index, profile4);
        ctx.down([["DATA", result]]);
      }
    },
    { name: "publication", factory: "spendingPublication", errorWhenDepsError: true }
  );
  return Object.freeze({ causal, requestMaterialJoin: join3, publication });
}

// scripts/fixtures/spending-preset-reference.ts
function freeze2(value2) {
  if (value2 !== null && typeof value2 === "object" && !Object.isFrozen(value2)) {
    Object.values(value2).forEach(freeze2);
    Object.freeze(value2);
  }
  return value2;
}
var digest5 = (x) => oracleHash(oracleCanonical(x));
var equal2 = (a, b) => oracleCanonical(a) === oracleCanonical(b);
var issue3 = (code, subjectId) => freeze2({
  kind: "issue",
  code: `spending/${code}`,
  message: code,
  ...subjectId ? { subjectId } : {}
});
var frame2 = (rows, issues = [], valid = true) => freeze2({ rows, issues, valid });
var key = (e) => oracleCanonical(e.occurrence);
function map2(make, name, input, fn) {
  return make(name, [input], (ctx) => {
    for (const f of depWaves(ctx, 0).flat()) {
      if (f === SENTINEL) {
        ctx.down([["DATA", frame2([], [], false)]]);
        continue;
      }
      const data = f;
      ctx.down([
        [
          "DATA",
          frame2(
            data.rows.map((r) => ({ evaluation: r.evaluation, value: fn(r.value, r.evaluation) })),
            data.issues,
            data.valid
          )
        ]
      ]);
    }
  });
}
function join2(make, name, deps, fn) {
  return make(name, deps, (ctx) => {
    const state = ctx.state.get() ?? {
      maps: deps.map(() => /* @__PURE__ */ new Map()),
      valid: deps.map(() => false)
    };
    const touched = /* @__PURE__ */ new Set(), problems = [];
    for (let i = 0; i < deps.length; i++) {
      if (depLatest(ctx, i) === void 0) {
        state.maps[i].clear();
        state.valid[i] = false;
      }
      for (const raw2 of depWaves(ctx, i).flat()) {
        if (raw2 === SENTINEL) {
          state.maps[i].clear();
          state.valid[i] = false;
          continue;
        }
        const f = raw2;
        state.valid[i] = f.valid;
        problems.push(...f.issues);
        if (!f.valid) {
          state.maps[i].clear();
          continue;
        }
        for (const row of f.rows) {
          const k = key(row.evaluation);
          if (!state.maps[i].has(k) && state.maps[i].size >= 64) {
            problems.push(issue3("join-capacity"));
            continue;
          }
          state.maps[i].set(k, row);
          touched.add(k);
        }
      }
    }
    ctx.state.set(state);
    const ready = state.valid.every(Boolean), rows = [];
    if (ready)
      for (const k of touched) {
        const rs = state.maps.map((m) => m.get(k));
        if (rs.some((r) => !r)) continue;
        rows.push({
          evaluation: rs[0].evaluation,
          value: fn(
            rs.map((r) => r.value),
            rs[0].evaluation
          )
        });
      }
    ctx.down([["DATA", frame2(rows, problems, ready)]]);
  });
}
function checked2(make, name, input, lane2, binding3) {
  return make(name, [input], (ctx) => {
    const state = ctx.state.get() ?? {
      receipts: /* @__PURE__ */ new Map(),
      conflicts: /* @__PURE__ */ new Set()
    };
    for (const raw2 of depWaves(ctx, 0).flat()) {
      let result;
      try {
        if (raw2 === SENTINEL) throw Error(`invalidated-${lane2}`);
        const value2 = referenceInput(lane2, raw2, binding3);
        if (lane2 === "verification")
          for (const v of value2.receipts) {
            const id = oracleCanonical(v.receiptRef), text3 = oracleCanonical(v), before = state.receipts.get(id);
            if (before !== void 0 && before !== text3) state.conflicts.add(id);
            if (state.conflicts.has(id)) throw Error("receipt-identity-conflict");
            if (before === void 0 && state.receipts.size === 64)
              throw Error("receipt-lifetime-capacity");
            state.receipts.set(id, text3);
          }
        result = { valid: true, value: value2 };
      } catch (error) {
        result = {
          valid: false,
          issue: issue3(
            error instanceof Error && (error.message.startsWith("receipt-") || error.message.startsWith("invalidated-")) ? error.message : `invalid-${lane2}`
          )
        };
      }
      ctx.state.set(state);
      ctx.down([["DATA", freeze2(result)]]);
    }
  });
}
var available = (ctx, index) => {
  const f = depLatest(ctx, index);
  return f?.valid ? f.value : void 0;
};
var proposal = (material) => ({
  occurrence: material.body.occurrence,
  effectId: material.body.effectId,
  requestRef: material.requestRef,
  proposalDigest: material.proposalDigest
});
var REFERENCE_BUSINESS_NAMES = [
  "selection",
  "transaction",
  "moments",
  "profile",
  "policy",
  "current",
  "verification",
  "local",
  "inbox",
  "score",
  "gate",
  "reason",
  "message",
  "assessment",
  "material",
  "store",
  "snapshot",
  "proposals",
  "permission",
  "occurrences",
  "occurrenceAdmissions",
  "terminals",
  "effectAdmissions",
  "outcomes",
  "evidence",
  "watermarks",
  "issues"
];
function buildReferencePreset(graph, scope, startup, inputs, rawBinding, diagnostics) {
  const binding3 = referenceBinding(rawBinding);
  if (diagnostics !== "off" && diagnostics !== "summary")
    throw new TypeError("reference diagnostics");
  const shape2 = (value2, keys3) => {
    if (!value2 || Object.keys(value2).sort().join() !== keys3.sort().join())
      throw new TypeError("reference input groups");
  };
  shape2(inputs, ["evaluations", "verification", "localAuthority", "inbox"]);
  shape2(inputs.evaluations, ["pack", "arrivals", "current"]);
  shape2(inputs.verification, ["receipts"]);
  shape2(inputs.localAuthority, ["facts"]);
  shape2(inputs.inbox, ["facts"]);
  const inputNodes = [
    inputs.evaluations.pack,
    inputs.evaluations.arrivals,
    inputs.evaluations.current,
    inputs.verification.receipts,
    inputs.localAuthority.facts,
    inputs.inbox.facts
  ];
  if (inputNodes.some((n) => !n) || new Set(inputNodes).size !== 6)
    throw new TypeError("reference distinct inputs");
  scope.assertContext(graph, startup, binding3.compositionEpoch);
  const nodes = /* @__PURE__ */ new Map();
  const edges = /* @__PURE__ */ new Map();
  const make = (name, deps, fn) => {
    const expected = [...deps];
    const node = scope.node(
      deps,
      (ctx) => {
        if (node.deps.length !== expected.length || node.deps.some((d, i) => d !== expected[i])) {
          ctx.down([["ERROR", Error(`reference dependency ${name}`)]]);
          return;
        }
        fn(ctx);
      },
      {
        name: `spending/reference/${name}`,
        factory: `spendingReference/${name}`,
        partial: true,
        errorWhenDepsError: true
      }
    );
    nodes.set(name, node);
    edges.set(node, expected);
    return node;
  };
  const selection = make(
    "selection",
    [inputs.evaluations.pack, inputs.evaluations.arrivals],
    (ctx) => {
      const s = ctx.state.get() ?? { available: false, waiting: [] };
      const errors = [];
      if (depLatest(ctx, 0) === void 0) s.available = false;
      for (const v of depWaves(ctx, 0).flat())
        try {
          const pack = referenceInput("pack", v, binding3), bytes = oracleCanonical(pack, 4 * 1048576);
          if (s.bytes !== void 0 && s.bytes !== bytes) throw Error("pack-conflict");
          s.pack = pack;
          s.bytes = bytes;
          s.available = true;
        } catch (e) {
          s.available = false;
          errors.push(
            issue3(
              e instanceof Error && e.message === "pack-conflict" ? "pack-conflict" : "invalid-pack"
            )
          );
        }
      const drain2 = () => {
        if (!s.available || !s.pack) return;
        const rows = [];
        for (const id of s.waiting.splice(0)) {
          const e = s.pack.evaluations.find((x) => x.evaluationRef === id);
          if (e) rows.push({ evaluation: e, value: e });
          else errors.push(issue3("unknown-evaluation", id));
        }
        if (rows.length || errors.length) ctx.down([["DATA", frame2(rows, errors.splice(0))]]);
      };
      drain2();
      for (const v of depWaves(ctx, 1).flat()) {
        try {
          const arrivals = referenceInput("arrivals", v, binding3);
          for (const id of arrivals.evaluationRefs) {
            if (s.waiting.length === 64) {
              errors.push(issue3("arrival-capacity", id));
              break;
            }
            s.waiting.push(id);
          }
          drain2();
        } catch {
          s.waiting = [];
          errors.push(issue3("invalid-arrivals"));
          ctx.down([["DATA", frame2([], errors.splice(0), false)]]);
        }
      }
      ctx.state.set(s);
      if (errors.length) ctx.down([["DATA", frame2([], errors, false)]]);
    }
  );
  const transaction3 = map2(make, "transaction", selection, (e) => e.prefix[e.prefix.length - 1]);
  const moments = map2(
    make,
    "moments",
    selection,
    (e) => plainMoments(e.prefix.map((t) => t.amount))
  );
  const profile4 = map2(make, "profile", selection, (e) => e.profile), policy3 = map2(make, "policy", selection, (e) => e.policy);
  const score = join2(make, "score", [transaction3, moments, profile4], ([txn, stats, p]) => ({
    zScore: plainScore(stats),
    dailyRatio: txn.amount / Math.max(p.dailyAverage, 1),
    categoryFamiliarity: p.typicalCategories.includes(txn.category) ? "known" : "unknown",
    txn
  }));
  const gate = join2(make, "gate", [score, policy3], ([score2, p]) => ({
    score: score2,
    txn: score2.txn,
    threshold: p.zThreshold,
    flagged: score2.zScore > p.zThreshold || score2.dailyRatio > p.dailyRatioThreshold || score2.categoryFamiliarity === "unknown"
  }));
  const reason = join2(make, "reason", [gate, policy3], ([g, p]) => {
    const factors = [];
    if (g.flagged) {
      if (g.score.zScore > p.zThreshold)
        factors.push(
          `Amount is ${g.score.zScore.toFixed(2)}\u03C3 above this vendor's historical mean.`
        );
      if (g.score.dailyRatio > p.dailyRatioThreshold)
        factors.push(`Amount is ${g.score.dailyRatio.toFixed(1)}\xD7 the user's daily average.`);
      if (g.score.categoryFamiliarity === "unknown")
        factors.push("Category is outside the user's typical spend profile.");
    }
    return {
      factors,
      severity: factors.length > 2 ? "high" : factors.length === 2 ? "medium" : "low",
      txn: g.txn
    };
  });
  const message = map2(make, "message", reason, (r) => ({
    severity: r.severity,
    message: r.factors.length ? `Transaction ${r.txn.id} flagged \u2014 severity: ${r.severity}.
Vendor: ${r.txn.vendor}  Amount: $${r.txn.amount.toFixed(2)}  Category: ${r.txn.category}
Reasoning:
${r.factors.map((f) => `  \u2022 ${f}`).join("\n")}` : `Transaction ${r.txn.id} ($${r.txn.amount.toFixed(2)} at ${r.txn.vendor}) \u2014 normal.`
  }));
  const assessment = join2(
    make,
    "assessment",
    [gate, reason, message],
    ([g, r, m], e) => ({
      kind: "spending-alerts/assessment",
      evidenceMode: "fixture-observations",
      binding: binding3,
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
  const current2 = checked2(
    make,
    "current",
    inputs.evaluations.current,
    "current",
    binding3
  ), verification = checked2(
    make,
    "verification",
    inputs.verification.receipts,
    "verification",
    binding3
  ), local = checked2(
    make,
    "local",
    inputs.localAuthority.facts,
    "local",
    binding3
  ), inbox = checked2(make, "inbox", inputs.inbox.facts, "inbox", binding3);
  const { runRef: _run, evidenceMode: _mode, ...materialProfile2 } = binding3;
  const material = join2(
    make,
    "material",
    [selection, gate, message],
    ([, g, m], e) => {
      if (!g.flagged) return { kind: "normal" };
      try {
        const payloadText = oracleCanonical({
          transactionId: g.txn.id,
          vendor: g.txn.vendor,
          severity: m.severity,
          message: m.message
        });
        if (Buffer.byteLength(payloadText) + 1 > 4096) throw Error();
        return {
          kind: "retained",
          material: oracleMaterial({
            schema: "spending-alerts/request-material/v1",
            occurrence: e.occurrence,
            effectId: `alert:${e.evaluationRef}`,
            inputDigest: e.inputDigest,
            policyDigest: e.policyDigest,
            payloadText,
            payloadDigest: oracleHash(payloadText),
            sourceDigest: binding3.sourceDigest,
            runtimeDigest: binding3.runtimeDigest,
            destinationRef: binding3.destinationRef,
            compositionEpoch: binding3.compositionEpoch,
            hostEpoch: binding3.hostEpoch
          })
        };
      } catch {
        return { kind: "rejected", issue: issue3("material-format-or-capacity", e.evaluationRef) };
      }
    }
  );
  const store = make("store", [material], (ctx) => {
    const s = ctx.state.get() ?? { materials: /* @__PURE__ */ new Map(), snapshot: oracleSnapshot(materialProfile2, []) };
    for (const raw2 of depBatch(ctx, 0) ?? []) {
      const f = raw2, rows = [], errors = [...f.issues];
      for (const row of f.rows) {
        let result = row.value;
        if (result.kind === "retained") {
          const id = key(row.evaluation), prior = s.materials.get(id);
          let failure;
          if (prior) {
            if (!equal2(prior, result.material)) failure = "material-conflict";
            else result = { kind: "retained", material: prior };
          } else if (s.materials.size >= 64) failure = "material-count-capacity";
          else
            try {
              const next = oracleSnapshot(materialProfile2, [
                ...s.materials.values(),
                result.material
              ]);
              if (Buffer.byteLength(oracleCanonical(next)) > 1048576) throw Error();
              s.materials.set(id, result.material);
              s.snapshot = next;
            } catch {
              failure = "material-byte-capacity";
            }
          if (failure)
            result = { kind: "rejected", issue: issue3(failure, row.evaluation.evaluationRef) };
        }
        if (result.kind === "rejected") errors.push(result.issue);
        rows.push({ evaluation: row.evaluation, value: result });
      }
      ctx.state.set(s);
      ctx.down([["DATA", freeze2({ ...frame2(rows, errors, f.valid), snapshot: s.snapshot })]]);
    }
  });
  const snapshot = make("snapshot", [store], (ctx) => {
    for (const f of depBatch(ctx, 0) ?? []) ctx.down([["DATA", f.snapshot]]);
  });
  const proposals = make("proposals", [store], (ctx) => {
    const out = [];
    for (const f of depBatch(ctx, 0) ?? [])
      if (f.valid) {
        for (const r of f.rows)
          if (r.value.kind === "retained") out.push(["DATA", proposal(r.value.material)]);
      }
    if (out.length) ctx.down(out);
  });
  const permission = make(
    "permission",
    [selection, gate, store, current2, verification, local, inbox],
    (ctx) => {
      const s = collect2(ctx, 3);
      s.issued ??= /* @__PURE__ */ new Map();
      const rows = [], errors = [];
      if (!s.valid.every(Boolean)) {
        ctx.down([["DATA", frame2([], [], false)]]);
        return;
      }
      const c = available(ctx, 3), v = available(ctx, 4), l = available(ctx, 5), i = available(ctx, 6);
      for (const [id, row] of s.maps[0]) {
        if (s.issued.has(id)) continue;
        const e = row.evaluation, g = s.maps[1].get(id)?.value, m = s.maps[2].get(id)?.value;
        if (!g || !m) continue;
        let why = "no-publish", failed = false, admission;
        if (g.flagged) {
          if (m.kind === "rejected") {
            failed = true;
            why = m.issue.code;
          } else if (m.kind !== "retained") continue;
          else {
            const p = proposal(m.material), rd = m.material.body.payloadDigest;
            if (!v) {
              errors.push(issue3("policy-input-pending", e.evaluationRef));
              continue;
            }
            const receipts = v.receipts.filter(
              (x) => equal2(x.occurrence, e.occurrence) && x.inputDigest === e.inputDigest && x.policyDigest === e.policyDigest && x.sourceDigest === binding3.sourceDigest && x.runtimeDigest === binding3.runtimeDigest && x.requestDigest === rd && x.verifierRevision === "spending-oracle-v2" && x.numericDomainRef === "spending-finite-v1"
            );
            if (receipts.length !== 1 || receipts[0].verdict === "unavailable") {
              errors.push(issue3("verification-pending-or-conflict", e.evaluationRef));
              continue;
            }
            const receipt3 = receipts[0];
            if (receipt3.verdict === "fail") {
              failed = true;
              why = "verification-rejected";
              admission = {
                ...p,
                state: "rejected",
                admissionRef: {
                  kind: "spending-admission",
                  id: digest5({
                    proposal: p,
                    receiptRef: receipt3.receiptRef,
                    verdict: "fail",
                    binding: binding3
                  })
                }
              };
            } else {
              if (!c || !l || !i) {
                errors.push(issue3("policy-input-pending", e.evaluationRef));
                continue;
              }
              const current3 = c.current.find((x) => equal2(x.occurrence, e.occurrence));
              if (!current3 || !equal2(current3.policyRef, e.policyRef) || current3.policyDigest !== e.policyDigest || current3.watermark < e.occurrence.revision) {
                errors.push(issue3("policy-current-mismatch", e.evaluationRef));
                continue;
              }
              const grants = l.grants.filter(
                (x) => equal2(x.occurrence, e.occurrence) && x.requestDigest === rd && equal2(x.destinationRef, binding3.destinationRef) && x.hostEpoch === binding3.hostEpoch && x.replayScope.hostEpoch === binding3.hostEpoch && x.replayScope.compositionEpoch === binding3.compositionEpoch
              );
              if (grants.length !== 1) {
                errors.push(issue3("grant-pending-or-conflict", e.evaluationRef));
                continue;
              }
              const grant3 = grants[0];
              failed = grant3.revoked || l.stop || l.tick < grant3.validFrom || l.tick > grant3.validThrough;
              if (!failed && (!i.readiness.ready || i.readiness.availableSlots !== 1 || l.tick < i.readiness.observedAt || l.tick > i.readiness.validThrough)) {
                errors.push(issue3("inbox-not-ready", e.evaluationRef));
                continue;
              }
              why = failed ? "publication-rejected" : "fixture-admission";
              admission = {
                ...p,
                state: failed ? "rejected" : "admitted",
                admissionRef: {
                  kind: "spending-admission",
                  id: digest5({
                    proposal: p,
                    receiptRef: receipt3.receiptRef,
                    grantRef: grant3.grantRef,
                    binding: binding3
                  })
                }
              };
            }
          }
        }
        const terminal = {
          occurrence: e.occurrence,
          branch: "publication-policy",
          state: failed ? "failed" : "completed",
          result: failed ? { kind: "error", error: issue3(why, e.evaluationRef) } : { kind: "ok", value: { reason: why, evidenceMode: "fixture-observations" } }
        };
        const value2 = freeze2({ terminal, ...admission ? { admission } : {} });
        s.issued.set(id, value2);
        rows.push({ evaluation: e, value: value2 });
      }
      ctx.state.set(s);
      if (rows.length || errors.length) ctx.down([["DATA", frame2(rows, errors)]]);
    }
  );
  const occurrences = make("occurrences", [selection], (ctx) => {
    const out = [];
    for (const f of depBatch(ctx, 0) ?? [])
      if (f.valid)
        for (const row of f.rows) {
          const { occurrence: occurrence4, ...value2 } = row.evaluation;
          out.push(["DATA", { ...occurrence4, value: value2 }]);
        }
    if (out.length) ctx.down(out);
  });
  const occurrenceAdmissions = make(
    "occurrenceAdmissions",
    [selection, current2],
    (ctx) => {
      const s = collect2(ctx, 1), out = [];
      if (!s.valid[0]) return;
      for (const checked3 of depBatch(ctx, 1) ?? [depLatest(ctx, 1)])
        if (checked3?.valid)
          for (const row of s.maps[0].values()) {
            const e = row.evaluation;
            if (checked3.value.current.some(
              (c) => equal2(c.occurrence, e.occurrence) && equal2(c.policyRef, e.policyRef) && c.policyDigest === e.policyDigest
            ))
              out.push([
                "DATA",
                {
                  occurrence: e.occurrence,
                  decisionId: `evaluation:${e.evaluationRef}`,
                  decisionDigest: digest5({ occurrence: e.occurrence, inputDigest: e.inputDigest }),
                  state: "admitted"
                }
              ]);
          }
      if (out.length) ctx.down(out);
    }
  );
  const terminals = make(
    "terminals",
    [assessment, message, permission],
    (ctx) => {
      const out = [];
      for (let branch = 0; branch < 3; branch++)
        for (const f of depBatch(ctx, branch) ?? [])
          if (f.valid)
            for (const row of f.rows)
              out.push([
                "DATA",
                branch === 2 ? row.value.terminal : {
                  occurrence: row.evaluation.occurrence,
                  branch: branch === 0 ? "assessment" : "explanation",
                  state: "completed",
                  result: { kind: "ok", value: row.value }
                }
              ]);
      if (out.length) ctx.down(out);
    }
  );
  const effectAdmissions = make("effectAdmissions", [permission], (ctx) => {
    const out = [];
    for (const f of depBatch(ctx, 0) ?? [])
      if (f.valid) {
        for (const r of f.rows) if (r.value.admission) out.push(["DATA", r.value.admission]);
      }
    if (out.length) ctx.down(out);
  });
  const outcomes = make("outcomes", [inbox], (ctx) => {
    const out = [];
    for (const f of depBatch(ctx, 0) ?? [])
      if (f.valid) for (const o of f.value.outcomes) out.push(["DATA", o]);
    if (out.length) ctx.down(out);
  });
  const evidence = make("evidence", [selection, store, verification], (ctx) => {
    const s = collect2(ctx, 2);
    s.receipts ??= /* @__PURE__ */ new Map();
    for (const f of depBatch(ctx, 2) ?? [depLatest(ctx, 2)])
      if (f?.valid)
        for (const r of f.value.receipts) {
          const id = digest5(r.receiptRef);
          if (!s.receipts.has(id) && s.receipts.size < 64) s.receipts.set(id, r);
        }
    if (!s.valid[0]) return;
    const out = [];
    for (const row of s.maps[0].values()) {
      const e = row.evaluation;
      for (const [kind, d] of [
        ["spending-input", e.inputDigest],
        [
          "spending-code-binding",
          digest5({ sourceDigest: binding3.sourceDigest, runtimeDigest: binding3.runtimeDigest })
        ]
      ])
        out.push([
          "DATA",
          {
            occurrence: e.occurrence,
            evidenceKind: kind,
            evidenceId: `${e.evaluationRef}:${kind}`,
            evidenceDigest: d,
            coverage: "included",
            refs: [binding3.runRef]
          }
        ]);
      const m = s.valid[1] ? s.maps[1].get(key(e))?.value : void 0;
      if (!m) continue;
      const rd = m.kind === "retained" ? m.material.body.payloadDigest : m.kind === "normal" ? digest5({ kind: "no-publish", evaluationRef: e.evaluationRef }) : void 0;
      for (const v of s.receipts.values())
        if (equal2(v.occurrence, e.occurrence)) {
          const stale = v.sourceDigest !== binding3.sourceDigest || v.runtimeDigest !== binding3.runtimeDigest || v.inputDigest !== e.inputDigest || v.policyDigest !== e.policyDigest || v.verifierRevision !== "spending-oracle-v2" || v.numericDomainRef !== "spending-finite-v1" || rd !== void 0 && v.requestDigest !== rd;
          out.push([
            "DATA",
            {
              occurrence: e.occurrence,
              evidenceKind: "spending-verification",
              evidenceId: digest5(v.receiptRef),
              evidenceDigest: digest5(v),
              coverage: stale ? "stale" : v.verdict === "unavailable" || rd === void 0 ? "unavailable" : "included",
              refs: [v.artifactRef.id]
            }
          ]);
        }
    }
    ctx.state.set(s);
    if (out.length) ctx.down(out);
  });
  const watermarks = make("watermarks", [current2], (ctx) => {
    const out = [];
    for (const f of depBatch(ctx, 0) ?? [])
      if (f.valid)
        for (const c of f.value.current)
          out.push(["DATA", { revisionDomain: c.revisionDomain, revision: c.watermark }]);
    if (out.length) ctx.down(out);
  });
  const publication = buildReferencePublication(
    graph,
    scope,
    startup,
    prepareCausalOptions({
      name: "spending/causal",
      occurrences,
      admissions: occurrenceAdmissions,
      branchTerminals: terminals,
      effectProposals: proposals,
      effectAdmissions,
      effectOutcomes: outcomes,
      evidence,
      watermarks,
      requiredBranches: ["assessment", "explanation", "publication-policy"],
      requiredEvidenceKinds: ["spending-input", "spending-code-binding", "spending-verification"],
      maxOccurrences: 64,
      maxPending: 64,
      maxEffects: 64,
      maxEvidence: 512
    }),
    {
      contract: "contract-v2",
      implementationRevision: "construction-v1",
      scope: "full",
      epoch: binding3.compositionEpoch
    },
    snapshot,
    materialProfile2
  );
  const issues = make(
    "issues",
    [
      selection,
      current2,
      verification,
      local,
      inbox,
      material,
      store,
      permission,
      publication.causal.ports.issues
    ],
    (ctx) => {
      for (let i = 0; i < 9; i++)
        for (const raw2 of depBatch(ctx, i) ?? []) {
          const f = raw2;
          if (f.kind === "issue") ctx.down([["DATA", f]]);
          else {
            if (f.issue) ctx.down([["DATA", f.issue]]);
            for (const x of f.issues ?? []) ctx.down([["DATA", x]]);
          }
        }
    }
  );
  const view = Object.freeze({
    assessment,
    publication: publication.publication,
    coverage: publication.causal.ports.coverage,
    issues,
    startup
  });
  const summary = diagnostics === "summary" ? make(
    "summary",
    Object.values(view).slice(0, 4),
    (ctx) => ctx.down([
      [
        "DATA",
        freeze2({
          kind: "spending-diagnostic-summary",
          arrivals: ctx.waveData.map((_, i) => depBatch(ctx, i)?.length ?? 0)
        })
      ]
    ])
  ) : void 0;
  for (const [node, deps] of edges)
    if (node.deps.length !== deps.length || node.deps.some((dep, i) => dep !== deps[i]))
      throw new TypeError("reference cold topology mismatch");
  assertCausalOccurrenceTopology(scope.readIncoming(), "spending/causal");
  return {
    view,
    capabilities: publication.causal.full,
    roots: publication.causal.roots,
    summary,
    nodes,
    store,
    snapshot,
    publication
  };
}
function collect2(ctx, count) {
  const s = ctx.state.get() ?? {
    maps: Array.from({ length: count }, () => /* @__PURE__ */ new Map()),
    valid: Array(count).fill(false)
  };
  for (let i = 0; i < count; i++) {
    if (depLatest(ctx, i) === void 0) {
      s.maps[i].clear();
      s.valid[i] = false;
    }
    for (const raw2 of depWaves(ctx, i).flat()) {
      if (raw2 === SENTINEL) {
        s.maps[i].clear();
        s.valid[i] = false;
        continue;
      }
      const f = raw2;
      s.valid[i] = f.valid;
      if (!f.valid) {
        s.maps[i].clear();
        continue;
      }
      for (const row of f.rows) {
        const id = key(row.evaluation);
        if (s.maps[i].has(id) || s.maps[i].size < 64) s.maps[i].set(id, row);
      }
    }
  }
  ctx.state.set(s);
  return s;
}

// scripts/fixtures/spending-preset-performance.ts
var RECIPE = Object.freeze({
  revision: "spending-preset-performance-v1",
  coldRows: 12,
  steadyRows: 60,
  recoveryRows: 12,
  warmup: 100,
  measured: 300,
  orders: [
    ["candidate", "reference"],
    ["reference", "candidate"],
    ["candidate", "reference"]
  ],
  coldLimit: 1.2,
  steadyLimit: 1.1,
  recoveryCycles: 20,
  // A failed row rejects qualification. Other rows stay explicitly not-run; no automatic retry.
  stopAfterFailedRow: true,
  childTimeoutMs: 9e5,
  totalTimeoutMs: 72e5,
  freshBasis: "distinct evaluation identities absent before the whole wave",
  doubleData: "two exact copies of the same arrival frame in one source.down; second copy is intra-wave replay",
  memory: "raw process heap/RSS before and after action; GC may make deltas negative, not retained-size proof"
});
function matrixRows() {
  const rows = [];
  for (const profile4 of ["P1", "P2", "P3", "P4", "P5", "P6"])
    for (const mode of ["off", "summary"])
      rows.push({ id: `cold-${profile4}-${mode}`, group: "cold", profile: profile4, mode });
  for (const profile4 of ["P1", "P2", "P3", "P4", "P5", "P6"])
    for (const mode of ["off", "summary"])
      for (const change of [
        "duplicate",
        "all-new",
        ...["P3", "P5", "P6"].includes(profile4) ? ["one-new"] : []
      ])
        for (const dataCount of [1, 2])
          rows.push({
            id: `steady-${profile4}-${mode}-${change}-${dataCount}`,
            group: "steady",
            profile: profile4,
            mode,
            change,
            dataCount
          });
  for (const profile4 of ["P1", "P2", "P3", "P4", "P5", "P6"])
    for (const mode of ["off", "summary"])
      rows.push({ id: `recovery-${profile4}-${mode}`, group: "recovery", profile: profile4, mode });
  return rows;
}
function graphArm(arm, mode) {
  const graph = new Graph({ name: "spending-performance", profile: true });
  const sources = Object.fromEntries(
    ["pack", "arrivals", "current", "verification", "local", "inbox"].map((name) => [
      name,
      graph.node([], null, { name })
    ])
  );
  const inputs = {
    evaluations: { pack: sources.pack, arrivals: sources.arrivals, current: sources.current },
    verification: { receipts: sources.verification },
    localAuthority: { facts: sources.local },
    inbox: { facts: sources.inbox }
  };
  const names = arm === "candidate" ? spendingNodeNames("spending", mode) : [
    "spending/startup",
    ...REFERENCE_BUSINESS_NAMES.map((n) => `spending/reference/${n}`),
    ...causalColdNodeNames("spending/causal"),
    "requestMaterialJoin",
    "publication",
    ...mode === "summary" ? ["spending/reference/summary"] : []
  ];
  const scope = prepareConstruction(graph, {
    name: "spending",
    epoch: presetBinding.compositionEpoch,
    names,
    inputs: Object.values(sources)
  }), startup = scope.startupSource();
  let view, conservation, summary, roots;
  try {
    if (arm === "candidate") {
      const built = buildSpendingPresetNodes(
        graph,
        scope,
        startup,
        inputs,
        presetBinding,
        "spending",
        mode
      );
      view = built.consume.view;
      conservation = built.consume.capabilities.execution.conservation;
      summary = built.diagnosticSummary;
      roots = built.roots;
    } else {
      const built = buildReferencePreset(graph, scope, startup, inputs, presetBinding, mode);
      view = built.view;
      conservation = built.capabilities.execution.conservation;
      summary = built.summary;
      roots = built.roots;
    }
  } catch (e) {
    return scope.abort(e);
  }
  const owner = scope.seal(startup, roots);
  scope.transferToGraph(owner);
  startConstruction(graph, owner);
  const latest2 = {}, counts = {};
  const observed = [
    ...Object.entries(view),
    ["conservation", conservation],
    ...summary ? [["summary", summary]] : []
  ];
  let stops = [];
  function connect() {
    if (stops.length) return;
    for (const [name, node] of observed)
      stops.push(
        node.subscribe((m) => {
          if (m[0] === "DATA") {
            latest2[name] = m[1];
            counts[name] = (counts[name] ?? 0) + 1;
          }
        })
      );
  }
  function disconnect() {
    for (const stop of stops) stop();
    stops = [];
  }
  connect();
  return {
    graph,
    owner,
    sources,
    latest: latest2,
    counts,
    connect,
    disconnect,
    send: (step) => sources[step.lane].down(step.values.map((v) => ["DATA", v])),
    state: () => checkpointStateOfNode(graph.find("spending/causal/authority")).ctxState?.value,
    cleanup: () => {
      disconnect();
      for (const root of owner.roots) root.unsubscribe?.();
      const group = graph.topologyGroup();
      for (const n of graph.describe().nodes) group.add(graph.find(n.id));
      group.release();
    }
  };
}
function measurementArm(arm, mode) {
  if (arm !== "plain") return graphArm(arm, mode);
  const plain = new PlainSpending(presetBinding);
  return {
    plain,
    send: (step) => {
      for (const value2 of step.values) plain.push(step.lane, value2);
    },
    connect: () => {
    },
    disconnect: () => {
    },
    cleanup: () => {
    }
  };
}
function schedule(row, scenario) {
  const before = [], action = [];
  const arrival = (refs2, count = 1) => ({
    lane: "arrivals",
    values: Array.from({ length: count }, () => ({ ...scenario.arrivals, evaluationRefs: refs2 }))
  });
  if (row.group === "cold") return { before, action, preWaveNew: 0, frameItems: 0 };
  if (row.group === "recovery")
    return { before: scenario.steps, action, preWaveNew: 0, frameItems: 0 };
  const refs = scenario.arrivals.evaluationRefs;
  if (row.change === "duplicate") before.push(...scenario.steps);
  else {
    before.push(...scenario.setup);
    if (scenario.id !== "P6")
      before.push({ lane: "verification", values: [scenario.combined.verification] });
    if (row.change === "one-new") before.push(arrival(refs.slice(0, -1)));
  }
  action.push(arrival(refs, row.dataCount));
  if (scenario.id === "P6" && row.change !== "duplicate")
    action.push(...scenario.steps.filter((s) => s.lane === "verification"));
  return {
    before,
    action,
    preWaveNew: row.change === "all-new" ? refs.length : row.change === "one-new" ? 1 : 0,
    frameItems: refs.length
  };
}

// scripts/fixtures/spending-preset-performance-worker.ts
import assert from "node:assert/strict";
var sorted = (v) => v.map((x) => oracleCanonical(x)).sort();
function graphSnapshot(run) {
  const state = run.state();
  return {
    effects: [...state?.effects.values() ?? []].map((x) => ({
      proposal: x.proposal,
      admission: x.admission ?? null,
      outcome: x.outcome ?? null
    })),
    evidence: sorted([...state?.evidence.values() ?? []]),
    obligations: sorted(
      [...state?.quiescence.values() ?? []].map(
        ({ revisionDomain, evaluatedThroughRevision, lifecycle, retainedEvidence }) => ({
          revisionDomain,
          evaluatedThroughRevision,
          lifecycle,
          retainedEvidence
        })
      )
    ),
    view: Object.fromEntries(Object.entries(run.latest).filter(([k]) => k !== "summary"))
  };
}
function cleanupAll(runs, primary) {
  const errors = [];
  for (const run of runs) {
    try {
      run?.cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(
      primary === void 0 ? errors : [primary, ...errors],
      "cleanup failures; original failure retained first"
    );
}
function materialHints(scenario, plan) {
  const seen = /* @__PURE__ */ new Set();
  const flagged = new Set(
    scenario.evaluations.filter((e) => oracleBusiness(e).flagged).map((e) => e.evaluationRef)
  );
  const classify = (steps) => steps.map((step) => {
    let newMaterials = 0;
    if (step.lane === "arrivals")
      for (const value2 of step.values)
        for (const ref4 of value2.evaluationRefs) {
          if (!seen.has(ref4) && flagged.has(ref4)) newMaterials++;
          seen.add(ref4);
        }
    return {
      lane: step.lane,
      newMaterials,
      materialPhase: step.lane !== "arrivals" ? "not-applicable" : newMaterials ? "inclusive-material-generation-and-hash-wave" : "no-new-material"
    };
  });
  return { before: classify(plan.before), action: classify(plan.action) };
}
function preflight(row, scenario) {
  const a = graphArm("candidate", row.mode), b = graphArm("reference", row.mode), c = measurementArm("plain", row.mode);
  assert.ok("plain" in c);
  const plan = schedule(row, scenario);
  const steps = row.group === "cold" ? scenario.steps : [...plan.before, ...plan.action];
  const topology = {};
  let primary;
  try {
    for (const [name, run] of [
      ["candidate", a],
      ["reference", b]
    ]) {
      assert.equal(run.owner.nodes.length, row.mode === "off" ? 53 : 54);
      assert.equal(run.owner.roots.length, 2);
      topology[name] = run.graph.describe().nodes.map(({ id, deps, factory }) => ({ id, deps, factory }));
    }
    let beforeOccurrences = 0;
    for (let i = 0; i < steps.length; i++) {
      if (row.group === "steady" && i === plan.before.length)
        beforeOccurrences = a.state()?.byRevision.size ?? 0;
      for (const r of [a, b, c]) r.send(steps[i]);
      const sa = graphSnapshot(a), sb = graphSnapshot(b);
      assert.deepEqual(sb, sa, `${row.id} stage ${i} Graph parity`);
      assert.deepEqual(c.plain.snapshot(), sa.effects, `${row.id} stage ${i} plain effects`);
      assert.deepEqual(
        sorted(c.plain.evidenceSnapshot()),
        sa.evidence,
        `${row.id} stage ${i} evidence`
      );
      assert.deepEqual(
        sorted(c.plain.obligationSnapshot()),
        sa.obligations,
        `${row.id} stage ${i} obligations`
      );
    }
    const assessments = a.latest.assessment.rows;
    assert.equal(assessments.length, scenario.evaluations.length);
    for (const e of scenario.evaluations) {
      const observed = assessments.find((r) => r.evaluation.evaluationRef === e.evaluationRef);
      assert.ok(
        observed && verifyBusiness(e, observed.value),
        `${row.id} business oracle ${e.evaluationRef}`
      );
    }
    const afterOccurrences = a.state()?.byRevision.size ?? 0;
    if (row.group === "steady")
      assert.equal(
        afterOccurrences - beforeOccurrences,
        plan.preWaveNew,
        `${row.id} actual new occurrence count`
      );
    const saved = graphSnapshot(a);
    const recoveryPorts = {};
    for (const [arm, run] of [
      ["candidate", a],
      ["reference", b]
    ]) {
      const counts = { ...run.counts }, keys3 = Object.keys(run.latest);
      run.disconnect();
      assert.deepEqual(graphSnapshot(run), saved, `${row.id} detached state retained`);
      for (const key2 of keys3) delete run.latest[key2];
      run.connect();
      const reemitted = keys3.filter((key2) => run.counts[key2] > counts[key2]), missing = keys3.filter((key2) => !reemitted.includes(key2));
      recoveryPorts[arm] = { reemitted, missing };
      for (const key2 of ["assessment", "publication", "startup"])
        if (keys3.includes(key2))
          assert.ok(reemitted.includes(key2), `${row.id} reconnect DATA ${key2}`);
      const restored = graphSnapshot(run);
      assert.deepEqual(
        { ...restored, view: void 0 },
        { ...saved, view: void 0 },
        `${row.id} reconnected authority retained`
      );
      for (const key2 of reemitted.filter((key3) => key3 !== "summary"))
        assert.deepEqual(restored.view[key2], saved.view[key2]);
    }
    return {
      passed: true,
      materialHints: materialHints(scenario, plan),
      recoveryPorts,
      topology,
      beforeOccurrences,
      afterOccurrences,
      preWaveNew: plan.preWaveNew,
      frameItems: plan.frameItems,
      arrivalDataCount: row.dataCount ?? 0,
      newByEntry: row.group === "steady" ? [plan.preWaveNew, ...row.dataCount === 2 ? [0] : []] : [],
      extraVerificationData: plan.action.filter((s) => s.lane === "verification").reduce((n, s) => n + s.values.length, 0),
      assessments: assessments.length,
      effects: saved.effects.length
    };
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    cleanupAll([a, b, c], primary);
  }
}

// scripts/fixtures/causal-coverage-profile.ts
var results = [];
for (const row of matrixRows()) {
  const scenario = JSON.parse(
    readFileSync(new URL(`./${row.profile}-inputs.json`, import.meta.url), "utf8")
  );
  const semantic = preflight(row, scenario);
  assert2.equal(semantic.passed, true);
  const plan = schedule(row, scenario);
  const arms = [];
  for (const arm of row.group === "recovery" ? ["candidate", "reference"] : ["candidate", "reference", "plain"]) {
    let shared;
    const observations = [];
    try {
      const fresh = row.group === "cold" || row.change === "all-new" || row.change === "one-new";
      for (let index = 0; index < (row.group === "recovery" ? 20 : 3); index++) {
        let run;
        try {
          const constructStart = performance.now();
          run = shared ?? measurementArm(arm, row.mode);
          const constructMs = shared ? 0 : performance.now() - constructStart;
          const prepareStart = performance.now();
          if (!shared) for (const step of plan.before) run.send(step);
          const preparationMs = shared ? 0 : performance.now() - prepareStart;
          if (!fresh) shared = run;
          const before = "graph" in run ? run.graph.profile() : void 0;
          const counts = "counts" in run ? { ...run.counts } : void 0;
          const stateBefore = "state" in run ? structuredClone(run.state()) : void 0;
          const memoryBefore = process.memoryUsage();
          const start = performance.now();
          if (row.group === "recovery") {
            run.disconnect();
            run.connect();
          } else if (row.group === "steady") for (const step of plan.action) run.send(step);
          const ms = performance.now() - start;
          const memoryAfter = process.memoryUsage();
          const after = "graph" in run ? run.graph.profile() : void 0;
          if (row.group === "recovery" && "state" in run) {
            assert2.deepEqual(run.state(), stateBefore);
            for (const key2 of ["assessment", "publication", "startup"])
              if (counts && key2 in counts) assert2.ok(run.counts[key2] > counts[key2]);
          }
          const nodes = before && after ? Object.fromEntries(
            Object.entries(after.nodes).map(([id, n]) => [
              id,
              {
                invokes: n.invokes - before.nodes[id].invokes,
                totalDurationNs: n.totalDurationNs - before.nodes[id].totalDurationNs
              }
            ])
          ) : null;
          observations.push({
            index,
            constructMs,
            preparationMs,
            ms,
            memoryBefore,
            memoryAfter,
            totalInvokes: before && after ? after.totalInvokes - before.totalInvokes : null,
            nodes
          });
        } finally {
          if (run !== shared) run?.cleanup();
        }
      }
    } finally {
      shared?.cleanup();
    }
    arms.push({ arm, observations });
  }
  results.push({ row, semantic, arms });
  writeFileSync(
    new URL("./progress.json", import.meta.url),
    JSON.stringify({ completedRows: results.length, row: row.id }) + "\n"
  );
  console.log("PROFILE_MAP_ROW", results.length, row.id);
}
writeFileSync(
  new URL("./result.json", import.meta.url),
  JSON.stringify(
    {
      kind: "fixed-three-action-profile-map",
      formalQualification: false,
      limitations: "Opt-in profiling changes timing; durations may nest. Absolute observations and invocation counts only, no p95 or relative performance qualification.",
      results
    },
    null,
    2
  ) + "\n"
);
console.log("PROFILE_MAP_DONE", results.length);
