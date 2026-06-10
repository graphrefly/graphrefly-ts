import { describe, expect, expectTypeOf, it } from "vitest";
import { graph } from "../graph/graph.js";
import type {
	MemoryAnswer,
	MemoryRetrievalError,
	MemoryRetrievalStatus,
} from "../patterns/index.js";
import {
	admissionFilter3D,
	admissionScored,
	type FactId,
	filterMemoryFragments,
	isMemoryFragment,
	type MemoryFragment,
	type MemoryQuery,
	memoryFragmentMatchesQuery,
	memoryFragmentValidAt,
	memoryRetrievalBundle,
	shardByTenant,
	validateMemoryFragment,
} from "../patterns/index.js";
import { cosineSimilarity } from "../patterns/semantic-memory.js";
import type { Message } from "../protocol/messages.js";

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

describe("semantic memory passive vocabulary (D158)", () => {
	it("validates the passive MemoryFragment shape without owning runtime behavior", () => {
		const ok = fragment({ embedding: [1, 0, 1], parentFragmentId: "parent" });
		expect(validateMemoryFragment(ok)).toEqual({ ok: true, errors: [] });
		expect(isMemoryFragment(ok)).toBe(true);
		expectTypeOf<MemoryFragment<{ note: string }>["id"]>().toEqualTypeOf<FactId>();

		const invalid = validateMemoryFragment({
			id: "",
			tNs: 1,
			confidence: Number.NaN,
			tags: ["ok", 1],
			sources: [null],
		});
		expect(invalid.ok).toBe(false);
		expect(invalid.errors).toEqual([
			"id must be a non-empty string",
			"payload must be present",
			"tNs must be a bigint",
			"confidence must be a finite number in [0, 1]",
			"tags must be a readonly string array",
			"sources must be a readonly string array",
		]);

		expect(
			validateMemoryFragment({
				id: "bad-range",
				payload: undefined,
				tNs: 1n,
				confidence: 0.5,
				tags: [],
				sources: [],
				validFrom: 10n,
				validTo: 5n,
			}).errors,
		).toContain("validFrom must be earlier than validTo");

		const sparseTags = ["ok"];
		delete sparseTags[0];
		expect(
			validateMemoryFragment({
				id: "sparse",
				payload: "x",
				tNs: 1n,
				confidence: 0.5,
				tags: sparseTags,
				sources: [],
			}).errors,
		).toContain("tags must be a readonly string array");
	});

	it("filters structured memory queries with bi-temporal validity", () => {
		const live = fragment({ id: "live", tNs: 20n, confidence: 0.7 });
		const old = fragment({
			id: "old",
			tNs: 30n,
			confidence: 0.9,
			validFrom: 1n,
			validTo: 8n,
			tags: ["archive"],
		});
		const future = fragment({ id: "future", validFrom: 40n });
		const weak = fragment({ id: "weak", confidence: 0.2, tags: ["project"] });

		expect(memoryFragmentValidAt(live)).toBe(true);
		expect(memoryFragmentValidAt(old)).toBe(false);
		expect(memoryFragmentValidAt(future)).toBe(false);
		expect(memoryFragmentValidAt(future, 41n)).toBe(true);
		expect(memoryFragmentValidAt(old, 4n)).toBe(true);
		expect(memoryFragmentMatchesQuery(live, { tags: ["project"], minConfidence: 0.5 })).toBe(true);
		expect(memoryFragmentMatchesQuery(weak, { minConfidence: 0.5 })).toBe(false);

		const query: MemoryQuery = { asOf: 4n, minConfidence: 0.5, limit: 1 };
		expect(filterMemoryFragments([live, old, weak], query).map((item) => item.id)).toEqual(["old"]);
	});

	it("exports deterministic scoring and admission helpers", () => {
		expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
		expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
		expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
		expect(cosineSimilarity([Number.POSITIVE_INFINITY], [1])).toBe(0);

		const scored = admissionScored({
			scoreFn: (raw: { relevance?: number }) => ({ relevance: raw.relevance ?? Number.NaN }),
			thresholds: { relevance: 0.5 },
		});
		expect(scored({ relevance: 0.6 })).toBe(true);
		expect(scored({ relevance: 0.4 })).toBe(false);
		expect(scored({})).toBe(false);

		const threeD = admissionFilter3D({
			scoreFn: (raw) => raw as { persistence: number; structure: number; personalValue: number },
			requireStructured: true,
		});
		expect(threeD({ persistence: 0.5, structure: 0.1, personalValue: 0.5 })).toBe(true);
		expect(threeD({ persistence: 0.5, structure: 0, personalValue: 0.5 })).toBe(false);

		let calls = 0;
		const singleCall = admissionFilter3D({
			scoreFn: () => {
				calls += 1;
				return { persistence: 0.5, structure: 0.5, personalValue: 0.5 };
			},
			requireStructured: true,
		});
		expect(singleCall("x")).toBe(true);
		expect(calls).toBe(1);
	});

	it("builds passive tenant sharding configs", () => {
		const strict = shardByTenant((f: MemoryFragment<{ tenant: string }>) => f.payload.tenant, {
			tenants: ["acme", "globex", "acme"],
		});
		expect(strict.shardCount).toBe(3);
		expect(strict.shardBy(fragment({ payload: { tenant: "acme" } }))).toBe(0);
		expect(strict.shardBy(fragment({ payload: { tenant: "other" } }))).toBe(2);

		const soft = shardByTenant((f: MemoryFragment<{ tenant: string }>) => f.payload.tenant, {
			shardCount: 0,
		});
		expect(soft.shardCount).toBe(1);
		expect(soft.shardBy(fragment({ payload: { tenant: "acme" } }))).toBe("acme");

		const invalidShardCount = shardByTenant(
			(f: MemoryFragment<{ tenant: string }>) => f.payload.tenant,
			{ shardCount: Number.NaN },
		);
		expect(invalidShardCount.shardCount).toBe(4);
	});
});

