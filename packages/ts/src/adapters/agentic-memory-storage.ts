import type { DeliveryMeta } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import { assertGraphLocalNode, type Graph, type StateNode } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { Message } from "../protocol/messages.js";
import {
	type AgenticMemoryRecord,
	type AgenticMemoryRecordFrame,
	type AgenticMemoryStrictJsonValue,
	agenticMemoryRecordCodec,
	agenticMemoryRecordFrame,
	agenticMemoryRecordFrameCodec,
	assertAgenticMemoryRecordFrame,
} from "../solutions/index.js";
import {
	type AppendLogEntry,
	type AppendLogStorageTier,
	type KvStorageTier,
	memoryAppendLog,
} from "../storage/index.js";

export const AGENTIC_MEMORY_RECORD_SNAPSHOT_FORMAT =
	"graphrefly.agenticMemory.records.snapshot" as const;
export const AGENTIC_MEMORY_RECORD_CHANGE_FORMAT =
	"graphrefly.agenticMemory.records.change" as const;
export const AGENTIC_MEMORY_RECORD_STORAGE_FRAME_VERSION = 1 as const;
export const AGENTIC_MEMORY_PASSIVE_STORE_FRAME_CURSOR_KIND =
	"agentic-memory-passive-store-frame.cursor" as const;

export interface AgenticMemoryRecordSnapshotFrame<
	TJson extends AgenticMemoryStrictJsonValue = AgenticMemoryStrictJsonValue,
> {
	readonly format: typeof AGENTIC_MEMORY_RECORD_SNAPSHOT_FORMAT;
	readonly version: typeof AGENTIC_MEMORY_RECORD_STORAGE_FRAME_VERSION;
	readonly changeCursor: number;
	readonly records: readonly AgenticMemoryRecordFrame<TJson>[];
}

export interface AgenticMemoryRecordChangeFrame<
	TJson extends AgenticMemoryStrictJsonValue = AgenticMemoryStrictJsonValue,
> {
	readonly format: typeof AGENTIC_MEMORY_RECORD_CHANGE_FORMAT;
	readonly version: typeof AGENTIC_MEMORY_RECORD_STORAGE_FRAME_VERSION;
	readonly change: {
		readonly kind: "replaceAll";
		readonly records: readonly AgenticMemoryRecordFrame<TJson>[];
	};
}

export interface AgenticMemoryRecordsRestoreState<
	TJson extends AgenticMemoryStrictJsonValue = AgenticMemoryStrictJsonValue,
> {
	readonly records: readonly AgenticMemoryRecord<TJson>[];
	readonly source: "empty" | "changes" | "snapshot" | "snapshot+changes";
	readonly snapshot: { readonly found: boolean; readonly changeCursor: number };
	readonly changes: { readonly applied: number; readonly cursor: number };
}

export interface LoadAgenticMemoryRecordsStateOptions {
	readonly snapshotStore: KvStorageTier<unknown>;
	readonly snapshotKey?: string;
	readonly storagePrefix?: string;
	readonly changeLog?: AppendLogStorageTier<unknown>;
}

export type AgenticMemoryPassiveStoreFrameStatusState = "ready" | "empty" | "error";

export interface AgenticMemoryPassiveStoreFrameCursor {
	readonly kind: typeof AGENTIC_MEMORY_PASSIVE_STORE_FRAME_CURSOR_KIND;
	readonly writes: number;
	readonly reads: number;
	readonly storedFrames: number;
	readonly lastFrameIndex: number;
	readonly issues: number;
}

export interface AgenticMemoryPassiveStoreFrameStatus {
	readonly state: AgenticMemoryPassiveStoreFrameStatusState;
	readonly cursor: AgenticMemoryPassiveStoreFrameCursor;
}

export interface AgenticMemoryPassiveStoreFrameAuditEntry {
	readonly kind: "agentic-memory-passive-store-frame-audit";
	readonly action: "frame-received" | "frames-read" | "issue-recorded";
	readonly frameIndex?: number;
	readonly reason?: string;
}

export interface AgenticMemoryPassiveStoreFrameWriteResult {
	readonly status: AgenticMemoryPassiveStoreFrameStatus;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryPassiveStoreFrameAuditEntry[];
	readonly cursor: AgenticMemoryPassiveStoreFrameCursor;
}

