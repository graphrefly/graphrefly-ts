import { describe, expect, it } from "vitest";
import {
	agenticMemoryRecordChangeFrame,
	agenticMemoryRecordSnapshotFrame,
	agenticMemoryRecordsSnapshotKey,
	loadAgenticMemoryRecordsState,
	memoryAgenticMemoryPassiveStoreFrameAdapter,
	openPersistentAgenticMemoryRecords,
	persistAgenticMemoryRecords,
} from "../adapters/index.js";
import type { IndexChange, ListChange, MapChange } from "../graph/data-structures/change.js";
import type { IndexRow } from "../graph/data-structures/reactive-index.js";
import {
	type AgenticMemoryRecord,
	agenticMemoryRecordStoreFrameCodec,
	frameAgenticMemoryRecords,
	graph,
	loadReactiveIndexState,
	loadReactiveListState,
	loadReactiveLogState,
	loadReactiveMapState,
	memoryAppendLog,
	memoryKv,
	type ReactiveCollectionChangeFrame,
	reactiveCollectionChangeFrame,
	reactiveCollectionSnapshotFrame,
	restoreReactiveIndex,
	restoreReactiveList,
	restoreReactiveLog,
	restoreReactiveMap,
} from "../index.js";

const _flushMicrotasks = async (turns = 1) => {
	for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

const _waitForMicrotaskState = async (predicate: () => boolean, turns = 50): Promise<void> => {
	for (let i = 0; i < turns; i += 1) {
		if (predicate()) return;
		await Promise.resolve();
	}
	throw new Error("timed out waiting for microtask state");
};

const waitControl = (run: (done: () => void) => void): Promise<void> =>
	new Promise<void>((resolve) => {
		run(resolve);
	});

const memoryRecord = (
	id: string,
	payload: string,
): AgenticMemoryRecord<{ readonly text: string }> => ({
	id: `record-${id}`,
	kind: "semantic",
	persistenceLevel: "project",
	artifactKind: "insight",
	fragment: {
		id,
		payload: { text: payload },
		tNs: 10n,
		confidence: 0.8,
		tags: ["agentic"],
		sources: [],
	},
});

describe("D161 reactive collection storage frames and passive load/fold", () => {
	it("folds a reactiveList snapshot plus changes after the snapshot cursor", async () => {
		const snapshots = memoryKv<unknown>();
		const changes = memoryAppendLog<unknown>("list-changes");

		await changes.append(
			reactiveCollectionChangeFrame("reactiveList", {
				kind: "append",
				value: "old",
			} satisfies ListChange<string>),
		);
		await snapshots.set(
			"list/snapshot",
			reactiveCollectionSnapshotFrame("reactiveList", ["base"], { changeCursor: 0 }),
		);
		await changes.append(
			reactiveCollectionChangeFrame("reactiveList", {
				kind: "insert",
				index: 1,
				value: "new",
			} satisfies ListChange<string>),
		);

		const state = await loadReactiveListState<string>({
			snapshotStore: snapshots,
			snapshotKey: "list/snapshot",
			changeLog: changes,
		});

		expect(state).toMatchObject({
			kind: "reactiveList",
			source: "snapshot+changes",
			snapshot: { found: true, changeCursor: 0 },
			changes: { applied: 1, cursor: 1 },
		});
		expect(state.state).toEqual(["base", "new"]);
	});

	it("treats missing snapshot plus missing/empty change log as explicit empty state", async () => {
		const snapshots = memoryKv<unknown>();
		const emptyList = await loadReactiveListState<number>({
			snapshotStore: snapshots,
			storagePrefix: "empty-list",
		});
		const emptyLog = await loadReactiveLogState<number>({
			snapshotStore: snapshots,
			storagePrefix: "empty-log",
			changeLog: memoryAppendLog<unknown>("empty-log-changes"),
		});

		expect(emptyList.source).toBe("empty");
		expect(emptyList.state).toEqual([]);
		expect(emptyLog.source).toBe("empty");
		expect(emptyLog.state).toEqual([]);
	});

	it("rejects corrupt snapshot and change frames honestly", async () => {
		const snapshots = memoryKv<unknown>();
		const changes = memoryAppendLog<unknown>("bad-list");
		await snapshots.set("bad/snapshot", {
			...reactiveCollectionSnapshotFrame("reactiveList", []),
			restore: true,
		});
		await changes.append({
			...reactiveCollectionChangeFrame("reactiveList", { kind: "append", value: 1 }),
			version: 2,
		});

		await expect(
			loadReactiveListState({ snapshotStore: snapshots, snapshotKey: "bad/snapshot" }),
		).rejects.toThrow(/unexpected frame fields|invalid version/);

		const cleanSnapshots = memoryKv<unknown>();
		await expect(
			loadReactiveListState({ snapshotStore: cleanSnapshots, changeLog: changes }),
		).rejects.toThrow(/invalid version/);

		const malformedChanges = memoryAppendLog<unknown>("bad-list-shape");
		await malformedChanges.append(
			reactiveCollectionChangeFrame("reactiveList", {
				value: 1,
			} as unknown as ListChange<number>),
		);
		await expect(
			loadReactiveListState({ snapshotStore: cleanSnapshots, changeLog: malformedChanges }),
		).rejects.toThrow(/kind/);
	});

	it("rejects change-log seq holes instead of folding a false state", async () => {
		const snapshots = memoryKv<unknown>();
		const gapLog = {
			append(value: unknown) {
				return Promise.resolve({ key: "gap/1", seq: 1, value });
			},
			read() {
				return Promise.resolve([
					{
						key: "gap/1",
						seq: 1,
						value: reactiveCollectionChangeFrame("reactiveList", {
							kind: "append",
							value: "lost baseline",
						}),
					},
				]);
			},
			truncateAfter() {
				return Promise.resolve();
			},
			size() {
				return Promise.resolve(1);
			},
		};

		await expect(
			loadReactiveListState<string>({ snapshotStore: snapshots, changeLog: gapLog }),
		).rejects.toThrow(/non-contiguous/);
	});

	it("rejects impossible list/log change folds instead of normalizing them", async () => {
		const listSnapshots = memoryKv<unknown>();
		const listChanges = memoryAppendLog<unknown>("bad-list-fold");
		await listSnapshots.set(
			"list/snapshot",
			reactiveCollectionSnapshotFrame("reactiveList", [1], { changeCursor: -1 }),
		);
		await listChanges.append(
			reactiveCollectionChangeFrame("reactiveList", { kind: "trimHead", n: 2 }),
		);
		await expect(
			loadReactiveListState({
				snapshotStore: listSnapshots,
				snapshotKey: "list/snapshot",
				changeLog: listChanges,
			}),
		).rejects.toThrow(/trimHead/);

		const logSnapshots = memoryKv<unknown>();
		const logChanges = memoryAppendLog<unknown>("bad-log-fold");
		await logSnapshots.set(
			"log/snapshot",
			reactiveCollectionSnapshotFrame("reactiveLog", ["a"], { changeCursor: -1 }),
		);
		await logChanges.append(
			reactiveCollectionChangeFrame("reactiveLog", { kind: "clear", count: 2 }),
		);
		await expect(
			loadReactiveLogState({
				snapshotStore: logSnapshots,
				snapshotKey: "log/snapshot",
				changeLog: logChanges,
			}),
		).rejects.toThrow(/clear/);
	});

	it("folds reactiveMap and reactiveIndex snapshots plus strict change logs", async () => {
		const mapSnapshots = memoryKv<unknown>();
		const mapChanges =
			memoryAppendLog<ReactiveCollectionChangeFrame<"reactiveMap", MapChange<string, number>>>(
				"map-changes",
			);
		await mapSnapshots.set(
			"map/snapshot",
			reactiveCollectionSnapshotFrame("reactiveMap", [["a", 1]], { changeCursor: -1 }),
		);
		await mapChanges.append(
			reactiveCollectionChangeFrame("reactiveMap", {
				kind: "set",
				key: "b",
				value: 2,
			}),
		);
		await mapChanges.append(
			reactiveCollectionChangeFrame("reactiveMap", {
				kind: "delete",
				key: "a",
				previous: 1,
				reason: "explicit",
			}),
		);

		const indexSnapshots = memoryKv<unknown>();
		const indexChanges =
			memoryAppendLog<ReactiveCollectionChangeFrame<"reactiveIndex", IndexChange<string, number>>>(
				"index-changes",
			);
		await indexSnapshots.set(
			"index/snapshot",
			reactiveCollectionSnapshotFrame("reactiveIndex", [
				{ primary: "b", secondary: 2, value: 20 },
			] satisfies readonly IndexRow<string, number>[]),
		);
		await indexChanges.append(
			reactiveCollectionChangeFrame("reactiveIndex", {
				kind: "upsert",
				primary: "a",
				secondary: 1,
				value: 10,
			}),
		);

		const mapState = await loadReactiveMapState<string, number>({
			snapshotStore: mapSnapshots,
			snapshotKey: "map/snapshot",
			changeLog: mapChanges,
		});
		const indexState = await loadReactiveIndexState<string, number>({
			snapshotStore: indexSnapshots,
			snapshotKey: "index/snapshot",
			changeLog: indexChanges,
		});

		expect(mapState.state).toEqual([["b", 2]]);
		expect(indexState.state).toEqual([
			{ primary: "a", secondary: 1, value: 10 },
			{ primary: "b", secondary: 2, value: 20 },
		]);
	});

	it("rejects duplicate reactiveMap keys and reactiveIndex primaries in snapshots", async () => {
		const mapSnapshots = memoryKv<unknown>();
		await mapSnapshots.set(
			"map/snapshot",
			reactiveCollectionSnapshotFrame("reactiveMap", [
				[{ id: 1 }, "first"],
				[{ id: 1 }, "second"],
			]),
		);
		await expect(
			loadReactiveMapState<object, string>({
				snapshotStore: mapSnapshots,
				snapshotKey: "map/snapshot",
			}),
		).rejects.toThrow(/duplicates an earlier key/);

		const indexSnapshots = memoryKv<unknown>();
		await indexSnapshots.set(
			"index/snapshot",
			reactiveCollectionSnapshotFrame("reactiveIndex", [
				{ primary: { id: 1 }, secondary: 1, value: "first" },
				{ primary: { id: 1 }, secondary: 2, value: "second" },
			]),
		);
		await expect(
			loadReactiveIndexState<object, string>({
				snapshotStore: indexSnapshots,
				snapshotKey: "index/snapshot",
			}),
		).rejects.toThrow(/duplicates an earlier primary/);
	});
});

describe("D172 agentic memory record persistence sidecar", () => {
	it("loads snapshot plus replaceAll change frames without mutating a graph", async () => {
		const snapshots = memoryKv<unknown>();
		const changes = memoryAppendLog<unknown>("agentic-records");
		await snapshots.set(
			agenticMemoryRecordsSnapshotKey("agentic"),
			agenticMemoryRecordSnapshotFrame([memoryRecord("base", "base")], { changeCursor: -1 }),
		);
		await changes.append(agenticMemoryRecordChangeFrame([memoryRecord("next", "next")]));

		const loaded = await loadAgenticMemoryRecordsState<{ readonly text: string }>({
			snapshotStore: snapshots,
			storagePrefix: "agentic",
			changeLog: changes,
		});

		expect(loaded.source).toBe("snapshot+changes");
		expect(loaded.records.map((record) => record.id)).toEqual(["record-next"]);
		expect(loaded.records[0]?.fragment.tNs).toBe(10n);
		expect(loaded.changes).toEqual({ applied: 1, cursor: 0 });
	});

	it("reads agentic record changes after the snapshot cursor and rejects sparse frames", async () => {
		const snapshot = agenticMemoryRecordSnapshotFrame([memoryRecord("base", "base")], {
			changeCursor: 0,
		});
		const next = agenticMemoryRecordChangeFrame([memoryRecord("next", "next")]);
		const loaded = await loadAgenticMemoryRecordsState<{ readonly text: string }>({
			snapshotStore: {
				get: () => Promise.resolve(snapshot),
			} as never,
			changeLog: {
				read: (opts = {}) => {
					expect(opts).toEqual({ after: 0 });
					return Promise.resolve([{ key: "changes/1", seq: 1, value: next }]);
				},
			} as never,
		});

		expect(loaded.records.map((record) => record.id)).toEqual(["record-next"]);
		const sparseRecords = [] as unknown[];
		sparseRecords.length = 1;
		await expect(
			loadAgenticMemoryRecordsState({
				snapshotStore: {
					get: () =>
						Promise.resolve({
							format: "graphrefly.agenticMemory.records.snapshot",
							version: 1,
							changeCursor: -1,
							records: sparseRecords,
						}),
				} as never,
			}),
		).rejects.toThrow(/sparse array hole/);
	});

	it("stores encoded AgenticMemory store frames opaquely without decode or commit authority", async () => {
		const adapter = memoryAgenticMemoryPassiveStoreFrameAdapter();
		const codec = agenticMemoryRecordStoreFrameCodec();
		const frame = frameAgenticMemoryRecords([memoryRecord("encoded", "encoded")]);
		const bytes = codec.encode(frame);

		const write = await adapter.write(bytes);
		bytes[0] = 0;
		const malformedWrite = await adapter.write(new Uint8Array([123, 34, 98, 97, 100, 34]));
		const read = await adapter.read({ after: -1 });
		const decoded = codec.decode(read.frames[0]!);

		expect(write.status.state).toBe("ready");
		expect(malformedWrite.status.state).toBe("ready");
		expect(read.status).toMatchObject({
			state: "ready",
			cursor: { writes: 2, reads: 1, storedFrames: 2, lastFrameIndex: 1 },
		});
		expect(decoded).toEqual(frame);
		expect(() => codec.decode(read.frames[1]!)).toThrow();
		expect(JSON.stringify({ write, malformedWrite, read })).not.toMatch(
			/commit|commitAck|hydrate|hydration|restore|truth/i,
		);
	});

	it("persists records as passive frames and exposes persistence.cursor facts", async () => {
		const g = graph();
		const snapshots = memoryKv<unknown>();
		const changes = memoryAppendLog<unknown>("agentic-sidecar");
		const records = g.state<readonly AgenticMemoryRecord<{ readonly text: string }>[]>(
			[memoryRecord("a", "a")],
			{ name: "records" },
		);
		const persistence = persistAgenticMemoryRecords(g, records, {
			name: "agentic/persistence",
			snapshotStore: snapshots,
			storagePrefix: "agentic-sidecar",
			changeLog: changes,
			snapshotEveryChanges: 2,
		});
		await waitControl((done) => persistence.flush(done));
		const nextRecords = [memoryRecord("b", "b")];
		records.set(nextRecords);
		nextRecords[0] = memoryRecord("mutated", "mutated");
		await waitControl((done) => persistence.flush(done));

		expect(persistence.ready.cache).toBe(true);
		expect(persistence.cursor.cache).toMatchObject({
			kind: "persistence.cursor",
			changeSeq: 0,
			snapshotWrites: 1,
			changeWrites: 1,
		});
		expect(g.describe().nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "agentic/persistence/ready" }),
				expect.objectContaining({ id: "agentic/persistence/status" }),
				expect.objectContaining({ id: "agentic/persistence/error" }),
				expect.objectContaining({ id: "agentic/persistence/cursor" }),
			]),
		);
		const loaded = await loadAgenticMemoryRecordsState<{ readonly text: string }>({
			snapshotStore: snapshots,
			storagePrefix: "agentic-sidecar",
			changeLog: changes,
		});
		expect(loaded.records.map((record) => record.id)).toEqual(["record-b"]);
		const writtenChange = (await changes.read()).at(0)?.value as
			| ReturnType<typeof agenticMemoryRecordChangeFrame>
			| undefined;
		expect(writtenChange?.change.records[0]?.record.id).toBe("record-b");
		await waitControl((done) => persistence.dispose(done));
	});

	it("opens persistent records with initial values and fails corrupt frames honestly", async () => {
		const snapshots = memoryKv<unknown>();
		const changes = memoryAppendLog<unknown>("agentic-open");
		const g = graph();
		const opened = await openPersistentAgenticMemoryRecords({
			graph: g,
			name: "agenticRecords",
			snapshotStore: snapshots,
			changeLog: changes,
			initial: [memoryRecord("initial", "initial")],
		});
		expect(opened.records.cache?.map((record) => record.id)).toEqual(["record-initial"]);
		await waitControl((done) => opened.persistence.flush(done));
		await waitControl((done) => opened.persistence.dispose(done));

		await snapshots.set(agenticMemoryRecordsSnapshotKey("bad"), {
			...agenticMemoryRecordSnapshotFrame([memoryRecord("ok", "ok")]),
			storageTier: "cold",
		});
		await expect(
			loadAgenticMemoryRecordsState({ snapshotStore: snapshots, storagePrefix: "bad" }),
		).rejects.toThrow(/unexpected frame fields/);
	});
});

