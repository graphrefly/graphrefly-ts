import { describe, expect, expectTypeOf, it } from "vitest";
import { graph } from "../graph/graph.js";
import type {
	MemoryAnswer,
	MemoryFragment,
	MemoryRetrievalError,
	MemoryRetrievalStatus,
} from "../patterns/index.js";
import type { Message } from "../protocol/messages.js";
import {
	type AgenticMemoryBundle,
	type AgenticMemoryConsolidationCommand,
	type AgenticMemoryConsolidationError,
	type AgenticMemoryConsolidationOutcome,
	type AgenticMemoryConsolidationRequest,
	type AgenticMemoryConsolidationStatus,
	type AgenticMemoryContext,
	type AgenticMemoryContextPackingError,
	type AgenticMemoryContextPackingPolicy,
	type AgenticMemoryContextPackingStatus,
	type AgenticMemoryContextText,
	type AgenticMemoryError,
	type AgenticMemoryKgAssertionDraft,
	type AgenticMemoryKgProjectionError,
	type AgenticMemoryKgProjectionStatus,
	type AgenticMemoryPackedContext,
	type AgenticMemoryRecord,
	type AgenticMemoryRecordFrame,
	type AgenticMemoryRetentionCommand,
	type AgenticMemoryRetentionError,
	type AgenticMemoryRetentionStatus,
	type AgenticMemorySourceProjection,
	type AgenticMemoryStatus,
	agenticMemoryBundle,
	agenticMemoryConsolidationBundle,
	agenticMemoryContextPackingBundle,
	agenticMemoryKgProjectionBundle,
	agenticMemoryRecordCodec,
	agenticMemoryRecordFrame,
	agenticMemoryRecordFrameCodec,
	agenticMemoryRetentionBundle,
} from "../solutions/index.js";

const fragment = <T = string>(patch: Partial<MemoryFragment<T>> = {}): MemoryFragment<T> => ({
	id: "fact-1",
	payload: "payload" as T,
	tNs: 10n,
	confidence: 0.8,
	tags: ["project", "policy"],
	sources: [],
	...patch,
});

const record = <T = string>(
	patch: Partial<AgenticMemoryRecord<T>> = {},
): AgenticMemoryRecord<T> => ({
	id: "record-1",
	kind: "semantic",
	persistenceLevel: "project",
	artifactKind: "insight",
	scope: { sessionId: "session-1", projectId: "project-1" },
	fragment: fragment<T>(),
	...patch,
});

const data = <T>(messages: Message[]): T[] =>
	messages.filter((m) => m[0] === "DATA").map((m) => (m as readonly ["DATA", T])[1]);

function collect(node: { subscribe(sink: (messages: Message) => void): () => void }) {
	const messages: Message[] = [];
	const unsubscribe = node.subscribe((message) => messages.push(message));
	return { messages, unsubscribe };
}