export interface AgenticMemoryPassiveStoreFrameReadOptions {
	readonly after?: number;
	readonly limit?: number;
}

export interface AgenticMemoryPassiveStoreFrameReadResult {
	readonly frames: readonly Uint8Array[];
	readonly status: AgenticMemoryPassiveStoreFrameStatus;
	readonly issues: readonly DataIssue[];
	readonly audit: readonly AgenticMemoryPassiveStoreFrameAuditEntry[];
	readonly cursor: AgenticMemoryPassiveStoreFrameCursor;
}

export interface AgenticMemoryPassiveStoreFrameAdapter {
	write(frame: Uint8Array): Promise<AgenticMemoryPassiveStoreFrameWriteResult>;
	read(
		opts?: AgenticMemoryPassiveStoreFrameReadOptions,
	): Promise<AgenticMemoryPassiveStoreFrameReadResult>;
}

export interface AgenticMemoryRecordsPersistenceCursor {
	readonly kind: "persistence.cursor";
	readonly changeSeq: number;
	readonly snapshotWrites: number;
	readonly changeWrites: number;
}

export interface AgenticMemoryRecordsPersistenceStatus {
	readonly state: "starting" | "ready" | "flushing" | "errored" | "disposed";
	readonly pending: number;
	readonly writes: number;
	readonly errors: number;
	readonly cursor: AgenticMemoryRecordsPersistenceCursor;
}

export interface AgenticMemoryRecordsPersistenceError {
	readonly phase: "snapshot" | "change";
	readonly message: string;
	readonly cursor: AgenticMemoryRecordsPersistenceCursor;
}

export interface PersistAgenticMemoryRecordsOptions {
	readonly name?: string;
	readonly snapshotStore: KvStorageTier<unknown>;
	readonly snapshotKey?: string;
	readonly storagePrefix?: string;
	readonly changeLog?: AppendLogStorageTier<unknown>;
	readonly initialChangeCursor?: number;
	readonly snapshotOnAttach?: boolean;
	readonly snapshotEveryChanges?: number;
}

export interface AgenticMemoryRecordsPersistenceHandle {
	readonly ready: StateNode<boolean>;
	readonly status: StateNode<AgenticMemoryRecordsPersistenceStatus>;
	readonly error: StateNode<AgenticMemoryRecordsPersistenceError | null>;
	readonly cursor: StateNode<AgenticMemoryRecordsPersistenceCursor>;
	flush(done?: (status: AgenticMemoryRecordsPersistenceStatus) => void): void;
	snapshot(done?: (status: AgenticMemoryRecordsPersistenceStatus) => void): void;
	dispose(done?: (status: AgenticMemoryRecordsPersistenceStatus) => void): void;
}

export interface OpenPersistentAgenticMemoryRecordsOptions<
	TJson extends AgenticMemoryStrictJsonValue,
> extends LoadAgenticMemoryRecordsStateOptions,
		Omit<
			PersistAgenticMemoryRecordsOptions,
			"snapshotStore" | "changeLog" | "initialChangeCursor"
		> {
	readonly graph: Graph;
	readonly name?: string;
	readonly initial?: readonly AgenticMemoryRecord<TJson>[];
}

export interface PersistentAgenticMemoryRecords<TJson extends AgenticMemoryStrictJsonValue> {
	readonly records: StateNode<readonly AgenticMemoryRecord<TJson>[]>;
	readonly persistence: AgenticMemoryRecordsPersistenceHandle;
	readonly loaded: AgenticMemoryRecordsRestoreState<TJson>;
}

interface QueueItem {
	readonly phase: "snapshot" | "change" | "flush" | "dispose";
	readonly done?: (status: AgenticMemoryRecordsPersistenceStatus) => void;
	run(): void | PromiseLike<void>;
}

/**
 * Creates an agentic memory records snapshot key.
 *
 * @param storagePrefix - Prefix used to derive storage keys.
 * @returns The stable key or reference string.
 * @category adapters
 * @example
 * ```ts
 * import { agenticMemoryRecordsSnapshotKey } from "@graphrefly/ts/adapters";
 * ```
 */
export function agenticMemoryRecordsSnapshotKey(storagePrefix = "agentic-memory"): string {
	if (storagePrefix.length === 0) throw new TypeError("storagePrefix must be non-empty");
	return `${storagePrefix}/records.snapshot`;
}

