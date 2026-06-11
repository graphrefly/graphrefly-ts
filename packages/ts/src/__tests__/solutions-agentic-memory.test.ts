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
	type AgenticMemorySourceProjection,
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

const data = <T>(messages: Message[]): T[] =>
	messages.filter((m) => m[0] === "DATA").map((m) => (m as readonly ["DATA", T])[1]);

function collect(node: { subscribe(sink: (messages: Message) => void): () => void }) {
	const messages: Message[] = [];
	const unsubscribe = node.subscribe((message) => messages.push(message));
	return { messages, unsubscribe };
}

describe("agenticMemoryBundle solution (D125/D158)", () => {
	it("exposes a non-empty solution surface with graph-visible declared deps", () => {
		const g = graph();
		const fragments = g.state<readonly unknown[]>([], { name: "fragments" });
		const query = g.state({ tags: ["policy"] }, { name: "query" });
		const bundle = agenticMemoryBundle<string>(g, { name: "memory", fragments, query });

		expectTypeOf(bundle).toMatchTypeOf<AgenticMemoryBundle<string>>();
		expect(bundle.input.fragments).toBe(fragments);
		expect(bundle.input.query).toBe(query);
		expect(bundle.retrieval.snapshot).toBe(bundle.retrievalSnapshot);

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "fragments", to: "memory/retrieval/snapshot" },
				{ from: "query", to: "memory/retrieval/snapshot" },
				{ from: "memory/retrieval/snapshot", to: "memory/retrieval/fragments" },
				{ from: "memory/retrieval/snapshot", to: "memory/retrieval/indexed" },
				{ from: "memory/retrieval/snapshot", to: "memory/retrieval/ranked" },
				{ from: "memory/retrieval/snapshot", to: "memory/retrieval/status" },
				{ from: "memory/retrieval/snapshot", to: "memory/retrieval/errors" },
				{ from: "memory/retrieval/snapshot", to: "memory/retrieval/cursor" },
				{ from: "memory/retrieval/snapshot", to: "memory/sources" },
				{ from: "memory/retrieval/snapshot", to: "memory/context" },
			]),
		);
		expect(g.describe().nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "memory/retrieval/snapshot",
					factory: "memoryRetrievalSnapshot",
				}),
				expect.objectContaining({ id: "memory/sources", factory: "agenticMemorySources" }),
				expect.objectContaining({ id: "memory/context", factory: "agenticMemoryContext" }),
			]),
		);
	});

	it("flows explicit fragment and query inputs into retrieval, sources, cursor, and context facts", () => {
		const g = graph();
		const fragments = g.state<readonly unknown[]>(
			[
				fragment({
					id: "far",
					payload: "distant",
					confidence: 0.95,
					embedding: [0, 1],
					tags: ["policy"],
					sources: ["seed"],
					provenance: "fixture",
				}),
				fragment({
					id: "near",
					payload: "close",
					confidence: 0.6,
					embedding: [1, 0],
					tags: ["policy"],
					sources: ["seed", "note"],
					parentFragmentId: "seed",
				}),
			],
			{ name: "fragments" },
		);
		const query = g.state({ tags: ["policy"], vector: [1, 0], limit: 2 }, { name: "query" });
		const bundle = agenticMemoryBundle<string>(g, { name: "memory", fragments, query });
		const context = collect(bundle.context);
		const sources = collect(bundle.sources);
		const status = collect(bundle.status);
		const cursor = collect(bundle.cursor);
		context.messages.length = 0;
		sources.messages.length = 0;
		status.messages.length = 0;
		cursor.messages.length = 0;

		query.set({ tags: ["policy"], vector: [1, 0], limit: 2 });

		expect(
			data<AgenticMemoryContext<string>>(context.messages)
				.at(-1)
				?.entries.map((entry) => entry.fragmentId),
		).toEqual(["near", "far"]);
		expect(data<AgenticMemoryContext<string>>(context.messages).at(-1)).toMatchObject({
			state: "ready",
			contextReady: true,
			cursor: { validFragments: 2, invalidFragments: 0, resultCount: 2 },
		});
		expect(data<AgenticMemorySourceProjection[]>(sources.messages).at(-1)).toEqual([
			{ fragmentId: "far", sources: ["seed"], provenance: "fixture" },
			{ fragmentId: "near", sources: ["seed", "note"], parentFragmentId: "seed" },
		]);
		expect(data<MemoryRetrievalStatus>(status.messages).at(-1)?.state).toBe("ready");
		expect(data(cursor.messages).at(-1)).toMatchObject({
			validFragments: 2,
			invalidFragments: 0,
			resultCount: 2,
		});

		fragments.set([fragment({ id: "other", tags: ["other"], payload: "outside" })]);
		expect(data<AgenticMemoryContext<string>>(context.messages).at(-1)).toMatchObject({
			state: "empty",
			contextReady: false,
			entries: [],
		});
	});

	it("surfaces invalid fragments, duplicate ids, and invalid query vectors as DATA facts", () => {
		const g = graph();
		const fragments = g.state<readonly unknown[]>([], { name: "fragments" });
		const query = g.state({}, { name: "query" });
		const bundle = agenticMemoryBundle<string>(g, { name: "memory", fragments, query });
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);
		const context = collect(bundle.context);
		errors.messages.length = 0;
		status.messages.length = 0;
		context.messages.length = 0;

		fragments.set([
			fragment({ id: "dup", payload: "kept" }),
			fragment({ id: "dup", payload: "duplicate" }),
			{ id: "", tNs: 1, confidence: Number.NaN, tags: [], sources: [] },
		]);

		expect(errors.messages.map((message) => message[0])).toEqual(["DIRTY", "DATA"]);
		expect(
			data<readonly MemoryRetrievalError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["duplicate-fragment-id", "invalid-fragment"]);
		expect(data<MemoryRetrievalStatus>(status.messages).at(-1)).toMatchObject({
			state: "partial",
			cursor: { validFragments: 1, invalidFragments: 2, resultCount: 1 },
		});
		expect(data<AgenticMemoryContext<string>>(context.messages).at(-1)).toMatchObject({
			state: "partial",
			contextReady: true,
			entries: [expect.objectContaining({ fragmentId: "dup", payload: "kept" })],
		});
		expect(status.messages.some((message) => message[0] === "ERROR")).toBe(false);

		query.set({ vector: [1, Number.NaN] });
		expect(data<readonly MemoryRetrievalError[]>(errors.messages).at(-1)?.[0]).toMatchObject({
			code: "invalid-query-vector",
		});
		expect(data<MemoryRetrievalStatus>(status.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { validFragments: 1, invalidFragments: 2, resultCount: 0 },
		});
		expect(data<AgenticMemoryContext<string>>(context.messages).at(-1)).toMatchObject({
			state: "error",
			contextReady: false,
			entries: [],
		});
		expect(errors.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("does not mark partial context ready when no ranked entries are available", () => {
		const g = graph();
		const fragments = g.state<readonly unknown[]>(
			[{ id: "", tNs: 1, confidence: Number.NaN, tags: [], sources: [] }],
			{ name: "fragments" },
		);
		const query = g.state({}, { name: "query" });
		const bundle = agenticMemoryBundle<string>(g, { name: "memory", fragments, query });
		const context = collect(bundle.context);

		expect(data<AgenticMemoryContext<string>>(context.messages).at(-1)).toMatchObject({
			state: "partial",
			contextReady: false,
			entries: [],
		});
	});
});