describe("agenticMemoryBundle solution (D164)", () => {
	it("exposes static records -> projection -> retrieval -> context topology", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const query = g.state({ tags: ["policy"] }, { name: "query" });
		const bundle = agenticMemoryBundle<string>(g, { name: "memory", records, query });

		expectTypeOf(bundle).toMatchTypeOf<AgenticMemoryBundle<string>>();
		expect(bundle.input.records).toBe(records);
		expect(bundle.input.query).toBe(query);
		expect(bundle.retrieval.snapshot).toBe(bundle.retrievalSnapshot);
		expect(bundle.retrieval.errors).toBe(bundle.retrievalErrors);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "records", to: "memory/projection" },
				{ from: "memory/projection", to: "memory/records" },
				{ from: "memory/projection", to: "memory/fragments" },
				{ from: "memory/projection", to: "memory/status" },
				{ from: "memory/projection", to: "memory/errors" },
				{ from: "memory/projection", to: "memory/sources" },
				{ from: "memory/fragments", to: "memory/retrieval/snapshot" },
				{ from: "query", to: "memory/retrieval/snapshot" },
				{ from: "memory/retrieval/snapshot", to: "memory/retrieval/fragments" },
				{ from: "memory/retrieval/snapshot", to: "memory/retrieval/indexed" },
				{ from: "memory/retrieval/snapshot", to: "memory/retrieval/ranked" },
				{ from: "memory/retrieval/snapshot", to: "memory/retrieval/status" },
				{ from: "memory/retrieval/snapshot", to: "memory/retrieval/errors" },
				{ from: "memory/retrieval/snapshot", to: "memory/retrieval/cursor" },
				{ from: "memory/projection", to: "memory/context" },
				{ from: "memory/retrieval/snapshot", to: "memory/context" },
			]),
		);
		expect(g.describe().nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "memory/projection",
					factory: "agenticMemoryProjection",
				}),
				expect.objectContaining({ id: "memory/fragments", factory: "agenticMemoryFragments" }),
				expect.objectContaining({
					id: "memory/retrieval/snapshot",
					factory: "memoryRetrievalSnapshot",
				}),
				expect.objectContaining({ id: "memory/context", factory: "agenticMemoryContext" }),
			]),
		);
	});

	it("validates records, projects valid fragments, and includes record metadata in context", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({
					id: "record-far",
					kind: "episodic",
					persistenceLevel: "session",
					artifactKind: "raw",
					scope: { sessionId: "session-1", tenantId: "tenant-1" },
					fragment: fragment({
						id: "far",
						payload: "distant",
						confidence: 0.95,
						embedding: [0, 1],
						tags: ["policy"],
						sources: ["seed"],
						provenance: "fixture",
					}),
				}),
				record({
					id: "record-near",
					kind: "procedural",
					persistenceLevel: "longTerm",
					artifactKind: "procedure",
					scope: { projectId: "project-1", userId: "user-1" },
					fragment: fragment({
						id: "near",
						payload: "close",
						confidence: 0.6,
						embedding: [1, 0],
						tags: ["policy"],
						sources: ["seed", "note"],
						parentFragmentId: "seed",
					}),
				}),
			],
			{ name: "records" },
		);
		const query = g.state({ tags: ["policy"], vector: [1, 0], limit: 2 }, { name: "query" });
		const bundle = agenticMemoryBundle<string>(g, { name: "memory", records, query });
		const projected = collect(bundle.fragments);
		const context = collect(bundle.context);
		const sources = collect(bundle.sources);
		const status = collect(bundle.status);
		context.messages.length = 0;

		query.set({ tags: ["policy"], vector: [1, 0], limit: 2 });

		expect(
			data<readonly MemoryFragment<string>[]>(projected.messages)
				.at(-1)
				?.map((item) => item.id),
		).toEqual(["far", "near"]);
		expect(data<AgenticMemoryStatus>(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: { validRecords: 2, invalidRecords: 0, projectedFragments: 2 },
		});
		expect(
			data<AgenticMemoryContext<string>>(context.messages)
				.at(-1)
				?.entries.map((entry) => ({
					fragmentId: entry.fragmentId,
					recordId: entry.record?.recordId,
					kind: entry.record?.kind,
					persistenceLevel: entry.record?.persistenceLevel,
					artifactKind: entry.record?.artifactKind,
					scope: entry.record?.scope,
				})),
		).toEqual([
			{
				fragmentId: "near",
				recordId: "record-near",
				kind: "procedural",
				persistenceLevel: "longTerm",
				artifactKind: "procedure",
				scope: { projectId: "project-1", userId: "user-1" },
			},
			{
				fragmentId: "far",
				recordId: "record-far",
				kind: "episodic",
				persistenceLevel: "session",
				artifactKind: "raw",
				scope: { sessionId: "session-1", tenantId: "tenant-1" },
			},
		]);
		expect(data<AgenticMemorySourceProjection[]>(sources.messages).at(-1)).toEqual([
			{
				fragmentId: "far",
				record: {
					recordId: "record-far",
					kind: "episodic",
					persistenceLevel: "session",
					artifactKind: "raw",
					scope: { sessionId: "session-1", tenantId: "tenant-1" },
				},
				sources: ["seed"],
				provenance: "fixture",
			},
			{
				fragmentId: "near",
				record: {
					recordId: "record-near",
					kind: "procedural",
					persistenceLevel: "longTerm",
					artifactKind: "procedure",
					scope: { projectId: "project-1", userId: "user-1" },
				},
				sources: ["seed", "note"],
				parentFragmentId: "seed",
			},
		]);
		expect(data<AgenticMemoryContext<string>>(context.messages).at(-1)).toMatchObject({
			state: "ready",
			contextReady: true,
			errors: [],
			retrievalErrors: [],
		});
	});

	it("emits invalid enum, scope, and fragment records as solution-level DATA errors", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const query = g.state({}, { name: "query" });
		const bundle = agenticMemoryBundle<string>(g, { name: "memory", records, query });
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);
		const context = collect(bundle.context);
		errors.messages.length = 0;
		status.messages.length = 0;
		context.messages.length = 0;

		records.set([
			{
				id: "bad-record",
				kind: "archive",
				persistenceLevel: "cold",
				artifactKind: "summary",
				scope: { sessionId: "", storageKey: "nope" },
				fragment: { id: "", tNs: 1, confidence: Number.NaN, tags: [], sources: [] },
				scheduler: "nope",
			} as never,
		]);

		expect(errors.messages.map((message) => message[0])).toEqual(["DIRTY", "DATA"]);
		expect(
			data<readonly AgenticMemoryError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual([
			"invalid-record-kind",
			"invalid-persistence-level",
			"invalid-artifact-kind",
			"invalid-scope",
			"invalid-fragment",
			"invalid-record",
		]);
		expect(data<AgenticMemoryStatus>(status.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { validRecords: 0, invalidRecords: 1, projectedFragments: 0 },
		});
		expect(data<AgenticMemoryContext<string>>(context.messages).at(-1)).toMatchObject({
			state: "error",
			contextReady: false,
			entries: [],
		});
		expect(status.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("does not let invalid records reserve ids and reports duplicate valid record ids", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const query = g.state({}, { name: "query" });
		const bundle = agenticMemoryBundle<string>(g, { name: "memory", records, query });
		const errors = collect(bundle.errors);
		const projected = collect(bundle.fragments);
		const context = collect(bundle.context);
		errors.messages.length = 0;
		projected.messages.length = 0;
		context.messages.length = 0;

		records.set([
			record({ id: "dup", kind: "archive" as never }),
			record({ id: "dup", fragment: fragment({ id: "kept", payload: "kept" }) }),
			record({ id: "dup", fragment: fragment({ id: "dropped", payload: "dropped" }) }),
		]);

		expect(
			data<readonly AgenticMemoryError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["invalid-record-kind", "duplicate-record-id"]);
		expect(data<readonly AgenticMemoryError[]>(errors.messages).at(-1)?.[1]).toMatchObject({
			code: "duplicate-record-id",
			index: 2,
			recordId: "dup",
		});
		expect(
			data<readonly MemoryFragment<string>[]>(projected.messages)
				.at(-1)
				?.map((item) => item.id),
		).toEqual(["kept"]);
		expect(
			data<AgenticMemoryContext<string>>(context.messages)
				.at(-1)
				?.entries.map((entry) => [entry.fragmentId, entry.payload, entry.record?.recordId]),
		).toEqual([["kept", "kept", "dup"]]);
	});

	it("rejects duplicate projected fragment ids before source metadata can drift", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([], { name: "records" });
		const query = g.state({}, { name: "query" });
		const bundle = agenticMemoryBundle<string>(g, { name: "memory", records, query });
		const errors = collect(bundle.errors);
		const projected = collect(bundle.fragments);
		const sources = collect(bundle.sources);
		errors.messages.length = 0;
		projected.messages.length = 0;
		sources.messages.length = 0;

		records.set([
			record({ id: "record-a", fragment: fragment({ id: "same", payload: "a" }) }),
			record({ id: "record-b", fragment: fragment({ id: "same", payload: "b" }) }),
		]);

		expect(data<readonly AgenticMemoryError[]>(errors.messages).at(-1)?.[0]).toMatchObject({
			code: "duplicate-fragment-id",
			index: 1,
			recordId: "record-b",
			fragmentId: "same",
		});
		expect(
			data<readonly MemoryFragment<string>[]>(projected.messages)
				.at(-1)
				?.map((item) => [item.id, item.payload]),
		).toEqual([["same", "a"]]);
		expect(data<AgenticMemorySourceProjection[]>(sources.messages).at(-1)).toMatchObject([
			{ fragmentId: "same", record: { recordId: "record-a" } },
		]);
	});

	it("turns throwing record access into solution-level DATA errors", () => {
		const g = graph();
		const badRecord = {
			get id() {
				throw new Error("id exploded");
			},
		};
		const records = g.state<readonly AgenticMemoryRecord<string>[]>([badRecord as never], {
			name: "records",
		});
		const query = g.state({}, { name: "query" });
		const bundle = agenticMemoryBundle<string>(g, { name: "memory", records, query });
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);

		expect(data<readonly AgenticMemoryError[]>(errors.messages).at(-1)?.[0]).toMatchObject({
			code: "invalid-record",
			index: 0,
			validationErrors: ["record access failed"],
		});
		expect(data<AgenticMemoryStatus>(status.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { validRecords: 0, invalidRecords: 1, projectedFragments: 0 },
		});
		expect(status.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("forwards invalid query vectors to the lower retrieval error surface", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-ok", fragment: fragment({ id: "ok", embedding: [1, 0] }) })],
			{ name: "records" },
		);
		const query = g.state({}, { name: "query" });
		const bundle = agenticMemoryBundle<string>(g, { name: "memory", records, query });
		const solutionErrors = collect(bundle.errors);
		const retrievalErrors = collect(bundle.retrievalErrors);
		const retrievalStatus = collect(bundle.retrievalStatus);
		const context = collect(bundle.context);
		retrievalErrors.messages.length = 0;
		retrievalStatus.messages.length = 0;
		context.messages.length = 0;

		query.set({ vector: [1, Number.NaN] });

		expect(data<readonly AgenticMemoryError[]>(solutionErrors.messages).at(-1)).toEqual([]);
		expect(
			data<readonly MemoryRetrievalError[]>(retrievalErrors.messages).at(-1)?.[0],
		).toMatchObject({ code: "invalid-query-vector" });
		expect(data<MemoryRetrievalStatus>(retrievalStatus.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { validFragments: 1, invalidFragments: 0, resultCount: 0 },
		});
		expect(data<AgenticMemoryContext<string>>(context.messages).at(-1)).toMatchObject({
			state: "error",
			contextReady: false,
			entries: [],
			errors: [],
			retrievalErrors: [expect.objectContaining({ code: "invalid-query-vector" })],
		});
	});
});