/**
 * Creates an agentic memory record snapshot frame.
 *
 * @param records - Records to encode, persist, or project.
 * @param opts - Options that configure the helper.
 * @returns The agentic memory record snapshot frame result.
 * @category adapters
 * @example
 * ```ts
 * import { agenticMemoryRecordSnapshotFrame } from "@graphrefly/ts/adapters";
 * ```
 */
export function agenticMemoryRecordSnapshotFrame<
	TJson extends AgenticMemoryStrictJsonValue = AgenticMemoryStrictJsonValue,
>(
	records: readonly AgenticMemoryRecord<TJson>[],
	opts: { readonly changeCursor?: number } = {},
): AgenticMemoryRecordSnapshotFrame<TJson> {
	const changeCursor = validateChangeCursor(opts.changeCursor ?? -1);
	return assertAgenticMemoryRecordSnapshotFrame({
		format: AGENTIC_MEMORY_RECORD_SNAPSHOT_FORMAT,
		version: AGENTIC_MEMORY_RECORD_STORAGE_FRAME_VERSION,
		changeCursor,
		records: records.map((record) => agenticMemoryRecordFrame(record)),
	});
}

/**
 * Creates an agentic memory record change frame.
 *
 * @param records - Records to encode, persist, or project.
 * @returns The agentic memory record change frame result.
 * @category adapters
 * @example
 * ```ts
 * import { agenticMemoryRecordChangeFrame } from "@graphrefly/ts/adapters";
 * ```
 */
export function agenticMemoryRecordChangeFrame<
	TJson extends AgenticMemoryStrictJsonValue = AgenticMemoryStrictJsonValue,
>(records: readonly AgenticMemoryRecord<TJson>[]): AgenticMemoryRecordChangeFrame<TJson> {
	return assertAgenticMemoryRecordChangeFrame({
		format: AGENTIC_MEMORY_RECORD_CHANGE_FORMAT,
		version: AGENTIC_MEMORY_RECORD_STORAGE_FRAME_VERSION,
		change: {
			kind: "replaceAll",
			records: records.map((record) => agenticMemoryRecordFrame(record)),
		},
	});
}

/**
 * Asserts that a value is an agentic memory record snapshot frame.
 *
 * @param value - Unknown value to check or decode.
 * @returns The narrowed, validated value.
 * @category adapters
 * @example
 * ```ts
 * import { assertAgenticMemoryRecordSnapshotFrame } from "@graphrefly/ts/adapters";
 * ```
 */
export function assertAgenticMemoryRecordSnapshotFrame<
	TJson extends AgenticMemoryStrictJsonValue = AgenticMemoryStrictJsonValue,
>(value: unknown): AgenticMemoryRecordSnapshotFrame<TJson> {
	if (!isPlainRecord(value)) throw new TypeError("agentic memory snapshot frame must be an object");
	assertKeys(
		value,
		["changeCursor", "format", "records", "version"],
		"agentic memory snapshot frame",
	);
	if (value.format !== AGENTIC_MEMORY_RECORD_SNAPSHOT_FORMAT) {
		throw new TypeError("agentic memory snapshot frame: invalid format");
	}
	if (value.version !== AGENTIC_MEMORY_RECORD_STORAGE_FRAME_VERSION) {
		throw new TypeError("agentic memory snapshot frame: invalid version");
	}
	const changeCursor = validateChangeCursor(value.changeCursor);
	if (!Array.isArray(value.records)) {
		throw new TypeError("agentic memory snapshot frame: records must be an array");
	}
	const records = assertDenseRecordFrames<TJson>(
		value.records,
		"agentic memory snapshot frame records",
	);
	return Object.freeze({
		format: AGENTIC_MEMORY_RECORD_SNAPSHOT_FORMAT,
		version: AGENTIC_MEMORY_RECORD_STORAGE_FRAME_VERSION,
		changeCursor,
		records: Object.freeze(records),
	});
}

/**
 * Asserts that a value is an agentic memory record change frame.
 *
 * @param value - Unknown value to check or decode.
 * @returns The narrowed, validated value.
 * @category adapters
 * @example
 * ```ts
 * import { assertAgenticMemoryRecordChangeFrame } from "@graphrefly/ts/adapters";
 * ```
 */
export function assertAgenticMemoryRecordChangeFrame<
	TJson extends AgenticMemoryStrictJsonValue = AgenticMemoryStrictJsonValue,
