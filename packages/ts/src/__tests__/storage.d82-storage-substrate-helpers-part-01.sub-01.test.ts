import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { KvStorageTier } from "../index.js";
import {
	assertDecimalIntegerString,
	assertNonNegativeDecimalIntegerString,
	assertStrictJsonObject,
	assertStrictJsonValue,
	bigIntToDecimalString,
	bigIntToNonNegativeDecimalString,
	ContentAddressedMissError,
	changeEnvelopeCodec,
	contentAddressedKv,
	contentAddressedStorage,
	decimalStringToBigInt,
	envelopeChange,
	isDecimalIntegerString,
	isNonNegativeDecimalIntegerString,
	jsonCodecFor,
	kvStorage,
	listByPrefix,
	memoryKv,
	nonNegativeDecimalStringToBigInt,
	nowNs,
	readThroughKv,
	type StrictJsonObject,
	type StrictJsonValue,
	stableJsonString,
	strictCanonicalJsonBytes,
	strictJsonCodec,
	strictJsonCodecFor,
	tieredReadThrough,
} from "../index.js";
import { strictJsonDataErrors } from "../json/codec.js";
import { contentAddressedStorageKey } from "../storage/physical-key.js";

interface TestStorage {
	entries: Record<string, string>;
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
	key(index: number): string | null;
	length: number;
}

const _createStorage = (): TestStorage => {
	const entries: Record<string, string> = {};
	const storage: TestStorage = {
		get entries() {
			return entries;
		},
		getItem(key) {
			return entries[key] ?? null;
		},
		setItem(key, value) {
			entries[key] = value;
		},
		removeItem(key) {
			delete entries[key];
		},
		key(index) {
			const keys = Object.keys(entries).sort();
			return keys[index] ?? null;
		},
		get length() {
			return Object.keys(entries).length;
		},
	};
	return storage;
};

const _makeTempDir = () => mkdtempSync(join(tmpdir(), "graphrefly-ts-storage-"));

const _flushMicrotasks = async (turns = 1) => {
	for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

const _awaitDone = (run: (done: () => void) => void) =>
	new Promise<void>((resolve) => {
		run(resolve);
	});

const bytesToHex = (bytes: Uint8Array) =>
	[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (bytes: Uint8Array) =>
	bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)));