describe("agentic memory KG projection (D165)", () => {
	it("projects valid KG assertions with record metadata and visible topology", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({
					id: "record-kg",
					kind: "semantic",
					persistenceLevel: "longTerm",
					fragment: fragment({
						id: "fragment-kg",
						payload: "Ada works on GraphReFly",
						sources: ["note-1"],
					}),
				}),
			],
			{ name: "records" },
		);
		const drafts = g.state<readonly AgenticMemoryKgAssertionDraft[]>(
			[
				{
					id: "assertion-1",
					recordId: "record-kg",
					fragmentId: "fragment-kg",
					subject: { id: "person:ada", type: "person" },
					predicate: "works_on",
					object: { kind: "entity", id: "project:graphrefly", type: "project" },
					confidence: 0.9,
					sources: ["fragment-kg", "note-1"],
					provenance: "fixture",
				},
			],
			{ name: "drafts" },
		);
		const bundle = agenticMemoryKgProjectionBundle(g, { name: "kg", records, drafts });
		const assertions = collect(bundle.assertions);
		const status = collect(bundle.status);
		const errors = collect(bundle.errors);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "records", to: "kg/projection" },
				{ from: "drafts", to: "kg/projection" },
				{ from: "kg/projection", to: "kg/assertions" },
				{ from: "kg/projection", to: "kg/status" },
				{ from: "kg/projection", to: "kg/errors" },
				{ from: "kg/projection", to: "kg/cursor" },
			]),
		);
		expect(g.describe().nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "kg/projection", factory: "agenticMemoryKgProjection" }),
			]),
		);
		expect(data<readonly AgenticMemoryKgProjectionError[]>(errors.messages).at(-1)).toEqual([]);
		expect(data<AgenticMemoryKgProjectionStatus>(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: { validRecords: 1, validDrafts: 1, projectedAssertions: 1 },
		});
		expect(data(assertions.messages).at(-1)).toEqual([
			{
				id: "assertion-1",
				recordId: "record-kg",
				fragmentId: "fragment-kg",
				subject: { id: "person:ada", type: "person" },
				predicate: "works_on",
				object: { kind: "entity", id: "project:graphrefly", type: "project" },
				confidence: 0.9,
				sources: ["fragment-kg", "note-1"],
				provenance: "fixture",
				record: {
					recordId: "record-kg",
					kind: "semantic",
					persistenceLevel: "longTerm",
					artifactKind: "insight",
					scope: { sessionId: "session-1", projectId: "project-1" },
				},
			},
		]);
	});

	it("emits invalid refs, fragment mismatches, duplicate assertion ids, and shape errors as DATA", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({ id: "record-a", fragment: fragment({ id: "fragment-a" }) }),
				record({ id: "record-b", fragment: fragment({ id: "fragment-b" }) }),
			],
			{ name: "records" },
		);
		const drafts = g.state<readonly AgenticMemoryKgAssertionDraft[]>(
			[
				{
					id: "assertion-ok",
					recordId: "record-a",
					fragmentId: "fragment-a",
					subject: { id: "s" },
					predicate: "p",
					object: { kind: "value", value: "ok" },
				},
				{
					id: "assertion-ok",
					recordId: "record-b",
					fragmentId: "fragment-b",
					subject: { id: "s" },
					predicate: "p",
					object: { kind: "value", value: "dupe" },
				},
				{
					id: "missing-record",
					recordId: "missing",
					fragmentId: "fragment-a",
					subject: { id: "s" },
					predicate: "p",
					object: { kind: "value", value: 1 },
				},
				{
					id: "missing-fragment",
					recordId: "record-a",
					fragmentId: "missing-fragment",
					subject: { id: "s" },
					predicate: "p",
					object: { kind: "value", value: true },
				},
				{
					id: "mismatch",
					recordId: "record-a",
					fragmentId: "fragment-b",
					subject: { id: "s" },
					predicate: "p",
					object: { kind: "entity", id: "entity-b" },
				},
				{
					id: "bad-shape",
					recordId: "record-a",
					fragmentId: "fragment-a",
					subject: { id: "" },
					predicate: "",
					object: { kind: "value", value: 1n },
				} as never,
			],
			{ name: "drafts" },
		);
		const bundle = agenticMemoryKgProjectionBundle(g, { name: "kg", records, drafts });
		const assertions = collect(bundle.assertions);
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);

		expect(
			data<readonly AgenticMemoryKgProjectionError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual([
			"duplicate-assertion-id",
			"missing-record-ref",
			"missing-fragment-ref",
			"fragment-record-mismatch",
			"invalid-assertion-shape",
		]);
		expect(
			data<readonly unknown[]>(assertions.messages)
				.at(-1)
				?.map((item) => (item as { id: string }).id),
		).toEqual(["assertion-ok"]);
		expect(data<AgenticMemoryKgProjectionStatus>(status.messages).at(-1)).toMatchObject({
			state: "partial",
			cursor: { validDrafts: 1, invalidDrafts: 5, projectedAssertions: 1 },
		});
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});
});