>(value: unknown): AgenticMemoryRecordChangeFrame<TJson> {
	if (!isPlainRecord(value)) throw new TypeError("agentic memory change frame must be an object");
	assertKeys(value, ["change", "format", "version"], "agentic memory change frame");
	if (value.format !== AGENTIC_MEMORY_RECORD_CHANGE_FORMAT) {
		throw new TypeError("agentic memory change frame: invalid format");
	}
	if (value.version !== AGENTIC_MEMORY_RECORD_STORAGE_FRAME_VERSION) {
		throw new TypeError("agentic memory change frame: invalid version");
	}
	if (!isPlainRecord(value.change)) {
		throw new TypeError("agentic memory change frame: change must be an object");
	}
	assertKeys(value.change, ["kind", "records"], "agentic memory change frame change");
	if (value.change.kind !== "replaceAll") {
		throw new TypeError("agentic memory change frame: change.kind must be replaceAll");
	}
	if (!Array.isArray(value.change.records)) {
		throw new TypeError("agentic memory change frame: change.records must be an array");
	}
	const records = assertDenseRecordFrames<TJson>(
		value.change.records,
		"agentic memory change frame records",
	);
	return Object.freeze({
		format: AGENTIC_MEMORY_RECORD_CHANGE_FORMAT,
		version: AGENTIC_MEMORY_RECORD_STORAGE_FRAME_VERSION,
		change: Object.freeze({
			kind: "replaceAll",
			records: Object.freeze(records),
		}),
	});
}

/**
 * Creates a host-owned in-memory adapter for encoded D585 AgenticMemory store frames.
 *
 * The adapter stores opaque bytes only. It does not decode frames, mutate graph
 * records, hydrate a live graph, or report a durable commit acknowledgement;
 * status/cursor material describes this adapter's own read/write operations.
 * @returns An in-memory passive store-frame adapter.
 * @category adapters
 * @example
 * ```ts
 * import { memoryAgenticMemoryPassiveStoreFrameAdapter } from "@graphrefly/ts/adapters";
 * ```
 */
export function memoryAgenticMemoryPassiveStoreFrameAdapter(): AgenticMemoryPassiveStoreFrameAdapter {
	const log = memoryAppendLog<readonly number[]>("agentic-memory-passive-store-frame");
	let writes = 0;
	let reads = 0;
	let issues = 0;

	function cursor(lastFrameIndex = writes - 1): AgenticMemoryPassiveStoreFrameCursor {
		return Object.freeze({
			kind: AGENTIC_MEMORY_PASSIVE_STORE_FRAME_CURSOR_KIND,
			writes,
			reads,
			storedFrames: writes,
			lastFrameIndex,
			issues,
		});
	}

	function ok(
		state: AgenticMemoryPassiveStoreFrameStatusState,
		audit: readonly AgenticMemoryPassiveStoreFrameAuditEntry[],
		lastFrameIndex?: number,
	): {
		readonly status: AgenticMemoryPassiveStoreFrameStatus;
		readonly issues: readonly DataIssue[];
		readonly audit: readonly AgenticMemoryPassiveStoreFrameAuditEntry[];
		readonly cursor: AgenticMemoryPassiveStoreFrameCursor;
	} {
		const current = cursor(lastFrameIndex);
		return Object.freeze({
			status: Object.freeze({ state, cursor: current }),
			issues: Object.freeze([]),
			audit: Object.freeze(audit),
			cursor: current,
		});
	}

	function fail(
		message: string,
		lastFrameIndex?: number,
	): {
		readonly status: AgenticMemoryPassiveStoreFrameStatus;
		readonly issues: readonly DataIssue[];
		readonly audit: readonly AgenticMemoryPassiveStoreFrameAuditEntry[];
		readonly cursor: AgenticMemoryPassiveStoreFrameCursor;
	} {
		issues += 1;
		const issue = passiveFrameIssue(message);
		const current = cursor(lastFrameIndex);
		return Object.freeze({
			status: Object.freeze({ state: "error", cursor: current }),
			issues: Object.freeze([issue]),
			audit: Object.freeze([
				passiveFrameAudit("issue-recorded", {
					reason: issue.code,
					frameIndex: lastFrameIndex,
				}),
			]),
			cursor: current,
		});
	}

	return {
		write(frame) {
			if (!(frame instanceof Uint8Array)) {
				return log.size().then(() => fail("frame must be encoded Uint8Array bytes"));
			}
			const storedFrame = Object.freeze([...frame]);
			return log.append(storedFrame).then((entry) => {
				writes += 1;
				return ok(
					"ready",
					[passiveFrameAudit("frame-received", { frameIndex: entry.seq })],
					entry.seq,
				);
			});
		},
		read(opts = {}) {
			reads += 1;
			const after = opts.after ?? -1;
			const limit = opts.limit ?? Number.POSITIVE_INFINITY;
			if (!Number.isSafeInteger(after) || after < -1) {
				return log.size().then(() =>
					Object.freeze({
						...fail("after must be a safe integer >= -1", after),
						frames: Object.freeze([]),
					}),
				);
			}
			if (limit !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(limit) || limit < 0)) {
				return log.size().then(() =>
					Object.freeze({
						...fail("limit must be a non-negative safe integer"),
						frames: Object.freeze([]),
					}),
				);
			}
			return log.read({ after, limit }).then((entries) => {
				const visible = entries.map((entry) => new Uint8Array(entry.value));
				const lastFrameIndex = entries.at(-1)?.seq ?? after;
				const result = ok(
					visible.length === 0 ? "empty" : "ready",
					[passiveFrameAudit("frames-read", { frameIndex: lastFrameIndex })],
					lastFrameIndex,
				);
				return Object.freeze({
					...result,
					frames: Object.freeze(visible),
				});
			});
		},
	};
}

