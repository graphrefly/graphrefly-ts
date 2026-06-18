import { describe, expect, it } from "vitest";
import type {
	IndexChange,
	ListChange,
	LogChange,
	MapChange,
} from "../graph/data-structures/change.js";
import {
	type AgenticMemoryRecord,
	graph,
	loadReactiveListState,
	memoryAppendLog,
	memoryKv,
	openPersistentReactiveIndex,
	openPersistentReactiveList,
	openPersistentReactiveLog,
	openPersistentReactiveMap,
	persistReactiveCollection,
	type ReactiveCollectionChangeFrame,
	type ReactiveCollectionSnapshotFrame,
	reactiveCollectionChangeFrame,
	reactiveList,
} from "../index.js";

const flushMicrotasks = async (turns = 1) => {
	for (let i = 0; i < turns; i += 1) await Promise.resolve();
};

const waitForMicrotaskState = async (predicate: () => boolean, turns = 50): Promise<void> => {
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

const _memoryRecord = (
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

describe("D161 persistReactiveCollection and openPersistentReactive*", () => {
	it("persists list deltas, exposes persistence.cursor facts, and stops on dispose", async () => {
		const g = graph();
		const snapshots = memoryKv<unknown>();
		const changes =
			memoryAppendLog<ReactiveCollectionChangeFrame<"reactiveList", ListChange<number>>>(
				"persist-list",
			);
		const list = reactiveList<number>([1], { graph: g, name: "list" });
		const persistence = persistReactiveCollection(g, list, {
			kind: "reactiveList",
			name: "list/persistence",
			snapshotStore: snapshots,
			snapshotKey: "list/snapshot",
			changeLog: changes,
		});

		await waitControl((done) => persistence.flush(done));
		list.append(2);
		await waitControl((done) => persistence.flush(done));

		expect(persistence.ready.cache).toBe(true);
		expect(persistence.cursor.cache).toMatchObject({
			kind: "persistence.cursor",
			collection: "reactiveList",
			changeSeq: 0,
			changeWrites: 1,
			snapshotWrites: 1,
		});
		expect(persistence.status.cache.pending).toBe(0);
		expect((await changes.read()).map((entry) => entry.value.change)).toEqual([
			{ kind: "append", value: 2 },
		]);
		expect(await snapshots.get("list/snapshot")).toMatchObject({
			kind: "reactiveList",
			changeCursor: -1,
			snapshot: [1],
		} satisfies Partial<ReactiveCollectionSnapshotFrame<"reactiveList", readonly number[]>>);

		await waitControl((done) => persistence.dispose(done));
		list.append(3);
		await flushMicrotasks();
		expect((await changes.read()).map((entry) => entry.value.change)).toEqual([
			{ kind: "append", value: 2 },
		]);
		expect(persistence.ready.cache).toBe(false);

		let disposedFlushCalled = false;
		persistence.flush(() => {
			disposedFlushCalled = true;
		});
		expect(disposedFlushCalled).toBe(true);
	});

	it("preflights strict JSON before writing default persistence frames", async () => {
		const g = graph();
		const snapshots = memoryKv<unknown>();
		const list = reactiveList<unknown>([1n], { graph: g, name: "strictList" });
		const persistence = persistReactiveCollection(g, list, {
			kind: "reactiveList",
			name: "strictList/persistence",
			snapshotStore: snapshots,
			snapshotKey: "strict/snapshot",
		});

		await waitControl((done) => persistence.flush(done));

		expect(persistence.status.cache.errors).toBe(1);
		expect(persistence.status.cache.state).toBe("errored");
		expect(persistence.status.cache.pending).toBe(0);
		expect(persistence.ready.cache).toBe(false);
		expect(persistence.error.cache?.message).toMatch(/JSON/);
		expect(await snapshots.get("strict/snapshot")).toBeUndefined();
		await waitControl((done) => persistence.flush(done));
		expect(persistence.status.cache.state).toBe("errored");
		expect(persistence.ready.cache).toBe(false);
		await waitControl((done) => persistence.dispose(done));
	});

	it("manual snapshots reset snapshotEveryChanges cadence", async () => {
		const g = graph();
		const baseSnapshots = memoryKv<unknown>();
		let snapshotWrites = 0;
		const snapshots = {
			...baseSnapshots,
			set(key: string, value: unknown) {
				snapshotWrites += 1;
				return baseSnapshots.set(key, value);
			},
		};
		const list = reactiveList<number>([0], { graph: g, name: "cadence" });
		const persistence = persistReactiveCollection(g, list, {
			kind: "reactiveList",
			name: "cadence/persistence",
			snapshotStore: snapshots,
			snapshotKey: "cadence/snapshot",
			snapshotEveryChanges: 3,
			snapshotOnAttach: false,
		});

		list.append(1);
		list.append(2);
		await waitControl((done) => persistence.snapshot(done));
		expect(snapshotWrites).toBe(1);

		list.append(3);
		await waitControl((done) => persistence.flush(done));
		expect(snapshotWrites).toBe(1);

		list.append(4);
		list.append(5);
		await waitControl((done) => persistence.flush(done));
		expect(snapshotWrites).toBe(2);
		await waitControl((done) => persistence.dispose(done));
	});

	it("clears ready and pending after an async change write error", async () => {
		const g = graph();
		const snapshots = memoryKv<unknown>();
		const changes = {
			append() {
				return Promise.reject(new Error("change write failed"));
			},
			read() {
				return Promise.resolve([]);
			},
			truncateAfter() {
				return Promise.resolve();
			},
			size() {
				return Promise.resolve(0);
			},
		};
		const list = reactiveList<number>([1], { graph: g, name: "errorList" });
		const persistence = persistReactiveCollection(g, list, {
			kind: "reactiveList",
			name: "errorList/persistence",
			snapshotStore: snapshots,
			snapshotKey: "error/snapshot",
			changeLog: changes,
		});
		await waitControl((done) => persistence.flush(done));
		expect(persistence.ready.cache).toBe(true);

		list.append(2);
		await waitControl((done) => persistence.flush(done));

		expect(persistence.ready.cache).toBe(false);
		expect(persistence.status.cache).toMatchObject({
			state: "errored",
			pending: 0,
			errors: 1,
		});
		expect(persistence.error.cache?.message).toMatch(/change write failed/);
		await waitControl((done) => persistence.dispose(done));
	});

	it("dispose cancels queued snapshots after the running write settles", async () => {
		const g = graph();
		const snapshots = memoryKv<unknown>();
		const releases: Array<() => void> = [];
		let seq = 0;
		const changes = {
			append(value: ReactiveCollectionChangeFrame<"reactiveList", ListChange<number>>) {
				return new Promise<{ key: string; seq: number; value: typeof value }>((resolve) => {
					const nextSeq = seq;
					seq += 1;
					releases.push(() => resolve({ key: `controlled/${nextSeq}`, seq: nextSeq, value }));
				});
			},
			read() {
				return Promise.resolve([]);
			},
			truncateAfter() {
				return Promise.resolve();
			},
			size() {
				return Promise.resolve(0);
			},
		};
		const list = reactiveList<number>([0], { graph: g, name: "disposeList" });
		const persistence = persistReactiveCollection(g, list, {
			kind: "reactiveList",
			name: "disposeList/persistence",
			snapshotStore: snapshots,
			snapshotKey: "dispose/snapshot",
			changeLog: changes,
			snapshotOnAttach: false,
		});

		list.append(1);
		let snapshotDone = false;
		persistence.snapshot(() => {
			snapshotDone = true;
		});
		const disposed = waitControl((done) => persistence.dispose(done));
		expect(snapshotDone).toBe(true);
		releases.shift()?.();
		await disposed;

		expect(await snapshots.get("dispose/snapshot")).toBeUndefined();
		expect(persistence.status.cache.state).toBe("disposed");
	});

	it("preserves post-enqueue snapshot cadence counts when a queued snapshot settles", async () => {
		const g = graph();
		const snapshots = memoryKv<unknown>();
		let snapshotWrites = 0;
		let releaseFirstSnapshot: (() => void) | undefined;
		const countedSnapshots = {
			...snapshots,
			set(key: string, value: unknown) {
				snapshotWrites += 1;
				if (snapshotWrites === 1) {
					return new Promise<void>((resolve, reject) => {
						releaseFirstSnapshot = () => {
							snapshots.set(key, value).then(resolve, reject);
						};
					});
				}
				return snapshots.set(key, value);
			},
		};
		const changes =
			memoryAppendLog<ReactiveCollectionChangeFrame<"reactiveList", ListChange<number>>>(
				"cadence-queued",
			);
		const list = reactiveList<number>([0], { graph: g, name: "cadenceQueued" });
		const persistence = persistReactiveCollection(g, list, {
			kind: "reactiveList",
			name: "cadenceQueued/persistence",
			snapshotStore: countedSnapshots,
			snapshotKey: "cadenceQueued/snapshot",
			changeLog: changes,
			snapshotEveryChanges: 2,
			snapshotOnAttach: false,
		});

		list.append(1);
		list.append(2);
		await waitForMicrotaskState(() => snapshotWrites === 1 && releaseFirstSnapshot !== undefined);
		expect(snapshotWrites).toBe(1);
		expect(releaseFirstSnapshot).toBeDefined();

		list.append(3);
		releaseFirstSnapshot?.();
		await flushMicrotasks(4);

		list.append(4);
		await waitControl((done) => persistence.flush(done));

		expect(snapshotWrites).toBe(2);
		await waitControl((done) => persistence.dispose(done));
	});

	it("rejects a persistence sidecar over a collection owned by another graph", () => {
		const owner = graph();
		const other = graph();
		const snapshots = memoryKv<unknown>();
		const changes = memoryAppendLog<unknown>("crossGraph/changes");
		const list = reactiveList<number>([], { graph: owner, name: "ownedList" });

		expect(() =>
			persistReactiveCollection(other, list, {
				kind: "reactiveList",
				name: "crossGraph/persistence",
				snapshotStore: snapshots,
				snapshotKey: "crossGraph/snapshot",
				changeLog: changes,
			}),
		).toThrow(/different graph|cross-graph/);
		expect(other.describe().nodes.map((node) => node.id)).not.toEqual(
			expect.arrayContaining([
				"crossGraph/persistence/ready",
				"crossGraph/persistence/status",
				"crossGraph/persistence/error",
				"crossGraph/persistence/cursor",
			]),
		);
		expect(owner.describe().nodes.map((node) => node.id)).not.toEqual(
			expect.arrayContaining([
				"crossGraph/persistence/ready",
				"crossGraph/persistence/status",
				"crossGraph/persistence/error",
				"crossGraph/persistence/cursor",
			]),
		);
		return Promise.all([snapshots.get("crossGraph/snapshot"), changes.size()]).then(
			([snapshot, changeCount]) => {
				expect(snapshot).toBeUndefined();
				expect(changeCount).toBe(0);
			},
		);
	});

	it("queued snapshots capture enqueue-time state with the cursor after prior writes settle", async () => {
		const g = graph();
		const snapshots = memoryKv<unknown>();
		const writes: Array<ReactiveCollectionChangeFrame<"reactiveList", ListChange<number>>> = [];
		const releases: Array<() => void> = [];
		let seq = 0;
		const changes = {
			append(value: ReactiveCollectionChangeFrame<"reactiveList", ListChange<number>>) {
				return new Promise<{ key: string; seq: number; value: typeof value }>((resolve) => {
					const nextSeq = seq;
					seq += 1;
					releases.push(() => {
						writes.push(value);
						resolve({ key: `controlled/${nextSeq}`, seq: nextSeq, value });
					});
				});
			},
			read(opts: { after?: number } = {}) {
				const after = opts.after ?? -1;
				return Promise.resolve(
					writes
						.map((value, i) => ({ key: `controlled/${i}`, seq: i, value }))
						.filter((entry) => entry.seq > after),
				);
			},
			truncateAfter() {
				return Promise.resolve();
			},
			size() {
				return Promise.resolve(writes.length);
			},
		};
		const list = reactiveList<number>([0], { graph: g, name: "queued" });
		const persistence = persistReactiveCollection(g, list, {
			kind: "reactiveList",
			name: "queued/persistence",
			snapshotStore: snapshots,
			snapshotKey: "queued/snapshot",
			changeLog: changes,
			snapshotOnAttach: false,
		});

		list.append(1);
		let snapshotDone = false;
		const snapshotBarrier = waitControl((done) =>
			persistence.snapshot(() => {
				snapshotDone = true;
				done();
			}),
		);
		list.append(2);
		releases.shift()?.();
		await snapshotBarrier;

		expect(snapshotDone).toBe(true);
		expect(await snapshots.get("queued/snapshot")).toMatchObject({
			changeCursor: 0,
			snapshot: [0, 1],
		});

		releases.shift()?.();
		await waitControl((done) => persistence.flush(done));
		const loaded = await loadReactiveListState<number>({
			snapshotStore: snapshots,
			snapshotKey: "queued/snapshot",
			changeLog: changes,
		});
		expect(loaded.state).toEqual([0, 1, 2]);
		await waitControl((done) => persistence.dispose(done));
	});

	it("openPersistentReactiveList composes load -> restore -> persist and uses initial only for explicit empty state", async () => {
		const g = graph();
		const snapshots = memoryKv<unknown>();
		const changes =
			memoryAppendLog<ReactiveCollectionChangeFrame<"reactiveList", ListChange<number>>>(
				"open-list",
			);

		const opened = await openPersistentReactiveList<number>({
			graph: g,
			name: "list",
			initial: [10],
			snapshotStore: snapshots,
			snapshotKey: "list/snapshot",
			changeLog: changes,
		});
		await waitControl((done) => opened.persistence.flush(done));
		opened.collection.append(20);
		await waitControl((done) => opened.persistence.flush(done));
		await waitControl((done) => opened.persistence.snapshot(done));

		const reopened = await openPersistentReactiveList<number>({
			graph: graph(),
			name: "list",
			initial: [999],
			snapshotStore: snapshots,
			snapshotKey: "list/snapshot",
			changeLog: changes,
		});

		expect(opened.loaded.source).toBe("empty");
		expect(opened.collection.toArray()).toEqual([10, 20]);
		expect(reopened.loaded.source).toBe("snapshot");
		expect(reopened.collection.toArray()).toEqual([10, 20]);
		await waitControl((done) => opened.persistence.dispose(done));
		await waitControl((done) => reopened.persistence.dispose(done));
	});

	it("openPersistentReactiveList uses one default snapshot key for load and persist", async () => {
		const snapshots = memoryKv<unknown>();
		const changes =
			memoryAppendLog<ReactiveCollectionChangeFrame<"reactiveList", ListChange<number>>>(
				"default-key-list",
			);
		const opened = await openPersistentReactiveList<number>({
			graph: graph(),
			name: "defaultList",
			initial: [1],
			snapshotStore: snapshots,
			changeLog: changes,
		});
		await waitControl((done) => opened.persistence.flush(done));
		opened.collection.append(2);
		await waitControl((done) => opened.persistence.flush(done));
		await waitControl((done) => opened.persistence.snapshot(done));
		await waitControl((done) => opened.persistence.dispose(done));

		const reopened = await openPersistentReactiveList<number>({
			graph: graph(),
			name: "defaultList",
			initial: [999],
			snapshotStore: snapshots,
			changeLog: changes,
		});

		expect(reopened.loaded.source).toBe("snapshot");
		expect(reopened.collection.toArray()).toEqual([1, 2]);
		await waitControl((done) => reopened.persistence.flush(done));
		await waitControl((done) => reopened.persistence.dispose(done));

		const third = await openPersistentReactiveList<number>({
			graph: graph(),
			name: "defaultList",
			initial: [999],
			snapshotStore: snapshots,
			changeLog: changes,
		});
		expect(third.collection.toArray()).toEqual([1, 2]);
		await waitControl((done) => third.persistence.dispose(done));
	});

	it("openPersistentReactiveLog folds log changes and honors maxSize through restore options", async () => {
		const snapshots = memoryKv<unknown>();
		const changes =
			memoryAppendLog<ReactiveCollectionChangeFrame<"reactiveLog", LogChange<string>>>("open-log");
		await changes.append(
			reactiveCollectionChangeFrame("reactiveLog", {
				kind: "appendMany",
				values: ["a", "b", "c"],
			}),
		);

		const opened = await openPersistentReactiveLog<string>({
			graph: graph(),
			name: "log",
			initial: ["ignored"],
			snapshotStore: snapshots,
			snapshotKey: "log/snapshot",
			changeLog: changes,
			collection: { maxSize: 2 },
		});

		expect(opened.loaded.source).toBe("changes");
		expect(opened.collection.toArray()).toEqual(["b", "c"]);
		await waitControl((done) => opened.persistence.dispose(done));
	});

	it("openPersistentReactiveMap and openPersistentReactiveIndex compose load -> restore -> persist", async () => {
		const mapSnapshots = memoryKv<unknown>();
		const mapChanges =
			memoryAppendLog<ReactiveCollectionChangeFrame<"reactiveMap", MapChange<string, number>>>(
				"open-map",
			);
		const openedMap = await openPersistentReactiveMap<string, number>({
			graph: graph(),
			name: "map",
			initial: [["a", 1]],
			snapshotStore: mapSnapshots,
			snapshotKey: "map/snapshot",
			changeLog: mapChanges,
		});
		await waitControl((done) => openedMap.persistence.flush(done));
		openedMap.collection.set("b", 2);
		await waitControl((done) => openedMap.persistence.flush(done));
		await waitControl((done) => openedMap.persistence.snapshot(done));
		await waitControl((done) => openedMap.persistence.dispose(done));

		const reopenedMap = await openPersistentReactiveMap<string, number>({
			graph: graph(),
			name: "map",
			initial: [["ignored", 999]],
			snapshotStore: mapSnapshots,
			snapshotKey: "map/snapshot",
			changeLog: mapChanges,
		});
		expect(reopenedMap.collection.get("a")).toBe(1);
		expect(reopenedMap.collection.get("b")).toBe(2);
		await waitControl((done) => reopenedMap.persistence.dispose(done));

		const indexSnapshots = memoryKv<unknown>();
		const indexChanges =
			memoryAppendLog<ReactiveCollectionChangeFrame<"reactiveIndex", IndexChange<string, number>>>(
				"open-index",
			);
		const openedIndex = await openPersistentReactiveIndex<string, number>({
			graph: graph(),
			name: "index",
			initial: [{ primary: "a", secondary: 1, value: 10 }],
			snapshotStore: indexSnapshots,
			snapshotKey: "index/snapshot",
			changeLog: indexChanges,
		});
		await waitControl((done) => openedIndex.persistence.flush(done));
		openedIndex.collection.upsert("b", 2, 20);
		await waitControl((done) => openedIndex.persistence.flush(done));
		await waitControl((done) => openedIndex.persistence.snapshot(done));
		await waitControl((done) => openedIndex.persistence.dispose(done));

		const reopenedIndex = await openPersistentReactiveIndex<string, number>({
			graph: graph(),
			name: "index",
			initial: [{ primary: "ignored", secondary: 0, value: 999 }],
			snapshotStore: indexSnapshots,
			snapshotKey: "index/snapshot",
			changeLog: indexChanges,
		});
		expect(reopenedIndex.collection.get("a")).toBe(10);
		expect(reopenedIndex.collection.get("b")).toBe(20);
		await waitControl((done) => reopenedIndex.persistence.dispose(done));
	});
});
