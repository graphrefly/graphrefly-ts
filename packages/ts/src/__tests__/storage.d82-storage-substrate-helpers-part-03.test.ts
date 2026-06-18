import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as observeStorageExports from "../adapters/observe-storage.js";
import { attachObserveEventLog, attachObserveSink } from "../adapters/observe-storage.js";
import * as rootExports from "../index.js";
import {
	assertDecimalIntegerString,
	assertNonNegativeDecimalIntegerString,
	assertStrictJsonObject,
	assertStrictJsonValue,
	assertWalFrame,
	bigIntToDecimalString,
	bigIntToNonNegativeDecimalString,
	changeEnvelopeCodec,
	contentAddressedKv,
	contentAddressedStorage,
	decimalStringToBigInt,
	graph,
	hasKvPutIfAbsent,
	hasKvVersioned,
	hasStoragePutIfAbsent,
	hasStorageVersioned,
	isDecimalIntegerString,
	isNonNegativeDecimalIntegerString,
	memoryBackend,
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
	strictCanonicalJsonBytes,
	strictJsonCodec,
	strictJsonCodecFor,
	tieredReadThrough,
	verifyWalFrameChecksum,
	walFrame,
	walFrameChecksum,
	walFrameCodec,
	walFrameKey,
	walFramePrefix,
	webStorageBackend,
} from "../index.js";
import * as storageExports from "../storage/index.js";

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

const _sha256Hex = async (bytes: Uint8Array) =>
	bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)));

describe("D82 storage substrate helpers — part 3", () => {
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
			expect(exports.assertStrictJsonValue).toBe(assertStrictJsonValue);
			expect(exports.assertStrictJsonObject).toBe(assertStrictJsonObject);
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