describe("agentic memory record codec (D166)", () => {
	it("roundtrips strict JSON record frames and bigint fields", () => {
		const codec = agenticMemoryRecordCodec();
		const original = record({
			id: "record-codec",
			kind: "episodic",
			persistenceLevel: "permanent",
			artifactKind: "raw",
			scope: { tenantId: "tenant-1" },
			fragment: fragment({
				id: "fragment-codec",
				payload: { text: "hello", nested: [1, true, null] },
				tNs: 12345678901234567890n,
				validFrom: 10000000000000000000n,
				validTo: 20000000000000000000n,
			}),
		});
		const decoded = codec.decode(codec.encode(original));

		expect(decoded.fragment.tNs).toBe(12345678901234567890n);
		expect(decoded.fragment.validFrom).toBe(10000000000000000000n);
		expect(decoded.fragment.validTo).toBe(20000000000000000000n);
		expect(decoded).toEqual(original);
	});

	it("fails honestly for unknown fields, corrupt bytes, invalid enums, and non-strict payloads", () => {
		const frame = agenticMemoryRecordFrame(record({ fragment: fragment({ payload: "ok" }) }));
		const frameCodec = agenticMemoryRecordFrameCodec();
		const recordCodec = agenticMemoryRecordCodec();

		expect(() => frameCodec.encode({ ...frame, storageTier: "cold" } as never)).toThrow(
			/unexpected fields/,
		);
		expect(() => frameCodec.decode(new TextEncoder().encode("{"))).toThrow();
		expect(() =>
			frameCodec.encode({
				...frame,
				record: { ...frame.record, kind: "archive" },
			} as unknown as AgenticMemoryRecordFrame),
		).toThrow(/invalid memory kind/);
		expect(() =>
			frameCodec.encode({
				...frame,
				record: {
					...frame.record,
					fragment: { ...frame.record.fragment, tNs: "-0" },
				},
			} as unknown as AgenticMemoryRecordFrame),
		).toThrow(/canonical decimal bigint string/);
		const tags = ["project"] as string[] & { extra?: string };
		tags.extra = "unknown";
		expect(() =>
			recordCodec.encode(
				record({
					fragment: fragment({ tags }),
				}),
			),
		).toThrow(/strict JSON/);
		const scopeWithSymbol = { tenantId: "tenant-1" } as AgenticMemoryRecord["scope"] & {
			readonly [key: symbol]: string;
		};
		Object.defineProperty(scopeWithSymbol, Symbol("hidden"), {
			value: "unknown",
			enumerable: true,
		});
		expect(() =>
			recordCodec.encode(
				record({
					scope: scopeWithSymbol,
				}),
			),
		).toThrow(/strict JSON|symbol/);
		expect(() =>
			recordCodec.encode(
				record({
					fragment: fragment({ payload: { impossible: undefined } as never }),
				}),
			),
		).toThrow(/strict JSON/);
	});
});