/**
 * Loads agentic memory records state.
 *
 * Loading decodes passive frames outside the sync core and returns ordinary
 * record DATA for an explicit later graph/bootstrap input. It does not hydrate
 * or mutate a live graph and does not make storage the source of record truth.
 * @param opts - Options that configure the helper.
 * @returns The load agentic memory records state result.
 * @category adapters
 * @example
 * ```ts
 * import { loadAgenticMemoryRecordsState } from "@graphrefly/ts/adapters";
 * ```
 */
export function loadAgenticMemoryRecordsState<
	TJson extends AgenticMemoryStrictJsonValue = AgenticMemoryStrictJsonValue,
>(opts: LoadAgenticMemoryRecordsStateOptions): Promise<AgenticMemoryRecordsRestoreState<TJson>> {
	const storagePrefix = opts.storagePrefix ?? "agentic-memory";
	const snapshotKey = opts.snapshotKey ?? agenticMemoryRecordsSnapshotKey(storagePrefix);
	return opts.snapshotStore.get(snapshotKey).then((rawSnapshot) => {
		let records: readonly AgenticMemoryRecord<TJson>[] = [];
		let source: AgenticMemoryRecordsRestoreState<TJson>["source"] = "empty";
		let changeCursor = -1;
		if (rawSnapshot !== undefined) {
			const snapshot = assertAgenticMemoryRecordSnapshotFrame<TJson>(rawSnapshot);
			records = snapshot.records.map(recordFromFrame);
			changeCursor = snapshot.changeCursor;
			source = "snapshot";
		}
		if (opts.changeLog === undefined) {
			return {
				records,
				source,
				snapshot: { found: rawSnapshot !== undefined, changeCursor },
				changes: { applied: 0, cursor: changeCursor },
			};
		}
		return opts.changeLog.read({ after: changeCursor }).then((entries) => {
			let applied = 0;
			let cursor = changeCursor;
			for (const entry of entries) {
				if (entry.seq !== cursor + 1) {
					throw new Error("agentic memory records change log is non-contiguous");
				}
				const change = assertAgenticMemoryRecordChangeFrame<TJson>(entry.value);
				records = change.change.records.map(recordFromFrame);
				cursor = entry.seq;
				applied += 1;
			}
			return {
				records,
				source:
					rawSnapshot !== undefined && applied > 0
						? "snapshot+changes"
						: rawSnapshot !== undefined
							? "snapshot"
							: applied > 0
								? "changes"
								: "empty",
				snapshot: { found: rawSnapshot !== undefined, changeCursor },
				changes: { applied, cursor },
			};
		});
	});
}