describe("D82 storage substrate helpers — sub 1", () => {
	it("stableJsonString sorts object keys deterministically", () => {
		expect(stableJsonString({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
	});

	it("stableJsonString rejects unsupported top-level JSON values", () => {
		expect(() => stableJsonString(undefined)).toThrow(/not JSON-encodable/);
		expect(() => stableJsonString(() => undefined)).toThrow(/not JSON-encodable/);
	});

	it("stableJsonString rejects nested lossy JSON values and non-plain objects", () => {
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		const sparse: unknown[] = [];
		sparse[1] = "hole";
		const arrayWithExtra = [1] as Array<unknown> & { extra?: number };
		arrayWithExtra.extra = 2;
		const arrayWithSymbol = [1] as Array<unknown> & { [key: symbol]: number };
		arrayWithSymbol[Symbol("extra")] = 2;
		const symbolKey = Symbol("secret");
		expect(() => stableJsonString({ nested: undefined })).toThrow(/not JSON-encodable/);
		expect(() => stableJsonString({ nested: 1n })).toThrow(/not JSON-encodable/);
		expect(() => stableJsonString(cyclic)).toThrow(/circular/);
		expect(() => stableJsonString({ sparse })).toThrow(/sparse array hole/);
		expect(() => stableJsonString(arrayWithExtra)).toThrow(/non-index array property/);
		expect(() => stableJsonString(arrayWithSymbol)).toThrow(/symbol-keyed/);
		expect(() => stableJsonString({ [symbolKey]: 1 })).toThrow(/symbol-keyed/);
		expect(() => stableJsonString(new Date(0))).toThrow(/non-plain object/);
		expect(() => stableJsonString(Number.NaN)).toThrow(/non-finite/);
	});

	it("__proto__ remains ordinary data under stableJsonString", () => {
		expect(stableJsonString(JSON.parse('{"__proto__":{"x":1},"a":2}'))).toBe(
			'{"__proto__":{"x":1},"a":2}',
		);
	});

	it("nowNs returns a D84 decimal timestamp string", () => {
		const spy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_123);
		try {
			const timestamp = nowNs();
			expect(timestamp).toBe("1700000000123000000");
			expect(BigInt(timestamp)).toBe(1_700_000_000_123_000_000n);
			expect(timestamp).toMatch(/^(0|[1-9]\d*)$/);
		} finally {
			spy.mockRestore();
		}
	});

	it("D88 decimal scalar helpers keep BigInt conversion explicit", () => {
		expect(bigIntToDecimalString(-12n)).toBe("-12");
		expect(bigIntToDecimalString(0n)).toBe("0");
		expect(bigIntToNonNegativeDecimalString(12n)).toBe("12");
		expect(() => bigIntToNonNegativeDecimalString(-1n)).toThrow(/non-negative/);

		expect(decimalStringToBigInt("-12")).toBe(-12n);
		expect(decimalStringToBigInt("0")).toBe(0n);
		expect(nonNegativeDecimalStringToBigInt("12")).toBe(12n);
		expect(() => nonNegativeDecimalStringToBigInt("-12")).toThrow(/non-negative/);
		expect(assertDecimalIntegerString("-12")).toBe("-12");
		expect(assertNonNegativeDecimalIntegerString("12")).toBe("12");
		expect(() => assertDecimalIntegerString("01")).toThrow(/decimal integer/);
		expect(() => assertNonNegativeDecimalIntegerString("-12")).toThrow(/non-negative/);
		expect(isDecimalIntegerString("-12")).toBe(true);
		expect(isDecimalIntegerString("-0")).toBe(false);
		expect(isDecimalIntegerString("01")).toBe(false);
		expect(isNonNegativeDecimalIntegerString("12")).toBe(true);
		expect(isNonNegativeDecimalIntegerString("-12")).toBe(false);
	});

	it("envelopeChange defaults t_ns to a D84 string timestamp", () => {
		const spy = vi.spyOn(Date, "now").mockReturnValue(42);
		try {
			const envelope = envelopeChange({ op: "set" }, { structure: "kv-change" });
			expect(envelope.t_ns).toBe("42000000");
			expect(typeof envelope.t_ns).toBe("string");
		} finally {
			spy.mockRestore();
		}
	});

	it("envelopeChange rejects caller-supplied non-canonical t_ns", () => {
		expect(() => envelopeChange({ op: "set" }, { structure: "kv-change", t_ns: "01" })).toThrow(
			/t_ns/,
		);
	});

	it("changeEnvelopeCodec rejects numeric, unsafe, and non-decimal t_ns", () => {
		const codec = changeEnvelopeCodec<{ op: string }>();
		const encodeRaw = (t_ns: unknown) =>
			strictJsonCodec.encode({
				lifecycle: "data",
				structure: "kv-change",
				version: 1,
				t_ns,
				change: { op: "set" },
			});

		for (const bad of [123, Number.MAX_SAFE_INTEGER + 1, "1.5", "1e3", "-1", "", "01"]) {
			expect(() => codec.decode(encodeRaw(bad))).toThrow(/t_ns/);
		}
		expect(codec.decode(encodeRaw("1700000000123000000")).t_ns).toBe("1700000000123000000");
	});

	it("strictJsonCodec accepts canonical stable JSON bytes", () => {
		const bytes = strictJsonCodec.encode({ b: 2, a: { d: 4, c: 3 } });
		expect(new TextDecoder().decode(bytes)).toBe('{"a":{"c":3,"d":4},"b":2}');
		expect(strictJsonCodec.decode(bytes)).toEqual({ a: { c: 3, d: 4 }, b: 2 });
		expect(strictJsonCodecFor<{ a: number }>().decode(new TextEncoder().encode('{"a":1}'))).toEqual(
			{
				a: 1,
			},
		);
	});

	it("strictJsonCodec rejects non-portable JSON number values (D88/D112)", () => {
		const encoder = new TextEncoder();
		for (const bad of [-0, Number.MAX_SAFE_INTEGER + 1, Number.MIN_VALUE]) {
			expect(() => stableJsonString(bad)).not.toThrow();
			expect(() => jsonCodecFor<unknown>().encode(bad)).not.toThrow();
			expect(() => strictJsonCodec.encode(bad)).toThrow(/non-canonical|safe range|subnormal/);
			expect(() => strictCanonicalJsonBytes(bad)).toThrow(/non-canonical|safe range|subnormal/);
		}
		expect(() => strictJsonCodec.decode(encoder.encode("-0"))).toThrow(/canonical/);
		expect(() => strictJsonCodec.decode(encoder.encode("9007199254740992"))).toThrow(/safe range/);
		expect(() => strictJsonCodec.decode(encoder.encode("5e-324"))).toThrow(/subnormal/);
		expect(strictJsonCodec.decode(encoder.encode("9007199254740991"))).toBe(
			Number.MAX_SAFE_INTEGER,
		);
	});

	it("strictCanonicalJsonBytes is the D113 neutral strict JSON byte helper", () => {
		const value = { b: 2, a: { d: 4, c: 3 } };
		const bytes = strictCanonicalJsonBytes(value);

		expect(bytes).toEqual(strictJsonCodec.encode(value));
		expect(new TextDecoder().decode(bytes)).toBe('{"a":{"c":3,"d":4},"b":2}');
		expect(strictCanonicalJsonBytes({ a: 1, b: 2 })).toEqual(
			strictCanonicalJsonBytes(JSON.parse('{"b":2,"a":1}')),
		);
		expect(() => strictCanonicalJsonBytes({ nested: undefined })).toThrow(/not JSON-encodable/);
		expect(() => strictCanonicalJsonBytes("\uD800")).toThrow(/unpaired surrogate/);
	});

	it("strict JSON assert helpers share the public JSON vocabulary", () => {
		const value: StrictJsonValue = assertStrictJsonValue({ b: 2, a: [true, null] });
		const object: StrictJsonObject = assertStrictJsonObject({ b: 2, a: 1 });

		expect(value).toEqual({ a: [true, null], b: 2 });
		expect(object).toEqual({ a: 1, b: 2 });
		expect(() => assertStrictJsonValue({ nested: undefined })).toThrow(/strict JSON compatible/);
		expect(() => assertStrictJsonObject(["not", "object"])).toThrow(/strict JSON object/);
	});

	it("strictJsonCodec rejects non-canonical key order and whitespace bytes", () => {
		const codec = strictJsonCodecFor<unknown>();
		const encoder = new TextEncoder();

		expect(() => codec.decode(encoder.encode('{"b":2,"a":1}'))).toThrow(/canonical/);
		expect(() => codec.decode(encoder.encode('{ "a": 1 }'))).toThrow(/canonical/);
	});

	it("strictJsonCodec rejects duplicate object keys before JSON.parse last-wins", () => {
		const encoder = new TextEncoder();

		for (const raw of [
			'{"a":1,"a":2}',
			'{"a":1,"\\u0061":2}',
			'{"a":{"b":1,"b":2}}',
			'{"a":[{"b":1,"b":2}]}',
		]) {
			expect(() => strictJsonCodec.decode(encoder.encode(raw))).toThrow(/duplicate object key/);
		}
	});

	it("strictJsonCodec rejects malformed UTF-8", () => {
		expect(() => strictJsonCodec.decode(new Uint8Array([0xff]))).toThrow();
	});

	it("strictJsonCodec rejects unpaired surrogate strings and keys", () => {
		const encoder = new TextEncoder();

		expect(() => strictJsonCodec.encode("\uD800")).toThrow(/unpaired surrogate/);
		expect(() => strictJsonCodec.encode({ "\uD800": "key" })).toThrow(/unpaired surrogate/);
		expect(() => strictJsonCodec.decode(encoder.encode('"\\ud800"'))).toThrow(/unpaired surrogate/);
	});

	it("strictJsonCodec rejects lossy JSON values on encode", () => {
		expect(() => strictJsonCodec.encode({ nested: undefined })).toThrow(/not JSON-encodable/);
		expect(() => strictJsonCodec.encode({ nested: 1n })).toThrow(/not JSON-encodable/);
		expect(() => strictJsonCodec.encode(Number.NaN)).toThrow(/non-finite/);
	});

	it("strict JSON descriptor scanner rejects accessors without executing getters", () => {
		const hostile: Record<string, unknown> = {};
		const getter = vi.fn(() => {
			throw new Error("getter executed");
		});
		Object.defineProperty(hostile, "metadata", {
			enumerable: true,
			get: getter,
		});
		const array: unknown[] = [];
		Object.defineProperty(array, "0", {
			enumerable: true,
			get: getter,
		});

		expect(strictJsonDataErrors(hostile, "metadata")).toContain(
			"metadata.metadata must be a data property",
		);
		expect(strictJsonDataErrors(array, "items")).toContain("items.0 must be a data property");
		expect(() => strictJsonCodec.encode(hostile)).toThrow(/data property/);
		expect(getter).not.toHaveBeenCalled();
	});

	it("strict JSON descriptor scanner rejects symbol keys, non-enumerables, sparse arrays, and cycles", () => {
		const symbolKey = { ok: true } as Record<PropertyKey, unknown>;
		symbolKey[Symbol("s")] = "hidden";
		const nonEnumerable = { ok: true };
		Object.defineProperty(nonEnumerable, "hidden", { value: true, enumerable: false });
		const sparse: unknown[] = [];
		sparse[1] = "hole";
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;

		expect(strictJsonDataErrors(symbolKey, "value").join(";")).toMatch(/symbol keys/);
		expect(strictJsonDataErrors(nonEnumerable, "value").join(";")).toMatch(/enumerable/);
		expect(strictJsonDataErrors(sparse, "value").join(";")).toMatch(/sparse array hole/);
		expect(strictJsonDataErrors(cyclic, "value").join(";")).toMatch(/circular/);
	});

	it("strict JSON descriptor scanner rejects unsafe values and deep-freezes valid clones", () => {
		const badValues = [
			{ label: "bigint", value: { x: 1n }, pattern: /not JSON-encodable/ },
			{ label: "function", value: { x: () => undefined }, pattern: /not JSON-encodable/ },
			{ label: "undefined", value: { x: undefined }, pattern: /not JSON-encodable/ },
			{ label: "symbol", value: { x: Symbol("x") }, pattern: /not JSON-encodable/ },
			{ label: "nan", value: { x: Number.NaN }, pattern: /non-finite/ },
			{ label: "infinity", value: { x: Number.POSITIVE_INFINITY }, pattern: /non-finite/ },
			{ label: "negative-zero", value: { x: -0 }, pattern: /non-canonical/ },
			{ label: "unsafe", value: { x: Number.MAX_SAFE_INTEGER + 1 }, pattern: /safe range/ },
			{ label: "subnormal", value: { x: Number.MIN_VALUE }, pattern: /subnormal/ },
			{ label: "surrogate", value: { x: "\uD800" }, pattern: /unpaired surrogate/ },
		];

		for (const bad of badValues) {
			expect(strictJsonDataErrors(bad.value, bad.label).join(";")).toMatch(bad.pattern);
		}

		const clone = assertStrictJsonObject({ z: [{ b: true, a: null }], a: "ok" });
		expect(clone).toEqual({ a: "ok", z: [{ a: null, b: true }] });
		expect(Object.isFrozen(clone)).toBe(true);
		expect(Object.isFrozen(clone.z)).toBe(true);
		expect(Object.isFrozen(clone.z[0])).toBe(true);

		const protoKey = {};
		Object.defineProperty(protoKey, "__proto__", {
			value: { x: 1 },
			enumerable: true,
			configurable: true,
			writable: true,
		});
		const protoClone = assertStrictJsonObject(protoKey);
		expect(Object.hasOwn(protoClone, "__proto__")).toBe(true);
		expect((protoClone as Record<string, StrictJsonValue>).__proto__).toEqual({ x: 1 });
		expect(Object.getPrototypeOf(protoClone)).toBe(Object.prototype);
	});

	it("jsonCodecFor still decodes ordinary non-canonical JSON permissively", () => {
		const decoded = jsonCodecFor<{ a: number; b: number }>().decode(
			new TextEncoder().encode('{ "b": 2, "a": 1 }'),
		);
		expect(decoded).toEqual({ a: 1, b: 2 });
	});

	it("content-addressed KV keys are deterministic across object key order", async () => {
		const kv = memoryKv<{ result: number }>();
		const cache = contentAddressedKv({
			kv,
			keyPrefix: "calc",
			keyContext: (ctx: { request: unknown }) => ctx.request,
		});

		const a = await cache.keyFor({ request: { b: 2, a: { d: 4, c: 3 } } });
		const b = await cache.keyFor({ request: { a: { c: 3, d: 4 }, b: 2 } });

		expect(a).toBe(b);
		const hash = await sha256Hex(strictCanonicalJsonBytes({ a: { c: 3, d: 4 }, b: 2 }));
		expect(a).toBe(contentAddressedStorageKey("calc", hash));
	});

	it("content-addressed KV snapshots canonical key bytes before async hashing", async () => {
		const cache = contentAddressedKv<{ request: { value: number } }, { result: number }>({
			kv: memoryKv(),
			keyPrefix: "calc",
			keyContext: (ctx) => ctx.request,
		});
		const ctx = { request: { value: 1 } };

		const key = cache.keyFor(ctx);
		ctx.request.value = 2;

		await expect(key).resolves.toBe(
			contentAddressedStorageKey("calc", await sha256Hex(strictCanonicalJsonBytes({ value: 1 }))),
		);
	});

	it("content-addressed KV honors read, write, read-write, and read-strict modes", async () => {
		const kv = memoryKv<{ answer: string }>();
		const ctx = { prompt: "hello", opts: { temp: 0 } };

		const writeOnly = contentAddressedKv({ kv, mode: "write" });
		await writeOnly.store(ctx, { answer: "hi" });
		expect(await writeOnly.lookup(ctx)).toBeUndefined();

		const readOnly = contentAddressedKv({ kv, mode: "read" });
		expect(await readOnly.lookup(ctx)).toEqual({ answer: "hi" });
		await readOnly.store(ctx, { answer: "ignored" });
		expect(await readOnly.lookup(ctx)).toEqual({ answer: "hi" });

		const readWrite = contentAddressedStorage({ kv, mode: "read-write" });
		await readWrite.store({ prompt: "bye" }, { answer: "goodbye" });
		expect(await readWrite.lookup({ prompt: "bye" })).toEqual({ answer: "goodbye" });

		const strict = contentAddressedKv({ kv, mode: "read-strict" });
		await expect(strict.lookup({ prompt: "missing" })).rejects.toBeInstanceOf(
			ContentAddressedMissError,
		);
	});

	it("content-addressed KV reports strict miss details and rejects bad key contexts honestly", async () => {
		const kv = memoryKv<unknown>();
		const strict = contentAddressedKv({ kv, mode: "read-strict" });
		const ctx = { prompt: "missing" };
		const expectedKey = await strict.keyFor(ctx);

		await expect(strict.lookup(ctx)).rejects.toMatchObject({
			name: "ContentAddressedMissError",
			key: expectedKey,
			context: ctx,
		});

		const bad = contentAddressedKv<{ value: unknown }, unknown>({
			kv,
			keyContext: (value) => value,
		});
		const badCtx = { value: 1n };
		await expect(bad.keyFor(badCtx)).rejects.toThrow(/not JSON-encodable/);
		await expect(bad.lookup(badCtx)).rejects.toThrow(/not JSON-encodable/);
		await expect(bad.store(badCtx, { ok: true })).rejects.toThrow(/not JSON-encodable/);
		await expect(bad.forget(badCtx)).rejects.toThrow(/not JSON-encodable/);
	});

	it("content-addressed disallowed modes do not touch KV or validate skipped contexts", async () => {
		const calls: string[] = [];
		const kv: KvStorageTier<unknown> = {
			get: (key) => {
				calls.push(`get:${key}`);
				return Promise.resolve(undefined);
			},
			set: (key) => {
				calls.push(`set:${key}`);
				return Promise.resolve();
			},
			delete: (key) => {
				calls.push(`delete:${key}`);
				return Promise.resolve();
			},
			list: () => Promise.resolve([]),
		};
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;

		await expect(contentAddressedKv({ kv, mode: "write" }).lookup(cyclic)).resolves.toBeUndefined();
		await expect(
			contentAddressedKv({ kv, mode: "read" }).store(cyclic, { value: 1 }),
		).resolves.toBe(undefined);
		await expect(contentAddressedKv({ kv, mode: "read" }).forget(cyclic)).resolves.toBeUndefined();
		await expect(contentAddressedKv({ kv, mode: "write" }).forget(cyclic)).resolves.toBeUndefined();
		expect(calls).toEqual([]);
	});

	it("content-addressed forget is a no-op when mode disallows it or delete is missing", async () => {
		const kv = memoryKv<{ value: number }>();
		const ctx = { id: 1 };
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		const readWrite = contentAddressedKv({ kv });
		await readWrite.store(ctx, { value: 1 });

		await contentAddressedKv({ kv, mode: "read" }).forget(ctx);
		expect(await readWrite.lookup(ctx)).toEqual({ value: 1 });

		await contentAddressedKv({ kv, mode: "write" }).forget(ctx);
		expect(await readWrite.lookup(ctx)).toEqual({ value: 1 });

		await expect(contentAddressedKv({ kv, mode: "write" }).lookup(cyclic)).resolves.toBeUndefined();
		await expect(
			contentAddressedKv({ kv, mode: "read" }).store(cyclic, { value: 9 }),
		).resolves.toBe(undefined);
		await expect(contentAddressedKv({ kv, mode: "read" }).forget(cyclic)).resolves.toBeUndefined();

		await readWrite.forget(ctx);
		expect(await readWrite.lookup(ctx)).toBeUndefined();

		const bytes = new Map<string, Uint8Array>();
		const noDelete = kvStorage<{ value: number }>({
			backend: {
				get: (key) => bytes.get(key),
				put: (key, value) => void bytes.set(key, value),
			},
		});
		const noDeleteCache = contentAddressedKv({ kv: noDelete });
		await noDeleteCache.store(ctx, { value: 2 });
		await noDeleteCache.forget(ctx);
		expect(await noDeleteCache.lookup(ctx)).toEqual({ value: 2 });
	});

	it("content-addressed key contexts reject lossy and cyclic JSON", async () => {
		const cache = contentAddressedKv({ kv: memoryKv<unknown>() });
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		const sparse: unknown[] = [];
		sparse[1] = "hole";

		await expect(cache.keyFor({ nested: undefined })).rejects.toThrow(/not JSON-encodable/);
		await expect(cache.keyFor(cyclic)).rejects.toThrow(/circular/);
		await expect(cache.keyFor({ sparse })).rejects.toThrow(/sparse array hole/);
		await expect(cache.keyFor("\uD800")).rejects.toThrow(/unpaired surrogate/);
	});

	it("memoryKv stores encoded values and lists keys by prefix in order", async () => {
		const kv = memoryKv<{ value: number }>();
		await kv.set("items/002", { value: 2 });
		await kv.set("other/001", { value: 9 });
		await kv.set("items/001", { value: 1 });

		expect(await kv.get("items/001")).toEqual({ value: 1 });
		expect(await listByPrefix(kv, "items/")).toEqual(["items/001", "items/002"]);
	});

	it("tieredReadThrough checks tiers in order and promotes first tier-1 hit", async () => {
		const calls: string[] = [];
		const coldCalls: string[] = [];
		const warmCalls: string[] = [];
		const hotTier: KvStorageTier<{ value: number }> = {
			get: (key) => {
				calls.push(`hot:${key}`);
				return Promise.resolve(undefined);
			},
			set: (key, value) => {
				calls.push(`hot:set:${key}:${value.value}`);
				return Promise.resolve();
			},
			delete: () => Promise.resolve(),
			list: () => Promise.resolve([]),
		};
		const warmTier: KvStorageTier<{ value: number }> = {
			get: (key) => {
				warmCalls.push(key);
				calls.push(`warm:${key}`);
				return Promise.resolve({ value: 2 });
			},
			set: () => {
				calls.push("warm:set");
				return Promise.resolve();
			},
			delete: () => Promise.resolve(),
			list: () => Promise.resolve([]),
		};
		const coldTier: KvStorageTier<{ value: number }> = {
			get: (key) => {
				coldCalls.push(key);
				calls.push(`cold:${key}`);
				return Promise.resolve({ value: 1 });
			},
			set: () => Promise.resolve(),
			delete: () => Promise.resolve(),
			list: () => Promise.resolve([]),
		};

		const result = await tieredReadThrough({
			key: "k",
			tiers: [hotTier, warmTier, coldTier],
			tierNames: ["hot", "warm", "cold"],
		});

		expect(result.status).toBe("hit");
		expect(result.value).toEqual({ value: 2 });
		expect(result.hitTier).toEqual({ index: 1, name: "warm" });
		expect(result.facts.map((fact) => fact.kind)).toEqual(["miss", "hit"]);
		expect(result.facts[1]).toMatchObject({ key: "k", tier: { index: 1, name: "warm" } });
		expect(result.promotions.map((promotion) => promotion.tier.index)).toEqual([0]);
		expect(result.promotions[0]).toMatchObject({ ok: true, tier: { index: 0, name: "hot" } });
		expect(warmCalls).toEqual(["k"]);
		expect(coldCalls).toEqual([]);
		expect(calls.filter((value) => value.startsWith("cold")).length).toEqual(0);
		expect(calls.some((value) => value === "hot:set:k:2")).toBe(true);
	});

	it("tieredReadThrough loads on miss and writes-through to all tiers by default", async () => {
		const setTargets: string[] = [];
		const missTier: KvStorageTier<{ value: string }> = {
			get: (_key) => Promise.resolve(undefined),
			set: (key, value) => {
				setTargets.push(`miss:${key}:${value.value}`);
				return Promise.resolve();
			},
			delete: () => Promise.resolve(),
			list: () => Promise.resolve([]),
		};
		const hitTier: KvStorageTier<{ value: string }> = {
			get: (_key) => Promise.resolve(undefined),
			set: (key, value) => {
				setTargets.push(`hit:${key}:${value.value}`);
				return Promise.resolve();
			},
			delete: () => Promise.resolve(),
			list: () => Promise.resolve([]),
		};

		const result = await readThroughKv({
			key: "user:1",
			tiers: [missTier, hitTier],
			load: () => ({ value: "loaded" }),
			tierNames: ["miss", "hit"],
		});

		expect(result.status).toBe("hit");
		expect(result.value).toEqual({ value: "loaded" });
		expect(result.hitTier).toEqual({ index: -1, name: "load" });
		expect(result.facts.map((fact) => fact.kind)).toEqual(["miss", "miss", "hit"]);
		expect(setTargets).toEqual(["miss:user:1:loaded", "hit:user:1:loaded"]);
	});

	it("tieredReadThrough returns a miss fact without loader and does not throw", async () => {
		const result = await tieredReadThrough<{ value: string }>({
			key: "missing",
			tiers: [
				{
					get: () => Promise.resolve(undefined),
					set: () => Promise.resolve(),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
				{
					get: () => Promise.resolve(undefined),
					set: () => Promise.resolve(),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
			],
		});

		expect(result.status).toBe("miss");
		expect(result.value).toBeUndefined();
		expect(result.facts.map((fact) => fact.kind)).toEqual(["miss", "miss"]);
		expect(result.facts.every((fact) => fact.tier.index >= 0)).toBe(true);
	});

	it("tieredReadThrough treats an empty tier list without a loader as a miss", async () => {
		const result = await tieredReadThrough<{ value: string }>({
			key: "nowhere",
			tiers: [],
		});

		expect(result.status).toBe("miss");
		expect(result.value).toBeUndefined();
		expect(result.hitTier).toBeUndefined();
		expect(result.facts).toEqual([]);
		expect(result.promotions).toEqual([]);
	});

	it("tieredReadThrough captures get errors as facts and continues lookup", async () => {
		const hitTier: KvStorageTier<{ value: number }> = {
			get: (_key) => Promise.resolve({ value: 7 }),
			set: () => Promise.resolve(),
			delete: () => Promise.resolve(),
			list: () => Promise.resolve([]),
		};
		const errors: string[] = [];
		const result = await tieredReadThrough({
			key: "err",
			tiers: [
				{
					get: () => Promise.reject(new Error("read failed")),
					set: () => Promise.resolve(),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
				hitTier,
			],
			onError: (ctx) => {
				errors.push(String((ctx.error as Error).message ?? ctx.error));
			},
		});

		expect(result.status).toBe("hit");
		expect(result.value).toEqual({ value: 7 });
		expect(result.facts.map((fact) => fact.kind)).toEqual(["error", "hit"]);
		expect(errors).toContain("read failed");
		expect(result.promotions).toEqual([expect.objectContaining({ tier: { index: 0 }, ok: true })]);
	});
});
