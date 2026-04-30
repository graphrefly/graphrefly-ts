/**
 * Session 1 — Foundation layer tests for the Wave A implementation effort.
 *
 * Covers:
 * - `src/extra/http-error.ts` → `makeHttpError`
 * - `src/extra/operators.ts` → `onFirstData` / `tapFirst`
 * - `src/extra/sources.ts` → `nodeSignal`, `awaitSettled({ skipCurrent })`
 * - `src/extra/adapters.ts` → `parseSSEStream`
 * - `src/extra/reactive-map.ts` → `retention` option
 * - `src/extra/content-addressed-storage.ts` → `contentAddressedStorage`, `canonicalJson`
 */

import { describe, expect, it, vi } from "vitest";
import { DATA } from "../../core/messages.js";
import { node } from "../../core/node.js";

import { fromSSE, parseSSEStream } from "../../extra/adapters.js";
import {
	ContentAddressedMissError,
	canonicalJson,
	contentAddressedStorage,
} from "../../extra/content-addressed-storage.js";
import { makeHttpError } from "../../extra/http-error.js";
import { onFirstData, tapFirst } from "../../extra/operators.js";
import { reactiveMap } from "../../extra/reactive-map.js";
import { awaitSettled, fromAny, nodeSignal } from "../../extra/sources.js";
import { memoryKv } from "../../extra/storage-tiers.js";
import { collect } from "../test-helpers.js";

// ─── makeHttpError ────────────────────────────────────────────────────────

describe("makeHttpError (Wave A Unit 12)", () => {
	it("stamps status + headers + message with provider prefix", async () => {
		const resp = new Response("rate limited", {
			status: 429,
			statusText: "Too Many Requests",
			headers: { "retry-after": "30" },
		});
		const err = (await makeHttpError(resp, "anthropic")) as Error & {
			status: number;
			headers: Headers;
		};
		expect(err.status).toBe(429);
		expect(err.headers.get("retry-after")).toBe("30");
		expect(err.message).toMatch(/^anthropic API 429:/);
		expect(err.message).toMatch(/rate limited/);
	});

	it("defaults to HTTP prefix when no provider given", async () => {
		const resp = new Response("nope", { status: 500, statusText: "Internal Server Error" });
		const err = await makeHttpError(resp);
		expect(err.message).toMatch(/^HTTP API 500:/);
	});

	it("swallows body-read errors and still returns an error with status", async () => {
		// Response whose `text()` rejects — simulate a broken body stream.
		const resp = {
			status: 502,
			statusText: "Bad Gateway",
			headers: new Headers(),
			text: () => Promise.reject(new Error("body unreadable")),
		} as unknown as Response;
		const err = (await makeHttpError(resp, "openai")) as Error & { status: number };
		expect(err.status).toBe(502);
		expect(err.message).toMatch(/^openai API 502:/);
		// No body appended (empty after fallback).
		expect(err.message).not.toMatch(/—/);
	});
});

// ─── onFirstData / tapFirst ───────────────────────────────────────────────

describe("onFirstData / tapFirst (Wave A cross-cutting)", () => {
	it("fires once on the first non-null DATA; passes subsequent values through", () => {
		const src = node<number | null>([], { initial: null });
		const calls: number[] = [];
		const wrapped = onFirstData(src, (v) => calls.push(v as number));
		const { unsub } = collect(wrapped);
		src.emit(1);
		src.emit(2);
		src.emit(3);
		unsub();
		expect(calls).toEqual([1]);
	});

	it("does not count null as 'first' by default", () => {
		const src = node<number | null>([], { initial: null });
		const calls: number[] = [];
		const wrapped = onFirstData(src, (v) => calls.push(v as number));
		const { unsub } = collect(wrapped);
		// Cached null pushed on subscribe. Should NOT fire.
		expect(calls).toEqual([]);
		src.emit(42);
		unsub();
		expect(calls).toEqual([42]);
	});

	it("custom where predicate overrides the null default", () => {
		const src = node<number>([], { initial: 0 });
		const calls: number[] = [];
		const wrapped = onFirstData(src, (v) => calls.push(v), {
			where: (v) => v >= 10,
		});
		const { unsub } = collect(wrapped);
		src.emit(1);
		src.emit(2);
		src.emit(15);
		src.emit(20);
		unsub();
		expect(calls).toEqual([15]);
	});

	it("forwards values unchanged", () => {
		const src = node<number>([], { initial: 5 });
		const wrapped = onFirstData(src, () => {});
		const { messages, unsub } = collect(wrapped, { flat: true });
		src.emit(10);
		src.emit(20);
		unsub();
		const dataValues = messages.filter((m) => m[0] === DATA).map((m) => m[1]);
		// push-on-subscribe delivers 5, then emit(10), emit(20).
		expect(dataValues).toEqual([5, 10, 20]);
	});

	it("tapFirst is an alias for onFirstData", () => {
		expect(tapFirst).toBe(onFirstData);
	});
});