/**
 * Persists agentic memory records.
 *
 * This graph-bound adapter observes record DATA and writes passive frames
 * outside the sync core. The exposed ready/status/error/cursor nodes describe
 * adapter queue progress only; they are not durable commit acknowledgements
 * and they do not apply, admit, or mutate AgenticMemory records.
 * @param graph - Graph that owns the created nodes or projector.
 * @param records - Records to encode, persist, or project.
 * @param opts - Options that configure the helper.
 * @returns The persist agentic memory records result.
 * @category adapters
 * @example
 * ```ts
 * import { persistAgenticMemoryRecords } from "@graphrefly/ts/adapters";
 * ```
 */
export function persistAgenticMemoryRecords<
	TJson extends AgenticMemoryStrictJsonValue = AgenticMemoryStrictJsonValue,
>(
	graph: Graph,
	records: Node<readonly AgenticMemoryRecord<TJson>[]>,
	opts: PersistAgenticMemoryRecordsOptions,
): AgenticMemoryRecordsPersistenceHandle {
	const name = opts.name ?? "agenticMemoryRecords.persistence";
	const snapshotKey =
		opts.snapshotKey ?? agenticMemoryRecordsSnapshotKey(opts.storagePrefix ?? name);
	const snapshotEveryChanges = validateSnapshotEveryChanges(opts.snapshotEveryChanges);
	assertGraphLocalNode(graph, records as Node<unknown>, `${name}.records`);
	let cursorValue: AgenticMemoryRecordsPersistenceCursor = {
		kind: "persistence.cursor",
		changeSeq: validateChangeCursor(opts.initialChangeCursor ?? -1),
		snapshotWrites: 0,
		changeWrites: 0,
	};
	let statusValue = statusOf("starting", 0, 0, 0, cursorValue);
	let errorCount = 0;
	let writes = 0;
	let running = false;
	let disposed = false;
	let disposeRequested = false;
	let subscribing = true;
	let observedChangesSinceSnapshot = 0;
	let latestRecords: readonly AgenticMemoryRecord<TJson>[] = records.cache ?? [];
	let stop: (() => void) | undefined;
	const queue: QueueItem[] = [];
	const ready = graph.state(false, { name: `${name}/ready` });
	const status = graph.state<AgenticMemoryRecordsPersistenceStatus>(statusValue, {
		name: `${name}/status`,
	});
	const error = graph.state<AgenticMemoryRecordsPersistenceError | null>(null, {
		name: `${name}/error`,
	});
	const cursor = graph.state<AgenticMemoryRecordsPersistenceCursor>(cursorValue, {
		name: `${name}/cursor`,
	});

	function publish(state: AgenticMemoryRecordsPersistenceStatus["state"]): void {
		const nextState = statusValue.state === "errored" && state !== "disposed" ? "errored" : state;
		statusValue = statusOf(
			nextState,
			queue.length + (running ? 1 : 0),
			writes,
			errorCount,
			cursorValue,
		);
		cursor.set(cursorValue);
		status.set(statusValue);
		if (nextState === "ready") ready.set(true);
		if (nextState === "errored" || nextState === "disposed") ready.set(false);
	}

	function report(phase: "snapshot" | "change", caught: unknown): void {
		errorCount += 1;
		error.set({ phase, message: errorMessage(caught), cursor: cursorValue });
	}

	function callDone(done: QueueItem["done"]): void {
		try {
			done?.(statusValue);
		} catch {
			// Done callbacks are advisory controls and must not wedge the adapter queue.
		}
	}

	function finish(item: QueueItem): void {
		if (item.phase === "dispose") {
			disposed = true;
			running = false;
			publish("disposed");
		} else if (statusValue.state !== "errored") {
			running = false;
			publish("ready");
		} else {
			running = false;
			publish("errored");
		}
		callDone(item.done);
		drain();
	}

	function fail(item: QueueItem, caught: unknown): void {
		if (item.phase === "snapshot" || item.phase === "change") report(item.phase, caught);
		running = false;
		if (item.phase === "snapshot" || item.phase === "change") publish("errored");
		callDone(item.done);
		drain();
	}

	function chainThenable(item: QueueItem, value: unknown): boolean {
		if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
		const then = (value as { then?: unknown }).then;
		if (typeof then !== "function") return false;
		let settled = false;
		const settle = (next: () => void) => {
			if (settled) return;
			settled = true;
			next();
		};
		try {
			(then as (onFulfilled: () => void, onRejected: (error: unknown) => void) => unknown).call(
				value,
				() => settle(() => finish(item)),
				(caught) => settle(() => fail(item, caught)),
			);
		} catch (caught) {
			settle(() => fail(item, caught));
		}
		return true;
	}

	function enqueue(item: QueueItem): void {
		if (disposed || (disposeRequested && item.phase !== "dispose" && item.phase !== "flush")) {
			callDone(item.done);
			return;
		}
		queue.push(item);
		drain();
	}

	function drain(): void {
		if (running) return;
		const item = queue.shift();
		if (item === undefined) return;
		running = true;
		publish(
			item.phase === "flush" ? "flushing" : statusValue.state === "starting" ? "starting" : "ready",
		);
		let result: void | PromiseLike<void>;
		try {
			result = item.run();
		} catch (caught) {
			fail(item, caught);
			return;
		}
		if (chainThenable(item, result)) return;
		finish(item);
	}

	function enqueueSnapshot(done?: (status: AgenticMemoryRecordsPersistenceStatus) => void): void {
		const snapshotRecords = latestRecords;
		observedChangesSinceSnapshot = 0;
		enqueue({
			phase: "snapshot",
			done,
			run() {
				const records = Object.freeze(
					snapshotRecords.map((record) => agenticMemoryRecordFrame(record)),
				);
				const frame = assertAgenticMemoryRecordSnapshotFrame<TJson>({
					format: AGENTIC_MEMORY_RECORD_SNAPSHOT_FORMAT,
					version: AGENTIC_MEMORY_RECORD_STORAGE_FRAME_VERSION,
					changeCursor: cursorValue.changeSeq,
					records,
				});
				return opts.snapshotStore.set(snapshotKey, frame).then(() => {
					cursorValue = { ...cursorValue, snapshotWrites: cursorValue.snapshotWrites + 1 };
					writes += 1;
					publish("ready");
				});
			},
		});
	}

	function enqueueChange(nextRecords: readonly AgenticMemoryRecord<TJson>[]): void {
		const changeLog = opts.changeLog;
		if (changeLog === undefined) return;
		enqueue({
			phase: "change",
			run() {
				const frame = agenticMemoryRecordChangeFrame(nextRecords);
				return changeLog.append(frame).then((written) => {
					const entry = written as AppendLogEntry<AgenticMemoryRecordChangeFrame<TJson>>;
					cursorValue = {
						...cursorValue,
						changeSeq: entry.seq,
						changeWrites: cursorValue.changeWrites + 1,
					};
					writes += 1;
					publish("ready");
				});
			},
		});
	}

	function cancelQueuedForDispose(): void {
		const pending = queue.splice(0);
		for (const item of pending) callDone(item.done);
	}

	stop = records.subscribe((msg: Message, delivery?: DeliveryMeta) => {
		if (disposeRequested) return;
		const nextRecords = dataOf<readonly AgenticMemoryRecord<TJson>[]>(msg);
		if (nextRecords === undefined) return;
		latestRecords = nextRecords;
		if (subscribing && delivery === undefined) return;
		observedChangesSinceSnapshot += 1;
		enqueueChange(nextRecords);
		if (
			snapshotEveryChanges !== undefined &&
			observedChangesSinceSnapshot >= snapshotEveryChanges
		) {
			enqueueSnapshot();
		}
	});
	subscribing = false;
	if (opts.snapshotOnAttach !== false) enqueueSnapshot();
	else publish("ready");

	return {
		ready,
		status,
		error,
		cursor,
		flush(done?: (status: AgenticMemoryRecordsPersistenceStatus) => void): void {
			if (disposed) {
				callDone(done);
				return;
			}
			enqueue({ phase: "flush", done, run: () => undefined });
		},
		snapshot(done?: (status: AgenticMemoryRecordsPersistenceStatus) => void): void {
			if (disposed || disposeRequested) {
				callDone(done);
				return;
			}
			enqueueSnapshot(done);
		},
		dispose(done?: (status: AgenticMemoryRecordsPersistenceStatus) => void): void {
			if (disposed) {
				callDone(done);
				return;
			}
			disposeRequested = true;
			stop?.();
			cancelQueuedForDispose();
			enqueue({ phase: "dispose", done, run: () => undefined });
		},
	};
}