describe("agentic memory retention bundle (D167)", () => {
	it("projects archive, restore, setPersistenceLevel, and consolidation requests", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({ id: "record-a", persistenceLevel: "project", fragment: fragment({ id: "a" }) }),
				record({ id: "record-b", persistenceLevel: "archived", fragment: fragment({ id: "b" }) }),
			],
			{ name: "records" },
		);
		const commands = g.state<readonly AgenticMemoryRetentionCommand[]>(
			[
				{ id: "cmd-archive", kind: "archive", recordId: "record-a", reason: "done" },
				{
					id: "cmd-restore",
					kind: "restore",
					recordId: "record-b",
					persistenceLevel: "longTerm",
				},
				{
					id: "cmd-set",
					kind: "setPersistenceLevel",
					recordId: "record-b",
					persistenceLevel: "permanent",
				},
				{
					id: "cmd-consolidate",
					kind: "requestConsolidation",
					recordIds: ["record-a", "record-b"],
					requestId: "consolidate-1",
					reason: "merge",
				},
			],
			{ name: "commands" },
		);
		const bundle = agenticMemoryRetentionBundle(g, { name: "retention", records, commands });
		const active = collect(bundle.activeRecords);
		const archived = collect(bundle.archivedRecords);
		const requests = collect(bundle.consolidationRequests);
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "records", to: "retention/projection" },
				{ from: "commands", to: "retention/projection" },
				{ from: "retention/projection", to: "retention/activeRecords" },
				{ from: "retention/projection", to: "retention/archivedRecords" },
				{ from: "retention/projection", to: "retention/consolidationRequests" },
				{ from: "retention/projection", to: "retention/status" },
				{ from: "retention/projection", to: "retention/errors" },
				{ from: "retention/projection", to: "retention/cursor" },
			]),
		);
		expect(data<readonly AgenticMemoryRetentionError[]>(errors.messages).at(-1)).toEqual([]);
		expect(
			data<readonly AgenticMemoryRecord<string>[]>(active.messages)
				.at(-1)
				?.map((item) => [item.id, item.persistenceLevel]),
		).toEqual([["record-b", "permanent"]]);
		expect(
			data<readonly AgenticMemoryRecord<string>[]>(archived.messages)
				.at(-1)
				?.map((item) => [item.id, item.persistenceLevel]),
		).toEqual([["record-a", "archived"]]);
		expect(data<readonly AgenticMemoryConsolidationRequest[]>(requests.messages).at(-1)).toEqual([
			{
				id: "consolidate-1",
				commandId: "cmd-consolidate",
				recordIds: ["record-a", "record-b"],
				reason: "merge",
			},
		]);
		expect(data<AgenticMemoryRetentionStatus>(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: { validCommands: 4, invalidCommands: 0, consolidationRequests: 1 },
		});
	});

	it("emits invalid retention commands as DATA errors", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-a", fragment: fragment({ id: "a" }) })],
			{ name: "records" },
		);
		const commands = g.state<readonly AgenticMemoryRetentionCommand[]>(
			[
				{ id: "cmd-a", kind: "archive", recordId: "record-a" },
				{ id: "cmd-a", kind: "restore", recordId: "record-a" },
				{ id: "cmd-missing", kind: "archive", recordId: "missing" },
				{ id: "cmd-retry", kind: "archive", recordId: "missing" },
				{
					id: "cmd-retry",
					kind: "setPersistenceLevel",
					recordId: "record-a",
					persistenceLevel: "project",
				},
				{
					id: "cmd-bad",
					kind: "setPersistenceLevel",
					recordId: "record-a",
					persistenceLevel: "cold",
				},
				{ id: "cmd-empty", kind: "requestConsolidation", recordIds: [] },
			] as never,
			{ name: "commands" },
		);
		const bundle = agenticMemoryRetentionBundle(g, { name: "retention", records, commands });
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);

		expect(
			data<readonly AgenticMemoryRetentionError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual([
			"duplicate-command-id",
			"missing-record-ref",
			"missing-record-ref",
			"invalid-command",
			"invalid-command",
		]);
		expect(data<AgenticMemoryRetentionStatus>(status.messages).at(-1)).toMatchObject({
			state: "partial",
			cursor: { validCommands: 2, invalidCommands: 5 },
		});
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});
});