describe("D161 synchronous restore helpers", () => {
	it("restoreReactiveList and restoreReactiveLog seed graphless collections without storage reads", () => {
		const list = restoreReactiveList({
			kind: "reactiveList",
			state: [1, 2],
			source: "snapshot",
			snapshot: { found: true, changeCursor: -1 },
			changes: { applied: 0, cursor: -1 },
		});
		const log = restoreReactiveLog({
			kind: "reactiveLog",
			state: ["a"],
			source: "changes",
			snapshot: { found: false, changeCursor: -1 },
			changes: { applied: 1, cursor: 0 },
		});

		list.append(3);
		log.append("b");

		expect(list.toArray()).toEqual([1, 2, 3]);
		expect(log.toArray()).toEqual(["a", "b"]);
	});

	it("restoreReactiveList can register graph/name collection ports", () => {
		const g = graph();
		const list = restoreReactiveList([1], { graph: g, name: "list" });

		expect(list.toArray()).toEqual([1]);
		expect(g.describe().nodes.map((node) => node.id)).toEqual(
			expect.arrayContaining(["list.delta", "list.snapshot"]),
		);
	});

	it("restoreReactiveList and restoreReactiveLog reject wrong-kind restore states", () => {
		const logState = {
			kind: "reactiveLog",
			state: ["x"],
			source: "snapshot",
			snapshot: { found: true, changeCursor: -1 },
			changes: { applied: 0, cursor: -1 },
		} as unknown as Parameters<typeof restoreReactiveList<string>>[0];
		const listState = {
			kind: "reactiveList",
			state: ["x"],
			source: "snapshot",
			snapshot: { found: true, changeCursor: -1 },
			changes: { applied: 0, cursor: -1 },
		} as unknown as Parameters<typeof restoreReactiveLog<string>>[0];

		expect(() => restoreReactiveList(logState)).toThrow(/reactiveList/);
		expect(() => restoreReactiveLog(listState)).toThrow(/reactiveLog/);
	});

	it("restoreReactiveMap and restoreReactiveIndex seed graph-registered backends", () => {
		const g = graph();
		const map = restoreReactiveMap<string, number>([["a", 1]], { graph: g, name: "map" });
		const index = restoreReactiveIndex<string, number>(
			[
				{ primary: "b", secondary: 2, value: 20 },
				{ primary: "a", secondary: 1, value: 10 },
			],
			{ graph: g, name: "index" },
		);

		map.set("b", 2);
		index.upsert("c", 3, 30);

		expect(map.get("a")).toBe(1);
		expect(map.get("b")).toBe(2);
		expect(index.get("a")).toBe(10);
		expect(index.toArray()).toEqual([
			{ primary: "a", secondary: 1, value: 10 },
			{ primary: "b", secondary: 2, value: 20 },
			{ primary: "c", secondary: 3, value: 30 },
		]);
		expect(g.describe().nodes.map((node) => node.id)).toEqual(
			expect.arrayContaining(["map.delta", "map.snapshot", "index.delta", "index.snapshot"]),
		);
	});
});
