import { Buffer } from "node:buffer";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { attachObserveEventLog } from "../adapters/observe-storage.js";
import type { KvStorageTier, ObserveEventFrame, WalFrame } from "../index.js";
import {
	appendLogKey,
	appendLogStorage,
	assertWalFrame,
	graph,
	hasKvPutIfAbsent,
	hasKvVersioned,
	hasStorageVersioned,
	kvStorage,
	memoryAppendLog,
	memoryBackend,
	memoryKv,
	memoryMultiWriterAppendLog,
	multiWriterAppendLogStorage,
	observeEventFrame,
	readAppendLogPage,
	readObserveEventLogPage,
	requireKvPutIfAbsent,
	requireKvVersioned,
	requireStorageVersioned,
	strictJsonCodec,
	verifyWalFrameChecksum,
	WAL_FORMAT_VERSION,
	walFrame,
	walFrameChecksum,
	walFrameCodec,
	walFrameKey,
	walFramePrefix,
} from "../index.js";
import { sqliteBackend, sqliteKv } from "../storage/node.js";

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

const awaitDone = (run: (done: () => void) => void) =>
	new Promise<void>((resolve) => {
		run(resolve);
	});

const bytesToHex = (bytes: Uint8Array) =>
	[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const _sha256Hex = async (bytes: Uint8Array) =>
	bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)));

describe("D82 storage substrate helpers — part 2", () => {
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
});