describe("agentic memory consolidation bundle (D171)", () => {
	it("projects external consolidation outcomes into result, draft, and command DATA facts", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({ id: "record-a", fragment: fragment({ id: "a" }) }),
				record({ id: "record-b", fragment: fragment({ id: "b" }) }),
			],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[
				{
					id: "request-1",
					commandId: "cmd-1",
					recordIds: ["record-a", "record-b"],
					reason: "merge",
				},
			],
			{ name: "requests" },
		);
		const outcomes = g.state<readonly AgenticMemoryConsolidationOutcome<string>[]>(
			[
				{
					id: "outcome-1",
					requestId: "request-1",
					kind: "proposedRecords",
					records: [
						record({
							id: "record-merged",
							artifactKind: "insight",
							fragment: fragment({ id: "merged", payload: "merged insight" }),
						}),
					],
					provenance: "external-executor",
				},
			],
			{ name: "outcomes" },
		);
		const bundle = agenticMemoryConsolidationBundle(g, {
			name: "consolidation",
			records,
			requests,
			outcomes,
		});
		const drafts = collect(bundle.proposedRecordDrafts);
		const commands = collect(bundle.commands);
		const status = collect(bundle.status);
		const errors = collect(bundle.errors);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "records", to: "consolidation/projection" },
				{ from: "requests", to: "consolidation/projection" },
				{ from: "outcomes", to: "consolidation/projection" },
				{ from: "consolidation/projection", to: "consolidation/results" },
				{ from: "consolidation/projection", to: "consolidation/proposedRecordDrafts" },
				{ from: "consolidation/projection", to: "consolidation/commands" },
			]),
		);
		expect(data(errors.messages).at(-1)).toEqual([]);
		expect(data(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: { validOutcomes: 1, invalidOutcomes: 0, proposedRecordDrafts: 1 },
		});
		expect(data(drafts.messages).at(-1)).toEqual([
			expect.objectContaining({
				id: "request-1:outcome-1:record-merged",
				requestId: "request-1",
				outcomeId: "outcome-1",
				record: expect.objectContaining({ id: "record-merged" }),
			}),
		]);
		expect(data<readonly AgenticMemoryConsolidationCommand[]>(commands.messages).at(-1)).toEqual([
			{
				id: "request-1:outcome-1:proposeRecords",
				kind: "proposeRecords",
				requestId: "request-1",
				outcomeId: "outcome-1",
				draftIds: ["request-1:outcome-1:record-merged"],
			},
		]);
	});

	it("keeps invalid consolidation outcomes on the DATA error path", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[record({ id: "record-a", fragment: fragment({ id: "a" }) })],
			{ name: "records" },
		);
		const requests = g.state<readonly AgenticMemoryConsolidationRequest[]>(
			[{ id: "request-1", commandId: "cmd-1", recordIds: ["record-a"] }],
			{ name: "requests" },
		);
		const outcomes = g.state(
			[
				{ id: "missing", requestId: "missing-request", kind: "failed", message: "nope" },
				{
					id: "bad-record",
					requestId: "request-1",
					kind: "proposedRecords",
					records: [record({ id: "", fragment: fragment({ id: "" }) })],
				},
			] as never,
			{ name: "outcomes" },
		);
		const bundle = agenticMemoryConsolidationBundle(g, {
			name: "consolidation",
			records,
			requests,
			outcomes,
		});
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);

		expect(
			data<readonly AgenticMemoryConsolidationError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["missing-request-ref", "invalid-proposed-record"]);
		expect(data<AgenticMemoryConsolidationStatus>(status.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { validOutcomes: 0, invalidOutcomes: 2 },
		});
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});
});