// ─── nodeSignal ───────────────────────────────────────────────────────────

describe("nodeSignal (Wave A Unit 4 / Unit 11)", () => {
	it("fires abort when the node emits true", () => {
		const aborted = node([], { initial: false });
		const { signal, dispose } = nodeSignal(aborted);
		expect(signal.aborted).toBe(false);
		aborted.emit(true);
		expect(signal.aborted).toBe(true);
		dispose();
	});

	it("aborts immediately when the cached value is already true (push-on-subscribe)", () => {
		const aborted = node([], { initial: true });
		const { signal, dispose } = nodeSignal(aborted);
		expect(signal.aborted).toBe(true);
		dispose();
	});

	it("ignores null / false values and only fires on true", () => {
		const aborted = node<boolean>([], { initial: false });
		const { signal, dispose } = nodeSignal(aborted);
		aborted.emit(false);
		aborted.emit(false);
		expect(signal.aborted).toBe(false);
		aborted.emit(true);
		expect(signal.aborted).toBe(true);
		dispose();
	});

	it("uses the provided reason on abort", () => {
		const aborted = node([], { initial: false });
		const reason = new Error("custom cancellation");
		const { signal, dispose } = nodeSignal(aborted, { reason });
		aborted.emit(true);
		expect(signal.reason).toBe(reason);
		dispose();
	});

	it("dispose cleanly unsubscribes from the source before any abort", () => {
		const aborted = node([], { initial: false });
		const { signal, dispose } = nodeSignal(aborted);
		dispose();
		aborted.emit(true);
		expect(signal.aborted).toBe(false);
	});

	it("treats source ERROR as an abort (fail-closed semantics)", () => {
		// Use a derived that synchronously throws → ERROR message.
		const trigger = node([], { initial: 0 });
		const failing = node<boolean>(
			[trigger],
			(batchData, actions, ctx) => {
				const data = batchData.map((batch, i) =>
					batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i],
				);
				if ((data[0] as number) > 0) throw new Error("broken");
				actions.emit(false);
			},
			{ describeKind: "derived" },
		);
		const { signal, dispose } = nodeSignal(failing);
		trigger.emit(1);
		expect(signal.aborted).toBe(true);
		dispose();
	});
});

// ─── awaitSettled skipCurrent ─────────────────────────────────────────────

describe("awaitSettled({ skipCurrent: true }) (Wave A Unit 4)", () => {
	it("ignores the cached value and resolves on the next emission", async () => {
		const s = node<string | null>([], { initial: "stale" });
		const p = awaitSettled(s, { skipCurrent: true });
		// The cached "stale" is synchronously pushed — must be ignored.
		setTimeout(() => s.emit("fresh"), 5);
		expect(await p).toBe("fresh");
	});

	it("without skipCurrent, resolves immediately with the cached value", async () => {
		const s = node<string | null>([], { initial: "cached" });
		const val = await awaitSettled(s);
		expect(val).toBe("cached");
	});

	it("combines with timeoutMs", async () => {
		const s = node<string | null>([], { initial: "stale" });
		await expect(awaitSettled(s, { skipCurrent: true, timeoutMs: 25 })).rejects.toThrow(
			/Timed out/,
		);
	});
});

// ─── parseSSEStream ───────────────────────────────────────────────────────

