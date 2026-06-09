import { describe, expect, expectTypeOf, it } from "vitest";
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
	shardByTenant,
	validateMemoryFragment,
} from "../patterns/index.js";
import { cosineSimilarity } from "../patterns/semantic-memory.js";

const fragment = (patch: Partial<MemoryFragment<string>> = {}): MemoryFragment<string> => ({
	id: "fact-1",
	payload: "payload",
	tNs: 10n,
	confidence: 0.8,
	tags: ["project", "policy"],
	sources: [],
	...patch,
});

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
