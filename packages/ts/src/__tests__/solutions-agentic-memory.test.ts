import { describe, expect, expectTypeOf, it } from "vitest";
import { graph } from "../graph/graph.js";
import type {
	MemoryFragment,
	MemoryRetrievalError,
	MemoryRetrievalStatus,
} from "../patterns/index.js";
import type { Message } from "../protocol/messages.js";
import {
	type AgenticMemoryBundle,
	type AgenticMemoryContext,
	type AgenticMemoryError,
	type AgenticMemoryRecord,
	type AgenticMemorySourceProjection,
	type AgenticMemoryStatus,
	agenticMemoryBundle,
} from "../solutions/index.js";

const fragment = (patch: Partial<MemoryFragment<string>> = {}): MemoryFragment<string> => ({
	id: "fact-1",
	payload: "payload",
	tNs: 10n,
	confidence: 0.8,
	tags: ["project", "policy"],
	sources: [],
	...patch,
});

const record = (patch: Partial<AgenticMemoryRecord<string>> = {}): AgenticMemoryRecord<string> => ({
	id: "record-1",
	kind: "semantic",
	persistenceLevel: "project",
	artifactKind: "insight",
	scope: { sessionId: "session-1", projectId: "project-1" },
	fragment: fragment(),
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