/**
 * Opens persistent agentic memory records.
 *
 * This composes an adapter-owned load with an explicit graph state node seeded
 * from ordinary record DATA, then attaches the passive persistence sidecar. It
 * is bootstrap wiring, not hot hydration, graph restore, or storage-owned truth.
 * @param opts - Options that configure the helper.
 * @returns The open persistent agentic memory records result.
 * @category adapters
 * @example
 * ```ts
 * import { openPersistentAgenticMemoryRecords } from "@graphrefly/ts/adapters";
 * ```
 */
export function openPersistentAgenticMemoryRecords<
	TJson extends AgenticMemoryStrictJsonValue = AgenticMemoryStrictJsonValue,
>(
	opts: OpenPersistentAgenticMemoryRecordsOptions<TJson>,
): Promise<PersistentAgenticMemoryRecords<TJson>> {
	const storagePrefix = opts.storagePrefix ?? opts.name ?? "agentic-memory";
	const snapshotKey = opts.snapshotKey ?? agenticMemoryRecordsSnapshotKey(storagePrefix);
	return loadAgenticMemoryRecordsState<TJson>({ ...opts, snapshotKey, storagePrefix }).then(
		(loaded) => {
			const records =
				loaded.source === "empty" && opts.initial !== undefined ? opts.initial : loaded.records;
			const node = opts.graph.state<readonly AgenticMemoryRecord<TJson>[]>(records, {
				name: opts.name,
			});
			const persistence = persistAgenticMemoryRecords(opts.graph, node, {
				...opts,
				name: opts.name ? `${opts.name}/persistence` : undefined,
				snapshotKey,
				storagePrefix,
				initialChangeCursor: loaded.changes.cursor,
			});
			return { records: node, persistence, loaded };
		},
	);
}