describe("parseSSEStream (Wave A Unit 12)", () => {
	function makeSSEStream(text: string): ReadableStream<Uint8Array> {
		const encoder = new TextEncoder();
		return new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(text));
				controller.close();
			},
		});
	}

	it("yields one event per SSE block", async () => {
		const stream = makeSSEStream("event: message\ndata: hello\n\nevent: custom\ndata: world\n\n");
		const events: Array<{ event: string; data: string }> = [];
		for await (const ev of parseSSEStream(stream)) {
			events.push({ event: ev.event, data: ev.data });
		}
		expect(events).toEqual([
			{ event: "message", data: "hello" },
			{ event: "custom", data: "world" },
		]);
	});

	it("joins multi-line data with LF", async () => {
		const stream = makeSSEStream("data: line1\ndata: line2\ndata: line3\n\n");
		const events = [];
		for await (const ev of parseSSEStream(stream)) events.push(ev);
		expect(events[0]?.data).toBe("line1\nline2\nline3");
	});

	it("honors a custom parse function", async () => {
		const stream = makeSSEStream('data: {"x":1}\n\ndata: {"x":2}\n\n');
		const events: Array<{ x: number }> = [];
		for await (const ev of parseSSEStream<{ x: number }>(stream, {
			parse: (raw) => JSON.parse(raw) as { x: number },
		})) {
			events.push(ev.data);
		}
		expect(events).toEqual([{ x: 1 }, { x: 2 }]);
	});

	it("cancels the upstream reader on external abort", async () => {
		const ctrl = new AbortController();
		const encoder = new TextEncoder();
		let cancelCalled = false;
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(encoder.encode("data: a\n\n"));
				// Never closes — simulate a quiet stream.
			},
			cancel() {
				cancelCalled = true;
			},
		});
		const events: string[] = [];
		const task = (async () => {
			for await (const ev of parseSSEStream(stream, { signal: ctrl.signal })) {
				events.push(ev.data as string);
				ctrl.abort();
			}
		})();
		await task;
		expect(events).toEqual(["a"]);
		expect(cancelCalled).toBe(true);
	});

	it("fromSSE delegates to parseSSEStream (integration)", async () => {
		const stream = makeSSEStream("data: one\n\ndata: two\n\n");
		const out: string[] = [];
		const node = fromSSE(stream);
		await new Promise<void>((resolve) => {
			node.subscribe((msgs) => {
				for (const m of msgs) {
					if (m[0] === DATA) out.push((m[1] as { data: string }).data);
				}
			});
			setTimeout(resolve, 50);
		});
		expect(out).toEqual(["one", "two"]);
	});
});

// ─── reactive-map retention ───────────────────────────────────────────────

describe("reactiveMap retention (Wave A Unit 7 C1)", () => {
	it("archives entries below archiveThreshold on mutation", () => {
		const archived: Array<[string, number, number]> = [];
		const m = reactiveMap<string, number>({
			retention: {
				score: (_k, v) => v,
				archiveThreshold: 5,
				onArchive: (k, v, s) => archived.push([k, v, s]),
			},
		});
		m.set("a", 3);
		m.set("b", 7);
		m.set("c", 2);
		m.set("d", 10);
		// a (3) and c (2) are below threshold 5 → archived.
		expect(archived.map(([k]) => k).sort()).toEqual(["a", "c"]);
		expect(m.has("a")).toBe(false);
		expect(m.has("b")).toBe(true);
		expect(m.has("c")).toBe(false);
		expect(m.has("d")).toBe(true);
	});

	it("caps entries at retention.maxSize, archiving lowest-scored first", () => {
		const archived: string[] = [];
		const m = reactiveMap<string, number>({
			retention: {
				score: (_k, v) => v,
				maxSize: 2,
				onArchive: (k) => archived.push(k),
			},
		});
		m.set("low", 1);
		m.set("mid", 5);
		m.set("high", 10);
		// After inserting "high", cap is 2 — "low" (score 1) archived.
		expect(archived).toEqual(["low"]);
		m.set("extra", 20);
		// Next cap hit archives "mid" (score 5, now the lowest).
		expect(archived).toEqual(["low", "mid"]);
		expect(m.has("high")).toBe(true);
		expect(m.has("extra")).toBe(true);
	});

	it("emits exactly one post-mutation snapshot reflecting archival side-effects", () => {
		const m = reactiveMap<string, number>({
			retention: { score: (_k, v) => v, archiveThreshold: 0 },
		});
		m.set("a", 5);
		const { batches, unsub } = collect(m.entries);
		m.set("b", -1); // below threshold — archived.
		unsub();
		const flat = (batches as [symbol, unknown][][]).flat();
		const lastData = [...flat].reverse().find((msg) => msg[0] === DATA);
		expect(lastData).toBeDefined();
		const map = (lastData as [symbol, ReadonlyMap<string, number>])[1];
		expect(map.has("b")).toBe(false); // archived in the same wave
		expect(map.has("a")).toBe(true);
	});

	it("rejects conflicting maxSize + retention at construction", () => {
		expect(() =>
			reactiveMap({
				maxSize: 5,
				retention: { score: () => 0, archiveThreshold: 0 },
			}),
		).toThrow(/mutually exclusive/);
	});

	it("rejects retention with no trigger (no threshold, no maxSize)", () => {
		expect(() =>
			reactiveMap({
				retention: { score: () => 0 },
			}),
		).toThrow(/at least one of/);
	});
});

