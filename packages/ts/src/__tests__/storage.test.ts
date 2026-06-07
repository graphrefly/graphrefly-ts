import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as observeStorageExports from "../adapters/observe-storage.js";
import {
	attachObserveEventLog,
	attachObserveSink,
	type ObserveSinkErrorContext,
} from "../adapters/observe-storage.js";
import type { KvStorageTier, ObserveEvent, ObserveEventFrame, WalFrame } from "../index.js";
import * as rootExports from "../index.js";
import {
	appendLogKey,
	appendLogStorage,
	assertDecimalIntegerString,
	assertNonNegativeDecimalIntegerString,
	assertWalFrame,
	bigIntToDecimalString,
	bigIntToNonNegativeDecimalString,
	ContentAddressedMissError,
	changeEnvelopeCodec,
	contentAddressedKv,
	contentAddressedStorage,
	decimalStringToBigInt,
	envelopeChange,
	graph,
	hasKvPutIfAbsent,
	hasKvVersioned,
	hasStoragePutIfAbsent,
	hasStorageVersioned,
	isDecimalIntegerString,
	isNonNegativeDecimalIntegerString,
	jsonCodecFor,
	kvStorage,
	listByPrefix,
	memoryAppendLog,
	memoryBackend,
	memoryKv,
	memoryMultiWriterAppendLog,
	multiWriterAppendLogStorage,
	nonNegativeDecimalStringToBigInt,
	nowNs,
	observeEventFrame,
	observeEventFrameCodec,
	readAppendLogPage,
	readObserveEventLogPage,
	readThroughKv,
	requireKvPutIfAbsent,
	requireKvVersioned,
	requireStoragePutIfAbsent,
	requireStorageVersioned,
	restoreGraph,
	stableJsonString,
	strictCanonicalJsonBytes,
	strictJsonCodec,
	strictJsonCodecFor,
	tieredReadThrough,
	verifyWalFrameChecksum,
	WAL_FORMAT_VERSION,
	walFrame,
	walFrameChecksum,
	walFrameCodec,
	walFrameKey,
	walFramePrefix,
	webStorageBackend,
} from "../index.js";
import * as storageExports from "../storage/index.js";
import { fileAppendLog, fileBackend, fileKv, sqliteBackend, sqliteKv } from "../storage/node.js";

interface TestStorage {
	entries: Record<string, string>;
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
	key(index: number): string | null;
	length: number;
}

const createStorage = (): TestStorage => {
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

const makeTempDir = () => mkdtempSync(join(tmpdir(), "graphrefly-ts-storage-"));

const flushMicrotasks = async (turns = 1) => {
	for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

const awaitDone = (run: (done: () => void) => void) =>
	new Promise<void>((resolve) => {
		run(resolve);
	});

const bytesToHex = (bytes: Uint8Array) =>
	[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (bytes: Uint8Array) =>
	bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)));

describe("attachObserveSink — observe-driven storage binding (D57/D74)", () => {
	it("writes filtered observe events in graph order", () => {
		const g = graph();
		const a = g.state(0, { name: "a" });
		const _b = g.derived([a], (n) => n + 1, { name: "b" });
		const events: ObserveEvent[] = [];

		const handle = attachObserveSink(
			g,
			{ write: (event) => void events.push(event) },
			{ path: "b" },
		);

		a.set(1);
		a.set(2);
		handle.flush();

		expect(events.every((event) => event.path === "b")).toBe(true);
		expect(events.map((event) => event.seq)).toEqual(
			[...events.map((event) => event.seq)].sort((x, y) => x - y),
		);
		expect(events.filter((event) => event.msg[0] === "DATA").map((event) => event.msg[1])).toEqual([
			1, 2, 3,
		]);

		handle.dispose();
	});

	it("serializes thenable writes so later events wait for earlier ones", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const started: number[] = [];
		const finished: number[] = [];
		const releases: Array<() => void> = [];

		const handle = attachObserveSink(
			g,
			{
				write: (value) => {
					started.push(value);
					return new Promise<void>((resolve) => {
						releases.push(() => {
							finished.push(value);
							resolve();
						});
					});
				},
			},
			{
				path: "count",
				map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
			},
		);

		count.set(1);
		count.set(2);
		expect(started).toEqual([0]);

		releases.shift()?.();
		await flushMicrotasks();
		expect(started).toEqual([0, 1]);

		releases.shift()?.();
		await flushMicrotasks();
		expect(started).toEqual([0, 1, 2]);

		const flushed = awaitDone((done) => handle.flush(done));
		releases.shift()?.();
		await flushed;
		expect(finished).toEqual([0, 1, 2]);

		handle.dispose();
	});

	it("routes sync throws and thenable rejections to onError and keeps draining", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const values: number[] = [];
		const errors: Array<{ message: string; ctx: ObserveSinkErrorContext<number> }> = [];

		const handle = attachObserveSink<number>(
			g,
			{
				write: (value) => {
					if (value === 1) throw new Error("sync boom");
					if (value === 2) return Promise.reject(new Error("async boom"));
					values.push(value);
				},
			},
			{
				path: "count",
				map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
				onError: (error, ctx) => {
					errors.push({ message: (error as Error).message, ctx });
				},
			},
		);

		count.set(1);
		count.set(2);
		count.set(3);
		await awaitDone((done) => handle.flush(done));

		expect(values).toEqual([0, 3]);
		expect(
			errors.map(({ message, ctx }) => ({ message, phase: ctx.phase, value: ctx.value })),
		).toEqual([
			{ message: "sync boom", phase: "write", value: 1 },
			{ message: "async boom", phase: "write", value: 2 },
		]);

		handle.dispose();
	});

	it("routes malformed thenables to onError without wedging the queue", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const values: number[] = [];
		const errors: Array<{ message: string; ctx: ObserveSinkErrorContext<number> }> = [];

		const handle = attachObserveSink<number>(
			g,
			{
				write: (value) => {
					if (value === 1) {
						const malformed = {};
						Object.defineProperty(malformed, ["th", "en"].join(""), {
							get() {
								throw new Error("bad then");
							},
						});
						return malformed as PromiseLike<void>;
					}
					values.push(value);
				},
			},
			{
				path: "count",
				map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
				onError: (error, ctx) => {
					errors.push({ message: (error as Error).message, ctx });
				},
			},
		);

		count.set(1);
		count.set(2);
		await awaitDone((done) => handle.flush(done));

		expect(values).toEqual([0, 2]);
		expect(
			errors.map(({ message, ctx }) => ({ message, phase: ctx.phase, value: ctx.value })),
		).toEqual([{ message: "bad then", phase: "write", value: 1 }]);

		handle.dispose();
	});

	it("serializes flush/rollback/dispose and stops observing after dispose", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const calls: string[] = [];

		const handle = attachObserveSink<number>(
			g,
			{
				write: (value) => void calls.push(`write:${value}`),
				flush: () => void calls.push("flush"),
				rollback: () => void calls.push("rollback"),
				dispose: () => void calls.push("dispose"),
			},
			{
				path: "count",
				map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
			},
		);

		count.set(1);
		const order: string[] = [];
		handle.flush(() => order.push("flush.done"));
		handle.rollback(() => order.push("rollback.done"));
		await awaitDone((done) =>
			handle.dispose(() => {
				order.push("dispose.done");
				done();
			}),
		);

		expect(calls).toEqual(["write:0", "write:1", "flush", "rollback", "dispose"]);
		expect(order).toEqual(["flush.done", "rollback.done", "dispose.done"]);

		count.set(2);
		handle.flush();
		expect(calls).toEqual(["write:0", "write:1", "flush", "rollback", "dispose"]);
	});

	it("coalesces repeated dispose callbacks until pending work drains", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const started: number[] = [];
		const releases: Array<() => void> = [];
		const done: string[] = [];

		const handle = attachObserveSink<number>(
			g,
			{
				write: (value) => {
					started.push(value);
					return new Promise<void>((resolve) => {
						releases.push(resolve);
					});
				},
			},
			{
				path: "count",
				map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
			},
		);

		count.set(1);
		handle.dispose(() => done.push("first"));
		handle.dispose(() => done.push("second"));

		expect(started).toEqual([0]);
		expect(done).toEqual([]);

		releases.shift()?.();
		await flushMicrotasks();
		expect(started).toEqual([0, 1]);
		expect(done).toEqual([]);

		releases.shift()?.();
		await flushMicrotasks();
		expect(done).toEqual(["first", "second"]);

		handle.dispose(() => done.push("third"));
		expect(done).toEqual(["first", "second", "third"]);
	});

	it("reports mapper failures without invoking sink.write", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const write = vi.fn((value: number) => void value);
		const errors: ObserveSinkErrorContext<number>[] = [];

		const handle = attachObserveSink<number>(
			g,
			{ write },
			{
				path: "count",
				map: (event) => {
					if (event.msg[0] !== "DATA") return undefined;
					const value = event.msg[1] as number;
					if (value === 1) throw new Error("bad map");
					return value;
				},
				onError: (_error, ctx) => {
					errors.push(ctx);
				},
			},
		);

		count.set(1);
		count.set(2);
		handle.flush();

		expect(write.mock.calls.map(([value]) => value)).toEqual([0, 2]);
		expect(errors).toEqual([{ phase: "map", event: expect.objectContaining({ path: "count" }) }]);

		handle.dispose();
	});

	it("calls done even when adapter hooks reject or throw, while routing failures to onError", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const phases: string[] = [];

		const handle = attachObserveSink<number>(
			g,
			{
				write: (value) => {
					if (value === 1) throw new Error("write fail");
				},
				flush: () => Promise.reject(new Error("flush fail")),
				rollback: () => {
					throw new Error("rollback fail");
				},
				dispose: () => Promise.reject(new Error("dispose fail")),
			},
			{
				path: "count",
				map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
				onError: (_error, ctx) => {
					phases.push(ctx.phase);
				},
			},
		);

		count.set(1);
		await awaitDone((done) => handle.flush(done));
		await awaitDone((done) => handle.rollback(done));
		await awaitDone((done) => handle.dispose(done));

		expect(phases).toEqual(["write", "flush", "rollback", "dispose"]);
	});
});

