import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import type {
	KvStorageTier,
	ObserveEvent,
	ObserveEventFrame,
	ObserveSinkErrorContext,
} from "../index.js";
import * as rootExports from "../index.js";
import {
	appendLogStorage,
	assertDecimalIntegerString,
	assertNonNegativeDecimalIntegerString,
	attachObserveEventLog,
	attachObserveSink,
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
	hasStoragePutIfAbsent,
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
	requireKvPutIfAbsent,
	requireStoragePutIfAbsent,
	stableJsonString,
	strictJsonCodec,
	strictJsonCodecFor,
} from "../index.js";
import * as storageExports from "../storage/index.js";

const flushMicrotasks = async (turns = 1) => {
	for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

const awaitDone = (run: (done: () => void) => void) =>
	new Promise<void>((resolve) => {
		run(resolve);
	});

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
			new TextEncoder().encode(
				JSON.stringify({
					lifecycle: "data",
					structure: "kv-change",
					version: 1,
					t_ns,
					change: { op: "set" },
				}),
			);

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
	});

	it("memoryKv stores encoded values and lists keys by prefix in order", async () => {
		const kv = memoryKv<{ value: number }>();
		await kv.set("items/002", { value: 2 });
		await kv.set("other/001", { value: 9 });
		await kv.set("items/001", { value: 1 });

		expect(await kv.get("items/001")).toEqual({ value: 1 });
		expect(await listByPrefix(kv, "items/")).toEqual(["items/001", "items/002"]);
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
		expect(() => requireKvPutIfAbsent(kv)).toThrow(/does not support putIfAbsent/);
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
	});

	it("append logs reject unsafe sequence allocation before writing", async () => {
		const kv = memoryKv<{ value: string }>();
		await kv.set(`max/${Number.MAX_SAFE_INTEGER}`, { value: "max" });
		const log = appendLogStorage({ kv, prefix: "max" });

		await expect(log.append({ value: "overflow" })).rejects.toThrow(/safe integer/);
		expect(await kv.list("max/")).toEqual([`max/${Number.MAX_SAFE_INTEGER}`]);
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
				new TextEncoder().encode(
					JSON.stringify({
						lifecycle: "restore",
						structure: "kv-change",
						version: 1,
						t_ns: "123",
						change: {},
					}),
				),
			),
		).toThrow(/lifecycle/);

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
		expect(Object.keys(frame)).not.toEqual(
			expect.arrayContaining(["snapshot", "restore", "checkpoint", "factory"]),
		);
	});

	it("root and storage exports expose D82 helpers while snapshot/restore names stay absent", () => {
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
			expect(exports.hasKvPutIfAbsent).toBe(hasKvPutIfAbsent);
			expect(exports.hasStoragePutIfAbsent).toBe(hasStoragePutIfAbsent);
			expect(exports.memoryBackend).toBe(memoryBackend);
			expect(exports.memoryMultiWriterAppendLog).toBe(memoryMultiWriterAppendLog);
			expect(exports.multiWriterAppendLogStorage).toBe(multiWriterAppendLogStorage);
			expect(exports.requireKvPutIfAbsent).toBe(requireKvPutIfAbsent);
			expect(exports.requireStoragePutIfAbsent).toBe(requireStoragePutIfAbsent);
			expect("attachSnapshotStorage" in exports).toBe(false);
			expect("checkpoint" in exports).toBe(false);
			expect("restoreGraph" in exports).toBe(false);
			expect("restoreSnapshot" in exports).toBe(false);
			expect("GraphRestore" in exports).toBe(false);
		}
		expect("checkpoint" in graph()).toBe(false);
		expect("restoreSnapshot" in graph()).toBe(false);
	});
});