// ─── contentAddressedStorage ──────────────────────────────────────────────

describe("contentAddressedStorage (Wave A Unit 11 + 12)", () => {
	it("stores and looks up by content-hash", async () => {
		const cache = contentAddressedStorage<{ q: string }, { ans: string }>({
			storage: memoryKv(),
			keyPrefix: "qa",
		});
		await cache.store({ q: "hi" }, { ans: "hello" });
		const hit = await cache.lookup({ q: "hi" });
		expect(hit).toEqual({ ans: "hello" });
		const miss = await cache.lookup({ q: "different" });
		expect(miss).toBeUndefined();
	});

	it("throws ContentAddressedMissError in read-strict mode on miss", async () => {
		const cache = contentAddressedStorage<{ q: string }, { ans: string }>({
			storage: memoryKv(),
			mode: "read-strict",
		});
		await expect(cache.lookup({ q: "nope" })).rejects.toBeInstanceOf(ContentAddressedMissError);
	});

	it("write mode never returns hits, even when previously stored", async () => {
		const storage = memoryKv();
		const writer = contentAddressedStorage<{ id: string }, string>({ storage, mode: "write" });
		await writer.store({ id: "x" }, "value");
		expect(await writer.lookup({ id: "x" })).toBeUndefined();
		// Reading via a separate read handle sees the stored value.
		const reader = contentAddressedStorage<{ id: string }, string>({ storage, mode: "read" });
		expect(await reader.lookup({ id: "x" })).toBe("value");
	});

	it("read mode never stores", async () => {
		const storage = memoryKv();
		const reader = contentAddressedStorage<{ id: string }, string>({ storage, mode: "read" });
		await reader.store({ id: "x" }, "value");
		expect(await reader.lookup({ id: "x" })).toBeUndefined();
	});

	it("keyContext extractor lets callers exclude fields from the hash", async () => {
		const cache = contentAddressedStorage<{ query: string; retries: number }, string>({
			storage: memoryKv(),
			// Exclude `retries` from the hash so retries of the same query are cache-hits.
			keyContext: ({ query }) => ({ query }),
		});
		await cache.store({ query: "foo", retries: 0 }, "bar");
		expect(await cache.lookup({ query: "foo", retries: 5 })).toBe("bar");
	});

	it("canonicalJson handles circular references via __cycle marker", () => {
		const a: { self?: unknown } = {};
		a.self = a;
		const json = canonicalJson(a);
		expect(json).toBe('{"self":{"__cycle":true}}');
	});

	it("canonicalJson sorts object keys for stable hashing", () => {
		const a = canonicalJson({ b: 1, a: 2, c: 3 });
		const b = canonicalJson({ a: 2, c: 3, b: 1 });
		expect(a).toBe(b);
	});
});

// ─── sanity — fromAny + onFirstData composition ───────────────────────────

describe("fromAny + onFirstData composition (Wave A Unit 10/11 use case)", () => {
	it("invokes the side-effect exactly once per adapter Promise bridge", async () => {
		let recorded = 0;
		const resp = { text: "ok" };
		const bridged = fromAny(Promise.resolve(resp));
		const tapped = onFirstData(bridged, () => {
			recorded++;
		});
		// Activate
		const unsub = tapped.subscribe(() => {});
		await new Promise((r) => setTimeout(r, 5));
		unsub();
		// Re-subscribe should NOT re-fire (closure fires flag is node-scoped).
		const unsub2 = tapped.subscribe(() => {});
		await new Promise((r) => setTimeout(r, 5));
		unsub2();
		expect(recorded).toBe(1);
	});
});

// silences an unused import warning when vi is not referenced above
void vi;