function recordFromFrame<TJson extends AgenticMemoryStrictJsonValue>(
	frame: AgenticMemoryRecordFrame<TJson>,
): AgenticMemoryRecord<TJson> {
	return agenticMemoryRecordCodec<TJson>().decode(
		agenticMemoryRecordFrameCodec<TJson>().encode(frame),
	);
}

function statusOf(
	state: AgenticMemoryRecordsPersistenceStatus["state"],
	pending: number,
	writes: number,
	errors: number,
	cursor: AgenticMemoryRecordsPersistenceCursor,
): AgenticMemoryRecordsPersistenceStatus {
	return { state, pending, writes, errors, cursor };
}

function dataOf<C>(msg: Message): C | undefined {
	return msg[0] === "DATA" ? (msg[1] as C) : undefined;
}

function passiveFrameIssue(message: string): DataIssue {
	return Object.freeze({
		kind: "issue",
		source: "agentic-memory",
		code: "agentic-memory.passive-store-frame-adapter.invalid",
		message,
		severity: "error",
	});
}

function passiveFrameAudit(
	action: AgenticMemoryPassiveStoreFrameAuditEntry["action"],
	opts: { readonly frameIndex?: number; readonly reason?: string } = {},
): AgenticMemoryPassiveStoreFrameAuditEntry {
	return Object.freeze({
		kind: "agentic-memory-passive-store-frame-audit",
		action,
		...(opts.frameIndex === undefined ? {} : { frameIndex: opts.frameIndex }),
		...(opts.reason === undefined ? {} : { reason: opts.reason }),
	});
}

function validateChangeCursor(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < -1) {
		throw new RangeError("changeCursor must be a safe integer >= -1");
	}
	return value;
}

function validateSnapshotEveryChanges(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RangeError("snapshotEveryChanges must be a positive safe integer");
	}
	return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value).sort();
	const want = [...expected].sort();
	if (actual.length !== want.length || actual.some((key, i) => key !== want[i])) {
		throw new TypeError(`${label}: unexpected frame fields ${actual.join(",")}`);
	}
}

function assertDenseRecordFrames<TJson extends AgenticMemoryStrictJsonValue>(
	value: readonly unknown[],
	label: string,
): readonly AgenticMemoryRecordFrame<TJson>[] {
	const records: AgenticMemoryRecordFrame<TJson>[] = [];
	for (let i = 0; i < value.length; i += 1) {
		if (!Object.hasOwn(value, i)) {
			throw new TypeError(`${label}: sparse array hole at ${i}`);
		}
		records.push(assertAgenticMemoryRecordFrame<TJson>(value[i]));
	}
	return Object.freeze(records);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