describe("memoryRetrievalBundle graph pattern (D158)", () => {
	it("exposes declared fragment/query deps and graph-visible retrieval facts", () => {
		const g = graph();
		const fragments = g.state<readonly unknown[]>([], { name: "fragments" });
		const query = g.state({ tags: ["policy"] }, { name: "query" });
		const bundle = memoryRetrievalBundle<string>(g, { name: "memory", fragments, query });

		expect(g.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "fragments", to: "memory/snapshot" },
				{ from: "query", to: "memory/snapshot" },
				{ from: "memory/snapshot", to: "memory/fragments" },
				{ from: "memory/snapshot", to: "memory/indexed" },
				{ from: "memory/snapshot", to: "memory/ranked" },
				{ from: "memory/snapshot", to: "memory/status" },
				{ from: "memory/snapshot", to: "memory/errors" },
				{ from: "memory/snapshot", to: "memory/cursor" },
			]),
		);
		expect(g.describe().nodes.find((node) => node.id === "memory/snapshot")?.factory).toBe(
			"memoryRetrievalSnapshot",
		);
		expect(bundle.input.fragments).toBe(fragments);
		expect(bundle.input.query).toBe(query);
	});

	it("recomputes ranked answers when the query changes", () => {
		const g = graph();
		const fragments = g.state<readonly unknown[]>(
			[
				fragment({ id: "near", confidence: 0.6, embedding: [1, 0], tags: ["policy"] }),
				fragment({ id: "far", confidence: 0.95, embedding: [0, 1], tags: ["policy"] }),
				fragment({ id: "other", confidence: 1, embedding: [1, 0], tags: ["other"] }),
			],
			{ name: "fragments" },
		);
		const query = g.state({ tags: ["policy"], vector: [1, 0], limit: 2 }, { name: "query" });
		const bundle = memoryRetrievalBundle<string>(g, { name: "memory", fragments, query });
		const ranked = collect(bundle.ranked);
		const status = collect(bundle.status);
		const cursor = collect(bundle.cursor);
		ranked.messages.length = 0;
		status.messages.length = 0;
		cursor.messages.length = 0;

		query.set({ tags: ["policy"], vector: [1, 0], limit: 2 });
		expect(
			data<MemoryAnswer<string>>(ranked.messages)
				.at(-1)
				?.results.map((item) => item.id),
		).toEqual(["near", "far"]);
		expect(data<MemoryRetrievalStatus>(status.messages).at(-1)?.state).toBe("ready");
		expect(data(cursor.messages).at(-1)).toMatchObject({ resultCount: 2, validFragments: 3 });

		query.set({ tags: ["other"], vector: [1, 0] });
		expect(
			data<MemoryAnswer<string>>(ranked.messages)
				.at(-1)
				?.results.map((item) => item.id),
		).toEqual(["other"]);
	});

	it("serves cached retrieval facts to projections that subscribe after runtime activation", () => {
		const g = graph();
		const fragments = g.state<readonly unknown[]>([fragment({ id: "cached" })], {
			name: "fragments",
		});
		const query = g.state({}, { name: "query" });
		const bundle = memoryRetrievalBundle<string>(g, { name: "memory", fragments, query });

		const ranked = collect(bundle.ranked);
		expect(
			data<MemoryAnswer<string>>(ranked.messages)
				.at(-1)
				?.results.map((item) => item.id),
		).toEqual(["cached"]);

		const status = collect(bundle.status);
		const errors = collect(bundle.errors);
		expect(data<MemoryRetrievalStatus>(status.messages).at(-1)).toMatchObject({
			state: "ready",
			cursor: { resultCount: 1, validFragments: 1 },
		});
		const latestStatus = data<MemoryRetrievalStatus>(status.messages).at(-1);
		expect(Object.isFrozen(latestStatus?.cursor)).toBe(true);
		expect(() => {
			(latestStatus?.cursor as { resultCount: number }).resultCount = 99;
		}).toThrow(TypeError);
		expect(bundle.status.cache?.cursor.resultCount).toBe(1);
		expect(data<readonly MemoryRetrievalError[]>(errors.messages).at(-1)).toEqual([]);
	});

	it("emits invalid fragments as DATA error/status facts instead of hidden state or protocol ERROR", () => {
		const g = graph();
		const fragments = g.state<readonly unknown[]>([], { name: "fragments" });
		const query = g.state({}, { name: "query" });
		const bundle = memoryRetrievalBundle<string>(g, { name: "memory", fragments, query });
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);
		const ranked = collect(bundle.ranked);
		errors.messages.length = 0;
		status.messages.length = 0;
		ranked.messages.length = 0;

		fragments.set([fragment({ id: "ok" }), { id: "", tNs: 1, confidence: Number.NaN }]);

		expect(errors.messages.map((message) => message[0])).toEqual(["DIRTY", "DATA"]);
		const latestErrors = data<readonly MemoryRetrievalError[]>(errors.messages).at(-1);
		expect(latestErrors?.[0]).toMatchObject({
			code: "invalid-fragment",
			index: 1,
			validationErrors: expect.arrayContaining([
				"id must be a non-empty string",
				"payload must be present",
				"tNs must be a bigint",
				"confidence must be a finite number in [0, 1]",
				"tags must be a readonly string array",
				"sources must be a readonly string array",
			]),
		});
		expect(Object.isFrozen(latestErrors?.[0]?.validationErrors)).toBe(true);
		expect(status.messages.some((message) => message[0] === "ERROR")).toBe(false);
		expect(data<MemoryRetrievalStatus>(status.messages).at(-1)).toMatchObject({
			state: "partial",
			cursor: { validFragments: 1, invalidFragments: 1, resultCount: 1 },
		});
		expect(
			data<MemoryAnswer<string>>(ranked.messages)
				.at(-1)
				?.results.map((item) => item.id),
		).toEqual(["ok"]);
	});

	it("emits malformed queries as graph-visible DATA errors without ranking", () => {
		const g = graph();
		const fragments = g.state<readonly unknown[]>([fragment({ id: "ok", embedding: [1, 0] })], {
			name: "fragments",
		});
		const query = g.state({ vector: [1, 0] }, { name: "query" });
		const bundle = memoryRetrievalBundle<string>(g, { name: "memory", fragments, query });
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);
		const ranked = collect(bundle.ranked);
		errors.messages.length = 0;
		status.messages.length = 0;
		ranked.messages.length = 0;

		query.set({ tags: "policy", vector: {} } as never);

		expect(errors.messages.map((message) => message[0])).toEqual(["DIRTY", "DATA"]);
		expect(
			data<readonly MemoryRetrievalError[]>(errors.messages)
				.at(-1)
				?.map((error) => error.code),
		).toEqual(["invalid-query", "invalid-query-vector"]);
		expect(data<MemoryRetrievalStatus>(status.messages).at(-1)).toMatchObject({
			state: "error",
			cursor: { validFragments: 1, invalidFragments: 0, resultCount: 0 },
		});
		expect(data<MemoryAnswer<string>>(ranked.messages).at(-1)?.results).toEqual([]);
		expect(status.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("turns throwing query and fragment access into graph-visible DATA errors", () => {
		const g = graph();
		const badFragment = {
			get id() {
				throw new Error("id exploded");
			},
		};
		const badQuery = {
			get tags() {
				throw new Error("tags exploded");
			},
		};
		const fragments = g.state<readonly unknown[]>([badFragment], { name: "fragments" });
		const query = g.state(badQuery as never, { name: "query" });
		const bundle = memoryRetrievalBundle<string>(g, { name: "memory", fragments, query });
		const errors = collect(bundle.errors);
		const status = collect(bundle.status);
		const ranked = collect(bundle.ranked);

		expect(data<readonly MemoryRetrievalError[]>(errors.messages).at(-1)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "invalid-query" }),
				expect.objectContaining({ code: "invalid-fragment", index: 0 }),
			]),
		);
		expect(data<MemoryRetrievalStatus>(status.messages).at(-1)?.state).toBe("error");
		expect(data<MemoryAnswer<string>>(ranked.messages).at(-1)?.results).toEqual([]);
		expect(status.messages.some((message) => message[0] === "ERROR")).toBe(false);
	});

	it("snapshots query and fragment metadata so later caller mutation is invisible", () => {
		const g = graph();
		const mutableFragment = fragment({
			id: "stable",
			tags: ["policy"],
			sources: ["source"],
			embedding: [1, 0],
		}) as MemoryFragment<string> & {
			id: string;
			tags: string[];
			sources: string[];
			embedding: number[];
		};
		const mutableQuery = { tags: ["policy"], vector: [1, 0] };
		const fragments = g.state<readonly unknown[]>([mutableFragment], { name: "fragments" });
		const query = g.state(mutableQuery, { name: "query" });
		const bundle = memoryRetrievalBundle<string>(g, { name: "memory", fragments, query });
		const ranked = collect(bundle.ranked);
		const indexed = collect(bundle.indexed);
		const status = collect(bundle.status);

		mutableFragment.id = "mutated";
		mutableFragment.tags.push("mutated");
		mutableFragment.sources.push("mutated-source");
		mutableFragment.embedding[0] = 0;
		mutableQuery.tags.push("mutated-query");
		mutableQuery.vector[0] = 0;

		const answer = data<MemoryAnswer<string>>(ranked.messages).at(-1);
		const index = data(indexed.messages).at(-1) as {
			ids: readonly string[];
			byId: Record<string, MemoryFragment<string>>;
		};
		const latestStatus = data<MemoryRetrievalStatus>(status.messages).at(-1);
		expect(answer?.query).toMatchObject({ tags: ["policy"], vector: [1, 0] });
		expect(answer?.results[0]).toMatchObject({
			id: "stable",
			tags: ["policy"],
			sources: ["source"],
			embedding: [1, 0],
		});
		expect(index.ids).toEqual(["stable"]);
		expect(index.byId.stable.id).toBe("stable");
		expect(latestStatus?.query).toMatchObject({ tags: ["policy"], vector: [1, 0] });
	});

	it("clears errors on clean reruns and rejects duplicate fragment ids", () => {
		const g = graph();
		const fragments = g.state<readonly unknown[]>([], { name: "fragments" });
		const query = g.state({}, { name: "query" });
		const bundle = memoryRetrievalBundle<string>(g, { name: "memory", fragments, query });
		const errors = collect(bundle.errors);
		const indexed = collect(bundle.indexed);
		const ranked = collect(bundle.ranked);
		const status = collect(bundle.status);
		errors.messages.length = 0;
		indexed.messages.length = 0;
		ranked.messages.length = 0;
		status.messages.length = 0;

		fragments.set([fragment({ id: "dup", payload: "a" }), fragment({ id: "dup", payload: "b" })]);
		expect(data<readonly MemoryRetrievalError[]>(errors.messages).at(-1)?.[0]).toMatchObject({
			code: "duplicate-fragment-id",
			index: 1,
		});
		expect(data(indexed.messages).at(-1)).toMatchObject({
			ids: ["dup"],
		});
		expect(
			data<MemoryAnswer<string>>(ranked.messages)
				.at(-1)
				?.results.map((item) => item.id),
		).toEqual(["dup"]);
		expect(data<MemoryRetrievalStatus>(status.messages).at(-1)?.state).toBe("partial");

		fragments.set([fragment({ id: "clean" })]);
		expect(data<readonly MemoryRetrievalError[]>(errors.messages).at(-1)).toEqual([]);
		expect(data(indexed.messages).at(-1)).toMatchObject({
			ids: ["clean"],
		});
	});

	it("keeps storage/restore outside the retrieval bundle surface", () => {
		const g = graph();
		const fragments = g.state<readonly unknown[]>([], { name: "fragments" });
		const query = g.state({}, { name: "query" });
		const bundle = memoryRetrievalBundle(g, { fragments, query });

		expect(Object.hasOwn(bundle, "flush")).toBe(false);
		expect(Object.hasOwn(bundle, "dispose")).toBe(false);
		expect(Object.hasOwn(bundle, "restore")).toBe(false);
	});
});