describe("D82 storage substrate helpers", () => {
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
		expect(a).toMatch(/^calc:[0-9a-f]{64}$/);
		expect(a).toBe(
			`calc:${await sha256Hex(strictCanonicalJsonBytes({ a: { c: 3, d: 4 }, b: 2 }))}`,
		);
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
			`calc:${await sha256Hex(strictCanonicalJsonBytes({ value: 1 }))}`,
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

	it("tieredReadThrough reports all-miss-tier errors as error status", async () => {
		const failures: unknown[] = [];
		const result = await tieredReadThrough({
			key: "all-fail",
			tiers: [
				{
					get: () => Promise.reject(new Error("tier0 failed")),
					set: () => Promise.resolve(),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
				{
					get: () => Promise.reject(new Error("tier1 failed")),
					set: () => Promise.resolve(),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
			],
			onError: (ctx) => {
				if (ctx.stage === "lookup") failures.push(ctx.error);
			},
		});

		expect(result.status).toBe("error");
		expect(result.facts.map((fact) => fact.kind)).toEqual(["error", "error"]);
		expect(failures).toHaveLength(2);
	});

	it("tieredReadThrough reports mixed miss/error no-hit results as error status", async () => {
		const result = await tieredReadThrough({
			key: "partial-fail",
			tiers: [
				{
					get: () => Promise.resolve(undefined),
					set: () => Promise.resolve(),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
				{
					get: () => Promise.reject(new Error("cold failed")),
					set: () => Promise.resolve(),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
			],
		});

		expect(result.status).toBe("error");
		expect(result.value).toBeUndefined();
		expect(result.facts.map((fact) => fact.kind)).toEqual(["miss", "error"]);
	});

	it("tieredReadThrough captures promotion write failures as facts", async () => {
		const errors: unknown[] = [];
		const result = await tieredReadThrough({
			key: "write-fail",
			tiers: [
				{
					get: () => Promise.resolve(undefined),
					set: () => Promise.reject(new Error("promotion failed")),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
				{
					get: () => Promise.resolve({ value: 3 }),
					set: () => Promise.resolve(),
					delete: () => Promise.resolve(),
					list: () => Promise.resolve([]),
				},
			],
			promoteTo: [0],
			tierNames: ["hot", "cold"],
			onError: (ctx) => {
				if (ctx.stage === "promotion") {
					errors.push(ctx.error);
				}
			},
		});

		expect(result.status).toBe("hit");
		expect(result.value).toEqual({ value: 3 });
		expect(result.facts.map((fact) => fact.kind)).toEqual(["miss", "hit"]);
		expect(result.promotions).toEqual([
			expect.objectContaining({ tier: { index: 0, name: "hot" }, ok: false }),
		]);
		expect(String(result.promotions[0]?.error)).toContain("promotion failed");
		expect(errors).toHaveLength(1);
	});

	it("tieredReadThrough uses D108 setIfMatch for stale-proof promotion when available", async () => {
		const hot = memoryKv<number>();
		const hotVersioned = requireKvVersioned(hot);
		const hotTier: KvStorageTier<number> = {
			...hot,
			async getVersioned(key) {
				const observed = await hotVersioned.getVersioned(key);
				await hot.set(key, 1);
				return observed;
			},
			setIfMatch: hotVersioned.setIfMatch.bind(hotVersioned),
		};
		const cold = memoryKv<number>();
		await cold.set("k", 7);

		const result = await tieredReadThrough({
			key: "k",
			tiers: [hotTier, cold],
			promoteTo: [0],
		});

		expect(result.status).toBe("hit");
		expect(result.value).toBe(7);
		expect(result.facts.map((fact) => [fact.kind, fact.tier.index])).toEqual([
			["miss", 0],
			["hit", 1],
		]);
		expect(result.promotions).toEqual([{ tier: { index: 0 }, ok: false }]);
		expect(await hot.get("k")).toBe(1);
	});

	it("tieredReadThrough does not bypass a versioned target when generation lookup failed", async () => {
		const calls: string[] = [];
		const errors: string[] = [];
		const hotTier: KvStorageTier<number> = {
			get: () => {
				calls.push("get");
				return Promise.resolve(undefined);
			},
			set: () => {
				calls.push("set");
				throw new Error("plain set must not run");
			},
			getVersioned: () => {
				calls.push("getVersioned");
				throw new Error("versioned read failed");
			},
			setIfMatch: () => {
				calls.push("setIfMatch");
				return Promise.resolve(true);
			},
			delete: () => Promise.resolve(),
			list: () => Promise.resolve([]),
		};
		const cold = memoryKv<number>();
		await cold.set("k", 9);

		const result = await tieredReadThrough({
			key: "k",
			tiers: [hotTier, cold],
			promoteTo: [0],
			onError: (ctx) => {
				errors.push(`${ctx.stage}:${String((ctx.error as Error).message ?? ctx.error)}`);
			},
		});

		expect(result.status).toBe("hit");
		expect(result.value).toBe(9);
		expect(result.facts.map((fact) => [fact.kind, fact.tier.index])).toEqual([
			["error", 0],
			["hit", 1],
		]);
		expect(result.promotions).toEqual([
			expect.objectContaining({
				tier: { index: 0 },
				ok: false,
			}),
		]);
		expect(String(result.promotions[0]?.error)).toContain("not observed with a generation");
		expect(calls).toEqual(["getVersioned"]);
		expect(errors).toEqual([
			"lookup:versioned read failed",
			"promotion:tieredReadThrough: versioned promotion target was not observed with a generation",
		]);
	});

	it("memoryBackend putIfAbsent creates once, preserves bytes, and clones", async () => {
		const backend = memoryBackend();
		const first = new Uint8Array([1, 2, 3]);
		const second = new Uint8Array([9, 9, 9]);

		expect(hasStoragePutIfAbsent(backend)).toBe(true);
		expect(requireStoragePutIfAbsent(backend)).toBe(backend);
		expect(await backend.putIfAbsent("k", first)).toBe(true);
		first[0] = 7;

		expect(await backend.putIfAbsent("k", second)).toBe(false);
		second[1] = 8;
		const stored = await backend.get("k");
		expect([...stored!]).toEqual([1, 2, 3]);
		stored![0] = 6;
		expect([...(await backend.get("k"))!]).toEqual([1, 2, 3]);
	});

	it("memoryBackend supports D108 versioned present and absent observations", async () => {
		const backend = requireStorageVersioned(memoryBackend());

		expect(hasStorageVersioned(backend)).toBe(true);
		const absent = await backend.getVersioned("k");
		expect(absent.kind).toBe("miss");
		expect(await backend.setIfMatch("k", new Uint8Array([1]), absent.generation)).toBe(true);
		expect(await backend.setIfMatch("k", new Uint8Array([2]), absent.generation)).toBe(false);
		expect(await backend.setIfMatch("other", new Uint8Array([9]), absent.generation)).toBe(false);
		expect(await backend.get("k")).toEqual(new Uint8Array([1]));

		const present = await backend.getVersioned("k");
		expect(present.kind).toBe("hit");
		if (present.kind === "hit") {
			present.value[0] = 9;
		}
		expect(await backend.get("k")).toEqual(new Uint8Array([1]));

		await backend.put("k", new Uint8Array([3]));
		expect(await backend.setIfMatch("k", new Uint8Array([4]), present.generation)).toBe(false);
		const fresh = await backend.getVersioned("k");
		expect(await backend.setIfMatch("k", new Uint8Array([4]), fresh.generation)).toBe(true);
		expect(await backend.get("k")).toEqual(new Uint8Array([4]));

		backend.clear();
		expect(await backend.setIfMatch("k", new Uint8Array([5]), fresh.generation)).toBe(false);
	});

	it("webStorageBackend stores hex bytes deterministically, lists by namespace, and rejects malformed data", () => {
		const storage = createStorage();
		const backend = webStorageBackend(storage, { namespace: "web" });

		const raw = new Uint8Array([8, 9, 10]);
		backend.put("cache/key", raw);
		raw[0] = 1;

		expect(storage.entries["web\u0000cache/key"]).toBe("08090a");
		expect([...(backend.get("cache/key") ?? new Uint8Array())]).toEqual([8, 9, 10]);
		expect(backend.list("cache")).toEqual(["cache/key"]);
		expect(backend.list("other")).toEqual([]);

		storage.setItem("web\u0000bad", "not-hex");
		expect(() => backend.get("bad")).toThrow(/malformed stored bytes/);
		expect(hasStorageVersioned(backend)).toBe(false);
		expect(() => requireStorageVersioned(backend, "webStorageBackend")).toThrow(
			/webStorageBackend: backend does not support versioned/,
		);
	});

	it("webStorageBackend rejects ambiguous namespace separators and non-string runtime keys", () => {
		const storage = createStorage();

		expect(() => webStorageBackend(storage, { namespace: "ns\u0000bad" })).toThrow(/namespace/);
		expect(() => webStorageBackend(storage, { namespace: null as unknown as string })).toThrow(
			/namespace/,
		);

		const backend = webStorageBackend(storage, { namespace: "ns" });
		expect(() => backend.put("bad\u0000key", new Uint8Array([1]))).toThrow(/U\+0000/);
		expect(() => backend.get(1 as unknown as string)).toThrow(/key must be a string/);
		expect(() => backend.list("bad\u0000prefix")).toThrow(/U\+0000/);
		expect(() => backend.list(1 as unknown as string)).toThrow(/list prefix must be a string/);

		storage.setItem("ns\u0000bad\u0000key", "01");
		expect(() => backend.list()).toThrow(/malformed stored key/);
	});

	it("fileBackend persists bytes, lists logical keys, and supports putIfAbsent", async () => {
		const dir = makeTempDir();
		try {
			const backend = fileBackend(dir, { namespace: "ns" });
			await backend.put("", new Uint8Array([0]));
			await backend.put("a", new Uint8Array([1, 2, 3]));
			await backend.put("ab", new Uint8Array([9, 8, 7]));
			expect(await backend.putIfAbsent?.("a", new Uint8Array([4]))).toBe(false);
			expect(await backend.putIfAbsent?.("c", new Uint8Array([3]))).toBe(true);

			const first = await backend.get("a");
			const second = await backend.get("ab");
			expect(first).toEqual(new Uint8Array([1, 2, 3]));
			expect(second).toEqual(new Uint8Array([9, 8, 7]));

			first![0] = 9;
			expect(await backend.get("a")).toEqual(new Uint8Array([1, 2, 3]));

			const listAll = await backend.list();
			expect(listAll).toEqual(["", "a", "ab", "c"]);
			expect(await backend.list("a")).toEqual(["a", "ab"]);

			await backend.delete("ab");
			expect(await backend.get("ab")).toBeUndefined();
			expect(await backend.list()).toEqual(["", "a", "c"]);
			expect(hasStorageVersioned(backend)).toBe(false);
			expect(() => requireStorageVersioned(backend, "fileBackend")).toThrow(
				/fileBackend: backend does not support versioned/,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fileBackend rejects ambiguous namespace separators and non-string runtime keys", async () => {
		const dir = makeTempDir();
		try {
			expect(() => fileBackend(dir, { namespace: "ns\u0000bad" })).toThrow(/namespace/);
			expect(() => fileBackend(dir, { namespace: null as unknown as string })).toThrow(/namespace/);

			const backend = fileBackend(dir, { namespace: "ns" });
			expect(() => backend.put("bad\u0000key", new Uint8Array([1]))).toThrow(/U\+0000/);
			expect(() => backend.get(1 as unknown as string)).toThrow(/key must be a string/);
			expect(() => backend.list("bad\u0000prefix")).toThrow(/U\+0000/);
			expect(() => backend.list(1 as unknown as string)).toThrow(/list prefix must be a string/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("fileBackend rejects unsafe filename extensions", () => {
		const dir = join(tmpdir(), "graphrefly-ts-storage-extension-negative");
		expect(() => fileBackend(dir, { extension: "/../../x" })).toThrow(/extension/);
		expect(() => fileBackend(dir, { extension: "..bin" })).toThrow(/extension/);
		expect(() => fileBackend(dir, { extension: "" })).toThrow(/extension/);
	});

	it("fileKv and fileAppendLog stay passive typed wrappers over fileBackend", async () => {
		const dir = makeTempDir();
		try {
			const kv = fileKv<{ value: string }>(dir, { namespace: "typed" });
			await kv.set("a", { value: "one" });
			expect(await kv.get("a")).toEqual({ value: "one" });
			expect(await kv.list()).toEqual(["a"]);

			const log = fileAppendLog<{ value: string }>(dir, {
				namespace: "typed-log",
				prefix: "events",
			});
			await log.append({ value: "first" });
			await log.append({ value: "second" });
			expect((await log.read()).map((entry) => [entry.seq, entry.value.value])).toEqual([
				[0, "first"],
				[1, "second"],
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("sqliteBackend validates table names before touching optional node:sqlite", () => {
		expect(() => sqliteBackend(":memory:", { tableName: "bad-name" })).toThrow(/tableName/);
		expect(() => sqliteBackend(":memory:", { tableName: "1bad" })).toThrow(/tableName/);
		expect(() => sqliteBackend(":memory:", { namespace: "bad\u0000namespace" })).toThrow(
			/namespace/,
		);
		expect(() => sqliteBackend(":memory:", { namespace: null as unknown as string })).toThrow(
			/namespace/,
		);
	});

	it("sqliteBackend exposes D108 versioned get/set-if-match when node:sqlite is available", async () => {
		let backend: ReturnType<typeof sqliteBackend>;
		try {
			backend = sqliteBackend(":memory:", { namespace: "d108" });
		} catch (error) {
			expect(String((error as Error).message)).toContain("node:sqlite is not available");
			return;
		}
		try {
			const versioned = requireStorageVersioned(backend, "sqliteBackend");
			expect(hasStorageVersioned(backend)).toBe(true);
			expect(() => backend.put("bad\u0000key", new Uint8Array([1]))).toThrow(/U\+0000/);
			expect(() => backend.get(1 as unknown as string)).toThrow(/key must be a string/);
			expect(() => backend.list("bad\u0000prefix")).toThrow(/U\+0000/);
			expect(() => backend.list(1 as unknown as string)).toThrow(/list prefix must be a string/);
			expect(() =>
				versioned.setIfMatch("bad\u0000key", new Uint8Array([1]), Object.freeze({})),
			).toThrow(/U\+0000/);

			const absent = await versioned.getVersioned("k");
			expect(absent.kind).toBe("miss");
			expect(await versioned.setIfMatch("k", new Uint8Array([1]), absent.generation)).toBe(true);
			expect(await versioned.setIfMatch("k", new Uint8Array([2]), absent.generation)).toBe(false);
			expect(await versioned.setIfMatch("other", new Uint8Array([9]), absent.generation)).toBe(
				false,
			);
			expect(await backend.get("k")).toEqual(new Uint8Array([1]));

			const otherBackend = sqliteBackend(":memory:", { namespace: "d108" });
			try {
				const otherVersioned = requireStorageVersioned(otherBackend, "sqliteBackend.other");
				expect(await otherVersioned.setIfMatch("k", new Uint8Array([8]), absent.generation)).toBe(
					false,
				);
				expect(await otherBackend.get("k")).toBeUndefined();
			} finally {
				otherBackend.close();
			}

			const present = await versioned.getVersioned("k");
			expect(present.kind).toBe("hit");
			if (present.kind === "hit") {
				present.value[0] = 7;
			}
			expect(await backend.get("k")).toEqual(new Uint8Array([1]));
			await backend.put("unrelated", new Uint8Array([9]));
			expect(await versioned.setIfMatch("k", new Uint8Array([2]), present.generation)).toBe(true);
			expect(await backend.get("k")).toEqual(new Uint8Array([2]));

			await backend.put("k", new Uint8Array([3]));
			expect(await versioned.setIfMatch("k", new Uint8Array([4]), present.generation)).toBe(false);

			const missBeforeCycle = await versioned.getVersioned("cycle");
			await backend.put("cycle", new Uint8Array([5]));
			await backend.delete("cycle");
			expect(
				await versioned.setIfMatch("cycle", new Uint8Array([6]), missBeforeCycle.generation),
			).toBe(false);

			const fresh = await versioned.getVersioned("k");
			expect(await versioned.setIfMatch("k", new Uint8Array([4]), fresh.generation)).toBe(true);
			expect(await backend.get("k")).toEqual(new Uint8Array([4]));
		} finally {
			backend.close();
		}
	});

	it("sqliteKv lifts D108 versioned support through the typed KV wrapper", async () => {
		let kv: ReturnType<typeof sqliteKv<{ value: number }>>;
		try {
			kv = sqliteKv<{ value: number }>(":memory:", { namespace: "typed-d108" });
		} catch (error) {
			expect(String((error as Error).message)).toContain("node:sqlite is not available");
			return;
		}
		try {
			const versioned = requireKvVersioned(kv, "sqliteKv");
			expect(hasKvVersioned(kv)).toBe(true);

			const absent = await versioned.getVersioned("item");
			expect(absent.kind).toBe("miss");
			await expect(versioned.setIfMatch("item", { value: 1 }, absent.generation)).resolves.toBe(
				true,
			);
			await expect(versioned.setIfMatch("item", { value: 2 }, absent.generation)).resolves.toBe(
				false,
			);
			expect(await kv.get("item")).toEqual({ value: 1 });

			const present = await versioned.getVersioned("item");
			await kv.set("item", { value: 3 });
			await expect(versioned.setIfMatch("item", { value: 4 }, present.generation)).resolves.toBe(
				false,
			);
			expect(await kv.get("item")).toEqual({ value: 3 });
		} finally {
			kv.close();
		}
	});

	it("memoryBackend clones Node Buffer inputs instead of storing shared views", async () => {
		const backend = memoryBackend();
		const input = Buffer.from([1, 2, 3]);

		expect(await backend.putIfAbsent("buf", input)).toBe(true);
		input[0] = 9;
		const stored = await backend.get("buf");
		expect([...stored!]).toEqual([1, 2, 3]);

		stored![1] = 8;
		expect([...(await backend.get("buf"))!]).toEqual([1, 2, 3]);
	});

	it("typed KV putIfAbsent respects codecs and preserves existing values", async () => {
		const backend = memoryBackend();
		const encoder = new TextEncoder();
		const decoder = new TextDecoder();
		const encode = vi.fn((value: { value: number }) => encoder.encode(`v:${value.value}`));
		const kv = kvStorage({
			backend,
			codec: {
				encode,
				decode: (bytes) => ({ value: Number(decoder.decode(bytes).slice(2)) }),
			},
		});

		expect(hasKvPutIfAbsent(kv)).toBe(true);
		expect(requireKvPutIfAbsent(kv)).toBe(kv);
		await expect(kv.putIfAbsent!("item", { value: 1 })).resolves.toBe(true);
		await expect(kv.putIfAbsent!("item", { value: 2 })).resolves.toBe(false);

		expect(encode.mock.calls.map(([value]) => value.value)).toEqual([1, 2]);
		expect(await kv.get("item")).toEqual({ value: 1 });
		expect(decoder.decode(await backend.get("item"))).toBe("v:1");
	});

	it("typed KV exposes D108 versioned capability only when the backend supports it", async () => {
		const kv = memoryKv<{ value: number }>();
		const versioned = requireKvVersioned(kv);

		expect(hasKvVersioned(kv)).toBe(true);
		const absent = await versioned.getVersioned("item");
		expect(absent.kind).toBe("miss");
		await expect(versioned.setIfMatch("item", { value: 1 }, absent.generation)).resolves.toBe(true);
		await expect(versioned.setIfMatch("item", { value: 2 }, absent.generation)).resolves.toBe(
			false,
		);
		expect(await kv.get("item")).toEqual({ value: 1 });

		const present = await versioned.getVersioned("item");
		expect(present).toMatchObject({ kind: "hit", value: { value: 1 } });
		await kv.set("item", { value: 3 });
		await expect(versioned.setIfMatch("item", { value: 4 }, present.generation)).resolves.toBe(
			false,
		);
		expect(await kv.get("item")).toEqual({ value: 3 });
	});

	it("kvStorage routes sync backend and codec failures through the returned Promise", async () => {
		const kv = kvStorage({
			backend: {
				get() {
					throw new Error("get boom");
				},
				put() {
					throw new Error("put boom");
				},
				list() {
					throw new Error("list boom");
				},
			},
		});

		await expect(kv.get("x")).rejects.toThrow("get boom");
		await expect(kv.set("x", { value: 1 })).rejects.toThrow("put boom");
		await expect(kv.list()).rejects.toThrow("list boom");
	});

	it("kvStorage omits putIfAbsent when the byte backend lacks the capability", () => {
		const kv = kvStorage({
			backend: {
				get: () => undefined,
				put: () => undefined,
				list: () => [],
			},
		});

		expect(hasKvPutIfAbsent(kv)).toBe(false);
		expect(hasKvVersioned(kv)).toBe(false);
		expect(() => requireKvPutIfAbsent(kv)).toThrow(/does not support putIfAbsent/);
		expect(() => requireKvVersioned(kv)).toThrow(/does not support versioned/);
	});

	it("append logs paginate by cursor and can truncate later entries", async () => {
		const log = memoryAppendLog<{ value: string }>("changes");
		await log.append({ value: "a" });
		await log.append({ value: "b" });
		await log.append({ value: "c" });

		expect((await log.read({ limit: 2 })).map((entry) => entry.value.value)).toEqual(["a", "b"]);
		expect((await log.read({ after: 0 })).map((entry) => entry.value.value)).toEqual(["b", "c"]);

		await log.truncateAfter(0);
		expect((await log.read()).map((entry) => [entry.seq, entry.value.value])).toEqual([[0, "a"]]);

		await log.append({ value: "d" });
		expect((await log.read()).map((entry) => [entry.seq, entry.value.value])).toEqual([
			[0, "a"],
			[1, "d"],
		]);
	});

	it("readAppendLogPage returns ordered pages with an explicit cursor", async () => {
		const log = memoryAppendLog<{ value: string }>("page");
		await log.append({ value: "a" });
		await log.append({ value: "b" });
		await log.append({ value: "c" });

		const first = await readAppendLogPage(log, { limit: 2 });
		expect(first.entries.map((entry) => [entry.seq, entry.value.value])).toEqual([
			[0, "a"],
			[1, "b"],
		]);
		expect(first.nextAfter).toBe(1);
		expect(first.done).toBe(false);

		const second = await readAppendLogPage(log, { after: first.nextAfter, limit: 2 });
		expect(second.entries.map((entry) => [entry.seq, entry.value.value])).toEqual([[2, "c"]]);
		expect(second.nextAfter).toBe(2);
		expect(second.done).toBe(true);
		expect(await readAppendLogPage(log, { after: second.nextAfter, limit: 2 })).toEqual({
			entries: [],
			nextAfter: 2,
			done: true,
		});
		expect(await readAppendLogPage(log, { after: 100, limit: 2 })).toEqual({
			entries: [],
			nextAfter: 100,
			done: true,
		});
		expect(() => readAppendLogPage(log, { limit: 0 })).toThrow(/positive safe integer/);
	});

	it("readAppendLogPage sorts unordered backend listings by sequence", async () => {
		const entries = new Map<string, { value: string }>([
			[appendLogKey("unordered", 10), { value: "c" }],
			[appendLogKey("unordered", 0), { value: "a" }],
			[appendLogKey("unordered", 2), { value: "b" }],
		]);
		const kv: KvStorageTier<{ value: string }> = {
			get: (key) => Promise.resolve(entries.get(key)),
			set: (key, value) => {
				entries.set(key, value);
				return Promise.resolve();
			},
			delete: (key) => {
				entries.delete(key);
				return Promise.resolve();
			},
			list: (prefix = "") =>
				Promise.resolve([...entries.keys()].filter((key) => key.startsWith(prefix))),
		};
		const log = appendLogStorage({ kv, prefix: "unordered" });

		const first = await readAppendLogPage(log, { limit: 2 });
		expect(first.entries.map((entry) => [entry.seq, entry.value.value])).toEqual([
			[0, "a"],
			[2, "b"],
		]);
		expect(first.nextAfter).toBe(2);
		expect(first.done).toBe(false);

		const second = await readAppendLogPage(log, { after: first.nextAfter, limit: 2 });
		expect(second.entries.map((entry) => [entry.seq, entry.value.value])).toEqual([[10, "c"]]);
		expect(second.done).toBe(true);
	});

	it("walFrameKey builds padded passive WAL storage keys", () => {
		const prefix = walFramePrefix("graph/main");
		expect(prefix).toBe("graph/main/wal");
		expect(walFramePrefix("")).toBe("wal");
		expect(walFrameKey(prefix, 7)).toBe("graph/main/wal/00000000000000000007");
		expect(() => walFrameKey(prefix, -1)).toThrow(/non-negative safe integer/);
		expect(() => walFrameKey(prefix, 1.5)).toThrow(/non-negative safe integer/);
	});

	it("walFrame produces stable checksums and detects tampering", async () => {
		const body = {
			t: "c",
			lifecycle: "data",
			path: "count",
			change: { op: "set", value: 1 },
			frame_seq: 2,
			frame_t_ns: "123",
			format_version: WAL_FORMAT_VERSION,
		} as const;

		const checksum = await walFrameChecksum(body);
		expect(checksum).toMatch(/^[0-9a-f]{64}$/);
		expect(await walFrameChecksum({ ...body })).toBe(checksum);
		expect(
			await walFrameChecksum({
				...body,
				change: JSON.parse('{"value":1,"op":"set"}') as { op: string; value: number },
			}),
		).toBe(checksum);

		const frame = await walFrame({
			path: body.path,
			change: body.change,
			frame_seq: body.frame_seq,
			frame_t_ns: body.frame_t_ns,
		});
		expect(frame).toMatchObject({
			t: "c",
			lifecycle: "data",
			path: "count",
			change: { op: "set", value: 1 },
			frame_seq: 2,
			frame_t_ns: "123",
			format_version: WAL_FORMAT_VERSION,
			checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
		});
		expect(await verifyWalFrameChecksum(frame)).toBe(true);
		expect(await verifyWalFrameChecksum({ ...frame, path: "other" })).toBe(false);
		expect(Object.keys(frame)).not.toEqual(
			expect.arrayContaining(["snapshot", "restore", "checkpoint", "factory"]),
		);
	});

	it("walFrameCodec validates passive frame shape without restore semantics", async () => {
		const frame = await walFrame({ path: "node", change: { event: "DATA" }, frame_seq: 0 });
		const codec = walFrameCodec<{ event: string }>();
		expect(codec.decode(codec.encode(frame))).toEqual(frame);
		expect(assertWalFrame(frame)).toEqual(frame);
		expect(() => assertWalFrame({ ...frame, checksum: "BAD" })).toThrow(/checksum/);
		expect(() =>
			codec.decode(
				strictJsonCodec.encode({
					...frame,
					t: "r",
				}),
			),
		).toThrow(/t must be c/);
		expect(() =>
			codec.decode(
				strictJsonCodec.encode({
					...frame,
					lifecycle: "restore",
				}),
			),
		).toThrow(/lifecycle/);
	});

	it("walFrameCodec rejects malformed strict JSON bytes before shape validation", async () => {
		const frame = await walFrame({ path: "node", change: { event: "DATA" }, frame_seq: 0 });
		const codec = walFrameCodec<{ event: string }>();
		const encoder = new TextEncoder();

		expect(() => codec.decode(encoder.encode('{"checksum":"bad","checksum":"also-bad"}'))).toThrow(
			/duplicate object key/,
		);
		expect(() =>
			codec.decode(encoder.encode(`{"path":"node","checksum":"${frame.checksum}"}`)),
		).toThrow(/canonical/);
		expect(() => codec.decode(encoder.encode('"\\ud800"'))).toThrow(/unpaired surrogate/);
	});

	it("wal frame shape checks reject malformed passive frames", async () => {
		const frame = await walFrame({ path: "node", change: { event: "DATA" }, frame_seq: 0 });
		const { change: _change, checksum: _checksum, ...missingChange } = frame;

		expect(() => assertWalFrame(missingChange)).toThrow(/change payload/);
		expect(() => assertWalFrame({ ...frame, restore: true })).toThrow(/unknown field restore/);
		expect(() => assertWalFrame({ ...frame, checkpoint: { nodes: [] } })).toThrow(
			/unknown field checkpoint/,
		);
		expect(() => assertWalFrame({ ...frame, path: "" })).toThrow(/path/);
		expect(() => assertWalFrame({ ...frame, lifecycle: "restore" })).toThrow(/lifecycle/);
		expect(() => assertWalFrame({ ...frame, frame_seq: -1 })).toThrow(/frame_seq/);
		expect(() => assertWalFrame({ ...frame, frame_t_ns: "01" })).toThrow(/frame_t_ns/);
		expect(() => assertWalFrame({ ...frame, format_version: WAL_FORMAT_VERSION + 1 })).toThrow(
			/format_version/,
		);
		expect(() => assertWalFrame({ ...frame, checksum: "BAD" })).toThrow(/checksum/);
		await expect(walFrameChecksum({ ...frame, change: "\uD800" })).rejects.toThrow(
			/unknown field checksum/,
		);
		await expect(walFrameChecksum({ ...missingChange, change: "\uD800" })).rejects.toThrow(
			/unpaired surrogate/,
		);
	});

	it("walFrameCodec rejects restore-shaped extra fields instead of stripping them", async () => {
		const frame = await walFrame({ path: "node", change: { event: "DATA" }, frame_seq: 0 });
		const codec = walFrameCodec<{ event: string }>();

		expect(() => codec.decode(strictJsonCodec.encode({ ...frame, restore: true }))).toThrow(
			/unknown field restore/,
		);
		await expect(verifyWalFrameChecksum({ ...frame, checkpoint: { nodes: [] } })).rejects.toThrow(
			/unknown field checkpoint/,
		);
	});

	it("wal frames store and page as ordinary append-log facts", async () => {
		const log = memoryAppendLog<WalFrame<{ value: string }>>("wal-store");
		await log.append(await walFrame({ path: "a", change: { value: "a" }, frame_seq: 0 }));
		await log.append(await walFrame({ path: "b", change: { value: "b" }, frame_seq: 1 }));
		await log.append(await walFrame({ path: "c", change: { value: "c" }, frame_seq: 2 }));

		const page = await readAppendLogPage(log, { limit: 2 });
		expect(
			page.entries.map((entry) => [entry.seq, entry.value.frame_seq, entry.value.path]),
		).toEqual([
			[0, 0, "a"],
			[1, 1, "b"],
		]);
		expect(page.done).toBe(false);
		expect((await readAppendLogPage(log, { after: page.nextAfter })).entries[0]?.value.path).toBe(
			"c",
		);
	});

	it("append logs refresh sequence allocation across sequential shared handles", async () => {
		const kv = memoryKv<{ value: string }>();
		const a = appendLogStorage({ kv, prefix: "shared" });
		const b = appendLogStorage({ kv, prefix: "shared" });

		await a.append({ value: "a" });
		await b.append({ value: "b" });

		expect((await a.read()).map((entry) => [entry.seq, entry.value.value])).toEqual([
			[0, "a"],
			[1, "b"],
		]);
	});

	it("plain append logs remain single-writer and can collide under competing handles", async () => {
		const entries = new Map<string, { value: string }>();
		const heldLists: Array<() => void> = [];
		let heldListCount = 2;
		const listKeys = (prefix = "") =>
			[...entries.keys()].filter((key) => key.startsWith(prefix)).sort();
		const kv: KvStorageTier<{ value: string }> = {
			get: (key) => Promise.resolve(entries.get(key)),
			set: (key, value) => {
				entries.set(key, value);
				return Promise.resolve();
			},
			delete: (key) => {
				entries.delete(key);
				return Promise.resolve();
			},
			list: (prefix = "") => {
				if (heldListCount > 0) {
					heldListCount -= 1;
					return new Promise<readonly string[]>((resolve) => {
						heldLists.push(() => resolve(listKeys(prefix)));
					});
				}
				return Promise.resolve(listKeys(prefix));
			},
		};
		const a = appendLogStorage({ kv, prefix: "race" });
		const b = appendLogStorage({ kv, prefix: "race" });

		const appendA = a.append({ value: "a" });
		const appendB = b.append({ value: "b" });
		await Promise.resolve();
		expect(heldLists).toHaveLength(2);
		for (const release of heldLists) release();

		const written = await Promise.all([appendA, appendB]);
		expect(written.map((entry) => entry.seq)).toEqual([0, 0]);
		expect((await a.read()).map((entry) => entry.seq)).toEqual([0]);
		expect(await a.size()).toBe(1);
	});

	it("append logs reject malformed keys under the log prefix", async () => {
		const kv = memoryKv<{ value: string }>();
		await kv.set("bad/meta", { value: "oops" });
		const log = appendLogStorage({ kv, prefix: "bad" });

		await expect(log.append({ value: "a" })).rejects.toThrow(/non-numeric sequence/);

		const unpadded = memoryKv<{ value: string }>();
		await unpadded.set("bad-pad/1", { value: "oops" });
		await expect(appendLogStorage({ kv: unpadded, prefix: "bad-pad" }).read()).rejects.toThrow(
			/padded digits/,
		);
		await expect(appendLogStorage({ kv: unpadded, prefix: "bad-pad" }).size()).rejects.toThrow(
			/padded digits/,
		);
	});

	it("append logs reject unsafe sequence allocation before writing", async () => {
		const kv = memoryKv<{ value: string }>();
		await kv.set(appendLogKey("max", Number.MAX_SAFE_INTEGER), { value: "max" });
		const log = appendLogStorage({ kv, prefix: "max" });

		await expect(log.append({ value: "overflow" })).rejects.toThrow(/safe integer/);
		expect(await kv.list("max/")).toEqual([appendLogKey("max", Number.MAX_SAFE_INTEGER)]);
	});

	it("append-log reads validate cursors, limits, and listed key presence", async () => {
		const kv = memoryKv<{ value: string }>();
		const log = appendLogStorage({ kv, prefix: "opts" });
		await log.append({ value: "a" });

		await expect(log.read({ after: Number.NaN })).rejects.toThrow(/after/);
		await expect(log.read({ after: 0.5 })).rejects.toThrow(/after/);
		await expect(log.read({ limit: -1 })).rejects.toThrow(/limit/);
		await expect(log.read({ limit: 0.5 })).rejects.toThrow(/limit/);
		expect(await log.read({ limit: 0 })).toEqual([]);

		const torn: KvStorageTier<{ value: string }> = {
			get: () => Promise.resolve(undefined),
			set: () => Promise.resolve(),
			delete: () => Promise.resolve(),
			list: () => Promise.resolve(["torn/00000000000000000000"]),
		};
		await expect(appendLogStorage({ kv: torn, prefix: "torn" }).read()).rejects.toThrow(
			/listed key is missing/,
		);
	});

	it("readAppendLogPage propagates malformed sequence keys and missing listed values", async () => {
		const malformed = memoryKv<{ value: string }>();
		await malformed.set(appendLogKey("strict-page", 0), { value: "a" });
		await malformed.set("strict-page/not-a-sequence", { value: "bad" });
		const malformedLog = appendLogStorage({ kv: malformed, prefix: "strict-page" });

		await expect(readAppendLogPage(malformedLog)).rejects.toThrow(/non-numeric sequence/);

		const torn: KvStorageTier<{ value: string }> = {
			get: (key) =>
				Promise.resolve(key === appendLogKey("strict-torn", 0) ? { value: "a" } : undefined),
			set: () => Promise.resolve(),
			delete: () => Promise.resolve(),
			list: () => Promise.resolve([appendLogKey("strict-torn", 0), appendLogKey("strict-torn", 1)]),
		};
		const tornLog = appendLogStorage({ kv: torn, prefix: "strict-torn" });

		await expect(readAppendLogPage(tornLog)).rejects.toThrow(/listed key is missing/);
	});

	it("readAppendLogPage continues deterministically across gaps after deletion between pages", async () => {
		const kv = memoryKv<{ value: string }>();
		const log = appendLogStorage({ kv, prefix: "gapped" });
		await log.append({ value: "a" });
		await log.append({ value: "b" });
		await log.append({ value: "c" });
		await log.append({ value: "d" });

		const first = await readAppendLogPage(log, { limit: 1 });
		expect(first.entries.map((entry) => [entry.seq, entry.value.value])).toEqual([[0, "a"]]);

		await kv.delete(appendLogKey("gapped", 1));
		const second = await readAppendLogPage(log, { after: first.nextAfter, limit: 2 });
		expect(second.entries.map((entry) => [entry.seq, entry.value.value])).toEqual([
			[2, "c"],
			[3, "d"],
		]);
		expect(second.nextAfter).toBe(3);
		expect(second.done).toBe(true);
	});

	it("append logs serialize concurrent appends without reusing a sequence", async () => {
		const log = memoryAppendLog<{ value: string }>("concurrent");

		await Promise.all([log.append({ value: "a" }), log.append({ value: "b" })]);

		expect((await log.read()).map((entry) => entry.seq)).toEqual([0, 1]);
		expect(await log.size()).toBe(2);
	});

	it("multi-writer append logs reject KV tiers without putIfAbsent clearly", () => {
		const kv: KvStorageTier<{ value: string }> = {
			get: () => Promise.resolve(undefined),
			set: () => Promise.resolve(),
			delete: () => Promise.resolve(),
			list: () => Promise.resolve([]),
		};

		expect(() => multiWriterAppendLogStorage({ kv, prefix: "unsupported" })).toThrow(/putIfAbsent/);
	});

	it("multi-writer append logs reject kvStorage backed by plain byte KV", () => {
		const kv = kvStorage<{ value: string }>({
			backend: {
				get: () => undefined,
				put: () => undefined,
				list: () => [],
			},
		});

		expect(() => multiWriterAppendLogStorage({ kv, prefix: "plain-byte" })).toThrow(/putIfAbsent/);
	});

	it("multi-writer append logs retry conditional creates into unique ordered sequence keys", async () => {
		const entries = new Map<string, { value: string }>();
		const heldLists: Array<() => void> = [];
		let heldListCount = 2;
		const listKeys = (prefix = "") =>
			[...entries.keys()].filter((key) => key.startsWith(prefix)).sort();
		const kv: KvStorageTier<{ value: string }> = {
			get: (key) => Promise.resolve(entries.get(key)),
			set: (key, value) => {
				entries.set(key, value);
				return Promise.resolve();
			},
			putIfAbsent: (key, value) => {
				if (entries.has(key)) return Promise.resolve(false);
				entries.set(key, value);
				return Promise.resolve(true);
			},
			delete: (key) => {
				entries.delete(key);
				return Promise.resolve();
			},
			list: (prefix = "") => {
				if (heldListCount > 0) {
					heldListCount -= 1;
					return new Promise<readonly string[]>((resolve) => {
						heldLists.push(() => resolve(listKeys(prefix)));
					});
				}
				return Promise.resolve(listKeys(prefix));
			},
		};
		const a = multiWriterAppendLogStorage({ kv, prefix: "mw" });
		const b = multiWriterAppendLogStorage({ kv, prefix: "mw" });

		const appendA = a.append({ value: "a" });
		const appendB = b.append({ value: "b" });
		await Promise.resolve();
		expect(heldLists).toHaveLength(2);
		for (const release of heldLists) release();

		const written = await Promise.all([appendA, appendB]);
		expect(written.map((entry) => entry.seq).sort((x, y) => x - y)).toEqual([0, 1]);
		expect([...entries.keys()]).toEqual(["mw/00000000000000000000", "mw/00000000000000000001"]);
		expect((await a.read()).map((entry) => [entry.seq, entry.value.value])).toEqual([
			[0, "a"],
			[1, "b"],
		]);
	});

	it("multi-writer append logs refresh the listed tail after a retry window", async () => {
		const entries = new Map<string, { value: string }>([
			["refresh/00000000000000000000", { value: "existing-0" }],
			["refresh/00000000000000000001", { value: "existing-1" }],
		]);
		let staleList = true;
		const kv: KvStorageTier<{ value: string }> = {
			get: (key) => Promise.resolve(entries.get(key)),
			set: (key, value) => {
				entries.set(key, value);
				return Promise.resolve();
			},
			putIfAbsent: (key, value) => {
				if (entries.has(key)) return Promise.resolve(false);
				entries.set(key, value);
				return Promise.resolve(true);
			},
			delete: (key) => {
				entries.delete(key);
				return Promise.resolve();
			},
			list: (prefix = "") => {
				if (staleList) {
					staleList = false;
					return Promise.resolve([]);
				}
				return Promise.resolve([...entries.keys()].filter((key) => key.startsWith(prefix)).sort());
			},
		};
		const log = multiWriterAppendLogStorage({ kv, prefix: "refresh", maxAttempts: 2 });

		await expect(log.append({ value: "new" })).resolves.toMatchObject({
			key: "refresh/00000000000000000002",
			seq: 2,
		});
		expect((await log.read()).map((entry) => [entry.seq, entry.value.value])).toEqual([
			[0, "existing-0"],
			[1, "existing-1"],
			[2, "new"],
		]);
	});

	it("multi-writer append logs reject truncate without a stronger compaction capability", async () => {
		const log = memoryMultiWriterAppendLog<{ value: string }>("mw-truncate");
		await log.append({ value: "a" });

		await expect(log.truncateAfter(0)).rejects.toThrow(/unsupported/);
		expect((await log.read()).map((entry) => entry.value.value)).toEqual(["a"]);
	});

	it("memoryMultiWriterAppendLog uses putIfAbsent-backed allocation", async () => {
		const log = memoryMultiWriterAppendLog<{ value: string }>("memory-mw");

		await Promise.all([log.append({ value: "a" }), log.append({ value: "b" })]);

		expect((await log.read()).map((entry) => entry.seq)).toEqual([0, 1]);
	});

	it("multi-writer append-log size rejects malformed listed sequence keys", async () => {
		const kv = memoryKv<{ value: string }>();
		await kv.set("mw-bad/1", { value: "oops" });
		const log = multiWriterAppendLogStorage({ kv: requireKvPutIfAbsent(kv), prefix: "mw-bad" });

		await expect(log.size()).rejects.toThrow(/padded digits/);
	});

	it("append-log reads are serialized before later mutations", async () => {
		const entries = new Map<string, { value: string }>();
		let holdNextList = false;
		let releaseList: (() => void) | null = null;
		const kv: KvStorageTier<{ value: string }> = {
			get: (key) => Promise.resolve(entries.get(key)),
			set: (key, value) => {
				entries.set(key, value);
				return Promise.resolve();
			},
			delete: (key) => {
				entries.delete(key);
				return Promise.resolve();
			},
			list: (prefix = "") => {
				if (!holdNextList) {
					return Promise.resolve(
						[...entries.keys()].filter((key) => key.startsWith(prefix)).sort(),
					);
				}
				holdNextList = false;
				return new Promise<readonly string[]>((resolve) => {
					releaseList = () =>
						resolve([...entries.keys()].filter((key) => key.startsWith(prefix)).sort());
				});
			},
		};
		const log = appendLogStorage({ kv, prefix: "ordered" });
		await log.append({ value: "a" });

		holdNextList = true;
		const read = log.read();
		const append = log.append({ value: "b" });
		await Promise.resolve();
		expect(releaseList).not.toBeNull();
		releaseList?.();

		expect((await read).map((entry) => entry.value.value)).toEqual(["a"]);
		await append;
		expect((await log.read()).map((entry) => entry.value.value)).toEqual(["a", "b"]);
	});

	it("attachObserveEventLog persists observe DATA frames in observe sequence order", async () => {
		const g = graph();
		const count = g.state(0, { name: "count" });
		const log = memoryAppendLog<ObserveEventFrame<number>>("observe");

		const handle = attachObserveEventLog<number>(g, log, {
			path: "count",
			map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
		});

		count.set(1);
		count.set(2);
		await awaitDone((done) => handle.flush(done));

		const frames = (await log.read()).map((entry) => entry.value);
		expect(frames.map((frame) => frame.change)).toEqual([0, 1, 2]);
		expect(frames.map((frame) => frame.path)).toEqual(["count", "count", "count"]);
		expect(frames.map((frame) => frame.observeSeq)).toEqual(
			[...frames.map((frame) => frame.observeSeq)].sort((a, b) => a - b),
		);

		await awaitDone((done) => handle.dispose(done));
		count.set(3);
		await awaitDone((done) => handle.flush(done));
		expect((await log.read()).map((entry) => entry.value.change)).toEqual([0, 1, 2]);
	});

	it("readObserveEventLogPage returns ordered observe frames without projection", async () => {
		const log = memoryAppendLog<ObserveEventFrame<number>>("observe-page");
		await log.append(observeEventFrame({ path: "count", msg: ["DATA", 1], tier: 3, seq: 1 }, 1));
		await log.append(observeEventFrame({ path: "count", msg: ["DATA", 2], tier: 3, seq: 2 }, 2));

		const page = await readObserveEventLogPage(log, { limit: 1 });
		expect(page.entries.map((entry) => entry.value.change)).toEqual([1]);
		expect(page.entries[0]?.value.observeSeq).toBe(1);
		expect(page.done).toBe(false);

		const rest = await readObserveEventLogPage(log, { after: page.nextAfter, limit: 1 });
		expect(rest.entries.map((entry) => entry.value.change)).toEqual([2]);
		expect(rest.done).toBe(true);
	});

	it("readObserveEventLogPage orders by append sequence, not graph projection semantics", async () => {
		const entries = new Map<string, ObserveEventFrame<number>>([
			[
				appendLogKey("observe-unordered", 10),
				observeEventFrame({ path: "count", msg: ["DATA", 3], tier: 3, seq: 7 }, 3),
			],
			[
				appendLogKey("observe-unordered", 0),
				observeEventFrame({ path: "count", msg: ["DATA", 1], tier: 3, seq: 10 }, 1),
			],
			[
				appendLogKey("observe-unordered", 2),
				observeEventFrame({ path: "count", msg: ["DATA", 2], tier: 3, seq: 5 }, 2),
			],
		]);
		const kv: KvStorageTier<ObserveEventFrame<number>> = {
			get: (key) => Promise.resolve(entries.get(key)),
			set: (key, value) => {
				entries.set(key, value);
				return Promise.resolve();
			},
			delete: (key) => {
				entries.delete(key);
				return Promise.resolve();
			},
			list: (prefix = "") =>
				Promise.resolve([...entries.keys()].filter((key) => key.startsWith(prefix))),
		};
		const log = appendLogStorage({ kv, prefix: "observe-unordered" });

		const page = await readObserveEventLogPage(log, { limit: 3 });
		expect(page.entries.map((entry) => [entry.seq, entry.value.change])).toEqual([
			[0, 1],
			[2, 2],
			[10, 3],
		]);
		expect(page.entries.map((entry) => entry.value.observeSeq)).toEqual([10, 5, 7]);
		expect(page.done).toBe(true);
	});

	it("readObserveEventLogPage propagates append-log iteration failures", async () => {
		const torn: KvStorageTier<ObserveEventFrame<number>> = {
			get: () => Promise.resolve(undefined),
			set: () => Promise.resolve(),
			delete: () => Promise.resolve(),
			list: () => Promise.resolve([appendLogKey("observe-torn", 0)]),
		};
		const tornLog = appendLogStorage({ kv: torn, prefix: "observe-torn" });

		await expect(readObserveEventLogPage(tornLog)).rejects.toThrow(/listed key is missing/);

		const malformed = memoryKv<ObserveEventFrame<number>>();
		await malformed.set(
			"observe-bad/not-a-sequence",
			observeEventFrame({ path: "count", msg: ["DATA", 1], tier: 3, seq: 1 }, 1),
		);
		const malformedLog = appendLogStorage({ kv: malformed, prefix: "observe-bad" });

		await expect(readObserveEventLogPage(malformedLog)).rejects.toThrow(/non-numeric sequence/);
	});

	it("change and observe-event codecs validate D82 storage frames only", () => {
		const changeCodec = changeEnvelopeCodec<{ op: string }>();
		const encodedChange = changeCodec.encode({
			lifecycle: "data",
			structure: "kv-change",
			version: 1,
			t_ns: "123",
			seq: 0,
			change: { op: "set" },
		});
		expect(changeCodec.decode(encodedChange).change).toEqual({ op: "set" });
		expect(() =>
			changeCodec.decode(
				strictJsonCodec.encode({
					lifecycle: "restore",
					structure: "kv-change",
					version: 1,
					t_ns: "123",
					change: {},
				}),
			),
		).toThrow(/lifecycle/);
		expect(() =>
			changeCodec.decode(new TextEncoder().encode('{"change":{},"change":{"op":"set"}}')),
		).toThrow(/duplicate object key/);
		expect(() =>
			changeCodec.decode(
				new TextEncoder().encode(
					'{"lifecycle":"data","structure":"kv-change","version":1,"t_ns":"123","change":{}}',
				),
			),
		).toThrow(/canonical/);

		const frame = observeEventFrame(
			{ path: "count", msg: ["DATA", 1], tier: 3, seq: 7 },
			{ value: 1 },
			{ stream: "audit" },
		);
		const frameCodec = observeEventFrameCodec<{ value: number }>();
		expect(frame).toMatchObject({
			structure: "observe-event",
			version: 1,
			t_ns: expect.any(String),
			stream: "audit",
			observeSeq: 7,
			path: "count",
			change: { value: 1 },
		});
		expect(frame.t_ns).toMatch(/^(0|[1-9]\d*)$/);
		expect(frameCodec.decode(frameCodec.encode(frame))).toEqual(frame);
		expect(() =>
			frameCodec.decode(new TextEncoder().encode('{"change":{},"change":{"value":1}}')),
		).toThrow(/duplicate object key/);
		expect(() =>
			frameCodec.decode(
				new TextEncoder().encode(
					'{"lifecycle":"data","structure":"observe-event","version":1,"t_ns":"123","change":{},"observeSeq":1,"path":"count"}',
				),
			),
		).toThrow(/canonical/);
		expect(Object.keys(frame)).not.toEqual(
			expect.arrayContaining(["snapshot", "restore", "checkpoint", "factory"]),
		);
	});

	it("root and storage exports expose D82 helpers while storage-shaped snapshot/restore names stay absent", () => {
		for (const exports of [rootExports, storageExports]) {
			expect(exports.contentAddressedKv).toBe(contentAddressedKv);
			expect(exports.contentAddressedStorage).toBe(contentAddressedStorage);
			expect(exports.changeEnvelopeCodec).toBe(changeEnvelopeCodec);
			expect(exports.observeEventFrameCodec).toBe(observeEventFrameCodec);
			expect(exports.nowNs).toBe(nowNs);
			expect(exports.assertDecimalIntegerString).toBe(assertDecimalIntegerString);
			expect(exports.assertNonNegativeDecimalIntegerString).toBe(
				assertNonNegativeDecimalIntegerString,
			);
			expect(exports.bigIntToDecimalString).toBe(bigIntToDecimalString);
			expect(exports.bigIntToNonNegativeDecimalString).toBe(bigIntToNonNegativeDecimalString);
			expect(exports.decimalStringToBigInt).toBe(decimalStringToBigInt);
			expect(exports.isDecimalIntegerString).toBe(isDecimalIntegerString);
			expect(exports.isNonNegativeDecimalIntegerString).toBe(isNonNegativeDecimalIntegerString);
			expect(exports.nonNegativeDecimalStringToBigInt).toBe(nonNegativeDecimalStringToBigInt);
			expect(exports.strictJsonCodec).toBe(strictJsonCodec);
			expect(exports.strictJsonCodecFor).toBe(strictJsonCodecFor);
			if (exports === rootExports) {
				expect(Reflect.get(exports, "strictCanonicalJsonBytes")).toBe(strictCanonicalJsonBytes);
			} else {
				expect("strictCanonicalJsonBytes" in exports).toBe(false);
			}
			expect(exports.hasKvPutIfAbsent).toBe(hasKvPutIfAbsent);
			expect(exports.hasStoragePutIfAbsent).toBe(hasStoragePutIfAbsent);
			expect(exports.hasKvVersioned).toBe(hasKvVersioned);
			expect(exports.hasStorageVersioned).toBe(hasStorageVersioned);
			expect(exports.webStorageBackend).toBe(webStorageBackend);
			expect(exports.memoryBackend).toBe(memoryBackend);
			expect(exports.memoryMultiWriterAppendLog).toBe(memoryMultiWriterAppendLog);
			expect(exports.multiWriterAppendLogStorage).toBe(multiWriterAppendLogStorage);
			expect(exports.readAppendLogPage).toBe(readAppendLogPage);
			expect(exports.readObserveEventLogPage).toBe(readObserveEventLogPage);
			expect(exports.readThroughKv).toBe(readThroughKv);
			expect(exports.tieredReadThrough).toBe(tieredReadThrough);
			expect(exports.requireKvPutIfAbsent).toBe(requireKvPutIfAbsent);
			expect(exports.requireStoragePutIfAbsent).toBe(requireStoragePutIfAbsent);
			expect(exports.requireKvVersioned).toBe(requireKvVersioned);
			expect(exports.requireStorageVersioned).toBe(requireStorageVersioned);
			expect(exports.walFrame).toBe(walFrame);
			expect(exports.walFrameChecksum).toBe(walFrameChecksum);
			expect(exports.verifyWalFrameChecksum).toBe(verifyWalFrameChecksum);
			expect(exports.walFrameCodec).toBe(walFrameCodec);
			expect(exports.walFrameKey).toBe(walFrameKey);
			expect(exports.walFramePrefix).toBe(walFramePrefix);
			expect(exports.assertWalFrame).toBe(assertWalFrame);
			expect("attachSnapshotStorage" in exports).toBe(false);
			expect("restoreSnapshot" in exports).toBe(false);
			expect("replayWal" in exports).toBe(false);
			expect("GraphRestore" in exports).toBe(false);
			expect("assertNodeVersionDataCompatible" in exports).toBe(false);
			expect("snapshotNodeVersionData" in exports).toBe(false);
		}
		expect(rootExports.restoreGraph).toBe(restoreGraph);
		expect("restoreGraph" in storageExports).toBe(false);
		expect("attachObserveSink" in rootExports).toBe(false);
		expect("attachObserveEventLog" in rootExports).toBe(false);
		expect(observeStorageExports.attachObserveSink).toBe(attachObserveSink);
		expect(observeStorageExports.attachObserveEventLog).toBe(attachObserveEventLog);
		expect("attachObserveSink" in storageExports).toBe(false);
		expect("attachObserveEventLog" in storageExports).toBe(false);
		expect(typeof graph().checkpoint).toBe("function");
		expect("restoreSnapshot" in graph()).toBe(false);
	});
});
