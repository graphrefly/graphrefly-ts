import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { attachObserveEventLog } from "../adapters/observe-storage.js";
import {
	appendLogCommittedFactJournal,
	type CommittedFactJournalBackend,
	type CommittedFactJournalBatch,
	type CommittedFactJournalFact,
	type CommittedFactJournalProfile,
	committedFactJournalCursor,
	committedFactJournalCursorCodec,
} from "../committed-facts/index.js";
import { graph } from "../graph/graph.js";
import type { ObserveEvent } from "../graph/inspect.js";
import { compoundTupleKey } from "../identity.js";
import { strictCanonicalJsonBytes, strictJsonCodecFor } from "../json/codec.js";
import {
	type AppendLogStorageTier,
	memoryAppendLog,
	type ObserveEventFrame,
	observeEventFrameCodec,
} from "../storage/index.js";
import { fileAppendLog } from "../storage/node.js";

interface WorkFact extends CommittedFactJournalFact {
	readonly kind: "work-fact";
	readonly value: string;
}

interface WorkFactBatch extends CommittedFactJournalBatch<WorkFact> {
	readonly format: "work-fact-batch.v1";
}

type WorkCursor = ReturnType<ReturnType<typeof committedFactJournalCursorCodec>["initial"]>;

const workProfile: CommittedFactJournalProfile<WorkFact, WorkFactBatch, WorkCursor> = {
	assertBatch(value) {
		if (
			value === null ||
			typeof value !== "object" ||
			Array.isArray(value) ||
			(value as { format?: unknown }).format !== "work-fact-batch.v1"
		) {
			throw new TypeError("work fact batch format must be work-fact-batch.v1");
		}
		const candidate = value as WorkFactBatch;
		for (const item of candidate.facts ?? []) {
			if (item.kind !== "work-fact" || typeof item.value !== "string") {
				throw new TypeError("work fact material must be a string");
			}
			if (item.materialIdentity?.key !== workMaterialIdentity(item.value)) {
				throw new TypeError("work fact material identity must match canonical material");
			}
		}
		if (candidate.batchIdentity?.key !== workBatchIdentity(candidate.facts ?? [])) {
			throw new TypeError("work fact batch identity must match canonical facts");
		}
		return candidate;
	},
	cursor: committedFactJournalCursorCodec("work-facts"),
};

function fact(id: string, value: string): WorkFact {
	return Object.freeze({
		kind: "work-fact",
		identity: Object.freeze({ key: id }),
		materialIdentity: Object.freeze({ key: workMaterialIdentity(value) }),
		value,
	});
}

function batch(facts: readonly WorkFact[]): WorkFactBatch {
	return Object.freeze({
		format: "work-fact-batch.v1",
		batchIdentity: Object.freeze({ key: workBatchIdentity(facts) }),
		facts: Object.freeze([...facts]),
	});
}

function workMaterialIdentity(value: string): string {
	return compoundTupleKey("work-material", [sha256({ kind: "work-fact", value })]);
}

function workBatchIdentity(facts: readonly WorkFact[]): string {
	return compoundTupleKey(
		"work-batch",
		facts.flatMap((item) => [item.identity.key, item.materialIdentity.key]),
	);
}

function sha256(value: unknown): string {
	return createHash("sha256").update(strictCanonicalJsonBytes(value)).digest("hex");
}