describe("agentic memory context packing (D168)", () => {
	const contextFact = (): AgenticMemoryContext<string> => ({
		state: "ready",
		query: {},
		entries: [
			{
				fragmentId: "f1",
				payload: "one",
				confidence: 0.9,
				tags: ["a"],
				sources: [],
				record: {
					recordId: "r1",
					kind: "semantic",
					persistenceLevel: "project",
					artifactKind: "insight",
				},
				fragment: fragment({ id: "f1", payload: "one" }),
			},
			{
				fragmentId: "f2",
				payload: "two",
				confidence: 0.8,
				tags: ["a"],
				sources: [],
				fragment: fragment({ id: "f2", payload: "two" }),
			},
			{
				fragmentId: "f3",
				payload: "three",
				confidence: 0.7,
				tags: ["a"],
				sources: [],
				fragment: fragment({ id: "f3", payload: "three" }),
			},
		],
		cursor: { evaluation: 1, validFragments: 3, invalidFragments: 0, resultCount: 3 },
		errors: [],
		retrievalErrors: [],
		contextReady: true,
	});

	it("packs explicit text in context order with maxEntries/maxChars/maxCost and metadata inclusion", () => {
		const g = graph();
		const context = g.state(contextFact(), { name: "context" });
		const texts = g.state<readonly AgenticMemoryContextText[]>(
			[
				{ fragmentId: "f1", text: "aaa", cost: 1, metadata: { role: "evidence" } },
				{ fragmentId: "f2", text: "bbbb", cost: 3, metadata: { role: "procedure" } },
			],
			{ name: "texts" },
		);
		const policy = g.state<AgenticMemoryContextPackingPolicy>(
			{ maxEntries: 2, maxChars: 9, maxCost: 4, includeMetadata: true },
			{ name: "policy" },
		);
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const packed = collect(bundle.packedContext);
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "context", to: "packing/projection" },
				{ from: "texts", to: "packing/projection" },
				{ from: "policy", to: "packing/projection" },
				{ from: "packing/projection", to: "packing/packedContext" },
				{ from: "packing/projection", to: "packing/status" },
				{ from: "packing/projection", to: "packing/errors" },
				{ from: "packing/projection", to: "packing/cursor" },
			]),
		);
		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)).toMatchObject({
			text: "aaa\n\nbbbb",
			totalChars: 9,
			totalCost: 4,
			truncated: true,
			entries: [
				{ fragmentId: "f1", metadata: { role: "evidence" }, record: { recordId: "r1" } },
				{ fragmentId: "f2", metadata: { role: "procedure" } },
			],
		});
		expect(data<readonly AgenticMemoryContextPackingError[]>(errors.messages).at(-1)).toEqual([
			expect.objectContaining({ code: "missing-text", fragmentId: "f3" }),
		]);
		expect(data<AgenticMemoryContextPackingStatus>(status.messages).at(-1)).toMatchObject({
			state: "partial",
			cursor: { packedEntries: 2, omittedEntries: 1, totalChars: 9, totalCost: 4 },
		});

		policy.set({ maxEntries: 1, includeMetadata: true });
		expect(
			data<AgenticMemoryPackedContext>(packed.messages)
				.at(-1)
				?.entries.map((entry) => entry.fragmentId),
		).toEqual(["f1"]);
		policy.set({ maxChars: 6 });
		expect(
			data<AgenticMemoryPackedContext>(packed.messages)
				.at(-1)
				?.entries.map((entry) => entry.fragmentId),
		).toEqual(["f1"]);
		policy.set({ maxCost: 3 });
		expect(
			data<AgenticMemoryPackedContext>(packed.messages)
				.at(-1)
				?.entries.map((entry) => entry.fragmentId),
		).toEqual(["f1"]);
	});

	it("turns malformed context and text metadata into DATA errors", () => {
		const g = graph();
		const context = g.state(
			{
				...contextFact(),
				entries: [null, { fragmentId: "" }, { fragmentId: "f1", record: { recordId: "r1" } }],
			} as never,
			{ name: "context" },
		);
		const texts = g.state<readonly AgenticMemoryContextText[]>(
			[{ fragmentId: "f1", text: "ok", metadata: ["not", "a", "record"] as never }],
			{ name: "texts" },
		);
		const policy = g.state({ includeMetadata: true }, { name: "policy" });
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const packed = collect(bundle.packedContext);
		const errors = collect(bundle.errors);

		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)?.entries).toEqual([]);
		expect(
			data<readonly AgenticMemoryContextPackingError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["invalid-context", "invalid-context", "invalid-context", "invalid-text"]);
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("keeps throwing context and policy getters on the DATA error path", () => {
		const g = graph();
		const hostileContext = { entries: [{ fragmentId: "f1" }] };
		Object.defineProperty(hostileContext, "query", {
			get() {
				throw new Error("query boom");
			},
			enumerable: true,
		});
		const hostilePolicy = {};
		Object.defineProperty(hostilePolicy, "maxChars", {
			get() {
				throw new Error("policy boom");
			},
			enumerable: true,
		});
		const context = g.state(hostileContext as never, { name: "context" });
		const texts = g.state<readonly AgenticMemoryContextText[]>([{ fragmentId: "f1", text: "ok" }], {
			name: "texts",
		});
		const policy = g.state<AgenticMemoryContextPackingPolicy>(hostilePolicy as never, {
			name: "policy",
		});
		const bundle = agenticMemoryContextPackingBundle(g, {
			name: "packing",
			context,
			texts,
			policy,
		});
		const packed = collect(bundle.packedContext);
		const errors = collect(bundle.errors);

		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)?.entries).toEqual([]);
		expect(
			data<readonly AgenticMemoryContextPackingError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["invalid-policy"]);
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);

		policy.set({ includeMetadata: true });
		expect(data<AgenticMemoryPackedContext>(packed.messages).at(-1)?.text).toBe("ok");
	});
});