describe("D641 reusable committed-fact journal", () => {
	it("is domain-neutral and preserves whole-batch identity/material semantics", async () => {
		const log = memoryAppendLog<WorkFactBatch>("work-facts");
		const journal = appendLogCommittedFactJournal({
			log,
			profile: workProfile,
			backendName: "work-memory",
		});
		const first = fact("work:1", "material:v1");
		const conflicting = fact("work:1", "material:v2");
		const second = fact("work:2", "material:v1");

		const committed = await journal.append(batch([first]));
		const duplicate = await journal.append(batch([first]));
		const conflict = await journal.append(batch([conflicting]));
		const overlap = await journal.append(batch([first, second]));
		const committedSecond = await journal.append(batch([second]));
		const readFirst = await journal.read({ limit: 1 });
		const readSecond = await journal.read({ after: readFirst.cursor, limit: 1 });

		expect(committed).toMatchObject({
			status: "committed",
			facts: 1,
			cursor: {
				kind: "committed-fact-journal.cursor",
				stream: "work-facts",
				position: 1,
			},
		});
		expect(duplicate.status).toBe("duplicate");
		expect(conflict).toMatchObject({
			status: "conflict",
			facts: 0,
			issues: [{ code: "committed-fact-journal.append-log.identity-conflict" }],
		});
		expect(overlap).toMatchObject({
			status: "rejected",
			facts: 0,
			issues: [{ code: "committed-fact-journal.append-log.batch-overlaps-committed-log" }],
		});
		expect(committedSecond.status).toBe("committed");
		expect(readFirst).toMatchObject({ facts: [first], done: false });
		expect(readSecond).toMatchObject({ facts: [second], done: true });
		expect(committed.backendCursor?.kind).toBe("committed-fact-journal-backend.cursor");
		expect(committed.cursor).not.toHaveProperty("backend");
		expect(committed.cursor).not.toHaveProperty("storageKey");
		expect(journal).not.toHaveProperty("materialize");
		expect(journal).not.toHaveProperty("restore");
		expect(journal).not.toHaveProperty("hydrate");
		expectTypeOf(readSecond.facts).toEqualTypeOf<readonly WorkFact[]>();
	});

	it("rejects non-strict material and repeated identities before storage append", async () => {
		const log = memoryAppendLog<WorkFactBatch>("strict-work-facts");
		const journal = appendLogCommittedFactJournal({ log, profile: workProfile });
		const repeated = fact("work:repeat", "material:v1");
		const invalid = batch([
			{
				...fact("work:bigint", "material:v1"),
				value: 1n,
			} as unknown as WorkFact,
		]);

		const duplicateInsideBatch = await journal.append(batch([repeated, repeated]));
		const nonStrict = await journal.append(invalid);

		expect(duplicateInsideBatch).toMatchObject({
			status: "rejected",
			issues: [
				{
					code: "committed-fact-journal.append-log.internal-duplicate-identity",
					subjectId: "work:repeat",
				},
			],
		});
		expect(nonStrict).toMatchObject({
			status: "rejected",
			issues: [{ code: "committed-fact-journal.append-log.invalid-batch" }],
		});
		expect(await log.size()).toBe(0);
	});

	it("makes domain-owned deterministic material validation part of the profile boundary", async () => {
		const log = memoryAppendLog<WorkFactBatch>("material-validation");
		const journal = appendLogCommittedFactJournal({ log, profile: workProfile });
		const original = fact("work:material", "original");
		const forged = {
			...original,
			value: "changed without changing material identity",
		} as WorkFact;

		expect((await journal.append(batch([original]))).status).toBe("committed");
		expect(await journal.append(batch([forged]))).toMatchObject({
			status: "rejected",
			issues: [{ code: "committed-fact-journal.append-log.invalid-batch" }],
		});
		expect(await log.size()).toBe(1);
	});

	it("installs the single-handle queue before caller-owned profile code can re-enter", async () => {
		const log = memoryAppendLog<WorkFactBatch>("reentrant-profile");
		let journal: CommittedFactJournalBackend<WorkFactBatch, WorkFact, WorkCursor>;
		let nested: ReturnType<typeof journal.append> | undefined;
		let reentered = false;
		const profile: CommittedFactJournalProfile<WorkFact, WorkFactBatch, WorkCursor> = {
			assertBatch(value) {
				const canonical = workProfile.assertBatch(value);
				if (!reentered) {
					reentered = true;
					nested = journal.append(batch([fact("work:reentrant-nested", "nested")]));
				}
				return canonical;
			},
			cursor: workProfile.cursor,
		};
		journal = appendLogCommittedFactJournal({ log, profile });

		const outer = await journal.append(batch([fact("work:reentrant-outer", "outer")]));
		expect(nested).toBeDefined();
		const nestedResult = await nested;
		const read = await journal.read();

		expect(outer).toMatchObject({
			status: "committed",
			cursor: { position: 1 },
		});
		expect(nestedResult).toMatchObject({
			status: "committed",
			cursor: { position: 2 },
		});
		expect(read.facts.map((item) => item.identity.key)).toEqual([
			"work:reentrant-outer",
			"work:reentrant-nested",
		]);
	});

	it("keeps a proven commit closed when optional backend cursor diagnostics fail", async () => {
		const log = memoryAppendLog<WorkFactBatch>("diagnostic-failure");
		const journal = appendLogCommittedFactJournal({
			log,
			profile: workProfile,
			backendCursorValue() {
				throw new Error(`diagnostic adapter failed ${"\ud800".repeat(2_000)}`);
			},
		});
		const stored = fact("work:diagnostic", "committed");

		const committed = await journal.append(batch([stored]));
		const read = await journal.read();

		expect(committed).toMatchObject({
			status: "committed",
			facts: 1,
			issues: [
				{
					code: "committed-fact-journal.append-log.invalid-backend-cursor-diagnostic",
					severity: "warning",
				},
			],
		});
		expect(committed).not.toHaveProperty("backendCursor");
		expect(read.facts).toEqual([stored]);
		expect(read.issues).toMatchObject([
			{
				code: "committed-fact-journal.append-log.invalid-backend-cursor-diagnostic",
				severity: "warning",
			},
		]);
		expect(() => strictCanonicalJsonBytes({ committed, read })).not.toThrow();
	});

	it("contains hostile diagnostic errors after a proven commit and bounds their messages", async () => {
		const hostile = Object.create(Error.prototype) as Error;
		Object.defineProperty(hostile, "message", {
			get() {
				throw new Error("message getter escaped");
			},
		});
		const hostileLog = memoryAppendLog<WorkFactBatch>("hostile-diagnostic");
		const hostileJournal = appendLogCommittedFactJournal({
			log: hostileLog,
			profile: workProfile,
			backendCursorValue() {
				throw hostile;
			},
		});
		const boundedLog = memoryAppendLog<WorkFactBatch>("large-diagnostic");
		const boundedJournal = appendLogCommittedFactJournal({
			log: boundedLog,
			profile: workProfile,
			backendCursorValue() {
				throw new Error("x".repeat(50_000));
			},
		});

		const hostileResult = await hostileJournal.append(
			batch([fact("work:hostile-diagnostic", "committed")]),
		);
		const boundedResult = await boundedJournal.append(
			batch([fact("work:large-diagnostic", "committed")]),
		);

		expect(hostileResult).toMatchObject({
			status: "committed",
			issues: [{ message: "error details were not safely reportable", severity: "warning" }],
		});
		expect(boundedResult.status).toBe("committed");
		expect(boundedResult.issues[0]?.message).toHaveLength(1_024);
		expect(() => strictCanonicalJsonBytes({ hostileResult, boundedResult })).not.toThrow();
	});

	it("normalizes synchronous backend throws into closed read and append results", async () => {
		const readBase = memoryAppendLog<WorkFactBatch>("sync-read-throw");
		const readThrows: AppendLogStorageTier<WorkFactBatch> = {
			...readBase,
			read() {
				throw new Error("synchronous read failure");
			},
		};
		const readJournal = appendLogCommittedFactJournal({
			log: readThrows,
			profile: workProfile,
		});
		const appendBase = memoryAppendLog<WorkFactBatch>("sync-append-throw");
		const appendThrows: AppendLogStorageTier<WorkFactBatch> = {
			...appendBase,
			append() {
				throw new Error("synchronous append failure");
			},
		};
		const appendJournal = appendLogCommittedFactJournal({
			log: appendThrows,
			profile: workProfile,
		});

		expect(await readJournal.read()).toMatchObject({
			facts: [],
			done: false,
			issues: [{ code: "committed-fact-journal.append-log.read-failed" }],
		});
		expect(
			await readJournal.append(batch([fact("work:sync-read", "not committed")])),
		).toMatchObject({
			status: "uncertain",
			issues: [{ code: "committed-fact-journal.append-log.precondition-read-failed" }],
		});
		expect(
			await appendJournal.append(batch([fact("work:sync-append", "not committed")])),
		).toMatchObject({
			status: "uncertain",
			issues: [{ code: "committed-fact-journal.append-log.append-uncertain" }],
		});
		expect(await appendBase.size()).toBe(0);
	});

	it("rejects a non-strict or position-incoherent profile cursor before physical append", async () => {
		interface BadCursor {
			readonly position: number;
			readonly invalid?: bigint;
		}
		const log = memoryAppendLog<WorkFactBatch>("invalid-profile-cursor");
		const profile: CommittedFactJournalProfile<WorkFact, WorkFactBatch, BadCursor> = {
			assertBatch: workProfile.assertBatch,
			cursor: {
				initial: () => ({ position: 0 }),
				position: (cursor) => (cursor as BadCursor).position,
				fromPosition: (position) => (position === 0 ? { position } : { position, invalid: 1n }),
			},
		};
		const journal = appendLogCommittedFactJournal({ log, profile });

		expect(await journal.append(batch([fact("work:cursor", "value")]))).toMatchObject({
			status: "rejected",
			issues: [{ code: "committed-fact-journal.append-log.invalid-profile-cursor" }],
		});
		expect(await log.size()).toBe(0);
	});

	it("does not trust a profile to synthesize non-strict storage material", async () => {
		const log = memoryAppendLog<WorkFactBatch>("profile-injection");
		const profile: CommittedFactJournalProfile<WorkFact, WorkFactBatch, WorkCursor> = {
			assertBatch(value) {
				const validated = workProfile.assertBatch(value);
				return { ...validated, injected: 1n } as unknown as WorkFactBatch;
			},
			cursor: workProfile.cursor,
		};
		const journal = appendLogCommittedFactJournal({ log, profile });

		expect(await journal.append(batch([fact("work:profile", "value")]))).toMatchObject({
			status: "rejected",
			issues: [{ code: "committed-fact-journal.append-log.invalid-batch" }],
		});
		expect(await log.size()).toBe(0);
	});

	it("fails closed when passive storage already contains conflicting fact identities", async () => {
		const log = memoryAppendLog<WorkFactBatch>("corrupt-work-facts");
		await log.append(batch([fact("work:corrupt", "first")]));
		await log.append(batch([fact("work:corrupt", "second")]));
		const journal = appendLogCommittedFactJournal({ log, profile: workProfile });

		expect(await journal.read()).toMatchObject({
			facts: [],
			done: false,
			issues: [{ code: "committed-fact-journal.append-log.invalid-stored-batch" }],
			backendStatus: { state: "degraded" },
		});
		expect(await journal.append(batch([fact("work:new", "value")]))).toMatchObject({
			status: "uncertain",
			issues: [{ code: "committed-fact-journal.append-log.precondition-read-failed" }],
		});
		expect(await log.size()).toBe(2);
	});

	it("rejects future cursors and contradictory capability declarations", async () => {
		const log = memoryAppendLog<WorkFactBatch>("cursor-and-capabilities");
		const journal = appendLogCommittedFactJournal({ log, profile: workProfile });

		expect(
			await journal.read({
				after: workProfile.cursor.fromPosition(10),
			}),
		).toMatchObject({
			facts: [],
			done: false,
			issues: [{ code: "committed-fact-journal.append-log.invalid-fact-cursor" }],
		});
		expect(() =>
			appendLogCommittedFactJournal({
				log,
				profile: workProfile,
				capabilities: [
					{
						kind: "committed-fact-journal-backend-capability",
						name: "whole-batch-visibility",
						supported: false,
					},
				],
			}),
		).toThrow(/reserved/);
		expect(() => committedFactJournalCursor("\ud800", 0)).toThrow(/unpaired/);
	});

	it("emits byte-identical canonical results for identical frozen inputs", async () => {
		const run = async () => {
			const journal = appendLogCommittedFactJournal({
				log: memoryAppendLog<WorkFactBatch>("deterministic-work-facts"),
				profile: workProfile,
				backendName: "deterministic-memory",
			});
			const committed = await journal.append(batch([fact("work:deterministic", "material:v1")]));
			const read = await journal.read();
			return strictCanonicalJsonBytes({ committed, read });
		};

		expect(await run()).toEqual(await run());
	});

	it("reopens a non-memory domain stream through a fresh file-backed journal handle", async () => {
		await withTempDir("graphrefly-committed-facts-d641", async (dir) => {
			const open = () =>
				appendLogCommittedFactJournal({
					log: fileAppendLog<WorkFactBatch>(dir, {
						prefix: "work-facts",
						codec: strictJsonCodecFor<WorkFactBatch>(),
					}),
					profile: workProfile,
					backendName: "work-file",
				});
			const stored = fact("work:file", "persisted across handles");

			const committed = await open().append(batch([stored]));
			const reopened = await open().read();

			expect(committed.status).toBe("committed");
			expect(reopened).toMatchObject({
				facts: [stored],
				done: true,
				cursor: {
					kind: "committed-fact-journal.cursor",
					stream: "work-facts",
					position: 1,
				},
			});
		});
	});
});

describe("D641 explicit selected Graph DATA persistence", () => {
	it("requires an explicit projection and validates the complete durable frame", async () => {
		const g = graph();
		const selected = g.state(0, { name: "selected-frame" });
		const log = memoryAppendLog<ObserveEventFrame<number>>("selected-invalid-frame");

		expect(() =>
			attachObserveEventLog(g, log, { path: "selected-frame" } as unknown as Parameters<
				typeof attachObserveEventLog
			>[2]),
		).toThrow(/explicit DATA projection/);

		const errors: unknown[] = [];
		const handle = attachObserveEventLog(g, log, {
			path: "selected-frame",
			stream: "\ud800",
			map: (event) => (event.msg[0] === "DATA" ? (event.msg[1] as number) : undefined),
			onError(error) {
				errors.push(error);
			},
		});
		selected.set(1);
		await done((complete) => handle.flush(complete));

		expect(await log.size()).toBe(0);
		expect(errors.length).toBeGreaterThan(0);
		expect(String(errors[0])).toContain("unpaired");
		await done((complete) => handle.dispose(complete));
	});

	it("persists only selected strict DATA and routes rejected material as bounded map failure", async () => {
		const g = graph();
		const selected = g.state(0, { name: "selected" });
		const ignored = g.state(0, { name: "ignored" });
		const log: AppendLogStorageTier<ObserveEventFrame<{ readonly value: number }>> =
			memoryAppendLog("selected-observe");
		const errors: Array<{ readonly error: unknown; readonly phase: string }> = [];
		const handle = attachObserveEventLog<{ readonly value: number }>(g, log, {
			path: "selected",
			stream: "selected-data.v1",
			map(event: ObserveEvent) {
				if (event.msg[0] !== "DATA") return undefined;
				const value = event.msg[1] as number;
				if (value === 2) {
					return { value: 2, invalid: 1n } as unknown as { readonly value: number };
				}
				return { value };
			},
			onError(error, context) {
				errors.push({ error, phase: context.phase });
			},
		});

		ignored.set(1);
		selected.set(1);
		selected.set(2);
		selected.set(3);
		await done((complete) => handle.flush(complete));

		const frames = (await log.read()).map((entry) => entry.value);
		expect(frames.map((frame) => frame.change)).toEqual([{ value: 0 }, { value: 1 }, { value: 3 }]);
		expect(frames.map((frame) => frame.path)).toEqual(["selected", "selected", "selected"]);
		expect(frames.every((frame) => frame.stream === "selected-data.v1")).toBe(true);
		expect(errors).toHaveLength(1);
		expect(errors[0]?.phase).toBe("map");
		expect(String(errors[0]?.error)).toContain("not JSON-encodable");
		const codec = observeEventFrameCodec<{ readonly value: number }>();
		const encoded = codec.encode(frames[0] as ObserveEventFrame<{ readonly value: number }>);
		expect(codec.encode(frames[0] as ObserveEventFrame<{ readonly value: number }>)).toEqual(
			encoded,
		);
		expect(codec.decode(encoded)).toEqual(frames[0]);

		await done((complete) => handle.dispose(complete));
	});
});

function done(register: (complete: () => void) => void): Promise<void> {
	return new Promise((resolve) => register(resolve));
}

async function withTempDir<T>(label: string, run: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), `${label}-`));
	try {
		return await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