describe("agentic memory duplicate fragment ownership (D169)", () => {
	it("excludes duplicate fragment records from retrieval, context, metadata, and downstream bundles", () => {
		const g = graph();
		const records = g.state<readonly AgenticMemoryRecord<string>[]>(
			[
				record({ id: "record-a", fragment: fragment({ id: "same", payload: "kept" }) }),
				record({ id: "record-b", fragment: fragment({ id: "same", payload: "dropped" }) }),
			],
			{ name: "records" },
		);
		const query = g.state({}, { name: "query" });
		const memory = agenticMemoryBundle(g, { name: "memory", records, query });
		const drafts = g.state<readonly AgenticMemoryKgAssertionDraft[]>(
			[
				{
					id: "assert-kept",
					recordId: "record-a",
					fragmentId: "same",
					subject: { id: "s" },
					predicate: "p",
					object: { kind: "value", value: "kept" },
				},
				{
					id: "assert-dropped",
					recordId: "record-b",
					fragmentId: "same",
					subject: { id: "s" },
					predicate: "p",
					object: { kind: "value", value: "dropped" },
				},
			],
			{ name: "drafts" },
		);
		const kg = agenticMemoryKgProjectionBundle(g, { name: "kg", records, drafts });
		const commands = g.state<readonly AgenticMemoryRetentionCommand[]>(
			[
				{ id: "archive-dropped", kind: "archive", recordId: "record-b" },
				{ id: "consolidate-dropped", kind: "requestConsolidation", recordIds: ["record-b"] },
			],
			{ name: "commands" },
		);
		const retention = agenticMemoryRetentionBundle(g, { name: "retention", records, commands });
		const projected = collect(memory.fragments);
		const ranked = collect(memory.ranked);
		const context = collect(memory.context);
		const sources = collect(memory.sources);
		const kgAssertions = collect(kg.assertions);
		const kgErrors = collect(kg.errors);
		const active = collect(retention.activeRecords);
		const retentionErrors = collect(retention.errors);

		query.set({});

		expect(
			data<readonly MemoryFragment<string>[]>(projected.messages)
				.at(-1)
				?.map((item) => [item.id, item.payload]),
		).toEqual([["same", "kept"]]);
		expect(
			data<MemoryAnswer<string>>(ranked.messages)
				.at(-1)
				?.results.map((item) => [item.id, item.payload]),
		).toEqual([["same", "kept"]]);
		expect(
			data<AgenticMemoryContext<string>>(context.messages)
				.at(-1)
				?.entries.map((entry) => [entry.fragmentId, entry.payload, entry.record?.recordId]),
		).toEqual([["same", "kept", "record-a"]]);
		expect(data<AgenticMemorySourceProjection[]>(sources.messages).at(-1)).toMatchObject([
			{ fragmentId: "same", record: { recordId: "record-a" } },
		]);
		expect(
			data<readonly unknown[]>(kgAssertions.messages)
				.at(-1)
				?.map((item) => (item as { id: string }).id),
		).toEqual(["assert-kept"]);
		expect(
			data<readonly AgenticMemoryKgProjectionError[]>(kgErrors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["duplicate-fragment-id", "missing-record-ref"]);
		expect(
			data<readonly AgenticMemoryRecord<string>[]>(active.messages)
				.at(-1)
				?.map((item) => item.id),
		).toEqual(["record-a"]);
		expect(
			data<readonly AgenticMemoryRetentionError[]>(retentionErrors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["duplicate-fragment-id", "missing-record-ref", "missing-record-ref"]);
	});
});
